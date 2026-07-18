export type NoteStatus = 'active' | 'draft' | 'deleted';

export interface Note {
  id: string;
  title: string;
  content: any;
  folderId: string | null;
  status: NoteStatus;
  isFavorite: boolean;
  tags: { label: string; colorClass: string; bgClass: string }[];
  playlistId?: string | null;
  links?: string[]; // IDs of linked notes
  createdAt: number;
  updatedAt: number;
  icon: string | null;
}

export interface Folder {
  id: string;
  name: string;
  icon?: string | React.ReactNode;
  parentId: string | null;
  isPlaylist?: boolean;
  playlistId?: string | null;
  isDeleted?: boolean;
}
