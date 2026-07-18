import React from "react";
import { Folder, Image as ImageIcon, Video as VideoIcon, FileText, Music as MusicIcon, File as GenericFileIcon, MoreVertical, FolderPlus } from "lucide-react";
import type { ExplorerItem, ExplorerViewMode } from "./types";

// Global in-memory cache for Object URLs to prevent re-fetching/re-decoding
const previewCache: Record<string, string> = {};
let previewCacheKeys: string[] = [];
const PREVIEW_CACHE_MAX = 200;
const PREVIEW_FETCH_CONCURRENCY = 4;
let activePreviewFetches = 0;
const previewFetchQueue: Array<() => void> = [];

function setPreviewCache(id: string, url: string) {
  if (previewCacheKeys.length >= PREVIEW_CACHE_MAX) {
    const evictCount = Math.floor(PREVIEW_CACHE_MAX / 4);
    const evicted = previewCacheKeys.splice(0, evictCount);
    for (const key of evicted) {
      URL.revokeObjectURL(previewCache[key]);
      delete previewCache[key];
    }
  }
  previewCache[id] = url;
  previewCacheKeys.push(id);
}

function enqueuePreviewFetch<T>(task: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      activePreviewFetches += 1;
      task()
        .then(resolve, reject)
        .finally(() => {
          activePreviewFetches -= 1;
          previewFetchQueue.shift()?.();
        });
    };

    if (activePreviewFetches < PREVIEW_FETCH_CONCURRENCY) {
      run();
    } else {
      previewFetchQueue.push(run);
    }
  });
}

function getScrollParent(element: HTMLElement | null): HTMLElement | Window {
  let current = element?.parentElement || null;
  while (current) {
    const style = window.getComputedStyle(current);
    if (/(auto|scroll)/.test(style.overflowY)) {
      return current;
    }
    current = current.parentElement;
  }
  return window;
}

function useVirtualWindow(containerRef: React.RefObject<HTMLDivElement | null>, itemCount: number, rowHeight: number, overscan = 3) {
  const [viewport, setViewport] = React.useState({ top: 0, height: 900 });

  React.useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const scrollParent = getScrollParent(node);

    const updateViewport = () => {
      const nodeRect = node.getBoundingClientRect();
      if (scrollParent === window) {
        setViewport({
          top: Math.max(0, -nodeRect.top),
          height: window.innerHeight,
        });
        return;
      }

      const parentRect = (scrollParent as HTMLElement).getBoundingClientRect();
      setViewport({
        top: Math.max(0, parentRect.top - nodeRect.top),
        height: parentRect.height,
      });
    };

    updateViewport();
    scrollParent.addEventListener("scroll", updateViewport, { passive: true });
    window.addEventListener("resize", updateViewport);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(updateViewport);
      resizeObserver.observe(node);
      if (scrollParent !== window) resizeObserver.observe(scrollParent as HTMLElement);
    }

    return () => {
      scrollParent.removeEventListener("scroll", updateViewport);
      window.removeEventListener("resize", updateViewport);
      resizeObserver?.disconnect();
    };
  }, [containerRef, itemCount, rowHeight]);

  const startRow = Math.max(0, Math.floor(viewport.top / rowHeight) - overscan);
  const endRow = Math.ceil((viewport.top + viewport.height) / rowHeight) + overscan;

  return { startRow, endRow };
}

function useElementWidth(containerRef: React.RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = React.useState(1200);

  React.useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const updateWidth = () => {
      const nextWidth = node.getBoundingClientRect().width;
      if (nextWidth > 0) setWidth(nextWidth);
    };

    updateWidth();
    window.addEventListener("resize", updateWidth);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(updateWidth);
      resizeObserver.observe(node);
    }

    return () => {
      window.removeEventListener("resize", updateWidth);
      resizeObserver?.disconnect();
    };
  }, [containerRef]);

  return width;
}

interface AuthenticatedIconProps {
  item: ExplorerItem;
  iconSize: number;
}

const AuthenticatedIcon = React.memo(function AuthenticatedIcon({ item, iconSize }: AuthenticatedIconProps) {
  const isPreviewable = ["image", "video"].includes(item.type);
  const [src, setSrc] = React.useState<string>(() => previewCache[item.id] || "");
  const [failed, setFailed] = React.useState<boolean>(false);
  const [loading, setLoading] = React.useState<boolean>(() => isPreviewable && !previewCache[item.id]);
  const [shouldLoadPreview, setShouldLoadPreview] = React.useState<boolean>(() => Boolean(previewCache[item.id]));
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!isPreviewable || shouldLoadPreview) return;
    const node = containerRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setShouldLoadPreview(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShouldLoadPreview(true);
          observer.disconnect();
        }
      },
      { rootMargin: "260px" }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [isPreviewable, shouldLoadPreview]);

  // Load thumbnails immediately — previewCache prevents redundant fetches
  React.useEffect(() => {
    if (!isPreviewable) {
      setLoading(false);
      setSrc("");
      return;
    }

    setFailed(false);

    if (previewCache[item.id]) {
      setSrc(previewCache[item.id]);
      setLoading(false);
      return;
    }

    if (!shouldLoadPreview) {
      setLoading(true);
      return;
    }

    const previewUrl = item.previewUrl || "";

    if (!previewUrl || item.previewStatus === "unavailable") {
      setLoading(false);
      return;
    }

    let active = true;
    const controller = new AbortController();
    const fetchMedia = async () => {
      setSrc("");
      setLoading(true);
      try {
        const token = localStorage.getItem("access_token");
        const blob = await enqueuePreviewFetch(async () => {
          if (!active) throw new Error("Preview load cancelled");
          const res = await fetch(previewUrl, {
            headers: {
              "Authorization": `Bearer ${token}`
            },
            signal: controller.signal,
          });
          if (!res.ok) throw new Error("Failed to load file preview");
          return res.blob();
        });
        if (active) {
          const url = URL.createObjectURL(blob);
          setPreviewCache(item.id, url);
          setSrc(url);
        }
      } catch (err) {
        if (active) setFailed(true);
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchMedia();

    return () => {
      active = false;
      controller.abort();
    };
  }, [item.id, item.previewStatus, item.previewUrl, item.type, isPreviewable, shouldLoadPreview]);

  const defaultColor = "text-blue-500 fill-blue-500/10";
  let IconComp = GenericFileIcon;
  let colorClass = defaultColor;

  if (item.type === "pdf") {
    IconComp = FileText;
    colorClass = "text-rose-500 fill-rose-500/10";
  } else if (item.type === "audio") {
    IconComp = MusicIcon;
    colorClass = "text-emerald-500 fill-emerald-500/10";
  } else if (item.type === "video") {
    IconComp = VideoIcon;
    colorClass = "text-violet-500 fill-violet-500/10";
  } else if (item.type === "image") {
    IconComp = ImageIcon;
    colorClass = "text-sky-500 fill-sky-500/10";
  }

  if (isPreviewable && !failed && loading) {
    return (
      <div
        ref={containerRef}
        className="preview-skeleton absolute inset-0 rounded-lg overflow-hidden"
        aria-hidden="true"
      >
        <div className="preview-skeleton-glow" />
        <div className="preview-skeleton-layer preview-skeleton-layer-top" />
        <div className="preview-skeleton-layer preview-skeleton-layer-mid" />
        <div className="preview-skeleton-layer preview-skeleton-layer-bottom" />
        <div className="preview-skeleton-center" />
      </div>
    );
  }

  if (isPreviewable && !failed && !loading && src) {
    if (item.type === "image") {
      return (
        <div ref={containerRef} className="absolute inset-0 rounded-lg overflow-hidden border border-gray-100 dark:border-transparent bg-gray-50 dark:bg-slate-800/50 flex items-center justify-center w-full h-full">
          <img 
            src={src} 
            alt={item.name}
            className="w-full h-full object-cover preview-media"
            loading="lazy"
          />
        </div>
      );
    } else if (item.type === "video") {
      return (
        <div ref={containerRef} className="absolute inset-0 rounded-lg overflow-hidden border border-gray-100 dark:border-transparent bg-gray-50 dark:bg-slate-800/50 flex items-center justify-center w-full h-full">
          <img
            src={src} 
            alt={item.name}
            className="w-full h-full object-cover preview-media"
            loading="lazy"
          />
          {/* Overlay video icon */}
          <div className="absolute inset-0 bg-black/10 flex items-center justify-center">
            <div className="w-8 h-8 rounded-full bg-black/40 flex items-center justify-center backdrop-blur-sm text-white">
              <VideoIcon className="w-4 h-4" />
            </div>
          </div>
        </div>
      );
    }
  }

  return (
    <div ref={containerRef} className="relative flex items-center justify-center w-full h-full min-h-[48px]">
      <IconComp 
        style={{ width: iconSize * 2, height: iconSize * 2 }}
        className={`${colorClass} stroke-[1.5]`}
      />
    </div>
  );
});

interface PrettyGridViewProps {
  items: ExplorerItem[];
  selectedId: string | null;
  selectedIds?: string[];
  dragHighlightIds?: string[];
  onSelect: (id: string, event?: React.MouseEvent) => void;
  onDoubleClick?: (item: ExplorerItem) => void;
  sizeMultiplier: number;
  viewMode: ExplorerViewMode;
  isLoading?: boolean;
  onRename?: (id: string, name: string) => void;
  onContextMenu?: (e: React.MouseEvent, id: string | null) => void;
  onMoveItems?: (sourceIds: string[], targetFolderId: string) => void;
  onCreateFolder?: () => void;
  onOpenUpload?: () => void;
  searchQuery?: string;
  isTransitioning?: boolean;
  activeFilter?: string;
}

export const FileGridview: React.FC<PrettyGridViewProps> = ({
  items,
  selectedId,
  selectedIds = selectedId ? [selectedId] : [],
  dragHighlightIds = [],
  onSelect,
  onDoubleClick,
  sizeMultiplier,
  viewMode,
  isLoading = false,
  onRename,
  onContextMenu,
  onMoveItems,
  onCreateFolder,
  onOpenUpload,
  searchQuery = "",
  isTransitioning = false,
  activeFilter = "all",
}) => {
  const [dragOverFolderId, setDragOverFolderId] = React.useState<string | null>(null);
  const gridContainerRef = React.useRef<HTMLDivElement>(null);
  const listContainerRef = React.useRef<HTMLDivElement>(null);

  // Dynamic design variables calibrated by the size multiplier state
  const baseCardWidth = Math.max(100, 120 * sizeMultiplier);
  const iconSize = Math.max(16, 24 * sizeMultiplier); // List icon scale
  const fontSizeName = `${Math.max(11, 13 * sizeMultiplier)}px`;
  const fontSizeMeta = `${Math.max(9, 11 * sizeMultiplier)}px`;
  const cardPadding = `${Math.max(10, 14 * sizeMultiplier)}px`;
  const rowPadding = `${Math.max(6, 10 * sizeMultiplier)}px`; // List row padding
  const gridGapX = 20;
  const gridGapY = 24;
  const gridContainerWidth = useElementWidth(gridContainerRef);
  const estimatedGridColumnWidth = baseCardWidth + gridGapX;
  const estimatedGridColumns = Math.max(1, Math.floor((gridContainerWidth + gridGapX) / estimatedGridColumnWidth));
  const gridRowHeight = baseCardWidth + Math.max(64, 72 * sizeMultiplier) + gridGapY;
  const listRowHeight = Math.max(40, 44 * sizeMultiplier);
  const gridVirtual = useVirtualWindow(gridContainerRef, items.length, gridRowHeight, 3);
  const listVirtual = useVirtualWindow(listContainerRef, items.length, listRowHeight, 8);

  if (items.length === 0) {
    if (isLoading || isTransitioning) return null;
    if (searchQuery) {
      return (
        <div
          onContextMenu={(e) => onContextMenu?.(e, null)}
          className="flex flex-col items-center justify-center p-12 text-center text-gray-400 select-none h-96 deselect-area"
        >
          <div className="w-20 h-20 rounded-2xl bg-slate-100 flex items-center justify-center mb-5">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-10 h-10 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-slate-700 mb-1">No results found</h3>
          <p className="text-sm text-slate-400 max-w-sm mb-1">No items match "<span className="font-medium text-slate-500">{searchQuery}</span>"</p>
          <p className="text-xs text-slate-300 max-w-sm">Try a different search term or check the spelling</p>
        </div>
      );
    }
    const showActions = !["documents", "music", "pictures", "videos", "recycle", "recent"].includes(activeFilter);
    const isFilterView = ["documents", "music", "pictures", "videos", "recycle", "recent"].includes(activeFilter);
    return (
      <div
        onContextMenu={(e) => onContextMenu?.(e, null)}
        className="flex flex-col items-center justify-center p-12 text-center text-gray-400 select-none h-96 deselect-area"
      >
        <Folder style={{ width: 64, height: 64 }} className="text-slate-200 mb-4 stroke-[1.2]" />
        <h3 className="text-lg font-semibold text-slate-700 mb-1">
          {activeFilter === "recycle" ? "Recycle bin is empty" : isFilterView ? "No items found" : "This folder is empty"}
        </h3>
        <p className="text-sm text-slate-400 max-w-sm mb-6">
          {activeFilter === "recycle"
            ? "No deleted items in the recycle bin."
            : isFilterView
            ? `No ${activeFilter} items in this playlist.`
            : "Drag and drop files here, or use the buttons below to add content."}
        </p>
        {showActions && (
          <div className="flex items-center gap-3">
            {onOpenUpload && (
              <button
                onClick={onOpenUpload}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-md shadow-blue-600/20 transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Upload Files
              </button>
            )}
            {onCreateFolder && (
              <button
                onClick={onCreateFolder}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 text-slate-700 text-sm font-semibold transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
              >
                <FolderPlus className="w-4 h-4 text-gray-500" />
                New Folder
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  const renderGridIcon = (item: ExplorerItem) => {
    return <AuthenticatedIcon item={item} iconSize={iconSize} />;
  };

  const renderListIcon = (item: ExplorerItem) => {
    if (item.type === "folder") {
      return <Folder style={{ width: iconSize, height: iconSize }} className="text-amber-400 fill-amber-400/10 shrink-0 stroke-[2]" />;
    }
    if (item.type === "pdf") {
      return <FileText style={{ width: iconSize, height: iconSize }} className="text-rose-500 shrink-0 stroke-[2]" />;
    }
    if (item.type === "audio") {
      return <MusicIcon style={{ width: iconSize, height: iconSize }} className="text-emerald-500 shrink-0 stroke-[2]" />;
    }
    if (item.type === "video") {
      return <VideoIcon style={{ width: iconSize, height: iconSize }} className="text-violet-500 shrink-0 stroke-[2]" />;
    }
    if (item.type === "image") {
      return <ImageIcon style={{ width: iconSize, height: iconSize }} className="text-sky-500 shrink-0 stroke-[2]" />;
    }
    return <GenericFileIcon style={{ width: iconSize, height: iconSize }} className="text-blue-500 shrink-0 stroke-[2]" />;
  };

  const renderGridItem = (item: ExplorerItem) => {
    const isSelected = selectedIds.includes(item.id);
    const isFolder = item.type === "folder";
    const isDragOverTarget = dragOverFolderId === item.id;
    const isDragHighlighted = dragHighlightIds.includes(item.id) && !isSelected;

    return (
      <div
        key={item.id}
        data-id={item.id}
        data-grid-item="true"
        role="gridcell"
        aria-selected={isSelected}
        aria-label={`${isFolder ? "Folder" : item.type}, ${item.name}${item.size ? `, ${item.size}` : ""}`}
        tabIndex={0}
        onClick={(event) => onSelect(item.id, event)}
        onDoubleClick={() => onDoubleClick?.(item)}
        onContextMenu={(e) => onContextMenu?.(e, item.id)}
        draggable={!item.isEditing}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", item.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => {
          if (isFolder) {
            e.preventDefault();
            if (dragOverFolderId !== item.id) {
              setDragOverFolderId(item.id);
            }
          }
        }}
        onDragLeave={() => {
          if (isFolder) {
            setDragOverFolderId(null);
          }
        }}
        onDrop={(e) => {
          if (isFolder) {
            e.preventDefault();
            setDragOverFolderId(null);
            const draggedId = e.dataTransfer.getData("text/plain");
            if (draggedId && draggedId !== item.id) {
              const dragSelection = selectedIds.includes(draggedId) ? selectedIds : [draggedId];
              onMoveItems?.(dragSelection, item.id);
            }
          }
        }}
        className={`group flex flex-col rounded-xl cursor-pointer border relative grid-item-card transition-all duration-150
${
          isDragOverTarget
            ? "ring-2 ring-blue-500 bg-blue-100/30 dark:bg-blue-950/20 scale-[1.03] border-blue-300 dark:border-blue-800 shadow-md"
            : isSelected
            ? "bg-white/80 dark:bg-slate-800/80 border-transparent ring-2 ring-blue-400/50 shadow-[0_8px_30px_rgba(59,130,246,0.15)] scale-[1.02] -translate-y-1"
            : isDragHighlighted
            ? "bg-blue-50/80 dark:bg-blue-950/30 border-blue-200/60 dark:border-blue-800/40 ring-1 ring-blue-300/40"
            : "bg-transparent border-transparent hover:bg-white/60 dark:hover:bg-slate-800/50 hover:border-gray-200/50 dark:hover:border-slate-700/60 hover:-translate-y-1.5 hover:scale-[1.03] hover:shadow-[0_12px_24px_-4px_rgba(59,130,246,0.12)] active:scale-[0.97]"
        }`}
        style={{ padding: cardPadding }}
      >
        <button
          onClick={(e) => { e.stopPropagation(); onContextMenu?.(e, item.id); }}
          className="absolute top-2 right-2 p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-200/50 opacity-0 group-hover:opacity-100 transition-all z-10"
        >
          <MoreVertical className="w-3.5 h-3.5" />
        </button>

        <div className="w-full flex items-center justify-center aspect-square mb-2.5 relative select-none pointer-events-none">
          {isFolder ? (
            <div className="relative transform folder-icon-wrapper group-hover:scale-110">
              <Folder
                style={{ width: iconSize * 2, height: iconSize * 2 }}
                className="text-amber-400 fill-amber-400/20 stroke-[1.5]"
              />
              <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-3/5 h-2/5 bg-white/80 rounded-sm border border-amber-200 shadow-sm origin-bottom scale-90 folder-sheet group-hover:translate-y-[-4px] group-hover:rotate-[-2deg]" />
            </div>
          ) : (
            renderGridIcon(item)
          )}
        </div>

        <div className="text-center w-full min-w-0">
          {item.isEditing ? (
            <input
              type="text"
              defaultValue={item.name}
              autoFocus
              onFocus={(e) => e.target.select()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onRename?.(item.id, e.currentTarget.value);
                } else if (e.key === "Escape") {
                  onRename?.(item.id, item.name);
                }
              }}
              onBlur={(e) => onRename?.(item.id, e.target.value)}
              className="w-full text-center border border-blue-400 rounded px-1 text-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
              style={{ fontSize: fontSizeName }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <p
              className="font-medium text-gray-800 dark:text-slate-200 truncate leading-snug w-full px-0.5"
              style={{ fontSize: fontSizeName }}
            >
              {item.name}
            </p>
          )}
          {!isFolder && item.size && (
            <p
              className="text-gray-400 dark:text-slate-500 mt-0.5 font-normal tracking-wide"
              style={{ fontSize: fontSizeMeta }}
            >
              {item.size}
            </p>
          )}
        </div>
      </div>
    );
  };

  const renderListItem = (item: ExplorerItem) => {
    const isSelected = selectedIds.includes(item.id);
    const isFolder = item.type === "folder";
    const isDragOverTarget = dragOverFolderId === item.id;
    const isDragHighlighted = dragHighlightIds.includes(item.id) && !isSelected;

    return (
      <div
        key={item.id}
        data-id={item.id}
        data-grid-item="true"
        role="row"
        aria-selected={isSelected}
        aria-label={`${isFolder ? "Folder" : item.type}, ${item.name}${item.size ? `, ${item.size}` : ""}, Modified ${item.modifiedDate}`}
        tabIndex={0}
        onClick={(event) => onSelect(item.id, event)}
        onDoubleClick={() => onDoubleClick?.(item)}
        onContextMenu={(e) => onContextMenu?.(e, item.id)}
        draggable={!item.isEditing}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", item.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => {
          if (isFolder) {
            e.preventDefault();
            if (dragOverFolderId !== item.id) {
              setDragOverFolderId(item.id);
            }
          }
        }}
        onDragLeave={() => {
          if (isFolder) {
            setDragOverFolderId(null);
          }
        }}
        onDrop={(e) => {
          if (isFolder) {
            e.preventDefault();
            setDragOverFolderId(null);
            const draggedId = e.dataTransfer.getData("text/plain");
            if (draggedId && draggedId !== item.id) {
              const dragSelection = selectedIds.includes(draggedId) ? selectedIds : [draggedId];
              onMoveItems?.(dragSelection, item.id);
            }
          }
        }}
        className={`grid grid-cols-[1fr_150px_120px] gap-4 items-center px-4 rounded-xl border cursor-pointer grid-item-row transition-all duration-150
${
          isDragOverTarget
            ? "ring-2 ring-blue-500 bg-blue-100/30 dark:bg-blue-950/20 border-blue-300 dark:border-blue-800 scale-[1.01]"
            : isSelected
            ? "bg-white/80 dark:bg-slate-800/80 border-transparent ring-1 ring-blue-400/40 shadow-sm text-gray-900 dark:text-slate-100 scale-[1.01] -translate-y-0.5"
            : isDragHighlighted
            ? "bg-blue-50/80 dark:bg-blue-950/30 border-blue-200/60 dark:border-blue-800/40 ring-1 ring-blue-300/40"
            : "bg-transparent border-transparent text-gray-600 dark:text-slate-400 hover:bg-white/60 dark:hover:bg-slate-800/45 hover:text-gray-900 dark:hover:text-slate-200 hover:border-gray-200/50 dark:hover:border-slate-700/40 active:scale-[0.99]"
        }`}
        style={{ padding: rowPadding, minHeight: listRowHeight - 2 }}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1 pointer-events-none">
          {renderListIcon(item)}
          {item.isEditing ? (
            <input
              type="text"
              defaultValue={item.name}
              autoFocus
              onFocus={(e) => e.target.select()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onRename?.(item.id, e.currentTarget.value);
                } else if (e.key === "Escape") {
                  onRename?.(item.id, item.name);
                }
              }}
              onBlur={(e) => onRename?.(item.id, e.target.value)}
              className="border border-blue-400 rounded px-1.5 py-0.5 text-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white min-w-[150px] max-w-full pointer-events-auto"
              style={{ fontSize: fontSizeName }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="truncate pr-4 font-medium">{item.name}</span>
          )}
        </div>
        <div className="text-gray-400 whitespace-nowrap pointer-events-none" style={{ fontSize: fontSizeMeta }}>{item.modifiedDate}</div>
        <div className="text-gray-400 pointer-events-none" style={{ fontSize: fontSizeMeta }}>{isFolder ? "-" : item.size}</div>
      </div>
    );
  };

  // ==========================================
  // VIEW MODE 1: GRID VIEW (Fluent Dashboard Layout)
  // ==========================================
  if (viewMode === "grid") {
    const startIndex = Math.min(items.length, gridVirtual.startRow * estimatedGridColumns);
    const endIndex = Math.min(items.length, gridVirtual.endRow * estimatedGridColumns);
    const visibleGridItems = items.slice(startIndex, endIndex);
    const topSpacer = gridVirtual.startRow * gridRowHeight;
    const totalRows = Math.ceil(items.length / estimatedGridColumns);
    const totalHeight = totalRows * gridRowHeight + 48;

    return (
      <div 
        ref={gridContainerRef}
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).classList.contains('grid-container')) {
            onContextMenu?.(e, null);
          }
        }}
        className="relative transition-all duration-150 ease-out pb-12 grid-container deselect-area"
        role="grid"
        aria-label="File explorer grid"
        style={{ minHeight: totalHeight }}
      >
        <div
          className="grid gap-x-5 gap-y-6 content-start items-start"
          style={{
            transform: `translateY(${topSpacer}px)`,
            gridTemplateColumns: `repeat(${estimatedGridColumns}, minmax(${baseCardWidth}px, 1fr))`,
          }}
        >
          {visibleGridItems.map(renderGridItem)}
        </div>
      </div>
    );
  }

  // ==========================================
  // VIEW MODE 2: LIST VIEW (Clean Multi-Column List)
  // ==========================================
  const listStartIndex = Math.min(items.length, listVirtual.startRow);
  const listEndIndex = Math.min(items.length, listVirtual.endRow);
  const visibleListItems = items.slice(listStartIndex, listEndIndex);
  const listTopSpacer = listStartIndex * listRowHeight;
  const listTotalHeight = items.length * listRowHeight + 48;

  return (
    <div 
      ref={listContainerRef}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).classList.contains('list-container')) {
          onContextMenu?.(e, null);
        }
      }}
      className="w-full flex flex-col pb-12 select-none list-container deselect-area"
      role="grid"
      aria-label="File explorer list"
      style={{ fontSize: fontSizeName }}
    >
      {/* Table Metadata Header Layer */}
      <div className="grid grid-cols-[1fr_150px_120px] gap-4 px-4 py-2 border-b border-gray-100 dark:border-white/5 text-gray-400 dark:text-slate-500 font-semibold tracking-wider" style={{ fontSize: fontSizeMeta }} role="row">
        <div role="columnheader">Name</div>
        <div role="columnheader">Date Modified</div>
        <div role="columnheader">Size</div>
      </div>

      {/* Row Node Iteration Loop */}
      <div className="mt-1.5 relative list-container deselect-area" style={{ minHeight: listTotalHeight }}>
        <div className="absolute inset-x-0 top-0 space-y-0.5" style={{ transform: `translateY(${listTopSpacer}px)` }}>
          {visibleListItems.map(renderListItem)}
        </div>
      </div>
    </div>
  );
};
