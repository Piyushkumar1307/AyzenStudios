import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

try:
    # Load local `.env` relative to this file, so it works no matter
    # which directory uvicorn is launched from.
    from dotenv import load_dotenv

    _here = Path(__file__).resolve().parent
    load_dotenv(dotenv_path=_here / ".env")
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


# Prevent long "pending" API calls if DB networking stalls (common with remote Postgres/Neon).
# - `connect_timeout` is passed through libpq
# - `statement_timeout` aborts a single query if the DB is wedged
engine = create_engine(
    _database_url(),
    pool_pre_ping=True,
    connect_args={"connect_timeout": 10, "options": "-c statement_timeout=10000"},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
