export type ConceptKind = "concept" | "definition" | "example" | "warning" | "advanced" | "chapter" | "subchapter";
export type Difficulty = "Beginner" | "Intermediate" | "Advanced";
export type RelationshipType = string;

export interface KnowledgeConcept {
  id: string;
  title: string;
  kind: ConceptKind;
  definition: string;
  summary: string;
  confidence: number;
  difficulty: Difficulty;
  importance: number;
  learningStage: string;
  chapter: string;
  firstMention: string;
  lastMention: string;
  mentions: number;
  studyMinutes: number;
  aliases: string[];
  prerequisites: string[];
  relatedIds: string[];
  favorite: boolean;
  pinned: boolean;
  nodeType?: "concept" | "chapter" | "subchapter";
  sectionId?: string;
  resourceId?: string;
  resourceTitle?: string;
  resourceType?: string;
  startSeconds?: number;
  endSeconds?: number;
  x: number;
  y: number;
}

export interface KnowledgeRelationship {
  id: string;
  source: string;
  target: string;
  type: RelationshipType;
  confidence: number;
  edgeKind?: "covers" | "semantic";
  discussionDuration?: number;
  occurrenceRole?: string;
  startSeconds?: number;
  endSeconds?: number;
  evidence?: Array<{ text: string; start_seconds: number; end_seconds: number }>;
}

export interface LearningTimelineItem {
  id: string;
  conceptId: string;
  timestamp: string;
  chapter: string;
  confidence: number;
  difficulty: Difficulty;
  stage: string;
}

export interface KnowledgeStatistic {
  id: string;
  label: string;
  value: string;
  detail: string;
  icon: "concepts" | "relationships" | "stages" | "confidence" | "topics" | "difficulty" | "chapters" | "status";
  tone: "blue" | "purple" | "green" | "orange";
}

export interface KnowledgeDataset {
  resourceId: string;
  title: string;
  eyebrow: string;
  subtitle: string;
  generatedAt: string;
  processingStatus: string;
  statistics: KnowledgeStatistic[];
  concepts: KnowledgeConcept[];
  relationships: KnowledgeRelationship[];
  timeline: LearningTimelineItem[];
}

export interface KnowledgeFiltersState {
  confidence: "all" | "80+" | "90+";
  difficulty: "all" | Difficulty;
  chapter: string;
  kind: "all" | ConceptKind;
  relationship: "all" | RelationshipType;
  importance: "all" | "high";
  favoritesOnly: boolean;
}

export type GraphLayout = "organic" | "radial" | "learning";
export type ExplorerSort = "teaching-order" | "confidence" | "frequency" | "importance" | "alphabetical";

export interface KnowledgeGraphHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  fit: () => void;
}
