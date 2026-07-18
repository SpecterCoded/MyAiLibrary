import { ChevronDown, Clock3, Play, Route } from "lucide-react";
import type { KnowledgeConcept, LearningTimelineItem } from "./types";

interface KnowledgeTimelineProps {
  open: boolean;
  items: LearningTimelineItem[];
  concepts: KnowledgeConcept[];
  selectedId: string | null;
  onToggle: () => void;
  onSelect: (id: string) => void;
}

export default function KnowledgeTimeline({ open, items, concepts, selectedId, onToggle, onSelect }: KnowledgeTimelineProps) {
  const conceptsById = new Map(concepts.map((item) => [item.id, item]));
  return (
    <section className={`kx-section kx-timeline ${open ? "is-open" : "is-collapsed"}`} aria-labelledby="kx-timeline-title">
      <button type="button" className="kx-section-heading" onClick={onToggle} aria-expanded={open}>
        <span className="kx-section-icon"><Route size={17} /></span>
        <span><strong id="kx-timeline-title">Learning timeline</strong><small>Concepts in teaching order</small></span>
        <span className="kx-section-count">{items.length} stages</span>
        <ChevronDown className="kx-chevron" size={17} />
      </button>
      {open && (
        <div className="kx-timeline-scroll" tabIndex={0} aria-label="Horizontal learning timeline">
          <div className="kx-timeline-line" />
          {items.map((item, index) => {
            const concept = conceptsById.get(item.conceptId);
            if (!concept) return null;
            return (
              <button key={item.id} type="button" className={`kx-timeline-card ${selectedId === item.conceptId ? "is-selected" : ""}`} onClick={() => onSelect(item.conceptId)}>
                <i>{String(index + 1).padStart(2, "0")}</i>
                <span className="kx-timeline-dot" />
                <span className="kx-timeline-time"><Play size={10} fill="currentColor" /> {item.timestamp}</span>
                <strong>{concept.title}</strong>
                <small>{item.chapter}</small>
                <div><span>{item.confidence}% confidence</span><span>{item.difficulty}</span></div>
                <em><Clock3 size={10} /> {item.stage}</em>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
