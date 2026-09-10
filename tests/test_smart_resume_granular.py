"""Granular Smart Resume tests: per-section TTS resume, unified step
resolution, deterministic asset metadata, hidden-subtitle frame hashing."""
import json
import pytest
from pathlib import Path

from backend.pipeline.queue import resolve_steps_to_queue
from backend.pipeline.tts import (
    find_reusable_voice_segment,
    _tts_entry_settings_match,
)
from backend.pipeline.assets import strip_volatile_ast_keys
from backend.pipeline.render import compute_granular_frame_hashes

ALL = ['generate_script', 'generate_voiceover', 'transcribe',
       'generate_visuals', 'fetch_assets', 'render']


def _completed(*, missing=()):
    return {s for s in ALL if s not in missing}


# ── Gap 2: unified step resolution ─────────────────────────────────────

def test_voiceover_change_skips_visuals_and_assets():
    stale = {'generate_voiceover'}
    got = resolve_steps_to_queue(ALL, _completed(), lambda s: s in stale, set())
    assert got == ['generate_voiceover', 'transcribe', 'render']


def test_script_change_runs_everything():
    stale = {'generate_script'}
    got = resolve_steps_to_queue(ALL, _completed(), lambda s: s in stale, set())
    assert got == ALL


def test_visuals_change_pulls_assets_and_render_only():
    stale = {'generate_visuals'}
    got = resolve_steps_to_queue(ALL, _completed(), lambda s: s in stale, set())
    assert got == ['generate_visuals', 'fetch_assets', 'render']


def test_nothing_stale_queues_nothing():
    got = resolve_steps_to_queue(ALL, _completed(), lambda s: False, set())
    assert got == []


def test_forced_first_step_with_fresh_rest():
    # Forced "Resume from Stage" on voiceover: downstream stays content-aware.
    got = resolve_steps_to_queue(ALL, _completed(), lambda s: False,
                                 forced_steps={'generate_voiceover'})
    assert got == ['generate_voiceover', 'transcribe', 'render']


def test_never_completed_step_still_runs_with_propagation():
    got = resolve_steps_to_queue(ALL, _completed(missing=('transcribe',)),
                                 lambda s: False, set())
    assert got == ['transcribe', 'render']


def test_subset_range_respected():
    sub = ['generate_voiceover', 'transcribe', 'generate_visuals', 'fetch_assets', 'render']
    stale = {'generate_voiceover'}
    got = resolve_steps_to_queue(sub, _completed(), lambda s: s in stale, set())
    assert got == ['generate_voiceover', 'transcribe', 'render']


# ── Gap 1: per-section TTS resume ──────────────────────────────────────

def _old_manifest(tmp_path):
    seg0 = tmp_path / "segment_000.wav"
    seg1 = tmp_path / "segment_001.wav"
    seg0.write_bytes(b"wav0")
    seg1.write_bytes(b"wav1")
    return [
        {"index": 0, "section_type": "introduction", "title": "Introduction",
         "text": "Hello", "audio_path": str(seg0), "duration": 2.5,
         "_voiceover_engine": "edge", "_voiceover_voice": "V1",
         "_voiceover_speed": "1.0", "_voiceover_pitch": "0"},
        {"index": 1, "section_type": "scene", "title": "S1",
         "text": "Story", "audio_path": str(seg1), "duration": 4.0,
         "_voiceover_engine": "edge", "_voiceover_voice": "V1",
         "_voiceover_speed": "1.0", "_voiceover_pitch": "0"},
    ]


def test_reuse_identical_section(tmp_path):
    old = _old_manifest(tmp_path)
    path, dur = find_reusable_voice_segment("scene", "Story", old, "edge", "1.0", "0", "V1")
    assert path == str(tmp_path / "segment_001.wav")
    assert dur == 4.0


def test_no_reuse_on_text_change(tmp_path):
    old = _old_manifest(tmp_path)
    assert find_reusable_voice_segment("scene", "Different", old, "edge", "1.0", "0", "V1") == (None, None)


def test_no_reuse_on_voice_or_speed_change(tmp_path):
    old = _old_manifest(tmp_path)
    assert find_reusable_voice_segment("scene", "Story", old, "edge", "1.0", "0", "V2") == (None, None)
    assert find_reusable_voice_segment("scene", "Story", old, "edge", "1.5", "0", "V1") == (None, None)
    assert find_reusable_voice_segment("scene", "Story", old, "xtts", "1.0", "0", "V1") == (None, None)


def test_no_reuse_when_file_missing(tmp_path):
    old = _old_manifest(tmp_path)
    (tmp_path / "segment_001.wav").unlink()
    assert find_reusable_voice_segment("scene", "Story", old, "edge", "1.0", "0", "V1") == (None, None)


def test_reuse_survives_reorder(tmp_path):
    # New order: scene first, intro second — key matching still reuses both.
    old = _old_manifest(tmp_path)
    path, _ = find_reusable_voice_segment("introduction", "Hello", old, "edge", "1.0", "0", "V1")
    assert path == str(tmp_path / "segment_000.wav")


def test_settings_match_pitch_normalization():
    entry = {"_voiceover_engine": "edge", "_voiceover_voice": "V1",
             "_voiceover_speed": 1.0, "_voiceover_pitch": "0Hz"}
    assert _tts_entry_settings_match(entry, "edge", "1.0", "0", "V1") is True
    assert _tts_entry_settings_match(entry, "edge", "1.0", "+5Hz", "V1") is False


# ── Gap 4: asset_url is provenance metadata, not structure ─────────────

def test_strip_ignores_asset_url_and_duration():
    a = [{"composition": {"type": "Sequence", "children": [
        {"type": "Layer", "content": {"type": "Image", "query": "city",
                                      "local_path": "/x.jpg",
                                      "asset_url": "https://cdn/img1.jpg"}}]},
        "duration": 5.0}]
    b = [{"composition": {"type": "Sequence", "children": [
        {"type": "Layer", "content": {"type": "Image", "query": "city"}}]},
        "duration": 7.5}]
    assert strip_volatile_ast_keys(a) == strip_volatile_ast_keys(b)


# ── Gap 5: hidden subtitles don't poison frame hashes ──────────────────

def _props(hidden):
    scene = {"title": "S", "duration": 10.0, "sub_visuals": []}
    segments_a = [{"start": 0.0, "end": 2.0, "text": "hi",
                   "words": [{"start": 0.0, "end": 0.5, "word": "hi"}]}]
    settings = {"hide_subtitles": hidden} if hidden else {}
    return {"scenes": [scene], "fps": 30,
            "transcription": {"segments": segments_a},
            "subtitleSettings": settings, "style": "s", "language": "en",
            "videoFormat": "landscape", "overlays": [], "quality": {}}


def test_hidden_subtitles_ignore_timing_changes():
    _, rec_hidden_a = compute_granular_frame_hashes(_props(True), {"resolution": "1080p"})
    props_b = _props(True)
    props_b["transcription"] = {"segments": [
        {"start": 0.0, "end": 3.0, "text": "hi there",
         "words": [{"start": 0.0, "end": 1.0, "word": "hi"}]}]}
    _, rec_hidden_b = compute_granular_frame_hashes(props_b, {"resolution": "1080p"})
    assert [r["scene_hash"] for r in rec_hidden_a] == [r["scene_hash"] for r in rec_hidden_b]


def test_visible_subtitles_detect_timing_changes():
    _, rec_a = compute_granular_frame_hashes(_props(False), {"resolution": "1080p"})
    props_b = _props(False)
    props_b["transcription"] = {"segments": [
        {"start": 0.0, "end": 3.0, "text": "hi there",
         "words": [{"start": 0.0, "end": 1.0, "word": "hi"}]}]}
    _, rec_b = compute_granular_frame_hashes(props_b, {"resolution": "1080p"})
    assert [r["scene_hash"] for r in rec_a] != [r["scene_hash"] for r in rec_b]
