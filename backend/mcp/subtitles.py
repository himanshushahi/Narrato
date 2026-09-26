"""Subtitle inspection, audit, and repair utilities for the Narrato MCP server.

Provides tools for:
- Reading transcription segments and words cleanly (section-scoped or global).
- Comparing ground-truth script narration against Whisper transcription
  (detecting spelling/matra errors, number-to-digit conversions, missed words,
  truncated segment ends, and audio gaps).
- Updating/repairing transcription JSON and auto-syncing SRT and VTT subtitle files.
"""

import json
import re
import unicodedata
import difflib
from pathlib import Path

from backend.database import db as _db
from backend.core.logger import logger
from backend.mcp import payloads
from backend.pipeline.transcribe import export_srt, export_vtt


def clean_tokens(text: str) -> list[str]:
    """Tokenize text into words while strictly preserving complex scripts (CTL).
    
    Replaces Unicode punctuation (including Devanagari danda ।, double danda ॥,
    quotes, commas, hyphens) with spaces, keeping all Unicode matras and combining
    characters intact.
    """
    if not text:
        return []
    clean = "".join(" " if unicodedata.category(c).startswith("P") else c for c in text)
    return [w.strip() for w in clean.split() if w.strip()]


def strip_punct(w: str) -> tuple[str, str, str]:
    """Separate leading whitespace/punct, core word, and trailing punct/whitespace.
    
    Example: ' 1975,' -> (' ', '1975', ',')
             ' बदला,' -> (' ', 'बदला', ',')
    """
    if not w:
        return "", "", ""
    start_idx = 0
    while start_idx < len(w) and (w[start_idx].isspace() or unicodedata.category(w[start_idx]).startswith("P")):
        start_idx += 1
    end_idx = len(w)
    while end_idx > start_idx and (w[end_idx - 1].isspace() or unicodedata.category(w[end_idx - 1]).startswith("P")):
        end_idx -= 1
    prefix = w[:start_idx]
    core = w[start_idx:end_idx]
    suffix = w[end_idx:]
    return prefix, core, suffix


def _transcription_paths(project_id: str) -> tuple[Path, Path, Path, Path]:
    proj_dir = payloads._project_dir(project_id)
    sub_dir = proj_dir / "subtitles"
    sub_dir.mkdir(parents=True, exist_ok=True)
    json_path = sub_dir / "transcription.json"
    srt_path = sub_dir / "subtitles.srt"
    vtt_path = sub_dir / "subtitles.vtt"
    return proj_dir, json_path, srt_path, vtt_path


_COMMON_PARTICLES = frozenset((
    "है", "था", "थी", "थे", "का", "के", "की", "में", "से", "पर",
    "ने", "को", "तो", "भी", "यह", "वह", "और", "का", "एक",
    "अब", "सब", "जब", "तब", "कब", "घर", "दिन", "मन", "जन",
    "नाम", "काम", "रात", "बात", "हाथ", "साथ",
))

_HINDI_NUMBER_WORDS = frozenset((
    "शून्य", "एक", "दो", "तीन", "चार", "पाँच", "पाच", "छह", "छः",
    "सात", "आठ", "नौ", "दस", "ग्यारह", "बारह", "तेरह", "चौदह", "पंद्रह",
    "सोलह", "सत्रह", "अठारह", "उन्नीस", "बीस", "इक्कीस", "बाईस", "तेईस",
    "चौबीस", "पच्चीस", "छब्बीस", "सत्ताईस", "अट्ठाईस", "उनतीस", "तीस",
    "इकतीस", "बत्तीस", "तैंतीस", "चौंतीस", "पैंतीस", "छत्तीस", "सैंतीस",
    "अड़तीस", "उनतालीस", "चालीस", "इकतालीस", "बयालीस", "तैंतालीस",
    "चवालीस", "पैंतालीस", "छियालीस", "सैंतालीस", "अड़तालीस", "उनचास",
    "पचास", "इक्यावन", "बावन", "तिरपन", "चउवन", "पचपन", "छप्पन",
    "सत्तावन", "अट्ठावन", "उनसठ", "साठ", "इकसठ", "बासठ", "तिरसठ",
    "चौंठ", "चौंसठ", "पैंसठ", "छियासठ", "सड़सठ", "अट्ठसठ", "उनहत्तर",
    "सत्तर", "इकहत्तर", "बहत्तर", "तिहत्तर", "चौहत्तर", "पचहत्तर",
    "छिहत्तर", "सतहत्तर", "अट्ठहत्तर", "उन्यासी", "अस्सी", "इक्यासी",
    "बयासी", "तिरासी", "चौरासी", "पचासी", "छियासी", "सत्तासी", "अट्ठासी",
    "नवासी", "नब्बे", "इक्यानवे", "बानवे", "तिरानवे", "चौरानवे", "पचानवे",
    "छियानवे", "सत्तानवे", "अट्ठानवे", "निन्यानवे",
    "सौ", "हजार", "हज़ार", "लाख", "करोड़", "करोड",
))

_REPAIR_EPS = 1e-6


def _load_script_sections(proj_dir: Path) -> list[dict]:
    """Load canonical script sections in manifest order with tokenized words."""
    script_path = proj_dir / "script.json"
    if not script_path.exists():
        return []
    try:
        with open(script_path, "r", encoding="utf-8") as f:
            script = json.load(f)
    except Exception:
        return []
    sections: list[dict] = []
    if script.get("introduction"):
        intro = script["introduction"]
        text = intro.get("hook", "") or intro.get("narration", "")
        sections.append({
            "section_type": "introduction",
            "scene_index": None,
            "title": intro.get("title", "Introduction"),
            "text": text,
            "words": clean_tokens(text),
        })
    for idx, sc in enumerate(script.get("scenes", []) or []):
        if not isinstance(sc, dict):
            continue
        text = sc.get("narration", "") or ""
        sections.append({
            "section_type": "scene",
            "scene_index": idx,
            "title": sc.get("title", f"Scene {idx + 1}"),
            "text": text,
            "words": clean_tokens(text),
        })
    if script.get("conclusion"):
        conc = script["conclusion"]
        text = (conc.get("summary", "") or "")
        if conc.get("cta"):
            text = (text + " " + conc.get("cta")).strip()
        sections.append({
            "section_type": "conclusion",
            "scene_index": None,
            "title": conc.get("title", "Conclusion"),
            "text": text,
            "words": clean_tokens(text),
        })
    return sections


def _section_time_windows(proj, proj_dir: Path, sections: list[dict]) -> list[dict]:
    """Attach [start, end] audio windows from the voiceover manifest.

    Falls back to a single whole-audio window when no manifest exists.
    """
    windows: list[dict] = []
    manifest_path = payloads._active_manifest_path(proj, proj_dir)
    manifest: list = []
    if manifest_path and manifest_path.exists():
        try:
            with open(manifest_path, "r", encoding="utf-8") as f:
                loaded = json.load(f)
            if isinstance(loaded, list):
                manifest = loaded
        except Exception:
            manifest = []
    if manifest:
        cursor = 0.0
        for idx, sec in enumerate(sections):
            dur = 0.0
            if idx < len(manifest) and isinstance(manifest[idx], dict):
                try:
                    dur = float(manifest[idx].get("duration", 0) or 0)
                except (TypeError, ValueError):
                    dur = 0.0
            windows.append({**sec, "start": cursor, "end": cursor + dur, "duration": dur})
            cursor += dur
    else:
        for sec in sections:
            windows.append({**sec, "start": 0.0, "end": 0.0, "duration": 0.0})
    return windows


def _distribute_words(script_words: list[str], start: float, end: float,
                       leading_space: bool = True) -> list[dict]:
    """Create char-weighted word objects spanning [start, end].

    Matches the Whisper convention where every word after the first carries a
    leading space, so "".join(words) reconstructs readable text.
    """
    total = sum(len(w) for w in script_words) or 1
    duration = max(0.0, end - start)
    out: list[dict] = []
    cursor = start
    for i, w in enumerate(script_words):
        share = len(w) / total
        w_dur = share * duration
        token = w if i == 0 else " " + w
        if i == 0 and leading_space:
            # Fresh gap-fill segments start clean (no leading space on word 0).
            token = w
        out.append({"start": cursor, "end": cursor + w_dur, "word": token})
        cursor += w_dur
    # Guard float drift on the last word.
    if out:
        out[-1]["end"] = end
    return out


def _split_across_windows(missing: list[str],
                          windows_free: list[tuple[float, float]]) -> list[list[str]]:
    """Char-weighted split of missing words across free windows.

    Each word is placed exactly once, in order; windows with no share stay
    empty (callers skip them). Never duplicates words to fill windows.
    """
    alloc: list[list[str]] = [[] for _ in windows_free]
    if not missing or not windows_free:
        return alloc
    total_free = sum(ge - gs for gs, ge in windows_free)
    if total_free <= 0:
        alloc[0] = list(missing)
        return alloc
    total_chars = sum(len(w) for w in missing) or 1
    bounds: list[float] = []
    acc = 0.0
    for gs, ge in windows_free:
        acc += (ge - gs) / total_free
        bounds.append(acc)
    char_acc = 0.0
    wi = 0
    for w in missing:
        char_acc += len(w) / total_chars
        while wi < len(bounds) - 1 and char_acc > bounds[wi] + 1e-9:
            wi += 1
        alloc[wi].append(w)
    return alloc


def _sanitize_segments_input(segments: list) -> tuple[list[dict], str | None]:
    """Validate + normalize an agent-supplied segments list.

    Returns (sanitized, error). Sanitized segments are start-sorted with
    numeric timings, start < end, word timings coerced, and text rebuilt from
    words. Non-dict entries are dropped; an empty result or bad timings is an
    error (refuse to persist garbage that would break render).
    """
    clean: list[dict] = []
    for idx, s in enumerate(segments):
        if not isinstance(s, dict):
            continue
        try:
            start = float(s.get("start", 0))
            end = float(s.get("end", 0))
        except (TypeError, ValueError):
            return [], f"segments[{idx}]: start/end must be numeric."
        if not (end > start):
            return [], f"segments[{idx}]: require start < end (got {start}..{end})."
        words = s.get("words", []) or []
        norm_words: list[dict] = []
        for w in words:
            if not isinstance(w, dict):
                continue
            try:
                ws, we = float(w.get("start", start)), float(w.get("end", end))
            except (TypeError, ValueError):
                continue
            ws = min(max(ws, start), end)
            we = min(max(we, start), end)
            if we <= ws:
                continue
            norm_words.append({"start": ws, "end": we, "word": str(w.get("word", ""))})
        norm_words.sort(key=lambda w: (w["start"], w["end"]))
        try:
            seg_id = int(s.get("id", idx))
        except (TypeError, ValueError):
            seg_id = idx
        text = "".join(w.get("word", "") for w in norm_words).strip()
        clean.append({"id": seg_id, "start": start, "end": end,
                      "text": text or str(s.get("text", "")), "words": norm_words})
    if not clean:
        return [], "segments list contains no valid segment dictionaries."
    clean.sort(key=lambda s: (s["start"], s["end"]))
    for a, b in zip(clean, clean[1:]):
        if b["start"] < a["end"] - _REPAIR_EPS:
            return [], (f"segments overlap: id {a['id']} ends at {a['end']} "
                        f"but id {b['id']} starts at {b['start']}.")
    for new_id, s in enumerate(clean):
        s["id"] = new_id
    return clean, None


def _is_truncated_tail(raw_word: str, core: str) -> bool:
    """Detect a Whisper-truncated segment tail (30s cutoff fragments)."""
    if not raw_word:
        return False
    if "�" in raw_word or "\ufffd" in raw_word:
        return True
    return len(core) <= 2 and core not in _COMMON_PARTICLES


def _suggest_completion(core: str, script_words: list[str]) -> str | None:
    """Find the script word that a truncated tail most likely came from."""
    if not core or not script_words:
        return None
    # Prefer a longer script word sharing the truncated prefix.
    for sw in script_words:
        if len(sw) > len(core) and sw.startswith(core):
            return sw
    best: str | None = None
    best_ratio = 0.0
    for sw in script_words:
        ratio = difflib.SequenceMatcher(None, core, sw).ratio()
        if ratio > best_ratio:
            best_ratio = ratio
            best = sw
    if best is not None and best_ratio >= 0.6 and best != core:
        return best
    return None


def get_transcription_payload(
    project_id: str,
    section_type: str = "",
    scene_index: int = 0,
    segment_id: int | None = None,
    offset: int = 0,
    limit: int = 50,
) -> dict:
    """Read transcription data with optional section or segment filtering."""
    payloads._get_project_or_raise(project_id)
    proj = _db.get_project(project_id)
    proj_dir, json_path, _, _ = _transcription_paths(project_id)

    if not json_path.exists():
        return {
            "ok": False,
            "error": "transcription.json not found. Run run_stage(transcribe) first.",
        }

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    segments = data.get("segments") or []
    language = data.get("language", (proj or {}).get("language", "hi") if isinstance(proj, dict) else "hi")

    def _safe_float(v, default=0.0):
        try:
            return float(v)
        except (TypeError, ValueError):
            return default

    # Single segment request (coerce LLM string ids like "1").
    if segment_id is not None:
        try:
            want = int(segment_id)
        except (TypeError, ValueError):
            return {"ok": False, "error": f"Segment id {segment_id!r} is not a valid integer."}
        seg = None
        for s in segments:
            if not isinstance(s, dict):
                continue
            try:
                if int(s.get("id")) == want:
                    seg = s
                    break
            except (TypeError, ValueError):
                if s.get("id") == segment_id:
                    seg = s
                    break
        if seg is None:
            return {"ok": False, "error": f"Segment id {segment_id} not found."}
        return {"ok": True, "project_id": project_id, "segment": seg}

    # Section-scoped request
    if section_type:
        manifest_path = payloads._active_manifest_path(proj, proj_dir)
        if not manifest_path:
            return {"ok": False, "error": "Manifest not found to resolve section boundaries."}
        try:
            with open(manifest_path, "r", encoding="utf-8") as f:
                manifest = json.load(f)
            if not isinstance(manifest, list):
                raise ValueError("manifest is not a list")
        except Exception as e:
            return {"ok": False, "error": f"Could not read manifest: {e}"}

        cursor = 0.0
        sec_start = None
        sec_dur = None
        try:
            scene_index = int(scene_index)
        except (TypeError, ValueError):
            scene_index = 0
        scene_count = 0
        for entry in manifest:
            if not isinstance(entry, dict):
                continue
            try:
                dur = float(entry.get("duration", 0) or 0)
            except (TypeError, ValueError):
                dur = 0.0
            m_sec = entry.get("section_type")
            if section_type == "scene" and m_sec == "scene":
                if scene_count == scene_index:
                    sec_start = cursor
                    sec_dur = dur
                    break
                scene_count += 1
            elif section_type == m_sec:
                sec_start = cursor
                sec_dur = dur
                break
            cursor += dur

        if sec_start is None:
            return {
                "ok": False,
                "error": f"Section {section_type} (scene_index={scene_index}) not found in manifest.",
            }

        sec_end = sec_start + sec_dur
        matched_segments = []
        for s in segments:
            if not isinstance(s, dict):
                continue
            s_start = _safe_float(s.get("start", 0))
            s_end = _safe_float(s.get("end", 0))
            # Overlap condition
            if s_start < sec_end and s_end > sec_start:
                matched_segments.append(s)

        matched_words = []
        for s in matched_segments:
            for w in s.get("words", []) or []:
                if not isinstance(w, dict):
                    continue
                if sec_start <= _safe_float(w.get("start", 0)) < sec_end:
                    matched_words.append(w)

        return {
            "ok": True,
            "project_id": project_id,
            "section_type": section_type,
            "scene_index": scene_index if section_type == "scene" else None,
            "section_start": round(sec_start, 2),
            "section_end": round(sec_end, 2),
            "section_duration": round(sec_dur, 2),
            "total_section_segments": len(matched_segments),
            "total_section_words": len(matched_words),
            "segments": matched_segments,
            "words": matched_words,
        }

    # Paginated overview (clamp negatives: offset/limit < 0 would slice from end).
    try:
        offset = max(0, int(offset))
    except (TypeError, ValueError):
        offset = 0
    try:
        limit = max(0, int(limit))
    except (TypeError, ValueError):
        limit = 50
    total_segments = len(segments)
    total_words = sum(len(s.get("words", []) or []) for s in segments if isinstance(s, dict))
    paginated = segments[offset : offset + limit]

    return {
        "ok": True,
        "project_id": project_id,
        "language": language,
        "total_segments": total_segments,
        "total_words": total_words,
        "offset": offset,
        "limit": limit,
        "segments": paginated,
    }
