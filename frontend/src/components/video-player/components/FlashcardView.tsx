import { useState, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, RotateCw, Lightbulb, Check, Bookmark, RefreshCw } from "lucide-react";
import { FailedStateContainer } from "../../common/FailedStateContainer";
import { SavedContentLoader, SavedContentReveal, holdSavedContentLoader } from "../../common/SavedContentLoader";
import { logActivity } from '../../../utils/activityLogger';

interface FlashcardViewProps {
  transcript: any[];
  resourceId: string | null;
  token: string | null;
  initialFlashcards?: any[] | null;
  onFlashcardsGenerated?: (data: any[]) => void; // called after generation so parent can update initialFlashcards
}

export function FlashcardView({ resourceId, token, initialFlashcards, onFlashcardsGenerated }: FlashcardViewProps) {
  const [loading, setLoading] = useState(true);
  const [loadingMode, setLoadingMode] = useState<"saved" | "generate" | null>(
    // If parent has checked: use result. If not yet checked (undefined): optimistic "saved" with CSS fade-in trick.
    initialFlashcards !== undefined
      ? (initialFlashcards && initialFlashcards.length > 0 ? "saved" : "generate")
      : "saved"
  );
  const isFetchingRef = useRef(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [reviewedCards, setReviewedCards] = useState<Record<number, 'easy' | 'hard'>>({});
  const [cards, setCards] = useState<any[]>([]);
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
    setCurrentIndex(0);
    setIsFlipped(false);
    setReviewedCards({});
    setError(null);

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

        // Shortcut 2: parent pre-fetched and confirmed no data — skip GET, fall through to POST
        if (initialFlashcards === null) {
          // loadingMode already set to "generate" by useState init — go straight to generation
        } else {
          // undefined: pre-fetch not done yet — do the normal GET (CSS fade-in trick as fallback)
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
        }
      }

      setLoadingMode("generate");
      logActivity('ai_features', `${forceRegenerate ? 'Regenerating' : 'Generating'} flashcards`);
      const postResponse = await fetch(`/resources/${resourceId}/${forceRegenerate ? 'regenerate-flashcards' : 'generate-flashcards'}`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` },
      });

      if (!postResponse.ok) throw new Error("Failed to load flashcards.");

      const data = await postResponse.json();
      if (data && data.length > 0) {
        setCards(data);
        onFlashcardsGenerated?.(data); // notify parent so next visit starts in sparkle mode
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to load flashcards.");
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

  const handleNext = () => {
    setIsFlipped(false);
    setCurrentIndex((prev) => (prev + 1) % cards.length);
  };

  const handlePrev = () => {
    setIsFlipped(false);
    setCurrentIndex((prev) => (prev - 1 + cards.length) % cards.length);
  };

  if (loading) {
    if (loadingMode === "saved") {
      return <SavedContentLoader message="Opening your saved flashcards..." />;
    }

    return (
      <div className="flex-1 flex flex-col items-center justify-center space-y-5 bg-white dark:bg-[#1e1f22]">
        <div className="relative w-12 h-12">
          <div className="absolute inset-0 rounded-full border-3 border-neutral-100 dark:border-white/10"></div>
          <div className="absolute inset-0 rounded-full border-3 border-neutral-800 dark:border-neutral-200 border-t-transparent animate-spin"></div>
        </div>
        <div className="text-center space-y-2">
          <p className="text-base font-bold text-neutral-800 dark:text-neutral-200">Drafting beautiful flashcards...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return <FailedStateContainer message={error} onRetry={() => fetchFlashcards(true)} title="Failed to load Flashcards" />;
  }

  if (cards.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center py-24 bg-white dark:bg-[#1e1f22]">
        <Bookmark className="w-8 h-8 text-neutral-400 mx-auto mb-3" />
        <p className="text-lg font-bold text-neutral-700 dark:text-neutral-200">Ready to build study flashcards</p>
        <button
          onClick={() => fetchFlashcards()}
          className="mt-6 px-6 py-2.5 bg-neutral-800 hover:bg-neutral-900 text-white font-bold text-sm rounded-full transition cursor-pointer"
        >
          Generate Concept Flashcards
        </button>
      </div>
    );
  }

  const currentCard = cards[currentIndex];

  const content = (
    <div className="flex-1 flex flex-col justify-between px-8 py-3 bg-white dark:bg-[#1e1f22] overflow-y-auto no-scrollbar">
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2.5 py-1 rounded-md">
              {currentCard.category || 'Concept'}
            </span>
            <button
              onClick={() => fetchFlashcards(true)}
              className="text-slate-400 hover:text-slate-800 transition flex items-center gap-1 text-xs cursor-pointer font-medium"
            >
              <RefreshCw size={14} />
              Regenerate
            </button>
          </div>
          <span className="text-xs text-gray-400 font-medium font-mono">
            Card {currentIndex + 1} of {cards.length}
          </span>
        </div>

        {/* 3D Flip Card Container */}
        <div
          className="w-full h-80 cursor-pointer group [perspective:1000px] mb-6 overflow-hidden rounded-2xl"
          onClick={() => setIsFlipped(!isFlipped)}
        >
          <div className={`relative w-full h-full text-center transition-transform duration-500 [transform-style:preserve-3d] ${isFlipped ? '[transform:rotateY(180deg)]' : ''}`}>
            
            {/* Front Side */}
            <div className="absolute inset-0 w-full h-full bg-slate-50 dark:bg-slate-800 rounded-2xl p-6 flex flex-col justify-between border border-slate-100 dark:border-white/10 shadow-sm [backface-visibility:hidden] overflow-y-auto custom-scrollbar">
              <div className="flex justify-between items-start text-slate-400">
                <Lightbulb size={20} className="text-amber-400 animate-pulse" />
                <span className="text-xs font-medium font-mono">QUESTION</span>
              </div>
              <div className="text-center px-4">
                <p className="text-base font-semibold text-slate-800 dark:text-slate-200 leading-snug">
                  {currentCard.front || currentCard.question}
                </p>
              </div>
              <div className="flex justify-center items-center gap-1.5 text-xs text-slate-400 font-medium">
                <RotateCw size={12} />
                <span>Click to reveal answer</span>
              </div>
            </div>

            {/* Back Side */}
            <div className="absolute inset-0 w-full h-full bg-slate-900 text-white rounded-2xl p-6 flex flex-col justify-between border border-slate-800 shadow-md [backface-visibility:hidden] [transform:rotateY(180deg)] overflow-y-auto custom-scrollbar">
              <div className="flex justify-between items-start text-slate-400">
                <Check size={20} className="text-emerald-400" />
                <span className="text-xs font-medium font-mono text-slate-400">ANSWER SUMMARY</span>
              </div>
              <div className="text-center px-4">
                <p className="text-sm font-medium leading-relaxed text-slate-100">
                  {currentCard.back || currentCard.answer}
                </p>
              </div>
              <div className="flex justify-center items-center gap-1.5 text-xs text-slate-500 font-medium">
                <RotateCw size={12} />
                <span>Click to view question</span>
              </div>
            </div>

          </div>
        </div>

        {/* Self Assessment Controls */}
        <div className="flex items-center justify-center gap-3 mb-6">
          <button 
            onClick={(e) => {
              e.stopPropagation();
              setReviewedCards(prev => ({ ...prev, [currentIndex]: 'hard' }));
            }}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
              reviewedCards[currentIndex] === 'hard' 
                ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 ring-2 ring-rose-300 dark:ring-rose-500/30' 
                : 'bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/30'
            }`}
          >
            Review Later (Hard)
          </button>
          <button 
            onClick={(e) => {
              e.stopPropagation();
              setReviewedCards(prev => ({ ...prev, [currentIndex]: 'easy' }));
            }}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
              reviewedCards[currentIndex] === 'easy' 
                ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 ring-2 ring-emerald-300 dark:ring-emerald-500/30' 
                : 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/30'
            }`}
          >
            Mastered (Easy)
          </button>
        </div>
      </div>

      {/* Navigation Footer */}
      <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-white/10">
        <button 
          onClick={handlePrev}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-white/10 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
        >
          <ChevronLeft size={16} />
          Previous
        </button>
        <div className="flex gap-1">
          {cards.map((_, idx) => (
            <div 
              key={idx} 
              onClick={() => {
                setIsFlipped(false);
                setCurrentIndex(idx);
              }}
              className={`w-2.5 h-2.5 rounded-full cursor-pointer transition-all ${
                currentIndex === idx 
                  ? 'bg-slate-800 dark:bg-slate-300 scale-125' 
                  : reviewedCards[idx] === 'easy'
                    ? 'bg-emerald-400'
                    : reviewedCards[idx] === 'hard'
                      ? 'bg-rose-400'
                      : 'bg-slate-200 dark:bg-slate-600'
              }`}
            />
          ))}
        </div>
        <button 
          onClick={handleNext}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-white/10 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
        >
          Next
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );

  return wasSavedLoad ? <SavedContentReveal>{content}</SavedContentReveal> : content;
}
