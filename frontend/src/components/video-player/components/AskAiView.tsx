import { useState, useRef, useEffect } from "react";
import { Bot, Send, MessageCircle, Trash2, ChevronDown, ChevronRight, RefreshCw, Sparkles, ThumbsUp, ThumbsDown, Copy, Check, MoreVertical, Clock, BarChart2, FileDown, FileText } from "lucide-react";
import SourceList from "../../rag/SourceList";
import InlineCitationContent, { hasInlineCitationMarkers } from "../../rag/InlineCitationContent";
import TypewriterMessage from "../../chat/TypewriterMessage";
import { SavedContentLoader, SavedContentReveal, holdSavedContentLoader } from "../../common/SavedContentLoader";
import type { RAGResponseDetails, RAGSource } from "../../rag/types";

interface ChatMessage {
  id: string;
  sender: "user" | "ai";
  text: string;
  timestamp: string;
  sources?: RAGSource[];
  details?: Partial<RAGResponseDetails>;
  query?: string;
}

interface AskAiViewProps {
  isActive?: boolean;
  initialQuestion?: string;
  onClearInitialQuestion?: () => void;
  transcript?: any[];
  resourceId: string | null;
  token: string | null;
  onSeek?: (time: number) => void;
}

export function AskAiView({ isActive, initialQuestion, onClearInitialQuestion, transcript: _transcript, resourceId, token, onSeek }: AskAiViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState<boolean>(true);
  const [suggestionPage, setSuggestionPage] = useState<number>(0);
  const [suggestionFading, setSuggestionFading] = useState<boolean>(false);
  const [showSuggestionsDrawer, setShowSuggestionsDrawer] = useState<boolean>(false);
  const [loadingSavedHistory, setLoadingSavedHistory] = useState(false);
  const [wasSavedLoad, setWasSavedLoad] = useState(false);
  const [reactions, setReactions] = useState<Record<string, 'like' | 'dislike'>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chatCacheKey = sessionId ? `ask-ai-cache:${sessionId}` : null;
  const chatMetaCacheKey = sessionId ? `ask-ai-meta:${sessionId}` : null;

  type CachedAiMetadata = {
    query?: string;
    text?: string;
    sources?: ChatMessage["sources"];
    details?: ChatMessage["details"];
  };

  const loadCachedMessages = (cacheKey: string | null): ChatMessage[] => {
    if (!cacheKey) return [];
    try {
      const parsed = JSON.parse(localStorage.getItem(cacheKey) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const normalizeCacheToken = (value: string | undefined): string => value?.trim().toLowerCase() || "";

  const loadCachedAiMetadata = (cacheKey: string | null): Record<string, CachedAiMetadata> => {
    if (!cacheKey) return {};
    try {
      const parsed = JSON.parse(localStorage.getItem(cacheKey) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  };

  const findCachedAiMetadata = (
    metadataMap: Record<string, CachedAiMetadata>,
    query: string,
    aiText: string,
  ): CachedAiMetadata | undefined => {
    const queryKey = normalizeCacheToken(query);
    if (queryKey && metadataMap[queryKey]) return metadataMap[queryKey];

    const textKey = normalizeCacheToken(aiText);
    if (textKey && metadataMap[textKey]) return metadataMap[textKey];

    return undefined;
  };

  const findCachedMessage = (
    cachedMessages: ChatMessage[],
    sender: ChatMessage["sender"],
    text: string,
    fallbackIndex: number,
  ): ChatMessage | undefined => {
    const exact = cachedMessages.find((message) => (
      message.sender === sender &&
      (message.text || "").trim() === text.trim()
    ));
    if (exact) return exact;
    const indexed = cachedMessages[fallbackIndex];
    return indexed?.sender === sender ? indexed : undefined;
  };

  const buildResponseDetails = (payload: any, query: string): Partial<RAGResponseDetails> => ({
    query,
    confidence: payload.confidence ?? null,
    confidenceLabel: payload.confidence_label ?? null,
    retrievalStrategy: payload.retrieval_strategy ?? null,
    hallucinationCount: Array.isArray(payload.hallucinations) ? payload.hallucinations.length : null,
    hallucinationCheckPassed: Array.isArray(payload.hallucinations) ? payload.hallucinations.length === 0 : null,
    processingTimeMs: payload.processing_time_ms ?? null,
    sourceCount: Array.isArray(payload.sources) ? payload.sources.length : null,
    modulesExecuted: Array.isArray(payload.modules_executed) ? payload.modules_executed : undefined,
    reasoning: typeof payload.reasoning === "string" ? payload.reasoning : null,
    contextPreview: typeof payload.context === "string" ? payload.context : null,
  });

  const SUGGESTIONS_PER_PAGE = 4;
  const totalSuggestionPages = Math.max(1, Math.ceil(suggestions.length / SUGGESTIONS_PER_PAGE));

  const createChatSession = async (title: string): Promise<string | null> => {
    if (!token || !resourceId) return null;
    try {
      const createRes = await fetch("/chat/sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ title, source: "media_player", resource_id: resourceId })
      });
      if (!createRes.ok) return null;
      const newSession = await createRes.json();
      setSessionId(newSession.id);
      return newSession.id;
    } catch (err) {
      console.error("Failed to create chat session", err);
      return null;
    }
  };

  // Initialize Chat Session ID
  useEffect(() => {
    const initChatSession = async () => {
      if (!token || !resourceId) return;
      try {
        const res = await fetch("/chat/sessions", {
          headers: { "Authorization": `Bearer ${token}` }
        });
        if (res.ok) {
          const sessions = await res.json();
          const existing = sessions.find((s: any) => s.source === "media_player" && s.resource_id === resourceId);
          if (existing) {
            setSessionId(existing.id);
            return;
          }
        }
      } catch (err) {
        console.error("Failed to initialize chat session", err);
      }
    };
    initChatSession();
  }, [resourceId, token]);

  // Fetch existing chat history when session is established
  useEffect(() => {
    if (!chatCacheKey) return;
    const cachedMessages = loadCachedMessages(chatCacheKey);
    if (cachedMessages.length > 0) {
      setMessages((prev) => (prev.length > 0 ? prev : cachedMessages));
    }
  }, [chatCacheKey]);

  useEffect(() => {
    const fetchHistory = async () => {
      if (!sessionId || !token) return;
      try {
        const res = await fetch(`/chat/sessions/${sessionId}/messages`, {
          headers: { "Authorization": `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          const cachedMessages = loadCachedMessages(chatCacheKey);
          const cachedMetadata = loadCachedAiMetadata(chatMetaCacheKey);
          if (data && data.length > 0) {
            let lastUserQuestion = "";
            const mapped = data.map((msg: any, idx: number) => {
              const sender = msg.role === "user" ? "user" : "ai";
              const text = msg.content || "";
              const cached = findCachedMessage(cachedMessages, sender, text, idx);
              if (sender === "user") {
                lastUserQuestion = text;
              }
              const cachedMeta = sender === "ai"
                ? findCachedAiMetadata(cachedMetadata, cached?.query || lastUserQuestion, text)
                : undefined;
              return {
                id: `hist-${idx}`,
                sender,
                text,
                timestamp: cached?.timestamp || "",
                query: sender === "ai" ? (cached?.query || cachedMeta?.query || lastUserQuestion) : undefined,
                sources: sender === "ai" ? (msg.sources || cached?.sources || cachedMeta?.sources) : undefined,
                details: sender === "ai" ? (msg.details || cached?.details || cachedMeta?.details) : undefined,
              };
            });
            setMessages((prev) => (prev.length > 0 ? prev : mapped));
            setLoadingSavedHistory(false);
          } else if (cachedMessages.length > 0) {
            setMessages((prev) => (prev.length > 0 ? prev : cachedMessages));
          }
        }
      } catch (e) {
        console.error("Failed to fetch chat history:", e);
      } finally {
        setLoadingSavedHistory(false);
        setHistoryLoaded(true);
      }
    };
    fetchHistory();
  }, [chatCacheKey, sessionId, token]);

  // Fetch dynamic suggested questions
  useEffect(() => {
    const fetchSuggestions = async () => {
      if (!resourceId || !token) {
        setLoadingSuggestions(false);
        return;
      }
      setLoadingSuggestions(true);
      try {
        const res = await fetch(`/resources/${resourceId}/suggested-questions`, {
          headers: { "Authorization": `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          console.log("[AskAiView] loaded saved suggested questions", {
            resourceId,
            count: Array.isArray(data.questions) ? data.questions.length : 0,
          });
          if (data.questions && data.questions.length > 0) {
            setSuggestions(data.questions);
            setSuggestionPage(0);
            setLoadingSuggestions(false);
            return;
          }
        }
      } catch (e) {
        console.error(e);
      }
      setSuggestions([
        "What is the main topic discussed?",
        "What are the key takeaways?",
        "Who are the speakers?",
        "What are the important details mentioned?"
      ]);
      setSuggestionPage(0);
      setLoadingSuggestions(false);
    };
    fetchSuggestions();
  }, [resourceId, token]);

  const reloadSuggestions = async () => {
    if (!resourceId || !token || loadingSuggestions) return;
    setLoadingSuggestions(true);
    try {
      const res = await fetch(`/resources/${resourceId}/regenerate-suggested-questions`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        console.log("[AskAiView] regenerated suggested questions", {
          resourceId,
          count: Array.isArray(data.questions) ? data.questions.length : 0,
        });
        if (data.questions && data.questions.length > 0) {
          setSuggestions(data.questions);
          setSuggestionPage(0);
        }
      }
    } catch (e) {
      console.error("Failed to reload suggestions", e);
    } finally {
      setLoadingSuggestions(false);
    }
  };

  // Auto-rotate suggestions every 30 seconds
  useEffect(() => {
    if (loadingSuggestions || suggestions.length <= SUGGESTIONS_PER_PAGE || messages.length > 0) return;

    const interval = setInterval(() => {
      setSuggestionFading(true);
      setTimeout(() => {
        setSuggestionPage((prev) => (prev + 1) % totalSuggestionPages);
        setSuggestionFading(false);
      }, 400); // fade-out duration before switching
    }, 30000);

    return () => clearInterval(interval);
  }, [loadingSuggestions, suggestions.length, totalSuggestionPages, messages.length]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  // Scroll to bottom when tab becomes visible (after switching from another tab)
  useEffect(() => {
    if (isActive && messages.length > 0 && scrollRef.current) {
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      });
    }
  }, [isActive]);

  useEffect(() => {
    if (!chatCacheKey) return;
    try {
      localStorage.setItem(chatCacheKey, JSON.stringify(messages));
    } catch {
      // Ignore cache persistence failures.
    }
  }, [chatCacheKey, messages]);

  useEffect(() => {
    if (!chatMetaCacheKey) return;
    const metadata: Record<string, CachedAiMetadata> = {};
    for (const message of messages) {
      if (message.sender !== "ai") continue;
      const payload: CachedAiMetadata = {
        query: message.query,
        text: message.text,
        sources: message.sources,
        details: message.details,
      };
      const queryKey = normalizeCacheToken(message.query);
      const textKey = normalizeCacheToken(message.text);
      if (queryKey) metadata[queryKey] = payload;
      if (textKey) metadata[textKey] = payload;
    }
    try {
      localStorage.setItem(chatMetaCacheKey, JSON.stringify(metadata));
    } catch {
      // Ignore metadata cache persistence failures.
    }
  }, [chatMetaCacheKey, messages]);

  useEffect(() => {
    if (initialQuestion && initialQuestion.trim() && sessionId && historyLoaded) {
      handleSendMessage(initialQuestion);
      if (onClearInitialQuestion) {
        onClearInitialQuestion();
      }
    }
  }, [initialQuestion, sessionId, historyLoaded]);

  const toggleReaction = (msgId: string, type: 'like' | 'dislike') => {
    setReactions((prev) => {
      const current = prev[msgId];
      if (current === type) {
        const next = { ...prev };
        delete next[msgId];
        return next;
      }
      return { ...prev, [msgId]: type };
    });
  };

  const handleCopy = (msg: ChatMessage) => {
    navigator.clipboard.writeText(msg.text).catch(() => { });
    setCopiedId(msg.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleRegenerate = (msg: ChatMessage) => {
    // Regenerate in-place: reset the existing AI message then stream into it
    if (!msg.query || isTyping || !resourceId || !token) return;
    setMessages((prev) => prev.map((m) =>
      m.id === msg.id ? { ...m, text: "", sources: [], details: undefined } : m
    ));
    handleSendMessage(msg.query, msg.id);
  };

  const exportMsgToMarkdown = (msg: ChatMessage) => {
    const lines: string[] = [`# AI Response\n`, msg.text];
    if (msg.sources && msg.sources.length > 0) {
      lines.push(`\n\n## Sources`);
      msg.sources.forEach((s, i) => {
        lines.push(`${i + 1}. ${s.excerpt?.slice(0, 120) ?? ''}`);
      });
    }
    lines.push(`\n\n---\n*Generated at ${msg.timestamp}*`);
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `response-${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportMsgToPdf = (msg: ChatMessage) => {
    const win = window.open('', '_blank');
    if (!win) return;
    const body = msg.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    win.document.write(`<!DOCTYPE html><html><head>
      <title>AI Response</title>
      <style>
        body{font-family:system-ui,sans-serif;max-width:800px;margin:40px auto;padding:20px;line-height:1.7;color:#1e293b;}
        h1{font-size:1.4em;border-bottom:2px solid #e2e8f0;padding-bottom:.5em;margin-bottom:1.2em;}
        .meta{color:#64748b;font-size:.8em;margin-top:2em;border-top:1px solid #e2e8f0;padding-top:.6em;}
      </style>
    </head><body>
      <h1>AI Response</h1>
      <div>${body}</div>
      <div class="meta">Generated at ${msg.timestamp}</div>
    </body></html>`);
    win.document.close();
    setTimeout(() => { win.print(); }, 500);
  };

  const handleSendMessage = async (text: string, regenerateMsgId?: string) => {
    if (!text.trim() || isTyping || !resourceId || !token) return;

    let activeSessionId = sessionId;
    if (!activeSessionId) {
      const title = text.trim().length > 25 ? text.trim().substring(0, 25) + '...' : text.trim();
      activeSessionId = await createChatSession(title);
      if (!activeSessionId) return;
    }

    let aiMessageId: string;

    if (regenerateMsgId) {
      // In-place regeneration: stream into the existing message, don't add new user/AI pair
      aiMessageId = regenerateMsgId;
    } else {
      // Normal send: add user message + empty AI placeholder
      const userMsg: ChatMessage = {
        id: Math.random().toString(),
        sender: "user",
        text: text,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages((prev) => [...prev, userMsg]);
      setInputValue("");
      aiMessageId = `ai-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        {
          id: aiMessageId,
          sender: "ai",
          text: "",
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          query: text.trim(),
        }
      ]);
    }

    setIsTyping(true);

    try {
      const sendChatStreamRequest = async (activeSessionId: string) => fetch(`/resources/${resourceId}/chat-stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
          "Accept": "text/event-stream",
        },
        body: JSON.stringify({
          session_id: activeSessionId,
          question: text.trim(),
        }),
      });

      let response = await sendChatStreamRequest(activeSessionId);

      if (!response.ok) {
        let detail = "Failed to reach Gemini assistant. Please try again.";
        try {
          const errorBody = await response.json();
          if (typeof errorBody?.detail === "string" && errorBody.detail.trim()) {
            detail = errorBody.detail.trim();
          }
        } catch {
          // Keep generic fallback when the backend does not return JSON.
        }

        if (response.status === 404 && detail === "Chat session not found") {
          const title = text.trim().length > 25 ? text.trim().substring(0, 25) + '...' : text.trim();
          const freshSessionId = await createChatSession(title);
          if (freshSessionId) {
            activeSessionId = freshSessionId;
            response = await sendChatStreamRequest(activeSessionId);
          }
        }
      }

      if (!response.ok) {
        let detail = `Request failed with status ${response.status}.`;
        try {
          const errorBody = await response.json();
          if (typeof errorBody?.detail === "string" && errorBody.detail.trim()) {
            detail = errorBody.detail.trim();
          }
        } catch {
          // Keep status-based fallback.
        }
        throw new Error(detail);
      }
      if (!response.body) {
        throw new Error("Streaming response body is unavailable.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const updateAiMessage = (updater: (current: ChatMessage) => ChatMessage) => {
        setMessages((prev) => prev.map((msg) => (
          msg.id === aiMessageId ? updater(msg) : msg
        )));
      };

      const processEvent = (payload: any) => {
        if (payload.type === "token") {
          updateAiMessage((current) => ({
            ...current,
            text: (current.text || "") + (payload.content || ""),
          }));
          return;
        }

        if (payload.type === "final") {
          console.log("[AskAiView] received final event", {
            query: text.trim(),
            answerLength: (payload.answer || "").length,
            sourcesCount: Array.isArray(payload.sources) ? payload.sources.length : 0,
            hasDetails: Boolean(payload.confidence != null || payload.processing_time_ms != null),
          });
          updateAiMessage((current) => ({
            ...current,
            text: payload.answer || current.text || "No reply from assistant.",
            sources: payload.sources || current.sources || [],
            details: buildResponseDetails(payload, text.trim()),
            query: text.trim(),
          }));
          return;
        }

        if (payload.type === "sources") {
          console.log("[AskAiView] received sources event", {
            query: text.trim(),
            answerLength: (payload.answer || "").length,
            sourcesCount: Array.isArray(payload.sources) ? payload.sources.length : 0,
            chunkIndexes: Array.isArray(payload.sources)
              ? payload.sources.map((source: RAGSource) => source?.chunk_index)
              : [],
          });
          updateAiMessage((current) => ({
            ...current,
            text: payload.answer || current.text || "No reply from assistant.",
            sources: payload.sources || current.sources || [],
            query: text.trim(),
          }));
          return;
        }

        if (payload.type === "error") {
          throw new Error(payload.message || "Streaming request failed.");
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const eventChunk of events) {
          const dataLine = eventChunk
            .split("\n")
            .find((line) => line.startsWith("data: "));
          if (!dataLine) continue;
          const payload = JSON.parse(dataLine.slice(6));
          processEvent(payload);
        }
      }
    } catch (err: any) {
      console.error(err);
      setMessages((prev) => prev.map((msg) => (
        msg.id === aiMessageId
          ? {
            ...msg,
            text: err.message || "I couldn't contact my server because it might still be initializing. Please try again.",
          }
          : msg
      )));
    } finally {
      setIsTyping(false);
    }
  };

  const clearChat = async () => {
    if (!sessionId || !token) {
      setMessages([]);
      return;
    }
    try {
      await fetch(`/chat/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: { "Authorization": `Bearer ${token}` }
      });
    } catch (e) {
      console.error("Failed to clear backend chat session", e);
    }
    setMessages([]);
  };

  const currentSuggestions = suggestions.slice(
    suggestionPage * SUGGESTIONS_PER_PAGE,
    (suggestionPage + 1) * SUGGESTIONS_PER_PAGE
  );
  const visibleMessages = messages.filter((message) => {
    if (message.sender !== "ai") return true;
    return Boolean(
      message.text?.trim() ||
      (message.sources && message.sources.length > 0) ||
      message.details
    );
  });
  const hasPendingEmptyAiMessage = messages.some((message) => (
    message.sender === "ai" &&
    !message.text?.trim() &&
    !(message.sources && message.sources.length > 0) &&
    !message.details
  ));

  if (loadingSavedHistory) {
    return <SavedContentLoader message="Opening your saved Ask AI chat..." />;
  }

  const askAiContent = (
    <div className="flex-1 flex flex-col space-y-6 h-full min-h-0 px-8 py-4 bg-white dark:bg-[#1e1f22]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-100 pb-3.5 shrink-0">
        <div className="flex items-center space-x-2">
          <Bot className="w-5 h-5 text-neutral-700 animate-pulse-slow" />
          <span className="text-base font-display font-bold text-neutral-800">
            Video Dialogue AI Companion
          </span>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearChat}
            className="text-xs text-red-500 hover:text-red-700 font-bold flex items-center space-x-1 cursor-pointer transition select-none"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear Conversation</span>
          </button>
        )}
      </div>

      {messages.length === 0 ? (
        // Starter Suggestion View when empty
        <div className="space-y-6 py-4 flex-1 overflow-y-auto no-scrollbar">
          <div className="bg-neutral-50/70 p-6 rounded-xl border border-neutral-100 text-center space-y-3">
            <MessageCircle className="w-8 h-8 text-neutral-400 mx-auto" />
            <p className="text-base font-bold text-neutral-705">Ask anything about the video</p>
            <p className="text-sm text-neutral-400 max-w-sm mx-auto">
              Ask questions about the context to clarify points, dig deeper into discussion, or summarize technical specs.
            </p>
          </div>

          {/* Quick Action Chips — Carousel */}
          <div className="space-y-4 pt-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-neutral-500 uppercase tracking-wider select-none">
                Suggested questions:
              </p>
              <div className="flex items-center gap-2">
                {!loadingSuggestions && totalSuggestionPages > 1 && (
                  <span className="text-[10px] text-neutral-400 font-medium select-none">
                    {suggestionPage + 1} / {totalSuggestionPages}
                  </span>
                )}
                <button
                  onClick={reloadSuggestions}
                  disabled={loadingSuggestions}
                  title="Refresh suggested questions"
                  className="p-1 rounded-md text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingSuggestions ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {loadingSuggestions ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="p-4 border border-neutral-150 dark:border-white/10 bg-white dark:bg-slate-800 rounded-xl shadow-xs animate-pulse flex items-center justify-between h-[72px]"
                  >
                    <div className="space-y-2 w-full pr-4">
                      <div className="h-4 bg-neutral-200 rounded-md w-5/6"></div>
                      <div className="h-3 bg-neutral-100 rounded-md w-2/3"></div>
                    </div>
                    <div className="h-4 w-4 bg-neutral-200 rounded-full shrink-0"></div>
                  </div>
                ))}
              </div>
            ) : (
              <>
                <div
                  className={`grid grid-cols-1 md:grid-cols-2 gap-4 transition-opacity duration-400 ${suggestionFading ? "opacity-0" : "opacity-100"
                    }`}
                >
                  {currentSuggestions.map((sug, idx) => (
                    <button
                      key={`${suggestionPage}-${idx}`}
                      onClick={() => handleSendMessage(sug)}
                      className="text-left p-4 border border-neutral-200 dark:border-white/10 bg-white dark:bg-slate-800 hover:border-neutral-400 hover:bg-neutral-50/50 dark:hover:bg-slate-700 rounded-xl text-sm md:text-base leading-relaxed font-semibold text-neutral-800 dark:text-slate-200 shadow-sm transition-all duration-250 cursor-pointer flex items-center justify-between group active:scale-[0.98] hover:-translate-y-0.5"
                    >
                      <span className="pr-4 whitespace-normal break-words flex-1 text-neutral-700 group-hover:text-neutral-900 transition-colors">{sug}</span>
                      <span className="text-sm text-neutral-400 group-hover:text-neutral-800 group-hover:translate-x-1 transition-all duration-200 font-bold select-none shrink-0">→</span>
                    </button>
                  ))}
                </div>

                {/* Page indicator dots */}
                {totalSuggestionPages > 1 && (
                  <div className="flex items-center justify-center gap-2 pt-2">
                    {Array.from({ length: totalSuggestionPages }).map((_, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          setSuggestionFading(true);
                          setTimeout(() => {
                            setSuggestionPage(i);
                            setSuggestionFading(false);
                          }, 300);
                        }}
                        className={`rounded-full transition-all duration-300 cursor-pointer ${i === suggestionPage
                            ? "w-6 h-2 bg-neutral-700"
                            : "w-2 h-2 bg-neutral-300 hover:bg-neutral-400"
                          }`}
                        aria-label={`Go to question set ${i + 1}`}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      ) : (
        /* Active Dialogue Area */
        <div
          ref={scrollRef}
          className="flex-1 space-y-4 overflow-y-auto pr-1 min-h-0 no-scrollbar"
        >
          {visibleMessages.map((msg) => (
            <div
              key={msg.id}
              className={`flex w-full ${msg.sender === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}
            >
              {/* ── AI Message ── */}
              {msg.sender === 'ai' && (
                <div className="flex gap-3 w-full max-w-[94%] lg:max-w-3xl xl:max-w-4xl items-start">
                  {/* AI avatar — frosted glass Sparkles icon matching chat page */}
                  <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 backdrop-blur-sm bg-white/70 dark:bg-white/10 border border-white/80 dark:border-white/10 shadow-[0_12px_24px_-16px_rgba(148,163,184,0.55)]">
                    <Sparkles size={14} className="text-indigo-500" />
                  </div>
                  {/* AI body — glass card matching chat page */}
                  <div className="flex-1 min-w-0">
                    <div className="rounded-[30px] rounded-tl-none px-6 py-5 backdrop-blur-md border border-white/70 dark:border-white/10 bg-slate-50/50 dark:bg-slate-800/50 shadow-[0_24px_60px_-28px_rgba(148,163,184,0.35)]">
                      {/* RAG header label */}
                      <div className="mb-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-indigo-500/80">
                        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-indigo-500/12">
                          <Sparkles size={11} className="text-indigo-500" />
                        </span>
                        <span>RAG Assistant Response</span>
                      </div>
                      <div className="text-[15px] leading-relaxed text-slate-700 dark:text-slate-200">
                        <TypewriterMessage
                          content={msg.text || ''}
                          msgId={msg.id}
                          isLatest={isTyping && messages[messages.length - 1]?.id === msg.id && msg.sender === 'ai'}
                          formatTextContent={(text) => (
                            <InlineCitationContent text={text} sources={msg.sources} onSeek={onSeek} theme={document.documentElement.classList.contains("dark") ? "dark" : "light"} />
                          )}
                        />
                      </div>
                      {msg.sources && msg.sources.length > 0 && (
                        <SourceList sources={msg.sources} theme={document.documentElement.classList.contains("dark") ? "dark" : "light"} />
                      )}
                      {/* ── Action Bar ── */}
                      <div className="mt-4 flex items-center justify-between gap-3 pt-3 border-t border-slate-200/60 dark:border-white/10">
                        {/* Left: metadata */}
                        <div className="flex items-center gap-3 flex-wrap">
                          {msg.details?.processingTimeMs != null ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 dark:text-gray-400">
                              <Clock size={11} />
                              Latency: {msg.details.processingTimeMs < 1000
                                ? `${Math.round(msg.details.processingTimeMs)}ms`
                                : `${(msg.details.processingTimeMs / 1000).toFixed(2)}s`}
                            </span>
                          ) : null}
                          {(msg.sources?.length ?? 0) > 0 ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 dark:text-gray-400">
                              <BarChart2 size={11} />
                              Scanned Vector: {(msg.details as any)?.scannedVectorCount ?? msg.sources!.length}
                            </span>
                          ) : null}
                          {msg.details?.retrievalStrategy ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 dark:text-gray-400">
                              <Sparkles size={11} />
                              Mode: {msg.details.retrievalStrategy}
                            </span>
                          ) : null}
                          {!msg.details?.processingTimeMs && !msg.details?.sourceCount && !msg.details?.retrievalStrategy && (
                            <span className="text-[10px] text-slate-400 font-mono select-none">{msg.timestamp}</span>
                          )}
                        </div>
                        {/* Right: action buttons */}
                        <div className="flex items-center gap-0.5">
                          <button
                            onClick={() => toggleReaction(msg.id, 'like')}
                            className={`p-1.5 rounded-lg transition-colors cursor-pointer hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-800 dark:hover:text-white text-slate-400 dark:text-gray-400 ${reactions[msg.id] === 'like' ? 'text-emerald-500 bg-emerald-500/10' : ''}`}
                            title="Helpful"
                          >
                            <ThumbsUp size={13} className={reactions[msg.id] === 'like' ? 'fill-emerald-400' : ''} />
                          </button>
                          <button
                            onClick={() => toggleReaction(msg.id, 'dislike')}
                            className={`p-1.5 rounded-lg transition-colors cursor-pointer hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-800 dark:hover:text-white text-slate-400 dark:text-gray-400 ${reactions[msg.id] === 'dislike' ? 'text-rose-500 bg-rose-500/10' : ''}`}
                            title="Not helpful"
                          >
                            <ThumbsDown size={13} className={reactions[msg.id] === 'dislike' ? 'fill-rose-400' : ''} />
                          </button>
                          <button
                            onClick={() => handleRegenerate(msg)}
                            disabled={isTyping}
                            className="p-1.5 rounded-lg transition-colors cursor-pointer hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-800 dark:hover:text-white text-slate-400 dark:text-gray-400 disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Regenerate"
                          >
                            <RefreshCw size={13} />
                          </button>
                          <button
                            onClick={() => handleCopy(msg)}
                            className="p-1.5 rounded-lg transition-colors cursor-pointer hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-800 dark:hover:text-white text-slate-400 dark:text-gray-400"
                            title="Copy"
                          >
                            {copiedId === msg.id ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                          </button>
                          {/* 3-dot: shows timestamp */}
                          <div className="relative inline-block">
                            <button
                              onClick={(e) => { e.stopPropagation(); setOpenDropdownId(openDropdownId === msg.id ? null : msg.id); }}
                              className={`p-1.5 rounded-lg transition-colors cursor-pointer hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-800 dark:hover:text-white text-slate-400 dark:text-gray-400 ${openDropdownId === msg.id ? 'bg-slate-100 dark:bg-white/10 text-slate-800 dark:text-white' : ''}`}
                              title="More options"
                            >
                              <MoreVertical size={13} />
                            </button>
                            {openDropdownId === msg.id && (
                              <>
                                <div className="fixed inset-0 z-40 bg-transparent" onClick={() => setOpenDropdownId(null)} />
                                <div className="absolute right-0 bottom-full mb-1 w-44 rounded-xl p-1 z-50 flex flex-col backdrop-blur-md shadow-lg bg-white dark:bg-neutral-800/95 border border-slate-200 dark:border-white/10">
                                  <button
                                    onClick={() => { exportMsgToMarkdown(msg); setOpenDropdownId(null); }}
                                    className="flex items-center gap-2 text-left w-full px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors hover:bg-slate-50 dark:hover:bg-white/10 text-slate-700 dark:text-gray-200 cursor-pointer"
                                  >
                                    <FileDown size={12} /> Export to Markdown
                                  </button>
                                  <button
                                    onClick={() => { exportMsgToPdf(msg); setOpenDropdownId(null); }}
                                    className="flex items-center gap-2 text-left w-full px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors hover:bg-slate-50 dark:hover:bg-white/10 text-slate-700 dark:text-gray-200 cursor-pointer"
                                  >
                                    <FileText size={12} /> Export to PDF
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                  </div>
                </div>
              )}

              {/* ── User Message ── */}
              {msg.sender === 'user' && (
                <div className="flex flex-col items-end max-w-[80%]">
                  <div className="bg-neutral-200 text-neutral-900 rounded-3xl rounded-br-md px-4 py-3 text-sm leading-relaxed font-normal">
                    {msg.text}
                  </div>
                  <span className="text-[10px] mt-1.5 text-neutral-400 font-mono select-none pr-1">{msg.timestamp}</span>
                </div>
              )}
            </div>
          ))}

          {/* Typing / Loading indicator */}
          {isTyping && hasPendingEmptyAiMessage && (
            <div className="flex gap-4 self-start max-w-[80%] animate-fade-in">
              <div className="w-9 h-9 rounded-full bg-amber-100 border border-amber-250 flex items-center justify-center text-amber-600 text-sm font-bold shrink-0 shadow-sm">
                AI
              </div>
              <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-white/10 rounded-3xl rounded-tl-none p-5 shadow-sm">
                <div className="flex gap-1.5 py-1.5 px-3">
                  <span className="w-2.5 h-2.5 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                  <span className="w-2.5 h-2.5 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                  <span className="w-2.5 h-2.5 bg-gray-400 rounded-full animate-bounce"></span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Suggestions Drawer for active chat */}
      {messages.length > 0 && suggestions.length > 0 && (
        <div className="shrink-0 mb-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-white/10 rounded-xl overflow-hidden shadow-xs">
          <div className="flex items-center justify-between bg-neutral-50/50 p-1 pl-3 pr-2 border-b border-neutral-100">
            <button
              type="button"
              onClick={() => setShowSuggestionsDrawer(!showSuggestionsDrawer)}
              className="flex items-center gap-1.5 py-2 text-left cursor-pointer border-none bg-transparent outline-none flex-1"
            >
              <span className="text-xs font-bold text-neutral-600 uppercase tracking-wider select-none">Suggested Questions</span>
              {showSuggestionsDrawer ? <ChevronDown size={14} className="text-neutral-500" /> : <ChevronRight size={14} className="text-neutral-500" />}
            </button>
            <button
              type="button"
              onClick={reloadSuggestions}
              disabled={loadingSuggestions}
              title="Refresh suggested questions"
              className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed border-none bg-transparent outline-none"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingSuggestions ? 'animate-spin' : ''}`} />
            </button>
          </div>
          {showSuggestionsDrawer && (
            <div className="p-3 bg-white dark:bg-slate-800 grid grid-cols-1 gap-2 max-h-48 overflow-y-auto no-scrollbar">
              {suggestions.map((sug, idx) => (
                <button
                  key={`drawer-sug-${idx}`}
                  onClick={() => {
                    handleSendMessage(sug);
                    setShowSuggestionsDrawer(false);
                  }}
                  className="text-left p-3 border border-neutral-100 hover:border-neutral-300 hover:bg-neutral-50 rounded-lg text-sm text-neutral-700 transition-all cursor-pointer"
                >
                  {sug}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Input Form Box */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSendMessage(inputValue);
        }}
        className="flex items-center space-x-3 bg-neutral-50/80 dark:bg-slate-800 p-2.5 rounded-xl border border-neutral-100/80 dark:border-white/10 mt-auto shrink-0"
      >
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Ask anything about the video..."
          disabled={isTyping}
          className="flex-1 text-sm md:text-base font-semibold text-neutral-800 dark:text-slate-200 bg-transparent border-none rounded-lg py-3 px-4 focus:outline-none placeholder-neutral-400 disabled:opacity-55"
        />
        <button
          type="submit"
          disabled={!inputValue.trim() || isTyping}
          className={`p-3.5 rounded-lg transition-all flex items-center justify-center shrink-0 ${!inputValue.trim() || isTyping
              ? "bg-neutral-200 text-neutral-400 cursor-not-allowed"
              : "bg-neutral-800 hover:bg-neutral-900 text-white cursor-pointer active:scale-95"
            }`}
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );

  return wasSavedLoad ? <SavedContentReveal>{askAiContent}</SavedContentReveal> : askAiContent;
}
