import React from 'react';
import AskAIButton from './askaibutton';
import { ButtonSkeleton, SearchSkeleton } from './loadingskeleton';

interface SearchAreaProps {
  isLoading?: boolean;
  onNewPlaylist: () => void;
}

const SearchArea: React.FC<SearchAreaProps> = ({ isLoading, onNewPlaylist }) => {
  return (
    <section className="flex flex-col md:flex-row items-center gap-4 w-full max-w-5xl mx-auto mb-8 mt-4">
      {isLoading ? (
        <SearchSkeleton />
      ) : (
        <div className="relative flex-1 w-full bg-white rounded-full p-1.5 shadow-md shadow-slate-200/60 border border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3 pl-4 flex-1">
            <svg className="w-5 h-5 text-slate-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
            </svg>
            <input type="text" placeholder="Ask anything about your library..." className="w-full bg-transparent border-none text-[15px] outline-none text-slate-700 placeholder-slate-400 font-medium" />
          </div>
          <AskAIButton />
        </div>
      )}

      <div className="flex items-center gap-3 shrink-0 w-full md:w-auto justify-center select-none">
        {isLoading ? (
          <>
            <ButtonSkeleton className="h-12 w-36" />
            <ButtonSkeleton className="h-12 w-40" />
          </>
        ) : (
          <>
            <button 
              onClick={onNewPlaylist}
              className="bg-white border border-slate-200/80 hover:bg-slate-50 text-slate-700 font-bold text-[13px] px-5 py-3 rounded-full flex items-center gap-2 shadow-sm transition-all active:scale-98"
            >
              <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/>
              </svg>
              <span>New Playlist</span>
            </button>
            <button className="bg-white border border-slate-200/80 hover:bg-slate-50 text-slate-700 font-bold text-[13px] px-5 py-3 rounded-full flex items-center gap-2 shadow-sm transition-all active:scale-98">
              <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
              </svg>
              <span>Import Content</span>
            </button>
          </>
        )}
      </div>
    </section>
  );
};

export default SearchArea;
