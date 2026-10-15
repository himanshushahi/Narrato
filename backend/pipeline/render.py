import os
import json
import re
import subprocess
import shutil
import hashlib
import math
import threading
from pathlib import Path
from backend.database.db import get_setting, update_project
from backend.core.config import get_node_path, get_remotion_cache_dir, get_startupinfo, is_production
from backend.core.logger import logger
from backend.core.media_types import VIDEO_EXTS, infer_media_type
from backend.pipeline.assets import normalize_video_asset

def clean_media_path(path_str):
    """Formats an absolute Windows path into a local file:/// URL."""
    if not path_str:
        return ""
    normalized = str(Path(path_str).resolve()).replace('\\', '/')
    return f"file:///{normalized}"


def _round_half_up(x):
    """Match JavaScript's Math.round (round half up), not Python's banker's rounding."""
    return int(math.floor(x + 0.5))


# ── Loudness (EBU R128, YouTube/Shorts target) ─────────────────────────
# Single-pass loudnorm at mux keeps the audio cache intact (normalization
# applies to the already-mixed track, not per-source). ebur128 measurement
# afterwards writes render_loudness.json for qa_gate — measured LUFS, not
# assumed mix levels.
LOUDNESS_TARGET_I = -14.0
LOUDNESS_TARGET_TP = -1.5
LOUDNESS_TARGET_LRA = 11.0
LOUDNESS_TOLERANCE = 2.0

_FFMPEG_FILTER_CACHE: dict = {}


def _ffmpeg_has_filter(ffmpeg_bin: str, name: str) -> bool:
    """Probe `ffmpeg -h filter=<name>` once per binary (cached)."""
    key = (str(ffmpeg_bin), name)
    if key in _FFMPEG_FILTER_CACHE:
        return _FFMPEG_FILTER_CACHE[key]
    try:
        from backend.core.config import get_startupinfo
        proc = subprocess.run(
            [str(ffmpeg_bin), "-hide_banner", "-h", f"filter={name}"],
            capture_output=True, text=True, timeout=30,
            startupinfo=get_startupinfo())
        ok = proc.returncode == 0 and f"Filter {name}" in (proc.stdout or "")
    except Exception:
        ok = False
    _FFMPEG_FILTER_CACHE[key] = ok
    return ok


def parse_ebur128_integrated(stderr_text: str) -> float | None:
    """Parse `Integrated loudness: I: -14.2 LUFS` from ebur128 output."""
    if not stderr_text:
        return None
    matches = re.findall(r"Integrated loudness:\s*I:\s*([-\d.]+)\s*LUFS",
                         stderr_text)
    if not matches:
        return None
    try:
        return float(matches[-1])
    except (TypeError, ValueError):
        return None


def measure_integrated_lufs(ffmpeg_bin: str, media_path) -> float | None:
    """Run ebur128 over a rendered file; None when unmeasurable."""
    try:
        from backend.core.config import get_startupinfo
        proc = subprocess.run(
            [str(ffmpeg_bin), "-hide_banner", "-nostats", "-i", str(media_path),
             "-filter:a", "ebur128=peak=true", "-f", "null", "-"],
            capture_output=True, text=True, timeout=600,
            startupinfo=get_startupinfo())
        return parse_ebur128_integrated(proc.stderr or "")
    except Exception as e:
        logger.warning(f"Loudness measurement failed: {e}")
        return None


def _safe_float(val, default=0.0) -> float:
    """Safely convert value to float, handling None and invalid strings."""
    if val is None:
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


_video_duration_cache: dict = {}


def _ffprobe_cache_key(path_str):
    """Cache key coupling the path to the file identity (mtime + size).

    A bare path key goes stale when an asset is re-downloaded or replaced in
    place: the old (longer) duration would then wrongly clear loop=True for a
    file that now ends early. Keying on identity makes stale entries simply
    miss instead of lying.
    """
    try:
        clean = str(path_str).split("?")[0].split("#")[0]
        stat = os.stat(clean)
        return (clean, stat.st_mtime, stat.st_size)
    except OSError:
        return None


def _ffprobe_duration_seconds(path_str) -> float | None:
    """Duration of a media file via ffprobe (cached per path). None when unknown."""
    if not path_str:
        return None
    clean = str(path_str).split("?")[0].split("#")[0]
    key = _ffprobe_cache_key(path_str)
    if key is not None and key in _video_duration_cache:
        return _video_duration_cache[key]
    result = None
    try:
        from backend.core.config import get_ffprobe_path, get_startupinfo
        ffprobe_bin = get_ffprobe_path()
        if not ffprobe_bin or not Path(str(ffprobe_bin)).exists():
            ffprobe_bin = "ffprobe"
        proc = subprocess.run(
            [str(ffprobe_bin), "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", clean],
            capture_output=True, text=True, timeout=30,
            startupinfo=get_startupinfo())
        if proc.returncode == 0 and (proc.stdout or "").strip():
            result = float((proc.stdout or "").strip())
            if not (result > 0):
                result = None
    except Exception:
        result = None
    if key is not None:
        _video_duration_cache[key] = result
    return result


def _strip_unneeded_video_loops(scenes, fps=30):
    """Drop loop=True on composition video layers whose file outlasts the cut.

    Remotion's native <Video loop> must first resolve the file's duration via
    a delayRender() probe ("Loading <Html5Video> duration ...") in every
    headless tab. Under render concurrency that metadata fetch can hang and
    wedge the frame until the global timeout (minutes) — or resolve late and
    capture a stale/blank frame (flicker). When the source is longer than the
    cut it covers, looping can never wrap, so the flag changes zero pixels:
    clearing it skips the probe and the <Loop> wrapper entirely.
    Unknown durations keep loop=True (safe default — never break playback).
    Returns the number of layers stripped (for logging).
    """
    try:
        fps = int(fps) or 30
    except (ValueError, TypeError):
        fps = 30
    stripped = 0
    for sc, _scene_start, scene_frames in scene_frame_offsets(scenes, fps):
        if not isinstance(sc, dict):
            continue
        sub_visuals = sc.get("sub_visuals", []) or []
        timings = compute_sub_visual_timings_frames(sub_visuals, scene_frames, fps)
        for sv, (t_start, t_end) in zip(sub_visuals, timings):
            if not isinstance(sv, dict):
                continue
            need_seconds = max(0.0, (t_end - t_start) / float(fps))
            comp = sv.get("composition", {})
            if not (isinstance(comp, dict) and comp.get("type") == "Sequence"):
                continue
            for layer in (comp.get("children", []) or []):
                content = (layer.get("content", {}) or {}) if isinstance(layer, dict) else {}
                if not isinstance(content, dict):
                    continue
                if content.get("type") != "Video" or not content.get("loop"):
                    continue
                lp = content.get("local_path")
                if not lp or Path(str(lp).split("?")[0].split("#")[0]).suffix.lower() not in VIDEO_EXTS:
                    continue
                dur = _ffprobe_duration_seconds(lp)
                if dur is not None and dur >= need_seconds + 0.5:
                    content["loop"] = False
                    stripped += 1
    if stripped:
        logger.info(f"Render: stripped unneeded loop=True from {stripped} video layer(s) (source outlasts cut — skips duration probe).")
    return stripped


# Entrance transitions that keep the cut subtree on the direct paint path
# (no ancestor transform/filter): proven flicker-free on fresh video mounts
# by frame-level NCC vs source truth. Everything else (spatial moves, wipes,
# iris, flips, zooms, blurs, flashes, glitches) promotes the fresh <video>
# into a composited/filtered layer whose first presentations come out blank
# or torn in headless Chromium — deterministic across runs.
_FADE_SAFE_ENTRANCES = frozenset({"cut", "none", "fade"})


def _sub_mounts_fresh_video(sv) -> bool:
    """True when the sub-visual mounts a video element at its start."""
    if not isinstance(sv, dict):
        return False
    comp = sv.get("composition", {})
    if isinstance(comp, dict) and comp.get("type") == "Sequence":
        for layer in (comp.get("children", []) or []):
            content = (layer.get("content", {}) or {}) if isinstance(layer, dict) else {}
            if not isinstance(content, dict):
                continue
            if content.get("type") == "Video" and content.get("local_path"):
                return True
    vp = sv.get("visual_path")
    if vp and Path(str(vp).split("?")[0].split("#")[0]).suffix.lower() in VIDEO_EXTS:
        return True
    return False


def _calm_video_cut_entrances(scenes):
    """Soften spatial/filter entrances to 'fade' on fresh-video cuts.

    Only the entrance is touched (exits run on settled video and are safe);
    cuts without video keep their authored transitions untouched. Returns the
    number of entrances remapped (for logging).
    """
    calmed = 0
    for sc in scenes or []:
        if not isinstance(sc, dict):
            continue
        for sv in (sc.get("sub_visuals", []) or []):
            if not isinstance(sv, dict):
                continue
            entrance = sv.get("transition")
            if not entrance or entrance in _FADE_SAFE_ENTRANCES:
                continue
            if _sub_mounts_fresh_video(sv):
                sv["transition"] = "fade"
                calmed += 1
    if calmed:
        logger.info(f"Render: softened {calmed} video-cut entrance(s) to 'fade' (spatial entrances flicker fresh video mounts).")
    return calmed


# Entrances whose peak frames are single-frame spikes by design (a hot flash
# pop, a hue-shifted glitch offset). The dropout detector below would read
# those authored spikes as corrupt frames, so their entrance windows are
# exempt from repair. Width matches the frontend glitch window (8 frames).
_STROBE_ENTRANCES = frozenset({"flash", "glitch"})
_STROBE_WINDOW_FRAMES = 8


def _strobe_window_frames(scenes, fps=30):
    """Absolute frame indices inside flash/glitch entrance windows."""
    try:
        fps = int(fps) or 30
    except (ValueError, TypeError):
        fps = 30
    exempt = set()
    try:
        for sc, scene_start, scene_frames in scene_frame_offsets(scenes, fps):
            if not isinstance(sc, dict):
                continue
            sub_visuals = sc.get("sub_visuals", []) or []
            timings = compute_sub_visual_timings_frames(sub_visuals, scene_frames, fps)
            for sv, (t_start, t_end) in zip(sub_visuals, timings):
                if not isinstance(sv, dict):
                    continue
                if sv.get("transition") not in _STROBE_ENTRANCES:
                    continue
                first = scene_start + t_start
                last = min(scene_start + t_end, first + _STROBE_WINDOW_FRAMES)
                for f in range(max(0, first), last):
                    exempt.add(f)
    except Exception as e:
        logger.warning(f"Render: strobe-window scan skipped ({e})")
    return exempt


def compute_sub_visual_timings_frames(sub_visuals, scene_frames, fps=30):
    """Replicate the frontend's calculateSubVisualTimings (utils/duration.ts)
    in frames so audio cut ranges and video-audio placement match the preview.
    Priority: duration_ratio (Adjust Durations) > per-sub duration > equal split.
    Returns a list of (start_frame, end_frame) per sub-visual."""
    num_subs = len(sub_visuals)
    if num_subs == 0:
        return []

    def is_valid_number(v):
        return (isinstance(v, (int, float))
                and not isinstance(v, bool)
                and not (isinstance(v, float) and math.isnan(v)))

    durations = [sv.get("duration") for sv in sub_visuals]
    all_durations_valid = all(is_valid_number(d) and d > 0 for d in durations)

    ratios = [sv.get("duration_ratio") for sv in sub_visuals]
    has_valid_ratios = (
        all(is_valid_number(r) for r in ratios)
        and abs(sum(ratios) - 1.0) < 0.01
    )

    current_offset = 0
    subs = []
    for idx in range(num_subs):
        if has_valid_ratios:
            if idx == num_subs - 1:
                sub_duration = max(1, scene_frames - current_offset)
            else:
                sub_duration = max(1, _round_half_up(scene_frames * ratios[idx]))
        elif all_durations_valid:
            sub_duration = max(1, _round_half_up(durations[idx] * fps))
            if idx == num_subs - 1:
                sub_duration = max(1, scene_frames - current_offset)
        else:
            if idx == num_subs - 1:
                sub_duration = max(1, scene_frames - current_offset)
            else:
                sub_duration = max(1, math.floor(scene_frames / num_subs))
        sub_from = current_offset
        sub_end = sub_from + max(1, sub_duration)
        current_offset = sub_end
        subs.append((sub_from, sub_end))
    return subs


def scene_frame_offsets(scenes, fps=30):
    """Yield (scene, scene_start_frame, scene_frames) per scene, replicating the
    composition's frame math: max(30, ceil(duration * fps)) per scene. The 30-frame
    minimum is applied per scene in the composition, so it must be replicated here
    or every later mute range drifts by the deficit."""
    try:
        fps = int(fps) or 30
    except (ValueError, TypeError):
        fps = 30
    offset = 0
    for sc in scenes:
        scene_frames = max(30, int(math.ceil(float(sc.get("duration") or 0.0) * fps)))
        yield sc, offset, scene_frames
        offset += scene_frames


def _load_design_system(project_dir) -> dict:
    """Load design.json for export parity with the editor preview.

    The preview passes design.json as `designSystem` (font + accent
    fallbacks in KineticSubtitles). Export previously omitted it, so
    subtitles fell back to Inter / #fbbf24 and any design edit was
    invisible in the MP4. Returns {} when missing/invalid (never breaks
    a render).
    """
    try:
        design_path = Path(project_dir) / "design.json"
        if design_path.exists():
            data = json.loads(design_path.read_text(encoding="utf-8"))
            # Gate on what the renderer actually reads (typography / palette),
            # not theme_name: a valid file missing that label must still apply
            # instead of silently falling back to Inter / #fbbf24.
            if isinstance(data, dict) and (data.get("typography") or data.get("color_palette")):
                return data
            if isinstance(data, dict) and data:
                logger.warning("Render: design.json lacks typography/color_palette — passing through as-is.")
                return data
    except Exception as e:
        logger.warning(f"Render: could not load design.json ({e})")
    return {}


def _font_css_hash(props_dict) -> str:
    """Short hash of the embedded export font CSS (avoids hashing MBs inline)."""
    try:
        css = props_dict.get("fontCssInline") or ""
        if not css:
            return ""
        if isinstance(css, str):
            return hashlib.sha256(css.encode("utf-8")).hexdigest()[:16]
    except Exception:
        pass
    return ""


def compute_granular_frame_hashes(props_dict, render_settings):
    """
    Computes global frame environment hash and per-scene frame hashes for granular cache invalidation.
    Returns:
      global_env_hash: str
      scene_records: list of dicts with {
        'index': i,
        'start_frame': start_frame,
        'end_frame': end_frame,
        'duration_frames': scene_frames,
        'scene_hash': hash_str
      }
    """
    global_env = {
        "subtitleSettings": props_dict.get("subtitleSettings", {}),
        "designSystem": props_dict.get("designSystem", {}),
        "fontCssHash": _font_css_hash(props_dict),
        "style": props_dict.get("style"),
        "language": props_dict.get("language"),
        "videoFormat": props_dict.get("videoFormat"),
        "fps": props_dict.get("fps"),
        "imageFormat": "jpeg",
        "resolution": render_settings.get("resolution"),
        "overlays": props_dict.get("overlays", []),
        # Effects quality changes pixels (blur samples, glass radius) → must
        # invalidate granular frame reuse when the user edits Settings.
        "quality": props_dict.get("quality", {}),
    }
    for k, ov in enumerate(global_env.get("overlays", [])):
        logo = ov.get("logo_url") if isinstance(ov, dict) else None
        if logo and isinstance(logo, str):
            clean_p = logo.replace("file:///", "").replace("file://", "")
            if os.path.exists(clean_p):
                stat = os.stat(clean_p)
                global_env[f"overlay_{k}_mtime"] = stat.st_mtime
                global_env[f"overlay_{k}_size"] = stat.st_size

    global_env_hash = hashlib.sha256(json.dumps(global_env, sort_keys=True).encode('utf-8')).hexdigest()

    scenes = props_dict.get("scenes", [])
    transcription = props_dict.get("transcription", {})
    segments = transcription.get("segments", []) if isinstance(transcription, dict) else []

    # When subtitles are hidden they contribute zero pixels: word-timing
    # changes (e.g. after a voice re-run) must not invalidate cached frames.
    _subtitle_settings = props_dict.get("subtitleSettings", {})
    if isinstance(_subtitle_settings, dict) and _subtitle_settings.get("hide_subtitles"):
        segments = []

    fps = props_dict.get("fps") or 30
    scene_records = []

    for sc, scene_start_frame, scene_frames in scene_frame_offsets(scenes, fps):
        idx = len(scene_records)
        scene_start_sec = scene_start_frame / float(fps)
        scene_end_sec = (scene_start_frame + scene_frames) / float(fps)

        # Collect subtitle segments falling into this scene
        scene_segments = []
        for seg in segments:
            seg_start = seg.get("start", 0)
            seg_end = seg.get("end", 0)
            if seg_start < scene_end_sec and seg_end > scene_start_sec:
                scene_segments.append(seg)

        scene_props = {
            "scene": sc,
            "segments": scene_segments,
            "scene_frames": scene_frames,
        }

        # Include mtimes of referenced sub-visuals
        for j, sv in enumerate(sc.get("sub_visuals", [])):
            path_str = sv.get("visual_path")
            if path_str and isinstance(path_str, str):
                clean_p = path_str.replace("file:///", "").replace("file://", "")
                if os.path.exists(clean_p):
                    stat = os.stat(clean_p)
                    scene_props[f"sv_{j}_mtime"] = stat.st_mtime
                    scene_props[f"sv_{j}_size"] = stat.st_size

        scene_hash = hashlib.sha256(json.dumps(scene_props, sort_keys=True).encode('utf-8')).hexdigest()
        scene_records.append({
            "index": idx,
            "start_frame": scene_start_frame,
            "end_frame": scene_start_frame + scene_frames - 1,
            "duration_frames": scene_frames,
            "scene_hash": scene_hash,
        })

    return global_env_hash, scene_records


def compute_frame_hash(props_dict, render_settings):
    """Hash of frame-relevant properties only (scenes, transcription, overlays, resolution, fps).
    Audio/encode settings don't affect pixel output, so they're excluded."""
    frame_props = {
        "scenes": props_dict.get("scenes", []),
        "transcription": props_dict.get("transcription", {}),
        "subtitleSettings": props_dict.get("subtitleSettings", {}),
        "designSystem": props_dict.get("designSystem", {}),
        "fontCssHash": _font_css_hash(props_dict),
        "style": props_dict.get("style"),
        "language": props_dict.get("language"),
        "videoFormat": props_dict.get("videoFormat"),
        "fps": props_dict.get("fps"),
        "imageFormat": "jpeg",
        "resolution": render_settings.get("resolution"),
        "overlays": props_dict.get("overlays", []),
        "quality": props_dict.get("quality", {}),
    }

    # Hash file contents/mtime rather than just string paths to detect in-place overwrites
    for i, sc in enumerate(frame_props.get("scenes") or []):
        for j, sv in enumerate(sc.get("sub_visuals", [])):
            path_str = sv.get("visual_path")
            if path_str and isinstance(path_str, str):
                clean_p = path_str.replace("file:///", "").replace("file://", "")
                if os.path.exists(clean_p):
                    stat = os.stat(clean_p)
                    frame_props[f"visual_{i}_{j}_mtime"] = stat.st_mtime
                    frame_props[f"visual_{i}_{j}_size"] = stat.st_size

    for k, ov in enumerate(frame_props.get("overlays", [])):
        logo = ov.get("logo_url") if isinstance(ov, dict) else None
        if logo and isinstance(logo, str):
            clean_p = logo.replace("file:///", "").replace("file://", "")
            if os.path.exists(clean_p):
                stat = os.stat(clean_p)
                frame_props[f"overlay_{k}_mtime"] = stat.st_mtime
                frame_props[f"overlay_{k}_size"] = stat.st_size

    data_str = json.dumps(frame_props, sort_keys=True)
    return hashlib.sha256(data_str.encode('utf-8')).hexdigest()

def compute_audio_hash(props_dict, render_settings):
    """Hash of audio-relevant properties only (bg_music, volumes, narration path, video audio).
    Scene visuals and encode settings don't affect the audio mix."""
    _ = render_settings  # kept for caller parity; only props_dict affects the hash
    scene_durations = [sc.get("duration") for sc in props_dict.get("scenes", [])]
    mute_video_audio = props_dict.get("muteVideoAudio", False)
    audio_props = {
        "audioUrl": props_dict.get("audioUrl"),
        "bgMusicUrl": props_dict.get("bgMusicUrl"),
        "bgMusicVolume": props_dict.get("bgMusicVolume"),
        "voiceoverVolume": props_dict.get("voiceoverVolume"),
        "muteVideoAudio": mute_video_audio,
        "scene_durations": scene_durations,
    }

    # Collect video audio sources (only when not muted)
    video_audio_sources = []
    _audio_fps = props_dict.get("fps") or 30
    for sc, scene_start, scene_frames in scene_frame_offsets(props_dict.get("scenes", []), _audio_fps):
        sub_visuals = sc.get("sub_visuals", [])
        timings = compute_sub_visual_timings_frames(sub_visuals, scene_frames, _audio_fps)
        for sv, (t_start, t_end) in zip(sub_visuals, timings):
            vol = sv.get("videoVolume") or 0
            if not mute_video_audio and vol > 0:
                vpath = sv.get("visual_path") or ""
                video_audio_sources.append({
                    "path": vpath,
                    "volume": vol,
                    "start_time": (scene_start + t_start) / float(_audio_fps),
                    "duration": (t_end - t_start) / float(_audio_fps),
                })
    audio_props["videoAudioSources"] = video_audio_sources
    audio_props["musicClips"] = props_dict.get("musicClips", [])
    audio_props["sfxClips"] = props_dict.get("sfxClips", [])
    audio_props["sfxVolume"] = props_dict.get("sfxVolume", 0.5)

    # Per-sub-visual audio cut flags (mute_voiceover / mute_bg_music) — toggling
    # them must invalidate the cached audio mix.
    audio_cuts = []
    for sc, scene_start, scene_frames in scene_frame_offsets(props_dict.get("scenes", []), _audio_fps):
        sub_visuals = sc.get("sub_visuals", [])
        timings = compute_sub_visual_timings_frames(sub_visuals, scene_frames, _audio_fps)
        for sv, (t_start, t_end) in zip(sub_visuals, timings):
            mv = sv.get("mute_voiceover")
            mb = sv.get("mute_bg_music")
            if mv or mb:
                audio_cuts.append({
                    "start": (scene_start + t_start) / float(_audio_fps),
                    "end": (scene_start + t_end) / float(_audio_fps),
                    "mute_voiceover": mv or False,
                    "mute_bg_music": mb or False,
                })
    audio_props["audioCuts"] = audio_cuts

    # Hash file contents/mtime rather than just string paths to detect in-place overwrites
    for key in ["audioUrl", "bgMusicUrl"]:
        url = audio_props[key]
        if url and url.startswith("file:///"):
            path_str = url[8:]
            if os.path.exists(path_str):
                stat = os.stat(path_str)
                audio_props[f"{key}_mtime"] = stat.st_mtime
                audio_props[f"{key}_size"] = stat.st_size

    for mc in audio_props.get("musicClips", []):
        mpath = mc.get("audio_path")
        if mpath and os.path.exists(mpath):
            stat = os.stat(mpath)
            mc_id = mc.get('id', 'clip')
            audio_props[f"mc_{mc_id}_mtime"] = stat.st_mtime
            audio_props[f"mc_{mc_id}_size"] = stat.st_size

    for sc in audio_props.get("sfxClips", []):
        spath = sc.get("audio_path")
        if spath and os.path.exists(spath):
            stat = os.stat(spath)
            sc_id = sc.get('id', 'sfx')
            audio_props[f"sfx_{sc_id}_mtime"] = stat.st_mtime
            audio_props[f"sfx_{sc_id}_size"] = stat.st_size

    for vas in video_audio_sources:
        path_str = vas["path"]
        if path_str and os.path.exists(path_str):
            stat = os.stat(path_str)
            vas["mtime"] = stat.st_mtime
            vas["size"] = stat.st_size

    data_str = json.dumps(audio_props, sort_keys=True)
    return hashlib.sha256(data_str.encode('utf-8')).hexdigest()

def compute_mux_hash(frame_hash, audio_hash, render_settings):
    """Hash of final-output encoding parameters (CRF, codec, hardware).
    These don't affect source material (frames/audio), only the compressed output."""
    mux_props = {
        "frame_hash": frame_hash,
        "audio_hash": audio_hash,
        "crf": render_settings.get("crf"),
        "codec": render_settings.get("codec"),
        "hardware": render_settings.get("hardware"),
    }
    data_str = json.dumps(mux_props, sort_keys=True)
    return hashlib.sha256(data_str.encode('utf-8')).hexdigest()

def _repair_dropout_frames(frames_dir, total_frames, frame_ext, padding,
                           dry_run=False, exempt_frames=None):
    """Replace isolated corrupt frames with the previous neighbor (flicker fix).

    Detection (grayscale NCC on the video-dominated center box): frame N is
    a dropout when it disagrees with BOTH neighbors (NCC < 0.75) while the
    neighbors agree with each other substantially better (margin > 0.15).
    The relative formulation is immune to dark scenes, fades, slides and
    overlays — those keep neighbor correlation high or degrade all three
    scores together. Adjacent pairs are handled in a second pass. Frames in
    `exempt_frames` (authored strobe windows) are never touched, nor are
    comparisons involving them. Repair copies neighbor bytes over the dropout
    path. Returns repaired list.
    """
    try:
        from PIL import Image
        import numpy as np
        import shutil
        import time as _time
    except Exception as e:
        logger.warning(f"Frame repair skipped (missing imaging libs: {e})")
        return []
    try:
        t0 = _time.time()
        paths = {i: frames_dir / f"element-{i:0{padding}d}.{frame_ext}"
                 for i in range(total_frames)}
        thumbs = {}

        def thumb(i):
            if i not in thumbs:
                try:
                    with Image.open(paths[i]) as im:
                        g = im.convert("L")
                        w, h = g.size
                        # Center box: video-dominated in fullscreen layouts;
                        # keeps static overlays/text (usually top/bottom bands)
                        # from diluting the correlation signal.
                        box = g.crop((int(w * 0.25), int(h * 0.30),
                                      int(w * 0.75), int(h * 0.65)))
                        box.thumbnail((256, 256))
                        thumbs[i] = np.asarray(box, dtype=np.float64)
                except Exception:
                    thumbs[i] = None
            return thumbs[i]

        scores = {}

        def ncc(i, j):
            key = (i, j) if i <= j else (j, i)
            if key not in scores:
                a, b = thumb(i), thumb(j)
                if a is None or b is None:
                    scores[key] = 1.0
                else:
                    try:
                        x = a.ravel()
                        y = b.ravel()
                        x = x - x.mean()
                        y = y - y.mean()
                        d = float(np.sqrt(float((x * x).sum()) * float((y * y).sum())))
                        scores[key] = float((x * y).sum() / d) if d > 0 else 1.0
                    except Exception:
                        scores[key] = 1.0
            return scores[key]

        def present(i):
            try:
                return paths[i].exists() and paths[i].stat().st_size > 0
            except OSError:
                return False

        exempt = set(exempt_frames or [])

        def usable(*idx):
            return all(k not in exempt for k in idx)

        repaired = []
        # Edges: frame 0 and the last frame borrow the two frames after/before.
        if total_frames >= 3:
            if (present(0) and present(1) and present(2) and usable(0, 1, 2)):
                nab, nbc, nac = ncc(0, 1), ncc(0, 2), ncc(1, 2)
                if max(nab, nbc) < 0.75 and nac - max(nab, nbc) > 0.15:
                    if dry_run:
                        repaired.append(0)
                    else:
                        try:
                            shutil.copyfile(paths[1], paths[0])
                            thumbs.pop(0, None)
                            scores.clear()
                            repaired.append(0)
                        except Exception as e:
                            logger.warning(f"Frame repair: could not fix frame 0 ({e})")
            last = total_frames - 1
            if (present(last) and present(last - 1) and present(last - 2)
                    and usable(last, last - 1, last - 2)
                    and last not in repaired and (last - 1) not in repaired
                    and (last - 2) not in repaired):
                nab, nbc, nac = ncc(last, last - 1), ncc(last, last - 2), ncc(last - 1, last - 2)
                if max(nab, nbc) < 0.75 and nac - max(nab, nbc) > 0.15:
                    if dry_run:
                        repaired.append(last)
                    else:
                        try:
                            shutil.copyfile(paths[last - 1], paths[last])
                            thumbs.pop(last, None)
                            scores.clear()
                            repaired.append(last)
                        except Exception as e:
                            logger.warning(f"Frame repair: could not fix frame {last} ({e})")
        # Pass 1: isolated singles.
        for i in range(1, total_frames - 1):
            if not (present(i - 1) and present(i) and present(i + 1)):
                continue
            if not usable(i - 1, i, i + 1):
                continue
            if i - 1 in repaired or i + 1 in repaired:
                continue
            nab, nbc, nac = ncc(i - 1, i), ncc(i, i + 1), ncc(i - 1, i + 1)
            if max(nab, nbc) < 0.75 and nac - max(nab, nbc) > 0.15:
                if dry_run:
                    repaired.append(i)
                    continue
                try:
                    shutil.copyfile(paths[i - 1], paths[i])
                    thumbs.pop(i, None)
                    scores.clear()
                    repaired.append(i)
                except Exception as e:
                    logger.warning(f"Frame repair: could not fix frame {i} ({e})")
        # Pass 2: adjacent pairs (both disagree with the outer good pair).
        for i in range(1, total_frames - 2):
            if not all(present(k) for k in (i - 1, i, i + 1, i + 2)):
                continue
            if not usable(i - 1, i, i + 1, i + 2):
                continue
            if any(k in repaired for k in (i - 1, i, i + 1, i + 2)):
                continue
            if (max(ncc(i - 1, i), ncc(i + 1, i + 2)) < 0.75
                    and ncc(i - 1, i + 2) - max(ncc(i - 1, i), ncc(i + 1, i + 2)) > 0.15):
                if dry_run:
                    repaired.extend([i, i + 1])
                    continue
                try:
                    shutil.copyfile(paths[i - 1], paths[i])
                    shutil.copyfile(paths[i - 1], paths[i + 1])
                    thumbs.pop(i, None)
                    thumbs.pop(i + 1, None)
                    scores.clear()
                    repaired.extend([i, i + 1])
                except Exception as e:
                    logger.warning(f"Frame repair: could not fix frames {i}-{i + 1} ({e})")
        if repaired:
            logger.info(f"Frame repair: {'found' if dry_run else 'fixed'} {len(repaired)} dropout frame(s) "
                        f"({sorted(repaired)[:40]}{'...' if len(repaired) > 40 else ''}) "
                        f"in {_time.time() - t0:.1f}s.")
        else:
            logger.info(f"Frame repair: no dropout frames found ({_time.time() - t0:.1f}s).")
        return repaired
    except Exception as e:
        logger.warning(f"Frame repair skipped ({e})")
        return []


def get_missing_frame_ranges(frames_dir, total_frames, target_ext="jpeg"):
    """Finds all missing frame ranges from 0 to total_frames - 1."""
    if not frames_dir.exists():
        return f"0-{total_frames - 1}"
    
    existing_frames = set()
    valid_exts = {target_ext, "jpg" if target_ext == "jpeg" else target_ext}

    for f in list(frames_dir.glob("element-*.*")):
        if f.stat().st_size == 0:
            # Clean up corrupted 0-byte frames so FFmpeg doesn't choke on them later
            try:
                f.unlink()
            except OSError:
                pass
            continue

        match = re.search(r"element-(\d+)\.([a-zA-Z0-9]+)$", f.name)
        if not match:
            continue

        frame_num = int(match.group(1))
        ext = match.group(2).lower()

        # If leftover frame beyond total_frames or wrong format, remove it
        if frame_num >= total_frames or ext not in valid_exts:
            try:
                f.unlink()
            except OSError:
                pass
        else:
            existing_frames.add(frame_num)
            
    missing_ranges = []
    start = None
    
    for i in range(total_frames):
        if i not in existing_frames:
            if start is None:
                start = i
        else:
            if start is not None:
                missing_ranges.append(f"{start}-{i - 1}")
                start = None
                
    if start is not None:
        missing_ranges.append(f"{start}-{total_frames - 1}")
        
    if not missing_ranges:
        return ""
        
    return ",".join(missing_ranges)

def _cancel_pipe_read(stdout):
    """Cancel a pending blocking read on a pipe handle (Windows only).

    A reader thread blocked in read(1) cannot be unblocked by closing the
    stream from another thread: on Windows both process.stdout.close() and
    os.close(fd) block until the pending read completes, which just moves
    the hang to the caller. CancelIoEx aborts the pending ReadFile so the
    reader wakes with an error and exits. Returns True on success."""
    try:
        import ctypes
        import msvcrt
        handle = msvcrt.get_osfhandle(stdout.fileno())
        return bool(ctypes.windll.kernel32.CancelIoEx(ctypes.c_void_p(handle), None))
    except Exception:
        return False


def _stream_process_output(process, cancel_event, line_callback, label="Process"):
    """Helper to stream subprocess output line by line, handle cancellation, and collect error context.

    Reading happens on a daemon thread: a blocking pipe read would otherwise hang
    forever when a grandchild (e.g. headless Chromium) keeps stdout open after the
    main process has already exited, leaving the whole pipeline stuck.

    Note: line_callback (and anything it calls, e.g. progress_cb) executes on the
    reader thread, not the caller's thread. It must only touch thread-safe targets
    (ui_queue.put, per-call SQLite connections).
    """
    last_output_lines = []
    lines_lock = threading.Lock()

    def reader():
        buffer = ""
        while True:
            try:
                char = process.stdout.read(1)
            except Exception:
                break
            if not char:
                break
            if char in ('\r', '\n'):
                line = buffer
                buffer = ""
                stripped = line.strip()
                if not stripped:
                    continue
                with lines_lock:
                    last_output_lines.append(stripped)
                    if len(last_output_lines) > 20:
                        last_output_lines.pop(0)
                line_callback(stripped)
            else:
                buffer += char

    reader_thread = threading.Thread(target=reader, daemon=True)
    reader_thread.start()

    try:
        while not cancel_event.is_set():
            try:
                process.wait(timeout=0.5)
                break
            except subprocess.TimeoutExpired:
                continue

        if cancel_event.is_set():
            logger.warning(f"{label} cancelled by user. Terminating process.")
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
            raise InterruptedError("Cancelled")
    finally:
        # The process has exited — give the reader a moment to flush remaining
        # lines, but never block on pipe EOF (see docstring). If a grandchild
        # (e.g. headless Chromium) keeps the write end of the pipe open, the
        # reader never sees EOF and would stay blocked forever: cancel the
        # pending read on Windows so the thread can exit. On other platforms
        # (where this scenario cannot be interrupted) the daemon thread is
        # left to drain when the pipe eventually closes.
        reader_thread.join(timeout=2.0)
        if reader_thread.is_alive():
            _cancel_pipe_read(process.stdout)
            reader_thread.join(timeout=1.0)
        # Snapshot under the lock so the returned list is never touched by the
        # reader afterwards (it may still be draining the pipe).
        with lines_lock:
            tail = list(last_output_lines)

    return process.returncode, tail

def prepare_render_props_and_settings(project_dict, project_dir, normalize_assets=True, progress_cb=None, cancel_event=None):
    """Prepares and returns normalized props, render_settings, and associated data for render & staleness checks.

    normalize_assets=False is a read-only path for is_render_stale(): it maps
    video paths via predicted_normalized_path() without running FFmpeg, so
    staleness checks never mutate mtimes (which would self-invalidate the
    frame hashes they compare) and never block the queue HTTP request.
    """
    project_dir = Path(project_dir)
    manifest_path = Path(project_dict.get('assets_manifest_path') or (project_dir / "assets_manifest.json"))
    transcribe_path = Path(project_dict.get('transcription_path') or (project_dir / "subtitles" / "transcription.json"))
    audio_path = Path(project_dict.get('audio_path') or (project_dir / "voiceover" / "voiceover.wav"))

    if not manifest_path.exists():
        raise FileNotFoundError(f"Segment manifest not found: {manifest_path}")
    if not transcribe_path.exists():
        raise FileNotFoundError(f"Whisper transcript not found: {transcribe_path}")
    if not audio_path.exists():
        raise FileNotFoundError(f"Narration track not found: {audio_path}")

    # 1. Load manifests
    with open(manifest_path, "r", encoding="utf-8") as f:
        raw_manifest = json.load(f)
    if isinstance(raw_manifest, dict):
        scenes = raw_manifest.get("scenes") or raw_manifest.get("assets") or []
    elif isinstance(raw_manifest, list):
        scenes = raw_manifest
    else:
        scenes = []

    with open(transcribe_path, "r", encoding="utf-8") as f:
        transcript = json.load(f)

    # Sync live sub_visuals and global overlays from script.json if available
    from backend.pipeline.assets import _has_meaningful_sub_visuals
    script_path = project_dir / "script.json"
    overlays = []
    if script_path.exists():
        try:
            with open(script_path, "r", encoding="utf-8") as f:
                script_data = json.load(f)
            script_scenes = script_data.get("scenes", []) if isinstance(script_data.get("scenes"), list) else []
            scene_counter = 0
            for sc in scenes:
                if not isinstance(sc, dict):
                    continue
                sec_type = sc.get("section_type")
                if sec_type == "introduction" and script_data.get("introduction"):
                    subs = script_data["introduction"].get("sub_visuals")
                    if _has_meaningful_sub_visuals(subs) or not _has_meaningful_sub_visuals(sc.get("sub_visuals")):
                        if subs:
                            sc["sub_visuals"] = subs
                elif sec_type == "conclusion" and script_data.get("conclusion"):
                    subs = script_data["conclusion"].get("sub_visuals")
                    if _has_meaningful_sub_visuals(subs) or not _has_meaningful_sub_visuals(sc.get("sub_visuals")):
                        if subs:
                            sc["sub_visuals"] = subs
                elif sec_type == "scene":
                    if scene_counter < len(script_scenes):
                        script_scene = script_scenes[scene_counter]
                        subs = script_scene.get("sub_visuals")
                        if _has_meaningful_sub_visuals(subs) or not _has_meaningful_sub_visuals(sc.get("sub_visuals")):
                            if subs:
                                sc["sub_visuals"] = subs
                    scene_counter += 1

            raw_overlays = script_data.get("overlays", [])
            if isinstance(raw_overlays, list):
                overlays = raw_overlays
        except Exception as e:
            logger.warning(f"Could not merge script.json into render scenes/overlays: {e}")

    # Strip internal pipeline metadata (_content_hash, _voiceover_*) that doesn't affect
    # rendering output. This prevents metadata changes from invalidating the render cache.
    for sc in scenes:
        if isinstance(sc, dict):
            sc.pop("_content_hash", None)
            sc.pop("_voiceover_engine", None)
            sc.pop("_voiceover_voice", None)
            sc.pop("_voiceover_speed", None)
            sc.pop("_voiceover_pitch", None)

    # Convert local absolute paths in scenes/audios into Bottle media serving URLs & normalize video assets
    if not normalize_assets:
        from backend.pipeline.assets import predicted_normalized_path as _predicted
    else:
        _predicted = None
    # Count videos up front so per-file progress is monotonic.
    _videos_total = 0
    for sc in scenes:
        if isinstance(sc, dict):
            for sv in (sc.get("sub_visuals", []) or []):
                if isinstance(sv, dict) and sv.get("visual_path"):
                    _videos_total += 1
                comp = sv.get("composition", {}) if isinstance(sv, dict) else {}
                if isinstance(comp, dict) and comp.get("type") == "Sequence":
                    for layer in (comp.get("children", []) or []):
                        lp = (layer.get("content", {}) or {}).get("local_path") if isinstance(layer, dict) else None
                        if lp and Path(str(lp).split("?")[0].split("#")[0]).suffix.lower() in VIDEO_EXTS:
                            _videos_total += 1
    _videos_done = [0]

    def _normalize_tracked(path_str):
        if cancel_event is not None and cancel_event.is_set():
            raise InterruptedError("Cancelled")
        out = _predicted(path_str) if _predicted else normalize_video_asset(path_str, cancel_event=cancel_event)
        _videos_done[0] += 1
        if progress_cb is not None and _videos_total > 0:
            pct = 5.0 + 3.0 * (_videos_done[0] / max(1, _videos_total))
            progress_cb(min(8.0, pct), f"Normalizing video assets... {_videos_done[0]}/{_videos_total}")
        return out

    for sc in scenes:
        if isinstance(sc, dict):
            if sc.get("audio_path"):
                sc["audio_url"] = clean_media_path(sc["audio_path"])
        
        sub_visuals = sc.get("sub_visuals", [])
        
        for sv in sub_visuals:
            if sv.get("visual_path"):
                sv["visual_path"] = _normalize_tracked(sv["visual_path"])
                sv["visual_url"] = clean_media_path(sv["visual_path"])
            else:
                sv["visual_url"] = ""

            # Normalize AST composition layers
            comp = sv.get("composition", {})
            if isinstance(comp, dict) and comp.get("type") == "Sequence":
                for layer in comp.get("children", []):
                    content = layer.get("content", {})
                    lp = content.get("local_path")
                    if lp:
                        # STRICT: never mutate content.type at render time.
                        # Warn on legacy mismatches — ASTRenderer's display-time
                        # effectiveType already handles playback safely.
                        sniffed = infer_media_type(lp, content.get("type", ""))
                        if sniffed != content.get("type") and content.get("type") in ("Image", "Video"):
                            logger.warning(f"Render: layer declares '{content.get('type')}' but file looks like '{sniffed}': {lp} — keeping declared type.")
                        # Normalize by actual file extension (not declared type)
                        # so a legacy video-under-Image-label still gets remuxed.
                        if Path(str(lp).split("?")[0].split("#")[0]).suffix.lower() in VIDEO_EXTS:
                            content["local_path"] = _normalize_tracked(content["local_path"])
        
        sc["sub_visuals"] = sub_visuals

    # ── Pre-render media validation (fail fast, never stall at 0%) ──────
    # An undecodable video freezes headless Chromium (PIPELINE_ERROR_DECODE
    # on every tab, zero onFrameUpdate callbacks) while the render process
    # stays alive — the UI then sits at 0.0% with no error. Quarantine bad
    # files here so the NEXT resume re-downloads them via fetch_assets'
    # stored asset_url, and fail THIS run with an actionable message.
    if normalize_assets:
        from backend.pipeline.assets import is_media_file_valid as _valid
        _bad = []
        for sc in scenes:
            if not isinstance(sc, dict):
                continue
            for sv in (sc.get("sub_visuals", []) or []):
                if not isinstance(sv, dict):
                    continue
                _candidates = []
                if sv.get("visual_path"):
                    _candidates.append(("visual_path", sv))
                comp = sv.get("composition", {})
                if isinstance(comp, dict) and comp.get("type") == "Sequence":
                    for layer in (comp.get("children", []) or []):
                        content = layer.get("content", {}) if isinstance(layer, dict) else {}
                        lp = content.get("local_path") if isinstance(content, dict) else None
                        if lp and Path(str(lp).split("?")[0].split("#")[0]).suffix.lower() in VIDEO_EXTS:
                            _candidates.append(("local_path", content))
                for _kind, _holder in _candidates:
                    _p = _holder.get(_kind)
                    if _p and Path(str(_p).split("?")[0].split("#")[0]).suffix.lower() in VIDEO_EXTS:
                        if not _valid(_p):
                            _bad.append(str(_p))
        if _bad:
            from backend.pipeline.assets import _normalize_marker_path as _marker
            for _b in dict.fromkeys(_bad):
                logger.error(f"Quarantining corrupt video asset: {_b}")
                try:
                    Path(_b).unlink()
                except OSError:
                    pass
                try:
                    _marker(Path(_b).with_suffix(".mp4")).unlink()
                except OSError:
                    pass
            uniq = sorted(dict.fromkeys(Path(b).name for b in _bad))
            raise RuntimeError(
                "Corrupt video asset(s) quarantined: " + ", ".join(uniq) +
                ". Resume the pipeline — fetch_assets will re-download them, then render."
            )

    # Clean local media paths in global overlays (e.g. watermark logo_url)
    cleaned_overlays = []
    for item in overlays:
        if isinstance(item, dict):
            item_copy = dict(item)
            if item_copy.get("logo_url"):
                item_copy["logo_url"] = clean_media_path(item_copy["logo_url"])
            cleaned_overlays.append(item_copy)

    bg_music_url = ""
    bg_path_str = project_dict.get("bg_music_path")
    if bg_path_str:
        if Path(bg_path_str).exists():
            bg_music_url = clean_media_path(bg_path_str)
        else:
            logger.warning(f"Background music file not found at {bg_path_str}. Proceeding without background music.")

    project_settings = {}
    if project_dict.get("project_settings"):
        try:
            project_settings = json.loads(project_dict["project_settings"])
        except Exception as e:
            logger.error(f"Failed to parse project_settings: {e}")

    # ── Track visibility overrides ─────────────────────────────────────────
    render_track_overrides = {
        "muteVoice": project_settings.get("render_mute_voice", False),
        "muteMusic": project_settings.get("render_mute_music", False),
        "muteSfx": project_settings.get("render_mute_sfx", False),
        "muteVideoAudio": project_settings.get("render_mute_video_audio", False),
        "hideSubtitles": project_settings.get("render_hide_subtitles", False),
        "hideOverlays": project_settings.get("render_hide_overlays", False),
    }

    # Fetch rendering settings — project_settings override global defaults
    render_resolution = project_settings.get("render_resolution") or get_setting("render_resolution") or "1080p"
    render_concurrency = project_settings.get("render_concurrency") or get_setting("render_concurrency") or "logical"
    render_fps = project_settings.get("render_fps") or get_setting("render_fps") or "30"
    render_crf = project_settings.get("render_crf") or get_setting("render_crf") or "18"
    render_codec = project_settings.get("render_codec") or get_setting("render_codec") or "h264"
    render_hardware = project_settings.get("render_hardware") or get_setting("render_hardware") or "cpu"
    render_timeout = project_settings.get("render_timeout") or get_setting("render_timeout") or "600000"
    render_motion_blur = project_settings.get("render_motion_blur") or get_setting("render_motion_blur") or "balanced"
    render_glass_cap = project_settings.get("render_glass_cap") or get_setting("render_glass_cap") or "16"

    fps = int(render_fps)
    timeout_ms = int(render_timeout)

    raw_music_clips = project_dict.get("music_clips")
    parsed_music_clips = []
    if raw_music_clips:
        try:
            parsed_music_clips = json.loads(raw_music_clips) if isinstance(raw_music_clips, str) else raw_music_clips
        except Exception:
            parsed_music_clips = []

    cleaned_music_clips = []
    for mc in parsed_music_clips:
        if isinstance(mc, dict) and mc.get("audio_path"):
            mc_copy = dict(mc)
            mc_copy["audio_url"] = clean_media_path(mc_copy["audio_path"])
            cleaned_music_clips.append(mc_copy)

    raw_sfx_clips = project_dict.get("sfx_clips")
    parsed_sfx_clips = []
    if raw_sfx_clips:
        try:
            parsed_sfx_clips = json.loads(raw_sfx_clips) if isinstance(raw_sfx_clips, str) else raw_sfx_clips
        except Exception:
            parsed_sfx_clips = []

    cleaned_sfx_clips = []
    for sc in parsed_sfx_clips:
        if isinstance(sc, dict) and sc.get("audio_path"):
            sc_copy = dict(sc)
            sc_copy["audio_url"] = clean_media_path(sc_copy["audio_path"])
            cleaned_sfx_clips.append(sc_copy)

    bg_vol_val = _safe_float(project_dict.get("bg_music_volume"), default=0.15)
    voice_vol_val = _safe_float(project_settings.get("voiceover_volume"), default=1.0)
    try:
        from backend.database.db import get_setting as _get_setting
        sfx_vol_default = float(_get_setting("sfx_volume") or 0.5)
    except Exception:
        sfx_vol_default = 0.5
    sfx_vol_val = _safe_float(project_settings.get("sfx_volume"), default=sfx_vol_default)

    # ── Visual-effects quality policy (Settings → Rendering Engine) ──────
    # Validated here so a corrupt DB value can never break the renderer.
    motion_blur_mode = str(render_motion_blur).lower() if render_motion_blur else "balanced"
    if motion_blur_mode not in ("off", "balanced", "full"):
        motion_blur_mode = "balanced"
    try:
        glass_cap_px = max(0, min(24, int(float(render_glass_cap))))
    except (ValueError, TypeError):
        glass_cap_px = 16
    quality_policy = {"motionBlur": motion_blur_mode, "glassCap": glass_cap_px}

    # Unneeded loop flags force a per-tab duration probe in headless Chromium;
    # strip them where the file provably outlasts the cut (no visual change).
    _strip_unneeded_video_loops(scenes, fps)

    # Spatial/filter cut entrances (slide/zoom/wipe/iris/flip/glitch/...) wrap
    # the fresh <video> in a transformed/filtered ancestor, whose first
    # presentations come out blank/torn in headless Chromium (frame-level NCC
    # vs source truth: black + torn frames until ~8f in, deterministic across
    # runs; opacity-only fade renders correct pixels from frame 0). Soften
    # those entrances to 'fade' on cuts that mount a fresh video. No-op for
    # text/image-only cuts and for exits. Pure in-memory edit — safe for
    # staleness checks (same result on both paths) and covered by the
    # scenes frame hash.
    _calm_video_cut_entrances(scenes)

    props = {
        "audioUrl": clean_media_path(str(audio_path)),
        "bgMusicUrl": bg_music_url,
        "bgMusicVolume": bg_vol_val,
        "musicClips": cleaned_music_clips,
        "sfxClips": cleaned_sfx_clips,
        "sfxVolume": sfx_vol_val,
        "voiceoverVolume": voice_vol_val,
        "muteVideoAudio": False,
        "scenes": scenes,
        "transcription": transcript,
        "style": project_dict.get("style", "nitish_rajput"),
        "language": project_dict.get("language", "hi"),
        "videoFormat": project_dict.get("video_format", "landscape"),
        "fps": fps,
        "subtitleSettings": project_settings,
        "designSystem": _load_design_system(project_dir),
        "overlays": cleaned_overlays,
        "quality": quality_policy,
    }

    # ── Export font embedding (complex-script clipping fix) ──────
    # Headless Chromium never sees the editor document's injected <link>
    # tags, so embed the needed families as data: URIs; the composition
    # injects them gated on document.fonts.ready. Best-effort: never break
    # a render when offline or fonts are missing.
    try:
        from backend.core.fonts import NOTO_FONT_MAP, build_inline_font_css
        _font_fams: list = []
        _noto = NOTO_FONT_MAP.get(str(project_dict.get("language", "")).lower())
        if _noto:
            _font_fams.append(_noto)
        _design_typ = (props.get("designSystem", {}) or {}).get("typography", {}) or {}
        for _k in ("heading_font", "body_font"):
            if _design_typ.get(_k):
                _font_fams.append(_design_typ[_k])
        _design_path = project_dir / "design.json"
        if _design_path.exists() and not _design_typ:
            _typ = json.loads(_design_path.read_text(encoding="utf-8")).get("typography", {}) or {}
            for _k in ("heading_font", "body_font"):
                if _typ.get(_k):
                    _font_fams.append(_typ[_k])
        if isinstance(project_settings, dict):
            for _k in ("fontFamily", "numbering_font_family"):
                if project_settings.get(_k):
                    _font_fams.append(project_settings[_k])
        # Per-cut overrides: a Text layer's style.fontFamily / content.font
        # wins over every default above, so scan the AST for them too.
        for _sc in scenes:
            if not isinstance(_sc, dict):
                continue
            for _sv in (_sc.get("sub_visuals", []) or []):
                _comp = (_sv.get("composition", {}) or {}) if isinstance(_sv, dict) else {}
                for _layer in (_comp.get("children", []) or []):
                    _content = (_layer.get("content", {}) or {}) if isinstance(_layer, dict) else {}
                    if not isinstance(_content, dict):
                        continue
                    if _content.get("font"):
                        _font_fams.append(_content["font"])
                    _st = _content.get("style", {}) or {}
                    if isinstance(_st, dict) and _st.get("fontFamily"):
                        _font_fams.append(_st["fontFamily"])
        props["fontCssInline"] = build_inline_font_css(_font_fams)
    except Exception as e:
        logger.warning(f"Render: font embedding skipped ({e})")
        props["fontCssInline"] = ""

    # Apply track visibility overrides to render props
    if render_track_overrides["muteVoice"]:
        props["voiceoverVolume"] = 0.0
        logger.info("Smart Resume: Voiceover muted by track override.")
    if render_track_overrides["muteMusic"]:
        props["bgMusicVolume"] = 0.0
        props["bgMusicUrl"] = ""
        props["musicClips"] = []
        logger.info("Smart Resume: Background music muted by track override.")
    if render_track_overrides["muteSfx"]:
        props["sfxVolume"] = 0.0
        props["sfxClips"] = []
        logger.info("Smart Resume: SFX muted by track override.")
    if render_track_overrides["muteVideoAudio"]:
        props["muteVideoAudio"] = True
        logger.info("Smart Resume: Video audio muted by track override.")
    if render_track_overrides["hideSubtitles"]:
        if isinstance(props.get("subtitleSettings"), dict):
            props["subtitleSettings"]["hide_subtitles"] = True
        else:
            props["subtitleSettings"] = {"hide_subtitles": True}
        logger.info("Smart Resume: Subtitles hidden by track override.")
    if render_track_overrides["hideOverlays"]:
        props["overlays"] = []
        logger.info("Smart Resume: Overlays hidden by track override.")

    render_settings = {
        "resolution": render_resolution,
        "concurrency": render_concurrency,
        "fps": fps,
        "crf": render_crf,
        "codec": render_codec,
        "hardware": render_hardware,
        "timeout": timeout_ms,
    }

    return (props, render_settings, scenes, transcript, audio_path, render_track_overrides, project_settings, cleaned_music_clips, cleaned_sfx_clips)


def is_render_stale(project_dict, project_dir) -> bool:
    """
    Evaluates whether the render stage is stale under the Smart Resume caching architecture.
    Returns True if:
    - Target MP4 is missing on disk or empty
    - Any render cache files (frame.hash.txt, audio.hash.txt, mux.hash.txt, audio.wav, frames dir) are missing
    - audio_hash differs (bg_music path, volumes, music clips, fades, or cuts changed)
    - frame_hash differs (visual layers, subtitles, or resolutions changed)
    - mux_hash differs (CRF, codec, hardware changed)
    """
    try:
        if not project_dict:
            return True
        project_dir = Path(project_dir)
        
        # 1. Check final video output
        if project_dict.get('export_folder'):
            exports_dir = Path(project_dict['export_folder'])
        else:
            from backend.core.config import get_exports_dir
            exports_dir = get_exports_dir()
        
        safe_name = re.sub(r'[^a-zA-Z0-9_-]', '_', project_dict.get('name', 'project'))
        output_mp4_path = exports_dir / f"{safe_name}.mp4"
        custom_video_path = project_dict.get('video_path')
        if custom_video_path and Path(custom_video_path).exists() and Path(custom_video_path).stat().st_size > 0:
            target_mp4 = Path(custom_video_path)
        else:
            target_mp4 = output_mp4_path

        if not target_mp4.exists() or target_mp4.stat().st_size == 0:
            return True

        cache_dir = project_dir / "render_cache"
        frame_hash_file = cache_dir / "frame.hash.txt"
        audio_hash_file = cache_dir / "audio.hash.txt"
        mux_hash_file = cache_dir / "mux.hash.txt"
        cached_audio_path = cache_dir / "audio.wav"
        frames_dir = cache_dir / "frames"

        if not (frame_hash_file.exists() and audio_hash_file.exists() and mux_hash_file.exists() and cached_audio_path.exists() and frames_dir.exists()):
            return True

        if not any(frames_dir.glob("element-*.*")):
            logger.info("Smart Resume: Render is stale because cached frames directory contains no frames.")
            return True

        # Check required upstream files
        manifest_path = Path(project_dict.get('assets_manifest_path') or (project_dir / "assets_manifest.json"))
        transcribe_path = Path(project_dict.get('transcription_path') or (project_dir / "subtitles" / "transcription.json"))
        audio_path = Path(project_dict.get('audio_path') or (project_dir / "voiceover" / "voiceover.wav"))

        if not (manifest_path.exists() and transcribe_path.exists() and audio_path.exists()):
            return True

        props, render_settings = prepare_render_props_and_settings(project_dict, project_dir, normalize_assets=False)[:2]

        current_audio_hash = compute_audio_hash(props, render_settings)
        cached_audio_hash = audio_hash_file.read_text().strip()
        if current_audio_hash != cached_audio_hash:
            logger.info(f"Smart Resume: Render is stale due to audio changes (audio hash mismatch: {cached_audio_hash[:8]} vs {current_audio_hash[:8]}).")
            return True

        current_frame_hash = compute_frame_hash(props, render_settings)
        cached_frame_hash = frame_hash_file.read_text().strip()
        if current_frame_hash != cached_frame_hash:
            logger.info(f"Smart Resume: Render is stale due to visual frame changes (frame hash mismatch: {cached_frame_hash[:8]} vs {current_frame_hash[:8]}).")
            return True

        current_mux_hash = compute_mux_hash(current_frame_hash, current_audio_hash, render_settings)
        cached_mux_hash = mux_hash_file.read_text().strip()
        if current_mux_hash != cached_mux_hash:
            logger.info(f"Smart Resume: Render is stale due to mux/encode settings change.")
            return True

        return False
    except Exception as e:
        logger.error(f"Error evaluating is_render_stale: {e}")
        return True


def render_pipeline(project_dict, project_dir, progress_cb, cancel_event, force=False):
    """Compiles the React Remotion canvas into an MP4 file using resumable frame rendering.

    The queue manager always calls this with force=False: multi-domain content
    hashes (frame_hash, audio_hash, mux_hash) decide which caches to reuse and
    which to invalidate.  force=True is retained for direct/test invocations but
    is deliberately never triggered from the pipeline (see §3b of the Smart
    Resume architecture doc).
    """
    logger.info(f"Preparing Remotion compilation properties for project: {project_dict['name']}")
    progress_cb(5.0, "Preparing compilation properties...")

    project_dir = Path(project_dir)
    (
        props, render_settings, scenes, _transcript, audio_path,
        render_track_overrides, project_settings, cleaned_music_clips,
        cleaned_sfx_clips
    ) = prepare_render_props_and_settings(project_dict, project_dir, normalize_assets=True, progress_cb=progress_cb, cancel_event=cancel_event)

    fps = render_settings["fps"]
    timeout_ms = render_settings["timeout"]
    render_resolution = render_settings["resolution"]
    render_concurrency = render_settings["concurrency"]
    render_crf = render_settings["crf"]
    render_codec = render_settings["codec"]
    render_hardware = render_settings["hardware"]

    # Write props to a JSON file
    props_path = project_dir / "render_props.json"
    with open(props_path, "w", encoding="utf-8") as f:
        json.dump(props, f, indent=2, ensure_ascii=False)

    logger.info(f"Wrote render props to {props_path}")

    # Compute three domain-specific hashes
    frame_hash = compute_frame_hash(props, render_settings)
    audio_hash = compute_audio_hash(props, render_settings)
    mux_hash = compute_mux_hash(frame_hash, audio_hash, render_settings)

    cache_dir = project_dir / "render_cache"
    frames_dir = cache_dir / "frames"
    cached_audio_path = cache_dir / "audio.wav"

    old_hash_file = cache_dir / "hash.txt"
    frame_hash_file = cache_dir / "frame.hash.txt"
    audio_hash_file = cache_dir / "audio.hash.txt"
    mux_hash_file = cache_dir / "mux.hash.txt"

    # ── Migration from old single-hash system ──────────────────────────────
    if old_hash_file.exists() and not frame_hash_file.exists():
        old_hash = old_hash_file.read_text().strip()
        combined_hash = hashlib.sha256(
            json.dumps({"props": props, "settings": render_settings}, sort_keys=True).encode('utf-8')
        ).hexdigest()
        if old_hash == combined_hash:
            logger.info("Migrating old single-hash cache to multi-hash system.")
            frame_hash_file.write_text(frame_hash)
            audio_hash_file.write_text(audio_hash)
            mux_hash_file.write_text(mux_hash)
        else:
            logger.info("Old cache hash mismatch during migration. Invalidating all caches.")
            shutil.rmtree(cache_dir, ignore_errors=True)
        old_hash_file.unlink(missing_ok=True)

    # ── Ensure cache root exists ───────────────────────────────────────────
    cache_dir.mkdir(parents=True, exist_ok=True)

    # ── Forced re-run: invalidate caches so frames are NOT skipped ──────────
    # Without this, an explicit stage re-run (is_resume=False) still hits the
    # Smart Resume fast path: hashes match → missing_ranges="" → "All frames
    # already rendered. Skipping frame render phase."
    if force:
        logger.info("Force re-run requested: invalidating cached frames and audio so all frames re-render.")
        if frames_dir.exists():
            shutil.rmtree(frames_dir, ignore_errors=True)
        frames_dir.mkdir(parents=True, exist_ok=True)
        if cached_audio_path.exists():
            try:
                cached_audio_path.unlink()
            except OSError:
                pass

    # ── Granular Scene-Level Frame Cache Check ────────────────────────────
    scene_cache_file = cache_dir / "scene_hashes.json"
    global_env_hash, current_scene_records = compute_granular_frame_hashes(props, render_settings)

    if not force and scene_cache_file.exists() and frames_dir.exists():
        try:
            with open(scene_cache_file, "r", encoding="utf-8") as f:
                cached_data = json.load(f)
            cached_global_hash = cached_data.get("global_env_hash")
            cached_scenes = cached_data.get("scenes", [])

            if cached_global_hash == global_env_hash:
                # Global environment matches! We can do granular scene-level invalidation
                cached_scene_map = {s["index"]: s for s in cached_scenes if isinstance(s, dict) and "index" in s}
                invalidated_scene_count = 0
                reused_scene_count = 0

                for curr_s in current_scene_records:
                    s_idx = curr_s["index"]
                    prev_s = cached_scene_map.get(s_idx)
                    # If scene hash changed or start/end frame boundary shifted:
                    if (not prev_s or 
                        prev_s.get("scene_hash") != curr_s["scene_hash"] or 
                        prev_s.get("start_frame") != curr_s["start_frame"] or 
                        prev_s.get("end_frame") != curr_s["end_frame"]):
                        
                        invalidated_scene_count += 1
                        ranges_to_delete = []
                        if prev_s:
                            ranges_to_delete.append((prev_s.get("start_frame", 0), prev_s.get("end_frame", 0)))
                        ranges_to_delete.append((curr_s["start_frame"], curr_s["end_frame"]))

                        for r_start, r_end in ranges_to_delete:
                            for f_num in range(r_start, r_end + 1):
                                for p in (f"element-{f_num}.jpeg", f"element-{f_num}.jpg", f"element-{f_num}.webp",
                                          f"element-{f_num:04d}.jpeg", f"element-{f_num:05d}.jpeg", f"element-{f_num:06d}.jpeg",
                                          f"element-{f_num:04d}.webp", f"element-{f_num:05d}.webp"):
                                    f_path = frames_dir / p
                                    if f_path.exists():
                                        try: f_path.unlink()
                                        except OSError: pass
                        logger.info(f"Smart Resume: Invalidated cached frames for modified Scene {s_idx} (frames {curr_s['start_frame']}-{curr_s['end_frame']}).")
                    else:
                        reused_scene_count += 1
                        logger.info(f"Smart Resume: Reusing cached frames for unchanged Scene {s_idx} (frames {curr_s['start_frame']}-{curr_s['end_frame']}).")

                # Remove any leftover frames from scenes that were deleted
                if len(cached_scenes) > len(current_scene_records):
                    for old_s in cached_scenes[len(current_scene_records):]:
                        for f_num in range(old_s.get("start_frame", 0), old_s.get("end_frame", 0) + 1):
                            for p in (f"element-{f_num}.jpeg", f"element-{f_num}.jpg", f"element-{f_num}.webp",
                                      f"element-{f_num:04d}.jpeg", f"element-{f_num:05d}.jpeg", f"element-{f_num:06d}.jpeg"):
                                f_path = frames_dir / p
                                if f_path.exists():
                                    try: f_path.unlink()
                                    except OSError: pass

                existing_count = sum(len(list(frames_dir.glob(p))) for p in ("element-*.jpeg", "element-*.jpg", "element-*.webp"))
                logger.info(f"Smart Resume granular cache: {reused_scene_count} scenes reused, {invalidated_scene_count} scenes marked for re-render. {existing_count} cached frames on disk.")
            else:
                logger.info("Smart Resume: Global render environment changed (overlays/resolution/styles). Invalidating all frame caches.")
                shutil.rmtree(frames_dir, ignore_errors=True)
                frames_dir.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            logger.warning(f"Error evaluating granular scene cache: {e}. Falling back to full frame cache check.")
            shutil.rmtree(frames_dir, ignore_errors=True)
            frames_dir.mkdir(parents=True, exist_ok=True)
    elif not force and frame_hash_file.exists() and frame_hash_file.read_text().strip() == frame_hash:
        existing_count = sum(len(list(frames_dir.glob(p))) for p in ("element-*.jpeg", "element-*.jpg", "element-*.webp"))
        logger.info(f"Frame hash matches. {existing_count} cached frames found. Will resume from missing ranges.")
    else:
        logger.info("No valid granular frame cache found. Creating new frame cache.")
        if frames_dir.exists():
            shutil.rmtree(frames_dir, ignore_errors=True)
        frames_dir.mkdir(parents=True, exist_ok=True)

    frame_hash_file.write_text(frame_hash)

    # ── Audio cache check ─────────────────────────────────────────────────
    audio_cache_valid = False
    if audio_hash_file.exists() and cached_audio_path.exists():
        if audio_hash_file.read_text().strip() == audio_hash:
            audio_cache_valid = True
            logger.info("Audio hash matches. Will reuse cached audio.")

    if not audio_cache_valid:
        logger.info("Audio cache invalid or missing. Will re-render audio.")
        if cached_audio_path.exists():
            cached_audio_path.unlink()

    # ── Mux hash tracking ──────────────────────────────────────────────────
    mux_hash_file.write_text(mux_hash)

    # ── Smart Resume summary ───────────────────────────────────────────────
    overrides_active = [k for k, v in render_track_overrides.items() if v]
    if overrides_active:
        logger.info(f"Smart Resume: Active track overrides: {overrides_active}")

    total_duration = sum(float(sc.get("duration") or 0.0) for sc in scenes)
    import math
    total_frames = max(fps * 5, math.ceil(total_duration * fps))
    # Define output paths
    if project_dict.get('export_folder'):
        exports_dir = Path(project_dict['export_folder'])
    else:
        from backend.core.config import get_exports_dir
        exports_dir = get_exports_dir()
        
    exports_dir.mkdir(parents=True, exist_ok=True)
    
    safe_name = re.sub(r'[^a-zA-Z0-9_-]', '_', project_dict['name'])
    output_mp4_path = exports_dir / f"{safe_name}.mp4"

    frontend_dir = Path(__file__).resolve().parent.parent.parent / "frontend"
    render_script = frontend_dir / "dist-render" / "render.mjs"
    if not render_script.exists():
        render_script = frontend_dir / "src" / "render.mjs"
    if not render_script.exists():
        raise FileNotFoundError(f"Render script not found: {render_script}")
        
    bundle_dir = frontend_dir / "dist-remotion"
    abs_bundle_dir = str(bundle_dir.resolve()).replace('\\', '/')
    abs_props_path = str(props_path.resolve()).replace('\\', '/')
    



    if render_concurrency in ["logical", "100%"]:
        concurrency_arg = "100%"
    elif render_concurrency in ["physical", "50%"]:
        concurrency_arg = "50%"
    elif render_concurrency in ["25%", "75%"]:
        concurrency_arg = render_concurrency
    else:
        concurrency_arg = render_concurrency
    
    scale_map = {"720p": "0.6666666666666666", "1080p": "1", "1440p": "1.3333333333333333", "4k": "2"}
    scale_arg = scale_map.get(render_resolution.lower(), "1")

    node_exe = get_node_path()
    bin_dir = frontend_dir.parent / "bin"
    ffmpeg_exe = bin_dir / "ffmpeg.exe"
    ffprobe_exe = bin_dir / "ffprobe.exe"

    # Closure variable for mapping Remotion sub-range progress to overall frame progress
    # when resuming from cached frames. Set before the Frames rendering call; stays 0
    # for Audio phase and any non-Frames mode where there's no sub-range to offset.
    first_missing_frame_pct = 0.0

    def run_node_process(cmd, progress_weight, base_progress, label):
        import psutil
        total_ram_mb = psutil.virtual_memory().total / (1024 * 1024)
        node_ram_mb = min(8192, max(2048, int(total_ram_mb * 0.75)))
        
        env = os.environ.copy()
        env["NODE_OPTIONS"] = f"--max-old-space-size={node_ram_mb}"
        remotion_cache_dir = get_remotion_cache_dir()

        # In production, redirect cwd to a writable directory so Remotion's
        # getDownloadsCacheDir() doesn't try to create .remotion inside the
        # read-only Program Files installation directory.
        # Also place an anchor package.json so Remotion's root-finding walk
        # stops here instead of traversing up to a read-only parent.
        if is_production():
            node_cwd = str(remotion_cache_dir)
            anchor_pkg = remotion_cache_dir / "package.json"
            if not anchor_pkg.exists():
                anchor_pkg.write_text('{"name":"remotion-cache","private":true}')
        else:
            node_cwd = str(frontend_dir)
        
        startupinfo = get_startupinfo()

        process = subprocess.Popen(
            cmd,
            cwd=node_cwd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            universal_newlines=True,
            startupinfo=startupinfo,
            env=env
        )

        progress_regex = re.compile(r"Render progress:\s*([\d.]+)%")
        bundle_regex = re.compile(r"Bundle ready in")

        try:
            def handle_line(stripped):
                progress_match = progress_regex.search(stripped)
                
                skip_log = False
                if progress_match:
                    pct_val = float(progress_match.group(1))
                    if not hasattr(run_node_process, '_last_logged_pct'):
                        run_node_process._last_logged_pct = -1
                    if abs(pct_val - run_node_process._last_logged_pct) < 5.0 and pct_val < 100:
                        skip_log = True
                    else:
                        run_node_process._last_logged_pct = pct_val

                if not skip_log:
                    logger.info(f"[{label}]: {stripped}")
                    
                if progress_match:
                    pct_val = float(progress_match.group(1))
                    # Map Remotion sub-range progress to overall frame progress so the
                    # displayed percentage reflects all frames, not just the missing range.
                    # E.g. when resuming from frame 2250 of 11701, the first progress
                    # shows ~19.2% instead of 0.0%.
                    overall_pct = first_missing_frame_pct + (pct_val / 100.0) * (100.0 - first_missing_frame_pct)
                    pct = base_progress + (overall_pct / 100.0) * progress_weight
                    progress_cb(min(99.0, pct), f"Rendering {label.lower()}... {overall_pct:.1f}%")
                elif bundle_regex.search(stripped):
                    progress_cb(base_progress, f"Bundling complete. Starting {label.lower()} render...")

            returncode, last_output_lines = _stream_process_output(process, cancel_event, handle_line, label)

            if hasattr(run_node_process, '_last_logged_pct'):
                del run_node_process._last_logged_pct

            if returncode != 0:
                error_details = "\n".join(last_output_lines)
                raise RuntimeError(f"{label} process failed with exit code {returncode}.\nLast output:\n{error_details}")

        except Exception as e:
            raise e

    def run_ffmpeg(cmd, base_progress, progress_weight):
        startupinfo = get_startupinfo()
            
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            universal_newlines=True,
            startupinfo=startupinfo
        )
        
        frame_regex = re.compile(r"frame=\s*(\d+)")
        last_logged_pct = [-1]
        
        def handle_line(stripped):
            match = frame_regex.search(stripped)
            if match and total_frames > 0:
                f = int(match.group(1))
                pct_val = min(100.0, (f / total_frames) * 100.0)
                if pct_val - last_logged_pct[0] >= 5.0 or pct_val >= 100:
                    last_logged_pct[0] = pct_val
                    logger.info(f"[FFmpeg]: {stripped}")
                    
                pct = base_progress + (pct_val / 100.0) * progress_weight
                progress_cb(min(99.0, pct), f"Muxing video... {pct_val:.1f}%")

        returncode, last_output_lines = _stream_process_output(process, cancel_event, handle_line, "FFmpeg")
                
        if returncode != 0:
            error_details = "\n".join(last_output_lines)
            raise RuntimeError(f"FFmpeg failed with exit code {returncode}.\nLast output:\n{error_details}")

    base_node_cmd = [
        node_exe,
        str(render_script),
        "--props", abs_props_path,
        "--fps", str(fps),
        "--codec", render_codec,
        "--crf", str(render_crf),
        "--scale", scale_arg,
        "--concurrency", concurrency_arg,
        "--bundle-dir", abs_bundle_dir,
        "--timeout", str(timeout_ms),
    ]
    if ffmpeg_exe.exists(): base_node_cmd.extend(["--ffmpeg", str(ffmpeg_exe.resolve())])
    if ffprobe_exe.exists(): base_node_cmd.extend(["--ffprobe", str(ffprobe_exe.resolve())])
    if render_hardware == "cuda": base_node_cmd.extend(["--hw-accel", "if-possible"])
    else: base_node_cmd.extend(["--hw-accel", "disable"])

    # Phase 1: Render Frames
    missing_ranges_str = get_missing_frame_ranges(frames_dir, total_frames)
    
    # Broadcast the exact scope to the frontend via progress_cb
    scope_msg = "[Smart Resume] Scope: "
    if missing_ranges_str and not audio_cache_valid:
        scope_msg += "Full re-render"
    elif missing_ranges_str and audio_cache_valid:
        scope_msg += "Frames-only re-render"
    elif not missing_ranges_str and not audio_cache_valid:
        scope_msg += "Audio-only re-render"
    else:
        scope_msg += "Fast mux only"
    
    progress_cb(5.0, scope_msg)

    if missing_ranges_str:
        # Compute the overall frame progress offset so the progress display reflects all
        # frames, not just the sub-range being rendered now.
        try:
            first_missing = int(missing_ranges_str.split(",")[0].split("-")[0])
            first_missing_frame_pct = (first_missing / total_frames) * 100.0 if total_frames > 0 else 0.0
        except (ValueError, IndexError):
            first_missing_frame_pct = 0.0

        progress_cb(10.0, "Starting frame rendering...")
        cmd_frames = list(base_node_cmd)
        cmd_frames.extend([
            "--mode", "frames",
            "--frames-dir", str(frames_dir.resolve()).replace('\\', '/')
        ])
        cmd_frames.extend(["--frames", missing_ranges_str])
        
        logger.info(f"Executing frames render: {' '.join(cmd_frames)}")
        run_node_process(cmd_frames, progress_weight=70.0, base_progress=10.0, label="Frames")
    else:
        logger.info("All frames already rendered. Skipping frame render phase.")
        progress_cb(80.0, "All frames already rendered.")

    # ── Persist Granular Scene Hashes ──────────────────────────────────────
    try:
        with open(scene_cache_file, "w", encoding="utf-8") as f:
            json.dump({
                "global_env_hash": global_env_hash,
                "scenes": current_scene_records
            }, f, indent=2)
    except Exception as e:
        logger.warning(f"Failed to persist scene_hashes.json: {e}")

    # ── Log Smart Resume render scope ──────────────────────────────────────
    frames_actually_rendered = bool(missing_ranges_str)
    summary_parts = []
    if not frames_actually_rendered:
        summary_parts.append("frames cached")
    else:
        summary_parts.append("frames re-rendered")
    if audio_cache_valid:
        summary_parts.append("audio cached")
    else:
        summary_parts.append("audio re-rendering")
    if overrides_active:
        summary_parts.append(f"overrides: {', '.join(overrides_active)}")
    logger.info(f"Smart Resume render scope: {' | '.join(summary_parts)}")

    # Reset the frame progress offset — the Audio phase has no cached sub-range to offset.
    first_missing_frame_pct = 0.0

    # Phase 2: Render Audio (only if cache invalid)
    if not audio_cache_valid:
        progress_cb(80.0, "Extracting audio track (FFmpeg fast mix)...")
        
        voice_path = str(audio_path.resolve())
        bg_path_str = project_dict.get("bg_music_path")
        bg_path = str(Path(bg_path_str).resolve()) if bg_path_str and Path(bg_path_str).exists() else None
        
        voice_vol = float(project_settings.get("voiceover_volume")) if project_settings.get("voiceover_volume") is not None else 1.0
        bg_vol = float(project_dict.get("bg_music_volume")) if project_dict.get("bg_music_volume") is not None else 0.15
        sfx_master = _safe_float(project_settings.get("sfx_volume"),
                                 _safe_float(props.get("sfxVolume"), 0.5))

        if render_track_overrides.get("muteVoice"):
            voice_vol = 0.0
        if render_track_overrides.get("muteMusic"):
            bg_vol = 0.0
        if render_track_overrides.get("muteSfx"):
            sfx_master = 0.0
        mute_video_audio = render_track_overrides.get("muteVideoAudio", False)

        # ── Collect video audio sources from sub-visuals ──────────────────
        video_audio_tracks = []
        # Per-sub-visual audio cut ranges (seconds): mute_voiceover / mute_bg_music
        voice_cuts = []  # (start_sec, end_sec)
        bg_cuts = []     # (start_sec, end_sec)
        for sc, scene_start, scene_frames in scene_frame_offsets(scenes, fps):
            sub_visuals = sc.get("sub_visuals", [])
            timings = compute_sub_visual_timings_frames(sub_visuals, scene_frames, fps)
            for sv, (t_start, t_end) in zip(sub_visuals, timings):
                vol = sv.get("videoVolume") or 0
                if not mute_video_audio and vol > 0:
                    vpath = sv.get("visual_path") or ""
                    if vpath and Path(vpath).exists() and vpath.lower().endswith(('.mp4', '.webm')):
                        video_audio_tracks.append({
                            "path": vpath,
                            "volume": float(vol),
                            "start_time": (scene_start + t_start) / float(fps),
                        })
                if sv.get("mute_voiceover"):
                    voice_cuts.append(((scene_start + t_start) / float(fps), (scene_start + t_end) / float(fps)))
                if sv.get("mute_bg_music"):
                    bg_cuts.append(((scene_start + t_start) / float(fps), (scene_start + t_end) / float(fps)))

        # ── Collect music clip inputs ──────────────────────────────────────
        music_clip_inputs = []
        if not render_track_overrides.get("muteMusic"):
            for mc in cleaned_music_clips:
                mpath = mc.get("audio_path")
                if mpath and Path(mpath).exists() and not mc.get("is_muted"):
                    music_clip_inputs.append(mc)

        has_clips_config = project_dict.get("music_clips") is not None
        has_legacy_bg = (not has_clips_config) and bg_path and bg_vol > 0 and not render_track_overrides.get("muteMusic")

        ffmpeg_bin = str(ffmpeg_exe) if ffmpeg_exe.exists() else "ffmpeg"
        
        cmd_audio = [ffmpeg_bin, "-y"]
        
        # ── Add inputs ────────────────────────────────────────────────────
        # Input 0: voiceover
        cmd_audio.extend(["-i", voice_path])
        input_count = 1

        # Legacy Input 1: bg music (if present and project has never configured music_clips)
        if has_legacy_bg:
            cmd_audio.extend(["-stream_loop", "-1", "-i", bg_path])
            input_count += 1

        # Music clip inputs
        music_clip_start_idx = input_count
        for mc in music_clip_inputs:
            mpath = mc["audio_path"]
            if mc.get("loop", True):
                cmd_audio.extend(["-stream_loop", "-1", "-i", mpath])
            else:
                cmd_audio.extend(["-i", mpath])
            input_count += 1

        # ── Collect SFX clip inputs (one-shots, no loop) ───────────────────
        sfx_clip_inputs = []
        if not render_track_overrides.get("muteSfx"):
            for sc in (cleaned_sfx_clips or []):
                spath = sc.get("audio_path")
                if spath and Path(spath).exists() and not sc.get("is_muted"):
                    sfx_clip_inputs.append(sc)

        sfx_clip_start_idx = input_count
        for sc in sfx_clip_inputs:
            if sc.get("loop"):
                cmd_audio.extend(["-stream_loop", "-1", "-i", sc["audio_path"]])
            else:
                cmd_audio.extend(["-i", sc["audio_path"]])
            input_count += 1

        # Probe audio streams for each video track using ffprobe
        video_audio_inputs = []
        ffprobe_bin = str(ffprobe_exe) if ffprobe_exe.exists() else "ffprobe"
        for vat in video_audio_tracks:
            try:
                probe_cmd = [ffprobe_bin, "-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", vat["path"]]
                probe_result = subprocess.run(probe_cmd, capture_output=True, text=True, timeout=10, startupinfo=get_startupinfo())
                has_audio_stream = probe_result.returncode == 0 and probe_result.stdout.strip() == "audio"
                if has_audio_stream:
                    cmd_audio.extend(["-i", vat["path"]])
                    video_audio_inputs.append(vat)
                else:
                    logger.info(f"Skipping video audio — no audio stream in {vat['path']}")
            except Exception as e:
                logger.warning(f"Failed to probe audio stream for {vat['path']}: {e}")

        # ── Build filter_complex ──────────────────────────────────────────
        total_inputs = input_count + len(video_audio_inputs)
        filter_parts = []
        mix_inputs = []

        # Chain per-sub-visual cut ranges: volume=0:enable='gte(t,s)*lt(t,e)'.
        def _apply_cuts(vol: float, cuts: list) -> str:
            if not cuts:
                return f"volume={vol:.3f}"
            parts = [f"volume={vol:.3f}"]
            for s, e in cuts:
                parts.append(f"volume=0:enable='gte(t,{s:.3f})*lt(t,{e:.3f})'")
            return ",".join(parts)

        # Voiceover
        voice_filter = _apply_cuts(voice_vol, voice_cuts)
        filter_parts.append(f"[0:a]{voice_filter}[voice]")
        mix_inputs.append("[voice]")

        # Legacy BG music (if present)
        if has_legacy_bg:
            bg_filter = _apply_cuts(bg_vol, bg_cuts)
            filter_parts.append(f"[1:a]{bg_filter}[bg]")
            mix_inputs.append("[bg]")

        # Music clips
        for idx, mc in enumerate(music_clip_inputs):
            in_idx = music_clip_start_idx + idx
            start_sec = max(0.0, _safe_float(mc.get("start_frame"), 0.0) / float(fps))
            dur_sec = max(0.1, _safe_float(mc.get("duration_frames"), 30.0) / float(fps))
            src_start = max(0.0, _safe_float(mc.get("source_start_seconds"), 0.0))
            fade_in = max(0.0, _safe_float(mc.get("fade_in_seconds"), 0.0))
            fade_out = max(0.0, _safe_float(mc.get("fade_out_seconds"), 0.0))
            master_vol_mult = (bg_vol / 0.15) if (bg_vol is not None and bg_vol >= 0) else 1.0
            clip_vol = max(0.0, _safe_float(mc.get("volume"), 0.2) * master_vol_mult)

            mc_filters = []
            if src_start > 0:
                mc_filters.append(f"atrim=start={src_start:.3f}:duration={dur_sec:.3f},asetpts=PTS-STARTPTS")
            else:
                mc_filters.append(f"atrim=duration={dur_sec:.3f},asetpts=PTS-STARTPTS")

            if fade_in > 0:
                mc_filters.append(f"afade=t=in:st=0:d={min(fade_in, dur_sec):.3f}")
            if fade_out > 0:
                st_out = max(0.0, dur_sec - fade_out)
                mc_filters.append(f"afade=t=out:st={st_out:.3f}:d={min(fade_out, dur_sec):.3f}")

            # Overlapping bg cuts
            clip_end_sec = start_sec + dur_sec
            for s, e in bg_cuts:
                if max(s, start_sec) < min(e, clip_end_sec):
                    rel_s = max(0.0, s - start_sec)
                    rel_e = min(dur_sec, e - start_sec)
                    mc_filters.append(f"volume=0:enable='gte(t,{rel_s:.3f})*lt(t,{rel_e:.3f})'")

            mc_filters.append(f"volume={clip_vol:.3f}")
            delay_ms = int(start_sec * 1000)
            if delay_ms > 0:
                mc_filters.append(f"adelay={delay_ms}:all=1")

            filter_parts.append(f"[{in_idx}:a]" + ",".join(mc_filters) + f"[bgc{idx}]")
            mix_inputs.append(f"[bgc{idx}]")

        # SFX clips (same trim/fade/delay chain as music, no loop, no bg-cut ducking)
        for idx, sc in enumerate(sfx_clip_inputs):
            in_idx = sfx_clip_start_idx + idx
            start_sec = max(0.0, _safe_float(sc.get("start_frame"), 0.0) / float(fps))
            dur_sec = max(0.1, _safe_float(sc.get("duration_frames"), 30.0) / float(fps))
            src_start = max(0.0, _safe_float(sc.get("source_start_seconds"), 0.0))
            fade_in = max(0.0, _safe_float(sc.get("fade_in_seconds"), 0.0))
            fade_out = max(0.0, _safe_float(sc.get("fade_out_seconds"), 0.0))
            # Clamp fades to half the clip: overlapping in+out ramps would
            # cancel each other and silence short SFX in the export.
            max_fade = dur_sec / 2.0
            fade_in = min(fade_in, max_fade)
            fade_out = min(fade_out, max_fade)
            clip_vol = max(0.0, _safe_float(sc.get("volume"), 0.5))

            sfx_filters = []
            if src_start > 0:
                sfx_filters.append(f"atrim=start={src_start:.3f}:duration={dur_sec:.3f},asetpts=PTS-STARTPTS")
            else:
                sfx_filters.append(f"atrim=duration={dur_sec:.3f},asetpts=PTS-STARTPTS")
            if fade_in > 0:
                sfx_filters.append(f"afade=t=in:st=0:d={min(fade_in, dur_sec):.3f}")
            if fade_out > 0:
                st_out = max(0.0, dur_sec - fade_out)
                sfx_filters.append(f"afade=t=out:st={st_out:.3f}:d={min(fade_out, dur_sec):.3f}")
            master_mult = (sfx_master / 0.5) if sfx_master is not None and sfx_master >= 0 else 1.0
            sfx_filters.append(f"volume={max(0.0, clip_vol * master_mult):.3f}")
            delay_ms = int(start_sec * 1000)
            if delay_ms > 0:
                sfx_filters.append(f"adelay={delay_ms}:all=1")

            filter_parts.append(f"[{in_idx}:a]" + ",".join(sfx_filters) + f"[sfx{idx}]")
            mix_inputs.append(f"[sfx{idx}]")

        # Video audio tracks
        for i, vat in enumerate(video_audio_inputs):
            vidx = input_count + i
            delay_ms = int(vat["start_time"] * 1000)
            vol = vat["volume"]
            if delay_ms > 0:
                filter_parts.append(f"[{vidx}:a]volume={vol},adelay={delay_ms}:all=1[va{i}]")
            else:
                filter_parts.append(f"[{vidx}:a]volume={vol}[va{i}]")
            mix_inputs.append(f"[va{i}]")

        if total_inputs > 1:
            amix_expr = "".join(mix_inputs) + f"amix=inputs={total_inputs}:duration=first:normalize=0[aout]"
            filter_parts.append(amix_expr)
            filter_str = ";".join(filter_parts)
            cmd_audio.extend(["-filter_complex", filter_str, "-map", "[aout]", "-ac", "2", "-ar", "44100"])
        elif voice_vol != 1.0 or voice_cuts:
            # Single voice input with volume adjustment and/or cut ranges
            cmd_audio.extend(["-filter_complex", f"[0:a]{voice_filter}[aout]", "-map", "[aout]", "-ac", "2", "-ar", "44100"])
        else:
            cmd_audio.extend(["-c:a", "copy"])

        cmd_audio.append(str(cached_audio_path.resolve()).replace('\\', '/'))
        
        logger.info(f"Executing audio render (Direct FFmpeg): {' '.join(cmd_audio)}")
        try:
            # Bypass Remotion/Node completely and execute FFmpeg directly
            subprocess.run(cmd_audio, capture_output=True, text=True, check=True, startupinfo=get_startupinfo())
            
            # Write audio hash AFTER successful render
            audio_hash_file.write_text(audio_hash)
        except subprocess.CalledProcessError as e:
            logger.error(f"FFmpeg audio mixing failed.\nLast output:\n{e.stderr}")
            raise RuntimeError(f"FFmpeg audio mixing failed.\nLast output:\n{e.stderr}")
    else:
        logger.info("Audio cache valid. Skipping audio render phase.")

    # Phase 3: FFmpeg Muxing
    progress_cb(90.0, "Muxing final video...")
    ffmpeg_bin = str(ffmpeg_exe) if ffmpeg_exe.exists() else "ffmpeg"
    
    # Ensure all frames are within total_frames and remove any lingering leftover frames
    for f in list(frames_dir.glob("element-*.*")):
        m = re.search(r"element-(\d+)\.", f.name)
        if m and int(m.group(1)) >= total_frames:
            try:
                f.unlink()
            except OSError:
                pass

    # Normalize frame filenames to consistent padding and auto-detect image extension.
    # Remotion's renderFrames may produce unpadded names for single-frame ranges
    # (e.g. element-474.jpeg) mixed with padded names for multi-frame ranges.
    # Without normalization, FFmpeg's %0Nd pattern misses unpadded files.
    frame_files_list = list(frames_dir.glob("element-*.jpeg")) or list(frames_dir.glob("element-*.jpg")) or list(frames_dir.glob("element-*.webp"))
    if not frame_files_list:
        raise RuntimeError(f"No frames found in {frames_dir}")

    # Determine the file extension of the rendered frames
    frame_ext = frame_files_list[0].suffix.lstrip(".")

    max_frame = 0
    for f in frame_files_list:
        m = re.search(r"element-(\d+)\.(?:jpeg|jpg|webp)", f.name)
        if m:
            max_frame = max(max_frame, int(m.group(1)))

    normalized_padding = max(len(str(max_frame)), 4)
    for f in frame_files_list:
        m = re.search(r"element-(\d+)\.(?:jpeg|jpg|webp)", f.name)
        if m:
            frame_num = int(m.group(1))
            expected_name = f"element-{frame_num:0{normalized_padding}d}.{frame_ext}"
            if f.name != expected_name:
                dest = f.parent / expected_name
                f.replace(dest)

    frame_input_pattern = f"element-%0{normalized_padding}d.{frame_ext}"

    # ── Dropout repair (flicker fix) ─────────────────────────────────
    # Headless Chromium occasionally captures a blank/torn video frame
    # mid-playback (seek-presentation race under concurrency). Such a frame
    # decorrelates from BOTH neighbors while the neighbors agree with each
    # other — a 1-frame hold (copy the previous neighbor over it) is
    # invisible at 30fps and removes the visible flash from the MP4.
    # Gradual changes (fades, slides, motion, dark scenes) keep high
    # neighbor correlation and are never touched. Authored strobe windows
    # (flash/glitch peaks) are exempt so intentional spikes survive.
    # Best-effort: repairs a copy-safe file swap and never fails the render
    # on error.
    _strobe_exempt = _strobe_window_frames(scenes, fps)
    _repair_dropout_frames(frames_dir, total_frames, frame_ext,
                           normalized_padding, exempt_frames=_strobe_exempt)

    loudnorm_available = _ffmpeg_has_filter(ffmpeg_bin, "loudnorm")
    if not loudnorm_available:
        logger.warning("ffmpeg lacks the loudnorm filter — muxing without "
                       "loudness normalization (qa_gate loudness check will "
                       "fall back to mix defaults).")
    ffmpeg_cmd = [
        ffmpeg_bin, "-y",
        "-threads", str(max(1, (os.cpu_count() or 4) - 1)),
        "-framerate", str(fps),
        "-i", str(frames_dir / frame_input_pattern),
        "-i", str(cached_audio_path),
        "-c:v", "libx264" if render_codec == "h264" else render_codec,
        "-preset", "fast",
        "-crf", str(render_crf),
        "-movflags", "+faststart",
    ]
    if loudnorm_available:
        ffmpeg_cmd.extend([
            "-filter:a",
            f"loudnorm=I={LOUDNESS_TARGET_I}:TP={LOUDNESS_TARGET_TP}:LRA={LOUDNESS_TARGET_LRA}",
        ])
    ffmpeg_cmd.extend([
        "-c:a", "aac",
        "-b:a", "256k",
        "-pix_fmt", "yuv420p",
        str(output_mp4_path)
    ])
    
    logger.info(f"Running FFmpeg muxing: {' '.join(ffmpeg_cmd)}")
    run_ffmpeg(ffmpeg_cmd, base_progress=90.0, progress_weight=9.0)

    # Frames cache preserved for future resume

    if not output_mp4_path.exists():
        raise FileNotFoundError(f"Pipeline completed but output file was not found at: {output_mp4_path}")

    # Loudness sidecar (best-effort, never fails the render): ebur128
    # measurement of the finished file for qa_gate + receipts.
    try:
        progress_cb(99.0, "Measuring loudness...")
        measured = (measure_integrated_lufs(ffmpeg_bin, output_mp4_path)
                    if _ffmpeg_has_filter(ffmpeg_bin, "ebur128") else None)
        loudness_doc = {
            "target_i": LOUDNESS_TARGET_I,
            "target_tp": LOUDNESS_TARGET_TP,
            "target_lra": LOUDNESS_TARGET_LRA,
            "integrated_lufs": measured,
            "normalized": bool(loudnorm_available),
            "video_path": str(output_mp4_path),
        }
        with open(project_dir / "render_loudness.json", "w", encoding="utf-8") as f:
            json.dump(loudness_doc, f, indent=2)
        logger.info(f"Render loudness: {measured} LUFS "
                    f"(target {LOUDNESS_TARGET_I}, "
                    f"{'normalized' if loudnorm_available else 'NOT normalized'})")
    except Exception as e:
        logger.warning(f"Loudness sidecar skipped: {e}")

    update_project(project_dict['id'], video_path=str(output_mp4_path))
    progress_cb(100.0, "Video compilation complete!")
    logger.info(f"Video compiled successfully! MP4 exported to: {output_mp4_path}")
