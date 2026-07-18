import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Lightbulb,
  AlertTriangle,
  FileText,
  BookOpen,
  Clock,
  Link2,
  Workflow,
  ChevronRight,
  Info,
  CheckCircle,
  Hash,
  List,
  ListOrdered,
  Code,
  Quote,
  Minus,
  Bold,
  Italic,
} from 'lucide-react';

// ─── Formatting Items ────────────────────────────────────────────────────────

export interface FormatItem {
  name: string;
  aliases: string[];
  group: string;
  icon: React.ReactNode;
  description: string;
  markdown: string;
  cursorOffset?: number; // cursor position after insertion
}

export const formatItems: FormatItem[] = [
  // Text Formatting
  {
    name: 'Heading 1',
    aliases: ['h1', 'title'],
    group: 'Text',
    icon: <span className="font-bold text-sm">H1</span>,
    description: 'Large heading',
    markdown: '# ',
  },
  {
    name: 'Heading 2',
    aliases: ['h2', 'subtitle'],
    group: 'Text',
    icon: <span className="font-bold text-xs">H2</span>,
    description: 'Medium heading',
    markdown: '## ',
  },
  {
    name: 'Heading 3',
    aliases: ['h3', 'subheading'],
    group: 'Text',
    icon: <span className="font-bold text-[10px]">H3</span>,
    description: 'Small heading',
    markdown: '### ',
  },
  {
    name: 'Bold',
    aliases: ['b', 'strong'],
    group: 'Text',
    icon: <Bold className="w-4 h-4" />,
    description: 'Bold text',
    markdown: '**text**',
    cursorOffset: -2,
  },
  {
    name: 'Italic',
    aliases: ['i', 'em'],
    group: 'Text',
    icon: <Italic className="w-4 h-4" />,
    description: 'Italic text',
    markdown: '*text*',
    cursorOffset: -1,
  },
  {
    name: 'Code',
    aliases: ['inline', 'monospace'],
    group: 'Text',
    icon: <Code className="w-4 h-4" />,
    description: 'Inline code',
    markdown: '`code`',
    cursorOffset: -1,
  },

  // Lists
  {
    name: 'Bullet List',
    aliases: ['ul', 'bullet', 'list'],
    group: 'Lists',
    icon: <List className="w-4 h-4" />,
    description: 'Unordered list item',
    markdown: '- ',
  },
  {
    name: 'Numbered List',
    aliases: ['ol', 'numbered', 'ordered'],
    group: 'Lists',
    icon: <ListOrdered className="w-4 h-4" />,
    description: 'Ordered list item',
    markdown: '1. ',
  },
  {
    name: 'Checklist',
    aliases: ['check', 'task', 'todo'],
    group: 'Lists',
    icon: <CheckCircle className="w-4 h-4" />,
    description: 'Task checklist',
    markdown: '- [ ] ',
  },

  // Callouts (matching the AI-generated format)
  {
    name: 'Tip',
    aliases: ['hint', 'suggestion', 'lightbulb'],
    group: 'Callouts',
    icon: <Lightbulb className="w-4 h-4 text-green-500" />,
    description: 'Green tip box',
    markdown: '\n> 💡 **Tip:** ',
  },
  {
    name: 'Warning',
    aliases: ['alert', 'caution', 'danger'],
    group: 'Callouts',
    icon: <AlertTriangle className="w-4 h-4 text-orange-500" />,
    description: 'Orange warning box',
    markdown: '\n> ⚠️ **Warning:** ',
  },
  {
    name: 'Note',
    aliases: ['info', 'callout', 'remark'],
    group: 'Callouts',
    icon: <Info className="w-4 h-4 text-blue-500" />,
    description: 'Blue note box',
    markdown: '\n> 📝 **Note:** ',
  },
  {
    name: 'Key Insight',
    aliases: ['insight', 'keypoint', 'important'],
    group: 'Callouts',
    icon: <CheckCircle className="w-4 h-4 text-yellow-500" />,
    description: 'Key insight box',
    markdown: '\n> ✨ **Key Insight:** ',
  },

  // Special
  {
    name: 'Quote',
    aliases: ['blockquote', 'citation'],
    group: 'Special',
    icon: <Quote className="w-4 h-4" />,
    description: 'Blockquote',
    markdown: '> ',
  },
  {
    name: 'Divider',
    aliases: ['separator', 'hr', 'line'],
    group: 'Special',
    icon: <Minus className="w-4 h-4" />,
    description: 'Horizontal line',
    markdown: '\n---\n',
  },
  {
    name: 'Timestamp',
    aliases: ['time', 'timer'],
    group: 'Special',
    icon: <Clock className="w-4 h-4 text-gray-500" />,
    description: 'Time reference',
    markdown: '[00:00]',
    cursorOffset: -1,
  },
  {
    name: 'Source',
    aliases: ['reference', 'cite', 'link'],
    group: 'Special',
    icon: <Link2 className="w-4 h-4 text-gray-500" />,
    description: 'Source link',
    markdown: '[Source](url)',
    cursorOffset: -1,
  },
  {
    name: 'Workflow',
    aliases: ['flow', 'process', 'steps'],
    group: 'Special',
    icon: <Workflow className="w-4 h-4 text-indigo-500" />,
    description: 'Step-by-step',
    markdown: '\n**Workflow:**\n1. ',
  },
];

// ─── Slash Menu Component ────────────────────────────────────────────────────

interface NotesSlashMenuProps {
  isOpen: boolean;
  position: { top: number; left: number };
  onSelect: (item: FormatItem) => void;
  onClose: () => void;
  filter: string;
  relative?: boolean; // Use relative positioning instead of fixed
}

export function NotesSlashMenu({ isOpen, position, onSelect, onClose, filter, relative = false }: NotesSlashMenuProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Filter items based on search
  const filteredItems = useMemo(() => {
    if (!filter) return formatItems;
    const lowerFilter = filter.toLowerCase();
    return formatItems.filter(
      (item) =>
        item.name.toLowerCase().includes(lowerFilter) ||
        item.aliases.some((alias) => alias.toLowerCase().includes(lowerFilter)) ||
        item.description.toLowerCase().includes(lowerFilter)
    );
  }, [filter]);

  // Group items
  const groupedItems = useMemo(() => {
    const groups: Record<string, FormatItem[]> = {};
    filteredItems.forEach((item) => {
      if (!groups[item.group]) groups[item.group] = [];
      groups[item.group].push(item);
    });
    return groups;
  }, [filteredItems]);

  // Flat list for keyboard navigation
  const flatItems = useMemo(() => filteredItems, [filteredItems]);

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [filter]);

  // Scroll selected item into view
  useEffect(() => {
    if (itemRefs.current[selectedIndex]) {
      itemRefs.current[selectedIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % flatItems.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + flatItems.length) % flatItems.length);
          break;
        case 'Enter':
          e.preventDefault();
          if (flatItems[selectedIndex]) {
            onSelect(flatItems[selectedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, selectedIndex, flatItems, onSelect, onClose]);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  if (!isOpen || flatItems.length === 0) return null;

  let globalIndex = 0;

  return (
    <div
      ref={menuRef}
      className={`${relative ? 'absolute' : 'fixed'} z-[9999] w-[280px] max-h-[350px] overflow-y-auto bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 py-2`}
      style={{ top: position.top, left: position.left }}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800">
        <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
          Formatting
        </span>
      </div>

      {/* Menu Items */}
      {Object.entries(groupedItems).map(([group, items]) => (
        <div key={group}>
          {/* Group Header */}
          <div className="px-3 py-1.5 mt-1">
            <span className="text-[11px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
              {group}
            </span>
          </div>

          {/* Group Items */}
          {items.map((item) => {
            const currentIndex = globalIndex++;
            const isSelected = currentIndex === selectedIndex;
            return (
              <div
                key={`${item.name}-${item.markdown}`}
                ref={(el) => { itemRefs.current[currentIndex] = el; }}
                className={`flex items-center gap-3 px-3 py-2 mx-1 rounded-lg cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-indigo-50 dark:bg-indigo-900/30'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
                onClick={() => onSelect(item)}
                onMouseEnter={() => setSelectedIndex(currentIndex)}
              >
                {/* Icon */}
                <div
                  className={`flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center ${
                    isSelected
                      ? 'bg-indigo-100 dark:bg-indigo-800/50'
                      : 'bg-gray-100 dark:bg-gray-800'
                  }`}
                >
                  {item.icon}
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                    {item.name}
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                    {item.description}
                  </div>
                </div>

                {/* Keyboard hint */}
                {isSelected && (
                  <div className="flex-shrink-0 text-[10px] text-gray-400 dark:text-gray-500">
                    ↵
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
