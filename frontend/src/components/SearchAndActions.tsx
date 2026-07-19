import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import './AskAIButton.css';
import { GradientText } from './gradienttext';
import { TypewriterText } from './hellotypewriter';
import { type BackendUser } from './DashboardHeader';
import AskAIResult from './AskAIResult';

interface SearchAndActionsProps {
  onCreatePlaylistClick: () => void;
  onImportClick: () => void;
  user: BackendUser | null;
}

export default function SearchAndActions({ onCreatePlaylistClick, onImportClick, user }: SearchAndActionsProps) {
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [validationError, setValidationError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) {
      return 'Good morning';
    } else if (hour >= 12 && hour < 18) {
      return 'Good afternoon';
    } else {
      return 'Good evening';
    }
  };

  const displayName = user?.username || user?.email?.split('@')[0] || 'Trader';
  const greetingText = `${getGreeting()}, ${displayName} 👋`;

  function handleAsk() {
    const trimmed = query.trim();
    if (!trimmed) {
      setValidationError('Please type something...');
      setTimeout(() => setValidationError(''), 2500);
      return;
    }
    setValidationError('');
    setActiveQuery(trimmed);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') handleAsk();
    if (e.key === 'Escape') handleClose();
  }

  function handleClose() {
    setActiveQuery(null);
    setQuery('');
    setIsAiLoading(false);
  }

  // Close response when input is fully cleared
  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setQuery(val);
    if (val === '' && activeQuery) {
      handleClose();
    }
  }

  // Close response when clicking outside the search + result area
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        handleClose();
      }
    }
    if (activeQuery) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [activeQuery]);

  return (
    <div className="home-hero">
      {/* Welcome Greeting Banner */}
      <section className="home-welcome text-center my-6 select-none px-4 shrink-0">
        <TypewriterText
          text={greetingText}
          className="text-[14px] font-semibold text-slate-400 tracking-wide uppercase flex items-center justify-center gap-1.5 mb-1"
          loop={true}
          showCursor={true}
        />
        <GradientText className="home-title text-4xl lg:text-5xl font-black tracking-tight">
          Welcome to MyAILibrary!
        </GradientText>
      </section>

      {/* Smart Action Bar + AI Result Dropdown */}
      <section ref={containerRef} className="home-actions relative w-full max-w-5xl mx-auto mb-12 mt-4 shrink-0">
        {/* Search row */}
        <div className="flex flex-col xl:flex-row items-center gap-4 w-full">
          {/* Input pill */}
          <div
            className={`relative flex-1 w-full bg-white rounded-full p-1.5 shadow-md shadow-slate-200/60 border flex items-center justify-between transition-all duration-200 focus-within:ring-2 focus-within:ring-indigo-500/20 ${
              validationError ? 'border-rose-300 ring-2 ring-rose-100' : activeQuery ? 'border-indigo-300/70' : 'border-slate-100'
              }`}
          >
            <div className="flex items-center gap-3 pl-4 flex-1 min-w-0">
              <svg className="w-5 h-5 text-slate-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={validationError || "Ask anything about your library..."}
                className="w-full bg-transparent border-none text-[15px] outline-none text-slate-700 placeholder-slate-400 font-medium min-w-0"
              />
            </div>
            <button
              type="button"
              onClick={handleAsk}
              disabled={isAiLoading}
              className={`ask-ai-btn px-5 py-2.5 rounded-full shrink-0 transition-opacity ${isAiLoading ? 'opacity-70 cursor-not-allowed' : ''
                }`}
            >
              {isAiLoading ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="ask-ai-sparkle">
                  <path d="M10,21.236,6.755,14.745.264,11.5,6.755,8.255,10,1.764l3.245,6.491L19.736,11.5l-6.491,3.245ZM18,21l1.5,3L21,21l3-1.5L21,18l-1.5-3L18,18l-3,1.5ZM19.333,4.667,20.5,7l1.167-2.333L24,3.5,21.667,2.333,20.5,0,19.333,2.333,17,3.5Z" />
                </svg>
              )}
              <span className="ask-ai-text">{isAiLoading ? 'Thinking...' : 'Ask AI'}</span>
            </button>
          </div>

          {/* Action Controls */}
          <div className="flex items-center gap-3 shrink-0 w-full xl:w-auto justify-center select-none">
            <button
              type="button"
              onClick={onCreatePlaylistClick}
              className="bg-white border border-slate-200/80 hover:bg-slate-50 text-slate-700 font-bold text-[13px] px-5 py-3 rounded-full flex items-center gap-2 shadow-sm transition-all active:scale-[0.98]"
            >
              <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              <span>New Playlist</span>
            </button>
            <button
              type="button"
              onClick={onImportClick}
              className="bg-white border border-slate-200/80 hover:bg-slate-50 text-slate-700 font-bold text-[13px] px-5 py-3 rounded-full flex items-center gap-2 shadow-sm transition-all active:scale-[0.98]"
            >
              <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              <span>Import Content</span>
            </button>
          </div>
        </div>

        {/* AI Result — absolute overlay, floats over playlist cards */}
        <AnimatePresence>
          {activeQuery && (
            <motion.div
              key="ai-result"
              initial={{ opacity: 0, y: -12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.97 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="absolute left-0 right-0 top-full mt-4 z-40"
            >
              <AskAIResult
                query={activeQuery}
                onClose={handleClose}
                onLoadingChange={setIsAiLoading}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </div>
  );
}
