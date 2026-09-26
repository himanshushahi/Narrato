"""Phase 2: animation timing linter — guessed delays become visible checks.

Read-only. Never mutates cuts. Runs on NORMALIZED cuts (post duration
renorm) so delay/at semantics are absolute seconds within the FINAL cut
duration — the exact question agents kept guessing about.

Checks per cut:
- animation delay+duration <= cut duration (overflow is clipped by renderer).
- emphasis at+duration <= cut duration (validator clamps; we surface it).
- entrance with delay>0 paired with opacity 0->1 fade at same delay.
- motion_blur without spatial motion (no-op bypass) — surfaced, not just logged.
- easing allowlist + usage guidance (spring entrances, ease-out fades,
  linear background drift).
- negative / NaN delay/duration values.

Returns {warnings[], fixes[], checks, cut_durations[], semantics_note}.
Non-blocking: lints never fail a save; gross overflows are warnings with
exact clamp fixes.
"""
from __future__ import annotations

from typing import Any, Dict, List

_VALID_EASINGS = ("linear", "spring", "ease-in", "ease-out", "ease-in-out")
_SPATIAL_PROPS = frozenset({
    "scale", "translateX", "translateY", "rotate", "rotateX", "rotateY",
})
_TOL = 0.05  # renderer frame-slop tolerance.

SEMANTICS_NOTE = (
    "Delays are absolute seconds from cut start within the FINAL "
    "(post-renorm) cut duration — they are NOT scaled when the server "
    "renormalizes section durations. delay+duration and emphasis at+duration "
    "must fit inside the reported cut_duration_final."
)


def _fnum(value: Any) -> float | None:
    try:
        if value is None or isinstance(value, bool):
            return None
        num = float(value)
    except (TypeError, ValueError):
        return None
    if num != num:  # NaN
        return None
    return num


def lint_cut_timing(cut: Dict[str, Any], cut_index: int = 0) -> Dict[str, Any]:
    warnings: List[str] = []
    fixes: List[str] = []
    dur = _fnum(cut.get("duration")) if isinstance(cut, dict) else None
    if dur is None or dur <= 0:
        return {"warnings": [f"cut#{cut_index}: missing duration"],
                "fixes": [], "cut_duration": dur}
    comp = cut.get("composition") if isinstance(cut, dict) else None
    children = comp.get("children") if isinstance(comp, dict) else []
    if not isinstance(children, list):
        children = []
    for idx, layer in enumerate(children):
        if not isinstance(layer, dict):
            continue
        content = layer.get("content") or {}
        ctype = content.get("type") if isinstance(content, dict) else "?"
        label = f"cut#{cut_index} layer#{idx} ({ctype})"
        anims = layer.get("animations") or []
        if not isinstance(anims, list):
            continue
        has_opacity_fade: Dict[float, bool] = {}
        for a in anims:
            if not isinstance(a, dict):
                continue
            prop = a.get("property")
            delay = _fnum(a.get("delay", 0)) if "delay" in a else (
                _fnum(a.get("start", 0)) if "start" in a else 0.0)
            adur = _fnum(a.get("duration"))
            easing = a.get("easing", "ease-out")
            if delay is None or delay < 0:
                warnings.append(f"{label}: animation {prop!r} has bad delay — treated as 0")
                fixes.append(f"{label}: set delay >= 0")
                delay = 0.0
            if adur is None or adur <= 0:
                warnings.append(f"{label}: animation {prop!r} has bad duration — skipped by renderer")
                fixes.append(f"{label}: set duration > 0 (e.g. 0.5)")
                continue
            if delay + adur > dur + _TOL:
                over = round(delay + adur - dur, 2)
                warnings.append(
                    f"{label}: {prop} delay {delay:g}+duration {adur:g} "
                    f"overflows cut {dur:g}s by {over:g}s — clipped")
                fixes.append(
                    f"{label}: clamp to delay {max(0.0, round(dur - adur, 2)):g} "
                    f"or shorten duration to {max(0.1, round(dur - delay, 2)):g}")
            if delay is not None and delay >= dur:
                warnings.append(f"{label}: {prop} delay {delay:g} >= cut {dur:g}s — never plays")
            if easing not in _VALID_EASINGS:
                warnings.append(
                    f"{label}: easing {easing!r} unknown — renderer falls back to ease-out")
                fixes.append(f"{label}: use one of {list(_VALID_EASINGS)}")
            if prop == "opacity":
                try:
                    has_opacity_fade[round(float(delay or 0), 2)] = True
                except (TypeError, ValueError):
                    pass
        # Entrance pairing: spatial animation with delay>0 needs opacity fade.
        for a in anims:
            if not isinstance(a, dict):
                continue
            prop = a.get("property")
            if prop not in _SPATIAL_PROPS:
                continue
            delay = _fnum(a.get("delay", 0)) or 0.0
            if delay > 0:
                key = round(delay, 2)
                paired = any(abs(k - key) < 0.051 for k in has_opacity_fade)
                if not paired:
                    warnings.append(
                        f"{label}: spatial {prop} entrance at delay {delay:g} "
                        f"without opacity fade — element sits frozen before moving")
                    fixes.append(
                        f"{label}: add {{\"property\": \"opacity\", \"from\": 0, "
                        f"\"to\": 1, \"duration\": 0.5, \"delay\": {delay:g}, "
                        f"\"easing\": \"ease-out\"}}")
                    break  # one pairing warning per layer is enough.
        # motion_blur without spatial motion = renderer bypass.
        if layer.get("motion_blur"):
            spatial = any(isinstance(a, dict) and a.get("property") in _SPATIAL_PROPS
                          and (_fnum(a.get("duration")) or 0) > 0
                          for a in anims)
            floating = bool(layer.get("floating"))
            shake = layer.get("camera_shake")
            shaken = isinstance(shake, str) and shake != "none"
            if not (spatial or floating or shaken):
                warnings.append(
                    f"{label}: motion_blur armed on static layer — renderer bypasses it")
                fixes.append(
                    f"{label}: add spatial motion (translate/scale/floating/shake) or drop motion_blur")
        # Easing guidance (advisory, capped: only flag clear mismatches).
        for a in anims:
            if not isinstance(a, dict):
                continue
            prop, easing = a.get("property"), a.get("easing")
            delay = _fnum(a.get("delay", 0)) or 0.0
            if prop in ("translateX", "translateY") and delay >= 0.3 and easing == "linear":
                warnings.append(
                    f"{label}: {prop} entrance with linear easing reads robotic — prefer spring")
                break
    # Emphasis marks (sub-visual level).
    for m in (cut.get("emphasis") or []):
        if not isinstance(m, dict):
            continue
        at = _fnum(m.get("at", 0)) or 0.0
        mdur = _fnum(m.get("duration", 0.5)) or 0.5
        if at + mdur > dur + _TOL:
            warnings.append(
                f"cut#{cut_index} emphasis at {at:g}+duration {mdur:g} "
                f"overflows cut {dur:g}s — clamped at save")
            fixes.append(
                f"cut#{cut_index} emphasis: keep at+duration <= {dur:g}s")
        if at >= dur:
            warnings.append(f"cut#{cut_index} emphasis at {at:g} >= cut {dur:g}s — never fires")
    return {"warnings": warnings, "fixes": fixes, "cut_duration": round(dur, 2)}


def lint_section_timing(sub_visuals: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Lint a whole normalized section. Never raises."""
    warnings: List[str] = []
    fixes: List[str] = []
    durations: List[float] = []
    try:
        cuts = sub_visuals if isinstance(sub_visuals, list) else []
        for idx, cut in enumerate(cuts):
            if not isinstance(cut, dict):
                continue
            rep = lint_cut_timing(cut, cut_index=idx)
            warnings.extend(rep.get("warnings", []))
            fixes.extend(rep.get("fixes", []))
            if rep.get("cut_duration") is not None:
                durations.append(rep["cut_duration"])
    except Exception:
        pass
    return {"warnings": warnings[:20], "fixes": fixes[:20],
            "warning_count": len(warnings), "fix_count": len(fixes),
            "cut_durations_final": durations,
            "animations_checked": sum(1 for c in (sub_visuals or [])
                                      if isinstance(c, dict)),
            "semantics": SEMANTICS_NOTE}
