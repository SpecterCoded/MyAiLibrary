import React, { useState, useEffect } from "react";
import Markdown from "react-markdown";
import type { GraphNode, GraphLink } from "../types";
import { CATEGORY_MAP } from "../types";
import { Edit2, Save, X, Calendar, BookOpen, ArrowRight, CornerDownRight, Tag } from "lucide-react";

interface NoteReaderProps {
  node: GraphNode | null;
  links: GraphLink[];
  onClose: () => void;
  onUpdateContent: (nodeId: string, updatedTitle: string, updatedContent: string, updatedTags: string[]) => void;
  allNodes: GraphNode[];
  onSelectNode: (nodeId: string) => void;
}

export default function NoteReader({
  node,
  links,
  onClose,
  onUpdateContent,
  allNodes,
  onSelectNode,
}: NoteReaderProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editTags, setEditTags] = useState("");

  // Populate state when node changes
  useEffect(() => {
    if (node) {
      setEditTitle(node.title);
      setEditContent(node.content);
      setEditTags(node.tags ? node.tags.join(", ") : "");
      setIsEditing(false);
    }
  }, [node]);

  if (!node) {
    return (
      <div
        id="reader-panel-empty"
        className="hidden md:flex flex-col items-center justify-center text-center p-8 bg-white border border-slate-200/60 rounded-2xl h-full min-h-[300px] shadow-sm flex-1 max-w-[340px]"
      >
        <div className="w-12 h-12 bg-slate-50 border border-slate-100 rounded-2xl flex items-center justify-center text-slate-300 mb-4 animate-bounce">
          <BookOpen className="w-5 h-5" />
        </div>
        <h4 className="font-sans font-bold text-slate-700 text-sm mb-1">
          No Sprout Node Selected
        </h4>
        <p className="text-xs text-slate-400 max-w-[200px] leading-relaxed">
          Hover and click on any node in the physics graph to read its content sprouts
        </p>
      </div>
    );
  }

  const categoryInfo = CATEGORY_MAP[node.type];

  // Helper to discover Backlinks (incoming links looking, where this node ID is target)
  const backlinks = links
    .filter((link) => {
      if (!link) return false;
      const target = link.target;
      const targetId = (target && typeof target === "object") ? (target as any).id : target;
      return targetId === node.id;
    })
    .map((link) => {
      const source = link.source;
      const sourceId = (source && typeof source === "object") ? (source as any).id : source;
      return allNodes.find((n) => n.id === sourceId);
    })
    .filter((n): n is GraphNode => !!n);

  // Helper to discover Outgoing links (where this node ID is source)
  const outgoingLinks = links
    .filter((link) => {
      if (!link) return false;
      const source = link.source;
      const sourceId = (source && typeof source === "object") ? (source as any).id : source;
      return sourceId === node.id;
    })
    .map((link) => {
      const target = link.target;
      const targetId = (target && typeof target === "object") ? (target as any).id : target;
      return allNodes.find((n) => n.id === targetId);
    })
    .filter((n): n is GraphNode => !!n);

  const handleSave = () => {
    const cleanTags = editTags
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0);

    onUpdateContent(node.id, editTitle, editContent, cleanTags);
    setIsEditing(false);
  };

  return (
    <div
      id="note-reader-container"
      className="flex flex-col h-full bg-white w-full overflow-hidden transition-all relative z-10"
    >
      {/* Header bar controls */}
      <div className="p-2 border-b border-[#e9e9e7] bg-white flex items-center justify-between">
        <div className="flex items-center gap-2 px-2">
          {/* Category Badge display */}
          <span
            className="text-[12px] px-2 py-0.5 rounded text-[#37352f]"
            style={{ backgroundColor: categoryInfo.color }}
          >
            {categoryInfo.label}
          </span>
        </div>

        <div className="flex items-center gap-1 pr-2">
          {isEditing ? (
            <button
              onClick={handleSave}
              className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
              title="Save Note"
              id="reader-action-save"
            >
              <Save className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={() => setIsEditing(true)}
              className="p-1.5 text-[#787774] hover:bg-gray-100 hover:text-[#37352f] rounded transition-colors"
              title="Edit Note"
              id="reader-action-edit"
            >
              <Edit2 className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 text-[#787774] hover:bg-gray-100 hover:text-[#37352f] rounded transition-colors"
            title="Close Drawer"
            id="reader-action-close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Prose scrolling viewport */}
      <div className="flex-1 overflow-y-auto px-10 py-12 space-y-5">
        {isEditing ? (
          /* EDITING MODE INPUT STATE */
          <div className="space-y-4 font-sans" id="reader-edit-form">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">
                Sprout Title
              </label>
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="w-full text-xs font-bold py-2 px-3 rounded-lg border border-slate-200"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase text-xs">
                Tags Comma separation
              </label>
              <input
                type="text"
                value={editTags}
                onChange={(e) => setEditTags(e.target.value)}
                className="w-full text-xs py-2 px-3 rounded-lg border border-slate-200"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase text-xs flex items-center justify-between">
                <span>Markdown Body</span>
                <span className="text-[9px] text-blue-500 lowercase">Use headers, markdown, bullet list</span>
              </label>
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                rows={11}
                className="w-full text-xs py-2 px-3 rounded-lg border border-slate-200 font-mono focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <button
              onClick={handleSave}
              className="w-full flex items-center justify-center gap-1.5 py-2 bg-blue-600 text-white font-semibold text-xs rounded-xl"
            >
              <Save className="w-3.5 h-3.5" />
              Save Note Changes
            </button>
          </div>
        ) : (
          /* READ MODE STAT */
          <div className="max-w-[700px] mx-auto space-y-5" id="reader-view-panel">
            {/* Note Title */}
            <h1 className="font-sans font-bold text-[#37352f] text-[40px] leading-[1.2] tracking-tight mb-2">
              {node.title}
            </h1>

            {/* Tags Pill container */}
            {node.tags && node.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 items-center">
                <Tag className="w-4 h-4 text-[#787774] opacity-50" />
                {node.tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-[14px] px-2 py-0.5 rounded bg-[#f1f1ef] text-[#37352f] font-sans flex items-center cursor-pointer hover:bg-[#e1e1df] transition-colors"
                  >
                    <span>{tag}</span>
                  </span>
                ))}
              </div>
            )}

            <div className="text-[14px] text-[#787774] flex items-center gap-2 mb-8">
              <span>Updated {node.updatedAt || 'Recently'}</span>
            </div>

            {/* Markdown Body Text Render with styled custom tag component elements */}
            <div className="markdown-body text-[#37352f]">
              <Markdown
                components={{
                  h1: (props) => (
                    <h1
                      className="text-[28px] font-bold font-sans text-[#37352f] mt-8 mb-4 leading-tight"
                      {...props}
                    />
                  ),
                  h2: (props) => (
                    <h2
                      className="text-[24px] font-bold font-sans text-[#37352f] mt-8 mb-4 leading-tight"
                      {...props}
                    />
                  ),
                  h3: (props) => (
                    <h3
                      className="text-[20px] font-semibold font-sans text-[#37352f] mt-6 mb-3 leading-tight"
                      {...props}
                    />
                  ),
                  p: (props) => (
                    <p
                      className="text-[16px] text-[#37352f] leading-[1.6] font-sans mb-4 min-h-[24px]"
                      {...props}
                    />
                  ),
                  li: (props) => (
                    <li
                      className="text-[16px] text-[#37352f] leading-[1.6] list-disc list-outside ml-6 font-sans mb-1"
                      {...props}
                    />
                  ),
                  ol: (props) => <ol className="list-decimal pl-6 mb-4" {...props} />,
                  ul: (props) => <ul className="list-disc pl-6 mb-4" {...props} />,
                  blockquote: (props) => (
                    <blockquote
                      className="border-l-[3px] border-[#37352f] pl-4 text-[#37352f] text-[16px] my-4 py-0.5"
                      {...props}
                    />
                  ),
                  code: (props) => (
                    <code
                      className="bg-slate-50 text-slate-700 px-1 py-0.5 rounded font-mono text-[10px] border border-slate-100"
                      {...props}
                    />
                  ),
                  pre: (props) => (
                    <pre
                      className="bg-slate-50 text-slate-700 p-3 rounded-lg font-mono text-[10px] overflow-x-auto border border-slate-200/50 my-3 leading-relaxed"
                      {...props}
                    />
                  ),
                  a: (props) => (
                    <a
                      className="text-blue-600 hover:underline hover:text-blue-700 font-semibold"
                      target="_blank"
                      rel="noopener noreferrer"
                      {...props}
                    />
                  ),
                  table: (props) => (
                    <div className="overflow-x-auto my-3">
                      <table className="w-full text-[11px] text-left border-collapse border border-slate-200" {...props} />
                    </div>
                  ),
                  th: (props) => <th className="bg-slate-50 p-2 font-bold text-slate-700 border border-slate-200" {...props} />,
                  td: (props) => <td className="p-2 border border-slate-200 text-slate-500" {...props} />,
                }}
              >
                {node.content}
              </Markdown>
            </div>
          </div>
        )}
      </div>

      {/* Connected Nodes Backlinks bottom panel footer (Obsidian style) */}
      {!isEditing && (
        <div id="reader-backlinks-panel" className="p-4 bg-slate-50/70 border-t border-slate-100 space-y-3.5">
          {/* Bidirectional outgoing links connections */}
          {outgoingLinks.length > 0 && (
            <div className="space-y-1">
              <div className="font-mono text-[8px] text-slate-400 font-bold uppercase tracking-wide flex items-center gap-1">
                <ArrowRight className="w-3 h-3 text-slate-400" />
                <span>Outgoing Connections ({outgoingLinks.length})</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {outgoingLinks.map((outNode) => {
                  const outInfo = CATEGORY_MAP[outNode.type];
                  return (
                    <button
                      key={outNode.id}
                      onClick={() => onSelectNode(outNode.id)}
                      className="text-[10px] py-1 px-2.5 bg-white border border-slate-200 hover:border-blue-300 rounded font-medium text-slate-600 flex items-center gap-1.5 transition-colors shadow-sm"
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: outInfo.color }} />
                      <span>{outNode.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Incoming Backlinks connections */}
          <div className="space-y-1">
            <div className="font-mono text-[8px] text-slate-400 font-bold uppercase tracking-wide flex items-center gap-1">
              <CornerDownRight className="w-3 h-3 text-slate-400" />
              <span>Incoming Backlinks ({backlinks.length})</span>
            </div>

            {backlinks.length === 0 ? (
              <span className="text-[10px] text-slate-400 font-serif italic block">
                No incoming connection backlinks found
              </span>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {backlinks.map((backNode) => {
                  const backInfo = CATEGORY_MAP[backNode.type];
                  return (
                    <button
                      key={backNode.id}
                      onClick={() => onSelectNode(backNode.id)}
                      className="text-[10px] py-1 px-2.5 bg-white border border-slate-200 hover:border-blue-300 rounded font-medium text-slate-600 flex items-center gap-1.5 transition-all shadow-sm"
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: backInfo.color }} />
                      <span>{backNode.title}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
