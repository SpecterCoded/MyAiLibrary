import React, { useState, useEffect } from 'react';
import PlaylistCard, { type PlaylistIconType } from './PlaylistCard';
import { PlaylistCardSkeleton } from './loadingskeleton';
import { Sparkles, Check, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import EmptyState from './EmptyState';

interface BackendPlaylist {
  id: string;
  name: string;
  description?: string;
  icon_type?: string;
  is_favorite?: number;
  created_at?: string | null;
  updated_at?: string | null;
  item_count?: number;
}

interface LibraryViewProps {
  onNavigateToFolder: (id: string, name: string) => void;
  onCreatePlaylistClick: () => void;
  onShare?: (id: string, name: string) => void;
}

export default function LibraryView({
  onNavigateToFolder,
  onCreatePlaylistClick,
  onShare
}: LibraryViewProps) {
  const [playlists, setPlaylists] = useState<BackendPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'my-library' | 'saved'>('my-library');
  const [filterQuery, setFilterQuery] = useState('');
  const [sortOption, setSortOption] = useState('newest');
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);

  const SORT_OPTIONS = [
    { value: 'newest', label: 'Newest – Oldest' },
    { value: 'oldest', label: 'Oldest – Newest' },
    { value: 'az', label: 'A – Z' },
    { value: 'za', label: 'Z – A' },
  ];

  const fetchPlaylists = async () => {
    try {
      const token = localStorage.getItem('access_token');
      const response = await fetch('/playlists', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        setPlaylists(data);
      } else {
        console.error('Failed to fetch playlists');
      }
    } catch (err) {
      console.error('Error fetching playlists:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlaylists();
    window.addEventListener('refresh-playlists', fetchPlaylists);
    return () => {
      window.removeEventListener('refresh-playlists', fetchPlaylists);
    };
  }, []);

  const getPlaylistCardProps = (name: string, description: string | undefined | null, iconType: string | undefined | null, itemCount: number | undefined, idx: number) => {
    const categories = ["Design System", "Product Dev", "Marketing", "Feedback Sync", "UX Research"];
    const dates = ["Sun - Sep 29th", "Tue - Oct 8th", "Thu - Oct 10th", "Mon - Oct 12th", "Wed - Oct 14th"];
    const timeframes = ["02:35 PM - 02:45 PM", "11:00 AM - 11:30 AM", "03:30 PM - 04:00 PM", "10:00 AM - 11:30 AM", "01:00 PM - 02:30 PM"];
    const fallbackDescriptions = [
      "Workspace playlist containing transcripts, resources, and documents.",
      "A collection of indexed folders and files for quick AI queries.",
      "Project playlist organized for codebase indexing and knowledge search.",
      "Sync session documents, notes, and resources for team alignment.",
      "UX/UI research papers, design system specs, and assets collection."
    ];
    const iconTypes: PlaylistIconType[] = ['shape', 'initials'];

    return {
      category: categories[idx % categories.length],
      title: name,
      date: dates[idx % dates.length],
      timeframe: timeframes[idx % timeframes.length],
      description: (description && description.trim()) ? description : fallbackDescriptions[idx % fallbackDescriptions.length],
      iconType: (iconType && iconType.trim()) ? (iconType as PlaylistIconType) : iconTypes[idx % iconTypes.length],
      itemCount: itemCount != null ? `${itemCount} item${itemCount === 1 ? '' : 's'}` : '0 items'
    };
  };

  // Filter playlists
  let filteredPlaylists = playlists.filter(playlist => {
    const matchesQuery = 
      playlist.name.toLowerCase().includes(filterQuery.toLowerCase()) ||
      (playlist.description || '').toLowerCase().includes(filterQuery.toLowerCase());
    
    if (activeTab === 'saved') {
      // Show filtered list of favorited playlists
      return matchesQuery && playlist.is_favorite === 1;
    }
    return matchesQuery;
  });

  // Sort playlists
  filteredPlaylists = [...filteredPlaylists].sort((a, b) => {
    if (sortOption === 'az') {
      return a.name.localeCompare(b.name);
    }
    if (sortOption === 'za') {
      return b.name.localeCompare(a.name);
    }
    if (sortOption === 'oldest') {
      return a.id.localeCompare(b.id);
    }
    return b.id.localeCompare(a.id);
  });

  return (
    <div className="flex-1 flex flex-col">
      <section className="mb-6 select-none">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-800">Your Library</h1>
        <p className="text-[13px] font-semibold text-slate-400 mt-0.5">Organize, track, and discover curated knowledge bundles.</p>
      </section>

      {/* Filtering Controls Bar Container */}
      <section className="flex flex-col gap-4 mb-6 pb-2 border-b border-slate-200/40">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 w-full">
          
          {/* React Controlled Library Tab System */}
          <div className="flex gap-1.5 p-1 bg-slate-200/50 backdrop-blur-md rounded-2xl border border-slate-200/40 shrink-0 select-none">
            <button 
              onClick={() => setActiveTab('my-library')}
              type="button"
              className={`font-bold text-[13px] px-5 py-2.5 rounded-xl shadow-sm transition-all duration-200 cursor-pointer ${
                activeTab === 'my-library' ? 'bg-white text-slate-800' : 'text-slate-500 hover:text-slate-800 hover:bg-white/30'
              }`}
            >
              My Library
            </button>
            <button 
              onClick={() => setActiveTab('saved')}
              type="button"
              className={`font-bold text-[13px] px-5 py-2.5 rounded-xl shadow-sm transition-all duration-200 cursor-pointer ${
                activeTab === 'saved' ? 'bg-white text-slate-800' : 'text-slate-500 hover:text-slate-800 hover:bg-white/30'
              }`}
            >
              Saved Playlists
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto justify-start sm:justify-end">
            
            {/* Search Filter Input */}
            <div className="relative flex-1 sm:w-60 bg-white rounded-xl border border-slate-200/70 px-3.5 py-2 flex items-center gap-2.5 shadow-sm">
              <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
              </svg>
              <input 
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                type="text" 
                placeholder="Filter playlists..." 
                className="w-full bg-transparent border-none text-[13px] outline-none text-slate-700 placeholder-slate-400 font-medium" 
              />
            </div>

            {/* Sorting Custom Dropdown */}
            <div className="relative shrink-0 select-none">
              <button
                type="button"
                onClick={() => setSortDropdownOpen(!sortDropdownOpen)}
                className="flex items-center gap-2 bg-white border border-slate-200/80 hover:bg-slate-50 text-slate-700 font-bold text-[13px] pl-3 pr-2.5 py-2.5 rounded-xl shadow-sm transition-all cursor-pointer focus:outline-none"
              >
                <svg className="w-4 h-4 text-slate-500 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12"/>
                </svg>
                <span className="truncate">{SORT_OPTIONS.find(o => o.value === sortOption)?.label}</span>
                <ChevronDown className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform duration-200 ${sortDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              <AnimatePresence>
                {sortDropdownOpen && (
                  <>
                    <div className="fixed inset-0" style={{ zIndex: 49 }} onClick={() => setSortDropdownOpen(false)} />
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95, y: -4 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: -4 }}
                      transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                      className="absolute right-0 top-full mt-1.5 w-48 bg-white/90 backdrop-blur-xl rounded-xl shadow-xl border border-slate-100 py-1.5 z-50"
                    >
                      {SORT_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => {
                            setSortOption(opt.value);
                            setSortDropdownOpen(false);
                          }}
                          className={`w-full text-left px-3 py-2 text-xs font-semibold flex items-center gap-2.5 transition-colors rounded-lg mx-0.5 ${
                            sortOption === opt.value
                              ? 'text-indigo-700 bg-indigo-50'
                              : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800'
                          }`}
                        >
                          <span className="flex-1">{opt.label}</span>
                          {sortOption === opt.value && <Check className="w-3.5 h-3.5 text-indigo-600 shrink-0" />}
                        </button>
                      ))}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>

            <button 
              onClick={onCreatePlaylistClick}
              type="button"
              className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold text-[13px] px-4 py-2.5 rounded-xl flex items-center gap-1.5 shadow-md shadow-blue-500/10 hover:opacity-95 active:scale-98 transition-all shrink-0 cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/>
              </svg>
              <span>Create Playlist</span>
            </button>
          </div>
        </div>
      </section>

      {/* Dynamic Playlist Grid Display Content */}
      <section className="flex-1">
        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
            >
              <PlaylistCardSkeleton />
              <PlaylistCardSkeleton />
              <PlaylistCardSkeleton />
            </motion.div>
          ) : filteredPlaylists.length === 0 ? (
            <EmptyState 
              searchQuery={filterQuery} 
              onClearSearch={filterQuery ? () => setFilterQuery('') : undefined} 
              onNewDocument={activeTab === 'saved' ? () => setActiveTab('my-library') : onCreatePlaylistClick} 
              newDocumentLabel={activeTab === 'saved' ? "Browse Playlists" : undefined}
              title={
                filterQuery 
                  ? undefined 
                  : activeTab === 'saved' 
                    ? "No saved playlists" 
                    : "Your library is empty"
              }
              description={
                filterQuery 
                  ? undefined 
                  : activeTab === 'saved' 
                    ? "Star your favorite playlists on the home page or library tab to save them here for quick access." 
                    : "Create your first study playlist to start loading and indexing codebase repositories, transcripts, and documents."
              }
            />
          ) : (
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
            >
              {filteredPlaylists.map((playlist, index) => {
                const cardProps = getPlaylistCardProps(playlist.name, playlist.description, playlist.icon_type, playlist.item_count, index);
                return (
                  <PlaylistCard
                    key={playlist.id}
                    id={playlist.id}
                    {...cardProps}
                    variant="library"
                    isFavorite={playlist.is_favorite === 1}
                    onNavigate={() => onNavigateToFolder(playlist.id, playlist.name)}
                    onShare={onShare}
                    createdAt={playlist.created_at}
                    updatedAt={playlist.updated_at}
                  />
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </div>
  );
}
