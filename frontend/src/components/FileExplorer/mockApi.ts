import type { ExplorerItem } from "./types";

const INITIAL_ITEMS: ExplorerItem[] = [
  { id: "dir-1", name: "Dashboards", type: "folder", modifiedDate: "2026-05-12" },
  { id: "dir-2", name: "Inspirations", type: "folder", modifiedDate: "2026-06-01" },
  { id: "dir-3", name: "Mobile Apps", type: "folder", modifiedDate: "2026-06-08" },
  { 
    id: "file-1", 
    name: "Image.jpg", 
    type: "image", 
    thumbnailUrl: "https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=120&auto=format&fit=crop&q=80",
    size: "1.2 MB",
    modifiedDate: "2026-06-09"
  },
  { 
    id: "file-2", 
    name: "Laptop-Mockup.jpg", 
    type: "image", 
    thumbnailUrl: "https://images.unsplash.com/photo-1531403009284-440f080d1e12?w=120&auto=format&fit=crop&q=80",
    size: "3.4 MB",
    modifiedDate: "2026-06-10"
  },
];

// Simple in-memory storage to simulate a server
let serverItems: ExplorerItem[] = [...INITIAL_ITEMS];

export const mockApi = {
  fetchItems: async (): Promise<ExplorerItem[]> => {
    // Simulate minimal network delay
    await new Promise(resolve => setTimeout(resolve, 150));
    return [...serverItems];
  },
  uploadFiles: async (files: File[]): Promise<ExplorerItem[]> => {
    // Simulate minimal network delay
    await new Promise(resolve => setTimeout(resolve, 200));
    
    const newItems: ExplorerItem[] = files.map(file => ({
      id: `file-${Math.random().toString(36).substr(2, 9)}`,
      name: file.name,
      type: file.type.startsWith("image/") ? "image" : (file.type.startsWith("video/") ? "video" : "folder" as any), // simplified
      size: `${(file.size / (1024 * 1024)).toFixed(2)} MB`,
      modifiedDate: new Date().toISOString().split('T')[0],
      thumbnailUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined
    }));

    serverItems = [...newItems, ...serverItems];
    return newItems;
  },
  simulateExternalChanges: () => {
    const isFolder = Math.random() > 0.5;
    const newItem: ExplorerItem = {
      id: `ext-${Math.random().toString(36).substr(2, 9)}`,
      name: isFolder ? "New External Folder" : "External Image.jpg",
      type: isFolder ? "folder" : "image",
      size: isFolder ? undefined : "2.4 MB",
      modifiedDate: new Date().toISOString().split('T')[0],
      thumbnailUrl: isFolder ? undefined : "https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=120&auto=format&fit=crop&q=80"
    };
    serverItems = [newItem, ...serverItems];
  }
};
