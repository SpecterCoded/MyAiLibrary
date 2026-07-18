import type { SimulationNodeDatum, SimulationLinkDatum } from "d3";

export interface GraphNode extends SimulationNodeDatum {
  id: string; // Unique identifier (typically slug of post or word)
  title: string; // Human-friendly title
  type:
    | "concept"
    | "note"
    | "post"
    | "video"
    | "pdf"
    | "audio"
    | "docx"
    | "chapter"
    | "sub-chapter"
    | "subchapter"
    | "project"
    | "tag"
    | "system"
    | "database"
    | "node"; // Category
  content: string; // Markdown summary / body of the node
  size?: number; // Visual override size
  tags?: string[]; // Connections tags
  updatedAt?: string; // Date of last edit
  createdAt?: string; // Date of creation
}

export interface GraphLink extends SimulationLinkDatum<GraphNode> {
  id: string;
  source: string | GraphNode;
  target: string | GraphNode;
  weight?: number; // Strength or multiplier for this link
  linkType?: "contain" | "reference" | "default";
  label?: string;
}

export interface PhysicsConfig {
  chargeStrength: number; // Node repulsion (-100 to 0 or positive for attraction)
  linkDistance: number; // Target distance for links
  linkStrength: number; // Restoring force of links (0 to 1)
  collisionRadius: number; // Prevention of overlapping (0 to 100)
  gravity: number; // Force pulling nodes to the center
  bounceEnabled: boolean; // Keep nodes inside container bounds
  velocityDecay: number; // Drag or friction (0 to 1)
}

export interface CategoryInfo {
  label: string;
  color: string;
  hoverColor: string;
  borderColor: string;
  glowColor: string;
  size: number;
  icon: string;
}

export const CATEGORY_MAP: Record<GraphNode["type"], CategoryInfo> = {
  concept: {
    label: "Concept",
    color: "#d9730d",
    hoverColor: "#a35306",
    borderColor: "#fadec9",
    glowColor: "rgba(217, 115, 13, 0.4)",
    size: 20, // Big parent style node
    icon: "Lightbulb",
  },
  note: {
    label: "Note",
    color: "#4b5563",
    hoverColor: "#374151",
    borderColor: "#e5e7eb",
    glowColor: "rgba(75, 85, 99, 0.3)",
    size: 12,
    icon: "BookOpen", // Distinct icon for Note
  },
  post: {
    label: "Page",
    color: "#78716c",
    hoverColor: "#57534e",
    borderColor: "#f5f5f4",
    glowColor: "rgba(120, 113, 108, 0.3)",
    size: 13,
    icon: "FileText",
  },
  video: {
    label: "Video",
    color: "#ef4444",
    hoverColor: "#dc2626",
    borderColor: "#fee2e2",
    glowColor: "rgba(239, 68, 68, 0.4)",
    size: 12,
    icon: "Video",
  },
  pdf: {
    label: "PDF Document",
    color: "#ea580c",
    hoverColor: "#ca8a04",
    borderColor: "#ffedd5",
    glowColor: "rgba(234, 88, 12, 0.4)",
    size: 12,
    icon: "FileText",
  },
  audio: {
    label: "Audio Podcast",
    color: "#8b5cf6",
    hoverColor: "#7c3aed",
    borderColor: "#f5f3ff",
    glowColor: "rgba(139, 92, 246, 0.4)",
    size: 12,
    icon: "Volume2",
  },
  docx: {
    label: "Docx File",
    color: "#2563eb",
    hoverColor: "#1d4ed8",
    borderColor: "#dbeafe",
    glowColor: "rgba(37, 99, 235, 0.4)",
    size: 12,
    icon: "File",
  },
  chapter: {
    label: "Chapter",
    color: "#0d9488",
    hoverColor: "#0f766e",
    borderColor: "#ccfbf1",
    glowColor: "rgba(13, 148, 136, 0.4)",
    size: 15,
    icon: "BookOpen",
  },
  "sub-chapter": {
    label: "Sub-chapter",
    color: "#0891b2",
    hoverColor: "#0e7490",
    borderColor: "#cffafe",
    glowColor: "rgba(8, 145, 178, 0.4)",
    size: 13,
    icon: "Book",
  },
  subchapter: {
    label: "Subchapter",
    color: "#0891b2",
    hoverColor: "#0e7490",
    borderColor: "#cffafe",
    glowColor: "rgba(8, 145, 178, 0.3)",
    size: 13,
    icon: "Book",
  },
  project: {
    label: "Project",
    color: "#337ea9",
    hoverColor: "#1d587c",
    borderColor: "#d3e5ef",
    glowColor: "rgba(51, 126, 169, 0.4)",
    size: 14,
    icon: "Folder",
  },
  tag: {
    label: "Tag",
    color: "#16a34a",
    hoverColor: "#15803d",
    borderColor: "#dbeddb",
    glowColor: "rgba(22, 163, 74, 0.3)",
    size: 10,
    icon: "Hash",
  },
  system: {
    label: "System",
    color: "#cb912f",
    hoverColor: "#9c6d1d",
    borderColor: "#fdecc8",
    glowColor: "rgba(203, 145, 47, 0.3)",
    size: 12,
    icon: "Cpu",
  },
  database: {
    label: "Database",
    color: "#78350f",
    hoverColor: "#451a03",
    borderColor: "#fdecc8",
    glowColor: "rgba(120, 53, 15, 0.3)",
    size: 12,
    icon: "Database",
  },
  node: {
    label: "Node",
    color: "#71717a",
    hoverColor: "#52525b",
    borderColor: "#f4f4f5",
    glowColor: "rgba(113, 113, 122, 0.3)",
    size: 11,
    icon: "Circle",
  },
};
