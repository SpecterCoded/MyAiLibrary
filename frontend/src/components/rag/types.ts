export interface RAGSource {
  chunk_index: number;
  excerpt: string;
  rerank_score?: number | null;
  hybrid_score?: number | null;
  resource_id?: string | null;
  resource_title?: string | null;
  resource_path?: string | null;
  timestamp?: number;
  timestamp_label?: string;
  page_number?: number;
  chunk_id?: string;
}

export interface RAGResponseDetails {
  query?: string;
  confidence?: number | null;
  confidenceLabel?: string | null;
  retrievalStrategy?: string | null;
  cacheHit?: boolean | null;
  retrievedChunks?: number | null;
  parentExpansionUsed?: boolean | null;
  hierarchicalRetrievalUsed?: boolean | null;
  hallucinationCount?: number | null;
  hallucinationCheckPassed?: boolean | null;
  processingTimeMs?: number | null;
  sourceCount?: number | null;
  modulesExecuted?: string[];
  reasoning?: string | null;
  contextPreview?: string | null;
}
