const grid = document.getElementById("agents-grid");
const minimizedBar = document.getElementById("minimized-bar");
const emptyState = document.getElementById("empty-state");
const connDot = document.getElementById("connection-dot");
// Modal DOM elements declared in js/modals.js (loads first)

const ansiUp = new AnsiUp();
marked.use({
  gfm: true, breaks: true,
  renderer: {
    html(token) {
      const text = typeof token === 'string' ? token : (token.raw || token.text || '');
      return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },
    link(token) {
      const href = typeof token === 'string' ? token : (token.href || '');
      const text = typeof token === 'string' ? token : (token.text || href);
      // Block dangerous URI schemes (javascript:, data:, vbscript:, etc.)
      const cleanHref = href.replace(/[\x00-\x1f\x7f]/g, '').trim();
      if (/^(?:javascript|data|vbscript):/i.test(cleanHref)) {
        return escapeHtml(text);
      }
      return `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    }
  }
});

// Clean up any old theme data
localStorage.removeItem("ceo-theme");

// --- WebSocket staleness tracking ---
let _lastWsMessage = Date.now();

// Global focusout listener — catches ALL focus losses from card inputs.
// If focus jumps to a different card's textarea without user intent, refocus the original.
let _userClickedAt = 0; // timestamp of last mousedown/touchstart
let _focusGuardInterval = null; // single global guard — prevents two cards' guards from fighting
document.addEventListener("mousedown", () => { _userClickedAt = Date.now(); }, true);
document.addEventListener("touchstart", () => { _userClickedAt = Date.now(); }, true);

document.addEventListener("focusout", (e) => {
  const textarea = e.target;
  if (!textarea.matches || !textarea.matches(".card-input textarea")) return;

  // Skip expected blurs (e.g. user submitting input)
  if (textarea._expectedBlur) {
    textarea._expectedBlur = false;
    return;
  }

  // Guard: if a card textarea loses focus without a recent user click/touch,
  // it's programmatic — aggressively refocus over the next 500ms.
  // Uses a SINGLE global guard to prevent two cards' guards from fighting each other.
  const isUserAction = (Date.now() - _userClickedAt) < 200;
  if (!isUserAction && !_reloadingPage) {
    if (_focusGuardInterval) clearInterval(_focusGuardInterval);
    const guardUntil = Date.now() + 500;
    const doRestore = () => {
      if (Date.now() > guardUntil) { clearInterval(_focusGuardInterval); _focusGuardInterval = null; return; }
      if ((Date.now() - _userClickedAt) < 200) { clearInterval(_focusGuardInterval); _focusGuardInterval = null; return; }
      if (!textarea.isConnected) { clearInterval(_focusGuardInterval); _focusGuardInterval = null; return; }
      if (document.activeElement !== textarea) {
        textarea.focus({ preventScroll: true });
      }
    };
    doRestore();
    queueMicrotask(doRestore);
    requestAnimationFrame(doRestore);
    _focusGuardInterval = setInterval(() => {
      if (Date.now() > guardUntil || (Date.now() - _userClickedAt) < 200) {
        clearInterval(_focusGuardInterval);
        _focusGuardInterval = null;
        return;
      }
      doRestore();
    }, 50);
  }
}, true);

// === LAST-ACTIVE TEXTAREA TRACKER ===
// Catches ANY focus loss that the per-blur guard misses.
// If focus ends up on body/document and no user interaction caused it, restore the textarea.
let _lastActiveTextarea = null;
let _lastActiveTextareaAt = 0;

// Track when a card textarea gains focus (user-initiated or restored)
document.addEventListener("focusin", (e) => {
  if (e.target.matches && e.target.matches(".card-input textarea")) {
    _lastActiveTextarea = e.target;
    _lastActiveTextareaAt = Date.now();
  } else if (e.target !== document.body && e.target !== document.documentElement) {
    // User intentionally focused something else — clear the tracker
    // (but not for body/documentElement, which indicates programmatic focus loss)
    if ((Date.now() - _userClickedAt) < 300) {
      _lastActiveTextarea = null;
    }
  }
}, true);

// Catch focus arriving at body/non-interactive elements — restore last textarea
// Uses rAF to let the browser settle (some blur→focus sequences are two-step)
let _bodyFocusRafId = null;
document.addEventListener("focusin", (e) => {
  // Only care about focus landing on body or the document element
  if (e.target !== document.body && e.target !== document.documentElement) return;
  if (!_lastActiveTextarea) return;
  if (_reloadingPage) return;
  // If user just clicked, they intended to move focus
  if ((Date.now() - _userClickedAt) < 300) return;
  // Only restore if the textarea was active recently (within 2s)
  if (Date.now() - _lastActiveTextareaAt > 2000) return;

  if (_bodyFocusRafId) cancelAnimationFrame(_bodyFocusRafId);
  _bodyFocusRafId = requestAnimationFrame(() => {
    _bodyFocusRafId = null;
    if ((Date.now() - _userClickedAt) < 300) return;
    if (!_lastActiveTextarea || !_lastActiveTextarea.isConnected) return;
    if (document.activeElement === document.body || document.activeElement === document.documentElement) {
      _lastActiveTextarea.focus({ preventScroll: true });
    }
  });
}, true);

// --- Tab notifications (title flash + native/browser notifications + dock badge) ---
let TAB_TITLE_DEFAULT = "CEO Dashboard";
let _tabFlashInterval = null;
let _prevAttentionAgents = new Set(); // track which agents already triggered a notification
const _isNativeApp = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.ceoBridge);

// Clear badge on page load — agents haven't loaded yet so badge should be 0
if (_isNativeApp) {
  try { window.webkit.messageHandlers.ceoBridge.postMessage({ action: "setBadge", count: 0 }); } catch {}
}

// Request notification permission on first user interaction (browser fallback)
if (!_isNativeApp) {
  document.addEventListener("click", function _reqNotif() {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
    document.removeEventListener("click", _reqNotif);
  }, { once: true });
}

function _sendNativeBridge(msg) {
  try { window.webkit.messageHandlers.ceoBridge.postMessage(msg); } catch {}
}

// Tracks agents the user has already "seen" waiting — keyed by name:waitGen.
// When the app is visible and an agent is waiting, it's marked as seen.
// Only unseen waiting agents contribute to badge count and trigger notifications.
const _seenWaiting = new Set();
let _firstUpdateDone = false; // suppress notifications on initial load

function updateTabNotifications() {
  const needsInput = [];
  for (const [name, agent] of agents) {
    if ((agent.status === "waiting" || agent.status === "asking") && !isDismissed(name, agent._waitGen)) {
      needsInput.push(name);
    }
  }

  // On first update, mark all currently-waiting agents as already seen
  // (they were waiting before we opened — don't re-alert)
  if (!_firstUpdateDone) {
    _firstUpdateDone = true;
    for (const name of needsInput) {
      const agent = agents.get(name);
      _seenWaiting.add(`${name}:${agent._waitGen}`);
    }
    // Badge 0 on initial load — everything is "seen"
    if (_isNativeApp) _sendNativeBridge({ action: "setBadge", count: 0 });
    return;
  }

  // If app is visible, mark all current waiting agents as seen + clear badge
  if (!document.hidden) {
    for (const name of needsInput) {
      const agent = agents.get(name);
      _seenWaiting.add(`${name}:${agent._waitGen}`);
    }
    if (_isNativeApp) _sendNativeBridge({ action: "setBadge", count: 0 });
    if (_tabFlashInterval) {
      clearInterval(_tabFlashInterval);
      _tabFlashInterval = null;
      document.title = TAB_TITLE_DEFAULT;
    }
    _prevAttentionAgents = new Set(needsInput);
    return;
  }

  // App is hidden — count unseen agents for badge
  const unseen = [];
  for (const name of needsInput) {
    const agent = agents.get(name);
    const key = `${name}:${agent._waitGen}`;
    if (!_seenWaiting.has(key)) unseen.push(name);
  }

  if (_isNativeApp) {
    _sendNativeBridge({ action: "setBadge", count: unseen.length });
  }

  if (unseen.length > 0) {
    // Flash the tab title
    if (!_tabFlashInterval) {
      let on = true;
      _tabFlashInterval = setInterval(() => {
        const label = unseen.length === 1 ? unseen[0] : `${unseen.length} agents`;
        document.title = on ? `\u26a0 ${label} needs input` : TAB_TITLE_DEFAULT;
        on = !on;
      }, 1000);
    }

    // Send notification for newly-waiting agents only
    for (const name of unseen) {
      if (!_prevAttentionAgents.has(name)) {
        const agent = agents.get(name);
        const body = agent.status === "waiting" ? "Needs your input" : "Has a question";
        if (_isNativeApp) {
          _sendNativeBridge({ action: "sendNotification", title: name, body, tag: `ceo-${name}` });
        } else if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification(`${TAB_TITLE_DEFAULT} — ${name}`, { body, tag: `ceo-${name}` });
        }
      }
    }
  } else {
    if (_tabFlashInterval) {
      clearInterval(_tabFlashInterval);
      _tabFlashInterval = null;
      document.title = TAB_TITLE_DEFAULT;
    }
  }

  _prevAttentionAgents = new Set(unseen);
}

// When app becomes visible — mark everything as seen, clear badge.
// Also check if WebSocket is stale and reconnect (WKWebView + mobile Safari
// can suspend the content process, killing the WS without firing onclose).
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    updateTabNotifications();
    _reconnectIfStale();
  }
});
window.addEventListener("focus", () => {
  updateTabNotifications();
  _reconnectIfStale();
});

// --- Periodic liveness heartbeat ---
// Catches dead WS connections without waiting for visibility/focus events (critical for mobile over Tailscale)
// Only acts on OPEN sockets — never kills CONNECTING ones (that causes an infinite reconnect loop on iOS)
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN && Date.now() - _lastWsMessage > 15000) {
    console.log("[ws] Heartbeat: no message in 15s, reconnecting");
    try { ws.close(); } catch {}
    clearTimeout(reconnectTimer);
    connect();
  }
}, 5000);

// Guard: don't reconnect if already connecting
function _reconnectIfStale() {
  if (ws && ws.readyState === WebSocket.CONNECTING) return; // let pending connect finish
  if (ws && ws.readyState === WebSocket.OPEN && Date.now() - _lastWsMessage > 20000) {
    console.log("[ws] Stale connection detected, reconnecting");
    try { ws.close(); } catch {}
    clearTimeout(reconnectTimer);
    connect();
  }
}

// --- Pending send queue (survives reconnect) ---
let _pendingSend = null; // { session, text, paths } — only latest message

// --- Mobile detection ---
function isMobile() { return window.innerWidth <= 600; }

// --- Masonry grid layout ---
// Cards have explicit heights; we translate that into grid-row spans
// so tall cards on one side don't push down cards in other columns.
const GRID_ROW_PX = 10; // matches grid-auto-rows in CSS
const GRID_GAP_PX = 20; // visual gap between cards (achieved via margin-bottom + extra span)

function getCardDefaultHeight() {
  return isMobile() ? 350 : 500; // matches .agent-card CSS heights
}

function masonryLayout() {

  const cards = grid.querySelectorAll(".agent-card");
  for (const card of cards) {
    // Desired height: inline style (from drag-resize / saved layout) or CSS default
    const inlineH = card.style.height;
    const cssH = (inlineH && inlineH.endsWith("px"))
      ? parseFloat(inlineH)
      : getCardDefaultHeight();
    // During active resize, respect the user's drag height exactly; otherwise use scrollHeight if content overflows
    const termOpen = card.querySelector(".agent-terminal-section")?.style.display !== "none";
    const h = card.classList.contains("resizing-height") ? cssH : Math.max(cssH, card.scrollHeight);
    const span = Math.ceil((h + GRID_GAP_PX) / GRID_ROW_PX);
    if (termOpen) console.log("[masonry]", card.querySelector(".agent-name")?.textContent, { cssH, scrollH: card.scrollHeight, h, span, inlineH });
    card.style.gridRow = `span ${span}`;
  }
  // Force browser to reflow grid after all spans are set
  void grid.offsetHeight;
  updateCardNumbers();
}

// Debounced version for frequent calls (resize, output updates)
let _masonryTimer = null;
function scheduleMasonry() {
  if (_masonryTimer) return;
  _masonryTimer = requestAnimationFrame(() => {
    _masonryTimer = null;
    masonryLayout();
    // After layout completes, scroll any terminals still in force-scroll mode
    for (const agent of agents.values()) {
      if (agent.terminal && agent.terminal._forceScrollUntil && Date.now() < agent.terminal._forceScrollUntil) {
        scrollTerminalToBottom(agent.terminal);
      }
    }
  });
}

// Recalc on window resize
window.addEventListener("resize", scheduleMasonry);

// Linkify file paths and URLs in terminal HTML output.
// Splits on HTML tags to only process text nodes, avoiding breakage of ANSI spans.
const LINK_RE = /(https?:\/\/[^\s<>"')\]]+)|((?:\/[\w.@:+-]+)+(?:\.[\w]+)?(?::\d+)?)/g;

// Escape HTML special characters in attribute values to prevent XSS
function escapeAttr(str) {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Validate and sanitize CSS color hex values to prevent CSS injection
function safeHex(hex) {
  if (typeof hex === "string" && /^#[0-9a-fA-F]{3,8}$/.test(hex)) return hex;
  return "#8A9BA8"; // fallback to slate
}

function linkifyTerminal(html) {
  // Split into HTML tags and text segments
  const parts = html.split(/(<[^>]+>)/);
  for (let i = 0; i < parts.length; i++) {
    // Skip HTML tags (odd indices after split)
    if (parts[i].startsWith("<")) continue;
    parts[i] = parts[i].replace(LINK_RE, (match, url, filepath) => {
      if (url) {
        // Only allow http/https URLs — block javascript:, data:, etc.
        if (!/^https?:\/\//i.test(url)) return match;
        const safeUrl = escapeAttr(url);
        return `<a class="terminal-link" href="${safeUrl}" target="_blank" rel="noopener">${match}</a>`;
      }
      if (filepath && filepath.length > 3) {
        // File path — use vscode:// URI for cmd+click to open in editor
        const cleanPath = filepath.replace(/[,;:!?)]+$/, "");
        const trailing = filepath.slice(cleanPath.length);
        const safePath = escapeAttr(cleanPath);
        return `<a class="terminal-link terminal-path" data-path="${safePath}" href="vscode://file${safePath}">${cleanPath}</a>${trailing}`;
      }
      return match;
    });
  }
  return parts.join("");
}

const agents = new Map(); // name -> { card, terminal, status, workdir }
let claudeSessions = []; // cached Claude session data
let selectedSessionId = null; // currently selected resume session
let slashCommands = []; // cached slash commands

// --- Popout coordination ---
const popoutChannel = new BroadcastChannel("ceo-popout");
const poppedOutAgents = new Set();

popoutChannel.onmessage = (event) => {
  const msg = event.data;
  if (msg.type === "popped-out") {
    poppedOutAgents.add(msg.agent);
    const agent = agents.get(msg.agent);
    if (agent) { agent.card.classList.add("popped-out"); scheduleMasonry(); }
  }
  if (msg.type === "popped-back") {
    poppedOutAgents.delete(msg.agent);
    const agent = agents.get(msg.agent);
    if (agent) {
      agent.card.classList.remove("popped-out");
      if (agent.terminal) agent.terminal._forceScrollUntil = Date.now() + 3000;
      scheduleMasonry();
    }
  }
  if (msg.type === "kill-agent") {
    poppedOutAgents.delete(msg.agent);
    const agent = agents.get(msg.agent);
    if (agent) {
      agent.card.remove();
      agents.delete(msg.agent);
      removeLayout(msg.agent);
      saveCardOrder();
      updateEmptyState();
      updateDashboardDot();
    }
  }
};

// --- Card Layout Persistence ---
// Mobile and desktop use separate layout keys so resizing on one doesn't affect the other.
// Minimized state is shared (always applies).

const LAYOUT_KEY_DESKTOP = "ceo-card-layouts";
const LAYOUT_KEY_MOBILE = "ceo-card-layouts-mobile";

function getLayoutKey() {
  return isMobile() ? LAYOUT_KEY_MOBILE : LAYOUT_KEY_DESKTOP;
}

function loadLayouts() {
  try { return JSON.parse(localStorage.getItem(getLayoutKey())) || {}; } catch { return {}; }
}

function saveLayout(name, data) {
  const layouts = loadLayouts();
  layouts[name] = { ...layouts[name], ...data };
  localStorage.setItem(getLayoutKey(), JSON.stringify(layouts));
}

// --- Card order persistence ---
const CARD_ORDER_KEY = "ceo-card-order";
function loadCardOrder() {
  try { return JSON.parse(localStorage.getItem(CARD_ORDER_KEY)) || []; } catch { return []; }
}
function saveCardOrder() {
  const grid = document.querySelector(".agents-grid");
  if (!grid) return;
  const order = Array.from(grid.querySelectorAll(".agent-card"))
    .map(c => c.querySelector(".agent-name")?.textContent)
    .filter(Boolean);
  localStorage.setItem(CARD_ORDER_KEY, JSON.stringify(order));
}

// --- Dismiss status (persisted in localStorage, shared across devices) ---
const DISMISS_KEY = "ceo-dismissed-status";
function loadDismissed() {
  try { return JSON.parse(localStorage.getItem(DISMISS_KEY)) || {}; } catch { return {}; }
}
function dismissAgent(name, gen) {
  const d = loadDismissed();
  d[name] = gen;
  localStorage.setItem(DISMISS_KEY, JSON.stringify(d));
}
function isDismissed(name, gen) {
  const d = loadDismissed();
  return d[name] === gen;
}
function clearDismiss(name) {
  const d = loadDismissed();
  delete d[name];
  localStorage.setItem(DISMISS_KEY, JSON.stringify(d));
}

function removeLayout(name) {
  // Remove from both keys so kill always cleans up
  for (const key of [LAYOUT_KEY_DESKTOP, LAYOUT_KEY_MOBILE]) {
    try {
      const layouts = JSON.parse(localStorage.getItem(key)) || {};
      delete layouts[name];
      localStorage.setItem(key, JSON.stringify(layouts));
    } catch {}
  }
}

function applyLayout(name, card) {
  const layouts = loadLayouts();
  const layout = layouts[name];
  if (!layout) return;
  // Column span (1x, 2x, 3x) — desktop only
  if (!isMobile()) {
    if (layout.span === 2) card.classList.add("span-2");
    if (layout.span === 3) card.classList.add("span-3");
  }
  // Height
  if (layout.height) {
    card.style.height = layout.height;
  }
  // Header color — sanitize to prevent CSS injection from localStorage
  if (layout.headerColor) {
    const color = safeHex(layout.headerColor);
    const h = card.querySelector(".card-header");
    if (h) {
      h.style.background = `linear-gradient(135deg, ${color}38 0%, ${color}20 100%)`;
      h.style.borderBottom = `1px solid ${color}50`;
    }
  }
  // Note: minimized state is now server-side, applied separately in addAgentCard
  // Terminal restore disabled — terminals are only opened by user interaction
  // (prevents spawning new tmux sessions on every reload)
}

// --- Dashboard Status Dot ---
// Reflects aggregate status of all agents: green=all idle, blue=working, red=needs attention

function updateDashboardDot() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return; // offline handled by onclose
  let hasWaiting = false;
  let hasAsking = false;
  let hasWorking = false;
  for (const [name, agent] of agents) {
    const dismissed = (agent.status === "waiting" || agent.status === "asking") && isDismissed(name, agent._waitGen);
    if (agent.status === "waiting" && !dismissed) hasWaiting = true;
    if (agent.status === "asking" && !dismissed) hasAsking = true;
    if (agent.status === "working") hasWorking = true;
  }
  if (hasWaiting || hasAsking) {
    connDot.className = "dot needs-attention";
    connDot.title = hasWaiting ? "Agent needs input" : "Agent has a question";
  } else if (hasWorking) {
    connDot.className = "dot some-working";
    connDot.title = "Agents working";
  } else {
    connDot.className = "dot all-idle";
    connDot.title = agents.size ? "All agents idle" : "Connected — no agents";
  }
  updateTabNotifications();
}

// --- Card Reordering (favorites first, FLIP animation) ---

function reorderCards() {
  const cards = Array.from(grid.querySelectorAll(".agent-card"));
  if (cards.length <= 1) { scheduleMasonry(); saveCardOrder(); return; }

  // FIRST: record current positions
  const firstRects = new Map();
  cards.forEach(card => firstRects.set(card, card.getBoundingClientRect()));

  // Sort: use saved order if available, then favorites first, then creation order
  const savedOrder = loadCardOrder();
  cards.sort((a, b) => {
    const aName = a.querySelector(".agent-name")?.textContent || "";
    const bName = b.querySelector(".agent-name")?.textContent || "";
    const aFav = a.classList.contains("favorited") ? 0 : 1;
    const bFav = b.classList.contains("favorited") ? 0 : 1;

    // If both in saved order, use that order
    const aIdx = savedOrder.indexOf(aName);
    const bIdx = savedOrder.indexOf(bName);
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;

    // Saved-order cards come before unsaved (new cards go to end)
    if (aIdx !== -1 && bIdx === -1) return -1;
    if (aIdx === -1 && bIdx !== -1) return 1;

    // Neither in saved order: favorites first, then preserve DOM order
    return aFav - bFav;
  });

  // Check if order actually changed — skip DOM moves if already correct
  const currentOrder = Array.from(grid.querySelectorAll(".agent-card"));
  let orderChanged = cards.length !== currentOrder.length;
  if (!orderChanged) {
    for (let i = 0; i < cards.length; i++) {
      if (cards[i] !== currentOrder[i]) { orderChanged = true; break; }
    }
  }

  if (orderChanged) {
    // Save focused element + cursor position before DOM moves (appendChild causes blur)
    const focused = document.activeElement;
    const focusedInGrid = focused && grid.contains(focused);
    const cursorStart = focusedInGrid ? focused.selectionStart : null;
    const cursorEnd = focusedInGrid ? focused.selectionEnd : null;

    // Save terminal scroll positions before DOM moves (appendChild can reset scrollTop)
    const scrollPositions = new Map();
    for (const card of cards) {
      const t = card.querySelector(".terminal");
      if (t) scrollPositions.set(t, t.scrollTop);
    }

    // Re-append in sorted order (moves DOM nodes without recreating)
    for (const card of cards) {
      grid.appendChild(card);
    }

    // Restore terminal scroll positions displaced by DOM re-append
    for (const [t, pos] of scrollPositions) {
      if (!t._userScrolledUp) {
        t.scrollTop = t.scrollHeight;
      } else {
        t.scrollTop = pos;
      }
    }

    // Restore focus stolen by DOM re-append
    if (focusedInGrid && focused !== document.activeElement) {
      focused.focus({ preventScroll: true });
      if (cursorStart != null) {
        try { focused.setSelectionRange(cursorStart, cursorEnd); } catch {}
      }
    }
    }
  saveCardOrder();

  // INVERT + PLAY: animate from old position to new
  cards.forEach(card => {
    const first = firstRects.get(card);
    const last = card.getBoundingClientRect();
    const deltaX = first.left - last.left;
    const deltaY = first.top - last.top;
    if (deltaX === 0 && deltaY === 0) return;

    card.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    card.style.transition = "none";

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        card.style.transition = "transform 0.3s ease";
        card.style.transform = "";
        card.addEventListener("transitionend", function cleanup() {
          card.style.transition = "";
          card.removeEventListener("transitionend", cleanup);
        });
      });
    });
  });
  scheduleMasonry();
}

// --- WebSocket ---

let ws;
let reconnectTimer;
let _knownVersion = null; // tracks hot-reload version; if it changes on reconnect, reload
let _reloadingPage = false; // set true when reload is triggered — suppresses hotkeys during transition

// Build reload-persist state (used by hot-reload, server-restart, and manual restart)
function buildReloadState() {
  const state = {
    scrollY: window.scrollY,
    drafts: {},
    attachments: {},
    shellOpen: document.getElementById("shell-panel")?.classList.contains("open"),
    currentView: currentView || "agents",
  };
  // Save todo state if on todo view
  if (state.currentView === "todo") {
    state.todo = {
      activeListId: activeListId || null,
      rawMode: todoRawMode || false,
    };
    // Save unsaved raw textarea content
    const rawTextarea = document.querySelector(".todo-editor");
    if (rawTextarea) state.todo.rawContent = rawTextarea.value;
    // Save rich editor content as markdown
    if (!todoRawMode && typeof richEditorToMarkdown === "function") {
      const richMd = richEditorToMarkdown();
      if (richMd != null) state.todo.richContent = richMd;
    }
    // Save title input value
    const titleInput = document.querySelector(".todo-title-input");
    if (titleInput) state.todo.titleValue = titleInput.value;
  }
  // Capture active focus (which input the cursor is in)
  const focused = document.activeElement;
  if (focused && (focused.tagName === "TEXTAREA" || focused.tagName === "INPUT" || focused.isContentEditable)) {
    state.focusCursorStart = focused.selectionStart ?? null;
    state.focusCursorEnd = focused.selectionEnd ?? null;
    state._savedTextLength = focused.value?.length ?? 0;
    // Identify by ID first (most reliable)
    if (focused.id) {
      state.focusedId = focused.id;
    }
    // Agent card input — identify by agent name
    const card = focused.closest(".agent-card");
    if (card) {
      const agentName = card.querySelector(".agent-name")?.textContent;
      if (agentName) state.focusedAgent = agentName;
    }
    // Todo inputs — identify by class
    if (focused.closest(".todo-view")) {
      if (focused.classList.contains("todo-title-input")) state.focusedTodo = "title";
      else if (focused.classList.contains("todo-editor")) state.focusedTodo = "editor";
    }
    if (focused.closest("#todo-rich-editor") || focused.id === "todo-rich-editor") {
      state.focusedTodo = "rich-editor";
    }
    // Agent doc edit area — identify by agent name + doc name
    const docSection = focused.closest(".agent-doc-section");
    if (docSection && focused.classList.contains("agent-doc-edit-area")) {
      const docCard = focused.closest(".agent-card");
      const docAgent = docCard?.querySelector(".agent-name")?.textContent;
      if (docAgent) state.focusedDocAgent = docAgent;
    }
  }
  // Save files panel state
  if (filesPanel.classList.contains("visible")) {
    state.filesOpen = true;
    if (currentFilePath) {
      state.fileEditor = {
        path: currentFilePath,
        name: fileEditorName.textContent,
        content: fileEditorContent.value,
        cursorStart: fileEditorContent.selectionStart,
        cursorEnd: fileEditorContent.selectionEnd,
        rawMode: fileEditorToggle?.classList.contains("active") || false,
      };
    }
  }
  // Save settings panel state
  if (document.getElementById("settings-panel")?.classList.contains("visible")) {
    state.settingsOpen = true;
  }
  // Save bookmarks panel state
  if (_bmPanel && _bmPanel.classList.contains("visible")) {
    state.bookmarksOpen = true;
  }
  for (const [name, agent] of agents) {
    const textarea = agent.card.querySelector(".card-input textarea");
    if (textarea && textarea.value) state.drafts[name] = textarea.value;
    // Persist image attachments (only completed uploads, not processing videos)
    if (agent.pendingAttachments && agent.pendingAttachments.length > 0) {
      const saved = agent.pendingAttachments.filter(a => !a.processing).map(a => {
        if (a.videoGroup) return { videoGroup: a.videoGroup, name: a.name, paths: a.paths, frameCount: a.frameCount, duration: a.duration };
        return { path: a.path, name: a.name };
      });
      if (saved.length > 0) state.attachments[name] = saved;
    }
    // Persist pasted content
    if (agent.pasteState && agent.pasteState.content) {
      if (!state.pastedContent) state.pastedContent = {};
      state.pastedContent[name] = agent.pasteState.content;
    }
  }
  // Persist new-agent modal state if open
  if (!modalOverlay.classList.contains("hidden")) {
    state.modal = {
      name: document.getElementById("agent-name").value,
      prompt: document.getElementById("agent-prompt").value,
      workdir: getSelectedWorkdir(),
      customWorkdir: document.getElementById("agent-workdir-custom").value,
      selectedWorkdirPath: selectedWorkdirPath,
    };
    // Save modal attachments
    if (modalPendingAttachments.length > 0) {
      state.modal.attachments = modalPendingAttachments.filter(a => !a.processing).map(a => {
        if (a.videoGroup) return { videoGroup: a.videoGroup, name: a.name, paths: a.paths, frameCount: a.frameCount, duration: a.duration };
        return { path: a.path, name: a.name };
      });
    }
  }
  return state;
}

function connect() {
  // If already connecting, don't kill-and-restart — let the pending handshake finish
  if (ws && ws.readyState === WebSocket.CONNECTING) return;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }
  const wsProto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${wsProto}//${location.host}`);
  ws.binaryType = "arraybuffer"; // Binary frames arrive as ArrayBuffer (shell PTY data)

  ws.onopen = () => {
    clearTimeout(reconnectTimer);
    _lastWsMessage = Date.now();
    updateDashboardDot();
    // Re-send shell terminal size on reconnect so PTY output is properly formatted
    if (window._shellXterm && window._shellXterm.cols) {
      ws.send(JSON.stringify({ type: "shell-resize", cols: window._shellXterm.cols, rows: window._shellXterm.rows }));
    }
    // Re-subscribe all terminal cards + embedded agent terminals on reconnect
    for (const [tName, agent] of agents) {
      if (agent.type === "terminal" && !agent.card.classList.contains("minimized")) {
        ws.send(JSON.stringify({ type: "terminal-subscribe", session: tName }));
        if (agent.xterm?.cols && agent.xterm?.rows) {
          _sendTerminalResize(tName, agent.xterm.cols, agent.xterm.rows);
        }
      }
      // Embedded agent terminal
      if (agent._termXterm && agent._termName) {
        const section = agent.card.querySelector(".agent-terminal-section");
        if (section && section.style.display !== "none") {
          ws.send(JSON.stringify({ type: "terminal-subscribe", session: agent._termName }));
          if (agent._termXterm.cols && agent._termXterm.rows) {
            _sendTerminalResize(agent._termName, agent._termXterm.cols, agent._termXterm.rows);
          }
        }
      }
    }
    // Check if we missed a hot reload while disconnected (iOS Safari suspends WS in background)
    fetch("/api/version").then(r => r.json()).then(data => {
      if (_knownVersion === null) {
        _knownVersion = data.version;
      } else if (data.version !== _knownVersion && !_updateErrorShowing) {
        location.reload();
      }
    }).catch(() => {});
    // Check for dashboard updates
    fetch("/api/check-update").then(r => r.json()).then(data => {
      if (data.updateAvailable) showUpdateButton(data);
    }).catch(() => {});
    // Drain pending send that was queued while disconnected
    if (_pendingSend) {
      const p = _pendingSend;
      _pendingSend = null;
      if (p.paths && p.paths.length > 0) {
        sendInputWithImages(p.session, p.text, p.paths);
      } else {
        sendInput(p.session, p.text);
      }
      console.log("[ws] Drained pending send for", p.session);
    }
  };

  ws.onclose = () => {
    connDot.className = "dot offline";
    connDot.title = "Disconnected";
    reconnectTimer = setTimeout(connect, 2000);
  };

  ws.onerror = () => {
    // Force close on error so onclose fires and triggers reconnect
    try { ws.close(); } catch {}
  };

  ws.onmessage = (event) => {
    _lastWsMessage = Date.now();

    // Binary frame = shell PTY data or terminal card data (hot path — zero JSON overhead)
    if (event.data instanceof ArrayBuffer) {
      const buf = new Uint8Array(event.data);
      // 0x02 prefix = terminal card output: 0x02 + nameLen(1B) + name + data
      if (buf.length > 1 && buf[0] === 0x02) {
        const nameLen = buf[1];
        const tName = new TextDecoder().decode(buf.subarray(2, 2 + nameLen));
        const tData = buf.subarray(2 + nameLen);
        // Standalone terminal card
        const agent = agents.get(tName);
        if (agent?.xterm) {
          agent.xterm.write(tData);
          if (!agent._termReady) {
            agent._termReady = true;
            const loader = agent.card.querySelector(".terminal-loading");
            if (loader) { loader.classList.add("fade-out"); setTimeout(() => loader.remove(), 300); }
          }
        }
        // Embedded agent terminal (name is "<agent>-term")
        if (tName.endsWith("-term")) {
          const baseAgent = agents.get(tName.slice(0, -5));
          if (baseAgent?._termXterm) {
            baseAgent._termXterm.write(tData);
            if (!baseAgent._termReady) {
              baseAgent._termReady = true;
              const loader = baseAgent.card.querySelector(".agent-terminal-section .terminal-loading");
              if (loader) { loader.classList.add("fade-out"); setTimeout(() => loader.remove(), 300); }
            }
          }
        }
        return;
      }
      // Default: footer shell (bare binary, no prefix)
      if (window._shellXterm) window._shellXterm.write(buf);
      return;
    }

    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    if (msg.type === "native-notification") {
      if (_isNativeApp) {
        _sendNativeBridge({ action: "sendNotification", title: msg.title, body: msg.body, tag: msg.tag });
      } else if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification(msg.title, { body: msg.body, tag: msg.tag });
      }
      return;
    }

    if (msg.type === "reload") {
      if (_updateErrorShowing) return;
      _reloadingPage = true;
      sessionStorage.setItem("ceo-reload-state", JSON.stringify(buildReloadState()));
      location.reload();
      return;
    }

    if (msg.type === "server-restarting") {
      if (_updateErrorShowing) return;
      _reloadingPage = true;
      sessionStorage.setItem("ceo-reload-state", JSON.stringify(buildReloadState()));
      const pollUntilReady = () => {
        fetch("/api/version", { signal: AbortSignal.timeout(2000) })
          .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
          .then((data) => {
            // Only reload once the NEW server is up (different version = new process)
            if (_knownVersion && data.version === _knownVersion) throw new Error("same server");
            location.reload();
          })
          .catch(() => setTimeout(pollUntilReady, 500));
      };
      setTimeout(pollUntilReady, 600);
      return;
    }
    if (msg.type === "shell-unavailable") {
      if (window._shellXterm) {
        window._shellXterm.write("\r\n\x1b[1;31m  Terminal unavailable\x1b[0m\r\n\r\n");
        window._shellXterm.write("  node-pty failed to start. Run this to fix:\r\n\r\n");
        window._shellXterm.write("    \x1b[1mnpm rebuild node-pty\x1b[0m\r\n\r\n");
        window._shellXterm.write("  Then restart the dashboard.\r\n");
      }
      return;
    }
    if (msg.type === "update-available") {
      showUpdateButton(msg);
      return;
    }
    if (msg.type === "open-url") {
      if (typeof msg.url === "string" && /^https?:\/\//i.test(msg.url)) {
        window.open(msg.url, "_blank");
      }
      return;
    }
    if (msg.type === "shell-open-url") {
      if (typeof msg.url === "string" && /^https?:\/\//i.test(msg.url)) {
        window.open(msg.url, "_blank");
      }
      return;
    }
    if (msg.type === "shell-info") {
      const shellCwd = document.getElementById("shell-cwd");
      const shellBranch = document.getElementById("shell-branch");
      const shellPrLink = document.getElementById("shell-pr-link");
      if (msg.cwd) {
        shellCwd.textContent = shortPath(msg.cwd);
        shellCwd.dataset.fullPath = msg.cwd; // Store full path for Finder
      }
      shellBranch.textContent = msg.branch || "";
      if (msg.prUrl) {
        shellPrLink.href = msg.prUrl;
        shellPrLink.textContent = "View PR";
        shellPrLink.style.display = "";
      } else if (msg.prUrl === null) {
        shellPrLink.style.display = "none";
      }
    }

    if (msg.type === "token-usage") {
      updateTokenUsageDisplay(msg);
      return;
    }

    if (msg.type === "todo-update") {
      if (typeof handleTodoUpdate === "function") handleTodoUpdate(msg.data);
      // Refresh agent todo refs on all cards
      for (const [agentName, agent] of agents) {
        fetch(`/api/todos/by-agent/${encodeURIComponent(agentName)}`)
          .then((r) => r.json())
          .then((todos) => renderAgentTodoRefs(agent.card, todos))
          .catch(() => {});
      }
      return;
    }


    if (msg.type === "favorites-update") {
      if (typeof renderBookmarks === "function") renderBookmarks(msg.data);
      return;
    }

    if (msg.type === "sessions") {
      const activeNames = new Set(msg.sessions.map(s => s.name));
      for (const s of msg.sessions) {
        if (s.type === "terminal") {
          addTerminalCard(s.name, s.workdir);
        } else {
          addAgentCard(s.name, s.workdir, s.branch, s.isWorktree, s.favorite, s.minimized);
        }
      }
      // Clear ALL terminalOpen flags — terminals are only opened by user interaction
      const layouts = loadLayouts();
      for (const layout of Object.values(layouts)) {
        if (layout.terminalOpen) layout.terminalOpen = false;
      }
      localStorage.setItem(getLayoutKey(), JSON.stringify(layouts));
      reorderCards();
      updateEmptyState();
      // WS sessions acts as backup if REST _loadSessions failed — ensure loader can dismiss
      _wsSessionsReceived = true;
      if (!_sessionsReceived) {
        _expectedAgentCount = msg.sessions.length;
        _sessionsReceived = true;
      }
      checkAllAgentsLoaded();
    }

    // Live minimize sync from another client
    if (msg.type === "minimize-sync") {
      const agent = agents.get(msg.session);
      if (agent) {
        const card = agent.card;
        const minBtn = card.querySelector(".minimize-btn");
        if (msg.minimized && !card.classList.contains("minimized")) {
          card.classList.add("minimized");
          minBtn.innerHTML = "+";
          minBtn.title = "Restore";
          minimizedBar.appendChild(card);
          updateEmptyState();
          scheduleMasonry();
        } else if (!msg.minimized && card.classList.contains("minimized")) {
          card.classList.remove("minimized");
          minBtn.innerHTML = "\u2212";
          minBtn.title = "Minimize";
          grid.appendChild(card);
          reorderCards();
          updateEmptyState();
          scheduleMasonry();
        }
      }
    }

    if (msg.type === "output") {
      const existing = agents.get(msg.session);
      if (existing?.type === "terminal") return;
      if (!agents.has(msg.session)) {
        addAgentCard(msg.session, "", null, false, false);
      }
      const agent = agents.get(msg.session);
      const isFirstContent = !agent.terminal._lastContent;
      // Force scroll to bottom on first content received (handles reload/reconnect)
      if (isFirstContent) {
        agent.terminal._forceScrollUntil = Date.now() + 5000;
        agent.terminal._wheelGraceUntil = Date.now() + 1500;
      }
      updateTerminal(agent.terminal, msg.lines);
      // Track that this agent has received its first output (for page loader)
      if (isFirstContent && !_loaderDismissed) {
        _agentsWithContent.add(msg.session);
        checkAllAgentsLoaded();
      }
      agent.promptOptions = msg.promptOptions || null;
      updateStatus(agent, msg.status, msg.promptType);
      // Live workdir + git info updates
      if (msg.workdir && msg.workdir !== agent.workdir) {
        agent.workdir = msg.workdir;
        agent.card.querySelector(".workdir-link").textContent = shortPath(msg.workdir);
        // Also update embedded terminal header if open
        updateTerminalHeader(agent.card, msg.workdir, undefined, undefined, undefined);
      }
      if (msg.branch !== undefined) {
        updateBranchDisplay(agent.card, msg.branch, msg.isWorktree);
        // Also update embedded terminal header if open
        updateTerminalHeader(agent.card, undefined, msg.branch, msg.isWorktree, undefined);
      }
    }

    // Live input sync from another client
    if (msg.type === "input-sync") {
      const agent = agents.get(msg.session);
      if (agent) {
        const textarea = agent.card.querySelector(".card-input textarea");
        if (textarea && textarea !== document.activeElement) {
          textarea.value = msg.text;
          // Trigger auto-resize (use 1px not "auto" to avoid layout thrash)
          textarea.style.height = "1px";
          textarea.style.height = Math.min(textarea.scrollHeight, 150) + "px";
          // Auto-scroll terminal so input area stays visible (respect user scroll)
          if (msg.text && !agent.terminal._userScrolledUp) scrollTerminalToBottom(agent.terminal);
        }
      }
    }
  };
}

function sendInput(session, text) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "input", session, text }));
  }
}

function sendKeypress(session, keys) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "keypress", session, keys }));
  }
}

function sendTypeOption(session, keys, text) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "type-option", session, keys, text }));
  }
}

function sendInputWithImages(session, text, paths) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "input-with-images", session, text, paths }));
  }
}

// Pull-based refresh: client actively requests latest output after interactions.
// Belt-and-suspenders backup for the server's push-based updates.
function requestRefresh(session) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "request-refresh", session }));
  }
}

function scheduleRefresh(session) {
  for (const ms of [500, 1000, 2000, 3000, 5000]) {
    setTimeout(() => requestRefresh(session), ms);
  }
}

// --- Agent Cards ---

function addAgentCard(name_, workdir, branch, isWorktree, favorite, minimized) {
  let name = name_;
  if (agents.has(name)) {
    const agent = agents.get(name);
    if (workdir && workdir !== agent.workdir) {
      agent.workdir = workdir;
      agent.card.querySelector(".workdir-link").textContent = shortPath(workdir);
    }
    // Update branch/worktree info
    updateBranchDisplay(agent.card, branch, isWorktree);
    // Sync minimized state from server
    if (minimized !== undefined) {
      const card = agent.card;
      const minBtn = card.querySelector(".minimize-btn");
      if (minimized && !card.classList.contains("minimized")) {
        card.classList.add("minimized");
        minBtn.innerHTML = "+";
        minBtn.title = "Restore";
        minimizedBar.appendChild(card);
      } else if (!minimized && card.classList.contains("minimized")) {
        card.classList.remove("minimized");
        minBtn.innerHTML = "\u2212";
        minBtn.title = "Minimize";
        grid.appendChild(card);
      }
    }
    // Sync favorite state from server
    if (favorite !== undefined) {
      const card = agent.card;
      const favBtn = card.querySelector(".favorite-btn");
      if (favorite) {
        card.classList.add("favorited");
        favBtn.classList.add("active");
        favBtn.textContent = "\u2605";
      } else {
        card.classList.remove("favorited");
        favBtn.classList.remove("active");
        favBtn.textContent = "\u2606";
      }
    }
    return;
  }

  const card = document.createElement("div");
  card.className = "agent-card";
  card.innerHTML = `
    <div class="card-body-wrapper">
    <div class="card-sticky-top">
      <div class="card-header">
        <div class="card-header-left">
          <button class="fullscreen-back-btn" tabindex="-1" title="Exit fullscreen">&#x2190;</button>
          <span class="alert-icon" title="Needs input"></span>
          <span class="agent-name">${escapeHtml(name)}</span>
          <span class="status-badge working">working</span>
        </div>
        <div class="card-actions">
          <button class="favorite-btn" tabindex="-1" title="Favorite">&#9734;</button>
          <div class="more-menu-wrap">
            <button class="more-btn" tabindex="-1" title="More actions">&hellip;</button>
            <div class="more-menu">
              <button class="more-menu-item" data-action="view-diff">View Diff</button>
              <button class="more-menu-item" data-action="open-terminal">Terminal</button>
              <button class="more-menu-item" data-action="rename">Rename</button>
              <button class="more-menu-item" data-action="header-color">Header Color</button>
              <div class="header-color-picker" style="display:none;">
                <div class="header-color-swatches">
                  <button class="header-color-swatch" data-color="" title="Default"><span class="swatch-x">&times;</span></button>
                  <button class="header-color-swatch" data-color="#c9a84c" title="Gold" style="--swatch:#c9a84c;"></button>
                  <button class="header-color-swatch" data-color="#7eb8da" title="Blue" style="--swatch:#7eb8da;"></button>
                  <button class="header-color-swatch" data-color="#5cb85c" title="Green" style="--swatch:#5cb85c;"></button>
                  <button class="header-color-swatch" data-color="#d9534f" title="Red" style="--swatch:#d9534f;"></button>
                  <button class="header-color-swatch" data-color="#b07cc6" title="Purple" style="--swatch:#b07cc6;"></button>
                  <button class="header-color-swatch" data-color="#d97753" title="Orange" style="--swatch:#d97753;"></button>
                  <button class="header-color-swatch" data-color="#6bb5a0" title="Teal" style="--swatch:#6bb5a0;"></button>
                </div>
              </div>
              <button class="more-menu-item" data-action="save-memory">Save Memory</button>
              <button class="more-menu-item" data-action="update-memory">Update Memory</button>
              <button class="more-menu-item more-menu-danger" data-action="clear-memory">Clear Memory</button>
              <button class="more-menu-item" data-action="dismiss-status" style="display:none;">Dismiss Status</button>
              <button class="more-menu-item" data-action="restart">Restart Claude</button>
            </div>
          </div>
          <button class="restart-btn" tabindex="0" title="Restart Claude">&#8635;</button>
          <button class="expand-btn" tabindex="0" title="Fullscreen">&#x26F6;</button>
          <button class="popout-btn" tabindex="0" title="Pop out">&#8599;</button>
          <button class="minimize-btn" tabindex="0" title="Minimize">&minus;</button>
          <button class="kill-btn" tabindex="0" title="Kill agent">&times;</button>
        </div>
      </div>
      <div class="card-subheader">
        <span class="workdir-link" title="Click to change workspace">${escapeHtml(shortPath(workdir))}</span>
        <span class="branch-info"></span>
      </div>
    </div>
    <div class="terminal">
      <div class="terminal-loading">
        <div class="loading-claude">
          <div class="loading-ring"></div>
          <div class="loading-ring loading-ring-2"></div>
          <div class="loading-ring loading-ring-3"></div>
          <div class="loading-orb loading-orb-1"></div>
          <div class="loading-orb loading-orb-2"></div>
          <div class="loading-orb loading-orb-3"></div>
          <div class="loading-orb loading-orb-4"></div>
          <div class="loading-orb loading-orb-5"></div>
          <div class="loading-orb loading-orb-6"></div>
          <img src="claude-symbol.svg" class="loading-logo" alt="">
        </div>
        <div class="loading-text">
          <span class="loading-label">Initializing Claude</span>
          <span class="loading-dots"><span>.</span><span>.</span><span>.</span></span>
        </div>
      </div>
    </div>
    <div class="popout-placeholder">
      <span>In separate window</span>
      <button class="btn-secondary popout-bring-back-btn">Bring Back</button>
    </div>
    <div class="prompt-actions"></div>
    <div class="attachment-chips"></div>
    <div class="card-input">
      <textarea rows="1" placeholder="Send a message..."></textarea>
      <button class="image-upload-btn" tabindex="-1" title="Add image"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></button>
      <input type="file" class="image-upload-input" accept="image/*,video/*" multiple style="display:none">
      <button class="send-btn" tabindex="-1">Send</button>
    </div>
    <div class="resize-grip"></div>
    <div class="agent-todo-refs"></div>
    <div class="agent-doc-section">
      <div class="agent-doc-header">
        <span>Agent Docs</span>
        <span class="agent-doc-badge empty">0</span>
      </div>
      <div class="agent-doc-body">
        <div class="agent-doc-resize"></div>
        <div class="agent-doc-list"></div>
        <div class="agent-doc-empty">No docs yet. Agents can write to ~/ceo-dashboard/docs/&lt;name&gt;/</div>
        <div class="agent-doc-detail" style="display:none;">
          <div class="agent-doc-detail-header">
            <button class="agent-doc-back-btn">&larr;</button>
            <span class="agent-doc-detail-name"></span>
            <div style="display:flex;gap:6px;margin-left:auto;">
              <button class="btn-secondary agent-doc-move-btn" style="padding:3px 10px;font-size:11px;">Move to Local</button>
              <button class="btn-secondary open-finder-btn agent-doc-finder-btn" style="padding:3px 10px;font-size:11px;">Open Folder</button>
              <button class="btn-secondary agent-doc-delete-btn" style="padding:3px 10px;font-size:11px;">Delete</button>
              <button class="md-toggle-btn agent-doc-toggle">Raw</button>
              <button class="btn-primary agent-doc-save-btn" style="padding:3px 10px;font-size:11px;display:none;">Save</button>
            </div>
          </div>
          <div class="agent-doc-rendered md-rendered markdown-body"></div>
          <textarea class="agent-doc-edit-area" style="display:none;"></textarea>
        </div>
      </div>
    </div>
    </div>
    <div class="agent-terminal-section" style="display:none;">
      <div class="agent-terminal-header">
        <div class="agent-terminal-header-left">
          <svg class="agent-terminal-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
          <span class="agent-term-workdir workdir-link" title="Working directory"></span>
          <span class="agent-term-branch branch-info"></span>
          <a class="agent-term-pr-btn btn-secondary" style="display:none;padding:2px 8px;font-size:10px;text-decoration:none;" target="_blank" rel="noopener">View PR</a>
        </div>
        <div class="agent-terminal-header-right">
          <button class="agent-terminal-expand" title="Expand to card">&#x26F6;</button>
          <button class="agent-terminal-close" title="Close terminal">&times;</button>
        </div>
      </div>
      <div class="agent-terminal-container">
        <div class="terminal-loading">
          <div class="terminal-loading-anim">
            <div class="loading-ring"></div>
            <div class="loading-ring loading-ring-2"></div>
            <div class="loading-ring loading-ring-3"></div>
            <div class="loading-orb loading-orb-1"></div>
            <div class="loading-orb loading-orb-2"></div>
            <div class="loading-orb loading-orb-3"></div>
            <div class="loading-orb loading-orb-4"></div>
            <div class="loading-orb loading-orb-5"></div>
            <div class="loading-orb loading-orb-6"></div>
            <div class="terminal-loading-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
            </div>
          </div>
          <span class="terminal-loading-text">Starting terminal<span class="loading-dots"><span>.</span><span>.</span><span>.</span></span></span>
        </div>
      </div>
      <div class="agent-terminal-resize"></div>
    </div>
  `;

  const terminal = card.querySelector(".terminal");
  terminal.setAttribute("tabindex", "-1");
  // Force scroll to bottom for new/reloaded cards until content settles
  terminal._forceScrollUntil = Date.now() + 5000;
  // Short grace period: ignore wheel/touch during first 1.5s to prevent
  // trackpad momentum from a previous page view from locking scroll at top
  terminal._wheelGraceUntil = Date.now() + 1500;

  // Scroll trapping: when terminal is at bottom, don't immediately let page scroll
  setupScrollTrapping(terminal);

  // Touch tracking: suppress auto-scroll while user is touching the terminal
  terminal.addEventListener("touchstart", () => {
    // During grace period, don't let stale momentum cancel force-scroll
    if (terminal._wheelGraceUntil && Date.now() < terminal._wheelGraceUntil) return;
    terminal._userTouching = true;
    terminal._forceScrollUntil = 0; // cancel any active force-scroll
  }, { passive: true });
  terminal.addEventListener("touchend", () => {
    // Delay clearing — momentum scroll continues after touchend
    setTimeout(() => { terminal._userTouching = false; }, 1000);
  }, { passive: true });

  // Scroll tracking: detect when user scrolls up (wants to read history)
  // Cleared when they scroll back to bottom
  terminal.addEventListener("wheel", (e) => {
    if (e.deltaY < 0) {
      // During grace period after card creation/reload, ignore upward wheel
      // to prevent macOS trackpad momentum from canceling force-scroll
      if (terminal._wheelGraceUntil && Date.now() < terminal._wheelGraceUntil) return;
      terminal._userScrolledUp = true;
      terminal._forceScrollUntil = 0;
    }
  }, { passive: true });
  terminal.addEventListener("scroll", () => {
    if (terminal._updatingContent) return; // ignore scroll events from innerHTML replacement
    const atBottom = terminal.scrollHeight - terminal.scrollTop - terminal.clientHeight < 30;
    if (atBottom) terminal._userScrolledUp = false;
  }, { passive: true });

  // Cmd+A inside terminal selects only terminal content
  terminal.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "a") {
      e.preventDefault();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(terminal);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    // Arrow keys & Enter → send directly to tmux session (for Claude interactive UI)
    if (!e.metaKey && !e.ctrlKey && !e.altKey) {
      const keyMap = { ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Enter: "Enter" };
      if (keyMap[e.key]) {
        e.preventDefault();
        sendKeypress(name, keyMap[e.key]);
        return;
      }
    }
    // Typing printable characters or Escape in terminal → focus input field
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Escape" || (e.key.length === 1 && !e.metaKey)) {
      const inp = card.querySelector(".card-input textarea");
      if (inp) {
        inp.focus();
        // Don't swallow Escape — let it propagate to the global handler
        if (e.key !== "Escape") {
          // For printable chars, append to input value
          // (the focus + default behavior will handle it)
        }
      }
    }
  });

  const input = card.querySelector(".card-input textarea");
  const sendBtn = card.querySelector(".send-btn");
  const killBtn = card.querySelector(".kill-btn");
  const minimizeBtn = card.querySelector(".minimize-btn");
  const restartBtn = card.querySelector(".restart-btn");
  const popoutBtn = card.querySelector(".popout-btn");
  const expandBtn = card.querySelector(".expand-btn");
  const fullscreenBackBtn = card.querySelector(".fullscreen-back-btn");
  const bringBackBtn = card.querySelector(".popout-bring-back-btn");
  const favoriteBtn = card.querySelector(".favorite-btn");
  const moreBtn = card.querySelector(".more-btn");
  const moreMenu = card.querySelector(".more-menu");
  const workdirLink = card.querySelector(".workdir-link");
  // Pending image attachments for this agent
  const pendingAttachments = [];

  // Pasted content collapsed into a chip (like Claude CLI's "N lines pasted")
  // Stored as object property so buildReloadState can access it via the agents map
  const pasteState = { content: null };

  // Send message (includes attached images if any)
  const doSend = () => {
    // Combine pasted content (if any) with typed text
    let text = input.value.trim();
    if (pasteState.content) {
      text = pasteState.content + (text ? "\n" + text : "");
      pasteState.content = null;
      const pasteChip = card.querySelector(".attachment-chip.paste");
      if (pasteChip) pasteChip.remove();
    }
    if (!text && pendingAttachments.length === 0) return;
    // Don't send while video frames are still extracting
    if (pendingAttachments.some((a) => a.processing)) return;

    // Build the message payload
    let sendSession = name, sendText = text, sendPaths = null;
    if (pendingAttachments.length > 0) {
      const paths = [];
      const videoContextParts = [];
      for (const a of pendingAttachments) {
        if (a.videoGroup) {
          paths.push(...a.paths);
          videoContextParts.push(
            `[Video: ${a.name} — ${a.frameCount} frames extracted from ${a.duration}s video, analyze each frame]`
          );
        } else {
          paths.push(a.path);
        }
      }
      sendText = [...videoContextParts, text].filter(Boolean).join("\n");
      sendPaths = paths;
      pendingAttachments.length = 0;
      const chips = card.querySelector(".attachment-chips");
      if (chips) chips.innerHTML = "";
    }

    // If WS isn't open, queue the message and trigger reconnect
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      _pendingSend = { session: sendSession, text: sendText, paths: sendPaths };
      console.log("[ws] Send queued for", sendSession, "— triggering reconnect");
      connDot.className = "dot offline";
      connDot.title = "Reconnecting…";
      clearTimeout(reconnectTimer);
      connect();
    } else if (sendPaths && sendPaths.length > 0) {
      sendInputWithImages(sendSession, sendText, sendPaths);
    } else {
      sendInput(sendSession, sendText);
    }
    input.value = "";
    // User sent input — they want to see the response, reset scroll lock
    terminal._userScrolledUp = false;
    terminal._forceScrollUntil = Date.now() + 3000;
    // Sync cleared input to other clients
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "input-sync", session: name, text: "" }));
    }
  };

  // Auto-resize textarea — card has fixed height, terminal flex-shrinks automatically
  // Avoid setting height="auto" first — it collapses the textarea to 0 momentarily,
  // causing the terminal flex sibling to expand then shrink (visible scroll jump).
  const autoResize = () => {
    const terminal = card.querySelector(".terminal");
    const savedScroll = terminal ? terminal.scrollTop : 0;
    // Shrink to 1px to measure natural scrollHeight without the old height constraining it
    input.style.height = "1px";
    const newH = Math.min(input.scrollHeight, 150);
    input.style.height = newH + "px";
    // Restore terminal scroll position displaced by the height change
    if (terminal && !terminal._userScrolledUp) {
      scrollTerminalToBottom(terminal);
    } else if (terminal) {
      terminal.scrollTop = savedScroll;
    }
  };
  input.addEventListener("input", autoResize);

  // Handle pasted images from clipboard (e.g. screenshots)
  input.addEventListener("paste", async (e) => {
    const clipboardData = e.clipboardData || window.clipboardData;
    if (!clipboardData) return;

    // Check for image files in clipboard first
    const imageFiles = Array.from(clipboardData.files || []).filter(f => f.type.startsWith("image/"));
    if (imageFiles.length > 0) {
      e.preventDefault();
      for (const file of imageFiles) {
        try {
          const base64 = await fileToBase64(file);
          const filename = file.name === "image.png" ? `clipboard-${Date.now()}.png` : file.name;
          const res = await fetch("/api/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename, data: base64 }),
          });
          const result = await res.json();
          if (result.path) {
            pendingAttachments.push({ path: result.path, name: filename });
            renderAttachmentChips(card, pendingAttachments);
          }
        } catch (err) {
          console.error("Clipboard image upload failed:", err);
        }
      }
      return;
    }

    // Collapse large text pastes into a chip (like Claude CLI's "N lines pasted")
    let text;
    try {
      text = clipboardData.getData("text/plain") || clipboardData.getData("text");
    } catch {}
    if (!text) return;

    const lines = text.split("\n");
    if (lines.length < 3) return; // short pastes stay inline

    e.preventDefault(); // don't insert into textarea
    pasteState.content = text;

    renderPasteChip(card, lines.length, () => {
      pasteState.content = null;
    });
  });

  // Live input sync — broadcast keystrokes to other clients
  input.addEventListener("input", () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "input-sync", session: name, text: input.value }));
    }
  });

  // Per-agent input history (arrow up/down to recall)
  const inputHistory = [];
  let historyIndex = -1; // -1 = not browsing history
  let historyDraft = "";  // saves in-progress text when entering history

  const origDoSend = doSend;
  // Wrap doSend to also record history
  const doSendWithHistory = () => {
    const text = input.value.trim();
    if (text) {
      // Don't duplicate consecutive entries
      if (inputHistory.length === 0 || inputHistory[inputHistory.length - 1] !== text) {
        inputHistory.push(text);
      }
    }
    historyIndex = -1;
    historyDraft = "";
    origDoSend();
  };
  // Reassign doSend reference used by the send button and Enter key
  const doSendFinal = doSendWithHistory;

  input.addEventListener("keydown", (e) => {
    // Arrow up/down for input history (only when slash dropdown is not visible)
    const dropdown = card.querySelector(".slash-dropdown");
    const dropdownVisible = dropdown && dropdown.classList.contains("visible");

    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !dropdownVisible && !e.shiftKey) {
      // Only activate on ArrowUp if cursor is at the start (or input is single-line)
      const isMultiline = input.value.includes("\n");
      if (e.key === "ArrowUp" && isMultiline && input.selectionStart > input.value.indexOf("\n")) return;
      if (e.key === "ArrowDown" && isMultiline && input.selectionStart < input.value.lastIndexOf("\n")) return;

      if (inputHistory.length === 0) return;

      e.preventDefault();
      if (e.key === "ArrowUp") {
        if (historyIndex === -1) {
          historyDraft = input.value;
          historyIndex = inputHistory.length - 1;
        } else if (historyIndex > 0) {
          historyIndex--;
        }
        input.value = inputHistory[historyIndex];
      } else {
        if (historyIndex === -1) return;
        if (historyIndex < inputHistory.length - 1) {
          historyIndex++;
          input.value = inputHistory[historyIndex];
        } else {
          historyIndex = -1;
          input.value = historyDraft;
        }
      }
      autoResize();
      return;
    }

    if (e.key !== "Enter") return;
    // Shift+Enter → newline (default behavior)
    if (e.shiftKey) return;
    // Enter → send
    e.preventDefault();
    const hasActiveItem = dropdown && dropdown.querySelector(".slash-item.active");
    if (!dropdownVisible || !hasActiveItem) {
      doSendFinal();
      input.style.height = "";
    }
  });
  sendBtn.addEventListener("click", () => {
    doSendFinal();
    input.style.height = "";
  });

  // Slash command autocomplete
  setupAutocomplete(input, card);

  // Image drag-and-drop
  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    card.classList.add("drag-over");
  };
  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    card.classList.remove("drag-over");
  };
  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    card.classList.remove("drag-over");
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        try {
          const base64 = await fileToBase64(file);
          const res = await fetch("/api/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename: file.name, data: base64 }),
          });
          const result = await res.json();
          if (result.path) {
            pendingAttachments.push({ path: result.path, name: file.name });
            renderAttachmentChips(card, pendingAttachments);
          }
        } catch (err) {
          console.error("Upload failed:", err);
        }
      } else if (file.type.startsWith("video/")) {
        // Video: extract frames client-side and upload each as JPEG
        const videoId = `video-${Date.now()}`;
        pendingAttachments.push({
          name: file.name,
          videoGroup: videoId,
          processing: true,
          paths: [],
          frameCount: 0,
          duration: 0,
        });
        renderAttachmentChips(card, pendingAttachments);
        try {
          const entry = pendingAttachments.find((a) => a.videoGroup === videoId);
          const { frames, duration, frameCount } = await extractVideoFrames(
            file,
            (done, total) => {
              if (entry) {
                entry.frameCount = total;
                entry.duration = duration;
                entry.progressText = `Extracting frames... ${done}/${total}`;
                renderAttachmentChips(card, pendingAttachments);
              }
            }
          );
          if (entry) {
            entry.processing = false;
            entry.paths = frames.map((f) => f.path);
            entry.frameCount = frameCount;
            entry.duration = Math.round(duration);
            renderAttachmentChips(card, pendingAttachments);
          }
        } catch (err) {
          console.error("Video frame extraction failed:", err);
          const idx = pendingAttachments.findIndex((a) => a.videoGroup === videoId);
          if (idx !== -1) pendingAttachments.splice(idx, 1);
          renderAttachmentChips(card, pendingAttachments);
        }
      }
    }
  };
  // Attach drag-drop to entire card so dropping anywhere works
  card.addEventListener("dragover", handleDragOver);
  card.addEventListener("dragleave", handleDragLeave);
  card.addEventListener("drop", handleDrop);

  // Mobile image upload button — triggers file picker for photo library
  const imageUploadBtn = card.querySelector(".image-upload-btn");
  const imageUploadInput = card.querySelector(".image-upload-input");
  imageUploadBtn.addEventListener("click", () => imageUploadInput.click());
  imageUploadInput.addEventListener("change", async () => {
    const files = Array.from(imageUploadInput.files);
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        try {
          const base64 = await fileToBase64(file);
          const res = await fetch("/api/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename: file.name, data: base64 }),
          });
          const result = await res.json();
          if (result.path) {
            pendingAttachments.push({ path: result.path, name: file.name });
            renderAttachmentChips(card, pendingAttachments);
          }
        } catch (err) {
          console.error("Upload failed:", err);
        }
      } else if (file.type.startsWith("video/")) {
        const videoId = `video-${Date.now()}`;
        pendingAttachments.push({
          name: file.name, videoGroup: videoId, processing: true,
          paths: [], frameCount: 0, duration: 0,
        });
        renderAttachmentChips(card, pendingAttachments);
        try {
          const entry = pendingAttachments.find((a) => a.videoGroup === videoId);
          const { frames, duration, frameCount } = await extractVideoFrames(
            file,
            (done, total) => {
              if (entry) {
                entry.frameCount = total;
                entry.duration = duration;
                entry.progressText = `Extracting frames... ${done}/${total}`;
                renderAttachmentChips(card, pendingAttachments);
              }
            }
          );
          if (entry) {
            entry.processing = false;
            entry.paths = frames.map((f) => f.path);
            entry.frameCount = frameCount;
            entry.duration = Math.round(duration);
            renderAttachmentChips(card, pendingAttachments);
          }
        } catch (err) {
          console.error("Video frame extraction failed:", err);
          const idx = pendingAttachments.findIndex((a) => a.videoGroup === videoId);
          if (idx !== -1) pendingAttachments.splice(idx, 1);
          renderAttachmentChips(card, pendingAttachments);
        }
      }
    }
    // Reset input so the same file can be selected again
    imageUploadInput.value = "";
  });

  // Favorite toggle
  if (favorite) {
    card.classList.add("favorited");
    favoriteBtn.classList.add("active");
    favoriteBtn.textContent = "\u2605";
  }
  favoriteBtn.addEventListener("click", async () => {
    try {
      const res = await fetch(`/api/sessions/${name}/favorite`, { method: "PATCH" });
      const data = await res.json();
      if (data.favorite) {
        card.classList.add("favorited");
        favoriteBtn.classList.add("active");
        favoriteBtn.textContent = "\u2605";
      } else {
        card.classList.remove("favorited");
        favoriteBtn.classList.remove("active");
        favoriteBtn.textContent = "\u2606";
      }
      reorderCards();
    } catch {}
  });

  // More menu (... button)
  moreBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = moreMenu.classList.toggle("visible");
    if (isOpen) {
      // Focus first item for keyboard nav
      const firstItem = moreMenu.querySelector(".more-menu-item");
      if (firstItem) firstItem.focus();
      // Close on next outside click
      const close = () => { moreMenu.classList.remove("visible"); colorPicker.style.display = "none"; };
      setTimeout(() => document.addEventListener("click", close, { once: true }), 0);
    }
  });

  // Header color picker
  const colorPicker = moreMenu.querySelector(".header-color-picker");
  const cardHeader = card.querySelector(".card-header");

  // More menu keyboard nav
  moreMenu.addEventListener("keydown", (e) => {
    const items = [...moreMenu.querySelectorAll(".more-menu-item")];
    const idx = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); items[(idx + 1) % items.length].focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); items[(idx - 1 + items.length) % items.length].focus(); }
    if (e.key === "Escape") { e.preventDefault(); moreMenu.classList.remove("visible"); colorPicker.style.display = "none"; moreBtn.focus(); }
  });

  function applyHeaderColor(color) {
    if (color) {
      cardHeader.style.background = `linear-gradient(135deg, ${color}38 0%, ${color}20 100%)`;
      cardHeader.style.borderBottom = `1px solid ${color}50`;
    } else {
      cardHeader.style.background = "";
      cardHeader.style.borderBottom = "";
    }
  }

  // Apply saved color on load
  {
    const layouts = loadLayouts();
    const saved = layouts[name]?.headerColor;
    if (saved) applyHeaderColor(saved);
  }

  colorPicker.addEventListener("click", (e) => {
    const swatch = e.target.closest(".header-color-swatch");
    if (!swatch) return;
    e.stopPropagation();
    const color = swatch.dataset.color;
    applyHeaderColor(color);
    saveLayout(name, { headerColor: color || null });
    // Mark active swatch
    colorPicker.querySelectorAll(".header-color-swatch").forEach(s => s.classList.remove("active"));
    if (color) swatch.classList.add("active");
    colorPicker.style.display = "none";
    moreMenu.classList.remove("visible");
  });

  moreMenu.addEventListener("click", async (e) => {
    // Handle swatch clicks inside the color picker (don't close menu)
    if (e.target.closest(".header-color-picker")) {
      e.stopPropagation();
      return;
    }
    const item = e.target.closest(".more-menu-item");
    if (!item) return;
    e.stopPropagation();
    const action = item.dataset.action;

    if (action === "header-color") {
      const isVisible = colorPicker.style.display !== "none";
      colorPicker.style.display = isVisible ? "none" : "block";
      // Mark current active swatch
      if (!isVisible) {
        const layouts = loadLayouts();
        const current = layouts[name]?.headerColor || "";
        colorPicker.querySelectorAll(".header-color-swatch").forEach(s => {
          s.classList.toggle("active", s.dataset.color === current);
        });
      }
      return; // Don't close menu
    }

    moreMenu.classList.remove("visible");

    if (action === "view-diff") { openDiffModal(name); return; }
    if (action === "open-terminal") { openAgentTerminal(name, card); return; }
    if (action === "rename") {
      const newName = prompt("Rename agent:", name);
      if (!newName || newName === name) return;
      const sanitized = newName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "");
      if (!sanitized) return;
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(name)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newName: sanitized }),
        });
        if (res.ok) {
          const data = await res.json();
          // Update the agents map
          const agent = agents.get(name);
          agents.delete(name);
          agents.set(data.name, agent);
          // Update displayed name
          card.querySelector(".agent-name").textContent = data.name;
          // Update layout storage (both mobile and desktop keys)
          for (const key of [LAYOUT_KEY_DESKTOP, LAYOUT_KEY_MOBILE]) {
            try {
              const layouts = JSON.parse(localStorage.getItem(key)) || {};
              if (layouts[name]) {
                layouts[data.name] = layouts[name];
                delete layouts[name];
                localStorage.setItem(key, JSON.stringify(layouts));
              }
            } catch {}
          }
          // Update the closure variable via re-binding
          name = data.name;
        } else {
          const err = await res.json();
          alert(err.error || "Rename failed");
        }
      } catch {
        alert("Rename failed");
      }
      return;
    }

    if (action === "save-memory") {
      item.textContent = "Saving...";
      try {
        await fetch(`/api/sessions/${name}/snapshot-memory`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "save" }),
        });
      } catch {}
      setTimeout(() => { item.textContent = "Save Memory"; }, 2000);
    }

    if (action === "update-memory") {
      item.textContent = "Updating...";
      try {
        await fetch(`/api/sessions/${name}/snapshot-memory`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "update" }),
        });
      } catch {}
      setTimeout(() => { item.textContent = "Update Memory"; }, 2000);
    }

    if (action === "clear-memory") {
      if (!confirm(`Clear memory for "${name}"?`)) return;
      try {
        await fetch(`/api/sessions/${name}/memory`, { method: "DELETE" });
      } catch {}
    }

    if (action === "dismiss-status") {
      const agent = agents.get(name);
      if (agent) {
        dismissAgent(name, agent._waitGen);
        updateStatus(agent, agent.status, null);
      }
    }

    if (action === "restart") {
      doRestart();
    }
  });

  // Restart Claude — kill tmux session and resume with same session ID
  async function doRestart() {
    const loading = terminal.querySelector(".terminal-loading");
    terminal.innerHTML = "";
    terminal._lastContent = null;
    const spinner = document.createElement("div");
    spinner.className = "terminal-loading";
    spinner.innerHTML = `
      <div class="loading-claude">
        <div class="loading-ring"></div>
        <div class="loading-ring loading-ring-2"></div>
        <div class="loading-ring loading-ring-3"></div>
        <div class="loading-orb loading-orb-1"></div>
        <div class="loading-orb loading-orb-2"></div>
        <div class="loading-orb loading-orb-3"></div>
        <div class="loading-orb loading-orb-4"></div>
        <div class="loading-orb loading-orb-5"></div>
        <div class="loading-orb loading-orb-6"></div>
        <img src="claude-symbol.svg" class="loading-logo" alt="">
      </div>
      <div class="loading-text">
        <span class="loading-label">Restarting Claude</span>
        <span class="loading-dots"><span>.</span><span>.</span><span>.</span></span>
      </div>`;
    spinner._createdAt = Date.now();
    terminal.appendChild(spinner);

    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(name)}/restart`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        spinner.querySelector("span").textContent = err.error || "Restart failed";
        return;
      }
      terminal._forceScrollUntil = Date.now() + 2000;
      scheduleRefresh(name);
    } catch {
      spinner.querySelector("span").textContent = "Restart failed";
    }
  }

  restartBtn.addEventListener("click", doRestart);

  // Pop out to separate window
  popoutBtn.addEventListener("click", () => {
    const url = `/popout.html?agent=${encodeURIComponent(name)}`;
    window.open(url, `ceo-popout-${name}`, "width=800,height=600");
    poppedOutAgents.add(name);
    card.classList.add("popped-out");
    scheduleMasonry();
  });

  // Bring back from popout
  bringBackBtn.addEventListener("click", () => {
    popoutChannel.postMessage({ type: "popped-back", agent: name });
    poppedOutAgents.delete(name);
    card.classList.remove("popped-out");
    terminal._forceScrollUntil = Date.now() + 3000;
    scheduleMasonry();
  });

  // Fullscreen expand/collapse
  function exitFullscreen() {
    card.classList.remove("fullscreen");
    expandBtn.innerHTML = "\u26F6"; // ⛶
    expandBtn.title = "Fullscreen";
    document.body.style.overflow = "";
    scheduleMasonry();
  }
  expandBtn.addEventListener("click", () => {
    if (card.classList.contains("fullscreen")) {
      exitFullscreen();
    } else {
      card.classList.add("fullscreen");
      expandBtn.innerHTML = "\u2715"; // ✕
      expandBtn.title = "Exit fullscreen";
      document.body.style.overflow = "hidden";
    }
  });
  fullscreenBackBtn.addEventListener("click", exitFullscreen);

  // Minimize / restore — moves card between grid and minimized bar, syncs via server
  minimizeBtn.addEventListener("click", async () => {
    const isMinimized = card.classList.toggle("minimized");
    minimizeBtn.innerHTML = isMinimized ? "+" : "\u2212";
    minimizeBtn.title = isMinimized ? "Restore" : "Minimize";
    if (isMinimized) {
      // Clear doc body height so it doesn't persist into restored state
      const body = card.querySelector(".agent-doc-body");
      if (body) body.style.height = "";
      minimizedBar.appendChild(card);
    } else {
      grid.appendChild(card);
      reorderCards();
    }
    updateEmptyState();
    // Persist to server (broadcasts to all clients)
    try {
      await fetch(`/api/sessions/${encodeURIComponent(name)}/minimize`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minimized: isMinimized }),
      });
    } catch {}
  });

  // Kill agent — favorites require confirm(), non-favorites use double-click arm pattern
  let killArmed = false;
  let killTimer = null;
  const doKill = async () => {
    await fetch(`/api/sessions/${name}`, { method: "DELETE" });
    // Also kill the embedded terminal tmux session if it exists
    const agEntry = agents.get(name);
    if (agEntry?._termName) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "terminal-unsubscribe", session: agEntry._termName }));
      }
      if (agEntry._termXterm) { try { agEntry._termXterm.dispose(); } catch {} }
      if (agEntry._termResizeObserver) { try { agEntry._termResizeObserver.disconnect(); } catch {} }
      fetch(`/api/sessions/${encodeURIComponent(agEntry._termName)}`, { method: "DELETE" }).catch(() => {});
      // Also remove standalone terminal card if it exists
      const termCardAgent = agents.get(agEntry._termName);
      if (termCardAgent?.card) {
        if (termCardAgent.xterm) { try { termCardAgent.xterm.dispose(); } catch {} }
        termCardAgent.card.remove();
        agents.delete(agEntry._termName);
      }
    }
    if (poppedOutAgents.has(name)) {
      popoutChannel.postMessage({ type: "kill-agent", agent: name });
      poppedOutAgents.delete(name);
    }
    card.remove();
    agents.delete(name);
    removeLayout(name);
    saveCardOrder();
    updateEmptyState();
    updateDashboardDot();
  };
  killBtn.addEventListener("click", async () => {
    // Favorites: confirm dialog instead of double-click
    if (card.classList.contains("favorited")) {
      if (!confirm(`Kill favorite agent "${name}"? This agent is protected.`)) return;
      await doKill();
      return;
    }
    // Non-favorites: double-click arm pattern
    if (!killArmed) {
      killArmed = true;
      killBtn.classList.add("armed");
      killBtn.textContent = "kill";
      killTimer = setTimeout(() => {
        killArmed = false;
        killBtn.classList.remove("armed");
        killBtn.innerHTML = "\u00d7";
      }, 2000);
      return;
    }
    clearTimeout(killTimer);
    await doKill();
  });

  // Change workspace
  workdirLink.addEventListener("click", () => {
    document.getElementById("workspace-agent-name").value = name;
    document.getElementById("workspace-path").value = workdir;
    wsModalOverlay.classList.remove("hidden");
  });

  // Doc header is mouse-only (not a useful keyboard stop)

  // Agent doc section
  const docSection = card.querySelector(".agent-doc-section");
  const docHeader = card.querySelector(".agent-doc-header");
  const docBadge = card.querySelector(".agent-doc-badge");
  const docList = card.querySelector(".agent-doc-list");
  const docEmpty = card.querySelector(".agent-doc-empty");
  const docDetail = card.querySelector(".agent-doc-detail");
  const docDetailName = card.querySelector(".agent-doc-detail-name");
  const docRendered = card.querySelector(".agent-doc-rendered");
  const docEditArea = card.querySelector(".agent-doc-edit-area");
  const docToggle = card.querySelector(".agent-doc-toggle");
  const docSaveBtn = card.querySelector(".agent-doc-save-btn");
  const docMoveBtn = card.querySelector(".agent-doc-move-btn");
  const docDeleteBtn = card.querySelector(".agent-doc-delete-btn");
  const docFinderBtn = card.querySelector(".agent-doc-finder-btn");
  const docBackBtn = card.querySelector(".agent-doc-back-btn");

  docHeader.addEventListener("click", () => {
    const opening = !docSection.classList.contains("open");
    docSection.classList.toggle("open");
    if (opening) {
      refreshAgentDocs(name, docList, docEmpty, docBadge, card);
    } else {
      // Clear inline heights so closed state returns to minimal size
      const body = card.querySelector(".agent-doc-body");
      if (body) body.style.height = "";
    }
    scheduleMasonry();
  });

  docBackBtn.addEventListener("click", () => {
    docDetail.style.display = "none";
    docToggle.classList.remove("active");
    docToggle.textContent = "Raw";
    docSaveBtn.style.display = "none";
    // Clear body height so list view shrinks to content
    const body = card.querySelector(".agent-doc-body");
    if (body) body.style.height = "";
    refreshAgentDocs(name, docList, docEmpty, docBadge, card);
  });

  docToggle.addEventListener("click", () => {
    const isRaw = docToggle.classList.contains("active");
    const docName = docDetail.dataset.docName;
    if (isRaw) {
      // Switching from raw to rendered — save if changed
      const content = docEditArea.value;
      if (content !== docEditArea.dataset.original) {
        saveAgentDoc(name, docName, content, docRendered, docEditArea);
      } else {
        docRendered.innerHTML = marked.parse(content);
        docRendered.style.display = "";
        docEditArea.style.display = "none";
      }
      docToggle.classList.remove("active");
      docToggle.textContent = "Raw";
      docSaveBtn.style.display = "none";
    } else {
      // Switching to raw edit mode
      docRendered.style.display = "none";
      docEditArea.style.display = "";
      docEditArea.focus();
      docToggle.classList.add("active");
      docToggle.textContent = "Rendered";
      docSaveBtn.style.display = "";
    }
  });

  docSaveBtn.addEventListener("click", () => {
    const docName = docDetail.dataset.docName;
    saveAgentDoc(name, docName, docEditArea.value, docRendered, docEditArea);
    docToggle.classList.remove("active");
    docToggle.textContent = "Raw";
    docSaveBtn.style.display = "none";
  });

  docMoveBtn.addEventListener("click", async () => {
    const docName = docDetail.dataset.docName;
    if (!docName) return;
    try {
      const res = await fetch(`/api/agent-docs/${encodeURIComponent(name)}/${encodeURIComponent(docName)}/move-to-local`, { method: "POST" });
      if (res.ok) {
        docMoveBtn.textContent = "Copied!";
        setTimeout(() => { docMoveBtn.textContent = "Move to Local"; }, 2000);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to copy");
      }
    } catch {
      alert("Failed to copy");
    }
  });

  docDeleteBtn.addEventListener("click", async () => {
    const docName = docDetail.dataset.docName;
    if (!docName) return;
    if (!confirm(`Delete "${docName}"?`)) return;
    try {
      const res = await fetch(`/api/agent-docs/${encodeURIComponent(name)}/${encodeURIComponent(docName)}`, { method: "DELETE" });
      if (res.ok) {
        // Go back to list and refresh
        docDetail.style.display = "none";
        docToggle.classList.remove("active");
        docToggle.textContent = "Raw";
        docSaveBtn.style.display = "none";
        refreshAgentDocs(name, docList, docEmpty, docBadge, card);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to delete");
      }
    } catch {
      alert("Failed to delete");
    }
  });

  docFinderBtn.addEventListener("click", () => {
    // Agent docs live at docs/<agent-name>/<doc>.md
    openInFinder(`docs/${name}/${docDetail.dataset.docName}.md`);
  });

  // Drag handle to resize doc body height
  const docResize = card.querySelector(".agent-doc-resize");
  const docBody = card.querySelector(".agent-doc-body");
  docResize.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = docBody.offsetHeight;
    const prevSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    const onMove = (ev) => {
      const newHeight = Math.max(80, startHeight + (startY - ev.clientY));
      docBody.style.height = newHeight + "px";
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = prevSelect;
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  // Touch resize for doc section (mobile)
  docResize.addEventListener("touchstart", (e) => {
    e.preventDefault();
    const startY = e.touches[0].clientY;
    const startHeight = docBody.offsetHeight;

    const onTouchMove = (ev) => {
      const newHeight = Math.max(80, startHeight + (startY - ev.touches[0].clientY));
      docBody.style.height = newHeight + "px";
    };

    const onTouchEnd = () => {
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
    };

    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd);
  });

  // Double-click resize handle to reset doc body height
  docResize.addEventListener("dblclick", () => {
    docBody.style.height = "";
  });

  // Resize grip: drag to resize width (column snap) + height (free pixels)
  const resizeGrip = card.querySelector(".resize-grip");

  const getSpan = () => {
    if (card.classList.contains("span-3")) return 3;
    if (card.classList.contains("span-2")) return 2;
    return 1;
  };

  const setSpan = (span) => {
    card.classList.remove("span-2", "span-3");
    if (span === 3) card.classList.add("span-3");
    else if (span === 2) card.classList.add("span-2");
  };

  // Compute how many grid columns exist at current viewport width
  const getGridColumnCount = () => {
    const gridStyle = getComputedStyle(grid);
    const cols = gridStyle.gridTemplateColumns.split(" ").length;
    return cols || 1;
  };

  // Get the width of a single grid column (first column)
  const getColWidth = () => {
    const gridStyle = getComputedStyle(grid);
    const cols = gridStyle.gridTemplateColumns.split(" ");
    return parseFloat(cols[0]) || 400;
  };

  resizeGrip.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    const startScrollY = window.scrollY;
    const startHeight = card.offsetHeight;
    const startSpan = getSpan();
    const colWidth = getColWidth();
    const maxCols = getGridColumnCount();
    let scrollRAF = null;
    let lastMouseY = startY;

    // When terminal is open, track wrapper so we resize agent area only (terminal stays fixed)
    const bodyWrapper = card.querySelector(".card-body-wrapper");
    const termSection = card.querySelector(".agent-terminal-section");
    const termIsOpen = termSection && termSection.style.display !== "none";
    const startWrapperH = termIsOpen ? bodyWrapper.offsetHeight : 0;

    const applyHeight = (deltaY) => {
      const newHeight = Math.max(250, startHeight + deltaY);
      card.style.height = newHeight + "px";
      if (termIsOpen && bodyWrapper) {
        bodyWrapper.style.height = Math.max(150, startWrapperH + deltaY) + "px";
      }
    };

    document.body.style.userSelect = "none";
    card.classList.add("resizing-height");

    // Auto-scroll when mouse is near viewport edges during resize
    const autoScroll = () => {
      const edgeZone = 50;
      const maxSpeed = 15;
      const viewH = window.innerHeight;
      if (lastMouseY > viewH - edgeZone) {
        const speed = Math.min(maxSpeed, ((lastMouseY - (viewH - edgeZone)) / edgeZone) * maxSpeed);
        window.scrollBy(0, speed);
        const deltaY = (lastMouseY - startY) + (window.scrollY - startScrollY);
        applyHeight(deltaY);
        scheduleMasonry();
      } else if (lastMouseY < edgeZone) {
        const speed = Math.min(maxSpeed, ((edgeZone - lastMouseY) / edgeZone) * maxSpeed);
        window.scrollBy(0, -speed);
      }
      scrollRAF = requestAnimationFrame(autoScroll);
    };
    scrollRAF = requestAnimationFrame(autoScroll);

    const onMouseMove = (ev) => {
      lastMouseY = ev.clientY;
      const deltaY = (ev.clientY - startY) + (window.scrollY - startScrollY);
      applyHeight(deltaY);

      // Width: snap to column spans based on horizontal drag distance
      const deltaX = ev.clientX - startX;
      let targetSpan = startSpan + Math.round(deltaX / colWidth);
      targetSpan = Math.max(1, Math.min(targetSpan, maxCols, 3));
      if (targetSpan !== getSpan()) {
        setSpan(targetSpan);
      }
      scheduleMasonry();
    };

    const onMouseUp = () => {
      if (scrollRAF) cancelAnimationFrame(scrollRAF);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.userSelect = "";
      card.classList.remove("resizing-height");

      // Persist final state
      saveLayout(name, { height: card.style.height, span: getSpan() });
      scheduleMasonry();
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });

  // Touch resize for card grip (mobile) — height only, no span changes
  resizeGrip.addEventListener("touchstart", (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    const startY = touch.clientY;
    const startHeight = card.offsetHeight;

    const bw = card.querySelector(".card-body-wrapper");
    const ts = card.querySelector(".agent-terminal-section");
    const tOpen = ts && ts.style.display !== "none";
    const startBwH = tOpen ? bw.offsetHeight : 0;

    card.classList.add("resizing-height");

    const onTouchMove = (ev) => {
      const t = ev.touches[0];
      const deltaY = t.clientY - startY;
      const newHeight = Math.max(200, startHeight + deltaY);
      card.style.height = newHeight + "px";
      if (tOpen && bw) bw.style.height = Math.max(150, startBwH + deltaY) + "px";
      scheduleMasonry();
    };

    const onTouchEnd = () => {
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      card.classList.remove("resizing-height");
      saveLayout(name, { height: card.style.height });
      scheduleMasonry();
    };

    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd);
  });

  // Double-click grip to reset height + span to defaults
  resizeGrip.addEventListener("dblclick", (e) => {
    e.preventDefault();
    card.style.height = "";
    card.classList.remove("span-2", "span-3");
    saveLayout(name, { height: null, span: 1 });
    scheduleMasonry();
  });

  // --- Drag-to-reorder (header-only) ---
  const header = card.querySelector(".card-header");

  // Make only the header draggable — card itself stays non-draggable so text selection works
  // Disable on touch devices: HTML drag interferes with touch scrolling; cards are single-column on mobile
  if (!("ontouchstart" in window)) {
    header.setAttribute("draggable", "true");
  }

  header.addEventListener("dragstart", (e) => {
    // Don't drag from buttons inside header
    if (e.target.closest("button")) {
      e.preventDefault();
      return;
    }
    // Don't drag minimized cards or popped-out cards
    if (card.classList.contains("minimized") || card.classList.contains("popped-out")) {
      e.preventDefault();
      return;
    }
    card.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", name);
  });

  header.addEventListener("dragend", () => {
    card.classList.remove("dragging");
    // Clear all drag-over highlights
    for (const c of grid.querySelectorAll(".drag-over-card")) {
      c.classList.remove("drag-over-card");
    }
  });

  card.addEventListener("dragover", (e) => {
    // Don't intercept file drops (images/videos) — only card reorder drags
    if (e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!card.classList.contains("dragging")) {
      card.classList.add("drag-over-card");
    }
  });

  card.addEventListener("dragleave", () => {
    card.classList.remove("drag-over-card");
  });

  card.addEventListener("drop", (e) => {
    // Don't intercept file drops (images/videos)
    if (e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    card.classList.remove("drag-over-card");
    const draggedName = e.dataTransfer.getData("text/plain");
    if (!draggedName || draggedName === name) return;
    const draggedAgent = agents.get(draggedName);
    if (!draggedAgent) return;
    const draggedCard = draggedAgent.card;

    // Swap positions: insert dragged card before this card
    const allCards = Array.from(grid.querySelectorAll(".agent-card"));
    const draggedIdx = allCards.indexOf(draggedCard);
    const targetIdx = allCards.indexOf(card);
    if (draggedIdx < targetIdx) {
      card.after(draggedCard);
    } else {
      card.before(draggedCard);
    }
    saveCardOrder();
    scheduleMasonry();
  });

  // Force scroll-to-bottom for first 5s after card creation (covers page refresh)
  terminal._forceScrollUntil = Date.now() + 5000;
  terminal._wheelGraceUntil = Date.now() + 1500;

  grid.appendChild(card);
  applyLayout(name, card);
  // Apply server-side minimized state (overrides localStorage)
  if (minimized && !card.classList.contains("minimized")) {
    card.classList.add("minimized");
    const minBtn = card.querySelector(".minimize-btn");
    minBtn.innerHTML = "+";
    minBtn.title = "Restore";
    minimizedBar.appendChild(card);
  }
  updateBranchDisplay(card, branch, isWorktree);
  agents.set(name, { card, terminal, status: "working", workdir, _waitGen: 0, pendingAttachments, pasteState });
  updateEmptyState();
  scheduleMasonry();

  // Immediately check for existing docs (badge shows count on load)
  fetch(`/api/agent-docs/${encodeURIComponent(name)}`)
    .then((r) => r.json())
    .then((docs) => {
      if (docs.length > 0) {
        docBadge.classList.remove("empty");
        docBadge.textContent = docs.length;
      }
    })
    .catch(() => {});
}

// --- Shared xterm.js terminal infrastructure ---
// Build a full xterm theme from a background color (adapts for light/dark)
// xterm theme/instance infrastructure moved to js/theme.js (loads before shell.js)

const _xtermEncoder = new TextEncoder();

// Binary WS: footer shell stdin (0x01 prefix)
function _sendShellStdin(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    const payload = _xtermEncoder.encode(data);
    const frame = new Uint8Array(1 + payload.length);
    frame[0] = 0x01;
    frame.set(payload, 1);
    ws.send(frame);
  }
}

// --- Terminal Card (xterm.js + tmux via binary WS) ---

// Binary WS: terminal card stdin (0x03 prefix + name routing)
function _sendTerminalStdin(name, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    const nameBuf = _xtermEncoder.encode(name);
    const dataBuf = _xtermEncoder.encode(data);
    const frame = new Uint8Array(2 + nameBuf.length + dataBuf.length);
    frame[0] = 0x03;
    frame[1] = nameBuf.length;
    frame.set(nameBuf, 2);
    frame.set(dataBuf, 2 + nameBuf.length);
    ws.send(frame);
  }
}

// Binary WS: terminal card resize (0x04 prefix + name + cols/rows)
function _updateGripOffset() {
  // No-op: grip is now inside .card-body-wrapper which has position:relative,
  // so it naturally stays at the bottom-right of the agent area.
}

function _sendTerminalResize(name, cols, rows) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    const nameBuf = _xtermEncoder.encode(name);
    const frame = new Uint8Array(2 + nameBuf.length + 4);
    frame[0] = 0x04;
    frame[1] = nameBuf.length;
    frame.set(nameBuf, 2);
    const dv = new DataView(frame.buffer);
    dv.setUint16(2 + nameBuf.length, cols);
    dv.setUint16(2 + nameBuf.length + 2, rows);
    ws.send(frame);
  }
}

// --- Embedded Agent Terminal ---
// Opens an xterm.js terminal inside an agent card, anchored below docs.
// Creates a server-side terminal session named "<agent>-term" in the agent's workdir.
const _termLoadingHTML = `<div class="terminal-loading"><div class="terminal-loading-anim"><div class="loading-ring"></div><div class="loading-ring loading-ring-2"></div><div class="loading-ring loading-ring-3"></div><div class="loading-orb loading-orb-1"></div><div class="loading-orb loading-orb-2"></div><div class="loading-orb loading-orb-3"></div><div class="loading-orb loading-orb-4"></div><div class="loading-orb loading-orb-5"></div><div class="loading-orb loading-orb-6"></div><div class="terminal-loading-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg></div></div><span class="terminal-loading-text">Starting terminal<span class="loading-dots"><span>.</span><span>.</span><span>.</span></span></span></div>`;

function updateTerminalHeader(card, workdir, branch, isWorktree, prUrl) {
  const wdEl = card.querySelector(".agent-term-workdir");
  const brEl = card.querySelector(".agent-term-branch");
  const prEl = card.querySelector(".agent-term-pr-btn");
  if (wdEl && workdir !== null && workdir !== undefined) wdEl.textContent = shortPath(workdir);
  if (brEl && branch !== null && branch !== undefined) {
    if (branch) {
      brEl.textContent = isWorktree ? `worktree: ${branch}` : branch;
      brEl.className = isWorktree ? "agent-term-branch branch-info worktree" : "agent-term-branch branch-info";
    } else {
      brEl.textContent = "";
    }
  }
  if (prEl && prUrl !== null && prUrl !== undefined) {
    if (prUrl) {
      prEl.href = prUrl;
      prEl.style.display = "";
    } else {
      prEl.style.display = "none";
    }
  }
}

function openAgentTerminal(agentName, card, restoreHeight) {
  const section = card.querySelector(".agent-terminal-section");
  if (!section) return;

  // If already open, just toggle visibility
  if (section.style.display !== "none") {
    closeAgentTerminal(agentName, card);
    return;
  }

  const container = section.querySelector(".agent-terminal-container");
  const loadingEl = section.querySelector(".terminal-loading");
  const agent = agents.get(agentName);
  const workdir = agent?.workdir || "";
  const termH = restoreHeight || 200;

  // BEFORE showing the terminal section: lock the body wrapper height
  // so the agent area can NEVER shrink when the terminal is added
  const bodyWrapper = card.querySelector(".card-body-wrapper");
  const wrapperH = bodyWrapper.offsetHeight;
  bodyWrapper.style.height = wrapperH + "px";
  bodyWrapper.style.flexGrow = "0";

  // Now show the section and set the terminal container height
  section.style.display = "";
  container.style.height = termH + "px";

  // Grow the card to fit: locked wrapper + terminal section
  const sectionH = section.offsetHeight;
  const newCardH = wrapperH + sectionH;
  card.style.height = newCardH + "px";
  // Directly set grid-row span — don't wait for masonryLayout
  const newSpan = Math.ceil((newCardH + GRID_GAP_PX) / GRID_ROW_PX);
  card.style.gridRow = `span ${newSpan}`;
  console.log("[terminal-open]", agentName, { wrapperH, sectionH, newCardH, newSpan, scrollH: card.scrollHeight });
  requestAnimationFrame(() => _updateGripOffset(card));
  saveLayout(agentName, { terminalOpen: true, terminalHeight: termH });
  if (_masonryTimer) { cancelAnimationFrame(_masonryTimer); _masonryTimer = null; }
  masonryLayout();
  requestAnimationFrame(() => masonryLayout());
  setTimeout(masonryLayout, 150);

  // Populate header with current agent info
  const branchEl = card.querySelector(".branch-info:not(.agent-term-branch)");
  const branch = branchEl?.textContent?.replace(/^worktree:\s*/, "") || "";
  const isWorktree = branchEl?.classList.contains("worktree") || false;
  updateTerminalHeader(card, workdir, branch, isWorktree, null);

  // Fetch PR URL asynchronously
  fetch(`/api/sessions/${encodeURIComponent(agentName)}/pr-url`)
    .then(r => r.json())
    .then(data => { if (data.prUrl) updateTerminalHeader(card, null, null, null, data.prUrl); })
    .catch(() => {});

  // If already initialized (reopening with xterm alive), just re-subscribe
  if (agent?._termXterm) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "terminal-subscribe", session: agent._termName }));
    }
    requestAnimationFrame(() => { try { agent._termFitAddon.fit(); } catch {} });
    return;
  }

  // Helper: set up xterm for a given terminal session name
  const initEmbeddedXterm = (sessionName) => {
    const _termBg = getComputedStyle(document.documentElement).getPropertyValue("--shell-bg").trim() || "#0d1117";
    const { term, fitAddon } = createXtermInstance(5000, buildXtermTheme(_termBg));

    if (agent) {
      agent._termXterm = term;
      agent._termFitAddon = fitAddon;
      agent._termName = sessionName;
      agent._termReady = false;
    }

    requestAnimationFrame(() => {
      term.open(container);
      initXtermWebGL(term);
      term.onData((d) => { _sendTerminalStdin(sessionName, d); });
      try { fitAddon.fit(); } catch {}
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "terminal-subscribe", session: sessionName }));
        if (term.cols && term.rows) _sendTerminalResize(sessionName, term.cols, term.rows);
      }
      const ro = new ResizeObserver(() => {
        try {
          fitAddon.fit();
          if (term.cols && term.rows) _sendTerminalResize(sessionName, term.cols, term.rows);
        } catch {}
      });
      ro.observe(container);
      if (agent) agent._termResizeObserver = ro;
      container.addEventListener("click", () => { term.focus(); });
      setTimeout(() => {
        if (loadingEl?.parentNode) { loadingEl.classList.add("fade-out"); setTimeout(() => loadingEl.remove(), 300); }
      }, 5000);
    });
  };

  // If tmux session already exists (e.g. after expand→minimize back, or page reload), reuse it
  if (agent?._termName) {
    initEmbeddedXterm(agent._termName);
    return;
  }

  // Create terminal session on the server (ephemeral — not persisted to sessions.json)
  const termName = agentName + "-term";
  fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: termName, type: "terminal", workdir }),
  })
    .then((r) => r.json())
    .then((data) => {
      if (data.error) { console.error("[agent-terminal] Create failed:", data.error); return; }
      initEmbeddedXterm(data.name);
    })
    .catch((err) => console.error("[agent-terminal] Create failed:", err));

  // Wire close button
  const closeBtn = section.querySelector(".agent-terminal-close");
  if (closeBtn && !closeBtn._wired) {
    closeBtn._wired = true;
    closeBtn.addEventListener("click", () => closeAgentTerminal(agentName, card));
  }

  // Wire expand button → pop out to standalone terminal card
  const expandBtn = section.querySelector(".agent-terminal-expand");
  if (expandBtn && !expandBtn._wired) {
    expandBtn._wired = true;
    expandBtn.addEventListener("click", () => {
      const ag = agents.get(agentName);
      const termName = ag?._termName;
      const wd = ag?.workdir || "";
      if (!termName) return;

      // Create standalone terminal card FIRST (subscribes to same PTY, keeps scrollback alive)
      addTerminalCard(termName, wd);

      // Now clean up embedded terminal (unsubscribe after standalone has subscribed)
      setTimeout(() => {
        if (ag?._termXterm) { try { ag._termXterm.dispose(); } catch {} }
        if (ag?._termResizeObserver) { try { ag._termResizeObserver.disconnect(); } catch {} }
        ag._termXterm = null;
        ag._termFitAddon = null;
        ag._termReady = false;
        // Reset container with loading state for potential re-open
        const cont = section.querySelector(".agent-terminal-container");
        if (cont) cont.innerHTML = _termLoadingHTML;
        // Hide section + shrink card (without unsubscribing — standalone already subscribed)
        const sectionH = section.offsetHeight;
        const cardH = card.offsetHeight;
        if (sectionH > 0 && cardH > sectionH) card.style.height = (cardH - sectionH) + "px";
        section.style.display = "none";
        const bw = card.querySelector(".card-body-wrapper");
        if (bw) { bw.style.height = ""; bw.style.flexGrow = ""; }
        _updateGripOffset(card);
        saveLayout(agentName, { terminalOpen: false, height: card.style.height });
        scheduleMasonry();
        // NOW unsubscribe embedded — standalone client keeps PTY alive
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "terminal-unsubscribe", session: termName }));
        }
      }, 200); // Wait for standalone to subscribe first

      // Scroll to the new card
      const termAgent = agents.get(termName);
      if (termAgent?.card) {
        requestAnimationFrame(() => {
          termAgent.card.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      }
    });
  }

  // Wire workdir click → open in Finder
  const termWdEl = section.querySelector(".agent-term-workdir");
  if (termWdEl && !termWdEl._wired) {
    termWdEl._wired = true;
    termWdEl.addEventListener("click", () => {
      const ag = agents.get(agentName);
      if (ag?.workdir) {
        fetch("/api/shell/open-finder", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd: ag.workdir }),
        });
      }
    });
  }

  // Wire resize handle
  const resizeHandle = section.querySelector(".agent-terminal-resize");
  if (resizeHandle && !resizeHandle._wired) {
    resizeHandle._wired = true;
    resizeHandle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const startY = e.clientY;
      const startTermH = container.offsetHeight;
      const startCardH = card.offsetHeight;
      const onMove = (ev) => {
        const delta = ev.clientY - startY;
        const newTermH = Math.max(80, startTermH + delta);
        container.style.height = newTermH + "px";
        // Grow/shrink card by the same delta
        card.style.height = (startCardH + (newTermH - startTermH)) + "px";
        _updateGripOffset(card);
        scheduleMasonry();
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        if (agent?._termFitAddon) try { agent._termFitAddon.fit(); } catch {}
        _updateGripOffset(card);
        saveLayout(agentName, { terminalHeight: container.offsetHeight, height: card.style.height });
        if (_masonryTimer) { cancelAnimationFrame(_masonryTimer); _masonryTimer = null; }
        masonryLayout();
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }
}

function closeAgentTerminal(agentName, card) {
  const section = card.querySelector(".agent-terminal-section");
  if (section) {
    // Shrink card by the terminal section height before hiding
    const sectionH = section.offsetHeight;
    const cardH = card.offsetHeight;
    if (sectionH > 0 && cardH > sectionH) {
      card.style.height = (cardH - sectionH) + "px";
    }
    section.style.display = "none";
    // Unlock body wrapper so it can flex normally again
    const bodyWrapper = card.querySelector(".card-body-wrapper");
    if (bodyWrapper) { bodyWrapper.style.height = ""; bodyWrapper.style.flexGrow = ""; }
  }
  _updateGripOffset(card);
  saveLayout(agentName, { terminalOpen: false, height: card.style.height });
  if (_masonryTimer) { cancelAnimationFrame(_masonryTimer); _masonryTimer = null; }
  masonryLayout();
  requestAnimationFrame(() => { masonryLayout(); });
  setTimeout(masonryLayout, 100);
  // Clamp scroll so we don't overshoot past the now-shorter page
  requestAnimationFrame(() => {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    if (window.scrollY > maxScroll && maxScroll >= 0) {
      window.scrollTo({ top: maxScroll, behavior: "auto" });
    }
  });
  // Unsubscribe to save bandwidth
  const agent = agents.get(agentName);
  if (agent?._termName && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "terminal-unsubscribe", session: agent._termName }));
  }
}

function addTerminalCard(name, workdir) {
  if (agents.has(name)) {
    // Already exists — just update workdir if changed
    const agent = agents.get(name);
    if (workdir && workdir !== agent.workdir) {
      agent.workdir = workdir;
      const wdEl = agent.card.querySelector(".workdir-link");
      if (wdEl) wdEl.textContent = shortPath(workdir);
    }
    return;
  }

  const card = document.createElement("div");
  card.className = "agent-card terminal-card";
  card.innerHTML = `
    <div class="card-sticky-top">
      <div class="card-header">
        <div class="card-header-left">
          <span class="terminal-icon">&gt;_</span>
          <span class="agent-name">${escapeHtml(name)}</span>
        </div>
        <div class="card-actions">
          <button class="minimize-btn" tabindex="0" title="Minimize">&minus;</button>
          <button class="kill-btn" tabindex="0" title="Close terminal">&times;</button>
        </div>
      </div>
      <div class="card-subheader">
        <span class="workdir-link">${escapeHtml(shortPath(workdir))}</span>
        <span class="branch-info"></span>
      </div>
    </div>
    <div class="terminal-xterm-container">
      <div class="terminal-loading">
        <div class="terminal-loading-anim">
          <div class="loading-ring"></div>
          <div class="loading-ring loading-ring-2"></div>
          <div class="loading-ring loading-ring-3"></div>
          <div class="loading-orb loading-orb-1"></div>
          <div class="loading-orb loading-orb-2"></div>
          <div class="loading-orb loading-orb-3"></div>
          <div class="loading-orb loading-orb-4"></div>
          <div class="loading-orb loading-orb-5"></div>
          <div class="loading-orb loading-orb-6"></div>
          <div class="terminal-loading-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
            </svg>
          </div>
        </div>
        <span class="terminal-loading-text">Starting terminal<span class="loading-dots"><span>.</span><span>.</span><span>.</span></span></span>
      </div>
    </div>
    <div class="resize-grip"></div>
  `;

  const xtermContainer = card.querySelector(".terminal-xterm-container");
  const loadingEl = card.querySelector(".terminal-loading");

  // Create xterm.js terminal instance — use shell/terminal bg color from theme
  const _termBg = getComputedStyle(document.documentElement).getPropertyValue("--shell-bg").trim() || "#0d1117";
  const { term, fitAddon } = createXtermInstance(5000, buildXtermTheme(_termBg));

  // Store in agents map
  agents.set(name, { card, xterm: term, fitAddon, type: "terminal", workdir, status: "terminal" });

  // Derive parent agent name from terminal name (e.g. "my-agent-term" → "my-agent")
  const parentAgentName = name.endsWith("-term") ? name.slice(0, -5) : null;

  // Close button — close standalone card, keep tmux session alive for later re-embed
  const killBtn = card.querySelector(".kill-btn");
  killBtn.addEventListener("click", () => {
    // Unsubscribe + dispose xterm but keep tmux session alive
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "terminal-unsubscribe", session: name }));
    }
    const agentEntry = agents.get(name);
    if (agentEntry?.resizeObserver) agentEntry.resizeObserver.disconnect();
    term.dispose();
    card.remove();
    agents.delete(name);
    // Clear terminalOpen on parent agent so it doesn't re-open on reload
    if (parentAgentName) saveLayout(parentAgentName, { terminalOpen: false });
    updateEmptyState();
    scheduleMasonry();
  });

  // Minimize button — collapse back into parent agent card as embedded terminal
  const minBtn = card.querySelector(".minimize-btn");
  minBtn.addEventListener("click", () => {
    const parentAgent = parentAgentName ? agents.get(parentAgentName) : null;
    if (parentAgent?.card) {
      // Unsubscribe + dispose standalone
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "terminal-unsubscribe", session: name }));
      }
      const agentEntry = agents.get(name);
      if (agentEntry?.resizeObserver) agentEntry.resizeObserver.disconnect();
      term.dispose();
      card.remove();
      agents.delete(name);
      updateEmptyState();
      scheduleMasonry();
      // Re-open as embedded terminal in the parent agent card
      openAgentTerminal(parentAgentName, parentAgent.card);
    } else {
      // No parent agent — fall back to standard minimize
      if (card.classList.contains("minimized")) {
        card.classList.remove("minimized");
        minBtn.innerHTML = "\u2212";
        minBtn.title = "Minimize";
        grid.appendChild(card);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "terminal-subscribe", session: name }));
        }
        reorderCards();
        updateEmptyState();
        scheduleMasonry();
        requestAnimationFrame(() => { try { fitAddon.fit(); } catch {} });
      } else {
        card.classList.add("minimized");
        minBtn.innerHTML = "+";
        minBtn.title = "Restore";
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "terminal-unsubscribe", session: name }));
        }
        minimizedBar.appendChild(card);
        updateEmptyState();
        scheduleMasonry();
      }
    }
  });

  // Resize grip
  const grip = card.querySelector(".resize-grip");
  let resizing = false;
  grip.addEventListener("mousedown", (e) => {
    e.preventDefault();
    resizing = true;
    const startY = e.clientY;
    const startH = card.offsetHeight;
    const onMove = (ev) => {
      const h = startH + (ev.clientY - startY);
      card.style.height = Math.max(150, h) + "px";
    };
    const onUp = () => {
      resizing = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      try { fitAddon.fit(); } catch {}
      scheduleMasonry();
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  // Populate branch from parent agent if this is a "-term" card
  if (parentAgentName) {
    const parentAgent = agents.get(parentAgentName);
    if (parentAgent?.card) {
      const srcBranch = parentAgent.card.querySelector(".branch-info:not(.agent-term-branch)");
      if (srcBranch) {
        updateBranchDisplay(card, srcBranch.textContent.replace(/^worktree:\s*/, ""), srcBranch.classList.contains("worktree"));
      }
    }
  }

  // Add card to grid
  grid.appendChild(card);
  updateEmptyState();
  scheduleMasonry();

  // Open xterm after card is in DOM
  requestAnimationFrame(() => {
    term.open(xtermContainer);

    initXtermWebGL(term);

    // Wire input to binary WS
    term.onData((data) => {
      _sendTerminalStdin(name, data);
    });

    // Fit and subscribe
    try { fitAddon.fit(); } catch {}
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "terminal-subscribe", session: name }));
      // Send initial resize
      if (term.cols && term.rows) {
        _sendTerminalResize(name, term.cols, term.rows);
      }
    }

    // ResizeObserver for auto-fit — store reference for cleanup on kill
    const ro = new ResizeObserver(() => {
      if (card.classList.contains("minimized")) return;
      try {
        fitAddon.fit();
        if (term.cols && term.rows) {
          _sendTerminalResize(name, term.cols, term.rows);
        }
      } catch {}
    });
    ro.observe(xtermContainer);
    const agentEntry = agents.get(name);
    if (agentEntry) agentEntry.resizeObserver = ro;

    // Focus xterm on click
    xtermContainer.addEventListener("click", () => { term.focus(); });

    // Safety: dismiss loading after 5s even if no data arrives
    setTimeout(() => {
      if (loadingEl?.parentNode) { loadingEl.classList.add("fade-out"); setTimeout(() => loadingEl.remove(), 300); }
    }, 5000);

    // Mark as loaded for page loader
    if (!_loaderDismissed) {
      _agentsWithContent.add(name);
      checkAllAgentsLoaded();
    }

    // Second fit after layout settles (masonry may shift the card)
    setTimeout(() => { try { fitAddon.fit(); } catch {} }, 100);
  });
}

// Scroll trapping: brief pause when scrolling down hits terminal bottom
function setupScrollTrapping(el) {
  let _trappedUntil = 0;
  el.addEventListener("wheel", (e) => {
    // Only trap downward scrolls that hit the bottom
    if (e.deltaY <= 0) return; // scrolling up — always allow (passes to page if at top)
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 2;
    if (!atBottom) return; // still has content to scroll — let it scroll normally
    // At bottom scrolling down — trap briefly
    if (Date.now() < _trappedUntil) {
      e.preventDefault();
    } else {
      _trappedUntil = Date.now() + 500;
      e.preventDefault();
    }
  }, { passive: false });
}

function scrollTerminalToBottom(terminal) {
  // Save and restore focus — setting scrollTop on a tabindex'd scrollable div
  // can steal focus in some browsers (WebKit).
  const active = document.activeElement;
  terminal.scrollTop = terminal.scrollHeight;
  if (active && active !== document.activeElement && active.isConnected) {
    active.focus({ preventScroll: true });
  }
}

function updateTerminal(terminal, lines) {
  // Keep loading spinner until Claude Code banner appears (hides raw shell commands)
  const loading = terminal.querySelector(".terminal-loading");
  if (loading) {
    const claudeStarted = lines.some((l) => l.replace(/\x1b\[[0-9;]*m/g, "").includes("Claude Code"));
    // Safety: if spinner has been showing for 8+ seconds, clear it regardless
    // (prevents permanent "stuck" state if Claude fails to start or banner is missed)
    if (!loading._createdAt) loading._createdAt = Date.now();
    const spinnerAge = Date.now() - loading._createdAt;
    if (!claudeStarted && spinnerAge < 8000) return; // still booting — keep showing spinner
    loading.remove();
  }

  const content = lines.join("\n");

  // Skip update if content hasn't changed
  if (terminal._lastContent === content) {
    // Still ensure scroll is at bottom if user hasn't scrolled up.
    // Layout changes (masonry, resize) can displace scrollTop even without new content.
    if (!terminal._userTouching && !terminal._userScrolledUp) {
      scrollTerminalToBottom(terminal);
    }
    return;
  }

  // Skip update if user has active text selection in this terminal
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && !sel.isCollapsed && terminal.contains(sel.anchorNode)) {
    return;
  }

  const userInteracting = terminal._userTouching || terminal._userScrolledUp;
  const forceScroll = !userInteracting && terminal._forceScrollUntil && Date.now() < terminal._forceScrollUntil;

  // Preserve scroll position when user is reading history (scrolled up)
  const savedScrollTop = userInteracting ? terminal.scrollTop : null;

  terminal._lastContent = content;
  let html = linkifyTerminal(ansiUp.ansi_to_html(content));
  // Strip dark gray background blocks (user-typed messages in Claude Code)
  // These are ANSI 256-color backgrounds in the #2a2a2a–#4a4a4a range
  html = html.replace(/background-color:rgb\((\d+),(\d+),(\d+)\)/g, (m, r, g, b) => {
    r = +r; g = +g; b = +b;
    if (r === g && g === b && r >= 30 && r <= 80) return "background-color:transparent";
    return m;
  });

  // Suppress scroll-event side effects during innerHTML replacement
  terminal._updatingContent = true;
  // Save focused element before innerHTML — DOM reconstruction can steal focus
  // to the terminal (scrollable containers are implicitly focusable in some browsers).
  const _preInnerFocused = document.activeElement;
  const _preInnerCursorStart = _preInnerFocused?.selectionStart;
  const _preInnerCursorEnd = _preInnerFocused?.selectionEnd;
  terminal.innerHTML = `<pre>${html}</pre>`;
  // Restore focus if innerHTML stole it
  if (_preInnerFocused && _preInnerFocused !== document.activeElement && _preInnerFocused.isConnected) {
    _preInnerFocused.focus({ preventScroll: true });
    try { if (_preInnerCursorStart != null) _preInnerFocused.setSelectionRange(_preInnerCursorStart, _preInnerCursorEnd); } catch {}
  }

  // Restore scroll position if user was reading history
  if (savedScrollTop !== null) {
    terminal.scrollTop = savedScrollTop;
  }
  requestAnimationFrame(() => { terminal._updatingContent = false; });

  if (forceScroll) {
    // Force scroll (initial load / page refresh): multiple retries for layout settling
    // Each checks if user has since interacted to avoid fighting with them
    scrollTerminalToBottom(terminal);
    requestAnimationFrame(() => scrollTerminalToBottom(terminal));
    for (const ms of [50, 150, 500]) {
      setTimeout(() => {
        if (!terminal._userScrolledUp && !terminal._userTouching) {
          scrollTerminalToBottom(terminal);
        }
      }, ms);
    }
  } else if (!userInteracting) {
    // User hasn't scrolled up — always keep at bottom.
    // (Previously checked wasScrolledToBottom, but layout changes like masonry reflow
    // can displace scrollTop without user intent, leaving terminals stuck at top.)
    scrollTerminalToBottom(terminal);
    requestAnimationFrame(() => scrollTerminalToBottom(terminal));
  }
}

function updateStatus(agent, status, promptType) {
  const name = agent.card.querySelector(".agent-name").textContent;
  const wasNeedy = agent.status === "waiting" || agent.status === "asking";
  const isNeedy = status === "waiting" || status === "asking";

  // Bump generation when entering a new needy cycle (was not needy -> now needy)
  if (isNeedy && !wasNeedy) {
    agent._waitGen = (agent._waitGen || 0) + 1;
  }

  agent.status = status;
  const badge = agent.card.querySelector(".status-badge");
  const labels = { working: "working", waiting: "needs input", asking: "has question", idle: "" };

  // Check if this needy state has been dismissed
  const dismissed = isNeedy && isDismissed(name, agent._waitGen);

  badge.textContent = dismissed ? "dismissed" : (labels[status] || "");
  badge.className = `status-badge ${dismissed ? "dismissed" : status}`;
  agent.card.classList.toggle("needs-input", isNeedy && !dismissed);
  agent.card.classList.toggle("status-dismissed", dismissed);

  // Show/hide dismiss option in more menu
  const dismissItem = agent.card.querySelector('[data-action="dismiss-status"]');
  if (dismissItem) dismissItem.style.display = (isNeedy && !dismissed) ? "" : "none";

  updateDashboardDot();

  // Show/hide prompt action buttons (only for "waiting" status with tool prompts)
  const actionsBar = agent.card.querySelector(".prompt-actions");
  if (status !== "waiting" || !promptType) {
    if (actionsBar.innerHTML !== "") actionsBar.innerHTML = "";
    actionsBar.style.display = "none";
      return;
  }
  // "asking" status doesn't need action buttons — user types in the regular input

  actionsBar.style.display = "";

  // After any prompt button click: scroll terminal + request fresh output from server
  function afterPromptAction() {
    const t = agent.card.querySelector(".terminal");
    if (t) {
      t._userScrolledUp = false;
      t._forceScrollUntil = Date.now() + 3000;
      for (const ms of [500, 1000, 2000, 3000]) {
        setTimeout(() => { t.scrollTop = t.scrollHeight; }, ms);
      }
    }
    // Also clear _lastContent so the next server push always renders
    if (t) t._lastContent = null;
    // Pull fresh output from server (backup for push-based updates)
    scheduleRefresh(name);
  }

  if (promptType === "permission") {
    actionsBar.innerHTML = `
      <button class="prompt-btn prompt-btn-allow" data-action="allow-once">Allow Once</button>
      <button class="prompt-btn prompt-btn-always" data-action="allow-always">Allow Always</button>
      <button class="prompt-btn prompt-btn-deny" data-action="deny">Deny</button>
    `;
    actionsBar.querySelector('[data-action="allow-once"]').addEventListener("click", () => {
      sendKeypress(name, "Enter");
      afterPromptAction();
    });
    actionsBar.querySelector('[data-action="allow-always"]').addEventListener("click", () => {
      sendKeypress(name, "Down");
      setTimeout(() => { sendKeypress(name, "Enter"); afterPromptAction(); }, 150);
    });
    actionsBar.querySelector('[data-action="deny"]').addEventListener("click", () => {
      sendKeypress(name, ["Down", "Down"]);
      setTimeout(() => { sendKeypress(name, "Enter"); afterPromptAction(); }, 150);
    });
  } else if (promptType === "yesno") {
    actionsBar.innerHTML = `
      <button class="prompt-btn prompt-btn-allow" data-action="yes">Yes</button>
      <button class="prompt-btn prompt-btn-deny" data-action="no">No</button>
    `;
    actionsBar.querySelector('[data-action="yes"]').addEventListener("click", () => {
      sendInput(name, "y");
      afterPromptAction();
    });
    actionsBar.querySelector('[data-action="no"]').addEventListener("click", () => {
      sendInput(name, "n");
      afterPromptAction();
    });
  } else if (promptType === "question" && agent.promptOptions) {
    // AskUserQuestion: number keys INSTANTLY select options (no arrow keys or Enter needed).
    // Pressing "1" selects option 1, "2" selects option 2, etc.
    // This avoids all arrow key escape sequence race conditions.
    const isTypeOption = (label) => /type\s*something|^other$/i.test(label);

    let html = '<div class="prompt-options">';
    for (const opt of agent.promptOptions) {
      if (isTypeOption(opt.label)) {
        // Inline text input for free-text "Type something" / "Other" options
        html += `<div class="prompt-type-input-wrap">
          <input type="text" class="prompt-type-input" data-num="${opt.index + 1}" placeholder="Type your answer...">
          <button class="prompt-btn prompt-btn-allow prompt-type-send" data-num="${opt.index + 1}">\u21B5</button>
        </div>`;
      } else {
        const title = opt.description ? escapeHtml(opt.description) : "";
        html += `<button class="prompt-btn prompt-btn-option" data-num="${opt.index + 1}" title="${title}">${escapeHtml(opt.label)}</button>`;
      }
    }
    html += '</div>';
    actionsBar.innerHTML = html;

    // Option buttons: just send the digit — Claude instantly selects it
    for (const btn of actionsBar.querySelectorAll(".prompt-btn-option[data-num]")) {
      btn.addEventListener("click", () => {
        sendKeypress(name, btn.dataset.num);
        afterPromptAction();
      });
    }

    // "Type something" inputs: press digit to select the option, wait for text input, then type
    for (const inp of actionsBar.querySelectorAll(".prompt-type-input")) {
      const num = inp.dataset.num;
      const doTypeSubmit = () => {
        const text = inp.value.trim();
        if (!text) return;
        // Server: sends digit key, waits 400ms, then types the literal text + Enter
        sendTypeOption(name, [num], text);
        inp.value = "";
        afterPromptAction();
      };
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") doTypeSubmit();
      });
      const sendBtn = actionsBar.querySelector(`.prompt-type-send[data-num="${num}"]`);
      if (sendBtn) sendBtn.addEventListener("click", doTypeSubmit);
    }
  } else if (promptType === "enter") {
    actionsBar.innerHTML = `
      <button class="prompt-btn prompt-btn-allow" data-action="enter">Press Enter</button>
    `;
    actionsBar.querySelector('[data-action="enter"]').addEventListener("click", () => {
      sendKeypress(name, "Enter");
      afterPromptAction();
    });
  }
}

function updateEmptyState() {
  if (agents.size > 0) {
    emptyState.style.display = "none";
    return;
  }
  // Don't show empty state while the page loader is still up — avoids flash
  if (!_loaderDismissed) return;
  emptyState.style.display = "block";
  if (_needsSetup) {
    emptyState.innerHTML =
      '<div class="setup-banner">' +
        '<p><strong>Welcome to CEO Dashboard!</strong></p>' +
        '<p>You\'re running with defaults. To configure workspaces, shell alias, and auto-start:</p>' +
        '<pre>npm run setup</pre>' +
        '<p style="margin-top:8px;opacity:0.7">Everything works without setup — create an agent or use the terminal below to get started.</p>' +
      '</div>';
  } else {
    emptyState.innerHTML = '<p>No agents running. Click <strong>+ New Agent</strong> to start one.</p>';
  }
}

function shortPath(p) {
  if (!p) return "";
  if (!_homedir) return p;
  return p.replace(new RegExp("^" + _homedir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "~");
}

function updateBranchDisplay(card, branch, isWorktree) {
  const el = card.querySelector(".branch-info");
  if (!el) return;
  if (!branch) { el.textContent = ""; el.className = "branch-info"; return; }
  el.textContent = isWorktree ? `worktree: ${branch}` : branch;
  el.className = isWorktree ? "branch-info worktree" : "branch-info";
}

// --- Token Usage Display ---

// Claude Opus 4 pricing per 1M tokens
const TOKEN_PRICES = {
  input: 15,          // $15/M input
  output: 75,         // $75/M output
  cacheCreation: 18.75, // $18.75/M cache write
  cacheRead: 1.50,    // $1.50/M cache read
};

let _tokenShowDollars = localStorage.getItem("ceo-token-show-dollars") === "true";

function formatTokenCount(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

function usageToDollars(u) {
  return ((u.input || 0) * TOKEN_PRICES.input
    + (u.output || 0) * TOKEN_PRICES.output
    + (u.cacheCreation || 0) * TOKEN_PRICES.cacheCreation
    + (u.cacheRead || 0) * TOKEN_PRICES.cacheRead) / 1_000_000;
}

function formatDollars(n) {
  if (n >= 1000) return "$" + (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  if (n >= 100) return "$" + Math.round(n);
  if (n >= 1) return "$" + n.toFixed(2);
  return "$" + n.toFixed(3);
}

function sumUsage(u) {
  return (u.input || 0) + (u.output || 0) + (u.cacheCreation || 0) + (u.cacheRead || 0);
}

function formatUsageValue(u) {
  if (_tokenShowDollars) return formatDollars(usageToDollars(u));
  return formatTokenCount(sumUsage(u));
}

function usageTooltip(label, u) {
  const tokens = `Input: ${formatTokenCount(u.input || 0)} | Output: ${formatTokenCount(u.output || 0)} | Cache write: ${formatTokenCount(u.cacheCreation || 0)} | Cache read: ${formatTokenCount(u.cacheRead || 0)}`;
  const dollars = formatDollars(usageToDollars(u));
  return `${label} — ${tokens} (${dollars})`;
}

function updateTokenUsageDisplay(msg) {
  if (!msg) return;
  // Server sends { type: "token-usage", usage: { agents, daily, ...perAgent } }
  const payload = msg.usage || msg;
  const agentData = payload.agents || {};
  const dailyData = payload.daily || {};

  // Save to localStorage
  const stored = JSON.parse(localStorage.getItem("ceo-token-usage") || "{}");
  stored.agents = stored.agents || {};
  for (const [name, data] of Object.entries(agentData)) {
    stored.agents[name] = data;
  }
  stored.daily = dailyData;
  localStorage.setItem("ceo-token-usage", JSON.stringify(stored));

  updateHeaderTokenTotals(stored);
}

function updateHeaderTokenTotals(stored) {
  const allAgents = stored.agents || {};
  const dailyData = stored.daily || {};

  // All time total
  const allTime = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
  for (const data of Object.values(allAgents)) {
    allTime.input += data.input || 0;
    allTime.output += data.output || 0;
    allTime.cacheCreation += data.cacheCreation || 0;
    allTime.cacheRead += data.cacheRead || 0;
  }

  // Today
  const d = new Date();
  const todayKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const todayUsage = dailyData[todayKey] || { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };

  // This month
  const monthPrefix = todayKey.slice(0, 7);
  const monthUsage = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
  for (const [day, u] of Object.entries(dailyData)) {
    if (day.startsWith(monthPrefix)) {
      monthUsage.input += u.input || 0;
      monthUsage.output += u.output || 0;
      monthUsage.cacheCreation += u.cacheCreation || 0;
      monthUsage.cacheRead += u.cacheRead || 0;
    }
  }

  const elTotal = document.getElementById("token-usage-total");
  const elMonth = document.getElementById("token-usage-month");
  const elToday = document.getElementById("token-usage-today");

  const allTimeSum = sumUsage(allTime);

  if (elTotal) { elTotal.textContent = allTimeSum > 0 ? formatUsageValue(allTime) : "—"; elTotal.title = usageTooltip("All time", allTime); }
  if (elMonth) { elMonth.textContent = sumUsage(monthUsage) > 0 ? formatUsageValue(monthUsage) : "—"; elMonth.title = usageTooltip("This month", monthUsage); }
  if (elToday) { elToday.textContent = sumUsage(todayUsage) > 0 ? formatUsageValue(todayUsage) : "—"; elToday.title = usageTooltip("Today", todayUsage); }

  // Show/hide wrapper
  const wrap = document.getElementById("token-usage-wrap");
  if (wrap) wrap.style.display = allTimeSum > 0 ? "" : "none";
}

// Click to toggle between tokens and dollars
document.getElementById("token-usage-wrap")?.addEventListener("click", () => {
  _tokenShowDollars = !_tokenShowDollars;
  localStorage.setItem("ceo-token-show-dollars", _tokenShowDollars);
  const stored = JSON.parse(localStorage.getItem("ceo-token-usage") || "{}");
  if (stored.agents) updateHeaderTokenTotals(stored);
});

// Load cached token usage from localStorage on page load
(function() {
  const stored = JSON.parse(localStorage.getItem("ceo-token-usage") || "{}");
  if (stored.agents && Object.keys(stored.agents).length > 0) {
    updateHeaderTokenTotals(stored);
  }
})();

// --- Agent Doc Helpers (multi-doc per agent) ---

async function refreshAgentDocs(name, listEl, emptyEl, badgeEl, card) {
  try {
    const res = await fetch(`/api/agent-docs/${encodeURIComponent(name)}`);
    const docs = await res.json();
    if (docs.length > 0) {
      badgeEl.classList.remove("empty");
      badgeEl.textContent = docs.length;
      emptyEl.style.display = "none";
      listEl.innerHTML = "";
      listEl.style.display = "";
      for (const doc of docs) {
        const item = document.createElement("div");
        item.className = "agent-doc-list-item";
        item.innerHTML = `
          <span class="agent-doc-list-name">${escapeHtml(doc.name)}</span>
          <span class="agent-doc-list-meta">${formatSize(doc.size)}</span>
        `;
        item.addEventListener("click", () => openAgentDoc(name, doc.name, card));
        makeKeyboardActivatable(item);
        listEl.appendChild(item);
      }
    } else {
      badgeEl.classList.add("empty");
      badgeEl.textContent = "0";
      listEl.innerHTML = "";
      listEl.style.display = "none";
      emptyEl.style.display = "";
    }
  } catch {}
}

async function openAgentDoc(agentName, docName, card) {
  const detail = card.querySelector(".agent-doc-detail");
  const list = card.querySelector(".agent-doc-list");
  const empty = card.querySelector(".agent-doc-empty");
  const rendered = card.querySelector(".agent-doc-rendered");
  const editArea = card.querySelector(".agent-doc-edit-area");
  const detailNameEl = card.querySelector(".agent-doc-detail-name");
  const toggle = card.querySelector(".agent-doc-toggle");
  const saveBtn = card.querySelector(".agent-doc-save-btn");
  const docBody = card.querySelector(".agent-doc-body");

  list.style.display = "none";
  empty.style.display = "none";
  detail.style.display = "";
  detail.dataset.docName = docName;
  // Set a readable default height for doc detail view
  if (docBody) docBody.style.height = "200px";
  detailNameEl.textContent = docName;

  try {
    const res = await fetch(`/api/agent-docs/${encodeURIComponent(agentName)}/${encodeURIComponent(docName)}`);
    const data = await res.json();
    const content = data.content || "";
    editArea.value = content;
    editArea.dataset.original = content;
    rendered.innerHTML = marked.parse(content);
    rendered.style.display = "";
    editArea.style.display = "none";
    toggle.classList.remove("active");
    toggle.textContent = "Raw";
    saveBtn.style.display = "none";
  } catch {}
}

async function saveAgentDoc(agentName, docName, content, renderedEl, editArea) {
  try {
    await fetch(`/api/agent-docs/${encodeURIComponent(agentName)}/${encodeURIComponent(docName)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    editArea.dataset.original = content;
    renderedEl.innerHTML = marked.parse(content);
    renderedEl.style.display = "";
    editArea.style.display = "none";
  } catch {
    alert("Failed to save doc");
  }
}

function startDocPolling() {
  setInterval(async () => {
    for (const [name, agent] of agents) {
      const section = agent.card.querySelector(".agent-doc-section");
      if (!section) continue;
      const badgeEl = section.querySelector(".agent-doc-badge");

      // Always poll badge count (even when section is collapsed)
      try {
        const res = await fetch(`/api/agent-docs/${encodeURIComponent(name)}`);
        const docs = await res.json();
        if (docs.length > 0) {
          badgeEl.classList.remove("empty");
          badgeEl.textContent = docs.length;
        } else {
          badgeEl.classList.add("empty");
          badgeEl.textContent = "0";
        }

        // If section is open and not viewing a specific doc, refresh the list too
        if (section.classList.contains("open")) {
          const detail = section.querySelector(".agent-doc-detail");
          if (!detail || detail.style.display === "none") {
            const listEl = section.querySelector(".agent-doc-list");
            const emptyEl = section.querySelector(".agent-doc-empty");
            refreshAgentDocs(name, listEl, emptyEl, badgeEl, agent.card);
          }
        }
      } catch {}
    }
    }, 8000);
}

// --- Slash Command Autocomplete ---

async function loadSlashCommands() {
  try {
    const res = await fetch("/api/slash-commands");
    slashCommands = await res.json();
  } catch {
    slashCommands = [];
  }
}

function setupAutocomplete(input, card) {
  const dropdown = document.createElement("div");
  dropdown.className = "slash-dropdown";
  card.querySelector(".card-input").appendChild(dropdown);

  let activeIndex = -1;

  function showDropdown(matches) {
    dropdown.innerHTML = "";
    activeIndex = -1;
    if (matches.length === 0) {
      dropdown.classList.remove("visible");
      return;
    }
    for (const cmd of matches) {
      const item = document.createElement("div");
      item.className = "slash-item";
      item.innerHTML = `
        <span class="slash-item-name">${escapeHtml(cmd.name)}</span>
        <span class="slash-item-desc">${escapeHtml(cmd.description)}</span>
        ${cmd.custom ? '<span class="slash-item-badge">custom</span>' : ""}
      `;
      item.addEventListener("mousedown", (e) => {
        e.preventDefault(); // prevent input blur
        input.value = cmd.name + " ";
        hideDropdown();
        input.focus();
      });
      dropdown.appendChild(item);
    }
    dropdown.classList.add("visible");
  }

  function hideDropdown() {
    dropdown.classList.remove("visible");
    activeIndex = -1;
  }

  function setActive(index) {
    const items = dropdown.querySelectorAll(".slash-item");
    items.forEach((el) => el.classList.remove("active"));
    if (index >= 0 && index < items.length) {
      activeIndex = index;
      items[index].classList.add("active");
      items[index].scrollIntoView({ block: "nearest" });
    }
  }

  input.addEventListener("input", () => {
    const val = input.value;
    if (val.startsWith("/") && !val.includes(" ")) {
      const q = val.toLowerCase();
      const matches = slashCommands.filter((c) => c.name.startsWith(q));
      showDropdown(matches);
    } else {
      hideDropdown();
    }
  });

  input.addEventListener("keydown", (e) => {
    if (!dropdown.classList.contains("visible")) return;

    const items = dropdown.querySelectorAll(".slash-item");
    if (items.length === 0) return;

    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(activeIndex <= 0 ? items.length - 1 : activeIndex - 1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(activeIndex >= items.length - 1 ? 0 : activeIndex + 1);
    } else if (e.key === "Tab") {
      e.preventDefault();
      const selected = items[activeIndex >= 0 ? activeIndex : 0];
      const name = selected.querySelector(".slash-item-name").textContent;
      input.value = name + " ";
      hideDropdown();
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      const selected = items[activeIndex];
      const name = selected.querySelector(".slash-item-name").textContent;
      input.value = name + " ";
      hideDropdown();
    } else if (e.key === "Escape") {
      hideDropdown();
    }
  });

  input.addEventListener("blur", () => {
    // Small delay so mousedown on dropdown items fires first
    setTimeout(hideDropdown, 150);
  });
}

// --- Keyboard shortcuts ---

document.addEventListener("keydown", (e) => {
  let inInput = e.target.matches("input, textarea, [contenteditable]");
  // Suppress hotkeys while page loader is showing or reload is in flight
  // BUT allow typing in inputs (user may have focus restored before loader finishes)
  if (!_loaderDismissed || _reloadingPage) { if (!inInput) return; }

  // If focus is on body but we had an active textarea recently, redirect to it
  // instead of letting the keypress trigger a hotkey. This catches the cascading
  // bug where programmatic focus loss → body → next keystroke triggers hotkey.
  if (!inInput && (e.target === document.body || e.target === document.documentElement)) {
    if (_lastActiveTextarea && _lastActiveTextarea.isConnected && (Date.now() - _lastActiveTextareaAt) < 5000 && (Date.now() - _userClickedAt) > 300) {
      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        const ta = _lastActiveTextarea;
        ta.focus({ preventScroll: true });
        // Insert the printable character that was meant for the textarea
        if (e.key.length === 1) {
          const start = ta.selectionStart || 0;
          const end = ta.selectionEnd || 0;
          ta.value = ta.value.slice(0, start) + e.key + ta.value.slice(end);
          ta.selectionStart = ta.selectionEnd = start + 1;
          ta.dispatchEvent(new Event("input", { bubbles: true }));
          e.preventDefault();
        }
        // For non-printable keys (Backspace, arrows, etc.), focus is restored
        // and the next keypress will work normally. One keystroke may be lost
        // but that's acceptable — the focus is back where it belongs.
        return;
      }
    }
  }

  const inShell = !!e.target.closest("#shell-panel");
  const inFilesPanel = !!e.target.closest("#files-panel");
  const todoSettingsOverlay = document.getElementById("todo-settings-overlay");
  const bugReportOverlay = document.getElementById("bug-report-overlay");
  const bugSuccessOverlay = document.getElementById("bug-success-overlay");
  const modalOpen = !modalOverlay.classList.contains("hidden") || !wsModalOverlay.classList.contains("hidden") || (todoSettingsOverlay && !todoSettingsOverlay.classList.contains("hidden")) || (_diffOverlay && !_diffOverlay.classList.contains("hidden")) || (bugReportOverlay && !bugReportOverlay.classList.contains("hidden")) || (bugSuccessOverlay && !bugSuccessOverlay.classList.contains("hidden"));

  // Escape: layered dismiss (fullscreen → modals → file editor → files panel → shell → agent tmux)
  if (e.key === "Escape") {
    const fullscreenCard = document.querySelector(".agent-card.fullscreen");
    if (fullscreenCard) {
      e.preventDefault();
      fullscreenCard.classList.remove("fullscreen");
      const btn = fullscreenCard.querySelector(".expand-btn");
      if (btn) { btn.innerHTML = "\u26F6"; btn.title = "Fullscreen"; }
      document.body.style.overflow = "";
      scheduleMasonry();
      return;
    }
    if (_diffOverlay && !_diffOverlay.classList.contains("hidden")) {
      e.preventDefault();
      closeDiffModal();
      return;
    }
    if (!modalOverlay.classList.contains("hidden")) {
      e.preventDefault();
      closeNewAgentModal();
      newAgentBtn.focus();
      return;
    }
    if (!wsModalOverlay.classList.contains("hidden")) {
      e.preventDefault();
      wsModalOverlay.classList.add("hidden");
      return;
    }
    if (_ueOverlay && !_ueOverlay.classList.contains("hidden")) {
      e.preventDefault();
      _ueOverlay.classList.add("hidden");
      _updateErrorShowing = false;
      return;
    }
    if (_diffOverlay && !_diffOverlay.classList.contains("hidden")) {
      e.preventDefault();
      closeDiffModal();
      return;
    }
    if (bugReportOverlay && !bugReportOverlay.classList.contains("hidden")) {
      e.preventDefault();
      if (window.closeBugReportModal) window.closeBugReportModal();
      else bugReportOverlay.classList.add("hidden");
      return;
    }
    if (bugSuccessOverlay && !bugSuccessOverlay.classList.contains("hidden")) {
      e.preventDefault();
      bugSuccessOverlay.classList.add("hidden");
      return;
    }
    // Todo settings modal
    if (todoSettingsOverlay && !todoSettingsOverlay.classList.contains("hidden")) {
      e.preventDefault();
      closeTodoSettings();
      return;
    }
    // Todo view — back to agents
    if (typeof currentView !== "undefined" && currentView === "todo") {
      e.preventDefault();
      showAgentsView();
      return;
    }
    // Bookmarks panel
    if (_bmPanel && _bmPanel.classList.contains("visible")) {
      e.preventDefault();
      closeBookmarksPanel();
      if (_bmBtn) _bmBtn.focus();
      return;
    }
    // Settings panel
    if (settingsPanel && settingsPanel.classList.contains("visible")) {
      e.preventDefault();
      closeSettingsPanel();
      settingsBtn.focus();
      return;
    }
    // Files panel: close editor first, then panel
    if (filesPanel && filesPanel.classList.contains("visible")) {
      e.preventDefault();
      if (!fileEditor.classList.contains("hidden")) {
        closeFileEditor();
      } else {
        closeFilesPanel();
        filesBtn.focus();
      }
      return;
    }
    // Shell terminal: close panel, return focus to body
    if (inShell && document.getElementById("shell-panel").classList.contains("open")) {
      e.preventDefault();
      document.getElementById("shell-header").click();
      document.getElementById("shell-header").focus();
      return;
    }
    // If typing in a card input, just blur
    if (inInput && !inShell && !inFilesPanel) return;
    // Agent card: send Escape to tmux
    const card = e.target.closest(".agent-card");
    if (card) {
      const agentName = card.querySelector(".agent-name")?.textContent;
      if (agentName) {
        e.preventDefault();
        sendKeypress(agentName, "Escape");
      }
    }
    return;
  }

  // Modifier keys — never hijack browser shortcuts
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  // Skip hotkeys when modals are open
  if (modalOpen) return;

  const key = e.key.toLowerCase();

  // Panel toggle hotkeys — work even from inside their own panel (to close)
  // T toggles terminal (Escape closes it when focused inside xterm)
  if (key === "t" && !inInput) {
    e.preventDefault();
    document.getElementById("shell-header").click();
    return;
  }
  if (key === "f" && !inInput) {
    e.preventDefault();
    filesBtn.click();
    if (!filesPanel.classList.contains("visible")) filesBtn.focus();
    return;
  }
  if (key === "b" && !inInput) {
    e.preventDefault();
    toggleBookmarksPanel();
    return;
  }
  if (key === "s" && !inInput) {
    e.preventDefault();
    settingsBtn.click();
    if (!settingsPanel.classList.contains("visible")) settingsBtn.focus();
    return;
  }

  // Remaining hotkeys — skip if typing in any input
  if (inInput) return;

  if (key === "d") {
    e.preventDefault();
    toggleTodoView();
    return;
  }
  if (key === "r") {
    e.preventDefault();
    restartServer();
    return;
  }
  if (key === "!") {
    e.preventDefault();
    document.getElementById("bug-report-btn").click();
    return;
  }
  if (key === "n") {
    e.preventDefault();
    newAgentBtn.click();
    return;
  }
  if (key === "c") {
    e.preventDefault();
    if (filesPanel.classList.contains("visible") && currentFilePath === "__ceo_md__") {
      closeFilesPanel();
      ceoMdBtn.focus();
    } else {
      ceoMdBtn.click();
    }
    return;
  }
  if (key === "/") {
    e.preventDefault();
    const firstCard = grid.querySelector(".agent-card:not(.minimized)");
    if (firstCard) {
      const inp = firstCard.querySelector(".card-input textarea");
      if (inp) inp.focus();
    }
    return;
  }
  // 1-9: focus card N's input
  const num = parseInt(key);
  if (num >= 1 && num <= 9) {
    const cards = [...grid.querySelectorAll(".agent-card:not(.minimized)")];
    if (cards[num - 1]) {
      e.preventDefault();
      const inp = cards[num - 1].querySelector(".card-input textarea");
      if (inp) inp.focus();
    }
    return;
  }
});

// --- Init ---

loadSlashCommands();
startDocPolling();
startTodoRefsPolling();

// --- Page loader: wait for ALL agents to have terminal content before revealing ---
let _expectedAgentCount = 0;
let _agentsWithContent = new Set();
let _loaderDismissed = false;
let _sessionsReceived = false; // true after /api/sessions fetch resolves
let _wsSessionsReceived = false; // true after WS "sessions" message arrives
let _savedReloadState = null; // set during restore to apply after loader

function dismissPageLoader() {
  if (_loaderDismissed) return;
  _loaderDismissed = true;
  const loader = document.getElementById("page-loader");
  if (loader) {
    // Try graceful fade first
    loader.classList.add("fade-out");
    loader.addEventListener("transitionend", () => loader.remove(), { once: true });
    // 400ms: force hide (covers transition not firing)
    setTimeout(() => { if (loader.parentNode) { loader.style.display = "none"; } }, 400);
    // 800ms: force remove from DOM
    setTimeout(() => { if (loader.parentNode) loader.remove(); }, 800);
  }
  // Now that loader is dismissed, let empty state show if there are genuinely 0 agents
  updateEmptyState();
  // Restore remaining state (panels, scroll, modals) after a frame so layout settles
  requestAnimationFrame(() => {
    try {
      if (_savedReloadState) {
        _applyRestoredState(_savedReloadState);
        _savedReloadState = null;
      } else {
        // First load (no reload state) — auto-open shell if not explicitly closed before
        const shellPref = localStorage.getItem("ceo-shell-open");
        if (shellPref !== "0") {
          const header = document.getElementById("shell-header");
          const panel = document.getElementById("shell-panel");
          if (header && panel && !panel.classList.contains("open")) {
            header.click();
          }
        }
      }
    } catch (e) {
      console.error("[loader] Error restoring state:", e);
    }
  });
}

function checkAllAgentsLoaded() {
  if (_loaderDismissed) return;
  // Don't dismiss for count===0 until we've actually received the session list
  // (WS output can arrive before the fetch resolves, leaving _expectedAgentCount at 0)
  if (!_sessionsReceived) return;
  if (_expectedAgentCount === 0) {
    // During a reload/restart, the REST fetch can return 0 sessions before the
    // server has fully restored tmux sessions. Wait for WS to confirm instead
    // of immediately showing empty state. The 3s safety timeout still applies.
    if (_savedReloadState && !_wsSessionsReceived) return;
    dismissPageLoader();
    return;
  }
  if (_agentsWithContent.size >= _expectedAgentCount) {
    // All agents have content — run masonry then dismiss after layout settles.
    scheduleMasonry();
    // Wait two rAFs (layout + paint) then dismiss so cards don't jump
    requestAnimationFrame(() => {
      requestAnimationFrame(() => dismissPageLoader());
    });
  }
}

// Safety: dismiss loader after 3s no matter what (server lag, dead agents, etc.)
setTimeout(() => { if (!_loaderDismissed) dismissPageLoader(); }, 3000);
// Hard safety: force-remove loader DOM at 4s and 6s — two chances, no transitions, just remove
for (const ms of [4000, 6000]) {
  setTimeout(() => {
    const loader = document.getElementById("page-loader");
    if (loader) {
      loader.style.display = "none";
      loader.remove();
      _loaderDismissed = true;
    }
  }, ms);
}

// Load existing sessions first, then connect WebSocket
function _loadSessions(retries) {
  fetch("/api/sessions", { signal: AbortSignal.timeout(5000) })
    .then((r) => r.json())
    .then((sessions) => {
      _expectedAgentCount = sessions.length;
      _sessionsReceived = true;
      for (const s of sessions) {
        try {
          if (s.type === "terminal") {
            addTerminalCard(s.name, s.workdir);
          } else {
            addAgentCard(s.name, s.workdir, s.branch, s.isWorktree, s.favorite, s.minimized);
          }
        } catch (e) {
          console.error("[init] Failed to add card for", s.name, e);
        }
      }
      reorderCards();
      updateEmptyState();
      // Restore drafts + focus EARLY (before loader dismisses) so user can type immediately
      try {
        if (_savedReloadState) _applyEarlyState(_savedReloadState);
      } catch (e) {
        console.error("[loader] Error in early state restore:", e);
      }
      // If no agents, dismiss immediately
      checkAllAgentsLoaded();
    })
    .catch(() => {
      if (retries > 0) {
        setTimeout(() => _loadSessions(retries - 1), 800);
      } else {
        _sessionsReceived = true;
        dismissPageLoader();
      }
    });
}
_loadSessions(5);

connect();

// --- Restore state after hot-reload or app restart ---
// Check sessionStorage first (hot-reload), then localStorage (app kill/restart).
try {
  const saved = sessionStorage.getItem("ceo-reload-state") || localStorage.getItem("ceo-reload-state");
  if (saved) {
    sessionStorage.removeItem("ceo-reload-state");
    localStorage.removeItem("ceo-reload-state");
    _savedReloadState = JSON.parse(saved);
  }
} catch {}

// Save state on page hide (app kill, tab close, navigation away).
// pagehide fires reliably in WKWebView and mobile Safari; beforeunload does not.
window.addEventListener("pagehide", () => {
  try {
    localStorage.setItem("ceo-reload-state", JSON.stringify(buildReloadState()));
  } catch {}
});

// Auto-save drafts every 5s so force-kills don't lose input
setInterval(() => {
  try {
    // Only save if there are actual drafts or pasted content worth preserving
    let hasDrafts = false;
    for (const [, agent] of agents) {
      const textarea = agent.card?.querySelector(".card-input textarea");
      if ((textarea && textarea.value) || (agent.pasteState && agent.pasteState.content)) {
        hasDrafts = true;
        break;
      }
    }
    if (hasDrafts) {
      localStorage.setItem("ceo-reload-state", JSON.stringify(buildReloadState()));
    }
  } catch {}
}, 5000);

// Early restore: drafts + focus applied as soon as cards exist (before loader dismisses).
// This lets the user start typing immediately during load.
let _earlyStateApplied = false;
function _applyEarlyState(state) {
  if (_earlyStateApplied) return;
  _earlyStateApplied = true;
  // 1. Restore input drafts
  if (state.drafts) {
    for (const [name, text] of Object.entries(state.drafts)) {
      const agent = agents.get(name);
      if (agent) {
        const textarea = agent.card.querySelector(".card-input textarea");
        if (textarea) {
          textarea.value = text;
          textarea.style.height = "1px";
          textarea.style.height = Math.min(textarea.scrollHeight, 150) + "px";
        }
      }
    }
  }
  // 2. Restore attachments
  if (state.attachments) {
    for (const [name, items] of Object.entries(state.attachments)) {
      const agent = agents.get(name);
      if (agent && agent.pendingAttachments) {
        agent.pendingAttachments.length = 0;
        for (const item of items) agent.pendingAttachments.push(item);
        renderAttachmentChips(agent.card, agent.pendingAttachments);
      }
    }
  }
  // 2b. Restore pasted content
  if (state.pastedContent) {
    for (const [name, text] of Object.entries(state.pastedContent)) {
      const agent = agents.get(name);
      if (agent && agent.pasteState) {
        agent.pasteState.content = text;
        const lines = text.split("\n");
        renderPasteChip(agent.card, lines.length, () => {
          agent.pasteState.content = null;
        });
      }
    }
  }
  // 3. Restore focus immediately so user can keep typing
  _restoreFocusFromState(state);
}

// Apply remaining state after loader dismisses (panels, scroll, modals)
function _applyRestoredState(state) {
  // Drafts/attachments/focus already applied in _applyEarlyState — skip if done
  if (!_earlyStateApplied) _applyEarlyState(state);
  // 3. Force all terminals to scroll to bottom on reload.
  // Saved scroll positions are unreliable after innerHTML rebuild — the offsets
  // become stale and leave terminals stuck at the top.
  for (const [, agent] of agents) {
    if (agent.terminal) {
      agent.terminal._userScrolledUp = false;
      agent.terminal._forceScrollUntil = Date.now() + 5000;
      agent.terminal._wheelGraceUntil = Date.now() + 1500;
      scrollTerminalToBottom(agent.terminal);
    }
  }
  // 4. Restore page scroll position
  window.scrollTo(0, state.scrollY || 0);
  // 5. Restore current view (todo vs agents)
  if (state.currentView === "todo") {
    // Set todo state before showing the view so it renders the right list
    if (state.todo) {
      activeListId = state.todo.activeListId;
      todoRawMode = state.todo.rawMode || false;
    }
    showTodoView();
    // After todo view renders, restore unsaved edits
    if (state.todo) {
      requestAnimationFrame(() => {
        if (state.todo.titleValue != null) {
          const titleInput = document.querySelector(".todo-title-input");
          if (titleInput) titleInput.value = state.todo.titleValue;
        }
        if (state.todo.rawContent != null) {
          const rawTextarea = document.querySelector(".todo-editor");
          if (rawTextarea) rawTextarea.value = state.todo.rawContent;
        }
        // Restore rich editor content (re-render with saved markdown)
        if (state.todo.richContent != null && !todoRawMode) {
          const richEditor = document.getElementById("todo-rich-editor");
          if (richEditor) {
            renderRichEditorContent({ content: state.todo.richContent });
          }
        }
      });
    }
  }
  // 6. Restore new-agent modal state if it was open
  if (state.modal) {
    modalOverlay.classList.remove("hidden");
    document.getElementById("agent-name").value = state.modal.name || "";
    document.getElementById("agent-prompt").value = state.modal.prompt || "";
    if (state.modal.selectedWorkdirPath) {
      setWorkdir(state.modal.selectedWorkdirPath === "__custom__"
        ? (state.modal.customWorkdir || state.modal.workdir)
        : state.modal.selectedWorkdirPath);
    }
    if (state.modal.attachments && state.modal.attachments.length > 0) {
      modalPendingAttachments.length = 0;
      for (const item of state.modal.attachments) modalPendingAttachments.push(item);
      const chipsContainer = document.getElementById("modal-attachment-chips");
      renderAttachmentChips({ querySelector: () => chipsContainer }, modalPendingAttachments);
    }
  }
  // 7. Restore shell panel state
  if (state.shellOpen) {
    const header = document.getElementById("shell-header");
    if (header && !document.getElementById("shell-panel")?.classList.contains("open")) {
      header.click();
    }
  }
  // 8. Restore side panels (files, settings, bookmarks)
  if (state.filesOpen) {
    if (!filesPanel.classList.contains("visible")) {
      filesPanel.classList.add("visible");
      filesBackdrop.classList.add("visible");
      filesBtn.classList.add("panel-active");
      loadClaudeFiles();
    }
    // Restore file editor with content + cursor
    if (state.fileEditor) {
      const fe = state.fileEditor;
      currentFilePath = fe.path;
      fileEditorName.textContent = fe.name || "";
      fileEditorHint.style.display = fe.path === "__ceo_md__" ? "" : "none";
      fileEditorContent.value = fe.content;
      filesCategories.style.display = "none";
      fileEditor.classList.remove("hidden");
      // Restore raw/rendered mode
      const isMd = fe.path.endsWith(".md") || fe.path === "__ceo_md__";
      if (isMd && !fe.rawMode) {
        fileEditorRendered.innerHTML = marked.parse(fe.content);
        fileEditorRendered.style.display = "";
        fileEditorContent.style.display = "none";
        fileEditorToggle.style.display = "";
        fileEditorToggle.textContent = "Raw";
        fileEditorToggle.classList.remove("active");
      } else {
        fileEditorRendered.style.display = "none";
        fileEditorContent.style.display = "";
        if (isMd) {
          fileEditorToggle.style.display = "";
          fileEditorToggle.textContent = "Rendered";
          fileEditorToggle.classList.add("active");
        } else {
          fileEditorToggle.style.display = "none";
        }
      }
    }
  }
  if (state.settingsOpen) {
    const sp = document.getElementById("settings-panel");
    const sb = document.getElementById("settings-backdrop");
    if (sp && !sp.classList.contains("visible")) {
      sp.classList.add("visible");
      if (sb) sb.classList.add("visible");
      settingsBtn.classList.add("panel-active");
      loadSettings();
    }
  }
  if (state.bookmarksOpen && _bmPanel) {
    if (!_bmPanel.classList.contains("visible")) {
      _bmPanel.classList.add("visible");
      _bmBackdrop.classList.add("visible");
      if (_bmBtn) _bmBtn.classList.add("panel-active");
      loadBookmarks();
    }
  }
  // 9. Re-apply scroll after layout settles (panels/modals may have shifted it)
  requestAnimationFrame(() => {
    window.scrollTo(0, state.scrollY || 0);
    // Re-focus in case panels stole it
    _restoreFocusFromState(state);
  });
}

// Shared focus restoration — used by both early and late restore phases
function _restoreFocusFromState(state) {
  function restoreFocus(el) {
    if (!el) return false;
    el.focus({ preventScroll: true });
    if (state.focusCursorStart != null && el.setSelectionRange) {
      try {
        const len = el.value?.length ?? 0;
        // If cursor was at or near end of text, snap to actual end
        // (text length may differ slightly after restore)
        const wasNearEnd = state.focusCursorStart >= (state._savedTextLength || len) - 2;
        if (wasNearEnd) {
          el.setSelectionRange(len, len);
        } else {
          const start = Math.min(state.focusCursorStart, len);
          const end = Math.min(state.focusCursorEnd ?? start, len);
          el.setSelectionRange(start, end);
        }
      } catch {}
    }
    return true;
  }
  if (state.focusedId) {
    const el = document.getElementById(state.focusedId);
    if (el && restoreFocus(el)) return;
  }
  if (state.focusedTodo) {
    let el = null;
    if (state.focusedTodo === "title") el = document.querySelector(".todo-title-input");
    else if (state.focusedTodo === "editor") el = document.querySelector(".todo-editor");
    else if (state.focusedTodo === "rich-editor") el = document.getElementById("todo-rich-editor");
    if (el && restoreFocus(el)) return;
  }
  if (state.focusedAgent) {
    const agent = agents.get(state.focusedAgent);
    if (agent) {
      const textarea = agent.card.querySelector(".card-input textarea");
      if (textarea && restoreFocus(textarea)) return;
    }
  }
  if (state.focusedDocAgent) {
    const agent = agents.get(state.focusedDocAgent);
    if (agent) {
      const editArea = agent.card.querySelector(".agent-doc-edit-area");
      if (editArea && editArea.style.display !== "none" && restoreFocus(editArea)) return;
    }
  }
}

// --- iOS Keyboard Handling ---
// When the virtual keyboard opens on iOS, scroll the focused input into view.
// Uses the visualViewport API which fires resize events as the keyboard opens/closes.
if (window.visualViewport && isMobile()) {
  let _lastVVHeight = window.visualViewport.height;

  window.visualViewport.addEventListener("resize", () => {
    const vv = window.visualViewport;
    const heightDiff = _lastVVHeight - vv.height;
    _lastVVHeight = vv.height;

    // Keyboard opened (viewport shrank significantly)
    if (heightDiff > 100) {
      const focused = document.activeElement;
      if (focused && (focused.tagName === "TEXTAREA" || focused.tagName === "INPUT")) {
        // Scroll the focused element into the visible area
        setTimeout(() => {
          focused.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 100);
      }
      // Also handle the shell panel — push it above the keyboard
      const shellPanel = document.getElementById("shell-panel");
      if (shellPanel && shellPanel.classList.contains("open")) {
        shellPanel.style.bottom = (window.innerHeight - vv.height - vv.offsetTop) + "px";
      }
    }
    // Keyboard closed (viewport grew back)
    if (heightDiff < -100) {
      const shellPanel = document.getElementById("shell-panel");
      if (shellPanel) {
        shellPanel.style.bottom = "";
      }
    }
  });

  // Mobile focusin scroll is handled by the global focusin handler (line ~3093)
  // which accounts for shell panel height and card context — no duplicate needed here.
}
