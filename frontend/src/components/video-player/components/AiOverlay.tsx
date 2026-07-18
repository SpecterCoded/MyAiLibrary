import React, { useState, useRef, useEffect } from "react";
import { Sparkles, ArrowRight } from "lucide-react";

interface AiOverlayProps {
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  onSubmitQuery?: (text: string) => void;
}

export function AiOverlay({ isOpen, onOpen, onClose, onSubmitQuery }: AiOverlayProps) {
  const [localInput, setLocalInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (localInput.trim()) {
      if (onSubmitQuery) {
        onSubmitQuery(localInput.trim());
      }
      setLocalInput("");
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSubmit();
    }
  };

  return (
    <div 
      className={`absolute bottom-6 left-1/2 -translate-x-1/2 z-10 transition-all duration-300 rounded-[24px] shadow-lg bg-white border border-slate-100 p-[3px] bg-gradient-to-r from-[#ff9254] via-[#ffd6cc] to-[#ff9254] ${
        isOpen ? "w-[480px]" : "w-[400px]"
      }`}
      onClick={() => {
        if (!isOpen) onOpen();
      }}
    >
      <div className="bg-white dark:bg-slate-800 rounded-full flex items-center px-4 py-2.5 w-full">
        <Sparkles size={16} className="text-[#ff7d54] mr-2 flex-shrink-0" />
        {isOpen ? (
          <input 
            ref={inputRef}
            type="text"
            value={localInput}
            onChange={(e) => setLocalInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything about your meeting..."
            className="text-[13px] text-gray-900 font-bold flex-1 outline-none placeholder:text-gray-400 bg-transparent"
            onBlur={() => {
              // Gracefully close active typing mode if they click away and haven't typed anything
              if (!localInput.trim()) {
                setTimeout(() => onClose(), 150);
              }
            }}
          />
        ) : (
          <span className="text-[13px] text-gray-400 font-bold flex-1 select-none cursor-text whitespace-nowrap overflow-hidden text-ellipsis mr-2">
            Ask Clario anything about your meeting...
          </span>
        )}
        <button 
          onClick={handleSubmit}
          className={`rounded-full p-1 ml-1 transition-all duration-200 cursor-pointer ${
            localInput.trim() ? "bg-[#ff7d54] text-white hover:scale-110" : "bg-gray-100 text-gray-400"
          }`}
        >
          <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}

