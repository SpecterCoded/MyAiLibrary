import React from 'react';

export const PlaylistCardSkeleton = () => {
  return (
    <div className="bg-white/80 rounded-[28px] p-5 flex flex-col justify-between card-shadow relative animate-pulse">
      <div>
        <div className="flex items-center justify-between mb-5">
          <div className="h-4 bg-slate-200 rounded-full w-1/3"></div>
          <div className="h-5 w-5 bg-slate-200 rounded-full shrink-0"></div>
        </div>

        <div className="w-full h-40 rounded-[24px] bg-slate-100 border border-white flex items-center justify-center mb-5">
          <div className="w-20 h-20 rounded-3xl bg-white/50"></div>
        </div>

        <div className="h-6 bg-slate-200 rounded-lg w-3/4 mb-3"></div>
        
        <div className="flex flex-wrap items-center gap-y-1 gap-x-3 mb-4">
          <div className="h-3 bg-slate-200 rounded-full w-20"></div>
          <div className="h-3 bg-slate-200 rounded-full w-24"></div>
        </div>

        <div className="space-y-2">
          <div className="h-3 bg-slate-100 rounded-full w-full"></div>
          <div className="h-3 bg-slate-100 rounded-full w-full"></div>
          <div className="h-3 bg-slate-100 rounded-full w-2/3"></div>
        </div>
      </div>

      <div className="flex items-center justify-between mt-6 pt-3 border-t border-slate-100/60">
        <div className="h-9 w-24 bg-slate-200 rounded-full"></div>
        <div className="h-9 w-9 bg-slate-200 rounded-full"></div>
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
