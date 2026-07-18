import React from 'react';

export const LoadingMoreSpinner = () => {
  return (
    <div className="flex items-center gap-1.5 px-6 py-2.5">
      <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
      <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
      <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce"></div>
    </div>
  );
};

export const LoadMoreButton = ({ onClick }: { onClick: () => void }) => {
  return (
    <button
      onClick={onClick}
      className="text-slate-500 hover:text-slate-800 font-bold text-[13px] px-6 py-2.5 rounded-full flex items-center gap-2 transition-all active:scale-98"
    >
      <span>Show More</span>
      <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
      </svg>
    </button>
  );
};
