import React, { useState } from "react";
import type { GraphNode, GraphLink, PhysicsConfig } from "./types";
import SidebarPanel from "./components/SidebarPanel";
import GraphCanvas from "./components/GraphCanvas";
import GlobalGraphCanvas from "./components/GlobalGraphCanvas";
import SearchModal from "./components/SearchModal";
import KnowledgeWorkspaceHeader from "./components/KnowledgeWorkspaceHeader";
import KnowledgeInspector from "./components/KnowledgeInspector";
import KnowledgeTimeline from "./components/KnowledgeTimeline";
import GraphMiniMap from "./components/GraphMiniMap";
import WorkspaceState from "./components/WorkspaceState";
import { logActivity } from "../../utils/activityLogger";
import "./workspace.css";

export default function App() {
  // apiFetch helper
  const apiFetch = async (url: string, options: RequestInit = {}) => {
    const token = localStorage.getItem('access_token');
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
      'Authorization': `Bearer ${token}`,
    };
    const response = await fetch(url, { ...options, headers });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response;
  };

  // Graph States
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [links, setLinks] = useState<GraphLink[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(true);
  const [viewTab, setViewTab] = useState<"concept" | "global">("concept");
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [sidebarWidth, setSidebarWidth] = useState(304);
  const [inspectorWidth, setInspectorWidth] = useState(390);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [graphStatus, setGraphStatus] = useState<"loading" | "ready" | "error">("loading");
  const [graphError, setGraphError] = useState("");
  const [focusResourceId, setFocusResourceId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("resourceId"));
  const [notice, setNotice] = useState("");
  const [searchModalNodeId, setSearchModalNodeId] = useState<string | null>(null);

  // Fetch concepts and links on mount
  React.useEffect(() => {
    const loadGraphData = async () => {
      setGraphStatus("loading");
      setGraphError("");
      try {
        const [conceptsRes, linksRes] = await Promise.all([
          apiFetch("/concepts"),
          apiFetch("/concept-links")
        ]);
        const conceptsData = await conceptsRes.json();
        const linksData = await linksRes.json();

        // 1. Build initial concepts nodes
        const loadedNodes: GraphNode[] = conceptsData.map((c: any) => ({
          id: c.id,
          title: c.name,
          type: "concept",
          content: c.description || "",
          tags: Array.isArray(c.tags) ? c.tags : [],
          x: (Math.random() - 0.5) * 200,
          y: (Math.random() - 0.5) * 200
        }));

        const nodeIds = new Set(loadedNodes.map(n => n.id));

        // 2. Build links and dynamic resource nodes
        const loadedLinks: GraphLink[] = [];
        for (const link of linksData) {
          const sourceId = link.concept_id;
          const targetId = link.source_id;

          if (!nodeIds.has(targetId)) {
            const typeMap: Record<string, string> = {
              video: "video",
              pdf: "pdf",
              docx: "docx",
              audio: "audio",
              note: "note",
              chapter: "chapter",
              "sub-chapter": "sub-chapter",
              subchapter: "subchapter",
              concept: "concept"
            };

            loadedNodes.push({
              id: targetId,
              title: link.target_title || "Linked Asset",
              type: (typeMap[link.source_type] || "note") as any,
              content: `Linked library resource:\n\nType: ${link.source_type}\nID: ${targetId}`,
              x: (Math.random() - 0.5) * 200,
              y: (Math.random() - 0.5) * 200
            });
            nodeIds.add(targetId);
          }

          loadedLinks.push({
            id: link.id,
            source: sourceId,
            target: targetId,
            linkType: link.link_type || "reference"
          });
        }

        setNodes(loadedNodes);
        setLinks(loadedLinks);
        setGraphStatus("ready");
        if (focusResourceId && nodeIds.has(focusResourceId)) {
          setSelectedNodeId(focusResourceId);
          setIsDrawerOpen(true);
        }
      } catch (err) {
        console.error("Failed to fetch concept graph data:", err);
        setGraphError(err instanceof Error ? err.message : "Unable to load knowledge graph");
        setGraphStatus("error");
      }
    };

    loadGraphData();
  }, []);

  React.useEffect(() => {
    if (nodes.length > 0) {
      const openConceptId = localStorage.getItem('open_concept_id');
      if (openConceptId) {
        const nodeExists = nodes.find(n => n.id === openConceptId);
        if (nodeExists) {
          setSelectedNodeId(openConceptId);
          setIsDrawerOpen(true);
        }
        localStorage.removeItem('open_concept_id');
      }
    }
  }, [nodes]);

  const handleSelectNode = (nodeId: string | null) => {
    setSelectedNodeId(nodeId);
    if (nodeId) {
      setIsDrawerOpen(true);
    }
  };

  // Filter States
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilterType, setActiveFilterType] = useState<string | null>(null);

  // Physics Configurations
  const [physics, setPhysics] = useState<PhysicsConfig>({
    chargeStrength: -180,
    linkDistance: 110,
    linkStrength: 0.35,
    collisionRadius: 24,
    gravity: 0.08,
    bounceEnabled: true,
    velocityDecay: 0.42,
  });

  // Callbacks: Update Physics Coefficients
  const handleUpdatePhysics = (newPhysics: Partial<PhysicsConfig>) => {
    setPhysics((prev) => ({ ...prev, ...newPhysics }));
  };

  // Callbacks: Create Node
  const handleAddNode = async (newNode: GraphNode, linkTargetIds: string[]) => {
    try {
      const res = await apiFetch(`/concepts?name=${encodeURIComponent(newNode.title)}&description=${encodeURIComponent(newNode.content)}`, {
        method: "POST"
      });
      const savedConcept = await res.json();
      logActivity('concept', `Created concept "${newNode.title}"`);

      const realNode: GraphNode = {
        ...newNode,
        id: savedConcept.id,
        content: savedConcept.description || ""
      };

      setNodes((prevNodes) => [...prevNodes, realNode]);

      if (linkTargetIds.length > 0) {
        const addedLinks: GraphLink[] = [];
        for (const targetId of linkTargetIds) {
          const targetNode = nodes.find(n => n.id === targetId);
          const sourceType = targetNode ? targetNode.type : "concept";

          const queryParams = new URLSearchParams({
            concept_id: savedConcept.id,
            source_type: sourceType,
            source_id: targetId,
            link_type: "reference"
          });

          const linkRes = await apiFetch(`/concept-links?${queryParams.toString()}`, {
            method: "POST"
          });
          const savedLink = await linkRes.json();

          addedLinks.push({
            id: savedLink.id,
            source: savedConcept.id,
            target: targetId,
            linkType: savedLink.link_type
          });
        }
        setLinks((prevLinks) => [...prevLinks, ...addedLinks]);
      }

      handleSelectNode(savedConcept.id);
    } catch (err) {
      console.error("Failed to plant sprout note in backend:", err);
      alert("Failed to save concept node to database");
    }
  };

  // Callbacks: Delete Node
  const handleDeleteNode = async (nodeId: string) => {
    const targetNode = nodes.find(n => n.id === nodeId);
    if (!targetNode) return;

    if (targetNode.type !== "concept") {
      try {
        const linksToPrune = links.filter((link) => {
          if (!link) return false;
          const sId = (link.source && typeof link.source === "object") ? (link.source as any).id : link.source;
          const tId = (link.target && typeof link.target === "object") ? (link.target as any).id : link.target;
          return sId === nodeId || tId === nodeId;
        });

        for (const link of linksToPrune) {
          const sId = typeof link.source === "object" ? link.source.id : link.source;
          const tId = typeof link.target === "object" ? link.target.id : link.target;
          const conceptId = sId === nodeId ? tId : sId;

          const queryParams = new URLSearchParams({
            concept_id: conceptId,
            source_id: nodeId
          });

          await apiFetch(`/concept-links?${queryParams.toString()}`, {
            method: "DELETE"
          });
        }

        setLinks((prevLinks) =>
          prevLinks.filter((link) => {
            if (!link) return false;
            const sId = (link.source && typeof link.source === "object") ? (link.source as any).id : link.source;
            const tId = (link.target && typeof link.target === "object") ? (link.target as any).id : link.target;
            return sId !== nodeId && tId !== nodeId;
          })
        );

        setNodes((prevNodes) => prevNodes.filter((n) => n.id !== nodeId));

        if (selectedNodeId === nodeId) {
          const remainingNodes = nodes.filter((n) => n.id !== nodeId);
          handleSelectNode(
            remainingNodes.length > 0 ? remainingNodes[0].id : null,
          );
        }
      } catch (err) {
        console.error("Failed to delete concept link:", err);
        alert("Failed to delete link from database");
      }
      return;
    }

    if (nodes.length <= 1) {
      alert("You must keep at least one node in your database");
      return;
    }

    try {
      await apiFetch(`/concepts/${nodeId}`, {
        method: "DELETE"
      });
      logActivity('concept', 'Deleted concept');

      setNodes((prevNodes) => prevNodes.filter((n) => n.id !== nodeId));
      setLinks((prevLinks) =>
        prevLinks.filter((link) => {
          if (!link) return false;
          const sourceId =
            (link.source && typeof link.source === "object") ? (link.source as any).id : link.source;
          const targetId =
            (link.target && typeof link.target === "object") ? (link.target as any).id : link.target;
          return sourceId !== nodeId && targetId !== nodeId;
        }),
      );

      if (selectedNodeId === nodeId) {
        const remainingNodes = nodes.filter((n) => n.id !== nodeId);
        handleSelectNode(
          remainingNodes.length > 0 ? remainingNodes[0].id : null,
        );
      }
    } catch (err) {
      console.error("Failed to delete concept node:", err);
      alert("Failed to delete concept node from database");
    }
  };

  // Callbacks: Update Note Content
  const handleUpdateContent = async (
    nodeId: string,
    updatedTitle: string,
    updatedContent: string,
    updatedTags: string[],
  ) => {
    try {
      await apiFetch(`/concepts/${nodeId}`, {
        method: "PUT",
        body: JSON.stringify({
          name: updatedTitle,
          description: updatedContent,
          tags: updatedTags
        })
      });

      setNodes((prevNodes) =>
        prevNodes.map((n) =>
          n.id === nodeId
            ? {
              ...n,
              title: updatedTitle,
              content: updatedContent,
              tags: updatedTags,
              updatedAt: new Date().toLocaleDateString(),
            }
            : n
        ),
      );
    } catch (err) {
      console.error("Failed to update concept node content:", err);
      alert("Failed to save note changes to database");
    }
  };

  // Action: Add Demo Node Network
  const handleLoadDemoMesh = () => {
    const timestamp = Date.now();
    const demoNodes: GraphNode[] = [
      {
        id: `demo-obsidian-${timestamp}`,
        title: "Deeper Obsidian Insights",
        type: "concept",
        tags: ["demo", "graph", "obsidian"],
        content: `# Deeper Obsidian Insights\n\nPersonal Knowledge Management (PKM) flourishes when links guide navigation. This represents an added cluster showing a custom mesh insertion.`,
        updatedAt: new Date().toLocaleDateString(),
      },
      {
        id: `demo-pkm-${timestamp}`,
        title: "Dynamic PKM Frameworks",
        type: "project",
        tags: ["demo", "pkm", "systems"],
        content: `# Dynamic PKM Frameworks\n\nSpawning notes in clusters allows groups of interconnected ideas to settle together into localized orbit shells.`,
        updatedAt: new Date().toLocaleDateString(),
      },
    ];

    const demoLinks: GraphLink[] = [
      {
        id: `demo-link-1-${timestamp}`,
        source: `demo-obsidian-${timestamp}`,
        target: `demo-pkm-${timestamp}`,
      }
    ];

    setNodes((prev) => [...prev, ...demoNodes]);
    setLinks((prev) => [...prev, ...demoLinks]);
    handleSelectNode(`demo-obsidian-${timestamp}`);
  };

  // Action: Reset Database
  const handleResetDatabase = () => {
    if (confirm("Reset garden map data back to backend defaults?")) {
      window.location.reload();
    }
  };

  // Callbacks: Create Link visually via Drag
  const handleAddLink = (sourceId: string, targetId: string) => {
    handleUpdateLink(sourceId, targetId, "default");
  };

  const handleUpdateLink = async (
    sourceId: string,
    targetId: string,
    linkType: "contain" | "reference" | "default",
  ) => {
    const nodeA = nodes.find(n => n.id === sourceId);
    const nodeB = nodes.find(n => n.id === targetId);

    let conceptId = sourceId;
    let realTargetId = targetId;
    let targetType = nodeB ? nodeB.type : "concept";

    if (nodeA && nodeA.type !== "concept" && nodeB && nodeB.type === "concept") {
      conceptId = targetId;
      realTargetId = sourceId;
      targetType = nodeA.type;
    }

    try {
      const queryParams = new URLSearchParams({
        concept_id: conceptId,
        source_type: targetType,
        source_id: realTargetId,
        link_type: linkType === "default" ? "reference" : linkType
      });

      const res = await apiFetch(`/concept-links?${queryParams.toString()}`, {
        method: "POST"
      });
      const savedLink = await res.json();
      logActivity('concept', 'Linked concepts');

      setLinks((prevLinks) => {
        const exists = prevLinks.find((l) => {
          if (!l) return false;
          const sId = (l.source && typeof l.source === "object") ? (l.source as any).id : l.source;
          const tId = (l.target && typeof l.target === "object") ? (l.target as any).id : l.target;
          return (
            (sId === sourceId && tId === targetId) ||
            (sId === targetId && tId === sourceId)
          );
        });

        if (exists) {
          return prevLinks.map((l) =>
            l.id === exists.id
              ? { ...l, source: conceptId, target: realTargetId, linkType }
              : l
          );
        } else {
          const newLink: GraphLink = {
            id: savedLink.id,
            source: conceptId,
            target: realTargetId,
            linkType,
          };
          return [...prevLinks, newLink];
        }
      });
    } catch (err) {
      console.error("Failed to link nodes in backend:", err);
      alert("Failed to save node link to database");
    }
  };

  const handleUnlink = async (sourceId: string, targetId: string) => {
    try {
      const queryParams = new URLSearchParams({
        concept_id: sourceId,
        source_id: targetId
      });

      await apiFetch(`/concept-links?${queryParams.toString()}`, {
        method: "DELETE"
      });

      setLinks((prevLinks) =>
        prevLinks.filter((l) => {
          if (!l) return false;
          const sId = (l.source && typeof l.source === "object") ? (l.source as any).id : l.source;
          const tId = (l.target && typeof l.target === "object") ? (l.target as any).id : l.target;
          return !(
            (sId === sourceId && tId === targetId) ||
            (sId === targetId && tId === sourceId)
          );
        }),
      );
    } catch (err) {
      console.error("Failed to unlink nodes in backend:", err);
      alert("Failed to remove node link from database");
    }
  };

  const handleLibraryItemLink = async (
    sourceId: string,
    item: any,
    linkType: "contain" | "reference",
  ) => {
    const linkExists = links.some((l) => {
      if (!l) return false;
      const sId = (l.source && typeof l.source === "object") ? (l.source as any).id : l.source;
      const tId = (l.target && typeof l.target === "object") ? (l.target as any).id : l.target;
      return (
        (sId === sourceId && tId === item.id) ||
        (sId === item.id && tId === sourceId)
      );
    });

    if (linkExists) {
      handleSelectNode(item.id);
      setSearchModalNodeId(null);
      return;
    }

    let nodeExists = nodes.some((n) => n.id === item.id);
    if (!nodeExists) {
      const typeMap: Record<string, GraphNode["type"]> = {
        chapter: "chapter",
        "sub-chapter": "sub-chapter",
        subchapter: "subchapter",
        note: "note",
        video: "video",
        pdf: "pdf",
        docx: "docx",
        image: "concept",
        audio: "audio",
        concept: "concept",
        attachment: "pdf",
      };

      const newNode: GraphNode = {
        id: item.id,
        title: item.title,
        type: typeMap[item.type] || "concept",
        content: `Imported library resource:\n\nType: ${item.type}\nTitle: ${item.title}\nID: ${item.id}`,
        createdAt: new Date().toLocaleDateString(),
        x: Math.random() * 200,
        y: Math.random() * 200,
      };
      setNodes((prev) => [...prev, newNode]);
    }

    await handleUpdateLink(sourceId, item.id, linkType);
    handleSelectNode(item.id);
    setSearchModalNodeId(null);
  };

  const activeNode = nodes.find((n) => n.id === selectedNodeId) || null;
  const [lastActiveNode, setLastActiveNode] = useState<GraphNode | null>(null);

  React.useEffect(() => {
    if (activeNode) {
      setLastActiveNode(activeNode);
    }
  }, [activeNode]);

  const conceptCount = nodes.filter((node) => node.type === "concept").length;
  const resourceCount = nodes.length - conceptCount;

  const beginResize = (panel: "sidebar" | "inspector", event: React.MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panel === "sidebar" ? sidebarWidth : inspectorWidth;
    const handleMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      if (panel === "sidebar") {
        setSidebarWidth(Math.min(390, Math.max(248, startWidth + delta)));
      } else {
        setInspectorWidth(Math.min(590, Math.max(320, startWidth - delta)));
      }
    };
    const handleUp = () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  };

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2200);
  };

  const clearResourceFocus = () => {
    const params = new URLSearchParams(window.location.search);
    params.delete("resourceId");
    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
    setFocusResourceId(null);
  };


  return (
    <div className="knowledge-workspace" id="app-viewport-root">
      {sidebarOpen && (
        <aside className="kw-sidebar-shell" style={{ width: sidebarWidth }}>
          <SidebarPanel
            nodes={nodes}
            links={links}
            physics={physics}
            selectedNodeId={selectedNodeId}
            onSelectNode={handleSelectNode}
            onAddNode={handleAddNode}
            onDeleteNode={handleDeleteNode}
            onUpdatePhysics={handleUpdatePhysics}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            activeFilterType={activeFilterType}
            onFilterTypeChange={setActiveFilterType}
            viewTab={viewTab}
            onViewTabChange={setViewTab}
            onCollapse={() => setSidebarOpen(false)}
          />
          <div className="kw-resize-handle" onMouseDown={(event) => beginResize("sidebar", event)} />
        </aside>
      )}

      <main className="kw-workspace-main" id="app-workspace-body">
        <KnowledgeWorkspaceHeader
          concepts={conceptCount}
          relationships={links.length}
          resources={resourceCount}
          searchQuery={searchQuery}
          focusResourceId={focusResourceId}
          sidebarOpen={sidebarOpen}
          onOpenSidebar={() => setSidebarOpen(true)}
          onSearchChange={setSearchQuery}
          onClearFocus={clearResourceFocus}
          onFilters={() => showNotice("Advanced knowledge filters are prepared for integration.")}
          onAiAction={() => showNotice("AI knowledge actions are prepared for integration.")}
          onRefresh={() => window.location.reload()}
        />

        <div className="kw-canvas-row">
          <section className="kw-graph-column">
            <div className="kw-graph-surface" id="central-graph-sandbox">
              {viewTab === "global" ? (
                <GlobalGraphCanvas />
              ) : (
                <>
                  <GraphCanvas
                    nodes={nodes}
                    links={links}
                    physics={physics}
                    selectedNodeId={selectedNodeId}
                    onSelectNode={handleSelectNode}
                    onAddLink={handleAddLink}
                    onUpdateLink={handleUpdateLink}
                    onUnlink={handleUnlink}
                    onDeleteNode={handleDeleteNode}
                    onNodeDoubleClick={(nodeId) => setSearchModalNodeId(nodeId)}
                  />
                  <GraphMiniMap nodes={nodes} selectedNodeId={selectedNodeId} />
                  <WorkspaceState
                    status={graphStatus}
                    isEmpty={nodes.length === 0}
                    errorMessage={graphError}
                    onRetry={() => window.location.reload()}
                  />
                </>
              )}
              {!isDrawerOpen && viewTab !== "global" && (
                <button type="button" className="kw-open-inspector" onClick={() => setIsDrawerOpen(true)}>Open inspector</button>
              )}
            </div>
            {viewTab !== "global" && (
              <KnowledgeTimeline
                open={timelineOpen}
                nodes={nodes}
                links={links}
                selectedNodeId={selectedNodeId}
                onToggle={() => setTimelineOpen((value) => !value)}
                onSelectNode={handleSelectNode}
              />
            )}
          </section>

          {isDrawerOpen && viewTab !== "global" && (
            <aside className="kw-inspector-shell" style={{ width: inspectorWidth }} id="right-reader-dock">
              <div className="kw-resize-handle" onMouseDown={(event) => beginResize("inspector", event)} />
              <KnowledgeInspector
                node={activeNode || lastActiveNode}
                links={links}
                allNodes={nodes}
                onClose={() => setIsDrawerOpen(false)}
                onUpdateContent={handleUpdateContent}
                onSelectNode={(nodeId) => handleSelectNode(nodeId)}
              />
            </aside>
          )}
        </div>
      </main>

      {searchModalNodeId && (
        <SearchModal
          sourceNodeId={searchModalNodeId}
          onClose={() => setSearchModalNodeId(null)}
          onLink={handleLibraryItemLink}
        />
      )}
      {notice && <div className="kw-notice" role="status">{notice}</div>}
    </div>
  );
}
