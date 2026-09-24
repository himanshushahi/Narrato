"""Web search module for retrieving real-time context during script generation.

Integrates with LangSearch Web Search API (https://docs.langsearch.com/api/web-search-api).
Search failures are non-fatal — return empty string so script generation can proceed.
"""

import re
from datetime import datetime

from backend.core.logger import logger

LANGSEARCH_ENDPOINT = "https://api.langsearch.com/v1/web-search"
USER_AGENT = "Narrato/1.0 (Video Generation System)"


def clean_search_query(raw_query: str) -> str:
    """Strip non-Latin script text from a search query.

    Many video titles contain Hindi/Devanagari text (e.g. "FIFA 2026 (हिन्दी) तीन मेजबान...").
    Web search APIs perform poorly with mixed-script queries, so we extract only the
    Latin-script portion for searching.

    Returns the cleaned English-only query string.
    """
    # Remove parenthesized language markers like "(हिन्दी)", "(Hindi)", etc.
    cleaned = re.sub(r'\([^)]*[ऀ-ॿ][^)]*\)', '', raw_query)
    # Remove any remaining Devanagari characters and everything after them on the same line
    cleaned = re.sub(r'[ऀ-ॿ].*$', '', cleaned)
    # Collapse whitespace and trim
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    # If cleaning removed everything useful, fall back to the first 100 chars of raw
    if len(cleaned) < 5:
        cleaned = re.sub(r'[ऀ-ॿ].*$', '', raw_query).strip()
        cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    # Ultimate fallback: just take first 200 chars of raw query
    if len(cleaned) < 5:
        cleaned = raw_query[:200]
    return cleaned


def search_web(
    query: str,
    api_key: str,
    count: int = 5,
    freshness: str = "noLimit",
    summary: bool = True,
) -> list[dict]:
    """Search the web via LangSearch API.

    Returns a list of result dicts: [{title, url, snippet, summary}, ...]
    Returns empty list on any failure.
    """
    import requests

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
    }
    payload = {
        "query": query,
        "count": min(count, 10),  # LangSearch max is 10
        "freshness": freshness,
        "summary": summary,
    }

    try:
        resp = requests.post(
            LANGSEARCH_ENDPOINT,
            headers=headers,
            json=payload,
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()

        web_pages = data.get("data", {}).get("webPages", {})
        results = web_pages.get("value", [])

        parsed = []
        for item in results:
            parsed.append({
                "title": item.get("name", ""),
                "url": item.get("url", ""),
                "snippet": item.get("snippet", ""),
                "summary": item.get("summary", ""),
            })
        return parsed

    except requests.exceptions.Timeout:
        logger.warning(f"LangSearch request timed out after 15s for query: {query[:60]}")
    except requests.exceptions.HTTPError as e:
        status = e.response.status_code if e.response is not None else "unknown"
        detail = ""
        if e.response is not None:
            try:
                detail = e.response.text[:200]
            except Exception:
                pass
        if status == 401:
            logger.warning(f"LangSearch returned 401 (invalid API key). Check your key in settings.")
        elif status == 429:
            logger.warning(f"LangSearch rate limited (429). Consider reducing search frequency.")
        else:
            logger.warning(f"LangSearch HTTP {status} for query '{query[:60]}': {detail}")
    except requests.exceptions.ConnectionError:
        logger.warning(f"LangSearch connection failed (network error) for query: {query[:60]}")
    except Exception as e:
        logger.warning(f"LangSearch unexpected error ({type(e).__name__}): {e}")

    return []


def format_search_results(results: list[dict], query: str) -> str:
    """Format search results as a markdown block for prompt injection.

    Returns empty string if there are no results.
    """
    if not results:
        return ""

    today = datetime.now().strftime("%B %d, %Y")
    lines = [
        f"## Web Search: \"{query}\"",
        f"Current information retrieved on {today}:",
        "",
    ]

    for i, r in enumerate(results, 1):
        title = r.get("title", "Untitled")
        url = r.get("url", "")
        snippet = r.get("snippet", "")
        lines.append(f"{i}. [{title}]({url})")
        if snippet:
            lines.append(f"   {snippet}")
        lines.append("")

    lines.append("---")
    return "\n".join(lines)


def search_and_format(
    query: str,
    api_key: str,
    count: int = 5,
    freshness: str = "noLimit",
) -> str:
    """Convenience: search then format. Returns formatted string (or empty on failure)."""
    results = search_web(query, api_key, count=count, freshness=freshness)
    return format_search_results(results, query)
