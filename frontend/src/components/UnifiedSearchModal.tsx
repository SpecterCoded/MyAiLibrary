import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { logActivity } from '../utils/activityLogger';

const Highlight = ({ text }: { text: string }) => (
  <span className="bg-[#E26D6D] text-white px-1 py-0.5 rounded-[4px] font-medium text-[13px] inline-block alignment-baseline">
    {text}
  </span>
);

type SearchResult = {
  id: string;
  result_type: string;
  content_type: string;
  title: string;
  snippet: string;
  source_name: string;
  source_id: string;
  resource_id?: string | null;
  resource_title?: string | null;
  resource_type?: string | null;
  page?: number | null;
  timestamp?: number | null;
  relevance_score: number;
  matching_reason: string;
  matching_reasons?: string[];
  preview_url?: string | null;
  folder_id?: string | null;
  local_path?: string | null;
  metadata?: Record<string, unknown>;
};

type SearchResponse = {
  query: string;
  results: SearchResult[];
  facets: Record<string, number>;
  metrics: {
    latency_ms?: number;
    cache_hit?: boolean;
    result_count?: number;
    content_type_distribution?: Record<string, number>;
    search_source_usage?: Record<string, number>;
  };
};

const HISTORY_KEY = 'cross_library_search_history_v1';

const formatTimestamp = (seconds?: number | null) => {
  if (typeof seconds !== 'number' || Number.isNaN(seconds)) return null;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
};

const humanizeFilter = (value: string) =>
  value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function UnifiedSearchModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [animate, setAnimate] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('All');
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [searchResponse, setSearchResponse] = useState<SearchResponse>({
    query: '',
    results: [],
    facets: {},
    metrics: {},
  });

  const resultsRef = useRef<HTMLDivElement>(null);
  const cacheRef = useRef<Map<string, SearchResponse>>(new Map());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setHistory(parsed.filter((item): item is string => typeof item === 'string').slice(0, 8));
      }
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      requestAnimationFrame(() => setAnimate(true));
      return;
    }

    setAnimate(false);
    const timer = setTimeout(() => setShouldRender(false), 300);
    return () => clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (!searchQuery.trim()) {
      setSearchResponse({ query: '', results: [], facets: {}, metrics: {} });
      setActiveIndex(0);
      return;
    }

    const normalized = searchQuery.trim().toLowerCase();
    const cached = cacheRef.current.get(normalized);
    if (cached) {
      setSearchResponse(cached);
      setActiveIndex(0);
      setLoading(false);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const token = localStorage.getItem('access_token');
        logActivity('search', `Unified search "${searchQuery.trim()}"`);
        const response = await fetch(`/search/unified?query=${encodeURIComponent(searchQuery.trim())}&limit=30`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) throw new Error('Unified search failed');
        const payload = (await response.json()) as SearchResponse;
        cacheRef.current.set(normalized, payload);
        setSearchResponse(payload);
        setActiveIndex(0);
      } catch (error) {
        console.error('Unified search error:', error);
        setSearchResponse({ query: searchQuery.trim(), results: [], facets: {}, metrics: {} });
      } finally {
        setLoading(false);
      }
    }, 180);

    return () => clearTimeout(timer);
  }, [isOpen, searchQuery]);

  const pushHistory = (value: string) => {
    const clean = value.trim();
    if (!clean) return;
    const next = [clean, ...history.filter((item) => item.toLowerCase() !== clean.toLowerCase())].slice(0, 8);
    setHistory(next);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  };

  const availableFilters = useMemo(() => {
    const filters = ['All'];
    const facets = searchResponse.facets || {};
    const ordered = Object.keys(facets)
      .filter((key) => key !== 'all' && facets[key] > 0)
      .map(humanizeFilter);
    return [...filters, ...ordered.filter((item, index) => ordered.indexOf(item) === index)];
  }, [searchResponse.facets]);

  const filteredResults = useMemo(() => {
    if (activeFilter === 'All') return searchResponse.results;
    const normalized = activeFilter.toLowerCase().replace(/\s+/g, '_');
    return searchResponse.results.filter((item) => item.content_type === normalized || item.result_type === normalized);
  }, [activeFilter, searchResponse.results]);

  const activeItem = filteredResults[activeIndex];
  const autocompleteSuggestion =
    activeItem && searchQuery && activeItem.title.toLowerCase().startsWith(searchQuery.toLowerCase())
      ? activeItem.title.slice(searchQuery.length)
      : '';

  const filteredItemsRef = useRef(filteredResults);
  filteredItemsRef.current = filteredResults;
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const items = filteredItemsRef.current;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, Math.max(items.length - 1, 0)));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
      } else if (event.key === 'Escape') {
        onClose();
      } else if (event.key === 'Tab') {
        const current = items[activeIndexRef.current];
        if (current) {
          event.preventDefault();
          setSearchQuery(current.title);
        }
      } else if (event.key === 'Enter') {
        const current = items[activeIndexRef.current];
        if (current) {
          event.preventDefault();
          void handleOpen(current);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose, searchQuery]);

  useEffect(() => {
    const rows = resultsRef.current?.querySelectorAll('.result-item');
    rows?.[activeIndex]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [activeIndex]);

  const highlightText = (text: string, query: string) => {
    if (!query || !text) return text;
    const parts = text.split(new RegExp(`(${query.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')})`, 'gi'));
    return (
      <>
        {parts.map((part, index) =>
          part.toLowerCase() === query.toLowerCase() ? <Highlight key={index} text={part} /> : part,
        )}
      </>
    );
  };

  const logClick = async (item: SearchResult) => {
    try {
      const token = localStorage.getItem('access_token');
      await fetch('/search/unified/click', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          query: searchQuery.trim(),
          result_id: item.id,
          result_type: item.result_type,
          content_type: item.content_type,
          source_id: item.source_id,
        }),
      });
    } catch {
      // intentionally silent
    }
  };

  const navigateToResource = (item: SearchResult) => {
    const resourceType = item.resource_type || item.content_type;
    const resourceId = item.resource_id || item.source_id;
    if ((resourceType === 'video' || resourceType === 'audio') && resourceId && item.local_path) {
      const param = resourceType === 'video' ? 'videoUrl' : 'audioUrl';
      let query = `${param}=${encodeURIComponent(item.local_path)}&resourceId=${encodeURIComponent(resourceId)}`;
      if (typeof item.timestamp === 'number') query += `&t=${item.timestamp}`;
      window.location.search = query;
      return;
    }

    if (item.folder_id) {
      window.dispatchEvent(new CustomEvent('app-navigate', { detail: { view: 'folder', id: item.folder_id } }));
      return;
    }

    window.dispatchEvent(new CustomEvent('app-navigate', { detail: { view: 'library' } }));
  };

  const handleOpen = async (item: SearchResult) => {
    pushHistory(searchQuery);
    void logClick(item);

    if (item.result_type === 'note') {
      localStorage.setItem('open_note_id', item.source_id);
      window.dispatchEvent(new CustomEvent('open-notebook-view'));
      onClose();
      return;
    }

    if (item.result_type === 'concept') {
      localStorage.setItem('open_concept_id', item.source_id);
      window.dispatchEvent(new CustomEvent('app-navigate', { detail: { view: 'concepts' } }));
      onClose();
      return;
    }

    navigateToResource(item);
    onClose();
  };

  const handleAskAi = (item: SearchResult) => {
    pushHistory(searchQuery);
    void logClick(item);
    localStorage.setItem(
      'pending_chat_context',
      JSON.stringify({
        prompt: searchQuery.trim()
          ? `Help me with this from "${item.resource_title || item.title}": ${searchQuery.trim()}`
          : `Tell me about "${item.resource_title || item.title}".`,
        resources: item.resource_id
          ? [{ id: item.resource_id, title: item.resource_title || item.title }]
          : [],
        global: !item.resource_id,
      }),
    );
    window.dispatchEvent(new CustomEvent('app-navigate', { detail: { view: 'chat' } }));
    onClose();
  };

  const renderItemIcon = (item: SearchResult) => {
    if (item.result_type === 'note') {
      return <svg className="w-4 h-4 text-emerald-600 mt-1 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>;
    }
    if (item.result_type === 'chapter') {
      return <svg className="w-4 h-4 text-indigo-500 mt-1 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>;
    }
    if (item.result_type === 'subchapter') {
      return <svg className="w-4 h-4 text-indigo-400 mt-1 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h10M4 18h6" /></svg>;
    }
    if (item.content_type === 'video') {
      return <svg className="w-4 h-4 text-teal-600 mt-1 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>;
    }
    if (item.content_type === 'audio') {
      return <svg className="w-4 h-4 text-fuchsia-600 mt-1 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-2v13M9 19a2 2 0 11-4 0 2 2 0 014 0zm12-2a2 2 0 11-4 0 2 2 0 014 0z" /></svg>;
    }
    if (item.content_type === 'image') {
      return <svg className="w-4 h-4 text-amber-600 mt-1 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4-4a3 5 0 014 0l4 4m-2-2l1-1a3 5 0 014 0l1 1M4 6h16v12H4z" /></svg>;
    }
    if (item.result_type === 'concept') {
      return <svg className="w-4 h-4 text-yellow-600 mt-1 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>;
    }
    return <svg className="w-4 h-4 text-blue-600 mt-1 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>;
  };

  const getResultClass = (index: number) =>
    `result-item p-3 rounded-xl border border-transparent transition-all ${activeIndex === index ? 'bg-[#F2EFE9] shadow-sm' : 'hover:bg-stone-100/50 hover:border-stone-200'}`;

  if (!shouldRender) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center p-4 pt-[12vh]">
      <motion.div
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: animate ? 1 : 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        onClick={onClose}
      />

      <motion.div
        id="search-modal-container"
        className="relative w-full max-w-4xl bg-[#FCFAF7] border border-[#EFECE6] shadow-[0_32px_64px_-16px_rgba(40,35,30,0.12)] rounded-3xl overflow-hidden font-sans"
        initial={{ opacity: 0, scale: 0.94, y: 24, filter: 'blur(8px)' }}
        animate={animate ? { opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' } : { opacity: 0, scale: 0.96, y: 18, filter: 'blur(6px)' }}
        exit={{ opacity: 0, scale: 0.96, y: 18, filter: 'blur(6px)' }}
        transition={{
          opacity: { duration: 0.24, ease: [0.16, 1, 0.3, 1] },
          scale: { type: 'spring', stiffness: 430, damping: 32, mass: 0.8 },
          y: { type: 'spring', stiffness: 430, damping: 34, mass: 0.8 },
          filter: { duration: 0.24, ease: [0.16, 1, 0.3, 1] },
        }}
      >
        <div id="search-modal-header" className="flex items-center justify-between px-6 py-4.5 border-b border-[#F1EFEA]">
          <div className="flex items-center gap-3 flex-1">
            <svg className="w-5 h-5 text-stone-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <div className="relative flex-1 flex items-center">
              {searchQuery && autocompleteSuggestion && (
                <div className="absolute left-0 top-0 w-full text-[18px] font-semibold outline-none pointer-events-none select-none text-stone-300 flex whitespace-pre">
                  <span className="opacity-0">{searchQuery}</span>
                  <span>{autocompleteSuggestion}</span>
                </div>
              )}
              <input
                type="text"
                autoFocus
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search your whole library..."
                className="w-full bg-transparent border-none text-[18px] font-semibold outline-none text-stone-900 placeholder-stone-400 relative z-10"
                style={{ padding: '0', margin: '0', lineHeight: 'normal' }}
              />
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center bg-stone-100 hover:bg-stone-200 text-stone-500 rounded-full transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div id="search-modal-filters" className="flex items-center gap-2 px-6 py-3.5 border-b border-[#F1EFEA] overflow-x-auto select-none font-sans">
          {availableFilters.map((filter) => (
            <button
              key={filter}
              onClick={() => {
                setActiveFilter(filter);
                setActiveIndex(0);
              }}
              className={`flex items-center gap-1.5 px-4 py-1.5 text-[13px] font-semibold rounded-full transition-all border ${activeFilter === filter ? 'bg-[#2E2C29] text-white border-[#2E2C29]' : 'bg-white border-[#EFECE6] text-stone-600 hover:text-stone-900 hover:border-stone-300'}`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
              {filter}
            </button>
          ))}
        </div>

        <div id="search-modal-results" ref={resultsRef} className="max-h-[55vh] overflow-y-auto no-scrollbar p-4 space-y-6">
          {loading ? (
            <div className="py-20 flex flex-col items-center justify-center text-stone-400">
              <div className="w-6 h-6 border-2 border-stone-400 border-t-transparent rounded-full animate-spin mb-3" />
              <span className="text-[13px] font-semibold">Searching library...</span>
            </div>
          ) : !searchQuery.trim() ? (
            <div className="space-y-4 py-6">
              <div className="rounded-2xl border border-[#EFECE6] bg-white p-4">
                <h3 className="text-sm font-bold text-stone-800">Unified search is now hybrid</h3>
                <p className="text-[12px] text-stone-400 mt-1">
                  One search now ranks semantic matches, keyword hits, notes, and AI-generated document metadata together.
                </p>
              </div>
              <div className="rounded-2xl border border-[#EFECE6] bg-white p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-[12px] font-bold uppercase tracking-wider text-stone-400">Recent searches</h4>
                  {history.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setHistory([]);
                        localStorage.removeItem(HISTORY_KEY);
                      }}
                      className="text-[11px] text-stone-500 hover:text-stone-700"
                    >
                      Clear
                    </button>
                  )}
                </div>
                {history.length === 0 ? (
                  <p className="text-[12px] text-stone-400">Your recent searches will appear here.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {history.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setSearchQuery(item)}
                        className="rounded-full border border-[#EFECE6] bg-[#FAF8F5] px-3 py-1.5 text-[12px] font-medium text-stone-600 hover:text-stone-900"
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : filteredResults.length === 0 ? (
            <div className="py-20 text-center text-stone-400">
              <svg className="w-12 h-12 mx-auto text-stone-300 mb-3" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              <h3 className="text-sm font-bold text-stone-700">No results found</h3>
              <p className="text-[12px] text-stone-400 mt-1">Try a file name, transcript phrase, tag, or topic.</p>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="flex items-center justify-between px-3">
                <div className="text-[10px] font-bold text-stone-400 tracking-wider uppercase select-none">Ranked results</div>
                <div className="text-[11px] text-stone-400">
                  {searchResponse.metrics.result_count ?? filteredResults.length} results • {Math.round(searchResponse.metrics.latency_ms || 0)} ms
                  {searchResponse.metrics.cache_hit ? ' • cached' : ''}
                </div>
              </div>
              {filteredResults.map((item, index) => (
                <div
                  key={item.id}
                  className={getResultClass(index)}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <div className="flex items-start gap-2.5">
                    {renderItemIcon(item)}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h4 className="text-[14px] font-bold text-stone-850 truncate">{highlightText(item.title, searchQuery)}</h4>
                          <div className="text-[11px] text-stone-400 font-medium mt-0.5 select-none flex flex-wrap gap-2">
                            <span>{humanizeFilter(item.content_type || item.result_type)}</span>
                            <span>•</span>
                            <span>{item.source_name}</span>
                            {typeof item.page === 'number' && (
                              <>
                                <span>•</span>
                                <span>Page {item.page}</span>
                              </>
                            )}
                            {formatTimestamp(item.timestamp) && (
                              <>
                                <span>•</span>
                                <span>{formatTimestamp(item.timestamp)}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-[11px] font-semibold text-stone-600">{Math.round((item.relevance_score || 0) * 100)}%</div>
                          <div className="text-[10px] text-stone-400">{item.matching_reason}</div>
                        </div>
                      </div>
                      {item.snippet && (
                        <p className="text-[12px] text-stone-500 mt-1 leading-relaxed line-clamp-2">{highlightText(item.snippet, searchQuery)}</p>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" onClick={() => void handleOpen(item)} className="rounded-full bg-stone-900 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-stone-800">Open</button>
                        <button type="button" onClick={() => handleAskAi(item)} className="rounded-full border border-[#E5E0D8] bg-white px-3 py-1.5 text-[11px] font-semibold text-stone-700 hover:text-stone-900">Ask AI</button>
                        <button type="button" onClick={() => navigateToResource(item)} className="rounded-full border border-[#E5E0D8] bg-[#FAF8F5] px-3 py-1.5 text-[11px] font-semibold text-stone-700 hover:text-stone-900">Preview</button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div id="search-modal-footer" className="bg-[#FAF8F5] px-6 py-3.5 border-t border-[#F1EFEA] flex items-center justify-between text-[12px] text-stone-400 font-medium select-none">
          <div className="flex items-center text-stone-400">
            <svg className="w-5 h-5 opacity-70" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2A10 10 0 002 12a10 10 0 0010 10 10 10 0 0010-10A10 10 0 0012 2zm-1 14.5v-9l6 4.5-6 4.5z" />
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
              <span>Open</span>
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
}
