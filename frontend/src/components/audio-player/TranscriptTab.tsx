import React, { useState, useEffect, useRef } from "react";
import { Play, Pause, Square, RefreshCw, Loader2, Search, Check, Clock, Sparkles, Plus, Star, Globe, BookOpen } from "lucide-react";
import { FailedStateContainer } from "../common/FailedStateContainer";
import { TranscriptChapterHeader, TranscriptMetaBadge } from "../media/PlayerShared";
import type { TranscriptItem } from "./types";
import { ToastContainer, type ToastMessage } from "../FileExplorer/Toast";
import ConfirmModal from "../ConfirmModal";
import { SavedContentLoader, SavedContentReveal, holdSavedContentLoader } from "../common/SavedContentLoader";
import { parseTranscript, formatSeconds, renderTextWithAlerts, mergeAlertSegments, hasAlertMarkers } from "../../utils/transcriptUtils";
import { useTranscriptSync } from "../../hooks/useTranscriptSync";

interface TranscriptTabProps {
  transcript: TranscriptItem[];
  setTranscript: React.Dispatch<React.SetStateAction<TranscriptItem[]>>;
  chapters?: any[];
  subchapters?: any[];
  isRecording: boolean;
  setIsRecording: (rec: boolean) => void;
  timerSeconds: number;
  setTimerSeconds: React.Dispatch<React.SetStateAction<number>>;
  onStopRecording: () => void;
  title?: string;
  seekToTime?: (time: number) => void;
  resourceId?: string | null;
  token?: string | null;
  processingStatus?: string;
  setProcessingStatus?: (status: string) => void;
  onStructureUpdated?: (next: { chapters?: any[]; subchapters?: any[] }) => void;
  onTranscriptUpdated?: (next: TranscriptItem[]) => void;
  onPendingReindexChange?: (pending: boolean | string) => void;
  onAskAi?: (query: string) => void;
  starredLines: any[];
  onToggleStar: (msg: any) => void;
  pendingReindex?: boolean | string;
}

export default function TranscriptTab({
  transcript,
  setTranscript,
  chapters = [],
  subchapters = [],
  isRecording,
  setIsRecording,
  timerSeconds,
  onStopRecording,
  title,
  seekToTime,
  resourceId,
  token,
  processingStatus = "ready",
  setProcessingStatus,
  onStructureUpdated,
  onTranscriptUpdated,
  onPendingReindexChange,
  onAskAi,
  starredLines = [],
  onToggleStar,
  pendingReindex
}: TranscriptTabProps) {
  const [collapsedChapters, setCollapsedChapters] = useState<Record<string, boolean>>({});
  const toggleChapter = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsedChapters((prev: Record<string, boolean>) => ({ ...prev, [id]: !prev[id] }));
  };
  const [isRegenerating, setIsRegenerating] = React.useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = React.useState(false);
  const [isRegeneratingChapters, setIsRegeneratingChapters] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [studyNotesText, setStudyNotesText] = React.useState<string>("");
  const [addingToNotesId, setAddingToNotesId] = React.useState<string | null>(null);
  const [translations, setTranslations] = React.useState<Record<string, { text: string; loading: boolean }>>({});
  const [isReindexing, setIsReindexing] = useState(false);
  const [toasts, setToasts] = React.useState<ToastMessage[]>([]);
  const [regenerationStatus, setRegenerationStatus] = React.useState<string>("");
  const [openingSavedTranscript, setOpeningSavedTranscript] = React.useState(
    () => processingStatus === 'ready' && !isRegenerating && transcript.length > 0
  );
  const [wasSavedLoad, setWasSavedLoad] = React.useState(
    () => processingStatus === 'ready' && !isRegenerating && transcript.length > 0
  );
  const transcriptPollingRef = useRef<number | null>(null);
  const toastIdRef = useRef(0);

  const { groupedData, activeTurnId, activeSubtitleText, scrollContainerRef } = useTranscriptSync(
    transcript as any[],
    chapters,
    subchapters,
    timerSeconds
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
  // Runs on every mount (tab switch remounts) = sparkle every time you switch to this tab.
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

  // Formatter for main clock (timerSeconds)
  const formatTime = (totalSeconds: number) => {
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = Math.floor(totalSeconds) % 60;
    return [
      hrs > 0 ? String(hrs).padStart(2, "0") : null,
      String(mins).padStart(2, "0"),
      String(secs).padStart(2, "0"),
    ]
      .filter(Boolean)
      .join(":");
  };


  const isRtlText = (text: string): boolean => {
    if (!text) return false;
    return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0590-\u05FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
  };

  // Avatar lookup
  const getAvatar = (speaker: string) => {
    const cleanSpeaker = speaker.trim();
    if (cleanSpeaker === "Ehsan") {
      return (
        <div className="w-11 h-11 rounded-full overflow-hidden bg-neutral-800 flex items-center justify-center text-white text-sm font-semibold select-none shrink-0 border border-neutral-700">
          EH
        </div>
      );
    }
    if (cleanSpeaker === "Ava") {
      return (
        <div className="w-11 h-11 rounded-full overflow-hidden bg-amber-500 flex items-center justify-center text-neutral-900 text-sm font-bold select-none shrink-0 border border-amber-400">
          AV
        </div>
      );
    }
    return (
      <div className="w-11 h-11 rounded-full overflow-hidden bg-indigo-500 flex items-center justify-center text-white text-sm font-semibold select-none shrink-0">
        {cleanSpeaker.substring(0, 2).toUpperCase()}
      </div>
    );
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
            const nextTranscript = parseTranscript(data.resource?.transcript || "");
            setTranscript(nextTranscript);
            onTranscriptUpdated?.(nextTranscript);
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
              const nextTranscript = parseTranscript(srtText);
              setTranscript(nextTranscript);
              onTranscriptUpdated?.(nextTranscript);
            }
          } else {
            const detailsRes = await fetch(`/resources/${resourceId}/details`, {
              headers: { Authorization: `Bearer ${token}` }
            });
            if (detailsRes.ok) {
              const data = await detailsRes.json();
              const nextTranscript = parseTranscript(data.resource?.transcript || "");
              setTranscript(nextTranscript);
              onTranscriptUpdated?.(nextTranscript);
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
      <div className={`text-[13.5px] leading-relaxed font-semibold py-1 ${isActive ? "text-gray-900 dark:text-white" : "text-gray-700 dark:text-slate-350"}`}>
        {isActive ? highlightActiveSubtitleText(msg.text, activeSubtitleText) : renderTextWithAlerts(msg.text)}
      </div>
    );
  };

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
      const prompt = `Explain this statement from the audio transcript at [${msg.time}] by ${speaker}:\n"${msg.text}"`;
      onAskAi(prompt);
    }
  };

  const handleTranslate = async (msg: any) => {
    const targetLanguage = window.prompt("Which language would you like to translate this line to?", "Spanish");
    if (!targetLanguage || !targetLanguage.trim()) return;

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
        body: JSON.stringify({
          text: msg.text,
          target_language: targetLanguage
        })
      });

      if (res.ok) {
        const data = await res.json();
        setTranslations(prev => ({
          ...prev,
          [msg.id]: { text: data.translation, loading: false }
        }));
      } else {
        addToast("Failed to translate text.", "error");
        setTranslations(prev => {
          const next = { ...prev };
          delete next[msg.id];
          return next;
        });
      }
    } catch (err) {
      console.error("Translation error:", err);
      addToast("Failed to translate text.", "error");
      setTranslations(prev => {
        const next = { ...prev };
        delete next[msg.id];
        return next;
      });
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

  const renderSegmentGroup = (segments: any[], contextId: string) => {
    if (!segments || segments.length === 0) return null;

    // Merge alert markers with their following content segments
    const mergedSegments = mergeAlertSegments(segments);

    const groups: { speaker: string; segments: any[] }[] = [];
    let currentGroup = {
      speaker: mergedSegments[0].speaker || mergedSegments[0].name || "Speaker",
      segments: [mergedSegments[0]],
    };

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

    return groups.map((group, groupIndex) => {
      const isActiveGroup = group.segments.some(seg => seg.id === activeTurnId);
      const combinedMsg = {
        id: `${contextId}-group-${groupIndex}`,
        speaker: group.speaker,
        name: group.speaker,
        time: group.segments[0].time,
        text: group.segments.map(seg => seg.text || "").join(" ").trim(),
        startSeconds: group.segments[0].startSeconds || 0,
        segments: group.segments,
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
                onClick={() => seekToTime && seekToTime(combinedMsg.startSeconds)}
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
                    const parts = combinedMsg.text.split(new RegExp(`(${searchQuery})`, "gi"));
                    return parts.map((part: string, i: number) =>
                      part.toLowerCase() === searchQuery.toLowerCase() ? (
                        <span key={i} className="bg-[#ffebdb] dark:bg-[#ff7d54]/20 text-[#eb580a] dark:text-[#ff7d54] font-bold px-1.5 py-0.5 rounded-md mx-0.5 inline-block select-all">
                          {part}
                        </span>
                      ) : (
                        <span key={i}>{renderTextWithAlerts(part)}</span>
                      )
                    );
                  })()}
                </div>
              ) : (
                group.segments.map((seg, index) => {
                  const isSegActive = seg.id === activeTurnId;
                  const hasAlert = hasAlertMarkers(seg.text);
                  if (hasAlert) {
                    return (
                      <div
                        key={seg.id || `${combinedMsg.id}-seg-${index}`}
                        id={seg.id}
                        onClick={() => seekToTime && seekToTime(seg.startSeconds || 0)}
                        className="my-1"
                      >
                        {renderTextWithAlerts(seg.text)}
                      </div>
                    );
                  }
                  return (
                    <span
                      key={seg.id || `${combinedMsg.id}-seg-${index}`}
                      id={seg.id}
                      onClick={() => seekToTime && seekToTime(seg.startSeconds || 0)}
                      className={`inline cursor-pointer transition-colors duration-150 rounded-sm mr-1 ${isSegActive
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

          <div className="absolute -top-3 right-4 bg-white dark:bg-[#1e1f22] shadow-md dark:shadow-lg border border-slate-100/80 dark:border-white/5 rounded-full px-2.5 py-1 flex items-center gap-2.5 opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0 transition-all duration-300 z-10" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => handleAskAi(combinedMsg)}
              className="text-slate-400 hover:text-[#ff7d54] hover:scale-110 transition-all p-0.5 cursor-pointer flex items-center justify-center"
              title="Ask AI about this transcript group"
            >
              <Sparkles size={13} />
            </button>

            {(() => {
              const isAdded = (() => {
                if (!studyNotesText || !combinedMsg.text) return false;
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
                  onClick={() => handleAddToNotes(combinedMsg)}
                  disabled={addingToNotesId !== null || isAdded}
                  className={`hover:scale-110 transition-all p-0.5 cursor-pointer flex items-center justify-center disabled:scale-100 disabled:cursor-not-allowed ${isAdded ? "text-emerald-500" : "text-slate-400 hover:text-[#ff7d54]"
                    }`}
                  title={isAdded ? "Already added to Notes" : "Add to Deep Notes"}
                >
                  {addingToNotesId === combinedMsg.id ? (
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
              onClick={() => toggleStar(combinedMsg)}
              className={`hover:scale-110 transition-all p-0.5 cursor-pointer flex items-center justify-center ${isStarred ? "text-amber-500 hover:text-amber-600" : "text-slate-400 hover:text-amber-500"
                }`}
              title={isStarred ? "Starred" : "Star / Bookmark"}
            >
              <Star size={13} className={isStarred ? "fill-amber-500" : "fill-transparent"} />
            </button>

            <button
              onClick={() => handleTranslate(combinedMsg)}
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

  const isStuckStatus = ["paused", "failed", "cancelled"].includes(processingStatus.toLowerCase());
  if (openingSavedTranscript) {
    return <SavedContentLoader message="Opening your saved transcript..." />;
  }

  if (processingStatus !== "ready" && !isRegenerating && !isStuckStatus) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center space-y-4">
        <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
        <p className="text-gray-500 font-semibold text-sm">Processing in pipeline ({processingStatus})...</p>
      </div>
    );
  }

  if (isStuckStatus) {
    return (
      <div className="flex-1 flex flex-col min-h-0 relative">
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
    <div className="flex-1 flex flex-col space-y-8 min-h-0">
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
      {/* Top Timer Section */}
      <div className="flex flex-col items-center justify-center text-center py-6 bg-neutral-50/50 rounded-2xl border border-neutral-100/80 dark:border-white/5 p-8 shrink-0">
        <div className="flex items-center space-x-2 mb-3">
          {isRecording ? (
            <>
              <span className="w-3.5 h-3.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-sm font-bold text-emerald-500 tracking-wider uppercase select-none">
                Playing...
              </span>
            </>
          ) : (
            <>
              <span className="w-3.5 h-3.5 rounded-full bg-neutral-400"></span>
              <span className="text-sm font-bold text-neutral-500 tracking-wider uppercase select-none">
                Paused
              </span>
            </>
          )}
        </div>

        {/* Large Timer Display */}
        <h1 className="font-mono text-7xl md:text-8xl font-bold text-[#1A1A1A] tracking-normal tabular-nums my-2">
          {formatTime(timerSeconds)}
        </h1>

        <div className="font-sans text-lg font-bold text-neutral-600 tracking-tight mt-1 flex items-center justify-center gap-2">
          <span>{title || "Product team standup"}</span>
          <button
            onClick={triggerRegenerate}
            disabled={isRegenerating || !resourceId}
            className="flex-shrink-0 p-1.5 bg-neutral-100 border border-neutral-200 hover:bg-neutral-200 text-neutral-600 rounded-full transition-all cursor-pointer"
            title="Regenerate Transcript"
          >
            <RefreshCw size={14} className={isRegenerating ? "animate-spin" : ""} />
          </button>
          <button
            onClick={handleRetryChapters}
            disabled={isRegeneratingChapters || !resourceId || !token}
            className="flex-shrink-0 p-1.5 bg-amber-50 border border-amber-200 hover:bg-amber-100 text-amber-700 rounded-full transition-all cursor-pointer flex items-center justify-center"
            title="Regenerate Chapters & Subchapters"
          >
            <BookOpen size={14} className={isRegeneratingChapters ? "animate-pulse" : ""} />
          </button>
          {((pendingReindex === true) || (typeof pendingReindex === "string" && (pendingReindex === "outdated" || pendingReindex.includes("transcript") || pendingReindex.includes("structure")))) && (
            <button
              onClick={handleReindex}
              disabled={isReindexing || !resourceId || !token}
              className="flex-shrink-0 px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full transition-all cursor-pointer flex items-center justify-center font-bold text-xs gap-1 shadow-xs border-none outline-none"
              title="Re-Index for RAG"
            >
              {isReindexing ? (
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <Sparkles size={10} />
              )}
              <span>Re-index RAG</span>
            </button>
          )}
        </div>
      </div>

      {/* Search Input section */}
      <div className="px-1 flex items-center gap-3 shrink-0">
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
      </div>

      {isRegenerating && regenerationStatus && (
        <div className="px-1 shrink-0">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
            <Loader2 size={12} className="animate-spin" />
            <span>{regenerationStatus === "generating local timestamps..." ? "Generating local timestamps with your Whisper engine..." : regenerationStatus}</span>
          </div>
        </div>
      )}

      {/* Segmented Timeline scrolling area (original message design grouped by chapter) */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto pr-3 no-scrollbar scroll-smooth min-h-0 space-y-6">
        {groupedData.type === 'grouped' ? (
          groupedData.data.map(chapter => (
            <div key={chapter.id} className="space-y-4">
              <TranscriptChapterHeader
                title={chapter.title}
                timeLabel={formatSeconds(chapter.start_time || 0)}
                collapsed={Boolean(collapsedChapters[chapter.id])}
                onToggle={(e) => toggleChapter(chapter.id, e)}
                onSeek={() => seekToTime && seekToTime(chapter.start_time || 0)}
              />

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

      {/* Control Buttons Bar */}
      <div className="flex justify-center space-x-4 pt-4 border-t border-neutral-100 shrink-0">
        {isRecording ? (
          <button
            id="btn-pause-rec"
            onClick={() => setIsRecording(false)}
            className="flex items-center justify-center space-x-3 border-0 bg-[#ECEAEB] hover:bg-[#E2DFE1] text-[#1D1D1F] px-12 py-3.5 rounded-full font-bold text-base tracking-wide transition cursor-pointer active:scale-98 shadow-sm"
          >
            <Pause className="w-4 h-4 fill-current" />
            <span>Pause</span>
          </button>
        ) : (
          <button
            id="btn-resume-rec"
            onClick={() => setIsRecording(true)}
            className="flex items-center justify-center space-x-3 border-0 bg-neutral-800 hover:bg-neutral-900 text-white px-12 py-3.5 rounded-full font-bold text-base tracking-wide transition cursor-pointer active:scale-98 shadow-sm"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>Resume</span>
          </button>
        )}

        <button
          id="btn-stop-rec"
          onClick={onStopRecording}
          className="flex items-center justify-center space-x-3 border-0 bg-[#E97677] hover:bg-[#E06466] text-white px-12 py-3.5 rounded-full font-bold text-base tracking-wide transition cursor-pointer active:scale-98 shadow-sm"
        >
          <Square className="w-4 h-4 fill-current" />
          <span>Stop</span>
        </button>
      </div>

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
