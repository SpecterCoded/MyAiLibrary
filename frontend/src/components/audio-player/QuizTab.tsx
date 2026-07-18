import React, { useState, useEffect, useRef } from "react";
import { HelpCircle, ArrowRight, RotateCw, AlertCircle, CheckCircle2, Check } from "lucide-react";
import { FailedStateContainer } from "../common/FailedStateContainer";
import { SavedContentLoader, SavedContentReveal, holdSavedContentLoader } from "../common/SavedContentLoader";
import { QuizFeedbackCard, QuizOptionButton } from "../media/PlayerShared";
import type { TranscriptItem, QuizQuestion } from "./types";
import { logActivity } from '../../utils/activityLogger';

interface QuizTabProps {
  transcript: TranscriptItem[];
  resourceId: string | null;
  token: string | null;
  initialQuiz?: any[] | null;
  onQuizGenerated?: (data: any[]) => void;
}

const mapBackendQuizzes = (backendQuizzes: any[]): QuizQuestion[] => {
  const answerMap: Record<string, number> = { a: 0, b: 1, c: 2, d: 3, A: 0, B: 1, C: 2, D: 3 };
  return backendQuizzes.map((q) => ({
    question: q.question,
    options: [q.option_a, q.option_b, q.option_c, q.option_d],
    answerIndex: answerMap[q.correct_answer] ?? 0,
    explanation: q.explanation || "No explanation provided."
  }));
};

export default function QuizTab({ transcript, resourceId, token, initialQuiz, onQuizGenerated }: QuizTabProps) {
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingMode, setLoadingMode] = useState<"saved" | "generate" | null>(
    initialQuiz !== undefined
      ? (initialQuiz && initialQuiz.length > 0 ? "saved" : "generate")
      : "saved"
  );
  const isFetchingRef = useRef(false);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [currentIdx, setCurrentIdx] = useState<number>(0);
  const [submitted, setSubmitted] = useState<boolean>(false);
  const [score, setScore] = useState<number>(0);
  const [quizFinished, setQuizFinished] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [wasSavedLoad, setWasSavedLoad] = useState(false);

  const fetchQuiz = async (forceRegenerate = false) => {
    if (!resourceId || !token) return;
    // Prevent double-invocation (e.g. React Strict Mode) for the initial auto-fetch
    if (!forceRegenerate && isFetchingRef.current) return;
    isFetchingRef.current = true;

    setLoading(true);
    setLoadingMode(forceRegenerate ? "generate" : "saved");
    setWasSavedLoad(!forceRegenerate);
    setError(null);
    setSelectedAnswer(null);
    setCurrentIdx(0);
    setSubmitted(false);
    setScore(0);
    setQuizFinished(false);

    try {
      if (!forceRegenerate) {
        const savedLoadStartedAt = Date.now();

        // Shortcut 1: parent pre-fetched and found data — use it, skip GET entirely
        if (initialQuiz && initialQuiz.length > 0) {
          await holdSavedContentLoader(savedLoadStartedAt);
          setQuestions(mapBackendQuizzes(initialQuiz));
          setLoading(false);
          isFetchingRef.current = false;
          return;
        }

        // Shortcut 2: parent confirmed no data — skip GET, fall through to POST
        if (initialQuiz === null) {
          setLoadingMode("generate");
        } else {
          // undefined: pre-fetch not done — normal GET with CSS fade-in fallback
          // 1. Try to GET existing quiz
          const getResponse = await fetch(`/resources/${resourceId}/quiz`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (getResponse.ok) {
            const getData = await getResponse.json();
            if (getData && getData.length > 0) {
              await holdSavedContentLoader(savedLoadStartedAt);
              setQuestions(mapBackendQuizzes(getData));
              setLoading(false);
              isFetchingRef.current = false;
              return;
            }
          }

          // 2. If no quiz, POST generate-quiz
          setLoadingMode("generate");
        }
        logActivity('ai_features', 'Generating quiz');
        const postResponse = await fetch(`/resources/${resourceId}/generate-quiz`, {
          method: "POST",
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!postResponse.ok) {
          throw new Error("Failed to load quiz. Server may be starting.");
        }
        const data = await postResponse.json();
        if (data && data.length > 0) {
          setQuestions(mapBackendQuizzes(data));
          onQuizGenerated?.(data);
        } else {
          throw new Error("Failed to generate quiz. Empty response.");
        }
      } else {
        // Force regenerate
        const postResponse = await fetch(`/resources/${resourceId}/regenerate-quiz`, {
          method: "POST",
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!postResponse.ok) {
          throw new Error("Failed to regenerate quiz. Server may be starting.");
        }
        const data = await postResponse.json();
        if (data && data.length > 0) {
          setQuestions(mapBackendQuizzes(data));
          onQuizGenerated?.(data);
        } else {
          throw new Error("Failed to regenerate quiz. Empty response.");
        }
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Could not retrieve quiz questions.");
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
      // NOTE: setLoadingMode is intentionally NOT reset to null here.
      // Resetting it caused a flicker: the extra render with loadingMode=null
      // while loading was transitioning would briefly show the wrong loader.
    }
  };

  useEffect(() => {
    if (questions.length === 0 && resourceId && token) {
      fetchQuiz();
    }
  }, [resourceId, token]);

  const handleOptionSelect = (optionIdx: number) => {
    if (submitted) return;
    setSelectedAnswer(optionIdx);
  };

  const handleAnswerSubmit = () => {
    if (selectedAnswer === null || submitted) return;
    setSubmitted(true);
    if (selectedAnswer === questions[currentIdx].answerIndex) {
      setScore((prev) => prev + 1);
    }
  };

  const handleNextQuestion = () => {
    setSubmitted(false);
    setSelectedAnswer(null);
    if (currentIdx + 1 < questions.length) {
      setCurrentIdx((prev) => prev + 1);
    } else {
      setQuizFinished(true);
    }
  };

  const handleRestart = () => {
    setCurrentIdx(0);
    setSelectedAnswer(null);
    setSubmitted(false);
    setScore(0);
    setQuizFinished(false);
  };

  if (loading) {
    if (loadingMode === "saved") {
      return <SavedContentLoader message="Loading your saved quiz..." />;
    }

    return (
      <div className="py-20 flex flex-col items-center justify-center space-y-5">
        <div className="relative w-12 h-12">
          <div className="absolute inset-0 rounded-full border-3 border-neutral-100 dark:border-white/10"></div>
          <div className="absolute inset-0 rounded-full border-3 border-neutral-800 dark:border-neutral-200 border-t-transparent animate-spin"></div>
        </div>
        <div className="text-center space-y-2">
          <p className="text-base font-bold text-neutral-800 dark:text-neutral-200">Synthesizing multiple choice questions...</p>
          <p className="text-sm text-neutral-400 dark:text-neutral-500">Gemini is studying the transcript context</p>
        </div>
      </div>
    );
  }

  if (error) {
    return <FailedStateContainer message={error} onRetry={() => fetchQuiz(true)} title="Failed to load Quiz" />;
  }

  if (questions.length === 0) {
    return (
      <div className="text-center py-24 bg-neutral-50 dark:bg-[#1e1f22] rounded-xl border border-dashed border-neutral-200 dark:border-white/10">
        <HelpCircle className="w-8 h-8 text-neutral-400 mx-auto mb-3" />
        <p className="text-lg font-bold text-[#1D1D1F] dark:text-white">Ready to test your comprehension</p>
        <p className="text-sm text-neutral-400 dark:text-neutral-500 mt-2 max-w-xs mx-auto">
          Start recording, simulate more conversation, or finalize to build real-time quizzes.
        </p>
        <button
          onClick={() => fetchQuiz()}
          className="mt-6 px-6 py-2.5 bg-neutral-850 hover:bg-neutral-900 text-white font-bold text-sm rounded-full transition cursor-pointer"
        >
          Generate Interactive Quiz
        </button>
      </div>
    );
  }

  if (quizFinished) {
    const perfectScore = score === questions.length;
    const resultsContent = (
      <div className="bg-neutral-50/50 dark:bg-slate-800/50 rounded-2xl border border-neutral-100/80 dark:border-white/10 p-8 text-center space-y-6 animate-fade-in flex-1 flex flex-col justify-center min-h-0">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-neutral-100 dark:bg-white/10 border border-neutral-250 dark:border-white/10 mb-1 mx-auto shadow-inner">
          <Check className={`w-9 h-9 stroke-[3] ${score > 1 ? "text-green-600 dark:text-emerald-400" : "text-amber-500"}`} />
        </div>

        <div className="space-y-2">
          <h3 className="font-display font-bold text-2xl text-neutral-900 dark:text-white">
            Quiz Completed!
          </h3>
          <p className="text-base text-neutral-600 dark:text-slate-300 font-medium">
            You scored <strong className="text-neutral-850 dark:text-white font-extrabold">{score} / {questions.length}</strong> correct answers.
          </p>
        </div>

        {/* Progress bar */}
        <div className="w-full h-1 bg-slate-100 dark:bg-white/10 rounded-full mb-6 relative overflow-hidden">
          <div 
            className="absolute top-0 bottom-0 left-0 bg-blue-500 transition-all duration-300"
            style={{ width: `${((currentIdx + 1) / questions.length) * 100}%` }}
          />
        </div>

        <p className="text-sm md:text-base font-bold text-neutral-600 dark:text-slate-300 max-w-md mx-auto italic leading-normal">
          {perfectScore
            ? "Fantastic job! You've captured every key decision and blocker in this standup."
            : "Nice effort! Study the summary breakdown or re-read the timeline to ace it."}
        </p>

        <div className="flex justify-center space-x-4 pt-3 shrink-0">
          <button
            onClick={handleRestart}
            className="px-6 py-2.5 border border-neutral-200 dark:border-white/10 bg-white dark:bg-slate-800 hover:bg-neutral-50 dark:hover:bg-slate-700 text-neutral-700 dark:text-slate-300 font-bold text-sm rounded-full transition cursor-pointer"
          >
            Retry Quiz
          </button>
          <button
            onClick={() => fetchQuiz(true)}
            className="px-6 py-2.5 bg-neutral-800 hover:bg-neutral-900 text-white font-bold text-sm rounded-full transition cursor-pointer"
          >
            Refetch with Gemini
          </button>
        </div>
      </div>
    );

    return wasSavedLoad ? <SavedContentReveal>{resultsContent}</SavedContentReveal> : resultsContent;
  }

  const currentQ = questions[currentIdx];

  const quizContent = (
    <div className="space-y-6 animate-fade-in flex-1 flex flex-col justify-between min-h-0">
      <div className="space-y-6 animate-fade-in">
        {/* Quiz Progress Header */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/10 pb-3">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 font-sans tracking-wider">
              QUESTION {currentIdx + 1} OF {questions.length}
            </span>
            {error && (
              <span className="text-xs text-amber-600 font-semibold flex items-center space-x-1">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>Using Standup Quiz Pack</span>
              </span>
            )}
          </div>

          <div className="flex items-center space-x-3 animate-fade-in">
            <button
              onClick={() => fetchQuiz(true)}
              className="text-slate-400 dark:text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition flex items-center gap-1 cursor-pointer text-xs font-medium"
              title="Regenerate Quiz"
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span>Regenerate</span>
            </button>
          </div>
        </div>

        {/* ProgressBar */}
        <div className="w-full h-1 bg-slate-100 dark:bg-white/10 rounded-full relative overflow-hidden">
          <div
            className="absolute top-0 bottom-0 left-0 bg-blue-500 transition-all duration-300"
            style={{ width: `${((currentIdx + 1) / questions.length) * 100}%` }}
          />
        </div>

        {/* Question Body */}
        <div className="bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-white/10 p-6 py-7">
          <h4 className="text-base md:text-lg font-extrabold text-slate-800 dark:text-slate-200 leading-snug font-display">
            {currentQ.question}
          </h4>
        </div>

        {/* Options Stack */}
        <div className="grid grid-cols-1 gap-3">
          {currentQ.options.map((option, idx) => (
            <QuizOptionButton
              key={idx}
              option={option}
              index={idx}
              selected={selectedAnswer === idx}
              submitted={submitted}
              correct={currentQ.answerIndex === idx}
              onSelect={() => handleOptionSelect(idx)}
            />
          ))}
        </div>
      </div>

      <div>
        {/* Explanation */}
        {submitted && (
          <QuizFeedbackCard
            correct={selectedAnswer === currentQ.answerIndex}
            explanation={currentQ.explanation}
          />
        )}

        {/* Primary Row Control */}
        <div className="flex justify-end pt-4 mt-2 border-t border-slate-100 dark:border-white/10">
          {!submitted ? (
            <button
              onClick={handleAnswerSubmit}
              disabled={selectedAnswer === null}
              className={`px-5 py-2 text-sm font-semibold rounded-lg transition-all ${
                selectedAnswer === null
                  ? "bg-slate-100 dark:bg-white/10 text-slate-400 dark:text-slate-500 cursor-not-allowed"
                  : "bg-slate-900 dark:bg-slate-700 text-white hover:bg-black dark:hover:bg-slate-600 cursor-pointer"
              }`}
            >
              <span>Check Answer</span>
            </button>
          ) : (
            <button
              onClick={handleNextQuestion}
              className="flex items-center gap-1.5 px-5 py-2 bg-slate-900 dark:bg-slate-700 hover:bg-black dark:hover:bg-slate-600 text-white text-sm font-semibold rounded-lg shadow-sm cursor-pointer transition-all"
            >
              <span>{currentIdx + 1 === questions.length ? "Finish Quiz" : "Next Question"}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return wasSavedLoad ? <SavedContentReveal>{quizContent}</SavedContentReveal> : quizContent;
}
