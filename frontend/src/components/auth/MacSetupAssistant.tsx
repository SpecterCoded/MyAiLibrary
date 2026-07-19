import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HardDrive, FolderOpen, ChevronRight, Check, Sparkles } from 'lucide-react';
import { type BackendUser } from '../DashboardHeader';
import { selectFolder } from '../../utils/desktop';

interface MacSetupAssistantProps {
  user: BackendUser;
  onSetupComplete: (newStorageRoot: string) => void;
  isTempOnboarding?: boolean;
}

interface PathSuggestion {
  name: string;
  path: string;
}

const LANGUAGES = [
  { text: 'Hello', lang: 'English' },
  { text: 'Hola', lang: 'Spanish' },
  { text: 'Bonjour', lang: 'French' },
  { text: 'Ciao', lang: 'Italian' },
  { text: 'Hallo', lang: 'German' },
  { text: 'こんにちは', lang: 'Japanese' },
  { text: '안녕하세요', lang: 'Korean' },
  { text: '你好', lang: 'Chinese' },
  { text: 'Olá', lang: 'Portuguese' },
  { text: 'Greetings', lang: 'English' }
];

export function MacSetupAssistant({ user, onSetupComplete, isTempOnboarding = false }: MacSetupAssistantProps) {
  const [step, setStep] = useState<number>(0);
  const [currentLangIndex, setCurrentLangIndex] = useState(0);
  const [pathName, setPathName] = useState('Primary Storage');
  const [storagePath, setStoragePath] = useState('');
  const [suggestions, setSuggestions] = useState<PathSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  // Rotate through greeting languages on step 0
  useEffect(() => {
    if (step !== 0) return;
    const interval = setInterval(() => {
      setCurrentLangIndex((prev) => (prev + 1) % LANGUAGES.length);
    }, 1800);
    return () => clearInterval(interval);
  }, [step]);

  // Fetch real drive and folder path suggestions from backend
  useEffect(() => {
    const fetchSuggestions = async () => {
      try {
        const response = await fetch('/auth/storage-suggestions');
        if (response.ok) {
          const data = await response.json();
          setSuggestions(data);
          if (data.length > 0 && !storagePath) {
            setStoragePath(data[0].path);
          }
        }
      } catch (err) {
        console.error('Failed to load storage suggestions:', err);
      }
    };
    fetchSuggestions();
  }, [user]);

  const handleBrowseFolder = async () => {
    try {
      setError(null);
      const data = await selectFolder();
      if (data.path) {
          const selectedBase = data.path;
          const currentParts = storagePath.trim().split(/[/\\]/);
          const currentFavoriteName = currentParts[currentParts.length - 1]?.trim() || 'MyLibrary';
          const favoriteName = currentFavoriteName;
          const separator = selectedBase.includes('/') ? '/' : '\\';
          const joinedPath = selectedBase.endsWith(separator) 
            ? selectedBase + favoriteName 
            : selectedBase + separator + favoriteName;
          
          setStoragePath(joinedPath);
        } else if (data.error) {
          setError(`Folder explorer error: ${data.error}`);
      }
    } catch (err: any) {
      setError(`Failed to open folder explorer: ${err.message}`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!storagePath.trim()) {
      setError('Storage path is required.');
      return;
    }

    setLoading(true);
    try {
      const token = localStorage.getItem('access_token');
      if (!token) {
        throw new Error('Authentication session expired. Please log in again.');
      }
      
      // Save selected avatar if any is cached in sessionStorage
      const tempAvatar = sessionStorage.getItem('temp_avatar');
      const userId = localStorage.getItem('user_id');
      if (tempAvatar && userId) {
        localStorage.setItem(`user_avatar_${userId}`, tempAvatar);
        await fetch('/me/profile', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ avatar_url: tempAvatar })
        }).catch(err => console.error('Failed to save avatar to DB on setup:', err));
        
        // Clean up session storage
        sessionStorage.removeItem('temp_avatar');
        sessionStorage.removeItem('temp_signup');
      }
      
      // Create storage path
      const pathParts = storagePath.trim().split(/[/\\]/);
      const nameFromPath = pathParts[pathParts.length - 1].trim() || 'MyLibrary';

      const createRes = await fetch(`/storage-paths?name=${encodeURIComponent(nameFromPath)}&path=${encodeURIComponent(storagePath.trim())}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!createRes.ok) {
        const errData = await createRes.json().catch(() => ({}));
        throw new Error(errData.detail || `Failed to register storage path (Status ${createRes.status}).`);
      }

      const pathData = await createRes.json();
      const pathId = pathData.id;

      // Set active storage path
      const activeRes = await fetch(`/me/active-storage-path?path_id=${pathId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!activeRes.ok) {
        const errData = await activeRes.json().catch(() => ({}));
        throw new Error(errData.detail || `Failed to activate storage path (Status ${activeRes.status}).`);
      }

      const activeData = await activeRes.json();
      
      setShowSuccess(true);
      setTimeout(() => {
        onSetupComplete(activeData.path);
      }, 2200);
    } catch (err: any) {
      setError(err.message || 'An error occurred while configuring workspace storage.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-slate-50 font-sans select-none">
      
      {/* Animated macOS Style Shifting Light Pastels Background */}
      <div className="absolute inset-0 opacity-85 blur-[120px] pointer-events-none scale-110">
        <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-gradient-to-br from-indigo-100 via-purple-100 to-rose-100 animate-[spin_40s_linear_infinite]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[70%] h-[70%] rounded-full bg-gradient-to-tr from-cyan-100 via-blue-100 to-indigo-100 animate-[spin_50s_linear_infinite]" />
        <div className="absolute top-[30%] left-[20%] w-[50%] h-[50%] rounded-full bg-gradient-to-r from-emerald-50 via-teal-50 to-blue-100 animate-[spin_45s_linear_infinite]" />
      </div>

      <AnimatePresence mode="wait">
        {showSuccess ? (
          /* Success Screen */
          <motion.div
            key="success-screen"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-md bg-white/70 border border-white/60 backdrop-blur-2xl rounded-3xl p-10 shadow-2xl shadow-slate-300/40 flex flex-col items-center justify-center z-10 text-slate-800 text-center"
          >
            <motion.div
              initial={{ scale: 0, rotate: -30 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.2 }}
              className="w-20 h-20 rounded-full bg-gradient-to-tr from-emerald-400 to-teal-500 flex items-center justify-center shadow-lg shadow-emerald-500/30 border border-white/40 mb-6"
            >
              <Check className="w-10 h-10 text-white stroke-[3.5]" />
            </motion.div>
            
            <motion.h2 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="text-3xl font-extrabold tracking-tight text-slate-900 mb-2"
            >
              Enjoy!
            </motion.h2>
            
            <motion.p 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              className="text-lg font-bold text-slate-600 tracking-wide"
            >
              You are all set.
            </motion.p>
          </motion.div>
        ) : step === 0 ? (
          /* Multilingual Welcoming Screen */
          <motion.div
            key="greeting"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.05, y: -20 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col items-center justify-center text-center px-6 z-10"
          >
            <div className="h-32 flex items-center justify-center">
              <AnimatePresence mode="wait">
                <motion.h1
                  key={currentLangIndex}
                  initial={{ opacity: 0, y: 12, filter: 'blur(4px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, y: -12, filter: 'blur(4px)' }}
                  transition={{ duration: 0.6 }}
                  className="text-6xl md:text-8xl font-thin text-slate-800 tracking-tight"
                >
                  {LANGUAGES[currentLangIndex].text}
                </motion.h1>
              </AnimatePresence>
            </div>
            
            <motion.p 
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.6 }}
              transition={{ delay: 0.5, duration: 1 }}
              className="text-xs font-semibold text-slate-500 mt-6 tracking-widest uppercase"
            >
              {LANGUAGES[currentLangIndex].lang}
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1, duration: 0.8 }}
              className="mt-16"
            >
              <button
                onClick={() => setStep(1)}
                className="group px-8 py-4 bg-slate-900 hover:bg-slate-800 text-white rounded-full font-bold text-[15px] tracking-wide flex items-center gap-3 shadow-lg shadow-slate-350/50 hover:shadow-xl transition-all active:scale-[0.98] cursor-pointer"
              >
                <span>Set Up My Workspace</span>
                <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </button>
            </motion.div>
          </motion.div>
        ) : (
          /* Storage Path Configuration Screen */
          <motion.div
            key="setup-form"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-2xl bg-white/70 border border-white/60 backdrop-blur-2xl rounded-3xl p-8 md:p-12 shadow-2xl shadow-slate-300/40 flex flex-col z-10 text-slate-800"
          >
            {/* Header info */}
            <div className="flex items-center gap-4 mb-8">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center shadow-lg shadow-indigo-500/20 border border-white/40">
                <HardDrive className="w-7 h-7 text-white" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-slate-800 tracking-tight">Setup Assistant</h2>
                <p className="text-slate-500 text-sm font-semibold">Configure active workspace storage</p>
              </div>
            </div>

            <p className="text-slate-600 text-sm leading-relaxed mb-8 font-medium">
              To index codebases, transcripts, mind maps, and documents, MyAILibrary needs a designated workspace folder on your local drive. Please specify a directory path below.
            </p>

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Path Input */}
              <div className="flex flex-col gap-2">
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Absolute Workspace Directory Path</label>
                <div className="relative w-full">
                  <input
                     type="text"
                     required
                     placeholder="e.g. C:\Users\Public\Documents\MyLibrary"
                     value={storagePath}
                     onChange={(e) => setStoragePath(e.target.value)}
                     className="w-full pl-12 pr-4 py-3 bg-white/60 hover:bg-white/80 focus:bg-white border border-slate-200 focus:border-indigo-500/50 rounded-xl text-slate-800 outline-none font-semibold transition-all shadow-sm focus:ring-2 focus:ring-indigo-500/10"
                  />
                  <button
                    type="button"
                    onClick={handleBrowseFolder}
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:scale-105 active:scale-95 transition-all cursor-pointer focus:outline-none"
                    title="Choose folder from explorer"
                  >
                    <FolderOpen className="w-5 h-5" />
                  </button>
                </div>

                {/* Suggestions Section */}
                <div className="flex flex-col gap-2 mt-2">
                  <div className="flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                    <span className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">Drives & folders found on your device:</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {suggestions.length > 0 ? (
                      suggestions.map((sug, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setStoragePath(sug.path)}
                          className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all cursor-pointer flex items-center gap-1.5 ${
                            storagePath === sug.path
                              ? 'bg-indigo-50 border-indigo-200 text-indigo-600 shadow-sm'
                              : 'bg-white/80 hover:bg-white border-slate-200 text-slate-600 hover:text-slate-800'
                          }`}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                          <span className="font-bold">{sug.name}:</span>
                          <span className="opacity-85 font-medium">{sug.path}</span>
                        </button>
                      ))
                    ) : (
                      <span className="text-xs text-slate-400 italic font-medium">Scanning drive directories...</span>
                    )}
                  </div>
                </div>
              </div>

              {error && (
                <div className="p-4 text-xs font-semibold text-red-600 bg-red-50 border border-red-100 rounded-xl">
                  {error}
                </div>
              )}

              {/* Buttons */}
              <div className="flex items-center justify-between pt-6 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setStep(0)}
                  className="px-5 py-2.5 text-slate-500 hover:text-slate-800 font-bold text-sm transition-colors cursor-pointer"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-6 py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-full font-bold text-sm flex items-center gap-2 shadow-lg shadow-slate-900/10 hover:shadow-xl transition-all active:scale-[0.98] disabled:opacity-50 cursor-pointer"
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Creating Connection...</span>
                    </>
                  ) : (
                    <>
                      <span>Complete Setup</span>
                      <Check className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
