import os
import sqlite3
import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from backend.core.config import get_storage_dir

logger = logging.getLogger(__name__)

# The disk cache database will be stored in the storage directory, unless the
# NARRATO_LLM_CACHE_DB env var points elsewhere (used by tests to keep the
# dev workspace clean).
CACHE_DB_PATH = Path(os.environ.get("NARRATO_LLM_CACHE_DB") or (get_storage_dir() / "llm_cache.db"))

# Bump CACHE_VERSION whenever the cache key schema or stored response format
# changes — stale cached responses from older builds are then ignored.
CACHE_VERSION = "v2"

# Entry lifetime and hard size cap so the cache cannot grow unbounded.
CACHE_TTL_SECONDS = 30 * 24 * 3600  # 30 days
CACHE_MAX_ENTRIES = 2000

def _get_cache_connection():
    conn = sqlite3.connect(CACHE_DB_PATH, timeout=10.0)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.row_factory = sqlite3.Row
    return conn

def init_llm_cache():
    """Initialize the LLM disk cache table."""
    try:
        with _get_cache_connection() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS llm_cache (
                    cache_key TEXT PRIMARY KEY,
                    response TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
            """)
            conn.commit()
    except Exception as e:
        logger.error(f"Failed to initialize LLM disk cache: {e}")

# Initialize the cache table on module load
init_llm_cache()

def build_cache_key(provider: str, model: str, temperature: float, max_tokens: int, top_p: float, sys_hash: str, user_hash: str, schema_flag: str = "S") -> str:
    """Creates a deterministic string key from configuration and prompt hashes.

    schema_flag distinguishes strict-JSON calls from loose (tool-loop) calls so
    a raw text response can never be returned where a parsed dict is expected.
    """
    return f"{CACHE_VERSION}:{provider}:{model}:{temperature}:{max_tokens}:{top_p}:{schema_flag}:{sys_hash}:{user_hash}"

def _parse_timestamp(value: str) -> float:
    try:
        return datetime.fromisoformat(value).timestamp()
    except Exception:
        return 0.0

def get_cached_response(cache_key: str):
    """Retrieve a cached LLM response from disk, honoring TTL and version.

    Returns None when the entry is missing, expired, or unreadable.
    """
    try:
        with _get_cache_connection() as conn:
            row = conn.execute("SELECT response, created_at FROM llm_cache WHERE cache_key = ?", (cache_key,)).fetchone()
            if row:
                if time.time() - _parse_timestamp(row["created_at"]) > CACHE_TTL_SECONDS:
                    conn.execute("DELETE FROM llm_cache WHERE cache_key = ?", (cache_key,))
                    conn.commit()
                    return None
                return json.loads(row["response"])
    except Exception as e:
        logger.warning(f"Failed to read from LLM disk cache: {e}")
    return None

def set_cached_response(cache_key: str, response):
    """Store an LLM response to disk cache, evicting oldest entries past the cap."""
    now = datetime.now(timezone.utc).isoformat()
    try:
        with _get_cache_connection() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO llm_cache (cache_key, response, created_at) VALUES (?, ?, ?)",
                (cache_key, json.dumps(response, ensure_ascii=False), now)
            )
            conn.execute(
                "DELETE FROM llm_cache WHERE cache_key NOT IN "
                "(SELECT cache_key FROM llm_cache ORDER BY created_at DESC LIMIT ?)",
                (CACHE_MAX_ENTRIES,)
            )
            conn.commit()
    except Exception as e:
        logger.warning(f"Failed to write to LLM disk cache: {e}")

def clear_llm_cache():
    """Clear all entries in the LLM disk cache."""
    try:
        with _get_cache_connection() as conn:
            conn.execute("DELETE FROM llm_cache")
            conn.commit()
        logger.info("LLM disk cache cleared.")
    except Exception as e:
        logger.error(f"Failed to clear LLM disk cache: {e}")
