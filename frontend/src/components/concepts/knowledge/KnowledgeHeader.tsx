import { BrainCircuit, Download, Maximize2, RefreshCw, Search, Sparkles } from "lucide-react";

interface KnowledgeHeaderProps {
  eyebrow: string;
  title: string;
  subtitle: string;
  generatedAt: string;
  onRegenerate: () => void;
  onExport: () => void;
  onFullscreen: () => void;
  onFocusSearch: () => void;
}

export default function KnowledgeHeader({
  eyebrow,
  title,
  subtitle,
  generatedAt,
  onRegenerate,
  onExport,
  onFullscreen,
  onFocusSearch,
}: KnowledgeHeaderProps) {
  return (
    <header className="kx-header">
      <div className="kx-title-block">
        <span className="kx-brand-orb" aria-hidden="true"><BrainCircuit size={24} /></span>
        <div>
          <span className="kx-eyebrow"><Sparkles size={12} /> {eyebrow}</span>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
      </div>
      <div className="kx-header-meta">
        <span><i /> Generated {generatedAt}</span>
        <div className="kx-header-actions">
          <button type="button" className="kx-button kx-button-primary" onClick={onRegenerate}>
            <RefreshCw size={15} /> <span>Regenerate</span>
          </button>
          <button type="button" className="kx-button" onClick={onExport}><Download size={15} /><span>Export</span></button>
          <button type="button" className="kx-icon-button" onClick={onFullscreen} aria-label="Toggle fullscreen"><Maximize2 size={16} /></button>
          <button type="button" className="kx-icon-button" onClick={onFocusSearch} aria-label="Search concepts"><Search size={16} /></button>
        </div>
      </div>
    </header>
  );
}
