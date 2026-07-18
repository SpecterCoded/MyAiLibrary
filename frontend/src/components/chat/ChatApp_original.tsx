/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { lazy, Suspense, useState, useEffect, useRef, type RefObject, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Plus, PanelLeft, Share, Sparkles, BarChart2,
  ReceiptText, Target, Clock, ArrowUp, Calendar, MoreVertical,
  Copy, Trash2, ChevronDown, ChevronUp, ArrowLeft, MessageSquare, Check, X,
  ThumbsUp, ThumbsDown, Bookmark, Download, FileDown, RefreshCw,
  Mic, MicOff, Square, Paperclip, Loader2, Globe
} from 'lucide-react';
import LogoLoading from '../LogoLoading';
import { logActivity } from '../../utils/activityLogger';
import { VideoPlayer } from '../FileExplorer/VideoPlayer';
import SourceList from '../rag/SourceList';
import InlineCitationContent, { hasInlineCitationMarkers } from '../rag/InlineCitationContent';
import type { RAGResponseDetails, RAGSource } from '../rag/types';

const LazyResponseDetailsPanel = lazy(() => import('../rag/ResponseDetailsPanel'));

// --- TYPES ---
type Source = RAGSource;

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  sources?: Source[];
  details?: Partial<RAGResponseDetails>;
  query?: string;
}

interface ChatSession {
  id: string;
  title: string;
  date: string;
  timeAgo: string;
  messages: Message[];
  preview: string;
}

interface BackendChatSession {
  id: string;
  title: string;
  source?: string | null;
  created_at?: string | null;
}

interface BackendChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[] | null;
  details?: Partial<RAGResponseDetails> | null;
  created_at?: string | null;
}

function formatSessionDate(value?: string | null): string {
  if (!value) return 'Unknown date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function formatSessionTimeAgo(value?: string | null): string {
  if (!value) return 'Saved';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Saved';
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  const diffWeeks = Math.floor(diffDays / 7);
  return `${diffWeeks} week${diffWeeks === 1 ? '' : 's'} ago`;
}

function formatMessageTimestamp(value?: string | null): string {
  if (!value) {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// --- SUGGESTIONS MOCK DATA ---
const SUGGESTIONS = [
  {
    icon: BarChart2,
    title: "How's my campaign?",
    desc: "Get a quick overview of your campaign's performance, including reach, engagement, and ROI.",
    btn: "View Report",
    prompt: "Can you give me a quick overview of my campaign's performance, including reach, engagement, and ROI?"
  },
  {
    icon: ReceiptText,
    title: "Any spend issues?",
    desc: "Identify sudden spikes or dips in ad spend and get suggestions to optimize your budget.",
    btn: "Analyze Budget",
    prompt: "Are there any spend issues, spikes, or dips in my ad budget? Please analyze."
  },
  {
    icon: Target,
    title: "Which ads work best?",
    desc: "See the top-performing ads based on clicks, conversions, and engagement to refine your strategy.",
    btn: "View Insights",
    prompt: "Which ads / ad creatives are performing best this week in terms of clicks, conversions, and engagement?"
  }
];

export interface ChatAppProps {
  user: { username?: string; email?: string; avatar_url?: string | null; user_id?: string } | null;
}

function buildInitialResponseDetails(payload: any, query: string): Partial<RAGResponseDetails> {
  return {
    query,
    confidence: payload.confidence ?? null,
    confidenceLabel: payload.confidence_label ?? null,
    retrievalStrategy: payload.retrieval_strategy ?? null,
    hallucinationCount: Array.isArray(payload.hallucinations) ? payload.hallucinations.length : null,
    hallucinationCheckPassed: Array.isArray(payload.hallucinations) ? payload.hallucinations.length === 0 : null,
    processingTimeMs: payload.processing_time_ms ?? null,
    sourceCount: Array.isArray(payload.sources) ? payload.sources.length : null,
    modulesExecuted: Array.isArray(payload.modules_executed) ? payload.modules_executed : undefined,
    reasoning: typeof payload.reasoning === 'string' ? payload.reasoning : null,
    contextPreview: typeof payload.context === 'string' ? payload.context : null,
  };
}

function ChatDrawerVideoPlayer({ resourceId, timestamp }: { resourceId: string, timestamp?: number }) {
  const [objectUrl, setObjectUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const loadMedia = async () => {
      setLoading(true);
      try {
        const token = localStorage.getItem('access_token');
        const res = await fetch(`/resources/${resourceId}/file`, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
        if (!res.ok) throw new Error("Failed to load file");
        const blob = await res.blob();
        if (active) {
          const url = URL.createObjectURL(blob);
          setObjectUrl(url);
        }
      } catch (err) {
        console.error("Error loading preview media:", err);
      } finally {
        if (active) setLoading(false);
      }
    };
    loadMedia();
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [resourceId]);

  if (loading) {
    return (
      <div className="rounded-xl overflow-hidden shadow-sm border border-gray-200/50 bg-slate-950 aspect-video flex items-center justify-center w-full">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  if (!objectUrl) {
    return (
      <div className="rounded-xl overflow-hidden shadow-sm border border-gray-200/50 bg-slate-950 aspect-video flex items-center justify-center text-white text-xs font-mono w-full">
        Failed to load media
      </div>
    );
  }

  const finalSrc = objectUrl ? `${objectUrl}#t=${timestamp || 0}` : '';

  return (
    <VideoPlayer src={finalSrc} className="w-full aspect-video relative bg-slate-950 rounded-xl overflow-hidden shadow-sm border border-gray-200/50 flex items-center justify-center [&_.vjs-tech]:object-contain" />
  );
}

export default function ChatApp({ user }: ChatAppProps) {
  const displayName = user?.username || user?.email?.split('@')[0] || 'User';
  const userAvatarUrl = user?.avatar_url || localStorage.getItem(`user_avatar_${user?.user_id}`);
  const userInitial = displayName.charAt(0).toUpperCase();

  const [currentView, setCurrentView] = useState<'home' | 'chat' | 'history'>('home');
  const [inputValue, setInputValue] = useState('');
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest'>('newest');
  const [isGlobeOn, setIsGlobeOn] = useState(false);

  const [selectedResources, setSelectedResources] = useState<any[]>([]);
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [activePlayerSource, setActivePlayerSource] = useState<Source | null>(null);

  // --- Dynamic suggestion cards from user's library ---
  const [dynamicSuggestions, setDynamicSuggestions] = useState<any[] | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('pending_chat_context');
      if (!raw) return;
      const pending = JSON.parse(raw);
      if (Array.isArray(pending.resources)) {
        setSelectedResources(
          pending.resources.filter((item: any) => item && typeof item.id === 'string').slice(0, 5),
        );
      }
      if (typeof pending.prompt === 'string' && pending.prompt.trim()) {
        setInputValue(pending.prompt);
      }
      localStorage.removeItem('pending_chat_context');
    } catch {
      localStorage.removeItem('pending_chat_context');
    }
  }, []);

  useEffect(() => {
    const loadDynamicSuggestions = async () => {
      try {
        const token = localStorage.getItem('access_token');
        const res = await fetch('/search/resources?q=a', {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
        if (!res.ok) return;
        const data = await res.json();
        // Only use embedded resources
        const embedded = data.filter((r: any) => r.is_embedded === true || r.is_embedded === 'true');
        if (embedded.length === 0) return; // fall back to static cards
        // Pick up to 3, map to suggestion shape
        const mapped = embedded.slice(0, 3).map((r: any) => {
          const ext = (r.title || '').split('.').pop()?.toUpperCase() || '';
          const isVideo = ['MP4', 'MOV', 'AVI', 'MKV', 'WEBM'].includes(ext);
          return {
            resourceId: r.id,
            icon: isVideo ? 'video' : 'doc',
            title: r.title || 'Untitled',
            desc: r.description || r.summary || (isVideo ? 'Explore this video from your library.' : 'Dive into this document from your library.'),
            btn: isVideo ? 'Explore Video' : 'Read Document',
            prompt: `Please summarize the key points and main ideas from "${r.title}".`
          };
        });
        setDynamicSuggestions(mapped);
      } catch {
        // silently fall back to static cards
      }
    };
    loadDynamicSuggestions();
  }, []);

  // Debounced search query to prevent backend overload and browser crash
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const delayDebounce = setTimeout(async () => {
      setIsSearching(true);
      try {
        const token = localStorage.getItem('access_token');
        const response = await fetch(`/search/resources?q=${encodeURIComponent(searchQuery)}`, {
          headers: {
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          }
        });
        if (response.ok) {
          const data = await response.json();
          // Filter to only embedded resources
          const embedded = data.filter((r: any) => r.is_embedded === "true" || r.is_embedded === true);
          setSearchResults(embedded);
        }
      } catch (err) {
        console.error("Search failed:", err);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(delayDebounce);
  }, [searchQuery]);

  const handleToggleResource = (resource: any) => {
    setSelectedResources((prev) => {
      const exists = prev.find((r) => r.id === resource.id);
      if (exists) {
        return prev.filter((r) => r.id !== resource.id);
      } else {
        if (prev.length >= 5) {
          showToast("You can select a maximum of 5 focus files.");
          return prev;
        }
        return [...prev, resource];
      }
    });
  };

  const buildChatScope = (resources: { id: string }[]) => {
    const selectedIds = resources.map((resource) => resource.id);
    return {
      selected_resource_ids: selectedIds,
      cross_library_search: selectedIds.length === 0,
    };
  };

  // Custom states for notifications
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Advanced SaaS Campaign reactions & persistent notes storage state
  const [reactions, setReactions] = useState<Record<string, 'like' | 'dislike'>>(() => {
    try {
      return JSON.parse(localStorage.getItem('ai_reactions') || '{}');
    } catch {
      return {};
    }
  });

  const [savedNotes, setSavedNotes] = useState<{ id: string; title: string; content: string; timestamp: string }[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('saved_notes') || '[]');
    } catch {
      return [];
    }
  });

  const [isNotesOpen, setIsNotesOpen] = useState(false);
  const [isHeaderExportOpen, setIsHeaderExportOpen] = useState(false);

  // Web Speech & Interactive Voice typing state
  const [isListening, setIsListening] = useState(false);
  const [isVoicePanelOpen, setIsVoicePanelOpen] = useState(false);
  const [isMicAccessGranted, setIsMicAccessGranted] = useState<boolean | null>(null);
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [voiceDraft, setVoiceDraft] = useState('');
  const recognitionRef = useRef<any>(null);
  const voiceDraftRef = useRef('');
  const abortControllerRef = useRef<AbortController | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const microphoneRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);

  // Starts the audio level visualizer using a pre-obtained stream (no double getUserMedia)
  const startAudioVisualizerWithStream = async (stream: MediaStream) => {
    try {
      audioStreamRef.current = stream;
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioCtx;

      // CRITICAL: AudioContext created after an async/await is suspended in Chrome.
      // Must explicitly resume it or getByteFrequencyData returns all zeros.
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;  // Higher fftSize = more frequency detail
      analyser.smoothingTimeConstant = 0.8;
      analyserRef.current = analyser;
      const microphone = audioCtx.createMediaStreamSource(stream);
      microphoneRef.current = microphone;
      microphone.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateLevel = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        // Focus on speech frequency range (300Hz - 3kHz) for better reactivity
        const speechBins = dataArray.slice(2, 30);
        let sum = 0;
        for (let i = 0; i < speechBins.length; i++) sum += speechBins[i];
        setAudioLevel(sum / speechBins.length);
        animationFrameRef.current = requestAnimationFrame(updateLevel);
      };
      updateLevel();
    } catch (err) {
      console.warn('Could not start audio visualizer', err);
    }
  };

  const startVoiceRecording = (stream: MediaStream) => {
    if (!('MediaRecorder' in window)) return;

    try {
      voiceChunksRef.current = [];
      const preferredMime = 'audio/webm;codecs=opus';
      const recorder = new MediaRecorder(
        stream,
        MediaRecorder.isTypeSupported(preferredMime) ? { mimeType: preferredMime } : undefined
      );

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          voiceChunksRef.current.push(event.data);
        }
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
    } catch (err) {
      console.warn('Could not start voice recording fallback', err);
    }
  };

  const stopVoiceRecording = async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      return null;
    }

    return new Promise<Blob | null>((resolve) => {
      recorder.onstop = () => {
        const blob = voiceChunksRef.current.length > 0
          ? new Blob(voiceChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
          : null;
        mediaRecorderRef.current = null;
        voiceChunksRef.current = [];
        resolve(blob);
      };
      recorder.stop();
    });
  };

  const transcribeVoiceBlob = async (blob: Blob) => {
    const formData = new FormData();
    formData.append('file', blob, 'voice.webm');
    const token = localStorage.getItem('access_token');

    const response = await fetch('/voice/transcribe', {
      method: 'POST',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      body: formData,
    });

    if (!response.ok) {
      throw new Error('Voice transcription failed');
    }

    const data = await response.json();
    return (data.transcript || '').trim();
  };

  const stopAudioVisualizer = () => {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    if (microphoneRef.current) microphoneRef.current.disconnect();
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(track => track.stop());
    }
    audioStreamRef.current = null;
    setAudioLevel(0);
  };

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsGenerating(false);
  };

  // Toggle microphone: SpeechRecognition starts first (gets mic priority),
  // then we separately start the AudioContext visualizer stream.
  const toggleListening = async () => {
    // If already listening, stop everything
    if (isListening) {
      if (recognitionRef.current) recognitionRef.current.stop();
      stopAudioVisualizer();
      setIsListening(false);
      return;
    }

    // Check browser support first
    const SpeechObj = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechObj) {
      showToast('Speech recognition is not supported. Please use Chrome or Edge.');
      setIsVoicePanelOpen(true);
      return;
    }

    voiceDraftRef.current = '';
    setVoiceDraft('');

    // Step 1: Create a FRESH SpeechRecognition
    const rec = new SpeechObj();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    recognitionRef.current = rec;

    rec.onresult = (event: any) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      const nextDraft = transcript.trimStart();
      voiceDraftRef.current = nextDraft;
      setVoiceDraft(nextDraft);
    };

    rec.onerror = (e: any) => {
      console.error('Speech recognition error:', e.error);
      setIsListening(false);
      stopAudioVisualizer();
      if (e.error === 'no-speech') {
        showToast('No speech detected. Speak closer to your microphone.');
      } else if (e.error === 'not-allowed') {
        showToast('Mic access was blocked. Please allow microphone in browser settings.');
        setIsVoicePanelOpen(false);
      } else if (e.error === 'aborted') {
        // Stopped manually ΓÇö silent
      } else {
        showToast('Voice input stopped.');
      }
    };

    rec.onend = () => {
      setIsListening(false);
      stopAudioVisualizer();
    };

    // Step 2: Start SpeechRecognition FIRST ΓÇö it claims the mic before our AudioContext
    // This is the critical order: recognition before visualizer getUserMedia
    try {
      rec.start();
    } catch (err: any) {
      console.error('Failed to start recognition:', err);
      if (err.name === 'NotAllowedError') {
        showToast('Microphone access denied. Please allow mic in your browser settings.');
      } else {
        showToast('Could not start voice input. Please try again.');
      }
      return;
    }

    // Step 3: Open panel & mark listening state
    setIsListening(true);
    setIsVoicePanelOpen(true);

    // Step 4: After a brief grace period (let SpeechRecognition settle), start visualizer
    // Using a separate getUserMedia ΓÇö mic permission is already granted so no dialog
    setTimeout(async () => {
      try {
        const vizStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        startVoiceRecording(vizStream);
        await startAudioVisualizerWithStream(vizStream);
      } catch {
        // Visualizer is cosmetic ΓÇö if it fails, recognition still works fine
      }
    }, 150);
  };

  const confirmVoiceInput = async () => {
    const recordedVoice = await stopVoiceRecording();

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      await new Promise(resolve => setTimeout(resolve, 250));
    }

    let transcript = voiceDraftRef.current.trim();
    if (!transcript && recordedVoice) {
      try {
        transcript = await transcribeVoiceBlob(recordedVoice);
      } catch {
        showToast('Voice transcription failed. Please try again.');
      }
    }

    if (transcript) {
      setInputValue(transcript);
    } else {
      showToast('No speech detected yet. Please try speaking again.');
    }
    setIsVoicePanelOpen(false);
    setVoiceDraft('');
    voiceDraftRef.current = '';

    setTimeout(() => {
      const el = document.querySelector<HTMLInputElement>('input[placeholder="Write a message here..."]');
      el?.focus();
    }, 150);
  };

  const cancelVoiceInput = () => {
    if (isListening && recognitionRef.current) recognitionRef.current.stop();
    setIsVoicePanelOpen(false);
    setVoiceDraft('');
    voiceDraftRef.current = '';
  };

  // Reaction toggling helper
  const handleToggleReaction = async (msgId: string, type: 'like' | 'dislike') => {
    const nextReactions = { ...reactions };
    if (nextReactions[msgId] === type) {
      delete nextReactions[msgId];
      showToast('Reaction removed');
    } else {
      nextReactions[msgId] = type;
      showToast(`Marked answer as ${type === 'like' ? 'helpful ≡ƒæì' : 'needs improvement ≡ƒæÄ'}`);

      // Save feedback to backend (fire-and-forget, never blocks UI)
      try {
        const currentSession = chats.find(s => s.id === activeSessionId) || activeSession;
        if (currentSession) {
          const msgs = currentSession.messages;
          const msgIndex = msgs.findIndex(m => m.id === msgId);
          const userMsg = msgs.slice(0, msgIndex).reverse().find(m => m.role === 'user');
          const aiMsg = msgs[msgIndex];
          if (userMsg && aiMsg) {
            const resourceId = (currentSession as any).resource_id || null;
            if (resourceId) {
              const token = localStorage.getItem('access_token');
              fetch(`/resources/${resourceId}/feedback`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
                body: JSON.stringify({
                  question: userMsg.content,
                  answer: aiMsg.content,
                  rating: type === 'like' ? 1 : -1,
                }),
              }).catch(() => {});
            }
          }
        }
      } catch {}
    }
    setReactions(nextReactions);
    localStorage.setItem('ai_reactions', JSON.stringify(nextReactions));
  };

  // Saved Notes Actions
  const handleSaveToNotes = () => {
    const currentSession = chats.find(s => s.id === activeSessionId) || activeSession;
    if (!currentSession) {
      showToast('No active conversation to save. Start a chat first!');
      return;
    }

    const aiMessages = currentSession.messages.filter(m => m.role === 'assistant');
    if (aiMessages.length === 0) {
      showToast('No AI recommendations to save yet!');
      return;
    }

    const latestAi = aiMessages[aiMessages.length - 1];
    const isDuplicate = savedNotes.some(n => n.content === latestAi.content);
    if (isDuplicate) {
      showToast('This recommendation is already saved in your notes!');
      setIsNotesOpen(true);
      return;
    }

    const noteId = 'note-' + Date.now();
    const newNote = {
      id: noteId,
      title: currentSession.title,
      content: latestAi.content,
      timestamp: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    };

    const updated = [newNote, ...savedNotes];
    setSavedNotes(updated);
    localStorage.setItem('saved_notes', JSON.stringify(updated));
    showToast('Saved recommendation to Notes Desk! ≡ƒô¥');
    setIsNotesOpen(true);
  };

  const handleDeleteNote = (noteId: string) => {
    const updated = savedNotes.filter(n => n.id !== noteId);
    setSavedNotes(updated);
    localStorage.setItem('saved_notes', JSON.stringify(updated));
    showToast('Note deleted');
  };

  const handleCopyText = (content: string) => {
    navigator.clipboard.writeText(content);
    showToast('Text copied to clipboard! ≡ƒôï');
  };

  // Beautiful File Downloads Utilities
  const exportToMarkdown = (title: string, content: string) => {
    const element = document.createElement("a");
    const file = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    element.href = URL.createObjectURL(file);
    element.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-report.md`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    showToast('Markdown downloaded! ≡ƒô¥');
  };

  const exportToPdf = (title: string, htmlContent: string) => {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document || iframe.contentDocument;
    if (doc) {
      doc.open();
      doc.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>${title}</title>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                color: #0f172a;
                padding: 40px;
                line-height: 1.6;
                max-width: 800px;
                margin: 0 auto;
              }
              h1 {
                font-size: 26px;
                font-weight: 700;
                margin-bottom: 4px;
                color: #0f172a;
                border-bottom: 2px solid #f1f5f9;
                padding-bottom: 12px;
              }
              .meta {
                font-size: 11px;
                text-transform: uppercase;
                letter-spacing: 0.05em;
                color: #64748b;
                margin-bottom: 30px;
                font-weight: 600;
              }
              .message {
                margin-bottom: 25px;
                padding: 24px;
                background-color: #f8fafc;
                border-radius: 16px;
                border: 1px solid #e2e8f0;
              }
              .role-user {
                background-color: #f1f5f9;
              }
              .role-label {
                font-weight: 700;
                font-size: 11px;
                color: #475569;
                text-transform: uppercase;
                margin-bottom: 10px;
              }
              .content {
                font-size: 14.5px;
              }
              .footer {
                margin-top: 50px;
                padding-top: 15px;
                border-top: 1px solid #e2e8f0;
                font-size: 10px;
                color: #94a3b8;
                text-align: center;
              }
              p { margin: 0 0 12px 0; }
              p:last-child { margin: 0; }
              li { margin-bottom: 6px; }
              strong { font-weight: 600; color: #000; }
            </style>
          </head>
          <body>
            <h1>${title}</h1>
            <div class="meta">AI Optimization Grounded Document ΓÇó Generated on ${new Date().toLocaleDateString()}</div>
            <div class="content">
              ${htmlContent}
            </div>
            <div class="footer">
              Ad Campaign Builder & Budget Optimizer ΓÇó Elite SaaS Tool Desk
            </div>
            <script>
              window.onload = function() {
                window.print();
                setTimeout(function() {
                  window.frameElement.remove();
                }, 1500);
              };
            </script>
          </body>
        </html>
      `);
      doc.close();
      showToast('Preparing PDF/Print sheet! ≡ƒôä');
    }
  };

  const handleExportWholeChatMarkdown = () => {
    if (!activeSession) return;
    const md = `# ${activeSession.title}\nDate: ${activeSession.date}\n\n` +
      activeSession.messages.map(m => `**[${m.role === 'user' ? 'User' : 'Campaign Optimizer'}]** (${m.timestamp}):\n${m.content}\n`).join('\n---\n\n');
    exportToMarkdown(activeSession.title, md);
    setIsHeaderExportOpen(false);
  };

  const handleExportWholeChatPdf = () => {
    if (!activeSession) return;
    const html = activeSession.messages.map(m => `
      <div class="message ${m.role === 'user' ? 'role-user' : ''}">
        <div class="role-label">${m.role === 'user' ? 'User Segment' : 'Campaign Advisory AI'}</div>
        <div class="content">${m.content.split('\n').map(l => {
      if (l.trim().startsWith('* ') || l.trim().startsWith('- ')) {
        return `<li>${l.replace(/^[\s*-]+/, '')}</li>`;
      }
      return `<p>${l}</p>`;
    }).join('')}</div>
      </div>
    `).join('');
    exportToPdf(activeSession.title, html);
    setIsHeaderExportOpen(false);
  };

  const saveChatsToStorage = (updatedChats: ChatSession[]) => {
    setChats(updatedChats);
  };

  const loadChatsFromBackend = async () => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      setChats([]);
      return;
    }

    try {
      const sessionsRes = await fetch('/chat/sessions', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!sessionsRes.ok) throw new Error('Failed to load chat sessions.');

      const sessions: BackendChatSession[] = await sessionsRes.json();
      const chatSessions = sessions.filter((s) => s.source !== 'media_player');
      const hydratedChats = await Promise.all(
        chatSessions.map(async (session) => {
          const messagesRes = await fetch(`/chat/sessions/${session.id}/messages`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const backendMessages: BackendChatMessage[] = messagesRes.ok ? await messagesRes.json() : [];
          const messages: Message[] = backendMessages.map((message) => ({
            id: message.id,
            role: message.role,
            content: message.content,
            sources: message.sources || undefined,
            details: message.details || undefined,
            timestamp: formatMessageTimestamp(message.created_at),
          }));
          const preview = [...messages].reverse().find((message) => message.role === 'assistant')?.content
            || messages[messages.length - 1]?.content
            || '';

          return {
            id: session.id,
            title: session.title,
            date: formatSessionDate(session.created_at),
            timeAgo: formatSessionTimeAgo(session.created_at),
            messages,
            preview: preview.length > 120 ? `${preview.substring(0, 120)}...` : preview,
          };
        }),
      );

      setChats(hydratedChats);
    } catch (error) {
      console.error('Failed to load chat history from backend:', error);
      setChats([]);
    }
  };

  const createChatSession = async (title: string): Promise<BackendChatSession> => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      throw new Error('You must be signed in to create a chat session.');
    }

    const response = await fetch('/chat/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ title }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = typeof data?.detail === 'string' ? data.detail : 'Failed to create chat session.';
      throw new Error(detail);
    }

    logActivity('ai_chat', 'Created chat session');
    return data as BackendChatSession;
  };

  useEffect(() => {
    void loadChatsFromBackend();
  }, []);

  // Scroll to bottom of chat
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (currentView === 'chat') {
      scrollToBottom();
    }
  }, [chats, currentView, isGenerating]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const playNotificationSound = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(600, audioCtx.currentTime); // 600 Hz
      oscillator.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.1);

      gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 0.05);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      oscillator.start(audioCtx.currentTime);
      oscillator.stop(audioCtx.currentTime + 0.5);
    } catch (e) {
      console.log('Audio notification failed', e);
    }
  };

  const activeSession = chats.find(c => c.id === activeSessionId) || null;

  // Start new clean chat
  const startNewChat = () => {
    setInputValue('');
    setActiveSessionId(null);
    setCurrentView('home');
    setSelectedResources([]);
    setIsSearchModalOpen(false);
    setSearchQuery('');
    setSearchResults([]);
  };

  // Submit a user message
  const handleSendMessage = async (text: string, overrideResources?: { id: string; title: string }[]) => {
    const trimmed = text.trim();
    if (!trimmed || isGenerating) return;

    setInputValue('');
    let sessionId = activeSessionId;
    let updatedChats = [...chats];
    const token = localStorage.getItem('access_token');
    if (!token) {
      showToast('Please sign in before starting a chat.');
      return;
    }

    const newUserMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: trimmed,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    try {
      if (!sessionId) {
        const backendSession = await createChatSession(trimmed.length > 25 ? trimmed.substring(0, 25) + '...' : trimmed);
        sessionId = backendSession.id;
        const newSession: ChatSession = {
          id: sessionId,
          title: trimmed.length > 25 ? trimmed.substring(0, 25) + '...' : trimmed,
          date: formatSessionDate(backendSession.created_at),
          timeAgo: 'Just now',
          messages: [newUserMessage],
          preview: trimmed
        };
        updatedChats = [newSession, ...updatedChats];
        setActiveSessionId(sessionId);
      } else {
        updatedChats = updatedChats.map(c => {
          if (c.id === sessionId) {
            const newMsgList = [...c.messages, newUserMessage];
            return {
              ...c,
              messages: newMsgList,
              preview: trimmed,
              timeAgo: 'Just now'
            };
          }
          return c;
        });
      }

      saveChatsToStorage(updatedChats);
      setCurrentView('chat');
      setIsGenerating(true);

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      // Gather relevant structured history to feed the backend
      const sessionObj = updatedChats.find(s => s.id === sessionId);
      const messageHistory = sessionObj ? sessionObj.messages : [newUserMessage];
      const scopeResources = (overrideResources !== undefined ? overrideResources : selectedResources).map((resource) => ({ id: resource.id }));
      const chatScope = buildChatScope(scopeResources);

      logActivity('ai_chat', 'Sent chat message', trimmed.substring(0, 80));
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          session_id: sessionId,
          messages: messageHistory,
          ...chatScope,
          globe_on: isGlobeOn,
        }),
        signal: abortController.signal
      });

      const data = await response.json();

      if (!response.ok) {
        const errMsg = typeof data.detail === 'string'
          ? data.detail
          : (data.detail ? JSON.stringify(data.detail) : (data.error || 'Server returned an error'));
        throw new Error(errMsg);
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.content || "Hmm, I couldn't get a response. Please check your network and try again.",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        sources: data.sources || [],
        details: buildInitialResponseDetails(data, trimmed),
        query: trimmed
      };

      // Append model response to session
      const finalizedChats = updatedChats.map(c => {
        if (c.id === sessionId) {
          const finalMsgs = [...c.messages, assistantMessage];
          return {
            ...c,
            messages: finalMsgs,
            preview: assistantMessage.content.length > 120
              ? assistantMessage.content.substring(0, 120) + '...'
              : assistantMessage.content
          };
        }
        return c;
      });

      saveChatsToStorage(finalizedChats);
    } catch (e: any) {
      if (e.name === 'AbortError') {
        console.log('Generation stopped by user');
        return;
      }
      console.error(e);
      // Append error message to chat
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Error: ${e.message}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      const finalizedChats = updatedChats.map(c => {
        if (c.id === sessionId) {
          return {
            ...c,
            messages: [...c.messages, errorMessage],
            preview: errorMessage.content
          };
        }
        return c;
      });
      saveChatsToStorage(finalizedChats);
    } finally {
      setIsGenerating(false);
      playNotificationSound();
    }
  };

  // Re-generate specific AI message segment and replace it with updated AI response
  const handleRegenerate = async (msgId: string) => {
    if (isGenerating || !activeSessionId) return;

    let updatedChats = [...chats];
    const sessionObj = updatedChats.find(s => s.id === activeSessionId);
    if (!sessionObj) return;

    // Locate indices
    const targetIdx = sessionObj.messages.findIndex(m => m.id === msgId);
    if (targetIdx === -1) return;

    // Get preceding messages up to target assistant message item
    const messageHistory = sessionObj.messages.slice(0, targetIdx);
    if (messageHistory.length === 0) return;

    // Temporarily truncate chat messages to that specific user question setup
    updatedChats = updatedChats.map(c => {
      if (c.id === activeSessionId) {
        return {
          ...c,
          messages: messageHistory,
          timeAgo: 'Just now'
        };
      }
      return c;
    });

    saveChatsToStorage(updatedChats);
    setIsGenerating(true);

    try {
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      showToast('Regenerating campaign recommendation...');
      const chatScope = buildChatScope(selectedResources.map((resource) => ({ id: resource.id })));
      const token = localStorage.getItem('access_token');
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          session_id: activeSessionId,
          messages: messageHistory,
          ...chatScope,
          globe_on: isGlobeOn,
        }),
        signal: abortController.signal
      });

      const data = await response.json();

      if (!response.ok) {
        const errMsg = typeof data.detail === 'string'
          ? data.detail
          : (data.detail ? JSON.stringify(data.detail) : (data.error || 'Server returned an error'));
        throw new Error(errMsg);
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.content || "Hmm, I couldn't get a refreshed response. Please try again.",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        sources: data.sources || [],
        details: buildInitialResponseDetails(
          data,
          [...messageHistory].reverse().find((item) => item.role === 'user')?.content || ''
        ),
        query: [...messageHistory].reverse().find((item) => item.role === 'user')?.content || ''
      };

      const finalizedChats = updatedChats.map(c => {
        if (c.id === activeSessionId) {
          const finalMsgs = [...c.messages, assistantMessage];
          return {
            ...c,
            messages: finalMsgs,
            preview: assistantMessage.content.length > 120
              ? assistantMessage.content.substring(0, 120) + '...'
              : assistantMessage.content
          };
        }
        return c;
      });

      saveChatsToStorage(finalizedChats);
      showToast('Recommendation updated successfully! ΓÜí');
    } catch (e: any) {
      if (e.name === 'AbortError') {
        console.log('Generation stopped by user');
        return;
      }
      console.error(e);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Error: ${e.message}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      const finalizedChats = updatedChats.map(c => {
        if (c.id === activeSessionId) {
          return {
            ...c,
            messages: [...c.messages, errorMessage],
            preview: errorMessage.content
          };
        }
        return c;
      });
      saveChatsToStorage(finalizedChats);
    } finally {
      setIsGenerating(false);
      playNotificationSound();
    }
  };

  // Duplicate session
  const handleDuplicateSession = (id: string) => {
    const session = chats.find(c => c.id === id);
    if (!session) return;

    const duplicated: ChatSession = {
      ...session,
      id: 'session-dup-' + Date.now(),
      title: `${session.title} (Copy)`,
      messages: session.messages.map(m => ({ ...m, id: m.id + '-copy' }))
    };

    saveChatsToStorage([duplicated, ...chats]);
    showToast('Conversation duplicated successfully');
  };

  // Delete session
  const handleDeleteSession = async (id: string) => {
    const token = localStorage.getItem('access_token');
    if (token) {
      try {
        await fetch(`/chat/sessions/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        logActivity('ai_chat', 'Deleted chat session');
      } catch (error) {
        console.error('Failed to delete backend chat session:', error);
      }
    }

    const updated = chats.filter(c => c.id !== id);
    saveChatsToStorage(updated);

    if (activeSessionId === id) {
      setActiveSessionId(null);
      setCurrentView('home');
    }

    showToast('Conversation deleted');
  };

  // Contextual Smart Prompt Reply Suggestions
  const getSmartSuggestions = (): string[] => {
    if (!activeSession) return [];

    const messages = activeSession.messages;
    if (messages.length === 0) return [];

    const lastMsgObj = messages[messages.length - 1];
    if (lastMsgObj.role === 'user') return [];

    const contentLower = (lastMsgObj.content + ' ' + activeSession.title).toLowerCase();

    if (contentLower.includes('tiktok') || contentLower.includes('ugc') || contentLower.includes('video')) {
      return [
        "Suggest TikTok budget allocation",
        "What are main benchmarks for CPM?",
        "Draft raw hook ideas for UGC clips"
      ];
    }

    if (contentLower.includes('meta') || contentLower.includes('facebook') || contentLower.includes('instagram') || contentLower.includes('cpa')) {
      return [
        "How can we reduce Meta CPA?",
        "Explain Reels video versus Carousel ROI",
        "Draft Meta lookalike audience structure"
      ];
    }

    if (contentLower.includes('google') || contentLower.includes('seo') || contentLower.includes('search') || contentLower.includes('bid')) {
      return [
        "Setup broad match smart bidding template",
        "How to audit search search queries?",
        "What is target ad spend ROI (ROAS)?"
      ];
    }

    if (contentLower.includes('budget') || contentLower.includes('split') || contentLower.includes('spend') || contentLower.includes('cost')) {
      return [
        "Propose a $10k multi-channel scenario",
        "Explain direct ROI modeling strategies",
        "Draft campaign budget scaling roadmap"
      ];
    }

    return [
      "Can you write a creative brief for this?",
      "Propose key metrics to measure first",
      "Draft a budget projection spreadsheet structure"
    ];
  };

  // Sort and filter chats for History List
  const filteredChats = chats
    .filter(c => c.title.toLowerCase().includes(searchTerm.toLowerCase()) || c.preview.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'newest') return b.id.localeCompare(a.id);
      return a.id.localeCompare(b.id);
    });

  return (
    <div className="w-full h-full flex justify-center items-center font-sans selection:bg-gray-200 relative overflow-hidden">

      {/* Toast Alert */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-8 bg-black text-white px-5 py-3 rounded-full shadow-lg z-50 text-sm font-medium flex items-center gap-2"
          >
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main App Container */}
      <div className="w-full h-full bg-white/40 flex flex-col relative overflow-hidden">

        {/* Header Navigation */}
        <header className="flex justify-between items-center px-6 sm:px-10 py-6 z-20 shrink-0">
          <div className="flex items-center gap-3 sm:gap-4">
            <button
              onClick={startNewChat}
              className="flex items-center justify-center w-11 h-11 rounded-full border border-gray-200 hover:bg-gray-50 transition-all duration-300 hover:shadow-sm"
              title="New Chat"
            >
              <Plus size={18} strokeWidth={2.5} className="text-gray-600" />
            </button>

            {/* Export Dropdown Header Trigger */}
            <div className="relative">
              <button
                onClick={() => {
                  if (!activeSession) {
                    showToast('No active conversation to export! Start chatting first.');
                    return;
                  }
                  setIsHeaderExportOpen(!isHeaderExportOpen);
                }}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-full border border-gray-200 hover:bg-gray-50 transition-all duration-300 hover:shadow-sm ${isHeaderExportOpen ? 'bg-gray-50 border-gray-300' : 'bg-white'}`}
                title="Export Whole Chat"
              >
                <Download size={16} strokeWidth={2.5} className="text-gray-600 animate-pulse" />
                <span className="text-sm font-medium text-gray-800">Export</span>
                <ChevronDown size={14} className={`text-gray-500 transition-transform duration-200 ${isHeaderExportOpen ? 'rotate-180' : ''}`} />
              </button>

              {/* Big Export Dropdown */}
              <AnimatePresence>
                {isHeaderExportOpen && activeSession && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsHeaderExportOpen(false)} />
                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      transition={{ duration: 0.15 }}
                      className="absolute left-0 mt-2 w-64 bg-white border border-gray-200/80 shadow-[0_10px_40px_rgb(0,0,0,0.08)] rounded-2xl p-2.5 z-50 flex flex-col gap-1.5"
                    >
                      <div className="px-3 py-1 text-[11px] font-bold text-gray-400 uppercase tracking-widest border-b border-gray-50 pb-2 mb-1.5">
                        Export Whole Chat
                      </div>
                      <button
                        onClick={handleExportWholeChatMarkdown}
                        className="flex items-center gap-3 w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-semibold text-slate-700 hover:bg-gray-50 hover:text-black transition-colors"
                      >
                        <FileDown size={15} className="text-gray-500" />
                        <div className="flex flex-col">
                          <span>Export to Markdown</span>
                          <span className="text-[9px] text-gray-400 font-normal">Saves as .md campaign file</span>
                        </div>
                      </button>
                      <button
                        onClick={handleExportWholeChatPdf}
                        className="flex items-center gap-3 w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-semibold text-slate-700 hover:bg-gray-50 hover:text-black transition-colors"
                      >
                        <FileDown size={15} className="text-gray-500" />
                        <div className="flex flex-col">
                          <span>Export to PDF</span>
                          <span className="text-[9px] text-gray-400 font-normal">Prints/saves as styled PDF sheet</span>
                        </div>
                      </button>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="flex items-center gap-3 sm:gap-4">
            <button
              onClick={() => setIsNotesOpen(!isNotesOpen)}
              className={`flex items-center justify-center w-11 h-11 rounded-full border border-gray-200 transition-all duration-300 hover:shadow-sm hover:bg-gray-50 relative ${isNotesOpen ? 'bg-slate-100 border-slate-300' : 'bg-white'}`}
              title="View Campaign Notes Vault"
            >
              <Bookmark size={18} strokeWidth={2} className={`${isNotesOpen ? 'text-black' : 'text-gray-600'}`} />
              {savedNotes.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4.5 h-4.5 rounded-full bg-slate-900 border border-white text-[9px] font-bold text-white flex items-center justify-center">
                  {savedNotes.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setCurrentView(currentView === 'history' ? (activeSessionId ? 'chat' : 'home') : 'history')}
              className={`flex items-center justify-center w-11 h-11 rounded-lg border border-gray-200 transition-all duration-300 hover:shadow-sm ${currentView === 'history' ? 'bg-gray-100 shadow-inner border-gray-300' : 'hover:bg-gray-50 bg-white'}`}
              title="Toggle History View"
            >
              <PanelLeft size={18} strokeWidth={2} className="text-gray-600" />
            </button>
            <button
              onClick={handleSaveToNotes}
              className="flex items-center gap-2 px-5 py-2.5 rounded-full border border-gray-200 hover:bg-gray-50 transition-all duration-300 hover:shadow-sm bg-white"
              title="Save Current Recommendation to Notes"
            >
              <Bookmark size={18} strokeWidth={2} className="text-gray-600" />
              <span className="text-sm font-medium text-gray-800">Save to Note</span>
            </button>
          </div>
        </header>

        {/* Dynamic Ambient Blur Orbits */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
          {/* Top-Right Soft Rose Blobs */}
          <motion.div
            animate={{
              x: [0, 40, -20, 0],
              y: [0, -30, 30, 0],
              scale: [1, 1.15, 0.9, 1]
            }}
            transition={{
              duration: 20,
              repeat: Infinity,
              ease: "easeInOut"
            }}
            className="absolute -top-[15%] -right-[10%] w-[420px] h-[420px] rounded-full bg-rose-100/40 blur-[100px]"
          />

          {/* Bottom-Left Soft Sky Blobs */}
          <motion.div
            animate={{
              x: [0, -30, 40, 0],
              y: [0, 40, -30, 0],
              scale: [1, 0.9, 1.1, 1]
            }}
            transition={{
              duration: 24,
              repeat: Infinity,
              ease: "easeInOut"
            }}
            className="absolute -bottom-[10%] -left-[15%] w-[500px] h-[500px] rounded-full bg-sky-100/30 blur-[120px]"
          />

          {/* Central Soft Gold / Orchid Accents */}
          <motion.div
            animate={{
              x: [0, 20, -15, 0],
              y: [0, 15, -20, 0],
              scale: [0.9, 1.05, 0.95, 0.9]
            }}
            transition={{
              duration: 16,
              repeat: Infinity,
              ease: "easeInOut"
            }}
            className="absolute top-[35%] left-[15%] w-[330px] h-[330px] rounded-full bg-amber-50/40 blur-[90px]"
          />
        </div>

        {/* Scrollable Content Area */}
        <main id="main-scroll-view" className="flex-grow overflow-y-auto no-scrollbar w-full flex flex-col pb-36 relative scroll-smooth bg-transparent z-10">

          <AnimatePresence mode="wait">
            {currentView === 'home' && (
              <HomeView
                key="home"
                displayName={displayName}
                onSelectSuggestion={(promptText, resourceId) => {
                  // If the card has a specific resource, auto-focus it
                  let overrideResources: { id: string; title: string }[] | undefined = undefined;
                  if (resourceId) {
                    const found = dynamicSuggestions?.find((s: any) => s.resourceId === resourceId);
                    if (found) {
                      const resourcesList = [{ id: found.resourceId, title: found.title }];
                      setSelectedResources(resourcesList);
                      overrideResources = resourcesList;
                    }
                  }
                  handleSendMessage(promptText, overrideResources);
                }}
                suggestions={dynamicSuggestions}
              />
            )}

            {currentView === 'chat' && (
              <ChatView
                key="chat"
                session={activeSession}
                isGenerating={isGenerating}
                onBack={() => setCurrentView('home')}
                messagesEndRef={messagesEndRef}
                onToggleReaction={handleToggleReaction}
                reactions={reactions}
                onRegenerate={handleRegenerate}
                onCopyText={handleCopyText}
                onExportMsgMarkdown={(msg, sessionTitle) => {
                  const md = `# ${sessionTitle} - Recommendation Report\nDate: ${new Date().toLocaleDateString()}\n\n${msg.content}`;
                  exportToMarkdown(sessionTitle || "Recommendation", md);
                }}
                onExportMsgPdf={(msg, sessionTitle) => {
                  const html = `
                    <div class="message">
                      <div class="role-label">Campaign Advisory AI</div>
                      <div class="content">${msg.content.split('\n').map(l => {
                    if (l.trim().startsWith('* ') || l.trim().startsWith('- ')) {
                      return `<li>${l.replace(/^[\s*-]+/, '')}</li>`;
                    }
                    return `<p>${l}</p>`;
                  }).join('')}</div>
                    </div>
                  `;
                  exportToPdf(sessionTitle || "Grounded Recommendation", html);
                }}
                onOpenPlayer={(src) => setActivePlayerSource(src)}
                userAvatarUrl={userAvatarUrl}
                userInitial={userInitial}
                displayName={displayName}
              />
            )}

            {currentView === 'history' && (
              <HistoryView
                key="history"
                filteredChats={filteredChats}
                chatsCount={chats.length}
                searchTerm={searchTerm}
                setSearchTerm={setSearchTerm}
                sortBy={sortBy}
                setSortBy={setSortBy}
                onSelectSession={(id) => {
                  setActiveSessionId(id);
                  setCurrentView('chat');
                }}
                onDuplicate={handleDuplicateSession}
                onDelete={handleDeleteSession}
                onShare={() => {
                  navigator.clipboard.writeText(window.location.href);
                  showToast('Conversation share link copied!');
                }}
                activeSessionId={activeSessionId}
              />
            )}
          </AnimatePresence>
        </main>

        {/* Floating Minimap Scroll Timeline Bar for Chat View */}
        {currentView === 'chat' && activeSession && (
          <ChatScrollTimeline
            messages={activeSession.messages}
            onScrollToMsg={(msgId) => {
              const element = document.getElementById(`chat-msg-${msgId}`);
              const parent = document.getElementById("main-scroll-view");
              if (element && parent) {
                const parentRect = parent.getBoundingClientRect();
                const elementRect = element.getBoundingClientRect();
                const relativeTop = elementRect.top - parentRect.top + parent.scrollTop;
                const targetScroll = relativeTop - (parentRect.height / 2) + (elementRect.height / 2);
                parent.scrollTo({
                  top: targetScroll,
                  behavior: 'smooth'
                });
              }
            }}
          />
        )}

        {/* Floating Chat Input */}
        <div className="absolute bottom-8 left-0 right-0 flex flex-col items-center px-6 z-30 pointer-events-none gap-3">

          {/* Selected Resource Pills */}
          {selectedResources.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-2 max-w-2xl w-full pointer-events-auto select-none px-4 mb-1">
              <AnimatePresence>
                {selectedResources.map((resource) => (
                  <motion.div
                    key={resource.id}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="px-3 py-1.5 rounded-full bg-slate-905 bg-slate-900 text-[11px] font-semibold text-slate-100 border border-slate-800 shadow-[0_2px_8px_rgba(0,0,0,0.15)] flex items-center gap-2"
                  >
                    <span className="truncate max-w-[150px]">{resource.title}</span>
                    <button
                      type="button"
                      onClick={() => handleToggleResource(resource)}
                      className="text-slate-400 hover:text-white hover:bg-slate-800 rounded-full p-0.5 transition-colors cursor-pointer"
                      title="Remove focus from this file"
                    >
                      <X size={11} />
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}

          <div className="w-full max-w-3xl pointer-events-auto relative">
            <AnimatePresence mode="wait">
              {isVoicePanelOpen ? (
                <motion.div
                  key="voice-input"
                  initial={{ opacity: 0, scale: 0.95, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 10 }}
                  transition={{ duration: 0.2 }}
                  className="bg-white rounded-full border border-gray-200/80 shadow-[0_8px_30px_rgb(0,0,0,0.12)] p-2.5 flex items-center gap-3 w-full backdrop-blur-xl"
                >
                  {/* Left ΓÇö Close voice panel (keep text) */}
                  <button
                    onClick={() => {
                      if (isListening && recognitionRef.current) recognitionRef.current.stop();
                      setIsVoicePanelOpen(false);
                    }}
                    className="w-10 h-10 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-800 hover:bg-gray-100 transition-colors shrink-0"
                    title="Collapse voice panel"
                  >
                    <Plus size={20} className="rotate-45" />
                  </button>

                  {/* Center ΓÇö Live visualizer + live transcript */}
                  <div className="flex-1 flex flex-col items-center justify-center min-w-0 overflow-hidden gap-1.5">
                    {/* Animated bars ΓÇö always shown while mic open */}
                    <div className="flex items-center justify-center gap-[5px] h-7 w-full">
                      {Array.from({ length: 32 }).map((_, i) => {
                        const dist = Math.abs(i - 15);
                        const multiplier = Math.max(0.06, 1 - dist * 0.065);
                        const height = isListening
                          ? Math.max(3, Math.min(28, (audioLevel / 30) * 28 * multiplier))
                          : 3;
                        return (
                          <motion.div
                            key={i}
                            animate={{ height }}
                            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                            className={`rounded-full transition-colors duration-300 ${isListening ? 'bg-indigo-500' : 'bg-gray-200'
                              }`}
                            style={{ width: '3px' }}
                          />
                        );
                      })}
                    </div>

                    {/* Live transcript text ΓÇö shows as speech is detected */}
                    {voiceDraft ? (
                      <span className="text-gray-700 text-[12px] font-medium truncate w-full text-center leading-snug px-2">
                        {voiceDraft}
                      </span>
                    ) : (
                      <span className="text-gray-400 text-[11px] text-center">
                        {isListening ? 'ListeningΓÇª' : 'Tap mic to start'}
                      </span>
                    )}
                  </div>

                  {/* Live level badge */}
                  {isListening && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="font-mono text-[10px] bg-slate-900 text-white px-2 py-1 rounded-full flex items-center gap-1.5 font-bold shrink-0 border border-slate-800"
                    >
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                      </span>
                      <span className="text-emerald-400 w-[26px] text-right">
                        {Math.round(Math.min(100, (audioLevel / 120) * 100))}%
                      </span>
                    </motion.div>
                  )}

                  {/* Right ΓÇö Cancel (X) clears text | Confirm (Γ£ô) puts text in input box */}
                  <div className="flex items-center shrink-0 gap-1">
                    <button
                      title="Cancel ΓÇö discard voice text"
                      onClick={cancelVoiceInput}
                      className="w-10 h-10 rounded-full flex items-center justify-center text-gray-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                    >
                      <X size={18} />
                    </button>
                    <button
                      title="Confirm ΓÇö move voice text to message input"
                      onClick={confirmVoiceInput}
                      className="w-10 h-10 rounded-full flex items-center justify-center bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shadow-sm"
                    >
                      <Check size={16} strokeWidth={2.5} />
                    </button>
                  </div>
                </motion.div>
              ) : (
                <motion.form
                  key="text-input"
                  initial={{ opacity: 0, scale: 0.95, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 10 }}
                  transition={{ duration: 0.2 }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSendMessage(inputValue);
                  }}
                  className="bg-white rounded-full border border-gray-200/80 shadow-[0_4px_24px_rgb(0,0,0,0.06)] p-2.5 flex items-center gap-3 transition-shadow duration-300 hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] backdrop-blur-xl bg-white/95"
                >
                  <button
                    type="button"
                    onClick={() => setIsGlobeOn(!isGlobeOn)}
                    className={`flex items-center justify-center w-10 h-10 rounded-full transition-colors shrink-0 ${isGlobeOn
                      ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-[0_0_12px_rgba(79,70,229,0.4)]'
                      : 'bg-gray-50 hover:bg-gray-100 text-gray-500'
                      }`}
                    title={isGlobeOn ? "Globe ON: Deep research & knowledge first" : "Globe OFF: Library context focused"}
                  >
                    <Globe size={18} strokeWidth={isGlobeOn ? 2.5 : 2} />
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsSearchModalOpen(true)}
                    className={`flex items-center justify-center w-10 h-10 rounded-full transition-colors shrink-0 ${isSearchModalOpen
                      ? 'bg-slate-900 text-white hover:bg-slate-800'
                      : 'bg-gray-50 hover:bg-gray-100 text-gray-500'
                      }`}
                    title="Select focus files for AI RAG"
                  >
                    <Paperclip size={18} strokeWidth={2} />
                  </button>

                  <input
                    type="text"
                    placeholder="Write a message here..."
                    className="flex-grow bg-transparent outline-none text-gray-700 px-3 py-2 text-base placeholder:text-gray-400 min-w-0 flex-1"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                  />

                  {/* Web Speech Dictation mic activator */}
                  <button
                    type="button"
                    onClick={toggleListening}
                    className={`flex items-center justify-center w-10 h-10 rounded-full transition-all duration-300 shrink-0 select-none relative ${isListening
                      ? 'bg-rose-500 text-white shadow-[0_0_12px_rgba(239,68,68,0.5)]'
                      : 'bg-gray-50 hover:bg-gray-100 text-gray-500'
                      }`}
                    title={isListening ? "Listening... Click to stop" : "Use voice typing"}
                  >
                    {isListening ? (
                      <>
                        <span className="absolute inset-0 w-full h-full rounded-full bg-rose-500/30 animate-ping" />
                        <MicOff size={18} strokeWidth={2.5} className="animate-pulse" />
                      </>
                    ) : (
                      <Mic size={18} strokeWidth={2} />
                    )}
                  </button>

                  {isGenerating ? (
                    <button
                      type="button"
                      onClick={handleStopGeneration}
                      className="flex items-center justify-center w-11 h-11 rounded-full bg-black text-white shadow-md scale-100 cursor-pointer hover:bg-gray-800 transition-all duration-300 shrink-0"
                      title="Stop generation"
                    >
                      <Square size={16} fill="currentColor" strokeWidth={0} />
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={inputValue.trim().length === 0}
                      className={`flex items-center justify-center w-11 h-11 rounded-full transition-all duration-300 shrink-0 ${inputValue.trim().length > 0
                        ? 'bg-black text-white shadow-md scale-100 cursor-pointer hover:bg-gray-800'
                        : 'bg-gray-50 text-gray-400 scale-95 cursor-not-allowed'
                        }`}
                    >
                      <ArrowUp size={20} strokeWidth={2.5} />
                    </button>
                  )}
                </motion.form>
              )}
            </AnimatePresence>
          </div>

        </div>

        {/* Saved Notes Panel Drawer Overlay */}
        <AnimatePresence>
          {isNotesOpen && (
            <>
              <div
                className="absolute inset-0 z-30 transition-opacity"
                onClick={() => setIsNotesOpen(false)}
              />
              <motion.div
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', damping: 26, stiffness: 220 }}
                className="absolute right-0 top-0 bottom-0 w-full sm:w-[420px] bg-white border-l border-gray-200 text-slate-800 z-40 shadow-2xl p-6 sm:p-8 flex flex-col"
              >
                <div className="flex items-center justify-between border-b border-gray-100 pb-5 mb-5 shrink-0">
                  <div className="flex items-center gap-2.5">
                    <Bookmark className="text-indigo-500" size={20} />
                    <h2 className="text-base font-bold tracking-tight">Saved Notes</h2>
                  </div>
                  <button
                    onClick={() => setIsNotesOpen(false)}
                    className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors cursor-pointer"
                    title="Close Drawer"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="flex-grow overflow-y-auto space-y-3 no-scrollbar pr-1 pb-12">
                  {savedNotes.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-24 text-gray-400">
                      <Bookmark size={36} className="mb-4 opacity-25" />
                      <p className="text-sm font-semibold">No saved notes yet</p>
                      <p className="text-xs text-center px-6 mt-1.5 text-gray-400 leading-relaxed">
                        Click "Save to Note" to save AI responses here.
                      </p>
                    </div>
                  ) : (
                    savedNotes.map(note => (
                      <div key={note.id} className="bg-gray-50 border border-gray-200/80 hover:border-gray-300 rounded-xl p-4 transition-all duration-200">
                        <div className="flex justify-between items-start gap-2 mb-2">
                          <h3 className="font-semibold text-sm text-slate-800 truncate max-w-[70%]">{note.title}</h3>
                          <span className="text-[10px] text-gray-400 shrink-0">{note.timestamp}</span>
                        </div>
                        <p className="text-xs text-gray-500 leading-relaxed line-clamp-3 select-all mb-3 bg-white p-2.5 rounded-lg border border-gray-100">{note.content}</p>
                        <div className="flex gap-2 justify-end border-t border-gray-100 pt-2.5">
                          <button
                            onClick={() => handleCopyText(note.content)}
                            className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-gray-400 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-full transition-all cursor-pointer"
                          >
                            <Copy size={11} />
                            <span>Copy</span>
                          </button>
                          <button
                            onClick={() => handleDeleteNote(note.id)}
                            className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-rose-500 hover:text-rose-600 bg-rose-50 hover:bg-rose-100 px-3 py-1.5 rounded-full transition-all cursor-pointer"
                          >
                            <Trash2 size={11} />
                            <span>Delete</span>
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Player Slide-over Drawer */}
        <AnimatePresence>
          {activePlayerSource && (
            <motion.div
              initial={{ x: "100%", opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: "100%", opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 h-full w-[400px] z-[100] bg-white border-l border-gray-200 shadow-[-10px_0_40px_rgba(0,0,0,0.1)] flex flex-col overflow-hidden"
            >
              <div className="flex items-center justify-between p-4 border-b border-gray-200/50">
                <h3 className="font-semibold text-gray-800 text-sm truncate pr-4">
                  {activePlayerSource.resource_title}
                </h3>
                <button
                  onClick={() => setActivePlayerSource(null)}
                  className="p-1.5 rounded-full hover:bg-gray-100/80 text-gray-500 hover:text-gray-900 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="p-4 flex-grow flex flex-col gap-4 overflow-y-auto">
                {activePlayerSource.resource_title?.toLowerCase().endsWith('.mp4') && activePlayerSource.resource_id ? (
                  <ChatDrawerVideoPlayer resourceId={activePlayerSource.resource_id} timestamp={activePlayerSource.timestamp} />
                ) : (
                  <div className="rounded-xl p-6 shadow-sm border border-gray-200/50 bg-gray-50/50 flex flex-col items-center justify-center text-center">
                    <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm mb-3">
                      <span className="font-bold text-gray-400">DOC</span>
                    </div>
                    <span className="text-sm font-medium text-gray-700">Document Source</span>
                  </div>
                )}

                <div className="bg-white rounded-xl p-4 border border-gray-200/50 shadow-sm">
                  <div className="flex items-center gap-2 mb-2 text-xs font-bold text-gray-400 uppercase tracking-wider">
                    <Bookmark size={12} className="text-indigo-400" />
                    Citation Excerpt
                  </div>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    {activePlayerSource.excerpt}
                  </p>
                  {activePlayerSource.timestamp_label && (
                    <div className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 bg-indigo-50 text-indigo-700 text-xs font-medium rounded-lg border border-indigo-100">
                      <Clock size={12} />
                      Starts at {activePlayerSource.timestamp_label}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* RAG Focus Search Modal ΓÇö Premium Redesign */}
        <AnimatePresence>
          {isSearchModalOpen && (
            <>
              {/* Backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                onClick={() => setIsSearchModalOpen(false)}
                className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6"
                style={{ background: 'rgba(10,10,20,0.45)', backdropFilter: 'blur(18px)' }}
              >
                {/* Modal Card */}
                <motion.div
                  initial={{ opacity: 0, scale: 0.93, y: 28 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.93, y: 28 }}
                  transition={{ type: 'spring', damping: 28, stiffness: 260 }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full max-w-[480px] flex flex-col overflow-hidden pointer-events-auto"
                  style={{
                    background: 'rgba(255,255,255,0.97)',
                    borderRadius: '28px',
                    border: '1px solid rgba(220,220,228,0.7)',
                    boxShadow: '0 32px 80px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.06)',
                    maxHeight: '82vh',
                  }}
                >

                  {/* ΓöÇΓöÇ HEADER ΓöÇΓöÇ */}
                  <div className="flex items-start justify-between px-6 pt-6 pb-5 shrink-0" style={{ borderBottom: '1px solid #EBEBED' }}>
                    <div className="flex items-start gap-3">
                      {/* Icon bubble */}
                      <div className="w-9 h-9 rounded-xl bg-slate-900 flex items-center justify-center shrink-0 shadow-sm mt-0.5">
                        <Paperclip size={16} className="text-white" strokeWidth={2} />
                      </div>
                      <div>
                        <h2 className="text-[15px] font-bold text-gray-900 leading-tight tracking-tight">
                          Focus AI on Files
                        </h2>
                        <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">
                          Search and select up to&nbsp;<strong className="text-gray-600">5 resources</strong>&nbsp;to ground the AI context.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsSearchModalOpen(false)}
                      className="w-7 h-7 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 transition-colors shrink-0 mt-0.5"
                      style={{ background: '#F2F2F4' }}
                      title="Close"
                    >
                      <X size={13} strokeWidth={2.5} />
                    </button>
                  </div>

                  {/* ΓöÇΓöÇ SELECTED PILLS STRIP ΓöÇΓöÇ */}
                  <AnimatePresence>
                    {selectedResources.length > 0 && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden shrink-0"
                      >
                        <div className="px-6 py-3 flex flex-col gap-2" style={{ background: '#F7F7F9', borderBottom: '1px solid #EBEBED' }}>
                          <span className="text-[9px] font-extrabold uppercase tracking-[0.12em] text-gray-400">
                            Selected&nbsp;&nbsp;{selectedResources.length}&nbsp;/&nbsp;5
                          </span>
                          <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto no-scrollbar">
                            {selectedResources.map((resource) => (
                              <motion.div
                                key={resource.id}
                                initial={{ scale: 0.85, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.85, opacity: 0 }}
                                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold text-white"
                                style={{ background: '#0F172A' }}
                              >
                                <span className="truncate max-w-[140px]">{resource.title}</span>
                                <button
                                  type="button"
                                  onClick={() => handleToggleResource(resource)}
                                  className="rounded-full p-0.5 transition-colors hover:bg-white/20 text-white/60 hover:text-white"
                                >
                                  <X size={9} strokeWidth={3} />
                                </button>
                              </motion.div>
                            ))}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* ΓöÇΓöÇ SEARCH INPUT ΓöÇΓöÇ */}
                  <div className="px-5 py-4 shrink-0 flex items-center gap-2.5" style={{ borderBottom: '1px solid #EBEBED' }}>
                    <div className="relative flex-grow">
                      <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                      <input
                        type="text"
                        autoFocus
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search by title, tags or contentΓÇª"
                        className="w-full rounded-xl pl-9 pr-9 py-2.5 text-[13px] text-gray-800 outline-none transition-all"
                        style={{
                          background: '#F2F2F5',
                          border: '1.5px solid transparent',
                        }}
                        onFocus={(e) => { e.currentTarget.style.border = '1.5px solid #C7C7D0'; e.currentTarget.style.background = '#fff'; }}
                        onBlur={(e) => { e.currentTarget.style.border = '1.5px solid transparent'; e.currentTarget.style.background = '#F2F2F5'; }}
                      />
                      {isSearching ? (
                        <Loader2 size={14} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 animate-spin pointer-events-none" />
                      ) : searchQuery ? (
                        <button
                          type="button"
                          onClick={() => setSearchQuery('')}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                        >
                          <X size={13} strokeWidth={2.5} />
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {/* ΓöÇΓöÇ RESULTS ΓöÇΓöÇ */}
                  <div className="flex-grow overflow-y-auto px-4 py-3 space-y-1.5 no-scrollbar">
                    {!searchQuery.trim() ? (
                      /* Empty state ΓÇö prompt to search */
                      <div className="flex flex-col items-center justify-center py-14 text-center gap-2">
                        <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-1" style={{ background: '#F2F2F5' }}>
                          <Search size={20} className="text-gray-400" />
                        </div>
                        <p className="text-[13px] font-semibold text-gray-600">Search your library</p>
                        <p className="text-[11px] text-gray-400 max-w-[240px] leading-relaxed">
                          Only embedded resources (indexed in ChromaDB) will appear here.
                        </p>
                      </div>
                    ) : searchResults.length === 0 && !isSearching ? (
                      /* No results */
                      <div className="flex flex-col items-center justify-center py-14 text-center gap-2">
                        <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-1" style={{ background: '#F2F2F5' }}>
                          <Search size={20} className="text-gray-300" />
                        </div>
                        <p className="text-[13px] font-semibold text-gray-600">No results found</p>
                        <p className="text-[11px] text-gray-400 max-w-[240px] leading-relaxed">
                          Check the spelling or make sure the resource is embedded in your Library.
                        </p>
                      </div>
                    ) : (
                      searchResults.map((resource) => {
                        const isSelected = selectedResources.some((r) => r.id === resource.id);
                        const ext = resource.title?.split('.').pop()?.toUpperCase() || 'FILE';
                        const isVideo = ['MP4', 'MOV', 'AVI', 'MKV', 'WEBM'].includes(ext);
                        return (
                          <motion.button
                            key={resource.id}
                            type="button"
                            onClick={() => handleToggleResource(resource)}
                            whileHover={{ scale: 1.008 }}
                            whileTap={{ scale: 0.995 }}
                            transition={{ duration: 0.12 }}
                            className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left transition-all duration-150"
                            style={isSelected ? {
                              background: '#0F172A',
                              border: '1.5px solid #0F172A',
                              boxShadow: '0 4px 14px rgba(15,23,42,0.25)',
                            } : {
                              background: '#FFFFFF',
                              border: '1.5px solid #EBEBED',
                            }}
                          >
                            {/* Checkbox */}
                            <div
                              className="shrink-0 w-4 h-4 rounded flex items-center justify-center transition-all"
                              style={isSelected ? { background: '#fff', border: '2px solid #fff' } : { border: '2px solid #D1D5DB', background: 'transparent' }}
                            >
                              {isSelected && <Check size={9} strokeWidth={3.5} className="text-slate-900" />}
                            </div>

                            {/* Text */}
                            <div className="flex-1 min-w-0">
                              <p className={`text-[13px] font-semibold truncate leading-tight ${isSelected ? 'text-white' : 'text-gray-800'}`}>
                                {resource.title}
                              </p>
                              {resource.description && (
                                <p className={`text-[10px] truncate mt-0.5 ${isSelected ? 'text-slate-400' : 'text-gray-400'}`}>
                                  {resource.description}
                                </p>
                              )}
                            </div>

                            {/* Type badge */}
                            <span
                              className="shrink-0 text-[9px] font-extrabold uppercase tracking-widest px-2 py-0.5 rounded-full"
                              style={isSelected
                                ? { background: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.8)' }
                                : { background: isVideo ? '#FEF3C7' : '#EEF2FF', color: isVideo ? '#92400E' : '#4338CA' }
                              }
                            >
                              {isVideo ? 'Video' : ext === 'PDF' ? 'PDF' : ext.length > 5 ? 'File' : ext}
                            </span>
                          </motion.button>
                        );
                      })
                    )}
                  </div>

                  {/* ΓöÇΓöÇ FOOTER ΓöÇΓöÇ */}
                  <div
                    className="flex items-center justify-between px-6 py-4 shrink-0"
                    style={{ borderTop: '1px solid #EBEBED', background: '#F7F7F9' }}
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex gap-1">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <div
                            key={i}
                            className="w-1.5 h-1.5 rounded-full transition-all duration-200"
                            style={{ background: i < selectedResources.length ? '#0F172A' : '#D1D5DB' }}
                          />
                        ))}
                      </div>
                      <span className="text-[11px] font-medium text-gray-500">
                        {selectedResources.length} of 5 selected
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsSearchModalOpen(false)}
                      className="flex items-center gap-2 text-[12px] font-semibold text-white transition-all duration-150 hover:scale-[1.03] active:scale-[0.98]"
                      style={{
                        background: '#0F172A',
                        borderRadius: '12px',
                        padding: '8px 20px',
                        boxShadow: '0 4px 12px rgba(15,23,42,0.30)',
                      }}
                    >
                      <Check size={13} strokeWidth={2.5} />
                      Apply Focus
                    </button>
                  </div>

                </motion.div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}

// --- SUB-COMPONENTS ---

/* --- HOME VIEW (WELCOME) --- */
function HomeView({ displayName, onSelectSuggestion, suggestions }: {
  displayName: string;
  onSelectSuggestion: (prompt: string, resourceId?: string) => void;
  suggestions?: any[] | null;
  key?: string
}) {
  // suggestions === null means still loading, === [] or undefined means use static
  const isLoading = suggestions === null;
  const cards = suggestions && suggestions.length > 0 ? suggestions : SUGGESTIONS;

  // Greeting based on local time
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="flex flex-col items-center justify-center w-full px-6 pt-[8vh]"
    >
      {/* Sparkle Header */}
      <div className="flex items-center justify-center w-12 h-12 rounded-full border border-gray-200 shadow-sm mb-6 bg-white animate-pulse">
        <Sparkles size={20} strokeWidth={2} className="text-gray-800" />
      </div>

      <h1 className="text-3xl sm:text-4xl font-semibold text-gray-900 tracking-tight">{greeting}, {displayName}</h1>
      <p className="text-gray-500 mt-3 text-base sm:text-lg text-center">
        {suggestions && suggestions.length > 0
          ? 'Here are resources from your library ΓÇö click to explore.'
          : 'Hey there! What can I help you explore today?'}
      </p>

      {/* Suggestion Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-12 w-full max-w-[900px]">
        {isLoading ? (
          // Skeleton loading cards while fetching library
          Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="bg-slate-50 border border-gray-100 rounded-3xl p-6 sm:p-7 flex flex-col animate-pulse"
            >
              <div className="w-6 h-6 rounded-md bg-gray-200 mb-4" />
              <div className="h-4 bg-gray-200 rounded-full w-3/4 mb-2" />
              <div className="h-3 bg-gray-100 rounded-full w-full mb-1.5" />
              <div className="h-3 bg-gray-100 rounded-full w-5/6 mb-8" />
              <div className="h-9 bg-gray-100 rounded-full w-full" />
            </div>
          ))
        ) : (
          cards.map((sug: any, i: number) => {
            const isDynamic = suggestions && suggestions.length > 0;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 + (i * 0.1) }}
                onClick={() => onSelectSuggestion(sug.prompt, sug.resourceId)}
                className="bg-slate-50 border border-gray-100 rounded-3xl p-6 sm:p-7 flex flex-col group hover:-translate-y-1.5 hover:shadow-[0_12px_30px_rgb(0,0,0,0.06)] hover:bg-white transition-all duration-300 cursor-pointer relative overflow-hidden"
              >
                {/* Dynamic badge */}
                {isDynamic && (
                  <span className="absolute top-4 right-4 text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full"
                    style={{
                      background: sug.icon === 'video' ? '#FEF3C7' : '#EEF2FF',
                      color: sug.icon === 'video' ? '#92400E' : '#4338CA'
                    }}
                  >
                    {sug.icon === 'video' ? 'Video' : 'PDF'}
                  </span>
                )}

                {/* Icon */}
                {isDynamic ? (
                  <div className="w-9 h-9 rounded-xl mb-4 flex items-center justify-center"
                    style={{ background: sug.icon === 'video' ? '#FEF3C7' : '#EEF2FF' }}
                  >
                    {sug.icon === 'video'
                      ? <BarChart2 size={18} strokeWidth={2} style={{ color: '#92400E' }} />
                      : <ReceiptText size={18} strokeWidth={2} style={{ color: '#4338CA' }} />
                    }
                  </div>
                ) : (
                  <sug.icon size={22} strokeWidth={2} className="text-gray-800 mb-4" />
                )}

                <h3 className="font-semibold text-gray-900 text-[17px] mb-2 pr-12 leading-snug truncate" title={sug.title}>
                  {sug.title}
                </h3>
                <p className="text-sm text-gray-500 leading-relaxed mb-8 flex-grow line-clamp-3">{sug.desc}</p>

                <button className="w-full rounded-full border border-gray-200 bg-white py-2.5 text-sm font-medium text-gray-700 group-hover:bg-gray-50 group-hover:border-gray-300 transition-colors duration-300 pointer-events-none">
                  {sug.btn}
                </button>
              </motion.div>
            );
          })
        )}
      </div>
    </motion.div>
  );
}

/* --- TYPEWRITER STREAMING MESSAGE COMPONENT --- */
function TypewriterMessage({
  content,
  msgId,
  isLatest,
  formatTextContent
}: {
  content: string;
  msgId: string;
  isLatest: boolean;
  formatTextContent: (text: string) => ReactNode
}) {
  const [displayedText, setDisplayedText] = useState(() => {
    if (!isLatest) return content;
    const completed = sessionStorage.getItem(`streamed-${msgId}`);
    return completed ? content : '';
  });

  useEffect(() => {
    if (!isLatest) {
      setDisplayedText(content);
      return;
    }

    const completed = sessionStorage.getItem(`streamed-${msgId}`);
    if (completed) {
      setDisplayedText(content);
      return;
    }

    const words = content.split(' ');
    let currentIdx = 0;
    setDisplayedText('');

    const interval = setInterval(() => {
      if (currentIdx < words.length) {
        setDisplayedText((prev) => (prev ? prev + ' ' : '') + words[currentIdx]);
        currentIdx++;
      } else {
        clearInterval(interval);
        try {
          sessionStorage.setItem(`streamed-${msgId}`, 'true');
        } catch (e) {
          console.error(e);
        }
      }
    }, 28); // Snappy, elite streaming speed

    return () => {
      clearInterval(interval);
    };
  }, [content, msgId, isLatest]);

  return (
    <div className="prose prose-slate max-w-none transition-all duration-300">
      {formatTextContent(displayedText)}
    </div>
  );
}

/* --- CHAT VIEW (ACTIVE CONVERSATION) --- */
function ChatView({
  session,
  isGenerating,
  onBack,
  messagesEndRef,
  onToggleReaction,
  reactions,
  onRegenerate,
  onCopyText,
  onExportMsgMarkdown,
  onExportMsgPdf,
  onOpenPlayer,
  userAvatarUrl,
  userInitial,
  displayName: chatDisplayName
}: {
  session: ChatSession | null;
  isGenerating: boolean;
  onBack: () => void;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  onToggleReaction: (msgId: string, type: 'like' | 'dislike') => void;
  reactions: Record<string, 'like' | 'dislike'>;
  onRegenerate: (msgId: string) => void;
  onCopyText: (content: string) => void;
  onExportMsgMarkdown: (msg: Message, sessionTitle: string) => void;
  onExportMsgPdf: (msg: Message, sessionTitle: string) => void;
  onOpenPlayer: (source: Source) => void;
  userAvatarUrl?: string | null;
  userInitial?: string;
  displayName?: string;
  key?: string;
}) {
  const [openDropdownMsgId, setOpenDropdownMsgId] = useState<string | null>(null);

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-gray-500 h-full">
        <MessageSquare size={36} className="mb-4 text-gray-300" />
        <p>No active chat session. Type a message below to start chatting!</p>
      </div>
    );
  }

  const formatTextContent = (text: string, sources?: Source[]) => (
    <InlineCitationContent text={text} sources={sources} onOpenSource={onOpenPlayer} />
  );

  const getQueryForMessage = (index: number, msg: Message): string | undefined => {
    if (msg.query) return msg.query;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const candidate = session.messages[cursor];
      if (candidate.role === 'user') return candidate.content;
    }
    return undefined;
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="w-full max-w-4xl mx-auto px-6 sm:px-8 pt-4 flex flex-col h-full"
    >
      {/* Active Header */}
      <div className="flex items-center gap-3 border-b border-gray-100 pb-5 mb-6">
        <button
          onClick={onBack}
          className="p-2 -ml-2 rounded-full hover:bg-gray-50 transition-colors text-gray-500 hover:text-gray-900"
          title="Back to ideas"
        >
          <ArrowLeft size={18} strokeWidth={2.5} />
        </button>
        <div>
          <h2 className="font-semibold text-gray-800 text-lg leading-tight">{session.title}</h2>
          <span className="text-xs text-gray-400 font-medium">Active Campaign Assistant</span>
        </div>
      </div>

      {/* Messages Scrollbox */}
      <div className="flex flex-col gap-8 flex-grow pb-12">
        {session.messages.map((msg, msgIndex) => (
          <motion.div
            key={msg.id}
            id={`chat-msg-${msg.id}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className={`flex gap-3 w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {/* ΓöÇΓöÇ AI Message ΓöÇΓöÇ */}
            {msg.role === 'assistant' && (
              <div className="flex gap-3 max-w-[88%] items-start group/msg">
                {/* AI icon */}
                <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-white border border-gray-200 shadow-sm mt-0.5">
                  <Sparkles size={14} className="text-gray-700" />
                </div>
                {/* AI body ΓÇö no box, just text */}
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] text-gray-800 leading-relaxed">
                    <TypewriterMessage
                      content={msg.content}
                      msgId={msg.id}
                      isLatest={session.messages[session.messages.length - 1].id === msg.id}
                      formatTextContent={(text) => formatTextContent(text, msg.sources)}
                    />
                  </div>

                  {/* Sources */}
                  {msg.sources && msg.sources.length > 0 && !hasInlineCitationMarkers(msg.content) && (
                    <details className="group/src mt-3">
                      <summary className="flex items-center gap-1 text-xs font-semibold text-gray-400 hover:text-gray-600 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden w-fit">
                        <ChevronDown size={13} className="transition-transform group-open/src:rotate-180 text-gray-400" />
                        <span>Sources ({msg.sources.length})</span>
                      </summary>
                      <div className="mt-2">
                        <SourceList sources={msg.sources} onOpenSource={onOpenPlayer} />
                      </div>
                    </details>
                  )}

                  {/* Response details */}
                  <Suspense fallback={null}>
                    <LazyResponseDetailsPanel
                      query={getQueryForMessage(msgIndex, msg)}
                      initialDetails={msg.details}
                    />
                  </Suspense>

                  {/* Action bar ΓÇö visible on hover */}
                  <div className="flex items-center gap-0.5 mt-2 opacity-0 group-hover/msg:opacity-100 transition-opacity duration-200">
                    <button
                      onClick={() => onToggleReaction(msg.id, 'like')}
                      className={`p-1.5 rounded-lg hover:bg-gray-100 hover:text-gray-700 transition-colors cursor-pointer text-gray-400 ${reactions[msg.id] === 'like' ? 'text-emerald-500 bg-emerald-50/50' : ''}`}
                      title="Helpful"
                    >
                      <ThumbsUp size={13} className={reactions[msg.id] === 'like' ? 'fill-emerald-500' : ''} />
                    </button>
                    <button
                      onClick={() => onToggleReaction(msg.id, 'dislike')}
                      className={`p-1.5 rounded-lg hover:bg-gray-100 hover:text-gray-700 transition-colors cursor-pointer text-gray-400 ${reactions[msg.id] === 'dislike' ? 'text-rose-500 bg-rose-50/50' : ''}`}
                      title="Not helpful"
                    >
                      <ThumbsDown size={13} className={reactions[msg.id] === 'dislike' ? 'fill-rose-500' : ''} />
                    </button>
                    <button
                      onClick={() => onRegenerate(msg.id)}
                      className="p-1.5 rounded-lg hover:bg-gray-100 hover:text-gray-700 transition-colors cursor-pointer text-gray-400"
                      title="Regenerate"
                    >
                      <RefreshCw size={13} />
                    </button>
                    <button
                      onClick={() => onCopyText(msg.content)}
                      className="p-1.5 rounded-lg hover:bg-gray-100 hover:text-gray-700 transition-colors cursor-pointer text-gray-400"
                      title="Copy"
                    >
                      <Copy size={13} />
                    </button>
                    {/* 3-dot dropdown */}
                    <div className="relative inline-block">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenDropdownMsgId(openDropdownMsgId === msg.id ? null : msg.id);
                        }}
                        className={`p-1.5 rounded-lg hover:bg-gray-100 hover:text-gray-700 transition-colors cursor-pointer text-gray-400 ${openDropdownMsgId === msg.id ? 'bg-gray-100 text-gray-700' : ''}`}
                        title="More options"
                      >
                        <MoreVertical size={13} />
                      </button>
                      <AnimatePresence>
                        {openDropdownMsgId === msg.id && (
                          <>
                            <div className="fixed inset-0 z-40 bg-transparent" onClick={() => setOpenDropdownMsgId(null)} />
                            <motion.div
                              initial={{ opacity: 0, scale: 0.95, y: -5 }}
                              animate={{ opacity: 1, scale: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.95, y: -5 }}
                              transition={{ duration: 0.12 }}
                              className="absolute left-0 mt-1 w-44 bg-white border border-gray-150/70 shadow-lg rounded-xl p-1 z-50 flex flex-col"
                            >
                              <button
                                onClick={() => { onExportMsgMarkdown(msg, session.title); setOpenDropdownMsgId(null); }}
                                className="flex items-center gap-2 text-left w-full px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-gray-700 hover:bg-gray-50 hover:text-black transition-colors"
                              >
                                <FileDown size={13} className="text-gray-400" />
                                <span>Export to Markdown</span>
                              </button>
                              <button
                                onClick={() => { onExportMsgPdf(msg, session.title); setOpenDropdownMsgId(null); }}
                                className="flex items-center gap-2 text-left w-full px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-gray-700 hover:bg-gray-50 hover:text-black transition-colors"
                              >
                                <FileDown size={13} className="text-gray-400" />
                                <span>Export as PDF</span>
                              </button>
                            </motion.div>
                          </>
                        )}
                      </AnimatePresence>
                    </div>
                    <span className="ml-2 text-[10px] text-gray-400 font-medium">{msg.timestamp}</span>
                  </div>
                </div>
              </div>
            )}

            {/* ΓöÇΓöÇ User Message ΓöÇΓöÇ */}
            {msg.role === 'user' && (
              <div className="flex flex-col items-end max-w-[75%]">
                <div className="bg-gray-100 text-gray-900 rounded-3xl rounded-br-md px-5 py-3.5 text-[15px] leading-relaxed font-normal">
                  {msg.content}
                </div>
                <span className="text-[10px] text-gray-400 mt-1.5 font-medium pr-1">{msg.timestamp}</span>
              </div>
            )}
          </motion.div>
        ))}

        {/* Live generation loading indicator */}
        {isGenerating && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex gap-4 self-start max-w-[80%]"
          >
            <LogoLoading size="sm" />

            <div className="bg-white border border-gray-100 rounded-3xl rounded-tl-none p-5 shadow-sm">
              <div className="flex gap-1.5 py-1.5 px-3">
                <span className="w-2.5 h-2.5 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                <span className="w-2.5 h-2.5 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                <span className="w-2.5 h-2.5 bg-gray-400 rounded-full animate-bounce"></span>
              </div>
            </div>
          </motion.div>
        )}

        <div className="h-32 shrink-0 pointer-events-none" />
        <div ref={messagesEndRef} />
      </div>
    </motion.div>
  );
}

/* --- HISTORY VIEW (CHATS ARCHIVE) --- */
interface HistoryViewProps {
  filteredChats: ChatSession[];
  chatsCount: number;
  searchTerm: string;
  setSearchTerm: (val: string) => void;
  sortBy: 'newest' | 'oldest';
  setSortBy: (val: 'newest' | 'oldest') => void;
  onSelectSession: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onShare: () => void;
  activeSessionId: string | null;
  key?: string;
}

function HistoryView({
  filteredChats,
  chatsCount,
  searchTerm,
  setSearchTerm,
  sortBy,
  setSortBy,
  onSelectSession,
  onDuplicate,
  onDelete,
  onShare,
  activeSessionId
}: HistoryViewProps) {
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="w-full max-w-4xl mx-auto px-6 sm:px-8 pt-8"
      onClick={() => setOpenDropdownId(null)}
    >
      {/* History Controls Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <h2 className="text-xl font-semibold text-gray-900">Chats ({chatsCount})</h2>
        <div className="flex items-center gap-3">
          <div className="relative group">
            <Search size={16} strokeWidth={2.5} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-gray-600 transition-colors" />
            <input
              type="text"
              placeholder="Search for chats"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-11 pr-4 py-2.5 border border-gray-200 rounded-full text-sm text-gray-700 outline-none w-full sm:w-64 focus:border-gray-300 focus:shadow-sm transition-all bg-white"
            />
          </div>
          <button
            onClick={() => setSortBy(sortBy === 'newest' ? 'oldest' : 'newest')}
            className="flex items-center gap-2 border border-gray-200 rounded-full px-5 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors shrink-0 bg-white"
          >
            Sort by: {sortBy === 'newest' ? 'Newest' : 'Oldest'}
            <ChevronDown size={14} strokeWidth={2.5} />
          </button>
        </div>
      </div>

      {/* History List */}
      {filteredChats.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 bg-slate-50 border border-dashed border-gray-200 rounded-[2rem]">
          <MessageSquare size={36} className="text-gray-300 mb-3" />
          <p className="text-gray-500 font-medium">No conversations found</p>
          <p className="text-sm text-gray-400 mt-1">Start a new one or clear filters</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {filteredChats.map((chat, i) => {
            const isSelected = activeSessionId === chat.id;
            return (
              <motion.div
                key={chat.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: i * 0.05 }}
                onClick={() => onSelectSession(chat.id)}
                className={`group relative rounded-[2rem] border transition-all duration-300 cursor-pointer ${isSelected
                  ? 'bg-slate-50 border-gray-200 p-6 sm:p-7 shadow-sm'
                  : 'bg-white border-gray-100 p-5 hover:bg-slate-50/50 hover:border-gray-200'
                  }`}
              >
                {isSelected ? (
                  // EXPANDED / CONTEXT ACTIVE STATE
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2 text-gray-500 mb-1">
                      <Calendar size={14} strokeWidth={2} />
                      <span className="text-xs font-medium">{chat.date}</span>
                    </div>
                    <h3 className="font-semibold text-lg text-gray-900 group-hover:text-black transition-colors">{chat.title}</h3>
                    <p className="text-[15px] text-gray-500 leading-relaxed max-w-[95%] line-clamp-3">{chat.preview}</p>

                    <div className="flex items-center justify-between mt-2 pt-4 border-t border-gray-100">
                      <div className="flex items-center gap-2 text-gray-400">
                        <Clock size={14} strokeWidth={2.5} />
                        <span className="text-xs font-medium">{chat.timeAgo}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onShare();
                          }}
                          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
                          title="Share chat"
                        >
                          <Share size={16} strokeWidth={2} />
                        </button>
                        <div className="relative">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenDropdownId(openDropdownId === chat.id ? null : chat.id);
                            }}
                            className={`p-2 rounded-full transition-colors ${openDropdownId === chat.id ? 'bg-gray-100 text-gray-800' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
                          >
                            <MoreVertical size={18} strokeWidth={2} />
                          </button>

                          <DropdownMenu
                            isOpen={openDropdownId === chat.id}
                            onDuplicate={() => onDuplicate(chat.id)}
                            onDelete={() => onDelete(chat.id)}
                            onShare={onShare}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  // COMPACT STATE
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-2">
                    <div className="flex flex-col gap-1 truncate max-w-md sm:max-w-lg">
                      <h3 className="font-semibold text-gray-900 truncate">{chat.title}</h3>
                      <p className="text-xs text-gray-400 truncate mt-0.5">{chat.preview}</p>
                    </div>
                    <div className="flex items-center gap-5 shrink-0">
                      <div className="flex items-center gap-2 text-gray-400">
                        <Calendar size={14} strokeWidth={2.5} />
                        <span className="text-xs font-medium whitespace-nowrap">{chat.date}</span>
                      </div>
                      <div className="relative">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenDropdownId(openDropdownId === chat.id ? null : chat.id);
                          }}
                          className={`p-1.5 -mr-1.5 rounded-full transition-colors relative ${openDropdownId === chat.id ? 'bg-gray-100 text-gray-850' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
                        >
                          <MoreVertical size={18} strokeWidth={2} />
                        </button>
                        <DropdownMenu
                          isOpen={openDropdownId === chat.id}
                          onDuplicate={() => onDuplicate(chat.id)}
                          onDelete={() => onDelete(chat.id)}
                          onShare={onShare}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}

/* --- DROP ACTION SELECTOR MENU --- */
interface DropdownMenuProps {
  isOpen: boolean;
  onDuplicate: () => void;
  onDelete: () => void;
  onShare: () => void;
}

function DropdownMenu({ isOpen, onDuplicate, onDelete, onShare }: DropdownMenuProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: -5 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -5 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          className="absolute right-0 top-full mt-2 w-48 bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-gray-100 p-1.5 z-40 origin-top-right"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onShare(); }}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-gray-700 rounded-xl hover:bg-gray-50 transition-colors"
          >
            <Share size={16} className="text-gray-400" />
            Share
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-gray-700 rounded-xl hover:bg-gray-50 transition-colors"
          >
            <Copy size={16} className="text-gray-400" />
            Duplicate
          </button>
          <div className="h-px bg-gray-100 my-1 mx-2" />
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-red-600 rounded-xl hover:bg-red-50 transition-colors"
          >
            <Trash2 size={16} className="text-red-500" />
            Delete
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* --- CHAT SCROLL TIMELINE CHIP MAP --- */
function ChatScrollTimeline({
  messages,
  onScrollToMsg
}: {
  messages: Message[];
  onScrollToMsg: (id: string) => void;
}) {
  const [hoveredMsgId, setHoveredMsgId] = useState<string | null>(null);

  const scrollUp = () => {
    const parent = document.getElementById("main-scroll-view");
    if (parent) {
      parent.scrollBy({ top: -200, behavior: "smooth" });
    }
  };

  const scrollDown = () => {
    const parent = document.getElementById("main-scroll-view");
    if (parent) {
      parent.scrollBy({ top: 200, behavior: "smooth" });
    }
  };

  if (messages.length === 0) return null;

  return (
    <div className="absolute right-5 sm:right-6 top-1/2 -translate-y-1/2 flex flex-col items-center gap-3 z-40 bg-white/90 backdrop-blur-md p-1.5 py-3 rounded-full border border-gray-200/80 shadow-md">
      {/* Scroll Up button */}
      <button
        onClick={scrollUp}
        className="text-gray-400 hover:text-slate-800 transition-colors p-1 rounded-full hover:bg-slate-50"
        title="Scroll Up"
      >
        <ChevronUp size={14} strokeWidth={2.5} />
      </button>

      {/* Message Ticks list */}
      <div className="flex flex-col items-center gap-2 py-1 select-none">
        {messages.map((msg, index) => {
          const isAssistant = msg.role === 'assistant';
          const senderLabel = isAssistant ? "Campaign AI" : "You";
          const shortPreview = msg.content.length > 60
            ? msg.content.substring(0, 60) + "..."
            : msg.content;

          return (
            <div
              key={msg.id}
              className="relative flex items-center justify-center cursor-pointer group py-0.5"
              onMouseEnter={() => setHoveredMsgId(msg.id)}
              onMouseLeave={() => setHoveredMsgId(null)}
              onClick={() => onScrollToMsg(msg.id)}
            >
              {/* Timeline Horizontal Line Tick */}
              <div
                className={`h-[3px] rounded-full transition-all duration-300 relative z-10 ${hoveredMsgId === msg.id
                  ? 'w-6 bg-black shadow-sm'
                  : isAssistant
                    ? 'w-2 bg-gray-300 group-hover:bg-gray-500'
                    : 'w-3.5 bg-gray-400 group-hover:bg-gray-600'
                  }`}
              />

              {/* Tooltip Popup on the left */}
              <AnimatePresence>
                {hoveredMsgId === msg.id && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, x: -10 }}
                    animate={{ opacity: 1, scale: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.95, x: -10 }}
                    transition={{ duration: 0.12 }}
                    className="absolute right-8 top-1/2 -translate-y-1/2 w-64 bg-white/95 text-slate-800 rounded-2xl p-3.5 shadow-[0_8px_30px_rgb(0,0,0,0.12)] backdrop-blur-md z-50 text-left pointer-events-none"
                  >
                    <div className="flex items-center gap-1.5 mb-1.5">
                      {isAssistant ? (
                        <Sparkles size={11} className="text-purple-600 animate-pulse" />
                      ) : (
                        <div className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
                      )}
                      <span className="text-[10px] uppercase tracking-wider font-bold text-gray-500">
                        {senderLabel}
                      </span>
                    </div>
                    <p className="text-xs text-slate-700 leading-relaxed font-sans line-clamp-3">
                      {shortPreview}
                    </p>
                    <span className="text-[9px] text-gray-400 mt-2 block font-mono text-right">
                      {msg.timestamp}
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {/* Scroll Down button */}
      <button
        onClick={scrollDown}
        className="text-gray-400 hover:text-slate-800 transition-colors p-1 rounded-full hover:bg-slate-50"
        title="Scroll Down"
      >
        <ChevronDown size={14} strokeWidth={2.5} />
      </button>
    </div>
  );
}
