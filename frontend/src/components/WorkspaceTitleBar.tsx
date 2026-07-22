import React from 'react';
import { Plus, X } from 'lucide-react';
import type { WorkspaceTab } from '../types/workspaceTabs';

interface WorkspaceTitleBarProps {
  tabs: WorkspaceTab[];
  activeTabId: string;
  maxTabs?: number;
  onSelectTab: (tabId: string) => void;
  onNewTab: () => void;
  onCloseTab: (tabId: string) => void;
}

export default function WorkspaceTitleBar({
  tabs,
  activeTabId,
  maxTabs = 5,
  onSelectTab,
  onNewTab,
  onCloseTab,
}: WorkspaceTitleBarProps) {
  const canAddTab = tabs.length < maxTabs;

  return (
    <div className="workspace-titlebar flex h-10 shrink-0 items-stretch border-b border-slate-200/70 bg-[#f5f8fd] text-slate-700 dark:border-white/10 dark:bg-[#0f141d] dark:text-slate-200">
      <div className="workspace-drag-region flex min-w-0 flex-1 items-end gap-1 px-2 pr-[150px]">
        <div className="workspace-tabs no-scrollbar flex min-w-0 flex-1 items-end gap-1 overflow-x-auto">
          {tabs.map((tab) => {
            const active = tab.id === activeTabId;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onSelectTab(tab.id)}
                className={`workspace-tab group flex h-8 min-w-[132px] max-w-[360px] flex-[1_1_0] items-center justify-between gap-2 rounded-t-[10px] px-3 text-left text-[12px] font-semibold transition-colors ${
                  active
                    ? 'border border-slate-200/80 border-b-transparent bg-white text-slate-950 shadow-[0_1px_8px_rgba(15,23,42,0.08)] dark:border-white/10 dark:border-b-transparent dark:bg-[#25272b] dark:text-white dark:shadow-none'
                    : 'border border-transparent bg-transparent text-slate-500 hover:bg-white/55 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/7 dark:hover:text-slate-100'
                }`}
                title={tab.title}
              >
                <span className="min-w-0 flex-1 truncate">{tab.title}</span>
                <span
                  role="button"
                  tabIndex={-1}
                  aria-label={`Close ${tab.title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-colors ${
                    active
                      ? 'text-slate-400 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-white/10 dark:hover:text-white'
                      : 'text-slate-400 opacity-0 hover:bg-white/70 hover:text-slate-700 group-hover:opacity-100 dark:hover:bg-white/10 dark:hover:text-white'
                  }`}
                >
                  <X className="h-3.5 w-3.5" />
                </span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={onNewTab}
            disabled={!canAddTab}
            className="workspace-tab-add mb-1 flex h-7 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-white/65 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white"
            title={canAddTab ? 'New tab' : `Maximum ${maxTabs} tabs`}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
