import React from 'react';
import { createReactBlockSpec } from "@blocknote/react";
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
} from 'lucide-react';

// ─── Helper to render inline content ─────────────────────────────────────────

function InlineContent({ content }: { content: any[] }) {
  if (!content || !Array.isArray(content)) return null;

  return (
    <>
      {content.map((item: any, i: number) => {
        if (typeof item === 'string') return <span key={i}>{item}</span>;
        if (item.type === 'text') {
          let text = item.text || '';
          if (item.styles) {
            if (item.styles.bold) text = <strong key={i}>{text}</strong>;
            if (item.styles.italic) text = <em key={i}>{text}</em>;
            if (item.styles.code) text = <code key={i}>{text}</code>;
          }
          return <span key={i}>{text}</span>;
        }
        return null;
      })}
    </>
  );
}

// ─── Tip Block ───────────────────────────────────────────────────────────────

export const TipBlock = createReactBlockSpec(
  {
    type: 'tip' as const,
    propSchema: {
      text: { default: '' },
    },
    content: 'inline',
  },
  {
    render: ({ block }) => {
      const content = (block as any).content;
      return (
        <div className="flex items-start gap-3 p-4 my-3 rounded-lg border-l-4 border-green-400 bg-green-50 dark:bg-green-900/20 dark:border-green-500">
          <div className="flex-shrink-0 mt-0.5">
            <Lightbulb className="w-5 h-5 text-green-600 dark:text-green-400" />
          </div>
          <div className="flex-1">
            <span className="font-semibold text-green-700 dark:text-green-300 text-sm">Tip</span>
            <div className="text-green-800 dark:text-green-200 text-[15px] leading-relaxed mt-1">
              <InlineContent content={content} />
            </div>
          </div>
        </div>
      );
    },
  }
);

// ─── Warning Block ───────────────────────────────────────────────────────────

export const WarningBlock = createReactBlockSpec(
  {
    type: 'warning' as const,
    propSchema: {
      text: { default: '' },
    },
    content: 'inline',
  },
  {
    render: ({ block }) => {
      const content = (block as any).content;
      return (
        <div className="flex items-start gap-3 p-4 my-3 rounded-lg border-l-4 border-orange-400 bg-orange-50 dark:bg-orange-900/20 dark:border-orange-500">
          <div className="flex-shrink-0 mt-0.5">
            <AlertTriangle className="w-5 h-5 text-orange-600 dark:text-orange-400" />
          </div>
          <div className="flex-1">
            <span className="font-semibold text-orange-700 dark:text-orange-300 text-sm">Warning</span>
            <div className="text-orange-800 dark:text-orange-200 text-[15px] leading-relaxed mt-1">
              <InlineContent content={content} />
            </div>
          </div>
        </div>
      );
    },
  }
);

// ─── Note/Callout Block ──────────────────────────────────────────────────────

export const NoteBlock = createReactBlockSpec(
  {
    type: 'note' as const,
    propSchema: {
      text: { default: '' },
    },
    content: 'inline',
  },
  {
    render: ({ block }) => {
      const content = (block as any).content;
      return (
        <div className="flex items-start gap-3 p-4 my-3 rounded-lg border-l-4 border-blue-400 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-500">
          <div className="flex-shrink-0 mt-0.5">
            <Info className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1">
            <span className="font-semibold text-blue-700 dark:text-blue-300 text-sm">Note</span>
            <div className="text-blue-800 dark:text-blue-200 text-[15px] leading-relaxed mt-1">
              <InlineContent content={content} />
            </div>
          </div>
        </div>
      );
    },
  }
);

// ─── Definition Block ────────────────────────────────────────────────────────

export const DefinitionBlock = createReactBlockSpec(
  {
    type: 'definition' as const,
    propSchema: {
      term: { default: 'Term' },
    },
    content: 'inline',
  },
  {
    render: ({ block }) => {
      const term = (block.props as any).term as string;
      const content = (block as any).content;
      return (
        <div className="flex items-start gap-3 p-4 my-3 rounded-lg border-l-4 border-purple-400 bg-purple-50 dark:bg-purple-900/20 dark:border-purple-500">
          <div className="flex-shrink-0 mt-0.5">
            <BookOpen className="w-5 h-5 text-purple-600 dark:text-purple-400" />
          </div>
          <div className="flex-1">
            <span className="font-bold text-purple-700 dark:text-purple-300">{term}:</span>{' '}
            <span className="text-purple-800 dark:text-purple-200 text-[15px] leading-relaxed">
              <InlineContent content={content} />
            </span>
          </div>
        </div>
      );
    },
  }
);

// ─── Timestamp Block ─────────────────────────────────────────────────────────

export const TimestampBlock = createReactBlockSpec(
  {
    type: 'timestamp' as const,
    propSchema: {
      start: { default: '00:00' },
      end: { default: '00:00' },
    },
    content: 'none',
  },
  {
    render: ({ block }) => {
      const start = (block.props as any).start as string;
      const end = (block.props as any).end as string;
      return (
        <div className="inline-flex items-center gap-2 px-3 py-1.5 my-2 rounded-full bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
          <Clock className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
          <span className="text-sm font-mono font-medium text-gray-700 dark:text-gray-300">{start}</span>
          <span className="text-gray-400">–</span>
          <span className="text-sm font-mono font-medium text-gray-700 dark:text-gray-300">{end}</span>
        </div>
      );
    },
  }
);

// ─── Source Block ────────────────────────────────────────────────────────────

export const SourceBlock = createReactBlockSpec(
  {
    type: 'source' as const,
    propSchema: {
      source: { default: '' },
    },
    content: 'none',
  },
  {
    render: ({ block }) => {
      const source = (block.props as any).source as string;
      return (
        <div className="flex items-center gap-2 px-4 py-2 my-2 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
          <Link2 className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          <span className="text-sm text-gray-600 dark:text-gray-400">
            <span className="font-medium text-gray-700 dark:text-gray-300">Source:</span>{' '}
            {source}
          </span>
        </div>
      );
    },
  }
);

// ─── Workflow Block ──────────────────────────────────────────────────────────

export const WorkflowBlock = createReactBlockSpec(
  {
    type: 'workflow' as const,
    propSchema: {
      title: { default: 'Workflow' },
    },
    content: 'none',
  },
  {
    render: ({ block }) => {
      const title = (block.props as any).title as string;
      return (
        <div className="my-4 p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gradient-to-br from-gray-50 to-white dark:from-gray-800/50 dark:to-gray-900/50">
          <div className="flex items-center gap-2 mb-3 pb-3 border-b border-gray-200 dark:border-gray-700">
            <Workflow className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <span className="font-semibold text-gray-800 dark:text-gray-200">{title}</span>
          </div>
          <div className="space-y-2 text-[15px] text-gray-600 dark:text-gray-400">
            <div className="flex items-center gap-2">
              <ChevronRight className="w-4 h-4 text-indigo-500" />
              <span>Configure workflow steps here...</span>
            </div>
          </div>
        </div>
      );
    },
  }
);

// ─── Key Insight Block ───────────────────────────────────────────────────────

export const KeyInsightBlock = createReactBlockSpec(
  {
    type: 'keyInsight' as const,
    propSchema: {
      text: { default: '' },
    },
    content: 'inline',
  },
  {
    render: ({ block }) => {
      const content = (block as any).content;
      return (
        <div className="flex items-start gap-3 p-4 my-3 rounded-lg border-l-4 border-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 dark:border-yellow-500">
          <div className="flex-shrink-0 mt-0.5">
            <CheckCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
          </div>
          <div className="flex-1">
            <span className="font-semibold text-yellow-700 dark:text-yellow-300 text-sm">Key Insight</span>
            <div className="text-yellow-800 dark:text-yellow-200 text-[15px] leading-relaxed mt-1">
              <InlineContent content={content} />
            </div>
          </div>
        </div>
      );
    },
  }
);

// ─── Checklist Item Block ────────────────────────────────────────────────────

export const ChecklistBlock = createReactBlockSpec(
  {
    type: 'checklistItem' as const,
    propSchema: {
      checked: { default: 'false' },
    },
    content: 'inline',
  },
  {
    render: ({ block }) => {
      const checked = (block.props as any).checked === 'true';
      const content = (block as any).content;
      return (
        <div className="flex items-center gap-3 py-1.5">
          <input
            type="checkbox"
            checked={checked}
            className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            readOnly
          />
          <div className={`flex-1 text-[15px] ${checked ? 'line-through text-gray-400' : 'text-gray-700 dark:text-gray-300'}`}>
            <InlineContent content={content} />
          </div>
        </div>
      );
    },
  }
);

// ─── Export all custom blocks ────────────────────────────────────────────────

export const customBlocks = {
  tip: TipBlock(),
  warning: WarningBlock(),
  note: NoteBlock(),
  definition: DefinitionBlock(),
  timestamp: TimestampBlock(),
  source: SourceBlock(),
  workflow: WorkflowBlock(),
  keyInsight: KeyInsightBlock(),
  checklistItem: ChecklistBlock(),
};

// ─── Slash menu items ────────────────────────────────────────────────────────

export interface SlashMenuItem {
  name: string;
  aliases: string[];
  group: string;
  icon: React.ReactNode;
  description: string;
  blockType: string;
  props?: Record<string, string>;
}

export const slashMenuItems: SlashMenuItem[] = [
  // Basic Blocks
  {
    name: 'Paragraph',
    aliases: ['text', 'p'],
    group: 'Basic Blocks',
    icon: <FileText className="w-4 h-4" />,
    description: 'Plain text paragraph',
    blockType: 'paragraph',
  },
  {
    name: 'Heading 1',
    aliases: ['h1', 'title'],
    group: 'Basic Blocks',
    icon: <span className="font-bold text-lg">H1</span>,
    description: 'Large section heading',
    blockType: 'heading',
    props: { level: '1' },
  },
  {
    name: 'Heading 2',
    aliases: ['h2', 'subtitle'],
    group: 'Basic Blocks',
    icon: <span className="font-bold text-base">H2</span>,
    description: 'Medium section heading',
    blockType: 'heading',
    props: { level: '2' },
  },
  {
    name: 'Heading 3',
    aliases: ['h3', 'subheading'],
    group: 'Basic Blocks',
    icon: <span className="font-bold text-sm">H3</span>,
    description: 'Small section heading',
    blockType: 'heading',
    props: { level: '3' },
  },
  {
    name: 'Bullet List',
    aliases: ['ul', 'bullet', 'list'],
    group: 'Basic Blocks',
    icon: <span className="text-lg">•</span>,
    description: 'Unordered bullet list',
    blockType: 'bulletListItem',
  },
  {
    name: 'Numbered List',
    aliases: ['ol', 'numbered', 'ordered'],
    group: 'Basic Blocks',
    icon: <span className="text-sm">1.</span>,
    description: 'Ordered numbered list',
    blockType: 'numberedListItem',
  },
  {
    name: 'Checklist',
    aliases: ['check', 'task', 'todo', 'checkbox'],
    group: 'Basic Blocks',
    icon: <CheckCircle className="w-4 h-4" />,
    description: 'Task checklist item',
    blockType: 'checklistItem',
  },
  {
    name: 'Quote',
    aliases: ['blockquote', 'citation'],
    group: 'Basic Blocks',
    icon: <span className="text-xl font-serif">"</span>,
    description: 'Blockquote with left border',
    blockType: 'bulletListItem',
  },
  {
    name: 'Code Block',
    aliases: ['code', 'pre'],
    group: 'Basic Blocks',
    icon: <span className="font-mono text-sm">{'<>'}</span>,
    description: 'Formatted code snippet',
    blockType: 'codeBlock',
  },

  // Callout Blocks
  {
    name: 'Tip',
    aliases: ['hint', 'suggestion', 'lightbulb'],
    group: 'Callouts',
    icon: <Lightbulb className="w-4 h-4 text-green-500" />,
    description: 'Green tip box with icon',
    blockType: 'tip',
  },
  {
    name: 'Warning',
    aliases: ['alert', 'caution', 'danger'],
    group: 'Callouts',
    icon: <AlertTriangle className="w-4 h-4 text-orange-500" />,
    description: 'Orange warning box',
    blockType: 'warning',
  },
  {
    name: 'Note',
    aliases: ['info', 'callout', 'remark'],
    group: 'Callouts',
    icon: <Info className="w-4 h-4 text-blue-500" />,
    description: 'Blue note/callout box',
    blockType: 'note',
  },
  {
    name: 'Key Insight',
    aliases: ['insight', 'keypoint', 'important'],
    group: 'Callouts',
    icon: <CheckCircle className="w-4 h-4 text-yellow-500" />,
    description: 'Yellow key insight box',
    blockType: 'keyInsight',
  },

  // Special Blocks
  {
    name: 'Definition',
    aliases: ['def', 'define', 'term', 'glossary'],
    group: 'Special',
    icon: <BookOpen className="w-4 h-4 text-purple-500" />,
    description: 'Bold term + description',
    blockType: 'definition',
  },
  {
    name: 'Timestamp',
    aliases: ['time', 'timer', 'duration'],
    group: 'Special',
    icon: <Clock className="w-4 h-4 text-gray-500" />,
    description: 'Time badge (00:00 – 00:00)',
    blockType: 'timestamp',
  },
  {
    name: 'Source',
    aliases: ['reference', 'cite', 'citation', 'link'],
    group: 'Special',
    icon: <Link2 className="w-4 h-4 text-gray-500" />,
    description: 'Source attribution line',
    blockType: 'source',
  },
  {
    name: 'Workflow',
    aliases: ['flow', 'process', 'steps'],
    group: 'Special',
    icon: <Workflow className="w-4 h-4 text-indigo-500" />,
    description: 'Step-by-step workflow box',
    blockType: 'workflow',
  },
  {
    name: 'Divider',
    aliases: ['separator', 'hr', 'line'],
    group: 'Special',
    icon: <span className="text-gray-400">—</span>,
    description: 'Horizontal line separator',
    blockType: 'paragraph',
  },
];
