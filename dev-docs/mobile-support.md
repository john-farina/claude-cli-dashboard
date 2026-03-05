# Mobile Support

The dashboard is fully usable on phones (primarily iOS Safari). Mobile has its own breakpoints, touch targets, and feature swaps. All mobile styles live in `@media (max-width: 600px)` in `style.css`. There's also a `@media (max-width: 900px)` for single-column grid.

## Design Principles
- **Touch targets**: All interactive elements must be at least 36x36px (44px preferred for primary actions like send, prompt buttons)
- **No new windows**: `window.open()` doesn't work well on iOS. Features that use popout windows on desktop must have an in-page alternative on mobile.
- **Font size >= 14px on inputs**: Prevents iOS Safari auto-zoom on focus. All `<textarea>` and `<input>` in mobile breakpoint use `font-size: 14px+`.
- **`100dvh` over `100vh`**: Use dynamic viewport height (`dvh`) for fullscreen layouts — `100vh` includes the iOS URL bar height, `100dvh` adjusts as it hides/shows. Always include `100vh` as a fallback before `100dvh`.

## Mobile-Specific Features

**Fullscreen Agent View** (`.expand-btn` / `.agent-card.fullscreen`):
- Replaces desktop's popout-to-new-window (which doesn't work on mobile)
- `.expand-btn` is `display: none` by default, shown via `display: flex !important` in the mobile media query
- Hidden on `.agent-card.minimized` (added to the minimized hide list alongside restart/popout/favorite)
- Click toggles `.fullscreen` class on the card + swaps icon
- Fullscreen state: `position: fixed; inset: 0; z-index: 100; height: 100dvh`
- `document.body.style.overflow = "hidden"` prevents background scroll while fullscreen
- Terminal gets `min-height: 0; flex: 1 1 0` in fullscreen so it fills all available space (without this, `min-height: 100px` from base styles constrains it)
- Escape key exits fullscreen (handled first in the global Escape chain, before modals)
- `scheduleMasonry()` called on exit to re-layout the grid

**Button Visibility Swaps** (mobile media query):
- Hidden on mobile: `.popout-btn`, `.restart-btn` (`display: none !important`)
- Shown on mobile: `.expand-btn` (`display: flex !important`)
- All non-minimized card action buttons get `min-width: 36px; min-height: 36px` for touch

**Header Layout**:
- Wraps to two rows (`flex-wrap: wrap`)
- `position: static` instead of sticky (saves screen space)
- Secondary buttons flex to fill width, primary button full-width below

**Card Defaults**:
- Height: `350px` (vs 500px desktop)
- `card-sticky-top` becomes `position: static` (no sticky header inside small cards)
- Terminal font: `11px`, `pre-wrap` for long lines

## Cross-Device Input Sync
- When a user types on one device, `input-sync` WebSocket messages update the textarea on all other connected clients
- On receiving `input-sync` with non-empty text, `scrollTerminalToBottom()` is called so the terminal scrolls down to keep the input area visible (important for mobile where the card is short)
- Desktop textarea auto-grows so this is less of an issue there, but mobile benefits from the scroll

## Adding Mobile-Aware Features
1. **New buttons**: If a button shouldn't appear on mobile, add it to the `display: none !important` list in the mobile media query. If it replaces a desktop button, add `display: flex !important` for mobile.
2. **New card states** (like `.fullscreen`): Must handle `position: fixed` + `z-index` correctly, lock body scroll, and have an exit path (both button and Escape key).
3. **New interactive elements**: Ensure `min-height: 44px` touch targets in the mobile media query.
4. **Modals**: Must be scrollable on small screens (`max-height: 80vh; overflow-y: auto`). Input font size >= 16px to prevent iOS zoom.
