import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { Note, Folder } from './types';
import { logActivity } from '../../utils/activityLogger';
import { ToastContainer, type ToastMessage, type ToastType } from '../FileExplorer/Toast';

type ViewType = 'note' | 'drafts' | 'deleted' | 'recent' | 'folder' | 'graph';

interface AppContextType {
  notes: Note[];
  folders: Folder[];
  currentView: ViewType;
  selectedNoteId: string | null;
  selectedFolderId: string | null;
  openFolderIds: Set<string>;
  searchOpen: boolean;
  settingsOpen: boolean;
  helpOpen: boolean;
  sidebarOpen: boolean;
  isSaving: boolean;
  addTag: (id: string, label: string) => void;
  removeTag: (id: string, label: string) => void;
  linkNotes: (sourceId: string, targetId: string) => void;
  unlinkNotes: (sourceId: string, targetId: string) => void;
  createGraphNode: () => string;
  moveNoteToFolder: (noteId: string, folderId: string | null) => void;
  setSidebarOpen: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setHelpOpen: (open: boolean) => void;
  setCurrentView: (view: ViewType) => void;
  setSelectedNoteId: (id: string | null) => void;
  setSelectedFolderId: (id: string | null) => void;
  toggleFolder: (id: string) => void;
  addNote: () => void;
  addFolder: () => void;
  updateNoteContent: (id: string, content: any) => void;
  updateNoteTitle: (id: string, title: string) => void;
  updateFolderName: (id: string, name: string) => void;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  moveFolderToFolder: (folderId: string, targetId: string | null) => void;
  deleteNote: (id: string) => void;
  deleteFolder: (id: string) => void;
  restoreFolder: (id: string) => void;
  permanentlyDeleteFolder: (id: string) => void;
  toggleFavorite: (id: string) => void;
  restoreNote: (id: string) => void;
  permanentlyDeleteNote: (id: string) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

// Helper for authenticated backend API requests
const apiFetch = async (url: string, options: RequestInit = {}) => {
  const token = localStorage.getItem('access_token');
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
    'Authorization': `Bearer ${token}`,
  };
  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response;
};

export function AppProvider({ children }: { children: ReactNode }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [currentView, setCurrentView] = useState<ViewType>('note');
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [openFolderIds, setOpenFolderIds] = useState<Set<string>>(new Set());
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastIdRef = useRef(0);

  const showToast = useCallback((text: string, type: ToastType = 'info') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, text, type }]);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);
  const [editingId, setEditingId] = useState<string | null>(null);

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingChangesRef = useRef<{ [key: string]: { title?: string; content?: any } }>({});

  // Fetch initial playlists and notes on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        // 1. Fetch user playlists and custom folders
        const [playlistsResponse, customFoldersResponse] = await Promise.all([
          apiFetch('/playlists'),
          apiFetch('/folders?all_folders=true')
        ]);
        const playlistsData = await playlistsResponse.json();
        const customFoldersData = await customFoldersResponse.json();

        // 2. Build folder tree (Playlist directly, without default subfolder - standard folder icon only)
        const builtFolders: Folder[] = [];
        const initialOpenIds = new Set<string>();

        for (const playlist of playlistsData) {
          builtFolders.push({
            id: playlist.id,
            name: playlist.name,
            icon: 'folder', // Standard folder icon
            parentId: null,
            isPlaylist: true,
          });
          initialOpenIds.add(playlist.id);
        }

        for (const cf of customFoldersData) {
          if (cf.name === 'root' || cf.name === 'Notes' || cf.name === 'Media' || cf.name === 'Resources') {
            continue;
          }
          const dbParent = customFoldersData.find((f: any) => f.id === cf.parent_id);
          const parentIsSystem = dbParent && ['notes', 'media', 'resources', 'root'].includes(dbParent.name.toLowerCase());
          const parentId = parentIsSystem ? cf.playlist_id : (cf.parent_id ? cf.parent_id : (cf.playlist_id ? cf.playlist_id : null));

          builtFolders.push({
            id: cf.id,
            name: cf.name,
            icon: 'folder',
            parentId: parentId,
            playlistId: cf.playlist_id || null,
            isPlaylist: false,
            isDeleted: cf.is_deleted === 1,
          });
        }

        setFolders(builtFolders);
        setOpenFolderIds(initialOpenIds);

        // 3. Sync all local physical markdown files on startup (global & playlist notes)
        try {
          await apiFetch('/notes/refresh', { method: 'POST' });
        } catch (err) {
          console.error('Failed to sync/refresh physical markdown files:', err);
        }

        // 4. Fetch notes from database
        const notesResponse = await apiFetch('/notes');
        const notesData = await notesResponse.json();

        const mappedNotes: Note[] = notesData.map((note: any) => {
          let parsedContent = [];
          if (note.content) {
            try {
              parsedContent = JSON.parse(note.content);
              if (!Array.isArray(parsedContent)) {
                // If it is not a list, wrap it in a paragraph block
                parsedContent = [{ type: 'paragraph', content: note.content }];
              }
            } catch {
              parsedContent = [{ type: 'paragraph', content: note.content }];
            }
          }

          let parsedTags = [];
          if (note.tags) {
            try {
              parsedTags = typeof note.tags === 'string' ? JSON.parse(note.tags) : note.tags;
            } catch {
              parsedTags = [];
            }
          }
          if (!Array.isArray(parsedTags)) parsedTags = [];

          return {
            id: note.id,
            title: note.title || '',
            content: parsedContent,
            folderId: note.folder_id ? note.folder_id : (note.playlist_id ? note.playlist_id : null),
            status: note.status || 'active',
            isFavorite: note.is_favorite || false,
            tags: parsedTags,
            createdAt: Date.parse(note.created_at) || Date.now(),
            updatedAt: Date.parse(note.updated_at) || Date.now(),
            icon: '📄',
          };

        });

        setNotes(mappedNotes);
        
        const openNoteId = localStorage.getItem('open_note_id');
        if (openNoteId) {
          setSelectedNoteId(openNoteId);
          setCurrentView('note');
          localStorage.removeItem('open_note_id');
        }
      } catch (err) {
        console.error("Failed to load notebook data from backend:", err);
      }
    };

    loadData();
  }, []);

  useEffect(() => {
    const handleSelectNoteFromExplorer = () => {
      const openNoteId = localStorage.getItem('open_note_id');
      if (openNoteId) {
        setSelectedNoteId(openNoteId);
        setCurrentView('note');
        localStorage.removeItem('open_note_id');
        return;
      }

      const openFolderId = localStorage.getItem('open_folder_id');
      if (openFolderId) {
        setSelectedFolderId(openFolderId);
        setCurrentView('folder');
        localStorage.removeItem('open_folder_id');
        return;
      }
    };
    window.addEventListener('open-notebook-view', handleSelectNoteFromExplorer);
    return () => window.removeEventListener('open-notebook-view', handleSelectNoteFromExplorer);
  }, []);

  useEffect(() => {
    const handleRefreshNotes = async () => {
      try {
        const notesResponse = await apiFetch('/notes');
        if (!notesResponse.ok) return;
        const notesData = await notesResponse.json();
        const mappedNotes: Note[] = notesData.map((note: any) => {
          let parsedContent = [];
          if (note.content) {
            try {
              parsedContent = JSON.parse(note.content);
              if (!Array.isArray(parsedContent)) {
                parsedContent = [{ type: 'paragraph', content: note.content }];
              }
            } catch {
              parsedContent = [{ type: 'paragraph', content: note.content }];
            }
          }

          let parsedTags = [];
          if (note.tags) {
            try {
              parsedTags = typeof note.tags === 'string' ? JSON.parse(note.tags) : note.tags;
            } catch {
              parsedTags = [];
            }
          }
          if (!Array.isArray(parsedTags)) parsedTags = [];

          return {
            id: note.id,
            title: note.title || '',
            content: parsedContent,
            folderId: note.folder_id ? note.folder_id : (note.playlist_id ? note.playlist_id : null),
            status: note.status || 'active',
            isFavorite: note.is_favorite || false,
            tags: parsedTags,
            createdAt: Date.parse(note.created_at) || Date.now(),
            updatedAt: Date.parse(note.updated_at) || Date.now(),
            icon: '📄',
          };
        });
        setNotes(mappedNotes);
      } catch (err) {
        console.error("Failed to refresh notebook notes:", err);
      }
    };

    window.addEventListener('refresh-notebook-notes', handleRefreshNotes);
    return () => window.removeEventListener('refresh-notebook-notes', handleRefreshNotes);
  }, []);

  const queueNoteSave = (noteId: string, fields: { title?: string; content?: any }) => {
    setIsSaving(true);
    pendingChangesRef.current[noteId] = {
      ...(pendingChangesRef.current[noteId] || {}),
      ...fields
    };

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      const changes = pendingChangesRef.current;
      pendingChangesRef.current = {};

      try {
        for (const [id, change] of Object.entries(changes)) {
          const payload: any = {};
          if (change.title !== undefined) payload.title = change.title;
          if (change.content !== undefined) {
            payload.content = typeof change.content === 'string' 
              ? change.content 
              : JSON.stringify(change.content);
          }

          await apiFetch(`/notes/${id}`, {
            method: 'PUT',
            body: JSON.stringify(payload)
          });
        }
      } catch (error) {
        console.error("Error saving note updates:", error);
      } finally {
        setIsSaving(false);
      }
    }, 1200);
  };

  const toggleFolder = (id: string) => {
    setOpenFolderIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addNote = async () => {
    try {
      // Find suitable playlist folder only if we are currently viewing folders
      let activePlaylistId: string | null = null;
      
      if (currentView === 'folder' && selectedFolderId) {
        const folder = folders.find(f => f.id === selectedFolderId);
        if (folder) {
          if (folder.isPlaylist) {
            activePlaylistId = folder.id;
          } else {
            activePlaylistId = folder.playlistId || null;
          }
        }
      }

      if (!activePlaylistId) {
        showToast("Please select a playlist or folder first to create a note inside it.", "info");
        return;
      }

      const res = await apiFetch(`/playlists/${activePlaylistId}/notes`, {
        method: 'POST',
      });
      const data = await res.json();
      logActivity('notebook', 'Created note');

      const newNote: Note = {
        id: data.id,
        title: data.title || '',
        content: [],
        folderId: data.folder_id || null,
        playlistId: data.playlist_id || activePlaylistId,
        status: data.status || (activePlaylistId ? 'active' : 'draft'),
        isFavorite: data.is_favorite || false,
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        icon: '📄'
      };

      setNotes(prev => [newNote, ...prev]);
      setSelectedNoteId(newNote.id);
      setCurrentView('note');
    } catch (err) {
      console.error("Failed to create new note on backend:", err);
    }
  };

  const addFolder = async () => {
    try {
      let parentPlaylistId: string | null = null;
      let parentFolderId: string | null = null;

      if (selectedFolderId) {
        const selected = folders.find(f => f.id === selectedFolderId);
        if (selected) {
          if (selected.isPlaylist) {
            parentPlaylistId = selected.id;
            parentFolderId = null;
          } else {
            parentPlaylistId = selected.playlistId || null;
            parentFolderId = selected.id;
          }
        }
      }

      if (!parentPlaylistId) {
        showToast("Please select a playlist or folder first to create a folder inside it.", "info");
        return;
      }

      const queryParams = new URLSearchParams();
      queryParams.append('playlist_id', parentPlaylistId || '');
      queryParams.append('name', 'New Folder');
      if (parentFolderId) {
        queryParams.append('parent_folder_id', parentFolderId);
      }

      const res = await apiFetch(`/notebook/folders?${queryParams.toString()}`, {
        method: 'POST',
      });
      const data = await res.json();

      // The backend returns parent_id = Notes folder id.
      // In local state we use the playlist id as parentId (Notes folder is hidden).
      const resolvedParentId = parentFolderId ?? parentPlaylistId;

      const newFolderObj: Folder = {
        id: data.id,
        name: data.name,
        icon: 'folder',
        parentId: resolvedParentId,
        playlistId: data.playlist_id || null,
        isPlaylist: false,
      };

      setFolders(prev => [...prev, newFolderObj]);

      // Open the parent so the new folder is visible
      const targetParentId = parentFolderId || parentPlaylistId;
      if (targetParentId) {
        setOpenFolderIds(prev => {
          const next = new Set(prev);
          next.add(targetParentId);
          return next;
        });
      }

      setSelectedFolderId(data.id);
      setEditingId(data.id);
    } catch (err) {
      console.error('Failed to create notebook folder:', err);
    }
  };


  const createGraphNode = () => {
    // Standard concepts/links creation can be simulated or handled.
    const tempId = Date.now().toString();
    const newNote: Note = {
      id: tempId,
      title: 'New Concept',
      content: [],
      folderId: null,
      status: 'active',
      isFavorite: false,
      tags: [],
      links: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      icon: '💡'
    };
    setNotes(prev => [newNote, ...prev]);
    return tempId;
  };

  const updateNoteContent = (id: string, content: any) => {
    setNotes(prev => prev.map(n => n.id === id ? { ...n, content, updatedAt: Date.now() } : n));
    queueNoteSave(id, { content });
  };

  const updateNoteTitle = (id: string, title: string) => {
    setNotes(prev => prev.map(n => n.id === id ? { ...n, title, updatedAt: Date.now() } : n));
    queueNoteSave(id, { title });
  };

  const updateFolderName = (id: string, name: string) => {
    const folder = folders.find(f => f.id === id);
    if (!folder) return;

    setFolders(prev => prev.map(f => f.id === id ? { ...f, name } : f));

    if (folder.isPlaylist) {
      apiFetch(`/playlists/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ name })
      }).catch(err => console.error('Failed to rename playlist:', err));
    } else {
      // Use the dedicated notebook rename endpoint
      apiFetch(`/notebook/folders/${id}?name=${encodeURIComponent(name)}`, {
        method: 'PATCH'
      }).catch(err => console.error('Failed to rename notebook folder:', err));
    }
  };

  const deleteNote = async (id: string) => {
    setNotes(prev => prev.map(n => n.id === id ? { ...n, status: 'deleted' } : n));
    if (selectedNoteId === id) {
      setSelectedNoteId(null);
    }

    try {
      await apiFetch(`/notes/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'deleted' })
      });
    } catch (err) {
      console.error("Failed to delete note:", err);
    }
  };

  const toggleFavorite = async (id: string) => {
    const note = notes.find(n => n.id === id);
    if (!note) return;
    const nextFavorite = !note.isFavorite;

    setNotes(prev => prev.map(n => n.id === id ? { ...n, isFavorite: nextFavorite } : n));

    try {
      await apiFetch(`/notes/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ is_favorite: nextFavorite })
      });
    } catch (err) {
      console.error("Failed to toggle favorite on note:", err);
    }
  };

  const restoreNote = async (id: string) => {
    setNotes(prev => prev.map(n => n.id === id ? { ...n, status: 'active', updatedAt: Date.now() } : n));

    try {
      await apiFetch(`/notes/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'active' })
      });
    } catch (err) {
      console.error("Failed to restore note:", err);
    }
  };

  const permanentlyDeleteNote = async (id: string) => {
    setNotes(prev => prev.filter(n => n.id !== id));
    if (selectedNoteId === id) setSelectedNoteId(null);

    try {
      await apiFetch(`/notes/${id}`, {
        method: 'DELETE'
      });
      logActivity('notebook', 'Deleted note');
    } catch (err) {
      console.error("Failed to permanently delete note:", err);
    }
  };

  const addTag = async (id: string, label: string) => {
    const note = notes.find(n => n.id === id);
    if (!note) return;

    if (note.tags.some(t => t.label.toLowerCase() === label.toLowerCase())) return;

    const colors = [
      { bgClass: 'bg-blue-50 dark:bg-blue-950/30', colorClass: 'text-blue-600 dark:text-blue-400' },
      { bgClass: 'bg-green-50 dark:bg-green-950/30', colorClass: 'text-green-600 dark:text-green-400' },
      { bgClass: 'bg-yellow-50 dark:bg-yellow-950/30', colorClass: 'text-yellow-600 dark:text-yellow-400' },
      { bgClass: 'bg-purple-50 dark:bg-purple-950/30', colorClass: 'text-purple-600 dark:text-purple-400' },
      { bgClass: 'bg-pink-50 dark:bg-pink-950/30', colorClass: 'text-pink-600 dark:text-pink-400' },
      { bgClass: 'bg-red-50 dark:bg-red-950/30', colorClass: 'text-red-600 dark:text-red-400' },
    ];
    const colorIndex = Math.abs(label.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) % colors.length;
    const newTagObj = { label, ...colors[colorIndex] };

    const updatedTags = [...note.tags, newTagObj];
    setNotes(prev => prev.map(n => n.id === id ? { ...n, tags: updatedTags } : n));

    try {
      await apiFetch(`/notes/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ tags: updatedTags })
      });
    } catch (err) {
      console.error("Failed to add tag:", err);
    }
  };

  const removeTag = async (id: string, label: string) => {
    const note = notes.find(n => n.id === id);
    if (!note) return;

    const updatedTags = note.tags.filter(t => t.label.toLowerCase() !== label.toLowerCase());
    setNotes(prev => prev.map(n => n.id === id ? { ...n, tags: updatedTags } : n));

    try {
      await apiFetch(`/notes/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ tags: updatedTags })
      });
    } catch (err) {
      console.error("Failed to remove tag:", err);
    }
  };


  const linkNotes = (sourceId: string, targetId: string) => {
    // Visual links are maintained locally in state
  };

  const unlinkNotes = (sourceId: string, targetId: string) => {
    // Visual links are maintained locally in state
  };

  const moveNoteToFolder = async (noteId: string, folderId: string | null) => {
    try {
      // Find the target folder to determine its playlistId
      let targetPlaylistId: string | null = null;
      let actualFolderId: string | null = folderId;
      
      if (folderId) {
        const folder = folders.find(f => f.id === folderId);
        if (folder) {
          targetPlaylistId = folder.playlistId || null;
        } else {
          // It's a playlist ID! We are dragging directly into a playlist root.
          targetPlaylistId = folderId;
          actualFolderId = null; // Notes in the root of a playlist have no folder_id
        }
      }
      
      // Optimistic UI update
      setNotes(prev => prev.map(n => n.id === noteId ? { ...n, folderId: actualFolderId, playlistId: targetPlaylistId } : n));

      const res = await apiFetch(`/notes/${noteId}`, {
        method: 'PUT',
        body: JSON.stringify({ 
          folder_id: actualFolderId,
          playlist_id: targetPlaylistId 
        })
      });
    } catch (err) {
      console.error("Failed to move note:", err);
    }
  };

  const moveFolderToFolder = async (folderId: string, targetId: string | null) => {
    if (folderId === targetId) return;

    // Prevent circular descendant loops
    const isDescendantOf = (ancestorId: string, checkId: string): boolean => {
      let current: string | null | undefined = checkId;
      while (current) {
        if (current === ancestorId) return true;
        const f = folders.find(x => x.id === current);
        if (!f) break;
        current = f.parentId;
      }
      return false;
    };

    if (targetId && isDescendantOf(folderId, targetId)) {
      console.warn('Cannot move a folder inside itself or its own subfolders!');
      return;
    }

    try {
      let newPlaylistId: string | null = null;
      let newParentId: string | null = targetId; // local state parentId
      let targetParentFolderId: string | null = null; // for nested custom subfolder

      if (targetId) {
        const target = folders.find(f => f.id === targetId);
        if (target) {
          if (target.isPlaylist) {
            newPlaylistId = target.id;
            newParentId = target.id; // show as direct child of playlist in sidebar
          } else {
            newPlaylistId = target.playlistId || null;
            targetParentFolderId = target.id;
            newParentId = target.id;
          }
        }
      }

      // Update local state immediately
      setFolders(prev => prev.map(f => f.id === folderId ? {
        ...f,
        parentId: newParentId,
        playlistId: newPlaylistId
      } : f));

      if (newPlaylistId) {
        // Use the dedicated notebook move endpoint
        const query = new URLSearchParams();
        query.append('target_playlist_id', newPlaylistId);
        if (targetParentFolderId) {
          query.append('target_parent_folder_id', targetParentFolderId);
        }
        await apiFetch(`/notebook/folders/${folderId}/move?${query.toString()}`, {
          method: 'PATCH'
        });
      } else {
        // Moving to root (no playlist) — use old endpoint for that case
        const query = new URLSearchParams();
        query.append('playlist_id', 'null');
        query.append('parent_id', 'null');
        await apiFetch(`/folders/${folderId}?${query.toString()}`, {
          method: 'PATCH'
        });
      }
    } catch (err) {
      console.error('Failed to move notebook folder:', err);
    }
  };

  const deleteFolder = async (id: string) => {
    // Optimistically soft-delete in local state
    const collectDescendants = (fid: string): string[] => {
      const directChildren = folders.filter(f => f.parentId === fid).map(f => f.id);
      return [fid, ...directChildren.flatMap(collectDescendants)];
    };
    const toRemove = new Set(collectDescendants(id));
    setFolders(prev => prev.map(f => toRemove.has(f.id) ? { ...f, isDeleted: true } : f));
    setSelectedFolderId(prev => (prev && toRemove.has(prev) ? null : prev));

    try {
      await apiFetch(`/folders/${id}`, { method: 'DELETE' });
    } catch (err: any) {
      console.error('Failed to soft-delete folder:', err);
      alert(`Failed to soft-delete folder: ${err.message}`);
    }
  };

  const restoreFolder = async (id: string) => {
    const collectDescendants = (fid: string): string[] => {
      const directChildren = folders.filter(f => f.parentId === fid).map(f => f.id);
      return [fid, ...directChildren.flatMap(collectDescendants)];
    };
    const toRestore = new Set(collectDescendants(id));
    setFolders(prev => prev.map(f => toRestore.has(f.id) ? { ...f, isDeleted: false } : f));

    try {
      await apiFetch('/explorer/restore', {
        method: 'POST',
        body: JSON.stringify({ folder_ids: [id], resource_ids: [] })
      });
    } catch (err: any) {
      console.error('Failed to restore folder:', err);
      alert(`Failed to restore folder: ${err.message}`);
    }
  };

  const permanentlyDeleteFolder = async (id: string) => {
    const collectDescendants = (fid: string): string[] => {
      const directChildren = folders.filter(f => f.parentId === fid).map(f => f.id);
      return [fid, ...directChildren.flatMap(collectDescendants)];
    };
    const toRemove = new Set(collectDescendants(id));
    setFolders(prev => prev.filter(f => !toRemove.has(f.id)));

    try {
      await apiFetch(`/notebook/folders/${id}`, { method: 'DELETE' });
    } catch (err: any) {
      console.error('Failed to permanently delete folder:', err);
      alert(`Failed to permanently delete folder: ${err.message}`);
    }
  };


  return (
    <AppContext.Provider value={{
      notes, folders, currentView, selectedNoteId, selectedFolderId, openFolderIds, searchOpen, settingsOpen, helpOpen, sidebarOpen, isSaving,
      setSearchOpen, setSettingsOpen, setHelpOpen, setSidebarOpen, setCurrentView, setSelectedNoteId, setSelectedFolderId, toggleFolder, addNote, addFolder,
      updateNoteContent, updateNoteTitle, updateFolderName, deleteNote, deleteFolder, restoreFolder, permanentlyDeleteFolder, toggleFavorite, restoreNote, permanentlyDeleteNote, addTag, removeTag, linkNotes, unlinkNotes, createGraphNode, moveNoteToFolder,
      editingId, setEditingId, moveFolderToFolder
    }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useAppContext must be used within AppProvider');
  return context;
}
