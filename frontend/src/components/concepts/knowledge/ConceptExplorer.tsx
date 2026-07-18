import { ChevronDown, MoreHorizontal, Pin, Search, Star, TableProperties } from "lucide-react";
import type { ExplorerSort, KnowledgeConcept, KnowledgeRelationship } from "./types";

interface ConceptExplorerProps {
  open: boolean;
  concepts: KnowledgeConcept[];
  relationships: KnowledgeRelationship[];
  selectedId: string | null;
  query: string;
  sort: ExplorerSort;
  onToggle: () => void;
  onSelect: (id: string) => void;
  onQueryChange: (query: string) => void;
  onSortChange: (sort: ExplorerSort) => void;
  onToggleFavorite: (id: string) => void;
  onTogglePinned: (id: string) => void;
  onAction: (label: string) => void;
}

export default function ConceptExplorer(props: ConceptExplorerProps) {
  const relationCount = (id: string) => props.relationships.filter((item) => item.source === id || item.target === id).length;
  return (
    <section className={`kx-section kx-explorer ${props.open ? "is-open" : "is-collapsed"}`} aria-labelledby="kx-explorer-title">
      <button type="button" className="kx-section-heading" onClick={props.onToggle} aria-expanded={props.open}>
        <span className="kx-section-icon"><TableProperties size={17} /></span>
        <span><strong id="kx-explorer-title">Concept explorer</strong><small>Search, compare, sort, and organize extracted ideas</small></span>
        <span className="kx-section-count">{props.concepts.length} concepts</span>
        <ChevronDown className="kx-chevron" size={17} />
      </button>
      {props.open && (
        <>
          <div className="kx-explorer-toolbar">
            <label><Search size={14} /><input value={props.query} onChange={(event) => props.onQueryChange(event.target.value)} placeholder="Filter explorer..." aria-label="Filter concept explorer" /></label>
            <select value={props.sort} onChange={(event) => props.onSortChange(event.target.value as ExplorerSort)} aria-label="Sort concepts">
              <option value="teaching-order">Teaching order</option><option value="confidence">Highest confidence</option><option value="frequency">Most frequent</option><option value="importance">Most important</option><option value="alphabetical">Alphabetical</option>
            </select>
            <button type="button" className="kx-button" onClick={() => props.onAction("Grouping controls are ready for backend data.")}>Group by chapter</button>
          </div>
          <div className="kx-table-wrap" tabIndex={0}>
            <table>
              <thead><tr><th>Concept</th><th>Confidence</th><th>Difficulty</th><th>Frequency</th><th>Chapter</th><th>First</th><th>Last</th><th>Aliases</th><th>Links</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {props.concepts.map((item) => (
                  <tr key={item.id} className={props.selectedId === item.id ? "is-selected" : ""} onClick={() => props.onSelect(item.id)}>
                    <td><button type="button" className="kx-concept-name" onClick={() => props.onSelect(item.id)}><i className={`is-${item.kind}`} /> <span><strong>{item.title}</strong><small>{item.kind}</small></span></button></td>
                    <td><span className="kx-confidence"><i style={{ width: `${item.confidence}%` }} />{item.confidence}%</span></td>
                    <td><span className={`kx-difficulty is-${item.difficulty.toLowerCase()}`}>{item.difficulty}</span></td>
                    <td>{item.mentions} mentions</td><td>{item.chapter.replace(/^\d+ - /, "")}</td><td>{item.firstMention}</td><td>{item.lastMention}</td>
                    <td><span className="kx-aliases">{item.aliases.slice(0, 2).join(", ")}</span></td><td>{relationCount(item.id)}</td>
                    <td><div className="kx-row-actions">
                      <button type="button" className={item.favorite ? "is-active" : ""} onClick={(event) => { event.stopPropagation(); props.onToggleFavorite(item.id); }} aria-label={item.favorite ? "Remove favorite" : "Add favorite"}><Star size={14} fill={item.favorite ? "currentColor" : "none"} /></button>
                      <button type="button" className={item.pinned ? "is-active" : ""} onClick={(event) => { event.stopPropagation(); props.onTogglePinned(item.id); }} aria-label={item.pinned ? "Unpin concept" : "Pin concept"}><Pin size={14} fill={item.pinned ? "currentColor" : "none"} /></button>
                      <button type="button" onClick={(event) => { event.stopPropagation(); props.onAction(`Actions for ${item.title} are ready.`); }} aria-label={`More actions for ${item.title}`}><MoreHorizontal size={15} /></button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
