import concurrent.futures
import json
import re
import requests
import time
import random
import ast
import hashlib
import threading
from backend.database.db import get_setting, update_project
from backend.core.logger import logger
import urllib.request
import urllib.parse
from pathlib import Path
from backend.agent.skill_loader import skill_loader
from backend.pipeline.assets import _has_meaningful_sub_visuals


def _get_web_context(search_query: str) -> str:
    """Search the web via LangSearch and return formatted context, if enabled.

    Returns empty string when web search is disabled, API key is missing,
    or the search fails — script generation should never block on this.
    """
    from backend.database.db import get_setting as _gs

    enabled = _gs("web_search_enabled")
    if not enabled or enabled in (False, "False"):
        return ""

    api_key = _gs("web_search_api_key")
    if not api_key:
        logger.info("Web search is enabled but no API key is configured — skipping.")
        return ""

    from backend.pipeline.web_search import search_and_format, clean_search_query

    # Strip non-Latin text (Hindi/Devanagari) — web search APIs perform poorly
    # with mixed-script queries since video titles often include language markers
    clean_query = clean_search_query(search_query)

    try:
        logger.info(f"Fetching web context for: \"{clean_query[:80]}...\"")
        context = search_and_format(clean_query, api_key, count=5)
        if context:
            logger.info(f"Web search returned results for: \"{clean_query[:60]}...\"")
        else:
            logger.info(f"Web search returned no results for: \"{clean_query[:60]}...\"")
        return context
    except Exception as e:
        logger.warning(f"Web search failed (non-fatal): {type(e).__name__}: {e}")
        return ""


def _get_web_context_for_topic(topic_context: str, stage: str = "general") -> str:
    """Combined search-query-generation + web search, only calling LLM when needed.

    Checks if web search is enabled first, then generates a precise search query
    via LLM (if configured), performs the search, and returns formatted context.
    Returns empty string if web search is disabled or any step fails.
    """
    from backend.database.db import get_setting as _gs

    enabled = _gs("web_search_enabled")
    if not enabled or enabled in (False, "False"):
        return ""

    api_key = _gs("web_search_api_key")
    if not api_key:
        logger.info("Web search is enabled but no API key is configured — skipping.")
        return ""

    # Generate an optimized search query using the LLM (non-blocking on failure)
    search_query = _generate_search_query(topic_context, stage)
    if not search_query:
        return ""

    return _get_web_context(search_query)


def _generate_search_query(context_description: str, stage: str = "general") -> str:
    """Let the AI decide what to search for rather than using the raw topic.

    The AI knows what information it's missing — this formulates a precise
    English search query tailored to the stage (outline / intro / scene).

    Falls back to the original context_description on any failure —
    script generation should never block on this.
    """
    from backend.database.db import get_setting as _gs
    from backend.pipeline.web_search import clean_search_query

    api_key = _gs("openai_api_key")
    if not api_key:
        return clean_search_query(context_description)

    base_url = _gs("openai_base_url") or "https://api.openai.com/v1"
    model = _gs("openai_model") or "gpt-4o"

    try:
        from openai import OpenAI
        from backend.agent.skill_loader import skill_loader
        client = OpenAI(api_key=api_key, base_url=base_url.rstrip('/') if base_url else None)

        system_prompt = skill_loader.render_skill("search-query-optimizer")
        if not system_prompt:
            system_prompt = (
                "You generate precise English search queries for video research. "
                "Given a video topic and section, output ONE specific search query "
                "(max 12 words) that would find the most current, relevant information. "
                "CRITICAL: You MUST think step-by-step and wrap your reasoning inside <think>...</think> tags. "
                "After the closing </think> tag, output ONLY the raw query text — no explanation, no quotes, no punctuation."
            )
        user_prompt = f"Section: {stage}\nTopic: {context_description}\nSearch query:"

        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            max_tokens=2048,
            temperature=0.3,
            stream=False,
        )

        query = resp.choices[0].message.content or ""
        # Strip <think>...</think> blocks from reasoning models (handling unclosed blocks)
        query = re.sub(r'<think>.*?(?:</think>|$)', '', query, flags=re.DOTALL | re.IGNORECASE)
        query = query.strip().strip('"').strip("'")
        
        # Extract the concise search query from multi-line reasoning output
        lines = [line.strip() for line in query.split('\n') if line.strip()]
        if lines:
            disallowed_starters = ("let's", "we must", "i need", "i will", "the user", "thinking", "note:", "so we need", "first,", "here is", "we should", "this is", "count words", "we have to")
            valid_candidates = [
                l.strip('*').strip('"').strip("'")
                for l in lines
                if not any(l.strip().lower().startswith(s) for s in disallowed_starters)
            ]
            candidate = valid_candidates[-1] if valid_candidates else lines[-1].strip('*').strip('"').strip("'")
            for prefix in ["Search query:", "Search Query:", "Query:", "Search:", "Here is the query:", "Result:"]:
                if candidate.lower().startswith(prefix.lower()):
                    candidate = candidate[len(prefix):].strip().strip('"').strip("'")
            if candidate and len(candidate.split()) <= 15:
                query = candidate
            elif candidate:
                query = " ".join(candidate.split()[:12])

        if query and len(query) > 3:
            logger.info(f"AI generated search query: \"{query}\" for stage '{stage}'")
            return query
    except Exception as e:
        logger.warning(f"Search query generation failed (non-fatal): {type(e).__name__}: {e}")

    # Fallback: just clean the original context description
    return clean_search_query(context_description)

# Pydantic model schemas
from backend.agent.schemas import (
    ScriptIntroResponse, ScriptConclusionResponse, ScriptSceneResponse,
    BaseScriptResponse, OutlineResponse, StoryboardPlanResponse,
    DesignSystemResponse, SubVisualAST, VisualsArrayResponse,
    AnimationNode, ASTLayerNode, LayerContent, SequenceComposition,
    get_model_json_schema, parse_and_validate_model
)

# Schema definitions for declarative AST Nodes & Script generation
ANIMATION_SCHEMA = AnimationNode.model_json_schema()
LAYER_CONTENT_SCHEMA = LayerContent.model_json_schema()
AST_LAYER_SCHEMA = ASTLayerNode.model_json_schema()
SUB_VISUAL_SCHEMA = SubVisualAST.model_json_schema()
SCRIPT_INTRO_JSON_SCHEMA = ScriptIntroResponse.model_json_schema()
SCRIPT_SCENE_JSON_SCHEMA = ScriptSceneResponse.model_json_schema()
SCRIPT_CONCLUSION_JSON_SCHEMA = ScriptConclusionResponse.model_json_schema()
VISUALS_ARRAY_SCHEMA = VisualsArrayResponse.model_json_schema()
DESIGN_SYSTEM_SCHEMA = DesignSystemResponse.model_json_schema()

# Sane fallbacks used to repair partial AI design-system responses.
# When OpenAI-compatible endpoints omit optional-looking keys, we repair them with defaults.
# Language-to-Noto-font mapping used across the pipeline whenever a complex script
# is detected. Add new script-language pairs here as they are supported.
_NOTO_FONT_MAP = {
    "hi": "Noto Sans Devanagari",
    "mr": "Noto Sans Devanagari",
    "bn": "Noto Sans Bengali",
    "ta": "Noto Sans Tamil",
    "te": "Noto Sans Telugu",
    "ar": "Noto Sans Arabic",
    "th": "Noto Sans Thai",
    "gu": "Noto Sans Gujarati",
    "pa": "Noto Sans Gurmukhi",
    "ml": "Noto Sans Malayalam",
    "kn": "Noto Sans Kannada",
}

# Latin-only fonts that must NEVER be used as the heading/body font when the
# project language is a complex script — they will render Devanagari/Arabic/etc.
# glyphs as empty boxes or tofu.
_LATIN_ONLY_FONTS = frozenset({
    "Oswald", "Outfit", "Montserrat", "Raleway", "Anton", "Bebas Neue",
    "Lobster", "Pacifico", "Abril Fatface",
})

DESIGN_DEFAULTS = {
    "theme_name": "Custom",
    "color_palette": {
        "background": "#0b0b1a",
        "primary": "#facc15",
        "secondary": "#38bdf8",
        "accent": "#f472b6",
        "text": "#f8fafc",
    },
    # Use Inter as the neutral default — it has good Latin coverage and is
    # clearly named so it won't be mistaken for a complex-script font.
    # _repair_design_data() will override this for complex-script languages.
    "typography": {"heading_font": "Inter", "body_font": "Inter"},
    "css_guidelines": "Use bold gradients, cohesive color accents, and high contrast. Apply styling via layer style and filter properties.",
}

_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def _repair_design_data(design_data, language: str = "en"):
    """Fill missing/empty/Non-hex fields of a partial design system with defaults.

    Mutates and returns the dict. Values the model DID provide are kept.
    Language-aware: for complex scripts (Hindi, Tamil, etc.) the typography
    defaults are overridden with the appropriate Noto font so subtitles and
    AST text layers never fall back to a Latin-only font.
    """
    for key, default in DESIGN_DEFAULTS.items():
        if design_data.get(key) in (None, ""):
            design_data[key] = default
    palette = design_data.get("color_palette")
    if isinstance(palette, dict):
        for key, default in DESIGN_DEFAULTS["color_palette"].items():
            val = palette.get(key)
            if val in (None, "") or not _HEX_COLOR_RE.match(str(val)):
                palette[key] = default
    fonts = design_data.get("typography")
    if isinstance(fonts, dict):
        for key, default in DESIGN_DEFAULTS["typography"].items():
            if fonts.get(key) in (None, ""):
                fonts[key] = default
        # For complex-script languages, reject Latin-only fonts that the model
        # may have chosen and substitute the correct Noto font instead.
        noto_font = _NOTO_FONT_MAP.get(language)
        if noto_font:
            if fonts.get("heading_font") in _LATIN_ONLY_FONTS:
                logger.info(
                    f"Replacing Latin-only heading_font '{fonts['heading_font']}' "
                    f"with '{noto_font}' for language '{language}'."
                )
                fonts["heading_font"] = noto_font
            if fonts.get("body_font") in _LATIN_ONLY_FONTS:
                logger.info(
                    f"Replacing Latin-only body_font '{fonts['body_font']}' "
                    f"with '{noto_font}' for language '{language}'."
                )
                fonts["body_font"] = noto_font
    if not isinstance(design_data.get("css_guidelines"), str) or not design_data["css_guidelines"].strip():
        design_data["css_guidelines"] = DESIGN_DEFAULTS["css_guidelines"]
    return design_data


def format_design_system_prompt(design_data: dict) -> str:
    if not design_data:
        return ""
    # Strip internal metadata fields (e.g. _language, _video_format, _failed) from prompt
    clean = {k: v for k, v in design_data.items() if not k.startswith('_')}
    if not clean.get('theme_name'):
        return ""
    return (
        f"\n=== GLOBAL DESIGN SYSTEM ===\n"
        f"Strictly adhere to these design rules when styling AST Text and Layer elements:\n"
        f"{json.dumps(clean, indent=2)}\n"
    )

def generate_project_design_system(project_dict, script_data, project_dir, progress_cb, cancel_event):
    design_path = project_dir / "design.json"
    is_new = False
    
    topic = project_dict.get('name', 'Unknown')
    language = project_dict.get('language', 'hi')
    video_format = project_dict.get('video_format', 'landscape')
    video_type = project_dict.get('prompt') or 'documentary'

    from backend.pipeline.genres import normalize_genre_key
    norm_genre = normalize_genre_key(video_type)

    if design_path.exists():
        try:
            with open(design_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if not isinstance(data, dict) or not data.get('theme_name'):
                raise ValueError("Invalid design.json shape")
            if data.get('_failed'):
                raise ValueError("Previous design generation failed, regenerating")
            if data.get('_language') != language or data.get('_video_format') != video_format:
                raise ValueError("Language or format changed, invalidating design")
            
            # Check genre only if previously set in design.json
            saved_genre = data.get('_genre')
            if saved_genre and normalize_genre_key(saved_genre) != norm_genre:
                raise ValueError(f"Genre changed from {saved_genre} to {video_type}, invalidating design")
            
            # If _genre was not previously persisted, backfill it in memory and file
            if not saved_genre:
                data['_genre'] = norm_genre
                try:
                    with open(design_path, "w", encoding="utf-8") as f:
                        json.dump(data, f, indent=2)
                except Exception:
                    pass

            return data, is_new
        except Exception as e:
            from backend.core.logger import logger
            logger.warning(f"Invalidating existing design.json: {e}")
            
    is_new = True
    from backend.agent.skill_loader import skill_loader
    from backend.pipeline.genres import format_genre_design_prompt
    genre_guidance = format_genre_design_prompt(video_type)

    system_prompt = skill_loader.render_skill(
        "art-director-design-system",
        video_format=video_format,
        language=language,
        genre_guidance=genre_guidance,
    )
    if not system_prompt:
        system_prompt = f"""You are an expert Art Director. Create a cohesive Design System for a YouTube video.
The format is {video_format} (e.g. landscape means 16:9, portrait means 9:16) and the language is {language}.
Return ONLY valid JSON matching the schema. No markdown backticks.

{genre_guidance}

DESIGN GUIDELINES:
- color_palette: Must use modern, vibrant, or highly readable hex codes aligned with the genre.
- css_guidelines: Provide brief layout and aesthetic styling rules (e.g. contrast, accents, card borders, typography scales).
- fonts: CRITICAL - If Language is a complex script (like Hindi/hi, Tamil/ta, Bengali/bn, Arabic), you MUST specify Noto fonts (e.g. `Noto Sans Devanagari`) to prevent broken rendering. For English, use modern fonts (e.g. Inter, Outfit, Oswald).
"""
    import uuid
    user_prompt = f"Topic: {topic}\nGenre: {video_type.upper()}\nLanguage: {language}\nVideo Title: {script_data.get('title', 'Untitled')}\nRequest ID: {uuid.uuid4().hex}\n"
    
    from backend.core.logger import logger
    logger.info("Generating global Design System...")
    progress_cb(12.0, "Generating global Design System...")
    
    try:
        design_data = _call_llm_json(system_prompt, user_prompt, DESIGN_SYSTEM_SCHEMA, cancel_event, activity_label="Design System")
    except Exception as e:
        if isinstance(e, InterruptedError):
            raise e
        logger.warning(f"Design generation failed, falling back to default: {e}")
        return {"theme_name": "default", "_failed": True, "_language": language, "_video_format": video_format, "_genre": norm_genre}, True
    
    if isinstance(design_data, dict) and design_data.get('theme_name'):
        design_data = _repair_design_data(design_data, language)
        # Validate that all required schema fields are present
        required_keys = {'color_palette', 'typography', 'css_guidelines'}
        if not required_keys.issubset(design_data.keys()):
            logger.warning(f"Design system response missing required keys: {required_keys - design_data.keys()}")
            return {"theme_name": "default", "_failed": True, "_language": language, "_video_format": video_format, "_genre": norm_genre}, True
        design_data['_language'] = language
        design_data['_video_format'] = video_format
        design_data['_genre'] = norm_genre
        return design_data, True

    if isinstance(design_data, dict):
        # Model returned JSON but skipped top-level keys (common on OpenAI-
        # compatible endpoints that don't enforce the schema). Repair it
        # instead of discarding the AI's palette/typography work.
        design_data = _repair_design_data(design_data, language)
        if design_data.get('theme_name'):
            logger.warning("Design system was missing top-level keys — repaired from defaults.")
            design_data['_language'] = language
            design_data['_video_format'] = video_format
            design_data['_genre'] = norm_genre
            return design_data, True

    logger.warning("Failed to generate design system, returning default.")
    return {"theme_name": "default", "_failed": True, "_language": language, "_video_format": video_format, "_genre": norm_genre}, True

OUTLINE_JSON_SCHEMA = OutlineResponse.model_json_schema()
BASE_SCRIPT_JSON_SCHEMA = BaseScriptResponse.model_json_schema()
SINGLE_SCENE_JSON_SCHEMA = SCRIPT_SCENE_JSON_SCHEMA
STORYBOARD_PLAN_SCHEMA = StoryboardPlanResponse.model_json_schema()

def _safe_str(val):
    """Convert a value to string if it isn't one already, handling nested dicts and lists."""
    if isinstance(val, str):
        return val
    if isinstance(val, dict):
        # LLM sometimes returns {"text": "..."} or similar nested structure
        for key in ("text", "content", "value", "hook", "summary", "cta", "narration", "narr"):
            if key in val:
                inner = _safe_str(val[key])
                if inner:
                    return inner
        # Fallback: join all string values
        parts = [str(v) for v in val.values() if isinstance(v, (str, int, float))]
        return " ".join(parts) if parts else ""
    if isinstance(val, list):
        return " ".join(str(v) for v in val)
    return str(val) if val is not None else ""


def _extract_chapters_from_outline(outline_data, min_scenes: int = 4, max_scenes: int = 8, topic: str = ""):
    """Robustly extracts and normalizes chapter objects from diverse LLM outline structures."""
    raw_chapters = None
    if isinstance(outline_data, list):
        raw_chapters = outline_data
    elif isinstance(outline_data, dict):
        # 1. Direct keys
        for key in ("chapters", "outline", "scenes", "sections", "items", "chapter_list", "scene_list", "sub_topics"):
            val = outline_data.get(key)
            if isinstance(val, list) and len(val) > 0:
                raw_chapters = val
                break
        # 2. Check nested dicts/lists if not found
        if raw_chapters is None:
            for val in outline_data.values():
                if isinstance(val, list) and len(val) > 0 and isinstance(val[0], dict):
                    raw_chapters = val
                    break
                if isinstance(val, dict):
                    for nested_key in ("chapters", "outline", "scenes", "sections", "items"):
                        nested_val = val.get(nested_key)
                        if isinstance(nested_val, list) and len(nested_val) > 0:
                            raw_chapters = nested_val
                            break
                    if raw_chapters is not None:
                        break

    if not isinstance(raw_chapters, list):
        raw_chapters = []

    normalized = []
    for idx, chap in enumerate(raw_chapters):
        if not isinstance(chap, dict):
            if isinstance(chap, str) and chap.strip():
                normalized.append({
                    "scene_number": idx + 1,
                    "chapter_title": f"Chapter {idx + 1}",
                    "scene_context": chap.strip()
                })
            continue
        scene_num = chap.get("scene_number") or chap.get("scene_num") or chap.get("number") or chap.get("id") or (idx + 1)
        try:
            scene_num = int(scene_num)
        except (ValueError, TypeError):
            scene_num = idx + 1

        chapter_title = (
            chap.get("chapter_title")
            or chap.get("title")
            or chap.get("name")
            or chap.get("scene_title")
            or chap.get("heading")
            or f"Scene {scene_num}"
        )
        scene_context = (
            chap.get("scene_context")
            or chap.get("context")
            or chap.get("description")
            or chap.get("summary")
            or chap.get("narration")
            or chap.get("details")
            or chap.get("text")
            or ""
        )
        normalized.append({
            "scene_number": scene_num,
            "chapter_title": _safe_str(chapter_title).strip() or f"Scene {scene_num}",
            "scene_context": _safe_str(scene_context).strip()
        })

    # If still 0 chapters, generate fallback chapters based on topic to guarantee progress
    if not normalized:
        num_fallback = max(min_scenes, 4)
        for i in range(num_fallback):
            normalized.append({
                "scene_number": i + 1,
                "chapter_title": f"{topic} - Part {i + 1}" if topic else f"Part {i + 1}",
                "scene_context": f"Detailed exploration and analysis of {topic} part {i + 1}." if topic else f"Analysis of scene {i + 1}."
            })

    return normalized


def _extract_base_script(base_data, topic: str = ""):
    """Robustly extracts introduction (hook) and conclusion (summary, cta) from LLM output."""
    hook = ""
    summary = ""
    cta = ""

    if isinstance(base_data, dict):
        # 1. Intro extraction
        raw_intro = base_data.get("introduction") or base_data.get("intro") or base_data.get("opening")
        if isinstance(raw_intro, dict):
            hook = raw_intro.get("hook") or raw_intro.get("narration") or raw_intro.get("text") or raw_intro.get("content") or ""
        elif isinstance(raw_intro, str):
            hook = raw_intro
        elif "hook" in base_data:
            hook = base_data["hook"]

        # 2. Conclusion extraction
        raw_conc = base_data.get("conclusion") or base_data.get("outro") or base_data.get("ending")
        if isinstance(raw_conc, dict):
            summary = raw_conc.get("summary") or raw_conc.get("narration") or raw_conc.get("text") or raw_conc.get("conclusion") or raw_conc.get("content") or ""
            cta = raw_conc.get("cta") or raw_conc.get("call_to_action") or raw_conc.get("action") or ""
        elif isinstance(raw_conc, str):
            summary = raw_conc
            cta = base_data.get("cta") or base_data.get("call_to_action") or ""
        else:
            summary = base_data.get("summary") or base_data.get("conclusion") or ""
            cta = base_data.get("cta") or base_data.get("call_to_action") or ""

    hook = _safe_str(hook).strip()
    summary = _safe_str(summary).strip()
    cta = _safe_str(cta).strip()

    if not hook:
        hook = f"Discover the fascinating reality of {topic}." if topic else "Welcome to this breakdown."
    if not summary:
        summary = f"In conclusion, {topic} represents a remarkable technological and historical achievement." if topic else "That concludes our deep dive."
    if not cta:
        cta = "Subscribe for more in-depth explainers and share your thoughts in the comments."

    return {"hook": hook}, {"summary": summary, "cta": cta}


def fix_unescaped_quotes(s):
    """Escapes raw double quotes inside string values to avoid JSON parse errors.

    Uses a character-by-character state machine with look-ahead: when a quote
    is encountered inside a string, we peek at the next non-whitespace character.
    If it's a JSON structural delimiter ( , : } ] ), the quote is a legitimate
    string closer. Otherwise it's an unescaped quote that needs to be escaped.
    This avoids both the regex-boundary bug (key names truncating values) and
    the over-escaping bug (converting every inner quote to \\\").
    """
    in_string = False
    escape = False
    result = []
    n = len(s)
    i = 0

    while i < n:
        char = s[i]

        if in_string:
            if escape:
                result.append(char)
                escape = False
                i += 1
                continue
            elif char == '\\':
                escape = True
                result.append(char)
                i += 1
                continue
            elif char == '"':
                # Peek ahead: if next non-whitespace is a JSON delimiter,
                # this is a legitimate string closer, not an embedded quote.
                j = i + 1
                while j < n and s[j].isspace():
                    j += 1
                if j >= n or s[j] in ',:;{}[]':
                    # Legitimate end-of-string
                    in_string = False
                    result.append(char)
                else:
                    # Unescaped quote inside a string value
                    result.append('\\"')
                i += 1
                continue
            elif char == '\n':
                result.append('\\n')
            elif char == '\t':
                result.append('\\t')
            else:
                result.append(char)
        else:
            if char == '"':
                in_string = True
                result.append(char)
            elif char == '\n':
                result.append(' ')
            else:
                result.append(char)
        i += 1

    if in_string:
        result.append('"')

    return "".join(result)


def repair_json_string(s):
    """Repairs truncated JSON, trailing commas, and unescaped control chars."""
    try:
        s = fix_unescaped_quotes(s)
    except Exception as e:
        logger.warning(f"Failed to fix unescaped quotes during repair: {e}")

    s = s.replace('\r\n', '\n').replace('\r', '\n')

    in_string = False
    escape = False
    result = []
    stack = []

    i = 0
    n = len(s)
    while i < n:
        char = s[i]

        if in_string:
            if escape:
                result.append(char)
                escape = False
            elif char == '\\':
                escape = True
                result.append(char)
            elif char == '"':
                in_string = False
                result.append(char)
            elif char == '\n':
                result.append('\\n')
            elif char == '\t':
                result.append('\\t')
            else:
                result.append(char)
        else:
            if char == '"':
                in_string = True
                result.append(char)
            elif char == '{':
                stack.append('}')
                result.append(char)
            elif char == '[':
                stack.append(']')
                result.append(char)
            elif char == '}':
                idx = len(result) - 1
                while idx >= 0 and (result[idx].isspace() or result[idx] == '\n'):
                    idx -= 1
                if idx >= 0 and result[idx] == ',':
                    while len(result) > idx:
                        result.pop()
                if stack and stack[-1] == '}':
                    stack.pop()
                result.append(char)
            elif char == ']':
                idx = len(result) - 1
                while idx >= 0 and (result[idx].isspace() or result[idx] == '\n'):
                    idx -= 1
                if idx >= 0 and result[idx] == ',':
                    while len(result) > idx:
                        result.pop()
                if stack and stack[-1] == ']':
                    stack.pop()
                result.append(char)
            else:
                result.append(char)
        i += 1

    if in_string:
        result.append('"')

    while stack:
        close_char = stack.pop()
        result.append(close_char)

    repaired = "".join(result)
    repaired = re.sub(r',\s*\}', '}', repaired)
    repaired = re.sub(r',\s*\]', ']', repaired)

    return repaired

def extract_outer_json_candidates(text: str):
    """Extracts top-level (outermost) balanced {...} and [...] blocks in text."""
    candidates = []
    i, n = 0, len(text)
    while i < n:
        char = text[i]
        if char in ('{', '['):
            closing = '}' if char == '{' else ']'
            depth = 0
            start = i
            in_str = False
            escape = False
            j = i
            matched = False
            while j < n:
                ch = text[j]
                if in_str:
                    if escape:
                        escape = False
                    elif ch == '\\':
                        escape = True
                    elif ch == '"':
                        in_str = False
                else:
                    if ch == '"':
                        in_str = True
                    elif ch == char:
                        depth += 1
                    elif ch == closing:
                        depth -= 1
                        if depth == 0:
                            candidates.append(text[start:j + 1])
                            matched = True
                            i = j + 1
                            break
                j += 1
            if not matched:
                i += 1
        else:
            i += 1
    return candidates

def clean_json_response(raw_response):
    """Strips markdown backticks, reasoning text, and attempts parsing or repairing JSON."""
    if not isinstance(raw_response, str):
        return raw_response

    clean_text = raw_response.strip()
    # 1. Strip <think>...</think> blocks from reasoning models before parsing
    clean_text = re.sub(r'<think>.*?(?:</think>|$)', '', clean_text, flags=re.DOTALL | re.IGNORECASE).strip()

    # 2. Direct JSON parse if the whole text is valid JSON
    try:
        return json.loads(clean_text)
    except Exception:
        pass

    # 3. Check markdown code blocks: ```json ... ``` or ``` ... ```
    code_blocks = re.findall(r"```(?:json)?\s*([\[\{].*?[\]\}])\s*```", clean_text, re.DOTALL | re.IGNORECASE)
    for block in reversed(code_blocks):
        block = block.strip()
        try:
            return json.loads(block)
        except Exception:
            try:
                repaired = repair_json_string(block)
                return json.loads(repaired)
            except Exception:
                pass

    # 4. Outer balanced {...} and [...] structures
    candidates = extract_outer_json_candidates(clean_text)
    for cand in reversed(candidates):
        try:
            return json.loads(cand)
        except Exception:
            pass

    # 5. Try repair_json_string on candidates
    for cand in reversed(candidates):
        try:
            repaired = repair_json_string(cand)
            return json.loads(repaired)
        except Exception:
            pass

    # 6. Try ast.literal_eval on candidates
    def _sanitize_sets(obj):
        if isinstance(obj, set):
            return list(obj)
        elif isinstance(obj, dict):
            return {k: _sanitize_sets(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [_sanitize_sets(v) for v in obj]
        return obj

    for cand in reversed(candidates):
        try:
            repaired_val = repair_json_string(cand)
            evaluated = ast.literal_eval(repaired_val)
            return _sanitize_sets(evaluated)
        except Exception:
            pass

    # 7. Truncated tail recovery: scan from each '{' and '[' position
    start_indices = [m.start() for m in re.finditer(r'[\{\[]', clean_text)]
    for idx in start_indices:
        tail_text = clean_text[idx:]
        try:
            repaired = repair_json_string(tail_text)
            parsed = json.loads(repaired)
            if isinstance(parsed, (dict, list)) and parsed:
                return parsed
        except Exception:
            try:
                evaluated = ast.literal_eval(repair_json_string(tail_text))
                parsed = _sanitize_sets(evaluated)
                if isinstance(parsed, (dict, list)) and parsed:
                    return parsed
            except Exception:
                pass

    logger.error(f"Failed all JSON parsing attempts. Raw response length: {len(raw_response)}")
    logger.error(f"Raw response preview (first 500 chars):\n{raw_response[:500]}")
    logger.error(f"Raw response preview (last 500 chars):\n{raw_response[-500:]}")
    raise ValueError("LLM response could not be parsed into valid JSON.")



from backend.agent.cache import build_cache_key, get_cached_response, set_cached_response

def _cache_key(system_prompt, user_prompt, cfg, schema_flag="S"):
    """Build a deterministic cache key from prompt + full config.

    schema_flag keeps strict-JSON calls ("S") and loose tool-loop calls ("L")
    in separate cache namespaces so a raw text response can never be served
    where a parsed dict is expected (and vice versa).

    The API key hash pins responses to the provider key that produced them —
    switching keys must not serve stale responses from another account.
    """
    sys_h = hashlib.sha256(system_prompt.encode("utf-8")).hexdigest()[:16]
    user_h = hashlib.sha256(user_prompt.encode("utf-8")).hexdigest()[:16]
    api_h = hashlib.sha256(str(cfg.get("api_key", "")).encode("utf-8")).hexdigest()[:8]
    return build_cache_key(
        cfg["provider"], cfg["model"], cfg["temperature"], 
        cfg["max_tokens"], cfg["top_p"], sys_h, user_h,
        schema_flag=schema_flag,
    ) + f":k{api_h}"


def _resolve_llm_config(provider_override=None):
    """Resolve LLM provider config from DB settings.

    Returns a dict with: provider, api_key, base_url, model, temperature, max_tokens, top_p
    Raises ValueError if no API key is configured.
    """
    from backend.database.db import get_setting

    api_key = get_setting("openai_api_key")
    base_url = get_setting("openai_base_url") or "https://api.openai.com/v1"
    model = get_setting("openai_model") or "gpt-4o"
    temperature = float(get_setting("openai_temperature") or 0.7)
    max_tokens = int(get_setting("openai_max_tokens") or 4096)
    top_p = float(get_setting("openai_top_p") or 1.0)

    if not api_key:
        raise ValueError("OpenAI-compatible API key is missing. Please configure it in the settings panel.")

    return {
        "provider": "openai",
        "api_key": api_key,
        "base_url": base_url,
        "model": model,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "top_p": top_p,
    }


# --- Token usage telemetry -------------------------------------------------
# The queue manager processes one task at a time, so a single global slot is
# safe. `_call_llm_json` may run from worker threads (parallel visuals), so all
# access is guarded by a lock.
_usage_lock = threading.Lock()
_active_usage = {"task_id": None, "prompt_tokens": 0, "completion_tokens": 0}


def _record_usage(prompt_tokens, completion_tokens):
    """Accumulate token usage against the active pipeline task, if any."""
    if not prompt_tokens and not completion_tokens:
        return
    with _usage_lock:
        if _active_usage["task_id"]:
            _active_usage["prompt_tokens"] += prompt_tokens or 0
            _active_usage["completion_tokens"] += completion_tokens or 0


def usage_tracking_context(task_id):
    """Context manager: attribute LLM token usage during a pipeline step to a task.

    The totals are flushed to the tasks table on exit (even on failure).
    """
    import contextlib

    @contextlib.contextmanager
    def _ctx():
        with _usage_lock:
            _active_usage["task_id"] = task_id
            _active_usage["prompt_tokens"] = 0
            _active_usage["completion_tokens"] = 0
        try:
            yield
        finally:
            with _usage_lock:
                tid = _active_usage["task_id"]
                p = _active_usage["prompt_tokens"]
                c = _active_usage["completion_tokens"]
                _active_usage["task_id"] = None
            if tid:
                try:
                    from backend.database.db import update_task
                    update_task(tid, prompt_tokens=p, completion_tokens=c)
                except Exception as e:
                    logger.error(f"Failed to record token usage for task {tid}: {e}")

    return _ctx()


def _call_llm_json(system_prompt, user_prompt, schema, cancel_event, provider_override=None, is_fallback=False, return_raw=False, activity_label=None):
    from backend.database.db import get_setting
    from openai import OpenAI
    import openai

    if cancel_event is None:
        # Callers that opt out of cancellation get a never-set event so the
        # unguarded is_set() checks below never crash on None.
        cancel_event = threading.Event()

    cfg = _resolve_llm_config(provider_override)
    llm_provider = cfg["provider"]
    api_key = cfg["api_key"]
    base_url = cfg["base_url"]
    model = cfg["model"]
    temperature = cfg["temperature"]
    max_tokens = cfg["max_tokens"]
    top_p = cfg["top_p"]

    from backend.agent.telemetry import emit_activity, update_activity
    act_label = activity_label or f"LLM ({model})"
    llm_entry_id = emit_activity("llm", act_label, f"{llm_provider} / {model}", "running")

    def _emit_llm(status, detail=""):
        update_activity(llm_entry_id, status, detail or f"{llm_provider} / {model}")

    logger.info(f"LLM Call: Provider={llm_provider}, Model={model}, BaseURL={base_url}")

    # Force CoT thinking blocks globally for all JSON tasks
    forced_think = False
    if schema is not None and "<think>" not in system_prompt:
        system_prompt = system_prompt.rstrip() + (
            "\n\nCRITICAL INSTRUCTION: Before outputting the final JSON, you must think step-by-step "
            "and write out your reasoning. You MUST wrap your entire reasoning process inside <think>...</think> tags. "
            "Immediately after the closing </think> tag, output ONLY the valid JSON matching the requested schema. "
            "Do not write any text after the JSON."
        )
        forced_think = True

    # Reasoning models (and models we forced to reason) consume max_tokens on internal "thinking"
    # before producing visible content. If max_tokens is too small, ALL tokens go
    # to reasoning and content_len=0. Boost to 16384 so there's headroom for both
    # reasoning AND the actual JSON output.
    model_lower = model.lower()
    is_reasoning_model = forced_think or "<think>" in system_prompt or any(tag in model_lower for tag in ("deepseek", "r1", "qwq", "reasoning", "think", "auto", "nemotron", "llama"))
    if (is_reasoning_model or max_tokens <= 4096) and max_tokens < 16384:
        logger.info(f"Reasoning model/CoT or low token budget detected. Boosting max_tokens {max_tokens} -> 16384 to allow room for reasoning + content.")
        max_tokens = 16384

    # Check response cache for deterministic prompts (same params + same prompt).
    # Loose tool-loop calls are cached under schema_flag="L" so a raw text
    # response can never be served to schema-expecting callers. Their prompts
    # only differ across turns (tool results are appended), which changes the
    # cache key — so caching the first-turn raw text is safe and makes
    # re-runs of identical pipeline prompts skip the API entirely.
    cache_k = _cache_key(system_prompt, user_prompt, cfg, schema_flag="S" if schema is not None else "L")
    cached_val = get_cached_response(cache_k)
    if cached_val is not None:
        if cancel_event.is_set():
            _emit_llm("error", "cancelled")
            raise InterruptedError("Cancelled")
        logger.info("LLM Cache hit (Disk cache)")
        _emit_llm("ok", "cache hit")
        return cached_val

    client = OpenAI(
        api_key=api_key,
        base_url=base_url.rstrip('/') if base_url else None,
        timeout=300.0  # 5 min — large models (e.g. Nemotron-550B) can take minutes per call
    )

    kwargs = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
        "top_p": top_p,
        "stream": True
    }

    json_schema_dict = get_model_json_schema(schema)
    if json_schema_dict is not None:
        kwargs["response_format"] = {"type": "json_object"}

    if cancel_event.is_set():
        _emit_llm("error", "cancelled")
        raise InterruptedError("Cancelled")


    max_retries = 5
    for attempt in range(max_retries):
        if cancel_event.is_set():
            raise InterruptedError("Cancelled")
        try:
            logger.info(f"Sending LLM request via OpenAI SDK (Attempt {attempt+1}/{max_retries})...")

            def _run_completion(req_kwargs):
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                    future = executor.submit(client.chat.completions.create, **req_kwargs)
                    while not future.done():
                        if cancel_event.is_set() or cancel_event.wait(0.5):
                            client.close()
                            raise InterruptedError("Cancelled")
                    return future.result()

            response_stream = _run_completion(kwargs)

            raw_content = ""
            usage = None
            for chunk in response_stream:
                if cancel_event.is_set():
                    response_stream.close()
                    raise InterruptedError("Cancelled")
                if chunk.choices and len(chunk.choices) > 0:
                    delta = chunk.choices[0].delta
                    delta_content = getattr(delta, "content", "") or ""
                    reasoning_content = getattr(delta, "reasoning_content", "") or ""
                    text_to_add = reasoning_content + delta_content
                    if text_to_add:
                        raw_content += text_to_add
                if getattr(chunk, "usage", None) is not None:
                    usage = chunk.usage

            # Fallback: if streaming yielded empty content, retry with non-streaming.
            # Some models (e.g. DeepSeek) consume all tokens on reasoning in
            # streaming mode but produce content in non-streaming mode.
            if not raw_content.strip():
                logger.warning("Streaming yielded empty content. Attempting non-streaming completion fallback...")
                if cancel_event.is_set():
                    raise InterruptedError("Cancelled")
                fallback_kwargs = {k: v for k, v in kwargs.items() if k != "stream"}
                fallback_kwargs["stream"] = False
                fallback_response = _run_completion(fallback_kwargs)
                if fallback_response.choices:
                    raw_content = fallback_response.choices[0].message.content or ""
                    finish_reason = fallback_response.choices[0].finish_reason
                    usage = fallback_response.usage
                    logger.info(f"Non-streaming fallback result: finish_reason={finish_reason}, "
                                f"content_len={len(raw_content)}, usage={usage}")

                    # Detect reasoning-token exhaustion: model used all tokens
                    # for internal thinking, leaving zero for content output.
                    # Retry with much higher max_tokens and no response_format.
                    if not raw_content.strip() and usage and hasattr(usage, 'completion_tokens_details'):
                        details = usage.completion_tokens_details
                        reasoning_used = getattr(details, 'reasoning_tokens', 0) if details else 0
                        if reasoning_used and reasoning_used >= usage.completion_tokens:
                            boosted = min(max_tokens * 4, 65536)
                            logger.warning(
                                f"Reasoning-token exhaustion detected: {reasoning_used} reasoning tokens "
                                f"consumed entire budget ({usage.completion_tokens}). "
                                f"Retrying with max_tokens={boosted} and no response_format..."
                            )
                            if cancel_event.is_set():
                                raise InterruptedError("Cancelled")
                            retry_kwargs = {k: v for k, v in fallback_kwargs.items() if k != "response_format"}
                            retry_kwargs["max_tokens"] = boosted
                            retry_response = _run_completion(retry_kwargs)
                            if retry_response.choices:
                                raw_content = retry_response.choices[0].message.content or ""
                                usage = retry_response.usage
                                logger.info(f"Reasoning-boost retry result: content_len={len(raw_content)}, "
                                            f"usage={retry_response.usage}")

            if not raw_content.strip():
                raise ValueError("API returned an empty response. It may have failed internally.")

            # Record token usage against the active pipeline task (if any)
            if usage is not None:
                _record_usage(
                    getattr(usage, "prompt_tokens", 0) or 0,
                    getattr(usage, "completion_tokens", 0) or 0,
                )

            if return_raw:
                # Loose mode for the agent tool loop: hand the model's raw text
                # back so ```tool {...}``` blocks can be extracted and executed.
                if cancel_event.is_set():
                    raise InterruptedError("Cancelled")
                if raw_content and len(raw_content.strip()) > 10:
                    set_cached_response(cache_k, raw_content)
                _emit_llm("ok", "tool-loop turn")
                return raw_content

            parsed_json = clean_json_response(raw_content)
            if schema is not None:
                parsed_json = parse_and_validate_model(schema, parsed_json)

            if cancel_event.is_set():
                raise InterruptedError("Cancelled")

            # Cache the response only if it is a meaningful non-empty structure
            if parsed_json and isinstance(parsed_json, dict) and any(v for v in parsed_json.values() if v is not None and v != "" and v != []):
                set_cached_response(cache_k, parsed_json)

            _emit_llm("ok")
            return parsed_json

        except openai.RateLimitError as e:
            if attempt < max_retries - 1:
                sleep_time = (2 ** attempt) + random.uniform(0, 1)
                logger.warning(f"Rate limited (429). Retrying in {sleep_time:.2f}s... (Attempt {attempt+1}/{max_retries})")
                if cancel_event.wait(sleep_time):
                    raise InterruptedError("Cancelled")
            else:
                _emit_llm("error", "rate limited (429)")
                raise e
        except openai.BadRequestError as e:
            if attempt < max_retries - 1 and "response_format" in kwargs:
                logger.warning(f"Provider rejected request (HTTP 400). It might not support response_format. Stripping it and retrying... (Attempt {attempt+1}/{max_retries})")
                del kwargs["response_format"]
                if cancel_event.wait(1.0):
                    raise InterruptedError("Cancelled")
            else:
                try:
                    logger.error(f"Bad Request Error: {e.response.text if hasattr(e, 'response') else e}")
                except Exception:
                    pass
                if attempt >= max_retries - 1:
                    _emit_llm("error", f"bad request: {e}")
                    raise e
                if cancel_event.wait(2.0):
                    raise InterruptedError("Cancelled")
        except InterruptedError:
            _emit_llm("error", "cancelled")
            raise
        except Exception as e:
            if attempt < max_retries - 1:
                logger.warning(f"LLM request or parsing failed ({type(e).__name__}: {e}). Retrying... (Attempt {attempt+1}/{max_retries})")
                if cancel_event.wait(2.0):
                    raise InterruptedError("Cancelled")
            else:
                if not is_fallback:
                    fallback_provider = get_setting("llm_fallback_provider")
                    if fallback_provider and fallback_provider.lower() != llm_provider.lower():
                        logger.error(f"Max retries exceeded on {llm_provider}. Attempting fallback to {fallback_provider}...")
                        try:
                            if cancel_event.is_set():
                                raise InterruptedError("Cancelled")
                            # Recursive call resolves the fallback provider's own
                            # config from DB settings. is_fallback=True prevents
                            # infinite recursion if the fallback also fails.
                            fallback_result = _call_llm_json(
                                system_prompt, user_prompt, schema, cancel_event,
                                provider_override=fallback_provider, is_fallback=True,
                                return_raw=return_raw,
                                activity_label=activity_label,
                            )
                            _emit_llm("ok", f"handled by fallback ({fallback_provider})")
                            return fallback_result
                        except InterruptedError:
                            raise
                        except Exception as fallback_e:
                            logger.error(f"Fallback to {fallback_provider} failed: {fallback_e}")

                _emit_llm("error", f"{type(e).__name__}: {e}")
                logger.error(f"Max retries exceeded. Last error: {type(e).__name__}: {e}")
                raise e


def generate_script_pipeline(project_dict, project_dir, progress_cb, cancel_event):
    from backend.database.db import get_setting, update_project
    from backend.core.logger import logger

    topic = project_dict['name']
    video_type = project_dict.get('prompt') or "DOCUMENTARY"
    language = project_dict.get('language', 'hi')
    duration_mode = project_dict.get('duration_mode', 'medium')
    video_format = project_dict.get('video_format', 'landscape')

    logger.info(f"Generating script for topic: '{topic}' (Lang: {language}, Dur: {duration_mode}, Format: {video_format})")
    progress_cb(5.0, "Preparing to generate script...")

    # Check API key before starting
    api_key = get_setting("openai_api_key")
    if not api_key:
        raise ValueError("OpenAI-compatible API key is missing. Please configure it in the settings panel.")

    if video_format == "portrait":
        if duration_mode == "short": # 60s
            min_scenes, max_scenes = 4, 6
            target_duration = 60
        elif duration_mode == "long": # 2 mins
            min_scenes, max_scenes = 8, 12
            target_duration = 120
        else: # medium (90s)
            min_scenes, max_scenes = 6, 8
            target_duration = 90
    else:
        if duration_mode == "extra_long": # ~15 min
            min_scenes, max_scenes = 60, 75
            target_duration = 900
        elif duration_mode == "long": # ~10 min
            min_scenes, max_scenes = 40, 55
            target_duration = 600
        else: # medium (~5 min)
            min_scenes, max_scenes = 20, 30
            target_duration = 300

    # Per-scene duration budget will be recalculated after outline generation
    # based on the actual number of chapters the AI produces.

    sentence_rule = f"LENGTH CONSTRAINT: The total target video duration is {target_duration} seconds. Every second of narration directly adds to video length. Write concisely — prefer shorter sentences, tighter prose, and only essential details."

    lang_instruction = f"""LANGUAGE RULES:
- The spoken text (hook, narration, summary, cta) MUST be written in the native script of the requested language (code: '{language}').
  For example, if the language is Hindi ('hi'), you MUST use the Devanagari script. Do NOT use English alphabet transliterations.
  CRITICAL: This strictly applies to the Introduction and Conclusion as well!
- The 'title' and 'chapter_title' fields can be in the requested language.
"""

    narration_emphasis = f"""
CRITICAL — NARRATION IS THE PRIMARY OUTPUT:
- The `narration` field is the spoken voiceover. It MUST be a non-empty string.
- Do NOT skip narration. Do NOT leave it blank or null.
- CRITICAL: Never repeat the video title/topic verbatim in spoken text (hook, narration, summary, cta). The title is an internal label — write original spoken content instead.
- {sentence_rule}
"""

    # 1. Generate Outline
    progress_cb(10.0, "Generating video outline...")
    logger.info("Stage 1: Generating Outline...")
    # Language-aware speaking rate: words per second for narration
    # English ~180 WPM (3 wps), Hindi ~270 syllables/min (~4.5 sps)
    LANGUAGE_WORD_RATE = {"hi": 4.5, "en": 3.0, "mr": 4.0, "bn": 4.0, "ta": 3.5, "te": 3.5}
    speaking_rate = LANGUAGE_WORD_RATE.get(language, 3.0)

    # Allocate scene time: ~15s reserved for intro + conclusion
    per_scene_time = max(5, (target_duration - 15) // max_scenes)
    per_scene_words = max(10, int(per_scene_time * speaking_rate))

    from backend.agent.skill_loader import skill_loader
    from backend.pipeline.genres import format_genre_script_prompt
    genre_script_guidance = format_genre_script_prompt(video_type)

    scriptwriter_rules = _skill_content("scriptwriter")
    script_rules_block = f"""=== WRITING RULES ===
{scriptwriter_rules}

""" if scriptwriter_rules else ""

    outline_system_prompt = skill_loader.render_skill(
        "script-outline-director",
        script_rules_block=script_rules_block,
        target_duration=target_duration,
        min_scenes=min_scenes,
        max_scenes=max_scenes,
        per_scene_time=per_scene_time,
        per_scene_words=per_scene_words,
        language=language,
        genre_script_guidance=genre_script_guidance,
    )
    if not outline_system_prompt:
        outline_system_prompt = f"""{script_rules_block}You are a master YouTube Video Director specializing in creating well-structured, engaging YouTube videos of exactly {target_duration} seconds.

{genre_script_guidance}

CRITICAL RULES:
- Return ONLY valid JSON matching the provided schema
- NO markdown backticks or explanatory text
- Content must be original and specific to the topic - no generic or copied material
- Every claim must be factual and verifiable
- Avoid speculation unless clearly marked as opinion or analysis
- Exclude clickbait, overly sensational language, or misleading statements

BREAKDOWN REQUIREMENTS:
- Generate exactly {min_scenes} to {max_scenes} chapters
- Balance story pacing so each gets roughly equal screen time
- Each chapter: ~{per_scene_time} seconds (~{per_scene_words} words of spoken narration)
- Ensure chapters flow chronologically with clear transitions
- Each chapter must have: scene_number, chapter_title, scene_context

{lang_instruction}
"""

    outline_user_prompt = f"""Topic: "{topic}"
Video Type / Genre: "{video_type.upper()}"

{genre_script_guidance}

Adapt the narrative style and tone specifically to fit the "{video_type.upper()}" genre.

VIDEO SPECIFICATIONS:
- Target Duration: {target_duration} seconds
- Target Frame Count: {target_duration * 30} frames
- Language: {language} ({'Hindi' if language == 'hi' else 'English'})

REQUIREMENTS:
- Create exactly {min_scenes} to {max_scenes} chapters for a {target_duration}-second video
- Each chapter: ~{per_scene_time} seconds of spoken content (~{per_scene_words} words)
- Focus on essential information only - cut unnecessary details
- Ensure each chapter has a clear, unique focus area
- Provide accurate, engaging information with relevant scene context

CHAPTER FORMAT NEEDED:
{{ "scene_number": number, "chapter_title": "Short descriptive title", "scene_context": "Detailed factual context for this chapter" }}

CRITICAL: Provide the outline as a raw JSON object matching the schema.
NO markdown blocks (` ```json `), NO conversational text. Just the JSON object.

NO generic phrases, no clickbait, no assumptions or unverified claims. Be precise and factual."""

    # Optionally augment with web search context
    _web_ctx = _get_web_context_for_topic(f"{topic} {video_type}", "outline generation")
    if _web_ctx:
        outline_user_prompt += f"\n\nRelevant web context to inform your outline:\n{_web_ctx}"

    outline_data = _call_llm_json(outline_system_prompt, outline_user_prompt, OUTLINE_JSON_SCHEMA, cancel_event, activity_label="Script Outline")

    if cancel_event.is_set():
        raise InterruptedError("Cancelled")

    # 2. Generate Base (Intro & Conclusion)
    progress_cb(20.0, "Writing introduction & conclusion...")
    logger.info("Stage 2: Generating Intro & Conclusion...")
    base_system_prompt = skill_loader.render_skill(
        "script-base-writer",
        script_rules_block=script_rules_block,
        target_duration=target_duration,
        language=language,
        sentence_rule=sentence_rule,
    )
    if not base_system_prompt:
        base_system_prompt = f"""{script_rules_block}You are a master YouTube Video Scriptwriter specializing in crafting compelling video intros and conclusions.

CRITICAL INTRO REQUIREMENTS:
- Hook MUST grab immediate attention within 5-8 seconds
- Must be original and specific to the content
- Should hint at the value/depth of information to come
- Should avoid vague statements and generalities

CRITICAL CONCLUSION REQUIREMENTS:
- Summary MUST condense key insights in 5-8 seconds
- CTA MUST drive specific action or reflection
- Must reinforce video value proposition
- Should not repeat information already covered

LENGTH CONSTRAINTS:
- Hook: 5-8 seconds (15-24 words at ~3 words/sec)
- Summary + CTA: Together 10-16 seconds (30-48 words)
- Total: 15-24 seconds of unique content

TTS-FRIENDLY WRITING (CRITICAL for voiceover synthesis):
- Write numbers as words: "forty-two" NOT "42", "million" NOT "1,000,000"
- Avoid abbreviations: "for example" NOT "e.g.", "that is" NOT "i.e."
- Use short, clear sentences — easy for TTS to pronounce naturally
- Avoid special characters (& @ © →) — TTS will misread them
- Write dates in full: "January first twenty twenty-four" NOT "Jan 1, 2024"
- Use commas and periods for natural pauses; avoid semicolons and long dashes
- Spell out initials with periods: "U.S.A." NOT "USA"
- Avoid parentheses — restructure instead

LANGUAGE RULES:
{lang_instruction}
{narration_emphasis}

LANGUAGE OUTPUT RULE:
You MUST write ALL spoken text (hook, summary, cta) in language code '{language}'.
If '{language}' is NOT 'en', that means do NOT write in English — write in the native script of that language instead.
The outline below is reference-only and may be in English. Your output MUST be in '{language}'.

LANGUAGE SPELLING/VOCABULARY RULES:
- Use only standard spelling and established terminology
- Avoid invented words or abbreviations without clear definitions
- Use context-appropriate vocabulary for the target language
- Ensure proper diacritics and character variations for non-English languages

CONTENT RULES:
- Content must be original, accurate, and specific to the topic
- Avoid generic filler phrases or unnecessary exposition
- Focus on high-value information that serves the video's purpose
- Ensure every word contributes to the video's core message

Return ONLY valid JSON matching the provided schema. No markdown backticks or explanations."""

    outline_json_str = json.dumps(outline_data, ensure_ascii=False)
    base_user_prompt = f"""TOPIC: {topic}
VIDEO STYLE GUIDE:
- Duration Target: {target_duration} seconds total
- Format: {video_format} orientation
- Language: {language} ({'Hindi' if language == 'hi' else 'English'})
- Voiceover Speed: {duration_mode} speed

OUTLINE (Pre-generated content): {outline_json_str}

REQUIRED OUTPUT:
Write TWO complete sections for this video:
1. INTRODUCTION (Hook): A compelling opening that matches the video style and format. Should grab attention in the first 2 seconds.
2. CONCLUSION (Summary + CTA): A meaningful ending that provides closure and drives action.

SPEAKING VOICE VISUALIZATION:
Think about how this would sound when spoken - say the words aloud to yourself. Consider:
- Rhythm and flow
- Natural pausing and emphasis
- Emotional tone and delivery
- Clarity and pronunciation

LANGUAGE SPECIFIC RULES:
- If language is '{language}', write in {('Devanagari script (Hindi)' if language == 'hi' else 'standard English')}
- DO NOT use English alphabet transliterations for {('Hindi' if language == 'hi' else 'English')}
- This applies to ALL spoken text (hook, summary, cta) - NEVER use English spellings

SCRIPT LENGTH:
- Hook: 5-8 seconds (15-24 words at ~3 words/sec speaking rate)
- Summary: 5-8 seconds (15-24 words)
- CTA: 5-8 seconds (15-24 words)
- Total conclusion: 15-24 seconds (45-72 words)

CONTENT QUALITY:
- Original and specific: No generic phrases or over-used expressions
- Accurate and factual: Verify information before writing
- Audience-focused: Address viewer needs and interests
- Clear and concise: Every word serves a purpose

Generate ONLY valid JSON matching the schema. No markdown backticks. Make sure both sections contain spoken content in the correct language.

Structure should be: {{ "introduction": {{ "hook": "text" }}, "conclusion": {{ "summary": "text", "cta": "text" }} }}"""

    # Optionally augment with web search context
    _web_ctx = _get_web_context_for_topic(f"{topic} - latest developments and background", "introduction & conclusion")
    if _web_ctx:
        base_user_prompt += f"\n\nWeb search reference (translate into {language}):\n{_web_ctx}"

    base_data = _call_llm_json(base_system_prompt, base_user_prompt, BASE_SCRIPT_JSON_SCHEMA, cancel_event, activity_label="Base Script")

    if cancel_event.is_set():
        raise InterruptedError("Cancelled")

    # 3. Generate Scenes in Loop
    progress_cb(30.0, "Drafting scene narratives...")
    logger.info("Stage 3: Generating Scenes...")

    chapters = _extract_chapters_from_outline(outline_data, min_scenes=min_scenes, max_scenes=max_scenes, topic=topic)
    total_chapters = len(chapters)

    # Recalculate per-scene duration based on actual chapter count from outline
    actual_count = total_chapters or max_scenes  # fallback if outline produced 0 chapters
    per_scene_duration = max(5, (target_duration - 15) // actual_count)
    per_scene_word_target = max(10, int(per_scene_duration * speaking_rate))  # language-aware speaking rate

    def generate_single_scene(idx, chapter):
        scene_num = chapter.get("scene_number", idx + 1)
        chapter_title = chapter.get("chapter_title", f"Scene {scene_num}")
        context = chapter.get("scene_context", "")

        prev_context = ""
        if idx > 0:
            prev_chap = chapters[idx - 1]
            prev_context = f"Previous Scene ({prev_chap.get('scene_number')}): {prev_chap.get('chapter_title')} - {prev_chap.get('scene_context')}"

        scene_system_prompt = skill_loader.render_skill(
            "script-scene-writer",
            script_rules_block=script_rules_block,
            scene_num=scene_num,
            chapter_title=chapter_title,
            per_scene_duration=per_scene_duration,
            per_scene_word_target=per_scene_word_target,
            prev_context=prev_context,
            language=language,
            sentence_rule=sentence_rule,
            genre_script_guidance=genre_script_guidance,
        )
        if not scene_system_prompt:
            scene_system_prompt = f"""{script_rules_block}You are a master YouTube Video Scriptwriter specializing in creating focused, informative scene narrations.

{genre_script_guidance}

SCENE-SPECIFIC RULES:
- This is Scene {scene_num}: {chapter_title}
- Must match the exact duration constraint: {per_scene_duration} seconds of spoken audio (roughly {per_scene_word_target} words)
- Return ONLY valid JSON matching the provided schema
- NO markdown backticks or explanatory text

AGENT TOOL USE:
- The tools web_search, get_skill, read_project_file, list_project_files and project_status_report are enabled for this scene.
- Use web_search BEFORE writing if this scene needs up-to-date or specific facts (stats, dates, names) not already given in the prompt.
- Use get_skill('scriptwriter') if you need a reminder of the writing rules.
- To use a tool, emit EXACTLY ONE tool block, receive the result in the next message, then output ONLY the final JSON.

SPEAKING VISUALIZATION:
Think about how this narration will sound when spoken:
- Rhythm and natural flow
- Emphasis on key terms
- Pacing and sentence structure
- Clarity for voiceover delivery

CONTEXT REQUIREMENTS:
- Use the topic as the main thread throughout this scene
- Previous scene context: {prev_context}
- This scene must transition smoothly from the previous content
- Connect directly to the overall video narrative arc

LANGUAGE RULES:
{lang_instruction}

CONTENT SPECIFICITY:
- Focus ONLY on what's essential for this scene segment
- Include concrete details, specific examples, and tangible information
- Cite sources or verifiability when possible
- Avoid repetition or information already covered in other scenes

{narration_emphasis}

TTS-FRIENDLY WRITING (CRITICAL for voiceover synthesis):
- Write numbers as words: "forty-two" NOT "42", "million" NOT "1,000,000"
- Avoid abbreviations: "for example" NOT "e.g.", "that is" NOT "i.e."
- Use short, clear sentences — easy for TTS to pronounce naturally
- Avoid special characters (& @ © →) — TTS will misread them
- Write dates in full: "January first twenty twenty-four" NOT "Jan 1, 2024"
- Use commas and periods for natural pauses; avoid semicolons and long dashes
- Spell out initials with periods: "U.S.A." NOT "USA"
- Avoid parentheses — restructure instead

DURATION CONSTRAINT:
- Target: {per_scene_duration} seconds of narration
- Word count: approximately {per_scene_word_target} words
- Fill precisely without filler or unnecessary exposition
- Every word must contribute to explaining or revealing something important

Return ONLY the JSON scene object with scene_number, title, and narration fields.
- Narr (type: string, required): The main spoken content for this scene.
  * Must be non-empty and specific
  * Must follow the language rules (Devanagari for Hindi, English otherwise)
  * Precise timing is critical for video production
  * Should build on previous scene while maintaining forward momentum
  * Must be comprehensive yet concise within the strict time allocation
- Format: {{ "scene_number": number, "title": "text", "narration": "text" }}
"""

        scene_user_prompt = f"""TOPIC: {topic}
SCENE IDENTITY:
- Scene Number: {scene_num}
- Chapter Title: {chapter_title}
- Context: {context}
- Previous Context: {prev_context}

AUDIENCE SCENARIO:
- This video is being watched by people interested in: {topic}
- The video length target is: {duration_mode} speed, {target_duration} seconds total
- The aspect ratio is: {video_format}

SPEAKING NARRATION:
For this specific scene (Scene {scene_num}: {chapter_title}), write the narration that will be spoken as voiceover:

THINK OUT LOUD:
Imagine speaking this aloud. What would it sound like?
- How does the rhythm flow?
- What words need emphasis?
- Where would you naturally pause?
- What tone fits this particular segment?

CONCISE DELIVERY:
- Target time: {per_scene_duration} seconds (roughly {per_scene_word_target} words)
- Speak at natural conversational pace (about 180-200 words per minute)
- Build rhythm and flow
- Make it sound natural when spoken aloud

CONTENT RULES:
- Focus only on what's essential for this specific segment
- Avoid generalities and vague statements
- Include specific, concrete details and examples
- Every sentence must add value
- Do not repeat information from previous scenes

STRICT BOUNDARY RULES:
- DO NOT write an introduction, welcome, or hook. A separate introduction has already been written.
- DO NOT write a conclusion, summary, or call-to-action at the end of this scene. A separate dedicated conclusion will be appended to the video immediately after the final scene.
- End this scene's narration naturally based on its specific context without trying to wrap up the entire video.

SPEAKING STYLE:
- Write as if you're the narrator, explaining this topic clearly
- Use active voice, not passive
- Make it engaging and easy to follow
- Consider pronunciation for the target language ({language})

FORMAT REQUIREMENT:
Return ONLY valid JSON with scene_number, title, and narration fields.
- scene_number: {scene_num}
- title: {chapter_title} (brief summary of this specific scene)
- narration: The spoken content (non-empty, specific, accurate)

LANGUAGE SPECIFICATION:
- If language is '{language}', write entirely in {('Devanagari script (Hindi)' if language == 'hi' else 'standard English')}
- NEVER use English spellings or transliterations
- This applies to ALL text in the output (title and narration)

VIDEO PRODUCTION CONSIDERATIONS:
- This narration will be synchronized with visual elements
- Keep it tight and purposeful
- Think about the visual elements that will accompany this narration
- Make it memorable and impactful

Write the narration content now. Be specific, focused, and engaging. Make it sound natural when spoken.
"""

        scene_res = runner.run_with_tools(
            scene_system_prompt, scene_user_prompt, SINGLE_SCENE_JSON_SCHEMA,
            base_activity_label="Scene Narration",
            allowed_tools=SCRIPT_NARRATION_TOOLS,
            max_turns=PIPELINE_SCRIPT_TURNS,
        )

        if not isinstance(scene_res, dict):
            if isinstance(scene_res, str) and scene_res.strip():
                scene_res = {"narration": scene_res.strip(), "title": chapter_title}
            else:
                scene_res = {}

        if "scene" in scene_res and isinstance(scene_res["scene"], dict):
            scene_res = scene_res["scene"]
        elif "data" in scene_res and isinstance(scene_res["data"], dict):
            scene_res = scene_res["data"]

        narration = (
            scene_res.get("narration")
            or scene_res.get("narr")
            or scene_res.get("text")
            or scene_res.get("content")
            or scene_res.get("script")
            or scene_res.get("voiceover")
            or ""
        )
        title = scene_res.get("title") or scene_res.get("chapter_title") or chapter_title

        narration = _safe_str(narration).strip()
        title = _safe_str(title).strip()

        if not narration:
            fallback = f"{chapter_title}: {context}"
            narration = fallback.strip()
            logger.warning(f"Scene {scene_num} had empty narration; filled from chapter context.")

        return {
            "scene_number": scene_num,
            "title": title or chapter_title,
            "narration": narration
        }

    # Use configurable llm_concurrency from settings for parallelism
    from backend.database.db import get_setting
    from backend.agent.agent_engine import AgentRunner, SCRIPT_NARRATION_TOOLS, PIPELINE_SCRIPT_TURNS
    # No progress_cb for workers: the AgentRunner default (50%) would fight the
    # real per-scene progress bar. Cancel checks still propagate.
    runner = AgentRunner(cancel_event=cancel_event)
    try:
        max_workers = int(get_setting("llm_concurrency") or 1)
    except ValueError:
        max_workers = 1
    
    logger.info(f"Generating {total_chapters} scenes with max_workers={max_workers}")

    executor = concurrent.futures.ThreadPoolExecutor(max_workers=max_workers)
    results = [None] * total_chapters
    completed = 0
    try:
        future_to_idx = {executor.submit(generate_single_scene, i, chapter): i for i, chapter in enumerate(chapters)}

        for future in concurrent.futures.as_completed(future_to_idx):
            if cancel_event.is_set():
                raise InterruptedError("Cancelled")

            idx = future_to_idx[future]
            try:
                scene_data = future.result()
                if not isinstance(scene_data, dict):
                    scene_data = {
                        "scene_number": chapters[idx].get("scene_number", idx + 1),
                        "title": chapters[idx].get("chapter_title", f"Scene {idx + 1}"),
                        "narration": _safe_str(scene_data).strip() or chapters[idx].get("scene_context", "")
                    }
                scene_data['scene_number'] = chapters[idx].get("scene_number", idx + 1)
                results[idx] = scene_data
            except Exception as exc:
                logger.error(f"Scene {idx+1} generated an exception: {exc}")
                raise exc

            completed += 1
            current_progress = 30.0 + (completed / total_chapters) * 60.0
            progress_cb(current_progress, f"Drafting scene narratives... {completed}/{total_chapters}")
    except InterruptedError:
        # Don't wait for queued-but-not-started scenes to finish their LLM
        # calls — drop them so cancellation is fast.
        executor.shutdown(wait=False, cancel_futures=True)
        raise
    finally:
        executor.shutdown(wait=True)

    scenes_array = [r for r in results if r is not None]
    progress_cb(90.0, "Assembling final script...")

    # 4. Assembly
    logger.info("Stage 4: Assembling Script...")
    intro, conclusion = _extract_base_script(base_data, topic=topic)

    doc_title = topic
    if isinstance(outline_data, dict):
        doc_title = outline_data.get("title") or outline_data.get("video_title") or outline_data.get("topic") or topic
    elif isinstance(outline_data, str) and outline_data.strip():
        doc_title = outline_data.strip()

    final_script = {
        "title": _safe_str(doc_title).strip() or topic,
        "introduction": intro,
        "scenes": scenes_array,
        "conclusion": conclusion
    }

    # Initialize empty sub_visuals for everything
    intro["sub_visuals"] = []
    conclusion["sub_visuals"] = []
    for scene in final_script.get("scenes", []):
        scene["sub_visuals"] = []

    # Validate script content — catch empty/bad output before saving
    errors = []
    if not intro.get("hook", "").strip():
        errors.append("introduction has empty narration")
    if not conclusion.get("summary", "").strip():
        errors.append("conclusion has empty summary")
    if not final_script.get("scenes"):
        errors.append("no scenes were generated")
    else:
        for i, scene in enumerate(final_script["scenes"]):
            if not scene.get("narration", "").strip():
                errors.append(f"scene {i+1} has empty narration")
    if errors:
        error_msg = "Script validation failed: " + "; ".join(errors)
        logger.error(error_msg)
        raise ValueError(error_msg)

    final_script["video_format"] = project_dict.get('video_format', 'landscape')
    final_script["_project_hash"] = compute_project_script_hash(project_dict)

    script_path = project_dir / "script.json"
    with open(script_path, "w", encoding="utf-8") as f:
        json.dump(final_script, f, indent=2, ensure_ascii=False)

    # Invalidate old design.json when script is regenerated
    design_path = project_dir / "design.json"
    if design_path.exists():
        try:
            design_path.unlink()
            logger.info("Invalidated old design.json")
        except Exception as e:
            logger.warning(f"Failed to delete old design.json: {e}")

    # Clean up obsolete downstream artifacts from previous script runs
    # 1. Voiceover
    voice_dir = project_dir / "voiceover"
    if voice_dir.exists():
        for f in voice_dir.iterdir():
            if f.is_file():
                try:
                    f.unlink()
                except Exception as e:
                    logger.warning(f"Could not delete old voiceover file {f.name}: {e}")
    merged_audio = project_dir / "voiceover.wav"
    if merged_audio.exists():
        try:
            merged_audio.unlink()
        except Exception:
            pass

    # 2. Transcription
    trans_path = project_dir / "subtitles" / "transcription.json"
    if trans_path.exists():
        try:
            trans_path.unlink()
            logger.info("Invalidated old transcription.json on new script generation")
        except Exception:
            pass

    # 3. Assets
    assets_dir = project_dir / "assets"
    if assets_dir.exists():
        for f in assets_dir.iterdir():
            if f.is_file() and (f.name.startswith("asset_") or f.name.startswith("preview_") or f.name == "assets_manifest.json"):
                try:
                    f.unlink()
                    logger.info(f"Purged old asset file on new script generation: {f.name}")
                except Exception as e:
                    logger.warning(f"Could not delete old asset file {f.name}: {e}")

    update_project(project_dict['id'], script_path=str(script_path))
    progress_cb(100.0, "Script generation complete!")
    logger.info(f"Script generated successfully and saved to: {script_path}")

def compute_project_script_hash(project_dict):
    import hashlib
    key_data = {
        "name": project_dict.get('name', ''),
        "prompt": project_dict.get('prompt', ''),
        "language": project_dict.get('language', 'hi'),
        "duration_mode": project_dict.get('duration_mode', 'medium'),
        "video_format": project_dict.get('video_format', 'landscape'),
        "style": project_dict.get('style', 'nitish_rajput')
    }
    return hashlib.md5(json.dumps(key_data, sort_keys=True).encode("utf-8")).hexdigest()

def is_script_stale(project_dict, project_dir):
    script_path = project_dir / "script.json"
    if not script_path.exists():
        return True
    try:
        with open(script_path, "r", encoding="utf-8") as f:
            script_data = json.load(f)
        stored_hash = script_data.get("_project_hash")
        
        # If the project is from before the _project_hash was introduced,
        # default to False so we don't accidentally wipe out legacy scripts.
        if not stored_hash:
            return False
            
        current_hash = compute_project_script_hash(project_dict)
        if stored_hash != current_hash:
            logger.info(f"script stale: project properties changed (stored={stored_hash} current={current_hash})")
            return True
        return False
    except Exception as e:
        logger.warning(f"Failed to check script staleness: {e}")
        return True

def _skill_content(name: str) -> str:
    """Loads a skill's markdown body from the skill registry, or '' if missing."""
    from backend.agent.skill_loader import skill_loader
    skill = skill_loader.get_skill(name)
    return skill.content if skill else ""


def _visual_rules_legacy_fallback(video_format: str, language: str) -> str:
    """Fallback rules if declarative-ast skill is missing."""
    return f"""
=== VISUAL COMPOSITION SCHEMA ===
You must use the declarative AST format for all visual compositions.
Every sub-visual MUST have a `composition` property matching the AST schema.

- Design for the {video_format} orientation.
- Use `Image`, `Video`, `Text`, or `Map` layers inside a `Sequence`.
"""


def _visual_rules_safety_net(video_format: str, language: str) -> str:
    """Shared rules for AST generation."""
    safe_bottom_pct = "25%" if video_format == "portrait" else "15%"
    text_bottom_limit = "28%" if video_format == "portrait" else "18%"
    return f"""
=== SHARED RULES (apply to every layer) ===
- `query` in Image/Video MUST ALWAYS be in English. Use 1-3 broad descriptive stock keywords.
- All text content MUST be in English, EXCEPT if you are specifically creating a subtitle/translation layer which must match the target language ({language}).
- CRITICAL FONT RULE: If generating text/subtitles in a complex script (e.g., Hindi, Tamil, Bengali, Arabic), you MUST specify a Noto font (e.g., `Noto Sans Devanagari`) in the design system or layer style to prevent broken Unicode shaping.
- Design for the {video_format} orientation (landscape 16:9, portrait 9:16, square 1:1) using responsive % widths where applicable.
  * Landscape (16:9): Split screens use `left: "6%"` & `left: "52%"`, `width: "42%"`, `height: "66%"`.
  * Portrait (9:16): Stack vertically! Top card `top: "12%"`, `height: "36%"`; Bottom card `top: "50%"`, `height: "22%"`.
- SUBTITLE SAFE AREA ({video_format}): The bottom {safe_bottom_pct} is reserved for kinetic captions. Place lower-third text above {text_bottom_limit} or align to top/center.
- STANDARDIZED Z-INDEX HIERARCHY:
  * 0 - 9: Background canvas — ANY suitable full-screen base: darkened Video footage, vector Maps, high-contrast Images, HTML gradient/pattern backgrounds, or styled solid-color canvases. Add continuous camera drift (`animations: [{{"property": "scale", "from": 1.0, "to": 1.06, "duration": ..., "easing": "linear"}}]`). VARY your background type — do NOT default to Video for every sub-visual.
  * 10 - 29: Midground motion primitives (Charts, Shapes, Bespoke HTML Cards, Maps, Insets) with corner rounding (`borderRadius: "20px"`) + spring entrance (`delay: 0.15`, `easing: "spring"`)
  * 30 - 39: Foreground typography / callouts (respect subtitle safe area) with staggered reveal (`delay: 0.45` to `0.7`)

=== NO STATIC CHAPTER TITLE CARDS IN SUB-VISUALS ===
Do NOT create static chapter title badges, scene name cards, or temporary header pills inside sub-visual cuts. Chapter indicators and video branding are managed continuously at the root composition level. Dedicate sub-visual cuts entirely to motion graphics, infographics, evidence mockups, b-roll, and visual storytelling.

=== ANIMATION TIMING WITH WORD TIMESTAMPS ===
When word-level timestamps are provided (e.g. "market [1.2s] crashed [1.8s] today [2.3s]"), use them to precisely sync:
- Text reveal animations timed to when specific words are spoken using `delay` in seconds.
- Data visualization build-up animations synced to narration beats.
- Element entry/exit timings matching spoken content transitions.
Example: If "GDP" is spoken at [2.3s], set `delay: 2.3` on the GDP text animation.

- DO NOT add arbitrary properties that are not supported.
- `query` in `Image` and `Video` content MUST ALWAYS be in English.
- All text content MUST be in English.
"""


def get_shared_visual_rules(video_format: str, language: str = "hi") -> str:
    """Centralized visual generation rules for the Declarative AST."""
    from backend.agent.skill_loader import skill_loader

    ast = skill_loader.get_skill("declarative-ast")

    if ast is not None:
        return ast.content + "\n\n" + _visual_rules_safety_net(video_format, language)

    logger.warning("declarative-ast skill not found. Using fallback rules.")
    return _visual_rules_legacy_fallback(video_format, language)


def generate_visuals_pipeline(project_dict, project_dir, progress_cb, cancel_event, force=False):
    from backend.database.db import get_setting, update_project, get_project
    from backend.core.logger import logger

    script_path = project_dir / "script.json"
    
    # Try the database path first
    manifest_path_str = project_dict.get('assets_manifest_path')
    manifest_path = Path(manifest_path_str) if manifest_path_str else None
    
    # If it's missing or the file was deleted, fallback to the original voiceover manifest
    if not manifest_path or not manifest_path.exists():
        manifest_path = project_dir / "voiceover" / "manifest.json"
        
    transcription_path = Path(project_dict.get('transcription_path', project_dir / "subtitles" / "transcription.json"))

    if not script_path.exists():
        raise FileNotFoundError("script.json is missing.")
    if not manifest_path.exists():
        raise FileNotFoundError("manifest.json is missing. Please re-run from Voiceover generation.")

    with open(script_path, "r", encoding="utf-8") as f:
        script = json.load(f)
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    topic = project_dict['name']
    language = project_dict.get('language', 'hi')
    video_format = project_dict.get('video_format', 'landscape')

    progress_cb(10.0, "Preparing to generate visuals...")
    logger.info("Starting Visuals Generation Pipeline...")

    # Generate overarching design system
    design_system, is_new_design = generate_project_design_system(project_dict, script, project_dir, progress_cb, cancel_event)
    if is_new_design:
        progress_cb(15.0, "Preparing to generate visuals...")
    design_system_text = format_design_system_prompt(design_system)
    
    current_design_hash = ""
    if design_system:
        current_design_hash = hashlib.md5(json.dumps(design_system, sort_keys=True).encode("utf-8")).hexdigest()[:12]

    visual_rules = get_shared_visual_rules(video_format, language)
    visual_director = _skill_content("visual-director-core") or _skill_content("visual-director")
    editor_qa_rules = _skill_content("editor-qa")
    motion_designer_rules = _skill_content("motion-graphics-designer")

    editor_qa_block = f"""=== EDITOR QA GUARDRAILS ===
{editor_qa_rules}

""" if editor_qa_rules else ""

    visual_director_block = f"""{visual_director}

""" if visual_director else ""

    motion_designer_block = f"""=== MOTION GRAPHICS STYLING & RECIPES ===
{motion_designer_rules}

""" if motion_designer_rules else ""

    visuals_system_prompt = f"""[System Context: Project ID is '{project_dict.get('id')}']
{editor_qa_block}You are an expert AI Visual Director and Motion Graphics Designer for YouTube videos.

CORE MISSION:
Transform narration into visually stunning, cinematic motion graphic sequences. Think like a top-tier After Effects artist.
DO NOT default to the lazy pattern of [Full-Screen Stock Image] → [Centered Text].
Every sub-visual should feel like a deliberate creative decision with rich multi-layer depth.
{design_system_text}
{visual_director_block}
{motion_designer_block}
=== 3-LAYER DEPTH & MOTION GRAMMAR ===
Construct depth across 3 standardized Z-index layers on every visual beat:
1. **Z-Index 0–9 (Atmospheric Canvas / Background)**: Full-screen base layer. Choose the BEST fit for the narrative moment:
   - **Video**: Cinematic B-roll footage with `brightness(0.3)` filter + camera drift (`scale: 1.0 -> 1.06`). Best for atmospheric/cinematic beats.
   - **Image**: High-contrast darkened photograph (portraits, evidence, textures) + camera drift. Best for entity spotlights and historical context.
   - **HTML**: CSS gradient canvas, technical grid pattern, or colored slate. Best for data-heavy, tech, financial, and infographic beats without distracting footage.
   - **Map**: Vector globe with animated route trajectory. Best when geography/travel is central to the narration.
   ⚠️ VARIETY RULE: Do NOT use the same background type for consecutive sub-visuals. If cut #1 used Video, switch to Image, HTML Gradient/Grid, or Map for cut #2.
2. **Z-Index 10–29 (Graphic Subject / Midground)**: Data charts (`Chart`), cards, vector shapes & icons (`Shape`), bespoke HTML evidence memos (`HTML`), or split-screen insets. Enter via physics spring (`animations: [{{"property": "translateY", "from": 45, "to": 0, "duration": 0.6, "easing": "spring"}}, {{"property": "opacity", "from": 0, "to": 1, "duration": 0.45, "easing": "ease-out"}}]`).
    * 💡 **Chart Placement Rule**: Charts MUST live in Z-Index 10–29 over an HTML gradient canvas or darkened video. Never render a raw naked chart at z-index 0.
3. **Z-Index 30–39 (Typography & Accents / Foreground)**: Kinetic typography (`marker_highlight`, `words_stagger`, `typewriter`) and indicator callout pointers (respecting subtitle safe area: `bottom > 18%` for landscape).

=== MASTER VISUAL ARCHETYPES ===
Vary your spatial layouts across cuts using these master blueprints:
- **Split-Screen Data HUD**: Darkened Video/HTML background + Left 45% chart card + Right 45% media inset.
- **Investigative Dossier**: Dark background + custom HTML leaked document memo with confidential stamp + glowing marker highlight quote.
- **Macro Metric Callout**: Dark background + large badge with dynamic metric or progress bar (`Chart`).
- **Geographic Route / Map**: Dark vector map with city pins + glowing animated SVG trajectory path (`preset_path: "route_arch"`).
- **Technical Blueprint / HUD**: Grid background (HTML at z_index 0) + transparent vector diagram + glowing corner brackets (`preset_path: "corner_brackets"`).
- **Bespoke Infographic Card**: HTML gradient background + high-production HTML/SVG comparison table, radar chart, or UI mockup.
- **Cinematic Atmosphere Beat**: Graded high-contrast ambient footage with continuous Ken Burns drift (when narrative calls for a breather).
- **Entity Spotlight**: Darkened full-screen Image (portrait/evidence photo at z_index 0 with `brightness(0.35)`) + bio card overlay + kinetic text.
- **Data Infographic Showcase**: High-tech HTML gradient background (z_index 0) + Chart card (z_index 15) + floating kinetic headline callout (z_index 30).

RULES:
- COUNT: One sub-visual per visual beat
- DURATION: Each 2-15 seconds, sum MUST equal scene duration
- 🚫 NO CHAPTER TITLE BADGES: Do NOT create static chapter title cards or header badges inside sub-visual cuts. Chapter indicators are rendered continuously by the root composition overlay engine.
- query: ALWAYS in English. Use descriptive, specific keywords for relevant results.
- Text content: ALWAYS in English
- style: USE responsive percentage coordinates (`left`, `top`, `width`, `height`) on cards and layers.
- DESIGN SYSTEM: Bind `primary`, `accent`, `surface`, `glow`, and `fontFamily` from the project's design system into layer styles.
- VIDEO: Set `"volume": 0` by default on all Video layers.
- ONLY use the 9 valid content types: Image, Video, Text, Chart, Shape, Map, HTML, Lottie, Particles (Particles = canvas overlay confetti/embers/dust/money_rain/snow/stars, exactly ONE per cut, topmost z_index 30-39, matched to the beat emotion).
- MOTION MODIFIERS: Set `"motion_blur": true` on fast-moving cards or spring entrances for physical shutter blur. Set `"camera_shake": "handheld" | "shockwave" | "glitch"` on background/composite layers for procedural organic camera motion. 2026 FX pack in layer `"filters"`: CSS looks (Neon Glow Pop, Cyberpunk, Golden Hour, Bleach Bypass, Night Vision, Thermal False-Color, Noir Hard, Dream Blur) and SVG looks (`url(#fx-emboss)`, `url(#fx-sharpen)`, `url(#fx-posterize)`, `url(#fx-duotone-midnight)`, `url(#fx-duotone-inferno)`, `url(#fx-thermal)`) — max ONE SVG look per layer, ~1 FX cut per 3-4 cuts. Punch-in emphasis at sub-visual level: `"emphasis": [{{"at": 1.2, "scale": 1.15, "duration": 0.5}}]` — 0-2 marks per cut, cuts of 2s or longer only.

OUTPUT STRUCTURE:
Return ONLY valid JSON matching VISUALS_ARRAY_SCHEMA:
{{"sub_visuals": [{{"composition": {{"type": "Sequence", "children": [...]}}, "duration": 3.5}}]}}

ERROR PREVENTION:
- Duration sum must equal exactly the provided scene duration (2 decimal places)
- Use only valid AST structures with numeric durations and valid easing values ("linear", "spring", "ease-in", "ease-out", "ease-in-out")
- All required fields present for each content type

{visual_rules}"""

    total_scenes = len(manifest)
    completed = 0
    _last_progress_ts = 0.0
    _progress_lock = threading.Lock()

    # Load transcription for precise word-level timings
    transcription_data = None
    if transcription_path.exists():
        try:
            with open(transcription_path, "r", encoding="utf-8") as f:
                transcription_data = json.load(f)
        except Exception as e:
            logger.error(f"Failed to load transcription: {e}")

    cumulative_time = 0.0

    def _throttled_progress(pct, msg):
        """Throttle progress updates to max every 500ms to avoid UI flooding."""
        nonlocal _last_progress_ts
        now = time.time()
        with _progress_lock:
            if now - _last_progress_ts >= 0.5 or pct >= 99.9:
                _last_progress_ts = now
                progress_cb(pct, msg)

    # Pre-calculate cumulative times for parallel processing
    scene_start_times = []
    curr_time = 0.0
    for entry in manifest:
        scene_start_times.append(curr_time)
        curr_time += entry.get("duration", 15.0)

    # Use configurable llm_concurrency from settings for parallelism
    from backend.database.db import get_setting
    try:
        max_workers = int(get_setting("llm_concurrency") or 1)
    except ValueError:
        max_workers = 1

    logger.info(f"Generating visuals for {total_scenes} scenes with max_workers={max_workers}")
    
    def process_scene(i, entry):
        nonlocal completed
        if cancel_event.is_set():
            raise InterruptedError("Cancelled")

        cumulative_time = scene_start_times[i]
        if cancel_event.is_set():
            raise InterruptedError("Cancelled")

        scene_type = entry.get("section_type")
        scene_title = entry.get("title", "")
        narration = entry.get("text", "")
        duration = entry.get("duration", 15.0)

        # Get exact transcription words for this scene
        word_timings = ""
        if transcription_data and "segments" in transcription_data:
            words_in_scene = []
            for seg in transcription_data["segments"]:
                for w in seg.get("words", []):
                    w_start = w.get("start", 0)
                    if w_start >= cumulative_time and w_start < cumulative_time + duration:
                        words_in_scene.append(f"{w.get('word', '').strip()} [{w_start - cumulative_time:.1f}s]")
            if words_in_scene:
                word_timings = "\nExact Spoken Words with Timestamps (Seconds from Scene Start):\n" + " ".join(words_in_scene) + "\n"

        # We already pre-calculated cumulative_time
        # cumulative_time += duration

        # --- Smart Preservation Logic ---
        # Look for existing sub-visuals in script.json FIRST, then manifest entry
        script_entry_svs = []
        if scene_type == "introduction" and script.get("introduction"):
            script_entry_svs = script["introduction"].get("sub_visuals", [])
        elif scene_type == "conclusion" and script.get("conclusion"):
            script_entry_svs = script["conclusion"].get("sub_visuals", [])
        elif scene_type == "scene" and isinstance(script.get("scenes"), list):
            scene_idx = sum(1 for m in manifest[:i] if m.get("section_type") == "scene")
            if 0 <= scene_idx < len(script["scenes"]):
                script_entry_svs = script["scenes"][scene_idx].get("sub_visuals", [])

        existing_sub_visuals = entry.get("sub_visuals", [])
        if _has_meaningful_sub_visuals(script_entry_svs):
            existing_sub_visuals = script_entry_svs

        # Compute narration hash for change-detection: when narration changes,
        # we must regenerate even if sub-visuals exist from a previous run.
        narration_hash = hashlib.md5(narration.encode("utf-8")).hexdigest()[:12]
        stored_hash = entry.get("_narr_hash", "")

        # Check if existing sub-visuals are valid (not just a single blank default generated by tts.py)
        is_default = not _has_meaningful_sub_visuals(existing_sub_visuals)

        narration_changed = (stored_hash and stored_hash != narration_hash)
        
        stored_design_hash = entry.get("_design_hash", "")
        design_changed = (stored_design_hash and stored_design_hash != current_design_hash)

        if not force and existing_sub_visuals and not is_default and not narration_changed and not design_changed and not is_new_design:
            logger.info(f"Preserving existing sub-visuals for scene '{scene_title}'. Scaling durations to new total {duration}s.")
            old_total = sum([float(v.get("duration", 0)) for v in existing_sub_visuals])
            if old_total > 0:
                scale = duration / old_total
                for v in existing_sub_visuals:
                    v["duration"] = round(float(v.get("duration", 0)) * scale, 2)
            else:
                for v in existing_sub_visuals:
                    v["duration"] = round(duration / len(existing_sub_visuals), 2)

            entry["sub_visuals"] = existing_sub_visuals
            entry["_narr_hash"] = narration_hash
            entry["_design_hash"] = current_design_hash
            with _progress_lock:
                completed += 1
            base_prog = 15.0 if is_new_design else 10.0
            _throttled_progress(base_prog + (completed / total_scenes) * (90.0 - base_prog), f"Preserved AST scenes... {completed}/{total_scenes}")
            return entry
        # --- End Smart Preservation Logic ---

        # --- STAGE 1: Visual Storyboard Planning ---
        genre_key = project_dict.get('prompt') or 'documentary'
        from backend.pipeline.genres import format_genre_storyboard_prompt, get_genre_profile
        genre_profile = get_genre_profile(genre_key)
        genre_storyboard_guidance = format_genre_storyboard_prompt(genre_key)

        storyboard_skill = skill_loader.get_skill("storyboard-planner")
        storyboard_guidance = f"\n\n{storyboard_skill.content}" if storyboard_skill else ""
        plan_system_prompt = f"""[System Context: Project ID is '{project_dict.get('id')}']
You are an expert Visual Director and Cinematographer. Your job is to read the narration for this scene and write a highly creative, detailed storyboard plan describing the sub-visual beats needed.

{genre_storyboard_guidance}

Emphasize rich motion graphic primitives (Charts, Shapes, Bespoke HTML UI, Kinetic Text, Maps, Lottie, Footage, Particles atmosphere overlays) with cinematic motion blur and camera shake modifiers aligned with the {genre_profile['name']} style.
Do NOT plan static chapter title cards in sub-visual beats (chapter branding is rendered continuously by the root composition). Focus purely on content storytelling.
Do not output AST JSON, just output a detailed text description of what each sub-visual should look like.{storyboard_guidance}"""

        plan_user_prompt = f"Topic: {topic}\nGenre: {genre_profile['name']}\nScene: {scene_title}\nDuration: {duration}s\nNarration:\n{narration}\n\nWrite a storyboard plan for each sub-visual beat."

        plan_schema = {
            "type": "object",
            "properties": {
                "storyboard_plan": {"type": "string", "description": "The detailed visual plan/storyboard for this scene"}
            },
            "required": ["storyboard_plan"]
        }
        
        try:
            from backend.pipeline.ai import _call_llm_json
            plan_response = _call_llm_json(plan_system_prompt, plan_user_prompt, plan_schema, cancel_event, activity_label=f"Planning Scene {i+1}")
            storyboard = plan_response.get("storyboard_plan", "") if isinstance(plan_response, dict) else ""
        except Exception as plan_e:
            logger.warning(f"Stage 1 Planning failed for scene {i}: {plan_e}. Falling back to direct generation.")
            storyboard = "No plan available. Make creative decisions directly."

        # --- STAGE 2: AST Generation ---
        user_prompt = f"""Topic: "{topic}"
Genre: "{genre_profile['name']}"
Scene: {scene_title} ({scene_type})
Total Scene Duration: {duration} seconds

Narration:
{narration}
{word_timings}

APPROVED STORYBOARD PLAN:
{storyboard}

Generate the sub_visuals array following the APPROVED STORYBOARD PLAN precisely. The sum of 'duration' for all sub_visuals MUST exactly equal {duration} seconds."""

        try:
            # Generation + duration-math validation + enum correction via the
            # agent runner (replaces the old inline fuzzy-type mapping).
            # Pipeline runs get a read-only tool allowlist (no project
            # mutations mid-run) and a larger turn budget.
            visuals_data = runner.validate_and_correct_visuals(
                visuals_system_prompt, user_prompt, VISUALS_ARRAY_SCHEMA, float(duration),
                allowed_tools=PIPELINE_VISUAL_TOOLS, max_turns=PIPELINE_VISUAL_TURNS,
            )
            if not isinstance(visuals_data, dict) or "sub_visuals" not in visuals_data:
                raise ValueError(f"Unexpected visuals payload type: {type(visuals_data).__name__}")

            entry["sub_visuals"] = visuals_data.get("sub_visuals", [])
            entry["_narr_hash"] = narration_hash
            entry["_design_hash"] = current_design_hash
        except InterruptedError:
            # Cancellation must abort the worker immediately instead of burning
            # the last LLM call and substituting a default visual.
            raise
        except Exception as e:
            logger.error(f"Failed to generate visuals for scene {i}: {e}")
            entry["sub_visuals"] = [{"composition": {"type": "Sequence", "children": []}, "duration": duration}]
            entry["_narr_hash"] = narration_hash
            entry["_design_hash"] = current_design_hash

        with _progress_lock:
            completed += 1
        base_prog = 15.0 if is_new_design else 10.0
        _throttled_progress(base_prog + (completed / total_scenes) * (90.0 - base_prog), f"Planned & Built AST scenes... {completed}/{total_scenes}")
        return entry

    import concurrent.futures
    from backend.agent.agent_engine import AgentRunner, PIPELINE_VISUAL_TOOLS, PIPELINE_VISUAL_TURNS
    # No progress_cb for workers: AgentRunner defaults (50%) would fight the
    # real per-scene progress bar. Cancel checks still propagate.
    runner = AgentRunner(cancel_event=cancel_event)

    executor = concurrent.futures.ThreadPoolExecutor(max_workers=max_workers)
    results = [None] * total_scenes
    try:
        future_to_idx = {executor.submit(process_scene, i, entry): i for i, entry in enumerate(manifest)}

        for future in concurrent.futures.as_completed(future_to_idx):
            if cancel_event.is_set():
                raise InterruptedError("Cancelled")

            idx = future_to_idx[future]
            try:
                results[idx] = future.result()
            except Exception as exc:
                logger.error(f"Scene visuals {idx} generated an exception: {exc}")
                raise exc
    except InterruptedError:
        # Don't wait for queued-but-not-started futures to finish their LLM
        # calls — drop them immediately so cancellation is fast.
        executor.shutdown(wait=False, cancel_futures=True)
        raise
    finally:
        executor.shutdown(wait=True)

    # Reassign sorted results back to manifest
    for i, entry in enumerate(manifest):
        if results[i]:
            manifest[i] = results[i]

    # Write back to manifest
    if is_new_design and isinstance(design_system, dict) and design_system.get('theme_name'):
        import os
        try:
            design_path = project_dir / "design.json"
            temp_path = design_path.with_suffix('.tmp')
            with open(temp_path, "w", encoding="utf-8") as f:
                json.dump(design_system, f, indent=2)
            os.replace(temp_path, design_path)
            logger.info("Saved design.json successfully.")

            # Sync design.json to project_settings for total visual cohesion.
            # Re-fetch the row so long-running user edits to project_settings
            # (or the agent's update_visual_settings writes) are not clobbered
            # by the snapshot taken when the run started.
            proj_id = project_dict.get('id')
            if proj_id:
                fresh_project = get_project(proj_id)
                current_settings = (fresh_project or project_dict).get('project_settings')
                settings_dict = json.loads(current_settings) if isinstance(current_settings, str) and current_settings.strip() else {}
                if isinstance(current_settings, dict):
                    settings_dict = current_settings
                
                typography = design_system.get('typography', {})
                palette = design_system.get('color_palette', {})

                # Mirror the generated palette into project_settings, but only
                # for keys the user hasn't already customized — the sync must
                # not clobber explicit user styling choices.
                if 'heading_font' in typography:
                    settings_dict.setdefault('fontFamily', typography['heading_font'])
                    settings_dict.setdefault('numbering_font_family', typography['heading_font'])
                if 'primary' in palette:
                    settings_dict.setdefault('activeColor', palette['primary'])
                    settings_dict.setdefault('numbering_title_color', palette['primary'])
                    settings_dict.setdefault('numbering_number_bg_color', palette['primary'])
                    settings_dict.setdefault('numbering_number_border_color', palette['primary'])
                    settings_dict.setdefault('chapter_border_color', palette['primary'])
                if 'text' in palette:
                    settings_dict.setdefault('pastColor', palette['text'])
                    settings_dict.setdefault('numbering_description_color', palette['text'])
                    settings_dict.setdefault('chapter_text_color', palette['text'])
                if 'background' in palette:
                    settings_dict.setdefault('numbering_number_color', palette['background'])
                if 'accent' in palette:
                    settings_dict.setdefault('numbering_accent_color', palette['accent'])

                update_project(proj_id, project_settings=json.dumps(settings_dict))
                logger.info("Synced design system properties to project_settings.")

        except Exception as e:
            logger.error(f"Failed to save design.json or sync settings: {e}")

    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    # Also update script.json so it matches the manifest
    script_scenes = script.get("scenes", [])
    manifest_scenes = [m for m in manifest if m.get("section_type") == "scene"]

    # Intro
    manifest_intro = next((m for m in manifest if m.get("section_type") == "introduction"), None)
    if manifest_intro and "introduction" in script:
        m_subs = manifest_intro.get("sub_visuals", [])
        if _has_meaningful_sub_visuals(m_subs) or not _has_meaningful_sub_visuals(script["introduction"].get("sub_visuals")):
            script["introduction"]["sub_visuals"] = m_subs

    # Scenes
    for i, sc in enumerate(script_scenes):
        if i < len(manifest_scenes):
            m_subs = manifest_scenes[i].get("sub_visuals", [])
            if _has_meaningful_sub_visuals(m_subs) or not _has_meaningful_sub_visuals(sc.get("sub_visuals")):
                sc["sub_visuals"] = m_subs

    # Conclusion
    manifest_conclusion = next((m for m in manifest if m.get("section_type") == "conclusion"), None)
    if manifest_conclusion and "conclusion" in script:
        m_subs = manifest_conclusion.get("sub_visuals", [])
        if _has_meaningful_sub_visuals(m_subs) or not _has_meaningful_sub_visuals(script["conclusion"].get("sub_visuals")):
            script["conclusion"]["sub_visuals"] = m_subs

    with open(script_path, "w", encoding="utf-8") as f:
        json.dump(script, f, indent=2, ensure_ascii=False)

    # Reconcile disk assets with the newly generated manifest
    try:
        from backend.pipeline.assets import cleanup_removed_assets
        cleanup_removed_assets(project_dict['id'], manifest)
    except Exception as e:
        logger.warning(f"Post visual-generation asset reconciliation failed: {e}")

    progress_cb(100.0, "Visual generation complete!")
    logger.info("Visual generation pipeline completed successfully.")



