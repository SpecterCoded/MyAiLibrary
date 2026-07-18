import hashlib
import os
from uuid import uuid4

from models import Resource


STRICT_CONTENT_HASH_TYPES = {"video", "audio", "pdf", "image", "docx", "youtube"}


def should_enforce_content_hash(resource_type: str | None) -> bool:
    return (resource_type or "").lower() in STRICT_CONTENT_HASH_TYPES


def compute_bytes_content_hash(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def compute_file_content_hash(file_path: str) -> str:
    digest = hashlib.sha256()
    with open(file_path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def compute_external_content_hash(identity: str) -> str:
    normalized = (identity or "").strip()
    if not normalized:
        return ""
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def resolve_resource_content_hash(
    resource_type: str,
    *,
    file_path: str | None = None,
    content: bytes | None = None,
    external_identity: str | None = None,
) -> str:
    if not should_enforce_content_hash(resource_type):
        return ""

    if content is not None:
        return compute_bytes_content_hash(content)

    if file_path and os.path.exists(file_path):
        return compute_file_content_hash(file_path)

    if external_identity:
        return compute_external_content_hash(external_identity)

    return ""


def create_resource(
    folder_id, file_name, file_path, resource_type, content_length, user_id=None, content_hash=""
):

    resource = Resource(
        id=str(uuid4()),
        title=file_name,
        description="",
        tags="",
        type=resource_type,
        local_path=file_path,
        content_hash=content_hash or "",
        thumbnail_path="",
        file_size=content_length,
        duration_seconds=0,
        processing_status="uploaded",
        folder_id=folder_id,
        user_id=user_id,
    )

    return resource
