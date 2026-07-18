import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Search, Filter, X, ChevronDown,
  Star, Bookmark, Play, FileText, MessageCircle, Layers, HelpCircle, GitBranch,
  Sparkles, Check, Info, List, Copy, Clock, Target, TrendingUp,
  BookOpen, Map as MapIcon, Crosshair, ChevronLeft, ChevronRight, Pencil, Trash2,
} from 'lucide-react';
import KnowledgeGraph from './KnowledgeGraph';
import './knowledge.css';
import type {
  GraphLayout,
  KnowledgeConcept,
  KnowledgeGraphHandle,
  KnowledgeRelationship,
  RelationshipType,
} from './types';

/* =====================================================================================
   TYPES
===================================================================================== */
type NodeType = 'concept' | 'definition' | 'example' | 'warning' | 'advanced' | 'chapter' | 'subchapter';
type Difficulty = 'Beginner' | 'Intermediate' | 'Advanced';
type Theme = 'dark' | 'light';
type DemoMode = 'loading' | 'empty' | 'ready';
type EmptyReason = 'not_generated' | 'no_qualifying_concepts' | 'load_error';
type SortKey = 'name' | 'confidence' | 'difficulty' | 'mentions' | 'chapterId' | 'first' | 'last';

interface ConceptNode {
  id: string; name: string; type: NodeType; chapterId: string; topic: string; x: number; y: number;
  confidence?: number; difficulty?: Difficulty; learningStage?: string; importance?: number;
  first?: string; last?: string; mentions?: number; study?: string; definition?: string; summary?: string;
  prerequisites?: string[]; related?: string[]; aliases?: string[];
  nodeType?: 'concept' | 'chapter' | 'subchapter'; sectionId?: string; resourceId?: string;
  resourceTitle?: string; resourceType?: string; startSeconds?: number; endSeconds?: number;
}
interface ChapterT { id: string; title: string; order: number; start: string; end: string; }
interface EdgeT { id: string; source: string; target: string; label: string; edgeKind?: 'covers' | 'semantic'; confidence?: number; discussionDuration?: number; occurrenceRole?: string; startSeconds?: number; endSeconds?: number; evidence?: Array<{ text: string; start_seconds: number; end_seconds: number }>; }
interface KnowledgeViewCache {
  mode: Exclude<DemoMode, 'loading'>;
  emptyReason: EmptyReason;
  nodes: ConceptNode[];
  edges: EdgeT[];
  chapters: ChapterT[];
  favorites: string[];
  nodeDistance: number;
  graphLayout: GraphLayout;
  groupBy: ExplorerGroup;
  filters: { difficulty: Difficulty[]; types: NodeType[]; favoritesOnly: boolean };
}

let knowledgeViewCache: KnowledgeViewCache | null = null;
interface ConceptReference {
  mention_id: string;
  resource_id: string;
  resource_title: string;
  resource_type: string;
  source_type: string;
  source_id?: string | null;
  role: string;
  evidence_text?: string | null;
  confidence: number;
  jump_target: {
    start_seconds?: number | null;
    end_seconds?: number | null;
  };
}
interface FiltersState {
  difficulty: Set<Difficulty>;
  types: Set<NodeType>;
  favoritesOnly: boolean;
}
type ExplorerGroup = 'none' | 'chapter' | 'type' | 'difficulty' | 'favorite';
type ConceptDialog =
  | { kind: 'rename'; id: string; value: string; busy?: boolean }
  | { kind: 'delete'; id: string; busy?: boolean };

/* =====================================================================================
   MOCK DATA - the entire UI reads from this graph only. Swap for a live extraction
   response later (same shape) and no component below needs to change.
===================================================================================== */
const TYPE_META: Record<NodeType, { label: string; color: string; soft: string }> = {
  concept:    { label: 'Concept',        color: 'var(--k-blue)',   soft: 'var(--k-blue-soft)' },
  definition: { label: 'Definition',     color: 'var(--k-purple)', soft: 'var(--k-purple-soft)' },
  example:    { label: 'Example',        color: 'var(--k-green)',  soft: 'var(--k-green-soft)' },
  warning:    { label: 'Warning',        color: 'var(--k-accent)', soft: 'var(--k-accent-soft)' },
  advanced:   { label: 'Advanced Topic', color: 'var(--k-red)',    soft: 'var(--k-red-soft)' },
  chapter:    { label: 'Chapter',        color: 'var(--k-gray)',   soft: 'var(--k-gray-soft)' },
  subchapter: { label: 'Subchapter',     color: 'var(--k-green)',  soft: 'var(--k-green-soft)' },
};
const DIFF_META: Record<Difficulty, { color: string; soft: string }> = {
  Beginner:     { color: 'var(--k-green)',  soft: 'var(--k-green-soft)' },
  Intermediate: { color: 'var(--k-accent)', soft: 'var(--k-accent-soft)' },
  Advanced:     { color: 'var(--k-red)',    soft: 'var(--k-red-soft)' },
};

const DEMO_CHAPTERS: ChapterT[] = [
  { id: 'ch1', title: 'Market Structure Basics', order: 1, start: '00:00', end: '11:20' },
  { id: 'ch2', title: 'Liquidity & Order Blocks', order: 2, start: '11:20', end: '27:40' },
  { id: 'ch3', title: 'Risk Management',          order: 3, start: '27:40', end: '38:00' },
];

const DEMO_NODES: ConceptNode[] = [
  { id: 'n1', name: 'Market Structure Basics', type: 'chapter', chapterId: 'ch1', topic: 'Market Structure', x: 210, y: 120 },
  { id: 'n2', name: 'Market Structure', type: 'concept', chapterId: 'ch1', topic: 'Market Structure', x: 210, y: 270,
    confidence: 96, difficulty: 'Beginner', learningStage: 'Foundational', importance: 92, first: '00:14', last: '10:40', mentions: 14, study: '6 min',
    definition: 'The observable pattern of higher highs/lows or lower highs/lows that price forms as it trends or ranges over time.',
    summary: 'Establishes the lens for reading price action - every later concept in this lesson (BOS, CHoCH, liquidity) is defined relative to structure.',
    prerequisites: [], related: ['n3', 'n5', 'n23'], aliases: ['Price Structure', 'Trend Structure'] },
  { id: 'n3', name: 'Break of Structure (BOS)', type: 'concept', chapterId: 'ch1', topic: 'Market Structure', x: 400, y: 200,
    confidence: 91, difficulty: 'Intermediate', learningStage: 'Foundational', importance: 88, first: '02:05', last: '09:50', mentions: 11, study: '8 min',
    definition: 'A confirmed close beyond the most recent swing high/low in the direction of the prevailing trend, signalling continuation.',
    summary: 'BOS is the primary continuation signal used to validate that structure is still intact before looking for entries.',
    prerequisites: ['n2'], related: ['n4', 'n5', 'n6'], aliases: ['BOS', 'Structure Break'] },
  { id: 'n4', name: 'BOS Definition', type: 'definition', chapterId: 'ch1', topic: 'Market Structure', x: 590, y: 140,
    confidence: 98, difficulty: 'Beginner', learningStage: 'Foundational', importance: 60, first: '02:05', last: '02:40', mentions: 3, study: '2 min',
    definition: 'A formal close of price beyond a prior swing point, distinguishing real breaks from wicks/liquidity grabs.',
    summary: 'Clarifies the exact candle-close criteria the instructor uses so BOS isn\'t confused with a wick-based false break.',
    prerequisites: ['n3'], related: ['n3'], aliases: [] },
  { id: 'n5', name: 'Change of Character (CHoCH)', type: 'concept', chapterId: 'ch1', topic: 'Market Structure', x: 400, y: 350,
    confidence: 84, difficulty: 'Intermediate', learningStage: 'Foundational', importance: 81, first: '05:10', last: '09:00', mentions: 8, study: '7 min',
    definition: 'The first structural break against the prevailing trend, often the earliest sign of a potential reversal.',
    summary: 'Contrasted directly against BOS in the lesson - same mechanic, opposite implication for directional bias.',
    prerequisites: ['n2'], related: ['n3'], aliases: ['CHoCH', 'Trend Shift'] },
  { id: 'n6', name: 'BOS Example - EUR/USD 4H', type: 'example', chapterId: 'ch1', topic: 'Market Structure', x: 590, y: 300,
    confidence: 93, difficulty: 'Beginner', learningStage: 'Practical', importance: 55, first: '06:40', last: '07:55', mentions: 2, study: '3 min',
    definition: 'Live chart walkthrough of a BOS forming on the EUR/USD 4H chart during the London session.',
    summary: 'Ties the abstract BOS definition to a concrete, timestamped chart so the pattern becomes recognizable.',
    prerequisites: ['n3'], related: ['n3'], aliases: [] },
  { id: 'n7', name: 'Displacement', type: 'concept', chapterId: 'ch1', topic: 'Market Structure', x: 260, y: 440,
    confidence: 78, difficulty: 'Advanced', learningStage: 'Advanced', importance: 66, first: '08:20', last: '10:10', mentions: 6, study: '6 min',
    definition: 'An aggressive, momentum-driven price move that leaves an imbalance behind, usually preceding a Fair Value Gap.',
    summary: 'Bridges structure concepts to the liquidity/FVG chapter - displacement is the mechanism that creates most FVGs.',
    prerequisites: ['n2'], related: ['n11'], aliases: ['Impulse Move'] },
  { id: 'n8', name: 'Liquidity & Order Blocks', type: 'chapter', chapterId: 'ch2', topic: 'Liquidity', x: 760, y: 170 },
  { id: 'n9', name: 'Liquidity', type: 'concept', chapterId: 'ch2', topic: 'Liquidity', x: 720, y: 320,
    confidence: 94, difficulty: 'Beginner', learningStage: 'Foundational', importance: 95, first: '11:40', last: '20:00', mentions: 19, study: '9 min',
    definition: 'Clusters of resting stop-loss and pending orders above/below obvious highs and lows that price is drawn toward.',
    summary: 'The "why" behind most moves in this lesson - nearly every later concept explains how price seeks or reacts to liquidity.',
    prerequisites: ['n2'], related: ['n10', 'n14', 'n13'], aliases: ['Liquidity Pool', 'Stops'] },
  { id: 'n10', name: 'Liquidity Pool Definition', type: 'definition', chapterId: 'ch2', topic: 'Liquidity', x: 900, y: 255,
    confidence: 97, difficulty: 'Beginner', learningStage: 'Foundational', importance: 52, first: '11:55', last: '12:30', mentions: 3, study: '2 min',
    definition: 'A cluster of stop orders resting beyond equal highs/lows, equal to unfilled retail stop placement.',
    summary: 'Sharpens "liquidity" from a vague term into a chart-identifiable object: equal highs/lows.',
    prerequisites: ['n9'], related: ['n9'], aliases: [] },
  { id: 'n11', name: 'Fair Value Gap (FVG)', type: 'concept', chapterId: 'ch2', topic: 'FVG', x: 770, y: 470,
    confidence: 89, difficulty: 'Intermediate', learningStage: 'Foundational', importance: 85, first: '14:10', last: '22:30', mentions: 15, study: '10 min',
    definition: 'A three-candle imbalance where the wicks of candles one and three don\'t overlap, leaving a gap price often returns to fill.',
    summary: 'One of the most-referenced concepts in the lesson; used repeatedly as an entry-refinement tool in chapter 2.',
    prerequisites: ['n7'], related: ['n12', 'n13', 'n19'], aliases: ['FVG', 'Imbalance'] },
  { id: 'n12', name: 'FVG Fill Example - GBP/USD', type: 'example', chapterId: 'ch2', topic: 'FVG', x: 955, y: 430,
    confidence: 90, difficulty: 'Beginner', learningStage: 'Practical', importance: 50, first: '16:20', last: '17:40', mentions: 2, study: '3 min',
    definition: 'Chart walkthrough showing GBP/USD retracing precisely into a 15m FVG before continuing the trend.',
    summary: 'Makes the abstract FVG-fill behaviour concrete with a real, timestamped example.',
    prerequisites: ['n11'], related: ['n11'], aliases: [] },
  { id: 'n13', name: 'Common FVG Mistake', type: 'warning', chapterId: 'ch2', topic: 'FVG', x: 610, y: 570,
    confidence: 82, difficulty: 'Intermediate', learningStage: 'Practical', importance: 70, first: '19:00', last: '19:45', mentions: 3, study: '3 min',
    definition: 'Treating every gap as tradeable - many FVGs form outside liquidity context and don\'t hold as support/resistance.',
    summary: 'A direct instructor warning meant to stop beginners from over-trading every visible gap.',
    prerequisites: ['n11'], related: ['n9', 'n11'], aliases: [] },
  { id: 'n14', name: 'Order Block', type: 'concept', chapterId: 'ch2', topic: 'Order Blocks', x: 920, y: 565,
    confidence: 87, difficulty: 'Intermediate', learningStage: 'Practical', importance: 90, first: '20:15', last: '26:30', mentions: 17, study: '11 min',
    definition: 'The last down/up candle before a displacement move, marking the origin of institutional buying or selling.',
    summary: 'The primary entry model taught in chapter 2 - most of the remaining timeline builds directly on this concept.',
    prerequisites: ['n9'], related: ['n15', 'n16', 'n18', 'n19'], aliases: ['OB', 'Origin Candle'] },
  { id: 'n15', name: 'Order Block Retest Example', type: 'example', chapterId: 'ch2', topic: 'Order Blocks', x: 1100, y: 520,
    confidence: 88, difficulty: 'Intermediate', learningStage: 'Practical', importance: 48, first: '22:50', last: '24:10', mentions: 2, study: '3 min',
    definition: 'Walkthrough of price retesting a bullish order block on USD/JPY before the continuation leg.',
    summary: 'Shows the full entry sequence: OB formed - displacement - retest - continuation.',
    prerequisites: ['n14'], related: ['n14'], aliases: [] },
  { id: 'n16', name: 'Breaker Block', type: 'concept', chapterId: 'ch2', topic: 'Order Blocks', x: 1020, y: 665,
    confidence: 76, difficulty: 'Advanced', learningStage: 'Advanced', importance: 73, first: '23:30', last: '25:50', mentions: 7, study: '8 min',
    definition: 'A failed order block that gets broken through, then flips polarity to act as support/resistance from the opposite side.',
    summary: 'Extends the order block model - instructor frames it as "what happens when an OB fails."',
    prerequisites: ['n14'], related: ['n17'], aliases: ['Breaker'] },
  { id: 'n17', name: 'Mitigation Block Definition', type: 'definition', chapterId: 'ch2', topic: 'Order Blocks', x: 840, y: 705,
    confidence: 85, difficulty: 'Intermediate', learningStage: 'Advanced', importance: 55, first: '25:00', last: '25:40', mentions: 3, study: '3 min',
    definition: 'The precise zone within an order block where institutions are believed to average-in their remaining position.',
    summary: 'Narrows "mitigation" down to an exact price shelf inside a larger order block.',
    prerequisites: ['n16'], related: ['n18'], aliases: [] },
  { id: 'n18', name: 'Mitigation', type: 'concept', chapterId: 'ch2', topic: 'Order Blocks', x: 930, y: 775,
    confidence: 80, difficulty: 'Advanced', learningStage: 'Advanced', importance: 76, first: '25:45', last: '27:20', mentions: 6, study: '7 min',
    definition: 'The act of price returning to an order block or breaker to "mitigate" unfilled institutional orders before continuing.',
    summary: 'Closes out the order-block model taught in chapter 2, directly feeding into risk management in chapter 3.',
    prerequisites: ['n14', 'n17'], related: ['n22'], aliases: ['Mitigation Entry'] },
  { id: 'n19', name: 'Institutional Order Flow', type: 'advanced', chapterId: 'ch2', topic: 'Order Blocks', x: 1170, y: 390,
    confidence: 68, difficulty: 'Advanced', learningStage: 'Mastery', importance: 64, first: '24:40', last: '26:00', mentions: 4, study: '9 min',
    definition: 'The aggregate footprint left by large institutional positioning, inferred through structure, liquidity and imbalance together.',
    summary: 'A synthesis concept - ties FVG, order blocks and liquidity into one narrative of "who is driving this move."',
    prerequisites: ['n11', 'n14'], related: ['n20', 'n24'], aliases: ['Smart Money Flow'] },
  { id: 'n20', name: 'Smart Money Concepts (SMC)', type: 'advanced', chapterId: 'ch2', topic: 'Order Blocks', x: 1320, y: 465,
    confidence: 63, difficulty: 'Advanced', learningStage: 'Mastery', importance: 58, first: '26:00', last: '26:35', mentions: 2, study: '10 min',
    definition: 'The umbrella framework - structure, liquidity, order blocks and imbalance combined - this entire lesson sits inside.',
    summary: 'Named explicitly near the end of chapter 2 as the label for everything taught so far.',
    prerequisites: ['n19'], related: ['n25'], aliases: ['SMC'] },
  { id: 'n21', name: 'Risk Management', type: 'chapter', chapterId: 'ch3', topic: 'Risk', x: 1320, y: 170 },
  { id: 'n22', name: 'Risk Management', type: 'concept', chapterId: 'ch3', topic: 'Risk', x: 1320, y: 300,
    confidence: 95, difficulty: 'Beginner', learningStage: 'Practical', importance: 97, first: '28:00', last: '36:50', mentions: 16, study: '8 min',
    definition: 'The set of position-sizing and stop-placement rules that cap the account damage any single ICT setup can cause.',
    summary: 'The lesson\'s closing thesis: every structural edge taught earlier is worthless without disciplined risk control.',
    prerequisites: ['n18'], related: ['n25', 'n9'], aliases: ['Risk Control'] },
  { id: 'n23', name: 'Premium & Discount', type: 'concept', chapterId: 'ch3', topic: 'Market Structure', x: 1160, y: 230,
    confidence: 79, difficulty: 'Intermediate', learningStage: 'Practical', importance: 69, first: '28:40', last: '31:20', mentions: 6, study: '6 min',
    definition: 'Dividing a swing range into 50% equilibrium, with the upper half "premium" and lower half "discount" for entries.',
    summary: 'Gives risk-management entries a structural filter - only take discount buys, premium sells.',
    prerequisites: ['n2'], related: ['n22'], aliases: ['Equilibrium'] },
  { id: 'n24', name: 'Kill Zone', type: 'concept', chapterId: 'ch3', topic: 'Risk', x: 1440, y: 295,
    confidence: 86, difficulty: 'Beginner', learningStage: 'Practical', importance: 71, first: '32:00', last: '34:15', mentions: 5, study: '5 min',
    definition: 'High-probability time windows (London/NY opens) when institutional order flow is most active and setups are prioritized.',
    summary: 'Adds a time-based filter on top of the price-based concepts taught earlier - when, not just where, to look.',
    prerequisites: ['n19'], related: ['n19'], aliases: ['Session Window'] },
  { id: 'n25', name: 'Overleveraging Risk', type: 'warning', chapterId: 'ch3', topic: 'Risk', x: 1320, y: 420,
    confidence: 92, difficulty: 'Beginner', learningStage: 'Practical', importance: 80, first: '35:00', last: '37:10', mentions: 4, study: '4 min',
    definition: 'Sizing positions beyond what a defined stop can withstand, the single most cited cause of blown accounts in the lesson.',
    summary: 'The lesson\'s strongest warning - delivered right before the closing summary for emphasis.',
    prerequisites: ['n22'], related: ['n20'], aliases: [] },
];

const DEMO_EDGES: EdgeT[] = ([
  ['n1', 'n2', 'Introduces'], ['n2', 'n3', 'Builds On'], ['n3', 'n4', 'Explains'], ['n3', 'n5', 'Contrasts With'],
  ['n3', 'n6', 'Supports'], ['n2', 'n7', 'Related To'], ['n7', 'n11', 'Related To'], ['n8', 'n1', 'Builds On'],
  ['n8', 'n9', 'Introduces'], ['n9', 'n10', 'Explains'], ['n9', 'n14', 'Related To'], ['n8', 'n11', 'Introduces'],
  ['n11', 'n12', 'Supports'], ['n11', 'n13', 'Causes'], ['n9', 'n13', 'Related To'], ['n14', 'n15', 'Supports'],
  ['n14', 'n16', 'Builds On'], ['n16', 'n17', 'Explains'], ['n17', 'n18', 'Explains'], ['n14', 'n18', 'Requires'],
  ['n11', 'n19', 'Builds On'], ['n19', 'n20', 'Builds On'], ['n14', 'n19', 'Related To'], ['n21', 'n8', 'Builds On'],
  ['n21', 'n22', 'Introduces'], ['n22', 'n25', 'Causes'], ['n2', 'n23', 'Related To'], ['n23', 'n22', 'Supports'],
  ['n21', 'n24', 'Introduces'], ['n24', 'n19', 'Uses'], ['n22', 'n9', 'Requires'], ['n20', 'n25', 'Related To'],
] as [string, string, string][]).map(([source, target, label], i) => ({ id: 'e' + i, source, target, label }));

const TIMELINE_ORDER = ['n2', 'n3', 'n9', 'n11', 'n14', 'n16', 'n18', 'n22'];
const LOAD_STAGES = ['Reading Transcript', 'Analyzing Chapters', 'Extracting Concepts', 'Detecting Relationships', 'Building Graph', 'Preparing Visualization'];


function confTier(conf?: number) {
  if (conf === undefined) return 'var(--k-gray)';
  if (conf >= 90) return 'var(--k-green)';
  if (conf >= 75) return 'var(--k-accent)';
  return 'var(--k-red)';
}

/* =====================================================================================
   STYLES - dual theme via [data-k-theme] scoping. Discord-Dark + Glassmorphism-Light.
===================================================================================== */
const STYLES = `
.k-root{overflow-x:hidden;overflow-y:visible;max-width:none;min-width:0;scrollbar-width:none;-ms-overflow-style:none;
  --font-ui:'Inter',system-ui,-apple-system,sans-serif;
  --font-mono:'JetBrains Mono',ui-monospace,monospace;
  --k-blue:#5b8def; --k-blue-soft:rgba(91,141,239,.15);
  --k-purple:#a78bfa; --k-purple-soft:rgba(167,139,250,.15);
  --k-green:#34d399; --k-green-soft:rgba(52,211,153,.15);
  --k-red:#f87171; --k-red-soft:rgba(248,113,113,.15);
  --k-gray:#9298a5; --k-gray-soft:rgba(146,152,165,.15);
  width:100%; min-height:100%; position:relative; font-family:var(--font-ui); isolation:isolate;
  border-radius:inherit; overflow-x:hidden;
}
.k-root[data-k-theme="dark"]{
  --k-bg-app:#25272b; --k-bg-surface:#2a2c31; --k-bg-surface-2:#30333a; --k-bg-elevated:#343740;
  --k-bg-hover:rgba(255,255,255,.055); --k-border:rgba(255,255,255,.10); --k-border-strong:rgba(255,255,255,.18);
  --k-text-primary:#f4f5f7; --k-text-secondary:#c2c6cf; --k-text-tertiary:#8d929d;
  --k-accent:#f0883e; --k-accent-strong:#ff9d5c; --k-accent-soft:rgba(240,136,62,.15);
  --k-shadow-md:0 1px 0 rgba(255,255,255,.03),0 18px 42px rgba(0,0,0,.24); --k-shadow-lg:0 24px 60px rgba(0,0,0,.45);
  --k-surface-blur:none; --k-panel-border:1px solid var(--k-border);
  background:var(--k-bg-app); color:var(--k-text-primary);
}
.k-root[data-k-theme="light"]{
  --k-bg-app:#FCFBF9; --k-bg-surface:#ffffff; --k-bg-surface-2:#f8fafc;
  --k-bg-elevated:#ffffff; --k-bg-hover:#f8fafc;
  --k-border:rgba(226,232,240,.86); --k-border-strong:rgba(203,213,225,.95);
  --k-text-primary:#0f172a; --k-text-secondary:#475569; --k-text-tertiary:#94a3b8;
  --k-accent:#e97a2f; --k-accent-strong:#d9691f; --k-accent-soft:rgba(233,122,47,.16);
  --k-shadow-md:0 1px 2px rgba(15,23,42,.06),0 1px 3px rgba(15,23,42,.08); --k-shadow-lg:0 10px 30px rgba(15,23,42,.12);
  --k-surface-blur:none; --k-panel-border:1px solid var(--k-border);
  background:var(--k-bg-app); color:var(--k-text-primary);
}
.k-root::before{content:"";position:absolute;inset:0;z-index:-1;background:var(--k-bg-app);border-radius:inherit;pointer-events:none;}
.k-root *{box-sizing:border-box;}
.k-glass-blobs{display:none;}
.k-blob{display:none;}
.k-root ::selection{background:var(--k-accent-soft);}
.k-root::-webkit-scrollbar,.k-root *::-webkit-scrollbar{display:none;width:0;height:0;}

.k-root button{cursor:pointer;border:none;background:none;color:inherit;font-family:inherit;}
.k-root input,.k-root select{font-family:inherit;color:inherit;}
.k-root :focus-visible{outline:2px solid var(--k-accent);outline-offset:2px;border-radius:6px;} .k-search input:focus,.k-search input:focus-visible,.k-current-graph:focus-visible,.k-current-graph .kx-graph:focus-visible,.k-current-graph .kx-graph>svg:focus,.k-current-graph .kx-graph>svg:focus-visible{outline:none!important;}
.k-icon{width:16px;height:16px;flex-shrink:0;display:block;}
.no-scrollbar{scrollbar-width:none;-ms-overflow-style:none;}
.no-scrollbar::-webkit-scrollbar{display:none;}

.k-wrap{position:relative;z-index:1;width:100%;max-width:none;min-width:0;margin:0;overflow:visible;padding:26px clamp(16px,3vw,40px) 80px;scrollbar-width:none;-ms-overflow-style:none;}

.k-utilrow{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:20px;}
.k-demo-switch{display:flex;align-items:center;gap:8px;padding:7px 8px 7px 12px;border:1px dashed var(--k-border-strong);
  border-radius:100px;background:var(--k-bg-surface);backdrop-filter:var(--k-surface-blur);}
.k-demo-switch .lbl{font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--k-text-tertiary);}
.k-demo-switch .opts{display:flex;gap:3px;background:var(--k-bg-app);padding:3px;border-radius:100px;border:var(--k-panel-border);}
.k-demo-switch button{padding:5px 12px;font-size:12px;font-weight:600;color:var(--k-text-tertiary);border-radius:100px;transition:.15s;}
.k-demo-switch button.active{background:var(--k-bg-elevated);color:var(--k-text-primary);box-shadow:0 1px 2px rgba(0,0,0,.2);}
.k-theme-toggle{display:flex;align-items:center;gap:3px;background:var(--k-bg-app);border:var(--k-panel-border);border-radius:100px;padding:3px;}
.k-theme-toggle button{width:28px;height:28px;border-radius:100px;display:flex;align-items:center;justify-content:center;color:var(--k-text-tertiary);}
.k-theme-toggle button.active{background:var(--k-bg-elevated);color:var(--k-accent);}

.k-header{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;flex-wrap:wrap;margin-bottom:24px;}
.k-header h2{font-size:clamp(22px,2.6vw,30px);font-weight:800;letter-spacing:-.02em;display:flex;align-items:center;gap:10px;}
.k-header h2 .badge-live{font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;
  color:var(--k-accent);background:var(--k-accent-soft);padding:4px 9px;border-radius:100px;border:1px solid var(--k-accent);border-color:color-mix(in srgb, var(--k-accent) 35%, transparent);}
.k-header p{color:var(--k-text-secondary);font-size:13.5px;margin-top:6px;max-width:480px;line-height:1.55;}
.k-btn{display:inline-flex;align-items:center;gap:7px;padding:9px 14px;border-radius:10px;font-size:13px;font-weight:600;
  border:var(--k-panel-border);background:var(--k-bg-surface);backdrop-filter:var(--k-surface-blur);color:var(--k-text-secondary);transition:.15s;}
.k-btn:hover{background:var(--k-bg-elevated);color:var(--k-text-primary);border-color:var(--k-border-strong);}
.k-btn.primary{background:var(--k-accent);border-color:var(--k-accent);color:#1a1204;}
.k-btn.primary:hover{filter:brightness(1.06);}
.k-btn.icon-only{padding:9px;}
.k-btn.sm{padding:6px 10px;font-size:12px;}

.k-stats{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:12px;margin-bottom:22px;min-width:0;}
.k-stat-card{min-width:0;background:var(--k-bg-surface);backdrop-filter:var(--k-surface-blur);border:var(--k-panel-border);border-radius:24px;padding:18px 18px;
  opacity:0;transform:translateY(10px) scale(.97);animation:statIn .5s cubic-bezier(.2,.8,.2,1) forwards;box-shadow:var(--k-shadow-md);}
@keyframes statIn{to{opacity:1;transform:translateY(0) scale(1);}}
.k-stat-card .ic{width:26px;height:26px;border-radius:8px;display:flex;align-items:center;justify-content:center;margin-bottom:10px;}
.k-stat-card .val{font-size:19px;font-weight:800;letter-spacing:-.02em;font-family:var(--font-mono);}
.k-stat-card .lbl{font-size:11px;color:var(--k-text-tertiary);margin-top:3px;font-weight:600;}

.k-toolbar{position:relative;z-index:90;display:flex;align-items:center;gap:8px;flex-wrap:wrap;max-width:100%;min-width:0;overflow:visible;background:var(--k-bg-surface);backdrop-filter:var(--k-surface-blur);
  border:var(--k-panel-border);border-radius:18px;padding:9px 10px;margin-bottom:14px;box-shadow:var(--k-shadow-md);}
.k-search{display:flex;align-items:center;gap:8px;background:var(--k-bg-elevated);border:var(--k-panel-border);border-radius:14px;
  padding:8px 11px;min-width:200px;flex:1;max-width:320px;color:var(--k-text-tertiary);}
.k-search input{background:none;border:none;color:var(--k-text-primary);font-size:13px;width:100%;outline:none;}
.k-search input::placeholder{color:var(--k-text-tertiary);}
.k-search kbd{font-family:var(--font-mono);font-size:10px;background:var(--k-bg-elevated);padding:2px 5px;border-radius:5px;color:var(--k-text-tertiary);}
.k-sep{width:1px;align-self:stretch;background:var(--k-border);margin:0 2px;}
.k-tb-btn{display:flex;align-items:center;gap:6px;padding:7px 10px;border-radius:8px;font-size:12.5px;font-weight:600;
  color:var(--k-text-secondary);transition:.15s;border:1px solid transparent;}
.k-tb-btn:hover{background:var(--k-bg-hover);color:var(--k-text-primary);}
.k-tb-btn.active{background:var(--k-accent-soft);color:var(--k-accent-strong);border-color:var(--k-accent);}
.k-select{background:var(--k-bg-app);border:var(--k-panel-border);border-radius:8px;padding:7px 9px;font-size:12.5px;color:var(--k-text-secondary);font-weight:600;}
.k-pretty-select{position:relative;z-index:120;min-width:178px;}
.k-pretty-select.k-group-select{min-width:170px;}
.k-pretty-trigger{width:100%;min-height:38px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 11px 9px 13px;border-radius:14px;border:var(--k-panel-border);background:var(--k-bg-elevated);color:var(--k-text-primary);font-size:12.5px;font-weight:750;box-shadow:var(--k-shadow-md);transition:border-color .15s,box-shadow .15s,background .15s;}
.k-pretty-trigger:hover,.k-pretty-select.open .k-pretty-trigger{border-color:rgba(233,122,47,.55);box-shadow:0 0 0 4px rgba(233,122,47,.10),0 10px 24px rgba(27,39,65,.055);}
.k-pretty-menu{position:absolute;top:calc(100% + 8px);left:0;right:0;z-index:9999;padding:6px;border:var(--k-panel-border);border-radius:16px;background:var(--k-bg-elevated);backdrop-filter:none;box-shadow:var(--k-shadow-lg);animation:kSelectIn .13s ease-out;max-height:260px;overflow-y:auto;}
@keyframes kSelectIn{from{opacity:0;transform:translateY(-4px) scale(.98);}to{opacity:1;transform:translateY(0) scale(1);}}
.k-pretty-option{width:100%;min-height:34px;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 9px;border-radius:10px;color:var(--k-text-secondary);font-size:12.5px;font-weight:700;text-align:left;transition:background .14s,color .14s;}
.k-pretty-option:hover{background:var(--k-bg-hover);color:var(--k-text-primary);}
.k-pretty-option.selected{background:var(--k-accent-soft);color:var(--k-accent-strong);}

.k-filters{max-height:0;overflow:hidden;transition:max-height .28s ease,margin .28s ease,opacity .2s ease;opacity:0;}
.k-filters.open{max-height:240px;opacity:1;margin-bottom:14px;}
.k-filters-inner{background:var(--k-bg-surface);backdrop-filter:var(--k-surface-blur);border:var(--k-panel-border);border-radius:24px;padding:18px;
  display:grid;grid-template-columns:auto 1fr auto;gap:18px;align-items:start;box-shadow:var(--k-shadow-md);}
.k-filters-inner>:nth-child(2){text-align:center;}.k-filters-inner>:nth-child(2) .k-chip-row{justify-content:center;}
.k-ft{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--k-text-tertiary);margin-bottom:9px;}
.k-chip-row{display:flex;flex-wrap:nowrap;gap:6px;overflow-x:auto;scrollbar-width:none;}.k-chip-row::-webkit-scrollbar{display:none;}
.k-chip{display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border-radius:100px;font-size:11.5px;font-weight:600;white-space:nowrap;flex-shrink:0;cursor:pointer;
  background:var(--k-bg-app);border:var(--k-panel-border);color:var(--k-text-secondary);transition:.15s;}
.k-chip:hover{border-color:var(--k-border-strong);color:var(--k-text-primary);}
.k-chip.on{background:var(--k-accent-soft);border-color:var(--k-accent);color:var(--k-accent-strong);}
.k-chip .dot{width:7px;height:7px;border-radius:50%;}
.k-range-row{display:flex;align-items:center;gap:10px;}
.k-range-row input[type=range]{flex:1;accent-color:var(--k-accent);}
.k-range-row .rv{font-family:var(--font-mono);font-size:12px;color:var(--k-text-secondary);width:38px;}
.k-switch{width:34px;height:19px;background:var(--k-bg-app);border:var(--k-panel-border);border-radius:100px;position:relative;transition:.15s;flex-shrink:0;}
.k-switch .knob{position:absolute;top:2px;left:2px;width:13px;height:13px;border-radius:50%;background:var(--k-text-tertiary);transition:.15s;}
.k-switch.on{background:var(--k-accent-soft);border-color:var(--k-accent);}
.k-switch.on .knob{left:17px;background:var(--k-accent);}

.k-graph-section{position:relative;z-index:1;max-width:100%;min-width:0;background:var(--k-bg-surface);backdrop-filter:var(--k-surface-blur);
  border:var(--k-panel-border);border-radius:24px;overflow:hidden;margin-bottom:22px;box-shadow:var(--k-shadow-md);}
.k-graph-titlebar{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--k-border);flex-wrap:wrap;gap:8px;}
.k-graph-titlebar h3{font-size:14.5px;font-weight:700;display:flex;align-items:center;gap:8px;}
.k-graph-titlebar h3 .icwrap{width:24px;height:24px;border-radius:7px;background:var(--k-accent-soft);color:var(--k-accent-strong);
  display:flex;align-items:center;justify-content:center;}
.k-graph-hint{font-size:11.5px;color:var(--k-text-tertiary);display:flex;align-items:center;gap:14px;flex-wrap:wrap;}
.k-graph-hint span{display:flex;align-items:center;gap:5px;}
.k-graph-hint kbd{font-family:var(--font-mono);background:var(--k-bg-elevated);border:1px solid var(--k-border);padding:1px 6px;border-radius:5px;}

.k-graph-stage{position:relative;height:min(65vh,640px);min-height:460px;
  background-image:linear-gradient(var(--k-border) 1px,transparent 1px),linear-gradient(90deg,var(--k-border) 1px,transparent 1px);
  background-size:28px 28px; background-color:var(--k-bg-app); overflow:hidden;cursor:grab;}
.k-graph-stage.panning{cursor:grabbing;}
.k-graph-stage svg{width:100%;height:100%;display:block;}
.k-current-graph.kx-page{position:relative;min-height:560px;height:min(72vh,760px);overflow:hidden;
  border-radius:0;background:var(--k-bg-app);color:var(--k-text-primary);}
.k-current-graph .kx-graph{border-radius:0;background:var(--k-bg-app);}
.k-current-graph .kx-graph-help{display:none!important;}
.k-gnode{cursor:pointer;}
.k-gnode .shape{transition:filter .15s;}
.k-gnode:hover .shape{filter:brightness(1.25);}
.k-gnode.dimmed{opacity:.16;}
.k-gnode .halo{animation:pulseHalo 1.8s ease-in-out infinite;}
@keyframes pulseHalo{0%,100%{opacity:.55;transform:scale(1);}50%{opacity:.15;transform:scale(1.35);}}
.k-gnode .label{font-family:var(--font-ui);font-weight:700;font-size:10.5px;fill:var(--k-text-primary);pointer-events:none;text-overflow:ellipsis;}
.k-gnode .sublabel{font-family:var(--font-mono);font-size:8.5px;fill:var(--k-text-tertiary);pointer-events:none;}
.k-gedge{transition:opacity .15s;}
.k-gedge.dimmed{opacity:.08;}
.k-gedge-label{font-family:var(--font-mono);font-size:8.5px;fill:var(--k-text-tertiary);pointer-events:none;}
.k-gedge-label rect{fill:var(--k-bg-app);}
.k-graph-legend{position:absolute;left:16px;bottom:16px;background:var(--k-bg-elevated);backdrop-filter:blur(10px);
  border:var(--k-panel-border);border-radius:12px;padding:10px 12px;font-size:11px;box-shadow:var(--k-shadow-md);}
.k-graph-legend .lg-title{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--k-text-tertiary);font-weight:700;margin-bottom:7px;}
.k-graph-legend .lg-row{display:flex;align-items:center;gap:7px;padding:2px 0;color:var(--k-text-secondary);}
.k-graph-legend .lg-dot{width:9px;height:9px;border-radius:3px;flex-shrink:0;}
.k-minimap{position:absolute;right:16px;bottom:16px;width:160px;height:100px;background:var(--k-bg-elevated);backdrop-filter:blur(10px);
  border:var(--k-panel-border);border-radius:8px;overflow:hidden;box-shadow:var(--k-shadow-md);}
.k-minimap svg{width:100%;height:100%;display:block;}
.k-graph-toolbar-float{position:absolute;top:14px;right:16px;display:flex;gap:6px;}
.k-gtf-btn{width:32px;height:32px;border-radius:9px;background:var(--k-bg-elevated);backdrop-filter:blur(10px);
  border:var(--k-panel-border);display:flex;align-items:center;justify-content:center;color:var(--k-text-secondary);box-shadow:0 1px 3px rgba(0,0,0,.2);}
.k-gtf-btn:hover{color:var(--k-text-primary);}
.k-graph-empty,.k-graph-loading{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px;}

.k-drawer-backdrop{position:absolute;inset:0;background:transparent;opacity:0;pointer-events:none;transition:opacity .25s;z-index:60;}
.k-drawer-backdrop.open{opacity:0;pointer-events:none;}
.k-drawer{position:absolute;top:0;right:0;bottom:0;height:100%;min-height:100%;width:min(520px,42%,100%);max-width:100%;background:var(--k-bg-elevated);backdrop-filter:blur(24px);
  border-left:var(--k-panel-border);box-shadow:none;transform:translateX(100%);
  transition:transform .32s cubic-bezier(.2,.85,.25,1);z-index:61;display:flex;flex-direction:column;border-radius:0 24px 24px 0;overflow:hidden;}
.k-drawer.open{transform:translateX(0);}
.k-drawer-head{padding:20px 20px 16px;border-bottom:1px solid var(--k-border);position:relative;}
.k-type-pill{display:inline-flex;align-items:center;gap:6px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:4px 9px;border-radius:100px;margin-bottom:10px;}
.k-drawer-head h3{font-size:19px;font-weight:800;letter-spacing:-.01em;line-height:1.25;padding-right:30px;}
.k-drawer-close{position:absolute;top:18px;right:18px;width:28px;height:28px;border-radius:8px;background:var(--k-bg-surface);border:var(--k-panel-border);display:flex;align-items:center;justify-content:center;color:var(--k-text-secondary);}
.k-drawer-close:hover{color:var(--k-text-primary);}
.k-drawer-metrics{display:flex;gap:10px;margin-top:14px;}
.k-dm-box{flex:1;background:var(--k-bg-surface);border:var(--k-panel-border);border-radius:10px;padding:9px 10px;}
.k-dm-box .n{font-family:var(--font-mono);font-weight:700;font-size:15px;}
.k-dm-box .l{font-size:10px;color:var(--k-text-tertiary);margin-top:2px;font-weight:600;text-transform:uppercase;letter-spacing:.03em;}
.k-conf-bar{height:5px;border-radius:100px;background:var(--k-bg-app);overflow:hidden;margin-top:6px;}
.k-conf-bar>div{height:100%;border-radius:100px;}
.k-drawer-body{flex:1;min-height:0;overflow-y:auto;padding:18px 20px 20px;}
.k-dsec{margin-bottom:20px;}
.k-dh{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--k-text-tertiary);margin-bottom:8px;display:flex;align-items:center;gap:6px;}
.k-dsec p{font-size:13px;color:var(--k-text-secondary);line-height:1.65;}
.k-taglist{display:flex;flex-wrap:wrap;gap:6px;}
.k-taglist .t{font-size:11.5px;padding:5px 10px;border-radius:8px;background:var(--k-bg-surface);border:var(--k-panel-border);color:var(--k-text-secondary);cursor:pointer;transition:.15s;}
.k-taglist .t:hover{border-color:var(--k-border-strong);color:var(--k-text-primary);}
.k-dgrid2{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.k-dfield{background:var(--k-bg-surface);border:var(--k-panel-border);border-radius:10px;padding:9px 11px;}
.k-dfield .l{font-size:10px;color:var(--k-text-tertiary);font-weight:600;text-transform:uppercase;letter-spacing:.03em;margin-bottom:3px;}
.k-dfield .v{font-size:13px;font-weight:600;font-family:var(--font-mono);}
.k-drawer-actions{padding:16px 20px 20px;border-top:1px solid var(--k-border);display:grid;grid-template-columns:1fr 1fr;gap:8px;}
.k-dact{display:flex;align-items:center;justify-content:center;gap:7px;padding:10px 10px;border-radius:10px;font-size:12.5px;font-weight:600;background:var(--k-bg-surface);border:var(--k-panel-border);color:var(--k-text-secondary);transition:.15s;}
.k-dact:hover{background:var(--k-bg-hover);color:var(--k-text-primary);}
.k-dact.wide{grid-column:1/-1;}
.k-dact.primary{background:var(--k-accent);border-color:var(--k-accent);color:#1a1204;}
.k-dact:disabled{opacity:.5;cursor:not-allowed;}
.k-source-list{grid-column:1/-1;display:flex;flex-direction:column;gap:6px;padding-top:2px;}
.k-source-empty{padding:10px 4px;text-align:center;color:var(--k-text-tertiary);font-size:12px;}
.k-source-item{display:flex;align-items:center;gap:9px;width:100%;padding:9px 10px;border-radius:8px;border:var(--k-panel-border);background:var(--k-bg-surface);color:var(--k-text-secondary);text-align:left;}
.k-source-item:hover{background:var(--k-bg-hover);color:var(--k-text-primary);}
.k-source-item-main{min-width:0;flex:1;}
.k-source-item-title{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:700;}
.k-source-item-meta{display:block;margin-top:2px;color:var(--k-text-tertiary);font-size:10.5px;}
.k-source-time{font-family:var(--font-mono);font-size:11px;font-weight:700;color:var(--k-accent-text);}

/* Polished knowledge inspector */
.k-drawer{width:min(520px,42%,100%);background:var(--k-bg-elevated);
  border-left:1px solid rgba(133,145,170,.24);box-shadow:none;}
[data-k-theme="dark"] .k-drawer{background:#2a2c31;box-shadow:none;}
.k-drawer-head{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:18px 20px 14px;border-bottom:1px solid rgba(133,145,170,.18);}
.k-drawer-type,.k-type-pill{display:inline-flex;align-items:center;gap:8px;width:max-content;padding:7px 11px;border-radius:999px;background:rgba(91,127,255,.09);font-size:12px;font-weight:750;letter-spacing:.01em;text-transform:none;}
.k-drawer-type span,.k-type-pill span{width:8px;height:8px;border-radius:999px;box-shadow:0 0 0 4px rgba(91,127,255,.10);}
.k-drawer .k-icon-btn,.k-drawer-close{position:static;width:34px;height:34px;min-width:34px;border:1px solid rgba(133,145,170,.22);border-radius:12px;background:rgba(255,255,255,.72);color:var(--k-text-secondary);box-shadow:0 8px 20px rgba(28,39,66,.06);display:flex;align-items:center;justify-content:center;padding:0;line-height:0;}
[data-k-theme="dark"] .k-drawer .k-icon-btn,[data-k-theme="dark"] .k-drawer-close{background:rgba(255,255,255,.06);}
.k-drawer .k-icon-btn:hover,.k-drawer-close:hover{color:var(--k-text-primary);border-color:rgba(91,127,255,.35);transform:translateY(-1px);}
.k-drawer-body{flex:1;min-height:0;padding:22px 24px 18px;overflow-y:auto;scrollbar-width:none;-ms-overflow-style:none;}
.k-drawer-body::-webkit-scrollbar{display:none;width:0;height:0;}
.k-drawer-body h2{margin:0;color:var(--k-text-primary);font-size:20px;font-weight:800;line-height:1.3;letter-spacing:0;}
.k-dmeta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin:14px 0 18px;}
.k-dmeta>span{display:flex;align-items:center;gap:7px;min-height:38px;padding:9px 10px;border:1px solid rgba(133,145,170,.18);border-radius:13px;background:rgba(255,255,255,.62);box-shadow:0 10px 24px rgba(26,39,68,.045);font-size:12px;font-weight:750;line-height:1.2;white-space:normal;}
[data-k-theme="dark"] .k-dmeta>span{background:rgba(255,255,255,.055);}
.k-dmeta .dot{width:8px;height:8px;border-radius:999px;flex:0 0 auto;box-shadow:0 0 0 4px rgba(52,211,153,.11);}
.k-dsec{margin:0 0 18px;}
.k-dh{margin:0 0 8px;color:var(--k-text-tertiary);font-size:11px;font-weight:800;letter-spacing:.055em;text-transform:uppercase;}
.k-dtext,.k-dsec p{padding:13px 14px;border:1px solid rgba(133,145,170,.16);border-radius:14px;background:rgba(255,255,255,.55);color:var(--k-text-secondary);font-size:14px;line-height:1.65;box-shadow:0 12px 30px rgba(25,36,61,.045);}
[data-k-theme="dark"] .k-dtext,[data-k-theme="dark"] .k-dsec p{background:rgba(255,255,255,.045);}
.k-taglist{gap:8px;}
.k-taglist .t{border-radius:999px;padding:7px 10px;background:rgba(91,127,255,.08);border:1px solid rgba(91,127,255,.14);color:var(--k-text-secondary);font-size:11.5px;font-weight:650;}
.k-taglist .t:hover{background:rgba(91,127,255,.13);border-color:rgba(91,127,255,.24);color:var(--k-text-primary);}
.k-drawer-body>.k-dsec:last-child{margin-bottom:0;}
.k-covered-list{display:flex;flex-direction:column;gap:10px;margin-top:10px;}
.k-covered-row{position:relative;display:grid;gap:5px;padding:12px 13px 12px 15px;border:1px solid rgba(133,145,170,.18)!important;border-radius:14px!important;background:rgba(255,255,255,.72)!important;box-shadow:0 12px 28px rgba(26,39,68,.055);transition:transform .16s ease,border-color .16s ease,box-shadow .16s ease,background .16s ease;}
[data-k-theme="dark"] .k-covered-row{background:rgba(255,255,255,.055)!important;}
.k-covered-row::before{content:"";position:absolute;left:0;top:12px;bottom:12px;width:3px;border-radius:999px;background:rgba(91,127,255,.55);opacity:.55;}
.k-covered-row:hover{transform:translateY(-1px);border-color:rgba(233,122,47,.34)!important;box-shadow:0 16px 34px rgba(26,39,68,.08);}
.k-covered-row.selected{border-color:rgba(233,122,47,.60)!important;background:linear-gradient(135deg,rgba(255,245,235,.92),rgba(255,255,255,.76))!important;}
[data-k-theme="dark"] .k-covered-row.selected{background:linear-gradient(135deg,rgba(233,122,47,.14),rgba(255,255,255,.055))!important;}
.k-covered-row.selected::before{background:var(--k-accent,#e97a2f);opacity:1;}
.k-covered-row strong{font-size:13px;line-height:1.25;color:var(--k-text-primary);}
.k-covered-row span{font-size:11px;color:var(--k-text-tertiary);}
.k-covered-row small{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;margin-top:3px;color:var(--k-text-secondary);font-size:11px;line-height:1.45;}
.k-drawer-actions{flex:0 0 auto;padding:14px 18px 18px;border-top:1px solid rgba(133,145,170,.16);background:var(--k-bg-elevated);grid-template-columns:1fr 1fr;gap:9px;}
[data-k-theme="dark"] .k-drawer-actions{background:#2a2c31;}
.k-dact{min-height:40px;border-radius:13px;border:1px solid rgba(133,145,170,.18);background:rgba(255,255,255,.70);color:var(--k-text-secondary);font-size:12.5px;font-weight:750;box-shadow:0 10px 24px rgba(26,39,68,.045);}
[data-k-theme="dark"] .k-dact{background:rgba(255,255,255,.055);}
.k-dact:hover{transform:translateY(-1px);border-color:rgba(91,127,255,.25);background:rgba(255,255,255,.92);color:var(--k-text-primary);}
[data-k-theme="dark"] .k-dact:hover{background:rgba(255,255,255,.09);}
.k-dact.primary{background:linear-gradient(135deg,#f28b35,#e87524);border-color:rgba(232,111,35,.82);color:#fff;box-shadow:0 14px 28px rgba(232,111,35,.20);}
.k-dact.primary:hover{background:linear-gradient(135deg,#f49849,#e87524);color:#fff;}
.k-source-list{gap:8px;padding-top:2px;}
.k-source-item{border-radius:13px;border:1px solid rgba(133,145,170,.18);background:rgba(255,255,255,.68);padding:10px 11px;}
[data-k-theme="dark"] .k-source-item{background:rgba(255,255,255,.055);}
.k-source-item-title{font-size:12.5px;}
.k-source-empty{padding:14px;border:1px dashed rgba(133,145,170,.25);border-radius:13px;background:rgba(255,255,255,.35);}

.k-section-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px;}
.k-section-head h3{font-size:15.5px;font-weight:700;display:flex;align-items:center;gap:9px;}
.k-section-head h3 .icwrap{width:26px;height:26px;border-radius:8px;background:var(--k-purple-soft);color:var(--k-purple);display:flex;align-items:center;justify-content:center;}
.k-section-head p{font-size:12px;color:var(--k-text-tertiary);margin-top:3px;}

/* ---------- TIMELINE (structure matches reference: badge/diff row, title, divider, confidence+play row) ---------- */
.k-timeline-wrap{position:relative;background:var(--k-bg-surface);backdrop-filter:var(--k-surface-blur);border:var(--k-panel-border);border-radius:24px;padding:28px 56px 22px;margin-bottom:26px;box-shadow:var(--k-shadow-md);overflow:hidden;}
.k-timeline-track{display:flex;align-items:stretch;gap:16px;overflow-x:auto;scroll-behavior:smooth;scroll-snap-type:x proximity;padding:8px 0 8px;position:relative;scrollbar-width:none;}.k-timeline-track::-webkit-scrollbar{display:none;}
.k-tl-card{position:relative;z-index:1;width:220px;flex-shrink:0;background:var(--k-bg-elevated);border:var(--k-panel-border);border-radius:18px;scroll-snap-align:start;
  padding:14px;cursor:pointer;transition:.18s;}
.k-tl-card:hover{border-color:var(--k-border-strong);transform:translateY(-3px);box-shadow:var(--k-shadow-md);}
.k-tl-card.dimmed{opacity:.3;}
.k-tl-card.selected{border-color:var(--k-accent);box-shadow:0 0 0 1px var(--k-accent);}
.k-tl-top-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:6px;}
.k-tl-ts{font-family:var(--font-mono);font-size:11px;font-weight:600;color:var(--k-blue);background:var(--k-blue-soft);
  padding:3px 8px;border-radius:6px;letter-spacing:.02em;}
.k-tl-diff{font-size:9.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;}
.k-tl-name{font-size:14px;font-weight:700;line-height:1.3;margin-bottom:14px;min-height:36px;color:var(--k-text-primary);}
.k-tl-bottom-row{display:flex;align-items:center;justify-content:space-between;border-top:1px solid var(--k-border);padding-top:11px;}
.k-tl-conf{display:flex;align-items:center;gap:6px;font-size:9.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--k-text-tertiary);}
.k-tl-conf .dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;}
.k-tl-play{width:28px;height:28px;border-radius:50%;border:1px solid var(--k-border-strong);display:flex;align-items:center;justify-content:center;color:var(--k-text-secondary);flex-shrink:0;transition:.15s;}
.k-tl-play:hover{border-color:var(--k-accent);color:var(--k-accent);background:var(--k-accent-soft);}
.k-tl-line{position:absolute;left:56px;right:56px;top:50%;height:1px;background:linear-gradient(90deg,transparent,var(--k-purple),var(--k-blue),transparent);opacity:.7;}.k-timeline-arrow{position:absolute;z-index:3;top:50%;width:34px;height:34px;margin-top:-17px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--k-bg-elevated);border:var(--k-panel-border);box-shadow:var(--k-shadow-md);color:var(--k-text-secondary);}.k-timeline-arrow:hover{color:var(--k-accent);border-color:var(--k-accent);}.k-timeline-arrow.left{left:14px;}.k-timeline-arrow.right{right:14px;}

.k-explorer-wrap{position:relative;z-index:1;background:var(--k-bg-surface);backdrop-filter:var(--k-surface-blur);border:var(--k-panel-border);border-radius:24px;overflow:visible;margin-bottom:20px;box-shadow:var(--k-shadow-md);max-width:100%;min-width:0;}
.k-explorer-topbar{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--k-border);flex-wrap:wrap;}
.k-explorer-table-scroll{max-height:612px;overflow:auto;scrollbar-width:none;-ms-overflow-style:none;}
.k-explorer-table-scroll::-webkit-scrollbar{display:none;width:0;height:0;}
.k-pinned-strip{display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid var(--k-border);overflow-x:auto;background:var(--k-bg-surface-2);}
.k-pinned-strip .lbl{font-size:10.5px;font-weight:700;color:var(--k-text-tertiary);text-transform:uppercase;letter-spacing:.04em;flex-shrink:0;}
.k-pin-chip{display:flex;align-items:center;gap:6px;background:var(--k-bg-app);border:var(--k-panel-border);border-radius:100px;padding:5px 10px;font-size:11.5px;font-weight:600;color:var(--k-text-secondary);flex-shrink:0;cursor:pointer;}
.k-pin-chip:hover{color:var(--k-text-primary);border-color:var(--k-border-strong);}
.k-pin-chip .dot{width:7px;height:7px;border-radius:50%;}
.k-etable{width:100%;border-collapse:collapse;font-size:12.5px;background:var(--k-bg-surface);}
.k-etable thead th{position:sticky;top:0;z-index:2;background:var(--k-bg-surface);text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--k-text-tertiary);font-weight:700;padding:11px 14px;border-bottom:1px solid var(--k-border);cursor:pointer;user-select:none;white-space:nowrap;}
.k-etable thead th:hover{color:var(--k-text-secondary);}
.k-etable thead th.active-sort{color:var(--k-accent);}
.k-group-row td{background:var(--k-bg-surface-2);padding:8px 14px;font-size:11px;font-weight:700;color:var(--k-text-secondary);text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--k-border);}
.k-etable tbody tr.k-row{border-bottom:1px solid var(--k-border);transition:opacity .22s ease,transform .22s ease,background-color .18s ease;cursor:pointer;}
.k-etable tbody tr.k-row:hover{background:var(--k-bg-hover);}
.k-etable tbody tr.k-row.dimmed{opacity:.32;}
.k-etable tbody tr.k-row.k-row-pulse{animation:kRowPulse .75s ease;}
.k-etable tbody tr.k-row.k-row-removing{opacity:0;transform:translateX(12px);pointer-events:none;}
@keyframes kRowPulse{0%{background:rgba(91,141,239,.20);}55%{background:rgba(243,117,32,.14);}100%{background:transparent;}}
.k-etable td{padding:11px 14px;vertical-align:middle;}
.k-cell-concept{display:flex;align-items:center;gap:9px;}
.k-type-dot{width:9px;height:9px;border-radius:3px;flex-shrink:0;}
.k-cell-concept .cn{font-weight:700;font-size:12.5px;}
.k-cell-concept .ct{font-size:10.5px;color:var(--k-text-tertiary);}
.k-mini-conf{display:flex;align-items:center;gap:7px;}
.k-mini-conf .bar{width:52px;height:4px;border-radius:100px;background:var(--k-bg-app);overflow:hidden;}
.k-mini-conf .bar>div{height:100%;border-radius:100px;}
.k-mini-conf .n{font-family:var(--font-mono);font-size:11px;color:var(--k-text-secondary);}
.k-diff-pill{display:inline-block;font-size:10.5px;font-weight:700;padding:3px 8px;border-radius:100px;}
.k-row-actions{display:flex;align-items:center;gap:4px;}
.k-ra-btn{width:26px;height:26px;border-radius:7px;display:flex;align-items:center;justify-content:center;color:var(--k-text-tertiary);}
.k-ra-btn:hover{background:var(--k-bg-elevated);color:var(--k-text-primary);}
.k-ra-btn.on{color:var(--k-accent);}
.k-mono{font-family:var(--font-mono);font-size:11.5px;color:var(--k-text-secondary);}
.k-explorer-footer{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-top:1px solid var(--k-border);font-size:11.5px;color:var(--k-text-tertiary);}

.k-empty-illustration{width:150px;height:150px;margin-bottom:22px;}
.k-empty-wrap h3{font-size:18px;font-weight:700;margin-bottom:8px;}
.k-empty-wrap p{font-size:13.5px;color:var(--k-text-tertiary);max-width:380px;margin:0 auto 22px;line-height:1.6;}
.k-empty-wrap .btns{display:flex;gap:10px;justify-content:center;}

.k-skel{background:linear-gradient(90deg,var(--k-bg-surface) 25%,var(--k-bg-elevated) 50%,var(--k-bg-surface) 75%);background-size:200% 100%;animation:shimmer 1.6s ease-in-out infinite;border-radius:10px;}
@keyframes shimmer{0%{background-position:200% 0;}100%{background-position:-200% 0;}}
.k-load-stages{display:flex;flex-direction:column;gap:10px;margin-top:22px;width:280px;}
.k-load-stage{display:flex;align-items:center;gap:10px;font-size:12.5px;color:var(--k-text-tertiary);opacity:.4;transition:.3s;}
.k-load-stage.active{opacity:1;color:var(--k-text-primary);}
.k-load-stage.done{opacity:.8;color:var(--k-green);}
.k-load-dot{width:16px;height:16px;border-radius:50%;border:2px solid var(--k-border-strong);flex-shrink:0;display:flex;align-items:center;justify-content:center;}
.k-load-stage.active .k-load-dot{border-color:var(--k-accent);}
.k-load-stage.active .k-load-dot::after{content:'';width:6px;height:6px;border-radius:50%;background:var(--k-accent);animation:blink 1s infinite;}
.k-load-stage.done .k-load-dot{border-color:var(--k-green);background:var(--k-green-soft);}
@keyframes blink{0%,100%{opacity:1;}50%{opacity:.2;}}
.k-load-spinner{width:38px;height:38px;border-radius:50%;border:3px solid var(--k-bg-elevated);border-top-color:var(--k-accent);animation:spin 1s linear infinite;}
@keyframes spin{to{transform:rotate(360deg);}}
.k-fade{animation:fadeSwap .35s ease;}
@keyframes fadeSwap{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:translateY(0);}}
.k-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--k-bg-elevated);backdrop-filter:blur(20px);
  border:var(--k-panel-border);color:var(--k-text-primary);padding:11px 18px;border-radius:10px;font-size:13px;font-weight:600;
  box-shadow:var(--k-shadow-lg);z-index:80;transition:opacity .25s,transform .25s;}
.k-modal-backdrop{position:fixed;inset:0;z-index:10050;display:flex;align-items:center;justify-content:center;padding:22px;background:rgba(16,22,36,.26);backdrop-filter:blur(8px);}
.k-modal-card{position:relative;width:min(430px,calc(100vw - 32px));border:1px solid rgba(133,145,170,.22);border-radius:20px;background:linear-gradient(180deg,rgba(255,255,255,.98),rgba(248,250,255,.96));box-shadow:0 28px 80px rgba(18,28,48,.24);padding:24px;}
[data-k-theme="dark"] .k-modal-card{background:linear-gradient(180deg,rgba(27,30,43,.98),rgba(17,19,29,.96));}
.k-modal-close{position:absolute;top:14px;right:14px;width:34px;height:34px;border-radius:12px;border:1px solid rgba(133,145,170,.22);background:rgba(255,255,255,.72);display:flex;align-items:center;justify-content:center;color:var(--k-text-secondary);}
.k-modal-close:hover{color:var(--k-text-primary);border-color:rgba(91,127,255,.28);}
.k-modal-kicker{display:inline-flex;margin-bottom:12px;padding:6px 10px;border-radius:999px;background:rgba(91,127,255,.10);color:var(--k-blue);font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.055em;}
.k-modal-kicker.danger{background:rgba(239,68,68,.10);color:var(--k-red);}
.k-modal-card h3{margin:0 34px 8px 0;font-size:20px;font-weight:850;letter-spacing:0;color:var(--k-text-primary);}
.k-modal-card p{margin:0 0 16px;color:var(--k-text-secondary);font-size:13px;line-height:1.6;}
.k-modal-input{width:100%;height:44px;border-radius:13px;border:1px solid rgba(133,145,170,.24);background:rgba(255,255,255,.78);padding:0 13px;color:var(--k-text-primary);font-size:14px;font-weight:650;outline:none;}
.k-modal-input:focus{border-color:rgba(91,127,255,.48);box-shadow:0 0 0 4px rgba(91,127,255,.11);}
.k-modal-name{padding:12px 13px;border-radius:13px;border:1px solid rgba(239,68,68,.16);background:rgba(239,68,68,.07);color:var(--k-text-primary);font-weight:750;font-size:13px;}
.k-modal-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:18px;}
.k-modal-btn{min-height:40px;padding:0 14px;border-radius:12px;border:1px solid rgba(133,145,170,.22);background:rgba(255,255,255,.74);color:var(--k-text-secondary);font-size:13px;font-weight:750;}
.k-modal-btn:hover{color:var(--k-text-primary);border-color:rgba(91,127,255,.28);}
.k-modal-btn.primary{background:linear-gradient(135deg,#5f84ff,#426df2);border-color:rgba(66,109,242,.6);color:#fff;}
.k-modal-btn.danger{background:linear-gradient(135deg,#f05656,#d83d3d);border-color:rgba(216,61,61,.65);color:#fff;}
.k-modal-btn:disabled,.k-modal-close:disabled{opacity:.58;cursor:not-allowed;}

.k-root[data-k-theme="dark"] .k-header h2,
.k-root[data-k-theme="dark"] .k-stat-card .val,
.k-root[data-k-theme="dark"] .k-graph-titlebar h3,
.k-root[data-k-theme="dark"] .k-section-head h3,
.k-root[data-k-theme="dark"] .k-cell-concept .cn {
  color:#f8fafc;
}
.k-root[data-k-theme="dark"] .k-search,
.k-root[data-k-theme="dark"] .k-pretty-trigger,
.k-root[data-k-theme="dark"] .k-pretty-menu,
.k-root[data-k-theme="dark"] .k-distance-control,
.k-root[data-k-theme="dark"] .k-tl-card,
.k-root[data-k-theme="dark"] .k-etable,
.k-root[data-k-theme="dark"] .k-modal-input {
  background:#343740;
  border-color:rgba(255,255,255,.10);
}
.k-root[data-k-theme="dark"] .k-stat-card,
.k-root[data-k-theme="dark"] .k-toolbar,
.k-root[data-k-theme="dark"] .k-filters-inner,
.k-root[data-k-theme="dark"] .k-graph-section,
.k-root[data-k-theme="dark"] .k-timeline-wrap,
.k-root[data-k-theme="dark"] .k-explorer-wrap {
  background:#2a2c31;
  border-color:rgba(255,255,255,.10);
  box-shadow:0 1px 0 rgba(255,255,255,.035),0 18px 42px rgba(0,0,0,.22);
}
.k-root[data-k-theme="dark"] .k-graph-titlebar,
.k-root[data-k-theme="dark"] .k-explorer-topbar,
.k-root[data-k-theme="dark"] .k-tl-bottom-row,
.k-root[data-k-theme="dark"] .k-etable thead th,
.k-root[data-k-theme="dark"] .k-etable tbody tr.k-row,
.k-root[data-k-theme="dark"] .k-explorer-footer {
  border-color:rgba(255,255,255,.09);
}
.k-root[data-k-theme="dark"] .k-graph-stage,
.k-root[data-k-theme="dark"] .k-current-graph.kx-page,
.k-root[data-k-theme="dark"] .k-current-graph .kx-graph {
  background-color:#25272b;
  background-image:
    linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),
    linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);
}
.k-root[data-k-theme="dark"] #graph-canvas-container {
  background:#25272b !important;
}
.k-root[data-k-theme="dark"] #graph-canvas-container > div:first-child {
  opacity:.55;
}
.k-root[data-k-theme="dark"] #graph-viewport-toolbar {
  background:#343740;
  border-color:rgba(255,255,255,.12);
  box-shadow:0 12px 28px rgba(0,0,0,.24);
}
.k-root[data-k-theme="dark"] .k-etable tbody tr.k-row:hover,
.k-root[data-k-theme="dark"] .k-pretty-option:hover {
  background:rgba(255,255,255,.055);
}
.k-root[data-k-theme="dark"] .k-tl-card.dimmed,
.k-root[data-k-theme="dark"] .k-etable tbody tr.k-row.dimmed {
  opacity:.42;
}
.k-root[data-k-theme="dark"] .k-diff-pill {
  background:rgba(255,255,255,.08) !important;
}
.k-root[data-k-theme="dark"] .kx-knowledge-map-legend {
  background:#343740 !important;
  color:#c2c6cf !important;
  border-color:rgba(255,255,255,.12) !important;
  box-shadow:0 14px 32px rgba(0,0,0,.25) !important;
}
.k-root[data-k-theme="dark"] .kx-knowledge-map-legend div {
  color:#c2c6cf !important;
}

@media (max-width:1180px){ .k-stats{grid-template-columns:repeat(4,1fr);} .k-filters-inner{grid-template-columns:repeat(2,1fr);} }
@media (max-width:760px){ .k-stats{grid-template-columns:repeat(2,1fr);} .k-drawer{width:100%;} }
`;

/* =====================================================================================
   SMALL PRESENTATIONAL HELPERS
===================================================================================== */
function escapeText(s?: string) { return s || ''; }

const StatIcon: Record<string, React.ReactNode> = {
  concepts: <GitBranch className="k-icon" />, rel: <MapIcon className="k-icon" />, stages: <Layers className="k-icon" />,
  conf: <Target className="k-icon" />, topics: <Sparkles className="k-icon" />, diff: <TrendingUp className="k-icon" />,
  chapters: <BookOpen className="k-icon" />, status: <Check className="k-icon" />,
};

/* =====================================================================================
   MAIN COMPONENT
===================================================================================== */
export default function KnowledgeTab() {
  const initialView = useRef(knowledgeViewCache).current;
  const [theme, setTheme] = useState<Theme>(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  );
  const [demoMode, setDemoMode] = useState<DemoMode>(initialView?.mode || 'loading');
  const [showLoadingPreview, setShowLoadingPreview] = useState(false);
  const [emptyReason, setEmptyReason] = useState<EmptyReason>(initialView?.emptyReason || 'not_generated');
  const [loadStageIdx, setLoadStageIdx] = useState(0);
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<FiltersState>({
    difficulty: new Set(initialView?.filters?.difficulty || []),
    types: new Set(initialView?.filters?.types || []),
    favoritesOnly: initialView?.filters?.favoritesOnly || false,
  });
  const [graphLayout, setGraphLayout] = useState<GraphLayout>(initialView?.graphLayout || 'organic');
  const [nodeDistance, setNodeDistance] = useState(initialView?.nodeDistance || 140);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set(initialView?.favorites || []));
  const [sortKey, setSortKey] = useState<SortKey>('confidence');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [groupBy, setGroupBy] = useState<ExplorerGroup>(initialView?.groupBy || 'none');
  const [showTimeline, setShowTimeline] = useState(true);
  const [showExplorer, setShowExplorer] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [conceptDialog, setConceptDialog] = useState<ConceptDialog | null>(null);
  const [nodes, setNodes] = useState<ConceptNode[]>(initialView?.nodes || []);
  const [edges, setEdges] = useState<EdgeT[]>(initialView?.edges || []);
  const [chapters, setChapters] = useState<ChapterT[]>(initialView?.chapters || []);
  const [pulseNodeIds, setPulseNodeIds] = useState<Set<string>>(new Set());
  const [removingNodeIds, setRemovingNodeIds] = useState<Set<string>>(new Set());
  const conceptById = useMemo<Record<string, ConceptNode>>(
    () => Object.fromEntries(nodes.map(node => [node.id, node])),
    [nodes],
  );
  const chapterLookup = useMemo<Record<string, ChapterT>>(
    () => Object.fromEntries(chapters.map(chapter => [chapter.id, chapter])),
    [chapters],
  );
  const timelineOrder = useMemo(
    () => nodes
      .filter(node => node.type !== "chapter" && node.type !== "subchapter")
      .slice()
      .sort((a, b) => (a.first || "").localeCompare(b.first || ""))
      .map(node => node.id),
    [nodes],
  );

  const graphRef = useRef<KnowledgeGraphHandle>(null);
  const graphSectionRef = useRef<HTMLDivElement>(null);
  const timelineSectionRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preferencesLoadedRef = useRef(Boolean(initialView));
  const preferencesSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Keep this page on the same theme source of truth as the Home header and Settings. */
  useEffect(() => {
    const root = document.documentElement;
    const syncTheme = () => setTheme(root.classList.contains('dark') ? 'dark' : 'light');
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  /* -------- global library graph loading -------- */
  useEffect(() => {
    let active = true;
    const cachedAtStart = knowledgeViewCache;
    let loadingPreviewTimer: ReturnType<typeof setTimeout> | null = null;
    const loadGraph = async () => {
      if (!cachedAtStart) {
        setDemoMode("loading");
        setShowLoadingPreview(false);
        loadingPreviewTimer = setTimeout(() => {
          if (active) setShowLoadingPreview(true);
        }, 250);
      }
      setLoadStageIdx(4);
      try {
        const token = localStorage.getItem("access_token");
        const response = await fetch("/knowledge/graph", {
          headers: token ? { Authorization: "Bearer " + token } : {},
        });
        if (!response.ok) throw new Error("Could not load the global knowledge graph");
        const payload = await response.json();
        if (!active) return;

        const apiEdges: EdgeT[] = (payload.edges || []).map((edge: any) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          label: edge.type,
          edgeKind: edge.edge_kind === 'covers' ? 'covers' : 'semantic',
          confidence: Number(edge.confidence || 0),
          discussionDuration: Number(edge.discussion_duration || 0),
          occurrenceRole: edge.occurrence_role,
          startSeconds: edge.start_seconds,
          endSeconds: edge.end_seconds,
          evidence: edge.evidence || [],
        }));
        const related = new Map<string, Set<string>>();
        apiEdges.forEach(edge => {
          if (!related.has(edge.source)) related.set(edge.source, new Set());
          if (!related.has(edge.target)) related.set(edge.target, new Set());
          related.get(edge.source)!.add(edge.target);
          related.get(edge.target)!.add(edge.source);
        });

        const rawNodes = payload.nodes || [];
        const nameToId = new Map<string, string>();
        rawNodes.forEach((node: any) => {
          nameToId.set(String(node.name || "").trim().toLowerCase(), node.id);
          (node.aliases || []).forEach((alias: string) => nameToId.set(alias.trim().toLowerCase(), node.id));
        });
        const loadedNodes: ConceptNode[] = rawNodes.map((node: any, index: number) => {
          const rawType = String(node.type || node.node_type || "concept").toLowerCase();
          const type: NodeType = ["definition", "example", "warning", "advanced", "chapter", "subchapter"].includes(rawType)
            ? rawType as NodeType : "concept";
          const nodeType = (node.node_type === "chapter" || node.node_type === "subchapter")
            ? node.node_type : "concept";
          const domain = String(node.domain || "General").replaceAll("_", " ");
          const prerequisites = (node.prerequisites || [])
            .map((name: string) => nameToId.get(String(name).trim().toLowerCase()))
            .filter(Boolean) as string[];
          return {
            id: node.id,
            name: node.name,
            type,
            nodeType,
            sectionId: node.section_id,
            resourceId: node.resource_id,
            resourceTitle: node.resource_title,
            resourceType: node.resource_type,
            startSeconds: node.start_seconds,
            endSeconds: node.end_seconds,
            chapterId: node.chapter_id || ("domain:" + domain),
            topic: nodeType === "concept" ? domain : (node.resource_title || "Source"),
            x: 210 + (index % 6) * 235,
            y: 120 + Math.floor(index / 6) * 150,
            confidence: Number(node.confidence || 0),
            difficulty: nodeType === "concept"
              ? (["Beginner", "Intermediate", "Advanced"].includes(node.difficulty)
                ? node.difficulty : "Intermediate") as Difficulty
              : undefined,
            learningStage: node.learning_stage || (nodeType === "concept" ? "Practical" : "Source"),
            importance: Number(node.importance || 0),
            first: node.first || "--",
            last: node.last || "--",
            mentions: Number(node.mentions || 0),
            study: node.study || Math.max(2, Math.ceil(Number(node.mentions || 1) / 2)) + " min",
            definition: node.description || "",
            summary: node.summary || node.description || "",
            prerequisites,
            related: Array.from(related.get(node.id) || []),
            aliases: node.aliases || [],
          };
        });
        const sourceChapters: ChapterT[] = rawNodes
          .filter((node: any) => node.node_type === "chapter" || node.node_type === "subchapter")
          .map((node: any, index: number) => ({
            id: node.chapter_id || node.id,
            title: node.name,
            order: index + 1,
            start: node.first || "--",
            end: node.last || "--",
          }));
        const loadedChapters = Array.from(
          new Map(sourceChapters.map(chapter => [chapter.id, chapter])).values()
        );
        const preferences = payload.preferences || {};
        const loadedDistance = Number(preferences.node_distance || 140);
        const loadedLayout: GraphLayout = ['organic', 'radial', 'learning'].includes(preferences.graph_layout)
          ? preferences.graph_layout
          : 'organic';
        const loadedGroup: ExplorerGroup = ['none', 'favorite', 'chapter', 'type', 'difficulty'].includes(preferences.explorer_group)
          ? preferences.explorer_group
          : 'none';
        const loadedFilters = preferences.filters || {};
        const loadedFavorites = rawNodes.filter((node: any) => Boolean(node.favorite)).map((node: any) => node.id);
        const loadedEmptyReason: EmptyReason = Number(payload.generation?.completed_resources || 0) > 0
          ? 'no_qualifying_concepts'
          : 'not_generated';
        const loadedMode: Exclude<DemoMode, 'loading'> = loadedNodes.length ? 'ready' : 'empty';
        if (loadingPreviewTimer) clearTimeout(loadingPreviewTimer);
        setShowLoadingPreview(false);
        preferencesLoadedRef.current = true;
        setNodeDistance(loadedDistance);
        setGraphLayout(loadedLayout);
        setGroupBy(loadedGroup);
        setFilters({
          difficulty: new Set((loadedFilters.difficulty || []).filter((item: string) => ['Beginner', 'Intermediate', 'Advanced'].includes(item)) as Difficulty[]),
          types: new Set((loadedFilters.types || []).filter((item: string) => ['concept', 'definition', 'example', 'warning', 'advanced', 'subchapter'].includes(item)) as NodeType[]),
          favoritesOnly: Boolean(loadedFilters.favorites_only),
        });
        setNodes(loadedNodes);
        setFavorites(new Set(loadedFavorites));
        setEdges(apiEdges);
        setChapters(loadedChapters);
        setEmptyReason(loadedEmptyReason);
        setDemoMode(loadedMode);
        knowledgeViewCache = {
          mode: loadedMode,
          emptyReason: loadedEmptyReason,
          nodes: loadedNodes,
          edges: apiEdges,
          chapters: loadedChapters,
          favorites: loadedFavorites,
          nodeDistance: loadedDistance,
          graphLayout: loadedLayout,
          groupBy: loadedGroup,
          filters: {
            difficulty: (loadedFilters.difficulty || []).filter((item: string) => ['Beginner', 'Intermediate', 'Advanced'].includes(item)) as Difficulty[],
            types: (loadedFilters.types || []).filter((item: string) => ['concept', 'definition', 'example', 'warning', 'advanced', 'subchapter'].includes(item)) as NodeType[],
            favoritesOnly: Boolean(loadedFilters.favorites_only),
          },
        };
      } catch (error) {
        if (!active) return;
        if (loadingPreviewTimer) clearTimeout(loadingPreviewTimer);
        setShowLoadingPreview(false);
        if (cachedAtStart) {
          setToast(error instanceof Error ? error.message : "Knowledge graph could not be refreshed");
          return;
        }
        setNodes([]);
        setEdges([]);
        setChapters([]);
        setEmptyReason('load_error');
        setDemoMode("empty");
        setToast(error instanceof Error ? error.message : "Knowledge graph could not be loaded");
      }
    };
    loadGraph();
    return () => {
      active = false;
      if (loadingPreviewTimer) clearTimeout(loadingPreviewTimer);
    };
  }, []);

  useEffect(() => {
    if (demoMode === 'loading') return;
    knowledgeViewCache = {
      mode: demoMode,
      emptyReason,
      nodes,
      edges,
      chapters,
      favorites: Array.from(favorites),
      nodeDistance,
      graphLayout,
      groupBy,
      filters: {
        difficulty: Array.from(filters.difficulty),
        types: Array.from(filters.types),
        favoritesOnly: filters.favoritesOnly,
      },
    };
  }, [demoMode, emptyReason, nodes, edges, chapters, favorites, nodeDistance, graphLayout, groupBy, filters]);

  /* -------- current graph controls -------- */
  const fitToScreen = useCallback(() => graphRef.current?.fit(), []);
  const scrollTimeline = useCallback((direction: -1 | 1) => {
    timelineRef.current?.scrollBy({ left: direction * 520, behavior: 'smooth' });
  }, []);
  const persistViewPreferences = useCallback(async (overrides?: { nodeDistance?: number }) => {
    const distanceToSave = overrides?.nodeDistance ?? nodeDistance;
    try {
      const token = localStorage.getItem('access_token');
      const response = await fetch('/knowledge/preferences/node-distance', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
        },
        body: JSON.stringify({
          distance: distanceToSave,
          node_distance: distanceToSave,
          graph_layout: graphLayout,
          explorer_group: groupBy,
          filters: {
            difficulty: Array.from(filters.difficulty),
            types: Array.from(filters.types),
            favorites_only: filters.favoritesOnly,
          },
        }),
      });
      if (!response.ok) throw new Error('Knowledge view settings could not be saved');
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Knowledge view settings could not be saved');
    }
  }, [filters, graphLayout, groupBy, nodeDistance]);

  useEffect(() => {
    if (demoMode !== 'ready' || !preferencesLoadedRef.current) return;
    if (preferencesSaveTimer.current) clearTimeout(preferencesSaveTimer.current);
    preferencesSaveTimer.current = setTimeout(() => {
      persistViewPreferences();
    }, 450);
    return () => {
      if (preferencesSaveTimer.current) clearTimeout(preferencesSaveTimer.current);
    };
  }, [demoMode, filters, graphLayout, groupBy, nodeDistance, persistViewPreferences]);

  const handleLayoutChange = useCallback((layout: GraphLayout) => {
    setGraphLayout(layout);
    requestAnimationFrame(() => graphRef.current?.fit());
  }, []);

  const scrollToGraphNode = useCallback((id: string) => {
    setSelectedId(id);
    graphSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => graphRef.current?.fit(), 260);
  }, []);

  const scrollToTimelineNode = useCallback((id: string) => {
    setShowTimeline(true);
    setSelectedId(id);
    window.setTimeout(() => {
      timelineSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const card = timelineRef.current?.querySelector<HTMLElement>(`[data-timeline-id="${CSS.escape(id)}"]`);
      card?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }, 40);
  }, []);

  useEffect(() => { if (demoMode === 'ready') requestAnimationFrame(fitToScreen); }, [demoMode, fitToScreen]);

  // Prevent page scroll when hovering over the graph
  useEffect(() => {
    const stage = document.querySelector('.k-graph-stage');
    if (!stage) return;
    const handler: EventListener = (event) => {
      const target = event.target as Element | null;
      if (target?.closest('.k-drawer')) return;
      event.preventDefault();
    };
    stage.addEventListener('wheel', handler, { passive: false });
    return () => stage.removeEventListener('wheel', handler);
  }, [demoMode]);

  /* -------- derived / filtering -------- */
  const matchesSearch = useCallback((n: ConceptNode) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return n.name.toLowerCase().includes(q) || (n.aliases || []).some(a => a.toLowerCase().includes(q)) || (n.definition || '').toLowerCase().includes(q);
  }, [search]);
  const matchesFilters = useCallback((n: ConceptNode) => {
    if (filters.difficulty.size && (!n.difficulty || !filters.difficulty.has(n.difficulty))) return false;
    if (filters.types.size && !filters.types.has(n.type)) return false;
    if (filters.favoritesOnly && !favorites.has(n.id)) return false;
    return true;
  }, [filters, favorites]);
  const nodeVisible = useCallback((n: ConceptNode) => matchesSearch(n) && matchesFilters(n), [matchesSearch, matchesFilters]);

  const graphVisibleNodeIds = useMemo(() => {
    const ids = new Set<string>();
    const visibleConceptIds = new Set(
      nodes
        .filter(n => n.nodeType === 'concept' && nodeVisible(n))
        .map(n => n.id)
    );
    visibleConceptIds.forEach(id => ids.add(id));

    edges.forEach(edge => {
      if (edge.edgeKind !== 'covers' || !visibleConceptIds.has(edge.target)) return;
      const source = conceptById[edge.source];
      if (!source) return;
      if (!matchesSearch(source) && search.trim()) return;
      if (filters.types.size && !filters.types.has(source.type)) return;
      ids.add(source.id);
    });

    return ids;
  }, [conceptById, edges, filters.types, matchesSearch, nodeVisible, nodes, search]);

  /* Adapt this design's single data source to the existing graph renderer. */
  const graphConcepts = useMemo<KnowledgeConcept[]>(() => nodes.filter(n => graphVisibleNodeIds.has(n.id)).map(n => {
    const chapter = chapterLookup[n.chapterId];
    const x = 90 + ((n.x - 210) / (1440 - 210)) * 1020;
    const y = 80 + ((n.y - 120) / (775 - 120)) * 540;
    return {
      id: n.id,
      title: n.name,
      kind: n.type,
      nodeType: n.nodeType,
      sectionId: n.sectionId,
      resourceId: n.resourceId,
      resourceTitle: n.resourceTitle,
      resourceType: n.resourceType,
      startSeconds: n.startSeconds,
      endSeconds: n.endSeconds,
      definition: n.definition || '',
      summary: n.summary || '',
      confidence: n.confidence ?? 100,
      difficulty: n.difficulty ?? 'Beginner',
      importance: n.importance ?? 100,
      learningStage: n.learningStage ?? 'Chapter',
      chapter: chapter?.title ?? n.topic,
      firstMention: n.first ?? chapter?.start ?? '00:00',
      lastMention: n.last ?? chapter?.end ?? '00:00',
      mentions: n.mentions ?? 0,
      studyMinutes: Number.parseInt(n.study || '0', 10) || 0,
      aliases: n.aliases || [],
      prerequisites: n.prerequisites || [],
      relatedIds: n.related || [],
      favorite: favorites.has(n.id),
      pinned: false,
      x,
      y,
    };
  }), [chapterLookup, favorites, graphVisibleNodeIds, nodes]);

  const graphConceptIds = useMemo(() => new Set(graphConcepts.map(n => n.id)), [graphConcepts]);
  const graphRelationships = useMemo<KnowledgeRelationship[]>(() => edges
    .filter(edge => graphConceptIds.has(edge.source) && graphConceptIds.has(edge.target))
    .map(edge => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: edge.label as RelationshipType,
      confidence: edge.confidence ?? 92,
      edgeKind: edge.edgeKind || 'semantic',
      discussionDuration: edge.discussionDuration,
      occurrenceRole: edge.occurrenceRole,
      startSeconds: edge.startSeconds,
      endSeconds: edge.endSeconds,
      evidence: edge.evidence,
    })), [edges, graphConceptIds]);

  const stats = useMemo(() => {
    const conceptNodes = nodes.filter(n => n.nodeType === 'concept');
    const sourceNodes = nodes.filter(n => n.nodeType === 'chapter' || n.nodeType === 'subchapter');
    const semanticEdges = edges.filter(edge => edge.edgeKind === 'semantic');
    const confs = conceptNodes.filter(n => n.confidence !== undefined).map(n => n.confidence as number);
    const avgConf = confs.length
      ? Math.round(confs.reduce((a, b) => a + b, 0) / confs.length)
      : 0;
    const stages = new Set(conceptNodes.map(n => n.learningStage).filter(Boolean));
    const topics = new Set(conceptNodes.map(n => n.topic).filter(Boolean));
    const diffCounts: Record<string, number> = {};
    conceptNodes.forEach(n => {
      if (n.difficulty) diffCounts[n.difficulty] = (diffCounts[n.difficulty] || 0) + 1;
    });
    const estDifficulty = Object.entries(diffCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'N/A';
    return [
      { l: 'Concepts', v: String(conceptNodes.length), key: 'concepts', c: 'var(--k-blue)', s: 'var(--k-blue-soft)' },
      { l: 'Relationships', v: String(semanticEdges.length), key: 'rel', c: 'var(--k-purple)', s: 'var(--k-purple-soft)' },
      { l: 'Learning Stages', v: String(stages.size), key: 'stages', c: 'var(--k-green)', s: 'var(--k-green-soft)' },
      { l: 'Avg. Confidence', v: avgConf + '%', key: 'conf', c: 'var(--k-accent)', s: 'var(--k-accent-soft)' },
      { l: 'Topics Detected', v: String(topics.size), key: 'topics', c: 'var(--k-blue)', s: 'var(--k-blue-soft)' },
      { l: 'Est. Difficulty', v: estDifficulty, key: 'diff', c: 'var(--k-red)', s: 'var(--k-red-soft)' },
      { l: 'Chapters Covered', v: String(sourceNodes.length), key: 'chapters', c: 'var(--k-gray)', s: 'var(--k-gray-soft)' },
      { l: 'Processing Status', v: 'Ready', key: 'status', c: 'var(--k-green)', s: 'var(--k-green-soft)' },
    ];
  }, [edges, nodes]);

  const explorerRows = useMemo(() => {
    let rows = nodes.filter(n => n.type !== 'chapter' && n.type !== 'subchapter').filter(nodeVisible);
    if (groupBy === 'favorite') rows = rows.filter(n => favorites.has(n.id));
    const dir = sortDir === 'asc' ? 1 : -1;
    rows = rows.slice().sort((a, b) => {
      let av: any = sortKey === 'name' ? a.name : (a as any)[sortKey];
      let bv: any = sortKey === 'name' ? b.name : (b as any)[sortKey];
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return ((av || 0) - (bv || 0)) * dir;
    });
    return rows;
  }, [favorites, groupBy, nodeVisible, nodes, sortKey, sortDir]);

  function flashToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }

  const pulseExplorerRow = useCallback((id: string) => {
    setPulseNodeIds(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    window.setTimeout(() => {
      setPulseNodeIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 760);
  }, []);

  async function toggleFav(id: string) {
    const token = localStorage.getItem('access_token');
    const favorite = !favorites.has(id);
    const node = conceptById[id];
    const endpoint = node?.sectionId
      ? '/knowledge/source-sections/' + encodeURIComponent(node.sectionId) + '/favorite'
      : '/knowledge/concepts/' + encodeURIComponent(id) + '/favorite';
    setFavorites(prev => {
      const next = new Set(prev);
      favorite ? next.add(id) : next.delete(id);
      return next;
    });
    try {
      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
        },
        body: JSON.stringify({ favorite }),
      });
      if (!response.ok) throw new Error('Favorite could not be saved');
      flashToast(favorite ? 'Added to favorites.' : 'Removed from favorites.');
    } catch (error) {
      setFavorites(prev => {
        const next = new Set(prev);
        favorite ? next.delete(id) : next.add(id);
        return next;
      });
      flashToast(error instanceof Error ? error.message : 'Favorite could not be saved');
    }
  }

  async function renameConcept(id: string) {
    const node = conceptById[id];
    if (!node || node.nodeType !== 'concept') return;
    setConceptDialog({ kind: 'rename', id, value: node.name });
  }

  async function confirmRenameConcept(id: string, rawName: string) {
    const node = conceptById[id];
    if (!node || node.nodeType !== 'concept') return;
    const name = rawName.trim();
    if (!name || name === node.name) {
      setConceptDialog(null);
      return;
    }
    setConceptDialog({ kind: 'rename', id, value: rawName, busy: true });
    try {
      const token = localStorage.getItem('access_token');
      const response = await fetch('/knowledge/concepts/' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
        },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.detail || 'Concept could not be renamed');
      }
      setNodes(current => current.map(item => item.id === id ? { ...item, name } : item));
      pulseExplorerRow(id);
      setConceptDialog(null);
      flashToast('Concept renamed.');
    } catch (error) {
      setConceptDialog({ kind: 'rename', id, value: rawName });
      flashToast(error instanceof Error ? error.message : 'Concept could not be renamed');
    }
  }

  async function removeConcept(id: string) {
    const node = conceptById[id];
    if (!node || node.nodeType !== 'concept') return;
    setConceptDialog({ kind: 'delete', id });
  }

  async function confirmDeleteConcept(id: string) {
    const node = conceptById[id];
    if (!node || node.nodeType !== 'concept') return;
    setConceptDialog({ kind: 'delete', id, busy: true });
    try {
      const token = localStorage.getItem('access_token');
      const response = await fetch('/knowledge/concepts/' + encodeURIComponent(id), {
        method: 'DELETE',
        headers: token ? { Authorization: 'Bearer ' + token } : {},
      });
      if (!response.ok) throw new Error('Concept could not be deleted');
      setRemovingNodeIds(prev => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      setSelectedId(current => current === id ? null : current);
      setConceptDialog(null);
      flashToast('Concept deleted and suppressed.');
      window.setTimeout(() => {
        setNodes(current => current
          .filter(item => item.id !== id)
          .map(item => ({
            ...item,
            prerequisites: (item.prerequisites || []).filter(ref => ref !== id),
            related: (item.related || []).filter(ref => ref !== id),
          })));
        setEdges(current => current.filter(edge => edge.source !== id && edge.target !== id));
        setFavorites(current => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
        setRemovingNodeIds(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 240);
    } catch (error) {
      setConceptDialog({ kind: 'delete', id });
      flashToast(error instanceof Error ? error.message : 'Concept could not be deleted');
    }
  }

  function toggleSetVal<T>(set: Set<T>, val: T): Set<T> {
    const next = new Set(set); next.has(val) ? next.delete(val) : next.add(val); return next;
  }


  const selectedNode = selectedId ? conceptById[selectedId] : null;

  /* =====================================================================================
     RENDER
  ===================================================================================== */
  return (
    <div className="k-root" data-k-theme={theme}>
      <style>{STYLES}</style>

      <div className="k-wrap">

        {demoMode === 'loading' && showLoadingPreview && (
          <div className="k-fade">
            <div className="k-header"><div><h2>Knowledge</h2><p>Explore how ideas connect throughout this lesson.</p></div></div>
            <div className="k-stats">
              {Array.from({ length: 8 }).map((_, i) => <div key={i} className="k-skel" style={{ height: 78, animationDelay: `${i * 0.05}s` }} />)}
            </div>
            <div className="k-graph-section" style={{ height: 'min(65vh,640px)', minHeight: 460 }}>
              <div className="k-graph-loading">
                <div className="k-load-spinner" />
                <div className="k-load-stages">
                  {LOAD_STAGES.map((s, i) => (
                    <div key={s} className={`k-load-stage ${i < loadStageIdx ? 'done' : ''} ${i === loadStageIdx ? 'active' : ''}`}>
                      <span className="k-load-dot">{i < loadStageIdx ? <Check className="k-icon" style={{ width: 10, height: 10, color: 'var(--k-green)' }} /> : null}</span>
                      {s}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {demoMode === 'empty' && (
          <div className="k-fade">
            <div className="k-header"><div><h2>Knowledge</h2><p>Explore how ideas connect throughout this lesson.</p></div></div>
            <div className="k-graph-section" style={{ height: 520 }}>
              <div className="k-graph-empty k-empty-wrap">
                <div className="k-empty-illustration">
                  <svg viewBox="0 0 160 160" fill="none">
                    <circle cx="80" cy="80" r="78" stroke="var(--k-border)" strokeWidth="1.5" strokeDasharray="4 6" />
                    <circle cx="80" cy="46" r="9" fill="var(--k-blue-soft)" stroke="var(--k-blue)" strokeWidth="2" />
                    <circle cx="46" cy="104" r="9" fill="var(--k-purple-soft)" stroke="var(--k-purple)" strokeWidth="2" />
                    <circle cx="114" cy="104" r="9" fill="var(--k-green-soft)" stroke="var(--k-green)" strokeWidth="2" />
                    <circle cx="80" cy="112" r="6" fill="var(--k-accent-soft)" stroke="var(--k-accent)" strokeWidth="2" />
                    <path d="M80 55V100M74 52 52 96M86 52 108 96" stroke="var(--k-border-strong)" strokeWidth="1.5" strokeDasharray="3 5" />
                  </svg>
                </div>
                <h3>
                  {emptyReason === 'no_qualifying_concepts'
                    ? 'Extraction completed with no qualifying concepts.'
                    : emptyReason === 'load_error'
                      ? 'The knowledge graph could not be loaded.'
                      : 'No library knowledge has been generated yet.'}
                </h3>
                <p>
                  {emptyReason === 'no_qualifying_concepts'
                    ? 'The processed resource contained no subjects that met the strict discussion, evidence, and confidence requirements.'
                    : emptyReason === 'load_error'
                      ? 'Check the backend connection and try opening the Knowledge page again.'
                      : 'Select a resource in File Explorer and use Generate Knowledge from its Details panel.'}
                </p>
              </div>
            </div>
          </div>
        )}

        {demoMode === 'ready' && (
          <div className="k-fade">
            {/* ---------- HEADER ---------- */}
            <div className="k-header">
              <div>
                <h2>Knowledge <span className="badge-live">AI Generated</span></h2>
                <p>Explore how ideas connect throughout this lesson.</p>
              </div>
            </div>

            {/* ---------- STATS ---------- */}
            <div className="k-stats">
              {stats.map((s, i) => (
                <div key={s.l} className="k-stat-card" style={{ animationDelay: `${i * 0.045}s` }}>
                  <div className="ic" style={{ background: s.s, color: s.c }}>{StatIcon[s.key]}</div>
                  <div className="val">{s.v}</div>
                  <div className="lbl">{s.l}</div>
                </div>
              ))}
            </div>

            {/* ---------- TOOLBAR ---------- */}
            <div className="k-toolbar">
              <div className="k-search">
                <Search className="k-icon" />
                <input placeholder="Search concepts, definitions, aliases" value={search} onChange={e => setSearch(e.target.value)} />
                <kbd>/</kbd>
              </div>
              <div className="k-sep" />
              <button className={`k-tb-btn ${filtersOpen ? 'active' : ''}`} onClick={() => setFiltersOpen(o => !o)}><Filter className="k-icon" />Filters</button>
              <div className="k-sep" />
              <PrettySelect<GraphLayout>
                value={graphLayout}
                options={[
                  { value: 'organic', label: 'Cluster Layout' },
                  { value: 'radial', label: 'Radial Layout' },
                  { value: 'learning', label: 'Hierarchical Layout' },
                ]}
                onChange={handleLayoutChange}
              />
              <label className="k-distance-control" title="Distance between concepts and their covered source sections">
                <span>Distance</span>
                <input
                  type="range"
                  min={60}
                  max={400}
                  step={10}
                  value={nodeDistance}
                  onChange={e => setNodeDistance(Number(e.target.value))}
                  onPointerUp={e => persistViewPreferences({ nodeDistance: Number(e.currentTarget.value) })}
                  onKeyUp={e => persistViewPreferences({ nodeDistance: Number(e.currentTarget.value) })}
                />
                <output>{nodeDistance}</output>
              </label>
              <button className="k-tb-btn" onClick={fitToScreen}><Crosshair className="k-icon" />Fit to Screen</button>
              <div className="k-sep" />
              <button className={`k-tb-btn ${showTimeline ? 'active' : ''}`} onClick={() => setShowTimeline(v => !v)}><Clock className="k-icon" />Timeline</button>
              <button className={`k-tb-btn ${showExplorer ? 'active' : ''}`} onClick={() => setShowExplorer(v => !v)}><List className="k-icon" />Explorer</button>
              <div style={{ flex: 1 }} />
            </div>

            {/* ---------- FILTERS ---------- */}
            <div className={`k-filters ${filtersOpen ? 'open' : ''}`}>
              <div className="k-filters-inner">
                <div>
                  <div className="k-ft">Difficulty</div>
                  <div className="k-chip-row">
                    {(['Beginner', 'Intermediate', 'Advanced'] as Difficulty[]).map(d => (
                      <span key={d} className={`k-chip ${filters.difficulty.has(d) ? 'on' : ''}`}
                        onClick={() => setFilters(f => ({ ...f, difficulty: toggleSetVal(f.difficulty, d) }))}>
                        <span className="dot" style={{ background: DIFF_META[d].color }} />{d}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="k-ft">Concept Type</div>
                  <div className="k-chip-row">
                    {(Object.entries(TYPE_META) as [NodeType, typeof TYPE_META[NodeType]][]).filter(([k]) => k !== 'chapter').map(([k, m]) => (
                      <span key={k} className={`k-chip ${filters.types.has(k) ? 'on' : ''}`}
                        onClick={() => setFilters(f => ({ ...f, types: toggleSetVal(f.types, k) }))}>
                        <span className="dot" style={{ background: m.color }} />{m.label}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="k-ft">Favorites</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div className={`k-switch ${filters.favoritesOnly ? 'on' : ''}`} onClick={() => setFilters(f => ({ ...f, favoritesOnly: !f.favoritesOnly }))}><div className="knob" /></div>
                    <span style={{ fontSize: 12.5, color: 'var(--k-text-secondary)' }}>Show favorites only</span>
                    <button className="k-btn sm" style={{ marginLeft: 8, background: 'transparent', whiteSpace: 'nowrap' }}
                      onClick={() => setFilters({ difficulty: new Set(), types: new Set(), favoritesOnly: false })}>
                      Clear all filters
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* ---------- GRAPH ---------- */}
            <div ref={graphSectionRef} className="k-graph-section">
              <div className="k-graph-titlebar">
                <h3><span className="icwrap"><GitBranch className="k-icon" style={{ width: 14, height: 14 }} /></span>Interactive Knowledge Graph</h3>
                <div className="k-graph-hint">
                  <span><Search className="k-icon" style={{ width: 12, height: 12 }} /> scroll to zoom</span>
                  <span>drag to pan</span>
                  <span><kbd>Esc</kbd> deselect</span>
                </div>
              </div>
              <div className="k-graph-stage k-current-graph kx-page">
                <KnowledgeGraph
                  ref={graphRef}
                  concepts={graphConcepts}
                  relationships={graphRelationships}
                  selectedId={selectedId}
                  query={search}
                  layout={graphLayout}
                  nodeDistance={nodeDistance}
                  onSelect={setSelectedId}
                />
                <div className={`k-drawer-backdrop ${selectedNode ? 'open' : ''}`} />
                <aside
                  className={`k-drawer ${selectedNode ? 'open' : ''}`}
                  onWheelCapture={event => event.stopPropagation()}
                  onWheel={event => event.stopPropagation()}
                >
                  {selectedNode && <DrawerContent n={selectedNode} conceptById={conceptById} isFav={favorites.has(selectedNode.id)}
                    edges={edges} onClose={() => setSelectedId(null)} onJump={scrollToGraphNode} onFav={() => toggleFav(selectedNode.id)} onToast={flashToast} />}
                </aside>
              </div>
            </div>

            {/* ---------- TIMELINE (structure matches reference image) ---------- */}
            {showTimeline && (
              <div ref={timelineSectionRef}>
                <div className="k-section-head">
                  <div>
                    <h3><span className="icwrap"><Clock className="k-icon" style={{ width: 14, height: 14 }} /></span>Learning Timeline</h3>
                    <p>Concepts in the order they're taught throughout the lesson.</p>
                  </div>
                </div>
                <div className="k-timeline-wrap">
                  <button type="button" className="k-timeline-arrow left" onClick={() => scrollTimeline(-1)} aria-label="Scroll timeline left"><ChevronLeft className="k-icon" /></button>
                  <div ref={timelineRef} className="k-timeline-track">
                    {timelineOrder.map(id => {
                      const n = conceptById[id];
                      const dm = DIFF_META[n.difficulty as Difficulty];
                      return (
                        <div key={id}
                          data-timeline-id={id}
                          className={`k-tl-card ${selectedId === id ? 'selected' : ''} ${!nodeVisible(n) ? 'dimmed' : ''}`}
                          onClick={() => scrollToTimelineNode(id)}>
                          <div className="k-tl-top-row">
                            <span className="k-tl-ts">{n.first}</span>
                            <span className="k-tl-diff" style={{ color: dm.color }}>{n.difficulty?.toUpperCase()}</span>
                          </div>
                          <div className="k-tl-name">{n.name}</div>
                          <div className="k-tl-bottom-row">
                            <span className="k-tl-conf"><span className="dot" style={{ background: confTier(n.confidence) }} />Confidence</span>
                            <button className="k-tl-play" onClick={(e) => { e.stopPropagation(); flashToast(`Jumping to ${n.first}`); }}>
                              <Play className="k-icon" style={{ width: 12, height: 12 }} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <button type="button" className="k-timeline-arrow right" onClick={() => scrollTimeline(1)} aria-label="Scroll timeline right"><ChevronRight className="k-icon" /></button>
                  <div className="k-tl-line" />
                </div>
              </div>
            )}

            {/* ---------- EXPLORER ---------- */}
            {showExplorer && (
              <>
                <div className="k-section-head">
                  <div>
                    <h3><span className="icwrap" style={{ background: 'var(--k-green-soft)', color: 'var(--k-green)' }}><List className="k-icon" style={{ width: 14, height: 14 }} /></span>Concept Explorer</h3>
                    <p>Search, sort, and drill into every extracted concept.</p>
                  </div>
                </div>
                <div className="k-explorer-wrap">
                  <div className="k-explorer-topbar">
                    <div className="k-search" style={{ maxWidth: 'none', flex: 1 }}>
                      <Search className="k-icon" />
                      <input placeholder="Filter explorer" value={search} onChange={e => setSearch(e.target.value)} />
                    </div>
                    <PrettySelect<ExplorerGroup>
                      value={groupBy}
                      options={[
                        { value: 'none', label: 'Group: None' },
                        { value: 'favorite', label: 'Group: Favorite' },
                        { value: 'chapter', label: 'Group: Chapter' },
                        { value: 'type', label: 'Group: Type' },
                        { value: 'difficulty', label: 'Group: Difficulty' },
                      ]}
                      onChange={setGroupBy}
                      className="k-group-select"
                    />
                  </div>
                  <div className="k-explorer-table-scroll">
                    <table className="k-etable">
                      <thead>
                        <tr>
                          {([
                            ['name', 'Concept'], ['confidence', 'Confidence'], ['difficulty', 'Difficulty'], ['mentions', 'Frequency'],
                            ['chapterId', 'Chapter'], ['first', 'First TS'], ['last', 'Last TS'], ['aliases', 'Aliases'], ['related', 'Relations'], ['actions', 'Actions'],
                          ] as [string, string][]).map(([k, l]) => (
                            <th key={k} className={sortKey === k ? 'active-sort' : ''}
                              onClick={() => {
                                if (k === 'actions') return;
                                if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortKey(k as SortKey); setSortDir('asc'); }
                              }}>
                              {l}{k !== 'actions' && <ChevronDown className="k-icon" style={{ width: 12, height: 12, marginLeft: 4, display: 'inline', opacity: sortKey === k ? 1 : 0.5 }} />}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          if (groupBy === 'none') return explorerRows.map(n => <ExplorerRow key={n.id} n={n} selected={selectedId === n.id} visible={nodeVisible(n)}
                            pulsing={pulseNodeIds.has(n.id)} removing={removingNodeIds.has(n.id)}
                            isFav={favorites.has(n.id)} onOpen={() => scrollToGraphNode(n.id)} onFav={() => toggleFav(n.id)} onRename={() => renameConcept(n.id)} onDelete={() => removeConcept(n.id)} />);
                          const groups: Record<string, ConceptNode[]> = {};
                          explorerRows.forEach(n => {
                            const g = groupBy === 'favorite' ? 'Favorites' : groupBy === 'chapter' ? chapterLookup[n.chapterId].title : groupBy === 'type' ? TYPE_META[n.type].label : (n.difficulty || '-');
                            (groups[g] = groups[g] || []).push(n);
                          });
                          return Object.entries(groups).map(([g, ns]) => (
                            <React.Fragment key={g}>
                              <tr className="k-group-row"><td colSpan={10}>{g} <span style={{ opacity: .6, fontWeight: 600 }}>({ns.length})</span></td></tr>
                              {ns.map(n => <ExplorerRow key={n.id} n={n} selected={selectedId === n.id} visible={nodeVisible(n)}
                                pulsing={pulseNodeIds.has(n.id)} removing={removingNodeIds.has(n.id)}
                                isFav={favorites.has(n.id)} onOpen={() => scrollToGraphNode(n.id)} onFav={() => toggleFav(n.id)} onRename={() => renameConcept(n.id)} onDelete={() => removeConcept(n.id)} />)}
                            </React.Fragment>
                          ));
                        })()}
                      </tbody>
                    </table>
                  </div>
                  <div className="k-explorer-footer">
                    <span>{explorerRows.length} of {nodes.filter(n => n.type !== 'chapter' && n.type !== 'subchapter').length} concepts</span>
                    <span>Virtual scrolling ready for large datasets</span>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {conceptDialog && createPortal((
        <div className="k-modal-backdrop" role="presentation" onMouseDown={() => !conceptDialog.busy && setConceptDialog(null)}>
          <div className="k-modal-card" role="dialog" aria-modal="true" onMouseDown={e => e.stopPropagation()}>
            <button className="k-modal-close" onClick={() => setConceptDialog(null)} disabled={conceptDialog.busy} title="Close">
              <X className="k-icon" style={{ width: 16, height: 16 }} />
            </button>
            {conceptDialog.kind === 'rename' ? (
              <>
                <div className="k-modal-kicker">Rename Concept</div>
                <h3>Update concept name</h3>
                <p>Rename this concept everywhere it appears in the knowledge graph.</p>
                <input
                  className="k-modal-input"
                  autoFocus
                  value={conceptDialog.value}
                  onChange={e => setConceptDialog({ ...conceptDialog, value: e.target.value })}
                  onKeyDown={e => {
                    if (e.key === 'Enter') confirmRenameConcept(conceptDialog.id, conceptDialog.value);
                    if (e.key === 'Escape') setConceptDialog(null);
                  }}
                />
                <div className="k-modal-actions">
                  <button className="k-modal-btn" onClick={() => setConceptDialog(null)} disabled={conceptDialog.busy}>Cancel</button>
                  <button className="k-modal-btn primary" onClick={() => confirmRenameConcept(conceptDialog.id, conceptDialog.value)} disabled={conceptDialog.busy}>
                    {conceptDialog.busy ? 'Saving...' : 'Save Name'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="k-modal-kicker danger">Delete Concept</div>
                <h3>Delete and suppress this concept?</h3>
                <p>This removes the concept from the graph and prevents regeneration from recreating it automatically.</p>
                <div className="k-modal-name">{conceptById[conceptDialog.id]?.name || 'Selected concept'}</div>
                <div className="k-modal-actions">
                  <button className="k-modal-btn" onClick={() => setConceptDialog(null)} disabled={conceptDialog.busy}>Cancel</button>
                  <button className="k-modal-btn danger" onClick={() => confirmDeleteConcept(conceptDialog.id)} disabled={conceptDialog.busy}>
                    {conceptDialog.busy ? 'Deleting...' : 'Delete Concept'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ), document.body)}

      {toast && <div className="k-toast">{toast}</div>}
    </div>
  );
}

/* =====================================================================================
   SUB-COMPONENTS
===================================================================================== */
function PrettySelect<T extends string>({ value, options, onChange, className }: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find(option => option.value === value) || options[0];

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`k-pretty-select ${open ? 'open' : ''} ${className || ''}`}>
      <button
        type="button"
        className="k-pretty-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
      >
        <span>{selected?.label}</span>
        <ChevronDown className="k-icon" style={{ width: 14, height: 14 }} />
      </button>
      {open && (
        <div className="k-pretty-menu" role="listbox">
          {options.map(option => (
            <button
              type="button"
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              className={`k-pretty-option ${option.value === value ? 'selected' : ''}`}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {option.value === value && <Check className="k-icon" style={{ width: 14, height: 14 }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ExplorerRow({ n, selected, visible, pulsing, removing, isFav, onOpen, onFav, onRename, onDelete }: {
  n: ConceptNode; selected: boolean; visible: boolean; pulsing?: boolean; removing?: boolean; isFav: boolean;
  onOpen: () => void; onFav: () => void; onRename: () => void; onDelete: () => void;
}) {
  const tm = TYPE_META[n.type];
  const dm = DIFF_META[n.difficulty as Difficulty];
  return (
    <tr className={`k-row ${!visible ? 'dimmed' : ''} ${selected ? 'selected' : ''} ${pulsing ? 'k-row-pulse' : ''} ${removing ? 'k-row-removing' : ''}`} onClick={onOpen}>
      <td>
        <div className="k-cell-concept">
          <span className="k-type-dot" style={{ background: tm.color }} />
          <div><div className="cn">{n.name}</div><div className="ct">{tm.label}</div></div>
        </div>
      </td>
      <td><div className="k-mini-conf"><div className="bar"><div style={{ width: `${n.confidence}%`, background: tm.color }} /></div><span className="n">{n.confidence}%</span></div></td>
      <td><span className="k-diff-pill" style={{ background: dm.soft, color: dm.color }}>{n.difficulty}</span></td>
      <td className="k-mono">{n.mentions}</td>
      <td>{n.topic}</td>
      <td className="k-mono">{n.first}</td>
      <td className="k-mono">{n.last}</td>
      <td style={{ fontSize: 11, color: 'var(--k-text-tertiary)' }}>{(n.aliases || []).join(', ') || '-'}</td>
      <td className="k-mono">{(n.related || []).length}</td>
      <td>
        <div className="k-row-actions">
          <button className="k-ra-btn" title="Open in graph" onClick={(e) => { e.stopPropagation(); onOpen(); }}><MessageCircle className="k-icon" style={{ width: 14, height: 14 }} /></button>
          <button className={`k-ra-btn ${isFav ? 'on' : ''}`} title="Favorite" onClick={(e) => { e.stopPropagation(); onFav(); }}><Star className="k-icon" style={{ width: 14, height: 14 }} /></button>
          <button className="k-ra-btn" title="Rename concept" onClick={(e) => { e.stopPropagation(); onRename(); }}><Pencil className="k-icon" style={{ width: 14, height: 14 }} /></button>
          <button className="k-ra-btn" title="Delete concept" onClick={(e) => { e.stopPropagation(); onDelete(); }}><Trash2 className="k-icon" style={{ width: 14, height: 14 }} /></button>
        </div>
      </td>
    </tr>
  );
}

function formatReferenceTime(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--';
  const seconds = Math.max(0, Math.floor(value));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours
    ? [hours, minutes, remainder].map(part => String(part).padStart(2, '0')).join(':')
    : [minutes, remainder].map(part => String(part).padStart(2, '0')).join(':');
}

function DrawerContent({ n, conceptById, edges, isFav, onClose, onJump, onFav, onToast }: {
  n: ConceptNode; conceptById: Record<string, ConceptNode>; edges: EdgeT[]; isFav: boolean; onClose: () => void; onJump: (id: string) => void; onFav: () => void; onToast: (m: string) => void;
}) {
  const tm = TYPE_META[n.type];
  const dm = n.difficulty ? DIFF_META[n.difficulty] : null;
  const sourceNode = n.nodeType === 'chapter' || n.nodeType === 'subchapter';
  const [references, setReferences] = useState<ConceptReference[] | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const coveredEdges = useMemo(() => edges.filter(edge => edge.edgeKind === 'covers' && edge.source === n.id), [edges, n.id]);
  const [selectedCoverageId, setSelectedCoverageId] = useState<string | null>(coveredEdges[0]?.id || null);
  const selectedCoverage = coveredEdges.find(edge => edge.id === selectedCoverageId) || coveredEdges[0];

  useEffect(() => {
    setReferences(null);
    setSourcesOpen(false);
    setSourcesLoading(false);
    setSelectedCoverageId(coveredEdges[0]?.id || null);
  }, [n.id, coveredEdges]);

  useEffect(() => {
    if (sourceNode) setReferences(null);
  }, [selectedCoverageId, sourceNode]);

  async function loadReferences() {
    if (references) return references;
    if (sourceNode && n.resourceId) {
      const loaded: ConceptReference[] = [{
        mention_id: n.sectionId || n.id,
        resource_id: n.resourceId,
        resource_title: n.resourceTitle || 'Untitled resource',
        resource_type: n.resourceType || '',
        source_type: n.nodeType || 'chapter',
        source_id: n.sectionId,
        role: 'covered',
        evidence_text: n.summary || n.definition,
        confidence: 1,
        jump_target: {
          start_seconds: selectedCoverage?.startSeconds ?? n.startSeconds,
          end_seconds: selectedCoverage?.endSeconds ?? n.endSeconds,
        },
      }];
      setReferences(loaded);
      return loaded;
    }
    setSourcesLoading(true);
    try {
      const token = localStorage.getItem('access_token');
      const response = await fetch('/knowledge/concepts/' + encodeURIComponent(n.id) + '/references', {
        headers: token ? { Authorization: 'Bearer ' + token } : {},
      });
      if (!response.ok) throw new Error('Sources could not be loaded');
      const payload = await response.json();
      const loaded = Array.isArray(payload) ? payload as ConceptReference[] : [];
      setReferences(loaded);
      return loaded;
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Sources could not be loaded');
      return [];
    } finally {
      setSourcesLoading(false);
    }
  }

  function openReference(reference: ConceptReference) {
    const resourceType = String(reference.resource_type || '').toLowerCase();
    const isAudio = resourceType.includes('audio');
    const isVideo = resourceType.includes('video') || resourceType.includes('youtube');
    if (!isAudio && !isVideo) {
      onToast('This source does not have a media player.');
      return;
    }
    const params = new URLSearchParams();
    const fileUrl = '/resources/' + encodeURIComponent(reference.resource_id) + '/file';
    params.set(isAudio ? 'audioUrl' : 'videoUrl', fileUrl);
    params.set('resourceId', reference.resource_id);
    const startSeconds = reference.jump_target?.start_seconds;
    if (typeof startSeconds === 'number' && Number.isFinite(startSeconds)) {
      params.set('t', String(Math.max(0, startSeconds)));
    }
    params.set('tab', 'transcript');
    const token = localStorage.getItem('access_token');
    if (token) params.set('token', token);
    window.location.href = '/?' + params.toString();
  }

  async function handleViewSources() {
    const willOpen = !sourcesOpen;
    setSourcesOpen(willOpen);
    if (willOpen) await loadReferences();
  }

  async function handleOpenTranscript() {
    const loaded = await loadReferences();
    const reference = loaded.find(item =>
      typeof item.jump_target?.start_seconds === 'number'
      && (String(item.resource_type).toLowerCase().includes('video')
        || String(item.resource_type).toLowerCase().includes('audio')
        || String(item.resource_type).toLowerCase().includes('youtube'))
    );
    if (!reference) {
      onToast('No timestamped transcript source is available.');
      return;
    }
    openReference(reference);
  }

  async function handleJumpToVideo() {
    const loaded = await loadReferences();
    if (!loaded.length) {
      onToast('No timestamped media source is available.');
      return;
    }
    openReference(loaded[0]);
  }

  async function handleCopySummary() {
    const text = [n.name, n.summary || n.definition].filter(Boolean).join('\n\n');
    if (!text) {
      onToast('There is no summary to copy.');
      return;
    }
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable');
      await navigator.clipboard.writeText(text);
      onToast('Summary copied.');
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Summary could not be copied');
    }
  }

  return (
    <>
      <div className="k-drawer-head">
        <div className="k-drawer-type" style={{ color: tm.color }}><span style={{ background: tm.color }} />{tm.label}</div>
        <button className="k-icon-btn" onClick={onClose} title="Close"><X className="k-icon" style={{ width: 16, height: 16 }} /></button>
      </div>
      <div className="k-drawer-body">
        <h2>{escapeText(n.name)}</h2>
        <div className="k-dmeta">
          {n.confidence !== undefined && <span style={{ color: 'var(--k-green)' }}><span className="dot" style={{ background: 'var(--k-green)' }} />{n.confidence}% confidence</span>}
          {n.difficulty && dm && <span style={{ color: dm.color }}><span className="dot" style={{ background: dm.color }} />{n.difficulty}</span>}
          {n.learningStage && <span><Layers className="k-icon" style={{ width: 12, height: 12 }} />{n.learningStage}</span>}
          {n.mentions !== undefined && <span><Info className="k-icon" style={{ width: 12, height: 12 }} />{n.mentions} mentions</span>}
        </div>
        <div className="k-dsec"><div className="k-dh">Definition</div><div className="k-dtext">{escapeText(n.definition) || 'No definition available.'}</div></div>
        <div className="k-dsec"><div className="k-dh">Summary</div><div className="k-dtext">{escapeText(n.summary) || 'No summary available.'}</div></div>
        <div className="k-dsec"><div className="k-dh">Prerequisites</div>
          <div className="k-taglist">
            {(n.prerequisites || []).length ? n.prerequisites!.map(id => <button key={id} className="t" onClick={() => onJump(id)}>{conceptById[id]?.name || id}</button>) : <span style={{ color: 'var(--k-text-tertiary)', fontSize: 12 }}>No prerequisites detected.</span>}
          </div>
        </div>
        <div className="k-dsec"><div className="k-dh">Related Concepts</div>
          <div className="k-taglist">
            {(n.related || []).length ? n.related!.map(id => <button key={id} className="t" onClick={() => onJump(id)}>{conceptById[id]?.name || id}</button>) : <span style={{ color: 'var(--k-text-tertiary)', fontSize: 12 }}>No related concepts detected.</span>}
          </div>
        </div>
        <div className="k-dsec"><div className="k-dh">Aliases</div>
          <div className="k-taglist">
            {(n.aliases || []).length ? n.aliases!.map(a => <span key={a} className="t">{a}</span>) : <span style={{ color: 'var(--k-text-tertiary)', fontSize: 12 }}>No aliases detected.</span>}
          </div>
        </div>
{sourceNode && (
        <div className="k-dsec">
          <div className="k-dh">Concepts Covered</div>
          <div className="k-covered-list">
            {coveredEdges.map(edge => {
              const concept = conceptById[edge.target];
              const evidence = edge.evidence?.[0];
              return (
                <button
                  key={edge.id}
                  className={'k-covered-row ' + (selectedCoverage?.id === edge.id ? 'selected' : '')}
                  onClick={() => {
                    setSelectedCoverageId(edge.id);
                  }}
                >
                  <strong>{concept?.name || edge.target}</strong>
                  <span>{edge.occurrenceRole || 'explained'} - {formatReferenceTime(edge.startSeconds)}-{formatReferenceTime(edge.endSeconds)}</span>
                  <span>{Math.round(edge.discussionDuration || 0)}s - {Math.round(edge.confidence || 0)}% confidence</span>
                  {evidence?.text && <small>{evidence.text}</small>}
                </button>
              );
            })}
            {!coveredEdges.length && <div className="k-source-empty">No covered concepts found.</div>}
          </div>
        </div>
      )}
      </div>
{sourceNode && (
      <>
        <div className="k-drawer-actions">
        <button className="k-dact primary wide" onClick={handleJumpToVideo} disabled={sourcesLoading}>
          <Play className="k-icon" style={{ width: 14, height: 14 }} />Jump to Video
        </button>
        <button className="k-dact primary wide" onClick={handleViewSources} disabled={sourcesLoading}>
          <Play className="k-icon" style={{ width: 14, height: 14 }} />
          {sourcesLoading ? 'Loading Sources...' : sourcesOpen ? 'Hide Sources' : 'View Sources'}
        </button>
        {sourcesOpen && (
          <div className="k-source-list">
            {references?.length ? references.map(reference => (
              <button
                key={reference.mention_id}
                className="k-source-item"
                onClick={() => openReference(reference)}
                title={reference.evidence_text || undefined}
              >
                <Play className="k-icon" style={{ width: 14, height: 14 }} />
                <span className="k-source-item-main">
                  <span className="k-source-item-title">{reference.resource_title || 'Untitled resource'}</span>
                  <span className="k-source-item-meta">{reference.source_type} - {reference.role}</span>
                </span>
                <span className="k-source-time">{formatReferenceTime(reference.jump_target?.start_seconds)}</span>
              </button>
            )) : <div className="k-source-empty">No active sources found.</div>}
          </div>
        )}
        <button className="k-dact" onClick={handleOpenTranscript} disabled={sourcesLoading}>
          <FileText className="k-icon" style={{ width: 14, height: 14 }} />Open Transcript
        </button>
        <button className="k-dact" onClick={handleCopySummary}>
          <Copy className="k-icon" style={{ width: 14, height: 14 }} />Copy Summary
        </button>
        <button className={'k-dact wide ' + (isFav ? 'primary' : '')} onClick={onFav}>
          <Star className="k-icon" style={{ width: 14, height: 14 }} />{isFav ? 'Favorited' : 'Favorite'}
        </button>
      </div>
      </>
      )}
    </>
  );
}

