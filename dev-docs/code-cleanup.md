# Code Cleanup — Module Architecture

The codebase was refactored from 3 monolithic files into a modular structure. Zero regressions — every API, WebSocket message, localStorage key, and UI behavior stayed identical. No build tools added.

## Results

| File | Before | After | Reduction |
|------|--------|-------|-----------|
| `server.js` | 4,854 lines | 2,490 lines | 49% |
| `public/app.js` | 9,895 lines | 4,473 lines | 55% |
| `public/style.css` | 5,748 lines | 5,741 lines | ~0% (cleanup only) |

## Backend Modules (`lib/`)

| Module | Lines | Purpose |
|--------|-------|---------|
| `lib/security.js` | 157 | Tailscale IP allowlist, input validation, CSRF/IP middleware |
| `lib/tmux.js` | 260 | tmux session management, pane capture, key input |
| `lib/git.js` | 61 | Branch detection, worktree status, cached lookups |
| `lib/output.js` | 248 | ANSI stripping, status/prompt detection, CEO preamble filter |
| `lib/session.js` | 221 | Session CRUD, metadata persistence, restore |
| `lib/claude-sessions.js` | 341 | Session file scanning, ID detection, sync |
| `lib/update.js` | 154 | Auto-update check, version comparison |
| `lib/scrollback.js` | 34 | Shared scrollback buffer management |
| `lib/terminal-cards.js` | 131 | Terminal card PTY manager (tmux-xterm.js bridge) |
| `lib/shell-pty.js` | 311 | Embedded shell PTY, OSC 7, PR URL lookup |

`server.js` is now a thin orchestrator: Express routes + WebSocket wiring. It imports all `lib/` modules, calls `init(config)` on each for shared state (PORT, PREFIX, userConfig, etc.), and uses getter functions for internal state.

## Frontend Modules (`public/js/`)

| Module | Lines | Purpose |
|--------|-------|---------|
| `public/js/theme.js` | 869 | Accent, background, terminal, shell color systems |
| `public/js/modals.js` | 779 | Session picker, config, workdir, modals, drag-drop, paste |
| `public/js/todos.js` | 1,340 | Todo view, color settings, shortcuts, agent todo refs |
| `public/js/settings.js` | 1,826 | Bug report, file browser, auto-update, settings, bookmarks, version manager |
| `public/js/shell.js` | 601 | Embedded shell terminal (xterm.js) |

All functions stay in global scope (no ES modules, no build tools). Scripts are loaded via `<script>` tags in `index.html` in dependency order:

1. CDN libraries (xterm, marked, ansi_up, iro, diff2html)
2. `js/theme.js` — color systems (no deps on app code)
3. `js/modals.js` — session picker, config, workdir, modal management
4. `js/todos.js` — todo view, shortcuts, agent todo refs
5. `js/settings.js` — file browser, auto-update, settings panels, bug report
6. `js/shell.js` — embedded shell terminal
7. `app.js` — DOM init, WebSocket, agent cards, xterm infra, layout, keyboard shortcuts

Cross-file dependencies are safe because all inter-module calls happen inside functions/event handlers (not at parse time). The only top-level code that runs during script evaluation is DOM element queries and event listener registration.

## CSS Cleanup

- Added `--font-mono` CSS variable in `:root` — consolidated 33 hardcoded monospace font stacks
- Removed duplicate `@keyframes dot-blink`
- Consolidated identical `@keyframes bugSpin` and `@keyframes diffSpin` into single `diffSpin`

## Module Communication Pattern

- Modules expose `init(config)` functions for shared state
- Getter functions for internal state (e.g., `getShellPty()`, `getLastShellCwd()`)
- Function parameter injection to avoid circular deps (e.g., `restoreSessions(detectClaudeSessionIdForAgent)`)

## Bug Fixes During Cleanup

**Refresh causes blank screen**: Server restart polling used `/api/sessions` which could return 200 from the old server. Fixed to poll `/api/version` and compare `hotReloadVersion` (unique per server process) to detect the new server.

**Token counter showing dashes**: Server stored per-agent token data at the top level of `token-usage.json` instead of under `agents` key, and didn't track daily deltas. Frontend read `msg.agents` instead of `msg.usage.agents`. Fixed both server storage structure (with migration for existing data) and frontend payload unwrapping.

**Empty state flash on refresh**: Empty state div was visible by default, showing briefly before the page loader covered it or agents loaded. Fixed by starting empty state hidden (`display:none`), gating `updateEmptyState()` behind `_loaderDismissed` flag, and calling `updateEmptyState()` from `dismissPageLoader()`.
