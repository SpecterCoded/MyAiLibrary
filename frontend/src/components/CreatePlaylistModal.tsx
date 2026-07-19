import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ToastContainer, type ToastMessage } from './FileExplorer/Toast';
import { logActivity } from '../utils/activityLogger';

interface CreatePlaylistModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface Subfolder {
  id: string;
  name: string;
  isDefault?: boolean;
}

const CreatePlaylistModal: React.FC<CreatePlaylistModalProps> = ({ isOpen, onClose }) => {
  const [playlistName, setPlaylistName] = useState('');
  const [playlistDescription, setPlaylistDescription] = useState('');
  const [subfolders, setSubfolders] = useState<Subfolder[]>([
    { id: '1', name: 'Resources', isDefault: true },
    { id: '2', name: 'Notes', isDefault: true },
    { id: '3', name: 'Media', isDefault: true }
  ]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [isExpanded, setIsExpanded] = useState(true);
  
  // Animation state to handle opening/closing separately from mounting
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [animate, setAnimate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastIdRef = useRef(0);

  const addToast = useCallback((text: string, type: ToastMessage['type'] = 'info') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, text, type }]);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setPlaylistName('');
      setPlaylistDescription('');
      setError(null);
      setSubfolders([
        { id: '1', name: 'Resources', isDefault: true },
        { id: '2', name: 'Notes', isDefault: true },
        { id: '3', name: 'Media', isDefault: true }
      ]);
      requestAnimationFrame(() => setAnimate(true));
    } else {
      setAnimate(false);
      const timer = setTimeout(() => setShouldRender(false), 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const handleCreatePlaylist = async () => {
    if (!playlistName.trim()) {
      setError('Playlist name is required.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('access_token');
      
      // 1. Create playlist
      const response = await fetch(`/playlists?name=${encodeURIComponent(playlistName.trim())}&description=${encodeURIComponent(playlistDescription.trim())}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const msg = errData.detail || 'Failed to create playlist.';
        if (response.status === 409) {
          addToast(msg, 'error');
          setError(null);
          setLoading(false);
          return;
        }
        throw new Error(msg);
      }

      const newPlaylist = await response.json();
      logActivity('playlist', `Created playlist "${playlistName.trim()}"`);

      // 2. Create subfolders
      for (const sub of subfolders) {
        if (sub.name.trim()) {
          const folderRes = await fetch(`/folders?name=${encodeURIComponent(sub.name.trim())}&playlist_id=${encodeURIComponent(newPlaylist.id)}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });
          if (!folderRes.ok) {
            console.error('Failed to create folder:', sub.name);
          }
        }
      }

      // 3. Trigger global event to reload lists
      window.dispatchEvent(new CustomEvent('refresh-playlists'));

      // 4. Close modal
      onClose();
    } catch (err: any) {
      setError(err.message || 'An error occurred.');
    } finally {
      setLoading(false);
    }
  };

  if (!shouldRender) return null;

  const handleAddSubfolder = () => {
    const newId = Math.random().toString(36).substr(2, 9);
    const newSubfolder = { id: newId, name: 'New Subfolder' };
    setSubfolders([...subfolders, newSubfolder]);
    setEditingId(newId);
    setEditValue('New Subfolder');
    setIsExpanded(true);
  };

  const handleDeleteSubfolder = (id: string) => {
    setSubfolders(subfolders.filter(s => s.id !== id));
  };

  const startEditing = (s: Subfolder) => {
    setEditingId(s.id);
    setEditValue(s.name);
  };

  const saveEdit = () => {
    if (editingId) {
      setSubfolders(subfolders.map(s => 
        s.id === editingId ? { ...s, name: editValue || 'Unnamed' } : s
      ));
      setEditingId(null);
    }
  };

  const fileTypes = [
    { name: 'Videos', icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg> },
    { name: 'PDFs', icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg> },
    { name: 'Audios', icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/></svg> },
    { name: 'Images', icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg> }
  ];

  return (
    <>
    <div className="create-playlist-modal-shell fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: animate ? 1 : 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        onClick={onClose}
      />

      {/* Modal Container */}
      <motion.div
        className="create-playlist-modal relative w-full max-w-2xl border border-slate-200/80 dark:border-white/10 shadow-[0_24px_50px_-12px_rgba(142,160,185,0.4)] dark:shadow-[0_24px_60px_-12px_rgba(0,0,0,0.6)] rounded-[32px] p-8"
        initial={{ opacity: 0, scale: 0.94, y: 26, filter: 'blur(8px)' }}
        animate={animate ? { opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' } : { opacity: 0, scale: 0.96, y: 18, filter: 'blur(6px)' }}
        exit={{ opacity: 0, scale: 0.96, y: 18, filter: 'blur(6px)' }}
        transition={{
          opacity: { duration: 0.24, ease: [0.16, 1, 0.3, 1] },
          scale: { type: 'spring', stiffness: 420, damping: 31, mass: 0.8 },
          y: { type: 'spring', stiffness: 420, damping: 33, mass: 0.8 },
          filter: { duration: 0.24, ease: [0.16, 1, 0.3, 1] },
        }}
      >
        
        {/* Header */}
        <div className="create-playlist-modal__header flex justify-between items-start mb-6 shrink-0">
          <div>
            <h2 className="text-2xl font-bold text-slate-800">Create New Playlist</h2>
            <p className="text-slate-500 text-sm mt-1">Organize your content into a playlist to keep everything in one place.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="create-playlist-modal__body min-h-0">
        {/* Form Fields */}
        <div className="create-playlist-form space-y-5">
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1.5">Playlist Name <span className="text-rose-500">*</span></label>
            <input 
              type="text" 
              value={playlistName}
              onChange={(e) => setPlaylistName(e.target.value)}
              placeholder="Enter playlist name..." 
              className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all font-medium text-slate-700" 
            />
            <div className="text-[11px] text-slate-400 text-right mt-1">{playlistName.length}/100</div>
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1.5">Description (Optional)</label>
            <textarea 
              value={playlistDescription}
              onChange={(e) => setPlaylistDescription(e.target.value)}
              placeholder="Add a short description..." 
              rows={3} 
              maxLength={300}
              className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all font-medium text-slate-700"
            />
            <div className="text-[11px] text-slate-400 text-right mt-1">{playlistDescription.length}/300</div>
          </div>

          {/* Folder Structure */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm font-bold text-slate-700">Folder Structure</label>
              <button 
                onClick={handleAddSubfolder}
                className="text-[12px] font-bold text-indigo-600 flex items-center gap-1 hover:bg-indigo-50 px-2 py-1 rounded-lg transition-colors"
              >
                <span className="text-lg leading-none">+</span> Add Subfolder
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mb-3">Resources and Notes folders will be created by default.</p>
            
            <div className="create-playlist-folders bg-white/40 border border-slate-200/60 rounded-xl p-3 max-h-[160px] overflow-y-auto">
              <div className="flex items-center justify-between">
                <div 
                  className="flex items-center gap-2 text-slate-700 font-bold truncate cursor-pointer hover:text-indigo-600 transition-colors"
                  onClick={() => setIsExpanded(!isExpanded)}
                >
                  <svg 
                    className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${isExpanded ? 'rotate-0' : '-rotate-90'}`} 
                    fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
                  </svg>
                  <svg className="w-5 h-5 text-indigo-400 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/></svg>
                  <span className="truncate">{playlistName || 'Untitled Playlist'}</span>
                </div>
              </div>

              <AnimatePresence initial={false}>
                {isExpanded && (
                <motion.div
                  key="folder-structure-list"
                  initial={{ height: 0, opacity: 0, y: -8, filter: 'blur(4px)' }}
                  animate={{ height: 'auto', opacity: 1, y: 0, filter: 'blur(0px)' }}
                  exit={{ height: 0, opacity: 0, y: -8, filter: 'blur(4px)' }}
                  transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden"
                >
                <div className="ml-10 mt-1 space-y-1 border-l border-slate-300/60 pl-4 py-1">
                  {subfolders.map((folder) => (
                    <div key={folder.id} className="group flex items-center justify-between py-1.5">
                      <div className="flex items-center gap-2 text-slate-600 font-medium truncate flex-1">
                        <svg className="w-5 h-5 text-indigo-300 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/></svg>
                        {editingId === folder.id ? (
                          <input 
                            autoFocus
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={saveEdit}
                            onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                            className="bg-white border border-indigo-200 rounded px-1.5 py-0.5 outline-none w-full text-[13px]"
                          />
                        ) : (
                          <span className="truncate text-[13px]">{folder.name}</span>
                        )}
                        {folder.isDefault && <span className="bg-emerald-100 text-emerald-700 text-[9px] font-bold px-1.5 py-0.5 rounded ml-1 shrink-0 uppercase">Default</span>}
                      </div>
                      
                      {!folder.isDefault && (
                        <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => startEditing(folder)} className="text-slate-400 hover:text-indigo-600">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
                          </button>
                          <button onClick={() => handleDeleteSubfolder(folder.id)} className="text-slate-400 hover:text-rose-500">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Allowed File Types */}
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">Allowed File Types</label>
            <p className="text-[11px] text-slate-400 mb-3">Select the file formats you want to allow in this playlist.</p>
            <div className="create-playlist-file-types grid grid-cols-4 gap-3">
              {fileTypes.map((type) => (
                <div key={type.name} className="create-playlist-file-type bg-white/50 border border-slate-200/60 rounded-xl p-4 text-center hover:border-indigo-300 hover:bg-white/80 hover:shadow-sm transition-[border-color,background-color,box-shadow] duration-200 cursor-pointer group">
                  <div className="text-indigo-500 group-hover:text-indigo-600 mb-2 flex justify-center transition-colors">{type.icon}</div>
                  <div className="text-[11px] font-bold text-slate-600 group-hover:text-slate-800 transition-colors">{type.name}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-50 text-red-650 text-xs font-semibold rounded-xl border border-red-100">
            {error}
          </div>
        )}
        </div>

        {/* Footer Actions */}
        <div className="create-playlist-modal__footer flex gap-3 mt-8 shrink-0">
          <button 
            type="button"
            disabled={loading}
            onClick={onClose} 
            className="flex-1 py-3 rounded-xl font-bold text-slate-700 hover:bg-slate-100 hover:scale-102 transition-all active:scale-95 disabled:opacity-50"
          >
            Cancel
          </button>
          <button 
            type="button"
            disabled={loading}
            onClick={handleCreatePlaylist}
            className="flex-1 py-3 rounded-xl font-bold text-white bg-gradient-to-r from-blue-600 to-indigo-600 shadow-lg shadow-indigo-500/30 hover:opacity-95 hover:scale-102 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Creating...</span>
              </>
            ) : (
              <span>Create Playlist</span>
            )}
          </button>
        </div>
      </motion.div>
    </div>
    <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </>
  );
};

export default CreatePlaylistModal;
