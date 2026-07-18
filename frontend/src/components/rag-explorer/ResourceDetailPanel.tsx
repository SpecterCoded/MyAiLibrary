import { X, FileText, FileAudio, FileVideo, FileImage, File, AlertTriangle, CheckCircle2, Loader2, PlayCircle, Layers, FileCode2, ArrowRight, Search } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { RagResource, RagChunk } from './types';
import { useState, useEffect } from 'react';

interface ResourceDetailPanelProps {
  resource: RagResource | null;
  onClose: () => void;
  onOpenPreview: () => void;
}

const getIcon = (type: string) => {
  switch (type) {
    case 'pdf': return <FileText size={20} />;
    case 'docx': return <FileCode2 size={20} />;
    case 'audio': return <FileAudio size={20} />;
    case 'video': return <FileVideo size={20} />;
    case 'image': return <FileImage size={20} />;
    default: return <File size={20} />;
  }
};

const STAGES = [
  { id: 'uploaded', label: 'Uploaded' },
  { id: 'transcribing', label: 'Text Extracted' },
  { id: 'summarizing', label: 'Summary Generated' },
  { id: 'chunking', label: 'Chunking & Chaptering' },
  { id: 'embedding', label: 'Embedding Generation' },
  { id: 'indexing', label: 'Search Indexing' },
  { id: 'ready', label: 'Retrieval-Ready' },
];

export function ResourceDetailPanel({ resource, onClose, onOpenPreview }: ResourceDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'chunks'>('overview');
  const [chunks, setChunks] = useState<RagChunk[]>([]);
  const [chunksLoading, setChunksLoading] = useState(false);
  const [chunksError, setChunksError] = useState<string | null>(null);
  const [resumeLoading, setResumeLoading] = useState(false);
  const [resumeMessage, setResumeMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!resource) return;
    // Reset chunks when resource changes
    setChunks([]);
    setChunksError(null);
  }, [resource?.id]);

  const fetchChunks = async () => {
    if (!resource) return;
    setChunksLoading(true);
    setChunksError(null);
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`/rag/library/resources/${resource.id}/chunks`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`Failed to load chunks (${res.status})`);
      const data = await res.json();
      setChunks(data.chunks || []);
    } catch (e: any) {
      setChunksError(e.message || 'Unknown error');
    } finally {
      setChunksLoading(false);
    }
  };

  const handleResume = async () => {
    if (!resource) return;
    setResumeLoading(true);
    setResumeMessage(null);
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`/resources/${resource.id}/resume-advanced`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail || `Resume failed (${res.status})`);
      }
      const data = await res.json();
      setResumeMessage(`Resume queued from ${data.resume_stage || 'last step'}. Processing will continue shortly.`);
    } catch (e: any) {
      setResumeMessage(e.message || 'Resume failed');
    } finally {
      setResumeLoading(false);
    }
  };

  const handleChunksTab = () => {
    setActiveTab('chunks');
    if (chunks.length === 0 && !chunksLoading && !chunksError) {
      fetchChunks();
    }
  };

  if (!resource) return null;

  // Determine active stage index for timeline
  let currentStageIndex = 0;
  if (resource.rag_status === 'ready') currentStageIndex = STAGES.length - 1;
  else if (resource.rag_status.includes('failed')) {
    const stage = resource.diagnostics.failed_stage;
    currentStageIndex = STAGES.findIndex(s => s.id.includes(stage || ''));
  } else {
    currentStageIndex = STAGES.findIndex(s => s.id.includes(resource.rag_status.replace('processing', 'chunking'))); // Rough mapping
    if (currentStageIndex === -1) currentStageIndex = 1;
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ x: '100%', opacity: 0.5 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: '100%', opacity: 0.5 }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="fixed inset-y-0 right-0 w-full md:w-[600px] bg-panel border-l border-border shadow-2xl z-40 flex flex-col"
      >
        {/* Header */}
        <div className="p-6 border-b border-border flex-shrink-0">
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-surface border border-border text-ink">
                {getIcon(resource.type)}
              </div>
              <div>
                <h2 className="text-xl font-display font-medium text-ink">{resource.title}</h2>
                <div className="flex items-center gap-2 text-xs text-ink-muted mt-1">
                  <span>{resource.playlist_name ?? ''}</span>
                  <span>/</span>
                  <span>{resource.folder_name ?? ''}</span>
                </div>
              </div>
            </div>
            <button onClick={onClose} className="text-ink-muted hover:text-ink p-2">
              <X size={20} />
            </button>
          </div>

          <div className="flex gap-3">
            {resource.diagnostics.can_resume && (
              <button
                onClick={handleResume}
                disabled={resumeLoading}
                className="flex-1 bg-brand text-brand-foreground py-2 text-sm font-medium hover:bg-brand/90 flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
              >
                {resumeLoading ? <Loader2 size={16} className="animate-spin" /> : <PlayCircle size={16} />}
                {resumeLoading ? 'Resuming...' : `Resume from ${resource.diagnostics.failed_stage}`}
              </button>
            )}
            <button
              onClick={onOpenPreview}
              className="flex-1 border border-border-strong text-ink py-2 text-sm font-medium hover:bg-surface flex items-center justify-center gap-2 transition-colors"
            >
              <Search size={16} />
              Retrieval Preview
            </button>
          </div>
          {resumeMessage && (
            <div className={`mt-3 p-3 text-sm ${resumeMessage.includes('successfully') ? 'text-emerald-400 bg-emerald-400/10 border border-emerald-400/20' : 'text-rose-400 bg-rose-400/10 border border-rose-400/20'}`}>
              {resumeMessage}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border">
          <button
            onClick={() => setActiveTab('overview')}
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'overview' ? 'border-white text-ink' : 'border-transparent text-ink-muted hover:text-ink-muted'}`}
          >
            Overview & Health
          </button>
          <button
            onClick={handleChunksTab}
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'chunks' ? 'border-white text-ink' : 'border-transparent text-ink-muted hover:text-ink-muted'}`}
          >
            Chunk Inspector ({resource.chunk_count})
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {activeTab === 'overview' ? (
            <>
              {/* Diagnostics Block */}
              {!resource.diagnostics.healthy && (
                <div className="border border-rose-500/30 bg-rose-500/5 p-4 flex items-start gap-3">
                  <AlertTriangle className="text-rose-500 mt-0.5" size={18} />
                  <div>
                    <h4 className="text-sm font-medium text-rose-500 mb-1">Processing Failure</h4>
                    <ul className="text-sm text-rose-400/80 list-disc list-inside space-y-1">
                      {resource.diagnostics.issues.map((issue, i) => <li key={i}>{issue}</li>)}
                    </ul>
                  </div>
                </div>
              )}

              {resource.diagnostics.warnings.length > 0 && (
                <div className="border border-amber-500/30 bg-amber-500/5 p-4 flex items-start gap-3">
                  <AlertTriangle className="text-amber-500 mt-0.5" size={18} />
                  <div>
                    <h4 className="text-sm font-medium text-amber-500 mb-1">Warnings</h4>
                    <ul className="text-sm text-amber-400/80 list-disc list-inside space-y-1">
                      {resource.diagnostics.warnings.map((warn, i) => <li key={i}>{warn}</li>)}
                    </ul>
                  </div>
                </div>
              )}

              {/* Artifact Summary */}
              <div>
                <h3 className="text-xs font-mono uppercase text-ink-faint tracking-wider mb-4">Artifact Summary</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="border border-border p-4">
                    <div className="text-xs text-ink-muted mb-1">Total Chunks</div>
                    <div className="text-2xl font-display text-ink">{resource.chunk_count}</div>
                  </div>
                  <div className={`border p-4 ${resource.vector_count < resource.chunk_count && resource.chunk_count > 0 ? 'border-amber-500/30' : 'border-border'}`}>
                    <div className="text-xs text-ink-muted mb-1">Vectors</div>
                    <div className="text-2xl font-display text-ink flex items-baseline gap-2">
                      {resource.vector_count}
                      {resource.vector_count < resource.chunk_count && resource.chunk_count > 0 && (
                        <span className="text-xs font-sans text-amber-500">Missing {resource.chunk_count - resource.vector_count}</span>
                      )}
                    </div>
                  </div>
                  <div className="border border-border p-4">
                    <div className="text-xs text-ink-muted mb-1">Transcript</div>
                    <div className="text-sm font-sans text-ink mt-2">
                      {resource.has_transcript ? <span className="text-emerald-400">Available ({Math.round(resource.transcript_chars/1000)}k chars)</span> : 'Not Extracted'}
                    </div>
                  </div>
                  <div className="border border-border p-4">
                    <div className="text-xs text-ink-muted mb-1">Summary</div>
                    <div className="text-sm font-sans text-ink mt-2">
                      {resource.has_summary ? <span className="text-emerald-400">Generated</span> : (resource.diagnostics.supports_summary ? 'Pending' : <span className="text-ink-faint">Not Applicable</span>)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Processing Timeline */}
              <div>
                <h3 className="text-xs font-mono uppercase text-ink-faint tracking-wider mb-6">Processing Pipeline</h3>
                <div className="space-y-0 relative before:absolute before:inset-0 before:ml-[11px] before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-white/10 before:to-transparent">
                  {STAGES.map((stage, i) => {
                    const isCompleted = i < currentStageIndex;
                    const isCurrent = i === currentStageIndex;
                    const isFailed = isCurrent && !resource.diagnostics.healthy;
                    const isPending = i > currentStageIndex;

                    return (
                      <div key={stage.id} className="relative flex items-center gap-6 py-4">
                        <div className="w-6 h-6 rounded-full border-2 bg-panel flex items-center justify-center z-10 
                          ${isCompleted ? 'border-emerald-500' : isFailed ? 'border-rose-500' : isCurrent ? 'border-white/80' : 'border-border-strong'}"
                          style={{ borderColor: isCompleted ? '#10b981' : isFailed ? '#f43f5e' : isCurrent ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.2)' }}
                        >
                          {isCompleted && <div className="w-2 h-2 rounded-full bg-emerald-500" />}
                          {isCurrent && !isFailed && <div className="w-2 h-2 rounded-full bg-brand animate-pulse" />}
                          {isFailed && <X size={12} className="text-rose-500" />}
                        </div>
                        <div className={`flex-1 ${isCompleted ? 'text-ink' : isFailed ? 'text-rose-500' : isCurrent ? 'text-ink' : 'text-ink-faint'}`}>
                          <h4 className="text-sm font-medium">{stage.label}</h4>
                          {isFailed && <p className="text-xs mt-1 text-rose-500/80">Process halted here.</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              {chunksLoading ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Loader2 size={24} className="animate-spin text-ink-faint" />
                  <p className="text-sm text-ink-muted">Loading chunks...</p>
                </div>
              ) : chunksError ? (
                <div className="border border-rose-500/20 bg-rose-500/5 p-4 text-center">
                  <p className="text-sm text-rose-400 mb-3">{chunksError}</p>
                  <button onClick={fetchChunks} className="text-xs font-medium border border-border px-3 py-1.5 hover:bg-surface transition-colors">Retry</button>
                </div>
              ) : chunks.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-border">
                  <Layers className="mx-auto text-ink/20 mb-3" size={32} />
                  <p className="text-ink-muted text-sm">No chunks available yet.</p>
                </div>
              ) : (
                chunks.map(chunk => {
                  const chapterLabel = chunk.chapter_title || chunk.section_title || null;
                  const timestampLabel = chunk.start_time != null
                    ? new Date(chunk.start_time * 1000).toISOString().substring(11, 19)
                    : null;
                  return (
                    <div key={chunk.chunk_index} className="border border-border bg-panel-elevated p-4 group">
                      <div className="flex justify-between items-start mb-3">
                        <span className="text-xs font-mono text-ink-faint">Chunk #{chunk.chunk_index}</span>
                        <div className="flex gap-2">
                          {chunk.has_vector ? (
                            <span className="text-[10px] font-mono border border-emerald-500/30 text-emerald-400 px-2 py-0.5">VECTOR</span>
                          ) : (
                            <span className="text-[10px] font-mono border border-rose-500/30 text-rose-400 px-2 py-0.5">NO VECTOR</span>
                          )}
                        </div>
                      </div>
                      <p className="text-sm text-ink-muted font-sans leading-relaxed">{chunk.content}</p>
                      {(chapterLabel || timestampLabel || chunk.page_number) && (
                        <div className="mt-4 flex gap-2 flex-wrap">
                          {chapterLabel && <span className="text-[10px] text-ink-faint font-mono border border-border px-2 py-1 bg-surface">CH: {chapterLabel}</span>}
                          {timestampLabel && <span className="text-[10px] text-ink-faint font-mono border border-border px-2 py-1 bg-surface">TS: {timestampLabel}</span>}
                          {chunk.page_number && <span className="text-[10px] text-ink-faint font-mono border border-border px-2 py-1 bg-surface">PG: {chunk.page_number}</span>}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
