import type { RAGResponseDetails } from '../rag/types';

export function formatSessionDate(value?: string | null): string {
  if (!value) return 'Unknown date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export function formatSessionTimeAgo(value?: string | null): string {
  if (!value) return 'Saved';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Saved';
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  const diffWeeks = Math.floor(diffDays / 7);
  return `${diffWeeks} week${diffWeeks === 1 ? '' : 's'} ago`;
}

export function formatMessageTimestamp(value?: string | null): string {
  if (!value) {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function buildInitialResponseDetails(payload: any, query: string): Partial<RAGResponseDetails> {
  return {
    query,
    confidence: payload.confidence ?? null,
    confidenceLabel: payload.confidence_label ?? null,
    retrievalStrategy: payload.retrieval_strategy ?? null,
    hallucinationCount: Array.isArray(payload.hallucinations) ? payload.hallucinations.length : null,
    hallucinationCheckPassed: Array.isArray(payload.hallucinations) ? payload.hallucinations.length === 0 : null,
    processingTimeMs: payload.processing_time_ms ?? null,
    sourceCount: Array.isArray(payload.sources) ? payload.sources.length : null,
    modulesExecuted: Array.isArray(payload.modules_executed) ? payload.modules_executed : undefined,
    reasoning: typeof payload.reasoning === 'string' ? payload.reasoning : null,
    contextPreview: typeof payload.context === 'string' ? payload.context : null,
  };
}

export function getSmartSuggestions(messages: any[]): string[] {
  if (!messages || messages.length === 0) {
    return [
      "Can you give me a quick overview of my campaign's performance?",
      "Are there any spend issues, spikes, or dips in my ad budget?",
      "Which ads / ad creatives are performing best this week?"
    ];
  }
  return [
    "Can you give me a quick overview of my campaign's performance?",
    "Are there any spend issues, spikes, or dips in my ad budget?",
    "Which ads / ad creatives are performing best this week?"
  ];
}
