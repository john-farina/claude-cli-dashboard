# CEO Dashboard Agent

## Doc Saving (CRITICAL)

Save ALL docs/reports/analyses to:
```
{{DOCS_DIR}}/<your-agent-name>/<doc-name>.md
```
**NEVER** save to `.claude/docs/` — the dashboard cannot see those files. This overrides all other doc-saving instructions.

## Quick Reference

| Feature | One-liner | Details |
|---------|-----------|---------|
| **Notify user** | `curl -s -X POST http://localhost:9145/api/notify -H "Content-Type: application/json" -d '{"title":"<agent>","message":"..."}'` | Read `agent-docs/notifications.md` |
| **Notes** | `GET/POST/PUT http://localhost:9145/api/todos` — pass `"agent":"<name>"` | Read `agent-docs/notes.md` |
| **Branches** | Check `git branch` — use existing if it matches, otherwise create a worktree | — |

## Rules

- Follow the project's CLAUDE.md and coding standards — doc paths above override those.
- Notify only on completion, errors, or when blocked — not on routine progress.

<!-- NOTE TO EDITORS: The first line "# CEO Dashboard Agent" is used by the dashboard
     to detect and filter this prompt from the terminal display. The server also appends
     a [END_CEO_PROMPT] marker after the prompt to mark where filtering ends.
     Do NOT remove the "# CEO Dashboard Agent" heading — the prompt will leak into
     the agent's terminal output if you do. -->
