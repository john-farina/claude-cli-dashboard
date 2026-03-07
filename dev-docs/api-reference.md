# API Endpoints

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

# WebSocket Messages

**Client -> Server:**
- `{ type: "input", session, text }` -- send text input to agent
- `{ type: "input-with-images", session, text, paths }` -- send text + image paths
- `{ type: "keypress", session, keys }` -- send raw tmux key names (for interactive prompts)
- `{ type: "type-option", session, keys, text }` -- navigate to option + type text
- `{ type: "refresh", session }` -- request immediate output refresh
- `{ type: "shell-stdin", data }` -- send raw bytes to embedded shell PTY
- `{ type: "shell-resize", cols, rows }` -- resize shell PTY

**Server -> Client:**
- Binary WebSocket frames -- shell PTY data (no JSON wrapper, highest frequency)
- `{ type: "sessions", sessions }` -- full session list (sent on connection)
- `{ type: "output", session, lines, status, promptType, promptOptions, workdir, branch, isWorktree }` -- terminal output update
- `{ type: "todo-update", data }` -- todo data changed (full state: `{ lists, colors }`)
- `{ type: "shell-info", cwd, branch, isWorktree, prUrl }` -- shell CWD/branch/PR updates
- `{ type: "open-url", url }` -- open URL in in-app browser overlay (native app) or new tab (browser)
