const grid = document.getElementById("agents-grid");
const minimizedBar = document.getElementById("minimized-bar");
const emptyState = document.getElementById("empty-state");
const connDot = document.getElementById("connection-dot");
const newAgentBtn = document.getElementById("new-agent-btn");
const modalOverlay = document.getElementById("modal-overlay");
const modalCancel = document.getElementById("modal-cancel");
const newAgentForm = document.getElementById("new-agent-form");
const wsModalOverlay = document.getElementById("workspace-modal-overlay");
const wsCancel = document.getElementById("workspace-cancel");
const wsForm = document.getElementById("workspace-form");

const sessionSearch = document.getElementById("session-search");
const sessionList = document.getElementById("session-list");
const sessionSelectedInfo = document.getElementById("session-selected-info");
const sessionSelectedLabel = document.getElementById("session-selected-label");
const sessionDeselect = document.getElementById("session-deselect");
const promptLabel = document.getElementById("prompt-label");

const ansiUp = new AnsiUp();
marked.use({
  gfm: true, breaks: true,
  renderer: {
    html(token) {
      const text = typeof token === 'string' ? token : (token.raw || token.text || '');
      return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  }
});

// Clean up any old theme data
localStorage.removeItem("ceo-theme");

// --- WebSocket staleness tracking ---
let _lastWsMessage = Date.now();

// --- Tab notifications (title flash + native/browser notifications + dock badge) ---
const TAB_TITLE_DEFAULT = "CEO Dashboard";
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
          new Notification(`CEO Dashboard — ${name}`, { body, tag: `ceo-${name}` });
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
    // If we haven't received any WS message in >20s, the connection is likely dead
    if (ws && Date.now() - _lastWsMessage > 20000) {
      console.log("[ws] Stale connection detected on visibility change, reconnecting");
      try { ws.close(); } catch {}
      clearTimeout(reconnectTimer);
      connect();
    }
  }
});
window.addEventListener("focus", () => {
  updateTabNotifications();
  // Same stale-connection check on window focus (covers Mac app + browser tabs)
  if (ws && Date.now() - _lastWsMessage > 20000) {
    console.log("[ws] Stale connection detected on focus, reconnecting");
    try { ws.close(); } catch {}
    clearTimeout(reconnectTimer);
    connect();
  }
});

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
    const h = card.classList.contains("resizing-height") ? cssH : Math.max(cssH, card.scrollHeight);
    const span = Math.ceil((h + GRID_GAP_PX) / GRID_ROW_PX);
    card.style.gridRow = `span ${span}`;
  }
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
      if (agent.terminal._forceScrollUntil && Date.now() < agent.terminal._forceScrollUntil) {
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
      agent.terminal._forceScrollUntil = Date.now() + 3000;
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
  // Header color
  if (layout.headerColor) {
    const h = card.querySelector(".card-header");
    if (h) {
      h.style.background = `linear-gradient(135deg, ${layout.headerColor}38 0%, ${layout.headerColor}20 100%)`;
      h.style.borderBottom = `1px solid ${layout.headerColor}50`;
    }
  }
  // Note: minimized state is now server-side, applied separately in addAgentCard
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

  // Re-append in sorted order (moves DOM nodes without recreating)
  for (const card of cards) {
    grid.appendChild(card);
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

// Build reload-persist state (used by hot-reload, server-restart, and manual restart)
function buildReloadState() {
  const state = {
    scrollY: window.scrollY,
    drafts: {},
    attachments: {},
    terminalScrolls: {},
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
    // Save title input value
    const titleInput = document.querySelector(".todo-title-input");
    if (titleInput) state.todo.titleValue = titleInput.value;
  }
  // Capture active focus (which input the cursor is in)
  const focused = document.activeElement;
  if (focused && (focused.tagName === "TEXTAREA" || focused.tagName === "INPUT")) {
    // Agent card input
    const card = focused.closest(".agent-card");
    if (card) {
      const agentName = card.querySelector(".agent-name")?.textContent;
      if (agentName) {
        state.focusedAgent = agentName;
        state.focusCursorStart = focused.selectionStart;
        state.focusCursorEnd = focused.selectionEnd;
      }
    }
    // Modal inputs
    if (focused.id === "agent-prompt" || focused.id === "agent-name") {
      state.focusedModal = focused.id;
      state.focusCursorStart = focused.selectionStart;
      state.focusCursorEnd = focused.selectionEnd;
    }
    // Todo inputs
    if (focused.closest(".todo-view")) {
      if (focused.classList.contains("todo-title-input")) {
        state.focusedTodo = "title";
      } else if (focused.classList.contains("todo-editor")) {
        state.focusedTodo = "editor";
      }
      state.focusCursorStart = focused.selectionStart;
      state.focusCursorEnd = focused.selectionEnd;
    }
    // Rich editor (contenteditable)
    if (focused.closest("#todo-rich-editor") || focused.id === "todo-rich-editor") {
      state.focusedTodo = "rich-editor";
    }
  }
  for (const [name, agent] of agents) {
    const textarea = agent.card.querySelector(".card-input textarea");
    if (textarea && textarea.value) state.drafts[name] = textarea.value;
    // Save terminal scroll position
    if (agent.terminal) {
      state.terminalScrolls[name] = agent.terminal.scrollTop;
    }
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
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    ws.close();
  }
  ws = new WebSocket(`ws://${location.host}`);
  ws.binaryType = "arraybuffer"; // Binary frames arrive as ArrayBuffer (shell PTY data)

  ws.onopen = () => {
    clearTimeout(reconnectTimer);
    _lastWsMessage = Date.now();
    updateDashboardDot();
    // Re-send shell terminal size on reconnect so PTY output is properly formatted
    if (window._shellXterm && window._shellXterm.cols) {
      ws.send(JSON.stringify({ type: "shell-resize", cols: window._shellXterm.cols, rows: window._shellXterm.rows }));
    }
    // Check if we missed a hot reload while disconnected (iOS Safari suspends WS in background)
    fetch("/api/version").then(r => r.json()).then(data => {
      if (_knownVersion === null) {
        _knownVersion = data.version;
      } else if (data.version !== _knownVersion) {
        location.reload();
      }
    }).catch(() => {});
    // Check for dashboard updates
    fetch("/api/check-update").then(r => r.json()).then(data => {
      if (data.updateAvailable) showUpdateButton(data);
    }).catch(() => {});
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

    // Binary frame = shell PTY data (hot path — zero JSON overhead)
    // Server sends raw PTY bytes as binary WebSocket frames.
    // Uint8Array feeds directly into xterm's UTF-8 parser, skipping JS string decode.
    if (event.data instanceof ArrayBuffer) {
      if (window._shellXterm) window._shellXterm.write(new Uint8Array(event.data));
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
      sessionStorage.setItem("ceo-reload-state", JSON.stringify(buildReloadState()));
      location.reload();
      return;
    }

    if (msg.type === "server-restarting") {
      sessionStorage.setItem("ceo-reload-state", JSON.stringify(buildReloadState()));
      const pollUntilReady = () => {
        fetch("/api/sessions", { signal: AbortSignal.timeout(2000) })
          .then((r) => { if (r.ok) location.reload(); else throw new Error(); })
          .catch(() => setTimeout(pollUntilReady, 500));
      };
      setTimeout(pollUntilReady, 800);
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
      window.open(msg.url, "_blank");
      return;
    }
    if (msg.type === "shell-open-url") {
      window.open(msg.url, "_blank");
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


    if (msg.type === "sessions") {
      for (const s of msg.sessions) {
        addAgentCard(s.name, s.workdir, s.branch, s.isWorktree, s.favorite, s.minimized);
      }
      reorderCards();
      updateEmptyState();
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
      if (!agents.has(msg.session)) {
        addAgentCard(msg.session, "", null, false, false);
      }
      const agent = agents.get(msg.session);
      const isFirstContent = !agent.terminal._lastContent;
      // Force scroll to bottom on first content received (handles reload/reconnect)
      // But skip force-scroll if we have saved state to restore (user's position takes priority)
      if (isFirstContent && !_savedReloadState) {
        agent.terminal._forceScrollUntil = Date.now() + 5000;
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
      }
      if (msg.branch !== undefined) {
        updateBranchDisplay(agent.card, msg.branch, msg.isWorktree);
      }
    }

    // Live input sync from another client
    if (msg.type === "input-sync") {
      const agent = agents.get(msg.session);
      if (agent) {
        const textarea = agent.card.querySelector(".card-input textarea");
        if (textarea && textarea !== document.activeElement) {
          textarea.value = msg.text;
          // Trigger auto-resize
          textarea.style.height = "auto";
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
    <div class="card-sticky-top">
      <div class="card-header">
        <div class="card-header-left">
          <span class="alert-icon" title="Needs input"></span>
          <span class="agent-name">${escapeHtml(name)}</span>
          <span class="status-badge working">working</span>
        </div>
        <div class="card-actions">
          <button class="favorite-btn" tabindex="-1" title="Favorite">&#9734;</button>
          <div class="more-menu-wrap">
            <button class="more-btn" tabindex="-1" title="More actions">&hellip;</button>
            <div class="more-menu">
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
  `;

  const terminal = card.querySelector(".terminal");
  terminal.setAttribute("tabindex", "-1");
  // Force scroll to bottom for new/reloaded cards until content settles
  terminal._forceScrollUntil = Date.now() + 5000;

  // Scroll trapping: when terminal is at bottom, don't immediately let page scroll
  setupScrollTrapping(terminal);

  // Touch tracking: suppress auto-scroll while user is touching the terminal
  terminal.addEventListener("touchstart", () => {
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
    // Don't clear input if WS isn't connected — message would be silently dropped
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // Don't send while video frames are still extracting
    if (pendingAttachments.some((a) => a.processing)) return;

    if (pendingAttachments.length > 0) {
      // Collect all paths (images + video frames)
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
      const fullText = [...videoContextParts, text].filter(Boolean).join("\n");
      sendInputWithImages(name, fullText, paths);
      // Clear attachments
      pendingAttachments.length = 0;
      const chips = card.querySelector(".attachment-chips");
      if (chips) chips.innerHTML = "";
    } else {
      sendInput(name, text);
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
  const autoResize = () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 150) + "px";
  };
  input.addEventListener("input", autoResize);

  // Collapse large pastes into a chip (like Claude CLI's "N lines pasted")
  input.addEventListener("paste", (e) => {
    let text;
    try {
      text = (e.clipboardData || window.clipboardData)?.getData("text/plain") || (e.clipboardData || window.clipboardData)?.getData("text");
    } catch {}
    if (!text) return; // let browser handle it normally

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
      input.style.height = "auto";
    }
  });
  sendBtn.addEventListener("click", () => {
    doSendFinal();
    input.style.height = "auto";
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

  // Fullscreen expand (mobile)
  expandBtn.addEventListener("click", () => {
    const isFullscreen = card.classList.toggle("fullscreen");
    if (isFullscreen) {
      expandBtn.innerHTML = "\u2715"; // ✕
      expandBtn.title = "Exit fullscreen";
      document.body.style.overflow = "hidden";
    } else {
      expandBtn.innerHTML = "\u26F6"; // ⛶
      expandBtn.title = "Fullscreen";
      document.body.style.overflow = "";
      scheduleMasonry();
    }
  });

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
        // Re-apply height since scroll changed the effective delta
        const deltaY = (lastMouseY - startY) + (window.scrollY - startScrollY);
        const newHeight = Math.max(250, startHeight + deltaY);
        card.style.height = newHeight + "px";
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
      // Height: account for both mouse movement and any auto-scrolling
      const deltaY = (ev.clientY - startY) + (window.scrollY - startScrollY);
      const newHeight = Math.max(250, startHeight + deltaY);
      card.style.height = newHeight + "px";

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

    card.classList.add("resizing-height");

    const onTouchMove = (ev) => {
      const t = ev.touches[0];
      const deltaY = t.clientY - startY;
      const newHeight = Math.max(200, startHeight + deltaY);
      card.style.height = newHeight + "px";
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
  terminal.scrollTop = terminal.scrollHeight;
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
    // Even if content is the same, keep trying to scroll during force period.
    // This handles the case where layout wasn't ready on the first attempt.
    if (terminal._forceScrollUntil && Date.now() < terminal._forceScrollUntil
        && !terminal._userTouching && !terminal._userScrolledUp) {
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
  const wasScrolledToBottom = !userInteracting &&
    terminal.scrollHeight - terminal.scrollTop - terminal.clientHeight < 30;

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
  terminal.innerHTML = `<pre>${html}</pre>`;

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
  } else if (wasScrolledToBottom) {
    // Normal follow-bottom: just sync + rAF (no delayed timers that fight user scroll)
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
    actionsBar.innerHTML = "";
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

// --- Agent Todo Refs ---

function renderAgentTodoRefs(card, todos) {
  const container = card.querySelector(".agent-todo-refs");
  if (!container) return;
  if (!todos || todos.length === 0) {
    container.innerHTML = "";
    container.style.display = "none";
    return;
  }
  container.style.display = "flex";
  container.innerHTML = todos.map((t) => `
    <span class="agent-todo-pill" title="${escapeHtml(t.title)}" data-todo-id="${t.id}">
      <span class="agent-todo-pill-dot" style="background:${safeHex(t.hex)}"></span>
      <span class="agent-todo-pill-label">${escapeHtml(t.title)}</span>
    </span>
  `).join("");
  // Click a pill → switch to todo view and select that list
  const cardName = card.querySelector(".agent-name")?.textContent || "";
  container.querySelectorAll(".agent-todo-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      const todoId = pill.dataset.todoId;
      showTodoView(cardName);
      if (todoData && todoData.lists) {
        activeListId = todoId;
        saveTodoLastList();
        renderTodoDots();
        renderActiveList();
      }
    });
  });
}

function startTodoRefsPolling() {
  async function poll() {
    for (const [name, agent] of agents) {
      try {
        const res = await fetch(`/api/todos/by-agent/${encodeURIComponent(name)}`);
        const todos = await res.json();
        renderAgentTodoRefs(agent.card, todos);
      } catch {}
    }
  }
  poll();
  setInterval(poll, 10000);
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

// --- Session Picker ---

function relativeTime(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function formatSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return bytes + "B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + "KB";
  return (bytes / (1024 * 1024)).toFixed(1) + "MB";
}

function renderSessionList(sessions) {
  sessionList.innerHTML = "";
  for (const s of sessions) {
    const item = document.createElement("div");
    item.className = "session-item" + (selectedSessionId === s.sessionId ? " selected" : "");
    item.dataset.sessionId = s.sessionId;
    item.dataset.projectPath = s.projectPath || "";

    const title = s.lastPrompt?.slice(0, 120) || s.firstPrompt?.slice(0, 120) || s.summary?.slice(0, 120) || "Untitled session";
    const subtitle = s.lastPrompt && s.firstPrompt && s.lastPrompt !== s.firstPrompt
      ? s.firstPrompt.slice(0, 80) : "";
    const branch = s.gitBranch || "";
    const time = relativeTime(s.modified);
    const size = formatSize(s.fileSize);

    item.innerHTML = `
      <div class="session-item-summary">${escapeHtml(title)}</div>
      ${subtitle ? `<div class="session-item-first-prompt">${escapeHtml(subtitle)}</div>` : ""}
      <div class="session-item-meta">
        <span>${time}</span>
        ${branch ? `<span class="session-branch">${escapeHtml(branch)}</span>` : ""}
        ${size ? `<span>${size}</span>` : ""}
      </div>
    `;

    item.addEventListener("click", () => selectSession(s));
    item.setAttribute("tabindex", "-1");
    sessionList.appendChild(item);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function extractVideoFrames(file, onProgress) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  const url = URL.createObjectURL(file);
  video.src = url;

  await new Promise((resolve, reject) => {
    video.onloadedmetadata = resolve;
    video.onerror = () => reject(new Error("Failed to load video"));
  });

  const duration = video.duration;
  const frameCount = Math.min(20, Math.max(5, Math.floor(duration / 2)));
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const frames = [];
  const baseName = file.name.replace(/\.[^.]+$/, "");

  for (let i = 0; i < frameCount; i++) {
    const time = (duration * i) / frameCount;
    video.currentTime = time;
    await new Promise((resolve) => {
      video.onseeked = resolve;
    });
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85)
    );
    const base64 = await blobToBase64(blob);
    const frameName = `${baseName}-frame-${i + 1}.jpg`;
    const res = await fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: frameName, data: base64 }),
    });
    const result = await res.json();
    if (result.path) {
      frames.push({ path: result.path, name: frameName });
    }
    if (onProgress) onProgress(i + 1, frameCount);
  }

  URL.revokeObjectURL(url);
  return { frames, duration, frameCount };
}

function renderAttachmentChips(card, attachments) {
  const container = card.querySelector(".attachment-chips");
  if (!container) return;
  // Preserve paste chip across re-renders
  const pasteChip = container.querySelector(".attachment-chip.paste");
  if (attachments.length === 0) {
    container.innerHTML = "";
    if (pasteChip) container.appendChild(pasteChip);
    return;
  }
  container.innerHTML = attachments
    .map((a, i) => {
      if (a.videoGroup) {
        const label = a.processing
          ? escapeHtml(a.progressText || `Processing ${a.name}...`)
          : `${escapeHtml(a.name)} (${a.frameCount} frames)`;
        return `<span class="attachment-chip video${a.processing ? " processing" : ""}">
          <span class="attachment-chip-name">${label}</span>
          ${a.processing ? "" : `<button class="attachment-chip-remove" data-idx="${i}">&times;</button>`}
        </span>`;
      }
      return `<span class="attachment-chip">
          <span class="attachment-chip-name">${escapeHtml(a.name)}</span>
          <button class="attachment-chip-remove" data-idx="${i}">&times;</button>
        </span>`;
    })
    .join("");
  for (const btn of container.querySelectorAll(".attachment-chip-remove")) {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.idx);
      attachments.splice(idx, 1);
      renderAttachmentChips(card, attachments);
    });
  }
  // Re-append preserved paste chip
  if (pasteChip) container.appendChild(pasteChip);
}

function renderPasteChip(card, lineCount, onRemove) {
  const container = card.querySelector(".attachment-chips");
  if (!container) return;
  // Remove any existing paste chip first
  const existing = container.querySelector(".attachment-chip.paste");
  if (existing) existing.remove();

  const chip = document.createElement("span");
  chip.className = "attachment-chip paste";
  chip.innerHTML = `
    <span class="attachment-chip-name">\u{1F4CB} ${lineCount} lines pasted</span>
    <button class="attachment-chip-remove">&times;</button>
  `;
  chip.querySelector(".attachment-chip-remove").addEventListener("click", () => {
    chip.remove();
    onRemove();
  });
  container.appendChild(chip);
}

function selectSession(session) {
  // Toggle: clicking selected session deselects
  if (selectedSessionId === session.sessionId) {
    deselectSession();
    return;
  }

  selectedSessionId = session.sessionId;

  // Highlight selected item
  sessionList.querySelectorAll(".session-item").forEach((el) => {
    el.classList.toggle("selected", el.dataset.sessionId === session.sessionId);
  });

  // Show selected info
  const label = session.lastPrompt?.slice(0, 60) || session.firstPrompt?.slice(0, 60) || "Untitled";
  sessionSelectedLabel.textContent = `Resuming: ${label}`;
  sessionSelectedInfo.classList.remove("hidden");

  // Hide prompt textarea (not needed when resuming)
  promptLabel.style.display = "none";

  // Auto-fill workdir from session's projectPath
  if (session.projectPath) {
    setWorkdir(session.projectPath);
  }
}

function deselectSession() {
  selectedSessionId = null;
  sessionList.querySelectorAll(".session-item").forEach((el) => el.classList.remove("selected"));
  sessionSelectedInfo.classList.add("hidden");
  promptLabel.style.display = "";
  resetWorkdir();
}

async function fetchClaudeSessions() {
  try {
    const res = await fetch("/api/claude-sessions");
    claudeSessions = await res.json();
    renderSessionList(claudeSessions);
  } catch {
    claudeSessions = [];
  }
}

function filterSessions(query) {
  if (!query) {
    renderSessionList(claudeSessions);
    return;
  }
  const q = query.toLowerCase();
  const filtered = claudeSessions.filter((s) => {
    return (s.summary || "").toLowerCase().includes(q)
      || (s.lastPrompt || "").toLowerCase().includes(q)
      || (s.firstPrompt || "").toLowerCase().includes(q)
      || (s.gitBranch || "").toLowerCase().includes(q);
  });
  renderSessionList(filtered);
}

let searchDebounce;
sessionSearch.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => filterSessions(sessionSearch.value.trim()), 200);
});

sessionDeselect.addEventListener("click", (e) => {
  e.preventDefault();
  deselectSession();
});

let DEFAULT_WORKDIR = "";
let _homedir = ""; // set by /api/config — shortPath() is a no-op until then
let _defaultAgentName = "agent";
let _needsSetup = false;

// --- Config loading ---

fetch("/api/config")
  .then((r) => r.json())
  .then((cfg) => {
    DEFAULT_WORKDIR = cfg.defaultWorkspace || "";
    _homedir = cfg.homedir || _homedir;
    _defaultAgentName = cfg.defaultAgentName || "agent";
    selectedWorkdirPath = DEFAULT_WORKDIR;
    _needsSetup = cfg.needsSetup || false;
    _renderWorkdirPills(cfg.workspaces || []);
    updateEmptyState();
  })
  .catch(() => {});

function _renderWorkdirPills(workspaces) {
  const customBtn = workdirOptions.querySelector('[data-path="__custom__"]');
  // Remove any previously rendered workspace pills
  workdirOptions.querySelectorAll(".workdir-pill:not([data-path='__custom__'])").forEach((p) => p.remove());
  // Insert workspace pills before the Custom button
  for (const ws of workspaces) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "workdir-pill";
    btn.dataset.path = ws.path;
    btn.textContent = ws.label;
    workdirOptions.insertBefore(btn, customBtn);
  }
  // Activate the default workspace pill
  const defaultPill = workdirOptions.querySelector(`.workdir-pill[data-path="${CSS.escape(DEFAULT_WORKDIR)}"]`);
  if (defaultPill) defaultPill.classList.add("active");
}

// --- Workdir picker ---

const workdirOptions = document.getElementById("workdir-options");
const workdirCustom = document.getElementById("agent-workdir-custom");
let selectedWorkdirPath = DEFAULT_WORKDIR;

workdirOptions.addEventListener("click", (e) => {
  const pill = e.target.closest(".workdir-pill");
  if (!pill) return;
  workdirOptions.querySelectorAll(".workdir-pill").forEach((p) => p.classList.remove("active"));
  pill.classList.add("active");
  const path = pill.dataset.path;
  if (path === "__custom__") {
    workdirCustom.classList.remove("hidden");
    workdirCustom.focus();
    selectedWorkdirPath = "__custom__";
  } else {
    workdirCustom.classList.add("hidden");
    workdirCustom.value = "";
    selectedWorkdirPath = path;
  }
});

function getSelectedWorkdir() {
  if (selectedWorkdirPath === "__custom__") return workdirCustom.value.trim();
  return selectedWorkdirPath;
}

function setWorkdir(path) {
  const pill = workdirOptions.querySelector(`.workdir-pill[data-path="${CSS.escape(path)}"]`);
  workdirOptions.querySelectorAll(".workdir-pill").forEach((p) => p.classList.remove("active"));
  if (pill) {
    pill.classList.add("active");
    workdirCustom.classList.add("hidden");
    workdirCustom.value = "";
    selectedWorkdirPath = path;
  } else {
    workdirOptions.querySelector('.workdir-pill[data-path="__custom__"]').classList.add("active");
    workdirCustom.classList.remove("hidden");
    workdirCustom.value = path;
    selectedWorkdirPath = "__custom__";
  }
}

function resetWorkdir() {
  workdirOptions.querySelectorAll(".workdir-pill").forEach((p) => p.classList.remove("active"));
  const defaultPill = workdirOptions.querySelector(`.workdir-pill[data-path="${CSS.escape(DEFAULT_WORKDIR)}"]`);
  if (defaultPill) defaultPill.classList.add("active");
  workdirCustom.classList.add("hidden");
  workdirCustom.value = "";
  selectedWorkdirPath = DEFAULT_WORKDIR;
}

// --- Keyboard Accessibility Helpers ---

function makeKeyboardActivatable(el) {
  if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
  el.setAttribute("role", "button");
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      el.click();
    }
  });
}

// Track keyboard vs mouse navigation — scoped styles only show during keyboard use
document.addEventListener("keydown", (e) => {
  if (e.key === "Tab") document.body.classList.add("keyboard-nav");
});
document.addEventListener("mousedown", () => {
  document.body.classList.remove("keyboard-nav");
});

function trapFocus(container, e) {
  if (e.key !== "Tab") return;
  const focusable = [...container.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter(el => el.offsetParent !== null); // only visible elements
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

// Scroll focused element into view — generous positioning so the user always has context
document.addEventListener("focusin", (e) => {
  const el = e.target;
  // Skip elements inside fixed/overlay panels that manage their own scroll
  if (el.closest("#shell-terminal") || el.closest(".modal") || el.closest("#files-panel") || el.closest("#settings-panel")) return;
  const card = el.closest(".agent-card");
  const headerH = 60; // sticky dashboard header height
  const margin = 80;  // generous breathing room above the element

  // When focusing the card's textarea input, scroll so the input sits just
  // above the shell panel (or viewport bottom), with the agent terminal visible above
  const isCardInput = card && el.closest(".card-input");
  if (isCardInput) {
    const inputArea = el.closest(".card-input");
    const inputRect = inputArea.getBoundingClientRect();
    const shellPanel = document.getElementById("shell-panel");
    const bottomCutoff = shellPanel ? shellPanel.offsetHeight : 0;
    const viewBottom = window.innerHeight - bottomCutoff;
    const isHidden = inputRect.bottom > viewBottom - 10 || inputRect.top < headerH;
    const isTooLow = inputRect.bottom > viewBottom - 60; // too close to shell panel edge
    if (isHidden || isTooLow) {
      // Place input bottom just above the shell panel with breathing room
      const targetBottom = viewBottom - 20;
      window.scrollBy({ top: inputRect.bottom - targetBottom, behavior: "smooth" });
    }
    return;
  }

  // Only scroll if the card's input area is not visible
  if (!card) return;
  const inputArea = card.querySelector(".card-input");
  if (!inputArea) return;
  const inputRect = inputArea.getBoundingClientRect();
  const shellPanel = document.getElementById("shell-panel");
  const bottomCutoff = shellPanel ? shellPanel.offsetHeight : 0;
  const viewTop = headerH;
  const viewBottom = window.innerHeight - bottomCutoff;
  // If any part of the input is visible, don't scroll
  if (inputRect.bottom > viewTop && inputRect.top < viewBottom) return;
  // Input completely above viewport
  if (inputRect.bottom <= viewTop) {
    window.scrollBy({ top: inputRect.top - viewTop - margin, behavior: "smooth" });
  }
  // Input completely below viewport
  if (inputRect.top >= viewBottom) {
    const targetBottom = viewBottom - 20;
    window.scrollBy({ top: inputRect.bottom - targetBottom, behavior: "smooth" });
  }
});

function updateCardNumbers() {
  const cards = [...grid.querySelectorAll(".agent-card:not(.minimized)")];
  cards.forEach((card, i) => {
    let badge = card.querySelector(".card-number-badge");
    if (cards.length >= 2 && i < 9) {
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "card-number-badge";
        card.querySelector(".card-header-left").prepend(badge);
      }
      badge.textContent = i + 1;
    } else if (badge) {
      badge.remove();
    }
  });
}

// --- Modals ---

newAgentBtn.addEventListener("click", () => {
  modalOverlay.classList.remove("hidden");
  fetchClaudeSessions();
  const nameInput = document.getElementById("agent-name");
  if (!nameInput.value) nameInput.value = _defaultAgentName;
  nameInput.focus();
  nameInput.select();
});

function closeNewAgentModal() {
  modalOverlay.classList.add("hidden");
  deselectSession();
  sessionSearch.value = "";
  sessionList.innerHTML = "";
  document.getElementById("agent-name").value = "";
  // Clear modal attachments
  modalPendingAttachments.length = 0;
  const chips = document.getElementById("modal-attachment-chips");
  if (chips) chips.innerHTML = "";
}

modalCancel.addEventListener("click", closeNewAgentModal);

modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) closeNewAgentModal();
});

modalOverlay.addEventListener("keydown", (e) => {
  if (!modalOverlay.classList.contains("hidden")) trapFocus(modalOverlay.querySelector(".modal"), e);
});

// --- Modal drag-and-drop for images/videos ---
const modalPendingAttachments = [];
const promptDropZone = document.getElementById("prompt-drop-zone");

if (promptDropZone) {
  promptDropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
    promptDropZone.classList.add("drag-over");
  });
  promptDropZone.addEventListener("dragleave", (e) => {
    e.preventDefault();
    e.stopPropagation();
    promptDropZone.classList.remove("drag-over");
  });
  promptDropZone.addEventListener("drop", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    promptDropZone.classList.remove("drag-over");
    const files = Array.from(e.dataTransfer.files);
    const chipsContainer = document.getElementById("modal-attachment-chips");
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
            modalPendingAttachments.push({ path: result.path, name: file.name });
            renderAttachmentChips({ querySelector: () => chipsContainer }, modalPendingAttachments);
          }
        } catch (err) {
          console.error("Modal upload failed:", err);
        }
      } else if (file.type.startsWith("video/")) {
        const videoId = `video-${Date.now()}`;
        modalPendingAttachments.push({
          name: file.name,
          videoGroup: videoId,
          processing: true,
          paths: [],
          frameCount: 0,
          duration: 0,
        });
        renderAttachmentChips({ querySelector: () => chipsContainer }, modalPendingAttachments);
        try {
          const entry = modalPendingAttachments.find((a) => a.videoGroup === videoId);
          const { frames, duration, frameCount } = await extractVideoFrames(
            file,
            (done, total) => {
              if (entry) {
                entry.frameCount = total;
                entry.duration = duration;
                entry.progressText = `Extracting frames... ${done}/${total}`;
                renderAttachmentChips({ querySelector: () => chipsContainer }, modalPendingAttachments);
              }
            }
          );
          if (entry) {
            entry.processing = false;
            entry.paths = frames.map((f) => f.path);
            entry.frameCount = frameCount;
            entry.duration = Math.round(duration);
            renderAttachmentChips({ querySelector: () => chipsContainer }, modalPendingAttachments);
          }
        } catch (err) {
          console.error("Modal video extraction failed:", err);
          const idx = modalPendingAttachments.findIndex((a) => a.videoGroup === videoId);
          if (idx !== -1) modalPendingAttachments.splice(idx, 1);
          renderAttachmentChips({ querySelector: () => chipsContainer }, modalPendingAttachments);
        }
      }
    }
  });
}

let creatingAgent = false;

newAgentForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (creatingAgent) return; // prevent double submit
  // Don't submit while video frames are still extracting
  if (modalPendingAttachments.some((a) => a.processing)) return;

  // Sanitize name: spaces → dashes, strip invalid chars, lowercase
  let name = document.getElementById("agent-name").value.trim();
  name = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "");
  if (!name) {
    alert("Please enter a name");
    return;
  }
  // Update the input to show the sanitized name
  document.getElementById("agent-name").value = name;

  const workdir = getSelectedWorkdir();
  const prompt = document.getElementById("agent-prompt").value.trim();

  // Collect attachment paths for initial prompt
  const hasAttachments = modalPendingAttachments.length > 0;
  let initialImages = [];
  let imageContextText = "";
  if (hasAttachments) {
    const videoContextParts = [];
    for (const a of modalPendingAttachments) {
      if (a.videoGroup) {
        initialImages.push(...a.paths);
        videoContextParts.push(
          `[Video: ${a.name} — ${a.frameCount} frames extracted from ${a.duration}s video, analyze each frame]`
        );
      } else {
        initialImages.push(a.path);
      }
    }
    imageContextText = videoContextParts.join("\n");
  }

  const body = { name, workdir: workdir || undefined };
  if (selectedSessionId) {
    body.resumeSessionId = selectedSessionId;
  } else if (hasAttachments) {
    // Send prompt text separately via paste-buffer after creation so images are included
    body.initialImages = initialImages;
    body.initialImageText = [imageContextText, prompt].filter(Boolean).join("\n");
  } else if (prompt) {
    body.prompt = prompt;
  }

  // Disable button while creating
  const submitBtn = newAgentForm.querySelector('button[type="submit"]');
  creatingAgent = true;
  submitBtn.disabled = true;
  submitBtn.textContent = "Creating...";

  try {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = await res.json();
      addAgentCard(data.name, data.workdir, data.branch, data.isWorktree, false);
      closeNewAgentModal();
      newAgentForm.reset();
      resetWorkdir();
      // Scroll the new card into view
      const agent = agents.get(data.name);
      if (agent) {
        setTimeout(() => agent.card.scrollIntoView({ behavior: "smooth", block: "center" }), 300);
      }
    } else {
      const err = await res.json();
      alert(err.error || "Failed to create agent");
    }
  } catch {
    alert("Failed to create agent");
  } finally {
    creatingAgent = false;
    submitBtn.disabled = false;
    submitBtn.textContent = "Create";
  }
});

wsCancel.addEventListener("click", () => {
  wsModalOverlay.classList.add("hidden");
});

wsModalOverlay.addEventListener("click", (e) => {
  if (e.target === wsModalOverlay) wsModalOverlay.classList.add("hidden");
});

wsModalOverlay.addEventListener("keydown", (e) => {
  if (!wsModalOverlay.classList.contains("hidden")) trapFocus(wsModalOverlay.querySelector(".modal"), e);
});

wsForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("workspace-agent-name").value;
  const workdir = document.getElementById("workspace-path").value.trim();

  const res = await fetch(`/api/sessions/${name}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workdir }),
  });

  if (res.ok) {
    const agent = agents.get(name);
    if (agent) {
      agent.workdir = workdir;
      agent.card.querySelector(".workdir-link").textContent = shortPath(workdir);
      agent.terminal.innerHTML = "";
    }
    wsModalOverlay.classList.add("hidden");
  } else {
    const err = await res.json();
    alert(err.error || "Failed to update workspace");
  }
});

// --- Todo view: capture-phase shortcut overrides ---
// Cmd+8/B/I must be caught in capture phase to prevent browser tab-switching (Cmd+8)
// and ensure they work even when the editor textarea isn't focused.
document.addEventListener("keydown", (e) => {
  if (typeof currentView === "undefined" || currentView !== "todo") return;
  if (!e.metaKey && !e.ctrlKey) return;

  const key = e.key;
  const rawEditor = document.querySelector(".todo-editor");
  const richEditor = document.getElementById("todo-rich-editor");
  const isRich = !!richEditor;

  if (key === "z" && isRich) {
    e.preventDefault();
    e.stopPropagation();
    if (e.shiftKey) richRedo();
    else richUndo();
    return;
  }

  if (key === "8") {
    e.preventDefault();
    e.stopPropagation();
    if (isRich) {
      toggleCurrentItemCheckbox();
    } else if (rawEditor) {
      rawEditor.focus();
      insertCheckbox(rawEditor);
      scheduleTodoSave();
    }
    return;
  }

  if (key === "b") {
    e.preventDefault();
    e.stopPropagation();
    if (isRich) {
      document.execCommand("bold");
      scheduleRichSave();
    } else if (rawEditor) {
      rawEditor.focus();
      wrapSelection(rawEditor, "**");
      scheduleTodoSave();
    }
    return;
  }

  if (key === "i") {
    e.preventDefault();
    e.stopPropagation();
    if (isRich) {
      document.execCommand("italic");
      scheduleRichSave();
    } else if (rawEditor) {
      rawEditor.focus();
      wrapSelection(rawEditor, "*");
      scheduleTodoSave();
    }
    return;
  }

  if (key === "=" || key === "+") {
    e.preventDefault();
    e.stopPropagation();
    if (isRich) {
      richToggleHeading(true);
      scheduleRichSave();
    } else if (rawEditor) {
      rawEditor.focus();
      toggleHeading(rawEditor);
      scheduleTodoSave();
    }
    return;
  }

  if (key === "-" || key === "_") {
    e.preventDefault();
    e.stopPropagation();
    if (isRich) {
      richToggleHeading(false);
      scheduleRichSave();
    }
    return;
  }

  // Cmd+[ / Cmd+] — switch to prev/next list
  if (key === "[" || key === "]") {
    e.preventDefault();
    e.stopPropagation();
    const sorted = [...todoData.lists].sort((a, b) => a.order - b.order);
    if (sorted.length < 2) return;
    const idx = sorted.findIndex((l) => l.id === activeListId);
    const next = key === "]"
      ? sorted[(idx + 1) % sorted.length]
      : sorted[(idx - 1 + sorted.length) % sorted.length];
    activeListId = next.id;
    saveTodoLastList();
    renderTodoDots();
    renderActiveList();
    return;
  }
}, true); // capture phase — fires before browser default behavior

// --- Keyboard shortcuts ---

document.addEventListener("keydown", (e) => {
  // Suppress all hotkeys while page loader is showing (user may be mid-typing during reload)
  if (!_loaderDismissed) return;

  const inShell = !!e.target.closest("#shell-panel");
  const inFilesPanel = !!e.target.closest("#files-panel");
  const inInput = e.target.matches("input, textarea, [contenteditable]");
  const todoSettingsOverlay = document.getElementById("todo-settings-overlay");
  const modalOpen = !modalOverlay.classList.contains("hidden") || !wsModalOverlay.classList.contains("hidden") || (todoSettingsOverlay && !todoSettingsOverlay.classList.contains("hidden"));

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
  if (key === "f" && (!inInput || inFilesPanel)) {
    e.preventDefault();
    filesBtn.click();
    if (!filesPanel.classList.contains("visible")) filesBtn.focus();
    return;
  }
  const inSettingsPanel = !!e.target.closest("#settings-panel");
  if (key === "s" && (!inInput || inSettingsPanel)) {
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

// --- .claude File Browser ---

const filesBtn = document.getElementById("files-btn");
const filesPanel = document.getElementById("files-panel");
const filesBackdrop = document.getElementById("files-backdrop");
const filesClose = document.getElementById("files-close");
const filesCategories = document.getElementById("files-categories");
const fileEditor = document.getElementById("file-editor");
const fileEditorName = document.getElementById("file-editor-name");
const fileEditorContent = document.getElementById("file-editor-content");
const fileEditorBack = document.getElementById("file-editor-back");
const fileEditorSave = document.getElementById("file-editor-save");
const fileEditorToggle = document.getElementById("file-editor-toggle");
const fileEditorRendered = document.getElementById("file-editor-rendered");
const fileEditorFinder = document.getElementById("file-editor-finder");
const fileEditorHint = document.getElementById("file-editor-hint");
const ceoMdBtn = document.getElementById("ceo-md-btn");

let currentFilePath = null;

function toggleFilesPanel() {
  const isOpen = filesPanel.classList.contains("visible");
  if (isOpen) {
    closeFilesPanel();
  } else {
    // Close settings panel if open
    const sp = document.getElementById("settings-panel");
    if (sp && sp.classList.contains("visible")) closeSettingsPanel();
    filesPanel.classList.add("visible");
    filesBackdrop.classList.add("visible");
    loadClaudeFiles();
    // Focus the close button so Tab navigation starts inside the panel
    setTimeout(() => filesClose.focus(), 100);
  }
}

function closeFilesPanel() {
  filesPanel.classList.remove("visible");
  filesBackdrop.classList.remove("visible");
  closeFileEditor();
}

filesBtn.addEventListener("click", toggleFilesPanel);
filesClose.addEventListener("click", closeFilesPanel);
filesBackdrop.addEventListener("click", closeFilesPanel);
filesPanel.addEventListener("keydown", (e) => {
  if (filesPanel.classList.contains("visible")) trapFocus(filesPanel, e);
});

async function loadClaudeFiles() {
  try {
    const res = await fetch("/api/claude-files");
    const data = await res.json();
    renderFileCategories(data);
  } catch {
    filesCategories.innerHTML = '<div style="padding:20px;color:var(--text-dim)">Failed to load files</div>';
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  return (bytes / 1024).toFixed(1) + " KB";
}

function renderFileCategories(data) {
  filesCategories.innerHTML = "";

  const categories = [
    { key: "ceoDocs", label: "CEO Docs", files: data.ceoDocs || [] },
    { key: "docs", label: "Docs", files: data.docs || [] },
    { key: "commands", label: "Commands", files: data.commands || [] },
    { key: "skills", label: "Skills", files: data.skills || [] },
    { key: "agents", label: "Agents", files: data.agents || [] },
    { key: "memory", label: "Memory", files: data.memory || [] },
  ];

  // Settings as a special single-file category
  if (data.settings) {
    categories.push({
      key: "settings",
      label: "Settings",
      files: [{ name: "settings.json", path: data.settings.path, size: data.settings.size || 0 }],
    });
  }

  for (const cat of categories) {
    // Always show Docs category (even when empty) so users discover it
    if (cat.files.length === 0 && cat.key !== "docs") continue;

    const section = document.createElement("div");
    section.className = "files-category";

    const header = document.createElement("div");
    header.className = "files-category-header";
    header.innerHTML = `${escapeHtml(cat.label)} <span class="files-category-count">${cat.files.length}</span>`;
    header.addEventListener("click", () => section.classList.toggle("open"));
    makeKeyboardActivatable(header);

    const list = document.createElement("div");
    list.className = "files-category-list";

    if (cat.key === "docs" && cat.files.length === 0) {
      const empty = document.createElement("div");
      empty.className = "files-docs-empty";
      empty.innerHTML = `
        <p>Save docs here for all future Claude sessions — coding guidelines, architecture notes, API references.</p>
        <button class="btn-secondary files-create-docs-btn">Create Docs Folder</button>
      `;
      empty.querySelector("button").addEventListener("click", async () => {
        try {
          await fetch("/api/claude-files/ensure-docs", { method: "POST" });
          loadClaudeFiles();
        } catch {}
      });
      list.appendChild(empty);
    }

    for (const file of cat.files) {
      const item = document.createElement("div");
      item.className = "file-item";
      item.innerHTML = `
        <span>${escapeHtml(file.name)}</span>
        <span class="file-item-size">${formatSize(file.size)}</span>
      `;
      item.addEventListener("click", () => openFile(file.path, file.name));
      makeKeyboardActivatable(item);
      list.appendChild(item);
    }

    section.appendChild(header);
    section.appendChild(list);
    filesCategories.appendChild(section);
  }
}

async function openFile(filePath, fileName) {
  try {
    const res = await fetch(`/api/claude-files/read?path=${encodeURIComponent(filePath)}`);
    if (!res.ok) {
      const err = await res.json();
      alert(err.error || "Failed to read file");
      return;
    }
    const data = await res.json();
    currentFilePath = filePath;
    fileEditorHint.style.display = "none";
    fileEditorName.textContent = fileName;
    fileEditorContent.value = data.content;
    filesCategories.style.display = "none";
    fileEditor.classList.remove("hidden");

    // Markdown files: show rendered by default
    const isMd = fileName.endsWith(".md");
    if (isMd) {
      fileEditorRendered.innerHTML = marked.parse(data.content);
      fileEditorRendered.style.display = "";
      fileEditorContent.style.display = "none";
      fileEditorToggle.style.display = "";
      fileEditorToggle.textContent = "Raw";
      fileEditorToggle.classList.remove("active");
    } else {
      fileEditorRendered.style.display = "none";
      fileEditorContent.style.display = "";
      fileEditorToggle.style.display = "none";
    }
  } catch {
    alert("Failed to read file");
  }
}

function closeFileEditor() {
  fileEditor.classList.add("hidden");
  filesCategories.style.display = "";
  currentFilePath = null;
  // Reset toggle state
  fileEditorRendered.style.display = "none";
  fileEditorContent.style.display = "";
  fileEditorToggle.style.display = "none";
  fileEditorToggle.classList.remove("active");
}

async function saveFile() {
  if (!currentFilePath) return;

  // CEO.md uses its own endpoint
  if (currentFilePath === "__ceo_md__") {
    try {
      const res = await fetch("/api/ceo-md", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: fileEditorContent.value }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to save CEO.md");
        return;
      }
      closeFileEditor();
    } catch {
      alert("Failed to save CEO.md");
    }
    return;
  }

  try {
    const res = await fetch("/api/claude-files/write", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: currentFilePath, content: fileEditorContent.value }),
    });
    if (!res.ok) {
      const err = await res.json();
      alert(err.error || "Failed to save file");
      return;
    }
    closeFileEditor();
    loadClaudeFiles(); // refresh list (sizes may have changed)
  } catch {
    alert("Failed to save file");
  }
}

fileEditorBack.addEventListener("click", () => {
  closeFileEditor();
  loadClaudeFiles();
});
fileEditorSave.addEventListener("click", saveFile);

// Open containing folder in Finder
async function openInFinder(filePath) {
  try {
    const res = await fetch("/api/open-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath }),
    });
    if (!res.ok) {
      const err = await res.json();
      alert(err.error || "Failed to open folder");
    }
  } catch { alert("Failed to open folder"); }
}

fileEditorFinder.addEventListener("click", () => {
  if (currentFilePath) openInFinder(currentFilePath);
});

// Toggle between raw and rendered in file editor
fileEditorToggle.addEventListener("click", () => {
  const isRaw = fileEditorToggle.classList.contains("active");
  if (isRaw) {
    // Switch to rendered
    fileEditorRendered.innerHTML = marked.parse(fileEditorContent.value);
    fileEditorRendered.style.display = "";
    fileEditorContent.style.display = "none";
    fileEditorToggle.textContent = "Raw";
    fileEditorToggle.classList.remove("active");
  } else {
    // Switch to raw
    fileEditorRendered.style.display = "none";
    fileEditorContent.style.display = "";
    fileEditorContent.focus();
    fileEditorToggle.textContent = "Rendered";
    fileEditorToggle.classList.add("active");
  }
});

// CEO.md button — open in files panel with its own endpoint
ceoMdBtn.addEventListener("click", async () => {
  // Open files panel if not already open
  if (!filesPanel.classList.contains("visible")) {
    filesPanel.classList.add("visible");
    filesBackdrop.classList.add("visible");
  }
  try {
    const res = await fetch("/api/ceo-md");
    const data = await res.json();
    currentFilePath = "__ceo_md__";
    fileEditorHint.style.display = "";
    fileEditorName.textContent = "claude-ceo.md";
    fileEditorContent.value = data.content || "";
    filesCategories.style.display = "none";
    fileEditor.classList.remove("hidden");

    // Show rendered by default
    const content = data.content || "";
    if (content.trim()) {
      fileEditorRendered.innerHTML = marked.parse(content);
      fileEditorRendered.style.display = "";
      fileEditorContent.style.display = "none";
    } else {
      // Empty — go straight to raw editing
      fileEditorRendered.style.display = "none";
      fileEditorContent.style.display = "";
    }
    fileEditorToggle.style.display = "";
    fileEditorToggle.textContent = content.trim() ? "Raw" : "Rendered";
    fileEditorToggle.classList.toggle("active", !content.trim());
  } catch {
    alert("Failed to load CEO.md");
  }
});

// Files panel Escape is handled by the main keyboard shortcuts handler

// --- Restart Server ---

const restartServerBtn = document.getElementById("restart-server-btn");

async function restartServer() {
  restartServerBtn.disabled = true;
  restartServerBtn.textContent = "Restarting...";
  sessionStorage.setItem("ceo-reload-state", JSON.stringify(buildReloadState()));

  try {
    await fetch("/api/restart-server", { method: "POST" });
  } catch {}

  // Poll until server is back, then reload
  const pollUntilReady = () => {
    fetch("/api/sessions", { signal: AbortSignal.timeout(2000) })
      .then((r) => { if (r.ok) location.reload(); else throw new Error(); })
      .catch(() => setTimeout(pollUntilReady, 500));
  };
  // Wait a beat for the old server to die
  setTimeout(pollUntilReady, 800);
}

restartServerBtn.addEventListener("click", restartServer);

// --- Auto-Update ---

const updateBtn = document.getElementById("update-btn");
const updateWrapper = document.getElementById("update-wrapper");
const updateTooltip = document.getElementById("update-tooltip");

function showUpdateButton(data) {
  if (!updateBtn || !updateWrapper) return;
  updateWrapper.style.display = "";
  const n = data.behind || 0;
  updateBtn.textContent = n > 1 ? `Update (${n} new commits)` : "Update Available";
  // Build tooltip content: release notes + commit summary
  let tooltipHtml = "";
  if (data.releaseNotes && typeof marked !== "undefined") {
    tooltipHtml += marked.parse(data.releaseNotes);
  }
  if (data.summary) {
    const commits = data.summary.split("\n").filter(Boolean);
    if (commits.length) {
      if (tooltipHtml) tooltipHtml += "<hr style='border-color:var(--border);margin:10px 0'>";
      tooltipHtml += "<strong>Recent changes:</strong><ul>" +
        commits.slice(0, 15).map(c => `<li>${c.replace(/</g, "&lt;")}</li>`).join("") +
        "</ul>";
    }
  }
  if (tooltipHtml && updateTooltip) updateTooltip.innerHTML = tooltipHtml;
}

updateBtn.addEventListener("click", async () => {
  updateBtn.disabled = true;
  updateBtn.textContent = "Updating\u2026";
  sessionStorage.setItem("ceo-reload-state", JSON.stringify(buildReloadState()));
  try {
    const res = await fetch("/api/update", { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      showUpdateError(data);
      updateBtn.disabled = false;
      return;
    }
  } catch {
    // Server likely died during restart — that's expected
  }
  const pollUntilReady = () => {
    fetch("/api/sessions", { signal: AbortSignal.timeout(2000) })
      .then((r) => { if (r.ok) location.reload(); else throw new Error(); })
      .catch(() => setTimeout(pollUntilReady, 500));
  };
  setTimeout(pollUntilReady, 800);
});

// Update error modal — handles all error types from /api/update and /api/install-version
const _ueOverlay = document.getElementById("update-error-overlay");
const _ueTitle = document.getElementById("update-error-title");
const _ueDesc = document.getElementById("update-error-desc");
const _ueFiles = document.getElementById("update-error-files");
const _uePromptWrap = document.getElementById("update-error-prompt-wrap");
const _uePrompt = document.getElementById("update-error-prompt");
const _ueCopy = document.getElementById("update-error-copy");
const _ueRetry = document.getElementById("update-error-retry");
const _ueClose = document.getElementById("update-error-close");

function _buildConflictPrompt(files, cwd) {
  const fileList = files.join("\n- ");
  return `The CEO Dashboard at ${cwd} failed to auto-update due to merge conflicts. Fix this completely — run every command yourself.

Conflicting files:
- ${fileList}

Steps — run all of these:
1. cd ${cwd}
2. git fetch origin main
3. git -c merge.ff=false merge origin/main --no-edit
4. Read each conflicting file and resolve every conflict block. Rules:
   - KEEP ALL upstream (origin/main) changes — every single one. These are required version updates.
   - KEEP ALL of my local changes too — merge both together so nothing is lost from either side.
   - If both sides changed the same line and you can combine them (e.g. both added different code), include both.
   - If both sides changed the same line and they truly cannot coexist (one removes something the other modifies), ask me which to keep before continuing. Show me both versions so I can decide.
5. After resolving every file: git add ${files.join(" ")}
6. git commit -m "Merge origin/main — resolve conflicts"

Once done, tell me it's ready and I'll click Update in the dashboard to restart with the new code.`;
}

function _buildDirtyWorkdirPrompt(cwd) {
  return `cd ${cwd} && git stash && git fetch origin main && git -c merge.ff=false merge origin/main --no-edit && git stash pop`;
}

function _buildUnknownPrompt(message, cwd) {
  return `The CEO Dashboard update at ${cwd || "."} failed with this error:\n\n${message}\n\nDiagnose and fix this so the dashboard can update. Check git status, resolve any issues, then run: git fetch origin main && git -c merge.ff=false merge origin/main --no-edit`;
}

function showUpdateError(data) {
  const errorType = data.error || "unknown";
  const cwd = data.cwd || ".";
  const message = data.message || "";
  const files = data.conflicts || [];

  // Reset all sections
  _ueFiles.classList.add("hidden");
  _ueFiles.innerHTML = "";
  _uePromptWrap.classList.add("hidden");
  _uePrompt.textContent = "";
  _ueRetry.classList.add("hidden");
  _ueCopy.textContent = "Copy";

  switch (errorType) {
    case "merge-conflict":
      _ueTitle.textContent = "Merge Conflict";
      _ueTitle.style.color = "var(--red)";
      _ueDesc.innerHTML = "Your local changes conflict with the latest update. The dashboard is still running — nothing broke. Copy this prompt and paste it into a terminal (<code>claude</code>) or one of your agents:";
      _ueFiles.innerHTML = files.map(f => `<li>${escapeHtml(f)}</li>`).join("");
      _ueFiles.classList.remove("hidden");
      _uePrompt.textContent = _buildConflictPrompt(files, cwd);
      _uePromptWrap.classList.remove("hidden");
      break;

    case "dirty-workdir":
      _ueTitle.textContent = "Uncommitted Changes";
      _ueTitle.style.color = "var(--accent)";
      _ueDesc.textContent = "You have local changes that prevent the update. Stash them first, then retry. Copy this command:";
      _uePrompt.textContent = _buildDirtyWorkdirPrompt(cwd);
      _uePromptWrap.classList.remove("hidden");
      break;

    case "network":
      _ueTitle.textContent = "Network Error";
      _ueTitle.style.color = "var(--accent)";
      _ueDesc.textContent = message || "Could not reach the remote repository. Check your internet connection and try again.";
      _ueRetry.classList.remove("hidden");
      break;

    case "timeout":
      _ueTitle.textContent = "Timed Out";
      _ueTitle.style.color = "var(--accent)";
      _ueDesc.textContent = message || "The update timed out. This is usually temporary — try again.";
      _ueRetry.classList.remove("hidden");
      break;

    case "not-on-main":
      _ueTitle.textContent = "Wrong Branch";
      _ueTitle.style.color = "var(--accent)";
      _ueDesc.innerHTML = "You must be on the <code>main</code> branch to update. Run this command first:";
      _uePrompt.textContent = `cd ${cwd} && git checkout main`;
      _uePromptWrap.classList.remove("hidden");
      break;

    case "npm-failed":
      _ueTitle.textContent = "Install Failed";
      _ueTitle.style.color = "var(--red)";
      _ueDesc.textContent = "The code was updated, but npm install failed. Run this manually:";
      _uePrompt.textContent = `cd ${cwd} && npm install`;
      _uePromptWrap.classList.remove("hidden");
      break;

    default: // "unknown" or unrecognized
      _ueTitle.textContent = "Update Failed";
      _ueTitle.style.color = "var(--red)";
      _ueDesc.textContent = message || "An unexpected error occurred during the update.";
      if (cwd) {
        _uePrompt.textContent = _buildUnknownPrompt(message, cwd);
        _uePromptWrap.classList.remove("hidden");
      }
      break;
  }

  updateBtn.textContent = "Update Available";
  _ueOverlay.classList.remove("hidden");
}

_ueCopy.addEventListener("click", () => {
  navigator.clipboard.writeText(_uePrompt.textContent).then(() => {
    _ueCopy.textContent = "Copied!";
    setTimeout(() => { _ueCopy.textContent = "Copy"; }, 2000);
  });
});

_ueRetry.addEventListener("click", () => {
  _ueOverlay.classList.add("hidden");
  updateBtn.click();
});

_ueClose.addEventListener("click", () => {
  _ueOverlay.classList.add("hidden");
});

// --- Settings Panel ---

const settingsBtn = document.getElementById("settings-btn");
const settingsPanel = document.getElementById("settings-panel");
const settingsBackdrop = document.getElementById("settings-backdrop");
const settingsClose = document.getElementById("settings-close");
const settingAutostart = document.getElementById("setting-autostart");
const settingAddToDock = document.getElementById("setting-add-to-dock");
const dockDesc = document.getElementById("dock-desc");
const tailscaleDesc = document.getElementById("tailscale-desc");
const tailscaleBadge = document.getElementById("tailscale-badge");
const tailscaleDetails = document.getElementById("tailscale-details");
const tailscaleIp = document.getElementById("tailscale-ip");
const tailscaleUrl = document.getElementById("tailscale-url");

function toggleSettingsPanel() {
  const isOpen = settingsPanel.classList.contains("visible");
  if (isOpen) {
    closeSettingsPanel();
  } else {
    // Close files panel if open
    if (filesPanel.classList.contains("visible")) closeFilesPanel();
    settingsPanel.classList.add("visible");
    settingsBackdrop.classList.add("visible");
    loadSettings();
    setTimeout(() => settingsClose.focus(), 100);
  }
}

function closeSettingsPanel() {
  settingsPanel.classList.remove("visible");
  settingsBackdrop.classList.remove("visible");
}

settingsBtn.addEventListener("click", toggleSettingsPanel);
settingsClose.addEventListener("click", closeSettingsPanel);
settingsBackdrop.addEventListener("click", closeSettingsPanel);
settingsPanel.addEventListener("keydown", (e) => {
  if (settingsPanel.classList.contains("visible")) trapFocus(settingsPanel, e);
});

async function loadSettings() {
  try {
    const res = await fetch("/api/settings");
    const data = await res.json();

    // Auto-Start
    settingAutostart.checked = data.autoStart;

    // Dock App
    if (data.dockAppInstalled) {
      settingAddToDock.textContent = "Installed";
      settingAddToDock.classList.add("installed");
      settingAddToDock.disabled = true;
      dockDesc.textContent = "CEO Dashboard app is installed in ~/Applications";
    } else {
      settingAddToDock.textContent = "Install";
      settingAddToDock.classList.remove("installed");
      settingAddToDock.disabled = false;
      dockDesc.textContent = "Install as a standalone app in your Dock";
    }

    // Tailscale
    const ts = data.tailscale;
    if (ts.running) {
      tailscaleBadge.textContent = "Connected";
      tailscaleBadge.className = "settings-badge running";
      tailscaleDesc.textContent = "Mesh VPN for secure remote access";
      tailscaleDetails.classList.remove("hidden");
      tailscaleIp.textContent = ts.ip || "—";
      const port = location.port || (location.protocol === "https:" ? "443" : "80");
      const url = `http://${ts.ip}:${port}`;
      tailscaleUrl.textContent = url;
      tailscaleUrl.href = url;
    } else if (ts.installed) {
      tailscaleBadge.textContent = "Installed";
      tailscaleBadge.className = "settings-badge installed";
      tailscaleDesc.textContent = "Tailscale installed but not running. Open Tailscale.app to connect.";
      tailscaleDetails.classList.add("hidden");
    } else {
      tailscaleBadge.textContent = "Not Installed";
      tailscaleBadge.className = "settings-badge offline";
      tailscaleDesc.innerHTML = 'Access your dashboard from your phone or any device on your network.';
      tailscaleDetails.classList.remove("hidden");
      tailscaleIp.textContent = "—";
      tailscaleUrl.textContent = "";
      tailscaleUrl.href = "#";
      tailscaleDetails.innerHTML = `<div class="tailscale-setup-guide">
        <p><strong>Setup:</strong></p>
        <ol>
          <li>Install from <a href="https://tailscale.com/download/mac" target="_blank">tailscale.com/download/mac</a></li>
          <li>Open Tailscale.app and sign in (Google, Microsoft, or GitHub)</li>
          <li>Install Tailscale on your phone too — same account</li>
          <li>Both devices join the same private network automatically</li>
          <li>Reopen Settings here — your dashboard URL will appear</li>
        </ol>
        <p style="margin-top:8px;color:var(--text-dim);font-size:11px;">Free for personal use. No port forwarding, no firewall changes needed.</p>
      </div>`;
    }
  } catch {
    tailscaleDesc.textContent = "Failed to load settings";
  }
}

settingAutostart.addEventListener("change", async () => {
  const enabled = settingAutostart.checked;
  try {
    const res = await fetch("/api/settings/auto-start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) {
      const err = await res.json();
      settingAutostart.checked = !enabled;
      alert(err.error || "Failed to toggle auto-start");
    }
  } catch {
    settingAutostart.checked = !enabled;
  }
});

settingAddToDock.addEventListener("click", async () => {
  if (settingAddToDock.disabled) return;
  settingAddToDock.textContent = "Installing...";
  settingAddToDock.disabled = true;
  try {
    const res = await fetch("/api/settings/add-to-dock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (res.ok) {
      settingAddToDock.textContent = "Installed";
      settingAddToDock.classList.add("installed");
      dockDesc.textContent = "CEO Dashboard app is installed in ~/Applications";
    } else {
      const err = await res.json();
      settingAddToDock.textContent = "Install";
      settingAddToDock.disabled = false;
      alert(err.error || "Failed to install");
    }
  } catch {
    settingAddToDock.textContent = "Install";
    settingAddToDock.disabled = false;
  }
});

// --- In-App Browser settings ---

document.getElementById("setting-clear-browser").addEventListener("click", () => {
  if (!confirm("Clear all in-app browser cookies, cache, and logins?")) return;
  // Post to native bridge to clear WKWebsiteDataStore
  if (window.webkit?.messageHandlers?.ceoBridge) {
    window.webkit.messageHandlers.ceoBridge.postMessage({ action: "clearBrowserData" });
  }
  const btn = document.getElementById("setting-clear-browser");
  btn.textContent = "Cleared";
  btn.disabled = true;
  setTimeout(() => { btn.textContent = "Clear"; btn.disabled = false; }, 2000);
});

// --- Agent Defaults config ---

// Collapsible toggle
document.getElementById("agent-defaults-toggle").addEventListener("click", () => {
  const section = document.getElementById("agent-defaults-toggle").closest(".settings-collapse");
  const body = document.getElementById("agent-defaults-body");
  section.classList.toggle("open");
  body.classList.toggle("hidden");
});

const _settingDefaultName = document.getElementById("setting-default-agent-name");
const _settingPrefix = document.getElementById("setting-agent-prefix");
const _settingPort = document.getElementById("setting-port");
const _settingShellCmd = document.getElementById("setting-shell-command");
const _settingInstallAlias = document.getElementById("setting-install-alias");

function _loadAgentDefaults() {
  fetch("/api/config").then(r => r.json()).then(cfg => {
    _defaultAgentName = cfg.defaultAgentName || "agent";
    _settingDefaultName.value = cfg.defaultAgentName || "agent";
    _settingPrefix.value = cfg.agentPrefix || "ceo-";
    _settingPort.value = cfg.port || 9145;
    _settingShellCmd.value = cfg.shellCommand || "ceo";
  }).catch(() => {});
}

let _agentDefaultsSaveTimer = null;
function _saveAgentDefault(key, value) {
  clearTimeout(_agentDefaultsSaveTimer);
  _agentDefaultsSaveTimer = setTimeout(async () => {
    try {
      await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
    } catch {}
  }, 400);
}

_settingDefaultName.addEventListener("input", () => {
  const v = _settingDefaultName.value.trim();
  _defaultAgentName = v || "agent";
  _saveAgentDefault("defaultAgentName", v || "agent");
});
_settingPrefix.addEventListener("input", () => {
  _saveAgentDefault("agentPrefix", _settingPrefix.value.trim() || "ceo-");
});
_settingPort.addEventListener("input", () => {
  const v = parseInt(_settingPort.value);
  if (v > 0) _saveAgentDefault("port", v);
});
_settingShellCmd.addEventListener("input", () => {
  const v = _settingShellCmd.value.trim().replace(/[^a-zA-Z0-9_-]/g, "");
  if (v) _saveAgentDefault("shellCommand", v);
});
_settingInstallAlias.addEventListener("click", async () => {
  _settingInstallAlias.disabled = true;
  _settingInstallAlias.textContent = "Installing...";
  try {
    const res = await fetch("/api/settings/install-alias", { method: "POST" });
    const data = await res.json();
    if (data.ok) {
      _settingInstallAlias.textContent = "Installed";
      setTimeout(() => { _settingInstallAlias.textContent = "Install"; _settingInstallAlias.disabled = false; }, 2000);
    } else {
      _settingInstallAlias.textContent = "Error";
      setTimeout(() => { _settingInstallAlias.textContent = "Install"; _settingInstallAlias.disabled = false; }, 2000);
    }
  } catch {
    _settingInstallAlias.textContent = "Error";
    setTimeout(() => { _settingInstallAlias.textContent = "Install"; _settingInstallAlias.disabled = false; }, 2000);
  }
});

// --- Workspace config editor ---

// Collapsible toggle
document.getElementById("workspace-toggle").addEventListener("click", () => {
  const section = document.getElementById("workspace-toggle").closest(".settings-collapse");
  const body = document.getElementById("workspace-collapse-body");
  section.classList.toggle("open");
  body.classList.toggle("hidden");
});

const _wsListEl = document.getElementById("workspace-list");
const _wsAddPath = document.getElementById("workspace-add-path");
const _wsAddLabel = document.getElementById("workspace-add-label");
const _wsAddBtn = document.getElementById("workspace-add-btn");
const _wsDefaultSelectEl = document.getElementById("workspace-default-select");
let _wsConfig = { workspaces: [], defaultWorkspace: "" };

let _wsDragIdx = -1;
let _wsDragOverIdx = -1;

function _renderWorkspaceEditor() {
  // Render workspace rows
  _wsListEl.innerHTML = "";
  for (let i = 0; i < _wsConfig.workspaces.length; i++) {
    const ws = _wsConfig.workspaces[i];
    const row = document.createElement("div");
    row.className = "workspace-row" + (ws.builtIn ? " workspace-row-builtin" : "");
    row.draggable = true;
    row.dataset.idx = i;
    row.innerHTML = `
      <span class="workspace-drag-handle" title="Drag to reorder">&#x2630;</span>
      <span class="workspace-row-path" title="${escapeAttr(ws.path)}">${escapeHtml(shortPath(ws.path))}</span>
      <span class="workspace-row-label">${escapeHtml(ws.label || "")}${ws.builtIn ? ' <span class="workspace-builtin-badge">built-in</span>' : ""}</span>
      ${ws.builtIn ? "" : '<button class="workspace-row-remove" title="Remove">&times;</button>'}
    `;
    if (!ws.builtIn) {
      row.querySelector(".workspace-row-remove").addEventListener("click", () => {
        _wsConfig.workspaces.splice(i, 1);
        if (_wsConfig.defaultWorkspace === ws.path && _wsConfig.workspaces.length > 0) {
          _wsConfig.defaultWorkspace = _wsConfig.workspaces[0].path;
        }
        _saveWorkspaceConfig();
      });
    }
    // Drag events
    row.addEventListener("dragstart", (e) => {
      _wsDragIdx = i;
      row.classList.add("workspace-row-dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragend", () => {
      row.classList.remove("workspace-row-dragging");
      _wsListEl.querySelectorAll(".workspace-row").forEach(r => r.classList.remove("workspace-row-dragover-above", "workspace-row-dragover-below"));
      if (_wsDragIdx !== -1 && _wsDragOverIdx !== -1 && _wsDragIdx !== _wsDragOverIdx) {
        const [moved] = _wsConfig.workspaces.splice(_wsDragIdx, 1);
        _wsConfig.workspaces.splice(_wsDragOverIdx, 0, moved);
        _saveWorkspaceConfig();
      }
      _wsDragIdx = -1;
      _wsDragOverIdx = -1;
    });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const rect = row.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      const targetIdx = parseInt(row.dataset.idx);
      row.classList.remove("workspace-row-dragover-above", "workspace-row-dragover-below");
      if (e.clientY < mid) {
        row.classList.add("workspace-row-dragover-above");
        _wsDragOverIdx = targetIdx > _wsDragIdx ? targetIdx - 1 : targetIdx;
      } else {
        row.classList.add("workspace-row-dragover-below");
        _wsDragOverIdx = targetIdx < _wsDragIdx ? targetIdx + 1 : targetIdx;
      }
    });
    row.addEventListener("dragleave", () => {
      row.classList.remove("workspace-row-dragover-above", "workspace-row-dragover-below");
    });
    _wsListEl.appendChild(row);
  }
  // Render default custom select
  const trigger = _wsDefaultSelectEl.querySelector(".custom-select-label");
  const optionsContainer = _wsDefaultSelectEl.querySelector(".custom-select-options");
  optionsContainer.innerHTML = "";
  const current = _wsConfig.workspaces.find(w => w.path === _wsConfig.defaultWorkspace);
  trigger.textContent = current ? current.label : "—";
  for (const ws of _wsConfig.workspaces) {
    const opt = document.createElement("div");
    opt.className = "custom-select-option" + (ws.path === _wsConfig.defaultWorkspace ? " selected" : "");
    opt.textContent = ws.label;
    opt.addEventListener("click", () => {
      _wsConfig.defaultWorkspace = ws.path;
      _wsDefaultSelectEl.classList.remove("open");
      _saveWorkspaceConfig();
    });
    optionsContainer.appendChild(opt);
  }
}

function _loadWorkspaceConfig() {
  fetch("/api/config").then(r => r.json()).then(cfg => {
    _wsConfig.workspaces = cfg.workspaces || [];
    _wsConfig.defaultWorkspace = cfg.defaultWorkspace || "";
    _renderWorkspaceEditor();
  }).catch(() => {});
}

async function _saveWorkspaceConfig() {
  _renderWorkspaceEditor();
  _renderWorkdirPills(_wsConfig.workspaces);
  DEFAULT_WORKDIR = _wsConfig.defaultWorkspace;
  selectedWorkdirPath = DEFAULT_WORKDIR;
  // Find built-in position, filter it out before saving
  const builtInIdx = _wsConfig.workspaces.findIndex(w => w.builtIn);
  const userWorkspaces = _wsConfig.workspaces.filter(w => !w.builtIn);
  const payload = { workspaces: userWorkspaces, defaultWorkspace: _wsConfig.defaultWorkspace };
  if (builtInIdx !== -1) payload.builtInPosition = builtInIdx;
  try {
    await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {}
}

_wsAddBtn.addEventListener("click", () => {
  const pathVal = _wsAddPath.value.trim();
  if (!pathVal) return;
  const label = _wsAddLabel.value.trim() || pathVal.split("/").filter(Boolean).pop() || pathVal;
  if (_wsConfig.workspaces.some(w => w.path === pathVal)) return; // no dupes
  _wsConfig.workspaces.push({ path: pathVal, label });
  if (!_wsConfig.defaultWorkspace) _wsConfig.defaultWorkspace = pathVal;
  _wsAddPath.value = "";
  _wsAddLabel.value = "";
  _saveWorkspaceConfig();
  // Auto-select the newly added workspace in the new agent modal
  setWorkdir(pathVal);
});

_wsAddPath.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); _wsAddBtn.click(); }
});
_wsAddLabel.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); _wsAddBtn.click(); }
});

// Custom select toggle
_wsDefaultSelectEl.querySelector(".custom-select-trigger").addEventListener("click", () => {
  _wsDefaultSelectEl.classList.toggle("open");
});
// Close custom select when clicking outside
document.addEventListener("click", (e) => {
  if (!_wsDefaultSelectEl.contains(e.target)) {
    _wsDefaultSelectEl.classList.remove("open");
  }
});

// --- Version Manager ---

const _versionSection = document.getElementById("version-toggle").closest(".settings-collapse");

document.getElementById("version-toggle").addEventListener("click", () => {
  const body = document.getElementById("version-collapse-body");
  _versionSection.classList.toggle("open");
  body.classList.toggle("hidden");
});

let _versionsLoaded = false;

async function _loadVersions() {
  const listEl = document.getElementById("version-list");
  // Hide section until we know there's something to show
  _versionSection.style.display = "none";
  listEl.innerHTML = '<span class="settings-hint">Loading versions...</span>';
  try {
    const res = await fetch("/api/versions");
    const data = await res.json();
    _versionsLoaded = true;
    const versions = data.versions || [];
    const hasInstallable = versions.some(v => !v.isCurrent);
    if (!hasInstallable) return; // nothing to downgrade to — keep hidden
    _versionSection.style.display = "";
    _renderVersionList(versions, listEl);
  } catch {
    // On error, keep hidden
  }
}

function _renderVersionList(versions, listEl) {
  listEl.innerHTML = "";
  if (!versions.length) {
    listEl.innerHTML = '<span class="settings-hint">No tagged versions found.</span>';
    return;
  }
  for (const v of versions) {
    const row = document.createElement("div");
    row.className = "version-row" + (v.isCurrent ? " version-row-current" : "");
    const tag = document.createElement("span");
    tag.className = "version-tag";
    tag.textContent = v.tag;
    const date = document.createElement("span");
    date.className = "version-date";
    date.textContent = v.date ? new Date(v.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
    row.appendChild(tag);
    row.appendChild(date);
    if (v.isCurrent) {
      const badge = document.createElement("span");
      badge.className = "version-current-badge";
      badge.textContent = "Current";
      row.appendChild(badge);
    } else {
      const btn = document.createElement("button");
      btn.className = "version-install-btn";
      btn.textContent = "Install";
      btn.addEventListener("click", () => _installVersion(v.tag, btn));
      row.appendChild(btn);
    }
    listEl.appendChild(row);
  }
}

async function _installVersion(tag, btn) {
  if (!confirm(`Switch to ${tag}? The server will restart.`)) return;
  btn.disabled = true;
  btn.textContent = "Installing...";
  try {
    const res = await fetch("/api/install-version", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag }),
    });
    const data = await res.json();
    if (!res.ok) {
      showUpdateError(data);
      btn.textContent = "Install";
      btn.disabled = false;
      return;
    }
    // Server is restarting — poll until it's back
    btn.textContent = "Restarting...";
    const start = Date.now();
    const poll = setInterval(async () => {
      if (Date.now() - start > 30000) { clearInterval(poll); btn.textContent = "Timeout"; return; }
      try {
        const r = await fetch("/api/sessions", { signal: AbortSignal.timeout(2000) });
        if (r.ok) { clearInterval(poll); location.reload(); }
      } catch {}
    }, 1500);
  } catch {
    btn.textContent = "Error";
    setTimeout(() => { btn.textContent = "Install"; btn.disabled = false; }, 2000);
  }
}

// Load config sections when settings panel opens
const _origLoadSettings = loadSettings;
loadSettings = async function() {
  _versionsLoaded = false;
  _versionSection.style.display = "none";
  _versionSection.classList.remove("open");
  document.getElementById("version-collapse-body").classList.add("hidden");
  _loadVersions();
  _loadAgentDefaults();
  _loadWorkspaceConfig();
  return _origLoadSettings();
};

// --- Init ---

loadSlashCommands();
startDocPolling();
startTodoRefsPolling();

// --- Page loader: wait for ALL agents to have terminal content before revealing ---
let _expectedAgentCount = 0;
let _agentsWithContent = new Set();
let _loaderDismissed = false;
let _savedReloadState = null; // set during restore to apply after loader

function dismissPageLoader() {
  if (_loaderDismissed) return;
  _loaderDismissed = true;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const loader = document.getElementById("page-loader");
      if (loader) {
        loader.classList.add("fade-out");
        loader.addEventListener("transitionend", () => loader.remove(), { once: true });
      }
      // Restore full state AFTER layout is settled and loader is fading
      if (_savedReloadState) {
        _applyRestoredState(_savedReloadState);
        _savedReloadState = null;
      } else {
        // First load (no reload state) — auto-open shell if not explicitly closed before
        // Default is open ("1") so new users see the terminal immediately
        const shellPref = localStorage.getItem("ceo-shell-open");
        if (shellPref !== "0") {
          const header = document.getElementById("shell-header");
          const panel = document.getElementById("shell-panel");
          if (header && panel && !panel.classList.contains("open")) {
            header.click();
          }
        }
      }
    });
  });
}

function checkAllAgentsLoaded() {
  if (_loaderDismissed) return;
  if (_expectedAgentCount === 0) { dismissPageLoader(); return; }
  if (_agentsWithContent.size >= _expectedAgentCount) {
    // All agents have content — run masonry then dismiss.
    // Cards still show per-card loading spinners; the page loader just prevents layout snapping.
    scheduleMasonry();
    setTimeout(() => dismissPageLoader(), 100);
  }
}

// Safety: dismiss loader after 3s no matter what (server lag, dead agents, etc.)
setTimeout(() => { if (!_loaderDismissed) dismissPageLoader(); }, 3000);

// Load existing sessions first, then connect WebSocket
fetch("/api/sessions")
  .then((r) => r.json())
  .then((sessions) => {
    _expectedAgentCount = sessions.length;
    for (const s of sessions) {
      addAgentCard(s.name, s.workdir, s.branch, s.isWorktree, s.favorite);
    }
    reorderCards();
    updateEmptyState();
    // If no agents, dismiss immediately
    checkAllAgentsLoaded();
  })
  .catch(() => {
    dismissPageLoader();
  });

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

// Apply all saved state in one coordinated pass (called by dismissPageLoader)
function _applyRestoredState(state) {
  // 1. Restore input drafts
  if (state.drafts) {
    for (const [name, text] of Object.entries(state.drafts)) {
      const agent = agents.get(name);
      if (agent) {
        const textarea = agent.card.querySelector(".card-input textarea");
        if (textarea) {
          textarea.value = text;
          textarea.style.height = "auto";
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
  // 3. Restore terminal scroll positions (override the default force-scroll-to-bottom)
  if (state.terminalScrolls) {
    for (const [name, scrollTop] of Object.entries(state.terminalScrolls)) {
      const agent = agents.get(name);
      if (agent && agent.terminal) {
        agent.terminal._forceScrollUntil = 0; // cancel force scroll
        agent.terminal._userScrolledUp = false;
        agent.terminal.scrollTop = scrollTop;
        // Check if they were scrolled up
        const atBottom = agent.terminal.scrollHeight - scrollTop - agent.terminal.clientHeight < 30;
        if (!atBottom) agent.terminal._userScrolledUp = true;
      }
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
  // 8. Restore focus + cursor position (do this last so layout is settled)
  requestAnimationFrame(() => {
    // Re-apply page scroll (layout changes from modal/shell/todo may have shifted it)
    window.scrollTo(0, state.scrollY || 0);
    if (state.focusedModal) {
      const el = document.getElementById(state.focusedModal);
      if (el) {
        el.focus();
        if (state.focusCursorStart != null) {
          el.setSelectionRange(state.focusCursorStart, state.focusCursorEnd ?? state.focusCursorStart);
        }
      }
    } else if (state.focusedTodo) {
      // Restore todo focus
      let el = null;
      if (state.focusedTodo === "title") el = document.querySelector(".todo-title-input");
      else if (state.focusedTodo === "editor") el = document.querySelector(".todo-editor");
      else if (state.focusedTodo === "rich-editor") el = document.getElementById("todo-rich-editor");
      if (el) {
        el.focus();
        if (state.focusCursorStart != null && el.setSelectionRange) {
          el.setSelectionRange(state.focusCursorStart, state.focusCursorEnd ?? state.focusCursorStart);
        }
      }
    } else if (state.focusedAgent) {
      const agent = agents.get(state.focusedAgent);
      if (agent) {
        const textarea = agent.card.querySelector(".card-input textarea");
        if (textarea) {
          textarea.focus();
          if (state.focusCursorStart != null) {
            textarea.setSelectionRange(state.focusCursorStart, state.focusCursorEnd ?? state.focusCursorStart);
          }
        }
      }
    }
  });
}

// --- Embedded Shell Terminal (xterm.js) ---
{
  const shellPanel = document.getElementById("shell-panel");
  const shellHeader = document.getElementById("shell-header");
  const shellContainer = document.getElementById("shell-terminal");
  const shellResize = shellPanel.querySelector(".shell-panel-resize");
  // Set initial shell height CSS var for todo view sizing
  document.documentElement.style.setProperty("--shell-panel-h", (shellPanel.offsetHeight || 42) + 8 + "px");

  // Create xterm.js terminal
  const term = new Terminal({
    cursorBlink: true,
    cursorStyle: "bar",
    fontSize: 13,
    fontFamily: "'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace",
    scrollback: 2000,
    fastScrollModifier: "alt",
    fastScrollSensitivity: 10,
    smoothScrollDuration: 0, // disable smooth scroll animation for responsiveness
    theme: {
      background: "#0d1117",
      foreground: "#e6edf3",
      cursor: "#e6edf3",
      selectionBackground: "rgba(56, 139, 253, 0.4)",
      black: "#484f58",
      red: "#ff7b72",
      green: "#3fb950",
      yellow: "#d29922",
      blue: "#58a6ff",
      magenta: "#bc8cff",
      cyan: "#39d353",
      white: "#b1bac4",
      brightBlack: "#6e7681",
      brightRed: "#ffa198",
      brightGreen: "#56d364",
      brightYellow: "#e3b341",
      brightBlue: "#79c0ff",
      brightMagenta: "#d2a8ff",
      brightCyan: "#56d364",
      brightWhite: "#f0f6fc",
    },
    allowProposedApi: true,
  });

  const fitAddon = new FitAddon.FitAddon();
  const webLinksAddon = new WebLinksAddon.WebLinksAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(webLinksAddon);

  let shellInitialized = false;

  function initShellTerminal() {
    if (shellInitialized) return;
    shellInitialized = true;
    term.open(shellContainer);

    // WebGL renderer — dramatically faster than default canvas
    try {
      if (typeof WebglAddon !== "undefined") {
        const webglAddon = new WebglAddon.WebglAddon();
        webglAddon.onContextLoss(() => { webglAddon.dispose(); });
        term.loadAddon(webglAddon);
      }
    } catch (e) {
      console.warn("[shell] WebGL addon failed, using canvas renderer:", e);
    }

    // Send input from xterm to server PTY
    // Handles selection-based editing for paste (keyboard is handled by attachCustomKeyEventHandler)
    term.onData((data) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        // Intercept Enter: if the current line is a `claude` command, open new agent modal instead
        if (data === "\r" || data === "\n") {
          const buf = term.buffer.active;
          const line = buf.getLine(buf.baseY + buf.cursorY);
          if (line) {
            const lineText = line.translateToString(true);
            // Match "claude" or "claude <prompt>" (strip shell prompt prefix)
            const cmd = lineText.replace(/^.*?[%$#>]\s*/, "").trim();
            if (cmd === "claude" || cmd.startsWith("claude ")) {
              // Clear the typed command from the terminal (Ctrl+U clears line, then Enter to get fresh prompt)
              _sendShellStdin("\x15\r");
              // Extract prompt if any (e.g., "claude fix the bug" → "fix the bug")
              const prompt = cmd.startsWith("claude ") ? cmd.slice(7).trim() : "";
              // Open the new agent modal with the prompt pre-filled
              modalOverlay.classList.remove("hidden");
              fetchClaudeSessions();
              if (prompt) {
                setTimeout(() => {
                  const promptEl = document.getElementById("agent-prompt");
                  if (promptEl) { promptEl.value = prompt; promptEl.focus(); }
                }, 50);
              } else {
                document.getElementById("agent-name").focus();
              }
              return;
            }
          }
        }

        let sendData = data;
        // If pasting while text is selected, replace the selection with pasted content
        if (term.hasSelection() && data.length > 0 && data.charCodeAt(0) >= 32) {
          const prefix = _shellSelectionEditPrefix();
          if (prefix !== null) {
            sendData = prefix + data;
          }
          term.clearSelection();
        }
        _sendShellStdin(sendData);
      }
    });

    // Don't fit here — the caller does it after DOM layout
  }

  // Helper: generate move-to-selection-start + delete sequence for selection editing
  function _shellSelectionEditPrefix() {
    const sel = typeof term.getSelectionPosition === "function" ? term.getSelectionPosition() : null;
    const selectedText = term.getSelection();
    if (!sel || !selectedText) return null;
    if (sel.start.y !== sel.end.y) return null;
    const buf = term.buffer.active;
    const cursorAbsRow = buf.baseY + buf.cursorY;
    if (sel.start.y !== cursorAbsRow) return null;
    const delta = sel.start.x - buf.cursorX;
    let prefix = "";
    if (delta > 0) prefix += "\x1b[C".repeat(delta);
    else if (delta < 0) prefix += "\x1b[D".repeat(-delta);
    prefix += "\x1b[3~".repeat(selectedText.length);
    return prefix;
  }

  // --- Autocomplete Dropdown ---
  let _acDropdown = null;   // DOM element
  let _acDomItems = [];     // cached DOM item elements
  let _acItems = [];        // completion objects
  let _acIndex = 0;         // selected index
  let _acWord = "";         // original word being completed
  let _acFetching = false;  // prevent double-fetch

  const _shellEncoder = new TextEncoder();
  function _sendShellStdin(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      // Binary protocol: 0x01 prefix + UTF-8 payload (skips JSON.parse on server)
      const payload = _shellEncoder.encode(data);
      const frame = new Uint8Array(1 + payload.length);
      frame[0] = 0x01;
      frame.set(payload, 1);
      ws.send(frame);
    }
  }

  function _getCursorScreenPos() {
    const screen = shellContainer.querySelector(".xterm-screen");
    if (!screen) return null;
    const rect = screen.getBoundingClientRect();
    const cellW = rect.width / term.cols;
    const cellH = rect.height / term.rows;
    const buf = term.buffer.active;
    return {
      x: rect.left + buf.cursorX * cellW,
      y: rect.top + (buf.cursorY + 1) * cellH,
      cellH,
    };
  }

  function _acRender() {
    if (!_acDomItems.length) return;
    for (let i = 0; i < _acDomItems.length; i++) {
      _acDomItems[i].classList.toggle("selected", i === _acIndex);
    }
    _acDomItems[_acIndex]?.scrollIntoView({ block: "nearest" });
  }

  function _acShow(completions, currentWord) {
    _acDismiss();
    _acItems = completions;
    _acWord = currentWord;
    _acIndex = 0;

    const dropdown = document.createElement("div");
    dropdown.className = "shell-autocomplete";

    completions.forEach((item, i) => {
      const row = document.createElement("div");
      const typeClass = item.type === "dir" ? "dir-item" : item.type === "link" ? "link-item" : "";
      row.className = "shell-autocomplete-item" + (typeClass ? " " + typeClass : "") + (i === 0 ? " selected" : "");
      row.dataset.index = i;

      const icon = document.createElement("span");
      icon.className = "shell-autocomplete-icon";
      icon.textContent = item.type === "dir" ? "\uD83D\uDCC1" : item.type === "link" ? "\uD83D\uDD17" : "\uD83D\uDCC4";

      const name = document.createElement("span");
      name.className = "shell-autocomplete-name";
      name.textContent = item.name + (item.type === "dir" ? "/" : "");

      row.appendChild(icon);
      row.appendChild(name);

      if (item.type === "dir") {
        const hint = document.createElement("span");
        hint.className = "shell-autocomplete-hint";
        hint.textContent = "dir";
        row.appendChild(hint);
      }

      row.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        _acIndex = i;
        _acAccept();
      });

      dropdown.appendChild(row);
    });

    // Position at cursor
    const pos = _getCursorScreenPos();
    if (pos) {
      dropdown.style.left = Math.min(pos.x, window.innerWidth - 440) + "px";
      const estH = Math.min(completions.length * 28 + 8, 268);
      if (pos.y + estH > window.innerHeight - 10) {
        dropdown.style.bottom = (window.innerHeight - pos.y + pos.cellH + 2) + "px";
      } else {
        dropdown.style.top = pos.y + "px";
      }
    }

    document.body.appendChild(dropdown);
    _acDropdown = dropdown;
    _acDomItems = Array.from(dropdown.querySelectorAll(".shell-autocomplete-item"));
    setTimeout(() => document.addEventListener("mousedown", _acClickOutside), 0);
  }

  function _acClickOutside(e) {
    if (_acDropdown && !_acDropdown.contains(e.target)) _acDismiss();
  }

  function _acDismiss() {
    if (_acDropdown) {
      _acDropdown.remove();
      _acDropdown = null;
      _acDomItems = [];
      _acItems = [];
      _acIndex = 0;
      document.removeEventListener("mousedown", _acClickOutside);
    }
  }

  function _acMove(delta) {
    if (!_acDropdown || _acItems.length === 0) return;
    _acIndex = (_acIndex + delta + _acItems.length) % _acItems.length;
    _acRender();
  }

  function _acAccept() {
    const item = _acItems[_acIndex];
    if (!item) return;
    // Figure out what prefix is already typed for this filename
    const wordBase = _acWord.includes("/") ? _acWord.split("/").pop() : _acWord;
    let remaining = item.name.slice(wordBase.length);
    if (item.type === "dir") remaining += "/";
    // Escape spaces and special chars for shell
    remaining = remaining.replace(/([ '\\()\[\]{}$#&!;|<>*?`])/g, "\\$1");
    _sendShellStdin(remaining);
    _acDismiss();
  }

  function _acTrigger() {
    if (_acFetching) return;
    const buf = term.buffer.active;
    const line = buf.getLine(buf.baseY + buf.cursorY);
    if (!line) return;
    const lineText = line.translateToString(false, 0, buf.cursorX);
    // Extract current word (everything after last unescaped space)
    const match = lineText.match(/(\S+)$/);
    const currentWord = match ? match[1] : "";
    // Get shell cwd
    const cwdEl = document.getElementById("shell-cwd");
    const cwd = cwdEl?.dataset.fullPath;
    if (!cwd) { _sendShellStdin("\t"); return; }
    // Detect directory-only commands
    const firstWord = lineText.replace(/^.*?%\s*/, "").trim().split(/\s+/)[0] || "";
    const dirsOnly = ["cd", "pushd"].includes(firstWord) && currentWord !== firstWord;
    _acFetching = true;
    fetch("/api/shell/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word: currentWord, cwd, dirsOnly }),
    })
    .then(r => r.json())
    .then(({ completions }) => {
      _acFetching = false;
      if (!completions || completions.length === 0) {
        // No matches — fall back to shell native Tab
        _sendShellStdin("\t");
      } else if (completions.length === 1) {
        // Single match — auto-insert
        _acWord = currentWord;
        _acItems = completions;
        _acIndex = 0;
        _acAccept();
      } else {
        // Insert common prefix if any, then show dropdown
        const wordBase = currentWord.includes("/") ? currentWord.split("/").pop() : currentWord;
        const common = _commonPrefix(completions);
        if (common.length > wordBase.length) {
          const insert = common.slice(wordBase.length).replace(/([ '\\()\[\]{}$#&!;|<>*?`])/g, "\\$1");
          _sendShellStdin(insert);
          const newWord = currentWord.slice(0, currentWord.length - wordBase.length) + common;
          _acShow(completions, newWord);
        } else {
          _acShow(completions, currentWord);
        }
      }
    })
    .catch(() => { _acFetching = false; _sendShellStdin("\t"); });
  }

  function _commonPrefix(items) {
    if (items.length === 0) return "";
    let pfx = items[0].name;
    for (let i = 1; i < items.length; i++) {
      const n = items[i].name;
      let j = 0;
      while (j < pfx.length && j < n.length && pfx[j] === n[j]) j++;
      pfx = pfx.slice(0, j);
      if (!pfx) return "";
    }
    return pfx;
  }

  // Custom key handler: autocomplete, Tab, selection editing, Escape
  // Cached selection state to avoid calling term.hasSelection() on every keypress
  let _shellHasSelection = false;
  term.onSelectionChange(() => { _shellHasSelection = term.hasSelection(); });

  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== "keydown") return true;

    // Fast path: no dropdown, no selection — only check Tab and Escape
    if (!_acDropdown && !_shellHasSelection) {
      if (e.key === "Tab" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        _acTrigger();
        return false;
      }
      if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey) return false;
      return true;
    }

    // --- Autocomplete dropdown is open: handle navigation ---
    if (_acDropdown) {
      if (e.key === "ArrowDown") { e.preventDefault(); _acMove(1); return false; }
      if (e.key === "ArrowUp") { e.preventDefault(); _acMove(-1); return false; }
      if (e.key === "Tab") { e.preventDefault(); _acAccept(); return false; }
      if (e.key === "Enter") { e.preventDefault(); _acAccept(); return false; }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); _acDismiss(); return false; }
      // Any other key: dismiss dropdown and let the key pass through
      _acDismiss();
      // Fall through to normal handling below
    }

    // Escape: bubble out to close the panel
    if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey) return false;

    // Tab: trigger autocomplete dropdown
    if (e.key === "Tab" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      _acTrigger();
      return false;
    }

    // Selection-based editing
    if (_shellHasSelection) {
      if (e.key === "Backspace" || e.key === "Delete") {
        const prefix = _shellSelectionEditPrefix();
        if (prefix !== null) {
          _sendShellStdin(prefix);
          term.clearSelection();
          return false;
        }
      }
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const prefix = _shellSelectionEditPrefix();
        if (prefix !== null) {
          _sendShellStdin(prefix + e.key);
          term.clearSelection();
          return false;
        }
      }
    }

    return true;
  });

  // Expose globally for WS handler
  window._shellXterm = term;

  // --- Click-to-position: move cursor to clicked cell on the active input line ---
  // Translates mouse clicks into arrow key sequences (like iTerm2 / Warp).
  // Handles wrapped commands spanning multiple terminal rows.
  {
    let _shellScreen = null;
    shellContainer.addEventListener("mouseup", (e) => {
      // Only left-click, no modifiers
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (!shellInitialized) return;
      // Defer to let xterm.js finish processing selection state
      setTimeout(() => {
        // Skip if text was selected (drag, not click)
        if (term.hasSelection()) return;
        const buf = term.buffer.active;
        // Only when scrolled to bottom (current prompt is visible)
        if (buf.viewportY < buf.baseY) return;
        // Calculate clicked cell position
        if (!_shellScreen) _shellScreen = shellContainer.querySelector(".xterm-screen");
        if (!_shellScreen) return;
        const rect = _shellScreen.getBoundingClientRect();
        const cellWidth = rect.width / term.cols;
        const cellHeight = rect.height / term.rows;
        const clickCol = Math.min(Math.max(0, Math.floor((e.clientX - rect.left) / cellWidth)), term.cols - 1);
        const clickRow = Math.min(Math.max(0, Math.floor((e.clientY - rect.top) / cellHeight)), term.rows - 1);
        const curRow = buf.cursorY;
        const curCol = buf.cursorX;
        // For multi-row clicks, verify all rows between are part of the same wrapped line
        if (clickRow !== curRow) {
          const minRow = Math.min(clickRow, curRow);
          const maxRow = Math.max(clickRow, curRow);
          for (let r = minRow + 1; r <= maxRow; r++) {
            const rowLine = buf.getLine(buf.viewportY + r);
            if (!rowLine || !rowLine.isWrapped) return; // Different lines — don't move
          }
        }
        // Clamp click column to actual content length on the clicked row
        const clickLine = buf.getLine(buf.viewportY + clickRow);
        if (!clickLine) return;
        const lineText = clickLine.translateToString(true);
        const targetCol = Math.min(clickCol, lineText.length);
        // Calculate total character delta (handles wrapped lines naturally)
        const delta = (clickRow - curRow) * term.cols + (targetCol - curCol);
        if (delta === 0) return;
        // Send arrow key sequences to move the shell cursor
        const arrowKey = delta > 0 ? "\x1b[C" : "\x1b[D";
        const keys = arrowKey.repeat(Math.abs(delta));
        _sendShellStdin(keys);
      }, 10);
    });
  }

  // Fit terminal when panel resizes — always sends resize to PTY
  function fitShell() {
    if (!shellInitialized || !shellPanel.classList.contains("open")) return;
    try {
      fitAddon.fit();
    } catch {}
    if (ws && ws.readyState === WebSocket.OPEN && term.cols && term.rows) {
      ws.send(JSON.stringify({ type: "shell-resize", cols: term.cols, rows: term.rows }));
    }
  }

  // Dynamic grid padding — keeps cards above the terminal panel
  function updateShellPadding() {
    const h = shellPanel.offsetHeight || 42;
    document.documentElement.style.setProperty("--shell-panel-h", h + 8 + "px");
    if (shellPanel.classList.contains("open")) {
      grid.style.paddingBottom = (h + 40) + "px";
    } else {
      grid.style.paddingBottom = "";
    }
  }

  // Click CWD pill → open folder in Finder
  document.getElementById("shell-cwd").addEventListener("click", (e) => {
    e.stopPropagation(); // Don't toggle the panel
    const fullPath = e.currentTarget.dataset.fullPath;
    if (fullPath) {
      fetch("/api/shell/open-finder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: fullPath }),
      });
    }
  });

  // Click branch pill → copy branch name to clipboard
  document.getElementById("shell-branch").addEventListener("click", (e) => {
    e.stopPropagation(); // Don't toggle the panel
    const branch = e.currentTarget.textContent.trim();
    if (!branch) return;
    navigator.clipboard.writeText(branch).then(() => {
      const el = e.currentTarget;
      const original = el.textContent;
      el.textContent = "Copied!";
      setTimeout(() => { el.textContent = original; }, 1200);
    });
  });

  // Toggle panel by clicking header bar (not a tab stop — use T/Escape hotkeys)
  shellHeader.addEventListener("click", (e) => {
    // Don't toggle if clicking a link or info pill
    if (e.target.closest("a") || e.target.closest(".shell-info-pill")) return;
    // Save height before toggling (while still open)
    if (shellPanel.classList.contains("open")) {
      shellPanel._savedHeight = shellPanel.offsetHeight;
    }
    const isOpen = shellPanel.classList.toggle("open");
    try { localStorage.setItem("ceo-shell-open", isOpen ? "1" : "0"); } catch {}
    if (isOpen) {
      initShellTerminal();
      // Restore user-resized height, or clear to let CSS default (280px)
      if (shellPanel._savedHeight && shellPanel._savedHeight > 80) {
        shellPanel.style.height = shellPanel._savedHeight + "px";
      } else {
        shellPanel.style.height = "";
      }
      // Hide xterm viewport scrollbar during expand to prevent glitch
      const viewport = shellContainer.querySelector(".xterm-viewport");
      if (viewport) viewport.style.overflow = "hidden";
      requestAnimationFrame(() => {
        fitShell();
        term.focus();
        updateShellPadding();
        if (viewport) setTimeout(() => { viewport.style.overflow = ""; }, 50);
      });
    } else {
      // Clear inline style so CSS auto-height collapses it
      shellPanel.style.height = "";
      updateShellPadding();
      _acDismiss();
    }
  });

  // Block ALL wheel scroll from leaking out of the shell panel to the dashboard
  shellPanel.addEventListener("wheel", (e) => {
    e.preventDefault();
  }, { passive: false });

  // Block touch scroll from leaking out of the shell panel to the dashboard
  shellPanel.addEventListener("touchmove", (e) => {
    e.stopPropagation();
  }, { passive: true });

  // Resize handle — debounce fitShell during drag (expensive DOM reflow)
  let _dragFitTimer = null;
  function fitShellDebounced() {
    clearTimeout(_dragFitTimer);
    _dragFitTimer = setTimeout(fitShell, 50);
  }

  shellResize.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = shellPanel.offsetHeight;
    document.body.style.userSelect = "none";
    const onMove = (ev) => {
      const newH = Math.max(120, startH + (startY - ev.clientY));
      shellPanel.style.height = newH + "px";
      fitShellDebounced();
      updateShellPadding();
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      fitShell(); // final precise fit
      updateShellPadding();
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  // Touch resize for shell panel (mobile)
  shellResize.addEventListener("touchstart", (e) => {
    e.preventDefault();
    const startY = e.touches[0].clientY;
    const startH = shellPanel.offsetHeight;

    const onTouchMove = (ev) => {
      const newH = Math.max(120, startH + (startY - ev.touches[0].clientY));
      shellPanel.style.height = newH + "px";
      fitShellDebounced();
      updateShellPadding();
    };

    const onTouchEnd = () => {
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      fitShell(); // final precise fit
      updateShellPadding();
    };

    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd);
  });

  // Re-fit on window resize
  // Debounce window resize — fitAddon.fit() triggers expensive DOM reflow
  let _fitResizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(_fitResizeTimer);
    _fitResizeTimer = setTimeout(fitShell, 100);
  });
}

// --- Todo View ---

let currentView = "agents"; // "agents" | "todo"
let todoData = { lists: [], colors: [] };
let activeListId = null;
function _todoStorageKey() {
  return window.innerWidth <= 600 ? "todo-last-mobile" : "todo-last-desktop";
}
function saveTodoLastList() {
  if (activeListId) localStorage.setItem(_todoStorageKey(), activeListId);
}
function restoreTodoLastList() {
  if (!activeListId) {
    activeListId = localStorage.getItem(_todoStorageKey()) || null;
  }
}
let todoSaveTimer = null;
let todoRawMode = false; // false = rich editor (default), true = raw textarea

const todoView = document.getElementById("todo-view");
const todoDotsEl = document.getElementById("todo-dots");
const todoContentEl = document.getElementById("todo-content");
const todoBtn = document.getElementById("todo-btn");
const todoBackBtn = document.getElementById("todo-back");
const todoNewBtn = document.getElementById("todo-new");
const todoSettingsOverlayEl = document.getElementById("todo-settings-overlay");
const todoSettingsClose = document.getElementById("todo-settings-close");
const todoAddColor = document.getElementById("todo-add-color");
const todoColorRows = document.getElementById("todo-color-rows");

let _savedScrollY = 0;
let _returnToCard = null;

function showTodoView(fromCardName) {
  _savedScrollY = window.scrollY;
  _returnToCard = fromCardName || null;
  currentView = "todo";
  grid.style.display = "none";
  minimizedBar.style.display = "none";
  todoView.classList.remove("hidden");
  todoBtn.classList.add("active");
  document.querySelector(".header-right").classList.add("todo-mode");
  loadTodoData();
}

function showAgentsView() {
  currentView = "agents";
  // Clear pending save timers
  if (todoSaveTimer) { clearTimeout(todoSaveTimer); todoSaveTimer = null; }
  if (_richSaveTimer) { clearTimeout(_richSaveTimer); _richSaveTimer = null; }
  if (_todoSaveMaxWait) { clearTimeout(_todoSaveMaxWait); _todoSaveMaxWait = null; }
  if (_richSaveMaxWait) { clearTimeout(_richSaveMaxWait); _richSaveMaxWait = null; }
  // Flush any unsaved content before leaving
  saveTodoContent();
  todoView.classList.add("hidden");
  grid.style.display = "";
  minimizedBar.style.display = "";
  todoBtn.classList.remove("active");
  const headerRight = document.querySelector(".header-right");
  if (headerRight) headerRight.classList.remove("todo-mode");
  scheduleMasonry();
  // Restore scroll: if came from a card pill, scroll to that card; otherwise restore position
  requestAnimationFrame(() => {
    if (_returnToCard && agents.has(_returnToCard)) {
      const card = agents.get(_returnToCard).card;
      card.scrollIntoView({ behavior: "instant", block: "center" });
      _returnToCard = null;
    } else {
      window.scrollTo(0, _savedScrollY);
    }
  });
}

function toggleTodoView() {
  if (currentView === "todo") showAgentsView();
  else showTodoView();
}

todoBtn.addEventListener("click", toggleTodoView);
todoBackBtn.addEventListener("click", showAgentsView);


todoNewBtn.addEventListener("click", async () => {
  try {
    const res = await fetch("/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New List" }),
    });
    const list = await res.json();
    activeListId = list.id;
    saveTodoLastList();
  } catch (err) {
    console.error("Failed to create todo list:", err);
  }
});

async function loadTodoData() {
  try {
    const res = await fetch("/api/todos");
    todoData = await res.json();
    restoreTodoLastList();
    // Validate restored ID still exists
    if (activeListId && !todoData.lists.find((l) => l.id === activeListId)) {
      activeListId = null;
    }
    if (!activeListId && todoData.lists.length > 0) {
      activeListId = todoData.lists[0].id;
    }
    saveTodoLastList();
    renderTodoDots();
    renderActiveList();
  } catch (err) {
    console.error("Failed to load todos:", err);
  }
}

function handleTodoUpdate(data) {
  const rawEditor = document.querySelector(".todo-editor");
  const richEditor = document.getElementById("todo-rich-editor");
  const titleInput = document.querySelector(".todo-title-input");
  const active = document.activeElement;
  const editorFocused = (rawEditor && active === rawEditor) || (richEditor && (active === richEditor || richEditor.contains(active)));
  const titleFocused = titleInput && active === titleInput;

  todoData = data;

  // If active list was deleted, clear selection
  if (activeListId && !todoData.lists.find((l) => l.id === activeListId)) {
    activeListId = todoData.lists.length > 0 ? todoData.lists[0].id : null;
  }

  renderTodoDots();

  // Skip re-rendering content area if user is actively editing (avoids cursor jumps)
  if (editorFocused || titleFocused) return;
  renderActiveList();
}

function getColorHex(colorId) {
  const color = todoData.colors.find((c) => c.id === colorId);
  return color ? color.hex : "#8A9BA8";
}

function renderTodoDots() {
  todoDotsEl.innerHTML = "";
  const sorted = [...todoData.lists].sort((a, b) => a.order - b.order);
  for (const list of sorted) {
    const tab = document.createElement("div");
    tab.className = "todo-dot" + (list.id === activeListId ? " active" : "");
    tab.tabIndex = 0;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", list.id === activeListId ? "true" : "false");

    const circle = document.createElement("span");
    circle.className = "todo-dot-circle";
    circle.style.background = getColorHex(list.colorId);
    tab.appendChild(circle);

    const label = document.createElement("span");
    label.className = "todo-dot-label";
    label.textContent = list.title || "Untitled";
    tab.appendChild(label);

    tab.addEventListener("click", () => {
      activeListId = list.id;
      saveTodoLastList();
      renderTodoDots();
      renderActiveList();
    });
    tab.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        tab.click();
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const tabs = [...todoDotsEl.querySelectorAll(".todo-dot")];
        const i = tabs.indexOf(tab);
        const next = e.key === "ArrowRight"
          ? tabs[(i + 1) % tabs.length]
          : tabs[(i - 1 + tabs.length) % tabs.length];
        if (next) { next.focus(); next.click(); }
      }
    });
    todoDotsEl.appendChild(tab);
  }
  // Settings gear
  const gear = document.createElement("div");
  gear.className = "todo-dot-settings";
  gear.innerHTML = "\u2699";
  gear.title = "Color settings";
  gear.addEventListener("click", openTodoSettings);
  todoDotsEl.appendChild(gear);
}

function renderActiveList() {
  const list = todoData.lists.find((l) => l.id === activeListId);
  if (!list) {
    todoContentEl.innerHTML = '<div class="todo-empty-state"><p>No lists yet. Click <strong>+ New List</strong> to create one.</p></div>';
    return;
  }

  const hex = safeHex(getColorHex(list.colorId));
  const tintBg = hex + "0a";

  todoContentEl.innerHTML = `
    <div class="todo-list-active" style="background:${tintBg};--list-accent:${hex}">
      <div class="todo-title-bar">
        <div class="todo-color-trigger" style="background:${hex}" title="Change color"></div>
        <div class="todo-color-dropdown" id="todo-color-dropdown"></div>
        <input class="todo-title-input" value="${escapeHtml(list.title)}" placeholder="List title" style="color:${hex}">
        <button class="todo-delete-btn" title="Delete list">&times;</button>
      </div>
      <div class="todo-editor-area">
        ${todoRawMode
          ? `<textarea class="todo-editor" placeholder="- [ ] Your first task...">${escapeHtml(list.content)}</textarea>`
          : '<div class="todo-rich-editor" id="todo-rich-editor"></div>'
        }
      </div>
      <div class="todo-status-bar">
        <div class="todo-status-counts" id="todo-status-counts"></div>
        <div class="todo-status-right">
          <button class="todo-hotkey-btn" title="Keyboard shortcuts">?</button>
          <button class="todo-preview-toggle${todoRawMode ? " active" : ""}">${todoRawMode ? "Rich" : "Raw"}</button>
        </div>
      </div>
      <div class="todo-hotkey-panel hidden">
        <div class="todo-hotkey-grid">
          <kbd>\u2318B</kbd><span>Bold</span>
          <kbd>\u2318I</kbd><span>Italic</span>
          <kbd>\u2318Z</kbd><span>Undo</span>
          <kbd>\u21e7\u2318Z</kbd><span>Redo</span>
          <kbd>\u23188</kbd><span>Checkbox</span>
          <kbd>\u2318=</kbd><span>Heading \u2191</span>
          <kbd>\u2318\u2013</kbd><span>Heading \u2193</span>
          <kbd>\u2318[</kbd><span>Prev list</span>
          <kbd>\u2318]</kbd><span>Next list</span>
          <kbd>Esc</kbd><span>Back to agents</span>
        </div>
      </div>
    </div>
  `;

  // Wire up title input
  const titleInput = todoContentEl.querySelector(".todo-title-input");
  titleInput.addEventListener("input", () => scheduleTodoSave());

  // Wire up raw textarea (only in raw mode)
  const textarea = todoContentEl.querySelector(".todo-editor");
  if (textarea) {
    textarea.addEventListener("input", () => scheduleTodoSave());
    setupRawEditorKeys(textarea);
  }

  // Populate rich editor (only in rich mode)
  if (!todoRawMode) renderRichEditorContent(list);

  // Delete — double-click arm pattern
  const deleteBtn = todoContentEl.querySelector(".todo-delete-btn");
  let deleteArmed = false;
  let deleteTimer = null;
  deleteBtn.addEventListener("click", async () => {
    if (!deleteArmed) {
      deleteArmed = true;
      deleteBtn.classList.add("armed");
      deleteBtn.textContent = "delete";
      deleteTimer = setTimeout(() => {
        deleteArmed = false;
        deleteBtn.classList.remove("armed");
        deleteBtn.innerHTML = "\u00d7";
      }, 2000);
      return;
    }
    clearTimeout(deleteTimer);
    await fetch(`/api/todos/${list.id}`, { method: "DELETE" });
  });

  // Color trigger
  const trigger = todoContentEl.querySelector(".todo-color-trigger");
  const dropdown = todoContentEl.querySelector(".todo-color-dropdown");
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdown.classList.toggle("visible");
    if (dropdown.classList.contains("visible")) renderColorDropdown(list);
  });
  document.addEventListener("click", function closeDropdown(e) {
    if (!dropdown.contains(e.target) && e.target !== trigger) {
      dropdown.classList.remove("visible");
      document.removeEventListener("click", closeDropdown);
    }
  });

  // Hotkey panel toggle
  const hotkeyBtn = todoContentEl.querySelector(".todo-hotkey-btn");
  const hotkeyPanel = todoContentEl.querySelector(".todo-hotkey-panel");
  if (hotkeyBtn && hotkeyPanel) {
    hotkeyBtn.addEventListener("click", () => hotkeyPanel.classList.toggle("hidden"));
  }

  // Mode toggle (Rich ↔ Raw)
  todoContentEl.querySelector(".todo-preview-toggle").addEventListener("click", () => {
    if (todoRawMode) {
      const ta = todoContentEl.querySelector(".todo-editor");
      if (ta) { list.content = ta.value; saveTodoNow(list); }
    } else {
      const md = richEditorToMarkdown();
      if (md !== null) { list.content = md; saveTodoNow(list); }
    }
    todoRawMode = !todoRawMode;
    renderActiveList();
  });

  updateTodoStatusBar(list);
}

function saveTodoNow(list) {
  fetch(`/api/todos/${list.id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: list.content }),
  });
}

// ═══════════════════════════════════════════════════
// RICH EDITOR — contenteditable structured items
// ═══════════════════════════════════════════════════

function parseMarkdownToItems(markdown) {
  if (!markdown || !markdown.trim()) return [];
  const lines = markdown.split("\n");
  const items = [];
  for (const line of lines) {
    const cbU = line.match(/^(\s*)- \[ \] (.*)/);
    const cbC = line.match(/^(\s*)- \[x\] (.*)/i);
    const bullet = line.match(/^(\s*)[-*] (.*)/);
    const numbered = line.match(/^(\s*)(\d+)\. (.*)/);
    const heading = line.match(/^(#{1,6}) (.*)/);
    if (cbU) items.push({ type: "checkbox", checked: false, text: cbU[2] });
    else if (cbC) items.push({ type: "checkbox", checked: true, text: cbC[2] });
    else if (bullet) items.push({ type: "bullet", text: bullet[2] });
    else if (numbered) items.push({ type: "numbered", text: numbered[3] });
    else if (heading) items.push({ type: "heading", level: heading[1].length, text: heading[2] });
    else if (line.trim() === "") {
      if (items.length === 0 || items[items.length - 1].type !== "separator") items.push({ type: "separator" });
    } else items.push({ type: "text", text: line });
  }
  if (items.length > 0 && items[items.length - 1].type === "separator") items.pop();
  return items;
}

function inlineMarkdownToHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}

function htmlToInlineMarkdown(el) {
  let md = "";
  for (const node of el.childNodes) {
    if (node.nodeType === 3) { md += node.textContent; }
    else if (node.nodeType === 1) {
      const tag = node.tagName.toLowerCase();
      if (tag === "strong" || tag === "b") md += "**" + htmlToInlineMarkdown(node) + "**";
      else if (tag === "em" || tag === "i") md += "*" + htmlToInlineMarkdown(node) + "*";
      else if (tag === "code") md += "`" + node.textContent + "`";
      else if (tag !== "br") md += htmlToInlineMarkdown(node);
    }
  }
  return md;
}

function richEditorToMarkdown() {
  const editor = document.getElementById("todo-rich-editor");
  if (!editor) return null;
  const items = editor.querySelectorAll(".todo-rich-item");
  const lines = [];
  let numCount = 0;
  for (const item of items) {
    const type = item.dataset.type;
    if (type === "separator") { lines.push(""); numCount = 0; continue; }
    const textEl = item.querySelector(".todo-rich-text");
    const text = textEl ? htmlToInlineMarkdown(textEl) : "";
    if (type === "checkbox") { lines.push(`- [${item.dataset.checked === "true" ? "x" : " "}] ${text}`); numCount = 0; }
    else if (type === "bullet") { lines.push(`- ${text}`); numCount = 0; }
    else if (type === "numbered") { numCount++; lines.push(`${numCount}. ${text}`); }
    else if (type === "heading") { lines.push(`${"#".repeat(parseInt(item.dataset.level) || 1)} ${text}`); numCount = 0; }
    else { lines.push(text); numCount = 0; }
  }
  return lines.join("\n");
}

function createRichItem(itemData, isInitialEmpty) {
  const div = document.createElement("div");
  div.className = "todo-rich-item";
  div.dataset.type = itemData.type;
  if (itemData.type === "separator") { div.contentEditable = "false"; return div; }

  if (itemData.type === "checkbox") {
    div.dataset.checked = itemData.checked ? "true" : "false";
    const cb = document.createElement("span");
    cb.className = "todo-checkbox" + (itemData.checked ? " checked" : "");
    cb.contentEditable = "false";
    cb.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const was = div.dataset.checked === "true";
      div.dataset.checked = was ? "false" : "true";
      cb.classList.toggle("checked");
      const t = div.querySelector(".todo-rich-text");
      if (t) t.classList.toggle("checked-text", !was);
      scheduleRichSave();
    });
    div.appendChild(cb);
  } else if (itemData.type === "bullet") {
    const b = document.createElement("span");
    b.className = "todo-rich-bullet";
    b.contentEditable = "false";
    b.textContent = "\u2022";
    div.appendChild(b);
  } else if (itemData.type === "numbered") {
    const n = document.createElement("span");
    n.className = "todo-rich-bullet";
    n.contentEditable = "false";
    n.textContent = (itemData.num || 1) + ".";
    div.appendChild(n);
  }

  const textEl = document.createElement("span");
  textEl.className = "todo-rich-text";
  if (itemData.type === "checkbox" && itemData.checked) textEl.classList.add("checked-text");
  textEl.innerHTML = inlineMarkdownToHtml(itemData.text || "");

  if (itemData.type === "heading") {
    div.dataset.level = itemData.level || 1;
    const lvl = itemData.level || 1;
    textEl.style.fontSize = lvl === 1 ? "20px" : lvl === 2 ? "17px" : "15px";
    textEl.style.fontWeight = "700";
  }

  // Only show placeholder on the initial empty item when a list is brand new
  if (isInitialEmpty && !itemData.text) {
    textEl.dataset.placeholder = "New item...";
  }

  div.appendChild(textEl);
  return div;
}

function autoConvertMarkdownPrefix(itemEl, textEl) {
  // Only auto-convert plain text or bullet items — don't re-convert existing checkboxes/headings
  const type = itemEl.dataset.type;
  const raw = textEl.textContent;

  // Checkbox: "- [ ] " or "- [x] "
  const cbU = raw.match(/^- \[ \] (.*)/);
  const cbC = raw.match(/^- \[x\] (.*)/i);
  if (cbU || cbC) {
    const checked = !!cbC;
    const rest = checked ? cbC[1] : cbU[1];
    replaceItemAs(itemEl, textEl, "checkbox", rest, checked);
    return;
  }

  // Bullet: "- " or "* " at start (only if item is currently text)
  if (type === "text" || type === "bullet") {
    const bm = raw.match(/^[-*] (.+)/);
    if (bm && type === "text") {
      replaceItemAs(itemEl, textEl, "bullet", bm[1], false);
      return;
    }
  }

  // Heading: "# " through "###### "
  if (type === "text") {
    const hm = raw.match(/^(#{1,6}) (.+)/);
    if (hm) {
      replaceItemAs(itemEl, textEl, "heading", hm[2], false, hm[1].length);
      return;
    }
  }

  // Numbered: "1. " etc.
  if (type === "text") {
    const nm = raw.match(/^(\d+)\. (.+)/);
    if (nm) {
      replaceItemAs(itemEl, textEl, "numbered", nm[2], false);
      return;
    }
  }
}

function replaceItemAs(itemEl, textEl, newType, newText, checked, headingLevel) {
  pushRichUndo();
  // Remove old prefix element
  const oldPrefix = itemEl.querySelector(".todo-checkbox, .todo-rich-bullet");
  if (oldPrefix) oldPrefix.remove();

  itemEl.dataset.type = newType;
  delete itemEl.dataset.checked;
  textEl.classList.remove("checked-text");
  textEl.style.fontSize = "";
  textEl.style.fontWeight = "";
  delete itemEl.dataset.level;

  if (newType === "checkbox") {
    itemEl.dataset.checked = checked ? "true" : "false";
    const cb = document.createElement("span");
    cb.className = "todo-checkbox" + (checked ? " checked" : "");
    cb.contentEditable = "false";
    cb.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const was = itemEl.dataset.checked === "true";
      itemEl.dataset.checked = was ? "false" : "true";
      cb.classList.toggle("checked");
      if (textEl) textEl.classList.toggle("checked-text", !was);
      scheduleRichSave();
    });
    itemEl.insertBefore(cb, textEl);
    if (checked) textEl.classList.add("checked-text");
  } else if (newType === "bullet") {
    const b = document.createElement("span");
    b.className = "todo-rich-bullet";
    b.contentEditable = "false";
    b.textContent = "\u2022";
    itemEl.insertBefore(b, textEl);
  } else if (newType === "numbered") {
    const n = document.createElement("span");
    n.className = "todo-rich-bullet";
    n.contentEditable = "false";
    n.textContent = "1.";
    itemEl.insertBefore(n, textEl);
  } else if (newType === "heading") {
    itemEl.dataset.level = headingLevel || 1;
    const lvl = headingLevel || 1;
    textEl.style.fontSize = lvl === 1 ? "20px" : lvl === 2 ? "17px" : "15px";
    textEl.style.fontWeight = "700";
  }

  // Set the remaining text and place cursor at end
  textEl.innerHTML = inlineMarkdownToHtml(newText);
  delete textEl.dataset.placeholder;
  focusAtEnd(textEl);
}

function handleRichItemKey(e, itemEl, textEl) {
  const editor = document.getElementById("todo-rich-editor");
  if (!editor) return;

  // Cmd+B: bold
  if ((e.metaKey || e.ctrlKey) && e.key === "b") {
    e.preventDefault(); document.execCommand("bold"); scheduleRichSave(); return;
  }
  // Cmd+I: italic
  if ((e.metaKey || e.ctrlKey) && e.key === "i") {
    e.preventDefault(); document.execCommand("italic"); scheduleRichSave(); return;
  }

  // Enter: new item below
  if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    pushRichUndo();
    const sel = window.getSelection();
    const range = sel.getRangeAt(0);
    const afterRange = document.createRange();
    afterRange.setStart(range.endContainer, range.endOffset);
    if (textEl.lastChild) afterRange.setEndAfter(textEl.lastChild);
    else afterRange.setEnd(textEl, textEl.childNodes.length);
    const frag = afterRange.extractContents();
    const tmp = document.createElement("div");
    tmp.appendChild(frag);
    const afterText = htmlToInlineMarkdown(tmp);

    if (!textEl.textContent.trim() && !afterText.trim() && itemEl.dataset.type !== "text") {
      convertItemToText(itemEl); scheduleRichSave(); return;
    }

    const newItem = createRichItem({
      type: itemEl.dataset.type, checked: false,
      level: parseInt(itemEl.dataset.level) || 1, text: afterText,
    });
    itemEl.after(newItem);
    const newText = newItem.querySelector(".todo-rich-text");
    if (newText) focusAtStart(newText);
    scheduleRichSave();
    return;
  }

  // Backspace at start
  if (e.key === "Backspace") {
    const sel = window.getSelection();
    if (!sel.isCollapsed) return;
    if (!isCaretAtStart(textEl)) return;
    pushRichUndo();
    const items = [...editor.querySelectorAll(".todo-rich-item:not([data-type='separator'])")];
    const idx = items.indexOf(itemEl);

    if (!textEl.textContent.trim()) {
      if (items.length <= 1) return;
      e.preventDefault();
      if (itemEl.dataset.type !== "text") {
        convertItemToText(itemEl);
      } else {
        const focusIdx = Math.max(0, idx - 1);
        itemEl.remove();
        const rest = [...editor.querySelectorAll(".todo-rich-item:not([data-type='separator'])")];
        if (rest[focusIdx]) { const t = rest[focusIdx].querySelector(".todo-rich-text"); if (t) focusAtEnd(t); }
      }
      scheduleRichSave(); return;
    }
    if (idx > 0) {
      e.preventDefault();
      const prevText = items[idx - 1].querySelector(".todo-rich-text");
      if (!prevText) return;
      const prevLen = prevText.textContent.length;
      while (textEl.firstChild) prevText.appendChild(textEl.firstChild);
      itemEl.remove();
      setCursorAtOffset(prevText, prevLen);
      scheduleRichSave();
    }
  }
}

function convertItemToText(itemEl) {
  itemEl.dataset.type = "text";
  delete itemEl.dataset.checked;
  const prefix = itemEl.querySelector(".todo-checkbox, .todo-rich-bullet");
  if (prefix) prefix.remove();
  const textEl = itemEl.querySelector(".todo-rich-text");
  if (textEl) { textEl.classList.remove("checked-text"); delete textEl.dataset.placeholder; }
}

function richToggleHeading(increase) {
  pushRichUndo();
  const editor = document.getElementById("todo-rich-editor");
  if (!editor) return;
  const sel = window.getSelection();
  let itemEl = null;
  if (sel.anchorNode) {
    const node = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    if (node && editor.contains(node)) itemEl = node.closest(".todo-rich-item");
  }
  // Fallback: use the first item if cursor isn't in one
  if (!itemEl) itemEl = editor.querySelector(".todo-rich-item:not([data-type='separator'])");
  if (!itemEl) return;
  const textEl = itemEl.querySelector(".todo-rich-text");
  if (!textEl) return;

  const currentLevel = parseInt(itemEl.dataset.level) || 0;
  const isHeading = itemEl.dataset.type === "heading";

  if (increase) {
    if (!isHeading) {
      // Convert to heading level 1
      const oldPrefix = itemEl.querySelector(".todo-checkbox, .todo-rich-bullet");
      if (oldPrefix) oldPrefix.remove();
      itemEl.dataset.type = "heading";
      itemEl.dataset.level = "1";
      delete itemEl.dataset.checked;
      textEl.classList.remove("checked-text");
      textEl.style.fontSize = "20px";
      textEl.style.fontWeight = "700";
    } else if (currentLevel < 6) {
      const newLvl = currentLevel + 1;
      itemEl.dataset.level = newLvl;
      textEl.style.fontSize = newLvl === 1 ? "20px" : newLvl === 2 ? "17px" : "15px";
    }
  } else {
    // Decrease
    if (isHeading && currentLevel > 1) {
      const newLvl = currentLevel - 1;
      itemEl.dataset.level = newLvl;
      textEl.style.fontSize = newLvl === 1 ? "20px" : newLvl === 2 ? "17px" : "15px";
    } else if (isHeading && currentLevel <= 1) {
      // Remove heading — convert back to text
      itemEl.dataset.type = "text";
      delete itemEl.dataset.level;
      textEl.style.fontSize = "";
      textEl.style.fontWeight = "";
    }
  }
}

function toggleCurrentItemCheckbox() {
  pushRichUndo();
  const sel = window.getSelection();
  if (!sel.anchorNode) return;
  const node = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
  const itemEl = node?.closest(".todo-rich-item");
  if (!itemEl) return;
  const textEl = itemEl.querySelector(".todo-rich-text");

  if (itemEl.dataset.type === "checkbox") {
    convertItemToText(itemEl);
  } else {
    itemEl.dataset.type = "checkbox";
    itemEl.dataset.checked = "false";
    const cb = document.createElement("span");
    cb.className = "todo-checkbox";
    cb.contentEditable = "false";
    cb.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const was = itemEl.dataset.checked === "true";
      itemEl.dataset.checked = was ? "false" : "true";
      cb.classList.toggle("checked");
      if (textEl) textEl.classList.toggle("checked-text", !was);
      scheduleRichSave();
    });
    const bullet = itemEl.querySelector(".todo-rich-bullet");
    if (bullet) bullet.remove();
    itemEl.insertBefore(cb, textEl);
    if (textEl) textEl.classList.remove("checked-text");
  }
  scheduleRichSave();
  if (textEl) focusAtEnd(textEl);
}

function isCaretAtStart(el) {
  const sel = window.getSelection();
  if (!sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  const pre = document.createRange();
  pre.setStart(el, 0);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length === 0;
}

function focusAtStart(el) {
  const host = el.closest("[contenteditable='true']") || el;
  host.focus();
  const r = document.createRange(); r.setStart(el, 0); r.collapse(true);
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
}

function focusAtEnd(el) {
  const host = el.closest("[contenteditable='true']") || el;
  host.focus();
  const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
}

function setCursorAtOffset(el, charOffset) {
  const host = el.closest("[contenteditable='true']") || el;
  host.focus();
  let count = 0;
  const walk = (node) => {
    if (node.nodeType === 3) {
      const len = node.textContent.length;
      if (count + len >= charOffset) {
        const r = document.createRange(); r.setStart(node, charOffset - count); r.collapse(true);
        const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
        return true;
      }
      count += len;
    } else { for (const c of node.childNodes) { if (walk(c)) return true; } }
    return false;
  };
  if (!walk(el)) focusAtEnd(el);
}

// ═══════════════════════════════════════════════════
// UNDO / REDO — markdown-level snapshots
// ═══════════════════════════════════════════════════
const _richUndoStack = [];
const _richRedoStack = [];
let _richUndoBatchTimer = null;

function pushRichUndo() {
  const md = richEditorToMarkdown();
  if (md === null) return;
  if (_richUndoStack.length > 0 && _richUndoStack[_richUndoStack.length - 1] === md) return;
  _richUndoStack.push(md);
  if (_richUndoStack.length > 200) _richUndoStack.shift();
  _richRedoStack.length = 0;
}

function batchPushRichUndo() {
  if (_richUndoBatchTimer) clearTimeout(_richUndoBatchTimer);
  _richUndoBatchTimer = setTimeout(pushRichUndo, 800);
}

function richUndo() {
  const editor = document.getElementById("todo-rich-editor");
  if (!editor || _richUndoStack.length === 0) return;
  const currentMd = richEditorToMarkdown();
  let prevMd = _richUndoStack.pop();
  if (prevMd === currentMd && _richUndoStack.length > 0) {
    _richRedoStack.push(prevMd);
    prevMd = _richUndoStack.pop();
  }
  if (currentMd !== null && currentMd !== prevMd) _richRedoStack.push(currentMd);
  restoreRichEditor(prevMd);
}

function richRedo() {
  const editor = document.getElementById("todo-rich-editor");
  if (!editor || _richRedoStack.length === 0) return;
  const currentMd = richEditorToMarkdown();
  if (currentMd !== null) _richUndoStack.push(currentMd);
  const nextMd = _richRedoStack.pop();
  restoreRichEditor(nextMd);
}

function restoreRichEditor(md) {
  const editor = document.getElementById("todo-rich-editor");
  if (!editor) return;
  const items = parseMarkdownToItems(md);
  editor.innerHTML = "";
  if (items.length === 0) {
    editor.appendChild(createRichItem({ type: "checkbox", checked: false, text: "" }, true));
  } else {
    let numCount = 0;
    for (const item of items) {
      if (item.type === "numbered") { numCount++; item.num = numCount; }
      else if (item.type !== "separator") numCount = 0;
      editor.appendChild(createRichItem(item));
    }
  }
  const texts = editor.querySelectorAll(".todo-rich-text");
  if (texts.length) focusAtEnd(texts[texts.length - 1]);
  const list = todoData.lists.find((l) => l.id === activeListId);
  if (list) {
    list.content = md;
    fetch(`/api/todos/${activeListId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: md }),
    });
    updateTodoStatusBar(list);
    renderTodoDots();
  }
}

let _richSaveTimer = null;
let _richSaveMaxWait = null;
function _doRichSave() {
  const md = richEditorToMarkdown();
  if (md === null) return;
  const list = todoData.lists.find((l) => l.id === activeListId);
  if (!list) return;
  list.content = md;
  const titleInput = todoContentEl.querySelector(".todo-title-input");
  const updates = { content: md };
  if (titleInput) { updates.title = titleInput.value; list.title = updates.title; }
  fetch(`/api/todos/${activeListId}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  updateTodoStatusBar(list);
  renderTodoDots();
}
function scheduleRichSave() {
  if (_richSaveTimer) clearTimeout(_richSaveTimer);
  _richSaveTimer = setTimeout(_doRichSave, 300);
  // Max-wait: force a save every 800ms during continuous typing for cross-device sync
  if (!_richSaveMaxWait) {
    _richSaveMaxWait = setTimeout(() => {
      _richSaveMaxWait = null;
      if (_richSaveTimer) { clearTimeout(_richSaveTimer); _richSaveTimer = null; }
      _doRichSave();
    }, 800);
  }
}

function renderRichEditorContent(list) {
  const editor = document.getElementById("todo-rich-editor");
  if (!editor) return;
  editor.contentEditable = "true";
  // Initialize undo stack with current content
  _richUndoStack.length = 0;
  _richRedoStack.length = 0;
  _richUndoStack.push(list.content || "");
  const items = parseMarkdownToItems(list.content);
  editor.innerHTML = "";
  if (items.length === 0) {
    editor.appendChild(createRichItem({ type: "checkbox", checked: false, text: "" }, true));
  } else {
    let numCount = 0;
    for (const item of items) {
      if (item.type === "numbered") { numCount++; item.num = numCount; }
      else if (item.type !== "separator") numCount = 0;
      editor.appendChild(createRichItem(item));
    }
  }

  // Only attach handlers once — undo/redo repopulates items but keeps the same editor element
  if (!editor._handlersAttached) {
    editor._handlersAttached = true;

    // Editor-level keydown — detect active item and delegate
    editor.addEventListener("keydown", (e) => {
      const { itemEl, textEl } = getActiveRichItem(editor);
      if (textEl && itemEl) {
        handleRichItemKey(e, itemEl, textEl);
      } else if (e.key === "Enter") {
        e.preventDefault();
        pushRichUndo();
        const newItem = createRichItem({ type: "text", text: "" });
        editor.appendChild(newItem);
        const t = newItem.querySelector(".todo-rich-text");
        if (t) focusAtStart(t);
        scheduleRichSave();
      }
    });

    // Editor-level input — detect active item, run auto-convert + save
    editor.addEventListener("input", () => {
      const { itemEl, textEl } = getActiveRichItem(editor);
      if (textEl) {
        if (textEl.textContent) delete textEl.dataset.placeholder;
        else if (editor.querySelectorAll(".todo-rich-item:not([data-type='separator'])").length <= 1) {
          textEl.dataset.placeholder = "New item...";
        }
        if (itemEl) autoConvertMarkdownPrefix(itemEl, textEl);
      }
      batchPushRichUndo();
      scheduleRichSave();
    });
  }

  // Only auto-focus if editor doesn't already have focus (first open, not WebSocket re-render)
  if (document.activeElement !== editor && !editor.contains(document.activeElement)) {
    const first = editor.querySelector(".todo-rich-text");
    if (first) setTimeout(() => focusAtEnd(first), 50);
  }
}

function getActiveRichItem(editor) {
  const sel = window.getSelection();
  if (!sel.anchorNode) return {};
  const node = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
  if (!node || !editor.contains(node)) return {};
  const textEl = node.closest ? node.closest(".todo-rich-text") : null;
  const itemEl = textEl ? textEl.closest(".todo-rich-item") : (node.closest ? node.closest(".todo-rich-item") : null);
  return { itemEl, textEl };
}

// ═══════════════════════════════════════════════════
// RAW TEXTAREA EDITOR (fallback mode)
// ═══════════════════════════════════════════════════

function setupRawEditorKeys(editor) {
  editor.addEventListener("keydown", (e) => {
    const { selectionStart: start, selectionEnd: end, value } = editor;
    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const line = value.slice(lineStart, start);
      const cbMatch = line.match(/^(\s*- \[[ x]\] )(.*)/i);
      const bMatch = line.match(/^(\s*- )(.*)/);
      const nMatch = line.match(/^(\s*)(\d+)\. (.*)/);
      const match = cbMatch || bMatch;
      if (match) {
        const content = cbMatch ? cbMatch[2] : bMatch[2];
        if (!content.trim()) { e.preventDefault(); editor.value = value.slice(0, lineStart) + value.slice(start); editor.selectionStart = editor.selectionEnd = lineStart; editor.dispatchEvent(new Event("input")); return; }
        e.preventDefault();
        const prefix = cbMatch ? cbMatch[1].replace(/\[x\]/i, "[ ]") : bMatch[1];
        const ins = "\n" + prefix;
        editor.value = value.slice(0, start) + ins + value.slice(end);
        editor.selectionStart = editor.selectionEnd = start + ins.length;
        editor.dispatchEvent(new Event("input"));
        return;
      }
      if (nMatch) {
        if (!nMatch[3].trim()) { e.preventDefault(); editor.value = value.slice(0, lineStart) + value.slice(start); editor.selectionStart = editor.selectionEnd = lineStart; editor.dispatchEvent(new Event("input")); return; }
        e.preventDefault();
        const ins = "\n" + nMatch[1] + (parseInt(nMatch[2]) + 1) + ". ";
        editor.value = value.slice(0, start) + ins + value.slice(end);
        editor.selectionStart = editor.selectionEnd = start + ins.length;
        editor.dispatchEvent(new Event("input"));
        return;
      }
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      if (e.shiftKey && value[lineStart] === " ") {
        const n = Math.min(2, value.slice(lineStart).search(/\S/));
        editor.value = value.slice(0, lineStart) + value.slice(lineStart + n);
        editor.selectionStart = editor.selectionEnd = start - n;
      } else if (!e.shiftKey) {
        editor.value = value.slice(0, lineStart) + "  " + value.slice(lineStart);
        editor.selectionStart = editor.selectionEnd = start + 2;
      }
      editor.dispatchEvent(new Event("input"));
    }
  });
}

function insertCheckbox(editor) {
  const { selectionStart: start, value } = editor;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = value.indexOf("\n", start);
  const line = value.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
  const endPos = lineEnd === -1 ? value.length : lineEnd;
  let newLine;
  if (line.match(/^\s*- \[[ x]\] /i)) newLine = line.replace(/^(\s*)- \[[ x]\] /i, "$1");
  else if (line.match(/^\s*- /)) newLine = line.replace(/^(\s*)- /, "$1- [ ] ");
  else newLine = line.match(/^(\s*)/)[1] + "- [ ] " + line.trimStart();
  editor.value = value.slice(0, lineStart) + newLine + value.slice(endPos);
  editor.selectionStart = editor.selectionEnd = lineStart + newLine.length;
  editor.dispatchEvent(new Event("input"));
}

function wrapSelection(editor, marker) {
  const { selectionStart: start, selectionEnd: end, value } = editor;
  const selected = value.slice(start, end);
  if (selected) {
    const before = value.slice(Math.max(0, start - marker.length), start);
    const after = value.slice(end, end + marker.length);
    if (before === marker && after === marker) {
      editor.value = value.slice(0, start - marker.length) + selected + value.slice(end + marker.length);
      editor.selectionStart = start - marker.length; editor.selectionEnd = end - marker.length;
    } else {
      editor.value = value.slice(0, start) + marker + selected + marker + value.slice(end);
      editor.selectionStart = start + marker.length; editor.selectionEnd = end + marker.length;
    }
  } else {
    editor.value = value.slice(0, start) + marker + marker + value.slice(end);
    editor.selectionStart = editor.selectionEnd = start + marker.length;
  }
  editor.dispatchEvent(new Event("input"));
}

function toggleHeading(editor) {
  const { selectionStart: start, value } = editor;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = value.indexOf("\n", start);
  const line = value.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
  const hm = line.match(/^(#{1,6})\s/);
  let newLine;
  if (hm && hm[1].length >= 6) newLine = line.replace(/^#{1,6}\s/, "");
  else if (hm) newLine = "#" + line;
  else newLine = "# " + line;
  const endPos = lineEnd === -1 ? value.length : lineEnd;
  editor.value = value.slice(0, lineStart) + newLine + value.slice(endPos);
  editor.selectionStart = editor.selectionEnd = lineStart + newLine.length;
  editor.dispatchEvent(new Event("input"));
}

function renderColorDropdown(list) {
  const dropdown = document.getElementById("todo-color-dropdown");
  dropdown.innerHTML = "";
  for (const color of todoData.colors) {
    const swatch = document.createElement("div");
    swatch.className = "todo-color-swatch" + (color.id === list.colorId ? " selected" : "");
    swatch.style.background = color.hex;
    swatch.title = color.name;
    swatch.addEventListener("click", async (e) => {
      e.stopPropagation();
      await fetch(`/api/todos/${list.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colorId: color.id }),
      });
      dropdown.classList.remove("visible");
    });
    dropdown.appendChild(swatch);
  }
}


let _todoSaveMaxWait = null;
function scheduleTodoSave() {
  if (todoSaveTimer) clearTimeout(todoSaveTimer);
  todoSaveTimer = setTimeout(saveTodoContent, 300);
  // Max-wait: force a save every 800ms during continuous typing for cross-device sync
  if (!_todoSaveMaxWait) {
    _todoSaveMaxWait = setTimeout(() => {
      _todoSaveMaxWait = null;
      if (todoSaveTimer) { clearTimeout(todoSaveTimer); todoSaveTimer = null; }
      saveTodoContent();
    }, 800);
  }
}

async function saveTodoContent() {
  const list = todoData.lists.find((l) => l.id === activeListId);
  if (!list) return;

  const titleInput = todoContentEl.querySelector(".todo-title-input");
  const rawEditor = todoContentEl.querySelector(".todo-editor");
  const richEditor = document.getElementById("todo-rich-editor");

  const updates = {};
  if (titleInput) updates.title = titleInput.value;

  // Read content from whichever editor is active
  if (!todoRawMode && richEditor) {
    const md = richEditorToMarkdown();
    if (md !== null) updates.content = md;
  } else if (rawEditor) {
    updates.content = rawEditor.value;
  }

  // Update local state immediately for snappy feel
  if (updates.title !== undefined) list.title = updates.title;
  if (updates.content !== undefined) list.content = updates.content;

  try {
    await fetch(`/api/todos/${activeListId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
  } catch (err) {
    console.error("Failed to save todo:", err);
  }

  updateTodoStatusBar(list);
  renderTodoDots(); // update dot title
}

function updateTodoStatusBar(list) {
  const countsEl = document.getElementById("todo-status-counts");
  if (!countsEl) return;

  const content = list.content || "";
  const lines = content.split("\n").length;
  const words = content.trim() ? content.trim().split(/\s+/).length : 0;
  const chars = content.length;

  const checked = (content.match(/- \[x\]/gi) || []).length;
  const total = (content.match(/- \[[ x]\]/gi) || []).length;

  let text = `${lines} lines \u00b7 ${words} words \u00b7 ${chars} chars`;
  if (total > 0) text += ` \u00b7 ${checked}/${total} done`;

  countsEl.textContent = text;
}

// --- Color Settings Modal ---

function openTodoSettings() {
  todoSettingsOverlayEl.classList.remove("hidden");
  renderTodoColorSettings();
}

function closeTodoSettings() {
  // Save colors on close
  const rows = todoColorRows.querySelectorAll(".todo-color-row");
  const colors = [];
  rows.forEach((row) => {
    const name = row.querySelector('input[type="text"]').value.trim();
    const hex = row.querySelector('input[type="color"]').value;
    const id = row.dataset.colorId;
    if (name && hex) colors.push({ id, name, hex });
  });
  fetch("/api/todo-colors", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ colors }),
  });
  todoSettingsOverlayEl.classList.add("hidden");
}

todoSettingsClose.addEventListener("click", closeTodoSettings);
todoSettingsOverlayEl.addEventListener("click", (e) => {
  if (e.target === todoSettingsOverlayEl) closeTodoSettings();
});

function renderTodoColorSettings() {
  todoColorRows.innerHTML = "";
  for (const color of todoData.colors) {
    const row = document.createElement("div");
    row.className = "todo-color-row";
    row.dataset.colorId = color.id;
    row.innerHTML = `
      <input type="color" value="${safeHex(color.hex)}">
      <input type="text" value="${escapeHtml(color.name)}" placeholder="Color name">
      <button class="todo-color-remove" title="Remove">&times;</button>
    `;
    row.querySelector(".todo-color-remove").addEventListener("click", () => row.remove());
    todoColorRows.appendChild(row);
  }
}

todoAddColor.addEventListener("click", () => {
  const id = "c" + Math.random().toString(36).slice(2, 8);
  const row = document.createElement("div");
  row.className = "todo-color-row";
  row.dataset.colorId = id;
  row.innerHTML = `
    <input type="color" value="#8A9BA8">
    <input type="text" value="" placeholder="Color name">
    <button class="todo-color-remove" title="Remove">&times;</button>
  `;
  row.querySelector(".todo-color-remove").addEventListener("click", () => row.remove());
  todoColorRows.appendChild(row);
});


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

  // Also handle focus events directly for textareas/inputs
  document.addEventListener("focusin", (e) => {
    if (!isMobile()) return;
    const el = e.target;
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      // Delay to let the keyboard animation finish
      setTimeout(() => {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 300);
    }
  });
}
