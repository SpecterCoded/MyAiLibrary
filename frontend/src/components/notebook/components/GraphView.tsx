import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { useAppContext } from '../AppContext';
import { Network, Search } from 'lucide-react';
import type { Note, Folder } from '../types';

type GraphNode = {
  id: string;
  label: string;
  type: 'playlist' | 'folder' | 'note';
  icon?: string;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
  radius: number;
};

type GraphLink = {
  source: any;
  target: any;
};

export function GraphView() {
  const { notes, folders, setCurrentView, setSelectedNoteId, setSelectedFolderId } = useAppContext();
  const [searchTerm, setSearchTerm] = useState('');
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));

  useEffect(() => {
    const root = document.documentElement;
    const syncTheme = () => setIsDark(root.classList.contains('dark'));
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // Active notes for the graph
  const activeNotes = notes.filter(n => n.status === 'active');

  // Build nodes & links from the full hierarchy
  const buildGraphData = () => {
    let nodes: GraphNode[] = [];
    let links: GraphLink[] = [];

    const term = searchTerm.trim().toLowerCase();

    // Playlists
    const playlists = folders.filter(f => f.isPlaylist);
    // Custom subfolders (non-playlist)
    const subfolders = folders.filter(f => !f.isPlaylist);

    for (const pl of playlists) {
      if (term && !pl.name.toLowerCase().includes(term)) continue;
      nodes.push({ id: pl.id, label: pl.name, type: 'playlist', radius: 32 });
    }

    for (const sf of subfolders) {
      if (term && !sf.name.toLowerCase().includes(term)) continue;
      nodes.push({ id: sf.id, label: sf.name, type: 'folder', radius: 24 });
      // Link to parent (folder or playlist)
      const parentId = sf.parentId;
      if (parentId) {
        links.push({ source: parentId, target: sf.id });
      }
    }

    for (const note of activeNotes) {
      if (term && !(note.title || 'Untitled').toLowerCase().includes(term)) continue;
      nodes.push({ id: note.id, label: note.title || 'Untitled', type: 'note', icon: note.icon || undefined, radius: 18 });
      // Link to parent folder or playlist
      const parentId = note.folderId;
      if (parentId) {
        links.push({ source: parentId, target: note.id });
      }
    }

    // Only keep links where both ends exist
    const nodeIds = new Set(nodes.map(n => n.id));
    links = links.filter(l => nodeIds.has(l.source) && nodeIds.has(l.target));

    return { nodes, links };
  };

  useEffect(() => {
    if (!svgRef.current) return;

    const el = svgRef.current;
    const width = el.clientWidth || 900;
    const height = el.clientHeight || 600;

    d3.select(el).selectAll('*').remove();

    const { nodes, links } = buildGraphData();

    if (nodes.length === 0) return;

    const svg = d3.select(el).attr('viewBox', [0, 0, width, height]);

    const graphColors = isDark
      ? {
          canvas: '#25272b',
          playlist: '#1e1f22',
          folder: '#3f4147',
          note: '#313338',
          folderStroke: '#5c5f66',
          noteStroke: '#4e5058',
          label: '#f2f3f5',
          linkStrong: '#949ba4',
          linkSoft: '#5c5f66',
          labelHalo: 'rgba(37,39,43,0.92)',
        }
      : {
          canvas: '#FCFCF9',
          playlist: '#37352F',
          folder: '#6E6C68',
          note: '#FFFFFF',
          folderStroke: '#EFEFED',
          noteStroke: '#EFEFED',
          label: '#37352F',
          linkStrong: '#37352F',
          linkSoft: '#9A9A97',
          labelHalo: 'rgba(252,252,249,0.9)',
        };

    // Background
    svg.append('rect')
      .attr('width', width)
      .attr('height', height)
      .attr('fill', graphColors.canvas);

    const g = svg.append('g');

    // Zoom
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.15, 4])
      .on('zoom', (event) => g.attr('transform', event.transform));
    svg.call(zoom);
    svg.on('dblclick.zoom', () =>
      svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity)
    );

    // Color and fill by type
    const colorMap: Record<string, string> = {
      playlist: graphColors.playlist,
      folder: graphColors.folder,
      note: graphColors.note,
    };
    const strokeMap: Record<string, string> = {
      playlist: graphColors.playlist,
      folder: graphColors.folderStroke,
      note: graphColors.noteStroke,
    };

    // Simulation with clustering by playlist
    const simulation = d3.forceSimulation(nodes as any)
      .force('link', d3.forceLink(links).id((d: any) => d.id).distance((l: any) => {
        // shorter distance between playlist-folder, longer between folder-note
        const source = nodes.find(n => n.id === (typeof l.source === 'object' ? l.source.id : l.source));
        const target = nodes.find(n => n.id === (typeof l.target === 'object' ? l.target.id : l.target));
        if (!source || !target) return 120;
        if (source.type === 'playlist' && target.type === 'folder') return 100;
        if (source.type === 'folder' && target.type === 'note') return 70;
        return 110;
      }))
      .force('charge', d3.forceManyBody().strength((d: any) => {
        if (d.type === 'playlist') return -1200;
        if (d.type === 'folder') return -600;
        return -300;
      }))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide().radius((d: any) => d.radius + 16).iterations(3));

    // Draw links
    const link = g.append('g')
      .attr('stroke-opacity', 0.5)
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke', (l: any) => {
        const source = nodes.find(n => n.id === (typeof l.source === 'object' ? l.source.id : l.source));
        if (source?.type === 'playlist') return graphColors.linkStrong;
        if (source?.type === 'folder') return graphColors.linkSoft;
        return graphColors.noteStroke;
      })
      .attr('stroke-width', (l: any) => {
        const source = nodes.find(n => n.id === (typeof l.source === 'object' ? l.source.id : l.source));
        if (source?.type === 'playlist') return 2;
        return 1.5;
      })
      .attr('stroke-dasharray', (l: any) => {
        const source = nodes.find(n => n.id === (typeof l.source === 'object' ? l.source.id : l.source));
        if (source?.type === 'folder') return '4,3';
        return 'none';
      });

    // Draw nodes
    const node = g.append('g')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .attr('cursor', 'pointer')
      .call(d3.drag<any, any>()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x; d.fy = d.y;
        })
        .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null; d.fy = null;
        })
      );

    // Circles
    node.append('circle')
      .attr('r', d => d.radius)
      .attr('fill', d => colorMap[d.type] || '#FFF')
      .attr('stroke', d => strokeMap[d.type] || '#EFEFED')
      .attr('stroke-width', d => d.type === 'playlist' ? 0 : 2)
      .style('filter', d => d.type === 'playlist' ? 'drop-shadow(0 4px 12px rgba(55,53,47,0.25))' : 'drop-shadow(0 2px 6px rgba(0,0,0,0.08))');

    // Emoji/icon for notes
    node.filter(d => d.type === 'note')
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', '13px')
      .style('pointer-events', 'none')
      .text(d => d.icon || '📄');

    // Type indicator icon text for playlists/folders
    node.filter(d => d.type === 'playlist')
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', '18px')
      .style('pointer-events', 'none')
      .text('🗂️');

    node.filter(d => d.type === 'folder')
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', '15px')
      .style('pointer-events', 'none')
      .text('📁');

    // Labels
    node.append('text')
      .attr('y', d => d.radius + 14)
      .attr('text-anchor', 'middle')
      .attr('font-family', 'Inter, sans-serif')
      .attr('font-size', d => d.type === 'playlist' ? '13px' : '12px')
      .attr('font-weight', d => d.type === 'playlist' ? '600' : '400')
      .attr('fill', graphColors.label)
      .attr('class', 'graph-node-label')
      .text(d => d.label.length > 18 ? d.label.slice(0, 16) + '…' : d.label)
      // White halo behind label for readability
      .clone(true).lower()
      .attr('fill', 'none')
      .attr('stroke', graphColors.labelHalo)
      .attr('stroke-width', 4)
      .attr('stroke-linejoin', 'round');

    // Click handler
    node.on('click', (event, d) => {
      event.stopPropagation();
      if (d.type === 'note') {
        setSelectedNoteId(d.id);
        setCurrentView('note');
      } else if (d.type === 'folder' || d.type === 'playlist') {
        setSelectedFolderId(d.id);
        setCurrentView('folder');
      }
    });

    // Hover highlight
    node.on('mouseenter', function(_, d) {
      d3.select(this).select('circle')
        .transition().duration(150)
        .attr('r', d.radius + 4);
    }).on('mouseleave', function(_, d) {
      d3.select(this).select('circle')
        .transition().duration(150)
        .attr('r', d.radius);
    });

    // Tick
    simulation.on('tick', () => {
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);

      node.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
    });

    return () => { simulation.stop(); };
  }, [activeNotes.length, folders.length, searchTerm, isDark]);

  const { nodes: allNodes } = buildGraphData();
  const playlistCount = allNodes.filter(n => n.type === 'playlist').length;
  const folderCount = allNodes.filter(n => n.type === 'folder').length;
  const noteCount = allNodes.filter(n => n.type === 'note').length;
  const themeColors = isDark
    ? {
        canvas: '#25272b',
        panel: '#2b2d31',
        elevated: '#313338',
        input: '#1e1f22',
        ink: '#f2f3f5',
        muted: '#b5bac1',
        faint: '#949ba4',
        border: 'rgba(255,255,255,0.08)',
        pill: '#3f4147',
      }
    : {
        canvas: '#FCFCF9',
        panel: '#FAFAF8',
        elevated: '#FFFFFF',
        input: '#F9F9F8',
        ink: '#37352F',
        muted: '#6E6C68',
        faint: '#9A9A97',
        border: '#EFEFED',
        pill: '#EFEFED',
      };

  return (
    <div className="flex flex-col h-full relative" style={{ backgroundColor: themeColors.canvas, color: themeColors.ink }}>
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-4 border-b z-10 shrink-0" style={{ borderColor: themeColors.border, backgroundColor: themeColors.elevated }}>
        <div className="flex items-center gap-3">
          <Network size={20} style={{ color: themeColors.ink }} />
          <span className="text-[16px] font-semibold" style={{ color: themeColors.ink }}>Global View</span>
          <div className="flex items-center gap-2 ml-4">
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: isDark ? '#1e1f22' : '#37352F', color: '#ffffff' }}>{playlistCount} playlists</span>
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: themeColors.pill, color: themeColors.muted }}>{folderCount} folders</span>
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: themeColors.pill, color: themeColors.muted }}>{noteCount} notes</span>
          </div>
        </div>

        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: themeColors.faint }} />
          <input
            type="text"
            placeholder="Filter graph..."
            className="pl-9 pr-4 py-1.5 w-64 border rounded-md text-[14px] outline-none transition-colors"
            style={{ backgroundColor: themeColors.input, borderColor: themeColors.border, color: themeColors.ink }}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-6 px-8 py-2 border-b text-[12px]" style={{ borderColor: themeColors.border, backgroundColor: themeColors.panel, color: themeColors.faint }}>
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: isDark ? '#1e1f22' : '#37352F' }} /> Playlist</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: isDark ? '#3f4147' : '#6E6C68' }} /> Folder</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full border-2 inline-block" style={{ borderColor: themeColors.border, backgroundColor: themeColors.elevated }} /> Note</div>
        <div className="ml-auto text-[11px]">Click to open · Double-click background to reset zoom · Drag to pan</div>
      </div>

      {/* Graph SVG */}
      <div className="flex-1 w-full h-full relative overflow-hidden">
        <svg ref={svgRef} className="w-full h-full block cursor-grab active:cursor-grabbing" />

        {allNodes.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ color: themeColors.faint }}>
            <Network size={48} className="mb-4 opacity-30" />
            <p className="text-[15px] font-medium">No items to display</p>
            <p className="text-[13px] mt-1">Create playlists, folders, and notes to see them here</p>
          </div>
        )}
      </div>
    </div>
  );
}
