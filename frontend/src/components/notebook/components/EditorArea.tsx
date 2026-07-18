import React, { useEffect, useRef, useState, useCallback } from 'react';
import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/core/fonts/inter.css";
import { useCreateBlockNote } from "@blocknote/react";
import "@blocknote/mantine/style.css";
import { useAppContext } from '../AppContext';
import { X, Plus, Loader } from 'lucide-react';
import { customBlocks } from './SlashMenuBlocks';
import type { SlashMenuItem } from './SlashMenuBlocks';
import { SlashMenu } from './SlashMenu';

// ─── Mermaid renderer component ─────────────────────────────────────────────

function MermaidDiagram({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renderRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const render = async () => {
      try {
        setError(null);
        if (!(window as any).mermaid) {
          await new Promise<void>((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
            s.onload = () => resolve();
            s.onerror = () => reject(new Error('Failed to load mermaid'));
            document.head.appendChild(s);
          });
        }

        if (cancelled) return;

        const mermaid = (window as any).mermaid;
        mermaid.initialize({
          startOnLoad: false,
          theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default',
          securityLevel: 'loose',
        });

        if (!renderRef.current) return;
        renderRef.current.innerHTML = '';

        const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`;
        const { svg } = await mermaid.render(id, code);

        if (cancelled || !renderRef.current) return;
        renderRef.current.innerHTML = svg;

        const svgEl = renderRef.current.querySelector('svg');
        if (svgEl) {
          svgEl.style.width = '100%';
          svgEl.style.height = '100%';
          svgEl.style.maxWidth = '100%';
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? 'Mermaid render error');
      }
    };

    render();
    return () => { cancelled = true; };
  }, [code]);

  // wheel zoom
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = 1.15;
      setScale(prev => Math.max(0.2, Math.min(5, e.deltaY < 0 ? prev * factor : prev / factor)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setOffset({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };
  const onStop = () => setIsDragging(false);

  return (
    <div
      ref={containerRef}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onStop}
      onMouseLeave={onStop}
      style={{ width: '100%', height: '420px', position: 'relative', overflow: 'hidden' }}
      className="border border-[#EFEFED] dark:border-white/10 rounded-2xl bg-[#FAFAFA] dark:bg-[#1E1E1E] cursor-grab active:cursor-grabbing select-none"
    >
      {/* Controls */}
      <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-white/80 dark:bg-slate-800/80 backdrop-blur-md px-2 py-1.5 rounded-full border border-[#EFEFED] dark:border-white/10 z-10 shadow-sm">
        <button
          type="button"
          onClick={() => setScale(p => Math.min(5, p * 1.2))}
          className="p-1 hover:bg-gray-100 dark:hover:bg-slate-700 cursor-pointer font-bold text-xs w-6 h-6 flex items-center justify-center border-none outline-none bg-transparent text-[#37352F] dark:text-[#dbdee1]"
        >＋</button>
        <button
          type="button"
          onClick={() => setScale(p => Math.max(0.2, p / 1.2))}
          className="p-1 hover:bg-gray-100 dark:hover:bg-slate-700 cursor-pointer font-bold text-xs w-6 h-6 flex items-center justify-center border-none outline-none bg-transparent text-[#37352F] dark:text-[#dbdee1]"
        >－</button>
        <button
          type="button"
          onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }); }}
          className="px-2 py-0.5 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-full text-[10px] text-slate-600 dark:text-slate-400 cursor-pointer font-bold border-none outline-none bg-transparent"
        >Reset</button>
      </div>

      {error ? (
        <div className="absolute inset-0 flex items-center justify-center text-red-500 text-sm p-4 text-center">
          {error}
        </div>
      ) : (
        <div
          ref={renderRef}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transformOrigin: 'center center',
            transition: isDragging ? 'none' : 'transform 0.15s ease-out',
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        />
      )}
    </div>
  );
}

// ─── Mermaid custom block spec ────────────────────────────────────────────────

const MermaidBlock = createReactBlockSpec(
  {
    type: 'mermaid' as const,
    propSchema: {
      code: { default: '' },
    },
    content: 'none',
  },
  {
    render: ({ block }) => {
      const code = (block.props as any).code as string;
      return (
        <div style={{ width: '100%', padding: '4px 0' }}>
          <MermaidDiagram code={code} />
        </div>
      );
    },
  }
);

// ─── BlockNote schema with all custom blocks ─────────────────────────────────

const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    mermaid: MermaidBlock(),
    ...customBlocks,
  },
});

// ─── Helper: detect mermaid code ──────────────────────────────────────────────

function isMermaidCode(text: string): boolean {
  const t = text.trim();
  return (
    t.startsWith('graph ') ||
    t.startsWith('graph\n') ||
    t.startsWith('flowchart ') ||
    t.startsWith('sequenceDiagram') ||
    t.startsWith('classDiagram') ||
    t.startsWith('stateDiagram') ||
    t.startsWith('erDiagram') ||
    t.startsWith('gantt') ||
    t.startsWith('pie')
  );
}

// ─── EditorArea ──────────────────────────────────────────────────────────────

export function EditorArea() {
  const { notes, selectedNoteId, updateNoteContent, updateNoteTitle, isSaving, addTag, removeTag } = useAppContext();
  const note = notes.find(n => n.id === selectedNoteId);
  const [tagging, setTagging] = useState(false);
  const [newTag, setNewTag] = useState('');

  const isUpdatingRef = useRef(false);
  const hasMigratedRef = useRef(false);

  // Slash menu state
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashMenuPosition, setSlashMenuPosition] = useState({ top: 0, left: 0 });
  const [slashFilter, setSlashFilter] = useState('');
  const slashTriggerBlockRef = useRef<string | null>(null);

  const editor = useCreateBlockNote({
    schema,
    initialContent: note && note.content && note.content.length > 0 ? note.content : undefined,
  });

  // Track dark mode
  const [isDark, setIsDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  );
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setIsDark(root.classList.contains('dark'));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // Handle slash menu item selection
  const handleSlashMenuSelect = useCallback((item: SlashMenuItem) => {
    if (!slashTriggerBlockRef.current) return;

    const blockId = slashTriggerBlockRef.current;
    const block = editor.getBlock(blockId);
    if (!block) return;

    // Replace the current block with the new block type
    editor.updateBlock(blockId, {
      type: item.blockType as any,
      props: item.props || {},
    } as any);

    // Close the menu
    setSlashMenuOpen(false);
    slashTriggerBlockRef.current = null;
    setSlashFilter('');

    // Focus the editor
    editor._tiptapEditor.commands.focus();
  }, [editor]);

  // Listen for "/" key to trigger slash menu
  useEffect(() => {
    if (!editor) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if slash menu is already open
      if (slashMenuOpen) return;

      if (e.key === '/') {
        setTimeout(() => {
          const block = editor.getTextCursorPosition().block;
          if (!block) return;

          // Get cursor position for menu placement
          const DOMBlock = editor._tiptapEditor.view.dom.querySelector(`[data-id="${block.id}"]`);
          if (DOMBlock) {
            const rect = DOMBlock.getBoundingClientRect();
            setSlashMenuPosition({
              top: rect.bottom + window.scrollY + 8,
              left: rect.left + window.scrollX,
            });
          }

          slashTriggerBlockRef.current = block.id;
          setSlashFilter('');
          setSlashMenuOpen(true);
        }, 10);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [editor, slashMenuOpen]);

  // Update filter when typing in slash command block
  useEffect(() => {
    if (!editor || !slashMenuOpen || !slashTriggerBlockRef.current) return;

    const updateFilter = () => {
      const block = editor.getBlock(slashTriggerBlockRef.current!);
      if (!block) {
        setSlashMenuOpen(false);
        return;
      }

      let text = '';
      if (typeof (block as any).content === 'string') {
        text = (block as any).content;
      } else if (Array.isArray((block as any).content)) {
        text = (block as any).content
          .map((c: any) => (typeof c === 'string' ? c : c.text ?? ''))
          .join('');
      }

      // Extract filter after "/"
      const slashIndex = text.lastIndexOf('/');
      if (slashIndex !== -1) {
        setSlashFilter(text.slice(slashIndex + 1));
      } else {
        setSlashMenuOpen(false);
      }
    };

    // Use MutationObserver to watch for content changes
    const observer = new MutationObserver(updateFilter);
    const editorEl = editor._tiptapEditor.view.dom;
    observer.observe(editorEl, { childList: true, subtree: true, characterData: true });

    return () => observer.disconnect();
  }, [editor, slashMenuOpen]);

  // Migrate codeBlocks containing Mermaid syntax → mermaid blocks (once per note load)
  useEffect(() => {
    if (!note || !editor) return;
    hasMigratedRef.current = false;
  }, [note?.id]);

  useEffect(() => {
    if (!note || !editor || hasMigratedRef.current) return;

    const migrate = () => {
      const blocks = editor.document;
      if (!blocks || blocks.length === 0) return;

      const toReplace: Array<{ id: string; code: string }> = [];

      for (const block of blocks) {
        if (block.type === 'codeBlock') {
          let text = '';
          if (typeof (block as any).content === 'string') {
            text = (block as any).content;
          } else if (Array.isArray((block as any).content)) {
            text = (block as any).content.map((c: any) => typeof c === 'string' ? c : (c.text ?? '')).join('');
          }
          if (isMermaidCode(text)) {
            toReplace.push({ id: block.id, code: text.trim() });
          }
        }
      }

      if (toReplace.length === 0) return;

      hasMigratedRef.current = true;
      isUpdatingRef.current = true;

      for (const { id, code } of toReplace) {
        try {
          editor.updateBlock(id, {
            type: 'mermaid',
            props: { code },
          } as any);
        } catch (e) {
          console.error('[Mermaid] Failed to convert block', id, e);
        }
      }

      isUpdatingRef.current = false;
    };

    // Slight delay to allow BlockNote to mount fully
    const t1 = setTimeout(migrate, 300);
    const t2 = setTimeout(migrate, 1200);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [note?.id, editor]);

  // Persist content changes
  useEffect(() => {
    if (!note) return;

    return editor.onChange(() => {
      if (isUpdatingRef.current) return;
      const newContent = editor.document;
      updateNoteContent(note.id, newContent);
    });
  }, [editor, note?.id, updateNoteContent]);

  if (!note) {
    return (
      <div className="flex h-full items-center justify-center text-gray-400 font-medium tracking-wide">
        No note selected
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1100px] px-12 py-16 pb-40">
      {/* Page Properties */}
      <div className="mb-8 pl-[54px] pr-[54px]">
        {/* Tags */}
        <div className="flex items-center space-x-2 mb-6 min-h-[24px] flex-wrap gap-y-2 group">
          {(!note.tags || note.tags.length === 0) && !tagging && (
            <div className="text-gray-400 text-[13px] group-hover:hidden transition-all">No tags</div>
          )}
          {note.tags && note.tags.map((tag, i) => (
            <div key={i} className={`${tag.bgClass} ${tag.colorClass} px-2 py-0.5 rounded text-[11px] uppercase tracking-wider font-bold flex items-center group/tag`}>
              {tag.label}
              <button
                className="ml-1 opacity-0 group-hover/tag:opacity-100 hover:text-red-500 transition-opacity"
                onClick={() => removeTag(note.id, tag.label)}
              >
                <X size={10} />
              </button>
            </div>
          ))}

          {tagging ? (
            <input
              autoFocus
              className="text-[11px] uppercase tracking-wider font-bold bg-gray-50 border border-gray-200 rounded px-2 py-0.5 outline-none w-24"
              placeholder="Tag name..."
              value={newTag}
              onChange={e => setNewTag(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newTag.trim()) {
                  addTag(note.id, newTag.trim());
                  setNewTag('');
                  setTagging(false);
                } else if (e.key === 'Escape') {
                  setTagging(false);
                  setNewTag('');
                }
              }}
              onBlur={() => {
                if (newTag.trim()) addTag(note.id, newTag.trim());
                setTagging(false);
                setNewTag('');
              }}
            />
          ) : (
            <button
              className="text-[11px] uppercase tracking-wider font-bold bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700 px-2 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-all flex items-center"
              onClick={() => setTagging(true)}
            >
              <Plus size={10} className="mr-1" /> Add Tag
            </button>
          )}
        </div>

        {/* Title */}
        <textarea
          className="text-[48px] font-bold text-[#37352F] dark:text-[#f2f3f5] leading-[1.2] tracking-tight mb-3 font-sans w-full bg-transparent resize-none outline-none overflow-hidden placeholder-gray-300 block"
          value={note.title}
          onChange={(e) => {
            updateNoteTitle(note.id, e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = e.target.scrollHeight + 'px';
          }}
          placeholder="Untitled"
          rows={1}
          style={{ height: 'auto', minHeight: '60px' }}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement;
            target.style.height = 'auto';
            target.style.height = target.scrollHeight + 'px';
          }}
        />

        {/* Meta */}
        <div className="flex items-center space-x-2 text-[15px] font-medium text-[#9A9A97]">
          <span>Created {new Date(note.createdAt).toLocaleDateString()}</span>
          <span>•</span>
          {isSaving ? (
            <span className="flex items-center text-[#1E7D53]"><Loader size={12} className="animate-spin mr-1.5" /> Saving...</span>
          ) : (
            <span>Last modified {new Date(note.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          )}
        </div>

        <div className="w-full h-px bg-[#EFEFED] mt-8 mb-8"></div>

        {note.id === 'n1' && (
          <div className="bg-[#FFF9E6] border-l-4 border-[#F5C642] px-6 py-5 rounded-r-md rounded-l-sm mt-[-8px] mb-8">
            <p className="italic text-[#8C6A1E] text-[16px] leading-relaxed">
              In the ever-evolving landscape of digital design, navigation architecture stands as a cornerstone of user experience (UX). It is the blueprint that guides users through an application or website, ensuring that they can find information quickly and efficiently.
            </p>
          </div>
        )}
      </div>

      {/* BlockNote Editor */}
      <div className="editor-container w-full max-w-full pl-[54px] pr-[54px]">
        <BlockNoteView
          editor={editor}
          theme={isDark ? 'dark' : 'light'}
          className="min-h-[500px]"
        />
      </div>

      {/* Custom Slash Menu */}
      <SlashMenu
        isOpen={slashMenuOpen}
        position={slashMenuPosition}
        filter={slashFilter}
        onSelect={handleSlashMenuSelect}
        onClose={() => {
          setSlashMenuOpen(false);
          slashTriggerBlockRef.current = null;
        }}
      />

      {/* Styling tweaks */}
      <style>{`
        .editor-container .bn-editor {
          padding: 0 !important;
          background: transparent !important;
        }

        .bn-block-content h2 {
          font-size: 28px !important;
          font-weight: 600 !important;
          margin-top: 36px !important;
          margin-bottom: 20px !important;
          color: ${isDark ? '#f2f3f5' : '#37352F'} !important;
        }

        .bn-block-content p {
          font-size: 18px !important;
          line-height: 1.7 !important;
          color: ${isDark ? '#dbdee1' : '#37352F'} !important;
          margin-bottom: 12px !important;
        }

        .bn-block-content li {
          font-size: 18px !important;
          line-height: 1.7 !important;
          color: ${isDark ? '#dbdee1' : '#37352F'} !important;
        }

        /* Custom block styles */
        .bn-block-content[data-content-type="tip"],
        .bn-block-content[data-content-type="warning"],
        .bn-block-content[data-content-type="note"],
        .bn-block-content[data-content-type="definition"],
        .bn-block-content[data-content-type="keyInsight"] {
          margin: 12px 0;
        }
      `}</style>
    </div>
  );
}
