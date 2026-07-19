import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  X, Info, FolderPlus, FilePlus, RotateCw, RotateCcw, Clipboard, Copy,
  Scissors, Trash2, Folder, FileText, Music, Video, Image as ImageIcon, PenLine, ExternalLink, Sparkles
} from "lucide-react";
import type { ExplorerItem, ExplorerViewMode, Playlist, ItemDetails } from "./types";
import { FileSidebar } from "./FileSidebar";
import { FileToolbar } from "./FileToolbar";
import { FileGridview } from "./FileGridview";
import { UploadModal } from "./uploadmodal";
import { CarouselPreview } from "./Courasel";
import { ToastContainer, type ToastMessage } from "./Toast";
import { logActivity } from '../../utils/activityLogger';

interface FileExplorerProps {
  onBack?: () => void;
  playlistId?: string | null;
  playlistName?: string;
  onNavigatePlaylist?: (id: string, name: string) => void;
}

type ExplorerLocation = { id: string | null; name: string };
type ExplorerClipboard = {
  mode: "copy" | "cut";
  items: { id: string; type: ExplorerItem["type"]; name: string }[];
} | null;



export const FileExplorerContainer: React.FC<FileExplorerProps> = ({
  onBack,
  playlistId,
  playlistName,
  onNavigatePlaylist
}) => {
  const [items, setItems] = useState<ExplorerItem[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [fetchId, setFetchId] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<ExplorerClipboard>(null);
  const [viewMode, setViewModeState] = useState<ExplorerViewMode>(() => {
    const saved = localStorage.getItem("file_explorer_view_mode");
    return saved === "list" ? "list" : "grid";
  });
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [isLoadingFolder, setIsLoadingFolder] = useState(true);
  const [showSpinner, setShowSpinner] = useState(false);
  const spinnerTimerRef = useRef<any>(null);
  const [folderError, setFolderError] = useState<string | null>(null);

  // Navigation states
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const urlPlaylistId = params.get("playlistId");
    // Only read folderId from URL if the current playlist matches the URL playlist (e.g. on direct page load/refresh)
    if (urlPlaylistId && urlPlaylistId === playlistId) {
      return params.get("folderId") || null;
    }
    return null;
  });
  const [folderHistory, setFolderHistory] = useState<ExplorerLocation[]>([]);
  const [backStack, setBackStack] = useState<ExplorerLocation[]>([]);
  const [forwardStack, setForwardStack] = useState<ExplorerLocation[]>([]);

  const [sizeMultiplier, setSizeMultiplierState] = useState<number>(() => {
    const saved = Number(localStorage.getItem("file_explorer_size_multiplier"));
    return Number.isFinite(saved) ? Math.min(Math.max(saved, 0.6), 1.6) : 1.0;
  });
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [previewItemId, setPreviewItemId] = useState<string | null>(null);
  const explorerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fetchRequestIdRef = useRef(0);
  const isPerformingActionRef = useRef(false);
  const prevLocationRef = useRef<{ playlistId: string | null; folderId: string | null }>({
    playlistId: null,
    folderId: null
  });
  const abortControllerRef = useRef<AbortController | null>(null);
  const isFirstLoadRef = useRef(true);
  const dragCounterRef = useRef(0);
  const playlistNameRef = useRef(playlistName);
  useEffect(() => {
    playlistNameRef.current = playlistName;
  }, [playlistName]);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; itemId: string | null } | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showConfirmEmptyRecycle, setShowConfirmEmptyRecycle] = useState(false);
  const [detailsData, setDetailsData] = useState<ItemDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [generatingKnowledge, setGeneratingKnowledge] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastIdRef = useRef(0);
  const addToast = useCallback((text: string, type: ToastMessage["type"] = "info") => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, text, type }]);
  }, []);
  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Playlists & Sidebar Filters state
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [activeFilter, setActiveFilter] = useState<string>("all");

  const [prevPlaylistId, setPrevPlaylistId] = useState<string | null>(playlistId || null);
  if (playlistId !== prevPlaylistId) {
    setPrevPlaylistId(playlistId || null);
    setCurrentFolderId(null);
    setActiveFilter("all");
    setFolderHistory([{ id: null, name: playlistName || "Playlist" }]);
    setBackStack([]);
    setForwardStack([]);
  }

  const dragBoxStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragBoxInitialSelectionRef = useRef<string[]>([]);
  const hasDraggedRef = useRef(false);
  const [dragBox, setDragBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [dragHighlightIds, setDragHighlightIds] = useState<string[]>([]);

  const selectedIdsRef = useRef(selectedIds);
  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  const currentFolderIdRef = useRef(currentFolderId);
  useEffect(() => {
    currentFolderIdRef.current = currentFolderId;
  }, [currentFolderId]);

  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const setViewMode = useCallback((mode: ExplorerViewMode) => {
    localStorage.setItem("file_explorer_view_mode", mode);
    setViewModeState(mode);
  }, []);

  const setSizeMultiplier = useCallback((value: number) => {
    const nextValue = Math.min(Math.max(value, 0.6), 1.6);
    localStorage.setItem("file_explorer_size_multiplier", String(nextValue));
    setSizeMultiplierState(nextValue);
  }, []);

  const handlePasteRef = useRef<(() => Promise<void>) | null>(null);
  const canOpenDocumentIntelligence =
    detailsData?.itemType === "pdf" ||
    detailsData?.itemType === "audio" ||
    detailsData?.itemType === "video";
  const canGenerateKnowledge =
    detailsData?.itemType !== "folder" &&
    Boolean(detailsData?.knowledge?.eligible);
  const knowledgeState = detailsData?.knowledge;
  const knowledgeJobActive = ["waiting", "retrying_connection", "waiting_for_connection", "queued", "processing", "paused"].includes(
    knowledgeState?.job_status || ""
  );
  const knowledgeActionLabel = knowledgeState?.job_status === "waiting_for_connection"
    ? "Waiting for Connection"
    : knowledgeJobActive
      ? "Knowledge Extraction Queued"
    : knowledgeState?.job_status === "failed" || knowledgeState?.status === "failed"
      ? "Retry Knowledge Extraction"
    : knowledgeState?.status === "ready" || knowledgeState?.status === "ready_empty" || knowledgeState?.status === "stale"
        ? "Regenerate Knowledge"
        : "Generate Knowledge";

  const handleGenerateKnowledge = useCallback(async () => {
    if (selectedIds.length !== 1 || generatingKnowledge || knowledgeJobActive) return;
    setGeneratingKnowledge(true);
    try {
      const token = localStorage.getItem("access_token");
      const response = await fetch("/resources/" + selectedIds[0] + "/knowledge-runs", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Knowledge generation could not be queued");
      setDetailsData((current) => current ? {
        ...current,
        knowledge: data.knowledge,
        resource: current.resource ? {
          ...current.resource,
          knowledge_status: data.knowledge?.status,
        } : current.resource,
      } : current);
      window.dispatchEvent(new CustomEvent("pipeline-queue-refresh"));
      addToast("Knowledge extraction added to the pipeline", "success");
    } catch (error) {
      addToast(error instanceof Error ? error.message : "Knowledge generation failed", "error");
    } finally {
      setGeneratingKnowledge(false);
    }
  }, [addToast, generatingKnowledge, knowledgeJobActive, selectedIds]);

  // Fetch Playlists from backend
  const fetchPlaylists = useCallback(async () => {
    try {
      const token = localStorage.getItem('access_token');
      const response = await fetch('/playlists', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setPlaylists(data);
      }
    } catch (err) {
      console.error("Failed to fetch playlists:", err);
    }
  }, []);

  useEffect(() => {
    fetchPlaylists();
  }, [fetchPlaylists]);

  const handleCreatePlaylist = useCallback(async (name: string) => {
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch('/playlists', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error("Failed to create playlist");
      await fetchPlaylists();
      logActivity('playlist', 'Created playlist', name);
      addToast("Playlist created", "success");
    } catch (err) {
      console.error("Create playlist failed:", err);
      addToast("Failed to create playlist", "error");
    }
  }, [fetchPlaylists, addToast]);

  const handleRenamePlaylist = useCallback(async (id: string, name: string) => {
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`/playlists/${id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error("Failed to rename playlist");
      await fetchPlaylists();
      addToast("Playlist renamed", "success");
    } catch (err) {
      console.error("Rename playlist failed:", err);
      addToast("Failed to rename playlist", "error");
    }
  }, [fetchPlaylists, addToast]);

  const handleDeletePlaylist = useCallback(async (id: string) => {
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`/playlists/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to delete playlist");
      if (playlistId === id) {
        onBack?.();
      }
      await fetchPlaylists();
      addToast("Playlist deleted", "success");
    } catch (err) {
      console.error("Delete playlist failed:", err);
      addToast("Failed to delete playlist", "error");
    }
  }, [fetchPlaylists, addToast, playlistId, onBack]);

  // Debounce search query — only update debounced value 300ms after user stops typing
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Breadcrumbs history is initialized synchronously during render on playlist change

  const fetchItems = useCallback(async (isManualRefresh = false, force = false) => {
    console.log(`[TABS] ▶ fetchItems START | filter: ${activeFilter} | folder: ${currentFolderId || "root"} | search: "${debouncedSearchQuery}" | playlist: ${playlistId}`);
    if (!playlistId) return;

    const requestId = ++fetchRequestIdRef.current;

    // Abort previous running request if any
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();



    // Only reset animation if we are actually switching folders or playlists
    const isFolderChange = prevLocationRef.current.playlistId !== playlistId || prevLocationRef.current.folderId !== currentFolderId;
    prevLocationRef.current = { playlistId, folderId: currentFolderId };

    setIsLoadingFolder(true);
    if (isManualRefresh) {
      setIsRefreshing(true);
    }
    setFolderError(null);

    // Setup delayed spinner so fast requests feel smooth and instant
    if (spinnerTimerRef.current) clearTimeout(spinnerTimerRef.current);
    setShowSpinner(false);

    spinnerTimerRef.current = setTimeout(() => {
      if (fetchRequestIdRef.current === requestId) {
        setShowSpinner(true);
      }
    }, 200);

    try {
      const token = localStorage.getItem('access_token');
      const headers = { 'Authorization': `Bearer ${token}` };

      const params = new URLSearchParams({ playlist_id: playlistId });
      const isMediaFilter = ["documents", "audio", "images", "videos", "music", "pictures"].includes(activeFilter);
      if (isMediaFilter) {
        params.set("recursive", "true");
      } else {
        if (currentFolderId && activeFilter !== "recycle") params.set("folder_id", currentFolderId);
      }
      if (debouncedSearchQuery.trim()) {
        params.set("q", debouncedSearchQuery.trim());
        params.set("recursive", "true");
      }
      if (activeFilter === "recycle") params.set("recycle_bin", "true");

      const response = await fetch(`/explorer?${params.toString()}`, {
        headers,
        signal: abortControllerRef.current.signal
      });

      if (spinnerTimerRef.current) clearTimeout(spinnerTimerRef.current);
      setShowSpinner(false);

      if (!response.ok) {
        if (response.status === 404) {
          addToast("This playlist was not found. It may have been deleted or unshared by the owner.", "error");
          onBack?.();
          return;
        }
        throw new Error("Failed to load folder contents");
      }
      const data = await response.json();

      if (requestId !== fetchRequestIdRef.current) return;

      const levelFolders = data.folders || [];
      const folderResources = data.resources || [];

      // Map folders and resources to ExplorerItem type
      const explorerFolders: ExplorerItem[] = levelFolders.map((f: any) => ({
        id: f.id,
        name: f.name === 'root' ? 'resources' : f.name,
        type: 'folder',
        modifiedDate: f.created_at ? f.created_at.split('T')[0] : new Date().toISOString().split('T')[0]
      }));

      const explorerResources: ExplorerItem[] = folderResources.map((r: any) => {
        let expType: 'image' | 'video' | 'audio' | 'pdf' | 'file' = 'file';
        const typeLower = (r.type || '').toLowerCase();

        if (typeLower.includes('image') || ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(typeLower)) {
          expType = 'image';
        } else if (typeLower.includes('video') || typeLower === 'youtube' || ['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(typeLower)) {
          expType = 'video';
        } else if (typeLower.includes('audio') || ['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a'].includes(typeLower)) {
          expType = 'audio';
        } else if (typeLower === 'pdf') {
          expType = 'pdf';
        }

        let sizeStr = undefined;
        if (r.file_size) {
          sizeStr = `${(r.file_size / (1024 * 1024)).toFixed(1)} MB`;
        }

        return {
          id: r.id,
          name: r.title,
          type: expType,
          size: sizeStr,
          modifiedDate: r.created_at ? r.created_at.split('T')[0] : new Date().toISOString().split('T')[0],
          thumbnailUrl: r.thumbnail_path || undefined,
          previewUrl: r.preview_url || undefined,
          previewStatus: r.preview_status || undefined,
          is_note: r.is_note,
          is_embedded: r.is_embedded,
          processing_status: r.processing_status
        };
      });

      // Just set items. New items will naturally mount and play their enter animation.
      // We pass the fetchId to force re-render if it's a manual refresh.
      setItems([...explorerFolders, ...explorerResources]);
      setIsTransitioning(false);
      setFetchId(requestId);
      console.log(`[TABS] ✅ fetchItems DONE | filter: ${activeFilter} | folders: ${explorerFolders.length} | resources: ${explorerResources.length} | total: ${explorerFolders.length + explorerResources.length}`);

      const history = [
        { id: null, name: playlistNameRef.current || data.playlist?.name || "Playlist" },
        ...(data.breadcrumbs || []).map((folder: any) => ({
          id: folder.id,
          name: folder.name === "root" ? "resources" : folder.name,
        })),
      ];
      setFolderHistory(history);

      // Pre-populate backStack if empty and we loaded a nested folder
      setBackStack(prev => {
        if (prev.length === 0 && history.length > 1) {
          return history.slice(0, -1);
        }
        return prev;
      });
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log(`[TABS] ⏹ fetchItems ABORTED (new request superseded) | filter: ${activeFilter}`);
        return;
      }
      if (spinnerTimerRef.current) clearTimeout(spinnerTimerRef.current);
      setShowSpinner(false);
      console.error("Failed to fetch items:", error);
      if (requestId === fetchRequestIdRef.current) {
        setFolderError(error instanceof Error ? error.message : "Failed to load folder");
      }
    } finally {
      if (requestId === fetchRequestIdRef.current) {
        setIsRefreshing(false);
        setIsLoadingFolder(false);
      }
    }
  }, [playlistId, currentFolderId, debouncedSearchQuery, activeFilter]);

  useEffect(() => {
    console.log(`[TABS] 🔄 useEffect triggered | filter: ${activeFilter} | folder: ${currentFolderId || "root"} | search: "${debouncedSearchQuery}"`);
    setIsTransitioning(true);
    fetchItems();
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [playlistId, currentFolderId, debouncedSearchQuery, activeFilter]);

  // Set transitioning immediately when raw searchQuery changes — covers the debounce gap
  useEffect(() => {
    setIsTransitioning(true);
  }, [searchQuery]);

  // Auto-refresh when external changes are synced
  useEffect(() => {
    const handleExternalRefresh = () => {
      fetchItems(false, true);
    };
    window.addEventListener('refresh-playlists', handleExternalRefresh);
    return () => window.removeEventListener('refresh-playlists', handleExternalRefresh);
  }, [fetchItems]);

  useEffect(() => {
    setSelectedId(null);
    setSelectedIds([]);
    setLastSelectedId(null);
    setPreviewItemId(null);
  }, [playlistId, currentFolderId]);

  // Fetch details for selected item when pane is open
  useEffect(() => {
    if (!showDetails || selectedIds.length !== 1) {
      setDetailsData(null);
      return;
    }
    const targetId = selectedIds[0];
    const item = items.find(i => i.id === targetId);
    if (!item) return;

    let active = true;
    const fetchItemDetails = async () => {
      setLoadingDetails(true);
      try {
        const token = localStorage.getItem('access_token');
        const url = item.type === 'folder'
          ? `/folders/${targetId}/details`
          : `/resources/${targetId}/details`;
        const res = await fetch(url, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error("Failed to load details");
        const data = await res.json();
        if (active) {
          setDetailsData({
            ...data,
            itemType: item.type,
            itemName: item.name,
            itemSize: item.size
          });
        }
      } catch (err) {
        console.error("Details fetch error:", err);
      } finally {
        if (active) setLoadingDetails(false);
      }
    };

    fetchItemDetails();
    return () => {
      active = false;
    };
  }, [showDetails, selectedIds, items]);

  // Context Menu Position handler
  const handleContextMenu = (e: React.MouseEvent, itemId: string | null) => {
    e.preventDefault();
    e.stopPropagation();

    if (itemId) {
      if (!selectedIds.includes(itemId)) {
        setSelection([itemId]);
        setLastSelectedId(itemId);
      }
    } else {
      setSelection([]);
      setLastSelectedId(null);
    }

    setContextMenu({
      x: Math.min(e.clientX, window.innerWidth - 232),
      y: Math.min(e.clientY, window.innerHeight - 258),
      itemId
    });
  };

  // Close context menu on global click
  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      if (contextMenu && !contextMenuRef.current?.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    window.addEventListener("click", handleGlobalClick);
    return () => window.removeEventListener("click", handleGlobalClick);
  }, [contextMenu]);

  // Drag and drop handler
  const handleMoveItems = async (sourceIds: string[], targetFolderId: string | null) => {
    if (activeFilter === "recycle") return;
    if (!playlistId) return;
    const moveIds = sourceIds.filter(id => id !== targetFolderId);
    if (moveIds.length === 0) return;

    isPerformingActionRef.current = true;
    const currentItems = itemsRef.current;
    const payload = {
      resource_ids: currentItems.filter(item => moveIds.includes(item.id) && item.type !== "folder").map(item => item.id),
      folder_ids: currentItems.filter(item => moveIds.includes(item.id) && item.type === "folder").map(item => item.id),
      target_folder_id: targetFolderId,
      target_playlist_id: targetFolderId ? undefined : playlistId,
    };

    const token = localStorage.getItem('access_token');
    try {
      const response = await fetch("/explorer/move", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error("Move failed");
      setSelection([]);
      await fetchItems(false);
      logActivity('resource', `Moved ${moveIds.length} item${moveIds.length > 1 ? 's' : ''}`);
      addToast(`${moveIds.length} item${moveIds.length > 1 ? "s" : ""} moved`, "success");
    } catch (err) {
      console.error("Failed to move items:", err);
      addToast("Failed to move items", "error");
    } finally {
      isPerformingActionRef.current = false;
    }
  };



  const handleRefresh = async () => {
    isPerformingActionRef.current = true;
    setIsRefreshing(true);

    try {
      if (playlistId) {
        try {
          const token = localStorage.getItem('access_token');
          await fetch(`/playlists/${playlistId}/refresh`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
          });
        } catch (err) {
          console.error("Failed to sync physical files:", err);
        }
      }

      await fetchItems(true, true);
    } finally {
      isPerformingActionRef.current = false;
    }
  };

  // Window-level drag and drop file upload trigger
  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer?.types.includes("Files")) {
        dragCounterRef.current++;
        setIsDragOver(true);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current--;
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0;
        setIsDragOver(false);
      }
    };

    const handleDrop = (e: DragEvent) => {
      // Only handle external file drops (from OS file manager)
      // Internal drag-and-drop (moving items between folders) should reach the folder's onDrop
      if (!e.dataTransfer?.files || e.dataTransfer.files.length === 0) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragOver(false);

      const filesArray = Array.from(e.dataTransfer.files);
      setUploadFiles(filesArray);
    };

    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("drop", handleDrop);
    return () => {
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("drop", handleDrop);
    };
  }, []);

  const setSelection = useCallback((ids: string[]) => {
    setSelectedIds(ids);
    setSelectedId(ids[ids.length - 1] || null);
  }, []);

  // Clear selections when switching filters / tabs on the sidebar
  useEffect(() => {
    setSelection([]);
  }, [activeFilter, setSelection]);

  const currentLocation = useCallback((): ExplorerLocation => {
    return folderHistory[folderHistory.length - 1] || { id: null, name: playlistName || "Playlist" };
  }, [folderHistory, playlistName]);

  const navigateToLocation = useCallback((location: ExplorerLocation, trackHistory = true) => {
    if (location.id === currentFolderId) return;
    if (trackHistory) {
      setBackStack(prev => [...prev, currentLocation()]);
      setForwardStack([]);
    }
    setCurrentFolderId(location.id);
  }, [currentFolderId, currentLocation]);

  const handleUpload = async (files: File[]) => {
    if (!playlistId) return;

    isPerformingActionRef.current = true;
    try {
      const token = localStorage.getItem('access_token');
      const existingNames = new Set(items.map(i => i.name.toLowerCase()));
      let skippedCount = 0;
      const failedUploads: string[] = [];
      let uploadedCount = 0;
      for (const file of files) {
        if (existingNames.has(file.name.toLowerCase())) {
          skippedCount++;
          continue;
        }
        const formData = new FormData();
        formData.append("file", file);

        const url = currentFolderId
          ? `/resources/upload?folder_id=${currentFolderId}`
          : `/resources/upload?playlist_id=${playlistId}`;

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          },
          body: formData
        });
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const detail = typeof errorData?.detail === "string" ? errorData.detail : `HTTP ${response.status}`;
          console.error("Failed to upload file:", file.name, detail);
          failedUploads.push(`${file.name}: ${detail}`);
          continue;
        }
        uploadedCount++;
      }
      await fetchItems(false);
      if (skippedCount > 0) {
        addToast(`${skippedCount} file${skippedCount > 1 ? "s" : ""} skipped (already exist)`, "info");
      }
      if (uploadedCount > 0) {
        logActivity('upload', `Uploaded ${uploadedCount} file${uploadedCount > 1 ? 's' : ''}`);
        addToast(
          uploadedCount === files.length
            ? "Files uploaded successfully"
            : `${uploadedCount} file${uploadedCount > 1 ? "s" : ""} uploaded successfully`,
          "success"
        );
      }
      if (failedUploads.length > 0) {
        addToast(
          failedUploads.length === 1
            ? failedUploads[0]
            : `${failedUploads.length} uploads failed. Check console for details.`,
          "error"
        );
      }
    } catch (error) {
      console.error("Upload failed:", error);
      addToast("Upload failed", "error");
    } finally {
      isPerformingActionRef.current = false;
    }
  };

  const handleBreadcrumbClick = (index: number) => {
    const target = folderHistory[index];
    if (target) {
      navigateToLocation(target);
    }
  };

  const handleBackArrowClick = () => {
    const target = backStack[backStack.length - 1];
    if (!target) return;
    setBackStack(prev => prev.slice(0, -1));
    setForwardStack(prev => [currentLocation(), ...prev]);
    setCurrentFolderId(target.id);
  };

  const handleForwardArrowClick = () => {
    const target = forwardStack[0];
    if (!target) return;
    setForwardStack(prev => prev.slice(1));
    setBackStack(prev => [...prev, currentLocation()]);
    setCurrentFolderId(target.id);
  };

  const handleItemDoubleClick = (item: ExplorerItem) => {
    if (activeFilter === "recycle") {
      addToast("Please restore this item to open it.", "info");
      return;
    }
    if (item.is_note) {
      localStorage.setItem('open_note_id', item.id);
      window.dispatchEvent(new CustomEvent('open-notebook-view'));
      return;
    }
    if (item.type === "folder") {
      navigateToLocation({ id: item.id, name: item.name });
    } else {
      setPreviewItemId(item.id);
    }
  };

  const handleSelectItem = (id: string, event?: React.MouseEvent) => {
    if (event?.shiftKey && lastSelectedId) {
      const startIndex = filteredItems.findIndex(item => item.id === lastSelectedId);
      const endIndex = filteredItems.findIndex(item => item.id === id);
      if (startIndex >= 0 && endIndex >= 0) {
        const [from, to] = startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
        setSelection(filteredItems.slice(from, to + 1).map(item => item.id));
      }
    } else if (event?.ctrlKey || event?.metaKey) {
      setSelection(
        selectedIds.includes(id)
          ? selectedIds.filter(selectedItemId => selectedItemId !== id)
          : [...selectedIds, id]
      );
      setLastSelectedId(id);
    } else {
      setSelection([id]);
      setLastSelectedId(id);
    }
  };

  const selectedItems = items.filter(item => selectedIds.includes(item.id));

  const handleCopySelection = () => {
    if (selectedItems.length > 0) {
      setClipboard({ mode: "copy", items: selectedItems.map(item => ({ id: item.id, type: item.type, name: item.name })) });
    }
  };

  const handleCutSelection = () => {
    if (selectedItems.length > 0) {
      setClipboard({ mode: "cut", items: selectedItems.map(item => ({ id: item.id, type: item.type, name: item.name })) });
    }
  };

  const handlePaste = async () => {
    if (!clipboard || !playlistId) return;
    isPerformingActionRef.current = true;

    const currentItems = itemsRef.current;
    const targetFolderId = currentFolderIdRef.current;
    const existingNames = new Set(currentItems.map(i => i.name.toLowerCase()));
    const clipboardNames = clipboard.items.map(ci => {
      return { ...ci, name: ci.name?.toLowerCase() || "" };
    });
    const duplicates = clipboardNames.filter(ci => ci.name && existingNames.has(ci.name));
    const toPaste = clipboardNames.filter(ci => !ci.name || !existingNames.has(ci.name));

    if (duplicates.length > 0) {
      addToast(`${duplicates.length} item${duplicates.length > 1 ? "s" : ""} skipped (already exist here)`, "info");
    }
    if (toPaste.length === 0) {
      isPerformingActionRef.current = false;
      return;
    }

    const payload = {
      resource_ids: toPaste.filter(item => item.type !== "folder").map(item => item.id),
      folder_ids: toPaste.filter(item => item.type === "folder").map(item => item.id),
      target_folder_id: targetFolderId,
      target_playlist_id: targetFolderId ? undefined : playlistId,
    };
    const token = localStorage.getItem('access_token');
    try {
      const response = await fetch(clipboard.mode === "cut" ? "/explorer/move" : "/explorer/copy", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error("Paste failed");
      if (clipboard.mode === "cut") setClipboard(null);
      await fetchItems(false);
      logActivity('resource', `Pasted ${clipboard.mode === 'cut' ? 'moved' : 'copied'} ${toPaste.length} item${toPaste.length > 1 ? 's' : ''}`);
      addToast(`Items ${clipboard.mode === "cut" ? "moved" : "copied"} successfully`, "success");
    } catch (err) {
      console.error("Paste failed:", err);
      addToast("Paste failed", "error");
    } finally {
      isPerformingActionRef.current = false;
    }
  };
  handlePasteRef.current = handlePaste;

  const handleDeleteSelection = async () => {
    if (selectedItems.length === 0) return;
    isPerformingActionRef.current = true;
    const token = localStorage.getItem('access_token');
    try {
      let hasError = false;
      for (const item of selectedItems) {
        const res = await fetch(item.type === "folder" ? `/folders/${item.id}` : `/resources/${item.id}`, {
          method: "DELETE",
          headers: { "Authorization": `Bearer ${token}` },
        });
        if (!res.ok) hasError = true;
      }
      setSelection([]);
      if (hasError) addToast("Some items could not be deleted", "error");
      else {
        logActivity('resource', `Deleted ${selectedItems.length} item${selectedItems.length > 1 ? 's' : ''}`);
        addToast("Items deleted", "success");
      }
    } catch (err) {
      console.error("Delete failed:", err);
      addToast("Failed to delete items", "error");
    } finally {
      await fetchItems(false);
      isPerformingActionRef.current = false;
    }
  };

  const handleRestoreSelection = async () => {
    if (selectedItems.length === 0) return;
    isPerformingActionRef.current = true;
    const token = localStorage.getItem('access_token');
    const payload = {
      resource_ids: selectedItems.filter(item => item.type !== "folder").map(item => item.id),
      folder_ids: selectedItems.filter(item => item.type === "folder").map(item => item.id),
    };
    try {
      const response = await fetch("/explorer/restore", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error("Failed to restore selection");
      setSelection([]);
      await fetchItems(false);
      logActivity('resource', `Restored ${selectedItems.length} item${selectedItems.length > 1 ? 's' : ''}`);
      addToast("Items restored", "success");
    } catch (err) {
      console.error("Restore selection failed:", err);
      addToast("Failed to restore items", "error");
    } finally {
      isPerformingActionRef.current = false;
    }
  };

  const handleEmptyRecycleBin = () => {
    if (!playlistId || filteredItems.length === 0) return;
    setShowConfirmEmptyRecycle(true);
  };

  const executeEmptyRecycleBin = async () => {
    if (!playlistId) return;
    isPerformingActionRef.current = true;
    const token = localStorage.getItem('access_token');
    try {
      const response = await fetch("/explorer/empty-recycle-bin", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ playlist_id: playlistId }),
      });
      if (!response.ok) throw new Error("Failed to empty recycle bin");
      setSelection([]);
      await fetchItems(false);
      logActivity('resource', 'Emptied recycle bin');
      addToast("Recycle bin emptied", "success");
    } catch (err) {
      console.error("Empty recycle bin failed:", err);
      addToast("Failed to empty recycle bin", "error");
    } finally {
      isPerformingActionRef.current = false;
    }
  };

  const handleSelectAll = () => {
    setSelection(filteredItems.map(item => item.id));
  };

  const handleCreateFolder = () => {
    const newTempFolder: ExplorerItem = {
      id: "temp_new_folder_" + Date.now(),
      name: "New Folder",
      type: "folder",
      modifiedDate: new Date().toISOString().split('T')[0],
      isEditing: true
    };

    setItems(prev => [newTempFolder, ...prev]);
  };

  const handleCreateFile = () => {
    const newTempFile: ExplorerItem = {
      id: "temp_new_file_" + Date.now(),
      name: "new file.md",
      type: "file",
      modifiedDate: new Date().toISOString().split('T')[0],
      isEditing: true
    };

    setItems(prev => [newTempFile, ...prev]);
  };

  const handleRenameFolder = async (id: string, name: string) => {
    const finalName = name.trim() || "New Folder";
    isPerformingActionRef.current = true;

    // Check for duplicate name (skip the item being renamed itself)
    const duplicateExists = items.some(i => i.id !== id && i.name.toLowerCase() === finalName.toLowerCase());
    if (duplicateExists) {
      addToast(`"${finalName}" already exists in this folder`, "error");
      isPerformingActionRef.current = false;
      return;
    }

    try {
      if (id.startsWith("temp_new_folder_")) {
        if (!playlistId) return;
        try {
          const token = localStorage.getItem('access_token');
          const parentParam = currentFolderId ? `&parent_id=${currentFolderId}` : '';
          const res = await fetch(`/folders?name=${encodeURIComponent(finalName)}&playlist_id=${playlistId}${parentParam}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });
          if (!res.ok) throw new Error("Failed to create folder");
          await fetchItems(false);
          logActivity('resource', `Created folder "${finalName}"`);
          addToast("Folder created", "success");
        } catch (err) {
          console.error("Folder creation failed:", err);
          addToast("Failed to create folder", "error");
          await fetchItems(false); // remove the temp item
        }
      } else if (id.startsWith("temp_new_file_")) {
        // Creating a new file
        if (!playlistId) return;
        const finalFileName = name.endsWith('.md') ? name : `${name}.md`;
        try {
          const token = localStorage.getItem('access_token');
          const parentParam = currentFolderId ? `?folder_id=${currentFolderId}` : `?playlist_id=${playlistId}`;
          const res = await fetch(`/files/create${parentParam}&filename=${encodeURIComponent(finalFileName)}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });
          if (!res.ok) throw new Error("Failed to create file");
          await fetchItems(false);
          logActivity('resource', `Created file "${finalFileName}"`);
          addToast("File created", "success");
        } catch (err) {
          console.error("File creation failed:", err);
          addToast("Failed to create file", "error");
          await fetchItems(false);
        }
      } else {
        // Renaming an existing folder or file
        try {
          const token = localStorage.getItem('access_token');
          const isFolder = items.find(i => i.id === id)?.type === 'folder';
          const url = isFolder
            ? `/folders/${id}?name=${encodeURIComponent(finalName)}`
            : `/resources/${id}/title?title=${encodeURIComponent(finalName)}&new_filename=${encodeURIComponent(finalName)}`;

          const res = await fetch(url, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });
          if (!res.ok) throw new Error("Failed to rename item");
          await fetchItems(false);
          logActivity('resource', `Renamed to "${finalName}"`);
          addToast("Renamed successfully", "success");
        } catch (err) {
          console.error("Rename failed:", err);
          addToast("Failed to rename item", "error");
          await fetchItems(false);
        }
      }
    } finally {
      isPerformingActionRef.current = false;
    }
  };

  const sortedItems = React.useMemo(() => [...items].sort((a, b) => {
    if (activeFilter === "recent") {
      return (b.modifiedDate || "").localeCompare(a.modifiedDate || "");
    }
    return sortOrder === "asc"
      ? a.name.localeCompare(b.name)
      : b.name.localeCompare(a.name);
  }), [items, activeFilter, sortOrder]);

  const filteredItems = React.useMemo(() => sortedItems.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(debouncedSearchQuery.toLowerCase());
    if (!matchesSearch) return false;

    if (activeFilter === "all") return true;
    if (activeFilter === "recent") return true;
    if (activeFilter === "recycle") return true;

    // Media type filters
    if (activeFilter === "documents") {
      return item.type === "pdf" ||
        item.is_note ||
        item.name.toLowerCase().endsWith(".pdf") ||
        item.name.toLowerCase().endsWith(".docx") ||
        item.name.toLowerCase().endsWith(".md");
    }
    if (activeFilter === "images" || activeFilter === "pictures") return item.type === "image";
    if (activeFilter === "videos") return item.type === "video";
    if (activeFilter === "audio" || activeFilter === "music") return item.type === "audio";

    return true;
  }), [sortedItems, debouncedSearchQuery, activeFilter]);
  const visibleItems = filteredItems;

  // Mouse drag-select box implementation
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!dragBoxStartRef.current) return;

      const startX = dragBoxStartRef.current.x;
      const startY = dragBoxStartRef.current.y;
      const currentX = e.clientX;
      const currentY = e.clientY;

      const left = Math.min(startX, currentX);
      const top = Math.min(startY, currentY);
      const width = Math.abs(startX - currentX);
      const height = Math.abs(startY - currentY);

      if (width > 5 || height > 5) {
        hasDraggedRef.current = true;
      }

      setDragBox({ left, top, width, height });

      const right = left + width;
      const bottom = top + height;

      const itemElements = explorerRef.current?.querySelectorAll('[data-grid-item="true"]');
      const intersectingIds: string[] = [];

      if (itemElements) {
        itemElements.forEach((el) => {
          const rect = el.getBoundingClientRect();
          const overlaps = !(
            rect.right < left ||
            rect.left > right ||
            rect.bottom < top ||
            rect.top > bottom
          );
          if (overlaps) {
            const id = el.getAttribute('data-id');
            if (id) intersectingIds.push(id);
          }
        });
      }

      if (e.ctrlKey || e.metaKey) {
        const newSelection = new Set(dragBoxInitialSelectionRef.current);
        intersectingIds.forEach(id => newSelection.add(id));
        setSelection(Array.from(newSelection));
      } else {
        setSelection(intersectingIds);
      }
      setDragHighlightIds(intersectingIds);
    };

    const handleGlobalMouseUp = () => {
      dragBoxStartRef.current = null;
      setDragBox(null);
      setDragHighlightIds([]);
    };

    window.addEventListener("mousemove", handleGlobalMouseMove);
    window.addEventListener("mouseup", handleGlobalMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleGlobalMouseMove);
      window.removeEventListener("mouseup", handleGlobalMouseUp);
    };
  }, [filteredItems, setSelection]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only left click
    hasDraggedRef.current = false;

    const target = e.target as HTMLElement;
    if (
      target.closest('button') ||
      target.closest('input') ||
      target.closest('[data-grid-item="true"]') ||
      target.closest('.no-drag-select') ||
      target.closest('.CarouselPreview')
    ) {
      return;
    }

    dragBoxStartRef.current = { x: e.clientX, y: e.clientY };
    dragBoxInitialSelectionRef.current = e.ctrlKey || e.metaKey ? selectedIdsRef.current : [];
  };

  const scrollItemIndexIntoView = useCallback((index: number) => {
    const scroller = explorerRef.current?.querySelector(".hide-scrollbar") as HTMLElement | null;
    if (!scroller || index < 0) return;

    if (viewMode === "list") {
      const rowHeight = Math.max(40, 44 * sizeMultiplier);
      const targetTop = index * rowHeight;
      const targetBottom = targetTop + rowHeight;
      if (targetTop < scroller.scrollTop) {
        scroller.scrollTop = Math.max(0, targetTop - rowHeight * 2);
      } else if (targetBottom > scroller.scrollTop + scroller.clientHeight) {
        scroller.scrollTop = targetBottom - scroller.clientHeight + rowHeight * 2;
      }
      return;
    }

    const minColWidth = Math.max(100, 120 * sizeMultiplier);
    const gap = 20;
    const columns = Math.max(1, Math.floor((scroller.clientWidth - 64 + gap) / (minColWidth + gap)));
    const rowHeight = minColWidth + Math.max(64, 72 * sizeMultiplier) + 24;
    const rowIndex = Math.floor(index / columns);
    const targetTop = rowIndex * rowHeight;
    const targetBottom = targetTop + rowHeight;
    if (targetTop < scroller.scrollTop) {
      scroller.scrollTop = Math.max(0, targetTop - rowHeight);
    } else if (targetBottom > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTop = targetBottom - scroller.clientHeight + rowHeight;
    }
  }, [sizeMultiplier, viewMode]);

  // Global KeyDown listeners for Explorer actions (F2, Del, Copy/Cut/Paste/SelectAll)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Dismiss context menu with Escape
      if (event.key === 'Escape' && contextMenu) {
        event.preventDefault();
        setContextMenu(null);
        return;
      }

      // Ignore keyboard commands if user is editing/typing in inputs or modals
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.getAttribute('contenteditable') === 'true')) {
        return;
      }

      // Select All: Ctrl+A
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        handleSelectAll();
        return;
      }

      // Copy: Ctrl+C
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        handleCopySelection();
        return;
      }

      // Cut: Ctrl+X
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'x') {
        event.preventDefault();
        handleCutSelection();
        return;
      }

      // Paste: Ctrl+V
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        handlePasteRef.current?.();
        return;
      }

      // Delete key
      if (event.key === 'Delete') {
        event.preventDefault();
        handleDeleteSelection();
        return;
      }

      // Rename: F2
      if (event.key === 'F2') {
        event.preventDefault();
        if (selectedId) {
          setItems(prev => prev.map(item => item.id === selectedId ? { ...item, isEditing: true } : item));
        }
        return;
      }

      // Sizing Zoom Hotkeys: Shift + (+/-)
      if (event.shiftKey && (event.key === "+" || event.key === "=" || event.key === "-" || event.key === "_")) {
        event.preventDefault();
        const shift = (event.key === "+" || event.key === "=") ? 0.1 : -0.1;
        setSizeMultiplier(sizeMultiplier + shift);
        return;
      }

      const isVertical = event.key === "ArrowUp" || event.key === "ArrowDown";
      const isHorizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";

      if (isVertical || isHorizontal) {
        event.preventDefault();
        if (visibleItems.length === 0) return;
        if (selectedId === null) {
          setSelectedId(visibleItems[0].id);
          setSelectedIds([visibleItems[0].id]);
          scrollItemIndexIntoView(0);
          return;
        }

        const currentIndex = visibleItems.findIndex((i) => i.id === selectedId);
        let nextIndex = currentIndex;

        if (viewMode === "list") {
          if (event.key === "ArrowUp") nextIndex = currentIndex > 0 ? currentIndex - 1 : visibleItems.length - 1;
          else if (event.key === "ArrowDown") nextIndex = currentIndex < visibleItems.length - 1 ? currentIndex + 1 : 0;
        } else {
          const containerWidth = explorerRef.current?.getBoundingClientRect().width || 1000;
          const minColWidth = Math.max(100, 120 * sizeMultiplier);
          const gap = 20;
          const columns = Math.max(1, Math.floor((containerWidth - 64) / (minColWidth + gap)));

          if (event.key === "ArrowUp") nextIndex = Math.max(0, currentIndex - columns);
          else if (event.key === "ArrowDown") nextIndex = Math.min(visibleItems.length - 1, currentIndex + columns);
          else if (event.key === "ArrowLeft") nextIndex = Math.max(0, currentIndex - 1);
          else if (event.key === "ArrowRight") nextIndex = Math.min(sortedItems.length - 1, currentIndex + 1);
        }

        if (nextIndex !== currentIndex) {
          setSelectedId(visibleItems[nextIndex].id);
          setSelectedIds([visibleItems[nextIndex].id]);
          scrollItemIndexIntoView(nextIndex);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedId, visibleItems, viewMode, sizeMultiplier, clipboard, contextMenu, setSizeMultiplier, scrollItemIndexIntoView]);

  const handleWorkspaceClick = (e: React.MouseEvent) => {
    if (hasDraggedRef.current) {
      hasDraggedRef.current = false;
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      return;
    }
    if ((e.target as HTMLElement).classList.contains('deselect-area')) {
      setSelection([]);
    }
  };

  const handleWheel = (e: WheelEvent) => {
    if (e.shiftKey) {
      e.preventDefault();
      const shift = e.deltaY < 0 ? 0.08 : -0.08;
      setSizeMultiplier(sizeMultiplier + shift);
    }
  };

  return (
    <div className={`fixed inset-0 w-screen h-screen overflow-hidden flex bg-[#f7f8fc] ${isDragOver ? 'ring-4 ring-blue-400 ring-inset' : ''}`}>
      <style dangerouslySetInnerHTML={{
        __html: `
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        .deselect-area { height: 100%; width: 100%; }

        @keyframes slideInRightSpring { from { opacity: 0; transform: translateX(30px) scale(0.97); } to { opacity: 1; transform: translateX(0) scale(1); } }
        .animate-details-spring { animation: slideInRightSpring 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
        @keyframes scaleIn { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        .animate-scaleIn { animation: scaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards; }

        .grid-item-card { opacity: 1; transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); }
        .folder-icon-wrapper { transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); }
        .folder-sheet { transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); }
        .grid-item-row { opacity: 1; transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); }

        .sidebar-item-btn { transition: all 0.3s ease; }
        .sidebar-item-indicator { transition: all 0.3s ease; }

        @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        .animate-shimmer { animation: shimmer 1.2s linear infinite; }
      `}} />
      <div ref={explorerRef} className="flex-1 flex overflow-hidden border-none">
        <div className="h-full overflow-hidden">
          <FileSidebar
            currentPath={folderHistory.map(h => h.name)}
            playlists={playlists}
            activePlaylistId={playlistId}
            onSelectPlaylist={(id, name) => {
              if (String(id) === String(playlistId)) return;
              setIsTransitioning(true);
              setItems([]);
              setSelection([]);
              setPreviewItemId(null);
              onNavigatePlaylist?.(id, name);
            }}
            activeFilter={activeFilter}
            onSelectFilter={(filter) => {
              if (filter === activeFilter) return;
              setIsTransitioning(true);
              setItems([]);
              setSelection([]);
              setPreviewItemId(null);
              setActiveFilter(filter);
            }}
            onCreatePlaylist={handleCreatePlaylist}
            onRenamePlaylist={handleRenamePlaylist}
            onDeletePlaylist={handleDeletePlaylist}
          />
        </div>
        <div
          onClick={handleWorkspaceClick}
          className="flex-1 bg-white flex flex-col min-w-0 deselect-area overflow-hidden"
        >
          <FileToolbar
            currentPath={folderHistory.map(h => h.name)}
            sizeMultiplier={sizeMultiplier}
            setSizeMultiplier={setSizeMultiplier}
            viewMode={viewMode}
            setViewMode={setViewMode}
            sortOrder={sortOrder}
            setSortOrder={setSortOrder}
            onRefresh={handleRefresh}
            isRefreshing={isRefreshing}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            onClose={onBack}
            onBreadcrumbClick={handleBreadcrumbClick}
            onBackArrowClick={handleBackArrowClick}
            onForwardArrowClick={handleForwardArrowClick}
            canGoBack={backStack.length > 0}
            canGoForward={forwardStack.length > 0}
            onCreateFolder={handleCreateFolder}
            onCreateFile={handleCreateFile}
            selectedCount={selectedIds.length}
            clipboardCount={clipboard ? clipboard.items.length : 0}
            clipboardMode={clipboard?.mode ?? null}
            onCopy={handleCopySelection}
            onCut={handleCutSelection}
            onPaste={handlePaste}
            onDelete={handleDeleteSelection}
            onSelectAll={handleSelectAll}
            showDetails={showDetails}
            onToggleDetails={() => setShowDetails(prev => !prev)}
            activeFilter={activeFilter}
            onRestore={handleRestoreSelection}
            onEmptyRecycle={handleEmptyRecycleBin}
            isRecycleEmpty={visibleItems.length === 0}
          />
          <div
            onMouseDown={handleMouseDown}
            onWheel={(e) => handleWheel(e.nativeEvent)}
            className="flex-1 overflow-y-auto p-8 pt-4 hide-scrollbar deselect-area"
          >
            {folderError ? (
              <div className="flex flex-col items-center justify-center h-96 text-center text-red-500">
                <h3 className="text-lg font-semibold mb-1">Could not load this folder</h3>
                <p className="text-sm text-red-400">{folderError}</p>
                <button
                  onClick={handleRefresh}
                  className="mt-4 px-4 py-2 rounded-xl bg-red-50 text-red-600 text-sm font-semibold hover:bg-red-100"
                >
                  Try again
                </button>
              </div>
            ) : (
              <div className="w-full h-full relative">
                {isLoadingFolder && visibleItems.length > 0 && (
                  <div className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden rounded-full bg-transparent pointer-events-none">
                    <div className="h-full w-1/3 rounded-full bg-blue-500/70 animate-explorer-progress" />
                  </div>
                )}
                <FileGridview
                  isLoading={isLoadingFolder}
                  items={visibleItems}
                  selectedId={selectedId}
                  selectedIds={selectedIds}
                  dragHighlightIds={dragHighlightIds}
                  onSelect={handleSelectItem}
                  onDoubleClick={handleItemDoubleClick}
                  sizeMultiplier={sizeMultiplier}
                  viewMode={viewMode}
                  onRename={handleRenameFolder}
                  onContextMenu={handleContextMenu}
                  onMoveItems={handleMoveItems}
                  onCreateFolder={handleCreateFolder}
                  onOpenUpload={() => fileInputRef.current?.click()}
                  searchQuery={debouncedSearchQuery}
                  isTransitioning={isTransitioning}
                  activeFilter={activeFilter}
                />
              </div>
            )}
          </div>
          {/* Windows-style status bar */}
          <div className="h-8 border-t border-gray-100 bg-[#f7f8fc] px-6 flex items-center text-xs text-gray-500 justify-between shrink-0 select-none">
            <div className="flex items-center gap-2">
              <span>{visibleItems.length} items</span>
              {isLoadingFolder && (
                <span className="text-blue-500 font-medium">Updating...</span>
              )}
            </div>
            {selectedIds.length > 0 && (
              <div>{selectedIds.length} item{selectedIds.length > 1 ? 's' : ''} selected</div>
            )}
          </div>
        </div>
        {/* Properties Details Pane */}
        <div
          className={`transition-[opacity,transform] duration-300 ease-in-out flex flex-col shrink-0 overflow-hidden bg-white/60 dark:bg-slate-900/40 backdrop-blur-2xl shadow-[0_8px_32px_rgba(0,0,0,0.08)] relative select-none ${showDetails
            ? "w-[320px] opacity-100 translate-x-0 h-full"
            : "w-0 opacity-0 translate-x-8 pointer-events-none h-full"
            }`}
        >
          <div className="w-[320px] h-full flex flex-col overflow-y-auto">
            {/* Header */}
            <div className="p-5 flex items-center justify-between bg-transparent shrink-0">
              <span className="font-semibold text-slate-800 dark:text-slate-200 text-sm tracking-wide">Details</span>
              <button
                onClick={() => setShowDetails(false)}
                className="p-1.5 text-slate-400 hover:text-slate-800 hover:bg-slate-100/80 dark:hover:bg-slate-800 dark:hover:text-slate-200 rounded-xl transition-all cursor-pointer hover:scale-105 active:scale-95"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 p-5 overflow-y-auto space-y-5" role="region" aria-label="Item details" aria-live="polite">
              {loadingDetails ? (
                <div className="flex flex-col items-center justify-center h-48 text-slate-400">
                  <div className="w-6 h-6 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin mb-2" />
                  <span className="text-xs">Loading details...</span>
                </div>
              ) : !detailsData ? (
                <div className="flex flex-col items-center justify-center h-48 text-center text-slate-400">
                  <Info className="w-8 h-8 text-slate-200 dark:text-slate-700 mb-2" />
                  <span className="text-xs max-w-[200px] text-slate-400 dark:text-slate-500">Select a single item to view its properties.</span>
                </div>
              ) : (
                <>
                  {/* Item Preview Card */}
                  <div className="bg-white/50 dark:bg-slate-800/20 rounded-2xl p-5 flex flex-col items-center text-center shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
                    <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-slate-100 to-slate-50 dark:from-slate-850 dark:to-slate-800 flex items-center justify-center shadow-[0_8px_30px_rgba(0,0,0,0.04)] mb-4 hover:scale-105 transition-transform duration-300">
                      {detailsData.itemType === "folder" ? (
                        <Folder className="w-10 h-10 text-amber-400 fill-amber-400/10" />
                      ) : detailsData.itemType === "pdf" ? (
                        <FileText className="w-10 h-10 text-rose-500" />
                      ) : detailsData.itemType === "audio" ? (
                        <Music className="w-10 h-10 text-emerald-500" />
                      ) : detailsData.itemType === "video" ? (
                        <Video className="w-10 h-10 text-violet-500" />
                      ) : detailsData.itemType === "image" ? (
                        <ImageIcon className="w-10 h-10 text-sky-500" />
                      ) : (
                        <FileText className="w-10 h-10 text-blue-500" />
                      )}
                    </div>
                    <span className="font-semibold text-slate-850 dark:text-slate-100 text-sm max-w-full truncate px-1" title={detailsData.itemName}>
                      {detailsData.itemName}
                    </span>
                    <span className="text-xs text-slate-400 dark:text-slate-500 font-medium capitalize mt-1.5 px-3 py-0.5 bg-slate-100/50 dark:bg-slate-850/40 rounded-full">
                      {detailsData.itemType}
                    </span>
                  </div>

                  {/* Properties List */}
                  <div className="bg-white/50 dark:bg-slate-800/20 rounded-2xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.02)] space-y-4 text-xs">
                    <div className="flex justify-between items-center py-0.5">
                      <span className="text-slate-400 dark:text-slate-500 font-medium">Name</span>
                      <span className="text-slate-700 dark:text-slate-200 font-semibold text-right break-all max-w-[160px]">{detailsData.itemName}</span>
                    </div>
                    <div className="flex justify-between items-center py-0.5">
                      <span className="text-slate-400 dark:text-slate-500 font-medium">Type</span>
                      <span className="text-slate-700 dark:text-slate-200 font-semibold capitalize">{detailsData.itemType}</span>
                    </div>

                    {detailsData.itemType === "folder" ? (
                      <div className="flex justify-between items-center py-0.5">
                        <span className="text-slate-400 dark:text-slate-500 font-medium">Contents</span>
                        <span className="text-slate-700 dark:text-slate-200 font-semibold">
                          {detailsData.resources?.length || 0} resource{detailsData.resources?.length === 1 ? "" : "s"}
                        </span>
                      </div>
                    ) : (
                      <>
                        <div className="flex justify-between items-center py-0.5">
                          <span className="text-slate-400 dark:text-slate-500 font-medium">Size</span>
                          <span className="text-slate-700 dark:text-slate-200 font-semibold">{detailsData.itemSize || "—"}</span>
                        </div>
                        {detailsData.resource?.created_at && (
                          <div className="flex justify-between items-center py-0.5">
                            <span className="text-slate-400 dark:text-slate-500 font-medium">Created</span>
                            <span className="text-slate-700 dark:text-slate-200 font-semibold">
                              {new Date(detailsData.resource.created_at).toLocaleString(undefined, {
                                dateStyle: "medium",
                                timeStyle: "short"
                              })}
                            </span>
                          </div>
                        )}
                        {detailsData.resource?.duration_seconds ? (
                          <div className="flex justify-between items-center py-0.5">
                            <span className="text-slate-400 dark:text-slate-500 font-medium">Duration</span>
                            <span className="text-slate-700 dark:text-slate-200 font-semibold">
                              {Math.floor(detailsData.resource.duration_seconds / 60)}m {Math.floor(detailsData.resource.duration_seconds % 60)}s
                            </span>
                          </div>
                        ) : null}
                        {detailsData.resource?.processing_status && (
                          <div className="flex justify-between items-center py-0.5">
                            <span className="text-slate-400 dark:text-slate-500 font-medium">Status</span>
                            <span className={`px-2.5 py-0.5 rounded-full font-bold text-[9px] uppercase tracking-wider ${detailsData.resource.processing_status === "ready" || detailsData.resource.processing_status === "completed"
                              ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400"
                              : "bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400"
                              }`}>
                              {detailsData.resource.processing_status}
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between items-center py-0.5">
                          <span className="text-slate-400 dark:text-slate-500 font-medium">AI Index</span>
                          <span className={`px-2.5 py-0.5 rounded-full font-bold text-[9px] uppercase tracking-wider ${detailsData.resource?.is_embedded === "true" || detailsData.resource?.is_embedded === true
                            ? "bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400"
                            : "bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400"
                            }`}>
                            {detailsData.resource?.is_embedded === "true" || detailsData.resource?.is_embedded === true ? "Embedded" : "Not Indexed"}
                          </span>
                        </div>
                        <div className="flex justify-between items-center py-0.5">
                          <span className="text-slate-400 dark:text-slate-500 font-medium">Words</span>
                          <span className="text-slate-700 dark:text-slate-200 font-semibold">
                            {detailsData.resource?.transcript
                              ? detailsData.resource.transcript.trim().split(/\s+/).length.toLocaleString()
                              : 0
                            }
                          </span>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Description Area */}
                  {detailsData.itemType !== "folder" && detailsData.resource?.description && (
                    <div className="bg-white/50 dark:bg-slate-800/20 rounded-2xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.02)] space-y-2 text-xs">
                      <span className="text-slate-400 dark:text-slate-500 font-semibold block">Description</span>
                      <p className="text-slate-600 dark:text-slate-350 leading-relaxed max-h-32 overflow-y-auto pr-1">
                        {detailsData.resource.description}
                      </p>
                    </div>
                  )}

                  {(canOpenDocumentIntelligence || canGenerateKnowledge) && selectedIds.length === 1 && (
                    <div className="bg-white/50 dark:bg-slate-800/20 rounded-2xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.02)] space-y-3">
                      <div>
                        <span className="text-slate-400 dark:text-slate-500 font-semibold block text-xs">AI</span>
                        <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                          Open intelligence tools or extract this resource into the global knowledge graph.
                        </p>
                      </div>
                      {canGenerateKnowledge && (
                        <button
                          type="button"
                          onClick={handleGenerateKnowledge}
                          disabled={generatingKnowledge || knowledgeJobActive}
                          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-semibold py-3 px-4 shadow-lg shadow-indigo-600/20 transition-all cursor-pointer"
                        >
                          <Sparkles className={"w-3.5 h-3.5 " + (generatingKnowledge || knowledgeJobActive ? "animate-pulse" : "")} />
                          {generatingKnowledge ? "Queueing Knowledge..." : knowledgeActionLabel}
                        </button>
                      )}
                      {knowledgeState?.status === "stale" && (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400">
                          Source content changed after the last extraction.
                        </p>
                      )}
                      {knowledgeState?.outcome === "no_qualifying_concepts" && (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          Extraction completed, but no concepts met the publication standard.
                        </p>
                      )}
                    </div>
                  )}

                </>
              )}
            </div>
          </div>
        </div>
      </div>
      {showConfirmEmptyRecycle && (
        <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 shadow-2xl max-w-sm w-full mx-4 border border-gray-100/50 dark:border-slate-850/50 flex flex-col items-center text-center animate-scaleIn">
            <div className="w-12 h-12 rounded-full bg-red-50 dark:bg-red-950/30 flex items-center justify-center mb-4">
              <Trash2 className="w-6 h-6 text-red-600 dark:text-red-400" />
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 mb-2">
              Empty Recycle Bin?
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mb-6">
              Are you sure you want to permanently delete all items in the Recycle Bin? This action cannot be undone.
            </p>
            <div className="flex gap-3 w-full">
              <button
                onClick={() => setShowConfirmEmptyRecycle(false)}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-350 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setShowConfirmEmptyRecycle(false);
                  await executeEmptyRecycleBin();
                }}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold shadow-lg shadow-red-600/25 transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
              >
                Empty Bin
              </button>
            </div>
          </div>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        multiple
        accept="video/*,audio/*,image/*,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.md"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            setUploadFiles(Array.from(e.target.files));
          }
          e.target.value = '';
        }}
      />
      <UploadModal
        isOpen={uploadFiles.length > 0 || isDragOver}
        onClose={() => { setUploadFiles([]); setIsDragOver(false); }}
        initialFiles={uploadFiles}
        onUpload={handleUpload}
      />
      <CarouselPreview
        isOpen={previewItemId !== null}
        onClose={() => setPreviewItemId(null)}
        items={visibleItems}
        initialItemId={previewItemId || ""}
        folderPath={folderHistory.map(h => h.name)}
        playlistId={playlistId}
        playlistName={playlistName}
        folderId={currentFolderId}
        folderName={folderHistory[folderHistory.length - 1]?.name}
      />
      {dragBox && (
        <div
          style={{
            position: 'fixed',
            left: dragBox.left,
            top: dragBox.top,
            width: dragBox.width,
            height: dragBox.height,
            backgroundColor: 'rgba(59, 130, 246, 0.12)',
            border: '1.5px solid rgb(59, 130, 246)',
            borderRadius: '3px',
            pointerEvents: 'none',
            zIndex: 99999,
          }}
        />
      )}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            zIndex: 999999,
          }}
          className="w-56 bg-white/95 backdrop-blur-md border border-slate-200/80 rounded-xl shadow-2xl p-1.5 flex flex-col text-xs text-slate-700 animate-fadeIn"
          role="menu"
          aria-label="Context menu"
        >
          {activeFilter === "recycle" ? (
            contextMenu.itemId ? (
              <>
                <button
                  onClick={() => {
                    handleRestoreSelection();
                    setContextMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-blue-50 text-blue-600 flex items-center gap-2.5 transition-colors cursor-pointer font-medium"
                  role="menuitem"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-blue-500" />
                  <span>Restore</span>
                </button>
                <button
                  onClick={() => {
                    handleDeleteSelection();
                    setContextMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-red-50 text-red-600 hover:text-red-700 flex items-center gap-2.5 transition-colors cursor-pointer font-medium"
                  role="menuitem"
                >
                  <Trash2 className="w-3.5 h-3.5 text-red-500" />
                  <span>Delete Permanently</span>
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => {
                    handleEmptyRecycleBin();
                    setContextMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-red-50 text-red-600 hover:text-red-700 flex items-center gap-2.5 transition-colors cursor-pointer font-medium"
                  role="menuitem"
                >
                  <Trash2 className="w-3.5 h-3.5 text-red-500" />
                  <span>Empty Recycle Bin</span>
                </button>
                <button
                  onClick={() => {
                    handleRefresh();
                    setContextMenu(null);
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50 flex items-center gap-2.5 transition-colors cursor-pointer"
                  role="menuitem"
                >
                  <RotateCw className="w-3.5 h-3.5 text-slate-400" />
                  <span>Refresh</span>
                </button>
              </>
            )
          ) : contextMenu.itemId ? (
            <>
              <button
                onClick={() => {
                  const item = items.find(i => i.id === contextMenu.itemId);
                  if (item) handleItemDoubleClick(item);
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50 flex items-center gap-2.5 font-medium transition-colors cursor-pointer"
                role="menuitem"
              >
                <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                <span>Open</span>
              </button>
              <div className="h-[1px] bg-slate-100 my-1" />
              <button
                onClick={() => {
                  handleCutSelection();
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50 flex items-center gap-2.5 transition-colors cursor-pointer"
                role="menuitem"
              >
                <Scissors className="w-3.5 h-3.5 text-slate-400" />
                <span className="flex-1">Cut</span>
                <span className="text-slate-400 text-[10px]">Ctrl+X</span>
              </button>
              <button
                onClick={() => {
                  handleCopySelection();
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50 flex items-center gap-2.5 transition-colors cursor-pointer"
                role="menuitem"
              >
                <Copy className="w-3.5 h-3.5 text-slate-400" />
                <span className="flex-1">Copy</span>
                <span className="text-slate-400 text-[10px]">Ctrl+C</span>
              </button>
              <button
                onClick={() => {
                  setItems(prev => prev.map(item => item.id === contextMenu.itemId ? { ...item, isEditing: true } : item));
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50 flex items-center gap-2.5 transition-colors cursor-pointer"
                role="menuitem"
              >
                <PenLine className="w-3.5 h-3.5 text-slate-400" />
                <span className="flex-1">Rename</span>
                <span className="text-slate-400 text-[10px]">F2</span>
              </button>
              <div className="h-[1px] bg-slate-100 my-1" />
              <button
                onClick={() => {
                  handleDeleteSelection();
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-red-50 text-red-600 hover:text-red-700 flex items-center gap-2.5 transition-colors cursor-pointer"
                role="menuitem"
              >
                <Trash2 className="w-3.5 h-3.5 text-red-400" />
                <span className="flex-1 font-medium">Delete</span>
                <span className="text-slate-400 text-[10px]">Del</span>
              </button>
              <div className="h-[1px] bg-slate-100 my-1" />
              <button
                onClick={() => {
                  setShowDetails(true);
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50 flex items-center gap-2.5 font-medium transition-colors cursor-pointer"
                role="menuitem"
              >
                <Info className="w-3.5 h-3.5 text-blue-500" />
                <span>Properties</span>
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  handleCreateFolder();
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50 flex items-center gap-2.5 transition-colors cursor-pointer"
                role="menuitem"
              >
                <FolderPlus className="w-3.5 h-3.5 text-slate-400" />
                <span>New Folder</span>
              </button>
              <button
                onClick={() => {
                  handleCreateFile();
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50 flex items-center gap-2.5 transition-colors cursor-pointer"
                role="menuitem"
              >
                <FilePlus className="w-3.5 h-3.5 text-slate-400" />
                <span>New Markdown File</span>
              </button>
              <div className="h-[1px] bg-slate-100 my-1" />
              <button
                onClick={() => {
                  handlePasteRef.current?.();
                  setContextMenu(null);
                }}
                disabled={!clipboard}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50 flex items-center gap-2.5 disabled:opacity-30 disabled:hover:bg-transparent transition-colors cursor-pointer"
                role="menuitem"
              >
                <Clipboard className="w-3.5 h-3.5 text-slate-400" />
                <span className="flex-1">Paste</span>
                <span className="text-slate-400 text-[10px]">Ctrl+V</span>
              </button>
              <button
                onClick={() => {
                  handleRefresh();
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50 flex items-center gap-2.5 transition-colors cursor-pointer"
                role="menuitem"
              >
                <RotateCw className="w-3.5 h-3.5 text-slate-400" />
                <span>Refresh</span>
              </button>
            </>
          )}
        </div>
      )}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </div>
  );
};
