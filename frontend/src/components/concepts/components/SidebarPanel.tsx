import React, { useState, useEffect } from "react";
import type { GraphNode, GraphLink, PhysicsConfig } from "../types";
import { CATEGORY_MAP } from "../types";
import {
  Plus,
  Search,
  Settings2,
  Sliders,
  Sparkles,
  Trash2,
  FileText,
  Link2,
  Compass,
  Check,
  Hash,
  Activity,
  X,
  LayoutTemplate,
  Clock3,
  Bookmark,
} from "lucide-react";

interface SidebarPanelProps {
  nodes: GraphNode[];
  links: GraphLink[];
  physics: PhysicsConfig;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  onAddNode: (node: GraphNode, linkTargetIds: string[]) => void;
  onDeleteNode: (nodeId: string) => void;
  onUpdatePhysics: (newPhysics: Partial<PhysicsConfig>) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  activeFilterType: string | null;
  onFilterTypeChange: (type: string | null) => void;
  viewTab: "concept" | "global";
  onViewTabChange: (tab: "concept" | "global") => void;
  onCollapse: () => void;
}

const PHYSICS_PRESETS = [
  {
    name: "Spacious Galaxy",
    icon: Sparkles,
    config: {
      chargeStrength: -220,
      linkDistance: 130,
      linkStrength: 0.25,
      collisionRadius: 28,
      gravity: 0.05,
      velocityDecay: 0.35,
    },
  },
  {
    name: "Tight Constellation",
    icon: Sliders,
    config: {
      chargeStrength: -80,
      linkDistance: 60,
      linkStrength: 0.6,
      collisionRadius: 15,
      gravity: 0.1,
      velocityDecay: 0.45,
    },
  },
  {
    name: "Atomic Core",
    icon: Activity,
    config: {
      chargeStrength: -40,
      linkDistance: 40,
      linkStrength: 0.8,
      collisionRadius: 10,
      gravity: 0.18,
      velocityDecay: 0.5,
    },
  },
];

export default function SidebarPanel({
  nodes,
  links,
  physics,
  selectedNodeId,
  onSelectNode,
  onAddNode,
  onDeleteNode,
  onUpdatePhysics,
  searchQuery,
  onSearchChange,
  activeFilterType,
  onFilterTypeChange,
  viewTab,
  onViewTabChange,
  onCollapse,
}: SidebarPanelProps) {
  // Tab control: "explore" | "create" | "physics"
  const [activeTab, setActiveTab] = useState<"explore" | "create" | "physics">("explore");

  // Sync viewTab with selectedNodeId
  useEffect(() => {
    if (selectedNodeId) {
      onViewTabChange("concept");
    }
  }, [selectedNodeId, onViewTabChange]);

  // Create Node Form state
  const [formTitle, setFormTitle] = useState("");
  const [formType, setFormType] = useState<GraphNode["type"]>("concept");
  const [formTags, setFormTags] = useState("");
  const [formContent, setFormContent] = useState("");
  const [formLinks, setFormLinks] = useState<string[]>([]);
  const [linkSearch, setLinkSearch] = useState("");

  const [formError, setFormError] = useState("");

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (!formTitle.trim()) {
      setFormError("Title is required");
      return;
    }

    const cleanId = formTitle.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const idExists = nodes.some((n) => n.id === cleanId);

    if (idExists) {
      setFormError("A note with this title name already exists");
      return;
    }

    // Process tags
    const tagsArr = formTags
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0);

    const defaultMdContent = `# ${formTitle.trim()}
A new sprout note inside your garden database. Create links or click edit to write rich markdown!`;

    const newNode: GraphNode = {
      id: cleanId,
      title: formTitle.trim(),
      type: formType,
      tags: tagsArr,
      content: formContent.trim() || defaultMdContent,
      updatedAt: new Date().toLocaleDateString(),
    };

    onAddNode(newNode, formLinks);

    // Reset Form
    setFormTitle("");
    setFormType("post");
    setFormTags("");
    setFormContent("");
    setFormLinks([]);
    setLinkSearch("");
    setActiveTab("explore");
  };

  const handleToggleFormLink = (nid: string) => {
    setFormLinks((prev) =>
      prev.includes(nid) ? prev.filter((id) => id !== nid) : [...prev, nid]
    );
  };

  const displayNodes = nodes.filter((node) => {
    const matchesType = !activeFilterType || node.type === activeFilterType;
    const matchesSearch =
      node.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      node.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (node.tags && node.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase())));
    return matchesType && matchesSearch;
  });

  return (
    <div
      id="sidebar-panel-container"
      className="flex flex-col h-full bg-[#f7f7f5] border-r border-[#e9e9e7] overflow-hidden w-full md:max-w-[280px] lg:max-w-[300px] relative z-10 text-[#37352f]"
    >
      {/* Sidebar header */}
      <div className="p-2 flex items-center justify-between hover:bg-[#efefed] transition-colors cursor-pointer group mx-2 mt-3 rounded">
        <div className="flex items-center gap-2 text-[#37352f]">
          <div className="bg-white border border-[#e9e9e7] w-5 h-5 rounded shadow-[0_1px_2px_rgba(0,0,0,0.05)] flex items-center justify-center">
            <Compass className="w-3.5 h-3.5 text-[#37352f]" />
          </div>
          <span className="font-sans font-medium text-[14px] truncate">
            Knowledge Workspace
          </span>
        </div>
        <div
          className="flex items-center justify-center opacity-50 hover:opacity-100 cursor-pointer transition-opacity text-[#9A9A97] hover:text-[#37352F] p-1.5 rounded hover:bg-[#e8e8e6]"
          onClick={(e) => {
            e.stopPropagation();
            onCollapse();
          }}
          title="Close sidebar"
        >
          <LayoutTemplate className="w-4 h-4" />
        </div>
      </div>

      {/* Tabs list navigation */}
      <div className="flex flex-col px-2 mt-2 gap-0.5">
        <div className="text-[11px] font-medium text-[#787774] px-2 py-1">
          Workspace
        </div>
        <button
          onClick={() => setActiveTab("explore")}
          className={`w-full flex items-center gap-2 py-1 px-2 text-[14px] rounded transition-all ${activeTab === "explore" ? "bg-[#efefed] font-medium" : "hover:bg-[#efefed]"
            }`}
        >
          <Search className="w-4 h-4 opacity-60" />
          Knowledge Map
        </button>
        <button
          onClick={() => setActiveTab("create")}
          className={`w-full flex items-center gap-2 py-1 px-2 text-[14px] rounded transition-all ${activeTab === "create" ? "bg-[#efefed] font-medium" : "hover:bg-[#efefed]"
            }`}
        >
          <Plus className="w-4 h-4 opacity-60" />
          New Concept
        </button>
        <button
          onClick={() => setActiveTab("physics")}
          className={`w-full flex items-center gap-2 py-1 px-2 text-[14px] rounded transition-all ${activeTab === "physics" ? "bg-[#efefed] font-medium" : "hover:bg-[#efefed]"
            }`}
        >
          <Settings2 className="w-4 h-4 opacity-60" />
          Layout & Physics
        </button>
        <div className="mt-3 text-[11px] font-medium text-[#787774] px-2 py-1">Library views</div>
        <button type="button" className="w-full flex items-center gap-2 py-1.5 px-2 text-[13px] rounded text-[#6f7b96] hover:bg-[#efefed]">
          <Clock3 className="w-4 h-4 opacity-60" /> Recent knowledge
        </button>
        <button type="button" className="w-full flex items-center gap-2 py-1.5 px-2 text-[13px] rounded text-[#6f7b96] hover:bg-[#efefed]">
          <Bookmark className="w-4 h-4 opacity-60" /> Saved views
        </button>
      </div>

      <div className="my-2" />

      {/* Main Tab Area panels */}
      <div className="flex-1 overflow-y-auto px-4 pb-5 space-y-6">
        {/* TAB 1: EXPLORE SYSTEM */}
        {activeTab === "explore" && (
          <div className="space-y-4" id="panel-explore">
            {/* Tabs for Global View / Concept View */}
            <div className="flex gap-2">
              <button
                onClick={() => onViewTabChange('concept')}
                className={`flex-1 py-1.5 text-[13px] rounded border ${viewTab === 'concept' ? 'border-[#e9e9e7] bg-[#efefed] font-medium text-[#37352f]' : 'border-transparent text-[#787774] hover:bg-[#efefed] transition-colors'}`}>
                Concept View
              </button>
              <button
                onClick={() => {
                  onViewTabChange('global');
                  onSelectNode(null);
                }}
                className={`flex-1 py-1.5 text-[13px] rounded border ${viewTab === 'global' ? 'border-[#e9e9e7] bg-[#efefed] font-medium text-[#37352f]' : 'border-transparent text-[#787774] hover:bg-[#efefed] transition-colors'}`}>
                Global View
              </button>
            </div>

            {viewTab === 'global' ? (
              <div className="py-12 flex flex-col items-center justify-center text-center space-y-2">
                <div className="w-10 h-10 rounded-full bg-[#efefed] flex items-center justify-center mb-2">
                  <Compass className="w-5 h-5 text-[#888]" />
                </div>
                <div className="text-[14px] text-[#37352f] font-medium">Global View</div>
                <div className="text-[13px] text-[#787774]">Displaying entire workspace. Nothing to show here right now.</div>
              </div>
            ) : (
              <>
                {/* Search Input Bar */}
                <div className="relative">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => onSearchChange(e.target.value)}
                    placeholder="Search index..."
                    className="w-full text-[13px] py-1.5 px-2 pl-9 rounded border border-[#e9e9e7] bg-white text-[#37352f] focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 transition-colors"
                    id="sidebar-search-input"
                  />
                  <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-[#787774]" />
                  {searchQuery && (
                    <button
                      onClick={() => onSearchChange("")}
                      className="absolute right-3 top-2.5 text-[#787774] hover:text-[#37352f]"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => onFilterTypeChange(null)} className={`px-2 py-1 rounded-full text-[9px] font-semibold border ${!activeFilterType ? "bg-blue-50 text-blue-700 border-blue-100" : "bg-white text-[#787774] border-[#e9e9e7]"}`}>All</button>
                  {["concept", "video", "audio", "pdf", "note"].map((type) => (
                    <button type="button" key={type} onClick={() => onFilterTypeChange(type)} className={`px-2 py-1 rounded-full text-[9px] font-semibold border capitalize ${activeFilterType === type ? "bg-blue-50 text-blue-700 border-blue-100" : "bg-white text-[#787774] border-[#e9e9e7]"}`}>{type}</button>
                  ))}
                </div>

                <div className="space-y-2">
                  <div className="text-[11px] font-medium text-[#787774] flex items-center justify-between">
                    <span>Result ({displayNodes.length})</span>
                  </div>

                  {displayNodes.length === 0 ? (
                    <div className="text-center py-6">
                      <p className="text-[13px] text-[#787774]">No matches found.</p>
                    </div>
                  ) : (
                    <div className="space-y-0.5 max-h-[300px] overflow-y-auto">
                      {displayNodes.map((node) => {
                        const info = CATEGORY_MAP[node.type];
                        const isSelected = selectedNodeId === node.id;
                        const linksCount = links.filter(
                          (l) => {
                            if (!l) return false;
                            const sId = (l.source && typeof l.source === "object") ? (l.source as any).id : l.source;
                            const tId = (l.target && typeof l.target === "object") ? (l.target as any).id : l.target;
                            return sId === node.id || tId === node.id;
                          }
                        ).length;

                        return (
                          <div
                            key={node.id}
                            onClick={() => onSelectNode(node.id)}
                            className={`p-1.5 rounded text-left cursor-pointer transition-colors flex items-center justify-between gap-2 ${isSelected
                                ? "bg-[#efefed] font-medium"
                                : "hover:bg-[#efefed]"
                              }`}
                          >
                            <div className="flex items-center gap-2 truncate">
                              <span
                                className="w-1.5 h-1.5 rounded-full shrink-0"
                                style={{ backgroundColor: info.color === '#e2e2e2' ? '#9b9a97' : info.color }}
                              />
                              <div className="text-[14px] text-[#37352f] truncate">
                                {node.title}
                              </div>
                            </div>
                            <div className="text-[11px] text-[#787774]">
                              {linksCount} link{linksCount !== 1 && 's'}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

              </>
            )}
          </div>
        )}

        {/* TAB 2: CREATE NOTE SECTION */}
        {activeTab === "create" && (
          <form onSubmit={handleFormSubmit} className="space-y-4" id="panel-create">
            <div className="text-[10px] uppercase font-mono font-bold tracking-wider text-slate-400">
              Plant a New Sprout Note
            </div>

            {formError && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-[10px] font-semibold text-red-600">
                {formError}
              </div>
            )}

            {/* Input Title */}
            <div className="space-y-1">
              <label className="block text-[10px] font-sans font-bold text-slate-500 uppercase">
                Note Title
              </label>
              <input
                type="text"
                required
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="e.g. Canvas Optimizations"
                className="w-full text-xs py-2 px-3 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                id="create-note-title"
              />
            </div>



            {/* Tags Comma separation */}
            <div className="space-y-1">
              <label className="block text-[10px] font-sans font-bold text-slate-500 uppercase">
                Tags (comma separated)
              </label>
              <input
                type="text"
                value={formTags}
                onChange={(e) => setFormTags(e.target.value)}
                placeholder="e.g. physics, ui-animation, canvas"
                className="w-full text-xs py-2 px-3 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                id="create-note-tags"
              />
            </div>

            {/* Body markdown editor */}
            <div className="space-y-1">
              <label className="block text-[10px] font-sans font-bold text-slate-500 uppercase flex items-center justify-between">
                <span>Markdown Body (Optional)</span>
                <span className="font-mono text-[8px] text-slate-400 lowercase italic">
                  markdown-ready
                </span>
              </label>
              <textarea
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
                placeholder="# Dynamic canvas note ... \nWrite summary..."
                rows={5}
                className="w-full text-xs py-2 px-3 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono"
                id="create-note-content"
              />
            </div>



            <button
              type="submit"
              className="w-full flex items-center justify-center gap-1.5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-xl shadow-md transition-colors"
              id="submit-create-note"
            >
              <Plus className="w-4 h-4" />
              Plant Sprout Note
            </button>
          </form>
        )}

        {/* TAB 3: PHYSICS PARAMETER CONTROLS */}
        {activeTab === "physics" && (
          <div className="space-y-4" id="panel-physics">
            <div className="text-[10px] uppercase font-mono font-bold tracking-wider text-slate-400">
              D3 Physics Orchestrator
            </div>

            {/* Presets Grid */}
            <div className="space-y-2">
              <label className="block text-[10px] font-sans font-bold text-slate-500 uppercase">
                Physics Presets Quick Sets
              </label>
              <div className="grid grid-cols-1 gap-2">
                {PHYSICS_PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    onClick={() => onUpdatePhysics(preset.config)}
                    className="flex items-center gap-2.5 p-2 bg-slate-50 hover:bg-slate-100 border border-slate-200/60 rounded-xl text-left transition-colors font-sans"
                  >
                    <div className="p-1.5 bg-white border border-slate-100 rounded-lg text-blue-600">
                      <preset.icon className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <div className="font-semibold text-slate-700 text-xs">{preset.name}</div>
                      <div className="text-[9px] text-slate-400 font-mono">
                        repel: {preset.config.chargeStrength} | col: {preset.config.collisionRadius}px
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="w-full h-[1px] bg-slate-100 my-1" />

            {/* Physics coefficients sliders */}
            <div className="space-y-4 pt-1">
              <div className="text-[10px] uppercase font-mono font-bold tracking-wider text-slate-400">
                Adjust Variables
              </div>

              {/* Repulsion Force */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-medium text-slate-600">
                  <span>Charge Repulsion</span>
                  <span className="font-mono text-[10px] bg-slate-100 px-1 py-0.5 rounded">
                    {physics.chargeStrength}
                  </span>
                </div>
                <input
                  type="range"
                  min="-450"
                  max="0"
                  step="5"
                  value={physics.chargeStrength}
                  onChange={(e) => onUpdatePhysics({ chargeStrength: Number(e.target.value) })}
                  className="w-full"
                  id="physics-charge"
                />
              </div>

              {/* Link Target Distance */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-medium text-slate-600">
                  <span>Link Distance</span>
                  <span className="font-mono text-[10px] bg-slate-100 px-1 py-0.5 rounded">
                    {physics.linkDistance}px
                  </span>
                </div>
                <input
                  type="range"
                  min="20"
                  max="250"
                  step="5"
                  value={physics.linkDistance}
                  onChange={(e) => onUpdatePhysics({ linkDistance: Number(e.target.value) })}
                  className="w-full"
                  id="physics-distance"
                />
              </div>

              {/* Collision Radius */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-medium text-slate-600">
                  <span>Anti-Overlap Bubble</span>
                  <span className="font-mono text-[10px] bg-slate-100 px-1 py-0.5 rounded">
                    {physics.collisionRadius}px
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="60"
                  step="1"
                  value={physics.collisionRadius}
                  onChange={(e) => onUpdatePhysics({ collisionRadius: Number(e.target.value) })}
                  className="w-full"
                  id="physics-collision"
                />
              </div>

              {/* Gravity Strength */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-medium text-slate-600">
                  <span>Radial Centering Pull</span>
                  <span className="font-mono text-[10px] bg-slate-100 px-1 py-0.5 rounded">
                    {physics.gravity}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="0.4"
                  step="0.01"
                  value={physics.gravity}
                  onChange={(e) => onUpdatePhysics({ gravity: Number(e.target.value) })}
                  className="w-full"
                  id="physics-gravity"
                />
              </div>

              {/* Decay / air resistance */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-medium text-slate-600">
                  <span>Damping Decay Dampener</span>
                  <span className="font-mono text-[10px] bg-slate-100 px-1 py-0.5 rounded">
                    {physics.velocityDecay}
                  </span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="0.8"
                  step="0.01"
                  value={physics.velocityDecay}
                  onChange={(e) => onUpdatePhysics({ velocityDecay: Number(e.target.value) })}
                  className="w-full"
                  id="physics-decay"
                />
              </div>

              {/* Bounds constrain */}
              <label className="flex items-center gap-2 pt-2 text-xs font-medium text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={physics.bounceEnabled}
                  onChange={(e) => onUpdatePhysics({ bounceEnabled: e.target.checked })}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4"
                  id="physics-bounds-constrain"
                />
                <span>Constrained within Canvas Bounds</span>
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Keyboard Shortcuts Guide Footer */}
      <div id="sidebar-shortcuts-guide" className="p-4 border-t border-[#e9e9e7] bg-[#f7f7f5] space-y-2 shrink-0">
        <div className="text-[11px] font-medium text-[#787774] uppercase tracking-wider mb-2">
          Keyboard Shortcuts
        </div>
        <div className="space-y-1.5 text-[12px] text-[#37352f]">
          <div className="flex items-center justify-between">
            <span>Select + Hover + <kbd className="px-1 rounded bg-[#efefed] border border-[#e9e9e7] font-mono text-[10px] shadow-sm">C</kbd></span>
            <span className="text-[#787774]">Link (Contain)</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Select + Hover + <kbd className="px-1 rounded bg-[#efefed] border border-[#e9e9e7] font-mono text-[10px] shadow-sm">R</kbd></span>
            <span className="text-[#787774]">Link (Ref)</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Select + Hover + <kbd className="px-1 rounded bg-[#efefed] border border-[#e9e9e7] font-mono text-[10px] shadow-sm">U</kbd></span>
            <span className="text-[#787774]">Unlink</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Shift + Drag</span>
            <span className="text-[#787774]">Quick Link</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Select + <kbd className="px-1 rounded bg-[#efefed] border border-[#e9e9e7] font-mono text-[10px] shadow-sm">S</kbd> / <kbd className="px-1 rounded bg-[#efefed] border border-[#e9e9e7] font-mono text-[10px] shadow-sm">Enter</kbd></span>
            <span className="text-[#787774]">Search Modal</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Double-click Node</span>
            <span className="text-[#787774]">Search Modal</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Select + <kbd className="px-1 rounded bg-[#efefed] border border-[#e9e9e7] font-mono text-[10px] shadow-sm">Del</kbd></span>
            <span className="text-[#787774]">Delete</span>
          </div>
        </div>
      </div>
    </div>
  );
}
