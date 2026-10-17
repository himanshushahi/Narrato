"""Canonical 50-style visual library — single source of truth for code.

The human-readable guide lives in
``backend/skills/shared/visual-style-library/SKILL.md`` (exposure: agent).
This module is the machine-readable mirror used by the internal pipeline
(``backend/pipeline/ai.py``), the editor bridge (``backend/core/bridge.py``)
and the MCP server (``backend/mcp/server.py``) so all three agents resolve
the same slug -> AST mapping without LLM guessing.

Design rule: styles describe LOOK + MOTION only. Colors/fonts always bind
to ``design.json`` tokens at render time — no hardcoded hex here is ever
copied verbatim into AST output.
"""
from __future__ import annotations

import re

# slug -> spec. `look` + `motion` are the 1-2 line descriptions the AI reads
# before authoring AST. `ast` is the harness mapping (Background preset,
# hero layer, text treatment, filter, transition family).
STYLE_SPECS: dict[str, dict] = {
    "editorial-paper-collage": {
        "name": "Editorial Paper Collage",
        "look": "Torn paper layers, tape strips and serif headlines on a textured paper canvas.",
        "motion": "Cards spring in with stagger 0/0.3/0.6s; paper grain stays static, foreground floats.",
        "base": "Background paper_grain",
        "hero": "Image + HTML document cards",
        "text": "serif headline, words_stagger",
        "filters": ["mix-blend-mode: multiply"],
        "transitions": ["rise", "cut"],
        "best_for": "explainers, essays, human stories",
    },
    "investigative-noir": {
        "name": "Investigative Noir",
        "look": "High-contrast black-and-white with redaction bars and typewriter labels.",
        "motion": "Slow push-in on evidence, typewriter reveals, dissolves between beats.",
        "base": "darkened Video or Image",
        "hero": "HTML dossier / redacted document",
        "text": "typewriter, mono font",
        "filters": ["noir_hard", "contrast(1.4)"],
        "transitions": ["dissolve", "fade"],
        "best_for": "true crime, investigation, exposés",
    },
    "isometric-3d-infographics": {
        "name": "Isometric 3D Infographics",
        "look": "Isometric blocks, stacks and charts on an engineering grid.",
        "motion": "Blocks pop with back-ease stagger; counters roll up on the number word.",
        "base": "Background blueprint",
        "hero": "Chart + Counter grid",
        "text": "static labels under each metric",
        "filters": ["vibrant_tech_glow"],
        "transitions": ["slide_up", "zoom_in"],
        "best_for": "metrics, comparisons, KPIs",
    },
    "blueprint-schematic": {
        "name": "Blueprint Schematic",
        "look": "Engineering graph paper with line drawings, dimensions and mono labels.",
        "motion": "SVG paths draw themselves (draw_animation), nodes pop along the track.",
        "base": "Background blueprint",
        "hero": "Shape path + circle nodes",
        "text": "mono static callouts",
        "filters": [],
        "transitions": ["slide_up", "wipe_right"],
        "best_for": "how-it-works, timelines, systems",
    },
    "cybersecurity-hud": {
        "name": "Cybersecurity HUD",
        "look": "Dark console with corner brackets, scanlines and glowing reticles.",
        "motion": "Glitch-in entrances, reticle pulse loop, ticker scan movement.",
        "base": "Background grid_flow or dark Video",
        "hero": "Shape corner_brackets + circle_reticle",
        "text": "typewriter terminal green",
        "filters": ["cyberpunk", "neon_glow_pop"],
        "transitions": ["glitch", "cut"],
        "best_for": "hacking, tech, data breaches",
    },
    "kinetic-editorial-typography": {
        "name": "Kinetic Editorial Typography",
        "look": "Giant words ARE the image — oversized type with muted echo behind the hero.",
        "motion": "words_stagger reveals on the spoken keyword; echo layer static at 10-15% opacity.",
        "base": "Background gradient_mesh or vignette_loop",
        "hero": "Text echo texture",
        "text": "marker_highlight / words_stagger, 64-200px",
        "filters": [],
        "transitions": ["cut", "flash"],
        "best_for": "quotes, hooks, data punches",
    },
    "parallax-2-5d-documentary": {
        "name": "2.5D Parallax Documentary",
        "look": "Photo split into depth layers drifting at different speeds over archival imagery.",
        "motion": "Slow scale drift 1.0→1.08 full-cut + translateX camera journey; crossfade between eras.",
        "base": "Image archive cover + slow drift",
        "hero": "cutout Image contain overlay",
        "text": "lower-third static or marker_highlight",
        "filters": ["archival_monochrome"],
        "transitions": ["crossfade", "dissolve"],
        "best_for": "history, biography, memory",
    },
    "cinematic-3d-typography": {
        "name": "Cinematic 3D Typography",
        "look": "Extruded dimensional type with depth-of-field and dramatic lighting.",
        "motion": "3D card flip rotateY 15→0 spring + motion_blur 90; slow push-in holds the take.",
        "base": "Background vignette_loop",
        "hero": "Text with perspective 800",
        "text": "large display, marker_highlight",
        "filters": ["cinematic_dark_base"],
        "transitions": ["zoom_in", "blur_focus"],
        "best_for": "titles, big reveals, trailers",
    },
    "swiss-typographic": {
        "name": "Swiss International Typographic Style",
        "look": "Strict grid, Helvetica-style grotesque, one accent color, generous whitespace.",
        "motion": "Hard cuts only; text fades in with linear precision, no bounce.",
        "base": "flat Shape or Background dots dim",
        "hero": "Text grid + thin rule line",
        "text": "static, left-aligned, tight leading",
        "filters": [],
        "transitions": ["cut"],
        "best_for": "data, policy, minimal explainers",
    },
    "brutalist-motion": {
        "name": "Brutalist Motion Design",
        "look": "Raw blocks, thick borders, oversized type, clashing flat fills.",
        "motion": "Hard cuts and flash entrances; linear slides, no soft easing.",
        "base": "flat high-contrast Shape fills",
        "hero": "Counter / block cards",
        "text": "heavy 800-900 weight, all-caps",
        "filters": ["contrast(1.3)"],
        "transitions": ["cut", "flash"],
        "best_for": "opinion, finance rants, urgency",
    },
    "liquid-glass": {
        "name": "Liquid Glass Aesthetic",
        "look": "Frosted glass cards floating over blurred cinematic B-roll.",
        "motion": "Cards blur-focus in; background drifts slowly beneath the frost.",
        "base": "Video pexels cover + drift",
        "hero": "Shape frosted card (backdrop blur 16px)",
        "text": "words_stagger on glass",
        "filters": ["backdrop-filter: blur(16px)", "blur(12px)"],
        "transitions": ["blur_focus", "rise"],
        "best_for": "tech products, app UI, premium",
    },
    "y2k-chrome": {
        "name": "Y2K Chrome Aesthetic",
        "look": "Silver gradients, bubbly shapes, playful high-gloss tech pop.",
        "motion": "Bouncy scale pops, flip transitions, floating badges.",
        "base": "Background gradient_mesh silver/blue",
        "hero": "Counter + icon badge",
        "text": "bold rounded, static + pop",
        "filters": ["vibrant_tech_glow"],
        "transitions": ["zoom_in", "flip"],
        "best_for": "pop tech, nostalgia, product drops",
    },
    "halftone-pop-art": {
        "name": "Halftone Pop Art",
        "look": "Ben-Day dots, comic outlines, saturated primary panels.",
        "motion": "Pop-in scale with back ease; wipe reveals between panels.",
        "base": "Background dots",
        "hero": "Image high-contrast portrait",
        "text": "bold display with stroke/shadow",
        "filters": ["url(#fx-posterize)", "contrast(1.3)"],
        "transitions": ["wipe_right", "flash"],
        "best_for": "pop culture, bios, bold stats",
    },
    "analog-glitch-vhs": {
        "name": "Analog Glitch / VHS",
        "look": "Tracking noise, chromatic aberration and scanline grit over footage.",
        "motion": "Glitch shake entrances, jitter loops, abrupt cuts.",
        "base": "Video with grit grade",
        "hero": "Text with offset shadow",
        "text": "mono or condensed, static",
        "filters": ["bleach_bypass"],
        "transitions": ["glitch", "cut"],
        "best_for": "retro tech, horror, true crime",
    },
    "surreal-conceptual-3d": {
        "name": "Surreal Conceptual 3D",
        "look": "Dreamlike floating objects and impossible scenes in soft light.",
        "motion": "Slow floating loops, dream-blur drifts, gentle emphasis punches.",
        "base": "pixabay illustration full-bleed",
        "hero": "transparent cutout floating",
        "text": "light words_stagger, airy",
        "filters": ["dream_blur"],
        "transitions": ["dissolve", "blur_focus"],
        "best_for": "philosophy, AI concepts, dreams",
    },
    "scientific-cutaway": {
        "name": "Scientific Cutaway Visualization",
        "look": "Labeled cross-sections and diagrams with leader lines and callouts.",
        "motion": "Pointer curves draw to labels; layers fade in along the narration path.",
        "base": "Background blueprint or minimal_light map feel",
        "hero": "HTML diagram + Shape pointer_curve",
        "text": "small static labels + headline",
        "filters": [],
        "transitions": ["slide_up", "fade"],
        "best_for": "science, medical, engineering",
    },
    "flat-vector-explainer": {
        "name": "Flat Vector Explainer",
        "look": "Clean flat characters and shapes in a friendly palette.",
        "motion": "Spring pops per element, staggered 0.2s; counters roll for stats.",
        "base": "flat Background gradient_mesh light",
        "hero": "pixabay illustration cutouts",
        "text": "rounded words_stagger",
        "filters": [],
        "transitions": ["slide_left", "rise"],
        "best_for": "beginner explainers, edtech, finance basics",
    },
    "editorial-data-visualization": {
        "name": "Editorial Data Visualization",
        "look": "Magazine-grade charts with frosted cards and refined numerals.",
        "motion": "Bars grow with glow, counters land on the number word, highlight sweeps the takeaway.",
        "base": "Background waves or dots",
        "hero": "Chart bar/line + Counter",
        "text": "typewriter stat label",
        "filters": [],
        "transitions": ["slide_up", "zoom_in"],
        "best_for": "economy, reports, data stories",
    },
    "archival-film": {
        "name": "Archival Film Aesthetic",
        "look": "Grainy newsreel photos and footage in sepia/mono with date stamps.",
        "motion": "Slow Ken Burns drift, gentle handheld shake, crossfade through eras.",
        "base": "Image archive cover",
        "hero": "HTML newspaper/document card",
        "text": "small static date stamp",
        "filters": ["archival_monochrome"],
        "transitions": ["crossfade", "dissolve"],
        "best_for": "pre-1990 history, wars, legends",
    },
    "midcentury-editorial-illustration": {
        "name": "Mid-Century Editorial Illustration",
        "look": "1950s print illustration, muted palette, paper texture multiply.",
        "motion": "Gentle rise entrances, soft emphasis holds, warm resolves.",
        "base": "Image illustration + paper texture",
        "hero": "cutout shapes",
        "text": "serif headline, static",
        "filters": ["mix-blend-mode: multiply", "vintage_sepia"],
        "transitions": ["rise", "dissolve"],
        "best_for": "culture, design history, essays",
    },
    "macro-tech-cinematography": {
        "name": "Macro Tech Cinematography",
        "look": "Extreme close-ups of chips, lenses and machinery with shallow focus.",
        "motion": "Rack-focus blur 14→0 reveal + ultra-slow scale drift across the surface.",
        "base": "Video pexels macro cover",
        "hero": "Shape reticle accent",
        "text": "minimal lower-third",
        "filters": ["cinematic_dark_base", "vibrant_tech_glow"],
        "transitions": ["blur_focus", "zoom_in"],
        "best_for": "semiconductors, manufacturing, product craft",
    },
    "holographic-wireframe": {
        "name": "Holographic Wireframe",
        "look": "Neon wireframes and grids floating over deep dark blue/black.",
        "motion": "Draw-on paths, rotating wireframe loops, glow pulses.",
        "base": "Background grid_flow dark",
        "hero": "Shape path glow + Map wireframe feel",
        "text": "thin tech type, typewriter",
        "filters": ["cyberpunk", "neon_glow_pop"],
        "transitions": ["glitch", "zoom_in"],
        "best_for": "AI, networks, futuristic systems",
    },
    "minimalist-existential": {
        "name": "Minimalist Existential Visuals",
        "look": "Vast negative space, one line of type, single small object.",
        "motion": "Long holds with breathing opacity loop; entrances barely move.",
        "base": "Background vignette_loop near-solid",
        "hero": "single Shape or word",
        "text": "small centered static",
        "filters": [],
        "transitions": ["fade", "dissolve"],
        "best_for": "philosophy, poetry, memorial beats",
    },
    "classical-oil-painting-motion": {
        "name": "Classical Oil-Painting Motion",
        "look": "Painted canvases with impasto texture and chiaroscuro grading.",
        "motion": "Museum-slow zoom 1.0→1.06 over the full cut; crossfade like gallery rooms.",
        "base": "Image archive painting cover",
        "hero": "framed inset mask",
        "text": "serif title card, static",
        "filters": ["vintage_sepia", "contrast(1.15)"],
        "transitions": ["crossfade", "dissolve"],
        "best_for": "art, history, mythology",
    },
    "claymation-craft": {
        "name": "Claymation / Stop-Motion Craft",
        "look": "Handmade clay and felt textures with visible fingerprints and grain.",
        "motion": "Stepped steps-easing pops, handheld wobble, tactile stagger.",
        "base": "Background paper_grain warm",
        "hero": "pixabay handmade cutouts",
        "text": "chunky rounded, static",
        "filters": [],
        "transitions": ["cut", "rise"],
        "best_for": "kids, playful explainers, craft stories",
    },
    "cut-paper-shadowbox": {
        "name": "Cut-Paper Shadowbox",
        "look": "Layered paper diorama with drop shadows and depth between planes.",
        "motion": "Planes parallax at different translateX speeds; soft rise entrances.",
        "base": "stacked Shape planes",
        "hero": "paper silhouette layers",
        "text": "small caption, static",
        "filters": [],
        "transitions": ["rise", "slide_up"],
        "best_for": "fables, travel, gentle history",
    },
    "neon-contour-line": {
        "name": "Neon Contour-Line Graphics",
        "look": "Glowing topographic/contour lines over near-black with one neon accent.",
        "motion": "wave_pulse paths draw across the frame; accent pulses on the keyword.",
        "base": "Background grid_flow dark",
        "hero": "Shape wave_pulse glow",
        "text": "thin uppercase static + highlight",
        "filters": ["neon_glow_pop"],
        "transitions": ["zoom_in", "blur_focus"],
        "best_for": "geography, data terrain, tech openers",
    },
    "newspaper-editorial-graphics": {
        "name": "Newspaper Editorial Graphics",
        "look": "Column grids, rule lines, pull-quotes and halftone portraits.",
        "motion": "Hard cuts like page turns; quotes rise in, images wipe revealed.",
        "base": "HTML news card on paper_grain",
        "hero": "Image archive portrait",
        "text": "serif headline + mono dateline",
        "filters": ["archival_monochrome"],
        "transitions": ["cut", "wipe_right"],
        "best_for": "news, politics, media stories",
    },
    "gradient-mesh-fluid-abstract": {
        "name": "Gradient Mesh / Fluid Abstract",
        "look": "Organic color blooms drifting behind minimal foreground type.",
        "motion": "Background shader drifts full-cut; text fades over the flow.",
        "base": "Background gradient_mesh brand colors",
        "hero": "Particles dust low opacity",
        "text": "large airy words_stagger",
        "filters": [],
        "transitions": ["dissolve", "fade"],
        "best_for": "abstract concepts, wellness, openers",
    },
    "miniature-diorama-cinematography": {
        "name": "Miniature Diorama Cinematography",
        "look": "Tilt-shift tiny-world footage with blurred top/bottom bands.",
        "motion": "Slow lateral pan across the model; captions rise like museum labels.",
        "base": "Video pexels city/crowd cover",
        "hero": "frosted label card",
        "text": "small static caption",
        "filters": ["brightness(1.05)"],
        "transitions": ["slide_left", "dissolve"],
        "best_for": "cities, logistics, playful geography",
    },
    "photorealistic-cgi": {
        "name": "Photorealistic CGI",
        "look": "Hyperreal renders and simulations indistinguishable from footage.",
        "motion": "Cinematic drift + emphasis punch on the reveal; motion_blur 180.",
        "base": "Video youtube CGI cover",
        "hero": "Counter/spec callout",
        "text": "clean sans words_stagger",
        "filters": ["vibrant_tech_glow", "cinematic_dark_base"],
        "transitions": ["zoom_in", "blur_focus"],
        "best_for": "space, future tech, product reveals",
    },
    "low-poly-3d-illustration": {
        "name": "Low-Poly 3D Illustration",
        "look": "Faceted geometric scenes in flat shaded polygons.",
        "motion": "Facets pop with back ease; camera rotates subtly via rotateY.",
        "base": "Background dots or blueprint",
        "hero": "pixabay low-poly cutout",
        "text": "geometric sans, static",
        "filters": [],
        "transitions": ["slide_up", "zoom_in"],
        "best_for": "gaming, data playgrounds, youth topics",
    },
    "voxel-art-animation": {
        "name": "Voxel Art Animation",
        "look": "Blocky cubes assembling into objects and charts.",
        "motion": "Cubes scale 0→1 staggered grid; board slides up as a whole.",
        "base": "Background blueprint dark",
        "hero": "Shape grid + Counter",
        "text": "pixel/mono label",
        "filters": [],
        "transitions": ["slide_up", "rise"],
        "best_for": "gaming, crypto, building metaphors",
    },
    "wireframe-3d-animation": {
        "name": "Wireframe 3D Animation",
        "look": "Bare mesh turntables and blueprint grids, mono stroke only.",
        "motion": "Slow rotateY loop on the hero; grid drifts beneath.",
        "base": "Background grid_flow",
        "hero": "Shape path reticle + 3D card",
        "text": "mono thin static",
        "filters": [],
        "transitions": ["fade", "zoom_in"],
        "best_for": "engineering, 3D process, blueprints",
    },
    "liquid-metal-simulation": {
        "name": "Liquid Metal Simulation",
        "look": "Chrome fluid blobs with color-dodge highlights on dark.",
        "motion": "Slow morph drift + brightness sweep; highlight dodges across the form.",
        "base": "Background waves dark metallic",
        "hero": "Shape blob + glow",
        "text": "sleek sans, minimal",
        "filters": ["mix-blend-mode: color-dodge", "contrast(1.2)"],
        "transitions": ["dissolve", "blur_focus"],
        "best_for": "luxury, automotive, premium tech",
    },
    "particle-based-motion-graphics": {
        "name": "Particle-Based Motion Graphics",
        "look": "Data and ideas carried by flowing embers, dust or money rain.",
        "motion": "Fullscreen particle loop under the hero; counter lands as particles part.",
        "base": "Background dark + Particles",
        "hero": "Counter / Chart",
        "text": "headline words_stagger",
        "filters": ["mix-blend-mode: screen"],
        "transitions": ["dissolve", "zoom_in"],
        "best_for": "celebrations, money, energy, festivals",
    },
    "volumetric-light-visualization": {
        "name": "Volumetric Light Visualization",
        "look": "God rays and dust shafts cutting through darkness.",
        "motion": "Brightness sweep reveals the subject; dust drifts upward slowly.",
        "base": "dark Video + Particles dust",
        "hero": "light shaft Shape overlay",
        "text": "soft serif/sans headline",
        "filters": ["dream_blur"],
        "transitions": ["blur_focus", "dissolve"],
        "best_for": "spiritual, science wonder, reveals",
    },
    "typography-driven-kinetic-posters": {
        "name": "Typography-Driven Kinetic Posters",
        "look": "Full-bleed poster type, one headline filling the frame.",
        "motion": "Marker sweep on the keyword + emphasis punch; hard cut to the next poster.",
        "base": "flat bold fill or Image texture",
        "hero": "giant Text",
        "text": "marker_highlight, 72-200px",
        "filters": ["contrast(1.2)"],
        "transitions": ["cut", "flash"],
        "best_for": "manifestos, CTAs, hooks",
    },
    "bauhaus-geometric-motion": {
        "name": "Bauhaus Geometric Motion",
        "look": "Primary circles, triangles and bars composing strict asymmetric layouts.",
        "motion": "Shapes slide on grid lines with linear precision; cuts on the beat.",
        "base": "flat off-white or dark + Shape primitives",
        "hero": "circle/triangle/arrow Shapes",
        "text": "grotesque static, uppercase",
        "filters": [],
        "transitions": ["cut", "slide_left"],
        "best_for": "design, architecture, systems",
    },
    "memphis-design-animation": {
        "name": "Memphis Design Animation",
        "look": "Playful squiggles, dots and pastel clashes in constant motion.",
        "motion": "Bounce-ease pops, wiggle rotates, floating confetti accents.",
        "base": "Background dots pastel",
        "hero": "icon Shapes + squiggle paths",
        "text": "bold playful, words_stagger",
        "filters": [],
        "transitions": ["rise", "zoom_in"],
        "best_for": "youth, pop explainers, recaps",
    },
    "risograph-print": {
        "name": "Risograph Print Aesthetic",
        "look": "Grainy two-color overprint with misregistered edges and paper tooth.",
        "motion": "Gentle rise entrances; duotone grades the footage into print.",
        "base": "Image/Video with duotone grade",
        "hero": "Text overprint",
        "text": "bold with multiply feel",
        "filters": ["url(#fx-duotone-midnight)"],
        "transitions": ["rise", "dissolve"],
        "best_for": "indie, zines, art topics",
    },
    "photocopy-zine-collage": {
        "name": "Photocopy Zine Collage",
        "look": "Xeroxed cutouts, harsh contrast, ransom-note type pasted at angles.",
        "motion": "Jittering cuts, flash reveals, rotated static cards.",
        "base": "paper_grain harsh + archive cutouts",
        "hero": "collage Image layers",
        "text": "mixed fonts, rotated static",
        "filters": ["noir_hard", "contrast(1.4)"],
        "transitions": ["cut", "glitch"],
        "best_for": "punk, protest, underground culture",
    },
    "double-exposure-cinematography": {
        "name": "Double Exposure Cinematography",
        "look": "Portrait silhouette filled with landscape/city footage.",
        "motion": "Inner footage drifts slowly inside the still silhouette; soft dissolve out.",
        "base": "Image portrait + Video landscape screen-blend",
        "hero": "masked Video layer",
        "text": "quiet lower-third",
        "filters": ["mix-blend-mode: screen", "mix-blend-mode: overlay"],
        "transitions": ["dissolve", "crossfade"],
        "best_for": "identity, memory, human-nature stories",
    },
    "silhouette-animation": {
        "name": "Silhouette Animation",
        "look": "Black shapes acting against gradient skies and backlight.",
        "motion": "Silhouettes slide across the light; slow push-in builds tension.",
        "base": "Background gradient_mesh sunset",
        "hero": "Shape black figures",
        "text": "minimal caption",
        "filters": ["contrast(1.2)"],
        "transitions": ["dissolve", "fade"],
        "best_for": "fables, history, emotional beats",
    },
    "parallax-cutout-animation": {
        "name": "Parallax Cutout Animation",
        "look": "Cutout person/object floating over a living scene with real depth.",
        "motion": "Foreground floats, background drifts opposite; subtle handheld camera.",
        "base": "Video pexels scene drift",
        "hero": "pixabay cutout contain + floating",
        "text": "lower-third headline",
        "filters": ["cinematic_dark_base"],
        "transitions": ["slide_left", "rise"],
        "best_for": "hosts, sports, product people",
    },
    "ink-in-water-simulation": {
        "name": "Ink-in-Water Simulation",
        "look": "Ink blooms unfolding in water as text and images emerge from the cloud.",
        "motion": "Circle-iris reveals through the bloom; slow dissolve settles the frame.",
        "base": "Background waves dark ink",
        "hero": "masked Image reveal",
        "text": "serif emerging headline",
        "filters": [],
        "transitions": ["dissolve", "iris_open"],
        "best_for": "poetry, science beauty, brand reveals",
    },
    "liquid-morphing-animation": {
        "name": "Liquid Morphing Animation",
        "look": "Shapes melt and reform between beats without a visible cut.",
        "motion": "Scale/blur morph across an exit-stagger pair inside one continuous take.",
        "base": "Background gradient_mesh",
        "hero": "Shape morph pair",
        "text": "headline swaps mid-take",
        "filters": [],
        "transitions": ["dissolve", "blur_focus"],
        "best_for": "transformations, before/after, evolution",
    },
    "abstract-topographic-animation": {
        "name": "Abstract Topographic Animation",
        "look": "Animated contour maps and terrain lines flowing like data landscapes.",
        "motion": "Contour loops drift linearly; nodes pop where the narration lands facts.",
        "base": "Background blueprint",
        "hero": "Shape wave_pulse loop + Counter",
        "text": "mono data labels",
        "filters": [],
        "transitions": ["slide_up", "dissolve"],
        "best_for": "geography, climate, data terrain",
    },
    "photogrammetry-3d-environments": {
        "name": "Photogrammetry 3D Environments",
        "look": "Scanned real places with photographic texture and imperfect geometry.",
        "motion": "Handheld push-in through the scan; evidence cards fade over the texture.",
        "base": "archive/youtube place footage",
        "hero": "HTML evidence card",
        "text": "documentary lower-third",
        "filters": [],
        "transitions": ["crossfade", "slide_left"],
        "best_for": "archaeology, travel, heritage",
    },
    "unreal-engine-cinematic": {
        "name": "Unreal Engine Cinematic",
        "look": "AAA virtual-production lighting with volumetric depth and lens polish.",
        "motion": "Slow cinematic push + emphasis punch on the money shot; shutter blur 180.",
        "base": "Video youtube cinematic cover",
        "hero": "spec Counter / glass card",
        "text": "cinematic sans words_stagger",
        "filters": ["cinematic_dark_base", "contrast(1.2)"],
        "transitions": ["zoom_in", "blur_focus"],
        "best_for": "finales, launches, trailers",
    },
}

# Human aliases -> slug. Covers numbers, short names and common misspellings.
STYLE_ALIASES: dict[str, str] = {}
for _i, _slug in enumerate(list(STYLE_SPECS), start=1):
    STYLE_ALIASES[str(_i)] = _slug
    STYLE_ALIASES[f"style {_i}"] = _slug
    STYLE_ALIASES[_slug] = _slug
    STYLE_ALIASES[_slug.replace("-", " ")] = _slug
    STYLE_ALIASES[_slug.replace("-", "_")] = _slug
    STYLE_ALIASES[STYLE_SPECS[_slug]["name"].lower()] = _slug

_EXTRA_ALIASES = {
    "noir": "investigative-noir",
    "true crime": "investigative-noir",
    "hud": "cybersecurity-hud",
    "cyber": "cybersecurity-hud",
    "hacker": "cybersecurity-hud",
    "kinetic type": "kinetic-editorial-typography",
    "kinetic typography": "kinetic-editorial-typography",
    "2.5d": "parallax-2-5d-documentary",
    "parallax": "parallax-2-5d-documentary",
    "3d type": "cinematic-3d-typography",
    "swiss": "swiss-typographic",
    "brutalist": "brutalist-motion",
    "brutalism": "brutalist-motion",
    "glass": "liquid-glass",
    "glassmorphism": "liquid-glass",
    "y2k": "y2k-chrome",
    "chrome": "y2k-chrome",
    "pop art": "halftone-pop-art",
    "halftone": "halftone-pop-art",
    "vhs": "analog-glitch-vhs",
    "glitch": "analog-glitch-vhs",
    "surreal": "surreal-conceptual-3d",
    "cutaway": "scientific-cutaway",
    "flat explainer": "flat-vector-explainer",
    "vector explainer": "flat-vector-explainer",
    "data viz": "editorial-data-visualization",
    "archival": "archival-film",
    "vintage film": "archival-film",
    "midcentury": "midcentury-editorial-illustration",
    "mid-century": "midcentury-editorial-illustration",
    "macro": "macro-tech-cinematography",
    "hologram": "holographic-wireframe",
    "wireframe hologram": "holographic-wireframe",
    "minimal": "minimalist-existential",
    "minimalism": "minimalist-existential",
    "minimalist": "minimalist-existential",
    "minimalistic": "minimalist-existential",
    "negative space": "minimalist-existential",
    "oil painting": "classical-oil-painting-motion",
    "clay": "claymation-craft",
    "stop motion": "claymation-craft",
    "stop-motion": "claymation-craft",
    "shadowbox": "cut-paper-shadowbox",
    "paper shadowbox": "cut-paper-shadowbox",
    "neon contour": "neon-contour-line",
    "contour": "neon-contour-line",
    "newspaper": "newspaper-editorial-graphics",
    "gradient mesh": "gradient-mesh-fluid-abstract",
    "fluid abstract": "gradient-mesh-fluid-abstract",
    "diorama": "miniature-diorama-cinematography",
    "miniature": "miniature-diorama-cinematography",
    "tilt shift": "miniature-diorama-cinematography",
    "cgi": "photorealistic-cgi",
    "low poly": "low-poly-3d-illustration",
    "low-poly": "low-poly-3d-illustration",
    "voxel": "voxel-art-animation",
    "wireframe": "wireframe-3d-animation",
    "liquid metal": "liquid-metal-simulation",
    "chrome fluid": "liquid-metal-simulation",
    "particles": "particle-based-motion-graphics",
    "particle": "particle-based-motion-graphics",
    "volumetric": "volumetric-light-visualization",
    "god rays": "volumetric-light-visualization",
    "poster": "typography-driven-kinetic-posters",
    "kinetic poster": "typography-driven-kinetic-posters",
    "bauhaus": "bauhaus-geometric-motion",
    "memphis": "memphis-design-animation",
    "riso": "risograph-print",
    "risograph": "risograph-print",
    "zine": "photocopy-zine-collage",
    "photocopy": "photocopy-zine-collage",
    "double exposure": "double-exposure-cinematography",
    "silhouette": "silhouette-animation",
    "cutout": "parallax-cutout-animation",
    "cut-out": "parallax-cutout-animation",
    "ink": "ink-in-water-simulation",
    "ink in water": "ink-in-water-simulation",
    "morph": "liquid-morphing-animation",
    "liquid morph": "liquid-morphing-animation",
    "topographic": "abstract-topographic-animation",
    "topo": "abstract-topographic-animation",
    "photogrammetry": "photogrammetry-3d-environments",
    "3d scan": "photogrammetry-3d-environments",
    "unreal": "unreal-engine-cinematic",
    "ue5": "unreal-engine-cinematic",
    "paper collage": "editorial-paper-collage",
    "collage": "editorial-paper-collage",
    "isometric": "isometric-3d-infographics",
    "blueprint": "blueprint-schematic",
    "schematic": "blueprint-schematic",
}
for _k, _v in _EXTRA_ALIASES.items():
    STYLE_ALIASES.setdefault(_k, _v)


def _norm(text: str | None) -> str:
    t = (text or "").strip().lower()
    t = re.sub(r"\s+", " ", t)
    return t.strip(" -_:.")


def _is_whole_word_hit(alias: str, key: str) -> bool:
    """True when alias occurs in key on non-alnum boundaries.

    Prevents "topo" matching "topology" or "ink" matching "think":
    the chars before/after the hit must not be [a-z0-9].
    Aliases of >=3 chars qualify (hud, y2k, vhs, cgi, ink, topo, ...)
    — these are niche style tokens, not common English words, so the
    boundary check alone is enough protection against false positives.
    """
    start = key.find(alias)
    while start != -1:
        before = key[start - 1] if start > 0 else " "
        end = start + len(alias)
        after = key[end] if end < len(key) else " "
        if not before.isalnum() and not after.isalnum():
            return True
        start = key.find(alias, start + 1)
    return False


def resolve_style(style_hint: str | None) -> str | None:
    """Fuzzy-match free-text style_hint -> canonical slug, or None.

    Never raises; unknown hints return None so callers fall back to
    topic-driven art direction.
    Longest aliases win so "wireframe hologram" beats bare "wireframe".
    """
    key = _norm(style_hint)
    if not key:
        return None
    if key in STYLE_ALIASES:
        return STYLE_ALIASES[key]
    # longest-first whole-word match: "dark noir investigation" ->
    # investigative-noir, but "topology" does NOT trigger "topo".
    for alias, slug in sorted(STYLE_ALIASES.items(), key=lambda kv: len(kv[0]), reverse=True):
        if len(alias) >= 3 and _is_whole_word_hit(alias, key):
            return slug
    for slug, spec in STYLE_SPECS.items():
        if slug in key or spec["name"].lower() in key:
            return slug
    return None


def list_styles() -> list[dict]:
    """Ordered index for prompts and UIs: [{n, slug, name, look, best_for}]."""
    out = []
    for i, (slug, spec) in enumerate(STYLE_SPECS.items(), start=1):
        out.append({
            "n": i,
            "slug": slug,
            "name": spec["name"],
            "look": spec["look"],
            "motion": spec["motion"],
            "best_for": spec.get("best_for", ""),
        })
    return out


def style_block(slug: str | None, *, compact: bool = False) -> str:
    """Render the injection block for LLM prompts. Empty when slug is None/unknown."""
    if not slug or slug not in STYLE_SPECS:
        return ""
    s = STYLE_SPECS[slug]
    filters = ", ".join(f'`{f}`' for f in s.get("filters", [])) or "none — bind design.json grade"
    transitions = ", ".join(f'`{t}`' for t in s.get("transitions", []))
    if compact:
        return (
            f"ACTIVE VISUAL STYLE: {s['name']} ({slug}) — {s['look']} "
            f"Motion: {s['motion']} Base: {s['base']}; hero: {s['hero']}; "
            f"text: {s['text']}; filters: {filters}; transitions: {transitions}. "
            "Bind all colors/fonts to design.json tokens."
        )
    return (
        f"=== ACTIVE VISUAL STYLE: {s['name']} ({slug}) ===\n"
        f"Look: {s['look']}\n"
        f"Motion: {s['motion']}\n"
        f"Base layer: {s['base']}. Hero: {s['hero']}. Text: {s['text']}.\n"
        f"Filters (use these exact tokens verbatim in the layer `filters` array, or omit when 'none'; never invent variants): {filters}. Prefer transitions: {transitions}.\n"
        f"Best for: {s.get('best_for', 'general beats')}.\n"
        "Rules: bind every color/font to design.json tokens (never hardcode style hex); "
        "keep one style per scene; vary transitions so consecutive cuts differ; "
        "full harness grammar in declarative-ast still applies."
    )


def style_index_lines() -> str:
    """50-row compact index for starter packs (1 line per style)."""
    lines = []
    for i, (slug, spec) in enumerate(STYLE_SPECS.items(), start=1):
        lines.append(f"{i:02d}. {spec['name']} ({slug}) — {spec['look']}")
    return "\n".join(lines)


def resolve_style_with_override(project_hint: str | None, extra: str | None = None) -> str | None:
    """Rewrite-prompt wins over project hint; project hint wins over nothing.

    Used by the editor bridge so "make it noir" in a rewrite box resolves
    even when the project hint is empty or names a different style.
    """
    for candidate in (extra, project_hint):
        slug = resolve_style(candidate)
        if slug:
            return slug
    return None


def style_block_for(project_hint: str | None, extra: str | None = None, *, compact: bool = False) -> tuple[str, str | None]:
    """(block, slug): injection text + resolved slug for logging."""
    slug = resolve_style_with_override(project_hint, extra)
    return style_block(slug, compact=compact), slug
