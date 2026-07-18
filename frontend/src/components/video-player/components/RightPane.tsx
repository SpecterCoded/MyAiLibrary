import React, { useState } from "react";
import { ChevronDown, ChevronRight, BookOpen, Clock, Star } from "lucide-react";
import { createPlayer } from "@videojs/react";
import { MinimalVideoSkin, Video, videoFeatures } from "@videojs/react/video";
import "@videojs/react/video/minimal-skin.css";

const Player = createPlayer({ features: videoFeatures });

const parseTimeToSeconds = (timeStr: string): number => {
  if (!timeStr) return 0;
  const parts = timeStr.split(":").map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
};

interface RightPaneProps {
  videoUrl?: string | null;
  subtitlesVttUrl?: string | null;
  chapters?: any[];
  subchapters?: any[];
  transcript?: any[];
  onActiveChapterChange?: (chapterId: number | null) => void;
  onTimeUpdate?: (time: number) => void;
  onSubtitleChange?: (text: string) => void;
  seekTime?: number | null;
  onSeekComplete?: () => void;
  starredLines?: any[];
  onToggleStar?: (msg: any) => void;
}

export function RightPane({ 
  videoUrl, 
  subtitlesVttUrl,
  chapters = [], 
  subchapters = [], 
  transcript = [], 
  onActiveChapterChange,
  onTimeUpdate,
  onSubtitleChange,
  seekTime,
  onSeekComplete,
  starredLines = [],
  onToggleStar
}: RightPaneProps) {
  return (
    <Player.Provider>
      <RightPaneContent 
        videoUrl={videoUrl} 
        subtitlesVttUrl={subtitlesVttUrl}
        chapters={chapters} 
        subchapters={subchapters} 
        transcript={transcript} 
        onActiveChapterChange={onActiveChapterChange} 
        onTimeUpdate={onTimeUpdate}
        onSubtitleChange={onSubtitleChange}
        seekTime={seekTime}
        onSeekComplete={onSeekComplete}
        starredLines={starredLines}
        onToggleStar={onToggleStar}
      />
    </Player.Provider>
  );
}

function RightPaneContent({ 
  videoUrl, 
  subtitlesVttUrl,
  chapters = [], 
  subchapters = [], 
  transcript = [], 
  onActiveChapterChange,
  onTimeUpdate,
  onSubtitleChange,
  seekTime,
  onSeekComplete,
  starredLines = [],
  onToggleStar
}: RightPaneProps) {
  const media = Player.useMedia();
  
  // Tab control state
  const [activeTab, setActiveTab] = useState("Timeline");

  // Toggle states for video chapters
  const [openChapters, setOpenChapters] = useState<Record<number, boolean>>({});
  const [activeChapterId, setActiveChapterId] = useState<number | null>(null);
  const [activeSubchapterId, setActiveSubchapterId] = useState<number | null>(null);
  const activeChapterIdRef = React.useRef<number | null>(null);
  const activeSubchapterIdRef = React.useRef<number | null>(null);

  // Auto-open active chapter
  React.useEffect(() => {
    if (activeChapterId !== null) {
      setOpenChapters(prev => ({
        ...prev,
        [activeChapterId]: true
      }));
    }
  }, [activeChapterId]);

  // Merge subchapters and transcripts into chapters
  const dynamicChapters = chapters.map((ch, index) => {
    const nextCh = chapters[index + 1];
    const endTime = nextCh ? (nextCh.start_time || nextCh.seconds || 0) : Infinity;
    
    const chapterTranscripts = transcript?.filter(t => {
      const time = t.start_time || t.seconds || 0;
      return time >= (ch.start_time || ch.seconds || 0) && time < endTime;
    }) || [];

    return {
      ...ch,
      seconds: ch.start_time || ch.seconds || 0,
      time: new Date((ch.start_time || ch.seconds || 0) * 1000).toISOString().substr(14, 5),
      subchapters: subchapters.filter(sub => sub.chapter_id === ch.id).map(sub => {
        const absoluteSeconds = (ch.start_time || ch.seconds || 0) + (sub.start_time || sub.seconds || 0);
        return {
          ...sub,
          seconds: absoluteSeconds,
          time: new Date(absoluteSeconds * 1000).toISOString().substr(14, 5)
        };
      }),
      transcripts: chapterTranscripts
    };
  });

  // Use dynamic chapters if available, otherwise fallback to empty
  const displayChapters = dynamicChapters.length > 0 ? dynamicChapters : [];

  // Track active chapter based on video time
  React.useEffect(() => {
    if (!media) return;
    const videoEl = (media as any).target as HTMLVideoElement | undefined;
    
    // We try to attach to the video element if available.
    // If not immediately available, we could fall back, but let's just listen to timeupdate
    const el = videoEl || (document.querySelector('video') as HTMLVideoElement | null);
    if (!el) return;

    const handleTimeUpdate = () => {
      const currentTime = el.currentTime;
      if (onTimeUpdate) {
        onTimeUpdate(currentTime);
      }

      if (onSubtitleChange) {
        let activeSubText = "";
        const tracks = el.textTracks;
        for (let i = 0; i < tracks.length; i++) {
          const track = tracks[i];
          if (track.mode === "showing" && track.activeCues) {
            const activeCue = track.activeCues[0];
            if (activeCue) {
              activeSubText = (activeCue as any).text || "";
              activeSubText = activeSubText
                .replace(/^\[[^\]]+\]:\s*/, "")
                .replace(/^[^:]+:\s*/, "")
                .trim();
              break;
            }
          }
        }
        onSubtitleChange(activeSubText);
      }

      let activeChap: any = null;
      for (const ch of displayChapters) {
        const nextCh = displayChapters[displayChapters.indexOf(ch) + 1];
        const endTime = nextCh ? (nextCh.start_time || nextCh.seconds || 0) : Infinity;
        if (currentTime >= (ch.start_time || ch.seconds || 0) && currentTime < endTime) {
          activeChap = ch.id;
          break;
        }
      }
      const prevChap = activeChapterIdRef.current;
      if (activeChap !== prevChap) {
        activeChapterIdRef.current = activeChap;
        setActiveChapterId(activeChap);
        if (onActiveChapterChange) {
          onActiveChapterChange(activeChap);
        }
      }

      let activeSub: any = null;
      const activeChapObj = displayChapters.find((ch: any) => ch.id === activeChap);
      if (activeChapObj && activeChapObj.subchapters) {
        const subs = activeChapObj.subchapters;
        for (const sub of subs) {
          const subSec = sub.seconds || 0;
          const nextSub = subs[subs.indexOf(sub) + 1];
          const endTime = nextSub ? (nextSub.seconds || 0) : Infinity;
          if (currentTime >= subSec && currentTime < endTime) {
            activeSub = sub.id;
            break;
          }
        }
      }
      const prevSub = activeSubchapterIdRef.current;
      if (activeSub !== prevSub) {
        activeSubchapterIdRef.current = activeSub;
        setActiveSubchapterId(activeSub);
      }
    };

    el.addEventListener('timeupdate', handleTimeUpdate);
    return () => el.removeEventListener('timeupdate', handleTimeUpdate);
  }, [media, displayChapters, subchapters, onActiveChapterChange, onTimeUpdate]);

  // Handle cross-panel seek requests
  React.useEffect(() => {
    if (seekTime !== null && seekTime !== undefined) {
      handleSeekTo(seekTime);
      if (onSeekComplete) {
        onSeekComplete();
      }
    }
  }, [seekTime, onSeekComplete]);
  
  const toggleChapter = (id: number) => {
    setOpenChapters(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const handleSeekTo = (seconds: number) => {
    if (!media) return;
    const videoEl = (media as any).target as HTMLVideoElement | undefined;
    if (videoEl) {
      videoEl.currentTime = seconds;
      videoEl.play().catch(() => {});
    } else {
      const anyMedia = media as any;
      anyMedia.currentTime = seconds;
      anyMedia.play?.().catch(() => {});
    }
  };

  return (
    <div className="flex-1 flex flex-col pt-5 pb-5 px-6 overflow-hidden bg-white dark:bg-[#1e1f22] z-0 relative">
      {/* Video Player Section */}
      <div className="video-player-container relative w-full aspect-[16/9] bg-slate-900 rounded-2xl overflow-hidden mb-4 flex-shrink-0 group shadow-md border border-slate-105 dark:border-white/5">
        <MinimalVideoSkin>
          <Video src={videoUrl || "https://stream.mux.com/BV3YZtogl89mg9VcNBhhnHm02Y34zI1nlMuMQfAbl3dM/highest.mp4"} playsInline>
            {subtitlesVttUrl && (
              <track 
                kind="subtitles" 
                src={subtitlesVttUrl} 
                srcLang="en" 
                label="English (Whisper)" 
                default 
              />
            )}
          </Video>
        </MinimalVideoSkin>
      </div>

      {/* Sub tabs */}
      <div className="flex items-center gap-4 mb-4 px-1">
        {["Timeline", "Starred", "Clips", "Metrics"].map((tab) => {
          const isActive = activeTab === tab;
          return (
            <button 
              key={tab} 
              onClick={() => setActiveTab(tab)}
              className={`text-xs font-bold px-4 py-1.5 rounded-full transition-all cursor-pointer ${
                isActive 
                  ? "bg-[#1a1a1a] dark:bg-white text-white dark:text-slate-900 shadow-sm" 
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800"
              }`}
            >
              {tab}
            </button>
          );
        })}
      </div>

      {/* Tab content rendering */}
      {activeTab === "Timeline" ? (
        <div className="flex-1 overflow-y-auto px-1 pr-3 custom-scrollbar flex flex-col gap-4">
          {displayChapters.map((chapter) => {
            const isOpen = !!openChapters[chapter.id];
            const isActive = activeChapterId === chapter.id;
            return (
              <div 
                key={chapter.id} 
                className={`group/chapter flex flex-col border rounded-2xl p-3 transition-all duration-300 ease-out will-change-transform ${
                  isActive 
                    ? "border-[#ff7d54]/40 dark:border-[#ff7d54]/60 bg-gradient-to-r from-[#ff7d54]/8 to-[#ff7d54]/3 dark:from-[#ff7d54]/15 dark:to-[#ff7d54]/5 shadow-md border-l-4 border-l-[#ff7d54] scale-[1.01]" 
                    : "border-slate-100 dark:border-white/5 bg-slate-50/10 dark:bg-slate-900/10 hover:bg-gradient-to-r hover:from-slate-50 hover:to-white dark:hover:from-slate-800/40 dark:hover:to-slate-800/20 hover:border-[#ff7d54]/20 dark:hover:border-[#ff7d54]/30 hover:shadow-lg hover:-translate-y-1 hover:border-l-2 hover:border-l-[#ff7d54]/30 cursor-pointer"
                }`}
              >
              
              {/* Header block info */}
              <div className="flex items-start justify-between gap-2.5">
                <div 
                  className={`flex items-center gap-2.5 flex-1 group ${chapter.subchapters.length > 0 ? "cursor-pointer" : ""}`}
                  onClick={() => {
                    if (chapter.subchapters.length > 0) {
                      toggleChapter(chapter.id);
                    } else {
                      handleSeekTo(chapter.seconds);
                    }
                  }}
                >
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSeekTo(chapter.seconds);
                    }}
                    className={`transition-all duration-300 flex-shrink-0 cursor-pointer ${
                      isActive ? "text-[#ff7d54] animate-pulse" : "text-[#ff7d54]"
                    }`} 
                    title="Play Chapter"
                  >
                    <BookOpen size={16} className="stroke-[2.5] group-hover/chapter:scale-110 group-hover/chapter:-rotate-3 transition-transform duration-300" />
                  </button>
                  <span className={`font-display font-extrabold text-[13.5px] tracking-tight transition-colors line-clamp-1 ${
                    isActive ? "text-[#ff7d54]" : "text-slate-850 dark:text-slate-200 group-hover:text-[#ff7d54]"
                  }`}>
                    {chapter.title}
                  </span>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <span 
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSeekTo(chapter.seconds);
                    }}
                    className={`text-[10px] border shadow-xs font-extrabold px-2.5 py-0.5 rounded-full select-none cursor-pointer transition-all duration-300 ease-out active:scale-95 ${
                      isActive 
                        ? "bg-[#ff7d54] text-white border-[#ff7d54] shadow-md shadow-[#ff7d54]/20" 
                        : "bg-white dark:bg-slate-800 hover:bg-[#ff7d54] hover:text-white hover:border-[#ff7d54] hover:shadow-md hover:shadow-[#ff7d54]/20 hover:scale-105 border-slate-100 dark:border-white/5 text-gray-500 dark:text-slate-400 group-hover/chapter:border-[#ff7d54]/25"
                    }`}
                  >
                    {chapter.time}
                  </span>
                  
                  {chapter.subchapters.length > 0 && (
                    <button 
                      onClick={() => toggleChapter(chapter.id)}
                      className={`p-1.5 rounded-lg transition-all duration-300 ease-out cursor-pointer ${
                        isActive 
                          ? "text-[#ff7d54] hover:bg-[#ff7d54]/10 hover:scale-110" 
                          : "text-gray-400 hover:text-[#ff7d54] hover:bg-[#ff7d54]/10 hover:scale-110"
                      }`}
                    >
                      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                  )}
                </div>
              </div>

              {/* Subchapters Container with left vertical separator thread */}
              {isOpen && chapter.subchapters.length > 0 && (
                <div className="mt-2.5 pl-4 pr-1 flex flex-col gap-1.5 relative border-l border-dashed border-slate-200 dark:border-white/10 ml-2">
                  {chapter.subchapters.map((sub: any) => {
                    const isActiveSub = activeSubchapterId === sub.id;
                    return (
                      <div 
                        key={sub.id} 
                        onClick={() => handleSeekTo(sub.seconds)}
                        className={`group flex items-center justify-between text-xs py-2 px-3 rounded-xl cursor-pointer transition-all duration-300 ease-out active:scale-[0.98] ${
                          isActiveSub 
                            ? "bg-white dark:bg-slate-800 shadow-sm border border-[#ff7d54]/20 dark:border-[#ff7d54]/40 font-bold scale-[1.01]" 
                            : "hover:bg-gradient-to-r hover:from-white hover:to-[#ff7d54]/5 dark:hover:from-slate-800/60 dark:hover:to-slate-800/30 hover:shadow-md hover:scale-[1.02] hover:translate-x-1 border border-transparent hover:border-[#ff7d54]/15 dark:hover:border-[#ff7d54]/20"
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {/* Interactive circle marker */}
                          <div className={`w-1.5 h-1.5 rounded-full transition-all duration-300 flex-shrink-0 ${
                            isActiveSub 
                              ? "bg-[#ff7d54] scale-125 animate-pulse" 
                              : "bg-slate-300 dark:bg-zinc-650 group-hover:bg-[#ff7d54] group-hover:scale-[1.8]"
                          }`} />
                          <span className={`font-display tracking-tight transition-colors line-clamp-1 text-[11.5px] ${
                            isActiveSub 
                              ? "text-slate-900 dark:text-white font-bold" 
                              : "text-slate-500 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-white font-semibold"
                          }`}>
                            {sub.title}
                          </span>
                        </div>
                        
                        <div className={`flex items-center gap-1 flex-shrink-0 text-[10px] font-bold font-mono transition-all duration-300 ease-out ml-1.5 px-1.5 py-0.5 rounded-md ${
                          isActiveSub 
                            ? "text-[#ff7d54] bg-[#ff7d54]/10 shadow-sm" 
                            : "text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-800/50 group-hover:bg-[#ff7d54]/10 group-hover:text-[#ff7d54] group-hover:shadow-sm group-hover:scale-105"
                        }`}>
                          <Clock size={9.5} />
                          <span>{sub.time}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              </div>
            );
          })}
        </div>
      ) : activeTab === "Starred" ? (
        <div className="flex-1 overflow-y-auto px-1 pr-3 custom-scrollbar flex flex-col gap-3">
          {starredLines && starredLines.length > 0 ? (
            starredLines.map((item) => (
              <div 
                key={item.id}
                onClick={() => handleSeekTo(parseTimeToSeconds(item.time))}
                className="group relative flex gap-3.5 p-3.5 border border-slate-100 dark:border-white/5 bg-slate-50/20 dark:bg-slate-900/10 rounded-2xl cursor-pointer hover:bg-slate-50/50 dark:hover:bg-slate-800/20 hover:border-slate-200 dark:hover:border-white/10 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xs"
              >
                <div className="flex-1 flex flex-col min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-extrabold text-xs text-gray-900 dark:text-white">
                      {item.speaker}
                    </span>
                    <span className="text-[10px] text-gray-400 dark:text-slate-500 font-bold bg-slate-50 dark:bg-slate-800/50 px-1.5 py-0.5 border border-slate-100 dark:border-white/5 rounded-md font-mono">
                      {item.time}
                    </span>
                  </div>
                  <p className="text-[12.5px] font-semibold text-gray-700 dark:text-slate-300 leading-relaxed line-clamp-3">
                    {item.text}
                  </p>
                </div>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onToggleStar) onToggleStar(item);
                  }}
                  className="text-amber-500 hover:text-amber-600 transition-all p-1 cursor-pointer flex items-center justify-center self-start hover:scale-110"
                  title="Unstar"
                >
                  <Star size={13} className="fill-amber-500" />
                </button>
              </div>
            ))
          ) : (
            <div className="text-center py-16 text-slate-400 dark:text-slate-500 text-sm font-semibold flex flex-col items-center justify-center gap-3">
              <Star size={24} className="text-slate-300 dark:text-slate-600 stroke-[1.5]" />
              <span>No starred transcripts yet.</span>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-16 text-slate-450 text-xs font-semibold">
          {activeTab} Content (Coming Soon)
        </div>
      )}
    </div>
  );
}
