# Notifications

Send a macOS notification via the dashboard API. Title is always "CEO Dashboard" — your agent name appears as the subtitle.

```bash
curl -s -X POST http://localhost:9145/api/notify \
  -H "Content-Type: application/json" \
  -d '{"title": "<your-agent-name>", "message": "Brief status message"}'
```

## When to notify
- Long task finished (build complete, investigation done, PR ready)
- Error or blocker that needs user attention
- Waiting for user input on something important

## When NOT to notify
- Routine progress (starting a task, reading files)
- Every step of a multi-step process
- Anything the user will see in terminal output immediately

Keep messages short and glanceable.
