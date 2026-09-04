import os
import json
import pytest
from pathlib import Path
from backend.database.db import get_project, update_project
from backend.pipeline.render import (
    _safe_float,
    compute_audio_hash,
    compute_frame_hash,
    compute_mux_hash,
    is_render_stale,
    prepare_render_props_and_settings
)

@pytest.fixture
def sample_project_data(tmp_path):
    """Create a temporary project directory with audio and dummy assets."""
    p_dir = tmp_path / "test_project"
    p_dir.mkdir()
    (p_dir / "voiceover").mkdir()
    (p_dir / "audio").mkdir()

    # Create dummy voiceover wav
    voice_wav = p_dir / "voiceover" / "voiceover.wav"
    voice_wav.write_bytes(b"RIFFdummywavdata" * 10)

    # Create dummy bg music mp3
    bg_mp3 = p_dir / "audio" / "track1.mp3"
    bg_mp3.write_bytes(b"ID3dummybgmdata" * 10)

    # Create dummy assets manifest and transcription
    manifest = p_dir / "assets_manifest.json"
    manifest.write_text(json.dumps({"assets": []}))

    transcription = p_dir / "subtitles"
    transcription.mkdir()
    (transcription / "transcription.json").write_text(json.dumps({"segments": []}))

    proj_dict = {
        "id": "e2e_test_project",
        "name": "E2E Test Project",
        "audio_path": str(voice_wav),
        "bg_music_path": str(bg_mp3),
        "bg_music_volume": 0.15,
        "style": "nitish_rajput",
        "language": "hi",
        "video_format": "landscape",
        "assets_manifest_path": str(manifest),
        "transcription_path": str(transcription / "transcription.json"),
        "music_clips": json.dumps([
            {
                "id": "clip_1",
                "name": "track1.mp3",
                "audio_path": str(bg_mp3),
                "start_frame": 0,
                "duration_frames": 180,
                "source_start_seconds": 0.0,
                "source_duration_seconds": 10.0,
                "volume": 0.2,
                "loop": True,
                "fade_in_seconds": 0.5,
                "fade_out_seconds": 1.0,
                "is_muted": False,
            }
        ]),
        "settings": json.dumps({
            "voiceover_volume": 1.0,
            "render_resolution": "1080p",
            "render_fps": 30,
            "render_concurrency": 2,
            "render_timeout": 600000,
        }),
        "scenes": json.dumps([
            {
                "scene_id": "sc_1",
                "duration": 6.0,
                "sub_visuals": [
                    {
                        "id": "sv_1",
                        "visual_type": "image",
                        "visual_path": "",
                        "mute_bg_music": False,
                    }
                ]
            }
        ])
    }
    return proj_dict, p_dir


def test_volume_zero_is_not_falsy(sample_project_data):
    """Test that volume 0.0 is strictly preserved and not overwritten by default."""
    proj_dict, p_dir = sample_project_data
    proj_dict["bg_music_volume"] = 0.0
    
    settings = {"voiceover_volume": 0.0}
    proj_dict["project_settings"] = json.dumps(settings)

    props, r_settings = prepare_render_props_and_settings(proj_dict, p_dir)[:2]
    assert props["bgMusicVolume"] == 0.0
    assert props["voiceoverVolume"] == 0.0


def test_mute_music_track_override_clears_clips(sample_project_data):
    """Test that muteMusic track override zeroes volume and empties musicClips."""
    proj_dict, p_dir = sample_project_data
    proj_dict["project_settings"] = json.dumps({"render_mute_music": True})
    props, _ = prepare_render_props_and_settings(proj_dict, p_dir)[:2]
    assert props["bgMusicVolume"] == 0.0
    assert props["musicClips"] == []


def test_audio_visual_hash_independence(sample_project_data):
    """Test that changing music parameters ONLY alters the audio hash, leaving frame hash identical."""
    proj_dict, p_dir = sample_project_data

    # Initial hashes
    props1, settings1 = prepare_render_props_and_settings(proj_dict, p_dir)[:2]
    frame_hash_1 = compute_frame_hash(props1, settings1)
    audio_hash_1 = compute_audio_hash(props1, settings1)

    # Mutate ONLY audio: trim music clip duration and change volume
    clips = json.loads(proj_dict["music_clips"])
    clips[0]["duration_frames"] = 300
    clips[0]["volume"] = 0.5
    proj_dict["music_clips"] = json.dumps(clips)

    props2, settings2 = prepare_render_props_and_settings(proj_dict, p_dir)[:2]
    frame_hash_2 = compute_frame_hash(props2, settings2)
    audio_hash_2 = compute_audio_hash(props2, settings2)

    # Frame hash MUST be invariant to audio edits!
    assert frame_hash_1 == frame_hash_2, "Frame hash should not change when only audio/music is edited!"
    # Audio hash MUST detect the edit!
    assert audio_hash_1 != audio_hash_2, "Audio hash must change when music clips are edited!"


def test_visual_hash_independence(sample_project_data):
    """Test that changing visuals ONLY alters the frame hash, leaving audio hash identical."""
    proj_dict, p_dir = sample_project_data

    props1, settings1 = prepare_render_props_and_settings(proj_dict, p_dir)[:2]
    frame_hash_1 = compute_frame_hash(props1, settings1)
    audio_hash_1 = compute_audio_hash(props1, settings1)

    # Mutate ONLY visuals: add an overlay
    script_path = p_dir / "script.json"
    script_path.write_text(json.dumps({
        "overlays": [{"id": "ov_1", "name": "Watermark", "logo_url": ""}]
    }))

    props2, settings2 = prepare_render_props_and_settings(proj_dict, p_dir)[:2]
    frame_hash_2 = compute_frame_hash(props2, settings2)
    audio_hash_2 = compute_audio_hash(props2, settings2)

    # Frame hash MUST change
    assert frame_hash_1 != frame_hash_2, "Frame hash must change when overlays are edited!"
    # Audio hash MUST be invariant to visual edits!
    assert audio_hash_1 == audio_hash_2, "Audio hash should not change when only visuals/overlays change!"


def test_smart_resume_detects_empty_frames_as_stale(sample_project_data):
    """Test that an empty frames directory is recognized as stale even if hash files exist."""
    proj_dict, p_dir = sample_project_data
    cache_dir = p_dir / "render_cache"
    cache_dir.mkdir()
    frames_dir = cache_dir / "frames"
    frames_dir.mkdir()

    # Create dummy output MP4
    exports_dir = p_dir / "exports"
    exports_dir.mkdir()
    proj_dict["export_folder"] = str(exports_dir)
    dummy_mp4 = exports_dir / "E2E_Test_Project.mp4"
    dummy_mp4.write_bytes(b"mp4data" * 10)

    props, settings = prepare_render_props_and_settings(proj_dict, p_dir)[:2]
    (cache_dir / "frame.hash.txt").write_text(compute_frame_hash(props, settings))
    (cache_dir / "audio.hash.txt").write_text(compute_audio_hash(props, settings))
    (cache_dir / "mux.hash.txt").write_text(compute_mux_hash("f", "a", settings))
    (cache_dir / "audio.wav").write_bytes(b"wavdata")

    # Frames dir is currently empty (0 element-*.* images)
    assert is_render_stale(proj_dict, p_dir) is True

    # Now populate with 1 frame
    (frames_dir / "element-00001.jpeg").write_bytes(b"jpeg")
    
    # Now that frames exist and hashes match, it should NOT be stale
    curr_fh = compute_frame_hash(props, settings)
    curr_ah = compute_audio_hash(props, settings)
    (cache_dir / "mux.hash.txt").write_text(compute_mux_hash(curr_fh, curr_ah, settings))
    
    assert is_render_stale(proj_dict, p_dir) is False
