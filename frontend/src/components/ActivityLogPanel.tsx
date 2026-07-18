import React, { useState, useEffect, useRef } from 'react';
import {
  X, Clock, Settings, Trash2, Search, Compass, FolderOpen, FileText,
  Upload, Download, MessageSquare, Sparkles, SearchCode, Sliders,
  BookOpen, GitBranch, Layers, LogIn, CheckSquare, Square,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import {
  logActivity, getBuffer, getCategories, setCategories, onBufferChange, flush,
  removeFromBuffer, removeByAction, clearBuffer,
  ALL_CATEGORIES, type LogCategory, type LogEntry,
} from '../utils/activityLogger';

interface ActivityLogPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const CATEGORY_META: Record<LogCategory, { label: string; icon: React.ReactNode; color: string }> = {
  navigation:  { label: 'Navigation', icon: <Compass size={14} />,      color: 'bg-blue-500' },
  playlist:    { label: 'Playlist',   icon: <FolderOpen size={14} />,   color: 'bg-indigo-500' },
  resource:    { label: 'Resource',   icon: <FileText size={14} />,     color: 'bg-violet-500' },
  upload:      { label: 'Upload',     icon: <Upload size={14} />,       color: 'bg-emerald-500' },
  download:    { label: 'Download',   icon: <Download size={14} />,     color: 'bg-cyan-500' },
  ai_chat:     { label: 'AI Chat',    icon: <MessageSquare size={14} />,color: 'bg-purple-500' },
  ai_features: { label: 'AI Features', icon: <Sparkles size={14} />,    color: 'bg-pink-500' },
  search:      { label: 'Search',     icon: <SearchCode size={14} />,   color: 'bg-amber-500' },
  settings:    { label: 'Settings',   icon: <Sliders size={14} />,      color: 'bg-zinc-500' },
  notebook:    { label: 'Notebook',   icon: <BookOpen size={14} />,     color: 'bg-teal-500' },
  concept:     { label: 'Concept',    icon: <GitBranch size={14} />,    color: 'bg-orange-500' },
  queue:       { label: 'Queue',      icon: <Layers size={14} />,       color: 'bg-rose-500' },
  auth:        { label: 'Auth',       icon: <LogIn size={14} />,        color: 'bg-slate-500' },
};

function formatRelativeTime(dateStr: string) {
  try {
    let date: Date;
    if (dateStr.endsWith('Z') || dateStr.includes('+')) {
      date = new Date(dateStr);
    } else {
      date = new Date(dateStr + 'Z');
    }
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffSecs < 0) return 'Just now';
    if (diffSecs < 10) return 'Just now';
    if (diffSecs < 60) return `${diffSecs}s ago`;
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  } catch {
    return '';
  }
}

const ActivityLogPanel: React.FC<ActivityLogPanelProps> = ({ isOpen, onClose }) => {
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [animate, setAnimate] = useState(false);

  const [bufferEntries, setBufferEntries] = useState<LogEntry[]>([]);
  const [syncedEntries, setSyncedEntries] = useState<any[]>([]);
  const [totalSynced, setTotalSynced] = useState(0);

  const [searchText, setSearchText] = useState('');
  const [activeCategoryFilter, setActiveCategoryFilter] = useState<LogCategory | 'all'>('all');
  const [categories, setCategoriesState] = useState<Record<LogCategory, boolean>>(getCategories());
  const [showSettings, setShowSettings] = useState(false);

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  const filterScrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Panel open/close animation
  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setAnimate(true));
      });
    } else {
      setAnimate(false);
      const timer = setTimeout(() => setShouldRender(false), 400);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // On open: flush + fetch
  useEffect(() => {
    if (isOpen) {
      refreshBuffer();
      flush().then(() => fetchSyncedEntries());
      setSelectMode(false);
      setSelectedIds(new Set());
    }
  }, [isOpen]);

  // Buffer change listener
  useEffect(() => {
    const unsub = onBufferChange(() => refreshBuffer());
    return unsub;
  }, []);

  // Auto-refresh every 10s
  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => fetchSyncedEntries(), 10000);
    return () => clearInterval(interval);
  }, [isOpen]);

  // Filter scroll arrow visibility
  const checkFilterScroll = () => {
    const el = filterScrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 5);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 5);
  };

  useEffect(() => {
    if (isOpen) {
      setTimeout(checkFilterScroll, 150);
      const el = filterScrollRef.current;
      if (el) el.addEventListener('scroll', checkFilterScroll);
      return () => el?.removeEventListener('scroll', checkFilterScroll);
    }
  }, [isOpen]);

  const scrollFilters = (dir: 'left' | 'right') => {
    filterScrollRef.current?.scrollBy({ left: dir === 'left' ? -150 : 150, behavior: 'smooth' });
  };

  const refreshBuffer = () => {
    setBufferEntries([...getBuffer()].reverse());
  };

  const fetchSyncedEntries = async () => {
    const token = localStorage.getItem('access_token');
    if (!token) return;
    try {
      const params = new URLSearchParams({ limit: '15' });
      if (activeCategoryFilter !== 'all') params.set('category', activeCategoryFilter);
      if (searchText) params.set('search', searchText);
      const res = await fetch(`/activity-logs?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSyncedEntries(data.items || []);
        setTotalSynced(data.total || 0);
      }
    } catch {}
  };

  const deleteEntry = async (id: string, action?: string, createdAt?: string): Promise<boolean> => {
    const token = localStorage.getItem('access_token');
    if (!token) return false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`/activity-logs/${id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (res.ok) {
          removeFromBuffer(id);
          if (action && createdAt) {
            removeByAction(action, createdAt.substring(0, 16));
          }
          return true;
        }
      } catch {}
      await new Promise(r => setTimeout(r, 200));
    }
    return false;
  };

  const handleDeleteSingle = async (id: string, action?: string, createdAt?: string) => {
    // Immediately remove from local state for instant UI feedback
    setSyncedEntries(prev => prev.filter(e => e.id !== id));
    setDeletingIds(prev => new Set(prev).add(id));
    // Fire backend delete — don't await, just let it happen in background
    deleteEntry(id, action, createdAt).then(success => {
      if (!success) {
        // If backend delete failed, re-fetch to restore the entry
        fetchSyncedEntries();
      }
      setDeletingIds(prev => { const n = new Set(prev); n.delete(id); return n; });
    });
  };

  const handleDeleteSelected = async () => {
    const ids = [...selectedIds];
    // Capture entry data from merged BEFORE async ops (state may change)
    const entryData = new Map(merged.map((e: any) => [e.id, e]));
    // Immediately remove from UI
    setSyncedEntries(prev => prev.filter(e => !ids.includes(e.id)));
    setDeletingIds(prev => new Set([...prev, ...ids]));
    setSelectedIds(new Set());
    setSelectMode(false);
    // Fire backend deletes in background
    await flush();
    for (const id of ids) {
      const entry = entryData.get(id);
      await deleteEntry(id, entry?.action, entry?.created_at);
    }
    await fetchSyncedEntries();
    setDeletingIds(new Set());
  };

  const handleClearAll = async () => {
    // Immediately clear UI
    setSyncedEntries([]);
    setTotalSynced(0);
    setSelectMode(false);
    setSelectedIds(new Set());
    clearBuffer();
    // Fire backend clear in background
    const token = localStorage.getItem('access_token');
    if (token) {
      try {
        await fetch('/activity-logs', { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
      } catch {}
    }
    await fetchSyncedEntries();
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(merged.map((e: any) => e.id)));
  const deselectAll = () => setSelectedIds(new Set());

  const handleCategoryToggle = (cat: LogCategory) => {
    const updated = { ...categories, [cat]: !categories[cat] };
    setCategoriesState(updated);
    setCategories(updated);
    if (!updated[cat] && activeCategoryFilter === cat) {
      setActiveCategoryFilter('all');
      setTimeout(() => fetchSyncedEntries(), 0);
    }
  };

  const handleCategoryFilter = (cat: LogCategory | 'all') => {
    setActiveCategoryFilter(cat);
    setTimeout(() => fetchSyncedEntries(), 0);
  };

  const handleSearch = () => {
    setTimeout(() => fetchSyncedEntries(), 0);
  };

  const filteredBuffer = bufferEntries.filter(entry => {
    if (activeCategoryFilter !== 'all' && entry.category !== activeCategoryFilter) return false;
    if (searchText && !entry.action.toLowerCase().includes(searchText.toLowerCase()) &&
        !(entry.detail && entry.detail.toLowerCase().includes(searchText.toLowerCase()))) return false;
    return true;
  });

  const filteredSynced = syncedEntries.filter((entry: any) => {
    if (activeCategoryFilter !== 'all' && entry.category !== activeCategoryFilter) return false;
    if (searchText && !entry.action.toLowerCase().includes(searchText.toLowerCase()) &&
        !(entry.detail && entry.detail.toLowerCase().includes(searchText.toLowerCase()))) return false;
    return true;
  });

  const merged = (() => {
    const syncedKeys = new Set(filteredSynced.map((e: any) => `${e.action}|${e.created_at?.substring(0, 16)}`));
    const unsyncedOnly = filteredBuffer.filter(e => !syncedKeys.has(`${e.action}|${e.created_at?.substring(0, 16)}`));
    const list = [...unsyncedOnly, ...filteredSynced];
    list.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return list;
  })();

  if (!shouldRender) return null;

  return (
    <div
      className={`absolute right-0 top-0 z-10 h-full w-full max-w-[420px] bg-white/95 dark:bg-[#1e1f22] backdrop-blur-xl border-l border-zinc-200 dark:border-[#2b2d31] font-sans text-zinc-900 dark:text-[#dbdee1] select-none flex flex-col overflow-hidden rounded-r-[32px]`}
      style={{
        transform: animate ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 350ms cubic-bezier(0.22, 1, 0.36, 1)',
        willChange: 'transform',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 dark:border-[#2b2d31] flex-shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="text-[18px] font-bold tracking-tight text-zinc-900 dark:text-[#f2f3f5]">Activity Log</h2>
          <span className="text-[10px] font-medium text-zinc-400 dark:text-[#80848e] bg-zinc-100 dark:bg-[#2b2d31] px-2 py-0.5 rounded-full">Ctrl+Shift+L</span>
        </div>
        <div className="flex items-center gap-1">
          {merged.length > 0 && (
            <button
              onClick={() => { if (selectMode) { setSelectMode(false); setSelectedIds(new Set()); } else setSelectMode(true); }}
              className={`p-1.5 rounded-lg transition-colors ${selectMode ? 'text-indigo-600 dark:text-[#5865f2] bg-indigo-50 dark:bg-[#5865f2]/10' : 'text-zinc-400 hover:text-zinc-600 dark:text-[#80848e] dark:hover:text-[#dbdee1] hover:bg-zinc-100 dark:hover:bg-[#2b2d31]'}`}
            >
              <CheckSquare size={16} />
            </button>
          )}
          <button onClick={() => setShowSettings(!showSettings)} className="p-1.5 rounded-lg text-zinc-400 dark:text-[#80848e] dark:hover:text-[#dbdee1] hover:bg-zinc-100 dark:hover:bg-[#2b2d31] transition-colors">
            <Settings size={16} />
          </button>
          {merged.length > 0 && !selectMode && (
            <button onClick={handleClearAll} className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-500 dark:text-[#80848e] dark:hover:text-[#f23f43] hover:bg-rose-50 dark:hover:bg-[#f23f43]/10 transition-colors">
              <Trash2 size={16} />
            </button>
          )}
          {selectMode && selectedIds.size > 0 && (
            <button onClick={handleDeleteSelected} className="p-1.5 rounded-lg text-rose-500 bg-rose-50 dark:bg-[#f23f43]/10 dark:text-[#f23f43] transition-colors">
              <Trash2 size={16} />
            </button>
          )}
          <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-400 dark:text-[#80848e] dark:hover:text-[#dbdee1] hover:bg-zinc-100 dark:hover:bg-[#2b2d31] transition-colors">
            <X size={16} />
          </button>
        </div>
      </div>

      {selectMode && (
        <div className="flex items-center justify-between mx-6 mb-3 px-2 py-1.5 bg-indigo-50 dark:bg-[#5865f2]/10 rounded-xl flex-shrink-0">
          <span className="text-[12px] font-medium text-indigo-600 dark:text-[#5865f2]">{selectedIds.size} selected</span>
          <div className="flex gap-2">
            <button onClick={selectAll} className="text-[11px] font-semibold text-indigo-600 dark:text-[#5865f2] hover:underline">Select all</button>
            <button onClick={deselectAll} className="text-[11px] font-semibold text-indigo-600 dark:text-[#5865f2] hover:underline">Deselect all</button>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="mx-6 mb-4 mt-2 p-4 bg-zinc-50 dark:bg-[#2b2d31] rounded-2xl border border-zinc-100 dark:border-[#3f4147] flex-shrink-0">
          <p className="text-[12px] font-semibold text-zinc-500 dark:text-[#80848e] mb-3 uppercase tracking-wider">Log these categories</p>
          <div className="flex flex-wrap gap-2">
            {ALL_CATEGORIES.map(cat => {
              const meta = CATEGORY_META[cat];
              return (
                <button key={cat} onClick={() => handleCategoryToggle(cat)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium transition-all border ${categories[cat] ? `${meta.color} text-white border-transparent shadow-sm` : 'bg-white dark:bg-[#1e1f22] text-zinc-400 dark:text-[#80848e] border-zinc-200 dark:border-[#3f4147]'}`}>
                  {meta.icon}{meta.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Filter pills with arrows */}
      <div className="relative mx-6 mt-3 mb-2 flex-shrink-0">
        {canScrollLeft && (
          <button onClick={() => scrollFilters('left')} className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-6 h-6 flex items-center justify-center rounded-full bg-white/90 dark:bg-[#1e1f22] shadow-md border border-zinc-200 dark:border-[#3f4147] text-zinc-500 dark:text-[#80848e] hover:text-zinc-800 dark:hover:text-[#dbdee1] transition-colors">
            <ChevronLeft size={14} />
          </button>
        )}
        <div ref={filterScrollRef} className="flex gap-1.5 overflow-x-auto py-1" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          <button onClick={() => handleCategoryFilter('all')}
            className={`px-3 py-1 rounded-full text-[12px] font-semibold whitespace-nowrap transition-all flex-shrink-0 ${activeCategoryFilter === 'all' ? 'bg-zinc-900 dark:bg-[#5865f2] text-white' : 'bg-zinc-100 dark:bg-[#2b2d31] text-zinc-500 dark:text-[#80848e] hover:bg-zinc-200 dark:hover:bg-[#3f4147]'}`}>
            All
          </button>
          {ALL_CATEGORIES.filter(cat => categories[cat]).map(cat => {
            const meta = CATEGORY_META[cat];
            return (
              <button key={cat} onClick={() => handleCategoryFilter(cat)}
                className={`flex items-center gap-1 px-3 py-1 rounded-full text-[12px] font-semibold whitespace-nowrap transition-all flex-shrink-0 ${activeCategoryFilter === cat ? 'bg-zinc-900 dark:bg-[#5865f2] text-white' : 'bg-zinc-100 dark:bg-[#2b2d31] text-zinc-500 dark:text-[#80848e] hover:bg-zinc-200 dark:hover:bg-[#3f4147]'}`}>
                {meta.icon}{meta.label}
              </button>
            );
          })}
        </div>
        {canScrollRight && (
          <button onClick={() => scrollFilters('right')} className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-6 h-6 flex items-center justify-center rounded-full bg-white/90 dark:bg-[#1e1f22] shadow-md border border-zinc-200 dark:border-[#3f4147] text-zinc-500 dark:text-[#80848e] hover:text-zinc-800 dark:hover:text-[#dbdee1] transition-colors">
            <ChevronRight size={14} />
          </button>
        )}
      </div>

      {/* Search */}
      <div className="relative mx-6 mb-3 mt-1 flex-shrink-0">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-[#80848e]" />
        <input type="text" value={searchText} onChange={e => setSearchText(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()}
          placeholder="Search actions..."
          className="w-full pl-9 pr-3 py-2 bg-zinc-50 dark:bg-[#1e1f22] border border-zinc-200 dark:border-[#3f4147] rounded-xl text-[13px] text-zinc-700 dark:text-[#dbdee1] placeholder:text-zinc-400 dark:placeholder:text-[#80848e] focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 transition-all" />
      </div>

      {/* Log entries */}
      <div className="flex-1 overflow-y-auto min-h-0 space-y-1 mx-6 pr-1">
        {merged.map((entry: any) => {
          const meta = CATEGORY_META[entry.category as LogCategory] || { label: entry.category, icon: <Clock size={14} />, color: 'bg-zinc-500' };
          const isDeleting = deletingIds.has(entry.id);
          return (
            <div
              key={entry.id}
              className={`flex items-start gap-3 px-2 py-2.5 rounded-xl transition-all group ${
                isDeleting ? 'opacity-0 -translate-x-8 max-h-0 overflow-hidden' : 'opacity-100 translate-x-0'
              } ${selectedIds.has(entry.id) ? 'bg-indigo-50 dark:bg-[#5865f2]/10' : 'hover:bg-zinc-50 dark:hover:bg-[#2b2d31]/50'}`}
              style={{ transitionDuration: isDeleting ? '300ms' : '200ms' }}
              onClick={selectMode ? () => toggleSelect(entry.id) : undefined}
            >
              {selectMode && (
                <div className="flex-shrink-0 mt-1">
                  {selectedIds.has(entry.id) ? <CheckSquare size={16} className="text-indigo-600 dark:text-[#5865f2]" /> : <Square size={16} className="text-zinc-300 dark:text-[#4e5058]" />}
                </div>
              )}
              <div className={`w-7 h-7 rounded-lg ${meta.color} flex items-center justify-center flex-shrink-0 text-white mt-0.5`}>{meta.icon}</div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-zinc-800 dark:text-[#dbdee1] leading-snug truncate">{entry.action}</p>
                {entry.detail && <p className="text-[11px] text-zinc-400 dark:text-[#80848e] mt-0.5 truncate">{entry.detail}</p>}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <span className="text-[11px] text-zinc-300 dark:text-[#4e5058] whitespace-nowrap mt-0.5">{formatRelativeTime(entry.created_at)}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    console.log('[TRASH CLICK] Deleting entry:', entry.id, entry.action);
                    handleDeleteSingle(entry.id, entry.action, entry.created_at);
                  }}
                  className="p-1 rounded-md text-zinc-300 dark:text-[#4e5058] hover:text-rose-500 dark:hover:text-[#f23f43] hover:bg-rose-50 dark:hover:bg-[#f23f43]/10 opacity-0 group-hover:opacity-100 transition-all"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          );
        })}

        {merged.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Clock size={32} className="text-zinc-300 dark:text-[#4e5058] mb-3" />
            <p className="text-[14px] font-semibold text-zinc-400 dark:text-[#80848e]">No activity yet</p>
            <p className="text-[12px] text-zinc-300 dark:text-[#4e5058] mt-1">Your actions will appear here</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ActivityLogPanel;
