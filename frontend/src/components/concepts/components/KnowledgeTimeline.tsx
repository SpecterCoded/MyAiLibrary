import { ChevronDown, Clock3, Play, Sparkles } from "lucide-react";
import type { GraphLink, GraphNode } from "../types";

interface KnowledgeTimelineProps {
  open: boolean;
  nodes: GraphNode[];
  links: GraphLink[];
  selectedNodeId: string | null;
  onToggle: () => void;
  onSelectNode: (nodeId: string) => void;
}

export default function KnowledgeTimeline({
  open,
  nodes,
  links,
  selectedNodeId,
  onToggle,
  onSelectNode,
}: KnowledgeTimelineProps) {
  const sequence = nodes.filter((node) => node.type === "concept").slice(0, 8);

  return (
    <section className={`kw-timeline ${open ? "is-open" : ""}`}>
      <button type="button" className="kw-timeline-toggle" onClick={onToggle}>
        <span><Clock3 size={14} /><strong>Learning timeline</strong><small>{sequence.length} concepts in current path</small></span>
        <span><Sparkles size={13} /> Teaching order <ChevronDown size={15} /></span>
      </button>
      {open && (
        <div className="kw-timeline-track">
          {sequence.length === 0 ? (
            <div className="kw-timeline-empty">Concept milestones will appear as your knowledge graph grows.</div>
          ) : sequence.map((node, index) => (
            <button type="button" key={node.id} className={selectedNodeId === node.id ? "is-active" : ""} onClick={() => onSelectNode(node.id)}>
              <i>{String(index + 1).padStart(2, "0")}</i>
              <span><Play size={10} fill="currentColor" /> Stage {index + 1}</span>
              <strong>{node.title}</strong>
              <small>{links.filter((link) => {
                const source = typeof link.source === "object" ? link.source.id : link.source;
                const target = typeof link.target === "object" ? link.target.id : link.target;
                return source === node.id || target === node.id;
              }).length} relationships</small>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

