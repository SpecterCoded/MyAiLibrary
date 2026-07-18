import React, { useState, useEffect, useRef } from 'react';
import DashboardLayout from './components/Dashboard';
import Sidebar from './components/Sidebar';
import DashboardHeader, { type BackendUser } from './components/DashboardHeader';
import SearchAndActions from './components/SearchAndActions';
import type { PlaylistIconType } from './components/PlaylistCard';
import PlaylistGrid from './components/PlaylistGrid';
import LibraryView from './components/LibraryView';
import DownloadsView from './components/DownloadsView';
import CommandSearchModal from './components/SearchModal';
import CreatePlaylistModal from './components/CreatePlaylistModal';
import ImportContentModal from './components/ImportContentModal';
import NotificationPanel from './components/NotificationPanel';
import ActivityLogPanel from './components/ActivityLogPanel';
import { GridBackground } from './components/grid';
import { FileExplorerContainer as FileExplorer } from './components/FileExplorer/FileExplorer';
import { PipelineQueueDock } from './components/PipelineQueueDock';
import { motion, AnimatePresence } from "framer-motion";
import { Loader2 } from 'lucide-react';
import AudioPlayerApp from './components/audio-player/AudioPlayerApp';
import VideoPlayerApp from './components/video-player/VideoPlayerApp';
import NotebookApp from './components/notebook/App';
import ConceptsApp from './components/concepts/knowledge/Knowledge-baby';
import ChatApp from './components/chat/ChatApp';
import SettingsView from './components/SettingsView';
import MetricsDashboard from './components/MetricsDashboard';
import LogoLoading from './components/LogoLoading';
import DocumentIntelligencePage from './components/DocumentIntelligencePage';
import RagExplorerPage from './components/rag-explorer/RagExplorerPage';
import { init as initActivityLogger, destroy as destroyActivityLogger } from './utils/activityLogger';
import { auth } from './firebase';

interface PlaylistData {
  id: number;
  category: string;
  title: string;
  date: string;
  timeframe: string;
  iconType: PlaylistIconType;
  description: string;
}

import { SplitScreenLayout } from './components/auth/SplitScreenLayout';
import { LoginForm } from './components/auth/forms/LoginForm';
import { SignupForm } from './components/auth/forms/SignupForm';
import { AvatarSelection } from './components/auth/forms/AvatarSelection';
import { EmailVerification } from './components/auth/forms/EmailVerification';
import { ForgotPassword } from './components/auth/forms/ForgotPassword';
import { MacSetupAssistant } from './components/auth/MacSetupAssistant';

export type AuthView = 'login' | 'signup' | 'avatar' | 'verify' | 'forgot' | 'setup';

export interface AuthContextType {
  email: string;
  setEmail: (email: string) => void;
  name: string;
  setName: (name: string) => void;
  avatar: string;
  setAvatar: (avatar: string) => void;
  setView: (view: AuthView) => void;
  onLoginSuccess: () => void;
}
export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState<BackendUser | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [authExpired, setAuthExpired] = useState(false);

  // Global Glassmorphism Theme State (default to dark)
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>(() => {
    return (localStorage.getItem('app_theme') as any) || 'dark';
  });

  // Apply theme class to document element.
  // When set to 'system', this will dynamically track OS/Windows changes.
  useEffect(() => {
    const root = window.document.documentElement;

    const applyTheme = (isDark: boolean) => {
      const resolvedTheme = isDark ? 'dark' : 'light';
      root.classList.remove('light', 'dark');
      root.classList.add(resolvedTheme);
      root.style.colorScheme = resolvedTheme;
    };

    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      applyTheme(mediaQuery.matches);
      
      const handleChange = (e: MediaQueryListEvent) => applyTheme(e.matches);
      mediaQuery.addEventListener('change', handleChange);
      localStorage.setItem('app_theme', 'system');
      
      return () => mediaQuery.removeEventListener('change', handleChange);
    } else {
      applyTheme(theme === 'dark');
      localStorage.setItem('app_theme', theme);
    }
  }, [theme]);

  // Helper to fetch theme preference from settings
  const fetchThemePreference = async () => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token') || localStorage.getItem('access_token');
    if (!token) return;
    try {
      const res = await fetch('/me/settings', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const settings = await res.json();
        if (settings.theme) {
          setTheme(settings.theme);
        }
      }
    } catch (err) {
      console.error('Failed to load theme preference:', err);
    }
  };

  // Fetch theme preference on mount (especially useful for standalone audio/video player or login page if token exists)
  useEffect(() => {
    fetchThemePreference();
  }, []);

  // Fetch theme preference from settings when authenticated status changes
  useEffect(() => {
    if (isAuthenticated) {
      fetchThemePreference();
    }
  }, [isAuthenticated]);

  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(0);
  const isNotificationsLoadedRef = useRef(false);
  const unreadCountRef = useRef(0);
  const [hasActiveDownloads, setHasActiveDownloads] = useState(false);
  const authExpiredRef = useRef(false);

  const handleAuthExpired = () => {
    if (authExpiredRef.current) return;
    authExpiredRef.current = true;
    setAuthExpired(true);
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    setTimeout(() => {
      window.location.reload();
    }, 3000);
  };

  const playNotificationSound = () => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();

      const playTone = (freq: number, startTime: number, duration: number) => {
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, startTime);

        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(0.2, startTime + 0.04);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

        osc.connect(gainNode);
        gainNode.connect(ctx.destination);

        osc.start(startTime);
        osc.stop(startTime + duration);
      };

      const now = ctx.currentTime;
      playTone(523.25, now, 0.35);       // C5
      playTone(659.25, now + 0.08, 0.45); // E5
    } catch (e) {
      console.error("Failed to play notification sound:", e);
    }
  };

  const [hasUnreadDownloads, setHasUnreadDownloads] = useState(false);

  const fetchUnreadNotificationsCount = async () => {
    const token = localStorage.getItem('access_token');
    if (!isAuthenticated) return;
    if (!token) { handleAuthExpired(); return; }
    try {
      const response = await fetch('http://127.0.0.1:8000/notifications?tab=Inbox', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.status === 401) { handleAuthExpired(); return; }
      if (response.ok) {
        const data = await response.json();
        const unread = data.filter((n: any) => !n.is_read).length;
        const unreadDownloads = data.filter((n: any) => !n.is_read && n.category === 'download').length > 0;

        if (isNotificationsLoadedRef.current) {
          if (unread > unreadCountRef.current) {
            playNotificationSound();
          }
        } else {
          isNotificationsLoadedRef.current = true;
        }
        unreadCountRef.current = unread;
        setUnreadNotificationsCount(unread);
        setHasUnreadDownloads(unreadDownloads);
      }
    } catch (err) {
      console.error('Failed to fetch unread notifications count', err);
    }
  };

  const checkActiveDownloads = async () => {
    const token = localStorage.getItem('access_token');
    if (!isAuthenticated) {
      setHasActiveDownloads(false);
      return;
    }
    if (!token) { handleAuthExpired(); return; }
    try {
      const response = await fetch('http://127.0.0.1:8000/tasks', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.status === 401) { handleAuthExpired(); return; }
      if (response.ok) {
        const data = await response.json();
        const active = data.some((t: any) => t.status === 'queued' || t.status === 'processing');
        setHasActiveDownloads(active);
      }
    } catch (err) {
      console.error('Failed to fetch active tasks status', err);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchUnreadNotificationsCount();
      const notifInterval = setInterval(fetchUnreadNotificationsCount, 5000);

      checkActiveDownloads();
      const taskInterval = setInterval(checkActiveDownloads, 4000);

      return () => {
        clearInterval(notifInterval);
        clearInterval(taskInterval);
      };
    } else {
      setUnreadNotificationsCount(0);
      isNotificationsLoadedRef.current = false;
      setHasActiveDownloads(false);
    }
  }, [isAuthenticated]);

  const [authView, setAuthView] = useState<AuthView>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState('');

  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [isCreatePlaylistModalOpen, setIsCreatePlaylistModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isNotificationPanelOpen, setIsNotificationPanelOpen] = useState(false);
  const [isActivityLogOpen, setIsActivityLogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [currentView, setCurrentView] = useState<'home' | 'library' | 'folder' | 'downloads' | 'notebooks' | 'concepts' | 'chat' | 'metrics' | 'settings' | 'document-intelligence' | 'rag-explorer'>(() => {
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get('view');
    if (viewParam === 'folder') return 'folder';
    if (viewParam && ['home', 'library', 'downloads', 'notebooks', 'concepts', 'chat', 'settings', 'metrics', 'rag-explorer'].includes(viewParam)) {
      return viewParam as any;
    }
    return 'home';
  });
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('playlistId') || null;
  });
  const [selectedPlaylistName, setSelectedPlaylistName] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('playlistName') || '';
  });
  const [selectedDocumentIntelligenceResourceId, setSelectedDocumentIntelligenceResourceId] = useState<string | null>(null);
  const [returnViewFromDocumentIntelligence, setReturnViewFromDocumentIntelligence] = useState<'home' | 'library' | 'folder' | 'downloads' | 'notebooks' | 'concepts' | 'chat' | 'metrics' | 'settings' | 'rag-explorer'>('library');

  const handleNavigateToFolder = (id: string, name: string) => {
    setSelectedPlaylistId(id);
    setSelectedPlaylistName(name);
    setCurrentView('folder');
  };

  const checkSession = async (delayTransition = false) => {
    const startTime = Date.now();
    const token = localStorage.getItem('access_token');

    const finishSessionCheck = () => {
      if (delayTransition) {
        const elapsed = Date.now() - startTime;
        const delay = Math.max(0, 3000 - elapsed);
        setTimeout(() => {
          setLoadingAuth(false);
        }, delay);
      } else {
        setLoadingAuth(false);
      }
    };

    if (!token) {
      setCurrentUser(null);
      setIsAuthenticated(false);
      finishSessionCheck();
      return;
    }

    try {
      const response = await fetch('/me', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const profileData = await response.json();
        setCurrentUser(profileData);
        setIsAuthenticated(true);
      } else {
        // Token might be expired
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        setCurrentUser(null);
        setIsAuthenticated(false);
      }
    } catch (err) {
      console.error('Session check error:', err);
      setIsAuthenticated(false);
    } finally {
      finishSessionCheck();
    }
  };

  // Monitor Auth Session
  useEffect(() => {
    checkSession(true);
  }, []);

  // Proactively refresh backend JWT token every 30 minutes
  useEffect(() => {
    const interval = setInterval(async () => {
      const refreshToken = localStorage.getItem('refresh_token');
      const accessToken = localStorage.getItem('access_token');
      if (!refreshToken || !accessToken) return;
      
      try {
        const res = await fetch('/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            refresh_token: refreshToken,
            remember_me: localStorage.getItem('remember_me') === 'true',
          }),
        });
        if (res.ok) {
          const data = await res.json();
          localStorage.setItem('access_token', data.access_token);
        } else if (res.status === 401) {
          // Refresh token expired — force re-login
          handleAuthExpired();
        }
      } catch (err) {
        console.error('Token refresh failed:', err);
      }
    }, 30 * 60 * 1000); // 30 minutes
    return () => clearInterval(interval);
  }, []);

  // When the active workspace (storage path) changes, re-sync the user and reset
  // navigation to the library root so content remounts and re-fetches for the new
  // workspace â€” no page reload required.
  useEffect(() => {
    const handleWorkspaceChanged = () => {
      checkSession(false);
      setSelectedPlaylistId(null);
      setSelectedPlaylistName('');
      setCurrentView('library');
      // Nudge any already-mounted playlist/library views to refetch.
      window.dispatchEvent(new Event('refresh-playlists'));
    };
    window.addEventListener('workspace-changed', handleWorkspaceChanged);
    return () => window.removeEventListener('workspace-changed', handleWorkspaceChanged);
  }, []);

  const authContext: AuthContextType = {
    email, setEmail,
    name, setName,
    avatar, setAvatar,
    setView: (newView) => {
      setAuthView(newView);
    },
    onLoginSuccess: () => {
      checkSession(false);
    }
  };

  useEffect(() => {
    // Simulate loading data
    const timer = setTimeout(() => setIsLoading(false), 2000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handleOpenNotebookView = () => {
      setCurrentView('notebooks');
    };
    window.addEventListener('open-notebook-view', handleOpenNotebookView);
    return () => window.removeEventListener('open-notebook-view', handleOpenNotebookView);
  }, []);

  useEffect(() => {
    const handleAppNavigate = (e: Event) => {
      const customEvent = e as CustomEvent;
      const { view, id, name, resourceId } = customEvent.detail;
      if (view === 'folder') {
        setSelectedPlaylistId(id);
        setSelectedPlaylistName(name || 'Folder');
        setCurrentView('folder');
      } else if (view === 'document-intelligence') {
        setReturnViewFromDocumentIntelligence(currentView === 'document-intelligence' ? 'library' : currentView);
        setSelectedDocumentIntelligenceResourceId(resourceId || id || null);
        setCurrentView('document-intelligence');
      } else {
        setCurrentView(view);
      }
    };
    window.addEventListener('app-navigate', handleAppNavigate);
    return () => window.removeEventListener('app-navigate', handleAppNavigate);
  }, [currentView]);

  const toggleSearchModal = () => setIsSearchModalOpen(!isSearchModalOpen);
  const toggleCreatePlaylistModal = () => setIsCreatePlaylistModalOpen(!isCreatePlaylistModalOpen);
  const toggleImportModal = () => setIsImportModalOpen(!isImportModalOpen);
  const toggleNotificationPanel = () => setIsNotificationPanelOpen(!isNotificationPanelOpen);
  const toggleActivityLogPanel = () => setIsActivityLogOpen(!isActivityLogOpen);

  useEffect(() => {
    const handleGlobalSearchShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTypingContext =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        !!target?.closest('[contenteditable="true"]');

      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        setIsActivityLogOpen(prev => !prev);
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsSearchModalOpen(true);
        return;
      }

      if (isTypingContext) return;
    };

    window.addEventListener('keydown', handleGlobalSearchShortcut);
    return () => window.removeEventListener('keydown', handleGlobalSearchShortcut);
  }, []);

  // Initialize activity logger on mount, cleanup on unmount
  useEffect(() => {
    initActivityLogger();
    return () => destroyActivityLogger();
  }, []);



  // Strongly typed mock data from home.html
  const _playlists: PlaylistData[] = [
    {
      id: 1,
      category: "Product team stand-up",
      title: "Product team stand-up",
      date: "Sun - Sep 29th",
      timeframe: "02:35 PM - 02:45 PM",
      iconType: "standup",
      description: "Teddy's meeting focused on reviewing recent systems to the design system and aligning the team on next steps. The discussion covered component consistency across light and dark modes, type..."
    },
    {
      id: 2,
      category: "UX research findings",
      title: "UX research findings",
      date: "Tue - Sep 9th",
      timeframe: "11:00 AM - 11:30 AM",
      iconType: "concept",
      description: "Teddy's meeting focused on the better updates to our design system and acc next scope, the discussed maintaining candidates in light and dark modes, adapting typography Hierarchy and reporting buttons states and googling token..."
    },
    {
      id: 3,
      category: "Product roadmap planning",
      title: "Product roadmap planning",
      date: "Thu - Sep 10th",
      timeframe: "03:30 PM - 04:00 PM",
      iconType: "roadmap",
      description: "Teddy's meeting was all about reaching out the latest updates to our design system and figuring what's next in the team. We talked about keeping components consistent for both light and dark modes, tweaking the typography Hierarchy and ma..."
    }
  ];

  const handleSetupComplete = (newStorageRoot: string) => {
    if (currentUser) {
      setCurrentUser({
        ...currentUser,
        storage_root: newStorageRoot
      });
    }
  };

  const searchParams = new URLSearchParams(window.location.search);
  const isAudioPlayerView = searchParams.has("audioUrl") && searchParams.has("resourceId");
  const isVideoPlayerView = searchParams.has("videoUrl") && searchParams.has("resourceId");

  return (
    <AnimatePresence mode="wait">
      {isAudioPlayerView ? (
        <AudioPlayerApp key="audio-player" />
      ) : isVideoPlayerView ? (
        <VideoPlayerApp key="video-player" />
      ) : loadingAuth ? (
        <LogoLoading
          key="auth-loading"
          fullscreen
          size="lg"
          label="Initializing session..."
        />
      ) : !isAuthenticated ? (
        authView === 'setup' ? (
          <MacSetupAssistant
            key="temp-setup"
            user={sessionStorage.getItem('temp_signup') ? JSON.parse(sessionStorage.getItem('temp_signup')!) : { username: 'User' }}
            isTempOnboarding={true}
            onSetupComplete={() => {
              checkSession();
            }}
          />
        ) : (
          <SplitScreenLayout key="auth-layout">
            {authView === 'login' && <LoginForm ctx={authContext} />}
            {authView === 'signup' && <SignupForm ctx={authContext} />}
            {authView === 'avatar' && <AvatarSelection ctx={authContext} />}
            {authView === 'verify' && <EmailVerification ctx={authContext} />}
            {authView === 'forgot' && <ForgotPassword ctx={authContext} />}
          </SplitScreenLayout>
        )
      ) : currentUser && !currentUser.storage_root ? (
        <MacSetupAssistant
          key="onboarding-setup"
          user={currentUser}
          onSetupComplete={handleSetupComplete}
        />
      ) : (
        <DashboardLayout key="dashboard-layout">
          <AnimatePresence mode="wait">
            {currentView === 'document-intelligence' ? (
              <motion.div
                key="document-intelligence-view"
                initial={{ opacity: 0, scale: 0.96, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 16 }}
                transition={{
                  type: "spring",
                  damping: 25,
                  stiffness: 280,
                  mass: 0.8
                }}
                className="fixed inset-0 z-[100]"
              >
                {selectedDocumentIntelligenceResourceId ? (
                  <DocumentIntelligencePage
                    resourceId={selectedDocumentIntelligenceResourceId}
                    onBack={() => setCurrentView(returnViewFromDocumentIntelligence)}
                  />
                ) : null}
              </motion.div>
            ) : currentView !== 'folder' ? (
              <React.Fragment key="dashboard-view">
                {/* Side Navigation panel */}
                <Sidebar
                  user={currentUser}
                  activeTab={currentView}
                  hasActiveDownloads={hasActiveDownloads}
                  onTabChange={(tab) => {
                    if (
                      tab === 'home' ||
                      tab === 'library' ||
                      tab === 'downloads' ||
                      tab === 'notebooks' ||
                      tab === 'concepts' ||
                      tab === 'chat' ||
                      tab === 'settings' ||
                      tab === 'metrics' ||
                      tab === 'rag-explorer' ||
                      tab === 'teams' ||
                      tab === 'shared'
                    ) {
                      setCurrentView(tab as any);
                      window.dispatchEvent(new CustomEvent('app-navigate', { detail: { view: tab, name: tab } }));
                    }
                  }}
                />

                {/* Main Panel Content Feed View */}
                <motion.main
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                  className={`flex-1 flex flex-col relative z-0 p-0 overflow-y-auto overflow-x-hidden no-scrollbar min-w-0 ${
                    currentView === 'concepts'
                      ? 'h-[calc(100%-48px)] my-6 mx-6 rounded-[32px] bg-[#FCFBF9] dark:bg-[#25272b] border border-slate-200/60 dark:border-white/10 shadow-none backdrop-blur-none'
                      : 'h-[calc(100%-48px)] my-6 mx-6 rounded-[32px] bg-white/40 dark:bg-slate-900/30 backdrop-blur-2xl border border-white/60 dark:border-slate-800/40 shadow-sm dark:shadow-[0_24px_50px_-12px_rgba(0,0,0,0.4)]'
                  }`}
                >
                  <AnimatePresence mode="wait">
                    {currentView === 'home' ? (
                      <motion.div
                        key="home-tab"
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -12 }}
                        transition={{ duration: 0.22, ease: "easeOut" }}
                        className="flex flex-col flex-1 p-8 overflow-y-auto no-scrollbar h-full w-full relative"
                      >
                        <GridBackground />
                        <DashboardHeader
                          onSearchClick={toggleSearchModal}
                          onNotificationClick={toggleNotificationPanel}
                          onNavigate={(view) => setCurrentView(view as any)}
                          user={currentUser}
                          theme={theme}
                          setTheme={setTheme}
                          unreadCount={unreadNotificationsCount}
                        />
                        {/* Dynamic Context Greeting & Search Pills */}
                        <SearchAndActions
                          onCreatePlaylistClick={toggleCreatePlaylistModal}
                          onImportClick={toggleImportModal}
                          user={currentUser}
                        />

                        {/* Content Dynamic Matrix Grid Layout */}
                        <PlaylistGrid
                          isLoading={isLoading}
                          onNavigateToFolder={handleNavigateToFolder}
                          onCreatePlaylistClick={toggleCreatePlaylistModal}
                          onSeeAllClick={() => setCurrentView('library')}
                          limit={3}
                        />
                      </motion.div>
                    ) : currentView === 'downloads' ? (
                      <motion.div
                        key="downloads-tab"
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -12 }}
                        transition={{ duration: 0.22, ease: "easeOut" }}
                        className="flex flex-col flex-1 p-8 overflow-y-auto no-scrollbar h-full w-full"
                      >
                        <DashboardHeader
                          onSearchClick={toggleSearchModal}
                          onNotificationClick={toggleNotificationPanel}
                          onNavigate={(view) => setCurrentView(view as any)}
                          user={currentUser}
                          theme={theme}
                          setTheme={setTheme}
                          unreadCount={unreadNotificationsCount}
                        />
                        <div className="h-6" />
                        <DownloadsView onAddMore={toggleImportModal} />
                      </motion.div>
                    ) : currentView === 'notebooks' ? (
                      <motion.div
                        key="notebooks-tab"
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -12 }}
                        transition={{ duration: 0.22, ease: "easeOut" }}
                        className="flex flex-col flex-1 h-full w-full overflow-y-auto overflow-x-hidden no-scrollbar p-0 min-w-0"
                      >
                        <NotebookApp mainView={currentView} />
                      </motion.div>
                    ) : currentView === 'concepts' ? (
                      <motion.div
                        key="concepts-tab"
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -12 }}
                        transition={{ duration: 0.22, ease: "easeOut" }}
                        className="flex flex-col flex-1 h-full w-full overflow-y-auto overflow-x-hidden no-scrollbar p-0 min-w-0"
                      >
                        <ConceptsApp />
                      </motion.div>
                    ) : currentView === 'chat' ? (
                      <motion.div
                        key="chat-tab"
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -12 }}
                        transition={{ duration: 0.22, ease: "easeOut" }}
                        className="flex flex-col flex-1 h-full w-full overflow-y-auto overflow-x-hidden no-scrollbar p-0 min-w-0"
                      >
                        <ChatApp user={currentUser} />
                      </motion.div>
                    ) : currentView === 'metrics' ? (
                      <motion.div
                        key="metrics-tab"
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -12 }}
                        transition={{ duration: 0.22, ease: "easeOut" }}
                        className="flex flex-col flex-1 h-full w-full overflow-y-auto overflow-x-hidden no-scrollbar p-0 min-w-0"
                      >
                        <MetricsDashboard />
                      </motion.div>
                    ) : currentView === 'rag-explorer' ? (
                      <motion.div
                        key="rag-explorer-tab"
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -12 }}
                        transition={{ duration: 0.22, ease: "easeOut" }}
                        className="flex flex-col flex-1 h-full w-full overflow-y-auto overflow-x-hidden no-scrollbar p-0 min-w-0"
                      >
                        <RagExplorerPage
                          theme={theme}
                          setTheme={setTheme}
                        />
                      </motion.div>
                    ) : currentView === 'settings' ? (
                      <motion.div
                        key="settings-tab"
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -12 }}
                        transition={{ duration: 0.22, ease: "easeOut" }}
                        className="flex flex-col flex-1 h-full w-full overflow-y-auto overflow-x-hidden no-scrollbar p-0 min-w-0"
                      >
                        <SettingsView user={currentUser} onUserUpdate={checkSession} theme={theme} setTheme={setTheme} />
                      </motion.div>
                    ) : (
                      <motion.div
                        key="library-tab"
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -12 }}
                        transition={{ duration: 0.22, ease: "easeOut" }}
                        className="flex flex-col flex-1 p-8 overflow-y-auto no-scrollbar h-full w-full"
                      >
                        <DashboardHeader
                          onSearchClick={toggleSearchModal}
                          onNotificationClick={toggleNotificationPanel}
                          onNavigate={(view) => setCurrentView(view as any)}
                          user={currentUser}
                          theme={theme}
                          setTheme={setTheme}
                          unreadCount={unreadNotificationsCount}
                        />
                        <div className="h-6" />
                        <LibraryView
                          onNavigateToFolder={handleNavigateToFolder}
                          onCreatePlaylistClick={toggleCreatePlaylistModal}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.main>
              </React.Fragment>
            ) : (
              <motion.div
                key="explorer-view"
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                transition={{
                  type: "spring",
                  damping: 25,
                  stiffness: 300,
                  mass: 0.8
                }}
                className="fixed inset-0 z-[100]"
              >
                <FileExplorer
                  playlistId={selectedPlaylistId}
                  playlistName={selectedPlaylistName}
                  onBack={async () => {
                    // If they came from library or home, go back appropriately
                    setCurrentView(selectedPlaylistId ? 'library' : 'home');
                  }}
                  onNavigatePlaylist={(id, name) => {
                    setSelectedPlaylistId(id);
                    setSelectedPlaylistName(name);
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>
          <CommandSearchModal isOpen={isSearchModalOpen} onClose={toggleSearchModal} />
          <CreatePlaylistModal isOpen={isCreatePlaylistModalOpen} onClose={toggleCreatePlaylistModal} />
          <ImportContentModal
            isOpen={isImportModalOpen}
            onClose={toggleImportModal}
            onNavigateToDownloads={() => setCurrentView('downloads')}
          />
          <NotificationPanel
            isOpen={isNotificationPanelOpen}
            onClose={toggleNotificationPanel}
            onRefreshCount={fetchUnreadNotificationsCount}
          />
          <PipelineQueueDock />
          <ActivityLogPanel isOpen={isActivityLogOpen} onClose={toggleActivityLogPanel} />
        </DashboardLayout>
      )}

      {/* Auth Expired Modal */}
      <AnimatePresence>
        {authExpired && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[10000] flex items-center justify-center"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="bg-white rounded-[24px] shadow-2xl border border-gray-200 p-8 max-w-sm w-full mx-4 text-center"
            >
              <div className="w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-5">
                <svg className="w-7 h-7 text-amber-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">Session Expired</h3>
              <p className="text-sm text-gray-500 mb-6 leading-relaxed">
                Your login session has expired. Redirecting to sign in...
              </p>
              <div className="flex items-center justify-center gap-3">
                <svg className="w-5 h-5 text-gray-400 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                <span className="text-sm text-gray-500 font-medium">Redirecting in 3s...</span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </AnimatePresence>
  );
}

