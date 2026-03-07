# Contributing a PR

When a user asks to create a PR (e.g. "make a PR for my changes", "submit this as a PR"), handle the entire workflow automatically. **Most users are contributors without push access** -- `gh pr create` handles fork creation automatically.

1. **Create a feature branch** off the current branch: `git checkout -b <descriptive-branch-name>` (e.g. `fix-version-manager-loading`, `add-dark-mode-toggle`). Use lowercase kebab-case. Never push directly to `main`.
2. **Stage and commit** the relevant changes with a clear commit message summarizing what changed and why.
3. **Create the PR** with `gh pr create --base main --head <branch-name>`. This single command handles everything -- it will auto-fork the repo under the user's GitHub account if needed, push the branch to their fork, and open the PR against `john-farina/claude-cli-dashboard:main`. No manual forking or remote setup required.
   - **Title**: Short, clean, imperative (e.g. "Fix version list failing to load on first open"). Under 70 chars.
   - **Body**: Summary of what changed and why, formatted with `## Summary` and `## Test plan` sections.
4. Return the PR URL to the user.

**Do NOT** manually run `git push`, set up remotes, run `gh repo fork`, or check for existing forks. Just `gh pr create` -- it handles all of that.
