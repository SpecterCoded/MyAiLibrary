import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { Network, Search } from 'lucide-react';

type GraphNode = {
  id: string;
  label: string;
  type: 'playlist' | 'folder' | 'note' | 'video' | 'audio' | 'pdf' | 'file' | 'image';
  icon?: string;
  folderId?: string;
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

type DbFolder = {
  id: string;
  name: string;
  parent_id: string | null;
  playlist_id: string | null;
  is_deleted: number;
};

type DbNote = {
  id: string;
  title: string;
  folder_id: string | null;
  playlist_id: string | null;
  status: string;
  icon?: string;
};

type DbResource = {
  id: string;
  title: string;
  type: string;
  folder_id: string | null;
  is_deleted: number;
};

type MappedFolder = {
  id: string;
  name: string;
  parentId: string | null;
  isPlaylist: boolean;
};

type MappedNote = {
  id: string;
  title: string;
  folderId: string | null;
  status: string;
  icon?: string;
};

type MappedResource = {
  id: string;
  title: string;
  folderId: string | null;
  type: 'video' | 'audio' | 'pdf' | 'file' | 'image';
  icon?: string;
};

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

export default function GlobalGraphCanvas() {
  const [notes, setNotes] = useState<MappedNote[]>([]);
  const [folders, setFolders] = useState<MappedFolder[]>([]);
  const [resources, setResources] = useState<MappedResource[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const svgRef = useRef<SVGSVGElement>(null);

  // Load Notebook App data from endpoints on mount
  useEffect(() => {
    const loadNotebookData = async () => {
      try {
        const [playlistsRes, foldersRes, notesRes, resourcesRes] = await Promise.all([
          apiFetch('/playlists'),
          apiFetch('/folders?all_folders=true'),
          apiFetch('/notes'),
          apiFetch('/resources')
        ]);
        const playlistsData = await playlistsRes.json();
        const dbFoldersData: DbFolder[] = await foldersRes.json();
        const dbNotesData: DbNote[] = await notesRes.json();
        const dbResourcesData: DbResource[] = await resourcesRes.json();

        // 1. Map Playlists & Custom Folders (keep "root" but rename as "Resources")
        const ownedPlaylistIds = new Set(playlistsData.map((pl: any) => pl.id));
        const ownedFolderIds = new Set<string>();
        for (const cf of dbFoldersData) {
          if (cf.playlist_id && ownedPlaylistIds.has(cf.playlist_id)) {
            ownedFolderIds.add(cf.id);
          }
        }

        const mappedFolders: MappedFolder[] = [];
        for (const pl of playlistsData) {
          mappedFolders.push({
            id: pl.id,
            name: pl.name,
            parentId: null,
            isPlaylist: true
          });
        }
        for (const cf of dbFoldersData) {
          // Filter out folders belonging to playlists the user doesn't own
          if (cf.playlist_id && !ownedPlaylistIds.has(cf.playlist_id)) {
            continue;
          }
          // Skip the backend-only 'root' folder to prevent redundancy, but keep Notes, Media, Resources
          if (cf.name.toLowerCase() === 'root') {
            continue;
          }

          const dbParent = dbFoldersData.find((f) => f.id === cf.parent_id);
          const parentIsRoot = dbParent && dbParent.name.toLowerCase() === 'root';
          const parentId = parentIsRoot ? cf.playlist_id : (cf.parent_id || cf.playlist_id || null);

          mappedFolders.push({
            id: cf.id,
            name: cf.name,
            parentId: parentId,
            isPlaylist: false
          });
        }
        // Build a lookup: root folder id -> playlist_id
        // Root folders are hidden in the graph, so we redirect resources in them to their playlist
        const rootFolderToPlaylist: Record<string, string> = {};
        for (const cf of dbFoldersData) {
          if (cf.name.toLowerCase() === 'root' && cf.playlist_id && ownedPlaylistIds.has(cf.playlist_id)) {
            rootFolderToPlaylist[cf.id] = cf.playlist_id;
          }
        }

        // Also build a set of all visible folder IDs (non-root) for resolving note/resource parents
        const visibleFolderIds = new Set<string>();
        for (const cf of dbFoldersData) {
          if (cf.name.toLowerCase() !== 'root' && cf.playlist_id && ownedPlaylistIds.has(cf.playlist_id)) {
            visibleFolderIds.add(cf.id);
          }
        }
        for (const pl of playlistsData) {
          visibleFolderIds.add(pl.id);
        }

        setFolders(mappedFolders);

        // 2. Map Notes - resolve folder_id to the best visible parent
        const mappedNotes: MappedNote[] = dbNotesData
          .filter((note) => {
            const hasOwnedPlaylist = note.playlist_id && ownedPlaylistIds.has(note.playlist_id);
            const hasOwnedFolder = note.folder_id && ownedFolderIds.has(note.folder_id);
            return hasOwnedPlaylist || hasOwnedFolder;
          })
          .map((note) => {
            let folderId = note.folder_id || note.playlist_id || null;
            // If the note's folder_id is a root folder, point to playlist instead
            if (folderId && rootFolderToPlaylist[folderId]) {
              folderId = rootFolderToPlaylist[folderId];
            }
            return {
              id: note.id,
              title: note.title || 'Untitled',
              folderId,
              status: note.status || 'active',
              icon: note.icon || '\u{1F4C4}'
            };
          });
        setNotes(mappedNotes);

        // 3. Map Resources - resolve folder_id; if pointing to root, redirect to playlist
        const mappedResources: MappedResource[] = dbResourcesData
          .filter((res) => res.is_deleted !== 1 && res.folder_id && ownedFolderIds.has(res.folder_id))
          .map((res) => {
            let resType: 'video' | 'audio' | 'pdf' | 'file' | 'image' = 'file';
            const typeLower = (res.type || '').toLowerCase();
            let icon = '\u{1F4C4}';

            if (typeLower.includes('image') || ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(typeLower)) {
              resType = 'image';
              icon = '\u{1F5BC}\uFE0F';
            } else if (typeLower.includes('video') || typeLower === 'youtube' || ['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(typeLower)) {
              resType = 'video';
              icon = '\u{1F3A5}';
            } else if (typeLower.includes('audio') || ['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a'].includes(typeLower)) {
              resType = 'audio';
              icon = '\u{1F3B5}';
            } else if (typeLower === 'pdf') {
              resType = 'pdf';
              icon = '\u{1F4D5}';
            }

            // Resolve folderId: if root folder -> use playlist_id; if no folder -> null
            let folderId = res.folder_id || null;
            if (folderId && rootFolderToPlaylist[folderId]) {
              folderId = rootFolderToPlaylist[folderId];
            }

            return {
              id: res.id,
              title: res.title || 'Untitled Resource',
              folderId,
              type: resType,
              icon: icon
            };
          });
        setResources(mappedResources);
      } catch (err) {
        console.error("Failed to load global notebook graph data:", err);
      } finally {
        setIsLoading(false);
      }
    };
    loadNotebookData();
  }, []);

  const activeNotes = notes.filter((n) => n.status === 'active');

  const buildGraphData = () => {
    let nodesList: GraphNode[] = [];
    let linksList: GraphLink[] = [];

    const term = searchTerm.trim().toLowerCase();

    const playlists = folders.filter((f) => f.isPlaylist);
    const subfolders = folders.filter((f) => !f.isPlaylist);

    for (const pl of playlists) {
      if (term && !pl.name.toLowerCase().includes(term)) continue;
      nodesList.push({ id: pl.id, label: pl.name, type: 'playlist', radius: 32 });
    }

    for (const sf of subfolders) {
      if (term && !sf.name.toLowerCase().includes(term)) continue;
      nodesList.push({ id: sf.id, label: sf.name, type: 'folder', radius: 24 });
      const parentId = sf.parentId;
      if (parentId) {
        linksList.push({ source: parentId, target: sf.id });
      }
    }

    for (const note of activeNotes) {
      if (term && !(note.title || 'Untitled').toLowerCase().includes(term)) continue;
      nodesList.push({ id: note.id, label: note.title || 'Untitled', type: 'note', icon: note.icon || undefined, radius: 18 });
      const parentId = note.folderId;
      if (parentId) {
        linksList.push({ source: parentId, target: note.id });
      }
    }

    for (const res of resources) {
      if (term && !res.title.toLowerCase().includes(term)) continue;
      nodesList.push({
        id: res.id,
        label: res.title,
        type: res.type,
        icon: res.icon,
        folderId: res.folderId || undefined,
        radius: 18
      });
      const parentId = res.folderId;
      if (parentId) {
        linksList.push({ source: parentId, target: res.id });
      }
    }

    const nodeIds = new Set(nodesList.map((n) => n.id));
    linksList = linksList.filter((l) => nodeIds.has(l.source) && nodeIds.has(l.target));

    return { nodes: nodesList, links: linksList };
  };

  useEffect(() => {
    if (!svgRef.current || isLoading) return;

    const el = svgRef.current;
    const width = el.clientWidth || 900;
    const height = el.clientHeight || 600;

    d3.select(el).selectAll('*').remove();

    const { nodes, links } = buildGraphData();

    if (nodes.length === 0) return;

    const svg = d3.select(el).attr('viewBox', [0, 0, width, height]);

    // Background
    svg.append('rect')
      .attr('width', width)
      .attr('height', height)
      .attr('fill', '#FCFCF9');

    const g = svg.append('g');

    // Zoom
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.15, 4])
      .on('zoom', (event) => g.attr('transform', event.transform));
    svg.call(zoom);
    svg.on('dblclick.zoom', () =>
      svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity)
    );

    const colorMap: Record<string, string> = {
      playlist: '#37352F',
      folder: '#6E6C68',
      note: '#FFFFFF',
      video: '#FFFFFF',
      audio: '#FFFFFF',
      pdf: '#FFFFFF',
      image: '#FFFFFF',
      file: '#FFFFFF',
    };
    const strokeMap: Record<string, string> = {
      playlist: '#37352F',
      folder: '#EFEFED',
      note: '#EFEFED',
      video: '#FCA5A5',
      audio: '#C084FC',
      pdf: '#F87171',
      image: '#86EFAC',
      file: '#D1D5DB',
    };

    const simulation = d3.forceSimulation(nodes as any)
      .force('link', d3.forceLink(links).id((d: any) => d.id).distance((l: any) => {
        const source = nodes.find((n) => n.id === (typeof l.source === 'object' ? l.source.id : l.source));
        const target = nodes.find((n) => n.id === (typeof l.target === 'object' ? l.target.id : l.target));
        if (!source || !target) return 120;
        if (source.type === 'playlist' && target.type === 'folder') return 100;
        if (source.type === 'folder' && ['note', 'video', 'audio', 'pdf', 'image', 'file'].includes(target.type)) return 70;
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
        const source = nodes.find((n) => n.id === (typeof l.source === 'object' ? l.source.id : l.source));
        if (source?.type === 'playlist') return '#37352F';
        if (source?.type === 'folder') return '#9A9A97';
        return '#EFEFED';
      })
      .attr('stroke-width', (l: any) => {
        const source = nodes.find((n) => n.id === (typeof l.source === 'object' ? l.source.id : l.source));
        if (source?.type === 'playlist') return 2;
        return 1.5;
      })
      .attr('stroke-dasharray', (l: any) => {
        const source = nodes.find((n) => n.id === (typeof l.source === 'object' ? l.source.id : l.source));
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
      .attr('r', (d) => d.radius)
      .attr('fill', (d) => colorMap[d.type] || '#FFF')
      .attr('stroke', (d) => strokeMap[d.type] || '#EFEFED')
      .attr('stroke-width', (d) => d.type === 'playlist' ? 0 : 2)
      .style('filter', (d) => d.type === 'playlist' ? 'drop-shadow(0 4px 12px rgba(55,53,47,0.25))' : 'drop-shadow(0 2px 6px rgba(0,0,0,0.08))');

    // Emoji/icon for notes & resources
    node.filter((d) => ['note', 'video', 'audio', 'pdf', 'image', 'file'].includes(d.type))
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', '13px')
      .style('pointer-events', 'none')
      .text((d) => d.icon || '📄');

    // Type indicator icon text for playlists/folders
    node.filter((d) => d.type === 'playlist')
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', '18px')
      .style('pointer-events', 'none')
      .text('🗂️');

    node.filter((d) => d.type === 'folder')
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', '15px')
      .style('pointer-events', 'none')
      .text('📁');

    // Labels
    node.append('text')
      .attr('y', (d) => d.radius + 14)
      .attr('text-anchor', 'middle')
      .attr('font-family', 'Inter, sans-serif')
      .attr('font-size', (d) => d.type === 'playlist' ? '13px' : '12px')
      .attr('font-weight', (d) => d.type === 'playlist' ? '600' : '400')
      .attr('fill', '#37352F')
      .attr('class', 'graph-node-label')
      .text((d) => d.label.length > 18 ? d.label.slice(0, 16) + '…' : d.label)
      .clone(true).lower()
      .attr('fill', 'none')
      .attr('stroke', 'rgba(252,252,249,0.9)')
      .attr('stroke-width', 4)
      .attr('stroke-linejoin', 'round');

    // Click handler to redirect back to Notebook App with state
    node.on('click', (event, d) => {
      event.stopPropagation();
      if (d.type === 'note') {
        localStorage.setItem('open_note_id', d.id);
        window.dispatchEvent(new Event('open-notebook-view'));
      } else if (d.type === 'folder' || d.type === 'playlist') {
        localStorage.setItem('open_folder_id', d.id);
        window.dispatchEvent(new Event('open-notebook-view'));
      } else if (['video', 'audio', 'pdf', 'image', 'file'].includes(d.type)) {
        if (d.folderId) {
          localStorage.setItem('open_folder_id', d.folderId);
        }
        window.dispatchEvent(new Event('open-notebook-view'));
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

    simulation.on('tick', () => {
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);

      node.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
    });

    return () => { simulation.stop(); };
  }, [notes, folders, resources, searchTerm, isLoading]);

  const { nodes: allNodes } = buildGraphData();
  const playlistCount = allNodes.filter((n) => n.type === 'playlist').length;
  const folderCount = allNodes.filter((n) => n.type === 'folder').length;
  const noteCount = allNodes.filter((n) => n.type === 'note').length;
  const videoCount = allNodes.filter((n) => n.type === 'video').length;
  const audioCount = allNodes.filter((n) => n.type === 'audio').length;
  const pdfCount = allNodes.filter((n) => n.type === 'pdf').length;
  const fileCount = allNodes.filter((n) => ['file', 'image'].includes(n.type)).length;

  return (
    <div className="flex flex-col h-full bg-[#FCFCF9] relative flex-1 text-sans select-none">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-4 border-b border-[#EFEFED] bg-white z-10 shrink-0">
        <div className="flex items-center gap-3">
          <Network size={20} className="text-[#37352F]" />
          <span className="text-[16px] font-semibold text-[#37352F]">Global View</span>
          <div className="flex flex-wrap items-center gap-2 ml-4">
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#37352F] text-white">{playlistCount} playlists</span>
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#EFEFED] text-[#6E6C68]">{folderCount} folders</span>
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#EFEFED] text-[#6E6C68]">{noteCount} notes</span>
            {videoCount > 0 && <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#FEE2E2] text-[#EF4444]">{videoCount} videos</span>}
            {audioCount > 0 && <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#FAF5FF] text-[#8B5CF6]">{audioCount} audios</span>}
            {pdfCount > 0 && <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#FEF2F2] text-[#EF4444]">{pdfCount} pdfs</span>}
            {fileCount > 0 && <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#F3F4F6] text-[#6B7280]">{fileCount} files</span>}
          </div>
        </div>

        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9A9A97]" />
          <input
            type="text"
            placeholder="Filter graph..."
            className="pl-9 pr-4 py-1.5 w-64 bg-[#F9F9F8] border border-[#EFEFED] rounded-md text-[14px] outline-none focus:border-[#d9d9d6] transition-colors"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-6 px-8 py-2 border-b border-[#EFEFED] bg-[#FAFAF8] text-[12px] text-[#9A9A97] overflow-x-auto whitespace-nowrap shrink-0">
        <div className="flex items-center gap-1.5 shrink-0"><span className="w-3 h-3 rounded-full bg-[#37352F] inline-block" /> Playlist</div>
        <div className="flex items-center gap-1.5 shrink-0"><span className="w-3 h-3 rounded-full bg-[#6E6C68] inline-block" /> Folder</div>
        <div className="flex items-center gap-1.5 shrink-0"><span className="w-3 h-3 rounded-full border-2 border-[#EFEFED] bg-white inline-block" /> Note</div>
        <div className="flex items-center gap-1.5 shrink-0"><span className="w-3 h-3 rounded-full border-2 border-[#FCA5A5] bg-white inline-block" /> Video</div>
        <div className="flex items-center gap-1.5 shrink-0"><span className="w-3 h-3 rounded-full border-2 border-[#C084FC] bg-white inline-block" /> Audio</div>
        <div className="flex items-center gap-1.5 shrink-0"><span className="w-3 h-3 rounded-full border-2 border-[#F87171] bg-white inline-block" /> PDF</div>
        <div className="flex items-center gap-1.5 shrink-0"><span className="w-3 h-3 rounded-full border-2 border-[#86EFAC] bg-white inline-block" /> Image</div>
        <div className="flex items-center gap-1.5 shrink-0"><span className="w-3 h-3 rounded-full border-2 border-[#D1D5DB] bg-white inline-block" /> File</div>
        <div className="ml-auto text-[11px] shrink-0">Click to open in notebook · Double-click background to reset zoom · Drag to pan</div>
      </div>

      {/* Graph SVG */}
      <div className="flex-1 w-full h-full relative overflow-hidden">
        <svg ref={svgRef} className="w-full h-full block cursor-grab active:cursor-grabbing" />

        {isLoading ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-[#9A9A97] bg-white/80">
            <p className="text-[15px] font-medium">Loading notebook graph...</p>
          </div>
        ) : allNodes.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-[#9A9A97]">
            <Network size={48} className="mb-4 opacity-30" />
            <p className="text-[15px] font-medium">No items to display</p>
            <p className="text-[13px] mt-1">Create playlists, folders, and notes in the notebook page to see them here</p>
          </div>
        )}
      </div>
    </div>
  );
}
