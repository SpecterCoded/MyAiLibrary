import React, { useState, useEffect, useRef, useCallback } from 'react';
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
import { CheckCircle2, Download, Loader2 } from 'lucide-react';
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
import WorkspaceTitleBar from './components/WorkspaceTitleBar';
import { init as initActivityLogger, destroy as destroyActivityLogger } from './utils/activityLogger';
import { auth } from './firebase';
import type { WorkspaceTab, WorkspaceTabKind, WorkspaceTabParams, WorkspaceTabsState } from './types/workspaceTabs';

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
import { AuthWindowFrame } from './components/auth/AuthWindowFrame';
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

type DashboardView = 'home' | 'library' | 'folder' | 'downloads' | 'notebooks' | 'concepts' | 'chat' | 'metrics' | 'settings' | 'document-intelligence' | 'rag-explorer';

const MAX_WORKSPACE_TABS = 5;
const WORKSPACE_TABS_STORAGE_KEY = 'myai_workspace_tabs_v1';

const isDashboardView = (value: string | null): value is DashboardView =>
  !!value && ['home', 'library', 'folder', 'downloads', 'notebooks', 'concepts', 'chat', 'metrics', 'settings', 'document-intelligence', 'rag-explorer'].includes(value);

const makeWorkspaceTabId = () => `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const getWorkspaceTabTitle = (kind: WorkspaceTabKind, params: WorkspaceTabParams = {}) => {
  if (kind === 'folder') return params.playlistName || params.folderName || 'Folder';
  if (kind === 'audio-player') return params.playlistName || 'Audio';
  if (kind === 'video-player') return params.playlistName || 'Video';
  if (kind === 'document-intelligence') return 'Document Intelligence';
  if (kind === 'rag-explorer') return 'RAG Explorer';
  return ({
    home: 'Home',
    library: 'Library',
    downloads: 'Downloads',
    notebooks: 'Notebooks',
    concepts: 'Knowledge',
    chat: 'Ask AI',
    metrics: 'Metrics',
    settings: 'Settings',
  } as Partial<Record<WorkspaceTabKind, string>>)[kind] || 'Home';
};

const createWorkspaceTab = (kind: WorkspaceTabKind = 'home', params: WorkspaceTabParams = {}, title?: string): WorkspaceTab => {
  const now = Date.now();
  return {
    id: makeWorkspaceTabId(),
    kind,
    params,
    title: title || getWorkspaceTabTitle(kind, params),
    createdAt: now,
    updatedAt: now,
  };
};

const normalizeWorkspaceTabsState = (state: WorkspaceTabsState): WorkspaceTabsState => {
  const validTabs = state.tabs
    .filter((tab) => tab && tab.id && tab.kind)
    .filter((tab) => {
      if ((tab.kind === 'audio-player' || tab.kind === 'video-player') && (!tab.params?.resourceId || !tab.params?.mediaUrl)) return false;
      return true;
    })
    .slice(0, MAX_WORKSPACE_TABS);

  const tabs = validTabs.length > 0 ? validTabs : [createWorkspaceTab('home')];
  const activeTabId = tabs.some((tab) => tab.id === state.activeTabId) ? state.activeTabId : tabs[0].id;
  return { tabs, activeTabId };
};

const readInitialWorkspaceTabsState = (): WorkspaceTabsState => {
  const params = new URLSearchParams(window.location.search);
  const audioUrl = params.get('audioUrl');
  const videoUrl = params.get('videoUrl');
  const resourceId = params.get('resourceId') || undefined;
  const playlistId = params.get('playlistId') || undefined;
  const playlistName = params.get('playlistName') || undefined;
  const folderId = params.get('folderId') || undefined;
  const folderName = params.get('folderName') || undefined;
  const time = Number(params.get('t'));

  if (resourceId && (audioUrl || videoUrl)) {
    const kind: WorkspaceTabKind = audioUrl ? 'audio-player' : 'video-player';
    const mediaUrl = audioUrl || videoUrl || undefined;
    const tab = createWorkspaceTab(kind, {
      resourceId,
      mediaUrl,
      playlistId,
      playlistName,
      folderId,
      folderName,
      time: Number.isFinite(time) ? time : undefined,
    });
    window.history.replaceState({}, '', window.location.pathname);
    return { tabs: [tab], activeTabId: tab.id };
  }

  try {
    const stored = localStorage.getItem(WORKSPACE_TABS_STORAGE_KEY);
    if (stored) return normalizeWorkspaceTabsState(JSON.parse(stored));
  } catch {
    // Ignore corrupt tab state and start fresh.
  }

  const view = params.get('view');
  const kind: WorkspaceTabKind = isDashboardView(view) ? view : 'home';
  const tab = createWorkspaceTab(kind, {
    playlistId: params.get('playlistId') || undefined,
    playlistName: params.get('playlistName') || undefined,
    settingsTab: params.get('tab') || undefined,
  });
  return { tabs: [tab], activeTabId: tab.id };
};

const workspaceTabParamsEqual = (
  left: WorkspaceTabParams | undefined,
  right: WorkspaceTabParams | undefined,
) => {
  const leftParams = left || {};
  const rightParams = right || {};
  const keys = new Set([
    ...Object.keys(leftParams),
    ...Object.keys(rightParams),
  ] as Array<keyof WorkspaceTabParams>);

  return [...keys].every((key) => leftParams[key] === rightParams[key]);
};

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
      void window.desktop?.setTitleBarTheme(resolvedTheme);
    };

    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      let isMounted = true;

      if (window.desktop?.getSystemTheme) {
        window.desktop.getSystemTheme()
          .then((systemTheme) => {
            if (isMounted) applyTheme(systemTheme === 'dark');
          })
          .catch(() => {
            if (isMounted) applyTheme(mediaQuery.matches);
          });
      } else {
        applyTheme(mediaQuery.matches);
      }
      
      const handleChange = (e: MediaQueryListEvent) => applyTheme(e.matches);
      const removeDesktopThemeListener = window.desktop?.onSystemThemeChanged?.((systemTheme) => {
        applyTheme(systemTheme === 'dark');
      });

      if (!window.desktop?.onSystemThemeChanged) {
        mediaQuery.addEventListener('change', handleChange);
      }
      localStorage.setItem('app_theme', 'system');
      
      return () => {
        isMounted = false;
        removeDesktopThemeListener?.();
        mediaQuery.removeEventListener('change', handleChange);
      };
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
  const notificationAudioCtxRef = useRef<AudioContext | null>(null);
  const lastNotificationSoundAtRef = useRef(0);
  const [hasActiveDownloads, setHasActiveDownloads] = useState(false);
  const authExpiredRef = useRef(false);

  const clearStoredAuth = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
  };

  const handleAuthExpired = () => {
    if (authExpiredRef.current) return;
    authExpiredRef.current = true;
    setAuthExpired(true);
    clearStoredAuth();
    setTimeout(() => {
      window.location.reload();
    }, 3000);
  };

  const refreshBackendAccessToken = async (): Promise<string | null> => {
    const refreshToken = localStorage.getItem('refresh_token');
    if (!refreshToken) return null;

    try {
      const res = await fetch('/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refresh_token: refreshToken,
          remember_me: localStorage.getItem('remember_me') === 'true',
        }),
      });

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          clearStoredAuth();
        }
        return null;
      }

      const data = await res.json();
      if (typeof data.access_token !== 'string' || !data.access_token) return null;

      localStorage.setItem('access_token', data.access_token);
      return data.access_token;
    } catch (err) {
      console.error('Token refresh failed:', err);
      return null;
    }
  };

  const getNotificationAudioContext = () => {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return null;

    if (!notificationAudioCtxRef.current) {
      notificationAudioCtxRef.current = new AudioContextClass();
    }

    return notificationAudioCtxRef.current;
  };

  useEffect(() => {
    const unlockNotificationAudio = () => {
      const ctx = getNotificationAudioContext();
      if (ctx?.state === 'suspended') {
        void ctx.resume().catch(() => {
          // Chromium/Electron can reject until a real user gesture; the next gesture retries.
        });
      }
    };

    window.addEventListener('pointerdown', unlockNotificationAudio, { passive: true });
    window.addEventListener('keydown', unlockNotificationAudio);

    return () => {
      window.removeEventListener('pointerdown', unlockNotificationAudio);
      window.removeEventListener('keydown', unlockNotificationAudio);
    };
  }, []);

  const playNotificationSound = async () => {
    try {
      const nowMs = Date.now();
      if (nowMs - lastNotificationSoundAtRef.current < 1200) return;
      lastNotificationSoundAtRef.current = nowMs;

      const ctx = getNotificationAudioContext();
      if (!ctx) return;

      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

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
      console.warn("Notification sound could not play yet:", e);
    }
  };

  const [hasUnreadDownloads, setHasUnreadDownloads] = useState(false);

  const fetchUnreadNotificationsCount = async () => {
    let token = localStorage.getItem('access_token');
    if (!isAuthenticated) return;
    if (!token) {
      token = await refreshBackendAccessToken();
      if (!token) { handleAuthExpired(); return; }
    }
    try {
      let response = await fetch('/notifications?tab=Inbox', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.status === 401) {
        token = await refreshBackendAccessToken();
        if (!token) { handleAuthExpired(); return; }
        response = await fetch('/notifications?tab=Inbox', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.status === 401) { handleAuthExpired(); return; }
      }
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
    let token = localStorage.getItem('access_token');
    if (!isAuthenticated) {
      setHasActiveDownloads(false);
      return;
    }
    if (!token) {
      token = await refreshBackendAccessToken();
      if (!token) { handleAuthExpired(); return; }
    }
    try {
      let response = await fetch('/tasks', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.status === 401) {
        token = await refreshBackendAccessToken();
        if (!token) { handleAuthExpired(); return; }
        response = await fetch('/tasks', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.status === 401) { handleAuthExpired(); return; }
      }
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
  const [currentView, setCurrentView] = useState<DashboardView>(() => {
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
  const [returnViewFromDocumentIntelligence, setReturnViewFromDocumentIntelligence] = useState<Exclude<DashboardView, 'document-intelligence'>>('library');
  const [workspaceTabsState, setWorkspaceTabsState] = useState<WorkspaceTabsState>(() => {
    if (!window.desktop) return readInitialWorkspaceTabsState();
    const tab = createWorkspaceTab('home');
    return { tabs: [tab], activeTabId: tab.id };
  });
  const [workspaceWindowContextLoaded, setWorkspaceWindowContextLoaded] = useState(() => !window.desktop);
  const [isPrimaryWorkspaceWindow, setIsPrimaryWorkspaceWindow] = useState(true);
  const [isAttachingToPrimary, setIsAttachingToPrimary] = useState(false);
  const [desktopUpdateState, setDesktopUpdateState] = useState<DesktopUpdateState | null>(null);
  const [installedUpdateInfo, setInstalledUpdateInfo] = useState<DesktopInstalledUpdateInfo | null>(null);
  const [dismissedAvailableVersion, setDismissedAvailableVersion] = useState<string | null>(null);
  const [dismissedInstalledVersion, setDismissedInstalledVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!window.desktop) return;
    let active = true;
    void Promise.all([
      window.desktop.getUpdateState(),
      window.desktop.getInstalledUpdate(),
    ]).then(([state, installed]) => {
      if (!active) return;
      if (state) setDesktopUpdateState(state);
      if (installed) setInstalledUpdateInfo(installed);
    });
    const stopState = window.desktop.onUpdateState((state) => {
      if (active) setDesktopUpdateState(state);
    });
    const stopInstalled = window.desktop.onUpdateInstalled((info) => {
      if (active) setInstalledUpdateInfo(info);
    });
    return () => {
      active = false;
      stopState();
      stopInstalled();
    };
  }, []);

  useEffect(() => {
    if (!window.desktop || !workspaceWindowContextLoaded || !isPrimaryWorkspaceWindow) return;
    return window.desktop.onWorkspaceTabsAttached((state) => {
      const attachedState = normalizeWorkspaceTabsState(state);
      setWorkspaceTabsState(attachedState);
      const attachedTab =
        attachedState.tabs.find((tab) => tab.id === attachedState.activeTabId) ||
        attachedState.tabs[0];
      if (attachedTab) applyWorkspaceTab(attachedTab);
    });
  }, [workspaceWindowContextLoaded, isPrimaryWorkspaceWindow]);

  const openUpdatesTab = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('view', 'settings');
    url.searchParams.set('tab', 'updates');
    window.history.replaceState({}, '', `${url.pathname}${url.search}`);
    navigateWorkspace('settings', { settingsTab: 'updates' }, 'Settings');
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('myai:open-settings-tab', { detail: 'updates' }));
    }, 0);
  };

  const updateBadgeVisible = !!desktopUpdateState && ['available', 'downloading', 'ready-to-install'].includes(desktopUpdateState.status);
  const availableUpdateVersion = updateBadgeVisible ? desktopUpdateState?.availableVersion : undefined;
  const workspaceTabs = workspaceTabsState.tabs;
  const activeWorkspaceTab = workspaceTabs.find((tab) => tab.id === workspaceTabsState.activeTabId) || workspaceTabs[0];
  // Keep mounted page subtrees in a stable DOM order. The titlebar may be
  // reordered freely, but moving a live <video>, <audio>, or stateful page
  // subtree in the DOM can make Chromium reload it.
  const workspacePanelTabs = [...workspaceTabs].sort((left, right) => {
    const createdDelta = (left.createdAt || 0) - (right.createdAt || 0);
    return createdDelta || left.id.localeCompare(right.id);
  });

  const applyWorkspaceTab = (tab: WorkspaceTab) => {
    if (tab.kind === 'audio-player' || tab.kind === 'video-player') return;

    if (tab.kind === 'folder') {
      setSelectedPlaylistId(tab.params?.playlistId || null);
      setSelectedPlaylistName(tab.params?.playlistName || tab.params?.folderName || 'Folder');
    } else if (tab.kind !== 'document-intelligence') {
      setSelectedPlaylistId(null);
      setSelectedPlaylistName('');
    }

    if (tab.kind === 'document-intelligence') {
      setSelectedDocumentIntelligenceResourceId(tab.params?.resourceId || null);
      setReturnViewFromDocumentIntelligence(currentView === 'document-intelligence' ? 'library' : currentView);
    }

    setCurrentView(tab.kind as DashboardView);

    if (tab.kind === 'settings' && tab.params?.settingsTab) {
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('myai:open-settings-tab', { detail: tab.params?.settingsTab }));
      }, 0);
    }
  };

  useEffect(() => {
    if (!window.desktop) return;
    let active = true;
    void window.desktop.getWorkspaceWindowContext()
      .then((context) => {
        if (!active) return;
        setIsPrimaryWorkspaceWindow(context?.isPrimary ?? true);
        const restoredState = context?.tabsState
          ? normalizeWorkspaceTabsState(context.tabsState)
          : readInitialWorkspaceTabsState();
        setWorkspaceTabsState(restoredState);
        const restoredTab = restoredState.tabs.find((tab) => tab.id === restoredState.activeTabId) || restoredState.tabs[0];
        if (restoredTab) applyWorkspaceTab(restoredTab);
        setWorkspaceWindowContextLoaded(true);
      })
      .catch((error) => {
        console.error('Failed to load the workspace window context:', error);
        if (!active) return;
        const windowId = new URLSearchParams(window.location.search).get('workspaceWindow');
        setIsPrimaryWorkspaceWindow(!windowId || windowId === 'main');
        const fallbackState = readInitialWorkspaceTabsState();
        setWorkspaceTabsState(fallbackState);
        const fallbackTab = fallbackState.tabs.find((tab) => tab.id === fallbackState.activeTabId) || fallbackState.tabs[0];
        if (fallbackTab) applyWorkspaceTab(fallbackTab);
        setWorkspaceWindowContextLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!workspaceWindowContextLoaded) return;
    if (window.desktop) {
      void window.desktop.saveWorkspaceWindowTabs(workspaceTabsState).then((saved) => {
        if (!saved) console.warn('Electron rejected the workspace tab state.');
      });
      return;
    }
    try {
      localStorage.setItem(WORKSPACE_TABS_STORAGE_KEY, JSON.stringify(workspaceTabsState));
    } catch {
      // Losing tab restore is non-critical; never interrupt the app for it.
    }
  }, [workspaceTabsState, workspaceWindowContextLoaded]);

  const updateActiveWorkspaceTab = (kind: WorkspaceTabKind, params: WorkspaceTabParams = {}, title?: string) => {
    setWorkspaceTabsState((prev) => {
      const activeId = prev.activeTabId || prev.tabs[0]?.id;
      const activeTab = prev.tabs.find((tab) => tab.id === activeId);
      const nextTitle = title || getWorkspaceTabTitle(kind, params);
      if (
        activeTab &&
        activeTab.kind === kind &&
        activeTab.title === nextTitle &&
        workspaceTabParamsEqual(activeTab.params, params)
      ) {
        return prev;
      }

      const nextTabs = prev.tabs.map((tab) => (
        tab.id === activeId
          ? {
              ...tab,
              kind,
              params,
              title: nextTitle,
              updatedAt: Date.now(),
            }
          : tab
      ));
      return normalizeWorkspaceTabsState({ tabs: nextTabs.length ? nextTabs : [createWorkspaceTab(kind, params, title)], activeTabId: activeId });
    });
  };

  const updateWorkspaceTabById = useCallback((tabId: string, kind: WorkspaceTabKind, params: WorkspaceTabParams = {}, title?: string) => {
    setWorkspaceTabsState((prev) => {
      const nextTabs = prev.tabs.map((tab) => (
        tab.id === tabId
          ? {
              ...tab,
              kind,
              params,
              title: title || getWorkspaceTabTitle(kind, params),
              updatedAt: Date.now(),
            }
          : tab
      ));
      return normalizeWorkspaceTabsState({ ...prev, tabs: nextTabs });
    });
  }, []);

  const navigateWorkspace = (kind: WorkspaceTabKind, params: WorkspaceTabParams = {}, title?: string) => {
    updateActiveWorkspaceTab(kind, params, title);

    if (kind === 'folder') {
      setSelectedPlaylistId(params.playlistId || params.folderId || null);
      setSelectedPlaylistName(params.playlistName || params.folderName || 'Folder');
    } else if (kind !== 'audio-player' && kind !== 'video-player' && kind !== 'document-intelligence') {
      setSelectedPlaylistId(null);
      setSelectedPlaylistName('');
    }

    if (kind === 'document-intelligence') {
      setReturnViewFromDocumentIntelligence(currentView === 'document-intelligence' ? 'library' : currentView);
      setSelectedDocumentIntelligenceResourceId(params.resourceId || null);
    }

    if (kind !== 'audio-player' && kind !== 'video-player') {
      setCurrentView(kind as DashboardView);
    }
  };

  useEffect(() => {
    if (!workspaceWindowContextLoaded || !isAuthenticated || !activeWorkspaceTab) return;
    if (activeWorkspaceTab.kind === 'audio-player' || activeWorkspaceTab.kind === 'video-player') return;
    const params: WorkspaceTabParams =
      currentView === 'folder'
        ? { playlistId: selectedPlaylistId || undefined, playlistName: selectedPlaylistName || undefined }
        : currentView === 'document-intelligence'
          ? { resourceId: selectedDocumentIntelligenceResourceId || undefined }
          : currentView === 'settings'
            ? { settingsTab: activeWorkspaceTab.kind === 'settings' ? activeWorkspaceTab.params?.settingsTab : undefined }
          : {};
    updateActiveWorkspaceTab(currentView, params);
  }, [currentView, selectedPlaylistId, selectedPlaylistName, selectedDocumentIntelligenceResourceId, isAuthenticated, workspaceWindowContextLoaded]);

  const handleSelectWorkspaceTab = (tabId: string) => {
    const tab = workspaceTabs.find((item) => item.id === tabId);
    if (!tab) return;
    setWorkspaceTabsState((prev) => ({ ...prev, activeTabId: tabId }));
    applyWorkspaceTab(tab);
  };

  const handleNewWorkspaceTab = () => {
    setWorkspaceTabsState((prev) => {
      if (prev.tabs.length >= MAX_WORKSPACE_TABS) {
        window.alert(`You can keep up to ${MAX_WORKSPACE_TABS} workspace tabs open.`);
        return prev;
      }
      const tab = createWorkspaceTab('home');
      return { tabs: [...prev.tabs, tab], activeTabId: tab.id };
    });
    setCurrentView('home');
    setSelectedPlaylistId(null);
    setSelectedPlaylistName('');
  };

  const handleCloseWorkspaceTab = (tabId: string) => {
    setWorkspaceTabsState((prev) => {
      const index = prev.tabs.findIndex((tab) => tab.id === tabId);
      if (index === -1) return prev;
      const nextTabs = prev.tabs.filter((tab) => tab.id !== tabId);
      if (nextTabs.length === 0) {
        const tab = createWorkspaceTab('home');
        window.setTimeout(() => applyWorkspaceTab(tab), 0);
        return { tabs: [tab], activeTabId: tab.id };
      }
      const nextActiveTab = tabId === prev.activeTabId ? nextTabs[Math.max(0, index - 1)] : nextTabs.find((tab) => tab.id === prev.activeTabId) || nextTabs[0];
      window.setTimeout(() => applyWorkspaceTab(nextActiveTab), 0);
      return { tabs: nextTabs, activeTabId: nextActiveTab.id };
    });
  };

  const requestDetachedWorkspaceWindow = async (tab: WorkspaceTab): Promise<boolean> => {
    if (tab.kind === 'home' || tab.kind === 'library' || !window.desktop) return false;
    try {
      const result = await window.desktop.openWorkspaceWindow(tab);
      if (!result.success) {
        window.alert(result.error || 'The page could not be opened in a new window.');
        return false;
      }
      return true;
    } catch (error) {
      console.error('Failed to open workspace page in a new window:', error);
      window.alert('The page could not be opened in a new window.');
      return false;
    }
  };

  const handleOpenWorkspaceTabInWindow = async (tabId: string) => {
    const tab = workspaceTabs.find((item) => item.id === tabId);
    if (!tab || tab.kind === 'home' || tab.kind === 'library' || !window.desktop) return;
    const opened = await requestDetachedWorkspaceWindow(tab);
    if (opened) {
      handleCloseWorkspaceTab(tabId);
    }
  };

  const handleAttachWorkspaceWindowToPrimary = async () => {
    if (!window.desktop || isPrimaryWorkspaceWindow || isAttachingToPrimary) return;
    setIsAttachingToPrimary(true);
    try {
      const result = await window.desktop.attachWorkspaceWindowToPrimary();
      if (!result.success) {
        window.alert(result.error || 'The page could not be attached to the main window.');
        setIsAttachingToPrimary(false);
      }
    } catch (error) {
      console.error('Failed to attach workspace page to the main window:', error);
      window.alert('The page could not be attached to the main window.');
      setIsAttachingToPrimary(false);
    }
  };

  const handleReorderWorkspaceTabs = (tabIds: string[]) => {
    setWorkspaceTabsState((prev) => {
      const tabsById = new Map(prev.tabs.map((tab) => [tab.id, tab]));
      const reorderedTabs = tabIds
        .map((tabId) => tabsById.get(tabId))
        .filter((tab): tab is WorkspaceTab => Boolean(tab));

      if (reorderedTabs.length !== prev.tabs.length) return prev;
      if (reorderedTabs.every((tab, index) => tab.id === prev.tabs[index]?.id)) return prev;
      return { ...prev, tabs: reorderedTabs };
    });
  };

  const handleNavigateToFolder = (id: string, name: string) => {
    setSelectedPlaylistId(id);
    setSelectedPlaylistName(name);
    setCurrentView('folder');
    updateActiveWorkspaceTab('folder', { playlistId: id, playlistName: name }, name);
  };

  const handleOpenPlaylistInNewTab = (id: string, name: string) => {
    const title = name || 'Folder';
    if (!isPrimaryWorkspaceWindow && window.desktop) {
      void requestDetachedWorkspaceWindow(
        createWorkspaceTab('folder', { playlistId: id, playlistName: title }, title),
      );
      return;
    }
    if (workspaceTabs.length >= MAX_WORKSPACE_TABS) {
      window.alert(`You can keep up to ${MAX_WORKSPACE_TABS} workspace tabs open.`);
      return;
    }
    const tab = createWorkspaceTab('folder', { playlistId: id, playlistName: title }, title);
    setWorkspaceTabsState((prev) => {
      return { tabs: [...prev.tabs, tab], activeTabId: tab.id };
    });
    setSelectedPlaylistId(id);
    setSelectedPlaylistName(title);
    setCurrentView('folder');
  };

  const openWorkspaceInNewTab = (kind: WorkspaceTabKind, params: WorkspaceTabParams = {}, title?: string) => {
    if (!isPrimaryWorkspaceWindow && window.desktop) {
      void requestDetachedWorkspaceWindow(createWorkspaceTab(kind, params, title));
      return;
    }
    if (workspaceTabs.length >= MAX_WORKSPACE_TABS) {
      window.alert(`You can keep up to ${MAX_WORKSPACE_TABS} workspace tabs open.`);
      return;
    }
    const tab = createWorkspaceTab(kind, params, title);
    setWorkspaceTabsState((prev) => ({ tabs: [...prev.tabs, tab], activeTabId: tab.id }));

    if (kind === 'folder') {
      setSelectedPlaylistId(params.playlistId || params.folderId || null);
      setSelectedPlaylistName(params.playlistName || params.folderName || 'Folder');
    } else if (kind !== 'audio-player' && kind !== 'video-player' && kind !== 'document-intelligence') {
      setSelectedPlaylistId(null);
      setSelectedPlaylistName('');
    }

    if (kind !== 'audio-player' && kind !== 'video-player') {
      setCurrentView(kind as DashboardView);
    }
  };

  const checkSession = async (delayTransition = false) => {
    const startTime = Date.now();
    let token = localStorage.getItem('access_token');

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
      token = await refreshBackendAccessToken();
    }

    if (!token) {
      setCurrentUser(null);
      setIsAuthenticated(false);
      finishSessionCheck();
      return;
    }

    try {
      let response = await fetch('/me', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.status === 401) {
        token = await refreshBackendAccessToken();
        if (token) {
          response = await fetch('/me', {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });
        }
      }

      if (response.ok) {
        const profileData = await response.json();
        setCurrentUser(profileData);
        setIsAuthenticated(true);
      } else {
        clearStoredAuth();
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
      navigateWorkspace('library');
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
      navigateWorkspace('notebooks');
    };
    window.addEventListener('open-notebook-view', handleOpenNotebookView);
    return () => window.removeEventListener('open-notebook-view', handleOpenNotebookView);
  }, [currentView]);

  useEffect(() => {
    const handleAppNavigate = (e: Event) => {
      const customEvent = e as CustomEvent;
      const { view, id, name, resourceId, openInNewTab } = customEvent.detail;
      if (openInNewTab && (view === 'audio-player' || view === 'video-player' || view === 'folder')) {
        openWorkspaceInNewTab(view, customEvent.detail.params || customEvent.detail, customEvent.detail.title || name);
        return;
      }
      if (view === 'folder') {
        setSelectedPlaylistId(id);
        setSelectedPlaylistName(name || 'Folder');
        navigateWorkspace('folder', { playlistId: id, playlistName: name || 'Folder' }, name || 'Folder');
      } else if (view === 'document-intelligence') {
        setReturnViewFromDocumentIntelligence(currentView === 'document-intelligence' ? 'library' : currentView);
        setSelectedDocumentIntelligenceResourceId(resourceId || id || null);
        navigateWorkspace('document-intelligence', { resourceId: resourceId || id || undefined }, 'Document Intelligence');
      } else if (view === 'audio-player' || view === 'video-player') {
        navigateWorkspace(view, customEvent.detail.params || customEvent.detail, customEvent.detail.title);
      } else if (isDashboardView(view)) {
        navigateWorkspace(view);
      } else {
        setCurrentView(view);
      }
    };
    window.addEventListener('app-navigate', handleAppNavigate);
    return () => window.removeEventListener('app-navigate', handleAppNavigate);
  }, [currentView, isPrimaryWorkspaceWindow]);

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

      const key = event.key.toLowerCase();
      const isBackendLogShortcut =
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        ((!event.shiftKey && (key === 't' || event.code === 'KeyT')) ||
          (event.shiftKey && (key === 'l' || event.code === 'KeyL')));

      if (isBackendLogShortcut) {
        event.preventDefault();
        event.stopPropagation();
        void window.desktop?.openBackendLogTerminal();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && key === 'k') {
        event.preventDefault();
        setIsSearchModalOpen(true);
        return;
      }

      if (isTypingContext) return;
    };

    window.addEventListener('keydown', handleGlobalSearchShortcut, { capture: true });
    return () => window.removeEventListener('keydown', handleGlobalSearchShortcut, { capture: true });
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

  const renderWorkspaceTabPanel = (tab: WorkspaceTab) => {
    const isActive = tab.id === workspaceTabsState.activeTabId;
    const panelClassName = `workspace-tab-panel absolute inset-0 min-h-0 min-w-0 ${
      isActive ? 'flex z-10' : 'hidden'
    }`;
    const tabView = tab.kind as DashboardView;

    if (tab.kind === 'audio-player') {
      return (
        <div
          key={tab.id}
          className={panelClassName}
          aria-hidden={!isActive}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${tab.id}-${tab.kind}`}
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300, mass: 0.8 }}
              className="h-full w-full min-w-0 overflow-hidden"
            >
              <AudioPlayerApp
                embedded
                isActive={isActive}
                mediaUrl={tab.params?.mediaUrl}
                resourceId={tab.params?.resourceId}
                initialTime={tab.params?.time}
                onTitleChange={(title) => updateWorkspaceTabById(tab.id, 'audio-player', tab.params || {}, title)}
                onBack={() => navigateWorkspace(tab.params?.playlistId ? 'folder' : 'library', {
                  playlistId: tab.params?.playlistId,
                  playlistName: tab.params?.playlistName,
                })}
              />
            </motion.div>
          </AnimatePresence>
        </div>
      );
    }

    if (tab.kind === 'video-player') {
      return (
        <div
          key={tab.id}
          className={panelClassName}
          aria-hidden={!isActive}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${tab.id}-${tab.kind}`}
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300, mass: 0.8 }}
              className="h-full w-full min-w-0 overflow-hidden"
            >
              <VideoPlayerApp
                embedded
                isActive={isActive}
                mediaUrl={tab.params?.mediaUrl}
                resourceId={tab.params?.resourceId}
                initialTime={tab.params?.time}
                onTitleChange={(title) => updateWorkspaceTabById(tab.id, 'video-player', tab.params || {}, title)}
                onBack={() => navigateWorkspace(tab.params?.playlistId ? 'folder' : 'library', {
                  playlistId: tab.params?.playlistId,
                  playlistName: tab.params?.playlistName,
                })}
              />
            </motion.div>
          </AnimatePresence>
        </div>
      );
    }

    if (tab.kind === 'folder') {
      const playlistId = tab.params?.playlistId || tab.params?.folderId || null;
      const playlistName = tab.params?.playlistName || tab.params?.folderName || 'Folder';
      return (
        <div
          key={tab.id}
          className={panelClassName}
          aria-hidden={!isActive}
        >
          <AnimatePresence mode="sync" initial={isActive}>
            <motion.div
              key={`${tab.id}-${tab.kind}`}
              initial={{ scale: 0.985, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.995, y: -4 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="absolute inset-0 z-10 min-w-0 overflow-hidden bg-[#f7f8fc] dark:bg-[#25272b]"
            >
              <FileExplorer
                playlistId={playlistId}
                playlistName={playlistName}
                onBack={async () => {
                  const destination = playlistId ? 'library' : 'home';
                  const cleanUrl = new URL(window.location.href);
                  cleanUrl.search = '';
                  cleanUrl.searchParams.set('view', destination);
                  window.history.replaceState({}, '', `${cleanUrl.pathname}${cleanUrl.search}`);
                  navigateWorkspace(destination);
                }}
                onNavigatePlaylist={(id, name) => {
                  setSelectedPlaylistId(id);
                  setSelectedPlaylistName(name);
                  updateActiveWorkspaceTab('folder', { playlistId: id, playlistName: name }, name || 'Folder');
                }}
              />
            </motion.div>
          </AnimatePresence>
        </div>
      );
    }

    if (tab.kind === 'document-intelligence') {
      return (
        <div
          key={tab.id}
          className={panelClassName}
          aria-hidden={!isActive}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${tab.id}-${tab.kind}`}
              initial={{ opacity: 0, scale: 0.96, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 16 }}
              transition={{ type: 'spring', damping: 25, stiffness: 280, mass: 0.8 }}
              className="absolute inset-0 z-[100]"
            >
              {tab.params?.resourceId ? (
                <DocumentIntelligencePage
                  resourceId={tab.params.resourceId}
                  onBack={() => navigateWorkspace(returnViewFromDocumentIntelligence)}
                />
              ) : null}
            </motion.div>
          </AnimatePresence>
        </div>
      );
    }

    return (
      <div
        key={tab.id}
        className={panelClassName}
        aria-hidden={!isActive}
      >
        <AnimatePresence mode="sync" initial={isActive}>
          <motion.div
            key={`${tab.id}-dashboard`}
            initial={{ scale: 0.992, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.995, y: -4 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-0 z-0 flex min-h-0 min-w-0 bg-[linear-gradient(135deg,#f5f8fd_0%,#edf2f9_40%,#e4ebf6_100%)] dark:bg-[linear-gradient(135deg,#0B0F19_0%,#050505_100%)]"
          >
            {isPrimaryWorkspaceWindow && (
              <Sidebar
                user={currentUser}
                activeTab={tabView}
                hasActiveDownloads={hasActiveDownloads}
                hasUpdateAvailable={updateBadgeVisible}
                onTabChange={(nextTab) => {
                  if (
                    nextTab === 'home' ||
                    nextTab === 'library' ||
                    nextTab === 'downloads' ||
                    nextTab === 'notebooks' ||
                    nextTab === 'concepts' ||
                    nextTab === 'chat' ||
                    nextTab === 'settings' ||
                    nextTab === 'metrics' ||
                    nextTab === 'rag-explorer'
                  ) {
                    window.dispatchEvent(new CustomEvent('app-navigate', { detail: { view: nextTab, name: nextTab } }));
                  }
                }}
              />
            )}

            <main
              className={`${isPrimaryWorkspaceWindow ? 'app-main-panel' : 'detached-main-panel'} flex-1 flex flex-col relative z-0 p-0 overflow-x-hidden no-scrollbar min-w-0 min-h-0 ${
                tabView === 'home' || tabView === 'rag-explorer' ? 'overflow-hidden' : 'overflow-y-auto'
              } ${
                isPrimaryWorkspaceWindow
                  ? tabView === 'concepts'
                    ? 'h-[calc(100%-48px)] my-6 mx-6 rounded-[32px] bg-[#FCFBF9] dark:bg-[#25272b] border border-slate-200/60 dark:border-white/10 shadow-none backdrop-blur-none'
                    : 'h-[calc(100%-48px)] my-6 mx-6 rounded-[32px] bg-white/40 dark:bg-slate-900/30 backdrop-blur-2xl border border-white/60 dark:border-slate-800/40 shadow-sm dark:shadow-[0_24px_50px_-12px_rgba(0,0,0,0.4)]'
                  : 'h-full w-full rounded-none border-0 bg-white dark:bg-[#1e1f22] shadow-none'
              }`}
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={`${tab.id}-${tabView}`}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.22, ease: 'easeOut' }}
                  className="flex min-h-0 w-full flex-1"
                >
          {tabView === 'home' ? (
            <div className="home-view flex flex-col flex-1 p-8 overflow-y-auto no-scrollbar h-full w-full relative min-h-0">
              <GridBackground />
              <DashboardHeader
                onSearchClick={toggleSearchModal}
                onNotificationClick={toggleNotificationPanel}
                onNavigate={(view) => navigateWorkspace(view as WorkspaceTabKind)}
                user={currentUser}
                theme={theme}
                setTheme={setTheme}
                unreadCount={unreadNotificationsCount}
              />
              <div className="home-layout flex-1 min-h-0">
                <SearchAndActions
                  onCreatePlaylistClick={toggleCreatePlaylistModal}
                  onImportClick={toggleImportModal}
                  user={currentUser}
                />
                <PlaylistGrid
                  isLoading={isLoading}
                  onNavigateToFolder={handleNavigateToFolder}
                  onCreatePlaylistClick={toggleCreatePlaylistModal}
                  onOpenPlaylistInNewTab={handleOpenPlaylistInNewTab}
                  onSeeAllClick={() => navigateWorkspace('library')}
                  limit={3}
                />
              </div>
            </div>
          ) : tabView === 'downloads' ? (
            <div className="flex flex-col flex-1 p-8 overflow-y-auto no-scrollbar h-full w-full">
              <DashboardHeader
                onSearchClick={toggleSearchModal}
                onNotificationClick={toggleNotificationPanel}
                onNavigate={(view) => navigateWorkspace(view as WorkspaceTabKind)}
                user={currentUser}
                theme={theme}
                setTheme={setTheme}
                unreadCount={unreadNotificationsCount}
              />
              <div className="h-6" />
              <DownloadsView onAddMore={toggleImportModal} />
            </div>
          ) : tabView === 'notebooks' ? (
            <div className="flex flex-col flex-1 h-full w-full overflow-y-auto overflow-x-hidden no-scrollbar p-0 min-w-0">
              <NotebookApp mainView={tabView} />
            </div>
          ) : tabView === 'concepts' ? (
            <div className="flex flex-col flex-1 h-full w-full overflow-y-auto overflow-x-hidden no-scrollbar p-0 min-w-0">
              <ConceptsApp />
            </div>
          ) : tabView === 'chat' ? (
            <div className="flex flex-col flex-1 h-full w-full overflow-y-auto overflow-x-hidden no-scrollbar p-0 min-w-0">
              <ChatApp user={currentUser} />
            </div>
          ) : tabView === 'metrics' ? (
            <div className="flex flex-col flex-1 h-full w-full overflow-y-auto overflow-x-hidden no-scrollbar p-0 min-w-0">
              <MetricsDashboard />
            </div>
          ) : tabView === 'rag-explorer' ? (
            <div className="flex flex-col flex-1 h-full w-full overflow-y-auto overflow-x-hidden no-scrollbar p-0 min-w-0">
              <RagExplorerPage
                theme={theme}
                setTheme={setTheme}
                isActive={isActive}
              />
            </div>
          ) : tabView === 'settings' ? (
            <div className="flex flex-col flex-1 h-full w-full overflow-y-auto overflow-x-hidden no-scrollbar p-0 min-w-0">
              <SettingsView user={currentUser} onUserUpdate={checkSession} theme={theme} setTheme={setTheme} />
            </div>
          ) : (
            <div className="flex flex-col flex-1 p-8 overflow-y-auto no-scrollbar h-full w-full">
              <DashboardHeader
                onSearchClick={toggleSearchModal}
                onNotificationClick={toggleNotificationPanel}
                onNavigate={(view) => navigateWorkspace(view as WorkspaceTabKind)}
                user={currentUser}
                theme={theme}
                setTheme={setTheme}
                unreadCount={unreadNotificationsCount}
              />
              <div className="h-6" />
              <LibraryView
                onNavigateToFolder={handleNavigateToFolder}
                onCreatePlaylistClick={toggleCreatePlaylistModal}
                onOpenPlaylistInNewTab={handleOpenPlaylistInNewTab}
              />
            </div>
          )}
                </motion.div>
              </AnimatePresence>
            </main>
          </motion.div>
        </AnimatePresence>
      </div>
    );
  };

  const handleSetupComplete = (newStorageRoot: string) => {
    if (currentUser) {
      setCurrentUser({
        ...currentUser,
        storage_root: newStorageRoot
      });
    }
  };

  const workspaceContent = (
    <div id="myai-workspace-content" className="relative flex min-h-0 flex-1 overflow-hidden">
      {workspacePanelTabs.map(renderWorkspaceTabPanel)}
      <CommandSearchModal isOpen={isSearchModalOpen} onClose={toggleSearchModal} />
      <CreatePlaylistModal isOpen={isCreatePlaylistModalOpen} onClose={toggleCreatePlaylistModal} />
      <ImportContentModal
        isOpen={isImportModalOpen}
        onClose={toggleImportModal}
        onNavigateToDownloads={() => navigateWorkspace('downloads')}
      />
      <NotificationPanel
        isOpen={isNotificationPanelOpen}
        onClose={toggleNotificationPanel}
        onRefreshCount={fetchUnreadNotificationsCount}
      />
      {isPrimaryWorkspaceWindow && <PipelineQueueDock />}
      {isPrimaryWorkspaceWindow && (
        <ActivityLogPanel isOpen={isActivityLogOpen} onClose={toggleActivityLogPanel} />
      )}
    </div>
  );

  return (
    <AnimatePresence mode="wait">
      {loadingAuth || !workspaceWindowContextLoaded ? (
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
          <AuthWindowFrame key="auth-layout">
            <SplitScreenLayout>
              {authView === 'login' && <LoginForm ctx={authContext} />}
              {authView === 'signup' && <SignupForm ctx={authContext} />}
              {authView === 'avatar' && <AvatarSelection ctx={authContext} />}
              {authView === 'verify' && <EmailVerification ctx={authContext} />}
              {authView === 'forgot' && <ForgotPassword ctx={authContext} />}
            </SplitScreenLayout>
          </AuthWindowFrame>
        )
      ) : currentUser && !currentUser.storage_root ? (
        <MacSetupAssistant
          key="onboarding-setup"
          user={currentUser}
          onSetupComplete={handleSetupComplete}
        />
      ) : !isPrimaryWorkspaceWindow ? (
        <div key="detached-workspace-layout" className="detached-workspace-root h-screen w-screen overflow-hidden">
          <header className="detached-window-header">
            <div className="detached-window-title" title={activeWorkspaceTab?.title || 'MyAiLibrary'}>
              {activeWorkspaceTab?.title || 'MyAiLibrary'}
            </div>
            <button
              type="button"
              className="detached-window-attach-button"
              onClick={handleAttachWorkspaceWindowToPrimary}
              disabled={isAttachingToPrimary}
              aria-label="Attach this page to the main window"
              title="Attach to main window"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h8A1.5 1.5 0 0 1 15 5.5v2a1 1 0 1 1-2 0V6H6v10h3.5a1 1 0 1 1 0 2h-4A1.5 1.5 0 0 1 4 16.5v-11Z" />
                <path d="M11 12.5a1.5 1.5 0 0 1 1.5-1.5h6a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-6a1.5 1.5 0 0 1-1.5-1.5v-6Zm2 .5v5h5v-5h-5Z" />
              </svg>
              <span>{isAttachingToPrimary ? 'Attaching…' : 'Attach to main window'}</span>
            </button>
          </header>
          <div className="detached-workspace-content h-full w-full overflow-hidden">
            {workspaceContent}
          </div>
        </div>
      ) : (
        <DashboardLayout key="dashboard-layout">
          <WorkspaceTitleBar
            tabs={workspaceTabs}
            activeTabId={workspaceTabsState.activeTabId}
            maxTabs={MAX_WORKSPACE_TABS}
            onSelectTab={handleSelectWorkspaceTab}
            onNewTab={handleNewWorkspaceTab}
            onCloseTab={handleCloseWorkspaceTab}
            onOpenTabInNewWindow={window.desktop ? handleOpenWorkspaceTabInWindow : undefined}
            onReorderTabs={handleReorderWorkspaceTabs}
          />
          {workspaceContent}
        </DashboardLayout>
      )}

      <AnimatePresence>
        {isAuthenticated && isPrimaryWorkspaceWindow && availableUpdateVersion && dismissedAvailableVersion !== availableUpdateVersion && (
          <motion.div
            key={`available-update-${availableUpdateVersion}`}
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="fixed bottom-6 right-6 z-[9990] w-[calc(100%-3rem)] max-w-sm rounded-2xl border border-gray-200 bg-white/95 p-5 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/95"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
                <Download className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">MyAiLibrary {availableUpdateVersion} is available</h3>
                <p className="mt-1 text-sm leading-relaxed text-gray-500 dark:text-slate-400">
                  {desktopUpdateState?.status === 'downloading'
                    ? `Downloading securely — ${Math.round(desktopUpdateState.percent ?? 0)}%`
                    : desktopUpdateState?.status === 'ready-to-install'
                      ? 'The update is downloaded and ready to install.'
                      : 'Review what’s new and download when you’re ready.'}
                </p>
                <div className="mt-4 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={openUpdatesTab}
                    className="rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700"
                  >
                    View update
                  </button>
                  <button
                    type="button"
                    onClick={() => setDismissedAvailableVersion(availableUpdateVersion)}
                    className="rounded-lg px-3.5 py-2 text-xs font-semibold text-gray-600 transition-colors hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-white/10"
                  >
                    Later
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {isAuthenticated && isPrimaryWorkspaceWindow && installedUpdateInfo && dismissedInstalledVersion !== installedUpdateInfo.currentVersion && (
          <motion.div
            key={`installed-update-${installedUpdateInfo.currentVersion}`}
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="fixed bottom-6 right-6 z-[9991] w-[calc(100%-3rem)] max-w-sm rounded-2xl border border-emerald-200 bg-white/95 p-5 shadow-2xl backdrop-blur-xl dark:border-emerald-500/30 dark:bg-slate-900/95"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">MyAiLibrary was updated to {installedUpdateInfo.currentVersion}</h3>
                <p className="mt-1 text-sm leading-relaxed text-gray-500 dark:text-slate-400">The new version and local AI service started successfully.</p>
                <div className="mt-4 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setDismissedInstalledVersion(installedUpdateInfo.currentVersion);
                      openUpdatesTab();
                    }}
                    className="rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700"
                  >
                    View what’s new
                  </button>
                  <button
                    type="button"
                    onClick={() => setDismissedInstalledVersion(installedUpdateInfo.currentVersion)}
                    className="rounded-lg px-3.5 py-2 text-xs font-semibold text-gray-600 transition-colors hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-white/10"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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

