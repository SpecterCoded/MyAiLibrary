import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { logActivity } from '../utils/activityLogger';
import Avvvatars from 'avvvatars-react';
import {
  Loader2,
  Star,
  Pencil,
  Trash2,
  X,
  Folder
} from 'lucide-react';

export type PlaylistIconType = string;

interface PlaylistCardProps {
  id: string;
  category: string;
  title: string;
  date: string;
  timeframe: string;
  description: string;
  iconType: PlaylistIconType;
  onNavigate?: () => void;
  variant?: 'home' | 'library';
  itemCount?: string;
  isFavorite?: boolean;
  onShare?: (id: string, name: string) => void;
  createdAt?: string | null;
  updatedAt?: string | null;
}

// 14 unique avvvatars shapes — each seed produces a different deterministic shape
const SHAPE_OPTIONS = [
  { seed: 'avvv-shape-star', label: 'Star' },
  { seed: 'avvv-shape-flower', label: 'Flower' },
  { seed: 'avvv-shape-cross', label: 'Cross' },
  { seed: 'avvv-shape-diamond', label: 'Diamond' },
  { seed: 'avvv-shape-burst', label: 'Burst' },
  { seed: 'avvv-shape-blob', label: 'Blob' },
  { seed: 'avvv-shape-ring', label: 'Ring' },
  { seed: 'avvv-shape-sparkle', label: 'Sparkle' },
  { seed: 'avvv-shape-petal', label: 'Petal' },
  { seed: 'avvv-shape-geo', label: 'Geo' },
  { seed: 'avvv-shape-wave', label: 'Wave' },
  { seed: 'avvv-shape-pulse', label: 'Pulse' },
  { seed: 'avvv-shape-orbit', label: 'Orbit' },
  { seed: 'avvv-shape-nova', label: 'Nova' },
];

const INITIALS_VALUE = 'avvv-initials';

const getShapeLabel = (iconType: string) => {
  if (iconType === INITIALS_VALUE || !iconType) return 'Notebook';
  const shape = SHAPE_OPTIONS.find(s => s.seed === iconType);
  if (shape) return shape.label;
  const legacyMap: Record<string, string> = {
    'standup': 'Star',
    'concept': 'Burst',
    'roadmap': 'Wave',
    'database': 'Ring',
    'terminal': 'Cross',
    'music': 'Flower',
    'video': 'Orbit',
    'image': 'Petal',
    'settings': 'Geo',
    'globe': 'Diamond',
    'lock': 'Nova',
    'book': 'Pulse',
    'shape': 'Sparkle',
    'initials': 'Notebook',
  };
  return legacyMap[iconType] || 'Notebook';
};

const getShapeBadgeStyle = (iconType: string) => {
  if (iconType === INITIALS_VALUE || !iconType) {
    return 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300';
  }
  const colorMap: Record<string, string> = {
    'avvv-shape-star': 'bg-amber-50 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300',
    'avvv-shape-flower': 'bg-orange-50 text-orange-600 dark:bg-orange-500/20 dark:text-orange-300',
    'avvv-shape-cross': 'bg-blue-50 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300',
    'avvv-shape-diamond': 'bg-yellow-50 text-yellow-600 dark:bg-yellow-500/20 dark:text-yellow-300',
    'avvv-shape-burst': 'bg-purple-50 text-purple-600 dark:bg-purple-500/20 dark:text-purple-300',
    'avvv-shape-blob': 'bg-green-50 text-green-600 dark:bg-green-500/20 dark:text-green-300',
    'avvv-shape-ring': 'bg-rose-50 text-rose-600 dark:bg-rose-500/20 dark:text-rose-300',
    'avvv-shape-sparkle': 'bg-sky-50 text-sky-600 dark:bg-sky-500/20 dark:text-sky-300',
    'avvv-shape-petal': 'bg-lime-50 text-lime-600 dark:bg-lime-500/20 dark:text-lime-300',
    'avvv-shape-geo': 'bg-red-50 text-red-600 dark:bg-red-500/20 dark:text-red-300',
    'avvv-shape-wave': 'bg-cyan-50 text-cyan-600 dark:bg-cyan-500/20 dark:text-cyan-300',
    'avvv-shape-pulse': 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300',
    'avvv-shape-orbit': 'bg-violet-50 text-violet-600 dark:bg-violet-500/20 dark:text-violet-300',
    'avvv-shape-nova': 'bg-pink-50 text-pink-600 dark:bg-pink-500/20 dark:text-pink-300',
  };
  if (colorMap[iconType]) return colorMap[iconType];
  const legacyMap: Record<string, string> = {
    'standup': 'bg-amber-50 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300',
    'concept': 'bg-purple-50 text-purple-600 dark:bg-purple-500/20 dark:text-purple-300',
    'roadmap': 'bg-cyan-50 text-cyan-600 dark:bg-cyan-500/20 dark:text-cyan-300',
    'database': 'bg-rose-50 text-rose-600 dark:bg-rose-500/20 dark:text-rose-300',
    'terminal': 'bg-blue-50 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300',
    'music': 'bg-orange-50 text-orange-600 dark:bg-orange-500/20 dark:text-orange-300',
    'video': 'bg-violet-50 text-violet-600 dark:bg-violet-500/20 dark:text-violet-300',
    'image': 'bg-lime-50 text-lime-600 dark:bg-lime-500/20 dark:text-lime-300',
    'settings': 'bg-red-50 text-red-600 dark:bg-red-500/20 dark:text-red-300',
    'globe': 'bg-yellow-50 text-yellow-600 dark:bg-yellow-500/20 dark:text-yellow-300',
    'lock': 'bg-pink-50 text-pink-600 dark:bg-pink-500/20 dark:text-pink-300',
    'book': 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300',
    'shape': 'bg-sky-50 text-sky-600 dark:bg-sky-500/20 dark:text-sky-300',
  };
  return legacyMap[iconType] || 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300';
};

const getShapeGradient = (iconType: string) => {
  const gradientMap: Record<string, string> = {
    'avvv-shape-star': 'from-amber-400 to-yellow-500',
    'avvv-shape-flower': 'from-orange-400 to-amber-500',
    'avvv-shape-cross': 'from-blue-500 to-indigo-600',
    'avvv-shape-diamond': 'from-yellow-400 to-orange-500',
    'avvv-shape-burst': 'from-purple-500 to-pink-600',
    'avvv-shape-blob': 'from-emerald-500 to-green-600',
    'avvv-shape-ring': 'from-rose-400 to-pink-500',
    'avvv-shape-sparkle': 'from-sky-400 to-blue-500',
    'avvv-shape-petal': 'from-lime-400 to-green-500',
    'avvv-shape-geo': 'from-red-400 to-rose-500',
    'avvv-shape-wave': 'from-cyan-400 to-blue-500',
    'avvv-shape-pulse': 'from-emerald-400 to-teal-500',
    'avvv-shape-orbit': 'from-violet-400 to-indigo-500',
    'avvv-shape-nova': 'from-pink-400 to-rose-500',
  };
  if (gradientMap[iconType]) return gradientMap[iconType];
  const legacyMap: Record<string, string> = {
    'standup': 'from-amber-400 to-yellow-500',
    'concept': 'from-purple-500 to-pink-600',
    'roadmap': 'from-cyan-400 to-blue-500',
    'database': 'from-rose-400 to-pink-500',
    'terminal': 'from-blue-500 to-indigo-600',
    'music': 'from-orange-400 to-amber-500',
    'video': 'from-violet-400 to-indigo-500',
    'image': 'from-lime-400 to-green-500',
    'settings': 'from-red-400 to-rose-500',
    'globe': 'from-yellow-400 to-orange-500',
    'lock': 'from-pink-400 to-rose-500',
    'book': 'from-emerald-400 to-teal-500',
    'shape': 'from-sky-400 to-blue-500',
  };
  return legacyMap[iconType] || 'from-indigo-500 to-purple-600';
};

export default function PlaylistCard({
  id,
  category,
  title,
  date,
  timeframe,
  description,
  iconType,
  onNavigate,
  variant = 'home',
  itemCount,
  isFavorite,
  onShare,
  createdAt,
  updatedAt
}: PlaylistCardProps) {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [currentIcon, setCurrentIcon] = useState<PlaylistIconType>(iconType);
  const [loadingIcon, setLoadingIcon] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isFav, setIsFav] = useState(isFavorite || false);
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [renameName, setRenameName] = useState(title);
  const [renameDesc, setRenameDesc] = useState(description);
  const [isRenaming, setIsRenaming] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    setIsFav(isFavorite || false);
  }, [isFavorite]);

  const handleToggleFavorite = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const newFav = !isFav;
    setIsFav(newFav);

    try {
      const token = localStorage.getItem('access_token');
      const response = await fetch(`/playlists/${id}/favorite`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        logActivity('playlist', `${newFav ? 'Favorited' : 'Unfavorited'} playlist`);
        window.dispatchEvent(new CustomEvent('refresh-playlists'));
      } else {
        setIsFav(!newFav);
        console.error('Failed to toggle playlist favorite');
      }
    } catch (err) {
      setIsFav(!newFav);
      console.error('Error toggling playlist favorite:', err);
    }
  };

  useEffect(() => {
    setCurrentIcon(iconType);
  }, [iconType]);

  const isInitials = currentIcon === INITIALS_VALUE || !currentIcon;
  const shapeLabel = getShapeLabel(currentIcon);
  const isLibrary = variant === 'library';

  const formatCreatedDate = (iso: string | null | undefined) => {
    if (!iso) return { date: date, time: timeframe };
    const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'));
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dayName = days[d.getDay()];
    const monthName = months[d.getMonth()];
    const day = d.getDate();
    const suffix = (n: number) => { if (n > 3 && n < 21) return 'th'; switch (n % 10) { case 1: return 'st'; case 2: return 'nd'; case 3: return 'rd'; default: return 'th'; } };
    const dateStr = `${dayName} – ${monthName} ${day}${suffix(day)}`;
    const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    return { date: dateStr, time: timeStr };
  };
  const displayDate = formatCreatedDate(createdAt);
  const displayUpdated = formatCreatedDate(updatedAt);

  const handleIconSelect = async (selectedType: string) => {
    setLoadingIcon(true);
    setIsPickerOpen(false);
    try {
      const token = localStorage.getItem('access_token');
      const response = await fetch(`/playlists/${id}/icon?icon_type=${selectedType}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        setCurrentIcon(selectedType as PlaylistIconType);
        window.dispatchEvent(new CustomEvent('refresh-playlists'));
      } else {
        console.error('Failed to update playlist icon');
      }
    } catch (err) {
      console.error('Error updating playlist icon:', err);
    } finally {
      setLoadingIcon(false);
    }
  };

  const handleRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsMenuOpen(false);
    setRenameName(title);
    setRenameDesc(description);
    setIsRenameOpen(true);
  };

  const handleRenameSubmit = async () => {
    if (!renameName.trim()) return;
    setIsRenaming(true);
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`/playlists/${id}?name=${encodeURIComponent(renameName.trim())}&description=${encodeURIComponent(renameDesc.trim())}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        window.dispatchEvent(new CustomEvent('refresh-playlists'));
        setIsRenameOpen(false);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsRenaming(false);
    }
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsMenuOpen(false);
    setIsDeleteOpen(true);
  };

  const handleDeleteConfirm = async () => {
    setIsDeleting(true);
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`/playlists/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        logActivity('playlist', `Deleted playlist "${name}"`);
        window.dispatchEvent(new CustomEvent('refresh-playlists'));
        setIsDeleteOpen(false);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <div className={`bg-white/80 dark:bg-slate-900/40 rounded-[28px] p-5 flex flex-col justify-between relative group hover:-translate-y-0.5 transition-all duration-300 shadow-[0_12px_30px_-4px_rgba(153,171,198,0.15),0_4px_12px_-2px_rgba(153,171,198,0.08)] dark:shadow-[0_12px_30px_-4px_rgba(0,0,0,0.5)] border border-white/70 dark:border-white/10 backdrop-blur-[24px] ${isLibrary ? '' : 'min-h-[450px]'}`}>
        <div>
          {/* Meta Context Header */}
          <div className="flex items-center justify-between text-slate-450 dark:text-slate-400 text-[11px] font-bold mb-4 uppercase tracking-wider select-none">
            <span className={`${getShapeBadgeStyle(currentIcon)} px-3 py-1 rounded-full text-[10px] font-bold tracking-widest flex items-center gap-1.5`}>
              <Star className="w-3 h-3" />
              {shapeLabel}
            </span>
            {isLibrary ? (
              <div className="flex items-center gap-2 relative">
                <button
                  onClick={handleToggleFavorite}
                  className="p-1 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors flex items-center justify-center shrink-0"
                  title={isFav ? "Remove from favorites" : "Add to favorites"}
                >
                  <Star className={`w-4 h-4 transition-colors ${isFav ? 'text-amber-500 fill-amber-500' : 'text-slate-400 dark:text-slate-500 hover:text-amber-500'}`} />
                </button>
                <span className="text-slate-400 dark:text-slate-500 font-medium">{itemCount || '0 items'}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); setIsMenuOpen(!isMenuOpen); }}
                  className="p-1 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors"
                >
                  <svg className="w-4 h-4 text-slate-400" fill="currentColor" viewBox="0 0 24 24">
                    <circle cx="12" cy="5" r="2" />
                    <circle cx="12" cy="12" r="2" />
                    <circle cx="12" cy="19" r="2" />
                  </svg>
                </button>
                <AnimatePresence>
                  {isMenuOpen && (
                    <>
                      <div className="fixed inset-0" style={{ zIndex: 49 }} onClick={() => setIsMenuOpen(false)} />
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: -4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -4 }}
                        transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                        className="absolute right-0 top-full mt-1 w-44 bg-white rounded-xl shadow-xl border border-slate-100 py-1.5 z-50"
                      >
                        <button onClick={handleRename} className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 font-semibold flex items-center gap-2.5 transition-colors rounded-lg mx-0.5">
                          <Pencil className="w-3.5 h-3.5" />
                          Rename
                        </button>
                        {onShare && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setIsMenuOpen(false);
                              onShare(id, title);
                            }}
                            className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 font-semibold flex items-center gap-2.5 transition-colors rounded-lg mx-0.5"
                          >
                            <Folder className="w-3.5 h-3.5" />
                            Share to Team
                          </button>
                        )}
                        <div className="mx-2 my-1 h-px bg-slate-100" />
                        <button onClick={handleDeleteClick} className="w-full text-left px-3 py-2 text-xs text-rose-600 hover:bg-rose-50 font-semibold flex items-center gap-2.5 transition-colors rounded-lg mx-0.5">
                          <Trash2 className="w-3.5 h-3.5" />
                          Delete
                        </button>
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 relative">
                <button
                  onClick={handleToggleFavorite}
                  className="p-1 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors flex items-center justify-center shrink-0"
                  title={isFav ? "Remove from favorites" : "Add to favorites"}
                >
                  <Star className={`w-4 h-4 transition-colors ${isFav ? 'text-amber-500 fill-amber-500' : 'text-slate-400 dark:text-slate-500 hover:text-amber-500'}`} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setIsMenuOpen(!isMenuOpen); }}
                  className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 shrink-0 p-1 rounded-lg transition-colors hover:bg-slate-100 dark:hover:bg-white/5"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zM14 10a2 2 0 11-4 0 2 2 0 014 0zM22 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </button>
                <AnimatePresence>
                  {isMenuOpen && (
                    <>
                      <div className="fixed inset-0" style={{ zIndex: 49 }} onClick={() => setIsMenuOpen(false)} />
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: -4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -4 }}
                        transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                        className="absolute right-0 top-full mt-1 w-44 bg-white rounded-xl shadow-xl border border-slate-100 py-1.5 z-50"
                      >
                        <button onClick={handleRename} className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 font-semibold flex items-center gap-2.5 transition-colors rounded-lg mx-0.5">
                          <Pencil className="w-3.5 h-3.5" />
                          Rename
                        </button>
                        {onShare && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setIsMenuOpen(false);
                              onShare(id, title);
                            }}
                            className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 font-semibold flex items-center gap-2.5 transition-colors rounded-lg mx-0.5"
                          >
                            <Folder className="w-3.5 h-3.5" />
                            Share to Team
                          </button>
                        )}
                        <div className="mx-2 my-1 h-px bg-slate-100" />
                        <button onClick={handleDeleteClick} className="w-full text-left px-3 py-2 text-xs text-rose-600 hover:bg-rose-50 font-semibold flex items-center gap-2.5 transition-colors rounded-lg mx-0.5">
                          <Trash2 className="w-3.5 h-3.5" />
                          Delete
                        </button>
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>

          {/* Inner Depth Placeholder */}
          <div
            onClick={(e) => {
              e.stopPropagation(); // Stop parent folder click navigation
              setIsPickerOpen(true);
            }}
            className={`w-full h-36 rounded-[22px] bg-gradient-to-br ${getShapeGradient(currentIcon)} border border-white flex items-center justify-center mb-4 shadow-inner relative overflow-hidden cursor-pointer hover:scale-[1.01] transition-transform`}
            title="Click to edit playlist icon"
          >
            <div className="absolute inset-0 bg-white/10 opacity-40 mix-blend-overlay pattern-grid"></div>
            {loadingIcon ? (
              <Loader2 className="w-8 h-8 text-white animate-spin" />
            ) : isInitials ? (
              <div className="w-20 h-20 rounded-2xl bg-white/15 backdrop-blur-md flex items-center justify-center border border-white/20 shadow-md">
                <span className="text-3xl font-bold text-white select-none">
                  {title ? title.charAt(0).toUpperCase() : '?'}
                </span>
              </div>
            ) : (
              <div className="w-20 h-20 rounded-full overflow-hidden flex items-center justify-center">
                <Avvvatars
                  value={currentIcon}
                  style="shape"
                  size={80}
                />
              </div>
            )}

            <div className="absolute top-3 right-3 bg-slate-900/60 text-white text-[9px] font-bold px-2 py-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm">
              Change Icon
            </div>
          </div>

          {/* Card Headline Content */}
          {isLibrary ? (
            <h3 className="text-[16px] font-bold text-slate-800 dark:text-slate-200 tracking-tight leading-snug mb-1 truncate">
              {title}
            </h3>
          ) : (
            <h3 className="text-[17px] font-bold text-slate-800 dark:text-slate-200 tracking-tight leading-snug mb-2">
              {title}
            </h3>
          )}

          {/* Metrics/Time Badge Info */}
          {!isLibrary && (
            <div className="flex flex-wrap items-center gap-y-1 gap-x-3 text-[11px] font-bold text-slate-400/90 dark:text-slate-400 mb-4 select-none">
              <span className="flex items-center gap-1.5 text-blue-600/80 dark:text-blue-400/90">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                {displayDate.date}
              </span>
              <span className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {displayDate.time}
              </span>
            </div>
          )}

          {/* Truncated Body Summary */}
          {isLibrary ? (
            <p className="text-[12px] font-medium leading-relaxed text-slate-400/90 dark:text-slate-400 line-clamp-2 mb-3">
              {description}
            </p>
          ) : (
            <p className="text-[12px] font-medium leading-relaxed text-slate-400/90 dark:text-slate-400 line-clamp-3">
              {description}
            </p>
          )}
        </div>

        {/* Action Footer Bar */}
        {isLibrary ? (
          <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100/60 dark:border-white/5 select-none text-[11px]">
            <span className="text-slate-400 dark:text-slate-500 font-semibold flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Updated {displayUpdated.date}
            </span>
            <button onClick={onNavigate} className="bg-slate-50 dark:bg-white/5 border border-slate-200/60 dark:border-white/10 hover:bg-slate-100/80 dark:hover:bg-white/10 text-slate-700 dark:text-slate-200 text-[11px] font-bold py-1.5 px-3.5 rounded-lg flex items-center gap-1 shadow-sm transition-all cursor-pointer">
              <span>Open</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between mt-6 pt-3 border-t border-slate-100/60 dark:border-white/5 select-none">
            <button onClick={onNavigate} className="bg-slate-50 dark:bg-white/5 border border-slate-200/60 dark:border-white/10 hover:bg-slate-100/80 dark:hover:bg-white/10 text-slate-700 dark:text-slate-200 text-[12px] font-bold py-2 px-4 rounded-full flex items-center gap-1.5 shadow-sm transition-all cursor-pointer">
              <svg className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 fill-blue-600 dark:fill-blue-400" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              <span>Replay</span>
            </button>
            <button onClick={onNavigate} className="w-9 h-9 rounded-full bg-slate-50 dark:bg-white/5 hover:bg-slate-100/80 dark:hover:bg-white/10 border border-slate-200/60 dark:border-white/10 flex items-center justify-center text-slate-500 dark:text-slate-400 shadow-sm transition-all cursor-pointer">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Premium Icon Picker Popup */}
      {isPickerOpen && createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-slate-900/15 dark:bg-slate-950/40 backdrop-blur-sm animate-fade-in"
            onClick={(e) => {
              e.stopPropagation();
              setIsPickerOpen(false);
            }}
          ></div>

          {/* Modal Container */}
          <div
            className="relative w-full max-w-lg bg-white/95 dark:bg-[#1e1f22]/95 backdrop-blur-xl border border-white/60 dark:border-white/10 shadow-[0_32px_64px_-12px_rgba(15,23,42,0.18)] dark:shadow-[0_32px_64px_-12px_rgba(0,0,0,0.5)] rounded-[32px] p-8 animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100">Select Playlist Icon</h3>
                <p className="text-slate-400 dark:text-slate-455 text-xs mt-0.5">Choose a cool vector icon for this playlist.</p>
              </div>
              <button
                onClick={() => setIsPickerOpen(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-all p-1.5 hover:bg-slate-100 dark:hover:bg-white/5 rounded-xl cursor-pointer"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="grid grid-cols-5 gap-3 max-h-[380px] overflow-y-auto px-1 py-4 justify-items-center">
              {/* Initials option (default) */}
              <button
                onClick={() => handleIconSelect(INITIALS_VALUE)}
                className={`flex flex-col items-center justify-center w-[80px] h-[90px] p-2 rounded-[16px] transition-all cursor-pointer group ${isInitials
                  ? 'bg-indigo-50/60 dark:bg-indigo-950/45 shadow-md ring-4 ring-indigo-500/15 dark:ring-indigo-500/25 border border-transparent dark:border-indigo-500/30'
                  : 'bg-slate-50/50 dark:bg-slate-800/40 hover:bg-white dark:hover:bg-slate-800 hover:scale-[1.04] shadow-sm hover:shadow-md border border-transparent dark:border-white/5'
                  }`}
              >
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-md mb-1.5">
                  <span className="text-lg font-bold text-white select-none">
                    {title ? title.charAt(0).toUpperCase() : '?'}
                  </span>
                </div>
                <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300 select-none group-hover:text-slate-800 dark:group-hover:text-slate-100 transition-colors">Initials</span>
              </button>

              {/* 14 shape options */}
              {SHAPE_OPTIONS.map((opt) => {
                const isSelected = currentIcon === opt.seed;
                return (
                  <button
                    key={opt.seed}
                    onClick={() => handleIconSelect(opt.seed)}
                    className={`flex flex-col items-center justify-center w-[80px] h-[90px] p-2 rounded-[16px] transition-all cursor-pointer group ${isSelected
                      ? 'bg-indigo-50/60 dark:bg-indigo-950/45 shadow-md ring-4 ring-indigo-500/15 dark:ring-indigo-500/25 border border-transparent dark:border-indigo-500/30'
                      : 'bg-slate-50/50 dark:bg-slate-800/40 hover:bg-white dark:hover:bg-slate-800 hover:scale-[1.04] shadow-sm hover:shadow-md border border-transparent dark:border-white/5'
                      }`}
                  >
                    <div className="w-12 h-12 rounded-full overflow-hidden flex items-center justify-center mb-1.5">
                      <Avvvatars
                        value={opt.seed}
                        style="shape"
                        size={48}
                      />
                    </div>
                    <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300 select-none group-hover:text-slate-800 dark:group-hover:text-slate-100 transition-colors">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Rename Modal */}
      {createPortal(
        <AnimatePresence>
          {isRenameOpen && (
            <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="absolute inset-0 bg-slate-900/20 dark:bg-slate-950/50 backdrop-blur-sm"
                onClick={() => setIsRenameOpen(false)}
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 8 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className="relative w-full max-w-md bg-white/95 dark:bg-[#1e1f22]/95 backdrop-blur-xl border border-white/60 dark:border-white/10 shadow-[0_32px_64px_-12px_rgba(15,23,42,0.18)] dark:shadow-[0_32px_64px_-12px_rgba(0,0,0,0.5)] rounded-[24px] p-6"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center">
                      <Pencil className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">Rename Playlist</h3>
                      <p className="text-xs text-slate-400 dark:text-slate-500">Update name and description</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setIsRenameOpen(false)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">Name</label>
                    <input
                      type="text"
                      value={renameName}
                      onChange={(e) => setRenameName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleRenameSubmit()}
                      className="w-full px-3.5 py-2.5 text-sm bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all text-slate-700 dark:text-slate-200 placeholder-slate-400"
                      placeholder="Playlist name"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">Description</label>
                    <textarea
                      value={renameDesc}
                      onChange={(e) => setRenameDesc(e.target.value)}
                      rows={3}
                      className="w-full px-3.5 py-2.5 text-sm bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all text-slate-700 dark:text-slate-200 placeholder-slate-400 resize-none"
                      placeholder="Optional description"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2.5 mt-6">
                  <button
                    onClick={() => setIsRenameOpen(false)}
                    className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 rounded-xl transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleRenameSubmit}
                    disabled={isRenaming || !renameName.trim()}
                    className="px-5 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {isRenaming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Pencil className="w-3.5 h-3.5" />}
                    Save
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Delete Confirmation Modal */}
      {createPortal(
        <AnimatePresence>
          {isDeleteOpen && (
            <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="absolute inset-0 bg-slate-900/20 dark:bg-slate-950/50 backdrop-blur-sm"
                onClick={() => setIsDeleteOpen(false)}
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 8 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className="relative w-full max-w-sm bg-white/95 dark:bg-[#1e1f22]/95 backdrop-blur-xl border border-white/60 dark:border-white/10 shadow-[0_32px_64px_-12px_rgba(15,23,42,0.18)] dark:shadow-[0_32px_64px_-12px_rgba(0,0,0,0.5)] rounded-[24px] p-6 text-center"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="w-12 h-12 rounded-full bg-rose-50 dark:bg-rose-500/10 flex items-center justify-center mx-auto mb-4">
                  <Trash2 className="w-6 h-6 text-rose-500" />
                </div>
                <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 mb-1">Delete Playlist?</h3>
                <p className="text-xs text-slate-400 dark:text-slate-500 mb-6 leading-relaxed">
                  This will permanently delete <span className="font-semibold text-slate-600 dark:text-slate-300">"{title}"</span> and all files inside. This action cannot be undone.
                </p>
                <div className="flex items-center gap-2.5">
                  <button
                    onClick={() => setIsDeleteOpen(false)}
                    className="flex-1 px-4 py-2.5 text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 rounded-xl transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteConfirm}
                    disabled={isDeleting}
                    className="flex-1 px-4 py-2.5 text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white rounded-xl shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    Delete
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}
