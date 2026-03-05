# CEO Dashboard — Developer Guide

> **NOTE:** This file is for developers working ON the dashboard itself.
> It is NOT read by dashboard agents — they run from different working directories.
> Agent instructions live in `claude-ceo.md` (injected into agent prompts by the server).

## Architecture

Single-page Node.js app with 4 files:

| File | Purpose |
|------|---------|
| `server.js` | Express + WebSocket server, tmux management, all API endpoints |
| `public/app.js` | Frontend logic — cards, WebSocket, modals, doc viewer |
| `public/style.css` | All styles (dark theme, CSS variables in `:root`) |
| `public/index.html` | Shell HTML — modals, file browser panel, CDN scripts |

Supporting files:
- `claude-ceo.md` — Instructions injected into every agent's initial prompt
- `sessions.json` — Persisted agent metadata (name, workdir, created, resumeSessionId)
- `docs/` — Agent-generated documents, organized as `docs/<agent-name>/<doc>.md`
- `todos.json` — Persisted todo lists with agent attribution (`createdBy`, `lastModifiedBy`, `agentHistory`)

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

**Image Drag-and-Drop**:
- Drop images on terminal or input area → uploads via `POST /api/upload`
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

**Bug Report** (header button, keyboard shortcut `B`):
- Modal collects title, description, steps to reproduce, severity (low/medium/high/critical), optional screenshot
- Auto-loads system info via `GET /api/system-info` (version, branch, Node, OS, active agents)
- Creates GitHub issues via `POST /api/bug-report` using `execFile("gh", args)` (no shell — prevents injection)
- Target repo configurable via `bugReportRepo` in `config.json` (defaults to `john-farina/claude-cli-dashboard`)
- Success modal offers to spawn a fix agent with the bug context as its initial prompt
- System info panel uses proper state screens (spinner/content/error+retry per UI guidelines)

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

- Dashboards run `git fetch origin main` every hour (and on every server restart) to check for new commits
- The button shows the number of commits behind (e.g. "Update (3 new commits)")
- Hovering shows commit summaries + release notes (if any) in a tooltip
- Clicking runs `git merge origin/main`, installs deps if needed, and restarts

**Optional: GitHub Releases** — If you create a GitHub Release (with a tag like `v0.3.0`), its release notes body will show in the hover tooltip alongside commit summaries. This is purely cosmetic — updates are triggered by commits, not releases.

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

The dashboard is fully usable on phones (primarily iOS Safari). Mobile has its own breakpoints, touch targets, and feature swaps. All mobile styles live in `@media (max-width: 600px)` in `style.css`. There's also a `@media (max-width: 900px)` for single-column grid.

### Design Principles
- **Touch targets**: All interactive elements must be at least 36×36px (44px preferred for primary actions like send, prompt buttons)
- **No new windows**: `window.open()` doesn't work well on iOS. Features that use popout windows on desktop must have an in-page alternative on mobile.
- **Font size ≥ 14px on inputs**: Prevents iOS Safari auto-zoom on focus. All `<textarea>` and `<input>` in mobile breakpoint use `font-size: 14px+`.
- **`100dvh` over `100vh`**: Use dynamic viewport height (`dvh`) for fullscreen layouts — `100vh` includes the iOS URL bar height, `100dvh` adjusts as it hides/shows. Always include `100vh` as a fallback before `100dvh`.

### Mobile-Specific Features

**Fullscreen Agent View** (`.expand-btn` / `.agent-card.fullscreen`):
- Replaces desktop's popout-to-new-window (which doesn't work on mobile)
- `.expand-btn` is `display: none` by default, shown via `display: flex !important` in the mobile media query
- Hidden on `.agent-card.minimized` (added to the minimized hide list alongside restart/popout/favorite)
- Click toggles `.fullscreen` class on the card + swaps icon (⛶ `\u26F6` ↔ ✕ `\u2715`)
- Fullscreen state: `position: fixed; inset: 0; z-index: 100; height: 100dvh`
- `document.body.style.overflow = "hidden"` prevents background scroll while fullscreen
- Terminal gets `min-height: 0; flex: 1 1 0` in fullscreen so it fills all available space (without this, `min-height: 100px` from base styles constrains it)
- Escape key exits fullscreen (handled first in the global Escape chain, before modals)
- `scheduleMasonry()` called on exit to re-layout the grid

**Button Visibility Swaps** (mobile media query):
- Hidden on mobile: `.popout-btn`, `.restart-btn` (`display: none !important`)
- Shown on mobile: `.expand-btn` (`display: flex !important`)
- All non-minimized card action buttons get `min-width: 36px; min-height: 36px` for touch

**Header Layout**:
- Wraps to two rows (`flex-wrap: wrap`)
- `position: static` instead of sticky (saves screen space)
- Secondary buttons flex to fill width, primary button full-width below

**Card Defaults**:
- Height: `350px` (vs 500px desktop)
- `card-sticky-top` becomes `position: static` (no sticky header inside small cards)
- Terminal font: `11px`, `pre-wrap` for long lines

### Cross-Device Input Sync
- When a user types on one device, `input-sync` WebSocket messages update the textarea on all other connected clients
- On receiving `input-sync` with non-empty text, `scrollTerminalToBottom()` is called so the terminal scrolls down to keep the input area visible (important for mobile where the card is short)
- Desktop textarea auto-grows so this is less of an issue there, but mobile benefits from the scroll

### Adding Mobile-Aware Features
1. **New buttons**: If a button shouldn't appear on mobile, add it to the `display: none !important` list in the mobile media query. If it replaces a desktop button, add `display: flex !important` for mobile.
2. **New card states** (like `.fullscreen`): Must handle `position: fixed` + `z-index` correctly, lock body scroll, and have an exit path (both button and Escape key).
3. **New interactive elements**: Ensure `min-height: 44px` touch targets in the mobile media query.
4. **Modals**: Must be scrollable on small screens (`max-height: 80vh; overflow-y: auto`). Input font size ≥ 16px to prevent iOS zoom.

## Native macOS App (`native-app/`)

The dashboard has a native macOS desktop app — a compiled Swift binary with a WKWebView that loads `localhost:9145`. It shows as its own app in the Dock with a custom icon (gold Claude star on dark gradient background).

### Files

| File | Purpose |
|------|---------|
| `native-app/main.swift` | Swift app — WKWebView, in-app browser overlay, server auto-start, reload via DistributedNotification |
| `native-app/build.sh` | Compiles Swift, generates `.icns` icon, codesigns, installs to `~/Applications/CEO Dashboard.app` |
| `native-app/generate-icon.py` | Pure-Python PNG renderer — gold Claude star with gradient bg, drop shadow, rounded corners |
| `native-app/entitlements.plist` | Code signing entitlements (network client) |
| `open-url.sh` | Helper script for `BROWSER` env var — POSTs URLs to server for in-app overlay |

### How It Works

- `ceo.sh` (aliased to `ceo`) restarts the server, then either:
  - **Refreshes** the existing app window if it's already running (sends `com.ceo-dashboard.reload` distributed notification → WebView reloads, window comes to front)
  - **Opens** the app fresh if it's not running
- The app auto-starts the Node server if it detects port 9145 is not listening
- Settings panel has an "Add to Dock" button that runs `build.sh` via `POST /api/settings/add-to-dock`

### Icon

Generated by `generate-icon.py` (no external dependencies — pure Python with `struct`/`zlib`):
- 1024×1024 PNG → converted to `.icns` via `sips` + `iconutil`
- Gold accent color (`#C9A84C`) Claude star with vertical gradient (lighter top → deeper bottom)
- Dark background matching dashboard (`#161616` center → `#040404` edges, radial gradient)
- Subtle drop shadow behind the star, macOS-style rounded corners
- Padding is controlled by the `padding` variable in `main()` (currently `0.22`)

### Rebuilding

```bash
# Quit app, rebuild, flush icon cache, relaunch
osascript -e 'tell application "CEO Dashboard" to quit' 2>/dev/null
bash ./native-app/build.sh
killall Dock  # flush icon cache
open ~/Applications/CEO\ Dashboard.app
```

### Key Details
- Bundle ID: `com.ceo-dashboard.app`
- Installed to: `~/Applications/CEO Dashboard.app`
- Favicon (`public/favicon.svg`): Plain Claude star (orange `#d97757`, no background) — separate from the app icon

### In-App Browser Overlay

External URLs (GitHub PRs, Graphite links, etc.) open in a native overlay instead of the system browser. Defined in `main.swift`.

**How it works:**
- `WKUIDelegate.createWebViewWith` routes URLs: external → overlay, localhost → popout window
- Dark semi-transparent backdrop with inset rounded container (nav bar + WKWebView)
- Nav bar: back/forward buttons, URL label, globe (Open in Safari), close (X)
- Uses `WKWebsiteDataStore.default()` for persistent cookies across sessions
- Safari user agent so websites treat it as a real browser
- Escape key closes overlay (capture-phase JS `keydown` handler injected via `WKUserScript`)
- Keyboard focus managed: `makeFirstResponder(bWebView)` on open, `makeFirstResponder(webView)` on close

**CLI browser interception:**
- `BROWSER` env var set to `./open-url.sh` in `server.js` (both `process.env` and `tmux set-environment -g`)
- When CLI tools (e.g., `gt submit`, `gh auth`) open a URL, the script POSTs to `POST /api/open-url`
- Server broadcasts via WebSocket → `window.open(url, "_blank")` → native overlay intercepts it
- Works for both the embedded shell terminal and agent tmux sessions

**Passkeys / WebAuthn — NOT SUPPORTED:**
- `com.apple.developer.web-browser` is a **restricted entitlement** that Apple only grants to approved browser apps
- Even with the entitlement embedded in the binary, macOS ignores it without a provisioning profile authorizing it
- Xcode's automatic signing also rejects it: `"Mac Team Provisioning Profile: *" doesn't include the com.apple.developer.web-browser entitlement`
- Diagnostic confirmed: `PublicKeyCredential: true` but `PlatformAuth: false` — API exists but platform authenticator blocked
- **Workaround**: Globe icon in overlay bar opens current page in Safari for passkey-required auth
- Do NOT attempt to fix this with different signing approaches — it's an Apple platform restriction

### Agent Terminal Input

Arrow keys and Enter in agent terminal cards send commands to tmux (not scroll):
- `keydown` handler maps `ArrowUp`→`Up`, `ArrowDown`→`Down`, `ArrowLeft`→`Left`, `ArrowRight`→`Right`, `Enter`→`Enter`
- Calls `sendKeypress(name, keyMap[e.key])` with `e.preventDefault()`
- Enables navigating Claude's interactive prompts (MCP selections, AskUserQuestion options)

### Card Order Persistence

Card layout order persists across reloads via `localStorage` key `"ceo-card-order"`:
- `saveCardOrder()` called after drag-drop, card deletion, and `reorderCards()`
- `loadCardOrder()` returns saved array of agent names
- `reorderCards()` prioritizes: saved order → favorites → DOM order for new cards

## Embedded Shell Terminal

The footer shell panel is a full PTY-backed terminal (not just an agent viewer). It uses `node-pty` on the server and `xterm.js` on the client with a binary WebSocket protocol.

### Architecture
- **Server**: `node-pty` spawns a login shell (`zsh`). PTY data flows as raw binary WebSocket frames (no JSON) for zero-overhead streaming. Adaptive batching uses an array of chunks (not string concatenation) — sends first chunk immediately (keystroke echo) and coalesces during bursts (4ms window).
- **Client**: `xterm.js v5.5.0` with WebGL addon. Binary frames arrive as `ArrayBuffer`, written directly to xterm as `Uint8Array` (bypasses JS string decode). All other messages (agent output, shell-info, etc.) remain JSON text frames.
- **Shell input**: Client sends keystrokes as binary frames (`0x01` prefix + UTF-8 payload) — server detects `Buffer`/`ArrayBuffer` and writes directly to PTY, skipping JSON.parse entirely. JSON `shell-stdin` kept as fallback.
- **Scrollback**: Chunked array on server (50KB limit, compacts at 1.2x). Replayed as 32KB binary chunks on client connect.
- **Git info**: All git lookups are async (`getGitInfoAsync`) with a 5s cache — never blocks the event loop.
- **CWD/Branch detection**: OSC 7 escape sequences emitted by an injected `precmd` hook. Git info fetched async with 150ms debounce. PR URL looked up via `gh pr view` and converted to Graphite URL.

### Custom Autocomplete Dropdown
Tab does NOT send `\t` to the shell. Instead it triggers a custom autocomplete system:
1. Client reads the current word from the xterm buffer
2. `POST /api/shell/completions` with `{ word, cwd, dirsOnly }` — server does `fs.readdir` + prefix filter
3. Single match → auto-inserts remaining text. Multiple → inserts common prefix, shows styled dropdown.
4. **Arrow keys** navigate the dropdown, **Tab** or **Enter** accepts, **Escape** dismisses.
5. Any other keypress dismisses the dropdown and passes through to the terminal.
6. `cd`/`pushd` commands filter to directories only.
7. Filenames with spaces/special chars are escaped for the shell.

### Click-to-Position Cursor
Clicking on the current command line translates the click position into arrow key sequences (`\x1b[C` / `\x1b[D`) sent to the PTY. Multi-row wrapped commands are handled via xterm's `isWrapped` property. Only activates on single clicks (not drags) when the terminal is scrolled to the bottom.

### Selection-Based Editing
- **Select + Backspace/Delete**: Moves cursor to selection start, sends Delete × selection length
- **Select + type**: Same as above, plus types the replacement character
- **Select + paste**: Handled in `onData` — prefixes pasted text with move+delete sequence
- Uses `getSelectionPosition()` (requires `allowProposedApi: true` in xterm config)
- Only handles single-row selections on the cursor's row

### `claude` Command Interception
When the user types `claude` or `claude <prompt>` + Enter in the shell, it does NOT launch Claude. Instead:
1. Clears the line (`Ctrl+U` + Enter for fresh prompt)
2. Opens the new agent modal
3. Pre-fills the prompt if one was given (e.g., `claude fix the bug` → modal opens with "fix the bug")

### URL Interception
When a shell command (e.g., `gt submit`) calls `open <url>`, the URL opens in the dashboard's popup system instead of launching the system browser directly:
1. A shell function override for `open` is injected into the PTY on startup
2. HTTP/HTTPS URLs are POSTed to `POST /api/shell/open-url`
3. The server broadcasts `{ type: "shell-open-url", url }` to all WS clients
4. The client calls `window.open(url, "_blank")`
5. Non-URL arguments (e.g., `open .`) fall through to the real `command open`

### Shell Header Pills
- **CWD pill** (📂): Click opens Finder to that folder (`POST /api/shell/open-finder`)
- **Branch pill** (⎇): Click copies branch name to clipboard
- **PR link**: "View PR" link appears when `gh pr view` finds a PR (auto-converted to Graphite URL)

### WebSocket Protocol
- **Binary frames (server→client)** = shell PTY data (hot path, zero JSON overhead)
- **Binary frames (client→server)** = shell stdin (`0x01` prefix + UTF-8 payload, skips JSON.parse)
- **Text frames** = JSON for everything else (agent output, shell-info, etc.)
- Client: `ws.binaryType = "arraybuffer"`, checks `event.data instanceof ArrayBuffer`
- Backpressure: server skips send if `client.bufferedAmount > 1MB`
- `popout.js` ignores binary frames (popout windows don't have a shell)

### Performance Notes
- **Key handler fast path**: When no autocomplete dropdown and no text selection, only checks Tab/Escape (skips all other conditionals). Selection state is cached via `onSelectionChange` callback.
- **Autocomplete DOM caching**: Item elements cached in `_acDomItems` array on show — avoids `querySelectorAll` on every arrow key navigation.
- **TextEncoder reuse**: Single `_shellEncoder` instance shared across all `_sendShellStdin` calls.
- **tmux timeout**: 3s (not 10s) to prevent long server freezes if tmux hangs.

### Key API Endpoints (Shell)
| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/shell/completions` | File/dir completions for autocomplete |
| `POST` | `/api/shell/open-finder` | Open a folder in Finder |
| `POST` | `/api/shell/open-url` | Route a URL through the dashboard (broadcasts to WS clients) |

## UI/UX Guidelines for New Modals & Components

### CSS Specificity Rules

**The `.hidden` pattern**: This codebase uses `.hidden { display: none }` to toggle visibility. If you define a base `display` on a class (e.g., `.my-state { display: flex }`), it has the same specificity as `.hidden` and whichever comes last in the file wins. **Always add a compound rule**: `.my-element.hidden { display: none; }` immediately after the base rule.

**No `!important` on component styles.** Use parent-scoped selectors for specificity (e.g., `.diff-modal .d2h-file-collapse { display: none }` not `display: none !important`). The only acceptable `!important` uses are mobile media query visibility swaps.

### Modal Standards

All modals use `.modal` base class:
- **Container**: `background: var(--modal-bg); border: 1px solid var(--border); border-radius: 16px; padding: 28px;` (mobile: `20px`)
- **Title**: `font-size: 17px; font-weight: 700; letter-spacing: -0.3px;`
- **Overlay**: `.modal-overlay` with `background: var(--modal-backdrop); backdrop-filter: blur(6px); z-index: 100`

For full-width modals that set `padding: 0`, headers should use `padding: 18px 24px` (mobile: `12px 16px`).

**Always include context in modal headers** — agent name (`color: var(--accent); font-weight: 600`) and workspace path (use `shortPath()`, never hardcode home dir replacement).

### Use Existing Utilities

- `shortPath(p)` — replaces homedir with `~` cross-platform. Never use `path.replace(/^\/Users\/[^/]+/, "~")`.
- `escapeHtml(s)` / `escapeAttr(s)` — for user-provided text.
- Search `app.js` for existing utilities before writing helpers.

### Button Patterns

| Type | Class / Pattern |
|------|----------------|
| Primary action | `.btn-primary` — gold bg, white text, `padding: 8px 18px; border-radius: 8px` |
| Secondary action | `.btn-secondary` — transparent, dim text, accent border on hover |
| Icon button (close/refresh) | Purpose-built class: `background: none; border: 1px solid transparent; color: var(--text-dim); width: 32px; height: 32px; border-radius: 8px`. Close hover: `color: var(--red); background: rgba(248,113,113,0.08)` |
| Segmented toggle | Container: `background: var(--input-bg); border: 1px solid var(--border); border-radius: 8px; overflow: hidden`. Tabs: `padding: 5px 12px; font-size: 12px`. Active: `background: var(--surface-raised); font-weight: 600` |

**Never reuse semantic classes** (like `.kill-btn`) for unrelated purposes. Never use a single text-swapping button for binary toggles — use a segmented control.

### State Screens (Loading / Empty / Error)

Every async panel needs three states. Layout: `display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 48px–64px 24px; gap: 8px; text-align: center`

Each state needs:
1. **Icon**: Themed circle (`width: 48px; height: 48px; border-radius: 50%`) — green for success/empty, red for error, spinner for loading
2. **Title**: `font-size: 14px; color: var(--text); font-weight: 500`
3. **Sub-text** (optional): `font-size: 12px; color: var(--text-dim)`
4. **Error state must include a retry button** (`.btn-secondary`)
5. **Loading spinner**: CSS border-spinner (`border: 2.5px solid var(--border); border-top-color: var(--accent); animation: spin 0.7s linear infinite`). Never use CSS `content` text animation for dots — it looks janky.

Use a `_setState(state)` function that clears all states then shows the requested one. Always add `.my-state.hidden { display: none; }` rules.

### Third-Party Library Integration

**CDN imports**: Verify the bundle exports the API you actually call. Example: `diff2html.min.js` exports `Diff2Html.html()`, but `diff2html-ui.min.js` exports `Diff2HtmlUI` — a different class. Match import to usage.

**Dark theme overrides**: Third-party libs ship light CSS. Override ALL visible surfaces, scoped under your modal class:
- Backgrounds: code areas → `var(--terminal-bg)`, headers → `var(--surface)`, wrappers → `transparent`
- Text: `var(--text)` / `var(--text-dim)`
- Borders: `var(--border)`
- Font: `"SF Mono", "Fira Code", "Consolas", monospace; font-size: 12px`

**diff2html-specific** (if reused):
- Hide "Viewed" checkbox: `.d2h-file-collapse, .d2h-file-switch { display: none }`
- Hide file list title: `.d2h-file-list-title { display: none }`
- `@@` hunk rows: override blue tint → `background: var(--surface); color: var(--text-dim)`
- Ins/del inner lines: set `.d2h-ins .d2h-code-line { background: transparent }` so parent row color shows through (inner div is narrower than td, creating a visible color gap otherwise)
- Remove `text-decoration` on ins/del content: use background highlighting (`rgba(..., 0.25)`) instead
- Tags: `background: rgba(201,168,76,0.12); color: var(--accent)`

## Key Technical Notes

- **Unicode**: Claude's prompt uses `❯` (U+276F), not `>` (U+003E)
- **tmux survives node restarts**: tmux sessions persist independently. The server re-attaches to them.
- **tmux `remain-on-exit on`**: Panes stay alive when commands exit, so crash errors are visible
- **tmux `history-limit 50000`**: Large scrollback for full agent output history
- **`CLAUDECODE` env var**: Unset before launching Claude to prevent nested Claude Code detection
- **Worktree detection**: Claude Code doesn't `cd` into worktrees — it passes `cwd:` to Bash tool. So `#{pane_current_path}` never changes. Worktrees are detected by scanning terminal output for `.claude/worktrees/` paths.
- **Session file scanning**: `sessions-index.json` is often stale. The dashboard reads `.jsonl` files directly, parsing first 32KB (firstPrompt) and last 16KB (lastPrompt, branch, cwd).
