import React, { useMemo, useState } from 'react';
import { Download, FileDown, FlaskConical, Play, RefreshCw, Upload } from 'lucide-react';

import type { RAGSource } from './rag/types';

type DatasetCase = {
  question: string;
  expected_answer?: string;
  expected_source_documents?: string[];
  expected_citations?: string[];
  expected_document_ids?: string[];
  expected_chunk_ids?: string[];
  category?: string;
  difficulty?: string;
  notes?: string;
};

type BenchmarkDataset = {
  name: string;
  description?: string;
  cases: DatasetCase[];
};

type EvaluationResult = {
  question: string;
  answer: string;
  latencyMs: number;
  sourceTitles: string[];
  sourceCount: number;
  matchedSources: number;
  precisionAtK: number | null;
  recallAtK: number | null;
  hitRate: number;
  answerMatch: number | null;
  confidence: number | null;
};

type BenchmarkRun = {
  id: string;
  createdAt: string;
  datasetName: string;
  caseCount: number;
  summary: {
    avgLatencyMs: number;
    avgPrecisionAtK: number | null;
    avgRecallAtK: number | null;
    hitRate: number;
    answerMatchRate: number | null;
    avgConfidence: number | null;
  };
  results: EvaluationResult[];
};

const HISTORY_STORAGE_KEY = 'rag_evaluation_history';

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

function average(values: Array<number | null | undefined>): number | null {
  const filtered = values.filter((value): value is number => typeof value === 'number' && !Number.isNaN(value));
  if (filtered.length === 0) return null;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function loadHistory(): BenchmarkRun[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as BenchmarkRun[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(history: BenchmarkRun[]): void {
  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
}

function parseScalar(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseSimpleYaml(text: string): BenchmarkDataset {
  const lines = text.replace(/\r/g, '').split('\n');
  let name = 'Benchmark Dataset';
  let description = '';
  const cases: DatasetCase[] = [];
  let currentCase: Record<string, unknown> | null = null;
  let activeListKey: keyof DatasetCase | null = null;

  const flushCase = () => {
    if (currentCase && typeof currentCase.question === 'string' && currentCase.question.trim()) {
      cases.push(currentCase as DatasetCase);
    }
    currentCase = null;
    activeListKey = null;
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (!currentCase) {
      if (trimmed.startsWith('name:')) {
        name = parseScalar(trimmed.slice(5));
        continue;
      }
      if (trimmed.startsWith('description:')) {
        description = parseScalar(trimmed.slice(12));
        continue;
      }
      if (trimmed === 'cases:') {
        continue;
      }
    }

    if (trimmed.startsWith('- ')) {
      const remainder = trimmed.slice(2);
      if (!currentCase || remainder.includes(':')) {
        flushCase();
        currentCase = {};
        const separatorIndex = remainder.indexOf(':');
        if (separatorIndex >= 0) {
          const key = remainder.slice(0, separatorIndex).trim() as keyof DatasetCase;
          const value = parseScalar(remainder.slice(separatorIndex + 1));
          currentCase[key] = value;
          activeListKey = null;
        } else if (activeListKey) {
          currentCase[activeListKey] = [valueAsArrayEntry(currentCase[activeListKey]), parseScalar(remainder)].flat();
        }
      } else if (activeListKey) {
        const existing = Array.isArray(currentCase[activeListKey]) ? currentCase[activeListKey] as string[] : [];
        currentCase[activeListKey] = [...existing, parseScalar(remainder)];
      }
      continue;
    }

    if (!currentCase) continue;

    const separatorIndex = trimmed.indexOf(':');
    if (separatorIndex < 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim() as keyof DatasetCase;
    const rest = trimmed.slice(separatorIndex + 1).trim();
    if (!rest) {
      currentCase[key] = [];
      activeListKey = key;
      continue;
    }

    if (rest.startsWith('[') && rest.endsWith(']')) {
      currentCase[key] = rest
        .slice(1, -1)
        .split(',')
        .map((item) => parseScalar(item))
        .filter(Boolean);
      activeListKey = null;
      continue;
    }

    currentCase[key] = parseScalar(rest);
    activeListKey = null;
  }

  flushCase();

  return { name, description, cases };
}

function valueAsArrayEntry(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return [];
}

function parseDataset(text: string, fallbackName: string): BenchmarkDataset {
  const trimmed = text.trim();
  if (!trimmed) {
    return { name: fallbackName, cases: [] };
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return { name: fallbackName, cases: parsed as DatasetCase[] };
    }
    if (Array.isArray(parsed.cases)) {
      return {
        name: parsed.name || fallbackName,
        description: parsed.description,
        cases: parsed.cases as DatasetCase[],
      };
    }
  } catch {
    return parseSimpleYaml(trimmed);
  }

  return { name: fallbackName, cases: [] };
}

function exportBlob(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function compareRuns(baseRun: BenchmarkRun | null, candidateRun: BenchmarkRun | null) {
  if (!baseRun || !candidateRun) return null;
  return {
    latencyDelta: candidateRun.summary.avgLatencyMs - baseRun.summary.avgLatencyMs,
    precisionDelta: (candidateRun.summary.avgPrecisionAtK ?? 0) - (baseRun.summary.avgPrecisionAtK ?? 0),
    recallDelta: (candidateRun.summary.avgRecallAtK ?? 0) - (baseRun.summary.avgRecallAtK ?? 0),
    hitRateDelta: candidateRun.summary.hitRate - baseRun.summary.hitRate,
    answerMatchDelta: (candidateRun.summary.answerMatchRate ?? 0) - (baseRun.summary.answerMatchRate ?? 0),
    confidenceDelta: (candidateRun.summary.avgConfidence ?? 0) - (baseRun.summary.avgConfidence ?? 0),
  };
}

function sourceTitlesFromResponse(sources: RAGSource[]): string[] {
  return [...new Set(sources.map((source) => normalize(source.resource_title || source.resource_id || '')).filter(Boolean))];
}

export default function EvaluationWorkbench() {
  const [datasetText, setDatasetText] = useState('');
  const [datasetName, setDatasetName] = useState('Frontend Benchmark');
  const [isRunning, setIsRunning] = useState(false);
  const [history, setHistory] = useState<BenchmarkRun[]>(() => loadHistory());
  const [selectedRunIdA, setSelectedRunIdA] = useState<string>('');
  const [selectedRunIdB, setSelectedRunIdB] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const parsedDataset = useMemo(() => parseDataset(datasetText, datasetName), [datasetName, datasetText]);
  const latestRun = history[0] || null;
  const runA = history.find((run) => run.id === selectedRunIdA) || null;
  const runB = history.find((run) => run.id === selectedRunIdB) || null;
  const comparison = compareRuns(runA, runB);

  const runBenchmark = async () => {
    if (parsedDataset.cases.length === 0) {
      setError('Load a JSON or YAML dataset with at least one benchmark case first.');
      return;
    }

    setIsRunning(true);
    setError(null);
    const token = localStorage.getItem('access_token');
    const results: EvaluationResult[] = [];

    try {
      for (const testCase of parsedDataset.cases) {
        const startedAt = performance.now();
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            messages: [{ role: 'user', content: testCase.question, timestamp: new Date().toISOString() }],
            selected_resource_ids: [],
          }),
        });

        const payload = await response.json();
        if (!response.ok) {
          throw new Error(typeof payload?.detail === 'string' ? payload.detail : `Benchmark call failed for "${testCase.question}"`);
        }

        const elapsed = performance.now() - startedAt;
        const sources = Array.isArray(payload.sources) ? payload.sources as RAGSource[] : [];
        const sourceTitles = sourceTitlesFromResponse(sources);
        const expectedSources = (testCase.expected_source_documents || []).map(normalize);
        const matchedSources = expectedSources.filter((title) => sourceTitles.includes(title)).length;
        const precisionAtK = sourceTitles.length > 0 && expectedSources.length > 0 ? matchedSources / sourceTitles.length : null;
        const recallAtK = expectedSources.length > 0 ? matchedSources / expectedSources.length : null;
        const expectedAnswer = testCase.expected_answer ? normalize(testCase.expected_answer) : '';
        const answer = payload.content || '';
        const answerMatch = expectedAnswer ? (normalize(answer).includes(expectedAnswer) ? 1 : 0) : null;

        results.push({
          question: testCase.question,
          answer,
          latencyMs: elapsed,
          sourceTitles: sources.map((source) => source.resource_title || source.resource_id || 'Unknown source'),
          sourceCount: sources.length,
          matchedSources,
          precisionAtK,
          recallAtK,
          hitRate: matchedSources > 0 ? 1 : 0,
          answerMatch,
          confidence: typeof payload.confidence === 'number' ? payload.confidence : null,
        });
      }

      const run: BenchmarkRun = {
        id: `bench-${Date.now()}`,
        createdAt: new Date().toISOString(),
        datasetName: parsedDataset.name || datasetName,
        caseCount: results.length,
        summary: {
          avgLatencyMs: average(results.map((item) => item.latencyMs)) || 0,
          avgPrecisionAtK: average(results.map((item) => item.precisionAtK)),
          avgRecallAtK: average(results.map((item) => item.recallAtK)),
          hitRate: average(results.map((item) => item.hitRate)) || 0,
          answerMatchRate: average(results.map((item) => item.answerMatch)),
          avgConfidence: average(results.map((item) => item.confidence)),
        },
        results,
      };

      const nextHistory = [run, ...history].slice(0, 20);
      setHistory(nextHistory);
      saveHistory(nextHistory);
      setSelectedRunIdA(run.id);
      if (!selectedRunIdB) setSelectedRunIdB(run.id);
    } catch (runError: any) {
      setError(runError.message || 'Benchmark run failed.');
    } finally {
      setIsRunning(false);
    }
  };

  const exportRun = (run: BenchmarkRun, format: 'json' | 'csv' | 'md' | 'html') => {
    if (format === 'json') {
      exportBlob(`${run.datasetName}-${run.id}.json`, JSON.stringify(run, null, 2), 'application/json');
      return;
    }

    if (format === 'csv') {
      const header = ['question', 'latency_ms', 'source_count', 'matched_sources', 'precision_at_k', 'recall_at_k', 'hit_rate', 'answer_match', 'confidence'];
      const rows = run.results.map((result) => [
        JSON.stringify(result.question),
        result.latencyMs.toFixed(1),
        result.sourceCount,
        result.matchedSources,
        result.precisionAtK ?? '',
        result.recallAtK ?? '',
        result.hitRate,
        result.answerMatch ?? '',
        result.confidence ?? '',
      ].join(','));
      exportBlob(`${run.datasetName}-${run.id}.csv`, [header.join(','), ...rows].join('\n'), 'text/csv');
      return;
    }

    if (format === 'md') {
      const md = [
        `# ${run.datasetName}`,
        '',
        `- Run ID: ${run.id}`,
        `- Created: ${new Date(run.createdAt).toLocaleString()}`,
        `- Cases: ${run.caseCount}`,
        '',
        '## Summary',
        '',
        `- Avg latency: ${run.summary.avgLatencyMs.toFixed(1)} ms`,
        `- Avg precision@K: ${run.summary.avgPrecisionAtK?.toFixed(2) ?? 'n/a'}`,
        `- Avg recall@K: ${run.summary.avgRecallAtK?.toFixed(2) ?? 'n/a'}`,
        `- Hit rate: ${(run.summary.hitRate * 100).toFixed(1)}%`,
        `- Answer match: ${run.summary.answerMatchRate != null ? `${(run.summary.answerMatchRate * 100).toFixed(1)}%` : 'n/a'}`,
        `- Avg confidence: ${run.summary.avgConfidence?.toFixed(2) ?? 'n/a'}`,
      ].join('\n');
      exportBlob(`${run.datasetName}-${run.id}.md`, md, 'text/markdown');
      return;
    }

    const html = `<!doctype html><html><head><meta charset="utf-8" /><title>${run.datasetName}</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#111827}table{border-collapse:collapse;width:100%;margin-top:16px}th,td{border:1px solid #e5e7eb;padding:8px;text-align:left}th{background:#f8fafc}</style></head><body><h1>${run.datasetName}</h1><p>Run ID: ${run.id}</p><p>Created: ${new Date(run.createdAt).toLocaleString()}</p><table><thead><tr><th>Question</th><th>Latency</th><th>Sources</th><th>Matched</th><th>Precision@K</th><th>Recall@K</th></tr></thead><tbody>${run.results.map((result) => `<tr><td>${result.question}</td><td>${result.latencyMs.toFixed(1)} ms</td><td>${result.sourceCount}</td><td>${result.matchedSources}</td><td>${result.precisionAtK?.toFixed(2) ?? 'n/a'}</td><td>${result.recallAtK?.toFixed(2) ?? 'n/a'}</td></tr>`).join('')}</tbody></table></body></html>`;
    exportBlob(`${run.datasetName}-${run.id}.html`, html, 'text/html');
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/50 bg-white/60 p-6 dark:border-white/10 dark:bg-slate-800/40">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Evaluation Workbench</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Run benchmark datasets against the current backend without changing normal chat behavior.
            </p>
          </div>
          <button
            type="button"
            onClick={runBenchmark}
            disabled={isRunning}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isRunning ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
            Run benchmark
          </button>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[220px_1fr]">
          <div className="space-y-3">
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Dataset name
            </label>
            <input
              value={datasetName}
              onChange={(event) => setDatasetName(event.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-indigo-300 dark:border-white/10 dark:bg-slate-900 dark:text-slate-200"
            />
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              <Upload size={14} />
              <span>Load JSON/YAML file</span>
              <input
                type="file"
                accept=".json,.yaml,.yml"
                className="hidden"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  setDatasetText(await file.text());
                  if (!datasetName || datasetName === 'Frontend Benchmark') {
                    setDatasetName(file.name.replace(/\.(json|yaml|yml)$/i, ''));
                  }
                }}
              />
            </label>
            <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-gray-500 dark:bg-slate-900/60 dark:text-gray-400">
              Parsed cases: <span className="font-semibold text-gray-700 dark:text-white">{parsedDataset.cases.length}</span>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Benchmark dataset
            </label>
            <textarea
              value={datasetText}
              onChange={(event) => setDatasetText(event.target.value)}
              placeholder={`name: Regression Suite\ncases:\n  - question: What is RAG?\n    expected_answer: Retrieval augmented generation\n    expected_source_documents:\n      - handbook.pdf`}
              className="min-h-[220px] w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 font-mono text-xs text-gray-700 outline-none focus:border-indigo-300 dark:border-white/10 dark:bg-slate-900 dark:text-slate-200"
            />
          </div>
        </div>

        {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
      </div>

      {latestRun && (
        <div className="rounded-2xl border border-white/50 bg-white/60 p-6 dark:border-white/10 dark:bg-slate-800/40">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">Latest benchmark run</h3>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {latestRun.datasetName} • {latestRun.caseCount} cases • {new Date(latestRun.createdAt).toLocaleString()}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => exportRun(latestRun, 'json')} className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600 hover:border-gray-300 dark:border-white/10 dark:bg-slate-900 dark:text-slate-200"><Download size={12} /> JSON</button>
              <button type="button" onClick={() => exportRun(latestRun, 'csv')} className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600 hover:border-gray-300 dark:border-white/10 dark:bg-slate-900 dark:text-slate-200"><FileDown size={12} /> CSV</button>
              <button type="button" onClick={() => exportRun(latestRun, 'md')} className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600 hover:border-gray-300 dark:border-white/10 dark:bg-slate-900 dark:text-slate-200"><FileDown size={12} /> Markdown</button>
              <button type="button" onClick={() => exportRun(latestRun, 'html')} className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600 hover:border-gray-300 dark:border-white/10 dark:bg-slate-900 dark:text-slate-200"><FileDown size={12} /> HTML</button>
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-3 xl:grid-cols-6">
            <SummaryCard label="Avg latency" value={`${latestRun.summary.avgLatencyMs.toFixed(1)} ms`} />
            <SummaryCard label="Precision@K" value={latestRun.summary.avgPrecisionAtK?.toFixed(2) ?? 'n/a'} />
            <SummaryCard label="Recall@K" value={latestRun.summary.avgRecallAtK?.toFixed(2) ?? 'n/a'} />
            <SummaryCard label="Hit rate" value={`${(latestRun.summary.hitRate * 100).toFixed(1)}%`} />
            <SummaryCard label="Answer match" value={latestRun.summary.answerMatchRate != null ? `${(latestRun.summary.answerMatchRate * 100).toFixed(1)}%` : 'n/a'} />
            <SummaryCard label="Avg confidence" value={latestRun.summary.avgConfidence?.toFixed(2) ?? 'n/a'} />
          </div>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-white/50 bg-white/60 p-6 dark:border-white/10 dark:bg-slate-800/40">
          <div className="flex items-center gap-2">
            <FlaskConical size={16} className="text-indigo-500" />
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">Benchmark history</h3>
          </div>
          {history.length === 0 ? (
            <p className="mt-4 text-sm text-gray-400">No benchmark runs yet. Run a dataset to start tracking history.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {history.map((run) => (
                <div key={run.id} className="rounded-xl border border-gray-100 bg-white px-4 py-3 dark:border-white/10 dark:bg-slate-900/60">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-gray-800 dark:text-white">{run.datasetName}</div>
                      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{new Date(run.createdAt).toLocaleString()} • {run.caseCount} cases</div>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setSelectedRunIdA(run.id)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${selectedRunIdA === run.id ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-gray-600 dark:bg-slate-800 dark:text-slate-200'}`}>Compare A</button>
                      <button type="button" onClick={() => setSelectedRunIdB(run.id)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${selectedRunIdB === run.id ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-gray-600 dark:bg-slate-800 dark:text-slate-200'}`}>Compare B</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-white/50 bg-white/60 p-6 dark:border-white/10 dark:bg-slate-800/40">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">Run comparison</h3>
          {!comparison || !runA || !runB ? (
            <p className="mt-4 text-sm text-gray-400">Choose two runs from history to compare regressions and improvements.</p>
          ) : (
            <div className="mt-4 space-y-3 text-sm">
              <ComparisonRow label="Latency change" value={`${comparison.latencyDelta.toFixed(1)} ms`} positive={comparison.latencyDelta < 0} />
              <ComparisonRow label="Precision@K change" value={comparison.precisionDelta.toFixed(2)} positive={comparison.precisionDelta >= 0} />
              <ComparisonRow label="Recall@K change" value={comparison.recallDelta.toFixed(2)} positive={comparison.recallDelta >= 0} />
              <ComparisonRow label="Hit rate change" value={`${(comparison.hitRateDelta * 100).toFixed(1)}%`} positive={comparison.hitRateDelta >= 0} />
              <ComparisonRow label="Answer match change" value={`${(comparison.answerMatchDelta * 100).toFixed(1)}%`} positive={comparison.answerMatchDelta >= 0} />
              <ComparisonRow label="Confidence change" value={comparison.confidenceDelta.toFixed(2)} positive={comparison.confidenceDelta >= 0} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white px-4 py-3 dark:border-white/10 dark:bg-slate-900/60">
      <div className="text-xs font-bold uppercase tracking-wider text-gray-400">{label}</div>
      <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">{value}</div>
    </div>
  );
}

function ComparisonRow({ label, value, positive }: { label: string; value: string; positive: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-gray-100 bg-white px-4 py-3 dark:border-white/10 dark:bg-slate-900/60">
      <span className="text-gray-600 dark:text-gray-300">{label}</span>
      <span className={positive ? 'font-semibold text-emerald-600' : 'font-semibold text-rose-500'}>{value}</span>
    </div>
  );
}
