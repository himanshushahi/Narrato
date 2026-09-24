"""
Centralized Video Style & Genre Profiles Registry.

Defines narrative formulas, pacing, design system guidelines, AST visual archetypes,
and motion defaults for each supported video style.
"""

from typing import Dict, Any
import hashlib
import random


GENRE_PROFILES: Dict[str, Dict[str, Any]] = {
    "documentary": {
        "id": "documentary",
        "name": "Documentary & Geopolitics",
        "tagline": "Ken Burns, Maps, Archival Footage, Cinematic Pacing",
        "pacing_wps": 2.8,
        "narrative_style": (
            "Investigative, dramatic, and immersive. Use suspenseful storytelling arcs with cold open hooks. "
            "Establish high stakes, reveal hidden facts, examine historical causes, and provide insightful geopolitical analysis."
        ),
        "hook_formula": "Drop the audience immediately into the pivotal mystery, turning point, or high-stakes consequence.",
        "design_system": {
            "theme_suggestions": ["Cinematic Dossier", "Oceanic Deep Investigation", "Archival Chronicle"],
            "palette_guide": "Background: #0a0e17 (deep dark navy), Primary: #facc15 (vintage gold), Secondary: #38bdf8 (sky blue), Accent: #ef4444 (alert crimson), Text: #f8fafc (crisp off-white).",
            "css_guidelines": "Dark panels with 12px rounded corners, atmospheric vignettes.",
        },
        "visual_archetypes": [
            "Geographic Route Map with animated trajectory arch and city pins",
            "Investigative Leaked Memo Dossier with yellow highlighter pull-quotes",
            "Archival Entity Portrait with Ken Burns slow continuous scale drift",
            "Split-Screen Data HUD with financial chart and contextual footage inset",
            "Cinematic High-Contrast B-Roll Beat for atmospheric reflection",
            "Entity Spotlight with darkened full-screen Image and bio card overlay",
            "Data Infographic Showcase with HTML gradient background, chart card, and floating callout"
        ],
        "primitive_weights": ["HTML", "Image", "Video", "Chart", "Map", "Shape", "Text", "Counter", "Background", "Particles"],
        "motion_defaults": {
            "camera_shake": "handheld",
            "motion_blur": True,
            "shutter_angle": 180,
        },
    },

    "explainer": {
        "id": "explainer",
        "name": "Tech & SaaS Explainer",
        "tagline": "Vector Graphics, Fast Snappy Motion, Neon HUDs, Code Blocks",
        "pacing_wps": 3.4,
        "narrative_style": (
            "Fast-paced, energetic, and highly educational. Break down complex systems into digestible mental models. "
            "Use problem-solution structures: 'Here is the bottleneck -> here is the architecture that fixes it'."
        ),
        "hook_formula": "State the massive technical problem or mind-bending engineering feat within the first 4 seconds.",
        "design_system": {
            "theme_suggestions": ["Cyberpunk Neon HUD", "Electric Vector Flow", "Dark Terminal Core"],
            "palette_guide": "Background: #080c14 (slate black), Primary: #00d4ff (electric cyan), Secondary: #8b5cf6 (neon violet), Accent: #10b981 (emerald status), Text: #ffffff (pure white).",
            "css_guidelines": "High-tech terminal cards with 6px border-radius, neon glow (0 0 16px rgba(0, 212, 255, 0.35)), monospace code chips, crisp technical reticles.",
        },
        "visual_archetypes": [
            "Technical Blueprint HUD with transparent vector diagrams and pointer arrows",
            "Lottie Micro-Animation Badges with rotating status indicators and checkmarks",
            "Dynamic Infographic Flowchart with step-by-step glowing connection paths",
            "Live Code / Terminal Snippet with syntax highlighted callouts and typewriter reveal",
            "Metric Progress Comparison with multi-bar animated statistics"
        ],
        "primitive_weights": ["Shape", "Lottie", "Chart", "Counter", "HTML", "Background", "Text", "Image", "Particles"],
        "motion_defaults": {
            "camera_shake": "glitch",
            "motion_blur": True,
            "shutter_angle": 180,
        },
    },

    "finance": {
        "id": "finance",
        "name": "Finance & Market Deep-Dive",
        "tagline": "Interactive Charts, Valuations, Stock Tickers, Economic Indicators",
        "pacing_wps": 3.1,
        "narrative_style": (
            "Analytical, authoritative, and data-driven. Follow the money trail, dissect corporate balance sheets, "
            "market bubbles, interest rate hikes, and economic fallout with forensic precision."
        ),
        "hook_formula": "Reveal a staggering monetary loss, astronomical valuation, or market crash metric right away.",
        "design_system": {
            "theme_suggestions": ["Bloomberg Terminal Matrix", "Wall Street Midnight", "Capital Flow Grid"],
            "palette_guide": "Background: #06090e (deep onyx), Primary: #10b981 (bull market emerald), Secondary: #f59e0b (gold bullion), Accent: #ef4444 (bear drop red), Text: #f1f5f9 (platinum white).",
            "css_guidelines": "Sharp financial data cards, candlestick green/red metric tickers, frosted glass backdrop filters, gold pill badges.",
        },
        "visual_archetypes": [
            "Animated Financial Bar & Donut Charts showing revenue distributions and market shares",
            "Stock Plunge / Surge Card with shockwave vibration and Lucide trending icons",
            "Comparison Matrix Card contrasting competing valuations and growth percentages",
            "Leaked Balance Sheet / Audit Memo with highlighted suspicious line items",
            "Macro Economic Metric Callout with 99% rolling number animation"
        ],
        "primitive_weights": ["Chart", "Counter", "Shape", "HTML", "Background", "Text", "Image", "Video", "Particles"],
        "motion_defaults": {
            "camera_shake": "shockwave",
            "motion_blur": True,
            "shutter_angle": 180,
        },
    },

    "vox": {
        "id": "vox",
        "name": "Vox-Style Editorial Infographic",
        "tagline": "Bold Kinetic Typography, Stark Yellow/Black Contrast, Cutout Cards",
        "pacing_wps": 3.2,
        "narrative_style": (
            "Curiosity-driven, clear, and journalistic. Ask fundamental 'Why does this happen?' questions. "
            "Use clear analogies, direct causal relationships, and visual evidence to deconstruct complex topics."
        ),
        "hook_formula": "Present a counter-intuitive fact or paradox that challenges the viewer's everyday assumption.",
        "design_system": {
            "theme_suggestions": ["Vox Editorial Yellow", "Stark Headline Minimalist", "Paper Craft Dossier"],
            "palette_guide": "Background: #09090b (deep carbon), Primary: #facc15 (pure editorial yellow), Secondary: #ffffff (stark paper white), Accent: #f43f5e (rose accent), Text: #ffffff (high-contrast white).",
            "css_guidelines": "Stark high-contrast cards, thick yellow marker highlight borders, bold display headings, transparent PNG vector cutouts.",
        },
        "visual_archetypes": [
            "Kinetic Staggered Typography with bright yellow marker highlight on key terms",
            "Transparent Cutout Illustration with solid colored framing boxes and pointers",
            "Animated Step-by-Step Timeline with connected route arches and date markers",
            "Side-by-Side Comparison Split Card highlighting stark visual contrasts",
            "Animated Donut / Bar Infographic with bold percentage callouts"
        ],
        "primitive_weights": ["Text", "Shape", "Image", "Chart", "Counter", "HTML", "Background", "Map", "Particles"],
        "motion_defaults": {
            "camera_shake": "handheld",
            "motion_blur": True,
            "shutter_angle": 180,
        },
    },

    "news": {
        "id": "news",
        "name": "News & Current Affairs Broadcast",
        "tagline": "Split-Screen Insets, Lower-Third Banners, Live Tickers, Headlines",
        "pacing_wps": 3.2,
        "narrative_style": (
            "Direct, objective, and urgent. Follow the inverted pyramid structure (Lead news -> Essential details -> Reactions and implications). "
            "Maintain strong journalistic cadence and active verbs."
        ),
        "hook_formula": "Lead with the breaking headline, major policy shift, or developing situation in the first sentence.",
        "design_system": {
            "theme_suggestions": ["Global Broadcast News", "Breaking Wire Slate", "Prime Time Intelligence"],
            "palette_guide": "Background: #0b0f19 (broadcast navy), Primary: #dc2626 (breaking red), Secondary: #3b82f6 (network blue), Accent: #f59e0b (amber alert), Text: #ffffff (pure white).",
            "css_guidelines": "Horizontal lower-third banner bars, live pulsing indicator dots, crisp rectangular photo insets, headline typography.",
        },
        "visual_archetypes": [
            "Broadcast Split-Screen with live speaker inset and contextual breaking footage",
            "Urgent Lower-Third Banner Pill with red badge, title headline, and live source tag",
            "Newspaper Front-Page Headline zoom with glowing highlighted lead paragraphs",
            "Quote Callout Card with interviewee attribution and corporate logo badge",
            "Timeline of Recent Developments with live timestamp tickers"
        ],
        "primitive_weights": ["HTML", "Image", "Video", "Text", "Counter", "Shape", "Chart", "Background", "Particles"],
        "motion_defaults": {
            "camera_shake": "none",
            "motion_blur": False,
            "shutter_angle": 180,
        },
    },

    "true_crime": {
        "id": "true_crime",
        "name": "True Crime & Investigative Mystery",
        "tagline": "Redacted Documents, Forensic Evidence, Shockwave Impact, Audio Waves",
        "pacing_wps": 2.6,
        "narrative_style": (
            "Atmospheric, tense, and psychological. Build suspense through careful pacing, timeline clues, "
            "unsolved contradictions, suspect motives, and forensic evidence reveals."
        ),
        "hook_formula": "Start with the chilling moment of discovery or the puzzling clue that defied all explanation.",
        "design_system": {
            "theme_suggestions": ["Forensic Noir", "Classified Casefile", "Midnight Redacted"],
            "palette_guide": "Background: #050505 (deep obsidian), Primary: #991b1b (crimson blood), Secondary: #d97706 (amber evidence), Accent: #ef4444 (red string warning), Text: #f3f4f6 (pale bone).",
            "css_guidelines": "Redacted black marker stripes, polaroid-style evidence frames, typewriter monospaced fonts, dark vignetted backdrops.",
        },
        "visual_archetypes": [
            "Redacted Investigation Memo with black marker redaction bars and typewriter text",
            "Suspect / Evidence Pinboard with red connecting string pointer paths",
            "CCTV Surveillance Footage Beat with timestamp watermark and scanlines",
            "Forensic Timeline Card with evidence photo and blood-red marker stamp",
            "Impact Shockwave Clue Reveal with decaying earthquake camera shake"
        ],
        "primitive_weights": ["HTML", "Image", "Shape", "Text", "Video", "Map", "Background", "Counter", "Particles"],
        "motion_defaults": {
            "camera_shake": "shockwave",
            "motion_blur": True,
            "shutter_angle": 180,
        },
    },

    "storytime": {
        "id": "storytime",
        "name": "Personal Story & Essay",
        "tagline": "Warm Portraits, Soft Focus, Emotional Kinetic Quotes, Life Timelines",
        "pacing_wps": 2.9,
        "narrative_style": (
            "Intimate, reflective, and conversational. Use a relatable first-person narrative arc, vulnerability, "
            "lessons learned, and personal milestones to form a genuine human connection with the viewer."
        ),
        "hook_formula": "Share an unexpected personal realization, failure, or life-altering turning point.",
        "design_system": {
            "theme_suggestions": ["Warm Amber Narrative", "Cozy Coffee Essay", "Minimalist Journal"],
            "palette_guide": "Background: #141210 (warm espresso charcoal), Primary: #f59e0b (warm honey amber), Secondary: #fbbf24 (soft gold), Accent: #10b981 (sage green), Text: #fef3c7 (warm parchment).",
            "css_guidelines": "Soft 20px rounded card corners, warm subtle gradient glows, elegant serif/rounded headings, comfortable line height.",
        },
        "visual_archetypes": [
            "Warm Photographic Portrait with gentle soft-focus Ken Burns scale drift",
            "Emotional Kinetic Quote with typewriter typing animation and warm amber glow",
            "Personal Milestone Timeline card marking life chapters and key dates",
            "Reflective Atmospheric Video beat with warm amber color wash",
            "Journal / Diary Note card entering with gentle spring physics"
        ],
        "primitive_weights": ["Image", "Text", "Video", "HTML", "Shape", "Lottie", "Background", "Counter", "Particles"],
        "motion_defaults": {
            "camera_shake": "handheld",
            "motion_blur": True,
            "shutter_angle": 180,
        },
    },

    "viral_short": {
        "id": "viral_short",
        "name": "Viral Short-Form / TikTok & Reels",
        "tagline": "Fast 1.5s Cuts, Center Kinetic Words, High Energy, Bouncing Badges",
        "pacing_wps": 3.6,
        "narrative_style": (
            "Hyper-engaging, punchy, and zero-fluff. Every single second must earn retention. "
            "Use fast pattern interrupts, rapid-fire facts, strong sensory words, and an irresistible loop CTA."
        ),
        "hook_formula": "Drop a massive shock-value statement or visual pattern interrupt in the very first second.",
        "design_system": {
            "theme_suggestions": ["Hyper-Viral Neon", "TikTok Kinetic Blast", "Electric Punch"],
            "palette_guide": "Background: #000000 (pure OLED black), Primary: #00f2fe (electric cyan), Secondary: #fe0979 (neon hot pink), Accent: #ffea00 (blinding yellow), Text: #ffffff (stark white).",
            "css_guidelines": "High-contrast thick text outlines, bright neon glow blooms, bold pill stickers, maximum readability in 9:16 portrait.",
        },
        "visual_archetypes": [
            "Massive Centered Kinetic Words with word-stagger reveal and glowing color markers",
            "Lottie Vector Emotion & Badge Pops with spring bounce scale (0 -> 1.2 -> 1.0)",
            "Split Rapid Comparison Card with glowing VS reticle",
            "High-Tempo Background Motion video with rapid zoom bursts",
            "Large Metric Badge with instant neon highlight reveal"
        ],
        "primitive_weights": ["Text", "Counter", "Lottie", "Shape", "Image", "Video", "HTML", "Background", "Particles"],
        "motion_defaults": {
            "camera_shake": "glitch",
            "motion_blur": True,
            "shutter_angle": 180,
        },
    },
}


def normalize_genre_key(genre: str) -> str:
    """Normalizes any genre string or alias to a valid GENRE_PROFILES key."""
    if not genre:
        return "documentary"

    cleaned = genre.strip().lower().replace("-", "_").replace(" ", "_")

    # Direct match
    if cleaned in GENRE_PROFILES:
        return cleaned

    # Alias mapping
    aliases = {
        "tech": "explainer",
        "tech_explainer": "explainer",
        "saas": "explainer",
        "coding": "explainer",
        "crypto": "finance",
        "business": "finance",
        "stock": "finance",
        "economy": "finance",
        "journalism": "news",
        "breaking_news": "news",
        "crime": "true_crime",
        "mystery": "true_crime",
        "thriller": "true_crime",
        "personal": "storytime",
        "story": "storytime",
        "essay": "storytime",
        "vlog": "storytime",
        "short": "viral_short",
        "shorts": "viral_short",
        "reels": "viral_short",
        "tiktok": "viral_short",
        "viral": "viral_short",
        "editorial": "vox",
        "infographic": "vox",
    }

    if cleaned in aliases:
        return aliases[cleaned]

    # Substring search
    for key in GENRE_PROFILES:
        if key in cleaned or cleaned in key:
            return key

    return "documentary"


def get_genre_profile(genre: str) -> Dict[str, Any]:
    """Returns the full GenreProfile dictionary for a given genre string."""
    key = normalize_genre_key(genre)
    return GENRE_PROFILES.get(key, GENRE_PROFILES["documentary"])


def format_genre_design_prompt(genre: str, topic: str = "", title: str = "", seed_hint: str = "") -> str:
    """Formats genre-tailored aesthetic guidance for the Art Director design system prompt.

    Variety mechanism: every call assigns ONE rotating color direction derived
    from topic/title/seed so the LLM cannot fall back to the same dark-navy +
    cyan palette each time. A fresh seed_hint per request means consecutive
    regenerations rotate lanes; repeat stability comes from the design.json
    cache (generate_project_design_system reuses the saved design instead of
    calling the LLM again), not from lane reuse. The per-genre palette_guide
    is kept as a genre anchor but is explicitly labeled REFERENCE-ONLY
    (do not copy).
    """
    profile = get_genre_profile(genre)
    ds = profile["design_system"]
    themes = ", ".join(f'"{t}"' for t in ds["theme_suggestions"])
    direction = pick_variety_direction(topic, title, seed_hint, genre=normalize_genre_key(genre))
    return f"""GENRE CONTEXT ({profile['name'].upper()}):
- Target Style: {profile['name']} — {profile['tagline']}
- Theme Suggestions (invent your own 2-4 word name — do NOT reuse these verbatim): {themes}
- Reference Palette (GENRE ANCHOR ONLY — DO NOT COPY these hex values verbatim, invent a fresh palette in the same spirit): {ds['palette_guide']}
- Aesthetic Guidelines: {ds['css_guidelines']}
- ASSIGNED VARIETY DIRECTION (MUST FOLLOW — this is how you surprise the user): {direction}
  * Honor the genre mood above AND the lighting/hue constraint of this direction. If they clash, keep the direction's lighting but preserve one genre-anchor hue family so the result stays on-brand.
  * Your background/primary/secondary/accent hex codes MUST be visibly different from the reference palette.
  * Never emit #0b0b1a / #0f172a / #00d4ff / #facc15 unless the assigned direction explicitly calls for them."""


# Distinct lighting + hue lanes the Art Director must rotate through.
# Each lane stays WCAG-readable but forces a visibly different first impression
# (dark cinematic is only ONE of many allowed looks).
VARIETY_DIRECTIONS = [
    "DARK CINEMATIC — near-black background, one hot neon primary, cool secondary",
    "LIGHT EDITORIAL — warm paper background (#faf7f0 family), ink text, one saturated primary",
    "MIDNIGHT MONO + SINGLE POP — charcoal/graphite background, grayscale secondary, exactly one vivid accent",
    "DEEP EARTH — espresso/forest background, amber/honey primary, sage secondary",
    "OCEANIC TEAL — deep teal/petrol background, aqua primary, coral accent",
    "ROYAL PLUM — dark plum/eggplant background, gold primary, orchid secondary",
    "ARCTIC FROST — pale icy background, navy ink text, electric-blue primary",
    "SUNSET DUOTONE — warm dusk background, tangerine primary, magenta accent",
    "FOREST MOSS — dark moss background, lime/mint primary, sand secondary",
    "CRIMSON NOIR — black-red background, crimson primary, bone text",
    "SLATE MINIMAL — light slate background, slate-900 text, single indigo primary",
    "DESERT SAND — sandy beige background, burnt-orange primary, olive secondary",
]

# Genre -> lane keywords excluded so dark-brand genres never get light lanes
# and warm personal genres never get harsh noir/mono lanes.
_GENRE_LANE_EXCLUSIONS = {
    "true_crime": ("LIGHT EDITORIAL", "ARCTIC FROST", "SLATE MINIMAL", "DESERT SAND"),
    "viral_short": ("LIGHT EDITORIAL", "ARCTIC FROST", "SLATE MINIMAL", "DESERT SAND"),
    "news": ("DESERT SAND", "DEEP EARTH", "FOREST MOSS", "SUNSET DUOTONE"),
    "storytime": ("CRIMSON NOIR", "MIDNIGHT MONO"),
}


def pick_variety_direction(topic: str = "", title: str = "", seed_hint: str = "", genre: str = "") -> str:
    """Deterministically pick a variety lane from topic/title/seed.

    Every distinct seed_hint rotates the lane, so consecutive 'Regenerate'
    clicks surprise the user. Repeat stability is provided by the design.json
    cache (no new LLM call), not by lane reuse. Lanes that clash with the
    genre brand (e.g. light editorial on true_crime) are filtered out first.
    """
    lanes = list(VARIETY_DIRECTIONS)
    excluded = _GENRE_LANE_EXCLUSIONS.get((genre or "").strip().lower(), ())
    if excluded:
        filtered = [lane for lane in lanes if not lane.startswith(excluded)]
        if filtered:
            lanes = filtered
    key = f"{topic or ''}|{title or ''}|{seed_hint or ''}".strip("|")
    if not key:
        return random.choice(lanes)
    digest = hashlib.sha256(key.encode("utf-8")).digest()
    return lanes[int.from_bytes(digest[:2], "big") % len(lanes)]


def format_genre_script_prompt(genre: str) -> str:
    """Formats narrative style, hook formula, and spoken pacing for scriptwriter prompts."""
    profile = get_genre_profile(genre)
    return f"""GENRE NARRATIVE DIRECTIVE ({profile['name'].upper()}):
- Style & Tone: {profile['narrative_style']}
- Hook Requirement: {profile['hook_formula']}
- Spoken Pacing Target: ~{profile['pacing_wps']} words per second."""


def format_genre_storyboard_prompt(genre: str) -> str:
    """Formats visual archetype priorities and primitive weights for storyboard planning."""
    profile = get_genre_profile(genre)
    archetypes = "\n".join(f"  * {arch}" for arch in profile["visual_archetypes"])
    primitives = ", ".join(profile["primitive_weights"])
    return f"""GENRE VISUAL STORYBOARD DIRECTIVE ({profile['name'].upper()}):
- Preferred Visual Archetypes for this Genre:
{archetypes}
- Recommended Primitive Priority: {primitives}
- Motion / Camera Shake Defaults: camera_shake="{profile['motion_defaults']['camera_shake']}", motion_blur={profile['motion_defaults']['motion_blur']}"""
