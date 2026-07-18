import { forwardRef } from "react";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  Download,
  Filter,
  Focus,
  ListTree,
  Minus,
  Plus,
  RotateCcw,
  Search,
  SplitSquareVertical,
} from "lucide-react";
import type { GraphLayout } from "./types";

interface KnowledgeToolbarProps {
  query: string;
  layout: GraphLayout;
  timelineOpen: boolean;
  explorerOpen: boolean;
  filterCount: number;
  onQueryChange: (query: string) => void;
  onLayoutChange: (layout: GraphLayout) => void;
  onToggleFilters: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onReset: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onToggleTimeline: () => void;
  onToggleExplorer: () => void;
  onExport: () => void;
}

const KnowledgeToolbar = forwardRef<HTMLInputElement, KnowledgeToolbarProps>(function KnowledgeToolbar(props, ref) {
  return (
    <nav className="kx-toolbar" aria-label="Knowledge graph tools">
      <label className="kx-search">
        <Search size={15} />
        <input ref={ref} value={props.query} onChange={(event) => props.onQueryChange(event.target.value)} placeholder="Search concepts, aliases, chapters..." aria-label="Search knowledge" />
        <kbd>Ctrl K</kbd>
      </label>
      <div className="kx-toolbar-group">
        <button type="button" className={`kx-tool ${props.filterCount ? "is-active" : ""}`} onClick={props.onToggleFilters}><Filter size={15} /><span>Filters</span>{props.filterCount > 0 && <b>{props.filterCount}</b>}</button>
        <label className="kx-layout-select"><ListTree size={15} /><select value={props.layout} onChange={(event) => props.onLayoutChange(event.target.value as GraphLayout)} aria-label="Graph layout"><option value="organic">Organic layout</option><option value="radial">Radial layout</option><option value="learning">Learning path</option></select></label>
      </div>
      <div className="kx-toolbar-group" aria-label="Zoom controls">
        <button type="button" className="kx-tool is-icon" onClick={props.onZoomOut} aria-label="Zoom out"><Minus size={15} /></button>
        <button type="button" className="kx-tool is-icon" onClick={props.onZoomIn} aria-label="Zoom in"><Plus size={15} /></button>
        <button type="button" className="kx-tool is-icon" onClick={props.onFit} aria-label="Fit graph to screen"><Focus size={15} /></button>
        <button type="button" className="kx-tool is-icon" onClick={props.onReset} aria-label="Reset camera"><RotateCcw size={15} /></button>
      </div>
      <div className="kx-toolbar-group kx-toolbar-overflow">
        <button type="button" className="kx-tool" onClick={props.onExpandAll}><ChevronsUpDown size={15} /><span>Expand</span></button>
        <button type="button" className="kx-tool" onClick={props.onCollapseAll}><ChevronsDownUp size={15} /><span>Collapse</span></button>
        <button type="button" className={`kx-tool ${props.timelineOpen ? "is-active" : ""}`} onClick={props.onToggleTimeline}><SplitSquareVertical size={15} /><span>Timeline</span></button>
        <button type="button" className={`kx-tool ${props.explorerOpen ? "is-active" : ""}`} onClick={props.onToggleExplorer}><ListTree size={15} /><span>Explorer</span></button>
        <button type="button" className="kx-tool is-icon" onClick={props.onExport} aria-label="Export knowledge"><Download size={15} /></button>
      </div>
    </nav>
  );
});

export default KnowledgeToolbar;
