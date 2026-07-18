def build_chapter_transcript(segments, start_time, end_time):
    """Extract transcript for a chapter with timestamps, ensuring no trailing segment is lost"""
    texts = []
    # Find the overall end time of the file
    max_segment_time = max([s["end"] for s in segments]) if segments else end_time
    
    # If this is the last chapter (ends near the end of the file), extend boundary to capture everything
    effective_end = end_time
    if end_time >= max_segment_time - 3.0:
        effective_end = max_segment_time + 10.0

    for segment in segments:
        if start_time <= segment["start"] < effective_end:
            ts = int(segment["start"])
            mm = ts // 60
            ss = ts % 60
            texts.append(f"[{mm:02d}:{ss:02d}] {segment['text']}")
    return " ".join(texts)


def validate_subchapter_bounds(subchapters, chapter_start, chapter_end):
    """
    ADDED: Validate that all subchapters stay completely inside parent chapter.
    This prevents AI from generating timestamps that violate parent/child rules.
    """
    validated = []
    for subchapter in subchapters:
        start = subchapter["start_time"]
        end = subchapter["end_time"]
        if start < chapter_start or end > chapter_end or start >= end:
            continue
        validated.append(subchapter)
    return validated


def build_subchapter_transcript(chapter_segments, start_time, end_time):
    """Extract transcript for a subchapter from chapter segments cleanly"""
    texts = []
    # Calculate max segment time in this group to prevent trailing cuts
    max_segment_time = max([s["end"] for s in chapter_segments]) if chapter_segments else end_time
    effective_end = end_time
    if end_time >= max_segment_time - 3.0:
        effective_end = max_segment_time + 10.0

    for segment in chapter_segments:
        # Use start-time boundary check to prevent duplicate allocation
        if start_time <= segment["start"] < effective_end:
            texts.append(segment["text"])
    return " ".join(texts)
