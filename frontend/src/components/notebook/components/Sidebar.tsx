import React, { useState, useRef } from 'react';
import { 
  PlusCircle, 
  Search, 
  Clock, 
  FileText, 
  Trash2, 
  Settings, 
  HelpCircle,
  ChevronRight,
  ChevronDown,
  LayoutTemplate,
  FolderOpen,
  FolderPlus,
  Network,
  Pencil
} from 'lucide-react';
import { useAppContext } from '../AppContext';

interface SidebarProps {
  className?: string;
}

export function Sidebar({ className }: SidebarProps) {
  const { 
    notes, folders, openFolderIds, toggleFolder, selectedNoteId, updateFolderName, updateNoteTitle,
    setSelectedNoteId, setCurrentView, currentView, addNote, addFolder, setSearchOpen, setSettingsOpen, setHelpOpen, setSidebarOpen,
    setSelectedFolderId, selectedFolderId, moveFolderToFolder, deleteFolder
  } = useAppContext();
  const [foldersMasterOpen, setFoldersMasterOpen] = useState(true);
  // Track drag-over on the root drop zone
  const [rootDragOver, setRootDragOver] = useState(false);

  const draftsCount = notes.filter(n => n.status === 'draft').length;
  const deletedCount = notes.filter(n => n.status === 'deleted').length + folders.filter(f => f.isDeleted).length;
  const favorites = notes.filter(n => n.isFavorite && n.status === 'active');

  // Get the currently-active playlist (if any)
  const activePlaylistId: string | null = (() => {
    if (selectedFolderId) {
      const f = folders.find(x => x.id === selectedFolderId);
      if (f) {
        if (f.isPlaylist) return f.id;
        return f.playlistId || null;
      }
    }
    return null;
  })();

  // Recursively render folders — constrained to a specific playlist sub-tree
  const renderFolderContent = (parentId: string | null, indentLevel: number, playlistScope: string | null) => {
    // For top-level (parentId=null) we want only playlists
    // For inside a playlist, we show subfolders scoped to that playlist
    const childFolders = folders.filter(f => f.parentId === parentId && !f.isDeleted);
    const folderNotes = notes.filter(n => n.folderId === parentId && n.status === 'active');

    return (
      <div key={`parent-${parentId || 'root'}`}>
        {childFolders.map(folder => {
          const isOpen = openFolderIds.has(folder.id);
          const isActive = folder.id === selectedFolderId;
          return (
            <div key={folder.id}>
              <SidebarItem 
                id={folder.id}
                icon={<FolderOpen size={16} className="text-[#9A9A97]" />}
                label={folder.name} 
                hasChevron 
                chevronOpen={isOpen}
                active={isActive && currentView === 'folder'}
                onClick={(e) => {
                  if (e) e.stopPropagation();
                  if (isActive && currentView === 'folder') {
                    setSelectedFolderId(null);
                    setCurrentView('note');
                  } else {
                    setSelectedNoteId(null);
                    setSelectedFolderId(folder.id);
                    setCurrentView('folder');
                  }
                }}
                onChevronClick={(e) => {
                  if (e) e.stopPropagation();
                  toggleFolder(folder.id);
                }}
                onRename={(newName) => updateFolderName(folder.id, newName)}
                onDelete={!folder.isPlaylist ? () => deleteFolder(folder.id) : undefined}
                indent={indentLevel}
                isFolder
                isPlaylist={folder.isPlaylist}
              />
              {isOpen && (
                <div>
                  {renderFolderContent(folder.id, indentLevel + 1, folder.isPlaylist ? folder.id : playlistScope)}
                </div>
              )}
            </div>
          );
        })}
        {folderNotes.map(note => (
          <SidebarItem 
            key={note.id}
            id={note.id}
            icon={<span className="text-sm">{note.icon || '📄'}</span>}
            label={note.title || 'Untitled Note'} 
            active={selectedNoteId === note.id && currentView === 'note'}
            onClick={() => {
              if (selectedNoteId === note.id && currentView === 'note') {
                setSelectedNoteId(null);
                setCurrentView('note');
              } else {
                setSelectedFolderId(null);
                setCurrentView('note');
                setSelectedNoteId(note.id);
              }
            }}
            onRename={(newTitle) => updateNoteTitle(note.id, newTitle)}
            indent={indentLevel}
            isNote
            showSpacer={true}
          />
        ))}
      </div>
    );
  };

  return (
    <div
      id="sidebar-panel-container"
      className={`flex flex-col text-[14px] text-[#37352F] ${className}`}

    >
      {/* Collapse toggle */}
      <div className="flex items-center gap-2 px-4 py-4">
        <div 
          className="ml-auto flex items-center justify-center opacity-50 hover:opacity-100 cursor-pointer transition-opacity text-[#9A9A97] hover:text-[#37352F]"
          onClick={() => setSidebarOpen(false)}
        >
          <LayoutTemplate size={16} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 sidebar-scroll">
        {/* Top Actions */}
        <div className="space-y-[2px] mb-4 mt-2">
          <SidebarItem icon={<PlusCircle size={16} />} label="New Note" shortcut="⌘N" onClick={() => addNote()} />
          <SidebarItem icon={<Search size={16} />} label="Search" shortcut="⌘S" onClick={() => setSearchOpen(true)} />
          <SidebarItem icon={<Clock size={16} />} label="Recent" shortcut="⌘R" active={currentView === 'recent'} onClick={() => setCurrentView('recent')} />
          <SidebarItem icon={<Network size={16} />} label="Graph View" shortcut="⌘G" active={currentView === 'graph'} onClick={() => setCurrentView('graph')} />
        </div>

        {/* Drafts & Deleted */}
        <div className="space-y-[2px] mb-6">
          <SidebarItem 
             icon={<FileText size={16} />} 
             label="Drafts" 
             badge={draftsCount.toString()} 
             active={currentView === 'drafts'}
             onClick={() => setCurrentView('drafts')}
          />
          <SidebarItem 
             icon={<Trash2 size={16} />} 
             label="Deleted" 
             badge={deletedCount.toString()} 
             active={currentView === 'deleted'}
             onClick={() => setCurrentView('deleted')}
          />
        </div>

        {/* Favourites */}
        {favorites.length > 0 && (
          <div className="mb-6">
            <div className="px-2 mb-1 text-[11px] font-semibold text-[#9A9A97] tracking-wider uppercase mt-6">Favourites</div>
            <div className="space-y-[2px]">
               {favorites.map(fav => (
                 <SidebarItem 
                    key={fav.id}
                    id={fav.id}
                    icon={<span className="text-sm">{fav.icon || '📄'}</span>} 
                    label={fav.title || 'Untitled Note'}
                    active={selectedNoteId === fav.id && currentView === 'note'}
                    onClick={() => {
                      if (selectedNoteId === fav.id && currentView === 'note') {
                        setSelectedNoteId(null);
                        setCurrentView('note');
                      } else {
                        setSelectedFolderId(null);
                        setCurrentView('note');
                        setSelectedNoteId(fav.id);
                      }
                    }}
                    onRename={(newTitle) => updateNoteTitle(fav.id, newTitle)}
                    isNote
                 />
               ))}
            </div>
          </div>
        )}

        {/* My Folders — drop zone for moving folders to root level */}
        <div 
          className="mb-6"
          onDragOver={(e) => {
            e.preventDefault();
            setRootDragOver(true);
          }}
          onDragLeave={(e) => {
            // Only clear if leaving the whole section (not entering a child)
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setRootDragOver(false);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            setRootDragOver(false);
            const rawData = e.dataTransfer.getData('text/plain');
            if (rawData) {
              const [type, draggedId] = rawData.split(':');
              if (type === 'folder') {
                moveFolderToFolder(draggedId, null);
              }
            }
          }}
        >
          <div className={`group flex items-center justify-between px-2 mb-1 mt-6 rounded-md transition-colors ${rootDragOver ? 'bg-[#F0EEE8] ring-1 ring-[#CFCDC6]' : ''}`}>
             <div
               className="flex items-center gap-1 cursor-pointer select-none"
               onClick={() => setFoldersMasterOpen(!foldersMasterOpen)}
             >
               <ChevronRight size={12} className={`text-[#9A9A97] transition-transform duration-200 ${foldersMasterOpen ? 'rotate-90' : ''}`} />
               <div className="text-[11px] font-semibold text-[#9A9A97] tracking-wider uppercase">My Folders</div>
             </div>
             <div className="flex items-center gap-1">
                <button
                  onClick={(e) => { e.stopPropagation(); addFolder(); }}
                  title="New Folder"
                  className="p-0.5 rounded hover:bg-[#EFEFED]"
                >
                  <FolderPlus size={14} className="text-[#9A9A97] hover:text-[#37352F]" />
                </button>
                <button onClick={(e) => { e.stopPropagation(); addNote(); }} title="New Note" className="p-0.5 rounded hover:bg-[#EFEFED]"><PlusCircle size={14} className="text-[#9A9A97] hover:text-[#37352F]" /></button>
             </div>
          </div>
          
          {foldersMasterOpen && (
            <div className="space-y-[2px]">
              {renderFolderContent(null, 0, null)}
            </div>
          )}
        </div>

        <div className="flex-1 min-h-[40px]" />
      </div>

      {/* Bottom Actions */}
      <div className="mt-auto px-2 pb-4 pt-2 border-t border-[#EFEFED]">
        <SidebarItem icon={<Settings size={16} />} label="Settings" onClick={() => setSettingsOpen(true)} />
        <SidebarItem icon={<HelpCircle size={16} />} label="Help & Support" onClick={() => setHelpOpen(true)} />
      </div>
    </div>
  );
}

function SidebarItem({ 
  id,
  icon, 
  label, 
  shortcut, 
  badge, 
  active,
  hasChevron,
  chevronOpen,
  onClick,
  onChevronClick,
  onRename,
  onDelete,
  indent = 0,
  isFolder,
  isNote,
  isPlaylist,
  showSpacer
}: { 
  id?: string,
  icon: React.ReactNode, 
  label: string, 
  shortcut?: string,
  badge?: string,
  active?: boolean,
  hasChevron?: boolean,
  chevronOpen?: boolean,
  onClick?: (e?: React.MouseEvent) => void,
  onChevronClick?: (e?: React.MouseEvent) => void,
  onRename?: (newName: string) => void,
  onDelete?: () => void,
  indent?: number,
  isFolder?: boolean,
  isNote?: boolean,
  isPlaylist?: boolean,
  showSpacer?: boolean
}) {
  const { moveNoteToFolder, moveFolderToFolder, editingId, setEditingId } = useAppContext();
  const [dragOver, setDragOver] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(label);
  const dragOverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    if (id && id === editingId) {
      setIsEditing(true);
      setEditValue(label);
    } else {
      setIsEditing(false);
    }
  }, [editingId, id, label]);

  const handleDragOver = (e: React.DragEvent) => {
    if (isFolder) {
      e.preventDefault();
      e.stopPropagation();
      if (dragOverTimerRef.current) clearTimeout(dragOverTimerRef.current);
      setDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (isFolder) {
      // Debounce so we don't flicker when moving between children
      dragOverTimerRef.current = setTimeout(() => setDragOver(false), 50);
    }
  };

  const canAcceptDrop = isFolder;

  return (
    <div
      className={`
        flex items-center group py-[5px] rounded-md cursor-pointer select-none transition-colors duration-150
        ${active ? 'bg-[#EFEFED] font-medium' : 'hover:bg-[#EFEFED]/60'}
        ${isDragging ? 'opacity-40' : 'opacity-100'}
        ${dragOver && canAcceptDrop ? 'ring-2 ring-inset ring-[#37352F] bg-[#F0EEE8] shadow-inner' : ''}
        ${active ? 'border-l-2 border-[#37352F]' : 'border-l-2 border-transparent'}
      `}
      style={{ paddingLeft: `${8 + indent * 14}px`, paddingRight: '8px' }}
      onClick={onClick}
      onDoubleClick={(e) => {
        if (onRename) {
          e.stopPropagation();
          setIsEditing(true);
          setEditValue(label);
        }
      }}
      draggable={isNote || (isFolder && !isPlaylist)}
      onDragStart={(e) => {
        if (id) {
          setIsDragging(true);
          if (isNote) {
            e.dataTransfer.setData('text/plain', `note:${id}`);
            e.dataTransfer.effectAllowed = 'move';
          } else if (isFolder && !isPlaylist) {
            e.dataTransfer.setData('text/plain', `folder:${id}`);
            e.dataTransfer.effectAllowed = 'move';
          }
          // Custom drag image: semi-transparent copy
          const ghost = document.createElement('div');
          ghost.style.cssText = `
            position: fixed; top: -9999px; left: -9999px;
            background: #37352F; color: white; padding: 6px 12px;
            border-radius: 6px; font-size: 13px; font-family: Inter, sans-serif;
            white-space: nowrap; pointer-events: none; opacity: 0.9;
            box-shadow: 0 4px 12px rgba(0,0,0,0.25);
          `;
          ghost.textContent = label;
          document.body.appendChild(ghost);
          e.dataTransfer.setDragImage(ghost, 0, 0);
          setTimeout(() => document.body.removeChild(ghost), 0);
        }
      }}
      onDragEnd={() => setIsDragging(false)}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(e) => {
        if (isFolder && id) {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(false);
          const rawData = e.dataTransfer.getData('text/plain');
          if (rawData) {
            const [type, draggedId] = rawData.split(':');
            if (type === 'note') {
              moveNoteToFolder(draggedId, id);
            } else if (type === 'folder') {
              moveFolderToFolder(draggedId, id);
            }
          }
        }
      }}
    >
      {hasChevron ? (
        <div 
          className="w-4 h-4 flex items-center justify-center mr-1 opacity-50 hover:opacity-100 transition-opacity text-[#37352F] -ml-1 cursor-pointer"
          onClick={onChevronClick}
        >
          {chevronOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      ) : showSpacer ? (
        <div className="w-4 h-4 mr-1 -ml-1" />
      ) : null}
      <div className="flex items-center justify-center w-6 h-6 mr-1.5 opacity-80 text-[#37352F]">
        {icon}
      </div>
      {isEditing ? (
        <input 
          autoFocus
          onFocus={(e) => e.target.select()}
          className="flex-1 w-full bg-white border border-[#EFEFED] rounded px-1 outline-none text-[14px] text-[#37352F] shadow-sm"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={() => {
            setIsEditing(false);
            setEditingId(null);
            if (editValue.trim() && editValue !== label && onRename) {
              onRename(editValue.trim());
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              setIsEditing(false);
              if (editValue.trim() && editValue !== label && onRename) {
                onRename(editValue.trim());
              }
            } else if (e.key === 'Escape') {
              setIsEditing(false);
              setEditValue(label);
            }
          }}
        />
      ) : (
        <div className="flex-1 truncate text-[14px]">{label}</div>
      )}
      {shortcut && !isEditing && <div className="text-[12px] text-[#9A9A97] font-medium tracking-widest">{shortcut}</div>}
      {badge && !isEditing && <div className="text-[13px] text-[#9A9A97] font-medium">{badge}</div>}

      {/* Hover action buttons for custom folders: rename + delete */}
      {isFolder && !isPlaylist && !isEditing && (onRename || onDelete) && (
        <div className="folder-actions flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ml-auto">
          {onRename && (
            <button
              title="Rename"
              className="p-0.5 rounded hover:bg-[#E5E3DC] text-[#9A9A97] hover:text-[#37352F] transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                setIsEditing(true);
                setEditValue(label);
              }}
            >
              <Pencil size={12} />
            </button>
          )}
          {onDelete && (
            <button
              title="Delete folder"
              className="p-0.5 rounded hover:bg-red-100 text-[#9A9A97] hover:text-red-500 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      )}

      {/* Drop indicator overlay when dragging over */}
      {dragOver && canAcceptDrop && (
        <div className="absolute inset-0 rounded-md pointer-events-none border-2 border-[#37352F] animate-pulse" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
      )}
    </div>
  );
}
