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

Returns {warnings[], fixes[], warning_count, fix_count, cut_durations_final[],
cuts_checked, animations_checked, semantics}.
Non-blocking: lints never fail a save; gross overflows are warnings with
exact clamp fixes. Pairing/easing guidance reports at most one warning per
layer; section rollups cap at 20 warnings/fixes.
"""
from __future__ import annotations

from typing import Any, Dict, List

_VALID_EASINGS = ("linear", "spring", "ease-in", "ease-out", "ease-in-out",
                  "bounce", "elastic", "back", "steps", "bezier")
_SPATIAL_PROPS = frozenset({
    "scale", "translateX", "translateY", "translateZ", "rotate", "rotateX", "rotateY",
})
_TOL = 0.05  # renderer frame-slop tolerance.

SEMANTICS_NOTE = (
    "Delays are absolute seconds from cut start within the FINAL "
    "(post-renorm) cut duration — they are NOT scaled when the server "
    "renormalizes section durations. delay+duration and emphasis at+duration "
    "must fit inside the reported cut_duration_final."
)


def _fnum(value: Any) -> float | None:
    import math
    try:
        if value is None or isinstance(value, bool):
            return None
        num = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(num):  # NaN and inf are never valid timings.
        return None
    return num


def _adelay(anim: Dict[str, Any]) -> float:
    """Effective animation delay: `delay`, else legacy `start`, else 0."""
    if "delay" in anim:
        parsed = _fnum(anim.get("delay"))
        return parsed if parsed is not None else 0.0
    if "start" in anim:
        parsed = _fnum(anim.get("start"))
        return parsed if parsed is not None else 0.0
    return 0.0


def _is_num(value: Any) -> bool:
    # Numeric strings ("1.0", "-30") coerce the way the renderer does —
    # rejecting them caused motion_blur false positives on valid drifts.
    import math as _m
    if isinstance(value, bool):
        return False
    if isinstance(value, (int, float)):
        try:
            return _m.isfinite(float(value))
        except (ValueError, TypeError):
            return False
    if isinstance(value, str):
        try:
            return _m.isfinite(float(value.strip()))
        except (ValueError, AttributeError):
            return False
    return False


def _is_spatial(anim: Any) -> bool:
    """Mirror renderer + validator: spatial prop with finite numeric from/to
    and duration > 0 (ASTAnimator skips keyframes missing any of these, so
    motion_blur on such a layer is bypassed). Accepts numeric strings."""
    if not isinstance(anim, dict):
        return False
    if anim.get("property") not in _SPATIAL_PROPS:
        return False
    if not _is_num(anim.get("from")) or not _is_num(anim.get("to")):
        return False
    dur = _fnum(anim.get("duration"))
    return dur is not None and dur > 0


def empty_timing_report() -> Dict[str, Any]:
    """Full-shape empty report for lint-crash fallbacks (never partial)."""
    return {"warnings": [], "fixes": [], "warning_count": 0, "fix_count": 0,
            "cut_durations_final": [], "cuts_checked": 0,
            "animations_checked": 0, "semantics": SEMANTICS_NOTE}


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
        if any(isinstance(a, dict) and "start" in a and "delay" not in a
               for a in anims):
            warnings.append(
                f"{label}: legacy animations[].start found (expected delay) — "
                f"migrate to delay (server auto-converts legacy shapes; "
                f"verify timing in review)")
        for a in anims:
            if not isinstance(a, dict):
                continue
            prop = a.get("property")
            delay = _adelay(a)
            adur = _fnum(a.get("duration"))
            easing = a.get("easing", "ease-out")
            _delay_raw = a.get("delay", a.get("start"))
            if _delay_raw is not None and _fnum(_delay_raw) is None:
                warnings.append(
                    f"{label}: animation {prop!r} has non-finite delay "
                    f"({_delay_raw!r}) — treated as 0")
                fixes.append(f"{label}: set a finite delay >= 0")
            if delay < 0:
                warnings.append(f"{label}: animation {prop!r} has bad delay — treated as 0")
                fixes.append(f"{label}: set delay >= 0")
                delay = 0.0
            if adur is None or adur <= 0:
                warnings.append(f"{label}: animation {prop!r} has bad duration — skipped by renderer")
                fixes.append(f"{label}: set duration > 0 (e.g. 0.5)")
                continue
            if delay >= dur:
                warnings.append(f"{label}: {prop} delay {delay:g} >= cut {dur:g}s — never plays")
            elif delay + adur > dur + _TOL:
                over = round(delay + adur - dur, 2)
                warnings.append(
                    f"{label}: {prop} delay {delay:g}+duration {adur:g} "
                    f"overflows cut {dur:g}s by {over:g}s — clipped")
                if adur > dur:
                    fixes.append(
                        f"{label}: shorten duration to <= {dur:g}s "
                        f"(animation is longer than the whole cut)")
                else:
                    fixes.append(
                        f"{label}: clamp to delay {round(dur - adur, 2):g} "
                        f"or shorten duration to {max(0.1, round(dur - delay, 2)):g}")
            if easing not in _VALID_EASINGS:
                warnings.append(
                    f"{label}: easing {easing!r} unknown — renderer falls back to linear")
                fixes.append(f"{label}: use one of {list(_VALID_EASINGS)}")
            if prop == "opacity":
                try:
                    has_opacity_fade[round(float(delay or 0), 2)] = True
                except (TypeError, ValueError):
                    pass
        # Entrance pairing: spatial animation with delay>0 needs opacity fade.
        # (Pairing tolerance 0.05s: a staggered fade further away is a
        # separate beat, not a pairing — at most one warning per layer.)
        for a in anims:
            if not isinstance(a, dict):
                continue
            prop = a.get("property")
            if prop not in _SPATIAL_PROPS:
                continue
            delay = _adelay(a)
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
        # Exit-lifecycle checks (renderer ASTAnimator semantics):
        # - one-shot holds `to` forever; only `exit` unmounts.
        # - layer exit:true without an exit tail on an entrance-only layer
        #   persists (renderer fix) — flag the stray flag so authors don't
        #   expect an early vacate.
        # - fade-to-hidden without any exit leaves an invisible mounted tail.
        # - exit:<n> before an exit tail finishes truncates the fade mid-way.
        exit_val = layer.get("exit")
        explicit_exits = [a for a in anims
                          if isinstance(a, dict) and a.get("exit") is True]
        finite_anims = [a for a in anims
                        if isinstance(a, dict)
                        and _fnum(a.get("duration")) is not None
                        and _fnum(a.get("duration")) > 0
                        and not (a.get("loop_mode") in ("loop", "pingpong")
                                 and a.get("exit") is not True)]

        def _to_num(a: Dict[str, Any]) -> float | None:
            raw = a.get("to")
            if isinstance(raw, bool):
                return None
            return _fnum(raw)

        # Shared exit-tail heuristic (thresholds live in geometry.py and
        # mirror the frontend renderer). Local import to avoid a hard
        # module cycle at import time.
        from backend.agent.geometry import is_exit_like_track as _is_exit_like

        def _is_numeric_exit(value: Any) -> bool:
            return isinstance(value, (int, float)) and not isinstance(value, bool)

        has_exit_like = any(_is_exit_like(a) for a in finite_anims)
        if exit_val is True and finite_anims and not explicit_exits and not has_exit_like:
            latest = max(_adelay(a) + (_fnum(a.get("duration")) or 0.0)
                         for a in finite_anims)
            warnings.append(
                f"{label}: exit:true on an entrance-only layer (no fade-to-hidden / "
                f"slide-off exit tail) — renderer persists the full cut instead of "
                f"unmounting at {latest:g}s; drop the flag or add an exit tail with exit:true")
            fixes.append(
                f"{label}: remove exit:true to persist, or add "
                f"{{\"property\": \"opacity\", \"from\": 1, \"to\": 0, "
                f"\"duration\": 0.4, \"delay\": {round(max(0.0, dur - 0.5), 2):g}, "
                f"\"easing\": \"ease-out\", \"exit\": true}}")
        if has_exit_like and not explicit_exits and not (
                exit_val is True or _is_numeric_exit(exit_val)):
            warnings.append(
                f"{label}: fade-to-hidden tail without any exit flag stays mounted "
                f"invisible to cut end — add exit:true on the layer or the exit track")
            fixes.append(
                f"{label}: set exit:true on the fade-out track (unmounts when done)")
        if _is_numeric_exit(exit_val):
            # Numeric exit truncating ANY tail (explicit or implicit exit-like).
            tails = explicit_exits or [a for a in finite_anims if _is_exit_like(a)]
            for a in tails:
                tail_end = _adelay(a) + (_fnum(a.get("duration")) or 0.0)
                if float(exit_val) < tail_end - _TOL:
                    warnings.append(
                        f"{label}: exit at {float(exit_val):g}s truncates exit tail "
                        f"({a.get('property')} ending at {tail_end:g}s) — fade is cut mid-way")
                    fixes.append(
                        f"{label}: move exit to >= {tail_end:g}s or shorten the exit tail")
                    break
        # Same-property same-delay duplicates: opacity is last-win, but
        # spatial/filter tracks ACCUMULATE (+=) in the renderer — both apply
        # at once, which is almost never intended.
        _seen_delays: Dict[str, float] = {}
        for a in anims:
            if not isinstance(a, dict):
                continue
            prop = a.get("property")
            if not isinstance(prop, str):
                continue
            dkey = round(_adelay(a), 2)
            mkey = f"{prop}@{dkey:.2f}"
            if mkey in _seen_delays:
                effect = ("later track wins" if prop == "opacity"
                          else "both tracks apply at once (values stack)")
                warnings.append(
                    f"{label}: duplicate {prop} tracks at delay {dkey:g}s — "
                    f"{effect}")
                fixes.append(
                    f"{label}: stagger the {prop} delays or remove one track")
                break
            _seen_delays[mkey] = dkey
        # Opacity chains are last-win: a chained track starting away from the
        # previous end value visibly jumps at its delay. (Spatial/filter
        # tracks stack instead of handing off, so no from==prev.to rule
        # applies to them — see renderer comment.)
        _last_opacity_to: float | None = None
        for a in anims:
            if not isinstance(a, dict):
                continue
            if a.get("property") != "opacity" or a.get("exit") is True:
                continue
            from_raw = a.get("from")
            from_v = _fnum(from_raw)
            to_v = _to_num(a)
            if from_v is None or to_v is None:
                continue
            if (_last_opacity_to is not None
                    and abs(_last_opacity_to - from_v) > 0.011):
                warnings.append(
                    f"{label}: chained opacity track starts at {from_v:g} but "
                    f"previous ends at {_last_opacity_to:g} — visible jump at "
                    f"delay {_adelay(a):g}s")
                fixes.append(
                    f"{label}: set from to {_last_opacity_to:g} for a seamless handoff")
                break
            _last_opacity_to = to_v
        # motion_blur without spatial motion = renderer bypass.
        if layer.get("motion_blur"):
            spatial = any(_is_spatial(a) for a in anims)
            floating = bool(layer.get("floating"))
            shake = layer.get("camera_shake")
            shaken = isinstance(shake, str) and shake != "none"
            if not (spatial or floating or shaken):
                warnings.append(
                    f"{label}: motion_blur armed on static layer — renderer bypasses it")
                fixes.append(
                    f"{label}: add spatial motion (translate/scale/floating/shake) or drop motion_blur")
        # Easing guidance (advisory, capped: only flag clear mismatches).
        # Full-cut drifts (duration ~= cut) are background motion, not
        # entrances — linear is correct there.
        for a in anims:
            if not isinstance(a, dict):
                continue
            prop, easing = a.get("property"), a.get("easing")
            delay = _adelay(a)
            adur = _fnum(a.get("duration")) or 0.0
            is_drift = adur >= dur * 0.8
            if (prop in ("translateX", "translateY", "translateZ", "scale", "rotate",
                         "rotateX", "rotateY")
                    and delay >= 0.3 and easing == "linear" and not is_drift):
                warnings.append(
                    f"{label}: {prop} entrance with linear easing reads robotic — prefer spring")
                break
    # Emphasis marks (sub-visual level).
    _emphasis = cut.get("emphasis")
    if _emphasis is not None and not isinstance(_emphasis, list):
        warnings.append(
            f"cut#{cut_index} emphasis must be a list of "
            f"{{at, scale, duration}} marks — ignored by renderer")
    elif isinstance(_emphasis, list):
        for m in _emphasis:
            if not isinstance(m, dict):
                warnings.append(
                    f"cut#{cut_index} emphasis has a non-dict mark — skipped")
                continue
            at = _fnum(m.get("at", 0))
            mdur = _fnum(m.get("duration", 0.5))
            if at is None or at < 0:
                warnings.append(
                    f"cut#{cut_index} emphasis has bad at "
                    f"({m.get('at')!r}) — clamped to 0 at save")
                at = 0.0
            if mdur is None or mdur <= 0:
                warnings.append(
                    f"cut#{cut_index} emphasis has bad duration "
                    f"({m.get('duration')!r}) — needs 0.2-2s")
                continue
            if at >= dur:
                warnings.append(
                    f"cut#{cut_index} emphasis at {at:g} >= cut {dur:g}s — never fires")
            elif at + mdur > dur + _TOL:
                warnings.append(
                    f"cut#{cut_index} emphasis at {at:g}+duration {mdur:g} "
                    f"overflows cut {dur:g}s — clamped at save")
                fixes.append(
                    f"cut#{cut_index} emphasis: keep at+duration <= {dur:g}s")
    return {"warnings": warnings, "fixes": fixes, "cut_duration": round(dur, 2)}


def lint_section_timing(sub_visuals: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Lint a whole normalized section. Never raises."""
    warnings: List[str] = []
    fixes: List[str] = []
    durations: List[float] = []
    anim_count = 0
    cut_count = 0
    try:
        cuts = sub_visuals if isinstance(sub_visuals, list) else []
        for idx, cut in enumerate(cuts):
            if not isinstance(cut, dict):
                continue
            cut_count += 1
            rep = lint_cut_timing(cut, cut_index=idx)
            warnings.extend(rep.get("warnings", []))
            fixes.extend(rep.get("fixes", []))
            if rep.get("cut_duration") is not None:
                durations.append(rep["cut_duration"])
            comp = cut.get("composition") or {}
            children = comp.get("children") or []
            if isinstance(children, list):
                for layer in children:
                    if not isinstance(layer, dict):
                        continue
                    anims = layer.get("animations") or []
                    if isinstance(anims, list):
                        anim_count += sum(1 for a in anims
                                          if isinstance(a, dict))
    except Exception:
        pass
    return {"warnings": warnings[:20], "fixes": fixes[:20],
            "warning_count": len(warnings), "fix_count": len(fixes),
            "cut_durations_final": durations,
            "cuts_checked": cut_count,
            "animations_checked": anim_count,
            "semantics": SEMANTICS_NOTE}
