import re
from .sentence_segmentation_service import split_into_sentences

def extract_best_evidence(answer: str, chunk: str) -> str:
    """
    Finds the most relevant sentence in a chunk based on the LLM's answer.
    Scores sentences using word overlap (Jaccard similarity) and returns the best match with context.
    """
    if not answer or not chunk:
        return chunk[:200]

    # 1. Split chunk into sentences using the existing segmentation service
    sentences = split_into_sentences(chunk)
    if not sentences:
        return chunk[:200]

    # Clean and tokenize answer into lowercase words
    answer_words = set(re.findall(r'\w+', answer.lower()))
    if not answer_words:
        return chunk[:200]

    best_idx = 0
    best_score = -1.0

    # 2. Score every sentence using Jaccard Similarity (word overlap)
    for idx, sentence in enumerate(sentences):
        sentence_words = set(re.findall(r'\w+', sentence.lower()))
        if not sentence_words:
            continue
        
        intersection = answer_words.intersection(sentence_words)
        union = answer_words.union(sentence_words)
        
        score = len(intersection) / len(union)
        
        if score > best_score:
            best_score = score
            best_idx = idx

    # 3. Include neighboring sentences for context (Question + Answer pattern)
    # We take the best sentence and its immediate neighbors to ensure coherence.
    start_idx = max(0, best_idx - 1)
    end_idx = min(len(sentences), best_idx + 2)
    
    snippet = " ".join(sentences[start_idx:end_idx])
    
    # Return max 400 chars to keep it concise but informative
    if len(snippet) > 400:
        snippet = sentences[best_idx]
        if best_idx > 0 and len(snippet) + len(sentences[best_idx-1]) < 400:
             snippet = sentences[best_idx-1] + " " + snippet
        elif best_idx < len(sentences) - 1 and len(snippet) + len(sentences[best_idx+1]) < 400:
             snippet = snippet + " " + sentences[best_idx+1]

    return snippet.strip()
