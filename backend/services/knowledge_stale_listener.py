"""Marks published knowledge stale when source artifacts change."""

from sqlalchemy import event, inspect, text

from models import Chapter, Flashcard, Note, Quiz, Resource, SubChapter, Summary

_REGISTERED = False


def _changed(instance, names):
    state = inspect(instance)
    return any(state.attrs[name].history.has_changes() for name in names if name in state.attrs)


def register_knowledge_stale_listeners(session_class):
    global _REGISTERED
    if _REGISTERED:
        return
    _REGISTERED = True

    @event.listens_for(session_class, "before_flush")
    def collect_changed_knowledge_sources(session, _flush_context, _instances):
        resource_ids = set(session.info.get("knowledge_stale_resource_ids", set()))
        connection = session.connection()

        def chapter_resource(chapter_id):
            if not chapter_id:
                return None
            return connection.execute(
                text("SELECT resource_id FROM chapters WHERE id = :id"),
                {"id": chapter_id},
            ).scalar()

        def subchapter_resource(subchapter_id):
            if not subchapter_id:
                return None
            return connection.execute(
                text(
                    "SELECT c.resource_id FROM subchapters s "
                    "JOIN chapters c ON c.id = s.chapter_id WHERE s.id = :id"
                ),
                {"id": subchapter_id},
            ).scalar()

        for item in session.new.union(session.dirty).union(session.deleted):
            resource_id = None
            if isinstance(item, Resource):
                if item in session.new or item in session.deleted or _changed(
                    item, {"transcript", "summary", "description", "title"}
                ):
                    resource_id = item.id
            elif isinstance(item, Chapter):
                resource_id = item.resource_id
            elif isinstance(item, SubChapter):
                resource_id = chapter_resource(item.chapter_id)
            elif isinstance(item, Note):
                resource_id = item.resource_id or chapter_resource(item.chapter_id) or subchapter_resource(item.subchapter_id)
            elif isinstance(item, Flashcard):
                resource_id = item.resource_id
            elif isinstance(item, Quiz):
                resource_id = item.resource_id or chapter_resource(item.chapter_id) or subchapter_resource(item.subchapter_id)
            elif isinstance(item, Summary):
                resource_id = item.resource_id or chapter_resource(item.chapter_id)
            if resource_id:
                resource_ids.add(resource_id)

        session.info["knowledge_stale_resource_ids"] = resource_ids

    @event.listens_for(session_class, "after_flush_postexec")
    def mark_changed_knowledge_stale(session, _flush_context):
        resource_ids = session.info.pop("knowledge_stale_resource_ids", set())
        if not resource_ids:
            return
        connection = session.connection()
        for resource_id in resource_ids:
            connection.execute(
                text(
                    "UPDATE resource_knowledge_states "
                    "SET status = 'stale', stale_reasons = :reasons, updated_at = CURRENT_TIMESTAMP "
                    "WHERE resource_id = :resource_id AND active_run_id IS NOT NULL"
                ),
                {"resource_id": resource_id, "reasons": '["source_changed"]'},
            )
