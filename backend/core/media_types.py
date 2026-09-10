"""Canonical media-type extension sets — single source of truth for the backend.

Mirrors frontend/src/utils/mediaExtensions.ts. Import these instead of
inlining extension tuples so bridge.py / assets.py / render.py stay in sync.
"""
from pathlib import Path

IMAGE_EXTS = frozenset({
    ".jpg", ".jpeg", ".jfif", ".png", ".webp", ".avif",
    ".gif", ".svg", ".bmp", ".ico", ".tif", ".tiff",
})

VIDEO_EXTS = frozenset({
    ".mp4", ".webm", ".mov", ".avi", ".mkv",
    ".m4v", ".ogv", ".flv", ".3gp",
})


def _clean_suffix(path) -> str:
    """Lowercased suffix with query/hash stripped. '' when no extension."""
    if not path:
        return ""
    s = str(path).split("?")[0].split("#")[0]
    return Path(s).suffix.lower()


def is_image_file(path) -> bool:
    return _clean_suffix(path) in IMAGE_EXTS


def is_video_file(path) -> bool:
    return _clean_suffix(path) in VIDEO_EXTS


def infer_media_type(path, declared_type: str) -> str:
    """Extension-based sniff; falls back to declared_type when unknown."""
    if is_video_file(path):
        return "Video"
    if is_image_file(path):
        return "Image"
    return declared_type
