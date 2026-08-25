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

    llm_provider = _gs("llm_provider") or "openai"
    api_key = _gs("nvidia_api_key") if llm_provider == "nvidia" else _gs("openai_api_key")
    if not api_key:
        return clean_search_query(context_description)

    base_url = (_gs("nvidia_base_url") if llm_provider == "nvidia" else _gs("openai_base_url")) or \
               ("https://integrate.api.nvidia.com/v1" if llm_provider == "nvidia" else "https://api.openai.com/v1")
    model = _gs("nvidia_model") if llm_provider == "nvidia" else _gs("openai_model") or \
            ("meta/llama-3.1-8b-instruct" if llm_provider == "nvidia" else "gpt-4o")

    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key, base_url=base_url.rstrip('/') if base_url else None)

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

        query = resp.choices[0].message.content
        # Strip <think>...</think> blocks from reasoning models (handling unclosed blocks)
        query = re.sub(r'<think>.*?(?:</think>|$)', '', query, flags=re.DOTALL | re.IGNORECASE)
        query = query.strip().strip('"').strip("'")
        
        # If it still includes a "Thinking Process:" block, try to take the last line as the query
        if "Thinking Process" in query or "Thinking:" in query:
            lines = [line.strip() for line in query.split('\n') if line.strip()]
            if lines:
                query = lines[-1].strip('*').strip('"').strip("'").removeprefix("Query:").removeprefix("Search query:").strip()

        if query and len(query) > 3:
            logger.info(f"AI generated search query: \"{query}\" for stage '{stage}'")
            return query
    except Exception as e:
        logger.warning(f"Search query generation failed (non-fatal): {type(e).__name__}: {e}")

    # Fallback: just clean the original context description
    return clean_search_query(context_description)

# Schema for individual sub-visual entries
SUB_VISUAL_SCHEMA = {
    "type": "object",
    "properties": {
        "visual_cue": {"type": "string"},
        "visual_type": {
            "type": "string",
            "enum": ["map", "document", "portrait", "scene", "image", "youtube", "parallax", "network", "list", "custom_html", "thread", "device_mockup", "ai_image"]
        },
        "transition": {
            "type": "string",
            "enum": ["subtle_slide", "fade", "slide_left", "slide_right", "slide_up", "slide_down", "zoom_in", "zoom_out", "glitch", "none"]
        },
        "visual_meta": {"type": "object"},
        "duration": {"type": "number", "description": "Precise duration in seconds"}
    },
    "required": ["visual_cue", "visual_type", "transition", "duration"]
}

# Schema validations for JSON parsing
SCRIPT_INTRO_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "hook": {"type": "string"}
    },
    "required": ["hook"]
}

SCRIPT_SCENE_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "scene_number": {"type": "integer"},
        "title": {"type": "string"},
        "narration": {"type": "string"}
    },
    "required": ["scene_number", "title", "narration"]
}

SCRIPT_CONCLUSION_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "cta": {"type": "string"}
    },
    "required": ["summary", "cta"]
}

VISUALS_ARRAY_SCHEMA = {
    "type": "object",
    "properties": {
        "sub_visuals": {
            "type": "array",
            "items": SUB_VISUAL_SCHEMA
        }
    },
    "required": ["sub_visuals"]
}

# Visual types removed from the app (renderers deleted). Legacy projects can
# still hold sub-visuals of these types; the pipeline swaps them for neutral
# scene entries so they render instead of a blank frame.
REMOVED_VISUAL_TYPES = frozenset({"chart", "timeline"})

DESIGN_SYSTEM_SCHEMA = {
    "type": "object",
    "properties": {
        "theme_name": {"type": "string"},
        "color_palette": {
            "type": "object",
            "properties": {
                "background": {"type": "string"},
                "primary": {"type": "string"},
                "secondary": {"type": "string"},
                "accent": {"type": "string"},
                "text": {"type": "string"}
            },
            "required": ["background", "primary", "secondary", "accent", "text"]
        },
        "typography": {
            "type": "object",
            "properties": {
                "heading_font": {"type": "string"},
                "body_font": {"type": "string"}
            },
            "required": ["heading_font", "body_font"]
        },
        "css_guidelines": {"type": "string"}
    },
    "required": ["theme_name", "color_palette", "typography", "css_guidelines"]
}

# Sane fallbacks used to repair partial AI design-system responses. OpenAI-
# compatible endpoints only force "some JSON object" (unlike NVIDIA guided_json
# which enforces the schema), so models frequently omit optional-looking keys.
DESIGN_DEFAULTS = {
    "theme_name": "Custom",
    "color_palette": {
        "background": "#0b0b1a",
        "primary": "#facc15",
        "secondary": "#38bdf8",
        "accent": "#f472b6",
        "text": "#f8fafc",
    },
    "typography": {"heading_font": "Oswald", "body_font": "Inter"},
    "css_guidelines": "Use bold gradients and high contrast. Apply all rules only via CSS inside custom_html/custom_html_ui.",
}

_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def _repair_design_data(design_data):
    """Fill missing/empty/Non-hex fields of a partial design system with defaults.

    Mutates and returns the dict. Values the model DID provide are kept.
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
        f"Strictly adhere to these design rules when generating custom_html or custom_html_ui. "
        f"These colors and styles MUST ONLY be applied via CSS inside custom_html. "
        f"Do NOT add them as new fields to the visual_meta JSON object:\n"
        f"{json.dumps(clean, indent=2)}\n"
    )

def generate_project_design_system(project_dict, script_data, project_dir, progress_cb, cancel_event):
    design_path = project_dir / "design.json"
    is_new = False
    
    topic = project_dict.get('name', 'Unknown')
    language = project_dict.get('language', 'hi')
    video_format = project_dict.get('video_format', 'landscape')
    
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
            return data, is_new
        except Exception as e:
            from backend.core.logger import logger
            logger.warning(f"Invalidating existing design.json: {e}")
            
    is_new = True
    system_prompt = f"""You are an expert Art Director. Create a cohesive Design System for a YouTube video.
The format is {video_format} (e.g. landscape means 16:9, portrait means 9:16).
Return ONLY valid JSON matching the schema. No markdown backticks.

DESIGN GUIDELINES:
- color_palette: Must use modern, vibrant, or highly readable hex codes.
- typography: Use EXACTLY one of these modern Google Fonts: 'Inter', 'Oswald', 'Outfit', or 'Montserrat'. Do not use any others.
- css_guidelines: Provide brief layout and style rules. These MUST ONLY be applied via CSS inside custom_html/custom_html_ui components. Do NOT add them as new fields to the visual_meta JSON object.
"""
    import uuid
    user_prompt = f"Topic: {topic}\nLanguage: {language}\nVideo Title: {script_data.get('title', 'Untitled')}\nRequest ID: {uuid.uuid4().hex}\n"
    
    from backend.core.logger import logger
    logger.info("Generating global Design System...")
    progress_cb(12.0, "Generating global Design System...")
    
    try:
        design_data = _call_llm_json(system_prompt, user_prompt, DESIGN_SYSTEM_SCHEMA, cancel_event, activity_label="Design System")
    except Exception as e:
        if isinstance(e, InterruptedError):
            raise e
        logger.warning(f"Design generation failed, falling back to default: {e}")
        return {"theme_name": "default", "_failed": True, "_language": language, "_video_format": video_format}, True
    
    if isinstance(design_data, dict) and design_data.get('theme_name'):
        design_data = _repair_design_data(design_data)
        # Validate that all required schema fields are present
        required_keys = {'color_palette', 'typography', 'css_guidelines'}
        if not required_keys.issubset(design_data.keys()):
            logger.warning(f"Design system response missing required keys: {required_keys - design_data.keys()}")
            return {"theme_name": "default", "_failed": True, "_language": language, "_video_format": video_format}, True
        design_data['_language'] = language
        design_data['_video_format'] = video_format
        return design_data, True

    if isinstance(design_data, dict):
        # Model returned JSON but skipped top-level keys (common on OpenAI-
        # compatible endpoints that don't enforce the schema). Repair it
        # instead of discarding the AI's palette/typography work.
        design_data = _repair_design_data(design_data)
        if design_data.get('theme_name'):
            logger.warning("Design system was missing top-level keys — repaired from defaults.")
            design_data['_language'] = language
            design_data['_video_format'] = video_format
            return design_data, True

    logger.warning("Failed to generate design system, returning default.")
    return {"theme_name": "default", "_failed": True, "_language": language, "_video_format": video_format}, True

OUTLINE_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "chapters": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "scene_number": {"type": "integer"},
                    "chapter_title": {"type": "string"},
                    "scene_context": {"type": "string"}
                },
                "required": ["scene_number", "chapter_title", "scene_context"]
            }
        }
    },
    "required": ["title", "chapters"]
}

BASE_SCRIPT_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "introduction": SCRIPT_INTRO_JSON_SCHEMA,
        "conclusion": SCRIPT_CONCLUSION_JSON_SCHEMA
    },
    "required": ["introduction", "conclusion"]
}

SINGLE_SCENE_JSON_SCHEMA = SCRIPT_SCENE_JSON_SCHEMA

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

def clean_json_response(raw_response):
    """Strips markdown backticks and attempts parsing or repairing JSON."""
    clean_text = raw_response.strip()
    # Strip <think>...</think> blocks from reasoning models before parsing
    clean_text = re.sub(r'<think>.*?(?:</think>|$)', '', clean_text, flags=re.DOTALL | re.IGNORECASE).strip()
    
    match = re.search(r"```(?:json)?\s*(\[.*?\]|\{.*?\})\s*```", clean_text, re.DOTALL | re.IGNORECASE)
    if match:
        clean_text = match.group(1)
    else:
        first_bracket = clean_text.find('[')
        first_brace = clean_text.find('{')
        if first_bracket != -1 and (first_brace == -1 or first_bracket < first_brace):
            clean_text = clean_text[first_bracket:]
        else:
            try:
                from backend.agent.agent_engine import _try_extract_json_objects
                objs = _try_extract_json_objects(clean_text)
                if objs:
                    clean_text = objs[-1]
                else:
                    if first_brace != -1:
                        clean_text = clean_text[first_brace:]
            except ImportError:
                if first_brace != -1:
                    clean_text = clean_text[first_brace:]

    try:
        return json.loads(clean_text)
    except json.JSONDecodeError:
        pass

    try:
        repaired = repair_json_string(clean_text)
        return json.loads(repaired)
    except Exception as e:
        logger.warning(f"Standard JSON repair failed: {e}. Trying ast.literal_eval fallback...")

    try:
        repaired_val = repair_json_string(clean_text)
        return ast.literal_eval(repaired_val)
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

    llm_provider = provider_override or (get_setting("llm_provider") or "openai")

    if llm_provider == "nvidia":
        api_key = get_setting("nvidia_api_key")
        base_url = get_setting("nvidia_base_url") or "https://integrate.api.nvidia.com/v1"
        model = get_setting("nvidia_model") or "meta/llama-3.1-8b-instruct"
        temperature = float(get_setting("nvidia_temperature") or 0.7)
        max_tokens = int(get_setting("nvidia_max_tokens") or 4096)
        top_p = float(get_setting("nvidia_top_p") or 1.0)
    else:
        api_key = get_setting("openai_api_key")
        base_url = get_setting("openai_base_url") or "https://api.openai.com/v1"
        model = get_setting("openai_model") or "gpt-4o"
        temperature = float(get_setting("openai_temperature") or 0.7)
        max_tokens = int(get_setting("openai_max_tokens") or 4096)
        top_p = float(get_setting("openai_top_p") or 1.0)

    if not api_key:
        raise ValueError(f"{llm_provider.title()} API key is missing. Please configure it in the settings panel.")

    return {
        "provider": llm_provider,
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
    is_reasoning_model = forced_think or any(tag in model_lower for tag in ("deepseek", "r1", "qwq", "reasoning", "think"))
    if is_reasoning_model and max_tokens <= 8192:
        logger.info(f"Reasoning model/CoT detected. Boosting max_tokens {max_tokens} -> 16384 to allow room for reasoning + content.")
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

    if schema is not None:
        if llm_provider == "nvidia":
            kwargs["extra_body"] = {"guided_json": schema}
        else:
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
                set_cached_response(cache_k, raw_content)
                _emit_llm("ok", "tool-loop turn")
                return raw_content

            parsed_json = clean_json_response(raw_content)

            if cancel_event.is_set():
                raise InterruptedError("Cancelled")

            # Cache the response
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
    prompt_desc = project_dict['prompt']
    language = project_dict.get('language', 'hi')
    duration_mode = project_dict.get('duration_mode', 'medium')
    video_format = project_dict.get('video_format', 'landscape')

    logger.info(f"Generating script for topic: '{topic}' (Lang: {language}, Dur: {duration_mode}, Format: {video_format})")
    progress_cb(5.0, "Preparing to generate script...")

    # Check API key before starting
    llm_provider = get_setting("llm_provider") or "openai"
    api_key = get_setting("nvidia_api_key") if llm_provider == "nvidia" else get_setting("openai_api_key")
    if not api_key:
        raise ValueError(f"{llm_provider.title()} API key is missing. Please configure it in the settings panel.")

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
- CRITICAL: The 'visual_cue' field MUST ALWAYS be in ENGLISH, regardless of the script language. This is used as a search keyword for media APIs which only understand English.
- CRITICAL: All 'visual_meta' text fields MUST ALWAYS be in English.
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

    scriptwriter_rules = _skill_content("scriptwriter")
    script_rules_block = f"""=== WRITING RULES ===
{scriptwriter_rules}

""" if scriptwriter_rules else ""

    outline_system_prompt = f"""{script_rules_block}You are a master YouTube Video Director specializing in creating well-structured, engaging YouTube videos of exactly {target_duration} seconds.

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
Detail: "{prompt_desc}"

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

NO generic phrases, no clickbait, no assumptions or unverified claims. Be precise and factual."""

    # Optionally augment with web search context
    _web_ctx = _get_web_context_for_topic(f"{topic} - {prompt_desc}", "outline generation")
    if _web_ctx:
        outline_user_prompt += f"\n\nRelevant web context to inform your outline:\n{_web_ctx}"

    outline_data = _call_llm_json(outline_system_prompt, outline_user_prompt, OUTLINE_JSON_SCHEMA, cancel_event, activity_label="Script Outline")

    if cancel_event.is_set():
        raise InterruptedError("Cancelled")

    # 2. Generate Base (Intro & Conclusion)
    progress_cb(20.0, "Writing introduction & conclusion...")
    logger.info("Stage 2: Generating Intro & Conclusion...")
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

    scenes_array = []
    chapters = outline_data.get("chapters", [])
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

        scene_system_prompt = f"""{script_rules_block}You are a master YouTube Video Scriptwriter specializing in creating focused, informative scene narrations.

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

        # Optionally augment with scene-specific web search context
        _web_ctx = _get_web_context_for_topic(f"{topic}: {chapter_title} - {context}", "scene narration")
        if _web_ctx:
            scene_user_prompt += f"\n\nIncorporate relevant facts from this web search into your narration:\n{_web_ctx}"

        return runner.run_with_tools(
            scene_system_prompt, scene_user_prompt, SINGLE_SCENE_JSON_SCHEMA,
            base_activity_label="Scene Narration",
            allowed_tools=SCRIPT_NARRATION_TOOLS,
            max_turns=PIPELINE_SCRIPT_TURNS,
        )

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
    final_script = {
        "title": outline_data.get("title", topic),
        "introduction": base_data.get("introduction"),
        "scenes": scenes_array,
        "conclusion": base_data.get("conclusion")
    }

    # Repair LLM output: ensure text fields are strings (not nested objects/dicts)
    def _safe_str(val):
        """Convert a value to string if it isn't one already, handling nested dicts."""
        if isinstance(val, str):
            return val
        if isinstance(val, dict):
            # LLM sometimes returns {"text": "..."} or similar nested structure
            for key in ("text", "content", "value", "hook", "summary", "cta"):
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

    intro = final_script.get("introduction")
    if not isinstance(intro, dict):
        intro = {}
        final_script["introduction"] = intro
    intro["hook"] = _safe_str(intro.get("hook", ""))
    intro["transition"] = _safe_str(intro.get("transition", ""))

    conclusion = final_script.get("conclusion")
    if not isinstance(conclusion, dict):
        conclusion = {}
        final_script["conclusion"] = conclusion
    conclusion["summary"] = _safe_str(conclusion.get("summary", ""))
    conclusion["cta"] = _safe_str(conclusion.get("cta", ""))

    scenes = final_script.get("scenes")
    if not isinstance(scenes, list):
        scenes = []
        final_script["scenes"] = scenes

    for i in range(len(scenes)):
        if not isinstance(scenes[i], dict):
            scenes[i] = {}
        scenes[i]["narration"] = _safe_str(scenes[i].get("narration", ""))
        scenes[i]["title"] = _safe_str(scenes[i].get("title", ""))

    # Fallback: fill empty narration from chapter context (LLM sometimes skips it)
    for i, scene in enumerate(final_script.get("scenes", [])):
        if not scene.get("narration", "").strip():
            if i < len(chapters):
                fallback = f"{chapters[i].get('chapter_title', '')}: {chapters[i].get('scene_context', '')}"
                scene["narration"] = fallback.strip()
                logger.warning(f"Scene {i+1} had empty narration; filled from chapter context.")
    if not intro.get("hook", "").strip():
        intro["hook"] = topic  # fallback
    if not conclusion.get("summary", "").strip():
        conclusion["summary"] = f"In conclusion, {topic} remains a significant chapter in history."

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

    update_project(project_dict['id'], script_path=str(script_path))
    progress_cb(100.0, "Script generation complete!")
    logger.info(f"Script generated successfully and saved to: {script_path}")





def _skill_content(name: str) -> str:
    """Loads a skill's markdown body from the skill registry, or '' if missing."""
    from backend.agent.skill_loader import skill_loader
    skill = skill_loader.get_skill(name)
    return skill.content if skill else ""


def _visual_rules_legacy_fallback(video_format: str, language: str) -> str:
    """Hardcoded copy of the visual rules, used ONLY if the skill registry is unavailable."""
    return f"""
=== MAXIMIZE CREATIVITY & DYNAMIC VISUALS ===
Be extremely creative! Build a visually engaging video:
- If explaining a concept, build a 'custom_html' animation or a 'network' diagram.
- If making a claim, use a 'document' to flash dramatic evidence on screen.
- If showing data, use a dynamic 'list' or 'network'.
- Use 'visual_meta' to write evocative copy, inject dramatic headlines, and compose visually stunning overlays.

=== QUANTITY & TIMING ===
- Break narration into logical visual beats — one sub-visual per beat.
- Each sub-visual: 2-15 seconds. The sum MUST equal the Total Scene Duration.
- For 'list' type: create 1 sub-visual PER LIST ITEM.
- Vary transitions: subtle_slide, fade, slide_left, slide_right, slide_up, slide_down, zoom_in, zoom_out, glitch, none.

=== VALID VISUAL TYPES (USE ONLY THESE) ===
map | document | portrait | scene | image | youtube | parallax | network | list | custom_html | thread | device_mockup | ai_image

=== TYPE SELECTION GUIDE — CHOOSE THE RIGHT VISUAL ===
- list: Ranked items, countdowns, top-N lists, step-by-step. E.g. "Top 5", "How to".

- map: Geography, routes, locations, territories, borders.
- document: Factual claims, news events, classified archives, archival evidence. (See DOCUMENT RULES below.)

- network: Connections between people, organizations, relationships.
- portrait: Specific people or entities. visual_cue = person's EXACT FULL NAME only (used as Wikipedia search query). Do NOT add descriptive words — just the name. E.g. "Harshad Mehta", not "Harshad Mehta stockbroker".
- parallax: Dramatic visual reveals with layered 3D depth.
- custom_html: A FULL-SCREEN standalone visual type. See CRITICAL DISTINCTION below.
- thread: Simulated social media / chat conversations.
- device_mockup: Content inside a realistic device frame (iphone/macbook).
- scene/image/ai_image: Default fallback (ai_image = AI-generated via HuggingFace). visual_cue MUST be 1-3 broad keywords optimized for stock photo search engines (e.g. 'city neon' instead of 'a sprawling city with neon lights at night').
- youtube: Real-world footage.

=== ⚠️ CRITICAL DISTINCTION: custom_html (visual type) vs custom_html_ui (overlay) ===
These are TWO COMPLETELY DIFFERENT THINGS. DO NOT confuse them:

1. "custom_html" as visual_type:
   - This is a STANDALONE FULL-SCREEN VISUAL. It replaces the entire background.
   - Use when the ENTIRE visual should be a coded UI/animation (no background image/video).
   - Set visual_type = "custom_html" and visual_meta = {{"html": str, "css": str}}.
   - The HTML is rendered at 100% width/height as the main visual content.
   - Example use: An animated infographic, a stylized quote card, a dynamic data dashboard.

2. "custom_html_ui" as an OVERLAY inside visual_meta:
   - This is a TRANSPARENT OVERLAY that floats ON TOP of a background image/video.
   - The background comes from scene/image/portrait/parallax/youtube/ai_image.
   - Add it inside visual_meta: {{"custom_html_ui": {{"html": str, "css": str}}}}.
   - Example use: An animated label over a portrait, a styled stat counter over stock footage.
   - ONLY allowed on these types: scene, image, portrait, parallax, youtube, ai_image.

NEVER set visual_type = "custom_html" when you actually want an overlay on a background.
NEVER add custom_html_ui to data types (map, document, list, network, thread, device_mockup, custom_html).

=== DOCUMENT RULES (ARCHIVAL / EVIDENCE VISUALS) ===
- ALWAYS set "show_image": false in document visual_meta.
- DO NOT generate "image_url" or "image_caption" fields.
- The user will manually upload archival/evidence images themselves.
- Focus on writing compelling text content: headline, doc_text, highlight_text, pull_quote.

=== VISUAL META SCHEMAS (FILL CREATIVELY) ===
- scene/image/parallax/ai_image: {{}} (empty object). visual_cue = 1-3 stock photo keywords.
- portrait: {{"person_name": str}}. visual_cue = person's EXACT full name only.
- youtube: {{"start_offset": 15, "duration": 15, "skip_intro": true}}
- map: {{"map_style": "vintage", "locations": [{{"name": str, "coord": [lat, lon]}}]}} (2 locations)
- document: {{"title": str, "headline": str, "subtitle": str, "doc_text": str, "highlight_text": str, "source": str, "date": str, "section": str, "pull_quote": str, "show_image": false}} (NEVER set show_image to true — user adds images manually)
- network: {{"theme": "conspiracy_board"|"cyberpunk"|"corporate", "nodes": [{{"id": str, "label": str, "type": "person"|"entity"}}], "edges": [{{"source": str, "target": str}}]}}
- list: {{"number": int, "title": str, "description": str}}
- thread: {{"platform": "whatsapp"|"imessage"|"twitter"|"discord", "messages": [{{"sender": str, "text": str, "is_self": bool}}], "title": str}}
- device_mockup: {{"device": "iphone"|"macbook"}} (optional: "screen_image_url": str)
- custom_html: {{"html": str, "css": str}} (CRITICAL: Design for {video_format} orientation. Use raw CSS — no Tailwind. NOT a normal web page. Must look like a high-end video editor template with abundant smooth CSS animations.)

=== OVERLAY RULES ===
- custom_html_ui: Add {{"custom_html_ui": {{"html": str, "css": str}}}} inside visual_meta for custom overlays.
- ONLY FOR: scene, image, parallax, portrait, youtube, ai_image.
- NEVER FOR: custom_html, list, map, document, network, thread, device_mockup. For these types, bake all text directly into their specific visual_meta fields.
- custom_html_ui content text: Match the target language ({language}).

=== ANIMATION TIMING WITH WORD TIMESTAMPS ===
When word-level timestamps are provided (e.g. "market [1.2s] crashed [1.8s] today [2.3s]"), use them to precisely sync:
- CSS animation-delay values in custom_html and custom_html_ui visuals
- Text reveal animations timed to when specific words are spoken
- Data visualization build-up animations synced to narration beats
- Element entry/exit timings matching spoken content transitions
Example: If "GDP" is spoken at [2.3s], set animation-delay: 2.3s on the GDP text element.
When sub-visual duration breakdowns are provided, use the start offset and duration of each sub-visual to ensure animations fit within the allocated time window.

=== ANTI-HALLUCINATION ===
- DO NOT invent visual_meta fields not listed in the schemas above.
- DO NOT add fields like "background_color", "font_size", "animation", etc. to visual_meta unless they are part of the schema.
- The ONLY optional addition to visual_meta is "custom_html_ui" (and ONLY for allowed types).
- visual_cue MUST ALWAYS be in English.
- All visual_meta text content MUST be in English, EXCEPT custom_html_ui content which should match the target language.
"""


def _visual_rules_safety_net(video_format: str, language: str) -> str:
    """Shared rules not owned by any single visual-type skill."""
    return f"""
=== SHARED RULES (apply to every visual) ===
- visual_cue MUST ALWAYS be in English. Use 1-3 broad stock keywords for media types, the EXACT full name for portrait, or a short descriptive prompt for ai_image.
- All visual_meta text content MUST be in English, EXCEPT custom_html_ui content which must match the target language ({language}).
- custom_html / custom_html_ui: design for the {video_format} orientation (landscape 16:9, portrait 9:16, square 1:1) using responsive % widths, not fixed px.

=== ANIMATION TIMING WITH WORD TIMESTAMPS ===
When word-level timestamps are provided (e.g. "market [1.2s] crashed [1.8s] today [2.3s]"), use them to precisely sync:
- CSS animation-delay values in custom_html and custom_html_ui visuals
- Text reveal animations timed to when specific words are spoken
- Data visualization build-up animations synced to narration beats
- Element entry/exit timings matching spoken content transitions
Example: If "GDP" is spoken at [2.3s], set animation-delay: 2.3s on the GDP text element.
When sub-visual duration breakdowns are provided, use the start offset and duration of each sub-visual to ensure animations fit within the allocated time window.

=== ANTI-HALLUCINATION ===
- DO NOT invent visual_meta fields not listed in the schemas above.
- DO NOT add fields like "background_color", "font_size", "animation", etc. to visual_meta unless they are part of the schema.
- The ONLY optional addition to visual_meta is "custom_html_ui" (and ONLY for allowed types).
- visual_cue MUST ALWAYS be in English.
- All visual_meta text content MUST be in English, EXCEPT custom_html_ui content which should match the target language ({language}).
"""


def get_shared_visual_rules(video_format: str, language: str = "hi") -> str:
    """Centralized visual generation rules shared by ai.py and bridge.py.

    Built from the skill registry — visual-director-core plus every
    visual-type-* skill — which is the SINGLE SOURCE OF TRUTH. Falls back to a
    hardcoded copy only if the skill registry is missing or broken, so the
    prompts never go empty.
    """
    from backend.agent.skill_loader import skill_loader

    core = skill_loader.get_skill("visual-director-core")
    type_skills = sorted(
        name for name in skill_loader.get_all_skills()
        if name.startswith("visual-type-")
    )
    type_parts = []
    for name in type_skills:
        skill = skill_loader.get_skill(name)
        if skill:
            type_parts.append(skill.content)

    if core is not None and len(type_parts) >= 10:
        parts = [core.content] + type_parts
        return "\n\n".join(parts) + "\n\n" + _visual_rules_safety_net(video_format, language)

    logger.warning(
        f"Skill registry incomplete (core={core is not None}, "
        f"type_skills={len(type_parts)}/{len(type_skills)}). "
        "Falling back to hardcoded visual rules."
    )
    return _visual_rules_legacy_fallback(video_format, language)


def generate_visuals_pipeline(project_dict, project_dir, progress_cb, cancel_event):
    from backend.database.db import get_setting, update_project, get_project
    from backend.core.logger import logger

    script_path = project_dir / "script.json"
    manifest_path = Path(project_dict.get('assets_manifest_path', project_dir / "voiceover" / "manifest.json"))
    transcription_path = Path(project_dict.get('transcription_path', project_dir / "subtitles" / "transcription.json"))

    if not script_path.exists():
        raise FileNotFoundError("script.json is missing.")
    if not manifest_path.exists():
        raise FileNotFoundError("manifest.json is missing.")

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
    editor_qa_rules = _skill_content("editor-qa")
    editor_qa_block = f"""=== EDITOR QA GUARDRAILS ===
{editor_qa_rules}

""" if editor_qa_rules else ""

    visuals_system_prompt = f"""{editor_qa_block}You are an expert AI Visual Director for YouTube videos.

CORE MISSION:
Transform narration into compelling visual sequences that enhance the message.
{design_system_text}
CRITICAL RULES:
- COUNT: One sub-visual per visual beat
- DURATION: Each 2-15 seconds, sum MUST equal scene duration
- TRANSITION: Vary transitions — never repeat the same one
- visual_cue: ALWAYS in English. MUST be 1-3 broad keywords optimized for stock photo search engines (e.g. 'city neon' instead of 'a sprawling city with neon lights'). Do not use complex sentences.
- visual_meta text: ALWAYS in English
- custom_html_ui content: Match the target language from the user prompt

OUTPUT STRUCTURE:
Return ONLY valid JSON matching VISUALS_ARRAY_SCHEMA:
{{"sub_visuals": [{{"visual_type": "...", "visual_cue": "...", "transition": "...", "visual_meta": {{...}}, "duration": 3.5}}]}}

ERROR PREVENTION:
- Duration sum must equal exactly the provided scene duration (2 decimal places)
- Use only valid visual types
- All JSON numbers as numbers, not strings
- All required fields present for each visual type

FINAL CHECK before submitting:
1. Duration sum equals scene duration
2. All visual_cue are English
3. visual_meta fields match the type's schema
4. Transitions are all different
5. No markdown — raw JSON only

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
        existing_sub_visuals = entry.get("sub_visuals", [])

        # Migrate legacy sub-visuals whose visual types were removed from the
        # app (chart/timeline): swap them for a neutral scene entry that keeps
        # the duration slot and renders normally.
        existing_sub_visuals = [
            {"visual_type": "scene", "visual_cue": v.get("visual_cue") or scene_title,
             "transition": "fade", "visual_meta": {}, "duration": v.get("duration", 0)}
            if v.get("visual_type") in REMOVED_VISUAL_TYPES else v
            for v in existing_sub_visuals
        ]

        # Compute narration hash for change-detection: when narration changes,
        # we must regenerate even if sub-visuals exist from a previous run.
        narration_hash = hashlib.md5(narration.encode("utf-8")).hexdigest()[:12]
        stored_hash = entry.get("_narr_hash", "")

        # Check if existing sub-visuals are valid (not just a single blank default generated by tts.py)
        is_default = False
        if len(existing_sub_visuals) == 1:
            v = existing_sub_visuals[0]
            if v.get("visual_type") == "scene" and v.get("visual_cue") == scene_title and not v.get("visual_meta"):
                is_default = True

        narration_changed = (stored_hash and stored_hash != narration_hash)
        
        stored_design_hash = entry.get("_design_hash", "")
        design_changed = (stored_design_hash and stored_design_hash != current_design_hash)

        if existing_sub_visuals and not is_default and not narration_changed and not design_changed and not is_new_design:
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
            _throttled_progress(base_prog + (completed / total_scenes) * (90.0 - base_prog), f"Preserved visual cues... {completed}/{total_scenes}")
            return entry
        # --- End Smart Preservation Logic ---

        user_prompt = f"""Topic: "{topic}"
Scene: {scene_title} ({scene_type})
Total Scene Duration: {duration} seconds

Narration:
{narration}
{word_timings}
Generate the sub_visuals array. The sum of 'duration' for all sub_visuals MUST exactly equal {duration} seconds."""

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
            entry["sub_visuals"] = [{"visual_type": "scene", "visual_cue": scene_title, "transition": "fade", "visual_meta": {}, "duration": duration}]
            entry["_narr_hash"] = narration_hash
            entry["_design_hash"] = current_design_hash

        with _progress_lock:
            completed += 1
        base_prog = 15.0 if is_new_design else 10.0
        _throttled_progress(base_prog + (completed / total_scenes) * (90.0 - base_prog), f"Generated visual cues... {completed}/{total_scenes}")
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
        script["introduction"]["sub_visuals"] = manifest_intro.get("sub_visuals", [])

    # Scenes
    for i, sc in enumerate(script_scenes):
        if i < len(manifest_scenes):
            sc["sub_visuals"] = manifest_scenes[i].get("sub_visuals", [])

    # Conclusion
    manifest_conclusion = next((m for m in manifest if m.get("section_type") == "conclusion"), None)
    if manifest_conclusion and "conclusion" in script:
        script["conclusion"]["sub_visuals"] = manifest_conclusion.get("sub_visuals", [])

    with open(script_path, "w", encoding="utf-8") as f:
        json.dump(script, f, indent=2, ensure_ascii=False)

    progress_cb(100.0, "Visual generation complete!")
    logger.info("Visual generation pipeline completed successfully.")



