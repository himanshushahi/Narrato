import concurrent.futures
import json
import re
import requests
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
            "Output ONLY the raw query text — no explanation, no quotes, no punctuation."
        )
        user_prompt = f"Section: {stage}\nTopic: {context_description}\nSearch query:"

        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            max_tokens=50,
            temperature=0.3,
            stream=False,
        )

        query = resp.choices[0].message.content.strip().strip('"').strip("'")
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
            "enum": ["chart", "map", "document", "portrait", "scene", "image", "youtube", "parallax", "network", "list", "custom_html"]
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
                    "historical_context": {"type": "string"}
                },
                "required": ["scene_number", "chapter_title", "historical_context"]
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
    """Escapes raw double quotes inside string fields in JSON string."""
    keys_pattern = r'("(?:title|hook|visual_cue|visual_type|transition|visual_meta|scene_number|narration|summary|cta|introduction|scenes|conclusion)")\s*:\s*'
    matches = list(re.finditer(keys_pattern, s))
    if not matches:
        return s
        
    segments = []
    prev_end = 0
    
    for i, match in enumerate(matches):
        segments.append(s[prev_end:match.start()])
        key_colon = match.group(0)
        segments.append(key_colon)
        
        value_start = match.end()
        if i + 1 < len(matches):
            value_end = matches[i+1].start()
        else:
            value_end = len(s)
            
        value_segment = s[value_start:value_end]
        
        val_stripped = value_segment.strip()
        if val_stripped.startswith('"'):
            first_quote_idx = value_segment.find('"')
            last_quote_idx = value_segment.rfind('"')
            
            if first_quote_idx != -1 and last_quote_idx != -1 and first_quote_idx < last_quote_idx:
                content = value_segment[first_quote_idx + 1 : last_quote_idx]
                
                escaped_content = []
                j = 0
                n_c = len(content)
                while j < n_c:
                    if content[j] == '"':
                        if j > 0 and content[j-1] == '\\':
                            escaped_content.append(content[j])
                        else:
                            escaped_content.append('\\"')
                    else:
                        escaped_content.append(content[j])
                    j += 1
                    
                cleaned_val = (
                    value_segment[:first_quote_idx] +
                    '"' + "".join(escaped_content) + '"' +
                    value_segment[last_quote_idx + 1:]
                )
                segments.append(cleaned_val)
            else:
                segments.append(value_segment)
        else:
            segments.append(value_segment)
            
        prev_end = value_end
        
    return "".join(segments)

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
    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", clean_text, re.DOTALL | re.IGNORECASE)
    if match:
        clean_text = match.group(1)
    else:
        start_idx = clean_text.find('{')
        if start_idx != -1:
            clean_text = clean_text[start_idx:]
            
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
        import ast
        return ast.literal_eval(repaired_val)
    except Exception:
        pass
        
    logger.error(f"Failed all JSON parsing attempts. Raw response length: {len(raw_response)}")
    raise ValueError("LLM response could not be parsed into valid JSON.")



def _call_llm_json(system_prompt, user_prompt, schema, cancel_event):
    from backend.database.db import get_setting
    from openai import OpenAI
    import openai
    
    llm_provider = get_setting("llm_provider") or "openai"
    
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
    
    logger.info(f"LLM Call: Provider={llm_provider}, Model={model}, BaseURL={base_url}")
    
    if not api_key:
        raise ValueError(f"{llm_provider.title()} API key is missing. Please configure it in the settings panel.")
        
    client = OpenAI(
        api_key=api_key,
        base_url=base_url.rstrip('/') if base_url else None
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
    
    if llm_provider == "nvidia":
        kwargs["extra_body"] = {"guided_json": schema}
    else:
        kwargs["response_format"] = {"type": "json_object"}

    if cancel_event.is_set():
        raise InterruptedError("Cancelled")

    max_retries = 5
    for attempt in range(max_retries):
        if cancel_event.is_set():
            raise InterruptedError("Cancelled")
        try:
            logger.info(f"Sending LLM request via OpenAI SDK (Attempt {attempt+1}/{max_retries})...")
            
            response_stream = client.chat.completions.create(**kwargs)
            
            raw_content = ""
            for chunk in response_stream:
                if cancel_event.is_set():
                    response_stream.close()
                    raise InterruptedError("Cancelled")
                if chunk.choices and len(chunk.choices) > 0:
                    delta_content = chunk.choices[0].delta.content
                    if delta_content:
                        raw_content += delta_content
                        
            if not raw_content.strip():
                raise ValueError("API returned an empty response. It may have failed internally.")
                
            parsed_json = clean_json_response(raw_content)
            
            if cancel_event.is_set():
                raise InterruptedError("Cancelled")
                
            return parsed_json
            
        except openai.RateLimitError as e:
            if attempt < max_retries - 1:
                import time
                import random
                sleep_time = (2 ** attempt) + random.uniform(0, 1)
                logger.warning(f"Rate limited (429). Retrying in {sleep_time:.2f}s... (Attempt {attempt+1}/{max_retries})")
                time.sleep(sleep_time)
            else:
                raise e
        except openai.BadRequestError as e:
            if attempt < max_retries - 1 and "response_format" in kwargs:
                logger.warning(f"Provider rejected request (HTTP 400). It might not support response_format. Stripping it and retrying... (Attempt {attempt+1}/{max_retries})")
                del kwargs["response_format"]
                import time
                time.sleep(1.0)
            else:
                try:
                    logger.error(f"Bad Request Error: {e.response.text if hasattr(e, 'response') else e}")
                except Exception:
                    pass
                if attempt >= max_retries - 1:
                    raise e
                import time
                time.sleep(2.0)
        except Exception as e:
            if attempt < max_retries - 1:
                logger.warning(f"LLM request or parsing failed ({type(e).__name__}: {e}). Retrying... (Attempt {attempt+1}/{max_retries})")
                import time
                time.sleep(2.0)
            else:
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
    outline_system_prompt = f"""You are a master YouTube Video Director.
Your task is to outline a video that runs approximately {target_duration} seconds.
Break the story down chronologically into exactly {min_scenes} to {max_scenes} chapters, balancing them so each chapter gets roughly equal screen time.
Return ONLY valid JSON matching the provided schema. No markdown backticks.
{lang_instruction}"""
    
    outline_user_prompt = f"""Topic: "{topic}"
Detail: "{prompt_desc}"
Generate a {min_scenes} to {max_scenes} chapter outline."""

    # Optionally augment with web search context
    _search_q = _generate_search_query(f"{topic} - {prompt_desc}", "outline generation")
    _web_ctx = _get_web_context(_search_q)
    if _web_ctx:
        outline_user_prompt += f"\n\nRelevant web context to inform your outline:\n{_web_ctx}"

    outline_data = _call_llm_json(outline_system_prompt, outline_user_prompt, OUTLINE_JSON_SCHEMA, cancel_event)
    
    # 2. Generate Base (Intro & Conclusion)
    progress_cb(20.0, "Writing introduction & conclusion...")
    logger.info("Stage 2: Generating Intro & Conclusion...")
    base_system_prompt = f"""You are a master YouTube Video Scriptwriter.
Write the introduction (hook) and the conclusion (summary and call to action) for this video based on the provided outline.
Return ONLY valid JSON matching the provided schema. No markdown backticks.
{lang_instruction}
{narration_emphasis}

LENGTH CONSTRAINT: The hook should be about 5-8 seconds of spoken audio. The summary and cta should each be about 5-8 seconds. Keep them tight and engaging.

CRITICAL — LANGUAGE OUTPUT RULE:
You MUST write ALL spoken text (hook, summary, cta) in language code '{language}'.
If '{language}' is NOT 'en', that means do NOT write in English — write in the native script of that language instead.
The outline below is reference-only and may be in English. Your output MUST be in '{language}'."""

    outline_json_str = json.dumps(outline_data, ensure_ascii=False)
    base_user_prompt = f"""Topic: "{topic}"
Outline: {outline_json_str}
Write the introduction and conclusion."""

    # Optionally augment with web search context
    _search_q = _generate_search_query(f"{topic} - latest developments and background", "introduction & conclusion")
    _web_ctx = _get_web_context(_search_q)
    if _web_ctx:
        base_user_prompt += f"\n\nWeb search reference (translate into {language}):\n{_web_ctx}"

    base_data = _call_llm_json(base_system_prompt, base_user_prompt, BASE_SCRIPT_JSON_SCHEMA, cancel_event)

    # 3. Generate Scenes in Loop
    progress_cb(30.0, "Drafting scene narratives...")
    logger.info("Stage 3: Generating Scenes...")
    
    scenes_array = []
    chapters = outline_data.get("chapters", [])
    total_chapters = len(chapters)

    # Recalculate per-scene duration based on actual chapter count from outline
    actual_count = total_chapters or max_scenes  # fallback if outline produced 0 chapters
    per_scene_duration = max(5, (target_duration - 15) // actual_count)
    per_scene_word_target = max(10, int(per_scene_duration * 2.5))  # ~2.5 words/sec speaking rate
    
    def generate_single_scene(idx, chapter):
        scene_num = chapter.get("scene_number", idx + 1)
        chapter_title = chapter.get("chapter_title", f"Scene {scene_num}")
        context = chapter.get("historical_context", "")
        
        prev_context = ""
        if idx > 0:
            prev_chap = chapters[idx - 1]
            prev_context = f"Previous Scene ({prev_chap.get('scene_number')}): {prev_chap.get('chapter_title')} - {prev_chap.get('historical_context')}"
        
        scene_system_prompt = f"""You are a master YouTube Video Scriptwriter.
You are writing ONE specific scene (Scene {scene_num}: {chapter_title}) for a video.
Return ONLY valid JSON matching the provided schema. No markdown backticks.
{lang_instruction}
{narration_emphasis}

SCENE LENGTH CONSTRAINT: This scene's narration must be approximately {per_scene_duration} seconds of spoken audio (roughly {per_scene_word_target} words). Be concise and cover only what's essential for this segment."""

        scene_user_prompt = f"""Topic: "{topic}"
This Scene: Scene {scene_num}: {chapter_title}
Context for this scene: {context}
{prev_context}
Write the narration for this scene."""

        # Optionally augment with scene-specific web search context
        _scene_q = _generate_search_query(f"{topic}: {chapter_title} - {context}", "scene narration")
        _web_ctx = _get_web_context(_scene_q)
        if _web_ctx:
            scene_user_prompt += f"\n\nIncorporate relevant facts from this web search into your narration:\n{_web_ctx}"

        import time
        
        # Staggered delay to prevent rate limit spikes for all providers
        time.sleep(idx * 2.0)

        return _call_llm_json(scene_system_prompt, scene_user_prompt, SINGLE_SCENE_JSON_SCHEMA, cancel_event)

    # Use max_workers=1 to process sequentially and avoid strict concurrent request limits
    # (NVIDIA NIM, Groq, and other APIs often limit concurrent requests to 1 on free/standard tiers)
    max_workers = 1
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_idx = {executor.submit(generate_single_scene, i, chapter): i for i, chapter in enumerate(chapters)}
        
        results = [None] * total_chapters
        completed = 0
        
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
                fallback = f"{chapters[i].get('chapter_title', '')}: {chapters[i].get('historical_context', '')}"
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

    script_path = project_dir / "script.json"
    with open(script_path, "w", encoding="utf-8") as f:
        json.dump(final_script, f, indent=2, ensure_ascii=False)

    update_project(project_dict['id'], script_path=str(script_path))
    progress_cb(100.0, "Script generation complete!")
    logger.info(f"Script generated successfully and saved to: {script_path}")


def generate_chart_data(prompt):
    """Generates JSON chart data using the configured LLM based on user prompt."""
    logger.info(f"Generating chart data for prompt: '{prompt}'")
    
    llm_provider = get_setting("llm_provider") or "openai"
    
    if llm_provider == "nvidia":
        api_key = get_setting("nvidia_api_key")
        base_url = get_setting("nvidia_base_url") or "https://integrate.api.nvidia.com/v1"
        model = get_setting("nvidia_model") or "meta/llama-3.1-8b-instruct"
    else:
        api_key = get_setting("openai_api_key")
        base_url = get_setting("openai_base_url") or "https://api.openai.com/v1"
        model = get_setting("openai_model") or "gpt-4o"

    if not api_key:
        return {"success": False, "error": f"{llm_provider.title()} API key is missing. Please configure it in settings."}

    system_prompt = """You are an expert data analyst and researcher.
Your task is to generate realistic, accurate, or highly plausible chart data based on the user's prompt.
You must return your output strictly as a JSON object containing a "data" array. No markdown backticks, no explanations.

CRITICAL JSON SCHEMA:
{
  "chart_type": "bar", "line", or "pie",
  "title": "A short, punchy title for this chart (max 5 words)",
  "data": [
    { "label": "Short Label 1", "value": 100 },
    { "label": "Short Label 2", "value": 250 }
  ]
}

RULES:
1. Provide between 4 and 15 data points.
2. "label" must be short (e.g. Years, Names, Categories).
3. "value" MUST be a number (integer or float). Do NOT use strings for values. Do NOT add commas or symbols like $ or %.
4. Return ONLY valid JSON.
"""

    user_prompt = f"Generate chart data for this topic: '{prompt}'"
    
    from openai import OpenAI
    import openai
    
    client = OpenAI(
        api_key=api_key,
        base_url=base_url.rstrip('/') if base_url else None
    )

    try:
        kwargs = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "temperature": 0.7
        }

        if llm_provider == "nvidia":
            schema = {
                "type": "object",
                "properties": {
                    "chart_type": {"type": "string"},
                    "title": {"type": "string"},
                    "data": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "label": {"type": "string"},
                                "value": {"type": "number"}
                            },
                            "required": ["label", "value"]
                        }
                    }
                },
                "required": ["chart_type", "title", "data"]
            }
            kwargs["extra_body"] = {"guided_json": schema}
        else:
            kwargs["response_format"] = {"type": "json_object"}

        logger.info(f"Sending LLM chart request via OpenAI SDK with model {model}...")
        response = client.chat.completions.create(**kwargs)
        raw_content = response.choices[0].message.content
        
        parsed_json = clean_json_response(raw_content)
        
        # Ensure array exists
        if "data" not in parsed_json or not isinstance(parsed_json["data"], list):
            raise ValueError("LLM did not return a 'data' array.")
            
        return {
            "success": True, 
            "data": parsed_json["data"], 
            "title": parsed_json.get("title", prompt.upper()[:30]),
            "chart_type": parsed_json.get("chart_type", "bar")
        }
    except Exception as e:
        logger.error(f"Failed to generate AI chart data: {e}")
        return {"success": False, "error": str(e)}


def generate_visuals_pipeline(project_dict, project_dir, progress_cb, cancel_event):
    from backend.database.db import get_setting, update_project
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
        
    # Optional: Read transcription to provide word-level timings to the AI
    transcription = {}
    if transcription_path.exists():
        with open(transcription_path, "r", encoding="utf-8") as f:
            transcription = json.load(f)
            
    topic = project_dict['name']
    language = project_dict.get('language', 'hi')
    
    progress_cb(10.0, "Preparing to generate visuals...")
    logger.info("Starting Visuals Generation Pipeline...")
    
    visual_rules = """
SUB-VISUALS: You must generate a `sub_visuals` array containing visual cues to match the spoken narration.

=== MAXIMIZE CREATIVITY & DYNAMIC VISUALS ===
Be extremely creative! Do not just write simple text or rely solely on basic 'scene' types. Build a visually engaging video:
- If explaining a concept, build a 'custom_html' animation or a 'network' diagram.
- If making a claim, use a 'document' to flash dramatic evidence on screen.
- If showing data, use a dynamic 'chart'.
- Use the 'visual_meta' field to write evocative copy, inject dramatic headlines, and compose visually stunning overlays that directly complement the emotional and informational beat of the script. Feel free to hallucinate highly specific and thematic meta content.

=== TYPE SELECTION GUIDE — CHOOSE THE RIGHT VISUAL FOR THE CONTENT ===
- list: For ranked items, countdowns, top-N lists, factual lists, or step-by-step rankings.
- chart: For statistics, percentages, comparisons, or data trends.
- map: For geography, routes, locations, territories, borders.
- document: For historical claims, news events, classified archives, factual evidence.
- network: For connections between people, organizations, relationships.
- portrait: For introducing real specific people or places.
- parallax: For dramatic visual reveals with layered depth.
- custom_html: For highly customized, creative typography layouts or custom animations. Use your CSS/HTML skills!
- scene/image: Default fallback.
- youtube: For real-world footage other than portraits.

QUANTITY: Let the narration length and pacing dictate how many sub-visuals to generate. Break the narration into logical visual beats and create one sub-visual per beat. Each sub-visual should have a meaningful duration (2-15 seconds) — enough for the viewer to absorb it. The sum of all durations MUST equal the provided Total Scene Duration. For 'list' type: create 1 sub-visual PER LIST ITEM.

EACH sub_visual: {"visual_type": str, "visual_cue": str (English keyword), "transition": str, "visual_meta": dict, "duration": float}
CRITICAL ON TRANSITIONS: Choose from 'subtle_slide', 'fade', 'slide_left', 'slide_right', 'slide_up', 'slide_down', 'zoom_in', 'zoom_out', 'glitch', 'none'. Do NOT use the same transition repeatedly! Vary the transitions to make the video dynamic.
CRITICAL ON DURATION: 
- Each sub_visual MUST have a precise "duration" (in seconds).
- The SUM of the durations of all sub_visuals MUST equal the provided Total Scene Duration.

=== VISUAL META SCHEMAS (FILL THESE CREATIVELY) ===
- scene/image/parallax: visual_meta {} (portrait may add {"person_name": str})
- PORTRAIT CRITICAL: visual_cue must be ONLY the entity's exact name.
- youtube: visual_meta {"start_offset": 15, "duration": 15, "skip_intro": true}
- chart: visual_meta {"chart_type": "bar"|"line"|"pie", "title": str, "data": [{"label": str, "value": number}]}
- map: visual_meta {"map_style": "vintage", "locations": [{"name": str, "coord": [lat, lon]}]} (2 locations)
- document: visual_meta {"title": str, "headline": str, "subtitle": str, "doc_text": str, "highlight_text": str, "source": str, "date": str, "section": str, "pull_quote": str, "show_image": bool, "image_url": str, "image_caption": str}
- network: visual_meta {"theme": "conspiracy_board"|"cyberpunk"|"corporate", "nodes": [{"id": str, "label": str, "type": "person"|"entity"}], "edges": [{"source": str, "target": str}]}
- list: visual_meta {"number": int, "title": str, "description": str}
- custom_html: visual_meta {"html": str, "css": str} (Note: your HTML is injected into a 100% width/height relative wrapper div. Avoid using Tailwind classes as they are not loaded. Write raw CSS. Do not assume the body is the parent.)
- Any type: add {"lower_third": {"title": str, "subtitle": str}} for overlay text.
"""
    
    visuals_system_prompt = f"""You are an expert Visual Director for a YouTube Video.
You are given a transcribed narration and its exact duration.
Generate visual cues with precise 'duration' values matching the spoken words.
Return ONLY valid JSON matching the provided schema. No markdown backticks.
CRITICAL: The 'visual_cue' field MUST ALWAYS be in ENGLISH.
{visual_rules}"""

    total_scenes = len(manifest)
    completed = 0
    
    # Load transcription for precise word-level timings
    transcription_path = Path(project_dir) / "transcription.json"
    transcription_data = None
    if transcription_path.exists():
        try:
            with open(transcription_path, "r", encoding="utf-8") as f:
                transcription_data = json.load(f)
        except Exception as e:
            logger.error(f"Failed to load transcription: {e}")

    cumulative_time = 0.0
    
    # Process each scene sequentially
    for i, entry in enumerate(manifest):
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
                    w_end = w.get("end", 0)
                    if w_start >= cumulative_time and w_start < cumulative_time + duration:
                        words_in_scene.append(f"{w.get('word', '').strip()} [{w_start - cumulative_time:.1f}s]")
            if words_in_scene:
                word_timings = "\nExact Spoken Words with Timestamps (Seconds from Scene Start):\n" + " ".join(words_in_scene) + "\n"

        cumulative_time += duration
        
        # --- Smart Preservation Logic ---
        existing_sub_visuals = entry.get("sub_visuals", [])
        
        # Check if existing sub-visuals are valid (not just a single blank default generated by tts.py)
        is_default = False
        if len(existing_sub_visuals) == 1:
            v = existing_sub_visuals[0]
            if v.get("visual_type") == "scene" and v.get("visual_cue") == scene_title and not v.get("visual_meta"):
                is_default = True
                
        if existing_sub_visuals and not is_default:
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
            completed += 1
            progress_cb(10.0 + (completed / total_scenes) * 80.0, f"Preserved visual cues... {completed}/{total_scenes}")
            continue
        # --- End Smart Preservation Logic ---
        
        user_prompt = f"""Topic: "{topic}"
Scene: {scene_title} ({scene_type})
Total Scene Duration: {duration} seconds

Narration:
{narration}
{word_timings}
Generate the sub_visuals array. The sum of 'duration' for all sub_visuals MUST exactly equal {duration} seconds."""

        import time
        time.sleep(1.0)
        
        try:
            visuals_data = _call_llm_json(visuals_system_prompt, user_prompt, VISUALS_ARRAY_SCHEMA, cancel_event)
            
            valid_types = {"chart", "map", "document", "portrait", "scene", "image", "youtube", "parallax", "network", "list", "custom_html"}
            for sv in visuals_data.get("sub_visuals", []):
                v_type = str(sv.get("visual_type", "")).lower()
                if v_type not in valid_types:
                    if "parallax" in v_type: sv["visual_type"] = "parallax"
                    elif "portrait" in v_type: sv["visual_type"] = "portrait"
                    elif "chart" in v_type: sv["visual_type"] = "chart"
                    elif "map" in v_type: sv["visual_type"] = "map"
                    elif "network" in v_type: sv["visual_type"] = "network"
                    elif "document" in v_type: sv["visual_type"] = "document"
                    elif "youtube" in v_type or "video" in v_type: sv["visual_type"] = "youtube"
                    elif "list" in v_type: sv["visual_type"] = "list"
                    elif "html" in v_type: sv["visual_type"] = "custom_html"
                    elif "image" in v_type: sv["visual_type"] = "image"
                    else: sv["visual_type"] = "scene"

            entry["sub_visuals"] = visuals_data.get("sub_visuals", [])
        except Exception as e:
            logger.error(f"Failed to generate visuals for scene {i}: {e}")
            entry["sub_visuals"] = [{"visual_type": "scene", "visual_cue": scene_title, "transition": "fade", "visual_meta": {}, "duration": duration}]
            
        completed += 1
        progress_cb(10.0 + (completed / total_scenes) * 80.0, f"Generating visual cues... {completed}/{total_scenes}")

    # Write back to manifest
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



