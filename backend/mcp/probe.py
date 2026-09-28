"""Phase 3: probe tools — read-only visibility per cut/scene/asset.

Shared by MCP (dict results) and the internal LLM (JSON-string results).
Never mutates pipeline state, never hits network. Answers the questions
agents previously guessed at: what box did my layer get, does its delay fit,
did its query download, which file is actually on disk.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

from backend.core.logger import logger
from backend.mcp import payloads
from backend.mcp.payloads import (
    SECTION_TYPES, _active_manifest_path, _current_section_cuts,
    _get_project_or_raise, _project_dir, resolve_scene_and_cut,
    format_display_label, _normalize_section_type,
)


def _coerce_index(name: str, value: Any) -> tuple[int | None, dict | None]:
    """Coerce an LLM-supplied index to int. Returns (value, error|None)."""
    if isinstance(value, bool):
        return None, {"ok": False, "error": f"{name} must be an integer."}
    try:
        coerced = int(value)
    except (TypeError, ValueError):
        return None, {"ok": False, "error": f"{name} must be an integer."}
    try:
        if float(value) != coerced:
            return None, {"ok": False, "error": f"{name} must be an integer."}
    except (TypeError, ValueError):
        return None, {"ok": False, "error": f"{name} must be an integer."}
    return coerced, None


def _resolve_cuts(project_id: str, section_type: str,
                  scene_index: int | None = 0,
                  scene_number: int | None = None) -> tuple:
    """Returns (proj, proj_dir, cuts, manifest_duration, error_dict|None).

    manifest_duration is the TRUE audio length of the section (for variety
    drift checks); None when no manifest entry matched.
    """
    norm_sec, scene_index, _, err = resolve_scene_and_cut(
        section_type, scene_index=scene_index, scene_number=scene_number, default_scene=0
    )
    if err:
        return None, None, [], None, {"ok": False, "error": err}
    section_type = norm_sec

    try:
        proj = _get_project_or_raise(project_id)
        proj_dir = _project_dir(project_id)
    except ValueError as e:
        return None, None, [], None, {"ok": False, "error": str(e)}
    fallback = None
    manifest_duration = None
    try:
        manifest_path = _active_manifest_path(proj, proj_dir)
        if manifest_path and manifest_path.is_file():
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if isinstance(manifest, list):
                if section_type == "scene":
                    scenes = [m for m in manifest
                              if isinstance(m, dict) and m.get("section_type") == "scene"]
                    total_scenes = len(scenes)
                    if 0 <= scene_index < total_scenes:
                        fallback = scenes[scene_index].get("sub_visuals")
                        try:
                            manifest_duration = float(
                                scenes[scene_index].get("duration", 0) or 0)
                        except (TypeError, ValueError):
                            manifest_duration = None
                    else:
                        return proj, proj_dir, [], None, {"ok": False, "error": (
                            f"scene_index {scene_index} (UI Scene {scene_index + 1}) out of range "
                            f"(0..{total_scenes - 1} — UI Scenes 1..{total_scenes}). "
                            f"Did you pass a 1-based scene number? In Narrato UI, Scene {scene_index} is scene_index={scene_index - 1}. "
                            f"Use scene_number={scene_index} or scene_index={scene_index - 1}."
                        )}
                else:
                    entry = next((m for m in manifest
                                  if isinstance(m, dict)
                                  and _normalize_section_type(m.get("section_type")) == section_type), None)
                    if entry is not None:
                        fallback = entry.get("sub_visuals")
                        try:
                            manifest_duration = float(
                                entry.get("duration", 0) or 0)
                        except (TypeError, ValueError):
                            manifest_duration = None
            else:
                logger.warning("probe: manifest is not a list; using script.json")
    except Exception as e:
        logger.warning(f"probe: manifest read failed ({e}); using script.json")
    cuts = _current_section_cuts(proj_dir, section_type, scene_index,
                                 fallback=fallback)
    display_label = format_display_label(section_type, scene_index)
    # Keep raw order (including rare non-dict entries) so cut_index matches
    # get_visuals; every consumer below guards non-dict cuts individually.
    if not [c for c in cuts if isinstance(c, dict)]:
        return proj, proj_dir, [], manifest_duration, {"ok": False, "error": (
            f"No visuals found for {display_label}. Author visuals with save_visuals first.")}
    return proj, proj_dir, cuts, manifest_duration, None


_IMAGE_SUFFIXES = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp",
                   ".avif")
_VIDEO_SUFFIXES = (".mp4", ".mov", ".mkv", ".webm", ".m4v")


def _file_info(local_path: Any, base_dir: Path | None = None) -> Dict[str, Any]:
    """File truth for a downloaded asset. Relative paths resolve against the
    project dir (never the process CWD). Unknown suffixes still report
    exists/size; dimensions/duration are best-effort."""
    info: Dict[str, Any] = {"local_path": local_path, "exists": False,
                            "size": -1}
    if not isinstance(local_path, str) or not local_path.strip():
        return info
    try:
        p = Path(local_path)
        if not p.is_absolute() and base_dir is not None:
            p = base_dir / p
        if p.is_file():
            info["exists"] = True
            try:
                info["size"] = p.stat().st_size
            except OSError:
                pass
            if p.suffix.lower() in _IMAGE_SUFFIXES:
                try:
                    from PIL import Image as _Image
                    with _Image.open(p) as img:
                        info["dimensions"] = [img.width, img.height]
                except Exception:
                    pass
            elif p.suffix.lower() in _VIDEO_SUFFIXES:
                try:
                    from backend.mcp.frames import _probe_duration
                    info["duration"] = _probe_duration(str(p))
                except Exception:
                    pass
    except Exception:
        pass
    return info


def _visuals_hash_for(proj_dir: Path) -> str:
    try:
        from backend.mcp.stills import compute_visuals_hash
        script = json.loads((proj_dir / "script.json").read_text(encoding="utf-8"))
        return compute_visuals_hash(script)
    except Exception:
        return "unknown"


def _layer_rows(cut: Dict[str, Any],
                base_dir: Path | None = None) -> tuple[List[Dict[str, Any]], List[str]]:
    rows: List[Dict[str, Any]] = []
    missing: List[str] = []
    comp = cut.get("composition") if isinstance(cut, dict) else None
    children = comp.get("children") if isinstance(comp, dict) else []
    if not isinstance(children, list):
        return rows, missing
    try:
        from backend.agent.geometry import layer_box
    except Exception:
        layer_box = None  # type: ignore[assignment]
    for idx, layer in enumerate(children):
        if not isinstance(layer, dict):
            rows.append({"layer_index": idx, "type": None,
                         "note": "non-dict child (dropped at save)"})
            continue
        raw_content = layer.get("content")
        content = raw_content if isinstance(raw_content, dict) else None
        ctype = content.get("type") if content is not None else None
        row: Dict[str, Any] = {"layer_index": idx, "type": ctype}
        if content is not None:
            for k in ("query", "source", "text", "particle_preset",
                      "background_preset", "chart_type", "shape_type"):
                if content.get(k) not in (None, ""):
                    row[k] = content[k]
            if layer_box is not None:
                try:
                    box = layer_box(layer)
                    row["box"] = {k: box.get(k) for k in (
                        "left", "top", "width", "height", "x0", "y0",
                        "has_box", "double_anchor_h", "double_anchor_v",
                        "rect")}
                except Exception:
                    pass
        anims = layer.get("animations") or []
        if isinstance(anims, list) and anims:
            row["animations"] = [
                {k: a.get(k) for k in ("property", "from", "to",
                                       "duration", "delay", "easing")}
                for a in anims if isinstance(a, dict)]
        if content is not None and ctype in ("Image", "Video"):
            lp = content.get("local_path")
            finfo = _file_info(lp, base_dir)
            row.update({f"asset_{k}": v for k, v in finfo.items()
                        if k != "local_path"})
            row["local_path"] = lp
            row["query"] = content.get("query")
            row["source"] = content.get("source")
            if not finfo["exists"]:
                missing.append(str(content.get("query") or ctype))
        rows.append(row)
    return rows, missing


def probe_cut_payload(project_id: str, section_type: str,
                      scene_index: int | None = None, cut_index: int | None = None,
                      scene_number: int | None = None, cut_number: int | None = None) -> dict:
    """Full visibility for ONE cut: JSON + timing + asset files."""
    norm_sec, scene_index, cut_index, err = resolve_scene_and_cut(
        section_type, scene_index=scene_index, scene_number=scene_number,
        cut_index=cut_index, cut_number=cut_number, default_scene=0, default_cut=0,
        allow_negative_cut=False
    )
    if err:
        return {"ok": False, "error": err}
    section_type = norm_sec
    cut_index = 0 if cut_index is None else cut_index

    proj, proj_dir, cuts, _, r_err = _resolve_cuts(project_id, section_type,
                                                 scene_index)
    if r_err:
        return r_err
    proj_vf = str((proj or {}).get("video_format") or "landscape")
    if not 0 <= cut_index < len(cuts):
        total_cuts = len(cuts)
        return {"ok": False,
                "error": (
                    f"cut_index {cut_index} (UI Cut #{cut_index + 1}) out of range "
                    f"(0..{total_cuts - 1} — UI Cuts #1..#{total_cuts}). "
                    f"Did you pass a 1-based cut number? In Narrato UI, Cut #{cut_index} is cut_index={cut_index - 1}. "
                    f"Use cut_number={cut_index} or cut_index={cut_index - 1}."
                )}
    cut = cuts[cut_index]
    if not isinstance(cut, dict):
        return {"ok": False, "error": (
            f"cut {cut_index} is a non-dict entry (corrupted) — "
            f"re-save the section via save_visuals.")}
    try:
        from backend.agent.timing import lint_cut_timing
        timing = lint_cut_timing(cut, cut_index=cut_index)
    except Exception:
        from backend.agent.timing import empty_timing_report
        timing = empty_timing_report()
    layers, missing = _layer_rows(cut, proj_dir)
    display_label = format_display_label(section_type, scene_index, cut_index)
    return {"ok": True, "project_id": project_id,
            "section_type": section_type,
            "visuals_hash": _visuals_hash_for(proj_dir),
            "scene_index": scene_index if section_type == "scene" else None,
            "scene_number": (scene_index + 1) if section_type == "scene" else None,
            "cut_index": cut_index,
            "cut_number": cut_index + 1,
            "display_label": display_label,
            "total_cuts": len(cuts),
            "cut_duration": timing.get("cut_duration"),
            "transition": cut.get("transition"),
            "cut": cut, "layers": layers,
            "timing": timing,
            "assets_missing": missing,
            "next": ("Fix via save_visuals(cut_number=N) or save_visuals(cut_index=N) with a 1-element array; "
                     "if a fix adds a new query, re-run fetch_assets then re-probe.")}


def probe_scene_payload(project_id: str, section_type: str,
                        scene_index: int | None = None,
                        scene_number: int | None = None) -> dict:
    """Section overview: per-cut summaries + timing rollups + variety."""
    norm_sec, scene_index, _, err = resolve_scene_and_cut(
        section_type, scene_index=scene_index, scene_number=scene_number, default_scene=0
    )
    if err:
        return {"ok": False, "error": err}
    section_type = norm_sec

    proj_s, proj_dir, cuts, manifest_duration, r_err = _resolve_cuts(
        project_id, section_type, scene_index)
    if r_err:
        return r_err
    proj_vf = str((proj_s or {}).get("video_format") or "landscape")
    display_label = format_display_label(section_type, scene_index, None)
    summaries: List[Dict[str, Any]] = []
    for idx, cut in enumerate(cuts):
        if not isinstance(cut, dict):
            summaries.append({"cut_index": idx, "cut_number": idx + 1,
                              "display_label": f"{display_label} : Cut #{idx + 1}",
                              "corrupted": True,
                              "note": "non-dict entry — re-save the section"})
            continue
        comp = cut.get("composition") or {}
        children = comp.get("children") or []
        types = []
        for layer in children:
            if not isinstance(layer, dict):
                types.append(None)
                continue
            _c = layer.get("content")
            types.append(_c.get("type") if isinstance(_c, dict) else None)
        _, missing = _layer_rows(cut, proj_dir)
        energy = bool(cut.get("emphasis")) or (cut.get("transition") in (
            "whip_pan", "glitch"))
        if not energy and isinstance(children, list):
            for layer in children:
                if not isinstance(layer, dict):
                    continue
                if (layer.get("motion_blur") or layer.get("floating")
                        or (isinstance(layer.get("camera_shake"), str)
                            and layer.get("camera_shake") != "none")
                        or layer.get("filters")):
                    energy = True
                    break
        try:
            dur = round(float(cut.get("duration", 0) or 0), 2)
        except (TypeError, ValueError):
            dur = 0.0
        summaries.append({"cut_index": idx, "cut_number": idx + 1,
                          "display_label": f"{display_label} : Cut #{idx + 1}",
                          "duration": dur,
                          "transition": cut.get("transition"),
                          "layer_count": len(children) if isinstance(children, list) else 0,
                          "layer_types": types, "has_energy": energy,
                          "assets_missing": missing})
    try:
        from backend.agent.timing import lint_section_timing
        timing = lint_section_timing(cuts)
    except Exception:
        from backend.agent.timing import empty_timing_report
        timing = empty_timing_report()
    try:
        dict_cuts = [c for c in cuts if isinstance(c, dict)]
        target = (manifest_duration
                  if manifest_duration and manifest_duration > 0
                  else sum(s.get("duration", 0) for s in summaries))
        variety = payloads._visual_variety_report(dict_cuts, dict_cuts,
                                                  target)
    except Exception:
        variety = {}
    total = round(sum(s.get("duration", 0) for s in summaries), 2)
    return {"ok": True, "project_id": project_id,
            "section_type": section_type,
            "visuals_hash": _visuals_hash_for(proj_dir),
            "scene_index": scene_index if section_type == "scene" else None,
            "scene_number": (scene_index + 1) if section_type == "scene" else None,
            "display_label": display_label,
            "cut_count": len(summaries), "total_duration": total,
            "cuts": summaries, "timing": timing,
            "variety": variety,
            "next": ("Drill into one cut with probe_cut, fix via "
                     "save_visuals(cut_number=N) or save_visuals(cut_index=N).")}


def probe_asset_payload(project_id: str, section_type: str,
                        scene_index: int | None = None, cut_index: int | None = None,
                        layer_index: int = 0,
                        scene_number: int | None = None,
                        cut_number: int | None = None) -> dict:
    """File-level truth for ONE media layer: query → downloaded file?

    File fields use the same asset_* schema as probe_cut layers
    (asset_exists/asset_size/asset_dimensions/asset_duration).
    """
    norm_sec, scene_index, cut_index, err = resolve_scene_and_cut(
        section_type, scene_index=scene_index, scene_number=scene_number,
        cut_index=cut_index, cut_number=cut_number, default_scene=0, default_cut=0,
        allow_negative_cut=False
    )
    if err:
        return {"ok": False, "error": err}
    section_type = norm_sec
    cut_index = 0 if cut_index is None else cut_index

    layer_index_coerced, _lerr = _coerce_index("layer_index", layer_index)
    if _lerr:
        return _lerr
    layer_index = layer_index_coerced if layer_index_coerced is not None else 0

    _, proj_dir, cuts, _, r_err = _resolve_cuts(project_id, section_type,
                                                scene_index)
    if r_err:
        return r_err
    if not 0 <= cut_index < len(cuts):
        total_cuts = len(cuts)
        return {"ok": False,
                "error": (
                    f"cut_index {cut_index} (UI Cut #{cut_index + 1}) out of range "
                    f"(0..{total_cuts - 1} — UI Cuts #1..#{total_cuts}). "
                    f"Did you pass a 1-based cut number? In Narrato UI, Cut #{cut_index} is cut_index={cut_index - 1}. "
                    f"Use cut_number={cut_index} or cut_index={cut_index - 1}."
                )}
    cut = cuts[cut_index]
    if not isinstance(cut, dict):
        return {"ok": False, "error": (
            f"cut {cut_index} is a non-dict entry (corrupted) — "
            f"re-save the section via save_visuals.")}
    comp = cut.get("composition") or {}
    children = comp.get("children") or []
    if not isinstance(children, list) or not 0 <= layer_index < len(children):
        return {"ok": False, "error": (
            f"layer_index {layer_index} out of range "
            f"(0..{len(children) - 1 if isinstance(children, list) else 0}).")}
    layer = children[layer_index]
    display_label = format_display_label(section_type, scene_index, cut_index)
    scene_num = (scene_index + 1) if section_type == "scene" else None
    if not isinstance(layer, dict):
        return {"ok": True, "project_id": project_id,
                "section_type": section_type,
                "scene_index": scene_index if section_type == "scene" else None,
                "scene_number": scene_num,
                "cut_index": cut_index, "cut_number": cut_index + 1,
                "display_label": display_label,
                "layer_index": layer_index,
                "layer_type": None, "status": "corrupted",
                "note": "non-dict child (dropped at save) — re-save the section."}
    content = layer.get("content")
    content = content if isinstance(content, dict) else None
    ctype = content.get("type") if content is not None else None
    if ctype not in ("Image", "Video"):
        return {"ok": True, "project_id": project_id,
                "section_type": section_type,
                "scene_index": scene_index if section_type == "scene" else None,
                "scene_number": scene_num,
                "cut_index": cut_index, "cut_number": cut_index + 1,
                "display_label": display_label,
                "layer_index": layer_index, "layer_type": ctype,
                "status": "procedural",
                "note": f"Layer type {ctype!r} needs no download."}
    finfo = _file_info(content.get("local_path"), proj_dir)
    status = "fetched" if finfo["exists"] else "missing"
    res: Dict[str, Any] = {"ok": True, "project_id": project_id,
            "section_type": section_type,
            "scene_index": scene_index if section_type == "scene" else None,
            "scene_number": scene_num,
            "cut_index": cut_index, "cut_number": cut_index + 1,
            "display_label": display_label,
            "layer_index": layer_index,
            "layer_type": ctype, "query": content.get("query"),
            "source": content.get("source"), "status": status,
            "local_path": finfo.get("local_path"),
            **{f"asset_{k}": v for k, v in finfo.items()
               if k != "local_path"}}
    if status == "missing":
        res["fix"] = ("Run run_stage(fetch_assets) after save_visuals; "
                      "verify new queries with search_media first.")
    return res
