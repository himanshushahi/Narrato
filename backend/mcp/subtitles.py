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


def compare_transcription_payload(project_id: str) -> dict:
    """Compare ground-truth script narration against Whisper transcription.
    
    Identifies exact match rates, spelling/matra variations, number-to-digit
    mappings, omitted words, segment boundary truncations, and timing gaps.
    """
    payloads._get_project_or_raise(project_id)
    proj = _db.get_project(project_id)
    proj_dir, json_path, _, _ = _transcription_paths(project_id)

    if not json_path.exists():
        return {
            "ok": False,
            "error": "transcription.json not found. Run transcribe first.",
        }

    script_path = proj_dir / "script.json"
    if not script_path.exists():
        return {"ok": False, "error": "script.json not found."}

    with open(script_path, "r", encoding="utf-8") as f:
        script = json.load(f)
    with open(json_path, "r", encoding="utf-8") as f:
        trans = json.load(f)

    manifest_path = payloads._active_manifest_path(proj, proj_dir)
    manifest = []
    if manifest_path and manifest_path.exists():
        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = json.load(f)

    # 1. Collect all script sections
    script_sections = []
    if script.get("introduction"):
        intro = script["introduction"]
        script_sections.append({
            "section_type": "introduction",
            "title": intro.get("title", "Introduction"),
            "text": intro.get("hook", "") or intro.get("narration", ""),
        })
    for idx, sc in enumerate(script.get("scenes", [])):
        script_sections.append({
            "section_type": "scene",
            "scene_index": idx,
            "title": sc.get("title", f"Scene {idx + 1}"),
            "text": sc.get("narration", ""),
        })
    if script.get("conclusion"):
        conc = script["conclusion"]
        text = conc.get("summary", "")
        if conc.get("cta"):
            text = (text + " " + conc.get("cta")).strip()
        script_sections.append({
            "section_type": "conclusion",
            "title": conc.get("title", "Conclusion"),
            "text": text,
        })

    # 2. Extract words
    all_script_words: list[str] = []
    for sec in script_sections:
        words = clean_tokens(sec["text"])
        sec["words"] = words
        all_script_words.extend(words)

    segments = trans.get("segments") or []
    all_trans_words = []
    for s in segments:
        if not isinstance(s, dict):
            continue
        for w in s.get("words", []) or []:
            if not isinstance(w, dict):
                continue
            raw = str(w.get("word", ""))
            _, core, _ = strip_punct(raw)
            if core:
                try:
                    _ws, _we = float(w.get("start", 0)), float(w.get("end", 0))
                except (TypeError, ValueError):
                    _ws, _we = 0.0, 0.0
                all_trans_words.append({
                    "word": core,
                    "start": _ws,
                    "end": _we,
                    "segment_id": s.get("id"),
                })

    # Global word counts
    sw_count = len(all_script_words)
    tw_count = len(all_trans_words)

    # 3. Section-level alignment and discrepancy analysis
    cursor = 0.0
    section_reports = []
    spelling_variants: dict[str, dict] = {}
    number_conversions: dict[str, dict] = {}
    missing_words_counter: dict[str, int] = {}
    truncated_words: list[dict] = []

    # Map manifest durations to script_sections if available
    for idx, sec in enumerate(script_sections):
        sec_type = sec["section_type"]
        sec_sw = sec["words"]
        
        # Determine audio duration from manifest if available
        dur = 0.0
        if idx < len(manifest):
            dur = float(manifest[idx].get("duration", 0) or 0)

        if dur > 0:
            sec_tw_objs = [
                w for w in all_trans_words
                if cursor <= w["start"] < cursor + dur
            ]
        else:
            sec_tw_objs = all_trans_words

        sec_tw = [w["word"] for w in sec_tw_objs]

        # Use SequenceMatcher to find aligned chunks
        matcher = difflib.SequenceMatcher(None, sec_tw, sec_sw)
        sec_diffs = []
        for tag, i1, i2, j1, j2 in matcher.get_opcodes():
            if tag == "equal":
                continue
            t_chunk = sec_tw[i1:i2]
            s_chunk = sec_sw[j1:j2]
            sec_diffs.append({
                "type": tag,
                "transcript": t_chunk,
                "script": s_chunk,
            })

            # Detect spelling / matra variations. Short Hindi tokens collide
            # easily, so pairs of <=3 chars need ratio >= 0.75; longer pairs
            # use >= 0.5. Records 1:1 pairs plus the leading pair of 1:N
            # chunks (e.g. पड़ा -> पढ़ा when the rest of the tail dropped).
            if tag == "replace" and len(t_chunk) == 1 and len(s_chunk) >= 1:
                tw_word, sw_word = t_chunk[0], s_chunk[0]
                ratio = difflib.SequenceMatcher(None, tw_word, sw_word).ratio()
                min_ratio = 0.75 if max(len(tw_word), len(sw_word)) <= 3 else 0.5
                if min_ratio <= ratio < 1.0:
                        key = f"{tw_word}->{sw_word}"
                        if key not in spelling_variants:
                            spelling_variants[key] = {
                                "transcript": tw_word,
                                "script": sw_word,
                                "similarity": round(ratio, 2),
                                "count": 0,
                                "sections": [],
                            }
                        spelling_variants[key]["count"] += 1
                        if sec_type not in spelling_variants[key]["sections"]:
                            spelling_variants[key]["sections"].append(sec_type)

            # Detect number-to-digit conversions (e.g. ['1975'] <-> ['उन्नीस', 'सौ', 'पचहत्तर'])
            if tag == "replace" and any(re.search(r"\d", w) for w in t_chunk):
                digit_key = " ".join(t_chunk)
                if digit_key not in number_conversions:
                    number_conversions[digit_key] = {
                        "transcript_digits": t_chunk,
                        "script_words": s_chunk,
                        "section": sec_type,
                        "expandable": True,
                        "segment_ids": [],
                    }

        # Alignment-based hit rate: script words inside 'equal' blocks over all
        # script words (order- and multiplicity-aware, unlike set membership).
        sec_equal = 0
        for tag, _i1, _i2, j1, j2 in matcher.get_opcodes():
            if tag == "equal":
                sec_equal += (j2 - j1)
        sec_hit_rate = round((sec_equal / max(1, len(sec_sw))) * 100, 1)
        sec["equal_words"] = sec_equal

        section_reports.append({
            "section_type": sec_type,
            "scene_index": sec.get("scene_index"),
            "title": sec.get("title"),
            "script_words_count": len(sec_sw),
            "transcript_words_count": len(sec_tw),
            "match_rate_percent": sec_hit_rate,
            "discrepancies_count": len(sec_diffs),
            "diffs_sample": sec_diffs[:6],
        })
        cursor += dur

    # 4. Check for segment-end truncations (Whisper 30s cutoffs).
    # NOTE: fixed historic `"" in word` bug (empty string is contained in every
    # string, so it flagged ALL segments). Flags the Unicode replacement char,
    # suspiciously short non-particle tails, or a tail that is a strict prefix
    # of a script word but absent from the script vocab (e.g. "पाकि" for
    # "पाकिस्तान", "भ" for "भाषा"). Short-tail flags additionally require the
    # completion to be at least 2 chars longer, so valid short words (घर, दिन,
    # अब) are never rewritten.
    _script_set = set(all_script_words)
    for seg in segments:
        if not isinstance(seg, dict):
            continue
        seg_words = seg.get("words", []) or []
        if not seg_words:
            continue
        last_w_raw = str(seg_words[-1].get("word", ""))
        _, core, _ = strip_punct(last_w_raw)
        flagged = _is_truncated_tail(last_w_raw, core)
        completion = None
        if flagged or (core and len(core) >= 2 and core not in _script_set):
            completion = _suggest_completion(core, all_script_words)
            prefix_ok = bool(completion and completion.startswith(core)
                             and len(completion) >= len(core) + 2)
            if _is_truncated_tail(last_w_raw, core):
                # Short-tail flag is only trustworthy with a strong prefix
                # completion; otherwise it is a valid short word.
                flagged = prefix_ok or "�" in last_w_raw or "\ufffd" in last_w_raw
            else:
                flagged = prefix_ok
        if flagged:
            truncated_words.append({
                "segment_id": seg.get("id"),
                "end_time": seg.get("end"),
                "word": last_w_raw,
                "core": core,
                "suggested_completion": completion,
            })

    # Attach segment ids to each numeric conversion for targeted expansion.
    if number_conversions:
        for seg in segments:
            seg_id = seg.get("id")
            for w in seg.get("words", []) or []:
                _, core, _ = strip_punct(str(w.get("word", "")))
                if not core or not re.search(r"\d", core):
                    continue
                for conv in number_conversions.values():
                    if core in (conv.get("transcript_digits") or []):
                        if seg_id not in conv["segment_ids"]:
                            conv["segment_ids"].append(seg_id)

    # 5. Check for audio gaps between consecutive segments (>1.0s), enriched
    # with the script phrase most likely spoken inside the uncaptioned window.
    # Operates on a start-sorted copy: agent-supplied lists may be unsorted,
    # which would otherwise fabricate gaps.
    timing_gaps = []
    # Precompute per-section transcript vocab for gap enrichment.
    _gap_cursor = 0.0
    _section_vocab: list[tuple[float, float, str, list[str], list[str]]] = []
    for idx, sec in enumerate(script_sections):
        _dur = 0.0
        if idx < len(manifest) and isinstance(manifest[idx], dict):
            try:
                _dur = float(manifest[idx].get("duration", 0) or 0)
            except (TypeError, ValueError):
                _dur = 0.0
        if _dur > 0:
            _tw = [w["word"] for w in all_trans_words
                   if _gap_cursor <= w["start"] < _gap_cursor + _dur]
            _section_vocab.append((_gap_cursor, _gap_cursor + _dur,
                                  sec.get("section_type", ""), sec.get("words", []), _tw))
        _gap_cursor += _dur

    def _seg_start(s):
        try:
            return float(s.get("start", 0))
        except (TypeError, ValueError):
            return 0.0

    def _seg_end(s):
        try:
            return float(s.get("end", 0))
        except (TypeError, ValueError):
            return 0.0

    _ordered = sorted([s for s in segments if isinstance(s, dict)],
                      key=lambda s: (_seg_start(s), _seg_end(s)))
    for i in range(len(_ordered) - 1):
        gap = _seg_start(_ordered[i + 1]) - _seg_end(_ordered[i])
        if gap > 1.0:
            gap_start = _seg_end(_ordered[i])
            likely_phrase = ""
            gap_section = ""
            for _s, _e, _stype, _sw, _tw in _section_vocab:
                if _s <= gap_start < _e:
                    gap_section = _stype
                    _tw_set = set(_tw)
                    _missing = [w for w in _sw if w not in _tw_set][:24]
                    likely_phrase = " ".join(_missing)
                    break
            # Fallback when no manifest: global missing words in order.
            if not likely_phrase:
                _tw_set = {w["word"] for w in all_trans_words}
                likely_phrase = " ".join([w for w in all_script_words if w not in _tw_set][:24])
            timing_gaps.append({
                "after_segment_id": _ordered[i].get("id"),
                "gap_duration_seconds": round(gap, 2),
                "gap_start": _ordered[i].get("end"),
                "gap_end": _ordered[i + 1].get("start"),
                "likely_missing_phrase": likely_phrase,
                "section_type": gap_section,
            })

    # 6. Global missing words + alignment-based global hit rate (order- and
    # multiplicity-aware: per-section 'equal' script words over all script).
    trans_word_set = {w["word"] for w in all_trans_words}
    for w in all_script_words:
        if w not in trans_word_set:
            missing_words_counter[w] = missing_words_counter.get(w, 0) + 1

    top_missing = sorted(missing_words_counter.items(), key=lambda kv: kv[1], reverse=True)[:25]
    # Alignment-based global rate is only valid when sections partition the
    # timeline (manifest durations > 0). Without a manifest every section
    # compared against the FULL transcript, so per-section equals would double
    # count — fall back to a single global alignment instead.
    _has_windows = any(
        isinstance(manifest[i], dict) and float(manifest[i].get("duration", 0) or 0) > 0
        for i in range(min(len(manifest), len(script_sections)))
    ) if isinstance(manifest, list) else False
    if _has_windows:
        total_equal = sum(sec.get("equal_words", 0) for sec in script_sections)
        hit_rate = round((total_equal / max(1, sw_count)) * 100, 1)
    else:
        _gm = difflib.SequenceMatcher(
            None, [w["word"] for w in all_trans_words], all_script_words)
        _ge = sum(j2 - j1 for tag, _a, _b, j1, j2 in _gm.get_opcodes() if tag == "equal")
        hit_rate = round((_ge / max(1, sw_count)) * 100, 1)

    return {
        "ok": True,
        "project_id": project_id,
        "summary": {
            "total_script_words": sw_count,
            "total_transcript_words": tw_count,
            "exact_match_rate_percent": hit_rate,
            "spelling_variants_count": len(spelling_variants),
            "number_conversions_count": len(number_conversions),
            "truncated_segment_ends_count": len(truncated_words),
            "timing_gaps_count": len(timing_gaps),
        },
        "spelling_variants": list(spelling_variants.values()),
        "number_conversions": list(number_conversions.values()),
        "top_missing_words": [{"word": w, "count": c} for w, c in top_missing],
        "truncated_segment_ends": truncated_words,
        "timing_gaps": timing_gaps,
        "sections": section_reports,
        "auto_repair_recommended": len(spelling_variants) > 0 or len(truncated_words) > 0,
    }


def update_transcription_payload(
    project_id: str,
    replacements: list[dict] | None = None,
    segments: list[dict] | None = None,
    auto_align: bool = False,
    dry_run: bool = False,
    fill_gaps: bool = False,
    expand_numbers: bool = False,
    repair_truncations: bool = False,
) -> dict:
    """Update transcription.json and keep subtitles.srt and subtitles.vtt in sync.

    Supports:
    - Targeted replacements: [{"find": "भारतिय", "replace": "भारतीय"}, ...]
    - Scoped replacements: [{"segment_id": 1, "find": "भाशा", "replace": "भाषा"}]
    - Word-index replacements: [{"segment_id": 1, "word_index": 6, "replace": "भारतीय"}]
    - Full segments list replacement
    - auto_align=True: automatic healing using script.json canonical text
      (auto-enables fill_gaps, expand_numbers, and repair_truncations).
    - fill_gaps=True: interpolate missing script words across uncaptioned time
      windows (inter-segment gaps + trailing section slack) using
      character-weighted timing.
    - expand_numbers=True: split numeric tokens (e.g. "1975") into their Hindi
      script words ("उन्नीस सौ पचहत्तर") with proportional sub-timings.
    - repair_truncations=True: complete truncated segment tails
      (e.g. "पाकि" -> "पाकिस्तान").
    """
    payloads._get_project_or_raise(project_id)
    proj = _db.get_project(project_id)
    proj_dir, json_path, srt_path, vtt_path = _transcription_paths(project_id)

    if not json_path.exists():
        return {
            "ok": False,
            "error": "transcription.json not found. Run transcribe first.",
        }

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    current_segments = data.get("segments") or []
    replacements_applied = 0
    updated_segments_count = 0
    gaps_filled = 0
    numbers_expanded = 0
    truncations_repaired = 0
    warnings: list[str] = []

    # auto_align enables the full lossless repair suite.
    if auto_align:
        fill_gaps = True
        expand_numbers = True
        repair_truncations = True

    # 1. Full replacement if segments array passed (validated: agent-supplied
    # timings must be numeric, ordered, non-overlapping with start < end, and
    # text is rebuilt from words so SRT/VTT never desync).
    if segments is not None:
        if not isinstance(segments, list):
            return {"ok": False, "error": "segments must be a list of segment dictionaries."}
        sanitized, seg_error = _sanitize_segments_input(segments)
        if seg_error:
            return {"ok": False, "error": seg_error}
        current_segments = sanitized
        updated_segments_count = len(sanitized)

    # 2. Auto-align with script if requested
    comp = None
    if auto_align:
        comp = compare_transcription_payload(project_id)
        if comp.get("ok"):
            auto_rules = []
            for item in comp.get("spelling_variants", []):
                auto_rules.append({
                    "find": item["transcript"],
                    "replace": item["script"],
                })
            replacements = (replacements or []) + auto_rules

    # 3. Apply targeted replacements. Text is rebuilt from words only (never a
    # raw substring replace, which would corrupt larger words containing the
    # find string). Rules with a missing/empty replace are skipped instead of
    # writing literal "None" into the transcript.
    if replacements:
        for rule in replacements:
            if not isinstance(rule, dict):
                continue
            find_str = rule.get("find")
            replace_str = rule.get("replace")
            target_seg_id = rule.get("segment_id")
            target_word_idx = rule.get("word_index")
            if target_seg_id is not None:
                try:
                    target_seg_id = int(target_seg_id)
                except (TypeError, ValueError):
                    continue
            if target_word_idx is not None:
                try:
                    target_word_idx = int(target_word_idx)
                except (TypeError, ValueError):
                    continue

            for seg in current_segments:
                if not isinstance(seg, dict):
                    continue
                try:
                    seg_id = int(seg.get("id"))
                except (TypeError, ValueError):
                    seg_id = seg.get("id")
                if target_seg_id is not None and seg_id != target_seg_id:
                    continue

                seg_words = seg.get("words", []) or []
                seg_modified = False

                # Exact word-index replacement
                if target_word_idx is not None and 0 <= target_word_idx < len(seg_words):
                    if not isinstance(replace_str, str) or not replace_str.strip():
                        continue
                    w_obj = seg_words[target_word_idx]
                    old_raw = str(w_obj.get("word", ""))
                    prefix, _, suffix = strip_punct(old_raw)
                    w_obj["word"] = prefix + replace_str + suffix
                    seg_modified = True
                    replacements_applied += 1
                elif isinstance(find_str, str) and find_str:
                    if not isinstance(replace_str, str) or not replace_str:
                        continue
                    # Search and replace in words (exact core match only)
                    for w_obj in seg_words:
                        raw_w = str(w_obj.get("word", ""))
                        prefix, core, suffix = strip_punct(raw_w)
                        if core == find_str:
                            w_obj["word"] = prefix + replace_str + suffix
                            seg_modified = True
                            replacements_applied += 1

                if seg_modified:
                    # Reconstruct segment text from words to guarantee sync
                    new_text = "".join(w.get("word", "") for w in seg_words).strip()
                    if new_text:
                        seg["text"] = new_text
                    updated_segments_count += 1

    # 4. Truncation healing: complete cut-off tails from canonical script.
    # Confidence-gated: only heal when the completion is a strict prefix
    # extension at least 2 chars longer (valid short words like घर/दिन/अब are
    # never rewritten). Short-tail flags without such a completion are left
    # alone.
    if repair_truncations:
        try:
            _sections = _load_script_sections(proj_dir)
            _all_script = [w for s in _sections for w in s.get("words", [])]
            _script_set = set(_all_script)
            for seg in current_segments:
                if not isinstance(seg, dict):
                    continue
                seg_words = seg.get("words", []) or []
                if not seg_words or not isinstance(seg_words[-1], dict):
                    continue
                last = seg_words[-1]
                raw = str(last.get("word", ""))
                prefix, core, suffix = strip_punct(raw)
                if not core or core in _script_set:
                    # Already a valid script word — never "heal" it. (Short
                    # non-particle tails like घर/दिन/अब land here.)
                    if not ("�" in raw or "\ufffd" in raw):
                        continue
                needs_heal = _is_truncated_tail(raw, core)
                if not needs_heal and core and len(core) >= 2 and core not in _script_set:
                    needs_heal = any(len(sw) > len(core) and sw.startswith(core)
                                     for sw in _script_set)
                if needs_heal:
                    completion = _suggest_completion(core, _all_script)
                    if (completion and completion != core
                            and completion.startswith(core)
                            and len(completion) >= len(core) + 2):
                        last["word"] = prefix + completion + suffix
                        seg["text"] = "".join(
                            str(w.get("word", "")) for w in seg_words).strip()
                        truncations_repaired += 1
                        replacements_applied += 1
                        updated_segments_count += 1
        except Exception as e:
            logger.warning(f"Truncation repair failed: {e}")

    # 5. Number expansion: "1975" [0.5s,1.2s] -> "उन्नीस","सौ","पचहत्तर".
    # The digit map is aligned from the CURRENT in-memory segments (after
    # spelling/truncation fixes), never from the stale pre-fix compare, and
    # expansion is scoped per segment: a digit token repeated across sections
    # with different meanings expands using its own section's mapping.
    if expand_numbers:
        try:
            _sections = _load_script_sections(proj_dir)
            _windows = _section_time_windows(proj, proj_dir, _sections)
            _digit_entries: list[dict] = []  # {token, seq, seg_ids}
            for win in _windows:
                ws, we = float(win.get("start", 0)), float(win.get("end", 0))
                if we <= ws:
                    continue
                script_words = win.get("words", []) or []
                if not script_words:
                    continue
                win_segs = [s for s in current_segments if isinstance(s, dict)
                            and float(s.get("start", 0)) < we and float(s.get("end", 0)) > ws]
                win_cores: list[str] = []
                win_seg_of_token: list = []
                for s in win_segs:
                    for w in s.get("words", []) or []:
                        if not isinstance(w, dict):
                            continue
                        try:
                            _t = float(w.get("start", 0))
                        except (TypeError, ValueError):
                            continue
                        if not (ws - _REPAIR_EPS <= _t < we - _REPAIR_EPS):
                            continue
                        _, _c, _ = strip_punct(str(w.get("word", "")))
                        win_cores.append(_c)
                        win_seg_of_token.append(s.get("id"))
                _m = difflib.SequenceMatcher(None, win_cores, script_words)
                for tag, _a1, _a2, _b1, _b2 in _m.get_opcodes():
                    if tag != "replace":
                        continue
                    t_chunk, s_chunk = win_cores[_a1:_a2], script_words[_b1:_b2]
                    if not any(re.search(r"\d", w) for w in t_chunk):
                        continue
                    seq = list(s_chunk)
                    toks = [t for t in t_chunk if re.search(r"\d", t)]
                    if len(seq) > 6:
                        if len(toks) != 1:
                            continue
                        run = [w for w in seq if w in _HINDI_NUMBER_WORDS]
                        # Leading run only: stop at first non-number word.
                        run = run if seq[:len(run)] == run else []
                        if not run:
                            continue
                        seq = run
                    involved = {win_seg_of_token[k] for k in range(_a1, _a2)}
                    for tok in toks:
                        _digit_entries.append(
                            {"token": tok, "seq": list(seq), "seg_ids": set(involved)})
            for seg in current_segments:
                if not isinstance(seg, dict):
                    continue
                seg_words = seg.get("words", []) or []
                new_words: list[dict] = []
                seg_changed = False
                for w_obj in seg_words:
                    if not isinstance(w_obj, dict):
                        continue
                    raw = str(w_obj.get("word", ""))
                    prefix, core, suffix = strip_punct(raw)
                    seq = None
                    if core and re.search(r"\d", core):
                        # Prefer an entry covering THIS segment; fall back to a
                        # globally-unique mapping only.
                        local = [e for e in _digit_entries
                                 if e["token"] == core and seg.get("id") in e["seg_ids"]]
                        if len(local) == 1:
                            seq = local[0]["seq"]
                        else:
                            glob = [e for e in _digit_entries if e["token"] == core]
                            uniq = {tuple(e["seq"]) for e in glob}
                            if len(uniq) == 1 and glob:
                                seq = glob[0]["seq"]
                    if not seq:
                        new_words.append(w_obj)
                        continue
                    try:
                        w_start = float(w_obj.get("start", 0))
                        w_end = float(w_obj.get("end", w_start))
                    except (TypeError, ValueError):
                        new_words.append(w_obj)
                        continue
                    if w_end <= w_start:
                        new_words.append(w_obj)
                        continue
                    total_chars = sum(len(w) for w in seq) or 1
                    cursor = w_start
                    # Preserve leading-space/punct convention: first word keeps
                    # the original prefix, last word keeps the suffix.
                    for k, sw in enumerate(seq):
                        share = len(sw) / total_chars
                        dur = (w_end - w_start) * share
                        if k == 0:
                            token = prefix + sw
                        else:
                            token = " " + sw
                        if k == len(seq) - 1:
                            token = token + suffix
                        new_words.append({"start": cursor, "end": cursor + dur, "word": token})
                        cursor += dur
                    new_words[-len(seq)]["start"] = w_start
                    new_words[-1]["end"] = w_end
                    numbers_expanded += 1
                    replacements_applied += 1
                    seg_changed = True
                if seg_changed:
                    seg["words"] = new_words
                    seg["text"] = "".join(
                        str(w.get("word", "")) for w in new_words).strip()
                    updated_segments_count += 1
        except Exception as e:
            logger.warning(f"Number expansion failed: {e}")

    # 6. Gap filling: interpolate missing script words across empty windows.
    if fill_gaps:
        try:
            _sections = _load_script_sections(proj_dir)
            _windows = _section_time_windows(proj, proj_dir, _sections)
            # Only sections with a real manifest duration can anchor interpolation.
            _windows = [w for w in _windows if float(w.get("duration", 0) or 0) > 0]
            if not _windows:
                warnings.append(
                    "fill_gaps requested but no voiceover manifest durations found; "
                    "custom-audio projects without manifest.json cannot be gap-filled.")
            else:
                def _skey(s):
                    try:
                        return (float(s.get("start", 0)), float(s.get("end", 0)))
                    except (TypeError, ValueError):
                        return (0.0, 0.0)

                def _wkey(w):
                    try:
                        return (float(w.get("start", 0)), float(w.get("end", 0)))
                    except (TypeError, ValueError):
                        return (0.0, 0.0)

                current_segments.sort(key=_skey)
                _ids = []
                for s in current_segments:
                    try:
                        _ids.append(int(s.get("id", 0)))
                    except (TypeError, ValueError):
                        continue
                next_id = max(_ids + [0]) + 1
                fresh: list[dict] = []
                for win in _windows:
                    ws, we = float(win["start"]), float(win["end"])
                    script_words = win.get("words", []) or []
                    if not script_words:
                        continue
                    in_words = []
                    for s in current_segments:
                        if not isinstance(s, dict):
                            continue
                        for w in s.get("words", []) or []:
                            if not isinstance(w, dict):
                                continue
                            try:
                                _t = float(w.get("start", 0))
                            except (TypeError, ValueError):
                                continue
                            if ws - _REPAIR_EPS <= _t < we - _REPAIR_EPS:
                                in_words.append(w)
                    in_cores = [strip_punct(str(w.get("word", "")))[1] for w in in_words]
                    matcher = difflib.SequenceMatcher(None, in_cores, script_words)
                    missing: list[str] = []
                    for tag, _i1, _i2, j1, j2 in matcher.get_opcodes():
                        # a=transcript, b=script: 'insert' = script-only words
                        # (the dropouts we must fill); 'delete' = extra
                        # transcript words (hallucinations, left alone).
                        if tag == "insert":
                            missing.extend(script_words[j1:j2])
                        elif tag == "replace":
                            # Transcript chunk differs. A close 1:1 pair is a
                            # spelling/matra variant (healed separately) — not a
                            # dropout. For 1:N chunks, the first script word may
                            # still be the variant counterpart (e.g. पड़ा/पढ़ा):
                            # skip it and fill only the genuine remainder.
                            # Short tokens need ratio >= 0.75 (same gate as the
                            # audit) to avoid skipping real dropouts.
                            _gate = 0.75 if max(len(in_cores[_i1]), len(script_words[j1])) <= 3 else 0.5
                            if _i2 - _i1 >= 1 and j2 - j1 >= 1 and difflib.SequenceMatcher(
                                    None, in_cores[_i1], script_words[j1]).ratio() >= _gate:
                                if _i2 - _i1 == 1 and j2 - j1 == 1:
                                    continue
                                missing.extend(script_words[j1 + 1:j2])
                            else:
                                missing.extend(script_words[j1:j2])
                    if not missing:
                        continue
                    # Candidate empty windows inside this section.
                    try:
                        segs_in = sorted(
                            [s for s in current_segments if isinstance(s, dict)
                             and float(s.get("start", 0)) < we and float(s.get("end", 0)) > ws],
                            key=_skey,
                        )
                    except (TypeError, ValueError):
                        continue
                    windows_free: list[tuple[float, float]] = []
                    if not segs_in:
                        windows_free.append((ws, we))
                    else:
                        try:
                            first_start = float(segs_in[0].get("start", ws))
                        except (TypeError, ValueError):
                            first_start = ws
                        if first_start - ws > 0.2:
                            windows_free.append((ws, first_start))
                        for a, b in zip(segs_in, segs_in[1:]):
                            try:
                                gs, ge = float(a.get("end", 0)), float(b.get("start", 0))
                            except (TypeError, ValueError):
                                continue
                            gs = max(gs, ws)
                            ge = min(ge, we)
                            if ge - gs > 0.2:
                                windows_free.append((gs, ge))
                        try:
                            last_end = float(segs_in[-1].get("end", we))
                        except (TypeError, ValueError):
                            last_end = we
                        if we - last_end > 0.2:
                            windows_free.append((last_end, we))
                    if not windows_free:
                        # Collapsed case (e.g. 15s on a single 'भ'): the window
                        # is fully covered yet words are missing, so the
                        # sparsest segment is garbage. Fill the micro-gaps
                        # between its surviving words; if there is no free
                        # time at all, REPLACE its words with the missing run
                        # (never extend — extending stacks two words at
                        # identical timestamps and duplicates SRT text).
                        try:
                            segs_in.sort(key=lambda s: len(s.get("words", []) or []) /
                                         max(0.1, float(s.get("end", 0)) - float(s.get("start", 0))))
                        except (TypeError, ValueError):
                            pass
                        target = segs_in[0]
                        try:
                            ts, te = float(target.get("start", ws)), float(target.get("end", we))
                        except (TypeError, ValueError):
                            continue
                        occupied = []
                        for w in target.get("words", []) or []:
                            if not isinstance(w, dict):
                                continue
                            try:
                                occupied.append((float(w.get("start", ts)), float(w.get("end", ts))))
                            except (TypeError, ValueError):
                                continue
                        occupied.sort()
                        micro: list[tuple[float, float]] = []
                        edge = ts
                        for os_, oe in occupied:
                            if os_ - edge > 0.05:
                                micro.append((edge, os_))
                            edge = max(edge, oe)
                        if te - edge > 0.05:
                            micro.append((edge, te))
                        if sum(ge - gs for gs, ge in micro) > 0.2:
                            for (gs, ge), chunk in zip(
                                    micro, _split_across_windows(missing, micro)):
                                if not chunk:
                                    continue
                                extra = _distribute_words(chunk, gs, ge)
                                target.setdefault("words", []).extend(extra)
                            target["words"].sort(key=_wkey)
                            target["text"] = "".join(
                                str(w.get("word", "")) for w in target["words"]).strip()
                        else:
                            target["words"] = _distribute_words(missing, ts, te)
                            target["text"] = "".join(
                                str(w.get("word", "")) for w in target["words"]).strip()
                        gaps_filled += 1
                        updated_segments_count += 1
                        continue
                    # Allocate missing words across windows weighted by duration
                    # (words are placed once; empty windows stay empty).
                    alloc = _split_across_windows(missing, windows_free)
                    for (gs, ge), chunk in zip(windows_free, alloc):
                        if not chunk:
                            continue
                        words = _distribute_words(chunk, gs, ge)
                        fresh.append({
                            "id": next_id,
                            "start": gs,
                            "end": ge,
                            "text": " ".join(chunk),
                            "words": words,
                        })
                        next_id += 1
                        gaps_filled += 1
                if fresh:
                    current_segments.extend(fresh)
                    current_segments.sort(key=_skey)
                    updated_segments_count += len(fresh)
        except Exception as e:
            logger.warning(f"Gap filling failed: {e}")

    # 7. Save to disk unless dry_run
    files_written = []
    if not dry_run:
        data["segments"] = current_segments
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        files_written.append(str(json_path.name))

        # Re-export SRT and VTT
        try:
            export_srt(current_segments, str(srt_path))
            files_written.append(str(srt_path.name))
            export_vtt(current_segments, str(vtt_path))
            files_written.append(str(vtt_path.name))
        except Exception as e:
            logger.warning(f"Could not re-export SRT/VTT: {e}")

    return {
        "ok": True,
        "project_id": project_id,
        "dry_run": dry_run,
        "replacements_applied": replacements_applied,
        "segments_updated": updated_segments_count,
        "total_segments": len(current_segments),
        "gaps_filled": gaps_filled,
        "numbers_expanded": numbers_expanded,
        "truncations_repaired": truncations_repaired,
        "warnings": warnings,
        "files_written": files_written if not dry_run else [],
    }
