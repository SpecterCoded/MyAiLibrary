import React, { useEffect } from 'react';
import { AppProvider, useAppContext } from './AppContext';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { EditorArea } from './components/EditorArea';
import { DraftsList, DeletedList, RecentList, FolderView } from './components/ListViews';
import { GraphView } from './components/GraphView';
import { SearchDialog } from './components/SearchDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { HelpDialog } from './components/HelpDialog';

function AppContent({ mainView }: { mainView: 'notebooks' | 'concepts' }) {
  const { currentView, selectedNoteId, sidebarOpen, addNote, setSearchOpen, setCurrentView } = useAppContext();

  useEffect(() => {
    if (mainView === 'concepts') {
      setCurrentView('graph');
    } else if (mainView === 'notebooks' && currentView === 'graph') {
      setCurrentView('note');
    }
  }, [mainView, setCurrentView]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept global shortcuts if user is typing text in standard inputs unless Cmd/Ctrl is pressed.
      // E.g., we still want to catch Cmd+N even from an input.

      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        addNote();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        setSearchOpen(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
        e.preventDefault();
        setCurrentView('recent');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [addNote, setSearchOpen, setCurrentView]);

  return (
    <div className="flex h-full w-full bg-white dark:bg-[#191919] font-sans">
      {/* App Window Wrapper */}
      <div className="flex h-full w-full overflow-hidden transition-all dark:bg-[#191919]">
        {sidebarOpen && (
          <Sidebar className="w-[280px] shrink-0 border-r border-[#EFEFED] bg-[#F7F7F5] dark:border-[#2A2A2A] dark:bg-[#1F1F1F] transition-all duration-300" />
        )}

        <div className="flex min-w-0 flex-1 flex-col bg-white dark:bg-[#191919] relative max-h-screen">
          <Topbar />
          <div className="flex-1 overflow-y-auto">
            {currentView === 'note' && <EditorArea key={selectedNoteId || "empty"} />}
            {currentView === 'drafts' && <DraftsList />}
            {currentView === 'deleted' && <DeletedList />}
            {currentView === 'recent' && <RecentList />}
            {currentView === 'folder' && <FolderView />}
            {currentView === 'graph' && <GraphView />}
          </div>
        </div>
      </div>
      <SearchDialog />
      <SettingsDialog />
      <HelpDialog />
    </div>
  );
}

export default function NotebookApp({ mainView }: { mainView: 'notebooks' | 'concepts' }) {
  return (
    <AppProvider>
      <AppContent mainView={mainView} />
    </AppProvider>
  );
}
