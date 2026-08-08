import os
import tempfile

# Keep the LLM disk cache out of the dev workspace during tests.
os.environ.setdefault("NARRATO_LLM_CACHE_DB", os.path.join(tempfile.gettempdir(), "narrato_test_llm_cache.db"))
