import os
import tempfile

# Keep the LLM disk cache out of the dev workspace during tests.
os.environ.setdefault("NARRATO_LLM_CACHE_DB", os.path.join(tempfile.gettempdir(), "narrato_test_llm_cache.db"))
# Prevent test runs from creating app_<pid>.log files in workspace logs/
os.environ.setdefault("NARRATO_NO_FILE_LOG", "1")
