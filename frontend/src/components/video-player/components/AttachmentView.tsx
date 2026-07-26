import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import {
  Paperclip,
  Plus,
  X,
  FileText,
  Image,
  Film,
  Music,
  File,
  Trash2,
  Search,
  Loader2,
  Check,
  FolderOpen,
  Download as DownloadIcon,
  ChevronLeft,
  ChevronRight,
  Maximize2,
} from "lucide-react";
import VoiceMessageBubble from "../../FileExplorer/VoiceMessageBubble";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.react-pdf.min.mjs";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface Attachment {
  id: string;
  resource_id: string;
  chapter_id?: string | null;
  subchapter_id?: string | null;
  file_name: string;
  file_path: string;
  file_type?: string;
  file_size?: number;
  created_at?: string;
}

interface ResourceFile {
  id: string;
  title: string;
  type: string;
  file_size?: number;
  local_path?: string;
  preview_url?: string;
}

interface AttachmentViewProps {
  resourceId: string | null;
  token: string | null;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function getFileIcon(type?: string, size = 22) {
  if (!type) return <File size={size} className="text-slate-400" />;
  const t = type.toLowerCase();
  if (t.includes("pdf") || t.includes("document") || t.includes("doc"))
    return <FileText size={size} className="text-emerald-500" />;
  if (t.includes("image") || t.includes("png") || t.includes("jpg") || t.includes("jpeg") || t.includes("webp") || t.includes("gif"))
    return <Image size={size} className="text-purple-500" />;
  if (t.includes("video") || t.includes("mp4") || t.includes("mkv") || t.includes("webm") || t.includes("mov"))
    return <Film size={size} className="text-blue-500" />;
  if (t.includes("audio") || t.includes("mp3") || t.includes("wav") || t.includes("ogg") || t.includes("m4a"))
    return <Music size={size} className="text-amber-500" />;
  return <File size={size} className="text-slate-400" />;
}

function getFileIconBg(type?: string) {
  if (!type) return "bg-slate-100 dark:bg-slate-800";
  const t = type.toLowerCase();
  if (t.includes("pdf") || t.includes("document") || t.includes("doc"))
    return "bg-emerald-50 dark:bg-emerald-500/10";
  if (t.includes("image") || t.includes("png") || t.includes("jpg") || t.includes("jpeg") || t.includes("webp") || t.includes("gif"))
    return "bg-purple-50 dark:bg-purple-500/10";
  if (t.includes("video") || t.includes("mp4") || t.includes("mkv") || t.includes("webm") || t.includes("mov"))
    return "bg-blue-50 dark:bg-blue-500/10";
  if (t.includes("audio") || t.includes("mp3") || t.includes("wav") || t.includes("ogg") || t.includes("m4a"))
    return "bg-amber-50 dark:bg-amber-500/10";
  return "bg-slate-100 dark:bg-slate-800";
}

function formatFileSize(bytes?: number): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Check filename extension first — it is always more reliable than the server MIME type. */
function getFileCategory(type?: string, fileName?: string): "image" | "video" | "audio" | "pdf" | "unknown" {
  if (fileName) {
    const ext = (fileName.split(".").pop() ?? "").toLowerCase();
    if (ext === "pdf") return "pdf";
    if (["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "avif"].includes(ext)) return "image";
    if (["mp4", "mkv", "webm", "mov", "avi", "m4v", "flv"].includes(ext)) return "video";
    if (["mp3", "wav", "ogg", "m4a", "aac", "flac", "opus"].includes(ext)) return "audio";
  }
  if (!type) return "unknown";
  const t = type.toLowerCase();
  if (t.includes("pdf")) return "pdf";
  if (t.includes("image") || t.includes("png") || t.includes("jpg") || t.includes("jpeg") || t.includes("webp"))
    return "image";
  if (t.includes("video") || t.includes("mp4") || t.includes("mkv") || t.includes("webm"))
    return "video";
  if (t.includes("audio") || t.includes("mp3") || t.includes("wav") || t.includes("ogg"))
    return "audio";
  return "unknown";
}

// ─────────────────────────────────────────────
// NavBtn — reusable icon button for top bar
// ─────────────────────────────────────────────

function ReactPdfAttachmentPreview({ fileUrl }: { fileUrl: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [fitWidth, setFitWidth] = useState(860);
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(0.55);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const updateWidth = () => {
      const width = element.clientWidth;
      setFitWidth(Math.max(320, Math.min(width - 48, 920)));
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const pageWidth = Math.round(fitWidth * zoom);
  const canGoPrev = pageNumber > 1;
  const canGoNext = pageNumber < numPages;

  const controlButtonStyle: React.CSSProperties = {
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 10,
    background: "rgba(255,255,255,0.08)",
    color: "#fff",
    minWidth: 38,
    height: 34,
    padding: "0 12px",
    fontSize: 12,
    fontWeight: 800,
    cursor: "pointer",
  };

  const disabledControlButtonStyle: React.CSSProperties = {
    ...controlButtonStyle,
    opacity: 0.35,
    cursor: "default",
  };

  return (
    <div
      ref={containerRef}
      className="attachment-react-pdf-viewer"
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        borderRadius: 12,
        background: "linear-gradient(180deg, #202126 0%, #17181c 100%)",
        border: "1px solid rgba(255,255,255,0.1)",
      }}
    >
      <style>{`
        .attachment-react-pdf-page-stage::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }
        .attachment-react-pdf-page-stage::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.18);
          border-radius: 999px;
          border: 2px solid rgba(31, 32, 36, 1);
        }
        .attachment-react-pdf-page-stage::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.04);
        }
        .attachment-react-pdf-viewer .react-pdf__Document {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100%;
        }
        .attachment-react-pdf-viewer .react-pdf__Page {
          border-radius: 10px;
          overflow: hidden;
          box-shadow: 0 18px 55px rgba(0, 0, 0, 0.45);
          background: white;
        }
        .attachment-react-pdf-viewer .react-pdf__Page canvas {
          display: block;
          max-width: 100%;
          height: auto !important;
        }
      `}</style>
      <div
        className="attachment-react-pdf-page-stage"
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          display: "flex",
          justifyContent: "center",
          alignItems: "flex-start",
          padding: 22,
        }}
      >
        <Document
          file={fileUrl}
          loading={
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 320, color: "rgba(255,255,255,0.55)" }}>
              <Loader2 size={28} className="animate-spin" />
            </div>
          }
          error={
            <div style={{ padding: 28, color: "rgba(255,255,255,0.7)", textAlign: "center" }}>
              Could not render this PDF.
            </div>
          }
          onLoadSuccess={({ numPages }) => {
            setNumPages(numPages);
            setPageNumber(1);
          }}
        >
          <Page
            key={`page-${pageNumber}-${pageWidth}`}
            pageNumber={pageNumber}
            width={pageWidth}
            renderAnnotationLayer
            renderTextLayer
          />
        </Document>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          padding: "10px 14px 12px",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(0,0,0,0.22)",
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          disabled={!canGoPrev}
          onClick={() => setPageNumber(prev => Math.max(1, prev - 1))}
          style={canGoPrev ? controlButtonStyle : disabledControlButtonStyle}
        >
          <ChevronLeft size={15} />
        </button>
        <span style={{ color: "rgba(255,255,255,0.72)", fontSize: 12, fontWeight: 800, minWidth: 74, textAlign: "center" }}>
          {numPages ? `${pageNumber} / ${numPages}` : "—"}
        </span>
        <button
          type="button"
          disabled={!canGoNext}
          onClick={() => setPageNumber(prev => Math.min(numPages, prev + 1))}
          style={canGoNext ? controlButtonStyle : disabledControlButtonStyle}
        >
          <ChevronRight size={15} />
        </button>
        <div style={{ width: 1, height: 22, background: "rgba(255,255,255,0.12)", margin: "0 4px" }} />
        <button
          type="button"
          onClick={() => setZoom(prev => Math.max(0.35, Number((prev - 0.1).toFixed(2))))}
          style={controlButtonStyle}
        >
          −
        </button>
        <span style={{ color: "rgba(255,255,255,0.72)", fontSize: 12, fontWeight: 800, minWidth: 48, textAlign: "center" }}>
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => setZoom(prev => Math.min(2.2, Number((prev + 0.1).toFixed(2))))}
          style={controlButtonStyle}
        >
          +
        </button>
        <button
          type="button"
          onClick={() => setZoom(0.55)}
          style={{ ...controlButtonStyle, minWidth: 54 }}
        >
          Fit
        </button>
      </div>
    </div>
  );
}

function NavBtn({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        width: 36,
        height: 36,
        borderRadius: 10,
        border: "none",
        background: disabled ? "transparent" : "rgba(255,255,255,0.08)",
        color: disabled ? "rgba(255,255,255,0.2)" : "#fff",
        cursor: disabled ? "default" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        transition: "background 0.15s",
      }}
      onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.14)"; }}
      onMouseLeave={e => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.08)"; }}
    >
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────
// TelegramLightbox
// ─────────────────────────────────────────────

interface TelegramLightboxProps {
  attachments: Attachment[];
  index: number;
  token: string | null;
  onClose: () => void;
  onIndexChange: (i: number) => void;
}

function TelegramLightbox({ attachments, index, token, onClose, onIndexChange }: TelegramLightboxProps) {
  // Map: attachment.id → blob object URL
  const [blobUrls, setBlobUrls] = useState<Record<string, string>>({});
  const [fetchErrors, setFetchErrors] = useState<Record<string, string>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [panelRect, setPanelRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const fetched = useRef<Set<string>>(new Set());
  const portalTarget = document.getElementById("myai-workspace-content") ?? document.body;
  const portalPosition = portalTarget === document.body ? "fixed" : "absolute";

  const att = attachments[index];
  const category = getFileCategory(att?.file_type, att?.file_name);
  const blobUrl = att ? blobUrls[att.id] : undefined;
  const fetchError = att ? fetchErrors[att.id] : undefined;
  const hasPrev = index > 0;
  const hasNext = index < attachments.length - 1;

  const getPortalBounds = useCallback(() => {
    if (portalTarget === document.body) {
      return { width: window.innerWidth, height: window.innerHeight };
    }
    const rect = (portalTarget as HTMLElement).getBoundingClientRect();
    return { width: rect.width || window.innerWidth, height: rect.height || window.innerHeight };
  }, [portalTarget]);

  const buildDefaultPanelRect = useCallback((expanded = false) => {
    const bounds = getPortalBounds();
    const width = expanded
      ? Math.max(720, Math.min(bounds.width - 40, 1280))
      : Math.max(620, Math.min(bounds.width * 0.74, 1040));
    const height = expanded
      ? Math.max(520, Math.min(bounds.height - 40, 880))
      : Math.max(460, Math.min(bounds.height * 0.78, 760));
    return {
      width,
      height,
      x: Math.max(20, (bounds.width - width) / 2),
      y: Math.max(20, (bounds.height - height) / 2),
    };
  }, [getPortalBounds]);

  const clampPanelRect = useCallback((rect: { x: number; y: number; width: number; height: number }) => {
    const bounds = getPortalBounds();
    const minWidth = 460;
    const minHeight = 340;
    const width = Math.min(Math.max(rect.width, minWidth), Math.max(minWidth, bounds.width - 24));
    const height = Math.min(Math.max(rect.height, minHeight), Math.max(minHeight, bounds.height - 24));
    return {
      width,
      height,
      x: Math.min(Math.max(12, rect.x), Math.max(12, bounds.width - width - 12)),
      y: Math.min(Math.max(12, rect.y), Math.max(12, bounds.height - height - 12)),
    };
  }, [getPortalBounds]);

  useEffect(() => {
    setPanelRect(buildDefaultPanelRect(false));
  }, [buildDefaultPanelRect]);

  useEffect(() => {
    const onResize = () => setPanelRect(prev => (prev ? clampPanelRect(prev) : buildDefaultPanelRect(false)));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [buildDefaultPanelRect, clampPanelRect]);

  const beginDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!panelRect) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const initial = panelRect;

    const onMove = (moveEvent: PointerEvent) => {
      setPanelRect(clampPanelRect({
        ...initial,
        x: initial.x + moveEvent.clientX - startX,
        y: initial.y + moveEvent.clientY - startY,
      }));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const beginResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!panelRect) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const initial = panelRect;

    const onMove = (moveEvent: PointerEvent) => {
      setPanelRect(clampPanelRect({
        ...initial,
        width: initial.width + moveEvent.clientX - startX,
        height: initial.height + moveEvent.clientY - startY,
      }));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // ── Authenticated blob fetch ──
  const fetchBlob = useCallback(
    async (a: Attachment, isMain: boolean) => {
      if (fetched.current.has(a.id)) return;
      if (!token) {
        setFetchErrors(prev => ({ ...prev, [a.id]: "Missing login token. Please sign in again." }));
        return;
      }
      fetched.current.add(a.id);
      setFetchErrors(prev => {
        const next = { ...prev };
        delete next[a.id];
        return next;
      });
      if (isMain) setLoadingId(a.id);
      try {
        const res = await fetch(`/attachments/${a.id}/file`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setBlobUrls(prev => ({ ...prev, [a.id]: url }));
      } catch (err) {
        console.error("Attachment fetch failed:", err);
        const message = err instanceof Error ? err.message : "Failed to load attachment";
        setFetchErrors(prev => ({ ...prev, [a.id]: message }));
        fetched.current.delete(a.id); // allow retry
      } finally {
        if (isMain) setLoadingId(null);
      }
    },
    [token]
  );

  // Fetch current slide; silently pre-fetch neighbours
  useEffect(() => {
    if (!att) return;
    fetchBlob(att, true);
    if (attachments[index - 1]) fetchBlob(attachments[index - 1], false);
    if (attachments[index + 1]) fetchBlob(attachments[index + 1], false);
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  // Revoke all blob URLs when lightbox unmounts
  useEffect(() => {
    return () => {
      // snapshot current map at unmount time
      setBlobUrls(current => {
        Object.values(current).forEach(u => URL.revokeObjectURL(u));
        return {};
      });
    };
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && hasPrev) onIndexChange(index - 1);
      else if (e.key === "ArrowRight" && hasNext) onIndexChange(index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, hasPrev, hasNext, onClose, onIndexChange]);

  if (!att) return null;
  const isPdfPreview = category === "pdf";

  // ── Media renderer ──
  const renderMedia = () => {
    if (fetchError) {
      return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, color: "#fff", textAlign: "center", maxWidth: 420 }}>
          <File size={44} color="rgba(255,255,255,0.35)" />
          <p style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Could not load attachment</p>
          <p style={{ margin: 0, color: "rgba(255,255,255,0.5)", fontSize: 12 }}>
            {fetchError}. If you just updated the code, restart the backend and try again.
          </p>
          <button
            onClick={() => fetchBlob(att, true)}
            style={{
              marginTop: 4,
              padding: "9px 18px",
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.16)",
              background: "rgba(255,255,255,0.1)",
              color: "#fff",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        </div>
      );
    }

    if (loadingId === att.id || !blobUrl) {
      return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
          <Loader2 size={36} color="rgba(255,255,255,0.35)" className="animate-spin" />
          <p style={{ color: "rgba(255,255,255,0.3)", fontSize: 13, margin: 0 }}>Loading…</p>
        </div>
      );
    }

    switch (category) {
      case "image":
        return (
          <img
            key={blobUrl}
            src={blobUrl}
            alt={att.file_name}
            style={{
              maxWidth: "min(100%, 1120px)",
              maxHeight: "100%",
              objectFit: "contain",
              borderRadius: 8,
              display: "block",
              boxShadow: "0 8px 60px rgba(0,0,0,0.6)",
            }}
          />
        );

      case "video":
        return (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            key={blobUrl}
            src={blobUrl}
            controls
            autoPlay
            style={{
              maxWidth: "min(100%, 1120px)",
              maxHeight: "100%",
              borderRadius: 8,
              background: "#000",
              boxShadow: "0 8px 60px rgba(0,0,0,0.6)",
            }}
          />
        );

      case "audio":
        return (
          <div
            style={{
              width: "min(520px, 88vw)",
              borderRadius: 28,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "linear-gradient(180deg, rgba(255,255,255,0.075), rgba(255,255,255,0.035))",
              boxShadow: "0 24px 90px rgba(0,0,0,0.55)",
              padding: 28,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 18,
            }}
          >
            <div
              style={{
                width: 74,
                height: 74,
                borderRadius: 24,
                background: "linear-gradient(135deg, rgba(129,140,248,0.95), rgba(168,85,247,0.9))",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 18px 52px rgba(129,140,248,0.28)",
              }}
            >
              <Music size={34} color="#fff" />
            </div>
            <div style={{ textAlign: "center", minWidth: 0 }}>
              <p style={{ color: "#fff", fontSize: 15, fontWeight: 800, maxWidth: 430, textAlign: "center", opacity: 0.95, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {att.file_name}
              </p>
              <p style={{ color: "rgba(255,255,255,0.42)", fontSize: 12, fontWeight: 600, margin: "5px 0 0" }}>
                audio · {formatFileSize(att.file_size)}
              </p>
            </div>
            <VoiceMessageBubble
              key={blobUrl}
              audioSrc={blobUrl}
              bubbleColor="rgba(255,255,255,0.08)"
              waveColor="#a78bfa"
              className="w-full min-w-0 border border-white/10"
            />
          </div>
        );

      case "pdf":
        return (
          <ReactPdfAttachmentPreview key={blobUrl} fileUrl={blobUrl} />
        );

      default:
        return (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
            <div
              style={{
                width: 100,
                height: 100,
                borderRadius: 22,
                background: "rgba(255,255,255,0.07)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <File size={46} color="rgba(255,255,255,0.3)" />
            </div>
            <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 13, margin: 0 }}>Preview not available</p>
            <a
              href={blobUrl}
              download={att.file_name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 24px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.1)",
                color: "#fff",
                fontSize: 13,
                fontWeight: 700,
                textDecoration: "none",
                border: "1px solid rgba(255,255,255,0.14)",
              }}
            >
              <DownloadIcon size={14} /> Download
            </a>
          </div>
        );
    }
  };

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      style={{
        position: portalPosition,
        inset: 0,
        zIndex: 999999,
        pointerEvents: "auto",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(2,6,23,0.92)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          pointerEvents: "auto",
        }}
        onClick={onClose}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          borderRadius: 0,
          border: "none",
          background: "rgba(8,10,18,0.96)",
          boxShadow: "none",
          backdropFilter: "none",
          WebkitBackdropFilter: "none",
          pointerEvents: "auto",
        }}
        onClick={e => e.stopPropagation()}
      >
      {/* ════════════════════════════════════════
          TOP NAVBAR — separate from media area
          ════════════════════════════════════════ */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 14px",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          background: "rgba(255,255,255,0.03)",
          flexShrink: 0,
          userSelect: "none",
          cursor: "default",
        }}
      >
        {/* Close */}
        <div onPointerDown={e => e.stopPropagation()}>
          <NavBtn onClick={onClose} title="Close (Esc)">
            <X size={18} />
          </NavBtn>
        </div>

        {/* File icon + name + meta */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 7,
              background: "rgba(255,255,255,0.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {getFileIcon(att.file_type, 14)}
          </div>
          <div style={{ minWidth: 0 }}>
            <p
              style={{
                margin: 0,
                color: "#fff",
                fontSize: 13,
                fontWeight: 700,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {att.file_name}
            </p>
            <p style={{ margin: 0, color: "rgba(255,255,255,0.38)", fontSize: 11 }}>
              {formatFileSize(att.file_size)} &nbsp;·&nbsp; {index + 1} / {attachments.length}
            </p>
          </div>
        </div>

        {/* Prev / Next */}
        <NavBtn onClick={() => onIndexChange(index - 1)} disabled={!hasPrev} title="Previous (←)">
          <ChevronLeft size={16} />
        </NavBtn>
        <NavBtn onClick={() => onIndexChange(index + 1)} disabled={!hasNext} title="Next (→)">
          <ChevronRight size={16} />
        </NavBtn>

        {/* Download / expand */}
        <div onPointerDown={e => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {blobUrl ? (
            <a
              href={blobUrl}
              download={att.file_name}
              title="Download"
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: "rgba(255,255,255,0.08)",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                textDecoration: "none",
                flexShrink: 0,
              }}
            >
              <DownloadIcon size={15} />
            </a>
          ) : (
            <NavBtn disabled title="Download">
              <DownloadIcon size={15} />
            </NavBtn>
          )}
        </div>
      </div>

      {/* ════════════════════════════════════════
          MEDIA AREA — click backdrop to close
          ════════════════════════════════════════ */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          padding: isPdfPreview ? 14 : 22,
          cursor: "default",
          overflow: "hidden",
          background:
            "radial-gradient(circle at 18% 18%, rgba(255,255,255,0.04), transparent 24%), radial-gradient(circle at 82% 36%, rgba(255,255,255,0.035), transparent 26%)",
        }}
      >
        {/* Media content — stop-propagation so clicking media doesn't close */}
        <div
          onClick={e => e.stopPropagation()}
          style={{
            width: "100%",
            height: "100%",
            maxWidth: "100%",
            maxHeight: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={att.id + (blobUrl ? "-ready" : "-loading")}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.14 }}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "100%",
                height: "100%",
                maxWidth: "100%",
                maxHeight: "100%",
                overflow: "hidden",
                borderRadius: isPdfPreview ? 12 : 0,
              }}
            >
              {renderMedia()}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* ← Large left arrow */}
        <div
          onPointerDown={beginResize}
          title="Resize"
          style={{
            position: "absolute",
            display: "none",
            right: 6,
            bottom: 6,
            width: 18,
            height: 18,
            cursor: "nwse-resize",
            borderRight: "2px solid rgba(255,255,255,0.34)",
            borderBottom: "2px solid rgba(255,255,255,0.34)",
            borderRadius: 2,
            opacity: 0.8,
          }}
        />

        {hasPrev && (
          <button
            onClick={e => { e.stopPropagation(); onIndexChange(index - 1); }}
            style={{
              position: "absolute",
              left: "clamp(18px, 2.2vw, 34px)",
              top: "50%",
              transform: "translateY(-50%)",
              width: 48,
              height: 48,
              borderRadius: 14,
              border: "none",
              background: "rgba(255,255,255,0.1)",
              backdropFilter: "blur(8px)",
              color: "#fff",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 10,
            }}
          >
            <ChevronLeft size={26} />
          </button>
        )}

        {/* → Large right arrow */}
        {hasNext && (
          <button
            onClick={e => { e.stopPropagation(); onIndexChange(index + 1); }}
            style={{
              position: "absolute",
              right: "clamp(18px, 2.2vw, 34px)",
              top: "50%",
              transform: "translateY(-50%)",
              width: 48,
              height: 48,
              borderRadius: 14,
              border: "none",
              background: "rgba(255,255,255,0.1)",
              backdropFilter: "blur(8px)",
              color: "#fff",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 10,
            }}
          >
            <ChevronRight size={26} />
          </button>
        )}
      </div>
      </div>
    </motion.div>,
    portalTarget
  );
}

// ─────────────────────────────────────────────
// Main AttachmentView
// ─────────────────────────────────────────────

export function AttachmentView({ resourceId, token }: AttachmentViewProps) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const detachedViewerUrlsRef = useRef<Record<string, string>>({});

  const fetchAttachments = async () => {
    if (!resourceId || !token) return;
    setLoading(true);
    try {
      const res = await fetch(`/resources/${resourceId}/attachments`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAttachments(data);
      }
    } catch (err) {
      console.error("Failed to load attachments:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAttachments();
  }, [resourceId, token]);

  useEffect(() => {
    return () => {
      Object.values(detachedViewerUrlsRef.current).forEach(url => URL.revokeObjectURL(url));
      detachedViewerUrlsRef.current = {};
    };
  }, []);

  const getDesktopAttachmentKind = (attachment: Attachment): DesktopAttachmentKind => {
    const category = getFileCategory(attachment.file_type, attachment.file_name);
    return category === "unknown" ? "image" : category;
  };

  const getDetachedViewerUrl = async (attachment: Attachment): Promise<string> => {
    const existing = detachedViewerUrlsRef.current[attachment.id];
    if (existing) return existing;
    if (!token) throw new Error("Missing login token");

    const response = await fetch(`/attachments/${attachment.id}/file`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    detachedViewerUrlsRef.current[attachment.id] = url;
    return url;
  };

  const getDetachedViewerSourcePath = async (attachment: Attachment): Promise<string | undefined> => {
    if (!token) return attachment.file_path || undefined;
    try {
      const response = await fetch(`/attachments/${attachment.id}/local-path`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return attachment.file_path || undefined;
      const payload = await response.json();
      return typeof payload?.path === "string" && payload.path ? payload.path : attachment.file_path || undefined;
    } catch {
      return attachment.file_path || undefined;
    }
  };

  const openAttachmentPreview = async (index: number) => {
    if (!attachments[index]) return;

    if (!window.desktopAttachments) {
      setPreviewIndex(index);
      return;
    }

    try {
      const viewerItems = await Promise.all(
        attachments.map(async attachment => ({
          id: attachment.id,
          kind: getDesktopAttachmentKind(attachment),
          name: attachment.file_name,
          url: await getDetachedViewerUrl(attachment),
          mimeType: attachment.file_type,
          size: attachment.file_size,
          sourcePath: await getDetachedViewerSourcePath(attachment),
        }))
      );
      window.desktopAttachments.openViewer({
        attachments: viewerItems,
        activeIndex: index,
      });
    } catch (error) {
      console.error("Failed to open detached attachment viewer:", error);
      setPreviewIndex(index);
    }
  };

  const handleRemove = async (attachmentId: string) => {
    if (!token) return;
    try {
      const res = await fetch(`/attachments/${attachmentId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setAttachments(prev => prev.filter(a => a.id !== attachmentId));
        if (previewIndex !== null) setPreviewIndex(null);
      }
    } catch (err) {
      console.error("Failed to remove attachment:", err);
    }
  };

  const handleAttach = async (file: ResourceFile) => {
    if (!resourceId || !token) return;
    try {
      const fileRes = await fetch(`/resources/${file.id}/file`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!fileRes.ok) throw new Error("Failed to fetch file");

      const blob = await fileRes.blob();
      const formData = new FormData();
      formData.append("file", blob, file.title);

      const res = await fetch(`/attachments/upload?resource_id=${resourceId}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (res.ok) {
        const newAttachment = await res.json();
        setAttachments(prev => [...prev, newAttachment]);
      }
    } catch (err) {
      console.error("Failed to attach file:", err);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden px-1">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 px-1">
        <div className="flex items-center gap-2">
          <FolderOpen size={16} className="text-slate-400" />
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Resources</span>
          <span className="text-[10px] font-bold text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded-full">
            {attachments.length}
          </span>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#1a1a1a] dark:bg-white text-white dark:text-slate-900 text-[11px] font-bold hover:scale-105 transition-all cursor-pointer shadow-sm"
        >
          <Plus size={13} strokeWidth={3} />
          Add File
        </button>
      </div>

      {/* Grid */}
      {attachments.length > 0 ? (
        <div className="flex-1 overflow-y-auto no-scrollbar">
          <div className="grid grid-cols-2 gap-3">
            {attachments.map((att, idx) => (
              <div
                key={att.id}
                onClick={() => void openAttachmentPreview(idx)}
                className="group relative flex flex-col items-center p-4 border border-slate-100 dark:border-white/5 bg-slate-50/30 dark:bg-slate-900/20 rounded-2xl hover:bg-slate-50/60 dark:hover:bg-slate-800/30 hover:border-slate-200 dark:hover:border-white/10 transition-all duration-200 cursor-pointer"
              >
                <button
                  onClick={e => { e.stopPropagation(); handleRemove(att.id); }}
                  className="absolute top-2 right-2 p-1 rounded-lg opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all cursor-pointer z-10"
                  title="Remove attachment"
                >
                  <Trash2 size={12} />
                </button>

                <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-3 ${getFileIconBg(att.file_type)}`}>
                  {getFileIcon(att.file_type)}
                </div>

                <p className="text-[11.5px] font-bold text-slate-800 dark:text-slate-200 text-center line-clamp-2 leading-tight mb-1 w-full">
                  {att.file_name}
                </p>

                <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500">
                  {formatFileSize(att.file_size)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center py-12">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
            <Paperclip size={24} className="text-slate-300 dark:text-slate-600" />
          </div>
          <p className="text-sm font-semibold text-slate-400 dark:text-slate-500 mb-1">No attachments yet</p>
          <p className="text-xs text-slate-400 dark:text-slate-600 mb-4">Add files from your Resources folder</p>
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#1a1a1a] dark:bg-white text-white dark:text-slate-900 text-xs font-bold hover:scale-105 transition-all cursor-pointer"
          >
            <Plus size={14} strokeWidth={3} />
            Add File
          </button>
        </div>
      )}

      {/* Add File Modal */}
      {isModalOpen && (
        <AttachFileModal
          resourceId={resourceId}
          token={token}
          existingAttachmentIds={attachments.map(a => a.file_name)}
          onAttach={handleAttach}
          onClose={() => setIsModalOpen(false)}
        />
      )}

      {/* Telegram-style Lightbox */}
      <AnimatePresence>
        {previewIndex !== null && attachments[previewIndex] && (
          <TelegramLightbox
            attachments={attachments}
            index={previewIndex}
            token={token}
            onClose={() => setPreviewIndex(null)}
            onIndexChange={setPreviewIndex}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────
// AttachFileModal
// ─────────────────────────────────────────────

interface AttachFileModalProps {
  resourceId: string | null;
  token: string | null;
  existingAttachmentIds: string[];
  onAttach: (file: ResourceFile) => void;
  onClose: () => void;
}

function AttachFileModal({
  resourceId,
  token,
  existingAttachmentIds,
  onAttach,
  onClose,
}: AttachFileModalProps) {
  const [files, setFiles] = useState<ResourceFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [attaching, setAttaching] = useState<string | null>(null);
  const [attachedIds, setAttachedIds] = useState<Set<string>>(new Set());
  const [visibleCount, setVisibleCount] = useState(20);
  const PAGE_SIZE = 20;

  useEffect(() => {
    const fetchResources = async () => {
      if (!token || !resourceId) return;

      try {
        const detailsRes = await fetch(`/resources/${resourceId}/details`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const details = await detailsRes.json();
        const playlistId = details.resource?.playlist_id;

        if (!playlistId) return;

        const folderRes = await fetch(`/playlists/${playlistId}/resources-folder`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!folderRes.ok) return;
        const folderData = await folderRes.json();

        const filesRes = await fetch(`/folders/${folderData.folder_id}/resources`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (filesRes.ok) {
          const filesData = await filesRes.json();
          setFiles(filesData);
        }
      } catch (err) {
        console.error("Failed to load resources:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchResources();
  }, [resourceId, token]);

  const filtered = files.filter(f =>
    f.title.toLowerCase().includes(search.toLowerCase())
  );
  const visibleFiles = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  const handleAttach = async (file: ResourceFile) => {
    setAttaching(file.id);
    await onAttach(file);
    setAttachedIds(prev => new Set(prev).add(file.id));
    setAttaching(null);
  };

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [search]);

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      <div
        className="relative w-full max-w-lg mx-4 bg-white dark:bg-[#2b2d31] rounded-2xl shadow-2xl border border-slate-200 dark:border-white/10 overflow-hidden flex flex-col"
        style={{ maxHeight: "min(70vh, 520px)" }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-white/5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#1a1a1a] dark:bg-white flex items-center justify-center">
              <FolderOpen size={16} className="text-white dark:text-slate-900" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Attach from Resources</h3>
              <p className="text-[10px] font-semibold text-slate-400">
                {files.length} file{files.length !== 1 ? "s" : ""} available
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-all cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search files..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs font-semibold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#ff7d54]/30 focus:border-[#ff7d54]/50 transition-all"
            />
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-4 no-scrollbar">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
            </div>
          ) : filtered.length > 0 ? (
            <>
              <div className="grid grid-cols-2 gap-2.5">
                {visibleFiles.map(file => {
                  const isAttached =
                    attachedIds.has(file.id) ||
                    existingAttachmentIds.includes(file.title);
                  return (
                    <div
                      key={file.id}
                      className={`group relative flex flex-col items-center p-3.5 rounded-xl border transition-all duration-200 ${
                        isAttached
                          ? "border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-500/5"
                          : "border-slate-100 dark:border-white/5 bg-slate-50/30 dark:bg-slate-900/20 hover:border-[#ff7d54]/30 hover:bg-slate-50/60 dark:hover:bg-slate-800/30"
                      }`}
                    >
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-2.5 ${getFileIconBg(file.type)}`}>
                        {getFileIcon(file.type)}
                      </div>

                      <p className="text-[11px] font-bold text-slate-800 dark:text-slate-200 text-center line-clamp-2 leading-tight mb-1 w-full">
                        {file.title}
                      </p>

                      <span className="text-[9.5px] font-semibold text-slate-400 dark:text-slate-500 mb-2.5">
                        {formatFileSize(file.file_size)}
                      </span>

                      {isAttached ? (
                        <div className="flex items-center gap-1 text-emerald-500 text-[10px] font-bold">
                          <Check size={12} strokeWidth={3} />
                          Attached
                        </div>
                      ) : (
                        <button
                          onClick={() => handleAttach(file)}
                          disabled={attaching === file.id}
                          className="flex items-center gap-1 px-3 py-1 rounded-full bg-[#1a1a1a] dark:bg-white text-white dark:text-slate-900 text-[10px] font-bold hover:scale-105 transition-all cursor-pointer disabled:opacity-50"
                        >
                          {attaching === file.id ? (
                            <Loader2 size={10} className="animate-spin" />
                          ) : (
                            <Plus size={10} strokeWidth={3} />
                          )}
                          Attach
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {hasMore && (
                <button
                  onClick={() => setVisibleCount(prev => prev + PAGE_SIZE)}
                  className="w-full mt-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 text-xs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all cursor-pointer"
                >
                  Show more ({filtered.length - visibleCount} remaining)
                </button>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-12">
              <FileText size={24} className="text-slate-300 dark:text-slate-600 mb-3" />
              <p className="text-xs font-semibold text-slate-400">
                {search ? "No files match your search" : "No files in Resources folder"}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
