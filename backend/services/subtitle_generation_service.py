import re
import math
from typing import List, Optional
from pydantic import BaseModel

# Configuration for subtitle generation
MAX_CHARS_PER_LINE = 42
MAX_LINES_PER_BLOCK = 2
MIN_SUBTITLE_DURATION = 1.0
MAX_SUBTITLE_DURATION = 7.0
PREFERRED_WORDS_PER_SEGMENT = 12
MAX_WORDS_PER_SEGMENT = 20

# Enable/Disable flags for future expansion
ENABLE_WORD_LEVEL_TIMING = True
ENABLE_SPEAKER_AWARE_SUBTITLES = True

# Punctuation priority for splitting (Regex patterns)
PUNCTUATION_SENTENCE = re.compile(r'([.?!]+)')
PUNCTUATION_CLAUSE = re.compile(r'([,;:]+)')

class SubtitleSegment(BaseModel):
    index: int
    start_time: float
    end_time: float
    text: str
    speaker: Optional[str] = None
    chapter_id: Optional[str] = None
    source_segment_id: Optional[str] = None


def format_time_srt(seconds: float) -> str:
    """Format seconds into SRT timestamp HH:MM:SS,mmm"""
    seconds = max(0.0, seconds)
    total_millis = int(round(seconds * 1000))
    hours = total_millis // 3_600_000
    remainder = total_millis % 3_600_000
    minutes = remainder // 60_000
    remainder %= 60_000
    secs = remainder // 1_000
    millis = remainder % 1_000
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def normalize_text(text: str) -> str:
    """Clean up and normalize text for subtitle generation."""
    # Remove multiple spaces, newlines, tabs
    text = re.sub(r'\s+', ' ', text)
    # Fix spacing around punctuation (e.g. "word , word" -> "word, word")
    text = re.sub(r'\s+([.?!,;:])', r'\1', text)
    return text.strip()


def split_text_by_punctuation(text: str) -> List[str]:
    """
    Intelligently segment text based on punctuation and word counts.
    Returns a list of cleanly segmented strings.
    """
    segments = []
    
    # First split by sentence-ending punctuation
    # We use a pattern that captures the punctuation to keep it with the preceding word.
    sentence_parts = PUNCTUATION_SENTENCE.split(text)
    
    # Recombine captured punctuation with the text
    sentences = []
    current_sentence = ""
    for i in range(0, len(sentence_parts) - 1, 2):
        sentences.append((sentence_parts[i] + sentence_parts[i+1]).strip())
    if len(sentence_parts) % 2 != 0 and sentence_parts[-1].strip():
        sentences.append(sentence_parts[-1].strip())
        
    for sentence in sentences:
        words = sentence.split()
        if len(words) <= MAX_WORDS_PER_SEGMENT:
            segments.append(sentence)
        else:
            # Sentence is too long, try splitting by clause punctuation
            clause_parts = PUNCTUATION_CLAUSE.split(sentence)
            clauses = []
            for i in range(0, len(clause_parts) - 1, 2):
                clauses.append((clause_parts[i] + clause_parts[i+1]).strip())
            if len(clause_parts) % 2 != 0 and clause_parts[-1].strip():
                clauses.append(clause_parts[-1].strip())
            
            current_chunk = []
            current_words = 0
            
            for clause in clauses:
                clause_words = clause.split()
                if current_words + len(clause_words) <= MAX_WORDS_PER_SEGMENT:
                    current_chunk.append(clause)
                    current_words += len(clause_words)
                else:
                    if current_chunk:
                        segments.append(" ".join(current_chunk))
                    
                    # If a single clause is still too long, split by word count
                    if len(clause_words) > MAX_WORDS_PER_SEGMENT:
                        for i in range(0, len(clause_words), PREFERRED_WORDS_PER_SEGMENT):
                            segments.append(" ".join(clause_words[i:i + PREFERRED_WORDS_PER_SEGMENT]))
                        current_chunk = []
                        current_words = 0
                    else:
                        current_chunk = [clause]
                        current_words = len(clause_words)
                        
            if current_chunk:
                segments.append(" ".join(current_chunk))
                
    # Filter out any empty segments
    return [s for s in segments if s.strip()]


def generate_subtitles_from_text(text: str, duration_seconds: float) -> List[SubtitleSegment]:
    """
    Generate SubtitleSegments from a raw transcript string, allocating time proportionally.
    Used as fallback when no timestamps are available.
    """
    text = normalize_text(text)
    if not text:
        return [SubtitleSegment(index=1, start_time=0.0, end_time=max(duration_seconds, 5.0), text="[No Speech]")]

    segments_text = split_text_by_punctuation(text)
    if not segments_text:
        return []
        
    total_chars = sum(len(s) for s in segments_text)
    total_chars = max(1, total_chars) # Prevent division by zero
    
    subtitle_segments = []
    current_time = 0.0
    
    for i, seg_text in enumerate(segments_text):
        # Calculate duration proportionally based on character count
        proportion = len(seg_text) / total_chars
        seg_duration = duration_seconds * proportion
        
        # Ensure at least 100ms duration per segment to avoid zero-duration overlaps
        seg_duration = max(0.1, seg_duration)
        
        end_time = current_time + seg_duration
        if i == len(segments_text) - 1:
            end_time = max(current_time + 0.1, duration_seconds)
            
        subtitle_segments.append(
            SubtitleSegment(
                index=i + 1,
                start_time=current_time,
                end_time=end_time,
                text=seg_text
            )
        )


def normalize_text(text: str) -> str:
    """Clean up and normalize text for subtitle generation."""
    # Remove multiple spaces, newlines, tabs
    text = re.sub(r'\s+', ' ', text)
    # Fix spacing around punctuation (e.g. "word , word" -> "word, word")
    text = re.sub(r'\s+([.?!,;:])', r'\1', text)
    return text.strip()


def split_text_by_punctuation(text: str) -> List[str]:
    """
    Intelligently segment text based on punctuation and word counts.
    Returns a list of cleanly segmented strings.
    """
    segments = []
    
    # First split by sentence-ending punctuation
    # We use a pattern that captures the punctuation to keep it with the preceding word.
    sentence_parts = PUNCTUATION_SENTENCE.split(text)
    
    # Recombine captured punctuation with the text
    sentences = []
    current_sentence = ""
    for i in range(0, len(sentence_parts) - 1, 2):
        sentences.append((sentence_parts[i] + sentence_parts[i+1]).strip())
    if len(sentence_parts) % 2 != 0 and sentence_parts[-1].strip():
        sentences.append(sentence_parts[-1].strip())
        
    for sentence in sentences:
        words = sentence.split()
        if len(words) <= MAX_WORDS_PER_SEGMENT:
            segments.append(sentence)
        else:
            # Sentence is too long, try splitting by clause punctuation
            clause_parts = PUNCTUATION_CLAUSE.split(sentence)
            clauses = []
            for i in range(0, len(clause_parts) - 1, 2):
                clauses.append((clause_parts[i] + clause_parts[i+1]).strip())
            if len(clause_parts) % 2 != 0 and clause_parts[-1].strip():
                clauses.append(clause_parts[-1].strip())
            
            current_chunk = []
            current_words = 0
            
            for clause in clauses:
                clause_words = clause.split()
                if current_words + len(clause_words) <= MAX_WORDS_PER_SEGMENT:
                    current_chunk.append(clause)
                    current_words += len(clause_words)
                else:
                    if current_chunk:
                        segments.append(" ".join(current_chunk))
                    
                    # If a single clause is still too long, split by word count
                    if len(clause_words) > MAX_WORDS_PER_SEGMENT:
                        for i in range(0, len(clause_words), PREFERRED_WORDS_PER_SEGMENT):
                            segments.append(" ".join(clause_words[i:i + PREFERRED_WORDS_PER_SEGMENT]))
                        current_chunk = []
                        current_words = 0
                    else:
                        current_chunk = [clause]
                        current_words = len(clause_words)
                        
            if current_chunk:
                segments.append(" ".join(current_chunk))
                
    # Filter out any empty segments
    return [s for s in segments if s.strip()]


def generate_subtitles_from_text(text: str, duration_seconds: float) -> List[SubtitleSegment]:
    """
    Generate SubtitleSegments from a raw transcript string, allocating time proportionally.
    Used as fallback when no timestamps are available.
    """
    text = normalize_text(text)
    if not text:
        return [SubtitleSegment(index=1, start_time=0.0, end_time=max(duration_seconds, 5.0), text="[No Speech]")]

    segments_text = split_text_by_punctuation(text)
    if not segments_text:
        return []
        
    total_chars = sum(len(s) for s in segments_text)
    total_chars = max(1, total_chars) # Prevent division by zero
    
    subtitle_segments = []
    current_time = 0.0
    
    for i, seg_text in enumerate(segments_text):
        # Calculate duration proportionally based on character count
        proportion = len(seg_text) / total_chars
        seg_duration = duration_seconds * proportion
        
        # Ensure at least 100ms duration per segment to avoid zero-duration overlaps
        seg_duration = max(0.1, seg_duration)
        
        end_time = current_time + seg_duration
        if i == len(segments_text) - 1:
            end_time = max(current_time + 0.1, duration_seconds)
            
        subtitle_segments.append(
            SubtitleSegment(
                index=i + 1,
                start_time=current_time,
                end_time=end_time,
                text=seg_text
            )
        )
        current_time = end_time
        
    return subtitle_segments


def generate_subtitles_from_segments(original_segments: List[dict]) -> List[SubtitleSegment]:
    """
    Generate SubtitleSegments from existing provider segments (e.g., YouTubeTranscriptApi).
    Preserves exact original timings to prevent latency and drift.
    Expected dict keys: 'text', 'start', 'duration'
    """
    # Sort segments by start time to handle out-of-order and overlapping elements correctly
    sorted_segments = sorted(original_segments, key=lambda x: float(x.get('start', 0.0)))
    
    subtitle_segments = []
    global_idx = 1
    
    for seg in sorted_segments:
        raw_text = seg.get('text', '')
        raw_start = float(seg.get('start', 0.0))
        raw_duration = float(seg.get('duration', 0.0))
        raw_end = raw_start + raw_duration
        
        normalized_text = normalize_text(raw_text)
        if not normalized_text:
            continue
            
        # Handle overlaps by truncating the previous segment's end time instead of pushing the start time forward
        if subtitle_segments and raw_start < subtitle_segments[-1].end_time:
            subtitle_segments[-1].end_time = max(subtitle_segments[-1].start_time + 0.01, raw_start)
            
        start = raw_start
        end = max(start + 0.01, raw_end)
            
        subtitle_segments.append(
            SubtitleSegment(
                index=global_idx,
                start_time=start,
                end_time=end,
                text=normalized_text
            )
        )
        global_idx += 1
            
    return subtitle_segments


def generate_subtitles_from_word_timestamps(words: List[dict]) -> List[SubtitleSegment]:
    """Build subtitle segments from word-level timestamps with low drift."""
    normalized_words = []
    for word in words or []:
        raw_text = normalize_text(str(word.get("word") or word.get("text") or ""))
        if not raw_text:
            continue
        start = float(word.get("start", 0.0) or 0.0)
        end = float(word.get("end", start) or start)
        end = max(end, start + 0.02)
        normalized_words.append({"text": raw_text, "start": start, "end": end})

    if not normalized_words:
        return []

    subtitle_segments: List[SubtitleSegment] = []
    current_words: List[dict] = []
    global_idx = 1
    max_gap_for_same_segment = 0.55

    def flush_segment():
        nonlocal current_words, global_idx
        if not current_words:
            return
        text = normalize_text(" ".join(word["text"] for word in current_words))
        if not text:
            current_words = []
            return
        subtitle_segments.append(
            SubtitleSegment(
                index=global_idx,
                start_time=current_words[0]["start"],
                end_time=max(current_words[-1]["end"], current_words[0]["start"] + 0.05),
                text=text,
            )
        )
        global_idx += 1
        current_words = []

    for word in normalized_words:
        if not current_words:
            current_words.append(word)
            continue

        current_text = normalize_text(" ".join(item["text"] for item in current_words + [word]))
        word_count = len(current_words) + 1
        gap = max(0.0, word["start"] - current_words[-1]["end"])
        should_split = (
            gap >= max_gap_for_same_segment
            or word_count > MAX_WORDS_PER_SEGMENT
            or len(current_text) > (MAX_CHARS_PER_LINE * MAX_LINES_PER_BLOCK)
            or (
                current_words
                and re.search(r"[.?!]$", current_words[-1]["text"])
                and word_count >= 6
            )
        )
        if should_split:
            flush_segment()
        current_words.append(word)

    flush_segment()
    return subtitle_segments


def generate_subtitles_from_text_with_intervals(
    text: str,
    duration_seconds: float,
    speech_intervals: List[tuple[float, float]],
) -> List[SubtitleSegment]:
    """Fallback subtitle generation aligned to detected speech intervals."""
    text = normalize_text(text)
    if not text:
        return [SubtitleSegment(index=1, start_time=0.0, end_time=max(duration_seconds, 5.0), text="[No Speech]")]

    segments_text = split_text_by_punctuation(text)
    if not segments_text:
        return []

    normalized_intervals = []
    for start, end in speech_intervals or []:
        start = max(0.0, float(start))
        end = max(start + 0.05, float(end))
        normalized_intervals.append((start, end))

    if not normalized_intervals:
        normalized_intervals = [(0.0, max(duration_seconds, 0.1))]

    total_chars = max(1, sum(len(seg) for seg in segments_text))
    total_speech_duration = max(0.1, sum((end - start) for start, end in normalized_intervals))
    subtitle_segments: List[SubtitleSegment] = []
    segment_idx = 1
    cursor = normalized_intervals[0][0]
    interval_index = 0

    def advance_cursor():
        nonlocal cursor, interval_index
        while interval_index < len(normalized_intervals):
            current_start, current_end = normalized_intervals[interval_index]
            if cursor < current_end:
                cursor = max(cursor, current_start)
                return
            interval_index += 1
            if interval_index < len(normalized_intervals):
                cursor = normalized_intervals[interval_index][0]

    advance_cursor()

    for idx, seg_text in enumerate(segments_text):
        proportion = len(seg_text) / total_chars
        target_duration = max(0.35, total_speech_duration * proportion)
        start_time = cursor
        end_time = start_time
        remaining = target_duration

        while remaining > 0 and interval_index < len(normalized_intervals):
            interval_start, interval_end = normalized_intervals[interval_index]
            if cursor < interval_start:
                cursor = interval_start
            available = interval_end - cursor
            if available <= 0.01:
                interval_index += 1
                if interval_index < len(normalized_intervals):
                    cursor = normalized_intervals[interval_index][0]
                continue
            consume = min(remaining, available)
            end_time = cursor + consume
            cursor = end_time
            remaining -= consume
            if remaining > 0.01:
                interval_index += 1
                if interval_index < len(normalized_intervals):
                    cursor = normalized_intervals[interval_index][0]

        if idx == len(segments_text) - 1:
            end_time = max(end_time, normalized_intervals[-1][1])

        if end_time <= start_time:
            end_time = start_time + min(MAX_SUBTITLE_DURATION, max(MIN_SUBTITLE_DURATION, target_duration))

        subtitle_segments.append(
            SubtitleSegment(
                index=segment_idx,
                start_time=start_time,
                end_time=end_time,
                text=seg_text,
            )
        )
        segment_idx += 1
        advance_cursor()

    return subtitle_segments


def build_srt_content(segments: List[SubtitleSegment]) -> str:
    """Format a list of SubtitleSegments into an SRT formatted string."""
    srt_lines = []
    for seg in segments:
        srt_lines.append(str(seg.index))
        srt_lines.append(f"{format_time_srt(seg.start_time)} --> {format_time_srt(seg.end_time)}")
        
        # Format text to respect MAX_CHARS_PER_LINE if needed, 
        # though smart splitting should largely prevent ultra-long lines.
        # But as an extra step, we could insert newlines if a segment is slightly long.
        text = seg.text
        if len(text) > MAX_CHARS_PER_LINE:
            # Find a space to split the line
            split_idx = text.rfind(' ', 0, MAX_CHARS_PER_LINE)
            if split_idx > 0:
                text = text[:split_idx] + "\n" + text[split_idx+1:]
                
        # Optional: Add speaker label support for future proofing
        if ENABLE_SPEAKER_AWARE_SUBTITLES and seg.speaker:
            text = f"[{seg.speaker}] {text}"
            
        srt_lines.append(text)
        srt_lines.append("") # Empty line separator
        
    return "\n".join(srt_lines)
