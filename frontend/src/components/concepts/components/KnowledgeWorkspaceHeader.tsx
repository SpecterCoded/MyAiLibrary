import {
  BrainCircuit,
  Filter,
  LayoutTemplate,
  Maximize2,
  RefreshCw,
  Search,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";

interface KnowledgeWorkspaceHeaderProps {
  concepts: number;
  relationships: number;
  resources: number;
  searchQuery: string;
  focusResourceId: string | null;
  sidebarOpen: boolean;
  onOpenSidebar: () => void;
  onSearchChange: (value: string) => void;
  onClearFocus: () => void;
  onFilters: () => void;
  onAiAction: () => void;
  onRefresh: () => void;
}

export default function KnowledgeWorkspaceHeader({
  concepts,
  relationships,
  resources,
  searchQuery,
  focusResourceId,
  sidebarOpen,
  onOpenSidebar,
  onSearchChange,
  onClearFocus,
  onFilters,
  onAiAction,
  onRefresh,
}: KnowledgeWorkspaceHeaderProps) {
  const toggleFullscreen = () => {
    const workspace = document.getElementById("app-viewport-root");
    if (!workspace) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    void workspace.requestFullscreen();
  };

  return (
    <header className="kw-header" id="app-header-nav">
      <div className="kw-header-title">
        {!sidebarOpen && (
          <button type="button" className="kw-icon-button" onClick={onOpenSidebar} title="Open sidebar">
            <LayoutTemplate size={17} />
          </button>
        )}
        <span className="kw-brand-mark"><BrainCircuit size={20} /></span>
        <div>
          <span className="kw-kicker"><Sparkles size={11} /> Library intelligence</span>
          <h1>Knowledge Workspace</h1>
        </div>
        {focusResourceId && (
          <button type="button" className="kw-focus-chip" onClick={onClearFocus} title="Clear resource focus">
            Resource focus <span>{focusResourceId.slice(0, 8)}</span><X size={12} />
          </button>
        )}
      </div>

      <div className="kw-header-metrics" aria-label="Workspace statistics">
        <div><strong>{concepts}</strong><span>Concepts</span></div>
        <div><strong>{relationships}</strong><span>Relationships</span></div>
        <div><strong>{resources}</strong><span>Resources</span></div>
      </div>

      <div className="kw-header-actions">
        <label className="kw-global-search">
          <Search size={15} />
          <input
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search all knowledge..."
            aria-label="Search concepts and resources"
          />
          <kbd>Ctrl K</kbd>
        </label>
        <button type="button" className="kw-action-button" onClick={onFilters}><Filter size={15} /><span>Filters</span></button>
        <button type="button" className="kw-action-button is-ai" onClick={onAiAction}><WandSparkles size={15} /><span>AI actions</span></button>
        <button type="button" className="kw-icon-button" onClick={toggleFullscreen} title="Toggle fullscreen"><Maximize2 size={16} /></button>
        <button type="button" className="kw-icon-button" onClick={onRefresh} title="Refresh workspace"><RefreshCw size={16} /></button>
      </div>
    </header>
  );
}

