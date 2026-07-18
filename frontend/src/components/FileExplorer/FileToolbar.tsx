import React, { useState, useCallback, useRef } from "react";
import { 
  ArrowLeft, 
  ArrowRight, 
  LayoutGrid, 
  SlidersHorizontal, 
  ArrowUpDown, 
  FolderPlus, 
  FilePlus, 
  CheckSquare, 
  Clipboard,
  Copy,
  Scissors,
  Trash2,
  EyeOff, 
  RotateCw, 
  RotateCcw,
  Search,
  Minus,
  Square,
  X,
  ChevronRight,
  Info
} from "lucide-react";
import type { ExplorerViewMode } from "./types";

interface PrettyToolbarProps {
  currentPath: string[];
  sizeMultiplier: number;
  setSizeMultiplier: (value: number) => void;
  viewMode: ExplorerViewMode;
  setViewMode: (mode: ExplorerViewMode) => void;
  sortOrder: "asc" | "desc";
  setSortOrder: (order: "asc" | "desc") => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  onClose?: () => void;
  onBreadcrumbClick?: (index: number) => void;
  onBackArrowClick?: () => void;
  onForwardArrowClick?: () => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onCreateFolder?: () => void;
  onCreateFile?: () => void;
  selectedCount?: number;
  clipboardCount?: number;
  clipboardMode?: "copy" | "cut" | null;
  onCopy?: () => void;
  onCut?: () => void;
  onPaste?: () => void;
  onDelete?: () => void;
  onSelectAll?: () => void;
  showDetails?: boolean;
  onToggleDetails?: () => void;
  activeFilter?: string;
  onRestore?: () => void;
  onEmptyRecycle?: () => void;
  isRecycleEmpty?: boolean;
}

export const FileToolbar: React.FC<PrettyToolbarProps> = ({
  currentPath,
  sizeMultiplier,
  setSizeMultiplier,
  viewMode,
  setViewMode,
  sortOrder,
  setSortOrder,
  onRefresh,
  isRefreshing,
  searchQuery,
  setSearchQuery,
  onClose,
  onBreadcrumbClick,
  onBackArrowClick,
  onForwardArrowClick,
  canGoBack = false,
  canGoForward = false,
  onCreateFolder,
  onCreateFile,
  selectedCount = 0,
  clipboardCount = 0,
  clipboardMode = null,
  onCopy,
  onCut,
  onPaste,
  onDelete,
  onSelectAll,
  showDetails = false,
  onToggleDetails,
  activeFilter = "all",
  onRestore,
  onEmptyRecycle,
  isRecycleEmpty = false,
}) => {
  const [flashAction, setFlashAction] = useState<string | null>(null);
  const flashTimerRef = useRef<any>(null);

  const triggerFlash = useCallback((action: string) => {
    setFlashAction(action);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlashAction(null), 600);
  }, []);

  const handleCopyClick = () => {
    onCopy?.();
    triggerFlash("copy");
  };

  const handleCutClick = () => {
    onCut?.();
    triggerFlash("cut");
  };

  const handlePasteClick = () => {
    onPaste?.();
    triggerFlash("paste");
  };

  return (
    <div className="w-full border-b dark:border-none border-gray-100 bg-white px-8 pt-5 pb-3 flex flex-col gap-4 shrink-0 select-none">
      
      {/* UPPER ROW: Breadcrumbs & Windows Operating Window Controls */}
      <div className="flex items-center justify-between w-full">
        {/* Dynamic Micro-Breadcrumbs */}
        <div className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-slate-500 font-medium min-w-0">
          {(() => {
            const maxVisible = 3;
            const shouldTruncate = currentPath.length > maxVisible;
            const visibleNodes = shouldTruncate
              ? [
                  { node: currentPath[0], index: 0 },
                  { node: null, index: -1 },
                  { node: currentPath[currentPath.length - 2], index: currentPath.length - 2 },
                  { node: currentPath[currentPath.length - 1], index: currentPath.length - 1 },
                ]
              : currentPath.map((node, index) => ({ node, index }));

            return visibleNodes.map((item, i) => {
              if (item.node === null) {
                return (
                  <React.Fragment key="ellipsis">
                    <span className="text-gray-300 dark:text-slate-600 select-none px-0.5">...</span>
                    <ChevronRight className="w-3 h-3 text-gray-300 dark:text-slate-650" />
                  </React.Fragment>
                );
              }
              const isLast = item.index === currentPath.length - 1;
              return (
                <React.Fragment key={`${item.index}-${item.node}`}>
                  <span
                    onClick={() => onBreadcrumbClick?.(item.index)}
                    className={`hover:text-gray-700 dark:hover:text-slate-350 transition-colors cursor-pointer whitespace-nowrap ${isLast ? "text-gray-900 dark:text-white font-semibold" : ""}`}
                    title={shouldTruncate && !isLast && item.index !== 0 ? item.node : undefined}
                  >
                    {item.node}
                  </span>
                  {!isLast && <ChevronRight className="w-3 h-3 text-gray-300 dark:text-slate-650 shrink-0" />}
                </React.Fragment>
              );
            });
          })()}
        </div>

        {/* Minimalist Native OS Control Triggers */}
        <div className="flex items-center gap-4 text-gray-400">
          <button onClick={onClose} className="hover:text-red-500 transition-colors"><X className="w-3.5 h-3.5 stroke-[2.5]" /></button>
        </div>
      </div>

      {/* LOWER ROW: Structural Functional Toolbar Matrix */}
      <div className="flex items-center justify-between w-full pt-1">
        
        {/* Left Control Cluster: Browser Arrows, Scaling Grid Engine */}
        <div className="flex items-center gap-6">
          {/* History Nav Arrow Toggles */}
          <div className="flex items-center gap-3 text-gray-400">
            <button 
              onClick={onBackArrowClick} 
              disabled={!canGoBack} 
              className="hover:text-gray-900 transition-colors disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
            >
              <ArrowLeft className="w-4 h-4 stroke-[2.5]" />
            </button>
            <button
              onClick={onForwardArrowClick}
              disabled={!canGoForward}
              className="hover:text-gray-900 transition-colors disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
            >
              <ArrowRight className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>

          {/* Precision Layout Sizing Engine Component */}
          <div className="flex items-center gap-2.5 bg-gray-50/50 dark:bg-slate-800 border border-gray-100 dark:border-none px-3 py-1.5 rounded-xl">
            <LayoutGrid className="w-4 h-4 text-gray-400 dark:text-slate-500" />
            <input 
              type="range"
              min="0.6"
              max="1.6"
              step="0.01"
              value={sizeMultiplier}
              onChange={(e) => setSizeMultiplier(parseFloat(e.target.value))}
              className="w-16 h-1 bg-gray-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-gray-900 dark:accent-slate-200 focus:outline-none"
            />
            <SlidersHorizontal className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500" />
          </div>

          {/* Sort Order Action Trigger */}
          <button 
            onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
            className="flex items-center gap-1.5 text-xs font-bold text-gray-800 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800 px-2.5 py-1.5 rounded-xl transition-all border border-transparent hover:border-gray-100 dark:hover:border-transparent"
          >
            <ArrowUpDown className="w-4 h-4 text-gray-500 dark:text-slate-400 stroke-[2.5]" />
            <span>{sortOrder === "asc" ? "A - Z" : "Z - A"}</span>
          </button>
          
          {/* Explicit View Toggle */}
          <button 
            onClick={() => setViewMode(viewMode === "grid" ? "list" : "grid")}
            className="flex items-center gap-1.5 text-xs font-bold text-gray-800 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800 px-2.5 py-1.5 rounded-xl transition-all border border-transparent hover:border-gray-100 dark:hover:border-transparent"
          >
            <LayoutGrid className="w-4 h-4 text-gray-500 dark:text-slate-400 stroke-[2.5]" />
            <span>{viewMode === "grid" ? "Grid" : "List"}</span>
          </button>
        </div>

        {/* Right Control Cluster: Interactive Macros, Visibility Toggles, Search */}
        <div className="flex items-center gap-1">
          
          <div className="flex items-center gap-0.5 border-r border-gray-100 dark:border-none pr-2 mr-2">
            {activeFilter === "recycle" ? (
              <>
                <button 
                  onClick={onRestore}
                  disabled={selectedCount === 0}
                  title="Restore Selection" 
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-blue-600 hover:bg-blue-50 disabled:hover:bg-transparent rounded-xl transition-colors disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                >
                  <RotateCcw className="w-4 h-4 stroke-[2.2]" />
                  <span>Restore Selection</span>
                </button>
                <button 
                  onClick={onEmptyRecycle}
                  disabled={isRecycleEmpty}
                  title="Empty Recycle Bin" 
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50 disabled:hover:bg-transparent rounded-xl transition-colors disabled:opacity-35 cursor-pointer disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-4 h-4 stroke-[2.2]" />
                  <span>Empty Recycle Bin</span>
                </button>
                <button 
                  onClick={onDelete} 
                  disabled={selectedCount === 0} 
                  title="Delete Permanently" 
                  className="p-2 text-red-600 hover:bg-red-50 rounded-xl transition-colors disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-4 h-4 stroke-[2.2]" />
                </button>
                <button 
                  onClick={onSelectAll} 
                  title="Select All" 
                  className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-xl transition-colors cursor-pointer"
                >
                  <CheckSquare className="w-4 h-4 stroke-[2.2]" />
                </button>
              </>
            ) : (
              <>
                <button 
                  onClick={onCreateFolder}
                  title="New Folder" 
                  className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-xl transition-colors cursor-pointer"
                >
                  <FolderPlus className="w-4 h-4 stroke-[2.2]" />
                </button>
                <button 
                  onClick={onCreateFile}
                  title="New Markdown File" 
                  className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-xl transition-colors cursor-pointer"
                >
                  <FilePlus className="w-4 h-4 stroke-[2.2]" />
                </button>
                <button onClick={onSelectAll} title="Select All" className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-xl transition-colors cursor-pointer">
                  <CheckSquare className="w-4 h-4 stroke-[2.2]" />
                </button>
                <button
                  onClick={handleCopyClick}
                  disabled={selectedCount === 0}
                  title="Copy"
                  className={`p-2 rounded-xl transition-all duration-200 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed ${
                    flashAction === "copy"
                      ? "text-blue-600 bg-blue-100 scale-110"
                      : clipboardMode === "copy"
                      ? "text-blue-600 bg-blue-50"
                      : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                  }`}
                >
                  <Copy className="w-4 h-4 stroke-[2.2]" />
                </button>
                <button
                  onClick={handleCutClick}
                  disabled={selectedCount === 0}
                  title="Cut"
                  className={`p-2 rounded-xl transition-all duration-200 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed ${
                    flashAction === "cut"
                      ? "text-amber-600 bg-amber-100 scale-110"
                      : clipboardMode === "cut"
                      ? "text-amber-600 bg-amber-50"
                      : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                  }`}
                >
                  <Scissors className="w-4 h-4 stroke-[2.2]" />
                </button>
                <button
                  onClick={handlePasteClick}
                  disabled={clipboardCount === 0}
                  title="Paste"
                  className={`p-2 rounded-xl transition-all duration-200 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed ${
                    flashAction === "paste"
                      ? "text-emerald-600 bg-emerald-100 scale-110"
                      : clipboardCount > 0
                      ? "text-emerald-600 bg-emerald-50"
                      : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                  }`}
                >
                  <Clipboard className="w-4 h-4 stroke-[2.2]" />
                </button>
                <button onClick={onDelete} disabled={selectedCount === 0} title="Delete" className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed">
                  <Trash2 className="w-4 h-4 stroke-[2.2]" />
                </button>
              </>
            )}
          </div>

          <div className="flex items-center gap-0.5">
            <button 
              onClick={onRefresh}
              disabled={isRefreshing}
              title="Refresh Directory" 
              className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-xl transition-colors disabled:opacity-50 cursor-pointer"
            >
              <RotateCw className={`w-4 h-4 stroke-[2.2] ${isRefreshing ? "animate-spin" : ""}`} />
            </button>
            <button 
              onClick={onToggleDetails}
              title="View Properties" 
              className={`p-2 rounded-xl transition-colors cursor-pointer ${showDetails ? "text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-950/30" : "text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800"}`}
            >
              <Info className="w-4 h-4 stroke-[2.2]" />
            </button>
            <div className="relative flex items-center group ml-1">
              <Search className="absolute left-2.5 w-3.5 h-3.5 text-gray-400 dark:text-slate-500 group-focus-within:text-gray-900 dark:group-focus-within:text-slate-200 transition-colors pointer-events-none stroke-[2.5]" />
              <input
                type="text"
                placeholder="Search..."
                aria-label="Search files"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-gray-50/50 dark:bg-slate-800 border border-gray-100 dark:border-none pl-8 pr-3 py-1.5 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-slate-700 focus:bg-white dark:focus:bg-slate-800 text-gray-850 dark:text-slate-200 w-32 focus:w-48 transition-all placeholder:text-gray-400 dark:placeholder:text-slate-500 placeholder:font-medium"
              />
            </div>
          </div>

        </div>

      </div>
    </div>
  );
};
