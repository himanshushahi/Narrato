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

from backend.mcp import payloads
from backend.mcp.payloads import (
    SECTION_TYPES, _active_manifest_path, _current_section_cuts,
    _get_project_or_raise, _project_dir,
)


def _resolve_cuts(project_id: str, section_type: str,
                  scene_index: int = 0) -> tuple:
    """Returns (proj, proj_dir, cuts, error_dict|None)."""
    if section_type not in SECTION_TYPES:
        return None, None, [], {"ok": False,
                "error": f"section_type must be one of {list(SECTION_TYPES)}."}
    try:
        proj = _get_project_or_raise(project_id)
        proj_dir = _project_dir(project_id)
    except ValueError as e:
        return None, None, [], {"ok": False, "error": str(e)}
    fallback = None
    try:
        manifest_path = _active_manifest_path(proj, proj_dir)
        if manifest_path and manifest_path.is_file():
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if isinstance(manifest, list):
                if section_type == "scene":
                    scenes = [m for m in manifest
                              if isinstance(m, dict) and m.get("section_type") == "scene"]
                    if 0 <= scene_index < len(scenes):
                        fallback = scenes[scene_index].get("sub_visuals")
                    else:
                        return proj, proj_dir, [], {"ok": False, "error": (
                            f"scene_index {scene_index} out of range "
                            f"(0..{len(scenes) - 1}).")}
                else:
                    entry = next((m for m in manifest
                                  if isinstance(m, dict)
                                  and m.get("section_type") == section_type), None)
                    if entry is not None:
                        fallback = entry.get("sub_visuals")
    except Exception:
        pass
    cuts = _current_section_cuts(proj_dir, section_type, scene_index,
                                 fallback=fallback)
    if not cuts:
        return proj, proj_dir, [], {"ok": False, "error": (
            f"No visuals found for {section_type}"
            + (f"[{scene_index}]" if section_type == "scene" else "")
            + ". Author visuals with save_visuals first.")}
    return proj, proj_dir, cuts, None


def _file_info(local_path: Any) -> Dict[str, Any]:
    info: Dict[str, Any] = {"local_path": local_path, "exists": False,
                            "size": -1}
    if not isinstance(local_path, str) or not local_path.strip():
        return info
    try:
        p = Path(local_path)
        if p.is_file():
            info["exists"] = True
            try:
                info["size"] = p.stat().st_size
            except OSError:
                pass
            if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"):
                try:
                    from PIL import Image as _Image
                    with _Image.open(p) as img:
                        info["dimensions"] = [img.width, img.height]
                except Exception:
                    pass
            elif p.suffix.lower() in (".mp4", ".mov", ".mkv", ".webm"):
                try:
                    from backend.mcp.frames import _probe_duration
                    info["duration"] = _probe_duration(str(p))
                except Exception:
                    pass
    except Exception:
        pass
    return info


def _layer_rows(cut: Dict[str, Any]) -> tuple[List[Dict[str, Any]], List[str]]:
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
        content = layer.get("content") or {}
        ctype = content.get("type") if isinstance(content, dict) else None
        row: Dict[str, Any] = {"layer_index": idx, "type": ctype}
        if isinstance(content, dict):
            for k in ("query", "source", "text", "particle_preset",
                      "background_preset", "chart_type", "shape_type"):
                if content.get(k) not in (None, ""):
                    row[k] = content[k]
            if layer_box is not None:
                try:
                    box = layer_box(layer)
                    row["box"] = {k: box.get(k) for k in (
                        "left", "top", "width", "height", "x0", "y0")}
                except Exception:
                    pass
        anims = layer.get("animations") or []
        if isinstance(anims, list) and anims:
            row["animations"] = [
                {k: a.get(k) for k in ("property", "from", "to",
                                       "duration", "delay", "easing")}
                for a in anims if isinstance(a, dict)]
        if isinstance(content, dict) and ctype in ("Image", "Video"):
            lp = content.get("local_path")
            finfo = _file_info(lp)
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
                      scene_index: int = 0, cut_index: int = 0) -> dict:
    """Full visibility for ONE cut: JSON + geometry + timing + asset files."""
    _, _, cuts, err = _resolve_cuts(project_id, section_type, scene_index)
    if err:
        return err
    try:
        cut_index = int(cut_index)
    except (TypeError, ValueError):
        return {"ok": False, "error": "cut_index must be an integer."}
    if not 0 <= cut_index < len(cuts):
        return {"ok": False,
                "error": f"cut_index {cut_index} out of range (0..{len(cuts) - 1})."}
    cut = cuts[cut_index]
    try:
        from backend.agent.geometry import lint_cut
        geometry = lint_cut(cut, cut_index=cut_index)
    except Exception:
        geometry = {"warnings": [], "fixes": []}
    try:
        from backend.agent.timing import lint_cut_timing
        timing = lint_cut_timing(cut, cut_index=cut_index)
    except Exception:
        timing = {"warnings": [], "fixes": []}
    layers, missing = _layer_rows(cut)
    return {"ok": True, "project_id": project_id,
            "section_type": section_type,
            "scene_index": scene_index if section_type == "scene" else None,
            "cut_index": cut_index, "total_cuts": len(cuts),
            "cut_duration": timing.get("cut_duration"),
            "transition": cut.get("transition"),
            "cut": cut, "layers": layers,
            "geometry": geometry, "timing": timing,
            "assets_missing": missing,
            "next": ("Fix via save_visuals(cut_index=N) with a 1-element array; "
                     "if a fix adds a new query, re-run fetch_assets then re-probe.")}


def probe_scene_payload(project_id: str, section_type: str,
                        scene_index: int = 0) -> dict:
    """Section overview: per-cut summaries + rollup linters + variety."""
    _, _, cuts, err = _resolve_cuts(project_id, section_type, scene_index)
    if err:
        return err
    summaries: List[Dict[str, Any]] = []
    for idx, cut in enumerate(cuts):
        if not isinstance(cut, dict):
            continue
        comp = cut.get("composition") or {}
        children = comp.get("children") or []
        types = [l.get("content", {}).get("type")
                 for l in children if isinstance(l, dict)]
        _, missing = _layer_rows(cut)
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
        summaries.append({"cut_index": idx, "duration": dur,
                          "transition": cut.get("transition"),
                          "layer_count": len(children) if isinstance(children, list) else 0,
                          "layer_types": types, "has_energy": energy,
                          "assets_missing": missing})
    try:
        from backend.agent.geometry import lint_sub_visuals
        geometry = lint_sub_visuals(cuts)
    except Exception:
        geometry = {"warnings": [], "fixes": []}
    try:
        from backend.agent.timing import lint_section_timing
        timing = lint_section_timing(cuts)
    except Exception:
        timing = {"warnings": [], "fixes": []}
    try:
        variety = payloads._visual_variety_report(cuts, cuts, sum(
            s["duration"] for s in summaries))
    except Exception:
        variety = {}
    total = round(sum(s["duration"] for s in summaries), 2)
    return {"ok": True, "project_id": project_id,
            "section_type": section_type,
            "scene_index": scene_index if section_type == "scene" else None,
            "cut_count": len(summaries), "total_duration": total,
            "cuts": summaries, "geometry": geometry, "timing": timing,
            "variety": variety,
            "next": ("Drill into one cut with probe_cut, fix via "
                     "save_visuals(cut_index=N).")}


def probe_asset_payload(project_id: str, section_type: str,
                        scene_index: int = 0, cut_index: int = 0,
                        layer_index: int = 0) -> dict:
    """File-level truth for ONE media layer: query → downloaded file?"""
    _, _, cuts, err = _resolve_cuts(project_id, section_type, scene_index)
    if err:
        return err
    for name, val in (("cut_index", cut_index), ("layer_index", layer_index)):
        try:
            int(val)
        except (TypeError, ValueError):
            return {"ok": False, "error": f"{name} must be an integer."}
    cut_index, layer_index = int(cut_index), int(layer_index)
    if not 0 <= cut_index < len(cuts):
        return {"ok": False,
                "error": f"cut_index {cut_index} out of range (0..{len(cuts) - 1})."}
    cut = cuts[cut_index]
    comp = cut.get("composition") or {}
    children = comp.get("children") or []
    if not isinstance(children, list) or not 0 <= layer_index < len(children):
        return {"ok": False, "error": (
            f"layer_index {layer_index} out of range "
            f"(0..{len(children) - 1 if isinstance(children, list) else 0}).")}
    layer = children[layer_index]
    content = layer.get("content") or {} if isinstance(layer, dict) else {}
    ctype = content.get("type") if isinstance(content, dict) else None
    if ctype not in ("Image", "Video"):
        return {"ok": True, "project_id": project_id,
                "section_type": section_type, "cut_index": cut_index,
                "layer_index": layer_index, "layer_type": ctype,
                "status": "procedural",
                "note": f"Layer type {ctype!r} needs no download."}
    finfo = _file_info(content.get("local_path"))
    status = "fetched" if finfo["exists"] else "missing"
    res: Dict[str, Any] = {"ok": True, "project_id": project_id,
            "section_type": section_type,
            "scene_index": scene_index if section_type == "scene" else None,
            "cut_index": cut_index, "layer_index": layer_index,
            "layer_type": ctype, "query": content.get("query"),
            "source": content.get("source"), "status": status, **finfo}
    if status == "missing":
        res["fix"] = ("Run run_stage(fetch_assets) after save_visuals; "
                      "verify new queries with search_media first.")
    return res
