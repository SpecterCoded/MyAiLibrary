import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import GraphCanvas from "../components/GraphCanvas";
import type { GraphLink, GraphNode, PhysicsConfig } from "../types";
import type {
  KnowledgeConcept,
  KnowledgeGraphHandle,
  KnowledgeRelationship,
} from "./types";

interface KnowledgeGraphProps {
  concepts: KnowledgeConcept[];
  relationships: KnowledgeRelationship[];
  selectedId: string | null;
  query: string;
  layout: "organic" | "radial" | "learning";
  nodeDistance?: number;
  onSelect: (id: string) => void;
}

const GRAPH_CENTER = { x: 0, y: 0 };

const typeForConcept = (item: KnowledgeConcept): GraphNode["type"] => {
  if (item.nodeType === "chapter") return "chapter";
  if (item.nodeType === "subchapter") return "subchapter";
  if (item.resourceType === "video" || item.resourceType === "youtube") return "video";
  if (item.resourceType === "audio") return "audio";
  if (item.resourceType === "pdf") return "pdf";
  if (item.resourceType === "document" || item.resourceType === "docx") return "docx";
  return "concept";
};

const nodeSizeFor = (item: KnowledgeConcept) => {
  if (item.nodeType === "chapter") return 15;
  if (item.nodeType === "subchapter") return 13;
  const confidenceBoost = Math.max(0, Math.min(5, Math.round((item.confidence || 0) / 20)));
  const mentionBoost = Math.max(0, Math.min(6, Math.round(Math.sqrt(item.mentions || 1))));
  return 18 + confidenceBoost + mentionBoost;
};

const basePositionFor = (
  item: KnowledgeConcept,
  index: number,
  total: number,
  layout: KnowledgeGraphProps["layout"],
  nodeDistance: number,
) => {
  const distance = Math.max(90, nodeDistance || 140);
  if (layout === "radial") {
    const radius = Math.max(190, total * distance / (Math.PI * 2));
    const angle = (index / Math.max(1, total)) * Math.PI * 2 - Math.PI / 2;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  }
  if (layout === "learning") {
    const stageSeed = (item.learningStage || item.chapter || "Practical").length;
    const column = stageSeed % 5;
    const row = Math.floor(index / 5);
    return { x: (column - 2) * distance * 1.25, y: (row - 1) * distance };
  }
  const columns = Math.max(1, Math.ceil(Math.sqrt(total * 1.4)));
  const column = index % columns;
  const row = Math.floor(index / columns);
  return {
    x: (column - (columns - 1) / 2) * distance * 1.18,
    y: (row - Math.max(0, Math.floor(total / columns) / 2)) * distance,
  };
};

const positionsFor = (
  concepts: KnowledgeConcept[],
  relationships: KnowledgeRelationship[],
  layout: KnowledgeGraphProps["layout"],
  nodeDistance: number,
) => {
  const distance = Math.max(90, nodeDistance || 140);
  const conceptNodes = concepts.filter((item) => item.nodeType !== "chapter" && item.nodeType !== "subchapter");
  const sourceNodes = concepts.filter((item) => item.nodeType === "chapter" || item.nodeType === "subchapter");
  const anchors = new Map<string, { x: number; y: number }>();

  conceptNodes.forEach((item, index) => {
    anchors.set(item.id, basePositionFor(item, index, conceptNodes.length || concepts.length, layout, distance * 1.35));
  });

  const sourceEdges = relationships.filter((edge) => edge.edgeKind === "covers");
  const sourceGroups = new Map<string, KnowledgeConcept[]>();
  sourceNodes.forEach((node) => {
    const parentEdge = sourceEdges.find((edge) => edge.source === node.id && anchors.has(edge.target));
    const parentId = parentEdge?.target || conceptNodes[0]?.id;
    if (!parentId) return;
    const group = sourceGroups.get(parentId) || [];
    group.push(node);
    sourceGroups.set(parentId, group);
  });

  sourceGroups.forEach((group, parentId) => {
    const parent = anchors.get(parentId);
    if (!parent) return;
    const radius = Math.max(70, Math.min(180, distance * 0.48));
    group.forEach((node, index) => {
      const angle = (index / Math.max(1, group.length)) * Math.PI * 2 - Math.PI / 2;
      anchors.set(node.id, {
        x: parent.x + Math.cos(angle) * radius,
        y: parent.y + Math.sin(angle) * radius,
      });
    });
  });

  concepts.forEach((item, index) => {
    if (!anchors.has(item.id)) {
      anchors.set(item.id, basePositionFor(item, index, concepts.length, layout, distance));
    }
  });

  return anchors;
};

const physicsFor = (nodeDistance: number): PhysicsConfig => ({
  chargeStrength: -Math.max(64, Math.min(190, nodeDistance * 0.44)),
  linkDistance: Math.max(64, nodeDistance || 140),
  linkStrength: 0.74,
  collisionRadius: Math.max(24, Math.min(68, nodeDistance * 0.18)),
  gravity: 0.025,
  bounceEnabled: false,
  velocityDecay: 0.68,
});

const KnowledgeGraph = forwardRef<KnowledgeGraphHandle, KnowledgeGraphProps>(function KnowledgeGraph(
  { concepts, relationships, selectedId, query, layout, nodeDistance = 140, onSelect },
  ref,
) {
  const [version, setVersion] = useState(0);
  const queryValue = query.trim().toLowerCase();

  const visibleConcepts = useMemo(() => {
    if (!queryValue) return concepts;
    return concepts.filter((item) => [item.title, item.chapter, ...item.aliases]
      .some((value) => String(value || "").toLowerCase().includes(queryValue)));
  }, [concepts, queryValue]);

  const visibleIds = useMemo(() => new Set(visibleConcepts.map((item) => item.id)), [visibleConcepts]);

  const graphNodes = useMemo<GraphNode[]>(() => {
    const layoutPositions = positionsFor(visibleConcepts, relationships, layout, nodeDistance);
    return visibleConcepts.map((item, index) => {
    const base = layoutPositions.get(item.id) || basePositionFor(item, index, visibleConcepts.length, layout, nodeDistance);
    return {
      id: item.id,
      title: item.title,
      type: typeForConcept(item),
      content: item.summary || item.definition || item.chapter || "",
      size: nodeSizeFor(item),
      tags: [
        item.nodeType || "concept",
        item.learningStage,
        item.difficulty,
        item.resourceTitle,
      ].filter(Boolean) as string[],
      x: GRAPH_CENTER.x + base.x,
      y: GRAPH_CENTER.y + base.y,
      createdAt: item.firstMention,
      updatedAt: item.lastMention,
    };
  });
  }, [layout, nodeDistance, relationships, visibleConcepts, version]);

  const graphLinks = useMemo<GraphLink[]>(() => relationships
    .filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target))
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      weight: Math.max(1, edge.confidence || 1),
      linkType: edge.edgeKind === "covers" ? "contain" : "reference",
      label: edge.type,
    })), [relationships, visibleIds]);

  const legendItems = useMemo(() => {
    const linkTypes = Array.from(new Set(relationships.map((edge) => edge.type))).slice(0, 5);
    return linkTypes.length ? linkTypes : ["covers", "belongs_to", "depends_on"];
  }, [relationships]);

  useImperativeHandle(ref, () => ({
    zoomIn: () => {},
    zoomOut: () => {},
    fit: () => setVersion((current) => current + 1),
    reset: () => setVersion((current) => current + 1),
  }), []);

  return (
    <div className="kx-concept-graph-adapter">
      <GraphCanvas
        key={`${layout}-${nodeDistance}-${version}`}
        nodes={graphNodes}
        links={graphLinks}
        physics={physicsFor(nodeDistance)}
        selectedNodeId={selectedId}
        onSelectNode={(id) => { if (id) onSelect(id); }}
        onNodeDoubleClick={(id) => onSelect(id)}
        showControlNotice={false}
        driftStrength={0.004}
        simulationAlphaTarget={0.012}
      />
      <div className="kx-knowledge-map-legend" aria-label="Knowledge graph legend">
        <div><i className="is-concept" />Concept</div>
        <div><i className="is-chapter" />Chapter</div>
        <div><i className="is-subchapter" />Subchapter</div>
        {legendItems.map((item) => (
          <div key={item}><span className={item === "covers" ? "is-cover" : "is-reference"} />{item.replaceAll("_", " ")}</div>
        ))}
      </div>
    </div>
  );
});

export default KnowledgeGraph;
