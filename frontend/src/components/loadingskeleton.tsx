import React from 'react';

type PlaylistCardSkeletonProps = {
  variant?: 'home' | 'library';
};

export const PlaylistCardSkeleton = ({ variant = 'library' }: PlaylistCardSkeletonProps) => {
  const isLibrary = variant === 'library';

  return (
    <div className={`playlist-card-skeleton playlist-card-skeleton--${variant} bg-white/80 dark:bg-slate-900/40 rounded-[28px] p-5 flex flex-col justify-between card-shadow relative overflow-hidden`}>
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="h-[22px] bg-slate-200 dark:bg-white/10 rounded-full w-24"></div>
          <div className="flex items-center gap-2">
            {isLibrary && <div className="h-3 w-10 bg-slate-100 dark:bg-white/5 rounded-full"></div>}
            <div className="h-4 w-4 bg-slate-200 dark:bg-white/10 rounded-full shrink-0"></div>
            <div className="h-5 w-5 bg-slate-200 dark:bg-white/10 rounded-full shrink-0"></div>
          </div>
        </div>

        <div className="playlist-card-skeleton-cover w-full h-36 rounded-[22px] bg-slate-100 dark:bg-white/5 border border-white dark:border-white/10 flex items-center justify-center mb-4">
          <div className="w-20 h-20 rounded-full bg-white/50 dark:bg-white/10"></div>
        </div>

        <div className={`${isLibrary ? 'h-5 w-2/3 mb-2' : 'h-[22px] w-3/4 mb-3'} bg-slate-200 dark:bg-white/10 rounded-lg`}></div>

        {!isLibrary && (
          <div className="flex flex-wrap items-center gap-y-1 gap-x-3 mb-4">
            <div className="h-3 bg-slate-200 dark:bg-white/10 rounded-full w-20"></div>
            <div className="h-3 bg-slate-200 dark:bg-white/10 rounded-full w-24"></div>
          </div>
        )}

        <div className={isLibrary ? 'space-y-2 mb-3' : 'space-y-2'}>
          <div className="h-3 bg-slate-100 dark:bg-white/5 rounded-full w-full"></div>
          <div className="h-3 bg-slate-100 dark:bg-white/5 rounded-full w-[92%]"></div>
          {!isLibrary && <div className="h-3 bg-slate-100 dark:bg-white/5 rounded-full w-2/3"></div>}
        </div>
      </div>

      <div className={`${isLibrary ? 'mt-4' : 'mt-6'} pt-3 border-t border-slate-100/60 dark:border-white/10 flex items-center ${isLibrary ? 'justify-between' : 'justify-end'}`}>
        {isLibrary && <div className="h-4 w-24 bg-slate-100 dark:bg-white/5 rounded-full"></div>}
        <div className={`${isLibrary ? 'h-8 w-16 rounded-lg' : 'h-9 w-9 rounded-full'} bg-slate-200 dark:bg-white/10`}></div>
      </div>
    </div>
  );
};

export const TextSkeleton = ({ className = "h-4 w-32" }) => (
  <div className={`bg-slate-200 rounded-full animate-pulse ${className}`}></div>
);

export const CircleSkeleton = ({ className = "h-10 w-10" }) => (
  <div className={`bg-slate-200 rounded-full animate-pulse ${className}`}></div>
);

export const ButtonSkeleton = ({ className = "h-10 w-24" }) => (
  <div className={`bg-slate-200 rounded-full animate-pulse ${className}`}></div>
);

export const SearchSkeleton = () => (
  <div className="relative flex-1 w-full bg-white/60 rounded-full p-1.5 shadow-md shadow-slate-200/40 border border-white/60 flex items-center justify-between animate-pulse">
    <div className="flex items-center gap-3 pl-4 flex-1">
      <div className="w-5 h-5 bg-slate-200 rounded-full shrink-0"></div>
      <div className="h-4 bg-slate-200 rounded-full w-1/2"></div>
    </div>
    <div className="h-10 w-32 bg-slate-300 rounded-full mr-1"></div>
  </div>
);

export default PlaylistCardSkeleton;
