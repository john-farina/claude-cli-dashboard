# Releasing Updates

The dashboard has an auto-update system. Users see an "Update Available" button whenever `main` has new commits they don't have.

To push an update: just push to `main`. That's it. The update button appears automatically for all users on their next check.

- The server auto-detects the correct git remote for `john-farina/claude-cli-dashboard` (works for direct clones, forks, and any remote layout). It checks `upstream` then `origin`, and adds an `upstream` remote automatically if needed.
- Dashboards run `git fetch <remote> main` every hour (and on every server restart) to check for new commits
- The button shows the number of commits behind (e.g. "Update (3 new commits)")
- Hovering shows commit summaries + release notes (if any) in a tooltip
- Clicking checks you're on `main` branch first, then runs `git merge <remote>/main`, installs deps if needed, and restarts
- If on a feature branch, shows a "Wrong Branch" error with instructions to checkout main

**Optional: GitHub Releases** -- If you create a GitHub Release (with a tag like `v0.3.0`), its release notes body will show in the hover tooltip alongside commit summaries. This is purely cosmetic -- updates are triggered by commits, not releases.

## Update Conflict Resolver

When "Update" fails due to dirty workdir or merge conflicts, a modal lets the user spawn a Claude agent that auto-resolves conflicts while preserving local customizations. The agent gets the full `git diff` embedded in its prompt, saves a backup to memory, asks the user about ambiguous conflicts, and restarts the server after approval.

**Full details:** Read `dev-docs/update-conflict-resolver.md`
