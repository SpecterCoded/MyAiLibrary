import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronUp, ChevronDown, Sparkles } from 'lucide-react';
import type { Message } from './types';

interface ChatScrollTimelineProps {
  messages: Message[];
  onScrollToMsg: (id: string) => void;
}

export default function ChatScrollTimeline({ messages, onScrollToMsg }: ChatScrollTimelineProps) {
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
      <button onClick={scrollUp} className="text-gray-400 hover:text-slate-800 transition-colors p-1 rounded-full hover:bg-slate-50" title="Scroll Up">
        <ChevronUp size={14} strokeWidth={2.5} />
      </button>

      <div className="flex flex-col items-center gap-2 py-1 select-none">
        {messages.map((msg) => {
          const isAssistant = msg.role === 'assistant';
          const senderLabel = isAssistant ? "Campaign AI" : "You";
          const shortPreview = msg.content.length > 60 ? msg.content.substring(0, 60) + "..." : msg.content;

          return (
            <div key={msg.id} className="relative flex items-center justify-center cursor-pointer group py-0.5"
              onMouseEnter={() => setHoveredMsgId(msg.id)} onMouseLeave={() => setHoveredMsgId(null)}
              onClick={() => onScrollToMsg(msg.id)}>
              <div className={`h-[3px] rounded-full transition-all duration-300 relative z-10 ${hoveredMsgId === msg.id ? 'w-6 bg-black shadow-sm' : isAssistant ? 'w-2 bg-gray-300 group-hover:bg-gray-500' : 'w-3.5 bg-gray-400 group-hover:bg-gray-600'}`} />
              <AnimatePresence>
                {hoveredMsgId === msg.id && (
                  <motion.div initial={{ opacity: 0, scale: 0.95, x: -10 }} animate={{ opacity: 1, scale: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.95, x: -10 }} transition={{ duration: 0.12 }}
                    className="absolute right-8 top-1/2 -translate-y-1/2 w-64 bg-white/95 text-slate-800 rounded-2xl p-3.5 shadow-[0_8px_30px_rgb(0,0,0,0.12)] backdrop-blur-md z-50 text-left pointer-events-none">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      {isAssistant ? <Sparkles size={11} className="text-purple-600 animate-pulse" /> : <div className="w-1.5 h-1.5 bg-blue-500 rounded-full" />}
                      <span className="text-[10px] uppercase tracking-wider font-bold text-gray-500">{senderLabel}</span>
                    </div>
                    <p className="text-xs text-slate-700 leading-relaxed font-sans line-clamp-3">{shortPreview}</p>
                    <span className="text-[9px] text-gray-400 mt-2 block font-mono text-right">{msg.timestamp}</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      <button onClick={scrollDown} className="text-gray-400 hover:text-slate-800 transition-colors p-1 rounded-full hover:bg-slate-50" title="Scroll Down">
        <ChevronDown size={14} strokeWidth={2.5} />
      </button>
    </div>
  );
}
