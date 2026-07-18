import React from "react";

export interface TranscriptSegment {
  id: string;
  speaker: string;
  time: string; // Original string like 00:00:00,000
  text: string;
  startSeconds: number;
  endSeconds: number;
}

export const parseTimeToSeconds = (timeStr: string): number => {
  if (!timeStr) return 0;
  // Handle SRT format: HH:MM:SS,mmm
  const parts = timeStr.replace(',', '.').split(':');
  if (parts.length === 3) {
    const hours = parseFloat(parts[0]) || 0;
    const minutes = parseFloat(parts[1]) || 0;
    const seconds = parseFloat(parts[2]) || 0;
    return hours * 3600 + minutes * 60 + seconds;
  } else if (parts.length === 2) {
    const minutes = parseFloat(parts[0]) || 0;
    const seconds = parseFloat(parts[1]) || 0;
    return minutes * 60 + seconds;
  }
  return parseFloat(timeStr) || 0;
};

export const formatSeconds = (totalSeconds: number): string => {
  if (totalSeconds === undefined || totalSeconds === null) return "00:00";
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
};

export const parseSrt = (srtText: string): TranscriptSegment[] => {
  const normalized = srtText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.split(/\n\s*\n/);
  const items: TranscriptSegment[] = [];
  let index = 0;
  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) continue;

    const timeLineIndex = /^\d+$/.test(lines[0]) ? 1 : 0;
    const timeLine = lines[timeLineIndex];
    if (!timeLine || !timeLine.includes('-->')) continue;

    const [startPart, endPart] = timeLine.split('-->');
    const startTime = startPart?.trim();
    const endTime = endPart?.trim();
    const textLines = lines.slice(timeLineIndex + 1);
    if (!startTime || !endTime || textLines.length === 0) continue;

    let speaker = 'Speaker';
    const mergedText = textLines.join(' ');
    let text = mergedText;
    const speakerMatch = mergedText.match(/^\[([^\]]+)\]\s*(.*)/) || mergedText.match(/^([^:]+):\s*(.*)/);
    if (speakerMatch) {
      speaker = speakerMatch[1].trim();
      text = speakerMatch[2].trim();
    }

    items.push({
      id: `tr-${index++}`,
      speaker,
      time: startTime.replace(/,\d{3}$/, ''),
      text,
      startSeconds: parseTimeToSeconds(startTime),
      endSeconds: parseTimeToSeconds(endTime),
    });
  }

  return items;
};

export const parseTranscript = (text: string): TranscriptSegment[] => {
  if (!text) return [];
  
  if (text.includes("-->")) {
    return parseSrt(text);
  }
  
  const lines = text.split('\n');
  const items: TranscriptSegment[] = [];
  let index = 0;
  
  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    
    const timeMatch = line.match(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]/);
    let timeVal = "00:00";
    let cleanLine = line;
    if (timeMatch) {
      timeVal = timeMatch[1];
      cleanLine = line.replace(/\[\d{1,2}:\d{2}(?::\d{2})?\]/, "").trim();
    }
    
    let startSecs = parseTimeToSeconds(timeVal);

    const match = cleanLine.match(/^\[?([^\]:]+)\]?:\s*(.*)/);
    if (match) {
      items.push({
        id: `tr-${index++}`,
        speaker: match[1].trim(),
        time: timeVal,
        text: match[2].trim(),
        startSeconds: startSecs,
        endSeconds: Infinity
      });
    } else {
      if (items.length > 0) {
        items[items.length - 1].text += " " + cleanLine;
      } else {
        items.push({
          id: `tr-${index++}`,
          speaker: "System",
          time: timeVal,
          text: cleanLine,
          startSeconds: startSecs,
          endSeconds: Infinity
        });
      }
    }
  }
  
  return items;
};

// ── Alert Marker Renderer ────────────────────────────────────────────────────
// Renders [!TIP], [!CAUTION], [!WARNING], [!NOTE], [!IMPORTANT] as styled blocks

interface AlertConfig {
  emoji: string;
  label: string;
  borderColor: string;
  bgColor: string;
  headerColor: string;
  textColor: string;
}

export const alertConfigs: Record<string, AlertConfig> = {
  WARNING:   { emoji: '⚠️', label: 'Warning',   borderColor: '#f59e0b', bgColor: '#fffbeb', headerColor: '#92400e', textColor: '#78350f' },
  CAUTION:   { emoji: '🚫', label: 'Caution',   borderColor: '#ef4444', bgColor: '#fef2f2', headerColor: '#991b1b', textColor: '#7f1d1d' },
  TIP:       { emoji: '💡', label: 'Tip',       borderColor: '#3b82f6', bgColor: '#eff6ff', headerColor: '#1e40af', textColor: '#1e3a8a' },
  NOTE:      { emoji: '📌', label: 'Note',      borderColor: '#6366f1', bgColor: '#eef2ff', headerColor: '#3730a3', textColor: '#312e81' },
  IMPORTANT: { emoji: '🎯', label: 'Important', borderColor: '#8b5cf6', bgColor: '#f5f3ff', headerColor: '#6d28d9', textColor: '#4c1d95' },
};

// Match [!TYPE] anywhere — at start of string, after newline, or inline
const ALERT_MARKER = /\[!(WARNING|CAUTION|TIP|NOTE|IMPORTANT)\]/gi;

// Check if text is ONLY an alert marker (with optional whitespace)
export function isAlertMarkerOnly(text: string): boolean {
  return /^\s*\[!(WARNING|CAUTION|TIP|NOTE|IMPORTANT)\]\s*$/i.test(text);
}

// Extract alert type from marker-only text
export function extractAlertType(text: string): string | null {
  const m = text.match(/^\s*\[!(WARNING|CAUTION|TIP|NOTE|IMPORTANT)\]\s*$/i);
  return m ? m[1].toUpperCase() : null;
}

export function hasAlertMarkers(text: string): boolean {
  ALERT_MARKER.lastIndex = 0;
  return ALERT_MARKER.test(text);
}

export function renderTextWithAlerts(text: string): React.ReactNode[] {
  if (!text) return [text];

  ALERT_MARKER.lastIndex = 0;
  if (!ALERT_MARKER.test(text)) {
    return [text];
  }

  // Reset regex lastIndex after test
  ALERT_MARKER.lastIndex = 0;

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = ALERT_MARKER.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const type = match[1].toUpperCase();
    const cfg = alertConfigs[type];
    if (cfg) {
      // Find the content after the marker (until next marker or end of text)
      const contentStart = match.index + match[0].length;
      let contentEnd = text.length;
      
      // Look for next alert marker
      ALERT_MARKER.lastIndex = contentStart;
      const nextMatch = ALERT_MARKER.exec(text);
      if (nextMatch) {
        contentEnd = nextMatch.index;
      }
      ALERT_MARKER.lastIndex = contentStart;
      
      const content = text.slice(contentStart, contentEnd).trim();
      
      parts.push(
        React.createElement('div', {
          key: `alert-${match.index}`,
          style: {
            borderLeft: `4px solid ${cfg.borderColor}`,
            background: cfg.bgColor,
            borderRadius: '10px',
            padding: '12px 16px',
            margin: '10px 0',
          }
        },
          React.createElement('div', {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontWeight: 700,
              fontSize: '13px',
              color: cfg.headerColor,
              marginBottom: content ? '6px' : '0',
            }
          },
            React.createElement('span', null, cfg.emoji),
            React.createElement('span', null, cfg.label)
          ),
          content ? React.createElement('div', {
            style: {
              fontSize: '14px',
              lineHeight: 1.7,
              color: cfg.textColor,
            }
          }, content) : null
        )
      );
      
      lastIndex = contentEnd;
    } else {
      lastIndex = match.index + match[0].length;
    }
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

// ── Merge alert markers with next segment ────────────────────────────────────
// When a segment starts with [!TYPE] (or is just the marker), merge with next segment's content
export function mergeAlertSegments(segments: any[]): any[] {
  if (!segments || segments.length === 0) return segments;

  const ALERT_START = /^\s*\[!(WARNING|CAUTION|TIP|NOTE|IMPORTANT)\]\s*/i;
  const merged: any[] = [];
  let i = 0;

  while (i < segments.length) {
    const seg = segments[i];
    const text = (seg.text || "").trim();
    const markerMatch = text.match(ALERT_START);

    if (markerMatch && i + 1 < segments.length) {
      // This segment starts with an alert marker
      const markerOnly = text.replace(ALERT_START, "").trim();
      
      if (!markerOnly) {
        // Segment is JUST the marker — merge entirely with next segment
        const nextSeg = segments[i + 1];
        merged.push({
          ...nextSeg,
          text: `${markerMatch[0].trim()} ${nextSeg.text || ""}`.trim(),
          time: seg.time || nextSeg.time,
          startSeconds: seg.startSeconds || nextSeg.startSeconds,
        });
        i += 2;
      } else {
        // Segment has marker + content — keep as-is, renderTextWithAlerts handles it
        merged.push(seg);
        i += 1;
      }
    } else {
      merged.push(seg);
      i += 1;
    }
  }

  return merged;
}
