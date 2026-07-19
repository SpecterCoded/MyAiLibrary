import React, { useState, useEffect } from 'react';
import { LogOut, Settings, User as UserIcon, Sun, Moon, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { logActivity } from '../utils/activityLogger';

export interface BackendUser {
  user_id: string;
  username: string;
  email: string;
  storage_root: string | null;
  avatar_url?: string | null;
  banner_url?: string | null;
}

interface DashboardHeaderProps {
  onSearchClick: () => void;
  onNotificationClick: () => void;
  onNavigate?: (view: string) => void;
  user: BackendUser | null;
  theme: 'light' | 'dark' | 'system';
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  unreadCount?: number;
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

export default function DashboardHeader({ onSearchClick, onNotificationClick, onNavigate, user, theme, setTheme, unreadCount = 0 }: DashboardHeaderProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Theme is independent of the OS — 'system' (legacy value) resolves to dark.
  const resolvedTheme = theme === 'light' ? 'light' : 'dark';

  const handleToggleTheme = async () => {
    const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);

    const token = localStorage.getItem('access_token');
    if (token) {
      try {
        await fetch('/me/settings', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ theme: nextTheme })
        });
      } catch (err) {
        console.error('Failed to save theme toggle on backend:', err);
      }
    }
  };

  // Update clock every minute
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const displayName = user?.username || user?.email?.split('@')[0] || 'Trader';
  const displayEmail = user?.email || '';

  // Retrieve user avatar from database first, then fallback to localStorage
  const userId = user?.user_id || 'default_user';
  const avatarUrl = user?.avatar_url || localStorage.getItem(`user_avatar_${userId}`);
  const hasAvatar = !!avatarUrl;

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

  const handleLogout = async () => {
    logActivity('auth', 'Logged out');
    try {
      const { auth } = await import('../firebase');
      const { signOut } = await import('firebase/auth');
      await signOut(auth);
    } catch (err) {
      console.error('Firebase signOut error:', err);
    }
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user_id');
    localStorage.removeItem('username');
    localStorage.removeItem('email');
    window.location.reload();
  };

  // Clock Formatting Helpers
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
  };

  const formatDate = (date: Date) => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    const dayName = days[date.getDay()];
    const monthName = months[date.getMonth()];
    const dayOfMonth = date.getDate();
    
    const getSuffix = (d: number) => {
      if (d > 3 && d < 21) return 'th';
      switch (d % 10) {
        case 1:  return "st";
        case 2:  return "nd";
        case 3:  return "rd";
        default: return "th";
      }
    };
    
    return `${dayName} - ${monthName} ${dayOfMonth}${getSuffix(dayOfMonth)}`;
  };

  return (
    <header className="dashboard-header flex items-center justify-between mb-8 select-none shrink-0">
      {/* Time and Date Widget */}
      <div className="flex items-center gap-3 bg-white/40 dark:bg-slate-900/40 border border-white/60 dark:border-white/10 px-4 py-2 rounded-2xl text-[13px] font-semibold text-slate-700 dark:text-slate-200 shadow-sm transition-all duration-300 backdrop-blur-md">
        <svg className="w-4 h-4 text-indigo-500 animate-[pulse_2s_infinite]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
        </svg>
        <span>{formatTime(currentTime)}</span>
        <span className="text-slate-300 dark:text-slate-600">|</span>
        <span className="text-slate-500 dark:text-slate-400 font-medium">{formatDate(currentTime)}</span>
      </div>

      {/* Profile and Quick Action Utilities */}
      <div className="flex items-center gap-3 relative">
        {/* Global Search Toggle */}
        <button onClick={onSearchClick} className="w-10 h-10 flex items-center justify-center bg-white dark:bg-slate-900/40 rounded-full text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 shadow-sm border border-slate-100 dark:border-white/10 hover:scale-105 transition-all backdrop-blur-md">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
          </svg>
        </button>

        {/* Notifications Tray */}
        <button onClick={onNotificationClick} className="w-10 h-10 flex items-center justify-center bg-white dark:bg-slate-900/40 rounded-full text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 shadow-sm border border-slate-100 dark:border-white/10 relative hover:scale-105 transition-all backdrop-blur-md">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/>
          </svg>
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center bg-indigo-600 dark:bg-indigo-500 text-white text-[9px] font-bold px-1 rounded-full border border-white dark:border-slate-900 shadow-sm animate-pulse">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        {/* Theme/Utility Control */}
        <button 
          onClick={handleToggleTheme}
          title={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`}
          className="w-10 h-10 flex items-center justify-center bg-white dark:bg-slate-900/40 rounded-full shadow-sm border border-slate-100 dark:border-white/10 hover:scale-105 active:scale-95 transition-all cursor-pointer text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 backdrop-blur-md"
        >
          {resolvedTheme === 'dark' ? (
            <Sun className="w-5 h-5 text-amber-500 animate-[spin_10s_linear_infinite]" />
          ) : (
            <Moon className="w-5 h-5 text-indigo-500" />
          )}
        </button>

        <div className="h-8 w-[1px] bg-slate-200 dark:bg-white/10 mx-1"></div>

        {/* Profile Shortcut */}
        <button 
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="flex items-center focus:outline-none"
        >
          {hasAvatar ? (
            <img 
              src={avatarUrl!} 
              alt={displayName} 
              className="w-10 h-10 rounded-full object-cover ring-2 ring-indigo-100 dark:ring-indigo-500/30 shadow-sm hover:scale-105 transition-all cursor-pointer bg-white dark:bg-slate-800"
            />
          ) : (
            <div className={`w-10 h-10 rounded-full border ${fallback.styles.border} ${fallback.styles.bg} ${fallback.styles.text} flex items-center justify-center font-bold text-base shadow-sm ring-2 ring-indigo-100 hover:scale-105 transition-all cursor-pointer`}>
              {fallback.char}
            </div>
          )}
        </button>

        {/* Dropdown Menu */}
        <AnimatePresence>
          {dropdownOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="fixed inset-0 z-40"
                onClick={() => setDropdownOpen(false)}
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -8 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="absolute right-0 top-12 mt-2 w-64 bg-white/80 dark:bg-slate-900/90 backdrop-blur-2xl rounded-2xl border border-white/60 dark:border-white/10 shadow-xl dark:shadow-[0_20px_60px_-12px_rgba(0,0,0,0.6)] z-50 origin-top-right overflow-hidden"
              >
                {/* User Card */}
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05, duration: 0.2 }}
                  className="px-5 py-4 border-b border-slate-100 dark:border-white/5"
                >
                  <div className="flex items-center gap-3">
                    {hasAvatar ? (
                      <img
                        src={avatarUrl!}
                        alt={displayName}
                        className="w-10 h-10 rounded-full object-cover ring-2 ring-indigo-200 dark:ring-indigo-500/30 shadow-sm"
                      />
                    ) : (
                      <div className={`w-10 h-10 rounded-full border ${fallback.styles.border} ${fallback.styles.bg} ${fallback.styles.text} flex items-center justify-center font-bold text-sm shadow-sm ring-2 ring-indigo-100`}>
                        {fallback.char}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-800 dark:text-slate-200 text-sm truncate">{displayName}</p>
                      <p className="text-xs text-slate-400 dark:text-slate-500 truncate">{displayEmail}</p>
                    </div>
                  </div>
                </motion.div>

                {/* Menu Items */}
                <div className="py-2 px-2">
                  <motion.button
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.08, duration: 0.2 }}
                    onClick={() => {
                      setDropdownOpen(false);
                      onNavigate?.('settings');
                    }}
                    className="w-full px-3 py-2.5 text-left text-sm text-slate-700 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 hover:text-indigo-700 dark:hover:text-indigo-400 flex items-center gap-3 rounded-xl transition-all duration-150 group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-white/5 flex items-center justify-center group-hover:bg-indigo-100 dark:group-hover:bg-indigo-500/20 transition-colors">
                      <UserIcon className="w-4 h-4 text-slate-400 dark:text-slate-500 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors" />
                    </div>
                    <span className="flex-1 font-medium">My Profile</span>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150" />
                  </motion.button>

                  <motion.button
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.12, duration: 0.2 }}
                    onClick={() => {
                      setDropdownOpen(false);
                      onNavigate?.('settings');
                    }}
                    className="w-full px-3 py-2.5 text-left text-sm text-slate-700 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 hover:text-indigo-700 dark:hover:text-indigo-400 flex items-center gap-3 rounded-xl transition-all duration-150 group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-white/5 flex items-center justify-center group-hover:bg-indigo-100 dark:group-hover:bg-indigo-500/20 transition-colors">
                      <Settings className="w-4 h-4 text-slate-400 dark:text-slate-500 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors" />
                    </div>
                    <span className="flex-1 font-medium">Settings</span>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150" />
                  </motion.button>
                </div>

                {/* Divider */}
                <div className="mx-4 h-px bg-slate-100 dark:bg-white/5" />

                {/* Sign Out */}
                <div className="py-2 px-2">
                  <motion.button
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.16, duration: 0.2 }}
                    onClick={handleLogout}
                    className="w-full px-3 py-2.5 text-left text-sm text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 flex items-center gap-3 rounded-xl transition-all duration-150 group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-rose-50 dark:bg-rose-500/10 flex items-center justify-center group-hover:bg-rose-100 dark:group-hover:bg-rose-500/20 transition-colors">
                      <LogOut className="w-4 h-4 text-rose-400 dark:text-rose-500 group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors" />
                    </div>
                    <span className="flex-1 font-medium">Sign Out</span>
                  </motion.button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </header>
  );
}
