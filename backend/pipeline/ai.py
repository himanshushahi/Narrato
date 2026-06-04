import concurrent.futures
import os
import json
import re
import requests
from backend.database.db import get_setting, update_project
from backend.core.logger import logger
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
import html

# Schema validations for JSON parsing
INTRO_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "hook": {"type": "string"},
        "visual_cue": {"type": "string"},
        "visual_type": {"type": "string"},
        "visual_meta": {"type": "object"}
    },
    "required": ["hook", "visual_cue", "visual_type"]
}

SCENE_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "scene_number": {"type": "integer"},
        "title": {"type": "string"},
        "narration": {"type": "string"},
        "visual_cue": {"type": "string"},
        "visual_type": {"type": "string"},
        "visual_meta": {"type": "object"}
    },
    "required": ["scene_number", "title", "narration", "visual_cue", "visual_type"]
}

CONCLUSION_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "cta": {"type": "string"},
        "visual_cue": {"type": "string"},
        "visual_type": {"type": "string"},
        "visual_meta": {"type": "object"}
    },
    "required": ["summary", "cta", "visual_cue", "visual_type"]
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
    keys_pattern = r'("(?:title|hook|visual_cue|visual_type|visual_meta|scene_number|narration|summary|cta|introduction|scenes|conclusion)")\s*:\s*'
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
    llm_provider = get_setting("llm_provider") or "openai"
    api_key = get_setting("openai_api_key")
    base_url = get_setting("openai_base_url") or "https://api.openai.com/v1"
    model = get_setting("openai_model") or "gpt-4o"
    
    if not api_key:
        raise ValueError("OpenAI API key is missing. Please configure it in the settings panel.")
        
    url = f"{base_url.rstrip('/')}/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }
    
    if llm_provider == "nvidia":
        data = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "temperature": 0.7,
            "guided_json": schema
        }
    else:
        data = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "temperature": 0.7,
            "response_format": {"type": "json_object"}
        }

    if cancel_event.is_set():
        raise InterruptedError("Cancelled")

    max_retries = 5
    for attempt in range(max_retries):
        if cancel_event.is_set():
            raise InterruptedError("Cancelled")
        try:
            response = requests.post(url, headers=headers, json=data, timeout=120)
            response.raise_for_status()
            break
        except requests.exceptions.HTTPError as e:
            if response.status_code == 429 and attempt < max_retries - 1:
                import time
                import random
                sleep_time = (2 ** attempt) + random.uniform(0, 1)
                logger.warning(f"Rate limited (429). Retrying in {sleep_time:.2f}s... (Attempt {attempt+1}/{max_retries})")
                time.sleep(sleep_time)
            else:
                raise e
    res_data = response.json()
    raw_content = res_data["choices"][0]["message"]["content"]
    
    if cancel_event.is_set():
        raise InterruptedError("Cancelled")
        
    return clean_json_response(raw_content)


def generate_script_pipeline(project_dict, project_dir, progress_cb, cancel_event):
    from backend.database.db import get_setting, update_project
    from backend.core.logger import logger
    
    topic = project_dict['name']
    prompt_desc = project_dict['prompt']
    language = project_dict.get('language', 'hi')
    duration_mode = project_dict.get('duration_mode', 'medium')
    
    logger.info(f"Generating script for topic: '{topic}' (Lang: {language}, Dur: {duration_mode})")
    progress_cb(5.0, "Preparing to generate script...")
    
    # Check API key before starting
    api_key = get_setting("openai_api_key")
    if not api_key:
        raise ValueError("OpenAI API key is missing. Please configure it in the settings panel.")

    if duration_mode == "short":
        target_minutes = 2
        min_scenes = 8
        max_scenes = 12
        sentence_rule = "Write narration in engaging sentences (25-35 words per scene) to keep visuals changing rapidly."
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
Visual Directives (`visual_type`, `visual_cue` & `visual_meta`):
You MUST select exactly one `visual_type` from the 8 available options. For each type, `visual_cue` and `visual_meta` must follow strict rules:
- 'scene' (B-roll), 'image' (Stock Image), 'parallax' (2.5D Photo), 'portrait':
  -> `visual_cue`: MUST be a simple, concrete search keyword for Pexels/Stock media (e.g., "worried businessman", "ancient Indian port").
  -> `visual_meta`: {} (Empty object. For 'portrait', you may optionally provide { "person_name": "Name" }).
- 'youtube' (YouTube Video):
  -> `visual_cue`: MUST be a full sentence describing the exact YouTube search query.
  -> `visual_meta`: MUST contain { "start_offset": 15, "duration": 15, "skip_intro": true }.
- 'chart' (Animated Chart):
  -> `visual_cue`: Description of the chart.
  -> `visual_meta`: MUST contain { "chart_type": "bar"|"line", "data": [{ "label": "X", "value": Y }] }.
- 'map' (Vintage Map):
  -> `visual_cue`: Description of the journey.
  -> `visual_meta`: MUST contain { "map_style": "vintage", "locations": [{ "name": "City", "coord": [lat, lon] }] }. Provide exactly two locations to animate a travel line.
- 'document' (Archival Document):
  -> `visual_cue`: MUST be a search query for fetching historical news.
  -> `visual_meta`: MUST contain { "headline": "exact news headline", "doc_text": "newspaper excerpt", "highlight_text": "short phrase to highlight", "source": "Publisher", "date": "Month DD, YYYY" }.
- 'network' (Network Diagram):
  -> `visual_cue`: Description of the relationship.
  -> `visual_meta`: MUST contain { "nodes": [{ "id": "1", "label": "Name", "type": "person"|"entity" }], "edges": [{ "source": "1", "target": "2" }] }.

Universal Lower Thirds (Global Overlay):
- 'lower_third' is a GLOBAL property that can be used SIMULTANEOUSLY with ANY of the 8 `visual_type` options.
- Format: Inject it into the `visual_meta` object: { "lower_third": { "title": "India", "subtitle": "1992" } }
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
{visual_rules}"""

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
{visual_rules}"""

        scene_user_prompt = f"""Topic: "{topic}"
This Scene: Scene {scene_num}: {chapter_title}
Context for this scene: {context}
{prev_context}
Write the narration and visual details for this scene."""

        import time
        import random
        time.sleep(random.uniform(0.5, 3.0))

        return _call_llm_json(scene_system_prompt, scene_user_prompt, SINGLE_SCENE_JSON_SCHEMA, cancel_event)

    max_workers = min(10, total_chapters) if total_chapters > 0 else 1
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
    api_key = get_setting("openai_api_key")
    base_url = get_setting("openai_base_url") or "https://api.openai.com/v1"
    model = get_setting("openai_model") or "gpt-4o"

    if not api_key:
        return {"success": False, "error": "LLM API key is missing. Please configure it in settings."}

    system_prompt = """You are an expert data analyst and researcher.
Your task is to generate realistic, accurate, or highly plausible chart data based on the user's prompt.
You must return your output strictly as a JSON object containing a "data" array. No markdown backticks, no explanations.

CRITICAL JSON SCHEMA:
{
  "chart_type": "bar" or "line",
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

    url = f"{base_url.rstrip('/')}/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }

    try:
        if llm_provider == "nvidia":
            data = {
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                "temperature": 0.7
            }
        else:
            data = {
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                "temperature": 0.7,
                "response_format": {"type": "json_object"}
            }

        response = requests.post(url, headers=headers, json=data, timeout=45)
        response.raise_for_status()
        res_data = response.json()
        raw_content = res_data["choices"][0]["message"]["content"]
        
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
