import { useEffect, useMemo, useRef } from 'react';
import type { TranscriptSegment } from '../utils/transcriptUtils';

export interface ActiveTranscriptCue {
  startTime: number;
  endTime: number;
  text: string;
}

export interface GroupedSubchapter {
  id: string;
  title: string;
  start_time: number;
  end_time: number;
  segments: TranscriptSegment[];
}

export interface GroupedChapter {
  id: string;
  title: string;
  start_time: number;
  end_time: number;
  segments: TranscriptSegment[];
  subchapters: GroupedSubchapter[];
}

export function useTranscriptSync(
  transcript: TranscriptSegment[],
  chapters: any[],
  subchapters: any[],
  currentTime: number,
  timeOffsetSeconds: number = 0,
  activeCue: ActiveTranscriptCue | null = null
) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isUserScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<number | null>(null);

  // Group transcript into chapters and subchapters
  const groupedData = useMemo(() => {
    if (!chapters || chapters.length === 0) {
      return { type: 'flat' as const, data: transcript };
    }

    const grouped: GroupedChapter[] = [];
    const sortedChapters = [...chapters].sort((a, b) => (a.start_time || 0) - (b.start_time || 0));

    // Sort segments
    const sortedSegments = [...transcript].sort((a, b) => a.startSeconds - b.startSeconds);

    for (let i = 0; i < sortedChapters.length; i++) {
      const chap = sortedChapters[i];
      const nextChap = sortedChapters[i + 1];
      const chapStart = chap.start_time || 0;

      // Some chapters have an end_time that equals start_time, or is missing.
      let chapEnd = chap.end_time;
      if (!chapEnd || chapEnd <= chapStart) {
        chapEnd = nextChap ? nextChap.start_time : Infinity;
      }

      const chapSubs = subchapters
        .filter(s => s.chapter_id === chap.id)
        .sort((a, b) => (a.start_time || 0) - (b.start_time || 0));

      const groupedChap: GroupedChapter = {
        id: chap.id,
        title: chap.title,
        start_time: chapStart,
        end_time: chapEnd,
        segments: [],
        subchapters: chapSubs.map(s => {
          let subEnd = s.end_time || s.start_time || 0;
          if (subEnd <= (s.start_time || 0)) {
            // Find next subchapter for end boundary
            const nextSub = chapSubs.find(ns => (ns.start_time || 0) > (s.start_time || 0));
            subEnd = nextSub ? (nextSub.start_time || 0) : (chapEnd - chapStart); // relative to chapStart
          }
          return {
            id: s.id,
            title: s.title,
            start_time: chapStart + (s.start_time || 0),
            end_time: chapStart + subEnd,
            segments: []
          };
        })
      };

      // Assign segments to this chapter
      const chapSegments = sortedSegments.filter(
        seg => seg.startSeconds >= chapStart && seg.startSeconds < chapEnd
      );

      // Distribute into subchapters
      for (const seg of chapSegments) {
        let placed = false;
        for (const sub of groupedChap.subchapters) {
          if (seg.startSeconds >= sub.start_time && seg.startSeconds < sub.end_time) {
            sub.segments.push(seg);
            placed = true;
            break;
          }
        }
        if (!placed) {
          groupedChap.segments.push(seg);
        }
      }
      grouped.push(groupedChap);
    }
    return { type: 'grouped' as const, data: grouped };
  }, [transcript, chapters, subchapters]);

  // Find active segment efficiently
  const activeSegment = useMemo(() => {
    if (!transcript || transcript.length === 0) return null;

    const hasTimestamps = transcript.some(seg => seg.startSeconds > 0 || (seg.endSeconds > 0 && seg.endSeconds !== Infinity));
    if (!hasTimestamps) return null;

    const sortedTranscript = [...transcript].sort((a, b) => a.startSeconds - b.startSeconds);
    const effectiveTime = Math.max(0, currentTime + timeOffsetSeconds + 0.12);
    const tolerance = 0.075;

    if (activeCue?.text?.trim()) {
      const cleanCueText = activeCue.text
        .replace(/^\[[^\]]+\]:\s*/, "")
        .replace(/^[^:]+:\s*/, "")
        .trim()
        .toLowerCase();

      const cueMatchedSegment = sortedTranscript.find(seg => {
        const segEnd = Number.isFinite(seg.endSeconds) ? seg.endSeconds : Infinity;
        const cueTimesOverlap =
          Math.abs(seg.startSeconds - activeCue.startTime) <= 0.15 &&
          Math.abs(segEnd - activeCue.endTime) <= 0.2;
        const cueStartsInsideSegment =
          activeCue.startTime + 0.02 >= seg.startSeconds &&
          activeCue.startTime < segEnd + 0.02;
        const cleanSegText = seg.text.trim().toLowerCase();
        return cueTimesOverlap || cueStartsInsideSegment || cleanSegText === cleanCueText;
      });

      if (cueMatchedSegment) {
        return cueMatchedSegment;
      }
    }

    let left = 0;
    let right = sortedTranscript.length - 1;
    let candidateIndex = -1;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      if (sortedTranscript[mid].startSeconds <= effectiveTime + tolerance) {
        candidateIndex = mid;
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }

    if (candidateIndex < 0) {
      return sortedTranscript[0] ?? null;
    }

    for (let idx = candidateIndex; idx >= Math.max(0, candidateIndex - 2); idx -= 1) {
      const seg = sortedTranscript[idx];
      const segEnd = Number.isFinite(seg.endSeconds) ? seg.endSeconds : Infinity;
      if (effectiveTime + tolerance >= seg.startSeconds && effectiveTime < segEnd + tolerance) {
        return seg;
      }
    }

    return sortedTranscript[candidateIndex] ?? null;
  }, [transcript, currentTime, timeOffsetSeconds, activeCue]);

  const activeTurnId = activeSegment ? activeSegment.id : null;
  const activeSubtitleText = activeSegment ? activeSegment.text : "";

  // Handle smooth auto-scroll
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      isUserScrollingRef.current = true;
      if (scrollTimeoutRef.current) {
        window.clearTimeout(scrollTimeoutRef.current);
      }
      scrollTimeoutRef.current = window.setTimeout(() => {
        isUserScrollingRef.current = false;
      }, 2000); // 2s after last scroll, resume auto-scroll
    };

    container.addEventListener('scroll', handleScroll);
    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (scrollTimeoutRef.current) window.clearTimeout(scrollTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (isUserScrollingRef.current || !activeTurnId) return;

    const el = document.getElementById(activeTurnId);
    if (el && scrollContainerRef.current) {
      const containerBounds = scrollContainerRef.current.getBoundingClientRect();
      const elBounds = el.getBoundingClientRect();

      const isOutOfView =
        elBounds.top < containerBounds.top + 60 ||
        elBounds.bottom > containerBounds.bottom - 60;

      if (isOutOfView) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [activeTurnId]);

  return {
    groupedData,
    activeTurnId,
    activeSubtitleText,
    scrollContainerRef
  };
}
