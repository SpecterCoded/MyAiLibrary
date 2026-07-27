"""UTC time helpers shared by database-facing backend services."""

from datetime import datetime, timezone


def utc_now() -> datetime:
    """Return naive UTC for compatibility with the existing database schema."""
    return datetime.now(timezone.utc).replace(tzinfo=None)
