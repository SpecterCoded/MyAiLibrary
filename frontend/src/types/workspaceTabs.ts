export type WorkspaceTabKind =
  | 'home'
  | 'library'
  | 'folder'
  | 'downloads'
  | 'notebooks'
  | 'concepts'
  | 'chat'
  | 'metrics'
  | 'settings'
  | 'rag-explorer'
  | 'audio-player'
  | 'video-player'
  | 'document-intelligence';

export interface WorkspaceTabParams {
  playlistId?: string;
  playlistName?: string;
  folderId?: string;
  folderName?: string;
  resourceId?: string;
  mediaUrl?: string;
  settingsTab?: string;
  time?: number;
}

export interface WorkspaceTab {
  id: string;
  title: string;
  kind: WorkspaceTabKind;
  params?: WorkspaceTabParams;
  createdAt: number;
  updatedAt: number;
}

export type WorkspaceLayout =
  | { type: 'tabs'; tabIds: string[]; activeTabId: string }
  | { type: 'split'; direction: 'horizontal' | 'vertical'; children: WorkspaceLayout[] };

