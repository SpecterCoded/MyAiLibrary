import { Map } from "lucide-react";
import type { GraphNode } from "../types";
import { CATEGORY_MAP } from "../types";

export default function GraphMiniMap({ nodes, selectedNodeId }: { nodes: GraphNode[]; selectedNodeId: string | null }) {
  return (
    <div className="kw-minimap" aria-label="Graph minimap">
      <div><Map size={12} /><span>Minimap</span><small>{nodes.length} nodes</small></div>
      <div className="kw-minimap-field">
        {nodes.slice(0, 28).map((node, index) => {
          const angle = index * 2.399;
          const radius = 13 + (index % 5) * 6;
          const x = 50 + Math.cos(angle) * radius;
          const y = 50 + Math.sin(angle) * radius * 0.7;
          return <i key={node.id} className={selectedNodeId === node.id ? "is-active" : ""} style={{ left: `${x}%`, top: `${y}%`, backgroundColor: CATEGORY_MAP[node.type].color }} />;
        })}
        <span />
      </div>
    </div>
  );
}

