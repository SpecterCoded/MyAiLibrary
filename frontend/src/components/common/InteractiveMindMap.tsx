import { ChevronRight, Expand, Maximize2, Search, Share2, Shrink, X, ZoomIn, ZoomOut } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

type RawNode = { title?: string; topic?: string; label?: string; name?: string; text?: string; detail?: string; description?: string; children?: RawNode[]; subtopics?: RawNode[]; details?: Array<RawNode | string> };
type TreeNode = { id: string; label: string; detail?: string; children: TreeNode[] };
type LayoutNode = TreeNode & { x: number; y: number; depth: number; color: string; matched: boolean; hasMatch: boolean; collapsed: boolean };
type Edge = { from: LayoutNode; to: LayoutNode };
const COLORS = ["#5865c7", "#c08a2e", "#1f9c8a", "#8b5fbf", "#3b7dd8", "#c25b6e", "#168578", "#b76535"];

function labelOf(value: RawNode | string, fallback = "Untitled") {
  if (typeof value === "string") return value.trim() || fallback;
  return (value.title || value.topic || value.label || value.name || value.text || fallback).trim();
}
function normalize(value: RawNode | string, id = "root"): TreeNode {
  if (typeof value === "string") return { id, label: labelOf(value), children: [] };
  const rawChildren: Array<RawNode | string> = Array.isArray(value.children) ? value.children : Array.isArray(value.subtopics) ? value.subtopics : Array.isArray(value.details) ? value.details : [];
  return { id, label: labelOf(value, id === "root" ? "Study Map" : "Untitled"), detail: value.detail || value.description, children: rawChildren.map((child, i) => normalize(child, `${id}-${i}`)) };
}
function matches(node: TreeNode, search: string) {
  const term = search.trim().toLocaleLowerCase();
  return Boolean(term && [node.label, node.detail].filter(Boolean).some((value) => value!.toLocaleLowerCase().includes(term)));
}
function hasMatch(node: TreeNode, search: string): boolean {
  return matches(node, search) || node.children.some((child) => hasMatch(child, search));
}
function count(node: TreeNode): number {
  return node.children.reduce((sum, child) => sum + 1 + count(child), 0);
}
function collapsible(node: TreeNode, ids: string[] = []) {
  if (node.id !== "root" && node.children.length) ids.push(node.id);
  node.children.forEach((child) => collapsible(child, ids));
  return ids;
}
function subtreeIds(node: TreeNode, targetId: string): string[] {
  if (node.id === targetId) {
    return [node.id, ...node.children.flatMap((child) => subtreeIds(child, child.id))];
  }
  for (const child of node.children) {
    const result = subtreeIds(child, targetId);
    if (result.length) return result;
  }
  return [];
}
function estimatedRowHeight(node: TreeNode, depth: number) {
  const charactersPerLine = depth >= 3 ? 36 : 30;
  const labelLines = Math.max(1, Math.ceil(node.label.length / charactersPerLine));
  const detailLines = node.detail ? Math.max(1, Math.ceil(node.detail.length / 40)) : 0;
  const textHeight = labelLines * 15 + detailLines * 12 + (detailLines ? 6 : 0);
  return Math.max(82, textHeight + 34);
}


function useLayout(root: TreeNode, closed: Set<string>, search: string) {
  return useMemo(() => {
    const nodes: LayoutNode[] = [], edges: Edge[] = [];
    const rootNode: LayoutNode = { ...root, x: 0, y: 0, depth: 0, color: "#788196", matched: matches(root, search), hasMatch: hasMatch(root, search), collapsed: false };
    nodes.push(rootNode);
    const split = Math.ceil(root.children.length / 2);
    ([-1, 1] as const).forEach((side) => {
      const branches = side < 0 ? root.children.slice(0, split) : root.children.slice(split);
      const sideNodes: LayoutNode[] = [];
      let cursor = 0;
      const place = (source: TreeNode, depth: number, parent: LayoutNode, color: string): number => {
        const searchOpens = Boolean(search.trim() && source.children.some((child) => hasMatch(child, search)));
        const node: LayoutNode = { ...source, x: side * depth * 300, y: 0, depth, color, matched: matches(source, search), hasMatch: hasMatch(source, search), collapsed: closed.has(source.id) };
        nodes.push(node); sideNodes.push(node); edges.push({ from: parent, to: node });
        const children = closed.has(source.id) && !searchOpens ? [] : source.children;
        if (children.length) {
          const positions = children.map((child) => place(child, depth + 1, node, color));
          node.y = (positions[0] + positions[positions.length - 1]) / 2;
        } else {
          const rowHeight = estimatedRowHeight(source, depth);
          node.y = cursor + rowHeight / 2;
          cursor += rowHeight;
        }
        return node.y;
      };
      branches.forEach((branch, i) => {
        const colorIndex = root.children.indexOf(branch);
        place(branch, 1, rootNode, COLORS[colorIndex % COLORS.length]);
        if (i < branches.length - 1) cursor += 48;
      });
      if (sideNodes.length) {
        const ys = sideNodes.map((node) => node.y), center = (Math.min(...ys) + Math.max(...ys)) / 2;
        sideNodes.forEach((node) => { node.y -= center; });
      }
    });
    const ys = nodes.map((node) => node.y), minY = Math.min(...ys, 0), maxY = Math.max(...ys, 0);
    const maxDepth = Math.max(...nodes.map((node) => node.depth), 1);
    const worldWidth = Math.max(2200, maxDepth * 600 + 360), worldHeight = Math.max(620, maxY - minY + 320);
    return { nodes, edges, worldWidth, worldHeight, centerX: worldWidth / 2, centerY: 160 - minY };
  }, [closed, root, search]);
}

export function InteractiveMindMap({ mindmapData, className = "" }: { mindmapData: RawNode; className?: string }) {
  const root = useMemo(() => normalize(mindmapData), [mindmapData]);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const [bulkOpeningIds, setBulkOpeningIds] = useState<Set<string>>(() => new Set());
  const [bulkClosingIds, setBulkClosingIds] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState(""), [scale, setScale] = useState(.6), [pan, setPan] = useState({ x: 0, y: 0 }), [dragging, setDragging] = useState(false);
  const [layoutTransition, setLayoutTransition] = useState(false);
  const [nodeOffsets, setNodeOffsets] = useState<Record<string, { x: number; y: number }>>({});
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: number; x: number; y: number; panX: number; panY: number } | null>(null);
  const initialFitRef = useRef(false);
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fitViewRef = useRef<() => void>(() => undefined);
  const pendingFitRef = useRef(false);
  const layoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transformRef = useRef({ scale: .6, pan: { x: 0, y: 0 } });
  const nodeDragRef = useRef<{ id: number; nodeIds: string[]; x: number; y: number; offsets: Record<string, { x: number; y: number }> } | null>(null);
  const { nodes, edges, worldWidth, worldHeight, centerX, centerY } = useLayout(root, closed, search);
  const searching = Boolean(search.trim());
  const openingNodeIds = useMemo(() => {
    const ids = new Set(bulkOpeningIds);
    if (openingId) subtreeIds(root, openingId).slice(1).forEach((id) => ids.add(id));
    return ids;
  }, [bulkOpeningIds, openingId, root]);
  const closingNodeIds = useMemo(() => {
    const ids = new Set(bulkClosingIds);
    if (closingId) subtreeIds(root, closingId).slice(1).forEach((id) => ids.add(id));
    return ids;
  }, [bulkClosingIds, closingId, root]);
  const animating = Boolean(openingId || closingId || bulkOpeningIds.size || bulkClosingIds.size);
  const positionFor = (node: LayoutNode) => ({ x: node.x + (nodeOffsets[node.id]?.x || 0), y: node.y + (nodeOffsets[node.id]?.y || 0) });

  const fitView = useCallback(() => {
    const viewport = viewportRef.current; if (!viewport) return;
    const elements = new Map<string, HTMLElement>();
    viewport.querySelectorAll<HTMLElement>("[data-node-id]").forEach((element) => {
      if (element.dataset.nodeId) elements.set(element.dataset.nodeId, element);
    });
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    nodes.forEach((node) => {
      const element = elements.get(node.id);
      const fallbackWidth = node.depth === 0 ? 220 : node.children.length ? 190 : 240;
      const fallbackHeight = node.depth === 0 ? 70 : node.children.length ? 42 : 58;
      const halfWidth = (element?.offsetWidth || fallbackWidth) / 2;
      const halfHeight = (element?.offsetHeight || fallbackHeight) / 2;
      const x = centerX + node.x + (nodeOffsets[node.id]?.x || 0);
      const y = centerY + node.y + (nodeOffsets[node.id]?.y || 0);
      left = Math.min(left, x - halfWidth); right = Math.max(right, x + halfWidth);
      top = Math.min(top, y - halfHeight); bottom = Math.max(bottom, y + halfHeight);
    });
    if (!Number.isFinite(left) || !Number.isFinite(top)) return;
    const contentWidth = Math.max(1, right - left), contentHeight = Math.max(1, bottom - top);
    const availableWidth = Math.max(1, viewport.clientWidth - 96), availableHeight = Math.max(1, viewport.clientHeight - 96);
    const next = Math.min(availableWidth / contentWidth, availableHeight / contentHeight, .9);
    const boundsCenterX = (left + right) / 2, boundsCenterY = (top + bottom) / 2;
    const nextPan = { x: viewport.clientWidth / 2 - boundsCenterX * next, y: viewport.clientHeight / 2 - boundsCenterY * next };
    transformRef.current = { scale: next, pan: nextPan };
    setScale(next); setPan(nextPan);
  }, [centerX, centerY, nodeOffsets, nodes]);
  const zoomAt = useCallback((factor: number, ax?: number, ay?: number) => {
    const viewport = viewportRef.current; if (!viewport) return;
    const x = ax ?? viewport.clientWidth / 2, y = ay ?? viewport.clientHeight / 2;
    const current = transformRef.current;
    const next = Math.min(1.7, Math.max(.2, current.scale * factor));
    const nextPan = { x: x - ((x - current.pan.x) / current.scale) * next, y: y - ((y - current.pan.y) / current.scale) * next };
    transformRef.current = { scale: next, pan: nextPan };
    setScale(next); setPan(nextPan);
  }, []);
  const requestFitView = useCallback(() => {
    if (animating || layoutTransition) { pendingFitRef.current = true; return; }
    fitView();
  }, [animating, fitView, layoutTransition]);
  useEffect(() => {
    if (animating || layoutTransition || !pendingFitRef.current) return;
    pendingFitRef.current = false;
    const frame = requestAnimationFrame(fitView);
    return () => cancelAnimationFrame(frame);
  }, [animating, fitView, layoutTransition]);
  fitViewRef.current = fitView;
  useEffect(() => {
    if (initialFitRef.current) return;
    initialFitRef.current = true;
    const frame = requestAnimationFrame(fitView);
    return () => cancelAnimationFrame(frame);
  }, [fitView]);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;
    const initialRect = viewport.getBoundingClientRect();
    let previousWidth = initialRect.width, previousHeight = initialRect.height;
    const resize = ([entry]: ResizeObserverEntry[]) => {
      const { width, height } = entry.contentRect;
      if (Math.abs(width - previousWidth) < .5 && Math.abs(height - previousHeight) < .5) return;
      previousWidth = width;
      previousHeight = height;
      fitViewRef.current();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);
  useEffect(() => () => {
    if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
    if (layoutTimerRef.current) clearTimeout(layoutTimerRef.current);
  }, []);
  useEffect(() => {
    const viewport = viewportRef.current; if (!viewport) return;
    const wheel = (event: WheelEvent) => { event.preventDefault(); const rect = viewport.getBoundingClientRect(); zoomAt(event.deltaY < 0 ? 1.1 : .9, event.clientX - rect.left, event.clientY - rect.top); };
    viewport.addEventListener("wheel", wheel, { passive: false }); return () => viewport.removeEventListener("wheel", wheel);
  }, [zoomAt]);

  const toggle = (id: string) => {
    if (animating) return;
    if (closed.has(id)) {
      setLayoutTransition(true);
      setClosed((current) => { const next = new Set(current); next.delete(id); return next; });
      setOpeningId(id);
      requestAnimationFrame(() => requestAnimationFrame(() => setOpeningId(null)));
      layoutTimerRef.current = setTimeout(() => setLayoutTransition(false), 260);
      return;
    }
    setClosingId(id);
    transitionTimerRef.current = setTimeout(() => {
      setClosed((current) => new Set(current).add(id));
      setLayoutTransition(true);
      setClosingId(null);
      layoutTimerRef.current = setTimeout(() => setLayoutTransition(false), 260);
    }, 220);
  };
  const expandAll = () => {
    if (animating) return;
    const visibleIds = new Set(nodes.map((node) => node.id));
    const enteringIds = subtreeIds(root, root.id).slice(1).filter((id) => !visibleIds.has(id));
    if (!enteringIds.length) { setClosed(new Set()); return; }
    if (layoutTimerRef.current) clearTimeout(layoutTimerRef.current);
    setLayoutTransition(true);
    setBulkOpeningIds(new Set(enteringIds));
    setClosed(new Set());
    requestAnimationFrame(() => requestAnimationFrame(() => setBulkOpeningIds(new Set())));
    layoutTimerRef.current = setTimeout(() => setLayoutTransition(false), 260);
  };
  const collapseAll = () => {
    if (animating) return;
    const nextClosed = new Set(collapsible(root));
    const remainingIds = new Set([root.id, ...root.children.map((child) => child.id)]);
    const leavingIds = nodes.filter((node) => !remainingIds.has(node.id)).map((node) => node.id);
    if (!leavingIds.length) { setClosed(nextClosed); return; }
    if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
    if (layoutTimerRef.current) clearTimeout(layoutTimerRef.current);
    setBulkClosingIds(new Set(leavingIds));
    transitionTimerRef.current = setTimeout(() => {
      setLayoutTransition(true);
      setClosed(nextClosed);
      setBulkClosingIds(new Set());
      layoutTimerRef.current = setTimeout(() => setLayoutTransition(false), 260);
    }, 220);
  };
  const pointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button,input")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const nodeElement = (event.target as HTMLElement).closest<HTMLElement>(".aim-node");
    if (nodeElement?.dataset.nodeId) {
      const nodeIds = subtreeIds(root, nodeElement.dataset.nodeId);
      nodeDragRef.current = { id: event.pointerId, nodeIds, x: event.clientX, y: event.clientY, offsets: Object.fromEntries(nodeIds.map((id) => [id, nodeOffsets[id] || { x: 0, y: 0 }])) };
      return;
    }
    dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    setDragging(true);
  };
  const pointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const nodeDrag = nodeDragRef.current;
    if (nodeDrag?.id === event.pointerId) {
      const deltaX = (event.clientX - nodeDrag.x) / scale;
      const deltaY = (event.clientY - nodeDrag.y) / scale;
      setNodeOffsets((current) => ({ ...current, ...Object.fromEntries(nodeDrag.nodeIds.map((id) => {
        const offset = nodeDrag.offsets[id];
        return [id, { x: offset.x + deltaX, y: offset.y + deltaY }];
      })) }));
      return;
    }
    const drag = dragRef.current;
    if (drag?.id === event.pointerId) {
      const nextPan = { x: drag.panX + event.clientX - drag.x, y: drag.panY + event.clientY - drag.y };
      transformRef.current = { scale, pan: nextPan };
      setPan(nextPan);
    }
  };
  const pointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (nodeDragRef.current?.id === event.pointerId) nodeDragRef.current = null;
    if (dragRef.current?.id === event.pointerId) { dragRef.current = null; setDragging(false); }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return <section className={`aim ${className}`.trim()} aria-label="Interactive concept map">
    <style>{`
      .aim{--bg:#eef1f6;--panel:#fff;--card:#fff;--soft:#f6f7f9;--ink:#182033;--muted:#667085;--line:#dfe4ec;--grid:#d2d8e2;width:100%;height:min(680px,calc(100vh - 210px));min-height:520px;display:flex;flex-direction:column;position:relative;overflow:hidden;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:18px;font-family:inherit}.dark .aim{--bg:#17191d;--panel:#202228;--card:#282b32;--soft:#25272d;--ink:#f1f3f7;--muted:#a4adbc;--line:rgba(255,255,255,.1);--grid:rgba(255,255,255,.11)}.aim *{box-sizing:border-box}.aim button,.aim input{font:inherit}
      .aim-head{min-height:66px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:13px 17px;background:var(--panel);border-bottom:1px solid var(--line);z-index:5}.aim-title-wrap{min-width:0;display:flex;align-items:center;gap:10px}.aim-mark{width:34px;height:34px;flex:none;display:grid;place-items:center;color:#fff;background:linear-gradient(145deg,#27314f,#11172a);border-radius:9px}.aim-title{max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:750}.aim-sub{margin-top:2px;color:var(--muted);font-size:10px}.aim-stats{display:flex;gap:13px;color:var(--muted);font-size:10px;white-space:nowrap}.aim-stats b{color:var(--ink)}
      .aim-search{width:min(220px,28vw);display:flex;align-items:center;gap:7px;padding:7px 9px;color:var(--muted);background:var(--soft);border:1px solid var(--line);border-radius:9px}.aim-search input{width:100%;min-width:0;padding:0;color:var(--ink);background:transparent;border:0;outline:0;font-size:11px}.aim-search button{display:flex;padding:0;color:var(--muted);background:transparent;border:0;cursor:pointer}
      .aim-canvas{position:relative;flex:1;min-height:0;overflow:hidden;touch-action:none;cursor:grab;user-select:none;background-color:var(--bg);background-image:radial-gradient(circle,var(--grid) 1px,transparent 1.2px);background-size:22px 22px}.aim-canvas.drag{cursor:grabbing}.aim-world{position:absolute;inset:0 auto auto 0;transform-origin:0 0;will-change:transform}.aim-node{position:absolute;z-index:2;transform:translate(-50%,-50%);transition:opacity .16s}.aim-node.dim{opacity:.13}
      .aim-card{display:flex;align-items:center;gap:7px;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:10px;box-shadow:0 2px 7px rgba(20,24,40,.08);white-space:nowrap;transition:transform .16s,box-shadow .16s}.aim-card:hover{transform:translateY(-1px);box-shadow:0 7px 18px rgba(20,24,40,.12)}.aim-root .aim-card{min-width:180px;max-width:250px;padding:15px 20px;flex-direction:column;gap:3px;color:#fff;text-align:center;white-space:normal;background:linear-gradient(150deg,#202946,#11172b);border-color:rgba(255,255,255,.08);box-shadow:0 14px 30px -11px rgba(14,20,39,.62)}.dark .aim-root .aim-card{background:linear-gradient(150deg,#34405f,#1b233a)}.aim-root-label{font-size:14px;font-weight:750}.aim-root-sub{color:#aab5d4;font-size:9px}
      .aim-branch .aim-card{min-width:145px;padding:10px 11px;border-left:4px solid var(--accent)}.aim-branch .aim-label{max-width:205px;font-size:12px;font-weight:700}.aim-mid .aim-card{padding:8px 10px;background:color-mix(in srgb,var(--accent) 8%,var(--card));border-color:color-mix(in srgb,var(--accent) 24%,var(--line))}.aim-mid .aim-label{max-width:200px;font-size:11px;font-weight:650}.aim-leaf .aim-card{max-width:225px;padding:8px 11px;align-items:flex-start;flex-direction:column;gap:2px;white-space:normal;border-left:2px solid color-mix(in srgb,var(--accent) 62%,var(--line))}.aim-leaf .aim-label{font-size:11px;line-height:1.35;font-weight:550}.aim-detail{color:var(--muted);font-size:9px}.aim-label{overflow:hidden;text-overflow:ellipsis}.aim-dot{width:6px;height:6px;flex:none;background:var(--accent);border-radius:50%}.aim-count{padding:1px 6px;color:var(--muted);background:var(--bg);border-radius:99px;font-size:9px}.aim-toggle{width:18px;height:18px;display:grid;place-items:center;flex:none;padding:0;color:var(--muted);background:transparent;border:0;border-radius:5px;cursor:pointer;transition:transform .16s}.aim-toggle.open{transform:rotate(90deg)}.aim-node.match .aim-card{outline:2px solid #e8a63d;outline-offset:2px}
      .aim{height:clamp(420px,68vh,680px);min-height:420px}.aim.aim-fill{height:100%;min-height:0;max-height:100%}.aim-head{display:none}
      .aim-node{cursor:move}.aim-node:has(button:hover){cursor:default}
      .aim-node{pointer-events:auto;transition:left 240ms cubic-bezier(.22,.61,.36,1),top 240ms cubic-bezier(.22,.61,.36,1),opacity 180ms ease,transform 180ms ease}.aim-node.aim-opening,.aim-node.aim-closing{opacity:0;transform:translate(-50%,-50%) scale(.92)}.aim-edge{transition:opacity 180ms ease}.aim-canvas.aim-layout-transition .aim-edge{transition:d 240ms cubic-bezier(.22,.61,.36,1),opacity 180ms ease}.aim-edge.aim-opening,.aim-edge.aim-closing{opacity:0!important}
      .aim-leaf .aim-card{width:240px;min-width:240px;max-width:240px;flex:none}.aim-leaf .aim-label{width:100%;overflow-wrap:break-word;word-break:normal}
      .aim-branch .aim-card,.aim-mid .aim-card{width:260px;min-width:260px;max-width:260px;white-space:normal}.aim-branch .aim-label,.aim-mid .aim-label{min-width:0;max-width:none;flex:1;overflow:visible;text-overflow:clip;white-space:normal;overflow-wrap:break-word;word-break:normal}
      @media(max-width:760px){.aim-branch .aim-card,.aim-mid .aim-card{width:220px;min-width:220px;max-width:220px}}
      @media(max-width:760px){.aim-leaf .aim-card{width:210px;min-width:210px;max-width:210px}}
      .aim-canvas .aim-node{transition:opacity 180ms ease,transform 180ms ease}.aim-canvas.aim-layout-transition .aim-node{transition:left 240ms cubic-bezier(.22,.61,.36,1),top 240ms cubic-bezier(.22,.61,.36,1),opacity 180ms ease,transform 180ms ease}
      .aim-world{width:auto;height:auto;pointer-events:none;will-change:auto;text-rendering:geometricPrecision;-webkit-font-smoothing:antialiased}.aim-world svg{overflow:visible}
      .aim-legend,.aim-controls{position:absolute;z-index:4;color:var(--muted);background:var(--panel);border:1px solid var(--line);box-shadow:0 8px 24px rgba(20,24,40,.12)}.aim-legend{left:16px;bottom:16px;display:flex;gap:8px;padding:8px 11px;border-radius:10px;font-size:10px}.aim-percent{min-width:30px;color:var(--ink);font-variant-numeric:tabular-nums}.aim-controls{right:16px;bottom:16px;display:flex;flex-direction:column;gap:4px;padding:5px;border-radius:11px}.aim-control{width:32px;height:32px;display:grid;place-items:center;padding:0;color:var(--muted);background:transparent;border:0;border-radius:7px;cursor:pointer}.aim-control:hover{color:var(--ink);background:var(--soft)}.aim-divider{height:1px;margin:2px 4px;background:var(--line)}@media(max-width:760px){.aim{height:560px;min-height:480px;border-radius:14px}.aim-head{gap:9px;padding:11px}.aim-stats{display:none}.aim-search{width:38vw}.aim-title{max-width:30vw}.aim-sub{display:none}.aim-legend span:not(:first-child){display:none}}
    `}</style>
    <header className="aim-head"><div className="aim-title-wrap"><div className="aim-mark"><Share2 size={16} /></div><div><div className="aim-title" title={root.label}>{root.label}</div><div className="aim-sub">Interactive concept map</div></div></div><div className="aim-stats"><span><b>{root.children.length}</b> branches</span><span><b>{count(root)}</b> topics</span></div><label className="aim-search"><Search size={14} /><input aria-label="Search the map" placeholder="Search the map." value={search} onChange={(event) => setSearch(event.target.value)} />{search && <button type="button" aria-label="Clear search" onClick={() => setSearch("")}><X size={14} /></button>}</label></header>
    <div ref={viewportRef} className={`aim-canvas ${dragging ? "drag" : ""} ${layoutTransition ? "aim-layout-transition" : ""}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd}>
      <div className="aim-world" style={{ width: worldWidth, height: worldHeight, transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${scale})` }}>
        <svg width={worldWidth} height={worldHeight} aria-hidden="true">{edges.map(({ from, to }) => { const fromPosition = positionFor(from), toPosition = positionFor(to), fromX = centerX + fromPosition.x, fromY = centerY + fromPosition.y, toX = centerX + toPosition.x, toY = centerY + toPosition.y, middle = (fromX + toX) / 2; const dim = searching && !to.matched && !to.hasMatch; const opening = openingNodeIds.has(from.id) || openingNodeIds.has(to.id), closing = closingNodeIds.has(from.id) || closingNodeIds.has(to.id); return <path key={`${from.id}-${to.id}`} className={`aim-edge ${opening ? "aim-opening" : ""} ${closing ? "aim-closing" : ""}`} d={`M ${fromX} ${fromY} C ${middle} ${fromY}, ${middle} ${toY}, ${toX} ${toY}`} fill="none" stroke={to.color} strokeWidth={to.depth === 1 ? 2.7 : to.depth === 2 ? 1.9 : 1.2} strokeLinecap="round" opacity={dim ? .06 : to.depth === 1 ? .58 : to.depth === 2 ? .44 : .32} />; })}</svg>
        {nodes.map((node) => { const kind = node.depth === 0 ? "root" : node.depth === 1 ? "branch" : node.children.length ? "mid" : "leaf"; const dim = searching && !node.matched && !node.hasMatch && node.depth !== 0; const position = positionFor(node); const opening = openingNodeIds.has(node.id), closing = closingNodeIds.has(node.id); const style = { left: centerX + position.x, top: centerY + position.y, "--accent": node.color } as React.CSSProperties; return <div key={node.id} data-node-id={node.id} className={`aim-node aim-${kind} ${dim ? "dim" : ""} ${searching && node.matched ? "match" : ""} ${opening ? "aim-opening" : ""} ${closing ? "aim-closing" : ""}`} style={style}><div className="aim-card" title={node.label}>{kind === "root" ? <><div className="aim-root-label">{node.label}</div><div className="aim-root-sub">Concept overview</div></> : <>{kind === "branch" && <span className="aim-dot" />}<span className="aim-label">{node.label}</span>{node.children.length > 0 && <><span className="aim-count">{node.children.length}</span><button type="button" className={`aim-toggle ${node.collapsed ? "" : "open"}`} onClick={() => toggle(node.id)} aria-label={`${node.collapsed ? "Expand" : "Collapse"} ${node.label}`}><ChevronRight size={12} /></button></>}{kind === "leaf" && node.detail && <span className="aim-detail">{node.detail}</span>}</>}</div></div>; })}
      </div>
      <div className="aim-legend" aria-hidden="true"><span className="aim-percent">{Math.round(scale * 100)}%</span><span>ú</span><span>scroll to zoom, drag to pan</span></div>
      <div className="aim-controls" aria-label="Map controls"><button type="button" className="aim-control" onClick={() => zoomAt(1.2)} title="Zoom in"><ZoomIn size={16} /></button><button type="button" className="aim-control" onClick={() => zoomAt(.8)} title="Zoom out"><ZoomOut size={16} /></button><div className="aim-divider" /><button type="button" className="aim-control" onClick={requestFitView} title="Fit to screen"><Maximize2 size={16} /></button><div className="aim-divider" /><button type="button" className="aim-control" onClick={expandAll} title="Expand all"><Expand size={16} /></button><button type="button" className="aim-control" onClick={collapseAll} title="Collapse all"><Shrink size={16} /></button></div>
    </div>
  </section>;
}
