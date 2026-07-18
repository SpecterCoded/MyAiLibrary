import { useState, useEffect, useRef } from "react";
import type React from "react";
import { Search, Check, Clock, RefreshCw, Loader2, Sparkles, Plus, Star, Globe, BookOpen, AlertCircle, ChevronDown } from "lucide-react";
import { FailedStateContainer } from "../../common/FailedStateContainer";
import { TranscriptChapterHeader, TranscriptMetaBadge } from "../../media/PlayerShared";
import { ToastContainer, type ToastMessage } from "../../FileExplorer/Toast";
import ConfirmModal from "../../ConfirmModal";
import { SavedContentLoader, SavedContentReveal, holdSavedContentLoader } from "../../common/SavedContentLoader";
import { parseTranscript, formatSeconds, renderTextWithAlerts, mergeAlertSegments, hasAlertMarkers } from "../../../utils/transcriptUtils";
import { useTranscriptSync } from "../../../hooks/useTranscriptSync";






const isRtlText = (text: string): boolean => {
  if (!text) return false;
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0590-\u05FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
};

interface TranscriptViewProps {
  transcript: any[];
  chapters?: any[];
  subchapters?: any[];
  currentTime: number;
  activeSubtitle?: string;
  onSeekTo: (time: number) => void;
  resourceId?: string | null;
  token?: string | null;
  processingStatus?: string;
  setProcessingStatus?: (status: string) => void;
  onStructureUpdated?: (next: { chapters?: any[]; subchapters?: any[] }) => void;
  onTranscriptUpdated?: (next: any[]) => void;
  onPendingReindexChange?: (pending: boolean | string) => void;
  pendingReindex?: boolean | string;
  onAskAi?: (query: string) => void;
  starredLines: any[];
  onToggleStar: (msg: any) => void;
}

export function TranscriptView({
  transcript, chapters = [], subchapters = [], currentTime, activeSubtitle = "", onSeekTo, resourceId, token, processingStatus = "ready", setProcessingStatus, onStructureUpdated, onTranscriptUpdated, onPendingReindexChange, pendingReindex, onAskAi, starredLines = [], onToggleStar }: TranscriptViewProps) {
  const [collapsedChapters, setCollapsedChapters] = useState<Record<string, boolean>>({});
  const toggleChapter = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsedChapters(prev => ({ ...prev, [id]: !prev[id] }));
  };
  const [searchQuery, setSearchQuery] = useState("");
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isRegeneratingChapters, setIsRegeneratingChapters] = useState(false);
  const [addingToNotesId, setAddingToNotesId] = useState<string | null>(null);
  const [isReindexing, setIsReindexing] = useState(false);
  const [translations, setTranslations] = useState<Record<string, { text: string; loading: boolean }>>({});
  const [translateModalOpen, setTranslateModalOpen] = useState(false);
  const [translateTarget, setTranslateTarget] = useState('');
  const [translateMsg, setTranslateMsg] = useState<any>(null);
  const [studyNotesText, setStudyNotesText] = useState<string>("");
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [regenerationStatus, setRegenerationStatus] = useState<string>("");
  // Initialize sparkle state immediately from props — no useEffect delay → no first-render flicker
  const [openingSavedTranscript, setOpeningSavedTranscript] = useState(
    () => processingStatus === 'ready' && !isRegenerating && transcript.length > 0
  );
  const [wasSavedLoad, setWasSavedLoad] = useState(
    () => processingStatus === 'ready' && !isRegenerating && transcript.length > 0
  );
  const transcriptPollingRef = useRef<number | null>(null);
  const toastIdRef = useRef(0);

  const { groupedData, activeTurnId, activeSubtitleText, scrollContainerRef } = useTranscriptSync(
    transcript as any[],
    chapters,
    subchapters,
    currentTime
  );

  const addToast = (text: string, type: ToastMessage["type"] = "info") => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, text, type }]);
  };

  const removeToast = (id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  useEffect(() => {
    if (!resourceId || !token) return;
    const loadNotes = () => {
      fetch(`/resources/${resourceId}/notes`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(res => res.json())
        .then(data => {
          if (data && data.notes) {
            setStudyNotesText(data.notes);
          }
        })
        .catch(err => console.error("Failed to load study notes:", err));
    };

    loadNotes();

    window.addEventListener("refresh-notebook-notes", loadNotes);
    return () => {
      window.removeEventListener("refresh-notebook-notes", loadNotes);
    };
  }, [resourceId, token]);

  // Sparkle effect: no transcript.length in deps (prevents mid-animation cancellation),
  // no cancelled flag (promise always resolves — never gets stuck).
  // Runs on every mount (tab switch remounts component) = sparkle every time you open tab.
  useEffect(() => {
    if (processingStatus !== 'ready' || isRegenerating || transcript.length === 0) {
      setOpeningSavedTranscript(false);
      return;
    }
    setOpeningSavedTranscript(true);
    setWasSavedLoad(true);
    holdSavedContentLoader(Date.now()).then(() => {
      setOpeningSavedTranscript(false);
    });
  }, [processingStatus, isRegenerating]); // intentionally excludes transcript.length

  useEffect(() => {
    return () => {
      if (transcriptPollingRef.current) {
        window.clearInterval(transcriptPollingRef.current);
      }
    };
  }, []);

  const toggleStar = (msg: any) => {
    onToggleStar(msg);
  };

  const handleAddToNotes = async (msg: any) => {
    if (!resourceId || !token) return;
    setAddingToNotesId(msg.id);
    try {
      const getRes = await fetch(`/resources/${resourceId}/notes?only_saved=true`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      let currentNotes = "";
      if (getRes.ok) {
        const getData = await getRes.json();
        currentNotes = getData.notes || "";
      }

      const timestampString = msg.time ? `[${msg.time}]` : "";
      const speakerString = msg.name || msg.speaker || "Speaker";
      const appendedText = `\n- ${timestampString} **${speakerString}**: ${msg.text}\n`;
      const updatedNotes = currentNotes + (currentNotes ? "\n" : "") + appendedText;

      const putRes = await fetch(`/resources/${resourceId}/notes`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ notes: updatedNotes }),
      });

      if (putRes.ok) {
        addToast("Line successfully added to Deep Study Notes!", "success");
        window.dispatchEvent(new CustomEvent("refresh-notebook-notes"));
      } else {
        addToast("Failed to append quote to notes.", "error");
      }
    } catch (err) {
      console.error(err);
      addToast("An error occurred while adding to notes.", "error");
    } finally {
      setAddingToNotesId(null);
    }
  };

  const handleAskAi = (msg: any) => {
    if (onAskAi) {
      const speaker = msg.name || msg.speaker || "Speaker";
      const prompt = `Explain this statement from the video transcript at [${msg.time}] by ${speaker}:\n"${msg.text}"`;
      onAskAi(prompt);
    }
  };

  const handleTranslate = (msg: any) => {
    setTranslateMsg(msg);
    setTranslateTarget('');
    setTranslateModalOpen(true);
  };

  const executeTranslate = async () => {
    if (!translateMsg || !translateTarget.trim()) return;
    const lang = translateTarget.trim();
    const msg = translateMsg;
    setTranslateModalOpen(false);

    setTranslations(prev => ({
      ...prev,
      [msg.id]: { text: "", loading: true }
    }));

    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ text: msg.text, target_language: lang })
      });

      if (res.ok) {
        const data = await res.json();
        setTranslations(prev => ({
          ...prev,
          [msg.id]: { text: data.translation, loading: false }
        }));
      } else {
        addToast("Failed to translate text.", "error");
        setTranslations(prev => { const next = { ...prev }; delete next[msg.id]; return next; });
      }
    } catch (err) {
      console.error("Translation error:", err);
      addToast("Failed to translate text.", "error");
      setTranslations(prev => { const next = { ...prev }; delete next[msg.id]; return next; });
    }
  };


  const filterTurns = (turns: any[]) => {
    if (!searchQuery.trim()) return turns;
    return turns.filter(
      turn =>
        (turn.name || turn.speaker || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        turn.text.toLowerCase().includes(searchQuery.toLowerCase())
    );
  };


  const highlightActiveSubtitleText = (text: string, activeSub: string) => {
    if (!activeSub || !activeSub.trim()) return text;

    const cleanSub = activeSub.trim().toLowerCase().replace(/[^\w\s]/g, "");
    if (!cleanSub) return text;

    const index = text.toLowerCase().indexOf(activeSub.toLowerCase());
    if (index !== -1) {
      const before = text.substring(0, index);
      const match = text.substring(index, index + activeSub.length);
      const after = text.substring(index + activeSub.length);
      return (
        <>
          {before}
          <span className="bg-[#ffebdb] dark:bg-[#ff7d54]/25 text-[#eb580a] dark:text-[#ff7d54] font-bold px-1.5 py-0.5 rounded-md transition-all select-all">
            {match}
          </span>
          {after}
        </>
      );
    }

    const sentences = text.split(/([.!?]\s+)/);
    let matched = false;
    const elements = sentences.map((part, i) => {
      const cleanPart = part.toLowerCase().replace(/[^\w\s]/g, "").trim();
      if (cleanPart && (cleanSub.includes(cleanPart) || cleanPart.includes(cleanSub)) && !matched) {
        matched = true;
        return (
          <span key={i} className="bg-[#ffebdb] dark:bg-[#ff7d54]/25 text-[#eb580a] dark:text-[#ff7d54] font-bold px-1.5 py-0.5 rounded-md transition-all select-all">
            {part}
          </span>
        );
      }
      return part;
    });

    if (matched) {
      return <>{elements}</>;
    }

    return text;
  };


  const getAvatar = (speaker: string) => {
    const cleanSpeaker = speaker.trim();
    return (
      <div className="w-8.5 h-8.5 rounded-full border border-gray-100 dark:border-white/5 bg-indigo-100 dark:bg-indigo-950/50 text-indigo-800 dark:text-indigo-300 flex items-center justify-center font-bold text-sm shadow-sm shrink-0 font-sans">
        {cleanSpeaker.substring(0, 2).toUpperCase()}
      </div>
    );
  };

  const renderMessageText = (msg: any, turnsList: any[], isActive: boolean) => {
    if (searchQuery.trim() && msg.text.toLowerCase().includes(searchQuery.toLowerCase())) {
      const text = msg.text;
      const parts = text.split(new RegExp(`(${searchQuery})`, 'gi'));
      return (
        <div className="text-[13.5px] leading-relaxed text-gray-800 dark:text-slate-200 font-semibold py-1">
          {parts.map((part: string, i: number) =>
            part.toLowerCase() === searchQuery.toLowerCase() ? (
              <span key={i} className="bg-[#ffebdb] dark:bg-[#ff7d54]/20 text-[#eb580a] dark:text-[#ff7d54] font-bold px-1.5 py-0.5 rounded-md mx-0.5 inline-block select-all transition-all duration-200 hover:scale-105">
                {part}
              </span>
            ) : (
              <span key={i}>{renderTextWithAlerts(part)}</span>
            )
          )}
        </div>
      );
    }

    return (
      <div className={`text-[13.5px] leading-relaxed font-semibold py-1 ${isActive ? "text-gray-900 dark:text-white" : "text-gray-750 dark:text-slate-300"}`}>
        {isActive ? highlightActiveSubtitleText(msg.text, activeSubtitleText) : renderTextWithAlerts(msg.text)}
      </div>
    );
  };

  const renderSegmentGroup = (segments: any[], contextId: string) => {
    if (!segments || segments.length === 0) return null;

    // Merge alert markers with their following content segments
    const mergedSegments = mergeAlertSegments(segments);

    const groups: { speaker: string, segments: any[] }[] = [];
    let currentGroup = { speaker: mergedSegments[0].speaker || mergedSegments[0].name || "Speaker", segments: [mergedSegments[0]] };

    for (let i = 1; i < mergedSegments.length; i++) {
      const seg = mergedSegments[i];
      const segSpeaker = seg.speaker || seg.name || "Speaker";
      if (segSpeaker === currentGroup.speaker) {
        currentGroup.segments.push(seg);
      } else {
        groups.push(currentGroup);
        currentGroup = { speaker: segSpeaker, segments: [seg] };
      }
    }
    groups.push(currentGroup);

    return groups.map((group, gIdx) => {
      const isActiveGroup = group.segments.some(seg => seg.id === activeTurnId);
      const combinedMsg: any = {
        id: `${contextId}-group-${gIdx}`,
        speaker: group.speaker,
        name: group.speaker,
        time: group.segments[0].time,
        startSeconds: group.segments[0].startSeconds || 0,
        text: group.segments.map(s => s.text).join(" "),
        segments: group.segments
      };

      const isStarred = starredLines.some((x: any) => x.id === combinedMsg.id);

      return (
        <div
          key={combinedMsg.id}
          id={isActiveGroup ? combinedMsg.id : undefined}
          className={`group relative flex gap-4 p-3.5 rounded-2xl transition-all duration-300 border ${isActiveGroup
            ? "bg-[#ff7d54]/5 dark:bg-[#ff7d54]/10 border-[#ff7d54]/20 dark:border-[#ff7d54]/30 shadow-xs"
            : isStarred
              ? "bg-amber-50/30 dark:bg-amber-950/10 border-amber-200/50 dark:border-amber-900/20 hover:bg-amber-50/50 dark:hover:bg-amber-950/20"
              : "border-transparent hover:bg-[#FAF9FB] dark:hover:bg-slate-800/30 hover:border-slate-100 dark:hover:border-white/5"
            }`}
        >
          <div className="flex-shrink-0 pt-1">
            {getAvatar(combinedMsg.speaker)}
          </div>

          <div className="flex-1 flex flex-col max-w-[88%] relative">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-extrabold text-sm text-gray-900 dark:text-white">{combinedMsg.speaker}</span>
              <TranscriptMetaBadge
                onClick={() => onSeekTo && onSeekTo(combinedMsg.startSeconds || 0)}
                title="Jump to this transcript group"
              >
                {combinedMsg.time}
              </TranscriptMetaBadge>
              {isStarred && <Star size={12} className="text-amber-500 fill-amber-500 shrink-0" />}
            </div>

            <div className="text-[13.5px] leading-relaxed text-gray-700 dark:text-slate-300 font-medium">
              {searchQuery.trim() ? (
                <div className="py-1">
                  {(() => {
                    const parts = combinedMsg.text.split(new RegExp(`(${searchQuery})`, 'gi'));
                    return parts.map((part: string, i: number) =>
                      part.toLowerCase() === searchQuery.toLowerCase() ? (
                        <span key={i} className="bg-[#ffebdb] dark:bg-[#ff7d54]/20 text-[#eb580a] dark:text-[#ff7d54] font-bold px-1.5 py-0.5 rounded-md mx-0.5 inline-block select-all">
                          {part}
                        </span>
                      ) : (
                        <span key={i}>{renderTextWithAlerts(part)}</span>
                      )
                    )
                  })()}
                </div>
              ) : (
                group.segments.map((seg, sIdx) => {
                  const isSegActive = seg.id === activeTurnId;
                  const hasAlert = hasAlertMarkers(seg.text);
                  if (hasAlert) {
                    return (
                      <div
                        key={seg.id}
                        id={seg.id}
                        onClick={() => onSeekTo && onSeekTo(seg.startSeconds || 0)}
                        className="my-1"
                      >
                        {renderTextWithAlerts(seg.text)}
                      </div>
                    );
                  }
                  return (
                    <span
                      key={seg.id}
                      id={seg.id}
                      onClick={() => onSeekTo && onSeekTo(seg.startSeconds || 0)}
                      className={`inline cursor-pointer transition-colors duration-200 rounded-sm mr-1 ${isSegActive
                        ? "bg-[#ffebdb] dark:bg-[#ff7d54]/25 text-[#eb580a] dark:text-[#ff7d54] font-bold py-0.5 px-0.5"
                        : "hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-gray-900 dark:hover:text-white"
                        }`}
                    >
                      {seg.text}
                    </span>
                  );
                })
              )}
            </div>

            {/* Translation Bubble */}
            {translations[combinedMsg.id] && (
              <div className="mt-2 text-xs p-3 bg-[#ff7d54]/5 border border-[#ff7d54]/25 rounded-2xl max-w-fit text-slate-800 dark:text-slate-200" onClick={(e) => e.stopPropagation()}>
                {translations[combinedMsg.id].loading ? (
                  <div className="flex items-center gap-1.5 text-gray-500 font-semibold">
                    <Loader2 className="animate-spin text-[#ff7d54]" size={12} />
                    <span>Translating...</span>
                  </div>
                ) : (
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-1 text-[10px] text-[#ff7d54] font-extrabold uppercase tracking-wider">
                      <Globe size={10} />
                      <span>Translation</span>
                    </div>
                    <span
                      className={`font-semibold block ${isRtlText(translations[combinedMsg.id].text) ? "text-right" : ""}`}
                      dir={isRtlText(translations[combinedMsg.id].text) ? "rtl" : "ltr"}
                    >
                      {translations[combinedMsg.id].text}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Floating Actions Panel */}
          <div className="absolute -top-3 right-4 bg-white dark:bg-[#1e1f22] shadow-md dark:shadow-lg border border-slate-100/80 dark:border-white/5 rounded-full px-2.5 py-1 flex items-center gap-2.5 opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0 transition-all duration-300 z-10" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => handleAskAi(combinedMsg)}
              className="text-slate-400 hover:text-[#ff7d54] hover:scale-110 transition-all p-0.5 cursor-pointer flex items-center justify-center"
              title="Ask AI about this"
            >
              <Sparkles size={13} />
            </button>

            {(() => {
              const isAdded = (() => {
                if (typeof studyNotesText === 'undefined' || !studyNotesText || !combinedMsg.text) return false;
                const cleanText = combinedMsg.text.trim();
                if (!cleanText) return false;
                const speakerString = combinedMsg.name || combinedMsg.speaker || "Speaker";
                const timestampString = combinedMsg.time ? `[${combinedMsg.time}]` : "";
                const targetSearch = timestampString
                  ? `\n- ${timestampString} **${speakerString}**: ${cleanText}\n`
                  : `\n- **${speakerString}**: ${cleanText}\n`;
                return studyNotesText.includes(targetSearch);
              })();
              return (
                <button
                  onClick={() => typeof handleAddToNotes !== 'undefined' && handleAddToNotes(combinedMsg)}
                  disabled={(typeof addingToNotesId !== 'undefined' && addingToNotesId !== null) || isAdded}
                  className={`hover:scale-110 transition-all p-0.5 cursor-pointer flex items-center justify-center disabled:scale-100 disabled:cursor-not-allowed ${isAdded ? "text-emerald-500" : "text-slate-400 hover:text-[#ff7d54]"
                    }`}
                  title={isAdded ? "Already added to Notes" : "Add to Deep Notes"}
                >
                  {(typeof addingToNotesId !== 'undefined' && addingToNotesId === combinedMsg.id) ? (
                    <Loader2 size={13} className="animate-spin text-[#ff7d54]" />
                  ) : isAdded ? (
                    <Check size={13} className="stroke-[3px]" />
                  ) : (
                    <Plus size={13} />
                  )}
                </button>
              );
            })()}

            <button
              onClick={() => typeof toggleStar !== 'undefined' && toggleStar(combinedMsg)}
              className={`hover:scale-110 transition-all p-0.5 cursor-pointer flex items-center justify-center ${isStarred ? "text-amber-500 hover:text-amber-600" : "text-slate-400 hover:text-amber-500"
                }`}
              title={isStarred ? "Starred" : "Star / Bookmark"}
            >
              <Star size={13} className={isStarred ? "fill-amber-500" : "fill-transparent"} />
            </button>

            <button
              onClick={() => typeof handleTranslate !== 'undefined' && handleTranslate(combinedMsg)}
              className="text-slate-400 hover:text-[#ff7d54] hover:scale-110 transition-all p-0.5 cursor-pointer flex items-center justify-center"
              title="Translate with AI"
            >
              <Globe size={13} />
            </button>
          </div>
        </div>
      );
    });
  };

  const triggerRegenerate = () => {
    if (!resourceId || !token) return;
    setIsConfirmOpen(true);
  };

  const startTranscriptPolling = () => {
    if (!resourceId || !token) return;
    if (transcriptPollingRef.current) {
      window.clearInterval(transcriptPollingRef.current);
    }

    transcriptPollingRef.current = window.setInterval(async () => {
      try {
        const queueRes = await fetch(`/queue/${resourceId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });

        if (!queueRes.ok) return;
        const queueData = await queueRes.json();
        if (queueData.job_type !== "transcript_only") return;
        setRegenerationStatus(queueData.detail_status || "");

        if (queueData.job_status === "completed") {
          if (transcriptPollingRef.current) {
            window.clearInterval(transcriptPollingRef.current);
            transcriptPollingRef.current = null;
          }

          const detailsRes = await fetch(`/resources/${resourceId}/details`, {
            headers: { Authorization: `Bearer ${token}` }
          });

          if (detailsRes.ok) {
            const data = await detailsRes.json();
            onTranscriptUpdated?.(parseTranscript(data.resource?.transcript || ""));
            onStructureUpdated?.({
              chapters: data.chapters || [],
              subchapters: data.subchapters || [],
            });
            if (setProcessingStatus) {
              setProcessingStatus(data.resource?.processing_status || "ready");
            }
          }

          const srtRes = await fetch(`/resources/${resourceId}/srt`, { headers: { Authorization: `Bearer ${token}` } });
          if (srtRes.ok) {
            const srtText = await srtRes.text();
            if (srtText && srtText.trim()) {
              onTranscriptUpdated?.(parseTranscript(srtText));
            }
          } else {
            const detailsRes = await fetch(`/resources/${resourceId}/details`, {
              headers: { Authorization: `Bearer ${token}` }
            });
            if (detailsRes.ok) {
              const data = await detailsRes.json();
              onTranscriptUpdated?.(parseTranscript(data.resource?.transcript || ""));
            }
          }

          setIsRegenerating(false);
          setRegenerationStatus("");

          onPendingReindexChange?.("outdated:structure,transcript");
          addToast("Transcript regeneration finished. Chapters and subchapters were refreshed. Re-index is ready.", "success");
          return;
        }

        if (queueData.job_status === "failed" || queueData.job_status === "cancelled" || queueData.job_status === "paused") {
          if (transcriptPollingRef.current) {
            window.clearInterval(transcriptPollingRef.current);
            transcriptPollingRef.current = null;
          }
          setIsRegenerating(false);
          setRegenerationStatus("");
          addToast(queueData.error_message || "Transcript regeneration stopped or failed.", "error");
        }
      } catch (error) {
        console.error("Transcript regeneration polling error:", error);
      }
    }, 2500);
  };

  const handleRegenerate = async () => {
    setIsRegenerating(true);
    setRegenerationStatus("queued for transcript regeneration");
    addToast("Transcript regeneration is processing...", "info");
    try {
      const res = await fetch(`/resources/${resourceId}/regenerate-transcript`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        startTranscriptPolling();
        addToast("Transcript regeneration started in background.", "success");
      } else {
        const errorData = await res.json().catch(() => ({}));
        addToast(errorData.detail || "Failed to regenerate transcript.", "error");
        setIsRegenerating(false);
        setRegenerationStatus("");
      }
    } catch (e) {
      console.error(e);
      addToast("Error regenerating transcript.", "error");
      setIsRegenerating(false);
      setRegenerationStatus("");
    }
  };

  const handleRetryChapters = async () => {
    if (!resourceId || !token) return;
    setIsRegeneratingChapters(true);
    addToast("Chapter regeneration is processing...", "info");
    try {
      const res = await fetch(`/resources/${resourceId}/regenerate-structure`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        if (setProcessingStatus) setProcessingStatus("chaptering");
        const detailsRes = await fetch(`/resources/${resourceId}/details`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (detailsRes.ok) {
          const data = await detailsRes.json();
          if (setProcessingStatus) setProcessingStatus(data.resource?.processing_status || "ready");
          onStructureUpdated?.({
            chapters: data.chapters || [],
            subchapters: data.subchapters || [],
          });
          onPendingReindexChange?.("outdated:structure");
          addToast("Chapters and subchapters finished. Re-index is ready.", "success");
        }
      } else {
        const errorData = await res.json().catch(() => ({}));
        addToast(errorData.detail || "Failed to regenerate chapters.", "error");
      }
    } catch (e) {
      console.error(e);
      addToast("Error regenerating chapters.", "error");
    } finally {
      setIsRegeneratingChapters(false);
    }
  };

  const handleReindex = async () => {
    if (!resourceId || !token) return;
    setIsReindexing(true);
    addToast("Re-indexing and re-embedding are processing...", "info");
    try {
      const res = await fetch(`/resources/${resourceId}/index`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        onPendingReindexChange?.(false);
        addToast("Re-index and re-embed started successfully.", "success");
      } else {
        const errorData = await res.json().catch(() => ({}));
        addToast(errorData.detail || "Failed to queue re-indexing.", "error");
      }
    } catch (e) {
      console.error(e);
      addToast("Error queueing re-indexing.", "error");
    } finally {
      setIsReindexing(false);
    }
  };

  const isStuckStatus = ["paused", "failed", "cancelled"].includes(processingStatus.toLowerCase());
  if (openingSavedTranscript) {
    return <SavedContentLoader message="Opening your saved transcript..." />;
  }

  if (processingStatus !== "ready" && !isRegenerating && !isStuckStatus) {
    return (
      <div className="flex flex-col h-full bg-white dark:bg-[#1e1f22] relative p-6">
        <div className="flex items-center space-x-3 mb-6">
          <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-white/5 animate-pulse" />
          <div className="h-5 w-48 bg-slate-100 dark:bg-white/5 rounded-md animate-pulse" />
        </div>
        <div className="space-y-4">
          <div className="h-4 w-3/4 bg-slate-50 dark:bg-white/5 rounded animate-pulse" />
          <div className="h-4 w-full bg-slate-50 dark:bg-white/5 rounded animate-pulse" />
          <div className="h-4 w-5/6 bg-slate-50 dark:bg-white/5 rounded animate-pulse" />
        </div>
        <div className="mt-8 flex flex-col items-center justify-center space-y-4 text-center">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
          <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">Processing in pipeline ({processingStatus})...</p>
        </div>
      </div>
    );
  }

  if (isStuckStatus) {
    return (
      <div className="flex flex-col h-full bg-white dark:bg-[#1e1f22] relative">
        <ToastContainer toasts={toasts} onDismiss={removeToast} />
        <FailedStateContainer message={`Transcript generation ${processingStatus}.`} onRetry={triggerRegenerate} title="Transcription Failed" />

      <ConfirmModal
          isOpen={isConfirmOpen}
          onClose={() => setIsConfirmOpen(false)}
          onConfirm={handleRegenerate}
          title="Regenerate Transcript?"
          message="Are you sure you want to retry regenerating the transcript? This will delete all current AI data and chapters."
          confirmText="Yes, Regenerate"
          cancelText="Cancel"
          isDanger={true}
        />
      </div>
    );
  }

  const transcriptContent = (
    <div className="flex flex-col h-full bg-white dark:bg-[#1e1f22] relative">
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
      <div className="px-6 pb-4 flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500" />
          <input
            type="text"
            placeholder="Search transcript..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-[#fbfbfb] dark:bg-white/5 border border-gray-100 dark:border-white/10 rounded-xl text-sm text-gray-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-[#ff7d54]/15 dark:focus:ring-[#ff7d54]/25 focus:border-[#ff7d54]/40 dark:focus:border-[#ff7d54]/60 transition-all placeholder:text-gray-300 dark:placeholder:text-slate-500 font-semibold"
          />
        </div>
        <button
          onClick={triggerRegenerate}
          disabled={isRegenerating || !resourceId}
          className="flex-shrink-0 px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl transition-all cursor-pointer flex items-center justify-center"
          title="Regenerate Transcript"
        >
          <RefreshCw size={16} className={isRegenerating ? "animate-spin" : ""} />
        </button>
        <button
          onClick={handleRetryChapters}
          disabled={isRegeneratingChapters || !resourceId || !token}
          className="flex-shrink-0 px-3 py-2 bg-amber-50 border border-amber-200 hover:bg-amber-100 text-amber-700 rounded-xl transition-all cursor-pointer flex items-center justify-center"
          title="Regenerate Chapters & Subchapters"
        >
          <BookOpen size={16} className={isRegeneratingChapters ? "animate-pulse" : ""} />
        </button>
        {((pendingReindex === true) || (typeof pendingReindex === "string" && (pendingReindex === "outdated" || pendingReindex.includes("transcript") || pendingReindex.includes("structure")))) && (
          <button
            onClick={handleReindex}
            disabled={isReindexing || !resourceId || !token}
            className="flex-shrink-0 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-all cursor-pointer flex items-center justify-center font-bold text-xs gap-1.5 border-none outline-none shadow-xs"
            title="Re-Index for RAG"
          >
            {isReindexing ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Sparkles size={13} />
            )}
            <span>Re-Index for RAG</span>
          </button>
        )}
      </div>

      {isRegenerating && regenerationStatus && (
        <div className="px-6 pb-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
            <Loader2 size={12} className="animate-spin" />
            <span>{regenerationStatus === "generating local timestamps..." ? "Generating local timestamps with your Whisper engine..." : regenerationStatus}</span>
          </div>
        </div>
      )}

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-6 pb-24 no-scrollbar flex flex-col gap-6 scroll-smooth">
        {groupedData.type === 'grouped' ? (
          groupedData.data.map(chapter => (
            <div key={chapter.id} className="space-y-4">
              <div
                className="flex items-center space-x-2 pb-2 border-b border-slate-100 dark:border-white/5 select-none w-full group/chap"
              >
                <button
                  onClick={(e) => toggleChapter(chapter.id, e)}
                  className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-white/5 transition-colors cursor-pointer text-slate-400"
                >
                  <ChevronDown size={14} className={`transition-transform duration-200 ${collapsedChapters[chapter.id] ? '-rotate-90' : 'rotate-0'}`} />
                </button>
                <div
                  onClick={() => onSeekTo(chapter.start_time || 0)}
                  className="flex items-center space-x-2 cursor-pointer hover:opacity-80 transition-opacity"
                >
                  <span className="inline-flex h-6 items-center gap-1 rounded-md border border-indigo-100/80 dark:border-indigo-400/30 bg-indigo-50 dark:bg-indigo-500/15 px-2 text-[10px] font-extrabold uppercase text-indigo-700 dark:text-indigo-300 shadow-sm font-sans">
                    <BookOpen size={11} /> Chapter
                  </span>
                  <span className="min-w-0 truncate text-xs font-bold text-slate-600 dark:text-slate-350 font-sans">
                    {chapter.title}
                  </span>
                </div>
              </div>

              {!collapsedChapters[chapter.id] && (
                <div className="space-y-4 pl-3 border-l-2 border-[#ff7d54]/25 ml-1 animate-in fade-in duration-300">
                  {renderSegmentGroup(chapter.segments, chapter.id)}
                  {chapter.subchapters.map(sub => (
                    <div key={sub.id} className="p-3.5 rounded-2xl border bg-white dark:bg-transparent border-slate-100 dark:border-white/5">
                      <div className="flex items-center gap-2 mb-3 text-xs font-semibold text-slate-400 font-sans select-none">
                        <Clock size={11} />
                        <span>{sub.title}</span>
                        <TranscriptMetaBadge>{formatSeconds(sub.start_time)}</TranscriptMetaBadge>
                      </div>
                      <div className="space-y-3">
                        {renderSegmentGroup(sub.segments, sub.id)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        ) : transcript && transcript.length > 0 ? (
          <div className="space-y-3">
            {renderSegmentGroup(groupedData.data, "flat")}
          </div>
        ) : (
          <div className="text-center py-16 text-slate-400 text-sm font-semibold">
            No transcript available for this resource yet.
          </div>
        )}
      </div>


      {/* Translate Language Modal */}
      {translateModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setTranslateModalOpen(false)}>
          <div
            className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-white/10 w-full max-w-sm mx-4 p-6 animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center">
                <Globe className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">Translate</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Choose target language</p>
              </div>
            </div>
            <input
              autoFocus
              type="text"
              value={translateTarget}
              onChange={(e) => setTranslateTarget(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') executeTranslate(); if (e.key === 'Escape') setTranslateModalOpen(false); }}
              placeholder="e.g. Spanish, French, Arabic..."
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-900/50 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-all"
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setTranslateModalOpen(false)}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={executeTranslate}
                disabled={!translateTarget.trim()}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Translate
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
        onConfirm={handleRegenerate}
        title="Regenerate Transcript?"
        message="Are you sure you want to regenerate the transcript? This will delete all current AI data and chapters."
        confirmText="Yes, Regenerate"
        cancelText="Cancel"
        isDanger={true}
      />
    </div>
  );

  return wasSavedLoad ? <SavedContentReveal>{transcriptContent}</SavedContentReveal> : transcriptContent;
}
