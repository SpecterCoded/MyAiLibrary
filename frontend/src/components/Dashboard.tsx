import React, { type ReactNode } from 'react';

interface DashboardLayoutProps {
  children: ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <div className="w-screen h-screen m-0 p-0 overflow-hidden antialiased bg-[linear-gradient(135deg,#f5f8fd_0%,#edf2f9_40%,#e4ebf6_100%)] dark:bg-[linear-gradient(135deg,#0B0F19_0%,#050505_100%)] flex items-center justify-center">
      {/* Main Glass Panel Wrapper */}
      <div className="w-screen h-screen flex rounded-none overflow-hidden relative bg-white/45 dark:bg-slate-900/40 backdrop-blur-[24px] border border-white/60 dark:border-white/10 shadow-[0_24px_50px_-12px_rgba(142,160,185,0.25)] dark:shadow-[0_24px_50px_-12px_rgba(0,0,0,0.5)]">
        {children}
      </div>
    </div>
  );
}