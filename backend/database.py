from sqlalchemy import create_engine, event
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import sessionmaker
from core.paths import DATABASE_DIR, ensure_runtime_directories

ensure_runtime_directories()
DATABASE_PATH = DATABASE_DIR / "library.db"
DATABASE_URL = f"sqlite:///{DATABASE_PATH.as_posix()}"

engine = create_engine(
    DATABASE_URL,
    connect_args={
        "check_same_thread": False,
        "timeout": 30,  # wait up to 30s for a lock instead of failing instantly
    }
)

# Enable WAL mode: allows concurrent reads while a write is in progress,
# which prevents "database is locked" when the queue worker and API overlap.
@event.listens_for(engine, "connect")
def set_wal_mode(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=30000")  # 30s busy timeout at SQLite level too
    cursor.close()

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

Base = declarative_base()
