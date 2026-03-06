# Focus Loss Investigation & Fix

Card textarea inputs were randomly losing focus while users typed, causing keystrokes to trigger hotkeys (like 'D' opening Notes) instead of entering text.

## How We Diagnosed It

### Diagnostic Logging System (now removed)

We added temporary instrumentation to capture every unexpected `focusout` event from `.card-input textarea` elements:

1. **Global `focusout` listener** on `document` (capture phase) filtered for card textareas
2. **Each blur event logged**: timestamp, agent name, `_focusLogContext` tag, `e.relatedTarget` description, DOM mutations within 50ms (via `MutationObserver`), and call stack
3. **Context tagging**: Key operations (`masonryLayout`, `updateStatus`, `reorderCards`, `docPolling`) set a `_focusLogContext` string so we could correlate blurs with specific code paths
4. **Entries flushed** to `docs/logger-and-investigator/focus-loss-log.md` via the agent docs API (debounced 3s) so they persisted across reloads
5. **User interaction tracking**: `mousedown`/`touchstart` timestamps distinguished intentional focus changes from programmatic ones

### What the Logs Revealed

| relatedTarget | Root Cause |
|---|---|
| `DIV.terminal` | `terminal.innerHTML` during `updateTerminal()` (runs every 500ms on output poll). The terminal has `tabindex="-1"` for keyboard navigation, and `innerHTML` replacement causes the browser to move focus to the nearest focusable ancestor. |
| `null (focus went to body)` | Same innerHTML issue, but focus landed on `document.body` instead of the terminal. This triggered the **cascading bug**: next keystroke hit the global hotkey handler (which checks `e.target.matches("input, textarea")` — false for body), activating shortcuts like 'D' for Notes. |
| `TEXTAREA` (another card) | **Focus guard cascade**: Two cards' per-textarea guards fought each other. Guard A restores focus to textarea A, which blurs textarea B, triggering guard B, which restores B, blurring A, etc. |

## Root Causes Found

1. **`terminal.innerHTML` in `updateTerminal()`** — Runs on every WebSocket output message (~500ms). Replacing innerHTML on a `tabindex="-1"` scrollable div causes the browser to focus it.

2. **`scrollTerminalToBottom()` (setting `terminal.scrollTop`)** — Setting `scrollTop` on a `tabindex="-1"` overflow container can steal focus in WebKit. Called after innerHTML and also in deferred `setTimeout`/`requestAnimationFrame` callbacks (50ms, 150ms, 500ms after update).

3. **Multiple per-textarea guards fighting** — Each card's textarea had its own independent 500ms refocus guard with 50ms interval. When two guards overlapped, they'd infinitely ping-pong focus between cards.

4. **Hotkey handler not checking for stale focus** — When focus landed on `document.body` due to programmatic blur, the next keystroke was processed as a hotkey instead of being redirected to the textarea.

## Fixes Applied

### 1. Focus save/restore around `terminal.innerHTML` (`updateTerminal`)
```js
const _preInnerFocused = document.activeElement;
const _preInnerCursorStart = _preInnerFocused?.selectionStart;
const _preInnerCursorEnd = _preInnerFocused?.selectionEnd;
terminal.innerHTML = `<pre>${html}</pre>`;
if (_preInnerFocused && _preInnerFocused !== document.activeElement && _preInnerFocused.isConnected) {
  _preInnerFocused.focus({ preventScroll: true });
  try { _preInnerFocused.setSelectionRange(_preInnerCursorStart, _preInnerCursorEnd); } catch {}
}
```

### 2. Focus-safe `scrollTerminalToBottom`
```js
function scrollTerminalToBottom(terminal) {
  const active = document.activeElement;
  terminal.scrollTop = terminal.scrollHeight;
  if (active && active !== document.activeElement && active.isConnected) {
    active.focus({ preventScroll: true });
  }
}
```

### 3. Single global focus guard (replaces per-textarea guards)
```js
let _focusGuardInterval = null;
// In focusout handler:
if (_focusGuardInterval) clearInterval(_focusGuardInterval); // cancel previous
_focusGuardInterval = setInterval(doRestore, 50); // only one active at a time
```

### 4. Last-active textarea tracker + body focus recovery
- `focusin` listener tracks the most recently focused card textarea (`_lastActiveTextarea`)
- Second `focusin` listener detects focus arriving at `document.body` — restores textarea via `requestAnimationFrame`
- Clears tracker when user intentionally clicks a non-textarea element

### 5. Hotkey handler redirect
When focus is on `body` and a printable key is pressed, the hotkey handler restores focus to the last active textarea and inserts the character directly (preventing the keystroke from triggering a hotkey):
```js
if (!inInput && e.target === document.body) {
  if (_lastActiveTextarea?.isConnected && (Date.now() - _lastActiveTextareaAt) < 5000) {
    ta.focus({ preventScroll: true });
    // Insert character manually since keydown already dispatched to body
    ta.value = ta.value.slice(0, start) + e.key + ta.value.slice(end);
    ta.selectionStart = ta.selectionEnd = start + 1;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    e.preventDefault();
    return;
  }
}
```

## Reproducing for Future Debugging

If focus loss reappears, re-enable diagnostics by adding to `app.js`:

```js
document.addEventListener("focusout", (e) => {
  if (!e.target.matches?.(".card-input textarea")) return;
  const card = e.target.closest(".agent-card");
  const agent = card?.querySelector(".agent-name")?.textContent;
  const rel = e.relatedTarget;
  const desc = rel
    ? `${rel.tagName}.${rel.className?.split(" ")[0]}${rel.id ? "#" + rel.id : ""}`
    : "null (body)";
  console.warn("[FOCUS]", agent, "->", desc, new Error().stack?.split("\n")[2]);
}, true);
```

Check `console.warn` output to see what's stealing focus and from which call site.
