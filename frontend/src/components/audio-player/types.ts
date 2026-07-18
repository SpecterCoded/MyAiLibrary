import type { RAGResponseDetails, RAGSource } from '../rag/types';

export interface TranscriptItem {
  id: string;
  speaker: "Ehsan" | "Ava" | "System" | string;
  time: string;
  text: string;
  avatarUrl?: string;
  avatarBg?: string;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
}

export interface MindMapData {
  title: string;
  subtopics: {
    topic: string;
    details: string[];
  }[];
}

export interface ChatMessage {
  id: string;
  sender: "user" | "ai";
  text: string;
  timestamp: string;
  sources?: RAGSource[];
  details?: Partial<RAGResponseDetails>;
  query?: string;
}
