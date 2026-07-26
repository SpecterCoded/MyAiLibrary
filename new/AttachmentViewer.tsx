// AttachmentViewer.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';

pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.react-pdf.min.mjs';

// ---------------------------------------------------------------------------
// Data model (mirrors the contract shared with main/preload)
// ---------------------------------------------------------------------------

export type AttachmentKind = 'image' | 'video' | 'audio' | 'pdf';

export interface ViewerAttachment {
  id: string;
  kind: AttachmentKind;
  name: string;
  url: string;
  mimeType?: string;
  size?: number;
  pageCount?: number;
}

export interface OpenViewerPayload {
  attachments: ViewerAttachment[];
  activeIndex: number;
}

export interface AttachmentViewerBridge {
  onPayload(callback: (payload: OpenViewerPayload) => void): () => void;
  close(): void;
  minimize(): void;
  toggleMaximize(): void;
  isMaximized(): Promise<boolean>;
  toggleAlwaysOnTop(): Promise<boolean>;
  getAlwaysOnTop(): Promise<boolean>;
  showInFolder?(attachmentId: string): void;
  saveAs?(attachmentId: string): void;
}

declare global {
  interface Window {
    attachmentViewer: AttachmentViewerBridge;
  }
}

// Explicit constant controlling wrap-around navigation (defaults to off).
const ALLOW_WRAP_NAVIGATION = false;

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 5;
const ZOOM_STEP = 0.25;

type ZoomMode = 'fit' | 'actual';

interface ImageViewState {
  zoomMode: ZoomMode;
  scale: number;
  rotation: number; // 0 | 90 | 180 | 270
  panX: number;
  panY: number;
}

const DEFAULT_IMAGE_STATE: ImageViewState = {
  zoomMode: 'fit',
  scale: 1,
  rotation: 0,
  panX: 0,
  panY: 0,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes?: number): string {
  if (bytes === undefined || Number.isNaN(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatMediaTime(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function clampPanValue(pan: number, boundingSize: number, containerSize: number): number {
  if (containerSize <= 0) return pan;
  const overflow = Math.max((boundingSize - containerSize) / 2, 0);
  const minVisible = 40;
  const limit = overflow + Math.max(containerSize / 2 - minVisible, 0);
  return Math.min(Math.max(pan, -limit), limit);
}

// ---------------------------------------------------------------------------
// Icons (inline SVG, no external icon library, no emoji)
// ---------------------------------------------------------------------------

interface IconProps {
  size?: number;
  style?: React.CSSProperties;
}

const StrokeIcon: React.FC<IconProps & { children: React.ReactNode }> = ({ size = 16, style, children }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={style}
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
);

const IconClose: React.FC<IconProps> = (p) => <StrokeIcon {...p}><path d="M5 5l14 14M19 5L5 19" /></StrokeIcon>;
const IconMinimize: React.FC<IconProps> = (p) => <StrokeIcon {...p}><path d="M5 19h14" /></StrokeIcon>;
const IconMaximize: React.FC<IconProps> = (p) => <StrokeIcon {...p}><rect x="5" y="5" width="14" height="14" rx="1.5" /></StrokeIcon>;
const IconRestore: React.FC<IconProps> = (p) => (
  <StrokeIcon {...p}>
    <rect x="8" y="8" width="11" height="11" rx="1.5" />
    <path d="M5 15V6a1 1 0 0 1 1-1h9" />
  </StrokeIcon>
);
const IconPin: React.FC<IconProps> = (p) => (
  <StrokeIcon {...p}>
    <path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6z" />
    <path d="M12 14v7" />
  </StrokeIcon>
);
const IconDownload: React.FC<IconProps> = (p) => (
  <StrokeIcon {...p}>
    <path d="M12 3v12M7 10l5 5 5-5" />
    <path d="M5 20h14" />
  </StrokeIcon>
);
const IconMore: React.FC<IconProps> = ({ size = 16, style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={style} aria-hidden="true" focusable="false">
    <circle cx="5" cy="12" r="1.8" fill="currentColor" />
    <circle cx="12" cy="12" r="1.8" fill="currentColor" />
    <circle cx="19" cy="12" r="1.8" fill="currentColor" />
  </svg>
);
const IconChevronLeft: React.FC<IconProps> = (p) => <StrokeIcon {...p}><path d="M15 5l-7 7 7 7" /></StrokeIcon>;
const IconChevronRight: React.FC<IconProps> = (p) => <StrokeIcon {...p}><path d="M9 5l7 7-7 7" /></StrokeIcon>;
const IconChevronUp: React.FC<IconProps> = (p) => <StrokeIcon {...p}><path d="M5 15l7-7 7 7" /></StrokeIcon>;
const IconZoomIn: React.FC<IconProps> = (p) => (
  <StrokeIcon {...p}>
    <circle cx="10" cy="10" r="6.5" />
    <path d="M10 7v6M7 10h6" />
    <path d="M15 15l5 5" />
  </StrokeIcon>
);
const IconZoomOut: React.FC<IconProps> = (p) => (
  <StrokeIcon {...p}>
    <circle cx="10" cy="10" r="6.5" />
    <path d="M7 10h6" />
    <path d="M15 15l5 5" />
  </StrokeIcon>
);
const IconFit: React.FC<IconProps> = (p) => (
  <StrokeIcon {...p}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></StrokeIcon>
);
const IconActualSize: React.FC<IconProps> = (p) => (
  <StrokeIcon {...p}>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <rect x="9" y="9" width="6" height="6" />
  </StrokeIcon>
);
const IconRotateLeft: React.FC<IconProps> = (p) => (
  <StrokeIcon {...p}><path d="M4 9a8 8 0 1 1 1.2 7.2" /><path d="M4 4v5h5" /></StrokeIcon>
);
const IconRotateRight: React.FC<IconProps> = (p) => (
  <StrokeIcon {...p}><path d="M20 9a8 8 0 1 0-1.2 7.2" /><path d="M20 4v5h-5" /></StrokeIcon>
);
const IconImageFile: React.FC<IconProps> = (p) => (
  <StrokeIcon {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="1.4" fill="currentColor" stroke="none" />
    <path d="M3 16l5-5 4 4 3-3 6 6" />
  </StrokeIcon>
);
const IconVideoFile: React.FC<IconProps> = (p) => (
  <StrokeIcon {...p}>
    <rect x="3" y="6" width="13" height="12" rx="2" />
    <path d="M16 10l5-3v10l-5-3" />
  </StrokeIcon>
);
const IconAudioFile: React.FC<IconProps> = (p) => (
  <StrokeIcon {...p}>
    <path d="M9 18V6l10-2v12" />
    <circle cx="7" cy="18" r="2.2" />
    <circle cx="17" cy="16" r="2.2" />
  </StrokeIcon>
);
const IconPlay: React.FC<IconProps> = ({ size = 16, style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={style} aria-hidden="true" focusable="false">
    <path d="M8 5.5v13l11-6.5-11-6.5z" fill="currentColor" />
  </svg>
);
const IconPause: React.FC<IconProps> = ({ size = 16, style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={style} aria-hidden="true" focusable="false">
    <rect x="7" y="5" width="3.5" height="14" rx="1" fill="currentColor" />
    <rect x="13.5" y="5" width="3.5" height="14" rx="1" fill="currentColor" />
  </svg>
);
const IconVolume: React.FC<IconProps> = (p) => (
  <StrokeIcon {...p}>
    <path d="M4 9v6h4l5 4V5L8 9H4z" />
    <path d="M16 9.5a4 4 0 0 1 0 5" />
    <path d="M18.5 7a7.5 7.5 0 0 1 0 10" />
  </StrokeIcon>
);
const IconMuted: React.FC<IconProps> = (p) => (
  <StrokeIcon {...p}>
    <path d="M4 9v6h4l5 4V5L8 9H4z" />
    <path d="M17 9l4 4M21 9l-4 4" />
  </StrokeIcon>
);
const IconPdfFile: React.FC<IconProps> = (p) => (
  <StrokeIcon {...p}>
    <path d="M6 2h9l5 5v15H6z" />
    <path d="M15 2v5h5" />
    <path d="M9 14h1.5a1.3 1.3 0 0 0 0-2.6H9V17" />
  </StrokeIcon>
);
const IconAlert: React.FC<IconProps> = (p) => (
  <StrokeIcon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5" />
    <circle cx="12" cy="16.3" r="0.6" fill="currentColor" stroke="none" />
  </StrokeIcon>
);

function getKindIcon(kind: AttachmentKind, size = 16): React.ReactElement {
  switch (kind) {
    case 'image':
      return <IconImageFile size={size} />;
    case 'video':
      return <IconVideoFile size={size} />;
    case 'audio':
      return <IconAudioFile size={size} />;
    case 'pdf':
      return <IconPdfFile size={size} />;
    default:
      return <IconImageFile size={size} />;
  }
}

// ---------------------------------------------------------------------------
// Small presentational pieces
// ---------------------------------------------------------------------------

const EmptyState: React.FC = () => (
  <div className="status-state">
    <IconImageFile size={40} />
    <p>No attachment to display</p>
  </div>
);

const LoadingState: React.FC<{ filename: string }> = ({ filename }) => (
  <div className="status-state" role="status" aria-live="polite">
    <div className="spinner" aria-hidden="true" />
    <p>Loading {filename}…</p>
  </div>
);

const ErrorState: React.FC<{ filename: string; message: string; onRetry: () => void }> = ({
  filename,
  message,
  onRetry,
}) => (
  <div className="status-state error-state" role="alert">
    <IconAlert size={32} />
    <p className="error-title no-drag">{filename}</p>
    <p className="error-message no-drag">{message}</p>
    <button type="button" className="retry-btn no-drag" onClick={onRetry}>
      Retry
    </button>
  </div>
);

const PDF_DEFAULT_FIT = 0.55;
const PDF_MIN_SCALE = 0.35;
const PDF_MAX_SCALE = 1.8;

const SimplePdfViewer: React.FC<{
  fileUrl: string;
  fileName: string;
  retryToken: number;
  onReady: () => void;
  onError: () => void;
}> = ({ fileUrl, fileName, retryToken, onReady, onError }) => {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [numPages, setNumPages] = useState(0);
  const [containerWidth, setContainerWidth] = useState(900);
  const [scale, setScale] = useState(PDF_DEFAULT_FIT);

  useEffect(() => {
    setPageNumber(1);
    setPageInput('1');
    setNumPages(0);
    setScale(PDF_DEFAULT_FIT);
  }, [fileUrl, retryToken]);

  useEffect(() => {
    const node = stageRef.current;
    if (!node) return undefined;
    const update = () => {
      const rect = node.getBoundingClientRect();
      setContainerWidth(Math.max(520, Math.min(rect.width - 72, 1180)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const goToPage = useCallback((next: number) => {
    setPageNumber(() => {
      const max = Math.max(numPages, 1);
      const clamped = Math.min(Math.max(next, 1), max);
      setPageInput(String(clamped));
      return clamped;
    });
  }, [numPages]);

  const commitPageInput = useCallback(() => {
    const parsed = Number.parseInt(pageInput, 10);
    goToPage(Number.isFinite(parsed) ? parsed : pageNumber);
  }, [goToPage, pageInput, pageNumber]);

  const canGoPrevPage = pageNumber > 1;
  const canGoNextPage = numPages > 0 && pageNumber < numPages;
  const pageWidth = Math.max(260, Math.round(containerWidth * scale));

  return (
    <div className="simple-pdf-viewer no-drag">
      <div className="simple-pdf-stage" ref={stageRef}>
        <Document
          key={`${fileUrl}-${retryToken}`}
          file={fileUrl}
          loading={null}
          error={null}
          onLoadSuccess={({ numPages: pages }) => {
            setNumPages(pages);
            setPageNumber((current) => Math.min(Math.max(current, 1), pages));
            setPageInput((current) => {
              const parsed = Number.parseInt(current, 10);
              return String(Math.min(Math.max(Number.isFinite(parsed) ? parsed : 1, 1), pages));
            });
            onReady();
          }}
          onLoadError={onError}
        >
          <Page
            key={`${fileUrl}-${pageNumber}-${scale}`}
            pageNumber={pageNumber}
            width={pageWidth}
            renderAnnotationLayer={false}
            renderTextLayer={false}
            loading={null}
            error={null}
            onRenderError={onError}
          />
        </Document>
      </div>

      <div className="simple-pdf-pager" aria-label={`${fileName} page navigation`}>
        <button
          type="button"
          className="simple-pdf-btn"
          onClick={() => goToPage(pageNumber - 1)}
          disabled={!canGoPrevPage}
          aria-label="Previous page"
          title="Previous page"
        >
          <IconChevronLeft size={18} />
        </button>
        <input
          className="simple-pdf-page-input"
          value={pageInput}
          inputMode="numeric"
          aria-label="Current page"
          onChange={(event) => setPageInput(event.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
          onBlur={commitPageInput}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            }
          }}
        />
        <span className="simple-pdf-total">{numPages || '—'}</span>
        <button
          type="button"
          className="simple-pdf-btn"
          onClick={() => goToPage(pageNumber + 1)}
          disabled={!canGoNextPage}
          aria-label="Next page"
          title="Next page"
        >
          <IconChevronRight size={18} />
        </button>
        <span className="simple-pdf-divider" />
        <button type="button" className="simple-pdf-btn text" onClick={() => setScale((value) => Math.max(PDF_MIN_SCALE, value - 0.1))}>
          −
        </button>
        <button type="button" className="simple-pdf-fit" onClick={() => setScale(PDF_DEFAULT_FIT)}>
          Fit
        </button>
        <button type="button" className="simple-pdf-btn text" onClick={() => setScale((value) => Math.min(PDF_MAX_SCALE, value + 0.1))}>
          +
        </button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Error boundary
// ---------------------------------------------------------------------------

interface BoundaryState {
  hasError: boolean;
}

class ViewerErrorBoundary extends React.Component<{ children: React.ReactNode }, BoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): BoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('AttachmentViewer crashed:', error, info);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="viewer-root">
          <style>{STYLES}</style>
          <div className="status-state error-state">
            <IconAlert size={32} />
            <p className="error-title">The viewer ran into a problem</p>
            <p className="error-message">Close this window and reopen the attachment.</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const AttachmentViewer: React.FC = () => {
  const [attachments, setAttachments] = useState<ViewerAttachment[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number } | null>(null);
  const [imageState, setImageState] = useState<ImageViewState>(DEFAULT_IMAGE_STATE);
  const [isPanning, setIsPanning] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [, setAlwaysOnTop] = useState(false);
  const [thumbStripCollapsed, setThumbStripCollapsed] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioVolume, setAudioVolume] = useState(0.9);
  const [audioMuted, setAudioMuted] = useState(false);

  const mediaCanvasRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const loadingRef = useRef(loading);
  const mountedRef = useRef(true);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  const active = attachments[activeIndex] ?? null;

  // -- Subscribe to payloads pushed from the main process ------------------
  useEffect(() => {
    if (!window.attachmentViewer) return undefined;
    const unsubscribe = window.attachmentViewer.onPayload((payload) => {
      if (!payload || !Array.isArray(payload.attachments) || payload.attachments.length === 0) return;
      const idx = Math.min(Math.max(payload.activeIndex ?? 0, 0), payload.attachments.length - 1);
      setAttachments(payload.attachments);
      setActiveIndex(idx);
    });
    return () => unsubscribe();
  }, []);

  // -- Initial window-chrome state ------------------------------------------
  useEffect(() => {
    if (!window.attachmentViewer) return;
    window.attachmentViewer
      .isMaximized()
      .then((v) => mountedRef.current && setIsMaximized(v))
      .catch(() => undefined);
    window.attachmentViewer
      .getAlwaysOnTop()
      .then((v) => mountedRef.current && setAlwaysOnTop(v))
      .catch(() => undefined);
  }, []);

  // -- Keep maximize state in sync with OS-level changes --------------------
  useEffect(() => {
    let frame: number | null = null;
    const handleResize = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        window.attachmentViewer
          ?.isMaximized()
          .then((v) => mountedRef.current && setIsMaximized(v))
          .catch(() => undefined);
      });
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, []);

  // -- Track canvas size for fit calculations --------------------------------
  useEffect(() => {
    const node = mediaCanvasRef.current;
    if (!node) return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setContainerSize({ width, height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // -- Reset per-attachment state --------------------------------------------
  useEffect(() => {
    setLoading(true);
    setError(null);
    setNaturalSize(null);
    setImageState(DEFAULT_IMAGE_STATE);
    videoRef.current?.pause();
    audioRef.current?.pause();
    setIsAudioPlaying(false);
    setAudioCurrentTime(0);
    setAudioDuration(0);
  }, [activeIndex, attachments]);

  // -- PDF load timeout fallback ---------------------------------------------
  useEffect(() => {
    if (!active || active.kind !== 'pdf') return undefined;
    const timer = window.setTimeout(() => {
      if (loadingRef.current) {
        setLoading(false);
        setError('This PDF is taking too long to load or could not be displayed.');
      }
    }, 9000);
    return () => window.clearTimeout(timer);
  }, [active, retryToken]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = audioVolume;
    audio.muted = audioMuted;
  }, [activeIndex, audioVolume, audioMuted]);

  // -- Navigation --------------------------------------------------------------
  const goTo = useCallback((index: number) => {
    setAttachments((current) => {
      if (current.length === 0) return current;
      const next = ALLOW_WRAP_NAVIGATION
        ? ((index % current.length) + current.length) % current.length
        : Math.min(Math.max(index, 0), current.length - 1);
      setActiveIndex(next);
      return current;
    });
  }, []);

  const goPrev = useCallback(() => goTo(activeIndex - 1), [activeIndex, goTo]);
  const goNext = useCallback(() => goTo(activeIndex + 1), [activeIndex, goTo]);
  const goFirst = useCallback(() => goTo(0), [goTo]);
  const goLast = useCallback(() => goTo(attachments.length - 1), [goTo, attachments.length]);

  const canGoPrev = ALLOW_WRAP_NAVIGATION ? attachments.length > 1 : activeIndex > 0;
  const canGoNext = ALLOW_WRAP_NAVIGATION ? attachments.length > 1 : activeIndex < attachments.length - 1;

  // -- Zoom / rotation ----------------------------------------------------------
  const zoomIn = useCallback(() => {
    setImageState((s) => ({ ...s, scale: Math.min(s.scale + ZOOM_STEP, ZOOM_MAX) }));
  }, []);
  const zoomOut = useCallback(() => {
    setImageState((s) => ({ ...s, scale: Math.max(s.scale - ZOOM_STEP, ZOOM_MIN) }));
  }, []);
  const resetFit = useCallback(() => {
    setImageState((s) => ({ ...s, zoomMode: 'fit', scale: 1, panX: 0, panY: 0 }));
  }, []);
  const actualSize = useCallback(() => {
    setImageState((s) => ({ ...s, zoomMode: 'actual', scale: 1, panX: 0, panY: 0 }));
  }, []);
  const rotateRight = useCallback(() => {
    setImageState((s) => ({ ...s, rotation: (s.rotation + 90) % 360, panX: 0, panY: 0 }));
  }, []);
  const rotateLeft = useCallback(() => {
    setImageState((s) => ({ ...s, rotation: (s.rotation - 90 + 360) % 360, panX: 0, panY: 0 }));
  }, []);

  // -- Fit-mode sizing math (accounts for 90/270 rotation) -----------------------
  const rotated = imageState.rotation === 90 || imageState.rotation === 270;

  const fitElementSize = useMemo(() => {
    if (!naturalSize || !containerSize || containerSize.width === 0 || containerSize.height === 0) return null;
    const boxW = rotated ? naturalSize.height : naturalSize.width;
    const boxH = rotated ? naturalSize.width : naturalSize.height;
    const containerAspect = containerSize.width / containerSize.height;
    const boxAspect = boxW / boxH;
    let visualW: number;
    let visualH: number;
    if (boxAspect > containerAspect) {
      visualW = containerSize.width;
      visualH = containerSize.width / boxAspect;
    } else {
      visualH = containerSize.height;
      visualW = containerSize.height * boxAspect;
    }
    return {
      width: rotated ? visualH : visualW,
      height: rotated ? visualW : visualH,
    };
  }, [naturalSize, containerSize, rotated]);

  const displaySize = useMemo(() => {
    if (!naturalSize) return null;
    if (imageState.zoomMode === 'actual') return { width: naturalSize.width, height: naturalSize.height };
    return fitElementSize;
  }, [naturalSize, imageState.zoomMode, fitElementSize]);

  const zoomPercent = useMemo(() => {
    if (!naturalSize || !displaySize) return 100;
    const baseline = (displaySize.width / naturalSize.width) * 100;
    return Math.round(baseline * imageState.scale);
  }, [naturalSize, displaySize, imageState.scale]);

  // -- Ctrl+wheel zoom (native listener so preventDefault is honored) -----------
  useEffect(() => {
    const node = mediaCanvasRef.current;
    if (!node) return undefined;
    const handleWheelNative = (e: WheelEvent) => {
      if (!e.ctrlKey || !active || active.kind !== 'image') return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      setImageState((s) => ({ ...s, scale: Math.min(Math.max(s.scale + delta, ZOOM_MIN), ZOOM_MAX) }));
    };
    node.addEventListener('wheel', handleWheelNative, { passive: false });
    return () => node.removeEventListener('wheel', handleWheelNative);
  }, [active]);

  // -- Pointer-based panning ------------------------------------------------------
  const canPan = !loading && (imageState.zoomMode === 'actual' || imageState.scale > 1);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLImageElement>) => {
      if (e.button !== 0 || !canPan) return;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      panStartRef.current = { x: e.clientX, y: e.clientY, panX: imageState.panX, panY: imageState.panY };
      setIsPanning(true);
    },
    [canPan, imageState.panX, imageState.panY]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLImageElement>) => {
      if (!panStartRef.current || !displaySize || !containerSize) return;
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      const boundingW = (rotated ? displaySize.height : displaySize.width) * imageState.scale;
      const boundingH = (rotated ? displaySize.width : displaySize.height) * imageState.scale;
      setImageState((s) => ({
        ...s,
        panX: clampPanValue(panStartRef.current!.panX + dx, boundingW, containerSize.width),
        panY: clampPanValue(panStartRef.current!.panY + dy, boundingH, containerSize.height),
      }));
    },
    [displaySize, containerSize, rotated, imageState.scale]
  );

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLImageElement>) => {
    panStartRef.current = null;
    setIsPanning(false);
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* pointer capture already released */
    }
  }, []);

  const handleDoubleClick = useCallback(() => {
    if (!active || active.kind !== 'image') return;
    setImageState((s) =>
      s.zoomMode === 'actual'
        ? { ...s, zoomMode: 'fit', scale: 1, panX: 0, panY: 0 }
        : { ...s, zoomMode: 'actual', scale: 1, panX: 0, panY: 0 }
    );
  }, [active]);

  // -- Media event handlers ---------------------------------------------------------
  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
    setLoading(false);
    setError(null);
  }, []);
  const handleImageError = useCallback(() => {
    setLoading(false);
    setError('This image could not be loaded.');
  }, []);
  const handleVideoReady = useCallback(() => {
    setLoading(false);
    setError(null);
  }, []);
  const handleVideoError = useCallback(() => {
    setLoading(false);
    setError('This video could not be loaded.');
  }, []);
  const handleAudioReady = useCallback(() => {
    const audio = audioRef.current;
    if (audio && Number.isFinite(audio.duration)) {
      setAudioDuration(audio.duration);
      setAudioCurrentTime(audio.currentTime || 0);
    }
    setLoading(false);
    setError(null);
  }, []);
  const handleAudioError = useCallback(() => {
    setLoading(false);
    setError('This audio file could not be loaded.');
  }, []);
  const handleAudioTimeUpdate = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setAudioCurrentTime(audio.currentTime || 0);
    if (Number.isFinite(audio.duration)) setAudioDuration(audio.duration);
  }, []);
  const handleAudioToggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => undefined);
    } else {
      audio.pause();
    }
  }, []);
  const handleAudioSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    const nextTime = Number(e.currentTarget.value);
    setAudioCurrentTime(nextTime);
    if (audio && Number.isFinite(nextTime)) {
      audio.currentTime = nextTime;
    }
  }, []);
  const handleAudioVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const nextVolume = Math.min(1, Math.max(0, Number(e.currentTarget.value)));
    setAudioVolume(nextVolume);
    setAudioMuted(nextVolume === 0);
    if (audioRef.current) {
      audioRef.current.volume = nextVolume;
      audioRef.current.muted = nextVolume === 0;
    }
  }, []);
  const handleAudioMuteToggle = useCallback(() => {
    setAudioMuted((current) => {
      const nextMuted = !current;
      if (!nextMuted && audioVolume === 0) {
        setAudioVolume(0.7);
        if (audioRef.current) audioRef.current.volume = 0.7;
      }
      if (audioRef.current) audioRef.current.muted = nextMuted;
      return nextMuted;
    });
  }, [audioVolume]);
  const handlePdfLoad = useCallback(() => {
    setLoading(false);
    setError(null);
  }, []);
  const handlePdfError = useCallback(() => {
    setLoading(false);
    setError('This PDF could not be loaded.');
  }, []);

  const retry = useCallback(() => {
    setError(null);
    setLoading(true);
    setRetryToken((t) => t + 1);
  }, []);

  // -- Window chrome actions ------------------------------------------------------
  const handleClose = useCallback(() => window.attachmentViewer?.close(), []);
  const handleMinimize = useCallback(() => window.attachmentViewer?.minimize(), []);
  const handleToggleMaximize = useCallback(() => {
    window.attachmentViewer?.toggleMaximize();
    window.setTimeout(() => {
      window.attachmentViewer
        ?.isMaximized()
        .then((v) => mountedRef.current && setIsMaximized(v))
        .catch(() => undefined);
    }, 60);
  }, []);
  const handleToggleAlwaysOnTop = useCallback(() => {
    window.attachmentViewer
      ?.toggleAlwaysOnTop()
      .then((v) => mountedRef.current && setAlwaysOnTop(v))
      .catch(() => undefined);
  }, []);
  const handleSave = useCallback(() => {
    if (active) window.attachmentViewer?.saveAs?.(active.id);
  }, [active]);
  const handleShowInFolder = useCallback(() => {
    if (active) window.attachmentViewer?.showInFolder?.(active.id);
    setMoreMenuOpen(false);
  }, [active]);

  // -- Close the "more" menu on outside click --------------------------------------
  useEffect(() => {
    if (!moreMenuOpen) return undefined;
    const handleClick = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, [moreMenuOpen]);

  // -- Keyboard shortcuts -------------------------------------------------------------
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditable =
        !!target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (isEditable) return;

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          if (moreMenuOpen) {
            setMoreMenuOpen(false);
          } else {
            handleClose();
          }
          break;
        case 'ArrowLeft':
          e.preventDefault();
          goPrev();
          break;
        case 'ArrowRight':
          e.preventDefault();
          goNext();
          break;
        case 'Home':
          e.preventDefault();
          goFirst();
          break;
        case 'End':
          e.preventDefault();
          goLast();
          break;
        case '+':
        case '=':
          if (active?.kind === 'image') {
            e.preventDefault();
            zoomIn();
          }
          break;
        case '-':
          if (active?.kind === 'image') {
            e.preventDefault();
            zoomOut();
          }
          break;
        case '0':
          if (active?.kind === 'image') {
            e.preventDefault();
            resetFit();
          }
          break;
        case '1':
          if (active?.kind === 'image') {
            e.preventDefault();
            actualSize();
          }
          break;
        case 'r':
        case 'R':
          if (active?.kind === 'image') {
            e.preventDefault();
            if (e.shiftKey) rotateLeft();
            else rotateRight();
          }
          break;
        case ' ': {
          const tag = target?.tagName;
          const isMediaControl = tag === 'VIDEO' || tag === 'AUDIO' || tag === 'BUTTON';
          if (!isMediaControl) {
            if (active?.kind === 'video' && videoRef.current) {
              e.preventDefault();
              videoRef.current.paused ? videoRef.current.play() : videoRef.current.pause();
            } else if (active?.kind === 'audio' && audioRef.current) {
              e.preventDefault();
              audioRef.current.paused ? audioRef.current.play() : audioRef.current.pause();
            }
          }
          break;
        }
        case 'w':
        case 'W':
          if (e.ctrlKey) {
            e.preventDefault();
            handleClose();
          }
          break;
        case 'F11':
          e.preventDefault();
          handleToggleMaximize();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    active,
    moreMenuOpen,
    goPrev,
    goNext,
    goFirst,
    goLast,
    zoomIn,
    zoomOut,
    resetFit,
    actualSize,
    rotateLeft,
    rotateRight,
    handleClose,
    handleToggleMaximize,
  ]);

  // -- Derived header text -----------------------------------------------------------
  const metadataText = useMemo(() => {
    if (!active) return '';
    const parts: string[] = [];
    if (active.kind === 'image' && naturalSize) parts.push(`${naturalSize.width}×${naturalSize.height}`);
    if (active.kind === 'pdf' && active.pageCount) parts.push(`${active.pageCount} pages`);
    const sizeText = formatBytes(active.size);
    if (sizeText) parts.push(sizeText);
    return parts.join(' · ');
  }, [active, naturalSize]);

  // -- Media renderer -----------------------------------------------------------------
  const renderMedia = (): React.ReactNode => {
    if (!active) return null;

    if (active.kind === 'image') {
      const style: React.CSSProperties = {
        width: displaySize ? `${displaySize.width}px` : 'auto',
        height: displaySize ? `${displaySize.height}px` : 'auto',
        maxWidth: displaySize ? undefined : '100%',
        maxHeight: displaySize ? undefined : '100%',
        transform: `translate(${imageState.panX}px, ${imageState.panY}px) scale(${imageState.scale}) rotate(${imageState.rotation}deg)`,
        transition: isPanning ? 'none' : 'transform 0.12s ease',
        cursor: canPan ? (isPanning ? 'grabbing' : 'grab') : 'default',
        opacity: loading ? 0 : 1,
      };
      return (
        <img
          key={`${active.id}-${retryToken}`}
          src={active.url}
          alt={active.name}
          draggable={false}
          className="viewer-image no-drag"
          style={style}
          onLoad={handleImageLoad}
          onError={handleImageError}
          onDoubleClick={handleDoubleClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />
      );
    }

    if (active.kind === 'video') {
      return (
        <div className="video-wrapper no-drag" style={{ opacity: loading ? 0 : 1 }}>
          <video
            key={`${active.id}-${retryToken}`}
            ref={videoRef}
            src={active.url}
            className="viewer-video"
            controls
            controlsList="nodownload"
            preload="metadata"
            autoPlay={false}
            onLoadedMetadata={handleVideoReady}
            onCanPlay={handleVideoReady}
            onError={handleVideoError}
          />
        </div>
      );
    }

    if (active.kind === 'audio') {
      const progress = audioDuration > 0 ? Math.min(100, Math.max(0, (audioCurrentTime / audioDuration) * 100)) : 0;
      const volumeProgress = audioMuted ? 0 : Math.round(audioVolume * 100);
      return (
        <div className="audio-card no-drag" style={{ opacity: loading ? 0 : 1 }}>
          <div className="audio-icon">
            <IconAudioFile size={28} />
          </div>
          <div className="audio-name" title={active.name}>
            {active.name}
          </div>
          <div className="audio-meta">{[active.mimeType, formatBytes(active.size)].filter(Boolean).join(' · ')}</div>
          <div className="custom-audio-player">
            <button
              type="button"
              className="audio-play-button"
              onClick={handleAudioToggle}
              aria-label={isAudioPlaying ? 'Pause audio' : 'Play audio'}
            >
              {isAudioPlaying ? <IconPause size={16} /> : <IconPlay size={16} />}
            </button>
            <span className="audio-time">{formatMediaTime(audioCurrentTime)}</span>
            <input
              className="audio-progress"
              type="range"
              min="0"
              max={audioDuration || 0}
              step="0.01"
              value={Math.min(audioCurrentTime, audioDuration || audioCurrentTime || 0)}
              onChange={handleAudioSeek}
              style={{ '--audio-progress': `${progress}%` } as React.CSSProperties}
              aria-label="Audio progress"
            />
            <span className="audio-time">{formatMediaTime(audioDuration)}</span>
            <div className="audio-volume-control">
              <button
                type="button"
                className="audio-volume-button"
                onClick={handleAudioMuteToggle}
                aria-label={audioMuted ? 'Unmute audio' : 'Mute audio'}
              >
                {audioMuted || audioVolume === 0 ? <IconMuted size={15} /> : <IconVolume size={15} />}
              </button>
              <div className="audio-volume-popover">
                <input
                  className="audio-volume"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={audioMuted ? 0 : audioVolume}
                  onChange={handleAudioVolumeChange}
                  style={{ '--audio-volume': `${volumeProgress}%` } as React.CSSProperties}
                  aria-label="Audio volume"
                />
              </div>
            </div>
          </div>
          <audio
            key={`${active.id}-${retryToken}`}
            ref={audioRef}
            src={active.url}
            className="audio-native-element"
            preload="metadata"
            onLoadedMetadata={handleAudioReady}
            onCanPlay={handleAudioReady}
            onTimeUpdate={handleAudioTimeUpdate}
            onPlay={() => setIsAudioPlaying(true)}
            onPause={() => setIsAudioPlaying(false)}
            onEnded={() => setIsAudioPlaying(false)}
            onError={handleAudioError}
          />
        </div>
      );
    }

    return (
      <div className="pdf-wrapper no-drag" style={{ opacity: loading ? 0 : 1 }}>
        <SimplePdfViewer
          fileUrl={active.url}
          fileName={active.name}
          retryToken={retryToken}
          onReady={handlePdfLoad}
          onError={handlePdfError}
        />
      </div>
    );
  };

  return (
    <ViewerErrorBoundary>
      <div className="viewer-root">
        <style>{STYLES}</style>

        <header className="viewer-header drag">
          <div className="header-left">
            <span className="file-type-badge">{active ? getKindIcon(active.kind) : <IconImageFile size={16} />}</span>
            <span className="file-name no-drag" title={active?.name ?? ''}>
              {active?.name ?? 'No attachment'}
            </span>
            {metadataText && <span className="file-meta no-drag">{metadataText}</span>}
          </div>

          <div className="header-center">
            {attachments.length > 0 && (
              <span className="item-counter">
                {activeIndex + 1} of {attachments.length}
              </span>
            )}
          </div>

          <div className="header-right no-drag">
            <button
              type="button"
              className="header-btn"
              onClick={handleSave}
              aria-label="Save attachment"
              title="Save as"
              disabled={!active}
            >
              <IconDownload size={15} />
            </button>
            <div className="header-more-wrapper" ref={moreMenuRef}>
              <button
                type="button"
                className="header-btn"
                onClick={() => setMoreMenuOpen((v) => !v)}
                aria-label="More options"
                aria-haspopup="menu"
                aria-expanded={moreMenuOpen}
                title="More options"
                disabled={!active}
              >
                <IconMore size={15} />
              </button>
              {moreMenuOpen && (
                <div className="header-more-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className="header-more-item"
                    onClick={handleShowInFolder}
                    disabled={!window.attachmentViewer?.showInFolder}
                  >
                    Show in folder
                  </button>
                </div>
              )}
            </div>
            <span className="header-divider" />
            <button type="button" className="header-btn" onClick={handleMinimize} aria-label="Minimize window" title="Minimize">
              <IconMinimize size={15} />
            </button>
            <button
              type="button"
              className="header-btn"
              onClick={handleToggleMaximize}
              aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
              title={isMaximized ? 'Restore' : 'Maximize'}
            >
              {isMaximized ? <IconRestore size={15} /> : <IconMaximize size={15} />}
            </button>
            <button
              type="button"
              className="header-btn header-btn-close"
              onClick={handleClose}
              aria-label="Close viewer"
              title="Close (Esc)"
            >
              <IconClose size={16} />
            </button>
          </div>
        </header>

        <div className="viewer-body">
          <div className="viewer-canvas" ref={mediaCanvasRef}>
            {!active && <EmptyState />}
            {active && (
              <>
                {renderMedia()}
                {loading && !error && <LoadingState filename={active.name} />}
                {error && <ErrorState filename={active.name} message={error} onRetry={retry} />}
              </>
            )}
            {attachments.length > 1 && (
              <>
                <button
                  type="button"
                  className="nav-btn nav-prev no-drag"
                  onClick={goPrev}
                  disabled={!canGoPrev}
                  aria-label="Previous attachment"
                  title="Previous (Left Arrow)"
                >
                  <IconChevronLeft size={20} />
                </button>
                <button
                  type="button"
                  className="nav-btn nav-next no-drag"
                  onClick={goNext}
                  disabled={!canGoNext}
                  aria-label="Next attachment"
                  title="Next (Right Arrow)"
                >
                  <IconChevronRight size={20} />
                </button>
              </>
            )}
          </div>

          {active?.kind === 'image' && !error && (
            <div className="bottom-toolbar no-drag" role="toolbar" aria-label="Image controls">
              <button type="button" className="toolbar-btn" onClick={zoomOut} aria-label="Zoom out" title="Zoom out (-)">
                <IconZoomOut size={15} />
              </button>
              <span className="zoom-value" aria-live="polite">
                {zoomPercent}%
              </span>
              <button type="button" className="toolbar-btn" onClick={zoomIn} aria-label="Zoom in" title="Zoom in (+)">
                <IconZoomIn size={15} />
              </button>
              <div className="toolbar-divider" />
              <button type="button" className="toolbar-btn" onClick={resetFit} aria-label="Fit to window" title="Fit to window (0)">
                <IconFit size={15} />
              </button>
              <button type="button" className="toolbar-btn" onClick={actualSize} aria-label="Actual size" title="Actual size (1)">
                <IconActualSize size={15} />
              </button>
              <div className="toolbar-divider" />
              <button type="button" className="toolbar-btn" onClick={rotateLeft} aria-label="Rotate left" title="Rotate left (Shift+R)">
                <IconRotateLeft size={15} />
              </button>
              <button type="button" className="toolbar-btn" onClick={rotateRight} aria-label="Rotate right" title="Rotate right (R)">
                <IconRotateRight size={15} />
              </button>
            </div>
          )}
        </div>

        {attachments.length > 1 && (
          <div className={`thumb-strip ${thumbStripCollapsed ? 'collapsed' : ''}`}>
            <button
              type="button"
              className="thumb-toggle no-drag"
              onClick={() => setThumbStripCollapsed((v) => !v)}
              aria-label={thumbStripCollapsed ? 'Expand attachment strip' : 'Collapse attachment strip'}
              aria-expanded={!thumbStripCollapsed}
              title={thumbStripCollapsed ? 'Show thumbnails' : 'Hide thumbnails'}
            >
              <IconChevronUp size={14} style={{ transform: thumbStripCollapsed ? 'rotate(180deg)' : 'none' }} />
            </button>
            {!thumbStripCollapsed && (
              <div className="thumb-track no-drag" role="listbox" aria-label="Attachments">
                {attachments.map((att, idx) => (
                  <button
                    key={att.id}
                    type="button"
                    role="option"
                    aria-selected={idx === activeIndex}
                    className={`thumb-item ${idx === activeIndex ? 'active' : ''}`}
                    onClick={() => goTo(idx)}
                    title={att.name}
                  >
                    {att.kind === 'image' ? (
                      <img src={att.url} alt="" className="thumb-image" draggable={false} />
                    ) : (
                      <span className="thumb-generic">{getKindIcon(att.kind, 18)}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </ViewerErrorBoundary>
  );
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const STYLES = `
  html, body { margin: 0; padding: 0; height: 100%; background: transparent; overscroll-behavior: none; }
  * { box-sizing: border-box; }
  *:focus-visible { outline: 2px solid #4f9eff; outline-offset: 2px; }

  .viewer-root {
    height: 100vh;
    width: 100vw;
    display: flex;
    flex-direction: column;
    background: rgba(17,18,20,0.78);
    color: #e8e8ea;
    font-family: -apple-system, 'Segoe UI', Inter, Roboto, sans-serif;
    user-select: none;
    overflow: hidden;
  }

  .drag { -webkit-app-region: drag; }
  .no-drag { -webkit-app-region: no-drag; }

  .viewer-header {
    height: 52px;
    min-height: 52px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 10px 0 14px;
    background: #17181b;
    border-bottom: 1px solid rgba(255,255,255,0.07);
    gap: 12px;
  }
  .header-left { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; }
  .file-type-badge { display: flex; color: #9a9ba1; flex-shrink: 0; }
  .file-name {
    font-size: 13.5px; font-weight: 500; color: #f1f1f3;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 320px;
    user-select: text; cursor: default;
  }
  .file-meta { font-size: 12px; color: #83848a; white-space: nowrap; user-select: text; }
  .header-center { flex-shrink: 0; }
  .item-counter {
    font-size: 12px; color: #b7b8bd; background: rgba(255,255,255,0.05);
    padding: 3px 10px; border-radius: 999px; font-variant-numeric: tabular-nums;
  }
  .header-right { display: flex; align-items: center; gap: 3px; flex-shrink: 0; position: relative; }
  .header-divider { width: 1px; height: 20px; background: rgba(255,255,255,0.09); margin: 0 3px; }
  .header-btn {
    width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
    background: transparent; border: none; border-radius: 7px; color: #c7c8cd; cursor: pointer;
    transition: background-color .15s ease, color .15s ease;
  }
  .header-btn:hover:not(:disabled) { background: rgba(255,255,255,0.08); color: #ffffff; }
  .header-btn:disabled { opacity: 0.35; cursor: default; }
  .header-btn.active { color: #4f9eff; background: rgba(79,158,255,0.12); }
  .header-btn-close:hover:not(:disabled) { background: rgba(232,17,35,0.15); color: #ff6b6b; }

  .header-more-wrapper { position: relative; }
  .header-more-menu {
    position: absolute; top: 38px; right: 0; min-width: 160px;
    background: #1d1e22; border: 1px solid rgba(255,255,255,0.08); border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.45); padding: 4px; z-index: 20;
  }
  .header-more-item {
    width: 100%; text-align: left; background: transparent; border: none; color: #e8e8ea;
    font-size: 13px; padding: 8px 10px; border-radius: 5px; cursor: pointer;
  }
  .header-more-item:hover:not(:disabled) { background: rgba(255,255,255,0.07); }
  .header-more-item:disabled { opacity: 0.4; cursor: default; }

  .viewer-body { flex: 1; min-height: 0; display: flex; flex-direction: column; position: relative; }

  .viewer-canvas {
    flex: 1; position: relative; display: flex; align-items: center; justify-content: center;
    background: rgba(11,12,13,0.42); overflow: hidden; touch-action: none;
  }

  .viewer-image { touch-action: none; user-select: none; display: block; }

  .status-state {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 10px; color: #86878d; font-size: 13px; text-align: center; padding: 24px;
  }
  .error-title { color: #f1f1f3; font-weight: 500; font-size: 14px; margin: 0; }
  .error-message { margin: 0; max-width: 320px; }
  .retry-btn {
    margin-top: 4px; padding: 7px 18px; background: rgba(255,255,255,0.08); color: #f1f1f3;
    border: 1px solid rgba(255,255,255,0.12); border-radius: 7px; cursor: pointer; font-size: 13px;
  }
  .retry-btn:hover { background: rgba(255,255,255,0.14); }

  .spinner {
    width: 26px; height: 26px; border-radius: 50%;
    border: 2.5px solid rgba(255,255,255,0.12); border-top-color: #4f9eff;
    animation: viewer-spin 0.8s linear infinite;
  }
  @keyframes viewer-spin { to { transform: rotate(360deg); } }

  .nav-btn {
    position: absolute; top: 50%; transform: translateY(-50%);
    width: 40px; height: 40px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.1);
    background: rgba(20,20,22,0.6); color: #e8e8ea; display: flex; align-items: center; justify-content: center;
    cursor: pointer; opacity: 0; transition: opacity .15s ease, background-color .15s ease;
  }
  .viewer-canvas:hover .nav-btn, .nav-btn:focus-visible { opacity: 1; }
  .nav-btn:hover:not(:disabled) { background: rgba(30,30,33,0.85); }
  .nav-btn:disabled { opacity: 0 !important; pointer-events: none; }
  .nav-prev { left: 16px; }
  .nav-next { right: 16px; }

  .video-wrapper, .pdf-wrapper {
    width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; position: relative;
  }
  .viewer-video { max-width: 100%; max-height: 100%; outline: none; background: #000; }
  .simple-pdf-viewer {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: stretch;
    justify-content: center;
    overflow: hidden;
  }
  .simple-pdf-stage {
    width: 100%;
    height: 100%;
    padding: 34px 36px 74px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: auto;
    scrollbar-width: none;
  }
  .simple-pdf-stage::-webkit-scrollbar { width: 0; height: 0; display: none; }
  .simple-pdf-stage .react-pdf__Document {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
  }
  .simple-pdf-stage .react-pdf__Page {
    display: flex;
    justify-content: center;
    filter: drop-shadow(0 28px 54px rgba(0,0,0,0.62));
  }
  .simple-pdf-stage .react-pdf__Page canvas {
    max-width: 100%;
    height: auto !important;
    border-radius: 2px;
    background: #fff;
  }
  .simple-pdf-pager {
    position: absolute;
    left: 50%;
    bottom: 18px;
    transform: translateX(-50%);
    z-index: 8;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 9px;
    border-radius: 9px;
    background: rgba(255,255,255,0.94);
    color: #333a46;
    border: 1px solid rgba(255,255,255,0.82);
    box-shadow: 0 14px 32px rgba(0,0,0,0.36);
    backdrop-filter: blur(14px);
  }
  .simple-pdf-btn {
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 7px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    color: #6d7480;
    cursor: pointer;
  }
  .simple-pdf-btn:hover:not(:disabled) { background: rgba(15,23,42,0.08); color: #1f2937; }
  .simple-pdf-btn:disabled { opacity: 0.3; cursor: default; }
  .simple-pdf-btn.text { font-size: 17px; font-weight: 700; line-height: 1; }
  .simple-pdf-page-input {
    width: 42px;
    height: 30px;
    border: 1px solid #d6dbe3;
    border-radius: 6px;
    background: #fff;
    color: #111827;
    text-align: center;
    font-size: 14px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    outline: none;
  }
  .simple-pdf-page-input:focus { border-color: #7ba7ff; box-shadow: 0 0 0 3px rgba(79,158,255,0.15); }
  .simple-pdf-total {
    min-width: 18px;
    font-size: 13px;
    font-weight: 700;
    color: #4b5563;
    font-variant-numeric: tabular-nums;
  }
  .simple-pdf-total::before {
    content: '/';
    margin-right: 7px;
    color: #8c94a1;
    font-weight: 500;
  }
  .simple-pdf-divider { width: 1px; height: 22px; background: #d9dee7; margin: 0 1px; }
  .simple-pdf-fit {
    height: 28px;
    padding: 0 10px;
    border: none;
    border-radius: 7px;
    background: rgba(15,23,42,0.06);
    color: #475569;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
  }
  .simple-pdf-fit:hover { background: rgba(15,23,42,0.1); color: #1f2937; }

  .audio-card {
    display: flex; flex-direction: column; align-items: center; gap: 8px;
    padding: 28px 32px; background: #17181b; border: 1px solid rgba(255,255,255,0.08);
    border-radius: 14px; min-width: 320px; box-shadow: 0 10px 30px rgba(0,0,0,0.35);
  }
  .audio-icon { color: #9a9ba1; margin-bottom: 4px; }
  .audio-name { font-size: 13.5px; font-weight: 500; max-width: 280px; text-align: center; word-break: break-word; }
  .audio-meta { font-size: 11.5px; color: #83848a; }
  .audio-native-element {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }
  .custom-audio-player {
    width: min(420px, calc(100vw - 96px));
    min-height: 50px;
    display: grid;
    grid-template-columns: 38px 42px minmax(86px, 1fr) 42px 28px;
    align-items: center;
    gap: 9px;
    margin-top: 8px;
    padding: 8px 12px;
    border-radius: 999px;
    background: rgba(255,255,255,0.07);
    border: 1px solid rgba(255,255,255,0.1);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.05), 0 14px 30px rgba(0,0,0,0.22);
  }
  .audio-play-button {
    width: 34px;
    height: 34px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 999px;
    color: #f8fafc;
    background: linear-gradient(135deg, #2563eb, #7c3aed);
    cursor: pointer;
    box-shadow: 0 8px 18px rgba(49,85,255,0.28);
  }
  .audio-play-button:hover { filter: brightness(1.08); }
  .audio-volume-button {
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 999px;
    color: #dbe4f0;
    background: rgba(255,255,255,0.08);
    cursor: pointer;
  }
  .audio-volume-button:hover { background: rgba(255,255,255,0.13); color: #fff; }
  .audio-volume-control {
    position: relative;
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    isolation: isolate;
  }
  .audio-volume-control::before {
    content: '';
    position: absolute;
    left: -8px;
    right: -8px;
    bottom: 100%;
    height: 10px;
  }
  .audio-volume-popover {
    position: absolute;
    left: 50%;
    bottom: calc(100% + 8px);
    width: 38px;
    height: 108px;
    display: block;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 999px;
    background: rgba(29,30,35,0.96);
    box-shadow: 0 12px 28px rgba(0,0,0,0.38);
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transform: translate(-50%, 5px) scale(0.96);
    transform-origin: bottom center;
    transition: opacity .14s ease, transform .18s ease, visibility .14s ease;
    z-index: 20;
  }
  .audio-volume-control:hover .audio-volume-popover {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transform: translate(-50%, 0) scale(1);
  }
  .audio-time {
    color: #cfd3dc;
    font-size: 11px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }
  .audio-progress {
    width: 100%;
    height: 18px;
    appearance: none;
    -webkit-appearance: none;
    background: transparent;
    cursor: pointer;
  }
  .audio-progress::-webkit-slider-runnable-track {
    height: 5px;
    border-radius: 999px;
    background: linear-gradient(90deg, #7c3aed 0%, #2563eb var(--audio-progress), rgba(255,255,255,0.18) var(--audio-progress), rgba(255,255,255,0.18) 100%);
  }
  .audio-progress::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 14px;
    height: 14px;
    margin-top: -4.5px;
    border-radius: 999px;
    background: #f8fafc;
    border: 2px solid #7c3aed;
    box-shadow: 0 4px 10px rgba(0,0,0,0.28);
  }
  .audio-progress::-moz-range-track {
    height: 5px;
    border-radius: 999px;
    background: rgba(255,255,255,0.18);
  }
  .audio-progress::-moz-range-progress {
    height: 5px;
    border-radius: 999px;
    background: linear-gradient(90deg, #7c3aed, #2563eb);
  }
  .audio-progress::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border-radius: 999px;
    background: #f8fafc;
    border: 2px solid #7c3aed;
    box-shadow: 0 4px 10px rgba(0,0,0,0.28);
  }
  .audio-volume {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 78px;
    height: 18px;
    margin: 0;
    appearance: none;
    -webkit-appearance: none;
    background: transparent;
    cursor: pointer;
    transform: translate(-50%, -50%) rotate(-90deg);
    transform-origin: center;
  }
  .audio-volume::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 999px;
    background: linear-gradient(90deg, #93c5fd 0%, #a78bfa var(--audio-volume), rgba(255,255,255,0.16) var(--audio-volume), rgba(255,255,255,0.16) 100%);
  }
  .audio-volume::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 12px;
    height: 12px;
    margin-top: -4px;
    border-radius: 999px;
    background: #f8fafc;
    border: 2px solid #8b5cf6;
    box-shadow: 0 4px 10px rgba(0,0,0,0.28);
  }
  .audio-volume::-moz-range-track {
    height: 4px;
    border-radius: 999px;
    background: rgba(255,255,255,0.16);
  }
  .audio-volume::-moz-range-progress {
    height: 4px;
    border-radius: 999px;
    background: linear-gradient(90deg, #93c5fd, #a78bfa);
  }
  .audio-volume::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border-radius: 999px;
    background: #f8fafc;
    border: 2px solid #8b5cf6;
    box-shadow: 0 4px 10px rgba(0,0,0,0.28);
  }

  .bottom-toolbar {
    position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%);
    display: flex; align-items: center; gap: 4px; padding: 6px 10px;
    background: rgba(18,18,20,0.82); backdrop-filter: blur(10px);
    border: 1px solid rgba(255,255,255,0.09); border-radius: 12px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4); z-index: 6;
  }
  .toolbar-btn {
    width: 30px; height: 30px; display: flex; align-items: center; justify-content: center;
    background: transparent; border: none; border-radius: 6px; color: #d3d4d8; cursor: pointer;
    transition: background-color .15s ease;
  }
  .toolbar-btn:hover { background: rgba(255,255,255,0.1); color: #fff; }
  .toolbar-divider { width: 1px; height: 18px; background: rgba(255,255,255,0.1); margin: 0 3px; }
  .zoom-value { font-size: 12px; min-width: 42px; text-align: center; font-variant-numeric: tabular-nums; color: #cfd0d4; }

  .thumb-strip {
    display: flex; align-items: center; background: #17181b; border-top: 1px solid rgba(255,255,255,0.07);
    padding: 6px 8px; gap: 6px;
  }
  .thumb-strip.collapsed { padding: 4px 8px; }
  .thumb-toggle {
    width: 24px; height: 24px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
    background: transparent; border: none; border-radius: 6px; color: #9a9ba1; cursor: pointer;
  }
  .thumb-toggle:hover { background: rgba(255,255,255,0.08); color: #fff; }
  .thumb-track { display: flex; gap: 6px; overflow-x: auto; padding: 2px; scrollbar-width: thin; }
  .thumb-track::-webkit-scrollbar { height: 6px; }
  .thumb-track::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 4px; }
  .thumb-item {
    width: 56px; height: 56px; flex-shrink: 0; border-radius: 7px; overflow: hidden;
    border: 2px solid transparent; background: #0b0c0d; padding: 0; cursor: pointer;
    display: flex; align-items: center; justify-content: center; color: #7d7e84;
  }
  .thumb-item.active { border-color: #4f9eff; }
  .thumb-item:hover { border-color: rgba(255,255,255,0.25); }
  .thumb-item.active:hover { border-color: #4f9eff; }
  .thumb-image { width: 100%; height: 100%; object-fit: cover; pointer-events: none; }

  @media (max-width: 640px) {
    .file-meta { display: none; }
    .file-name { max-width: 160px; }
    .header-btn { width: 28px; height: 28px; }
  }
`;

export default AttachmentViewer;
