import React, { useState, useRef, useEffect } from 'react';
import { Header } from './components/Header';
import { RightPane } from './components/RightPane';
import { TranscriptView } from './components/TranscriptView';
import { SummaryView } from './components/SummaryView';
import { AiOverlay } from './components/AiOverlay';
import { FlashcardView } from './components/FlashcardView';
import { QuizView } from './components/QuizView';
import { MindMapView } from './components/MindMapView';
import { AskAiView } from './components/AskAiView';
import { NotesView } from './components/NotesView';
import { ExternalLink, Loader2 } from 'lucide-react';
import { ToastContainer, type ToastMessage } from '../FileExplorer/Toast';
import './index.css';


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

export default function VideoPlayerApp() {
  const [activeTab, setActiveTab] = useState('Transcript');
  const [isAiOpen, setIsAiOpen] = useState(false);
  const [pendingAiQuery, setPendingAiQuery] = useState('');
  const srtLoadedRef = useRef(false);

  // Data fetching state
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [subtitlesVttUrl, setSubtitlesVttUrl] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<any[]>([]);
  const [chapters, setChapters] = useState<any[]>([]);
  const [subchapters, setSubchapters] = useState<any[]>([]);
  const [resourceTitle, setResourceTitle] = useState<string>("Loading...");
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
  const [loading, setLoading] = useState(true);
  const [processingStatus, setProcessingStatus] = useState<string>("ready");
  const [pendingReindex, setPendingReindex] = useState<boolean | string>(false);
  const [starredLines, setStarredLines] = useState<any[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastIdRef = useRef(0);

  const addToast = (text: string, type: ToastMessage["type"] = "info") => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, text, type }]);
  };

  const removeToast = (id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  // Playlist and Folder info for back navigation
  const [playlistId, setPlaylistId] = useState<string | null>(null);
  const [playlistName, setPlaylistName] = useState<string>("");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [folderName, setFolderName] = useState<string>("");


  // Draggable columns state - default to 60% split as requested (60% left, 40% right)
  const [leftWidthPercentage, setLeftWidthPercentage] = useState(60);
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Active chapter state for transcript filtering
  const [, setActiveChapterId] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [seekTime, setSeekTime] = useState<number | null>(null);
  const [activeSubtitle, setActiveSubtitle] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let vSrc = params.get("videoUrl");
    if (vSrc) {
      try {
        const urlObj = new URL(vSrc);
        vSrc = urlObj.pathname + urlObj.search;
      } catch (e) { }
    }
    const rId = params.get("resourceId");
    const tok = params.get("token") || localStorage.getItem("access_token");
    const requestedTime = Number(params.get("t"));
    if (Number.isFinite(requestedTime) && requestedTime >= 0) setSeekTime(requestedTime);

    setResourceId(rId);
    setToken(tok);

    if (rId && tok) {
      fetch(`/resources/${rId}/details`, {
        headers: { 'Authorization': `Bearer ${tok}` }
      })
        .then(res => res.json())
        .then(data => {
          if (data.resource) {
            if (data.resource.transcript && !srtLoadedRef.current) {
              setTranscript(parseTranscript(data.resource.transcript));
            }
            if (data.resource.title) setResourceTitle(data.resource.title);
            if (data.resource.summary) setSummary(data.resource.summary);
            setProcessingStatus(data.resource.processing_status);
            setPendingReindex(resolvePendingReindexState(data.resource.is_embedded));
            if (data.resource.folder_path) setFolderPath(data.resource.folder_path);
            if (data.resource.created_at) setCreatedAt(data.resource.created_at);
            if (data.resource.duration_seconds) setDurationSeconds(data.resource.duration_seconds);
            if (data.resource.playlist_id) setPlaylistId(data.resource.playlist_id);
            if (data.resource.playlist_name) setPlaylistName(data.resource.playlist_name);
            if (data.resource.folder_id) setFolderId(data.resource.folder_id);
            if (data.resource.folder_name) setFolderName(data.resource.folder_name);
          }
          if (data.chapters) setChapters(data.chapters);
          if (data.subchapters) setSubchapters(data.subchapters);
        })
        .catch(err => console.error("Failed to load details:", err))
        .finally(() => setLoading(false));

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

      if (vSrc) {
        fetch(vSrc, { headers: { 'Authorization': `Bearer ${tok}` } })
          .then(res => {
            if (!res.ok) throw new Error("Video download failed");
            return res.blob();
          })
          .then(blob => {
            const url = URL.createObjectURL(blob);
            setVideoUrl(url);
          })
          .catch(err => console.error("Failed to load video file:", err));
      }

      fetch(`/resources/${rId}/srt`, { headers: { 'Authorization': `Bearer ${tok}` } })
        .then(res => {
          if (!res.ok) throw new Error("SRT download failed or not available");
          return res.text();
        })
        .then(srtText => {
          if (srtText && srtText.trim()) {
            srtLoadedRef.current = true;
            setTranscript(parseTranscript(srtText));
          }
          const vttText = convertSrtToVtt(srtText);
          const blob = new Blob([vttText], { type: 'text/vtt' });
          const url = URL.createObjectURL(blob);
          setSubtitlesVttUrl(url);
        })
        .catch(err => {
          console.warn("Failed to load SRT file:", err);
        });
    } else {
      setLoading(false);
    }
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

            // Once ready, refresh all the state data silently
            if (data.resource.processing_status === "ready") {
              if (data.resource.transcript && !srtLoadedRef.current) setTranscript(parseTranscript(data.resource.transcript));
              if (data.resource.summary) setSummary(data.resource.summary);
              if (data.resource.title) setResourceTitle(data.resource.title);
              if (data.resource.folder_path) setFolderPath(data.resource.folder_path);
              if (data.resource.created_at) setCreatedAt(data.resource.created_at);
              if (data.resource.duration_seconds) setDurationSeconds(data.resource.duration_seconds);
              if (data.chapters) setChapters(data.chapters);
              if (data.subchapters) setSubchapters(data.subchapters);
            }
          }
        })
        .catch(err => console.error("Error polling pipeline status:", err));
    }, 3000);

    return () => clearInterval(intervalId);
  }, [processingStatus, resourceId, token]);

  const startResizing = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const relativeX = e.clientX - containerRect.left;
      const percentage = (relativeX / containerRect.width) * 100;

      // Limit left panel width to strictly between 50% and 60% (meaning right panel stays between 40% and 50%)
      if (percentage >= 50 && percentage <= 60) {
        setLeftWidthPercentage(percentage);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  const tabs = ['Summary', 'Transcript', 'Flashcard', 'Quiz', 'Mind Map', 'Notes', 'Ask AI'];

  const processedTranscript = transcript;

  const handleBack = () => {
    const params = new URLSearchParams();
    params.set("view", "folder");
    if (playlistId) {
      params.set("playlistId", playlistId);
    }
    if (playlistName) {
      params.set("playlistName", playlistName);
    }
    // Only pass folderId if it is a real subfolder (i.e. name is not "root" or "resources")
    if (folderId && folderName && folderName !== "root" && folderName !== "resources") {
      params.set("folderId", folderId);
    }
    if (token) {
      params.set("token", token);
    }
    window.location.href = `/?${params.toString()}`;
  };

  const handleOpenInKnowledge = () => {
    const params = new URLSearchParams({ view: "concepts" });
    if (resourceId) params.set("resourceId", resourceId);
    window.location.href = `/?${params.toString()}`;
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

  return (
    <div className="video-player-page-root w-screen h-screen bg-[#eaeaea] dark:bg-[#2b2d31] dark:text-[#f2f3f5] flex items-center justify-center font-sans overflow-hidden">
      <ToastContainer toasts={toasts} onDismiss={removeToast} />

      {/* Main App Container */}
      <div className="w-full h-full flex flex-col relative overflow-hidden">

        <Header
          title={resourceTitle}
          folderPath={folderPath}
          createdAt={createdAt}
          durationSeconds={durationSeconds}
          chaptersCount={chapters.length}
          subchaptersCount={subchapters.length}
          onBack={handleBack}
          pendingReindex={pendingReindex}
        />

        <div ref={containerRef} className="flex-1 flex overflow-hidden relative z-10 -mt-4 bg-white dark:bg-[#1e1f22] rounded-t-[20px] shadow-sm">

          {/* Glass Overlay to block video/iframe captures when dragging */}
          {isResizing && (
            <div className="absolute inset-0 z-50 cursor-col-resize select-none bg-transparent" />
          )}

          {/* Left Pane (Tabs & Content) */}
          <div
            style={{ width: `${leftWidthPercentage}%` }}
            className="flex flex-col relative z-[1] bg-white dark:bg-[#1e1f22] pb-6 pt-4 flex-shrink-0 overflow-visible"
          >

            {/* Tabs Setup */}
            <div className="px-8 flex items-center flex-wrap gap-2 mb-5">
              {tabs.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4.5 py-2.5 rounded-full text-[14px] font-semibold transition-all cursor-pointer ${activeTab === tab
                    ? 'bg-[#1a1a1a] dark:bg-white text-white dark:text-slate-900 shadow-sm scale-110 font-bold'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Content Switcher */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {loading ? (
                <div className="flex flex-col items-center justify-center h-full">
                  <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mb-4" />
                  <p className="text-gray-500 font-semibold text-sm">Loading resource details...</p>
                </div>
              ) : (
                <>
                  {activeTab === 'Summary' && (
                    <div className="flex-1 flex flex-col overflow-hidden">
                      <SummaryView
                        transcript={processedTranscript}
                        summary={summary}
                        resourceId={resourceId}
                        token={token}
                        onSummaryUpdated={(nextSummary) => setSummary(nextSummary)}
                        onPendingReindexChange={setPendingReindex}
                        pendingReindex={pendingReindex}
                        onSeek={setSeekTime}
                      />
                    </div>
                  )}
                  {activeTab === 'Transcript' && (
                    <TranscriptView
                      transcript={transcript}
                      chapters={chapters}
                      subchapters={subchapters}
                      currentTime={currentTime}
                      activeSubtitle={activeSubtitle}
                      onSeekTo={setSeekTime}
                      resourceId={resourceId}
                      token={token}
                      processingStatus={processingStatus}
                      setProcessingStatus={setProcessingStatus}
                      onStructureUpdated={(next) => {
                        if (next.chapters) setChapters(next.chapters);
                        if (next.subchapters) setSubchapters(next.subchapters);
                      }}
                      onTranscriptUpdated={setTranscript}
                      onPendingReindexChange={setPendingReindex}
                      pendingReindex={pendingReindex}
                      onAskAi={(query) => {
                        setPendingAiQuery(query);
                        setActiveTab('Ask AI');
                      }}
                      starredLines={starredLines}
                      onToggleStar={toggleStar}
                    />
                  )}
                  {activeTab === 'Flashcard' && <FlashcardView transcript={processedTranscript} resourceId={resourceId} token={token} initialFlashcards={initialFlashcards} onFlashcardsGenerated={(data) => setInitialFlashcards(data)} />}
                  {activeTab === 'Quiz' && <QuizView transcript={processedTranscript} resourceId={resourceId} token={token} initialQuiz={initialQuiz} onQuizGenerated={(data) => setInitialQuiz(data)} />}
                  {activeTab === 'Mind Map' && <MindMapView transcript={processedTranscript} resourceId={resourceId} token={token} initialMindmap={initialMindmap} onMindmapGenerated={(data) => setInitialMindmap(data)} />}
                  {activeTab === 'Notes' && <NotesView resourceId={resourceId} token={token} onSeek={setSeekTime} initialNotes={initialNotes} onNotesGenerated={(notes) => setInitialNotes(notes)} />}
                  <div className={activeTab === 'Ask AI' ? 'flex-1 flex flex-col overflow-hidden' : 'hidden'}>
                    <AskAiView
                      isActive={activeTab === 'Ask AI'}
                      initialQuestion={pendingAiQuery}
                      onClearInitialQuestion={() => setPendingAiQuery('')}
                      transcript={processedTranscript}
                      resourceId={resourceId}
                      token={token}
                      onSeek={setSeekTime}
                    />
                  </div>
                </>
              )}
            </div>

            {/* AI Floating Card Overlay - Hidden for now */}
            {/* {activeTab !== 'Ask AI' && !loading && (
              <AiOverlay
                isOpen={isAiOpen}
                onOpen={() => setIsAiOpen(true)}
                onClose={() => setIsAiOpen(false)}
                onSubmitQuery={(text) => {
                  setPendingAiQuery(text);
                  setActiveTab('Ask AI');
                }}
              />
            )} */}

          </div>

          {/* Interactive Resize Divider handle bar */}
          <div
            onMouseDown={startResizing}
            className={`w-1.5 h-full cursor-col-resize select-none flex-shrink-0 flex items-center justify-center transition-colors z-30 ${isResizing ? 'bg-[#ff7d54]' : 'bg-slate-100 dark:bg-zinc-800 hover:bg-[#ff7d54]/50'
              }`}
          >
            {/* Grab handle strip indicator */}
            <div className={`w-0.5 h-10 rounded-full transition-colors ${isResizing ? 'bg-white' : 'bg-slate-300 dark:bg-zinc-650'
              }`} />
          </div>

          {/* Right Pane (Video & Timeline & Transcript) */}
          <RightPane
            videoUrl={videoUrl}
            subtitlesVttUrl={subtitlesVttUrl}
            chapters={chapters}
            subchapters={subchapters}
            transcript={processedTranscript}
            onActiveChapterChange={setActiveChapterId}
            onTimeUpdate={setCurrentTime}
            onSubtitleChange={setActiveSubtitle}
            seekTime={seekTime}
            onSeekComplete={() => setSeekTime(null)}
            starredLines={starredLines}
            onToggleStar={toggleStar}
          />

        </div>

      </div>
    </div>
  );
}

