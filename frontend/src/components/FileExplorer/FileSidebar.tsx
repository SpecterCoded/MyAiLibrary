import React, { useState, useRef, useEffect } from "react";
import {
  Folder,
  Trash2,
  Clock,
  FileText,
  Download,
  Music,
  Image,
  Video,
  HardDrive,
  Plus,
  MoreVertical,
  PenLine,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

interface PrettySidebarProps {
  currentPath: string[];
  playlists?: import("./types").Playlist[];
  activePlaylistId?: string | null;
  onSelectPlaylist?: (id: string, name: string) => void;
  activeFilter?: string;
  onSelectFilter?: (filter: string) => void;
  onCreatePlaylist?: (name: string) => void;
  onRenamePlaylist?: (id: string, name: string) => void;
  onDeletePlaylist?: (id: string) => void;
}

interface SidebarItemProps {
  label: string;
  icon: React.ReactNode;
  isActive: boolean;
  onClick: () => void;
  trailing?: React.ReactNode;
}

const MAX_VISIBLE_PLAYLISTS = 3;

const SidebarItem: React.FC<SidebarItemProps> = ({ label, icon, isActive, onClick, trailing }) => {
  return (
    <div
      onClick={onClick}
      className={`sidebar-item-btn flex items-center justify-between px-3 py-1.5 rounded-xl text-xs cursor-pointer relative group border font-medium ${
        isActive
          ? "bg-white text-gray-900 shadow-[0_4px_12px_rgba(0,0,0,0.03)] border-transparent dark:bg-slate-800 dark:text-white"
          : "text-gray-500 border-transparent hover:bg-white/35 hover:text-gray-800 dark:text-slate-400 dark:hover:bg-slate-800/30 dark:hover:text-white"
      }`}
    >
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <div className="sidebar-item-icon shrink-0">
          {icon}
        </div>
        <span className="truncate">{label}</span>
      </div>
      {trailing && (
        <div className="shrink-0 ml-1">
          {trailing}
        </div>
      )}
      <div
        className={`sidebar-item-indicator absolute right-1.5 top-1/2 -translate-y-1/2 w-1 bg-blue-600 dark:bg-blue-400 rounded-full ${
          isActive ? "h-4 opacity-100" : "h-1 opacity-0"
        }`}
      />
    </div>
  );
};

export const FileSidebar: React.FC<PrettySidebarProps> = ({
  playlists = [],
  activePlaylistId = null,
  onSelectPlaylist,
  activeFilter = "all",
  onSelectFilter,
  onCreatePlaylist,
  onRenamePlaylist,
  onDeletePlaylist,
}) => {
  const [showAllPlaylists, setShowAllPlaylists] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const hasOverflow = playlists.length > MAX_VISIBLE_PLAYLISTS;

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    };
    if (openMenuId) {
      window.addEventListener("mousedown", handleClickOutside);
    }
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, [openMenuId]);

  const handleRenameSubmit = (id: string) => {
    const trimmed = renameValue.trim();
    if (trimmed && onRenamePlaylist) {
      onRenamePlaylist(id, trimmed);
    }
    setRenamingId(null);
    setRenameValue("");
  };

  const handleCreateSubmit = () => {
    const trimmed = newPlaylistName.trim();
    if (trimmed && onCreatePlaylist) {
      onCreatePlaylist(trimmed);
    }
    setCreatingPlaylist(false);
    setNewPlaylistName("");
  };

  const getIcon = (type: string, isActive: boolean) => {
    const cls = isActive ? "w-4 h-4 shrink-0" : "w-4 h-4 text-gray-400 shrink-0";
    switch(type) {
      case "all":
      case "folder":
        return <Folder className={`${cls} ${isActive ? "text-amber-500 fill-amber-400/20" : ""}`} />;
      case "recent":
        return <Clock className={`${cls} ${isActive ? "text-indigo-500" : ""}`} />;
      case "recycle":
        return <Trash2 className={`${cls} ${isActive ? "text-red-500" : ""}`} />;
      case "documents":
        return <FileText className={`${cls} ${isActive ? "text-rose-500" : ""}`} />;
      case "downloads":
        return <Download className={`${cls} ${isActive ? "text-blue-500" : ""}`} />;
      case "music":
        return <Music className={`${cls} ${isActive ? "text-emerald-500" : ""}`} />;
      case "pictures":
        return <Image className={`${cls} ${isActive ? "text-sky-500" : ""}`} />;
      case "videos":
        return <Video className={`${cls} ${isActive ? "text-violet-500" : ""}`} />;
      case "drive":
        return <HardDrive className={`${cls} ${isActive ? "text-slate-700" : ""}`} />;
      default:
        return <Folder className={`${cls}`} />;
    }
  };

  return (
    <aside className="w-[240px] min-w-[240px] max-w-[240px] h-full bg-white/40 backdrop-blur-xl border-r border-white/30 flex flex-col py-6 px-4 shrink-0 select-none">
      {/* App Brand Title */}
      <div className="text-sm font-black text-gray-900 dark:text-white px-3 mb-6 tracking-tight">
        File Explorer
      </div>

      {/* Navigation Scroll Layer */}
      <div className="flex-1 overflow-y-auto space-y-6 pr-1 custom-scrollbar">

        {/* SECTION 1: QUICK ACCESS */}
        <div>
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-3 mb-2">
            Quick Access
          </div>
          <nav className="space-y-0.5">
            <SidebarItem
              label="All Files"
              icon={getIcon("all", activeFilter === "all" && activePlaylistId !== null)}
              isActive={activeFilter === "all" && activePlaylistId !== null}
              onClick={() => onSelectFilter?.("all")}
            />
            <SidebarItem
              label="Recent"
              icon={getIcon("recent", activeFilter === "recent")}
              isActive={activeFilter === "recent"}
              onClick={() => onSelectFilter?.("recent")}
            />
            <SidebarItem
              label="Recycle Bin"
              icon={getIcon("recycle", activeFilter === "recycle")}
              isActive={activeFilter === "recycle"}
              onClick={() => onSelectFilter?.("recycle")}
            />
          </nav>
        </div>

        {/* SECTION 2: PLAYLISTS / WORKSPACES */}
        <div>
          <div className="flex items-center justify-between px-3 mb-2">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
              Playlists
            </span>
            <button
              onClick={() => setCreatingPlaylist(true)}
              className="p-0.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-200/50 transition-colors cursor-pointer"
              title="New Playlist"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* New Playlist Inline Input */}
          {creatingPlaylist && (
            <div className="px-3 mb-1">
              <input
                type="text"
                value={newPlaylistName}
                onChange={(e) => setNewPlaylistName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateSubmit();
                  if (e.key === "Escape") { setCreatingPlaylist(false); setNewPlaylistName(""); }
                }}
                onBlur={handleCreateSubmit}
                placeholder="Playlist name..."
                className="w-full text-xs px-2 py-1.5 rounded-lg border border-blue-400 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-800"
              />
            </div>
          )}

          <nav
            className={`space-y-0.5 ${hasOverflow && showAllPlaylists ? "max-h-[180px] overflow-y-auto pr-1" : ""}`}
            style={hasOverflow && showAllPlaylists ? { scrollbarWidth: "thin", scrollbarColor: "#d1d5db transparent" } : undefined}
          >
            {(showAllPlaylists ? playlists : playlists.slice(0, MAX_VISIBLE_PLAYLISTS)).map((p) => {
              const isSelected = String(p.id) === String(activePlaylistId);
              const isRenaming = renamingId === String(p.id);

              return (
                <div key={p.id} className="relative">
                  {isRenaming ? (
                    <div className="px-3 py-1.5">
                      <input
                        ref={renameInputRef}
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRenameSubmit(String(p.id));
                          if (e.key === "Escape") { setRenamingId(null); setRenameValue(""); }
                        }}
                        onBlur={() => handleRenameSubmit(String(p.id))}
                        className="w-full text-xs px-2 py-1 rounded-lg border border-blue-400 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-800"
                      />
                    </div>
                  ) : (
                    <SidebarItem
                      label={p.name || "Untitled Playlist"}
                      icon={getIcon("folder", isSelected)}
                      isActive={isSelected}
                      onClick={() => {
                        if (onSelectPlaylist) {
                          onSelectPlaylist(String(p.id), p.name || "Untitled Playlist");
                        }
                      }}
                      trailing={
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuId(openMenuId === String(p.id) ? null : String(p.id));
                          }}
                          className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-200/50 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                        >
                          <MoreVertical className="w-3 h-3" />
                        </button>
                      }
                    />
                  )}

                  {openMenuId === String(p.id) && (
                    <div
                      ref={menuRef}
                      className="absolute right-2 top-full z-50 w-40 bg-white/95 backdrop-blur-md border border-slate-200/80 rounded-xl shadow-xl p-1 flex flex-col text-xs text-slate-700 animate-scaleIn"
                    >
                      <button
                        onClick={() => {
                          setRenamingId(String(p.id));
                          setRenameValue(p.name || "");
                          setOpenMenuId(null);
                        }}
                        className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50 flex items-center gap-2.5 transition-colors cursor-pointer"
                      >
                        <PenLine className="w-3.5 h-3.5 text-slate-400" />
                        <span>Rename</span>
                      </button>
                      <button
                        onClick={() => {
                          if (onDeletePlaylist) onDeletePlaylist(String(p.id));
                          setOpenMenuId(null);
                        }}
                        className="w-full text-left px-3 py-2 rounded-lg hover:bg-red-50 text-red-600 flex items-center gap-2.5 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-red-400" />
                        <span>Delete</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </nav>

          {hasOverflow && (
            <button
              onClick={() => setShowAllPlaylists(!showAllPlaylists)}
              className="flex items-center gap-1.5 px-3 py-1.5 mt-1 text-[11px] font-medium text-blue-500 hover:text-blue-700 hover:bg-blue-50/50 rounded-lg transition-colors cursor-pointer w-full"
            >
              {showAllPlaylists ? (
                <>
                  <ChevronDown className="w-3 h-3" />
                  <span>Show less</span>
                </>
              ) : (
                <>
                  <ChevronRight className="w-3 h-3" />
                  <span>Show more ({playlists.length - MAX_VISIBLE_PLAYLISTS})</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* SECTION 3: LOCAL MACHINE DEVICE MAP (FILTERS) */}
        <div>
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-3 mb-2">
            This PC
          </div>
          <nav className="space-y-0.5">
            <SidebarItem
              label="Documents"
              icon={getIcon("documents", activeFilter === "documents")}
              isActive={activeFilter === "documents"}
              onClick={() => onSelectFilter?.("documents")}
            />
            <SidebarItem
              label="Music"
              icon={getIcon("music", activeFilter === "music")}
              isActive={activeFilter === "music"}
              onClick={() => onSelectFilter?.("music")}
            />
            <SidebarItem
              label="Pictures"
              icon={getIcon("pictures", activeFilter === "pictures")}
              isActive={activeFilter === "pictures"}
              onClick={() => onSelectFilter?.("pictures")}
            />
            <SidebarItem
              label="Videos"
              icon={getIcon("videos", activeFilter === "videos")}
              isActive={activeFilter === "videos"}
              onClick={() => onSelectFilter?.("videos")}
            />
          </nav>
        </div>

      </div>
    </aside>
  );
};
