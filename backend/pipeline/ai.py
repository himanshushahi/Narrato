import concurrent.futures
import json
import re
import requests
from backend.database.db import get_setting, update_project
from backend.core.logger import logger
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
import html

# Schema for individual sub-visual entries
SUB_VISUAL_SCHEMA = {
    "type": "object",
    "properties": {
        "visual_cue": {"type": "string"},
        "visual_type": {"type": "string"},
        "transition": {"type": "string"},
        "visual_meta": {"type": "object"}
    },
    "required": ["visual_cue", "visual_type", "transition"]
}

# Schema validations for JSON parsing
INTRO_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "hook": {"type": "string"},
        "sub_visuals": {
            "type": "array",
            "items": SUB_VISUAL_SCHEMA
        }
    },
    "required": ["hook", "sub_visuals"]
}

SCENE_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "scene_number": {"type": "integer"},
        "title": {"type": "string"},
        "narration": {"type": "string"},
        "sub_visuals": {
            "type": "array",
            "items": SUB_VISUAL_SCHEMA
        }
    },
    "required": ["scene_number", "title", "narration", "sub_visuals"]
}

CONCLUSION_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "cta": {"type": "string"},
        "sub_visuals": {
            "type": "array",
            "items": SUB_VISUAL_SCHEMA
        }
    },
    "required": ["summary", "cta", "sub_visuals"]
}

SCRIPT_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "introduction": INTRO_JSON_SCHEMA,
        "scenes": {
            "type": "array",
            "items": SCENE_JSON_SCHEMA
        },
        "conclusion": CONCLUSION_JSON_SCHEMA
    },
    "required": ["title", "introduction", "scenes", "conclusion"]
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
        "introduction": INTRO_JSON_SCHEMA,
        "conclusion": CONCLUSION_JSON_SCHEMA
    },
    "required": ["introduction", "conclusion"]
}

SINGLE_SCENE_JSON_SCHEMA = SCENE_JSON_SCHEMA

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

def fetch_real_news(query):
    """Fetches real news using Google News RSS."""
    try:
        url = 'https://news.google.com/rss/search?q=' + urllib.parse.quote(query) + '&hl=en-US&gl=US&ceid=US:en'
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        xml_data = urllib.request.urlopen(req, timeout=10).read()
        root = ET.fromstring(xml_data)
        item = root.find('.//item')
        if item is not None:
            title = item.find('title').text if item.find('title') is not None else ""
            title = html.unescape(title)
            source_el = item.find('source')
            source = source_el.text if source_el is not None else "THE DAILY CHRONICLE"
            source = html.unescape(source)
            desc = item.find('description').text if item.find('description') is not None else ""
            
            desc_clean = re.sub(r'<[^>]+>', ' ', desc)
            desc_clean = html.unescape(desc_clean)
            desc_clean = re.sub(r'\s+', ' ', desc_clean).strip()
            
            headline = title
            if source and title.endswith(f" - {source}"):
                headline = title[:-(len(source) + 3)]
                
            return {
                "title": source.upper(),
                "doc_text": headline + "\n\n" + desc_clean,
                "headline": headline,
                "snippet": desc_clean[:400] + "..." if len(desc_clean) > 400 else desc_clean,
                "source": source
            }
    except Exception as e:
        logger.warning(f"Failed to fetch real news for query '{query}': {e}")
    return None

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
            target_minutes = 1
            min_scenes = 4
            max_scenes = 6
            sentence_rule = "Write narration in very short, punchy sentences (15-20 words per scene) to keep visual pacing extremely fast."
        elif duration_mode == "long": # 2 mins
            target_minutes = 2
            min_scenes = 8
            max_scenes = 12
            sentence_rule = "Write narration in short sentences (20-30 words per scene) for a fast-paced vertical video."
        else: # medium (90s)
            target_minutes = 1.5
            min_scenes = 6
            max_scenes = 8
            sentence_rule = "Write narration in quick sentences (20-25 words per scene)."
    else:
        if duration_mode == "extra_long":
            target_minutes = 15
            min_scenes = 55
            max_scenes = 65
            sentence_rule = "Write detailed narration paragraphs (40-60 words per scene)."
        elif duration_mode == "long":
            target_minutes = 10
            min_scenes = 35
            max_scenes = 45
            sentence_rule = "Write detailed narration paragraphs (35-50 words per scene)."
        else: # medium
            target_minutes = 5
            min_scenes = 18
            max_scenes = 24
            sentence_rule = "Write engaging narration (30-40 words per scene)."
        
    lang_instruction = f"""LANGUAGE RULES:
- The spoken text (hook, narration, summary, cta) MUST be written in the native script of the requested language (code: '{language}'). 
  For example, if the language is Hindi ('hi'), you MUST use the Devanagari script. Do NOT use English alphabet transliterations.
- The 'title' and 'chapter_title' fields can be in the requested language.
- CRITICAL: The 'visual_cue' field MUST ALWAYS be in ENGLISH, regardless of the script language. This is used as a search keyword for media APIs which only understand English.
- CRITICAL: All 'visual_meta' text fields MUST ALWAYS be in English.
"""

    visual_rules = """
SUB-VISUALS: Every scene, intro & conclusion needs a `sub_visuals` array.

=== TYPE SELECTION GUIDE — CHOOSE THE RIGHT VISUAL FOR THE CONTENT ===
- list: USE THIS when the narration enumerates ranked items, countdowns, top-N lists, factual lists, or step-by-step rankings (e.g. "Top 5 rivers", "3 reasons why", "countdown of events"). Each item = its own sub-visual.
- chart: USE THIS when the narration contains statistics, percentages, comparisons, or data trends (e.g. "GDP grew 15%", "population comparison").
- map: USE THIS when discussing geography, routes, locations, territories, borders, or movement between places (e.g. "Alexander's march", "Viking trade routes").
- document: USE THIS for historical claims, news events, classified archives, newspaper-style reveals, or documentary evidence.
- network: USE THIS for connections between people, organizations, relationships, conspiracy boards, or criminal networks.
- portrait: USE THIS when introducing or focusing on a specific historical figure or person.
- parallax: USE THIS for dramatic visual reveals with layered depth (background + foreground separation).
- custom_html: USE THIS for highly customized typography layouts, raw HTML/CSS art, unique dynamic flexboxes, or custom animations not covered by other types.
- scene/image: Default visual support for general narration, atmosphere, establishing shots.
- youtube: ONLY when the narration references specific video footage, interviews, or archival news clips.

QUANTITY: 2-4 items for MEDIA types (scene/image/parallax/portrait/youtube). Exactly 1 for PROGRAMMATIC types (chart/map/document/network). EXCEPTION: 'list' — generate 1 sub-visual PER ITEM in the ranking (e.g. 5 items → 5 list sub-visuals).

EACH sub_visual: {"visual_type": str, "visual_cue": str (English keyword), "transition": "fade"|"slide_left"|"slide_right"|"slide_up"|"slide_down"|"zoom_in"|"zoom_out"|"glitch"|"none", "visual_meta": dict as below}

- scene/image/parallax: visual_meta {} (portrait may add {"person_name": str})
- youtube: visual_meta {"start_offset": 15, "duration": 15, "skip_intro": true}
- chart: visual_meta {"chart_type": "bar"|"line"|"pie", "title": str, "data": [{"label": str, "value": number}]}
- map: visual_meta {"map_style": "vintage", "locations": [{"name": str, "coord": [lat, lon]}]} (2 locations)
- document: visual_meta {"title": str (masthead name, e.g. "THE WASHINGTON POST" — upper!), "headline": str (main headline), "subtitle": str (e.g. "BREAKING NEWS" or "EXCLUSIVE"), "doc_text": str (200-500 char article body — write realistic newspaper prose), "highlight_text": str (optional ~2-4 word phrase to visually highlight with amber marker), "source": str (news agency, e.g. "Reuters"), "date": str (formatted date e.g. "Monday, June 11, 2026"), "section": str (one of: National|International|Business|Technology|Science|Politics|Opinion|Culture|Sports), "pull_quote": str (a 6-15 word dramatic quote from the doc_text that will appear as a centered featured quote), "show_image": bool (true if a striking image would accompany this story), "image_url": str (""), "image_caption": str ("" if no url)}
- network: visual_meta {"theme": "conspiracy_board"|"cyberpunk"|"corporate", "nodes": [{"id": str, "label": str, "type": "person"|"entity"}], "edges": [{"source": str, "target": str}]}
- list: visual_meta {"number": int (the rank, starting from 1), "title": str (the item name, e.g. "Ganga River"), "description": str (optional ~10-20 word fact about this item, e.g. "The longest river in India, flowing over 2,525 km")}
- custom_html: visual_meta {"html": str (raw HTML snippet), "css": str (raw CSS styling)}. Provide fully responsive HTML and beautifully styled CSS.
- Any type: add {"lower_third": {"title": str, "subtitle": str}} for overlay text.
"""

    narration_emphasis = """
CRITICAL — NARRATION IS THE PRIMARY OUTPUT:
- The `narration` field is the spoken voiceover. It MUST be a non-empty string. EACH scene MUST have narration.
- Do NOT skip narration. Do NOT leave it blank or null. This field is more important than sub_visuals.
"""
    
    # 1. Generate Outline
    progress_cb(10.0, "Generating video outline...")
    logger.info("Stage 1: Generating Outline...")
    outline_system_prompt = f"""You are a master YouTube Documentary Director.
Your task is to outline a documentary.
Break the story down chronologically into exactly {min_scenes} to {max_scenes} chapters.
Return ONLY valid JSON matching the provided schema. No markdown backticks.
{lang_instruction}"""
    
    outline_user_prompt = f"""Topic: "{topic}"
Detail: "{prompt_desc}"
Generate a {min_scenes} to {max_scenes} chapter outline."""

    outline_data = _call_llm_json(outline_system_prompt, outline_user_prompt, OUTLINE_JSON_SCHEMA, cancel_event)
    
    # 2. Generate Base (Intro & Conclusion)
    progress_cb(20.0, "Writing introduction & conclusion...")
    logger.info("Stage 2: Generating Intro & Conclusion...")
    base_system_prompt = f"""You are a master YouTube Documentary Scriptwriter.
Write the introduction (hook) and the conclusion (summary and call to action) for this documentary based on the provided outline.
Return ONLY valid JSON matching the provided schema. No markdown backticks.
{lang_instruction}
{visual_rules}
{narration_emphasis}"""

    outline_json_str = json.dumps(outline_data, ensure_ascii=False)
    base_user_prompt = f"""Topic: "{topic}"
Outline: {outline_json_str}
Write the introduction and conclusion."""

    base_data = _call_llm_json(base_system_prompt, base_user_prompt, BASE_SCRIPT_JSON_SCHEMA, cancel_event)
    
    # 3. Generate Scenes in Loop
    progress_cb(30.0, "Drafting scene narratives...")
    logger.info("Stage 3: Generating Scenes...")
    
    scenes_array = []
    chapters = outline_data.get("chapters", [])
    total_chapters = len(chapters)
    
    def generate_single_scene(idx, chapter):
        scene_num = chapter.get("scene_number", idx + 1)
        chapter_title = chapter.get("chapter_title", f"Scene {scene_num}")
        context = chapter.get("historical_context", "")
        
        prev_context = ""
        if idx > 0:
            prev_chap = chapters[idx - 1]
            prev_context = f"Previous Scene ({prev_chap.get('scene_number')}): {prev_chap.get('chapter_title')} - {prev_chap.get('historical_context')}"
        
        scene_system_prompt = f"""You are a master YouTube Documentary Scriptwriter.
You are writing ONE specific scene (Scene {scene_num}: {chapter_title}) for a documentary.
{sentence_rule}
Return ONLY valid JSON matching the provided schema. No markdown backticks.
{lang_instruction}
{visual_rules}
{narration_emphasis}"""

        scene_user_prompt = f"""Topic: "{topic}"
This Scene: Scene {scene_num}: {chapter_title}
Context for this scene: {context}
{prev_context}
Write the narration and visual details for this scene."""

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

    intro = final_script.get("introduction") or {}
    if isinstance(intro, dict):
        intro["hook"] = _safe_str(intro.get("hook", ""))
        intro["transition"] = _safe_str(intro.get("transition", ""))

    conclusion = final_script.get("conclusion") or {}
    if isinstance(conclusion, dict):
        conclusion["summary"] = _safe_str(conclusion.get("summary", ""))
        conclusion["cta"] = _safe_str(conclusion.get("cta", ""))

    for scene in final_script.get("scenes", []):
        if isinstance(scene, dict):
            scene["narration"] = _safe_str(scene.get("narration", ""))
            scene["title"] = _safe_str(scene.get("title", ""))

    # Fallback: fill empty narration from chapter context (LLM sometimes skips it)
    for i, scene in enumerate(final_script.get("scenes", [])):
        if isinstance(scene, dict) and not scene.get("narration", "").strip():
            if i < len(chapters):
                fallback = f"{chapters[i].get('chapter_title', '')}: {chapters[i].get('historical_context', '')}"
                scene["narration"] = fallback.strip()
                logger.warning(f"Scene {i+1} had empty narration; filled from chapter context.")
    if isinstance(intro, dict) and not intro.get("hook", "").strip():
        intro["hook"] = topic  # fallback
    if isinstance(conclusion, dict) and not conclusion.get("summary", "").strip():
        conclusion["summary"] = f"In conclusion, {topic} remains a significant chapter in history."

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


