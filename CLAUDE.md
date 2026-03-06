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

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/sessions` | List active tmux agent sessions |
| `POST` | `/api/sessions` | Create new agent (name, prompt, workdir, resumeSessionId) |
| `PATCH` | `/api/sessions/:name` | Rename agent or change workspace |
| `DELETE` | `/api/sessions/:name` | Kill agent + remove from sessions.json |
| `GET` | `/api/claude-sessions` | List Claude session history for resume picker |
| `GET` | `/api/slash-commands` | Built-in + custom slash commands |
| `GET` | `/api/debug` | Debug info (raw tmux output for a session) |
| `GET` | `/api/agent-docs/:name` | List docs for an agent |
| `GET` | `/api/agent-docs/:name/:doc` | Read a specific agent doc |
| `PUT` | `/api/agent-docs/:name/:doc` | Write/update an agent doc |
| `POST` | `/api/agent-docs/:name/:doc/move-to-local` | Copy doc to `~/.claude/docs/` |
| `DELETE` | `/api/agent-docs/:name/:doc` | Delete an agent doc |
| `GET` | `/api/ceo-md` | Read `claude-ceo.md` |
| `PUT` | `/api/ceo-md` | Write `claude-ceo.md` |
| `GET` | `/api/claude-files` | List `.claude/` files by category |
| `GET` | `/api/claude-files/read` | Read a file from `.claude/` |
| `PUT` | `/api/claude-files/write` | Write a file in `.claude/` |
| `POST` | `/api/upload` | Upload image file |
| `POST` | `/api/notify` | Send notification to user (title, message, sound) |
| `GET` | `/api/todos` | List all todo lists + colors |
| `POST` | `/api/todos` | Create todo list (title, colorId, content, agent) |
| `PUT` | `/api/todos/:id` | Update todo list (title, colorId, content, agent) |
| `DELETE` | `/api/todos/:id` | Delete a todo list |
| `PUT` | `/api/todos/:id/reorder` | Reorder a list (newOrder) |
| `PUT` | `/api/todo-colors` | Update color palette (colors array) |
| `GET` | `/api/todos/by-agent/:agent` | Get todos touched by a specific agent |
| `POST` | `/api/shell/completions` | File/dir autocomplete for embedded terminal |
| `POST` | `/api/shell/open-finder` | Open a folder in Finder from shell CWD pill |
| `POST` | `/api/open-url` | Route external URL to in-app browser overlay via WebSocket |
| `GET` | `/api/system-info` | Dashboard version, Node, OS, agent count, configured bug report repo |
| `POST` | `/api/bug-report` | Create GitHub issue via `gh` CLI (title, description, severity, systemInfo) |

## WebSocket Messages

**Client → Server:**
- `{ type: "input", session, text }` — send text input to agent
- `{ type: "input-with-images", session, text, paths }` — send text + image paths
- `{ type: "keypress", session, keys }` — send raw tmux key names (for interactive prompts)
- `{ type: "type-option", session, keys, text }` — navigate to option + type text
- `{ type: "refresh", session }` — request immediate output refresh
- `{ type: "shell-stdin", data }` — send raw bytes to embedded shell PTY
- `{ type: "shell-resize", cols, rows }` — resize shell PTY

**Server → Client:**
- Binary WebSocket frames — shell PTY data (no JSON wrapper, highest frequency)
- `{ type: "sessions", sessions }` — full session list (sent on connection)
- `{ type: "output", session, lines, status, promptType, promptOptions, workdir, branch, isWorktree }` — terminal output update
- `{ type: "todo-update", data }` — todo data changed (full state: `{ lists, colors }`)
- `{ type: "shell-info", cwd, branch, isWorktree, prUrl }` — shell CWD/branch/PR updates
- `{ type: "open-url", url }` — open URL in in-app browser overlay (native app) or new tab (browser)

## Releasing Updates

The dashboard has an auto-update system. Users see an "Update Available" button whenever `main` has new commits they don't have.

To push an update: just push to `main`. That's it. The update button appears automatically for all users on their next check.

- The server auto-detects the correct git remote for `john-farina/claude-cli-dashboard` (works for direct clones, forks, and any remote layout). It checks `upstream` then `origin`, and adds an `upstream` remote automatically if needed.
- Dashboards run `git fetch <remote> main` every hour (and on every server restart) to check for new commits
- The button shows the number of commits behind (e.g. "Update (3 new commits)")
- Hovering shows commit summaries + release notes (if any) in a tooltip
- Clicking checks you're on `main` branch first, then runs `git merge <remote>/main`, installs deps if needed, and restarts
- If on a feature branch, shows a "Wrong Branch" error with instructions to checkout main

**Optional: GitHub Releases** — If you create a GitHub Release (with a tag like `v0.3.0`), its release notes body will show in the hover tooltip alongside commit summaries. This is purely cosmetic — updates are triggered by commits, not releases.

### Update Conflict Resolver

When "Update" fails due to dirty workdir or merge conflicts, a modal lets the user spawn a Claude agent that auto-resolves conflicts while preserving local customizations. The agent gets the full `git diff` embedded in its prompt, saves a backup to memory, asks the user about ambiguous conflicts, and restarts the server after approval.

**Full details:** Read `dev-docs/update-conflict-resolver.md`

## Contributing a PR

When a user asks to create a PR (e.g. "make a PR for my changes", "submit this as a PR"), handle the entire workflow automatically. **Most users are contributors without push access** — `gh pr create` handles fork creation automatically.

1. **Create a feature branch** off the current branch: `git checkout -b <descriptive-branch-name>` (e.g. `fix-version-manager-loading`, `add-dark-mode-toggle`). Use lowercase kebab-case. Never push directly to `main`.
2. **Stage and commit** the relevant changes with a clear commit message summarizing what changed and why.
3. **Create the PR** with `gh pr create --base main --head <branch-name>`. This single command handles everything — it will auto-fork the repo under the user's GitHub account if needed, push the branch to their fork, and open the PR against `john-farina/claude-cli-dashboard:main`. No manual forking or remote setup required.
   - **Title**: Short, clean, imperative (e.g. "Fix version list failing to load on first open"). Under 70 chars.
   - **Body**: Summary of what changed and why, formatted with `## Summary` and `## Test plan` sections.
4. Return the PR URL to the user.

**Do NOT** manually run `git push`, set up remotes, run `gh repo fork`, or check for existing forks. Just `gh pr create` — it handles all of that.

## Common Tasks

### Change CEO agent instructions
Edit `claude-ceo.md`. Changes apply to new agents only (existing ones keep their original prompt).

### Add a new output filter
Add logic inside `filterOutputForDisplay()` in `server.js`. The function receives an array of lines and returns filtered lines. Apply BEFORE the prompt detection (which looks at the last 15 lines).

### Add a new prompt type
1. Add detection pattern in `detectPromptType()` in `server.js` (return a new string)
2. Add button rendering in `updateStatus()` in `app.js` (new `else if` branch)
3. Add button styles in `style.css` (follow `.prompt-btn-*` pattern)

### Add a new API endpoint
Add in `server.js` after the existing endpoint blocks. If it reads/writes to `docs/`, use `ensureDocsDir()`. If it accesses `~/.claude/`, use `isAllowedPath()` for validation.

### Add a new card section
1. Add HTML in the card template string in `addAgentCard()` (in `app.js`)
2. Wire up event listeners in the same function (after the template)
3. Add styles in `style.css` (follow existing `.agent-doc-*` pattern)

### Change CSS theme
All colors are CSS variables in `:root` at the top of `style.css`. Change there for global effect.

## File Browser Panel
- Opens from the `.claude` button in the header
- Reads from `~/.claude/` (docs, commands, agents, memory, settings)
- Also shows "CEO Docs" category from `docs/` directory
- `isAllowedPath()` gates read/write — add new allowed paths there if needed
- Markdown files render by default with Raw/Rendered toggle (uses `marked` + `github-markdown-css`)

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

## Mobile Support

Fully usable on phones (iOS Safari). Styles in `@media (max-width: 600px)` and `@media (max-width: 900px)` in `style.css`. Includes fullscreen agent view, touch targets, cross-device input sync, and mobile button swaps.

**Full details:** Read `dev-docs/mobile-support.md`

## Native macOS App (`native-app/`)

Compiled Swift binary with WKWebView loading `localhost:9145`. Custom Dock icon, in-app browser overlay for external URLs, CLI browser interception, server auto-start, and reload via DistributedNotification.

Key files: `main.swift`, `build.sh`, `generate-icon.py`, `open-url.sh`

**Full details:** Read `dev-docs/native-app.md`

## Embedded Shell Terminal

Full PTY-backed terminal in the footer panel using `node-pty` + `xterm.js` with binary WebSocket protocol. Features custom Tab autocomplete, click-to-position cursor, selection-based editing, `claude` command interception (opens new agent modal), and URL interception.

**Full details:** Read `dev-docs/embedded-shell.md`

## UI/UX Guidelines for New Modals & Components

Covers CSS specificity rules (`.hidden` pattern), modal standards, button patterns, state screens (loading/empty/error), existing utilities (`shortPath`, `escapeHtml`), and third-party library dark theme overrides.

**Full details:** Read `dev-docs/ui-ux-guidelines.md`

## Debugging Hard-to-Reproduce Issues

Playbook for visual glitches, focus loss, scroll jumps, and intermittent UI bugs. Covers diagnostic logging, server log locations (`/tmp/ceo-dashboard.log`), event chain tracing, common root causes table, and a worked example of three related scroll/focus bugs.

**Full details:** Read `dev-docs/debugging-guide.md`

## Key Technical Notes

- **Unicode**: Claude's prompt uses `❯` (U+276F), not `>` (U+003E)
- **tmux survives node restarts**: tmux sessions persist independently. The server re-attaches to them.
- **tmux `remain-on-exit on`**: Panes stay alive when commands exit, so crash errors are visible
- **tmux `history-limit 50000`**: Large scrollback for full agent output history
- **`CLAUDECODE` env var**: Unset before launching Claude to prevent nested Claude Code detection
- **Worktree detection**: Claude Code doesn't `cd` into worktrees — it passes `cwd:` to Bash tool. So `#{pane_current_path}` never changes. Worktrees are detected by scanning terminal output for `.claude/worktrees/` paths.
- **Session file scanning**: `sessions-index.json` is often stale. The dashboard reads `.jsonl` files directly, parsing first 32KB (firstPrompt) and last 16KB (lastPrompt, branch, cwd).
