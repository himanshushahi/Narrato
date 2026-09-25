# Smart Resume & Pipeline Caching Architecture

This document provides a comprehensive technical reference for the **Smart Resume** system and **Timeline Synchronization Engine** in Remotion Canvas.

---

## 1. Executive Summary

The video creation pipeline consists of 6 sequential, computationally intensive stages:

```
[1. Script & Design] ──> [2. Voiceover TTS] ──> [3. Transcribe Align] ──> [4. AST Visuals] ──> [5. Asset Ingestion] ──> [6. Final Render]
```

**Smart Resume** is an intelligent incremental computation and caching system designed to:
1. **Prevent Redundant LLM & GPU Work**: If an upstream stage (e.g., narration or TTS voiceover) has not changed, its cached artifacts and manifest are preserved intact.
2. **Support Non-Linear Timeline Editing**: When a user adjusts scene boundaries, splits cuts, tweaks layer styles, or mutes audio tracks, only the minimal downstream sub-range is invalidated and recomputed.
3. **Multi-Domain Render Hashing**: Decouples video frame rendering from audio mixing so changing a background music volume or muting voiceover does not trigger a full visual re-render of hundreds of frames.

---

## 2. High-Level Architecture & Topological Cascade

```mermaid
flowchart TD
    Start(["User triggers 'Resume Pipeline' or 'Resume from Stage'"]) --> QM["QueueManager (backend/pipeline/queue.py)"]
    QM --> Eval["Evaluate EVERY stage with its own is_*_stale()<br/>No blanket downstream invalidation"]
    
    subgraph S1 ["Stage 1: Script & Design System"]
        Eval --> C1{"is_script_stale()?<br/>Checks _project_hash"}
        C1 -- "Changed / Missing" --> RunS1["Execute: generate_script_pipeline<br/>(Outline + Scene Writer + Art Director)"]
        C1 -- "Unchanged" --> C2
    end

    subgraph S2 ["Stage 2: Voiceover Speech Synthesis"]
        RunS1 --> PropV["Propagate: script regen invalidates all downstream"]
        PropV --> RunS2["Execute: generate_voiceover_pipeline<br/>(Per-section TTS resume + Stitching<br/>+ in-place visual duration resync)"]
        C2{"is_voiceover_stale()?<br/>Checks _content_hash & TTS Engine/Voice/Mtime"}
        C2 -- "Changed / Audio Missing" --> RunS2
        C2 -- "Unchanged" --> C3
    end

    subgraph S3 ["Stage 3: Whisper Forced Alignment"]
        RunS2 --> PropT["Propagate: new audio forces transcribe + render ONLY<br/>(visuals & assets NOT invalidated)"]
        PropT --> RunS3["Execute: transcribe_pipeline<br/>(Word-level Alignment)"]
        C3{"is_transcribe_stale()?<br/>Checks _transcribe_hash & JSON exist"}
        C3 -- "Changed / JSON Missing" --> RunS3
        C3 -- "Unchanged" --> C4
    end

    subgraph S4 ["Stage 4: AST Visuals & Smart Preservation"]
        RunS3 --> PropR1["Propagate: new word timings force render ONLY"]
        PropR1 --> C6
        RunS1 --> PropV4["Propagate: new narration forces visuals + assets + render"]
        PropV4 --> RunS4["Execute: generate_visuals_pipeline"]
        C4{"is_visuals_stale()?<br/>sub_visuals present AND narration/design hashes match"}
        C4 -- "Missing / Narration Changed / Design Changed" --> RunS4
        C4 -- "Present & Hashes Match (pure voice re-run)" --> SkipV["SKIP visuals entirely<br/>(0s, 0 LLM tokens)"]
        SkipV --> C5
        
        RunS4 --> SP{"Per-Scene Smart Preservation<br/>(_narr_hash & _design_hash)"}
        SP -- "Narration / Design Unchanged" --> Preserve["Scale sub-visual durations<br/>Skip LLM storyboard/AST call"]
        SP -- "Narration / Design Changed" --> LLM["LLM Visual Director & Storyboard<br/>Draft new declarative AST"]
    end

    subgraph S5 ["Stage 5: Media Asset Resolution"]
        Preserve --> ForceS5["Mark assets+render stale (new AST queries)"]
        LLM --> ForceS5
        ForceS5 --> RunS5["Execute: fetch_assets_pipeline<br/>(Pexels / Media Downloader + Cleanup)"]
        C5{"is_assets_stale()?<br/>Duration-agnostic AST match + file presence"}
        C5 -- "Files Missing / AST Structure Differ" --> RunS5
        C5 -- "Unchanged (duration-only diffs ignored)" --> SkipA["SKIP asset downloads"]
        SkipA --> C6
    end

    subgraph S6 ["Stage 6: Multi-Domain Incremental Render"]
        RunS5 --> RunS6["Execute: render_pipeline"]
        C6{"Video Missing on Disk?"}
        C6 -- "Yes" --> RunS6
        C6 -- "No" --> Done(["Pipeline Complete (0s spent)"])
        
        RunS6 --> HashEval["Compute Multi-Domain Hashes:<br/>• frame_hash<br/>• audio_hash<br/>• mux_hash"]
        HashEval --> ScopeBranch{"Evaluate Cache Scope"}
        ScopeBranch -- "Frames Stale + Audio Stale" --> FullRender["Full Re-render (Frames + Audio + Mux)"]
        ScopeBranch -- "Frames Stale + Audio Valid" --> FramesOnly["Frames-Only Re-render (Re-use audio.wav)"]
        ScopeBranch -- "Frames Valid + Audio Stale" --> AudioOnly["Audio-Only Re-render (Re-use cached frames)"]
        ScopeBranch -- "Frames Valid + Audio Valid" --> FastMux["Fast Mux Only (Instant FFmpeg merge)"]
    end
```

---

## 3. The 6-Stage Hash Invalidation Matrix

Each pipeline stage defines a deterministic staleness checking function that validates file existence, content hashes, and environmental settings.

| Stage | Checker Function | Source File | Hash / Validation Keys | Trigger Condition for Invalidation |
|---|---|---|---|---|
| **1. `generate_script`** | `is_script_stale()` | [`backend/pipeline/ai.py`](file:///D:/Real-Life-Projects/remotion_canvas/backend/pipeline/ai.py) | `_project_hash` | `script.json` missing, or changes to topic prompt, language, target duration, or format. |
| **2. `generate_voiceover`** | `is_voiceover_stale()` | [`backend/pipeline/tts.py`](file:///D:/Real-Life-Projects/remotion_canvas/backend/pipeline/tts.py) | `_content_hash`, `_voiceover_engine`, `_voiceover_voice`, `_voiceover_voice_mtime` | `voiceover.wav` missing, narration text modified, TTS engine switched, or reference cloning clip replaced. **Per-section resume inside the run**: sections whose text AND voice settings match the previous manifest (`find_reusable_voice_segment`, matched by `(section_type, text)` so reorders still reuse) skip TTS entirely and reuse `segment_NNN.wav` — a one-scene script edit re-pays TTS for that scene only. |
| **3. `transcribe`** | `is_transcribe_stale()` | [`backend/pipeline/transcribe.py`](file:///D:/Real-Life-Projects/remotion_canvas/backend/pipeline/transcribe.py) | `_transcribe_hash` (`whisper.hash.txt`) | `subtitles/transcription.json` missing, or Whisper model size/device/language changed in settings. |
| **4. `generate_visuals`** | `is_visuals_stale()` | [`backend/pipeline/assets.py`](file:///D:/Real-Life-Projects/remotion_canvas/backend/pipeline/assets.py) | `sub_visuals` completeness + per-section `_narr_hash` vs script narration + `_design_hash` vs `design.json` | Any scene lacks `sub_visuals`, narration text changed since visuals were built (manifest text/`_narr_hash` mismatch), section order/count changed, or `design.json` regenerated/missing. A pure voiceover re-run (same text, new audio) is **NOT stale** — the stage is skipped entirely. |
| **5. `fetch_assets`** | `is_assets_stale()` | [`backend/pipeline/assets.py`](file:///D:/Real-Life-Projects/remotion_canvas/backend/pipeline/assets.py) | Duration-agnostic AST structure match (`strip_volatile_ast_keys`: ignores `local_path`, `asset_url` provenance + top-level sub-visual `duration`) + local file existence | Any referenced image/video file missing on disk, or visual layer types/queries modified in `script.json`. Duration-only diffs (voiceover resync, timeline trims) never trigger re-downloads. **Per-layer resume inside the run**: existing `local_path` ⇒ skip; otherwise the layer's stored `asset_url` is re-downloaded first (deterministic — stock top-results rotate, so a fresh search could silently swap the visual), falling back to a fresh provider search only if that URL fails. |
| **6. `render`** | `is_render_stale()` / Multi-Domain Hashes | [`backend/pipeline/render.py`](file:///D:/Real-Life-Projects/remotion_canvas/backend/pipeline/render.py) | `frame.hash.txt`, `audio.hash.txt`, `mux.hash.txt` | Target MP4 missing, AST layer style/animation changed, background music tracks/volumes/trims/cuts modified, track volume/mute overridden, or resolution changed. |

---

## 3b. Content-Aware Downstream Propagation (no blanket cascade)

Smart Resume evaluates **every** stage with its own checker. A queued upstream
stage pulls in only the downstream stages that consume its output
(`queue.py::_PROPAGATE` + `resolve_steps_to_queue` fixpoint over the requested
step range). **Forced runs ("Resume from Stage") and Smart Resume share this
single evaluation**: the explicitly requested first stage of a forced run is
treated as forced-stale, everything else — including downstream stages of a
forced run — is decided by its own checker plus propagation. A forced
voiceover re-run therefore skips visuals/assets entirely instead of running
them as no-ops, and an explicit render re-run reuses valid caches (fast-mux
when nothing changed) instead of wiping them. There is deliberately no
cache-wiping "force" path anymore — to truly redo everything, delete the
stage artifacts on disk.

| Queued upstream stage | Forced downstream stages | Deliberately NOT forced |
|---|---|---|
| `generate_script` | voiceover, transcribe, visuals, assets, render (new narration invalidates everything) | — |
| `generate_voiceover` | transcribe (new audio ⇒ new word timings), render (new mix) | **visuals, assets** — ASTs are narration-driven; durations are rescaled in place (see §4b) |
| `transcribe` | render (new word timings affect subtitles) | **visuals, assets** |
| `generate_visuals` | assets (new queries need downloads), render | — |
| `fetch_assets` | render | — |

**Forced re-runs** (`start_processing_pipeline`, e.g. "Resume from Stage") mark
only the explicitly requested first stage as forced-stale; downstream stages
in the same run are resolved by the same content-aware evaluation above
(`resolve_steps_to_queue`). Requesting "re-run from voiceover" therefore
re-synthesizes changed sections' audio + word timings and then skips straight
to an incremental render when narration is unchanged — visuals and asset
downloads are skipped, not merely run as no-ops.

---

## 4. Intra-Stage Smart Preservation of Visual ASTs

When `generate_visuals` runs (for instance, after an upstream TTS re-generation due to a minor wording fix in Scene 1), it operates with **per-scene granularity** rather than regenerating all scenes:

```mermaid
flowchart LR
    Scene[Scene Narration & Design] --> CheckHash{"_narr_hash == current_narr_hash<br/>AND<br/>_design_hash == current_design_hash?"}
    
    CheckHash -- "YES (Untouched Scene)" --> Scale["Scale Existing Sub-Visual Durations:<br/>scale = new_duration / old_total_duration<br/>v.duration = round(v.duration * scale, 2)"]
    Scale --> SkipLLM["Skip LLM Calls<br/>(0s API Latency, 0 Tokens Used)"]
    
    CheckHash -- "NO (Narration/Design Changed)" --> LLMCall["Execute Storyboard & AST LLM Pipeline:<br/>1. Visual Director Storyboard Beat Plan<br/>2. Declarative AST Generation"]
    LLMCall --> SaveHashes["Store new _narr_hash and _design_hash"]
```

### Preservation Rules in Code:
```python
# From backend/pipeline/ai.py
narration_hash = hashlib.md5(narration.encode("utf-8")).hexdigest()[:12]
stored_hash = entry.get("_narr_hash", "")
narration_changed = (stored_hash and stored_hash != narration_hash)

stored_design_hash = entry.get("_design_hash", "")
design_changed = (stored_design_hash and stored_design_hash != current_design_hash)

if not force and existing_sub_visuals and not is_default and not narration_changed and not design_changed:
    # Scale sub-visual durations proportionally to the new audio duration
    old_total = sum([float(v.get("duration", 0)) for v in existing_sub_visuals])
    if old_total > 0:
        scale = duration / old_total
        for v in existing_sub_visuals:
            v["duration"] = round(float(v.get("duration", 0)) * scale, 2)
    entry["_narr_hash"] = narration_hash
    entry["_design_hash"] = current_design_hash
    return entry  # Preserved without calling LLM!
```

> **Note on `force`:** per-scene preservation applies **regardless** of `force`
> (`backend/pipeline/ai.py`). Content hashes fully decide what needs LLM work:
> an explicitly re-requested visuals run regenerates only scenes whose
> narration/design actually changed and preserves the rest. To force a full
> stylistic regen, change the design or clear the scene's
> `sub_visuals` first. Likewise `render_pipeline` always runs with
> `force=False`, so an explicit render re-run reuses valid frame/audio caches.

### 4b. Post-Voiceover Duration Resync (no visuals run needed)

`generate_voiceover_pipeline` ( [`tts.py`](file:///D:/Real-Life-Projects/remotion_canvas/backend/pipeline/tts.py) ) ends with two bookkeeping steps so skipping
stages 4–5 stays timing-correct:

1. **Hash carry-over** — `_narr_hash` / `_design_hash` are copied from the old
   manifest entry to the rebuilt entry when the section text is unchanged, so
   `is_visuals_stale` can still verify AST validity after the rewrite.
2. **`sync_visual_durations_after_voiceover`** ( [`assets.py`](file:///D:/Real-Life-Projects/remotion_canvas/backend/pipeline/assets.py) ) — rescales every
   section's `sub_visuals` durations to the fresh audio durations in **both**
   `voiceover/manifest.json` and `script.json`. No-op rescales (identical
   durations) are skipped so file mtimes — and therefore render hashes — stay
   stable on byte-identical re-runs.

### 4c. Strict Media Validation + Sanitizer (no query-less Image/Video ever ships)

Hallucinated media layers (Image/Video without a search `query`) can never
download an asset, so they are rejected at three independent levels:

1. **LLM guidance** — `LayerContent.query` is documented REQUIRED for
   Image/Video (minLength in JSON schema) in
   [`schemas.py`](file:///D:/Real-Life-Projects/remotion_canvas/backend/agent/schemas.py).
2. **Pydantic gate** — `LayerContent` raises on empty query for Image/Video,
   and `VisualsArrayResponse.reject_queryless_media` re-checks the raw output
   (the `Union[..., Dict]` forward-compat fallback would otherwise swallow the
   per-content failure). In agent paths this surfaces into the correction
   loop with the exact `cut# / layer#` locations.
3. **Pipeline sanitizer** — `sanitize_media_layers`
   ([`validators.py`](file:///D:/Real-Life-Projects/remotion_canvas/backend/agent/validators.py)),
   wired into `validate_sub_visuals`, drops query-less media layers and
   inserts a deterministic HTML gradient placeholder if a cut would be left
   layer-less — repaired without burning another LLM call.

Companion rule: `is_visuals_stale` requires *meaningful* sub-visuals (real
composition children), so a cut that collapsed to a blank default composition
is regenerated instead of sticking forever.

### 4d. Renderer Failure Cascade (a dead asset degrades, never breaks a cut)

`MediaNode` ([`ASTRenderer.tsx`](file:///D:/Real-Life-Projects/remotion_canvas/frontend/src/components/video/ASTRenderer.tsx))
resolves media in stages: `Video` → on playback error `<Img>` (rescues legacy
type mismatches) → on image error the animated procedural canvas. A missing,
corrupt, or unplayable file therefore always ends as a gradient — never as a
broken-image glyph or black cut.

---

## 5. Multi-Domain Render Hash Engine

In traditional video renderers, modifying an audio volume or subtitle track forces a full re-render of all video frames. Remotion Canvas solves this by splitting render caching into three discrete domains in [`render.py`](file:///D:/Real-Life-Projects/remotion_canvas/backend/pipeline/render.py):

```mermaid
flowchart TD
    Props[Render Props & Settings] --> Split{Domain Hash Splitter}
    
    Split --> FH["frame_hash<br/>(AST Visual Layers, Typography, Shapes,<br/>Lottie, Dimensions, FPS, CRF, Shutter Angle)"]
    Split --> AH["audio_hash<br/>(Voiceover Path/Volume, BGM Path/Volume,<br/>Video Clip Audio Mutes, Track Overrides)"]
    
    FH --> MH["mux_hash = SHA256(frame_hash + audio_hash + settings)"]
    AH --> MH
    
    FH --> CheckFrames{"frame.hash.txt == frame_hash?"}
    CheckFrames -- "Match" --> ReuseFrames["Reuse cached webp frames<br/>in render_cache/frames/"]
    CheckFrames -- "Mismatch" --> InvalidateFrames["Delete render_cache/frames/<br/>Render missing frame ranges"]
    
    AH --> CheckAudio{"audio.hash.txt == audio_hash?"}
    CheckAudio -- "Match" --> ReuseAudio["Reuse render_cache/audio.wav"]
    CheckAudio -- "Mismatch" --> RebuildAudio["Extract & Mix audio tracks<br/>via FFmpeg"]
```

### The 4 Render Scopes:
1. **`Full re-render`**: Visual layers and audio properties changed. Frames are rendered to WebP, audio is mixed, and both are multiplexed into MP4.
2. **`Frames-only re-render`**: Visual AST changed (e.g. text edit, chart animation), but audio tracks remain identical. Cached `render_cache/audio.wav` is reused immediately.
3. **`Audio-only re-render`**: Visuals untouched, but a track override was toggled (e.g. background music muted). Re-uses 100% of cached `.webp` frames; only FFmpeg audio mix and fast mux execute (~1-2 seconds total).
4. **`Fast mux only`**: Both frame cache and audio cache are 100% valid, but output MP4 was deleted or moved. Instant multiplexing without frame or audio recalculation.

Per-scene frame hashes (`compute_granular_frame_hashes`) cover the scene AST,
its frame boundaries, overlapping subtitle segments, and referenced file
mtimes — so a duration change in scene N re-renders scenes N..end (absolute
frame numbering shifts downstream boundaries; structural, not a bug). When
subtitles are hidden (`hide_subtitles`), subtitle segments contribute zero
pixels and are excluded from the scene hash, so new word timings alone never
invalidate cached frames.

---

## 6. Timeline Editing & State Synchronization

When editing on the interactive Timeline ([`VideoTrack.tsx`](file:///D:/Real-Life-Projects/remotion_canvas/frontend/src/features/EditorWorkspace/components/VideoTrack.tsx), [`Timeline.tsx`](file:///D:/Real-Life-Projects/remotion_canvas/frontend/src/features/EditorWorkspace/Timeline.tsx)), changes are continuously synchronized across both `script.json` and `assets_manifest.json` via [`save_project_with_cleanup`](file:///D:/Real-Life-Projects/remotion_canvas/backend/core/bridge.py):

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Timeline as Timeline / VideoTrack UI
    participant EditorStore as useEditorStore
    participant ScriptEditing as useScriptEditing
    participant Bridge as pywebview ApiBridge
    participant DB as SQLite DB & JSON Files
    participant Render as render_pipeline

    User->>Timeline: Drag scene boundary / Split cut [C] / Mute track
    Timeline->>EditorStore: Update local timings & track overrides
    Timeline->>ScriptEditing: Save updated sub-visual duration ratios
    ScriptEditing->>Bridge: callApi('save_project_with_cleanup', scriptData, manifestData)
    
    critical State Persistence
        Bridge->>DB: Save script.json (AST, ratios, overlays)
        Bridge->>DB: Save assets/assets_manifest.json (Cleaned media references)
        Bridge->>DB: Update voiceover/manifest.json sub_visuals structure
    end

    User->>EditorStore: Click "Export Video" / "Resume Pipeline"
    EditorStore->>Bridge: resume_processing_pipeline(projectId, ['render'])
    Bridge->>Render: render_pipeline(proj, proj_dir)
    Render->>Render: Evaluate frame_hash vs audio_hash
    Render-->>Timeline: Broadcast Smart Resume scope (e.g., "Frames-only re-render")
```

### Timeline Operations and Their Invalidation Impact:

| User Action on Timeline | Modified Files | Impact on Pipeline Hashes | Resume Invalidation Scope |
|---|---|---|---|
| **Sub-Visual Ratio Resize** | `script.json`, `assets_manifest.json` | `frame_hash` changed; `_content_hash` unchanged. | Stages 1–5 skipped. **Stage 6**: Frames-only re-render. |
| **Scene Boundary Resize** | `script.json`, `assets_manifest.json` | `frame_hash` changed; `_content_hash` unchanged. | Stages 1–5 skipped. **Stage 6**: Frames-only re-render. |
| **Split Cut at Playhead (`C`)** | `script.json`, `assets_manifest.json` | `frame_hash` changed; `_content_hash` unchanged. | Stages 1–5 skipped. **Stage 6**: Frames-only re-render. |
| **Script Narration Edit** | `script.json` | `_content_hash` mismatch; `_narr_hash` mismatch. | **Stages 2–6**: TTS synthesizes new audio; visuals stage runs but only the edited scene hits the LLM (untouched scenes preserved). |
| **Voiceover Re-run (voice/engine/speed change, script unchanged)** | TTS settings / `voiceover.wav` | `_content_hash` unchanged; audio mtime changed. | **Stages 2–3 + 6 only**: changed sections re-synthesized (per-section TTS resume; a settings change re-synthesizes all sections, a one-scene text edit only that scene) + transcription re-run; durations rescaled in place; **visuals and asset downloads skipped**; render reuses frames when visuals untouched (audio-only / fast-mux scope). |
| **Track Mute Toggle** | `project_settings` in DB | `audio_hash` mismatch; `frame_hash` unchanged. | Stages 1–5 skipped. **Stage 6**: Audio-only re-render (instant). |
| **Hide Subtitles Toggle** | `project_settings` in DB | `frame_hash` mismatch (subtitle overlay disabled). | Stages 1–5 skipped. **Stage 6**: Frames-only re-render. |

---

## 7. Storage Layout & Artifact Directories

Each project directory in `storage/<project_id>/` maintains dedicated subdirectories and hash descriptors for Smart Resume:

```
storage/<project_id>/
├── script.json                  # Source of truth: chapters, narration, AST compositions
├── design.json                  # Art Director design tokens (colors, typography, CSS)
├── voiceover.wav                # Master stitched narration audio
├── voiceover/
│   ├── manifest.json            # TTS metadata: _content_hash, engine, voice, speeds, clip paths
│   └── scene_0.wav, scene_1.wav # Individual scene audio clips
├── subtitles/
│   ├── transcription.json       # Whisper word-level timing timestamps
│   ├── subtitles.srt            # Standard SubRip captions
│   └── subtitles.vtt            # WebVTT captions
├── assets/
│   ├── assets_manifest.json     # Cleaned visual manifest with active media references
│   └── scene_0_sub_0.jpg        # Downloaded/uploaded image & video assets
└── render_cache/
    ├── frame.hash.txt           # SHA-256 hash of visual AST props & video settings
    ├── audio.hash.txt           # SHA-256 hash of audio sources & track volumes
    ├── mux.hash.txt             # SHA-256 hash of multiplexing parameters
    ├── audio.wav                # Cached mixed audio stream
    └── frames/                  # Cached element-00001.webp ... element-00N.webp frames
```

---

## 8. Best Practices for Extending the Pipeline

When adding new visual layer types, audio effects, or AI generation steps:

1. **Always Implement a Staleness Check**: If adding a new pipeline stage `step_foo`, expose `is_foo_stale(proj, proj_dir) -> bool` in `queue.py`.
2. **Preserve Domain Separation**: Keep visual styling in `frame_hash` and audio properties in `audio_hash`. Do not mix audio properties into the visual frame hash to avoid unnecessary frame invalidations.
3. **Embed Content Hashes in Manifests**: When generating assets or audio, write a `_content_hash` into the stage manifest so future runs can verify change detection without re-reading gigabytes of binary data.
4. **Use Atomic Manifest Updates**: When persisting timeline modifications, update `assets_manifest.json` alongside `script.json` through `save_project_with_cleanup` to prevent manifest divergence.
