import {
  Bookmark,
  BrainCircuit,
  Clock3,
  Copy,
  FileText,
  Layers3,
  MessageCircle,
  Play,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import type { KnowledgeConcept, KnowledgeRelationship } from "./types";

interface ConceptDrawerProps {
  concept: KnowledgeConcept | null;
  concepts: KnowledgeConcept[];
  relationships: KnowledgeRelationship[];
  width: number;
  onClose: () => void;
  onSelect: (id: string) => void;
  onResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
  onAction: (action: string, concept: KnowledgeConcept) => void;
}

export default function ConceptDrawer({ concept, concepts, relationships, width, onClose, onSelect, onResizeStart, onAction }: ConceptDrawerProps) {
  if (!concept) return null;
  const connected = relationships
    .filter((item) => item.source === concept.id || item.target === concept.id)
    .map((item) => ({ relationship: item, concept: concepts.find((candidate) => candidate.id === (item.source === concept.id ? item.target : item.source)) }))
    .filter((item) => item.concept);
  return (
    <aside className="kx-drawer" style={{ width }} aria-label={`Details for ${concept.title}`}>
      <div className="kx-drawer-resize" onPointerDown={onResizeStart} role="separator" aria-orientation="vertical" aria-label="Resize concept drawer" />
      <header>
        <div><span className={`kx-kind-badge is-${concept.kind}`}><Sparkles size={11} /> {concept.kind}</span><span>{concept.confidence}% confidence</span></div>
        <button type="button" className="kx-icon-button" onClick={onClose} aria-label="Close concept details"><X size={16} /></button>
        <h2>{concept.title}</h2>
        <p>{concept.summary}</p>
      </header>
      <div className="kx-drawer-scroll">
        <section className="kx-insight-card">
          <span><BrainCircuit size={15} /> Definition</span>
          <p>{concept.definition}</p>
        </section>
        <div className="kx-detail-grid">
          <div><span>Difficulty</span><strong>{concept.difficulty}</strong></div><div><span>Importance</span><strong>{concept.importance}/100</strong></div>
          <div><span>Learning stage</span><strong>{concept.learningStage}</strong></div><div><span>Study time</span><strong>{concept.studyMinutes} min</strong></div>
          <div><span>First mention</span><strong>{concept.firstMention}</strong></div><div><span>Last mention</span><strong>{concept.lastMention}</strong></div>
          <div><span>Mentions</span><strong>{concept.mentions}</strong></div><div><span>Chapter</span><strong>{concept.chapter.replace(/^\d+ - /, "")}</strong></div>
        </div>
        <section className="kx-drawer-section">
          <h3><Layers3 size={14} /> Prerequisites</h3>
          <div className="kx-chip-list">{concept.prerequisites.length ? concept.prerequisites.map((item) => <span key={item}>{item}</span>) : <small>No prerequisites. Start here.</small>}</div>
        </section>
        <section className="kx-drawer-section">
          <h3><Sparkles size={14} /> Aliases</h3>
          <div className="kx-chip-list">{concept.aliases.map((item) => <span key={item}>{item}</span>)}</div>
        </section>
        <section className="kx-drawer-section">
          <h3><BrainCircuit size={14} /> Related concepts</h3>
          <div className="kx-related-list">{connected.map(({ relationship, concept: related }) => related && (
            <button type="button" key={relationship.id} onClick={() => onSelect(related.id)}><span><i className={`is-${related.kind}`} /><strong>{related.title}</strong></span><small>{relationship.type}</small></button>
          ))}</div>
        </section>
      </div>
      <footer>
        <button type="button" className="kx-drawer-primary" onClick={() => onAction("jump", concept)}><Play size={14} fill="currentColor" /> Jump to video</button>
        <div>
          <button type="button" onClick={() => onAction("transcript", concept)}><FileText size={14} /> Transcript</button>
          <button type="button" onClick={() => onAction("ask", concept)}><MessageCircle size={14} /> Ask AI</button>
          <button type="button" onClick={() => onAction("flashcards", concept)}><Layers3 size={14} /> Flashcards</button>
          <button type="button" onClick={() => onAction("quiz", concept)}><BrainCircuit size={14} /> Quiz</button>
          <button type="button" onClick={() => onAction("copy", concept)}><Copy size={14} /> Copy</button>
          <button type="button" onClick={() => onAction("notebook", concept)}><Clock3 size={14} /> Notebook</button>
          <button type="button" onClick={() => onAction("bookmark", concept)}><Bookmark size={14} /> Bookmark</button>
          <button type="button" onClick={() => onAction("favorite", concept)}><Star size={14} /> Favorite</button>
        </div>
      </footer>
    </aside>
  );
}
