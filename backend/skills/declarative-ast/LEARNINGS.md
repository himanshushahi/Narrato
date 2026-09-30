# Learnings Log — declarative-ast

This file captures observed edge cases, new patterns, and corrections discovered during video production.
Reviewed periodically and folded into SKILL.md when confirmed across multiple projects.

Format per entry:
```
## [DATE] [SHORT TITLE]
**Context**: What project / scene type / prompt triggered this
**Observation**: What happened
**Fix / Pattern**: What should change in SKILL.md
**Status**: pending | confirmed | folded
```

---

<!-- New learnings are appended below this line -->

## [2026-09-30] Test: tool self-verification entry
**Context**: Smoke test during system setup
**Observation**: Tool correctly resolves file_path, appends entry, returns ok:True
**Fix / Pattern**: No fix needed. Tool works correctly.
**Status**: folded
