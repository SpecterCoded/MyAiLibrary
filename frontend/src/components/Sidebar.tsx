import React, { type ReactNode, useState, useEffect } from 'react';
import { Sparkles } from 'lucide-react';
import { type BackendUser } from './DashboardHeader';

interface NavItemBase {
  id: string;
}

interface NavActionItem extends NavItemBase {
  type?: never;
  tooltip: string;
  icon: ReactNode;
  active?: boolean;
}

interface NavDividerItem extends NavItemBase {
  type: 'divider';
}

type NavItem = NavActionItem | NavDividerItem;

interface SidebarProps {
  user: BackendUser | null;
  activeTab?: string;
  hasActiveDownloads?: boolean;
  onTabChange?: (tab: string) => void;
}

const AVATAR_COLORS = [
  { bg: 'bg-rose-100', text: 'text-black', border: 'border-rose-200' },
  { bg: 'bg-emerald-100', text: 'text-black', border: 'border-emerald-200' },
  { bg: 'bg-blue-100', text: 'text-black', border: 'border-blue-200' },
  { bg: 'bg-amber-100', text: 'text-black', border: 'border-amber-200' },
  { bg: 'bg-violet-100', text: 'text-black', border: 'border-violet-200' },
  { bg: 'bg-fuchsia-100', text: 'text-black', border: 'border-fuchsia-200' },
  { bg: 'bg-cyan-100', text: 'text-black', border: 'border-cyan-200' },
  { bg: 'bg-teal-100', text: 'text-black', border: 'border-teal-200' },
];

export default function Sidebar({ user, activeTab = 'home', hasActiveDownloads = false, onTabChange }: SidebarProps) {
  const displayName = user?.username || user?.email?.split('@')[0] || 'Trader';
  const userId = user?.user_id || 'default_user';

  // Load avatar from DB first, fallback to localStorage
  const avatarUrl = user?.avatar_url || localStorage.getItem(`user_avatar_${userId}`);
  const hasAvatar = !!avatarUrl;

  const [storageInfo, setStorageInfo] = useState<{
    used_percent: number;
    formatted_text: string;
  } | null>(null);

  const fetchStorage = async () => {
    try {
      const token = localStorage.getItem('access_token');
      if (!token) return;

      const response = await fetch('/me/storage-usage', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        setStorageInfo({
          used_percent: data.used_percent,
          formatted_text: data.formatted_text
        });
      }
    } catch (err) {
      console.error('Failed to fetch storage usage:', err);
    }
  };

  useEffect(() => {
    fetchStorage();
    // Poll storage usage every 30 seconds
    const interval = setInterval(fetchStorage, 30000);
    return () => clearInterval(interval);
  }, [user]);

  // Simple hashing to select a deterministic color from the palette
  const getAvatarFallback = () => {
    const char = displayName.charAt(0).toUpperCase();
    let hash = 0;
    const key = userId || displayName;
    for (let i = 0; i < key.length; i++) {
      hash = key.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colorIndex = Math.abs(hash) % AVATAR_COLORS.length;
    return {
      char,
      styles: AVATAR_COLORS[colorIndex]
    };
  };

  const fallback = getAvatarFallback();

  const navItems: NavItem[] = [
    { id: 'home', tooltip: 'Home', active: activeTab === 'home', icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>
    )},
    { id: 'library', tooltip: 'Library', active: activeTab === 'library', icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z"/></svg>
    )},
    { id: 'notebooks', tooltip: 'Notebooks', active: activeTab === 'notebooks', icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
    )},
    { id: 'concepts', tooltip: 'Knowledge', active: activeTab === 'concepts', icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>
    )},
    { id: 'chat', tooltip: 'Chat', active: activeTab === 'chat', icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
    )},
    { id: 'rag-explorer', tooltip: 'RAG Explorer', active: activeTab === 'rag-explorer', icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h10M4 17h7M17 15l3 3m0 0l-3 3m3-3h-8M7 3h10a2 2 0 012 2v4H5V5a2 2 0 012-2z"/></svg>
    )},
    { id: 'downloads', tooltip: 'Downloads', active: activeTab === 'downloads', icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
    )},

    { id: 'metrics', tooltip: 'Metrics', active: activeTab === 'metrics', icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
    )},
    { id: 'divider-1', type: 'divider' },
    { id: 'settings', tooltip: 'Settings', active: activeTab === 'settings', icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
    )}
  ];

  return (
    <aside className="w-20 h-[calc(100%-48px)] my-6 ml-6 flex flex-col items-center py-4 px-2 bg-white/65 dark:bg-slate-900/40 backdrop-blur-[20px] border border-white/50 dark:border-white/10 shrink-0 select-none rounded-[32px] shadow-sm relative z-50">
      
      {/* Logo Section */}
      <div 
        onClick={() => onTabChange?.('home')}
        className="group relative flex items-center justify-center mb-3 shrink-0 cursor-pointer"
      >
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow-md shadow-blue-500/20 hover:scale-105 active:scale-95 transition-all duration-300">
          <Sparkles className="w-5 h-5 text-white" strokeWidth={2} />
        </div>
        <div className="absolute left-full ml-5 px-2.5 py-1.5 bg-slate-800 text-white text-[11px] font-bold rounded-lg opacity-0 pointer-events-none whitespace-nowrap shadow-xl z-[100] transition-all duration-200 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0">
          MyAILibrary
          <div className="absolute right-full top-1/2 -translate-y-1/2 border-[5px] border-transparent border-r-slate-800"></div>
        </div>
      </div>

      {/* Nav Section */}
      <nav className="flex-1 w-full flex flex-col justify-center gap-1.5 items-center overflow-visible">
        {navItems.map((item) => {
          if (item.type === 'divider') {
            return <div key={item.id} className="w-8 border-t border-slate-200/50 dark:border-white/10 my-1 shrink-0" />;
          }

          return (
            <a
              key={item.id}
              href="#"
              onClick={(e) => {
                e.preventDefault();
                onTabChange?.(item.id);
              }}
              className={`group relative flex items-center justify-center w-9 h-9 rounded-xl transition-all ${
                item.active
                  ? 'text-white bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 shadow-md shadow-indigo-500/20 duration-200'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-white/50 dark:hover:bg-slate-800/50 duration-150'
              }`}
            >
              {item.icon}
              {item.id === 'downloads' && hasActiveDownloads && (
                <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-blue-500 rounded-full border-2 border-white dark:border-slate-900 animate-pulse" />
              )}
              <div className="absolute left-full ml-5 px-2.5 py-1.5 bg-slate-800 text-white text-[11px] font-bold rounded-lg opacity-0 pointer-events-none whitespace-nowrap shadow-xl z-[100] transition-all duration-200 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0">
                {item.tooltip}
                <div className="absolute right-full top-1/2 -translate-y-1/2 border-[5px] border-transparent border-r-slate-800"></div>
              </div>
            </a>
          );
        })}
      </nav>

      {/* Bottom Section */}
      <div className="flex flex-col gap-2 pt-2 mt-auto border-t border-slate-200/50 dark:border-white/10 items-center w-full shrink-0">
        
        {/* Storage Widget */}
        <div 
          onMouseEnter={fetchStorage}
          className="group relative flex items-center justify-center cursor-help"
        >
          <svg className="w-8 h-8 transform -rotate-90">
            <circle cx="16" cy="16" r="12" stroke="rgba(226, 232, 240, 0.7)" strokeWidth="3" fill="transparent" />
            <circle 
              cx="16" 
              cy="16" 
              r="12" 
              stroke="url(#sidebarStoreGrad)" 
              strokeWidth="3" 
              fill="transparent" 
              strokeDasharray="75.39" 
              strokeDashoffset={storageInfo ? (75.39 - (storageInfo.used_percent / 100) * 75.39) : 41.46} 
              className="transition-all duration-500 ease-out"
            />
            <defs>
              <linearGradient id="sidebarStoreGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#3b82f6" />
                <stop offset="100%" stopColor="#4f46e5" />
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute inset-0 flex items-center justify-center text-slate-500">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"/></svg>
          </div>
          <div className="absolute left-full ml-5 px-2.5 py-1.5 bg-slate-800 text-white text-[11px] font-bold rounded-lg opacity-0 pointer-events-none whitespace-nowrap shadow-xl z-[100] transition-all duration-200 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0">
            {storageInfo ? storageInfo.formatted_text : 'Storage: 1.24 TB / 2 TB (45%)'}
            <div className="absolute right-full top-1/2 -translate-y-1/2 border-[5px] border-transparent border-r-slate-800"></div>
          </div>
        </div>

        {/* Profile Avatar */}
        <button className="group relative focus:outline-none">
          {hasAvatar ? (
            <img 
              src={avatarUrl!} 
              alt={displayName} 
              className="w-9 h-9 rounded-full object-cover ring-2 ring-white shadow-sm group-hover:ring-indigo-100 transition-all bg-white" 
            />
          ) : (
            <div className={`w-9 h-9 rounded-full border ${fallback.styles.border} ${fallback.styles.bg} ${fallback.styles.text} flex items-center justify-center font-bold text-sm shadow-sm ring-2 ring-white group-hover:ring-indigo-100 transition-all`}>
              {fallback.char}
            </div>
          )}
          <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 rounded-full ring-2 ring-white"></span>
          <div className="absolute left-full ml-5 top-1/2 -translate-y-1/2 px-2.5 py-1.5 bg-slate-800 text-white text-[11px] font-bold rounded-lg opacity-0 pointer-events-none whitespace-nowrap shadow-xl z-[100] transition-all duration-200 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0">
            {displayName} - Active Session
            <div className="absolute right-full top-1/2 -translate-y-1/2 border-[5px] border-transparent border-r-slate-800"></div>
          </div>
        </button>
      </div>
    </aside>
  );
}
