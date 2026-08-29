import os
import yaml
import hashlib
from pathlib import Path
from backend.core.config import get_workspace_dir, BUNDLE_DIR
from backend.core.logger import logger

class Skill:
    def __init__(self, name: str, version: str, when_to_use: str, content: str, file_path: str):
        self.name = name
        self.version = version
        self.when_to_use = when_to_use
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
                    meta = yaml.safe_load(frontmatter) or {}
                    
                    name = meta.get("name", file_path.parent.name)
                    version = str(meta.get("version", "1.0"))
                    when_to_use = meta.get("when_to_use", "")
                    
                    skill = Skill(name, version, when_to_use, body, str(file_path))
                    self._skills_cache[name] = skill
                    if file_path.parent.name != name:
                        self._skills_cache[file_path.parent.name] = skill
                    logger.debug(f"Loaded skill: {name} (v{version})")
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

