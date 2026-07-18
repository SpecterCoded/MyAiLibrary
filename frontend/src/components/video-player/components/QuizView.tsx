import { useState, useEffect, useRef } from "react";
import { Sparkles, ArrowRight, RotateCcw, Award, HelpCircle } from "lucide-react";
import { FailedStateContainer } from "../../common/FailedStateContainer";
import { SavedContentLoader, SavedContentReveal, holdSavedContentLoader } from "../../common/SavedContentLoader";
import { QuizFeedbackCard, QuizOptionButton } from "../../media/PlayerShared";
import { logActivity } from '../../../utils/activityLogger';

interface Question {
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
}

interface QuizViewProps {
  transcript: any[];
  resourceId: string | null;
  token: string | null;
  initialQuiz?: any[] | null;
  onQuizGenerated?: (data: any[]) => void;
}

const mapBackendQuizzes = (backendQuizzes: any[]): Question[] => {
  const answerMap: Record<string, number> = { a: 0, b: 1, c: 2, d: 3, A: 0, B: 1, C: 2, D: 3 };
  return backendQuizzes.map((q) => ({
    question: q.question,
    options: [q.option_a, q.option_b, q.option_c, q.option_d],
    answerIndex: answerMap[q.correct_answer] ?? 0,
    explanation: q.explanation || "No explanation provided."
  }));
};

export function QuizView({ resourceId, token, initialQuiz, onQuizGenerated }: QuizViewProps) {
  const [loading, setLoading] = useState(true);
  const [loadingMode, setLoadingMode] = useState<"saved" | "generate" | null>(
    initialQuiz !== undefined
      ? (initialQuiz && initialQuiz.length > 0 ? "saved" : "generate")
      : "saved"
  );
  const isFetchingRef = useRef(false);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [score, setScore] = useState(0);
  const [showResults, setShowResults] = useState(false);
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
    setSelectedOption(null);
    setCurrentQuestion(0);
    setIsSubmitted(false);
    setScore(0);
    setShowResults(false);

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
          // loadingMode already "generate" — go straight to generation
        } else {
          // undefined: pre-fetch not done — normal GET with CSS fade-in fallback
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
        }
      }

      setLoadingMode("generate");
      logActivity('ai_features', `${forceRegenerate ? 'Regenerating' : 'Generating'} quiz`);
      const postResponse = await fetch(`/resources/${resourceId}/${forceRegenerate ? 'regenerate-quiz' : 'generate-quiz'}`, {
        method: "POST",
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!postResponse.ok) throw new Error("Failed to load quiz.");
      
      const data = await postResponse.json();
      if (data && data.length > 0) {
        setQuestions(mapBackendQuizzes(data));
        onQuizGenerated?.(data); // notify parent so next visit starts in sparkle mode
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
    if (isSubmitted) return;
    setSelectedOption(optionIdx);
  };

  const handleSubmitOption = () => {
    if (selectedOption === null || isSubmitted) return;
    setIsSubmitted(true);
    if (selectedOption === questions[currentQuestion].answerIndex) {
      setScore((prev) => prev + 1);
    }
  };

  const handleNext = () => {
    setSelectedOption(null);
    setIsSubmitted(false);
    if (currentQuestion < questions.length - 1) {
      setCurrentQuestion((prev) => prev + 1);
    } else {
      setShowResults(true);
    }
  };

  const handleRestart = () => {
    setCurrentQuestion(0);
    setSelectedOption(null);
    setIsSubmitted(false);
    setScore(0);
    setShowResults(false);
  };

  if (loading) {
    if (loadingMode === "saved") {
      return <SavedContentLoader message="Loading your saved quiz..." />;
    }

    return (
      <div className="flex-1 flex flex-col items-center justify-center space-y-5 bg-white dark:bg-[#1e1f22]">
        <div className="relative w-12 h-12">
          <div className="absolute inset-0 rounded-full border-3 border-neutral-100 dark:border-white/10"></div>
          <div className="absolute inset-0 rounded-full border-3 border-neutral-800 dark:border-neutral-200 border-t-transparent animate-spin"></div>
        </div>
        <div className="text-center space-y-2">
          <p className="text-base font-bold text-neutral-800 dark:text-neutral-200">Synthesizing multiple choice questions...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return <FailedStateContainer message={error} onRetry={() => fetchQuiz(true)} title="Failed to load Quiz" />;
  }

  if (questions.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center py-24 bg-white dark:bg-[#1e1f22]">
        <HelpCircle className="w-8 h-8 text-neutral-400 mx-auto mb-3" />
        <p className="text-lg font-bold text-[#1D1D1F] dark:text-white">Ready to test your comprehension</p>
        <button
          onClick={() => fetchQuiz()}
          className="mt-6 px-6 py-2.5 bg-neutral-850 hover:bg-neutral-900 text-white font-bold text-sm rounded-full transition cursor-pointer"
        >
          Generate Interactive Quiz
        </button>
      </div>
    );
  }

  if (showResults) {
    const passed = score >= Math.ceil(questions.length / 2);
    const percentage = Math.round((score / questions.length) * 100);

    const resultsContent = (
      <div className="flex-1 flex flex-col justify-center items-center px-8 text-center bg-white dark:bg-[#1e1f22]">
        <div className="max-w-md w-full p-8 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-white/10 shadow-sm">
          <div className="mx-auto w-14 h-14 bg-amber-50 dark:bg-amber-900/20 rounded-full flex items-center justify-center mb-4">
            <Award className="w-8 h-8 text-amber-500" />
          </div>
          <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200 mb-2">Quiz Completed!</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 font-medium">Excellent study session based on the standup transcript.</p>
          
          <div className="flex items-center justify-around bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-white/10 mb-6">
            <div>
              <span className="block text-2xl font-bold text-slate-800 dark:text-slate-200">{score} / {questions.length}</span>
              <span className="text-xs text-slate-400 dark:text-slate-500 font-semibold font-mono">SCORE</span>
            </div>
            <div className="h-8 w-px bg-slate-150 dark:bg-white/10"></div>
            <div>
              <span className="block text-2xl font-bold text-slate-800 dark:text-slate-200">{percentage}%</span>
              <span className="text-xs text-slate-400 dark:text-slate-500 font-semibold font-mono">ACCURACY</span>
            </div>
          </div>

          <div className="text-sm font-medium mb-8 text-slate-600 dark:text-slate-300">
            {passed ? "Great job! You have a solid grasp of the standup discussions." : "We recommend reviewing the Highlights and Transcript tab once more!"}
          </div>

          <button
            onClick={handleRestart}
            className="w-full flex items-center justify-center gap-2 px-5 py-2.5 bg-slate-900 dark:bg-slate-700 text-white font-medium rounded-lg hover:bg-black dark:hover:bg-slate-600 transition-colors"
          >
            <RotateCcw size={16} />
            Retake Quiz
          </button>
        </div>
      </div>
    );

    return wasSavedLoad ? <SavedContentReveal>{resultsContent}</SavedContentReveal> : resultsContent;
  }

  const q = questions[currentQuestion];

  const quizContent = (
    <div className="flex-1 flex flex-col justify-between px-8 py-3 bg-white dark:bg-[#1e1f22] overflow-y-auto no-scrollbar">
      <div>
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 font-mono tracking-wider">
            QUESTION {currentQuestion + 1} OF {questions.length}
          </span>
          <div className="flex items-center gap-4 text-xs font-medium text-slate-500 dark:text-slate-400">
            <button
              onClick={() => fetchQuiz(true)}
              className="text-slate-400 dark:text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw size={14} />
              Regenerate
            </button>
            <div className="flex items-center gap-1.5">
              <Sparkles size={14} className="text-amber-500" />
              <span>Standup Review</span>
            </div>
          </div>
        </div>

        {/* ProgressBar */}
        <div className="w-full h-1 bg-slate-100 dark:bg-white/10 rounded-full mb-6 relative overflow-hidden">
          <div 
            className="absolute top-0 bottom-0 left-0 bg-blue-500 transition-all duration-300"
            style={{ width: `${((currentQuestion + 1) / questions.length) * 100}%` }}
          />
        </div>

        <h4 className="text-base font-bold text-slate-850 dark:text-slate-100 mb-6 leading-snug">
          {q.question}
        </h4>

        {/* Options List */}
        <div className="flex flex-col gap-3">
          {q.options.map((option, index) => (
            <QuizOptionButton
              key={index}
              option={option}
              index={index}
              selected={selectedOption === index}
              submitted={isSubmitted}
              correct={q.answerIndex === index}
              onSelect={() => handleOptionSelect(index)}
            />
          ))}
        </div>

        {/* Feedback explanation block */}
        {isSubmitted && (
          <QuizFeedbackCard
            correct={selectedOption === q.answerIndex}
            explanation={q.explanation}
          />
        )}
      </div>

      {/* Action Footer */}
      <div className="flex items-center justify-end gap-3 pt-6 border-t border-slate-100 dark:border-white/10 mt-6">
        {!isSubmitted ? (
          <button
            onClick={handleSubmitOption}
            disabled={selectedOption === null}
            className={`px-5 py-2 text-sm font-semibold rounded-lg transition-all ${
              selectedOption !== null 
                ? 'bg-slate-900 dark:bg-slate-700 text-white hover:bg-black dark:hover:bg-slate-600' 
                : 'bg-slate-100 dark:bg-white/10 text-slate-400 dark:text-slate-500 cursor-not-allowed'
            }`}
          >
            Check Answer
          </button>
        ) : (
          <button
            onClick={handleNext}
            className="flex items-center gap-1.5 px-5 py-2 text-sm font-semibold bg-slate-900 dark:bg-slate-700 text-white rounded-lg hover:bg-black dark:hover:bg-slate-600 transition-all"
          >
            {currentQuestion === questions.length - 1 ? 'Show Results' : 'Next Question'}
            <ArrowRight size={16} />
          </button>
        )}
      </div>
    </div>
  );

  return wasSavedLoad ? <SavedContentReveal>{quizContent}</SavedContentReveal> : quizContent;
}
