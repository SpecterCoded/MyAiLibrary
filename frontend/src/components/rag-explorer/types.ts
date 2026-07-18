

export type ResourceType = 'pdf' | 'docx' | 'image' | 'audio' | 'video';

export interface Diagnostic {
  healthy: boolean;
  health_score: number;
  health_history: { time: string; score: number }[];
  issues: string[];
  warnings: string[];
  failed_stage?: string;
  last_completed_stage?: string;
  ready_for_retrieval: boolean;
  can_resume: boolean;
  can_embed: boolean;
  supports_summary: boolean;
}

export interface Resource {
  id: string;
  title: string;
  type: ResourceType;
  folder_name: string;
  playlist_name: string;
  processing_status: string;
  rag_status: RagStatus;
  is_embedded: boolean;
  chunk_count: number;
  vector_count: number;
  search_index_count: number;
  transcript_chars: number;
  summary_chars: number;
  has_transcript: boolean;
  has_summary: boolean;
  created_at: string;
  diagnostics: Diagnostic;
}

export interface Chunk {
  id: string;
  resource_id: string;
  chunk_index: number;
  content: string;
  has_vector: boolean;
  page_number?: number;
  timestamp?: string;
  chapter?: string;
  subchapter?: string;
}


export type RagStatus =
  | 'ready'
  | 'prepared'
  | 'chunked'
  | 'text_extracted'
  | 'queued'
  | 'processing'
  | 'transcribing'
  | 'summarizing'
  | 'chaptering'
  | 'subchaptering'
  | 'embedding'
  | 'indexing'
  | 'failed'
  | 'failed_transcribing'
  | 'failed_summarizing'
  | 'failed_chaptering'
  | 'failed_subchaptering'
  | 'failed_embedding'
  | 'failed_indexing'
  | 'empty';

export interface RagDiagnostic {
  healthy: boolean;
  health_score: number;
  health_history?: { time: string; score: number }[];
  issues: string[];
  warnings: string[];
  failed_stage?: string | null;
  last_completed_stage?: string | null;
  ready_for_retrieval: boolean;
  can_resume: boolean;
  can_embed: boolean;
  supports_summary: boolean;
}

export interface RagResource {
  id: string;
  title: string;
  type: string;
  folder_id: string | null;
  folder_name: string | null;
  playlist_id: string | null;
  playlist_name: string | null;
  processing_status: string | null;
  rag_status: RagStatus | string;
  is_embedded: boolean;
  chunk_count: number;
  vector_count: number;
  search_index_count: number;
  transcript_chars: number;
  summary_chars: number;
  has_transcript: boolean;
  has_summary: boolean;
  created_at: string | null;
  diagnostics: RagDiagnostic;
}

export interface RagLibraryStats {
  resources: number;
  embedded_resources: number;
  retrieval_ready_resources: number;
  healthy_resources: number;
  failed_resources: number;
  chunks: number;
  vectors: number;
  transcript_chars: number;
  status_counts: Record<string, number>;
}

export interface RagLibraryOverviewResponse {
  stats: RagLibraryStats;
  pagination: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
  };
  sort: {
    sort_by: string;
    sort_order: 'asc' | 'desc';
  };
  filters: {
    playlist_id: string | null;
    folder_id: string | null;
    q: string | null;
    embedded_only: boolean | null;
    resource_type: string | null;
    processing_status: string | null;
  };
  resources: RagResource[];
}

export interface RagLibraryVolumeDatum {
  date: string;
  label: string;
  chunks: number;
  vectors: number;
}

export interface RagLibraryVolumeResponse {
  days: number;
  generated_at: string;
  data: RagLibraryVolumeDatum[];
  totals: {
    chunks: number;
    vectors: number;
  };
}

export interface RagResourceDetailResponse {
  resource: RagResource;
  source_material: {
    transcript: string;
    summary: string;
    transcript_chars: number;
    summary_chars: number;
    search_index_content: string;
  };
  artifacts: {
    chunks: number;
    vectors: number;
    search_index_entries: number;
    has_search_index: boolean;
    chunk_indices_without_vectors: number[];
    vector_indices_without_chunks: number[];
  };
}

export interface RagChunk {
  chunk_index: number;
  content: string;
  has_vector: boolean;
  vector_id?: string | null;
  metadata?: Record<string, unknown>;
  start_time?: number | null;
  end_time?: number | null;
  page_number?: number | null;
  section_title?: string | null;
  chapter_title?: string | null;
  subchapter_title?: string | null;
}

export interface RagChunkResponse {
  resource_id: string;
  chunks: RagChunk[];
}

export interface RetrievalHit {
  resource_id?: string;
  resource_title?: string | null;
  chunk_index?: number;
  content: string;
  metadata?: Record<string, any>;
  distance?: number | null;
  score?: number | null;
  chroma_distance?: number | null;
  bm25_score?: number | null;
  hybrid_score?: number | null;
  rerank_score?: number | null;
  vector_distance?: number | null;
}

export interface RagRetrievalPreviewResponse {
  query: string;
  resource_id?: string;
  resource_scope_size?: number;
  vector: RetrievalHit[];
  bm25: RetrievalHit[];
  hybrid: RetrievalHit[];
  reranked: RetrievalHit[];
}

export interface RagSearchResult {
  resource_id: string;
  title: string;
  type: string;
  processing_status: string | null;
  is_embedded: boolean;
  folder_id: string | null;
  search_index_excerpt: string;
  chunk_samples: Array<{
    chunk_index: number;
    content: string;
  }>;
}

export interface RagSearchResponse {
  query: string;
  results: RagSearchResult[];
}

export interface PlaylistOption {
  id: string;
  name: string;
}

export interface FolderOption {
  id: string;
  name: string;
  playlist_id?: string | null;
}

