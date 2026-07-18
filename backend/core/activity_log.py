"""
Backend activity logging helper.
Writes user-facing processing events to the activity_logs table
so they appear in the frontend Activity Log panel.

Log retention: MAX_ENTRIES_PER_USER (default 15) per user.
On each write, old entries beyond the cap are auto-deleted.
"""
from uuid import uuid4
from datetime import datetime

MAX_ENTRIES_PER_USER = 15


def log_user_activity(db, user_id: str, category: str, action: str, detail: str = None):
    """
    Write an activity log entry to the database.
    Automatically enforces per-user cap — old entries are trimmed on insert.
    Non-breaking: silently ignores errors so it never disrupts the main flow.
    """
    try:
        from models import ActivityLog
        entry = ActivityLog(
            id=str(uuid4()),
            user_id=user_id,
            category=category,
            action=action,
            detail=detail,
            created_at=datetime.utcnow(),
        )
        db.add(entry)
        db.commit()

        # Trim old entries beyond cap (keeps only the newest MAX_ENTRIES_PER_USER)
        _trim_user_logs(db, user_id)
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass


def _trim_user_logs(db, user_id: str):
    """Delete oldest entries for a user when count exceeds the cap."""
    try:
        from models import ActivityLog
        from sqlalchemy import text

        count = db.query(ActivityLog).filter(ActivityLog.user_id == user_id).count()
        if count <= MAX_ENTRIES_PER_USER:
            return

        # Find the IDs of the oldest entries to delete
        excess = count - MAX_ENTRIES_PER_USER
        oldest_ids = (
            db.query(ActivityLog.id)
            .filter(ActivityLog.user_id == user_id)
            .order_by(ActivityLog.created_at.asc())
            .limit(excess)
            .all()
        )

        if oldest_ids:
            id_list = [row.id for row in oldest_ids]
            db.query(ActivityLog).filter(ActivityLog.id.in_(id_list)).delete(synchronize_session=False)
            db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass


def cleanup_all_users(db):
    """Bulk cleanup — trim all users to MAX_ENTRIES_PER_USER. Use for maintenance."""
    try:
        from models import ActivityLog
        from sqlalchemy import distinct

        user_ids = [row[0] for row in db.query(distinct(ActivityLog.user_id)).all()]
        total_deleted = 0
        for uid in user_ids:
            count = db.query(ActivityLog).filter(ActivityLog.user_id == uid).count()
            if count <= MAX_ENTRIES_PER_USER:
                continue
            excess = count - MAX_ENTRIES_PER_USER
            oldest_ids = (
                db.query(ActivityLog.id)
                .filter(ActivityLog.user_id == uid)
                .order_by(ActivityLog.created_at.asc())
                .limit(excess)
                .all()
            )
            if oldest_ids:
                id_list = [row.id for row in oldest_ids]
                db.query(ActivityLog).filter(ActivityLog.id.in_(id_list)).delete(synchronize_session=False)
                total_deleted += len(id_list)
        db.commit()
        return total_deleted
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
        return 0
