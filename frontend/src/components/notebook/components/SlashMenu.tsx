import React, { useState, useEffect, useRef, useMemo } from 'react';
import { slashMenuItems } from './SlashMenuBlocks';
import type { SlashMenuItem } from './SlashMenuBlocks';

interface SlashMenuProps {
  isOpen: boolean;
  position: { top: number; left: number };
  onSelect: (item: SlashMenuItem) => void;
  onClose: () => void;
  filter: string;
}

export function SlashMenu({ isOpen, position, onSelect, onClose, filter }: SlashMenuProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Filter items based on search
  const filteredItems = useMemo(() => {
    if (!filter) return slashMenuItems;
    const lowerFilter = filter.toLowerCase();
    return slashMenuItems.filter(
      (item) =>
        item.name.toLowerCase().includes(lowerFilter) ||
        item.aliases.some((alias) => alias.toLowerCase().includes(lowerFilter)) ||
        item.description.toLowerCase().includes(lowerFilter)
    );
  }, [filter]);

  // Group items
  const groupedItems = useMemo(() => {
    const groups: Record<string, SlashMenuItem[]> = {};
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
      className="fixed z-[9999] w-[320px] max-h-[400px] overflow-y-auto bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 py-2"
      style={{ top: position.top, left: position.left }}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800">
        <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
          Blocks
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
                key={`${item.name}-${item.blockType}`}
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
                  className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${
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
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
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
