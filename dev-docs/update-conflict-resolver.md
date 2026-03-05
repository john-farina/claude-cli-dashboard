# Update Conflict Resolver

When clicking "Update" fails (dirty workdir or merge conflict), a modal appears with two options:

1. **"Launch Resolver Agent" button** — spawns a Claude agent (`update-fix`) in the dashboard directory with a smart conflict-resolution prompt
2. **"Or fix manually" collapsible** — step-by-step CLI commands with a Copy button

## How the Resolver Agent Works

### Diff Embedding

- The server captures `git diff HEAD` at error time and includes the full diff in the API response (`localDiff` field)
- The client embeds this diff directly into the agent's prompt, so the agent has complete context about every local customization before it runs any commands
- The agent knows exactly what the user changed ("you bound Ctrl+K to kill-agent", "you changed the accent color to blue") and uses that knowledge when resolving conflicts

### Conflict Resolution Logic

The agent follows these rules for each conflict block:

| Situation | Action |
|-----------|--------|
| Both sides add different things (new functions, CSS rules) | Keep both automatically |
| Upstream changed something the user also customized (same hotkey, CSS property, UI element) | **Ask the user** with full context showing both versions |
| Upstream changed something the user didn't touch | Take upstream (required update) |
| User changed something upstream didn't touch | Keep user's version (their customization) |

### Safety Net

- Before touching anything, the agent saves a **complete backup** to its memory file — full code snippets (not summaries) for every local change, plus inferred intent for each
- The agent shows a summary of all resolutions and asks for approval **before committing**
- If the user says something looks wrong:
  - Merge conflict: `git merge --abort` to undo everything
  - Dirty workdir: `git reset --hard HEAD` then `git stash pop` to restore original state
  - Memory backup has the exact snippets to restore manually if needed

### Server Restart

After the merge commit, HEAD matches origin/main so the Update button disappears. The agent handles this by calling `POST /api/restart-server` directly via curl, which restarts the server and auto-reloads the page.

## Large Diff Handling

Server-side truncation in `POST /api/update` (80KB cap ≈ 20K tokens):

| Diff size | What's included in the prompt |
|-----------|-------------------------------|
| < 80KB | Full diff of all files |
| > 80KB, conflict files small | Full diff of conflicting files + names-only list of other modified files |
| > 80KB, even conflict files huge | First 80KB truncated, agent told to `git diff` for full content |

For merge conflicts, the server runs `git diff HEAD -- <conflicting files>` first (most important), then tries the full diff. Non-conflicting files are listed by name only if the full diff exceeds the cap.

For dirty workdir, the server includes `git diff HEAD --stat` (file summary) plus the first 80KB of the actual diff.

## Large Prompt Delivery

Prompts > 8KB (any prompt with an embedded diff) use a Python launcher script instead of inline shell arguments. This is in `createSession()` in `server.js`.

1. Prompt written to `/tmp/ceo-prompt-{name}-{timestamp}.txt`
2. Launcher script written to `/tmp/ceo-launch-{name}-{timestamp}.py`
3. tmux runs the tiny launcher (just a file path — small command)
4. Python reads the prompt file, deletes both temp files, then `os.execvp("claude", ["claude", prompt])`
5. `execvp` replaces the Python process with Claude, passing the prompt as a raw argv element with zero shell interpretation

This avoids shell expansion of `$`, backticks, diff markers (`<<<`, `>>>`), quotes, etc. that would break inline quoting or tmux paste-buffer for large payloads. Small prompts (< 8KB) still use the existing single-quote escape approach.

## Files Involved

| File | What changed |
|------|-------------|
| `server.js` | `POST /api/update` captures `localDiff` + `diffTruncated` for merge-conflict and dirty-workdir errors. `createSession()` uses Python launcher for prompts > 8KB. |
| `public/index.html` | Update error modal: agent button (`#update-error-agent-btn`), agent description (`#update-error-agent-desc`), `<details id="update-error-manual">` collapsible manual section, legacy prompt wrap for non-agent error types |
| `public/app.js` | `_buildConflictAgentPrompt(files, cwd, localDiff, diffTruncated)` and `_buildDirtyWorkdirAgentPrompt(cwd, localDiff, diffTruncated)` — prompt builders with embedded diffs. `showUpdateError()` wires up agent button + manual section. Click handler spawns agent via `POST /api/sessions`, scrolls to card. Backdrop click closes modal. |
| `public/style.css` | `.update-error-agent-btn` (full-width gold CTA), `.update-error-agent-desc`, `.update-error-manual` (details/summary with triangle markers), plus `.hidden` rules for `.conflict-prompt-wrap`, `.conflict-files`, `#update-error-retry` |

## Modal Layout

```
┌─────────────────────────────────────────────┐
│  ⚠ Uncommitted Changes / Merge Conflict     │
│                                              │
│  Description text                            │
│                                              │
│  ┌─────────────────────────────────────────┐ │
│  │  Launch Resolver Agent                  │ │
│  └─────────────────────────────────────────┘ │
│  Spawns a Claude agent to auto-resolve       │
│                                              │
│  Conflicting files: (merge-conflict only)    │
│    • public/app.js                           │
│    • public/style.css                        │
│                                              │
│  ▸ Or fix manually                           │
│  ┌──────────────────────────────────────┐    │
│  │ cd /path/dashboard                   │    │
│  │ git stash / git merge ...      [Copy]│    │
│  └──────────────────────────────────────┘    │
│                                              │
│                                     [Got it] │
└─────────────────────────────────────────────┘
```

## Modifying the Resolver Prompts

The prompts are built in `app.js` by `_buildConflictAgentPrompt()` and `_buildDirtyWorkdirAgentPrompt()`. They follow this structure:

1. Context + embedded diff
2. Step 0: Save backup to memory
3. Step 1: Start merge / stash+update
4. Step 2: Resolve conflicts intelligently (rules for each case)
5. Step 3: Show result before committing (ask for approval)
6. Step 4: Commit after approval / undo if rejected
7. Step 5: Restart server via `curl -X POST http://localhost:9145/api/restart-server`

To change the resolution behavior, edit the Step 2 rules. To change post-merge behavior, edit Step 5. The manual steps (shown in the collapsible) are built by `_buildConflictManualSteps()` and `_buildDirtyWorkdirManualSteps()`.
