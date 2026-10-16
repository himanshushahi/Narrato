---
name: visual-style-library
version: "1.0"
description: "50 named visual + motion styles with AST mappings. Pick ONE style per scene and bind its look to design.json tokens. Harness grammar: read declarative-ast."
when_to_use: "During storyboard planning and AST authoring whenever a style hint, mood, or explicit style name is present. Pull the index first, then one family section."
exposure: agent
---

# Visual Style Library — 50 Looks with AST Mappings

> **Role**: Style Librarian & Look Developer.
> **Mission**: Give every scene a deliberate, nameable look that survives contact with the renderer.
> **Harness truth is in `declarative-ast`** — this file is look + motion vocabulary ONLY, never geometry/motion grammar. All colors/fonts bind to `design.json` tokens, never hardcoded style hex.

## 0. How To Apply A Style (read this, not just the index)

1. Resolve the hint to ONE `slug` (`resolve_style` / alias match; unknown hint = topic-driven art direction, no forcing).
2. One style per scene. Max 2–3 styles per video. Never mix 5 looks in one scene.
3. Map the style to harness primitives below: `base` = Layer 0, `hero` = Layer 2, `text` = Layer 3, `filters` = layer `filters`, `transitions` = cut `transition` family.
4. Bind `design.json`: `primary/secondary/accent` → strokes, bars, counters, `highlight_color`; `background/text` → canvas + body; `heading_font/body_font` → Text layers (Noto for non-Latin, always).
5. Keep all hard rules: `content.type` on every Layer, `query`+`source` on Image/Video, `%`-only `content.style`, safe areas `bottom 18%` landscape / `28%` portrait, `delay>0` pairs `opacity 0→1`.
6. Vary transitions across consecutive cuts even inside one style.

## 1. Style Index (all 50 — pick by beat, then pull the family section)

01. Editorial Paper Collage (`editorial-paper-collage`) — Torn paper layers, tape strips and serif headlines on a textured paper canvas.
02. Investigative Noir (`investigative-noir`) — High-contrast black-and-white with redaction bars and typewriter labels.
03. Isometric 3D Infographics (`isometric-3d-infographics`) — Isometric blocks, stacks and charts on an engineering grid.
04. Blueprint Schematic (`blueprint-schematic`) — Engineering graph paper with line drawings, dimensions and mono labels.
05. Cybersecurity HUD (`cybersecurity-hud`) — Dark console with corner brackets, scanlines and glowing reticles.
06. Kinetic Editorial Typography (`kinetic-editorial-typography`) — Giant words ARE the image — oversized type with muted echo behind the hero.
07. 2.5D Parallax Documentary (`parallax-2-5d-documentary`) — Photo split into depth layers drifting at different speeds over archival imagery.
08. Cinematic 3D Typography (`cinematic-3d-typography`) — Extruded dimensional type with depth-of-field and dramatic lighting.
09. Swiss International Typographic Style (`swiss-typographic`) — Strict grid, grotesque type, one accent color, generous whitespace.
10. Brutalist Motion Design (`brutalist-motion`) — Raw blocks, thick borders, oversized type, clashing flat fills.
11. Liquid Glass Aesthetic (`liquid-glass`) — Frosted glass cards floating over blurred cinematic B-roll.
12. Y2K Chrome Aesthetic (`y2k-chrome`) — Silver gradients, bubbly shapes, playful high-gloss tech pop.
13. Halftone Pop Art (`halftone-pop-art`) — Ben-Day dots, comic outlines, saturated primary panels.
14. Analog Glitch / VHS (`analog-glitch-vhs`) — Tracking noise, chromatic aberration and scanline grit over footage.
15. Surreal Conceptual 3D (`surreal-conceptual-3d`) — Dreamlike floating objects and impossible scenes in soft light.
16. Scientific Cutaway Visualization (`scientific-cutaway`) — Labeled cross-sections and diagrams with leader lines and callouts.
17. Flat Vector Explainer (`flat-vector-explainer`) — Clean flat characters and shapes in a friendly palette.
18. Editorial Data Visualization (`editorial-data-visualization`) — Magazine-grade charts with frosted cards and refined numerals.
19. Archival Film Aesthetic (`archival-film`) — Grainy newsreel photos and footage in sepia/mono with date stamps.
20. Mid-Century Editorial Illustration (`midcentury-editorial-illustration`) — 1950s print illustration, muted palette, paper texture multiply.
21. Macro Tech Cinematography (`macro-tech-cinematography`) — Extreme close-ups of chips, lenses and machinery with shallow focus.
22. Holographic Wireframe (`holographic-wireframe`) — Neon wireframes and grids floating over deep dark blue/black.
23. Minimalist Existential Visuals (`minimalist-existential`) — Vast negative space, one line of type, single small object.
24. Classical Oil-Painting Motion (`classical-oil-painting-motion`) — Painted canvases with impasto texture and chiaroscuro grading.
25. Claymation / Stop-Motion Craft (`claymation-craft`) — Handmade clay and felt textures with visible fingerprints and grain.
26. Cut-Paper Shadowbox (`cut-paper-shadowbox`) — Layered paper diorama with drop shadows and depth between planes.
27. Neon Contour-Line Graphics (`neon-contour-line`) — Glowing topographic/contour lines over near-black with one neon accent.
28. Newspaper Editorial Graphics (`newspaper-editorial-graphics`) — Column grids, rule lines, pull-quotes and halftone portraits.
29. Gradient Mesh / Fluid Abstract (`gradient-mesh-fluid-abstract`) — Organic color blooms drifting behind minimal foreground type.
30. Miniature Diorama Cinematography (`miniature-diorama-cinematography`) — Tilt-shift tiny-world footage with blurred top/bottom bands.
31. Photorealistic CGI (`photorealistic-cgi`) — Hyperreal renders and simulations indistinguishable from footage.
32. Low-Poly 3D Illustration (`low-poly-3d-illustration`) — Faceted geometric scenes in flat shaded polygons.
33. Voxel Art Animation (`voxel-art-animation`) — Blocky cubes assembling into objects and charts.
34. Wireframe 3D Animation (`wireframe-3d-animation`) — Bare mesh turntables and blueprint grids, mono stroke only.
35. Liquid Metal Simulation (`liquid-metal-simulation`) — Chrome fluid blobs with color-dodge highlights on dark.
36. Particle-Based Motion Graphics (`particle-based-motion-graphics`) — Data and ideas carried by flowing embers, dust or money rain.
37. Volumetric Light Visualization (`volumetric-light-visualization`) — God rays and dust shafts cutting through darkness.
38. Typography-Driven Kinetic Posters (`typography-driven-kinetic-posters`) — Full-bleed poster type, one headline filling the frame.
39. Bauhaus Geometric Motion (`bauhaus-geometric-motion`) — Primary circles, triangles and bars in strict asymmetric layouts.
40. Memphis Design Animation (`memphis-design-animation`) — Playful squiggles, dots and pastel clashes in constant motion.
41. Risograph Print Aesthetic (`risograph-print`) — Grainy two-color overprint with misregistered edges and paper tooth.
42. Photocopy Zine Collage (`photocopy-zine-collage`) — Xeroxed cutouts, harsh contrast, ransom-note type at angles.
43. Double Exposure Cinematography (`double-exposure-cinematography`) — Portrait silhouette filled with landscape/city footage.
44. Silhouette Animation (`silhouette-animation`) — Black shapes acting against gradient skies and backlight.
45. Parallax Cutout Animation (`parallax-cutout-animation`) — Cutout person/object floating over a living scene with real depth.
46. Ink-in-Water Simulation (`ink-in-water-simulation`) — Ink blooms unfolding in water as text and images emerge.
47. Liquid Morphing Animation (`liquid-morphing-animation`) — Shapes melt and reform between beats without a visible cut.
48. Abstract Topographic Animation (`abstract-topographic-animation`) — Animated contour maps flowing like data landscapes.
49. Photogrammetry 3D Environments (`photogrammetry-3d-environments`) — Scanned real places with photographic texture.
50. Unreal Engine Cinematic (`unreal-engine-cinematic`) — AAA virtual-production lighting with volumetric depth.

Pull one family section below for the full AST mapping — never author from the index line alone.

## 2. Editorial, Print & Type Family

### Editorial Paper Collage
Look: torn paper, tape, serif headlines on `paper_grain`. Motion: cards spring 0/0.3/0.6s + floating hero. AST: base `Background paper_grain`; hero Image + HTML doc cards; text serif `words_stagger`; transitions `rise/cut`.

### Kinetic Editorial Typography
Look: giant words as image + 10–15% echo behind hero. Motion: `words_stagger` on keyword + `emphasis` punch. AST: base `gradient_mesh/vignette_loop`; hero Text echo; text 64–200px `marker_highlight`; transitions `cut/flash`.

### Swiss International Typographic Style
Look: strict grid, one accent, whitespace. Motion: hard cuts, linear fades. AST: flat Shape + thin rule; text static left-aligned; transitions `cut` only.

### Brutalist Motion Design
Look: raw blocks, thick borders, oversized caps. Motion: `flash` entrances, linear slides. AST: flat fills + Counter blocks; text 800–900 caps; transitions `cut/flash`.

### Newspaper Editorial Graphics
Look: columns, rules, pull-quotes, halftone portraits. Motion: page-turn cuts, `rise` quotes, `wipe_right` images. AST: base HTML news card + `paper_grain`; hero archive Image; mono dateline + serif headline.

### Bauhaus Geometric Motion
Look: primary primitives, asymmetric grid. Motion: linear grid slides on the beat. AST: circle/triangle/arrow Shapes; grotesque caps; transitions `cut/slide_left`.

### Memphis Design Animation
Look: squiggles, dots, pastel clash. Motion: `bounce` pops, wiggle `rotate`, floating confetti. AST: base `dots` pastel; hero icon Shapes + squiggle paths; `words_stagger`.

### Risograph Print Aesthetic
Look: grainy 2-color overprint, misregistered edges. Motion: gentle `rise`, duotone-graded footage. AST: `url(#fx-duotone-midnight)` or `url(#fx-duotone-inferno)`; transitions `rise/dissolve`.

### Photocopy Zine Collage
Look: xerox cutouts, harsh contrast, angled ransom type. Motion: jitter cuts, `flash` reveals. AST: `noir_hard` + `contrast(1.4)`; collage Images; transitions `cut/glitch`.

### Typography-Driven Kinetic Posters
Look: full-bleed poster headline. Motion: marker sweep + `emphasis` punch, hard cut next. AST: giant Text `marker_highlight` 72–200px; transitions `cut/flash`.

## 3. Cinematic & Documentary Family

### Investigative Noir
Look: B&W + redaction bars + typewriter. Motion: slow push-in, typewriter reveals, dissolves. AST: dark Video/Image + `noir_hard`; hero HTML dossier; mono `typewriter`; transitions `dissolve/fade`.

### 2.5D Parallax Documentary
Look: photo depth layers over archival image. Motion: full-cut drift `scale 1.0→1.08` + `translateX` journey. AST: archive Image `cover`; cutout `contain` overlay; `archival_monochrome/vintage_sepia`; `crossfade`.

### Archival Film Aesthetic
Look: newsreel grain, sepia/mono, date stamps. Motion: Ken Burns drift + `handheld` + crossfades. AST: archive Image/Video `cover`; HTML newspaper card; small static stamp; `archival_monochrome/vintage_sepia`.

### Mid-Century Editorial Illustration
Look: 50s print, muted palette, paper `multiply`. Motion: gentle `rise`, warm resolve. AST: illustration Image + texture `multiply`; serif static headline; `rise/dissolve`.

### Classical Oil-Painting Motion
Look: impasto canvases, chiaroscuro. Motion: museum zoom `1.0→1.06` full-cut. AST: archive painting `cover`; inset mask frame; serif title; `crossfade`.

### Macro Tech Cinematography
Look: extreme chip/lens close-ups, shallow focus. Motion: rack-focus `blur 14→0` + ultra-slow drift. AST: pexels macro Video + reticle accent; minimal lower-third; `cinematic_dark_base`; `blur_focus/zoom_in`.

### Double Exposure Cinematography
Look: portrait filled with landscape footage. Motion: inner footage drifts inside still silhouette. AST: portrait Image + landscape Video `screen/overlay`; quiet lower-third; `dissolve/crossfade`.

### Silhouette Animation
Look: black shapes vs gradient skies. Motion: lateral slides + slow push-in. AST: `gradient_mesh` sunset + black Shapes; minimal caption; `dissolve/fade`.

### Parallax Cutout Animation
Look: cutout host over living scene. Motion: foreground `floating`, background counter-drift + handheld. AST: pexels Video drift + pixabay cutout `contain`; headline lower-third; `cinematic_dark_base`.

### Miniature Diorama Cinematography
Look: tilt-shift tiny world, blurred bands. Motion: slow lateral pan; museum-label captions rise. AST: pexels city/crowd Video + frosted label card; `brightness(1.05)`; `slide_left/dissolve`.

### Photogrammetry 3D Environments
Look: scanned places, photographic texture. Motion: handheld push-in; evidence cards fade over texture. AST: archive/youtube place footage + HTML evidence card; documentary lower-third; `crossfade`.

### Unreal Engine Cinematic
Look: AAA virtual-production polish, volumetrics. Motion: slow push + `emphasis` money shot, shutter 180. AST: youtube cinematic Video + spec Counter/glass card; `cinematic_dark_base`; `zoom_in/blur_focus`.

## 4. 3D, CGI & Vector Family

### Isometric 3D Infographics
Look: isometric blocks on engineering grid. Motion: `back`-ease pops + counter roll on number word. AST: base `blueprint`; hero Chart + Counter grid; static labels; `slide_up/zoom_in`.

### Surreal Conceptual 3D
Look: dream objects, soft light. Motion: `floating` loops, `dream_blur` drifts. AST: pixabay illustration full-bleed + transparent cutout floating; airy `words_stagger`; `dissolve/blur_focus`.

### Flat Vector Explainer
Look: flat characters, friendly palette. Motion: spring pops staggered 0.2s. AST: light `gradient_mesh` + pixabay cutouts; rounded `words_stagger`; `slide_left/rise`.

### Photorealistic CGI
Look: hyperreal renders. Motion: cinematic drift + `emphasis` reveal, blur 180. AST: youtube CGI Video + Counter/spec callout; `vibrant_tech_glow` light; `zoom_in/blur_focus`.

### Low-Poly 3D Illustration
Look: faceted flat-shaded polygons. Motion: `back` facet pops + subtle `rotateY`. AST: `dots/blueprint` + pixabay low-poly cutout; geometric sans; `slide_up/zoom_in`.

### Voxel Art Animation
Look: cubes assembling objects/charts. Motion: grid-staggered `scale 0→1`, board `slide_up`. AST: dark `blueprint` + Shape grid + Counter; mono label; `slide_up/rise`.

### Wireframe 3D Animation
Look: bare mesh turntables, mono stroke. Motion: slow `rotateY` loop + grid drift. AST: `grid_flow` + path reticle + 3D card; thin mono; `fade/zoom_in`.

### Cinematic 3D Typography
Look: extruded type, DOF, drama. Motion: `rotateY 15→0` spring + blur 90 + push hold. AST: `vignette_loop` + Text `perspective:800`; `marker_highlight`; `zoom_in/blur_focus`.

### Cut-Paper Shadowbox
Look: layered paper diorama + drop shadows. Motion: planes parallax `translateX` at speeds + `rise`. AST: stacked Shape planes (`boxShadow`); paper silhouettes; `rise/slide_up`.

### Claymation / Stop-Motion Craft
Look: clay/felt handmade grain. Motion: `steps` pops + handheld wobble. AST: warm `paper_grain` + handmade cutouts; chunky rounded type; `cut/rise`.

## 5. Tech, HUD & Data Family

### Blueprint Schematic
Look: graph paper + line drawings + mono labels. Motion: `draw_animation` paths + node pops. AST: base `blueprint`; hero path + circle nodes; `slide_up/wipe_right`.

### Cybersecurity HUD
Look: dark console + brackets + reticles. Motion: glitch-ins, reticle pulse loop, ticker scan. AST: `grid_flow`/dark Video + `corner_brackets` + `circle_reticle`; terminal `typewriter`; `cyberpunk` + `neon_glow_pop`; `glitch/cut`.

### Holographic Wireframe
Look: neon wireframes on deep dark. Motion: draw-on paths + rotating loops + glow pulse. AST: dark `grid_flow` + glow path; thin `typewriter`; `cyberpunk` + `neon_glow_pop`; `glitch/zoom_in`.

### Scientific Cutaway Visualization
Look: labeled cross-sections + leader lines. Motion: pointer curves draw to labels in narration order. AST: `blueprint` + HTML diagram + `pointer_curve`; small static labels + headline; `slide_up/fade`.

### Editorial Data Visualization
Look: magazine charts + frosted cards + refined numerals. Motion: bars grow with glow, counter lands on number word. AST: `waves/dots` + Chart `bar_glow` + Counter; `typewriter` stat label; `slide_up/zoom_in`.

### Neon Contour-Line Graphics
Look: glowing topo lines on near-black, one neon accent. Motion: `wave_pulse` draws full-frame; accent pulses on keyword. AST: dark `grid_flow` + `wave_pulse` glow; thin uppercase + highlight; `neon_glow_pop`; `zoom_in/blur_focus`.

### Abstract Topographic Animation
Look: contour terrain flowing like data. Motion: linear contour loops + node pops on facts. AST: `blueprint` + `wave_pulse` loop + Counter; mono labels; `slide_up/dissolve`.

### Particle-Based Motion Graphics
Look: embers/dust/money-rain carrying ideas. Motion: fullscreen particle loop + counter landing as flow parts. AST: dark base + Particles (`screen` blend); Chart/Counter hero; `words_stagger`; `dissolve/zoom_in`.

### Volumetric Light Visualization
Look: god rays + dust shafts in darkness. Motion: `brightness` sweep reveal + upward dust drift. AST: dark Video + dust Particles + shaft overlay; soft headline; `dream_blur` light; `blur_focus/dissolve`.

### Y2K Chrome Aesthetic
Look: silver gradients, bubbly gloss pop. Motion: bouncy pops, `flip` transitions, floating badges. AST: silver/blue `gradient_mesh` + Counter + icon badge; `vibrant_tech_glow`; `zoom_in/flip`.

## 6. Organic, Fluid & Experimental Family

### Liquid Glass Aesthetic
Look: frosted cards over blurred B-roll. Motion: `blur_focus` card entrances; base drifts beneath frost. AST: pexels Video drift + frosted Shape (`backdrop-filter: blur(16px)`); `words_stagger` on glass; `blur_focus/rise`.

### Halftone Pop Art
Look: Ben-Day dots + comic outlines + saturated panels. Motion: `back` pop-ins; `wipe_right` panel reveals. AST: `dots` + high-contrast portrait Image; bold display + shadow; `url(#fx-posterize)`; `wipe_right/flash`.

### Analog Glitch / VHS
Look: tracking noise + chromatic grit. Motion: `glitch` shake entrances + jitter loops. AST: graded Video + offset-shadow Text; `bleach_bypass`; `glitch/cut`.

### Minimalist Existential Visuals
Look: vast negative space + one line + one object. Motion: breathing `opacity` loop; near-static holds need a 1-line beat reason. AST: near-solid `vignette_loop` + single Shape/word; `fade/dissolve`.

### Gradient Mesh / Fluid Abstract
Look: organic blooms + minimal type. Motion: shader drifts full-cut; text fades over flow. AST: brand `gradient_mesh` + low-opacity dust; airy `words_stagger`; `dissolve/fade`.

### Liquid Metal Simulation
Look: chrome blobs + color-dodge highlights. Motion: slow morph drift + brightness sweep. AST: dark `waves` + blob Shape + glow; sleek minimal type; `color-dodge` highlight; `dissolve/blur_focus`.

### Ink-in-Water Simulation
Look: ink blooms + emerging text/images. Motion: `circle_iris` reveals through bloom; slow settle. AST: dark ink `waves` + masked Image reveal; serif headline; `dissolve/iris_open`.

### Liquid Morphing Animation
Look: shapes melt between beats, no visible cut. Motion: scale/blur morph across an `exit`-stagger pair in ONE take. AST: `gradient_mesh` + morph Shape pair; headline swap mid-take; `dissolve/blur_focus`.

## 7. Application Contract (binding, not decoration)

- Resolve hint → slug BEFORE storyboarding; write the slug + 1-line reason in the beat plan.
- Storyboard lines name: style slug, base/hero/text choices, filter + transition family.
- AST binds design.json: `primary` → bars/strokes/counters; `accent` → `highlight_color`/reticles; `background/text` → canvas/body; heading/body fonts → Text (Noto for hi/mr/bn/ta/te/ar/th).
- Style mismatch is a QA warning, never a render break: harness rules (F1–F14 in `editor-qa`) always win over style fidelity.
- Variety still applies: same style ≠ same transition/recipe twice in a row; alternate energy high→low→high.
- Past style misfires live in `section='learnings'` — pull before authoring.
