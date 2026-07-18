import React, { useState, useEffect, useRef } from "react";
import { Sparkles, Eye, Check, RefreshCw, AlertCircle, Bookmark } from "lucide-react";
import { FailedStateContainer } from "../common/FailedStateContainer";
import { SavedContentLoader, SavedContentReveal, holdSavedContentLoader } from "../common/SavedContentLoader";
import type { TranscriptItem, Flashcard } from "./types";
import { logActivity } from '../../utils/activityLogger';

interface FlashcardTabProps {
  transcript: TranscriptItem[];
  resourceId: string | null;
  token: string | null;
  initialFlashcards?: any[] | null;
  onFlashcardsGenerated?: (data: any[]) => void;
}

export default function FlashcardTab({ transcript, resourceId, token, initialFlashcards, onFlashcardsGenerated }: FlashcardTabProps) {
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingMode, setLoadingMode] = useState<"saved" | "generate" | null>(
    initialFlashcards !== undefined
      ? (initialFlashcards && initialFlashcards.length > 0 ? "saved" : "generate")
      : "saved"
  );
  const isFetchingRef = useRef(false);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [currentIdx, setCurrentIdx] = useState<number>(0);
  const [isFlipped, setIsFlipped] = useState<boolean>(false);
  const [knownCount, setKnownCount] = useState<number>(0);
  const [cardStatus, setCardStatus] = useState<Record<string, "known" | "review" | "none">>({});
  const [error, setError] = useState<string | null>(null);
  const [wasSavedLoad, setWasSavedLoad] = useState(false);

  const fetchFlashcards = async (forceRegenerate = false) => {
    if (!resourceId || !token) return;
    // Prevent double-invocation (e.g. React Strict Mode) for the initial auto-fetch
    if (!forceRegenerate && isFetchingRef.current) return;
    isFetchingRef.current = true;

    setLoading(true);
    setLoadingMode(forceRegenerate ? "generate" : "saved");
    setWasSavedLoad(!forceRegenerate);
    setError(null);
    setCurrentIdx(0);
    setIsFlipped(false);
    setKnownCount(0);
    setCardStatus({});

    try {
      if (!forceRegenerate) {
        const savedLoadStartedAt = Date.now();

        // Shortcut 1: parent pre-fetched and found data — use it, skip GET entirely
        if (initialFlashcards && initialFlashcards.length > 0) {
          await holdSavedContentLoader(savedLoadStartedAt);
          setCards(initialFlashcards);
          setLoading(false);
          isFetchingRef.current = false;
          return;
        }

        // Shortcut 2: parent confirmed no data — skip GET, fall through to POST
        if (initialFlashcards === null) {
          setLoadingMode("generate");
        } else {
          // undefined: pre-fetch not done — normal GET with CSS fade-in fallback
          // 1. Try GET first
          const getResponse = await fetch(`/resources/${resourceId}/flashcards`, {
            headers: { "Authorization": `Bearer ${token}` },
          });

          if (getResponse.ok) {
            const getData = await getResponse.json();
            if (getData && getData.length > 0) {
              await holdSavedContentLoader(savedLoadStartedAt);
              setCards(getData);
              setLoading(false);
              isFetchingRef.current = false;
              return;
            }
          }

          // 2. POST generate
          setLoadingMode("generate");
        }
        logActivity('ai_features', 'Generating flashcards');
        const postResponse = await fetch(`/resources/${resourceId}/generate-flashcards`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${token}` },
        });

        if (!postResponse.ok) {
          throw new Error("Failed to load flashcards.");
        }

        const data = await postResponse.json();
        if (data && data.length > 0) {
          setCards(data);
          onFlashcardsGenerated?.(data);
        } else {
          throw new Error("No flashcards found.");
        }
      } else {
        // Force regenerate
        const postResponse = await fetch(`/resources/${resourceId}/regenerate-flashcards`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${token}` },
        });

        if (!postResponse.ok) {
          throw new Error("Failed to regenerate flashcards.");
        }

        const data = await postResponse.json();
        if (data && data.length > 0) {
          setCards(data);
          onFlashcardsGenerated?.(data);
        } else {
          throw new Error("Failed to regenerate flashcards.");
        }
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to make custom flashcards.");
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
      // NOTE: setLoadingMode is intentionally NOT reset to null here.
      // Resetting it caused a flicker: the extra render with loadingMode=null
      // while loading was transitioning would briefly show the wrong loader.
    }
  };

  useEffect(() => {
    if (cards.length === 0 && resourceId && token) {
      fetchFlashcards();
    }
  }, [resourceId, token]);

  const handleCardFlop = () => {
    setIsFlipped((prev) => !prev);
  };

  const handleStatusSelect = (status: "known" | "review") => {
    const activeCard = cards[currentIdx];
    const prevStatus = cardStatus[activeCard.id] || "none";

    // Update status mapping
    setCardStatus((prev) => ({
      ...prev,
      [activeCard.id]: status,
    }));

    // Adjust known counting values safely
    if (status === "known" && prevStatus !== "known") {
      setKnownCount((prev) => prev + 1);
    } else if (status === "review" && prevStatus === "known") {
      setKnownCount((prev) => Math.max(0, prev - 1));
    }

    // Auto navigate to next card if not at end
    setTimeout(() => {
      if (currentIdx + 1 < cards.length) {
        setIsFlipped(false);
        setCurrentIdx((prev) => prev + 1);
      }
    }, 400);
  };

  const handleResetDeck = () => {
    setCurrentIdx(0);
    setIsFlipped(false);
    setCardStatus({});
    setKnownCount(0);
  };

  if (loading) {
    if (loadingMode === "saved") {
      return <SavedContentLoader message="Opening your saved flashcards..." />;
    }

    return (
      <div className="py-20 flex flex-col items-center justify-center space-y-5">
        <div className="relative w-12 h-12">
          <div className="absolute inset-0 rounded-full border-3 border-neutral-100"></div>
          <div className="absolute inset-0 rounded-full border-3 border-neutral-800 border-t-transparent animate-spin"></div>
        </div>
        <div className="text-center space-y-2">
          <p className="text-base font-bold text-neutral-800">Drafting beautiful flashcards...</p>
          <p className="text-sm text-neutral-400">Gemini is boiling complex sentences into cards</p>
        </div>
      </div>
    );
  }

  if (error) {
    return <FailedStateContainer message={error} onRetry={() => fetchFlashcards(true)} title="Failed to load Flashcards" />;
  }

  if (cards.length === 0) {
    return (
      <div className="text-center py-24 bg-neutral-50 rounded-xl border border-dashed border-neutral-200">
        <Bookmark className="w-8 h-8 text-neutral-400 mx-auto mb-3" />
        <p className="text-lg font-bold text-neutral-700">Ready to build study flashcards</p>
        <p className="text-sm text-neutral-400 mt-2 max-w-sm mx-auto">
          Capture high quality snippets of code, Figma revisions, and API updates automatically.
        </p>
        <button
          onClick={() => fetchFlashcards()}
          className="mt-6 px-6 py-2.5 bg-neutral-800 hover:bg-neutral-900 text-white font-bold text-sm rounded-full transition cursor-pointer"
        >
          Generate Concept Flashcards
        </button>
      </div>
    );
  }

  const activeCard = cards[currentIdx];
  const activeStatus = cardStatus[activeCard.id] || "none";

  const flashcardContent = (
    <div className="space-y-6 animate-fade-in flex-1 flex flex-col min-h-0 justify-between">
      <div>
        {/* Tracker bar */}
        <div className="flex items-center justify-between border-b border-neutral-105 dark:border-white/10 pb-3">
          <div className="flex items-center space-x-2.5">
            <span className="text-sm font-sans font-bold text-neutral-800 dark:text-white">
              Card {currentIdx + 1} of {cards.length}
            </span>
            <span className="text-xs bg-green-50 dark:bg-emerald-900/20 text-green-700 dark:text-emerald-400 border border-green-200 dark:border-emerald-500/30 font-bold px-2 py-0.5 rounded-full font-sans">
              {knownCount} Learned
            </span>
            {error && (
              <span className="text-xs font-semibold text-amber-600 flex items-center space-x-0.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>Standup Pack loaded</span>
              </span>
            )}
          </div>
          <button
            onClick={handleResetDeck}
            className="text-xs text-neutral-550 dark:text-slate-400 hover:text-neutral-800 dark:hover:text-white font-bold flex items-center space-x-1 cursor-pointer transition select-none"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Restart Deck</span>
          </button>
        </div>

        {/* Flip Card Container */}
        <div
          onClick={handleCardFlop}
          className="group relative h-64 w-full cursor-pointer perspective-1000 select-none mt-6 overflow-hidden rounded-2xl"
        >
          <div
            className={`relative h-full w-full rounded-2xl transition-all duration-305 preserve-3d ${
              isFlipped ? "rotate-y-180" : ""
            }`}
          >
            {/* FRONT OF CARD */}
            <div className="absolute inset-0 flex flex-col justify-between p-8 backface-hidden rounded-2xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-slate-800 shadow-md hover:border-neutral-300 dark:hover:border-white/20 transition-colors">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold tracking-wider text-neutral-400 uppercase">
                  Meeting Core Concept (Front)
                </span>
                <span className="text-sm text-amber-500 font-bold">★</span>
              </div>

              <div className="text-center font-display font-bold text-xl leading-relaxed text-neutral-850 dark:text-white px-6 my-auto">
                {activeCard.front}
              </div>

              <div className="flex items-center justify-center space-x-1.5 text-xs font-bold text-neutral-400 dark:text-slate-500">
                <Eye className="w-4 h-4" />
                <span>Tap card to reveal definition</span>
              </div>
            </div>

            {/* BACK OF CARD */}
            <div className="absolute inset-0 flex flex-col justify-between p-8 rotate-y-180 backface-hidden rounded-2xl border border-neutral-200 dark:border-white/10 bg-[#FAFAF9] dark:bg-slate-800 shadow-md">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold tracking-wider text-green-700 dark:text-emerald-400 uppercase">
                  Analysis Details (Back)
                </span>
                <span className="text-xs bg-neutral-250 dark:bg-white/10 text-neutral-750 dark:text-slate-300 font-bold px-2 py-0.5 rounded-sm">
                  Revealed
                </span>
              </div>

              <div className="text-center text-base md:text-lg font-semibold leading-relaxed text-neutral-700 dark:text-slate-300 px-6 my-auto">
                {activeCard.back}
              </div>

              <div className="flex items-center justify-center space-x-1.5 text-xs font-bold text-neutral-400 dark:text-slate-500">
                <span>Click again to flip back</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div>
        {/* Confidence Grading Panel */}
        <div className="flex flex-col space-y-4 bg-neutral-50 dark:bg-slate-800/50 px-6 py-4 rounded-xl border border-neutral-100 dark:border-white/10 mt-6">
          <span className="text-xs font-bold text-neutral-500 dark:text-slate-400 uppercase tracking-wider text-center select-none">
            How well do you know this topic?
          </span>
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => handleStatusSelect("review")}
              className={`py-3 px-4 rounded-lg border text-sm font-bold transition cursor-pointer flex items-center justify-center space-x-2 hover:bg-red-50 dark:hover:bg-red-900/20 hover:border-red-200 dark:hover:border-red-500/30 hover:text-red-800 dark:hover:text-red-300 ${
                activeStatus === "review" ? "border-red-300 dark:border-red-500/30 bg-red-50 dark:bg-red-900/20 text-red-900 dark:text-red-300 font-extrabold" : "border-neutral-200 dark:border-white/10 bg-white dark:bg-slate-800 text-neutral-700 dark:text-slate-300"
              }`}
            >
              ❌ Still reviewing
            </button>
            <button
              onClick={() => handleStatusSelect("known")}
              className={`py-3 px-4 rounded-lg border text-sm font-bold transition cursor-pointer flex items-center justify-center space-x-2 hover:bg-green-50 dark:hover:bg-emerald-900/20 hover:border-green-200 dark:hover:border-emerald-500/30 hover:text-green-800 dark:hover:text-emerald-300 ${
                activeStatus === "known" ? "border-green-300 dark:border-emerald-500/30 bg-green-50 dark:bg-emerald-900/20 text-green-900 dark:text-emerald-300 font-extrabold" : "border-neutral-200 dark:border-white/10 bg-white dark:bg-slate-800 text-neutral-700 dark:text-slate-300"
              }`}
            >
              ✓ Got it!
            </button>
          </div>
        </div>

        {/* Custom Deck controls */}
        <div className="flex justify-between items-center py-4 mt-2">
          <button
            onClick={() => {
              setIsFlipped(false);
              setCurrentIdx((prev) => Math.max(0, prev - 1));
            }}
            disabled={currentIdx === 0}
            className={`px-5 py-2.5 rounded-full border text-sm font-bold transition cursor-pointer select-none ${
              currentIdx === 0 ? "border-neutral-100 dark:border-white/5 text-neutral-300 dark:text-slate-600 cursor-not-allowed" : "border-neutral-200 dark:border-white/10 bg-white dark:bg-slate-800 text-neutral-700 dark:text-slate-300 hover:bg-neutral-50 dark:hover:bg-slate-700"
            }`}
          >
            Previous
          </button>

          <button
            onClick={() => fetchFlashcards(true)}
            className="text-sm font-bold text-neutral-600 dark:text-slate-400 hover:text-neutral-800 dark:hover:text-white flex items-center space-x-1.5 select-none cursor-pointer"
          >
            <Sparkles className="w-4 h-4 text-amber-500" />
            <span>Regenerate Deck</span>
          </button>

          <button
            onClick={() => {
              setIsFlipped(false);
              setCurrentIdx((prev) => Math.min(cards.length - 1, prev + 1));
            }}
            disabled={currentIdx === cards.length - 1}
            className={`px-5 py-2.5 rounded-full border text-sm font-bold transition cursor-pointer select-none ${
              currentIdx === cards.length - 1 ? "border-neutral-100 dark:border-white/5 text-neutral-300 dark:text-slate-600 cursor-not-allowed" : "border-neutral-200 dark:border-white/10 bg-white dark:bg-slate-800 text-neutral-700 dark:text-slate-300 hover:bg-neutral-50 dark:hover:bg-slate-700"
            }`}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );

  return wasSavedLoad ? <SavedContentReveal>{flashcardContent}</SavedContentReveal> : flashcardContent;
}
