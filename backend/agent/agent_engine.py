import json
import re
from typing import Dict, Any, Callable
from backend.core.logger import logger
from backend.agent.tools import get_tools_schema, execute_tool
from backend.agent.validators import validate_sub_visuals
from backend.pipeline.ai import _call_llm_json, clean_json_response

# Matches a ```tool\n{...}\n``` block the model emits before the final JSON.
TOOL_BLOCK_RE = re.compile(r"```tool\s*\n*(\{.*?\})\s*```", re.DOTALL)

# Any fenced block (```tool / ```json / plain ```) that may hold a tool call.
FENCED_BLOCK_RE = re.compile(r"```(?:json|tool)?\s*(.*?)```", re.DOTALL | re.IGNORECASE)


def _try_extract_json_objects(text: str) -> list:
    """Yield the brace-delimited JSON objects found in text using balanced
    brace counting (string-aware), so nested objects inside 'arguments' are
    captured whole instead of being cut at the first '}'."""
    objects = []
    i, n = 0, len(text)
    while i < n:
        char = text[i]
        if char == '"':
            i += 1
            while i < n:
                if text[i] == "\\" and i + 1 < n:
                    i += 2
                    continue
                if text[i] == '"':
                    break
                i += 1
        elif char == "{":
            depth = 0
            start = i
            in_str = False
            while i < n:
                ch = text[i]
                if in_str:
                    if ch == "\\":
                        i += 2
                        continue
                    if ch == '"':
                        in_str = False
                else:
                    if ch == '"':
                        in_str = True
                    elif ch == "{":
                        depth += 1
                    elif ch == "}":
                        depth -= 1
                        if depth == 0:
                            objects.append(text[start:i + 1])
                            break
                i += 1
        i += 1
    return objects


def _looks_like_tool_call(call) -> bool:
    return (
        isinstance(call, dict)
        and call.get("name")
        and isinstance(call["name"], str)
        and "arguments" in call
        and (call["arguments"] is None or isinstance(call["arguments"], dict))
    )


def _extract_tool_blocks(text: str) -> list:
    """Extract tool-call objects from model output across all common formats:
    ```tool``` fenced blocks, ```json```-fenced blocks, plain ``` fences, and
    bare JSON objects shaped like {"name": ..., "arguments": ...}. Deduplicates
    identical calls (same name + same arguments).
    """
    # Strip <think>...</think> blocks from reasoning models before extracting tools
    text = re.sub(r'<think>.*?(?:</think>|$)', '', text, flags=re.DOTALL | re.IGNORECASE)
    
    found = []
    seen = set()

    def _add(call):
        if not _looks_like_tool_call(call):
            return
        key = (call["name"], json.dumps(call.get("arguments") or {}, sort_keys=True, default=str))
        if key not in seen:
            seen.add(key)
            found.append(call)

    for match in FENCED_BLOCK_RE.finditer(text):
        for obj in _try_extract_json_objects(match.group(1)):
            try:
                _add(json.loads(obj))
            except (json.JSONDecodeError, ValueError):
                continue

    for obj in _try_extract_json_objects(text):
        try:
            _add(json.loads(obj))
        except (json.JSONDecodeError, ValueError):
            continue

    return found

# Budget: tool turns + one final strict-schema turn. Kept small so interactive
# editor rewrites don't stall the UI thread for minutes.
MAX_AGENT_TURNS = 4

# Pipeline-only budgets: the bulk generation loops are not blocking the UI, so
# they get extra headroom to research before finalizing.
PIPELINE_VISUAL_TURNS = 6
PIPELINE_SCRIPT_TURNS = 5

# Tools allowed during bulk pipeline generation. WRITE tools and nested
# AI rewrite tools are excluded so a pipeline run can never mutate the project
# or spawn recursive ReAct loops mid-generation.
PIPELINE_VISUAL_TOOLS = frozenset({
    "web_search", "get_skill", "get_visual_type_rules",
    "read_project_file", "list_project_files", "project_status_report",
    "search_pexels_photo", "search_pexels_video",
    "search_wikipedia_image", "preview_asset",
})

SCRIPT_NARRATION_TOOLS = frozenset({
    "web_search", "get_skill", "read_project_file",
    "list_project_files", "project_status_report",
})

# Bridge: script rewrites — research + read-only project access.
# No visual-type rules or asset search needed for narration-only rewrites.
BRIDGE_SCRIPT_TOOLS = frozenset({
    "web_search", "get_skill", "read_project_file",
    "list_project_files", "project_status_report",
})

# Bridge: visual rewrites — research + visual-type rules + asset search.
# Needs Pexels/Wikipedia/preview tools to verify assets exist before using them.
BRIDGE_VISUAL_TOOLS = frozenset({
    "web_search", "get_skill", "get_visual_type_rules",
    "read_project_file", "list_project_files", "project_status_report",
    "search_pexels_photo", "search_pexels_video", "search_wikipedia_image",
})

# Bridge: add scene — research only (narration-only, visuals added later).
# No asset/visual tools needed since sub_visuals are set to [] by the caller.
BRIDGE_ADD_SCENE_TOOLS = frozenset({
    "web_search", "get_skill", "read_project_file",
    "list_project_files", "project_status_report",
})


class AgentRunner:
    def __init__(self, progress_cb: Callable[[float, str], None] = None, cancel_event=None):
        self.progress_cb = progress_cb
        self.cancel_event = cancel_event

    def _emit_progress(self, message: str, pct: float = None):
        """Emits progress up to the UI if a callback is provided."""
        if self.progress_cb:
            self.progress_cb(pct if pct is not None else 50.0, message)

    def _check_cancel(self):
        if self.cancel_event is not None and self.cancel_event.is_set():
            raise InterruptedError("Cancelled")

    @staticmethod
    def _build_tool_docs(allowed_tools=None) -> str:
        """Serializes the tool registry into the system prompt."""
        tools_schema = get_tools_schema()
        if allowed_tools:
            tools_schema = [t for t in tools_schema if t["function"]["name"] in allowed_tools]
        lines = ["\n=== AVAILABLE TOOLS ===\n"]
        for t in tools_schema:
            func = t["function"]
            lines.append(f"- {func['name']}: {func['description']}")
            props = func["parameters"].get("properties", {})
            lines.append(f"  Parameters: {json.dumps(props)}")
        lines.append("")
        lines.append(
            "If you need external data (web facts, visual-type schemas, project files, "
            "design settings) to produce a correct result, BEFORE outputting the final JSON "
            "emit EXACTLY ONE tool call block:\n"
            '```tool\n{"name": "tool_name", "arguments": {"param": "value"}}\n```\n'
            "You will receive the tool result in the next message. "
            "CRITICAL: Before making a tool call or outputting the final JSON, you MUST think step-by-step "
            "and wrap your entire reasoning inside <think>...</think> tags. "
            "After you have all the data you need, output ONLY the final JSON matching the "
            "requested schema — no tool block, no markdown, no extra text."
        )
        return "\n".join(lines)

    def run_with_tools(self, system_prompt: str, user_prompt: str, schema: dict,
                       base_activity_label: str = "Agent",
                       allowed_tools=None, max_turns: int = None) -> dict:
        """
        Loose ReAct loop: the model may emit ```tool``` blocks that get executed
        via the tool registry, with results fed back for the next turn. The final
        JSON is produced either by parsing the model's loose response or by a
        strict-schema call on the last turn (so providers that can't do free-form
        JSON reliably still return schema-valid output).

        allowed_tools: optional iterable of tool names; unlisted tools are not
        documented in the prompt and are rejected if the model still tries them.
        max_turns: per-run turn budget; defaults to MAX_AGENT_TURNS. Pipeline
        callers pass a larger budget since they don't block the UI.
        """
        turns_budget = max_turns or MAX_AGENT_TURNS
        enhanced_system_prompt = system_prompt + "\n" + self._build_tool_docs(allowed_tools)
        current_user_prompt = user_prompt

        for turn in range(turns_budget):
            self._check_cancel()
            self._emit_progress(f"Agent: Analyzing request (turn {turn + 1}/{turns_budget})...")

            # Loose call: no schema enforcement so the model is free to emit
            # tool blocks. return_raw keeps the unparsed text so ```tool```
            # tool blocks can actually be extracted and executed.
            raw = _call_llm_json(enhanced_system_prompt, current_user_prompt, None, self.cancel_event, return_raw=True, activity_label=f"{base_activity_label} (reasoning)")
            if not isinstance(raw, str):
                # Defensive: if a provider ever returns a parsed value here,
                # accept it as the final answer.
                return raw

            tool_blocks = _extract_tool_blocks(raw)
            if tool_blocks:
                executed_any = False
                for call in tool_blocks:
                    self._check_cancel()
                    name = call.get("name")
                    args = call.get("arguments") or {}
                    if not name:
                        continue
                    if allowed_tools and name not in allowed_tools:
                        current_user_prompt += f"\n\n[System: tool '{name}' is not available in this context. Use only the documented tools.]"
                        continue
                    self._emit_progress(f"Agent: Executing tool {name}...")
                    result_str = execute_tool(name, args)
                    current_user_prompt += f"\n\nTool '{name}' result:\n{result_str}"
                    executed_any = True
                if executed_any:
                    continue  # give the model a turn to act on the results

            # No tool block: try to parse the loose response as the final JSON.
            try:
                return clean_json_response(raw)
            except ValueError:
                if turn == turns_budget - 1:
                    # Last turn: enforce the schema with a strict call.
                    self._emit_progress(f"{base_activity_label}: Finalizing with strict schema...")
                    return _call_llm_json(enhanced_system_prompt, current_user_prompt, schema, self.cancel_event, activity_label=f"{base_activity_label} (finalizing)")
                current_user_prompt += (
                    "\n\n[System: your response was not valid JSON. If you need information, "
                    "emit a tool block. Otherwise output ONLY valid JSON matching the requested schema.]"
                )

        # Loop exhausted without a parseable answer — final strict attempt.
        return _call_llm_json(enhanced_system_prompt, current_user_prompt, schema, self.cancel_event, activity_label=f"{base_activity_label} (strict fallback)")

    def run_with_tools_safe(self, system_prompt: str, user_prompt: str, schema: dict,
                            allowed_tools=None, max_turns: int = None) -> dict:
        """Safe wrapper for interactive bridge endpoints, mirroring _call_llm_safe."""
        try:
            data = self.run_with_tools(system_prompt, user_prompt, schema,
                                       allowed_tools=allowed_tools, max_turns=max_turns)
            return {"success": True, "data": data}
        except InterruptedError:
            return {"success": False, "error": "Operation cancelled."}
        except Exception as e:
            logger.error(f"Agent LLM call failed: {type(e).__name__}: {e}")
            return {"success": False, "error": str(e)}

    def generate_bulk_scenes_oneshot(self, system_prompt: str, user_prompt: str, schema: dict) -> dict:
        """
        For bulk scene generation, ReAct looping is too slow.
        We just do a single-shot execution using _call_llm_json.
        """
        self._emit_progress("Agent: Generating visuals (One-Shot)...")
        return _call_llm_json(system_prompt, user_prompt, schema, self.cancel_event, activity_label="Agent: bulk visuals")

    def validate_and_correct_visuals(self, system_prompt: str, user_prompt: str, schema: dict, expected_duration: float,
                                     allowed_tools=None, max_turns: int = None) -> dict:
        """
        Runs visual generation, then normalizes the result. Duration math and
        enum mismatches are auto-corrected by the validator itself, so the
        correction turn only fires for structurally broken output (empty or
        non-list sub_visuals). Returned sub-visuals are always enum-normalized
        (never raw hallucinated types).
        """
        self._emit_progress("Agent: Generating scene visuals...")

        try:
            result = self.run_with_tools(system_prompt, user_prompt, schema, base_activity_label="Agent: scene visuals",
                                         allowed_tools=allowed_tools, max_turns=max_turns)
        except Exception as e:
            raise e

        if not isinstance(result, dict) or "sub_visuals" not in result:
            return result

        is_valid, normalized_svs, error_msg = validate_sub_visuals(result["sub_visuals"], expected_duration)

        if is_valid:
            self._emit_progress("Agent: Visual duration math verified.")
            result["sub_visuals"] = normalized_svs
            return result

        self._emit_progress(f"Agent: Correcting math error ({error_msg})...")

        # 1-turn Correction Loop
        correction_prompt = user_prompt + f"\n\nValidation Error: {error_msg}\nPlease recalculate durations so they sum exactly to {expected_duration}."

        try:
            corrected_result = self.run_with_tools(system_prompt, correction_prompt, schema, base_activity_label="Agent: visual correction",
                                                   allowed_tools=allowed_tools, max_turns=max_turns)
            if isinstance(corrected_result, dict) and "sub_visuals" in corrected_result:
                is_valid2, final_svs, _ = validate_sub_visuals(corrected_result["sub_visuals"], expected_duration)
                corrected_result["sub_visuals"] = final_svs
                return corrected_result
        except Exception:
            pass  # Fallback to normalized

        result["sub_visuals"] = normalized_svs
        return result
