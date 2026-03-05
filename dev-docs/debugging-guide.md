# Debugging Hard-to-Reproduce Issues

When a user reports a visual glitch, focus loss, scroll jump, or other intermittent UI bug that you can't reproduce or reason about from code alone, add **temporary diagnostic logging** to narrow it down. This is the playbook:

## 1. Add client-side console logging

Instrument the suspected area with `console.log` calls prefixed with a tag (e.g. `[scroll-debug]`, `[focus-debug]`). Log **state transitions**, not just values — what changed, from what, to what, and what triggered it.

```js
// Example: tracking focus loss
document.addEventListener("focusout", (e) => {
  if (e.target.matches(".card-input textarea")) {
    console.log("[focus-debug] textarea lost focus",
      "relatedTarget:", e.relatedTarget?.tagName, e.relatedTarget?.className,
      "activeElement:", document.activeElement?.tagName);
  }
});
```

Good things to log for common bug categories:

| Bug type | What to log |
|----------|-------------|
| **Scroll jumps** | `scrollTop`, `scrollHeight`, `_userScrolledUp`, `_forceScrollUntil`, caller stack |
| **Focus loss** | `focusout` event with `relatedTarget`, `document.activeElement` after rAF |
| **DOM displacement** | Before/after `appendChild`/`innerHTML`, element positions via `getBoundingClientRect()` |
| **Race conditions** | Timestamps, WS message types, state flags at entry/exit of handlers |
| **Layout shifts** | Card heights, grid-row spans, masonry timing |

## 2. Check server logs

Server logs live at `/tmp/ceo-dashboard.log` (stdout) and `/tmp/ceo-dashboard-err.log` (stderr). Tail them:
```bash
tail -50 /tmp/ceo-dashboard.log
tail -50 /tmp/ceo-dashboard-err.log
```

For server-side instrumentation, add `console.log("[tag]", ...)` in `server.js`. These go to the log files, not the browser.

## 3. Trace the event chain

Most dashboard bugs follow this pattern: **an async event (WS message, timer, rAF callback) triggers DOM manipulation that has an unintended side effect**. To find the root cause:

1. Identify the **symptom** (focus lost, scroll jumped, element disappeared)
2. Search for all code paths that could cause it (e.g. `grid.appendChild`, `.innerHTML =`, `.focus()`, `.blur()`)
3. Add logging at each suspect site
4. Check which one fires at the time of the bug — the log tag + timestamp reveals the causal chain

## 4. Common root causes (reference)

| Symptom | Likely cause |
|---------|-------------|
| Input loses focus randomly | `grid.appendChild(card)` in `reorderCards()` — detach/reattach causes blur |
| Terminal scrolls to top on reload | Wheel/touch events during grace period canceling `_forceScrollUntil` |
| Hotkeys fire while typing | Focus lost from input -> `inInput` check fails -> bare key triggers hotkey |
| Layout jumps after WS reconnect | `sessions` message -> `reorderCards()` + `scheduleMasonry()` |
| Server crash loop in logs | Unhandled promise rejection in async git/tmux calls (check stderr log) |

## 5. Worked example: scroll + focus bugs (March 2026)

Three related bugs were reported and traced in a single session. Here's the full investigation chain:

**Bug 1: "Agent terminal scrolls up on reload"**

- **Symptom**: After hot reload, terminal content showed the top (beginning) instead of the bottom (latest output). Terminal was stuck scrolled up.
- **Investigation**:
  1. Checked `/tmp/ceo-scroll-debug.log` — didn't exist (no prior logging).
  2. Grepped `app.js` for all `scroll` references (~80 hits). Read the `updateTerminal` function, the force-scroll mechanism (`_forceScrollUntil`), and the wheel/touch handlers.
  3. Traced the reload flow: page loads -> cards created -> WS connects -> `output` messages fill terminals -> `sessions` message triggers `reorderCards()`.
  4. Key insight: the `wheel` event handler (line ~1055) **unconditionally** set `_userScrolledUp = true` and **zeroed** `_forceScrollUntil` on any upward wheel event. On macOS, trackpad momentum scrolling continues across page reloads — leftover momentum from the previous page fires on fresh terminals.
  5. Once `_userScrolledUp = true`, both the force-scroll path AND the normal auto-scroll path in `updateTerminal` skip scrolling. Terminal stays stuck at top.
- **Fix**: Added `_wheelGraceUntil` (1.5s grace period) — during this window after card creation/reload, upward wheel and touchstart events are ignored. Prevents momentum from canceling force-scroll while still allowing intentional scroll after the brief grace.
- **Also fixed**: `reorderCards()` calls `grid.appendChild(card)` which can reset `scrollTop`. Added save/restore of terminal scroll positions around the DOM moves.

**Bug 2: "Hotkeys fire while typing during hot reload"**

- **Symptom**: User typing in agent input, hot reload triggers, keystrokes activate hotkeys (e.g. `t` opens terminal panel, `f` opens files panel).
- **Investigation**:
  1. Read the hotkey handler — all single-key hotkeys check `!inInput` (whether focus is in a textarea/input).
  2. Found existing guard: `if (!_loaderDismissed) return` suppresses hotkeys while page loader is showing.
  3. The gap: between receiving the `reload` WS message and the new page's loader being active, `location.reload()` is called. During teardown, the textarea loses focus -> `inInput` becomes `false` -> pending keystrokes hit the hotkey handler.
- **Fix**: Added `_reloadingPage` flag, set to `true` immediately on `reload` and `server-restarting` WS messages. Hotkey handler checks `if (!_loaderDismissed || _reloadingPage) return` — suppresses hotkeys during the entire reload transition.

**Bug 3: "Input randomly loses focus while typing"**

- **Symptom**: User typing in agent textarea, cursor disappears, has to click back into the input. Happened twice in quick succession, not tied to any visible reload.
- **Investigation**:
  1. Grepped for `.blur()` — zero hits. Grepped for `.focus()` — ~50 hits, but all gated behind user actions (clicks, key handlers, modal opens).
  2. Grepped for `setInterval` + `focus` — no periodic focus stealing.
  3. Key insight: `reorderCards()` does `grid.appendChild(card)` for **every** card (line ~487). `appendChild` detaches and reattaches the DOM node — the browser fires `blur` on any focused element inside the moved card.
  4. `reorderCards()` runs on every `sessions` WS message (line ~766). The `sessions` message is sent on **every** WS connection — including reconnects. Server logs showed frequent restarts (`"Port 9145 still in use, force-killing and retrying..."`), each causing WS reconnect -> `sessions` -> `reorderCards()` -> focus loss.
  5. The two occurrences matched two server restart cycles visible in `/tmp/ceo-dashboard.log`.
- **Fix**: Two layers — (1) Skip DOM moves entirely when card order hasn't changed (compare sorted array against current DOM order). This is the common case on reconnect. (2) When order does change, save `document.activeElement` + cursor position before DOM moves, restore both after with `focused.focus({ preventScroll: true })` + `setSelectionRange()`.

**Takeaway**: All three bugs shared a root pattern — **async events (WS reconnect, OS momentum, page reload) triggering DOM manipulation with unintended side effects on user state (scroll position, focus, hotkey guards)**. The investigation technique was the same each time: identify the symptom -> grep for all code paths that could cause it -> trace the async event chain that triggers it -> add a guard or save/restore around the side effect.

## 6. Clean up after

Once the bug is fixed, **remove all diagnostic logging**. Search for your tag prefix (e.g. `[scroll-debug]`) and delete those lines. The codebase should stay clean — logging is temporary instrumentation, not permanent.
