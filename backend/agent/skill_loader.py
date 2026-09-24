import re
import yaml
import hashlib
from pathlib import Path
from backend.core.config import get_workspace_dir, BUNDLE_DIR
from backend.core.logger import logger

from backend.agent.schemas import SkillMetadata

# Chunked skill reading (MCP get_skill section=/brief=): split rendered
# markdown on ## headers so agents can pull one part of a 50KB skill
# instead of the whole file. Files without ## headers are one chunk.
_SECTION_RE = re.compile(r"^##\s+(.+?)\s*$", re.MULTILINE)
_SUBSECTION_RE = re.compile(r"^###\s+(.+?)\s*$", re.MULTILINE)
_BRIEF_SMALL_LIMIT = 10000  # chars: at/below this, brief just returns full text

class Skill:
    def __init__(self, name: str, version: str, when_to_use: str, content: str, file_path: str, description: str = ""):
        self.name = name
        self.version = version
        self.when_to_use = when_to_use
        self.description = description
        self.content = content
        self.file_path = file_path
        self.content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]
        self._mtime = Path(file_path).stat().st_mtime if file_path and Path(file_path).exists() else 0
        
    def __repr__(self):
        return f"<Skill {self.name} v{self.version}>"

    def render(self, **context) -> str:
        """Renders skill markdown with dynamic template variables (e.g. {video_format}, {language}).
        
        Uses safe identifier substitution so JSON schema examples with braces like
        `{"type": "Sequence"}` inside skill markdown are preserved without escaping errors.
        """
        rendered = self.content
        for key, val in context.items():
            if val is not None:
                rendered = rendered.replace(f"{{{key}}}", str(val))
            else:
                rendered = rendered.replace(f"{{{key}}}", "")
        return rendered

    def _split_sections(self, rendered: str) -> list:
        """Split rendered markdown into [{title, body}]. No ## headers →
        single 'full' chunk."""
        matches = list(_SECTION_RE.finditer(rendered))
        if not matches:
            return [{"title": "full", "body": rendered.strip()}]
        chunks = []
        if matches[0].start() > 0:
            preamble = rendered[:matches[0].start()].strip()
            if preamble:
                chunks.append({"title": "Introduction", "body": preamble})
        for i, m in enumerate(matches):
            start = m.end()
            end = matches[i + 1].start() if i + 1 < len(matches) else len(rendered)
            chunks.append({"title": m.group(1).strip(),
                           "body": rendered[start:end].strip()})
        return chunks

    @staticmethod
    def _preview(body: str, limit: int = 220) -> str:
        for line in body.splitlines():
            s = line.strip().lstrip("#*-0123456789. ").strip()
            if len(s) >= 40:
                return s[:limit]
        return body.strip()[:limit]

    def brief(self, **context) -> dict:
        """Compact quick-ref: metadata + per-section TOC (title, size,
        ### subheads, one-line preview). Small skills return full text."""
        rendered = self.render(**context)
        chunks = self._split_sections(rendered)
        sections = []
        for c in chunks:
            subheads = _SUBSECTION_RE.findall(c["body"])
            sections.append({"title": c["title"], "chars": len(c["body"]),
                             "subheads": [s.strip() for s in subheads[:24]],
                             "preview": self._preview(c["body"])})
        out = {"name": self.name, "version": self.version,
               "description": self.description,
               "when_to_use": self.when_to_use,
               "full_chars": len(rendered), "sections": sections}
        if len(rendered) <= _BRIEF_SMALL_LIMIT:
            out["content"] = rendered
        return out

    def render_section(self, query: str, **context) -> dict | None:
        """Fuzzy-find one ## section by title (or ### subhead → enclosing
        section). Returns {title, body, remaining} or None."""
        rendered = self.render(**context)
        chunks = self._split_sections(rendered)
        q = (query or "").strip().lower()
        if not q:
            return None
        q = q.lstrip("§#").strip()
        for c in chunks:  # exact/numbered ## title match first
            t = c["title"].lower()
            if q == t or t.startswith(q) or q in t:
                return {"title": c["title"], "body": c["body"],
                        "remaining": [x["title"] for x in chunks
                                      if x["title"] != c["title"]]}
        for c in chunks:  # then ### subhead → enclosing section
            for s in _SUBSECTION_RE.findall(c["body"]):
                if q in s.lower():
                    return {"title": c["title"],
                            "matched_subhead": s.strip(), "body": c["body"],
                            "remaining": [x["title"] for x in chunks
                                          if x["title"] != c["title"]]}
        # bare number ("5" / "section 5" / "part 5" / "§5") → nth section
        import re as _re
        m = _re.match(r"^(?:(?:section|part|§)\s*)?(\d+)$", q)
        if m:
            idx = int(m.group(1)) - 1
            numbered = [c for c in chunks if c["title"][:1].isdigit()]
            pool = numbered or chunks
            if 0 <= idx < len(pool):
                c = pool[idx]
                return {"title": c["title"], "body": c["body"],
                        "remaining": [x["title"] for x in chunks
                                      if x["title"] != c["title"]]}
        return None

class SkillLoader:
    def __init__(self, skills_dirs: list = None):
        # In development skills live in the workspace; in a frozen build they are
        # bundled read-only under BUNDLE_DIR (_MEIPASS). Prefer the workspace copy
        # (editable) and fall back to the bundle.
        if skills_dirs is not None:
            self.skills_dirs = [Path(d) for d in skills_dirs if Path(d).exists()]
        else:
            candidates = [get_workspace_dir() / "backend" / "skills", BUNDLE_DIR / "backend" / "skills"]
            self.skills_dirs = [d for d in candidates if d.exists()]
        self._skills_cache = {}
        self._load_all_skills()
        
    def _load_all_skills(self):
        """Loads all SKILL.md files from the backend/skills directories.

        Later directories win on name collisions (workspace overrides bundle),
        so iterate bundle first, workspace second.
        """
        if not self.skills_dirs:
            candidates = [get_workspace_dir() / "backend" / "skills", BUNDLE_DIR / "backend" / "skills"]
            self.skills_dirs = [d for d in candidates if d.exists()]
            if not self.skills_dirs:
                get_workspace_dir().joinpath("backend", "skills").mkdir(parents=True, exist_ok=True)
                self.skills_dirs = [d for d in candidates if d.exists()]
                if not self.skills_dirs:
                    return

        for skills_dir in reversed(self.skills_dirs):
            for skill_folder in skills_dir.iterdir():
                if skill_folder.is_dir():
                    skill_file = skill_folder / "SKILL.md"
                    if skill_file.exists():
                        self._parse_and_load(skill_file)

    def reload_skills(self):
        """Forces a full reload of all skills from disk."""
        self._skills_cache.clear()
        self._load_all_skills()

    def _parse_and_load(self, file_path: Path):
        try:
            content = file_path.read_text(encoding="utf-8")
            
            # Simple frontmatter parser
            if content.startswith("---"):
                parts = content.split("---", 2)
                if len(parts) >= 3:
                    frontmatter = parts[1]
                    body = parts[2].strip()
                    raw_meta = yaml.safe_load(frontmatter) or {}
                    
                    if not raw_meta.get("name"):
                        raw_meta["name"] = file_path.parent.name
                    
                    meta = SkillMetadata.model_validate(raw_meta)
                    skill = Skill(
                        name=meta.name,
                        version=meta.version,
                        when_to_use=meta.when_to_use or "",
                        content=body,
                        file_path=str(file_path),
                        description=meta.description or ""
                    )
                    self._skills_cache[meta.name] = skill
                    if file_path.parent.name != meta.name:
                        self._skills_cache[file_path.parent.name] = skill
                    logger.debug(f"Loaded skill: {meta.name} (v{meta.version})")
                    return
            
            # Fallback if no valid frontmatter
            name = file_path.parent.name
            skill = Skill(name, "1.0", "", content.strip(), str(file_path))
            self._skills_cache[name] = skill
            logger.debug(f"Loaded skill without frontmatter: {name}")
            
        except Exception as e:
            logger.error(f"Failed to parse skill at {file_path}: {e}")
            
    def get_skill(self, name: str, context: str = "preload") -> Skill:
        """Retrieves a skill by name. Checks for on-disk file modifications.

        context: 'preload' (default) when the skill is read to assemble a
        system prompt before any LLM execution; 'tool' when the skill was
        requested by an explicit agent tool call (get_skill). The telemetry label makes this distinction
        visible in the activity feed.
        """
        skill = self._skills_cache.get(name)

        # Check if modified on disk and reload if needed
        if skill and skill.file_path:
            p = Path(skill.file_path)
            if p.exists() and p.stat().st_mtime > skill._mtime:
                self._parse_and_load(p)
                skill = self._skills_cache.get(name)

        if not skill:
            # Check if a new folder was added since startup
            self._load_all_skills()
            skill = self._skills_cache.get(name)

        from backend.agent.telemetry import emit_activity
        if skill:
            label = "Agent Tool Call" if context == "tool" else "System Prompt Preload"
            emit_activity("skill", name, f"{label} (v{skill.version})", "ok",
                          args={"version": skill.version, "scope": context})
        else:
            emit_activity("skill", name, "not found", "error",
                          args={"version": None, "scope": context})
        return skill

    def render_skill(self, name: str, **context) -> str:
        """Loads a skill and renders its markdown content with the provided context dictionary."""
        skill = self.get_skill(name)
        if not skill:
            logger.warning(f"Skill '{name}' not found for rendering.")
            return ""
        return skill.render(**context)

    def get_all_skills(self) -> dict:
        """Returns the dictionary of all loaded skills."""
        return self._skills_cache


# Singleton instance
skill_loader = SkillLoader()

