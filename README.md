<p align="center">
  <img src="public/favicon.svg" width="80" height="80" alt="CEO Dashboard">
</p>

<h1 align="center">CEO Dashboard</h1>

<p align="center">
  A multi-agent management UI for <a href="https://docs.anthropic.com/en/docs/claude-code">Claude Code</a>.<br>
  Launch, monitor, and orchestrate multiple Claude agents from one screen.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS-black?style=flat-square" alt="macOS">
  <img src="https://img.shields.io/badge/node-%3E%3D18-black?style=flat-square" alt="Node 18+">
  <img src="https://img.shields.io/badge/license-MIT-black?style=flat-square" alt="MIT">
</p>

---

## What It Does

- **Spawn agents** — launch Claude Code instances in any project directory
- **Live terminals** — watch agents work in real-time with full ANSI color
- **Interactive prompts** — answer Allow/Deny, Y/N, and multi-choice prompts from the UI
- **Agent docs** — agents save markdown docs you can browse, search, and export
- **Todo boards** — shared kanban-style todo lists with agent attribution
- **Session resume** — agents survive server restarts and can be resumed with full context
- **Native macOS app** — Dock icon, in-app browser for PR links, keyboard shortcuts
- **Mobile support** — fully usable on phones (iOS Safari)
- **Embedded shell** — built-in terminal with autocomplete, git info, and PR links

## Prerequisites

- **macOS** (Linux support is untested)
- **Node.js 18+** — `node --version` to check
- **Claude Code CLI** — `npm install -g @anthropic-ai/claude-code`

The setup wizard will handle everything else (tmux, python3, npm packages).

## Quick Start

```bash
git clone https://github.com/john-farina/claude-cli-dashboard.git
cd claude-cli-dashboard
npm run setup
```

The setup wizard will walk you through:

| Step | What it does |
|------|-------------|
| **Personal branch** | Creates your branch off `main` so upstream stays clean |
| **Dependencies** | Checks/installs `tmux` and `python3` via Homebrew |
| **npm install** | Installs Express, WebSocket, node-pty |
| **Workspaces** | Configures project directories where agents work |
| **PR links** | Choose Graphite (stacked PRs) or GitHub style |
| **Port** | Dashboard server port (default `9145`) |
| **Config** | Writes `config.json` with your settings |
| **Directories** | Creates `docs/` and `~/.claude/docs/` |
| **Shell alias** | Adds `ceo` command to your shell |
| **Auto-start** | Optional LaunchAgent to start on login |
| **Native app** | Optional macOS app with Dock icon |

After setup:

```bash
source ~/.zshrc
ceo
```

## Usage

Once the dashboard is running, open it at `http://localhost:9145` (or via the native app).

**Creating agents** — click "+ New Agent", give it a name and prompt, pick a workspace.

**Interacting** — type in the input field at the bottom of any agent card. Click prompt buttons for Allow/Deny and multi-choice questions.

**Keyboard shortcuts** — press `?` in the dashboard for a list.

## Contributing

Built something useful? Send it upstream:

```bash
git push -u origin your-branch
```

Then open a pull request. Bug fixes, new features, and UI improvements are all welcome.

## Project Structure

```
claude-cli-dashboard/
├── server.js          # Express + WebSocket server, tmux management
├── public/
│   ├── index.html     # Shell HTML, modals, CDN scripts
│   ├── app.js         # Frontend logic — cards, WebSocket, modals
│   └── style.css      # Dark theme, CSS variables
├── setup.js           # Onboarding wizard
├── ceo.sh             # Shell launcher script
├── claude-ceo.md      # Instructions injected into agent prompts
├── native-app/        # macOS app (Swift + WKWebView)
│   ├── main.swift
│   ├── build.sh
│   └── generate-icon.py
├── config.json        # Your local config (gitignored)
├── sessions.json      # Agent metadata (gitignored)
├── todos.json         # Todo lists (gitignored)
└── docs/              # Agent-generated docs (gitignored)
```

## License

MIT
