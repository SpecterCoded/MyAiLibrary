import React from 'react';
import { Search, SortAsc, SortDesc, Trash2, Copy, Clock } from 'lucide-react';

interface HistoryViewProps {
  filteredChats: any[];
  chatsCount: number;
  searchTerm: string;
  setSearchTerm: (v: string) => void;
  sortBy: 'newest' | 'oldest';
  setSortBy: (v: 'newest' | 'oldest') => void;
  onSelectSession: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onShare: () => void;
  activeSessionId: string | null;
}

export default function HistoryView({
  filteredChats,
  chatsCount,
  searchTerm,
  setSearchTerm,
  sortBy,
  setSortBy,
  onSelectSession,
  onDuplicate,
  onDelete,
  activeSessionId,
}: HistoryViewProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search conversations..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          onClick={() => setSortBy(sortBy === 'newest' ? 'oldest' : 'newest')}
          className="p-2 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"
        >
          {sortBy === 'newest' ? <SortDesc className="w-4 h-4" /> : <SortAsc className="w-4 h-4" />}
        </button>
      </div>

      <p className="text-xs text-gray-500 mb-3">{filteredChats.length} of {chatsCount} conversations</p>

      <div className="flex-1 overflow-y-auto space-y-2">
        {filteredChats.length === 0 && (
          <div className="text-center text-gray-400 py-12">No conversations found</div>
        )}
        {filteredChats.map((chat) => (
          <div
            key={chat.id}
            onClick={() => onSelectSession(chat.id)}
            className={`group p-3 rounded-xl cursor-pointer transition-all ${
              activeSessionId === chat.id
                ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800'
                : 'bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 border border-transparent'
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-medium truncate">{chat.title || 'Untitled'}</h3>
                <div className="flex items-center gap-1 mt-1 text-xs text-gray-400">
                  <Clock className="w-3 h-3" />
                  <span>{chat.updated_at ? new Date(chat.updated_at).toLocaleDateString() : ''}</span>
                </div>
              </div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => { e.stopPropagation(); onDuplicate(chat.id); }}
                  className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                  title="Duplicate"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(chat.id); }}
                  className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500"
                  title="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
