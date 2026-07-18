import React, { useState, useRef, useCallback } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { NotesSlashMenu, type FormatItem } from './NotesSlashMenu';
import InlineCitationContent from '../rag/InlineCitationContent';

interface NotesEditorProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
}

export function NotesEditor({ value, onChange, className = '', placeholder = 'Type / to see formatting options...' }: NotesEditorProps) {
  const [showPreview, setShowPreview] = useState(true);
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashMenuPosition, setSlashMenuPosition] = useState({ top: 0, left: 0 });
  const [slashFilter, setSlashFilter] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const slashStartPosRef = useRef<number>(0);

  const handleSlashMenuSelect = useCallback((item: FormatItem) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const startPos = slashStartPosRef.current;
    const endPos = textarea.selectionStart;
    const textBefore = value.substring(0, startPos);
    const textAfter = value.substring(endPos);

    const newText = textBefore + item.markdown + textAfter;
    onChange(newText);

    setSlashMenuOpen(false);
    setSlashFilter('');

    setTimeout(() => {
      const newPos = startPos + item.markdown.length + (item.cursorOffset || 0);
      textarea.selectionStart = newPos;
      textarea.selectionEnd = newPos;
      textarea.focus();
    }, 10);
  }, [value, onChange]);

  const handleTextareaInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    onChange(newValue);

    const cursorPos = e.target.selectionStart;
    const textBeforeCursor = newValue.substring(0, cursorPos);

    const lastChar = textBeforeCursor.slice(-1);
    if (lastChar === '/') {
      const lastNewline = textBeforeCursor.lastIndexOf('\n');
      const currentLine = textBeforeCursor.substring(lastNewline + 1);

      if (currentLine === '/' || currentLine.endsWith(' /') || currentLine.startsWith('/')) {
        if (containerRef.current && textareaRef.current) {
          const containerRect = containerRef.current.getBoundingClientRect();
          const textarea = textareaRef.current;

          const mirror = document.createElement('div');
          mirror.style.cssText = window.getComputedStyle(textarea).cssText;
          mirror.style.position = 'absolute';
          mirror.style.visibility = 'hidden';
          mirror.style.height = 'auto';
          mirror.style.width = textarea.offsetWidth + 'px';
          mirror.textContent = textBeforeCursor;
          document.body.appendChild(mirror);

          const lineHeight = parseInt(window.getComputedStyle(textarea).lineHeight) || 24;
          const lines = textBeforeCursor.split('\n').length;
          const cursorTop = lines * lineHeight;

          document.body.removeChild(mirror);

          setSlashMenuPosition({
            top: Math.min(cursorTop + 40, containerRect.height - 350),
            left: 20,
          });
        }

        slashStartPosRef.current = cursorPos - 1;
        setSlashMenuOpen(true);
        setSlashFilter('');
      }
    } else if (slashMenuOpen) {
      const lastSlash = textBeforeCursor.lastIndexOf('/');
      if (lastSlash !== -1) {
        setSlashFilter(textBeforeCursor.substring(lastSlash + 1));
      } else {
        setSlashMenuOpen(false);
      }
    }
  }, [slashMenuOpen, onChange]);

  const handleTextareaKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape' && slashMenuOpen) {
      setSlashMenuOpen(false);
      e.preventDefault();
    }
  }, [slashMenuOpen]);

  return (
    <div ref={containerRef} className={`relative flex flex-col ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 rounded-t-2xl">
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500 mr-2">Edit</span>
          <div className="w-px h-4 bg-gray-300 dark:bg-gray-600" />
        </div>
        <button
          type="button"
          onClick={() => setShowPreview(!showPreview)}
          className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition"
        >
          {showPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          {showPreview ? 'Hide Preview' : 'Show Preview'}
        </button>
      </div>

      {/* Editor Area */}
      <div className="flex-1 flex min-h-[400px]">
        {/* Textarea */}
        <div className={`relative flex-1 ${showPreview ? 'w-1/2 border-r border-gray-200 dark:border-gray-700' : 'w-full'}`}>
          <textarea
            ref={textareaRef}
            className="w-full h-full min-h-[400px] p-5 bg-white dark:bg-gray-900 text-sm text-gray-800 dark:text-gray-200 outline-none resize-none font-mono leading-relaxed"
            value={value}
            onChange={handleTextareaInput}
            onKeyDown={handleTextareaKeyDown}
            placeholder={placeholder}
          />
          <div className="absolute bottom-2 right-2 text-[10px] text-gray-400 bg-white/80 dark:bg-gray-800/80 px-2 py-1 rounded-md">
            Type <kbd className="font-mono font-bold">/</kbd> for formatting
          </div>
        </div>

        {/* Live Preview - uses same component as final note */}
        {showPreview && (
          <div className="w-1/2 overflow-auto bg-white dark:bg-gray-900">
            <div className="p-6">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Preview</div>
              <div className="bg-neutral-50/50 dark:bg-slate-800/50 rounded-2xl border border-neutral-100/80 dark:border-white/10 p-6 leading-relaxed">
                <InlineCitationContent text={value} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Slash Menu */}
      {slashMenuOpen && (
        <div className="absolute z-[9999]" style={{ top: slashMenuPosition.top, left: slashMenuPosition.left }}>
          <NotesSlashMenu
            isOpen={slashMenuOpen}
            position={{ top: 0, left: 0 }}
            filter={slashFilter}
            onSelect={handleSlashMenuSelect}
            onClose={() => {
              setSlashMenuOpen(false);
              setSlashFilter('');
            }}
            relative
          />
        </div>
      )}
    </div>
  );
}
