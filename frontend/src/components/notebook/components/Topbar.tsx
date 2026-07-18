import React, { useState, useRef, useEffect } from 'react';
import { Star, Share, MoreHorizontal, LayoutTemplate, Trash2, Download } from 'lucide-react';
import { useAppContext } from '../AppContext';

export function Topbar() {
  const { notes, folders, selectedNoteId, selectedFolderId, currentView, sidebarOpen, setSidebarOpen, toggleFavorite, deleteNote, setSelectedFolderId, setCurrentView } = useAppContext();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [shareDropdownOpen, setShareDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const shareDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
      if (shareDropdownRef.current && !shareDropdownRef.current.contains(event.target as Node)) {
        setShareDropdownOpen(false);
      }
    };
    if (dropdownOpen || shareDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dropdownOpen, shareDropdownOpen]);

  const isNoteView = currentView === 'note';
  const note = isNoteView ? notes.find(n => n.id === selectedNoteId) : null;
  const folder = currentView === 'folder' ? folders.find(f => f.id === selectedFolderId) : null;

  // Handle views other than 'note' and 'folder'
  if (currentView !== 'note' && currentView !== 'folder') {
    return (
      <div className="flex h-14 w-full shrink-0 items-center justify-between border-b border-transparent bg-white px-6 transition-all duration-300">
        {!sidebarOpen && (
          <button
            className="text-[#9A9A97] hover:text-[#37352F] transition-colors p-2 rounded hover:bg-[#EFEFED]"
            onClick={() => setSidebarOpen(true)}
            title="Open sidebar"
          >
            <LayoutTemplate size={18} />
          </button>
        )}
      </div>
    );
  }

  // Fallback: note/folder view but no data loaded yet — still show sidebar toggle
  if ((currentView === 'note' && !note) || (currentView === 'folder' && !folder)) {
    return (
      <div className="flex h-14 shrink-0 items-center px-6 sm:px-10 bg-white/90 backdrop-blur z-10 transition-all duration-300">
        {!sidebarOpen && (
          <button
            className="text-[#9A9A97] hover:text-[#37352F] transition-colors p-1.5 rounded hover:bg-[#EFEFED]"
            onClick={() => setSidebarOpen(true)}
            title="Open sidebar"
          >
            <LayoutTemplate size={18} />
          </button>
        )}
      </div>
    );
  }

  // Compute breadcrumbs hierarchy based on folder links
  const breadcrumbItems = [];

  if (isNoteView && note) {
    if (note.folderId) {
      let currentFolderId: string | null = note.folderId;
      while (currentFolderId) {
        const parentFolder = folders.find(f => f.id === currentFolderId);
        if (parentFolder) {
          breadcrumbItems.unshift({ id: parentFolder.id, text: parentFolder.name, icon: typeof parentFolder.icon === 'string' ? parentFolder.icon : '📁', isFolder: true });
          currentFolderId = parentFolder.parentId || null;
        } else {
          currentFolderId = null;
        }
      }
    }
    breadcrumbItems.push({ id: note.id, text: note.title || 'Untitled', icon: note.icon || '📄', isLast: true, isFolder: false });
  } else if (currentView === 'folder' && folder) {
    let currentFolderId: string | null = folder.id;
    let isLastItem = true;
    while (currentFolderId) {
      const parentFolder = folders.find(f => f.id === currentFolderId);
      if (parentFolder) {
        breadcrumbItems.unshift({ id: parentFolder.id, text: parentFolder.name, icon: typeof parentFolder.icon === 'string' ? parentFolder.icon : '📁', isFolder: true, isLast: isLastItem });
        isLastItem = false;
        currentFolderId = parentFolder.parentId || null;
      } else {
        currentFolderId = null;
      }
    }
  }

  const exportNote = () => {
    if (!note) return;
    let textContent = `# ${note.title || 'Untitled'}\n\n`;
    if (note.content && Array.isArray(note.content)) {
      note.content.forEach((block: any) => {
        if (block.type === 'heading') {
          textContent += `## ${block.content || ''}\n\n`;
        } else if (block.type === 'paragraph') {
          if (typeof block.content === 'string') {
            textContent += `${block.content}\n\n`;
          } else if (Array.isArray(block.content)) {
            textContent += block.content.map((c: any) => c.text).join('') + '\n\n';
          }
        } else if (block.type === 'numberedListItem') {
          textContent += `- ${Array.isArray(block.content) ? block.content.map((c: any) => c.text).join('') : block.content}\n\n`;
        }
      });
    }

    const blob = new Blob([textContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${note.title || 'Untitled'}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setShareDropdownOpen(false);
  };

  return (
    <div className="flex h-14 shrink-0 items-center justify-between px-6 sm:px-10 text-[#37352F] sticky top-0 bg-white/90 backdrop-blur z-10 transition-all duration-300">
      <div className="flex items-center overflow-hidden whitespace-nowrap">
        {!sidebarOpen && (
          <button
            className="text-[#9A9A97] hover:text-[#37352F] transition-colors p-1.5 mr-3 rounded hover:bg-[#EFEFED]"
            onClick={() => setSidebarOpen(true)}
          >
            <LayoutTemplate size={18} />
          </button>
        )}
        <div className="flex items-center space-x-2 text-[14px]">
          {breadcrumbItems.map((item, i) => (
            <React.Fragment key={i}>
              <BreadcrumbItem
                icon={item.icon}
                text={item.text}
                isLast={item.isLast}
                onClick={() => {
                  if (item.isFolder) {
                    setSelectedFolderId(item.id);
                    setCurrentView('folder');
                  }
                }}
              />
              {i < breadcrumbItems.length - 1 && <span className="text-[#9A9A97] mx-1">/</span>}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="flex items-center space-x-4 pl-4 shrink-0 relative">
        {isNoteView && note && (
          <>
            <button
              className="text-[#9A9A97] hover:text-[#37352F] transition-colors"
              onClick={() => toggleFavorite(note.id)}
              title={note.isFavorite ? "Remove from favorites" : "Add to favorites"}
            >
              <Star size={18} fill={note.isFavorite ? '#F5C642' : 'none'} className={note.isFavorite ? 'text-[#F5C642]' : ''} />
            </button>

            <div className="relative" ref={shareDropdownRef}>
              <button
                className={`transition-colors ${shareDropdownOpen ? 'text-[#37352F]' : 'text-[#9A9A97] hover:text-[#37352F]'}`}
                onClick={() => setShareDropdownOpen(!shareDropdownOpen)}
              >
                <Share size={18} />
              </button>

              {shareDropdownOpen && (
                <div className="absolute top-10 right-0 w-48 bg-white border border-[#EFEFED] rounded-lg shadow-lg py-1 z-20 font-sans text-[13px] font-medium text-[#37352F]">
                  <button
                    className="w-full flex items-center px-4 py-2 hover:bg-[#EFEFED] text-left transition-colors"
                    onClick={exportNote}
                  >
                    <Download size={14} className="mr-3 text-[#9A9A97]" />
                    Export as Markdown
                  </button>
                </div>
              )}
            </div>

            <div className="relative" ref={dropdownRef}>
              <button
                className={`transition-colors ${dropdownOpen ? 'text-[#37352F]' : 'text-[#9A9A97] hover:text-[#37352F]'}`}
                onClick={() => setDropdownOpen(!dropdownOpen)}
              >
                <MoreHorizontal size={18} />
              </button>

              {dropdownOpen && (
                <div className="absolute top-10 right-0 w-52 bg-white border border-[#EFEFED] rounded-lg shadow-lg py-1 z-20 font-sans text-[13px] font-medium text-[#37352F]">
                  <button
                    className="w-full flex items-center px-4 py-2 hover:bg-[#EFEFED] text-left transition-colors"
                    onClick={() => {
                      toggleFavorite(note.id);
                      setDropdownOpen(false);
                    }}
                  >
                    <Star size={14} className="mr-3 text-[#9A9A97]" />
                    {note.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                  </button>
                  <div className="h-px bg-[#EFEFED] my-1"></div>
                  <button
                    className="w-full flex items-center px-4 py-2 hover:bg-red-50 hover:text-red-600 text-left text-red-500 transition-colors group"
                    onClick={() => {
                      deleteNote(note.id);
                      setDropdownOpen(false);
                    }}
                  >
                    <Trash2 size={14} className="mr-3 group-hover:text-red-600" /> Delete
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function BreadcrumbItem({ icon, text, isLast, onClick }: { icon: string, text: string, isLast?: boolean, onClick?: () => void }) {
  return (
    <div
      className={`flex items-center hover:bg-[#EFEFED] px-1.5 py-1 rounded transition-colors ${isLast ? 'font-medium cursor-default' : 'text-[#737373] cursor-pointer'}`}
      onClick={!isLast ? onClick : undefined}
    >
      <span className="mr-1.5 text-sm">{icon}</span>
      <span className="truncate max-w-[200px]" title={text}>{text}</span>
    </div>
  );
}
