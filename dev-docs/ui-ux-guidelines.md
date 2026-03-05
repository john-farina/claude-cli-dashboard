# UI/UX Guidelines for New Modals & Components

## CSS Specificity Rules

**The `.hidden` pattern**: This codebase uses `.hidden { display: none }` to toggle visibility. If you define a base `display` on a class (e.g., `.my-state { display: flex }`), it has the same specificity as `.hidden` and whichever comes last in the file wins. **Always add a compound rule**: `.my-element.hidden { display: none; }` immediately after the base rule.

**No `!important` on component styles.** Use parent-scoped selectors for specificity (e.g., `.diff-modal .d2h-file-collapse { display: none }` not `display: none !important`). The only acceptable `!important` uses are mobile media query visibility swaps.

## Modal Standards

All modals use `.modal` base class:
- **Container**: `background: var(--modal-bg); border: 1px solid var(--border); border-radius: 16px; padding: 28px;` (mobile: `20px`)
- **Title**: `font-size: 17px; font-weight: 700; letter-spacing: -0.3px;`
- **Overlay**: `.modal-overlay` with `background: var(--modal-backdrop); backdrop-filter: blur(6px); z-index: 100`

For full-width modals that set `padding: 0`, headers should use `padding: 18px 24px` (mobile: `12px 16px`).

**Always include context in modal headers** — agent name (`color: var(--accent); font-weight: 600`) and workspace path (use `shortPath()`, never hardcode home dir replacement).

## Use Existing Utilities

- `shortPath(p)` — replaces homedir with `~` cross-platform. Never use `path.replace(/^\/Users\/[^/]+/, "~")`.
- `escapeHtml(s)` / `escapeAttr(s)` — for user-provided text.
- Search `app.js` for existing utilities before writing helpers.

## Button Patterns

| Type | Class / Pattern |
|------|----------------|
| Primary action | `.btn-primary` — gold bg, white text, `padding: 8px 18px; border-radius: 8px` |
| Secondary action | `.btn-secondary` — transparent, dim text, accent border on hover |
| Icon button (close/refresh) | Purpose-built class: `background: none; border: 1px solid transparent; color: var(--text-dim); width: 32px; height: 32px; border-radius: 8px`. Close hover: `color: var(--red); background: rgba(248,113,113,0.08)` |
| Segmented toggle | Container: `background: var(--input-bg); border: 1px solid var(--border); border-radius: 8px; overflow: hidden`. Tabs: `padding: 5px 12px; font-size: 12px`. Active: `background: var(--surface-raised); font-weight: 600` |

**Never reuse semantic classes** (like `.kill-btn`) for unrelated purposes. Never use a single text-swapping button for binary toggles — use a segmented control.

## State Screens (Loading / Empty / Error)

Every async panel needs three states. Layout: `display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 48px-64px 24px; gap: 8px; text-align: center`

Each state needs:
1. **Icon**: Themed circle (`width: 48px; height: 48px; border-radius: 50%`) — green for success/empty, red for error, spinner for loading
2. **Title**: `font-size: 14px; color: var(--text); font-weight: 500`
3. **Sub-text** (optional): `font-size: 12px; color: var(--text-dim)`
4. **Error state must include a retry button** (`.btn-secondary`)
5. **Loading spinner**: CSS border-spinner (`border: 2.5px solid var(--border); border-top-color: var(--accent); animation: spin 0.7s linear infinite`). Never use CSS `content` text animation for dots — it looks janky.

Use a `_setState(state)` function that clears all states then shows the requested one. Always add `.my-state.hidden { display: none; }` rules.

## Third-Party Library Integration

**CDN imports**: Verify the bundle exports the API you actually call. Example: `diff2html.min.js` exports `Diff2Html.html()`, but `diff2html-ui.min.js` exports `Diff2HtmlUI` — a different class. Match import to usage.

**Dark theme overrides**: Third-party libs ship light CSS. Override ALL visible surfaces, scoped under your modal class:
- Backgrounds: code areas -> `var(--terminal-bg)`, headers -> `var(--surface)`, wrappers -> `transparent`
- Text: `var(--text)` / `var(--text-dim)`
- Borders: `var(--border)`
- Font: `"SF Mono", "Fira Code", "Consolas", monospace; font-size: 12px`

**diff2html-specific** (if reused):
- Hide "Viewed" checkbox: `.d2h-file-collapse, .d2h-file-switch { display: none }`
- Hide file list title: `.d2h-file-list-title { display: none }`
- `@@` hunk rows: override blue tint -> `background: var(--surface); color: var(--text-dim)`
- Ins/del inner lines: set `.d2h-ins .d2h-code-line { background: transparent }` so parent row color shows through (inner div is narrower than td, creating a visible color gap otherwise)
- Remove `text-decoration` on ins/del content: use background highlighting (`rgba(..., 0.25)`) instead
- Tags: `background: rgba(201,168,76,0.12); color: var(--accent)`
