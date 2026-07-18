import { RotateCcw, SlidersHorizontal, X } from "lucide-react";
import type { ConceptKind, Difficulty, KnowledgeFiltersState, RelationshipType } from "./types";

interface KnowledgeFiltersProps {
  open: boolean;
  filters: KnowledgeFiltersState;
  chapters: string[];
  onChange: (filters: KnowledgeFiltersState) => void;
  onClose: () => void;
  onReset: () => void;
}

const update = <K extends keyof KnowledgeFiltersState>(
  filters: KnowledgeFiltersState,
  key: K,
  value: KnowledgeFiltersState[K],
) => ({ ...filters, [key]: value });

export default function KnowledgeFilters({ open, filters, chapters, onChange, onClose, onReset }: KnowledgeFiltersProps) {
  if (!open) return null;
  return (
    <section className="kx-filters" aria-label="Knowledge filters">
      <div className="kx-filters-heading"><SlidersHorizontal size={15} /><strong>Filters</strong><span>Refine the entire explorer</span></div>
      <label>Confidence
        <select value={filters.confidence} onChange={(event) => onChange(update(filters, "confidence", event.target.value as KnowledgeFiltersState["confidence"]))}>
          <option value="all">All confidence</option><option value="80+">80-100%</option><option value="90+">90-100%</option>
        </select>
      </label>
      <label>Difficulty
        <select value={filters.difficulty} onChange={(event) => onChange(update(filters, "difficulty", event.target.value as "all" | Difficulty))}>
          <option value="all">All levels</option><option>Beginner</option><option>Intermediate</option><option>Advanced</option>
        </select>
      </label>
      <label>Chapter
        <select value={filters.chapter} onChange={(event) => onChange(update(filters, "chapter", event.target.value))}>
          <option value="all">All chapters</option>{chapters.map((chapter) => <option key={chapter}>{chapter}</option>)}
        </select>
      </label>
      <label>Concept type
        <select value={filters.kind} onChange={(event) => onChange(update(filters, "kind", event.target.value as "all" | ConceptKind))}>
          <option value="all">All types</option><option value="concept">Concept</option><option value="definition">Definition</option><option value="example">Example</option><option value="warning">Warning</option><option value="advanced">Advanced</option><option value="chapter">Chapter</option>
        </select>
      </label>
      <label>Relationship
        <select value={filters.relationship} onChange={(event) => onChange(update(filters, "relationship", event.target.value as "all" | RelationshipType))}>
          <option value="all">All relationships</option><option>Introduces</option><option>Depends On</option><option>Explains</option><option>Related To</option><option>Uses</option><option>Builds On</option><option>Requires</option><option>Contrasts With</option><option>Supports</option><option>Causes</option>
        </select>
      </label>
      <label>Importance
        <select value={filters.importance} onChange={(event) => onChange(update(filters, "importance", event.target.value as "all" | "high"))}>
          <option value="all">Any importance</option><option value="high">High importance</option>
        </select>
      </label>
      <label className="kx-check"><input type="checkbox" checked={filters.favoritesOnly} onChange={(event) => onChange(update(filters, "favoritesOnly", event.target.checked))} /> Favorites only</label>
      <button type="button" className="kx-text-button" onClick={onReset}><RotateCcw size={13} /> Reset</button>
      <button type="button" className="kx-icon-button kx-filter-close" onClick={onClose} aria-label="Close filters"><X size={15} /></button>
    </section>
  );
}
