# CEO Dashboard — Developer Guide

> **NOTE:** This file is for developers working ON the dashboard itself.
> It is NOT read by dashboard agents — they run from different working directories.
> Agent instructions live in `claude-ceo.md` (injected into agent prompts by the server).

## Architecture

Single-page Node.js app — modular backend (`lib/`) and frontend (`public/js/`), no build tools.

| File | Purpose |
|------|---------|
| `server.js` | Thin orchestrator — Express routes + WebSocket wiring, imports `lib/` modules |
| `lib/*.js` | 10 backend modules (security, tmux, git, output, session, claude-sessions, update, scrollback, terminal-cards, shell-pty) |
| `public/app.js` | Core frontend — DOM init, WebSocket, agent cards, xterm infra, layout |
| `public/js/*.js` | 5 frontend modules (theme, modals, todos, settings, shell) |
| `public/style.css` | All styles (dark theme, CSS variables in `:root`) |
| `public/index.html` | Shell HTML — modals, file browser panel, CDN scripts |

Supporting files:
- `claude-ceo.md` — Instructions injected into every agent's initial prompt
- `sessions.json` — Persisted agent metadata (name, workdir, created, resumeSessionId)
- `docs/` — Agent-generated documents, organized as `docs/<agent-name>/<doc>.md`
- `todos.json` — Persisted todo lists with agent attribution (`createdBy`, `lastModifiedBy`, `agentHistory`)

**Full module breakdown:** Read `dev-docs/code-cleanup.md`

## How It Works

### Agent Lifecycle
1. User creates agent via modal → `POST /api/sessions`
2. Server creates tmux session, launches `claude` CLI inside it
3. `claude-ceo.md` content is sandwiched around the user's prompt (before + doc-save reminder after)
4. Server polls tmux pane output every 500ms, broadcasts via WebSocket
5. Frontend renders ANSI output as HTML with ANSI color support (ansi_up library)
6. Status detection runs on every poll — drives status pills and prompt action buttons
7. On server restart, `restoreSessions()` resumes agents via `--resume` with auto-detected session IDs

### Session Persistence & Resume
- `sessions.json` stores each agent's `name`, `workdir`, `created`, and `resumeSessionId`
- **Session ID auto-detection**: `syncClaudeSessionIds()` runs every 30s, scans `~/.claude/projects/*/*.jsonl` to find each agent's Claude session ID by matching workdir + creation time
- On server restart:
  - If tmux session is still alive (tmux survives node restarts): keeps it, backfills session ID if missing
  - If tmux session is dead: detects session ID → `claude --resume <id>` (full context restored)
  - Fallback: bare `claude` if no session ID found (last resort, loses context)
- Agents persist across server restarts indefinitely until explicitly killed

### Key Systems

**Status Detection** (`detectStatus`):
- Scans last 15 non-empty lines of terminal output (stripped of ANSI codes)
- Priority order:
  1. `waiting` — interactive prompts: Allow/Deny, Y/N, "Enter to select", numbered TUI options (`❯ 1.`)
  2. `working` — `esc to interrupt` present in last lines
  3. `idle` — `❯` prompt found (may not be last line — status bar sits below it)
  4. `asking` — `❯` prompt with a `?`-ending line above it
- **Important**: `❯` (U+276F) is present even while Claude is working (dimmed). Check `esc to interrupt` BEFORE `❯`.
- **Important**: Interactive TUI selections show `❯ 1. Option` — the `❯` prefix distinguishes them from regular numbered lists in output.

**Prompt Detection** (`detectPromptType`):
- Only runs when status is `waiting`
- Types: `permission` (Allow/Deny), `yesno`, `enter`, `question` (AskUserQuestion + numbered options)
- `question` type: `parsePromptOptions()` extracts numbered options, frontend renders clickable buttons
- "Type something" / "Other" options render as inline text inputs instead of buttons
- `keypress` WebSocket message sends raw tmux key names (all keys in one `send-keys` command to avoid escape sequence race conditions)
- `type-option` WebSocket message: navigates to option via arrow keys, waits 400ms, then types text

**Output Filtering** (`filterOutputForDisplay`):
- `filterCeoPreamble()` — strips CEO instructions from displayed output. Matches from `# CEO Dashboard Agent` (or `MANDATORY RULES`) through `[END_CEO_PROMPT]` end marker. The server appends this marker to all injected prompts. Includes fallback logic for older prompts without the marker.
- Prompt filter — strips Claude's `❯` input prompt lines (we have our own input field)
- Applied to all 3 WebSocket output paths (broadcast, initial connection, push after creation)

**Terminal Features**:
- ANSI color rendering via `ansi_up` library
- Clickable file paths (`vscode://file/...`) and URLs in terminal output (`linkifyTerminal()`)
- Typing in terminal auto-focuses the input field (keydown handler on `.terminal`)
- Drag-and-drop images onto terminal or input area

**Agent Docs** (multi-doc per agent):
- Stored in `docs/<agent-name>/<doc-name>.md` subdirectories
- API: `GET /api/agent-docs/:name` (list), `GET /:name/:doc` (read), `PUT /:name/:doc` (write), `DELETE /:name/:doc`
- Badge on each card shows doc count, polls every 8s
- Doc viewer: list → detail navigation with rendered markdown (via `marked` library) and raw toggle
- "Move to Local Docs" copies to `~/.claude/docs/`
- Doc section is resizable (drag handle) and collapsible

**Image Drag-and-Drop & Clipboard Paste**:
- Drop images on terminal or input area → uploads via `POST /api/upload`
- Paste images from clipboard (e.g. screenshots) into agent input or new agent modal textarea
- Saved to `/tmp/ceo-dashboard-uploads/` with timestamp prefix
- Shows as chips with X to remove before sending
- File paths are prepended to the next message sent to Claude

**Session Resume Picker**:
- Scans `~/.claude/projects/*/*.jsonl` files directly (NOT `sessions-index.json` — it's often stale)
- `parseSessionFile()` reads first 32KB for firstPrompt + last 16KB for lastPrompt/metadata
- Per-file cache keyed on mtime for performance
- Shows `lastPrompt` as title (most recent user message), `firstPrompt` as dim subtitle
- Searchable by prompt text, branch name
- Shows relative time, branch, file size
- Fetched fresh every time "+ New Agent" modal opens

**Slash Command Autocomplete**:
- Fetched from `GET /api/slash-commands` (built-in + custom from `~/.claude/commands/*.md`)
- Dropdown appears when typing `/` in input field
- Navigate with arrow keys, select with Tab/Enter
- Positioned above input (absolute, bottom: 100%) — `.card-input` must have `overflow: visible`

**Card UI**:
- Resizable cards (drag grip at bottom) with layout persistence in localStorage
- Minimize/expand toggle
- Double-click kill confirmation (first click arms → red "kill" label, second click within 2s confirms)
- Live branch display: gray for regular repos, green for worktrees
- Live workdir updates from `getEffectiveCwd()` (detects worktree paths from terminal output)

**Bug Report** (header button, keyboard shortcut `!`): File GitHub issues directly from the dashboard. Collects system info, severity, screenshots. Uses `gh` CLI with `execFile` (no shell injection).

**Full details:** Read `dev-docs/bug-report.md`

**Git/Worktree Detection**:
- `getGitInfo()` — branch name + worktree status (`.git` is a file in worktrees, directory in main repos)
- `detectWorktreePath()` — scans terminal output for `.claude/worktrees/` paths (Claude doesn't `cd` into worktrees, uses `cwd:` args)
- `getEffectiveCwd()` — worktree path > tmux pane cwd > saved metadata
- 5s cache TTL for git info

### Agent Name Handling
- Frontend sanitizes: lowercase, spaces→dashes, strip invalid chars
- Server auto-increments on conflict: `my-agent` → `my-agent-1` → `my-agent-2`
- Name is baked into the CEO reminder (exact doc path with agent name)

## Reference (read on demand)

| Topic | File |
|-------|------|
| API endpoints & WebSocket messages | `dev-docs/api-reference.md` |
| Contributing a PR | `dev-docs/contributing.md` |
| Common tasks (add filters, prompts, endpoints, card sections, settings) | `dev-docs/common-tasks.md` |
| Releasing updates & conflict resolver | `dev-docs/releasing-updates.md` |
| Token optimization (why & how) | `dev-docs/token-optimization.md` |

## Important Paths
- `./` — Dashboard root (all paths below are relative to it)
- `docs/<agent>/<doc>.md` — Agent-generated docs
- `claude-ceo.md` — Agent prompt instructions
- `sessions.json` — Agent persistence (name, workdir, resumeSessionId)
- `todos.json` — Todo lists with colors and agent attribution
- `config.json` — User config (gitignored, created from `config.example.json`)
- `~/.claude/projects/*/*.jsonl` — Claude session history files (source of truth)
- `~/.claude/commands/*.md` — Custom slash commands
- `~/.claude/` — Claude config, docs, commands, memory

## Subsystem Docs (read on demand)

| Subsystem | File |
|-----------|------|
| Mobile support | `dev-docs/mobile-support.md` |
| Native macOS app | `dev-docs/native-app.md` |
| Embedded shell terminal | `dev-docs/embedded-shell.md` |
| UI/UX guidelines | `dev-docs/ui-ux-guidelines.md` |
| Debugging guide | `dev-docs/debugging-guide.md` |
| Bug report system | `dev-docs/bug-report.md` |
| Code cleanup / module breakdown | `dev-docs/code-cleanup.md` |

## Key Technical Notes

- **Unicode**: Claude's prompt uses `❯` (U+276F), not `>` (U+003E)
- **tmux survives node restarts**: tmux sessions persist independently. The server re-attaches to them.
- **tmux `remain-on-exit on`**: Panes stay alive when commands exit, so crash errors are visible
- **tmux `history-limit 50000`**: Large scrollback for full agent output history
- **`CLAUDECODE` env var**: Unset before launching Claude to prevent nested Claude Code detection
- **Worktree detection**: Claude Code doesn't `cd` into worktrees — it passes `cwd:` to Bash tool. So `#{pane_current_path}` never changes. Worktrees are detected by scanning terminal output for `.claude/worktrees/` paths.
- **Session file scanning**: `sessions-index.json` is often stale. The dashboard reads `.jsonl` files directly, parsing first 32KB (firstPrompt) and last 16KB (lastPrompt, branch, cwd).
