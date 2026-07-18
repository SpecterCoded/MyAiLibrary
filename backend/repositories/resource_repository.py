from sqlalchemy.orm import Session

from models import Resource
from services.resource_service import resolve_resource_content_hash, should_enforce_content_hash


class DuplicateResourceError(Exception):
    def __init__(self, existing_resource: Resource):
        super().__init__("Duplicate resource content detected")
        self.existing_resource = existing_resource


def backfill_missing_resource_hashes(db: Session, user_id: str | None):
    if not user_id:
        return

    candidates = (
        db.query(Resource)
        .filter(
            Resource.user_id == user_id,
            Resource.is_deleted == 0,
            (Resource.content_hash.is_(None) | (Resource.content_hash == "")),
        )
        .all()
    )

    changed = False
    for resource in candidates:
        if not should_enforce_content_hash(resource.type):
            continue
        if ensure_resource_content_hash(resource):
            changed = True

    if changed:
        db.commit()


def find_duplicate_resource_by_hash(
    db: Session,
    *,
    user_id: str | None,
    content_hash: str | None,
    folder_id: str | None = None,
    exclude_resource_id: str | None = None,
):
    if not user_id or not content_hash:
        return None

    backfill_missing_resource_hashes(db, user_id)

    query = (
        db.query(Resource)
        .filter(
            Resource.user_id == user_id,
            Resource.content_hash == content_hash,
            Resource.is_deleted == 0,
        )
    )
    if folder_id:
        query = query.filter(Resource.folder_id == folder_id)
    if exclude_resource_id:
        query = query.filter(Resource.id != exclude_resource_id)
    return query.first()


def ensure_resource_content_hash(resource: Resource) -> str:
    if resource.content_hash:
        return resource.content_hash

    if not should_enforce_content_hash(resource.type):
        return ""

    external_identity = None
    if (resource.type or "").lower() == "youtube":
        external_identity = resource.description or resource.local_path or resource.title

    content_hash = resolve_resource_content_hash(
        resource.type,
        file_path=resource.local_path,
        external_identity=external_identity,
    )
    resource.content_hash = content_hash or ""
    return resource.content_hash


def get_all_resources(
    db: Session
):
    return db.query(Resource).all()


def get_resource_by_id(
    db: Session,
    resource_id: str
):
    return (
        db.query(Resource)
        .filter(Resource.id == resource_id)
        .first()
    )


def save_resource(
    db: Session,
    resource: Resource
):
    ensure_resource_content_hash(resource)
    duplicate = find_duplicate_resource_by_hash(
        db,
        user_id=resource.user_id,
        content_hash=resource.content_hash,
        folder_id=resource.folder_id,
        exclude_resource_id=resource.id,
    )
    if duplicate:
        raise DuplicateResourceError(duplicate)

    db.add(resource)

    db.commit()

    db.refresh(resource)

    return resource
