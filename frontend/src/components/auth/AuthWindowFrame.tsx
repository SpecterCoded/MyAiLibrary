import type { ReactNode } from 'react';

interface AuthWindowFrameProps {
  children: ReactNode;
}

export function AuthWindowFrame({ children }: AuthWindowFrameProps) {
  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-white text-gray-900 dark:bg-slate-950 dark:text-white">
      <div
        className="workspace-drag-region flex h-10 shrink-0 items-center border-b border-slate-200/70 bg-[#f5f8fd] px-3 pr-[150px] dark:border-white/10 dark:bg-[#0f141d]"
        aria-label="MyAiLibrary window title bar"
      >
        <span className="truncate text-[11px] font-semibold tracking-wide text-slate-500 dark:text-slate-400">
          MyAiLibrary
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {children}
      </div>
    </div>
  );
}
