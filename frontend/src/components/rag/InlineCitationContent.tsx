import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { ChevronRight as ChevronRightIcon } from 'lucide-react';
import type { Components } from 'react-markdown';
import type { RAGSource } from './types';

interface InlineCitationContentProps {
  text: string;
  sources?: RAGSource[];
  onOpenSource?: (source: RAGSource) => void;
  onSeek?: (seconds: number) => void;
  theme?: 'light' | 'dark';
  paragraphClassName?: string;
  listItemClassName?: string;
  boldClassName?: string;
  timestampClassName?: string;
}

function debugCitation(message: string, payload?: unknown) {
  console.log(`[InlineCitationContent] ${message}`, payload);
}

// Build a mapping from resource identity to doc number (1-based)
function buildResourceDocMap(sources: RAGSource[]): Map<string, number> {
  const resourceDocMap = new Map<string, number>();
  let docCounter = 1;
  for (const source of sources) {
    const key = String(source.resource_id || source.resource_title || source.resource_path || '').trim().toLowerCase();
    if (key && !resourceDocMap.has(key)) {
      resourceDocMap.set(key, docCounter++);
    }
  }
  return resourceDocMap;
}

// Get the doc number for a source
function getDocNumber(source: RAGSource, resourceDocMap: Map<string, number>): string {
  const key = String(source.resource_id || source.resource_title || source.resource_path || '').trim().toLowerCase();
  return String(resourceDocMap.get(key) || 1);
}

export function hasInlineCitationMarkers(text: string): boolean {
  return /\(\s*(?:\[(\d+)\]|([Cc]hunk)\s+(\d+))\s*\)|\[(\d+)\]|\b([Cc]hunk)\s+(\d+)\b/.test(text);
}

// ── Extract plain text from ReactMarkdown children (may be string, array, or React element) ──
function extractText(children: any): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(extractText).join('');
  if (children?.props?.children) return extractText(children.props.children);
  return '';
}

// ── Sanitize LLM-generated mermaid code before rendering ──
function sanitizeMermaid(code: string): string {
  let fixed = code;
  // Strip markdown code fences if the LLM included them
  fixed = fixed.replace(/^```(?:mermaid)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  // Decode HTML entities that ReactMarkdown/rehype-raw inject into code blocks
  fixed = fixed.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  // Remove any stray HTML tags that break mermaid parsing (except <br/>)
  fixed = fixed.replace(/<(?!br\/?>)[^>]+>/g, '');
  return fixed.trim();
}

// ── Mermaid Diagram Renderer ──
function MermaidRenderer({ 
  chartCode, 
}: { 
  chartCode: string; 
}) {
  const ref = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    const initMermaid = async () => {
      try {
        if (!(window as any).mermaid) {
          await new Promise<void>((resolve, reject) => {
            const script = document.createElement("script");
            script.src = "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js";
            script.onload = () => resolve();
            script.onerror = () => reject(new Error("Failed to load mermaid"));
            document.head.appendChild(script);
          });
        }
        
        const mermaid = (window as any).mermaid;
        // Initialize only once globally to avoid state corruption
        if (!(window as any).__mermaid_initialized) {
          mermaid.initialize({
            startOnLoad: false,
            theme: document.documentElement.classList.contains("dark") ? "dark" : "default",
            securityLevel: "loose",
            flowchart: {
              htmlLabels: true,
              wrappingWidth: 300,
              nodeSpacing: 80,
              rankSpacing: 100,
              curve: 'basis',
            },
          });
          (window as any).__mermaid_initialized = true;
        }

        const cleanCode = sanitizeMermaid(chartCode);

        if (ref.current) {
          ref.current.innerHTML = "";
          const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
          let svg: string;
          try {
            ({ svg } = await mermaid.render(id, cleanCode));
          } catch (firstErr) {
            // First attempt failed — try a second time with re-init in case state was stale
            mermaid.initialize({
              startOnLoad: false,
              theme: document.documentElement.classList.contains("dark") ? "dark" : "default",
              securityLevel: "loose",
              flowchart: {
                htmlLabels: true,
                wrappingWidth: 300,
                nodeSpacing: 80,
                rankSpacing: 100,
                curve: 'basis',
              },
            });
            (window as any).__mermaid_initialized = true;
            ({ svg } = await mermaid.render(id, cleanCode));
          }
          ref.current.innerHTML = svg;
          
          const svgEl = ref.current.querySelector('svg');
          if (svgEl) {
            svgEl.style.overflow = 'visible';
            svgEl.removeAttribute('width');
            svgEl.removeAttribute('height');
            svgEl.style.maxWidth = 'none';
            svgEl.style.maxHeight = 'none';

            const viewBox = svgEl.getAttribute('viewBox');
            if (viewBox) {
              const parts = viewBox.split(/[\s,]+/).map(Number);
              const vbW = parts[2];
              const vbH = parts[3];
              if (vbW > 0 && vbH > 0) {
                svgEl.style.width  = `${vbW}px`;
                svgEl.style.height = `${vbH}px`;

                const containerEl = containerRef.current;
                if (containerEl) {
                  const cW = containerEl.clientWidth  || 600;
                  const cH = containerEl.clientHeight || 550;
                  const fitScale = Math.min(cW / vbW, cH / vbH, 1) * 0.9;
                  const clampedScale = Math.max(fitScale, 0.15);
                  const centeredX = (cW - vbW * clampedScale) / 2;
                  const centeredY = (cH - vbH * clampedScale) / 2;
                  setScale(clampedScale);
                  setOffset({ x: centeredX, y: centeredY });
                }
              }
            }
            const svgStyle = document.createElementNS('http://www.w3.org/2000/svg', 'style');
            svgStyle.textContent = [
              'foreignObject { overflow: visible; }',
              '.label foreignObject { overflow: visible; }',
              '.nodeLabel { white-space: normal !important; word-break: break-word; }',
              '.nodeLabel p { margin: 0; white-space: normal !important; }',
              '.edgeLabel { white-space: normal !important; }',
            ].join(' ');
            svgEl.insertBefore(svgStyle, svgEl.firstChild);
          }
          setRenderError(null);
        }

      } catch (err: any) {
        console.error('[MermaidRenderer] render failed:', err);
        setRenderError(String(err?.message || err));
      }
    };

    initMermaid();
  }, [chartCode]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      const zoomFactor = 1.15;
      setScale(prev => {
        const nextScale = e.deltaY < 0 ? prev * zoomFactor : prev / zoomFactor;
        return Math.max(0.2, Math.min(nextScale, 5));
      });
    };

    container.addEventListener("wheel", handleWheelNative, { passive: false });
    return () => {
      container.removeEventListener("wheel", handleWheelNative);
    };
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest(".node")) {
      return;
    }
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setOffset({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUpOrLeave = () => {
    setIsDragging(false);
  };

  const zoomIn = () => setScale(prev => Math.min(prev * 1.2, 5));
  const zoomOut = () => setScale(prev => Math.max(prev / 1.2, 0.2));
  const resetZoom = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  return (
    <div 
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUpOrLeave}
      onMouseLeave={handleMouseUpOrLeave}
      className="relative my-4 w-full h-[550px] border border-slate-150 dark:border-white/10 rounded-2xl bg-slate-50 dark:bg-slate-900/50 overflow-hidden cursor-grab active:cursor-grabbing select-none"
    >
      <style>{`
        .mermaid-viewer svg text, .mermaid-viewer svg span {
          font-family: system-ui, -apple-system, sans-serif !important;
        }
      `}</style>
      <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-white/80 dark:bg-slate-800/80 backdrop-blur-md px-2 py-1.5 rounded-full border border-slate-200/50 dark:border-white/10 z-10 shadow-xs">
        <button
          type="button"
          onClick={zoomIn}
          className="p-1 hover:bg-slate-150 dark:hover:bg-slate-350 cursor-pointer font-bold text-xs w-6 h-6 flex items-center justify-center border-none outline-none bg-transparent"
          title="Zoom In"
        >
          ＋
        </button>
        <button
          type="button"
          onClick={zoomOut}
          className="p-1 hover:bg-slate-150 dark:hover:bg-slate-350 cursor-pointer font-bold text-xs w-6 h-6 flex items-center justify-center border-none outline-none bg-transparent"
          title="Zoom Out"
        >
          －
        </button>
        <button
          type="button"
          onClick={resetZoom}
          className="px-2 py-0.5 hover:bg-slate-150 dark:hover:bg-slate-700 rounded-full text-[10px] text-slate-600 dark:text-slate-350 cursor-pointer font-bold border-none outline-none bg-transparent"
          title="Reset View"
        >
          Reset
        </button>
      </div>

      {renderError ? (
        <div className="flex items-center justify-center h-full text-center p-6">
          <div>
            <p className="text-sm font-semibold text-red-500 dark:text-red-400 mb-1">Error rendering diagram</p>
            <p className="text-xs text-gray-400 dark:text-slate-500 max-w-sm">{renderError}</p>
          </div>
        </div>
      ) : (
        <div 
          ref={ref}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transformOrigin: "top left",
            transition: isDragging ? "none" : "transform 0.15s ease-out",
            position: "absolute",
            top: 0,
            left: 0,
          }}
        />
      )}

    </div>
  );
}

// ── Citation badge ────────────────────────────────────────────────────────────
function InlineCitationBadge({
  source,
  label,
  theme,
  onOpenSource,
}: {
  source?: RAGSource | null;
  label: string;
  theme?: 'light' | 'dark';
  onOpenSource?: (source: RAGSource) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const badgeRef = useRef<HTMLSpanElement>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number; isBottom?: boolean } | null>(null);
  const badgeText = `Doc ${label}`;
  const isBadgeDark = theme === 'dark' || (!theme && typeof document !== 'undefined' && document.documentElement.classList.contains("dark"));

  const base =
    isBadgeDark
      ? 'inline-flex h-5 items-center justify-center rounded-md border border-indigo-300/20 bg-indigo-400/15 px-1.5 text-[10px] font-bold text-indigo-200 shadow-sm align-middle cursor-pointer select-none whitespace-nowrap'
      : 'inline-flex h-5 items-center justify-center rounded-md border border-indigo-100/80 bg-indigo-50 px-1.5 text-[10px] font-bold text-indigo-700 shadow-sm align-middle cursor-pointer select-none whitespace-nowrap';
  const hoverCls =
    onOpenSource && source
      ? isBadgeDark
        ? ' hover:bg-indigo-300/20 hover:text-white transition-colors cursor-pointer'
        : ' hover:bg-indigo-100 hover:text-indigo-900 transition-colors cursor-pointer'
      : '';

  const updatePosition = () => {
    if (!badgeRef.current) return;
    const rect = badgeRef.current.getBoundingClientRect();
    const tooltipWidth = 256; // w-64 is 256px
    let left = rect.left + rect.width / 2 - tooltipWidth / 2;
    let top = rect.top - 8;
    let isBottom = false;

    // Horizontal viewport clamping
    if (typeof window !== 'undefined') {
      if (left + tooltipWidth > window.innerWidth - 16) {
        left = window.innerWidth - tooltipWidth - 16;
      }
      if (left < 16) {
        left = 16;
      }
      // Vertical clamping (pop below badge if too close to viewport top)
      if (top < 150) {
        top = rect.bottom + 8;
        isBottom = true;
      }
    }

    setTooltipPos({ top, left, isBottom });
  };

  const handleMouseEnter = () => {
    updatePosition();
    setHovered(true);
    debugCitation('hovered badge', { label, hasSource: Boolean(source), source });
  };

  const handleMouseLeave = () => {
    debugCitation('mouse left badge', { label, hadSource: Boolean(source) });
    setHovered(false);
  };

  useEffect(() => {
    if (!hovered) return;
    const handleScrollOrResize = () => updatePosition();
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [hovered]);

  const badge =
    onOpenSource && source ? (
      <button type="button" onClick={() => onOpenSource(source)} className={base + hoverCls}>
        {badgeText}
      </button>
    ) : (
      <span className={base}>{badgeText}</span>
    );

  return (
    <span
      ref={badgeRef}
      className="relative inline-block mx-0.5 align-middle cursor-pointer select-none whitespace-nowrap"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {badge}
      {hovered && tooltipPos && typeof document !== 'undefined' && createPortal(
        <span
          style={{
            position: 'fixed',
            top: tooltipPos.top,
            left: tooltipPos.left,
            transform: tooltipPos.isBottom ? 'none' : 'translateY(-100%)',
          }}
          className={`pointer-events-none z-[99999] w-64 rounded-xl p-3 text-left text-xs shadow-2xl transition-opacity duration-150 ${
            isBadgeDark
              ? 'border border-white/10 bg-[#1f2229]/96 text-gray-300'
              : 'border border-gray-200/60 bg-white text-gray-600'
          }`}
        >
          {source ? (
            <>
              <span className={`flex items-center justify-between gap-1.5 pb-1 ${isBadgeDark ? 'border-b border-white/10' : 'border-b border-gray-100'}`}>
                <span className={`truncate max-w-[170px] font-semibold ${isBadgeDark ? 'text-white' : 'text-gray-800'}`}>
                  {source.resource_title || 'Untitled source'}
                </span>
                {(source.page_number != null || source.chunk_index != null) && (
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    isBadgeDark ? 'bg-indigo-400/15 text-indigo-200' : 'bg-indigo-50 text-indigo-700'
                  }`}>
                    {source.page_number != null
                      ? `Page ${source.page_number}`
                      : `Chunk ${source.chunk_index}`}
                  </span>
                )}
              </span>
              <span className={`mt-1 block text-[10px] ${isBadgeDark ? 'text-gray-500' : 'text-gray-400'}`}>
                {source.timestamp_label
                  ? `Time ${source.timestamp_label}`
                  : source.resource_path || 'Source preview'}
              </span>
              <span className={`mt-1 block line-clamp-3 text-[11px] leading-normal ${isBadgeDark ? 'text-gray-400' : 'text-gray-500'}`}>
                {source.excerpt || 'No preview available.'}
              </span>
            </>
          ) : (
            <span className={`text-[11px] italic ${isBadgeDark ? 'text-gray-500' : 'text-gray-400'}`}>
              Source information unavailable
            </span>
          )}
        </span>,
        document.body
      )}
    </span>
  );
}


// ── Inline citation parser (runs inside markdown text nodes) ──────────────────
function renderWithCitations(
  raw: string,
  sources: RAGSource[] | undefined,
  onOpenSource: ((s: RAGSource) => void) | undefined,
  onSeek: ((seconds: number) => void) | undefined,
  theme: 'light' | 'dark' | undefined,
  timestampClassName: string | undefined,
  keyPrefix: string,
  isDark: boolean,
): React.ReactNode[] {
  // Strip Chunk N / [N] markers from the raw text when there are no sources to resolve them to,
  // preventing raw metadata noise from appearing to the user. When sources exist, citation
  // resolution still runs normally and converts them to Doc badges.
  const hasSources = sources && sources.length > 0;
  const normalizedRaw = raw
    .replace(/\[\s*Doc\s*(\d+)\s*\]/gi, '[$1]')
    .replace(/\(\s*Doc\s*(\d+)\s*\)/gi, '[$1]')
    .replace(/\[\s*[Cc]hunk\s+(\d+)\s*\]/gi, hasSources ? '[$1]' : '')
    // Strip bare [N] markers entirely — replace with empty string to avoid leaving '[ ]' brackets
    .replace(/\s*\[\d+\]/g, (m) => hasSources ? m : '')
    // Clean up any empty bracket pairs left behind (e.g. '[ ]' or '[]')
    .replace(/\[\s*\]/g, '');
  const seenCitationKeys = new Set<string>();
  const normalizeNumeric = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  // Build resource-to-doc-number mapping so all chunks from same resource get one doc number
  const resourceDocMap = sources ? buildResourceDocMap(sources) : new Map<string, number>();

  const resolveCitationSource = (citationNumber: number, prefersChunkLabel: boolean): { source: RAGSource | null; docNumber: string } => {
    if (!sources || sources.length === 0 || !Number.isFinite(citationNumber)) {
      debugCitation('cannot resolve citation source because sources are missing', {
        citationNumber, prefersChunkLabel, sources,
      });
      return { source: null, docNumber: String(citationNumber) };
    }

    // 1. Best match: find a source whose chunk_index exactly equals the citation number
    const byChunkIndex = sources.find((source) => normalizeNumeric(source.chunk_index) === citationNumber);
    if (byChunkIndex) {
      debugCitation('resolved citation by chunk_index', { citationNumber, prefersChunkLabel, source: byChunkIndex });
      return { source: byChunkIndex, docNumber: getDocNumber(byChunkIndex, resourceDocMap) };
    }

    // 2. Fallback: try by array position (1-based or 0-based)
    const zeroBased = sources[citationNumber];
    const oneBased = sources[citationNumber - 1];
    const byPosition = prefersChunkLabel
      ? zeroBased ?? oneBased ?? null
      : oneBased ?? zeroBased ?? null;

    if (byPosition) {
      debugCitation('resolved citation by array position', { citationNumber, prefersChunkLabel, source: byPosition });
      return { source: byPosition, docNumber: getDocNumber(byPosition, resourceDocMap) };
    }

    // 3. Last resort: use the best (first) available source so we always show a valid Doc label
    // This ensures that if 20 chunks all come from Doc1, citation [26] still shows "Doc 1" not "Doc 26"
    const bestSource = sources[0];
    debugCitation('resolved citation using best-source fallback', { citationNumber, prefersChunkLabel, source: bestSource });
    return { source: bestSource, docNumber: getDocNumber(bestSource, resourceDocMap) };
  };

  const toTimestampSeconds = (ts: string) => {
    const parts = ts.split(':').map(Number);
    return parts.length === 3
      ? parts[0] * 3600 + parts[1] * 60 + parts[2]
      : parts[0] * 60 + parts[1];
  };

  const timestampBadgeClass = timestampClassName || (isDark
    ? 'inline-flex h-6 items-center justify-center px-2 py-0.5 mx-0.5 rounded-md border border-indigo-300/20 bg-indigo-400/15 text-[11px] font-extrabold text-indigo-200 shadow-sm align-middle select-none whitespace-nowrap'
    : 'inline-flex h-6 items-center justify-center px-2 py-0.5 mx-0.5 rounded-md border border-indigo-200/60 bg-indigo-50 text-[11px] font-extrabold text-indigo-700 shadow-sm align-middle select-none whitespace-nowrap');

  const renderTimestampBadge = (timestamp: string, key: string) => {
    if (!onSeek) {
      return (
        <span key={key} className={timestampBadgeClass}>
          {timestamp}
        </span>
      );
    }

    return (
      <button
        type="button"
        key={key}
        onClick={() => onSeek(toTimestampSeconds(timestamp))}
        className={`${timestampBadgeClass} cursor-pointer hover:bg-indigo-100 dark:hover:bg-indigo-300/25 transition`}
      >
        {timestamp}
      </button>
    );
  };

  // ── Unified single-pass regex: bold, [Chunk N], ([N]/(Chunk N)), [N], Chunk N, [mm:ss] ──
  const citationRegex =
    /\*\*([^*]+)\*\*|\[\s*([Cc]hunk)\s+(\d+)\s*\]|\(\s*(?:\[(\d+)\]|([Cc]hunk)\s+(\d+))\s*\)|\[(\d+)\]|\b([Cc]hunk)\s+(\d+)\b|\[\[\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*\]\s*\[\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*\]\]|\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*\[(\d{1,2}:\d{2}(?::\d{2})?)\]|\[(\d{1,2}:\d{2}(?::\d{2})?)\s*[\u2013\u2014\-]\s*(\d{1,2}:\d{2}(?::\d{2})?)\]|\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g;

  // ── First pass: collect ALL matches and track LAST occurrence of each citation ──
  type MatchInfo = { match: RegExpExecArray; citationIdentity?: string; isCitation: boolean };
  const allMatches: MatchInfo[] = [];
  const lastOccurrenceByCitation = new Map<string, number>();
  let m1: RegExpExecArray | null;
  // Clone the regex with a fresh lastIndex so we can run two independent passes
  const firstPassRegex = new RegExp(citationRegex.source, citationRegex.flags);

  while ((m1 = firstPassRegex.exec(normalizedRaw)) !== null) {
    const isBold = m1[1] !== undefined;
    const isTimestamp = m1[16] !== undefined;
    const isTimestampRange = m1[10] !== undefined || m1[12] !== undefined || m1[14] !== undefined;
    if (isBold || isTimestamp || isTimestampRange) {
      allMatches.push({ match: m1, isCitation: false });
      continue;
    }

    const bracketChunk = m1[2];
    const bracketChunkNum = m1[3];
    const parenBracket = m1[4];
    const parenChunk = m1[6];
    const bracket = m1[7];
    const chunk = m1[9];
    const isChunk = bracketChunk !== undefined || parenChunk !== undefined || chunk !== undefined;
    let citationNum: number | null = null;

    if (!isChunk) {
      const raw2 = parenBracket ?? bracket;
      citationNum = parseInt(raw2, 10);
    } else {
      const raw2 = bracketChunkNum ?? parenChunk ?? chunk;
      citationNum = parseInt(raw2, 10);
    }

    if (Number.isFinite(citationNum)) {
      const resolved = resolveCitationSource(citationNum!, isChunk);
      const source = resolved.source;
      const label = resolved.docNumber;
      const citationIdentity = source
        ? `${source.resource_id || source.resource_title || source.resource_path || 'source'}:${label}`
        : `label:${label}`;
      lastOccurrenceByCitation.set(citationIdentity, m1.index);
      allMatches.push({ match: m1, citationIdentity, isCitation: true });
    } else {
      allMatches.push({ match: m1, isCitation: false });
    }
  }

  // ── Second pass: render using pre-collected allMatches (no regex state dependency) ──
  const parts: React.ReactNode[] = [];
  let last = 0;

  for (const info of allMatches) {
    const match = info.match;
    const matchEnd = match.index + match[0].length; // use explicit end, not regex.lastIndex

    if (match.index > last) parts.push(normalizedRaw.slice(last, match.index));

    // **bold**
    if (match[1] !== undefined) {
      parts.push(
        <strong key={`${keyPrefix}-b-${match.index}`} className="font-semibold text-gray-900">
          {match[1]}
        </strong>,
      );
      last = matchEnd;
      continue;
    }

    // [Chunk N] / paren variants / bare Chunk N / [N] / [mm:ss]
    const bracketChunk = match[2];
    const bracketChunkNum = match[3];
    const parenBracket = match[4];
    const parenChunk = match[6];
    const bracket = match[7];
    const chunk = match[9];
    const rangeStart = match[10] ?? match[12] ?? match[14];
    const rangeEnd = match[11] ?? match[13] ?? match[15];
    const timestampStr = match[16];

    // timestamp range [mm:ss-mm:ss], [mm:ss][mm:ss], or [[mm:ss][mm:ss]]
    if (rangeStart !== undefined) {
      parts.push(
        <span key={`${keyPrefix}-tr-${match.index}`} className="inline-flex items-center gap-0.5 align-middle">
          {renderTimestampBadge(rangeStart, `${keyPrefix}-trs-${match.index}`)}
          <span className="text-gray-400 text-xs select-none">-</span>
          {renderTimestampBadge(rangeEnd!, `${keyPrefix}-tre-${match.index}`)}
        </span>,
      );
      last = matchEnd;
      continue;
    }

    // timestamp [mm:ss] or [hh:mm:ss]
    if (timestampStr !== undefined) {
      parts.push(renderTimestampBadge(timestampStr, `${keyPrefix}-t-${match.index}`));
      last = matchEnd;
      continue;
    }

    const isChunk = bracketChunk !== undefined || parenChunk !== undefined || chunk !== undefined;
    let source: RAGSource | null = null;
    let label = '';

    if (!isChunk) {
      const raw2 = parenBracket ?? bracket;
      const n = parseInt(raw2, 10);
      const resolved = resolveCitationSource(n, false);
      source = resolved.source;
      label = resolved.docNumber;
    } else {
      const raw2 = bracketChunkNum ?? parenChunk ?? chunk;
      const n = parseInt(raw2, 10);
      const resolved = resolveCitationSource(n, true);
      source = resolved.source;
      label = resolved.docNumber;
    }

    if (source || label) {
      const citationIdentity = source
        ? `${source.resource_id || source.resource_title || source.resource_path || 'source'}:${label}`
        : `label:${label}`;

      const isLastOccurrence = lastOccurrenceByCitation.get(citationIdentity) === match.index;

      if (isLastOccurrence) {
        if (!source) {
          debugCitation('rendering badge without source match', { rawMatch: match[0], label, isChunk, sources });
        }
        parts.push(
          <InlineCitationBadge
            key={`${keyPrefix}-c-${match.index}`}
            source={source}
            label={label}
            theme={theme}
            onOpenSource={onOpenSource}
          />,
        );
      }
      // Earlier occurrences: silently drop (no badge, no raw text)
    } else {
      // Cannot resolve to any citation — drop the noise marker rather than showing it
      // (e.g. "Chunk 57" or "[59]" with no matching source should never appear to the user)
    }

    last = matchEnd;
  }

  if (last < normalizedRaw.length) parts.push(normalizedRaw.slice(last));
  return parts;
}

// ── Text node processor: recursively handle ReactMarkdown children ────────────
function processChildren(
  children: React.ReactNode,
  sources: RAGSource[] | undefined,
  onOpenSource: ((s: RAGSource) => void) | undefined,
  onSeek: ((seconds: number) => void) | undefined,
  theme: 'light' | 'dark' | undefined,
  timestampClassName: string | undefined,
  keyPrefix: string,
  isDark: boolean,
): React.ReactNode {
  return React.Children.map(children, (child, i) => {
    if (typeof child === 'string') {
      return renderWithCitations(child, sources, onOpenSource, onSeek, theme, timestampClassName, `${keyPrefix}-${i}`, isDark);
    }
    if (React.isValidElement(child)) {
      const el = child as React.ReactElement<{ children?: React.ReactNode }>;
      if (el.props.children) {
        return React.cloneElement(el, {
          children: processChildren(el.props.children, sources, onOpenSource, onSeek, theme, timestampClassName, `${keyPrefix}-${i}`, isDark),
        } as Partial<typeof el.props>);
      }
    }
    return child;
  });
}

// ── Strip internal RAG citation noise from table cell children ─────────────────
// Table cells coming from GFM markdown often contain "Chunk N", "[N]", or combined
// "Chunk 57 | Chunk 58" fragments from the RAG retrieval metadata. These should
// never be visible to the user in rendered table cells.
function stripTableCellNoise(children: React.ReactNode): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child === 'string') {
      const cleaned = child
        // Remove "Chunk N" standalone markers entirely
        .replace(/\s*\b[Cc]hunk\s+\d+\b\s*/g, '')
        // Remove bracketed numbers like [26], [59], [123] — use empty string not space
        .replace(/\s*\[\d+\]\s*/g, '')
        // Clean up any empty brackets left behind (e.g. '[ ]' or '[]')
        .replace(/\[\s*\]/g, '')
        // Remove "| Chunk N" or "Chunk N |" patterns that leak from table parsing
        .replace(/\|\s*[Cc]hunk\s+\d+/g, '')
        .replace(/[Cc]hunk\s+\d+\s*\|/g, '')
        // Collapse multiple spaces to one — but do NOT trim so edge spaces are kept
        // (trimming would merge adjacent bold elements with surrounding text, e.g. 'An ' + <b>word</b> + ' or' → 'An' + <b>word</b> + 'or')
        .replace(/  +/g, ' ');
      // Only return empty string if the node is purely whitespace after stripping
      return cleaned || '';
    }
    if (React.isValidElement(child)) {
      const el = child as React.ReactElement<{ children?: React.ReactNode }>;
      if (el.props.children) {
        return React.cloneElement(el, {
          children: stripTableCellNoise(el.props.children),
        } as Partial<typeof el.props>);
      }
    }
    return child;
  });
}

// ── Convert raw <details>/<summary> HTML to a blockquote-based format
// that ReactMarkdown DOES route through the components map.
// rehypeRaw renders <details>/<summary> as native browser elements, bypassing
// the `components` overrides entirely — so we swap the tag before it gets there.
function normalizeRawDetailsMarkdown(text: string): string {
  return text.replace(
    /<details\b[^>]*>[\s\S]*?<\/details>/gi,
    block => {
      // Extract summary title
      const summaryMatch = block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
      const title = summaryMatch ? summaryMatch[1].trim() : 'Click to reveal answer';
      // Extract body (everything after </summary> up to </details>)
      const body = block
        .replace(/<details\b[^>]*>/i, '')
        .replace(/<\/details>/i, '')
        .replace(/<summary[^>]*>[\s\S]*?<\/summary>/i, '')
        .replace(/\*\*([^*\n][^*]*?)\*\*/g, '<strong>$1</strong>')
        .trim();
      // Encode title as a data attribute (escape quotes)
      const safeTitle = title.replace(/"/g, '&quot;');
      return `<blockquote data-type="reveal" data-title="${safeTitle}">${body}</blockquote>`;
    }
  );
}

// ── Convert GitHub-style alert blocks to styled HTML ────────────────────────
// > [!WARNING] / > [!CAUTION] / > [!TIP] / > [!NOTE] / > [!IMPORTANT]
// remarkGfm does NOT support these — they render as raw text in a blockquote.
// We pre-process them into inline-styled HTML so rehypeRaw can render them.
function preProcessGitHubAlerts(text: string): string {
  const alertConfig: Record<string, { emoji: string; label: string; borderColor: string; bgColor: string; headerColor: string; textColor: string }> = {
    WARNING:   { emoji: '⚠️', label: 'Warning',   borderColor: '#f59e0b', bgColor: 'rgba(254,243,199,0.12)', headerColor: '#f59e0b', textColor: '#d97706' },
    CAUTION:   { emoji: '🚫', label: 'Caution',   borderColor: '#ef4444', bgColor: 'rgba(254,226,226,0.12)', headerColor: '#ef4444', textColor: '#dc2626' },
    TIP:       { emoji: '💡', label: 'Tip',       borderColor: '#3b82f6', bgColor: 'rgba(219,234,254,0.12)', headerColor: '#60a5fa', textColor: '#93c5fd' },
    NOTE:      { emoji: '📌', label: 'Note',      borderColor: '#6366f1', bgColor: 'rgba(224,231,255,0.12)', headerColor: '#818cf8', textColor: '#a5b4fc' },
    IMPORTANT: { emoji: '🎯', label: 'Important', borderColor: '#8b5cf6', bgColor: 'rgba(237,233,254,0.12)', headerColor: '#a78bfa', textColor: '#c4b5fd' },
  };

  // Match the full alert block: first line has [!TYPE], subsequent lines start with >
  // More flexible regex to handle various formats the AI might generate
  return text.replace(
    /^>[ \t]*\[!(WARNING|CAUTION|TIP|NOTE|IMPORTANT)\][ \t]*(?:\n|$)((?:^>[ \t]?.*(?:\n|$))*)/gim,
    (_, type, contentLines) => {
      const cfg = alertConfig[type.toUpperCase()];
      if (!cfg) return _;
      const rawInner = contentLines
        .split('\n')
        .map((l: string) => l.replace(/^>[ \t]?/, ''))
        .join('\n')
        .trim();
      // Convert markdown bold/italic to HTML (they won't be parsed by ReactMarkdown
      // once they're inside a raw HTML string injected via rehypeRaw)
      const inner = rawInner
        .replace(/\*\*([^*\n][^*]*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*\n][^*]*?)\*/g, '<em>$1</em>');
      return [
        `<div style="border-left:4px solid ${cfg.borderColor};background:${cfg.bgColor};border-radius:10px;padding:12px 16px;margin:14px 0;">`,
        `<div style="display:flex;align-items:center;gap:6px;font-weight:700;font-size:13px;color:${cfg.headerColor};margin-bottom:6px;">`,
        `<span>${cfg.emoji}</span><span>${cfg.label}</span>`,
        `</div>`,
        `<div style="font-size:14px;line-height:1.7;color:${cfg.textColor};">${inner}</div>`,
        `</div>`,
      ].join('\n') + '\n\n';
    }
  );
}

// ── Also handle inline alert format without blockquote prefix ────────────────
// Some AI outputs may use: [!TIP] or [!WARNING] without the > prefix
function preProcessInlineAlerts(text: string): string {
  const alertConfig: Record<string, { emoji: string; label: string; borderColor: string; bgColor: string; headerColor: string; textColor: string }> = {
    WARNING:   { emoji: '⚠️', label: 'Warning',   borderColor: '#f59e0b', bgColor: 'rgba(254,243,199,0.12)', headerColor: '#f59e0b', textColor: '#d97706' },
    CAUTION:   { emoji: '🚫', label: 'Caution',   borderColor: '#ef4444', bgColor: 'rgba(254,226,226,0.12)', headerColor: '#ef4444', textColor: '#dc2626' },
    TIP:       { emoji: '💡', label: 'Tip',       borderColor: '#3b82f6', bgColor: 'rgba(219,234,254,0.12)', headerColor: '#60a5fa', textColor: '#93c5fd' },
    NOTE:      { emoji: '📌', label: 'Note',      borderColor: '#6366f1', bgColor: 'rgba(224,231,255,0.12)', headerColor: '#818cf8', textColor: '#a5b4fc' },
    IMPORTANT: { emoji: '🎯', label: 'Important', borderColor: '#8b5cf6', bgColor: 'rgba(237,233,254,0.12)', headerColor: '#a78bfa', textColor: '#c4b5fd' },
  };

  // Match standalone [!TYPE] markers followed by content on same or next line
  return text.replace(
    /\[!(WARNING|CAUTION|TIP|NOTE|IMPORTANT)\][ \t]*(?:\n[ \t]*(.+))?/gim,
    (_, type, content) => {
      const cfg = alertConfig[type.toUpperCase()];
      if (!cfg) return _;
      const inner = (content || '')
        .replace(/\*\*([^*\n][^*]*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*\n][^*]*?)\*/g, '<em>$1</em>');
      return [
        `<div style="border-left:4px solid ${cfg.borderColor};background:${cfg.bgColor};border-radius:10px;padding:12px 16px;margin:14px 0;">`,
        `<div style="display:flex;align-items:center;gap:6px;font-weight:700;font-size:13px;color:${cfg.headerColor};margin-bottom:6px;">`,
        `<span>${cfg.emoji}</span><span>${cfg.label}</span>`,
        `</div>`,
        inner ? `<div style="font-size:14px;line-height:1.7;color:${cfg.textColor};">${inner}</div>` : '',
        `</div>`,
      ].join('\n') + '\n\n';
    }
  );
}

export default function InlineCitationContent({
  text,
  sources,
  onOpenSource,
  onSeek,
  theme,
  timestampClassName,
}: InlineCitationContentProps) {
  const isDark = theme === 'dark' || (!theme && typeof document !== 'undefined' && document.documentElement.classList.contains("dark"));

  // Memoize the entire components map so ReactMarkdown always receives
  // stable function references. Without this, each parent re-render
  // (e.g. video currentTime tick) creates a new `code` function reference
  // → ReactMarkdown treats it as a new component type → MermaidRenderer
  // unmounts+remounts → innerHTML = "" fires → visible flicker.
  const components: Components = useMemo(() => ({
    // Headings
    h1: ({ children }) => (
      <h1 className={`mt-7 mb-3 text-2xl font-bold leading-tight tracking-tight ${isDark ? 'text-white' : 'text-gray-900'}`}>
        {processChildren(children, sources, onOpenSource, onSeek, theme, timestampClassName, 'h1', isDark)}
      </h1>
    ),
    h2: ({ children }) => (
      <h2 className={`mt-6 mb-3 flex items-center gap-3 text-[1.05rem] font-semibold leading-snug ${isDark ? 'text-white' : 'text-gray-900'}`}>
        <span className={`inline-block h-5 w-1 rounded-full ${isDark ? 'bg-indigo-300' : 'bg-indigo-500'}`} />
        <span className="flex-1">{processChildren(children, sources, onOpenSource, onSeek, theme, timestampClassName, 'h2', isDark)}</span>
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className={`mt-5 mb-2 text-base font-semibold ${isDark ? 'text-white' : 'text-gray-800'}`}>
        {processChildren(children, sources, onOpenSource, onSeek, theme, timestampClassName, 'h3', isDark)}
      </h3>
    ),
    h4: ({ children }) => (
      <h4 className={`mt-4 mb-1.5 text-xs font-semibold uppercase tracking-[0.18em] ${isDark ? 'text-gray-400' : 'text-gray-700'}`}>
        {processChildren(children, sources, onOpenSource, onSeek, theme, timestampClassName, 'h4', isDark)}
      </h4>
    ),

    // Paragraph
    p: ({ children }) => (
      <p className={`mb-3.5 text-[15px] leading-8 ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
        {processChildren(children, sources, onOpenSource, onSeek, theme, timestampClassName, 'p', isDark)}
      </p>
    ),

    // Lists
    ul: ({ children }) => (
      <ul className="mb-4 space-y-2.5 pl-0 list-none">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className={`mb-4 space-y-2.5 pl-6 list-decimal marker:font-medium ${isDark ? 'marker:text-gray-500' : 'marker:text-gray-400'}`}>{children}</ol>
    ),
    li: ({ children }) => (
      <li className={`relative pl-5 text-[15px] leading-8 ${isDark ? 'text-gray-200' : 'text-gray-700'} before:absolute before:left-0 before:top-[0.8em] before:h-1.5 before:w-1.5 before:rounded-full ${isDark ? 'before:bg-indigo-300' : 'before:bg-indigo-400'}`}>
        {processChildren(children, sources, onOpenSource, onSeek, theme, timestampClassName, 'li', isDark)}
      </li>
    ),

    // Details / Summary (Active Recall)
    details: ({ children }) => {
      const childArray = React.Children.toArray(children);
      const summaryChild = childArray[0];
      const bodyChildren = childArray.slice(1);

      return (
        <details className="my-3 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-gradient-to-br from-white via-white to-[#ff7d54]/5 dark:from-slate-800/50 dark:via-slate-800/30 dark:to-[#ff7d54]/10 overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-300 group/details open:shadow-md">
          {summaryChild}
          {bodyChildren.length > 0 && (
            <div className="mx-4 mb-4 rounded-2xl border border-slate-100 bg-white/90 px-5 py-4 text-[15px] leading-8 text-slate-700 shadow-inner dark:border-white/10 dark:bg-slate-950/30 dark:text-slate-200 [&_strong]:font-extrabold [&_strong]:text-slate-950 dark:[&_strong]:text-white [&_p:last-child]:mb-0">
              {bodyChildren}
            </div>
          )}
        </details>
      );
    },
    summary: ({ children }) => (
      <summary className="flex items-center gap-2.5 px-5 py-3 text-[13px] font-bold text-slate-600 dark:text-slate-300 cursor-pointer select-none hover:bg-[#ff7d54]/5 dark:hover:bg-[#ff7d54]/10 transition-all duration-200 list-none [&::-webkit-details-marker]:hidden rounded-t-2xl">
        <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-[#ff7d54]/10 group-open/details:bg-[#ff7d54]/20 transition-colors">
          <ChevronRightIcon className="w-3.5 h-3.5 text-[#ff7d54] transition-transform duration-300 group-open/details:rotate-90" />
        </span>
        <span className="flex-1">{children}</span>
      </summary>
    ),

    // Horizontal rule
    hr: () => <hr className={`my-6 ${isDark ? 'border-white/10' : 'border-gray-200'}`} />,

    // Blockquote — also handles converted <details> (data-type="reveal")
    // and GitHub alert blocks rendered as plain blockquotes
    blockquote: ({ children, node }) => {
      // ── Reveal accordion (converted from <details>/<summary>) ──
      // @ts-ignore — hast node properties
      const dataType = (node as any)?.properties?.dataType;
      // @ts-ignore
      const dataTitle = (node as any)?.properties?.dataTitle ?? 'Click to reveal answer';
      if (dataType === 'reveal') {
        return (
          <details className="my-3 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-gradient-to-br from-white via-white to-[#ff7d54]/5 dark:from-slate-800/50 dark:via-slate-800/30 dark:to-[#ff7d54]/10 overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-300 group/details open:shadow-md">
            <summary className="flex items-center gap-2.5 px-5 py-3 text-[13px] font-bold text-slate-600 dark:text-slate-300 cursor-pointer select-none hover:bg-[#ff7d54]/5 dark:hover:bg-[#ff7d54]/10 transition-all duration-200 list-none [&::-webkit-details-marker]:hidden rounded-t-2xl">
              <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-[#ff7d54]/10 group-open/details:bg-[#ff7d54]/20 transition-colors">
                <ChevronRightIcon className="w-3.5 h-3.5 text-[#ff7d54] transition-transform duration-300 group-open/details:rotate-90" />
              </span>
              <span className="flex-1">{dataTitle}</span>
            </summary>
            <div className="mx-4 mb-4 rounded-2xl border border-slate-100 bg-white/90 px-5 py-4 text-[15px] leading-8 text-slate-700 shadow-inner dark:border-white/10 dark:bg-slate-950/30 dark:text-slate-200 [&_strong]:font-extrabold [&_strong]:text-slate-950 dark:[&_strong]:text-white [&_p:last-child]:mb-0">
              {children}
            </div>
          </details>
        );
      }

      // ── Regular blockquote ──
      return (
        <blockquote className={`my-4 rounded-r-2xl border-l-4 pl-4 pr-1 italic text-[14.5px] leading-7 ${isDark ? 'border-indigo-300 text-gray-400' : 'border-indigo-300 text-gray-500'}`}>
          {children}
        </blockquote>
      );
    },

    // Inline code & code blocks
    code: ({ children, className }) => {
      const isBlock = className?.includes('language-');
      const rawText = extractText(children);
      const isMermaid = className?.includes('language-mermaid') || rawText.includes('graph TD') || rawText.includes('flowchart TD') || rawText.includes('flowchart LR') || rawText.includes('graph LR') || rawText.includes('sequenceDiagram') || rawText.includes('classDiagram') || rawText.includes('mindmap');
      if (isMermaid && rawText) {
        return <MermaidRenderer chartCode={rawText} />;
      }
      if (isBlock) {
        return (
          <pre className="my-4 overflow-x-auto rounded-xl bg-gray-950 p-4 font-mono text-[13px] leading-relaxed text-gray-100 shadow-inner">
            <code>{children}</code>
          </pre>
        );
      }
      return (
        <code className={`rounded px-1.5 py-0.5 text-[13px] font-mono ${isDark ? 'bg-white/10 text-indigo-200' : 'bg-gray-100 text-indigo-700'}`}>
          {children}
        </code>
      );
    },
    pre: ({ children }) => <>{children}</>,

    // Bold & italic (with citation pass-through)
    strong: ({ children }) => (
      <strong className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
        {processChildren(children, sources, onOpenSource, onSeek, theme, timestampClassName, 'strong', isDark)}
      </strong>
    ),
    em: ({ children }) => (
      <em className={`italic ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
        {processChildren(children, sources, onOpenSource, onSeek, theme, timestampClassName, 'em', isDark)}
      </em>
    ),

    // Tables (GFM)
    table: ({ children }) => (
      <div className={`my-4 overflow-x-auto rounded-xl shadow-sm ${isDark ? 'border border-white/10' : 'border border-gray-200'}`}>
        <table className="w-full text-sm text-left">{children}</table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className={`text-xs uppercase tracking-wider ${isDark ? 'border-b border-white/10 bg-white/5 text-gray-400' : 'border-b border-gray-200 bg-gray-50 text-gray-600'}`}>
        {children}
      </thead>
    ),
    tbody: ({ children }) => (
      <tbody className={isDark ? 'divide-y divide-white/10 bg-transparent' : 'divide-y divide-gray-100 bg-white'}>{children}</tbody>
    ),
    tr: ({ children }) => (
      <tr className={`transition-colors ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50'}`}>{children}</tr>
    ),
    th: ({ children }) => (
      <th className={`whitespace-nowrap px-4 py-3 font-semibold ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
        {processChildren(stripTableCellNoise(children), sources, onOpenSource, onSeek, theme, timestampClassName, 'th', isDark)}
      </th>
    ),
    td: ({ children }) => (
      <td className={`px-4 py-3 leading-relaxed ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
        {processChildren(stripTableCellNoise(children), sources, onOpenSource, onSeek, theme, timestampClassName, 'td', isDark)}
      </td>
    ),

    // GFM task-list checkboxes — make them interactive (uncontrolled)
    input: (({ type, checked }: { type?: string; checked?: boolean }) => {
      if (type === 'checkbox') {
        return (
          <input
            type="checkbox"
            defaultChecked={checked ?? false}
            className={`mr-1.5 h-3.5 w-3.5 rounded cursor-pointer accent-indigo-600 ${
              isDark ? 'border-white/30' : 'border-gray-300'
            }`}
          />
        );
      }
      return null;
    }) as Components['input'],

    // Links
    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={`underline underline-offset-2 transition-colors ${isDark ? 'text-indigo-200 hover:text-white' : 'text-indigo-600 hover:text-indigo-800'}`}
      >
        {children}
      </a>
    ),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [isDark, theme, sources, onOpenSource, onSeek, timestampClassName]);

  // Pre-sanitize table rows in the raw markdown string to strip Chunk N / [N] noise
  // before remarkGfm parses the table. This prevents the pipe-delimited content
  // like "| Chunk 57 |" from ever being tokenized into visible table cell text.
  function preSanitizeMarkdown(rawText: string): string {
    return rawText
      .split('\n')
      .map(line => {
        // Only process lines that look like GFM table rows (contain |)
        if (!line.includes('|')) return line;
        return line
          // Remove "Chunk N" markers entirely (empty string, not space)
          .replace(/\s*\b[Cc]hunk\s+\d+\b\s*/g, '')
          // Remove bare [N] citation markers entirely
          .replace(/\s*\[\d+\]\s*/g, '')
          // Clean up any '[ ]' or '[]' empty bracket leftovers
          .replace(/\[\s*\]/g, '')
          // Collapse multiple consecutive spaces to one
          .replace(/  +/g, ' ')
          // Clean up cells that are now just whitespace: '|   |' → '|  |'
          .replace(/\|\s+\|/g, '| |');
      })
      .join('\n');
  }

  return (
    <div dir="auto" className={isDark ? '[&_p:last-child]:mb-0' : 'space-y-0'}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={components}>
        {preSanitizeMarkdown(preProcessInlineAlerts(preProcessGitHubAlerts(normalizeRawDetailsMarkdown(text))))}

      </ReactMarkdown>
    </div>
  );
}
