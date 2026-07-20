import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Slider from '@mui/material/Slider';
import { type BackendUser } from './DashboardHeader';
import { UploadCloud, CheckCircle2, Monitor, Moon, Sun, Plus, FolderOpen, Loader2, Info, RefreshCw, Download, ShieldCheck, ShieldAlert, Clock3, FileText, RotateCw } from 'lucide-react';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword, signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { selectFile, selectFolder } from '../utils/desktop';

interface SettingsViewProps {
  user: BackendUser | null;
  onUserUpdate?: () => void;
  theme: 'light' | 'dark' | 'system';
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
}

type TabType = 'account' | 'team' | 'integrations' | 'ai' | 'storage' | 'appearance' | 'updates';

const PRESET_AVATARS = [
  'https://api.dicebear.com/7.x/notionists/svg?seed=Felix',
  'https://api.dicebear.com/7.x/notionists/svg?seed=Jack',
  'https://api.dicebear.com/7.x/notionists/svg?seed=Leo',
  'https://api.dicebear.com/7.x/notionists/svg?seed=Max',
  'https://api.dicebear.com/7.x/notionists/svg?seed=Oscar',
  'https://api.dicebear.com/7.x/notionists/svg?seed=Luna',
  'https://api.dicebear.com/7.x/notionists/svg?seed=Bella',
  'https://api.dicebear.com/7.x/notionists/svg?seed=Mia',
  'https://api.dicebear.com/7.x/notionists/svg?seed=Chloe',
  'https://api.dicebear.com/7.x/notionists/svg?seed=Lily'
];

const REQUIRED_BADGE = (
  <span className="inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-orange-700 ring-1 ring-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:ring-orange-500/30">
    Required
  </span>
);

const WTP_MODELS = [
  {
    name: 'sat-3l',
    label: 'SaT 3L',
    ramGb: 4,
    power: 'Light',
    size: '~350 MB',
    desc: 'Fastest WTP option. Good for low-power laptops and quick local processing.',
  },
  {
    name: 'sat-6l',
    label: 'SaT 6L',
    ramGb: 8,
    power: 'Balanced',
    size: '~600 MB',
    desc: 'Stronger sentence detection while still comfortable on most modern computers.',
  },
  {
    name: 'sat-12l',
    label: 'SaT 12L',
    ramGb: 16,
    power: 'Best quality',
    size: '~1.2 GB',
    desc: 'Most powerful local WTP option. Recommended for high-memory desktops and workstations.',
  },
];

const formatUpdateBytes = (bytes?: number) => {
  if (!bytes || bytes < 1) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** unit).toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
};

const formatUpdateDate = (value?: string) => {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
};

export default function SettingsView({ user, onUserUpdate, theme: propTheme, setTheme: propSetTheme }: SettingsViewProps) {
  const [activeTab, setActiveTab] = useState<TabType>(() => {
    const requested = new URLSearchParams(window.location.search).get('tab');
    return ['account', 'team', 'integrations', 'ai', 'storage', 'appearance', 'updates'].includes(requested || '')
      ? requested as TabType
      : 'account';
  });

  // Form states
  const [displayName, setDisplayName] = useState(user?.username || '');
  const [email, setEmail] = useState(user?.email || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url || '');
  const [bannerUrl, setBannerUrl] = useState(user?.banner_url || '');

  // Keep state in sync with updated user props
  useEffect(() => {
    if (user) {
      setDisplayName(user.username || '');
      setEmail(user.email || '');
      setAvatarUrl(user.avatar_url || '');
      setBannerUrl(user.banner_url || '');
    }
  }, [user]);

  const [whisperPath, setWhisperPath] = useState('');
  const [whisperModelPath, setWhisperModelPath] = useState('');
  const [downloadingModel, setDownloadingModel] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [activeStorage, setActiveStorage] = useState(user?.storage_root || '');
  const [storageLibraries, setStorageLibraries] = useState<Array<{ id: string; name: string; path: string }>>([]);
  const [autoSync, setAutoSync] = useState(true);
  const [s3Endpoint, setS3Endpoint] = useState('');
  const [s3AccessKey, setS3AccessKey] = useState('');
  const [s3SecretKey, setS3SecretKey] = useState('');
  const [s3BucketName, setS3BucketName] = useState('');
  const [s3Region, setS3Region] = useState('us-east-1');
  const [testingConnection, setTestingConnection] = useState(false);
  const [savingS3, setSavingS3] = useState(false);

  // RAG Enhancement toggles
  const [ragChunkOverlap, setRagChunkOverlap] = useState(false);
  const [ragQueryRouting, setRagQueryRouting] = useState(false);
  const [ragNliVerification, setRagNliVerification] = useState(false);
  const [ragAdaptiveRrf, setRagAdaptiveRrf] = useState(true);
  const [ragParentChild, setRagParentChild] = useState(false);
  const [ragHierarchical, setRagHierarchical] = useState(false);
  const [ragContextualEnrichment, setRagContextualEnrichment] = useState(false);
  const [mediaContextualEnrichment, setMediaContextualEnrichment] = useState(false);

  // AI Model Configuration (per-service)
  const [chatBaseUrl, setChatBaseUrl] = useState('');
  const [chatApiKey, setChatApiKey] = useState('');
  const [chatModel, setChatModel] = useState('');
  const [embeddingBaseUrl, setEmbeddingBaseUrl] = useState('');
  const [embeddingApiKey, setEmbeddingApiKey] = useState('');
  const [embeddingModel, setEmbeddingModel] = useState('');
  const [rerankerBaseUrl, setRerankerBaseUrl] = useState('');
  const [rerankerApiKey, setRerankerApiKey] = useState('');
  const [rerankerModel, setRerankerModel] = useState('');
  const [knowledgeBaseUrl, setKnowledgeBaseUrl] = useState('');
  const [knowledgeApiKey, setKnowledgeApiKey] = useState('');
  const [knowledgeModel, setKnowledgeModel] = useState('');
  // AI Cost Tracking
  const [chatCostUrl, setChatCostUrl] = useState('');
  const [chatCostKey, setChatCostKey] = useState('');
  const [walletBalanceUrl, setWalletBalanceUrl] = useState('');
  const [walletBalanceKey, setWalletBalanceKey] = useState('');
  const [costResults, setCostResults] = useState<any[]>([]);
  const [whisperThreads, setWhisperThreads] = useState(0);
  const [testingAiService, setTestingAiService] = useState<string | null>(null);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [openAiAccordion, setOpenAiAccordion] = useState<string | null>(null);
  const [openWhisperAccordion, setOpenWhisperAccordion] = useState<string | null>(null);
  const [showTerminateModal, setShowTerminateModal] = useState(false);
  const [terminateTarget, setTerminateTarget] = useState<string | null>(null);
  const [systemInfo, setSystemInfo] = useState<{ cpuCores: number; ramGb: number } | null>(null);
  const [tesseractPath, setTesseractPath] = useState('');
  const [tesseractInstalled, setTesseractInstalled] = useState(false);
  const [installingTesseract, setInstallingTesseract] = useState(false);
  const [wtpModelPath, setWtpModelPath] = useState('');

  // Snapshot of settings before edit (for Cancel revert)
  const [settingsSnapshot, setSettingsSnapshot] = useState<Record<string, any> | null>(null);

  // Active login sessions ("Where you're logged in")
  type SessionInfo = {
    id: string;
    device: string;
    browser: string;
    ip_address: string | null;
    last_active: string | null;
    is_current: boolean;
    is_active: boolean;
  };
  const [sessions, setSessions] = useState<SessionInfo[]>([]);

  // Use the app-level theme as the single source of truth. Aliasing the props
  // (instead of keeping a local mirror + two opposing sync effects) removes the
  // dark -> system -> dark bounce that caused the flicker on this page.
  const [persistedTheme, setPersistedTheme] = useState<'light' | 'dark' | 'system'>('system');
  const [stagedTheme, setStagedTheme] = useState<'light' | 'dark' | 'system'>(propTheme);
  const theme = stagedTheme;
  const setTheme = setStagedTheme;
  const [compactMode, setCompactMode] = useState(false);
  const [language, setLanguage] = useState('en');
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  // Feedback states
  const [loading, setLoading] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [cancelState, setCancelState] = useState<'idle' | 'reverting' | 'done'>('idle');
  const [fetchLoading, setFetchLoading] = useState(true);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [updateState, setUpdateState] = useState<DesktopUpdateState | null>(null);
  const [updatePreferences, setUpdatePreferences] = useState<DesktopUpdatePreferences>({
    automaticallyCheck: true,
    automaticallyDownload: false,
    channel: 'stable',
  });
  const [updateActionPending, setUpdateActionPending] = useState(false);
  const [updatePreferenceError, setUpdatePreferenceError] = useState<string | null>(null);
  const [installedUpdateInfo, setInstalledUpdateInfo] = useState<DesktopInstalledUpdateInfo | null>(null);
  const [confirmTestingChannel, setConfirmTestingChannel] = useState(false);

  // New storage path state
  const [newLibName, setNewLibName] = useState('');
  const [newLibPath, setNewLibPath] = useState('');
  const [isAddingLib, setIsAddingLib] = useState(false);
  const [pendingLibraries, setPendingLibraries] = useState<{name: string, path: string}[]>([]);

  const tabs: { id: TabType; label: string }[] = [
    { id: 'account', label: 'My Account' },
    { id: 'team', label: 'Team' },
    { id: 'integrations', label: 'Integrations' },
    { id: 'ai', label: 'AI Models & API Keys' },
    { id: 'storage', label: 'Workspace Storage' },
    { id: 'appearance', label: 'Interface' },
    { id: 'updates', label: 'Updates' }
  ];

  useEffect(() => {
    if (!window.desktop) return;
    let active = true;
    void Promise.all([
      window.desktop.getUpdateState(),
      window.desktop.getUpdatePreferences(),
      window.desktop.getInstalledUpdate(),
    ]).then(([state, preferences, installed]) => {
      if (!active) return;
      if (state) setUpdateState(state);
      if (preferences) setUpdatePreferences(preferences);
      if (installed) setInstalledUpdateInfo(installed);
    }).catch(() => {
      if (active) setUpdatePreferenceError('Desktop update information could not be loaded.');
    });
    const unsubscribe = window.desktop.onUpdateState((state) => {
      if (active) setUpdateState(state);
    });
    const unsubscribeInstalled = window.desktop.onUpdateInstalled((info) => {
      if (active) setInstalledUpdateInfo(info);
    });
    return () => {
      active = false;
      unsubscribe();
      unsubscribeInstalled();
    };
  }, []);

  useEffect(() => {
    const openRequestedTab = (event: Event) => {
      if (event instanceof CustomEvent && event.detail === 'updates') setActiveTab('updates');
    };
    window.addEventListener('myai:open-settings-tab', openRequestedTab);
    return () => window.removeEventListener('myai:open-settings-tab', openRequestedTab);
  }, []);

  const runUpdateAction = async (action: 'check' | 'download' | 'install' | 'logs') => {
    if (!window.desktop || updateActionPending) return;
    setUpdateActionPending(true);
    try {
      if (action === 'logs') {
        await window.desktop.openUpdateLogs();
        return;
      }
      const state = action === 'check'
        ? await window.desktop.checkForUpdates()
        : action === 'download'
          ? await window.desktop.downloadUpdate()
          : await window.desktop.installUpdate();
      if (state) setUpdateState(state);
    } finally {
      setUpdateActionPending(false);
    }
  };

  const changeUpdatePreference = async (key: 'automaticallyCheck' | 'automaticallyDownload') => {
    if (!window.desktop) return;
    const previous = updatePreferences;
    const next = { ...previous, [key]: !previous[key] };
    setUpdatePreferences(next);
    setUpdatePreferenceError(null);
    try {
      const saved = await window.desktop.setUpdatePreferences(next);
      if (!saved) throw new Error('Preference was rejected.');
      setUpdatePreferences(saved);
    } catch {
      setUpdatePreferences(previous);
      setUpdatePreferenceError('The update preference could not be saved.');
    }
  };

  const changeUpdateChannel = async (channel: 'stable' | 'testing') => {
    if (!window.desktop || channel === updatePreferences.channel) return;
    const previous = updatePreferences;
    const next = { ...previous, channel };
    setUpdatePreferences(next);
    setUpdatePreferenceError(null);
    setConfirmTestingChannel(false);
    try {
      const saved = await window.desktop.setUpdatePreferences(next);
      if (!saved || saved.channel !== channel) throw new Error('Channel was rejected.');
      setUpdatePreferences(saved);
    } catch {
      setUpdatePreferences(previous);
      setUpdatePreferenceError('The update channel could not be changed.');
    }
  };

  const recommendedWtpModel = (() => {
    const ramGb = systemInfo?.ramGb ?? 8;
    const cores = systemInfo?.cpuCores ?? 4;
    if (ramGb >= 16 && cores >= 8) return 'sat-12l';
    if (ramGb >= 8 && cores >= 4) return 'sat-6l';
    return 'sat-3l';
  })();

  // Fetch initial preferences on load
  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      setFetchLoading(false);
      return;
    }

    const fetchData = async () => {
      try {
        const [settingsRes, storageRes, sessionsRes, s3Res] = await Promise.all([
          fetch('/me/settings', { headers: { 'Authorization': `Bearer ${token}` } }),
          fetch('/storage-paths', { headers: { 'Authorization': `Bearer ${token}` } }),
          fetch('/me/sessions', { headers: { 'Authorization': `Bearer ${token}` } }),
          fetch('/storage/config', { headers: { 'Authorization': `Bearer ${token}` } }).catch(() => null)
        ]);

        let savedTesseractPath = '';

        if (settingsRes.ok && settingsRes.headers.get('content-type')?.includes('application/json')) {
          const settings = await settingsRes.json();
          setWhisperPath(settings.whisper_path || '');
          setWhisperModelPath(settings.whisper_model_path || '');
          setTesseractPath(settings.tesseract_path || '');
          setWtpModelPath(settings.wtp_model_path || '');
          savedTesseractPath = settings.tesseract_path || '';
          setAutoSync(settings.auto_sync ?? true);
          setTheme(settings.theme || 'system');
          setStagedTheme(settings.theme || 'system');
          setPersistedTheme(settings.theme || 'system');
          setCompactMode(settings.compact_mode ?? false);
          setLanguage(settings.language || 'en');
          setRagChunkOverlap(settings.rag_chunk_overlap ?? false);
          setRagQueryRouting(settings.rag_query_routing ?? false);
          setRagNliVerification(settings.rag_nli_verification ?? false);
          setRagAdaptiveRrf(settings.rag_adaptive_rrf ?? true);
          setRagParentChild(settings.rag_parent_child ?? false);
          setRagHierarchical(settings.rag_hierarchical ?? false);
          setRagContextualEnrichment(settings.rag_contextual_enrichment ?? false);
          setMediaContextualEnrichment(settings.media_contextual_enrichment ?? false);
          setChatBaseUrl(settings.chat_base_url || '');
          setChatApiKey(settings.chat_api_key || '');
          setChatModel(settings.chat_model || '');
          setEmbeddingBaseUrl(settings.embedding_base_url || '');
          setEmbeddingApiKey(settings.embedding_api_key || '');
          setEmbeddingModel(settings.embedding_model || '');
          setRerankerBaseUrl(settings.reranker_base_url || '');
          setRerankerApiKey(settings.reranker_api_key || '');
          setRerankerModel(settings.reranker_model || '');
          setKnowledgeBaseUrl(settings.knowledge_base_url || '');
          setKnowledgeApiKey(settings.knowledge_api_key || '');
          setKnowledgeModel(settings.knowledge_model || '');
          setChatCostUrl(settings.chat_cost_base_url || '');
          setChatCostKey(settings.chat_cost_api_key || '');
          setWalletBalanceUrl(settings.wallet_balance_base_url || '');
          setWalletBalanceKey(settings.wallet_balance_api_key || '');
          setWhisperThreads(settings.whisper_threads ?? 0);
          setNotificationsEnabled(settings.notifications_enabled ?? true);
          // Capture snapshot for cancel/revert
          setSettingsSnapshot({
            displayName: user?.username || '', avatarUrl: user?.avatar_url || '', bannerUrl: user?.banner_url || '',
            ragChunkOverlap: settings.rag_chunk_overlap ?? false, ragQueryRouting: settings.rag_query_routing ?? false,
            ragNliVerification: settings.rag_nli_verification ?? false, ragAdaptiveRrf: settings.rag_adaptive_rrf ?? true,
            ragParentChild: settings.rag_parent_child ?? false, ragHierarchical: settings.rag_hierarchical ?? false,
            ragContextualEnrichment: settings.rag_contextual_enrichment ?? false,
            mediaContextualEnrichment: settings.media_contextual_enrichment ?? false,
            chatBaseUrl: settings.chat_base_url || '', chatApiKey: settings.chat_api_key || '', chatModel: settings.chat_model || '',
            embeddingBaseUrl: settings.embedding_base_url || '', embeddingApiKey: settings.embedding_api_key || '', embeddingModel: settings.embedding_model || '',
            rerankerBaseUrl: settings.reranker_base_url || '', rerankerApiKey: settings.reranker_api_key || '', rerankerModel: settings.reranker_model || '',
            knowledgeBaseUrl: settings.knowledge_base_url || '', knowledgeApiKey: settings.knowledge_api_key || '', knowledgeModel: settings.knowledge_model || '',
            chatCostUrl: settings.chat_cost_base_url || '', chatCostKey: settings.chat_cost_api_key || '',
            walletBalanceUrl: settings.wallet_balance_base_url || '', walletBalanceKey: settings.wallet_balance_api_key || '',
            whisperPath: settings.whisper_path || '', whisperModelPath: settings.whisper_model_path || '', whisperThreads: settings.whisper_threads ?? 0,
            tesseractPath: settings.tesseract_path || '',
            wtpModelPath: settings.wtp_model_path || '',
            theme: settings.theme || 'system', compactMode: settings.compact_mode ?? false, language: settings.language || 'en',
            notificationsEnabled: settings.notifications_enabled ?? true,
          });
        } else if (settingsRes.ok) {
          console.warn('/me/settings response is not JSON:', await settingsRes.text());
        }

        if (storageRes.ok && storageRes.headers.get('content-type')?.includes('application/json')) {
          const libraries = await storageRes.json();
          setStorageLibraries(libraries);
        } else if (storageRes.ok) {
          console.warn('/storage-paths response is not JSON:', await storageRes.text());
        }

        if (sessionsRes.ok && sessionsRes.headers.get('content-type')?.includes('application/json')) {
          const sessionList = await sessionsRes.json();
          setSessions(sessionList);
        } else if (sessionsRes.ok) {
          console.warn('/me/sessions response is not JSON:', await sessionsRes.text());
        }

        if (s3Res && s3Res.ok && s3Res.headers.get('content-type')?.includes('application/json')) {
          const s3Config = await s3Res.json();
          setS3Endpoint(s3Config.endpoint_url || '');
          setS3AccessKey(s3Config.access_key || '');
          setS3SecretKey(s3Config.secret_key || '');
          setS3BucketName(s3Config.bucket_name || '');
          setS3Region(s3Config.region_name || 'us-east-1');
        } else if (s3Res && s3Res.ok) {
          console.warn('/storage/config response is not JSON:', await s3Res.text());
        }

        // Detect if Tesseract is installed
        try {
          const tesseractRes = await fetch('/ai/detect-tesseract', {
            headers: { 'Authorization': `Bearer ${token}` },
          });
          if (tesseractRes.ok) {
            const tesseractData = await tesseractRes.json();
            setTesseractInstalled(tesseractData.installed || false);
            if (tesseractData.installed && tesseractData.path) {
              setTesseractPath(tesseractData.path);
            }
          }
        } catch {
          // If detection fails, assume installed if path was already saved
          if (savedTesseractPath) {
            setTesseractInstalled(true);
          }
        }
      } catch (err) {
        console.error('Failed to load user settings:', err);
      } finally {
        setFetchLoading(false);
      }
    };

    fetchData();

    // Auto-detect system specs for Whisper recommendations
    fetch('/api/system-info')
      .then(res => res.json())
      .then(data => {
        const cores = data.cpu_cores ?? 4;
        const ram = data.ram_gb ?? 8;
        setSystemInfo({ cpuCores: cores, ramGb: ram });
        // Auto-recommend threads only if user hasn't customized (still at default 0)
        setWhisperThreads(prev => {
          if (prev === 0) {
            // Use all cores minus 1 for system overhead, min 2
            return Math.max(2, cores - 1);
          }
          return prev;
        });
      })
      .catch(() => {});
  }, []);

  // Update profile avatar immediately
  const handleSelectPresetAvatar = (url: string) => {
    setAvatarUrl(url);
  };

  const handleBannerUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setBannerUrl(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const result = reader.result as string;
        setAvatarUrl(result);
        const token = localStorage.getItem('access_token');
        if (token) {
          try {
            const res = await fetch('/me/profile', {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
              },
              body: JSON.stringify({ avatar_url: result })
            });
            if (res.ok) {
              onUserUpdate?.();
            }
          } catch (error) {
            console.error('Failed to update avatar:', error);
          }
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // Electron supplies a native dialog; browser development falls back to FastAPI/Tkinter.
  const handleBrowseFolder = async () => {
    const token = localStorage.getItem('access_token');
    if (!token) return;

    try {
      const data = await selectFolder();
      if (data.path) {
        setNewLibPath(data.path);
      }
    } catch (err) {
      console.error('Failed to launch folder picker:', err);
    }
  };

  // Add new workspace path library (staged — only registered on Save)
  const handleRegisterLibrary = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLibName.trim() || !newLibPath.trim()) return;

    setPendingLibraries([...pendingLibraries, { name: newLibName.trim(), path: newLibPath.trim() }]);
    setNewLibName('');
    setNewLibPath('');
    setIsAddingLib(false);
  };

  // Switch primary storage root
  const handleSwitchActiveStorage = async (pathId: string) => {
    const token = localStorage.getItem('access_token');
    if (!token) return;

    setLoading(true);
    try {
      const response = await fetch(`/me/active-storage-path?path_id=${pathId}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        setActiveStorage(data.path);
        // Sync the app-level user (storage_root) and tell every content view to
        // reload for the newly-active workspace — no page reload needed.
        onUserUpdate?.();
        window.dispatchEvent(new Event('workspace-changed'));
        setSuccessMessage('Switched active storage path!');
        setTimeout(() => setSuccessMessage(null), 3000);
      } else {
        const errData = await response.json();
        setErrorMessage(errData.detail || 'Failed to update workspace path.');
      }
    } catch (err) {
      setErrorMessage('Network error switching storage path.');
    } finally {
      setLoading(false);
    }
  };

  // Manual sync
  const handleManualSync = async () => {
    const token = localStorage.getItem('access_token');
    if (!token) return;

    setLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const response = await fetch('/library/sync', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        setSuccessMessage('Workspace synchronized successfully!');
        setTimeout(() => setSuccessMessage(null), 3000);
      } else {
        const errData = await response.json();
        setErrorMessage(errData.detail || 'Failed to synchronize workspace.');
      }
    } catch (err) {
      setErrorMessage('Network error during synchronization.');
    } finally {
      setLoading(false);
    }
  };

  // Save changes
  const createSnapshot = () => ({
    displayName, avatarUrl, bannerUrl,
    chatBaseUrl, chatApiKey, chatModel,
    embeddingBaseUrl, embeddingApiKey, embeddingModel,
    rerankerBaseUrl, rerankerApiKey, rerankerModel,
    knowledgeBaseUrl, knowledgeApiKey, knowledgeModel,
    chatCostUrl, chatCostKey,
    walletBalanceUrl, walletBalanceKey,
    whisperPath, whisperModelPath, whisperThreads, tesseractPath, wtpModelPath,
    ragChunkOverlap, ragQueryRouting, ragNliVerification,
    ragAdaptiveRrf, ragParentChild, ragHierarchical, ragContextualEnrichment,
    theme, compactMode, language,
  });

  const handleCancel = () => {
    if (!settingsSnapshot) return;
    setCancelState('reverting');
    setDisplayName(settingsSnapshot.displayName ?? '');
    setAvatarUrl(settingsSnapshot.avatarUrl ?? '');
    setBannerUrl(settingsSnapshot.bannerUrl ?? '');
    setChatBaseUrl(settingsSnapshot.chatBaseUrl ?? '');
    setChatApiKey(settingsSnapshot.chatApiKey ?? '');
    setChatModel(settingsSnapshot.chatModel ?? '');
    setEmbeddingBaseUrl(settingsSnapshot.embeddingBaseUrl ?? '');
    setEmbeddingApiKey(settingsSnapshot.embeddingApiKey ?? '');
    setEmbeddingModel(settingsSnapshot.embeddingModel ?? '');
    setRerankerBaseUrl(settingsSnapshot.rerankerBaseUrl ?? '');
    setRerankerApiKey(settingsSnapshot.rerankerApiKey ?? '');
    setRerankerModel(settingsSnapshot.rerankerModel ?? '');
    setKnowledgeBaseUrl(settingsSnapshot.knowledgeBaseUrl ?? '');
    setKnowledgeApiKey(settingsSnapshot.knowledgeApiKey ?? '');
    setKnowledgeModel(settingsSnapshot.knowledgeModel ?? '');
    setChatCostUrl(settingsSnapshot.chatCostUrl ?? '');
    setChatCostKey(settingsSnapshot.chatCostKey ?? '');
    setWalletBalanceUrl(settingsSnapshot.walletBalanceUrl ?? '');
    setWalletBalanceKey(settingsSnapshot.walletBalanceKey ?? '');
    setWhisperPath(settingsSnapshot.whisperPath ?? '');
    setWhisperModelPath(settingsSnapshot.whisperModelPath ?? '');
    setTesseractPath(settingsSnapshot.tesseractPath ?? '');
    setWtpModelPath(settingsSnapshot.wtpModelPath ?? '');
    setWhisperThreads(settingsSnapshot.whisperThreads ?? 0);
    setRagChunkOverlap(settingsSnapshot.ragChunkOverlap ?? false);
    setRagQueryRouting(settingsSnapshot.ragQueryRouting ?? false);
    setRagNliVerification(settingsSnapshot.ragNliVerification ?? false);
    setRagAdaptiveRrf(settingsSnapshot.ragAdaptiveRrf ?? true);
    setRagParentChild(settingsSnapshot.ragParentChild ?? false);
    setRagHierarchical(settingsSnapshot.ragHierarchical ?? false);
    setRagContextualEnrichment(settingsSnapshot.ragContextualEnrichment ?? false);
    setMediaContextualEnrichment(settingsSnapshot.mediaContextualEnrichment ?? false);
    setTheme(settingsSnapshot.theme ?? 'system');
    setStagedTheme(settingsSnapshot.theme ?? 'system');
    setCompactMode(settingsSnapshot.compactMode ?? false);
    setLanguage(settingsSnapshot.language ?? 'en');
    setPendingLibraries([]);
    setNotificationsEnabled(settingsSnapshot.notificationsEnabled ?? true);
    setSuccessMessage('Changes reverted.');
    setTimeout(() => { setSuccessMessage(null); setCancelState('done'); }, 1800);
    setTimeout(() => setCancelState('idle'), 2800);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveState('saving');
    setSuccessMessage(null);
    setErrorMessage(null);

    const token = localStorage.getItem('access_token');
    if (!token) {
      setErrorMessage('Session expired. Please log in again.');
      setLoading(false);
      return;
    }

    try {
      // 1. Save Settings Preferences
      const settingsResponse = await fetch('/me/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          whisper_path: whisperPath,
          whisper_model_path: whisperModelPath,
          tesseract_path: tesseractPath,
          wtp_model_path: wtpModelPath,
          auto_sync: autoSync,
          theme: theme,
          compact_mode: compactMode,
          language: language,
          rag_chunk_overlap: ragChunkOverlap,
          rag_query_routing: ragQueryRouting,
          rag_nli_verification: ragNliVerification,
          rag_adaptive_rrf: ragAdaptiveRrf,
          rag_parent_child: ragParentChild,
          rag_hierarchical: ragHierarchical,
          rag_contextual_enrichment: ragContextualEnrichment,
          media_contextual_enrichment: mediaContextualEnrichment,
          chat_base_url: chatBaseUrl,
          chat_api_key: chatApiKey,
          chat_model: chatModel,
          embedding_base_url: embeddingBaseUrl,
          embedding_api_key: embeddingApiKey,
          embedding_model: embeddingModel,
          reranker_base_url: rerankerBaseUrl,
          reranker_api_key: rerankerApiKey,
          reranker_model: rerankerModel,
          knowledge_base_url: knowledgeBaseUrl,
          knowledge_api_key: knowledgeApiKey,
          knowledge_model: knowledgeModel,
          chat_cost_base_url: chatCostUrl,
          chat_cost_api_key: chatCostKey,
          wallet_balance_base_url: walletBalanceUrl,
          wallet_balance_api_key: walletBalanceKey,
          whisper_threads: whisperThreads,
          notifications_enabled: notificationsEnabled,
        })
      });

      if (!settingsResponse.ok) {
        throw new Error('Failed to update system preferences.');
      }

      // 2. Save Account Credentials (username and/or password). Email is immutable.
      const wantsPasswordChange = newPassword.length > 0;

      // Client-side guards so we fail fast before hitting the backend.
      if (wantsPasswordChange) {
        if (!currentPassword) {
          throw new Error('Please enter your current password to set a new one.');
        }
        if (newPassword.length < 8) {
          throw new Error('New password must be at least 8 characters.');
        }
        
        // Update password via Firebase directly
        if (!auth.currentUser || !auth.currentUser.email) {
          throw new Error('User not logged in properly.');
        }
        try {
          const credential = EmailAuthProvider.credential(auth.currentUser.email, currentPassword);
          await reauthenticateWithCredential(auth.currentUser, credential);
        } catch (error: any) {
          throw new Error('Current password is incorrect.');
        }
        try {
          await updatePassword(auth.currentUser, newPassword);
        } catch (error: any) {
          throw new Error('Failed to update password: ' + error.message);
        }
      }

      if (displayName !== (user?.username || '')) {
        const profileResponse = await fetch('/me/account', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            username: displayName
          })
        });

        if (!profileResponse.ok) {
          const errData = await profileResponse.json();
          throw new Error(errData.detail || 'Failed to update account details.');
        }
      }

      if (wantsPasswordChange) {
        setCurrentPassword('');
        setNewPassword('');
      }

      // 3. Save avatar/banner if changed
      if (avatarUrl !== (user?.avatar_url || '') || bannerUrl !== (user?.banner_url || '')) {
        await fetch('/me/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ avatar_url: avatarUrl, banner_url: bannerUrl }),
        });
      }

      // 4. Register any pending new libraries
      if (pendingLibraries.length > 0) {
        for (const lib of pendingLibraries) {
          const response = await fetch(
            `/storage-paths?name=${encodeURIComponent(lib.name)}&path=${encodeURIComponent(lib.path)}`,
            { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } }
          );
          if (response.ok) {
            const newLib = await response.json();
            setStorageLibraries(prev => [...prev, newLib]);
          }
        }
        setPendingLibraries([]);
      }

      const missingAI = [];
      if (!chatBaseUrl || !chatApiKey) missingAI.push('Chat');
      if (!embeddingBaseUrl || !embeddingApiKey) missingAI.push('Embedding');
      if (!rerankerBaseUrl || !rerankerApiKey || !rerankerModel) missingAI.push('Reranker');
      if (!knowledgeBaseUrl || !knowledgeApiKey || !knowledgeModel) missingAI.push('Knowledge Model');

      if (!whisperPath.trim() || !whisperModelPath.trim()) {
        setErrorMessage('Settings updated, but Whisper paths are missing. Transcription will fail until configured.');
        setTimeout(() => setErrorMessage(null), 5000);
      } else if (missingAI.length > 0) {
        setSuccessMessage(`Settings updated successfully, but note that ${missingAI.join(', ')} is not fully configured.`);
        setTimeout(() => setSuccessMessage(null), 5000);
      } else {
        setSuccessMessage('Settings updated successfully!');
        setTimeout(() => setSuccessMessage(null), 3000);
      }
      setPersistedTheme(theme);
      propSetTheme(theme);
      onUserUpdate?.();

      // If password changed successfully, automatically log out
      if (wantsPasswordChange) {
        try {
          await signOut(auth);
        } catch (err) {
          console.error('Firebase signOut error:', err);
        }
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('user_id');
        localStorage.removeItem('username');
        localStorage.removeItem('email');
        window.location.reload();
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'An error occurred while saving.');
      setSaveState('error');
      setTimeout(() => setSaveState('idle'), 2500);
    } finally {
      if (saveState !== 'error') {
        // Keep spinner visible for at least 2s so users feel the saving
        await new Promise(r => setTimeout(r, 2000));
        setSaveState('success');
        // Hold "Saved" long enough for users to register the confirmation
        setTimeout(() => setSaveState('idle'), 2000);
      }
      setLoading(false);
    }
  };

  const handleTestS3Connection = async () => {
    const token = localStorage.getItem('access_token');
    if (!token) return;

    setTestingConnection(true);
    setSuccessMessage(null);
    setErrorMessage(null);

    try {
      const response = await fetch('/storage/test-connection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          endpoint_url: s3Endpoint,
          access_key: s3AccessKey,
          secret_key: s3SecretKey,
          bucket_name: s3BucketName,
          region_name: s3Region
        })
      });

      const data = await response.json();
      if (response.ok) {
        setSuccessMessage('Successfully connected to S3 Bucket!');
      } else {
        setErrorMessage(data.detail || 'Failed to connect to S3 Bucket.');
      }
    } catch (err) {
      setErrorMessage('Network error testing S3 connection.');
    } finally {
      setTestingConnection(false);
      setTimeout(() => {
        setSuccessMessage(null);
        setErrorMessage(null);
      }, 4000);
    }
  };

  const handleSaveS3Config = async () => {
    const token = localStorage.getItem('access_token');
    if (!token) return;

    setSavingS3(true);
    setSuccessMessage(null);
    setErrorMessage(null);

    try {
      const response = await fetch('/storage/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          endpoint_url: s3Endpoint,
          access_key: s3AccessKey,
          secret_key: s3SecretKey,
          bucket_name: s3BucketName,
          region_name: s3Region
        })
      });

      const data = await response.json();
      if (response.ok) {
        setSuccessMessage('S3 Configuration saved successfully!');
      } else {
        setErrorMessage(data.detail || 'Failed to save S3 Configuration.');
      }
    } catch (err) {
      setErrorMessage('Network error saving S3 configuration.');
    } finally {
      setSavingS3(false);
      setTimeout(() => {
        setSuccessMessage(null);
        setErrorMessage(null);
      }, 4000);
    }
  };

  const handleTestAiConnection = async (service: 'chat' | 'embedding' | 'reranker' | 'knowledge') => {
    const token = localStorage.getItem('access_token');
    if (!token) return;
    setTestingAiService(service);
    setSuccessMessage(null);
    setErrorMessage(null);
    try {
      const config = service === 'chat'
        ? { type: 'chat', base_url: chatBaseUrl, api_key: chatApiKey, model: chatModel }
        : service === 'embedding'
        ? { type: 'embedding', base_url: embeddingBaseUrl, api_key: embeddingApiKey, model: embeddingModel }
        : service === 'reranker'
        ? { type: 'reranker', base_url: rerankerBaseUrl, api_key: rerankerApiKey, model: rerankerModel }
        : { type: 'knowledge', base_url: knowledgeBaseUrl, api_key: knowledgeApiKey, model: knowledgeModel };
      const res = await fetch('/ai/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMessage(data.message || `${service.charAt(0).toUpperCase() + service.slice(1)} connection successful!`);
      } else {
        setErrorMessage(data.message || data.detail || `${service} connection failed.`);
      }
    } catch {
      setErrorMessage(`Network error testing ${service} connection.`);
    } finally {
      setTestingAiService(null);
      setTimeout(() => { setSuccessMessage(null); setErrorMessage(null); }, 4000);
    }
  };

  const handleTestLocalDependency = async (dependency: 'whisper' | 'tesseract' | 'wtp') => {
    const token = localStorage.getItem('access_token');
    if (!token) return;
    setTestingAiService(dependency);
    setSuccessMessage(null);
    setErrorMessage(null);
    try {
      const config = dependency === 'whisper'
        ? { type: dependency, whisper_path: whisperPath, whisper_model_path: whisperModelPath }
        : dependency === 'tesseract'
        ? { type: dependency, tesseract_path: tesseractPath }
        : { type: dependency, wtp_model_path: wtpModelPath };
      const res = await fetch('/ai/test-local-dependency', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMessage(data.message || `${dependency} configuration is ready.`);
      } else {
        setErrorMessage(data.message || data.detail || `${dependency} configuration failed.`);
      }
    } catch {
      setErrorMessage(`Unable to test ${dependency} configuration.`);
    } finally {
      setTestingAiService(null);
      setTimeout(() => { setSuccessMessage(null); setErrorMessage(null); }, 5000);
    }
  };

  const handleTerminateSession = async () => {
    if (!terminateTarget) return;
    const token = localStorage.getItem('access_token');
    if (!token) return;
    try {
      let res;
      if (terminateTarget === 'all') {
        res = await fetch('/me/sessions', { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
      } else {
        res = await fetch(`/me/sessions/${terminateTarget}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
      }
      if (res.ok) {
        if (terminateTarget === 'all') {
          setSessions(sessions.filter(s => s.is_current));
        } else {
          setSessions(sessions.filter(s => s.id !== terminateTarget));
        }
        setSuccessMessage('Session terminated.');
      } else {
        setErrorMessage('Failed to terminate session.');
      }
    } catch {
      setErrorMessage('Failed to terminate session.');
    } finally {
      setShowTerminateModal(false);
      setTerminateTarget(null);
      setTimeout(() => { setSuccessMessage(null); setErrorMessage(null); }, 3000);
    }
  };

  const handleValidateUsername = async (value: string) => {
    setUsernameError(null);
    setUsernameStatus('idle');
    if (!value) return;
    if (value === (user?.username || '')) { setUsernameStatus('idle'); return; }
    if (value.length < 5) {
      setUsernameStatus('taken');
      setUsernameError('Username must be at least 5 characters');
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(value)) {
      setUsernameStatus('taken');
      setUsernameError('Only letters, numbers, and underscores allowed');
      return;
    }
    setUsernameStatus('checking');
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`/auth/check-username?username=${encodeURIComponent(value)}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      if (!data.available) {
        setUsernameStatus('taken');
        setUsernameError('Username is already taken');
      } else {
        setUsernameStatus('available');
        setUsernameError(null);
      }
    } catch { setUsernameStatus('idle'); }
  };

  const handleSelectFile = async (setter: React.Dispatch<React.SetStateAction<string>>) => {
    try {
      const data = await selectFile();
      if (data.path) {
        setter(data.path);
      } else if (data.error) {
        console.error('File dialog error:', data.error);
        alert('File dialog failed: ' + data.error);
      }
    } catch (e) {
      console.error('Failed to open file dialog', e);
      alert('Failed to open file dialog. Is the Python backend server running?');
    }
  };

  const handleSelectFolderForSetting = async (setter: React.Dispatch<React.SetStateAction<string>>) => {
    try {
      const data = await selectFolder();
      if (data.path) {
        setter(data.path);
      }
    } catch (e) {
      console.error('Failed to open folder dialog', e);
      alert('Failed to open folder dialog. Is the Python backend server running?');
    }
  };

  const handleDownloadModel = async (modelFileName: string, displayName?: string) => {
    try {
      const folderData = window.desktop ? { path: '' } : await selectFolder();
      if (!window.desktop && !folderData.path) return;

      const destPath = folderData.path || '';
      const trackName = displayName || modelFileName;
      setDownloadingModel(trackName);
      setDownloadProgress(0);

      const url = `/api/settings/download-whisper?model=${encodeURIComponent(modelFileName)}&dest_path=${encodeURIComponent(destPath)}`;
      let retryCount = 0;
      const maxRetries = 5;
      let lastProgress = 0;

      const connectSSE = () => {
        const eventSource = new EventSource(url);

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.error) {
              alert('Download failed: ' + data.error);
              eventSource.close();
              setDownloadingModel(null);
              return;
            }
            if (data.progress !== undefined) {
              lastProgress = data.progress;
              setDownloadProgress(data.progress);
            }
            if (data.status === 'completed') {
              eventSource.close();
              setDownloadingModel(null);
              setSuccessMessage(`Successfully downloaded ${trackName}!`);
              setTimeout(() => setSuccessMessage(null), 4000);
            }
          } catch (e) {
            console.error("SSE parse error", e);
          }
        };

        eventSource.onerror = (err) => {
          console.error("SSE Error, retrying...", err);
          eventSource.close();
          if (retryCount < maxRetries) {
            retryCount++;
            const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 15000);
            setDownloadProgress(lastProgress);
            setTimeout(connectSSE, delay);
          } else {
            alert('Network error after multiple retries. Please check your connection and try again.');
            setDownloadingModel(null);
          }
        };
      };

      connectSSE();
    } catch (e) {
      console.error(e);
      alert('Failed to initiate download.');
      setDownloadingModel(null);
    }
  };

  const handleDownloadWtpModel = async (modelName = 'sat-3l') => {
    try {
      const folderData = window.desktop ? { path: '' } : await selectFolder();
      if (!window.desktop && !folderData.path) return;

      const trackName = `wtp-${modelName}`;
      setDownloadingModel(trackName);
      setDownloadProgress(0);

      const url = `/api/settings/download-wtp-model?model=${encodeURIComponent(modelName)}&dest_path=${encodeURIComponent(folderData.path || '')}`;
      let retryCount = 0;
      const maxRetries = 5;
      let lastProgress = 0;

      const connectSSE = () => {
        const eventSource = new EventSource(url);

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.error) {
              alert('Download failed: ' + data.error);
              eventSource.close();
              setDownloadingModel(null);
              return;
            }
            if (data.progress !== undefined) {
              lastProgress = data.progress;
              setDownloadProgress(data.progress);
            }
            if (data.status === 'completed') {
              eventSource.close();
              setDownloadingModel(null);
              setWtpModelPath(data.final_path || `${folderData.path}\\${modelName}`);
              setSuccessMessage(`Successfully downloaded WTP Canine ${modelName}. Save settings to make it active.`);
              setTimeout(() => setSuccessMessage(null), 4000);
            }
          } catch (e) {
            console.error("SSE parse error", e);
          }
        };

        eventSource.onerror = (err) => {
          console.error("SSE Error, retrying...", err);
          eventSource.close();
          if (retryCount < maxRetries) {
            retryCount++;
            const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 15000);
            setDownloadProgress(lastProgress);
            setTimeout(connectSSE, delay);
          } else {
            alert('Network error after multiple retries. Please check your connection and try again.');
            setDownloadingModel(null);
          }
        };
      };

      connectSSE();
    } catch (e) {
      console.error(e);
      alert('Failed to initiate WTP Canine download.');
      setDownloadingModel(null);
    }
  };

  // Turn an ISO timestamp into a friendly "last seen" string.
  const formatLastActive = (iso: string | null): string => {
    if (!iso) return 'Unknown';
    const then = new Date(iso + (iso.endsWith('Z') ? '' : 'Z')).getTime();
    const diffMs = Date.now() - then;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
    return new Date(then).toLocaleDateString();
  };

  if (fetchLoading) {
    return (
      <div className="flex-1 flex flex-col h-full w-full bg-white dark:bg-white/5 rounded-[32px] items-center justify-center">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
        <p className="text-gray-500 dark:text-slate-500 mt-2 text-sm">Loading settings profile...</p>
      </div>
    );
  }

  const effectiveUpdateState: DesktopUpdateState = updateState ?? {
    status: window.desktop ? 'idle' : 'disabled',
    currentVersion: window.desktop ? 'Loading…' : 'Browser development',
    installationEnabled: false,
    channel: 'stable',
    testingChannelAvailable: false,
    unsignedTestingMode: false,
    errorMessage: window.desktop
      ? undefined
      : 'Updates are available only in the installed desktop application.',
  };
  const updateStatusLabel: Record<DesktopUpdateStatus, string> = {
    disabled: 'Updates unavailable',
    idle: 'Ready to check',
    checking: 'Checking for updates…',
    available: `Version ${effectiveUpdateState.availableVersion ?? ''} is available`,
    'up-to-date': 'You’re up to date',
    downloading: `Downloading update — ${Math.round(effectiveUpdateState.percent ?? 0)}%`,
    downloaded: 'Update downloaded',
    preparing: 'Protecting your data…',
    'ready-to-install': `Version ${effectiveUpdateState.availableVersion ?? ''} is ready`,
    installing: 'Restarting to install…',
    error: 'Update could not be completed',
  };

  return (
    <div className="flex-1 flex flex-col h-full w-full bg-white/65 dark:bg-slate-900/40 backdrop-blur-[24px] border border-white/50 dark:border-white/10 rounded-[32px] overflow-hidden relative shadow-sm dark:shadow-[0_12px_30px_-4px_rgba(0,0,0,0.5)]">
      
      {/* Toast notifications */}
      <AnimatePresence>
        {successMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-6 left-1/2 -translate-x-1/2 px-4 py-3 bg-emerald-600 text-white rounded-xl text-sm font-semibold shadow-lg shadow-emerald-500/20 z-[99] flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4" />
            {successMessage}
          </motion.div>
        )}
        {errorMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-6 left-1/2 -translate-x-1/2 px-4 py-3 bg-rose-600 text-white rounded-xl text-sm font-semibold shadow-lg shadow-rose-500/20 z-[99] flex items-center gap-2"
          >
            <div className="w-1.5 h-1.5 rounded-full bg-white dark:bg-white/5 animate-ping"></div>
            {errorMessage}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header with Banner & Profile */}
      <div className="shrink-0 bg-transparent">
        {/* Gradient Banner */}
        <div className="group relative h-48 w-full rounded-t-[32px] overflow-hidden bg-gradient-to-r from-pink-200 via-purple-200 to-indigo-200">
          {bannerUrl && <img src={bannerUrl} alt="Banner" className="w-full h-full object-cover" />}
          <label className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
            <span className="px-4 py-2 bg-white/20 backdrop-blur-sm rounded-lg text-white text-sm font-semibold flex items-center gap-2 border border-white/30">
              <UploadCloud className="w-4 h-4" /> Change Banner
            </span>
            <input type="file" accept="image/*" className="hidden" onChange={handleBannerUpload} />
          </label>
        </div>
        
        <div className="px-8 pb-0 border-b border-gray-200 dark:border-white/10">
          {/* Profile Details (Overlapping Banner) */}
          <div className="flex justify-between items-end -mt-12 mb-6">
            <div className="flex items-end gap-5">
              {/* Avatar */}
              <div className="relative group w-32 h-32 rounded-full border-4 border-white bg-white dark:bg-white/5 shadow-sm overflow-hidden shrink-0">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="Profile" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-indigo-100 flex items-center justify-center text-4xl font-bold text-indigo-600">
                    {displayName.charAt(0).toUpperCase() || 'U'}
                  </div>
                )}
                <label className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer rounded-full">
                  <UploadCloud className="w-6 h-6 text-white" />
                  <input type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
                </label>
              </div>
              
              {/* Name & Email */}
              <div className="pb-2">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{displayName || 'User'}</h1>
                <p className="text-gray-500 dark:text-slate-500 text-sm">{email || 'user@example.com'}</p>
              </div>
                        </div>
            
            {/* Action Buttons */}
            <div className="flex gap-3 pb-2">
              <button className="px-4 py-2 bg-white dark:bg-white/5 border border-gray-300 dark:border-white/20 rounded-lg text-sm font-semibold text-gray-700 dark:text-slate-300 shadow-sm hover:bg-gray-50 dark:bg-white/10 transition-colors flex items-center gap-2">
                <svg className="w-4 h-4 text-gray-500 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
                Share
              </button>
              <button className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold shadow-sm hover:bg-indigo-700 transition-colors">
                View profile
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-6 overflow-x-auto no-scrollbar">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative pb-3 text-sm font-semibold transition-colors ${
                  activeTab === tab.id ? 'text-indigo-700 dark:text-indigo-400' : 'text-gray-500 dark:text-slate-500 dark:text-slate-400 hover:text-gray-700 dark:text-slate-300 dark:hover:text-slate-200'
                }`}
              >
                {tab.label}
                {activeTab === tab.id && (
                  <motion.div
                    layoutId="activeTabIndicator"
                    className="absolute bottom-0 left-0 right-0 h-[2px] bg-indigo-600"
                    initial={false}
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto no-scrollbar p-8 bg-transparent">
        <div className="max-w-5xl mx-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {/* === My Account Tab === */}
              {activeTab === 'account' && (
                <div className="space-y-8">
                  
                  {/* Profile Picture Section */}
                  <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8 py-6 border-b border-gray-200/60 dark:border-white/10">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Profile picture</h3>
                      <p className="text-sm text-gray-500 dark:text-slate-500 mt-1">Select from our preset avatars to update your profile.</p>
                    </div>
                    <div className="space-y-4">
                      <div className="flex items-center gap-6">
                        <div className="w-16 h-16 rounded-full bg-indigo-100 flex items-center justify-center overflow-hidden shrink-0 ring-4 ring-white shadow-sm">
                          {avatarUrl ? (
                            <img src={avatarUrl} alt="Profile" className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-xl font-bold text-indigo-600">{displayName.charAt(0).toUpperCase() || 'U'}</span>
                          )}
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-700 dark:text-slate-300">Preset Avatars</p>
                          <div className="flex gap-3 mt-2 flex-wrap">
                            {PRESET_AVATARS.map((url, i) => (
                              <button
                                key={i}
                                type="button"
                                onClick={() => handleSelectPresetAvatar(url)}
                                className={`w-10 h-10 rounded-full border-2 overflow-hidden transition-all hover:scale-105 bg-white dark:bg-white/5 ${avatarUrl === url ? 'border-indigo-600 scale-105 shadow-sm' : 'border-gray-200 dark:border-white/10'}`}
                              >
                                <img src={url} alt={`Bottts seed ${i}`} className="w-full h-full object-cover" />
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Display Details Section */}
                  <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8 py-6 border-b border-gray-200/60 dark:border-white/10">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Personal info</h3>
                      <p className="text-sm text-gray-500 dark:text-slate-500 mt-1">Update your username and email address. Username can only be changed once every 14 days.</p>
                    </div>
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Username</label>
                          <div className="relative">
                            <input 
                              type="text" 
                              value={displayName}
                              onChange={(e) => { setDisplayName(e.target.value); handleValidateUsername(e.target.value); }}
                              className={`w-full px-3 py-2 pr-10 border rounded-lg shadow-sm focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 transition-colors text-sm ${
                                usernameStatus === 'taken' ? 'border-red-300 dark:border-red-500/50' :
                                usernameStatus === 'available' ? 'border-green-300 dark:border-green-500/50' :
                                'border-gray-300 dark:border-white/20'
                              }`}
                              placeholder="e.g. John Doe"
                            />
                            <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                              {usernameStatus === 'checking' && (
                                <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
                              )}
                              {usernameStatus === 'available' && (
                                <CheckCircle2 className="w-4 h-4 text-green-500" />
                              )}
                              {usernameStatus === 'taken' && (
                                <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <circle cx="12" cy="12" r="10" />
                                  <path strokeLinecap="round" d="M15 9l-6 6M9 9l6 6" />
                                </svg>
                              )}
                            </div>
                          </div>
                          {usernameError && <p className="text-xs text-red-500 mt-1">{usernameError}</p>}
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Email address</label>
                          <input
                            type="email"
                            value={email}
                            disabled
                            readOnly
                            className="w-full px-3 py-2 border border-gray-200 dark:border-white/10 rounded-lg shadow-sm text-sm bg-gray-100 dark:bg-white/5 text-gray-400 dark:text-slate-500 cursor-not-allowed"
                          />
                          <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">Your email address cannot be changed.</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Password Section */}
                  <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8 py-6 border-b border-gray-200/60 dark:border-white/10">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Password</h3>
                      <p className="text-sm text-gray-500 dark:text-slate-500 mt-1">Manage your password to keep your account secure.</p>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Current password</label>
                        <input 
                          type="password" 
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                          placeholder="••••••••" 
                          className="w-full max-w-md px-3 py-2 border border-gray-300 dark:border-white/20 rounded-lg shadow-sm focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 transition-colors text-sm" 
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">New password</label>
                        <input 
                          type="password" 
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="••••••••" 
                          className="w-full max-w-md px-3 py-2 border border-gray-300 dark:border-white/20 rounded-lg shadow-sm focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 transition-colors text-sm" 
                        />
                        <p className="text-xs text-gray-500 dark:text-slate-500 mt-1.5">Must be at least 8 characters.</p>
                      </div>
                    </div>
                  </div>

                  {/* System Notifications Section */}
                  <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8 py-6 border-b border-gray-200/60 dark:border-white/10">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">System Notifications</h3>
                      <p className="text-sm text-gray-500 dark:text-slate-500 mt-1">Choose how and when you want to be notified by the system.</p>
                    </div>
                    <div className="space-y-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-sm font-medium text-gray-900 dark:text-white">Enable Notifications</h4>
                          <p className="text-sm text-gray-500 dark:text-slate-500">Receive alerts for important system events.</p>
                        </div>
                        <button 
                          onClick={() => setNotificationsEnabled(!notificationsEnabled)}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${notificationsEnabled ? 'bg-indigo-600' : 'bg-gray-200'}`}
                        >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white dark:bg-white/5 transition-transform ${notificationsEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Devices Logged In Section */}
                  <div className="py-6">
                    <div className="mb-6">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                        Where you're logged in
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-slate-500 mt-1 max-w-lg">We'll alert you via {email || 'your email'} if there is any unusual activity on your account.</p>
                    </div>

                    <div className="space-y-0 border-t border-gray-200 dark:border-white/10">
                      <AnimatePresence mode="popLayout">
                        {sessions.length === 0 ? (
                          <div className="py-6 text-sm text-gray-500 dark:text-slate-500">
                            No active sessions found.
                          </div>
                        ) : (
                          sessions.map((session) => (
                            <motion.div
                              key={session.id}
                              layout
                              initial={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, x: -60, height: 0, marginTop: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0, transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] } }}
                              className="overflow-hidden"
                            >
                              <motion.div
                                initial={false}
                                animate={(terminateTarget === session.id || (terminateTarget === 'all' && !session.is_current)) ? { backgroundColor: "rgba(239, 68, 68, 0.08)" } : { backgroundColor: "rgba(239, 68, 68, 0)" }}
                                transition={{ duration: 0.3 }}
                                className="flex items-start gap-4 py-4 border-b border-gray-200 dark:border-white/10 rounded-lg"
                              >
                                <div className="mt-1 flex-shrink-0 text-gray-400">
                                  <Monitor className="w-5 h-5" />
                                </div>
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-semibold text-gray-900 dark:text-white">
                                      {session.device} · {session.browser}
                                    </span>
                                    {session.is_current && (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
                                        This device
                                      </span>
                                    )}
                                    {session.is_active && (
                                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Active now
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-sm text-gray-500 dark:text-slate-500 mt-0.5">
                                    {session.ip_address || 'Unknown IP'} • {session.is_active ? 'Active now' : formatLastActive(session.last_active)}
                                  </p>
                                </div>
                                {!session.is_current && (
                                  <button
                                    onClick={() => {
                                      setTerminateTarget(session.id);
                                      setShowTerminateModal(true);
                                    }}
                                    className="text-xs font-semibold text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-500/10"
                                  >
                                    Terminate
                                  </button>
                                )}
                              </motion.div>
                            </motion.div>
                          ))
                        )}
                      </AnimatePresence>
                    </div>
                    {sessions.filter(s => !s.is_current).length > 0 && (
                      <div className="mt-4">
                        <button onClick={() => {
                          setTerminateTarget('all');
                          setShowTerminateModal(true);
                        }} className="px-4 py-2 bg-red-50 hover:bg-red-100 dark:bg-red-500/10 dark:hover:bg-red-500/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/20 rounded-lg text-xs font-bold shadow-sm transition-all">
                          Terminate all other sessions
                        </button>
                      </div>
                    )}
                  </div>

                </div>
              )}

              {/* === Team Tab === */}
              {activeTab === 'team' && (
                <div className="space-y-8">
                  <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8 py-6">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Team members</h3>
                      <p className="text-sm text-gray-500 dark:text-slate-500 mt-1">Manage your team members and their account permissions here.</p>
                    </div>
                    <div className="space-y-4">
                      <div className="p-8 border-2 border-dashed border-gray-200 dark:border-white/10 rounded-xl text-center">
                        <div className="mx-auto w-12 h-12 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mb-3">
                          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                          </svg>
                        </div>
                        <h4 className="text-sm font-semibold text-gray-900 dark:text-white">No team members yet</h4>
                        <p className="text-sm text-gray-500 dark:text-slate-500 mt-1 max-w-sm mx-auto">Get started by inviting your team members to collaborate on your AI workspace.</p>
                        <button className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold shadow-sm hover:bg-indigo-700 transition-colors inline-flex items-center gap-2">
                          <Plus className="w-4 h-4" />
                          Invite members
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* === Integrations Tab === */}
              {activeTab === 'integrations' && (
                <div className="space-y-8">
                  <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8 py-6">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Connected apps</h3>
                      <p className="text-sm text-gray-500 dark:text-slate-500 mt-1">Supercharge your workflow and connect the tools you use every day.</p>
                    </div>
                    <div className="space-y-4">
                      <div className="border border-gray-200 dark:border-white/10 rounded-xl p-5 bg-white dark:bg-white/5 shadow-sm flex items-start justify-between">
                        <div className="flex gap-4">
                          <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                            </svg>
                          </div>
                          <div>
                            <h4 className="text-sm font-semibold text-gray-900 dark:text-white">AI Trading Journal</h4>
                            <p className="text-sm text-gray-500 dark:text-slate-500 mt-1">Connect your open-source trading journal for seamless AI-assisted market analysis.</p>
                          </div>
                        </div>
                        <button className="px-4 py-2 bg-white dark:bg-white/5 border border-gray-300 dark:border-white/20 rounded-lg text-sm font-semibold text-gray-700 dark:text-slate-300 shadow-sm hover:bg-gray-50 dark:bg-white/10 transition-colors whitespace-nowrap">
                          Connect
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}


              {/* === AI Models & API Keys Tab === */}
              {activeTab === 'ai' && (
                <div className="space-y-8">

                  {/* AI Model Configuration Cards - Accordion */}
                  {[
                    { label: 'Chat Model', service: 'chat' as const, baseUrl: chatBaseUrl, setBaseUrl: setChatBaseUrl, apiKey: chatApiKey, setApiKey: setChatApiKey, model: chatModel, setModel: setChatModel, defaultUrl: 'https://api.chatqt.com/api/v1', defaultModel: 'deepseek/deepseek-v4-flash', hint: 'Base URL only. The app auto-appends /chat/completions.' },
                    { label: 'Embedding Model', service: 'embedding' as const, baseUrl: embeddingBaseUrl, setBaseUrl: setEmbeddingBaseUrl, apiKey: embeddingApiKey, setApiKey: setEmbeddingApiKey, model: embeddingModel, setModel: setEmbeddingModel, defaultUrl: 'https://api.chatqt.com/api/v1', defaultModel: 'openai/text-embedding-3-large', hint: 'Base URL only. The app auto-appends /embeddings.' },
                    { label: 'Reranker Model', service: 'reranker' as const, baseUrl: rerankerBaseUrl, setBaseUrl: setRerankerBaseUrl, apiKey: rerankerApiKey, setApiKey: setRerankerApiKey, model: rerankerModel, setModel: setRerankerModel, defaultUrl: 'https://api.cohere.com/v2/rerank', defaultModel: 'rerank-v4.0-fast', hint: 'Complete URL — used exactly as entered.' },
                    { label: 'Knowledge Model', service: 'knowledge' as const, baseUrl: knowledgeBaseUrl, setBaseUrl: setKnowledgeBaseUrl, apiKey: knowledgeApiKey, setApiKey: setKnowledgeApiKey, model: knowledgeModel, setModel: setKnowledgeModel, defaultUrl: 'https://api.example.com/v1', defaultModel: 'provider/model-name', hint: 'Dedicated chat-completions model used only for global knowledge extraction. All three fields are required.' },
                  ].map((svc) => {
                    const isOpen = openAiAccordion === svc.service;
                    return (
                      <div key={svc.service} className="border border-gray-200 dark:border-white/10 rounded-xl overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setOpenAiAccordion(isOpen ? null : svc.service)}
                          className="w-full flex items-center justify-between p-4 bg-white dark:bg-white/5 hover:bg-gray-50 dark:hover:bg-white/10 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <svg className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{svc.label}</h3>
                            <span className="text-xs text-gray-400 dark:text-slate-500">{svc.model || svc.defaultModel}</span>
                          </div>
                          {REQUIRED_BADGE}
                        </button>
                        {isOpen && (
                          <div className="px-4 pb-4 space-y-4 border-t border-gray-100 dark:border-white/5 pt-4">
                            <div>
                              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Base URL</label>
                              <input type="text" value={svc.baseUrl} onChange={(e) => svc.setBaseUrl(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-white/20 rounded-lg shadow-sm focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 text-sm font-mono text-gray-600 dark:text-slate-400"
                                placeholder={svc.defaultUrl}
                              />
                              {svc.hint && (
                                <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">{svc.hint}</p>
                              )}
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">API Key</label>
                              <input type="password" value={svc.apiKey} onChange={(e) => svc.setApiKey(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-white/20 rounded-lg shadow-sm focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 text-sm font-mono text-gray-600 dark:text-slate-400"
                                placeholder="Paste API key only, without Bearer"
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Model Name</label>
                              <input type="text" value={svc.model} onChange={(e) => svc.setModel(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-white/20 rounded-lg shadow-sm focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 text-sm font-mono text-gray-600 dark:text-slate-400"
                                placeholder={svc.defaultModel}
                              />
                            </div>
                            <div>
                              <button type="button" onClick={() => handleTestAiConnection(svc.service)}
                                disabled={testingAiService === svc.service}
                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-sm transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {testingAiService === svc.service ? (<><Loader2 className="w-4 h-4 animate-spin" /> Testing...</>) : 'Test Connection'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* AI Cost Tracking Accordion */}
                  <div className="border border-gray-200 dark:border-white/10 rounded-xl overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setOpenAiAccordion(openAiAccordion === 'cost' ? null : 'cost')}
                      className="w-full flex items-center justify-between p-4 bg-white dark:bg-white/5 hover:bg-gray-50 dark:hover:bg-white/10 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <svg className={`w-4 h-4 text-gray-400 transition-transform ${openAiAccordion === 'cost' ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">AI Cost Tracking</h3>
                        <span className="text-xs text-gray-400 dark:text-slate-500">Per-provider billing endpoints</span>
                      </div>
                    </button>
                    {openAiAccordion === 'cost' && (
                      <div className="px-4 pb-4 space-y-6 border-t border-gray-100 dark:border-white/5 pt-4">
                        {/* Chat Cost */}
                        <div className="space-y-3">
                          <h4 className="text-xs font-bold text-gray-500 dark:text-slate-500 uppercase tracking-wider">Chat Provider Cost</h4>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Cost Base URL</label>
                              <input type="text" value={chatCostUrl} onChange={(e) => setChatCostUrl(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-white/20 rounded-lg shadow-sm focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 text-sm font-mono text-gray-600 dark:text-slate-400"
                                placeholder="https://api.chatqt.com/api/v1/generation"
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Cost API Key</label>
                              <input type="password" value={chatCostKey} onChange={(e) => setChatCostKey(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-white/20 rounded-lg shadow-sm focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 text-sm font-mono text-gray-600 dark:text-slate-400"
                                placeholder="Paste API key only, without Bearer"
                              />
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button type="button" onClick={async () => {
                              if (!chatCostUrl.trim() || !chatCostKey.trim()) return;
                              setTestingAiService('cost');
                              setSuccessMessage(null);
                              setErrorMessage(null);
                              setSuccessMessage('Sending test request... waiting for provider to index cost (may take a few minutes).');
                              try {
                                const token = localStorage.getItem('access_token');
                                const res = await fetch('/ai/test-cost-connection', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                                  body: JSON.stringify({ base_url: chatCostUrl, api_key: chatCostKey }),
                                });
                                const data = await res.json();
                                if (res.ok && data.success) setSuccessMessage(data.message || 'Cost data received!');
                                else setErrorMessage(data.detail || data.message || 'Cost connection failed.');
                              } catch {
                                setErrorMessage('Network error testing cost connection.');
                              } finally {
                                setTestingAiService(null);
                                setTimeout(() => { setSuccessMessage(null); setErrorMessage(null); }, 8000);
                              }
                            }}
                              disabled={testingAiService === 'cost'}
                              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-sm transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {testingAiService === 'cost' ? (<><Loader2 className="w-4 h-4 animate-spin" /> Fetching cost data...</>) : 'Test Connection'}
                            </button>
                          </div>
                        </div>
                        {/* Wallet Balance */}
                        <div className="space-y-3">
                          <h4 className="text-xs font-bold text-gray-500 dark:text-slate-500 uppercase tracking-wider">Provider Wallet Balance</h4>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Wallet Balance Base URL</label>
                              <input type="text" value={walletBalanceUrl} onChange={(e) => setWalletBalanceUrl(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-white/20 rounded-lg shadow-sm focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 text-sm font-mono text-gray-600 dark:text-slate-400"
                                placeholder="https://api.chatqt.com/api/v1/wallet/balance"
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Wallet API Key</label>
                              <input type="password" value={walletBalanceKey} onChange={(e) => setWalletBalanceKey(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-white/20 rounded-lg shadow-sm focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 text-sm font-mono text-gray-600 dark:text-slate-400"
                                placeholder="Paste API key only, without Bearer"
                              />
                            </div>
                          </div>
                          <div>
                            <button type="button" onClick={async () => {
                              if (!walletBalanceUrl.trim() || !walletBalanceKey.trim()) return;
                              setTestingAiService('wallet');
                              setSuccessMessage(null);
                              setErrorMessage(null);
                              try {
                                const token = localStorage.getItem('access_token');
                                const res = await fetch('/ai/test-wallet-balance', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                                  body: JSON.stringify({ base_url: walletBalanceUrl, api_key: walletBalanceKey }),
                                });
                                const data = await res.json();
                                if (res.ok && data.success) setSuccessMessage(data.message || 'Wallet balance retrieved!');
                                else setErrorMessage(data.detail || data.message || 'Failed to get wallet balance.');
                              } catch {
                                setErrorMessage('Network error checking wallet balance.');
                              } finally {
                                setTestingAiService(null);
                                setTimeout(() => { setSuccessMessage(null); setErrorMessage(null); }, 8000);
                              }
                            }}
                              disabled={testingAiService === 'wallet'}
                              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-sm transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {testingAiService === 'wallet' ? (<><Loader2 className="w-4 h-4 animate-spin" /> Checking...</>) : 'Check Balance'}
                            </button>
                          </div>
                        </div>
                        {/* Cost Results Table */}
                        {costResults.length > 0 && (
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-gray-200 dark:border-white/10">
                                  <th className="text-left py-2 px-3 font-semibold text-gray-500 dark:text-slate-400">Model</th>
                                  <th className="text-right py-2 px-3 font-semibold text-gray-500 dark:text-slate-400">Prompt Tokens</th>
                                  <th className="text-right py-2 px-3 font-semibold text-gray-500 dark:text-slate-400">Completion Tokens</th>
                                  <th className="text-right py-2 px-3 font-semibold text-gray-500 dark:text-slate-400">Total Cost</th>
                                  <th className="text-right py-2 px-3 font-semibold text-gray-500 dark:text-slate-400">Gen Time (ms)</th>
                                  <th className="text-right py-2 px-3 font-semibold text-gray-500 dark:text-slate-400">Date</th>
                                </tr>
                              </thead>
                              <tbody>
                                {costResults.map((entry: any, idx: number) => (
                                  <tr key={idx} className="border-b border-gray-100 dark:border-white/5 hover:bg-gray-50 dark:hover:bg-white/5">
                                    <td className="py-2 px-3 font-mono text-gray-700 dark:text-slate-300">{entry.model || '-'}</td>
                                    <td className="py-2 px-3 text-right text-gray-600 dark:text-slate-400">{(entry.tokens_prompt ?? entry.prompt_tokens ?? 0).toLocaleString()}</td>
                                    <td className="py-2 px-3 text-right text-gray-600 dark:text-slate-400">{(entry.tokens_completion ?? entry.completion_tokens ?? 0).toLocaleString()}</td>
                                    <td className="py-2 px-3 text-right font-semibold text-emerald-600 dark:text-emerald-400">${((entry.total_cost ?? entry.cost ?? 0)).toFixed(8)}</td>
                                    <td className="py-2 px-3 text-right text-gray-500 dark:text-slate-500">{entry.generation_time != null ? entry.generation_time.toLocaleString() : '-'}</td>
                                    <td className="py-2 px-3 text-right text-gray-500 dark:text-slate-500">{entry.created_at ? new Date(entry.created_at).toLocaleString() : '-'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Whisper Configuration Section */}
                  <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8 py-6 border-b border-gray-200/60 dark:border-white/10">
                    <div>
                      <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">Whisper Path Configuration {REQUIRED_BADGE}</h3>
                      <p className="text-sm text-gray-500 dark:text-slate-500 mt-1">Locate local whisper-cli.exe and GGML model for transcription.</p>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Whisper Executable Path</label>
                        <div className="flex gap-2">
                          <input 
                            type="text" 
                            value={whisperPath}
                            onChange={(e) => setWhisperPath(e.target.value)}
                            className="flex-1 px-3 py-2 border border-gray-300 dark:border-white/20 rounded-lg shadow-sm focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 text-sm font-mono text-gray-600 dark:text-slate-400"
                            placeholder="C:\whisper\whisper-cli.exe"
                          />
                          <button
                            type="button"
                            onClick={() => handleSelectFile(setWhisperPath)}
                            className="px-3 py-2 bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 border border-gray-300 dark:border-white/20 rounded-lg text-gray-700 dark:text-slate-300 transition-colors shadow-sm"
                            title="Browse file"
                          >
                            <FolderOpen size={18} strokeWidth={2.5} />
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Whisper GGML Model Path</label>
                        <div className="flex gap-2">
                          <input 
                            type="text" 
                            value={whisperModelPath}
                            onChange={(e) => setWhisperModelPath(e.target.value)}
                            className="flex-1 px-3 py-2 border border-gray-300 dark:border-white/20 rounded-lg shadow-sm focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 text-sm font-mono text-gray-600 dark:text-slate-400"
                            placeholder="C:\whisper\models\ggml-base.en.bin"
                          />
                          <button
                            type="button"
                            onClick={() => handleSelectFile(setWhisperModelPath)}
                            className="px-3 py-2 bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 border border-gray-300 dark:border-white/20 rounded-lg text-gray-700 dark:text-slate-300 transition-colors shadow-sm"
                            title="Browse file"
                          >
                            <FolderOpen size={18} strokeWidth={2.5} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                      <div>
                        <button
                          type="button"
                          onClick={() => handleTestLocalDependency('whisper')}
                          disabled={testingAiService === 'whisper'}
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-sm transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {testingAiService === 'whisper' ? (<><Loader2 className="w-4 h-4 animate-spin" /> Testing...</>) : 'Test Whisper Configuration'}
                        </button>
                      </div>

                  {/* Whisper Threads Configuration */}
                  <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8 py-6 border-b border-gray-200/60 dark:border-white/10">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Whisper Threads</h3>
                      <p className="text-sm text-gray-500 dark:text-slate-500 mt-1">Number of CPU threads for Whisper transcription. Set to 0 for auto-detect.</p>
                    </div>
                    <div className="space-y-4">
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setWhisperThreads(whisperThreads === 0 ? (systemInfo?.cpuCores ? Math.max(2, systemInfo.cpuCores - 1) : 4) : 0)}
                          className={`text-xs font-bold px-3 py-1.5 rounded-md transition-colors shrink-0 ${whisperThreads === 0 ? 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400' : 'bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-slate-300'}`}
                        >
                          {whisperThreads === 0 ? 'Auto' : `${whisperThreads} threads`}
                        </button>
                        <Slider
                          value={whisperThreads}
                          onChange={(_, value) => setWhisperThreads(value as number)}
                          min={0}
                          max={systemInfo ? Math.min(systemInfo.cpuCores, 32) : (typeof navigator !== 'undefined' ? Math.min(navigator.hardwareConcurrency || 16, 32) : 16)}
                          step={1}
                          marks
                          valueLabelDisplay="auto"
                          valueLabelFormat={(value) => value === 0 ? 'Auto' : value}
                          sx={{
                            color: '#2563eb',
                            height: 8,
                            padding: '10px 0',
                            position: 'relative',
                            '& .MuiSlider-markLabel': {
                              fontSize: '0.65rem',
                              color: '#9ca3af',
                              marginTop: '8px',
                              pointerEvents: 'none',
                            },
                            '& .MuiSlider-mark': {
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              backgroundColor: '#ffffff',
                              border: '2px solid #d1d5db',
                              pointerEvents: 'none',
                              opacity: 1,
                              top: '50%',
                              transform: 'translate(-50%, -50%)',
                              position: 'absolute',
                            },
                            '& .MuiSlider-markActive': {
                              backgroundColor: '#ffffff',
                              border: '2px solid #ffffff',
                              boxShadow: '0 0 4px rgba(37, 99, 235, 0.5)',
                            },
                            '& .MuiSlider-rail': {
                              opacity: 1,
                              height: 8,
                              backgroundColor: '#e5e7eb',
                              border: 'none',
                              pointerEvents: 'none',
                            },
                            '& .MuiSlider-track': {
                              height: 8,
                              border: 'none',
                              backgroundColor: '#2563eb',
                              pointerEvents: 'none',
                            },
                            '& .MuiSlider-thumb': {
                              width: 20,
                              height: 20,
                              backgroundColor: '#2563eb',
                              border: '3px solid #ffffff',
                              boxShadow: '0 2px 8px rgba(37, 99, 235, 0.4)',
                              position: 'absolute',
                              top: '50%',
                              transform: 'translate(-50%, -50%)',
                              transition: 'box-shadow 150ms ease',
                              pointerEvents: 'auto',
                              '&:hover': {
                                boxShadow: '0 0 0 8px rgba(37, 99, 235, 0.15), 0 2px 8px rgba(37, 99, 235, 0.4)',
                              },
                              '&.Mui-active': {
                                boxShadow: '0 0 0 12px rgba(37, 99, 235, 0.2), 0 2px 8px rgba(37, 99, 235, 0.4)',
                              },
                            },
                            '& .MuiSlider-valueLabel': {
                              fontSize: '0.75rem',
                              padding: '4px 8px',
                              backgroundColor: '#1f2937',
                              borderRadius: '6px',
                              transform: 'translateY(-100%) scale(0.9)',
                              '&::before': {
                                display: 'none',
                              },
                            },
                          }}
                          className="flex-1"
                        />
                      </div>
                      <p className="text-xs text-gray-400 dark:text-slate-500">
                        {systemInfo ? `${systemInfo.cpuCores} cores, ${systemInfo.ramGb} GB RAM detected` : 'Detecting system specs...'}
                      </p>
                    </div>
                  </div>

                  {/* Tesseract OCR Configuration Section */}
                  <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8 py-6 border-b border-gray-200/60 dark:border-white/10">
                    <div>
                      <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">Tesseract OCR {REQUIRED_BADGE}</h3>
                      <p className="text-sm text-gray-500 dark:text-slate-500 mt-1">OCR engine for extracting text from images and scanned PDFs.</p>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Tesseract Executable Path</label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={tesseractPath}
                            onChange={(e) => setTesseractPath(e.target.value)}
                            className="flex-1 px-3 py-2 border border-gray-300 dark:border-white/20 rounded-lg shadow-sm focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 text-sm font-mono text-gray-600 dark:text-slate-400"
                            placeholder="C:\Program Files\Tesseract-OCR\tesseract.exe"
                          />
                          <button
                            type="button"
                            onClick={() => handleSelectFile(setTesseractPath)}
                            className="px-3 py-2 bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 border border-gray-300 dark:border-white/20 rounded-lg text-gray-700 dark:text-slate-300 transition-colors shadow-sm"
                            title="Browse file"
                          >
                            <FolderOpen size={18} strokeWidth={2.5} />
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center justify-between p-4 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl shadow-sm">
                        <div className="flex-1">
                          <h4 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                            Tesseract OCR
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${tesseractInstalled ? 'bg-green-50 text-green-600 dark:bg-green-500/20 dark:text-green-300' : 'bg-yellow-50 text-yellow-600 dark:bg-yellow-500/20 dark:text-yellow-300'}`}>
                              {tesseractInstalled ? 'Installed' : 'Not Installed'}
                            </span>
                          </h4>
                          <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">Required for OCR of images and scanned PDFs. Click install to set up automatically.</p>
                          {installingTesseract && (
                            <div className="mt-3 w-full bg-gray-200 rounded-full h-2 dark:bg-gray-700 overflow-hidden">
                              <div className="bg-indigo-600 h-2 rounded-full animate-pulse" style={{ width: '60%' }}></div>
                            </div>
                          )}
                        </div>
                        <div className="pl-4">
                          <button
                            onClick={async () => {
                              setInstallingTesseract(true);
                              try {
                                const token = localStorage.getItem('access_token');
                                const res = await fetch('/ai/install-tesseract', {
                                  method: 'POST',
                                  headers: { 'Authorization': `Bearer ${token}` },
                                });
                                const data = await res.json();
                                if (data.success) {
                                  setTesseractPath(data.path || '');
                                  setTesseractInstalled(true);
                                  setSuccessMessage(data.message);
                                  setTimeout(() => setSuccessMessage(null), 5000);
                                } else {
                                  setErrorMessage(data.message);
                                  setTimeout(() => setErrorMessage(null), 5000);
                                }
                              } catch {
                                setErrorMessage('Failed to install Tesseract.');
                                setTimeout(() => setErrorMessage(null), 5000);
                              } finally {
                                setInstallingTesseract(false);
                              }
                            }}
                            disabled={installingTesseract}
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-sm transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {installingTesseract ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Installing...
                              </>
                            ) : tesseractInstalled ? 'Reinstall' : 'Install'}
                          </button>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const token = localStorage.getItem('access_token');
                            const res = await fetch('/ai/detect-tesseract', {
                              headers: { 'Authorization': `Bearer ${token}` },
                            });
                            const data = await res.json();
                            if (data.installed) {
                              setTesseractPath(data.path || '');
                              setTesseractInstalled(true);
                              setSuccessMessage(`Tesseract detected at: ${data.path}`);
                            } else {
                              setTesseractInstalled(false);
                              setErrorMessage('Tesseract not found. Please install it first.');
                            }
                            setTimeout(() => { setSuccessMessage(null); setErrorMessage(null); }, 4000);
                          } catch {
                            setErrorMessage('Failed to detect Tesseract.');
                            setTimeout(() => setErrorMessage(null), 4000);
                          }
                        }}
                        className="px-4 py-2 bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-700 dark:text-slate-300 rounded-lg text-xs font-bold shadow-sm transition-all"
                      >
                        Detect Installed
                      </button>
                      <button type="button" onClick={() => handleTestLocalDependency('tesseract')}
                        disabled={testingAiService === 'tesseract'}
                        className="mt-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-sm transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {testingAiService === 'tesseract' ? (<><Loader2 className="w-4 h-4 animate-spin" /> Testing...</>) : 'Test Tesseract Configuration'}
                      </button>
                    </div>
                  </div>

                                    {/* WTP Canine Configuration Section - Accordion */}
                  <div className="border border-gray-200 dark:border-white/10 rounded-xl overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setOpenWhisperAccordion(openWhisperAccordion === 'wtp' ? null : 'wtp')}
                      className="w-full flex items-center justify-between p-4 bg-white dark:bg-white/5 hover:bg-gray-50 dark:hover:bg-white/10 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <svg className={`w-4 h-4 text-gray-400 transition-transform ${openWhisperAccordion === 'wtp' ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">WTP Canine Sentence Model</h3>
                      </div>
                      {REQUIRED_BADGE}
                    </button>
                    {openWhisperAccordion === 'wtp' && (
                    <div className="px-4 pb-4 space-y-4 border-t border-gray-100 dark:border-white/5 pt-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">WTP Canine Model Folder</label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={wtpModelPath}
                            onChange={(e) => setWtpModelPath(e.target.value)}
                            className="flex-1 px-3 py-2 border border-gray-300 dark:border-white/20 rounded-lg shadow-sm focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 text-sm font-mono text-gray-600 dark:text-slate-400"
                            placeholder="C:\models\sat-3l"
                          />
                          <button
                            type="button"
                            onClick={() => handleSelectFolderForSetting(setWtpModelPath)}
                            className="px-3 py-2 bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 border border-gray-300 dark:border-white/20 rounded-lg text-gray-700 dark:text-slate-300 transition-colors shadow-sm"
                            title="Browse folder"
                          >
                            <FolderOpen size={18} strokeWidth={2.5} />
                          </button>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <p className="text-xs text-gray-500 dark:text-slate-500">
                          {systemInfo
                            ? `${systemInfo.cpuCores} cores and ${systemInfo.ramGb} GB RAM detected. Recommended WTP model: ${recommendedWtpModel}.`
                            : 'Detecting system specs to recommend the best WTP model for this computer.'}
                        </p>
                        {WTP_MODELS.map((model) => {
                          const trackName = `wtp-${model.name}`;
                          const isRecommended = recommendedWtpModel === model.name;
                          return (
                            <div
                              key={model.name}
                              className={`flex flex-col gap-4 p-4 bg-white dark:bg-white/5 border rounded-xl shadow-sm sm:flex-row sm:items-center sm:justify-between ${
                                isRecommended
                                  ? 'border-orange-300 ring-1 ring-orange-200 dark:border-orange-500/50 dark:ring-orange-500/20'
                                  : 'border-gray-200 dark:border-white/10'
                              }`}
                            >
                              <div className="flex-1">
                                <h4 className="text-sm font-semibold text-gray-900 dark:text-white flex flex-wrap items-center gap-2">
                                  {model.label}
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300">
                                    {model.power}
                                  </span>
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300">
                                    {model.ramGb}+ GB RAM
                                  </span>
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300">
                                    {model.size}
                                  </span>
                                  {isRecommended && (
                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300">
                                      Best for this PC
                                    </span>
                                  )}
                                </h4>
                                <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">
                                  {model.desc} Downloaded models are stored locally; save settings after download to make the selected folder active.
                                </p>
                                {downloadingModel === trackName && (
                                  <div className="mt-3 w-full bg-gray-200 rounded-full h-2 dark:bg-gray-700 overflow-hidden">
                                    <div className="bg-indigo-600 h-2 rounded-full transition-all duration-300" style={{ width: `${downloadProgress}%` }}></div>
                                  </div>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => handleDownloadWtpModel(model.name)}
                                disabled={downloadingModel !== null}
                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {downloadingModel === trackName ? (
                                  <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    {downloadProgress}%
                                  </>
                                ) : (
                                  'Download'
                                )}
                              </button>
                            </div>
                          );
                        })}
                        <button
                          type="button"
                          onClick={() => handleTestLocalDependency('wtp')}
                          disabled={testingAiService === 'wtp'}
                          className="px-4 py-2 bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-700 dark:text-slate-300 rounded-lg text-xs font-bold shadow-sm transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {testingAiService === 'wtp' ? (<><Loader2 className="w-4 h-4 animate-spin" /> Testing...</>) : 'Test WTP Model'}
                        </button>
                      </div>
                    </div>
                    )}
                  </div>

{/* Download Whisper Engine Section */}
                  <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8 py-6 border-b border-gray-200/60 dark:border-white/10">
                    <div>
                      <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">Download Whisper Engine {REQUIRED_BADGE}</h3>
                      <p className="text-sm text-gray-500 dark:text-slate-500 mt-1">Download the whisper-cli executable for local transcription.</p>
                    </div>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-4 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl shadow-sm">
                        <div>
                          <h4 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                            whisper-cli
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-green-50 text-green-600 dark:bg-green-500/20 dark:text-green-300">
                              ~3 MB
                            </span>
                          </h4>
                          <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">CPU-optimized whisper engine. Required for local transcription of audio and video files.</p>

                          {downloadingModel === 'whisper-cli' && (
                            <div className="mt-3 w-full bg-gray-200 rounded-full h-2 dark:bg-gray-700 overflow-hidden">
                              <div className="bg-indigo-600 h-2 rounded-full transition-all duration-300" style={{ width: `${downloadProgress}%` }}></div>
                            </div>
                          )}
                        </div>
                        <div className="pl-4">
                          <button
                            onClick={() => handleDownloadModel('main', 'whisper-cli')}
                            disabled={downloadingModel !== null}
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-sm transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {downloadingModel === 'whisper-cli' ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                {downloadProgress}%
                              </>
                            ) : (
                              'Download'
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Download Whisper Models Section - Accordion */}
                  <div className="border border-gray-200 dark:border-white/10 rounded-xl overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setOpenWhisperAccordion(openWhisperAccordion === 'models' ? null : 'models')}
                      className="w-full flex items-center justify-between p-4 bg-white dark:bg-white/5 hover:bg-gray-50 dark:hover:bg-white/10 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <svg className={`w-4 h-4 text-gray-400 transition-transform ${openWhisperAccordion === 'models' ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                        <div className="text-left">
                          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Download Whisper Models</h3>
                          <p className="text-xs text-gray-500 dark:text-slate-500">Download CPU-optimized GGML models directly to your PC.</p>
                        </div>
                      </div>
                      {REQUIRED_BADGE}
                    </button>
                    {openWhisperAccordion === 'models' && (
                    <div className="px-4 pb-4 space-y-3 border-t border-gray-100 dark:border-white/5 pt-4">
                      {[
                        { name: 'ggml-tiny.en.bin', label: 'Tiny (English)', ram: '~1 GB RAM', ramGb: 1, desc: 'Fastest, but lowest accuracy. Good for quick testing.' },
                        { name: 'ggml-base.en.bin', label: 'Base (English)', ram: '~1.5 GB RAM', ramGb: 1.5, desc: 'A great balance of speed and accuracy for most use cases.' },
                        { name: 'ggml-small.en.bin', label: 'Small (English)', ram: '~3 GB RAM', ramGb: 3, desc: 'High accuracy, runs well on most modern CPUs.' },
                        { name: 'ggml-medium.en.bin', label: 'Medium (English)', ram: '~6 GB RAM', ramGb: 6, desc: 'Highest accuracy, but may run slowly on older hardware.' },
                      ].map((model) => {
                        const isRecommended = systemInfo && model.ramGb <= systemInfo.ramGb * 0.5;
                        const isBestFit = systemInfo && model.ramGb <= systemInfo.ramGb * 0.75 && !(
                          model.name === 'ggml-tiny.en.bin' && systemInfo.ramGb >= 4
                        );
                        return (
                        <div key={model.name} className={`flex items-center justify-between p-4 bg-white dark:bg-white/5 border rounded-xl shadow-sm ${isRecommended && isBestFit ? 'border-indigo-300 dark:border-indigo-500/40 ring-1 ring-indigo-200 dark:ring-indigo-500/20' : 'border-gray-200 dark:border-white/10'}`}>
                          <div>
                            <h4 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                              {model.label} 
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300">
                                {model.ram}
                              </span>
                              {isRecommended && isBestFit && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-green-50 text-green-600 dark:bg-green-500/20 dark:text-green-300">
                                  Recommended
                                </span>
                              )}
                            </h4>
                            <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">{model.desc}</p>
                            
                            {downloadingModel === model.name && (
                              <div className="mt-3 w-full bg-gray-200 rounded-full h-2 dark:bg-gray-700 overflow-hidden">
                                <div className="bg-indigo-600 h-2 rounded-full transition-all duration-300" style={{ width: `${downloadProgress}%` }}></div>
                              </div>
                            )}
                          </div>
                          <div className="pl-4">
                            <button
                              onClick={() => handleDownloadModel(model.name)}
                              disabled={downloadingModel !== null}
                              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-sm transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {downloadingModel === model.name ? (
                                <>
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  {downloadProgress}%
                                </>
                              ) : (
                                'Download'
                              )}
                            </button>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                    )}
                  </div>

                                    {/* RAG Enhancement Features Section - Accordion */}
                  <div className="border border-gray-200 dark:border-white/10 rounded-xl overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setOpenWhisperAccordion(openWhisperAccordion === 'rag' ? null : 'rag')}
                      className="w-full flex items-center justify-between p-4 bg-white dark:bg-white/5 hover:bg-gray-50 dark:hover:bg-white/10 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <svg className={`w-4 h-4 text-gray-400 transition-transform ${openWhisperAccordion === 'rag' ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">RAG Enhancement Features</h3>
                        <span className="text-xs text-gray-400 dark:text-slate-500">Toggle advanced retrieval improvements</span>
                      </div>
                    </button>
                    {openWhisperAccordion === 'rag' && (
                    <div className="px-4 pb-4 space-y-4 border-t border-gray-100 dark:border-white/5 pt-4">
                      {[
                        {
                          key: 'ragChunkOverlap',
                          value: ragChunkOverlap,
                          setter: setRagChunkOverlap,
                          label: 'Chunk Overlap',
                          desc: 'Preserves context across chunk boundaries by overlapping text between consecutive chunks.',
                          tooltip: 'When your documents are split into chunks for search, some context can be lost at the boundaries. This feature overlaps the end of one chunk with the start of the next, so the AI never misses information that spans across chunks. Improves answer quality for long, connected passages.',
                        },
                        {
                          key: 'ragQueryRouting',
                          value: ragQueryRouting,
                          setter: setRagQueryRouting,
                          label: 'Query Routing',
                          desc: 'Skips retrieval for greetings and small talk, responding directly without searching your library.',
                          tooltip: 'When you say "Hello" or "Thanks", the system normally searches your entire library before responding. This feature detects non-informational messages and responds directly, saving time and compute. Only affects greetings — real questions always search your library.',
                        },
                        {
                          key: 'ragNliVerification',
                          value: ragNliVerification,
                          setter: setRagNliVerification,
                          label: 'NLI Hallucination Check',
                          desc: 'Uses Natural Language Inference to verify each claim in the answer against your documents.',
                          tooltip: 'After generating an answer, this feature checks every sentence against your documents using Natural Language Inference. It catches contradictions and unsupported claims that basic fact-checking might miss. Runs entirely on your machine — no API calls needed.',
                        },
                        {
                          key: 'ragAdaptiveRrf',
                          value: ragAdaptiveRrf,
                          setter: setRagAdaptiveRrf,
                          label: 'Adaptive Fusion',
                          desc: 'Adjusts how vector and keyword results are combined based on your question type.',
                          tooltip: 'Your system searches using both meaning-based (vector) and keyword-based methods, then combines results. This feature adjusts the combination ratio based on your question: tighter fusion for exact lookups like "page 42", standard fusion for broad research questions. Always on by default.',
                        },
                        {
                          key: 'ragParentChild',
                          value: ragParentChild,
                          setter: setRagParentChild,
                          label: 'Parent-Child Expansion',
                          desc: 'Expands matched chunks into their surrounding context for richer answers.',
                          tooltip: 'When a small chunk matches your query, this feature fetches the larger section it belongs to, giving the AI more surrounding context. Especially useful for detailed questions where a single chunk would be too narrow. Uses smart budgeting to avoid overwhelming the answer.',
                        },
                        {
                          key: 'ragHierarchical',
                          value: ragHierarchical,
                          setter: setRagHierarchical,
                          label: 'Hierarchical Context',
                          desc: 'Adds section, chapter, and document summaries to improve answer depth.',
                          tooltip: 'Beyond individual chunks, this feature adds higher-level context: section headings, chapter summaries, and document overviews. Particularly helpful for summarization and comparison questions where understanding the big picture matters. Adapts which levels to include based on your question type.',
                        },
                        {
                          key: 'ragContextualEnrichment',
                          value: ragContextualEnrichment,
                          setter: setRagContextualEnrichment,
                          label: 'Document Contextual Enrichment',
                          desc: 'Adds LLM-generated context to document chunks (PDF, DOCX, images) before embedding.',
                          tooltip: 'For PDF, DOCX, and image files, this feature generates a one-sentence context description for each chunk before embedding it. This helps the search understand where each chunk fits in the document, improving retrieval accuracy. Uses your configured LLM API — costs tokens per chunk at ingestion time. Default OFF for document types.',
                        },
                        {
                          key: 'mediaContextualEnrichment',
                          value: mediaContextualEnrichment,
                          setter: setMediaContextualEnrichment,
                          label: 'Media Contextual Enrichment',
                          desc: 'Adds LLM-generated context to media chunks (videos, audios, YouTube) before embedding.',
                          tooltip: 'For video, audio, and YouTube files, this feature generates a one-sentence context description for each chunk before embedding it. This helps the search understand where each chunk fits in the media content, improving retrieval accuracy. Uses your configured LLM API — costs tokens per chunk at ingestion time. Default OFF.',
                        },
                      ].map((toggle) => (
                        <div key={toggle.key} className="flex items-center justify-between p-4 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl shadow-sm">
                          <div className="flex-1 mr-4">
                            <div className="flex items-center gap-2">
                              <h4 className="text-sm font-semibold text-gray-900 dark:text-white">{toggle.label}</h4>
                              <div className="relative group">
                                <Info className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500 hover:text-indigo-500 dark:hover:text-indigo-400 cursor-help transition-colors" />
                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-3 bg-gray-900 dark:bg-gray-800 text-white text-xs leading-relaxed rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 pointer-events-none">
                                  {toggle.tooltip}
                                  <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 w-2 h-2 bg-gray-900 dark:bg-gray-800 rotate-45"></div>
                                </div>
                              </div>
                            </div>
                            <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">{toggle.desc}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggle.setter(!toggle.value)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                              toggle.value ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-white/20'
                            }`}
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                toggle.value ? 'translate-x-6' : 'translate-x-1'
                              }`}
                            />
                          </button>
                        </div>
                      ))}
                    </div>
                    )}
                  </div>

{/* Clear Cache Section */}
                  <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8 py-6">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Cache Storage</h3>
                      <p className="text-sm text-gray-500 dark:text-slate-500 mt-1">Clear cached RAG answers to force fresh retrieval.</p>
                    </div>
                    <div>
                      <div className="flex items-center justify-between p-4 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl shadow-sm">
                        <div>
                          <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Semantic Cache</h4>
                          <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">Removes all cached Q&A pairs for your resources. The next query will retrieve and generate fresh results.</p>
                        </div>
                        <button
                          onClick={async () => {
                            if (!confirm('Clear all cached RAG answers? This cannot be undone.')) return;
                            try {
                              const token = localStorage.getItem('access_token');
                              const res = await fetch('/me/cache', {
                                method: 'DELETE',
                                headers: { 'Authorization': `Bearer ${token}` },
                              });
                              if (res.ok) {
                                const data = await res.json();
                                setSuccessMessage(`Cache cleared! ${data.deleted} entries removed.`);
                                setTimeout(() => setSuccessMessage(null), 4000);
                              } else {
                                setErrorMessage('Failed to clear cache.');
                                setTimeout(() => setErrorMessage(null), 4000);
                              }
                            } catch {
                              setErrorMessage('Failed to clear cache.');
                              setTimeout(() => setErrorMessage(null), 4000);
                            }
                          }}
                          className="px-4 py-2 bg-red-50 hover:bg-red-100 dark:bg-red-500/10 dark:hover:bg-red-500/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/20 rounded-lg text-xs font-bold shadow-sm transition-all whitespace-nowrap shrink-0"
                        >
                          Clear Cache
                        </button>
                      </div>
                    </div>
                  </div>

                </div>
              )}

              {/* === Workspace Storage Paths Tab === */}
              {activeTab === 'storage' && (
                <div className="space-y-8">
                  
                  {/* Active Storage Path Section */}
                  <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8 py-6 border-b border-gray-200/60 dark:border-white/10">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Active Storage Path</h3>
                      <p className="text-sm text-gray-500 dark:text-slate-500 mt-1">Your primary workspace location for saving and reading files.</p>
                    </div>
                    <div>
                      <div className="p-4 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/30 rounded-xl flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center">
                            <CheckCircle2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                          </div>
                          <div className="overflow-hidden max-w-[300px]">
                            <p className="text-sm font-semibold text-gray-900 dark:text-white">Current Workspace</p>
                            <p className="text-xs text-indigo-600/80 dark:text-indigo-400/80 font-mono mt-0.5 truncate">{activeStorage || 'None (Default App Storage)'}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Storage Library List Section */}
                  <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8 py-6 border-b border-gray-200/60 dark:border-white/10">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Registered Libraries</h3>
                      <p className="text-sm text-gray-500 dark:text-slate-500 mt-1">Alternative directories you've registered. Switch workspaces easily.</p>
                    </div>
                    <div className="space-y-3">
                      {storageLibraries.map((lib) => (
                        <div key={lib.id} className="flex items-center justify-between p-3 border border-gray-200 dark:border-white/10 rounded-lg bg-white dark:bg-white/5 shadow-sm hover:border-indigo-300 transition-colors">
                          <div className="flex items-center gap-3 overflow-hidden">
                            <FolderOpen className="w-4 h-4 text-gray-400 shrink-0" />
                            <div className="flex flex-col overflow-hidden">
                              <span className="text-sm font-semibold text-gray-700 dark:text-slate-300">{lib.name}</span>
                              <span className="text-xs text-gray-400 font-mono truncate">{lib.path}</span>
                            </div>
                          </div>
                          <div className="flex gap-2 shrink-0">
                            {lib.path !== activeStorage && (
                              <button 
                                onClick={() => handleSwitchActiveStorage(lib.id)}
                                className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors px-2 py-1"
                              >
                                Switch
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                      {pendingLibraries.map((lib, idx) => (
                        <div key={`pending-${idx}`} className="flex items-center justify-between p-3 border border-dashed border-indigo-300 dark:border-indigo-500/40 rounded-lg bg-indigo-50/50 dark:bg-indigo-500/5 shadow-sm">
                          <div className="flex items-center gap-3 overflow-hidden">
                            <FolderOpen className="w-4 h-4 text-indigo-400 shrink-0" />
                            <div className="flex flex-col overflow-hidden">
                              <span className="text-sm font-semibold text-gray-700 dark:text-slate-300">{lib.name}</span>
                              <span className="text-xs text-gray-400 font-mono truncate">{lib.path}</span>
                            </div>
                            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-500 bg-indigo-100 dark:bg-indigo-500/20 px-1.5 py-0.5 rounded">Pending</span>
                          </div>
                          <button
                            onClick={() => setPendingLibraries(pendingLibraries.filter((_, i) => i !== idx))}
                            className="text-xs font-semibold text-red-500 hover:text-red-700 transition-colors px-2 py-1 shrink-0"
                          >
                            Remove
                          </button>
                        </div>
                      ))}

                      {isAddingLib ? (
                        <form onSubmit={handleRegisterLibrary} className="bg-gray-50 dark:bg-white/10 border border-gray-200 dark:border-white/10 rounded-xl p-4 space-y-4">
                          <h4 className="text-xs font-bold text-gray-500 dark:text-slate-500 uppercase tracking-wider">Register new folder</h4>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[11px] font-bold text-gray-500 dark:text-slate-500 mb-1">Library Name</label>
                              <input 
                                type="text"
                                value={newLibName}
                                onChange={(e) => setNewLibName(e.target.value)}
                                placeholder="e.g. External SSD"
                                className="w-full px-3 py-1.5 border border-gray-300 dark:border-white/20 rounded-lg text-sm bg-white dark:bg-white/5"
                                required
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-bold text-gray-500 dark:text-slate-500 mb-1">Directory Path</label>
                              <div className="flex gap-2">
                                <input 
                                  type="text"
                                  value={newLibPath}
                                  onChange={(e) => setNewLibPath(e.target.value)}
                                  placeholder="C:\..."
                                  className="flex-1 px-3 py-1.5 border border-gray-300 dark:border-white/20 rounded-lg text-sm font-mono bg-white dark:bg-white/5 text-gray-600 dark:text-slate-400"
                                  required
                                />
                                <button 
                                  type="button"
                                  onClick={handleBrowseFolder}
                                  className="px-2.5 py-1.5 bg-gray-200 border border-gray-300 dark:border-white/20 rounded-lg text-gray-600 dark:text-slate-400 hover:bg-gray-300 transition-colors shrink-0"
                                >
                                  <FolderOpen className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          </div>
                          <div className="flex justify-end gap-2 pt-2">
                            <button 
                              type="button" 
                              onClick={() => setIsAddingLib(false)}
                              className="px-3 py-1.5 bg-white dark:bg-white/5 border border-gray-300 dark:border-white/20 rounded-lg text-xs font-semibold text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:bg-white/10"
                            >
                              Cancel
                            </button>
                            <button 
                              type="submit"
                              className="px-3 py-1.5 bg-indigo-600 rounded-lg text-xs font-semibold text-white hover:bg-indigo-700 shadow-sm"
                            >
                              Register
                            </button>
                          </div>
                        </form>
                      ) : (
                        <button 
                          onClick={() => setIsAddingLib(true)}
                          className="w-full py-3 border-2 border-dashed border-gray-200 dark:border-white/10 rounded-lg text-sm font-medium text-gray-500 dark:text-slate-500 flex items-center justify-center gap-2 hover:bg-gray-50 dark:bg-white/10 hover:text-indigo-600 hover:border-indigo-300 transition-all"
                        >
                          <Plus className="w-4 h-4" /> Add new library
                        </button>
                      )}
                    </div>
                  </div>



                </div>
              )}

              {/* === Interface & Appearance Tab === */}
              {activeTab === 'appearance' && (
                <div className="space-y-8">
                  
                  {/* Theme Toggle Section */}
                  <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8 py-6 border-b border-gray-200/60 dark:border-white/10">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Theme</h3>
                      <p className="text-sm text-gray-500 dark:text-slate-500 mt-1">Customize the look and feel of the application.</p>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      {/* Light */}
                      <div 
                        onClick={() => setTheme('light')}
                        className={`cursor-pointer border-2 rounded-xl p-4 flex flex-col items-center gap-3 transition-all ${theme === 'light' ? 'border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/20 dark:border-indigo-500' : 'border-gray-200 dark:border-white/10 dark:border-slate-800 bg-white dark:bg-white/5 dark:bg-slate-900/10 hover:border-gray-300 dark:border-white/20 dark:hover:border-slate-700'}`}
                      >
                        <Sun className={`w-6 h-6 ${theme === 'light' ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-400'}`} />
                        <span className={`text-sm font-semibold ${theme === 'light' ? 'text-indigo-900 dark:text-indigo-200' : 'text-gray-600 dark:text-slate-400'}`}>Light</span>
                      </div>
                      {/* Dark */}
                      <div 
                        onClick={() => setTheme('dark')}
                        className={`cursor-pointer border-2 rounded-xl p-4 flex flex-col items-center gap-3 transition-all ${theme === 'dark' ? 'border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/20 dark:border-indigo-500' : 'border-gray-200 dark:border-white/10 dark:border-slate-800 bg-white dark:bg-white/5 dark:bg-slate-900/10 hover:border-gray-300 dark:border-white/20 dark:hover:border-slate-700'}`}
                      >
                        <Moon className={`w-6 h-6 ${theme === 'dark' ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-400'}`} />
                        <span className={`text-sm font-semibold ${theme === 'dark' ? 'text-indigo-900 dark:text-indigo-200' : 'text-gray-600 dark:text-slate-400'}`}>Dark</span>
                      </div>
                      {/* System */}
                      <div 
                        onClick={() => setTheme('system')}
                        className={`cursor-pointer border-2 rounded-xl p-4 flex flex-col items-center gap-3 transition-all ${theme === 'system' ? 'border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/20 dark:border-indigo-500' : 'border-gray-200 dark:border-white/10 dark:border-slate-800 bg-white dark:bg-white/5 dark:bg-slate-900/10 hover:border-gray-300 dark:border-white/20 dark:hover:border-slate-700'}`}
                      >
                        <Monitor className={`w-6 h-6 ${theme === 'system' ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-400'}`} />
                        <span className={`text-sm font-semibold ${theme === 'system' ? 'text-indigo-900 dark:text-indigo-200' : 'text-gray-600 dark:text-slate-400'}`}>System</span>
                      </div>
                    </div>
                  </div>

                  {/* Compact Mode Section */}
                  <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8 py-6 border-b border-gray-200/60 dark:border-white/10">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Compact Mode</h3>
                      <p className="text-sm text-gray-500 dark:text-slate-500 mt-1">Shrink sidebar size and margins for users with smaller laptop screens.</p>
                    </div>
                    <div className="flex items-center">
                      <button 
                        onClick={() => setCompactMode(!compactMode)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${compactMode ? 'bg-indigo-600' : 'bg-gray-200'}`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white dark:bg-white/5 transition-transform ${compactMode ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                      <span className="ml-3 text-sm text-gray-700 dark:text-slate-300 font-semibold">
                        {compactMode ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                  </div>

                  {/* Language Section */}
                  <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8 py-6">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Language</h3>
                      <p className="text-sm text-gray-500 dark:text-slate-500 mt-1">Select the default interface language.</p>
                    </div>
                    <div>
                      <select 
                        value="en"
                        disabled
                        className="w-full max-w-xs px-3 py-2 border border-gray-300 dark:border-white/20 rounded-lg shadow-sm text-sm font-semibold bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-slate-500 cursor-not-allowed opacity-60"
                      >
                        <option value="en">English (US)</option>
                      </select>
                      <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">More languages coming soon.</p>
                    </div>
                  </div>

                </div>
              )}

              {/* === Desktop Updates Tab === */}
              {activeTab === 'updates' && (
                <div className="space-y-8">
                  <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8 py-6 border-b border-gray-200/60 dark:border-white/10">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Application version</h3>
                      <p className="text-sm text-gray-500 dark:text-slate-500 mt-1">Keep the desktop interface and local AI service updated together.</p>
                    </div>
                    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex items-center gap-4 min-w-0">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
                            <ShieldCheck className="h-5 w-5" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500">Current version</p>
                            <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">{effectiveUpdateState.currentVersion}</p>
                          </div>
                        </div>
                        <span className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-xs font-semibold ring-1 ${
                          effectiveUpdateState.channel === 'testing'
                            ? 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30'
                            : 'bg-indigo-50 text-indigo-700 ring-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-500/30'
                        }`}>
                          {effectiveUpdateState.channel === 'testing' ? 'Testing channel' : 'Stable channel'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8 py-6 border-b border-gray-200/60 dark:border-white/10">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Update status</h3>
                      <p className="text-sm text-gray-500 dark:text-slate-500 mt-1">Updates install only after you approve the download and restart.</p>
                    </div>
                    <div className="space-y-4 min-w-0">
                      {effectiveUpdateState.unsignedTestingMode && (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-5 shadow-sm dark:border-amber-500/30 dark:bg-amber-500/10">
                          <div className="flex items-start gap-3">
                            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                            <div>
                              <h4 className="text-sm font-semibold text-amber-950 dark:text-amber-100">Unsigned Testing updates are enabled</h4>
                              <p className="mt-1 text-sm leading-relaxed text-amber-800 dark:text-amber-200">
                                Beta installers are verified against their published checksum and protected by the normal backup gate, but Windows cannot verify their publisher identity. Use this channel only for trusted preview releases.
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                      {installedUpdateInfo && (
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5 shadow-sm dark:border-emerald-500/30 dark:bg-emerald-500/10">
                          <div className="flex items-start gap-3">
                            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                            <div className="min-w-0">
                              <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Updated successfully to version {installedUpdateInfo.currentVersion}</h4>
                              <p className="mt-1 text-sm text-gray-600 dark:text-slate-300">Previously installed version: {installedUpdateInfo.previousVersion}</p>
                              {installedUpdateInfo.releaseNotes && (
                                <p className="mt-3 max-h-40 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-gray-600 dark:text-slate-300">
                                  {installedUpdateInfo.releaseNotes}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                      <div className={`rounded-2xl border p-5 shadow-sm ${
                        effectiveUpdateState.status === 'error'
                          ? 'border-red-200 bg-red-50/70 dark:border-red-500/30 dark:bg-red-500/10'
                          : effectiveUpdateState.status === 'up-to-date' || effectiveUpdateState.status === 'ready-to-install'
                            ? 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-500/30 dark:bg-emerald-500/10'
                            : 'border-gray-200 bg-white dark:border-white/10 dark:bg-white/5'
                      }`}>
                        <div className="flex items-start gap-3">
                          {(effectiveUpdateState.status === 'checking' || effectiveUpdateState.status === 'downloading' || effectiveUpdateState.status === 'preparing' || effectiveUpdateState.status === 'installing')
                            ? <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-indigo-600 dark:text-indigo-400" />
                            : effectiveUpdateState.status === 'up-to-date' || effectiveUpdateState.status === 'ready-to-install'
                              ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                              : <Info className={`mt-0.5 h-5 w-5 shrink-0 ${effectiveUpdateState.status === 'error' ? 'text-red-600 dark:text-red-400' : 'text-indigo-600 dark:text-indigo-400'}`} />}
                          <div className="min-w-0 flex-1">
                            <h4 className="text-sm font-semibold text-gray-900 dark:text-white">{updateStatusLabel[effectiveUpdateState.status]}</h4>
                            {effectiveUpdateState.errorMessage && (
                              <p className={`mt-1 text-sm leading-relaxed ${effectiveUpdateState.status === 'error' ? 'text-red-700 dark:text-red-300' : 'text-gray-500 dark:text-slate-400'}`}>
                                {effectiveUpdateState.errorMessage}
                              </p>
                            )}
                            {(effectiveUpdateState.status === 'downloading' || effectiveUpdateState.status === 'ready-to-install') && (
                              <div className="mt-4">
                                <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-slate-700">
                                  <motion.div
                                    className="h-full rounded-full bg-indigo-600"
                                    initial={false}
                                    animate={{ width: `${Math.min(100, Math.max(0, effectiveUpdateState.percent ?? 0))}%` }}
                                    transition={{ duration: 0.3 }}
                                  />
                                </div>
                                <div className="mt-2 flex justify-between gap-3 text-xs text-gray-500 dark:text-slate-400">
                                  <span>{Math.round(effectiveUpdateState.percent ?? 0)}%</span>
                                  <span>{formatUpdateBytes(effectiveUpdateState.transferredBytes)} / {formatUpdateBytes(effectiveUpdateState.totalBytes)}</span>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {effectiveUpdateState.availableVersion && (
                        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Version {effectiveUpdateState.availableVersion}</h4>
                            <span className="text-xs text-gray-500 dark:text-slate-400">{formatUpdateDate(effectiveUpdateState.releaseDate)}</span>
                          </div>
                          {effectiveUpdateState.releaseNotes && (
                            <p className="mt-3 max-h-40 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-gray-600 dark:text-slate-300">
                              {effectiveUpdateState.releaseNotes}
                            </p>
                          )}
                        </div>
                      )}

                      <div className="flex flex-wrap gap-3">
                        {(effectiveUpdateState.status === 'idle' || effectiveUpdateState.status === 'up-to-date' || effectiveUpdateState.status === 'error' || effectiveUpdateState.status === 'disabled') && (
                          <button
                            type="button"
                            onClick={() => void runUpdateAction('check')}
                            disabled={!effectiveUpdateState.installationEnabled || updateActionPending}
                            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-indigo-600/20 transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <RefreshCw className={`h-4 w-4 ${updateActionPending ? 'animate-spin' : ''}`} />
                            {effectiveUpdateState.status === 'error' ? 'Retry' : 'Check for updates'}
                          </button>
                        )}
                        {effectiveUpdateState.status === 'available' && (
                          <button
                            type="button"
                            onClick={() => void runUpdateAction('download')}
                            disabled={!effectiveUpdateState.installationEnabled || updateActionPending}
                            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-indigo-600/20 transition-colors hover:bg-indigo-700 disabled:opacity-50"
                          >
                            <Download className="h-4 w-4" /> Download update
                          </button>
                        )}
                        {effectiveUpdateState.status === 'ready-to-install' && (
                          <button
                            type="button"
                            onClick={() => void runUpdateAction('install')}
                            disabled={!effectiveUpdateState.installationEnabled || updateActionPending}
                            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-indigo-600/20 transition-colors hover:bg-indigo-700 disabled:opacity-50"
                          >
                            <RotateCw className="h-4 w-4" /> Restart and update
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void runUpdateAction('logs')}
                          disabled={!window.desktop || updateActionPending}
                          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/20 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
                        >
                          <FileText className="h-4 w-4" /> Open update logs
                        </button>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-slate-500">
                        <Clock3 className="h-3.5 w-3.5" /> Last checked: {formatUpdateDate(effectiveUpdateState.lastCheckedAt)}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8 py-6">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Update preferences</h3>
                      <p className="text-sm text-gray-500 dark:text-slate-500 mt-1">These preferences save immediately and are separate from other Settings changes.</p>
                    </div>
                    <div className="space-y-4">
                      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/5">
                        <div className="mb-3">
                          <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Update channel</h4>
                          <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-slate-400">Stable requires signed releases. Testing accepts explicitly published unsigned Beta previews.</p>
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <button
                            type="button"
                            onClick={() => void changeUpdateChannel('stable')}
                            className={`rounded-xl border p-4 text-left transition-colors ${updatePreferences.channel === 'stable' ? 'border-indigo-400 bg-indigo-50 ring-1 ring-indigo-200 dark:border-indigo-400/60 dark:bg-indigo-500/10 dark:ring-indigo-500/30' : 'border-gray-200 hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5'}`}
                          >
                            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white"><ShieldCheck className="h-4 w-4 text-indigo-600 dark:text-indigo-400" /> Stable</div>
                            <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-slate-400">Signed production releases only.</p>
                          </button>
                          <button
                            type="button"
                            disabled={!effectiveUpdateState.testingChannelAvailable}
                            onClick={() => setConfirmTestingChannel(true)}
                            className={`rounded-xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${updatePreferences.channel === 'testing' ? 'border-amber-400 bg-amber-50 ring-1 ring-amber-200 dark:border-amber-400/60 dark:bg-amber-500/10 dark:ring-amber-500/30' : 'border-gray-200 hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5'}`}
                          >
                            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white"><ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" /> Testing</div>
                            <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-slate-400">Unsigned Beta releases for trusted testers.</p>
                          </button>
                        </div>
                        {!effectiveUpdateState.testingChannelAvailable && (
                          <p className="mt-3 text-xs text-gray-500 dark:text-slate-500">The Testing channel is available only in a Beta-capable installer.</p>
                        )}
                        <AnimatePresence initial={false}>
                          {confirmTestingChannel && updatePreferences.channel !== 'testing' && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              className="overflow-hidden"
                            >
                              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
                                <p className="text-sm font-semibold text-amber-950 dark:text-amber-100">Enable unsigned Testing updates?</p>
                                <p className="mt-1 text-xs leading-relaxed text-amber-800 dark:text-amber-200">Only continue if you trust preview releases published by this project. Windows may show Unknown publisher warnings.</p>
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <button type="button" onClick={() => void changeUpdateChannel('testing')} className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-amber-700">Enable Testing</button>
                                  <button type="button" onClick={() => setConfirmTestingChannel(false)} className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-500/40 dark:bg-transparent dark:text-amber-100 dark:hover:bg-amber-500/10">Cancel</button>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                      {([
                        ['automaticallyCheck', 'Automatically check for updates', 'Check once per day after the local service is ready.'],
                        ['automaticallyDownload', 'Automatically download updates', 'Download only after you enable this option; restarting still requires approval.'],
                      ] as const).map(([key, title, description]) => (
                        <div key={key} className="flex items-start justify-between gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/5">
                          <div>
                            <h4 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h4>
                            <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-slate-400">{description}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void changeUpdatePreference(key)}
                            disabled={!window.desktop}
                            aria-pressed={updatePreferences[key]}
                            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${updatePreferences[key] ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-slate-700'}`}
                          >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${updatePreferences[key] ? 'translate-x-6' : 'translate-x-1'}`} />
                          </button>
                        </div>
                      ))}
                      {updatePreferenceError && (
                        <p className="text-sm text-red-600 dark:text-red-400">{updatePreferenceError}</p>
                      )}
                      <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4 text-sm leading-relaxed text-indigo-800 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-200">
                        Before installation, My AI Library stops its local service and verifies a protected database backup. If that safety check fails, the update is cancelled and your current data is left unchanged.
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Action Buttons */}
          {activeTab !== 'updates' && <div className="mt-8 pt-6 border-t border-gray-200/60 dark:border-white/10 flex justify-end gap-3 pb-8">
            <button 
              type="button" 
              onClick={handleCancel}
              disabled={!settingsSnapshot || cancelState === 'reverting'}
              className="relative overflow-hidden px-4 py-2 border border-gray-300 dark:border-white/20 rounded-lg text-sm font-medium text-gray-700 dark:text-slate-300 bg-white dark:bg-white/5 hover:bg-gray-50 dark:bg-white/10 shadow-sm transition-all duration-300 disabled:opacity-50 min-w-[100px]"
            >
              <AnimatePresence mode="wait">
                {cancelState === 'idle' ? (
                  <motion.span
                    key="cancel-text"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                    className="inline-flex items-center gap-2"
                  >
                    Cancel
                  </motion.span>
                ) : (
                  <motion.span
                    key="reverted"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                    className="inline-flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    <span className="text-emerald-600 dark:text-emerald-400">Reverted</span>
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
            <button 
              onClick={handleSave}
              disabled={saveState === 'saving' || saveState === 'success'}
              className="relative overflow-hidden px-4 py-2 bg-indigo-600 rounded-lg text-sm font-medium text-white hover:bg-indigo-700 shadow-sm shadow-indigo-600/20 transition-all duration-300 min-w-[140px] disabled:cursor-not-allowed"
            >
              <AnimatePresence mode="wait">
                {saveState === 'idle' && (
                  <motion.span
                    key="save-text"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                    className="inline-flex items-center gap-2"
                  >
                    Save changes
                  </motion.span>
                )}
                {saveState === 'saving' && (
                  <motion.span
                    key="saving"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                    className="inline-flex items-center justify-center gap-2"
                  >
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving
                  </motion.span>
                )}
                {saveState === 'success' && (
                  <motion.span
                    key="saved"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                    className="inline-flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 className="w-4 h-4 text-white" />
                    Saved
                  </motion.span>
                )}
                {saveState === 'error' && (
                  <motion.span
                    key="error"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                    className="inline-flex items-center justify-center"
                  >
                    Try again
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          </div>}
        </div>
      </div>

      {/* Terminate Session Modal */}
      <AnimatePresence>
        {showTerminateModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={() => { setShowTerminateModal(false); setTerminateTarget(null); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-white/10 p-6 w-full max-w-md mx-4"
            >
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                {terminateTarget === 'all' ? 'Terminate all other sessions?' : 'Terminate this session?'}
              </h3>
              <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">
                {terminateTarget === 'all'
                  ? 'This will sign out all other devices. Only your current session will remain active.'
                  : 'This will immediately sign out this device.'}
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => { setShowTerminateModal(false); setTerminateTarget(null); }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleTerminateSession}
                  className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg shadow-sm transition-colors"
                >
                  Terminate
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FeatureToggleCard({
  title,
  description,
  enabled,
  interactive,
}: {
  title: string;
  description: string;
  enabled: boolean;
  interactive: boolean;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h4>
          <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-slate-400">{description}</p>
        </div>
        <button
          type="button"
          disabled={!interactive}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            enabled ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-slate-700'
          } ${interactive ? '' : 'cursor-default opacity-90'}`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>
      <div className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
        {enabled ? 'Available' : 'Unavailable'}
      </div>
    </div>
  );
}
