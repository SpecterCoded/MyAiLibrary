import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LayoutGroup, motion, Reorder, useReducedMotion } from 'framer-motion';
import { ExternalLink, Plus, X } from 'lucide-react';
import type { WorkspaceTab } from '../types/workspaceTabs';

interface TabContextMenuState {
  tabId: string;
  x: number;
  y: number;
}

interface WorkspaceTitleBarProps {
  tabs: WorkspaceTab[];
  activeTabId: string;
  maxTabs?: number;
  onSelectTab: (tabId: string) => void;
  onNewTab: () => void;
  onCloseTab: (tabId: string) => void;
  onOpenTabInNewWindow?: (tabId: string) => void | Promise<void>;
  onReorderTabs: (tabIds: string[]) => void;
}

export default function WorkspaceTitleBar({
  tabs,
  activeTabId,
  maxTabs = 5,
  onSelectTab,
  onNewTab,
  onCloseTab,
  onOpenTabInNewWindow,
  onReorderTabs,
}: WorkspaceTitleBarProps) {
  const prefersReducedMotion = useReducedMotion();
  const canAddTab = tabs.length < maxTabs;
  const draggingTabIdRef = useRef<string | null>(null);
  const suppressClickRef = useRef(false);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const [contextMenu, setContextMenu] = useState<TabContextMenuState | null>(null);
  const tabIds = tabs.map((tab) => tab.id);
  const contextMenuTab = contextMenu ? tabs.find((tab) => tab.id === contextMenu.tabId) : undefined;
  const canOpenContextTabInNewWindow = Boolean(
    contextMenuTab &&
    contextMenuTab.kind !== 'home' &&
    contextMenuTab.kind !== 'library' &&
    onOpenTabInNewWindow,
  );

  useEffect(() => {
    if (!contextMenu) return;
    const closeMenu = () => setContextMenu(null);
    const handlePointerDown = (event: PointerEvent) => {
      if (!contextMenuRef.current?.contains(event.target as Node)) closeMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
    };
  }, [contextMenu]);

  const openContextMenu = (event: React.MouseEvent, tab: WorkspaceTab) => {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 220;
    const menuHeight = tab.kind === 'home' || tab.kind === 'library' || !onOpenTabInNewWindow ? 48 : 88;
    const edgeGap = 8;
    setContextMenu({
      tabId: tab.id,
      x: Math.max(edgeGap, Math.min(event.clientX, window.innerWidth - menuWidth - edgeGap)),
      y: Math.max(edgeGap, Math.min(event.clientY, window.innerHeight - menuHeight - edgeGap)),
    });
  };

  return (
    <>
      <div className="workspace-titlebar flex h-10 shrink-0 items-stretch border-b border-slate-200/70 bg-[#f5f8fd] text-slate-700 dark:border-white/10 dark:bg-[#0f141d] dark:text-slate-200">
        <div className="workspace-drag-region flex min-w-0 flex-1 items-end gap-1 px-2 pr-[150px]">
          <LayoutGroup id="workspace-tabs">
          <Reorder.Group
          axis="x"
          values={tabIds}
          onReorder={onReorderTabs}
          className="workspace-tabs no-scrollbar flex min-w-0 flex-1 items-end gap-1 overflow-x-auto"
        >
          {tabs.map((tab) => {
            const active = tab.id === activeTabId;
            return (
              <Reorder.Item
                key={tab.id}
                value={tab.id}
                layout="position"
                transition={{ type: 'spring', stiffness: 520, damping: 38, mass: 0.7 }}
                whileDrag={{ scale: 1.025, y: -2, zIndex: 40 }}
                onDragStart={() => {
                  draggingTabIdRef.current = tab.id;
                  suppressClickRef.current = true;
                }}
                onDragEnd={() => {
                  draggingTabIdRef.current = null;
                  window.setTimeout(() => {
                    suppressClickRef.current = false;
                  }, 0);
                }}
                className="workspace-tab min-w-[132px] max-w-[360px] flex-[1_1_0] list-none"
              >
              <button
                type="button"
                onClick={() => {
                  if (draggingTabIdRef.current === tab.id || suppressClickRef.current) return;
                  onSelectTab(tab.id);
                }}
                onContextMenu={(event) => openContextMenu(event, tab)}
                className={`group relative isolate flex h-8 w-full items-center justify-between gap-2 rounded-t-[10px] border border-transparent px-3 text-left text-[12px] font-semibold transition-colors ${
                  active
                    ? 'text-slate-950 dark:text-white'
                    : 'bg-transparent text-slate-500 hover:bg-white/55 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/7 dark:hover:text-slate-100'
                }`}
                title={tab.title}
              >
                {active && (
                  <motion.span
                    layoutId="workspace-active-tab-highlight"
                    className="pointer-events-none absolute inset-0 z-0 rounded-t-[10px] border border-slate-200/80 border-b-transparent bg-white shadow-[0_1px_8px_rgba(15,23,42,0.08)] dark:border-white/10 dark:border-b-transparent dark:bg-[#25272b] dark:shadow-none"
                    transition={prefersReducedMotion
                      ? { duration: 0 }
                      : { type: 'spring', stiffness: 560, damping: 42, mass: 0.55 }}
                  />
                )}
                <span className="relative z-10 min-w-0 flex-1 truncate">{tab.title}</span>
                <span
                  role="button"
                  tabIndex={-1}
                  aria-label={`Close ${tab.title}`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  className={`relative z-10 flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-colors ${
                    active
                      ? 'text-slate-400 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-white/10 dark:hover:text-white'
                      : 'text-slate-400 opacity-0 hover:bg-white/70 hover:text-slate-700 group-hover:opacity-100 dark:hover:bg-white/10 dark:hover:text-white'
                  }`}
                >
                  <X className="h-3.5 w-3.5" />
                </span>
              </button>
              </Reorder.Item>
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
          </Reorder.Group>
          </LayoutGroup>
        </div>
      </div>
      {contextMenu && contextMenuTab && createPortal(
        <div
          ref={contextMenuRef}
          role="menu"
          aria-label={`${contextMenuTab.title} tab actions`}
          className="fixed z-[10050] w-[220px] overflow-hidden rounded-xl border border-slate-200/90 bg-white p-1.5 text-slate-700 shadow-[0_18px_48px_rgba(15,23,42,0.2)] dark:border-white/10 dark:bg-[#25272b] dark:text-slate-200 dark:shadow-[0_18px_48px_rgba(0,0,0,0.5)]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {canOpenContextTabInNewWindow && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setContextMenu(null);
                void onOpenTabInNewWindow?.(contextMenuTab.id);
              }}
              className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[12px] font-medium transition-colors hover:bg-slate-100 dark:hover:bg-white/10"
            >
              <ExternalLink className="h-4 w-4" />
              <span>Open in new window</span>
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setContextMenu(null);
              onCloseTab(contextMenuTab.id);
            }}
            className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[12px] font-medium transition-colors hover:bg-slate-100 dark:hover:bg-white/10"
          >
            <X className="h-4 w-4" />
            <span>Close tab</span>
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}
