# Embedded Shell Terminal

The footer shell panel is a full PTY-backed terminal (not just an agent viewer). It uses `node-pty` on the server and `xterm.js` on the client with a binary WebSocket protocol.

## Architecture
- **Server**: `node-pty` spawns a login shell (`zsh`). PTY data flows as raw binary WebSocket frames (no JSON) for zero-overhead streaming. Adaptive batching uses an array of chunks (not string concatenation) — sends first chunk immediately (keystroke echo) and coalesces during bursts (4ms window).
- **Client**: `xterm.js v5.5.0` with WebGL addon. Binary frames arrive as `ArrayBuffer`, written directly to xterm as `Uint8Array` (bypasses JS string decode). All other messages (agent output, shell-info, etc.) remain JSON text frames.
- **Shell input**: Client sends keystrokes as binary frames (`0x01` prefix + UTF-8 payload) — server detects `Buffer`/`ArrayBuffer` and writes directly to PTY, skipping JSON.parse entirely. JSON `shell-stdin` kept as fallback.
- **Scrollback**: Chunked array on server (50KB limit, compacts at 1.2x). Replayed as 32KB binary chunks on client connect.
- **Git info**: All git lookups are async (`getGitInfoAsync`) with a 5s cache — never blocks the event loop.
- **CWD/Branch detection**: OSC 7 escape sequences emitted by an injected `precmd` hook. Git info fetched async with 150ms debounce. PR URL looked up via `gh pr view` and converted to Graphite URL.

## Custom Autocomplete Dropdown
Tab does NOT send `\t` to the shell. Instead it triggers a custom autocomplete system:
1. Client reads the current word from the xterm buffer
2. `POST /api/shell/completions` with `{ word, cwd, dirsOnly }` — server does `fs.readdir` + prefix filter
3. Single match -> auto-inserts remaining text. Multiple -> inserts common prefix, shows styled dropdown.
4. **Arrow keys** navigate the dropdown, **Tab** or **Enter** accepts, **Escape** dismisses.
5. Any other keypress dismisses the dropdown and passes through to the terminal.
6. `cd`/`pushd` commands filter to directories only.
7. Filenames with spaces/special chars are escaped for the shell.

## Click-to-Position Cursor
Clicking on the current command line translates the click position into arrow key sequences (`\x1b[C` / `\x1b[D`) sent to the PTY. Multi-row wrapped commands are handled via xterm's `isWrapped` property. Only activates on single clicks (not drags) when the terminal is scrolled to the bottom.

## Selection-Based Editing
- **Select + Backspace/Delete**: Moves cursor to selection start, sends Delete x selection length
- **Select + type**: Same as above, plus types the replacement character
- **Select + paste**: Handled in `onData` — prefixes pasted text with move+delete sequence
- Uses `getSelectionPosition()` (requires `allowProposedApi: true` in xterm config)
- Only handles single-row selections on the cursor's row

## `claude` Command Interception
When the user types `claude` or `claude <prompt>` + Enter in the shell, it does NOT launch Claude. Instead:
1. Clears the line (`Ctrl+U` + Enter for fresh prompt)
2. Opens the new agent modal
3. Pre-fills the prompt if one was given (e.g., `claude fix the bug` -> modal opens with "fix the bug")

## URL Interception
When a shell command (e.g., `gt submit`) calls `open <url>`, the URL opens in the dashboard's popup system instead of launching the system browser directly:
1. A shell function override for `open` is injected into the PTY on startup
2. HTTP/HTTPS URLs are POSTed to `POST /api/shell/open-url`
3. The server broadcasts `{ type: "shell-open-url", url }` to all WS clients
4. The client calls `window.open(url, "_blank")`
5. Non-URL arguments (e.g., `open .`) fall through to the real `command open`

## Shell Header Pills
- **CWD pill**: Click opens Finder to that folder (`POST /api/shell/open-finder`)
- **Branch pill**: Click copies branch name to clipboard
- **PR link**: "View PR" link appears when `gh pr view` finds a PR (auto-converted to Graphite URL)

## WebSocket Protocol
- **Binary frames (server->client)** = shell PTY data (hot path, zero JSON overhead)
- **Binary frames (client->server)** = shell stdin (`0x01` prefix + UTF-8 payload, skips JSON.parse)
- **Text frames** = JSON for everything else (agent output, shell-info, etc.)
- Client: `ws.binaryType = "arraybuffer"`, checks `event.data instanceof ArrayBuffer`
- Backpressure: server skips send if `client.bufferedAmount > 1MB`
- `popout.js` ignores binary frames (popout windows don't have a shell)

## Performance Notes
- **Key handler fast path**: When no autocomplete dropdown and no text selection, only checks Tab/Escape (skips all other conditionals). Selection state is cached via `onSelectionChange` callback.
- **Autocomplete DOM caching**: Item elements cached in `_acDomItems` array on show — avoids `querySelectorAll` on every arrow key navigation.
- **TextEncoder reuse**: Single `_shellEncoder` instance shared across all `_sendShellStdin` calls.
- **tmux timeout**: 3s (not 10s) to prevent long server freezes if tmux hangs.

## Key API Endpoints (Shell)
| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/shell/completions` | File/dir completions for autocomplete |
| `POST` | `/api/shell/open-finder` | Open a folder in Finder |
| `POST` | `/api/shell/open-url` | Route a URL through the dashboard (broadcasts to WS clients) |
