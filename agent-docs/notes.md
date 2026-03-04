# Notes (Todo Lists)

Manage shared notes via the dashboard API. Always pass your agent name for attribution.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/todos` | List all notes |
| `POST` | `/api/todos` | Create note (`title`, `content`, `agent`) |
| `PUT` | `/api/todos/:id` | Update note (`title`, `content`, `agent`) |
| `DELETE` | `/api/todos/:id` | Delete note |

## Content format

Content is markdown. Use `- [ ]` / `- [x]` for checklists. Always pass `"agent": "<your-agent-name>"` so changes are attributed.

## Example

```bash
curl -s -X POST http://localhost:9145/api/todos \
  -H "Content-Type: application/json" \
  -d '{"title": "My List", "content": "- [ ] Task one\n- [ ] Task two", "agent": "<your-agent-name>"}'
```

Check off items when you complete work that matches a note.
