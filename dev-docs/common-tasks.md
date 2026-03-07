# Common Tasks

### Change CEO agent instructions
Edit `claude-ceo.md`. Changes apply to new agents only (existing ones keep their original prompt).

### Add a new output filter
Add logic inside `filterOutputForDisplay()` in `server.js`. The function receives an array of lines and returns filtered lines. Apply BEFORE the prompt detection (which looks at the last 15 lines).

### Add a new prompt type
1. Add detection pattern in `detectPromptType()` in `server.js` (return a new string)
2. Add button rendering in `updateStatus()` in `app.js` (new `else if` branch)
3. Add button styles in `style.css` (follow `.prompt-btn-*` pattern)

### Add a new API endpoint
Add in `server.js` after the existing endpoint blocks. If it reads/writes to `docs/`, use `ensureDocsDir()`. If it accesses `~/.claude/`, use `isAllowedPath()` for validation.

### Add a new card section
1. Add HTML in the card template string in `addAgentCard()` (in `app.js`)
2. Wire up event listeners in the same function (after the template)
3. Add styles in `style.css` (follow existing `.agent-doc-*` pattern)

### Change CSS theme
All colors are CSS variables in `:root` at the top of `style.css`. Change there for global effect.

### Mark a new setting as "New"
The settings panel has a badge system that highlights new features for users. To use it:
1. Add a `data-setting-id="your-id"` attribute to the setting's HTML row in `index.html`
2. Add `"your-id"` to the `_NEW_SETTINGS` array at the bottom of `public/js/settings.js`
3. That's it -- the system automatically shows:
   - An accent dot on the Settings button in the header
   - A "New" pill on the parent collapsible section toggle
   - A "New" pill next to the individual setting's label
4. When the user expands the section, the section pill disappears immediately and the row pills fade out after 3 seconds, then the setting is marked as seen in localStorage
5. Remove the ID from `_NEW_SETTINGS` after a few versions
