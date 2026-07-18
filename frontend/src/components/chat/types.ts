import type { RAGResponseDetails, RAGSource } from '../rag/types';

export type Source = RAGSource;

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  sources?: Source[];
  details?: Partial<RAGResponseDetails>;
  query?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  date: string;
  timeAgo: string;
  messages: Message[];
  preview: string;
}

export interface BackendChatSession {
  id: string;
  title: string;
  source?: string | null;
  created_at?: string | null;
}

export interface BackendChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[] | null;
  details?: Partial<RAGResponseDetails> | null;
  created_at?: string | null;
}

export interface ChatAppProps {
  user: { username?: string; email?: string; avatar_url?: string | null; user_id?: string } | null;
}

export interface HistoryViewProps {
  chats: ChatSession[];
  onSelect: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedId?: string;
}

export interface DropdownMenuProps {
  isOpen: boolean;
  onDuplicate: () => void;
  onDelete: () => void;
  onShare: () => void;
}
