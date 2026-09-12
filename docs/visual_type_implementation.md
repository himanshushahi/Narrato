# Visual Layer Type Implementation & Modification Guide

This document is the definitive engineering guide for **adding, removing, or modifying Visual Layer Types** in the Remotion Canvas documentary video engine.

---

## 1. Architecture & Lifecycle Overview

Remotion Canvas uses a **Declarative Abstract Syntax Tree (AST)** architecture. Each visual beat (sub-visual cut) inside a scene is defined as a sequence containing renderable layer nodes.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            AI GENERATION PIPELINE                           │
│                                                                             │
│  backend/skills/            backend/pipeline/ai.py     backend/agent/       │
│  [visual-director]   ───►   [LAYER_CONTENT_SCHEMA] ──► [validators.py]      │
│  [declarative-ast]          [visuals_system_prompt]    (Math & Type Normal) │
│  [storyboard-planner]                                                       │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ (Outputs script.json / manifest.json)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            ASSET PREPARATION                                │
│                                                                             │
│  backend/pipeline/assets.py [_fetch_ast_layer_asset]                        │
│  (Downloads Pexels/Pixabay/Wikipedia/YouTube media -> local_path)           │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            FRONTEND RENDERING                               │
│                                                                             │
│  frontend/src/components/video/NitishRajputComposition.tsx                  │
│                    │                                                        │
│                    ▼                                                        │
│  frontend/src/components/video/ASTRenderer.tsx (Layer Dispatcher)           │
│        ├── Image / Video  ──► <AsyncMediaNode> (Remotion <Img> / <Video>)   │
│        ├── Text           ──► <KineticText>                                 │
│        ├── Chart          ──► <ChartRenderer>                               │
│        ├── Shape          ──► <ShapeRenderer>                               │
│        ├── Map            ──► <DataVisualizations>                          │
│        └── HTML           ──► dangerouslySetInnerHTML                       │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         INTERACTIVE GUI & EDITOR                            │
│                                                                             │
│  frontend/src/features/ProjectEditor/components/AstGraphicalEditor.tsx       │
│  (Type dropdown, dynamic attribute forms, previews, local media uploads)    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. The 8 Active Visual Layer Types

| # | Layer Type | Primary Purpose | Key Fields / Parameters | Remotion Component |
|---|---|---|---|---|
| 1 | `Image` | High-res stock photos, historical portraits, transparent PNG cutouts | `query`, `source` (`pexels` \| `pixabay` \| `wikipedia`), `image_type`, `style` | [ASTRenderer.tsx](file:///D:/Real-Life-Projects/remotion_canvas/frontend/src/components/video/ASTRenderer.tsx) `<AsyncMediaNode>` |
| 2 | `Video` | Cinematic B-roll, timelapses, dramatic motion backgrounds | `query`, `source` (`pexels` \| `pixabay` \| `youtube`), `volume`, `yt_start_offset`, `yt_duration`, `style` | [ASTRenderer.tsx](file:///D:/Real-Life-Projects/remotion_canvas/frontend/src/components/video/ASTRenderer.tsx) `<AsyncMediaNode>` |
| 3 | `Text` | Dynamic headlines, kinetic quotes, data callouts | `text`, `font`, `weight`, `color`, `animation_mode`, `highlight_words`, `highlight_color`, `style` | [KineticText.tsx](file:///D:/Real-Life-Projects/remotion_canvas/frontend/src/components/video/KineticText.tsx) |
| 4 | `Chart` | Statistics, comparisons, growth trends, distributions | `chart_type` (`bar` \| `line` \| `pie` \| `donut` \| `progress`), `data`, `title`, `style` | [ChartRenderer.tsx](file:///D:/Real-Life-Projects/remotion_canvas/frontend/src/components/video/ChartRenderer.tsx) |
| 5 | `Shape` | Hardware-accelerated vector shapes & animated SVG paths | `shape_type` (`rectangle` \| `circle` \| `star` \| `triangle` \| `arrow` \| `polygon` \| `path`), `fill`, `stroke`, `stroke_width`, `radius`, `direction`, `angle`, `preset_path`, `path_d`, `draw_animation`, `glow`, `style` | [ShapeRenderer.tsx](file:///D:/Real-Life-Projects/remotion_canvas/frontend/src/components/video/ShapeRenderer.tsx) |
| 6 | `Lottie` | 60 FPS vector micro-animations & dynamic vector icons | `lottie_url`, `animation_data`, `loop`, `playback_rate`, `direction`, `style` | [LottieRenderer.tsx](file:///D:/Real-Life-Projects/remotion_canvas/frontend/src/components/video/LottieRenderer.tsx) |
| 7 | `Map` | Geographic territories, highlighted routes & markers | `locations` (`[{name, coord}]`), `map_style` (`modern_dark` \| `vintage` \| `minimal_light` \| `nautical_blue`), `style` | [DataVisualizations.tsx](file:///D:/Real-Life-Projects/remotion_canvas/frontend/src/components/video/DataVisualizations.tsx) |
| 8 | `HTML` | Universal dynamic canvas: bespoke leaked memos, chat UI, comparison cards, SVG diagrams | `html_content`, `style` | [ASTRenderer.tsx](file:///D:/Real-Life-Projects/remotion_canvas/frontend/src/components/video/ASTRenderer.tsx) `<div dangerouslySetInnerHTML>` |

---

## 3. Exact File & Location Inventory

When adding or removing visual types, these are the **exact files and code symbols** across the codebase:

### A. Backend Skills Directory (`backend/skills/`)

| File Path | What It Controls | Exact Sections / Lines to Update |
|---|---|---|
| [declarative-ast/SKILL.md](file:///D:/Real-Life-Projects/remotion_canvas/backend/skills/declarative-ast/SKILL.md) | Full AST specification loaded during generation | **Section 3: The 10 Valid AST Content Types** (Lines 48–315), Layer order table (Lines 38–44) |
| [visual-director/SKILL.md](file:///D:/Real-Life-Projects/remotion_canvas/backend/skills/visual-director/SKILL.md) | Visual Director prompt & type selection guide | **VALID CONTENT TYPES** (Lines 16–17), **CONTENT TYPE SELECTION GUIDE** (Lines 19–34), Rule 38, Rule 42 |
| [storyboard-planner/SKILL.md](file:///D:/Real-Life-Projects/remotion_canvas/backend/skills/storyboard-planner/SKILL.md) | Stage 1 visual beat archetypes | **The 6 Visual Storyboard Archetypes** (Lines 26–54) |
| [motion-graphics-designer/SKILL.md](file:///D:/Real-Life-Projects/remotion_canvas/backend/skills/motion-graphics-designer/SKILL.md) | Glassmorphism & styling presets | Section 1 (Line 17), Section 3 (Lines 93–105), Section 4 (Lines 113–115) |
| [editor-qa/SKILL.md](file:///D:/Real-Life-Projects/remotion_canvas/backend/skills/editor-qa/SKILL.md) | Guardrails & validation checklist | Rule 4 `COMPOSITION & PRIMITIVES` (Line 10) |
| [sub-visual-rewriter/SKILL.md](file:///D:/Real-Life-Projects/remotion_canvas/backend/skills/sub-visual-rewriter/SKILL.md) | Single sub-visual rewrite prompt | Lines 16–20 |
| [visual-rewriter/SKILL.md](file:///D:/Real-Life-Projects/remotion_canvas/backend/skills/visual-rewriter/SKILL.md) | Section visual rewrite prompt | Lines 13–20 |
| [stock-asset-searcher/SKILL.md](file:///D:/Real-Life-Projects/remotion_canvas/backend/skills/stock-asset-searcher/SKILL.md) | Stock asset querying rules | Update if the type interacts with external media sources |

---

### B. Backend Python Pipeline & Agent (`backend/`)

| File Path | Symbol / Function | Exact Role |
|---|---|---|
| [backend/pipeline/ai.py](file:///D:/Real-Life-Projects/remotion_canvas/backend/pipeline/ai.py) | `LAYER_CONTENT_SCHEMA` (Lines 173–275) | JSON Schema `enum` of valid types and per-type properties |
| [backend/pipeline/ai.py](file:///D:/Real-Life-Projects/remotion_canvas/backend/pipeline/ai.py) | `visuals_system_prompt` (Lines 2000–2052) | Enumeration of types (Lines 2011–2018, 2030, 2042) |
| [backend/pipeline/ai.py](file:///D:/Real-Life-Projects/remotion_canvas/backend/pipeline/ai.py) | `plan_system_prompt` (Lines 2169–2175) | Storyboard prompt primitive references |
| [backend/pipeline/ai.py](file:///D:/Real-Life-Projects/remotion_canvas/backend/pipeline/ai.py) | `_visual_rules_safety_net` (Lines 1892–1922) | Fallback layer order hierarchy and type rules |
| [backend/pipeline/assets.py](file:///D:/Real-Life-Projects/remotion_canvas/backend/pipeline/assets.py) | `_fetch_ast_layer_asset()` (Lines 579–680) | Downloads media files for media-backed layer types |
| [backend/pipeline/assets.py](file:///D:/Real-Life-Projects/remotion_canvas/backend/pipeline/assets.py) | `fetch_single_scene_asset()` (Lines 930–970) | Single asset fetch for editor previews |
| [backend/agent/validators.py](file:///D:/Real-Life-Projects/remotion_canvas/backend/agent/validators.py) | `validate_sub_visuals()` (Lines 49–110) | Structural validation and timing math normalization |
| [backend/core/bridge.py](file:///D:/Real-Life-Projects/remotion_canvas/backend/core/bridge.py) | `upload_sub_visual_media()` (Lines 1550–1637) | Handles user-uploaded local files in GUI for layer types |

---

### C. Frontend Remotion Renderers (`frontend/src/components/video/`)

| File Path | Symbol / Function | Exact Role |
|---|---|---|
| [ASTRenderer.tsx](file:///D:/Real-Life-Projects/remotion_canvas/frontend/src/components/video/ASTRenderer.tsx) | `ASTLayerContent` interface (Lines 13–69) | TypeScript union of layer types and property definitions |
| [ASTRenderer.tsx](file:///D:/Real-Life-Projects/remotion_canvas/frontend/src/components/video/ASTRenderer.tsx) | Dispatcher block (Lines 203–303) | `if-else` branch rendering the corresponding React component |
| Component Renderers | `<NewType>Renderer.tsx` | Dedicated Remotion animation component using hooks |

---

### D. Frontend GUI Editor (`frontend/src/features/`)

| File Path | Symbol / Function | Exact Role |
|---|---|---|
| [AstGraphicalEditor.tsx](file:///D:/Real-Life-Projects/remotion_canvas/frontend/src/features/ProjectEditor/components/AstGraphicalEditor.tsx) | Type `<select>` dropdown (Lines 223–250) | UI selector options for layer types |
| [AstGraphicalEditor.tsx](file:///D:/Real-Life-Projects/remotion_canvas/frontend/src/features/ProjectEditor/components/AstGraphicalEditor.tsx) | Type change default initializer (Lines 230–236) | Sets default properties when switching to a type |
| [AstGraphicalEditor.tsx](file:///D:/Real-Life-Projects/remotion_canvas/frontend/src/features/ProjectEditor/components/AstGraphicalEditor.tsx) | Dynamic Form Controls (Lines 252–904) | Dedicated visual edit controls (inputs, color pickers, sliders) |
| [VideoAudioTrack.tsx](file:///D:/Real-Life-Projects/remotion_canvas/frontend/src/features/EditorWorkspace/components/VideoAudioTrack.tsx) | `getValidVisualType()` (Lines 17–25) | Audio track timeline type filter (if audio-enabled) |

---

## 4. Step-by-Step: How to ADD a New Visual Layer Type

Here is the exact step-by-step procedure using a concrete example: adding a new visual layer type named **`CodeBlock`** (or `IconBadge` / `ComparisonCard`).

### Step 1: Create the Remotion React Renderer Component

Create `frontend/src/components/video/CodeBlockRenderer.tsx`:

```tsx
import React from 'react';
import { useCurrentFrame, interpolate, spring, useVideoConfig } from 'remotion';

export interface CodeBlockProps {
  code?: string;
  language?: string;
  title?: string;
  theme?: 'dark' | 'neon' | 'matrix';
  style?: React.CSSProperties;
}

export const CodeBlockRenderer: React.FC<CodeBlockProps> = ({
  code = '',
  language = 'python',
  title,
  theme = 'dark',
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enterProgress = spring({
    frame,
    fps,
    config: { damping: 15, stiffness: 120 },
  });

  const opacity = interpolate(enterProgress, [0, 1], [0, 1]);
  const translateY = interpolate(enterProgress, [0, 1], [30, 0]);

  return (
    <div
      style={{
        position: 'absolute',
        width: '75%',
        left: '12.5%',
        top: '20%',
        backgroundColor: 'rgba(15, 23, 42, 0.92)',
        backdropFilter: 'blur(16px)',
        borderRadius: '16px',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6)',
        padding: '20px',
        color: '#f8fafc',
        fontFamily: 'monospace',
        opacity,
        transform: `translateY(${translateY}px)`,
        ...style,
      }}
    >
      {title && (
        <div style={{ paddingBottom: '10px', borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#facc15', fontSize: '14px', fontWeight: 'bold' }}>
          {title} ({language})
        </div>
      )}
      <pre style={{ margin: '12px 0 0 0', fontSize: '16px', lineHeight: '1.6', overflow: 'hidden' }}>
        <code>{code}</code>
      </pre>
    </div>
  );
};
```

---

### Step 2: Register in `frontend/src/components/video/ASTRenderer.tsx`

1. **Import the component**:
   ```tsx
   import { CodeBlockRenderer } from './CodeBlockRenderer';
   ```

2. **Add to `ASTLayerContent` interface** (around line 14):
   ```tsx
   interface ASTLayerContent {
     type: 'Image' | 'Video' | 'Text' | 'Map' | 'HTML' | 'Chart' | 'Counter' | 'Mockup' | 'Timeline' | 'Shape' | 'CodeBlock';
     
     // Add CodeBlock props:
     code?: string;
     language?: string;
     // ... other existing props
   }
   ```

3. **Add the rendering branch in `ASTRenderer`** (around line 300):
   ```tsx
   } else if (content.type === 'CodeBlock') {
     node = (
       <CodeBlockRenderer
         code={content.code}
         language={content.language}
         title={content.title}
         style={innerStyle}
       />
     );
   }
   ```

---

### Step 3: Add GUI Controls in `frontend/src/features/ProjectEditor/components/AstGraphicalEditor.tsx`

1. **Add to the Type `<select>` dropdown** (around line 248):
   ```tsx
   <option value="CodeBlock">Code Snippet (Syntax Box)</option>
   ```

2. **Add dynamic form controls** (around line 904):
   ```tsx
   {cType === 'CodeBlock' && (
     <div className="space-y-2.5">
       <div className="grid grid-cols-2 gap-2.5">
         <div className="space-y-1">
           <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Title</label>
           <input
             type="text"
             className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-stone-200 focus:outline-none focus:border-amber-500/50"
             value={content.title || ''}
             onChange={e => updateContent(idx, 'title', e.target.value)}
             placeholder="e.g. exploit.py"
           />
         </div>
         <div className="space-y-1">
           <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Language</label>
           <input
             type="text"
             className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-stone-200 focus:outline-none font-mono"
             value={content.language || 'python'}
             onChange={e => updateContent(idx, 'language', e.target.value)}
             placeholder="python, js, rust"
           />
         </div>
       </div>
       <div className="space-y-1">
         <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400 block">Code Content</label>
         <textarea
           className="w-full bg-black/40 border border-white/10 rounded-md px-2.5 py-2 text-xs text-stone-200 font-mono focus:outline-none focus:border-amber-500/50 min-h-[80px]"
           value={content.code || ''}
           onChange={e => updateContent(idx, 'code', e.target.value)}
           placeholder="def authenticate(): ..."
         />
       </div>
     </div>
   )}
   ```

---

### Step 4: Register Timeline Primitive Badge in `frontend/src/features/EditorWorkspace/components/VideoTrack.tsx`

To display an icon badge on the Timeline cut blocks whenever this AST layer type is present:
```tsx
// In AST_PRIMITIVE_BADGES:
CodeBlock: { 
  label: 'Code', 
  icon: Code, 
  color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' 
},
```

---

### Step 5: Update Backend Schemas in `backend/pipeline/ai.py`

1. **Update `LAYER_CONTENT_SCHEMA`** (around line 176):
   ```python
   LAYER_CONTENT_SCHEMA = {
       "type": "object",
       "properties": {
           "type": {
               "type": "string",
                "enum": [
                    "Image", "Video", "Text", "Chart", 
                    "Shape", "Map", "HTML",
                    "CodeBlock"  # <-- Added
                ]
           },
           # Add CodeBlock properties:
           "code": {"type": "string", "description": "Source code text (if CodeBlock)"},
           "language": {"type": "string", "description": "Programming language (if CodeBlock)"},
           # ... rest of schema
       }
   }
   ```

2. **Update `visuals_system_prompt`** (around lines 2011–2042):
   - Add description: `- Use CodeBlock for terminal commands, code snippets, algorithms, and technical evidence.`
   - Update valid type list: `content.type MUST be one of: Image, Video, Text, Chart, Counter, Mockup, Timeline, Shape, Map, HTML, CodeBlock`

---

### Step 6: (If Media-Backed) Update Asset Downloader in `backend/pipeline/assets.py`

If the new type downloads media from an API (e.g. 3D models, icons, external SVGs):
- Update `_fetch_ast_layer_asset()` (lines 584–680) to handle `content_type == "CodeBlock"` (or your custom type).

---

### Step 7: Update AI Skills (`backend/skills/`)

1. **`backend/skills/declarative-ast/SKILL.md`**:
   - Update heading: `## 3. The 11 Valid AST Content Types`
   - Add subsection with documentation, fields, and JSON example for `CodeBlock`.
   - Update layer order table to classify the new layer (e.g. Midground middle children).

2. **`backend/skills/visual-director/SKILL.md`**:
   - Update line 17: `Image | Video | Text | Chart | Counter | Mockup | Timeline | Shape | Map | HTML | CodeBlock`
   - Add selection guidance in `CONTENT TYPE SELECTION GUIDE`.

3. **`backend/skills/storyboard-planner/SKILL.md`**:
   - Mention the new type in the relevant storyboard archetype.

4. **`backend/skills/editor-qa/SKILL.md`**:
   - Update Rule 4 with the new type name.

---

### Step 8: Verification & Build

1. Rebundle Remotion:
   ```bash
   cd frontend
   npm run build:remotion
   ```
2. Verify TypeScript compiles without errors:
   ```bash
   npm run build
   ```

---

## 5. Step-by-Step: How to REMOVE a Visual Layer Type

Removing a visual type requires **two key considerations**:
1. **AI Instruction / Schema Removal**: Preventing the LLM from generating the deprecated type.
2. **Backward Compatibility**: Ensuring existing project files (`script.json`, `manifest.json`) containing the old visual type do not crash the frontend player or headless export.

### Step 1: Remove from Backend Skills (`backend/skills/`)
- Remove the type from:
  * [declarative-ast/SKILL.md](file:///D:/Real-Life-Projects/remotion_canvas/backend/skills/declarative-ast/SKILL.md)
  * [visual-director/SKILL.md](file:///D:/Real-Life-Projects/remotion_canvas/backend/skills/visual-director/SKILL.md)
  * [editor-qa/SKILL.md](file:///D:/Real-Life-Projects/remotion_canvas/backend/skills/editor-qa/SKILL.md)
  * [storyboard-planner/SKILL.md](file:///D:/Real-Life-Projects/remotion_canvas/backend/skills/storyboard-planner/SKILL.md)
  * [motion-graphics-designer/SKILL.md](file:///D:/Real-Life-Projects/remotion_canvas/backend/skills/motion-graphics-designer/SKILL.md)

### Step 2: Remove from `backend/pipeline/ai.py`
- Remove the type string from `LAYER_CONTENT_SCHEMA["properties"]["type"]["enum"]`.
- Remove specific property definitions (if no longer needed).
- Remove references from `visuals_system_prompt` and fallback prompts.

### Step 3: Remove from GUI Editor
- In [AstGraphicalEditor.tsx](file:///D:/Real-Life-Projects/remotion_canvas/frontend/src/features/ProjectEditor/components/AstGraphicalEditor.tsx):
  * Remove the `<option>` from the `<select>` dropdown.
  * Remove the corresponding `{cType === 'OldType' && (...)}` form block.

### Step 4: Handle Frontend Remotion Renderer (Safe Deprecation)

> [!IMPORTANT]
> **Do NOT abruptly delete the renderer if users might load older saved projects!**
> Instead, keep a fallback inside [ASTRenderer.tsx](file:///D:/Real-Life-Projects/remotion_canvas/frontend/src/components/video/ASTRenderer.tsx) so legacy projects render gracefully rather than throwing React render errors:

```tsx
// Safe Fallback in ASTRenderer.tsx
} else if ((content as any).type === 'OldType') {
  // Gracefully render as text callout or placeholder
  node = (
    <div style={{ position: 'absolute', padding: '20px', color: '#94a3b8', ...innerStyle }}>
      {content.title || 'Legacy Visual Layer'}
    </div>
  );
}
```

If performing a **hard removal** (no legacy compatibility needed):
1. Delete the component file: `frontend/src/components/video/OldTypeRenderer.tsx`.
2. Remove the import and `else if (content.type === 'OldType')` branch from [ASTRenderer.tsx](file:///D:/Real-Life-Projects/remotion_canvas/frontend/src/components/video/ASTRenderer.tsx).
3. Remove the type string from `ASTLayerContent` interface in [ASTRenderer.tsx](file:///D:/Real-Life-Projects/remotion_canvas/frontend/src/components/video/ASTRenderer.tsx).

---

## 6. Developer Checklist

When altering visual layer types, use this checklist to guarantee 100% codebase consistency:

- [ ] **Frontend**: Remotion Component created / updated in `frontend/src/components/video/`
- [ ] **Frontend**: `ASTLayerContent` interface updated in `frontend/src/components/video/ASTRenderer.tsx`
- [ ] **Frontend**: Dispatcher branch updated in `frontend/src/components/video/ASTRenderer.tsx`
- [ ] **Frontend**: GUI Editor `<select>` option & form controls updated in `AstGraphicalEditor.tsx`
- [ ] **Backend**: `LAYER_CONTENT_SCHEMA` enum & properties updated in `backend/pipeline/ai.py`
- [ ] **Backend**: Prompts (`visuals_system_prompt`, `_visual_rules_safety_net`) updated in `backend/pipeline/ai.py`
- [ ] **Backend**: (If media-backed) `_fetch_ast_layer_asset` updated in `backend/pipeline/assets.py`
- [ ] **Skills**: `backend/skills/declarative-ast/SKILL.md` updated
- [ ] **Skills**: `backend/skills/visual-director/SKILL.md` updated
- [ ] **Skills**: `backend/skills/editor-qa/SKILL.md` updated
- [ ] **Skills**: `backend/skills/storyboard-planner/SKILL.md` updated
- [ ] **Skills**: `backend/skills/motion-graphics-designer/SKILL.md` updated
- [ ] **Verification**: `npx remotion bundle` runs cleanly with zero TypeScript errors
