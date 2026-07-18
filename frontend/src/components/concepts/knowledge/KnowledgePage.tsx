import { useEffect, useMemo, useRef, useState } from "react";
import ConceptDrawer from "./ConceptDrawer";
import ConceptExplorer from "./ConceptExplorer";
import KnowledgeFilters from "./KnowledgeFilters";
import KnowledgeGraph from "./KnowledgeGraph";
import KnowledgeHeader from "./KnowledgeHeader";
import { KnowledgeEmptyState, KnowledgeLoading } from "./KnowledgeStates";
import KnowledgeStats from "./KnowledgeStats";
import KnowledgeTimeline from "./KnowledgeTimeline";
import KnowledgeToolbar from "./KnowledgeToolbar";
import { mockKnowledgeDataset } from "./mockData";
import type { ExplorerSort, GraphLayout, KnowledgeConcept, KnowledgeFiltersState, KnowledgeGraphHandle } from "./types";
import "./knowledge.css";

const DEFAULT_FILTERS: KnowledgeFiltersState = {
  confidence: "all",
  difficulty: "all",
  chapter: "all",
  kind: "all",
  relationship: "all",
  importance: "all",
  favoritesOnly: false,
};

export default function KnowledgePage() {
  const dataset = mockKnowledgeDataset;
  const pageRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<KnowledgeGraphHandle>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const loadingTimers = useRef<number[]>([]);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const resourceFocus = useMemo(() => new URLSearchParams(window.location.search).get("resourceId"), []);
  const [concepts, setConcepts] = useState(dataset.concepts);
  const [selectedId, setSelectedId] = useState<string | null>(dataset.concepts[0]?.id ?? null);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(true);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [drawerWidth, setDrawerWidth] = useState(382);
  const [layout, setLayout] = useState<GraphLayout>("organic");
  const [sort, setSort] = useState<ExplorerSort>("teaching-order");
  const [compact, setCompact] = useState(false);
  const [pageState, setPageState] = useState<"ready" | "loading">("ready");
  const [activeLoadingStage, setActiveLoadingStage] = useState(0);
  const [notice, setNotice] = useState<string | null>(resourceFocus ? "Opened from a library resource. Resource focus is ready for future data." : null);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
      if (event.key === "Escape") setDrawerOpen(false);
    };
    const handlePointerMove = (event: globalThis.PointerEvent) => {
      if (!resizeRef.current) return;
      setDrawerWidth(Math.min(560, Math.max(320, resizeRef.current.startWidth + resizeRef.current.startX - event.clientX)));
    };
    const handlePointerUp = () => { resizeRef.current = null; };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      loadingTimers.current.forEach(window.clearTimeout);
    };
  }, []);

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2800);
  };
  const activeFilterCount = Object.entries(filters).filter(([key, value]) => key === "favoritesOnly" ? value : value !== "all").length;
  const relationshipConceptIds = useMemo(() => {
    if (filters.relationship === "all") return null;
    return new Set(dataset.relationships.filter((item) => item.type === filters.relationship).flatMap((item) => [item.source, item.target]));
  }, [dataset.relationships, filters.relationship]);
  const filteredConcepts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return concepts.filter((item) => {
      const matchesQuery = !normalizedQuery || [item.title, item.summary, item.chapter, ...item.aliases].some((value) => value.toLowerCase().includes(normalizedQuery));
      const matchesConfidence = filters.confidence === "all" || item.confidence >= Number(filters.confidence.replace("+", ""));
      return matchesQuery
        && matchesConfidence
        && (filters.difficulty === "all" || item.difficulty === filters.difficulty)
        && (filters.chapter === "all" || item.chapter === filters.chapter)
        && (filters.kind === "all" || item.kind === filters.kind)
        && (filters.importance === "all" || item.importance >= 90)
        && (!filters.favoritesOnly || item.favorite)
        && (!relationshipConceptIds || relationshipConceptIds.has(item.id))
        && (!compact || item.importance >= 90 || item.pinned);
    });
  }, [compact, concepts, filters, query, relationshipConceptIds]);
  const filteredIds = useMemo(() => new Set(filteredConcepts.map((item) => item.id)), [filteredConcepts]);
  const filteredRelationships = useMemo(
    () => dataset.relationships.filter((item) => filteredIds.has(item.source) && filteredIds.has(item.target) && (filters.relationship === "all" || item.type === filters.relationship)),
    [dataset.relationships, filteredIds, filters.relationship],
  );
  const explorerConcepts = useMemo(() => {
    const order = new Map(dataset.concepts.map((item, index) => [item.id, index]));
    return [...filteredConcepts].sort((a, b) => {
      if (sort === "confidence") return b.confidence - a.confidence;
      if (sort === "frequency") return b.mentions - a.mentions;
      if (sort === "importance") return b.importance - a.importance;
      if (sort === "alphabetical") return a.title.localeCompare(b.title);
      return (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
    });
  }, [dataset.concepts, filteredConcepts, sort]);
  const selectedConcept = concepts.find((item) => item.id === selectedId) ?? null;
  const chapters = [...new Set(concepts.map((item) => item.chapter))];

  const selectConcept = (id: string) => {
    setSelectedId(id);
    setDrawerOpen(true);
  };
  const toggleConceptValue = (id: string, key: "favorite" | "pinned") => {
    setConcepts((current) => current.map((item) => item.id === id ? { ...item, [key]: !item[key] } : item));
  };
  const regenerate = () => {
    loadingTimers.current.forEach(window.clearTimeout);
    setPageState("loading");
    setActiveLoadingStage(0);
    loadingTimers.current = [1, 2, 3, 4, 5].map((stage) => window.setTimeout(() => setActiveLoadingStage(stage), stage * 380));
    loadingTimers.current.push(window.setTimeout(() => {
      setPageState("ready");
      showNotice("Knowledge visualization regenerated using mock lesson data.");
    }, 2450));
  };
  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    void pageRef.current?.requestFullscreen();
  };
  const handleDrawerAction = (action: string, item: KnowledgeConcept) => {
    if (action === "copy") {
      void navigator.clipboard?.writeText(item.summary);
      showNotice(`${item.title} summary copied.`);
      return;
    }
    if (action === "favorite") {
      toggleConceptValue(item.id, "favorite");
      showNotice(`${item.title} favorite updated.`);
      return;
    }
    const messages: Record<string, string> = {
      jump: `Video jump prepared for ${item.firstMention}.`,
      transcript: "Transcript linking is ready for player integration.",
      ask: "AI Tutor action is ready for future integration.",
      flashcards: "Flashcard generation action is prepared.",
      quiz: "Quiz generation action is prepared.",
      notebook: "Notebook save action is prepared.",
      bookmark: "Bookmark action is prepared.",
    };
    showNotice(messages[action] ?? "This action is prepared for future integration.");
  };

  return (
    <div ref={pageRef} className="kx-page" data-resource-focus={resourceFocus ?? undefined}>
      <div className="kx-aurora" aria-hidden="true"><i /><i /><i /></div>
      <KnowledgeHeader eyebrow={dataset.eyebrow} title={dataset.title} subtitle={dataset.subtitle} generatedAt={dataset.generatedAt} onRegenerate={regenerate} onExport={() => showNotice("Export formats are prepared for future data integration.")} onFullscreen={toggleFullscreen} onFocusSearch={() => searchInputRef.current?.focus()} />
      <main className="kx-main">
        <KnowledgeStats statistics={dataset.statistics} />
        <KnowledgeToolbar
          query={query}
          layout={layout}
          timelineOpen={timelineOpen}
          explorerOpen={explorerOpen}
          filterCount={activeFilterCount}
          ref={searchInputRef}
          onQueryChange={setQuery}
          onLayoutChange={(value) => { setLayout(value); graphRef.current?.reset(); }}
          onToggleFilters={() => setFiltersOpen((value) => !value)}
          onZoomIn={() => graphRef.current?.zoomIn()}
          onZoomOut={() => graphRef.current?.zoomOut()}
          onFit={() => graphRef.current?.fit()}
          onReset={() => graphRef.current?.reset()}
          onExpandAll={() => setCompact(false)}
          onCollapseAll={() => setCompact(true)}
          onToggleTimeline={() => setTimelineOpen((value) => !value)}
          onToggleExplorer={() => setExplorerOpen((value) => !value)}
          onExport={() => showNotice("Export formats are prepared for future data integration.")}
        />
        <KnowledgeFilters open={filtersOpen} filters={filters} chapters={chapters} onChange={setFilters} onClose={() => setFiltersOpen(false)} onReset={() => setFilters(DEFAULT_FILTERS)} />
        {pageState === "loading" ? (
          <KnowledgeLoading activeStage={activeLoadingStage} />
        ) : concepts.length === 0 ? (
          <KnowledgeEmptyState onGenerate={regenerate} onLearnMore={() => showNotice("Knowledge graphs connect lesson concepts, sequence, and context.")} />
        ) : (
          <>
            <section className={`kx-graph-stage ${drawerOpen && selectedConcept ? "has-drawer" : ""}`}>
              <div className="kx-graph-frame">
                {filteredConcepts.length ? (
                  <KnowledgeGraph ref={graphRef} concepts={filteredConcepts} relationships={filteredRelationships} selectedId={selectedId} query={query} layout={layout} onSelect={selectConcept} />
                ) : (
                  <div className="kx-no-results"><span>No concepts match these filters.</span><button type="button" className="kx-button" onClick={() => { setFilters(DEFAULT_FILTERS); setQuery(""); }}>Clear filters</button></div>
                )}
              </div>
              {drawerOpen && selectedConcept ? (
                <ConceptDrawer concept={selectedConcept} concepts={concepts} relationships={dataset.relationships} width={drawerWidth} onClose={() => setDrawerOpen(false)} onSelect={selectConcept} onResizeStart={(event) => { resizeRef.current = { startX: event.clientX, startWidth: drawerWidth }; }} onAction={handleDrawerAction} />
              ) : selectedConcept && (
                <button type="button" className="kx-reopen-drawer" onClick={() => setDrawerOpen(true)}>Open concept details</button>
              )}
            </section>
            <KnowledgeTimeline open={timelineOpen} items={dataset.timeline.filter((item) => filteredIds.has(item.conceptId))} concepts={concepts} selectedId={selectedId} onToggle={() => setTimelineOpen((value) => !value)} onSelect={selectConcept} />
            <ConceptExplorer open={explorerOpen} concepts={explorerConcepts} relationships={dataset.relationships} selectedId={selectedId} query={query} sort={sort} onToggle={() => setExplorerOpen((value) => !value)} onSelect={selectConcept} onQueryChange={setQuery} onSortChange={setSort} onToggleFavorite={(id) => toggleConceptValue(id, "favorite")} onTogglePinned={(id) => toggleConceptValue(id, "pinned")} onAction={showNotice} />
          </>
        )}
      </main>
      {notice && <div className="kx-toast" role="status">{notice}</div>}
    </div>
  );
}
