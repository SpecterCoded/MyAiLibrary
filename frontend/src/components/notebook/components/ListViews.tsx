import React, { useState } from 'react';
import { useAppContext } from '../AppContext';
import { FileText, Trash2, Clock, RotateCcw, Trash, FolderOpen, Folder, LayoutGrid, List } from 'lucide-react';

export function FolderView() {
  const { notes, folders, selectedFolderId, setCurrentView, setSelectedNoteId, setSelectedFolderId } = useAppContext();
  
  const folder = folders.find(f => f.id === selectedFolderId);
  if (!folder) return null;

  const childFolders = folders.filter(f => f.parentId === selectedFolderId);
  const folderNotes = notes.filter(n => n.folderId === selectedFolderId && n.status === 'active');

  return (
    <div className="mx-auto w-full max-w-[1100px] px-12 py-16 pb-40">
      <div className="flex items-center gap-3 mb-8 pl-[54px] pr-4 text-[#37352F]">
        <span className="text-[40px] leading-none mb-1"><FolderOpen size={40} /></span>
        <h1 className="text-[48px] font-bold leading-[1.2] tracking-tight text-inherit">{folder.name}</h1>
      </div>
      
      <div className="pl-[54px] pr-4 space-y-2">
        {childFolders.length === 0 && folderNotes.length === 0 ? (
          <div className="text-gray-500 py-8 font-medium">This folder is empty.</div>
        ) : (
          <>
            {childFolders.map(child => (
              <div 
                key={child.id}
                className="group flex flex-col p-4 rounded-lg border border-[#EFEFED] hover:bg-[#F9F9F8] cursor-pointer transition-colors"
                onClick={() => {
                  setSelectedFolderId(child.id);
                  setCurrentView('folder');
                }}
              >
                <div className="flex items-center gap-3 font-semibold text-[18px] text-[#37352F]">
                  <span className="text-2xl"><Folder size={24} className="text-[#9A9A97]" /></span>
                  {child.name}
                </div>
              </div>
            ))}

            {folderNotes.map(note => (
              <div 
                key={note.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', note.id);
                }}
                className="group flex flex-col p-4 rounded-lg border border-[#EFEFED] hover:bg-[#F9F9F8] cursor-pointer transition-colors mt-2"
                onClick={() => {
                  setSelectedNoteId(note.id);
                  setCurrentView('note');
                }}
              >
                <div className="flex items-center gap-3 font-semibold text-[18px] text-[#37352F] mb-1">
                  <span className="text-2xl">{note.icon || '📄'}</span>
                  {note.title || 'Untitled Note'}
                </div>
                <div className="flex items-center text-[13px] text-gray-500 gap-4 pl-8">
                  <span className="flex items-center gap-1.5 font-medium"><Clock size={12} /> Last edited {new Date(note.updatedAt).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

export function DraftsList() {
  const { notes, setCurrentView, setSelectedNoteId } = useAppContext();
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const drafts = notes.filter(n => n.status === 'draft');

  return (
    <div className="mx-auto w-full max-w-[1100px] px-12 py-16 pb-40">
      <div className="flex items-center justify-between mb-8 pl-[54px] pr-4 text-[#37352F]">
        <div className="flex items-center gap-3">
          <FileText size={40} />
          <h1 className="text-[48px] font-bold leading-[1.2] tracking-tight text-inherit">Drafts</h1>
        </div>
        <div className="flex items-center gap-2 bg-[#F9F9F8] p-1 rounded-lg border border-[#EFEFED]">
          <button 
            className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-white shadow-sm text-[#37352F]' : 'text-[#9A9A97] hover:text-[#37352F]'}`}
            onClick={() => setViewMode('list')}
            title="List View"
          >
            <List size={18} />
          </button>
          <button 
            className={`p-1.5 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-white shadow-sm text-[#37352F]' : 'text-[#9A9A97] hover:text-[#37352F]'}`}
            onClick={() => setViewMode('grid')}
            title="Grid View"
          >
            <LayoutGrid size={18} />
          </button>
        </div>
      </div>
      
      <div className={`pl-[54px] pr-4 ${viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4' : 'space-y-2'}`}>
        {drafts.length === 0 ? (
          <div className="text-gray-500 py-8 font-medium col-span-full">No drafts found.</div>
        ) : (
          drafts.map(note => (
            <div 
              key={note.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', note.id);
              }}
              className="group flex flex-col p-4 rounded-lg border border-[#EFEFED] hover:bg-[#F9F9F8] cursor-pointer transition-colors"
              onClick={() => {
                setSelectedNoteId(note.id);
                setCurrentView('note');
              }}
            >
              <div className="font-semibold text-[18px] text-[#37352F] mb-1">{note.title || 'Untitled Note'}</div>
              <div className="flex items-center text-[13px] text-gray-500 gap-4">
                <span className="flex items-center gap-1.5 font-medium"><Clock size={12} /> {new Date(note.updatedAt).toLocaleDateString()}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function RecentList() {
  const { notes, setCurrentView, setSelectedNoteId } = useAppContext();
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const recent = [...notes]
    .filter(n => n.status !== 'deleted')
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 20);

  return (
    <div className="mx-auto w-full max-w-[1100px] px-12 py-16 pb-40">
      <div className="flex items-center justify-between mb-8 pl-[54px] pr-4 text-[#37352F]">
        <div className="flex items-center gap-3">
          <Clock size={40} />
          <h1 className="text-[48px] font-bold leading-[1.2] tracking-tight text-inherit">Recent</h1>
        </div>
        <div className="flex items-center gap-2 bg-[#F9F9F8] p-1 rounded-lg border border-[#EFEFED]">
          <button 
            className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-white shadow-sm text-[#37352F]' : 'text-[#9A9A97] hover:text-[#37352F]'}`}
            onClick={() => setViewMode('list')}
            title="List View"
          >
            <List size={18} />
          </button>
          <button 
            className={`p-1.5 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-white shadow-sm text-[#37352F]' : 'text-[#9A9A97] hover:text-[#37352F]'}`}
            onClick={() => setViewMode('grid')}
            title="Grid View"
          >
            <LayoutGrid size={18} />
          </button>
        </div>
      </div>
      
      <div className={`pl-[54px] pr-4 ${viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4' : 'space-y-2'}`}>
        {recent.length === 0 ? (
          <div className="text-gray-500 py-8 font-medium col-span-full">No recent notes.</div>
        ) : (
          recent.map(note => (
            <div 
              key={note.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', note.id);
              }}
              className="group flex flex-col p-4 rounded-lg border border-[#EFEFED] hover:bg-[#F9F9F8] cursor-pointer transition-colors"
              onClick={() => {
                setSelectedNoteId(note.id);
                setCurrentView('note');
              }}
            >
              <div className="font-semibold text-[18px] text-[#37352F] mb-1">{note.title || 'Untitled Note'}</div>
              <div className="flex items-center text-[13px] text-gray-500 gap-4">
                <span className="flex items-center gap-1.5 font-medium"><FileText size={12} /> {new Date(note.updatedAt).toLocaleString()}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function DeletedList() {
  const { notes, folders, restoreNote, permanentlyDeleteNote, restoreFolder, permanentlyDeleteFolder } = useAppContext();
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const deletedNotes = notes.filter(n => n.status === 'deleted').sort((a, b) => b.updatedAt - a.updatedAt);
  const deletedFolders = folders.filter(f => f.isDeleted);

  return (
    <div className="mx-auto w-full max-w-[1100px] px-12 py-16 pb-40">
      <div className="flex items-center justify-between mb-8 pl-[54px] pr-4 text-[#37352F]">
        <div className="flex items-center gap-3">
          <Trash2 size={40} />
          <h1 className="text-[48px] font-bold leading-[1.2] tracking-tight text-inherit">Deleted</h1>
        </div>
        <div className="flex items-center gap-2 bg-[#F9F9F8] p-1 rounded-lg border border-[#EFEFED]">
          <button 
            className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-white shadow-sm text-[#37352F]' : 'text-[#9A9A97] hover:text-[#37352F]'}`}
            onClick={() => setViewMode('list')}
            title="List View"
          >
            <List size={18} />
          </button>
          <button 
            className={`p-1.5 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-white shadow-sm text-[#37352F]' : 'text-[#9A9A97] hover:text-[#37352F]'}`}
            onClick={() => setViewMode('grid')}
            title="Grid View"
          >
            <LayoutGrid size={18} />
          </button>
        </div>
      </div>
      
      <div className={`pl-[54px] pr-4 ${viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4' : 'space-y-2'}`}>
        {deletedNotes.length === 0 && deletedFolders.length === 0 ? (
          <div className="text-gray-500 py-8 font-medium col-span-full">No deleted items.</div>
        ) : (
          <>
            {deletedFolders.map(folder => (
              <div 
                key={folder.id}
                className={`flex ${viewMode === 'grid' ? 'flex-col items-start gap-4' : 'items-center justify-between'} p-4 rounded-lg border border-[#EFEFED] bg-[#F9F9F8] group hover:border-[#d9d9d6] transition-colors`}
              >
                <div className="flex items-center gap-3 opacity-70">
                  <FolderOpen size={20} className="text-[#9A9A97]" />
                  <div className="flex flex-col">
                    <div className="font-semibold text-[18px] text-[#37352F] mb-1 line-through truncate">{folder.name}</div>
                    <div className="flex items-center text-[13px] text-gray-400 font-medium gap-4">
                      <span>Folder</span>
                    </div>
                  </div>
                </div>
                <div className={`flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity ${viewMode === 'grid' ? 'w-full' : ''}`}>
                  <button 
                    className={`px-3 py-1.5 bg-white border border-[#EFEFED] rounded text-sm font-medium text-[#37352F] hover:bg-gray-50 flex items-center gap-1.5 ${viewMode === 'grid' ? 'flex-1 justify-center' : ''}`}
                    onClick={() => restoreFolder(folder.id)}
                  >
                    <RotateCcw size={14} /> Restore
                  </button>
                  <button 
                    className={`px-3 py-1.5 bg-red-50 border border-red-100 rounded text-sm font-medium text-red-600 hover:bg-red-100 flex items-center gap-1.5 shadow-sm ${viewMode === 'grid' ? 'flex-1 justify-center' : ''}`}
                    onClick={() => permanentlyDeleteFolder(folder.id)}
                  >
                    <Trash size={14} /> Delete 
                  </button>
                </div>
              </div>
            ))}
            {deletedNotes.map(note => (
              <div 
                key={note.id}
                className={`flex ${viewMode === 'grid' ? 'flex-col items-start gap-4' : 'items-center justify-between'} p-4 rounded-lg border border-[#EFEFED] bg-[#F9F9F8] group hover:border-[#d9d9d6] transition-colors`}
              >
                <div className="flex items-center gap-3 opacity-70">
                  <FileText size={20} className="text-[#9A9A97]" />
                  <div className="flex flex-col">
                    <div className="font-semibold text-[18px] text-[#37352F] mb-1 line-through truncate">{note.title || 'Untitled Note'}</div>
                    <div className="flex items-center text-[13px] text-gray-400 font-medium gap-4">
                      <span>Deleted on {new Date(note.updatedAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
                <div className={`flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity ${viewMode === 'grid' ? 'w-full' : ''}`}>
                  <button 
                    className={`px-3 py-1.5 bg-white border border-[#EFEFED] rounded text-sm font-medium text-[#37352F] hover:bg-gray-50 flex items-center gap-1.5 ${viewMode === 'grid' ? 'flex-1 justify-center' : ''}`}
                    onClick={() => restoreNote(note.id)}
                  >
                    <RotateCcw size={14} /> Restore
                  </button>
                  <button 
                    className={`px-3 py-1.5 bg-red-50 border border-red-100 rounded text-sm font-medium text-red-600 hover:bg-red-100 flex items-center gap-1.5 shadow-sm ${viewMode === 'grid' ? 'flex-1 justify-center' : ''}`}
                    onClick={() => permanentlyDeleteNote(note.id)}
                  >
                    <Trash size={14} /> Delete 
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
