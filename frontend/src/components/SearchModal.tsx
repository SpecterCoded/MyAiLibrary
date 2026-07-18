import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { logActivity } from '../utils/activityLogger';

// Helper component to replicate the exact coral match highlight from 985a5bff8e08f5768ac5cbe06b13027c_3.webp
const Highlight = ({ text }: { text: string }) => (
  <span className="bg-[#E26D6D] text-white px-1 py-0.5 rounded-[4px] font-medium text-[13px] inline-block alignment-baseline">
    {text}
  </span>
);

interface SearchItem {
  id: string;
  category: 'Resources' | 'Chapters' | 'Subchapters' | 'Notes' | 'Concepts' | 'Folders';
  title: string;
  subtitle?: string;
  desc?: string;
  raw: any;
}


const CommandSearchModal: React.FC<{ isOpen: boolean, onClose: () => void }> = ({ isOpen, onClose }) => {
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [animate, setAnimate] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('All');
  const [activeIndex, setActiveIndex] = useState(0);

  const [searchResults, setSearchResults] = useState<{
    resources: any[];
    chapters: any[];
    subchapters: any[];
    notes: any[];
    concepts: any[];
    folders: any[];
  }>({ resources: [], chapters: [], subchapters: [], notes: [], concepts: [], folders: [] });
  const [loading, setLoading] = useState(false);

  const resultsRef = useRef<HTMLDivElement>(null);

  // Debounced search fetcher
  useEffect(() => {
    if (!isOpen) return;
    if (!searchQuery.trim()) {
      setSearchResults({ resources: [], chapters: [], subchapters: [], notes: [], concepts: [], folders: [] });
      return;
    }

    const delayDebounce = setTimeout(async () => {
      setLoading(true);
      try {
        const token = localStorage.getItem('access_token');
        const headers: Record<string, string> = {};
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
        logActivity('search', `Searched "${searchQuery.trim()}"`);
        const res = await fetch(`/search?query=${encodeURIComponent(searchQuery.trim())}`, {
          headers
        });
        if (res.ok) {
          const data = await res.json();
          setSearchResults({
            resources: data.resources || [],
            chapters: data.chapters || [],
            subchapters: data.subchapters || [],
            notes: data.notes || [],
            concepts: data.concepts || [],
            folders: data.folders || [],
          });
          setActiveIndex(0);
        }
      } catch (err) {
        console.error("Search fetch error:", err);
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => clearTimeout(delayDebounce);
  }, [searchQuery, isOpen]);

  // Construct flat list of items for keyboard navigation and rendering
  const getFilteredItemsList = (): SearchItem[] => {
    const list: SearchItem[] = [];

    // Folders Group
    if (activeFilter === 'All' || activeFilter === 'Folders') {
      searchResults.folders.forEach(f => {
        list.push({
          id: f.id,
          category: 'Folders',
          title: f.name || 'Untitled Folder',
          desc: 'Folder in playlist storage',
          raw: f
        });
      });
    }

    // Resources Group
    if (activeFilter === 'All' || activeFilter === 'Resources') {
      searchResults.resources.forEach(r => {
        list.push({
          id: r.id,
          category: 'Resources',
          title: r.title || 'Untitled Resource',
          subtitle: r.type ? `${r.type.toUpperCase()} File` : 'File Resource',
          desc: r.description || r.summary || '',
          raw: r
        });
      });
    }

    // Chapters Group
    if (activeFilter === 'All' || activeFilter === 'Chapters') {
      searchResults.chapters.forEach(c => {
        const timeStr = c.start_time !== undefined 
          ? `🕒 Position: ${Math.floor(c.start_time / 60)}m ${c.start_time % 60}s` 
          : '';
        list.push({
          id: c.id,
          category: 'Chapters',
          title: c.title || 'Untitled Chapter',
          subtitle: c.resource_title ? `In file: ${c.resource_title}` : timeStr,
          desc: c.summary || c.transcript || '',
          raw: c
        });
      });
    }

    // Subchapters Group
    if (activeFilter === 'All' || activeFilter === 'Subchapters') {
      searchResults.subchapters.forEach(s => {
        const timeStr = s.start_time !== undefined 
          ? `🕒 Position: ${Math.floor(s.start_time / 60)}m ${s.start_time % 60}s` 
          : '';
        list.push({
          id: s.id,
          category: 'Subchapters',
          title: s.title || 'Untitled Subchapter',
          subtitle: s.resource_title ? `In file: ${s.resource_title}` : timeStr,
          desc: s.summary || s.transcript || '',
          raw: s
        });
      });
    }

    // Notes Group
    if (activeFilter === 'All' || activeFilter === 'Notes') {
      searchResults.notes.forEach(n => {
        list.push({
          id: n.id,
          category: 'Notes',
          title: n.title || 'Untitled Note',
          subtitle: n.tags ? `Tags: ${n.tags}` : 'Study Note',
          desc: n.content || '',
          raw: n
        });
      });
    }

    // Concepts Group
    if (activeFilter === 'All' || activeFilter === 'Concepts') {
      searchResults.concepts.forEach(c => {
        list.push({
          id: c.id,
          category: 'Concepts',
          title: c.name || 'Untitled Concept',
          subtitle: 'Concept Node',
          desc: c.description || '',
          raw: c
        });
      });
    }

    return list;
  };

  const filteredItems = getFilteredItemsList();

  // Create refs to keep values fresh in the event listener closure (synced synchronously during render)
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  const filteredItemsRef = useRef(filteredItems);
  filteredItemsRef.current = filteredItems;

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      requestAnimationFrame(() => setAnimate(true));
      setSearchQuery('');
      setActiveFilter('All');
      setActiveIndex(0);
      
      const handleKeyDown = (e: KeyboardEvent) => {
        const items = filteredItemsRef.current;
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setActiveIndex(prev => {
            const next = Math.min(prev + 1, items.length - 1);
            setTimeout(() => {
              const elements = resultsRef.current?.querySelectorAll('.result-item');
              elements?.[next]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 10);
            return next;
          });
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setActiveIndex(prev => {
            const next = Math.max(prev - 1, 0);
            setTimeout(() => {
              const elements = resultsRef.current?.querySelectorAll('.result-item');
              elements?.[next]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 10);
            return next;
          });
        } else if (e.key === 'Escape') {
          onClose();
        } else if (e.key === 'Tab') {
          e.preventDefault();
          // Autocomplete using current active item title
          const activeItem = items[activeIndexRef.current];
          if (activeItem) {
            setSearchQuery(activeItem.title);
          }
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const activeItem = items[activeIndexRef.current];
          if (activeItem) {
            handleItemClick(activeItem);
          }
        }
      };
      
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    } else {
      setAnimate(false);
      const timer = setTimeout(() => setShouldRender(false), 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen, onClose]);

  if (!shouldRender) return null;

  const handleItemClick = (item: SearchItem) => {
    const raw = item.raw;
    if (item.category === 'Folders') {
      window.dispatchEvent(new CustomEvent('app-navigate', { detail: { view: 'folder', id: item.id } }));
    } else if (item.category === 'Resources') {
      if (raw.type === 'video') {
        window.location.search = `videoUrl=${encodeURIComponent(raw.local_path)}&resourceId=${raw.id}`;
      } else if (raw.type === 'audio') {
        window.location.search = `audioUrl=${encodeURIComponent(raw.local_path)}&resourceId=${raw.id}`;
      } else {
        // PDF, markdown, images, etc: navigate to parent folder
        if (raw.folder_id) {
          window.dispatchEvent(new CustomEvent('app-navigate', { detail: { view: 'folder', id: raw.folder_id } }));
        }
      }
    } else if (item.category === 'Chapters' || item.category === 'Subchapters') {
      const resType = raw.resource_type || '';
      const resPath = raw.resource_local_path || '';
      const resId = raw.resource_id || '';
      if (resId && resPath) {
        let q = '';
        if (resType === 'video') {
          q = `videoUrl=${encodeURIComponent(resPath)}&resourceId=${resId}`;
        } else if (resType === 'audio') {
          q = `audioUrl=${encodeURIComponent(resPath)}&resourceId=${resId}`;
        }
        if (q && raw.start_time !== undefined) {
          q += `&t=${raw.start_time}`;
        }
        if (q) {
          window.location.search = q;
        }
      }
    } else if (item.category === 'Notes') {
      localStorage.setItem('open_note_id', item.id);
      window.dispatchEvent(new CustomEvent('open-notebook-view'));
    } else if (item.category === 'Concepts') {
      localStorage.setItem('open_concept_id', item.id);
      window.dispatchEvent(new CustomEvent('app-navigate', { detail: { view: 'concepts' } }));
    }
    onClose();
  };

  const getResultClass = (index: number) => 
    `result-item p-3 rounded-xl border border-transparent transition-all cursor-pointer ${activeIndex === index ? 'bg-[#F2EFE9] shadow-sm' : 'hover:bg-stone-100/50 hover:border-stone-200'}`;

  const renderItemIcon = (item: SearchItem) => {
    if (item.category === 'Folders') {
      return <svg className="w-4 h-4 text-amber-600 mt-1 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/></svg>;
    }
    if (item.category === 'Chapters') {
      return <svg className="w-4 h-4 text-indigo-500 mt-1 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>;
    }
    if (item.category === 'Subchapters') {
      return <svg className="w-4 h-4 text-indigo-400 mt-1 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h10M4 18h6"/></svg>;
    }
    if (item.category === 'Notes') {
      return <svg className="w-4 h-4 text-emerald-600 mt-1 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>;
    }
    if (item.category === 'Concepts') {
      return <svg className="w-4 h-4 text-yellow-600 mt-1 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>;
    }
    const sub = (item.subtitle || '').toLowerCase();
    if (sub.includes('video')) {
      return <svg className="w-4 h-4 text-teal-600 mt-1 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>;
    }
    return <svg className="w-4 h-4 text-blue-600 mt-1 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>;
  };

  const highlightText = (text: string, query: string) => {
    if (!query || !text) return text;
    const parts = text.split(new RegExp(`(${query.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')})`, 'gi'));
    return (
      <>
        {parts.map((part, i) => 
          part.toLowerCase() === query.toLowerCase() 
            ? <Highlight key={i} text={part} /> 
            : part
        )}
      </>
    );
  };

  const categories: ('Resources' | 'Chapters' | 'Subchapters' | 'Notes' | 'Concepts' | 'Folders')[] = 
    ['Folders', 'Resources', 'Chapters', 'Subchapters', 'Notes', 'Concepts'];

  const activeItem = filteredItems[activeIndex];
  let autocompleteSuggestion = '';
  if (activeItem && searchQuery && activeItem.title.toLowerCase().startsWith(searchQuery.toLowerCase())) {
    autocompleteSuggestion = activeItem.title.slice(searchQuery.length);
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center p-4 pt-[12vh]">
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: animate ? 1 : 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        onClick={onClose}
      />

      {/* Main Container */}
      <motion.div
        id="search-modal-container"
        className="relative w-full max-w-4xl bg-[#FCFAF7] border border-[#EFECE6] shadow-[0_32px_64px_-16px_rgba(40,35,30,0.12)] rounded-3xl overflow-hidden font-sans"
        initial={{ opacity: 0, scale: 0.94, y: 24, filter: 'blur(8px)' }}
        animate={animate ? { opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' } : { opacity: 0, scale: 0.96, y: 18, filter: 'blur(6px)' }}
        exit={{ opacity: 0, scale: 0.96, y: 18, filter: 'blur(6px)' }}
        transition={{
          opacity: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
          scale: { type: 'spring', stiffness: 300, damping: 36, mass: 0.9 },
          y: { type: 'spring', stiffness: 300, damping: 38, mass: 0.9 },
          filter: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
        }}
      >
        
        {/* 1. Top Search Bar */}
        <div id="search-modal-header" className="flex items-center justify-between px-6 py-4.5 border-b border-[#F1EFEA]">
          <div className="flex items-center gap-3 flex-1">
            <svg className="w-5 h-5 text-stone-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
            </svg>
            <div className="relative flex-1 flex items-center">
              {searchQuery && autocompleteSuggestion && (
                <div 
                  className="absolute left-0 top-0 w-full text-[18px] font-semibold outline-none pointer-events-none select-none text-stone-300 dark:text-stone-600/50 flex whitespace-pre"
                  style={{ padding: '0', margin: '0', border: 'none', lineHeight: 'normal' }}
                >
                  <span className="opacity-0">{searchQuery}</span>
                  <span>{autocompleteSuggestion}</span>
                </div>
              )}
              <input 
                type="text" 
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search your library..." 
                className="w-full bg-transparent border-none text-[18px] font-semibold outline-none text-stone-900 placeholder-stone-400 relative z-10 focus:ring-0"
                style={{ padding: '0', margin: '0', lineHeight: 'normal' }}
              />
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center bg-stone-100 hover:bg-stone-200 text-stone-500 rounded-full transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        {/* 2. Filter Pills */}
        <div id="search-modal-filters" className="flex items-center gap-2 px-6 py-3.5 border-b border-[#F1EFEA] overflow-x-auto select-none font-sans">
          <button 
            onClick={() => { setActiveFilter('All'); setActiveIndex(0); }}
            className={`flex items-center gap-1.5 px-4 py-1.5 text-[13px] font-semibold rounded-full transition-all border ${activeFilter === 'All' ? 'bg-[#2E2C29] text-white border-[#2E2C29]' : 'bg-white border-[#EFECE6] text-stone-600 hover:text-stone-900 hover:border-stone-300'}`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16"/></svg>
            All
          </button>
          {[
            { label: 'Folders', icon: 'M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z' },
            { label: 'Resources', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
            { label: 'Chapters', icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z' },
            { label: 'Subchapters', icon: 'M4 6h16M4 12h10M4 18h6' },
            { label: 'Notes', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
            { label: 'Concepts', icon: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z' }
          ].map((tab) => (
            <button 
              key={tab.label}
              onClick={() => { setActiveFilter(tab.label); setActiveIndex(0); }}
              className={`flex items-center gap-1.5 px-4 py-1.5 text-[13px] font-semibold rounded-full transition-all border ${activeFilter === tab.label ? 'bg-[#2E2C29] text-white border-[#2E2C29]' : 'bg-white border-[#EFECE6] text-stone-600 hover:text-stone-900 hover:border-stone-300 font-sans'}`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d={tab.icon}/></svg>
              {tab.label}
            </button>
          ))}
        </div>

        {/* 3. Search Results Stack */}
        <div id="search-modal-results" ref={resultsRef} className="max-h-[55vh] overflow-y-auto no-scrollbar p-4 space-y-6">
          {loading ? (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15 }}
              className="py-20 flex flex-col items-center justify-center text-stone-400"
            >
              <div className="w-6 h-6 border-2 border-stone-300 border-t-indigo-500 rounded-full animate-spin mb-3"></div>
              <span className="text-[13px] font-semibold">Searching library...</span>
            </motion.div>
          ) : filteredItems.length === 0 ? (
            <div className="py-20 text-center text-stone-400">
              <svg className="w-12 h-12 mx-auto text-stone-300 mb-3" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
              <h3 className="text-sm font-bold text-stone-700">No results found</h3>
              <p className="text-[12px] text-stone-400 mt-1">Try searching for keywords, transcripts, notes, or folders.</p>
            </div>
          ) : (
            categories.map((cat) => {
              const catItems = filteredItems.filter(item => item.category === cat);
              if (catItems.length === 0) return null;

              return (
                <div key={cat}>
                  <div className="text-[10px] font-bold text-stone-400 tracking-wider px-3 mb-2 uppercase select-none">{cat}</div>
                  <div className="space-y-1">
                    {catItems.map((item) => {
                      const globalIndex = filteredItems.findIndex(fi => fi.id === item.id && fi.category === item.category);
                      return (
                        <motion.div 
                          key={item.id} 
                          className={getResultClass(globalIndex)}
                          onClick={() => handleItemClick(item)}
                          onMouseEnter={() => setActiveIndex(globalIndex)}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.2, delay: Math.min(globalIndex * 0.03, 0.3), ease: [0.16, 1, 0.3, 1] }}
                        >
                          <div className="flex items-start gap-2.5">
                            {renderItemIcon(item)}
                            <div className="min-w-0 flex-1">
                              <h4 className="text-[14px] font-bold text-stone-850 truncate">
                                {highlightText(item.title, searchQuery)}
                              </h4>
                              {item.subtitle && (
                                <div className="text-[11px] text-stone-400 font-medium mt-0.5 select-none">
                                  {item.subtitle}
                                </div>
                              )}
                              {item.desc && (
                                <p className="text-[12px] text-stone-500 mt-1 leading-relaxed line-clamp-2">
                                  {highlightText(item.desc, searchQuery)}
                                </p>
                              )}
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 4. Action Shortcuts Footer Bar */}
        <div id="search-modal-footer" className="bg-[#FAF8F5] px-6 py-3.5 border-t border-[#F1EFEA] flex items-center justify-between text-[12px] text-stone-400 font-medium select-none">
          <div className="flex items-center text-stone-400">
            <svg className="w-5 h-5 opacity-70" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2A10 10 0 002 12a10 10 0 0010 10 10 10 0 0010-10A10 10 0 0012 2zm-1 14.5v-9l6 4.5-6 4.5z"/>
            </svg>
          </div>
          <div className="flex items-center gap-5">
            <span className="flex items-center gap-1.5">
              <span className="flex gap-0.5">
                <kbd className="px-1.5 py-0.5 text-[10px] font-bold bg-white border border-stone-200 shadow-sm rounded">↑</kbd>
                <kbd className="px-1.5 py-0.5 text-[10px] font-bold bg-white border border-stone-200 shadow-sm rounded">↓</kbd>
              </span>
              <span>Move</span>
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 text-[10px] font-bold bg-white border border-stone-200 shadow-sm rounded">↵</kbd>
              <span>Select</span>
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 text-[10px] font-bold bg-white border border-stone-200 shadow-sm rounded text-stone-500 uppercase">Tab</kbd>
              <span>Auto complete</span>
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 text-[10px] font-bold bg-white border border-stone-200 shadow-sm rounded text-stone-500 uppercase">Esc</kbd>
              <span>Close</span>
            </span>
          </div>
        </div>

      </motion.div>
    </div>
  );
};

export default CommandSearchModal;
