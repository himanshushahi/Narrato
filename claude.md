# Comprehensive Codebase Analysis: Video Generation System

## 1. Project Structure Overview

This project is a video generation application built using:

* **Frontend:** React + Remotion
* **Backend:** Python + Eel (IPC communication)
* **State Management:** Zustand
* **Rendering Engine:** Remotion

### Key Directories

| Directory                                | Purpose                                          |
| ---------------------------------------- | ------------------------------------------------ |
| `frontend/src/components/video/`         | Remotion visual components and composition logic |
| `frontend/src/features/ProjectEditor/`   | Editors for visual customization                 |
| `frontend/src/features/EditorWorkspace/` | Main editor workspace                            |
| `frontend/src/store/`                    | Zustand stores                                   |
| `frontend/src/components/ui/`            | Shared UI components                             |

---

# 2. Visual Type System

## 2.1 SubVisual Interface

```ts
export interface SubVisual {
  visual_type:
    | 'scene'
    | 'portrait'
    | 'image'
    | 'chart'
    | 'map'
    | 'document'
    | 'youtube'
    | 'parallax'
    | 'network';

  visual_cue: string;
  transition_type?: string;
  visual_url?: string;
  visual_meta?: any;
  duration?: number;
  transform?: SubVisualTransform;
}
```

### Supported Visual Types

| Type     | Description                   |
| -------- | ----------------------------- |
| scene    | B-roll video clips            |
| portrait | Portrait photographs          |
| image    | Stock images                  |
| chart    | Animated charts               |
| map      | Vintage route maps            |
| document | Newspaper/document visuals    |
| youtube  | Embedded YouTube clips        |
| parallax | 2.5D parallax effect          |
| network  | Network / investigation board |

---

## 2.2 SubVisualTransform

```ts
export interface SubVisualTransform {
  zoom: number;
  offsetX: number;
  offsetY: number;
}
```

### Default Values

```ts
{
  zoom: 1,
  offsetX: 0,
  offsetY: 0
}
```

### Range Limits

| Property | Range       |
| -------- | ----------- |
| zoom     | 0.1 - 5.0   |
| offsetX  | -500 to 500 |
| offsetY  | -500 to 500 |

---

## 2.3 Visual Render Dispatch

### Renderer Mapping

| Visual Type | Renderer           |
| ----------- | ------------------ |
| chart       | DataVisualizations |
| map         | DataVisualizations |
| document    | DataVisualizations |
| network     | DataVisualizations |
| parallax    | ParallaxImage      |
| scene       | PanScanImage       |
| image       | PanScanImage       |
| portrait    | PanScanImage       |
| youtube     | PanScanImage       |

---

# 3. Visual Components

## 3.1 DataVisualizations

Handles:

* Chart
* Map
* Document
* Network

### Chart Visualization

Features:

* Bar charts
* Line charts
* Spring animations
* Faux 3D bars
* Custom colors

#### Metadata

```ts
{
  chart_type: "bar" | "line",
  title: string,
  data: [{ label, value }]
}
```

---

### Map Visualization

Features:

* World topo map
* Animated route lines
* Location markers
* D3 Geo rendering

#### Metadata

```ts
{
  locations: [
    {
      name,
      coord: [lat, lon]
    }
  ]
}
```

---

### Document Visualization

Features:

* Vintage newspaper styling
* Typewriter animation
* Ink stamp reveal
* Paper textures
* Pull quotes
* Drop caps

#### Metadata

```ts
{
  title,
  headline,
  subtitle,
  source,
  section,
  date,
  doc_text,
  pull_quote,
  show_image,
  image_url,
  image_caption,
  highlight_text
}
```

---

### Network Visualization

Features:

* String-board investigation style
* Animated SVG connections
* Person nodes
* Entity nodes
* Pin markers

#### Metadata

```ts
{
  nodes: [],
  edges: []
}
```

---

## 3.2 PanScanImage

Used by:

* scene
* image
* portrait
* youtube

### Features

* Ken Burns effect
* Directional camera movement
* Zoom animations
* Image & video support
* Fallback polaroid card

### Motion Variants

* Zoom In
* Zoom Out
* Pan Left
* Pan Right
* Pan Up
* Pan Down

Scale range:

```txt
1.05 → 1.25
```

---

## 3.3 ParallaxImage

### Features

* 3 Layer Depth System

  * Background
  * Midground
  * Foreground

### Camera Presets

* Ken Burns
* Dolly
* Orbit
* Crane
* Float

### Configurable Properties

```ts
{
  strength,
  camera_path,
  bg_zoom_min,
  bg_zoom_max,
  fg_zoom_min,
  fg_zoom_max,
  bg_blur,
  drift_x,
  drift_y,
  rotate_y,
  depth_z,
  fg_brightness
}
```

Additional effects:

* Bounce entrance
* Vignette
* Film grain

---

## 3.4 ZoomWrapper

Applies:

```css
scale()
translate3d()
```

Optimized:

* Skips rendering logic if transform equals default values.

---

## 3.5 TransitionWrapper

### Supported Transitions

| Type         |
| ------------ |
| none         |
| fade         |
| zoom_in      |
| zoom_out     |
| slide_left   |
| slide_right  |
| slide_up     |
| slide_down   |
| glitch       |
| subtle_slide |

Uses spring-based GPU animations.

---

## 3.6 LowerThird

Features:

* Sliding animation
* Glassmorphism style
* Custom colors
* Custom positioning

---

## 3.7 KineticSubtitles

Features:

* Word-level highlighting
* Active-word bounce animation
* Hindi support
* English support
* Sentence grouping

---

## 3.8 PaperOverlay

Global cinematic overlay:

* Film grain
* Dust
* Scratches

---

# 4. Composition System

## NitishRajputComposition

### Scene Interface

```ts
export interface Scene {
  index: number;
  section_type: string;
  title: string;
  text: string;
  audio_file: string;
  audio_url: string;
  duration: number;
  sub_visuals: SubVisual[];
}
```

---

## Timeline Structure

```txt
Composition
 ├── Audio
 ├── Scene Sequence
 │     └── Sub Visual Sequence
 │             └── Transition
 │                     └── Renderer
 ├── Lower Thirds
 ├── Chapter Titles
 ├── Kinetic Subtitles
 └── Paper Overlay
```

### Duration

* Scene duration provided in seconds
* Converted to frames (30 FPS)
* Subvisuals split equally across scene duration

---

# 5. Editor System

## 5.1 SubVisualsEditor

### Core Features

* Add Visual
* Delete Visual
* Edit Cue
* Change Visual Type
* Change Transition
* Transform Controls

### Type-Specific Editors

| Visual Type | Editor             |
| ----------- | ------------------ |
| youtube     | Start/Duration     |
| map         | MapLocationsEditor |
| chart       | ChartDataEditor    |
| document    | NewspaperEditor    |
| network     | NetworkDataEditor  |
| parallax    | ParallaxEditor     |

Always available:

* TransformEditor
* LowerThirdEditor

---

## 5.2 TransformEditor

Controls:

### Zoom

```txt
0.1x → 5.0x
```

### Position

```txt
X: -500 → 500
Y: -500 → 500
```

Includes:

* Reset Button

---

## 5.3 Type-Specific Editors

### ChartDataEditor

Features:

* AI Chart Generation
* Manual Editing
* Add Row
* Delete Row

---

### MapLocationsEditor

Features:

* Add Locations
* Edit Coordinates
* Auto Geocoding
* OpenStreetMap Integration

---

### NewspaperEditor

Controls all newspaper metadata:

* Masthead
* Headline
* Source
* Date
* Pull Quote
* Images

---

### NetworkDataEditor

Raw JSON editor:

```json
{
  "nodes": [],
  "edges": []
}
```

---

### ParallaxEditor

Provides:

* Camera Presets
* Foreground URL
* Parameter Sliders

---

### LowerThirdEditor

Fields:

```txt
Title
Subtitle
```

---

## 5.4 SubVisualsView

Read-only representation displaying:

* Index
* Timing
* Type
* Cue

---

## 5.5 Constants

### VISUAL_TYPE_OPTIONS

Visual type registration.

### TRANSITION_TYPE_OPTIONS

Transition registration.

### getDefaultMetaForType()

Creates default metadata.

### formatTime()

Converts:

```txt
Frames → MM:SS
```

---

## 5.6 ScriptTab

Contains:

### Sections

1. Introduction
2. Scenes
3. Conclusion

Each card supports:

### View Mode

* Narration Preview
* Visual Preview

### Edit Mode

* Narration Editing
* Visual Editing
* AI Rewrite

---

# 6. Data Flow

## Pipeline Stages

```txt
generate_script
      ↓
generate_voiceover
      ↓
transcribe
      ↓
fetch_assets
      ↓
render
```

---

## Data Sources

### Script JSON

Contains:

* Narration
* Visual Definitions
* Metadata

### Manifest JSON

Contains:

* Asset URLs
* Audio URLs
* Durations

### Transcription JSON

Contains:

* Word timestamps

---

## Saving Workflow

### useScriptEditing

Responsibilities:

* Save JSON
* Build Live Manifest
* Trigger Asset Refresh
* Detect Visual Changes

---

## Pipeline Resume Logic

### usePipeline

Detects:

* Narration Changes
* Scene Count Changes
* Voice Changes
* Visual Changes

Uses:

```txt
SHA-256 Hash Comparison
```

to minimize rerendering.

---

# 7. Store Architecture

## useProjectStore

Handles:

* Projects
* Tasks
* Pipeline

---

## useEditorStore

Handles:

* Layout State
* Playback State
* Selection State

---

## useSettingsStore

Handles:

* LLM Providers
* TTS Settings
* Rendering Settings
* Subtitle Presets

---

## useUIStore

Handles:

* Toast Notifications

---

# 8. Rendering Pipeline

```txt
RemotionRoot
     ↓
RemotionVideoPlayer
     ↓
NitishRajputComposition
     ↓
Scene Sequences
     ↓
Sub Visual Sequences
     ↓
TransitionWrapper
     ↓
Renderer
```

### Overlay Layers

* Lower Thirds
* Chapter Titles
* Kinetic Subtitles
* Paper Overlay

---

# 9. Existing Number/List Functionality

Currently **NO dedicated list visual type exists**.

### Closest Alternatives

#### Chart Data

```ts
[{ label, value }]
```

Used for ranked statistics.

#### Network Nodes

```ts
nodes[]
```

Connected entities.

#### Map Locations

```ts
locations[]
```

Ordered geographical points.

#### SubVisual Array

```ts
sub_visuals[]
```

Timeline ordering only.

### Missing Features

* Ordered Lists
* Bullet Lists
* Top 10 Style Layouts
* Ranking Screens
* Countdown Visuals
* Listicle Presentations

---

# 10. Key File Reference Index

| Purpose             | File                                                   |
| ------------------- | ------------------------------------------------------ |
| Composition         | `components/video/NitishRajputComposition.tsx`         |
| Transform Type      | `components/video/SubVisualTransform.ts`               |
| Data Visualizations | `components/video/DataVisualizations.tsx`              |
| Pan Scan            | `components/video/PanScanImage.tsx`                    |
| Parallax            | `components/video/ParallaxImage.tsx`                   |
| Zoom Wrapper        | `components/video/ZoomWrapper.tsx`                     |
| Transition Wrapper  | `components/video/TransitionWrapper.tsx`               |
| Kinetic Subtitles   | `components/video/KineticSubtitles.tsx`                |
| Lower Third         | `components/video/LowerThird.tsx`                      |
| Paper Overlay       | `components/video/PaperOverlay.tsx`                    |
| Remotion Root       | `components/video/RemotionRoot.tsx`                    |
| Video Player        | `components/video/RemotionVideoPlayer.tsx`             |
| SubVisuals Editor   | `features/ProjectEditor/SubVisualsEditor.tsx`          |
| Transform Editor    | `features/ProjectEditor/TransformEditor.tsx`           |
| Chart Editor        | `features/ProjectEditor/ChartDataEditor.tsx`           |
| Map Editor          | `features/ProjectEditor/MapLocationsEditor.tsx`        |
| Newspaper Editor    | `features/ProjectEditor/NewspaperEditor.tsx`           |
| Network Editor      | `features/ProjectEditor/NetworkDataEditor.tsx`         |
| Parallax Editor     | `features/ProjectEditor/ParallaxEditor.tsx`            |
| Script Tab          | `features/EditorWorkspace/InspectorTabs/ScriptTab.tsx` |
| Editor Data Hook    | `features/EditorWorkspace/hooks/useEditorData.ts`      |
| Pipeline Hook       | `features/EditorWorkspace/hooks/usePipeline.ts`        |
| Script Editing Hook | `features/EditorWorkspace/hooks/useScriptEditing.ts`   |
| Workspace           | `features/EditorWorkspace/EditorWorkspace.tsx`         |
| Timeline            | `features/EditorWorkspace/Timeline.tsx`                |
| Media Sidebar       | `features/EditorWorkspace/MediaSidebar.tsx`            |
| Project Store       | `store/useProjectStore.ts`                             |
| Editor Store        | `store/useEditorStore.ts`                              |
| Settings Store      | `store/useSettingsStore.ts`                            |

---

# Final Assessment

The architecture is highly modular and extensible. New visual types can be added by:

1. Extending `SubVisual.visual_type`
2. Registering in `VISUAL_TYPE_OPTIONS`
3. Creating a renderer component
4. Creating an editor component
5. Updating `getDefaultMetaForType()`
6. Adding render dispatch logic

A dedicated **List / Ranking Visual Type** would fit naturally into the existing architecture and currently represents a missing but valuable content presentation format.
