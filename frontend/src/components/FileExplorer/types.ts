export type ExplorerViewMode = "grid" | "list";

export interface ExplorerItem {
  id: string;
  name: string;
  type: "folder" | "image" | "video" | "audio" | "pdf" | "file";
  thumbnailUrl?: string;
  previewUrl?: string;
  previewStatus?: "ready" | "generating" | "unavailable";
  size?: string;
  modifiedDate: string;
  isEditing?: boolean;
  is_note?: boolean;
  is_embedded?: string | boolean;
  processing_status?: string;
}

export interface Playlist {
  id: string;
  name: string;
  description?: string | null;
  icon_type?: string;
  is_favorite?: number;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface KnowledgeState {
  status: "not_generated" | "waiting" | "retrying_connection" | "waiting_for_connection" | "queued" | "processing" | "ready" | "ready_empty" | "stale" | "failed";
  outcome?: "not_generated" | "published" | "no_qualifying_concepts";
  published_concepts?: number;
  eligible?: boolean;
  active_version?: number | null;
  active_run_id?: string | null;
  generated_at?: string | null;
  stale_reasons?: string[];
  job_id?: string | null;
  job_status?: string | null;
  current_stage?: string | null;
  progress?: number;
  retryable?: boolean;
  error_message?: string | null;
  next_retry_at?: string | null;
  retry_schedule_step?: number;
  last_error_code?: string | null;
}

export interface ItemDetailsResource {
  created_at?: string;
  duration_seconds?: number;
  processing_status?: string;
  is_embedded?: string | boolean;
  transcript?: string;
  description?: string;
  summary?: string;
  knowledge_status?: KnowledgeState["status"];
  knowledge_active_version?: number | null;
  knowledge_generated_at?: string | null;
}

export interface ItemDetails {
  itemType: ExplorerItem["type"];
  itemName: string;
  itemSize?: string;
  resources?: unknown[];
  resource?: ItemDetailsResource;
  knowledge?: KnowledgeState;
}
