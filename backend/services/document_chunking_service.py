"""Document-aware chunking for PDF, DOCX, and OCR-style resources."""

from __future__ import annotations

import os
import re

from core.logger import get_logger

from core.config import ENABLE_DOCUMENT_SEMANTIC_CHUNKING
from .chunking_models import ChunkPayload
from .token_budget_service import DEFAULT_CHUNK_TOKEN_BUDGET, estimate_tokens

logger = get_logger("DOCUMENT_CHUNKING")

DOC_MAX_CHUNK_CHARS = int(os.getenv("DOC_MAX_CHUNK_CHARS", "1400"))
DOC_MIN_CHUNK_CHARS = int(os.getenv("DOC_MIN_CHUNK_CHARS", "250"))
DOC_MAX_CHUNK_TOKENS = int(os.getenv("DOC_MAX_CHUNK_TOKENS", str(DEFAULT_CHUNK_TOKEN_BUDGET)))
DOC_MIN_CHUNK_TOKENS = int(os.getenv("DOC_MIN_CHUNK_TOKENS", "80"))
DOC_SEMANTIC_SPLIT = ENABLE_DOCUMENT_SEMANTIC_CHUNKING or os.getenv("DOC_SEMANTIC_SPLIT", "false").lower() in ("1", "true", "yes")
DOC_ADAPTIVE_CHUNKING = os.getenv("DOC_ADAPTIVE_CHUNKING", "false").lower() in ("1", "true", "yes")
DOC_CHUNK_DEDUP = os.getenv("DOC_CHUNK_DEDUP", "false").lower() in ("1", "true", "yes")
DOC_RECURSIVE_CHUNKING = os.getenv("DOC_RECURSIVE_CHUNKING", "false").lower() in ("1", "true", "yes")
DOC_EMBED_AWARE_MERGE = os.getenv("DOC_EMBED_AWARE_MERGE", "false").lower() in ("1", "true", "yes")
DOC_CHUNK_OVERLAP = os.getenv("DOC_CHUNK_OVERLAP", "false").lower() in ("1", "true", "yes")


def chunk_document_text(
    text: str,
    *,
    resource_type: str = "",
    max_chunk_chars: int = DOC_MAX_CHUNK_CHARS,
    min_chunk_chars: int = DOC_MIN_CHUNK_CHARS,
    max_chunk_tokens: int = DOC_MAX_CHUNK_TOKENS,
    min_chunk_tokens: int = DOC_MIN_CHUNK_TOKENS,
) -> list[ChunkPayload]:
    """Split structured document text by pages, headings, and block groups."""

    normalized = (text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized:
        return []

    pages = _split_pages(normalized)
    repeated_page_lines = _detect_repeated_page_lines(pages)
    sections = _build_sections(pages, resource_type=resource_type, repeated_page_lines=repeated_page_lines)
    if not sections:
        return []

    chunks: list[ChunkPayload] = []
    for section in sections:
        s_max = max_chunk_chars
        s_min = min_chunk_chars
        # --- Additive: adaptive chunk sizing per section (default OFF) ---
        if DOC_ADAPTIVE_CHUNKING:
            try:
                _sec_text = " ".join(b.get("text", "") for b in section.get("blocks", []))
                s_max, s_min = _adaptive_limits(_sec_text, max_chunk_chars, min_chunk_chars)
            except Exception:
                pass
        # --- End adaptive chunk sizing ---
        chunks.extend(
            _chunk_section(
                section,
                max_chunk_chars=s_max,
                min_chunk_chars=s_min,
                max_chunk_tokens=max_chunk_tokens,
                min_chunk_tokens=min_chunk_tokens,
            )
        )

    # --- Additive: optional semantic topic splitting (default OFF) ---
    if DOC_SEMANTIC_SPLIT and len(chunks) > 1:
        try:
            refined: list[ChunkPayload] = []
            for chunk in chunks:
                if len(chunk.content) > 800:
                    splits = _semantic_split_chunk(chunk.content, min_chunk_chars=min_chunk_chars)
                    if len(splits) > 1:
                        base_meta = dict(chunk.metadata)
                        for s_idx, split_text in enumerate(splits):
                            split_meta = dict(base_meta)
                            split_meta["semantic_split"] = True
                            split_meta["semantic_split_index"] = s_idx
                            split_meta["semantic_split_total"] = len(splits)
                            refined.append(ChunkPayload(content=split_text, metadata=split_meta))
                        continue
                refined.append(chunk)
            if refined:
                chunks = refined
        except Exception:
            pass
    # --- End semantic topic splitting ---

    # --- Additive: cross-chunk deduplication (default OFF) ---
    if DOC_CHUNK_DEDUP and len(chunks) > 1:
        try:
            seen_sentences: set[str] = set()
            deduped: list[ChunkPayload] = []
            for chunk in chunks:
                sentences = re.split(r'(?<=[.!?])\s+', chunk.content)
                kept: list[str] = []
                removed = 0
                for sent in sentences:
                    normalized = re.sub(r'\s+', ' ', sent.strip().lower())
                    if len(normalized) > 20 and normalized in seen_sentences:
                        removed += 1
                        continue
                    if len(normalized) > 20:
                        seen_sentences.add(normalized)
                    kept.append(sent)
                if kept:
                    new_text = " ".join(kept).strip()
                    new_meta = dict(chunk.metadata)
                    if removed > 0:
                        new_meta["dedup_removed_count"] = removed
                    deduped.append(ChunkPayload(content=new_text, metadata=new_meta))
            if deduped:
                chunks = deduped
        except Exception:
            pass
    # --- End cross-chunk deduplication ---

    # --- Additive: recursive chunk splitting (default OFF) ---
    if DOC_RECURSIVE_CHUNKING:
        try:
            refined: list[ChunkPayload] = []
            for chunk in chunks:
                if len(chunk.content) > max_chunk_chars:
                    sub_chunks = _recursive_split(chunk.content, max_chunk_chars, min_chunk_chars)
                    if len(sub_chunks) > 1:
                        base_meta = dict(chunk.metadata)
                        for r_idx, sub_text in enumerate(sub_chunks):
                            sub_meta = dict(base_meta)
                            sub_meta["recursive_split"] = True
                            sub_meta["recursive_index"] = r_idx
                            sub_meta["recursive_total"] = len(sub_chunks)
                            refined.append(ChunkPayload(content=sub_text, metadata=sub_meta))
                        continue
                refined.append(chunk)
            if refined:
                chunks = refined
        except Exception:
            pass
    # --- End recursive chunk splitting ---

    # --- Additive: embedding-aware quality merging (default OFF) ---
    if DOC_EMBED_AWARE_MERGE and len(chunks) > 1:
        try:
            merged: list[ChunkPayload] = []
            for chunk in chunks:
                content = chunk.content.strip()
                word_count = len(content.split())
                # Merge if too few words or very low character count
                if word_count < 15 and len(content) < 120 and merged:
                    prev = merged[-1]
                    combined_text = f"{prev.content}\n\n{content}".strip()
                    combined_meta = dict(prev.metadata)
                    combined_meta["merged_from"] = combined_meta.get("merged_from", []) + [content[:50]]
                    merged[-1] = ChunkPayload(content=combined_text, metadata=combined_meta)
                else:
                    merged.append(chunk)
            if merged:
                chunks = merged
        except Exception:
            pass
    # --- End embedding-aware quality merging ---

    # --- Additive: semantic overlap between chunks (default OFF) ---
    if DOC_CHUNK_OVERLAP and len(chunks) > 1:
        try:
            OVERLAP_CHARS = 150
            overlapped: list[ChunkPayload] = [chunks[0]]
            for idx in range(1, len(chunks)):
                prev_text = chunks[idx - 1].content
                # Take last OVERLAP_CHARS from previous chunk as context
                overlap_tail = prev_text[-OVERLAP_CHARS:]
                # Find a clean sentence boundary to avoid mid-word cut
                boundary = max(overlap_tail.rfind(". "), overlap_tail.rfind(". "), overlap_tail.rfind("! "), overlap_tail.rfind("? "))
                if boundary > 20:
                    overlap_tail = overlap_tail[boundary + 2:]
                overlap_prefix = f"[...] {overlap_tail.strip()}\n\n" if overlap_tail.strip() else ""
                new_content = f"{overlap_prefix}{chunks[idx].content}".strip()
                new_meta = dict(chunks[idx].metadata)
                new_meta["has_overlap"] = True
                new_meta["overlap_source_index"] = idx - 1
                overlapped.append(ChunkPayload(content=new_content, metadata=new_meta))
            chunks = overlapped
        except Exception:
            pass
    # --- End semantic overlap ---

    logger.info(f"Document chunks created: {len(chunks)} from {len(sections)} sections")
    return chunks


def _split_pages(text: str) -> list[dict]:
    marker = re.compile(r"(?m)^\[Page\s+(\d+)\]\s*$")
    matches = list(marker.finditer(text))
    if not matches:
        return [{"page_number": None, "content": text}]

    pages: list[dict] = []
    for index, match in enumerate(matches):
        page_number = int(match.group(1))
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        content = text[start:end].strip()
        pages.append({"page_number": page_number, "content": content})
    return pages


def _build_sections(
    pages: list[dict],
    *,
    resource_type: str,
    repeated_page_lines: set[str] | None = None,
) -> list[dict]:
    sections: list[dict] = []
    active: dict | None = None

    for page in pages:
        blocks = _split_blocks(page["content"], repeated_page_lines=repeated_page_lines or set())
        blocks = _enhance_block_relationships(blocks)
        if not blocks:
            continue
        for block in blocks:
            heading = _detect_heading(block["text"], resource_type=resource_type)
            if active is None:
                active = _new_section(page["page_number"], heading)
            elif heading is not None and active["blocks"]:
                sections.append(active)
                active = _new_section(page["page_number"], heading)
            elif active["page_end"] is None and page["page_number"] is not None:
                active["page_end"] = page["page_number"]

            active["blocks"].append(block)
            if page["page_number"] is not None:
                active["page_start"] = page["page_number"] if active["page_start"] is None else active["page_start"]
                active["page_end"] = page["page_number"]
            if heading and not active["section_title"]:
                active["section_title"] = heading

    if active and active["blocks"]:
        sections.append(active)
    return _annotate_section_paths(sections)


def _new_section(page_number: int | None, heading: str | None) -> dict:
    return {
        "section_title": heading or "",
        "heading_level": _detect_heading_level(heading or ""),
        "page_start": page_number,
        "page_end": page_number,
        "blocks": [],
    }


def _split_blocks(text: str, *, repeated_page_lines: set[str] | None = None) -> list[dict]:
    raw_blocks = [block.strip() for block in re.split(r"\n\s*\n", text) if block.strip()]
    structured: list[dict] = []
    repeated_page_lines = repeated_page_lines or set()
    for raw in raw_blocks:
        block_type = _classify_block(raw)
        if block_type in {"table", "code", "formula"}:
            structured.append({"text": raw.strip(), "block_type": block_type})
            continue
        lines = []
        for raw_line in raw.splitlines():
            cleaned_line = _clean_text_line(raw_line)
            if not cleaned_line:
                continue
            if _looks_like_ocr_noise(cleaned_line):
                continue
            normalized_line = _normalize_page_line(cleaned_line)
            if normalized_line and normalized_line in repeated_page_lines and not _looks_like_strong_heading_candidate(cleaned_line):
                continue
            lines.append(cleaned_line)
        if not lines:
            continue
        current = lines[0]
        for line in lines[1:]:
            if _looks_like_list_item(line) or _detect_heading(line, resource_type="docx"):
                structured.append({"text": current.strip(), "block_type": _classify_block(current)})
                current = line
            else:
                current = f"{current} {line}".strip()
        if current.strip():
            structured.append({"text": current.strip(), "block_type": _classify_block(current)})
    return structured


def _detect_heading(paragraph: str, *, resource_type: str) -> str | None:
    stripped = paragraph.strip()
    if not stripped:
        return None
    block_type = _classify_block(stripped)
    if block_type in {"caption", "footnote", "list"}:
        return None
    if stripped.startswith("#"):
        return stripped.lstrip("#").strip()[:180]
    if re.match(r"^(section|chapter|part|appendix)\s+[\w.-]+", stripped, re.IGNORECASE):
        return stripped[:180]
    if re.match(r"^(?:[ivxlcdm]+)[.)]?\s+\S+", stripped, re.IGNORECASE):
        return stripped[:180]
    if re.match(r"^\d+(?:[.)]|\.\d+)*\s+\S+", stripped):
        return stripped[:180]
    if len(stripped) <= 100 and stripped == stripped.upper() and len(stripped.split()) <= 12:
        return stripped.title()[:180]
    if _looks_like_title_heading(stripped):
        return stripped[:180]
    if resource_type == "docx" and len(stripped) <= 90 and len(stripped.split()) <= 12 and not stripped.endswith("."):
        return stripped[:180]
    return None


def _looks_like_list_item(line: str) -> bool:
    return bool(re.match(r"^([-*•]|\d+[.)])\s+", line.strip()))


def _classify_block(text: str) -> str:
    stripped = text.strip()
    lines = [line.rstrip() for line in stripped.splitlines() if line.strip()]
    if not lines:
        return "paragraph"
    if _looks_like_caption(stripped):
        return "caption"
    if _looks_like_footnote(stripped):
        return "footnote"
    if stripped.startswith("[Table]") or sum(1 for line in lines if "|" in line) >= 2:
        return "table"
    if stripped.startswith("```") or sum(1 for line in lines if line.startswith(("def ", "class ", "function ", "const ", "let ", "var ", "if ", "for ", "while "))) >= 2:
        return "code"
    if any(marker in stripped for marker in ("\\frac", "\\sum", "\\int", "=>", "<=", ">=", "≈")):
        return "formula"
    if re.search(r"\b[a-zA-Z]\s*=\s*[^=]", stripped) and any(char.isdigit() for char in stripped):
        return "formula"
    if _looks_like_list_item(lines[0]) and not _looks_like_strong_heading_candidate(lines[0]):
        return "list"
    return "paragraph"


def _chunk_section(
    section: dict,
    *,
    max_chunk_chars: int,
    min_chunk_chars: int,
    max_chunk_tokens: int,
    min_chunk_tokens: int,
) -> list[ChunkPayload]:
    outputs: list[ChunkPayload] = []
    current: list[dict] = []

    def flush() -> None:
        if not current:
            return
        text = "\n\n".join(block["text"] for block in current).strip()
        if not text:
            return
        block_types: list[str] = []
        for block in current:
            for block_type in [block["block_type"], *block.get("related_block_types", [])]:
                if block_type not in block_types:
                    block_types.append(block_type)
        metadata = {
            "document_chunking_strategy": "section_paragraphs",
            "section_title": section["section_title"],
            "heading_level": section.get("heading_level"),
            "section_path": list(section.get("section_path", [])),
            "estimated_tokens": estimate_tokens(text),
            "block_types": block_types,
            "block_count": len(current),
        }
        attached_captions = [block.get("attached_caption") for block in current if block.get("attached_caption")]
        attached_footnotes = sum(len(block.get("attached_footnotes", [])) for block in current)
        if attached_captions:
            metadata["attached_captions"] = attached_captions
            metadata["has_attached_caption"] = True
        if attached_footnotes:
            metadata["attached_footnote_count"] = attached_footnotes
        if len(block_types) == 1:
            metadata["primary_block_type"] = block_types[0]
        if section["page_start"] is not None:
            metadata["page_start"] = section["page_start"]
            metadata["page_end"] = section["page_end"]
            metadata["page_number"] = section["page_start"]
        outputs.append(ChunkPayload(content=text, metadata=metadata))

    for block in section["blocks"]:
        block_text = block["text"]
        if block["block_type"] in {"table", "code", "formula"} and current:
            flush()
            current = []
        candidate = "\n\n".join(item["text"] for item in (current + [block])).strip() if current else block_text
        candidate_tokens = estimate_tokens(candidate)
        if current and (len(candidate) > max_chunk_chars or candidate_tokens > max_chunk_tokens):
            flush()
            current = [block]
        else:
            current.append(block)

        current_text = "\n\n".join(item["text"] for item in current)
        if len(current_text) >= max_chunk_chars or estimate_tokens(current_text) >= max_chunk_tokens:
            flush()
            current = []

    if current:
        current_text = "\n\n".join(item["text"] for item in current)
        if outputs and len(current_text) < min_chunk_chars and estimate_tokens(current_text) < min_chunk_tokens:
            previous = outputs.pop()
            merged_text = f"{previous.content}\n\n{current_text}".strip()
            merged_metadata = dict(previous.metadata)
            merged_block_types = list(dict.fromkeys(previous.metadata.get("block_types", []) + [item["block_type"] for item in current]))
            merged_metadata["block_types"] = merged_block_types
            if len(merged_block_types) == 1:
                merged_metadata["primary_block_type"] = merged_block_types[0]
            else:
                merged_metadata.pop("primary_block_type", None)
            if section["page_end"] is not None:
                merged_metadata["page_end"] = section["page_end"]
            merged_metadata["estimated_tokens"] = estimate_tokens(merged_text)
            outputs.append(ChunkPayload(content=merged_text, metadata=merged_metadata))
        else:
            flush()

    return outputs


def _clean_text_line(line: str) -> str:
    return line.strip().replace("â€¢", "•").replace("â‰ˆ", "≈")


def _normalize_page_line(line: str) -> str:
    normalized = re.sub(r"\s+", " ", (line or "").strip()).lower()
    normalized = re.sub(r"\bpage\s+\d+\b", "page", normalized)
    return normalized


def _detect_repeated_page_lines(pages: list[dict]) -> set[str]:
    page_counts: dict[str, int] = {}
    for page in pages:
        page_lines = {
            _normalize_page_line(_clean_text_line(line))
            for line in page.get("content", "").splitlines()
            if _clean_text_line(line)
        }
        for line in page_lines:
            if not line or len(line) > 120:
                continue
            page_counts[line] = page_counts.get(line, 0) + 1
    return {line for line, count in page_counts.items() if count >= 2}


def _looks_like_strong_heading_candidate(text: str) -> bool:
    stripped = (text or "").strip()
    if not stripped:
        return False
    return bool(
        stripped.startswith("#")
        or re.match(r"^(section|chapter|part|appendix)\s+[\w.-]+", stripped, re.IGNORECASE)
        or re.match(r"^(?:[ivxlcdm]+)[.)]?\s+\S+", stripped, re.IGNORECASE)
        or re.match(r"^\d+(?:[.)]|\.\d+)*\s+\S+", stripped)
        or (len(stripped) <= 100 and stripped == stripped.upper() and len(stripped.split()) <= 12)
    )


def _looks_like_caption(text: str) -> bool:
    return bool(
        re.match(
            r"^(figure|fig\.|table|chart|diagram|exhibit)\s+[\w.-]+[:.-]?\s+\S+",
            text.strip(),
            re.IGNORECASE,
        )
    )


def _looks_like_footnote(text: str) -> bool:
    stripped = text.strip()
    if re.match(r"^\d+(?:\.\d+)*[.)]?\s+[A-Z]", stripped):
        return False
    return bool(
        (len(stripped) <= 220 and re.match(r"^(?:\[\d+\]|\d+[.)]|[†‡*])\s+\S+", stripped))
        or re.match(r"^footnote[:\s]", stripped, re.IGNORECASE)
    )


def _looks_like_title_heading(text: str) -> bool:
    words = [word for word in re.split(r"\s+", text.strip()) if word]
    if not (1 <= len(words) <= 12):
        return False
    if text.endswith((".", "!", "?", ";", ":")):
        return False
    titled = 0
    for word in words:
        plain = re.sub(r"[^A-Za-z0-9-]", "", word)
        if not plain:
            continue
        if plain[:1].isupper():
            titled += 1
    return titled >= max(2, int(len(words) * 0.6))


def _detect_heading_level(heading: str) -> int | None:
    stripped = (heading or "").strip()
    if not stripped:
        return None
    if stripped.startswith("#"):
        return max(1, min(6, len(stripped) - len(stripped.lstrip("#"))))
    numbered = re.match(r"^(\d+(?:\.\d+)*)", stripped)
    if numbered:
        return numbered.group(1).count(".") + 1
    if re.match(r"^(chapter|part|appendix)\s+", stripped, re.IGNORECASE):
        return 1
    if re.match(r"^(section)\s+", stripped, re.IGNORECASE):
        return 2
    if re.match(r"^(?:[ivxlcdm]+)[.)]?\s+\S+", stripped, re.IGNORECASE):
        return 1
    return 2 if _looks_like_title_heading(stripped) else None


def _enhance_block_relationships(blocks: list[dict]) -> list[dict]:
    enhanced: list[dict] = []
    pending_caption: str | None = None
    pending_footnotes: list[str] = []

    for block in blocks:
        item = dict(block)
        block_type = item.get("block_type")

        if block_type == "caption":
            pending_caption = item.get("text", "").strip() or pending_caption
            continue

        if block_type == "footnote":
            if enhanced:
                enhanced[-1].setdefault("attached_footnotes", []).append(item.get("text", "").strip())
                enhanced[-1].setdefault("related_block_types", []).append("footnote")
            else:
                pending_footnotes.append(item.get("text", "").strip())
            continue

        if pending_caption:
            item["attached_caption"] = pending_caption
            item.setdefault("related_block_types", []).append("caption")
            item["text"] = f"{pending_caption}\n\n{item.get('text', '').strip()}".strip()
            pending_caption = None

        if pending_footnotes:
            item.setdefault("attached_footnotes", []).extend(pending_footnotes)
            item.setdefault("related_block_types", []).append("footnote")
            pending_footnotes = []

        enhanced.append(item)

    if pending_caption:
        enhanced.append({"text": pending_caption, "block_type": "caption", "attached_caption": pending_caption})
    if pending_footnotes:
        enhanced.append({"text": "\n".join(pending_footnotes), "block_type": "footnote", "attached_footnotes": pending_footnotes})
    return enhanced


def _annotate_section_paths(sections: list[dict]) -> list[dict]:
    stack: list[tuple[int, str]] = []
    annotated: list[dict] = []
    for section in sections:
        title = str(section.get("section_title") or "").strip()
        level = section.get("heading_level")
        if title and level is not None:
            while stack and stack[-1][0] >= level:
                stack.pop()
            stack.append((level, title))
            section["section_path"] = [item[1] for item in stack]
        elif title:
            section["section_path"] = [title]
        else:
            section["section_path"] = [item[1] for item in stack] if stack else []
        annotated.append(section)
    return annotated


def _looks_like_ocr_noise(text: str) -> bool:
    stripped = (text or "").strip()
    if len(stripped) < 3:
        return False
    compact = re.sub(r"\s+", "", stripped)
    if not compact:
        return True
    alnum = sum(char.isalnum() for char in compact)
    punctuation = sum(not char.isalnum() for char in compact)
    if alnum <= 2 and punctuation >= 3:
        return True
    if len(stripped.split()) >= 4 and all(len(token) == 1 for token in stripped.split()):
        return True
    return False


# --- Additive: semantic topic splitting (opt-in via DOC_SEMANTIC_SPLIT) ---
_semantic_model = None
_semantic_model_failed = False
_SIMILARITY_THRESHOLD = 0.40


def _get_semantic_model():
    """Lazy-load a small local sentence model for boundary detection."""
    global _semantic_model, _semantic_model_failed
    if _semantic_model is not None:
        return _semantic_model
    if _semantic_model_failed:
        return None
    try:
        import contextlib
        from sentence_transformers import SentenceTransformer
        with open(os.devnull, "w") as devnull:
            with contextlib.redirect_stderr(devnull), contextlib.redirect_stdout(devnull):
                _semantic_model = SentenceTransformer("all-MiniLM-L6-v2")
        return _semantic_model
    except Exception:
        _semantic_model_failed = True
        return None


def _split_into_sentence_list(text: str) -> list[str]:
    """Split text into sentences using punctuation boundaries."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    paragraphs = [p.strip() for p in re.split(r"\n{2,}", text) if p.strip()]
    sentences: list[str] = []
    for paragraph in paragraphs:
        pieces = re.split(r"(?<=[.!?])\s+", paragraph)
        for piece in pieces:
            piece = piece.strip()
            if piece:
                sentences.append(piece)
    return sentences


def _semantic_split_chunk(text: str, min_chunk_chars: int = 250) -> list[str]:
    """Split a long chunk at semantic topic boundaries using sentence embeddings.

    Returns a list of sub-chunks. Falls back to returning [text] on any failure.
    """
    sentences = _split_into_sentence_list(text)
    if len(sentences) < 3:
        return [text]

    model = _get_semantic_model()
    if model is None:
        return [text]

    try:
        import numpy as np
        embeddings = model.encode(sentences, show_progress_bar=False)

        def cosine(a, b):
            denom = np.linalg.norm(a) * np.linalg.norm(b)
            return float(np.dot(a, b) / denom) if denom > 0 else 0.0

        groups: list[list[str]] = [[sentences[0]]]
        for i in range(1, len(sentences)):
            prev_emb = np.mean(embeddings[max(0, i - 2):i], axis=0)
            next_emb = np.mean(embeddings[i:min(len(sentences), i + 2)], axis=0)
            sim = cosine(prev_emb, next_emb)
            current_len = sum(len(s) for s in groups[-1])
            if sim < _SIMILARITY_THRESHOLD and current_len >= min_chunk_chars:
                groups.append([sentences[i]])
            else:
                groups[-1].append(sentences[i])

        if len(groups) <= 1:
            return [text]

        return [" ".join(g).strip() for g in groups if g]
    except Exception:
        return [text]


def _adaptive_limits(text: str, default_max: int, default_min: int) -> tuple[int, int]:
    """Return adjusted chunk size limits based on content density.

    Dense technical text → smaller chunks for precision.
    Simple lists/short sentences → larger chunks to keep related items together.
    """
    words = text.split()
    if not words:
        return default_max, default_min

    avg_word_len = sum(len(w) for w in words) / len(words)
    unique_ratio = len(set(w.lower() for w in words)) / len(words)
    list_lines = sum(1 for line in text.splitlines() if re.match(r"^\s*([-*•]|\d+[.)])\s+", line))
    list_ratio = list_lines / max(1, len(text.splitlines()))

    if avg_word_len > 6.5 and unique_ratio > 0.65:
        return max(600, default_max - 400), max(150, default_min - 50)
    if list_ratio > 0.4 or avg_word_len < 4.0:
        return min(1800, default_max + 400), default_min
    return default_max, default_min


def _recursive_split(text: str, max_chars: int, min_chars: int) -> list[str]:
    """Split an oversized chunk into smaller pieces at sentence boundaries.

    Groups sentences until hitting max_chars, then starts a new group.
    Merges the last group into the previous if it's too small.
    """
    sentences = _split_into_sentence_list(text)
    if len(sentences) < 2:
        return [text]

    groups: list[list[str]] = [[sentences[0]]]
    for sent in sentences[1:]:
        candidate = " ".join(groups[-1] + [sent]).strip()
        if len(candidate) <= max_chars:
            groups[-1].append(sent)
        else:
            groups.append([sent])

    if len(groups) <= 1:
        return [text]

    # Merge tiny last group into previous
    if groups:
        last_text = " ".join(groups[-1]).strip()
        if len(last_text) < min_chars and len(groups) > 1:
            groups[-2].extend(groups[-1])
            groups.pop()

    return [" ".join(g).strip() for g in groups if g]
