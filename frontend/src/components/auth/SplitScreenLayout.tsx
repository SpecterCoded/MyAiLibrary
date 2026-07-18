import React, { useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useQuotes } from './hooks/useQuotes';
import { motion, AnimatePresence } from 'framer-motion';

interface SplitScreenLayoutProps {
  children: React.ReactNode;
}

export function SplitScreenLayout({ children }: SplitScreenLayoutProps) {
  const { currentQuote, loading, nextQuote, prevQuote, goToIndex, historyLength, currentIndex } = useQuotes();

  useEffect(() => {
    if (!currentQuote) return;
    const interval = setInterval(() => {
      nextQuote();
    }, 60000); // Change every 60 seconds
    return () => clearInterval(interval);
  }, [currentQuote, nextQuote]);

  return (
    <div className="flex min-h-screen w-full bg-white dark:bg-slate-950 font-sans text-gray-900 dark:text-white">
      {/* Left side: Form content */}
      <div className="w-full lg:w-1/2 flex flex-col items-center justify-center p-6 sm:p-12 lg:p-24 overflow-y-auto">
        <div className="w-full max-w-md mx-auto relative">
          <div className="mb-8 font-bold text-xl flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gray-900 flex items-center justify-center">
              <div className="w-4 h-4 bg-white rounded-sm transform rotate-45"></div>
            </div>
            TraderBox
          </div>
          <AnimatePresence mode="wait">
            <motion.div
              key={children?.toString() || 'content'}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.3 }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Right side: Image and Quote Carousel */}
      <div className="hidden lg:flex lg:w-1/2 relative bg-gray-900 overflow-hidden rounded-l-[64px]">
        {!currentQuote ? (
          <div className="w-full h-full flex items-center justify-center text-white/50">
            {loading ? 'Initializing API...' : 'No quotes available'}
          </div>
        ) : (
          <>
            {/* Background Image Carousel */}
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.img
                key={currentQuote.id + '_img'}
                src={currentQuote.image}
                alt="Background"
                initial={{ opacity: 0, scale: 1.05 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.8, ease: "easeInOut" }}
                className="absolute inset-0 w-full h-full object-cover"
              />
            </AnimatePresence>

            {/* Gradient Overlay for Text Readability */}
            <div className="absolute inset-x-0 bottom-0 h-3/4 bg-gradient-to-t from-gray-900/90 via-gray-900/50 to-transparent pointer-events-none"></div>

            {/* Loading Indicator Overlay */}
            {loading && (
              <div className="absolute top-8 right-8 z-20">
                <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
              </div>
            )}

            {/* Content Container */}
            <div className="absolute bottom-0 inset-x-0 p-12 text-white z-10 flex flex-col gap-6">
              <AnimatePresence mode="wait">
                <motion.div
                  key={currentQuote.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.4 }}
                  className="space-y-6"
                >
                  <p className="text-3xl font-medium leading-tight">
                    "{currentQuote.text}"
                  </p>
                  <div>
                    <h4 className="font-semibold text-lg">{currentQuote.author}</h4>
                    <p className="text-white/70 text-sm font-medium">{currentQuote.role}</p>
                  </div>
                </motion.div>
              </AnimatePresence>

              {/* Navigation & Indicators */}
              <div className="flex items-center justify-between mt-4">
                <div className="flex gap-2 flex-wrap max-w-[150px] sm:max-w-xs overflow-hidden items-center h-4">
                  {Array.from({ length: historyLength }).map((_, idx) => (
                    <button
                      key={idx}
                      onClick={() => goToIndex(idx)}
                      className={`h-1.5 rounded-full transition-all duration-300 ${
                        idx === currentIndex ? "w-8 bg-white" : "w-1.5 bg-white/40 hover:bg-white/60"
                      }`}
                      aria-label={`Go to slide ${idx + 1}`}
                    />
                  ))}
                </div>
                <div className="flex gap-4">
                  <button
                    onClick={prevQuote}
                    disabled={currentIndex === 0}
                    className="w-12 h-12 rounded-full border border-white flex items-center justify-center text-white hover:bg-white/10 transition-colors backdrop-blur-sm disabled:opacity-30 disabled:cursor-not-allowed"
                    aria-label="Previous quote"
                  >
                    <ChevronLeft className="w-6 h-6" />
                  </button>
                  <button
                    onClick={nextQuote}
                    className="w-12 h-12 rounded-full border border-white flex items-center justify-center text-white hover:bg-white/10 transition-colors backdrop-blur-sm"
                    aria-label="Next quote"
                  >
                    <ChevronRight className="w-6 h-6" />
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
