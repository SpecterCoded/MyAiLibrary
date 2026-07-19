import React from 'react';
import { FolderOpen, Sparkles, AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';

interface EmptyStateProps {
  searchQuery?: string;
  onClearSearch?: () => void;
  onNewDocument?: () => void;
  title?: string;
  description?: string;
  newDocumentLabel?: string;
}

export default function EmptyState({
  searchQuery = "",
  onClearSearch,
  onNewDocument,
  title,
  description,
  newDocumentLabel
}: EmptyStateProps) {
  const isSearching = !!searchQuery;
  
  const displayTitle = title || (isSearching ? "No matches found" : "No playlists yet");
  const displayDescription = description || (isSearching 
    ? `We couldn't find any playlists matching "${searchQuery}". Try editing your query or clearing the search.`
    : "Get started by creating a playlist to organize your workspaces, codebase files, notes, and study paths.");

  return (
    <motion.div 
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className="home-empty-state w-full max-w-xl mx-auto bg-white/60 hover:bg-white/80 border border-white/80 backdrop-blur-2xl rounded-3xl p-8 sm:p-12 shadow-xl shadow-slate-200/50 flex flex-col items-center text-center relative overflow-hidden transition-all duration-300 my-8 select-none"
    >
      {/* Decorative blurred background circles for aesthetics */}
      <div className="absolute -top-10 -right-10 w-28 h-28 bg-indigo-400/10 rounded-full blur-2xl pointer-events-none" />
      <div className="absolute -bottom-10 -left-10 w-28 h-28 bg-blue-400/10 rounded-full blur-2xl pointer-events-none" />

      {/* Floating Animated Media Container */}
      <div className="empty-state-icon relative mb-6">
        <div className="absolute inset-0 bg-indigo-500/15 rounded-2xl blur-md scale-95 animate-pulse"></div>
        <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-tr from-indigo-500 via-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/25">
          {isSearching ? (
            <AlertCircle className="w-8 h-8 animate-[bounce_2s_infinite]" />
          ) : (
            <FolderOpen className="w-8 h-8 animate-pulse" />
          )}
        </div>
        <div className="absolute -bottom-1.5 -right-1.5 w-6 h-6 rounded-full bg-amber-400 flex items-center justify-center border border-white shadow-sm">
          <Sparkles className="w-3.5 h-3.5 text-white animate-spin" style={{ animationDuration: '4s' }} />
        </div>
      </div>

      {/* Title */}
      <h3 className="text-xl sm:text-2xl font-extrabold text-slate-800 tracking-tight mb-3">
        {displayTitle}
      </h3>

      {/* Description */}
      <p className="empty-state-description text-slate-500 text-sm leading-relaxed max-w-sm mb-8 font-medium">
        {displayDescription}
      </p>

      {/* Action Buttons */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        {isSearching && onClearSearch && (
          <button
            onClick={onClearSearch}
            type="button"
            className="px-5 py-2.5 bg-white border border-slate-200/80 hover:bg-slate-50 hover:border-slate-350 text-slate-700 font-bold text-[13px] rounded-xl shadow-sm transition-all active:scale-95 cursor-pointer"
          >
            Clear Search
          </button>
        )}
        {onNewDocument && (
          <button
            onClick={onNewDocument}
            type="button"
            className="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-[13px] rounded-xl flex items-center gap-1.5 shadow-md shadow-slate-900/10 transition-all active:scale-95 cursor-pointer"
          >
            {newDocumentLabel ? (
              <span>{newDocumentLabel}</span>
            ) : (
              <>
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/>
                </svg>
                <span>Create Playlist</span>
              </>
            )}
          </button>
        )}
      </div>
    </motion.div>
  );
}
