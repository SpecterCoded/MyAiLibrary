import React, { type ReactNode } from 'react';

interface DashboardLayoutProps {
  children: ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <div className="flex h-screen w-screen m-0 overflow-hidden bg-white p-0 antialiased dark:bg-[#1e1f22]">
      <div className="relative flex h-full w-full flex-col overflow-hidden bg-white dark:bg-[#1e1f22]">
        {children}
      </div>
    </div>
  );
}
