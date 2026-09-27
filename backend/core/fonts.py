"""Shared Google-Font helpers: download, locate, and inline-embed fonts.

Single source of truth for the language → Noto family map (mirrored in
frontend complexScriptFonts.ts and backend/pipeline/ai.py — keep in sync).

Two consumption paths:
- Preview (editor document): <link> to the on-disk css file served by the
  local file server (see bridge.download_google_font).
- Headless export: the bundle page never sees the editor's injected <link>
  tags, so render embeds fonts as data: URIs via build_inline_font_css()
  and the composition injects a <style> gated on document.fonts.ready.
"""
import base64
import mimetypes
import re
import urllib.parse
import urllib.request
from pathlib import Path

from backend.core.config import get_fonts_dir
from backend.core.logger import logger

# Language-to-Noto-font mapping for complex scripts. Keep in sync with
# frontend/src/components/video/complexScriptFonts.ts and backend/pipeline/ai.py.
NOTO_FONT_MAP = {
    "hi": "Noto Sans Devanagari",
    "mr": "Noto Sans Devanagari",
    "bn": "Noto Sans Bengali",
    "ta": "Noto Sans Tamil",
    "te": "Noto Sans Telugu",
    "ar": "Noto Sans Arabic",
    "th": "Noto Sans Thai",
    "gu": "Noto Sans Gujarati",
    "pa": "Noto Sans Gurmukhi",
    "ml": "Noto Sans Malayalam",
    "kn": "Noto Sans Kannada",
}

_URL_RE = re.compile(r"url\((https?://[^)]+|/[^)]+|[^)]+)\)")


def _safe_name(font_family: str) -> str:
    return font_family.replace(" ", "")


def get_font_css_path(font_family: str) -> Path | None:
    """Disk path of the downloaded css for a family, or None if absent."""
    safe = _safe_name(font_family)
    css_file = get_fonts_dir() / safe / f"{safe}.css"
    return css_file if css_file.exists() else None


def ensure_google_font_css(font_family: str, url_rewriter=None) -> tuple[Path | None, str | None]:
    """Download a Google Font's css + woff2 files to the local fonts dir.

    url_rewriter(remote_url, local_path) -> str optionally rewrites the
    url(...) references inside the css (e.g. to local file-server URLs);
    without it the css keeps pointing at the downloaded files relatively.
    Returns (css disk path, error): on success (path, None); on failure
    (None, reason). Never raises.

    Cached css is re-rewritten on every hit when a url_rewriter is given:
    previously baked file-server URLs contain the port from first download,
    which goes stale after an app restart with a different port.
    """
    try:
        fonts_dir = get_fonts_dir()
        safe = _safe_name(font_family)
        font_dir = fonts_dir / safe
        font_dir.mkdir(parents=True, exist_ok=True)
        css_file = font_dir / f"{safe}.css"
        if css_file.exists():
            if url_rewriter:
                _refresh_css_urls(css_file, url_rewriter)
            return css_file, None
        url_family = font_family.replace(" ", "+")
        ua = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
        css_content = None
        for css_url in (
            f"https://fonts.googleapis.com/css2?family={url_family}:wght@400;700;800;900&display=swap",
            f"https://fonts.googleapis.com/css2?family={url_family}&display=swap",
        ):
            req = urllib.request.Request(css_url, headers=ua)
            with urllib.request.urlopen(req, timeout=10) as response:
                css_content = response.read().decode("utf-8")
            if re.findall(r"url\((https://[^)]+)\)", css_content):
                break
        if not css_content:
            return None, f"No css returned for {font_family}"
        for font_url in set(re.findall(r"url\((https://[^)]+)\)", css_content)):
            font_filename = font_url.split("/")[-1]
            local_font_path = font_dir / font_filename
            if not local_font_path.exists():
                logger.info(f"Downloading font file: {font_filename} to {font_dir}")
                urllib.request.urlretrieve(font_url, local_font_path)
            replacement = (
                url_rewriter(font_url, local_font_path)
                if url_rewriter
                else local_font_path.name
            )
            css_content = css_content.replace(font_url, replacement)
        css_file.write_text(css_content, encoding="utf-8")
        return css_file, None
    except Exception as e:
        logger.error(f"Failed to download font {font_family}: {e}")
        return None, str(e)


def _refresh_css_urls(css_file: Path, url_rewriter) -> None:
    """Re-resolve every url(...) in a cached css back to disk and rewrite it.

    Best-effort: unresolvable references are left untouched, failures are
    swallowed (preview falls back to system fonts, same as before).
    """
    try:
        css_text = css_file.read_text(encoding="utf-8")

        def _rewrite(m: "re.Match") -> str:
            disk = _resolve_css_url_to_file(m.group(1), css_file)
            if not disk:
                return m.group(0)
            try:
                return f"url({url_rewriter(m.group(1), disk)})"
            except Exception:
                return m.group(0)

        css_file.write_text(_URL_RE.sub(_rewrite, css_text), encoding="utf-8")
    except OSError:
        pass


def _resolve_css_url_to_file(raw_url: str, css_file: Path) -> Path | None:
    """Map a url(...) reference from a downloaded css back to a disk file."""
    raw = raw_url.strip().strip("\"'")
    if "path=" in raw:
        # Local file-server URL baked at download time:
        # /api/media?path=<quoted> or http://localhost:PORT/api/media?path=<quoted>
        try:
            qs = urllib.parse.urlparse(raw).query
            disk = urllib.parse.unquote(urllib.parse.parse_qs(qs).get("path", [""])[0])
            p = Path(disk)
            return p if p.exists() else None
        except Exception:
            return None
    if "://" in raw:
        return None  # remote URL — leave untouched
    p = (css_file.parent / raw).resolve()
    return p if p.exists() else None


def build_inline_font_css(families, max_bytes: int = 8 * 1024 * 1024) -> str:
    """Concatenate on-disk css for families, embedding font files as data: URIs.

    Produces a self-contained stylesheet with no external fetches — safe for
    headless Chromium export (no ports, no MIME-type, no network issues).
    Best-effort: missing families are skipped, output capped at max_bytes.
    """
    chunks: list[str] = []
    total = 0
    for family in dict.fromkeys(f for f in (families or []) if f):
        css_file = get_font_css_path(str(family))
        if not css_file:
            css_file, _err = ensure_google_font_css(str(family))
        if not css_file:
            continue
        try:
            css_text = css_file.read_text(encoding="utf-8")
        except OSError:
            continue

        def _embed(m: "re.Match") -> str:
            disk = _resolve_css_url_to_file(m.group(1), css_file)
            if not disk:
                return m.group(0)
            try:
                mime, _ = mimetypes.guess_type(str(disk))
                if mime is None:
                    mime = "font/woff2" if disk.suffix == ".woff2" else "application/octet-stream"
                data = base64.b64encode(disk.read_bytes()).decode("ascii")
                return f"url(data:{mime};base64,{data})"
            except OSError:
                return m.group(0)

        inlined = _URL_RE.sub(_embed, css_text)
        total += len(inlined)
        if total > max_bytes:
            logger.warning("build_inline_font_css: capped at max_bytes, some families dropped")
            break
        chunks.append(f"/* inline:{family} */\n{inlined}")
    return "\n".join(chunks)
