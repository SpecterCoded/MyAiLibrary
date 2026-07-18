import { useMemo, useState } from "react";
import {
  BarChart3,
  BookOpen,
  BrainCircuit,
  Clock3,
  Link2,
  PanelRightClose,
  Sparkles,
} from "lucide-react";
import type { GraphLink, GraphNode } from "../types";
import NoteReader from "./NoteReader";

type InspectorTab = "overview" | "relationships" | "resources" | "timeline" | "analytics" | "ai";

interface KnowledgeInspectorProps {
  node: GraphNode | null;
  links: GraphLink[];
  allNodes: GraphNode[];
  onClose: () => void;
  onUpdateContent: (nodeId: string, title: string, content: string, tags: string[]) => void;
  onSelectNode: (nodeId: string) => void;
}

const tabs: { id: InspectorTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "relationships", label: "Relations" },
  { id: "resources", label: "Resources" },
  { id: "timeline", label: "Timeline" },
  { id: "analytics", label: "Analytics" },
  { id: "ai", label: "AI" },
];

const endpointId = (value: string | GraphNode) => typeof value === "object" ? value.id : value;

export default function KnowledgeInspector({
  node,
  links,
  allNodes,
  onClose,
  onUpdateContent,
  onSelectNode,
}: KnowledgeInspectorProps) {
  const [activeTab, setActiveTab] = useState<InspectorTab>("overview");
  const connectedNodes = useMemo(() => {
    if (!node) return [];
    const ids = new Set<string>();
    links.forEach((link) => {
      const source = endpointId(link.source);
      const target = endpointId(link.target);
      if (source === node.id) ids.add(target);
      if (target === node.id) ids.add(source);
    });
    return allNodes.filter((item) => ids.has(item.id));
  }, [node, links, allNodes]);
  const linkedResources = connectedNodes.filter((item) => item.type !== "concept");

  return (
    <aside className="kw-inspector" aria-label="Knowledge inspector">
      <div className="kw-inspector-header">
        <div><span><BrainCircuit size={15} /></span><strong>Inspector</strong></div>
        <button type="button" onClick={onClose} title="Collapse inspector"><PanelRightClose size={17} /></button>
      </div>
      <div className="kw-inspector-tabs">
        {tabs.map((tab) => (
          <button key={tab.id} type="button" className={activeTab === tab.id ? "is-active" : ""} onClick={() => setActiveTab(tab.id)}>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="kw-inspector-body">
        {!node ? (
          <div className="kw-inspector-empty">
            <span><BookOpen size={22} /></span>
            <h3>Select a node to inspect</h3>
            <p>Explore summaries, relationships, sources, learning history, analytics, and future AI actions here.</p>
          </div>
        ) : activeTab === "overview" ? (
          <NoteReader node={node} links={links} onClose={onClose} onUpdateContent={onUpdateContent} allNodes={allNodes} onSelectNode={onSelectNode} />
        ) : activeTab === "relationships" ? (
          <InspectorList icon={Link2} title="Connected knowledge" empty="No relationships yet.">
            {connectedNodes.map((item) => <button type="button" key={item.id} onClick={() => onSelectNode(item.id)}><span>{item.title}</span><small>{item.type}</small></button>)}
          </InspectorList>
        ) : activeTab === "resources" ? (
          <InspectorList icon={BookOpen} title="Supporting resources" empty="No linked resources yet.">
            {linkedResources.map((item) => <button type="button" key={item.id} onClick={() => onSelectNode(item.id)}><span>{item.title}</span><small>{item.type}</small></button>)}
          </InspectorList>
        ) : activeTab === "timeline" ? (
          <Placeholder icon={Clock3} title="Concept timeline" text="Mentions, revisions, and learning milestones will appear here." />
        ) : activeTab === "analytics" ? (
          <div className="kw-inspector-analytics">
            <div><BarChart3 size={16} /><span>Importance</span><strong>86</strong></div>
            <div><Link2 size={16} /><span>Connectivity</span><strong>{connectedNodes.length}</strong></div>
            <div><BookOpen size={16} /><span>Sources</span><strong>{linkedResources.length}</strong></div>
            <div><Clock3 size={16} /><span>Study time</span><strong>12m</strong></div>
          </div>
        ) : (
          <Placeholder icon={Sparkles} title="AI knowledge actions" text="Prepare explanations, learning paths, quizzes, and GraphRAG prompts from this concept." action="Ask about this concept" />
        )}
      </div>
    </aside>
  );
}

function InspectorList({
  icon: Icon,
  title,
  empty,
  children,
}: {
  icon: typeof Link2;
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return <div className="kw-inspector-list"><h3><Icon size={15} />{title}</h3>{hasChildren ? children : <p>{empty}</p>}</div>;
}

function Placeholder({ icon: Icon, title, text, action }: { icon: typeof Clock3; title: string; text: string; action?: string }) {
  return <div className="kw-inspector-placeholder"><span><Icon size={22} /></span><h3>{title}</h3><p>{text}</p>{action && <button type="button">{action}</button>}</div>;
}

