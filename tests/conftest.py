import os
import tempfile
import pytest

# Keep the LLM disk cache out of the dev workspace during tests.
os.environ.setdefault("NARRATO_LLM_CACHE_DB", os.path.join(tempfile.gettempdir(), "narrato_test_llm_cache.db"))
# Prevent test runs from creating app_<pid>.log files in workspace logs/
os.environ.setdefault("NARRATO_NO_FILE_LOG", "1")

@pytest.fixture(scope="session", autouse=True)
def initialize_database():
    """Ensure the SQLite schema and default settings exist before tests run."""
    from backend.database.db import init_db
    init_db()
