"""Shared duration/scene pacing targets for Narrato videos.

Single source of truth for MCP + internal pipeline so both agree on
how many scenes a given (duration_mode, video_format) requires.
Mirrors backend/pipeline/ai.py generate_script_pipeline scene-count matrix.
"""

# Words/sec for word-budget math (matches scriptwriter SKILL.md).
# NOTE: backend/pipeline/ai.py uses hi=4.5 (syllables/sec) for the same
# variable name — that is a syllable rate, not a word rate. MCP pacing
# intentionally uses 2.5 words/sec for Hindi so agent word budgets match
# the documented `Target Seconds x 2.5` formula. Do not "fix" this to 4.5
# without also updating scriptwriter/SKILL.md and ai.py together.
LANGUAGE_WORD_RATE = {"hi": 2.5, "en": 3.0, "mr": 4.0, "bn": 4.0, "ta": 3.5, "te": 3.5}

# Valid combos per create_project intake. Anything else is rejected at
# intake (server.py) instead of silently remapped here.
VALID_COMBOS = {
    "landscape": {"medium", "long", "extra_long"},
    "portrait": {"short", "medium", "long"},
}


def get_pacing(duration_mode: str = "medium", video_format: str = "landscape",
               language: str = "en") -> dict:
    dm = (duration_mode or "medium").strip().lower()
    vf = (video_format or "landscape").strip().lower()
    lang = (language or "en").strip().lower()

    if vf == "portrait":
        if dm == "short":
            min_scenes, max_scenes, target_duration = 4, 6, 60
        elif dm == "long":
            min_scenes, max_scenes, target_duration = 8, 12, 120
        else:  # medium (90s) — also fallback for invalid portrait modes
            min_scenes, max_scenes, target_duration = 6, 8, 90
            if dm != "medium":
                dm = "medium"
    else:
        vf = "landscape"
        if dm == "extra_long":
            min_scenes, max_scenes, target_duration = 60, 75, 900
        elif dm == "long":
            min_scenes, max_scenes, target_duration = 40, 55, 600
        else:  # medium (~5 min) — also fallback for invalid landscape modes
            min_scenes, max_scenes, target_duration = 20, 30, 300
            dm = "medium"

    speaking_rate = LANGUAGE_WORD_RATE.get(lang, 3.0)
    # ~15s reserved for intro + conclusion; mirrors ai.py
    per_scene_time = max(5, (target_duration - 15) // max_scenes)
    per_scene_words = max(10, int(per_scene_time * speaking_rate))
    total_words = int(target_duration * speaking_rate)

    return {
        "duration_mode": dm,
        "video_format": vf,
        "language": lang,
        "target_duration_seconds": target_duration,
        "min_scenes": min_scenes,
        "max_scenes": max_scenes,
        "per_scene_time": per_scene_time,
        "per_scene_words": per_scene_words,
        "speaking_rate": speaking_rate,
        "per_scene_duration_label": f"{per_scene_time}s",
        "per_scene_words_label": f"~{per_scene_words} words",
        "total_script_words_label": f"~{total_words} words",
        "total_script_words": total_words,
    }


def pacing_summary(pacing: dict) -> str:
    return (
        f"{pacing['target_duration_seconds']}s total -> "
        f"{pacing['min_scenes']}-{pacing['max_scenes']} scenes "
        f"(~{pacing['per_scene_time']}s / ~{pacing['per_scene_words']} words each)"
    )
