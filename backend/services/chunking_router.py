"""Route resources to the most appropriate chunking strategy."""

from __future__ import annotations

from core.logger import get_logger
from models import Resource

from .chunking_models import ChunkPayload
from .chunking_service import semantic_chunk_text
from .document_chunking_service import chunk_document_text
from .media_chunking_service import chunk_media_resource
from .sentence_segmentation_service import configure_wtp_model_path

logger = get_logger("CHUNK_ROUTER")


def chunk_resource(resource_id: str, transcript: str, db) -> list[ChunkPayload]:
    """Choose the best available chunker while preserving safe fallback behavior."""

    resource = db.query(Resource).filter(Resource.id == resource_id).first()
    resource_type = (resource.type or "").lower() if resource else ""
    if resource and getattr(resource, "user_id", None):
        try:
            from models import UserSetting

            settings = db.query(UserSetting).filter(UserSetting.user_id == resource.user_id).first()
            configure_wtp_model_path(getattr(settings, "wtp_model_path", None) if settings else None)
        except Exception as exc:
            logger.warning(f"Could not apply configured WTP model for {resource_id}: {exc}.")

    if resource_type in {"audio", "video", "youtube"}:
        try:
            chunks = chunk_media_resource(resource_id, transcript, db)
            if chunks:
                return chunks
        except Exception as exc:
            logger.warning(f"Media chunking failed for {resource_id}: {exc}. Falling back to semantic chunking.")

    if resource_type in {"pdf", "docx", "image"}:
        try:
            chunks = chunk_document_text(transcript, resource_type=resource_type)
            if chunks:
                return chunks
        except Exception as exc:
            logger.warning(f"Document chunking failed for {resource_id}: {exc}. Falling back to semantic chunking.")

    return [ChunkPayload(content=chunk, metadata={}) for chunk in semantic_chunk_text(transcript)]
