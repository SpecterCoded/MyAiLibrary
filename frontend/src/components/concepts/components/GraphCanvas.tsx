import React, { useRef, useEffect, useState } from "react";
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCenter,
  forceCollide,
} from "d3";
import type { Simulation } from "d3";
import type { GraphNode, GraphLink, PhysicsConfig } from "../types";
import { CATEGORY_MAP } from "../types";
import { ZoomIn, ZoomOut, RotateCcw, Play, Pause, Hand, MousePointerClick } from "lucide-react";

interface GraphCanvasProps {
  nodes: GraphNode[];
  links: GraphLink[];
  physics: PhysicsConfig;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  onAddLink?: (sourceId: string, targetId: string) => void;
  onUpdateLink?: (sourceId: string, targetId: string, type: 'contain' | 'reference') => void;
  onUnlink?: (sourceId: string, targetId: string) => void;
  onDeleteNode?: (nodeId: string) => void;
  onNodeDoubleClick?: (nodeId: string) => void;
  showControlNotice?: boolean;
  driftStrength?: number;
  simulationAlphaTarget?: number;
}

export default function GraphCanvas({
  nodes,
  links,
  physics,
  selectedNodeId,
  onSelectNode,
  onAddLink,
  onUpdateLink,
  onUnlink,
  onDeleteNode,
  onNodeDoubleClick,
  showControlNotice = true,
  driftStrength = 0.035,
  simulationAlphaTarget = 0.1,
}: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simulationRefByD3 = useRef<Simulation<GraphNode, GraphLink> | null>(null);
  const drawRef = useRef<(() => void) | null>(null);

  const getLinkEndpointId = (endpoint: string | GraphNode) =>
    typeof endpoint === "object" ? endpoint.id : endpoint;

  const resolveLinkNode = (endpoint: string | GraphNode) => {
    const endpointId = getLinkEndpointId(endpoint);
    return nodes.find((node) => node.id === endpointId) || null;
  };

  const createSimulationLinks = () =>
    links.map((link) => ({
      ...link,
      source: getLinkEndpointId(link.source),
      target: getLinkEndpointId(link.target),
    }));

  // Interaction States
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [zoomScale, setZoomScale] = useState(0.8);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);

  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [isSimulating, setIsSimulating] = useState(true);
  // Mirror in a ref so global (window) drag listeners read the live value
  // instead of a stale closure, keeping continuous flow consistent.
  const isSimulatingRef = useRef(isSimulating);
  useEffect(() => { isSimulatingRef.current = isSimulating; }, [isSimulating]);
  const [initialRecentered, setInitialRecentered] = useState(false);

  useEffect(() => {
    if (nodes.length > 0 && dimensions.width > 0 && !initialRecentered) {
      recenterGraph();
      setInitialRecentered(true);
    }
  }, [nodes, dimensions.width, dimensions.height, initialRecentered]);

  // Refs for tracking mouse pan/drag variables during animation frames to avoid visual lag in state updates
  const interactionRef = useRef({
    draggingNode: null as GraphNode | null,
    isPanning: false,
    isLinking: false,
    linkSourceNode: null as GraphNode | null,
    linkTargetX: 0,
    linkTargetY: 0,
    panStartX: 0,
    panStartY: 0,
    offsetX: 0,
    offsetY: 0,
    zoomScale: 0.8,
  });

  // Track sync with state
  useEffect(() => {
    interactionRef.current.offsetX = offsetX;
    interactionRef.current.offsetY = offsetY;
    interactionRef.current.zoomScale = zoomScale;
  }, [offsetX, offsetY, zoomScale]);

  // Handle ResizeObserver
  useEffect(() => {
    if (!containerRef.current) return;
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setDimensions({ width: width || 800, height: height || 600 });
      }
    });
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // Recenter Graph Viewport Helper
  // Animated Viewport Helper
  const animateViewport = (targetScale: number, targetOffsetX: number, targetOffsetY: number) => {
    const startScale = interactionRef.current.zoomScale;
    const startOffsetX = interactionRef.current.offsetX;
    const startOffsetY = interactionRef.current.offsetY;
    const duration = 600; // duration in ms for a smooth look
    const startTime = performance.now();

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Easing: easeInOutCubic
      const ease = progress < 0.5 
        ? 4 * progress * progress * progress 
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;

      const currentScale = startScale + (targetScale - startScale) * ease;
      const currentOffsetX = startOffsetX + (targetOffsetX - startOffsetX) * ease;
      const currentOffsetY = startOffsetY + (targetOffsetY - startOffsetY) * ease;

      setZoomScale(currentScale);
      setOffsetX(currentOffsetX);
      setOffsetY(currentOffsetY);

      if (progress < 1) {
        requestAnimationFrame(step);
      }
    };

    requestAnimationFrame(step);
  };

  // Recenter Graph Viewport Helper
  const recenterGraph = () => {
    const positionedNodes = nodes.filter((node) => Number.isFinite(node.x) && Number.isFinite(node.y));
    let targetScale = 0.82;
    let targetOffsetX = dimensions.width / 2;
    let targetOffsetY = dimensions.height / 2;

    if (positionedNodes.length) {
      const minX = Math.min(...positionedNodes.map((node) => node.x || 0));
      const maxX = Math.max(...positionedNodes.map((node) => node.x || 0));
      const minY = Math.min(...positionedNodes.map((node) => node.y || 0));
      const maxY = Math.max(...positionedNodes.map((node) => node.y || 0));
      const graphWidth = Math.max(160, maxX - minX);
      const graphHeight = Math.max(160, maxY - minY);
      const padding = 96;
      const scaleX = (dimensions.width - padding) / graphWidth;
      const scaleY = (dimensions.height - padding) / graphHeight;
      targetScale = Math.max(0.18, Math.min(1.15, Math.min(scaleX, scaleY)));
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      targetOffsetX = dimensions.width / 2 - centerX * targetScale;
      targetOffsetY = dimensions.height / 2 - centerY * targetScale;
    }
    
    animateViewport(targetScale, targetOffsetX, targetOffsetY);

    // Boost simulation
    if (simulationRefByD3.current) {
      simulationRefByD3.current.alpha(1).restart();
    }
  };

  // Initialize and update simulation nodes and links
  useEffect(() => {
    // Instantiate or refresh simulation
    const sim = simulationRefByD3.current || forceSimulation<GraphNode>();
    simulationRefByD3.current = sim;

    sim.nodes(nodes);

    // Custom gentle drift force
    const driftForce = () => {
      let time = 0;
      let currentNodes: GraphNode[] = [];
      const force = () => {
        time += 0.012; // slow increment for smooth flowing movement
        currentNodes.forEach((node, idx) => {
          if (node.fx !== undefined && node.fx !== null) return;
          // Generate a smooth sinusoidal drift unique to each node
          const angle = (idx * 0.7 + time) % (Math.PI * 2);
          const driftSpeed = driftStrength;
          node.vx = (node.vx || 0) + Math.cos(angle) * driftSpeed;
          node.vy = (node.vy || 0) + Math.sin(angle) * driftSpeed;
        });
      };
      force.initialize = (initNodes: GraphNode[]) => {
        currentNodes = initNodes;
      };
      return force;
    };

    // Apply standard simulation physics based on physics configurations
    sim
      .force(
        "charge",
        forceManyBody<GraphNode>().strength(physics.chargeStrength)
      )
      .force(
        "link",
        forceLink<GraphNode, GraphLink>(createSimulationLinks())
          .id((d) => d.id)
          .distance(physics.linkDistance)
          .strength(physics.linkStrength)
      )
      .force(
        "center",
        forceCenter<GraphNode>(0, 0)
      )
      .force(
        "collision",
        forceCollide<GraphNode>().radius((d) => {
          const typeInfo = CATEGORY_MAP[d.type];
          const baseSize = d.size || typeInfo.size;
          return baseSize + physics.collisionRadius;
        })
      )
      .force("drift", driftForce())
      .velocityDecay(physics.velocityDecay);

    if (isSimulating) {
      // Hold a small alphaTarget so the layout never fully freezes â€” gives the
      // continuous, smooth "flowing" motion by default. Pause sets it to 0.
      sim.alphaTarget(simulationAlphaTarget).alpha(Math.max(0.08, simulationAlphaTarget * 4)).restart();
    } else {
      sim.alphaTarget(0);
      sim.stop();
    }

    // Viewport will be centered dynamically by useEffect once ready

    return () => {
      // Don't fully destroy to maintain visual layout state, just pause on unmount
      sim.stop();
    };
  }, [nodes, links, dimensions.width, dimensions.height, isSimulating, driftStrength, simulationAlphaTarget]);

  // Separate effect to handle live sliding physics coefficients without resetting node arrays
  useEffect(() => {
    const sim = simulationRefByD3.current;
    if (!sim) return;

    sim
      .force("charge", forceManyBody<GraphNode>().strength(physics.chargeStrength))
      .force(
        "link",
        forceLink<GraphNode, GraphLink>(createSimulationLinks())
          .id((d) => d.id)
          .distance(physics.linkDistance)
          .strength(physics.linkStrength)
      )
      .force(
        "collision",
        forceCollide<GraphNode>().radius((d) => {
          const typeInfo = CATEGORY_MAP[d.type];
          return (d.size || typeInfo.size) + physics.collisionRadius;
        })
      )
      .velocityDecay(physics.velocityDecay);

    if (isSimulating) {
      sim.alpha(0.3).restart();
    }
  }, [physics, isSimulating]);

  // Main canvas animation and drawing loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;

    const draw = () => {
      // Clear canvas with deep transparent slate colors
      ctx.clearRect(0, 0, dimensions.width, dimensions.height);

      ctx.save();
      // Apply translated zoom/pan transforms
      ctx.translate(interactionRef.current.offsetX, interactionRef.current.offsetY);
      ctx.scale(interactionRef.current.zoomScale, interactionRef.current.zoomScale);

      // 1. Draw Links (Edges) first so they are behind nodes
      links.forEach((link) => {
        const sourceNode = resolveLinkNode(link.source);
        const targetNode = resolveLinkNode(link.target);

        if (!sourceNode || !targetNode) return;
        if (sourceNode.x === undefined || sourceNode.y === undefined || targetNode.x === undefined || targetNode.y === undefined) return;

        // Check highlight states
        const isSelectedLink = selectedNodeId === sourceNode.id || selectedNodeId === targetNode.id;
        const isHoveredLink = hoveredNodeId === sourceNode.id || hoveredNodeId === targetNode.id;

        const isAnyFocusActive = selectedNodeId !== null || hoveredNodeId !== null;

        ctx.beginPath();
        ctx.moveTo(sourceNode.x, sourceNode.y);
        ctx.lineTo(targetNode.x, targetNode.y);

        if (isSelectedLink || isHoveredLink) {
          // Glow highlighting path
          ctx.strokeStyle = isSelectedLink ? "#3b82f6" : "#60a5fa";
          ctx.lineWidth = 1.8 / interactionRef.current.zoomScale;
          ctx.globalAlpha = 0.7;
        } else {
          // Soft faded background paths
          ctx.strokeStyle = "#e2e8f0";
          ctx.lineWidth = 1.0 / interactionRef.current.zoomScale;
          ctx.globalAlpha = isAnyFocusActive ? 0.08 : 0.28;
        }

        const linkType = (link as any).linkType || 'default';
        if (linkType === 'contain') {
          ctx.setLineDash([]);
          ctx.strokeStyle = isSelectedLink ? "#3b82f6" : "rgba(43, 89, 255, 0.4)";
        } else if (linkType === 'reference') {
          ctx.setLineDash([5 / interactionRef.current.zoomScale, 5 / interactionRef.current.zoomScale]);
          ctx.strokeStyle = isSelectedLink ? "#60a5fa" : "rgba(120, 119, 116, 0.5)";
        } else {
          ctx.setLineDash([]);
        }

        ctx.stroke();
        ctx.setLineDash([]); // Reset line dash

        // Draw directional arrow for typed links
        if (linkType === 'contain' || linkType === 'reference') {
           const dx = targetNode.x - sourceNode.x;
           const dy = targetNode.y - sourceNode.y;
           const angle = Math.atan2(dy, dx);
           // Calculate target radius (use category size roughly)
           const targetCat = CATEGORY_MAP[targetNode.type];
           const targetRadius = (targetNode.size || targetCat.size) + 4; 
           const headlen = 8 / interactionRef.current.zoomScale; 

           const endX = targetNode.x - targetRadius * Math.cos(angle);
           const endY = targetNode.y - targetRadius * Math.sin(angle);

           ctx.beginPath();
           ctx.moveTo(endX, endY);
           ctx.lineTo(endX - headlen * Math.cos(angle - Math.PI / 6), endY - headlen * Math.sin(angle - Math.PI / 6));
           ctx.lineTo(endX - headlen * Math.cos(angle + Math.PI / 6), endY - headlen * Math.sin(angle + Math.PI / 6));
           ctx.closePath();
           ctx.fillStyle = ctx.strokeStyle;
           ctx.globalAlpha = isSelectedLink ? 1.0 : (isAnyFocusActive ? 0.2 : 0.6);
           ctx.fill();

           // Draw beautiful high-contrast link label pill
           const midX = (sourceNode.x + targetNode.x) / 2;
           const midY = (sourceNode.y + targetNode.y) / 2;

           ctx.save();
           ctx.font = "500 9px Inter, sans-serif";
           const labelText = (link as any).label || (linkType === 'contain' ? "contain" : "reference");
           const labelWidth = ctx.measureText(labelText).width;
           const px = 5;
           const py = 2.5;

           ctx.fillStyle = "rgba(255, 255, 255, 0.94)";
           ctx.strokeStyle = isSelectedLink ? "#3b82f6" : "rgba(226, 232, 240, 0.95)";
           ctx.lineWidth = 1;

           const rx = midX - labelWidth / 2 - px;
           const ry = midY - 6.5;
           const rw = labelWidth + px * 2;
           const rh = 13;

           ctx.beginPath();
           if (ctx.roundRect) {
             ctx.roundRect(rx, ry, rw, rh, 3.5);
           } else {
             ctx.rect(rx, ry, rw, rh);
           }
           ctx.fill();
           ctx.stroke();

           ctx.fillStyle = isSelectedLink 
             ? "#1d4ed8" 
             : linkType === 'contain' 
               ? "#2563eb" 
               : "#52525b";
           ctx.textAlign = "center";
           ctx.textBaseline = "middle";
           ctx.globalAlpha = isSelectedLink ? 1.0 : (isAnyFocusActive ? 0.28 : 0.88);
           ctx.fillText(labelText, midX, midY);
           ctx.restore();
        }
      });

      // Draw linking preview preview line
      if (interactionRef.current.isLinking && interactionRef.current.linkSourceNode) {
        const source = interactionRef.current.linkSourceNode;
        if (source.x !== undefined && source.y !== undefined) {
          ctx.beginPath();
          ctx.moveTo(source.x, source.y);
          ctx.lineTo(interactionRef.current.linkTargetX, interactionRef.current.linkTargetY);
          ctx.strokeStyle = "#60a5fa";
          ctx.lineWidth = 1.5 / interactionRef.current.zoomScale;
          ctx.setLineDash([5 / interactionRef.current.zoomScale, 5 / interactionRef.current.zoomScale]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // Reset alpha
      ctx.globalAlpha = 1.0;

      // 2. Draw Nodes (glowing background circles and then content)
      nodes.forEach((node) => {
        if (node.x === undefined || node.y === undefined) return;

        const categoryInfo = CATEGORY_MAP[node.type];
        const baseSize = node.size || categoryInfo.size;

        const isSelected = selectedNodeId === node.id;
        const isHovered = hoveredNodeId === node.id;

        const isAnyHoverOrSelect = selectedNodeId !== null || hoveredNodeId !== null;
        const isInFocusPath =
          isSelected ||
          isHovered ||
          links.some((l) => {
            const sid = typeof l.source === "object" ? (l.source as GraphNode).id : l.source;
            const tid = typeof l.target === "object" ? (l.target as GraphNode).id : l.target;
            const partnerId = sid === node.id ? tid : tid === node.id ? sid : null;
            return partnerId !== null && (partnerId === selectedNodeId || partnerId === hoveredNodeId);
          });

        // Apply fading if other nodes are focused
        if (isAnyHoverOrSelect && !isInFocusPath) {
          ctx.globalAlpha = 0.25;
        } else {
          ctx.globalAlpha = 1.0;
        }

        // Draw selection radiating halo
        if (isSelected || isHovered) {
          ctx.beginPath();
          const pulse = 1 + Math.sin(Date.now() / 180) * 0.12;
          const auraRadius = baseSize * (isSelected ? 2.5 : 2.0) * pulse;

          const grad = ctx.createRadialGradient(
            node.x,
            node.y,
            baseSize * 0.7,
            node.x,
            node.y,
            auraRadius
          );
          grad.addColorStop(0, categoryInfo.glowColor);
          grad.addColorStop(1, "rgba(255, 255, 255, 0)");

          ctx.fillStyle = grad;
          ctx.arc(node.x, node.y, auraRadius, 0, Math.PI * 2);
          ctx.fill();
        }

        // Draw solid base circle outline shadow
        ctx.beginPath();
        ctx.arc(node.x, node.y, baseSize, 0, Math.PI * 2);
        ctx.fillStyle = categoryInfo.borderColor;
        ctx.fillStyle = isSelected ? "#ffffff" : categoryInfo.color;
        ctx.shadowBlur = isSelected ? 12 : isHovered ? 6 : 0;
        ctx.shadowColor = categoryInfo.color;
        ctx.fill();

        // Reset shadow
        ctx.shadowBlur = 0;

        // Overlay core dot
        ctx.beginPath();
        ctx.arc(node.x, node.y, baseSize * 0.75, 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? categoryInfo.color : "#ffffff";
        ctx.fill();

        // Draw centered dark core dot for tags
        if (node.type === "tag") {
          ctx.beginPath();
          ctx.arc(node.x, node.y, baseSize * 0.35, 0, Math.PI * 2);
          ctx.fillStyle = isSelected ? "#ffffff" : categoryInfo.color;
          ctx.fill();
        }

        // 3. Draw Typography Labels with smart adaptive details LoD
        const curScale = interactionRef.current.zoomScale;
        const shoudDrawText = isSelected || isHovered || curScale > 0.65 || (curScale > 0.4 && baseSize > 12);

        if (shoudDrawText) {
          ctx.save();
          // Text styles
          ctx.fillStyle = isSelected ? "#37352f" : "#5a5a56";
          ctx.font = isSelected
            ? "500 13px Inter, sans-serif"
            : isHovered
            ? "500 12px Inter, sans-serif"
            : "400 11px Inter, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "top";

          const labelOffset = baseSize + 6;

          // Draw a soft rounded background capsule for labels to ensure 100% contrast over dense links
          const title = node.title;
          const textWidth = ctx.measureText(title).width;
          const padX = 6;
          const padY = 3.5;
          const rx = node.x - textWidth / 2 - padX;
          const ry = node.y + labelOffset - padY;
          const rw = textWidth + padX * 2;
          const rh = 15 + padY * 2;

          ctx.fillStyle = "rgba(255, 255, 255, 0.88)";
          if (isSelected) {
            ctx.fillStyle = "rgba(241, 245, 249, 0.98)";
            ctx.strokeStyle = categoryInfo.color;
            ctx.lineWidth = 1;
          }

          // Rounded capsule drawing path
          ctx.beginPath();
          const radius = Number(Math.min(5, rw / 2, rh / 2));
          ctx.roundRect ? ctx.roundRect(rx, ry, rw, rh, radius) : ctx.rect(rx, ry, rw, rh);
          ctx.fill();
          if (isSelected) ctx.stroke();

          // Write human label
          ctx.fillStyle = isSelected ? "#1e293b" : "#475569";
          ctx.fillText(title, node.x, node.y + labelOffset);

          // Render miniature secondary tags under nodes if zoomed in close
          if (curScale >= 1.25 && node.tags && node.tags.length > 0) {
            ctx.font = "400 9px Inter, sans-serif";
            ctx.fillStyle = "#9b9a97";
            ctx.fillText(
              node.tags.map((t) => `#${t}`).join(" "),
              node.x,
              node.y + labelOffset + 18
            );
          }

          ctx.restore();
        }
      });

      // Reset total opacity
      ctx.globalAlpha = 1.0;

      ctx.restore();

      // Trigger standard physics simulation loop tick update
      if (simulationRefByD3.current && isSimulating) {
        // Continue loop recursively
        animationFrameId = requestAnimationFrame(draw);
      } else {
        // Redraw single static frame if paused
        ctx.save();
        ctx.restore();
      }
    };

    // Run draw recursively
    if (isSimulating) {
      animationFrameId = requestAnimationFrame(draw);
    } else {
      draw();
    }

    // Attach simulation updates trigger connection repaint
    if (simulationRefByD3.current) {
      simulationRefByD3.current.on("tick", () => {
        if (!isSimulating) {
          draw();
        }
      });
    }

    drawRef.current = draw;

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [nodes, links, dimensions, selectedNodeId, hoveredNodeId, isSimulating]);

  // Separate effect to trigger repaints while paused when offsets/zoom scale change
  useEffect(() => {
    if (!isSimulating && drawRef.current) {
      drawRef.current();
    }
  }, [offsetX, offsetY, zoomScale, isSimulating]);

  // Handle Keyboard Shortcuts for linking and unlinking
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      
      if (!selectedNodeId) return;

      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (onDeleteNode) onDeleteNode(selectedNodeId);
        return;
      }

      if (e.key.toLowerCase() === 's' || e.key === 'Enter') {
        if (onNodeDoubleClick) onNodeDoubleClick(selectedNodeId);
        return;
      }

      if (hoveredNodeId && hoveredNodeId !== selectedNodeId) {
        if (e.key.toLowerCase() === 'c') {
          if (onUpdateLink) onUpdateLink(selectedNodeId, hoveredNodeId, 'contain');
        } else if (e.key.toLowerCase() === 'r') {
          if (onUpdateLink) onUpdateLink(selectedNodeId, hoveredNodeId, 'reference');
        } else if (e.key.toLowerCase() === 'u') {
          if (onUnlink) onUnlink(selectedNodeId, hoveredNodeId);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNodeId, hoveredNodeId, onUpdateLink, onUnlink, onDeleteNode, onNodeDoubleClick]);

  // Helper to translate native MouseEvents to virtual canvas coordinates
  const getCanvasCoordsFromNative = (e: MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0, mx: 0, my: 0 };
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const virtX = (mx - interactionRef.current.offsetX) / interactionRef.current.zoomScale;
    const virtY = (my - interactionRef.current.offsetY) / interactionRef.current.zoomScale;

    return { x: virtX, y: virtY, mx, my };
  };

  // Handle Global MouseEvents (mousemove, mouseup) to support seamless dragging/panning outside canvas bounds
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      // 0. Update Linking Coordinates
      if (interactionRef.current.isLinking && interactionRef.current.linkSourceNode) {
        const { x, y } = getCanvasCoordsFromNative(e);
        interactionRef.current.linkTargetX = x;
        interactionRef.current.linkTargetY = y;
        
        const hitNode = findNodeAtCoords(x, y);
        if (hitNode && hitNode !== interactionRef.current.linkSourceNode) {
           setHoveredNodeId(hitNode.id);
        } else {
           setHoveredNodeId(null);
        }
        return;
      }

      // 1. Mouse Dragging Node calculation
      if (interactionRef.current.draggingNode) {
        const { x, y } = getCanvasCoordsFromNative(e);
        const node = interactionRef.current.draggingNode;

        // Wrap coordinate boundaries to keep nodes inside layout box
        let targetX = x;
        let targetY = y;

        if (physics.bounceEnabled) {
          const minX = (40 - interactionRef.current.offsetX) / interactionRef.current.zoomScale;
          const maxX = (dimensions.width - 40 - interactionRef.current.offsetX) / interactionRef.current.zoomScale;
          const minY = (40 - interactionRef.current.offsetY) / interactionRef.current.zoomScale;
          const maxY = (dimensions.height - 40 - interactionRef.current.offsetY) / interactionRef.current.zoomScale;

          targetX = Math.max(minX, Math.min(maxX, targetX));
          targetY = Math.max(minY, Math.min(maxY, targetY));
        }

        node.fx = targetX;
        node.fy = targetY;

        if (simulationRefByD3.current) {
          simulationRefByD3.current.alpha(0.3).restart();
        }
        return;
      }

      // 2. Viewport Panning offset calculation
      if (interactionRef.current.isPanning) {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        const newOffsetX = mx - interactionRef.current.panStartX;
        const newOffsetY = my - interactionRef.current.panStartY;
        setOffsetX(newOffsetX);
        setOffsetY(newOffsetY);
        return;
      }
    };

    const handleGlobalMouseUp = (e: MouseEvent) => {
      if (
        interactionRef.current.isLinking ||
        interactionRef.current.draggingNode ||
        interactionRef.current.isPanning
      ) {
        // Check if connecting nodes (only if released over the canvas area)
        if (interactionRef.current.isLinking && interactionRef.current.linkSourceNode) {
           const { x, y } = getCanvasCoordsFromNative(e);
           const hitNode = findNodeAtCoords(x, y);
           
           // Check if released within canvas bounds
           const canvas = canvasRef.current;
           if (canvas) {
             const rect = canvas.getBoundingClientRect();
             const inBounds = e.clientX >= rect.left && e.clientX <= rect.right &&
                              e.clientY >= rect.top && e.clientY <= rect.bottom;
             
             if (inBounds && hitNode && hitNode.id !== interactionRef.current.linkSourceNode.id && onAddLink) {
               onAddLink(interactionRef.current.linkSourceNode.id, hitNode.id);
             }
           }
        }

        // Release Dragged nodes
        if (interactionRef.current.draggingNode) {
          const node = interactionRef.current.draggingNode;
          node.fx = null;
          node.fy = null;
          interactionRef.current.draggingNode = null;

          if (simulationRefByD3.current) {
            simulationRefByD3.current.alphaTarget(isSimulatingRef.current ? simulationAlphaTarget : 0);
          }
        }

        // Terminate panning & linking
        interactionRef.current.isPanning = false;
        interactionRef.current.isLinking = false;
        interactionRef.current.linkSourceNode = null;
      }
    };

    window.addEventListener("mousemove", handleGlobalMouseMove);
    window.addEventListener("mouseup", handleGlobalMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleGlobalMouseMove);
      window.removeEventListener("mouseup", handleGlobalMouseUp);
    };
  }, [dimensions, physics.bounceEnabled, onAddLink, simulationAlphaTarget]);

  // Translate Mouse Window coordinates to virtual Canvas Coordinates
  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0, mx: 0, my: 0 };
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Inverse coordinates calculation
    const virtX = (mx - interactionRef.current.offsetX) / interactionRef.current.zoomScale;
    const virtY = (my - interactionRef.current.offsetY) / interactionRef.current.zoomScale;

    return { x: virtX, y: virtY, mx, my };
  };

  // Dynamic Hit Test Finder helper
  const findNodeAtCoords = (virtX: number, virtY: number) => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      if (node.x === undefined || node.y === undefined) continue;

      const categoryInfo = CATEGORY_MAP[node.type];
      const baseSize = node.size || categoryInfo.size;

      const dx = node.x - virtX;
      const dy = node.y - virtY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Hit allowance slightly wider for fat touch/clicking convenience
      if (dist <= baseSize + 9) {
        return node;
      }
    }
    return null;
  };

  // Mouse Interaction Drag, Pan, Select triggers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y, mx, my } = getCanvasCoords(e);
    const hitNode = findNodeAtCoords(x, y);

    if (hitNode) {
      if (e.shiftKey) {
        // Start Linking Mode
        interactionRef.current.isLinking = true;
        interactionRef.current.linkSourceNode = hitNode;
        interactionRef.current.linkTargetX = x;
        interactionRef.current.linkTargetY = y;
        setHoveredNodeId(null);
      } else {
        // Start Dragging Node
        interactionRef.current.draggingNode = hitNode;
        hitNode.fx = hitNode.x;
        hitNode.fy = hitNode.y;

        onSelectNode(hitNode.id);

        if (simulationRefByD3.current) {
          // High alpha restart triggers interactive magnetic snap physics
          simulationRefByD3.current.alphaTarget(0.15).restart();
        }
      }
    } else {
      // Clicked background - deselect node!
      onSelectNode(null);

      // Start Panning Coordinate Map Viewport
      interactionRef.current.isPanning = true;
      interactionRef.current.panStartX = mx - interactionRef.current.offsetX;
      interactionRef.current.panStartY = my - interactionRef.current.offsetY;
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // If active interaction is ongoing, let global handler take care of updates
    if (
      interactionRef.current.draggingNode ||
      interactionRef.current.isPanning ||
      interactionRef.current.isLinking
    ) {
      return;
    }

    const { x, y } = getCanvasCoords(e);

    // Hover highlights hit detection
    const hitNode = findNodeAtCoords(x, y);
    if (hitNode) {
      if (hoveredNodeId !== hitNode.id) {
        setHoveredNodeId(hitNode.id);
      }
    } else {
      if (hoveredNodeId !== null) {
        setHoveredNodeId(null);
      }
    }
  };

  // Double click a node to Pin/Freeze it in place forever
  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasCoords(e);
    const hitNode = findNodeAtCoords(x, y);
    if (hitNode) {
      if (onNodeDoubleClick) onNodeDoubleClick(hitNode.id);
    }
  };

  // Zoom scale scrolling calculations
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      const zoomIntensity = 0.085;
      
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const zoomFactor = e.deltaY < 0 ? 1 + zoomIntensity : 1 - zoomIntensity;
      const nextScale = Math.max(0.18, Math.min(5.0, interactionRef.current.zoomScale * zoomFactor));

      // Center zooming onto current cursor position
      const nextOffsetX = mx - (mx - interactionRef.current.offsetX) * (nextScale / interactionRef.current.zoomScale);
      const nextOffsetY = my - (my - interactionRef.current.offsetY) * (nextScale / interactionRef.current.zoomScale);

      setZoomScale(nextScale);
      setOffsetX(nextOffsetX);
      setOffsetY(nextOffsetY);
    };

    canvas.addEventListener("wheel", handleWheelNative, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", handleWheelNative);
    };
  }, []);

  // Toolbar viewport scale helpers
  const zoomIn = () => {
    const nextScale = Math.min(5.0, zoomScale * 1.3);
    const factor = nextScale / zoomScale;
    setOffsetX(dimensions.width / 2 - (dimensions.width / 2 - offsetX) * factor);
    setOffsetY(dimensions.height / 2 - (dimensions.height / 2 - offsetY) * factor);
    setZoomScale(nextScale);
  };

  const zoomOut = () => {
    const nextScale = Math.max(0.18, zoomScale / 1.3);
    const factor = nextScale / zoomScale;
    setOffsetX(dimensions.width / 2 - (dimensions.width / 2 - offsetX) * factor);
    setOffsetY(dimensions.height / 2 - (dimensions.height / 2 - offsetY) * factor);
    setZoomScale(nextScale);
  };

  return (
    <div
      ref={containerRef}
      id="graph-canvas-container"
      className="relative w-full h-full min-h-[420px] bg-[#fbfbfa] overflow-hidden cursor-grab active:cursor-grabbing select-none"
    >
      {/* Subtle grid background â€” kept BEHIND the nodes (z-0) */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.4] z-0"
        style={{
          backgroundImage: "linear-gradient(var(--canvas-grid-line, #e9e9e7) 1px, transparent 1px), linear-gradient(90deg, var(--canvas-grid-line, #e9e9e7) 1px, transparent 1px)",
          backgroundSize: "32px 32px"
        }}
      />

      <canvas
        ref={canvasRef}
        id="graph-physics-canvas"
        width={dimensions.width}
        height={dimensions.height}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onDoubleClick={handleDoubleClick}
        className="block relative z-[1]"
      />

      {/* Interactive HUD HUD controller overlay */}
      <div id="graph-viewport-toolbar" className="absolute bottom-5 right-5 z-10 flex items-center gap-1 p-1 bg-white rounded border border-[#e9e9e7] shadow-[0_2px_4px_rgba(0,0,0,0.05)]">
        <button
          onClick={zoomIn}
          title="Zoom In"
          className="p-1.5 text-[#787774] hover:text-[#37352f] hover:bg-gray-100 rounded transition-colors"
          id="toolbar-zoom-in"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={zoomOut}
          title="Zoom Out"
          className="p-1.5 text-[#787774] hover:text-[#37352f] hover:bg-gray-100 rounded transition-colors"
          id="toolbar-zoom-out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          onClick={recenterGraph}
          title="Zoom to Fit / Recenter"
          className="p-1.5 text-[#787774] hover:text-[#37352f] hover:bg-gray-100 rounded transition-colors"
          id="toolbar-recenter"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
        <div className="w-[1px] h-4 bg-[#e9e9e7] mx-1" />
        <button
          onClick={() => setIsSimulating(!isSimulating)}
          title={isSimulating ? "Pause Physics Simulation" : "Resume Physics Simulation"}
          className={`p-1.5 rounded transition-colors ${
            isSimulating
              ? "text-[#37352f] bg-gray-100/50 hover:bg-gray-200"
              : "text-[#eb5757] hover:bg-[#ffeaea]"
          }`}
          id="toolbar-toggle-simulation"
        >
          {isSimulating ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>
      </div>

      {/* Floating Indicator Meta Details overlay */}
      <div id="graph-status-overlay" className="absolute top-4 left-4 z-10 p-2 font-mono text-[11px] text-[#9b9a97] space-y-0.5 pointer-events-none opacity-0 hover:opacity-100 transition-opacity">
        <div>ZOOM: {Math.round(zoomScale * 100)}%</div>
        <div>NODES: {nodes.length} | LINKS: {links.length}</div>
      </div>

      {showControlNotice && (
        <div className="absolute bottom-4 left-5 z-10 pointer-events-none text-[12px] text-[#9b9a97] flex items-center gap-1.5 opacity-60">
          <MousePointerClick className="w-3.5 h-3.5" />
          <span>Shift+Drag to Link - Double-click to toggle Pin</span>
        </div>
      )}
    </div>
  );
}

