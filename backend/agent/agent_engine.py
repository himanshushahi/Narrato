import json
import re
import concurrent.futures
from typing import Any, Callable
from backend.core.logger import logger
from backend.agent.tools import get_tools_schema, execute_tool
from backend.agent.validators import validate_sub_visuals
from backend.pipeline.ai import _call_llm_json, clean_json_response
from backend.agent.schemas import parse_and_validate_model

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


def _normalize_tool_call(call) -> dict | None:
    if not isinstance(call, dict):
        return None
    name = (
        call.get("name")
        or call.get("tool")
        or call.get("function")
        or call.get("tool_name")
        or call.get("call")
    )
    if not name or not isinstance(name, str):
        return None

    # Check if there is an arguments field or an explicit tool-identifying key
    has_args_key = any(k in call for k in ("arguments", "parameters", "args", "input"))
    is_explicit_tool_key = any(k in call for k in ("tool", "function", "tool_name", "call"))

    if not has_args_key and not is_explicit_tool_key:
        return None

    args = (
        call.get("arguments")
        if "arguments" in call
        else call.get("parameters")
        if "parameters" in call
        else call.get("args")
        if "args" in call
        else call.get("input")
        if "input" in call
        else {}
    )
    if args is None:
        args = {}
    elif isinstance(args, str):
        try:
            args = json.loads(args)
        except Exception:
            args = {"query": args}
    elif not isinstance(args, dict):
        return None

    return {"name": name.strip(), "arguments": args}


def _looks_like_tool_call(call) -> bool:
    return _normalize_tool_call(call) is not None


def _extract_tool_blocks(text: str) -> list:
    """Extract tool-call objects from model output across all common formats:
    ```tool``` fenced blocks, ```json```-fenced blocks, plain ``` fences,
    bare JSON objects shaped like {"name": ..., "arguments": ...} or {"tool": ...},
    and JSON arrays containing multiple tool calls.
    Deduplicates identical calls (same name + same arguments) while preserving order.
    """
    # Strip <think>...</think> blocks from reasoning models before extracting tools
    text = re.sub(r'<think>.*?(?:</think>|$)', '', text, flags=re.DOTALL | re.IGNORECASE)
    
    found = []
    seen = set()

    def _add(raw_obj):
        if isinstance(raw_obj, list):
            for item in raw_obj:
                _add(item)
            return
        if isinstance(raw_obj, dict) and not _normalize_tool_call(raw_obj):
            for container_key in ("tools", "tool_calls", "calls"):
                if container_key in raw_obj and isinstance(raw_obj[container_key], list):
                    for item in raw_obj[container_key]:
                        _add(item)
                    return
        norm = _normalize_tool_call(raw_obj)
        if not norm:
            return
        key = (norm["name"], json.dumps(norm.get("arguments") or {}, sort_keys=True, default=str))
        if key not in seen:
            seen.add(key)
            found.append(norm)

    for match in FENCED_BLOCK_RE.finditer(text):
        block_content = match.group(1).strip()
        # First attempt to parse the entire fenced block as JSON (e.g. array or object)
        try:
            parsed_block = json.loads(block_content)
            _add(parsed_block)
            continue
        except (json.JSONDecodeError, ValueError):
            pass

        for obj in _try_extract_json_objects(match.group(1)):
            try:
                _add(json.loads(obj))
            except (json.JSONDecodeError, ValueError):
                continue

    # Also check the raw text for bare JSON arrays outside of fenced blocks
    trimmed_text = text.strip()
    if trimmed_text.startswith("[") and trimmed_text.endswith("]"):
        try:
            _add(json.loads(trimmed_text))
        except (json.JSONDecodeError, ValueError):
            pass

    for obj in _try_extract_json_objects(text):
        try:
            _add(json.loads(obj))
        except (json.JSONDecodeError, ValueError):
            continue

    return found

# Budget: tool turns + one final strict-schema turn. Kept small so interactive
# editor rewrites don't stall the UI thread for minutes.
MAX_AGENT_TURNS = 4
MAX_TOOLS_PER_TURN = 8

# Pipeline-only budgets: the bulk generation loops are not blocking the UI, so
# they get extra headroom to research before finalizing.
PIPELINE_VISUAL_TURNS = 6
PIPELINE_SCRIPT_TURNS = 5

# Tools allowed during bulk pipeline generation. WRITE tools and nested
# AI rewrite tools are excluded so a pipeline run can never mutate the project
# or spawn recursive ReAct loops mid-generation.
PIPELINE_VISUAL_TOOLS = frozenset({
    "web_search", "get_skill",
    "read_project_file", "list_project_files", "project_status_report",
    "search_pexels_photo", "search_pexels_video",
    "search_wikipedia_image",
    "search_pixabay_photo", "search_pixabay_video",
    "search_youtube_video",
})

SCRIPT_NARRATION_TOOLS = frozenset({
    "web_search", "get_skill", "read_project_file",
    "list_project_files", "project_status_report",
})

# Bridge: script rewrites — research + read-only project access.
# No visual AST rules or asset search needed for narration-only rewrites.
BRIDGE_SCRIPT_TOOLS = frozenset({
    "web_search", "get_skill", "read_project_file",
    "list_project_files", "project_status_report",
})

# Bridge: visual rewrites — research + declarative AST composition rules + asset search.
# Needs Pexels/Wikipedia/Pixabay/YouTube tools to verify assets exist before using them.
BRIDGE_VISUAL_TOOLS = frozenset({
    "web_search", "get_skill",
    "read_project_file", "list_project_files", "project_status_report",
    "search_pexels_photo", "search_pexels_video", "search_wikipedia_image",
    "search_pixabay_photo", "search_pixabay_video",
    "search_youtube_video",
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
        lines = ["\n=== AVAILABLE TOOLS (FOR INTERNAL APP LLM ONLY — MCP EXTERNAL AGENTS IGNORE) ===\n"]
        for t in tools_schema:
            func = t["function"]
            lines.append(f"- {func['name']}: {func['description']}")
            props = func["parameters"].get("properties", {})
            lines.append(f"  Parameters: {json.dumps(props)}")
        lines.append("")
        lines.append(
            "**FOR INTERNAL APP LLM ONLY — MCP EXTERNAL AGENTS IGNORE THIS TOOL-CALL SYNTAX.** "
            "If you need external data (web facts, declarative AST schemas, project files, "
            "media assets, design settings) to produce a correct result, BEFORE outputting the final JSON "
            "emit one or more tool call blocks (you may call multiple tools in a single turn if you need multiple pieces of data):\n"
            '```tool\n[\n  {"name": "tool_name_1", "arguments": {"param": "value"}},\n  {"name": "tool_name_2", "arguments": {"param": "value"}}\n]\n```\n'
            "Or emit multiple separate ```tool``` blocks. You will receive all tool results in the next message.\n"
            "CRITICAL: Before making tool calls or outputting the final JSON, you MUST think step-by-step "
            "and wrap your entire reasoning inside <think>...</think> tags.\n"
            "After you have all the data you need, output ONLY the final JSON matching the "
            "requested schema — no tool block, no markdown, no extra text."
        )
        return "\n".join(lines)

    def run_with_tools(self, system_prompt: str, user_prompt: str, schema: Any = None,
                       base_activity_label: str = "Agent",
                       allowed_tools=None, max_turns: int = None) -> Any:
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
                return parse_and_validate_model(schema, raw)

            tool_blocks = _extract_tool_blocks(raw)
            if tool_blocks:
                valid_calls = []
                for call in tool_blocks:
                    self._check_cancel()
                    name = call.get("name")
                    args = call.get("arguments") or {}
                    if not name:
                        continue
                    if allowed_tools and name not in allowed_tools:
                        current_user_prompt += f"\n\n[System: tool '{name}' is not available in this context. Use only the documented tools.]"
                        continue
                    valid_calls.append((name, args))

                # Cap AFTER allowed_tools filtering so disallowed calls can't
                # crowd out allowed ones.
                if len(valid_calls) > MAX_TOOLS_PER_TURN:
                    dropped = len(valid_calls) - MAX_TOOLS_PER_TURN
                    valid_calls = valid_calls[:MAX_TOOLS_PER_TURN]
                    current_user_prompt += (
                        f"\n\n[System: {dropped} tool call(s) were dropped "
                        f"(max {MAX_TOOLS_PER_TURN} per turn).]"
                    )

                if valid_calls:
                    if len(valid_calls) == 1:
                        name, args = valid_calls[0]
                        self._emit_progress(f"Agent: Executing tool {name}...")
                        try:
                            result_str = execute_tool(name, args)
                        except (InterruptedError, concurrent.futures.CancelledError):
                            raise
                        except Exception as e:
                            result_str = f"Error executing tool: {e}"
                        current_user_prompt += f"\n\nTool '{name}' result:\n{result_str}"
                    else:
                        names_summary = ", ".join(name for name, _ in valid_calls)
                        self._emit_progress(f"Agent: Executing {len(valid_calls)} tools in parallel ({names_summary})...")
                        # Manual pool lifecycle (no `with`): the context manager's
                        # __exit__ calls shutdown(wait=True), which blocks cancel
                        # until the slowest tool finishes. wait=False keeps
                        # cancellation responsive; as_completed already joins all
                        # futures on the success path.
                        pool = concurrent.futures.ThreadPoolExecutor(max_workers=min(len(valid_calls), 5))
                        try:
                            future_to_idx = {
                                pool.submit(execute_tool, name, args): i
                                for i, (name, args) in enumerate(valid_calls)
                            }
                            results = [None] * len(valid_calls)
                            for future in concurrent.futures.as_completed(future_to_idx):
                                self._check_cancel()
                                idx = future_to_idx[future]
                                try:
                                    results[idx] = future.result()
                                except (InterruptedError, concurrent.futures.CancelledError):
                                    pool.shutdown(wait=False, cancel_futures=True)
                                    raise
                                except Exception as e:
                                    results[idx] = f"Error executing tool: {e}"
                        finally:
                            pool.shutdown(wait=False, cancel_futures=True)

                        for (name, _), result_str in zip(valid_calls, results):
                            current_user_prompt += f"\n\nTool '{name}' result:\n{result_str}"

                continue  # give the model a turn to act on the results or rejection notices

            # No tool block: try to parse the loose response as the final JSON.
            try:
                parsed = clean_json_response(raw)
                if schema is not None:
                    # Validate and coerce via Pydantic
                    parsed = parse_and_validate_model(schema, parsed)
                return parsed
            except Exception:
                if turn == turns_budget - 1:
                    # Last turn: enforce the schema with a strict call.
                    self._emit_progress(f"{base_activity_label}: Finalizing with strict schema...")
                    strict_res = _call_llm_json(enhanced_system_prompt, current_user_prompt, schema, self.cancel_event, activity_label=f"{base_activity_label} (finalizing)")
                    return parse_and_validate_model(schema, strict_res)
                current_user_prompt += (
                    "\n\n[System: your response was not valid or complete JSON matching the requested schema. If you need information, "
                    "emit a tool block. Otherwise output ONLY valid JSON matching the requested schema.]"
                )

        # Loop exhausted without a parseable answer — final strict attempt.
        strict_fallback = _call_llm_json(enhanced_system_prompt, current_user_prompt, schema, self.cancel_event, activity_label=f"{base_activity_label} (strict fallback)")
        return parse_and_validate_model(schema, strict_fallback)

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

    def validate_and_correct_visuals(self, system_prompt: str, user_prompt: str, schema: dict, expected_duration: float,
                                     allowed_tools=None, max_turns: int = None,
                                     video_format: str = "landscape") -> dict:
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

        if isinstance(result, list):
            result = {"sub_visuals": result}
        elif isinstance(result, dict) and "sub_visuals" not in result:
            if "visuals" in result and isinstance(result["visuals"], list):
                result = {"sub_visuals": result["visuals"]}
            elif "subvisuals" in result and isinstance(result["subvisuals"], list):
                result = {"sub_visuals": result["subvisuals"]}
            elif "composition" in result:
                result = {"sub_visuals": [result]}
            elif "data" in result:
                if isinstance(result["data"], list):
                    result = {"sub_visuals": result["data"]}
                elif isinstance(result["data"], dict) and "sub_visuals" in result["data"]:
                    result = {"sub_visuals": result["data"]["sub_visuals"]}

        if not isinstance(result, dict) or "sub_visuals" not in result or not result.get("sub_visuals"):
            self._emit_progress(f"Agent: Sub-visuals missing or empty. Requesting visual generation...")
            correction_prompt = user_prompt + f"\n\nCRITICAL REQUIREMENT: You MUST generate a non-empty 'sub_visuals' array. Total scene duration is {expected_duration} seconds. Generate at least 2-4 sub-visuals whose durations sum to {expected_duration}."
            try:
                corrected_result = self.run_with_tools(system_prompt, correction_prompt, schema, base_activity_label="Agent: visual correction",
                                                       allowed_tools=allowed_tools, max_turns=max_turns)
                if isinstance(corrected_result, list):
                    corrected_result = {"sub_visuals": corrected_result}
                elif isinstance(corrected_result, dict) and "sub_visuals" not in corrected_result:
                    if "visuals" in corrected_result and isinstance(corrected_result["visuals"], list):
                        corrected_result = {"sub_visuals": corrected_result["visuals"]}
                    elif "composition" in corrected_result:
                        corrected_result = {"sub_visuals": [corrected_result]}

                if isinstance(corrected_result, dict) and "sub_visuals" in corrected_result and corrected_result["sub_visuals"]:
                    _, final_svs, _ = validate_sub_visuals(corrected_result["sub_visuals"], expected_duration,
                                                           video_format=video_format)
                    corrected_result["sub_visuals"] = final_svs
                    return corrected_result
            except Exception:
                pass

        if not isinstance(result, dict) or "sub_visuals" not in result:
            return result

        is_valid, normalized_svs, error_msg = validate_sub_visuals(result["sub_visuals"], expected_duration,
                                                                   video_format=video_format)

        if is_valid:
            self._emit_progress("Agent: Visual duration math verified.")
            result["sub_visuals"] = normalized_svs
            try:
                from backend.agent.geometry import lint_sub_visuals as _lint
                result["geometry"] = _lint(normalized_svs, video_format)
            except Exception:
                pass
            return result

        self._emit_progress(f"Agent: Correcting visual error ({error_msg})...")

        # 1-turn Correction Loop (SCHEMA_MISMATCH gets a shape hint, not math).
        if isinstance(error_msg, str) and error_msg.startswith("SCHEMA_MISMATCH"):
            from backend.agent.validators import CANONICAL_CUT_HINT
            correction_prompt = (
                user_prompt
                + f"\n\nValidation Error: {error_msg}\n"
                + f"Re-emit EVERY cut as {CANONICAL_CUT_HINT}. "
                + "Do NOT use layers[]/layout/props or animation start — "
                + "use composition.children Layer nodes with content.style "
                + "%-strings and animation delay."
            )
        else:
            correction_prompt = user_prompt + f"\n\nValidation Error: {error_msg}\nPlease recalculate durations so they sum exactly to {expected_duration}."

        try:
            corrected_result = self.run_with_tools(system_prompt, correction_prompt, schema, base_activity_label="Agent: visual correction",
                                                   allowed_tools=allowed_tools, max_turns=max_turns)
            if isinstance(corrected_result, list):
                corrected_result = {"sub_visuals": corrected_result}
            elif isinstance(corrected_result, dict) and "sub_visuals" not in corrected_result:
                if "visuals" in corrected_result and isinstance(corrected_result["visuals"], list):
                    corrected_result = {"sub_visuals": corrected_result["visuals"]}
                elif "composition" in corrected_result:
                    corrected_result = {"sub_visuals": [corrected_result]}

            if isinstance(corrected_result, dict) and "sub_visuals" in corrected_result:
                _, final_svs, _ = validate_sub_visuals(corrected_result["sub_visuals"], expected_duration,
                                                       video_format=video_format)
                corrected_result["sub_visuals"] = final_svs
                try:
                    from backend.agent.geometry import lint_sub_visuals as _lint2
                    corrected_result["geometry"] = _lint2(final_svs, video_format)
                except Exception:
                    pass
                return corrected_result
        except Exception:
            pass  # Fallback to normalized below.

        # Last resort for legacy-shaped LLM output: best-effort migrate rather
        # than persisting a black dummy cut.
        if isinstance(error_msg, str) and error_msg.startswith("SCHEMA_MISMATCH"):
            try:
                from backend.agent.validators import migrate_legacy_cut_to_composition
                _migrated = [migrate_legacy_cut_to_composition(c)
                             if isinstance(c, dict) else c
                             for c in (result.get("sub_visuals") or [])]
                ok2, svs2, _ = validate_sub_visuals(_migrated, expected_duration,
                                                    video_format=video_format)
                if ok2:
                    self._emit_progress("Agent: Migrated legacy layers→composition.")
                    result["sub_visuals"] = svs2
                    return result
            except Exception:
                pass

        result["sub_visuals"] = normalized_svs
        return result
