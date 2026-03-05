# Bug Report

Header button (keyboard shortcut `!`) that lets users file GitHub issues directly from the dashboard.

## How It Works

- Modal collects title, description, steps to reproduce, severity (low/medium/high/critical), optional screenshot
- Auto-loads system info via `GET /api/system-info` (version, branch, Node, OS, active agents)
- Creates GitHub issues via `POST /api/bug-report` using `execFile("gh", args)` (no shell — prevents injection)
- Target repo configurable via `bugReportRepo` in `config.json` (defaults to `john-farina/claude-cli-dashboard`)
- Success modal offers to spawn a fix agent with the bug context as its initial prompt
- System info panel uses proper state screens (spinner/content/error+retry per UI guidelines)

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/system-info` | Dashboard version, Node, OS, agent count, configured bug report repo |
| `POST` | `/api/bug-report` | Create GitHub issue via `gh` CLI (title, description, severity, systemInfo) |

## Screenshot Support

- Drag-and-drop or click-to-upload in the modal
- Screenshot is saved locally and its path is included in the issue body
- Preview with remove button before submission

## Severity Labels

Issues are tagged with GitHub labels based on severity:
- `bug` label on all reports
- `priority: critical` or `priority: high` added for those severity levels
- If labels don't exist on the target repo, the issue is retried without labels
