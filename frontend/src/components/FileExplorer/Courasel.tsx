import React, { useRef, useState } from "react";
import { VideoPlayer } from './VideoPlayer';
import VoiceMessageBubble from './VoiceMessageBubble';
import { X, ChevronLeft, ChevronRight, ExternalLink, RefreshCw, Zap, PlayCircle } from "lucide-react";
import { PDFViewer } from "@embedpdf/react-pdf-viewer";
import type { ExplorerItem } from "./types";
import { ToastContainer, type ToastMessage } from "./Toast";

interface CarouselPreviewProps {
  isOpen: boolean;
  onClose: () => void;
  items: ExplorerItem[];
  initialItemId: string;
  folderPath?: string[];
}

export const CarouselPreview: React.FC<CarouselPreviewProps> = ({
  isOpen,
  onClose,
  items,
  initialItemId,
  folderPath,
}) => {
  const previewableItems = items.filter(
    (item) => item.type !== "folder"
  );

  const initialIndex = previewableItems.findIndex((item) => item.id === initialItemId);
  const [currentIndex, setCurrentIndex] = useState(initialIndex !== -1 ? initialIndex : 0);

  React.useEffect(() => {
    const idx = previewableItems.findIndex((item) => item.id === initialItemId);
    if (idx !== -1) {
      setCurrentIndex(idx);
    }
  }, [initialItemId]);

  const currentItem = previewableItems[currentIndex];
  const fileUrl = currentItem ? `/resources/${currentItem.id}/file` : "";
  const showOpenButton = currentItem ? ["pdf", "audio", "video"].includes(currentItem.type) : false;
  const [objectUrl, setObjectUrl] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [showPdfReader, setShowPdfReader] = useState<boolean>(false);
  const [embeddingStatus, setEmbeddingStatus] = useState<"idle" | "embedding" | "success" | "error">("idle");
  const [reprocessStatus, setReprocessStatus] = useState<"idle" | "processing" | "success" | "error">("idle");
  const [polledStatus, setPolledStatus] = useState<{ processing_status: string; is_embedded: boolean } | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastIdRef = useRef(0);

  const addToast = (text: string, type: ToastMessage["type"] = "info") => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, text, type }]);
  };
  const removeToast = (id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  React.useEffect(() => {
    setEmbeddingStatus("idle");
    setReprocessStatus("idle");
    setPolledStatus(null);
  }, [currentItem?.id]);

  // Poll processing status while carousel is open
  React.useEffect(() => {
    if (!isOpen || !currentItem || currentItem.type === "folder") return;
    let active = true;
    const poll = async () => {
      try {
        const token = localStorage.getItem("access_token");
        const res = await fetch(`/resources/${currentItem.id}/details`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || !active) return;
        const data = await res.json();
        const r = data.resource || data;
        setPolledStatus({
          processing_status: (r.processing_status || "").toLowerCase(),
          is_embedded: r.is_embedded === true || r.is_embedded === "true",
        });
      } catch { /* ignore polling errors */ }
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => { active = false; clearInterval(interval); };
  }, [isOpen, currentItem?.id]);

  const effectiveIsEmbedded = polledStatus?.is_embedded ?? (currentItem?.is_embedded === true || currentItem?.is_embedded === "true");
  const effectiveProcessingStatus = polledStatus?.processing_status ?? (currentItem?.processing_status || "").toLowerCase();
  const isAlreadyEmbedded = effectiveIsEmbedded;
  const normalizedProcessingStatus = effectiveProcessingStatus;
  const isProcessingComplete = normalizedProcessingStatus === "ready" || normalizedProcessingStatus === "" || normalizedProcessingStatus === "uploaded";

  // Show Process/Embed buttons only in default folders (Notes/Resources/Media) — these skip auto-processing
  const MANUAL_PROCESS_FOLDERS = ["notes", "resources", "media"];
  const canManuallyProcess = (folderPath || []).some(
    (name) => MANUAL_PROCESS_FOLDERS.includes(name.toLowerCase())
  );
  const canResume = currentItem?.type !== "folder" && [
    "failed",
    "failed_transcribing",
    "failed_summarizing",
    "failed_chaptering",
    "failed_subchaptering",
    "failed_embedding",
    "failed_indexing",
    "paused",
    "cancelled",
  ].includes(normalizedProcessingStatus);

  const handleReprocess = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setReprocessStatus("processing");
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`/resources/${currentItem.id}/reprocess`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        setReprocessStatus("success");
        addToast("Regeneration queued successfully.", "success");
      } else {
        const errData = await res.json().catch(() => ({}));
        console.error("Reprocess error:", errData);
        setReprocessStatus("error");
        addToast(errData.detail || "Failed to queue regeneration.", "error");
      }
    } catch (err) {
      console.error("Failed to reprocess resource:", err);
      setReprocessStatus("error");
      addToast("Failed to queue regeneration.", "error");
    }
  };

  const handleProcess = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setReprocessStatus("processing");
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`/resources/${currentItem.id}/reprocess`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        setReprocessStatus("success");
        addToast("Processing queued successfully.", "success");
      } else {
        const errData = await res.json().catch(() => ({}));
        console.error("Process error:", errData);
        setReprocessStatus("error");
        addToast(errData.detail || "Failed to queue processing.", "error");
      }
    } catch (err) {
      console.error("Failed to process resource:", err);
      setReprocessStatus("error");
      addToast("Failed to queue processing.", "error");
    }
  };

  const handleResume = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setReprocessStatus("processing");
    try {
      const token = localStorage.getItem('access_token');
      // Use the advanced resume endpoint which inspects the resource's actual
      // state to determine exactly which pipeline step to resume from.
      const res = await fetch(`/resources/${currentItem.id}/resume-advanced`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setReprocessStatus("success");
        addToast(`Resume queued from ${data.resume_stage || 'last step'}.`, "success");
      } else {
        const errData = await res.json().catch(() => ({}));
        console.error("Resume error:", errData);
        setReprocessStatus("error");
        addToast(errData.detail || "Failed to queue resume.", "error");
      }
    } catch (err) {
      console.error("Failed to resume resource:", err);
      setReprocessStatus("error");
      addToast("Failed to queue resume.", "error");
    }
  };

  const handleEmbedClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setEmbeddingStatus("embedding");
    addToast("Embedding and indexing started...", "info");
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`/resources/${currentItem.id}/index`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        setEmbeddingStatus("success");
        addToast("Embedding queued successfully.", "success");
      } else {
        const errData = await res.json().catch(() => ({}));
        console.error("Embed error:", errData);
        setEmbeddingStatus("error");
        addToast(errData.detail || "Failed to queue embedding.", "error");
      }
    } catch (err) {
      console.error("Failed to embed resource:", err);
      setEmbeddingStatus("error");
      addToast("Failed to queue embedding.", "error");
    }
  };

  React.useEffect(() => {
    if (!isOpen || !currentItem) return;
    let active = true;
    let localUrl: string | null = null;

    const loadMedia = async () => {
      setLoading(true);
      try {
        const token = localStorage.getItem('access_token');
        const res = await fetch(fileUrl, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        if (!res.ok) throw new Error("Failed to load file");
        const blob = await res.blob();
        if (active) {
          localUrl = URL.createObjectURL(blob);
          setObjectUrl(localUrl);
        }
      } catch (err) {
        console.error("Error loading preview media:", err);
      } finally {
        if (active) setLoading(false);
      }
    };

    loadMedia();

    return () => {
      active = false;
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [currentItem?.id, isOpen]);

  const previewSrc = objectUrl || fileUrl;

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : previewableItems.length - 1));
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentIndex((prev) => (prev < previewableItems.length - 1 ? prev + 1 : 0));
  };

  if (!isOpen || previewableItems.length === 0 || !currentItem) return null;

  const renderPreviewContent = () => {
    if (loading && ["image", "video", "audio"].includes(currentItem.type)) {
      return <div className="bg-slate-800 rounded-2xl min-h-[200px] flex items-center justify-center" />;
    }
    switch (currentItem.type) {
      case "image":
        return (
          <img
            src={previewSrc}
            alt={currentItem.name}
            className="max-h-[70vh] max-w-full object-contain rounded-lg shadow-md select-none"
          />
        );
      case "video":
        return (
          <VideoPlayer src={previewSrc} />
        );
      case "audio":
        return (
          <div className="bg-slate-900/60 p-6 rounded-2xl flex flex-col items-center gap-4 shadow-lg backdrop-blur-md border border-slate-800 min-w-[340px]">
            <span className="text-white font-medium text-center truncate w-full mb-2">{currentItem.name}</span>
            <VoiceMessageBubble
              audioSrc={previewSrc}
              bubbleColor="rgba(255, 255, 255, 0.08)"
              waveColor="#818cf8"
            />
          </div>
        );
      case "pdf":
        return (
          <div className="bg-slate-800 p-8 rounded-2xl flex flex-col items-center gap-6 shadow-lg text-center max-w-[400px]">
            <div className="w-16 h-16 bg-rose-500/10 rounded-full flex items-center justify-center text-rose-500 font-bold text-xl">
              PDF
            </div>
            <div>
              <h4 className="text-white font-semibold mb-1 truncate max-w-[300px]">{currentItem.name}</h4>
              <p className="text-slate-400 text-xs">Read and analyze your PDF documents in full screen mode.</p>
            </div>
            <button
              onClick={() => setShowPdfReader(true)}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 px-6 rounded-xl transition-all shadow-md cursor-pointer"
            >
              <ExternalLink className="w-4 h-4" />
              <span>Open PDF</span>
            </button>
          </div>
        );
      default:
        return (
          <div className="bg-slate-800 p-8 rounded-2xl flex flex-col items-center gap-4 shadow-lg text-center">
            <span className="text-white font-medium">{currentItem.name}</span>
            <p className="text-slate-400 text-xs">Preview not available for this file type.</p>
            <a
              href={previewSrc}
              download
              className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-4 rounded-lg transition-all"
            >
              Download
            </a>
          </div>
        );
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/85 backdrop-blur-md animate-fade-in"
      onClick={onClose}
    >
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
      {/* Top Bar Details */}
      <div className="absolute top-0 inset-x-0 h-16 flex items-center justify-between px-6 bg-gradient-to-b from-black/50 to-transparent pointer-events-none z-10">
        <div className="text-white font-medium truncate max-w-[60%] select-none">
          {currentItem.name}
        </div>
        <div className="flex items-center gap-4 pointer-events-auto">
          {/* Embed button: in default folders only when processing is fully "ready" (not just "uploaded"), in other folders original logic */}
          {(canManuallyProcess
            ? !isAlreadyEmbedded && normalizedProcessingStatus === "ready"
            : !isAlreadyEmbedded && isProcessingComplete
          ) && ["pdf", "docx", "image", "audio", "video"].includes(currentItem.type) && (
            <button
              onClick={handleEmbedClick}
              disabled={embeddingStatus === "embedding" || embeddingStatus === "success"}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700/50 text-white text-xs font-bold py-1.5 px-3.5 rounded-lg border border-indigo-500/20 transition-all cursor-pointer"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>
                {embeddingStatus === "embedding" && "Queueing..."}
                {embeddingStatus === "success" && "Queued!"}
                {embeddingStatus === "error" && "Failed"}
                {embeddingStatus === "idle" && "Embed File"}
              </span>
            </button>
          )}
          {/* Process button: only in default folders (Notes/Resources/Media) when NOT fully ready and NOT in a failed state — other folders auto-process */}
          {canManuallyProcess && !isAlreadyEmbedded && normalizedProcessingStatus !== "ready" && !canResume && currentItem.type !== "folder" && ["pdf", "docx", "image", "audio", "video"].includes(currentItem.type) && (
            <button
              onClick={handleProcess}
              disabled={reprocessStatus === "processing" || reprocessStatus === "success"}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700/50 text-white text-xs font-bold py-1.5 px-3.5 rounded-lg border border-emerald-500/20 transition-all cursor-pointer pointer-events-auto"
            >
              <PlayCircle className={`w-3.5 h-3.5 ${reprocessStatus === "processing" ? "animate-pulse" : ""}`} />
              <span>
                {reprocessStatus === "processing" ? "Processing..." :
                  reprocessStatus === "success" ? "Started!" :
                    reprocessStatus === "error" ? "Failed" : "Process"}
              </span>
            </button>
          )}
          {showOpenButton && currentItem.type !== "pdf" && (
            (currentItem.type === "audio" || currentItem.type === "video") ? (
              <button
                onClick={() => {
                  const token = localStorage.getItem('access_token');
                  const fileUrl = `${window.location.origin}/resources/${currentItem.id}/file`;
                  const paramKey = currentItem.type === "audio" ? "audioUrl" : "videoUrl";
                  const playerUrl = `${window.location.origin}/?${paramKey}=${encodeURIComponent(fileUrl)}&resourceId=${currentItem.id}`;
                  window.open(playerUrl, '_blank');
                }}
                className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold py-1.5 px-3.5 rounded-lg border border-indigo-500/20 transition-all cursor-pointer pointer-events-auto"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Open</span>
              </button>
            ) : (
              <a
                href={previewSrc}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-bold py-1.5 px-3.5 rounded-lg border border-white/20 transition-all cursor-pointer pointer-events-auto"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Open</span>
              </a>
            )
          )}
          {canResume && (
            <button
              onClick={handleResume}
              disabled={reprocessStatus === "processing" || reprocessStatus === "success"}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700/50 text-white text-xs font-bold py-1.5 px-3.5 rounded-lg border border-emerald-500/20 transition-all cursor-pointer pointer-events-auto"
            >
              <PlayCircle className={`w-3.5 h-3.5 ${reprocessStatus === "processing" ? "animate-pulse" : ""}`} />
              <span>Resume</span>
            </button>
          )}
          {currentItem.type !== "folder" && (
            <button
              onClick={handleReprocess}
              disabled={reprocessStatus === "processing" || reprocessStatus === "success"}
              className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700/50 text-white text-xs font-bold py-1.5 px-3.5 rounded-lg border border-amber-500/20 transition-all cursor-pointer pointer-events-auto"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${reprocessStatus === "processing" ? "animate-spin" : ""}`} />
              <span>
                {reprocessStatus === "processing" ? "Processing..." :
                  reprocessStatus === "success" ? "Started!" :
                    reprocessStatus === "error" ? "Failed" : "Regenerate"}
              </span>
            </button>
          )}
          <button
            onClick={onClose}
            className="text-white/75 hover:text-white transition-colors p-1 bg-white/10 hover:bg-white/20 rounded-lg cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div
        className="relative flex items-center justify-center gap-5 w-full max-w-[96vw] h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Navigation Triggers */}
        {previewableItems.length > 1 && (
          <>
            <button
              onClick={handlePrev}
              className="absolute left-0 z-10 flex size-12 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white border border-white/20 hover:scale-105 transition-all cursor-pointer backdrop-blur-sm"
            >
              <ChevronLeft className="size-6" />
            </button>
            <button
              onClick={handleNext}
              className="absolute right-0 z-10 flex size-12 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white border border-white/20 hover:scale-105 transition-all cursor-pointer backdrop-blur-sm"
            >
              <ChevronRight className="size-6" />
            </button>
          </>
        )}

        {/* Media Wrapper */}
        <div className="flex items-center justify-center max-h-full max-w-full p-4 flex-1">
          {renderPreviewContent()}
        </div>

      </div>

      {/* Slide Indicators */}
      {previewableItems.length > 1 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center justify-center z-10 p-2 px-4 bg-black/60 rounded-full backdrop-blur-sm text-white text-xs font-semibold select-none">
          {previewableItems.length > 15 ? (
            <span>{currentIndex + 1} / {previewableItems.length}</span>
          ) : (
            <div className="flex gap-1.5">
              {previewableItems.map((_, idx) => (
                <button
                  key={idx}
                  onClick={(e) => {
                    e.stopPropagation();
                    setCurrentIndex(idx);
                  }}
                  className={`h-1.5 rounded-full transition-all duration-300 ${idx === currentIndex ? "w-6 bg-white" : "w-1.5 bg-white/40 hover:bg-white/60"
                    }`}
                  aria-label={`Go to slide ${idx + 1}`}
                />
              ))}
            </div>
          )}
        </div>
      )}
      {/* Full screen PDF reader modal */}
      {showPdfReader && (
        <div
          className="fixed inset-0 z-[10000] bg-slate-900 flex flex-col text-slate-100 animate-fadeIn"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="h-16 border-b border-slate-800 flex items-center justify-between px-6 bg-slate-950">
            <span className="font-semibold truncate max-w-[70%]">{currentItem.name}</span>
            <button
              onClick={() => setShowPdfReader(false)}
              className="text-slate-400 hover:text-slate-200 transition-colors p-2 hover:bg-slate-800 rounded-xl cursor-pointer flex items-center gap-1.5"
            >
              <X className="w-5 h-5" />
              <span className="text-sm font-medium">Exit Fullscreen</span>
            </button>
          </div>

          {/* Reader container */}
          <div className="flex-1 bg-slate-100 overflow-hidden relative">
            <PDFViewer
              config={{ src: previewSrc }}
              style={{ height: '100%', width: '100%' }}
              onReady={(registry) => {
                console.log('PDF viewer ready!', registry);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
