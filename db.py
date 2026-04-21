import os

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

try:
    # Load local `.env` for dev runs (uvicorn doesn't auto-load it).
    from dotenv import load_dotenv

    load_dotenv()
except Exception:
    # In some deployments python-dotenv may be absent; rely on real env vars.
    pass


def _database_url() -> str:
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        raise RuntimeError(
            "DATABASE_URL env var is required (PostgreSQL connection string). "
            "If you created a .env file, make sure it is loaded or start uvicorn with it exported."
        )
    # Render often provides postgres:// which SQLAlchemy expects as postgresql://
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://") :]
    return url


engine = create_engine(_database_url(), pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

