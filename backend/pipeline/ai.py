import os
import json
import re
import requests
from backend.database.db import get_setting, update_project
from backend.core.logger import logger

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

def generate_script_pipeline(project_dict, project_dir, progress_cb, cancel_event):
    """Executes script generation step of pipeline."""
    topic = project_dict['name']
    prompt_desc = project_dict['prompt']
    language = project_dict.get('language', 'hi')
    duration_mode = project_dict.get('duration_mode', 'medium')
    
    logger.info(f"Generating script for topic: '{topic}' (Lang: {language}, Dur: {duration_mode})")
    progress_cb(10.0)

    # Resolve settings
    llm_provider = get_setting("llm_provider") or "openai"
    api_key = get_setting("openai_api_key")
    base_url = get_setting("openai_base_url") or "https://api.openai.com/v1"
    model = get_setting("openai_model") or "gpt-4o"

    if not api_key:
        raise ValueError("OpenAI API key is missing. Please configure it in the settings panel.")

    # Approximate length constraints
    # Speaking speed is ~150 words/min
    if duration_mode == "short":
        target_minutes = 2
        min_scenes = 4
        max_scenes = 6
    elif duration_mode == "long":
        target_minutes = 10
        min_scenes = 15
        max_scenes = 20
    else: # medium
        target_minutes = 5
        min_scenes = 8
        max_scenes = 11

    target_word_count = target_minutes * 150

    lang_instruction = ""
    if language == "hi":
        lang_instruction = (
            "LANGUAGE RULES:\n"
            "- The spoken text (hook, narration, summary, cta) MUST be written in Hindi (Devanagari script).\n"
            "- The 'visual_cue' field MUST ALWAYS be in ENGLISH. This is critical because visual_cue is used as a search keyword for the media APIs, which only understand English.\n"
            "  Example: visual_cue = 'ancient Indian trading port with ships' (NOT 'भारत में एक छोटा सा व्यापारिक दफ्तर')\n"
            "  Example: visual_cue = 'British colonial officers in India' (NOT 'ब्रिटिश अधिकारी')\n"
            "- The 'title' field can be in Hindi.\n"
            "- All 'visual_meta' text fields should be in English.\n"
        )
    else:
        lang_instruction = "The spoken text (hook, narration, summary, cta) MUST be written in English."

    system_prompt = f"""You are a master YouTube Documentary Scriptwriter like Nitish Rajput.
Your task is to write a highly engaging, structured, and informative script on the requested topic.
You must return your output strictly as a JSON object matching the provided JSON schema. No surrounding text, no markdown backticks.

CRITICAL DIRECTIVES:
1. Tone: Analytical, documentary-style, engaging, objective, and clear.
2. Segmenting: Break the story down chronologically.
3. Sentence Length: Write narration in short, punchy sentences (12-18 words each) so they can fit dynamic typography and quick edits.
4. Visual Directives (visual_type & visual_meta):
   - Choose visual_type from: 'chart', 'map', 'document', 'portrait', 'scene', 'youtube'.
   - If 'chart': visual_meta must contain: {{ "chart_type": "bar"|"line", "data": [{{ "label": "X", "value": Y }}] }}.
   - If 'map': visual_meta must contain: {{ "map_style": "vintage", "locations": [{{ "name": "City", "coord": [lat, lon] }}] }}.
   - If 'document': visual_meta must contain: {{ "doc_text": "typed quote or excerpt", "title": "Newspaper Header" }}.
   - If 'portrait' (historical figure): visual_meta must contain: {{ "person_name": "Name" }}.
   - If 'scene' (generic B-roll/image stock): visual_meta must contain: {{ "description": "Atmospheric details" }}.
   - If 'youtube' (real historical event recordings, interviews, news footage, or real-world clips): visual_meta must contain: {{ "search_query": "highly specific terms targeting real youtube footage", "skip_intro": true }}.
   
5. STOCK MEDIA CUE OPTIMIZATION (Pexels / Stocks):
   - When visual_type is 'scene' or 'portrait' or 'image' (which search stock photo/video directories like Pexels), the `visual_cue` keyword MUST be simple, clear, and concrete (e.g., 'crowded modern stock trading floor', 'worried businessman holding head', 'old vintage book opening'). Do NOT write long sentences, narrative descriptions, or abstract phrases. Use simple, direct nouns and adjectives.
   
6. REAL YOUTUBE MEDIA OPTIMIZATION (YouTube):
   - Use 'youtube' visual_type ONLY when the segment requires actual, real-world footage, news reports, interviews, or historical documentary recordings that generic stock libraries cannot supply (e.g. '1992 Harshad Mehta news reporting archive', 'SpaceX Falcon Heavy launch original footage', 'Apollo 11 moon landing restored video'). The `visual_cue` should be a clean, targeted search query to find this exact clip on YouTube.

7. Word Count: The script must result in approximately {target_word_count} words of voiceover. Generate between {min_scenes} and {max_scenes} scenes in the scenes array to fit the target length.

JSON SCHEMA:
{json.dumps(SCRIPT_JSON_SCHEMA, indent=2)}

{lang_instruction}
"""

    user_prompt = f"""Write a documentary script on: "{topic}".
Detail: "{prompt_desc}"
Target Scenes: Generate exactly {min_scenes} to {max_scenes} scenes.
"""

    if cancel_event.is_set():
        raise InterruptedError("Cancelled")

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
            "guided_json": SCRIPT_JSON_SCHEMA
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

    progress_cb(30.0)

    try:
        response = requests.post(url, headers=headers, json=data, timeout=90)
        response.raise_for_status()
        res_data = response.json()
        raw_content = res_data["choices"][0]["message"]["content"]
    except Exception as e:
        logger.error(f"Failed to communicate with LLM API: {e}")
        raise e

    if cancel_event.is_set():
        raise InterruptedError("Cancelled")

    progress_cb(70.0)
    
    # Clean and parse script
    script_data = clean_json_response(raw_content)
    
    # Save script to project directory
    script_path = project_dir / "script.json"
    with open(script_path, "w", encoding="utf-8") as f:
        json.dump(script_data, f, indent=2, ensure_ascii=False)

    update_project(project_dict['id'], script_path=str(script_path))
    progress_cb(100.0)
    logger.info(f"Script generated successfully and saved to: {script_path}")
