import React, { useState, useRef, useEffect } from "react";
import { Mic, FileText, HelpCircle, BookOpen, Network, MessageCircle, AlertCircle, ExternalLink } from "lucide-react";
import { ToastContainer, type ToastMessage } from "../FileExplorer/Toast";
import TranscriptTab from "./TranscriptTab";
import SummaryTab from "./SummaryTab";
import QuizTab from "./QuizTab";
import FlashcardTab from "./FlashcardTab";
import MindMapTab from "./MindMapTab";
import AskAiTab from "./AskAiTab";
import NotesTab from "./NotesTab";
import { AudioHeader } from "./AudioHeader";
import type { TranscriptItem } from "./types";
import type { ActiveTranscriptCue } from "../../hooks/useTranscriptSync";

import { parseTranscript } from '../../utils/transcriptUtils';

function convertSrtToVtt(srtText: string): string {
  const normalized = srtText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const vttBody = normalized.replace(
    /(\d{2}:\d{2}:\d{2}),(\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}),(\d{3})/g,
    '$1.$2 --> $3.$4'
  );
  return `WEBVTT\n\n${vttBody}`;
}

function resolvePendingReindexState(value: unknown): boolean | string {
  if (typeof value !== "string") return false;
  if (value === "outdated" || value.startsWith("outdated:")) return value;
  return false;
}

export default function AudioPlayerApp() {
  const [activeTab, setActiveTab] = useState<"transcript" | "summary" | "quiz" | "flashcard" | "mindmap" | "notes" | "ask">("transcript");
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [timerSeconds, setTimerSeconds] = useState<number>(0);
  const [showInfoBanner, setShowInfoBanner] = useState<boolean>(true);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [subtitlesVttUrl, setSubtitlesVttUrl] = useState<string | null>(null);
  const [activeCue, setActiveCue] = useState<ActiveTranscriptCue | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const initialSeekTimeRef = useRef<number | null>(null);
  const playPromiseRef = useRef<Promise<void> | null>(null);
  const prevAudioUrlRef = useRef<string | null>(null);
  const prevVttUrlRef = useRef<string | null>(null);
  const srtLoadedRef = useRef(false);
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [chapters, setChapters] = useState<any[]>([]);
  const [subchapters, setSubchapters] = useState<any[]>([]);
  const [resourceTitle, setResourceTitle] = useState<string>("Product team standup");
  const [folderPath, setFolderPath] = useState<string>("No Folder Selected");
  const [createdAt, setCreatedAt] = useState<string | undefined>(undefined);
  const [durationSeconds, setDurationSeconds] = useState<number>(0);
  const [resourceId, setResourceId] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  // Pre-fetched tab data: undefined = not yet checked, null = checked & not found, data = found
  const [initialFlashcards, setInitialFlashcards] = useState<any[] | null | undefined>(undefined);
  const [initialQuiz, setInitialQuiz] = useState<any[] | null | undefined>(undefined);
  const [initialMindmap, setInitialMindmap] = useState<any | null | undefined>(undefined);
  const [initialNotes, setInitialNotes] = useState<string | null | undefined>(undefined);
  const [processingStatus, setProcessingStatus] = useState<string>("ready");
  const [starredLines, setStarredLines] = useState<any[]>([]);
  const [pendingAiQuery, setPendingAiQuery] = useState<string>("");
  const [pendingReindex, setPendingReindex] = useState<boolean | string>(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastIdRef = useRef(0);

  const addToast = (text: string, type: "success" | "error" | "info" = "info") => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, text, type }]);
  };
  const removeToast = (id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const prevStatusRef = useRef(processingStatus);
  useEffect(() => {
    if (prevStatusRef.current !== processingStatus) {
      if (prevStatusRef.current && ["queued", "indexing", "embedding", "chaptering"].includes(prevStatusRef.current)) {
        if (processingStatus === "ready") {
          addToast("Re-indexing and re-embedding completed successfully!", "success");
        } else if (processingStatus === "failed") {
          addToast("Re-indexing and re-embedding failed.", "error");
        }
      }
      prevStatusRef.current = processingStatus;
    }
  }, [processingStatus]);

  // Query Params Extraction and Fetch Data
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let audioSrc = params.get("audioUrl");
    if (audioSrc) {
      try {
        const urlObj = new URL(audioSrc);
        audioSrc = urlObj.pathname + urlObj.search;
      } catch (e) {
        // Fallback if already relative
      }
    }
    const rId = params.get("resourceId");
    const tok = params.get("token") || localStorage.getItem("access_token");
    const requestedTime = Number(params.get("t"));
    initialSeekTimeRef.current = Number.isFinite(requestedTime) && requestedTime >= 0 ? requestedTime : null;

    setResourceId(rId);
    setToken(tok);

    if (rId && tok) {
      // 1. Fetch resource details (metadata, chapters, subchapters)
      fetch(`/resources/${rId}/details`, {
        headers: {
          'Authorization': `Bearer ${tok}`
        }
      })
        .then(res => res.json())
        .then(data => {
          if (data.resource) {
            setProcessingStatus(data.resource.processing_status);
            setPendingReindex(resolvePendingReindexState(data.resource.is_embedded));
            if (data.resource.transcript && !srtLoadedRef.current) {
              setTranscript(parseTranscript(data.resource.transcript));
            }
            if (data.resource.title) {
              setResourceTitle(data.resource.title);
            }
            if (data.resource.summary) {
              setSummary(data.resource.summary);
            }
            if (data.resource.folder_path) setFolderPath(data.resource.folder_path);
            if (data.resource.created_at) setCreatedAt(data.resource.created_at);
            if (data.resource.duration_seconds != null && data.resource.duration_seconds > 0) setDurationSeconds(data.resource.duration_seconds);
          }
          if (data.chapters) {
            setChapters(data.chapters);
          }
          if (data.subchapters) {
            setSubchapters(data.subchapters);
          }
        })
        .catch(err => console.error("Failed to load details from backend:", err));

      fetch(`/resources/${rId}/starred`, {
        headers: { 'Authorization': `Bearer ${tok}` }
      })
        .then(res => res.json())
        .then(data => {
          if (data.starred) {
            setStarredLines(data.starred);
          }
        })
        .catch(err => console.error("Failed to load starred lines:", err));

      // Pre-fetch all tab data in parallel so tabs know their loader state from frame 1
      fetch(`/resources/${rId}/flashcards`, { headers: { 'Authorization': `Bearer ${tok}` } })
        .then(res => res.ok ? res.json() : null)
        .then(data => setInitialFlashcards(data && data.length > 0 ? data : null))
        .catch(() => setInitialFlashcards(null));

      fetch(`/resources/${rId}/quiz`, { headers: { 'Authorization': `Bearer ${tok}` } })
        .then(res => res.ok ? res.json() : null)
        .then(data => setInitialQuiz(data && data.length > 0 ? data : null))
        .catch(() => setInitialQuiz(null));

      fetch(`/resources/${rId}/mindmap`, { headers: { 'Authorization': `Bearer ${tok}` } })
        .then(res => res.ok ? res.json() : null)
        .then(data => setInitialMindmap(data || null))
        .catch(() => setInitialMindmap(null));

      fetch(`/resources/${rId}/notes`, { headers: { 'Authorization': `Bearer ${tok}` } })
        .then(res => res.ok ? res.json() : null)
        .then(data => setInitialNotes(data?.notes?.trim() ? data.notes : null))
        .catch(() => setInitialNotes(null));

      // 2. Fetch audio file
      if (audioSrc) {
        fetch(audioSrc, {
          headers: {
            'Authorization': `Bearer ${tok}`
          }
        })
          .then(res => {
            if (!res.ok) throw new Error("Audio download failed");
            return res.blob();
          })
          .then(blob => {
            const url = URL.createObjectURL(blob);
            setAudioUrl(url);
          })
          .catch(err => console.error("Failed to load audio file:", err));
      }

      // 3. Fetch SRT transcript and parse it for real timestamps
      fetch(`/resources/${rId}/srt`, { headers: { 'Authorization': `Bearer ${tok}` } })
        .then(res => {
          if (!res.ok) throw new Error("SRT download failed or not available");
          return res.text();
        })
        .then(srtText => {
          if (srtText && srtText.trim()) {
            srtLoadedRef.current = true;
            setTranscript(parseTranscript(srtText));
            const vttText = convertSrtToVtt(srtText);
            const vttBlob = new Blob([vttText], { type: 'text/vtt' });
            const vttUrl = URL.createObjectURL(vttBlob);
            setSubtitlesVttUrl(vttUrl);
          }
        })
        .catch(err => console.warn("Failed to load SRT file:", err));
    }
  }, []);

  useEffect(() => {
    if (prevAudioUrlRef.current && prevAudioUrlRef.current !== audioUrl) {
      URL.revokeObjectURL(prevAudioUrlRef.current);
    }
    prevAudioUrlRef.current = audioUrl;
  }, [audioUrl]);

  useEffect(() => {
    if (prevVttUrlRef.current && prevVttUrlRef.current !== subtitlesVttUrl) {
      URL.revokeObjectURL(prevVttUrlRef.current);
    }
    prevVttUrlRef.current = subtitlesVttUrl;
  }, [subtitlesVttUrl]);

  useEffect(() => {
    return () => {
      const audio = audioRef.current;
      if (audio) {
        playPromiseRef.current = null;
        audio.pause();
      }
      if (prevAudioUrlRef.current) {
        URL.revokeObjectURL(prevAudioUrlRef.current);
      }
      if (prevVttUrlRef.current) {
        URL.revokeObjectURL(prevVttUrlRef.current);
      }
    };
  }, []);

  // Poll for pipeline status when processing
  useEffect(() => {
    if (processingStatus === "ready" || !resourceId || !token) return;

    const intervalId = setInterval(() => {
      fetch(`/resources/${resourceId}/details`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
        .then(res => res.json())
        .then(data => {
          if (data.resource && data.resource.processing_status) {
            setProcessingStatus(data.resource.processing_status);
            setPendingReindex(resolvePendingReindexState(data.resource.is_embedded));

            if (data.resource.processing_status === "ready") {
              if (data.resource.transcript) setTranscript(parseTranscript(data.resource.transcript));
              if (data.resource.summary) setSummary(data.resource.summary);
              if (data.chapters) setChapters(data.chapters);
              if (data.subchapters) setSubchapters(data.subchapters);
            }
          }
        })
        .catch(err => console.error("Error polling pipeline status:", err));
    }, 3000);

    return () => clearInterval(intervalId);
  }, [processingStatus, resourceId, token]);

  // Sync Timer with Audio Current Time and Playback State
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    let animationFrameId: number;

    const syncActiveCueFromTrack = () => {
      const track = audio.textTracks?.[0];
      if (!track?.activeCues?.length) {
        setActiveCue(prev => (prev ? null : prev));
        return;
      }

      const cue = track.activeCues[0] as VTTCue | TextTrackCue;
      const cueText = ((cue as VTTCue).text || "").trim();
      const nextCue = {
        startTime: cue.startTime,
        endTime: cue.endTime,
        text: cueText,
      };

      setActiveCue(prev => {
        if (
          prev &&
          prev.startTime === nextCue.startTime &&
          prev.endTime === nextCue.endTime &&
          prev.text === nextCue.text
        ) {
          return prev;
        }
        return nextCue;
      });
    };

    const handleTimeUpdate = () => {
      // Don't floor the time for the transcript sync to allow smooth high-frequency polling
      setTimerSeconds(audio.currentTime);
      syncActiveCueFromTrack();
    };

    const updateLoop = () => {
      if (!audio.paused && !audio.ended) {
        handleTimeUpdate();
        animationFrameId = requestAnimationFrame(updateLoop);
      }
    };

    const handlePlay = () => {
      updateLoop();
    };

    const handlePauseOrSeek = () => {
      handleTimeUpdate();
    };

    const handleEnded = () => {
      handleTimeUpdate();
      setIsRecording(false);
      setActiveCue(null);
    };

    const handleLoadedMetadata = () => {
      handleTimeUpdate();
      const track = audio.textTracks?.[0];
      if (track) {
        track.mode = "hidden";
      }
    };

    const handleCueChange = () => {
      syncActiveCueFromTrack();
    };

    const handleError = () => {
      console.error("Audio element error:", audio.error);
      setIsRecording(false);
    };

    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePauseOrSeek);
    audio.addEventListener('seeked', handlePauseOrSeek);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("error", handleError);

    const track = audio.textTracks?.[0];
    if (track) {
      track.mode = "hidden";
      track.addEventListener("cuechange", handleCueChange);
    }

    if (!audio.paused && !audio.ended) {
      updateLoop();
    }

    return () => {
      cancelAnimationFrame(animationFrameId);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePauseOrSeek);
      audio.removeEventListener('seeked', handlePauseOrSeek);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("error", handleError);
      track?.removeEventListener("cuechange", handleCueChange);
    };
  }, [audioUrl, subtitlesVttUrl]);

  const handlePlayPause = async (play: boolean) => {
    const audio = audioRef.current;
    if (!audio) return;

    if (play) {
      if (playPromiseRef.current) return;
      try {
        const p = audio.play();
        playPromiseRef.current = p;
        await p;
        setIsRecording(true);
      } catch (e: any) {
        if (e?.name !== "AbortError") {
          console.error("Audio playback error:", e);
        }
      } finally {
        playPromiseRef.current = null;
      }
    } else {
      playPromiseRef.current = null;
      audio.pause();
      setIsRecording(false);
    }
  };

  const handleStopAudio = () => {
    const audio = audioRef.current;
    if (!audio) return;
    playPromiseRef.current = null;
    audio.pause();
    audio.currentTime = 0;
    setIsRecording(false);
    setTimerSeconds(0);
    setActiveCue(null);
  };

  const toggleStar = async (msg: any) => {
    if (!resourceId || !token) return;
    const isAlreadyStarred = starredLines.some((x: any) => x.id === msg.id);
    let newStarred: any[];
    if (isAlreadyStarred) {
      newStarred = starredLines.filter((x: any) => x.id !== msg.id);
    } else {
      newStarred = [...starredLines, {
        id: msg.id,
        speaker: msg.name || msg.speaker || "Speaker",
        time: msg.time || "00:00",
        text: msg.text || ""
      }];
    }
    setStarredLines(newStarred);
    try {
      const res = await fetch(`/resources/${resourceId}/starred`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ starred: newStarred })
      });
      if (!res.ok) {
        throw new Error("Failed to save starred lines");
      }
    } catch (err) {
      console.error("Failed to save starred lines to database:", err);
      addToast("Failed to save starred transcript to database.", "error");
    }
  };

  const handleCloseCall = () => {
      if (confirm("Are you sure you want to exit the study companion?")) {
      audioRef.current?.pause();
      window.close();
    }
  };

  const handleOpenInKnowledge = () => {
    const params = new URLSearchParams({ view: "concepts" });
    if (resourceId) params.set("resourceId", resourceId);
    window.location.href = `/?${params.toString()}`;
  };

  return (
    <div className="h-screen w-screen flex flex-col font-sans selection:bg-neutral-800 selection:text-white bg-[#FCFCFD] dark:bg-[#1e1f22] dark:text-[#f2f3f5] overflow-hidden">

      {/* Main Container Card occupying full screen */}
      <div className="w-full h-full flex flex-col overflow-hidden bg-[#FCFCFD] dark:bg-[#1e1f22]">

        {/* Header bar matching the video player style */}
        <AudioHeader
          title={resourceTitle}
          folderPath={folderPath}
          createdAt={createdAt}
          durationSeconds={durationSeconds}
          chaptersCount={chapters.length}
          subchaptersCount={subchapters.length}
          onBack={handleCloseCall}
          pendingReindex={pendingReindex}
        />

        {/* Content area overlapping header like video player */}
        <div className="flex-1 flex flex-col overflow-hidden relative z-10 -mt-4 bg-white dark:bg-[#1e1f22] rounded-t-[20px] shadow-sm">

        {/* Floating Developer Instruction Banner */}
        {showInfoBanner && (
          <div className="bg-neutral-50 px-8 py-4 border-b border-neutral-100 flex items-center justify-between animate-fade-in shrink-0">
            <div className="flex items-center space-x-2.5">
              <AlertCircle className="w-5 h-5 text-neutral-600 animate-pulse-slow font-medium shrink-0" />
              <p className="text-xs md:text-sm font-semibold text-neutral-650 leading-relaxed">
                Study tools interactive sync. Click tabs for <strong>Executive Summary</strong>, <strong>AI Chat assistant</strong>, <strong>Flipping flashcards</strong>, <strong>Mind maps</strong>, and <strong>Interactive Quizzes</strong>!
              </p>
            </div>
            <button
              onClick={() => setShowInfoBanner(false)}
              className="text-xs font-bold text-neutral-400 hover:text-neutral-800 cursor-pointer select-none whitespace-nowrap ml-4"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Tab Selection Area inside the white body */}
        <div className="px-8 pt-7 pb-2 flex justify-center shrink-0">

          {/* Scrollable, highly polished pill container */}
          <div className="bg-[#ECEAEB] dark:bg-white/5 p-1.5 rounded-full flex flex-wrap gap-1.5 items-center max-w-full overflow-x-auto">

            {/* Live Transcript tab */}
            <button
              onClick={() => setActiveTab("transcript")}
              className={`px-6 py-2.5 rounded-full text-xs md:text-sm font-bold tracking-wide transition-all duration-200 select-none cursor-pointer flex items-center space-x-1.5 ${activeTab === "transcript"
                  ? "bg-[#1D1D1F] dark:bg-white text-white dark:text-[#1D1D1F] shadow-xs"
                  : "text-[#585859] dark:text-slate-400 hover:bg-[#E2DFE1] dark:hover:bg-white/10 hover:text-[#1D1D1F] dark:hover:text-white"
                }`}
            >
              <Mic className="w-4 h-4" />
              <span>Transcript & Audio</span>
              {pendingReindex && <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-amber-700">Needs Re-index</span>}
            </button>

            {/* Summary tab */}
            <button
              onClick={() => setActiveTab("summary")}
              className={`px-6 py-2.5 rounded-full text-xs md:text-sm font-bold tracking-wide transition-all duration-200 select-none cursor-pointer flex items-center space-x-1.5 ${activeTab === "summary"
                  ? "bg-[#1D1D1F] dark:bg-white text-white dark:text-[#1D1D1F] shadow-xs"
                  : "text-[#585859] dark:text-slate-400 hover:bg-[#E2DFE1] dark:hover:bg-white/10 hover:text-[#1D1D1F] dark:hover:text-white"
                }`}
            >
              <FileText className="w-4 h-4" />
              <span>Summary</span>
              {pendingReindex && <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-amber-700">Needs Re-index</span>}
            </button>

            {/* Quiz tab */}
            <button
              onClick={() => setActiveTab("quiz")}
              className={`px-6 py-2.5 rounded-full text-xs md:text-sm font-bold tracking-wide transition-all duration-200 select-none cursor-pointer flex items-center space-x-1.5 ${activeTab === "quiz"
                  ? "bg-[#1D1D1F] dark:bg-white text-white dark:text-[#1D1D1F] shadow-xs"
                  : "text-[#585859] dark:text-slate-400 hover:bg-[#E2DFE1] dark:hover:bg-white/10 hover:text-[#1D1D1F] dark:hover:text-white"
                }`}
            >
              <HelpCircle className="w-4 h-4" />
              <span>Quiz</span>
            </button>

            {/* Flashcard tab */}
            <button
              onClick={() => setActiveTab("flashcard")}
              className={`px-6 py-2.5 rounded-full text-xs md:text-sm font-bold tracking-wide transition-all duration-200 select-none cursor-pointer flex items-center space-x-1.5 ${activeTab === "flashcard"
                  ? "bg-[#1D1D1F] dark:bg-white text-white dark:text-[#1D1D1F] shadow-xs"
                  : "text-[#585859] dark:text-slate-400 hover:bg-[#E2DFE1] dark:hover:bg-white/10 hover:text-[#1D1D1F] dark:hover:text-white"
                }`}
            >
              <BookOpen className="w-4 h-4" />
              <span>Flashcard</span>
            </button>

            {/* Mind Map tab */}
            <button
              onClick={() => setActiveTab("mindmap")}
              className={`px-6 py-2.5 rounded-full text-xs md:text-sm font-bold tracking-wide transition-all duration-200 select-none cursor-pointer flex items-center space-x-1.5 ${activeTab === "mindmap"
                  ? "bg-[#1D1D1F] dark:bg-white text-white dark:text-[#1D1D1F] shadow-xs"
                  : "text-[#585859] dark:text-slate-400 hover:bg-[#E2DFE1] dark:hover:bg-white/10 hover:text-[#1D1D1F] dark:hover:text-white"
                }`}
            >
              <Network className="w-4 h-4" />
              <span>Mind Map</span>
            </button>

            {/* Ask AI tab */}
            <button
              onClick={() => setActiveTab("ask")}
              className={`px-6 py-2.5 rounded-full text-xs md:text-sm font-bold tracking-wide transition-all duration-200 select-none cursor-pointer flex items-center space-x-1.5 ${activeTab === "ask"
                  ? "bg-[#1D1D1F] dark:bg-white text-white dark:text-[#1D1D1F] shadow-xs"
                  : "text-[#585859] dark:text-slate-400 hover:bg-[#E2DFE1] dark:hover:bg-white/10 hover:text-[#1D1D1F] dark:hover:text-white"
                }`}
            >
              <MessageCircle className="w-4 h-4" />
              <span>Ask AI</span>
            </button>

            {/* Notes tab */}
            <button
              onClick={() => setActiveTab("notes")}
              className={`px-6 py-2.5 rounded-full text-xs md:text-sm font-bold tracking-wide transition-all duration-200 select-none cursor-pointer flex items-center space-x-1.5 ${activeTab === "notes"
                  ? "bg-[#1D1D1F] dark:bg-white text-white dark:text-[#1D1D1F] shadow-xs"
                  : "text-[#585859] dark:text-slate-400 hover:bg-[#E2DFE1] dark:hover:bg-white/10 hover:text-[#1D1D1F] dark:hover:text-white"
                }`}
            >
              <BookOpen className="w-4 h-4" />
              <span>Deep Notes</span>
            </button>

          </div>
        </div>

        {/* Middle contents with elegant layout padding */}
        <div className="flex-1 px-8 md:px-12 py-6 flex flex-col justify-between min-h-0">
          <audio
            ref={audioRef}
            src={audioUrl ?? undefined}
            preload="metadata"
            className="hidden"
            crossOrigin="anonymous"
            onLoadedMetadata={() => {
              if (audioRef.current && audioRef.current.duration) {
                setDurationSeconds(Math.round(audioRef.current.duration));
                if (initialSeekTimeRef.current !== null) {
                  const nextTime = Math.min(initialSeekTimeRef.current, audioRef.current.duration);
                  audioRef.current.currentTime = nextTime;
                  setTimerSeconds(nextTime);
                  initialSeekTimeRef.current = null;
                }
              }
            }}
          >
            {subtitlesVttUrl && (
              <track
                kind="subtitles"
                src={subtitlesVttUrl}
                srcLang="en"
                label="Transcript"
                default
              />
            )}
          </audio>

          {activeTab === "transcript" && (
            <TranscriptTab
              transcript={transcript}
              setTranscript={setTranscript}
              chapters={chapters}
              subchapters={subchapters}
              isRecording={isRecording}
              setIsRecording={(rec) => handlePlayPause(rec)}
              timerSeconds={timerSeconds}
              setTimerSeconds={setTimerSeconds}
              onStopRecording={handleStopAudio}
              title={resourceTitle}
              seekToTime={(time) => {
                const audio = audioRef.current;
                if (audio) {
                  audio.currentTime = time;
                  audio.play().catch(e => console.error("Seek play request rejected:", e));
                  setIsRecording(true);
                }
              }}
              resourceId={resourceId}
              token={token}
              processingStatus={processingStatus}
              setProcessingStatus={setProcessingStatus}
              onStructureUpdated={(next) => {
                if (next.chapters) setChapters(next.chapters);
                if (next.subchapters) setSubchapters(next.subchapters);
              }}
              onTranscriptUpdated={setTranscript}
              onAskAi={(query) => {
                setPendingAiQuery(query);
                setActiveTab("ask");
              }}
              starredLines={starredLines}
              onToggleStar={toggleStar}
              onPendingReindexChange={setPendingReindex}
              pendingReindex={pendingReindex}
            />
          )}

          {activeTab === "summary" && (
            <div className="flex-1 flex flex-col min-h-0">
              <SummaryTab
                transcript={transcript}
                resourceId={resourceId}
                token={token}
                initialSummary={summary}
                onSummaryUpdated={(nextSummary) => setSummary(nextSummary)}
                onPendingReindexChange={setPendingReindex}
                pendingReindex={pendingReindex}
                onSeek={(time: number) => {
                  const audio = audioRef.current;
                  if (audio) {
                    audio.currentTime = time;
                    audio.play().catch((e: any) => console.error("Seek play request rejected:", e));
                    setIsRecording(true);
                  }
                }}
              />
            </div>
          )}

          {activeTab === "quiz" && (
            <QuizTab
              transcript={transcript}
              resourceId={resourceId}
              token={token}
              initialQuiz={initialQuiz}
              onQuizGenerated={(data) => setInitialQuiz(data)}
            />
          )}

          {activeTab === "flashcard" && (
            <FlashcardTab
              transcript={transcript}
              resourceId={resourceId}
              token={token}
              initialFlashcards={initialFlashcards}
              onFlashcardsGenerated={(data) => setInitialFlashcards(data)}
            />
          )}

          {activeTab === "mindmap" && (
            <MindMapTab
              transcript={transcript}
              resourceId={resourceId}
              token={token}
              initialMindmap={initialMindmap}
              onMindmapGenerated={(data) => setInitialMindmap(data)}
            />
          )}

          <div className={activeTab === "ask" ? "flex-1 flex flex-col min-h-0" : "hidden"}>
            <AskAiTab
              isActive={activeTab === "ask"}
              initialQuestion={pendingAiQuery}
              onClearInitialQuestion={() => setPendingAiQuery('')}
              transcript={transcript}
              resourceId={resourceId}
              token={token}
              onSeek={(time: number) => {
                const audio = audioRef.current;
                if (audio) {
                  audio.currentTime = time;
                  audio.play().catch((e: any) => console.error("Seek play request rejected:", e));
                  setIsRecording(true);
                }
              }}
            />
          </div>

          {activeTab === "notes" && (
            <NotesTab
              resourceId={resourceId}
              token={token}
              initialNotes={initialNotes}
              onNotesGenerated={(notes) => setInitialNotes(notes)}
              onSeek={(time: number) => {
                const audio = audioRef.current;
                if (audio) {
                  audio.currentTime = time;
                  audio.play().catch((e: any) => console.error("Seek play request rejected:", e));
                  setIsRecording(true);
                }
              }}
            />
          )}

        </div>

        </div>

      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </div>

    </div>
  );
}
