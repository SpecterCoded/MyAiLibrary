import React, { useState, useEffect, useRef } from "react";
import { Sparkles, Network, AlertCircle, RefreshCw } from "lucide-react";
import { FailedStateContainer } from "../common/FailedStateContainer";
import { SavedContentLoader, SavedContentReveal, holdSavedContentLoader } from "../common/SavedContentLoader";
import type { TranscriptItem, MindMapData } from "./types";
import { logActivity } from '../../utils/activityLogger';
import { InteractiveMindMap } from "../common/InteractiveMindMap";

interface MindMapTabProps {
  transcript: TranscriptItem[];
  resourceId: string | null;
  token: string | null;
  initialMindmap?: any | null;
  onMindmapGenerated?: (data: any) => void;
}

// ── Mermaid Mindmap Diagram Renderer ──

function MermaidMindmapRenderer({ mindmapData }: { mindmapData: any }) {
  const ref = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, width: 800, height: 600 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const originalViewBoxRef = useRef({ x: 0, y: 0, width: 800, height: 600 });

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
        if (!(window as any).__mermaid_initialized) {
          mermaid.initialize({
            startOnLoad: false,
            theme: document.documentElement.classList.contains("dark") ? "dark" : "default",
            securityLevel: "loose",
            themeVariables: {
              fontFamily: "system-ui, -apple-system, sans-serif",
            },
            flowchart: {
              padding: 32,
              htmlLabels: true,
              wrappingWidth: 300,
              nodeSpacing: 80,
              rankSpacing: 100,
              curve: 'basis',
            }
          });
          (window as any).__mermaid_initialized = true;
        }

        const lines: string[] = [
          "graph LR"
        ];

        const colors = [
          { fill: "#991b1b", stroke: "#b91c1c" }, // Red
          { fill: "#9a3412", stroke: "#c2410c" }, // Orange
          { fill: "#115e59", stroke: "#0f766e" }, // Teal
          { fill: "#701a75", stroke: "#86198f" }, // Purple
          { fill: "#1e3a8a", stroke: "#1d4ed8" }, // Indigo
          { fill: "#065f46", stroke: "#047857" }, // Green
        ];

        lines.push("  classDef root fill:#334155,stroke:#475569,stroke-width:2px,color:#fff;");
        colors.forEach((col, idx) => {
          lines.push(`  classDef cat${idx} fill:${col.fill},stroke:${col.stroke},stroke-width:1.5px,color:#fff,rx:8px,ry:8px;`);
        });

        let rootNode = mindmapData;
        if (!mindmapData.children && mindmapData.subtopics) {
          rootNode = {
            title: mindmapData.title || "Study Map",
            children: mindmapData.subtopics.map((sub: any) => ({
              title: sub.topic,
              children: (sub.details || []).map((d: any) => ({
                title: typeof d === "string" ? d : (d.title || "")
              }))
            }))
          };
        }

        const rootTitle = `${rootNode.title || "Study Map"}\u00A0\u00A0\u00A0`;
        lines.push(`  Root(["${rootTitle.replace(/"/g, '\\"')}"]):::root`);

        const children = rootNode.children || [];
        const half = Math.ceil(children.length / 2);

        children.forEach((category: any, cIdx: number) => {
          const catId = `Cat${cIdx}`;
          const catTitle = `${category.title || category.topic || "Category"}\u00A0\u00A0\u00A0`;
          const catClass = `cat${cIdx % colors.length}`;

          lines.push(`  ${catId}["${catTitle.replace(/"/g, '\\"')}"]:::${catClass}`);

          if (cIdx < half) {
            lines.push(`  ${catId} --> Root`);
          } else {
            lines.push(`  Root --> ${catId}`);
          }

          const details = category.children || [];
          details.forEach((detail: any, dIdx: number) => {
            const detId = `Det${cIdx}_${dIdx}`;
            const detTitle = `${detail.title || detail.topic || ""}\u00A0\u00A0\u00A0`;
            if (!detTitle.trim()) return;

            lines.push(`  ${detId}["${detTitle.replace(/"/g, '\\"')}"]:::${catClass}`);

            if (cIdx < half) {
              lines.push(`  ${detId} --> ${catId}`);
            } else {
              lines.push(`  ${catId} --> ${detId}`);
            }

            const subDetails = detail.children || [];
            subDetails.forEach((sub: any, sIdx: number) => {
              const subId = `Sub${cIdx}_${dIdx}_${sIdx}`;
              const subTitle = `${sub.title || ""}\u00A0\u00A0\u00A0`;
              if (!subTitle.trim()) return;

              lines.push(`  ${subId}["${subTitle.replace(/"/g, '\\"')}"]:::${catClass}`);

              if (cIdx < half) {
                lines.push(`  ${subId} --> ${detId}`);
              } else {
                lines.push(`  ${detId} --> ${subId}`);
              }
            });
          });
        });

        const chartCode = lines.join("\n");

        if (ref.current) {
          ref.current.innerHTML = "";
          const id = `mermaid-mindmap-${Math.random().toString(36).substr(2, 9)}`;
          const { svg } = await mermaid.render(id, chartCode);
          ref.current.innerHTML = svg;

          const svgEl = ref.current.querySelector("svg");
          if (svgEl) {
            svgEl.style.overflow = "visible";
            svgEl.removeAttribute("width");
            svgEl.removeAttribute("height");
            svgEl.style.maxWidth = "none";
            svgEl.style.maxHeight = "none";
            svgEl.style.width = "100%";
            svgEl.style.height = "100%";

            const vb = svgEl.getAttribute("viewBox");
            if (vb) {
              const parts = vb.split(/[\s,]+/).map(Number);
              const vbW = parts[2];
              const vbH = parts[3];
              if (vbW > 0 && vbH > 0) {
                const containerEl = containerRef.current;
                if (containerEl) {
                  const cW = containerEl.clientWidth || 600;
                  const cH = containerEl.clientHeight || 550;
                  const fitScale = Math.min(cW / vbW, cH / vbH, 1) * 2.0;
                  const scaledW = vbW / fitScale;
                  const scaledH = vbH / fitScale;
                  const centeredX = (vbW - scaledW) / 2;
                  const centeredY = (vbH - scaledH) / 2;
                  const newViewBox = { x: centeredX, y: centeredY, width: scaledW, height: scaledH };
                  originalViewBoxRef.current = newViewBox;
                  setViewBox(newViewBox);
                  svgEl.setAttribute("viewBox", `${centeredX} ${centeredY} ${scaledW} ${scaledH}`);
                }
              }
            }
          }
        }
      } catch (err) {
        console.error("Mermaid rendering error:", err);
        if (ref.current) {
          ref.current.textContent = "Error rendering diagram. Please check syntax.";
        }
      }
    };

    if (mindmapData) {
      initMermaid();
    }
  }, [mindmapData]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      const zoomFactor = 1.15;
      const svgEl = ref.current?.querySelector("svg");
      if (!svgEl) return;

      setViewBox(prev => {
        const isZoomIn = e.deltaY < 0;
        const newW = isZoomIn ? prev.width / zoomFactor : prev.width * zoomFactor;
        const newH = isZoomIn ? prev.height / zoomFactor : prev.height * zoomFactor;
        const clampedW = Math.max(originalViewBoxRef.current.width * 0.01, newW);
        const clampedH = Math.max(originalViewBoxRef.current.height * 0.01, newH);
        const newX = prev.x + (prev.width - clampedW) / 2;
        const newY = prev.y + (prev.height - clampedH) / 2;
        const newVB = { x: newX, y: newY, width: clampedW, height: clampedH };
        svgEl.setAttribute("viewBox", `${newX} ${newY} ${clampedW} ${clampedH}`);
        return newVB;
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
    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const svgEl = ref.current?.querySelector("svg");
    if (!svgEl) return;

    const containerEl = containerRef.current;
    if (!containerEl) return;
    const cW = containerEl.clientWidth || 600;
    const cH = containerEl.clientHeight || 550;

    const dx = (e.clientX - dragStart.x) * (viewBox.width / cW);
    const dy = (e.clientY - dragStart.y) * (viewBox.height / cH);

    const newX = viewBox.x - dx;
    const newY = viewBox.y - dy;
    const newVB = { ...viewBox, x: newX, y: newY };
    svgEl.setAttribute("viewBox", `${newX} ${newY} ${viewBox.width} ${viewBox.height}`);
    setViewBox(newVB);
    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleMouseUpOrLeave = () => {
    setIsDragging(false);
  };

  const zoomIn = () => {
    const svgEl = ref.current?.querySelector("svg");
    if (!svgEl) return;
    setViewBox(prev => {
      const newW = prev.width / 1.2;
      const newH = prev.height / 1.2;
      const clampedW = Math.max(originalViewBoxRef.current.width * 0.01, newW);
      const clampedH = Math.max(originalViewBoxRef.current.height * 0.01, newH);
      const newX = prev.x + (prev.width - clampedW) / 2;
      const newY = prev.y + (prev.height - clampedH) / 2;
      const newVB = { x: newX, y: newY, width: clampedW, height: clampedH };
      svgEl.setAttribute("viewBox", `${newX} ${newY} ${clampedW} ${clampedH}`);
      return newVB;
    });
  };

  const zoomOut = () => {
    const svgEl = ref.current?.querySelector("svg");
    if (!svgEl) return;
    setViewBox(prev => {
      const newW = prev.width * 1.2;
      const newH = prev.height * 1.2;
      const clampedW = Math.max(originalViewBoxRef.current.width * 0.01, newW);
      const clampedH = Math.max(originalViewBoxRef.current.height * 0.01, newH);
      const newX = prev.x + (prev.width - clampedW) / 2;
      const newY = prev.y + (prev.height - clampedH) / 2;
      const newVB = { x: newX, y: newY, width: clampedW, height: clampedH };
      svgEl.setAttribute("viewBox", `${newX} ${newY} ${clampedW} ${clampedH}`);
      return newVB;
    });
  };

  const resetZoom = () => {
    const svgEl = ref.current?.querySelector("svg");
    if (!svgEl) return;
    const orig = originalViewBoxRef.current;
    svgEl.setAttribute("viewBox", `${orig.x} ${orig.y} ${orig.width} ${orig.height}`);
    setViewBox({ ...orig });
  };

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUpOrLeave}
      onMouseLeave={handleMouseUpOrLeave}
      className="relative my-4 w-full h-[550px] rounded-2xl bg-[#FAF9F9] dark:bg-slate-900/50 overflow-hidden cursor-grab active:cursor-grabbing select-none mermaid-viewer"
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
          className="p-1 hover:bg-slate-150 dark:hover:bg-slate-750 cursor-pointer font-bold text-xs w-6 h-6 flex items-center justify-center border-none outline-none bg-transparent"
          title="Zoom In"
        >
          ＋
        </button>
        <button
          type="button"
          onClick={zoomOut}
          className="p-1 hover:bg-slate-150 dark:hover:bg-slate-750 cursor-pointer font-bold text-xs w-6 h-6 flex items-center justify-center border-none outline-none bg-transparent"
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

      <div
        ref={ref}
        className="w-full h-full flex items-center justify-center animate-fade-in"
      />
    </div>
  );
}

export default function MindMapTab({ transcript, resourceId, token, initialMindmap, onMindmapGenerated }: MindMapTabProps) {
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingMode, setLoadingMode] = useState<"saved" | "generate" | null>(
    initialMindmap !== undefined
      ? (initialMindmap ? "saved" : "generate")
      : "saved"
  );
  const isFetchingRef = useRef(false);
  const [mindmap, setMindmap] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wasSavedLoad, setWasSavedLoad] = useState(false);

  const fetchMindMap = async (forceRegenerate = false) => {
    if (!resourceId || !token) return;
    // Prevent double-invocation (e.g. React Strict Mode) for the initial auto-fetch
    if (!forceRegenerate && isFetchingRef.current) return;
    isFetchingRef.current = true;

    setLoading(true);
    setLoadingMode(forceRegenerate ? "generate" : "saved");
    setWasSavedLoad(!forceRegenerate);
    setError(null);

    try {
      if (!forceRegenerate) {
        const savedLoadStartedAt = Date.now();

        // Shortcut 1: parent pre-fetched and found data — use it, skip GET entirely
        if (initialMindmap) {
          await holdSavedContentLoader(savedLoadStartedAt);
          setMindmap(initialMindmap);
          setLoading(false);
          isFetchingRef.current = false;
          return;
        }

        // Shortcut 2: parent confirmed no data — skip GET, go straight to generate
        if (initialMindmap === null) {
          setLoadingMode("generate");
        } else {
          // undefined: pre-fetch not done — normal GET with CSS fade-in fallback
          // 1. Try GET first
          const getResponse = await fetch(`/resources/${resourceId}/mindmap`, {
            headers: { "Authorization": `Bearer ${token}` },
          });

          if (getResponse.ok) {
            const getData = await getResponse.json();
            if (getData) {
              await holdSavedContentLoader(savedLoadStartedAt);
              setMindmap(getData);
              setLoading(false);
              isFetchingRef.current = false;
              return;
            }
          }

          // 2. POST generate
          setLoadingMode("generate");
        }
        logActivity('ai_features', 'Generating mind map');
        const postResponse = await fetch(`/resources/${resourceId}/generate-mindmap`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${token}` },
        });

        if (!postResponse.ok) {
          throw new Error("Failed to load mind map.");
        }

        const data = await postResponse.json();
        if (data) {
          setMindmap(data);
          onMindmapGenerated?.(data);
        } else {
          throw new Error("Mind map formatting not compatible.");
        }
      } else {
        // Force regenerate
        const postResponse = await fetch(`/resources/${resourceId}/regenerate-mindmap`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${token}` },
        });

        if (!postResponse.ok) {
          throw new Error("Failed to regenerate mind map.");
        }

        const data = await postResponse.json();
        if (data) {
          setMindmap(data);
          onMindmapGenerated?.(data);
        } else {
          throw new Error("Failed to regenerate mind map.");
        }
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to make custom mind map.");
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
      // NOTE: setLoadingMode is intentionally NOT reset to null here.
      // Resetting it caused a flicker: the extra render with loadingMode=null
      // while loading was transitioning would briefly show the wrong loader.
    }
  };

  useEffect(() => {
    if (!mindmap && resourceId && token) {
      fetchMindMap();
    }
  }, [resourceId, token]);

  if (loading) {
    if (loadingMode === "saved") {
      return <SavedContentLoader message="Opening your saved mind map..." />;
    }

    return (
      <div className="py-20 flex flex-col items-center justify-center space-y-5">
        <div className="relative w-12 h-12">
          <div className="absolute inset-0 rounded-full border-3 border-neutral-100"></div>
          <div className="absolute inset-0 rounded-full border-3 border-neutral-800 border-t-transparent animate-spin"></div>
        </div>
        <div className="text-center space-y-2">
          <p className="text-base font-bold text-neutral-800">Graphing conceptual relations...</p>
          <p className="text-sm text-neutral-400">Gemini is structuring the standup architecture</p>
        </div>
      </div>
    );
  }

  if (error) {
    return <FailedStateContainer message={error} onRetry={() => fetchMindMap(true)} title="Failed to load Mind Map" />;
  }

  if (!mindmap) {
    return (
      <div className="text-center py-24 bg-neutral-50 rounded-xl border border-dashed border-neutral-200">
        <Network className="w-8 h-8 text-neutral-400 mx-auto mb-3" />
        <p className="text-lg font-bold text-neutral-700">Ready to diagram the structure</p>
        <p className="text-sm text-neutral-400 mt-2 max-w-xs mx-auto">
          Illustrate subtopic flows, technical blockers, and code modifications in a responsive tree.
        </p>
        <button
          onClick={() => fetchMindMap(false)}
          className="mt-6 px-6 py-2.5 bg-neutral-800 hover:bg-neutral-900 text-white font-bold text-sm rounded-full transition cursor-pointer"
        >
          Generate Concept Map
        </button>
      </div>
    );
  }

  const mindmapContent = (
    <div className="space-y-6 animate-fade-in flex-1 h-full flex flex-col min-h-0 overflow-hidden">
      <div className="flex items-center justify-between border-b border-neutral-100 pb-3.5 shrink-0">
        <div className="flex items-center space-x-2">
          <Network className="w-5 h-5 text-neutral-600 animate-pulse-slow" />
          <span className="text-base font-display font-bold text-neutral-855">
            Interactive Concept Map
          </span>
          {error && (
            <span className="text-xs font-semibold text-amber-600 flex items-center space-x-1">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>Using Standup Map</span>
            </span>
          )}
        </div>
        <button
          onClick={() => fetchMindMap(true)}
          className="p-2 hover:bg-neutral-150 rounded-lg text-neutral-600 hover:text-neutral-900 transition flex items-center space-x-1.5 text-sm font-bold cursor-pointer"
        >
          <RefreshCw className="w-4 h-4" />
          <span>Regenerate Map</span>
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        <InteractiveMindMap mindmapData={mindmap} className="aim-fill" />
      </div>
    </div>
  );

  return wasSavedLoad ? <SavedContentReveal>{mindmapContent}</SavedContentReveal> : mindmapContent;
}
