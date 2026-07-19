import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { logActivity } from '../utils/activityLogger';
import {
  X,
  PlayCircle,
  Link as LinkIcon,
  ChevronDown,
  Folder,
  ListVideo,
  Plus,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Clock,
  Loader2,
  Trash2,
  Search,
} from 'lucide-react';

// URL validation functions
function isValidYoutubeUrl(url: string): boolean {
  const patterns = [
    /^https?:\/\/(www\.)?youtube\.com\/watch\?v=[\w-]+/,
    /^https?:\/\/(www\.)?youtu\.be\/[\w-]+/,
    /^https?:\/\/(www\.)?youtube\.com\/embed\/[\w-]+/,
    /^https?:\/\/(www\.)?youtube\.com\/shorts\/[\w-]+/,
    /^https?:\/\/m\.youtube\.com\/watch\?v=[\w-]+/,
  ];
  return patterns.some(p => p.test(url.trim()));
}

function isValidTwitterUrl(url: string): boolean {
  const patterns = [
    /^https?:\/\/(www\.)?(twitter|x)\.com\/[\w]+\/status\/\d+/,
    /^https?:\/\/(www\.)?(twitter|x)\.com\/[\w]+\/?$/,
    /^https?:\/\/(www\.)?(twitter|x)\.com\/[\w]+\/media$/,
    /^[\w]+$/,
  ];
  return patterns.some(p => p.test(url.trim()));
}

function isValidInstagramUrl(url: string): boolean {
  const patterns = [
    /^https?:\/\/(www\.)?instagram\.com\/[\w.]+\/?$/,
    /^https?:\/\/(www\.)?instagram\.com\/p\/[\w-]+/,
    /^https?:\/\/(www\.)?instagram\.com\/reel\/[\w-]+/,
    /^[\w.]+$/,
  ];
  return patterns.some(p => p.test(url.trim()));
}

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateToDownloads: () => void;
}

interface Playlist {
  id: string;
  name: string;
}

interface FolderItem {
  id: string;
  name: string;
}

interface TreeNode {
  id: string;
  name: string;
  type: 'playlist' | 'folder';
  playlistId?: string;
  children: TreeNode[];
}

interface QueuedItem {
  url: string;
  title: string;
  taskId: string;
  status: 'queued' | 'error';
  error?: string;
}

function getYoutubeThumbnail(url: string): string | null {
  try {
    const parsed = new URL(url);
    let videoId: string | null = null;
    if (parsed.hostname.includes('youtu.be')) {
      videoId = parsed.pathname.slice(1);
    } else {
      videoId = parsed.searchParams.get('v');
    }
    if (videoId) return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
  } catch {
    // ignore
  }
  return null;
}

function getYoutubeTitle(url: string): string {
  try {
    const parsed = new URL(url);
    let videoId: string | null = null;
    if (parsed.hostname.includes('youtu.be')) {
      videoId = parsed.pathname.slice(1);
    } else {
      videoId = parsed.searchParams.get('v');
    }
    if (videoId) return `YouTube Video (${videoId})`;
  } catch {
    // ignore
  }
  return url;
}

const TwitterLogo = ({ className = "w-5 h-5 text-slate-900 fill-current" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className}>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const InstagramLogo = ({ className = "w-5 h-5 text-pink-600" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
  </svg>
);

export default function ImportContentModal({ isOpen, onClose, onNavigateToDownloads }: ImportModalProps) {
  const [url, setUrl] = useState('');
  const [selectedFolder, setSelectedFolder] = useState('');
  const [youtubeQuality, setYoutubeQuality] = useState('best');
  const [selectedPlaylist, setSelectedPlaylist] = useState('');
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState('');
  const [queuedItems, setQueuedItems] = useState<QueuedItem[]>([]);
  
  // New social media tabs states
  const [activeTab, setActiveTab] = useState<'youtube' | 'twitter' | 'instagram'>('youtube');
  const [showReplaceConfirm, setShowReplaceConfirm] = useState(false);
  const [extractedUsername, setExtractedUsername] = useState('');
  // Manual cookie file upload state. Platform cookies are saved after the first upload.
  const [cookieFile, setCookieFile] = useState<File | null>(null);
  const [hasSavedYoutubeCookies, setHasSavedYoutubeCookies] = useState(false);
  const [hasSavedSocialCookies, setHasSavedSocialCookies] = useState<Record<'twitter' | 'instagram', boolean>>({
    twitter: false,
    instagram: false,
  });
  const [isCheckingYoutubeCookies, setIsCheckingYoutubeCookies] = useState(false);
  const [isSavingYoutubeCookies, setIsSavingYoutubeCookies] = useState(false);
  const [savingCookiePlatform, setSavingCookiePlatform] = useState<'youtube' | 'twitter' | 'instagram' | null>(null);

  // Tree selector state
  const [notebookTreeData, setNotebookTreeData] = useState<TreeNode[]>([]);
  const [expandedPlaylistIds, setExpandedPlaylistIds] = useState<Set<string>>(new Set());
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());
  const [notebookSearchQuery, setNotebookSearchQuery] = useState('');
  const [isLoadingTree, setIsLoadingTree] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchPlaylists();
      loadNotebookTree();
      setUrl('');
      setError('');
      setSelectedPlaylist('');
      setSelectedFolder('');
      setFolders([]);
      setQueuedItems([]);
      setActiveTab('youtube');
      setShowReplaceConfirm(false);
      setExtractedUsername('');
      setCookieFile(null);
      setNotebookSearchQuery('');
      setExpandedPlaylistIds(new Set());
      setExpandedFolderIds(new Set());
      fetchYoutubeCookieStatus();
      fetchSocialCookieStatus('twitter');
      fetchSocialCookieStatus('instagram');
    }
  }, [isOpen]);

  const hasSavedActiveCookies = activeTab === 'youtube'
    ? hasSavedYoutubeCookies
    : hasSavedSocialCookies[activeTab];
  const isSavingActiveCookies = savingCookiePlatform === activeTab || (activeTab === 'youtube' && isSavingYoutubeCookies);
  const activeCookiePlatformLabel = activeTab === 'youtube' ? 'YouTube' : activeTab === 'twitter' ? 'X.com' : 'Instagram';

  const fetchYoutubeCookieStatus = async () => {
    setIsCheckingYoutubeCookies(true);
    try {
      const token = localStorage.getItem('access_token');
      const response = await fetch('/youtube/cookies/status', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setHasSavedYoutubeCookies(Boolean(data.has_cookies));
      }
    } catch (err) {
      console.error('Failed to fetch YouTube cookie status', err);
    } finally {
      setIsCheckingYoutubeCookies(false);
    }
  };

  const fetchSocialCookieStatus = async (platform: 'twitter' | 'instagram') => {
    try {
      const token = localStorage.getItem('access_token');
      const response = await fetch(`/social/cookies/status?platform=${platform}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setHasSavedSocialCookies(prev => ({ ...prev, [platform]: Boolean(data.has_cookies) }));
      }
    } catch (err) {
      console.error(`Failed to fetch ${platform} cookie status`, err);
    }
  };

  const fetchPlaylists = async () => {
    try {
      const token = localStorage.getItem('access_token');
      const response = await fetch('/playlists', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setPlaylists(data);
      }
    } catch (err) {
      console.error('Failed to fetch playlists', err);
    }
  };

  const fetchFolders = async (playlistId: string) => {
    if (!playlistId) { setFolders([]); return; }
    try {
      const token = localStorage.getItem('access_token');
      const response = await fetch(`/playlists/${playlistId}/all-folders`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setFolders(data);
      }
    } catch (err) {
      console.error('Failed to fetch folders', err);
    }
  };

  const handlePlaylistChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setSelectedPlaylist(id);
    setSelectedFolder('');
    fetchFolders(id);
  };

  const loadNotebookTree = async () => {
    const token = localStorage.getItem('access_token');
    if (!token) return;
    setIsLoadingTree(true);
    try {
      const playlistsResponse = await fetch('/playlists', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!playlistsResponse.ok) throw new Error('Failed to load playlists.');
      const playlistsData = await playlistsResponse.json();
      const treeData: TreeNode[] = [];

      for (const playlist of playlistsData) {
        const playlistId = String(playlist.id);
        const playlistNode: TreeNode = {
          id: playlistId,
          name: playlist.name || 'Untitled',
          type: 'playlist',
          children: [],
        };

        try {
          const foldersResponse = await fetch(`/playlists/${playlistId}/all-folders`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!foldersResponse.ok) continue;
          const folders = await foldersResponse.json();

          // The destination tree must show every playlist folder, including
          // root and the default Notes, Resources, and Media folders.
          const filteredFolders = folders;

          const topLevel = filteredFolders.filter((f: any) => !f.parent_id);
          const childFolders = filteredFolders.filter((f: any) => f.parent_id);

          topLevel.forEach((folder: any) => {
            const folderNode: TreeNode = {
              id: String(folder.id),
              name: folder.name || 'Folder',
              type: 'folder',
              playlistId,
              children: childFolders
                .filter((child: any) => child.parent_id === folder.id)
                .map((child: any) => ({
                  id: String(child.id),
                  name: child.name || 'Folder',
                  type: 'folder' as const,
                  playlistId,
                  children: [],
                })),
            };
            playlistNode.children.push(folderNode);
          });
        } catch {
          // Keep the playlist even when folder loading fails.
        }

        treeData.push(playlistNode);
      }

      setNotebookTreeData(treeData);
    } catch (error) {
      console.error('Failed to load notebook tree:', error);
    } finally {
      setIsLoadingTree(false);
    }
  };

  const togglePlaylistExpand = (playlistId: string) => {
    setExpandedPlaylistIds((prev) => {
      const next = new Set(prev);
      if (next.has(playlistId)) next.delete(playlistId);
      else next.add(playlistId);
      return next;
    });
  };

  const toggleFolderExpand = (folderId: string) => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const filterTreeBySearch = (tree: TreeNode[], query: string): TreeNode[] => {
    if (!query.trim()) return tree;
    const q = query.toLowerCase();
    return tree.filter((playlist) => {
      if (playlist.name.toLowerCase().includes(q)) return true;
      const matchingChildren = playlist.children.filter(
        (folder) => folder.name.toLowerCase().includes(q) ||
          folder.children.some((sub) => sub.name.toLowerCase().includes(q))
      );
      return matchingChildren.length > 0;
    }).map((playlist) => ({
      ...playlist,
      children: playlist.children.filter(
        (folder) => folder.name.toLowerCase().includes(q) ||
          folder.children.some((sub) => sub.name.toLowerCase().includes(q))
      ),
    }));
  };

  const getSelectedPath = (): string => {
    if (!selectedPlaylist) return '';
    const playlist = notebookTreeData.find((p) => p.id === selectedPlaylist);
    if (!playlist) return selectedPlaylist;
    if (!selectedFolder) return playlist.name;
    for (const folder of playlist.children) {
      if (folder.id === selectedFolder) return `${playlist.name} / ${folder.name}`;
      for (const sub of folder.children || []) {
        if (sub.id === selectedFolder) return `${playlist.name} / ${folder.name} / ${sub.name}`;
      }
    }
    return playlist.name;
  };

  const handleSelectTreePlaylist = (playlistId: string) => {
    setSelectedPlaylist(playlistId);
    if (activeTab !== 'youtube') {
      setSelectedFolder('');
    }
    fetchFolders(playlistId);
  };

  const handleSelectTreeFolder = (folderId: string) => {
    setSelectedFolder(folderId);
  };

  const filteredTree = filterTreeBySearch(notebookTreeData, notebookSearchQuery);

  const extractSocialUsername = (urlStr: string, platform: 'twitter' | 'instagram'): string | null => {
    try {
      const trimmed = urlStr.trim();
      if (!trimmed) return null;
      
      // If user typed just username (without slash)
      if (!trimmed.includes('/') && /^[a-zA-Z0-9_.]+$/.test(trimmed)) {
        return trimmed;
      }
      
      let absoluteUrl = trimmed;
      if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
        absoluteUrl = 'https://' + trimmed;
      }
      
      const parsed = new URL(absoluteUrl);
      const segments = parsed.pathname.split('/').filter(Boolean);
      if (segments.length > 0) {
        // Special case: ignore media subpath segment for twitter
        if (platform === 'twitter' && segments.length > 1 && segments[1].toLowerCase() === 'media') {
          return segments[0];
        }
        return segments[0];
      }
    } catch {
      // fallback if regex is viable
    }
    return null;
  };

  const readCookieFileContent = async (file: File): Promise<string> => (
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string || '');
      reader.onerror = () => reject(new Error('Failed to read cookie file.'));
      reader.readAsText(file);
    })
  );

  const saveCookieFileForPlatform = async (file: File, platform: 'youtube' | 'twitter' | 'instagram') => {
    setSavingCookiePlatform(platform);
    if (platform === 'youtube') {
      setIsSavingYoutubeCookies(true);
    }
    setError('');
    try {
      const cookiesContent = await readCookieFileContent(file);
      if (!cookiesContent.trim()) {
        throw new Error('cookies.txt file is empty.');
      }

      const token = localStorage.getItem('access_token');
      const endpoint = platform === 'youtube'
        ? '/youtube/cookies'
        : '/social/cookies';
      const body = platform === 'youtube'
        ? { cookies_content: cookiesContent }
        : { platform, cookies_content: cookiesContent };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || `Failed to save ${activeCookiePlatformLabel} cookies.`);
      }

      if (platform === 'youtube') {
        setHasSavedYoutubeCookies(true);
      } else {
        setHasSavedSocialCookies(prev => ({ ...prev, [platform]: true }));
      }
      setCookieFile(null);
    } catch (err: any) {
      setError(err.message || `Failed to save ${activeCookiePlatformLabel} cookies.`);
    } finally {
      if (platform === 'youtube') {
        setIsSavingYoutubeCookies(false);
      }
      setSavingCookiePlatform(null);
    }
  };

  const handleCookieFileSelected = (file: File) => {
    void saveCookieFileForPlatform(file, activeTab);
  };

  const handleAddToQueue = async (forceReplace: boolean = false) => {
    if (!url.trim()) {
      setError(`Please enter a ${activeTab === 'youtube' ? 'YouTube URL' : activeTab === 'twitter' ? 'Twitter/X profile URL' : 'Instagram profile URL'}.`);
      return;
    }

    // Validate URL format
    if (activeTab === 'youtube' && !isValidYoutubeUrl(url)) {
      setError('Invalid YouTube URL. Please enter a valid YouTube video link (e.g., youtube.com/watch?v=... or youtu.be/...)');
      return;
    }
    if (activeTab === 'twitter' && !isValidTwitterUrl(url)) {
      setError('Invalid Twitter/X URL. Please enter a valid Twitter profile or post link (e.g., x.com/username or x.com/username/status/...)');
      return;
    }
    if (activeTab === 'instagram' && !isValidInstagramUrl(url)) {
      setError('Invalid Instagram URL. Please enter a valid Instagram profile or post link (e.g., instagram.com/username or instagram.com/p/...)');
      return;
    }

    if (!selectedPlaylist) { setError('Please select a playlist.'); return; }

    // Require saved cookies for social media tabs.
    if (activeTab !== 'youtube' && !hasSavedSocialCookies[activeTab] && !cookieFile) {
      setError('Please upload your cookies.txt file once to authenticate downloads. The app will save it and reuse it for future imports.');
      return;
    }

    setError('');

    if (activeTab === 'youtube') {
      setIsAdding(true);
      try {
        let cookiesContent = '';
        if (cookieFile) {
          cookiesContent = await readCookieFileContent(cookieFile);
        }

        const token = localStorage.getItem('access_token');
        const requestBody: Record<string, string | undefined> = {
          url: url.trim(),
          playlist_id: selectedPlaylist,
          folder_id: selectedFolder || undefined,
          quality: youtubeQuality,
        };
        if (cookiesContent) {
          requestBody.cookies_content = cookiesContent;
        }

        const response = await fetch('/tasks/youtube/create', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.detail || 'Failed to add to queue.');
        }

        const data = await response.json();
        const title = getYoutubeTitle(url.trim());
        logActivity('download', `Imported YouTube video`, url.trim());

        setQueuedItems(prev => [
          { url: url.trim(), title, taskId: data.task_id, status: 'queued' },
          ...prev,
        ]);
        setUrl('');
        if (cookiesContent) {
          setHasSavedYoutubeCookies(true);
          setCookieFile(null);
        }
      } catch (err: any) {
        setError(err.message || 'An error occurred.');
      } finally {
        setIsAdding(false);
      }
    } else {
      // Twitter or Instagram profile import
      const username = extractSocialUsername(url, activeTab);
      if (!username) {
        setError(`Could not extract username from profile URL. Please check the link.`);
        return;
      }
      
      setExtractedUsername(username);

      if (!forceReplace) {
        setIsAdding(true);
        try {
          const token = localStorage.getItem('access_token');
          const checkResp = await fetch(`/folders/check-social-exist?playlist_id=${selectedPlaylist}&username=${username}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (checkResp.ok) {
            const checkData = await checkResp.json();
            if (checkData.exists) {
              setShowReplaceConfirm(true);
              setIsAdding(false);
              return;
            }
          }
        } catch (err) {
          console.error("Failed to check social folder existence", err);
        } finally {
          setIsAdding(false);
        }
      }

      // Read cookie file content as text, then submit
      setIsAdding(true);
      setShowReplaceConfirm(false);

      let cookiesContent = '';
      if (cookieFile) {
        try {
          cookiesContent = await readCookieFileContent(cookieFile);
        } catch (err: any) {
          setError(err.message || 'Failed to read cookies.txt file.');
          setIsAdding(false);
          return;
        }
      }

      try {
        const token = localStorage.getItem('access_token');
        const response = await fetch('/tasks/social/create', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: url.trim(),
            platform: activeTab,
            username,
            playlist_id: selectedPlaylist,
            replace: forceReplace,
            cookies_content: cookiesContent,
          }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.detail || 'Failed to add to queue.');
        }

        const data = await response.json();
        const title = `${activeTab === 'twitter' ? 'X.com' : 'Instagram'} Profile (@${username})`;
        logActivity('download', `Imported ${activeTab} profile @${username}`);

        setQueuedItems(prev => [
          { url: url.trim(), title, taskId: data.task_id, status: 'queued' },
          ...prev,
        ]);
        setUrl('');
        setCookieFile(null);
      } catch (err: any) {
        setError(err.message || 'An error occurred.');
      } finally {
        setIsAdding(false);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleAddToQueue();
  };

  const removeFromLocalQueue = (taskId: string) => {
    setQueuedItems(prev => prev.filter(i => i.taskId !== taskId));
  };

  const handleGoToDownloads = () => {
    onClose();
    onNavigateToDownloads();
  };

  const hasQueued = queuedItems.length > 0;

  return (
    <AnimatePresence>
      {isOpen && (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 font-sans">
      <motion.div
        key="import-content-backdrop"
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        onClick={onClose}
      />
      <motion.div
        key="import-content-modal"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.94, y: 26, filter: 'blur(8px)' }}
        animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
        exit={{ opacity: 0, scale: 0.96, y: 18, filter: 'blur(6px)' }}
        transition={{
          opacity: { duration: 0.24, ease: [0.16, 1, 0.3, 1] },
          scale: { type: 'spring', stiffness: 420, damping: 31, mass: 0.8 },
          y: { type: 'spring', stiffness: 420, damping: 33, mass: 0.8 },
          filter: { duration: 0.24, ease: [0.16, 1, 0.3, 1] },
        }}
        className="relative w-full bg-white rounded-[28px] shadow-2xl border border-slate-200/60 overflow-hidden flex flex-col"
        style={{ maxWidth: hasQueued ? 680 : 480 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-modal-title"
      >
        {/* Top gradient bar */}
        <div className="h-1 w-full" style={{ background: 'linear-gradient(90deg, #6366f1, #8b5cf6, #ec4899)' }} />

        {/* Header */}
        <div className="flex items-center justify-between px-8 pt-7 pb-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-slate-50 border border-slate-200/60 shadow-sm flex-shrink-0">
              {activeTab === 'youtube' ? (
                <PlayCircle className="w-5 h-5 text-red-500" />
              ) : activeTab === 'twitter' ? (
                <TwitterLogo />
              ) : (
                <InstagramLogo />
              )}
            </div>
            <h2 id="import-modal-title" className="text-lg font-semibold tracking-tight text-slate-900">
              {activeTab === 'youtube'
                ? 'Import YouTube Videos'
                : activeTab === 'twitter'
                ? 'Import Twitter/X Media'
                : 'Import Instagram Media'}
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={isAdding}
            className="p-2 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all duration-200"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex px-8 border-b border-slate-100 mb-5">
          <button
            onClick={() => { setActiveTab('youtube'); setError(''); setUrl(''); setShowReplaceConfirm(false); setCookieFile(null); }}
            className={`flex-1 py-3 text-sm font-semibold border-b-2 text-center transition-all ${
              activeTab === 'youtube'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            YouTube
          </button>
          <button
            onClick={() => { setActiveTab('twitter'); setError(''); setUrl(''); setShowReplaceConfirm(false); setCookieFile(null); }}
            className={`flex-1 py-3 text-sm font-semibold border-b-2 text-center transition-all ${
              activeTab === 'twitter'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            Twitter / X
          </button>
          <button
            onClick={() => { setActiveTab('instagram'); setError(''); setUrl(''); setShowReplaceConfirm(false); setCookieFile(null); }}
            className={`flex-1 py-3 text-sm font-semibold border-b-2 text-center transition-all ${
              activeTab === 'instagram'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            Instagram
          </button>
        </div>

        <div className="flex gap-0 min-h-0">
          {/* Left: Form Panel */}
          <div className="flex-1 px-8 pb-8 space-y-5 min-w-0">
            {/* URL Input */}
            <div className="space-y-1.5">
              <label htmlFor="url-input" className="text-sm font-medium text-slate-700">
                {activeTab === 'youtube'
                  ? 'YouTube URL'
                  : activeTab === 'twitter'
                  ? 'Twitter / X Profile URL'
                  : 'Instagram Profile URL'}
              </label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400 group-focus-within:text-indigo-500 transition-colors duration-200">
                  <LinkIcon className="w-4 h-4" />
                </div>
                <input
                  id="url-input"
                  type="url"
                  value={url}
                  disabled={isAdding}
                  onChange={e => { setUrl(e.target.value); setError(''); setShowReplaceConfirm(false); }}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    activeTab === 'youtube'
                      ? 'Paste YouTube link here...'
                      : activeTab === 'twitter'
                      ? 'https://x.com/username or https://twitter.com/username'
                      : 'https://instagram.com/username'
                  }
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200/80 rounded-xl text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all duration-200 shadow-sm disabled:opacity-50 text-sm"
                />
              </div>
            </div>

            {/* Destination selector */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">
                {activeTab === 'youtube' ? 'Destination' : 'Playlist'}
              </label>
              {/* Breadcrumb for YouTube */}
              {activeTab === 'youtube' && selectedPlaylist && (
                <div className="flex items-center gap-1 text-xs text-indigo-600">
                  <ListVideo size={12} />
                  <span className="font-medium truncate max-w-[400px]">{getSelectedPath()}</span>
                </div>
              )}
              {/* Search (YouTube only) */}
              {activeTab === 'youtube' && (
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={notebookSearchQuery}
                    onChange={(e) => setNotebookSearchQuery(e.target.value)}
                    placeholder="Search playlists and folders..."
                    className="w-full pl-9 pr-4 py-2.5 text-sm border border-slate-200/80 bg-slate-50 rounded-xl outline-none focus:bg-white focus:border-indigo-500 transition-all"
                  />
                </div>
              )}
              {/* Tree (YouTube) or flat list (Twitter/Instagram) */}
              <div className="max-h-[155px] overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-2">
                {isLoadingTree ? (
                  <div className="flex items-center justify-center py-6 gap-2">
                    <Loader2 size={16} className="animate-spin text-indigo-500" />
                    <span className="text-xs text-slate-500">Loading...</span>
                  </div>
                ) : activeTab === 'youtube' ? (
                  /* YouTube: full tree (playlist > folder > subfolder) */
                  filteredTree.length === 0 ? (
                    <div className="py-6 text-center">
                      <p className="text-xs text-slate-500">
                        {notebookSearchQuery ? 'No results match your search.' : 'No playlists found.'}
                      </p>
                    </div>
                  ) : (
                    filteredTree.map((playlist) => (
                      <div key={playlist.id} className="mb-1">
                        <button
                          type="button"
                          onClick={() => {
                            handleSelectTreePlaylist(playlist.id);
                            if (playlist.children.length > 0) togglePlaylistExpand(playlist.id);
                          }}
                          className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left text-sm transition-colors ${
                            selectedPlaylist === playlist.id && !selectedFolder
                              ? 'bg-indigo-100 text-indigo-700'
                              : 'text-slate-700 hover:bg-white'
                          }`}
                        >
                          {playlist.children.length > 0 ? (
                            <ChevronDown
                              size={14}
                              className={`shrink-0 transition-transform ${expandedPlaylistIds.has(playlist.id) ? 'rotate-0' : '-rotate-90'} text-slate-400`}
                            />
                          ) : (
                            <span className="w-[14px] shrink-0" />
                          )}
                          <ListVideo size={14} className="text-slate-400" />
                          <span className="font-medium truncate">{playlist.name}</span>
                        </button>
                        {expandedPlaylistIds.has(playlist.id) && playlist.children.length > 0 && (
                          <div className="ml-6 mt-0.5">
                            {playlist.children.map((folder) => (
                              <div key={folder.id}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleSelectTreeFolder(folder.id);
                                    if (folder.children?.length > 0) toggleFolderExpand(folder.id);
                                  }}
                                  className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-left text-xs transition-colors ${
                                    selectedFolder === folder.id
                                      ? 'bg-indigo-100 text-indigo-700'
                                      : 'text-slate-600 hover:bg-white'
                                  }`}
                                >
                                  {folder.children?.length > 0 ? (
                                    <ChevronDown
                                      size={12}
                                      className={`shrink-0 transition-transform ${expandedFolderIds.has(folder.id) ? 'rotate-0' : '-rotate-90'} text-slate-400`}
                                    />
                                  ) : (
                                    <span className="w-[12px] shrink-0" />
                                  )}
                                  <Folder size={13} className="text-slate-400" />
                                  <span className="truncate">{folder.name}</span>
                                </button>
                                {expandedFolderIds.has(folder.id) && folder.children?.length > 0 && (
                                  <div className="ml-5 mt-0.5">
                                    {folder.children.map((sub) => (
                                      <button
                                        key={sub.id}
                                        type="button"
                                        onClick={() => handleSelectTreeFolder(sub.id)}
                                        className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-left text-xs transition-colors ${
                                          selectedFolder === sub.id
                                            ? 'bg-indigo-100 text-indigo-700'
                                            : 'text-slate-600 hover:bg-white'
                                        }`}
                                      >
                                        <span className="w-[12px] shrink-0" />
                                        <Folder size={13} className="text-slate-400" />
                                        <span className="truncate">{sub.name}</span>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  )
                ) : (
                  /* Twitter/Instagram: flat playlist list only */
                  playlists.length === 0 ? (
                    <div className="py-6 text-center">
                      <p className="text-xs text-slate-500">No playlists found.</p>
                    </div>
                  ) : (
                    playlists.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handleSelectTreePlaylist(p.id)}
                        className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left text-sm transition-colors ${
                          selectedPlaylist === p.id
                            ? 'bg-indigo-100 text-indigo-700'
                            : 'text-slate-700 hover:bg-white'
                        }`}
                      >
                        <ListVideo size={14} className="text-slate-400" />
                        <span className="font-medium truncate">{p.name}</span>
                      </button>
                    ))
                  )
                )}
              </div>
            </div>

            {/* Quality Selector - Only for YouTube */}
            {activeTab === 'youtube' && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">
                  Quality
                </label>
                <div className="flex w-full gap-2">
                  {[
                    { value: 'best', label: 'Best' },
                    { value: '1080', label: '1080p' },
                    { value: '720', label: '720p' },
                    { value: '480', label: '480p' },
                    { value: '360', label: '360p' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={isAdding}
                      onClick={() => setYoutubeQuality(opt.value)}
                      className={
'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 border flex-1 text-center ' +
(youtubeQuality === opt.value
? 'bg-indigo-600 text-white border-indigo-600 shadow-sm shadow-indigo-500/20'
: 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-600 hover:bg-indigo-50')
+ ' disabled:opacity-50'
                      }
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Cookie File Upload — required for Twitter/X and Instagram */}
            {(
              <div className="space-y-1.5">
                <label htmlFor="cookie-file-input" className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                  {activeCookiePlatformLabel} Cookies File
                  {activeTab === 'youtube' || hasSavedActiveCookies ? (
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full uppercase tracking-wide ${
                      hasSavedActiveCookies
                        ? 'bg-emerald-100 text-emerald-600'
                        : 'bg-slate-100 text-slate-500'
                    }`}>
                      {isSavingActiveCookies ? 'Saving' : activeTab === 'youtube' && isCheckingYoutubeCookies ? 'Checking' : hasSavedActiveCookies ? 'Saved' : 'Optional'}
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full uppercase tracking-wide">Required</span>
                  )}
                </label>
                <p className="text-xs text-slate-400">
                  Upload {activeCookiePlatformLabel} <code className="text-indigo-600 bg-indigo-50 px-1 rounded text-[11px]">cookies.txt</code> once. The app saves it globally for this platform; uploading another file replaces the saved cookie.
                </p>
                <div
                  className={`relative flex items-center gap-3 px-4 py-3 border-2 border-dashed rounded-xl cursor-pointer transition-all duration-200 ${
                    cookieFile || hasSavedActiveCookies
                      ? 'border-emerald-400 bg-emerald-50'
                      : 'border-slate-200 bg-slate-50 hover:border-indigo-400 hover:bg-indigo-50/30'
                  }`}
                  onClick={() => !isAdding && !isSavingActiveCookies && document.getElementById('cookie-file-input')?.click()}
                >
                  <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${
                    cookieFile || hasSavedActiveCookies ? 'bg-emerald-100' : 'bg-slate-100'
                  }`}>
                    {isSavingActiveCookies ? (
                      <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" />
                    ) : cookieFile || hasSavedActiveCookies ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <Folder className="w-4 h-4 text-slate-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    {cookieFile ? (
                      <>
                        <p className="text-sm font-semibold text-emerald-700 truncate">{cookieFile.name}</p>
                        <p className="text-[11px] text-emerald-600">Cookie file ready — click to change</p>
                      </>
                    ) : hasSavedActiveCookies || isSavingActiveCookies ? (
                      <>
                        <p className="text-sm font-semibold text-emerald-700">
                          {isSavingActiveCookies ? `Saving ${activeCookiePlatformLabel} cookies...` : `Saved ${activeCookiePlatformLabel} cookies available`}
                        </p>
                        <p className="text-[11px] text-emerald-600">
                          {isSavingActiveCookies ? 'Replacing saved cookies...' : 'Click to replace with a new cookies.txt'}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-slate-500">Click to upload cookies.txt</p>
                        <p className="text-[11px] text-slate-400">Netscape format (.txt)</p>
                      </>
                    )}
                  </div>
                  {cookieFile && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setCookieFile(null); }}
                      className="flex-shrink-0 p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      aria-label="Remove cookie file"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                <input
                  id="cookie-file-input"
                  type="file"
                  accept=".txt,text/plain"
                  className="hidden"
                  disabled={isAdding || isSavingActiveCookies}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) { handleCookieFileSelected(file); }
                    e.target.value = '';
                  }}
                />
              </div>
            )}

            {/* Replace confirmation inline alert */}
            <AnimatePresence>
              {showReplaceConfirm && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-3"
                >
                  <div className="flex items-start gap-2.5">
                    <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-amber-800">Folder already exists</p>
                      <p className="text-xs text-amber-700 mt-1">
                        A folder named <strong>{extractedUsername}</strong> already exists inside the "Media" folder of this playlist. 
                        Replacing it will permanently delete all existing files and resources within that folder.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => setShowReplaceConfirm(false)}
                      className="px-3 py-1.5 bg-white border border-slate-200 text-xs font-semibold text-slate-600 rounded-lg hover:bg-slate-50 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleAddToQueue(true)}
                      className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg transition-colors"
                    >
                      Yes, Replace
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Error */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="flex items-start gap-2.5 px-4 py-3 bg-red-50/80 border border-red-100 rounded-xl text-red-600"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <p className="text-sm font-medium">{error}</p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Add to Queue button */}
            <button
              id="add-to-queue-btn"
              onClick={() => handleAddToQueue(false)}
              disabled={isAdding || isSavingActiveCookies || !url.trim() || !selectedPlaylist || (activeTab !== 'youtube' && !hasSavedSocialCookies[activeTab] && !cookieFile)}
              className={`w-full py-3 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-200 ${
                isAdding || isSavingActiveCookies
                  ? 'bg-indigo-400 cursor-wait'
                  : !url.trim() || !selectedPlaylist || (activeTab !== 'youtube' && !hasSavedSocialCookies[activeTab] && !cookieFile)
                  ? 'bg-slate-300 dark:bg-slate-800 cursor-not-allowed text-slate-500 dark:text-slate-500'
                  : 'bg-indigo-600 hover:bg-indigo-700 shadow-sm hover:shadow-md hover:shadow-indigo-500/20 active:scale-[0.98]'
              }`}
            >
              {isAdding || isSavingActiveCookies ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> {isSavingActiveCookies ? 'Saving cookies...' : 'Adding to queue...'}</>
              ) : (
                <><Plus className="w-4 h-4" /> Add to Queue</>
              )}
            </button>

            {/* Go to Downloads */}
            <AnimatePresence>
              {hasQueued && (
                <motion.button
                  id="go-to-downloads-btn"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  onClick={handleGoToDownloads}
                  className="w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-200 border-2 border-indigo-200 text-indigo-700 hover:bg-indigo-50 hover:border-indigo-400 active:scale-[0.98]"
                >
                  <ArrowRight className="w-4 h-4" />
                  Go to Downloads ({queuedItems.length} queued)
                </motion.button>
              )}
            </AnimatePresence>
          </div>

          {/* Right: Queue Panel — shown after first item added */}
          <AnimatePresence>
            {hasQueued && (
              <motion.div
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 240, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                className="border-l border-slate-100 overflow-hidden flex-shrink-0"
              >
                <div className="w-60 h-full flex flex-col px-5 pb-8 pt-2">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                    Queued ({queuedItems.length})
                  </p>
                  <div className="space-y-2.5 overflow-y-auto flex-1 pr-1">
                    <AnimatePresence>
                      {queuedItems.map(item => {
                        const thumb = getYoutubeThumbnail(item.url);
                        return (
                          <motion.div
                            key={item.taskId}
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 20 }}
                            className="flex items-start gap-2.5 p-2.5 bg-slate-50 border border-slate-100 rounded-xl group"
                          >
                            {/* Thumbnail */}
                            <div className="w-14 h-10 rounded-lg overflow-hidden bg-slate-200 flex-shrink-0">
                              {thumb ? (
                                <img src={thumb} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center bg-slate-100 text-slate-400">
                                  {item.title.includes('Instagram') ? (
                                    <InstagramLogo className="w-4 h-4 text-pink-500" />
                                  ) : item.title.includes('X.com') ? (
                                    <TwitterLogo className="w-4 h-4 text-slate-700 fill-current" />
                                  ) : (
                                    <PlayCircle className="w-4 h-4 text-slate-400" />
                                  )}
                                </div>
                              )}
                            </div>
                            {/* Info */}
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-slate-800 line-clamp-2 leading-tight">
                                {item.title}
                              </p>
                              <div className="flex items-center gap-1 mt-1">
                                <Clock className="w-3 h-3 text-slate-400" />
                                <span className="text-[10px] text-slate-400">Queued</span>
                              </div>
                            </div>
                            {/* Remove */}
                            <button
                              onClick={() => removeFromLocalQueue(item.taskId)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-slate-300 hover:text-red-400 rounded-lg"
                              aria-label="Remove from list"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
      )}
    </AnimatePresence>
  );
}
