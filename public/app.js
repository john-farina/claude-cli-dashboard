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
        const agent = _getAgentName(textarea);
        const curActive = document.activeElement;
        const curDesc = curActive ? (curActive.id || curActive.className?.split?.(" ")?.[0] || curActive.tagName) : "null";
        _focusLog("guard-restore", `restoring textarea[${agent}], was on ${curDesc}`, { guard: "focusout-guard" });
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
      const agent = _getAgentName(_lastActiveTextarea);
      _focusLog("body-restore", `restoring textarea[${agent}] from body`, { guard: "body-focusin-guard" });
      _lastActiveTextarea.focus({ preventScroll: true });
    }
  });
}, true);

// --- Focus debug logging (writes to /tmp/ceo-focus-debug.log via server) ---
const _focusLogBuffer = [];
let _focusLogTimer = null;
function _flushFocusLog() {
  if (!_focusLogBuffer.length) return;
  const entries = _focusLogBuffer.splice(0);
  fetch("/api/focus-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries }),
  }).catch(() => {});
}
function _getAgentName(el) {
  return el?.closest?.(".agent-card")?.querySelector?.(".agent-name")?.textContent || "";
}
function _focusLog(event, detail, extra) {
  const active = document.activeElement;
  const activeDesc = active ? (active.id || active.className?.split?.(" ")?.[0] || active.tagName) : "null";
  const agentName = _getAgentName(active);
  _focusLogBuffer.push({
    ts: Date.now(),
    event,
    active: agentName ? `${activeDesc}[${agentName}]` : activeDesc,
    related: extra?.related || "",
    guard: extra?.guard || "",
    detail: detail || "",
  });
  if (!_focusLogTimer) _focusLogTimer = setTimeout(() => { _focusLogTimer = null; _flushFocusLog(); }, 500);
}

// Log ALL focusin/focusout on card textareas + body focus
document.addEventListener("focusin", (e) => {
  const isCardTextarea = e.target.matches?.(".card-input textarea");
  const isBody = e.target === document.body || e.target === document.documentElement;
  if (isCardTextarea || isBody) {
    const agent = _getAgentName(e.target);
    const relEl = e.relatedTarget;
    const relDesc = relEl ? (relEl.id || relEl.className?.split?.(" ")?.[0] || relEl.tagName) : "null";
    const relAgent = _getAgentName(relEl);
    const userRecent = (Date.now() - _userClickedAt) < 300;
    _focusLog("focusin", isBody ? "BODY-GOT-FOCUS" : `textarea[${agent}]`, {
      related: relAgent ? `${relDesc}[${relAgent}]` : relDesc,
      guard: userRecent ? "user-click" : "programmatic",
    });
  }
}, true);

document.addEventListener("focusout", (e) => {
  if (!e.target.matches?.(".card-input textarea")) return;
  const agent = _getAgentName(e.target);
  const relEl = e.relatedTarget;
  const relDesc = relEl ? (relEl.id || relEl.className?.split?.(" ")?.[0] || relEl.tagName) : "null";
  const relAgent = _getAgentName(relEl);
  const userRecent = (Date.now() - _userClickedAt) < 300;
  const expectedBlur = e.target._expectedBlur ? "expected" : "";
  _focusLog("focusout", `textarea[${agent}]`, {
    related: relAgent ? `${relDesc}[${relAgent}]` : relDesc,
    guard: [userRecent ? "user-click" : "programmatic", expectedBlur].filter(Boolean).join(","),
  });
}, true);

// Log when focus guard fires a restore
const _origFocusGuardLog = () => {};
// Patch: instrument the scrollTerminalToBottom and updateTerminal focus saves
const __focusLogInnerHTML = () => {
  _focusLog("innerHTML", "terminal innerHTML replaced — potential focus theft");
};

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

// --- Masonry/layout functions moved to js/cards.js ---
// --- Reusable instant tooltip system ---
// Shows a tooltip above any element on hover. No delay, positioned above target.
// Usage: showInstantTooltip(anchorEl, text)  /  hideInstantTooltip()
// Or attach permanently: attachInstantTooltip(el, textOrFn)
let _instantTooltip = null;
function showInstantTooltip(anchor, text) {
  hideInstantTooltip();
  _instantTooltip = document.createElement("div");
  _instantTooltip.className = "instant-tooltip";
  _instantTooltip.textContent = text;
  document.body.appendChild(_instantTooltip);
  const r = anchor.getBoundingClientRect();
  const tipW = _instantTooltip.offsetWidth;
  const tipH = _instantTooltip.offsetHeight;
  // Center above, clamp to viewport
  let left = r.left + r.width / 2 - tipW / 2;
  left = Math.max(4, Math.min(left, window.innerWidth - tipW - 4));
  _instantTooltip.style.left = left + "px";
  _instantTooltip.style.top = (r.top - tipH - 6) + "px";
}
function hideInstantTooltip() {
  if (_instantTooltip) { _instantTooltip.remove(); _instantTooltip = null; }
}
// Attach tooltip to an element. textOrFn can be a string or () => string|null (null = skip).
function attachInstantTooltip(el, textOrFn) {
  if (el._hasInstantTooltip) return;
  el._hasInstantTooltip = true;
  el.addEventListener("mouseenter", () => {
    const text = typeof textOrFn === "function" ? textOrFn() : textOrFn;
    if (!text) return;
    showInstantTooltip(el, text);
  });
  el.addEventListener("mouseleave", hideInstantTooltip);
}

let _nameTooltip = null; // kept for compat, but delegates to instant tooltip
function _checkNameTruncation(card) {
  const el = card.querySelector(".agent-name");
  if (!el) return;
  el.classList.toggle("truncated", el.scrollWidth > el.clientWidth);
  attachInstantTooltip(el, () => el.scrollWidth > el.clientWidth ? el.textContent : null);
}

// Recalc on window resize
window.addEventListener("resize", () => {
  scheduleMasonry();
  for (const agent of agents.values()) _checkNameTruncation(agent.card);
});

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
    PollingManager.clearByOwner(msg.agent);
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

// --- Card layout/order/persistence moved to js/cards.js ---

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

// --- Card reordering moved to js/cards.js ---

// --- WebSocket ---

let ws;
let reconnectTimer;
let _knownVersion = null; // tracks hot-reload version; if it changes on reconnect, reload
let _reloadingPage = false; // set true when reload is triggered — suppresses hotkeys during transition

// Build reload-persist state (used by hot-reload, server-restart, and manual restart)
// Merge live state with previously saved localStorage state —
// keeps drafts from the last auto-save if live textarea is now empty
// (handles race: user was typing, submit cleared field, restart fires instantly)
function _mergeReloadState(live) {
  try {
    const prev = JSON.parse(localStorage.getItem("ceo-reload-state") || "{}");
    if (prev.drafts && live.drafts) {
      for (const [name, text] of Object.entries(prev.drafts)) {
        if (!live.drafts[name] && text) {
          live.drafts[name] = text;
        }
      }
    }
  } catch {}
  return live;
}

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
      selectedSessionId: selectedSessionId || null,
      selectedSessionLabel: sessionSelectedLabel ? sessionSelectedLabel.textContent : null,
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
  window._ceoWs = ws;
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
    // On reconnect, trigger immediate reconciliation to catch missing agents
    if (_loaderDismissed && typeof _reconcileSessions === "function") {
      setTimeout(_reconcileSessions, 500);
    }
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
      const _rs = _mergeReloadState(buildReloadState());
      _focusLog("reload-save", `saving state: drafts=${Object.keys(_rs.drafts||{}).length}, focusedAgent=${_rs.focusedAgent||"none"}, cursor=${_rs.focusCursorStart}-${_rs.focusCursorEnd}, modal=${!!_rs.modal}`);
      _flushFocusLog();
      sessionStorage.setItem("ceo-reload-state", JSON.stringify(_rs));
      location.reload();
      return;
    }

    if (msg.type === "server-restarting") {
      if (_updateErrorShowing) return;
      _reloadingPage = true;
      const _rs2 = _mergeReloadState(buildReloadState());
      _focusLog("restart-save", `saving state: drafts=${Object.keys(_rs2.drafts||{}).length}, focusedAgent=${_rs2.focusedAgent||"none"}, cursor=${_rs2.focusCursorStart}-${_rs2.focusCursorEnd}, modal=${!!_rs2.modal}`);
      _flushFocusLog();
      sessionStorage.setItem("ceo-reload-state", JSON.stringify(_rs2));
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

    if (msg.type === "file-overlaps") {
      _updateOverlapBanners(msg.overlaps || []);
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
      // Process agents first, then terminals — so embedded terminal checks can find parent agents
      for (const s of msg.sessions) {
        if (s.type !== "terminal") {
          addAgentCard(s.name, s.workdir, s.branch, s.isWorktree, s.favorite, s.minimized);
          const a = agents.get(s.name);
          if (a) a.autoRename = s.autoRename || false;
        }
      }
      for (const s of msg.sessions) {
        if (s.type === "terminal") {
          // Skip embedded agent terminals — they're managed by the parent agent card,
          // not as standalone terminal cards. Without this check, WS reconnects would
          // spawn a standalone card for every closed embedded terminal.
          const parentName = s.name.endsWith("-term") ? s.name.slice(0, -5) : null;
          if (parentName && agents.has(parentName) && !agents.has(s.name)) continue;
          addTerminalCard(s.name, s.workdir);
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
      // Forward output to split view if open
      if (typeof SplitView !== "undefined" && SplitView.isOpen()) {
        SplitView.onOutput(msg.session, agent.terminal.innerHTML);
      }
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

    // Renaming indicator — shown as status badge with spinner
    if (msg.type === "renaming") {
      const agent = agents.get(msg.session);
      if (agent) {
        const badge = agent.card.querySelector(".status-badge");
        if (msg.renaming) {
          agent._prevBadgeClass = badge.className;
          agent._prevBadgeText = badge.textContent;
          badge.className = "status-badge renaming";
          badge.innerHTML = '<span class="rename-spin"></span>renaming';
          badge.style.display = "";
        } else if (agent._prevBadgeClass) {
          badge.className = agent._prevBadgeClass;
          badge.textContent = agent._prevBadgeText;
          delete agent._prevBadgeClass;
          delete agent._prevBadgeText;
        }
      }
    }

    // Server-initiated rename (manual or auto-rename)
    if (msg.type === "rename") {
      const agent = agents.get(msg.oldName);
      if (agent) {
        // Remove any ghost card that was created under the new name
        // (can happen if WS output arrived before the rename message)
        const ghost = agents.get(msg.newName);
        if (ghost && ghost !== agent) {
          ghost.card.remove();
          agents.delete(msg.newName);
        }
        // Restore badge state
        const badge = agent.card.querySelector(".status-badge");
        if (agent._prevBadgeClass) {
          badge.className = agent._prevBadgeClass;
          badge.textContent = agent._prevBadgeText;
          delete agent._prevBadgeClass;
          delete agent._prevBadgeText;
        }
        agents.delete(msg.oldName);
        agents.set(msg.newName, agent);
        agent.card.querySelector(".agent-name").textContent = msg.newName;
        requestAnimationFrame(() => _checkNameTruncation(agent.card));
        if (agent._setName) agent._setName(msg.newName);
        for (const key of [LAYOUT_KEY_DESKTOP, LAYOUT_KEY_MOBILE]) {
          try {
            const layouts = JSON.parse(localStorage.getItem(key)) || {};
            if (layouts[msg.oldName]) {
              layouts[msg.newName] = layouts[msg.oldName];
              delete layouts[msg.oldName];
              localStorage.setItem(key, JSON.stringify(layouts));
            }
          } catch {}
        }
      }
      // else: initiating client already renamed locally — nothing to do
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
    PollingManager.registerTimeout(`refresh-${session}-${ms}`, () => requestRefresh(session), ms, session);
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
              <button class="more-menu-item" data-action="toggle-auto-rename">Enable Auto-Rename</button>
              <button class="more-menu-item" data-action="rename-now">Rename Now</button>
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
          <button class="kill-btn" tabindex="0">&times;</button>
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
      saveCardOrder();
    } catch {}
  });

  // More menu (... button)
  moreBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = moreMenu.classList.toggle("visible");
    if (isOpen) {
      // Update auto-rename toggle label
      const agent = agents.get(name);
      const arBtn = moreMenu.querySelector('[data-action="toggle-auto-rename"]');
      if (arBtn && agent) arBtn.textContent = agent.autoRename ? "Disable Auto-Rename" : "Enable Auto-Rename";
      // Hide "View Diff" if no uncommitted changes
      const diffBtn = moreMenu.querySelector('[data-action="view-diff"]');
      if (diffBtn) {
        diffBtn.style.display = "none";
        fetch(`/api/sessions/${encodeURIComponent(name)}/diff`).then(r => r.json()).then(d => {
          if (d.hasDiff) diffBtn.style.display = "";
        }).catch(() => {});
      }
      // Focus first visible item for keyboard nav
      const firstItem = moreMenu.querySelector(".more-menu-item:not([style*='display: none'])");
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
          requestAnimationFrame(() => _checkNameTruncation(card));
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

    if (action === "toggle-auto-rename") {
      const agent = agents.get(name);
      const newVal = !agent?.autoRename;
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(name)}/auto-rename`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: newVal }),
        });
        if (res.ok) {
          if (agent) agent.autoRename = newVal;
          item.textContent = newVal ? "Disable Auto-Rename" : "Enable Auto-Rename";
        }
      } catch {}
      return;
    }

    if (action === "rename-now") {
      try {
        await fetch(`/api/sessions/${encodeURIComponent(name)}/queue-rename`, { method: "POST" });
      } catch {}
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

  // Fire agent — long-press kill button to activate fire mode
  // Hold 800ms → growing/shaking animation, release → stable "FIRE!" button, click again → modal
  let fireTimer = null;
  let fireActive = false;   // "FIRE!" button showing, waiting for deliberate click
  let fireHolding = false;  // currently holding (growing/shaking animation plays)
  let fireResetTimer = null;
  let skipNextClick = false; // skip the click event from the mouseup that ends the hold
  const FIRE_TOOLTIP = "Fire this agent \u2014 it writes a lesson to fired.md so future agents learn from the mistake";
  // Instant tooltip on the kill/fire button — text changes based on state
  killBtn.removeAttribute("title");
  attachInstantTooltip(killBtn, () => {
    if (fireActive) return FIRE_TOOLTIP;
    return null;
  });
  killBtn.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || fireActive) return;
    fireHolding = false;
    clearTimeout(fireResetTimer);
    fireTimer = setTimeout(() => {
      fireHolding = true;
      killBtn.classList.add("fire-holding");
      killBtn.classList.remove("armed");
      killArmed = false;
      clearTimeout(killTimer);
      killBtn.textContent = "FIRE!";
      hideInstantTooltip();
    }, 800);
  });
  killBtn.addEventListener("mouseup", () => {
    clearTimeout(fireTimer);
    if (fireHolding) {
      // Finished hold — transition from shaking to stable fire button
      fireHolding = false;
      killBtn.classList.remove("fire-holding");
      killBtn.classList.add("fire-mode");
      fireActive = true;
      skipNextClick = true; // don't open modal on this mouseup's click
      // If click event doesn't fire (long-press suppression), auto-clear the flag
      setTimeout(() => { skipNextClick = false; }, 100);
      // Auto-reset after 5s if not clicked
      fireResetTimer = PollingManager.registerTimeout(`fire-reset-${name}`, () => {
        fireActive = false;
        killBtn.classList.remove("fire-mode");
        killBtn.innerHTML = "\u00d7";
      }, 5000, name);
    }
  });
  killBtn.addEventListener("mouseleave", () => {
    clearTimeout(fireTimer);
    if (fireHolding) {
      fireHolding = false;
      killBtn.classList.remove("fire-holding");
      killBtn.innerHTML = "\u00d7";
    }
  });

  // Kill agent — favorites require confirm(), non-favorites use double-click arm pattern
  let killArmed = false;
  let killTimer = null;
  const doKill = async (cleanWorktree = false) => {
    PollingManager.clearByOwner(name);
    const qs = cleanWorktree ? "?cleanWorktree=true" : "";
    await fetch(`/api/sessions/${name}${qs}`, { method: "DELETE" });
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

  const tryKill = async () => {
    // Check if agent is in a worktree
    const branchEl = card.querySelector(".branch-info:not(.agent-term-branch)");
    const isWorktree = branchEl?.classList.contains("worktree");
    const branchName = branchEl?.textContent?.replace(/^worktree:\s*/, "") || "";

    if (isWorktree && branchName) {
      // Show worktree cleanup modal
      const overlay = document.getElementById("worktree-cleanup-overlay");
      const pathEl = document.getElementById("worktree-cleanup-path");
      const agentData = agents.get(name);
      pathEl.textContent = agentData?.workdir || branchName;
      overlay.classList.remove("hidden");

      // Wire up buttons (one-shot listeners)
      const cancelBtn = document.getElementById("worktree-cleanup-cancel");
      const keepBtn = document.getElementById("worktree-cleanup-keep");
      const removeBtn = document.getElementById("worktree-cleanup-remove");
      const cleanup = () => {
        overlay.classList.add("hidden");
        cancelBtn.replaceWith(cancelBtn.cloneNode(true));
        keepBtn.replaceWith(keepBtn.cloneNode(true));
        removeBtn.replaceWith(removeBtn.cloneNode(true));
      };
      document.getElementById("worktree-cleanup-cancel").addEventListener("click", () => { cleanup(); });
      document.getElementById("worktree-cleanup-keep").addEventListener("click", async () => { cleanup(); await doKill(false); });
      document.getElementById("worktree-cleanup-remove").addEventListener("click", async () => { cleanup(); await doKill(true); });
      // Close on backdrop click
      const backdropHandler = (e) => { if (e.target === overlay) { cleanup(); } };
      overlay.addEventListener("click", backdropHandler, { once: true });
      return;
    }

    await doKill();
  };

  killBtn.addEventListener("click", async () => {
    // Skip the click that fires right after the mouseup that ended the hold
    if (skipNextClick) { skipNextClick = false; return; }
    // Fire mode — user clicked the "FIRE!" button after holding
    if (fireActive) {
      fireActive = false;
      clearTimeout(fireResetTimer);
      killBtn.classList.remove("fire-mode");
      killBtn.innerHTML = "\u00d7";
      // Show fire modal
      const overlay = document.getElementById("fire-overlay");
      const reasonEl = document.getElementById("fire-reason");
      const cancelBtn = document.getElementById("fire-cancel");
      const confirmBtn = document.getElementById("fire-confirm");
      reasonEl.value = "";
      overlay.classList.remove("hidden");
      reasonEl.focus();
      const cleanup = () => {
        overlay.classList.add("hidden");
        cancelBtn.replaceWith(cancelBtn.cloneNode(true));
        confirmBtn.replaceWith(confirmBtn.cloneNode(true));
      };
      document.getElementById("fire-cancel").addEventListener("click", () => { cleanup(); }, { once: true });
      document.getElementById("fire-confirm").addEventListener("click", async () => {
        const reason = reasonEl.value.trim();
        cleanup();
        PollingManager.clearByOwner(name);
        // Remove card immediately — agent runs in background
        try {
          await fetch(`/api/sessions/${encodeURIComponent(name)}/fire`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reason: reason || "" }),
          });
        } catch {}
        // Clean up embedded terminal if exists
        const agEntry = agents.get(name);
        if (agEntry?._termName) {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "terminal-unsubscribe", session: agEntry._termName }));
          }
          if (agEntry._termXterm) { try { agEntry._termXterm.dispose(); } catch {} }
          if (agEntry._termResizeObserver) { try { agEntry._termResizeObserver.disconnect(); } catch {} }
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
      }, { once: true });
      // Close on backdrop click
      overlay.addEventListener("click", (e) => { if (e.target === overlay) cleanup(); }, { once: true });
      return;
    }
    // Favorites: confirm dialog instead of double-click
    if (card.classList.contains("favorited")) {
      if (!confirm(`Kill favorite agent "${name}"? This agent is protected.`)) return;
      await tryKill();
      return;
    }
    // Non-favorites: double-click arm pattern
    if (!killArmed) {
      killArmed = true;
      killBtn.classList.add("armed");
      killBtn.textContent = "KILL";
      killTimer = PollingManager.registerTimeout(`kill-arm-${name}`, () => {
        killArmed = false;
        killBtn.classList.remove("armed");
        killBtn.innerHTML = "\u00d7";
      }, 2000, name);
      return;
    }
    clearTimeout(killTimer);
    await tryKill();
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
    if (_nameTooltip) { _nameTooltip.remove(); _nameTooltip = null; }
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
  agents.set(name, { card, terminal, status: "working", workdir, autoRename: false, _waitGen: 0, pendingAttachments, pasteState, _setName(n) { name = n; } });
  // Persist new card in saved order (appended at end by saveCardOrder)
  saveCardOrder();
  updateEmptyState();
  scheduleMasonry();
  requestAnimationFrame(() => _checkNameTruncation(card));

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
  cancelMasonry();
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
        cancelMasonry();
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
  cancelMasonry();
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
  saveCardOrder();

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
    PollingManager.clearByOwner(name);
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
    const agent = _getAgentName(active);
    _focusLog("scroll-restore", `scrollTerminalToBottom stole focus from textarea[${agent}]`, { guard: "scrollToBottom" });
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
  // Fix dark backgrounds from ANSI output (user-typed messages & TUI selection highlights)
  // Replaces dark gray backgrounds with a subtle accent tint, and ensures text is visible
  html = html.replace(/background-color:rgb\((\d+),(\d+),(\d+)\)/g, (m, r, g, b) => {
    r = +r; g = +g; b = +b;
    // Dark gray backgrounds (user-typed messages) → subtle accent tint
    if (r === g && g === b && r >= 30 && r <= 80) return "background-color:var(--accent-subtle)";
    // Light/white backgrounds from reverse video (TUI selection) → stronger accent highlight
    if (r === g && g === b && r >= 180) return "background-color:var(--accent-glow)";
    return m;
  });
  // Fix TUI selection highlights: Ink uses reverse video (\e[7m) which ansi_up renders
  // as dark foreground + light background spans. Replace dark foreground colors inside
  // spans that also have a background-color, so text stays visible.
  html = html.replace(/<span style="((?:[^"]*background-color:[^"]+))">([^<]*)<\/span>/g, (m, style, text) => {
    // If span has both a dark foreground and any background, fix the foreground
    const hasBg = /background-color:/.test(style);
    if (!hasBg) return m;
    const fgMatch = style.match(/^color:rgb\((\d+),(\d+),(\d+)\)/);
    if (fgMatch) {
      const fr = +fgMatch[1], fg = +fgMatch[2], fb = +fgMatch[3];
      // Dark foreground on a colored background = invisible text from reverse video
      if (fr < 100 && fg < 100 && fb < 100) {
        const fixedStyle = style.replace(/^color:rgb\(\d+,\d+,\d+\)/, "color:var(--text)");
        return `<span style="${fixedStyle}">${text}</span>`;
      }
    }
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
    const agent = _getAgentName(_preInnerFocused);
    const nowActive = document.activeElement;
    const nowDesc = nowActive ? (nowActive.id || nowActive.className?.split?.(" ")?.[0] || nowActive.tagName) : "null";
    _focusLog("innerHTML-restore", `innerHTML stole focus from textarea[${agent}], now on ${nowDesc}`, { guard: "updateTerminal" });
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

  const prevStatus = agent.status;
  agent.status = status;

  // Alert in game arcade when agent finishes working (ready for your next prompt)
  const doneWorking = prevStatus === "working" && status !== "working";
  if (doneWorking && _activeGame) {
    const alertLabel = status === "waiting" ? "needs input" : status === "asking" ? "has a question" : "ready for you";
    _showArcadeAlert(name, alertLabel);
  }

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
  if (n >= 1_000_000) return (n / 1_000_000).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "M";
  return n.toLocaleString("en-US");
}

function usageToDollars(u) {
  return ((u.input || 0) * TOKEN_PRICES.input
    + (u.output || 0) * TOKEN_PRICES.output
    + (u.cacheCreation || 0) * TOKEN_PRICES.cacheCreation
    + (u.cacheRead || 0) * TOKEN_PRICES.cacheRead) / 1_000_000;
}

function formatDollars(n) {
  if (n >= 100) return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 10) return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  if (n >= 1) return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return "$" + n.toFixed(4);
}

function formatDollarsCompact(n) {
  if (n >= 100) return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return "$" + n.toFixed(2);
}

function sumUsage(u) {
  // Only count input + output tokens — cache reads/writes are context caching, not real usage
  return (u.input || 0) + (u.output || 0);
}

function formatUsageValue(u) {
  if (_tokenShowDollars) return formatDollars(usageToDollars(u));
  return formatTokenCount(sumUsage(u));
}

const TROLL_DIGITS = "0123456789";

function rollTokenValue(el, newText) {
  if (!el) return;
  const oldText = el._tokenText || "";
  el._tokenText = newText;
  if (oldText === newText && el._trollBuilt) return;

  // Right-align: pad shorter string on the left
  const maxLen = Math.max(oldText.length, newText.length);
  const oldPad = oldText.padStart(maxLen);
  const newPad = newText.padStart(maxLen);

  // Check if we can reuse existing DOM (same length, already built)
  if (el._trollBuilt && el._trollLen === maxLen) {
    // Just update positions
    const slots = el.querySelectorAll(".troll");
    for (let i = 0; i < maxLen; i++) {
      const ch = newPad[i];
      const slot = slots[i];
      if (!slot) continue;
      const strip = slot.querySelector(".troll-strip");
      if (!strip) continue;
      const di = TROLL_DIGITS.indexOf(ch);
      if (di >= 0 && slot._isDigit) {
        // Slide digit strip
        strip.style.transform = `translateY(${-di * 1.2}em)`;
      } else if (ch !== slot._ch) {
        // Non-digit changed — rebuild this slot
        strip.innerHTML = "";
        const s = document.createElement("span");
        s.textContent = ch === " " ? "\u00A0" : ch;
        strip.appendChild(s);
        strip.style.transform = "";
        slot._isDigit = false;
      }
      slot._ch = ch;
    }
    return;
  }

  // Full rebuild
  el.innerHTML = "";
  el._trollBuilt = true;
  el._trollLen = maxLen;

  for (let i = 0; i < maxLen; i++) {
    const ch = newPad[i];
    const slot = document.createElement("span");
    slot.className = "troll";
    slot._ch = ch;

    const strip = document.createElement("span");
    strip.className = "troll-strip";

    const di = TROLL_DIGITS.indexOf(ch);
    if (di >= 0) {
      // Build a 0-9 column
      slot._isDigit = true;
      for (let d = 0; d <= 9; d++) {
        const s = document.createElement("span");
        s.textContent = String(d);
        strip.appendChild(s);
      }
      // No transition on first render — snap to position
      strip.style.transform = `translateY(${-di * 1.2}em)`;
      // Enable transition after first paint
      requestAnimationFrame(() => {
        strip.style.transition = "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)";
      });
    } else {
      // Static character ($, ., k, M, etc.)
      slot._isDigit = false;
      const s = document.createElement("span");
      s.textContent = ch === " " ? "\u00A0" : ch;
      strip.appendChild(s);
    }

    slot.appendChild(strip);
    el.appendChild(slot);
  }
}

function usageTooltip(label, u) {
  const tokens = `In: ${formatTokenCount(u.input || 0)} | Out: ${formatTokenCount(u.output || 0)} | Cache write: ${formatTokenCount(u.cacheCreation || 0)} | Cache read: ${formatTokenCount(u.cacheRead || 0)}`;
  const dollars = formatDollars(usageToDollars(u));
  return `${label} — ${tokens}\nCost: ${dollars}`;
}

function _updateOverlapBanners(overlaps) {
  // Clear all existing banners
  document.querySelectorAll(".overlap-banner").forEach(b => b.remove());

  if (overlaps.length === 0) return;

  // Build a map: agentName -> [{ file, otherAgents }]
  const agentOverlaps = new Map();
  for (const { file, agents: overlapAgents } of overlaps) {
    for (const name of overlapAgents) {
      if (!agentOverlaps.has(name)) agentOverlaps.set(name, []);
      const others = overlapAgents.filter(a => a !== name);
      agentOverlaps.get(name).push({ file, others });
    }
  }

  // Render banners on affected cards
  for (const [name, files] of agentOverlaps) {
    const agent = agents.get(name);
    if (!agent?.card) continue;

    const banner = document.createElement("div");
    banner.className = "overlap-banner";

    const fileCount = files.length;
    const otherAgents = [...new Set(files.flatMap(f => f.others))];
    banner.innerHTML = `<span class="overlap-banner-icon">\u26A0</span> ` +
      `${fileCount} shared file${fileCount > 1 ? "s" : ""} with ${otherAgents.join(", ")}`;
    banner.title = files.map(f => f.file.split("/").pop() + " (" + f.others.join(", ") + ")").join("\n");

    // Insert after the card header (before terminal)
    const header = agent.card.querySelector(".card-header");
    if (header && header.nextSibling) {
      header.parentNode.insertBefore(banner, header.nextSibling);
    } else {
      agent.card.prepend(banner);
    }
  }
}

function updateTokenUsageDisplay(msg) {
  if (!msg) return;
  // Server sends { type: "token-usage", usage: { agents, daily, ...perAgent } }
  const payload = msg.usage || msg;
  const agentData = payload.agents || {};
  const dailyData = payload.daily || {};

  // Save to localStorage — full replace (server sends complete state)
  const stored = { agents: agentData, daily: dailyData };
  localStorage.setItem("ceo-token-usage", JSON.stringify(stored));

  updateHeaderTokenTotals(stored);

  // Update budget progress bar if budget info is present
  if (payload._budgets) _updateBudgetBar(payload._budgets);
}

function _updateBudgetBar(budgetInfo) {
  const bar = document.getElementById("budget-progress-bar");
  const barFill = document.getElementById("budget-progress-fill");
  const barLabel = document.getElementById("budget-progress-label");
  if (!bar || !budgetInfo?.config?.dailyDollars) {
    if (bar) bar.style.display = "none";
    return;
  }

  const { dailyDollars, warningPercent = 80 } = budgetInfo.config;
  const spent = budgetInfo.todayDollars || 0;
  const pct = Math.min(100, (spent / dailyDollars) * 100);

  bar.style.display = "";
  bar.title = `Daily budget: $${spent.toFixed(2)} of $${dailyDollars} spent (${pct.toFixed(1)}%)`;
  barFill.style.width = pct + "%";
  barLabel.textContent = `$${spent.toFixed(2)} / $${dailyDollars}`;

  // Color: green < warning, yellow at warning, red at 100%
  if (pct >= 100) {
    barFill.style.background = "#ef4444";
  } else if (pct >= warningPercent) {
    barFill.style.background = "#fbbf24";
  } else {
    barFill.style.background = "var(--accent, #4ade80)";
  }
}

let _lastKnownAllTimeTokens = 0;
let _lastKnownMonthTokens = 0;
let _lastKnownTodayTokens = 0;

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

  // Store dollar values for the ticker
  _dollarSnapshots.prev = _dollarSnapshots.current || null;
  _dollarSnapshots.current = {
    today: usageToDollars(todayUsage),
    month: usageToDollars(monthUsage),
    allTime: usageToDollars(allTime),
    time: Date.now(),
  };

  // Store tooltips
  if (elTotal) elTotal.title = usageTooltip("All time", allTime);
  if (elMonth) elMonth.title = usageTooltip("This month", monthUsage);
  if (elToday) elToday.title = usageTooltip("Today", todayUsage);

  if (_tokenShowDollars) {
    // In dollar mode, the ticker handles rendering
    _startDollarTicker();
  } else {
    _stopDollarTicker();
    if (elTotal) { rollTokenValue(elTotal, allTimeSum > 0 ? formatTokenCount(sumUsage(allTime)) : "—"); }
    if (elMonth) { rollTokenValue(elMonth, sumUsage(monthUsage) > 0 ? formatTokenCount(sumUsage(monthUsage)) : "—"); }
    if (elToday) { rollTokenValue(elToday, sumUsage(todayUsage) > 0 ? formatTokenCount(sumUsage(todayUsage)) : "—"); }
  }

  const wrap = document.getElementById("token-usage-wrap");
  if (wrap) wrap.style.display = allTimeSum > 0 ? "" : "none";

  // Check for milestone celebrations
  const todaySum = sumUsage(todayUsage);
  const monthSum = sumUsage(monthUsage);
  if (todaySum > 0) checkMilestone(todaySum, "today");
  if (monthSum > 0) checkMilestone(monthSum, "month");
  if (allTimeSum > 0) checkMilestone(allTimeSum, "alltime");
}

// --- Dollar ticker: interpolates between server updates ---
const _dollarSnapshots = { prev: null, current: null };
let _dollarTickerInterval = null;

function _getDollarRate() {
  const { prev, current } = _dollarSnapshots;
  if (!prev || !current || current.time === prev.time) return { today: 0, month: 0, allTime: 0 };
  const dt = (current.time - prev.time) / 1000; // seconds
  return {
    today: (current.today - prev.today) / dt,
    month: (current.month - prev.month) / dt,
    allTime: (current.allTime - prev.allTime) / dt,
  };
}

function _tickDollars() {
  const { current } = _dollarSnapshots;
  if (!current) return;
  const rate = _getDollarRate();
  const elapsed = (Date.now() - current.time) / 1000;

  const today = current.today + rate.today * elapsed;
  const month = current.month + rate.month * elapsed;
  const allTime = current.allTime + rate.allTime * elapsed;

  const elTotal = document.getElementById("token-usage-total");
  const elMonth = document.getElementById("token-usage-month");
  const elToday = document.getElementById("token-usage-today");

  if (elToday) rollTokenValue(elToday, today > 0 ? formatDollars(today) : "—");
  if (elMonth) rollTokenValue(elMonth, month > 0 ? formatDollars(month) : "—");
  if (elTotal) rollTokenValue(elTotal, allTime > 0 ? formatDollars(allTime) : "—");
}

function _startDollarTicker() {
  if (_dollarTickerInterval) return;
  _tickDollars(); // immediate first tick
  _dollarTickerInterval = setInterval(_tickDollars, 500);
}

function _stopDollarTicker() {
  if (_dollarTickerInterval) {
    clearInterval(_dollarTickerInterval);
    _dollarTickerInterval = null;
  }
  // Clear stored text so rollTokenValue works fresh after switching back
  for (const id of ["token-usage-total", "token-usage-month", "token-usage-today"]) {
    const el = document.getElementById(id);
    if (el) el._tokenText = null;
  }
}

// Click to toggle between tokens and dollars
document.getElementById("token-usage-wrap")?.addEventListener("click", () => {
  _tokenShowDollars = !_tokenShowDollars;
  localStorage.setItem("ceo-token-show-dollars", _tokenShowDollars);
  if (!_tokenShowDollars) _stopDollarTicker();
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
  PollingManager.register("doc-polling", async () => {
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

let _helpOverlay = null;
function _toggleHelpOverlay() {
  if (_helpOverlay && !_helpOverlay.classList.contains("hidden")) {
    _helpOverlay.classList.add("hidden");
    return;
  }
  if (!_helpOverlay) {
    _helpOverlay = document.createElement("div");
    _helpOverlay.id = "help-overlay";
    _helpOverlay.className = "command-palette-overlay";
    const K = (key, desc) => `<kbd style="background:rgba(255,255,255,0.06);padding:2px 8px;border-radius:4px;font-size:11px;font-family:var(--font-mono,monospace);text-align:center">${key}</kbd><span>${desc}</span>`;
    _helpOverlay.innerHTML = `
      <div class="command-palette" style="max-width:480px">
        <div style="padding:20px 24px 8px;font-size:16px;font-weight:600">Keyboard Shortcuts</div>
        <div style="padding:8px 24px 20px;font-size:13px;line-height:2.2">
          <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 16px;align-items:center">
            ${K("Cmd+K", "Command Palette")}
            ${K("Cmd+F", "Search Agent Output")}
            ${K("N", "New Agent")}
            ${K("T", "Terminal")}
            ${K("F", "Files")}
            ${K("S", "Settings")}
            ${K("B", "Bookmarks")}
            ${K("D", "Todos")}
            ${K("G", "Dependency Graph")}
            ${K("L", "Activity Timeline")}
            ${K("C", "CEO Prompt")}
            ${K("R", "Restart")}
            ${K("!", "Bug Report")}
            ${K("/", "Focus First Card")}
            ${K("1-9", "Focus Card N")}
            ${K("?", "This Help")}
            ${K("Esc", "Close / Back")}
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(_helpOverlay);
    _helpOverlay.addEventListener("mousedown", (e) => {
      if (e.target === _helpOverlay) _helpOverlay.classList.add("hidden");
    });
  }
  _helpOverlay.classList.remove("hidden");
}

document.addEventListener("keydown", (e) => {
  let inInput = e.target.matches("input, textarea, [contenteditable]");

  // Cmd+F / Ctrl+F: search agent output (when focused on a card)
  if ((e.metaKey || e.ctrlKey) && e.key === "f") {
    const card = e.target.closest(".agent-card");
    if (card && typeof OutputSearch !== "undefined") {
      e.preventDefault();
      OutputSearch.openForCard(card);
      return;
    }
    // Let browser Cmd+F through if not on a card
  }

  // Cmd+K / Ctrl+K: Command Palette
  if ((e.metaKey || e.ctrlKey) && e.key === "k") {
    e.preventDefault();
    if (typeof CommandPalette !== "undefined") {
      CommandPalette.isOpen() ? CommandPalette.close() : CommandPalette.open();
    }
    return;
  }

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
        const agent = _getAgentName(ta);
        _focusLog("keydown-redirect", `key="${e.key}" redirected to textarea[${agent}] (focus was on body)`, { guard: "hotkey-guard" });
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

  // Escape: layered dismiss (split view → fullscreen → modals → file editor → files panel → shell → agent tmux)
  if (e.key === "Escape") {
    if (typeof SplitView !== "undefined" && SplitView.isOpen()) {
      e.preventDefault();
      SplitView.close();
      return;
    }
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
    if (_arcadeOverlay && !_arcadeOverlay.classList.contains("hidden")) {
      e.preventDefault();
      _closeArcade();
      return;
    }
    if (_helpOverlay && !_helpOverlay.classList.contains("hidden")) {
      e.preventDefault();
      _helpOverlay.classList.add("hidden");
      return;
    }
    if (typeof CommandPalette !== "undefined" && CommandPalette.isOpen()) {
      e.preventDefault();
      CommandPalette.close();
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
    // Activity timeline panel
    if (typeof ActivityTimeline !== "undefined" && ActivityTimeline.isOpen()) {
      e.preventDefault();
      ActivityTimeline.close();
      return;
    }
    // Dependency graph panel
    if (typeof DependencyGraph !== "undefined" && DependencyGraph.isOpen()) {
      e.preventDefault();
      DependencyGraph.close();
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
    // If typing in a card input, just return
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
  if (key === "g" && !inInput) {
    e.preventDefault();
    if (typeof DependencyGraph !== "undefined") DependencyGraph.toggle();
    return;
  }
  if (key === "l" && !inInput) {
    e.preventDefault();
    if (typeof ActivityTimeline !== "undefined") ActivityTimeline.toggle();
    return;
  }

  // Remaining hotkeys — skip if typing in any input
  if (inInput) return;

  if (key === "?") {
    e.preventDefault();
    _toggleHelpOverlay();
    return;
  }

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

// --- Games Arcade ---
// To add a game: put the HTML file in public/, add an entry here
const _games = [
  { id: "block-drop", name: "Block Drop", subtitle: "ULTRA CHAOS", src: "game.html", icon: "\uD83C\uDFAE", color: "#e94560" },
];
let _arcadeOverlay = null;
let _arcadeModal = null;
let _activeGame = null; // { id, game, iframe }
let _pauseLayer = null; // overlay that sits on top of iframe when paused

function _openArcade() {
  if (!_arcadeOverlay) {
    _arcadeOverlay = document.createElement("div");
    _arcadeOverlay.id = "arcade-overlay";
    _arcadeOverlay.className = "command-palette-overlay";
    _arcadeModal = document.createElement("div");
    _arcadeModal.className = "game-modal";
    _arcadeOverlay.appendChild(_arcadeModal);
    document.body.appendChild(_arcadeOverlay);
    _arcadeOverlay.addEventListener("mousedown", (e) => {
      if (e.target === _arcadeOverlay) _closeArcade();
    });
  }
  _arcadeOverlay.classList.remove("hidden");
  if (_activeGame) {
    // Show the modal with iframe + pause layer on top
    _arcadeModal.style.height = "";
    _arcadeModal.style.maxHeight = "";
    _showPauseLayer();
  } else {
    _arcadeShowPicker();
  }
}

function _closeArcade() {
  if (_activeGame) {
    try { _activeGame.iframe.contentWindow?.postMessage("ceo-pause", "*"); } catch {}
  }
  _arcadeOverlay?.classList.add("hidden");
}

function _arcadeShowPicker() {
  // Destroy any active game
  _activeGame = null;
  if (_pauseLayer) { _pauseLayer.remove(); _pauseLayer = null; }
  _arcadeModal.style.height = "auto";
  _arcadeModal.style.maxHeight = "85vh";
  _arcadeModal.innerHTML = `
    <div class="game-modal-header">
      <span>Arcade</span>
      <button class="game-modal-close">&times;</button>
    </div>
    <div class="game-picker">${_games.map(g => `
      <div class="game-app" data-game="${g.id}">
        <div class="game-app-icon" style="background:${g.color}">${g.icon}</div>
        <div class="game-app-name">${g.name}</div>
        <div class="game-app-sub">${g.subtitle}</div>
      </div>
    `).join("")}</div>
  `;
  _arcadeModal.querySelector(".game-modal-close").addEventListener("click", _closeArcade);
  _arcadeModal.querySelectorAll(".game-app").forEach(el => {
    el.addEventListener("click", () => {
      const game = _games.find(g => g.id === el.dataset.game);
      if (game) _arcadeLaunch(game);
    });
  });
}

function _arcadeLaunch(game) {
  _arcadeModal.style.height = "";
  _arcadeModal.style.maxHeight = "";
  _arcadeModal.innerHTML = `
    <div class="game-modal-header">
      <span>${game.name} — ${game.subtitle}</span>
      <button class="game-modal-close" title="Pause & minimize">&times;</button>
    </div>
    <iframe src="${game.src}" class="game-iframe"></iframe>
  `;
  const iframe = _arcadeModal.querySelector("iframe");
  _activeGame = { id: game.id, game, iframe };
  if (_pauseLayer) { _pauseLayer.remove(); _pauseLayer = null; }
  _arcadeModal.querySelector(".game-modal-close").addEventListener("click", _closeArcade);
  // Focus iframe once loaded so keyboard controls work immediately
  iframe.addEventListener("load", () => { iframe.focus(); });
}

function _showPauseLayer() {
  if (!_activeGame) return;
  const g = _activeGame.game;
  // Create/update pause layer that sits ON TOP of the iframe
  if (!_pauseLayer) {
    _pauseLayer = document.createElement("div");
    _pauseLayer.className = "game-pause-layer";
  }
  _pauseLayer.innerHTML = `
    <div class="game-app-icon" style="background:${g.color};width:64px;height:64px;font-size:32px;border-radius:16px;display:flex;align-items:center;justify-content:center;margin:0 auto 16px">${g.icon}</div>
    <div style="font-size:24px;font-weight:700;margin-bottom:4px;color:#eee">PAUSED</div>
    <div style="font-size:12px;color:#666;margin-bottom:20px">${g.name} — ${g.subtitle}</div>
    <button class="game-resume-btn">Resume Game</button>
    <button class="game-quit-btn">Quit to Arcade</button>
  `;
  _arcadeModal.appendChild(_pauseLayer);
  // Update header
  const headerSpan = _arcadeModal.querySelector(".game-modal-header span");
  if (headerSpan) headerSpan.textContent = g.name + " — PAUSED";
  _pauseLayer.querySelector(".game-resume-btn").addEventListener("click", () => {
    _pauseLayer.remove();
    const headerSpan2 = _arcadeModal.querySelector(".game-modal-header span");
    if (headerSpan2) headerSpan2.textContent = g.name + " — " + g.subtitle;
    try { _activeGame.iframe.contentWindow?.postMessage("ceo-resume", "*"); } catch {}
    // Focus the iframe so keyboard controls (M for music, P for pause, etc.) work immediately
    setTimeout(() => { _activeGame?.iframe?.focus(); }, 50);
  });
  _pauseLayer.querySelector(".game-quit-btn").addEventListener("click", () => {
    _pauseLayer.remove();
    _pauseLayer = null;
    _arcadeShowPicker();
  });
}

// Alert banner when agent finishes working during gameplay
function _showArcadeAlert(agentName, label) {
  if (!_arcadeModal) return;
  // If arcade is hidden, pop it open so the user sees the alert
  if (_arcadeOverlay?.classList.contains("hidden")) {
    _arcadeOverlay.classList.remove("hidden");
  }
  // Remove previous alert if any
  _arcadeModal.querySelectorAll(".arcade-agent-alert").forEach(el => el.remove());
  const alert = document.createElement("div");
  alert.className = "arcade-agent-alert";
  alert.innerHTML = `<span class="arcade-alert-pulse"></span><strong>${agentName}</strong> ${label} <button class="arcade-alert-go">Go to agent</button>`;
  alert.querySelector(".arcade-alert-go").addEventListener("click", () => {
    _closeArcade();
    const agent = typeof agents !== "undefined" ? agents.get(agentName) : null;
    if (agent?.card) {
      agent.card.scrollIntoView({ behavior: "smooth", block: "center" });
      const inp = agent.card.querySelector(".card-input textarea");
      if (inp) inp.focus();
    }
  });
  _arcadeModal.appendChild(alert);
  // Auto-dismiss after 10s
  setTimeout(() => { if (alert.parentNode) alert.remove(); }, 10000);
}

document.getElementById("game-btn")?.addEventListener("click", _openArcade);

// --- Init ---

loadSlashCommands();
startDocPolling();
startTodoRefsPolling();
if (typeof CommandPalette !== "undefined") CommandPalette.registerBuiltinActions();
if (typeof CommandPalette !== "undefined" && typeof DependencyGraph !== "undefined") {
  CommandPalette.registerAction({
    id: "dep-graph", category: "Views", label: "Dependency Graph",
    keywords: "graph dependencies files overlap agents",
    icon: "\u25C9", hint: "G",
    handler: function() { DependencyGraph.toggle(); },
  });
}
if (typeof CommandPalette !== "undefined" && typeof ActivityTimeline !== "undefined") {
  CommandPalette.registerAction({
    id: "activity-timeline", category: "Views", label: "Activity Timeline",
    keywords: "timeline activity events log history",
    icon: "\u23F1", hint: "L",
    handler: function() { ActivityTimeline.toggle(); },
  });
}
if (typeof CommandPalette !== "undefined" && typeof SplitView !== "undefined") {
  CommandPalette.registerAction({
    id: "split-view", category: "Views", label: "Focus View",
    keywords: "split side by side compare focus agents",
    icon: "\u25A8",
    handler: () => SplitView.promptAndOpen(),
  });
}

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
  // Start session reconciliation — catches any loading failure
  _startSessionReconciliation();
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

// --- Session reconciliation ---
// Periodically re-fetches sessions to catch any loading failure.
// Runs every 3s for the first 30s after page load, then every 10s ongoing.
let _reconcileTimer = null;
function _startSessionReconciliation() {
  if (_reconcileTimer) return;
  _reconcileTimer = setInterval(_reconcileSessions, 3000);
  // After 30s, slow down to every 10s
  setTimeout(() => {
    if (_reconcileTimer) {
      clearInterval(_reconcileTimer);
      _reconcileTimer = setInterval(_reconcileSessions, 10000);
    }
  }, 30000);
}
function _reconcileSessions() {
  // Only reconcile when WS is open (server is reachable)
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  fetch("/api/sessions", { signal: AbortSignal.timeout(3000) })
    .then((r) => r.json())
    .then((sessions) => {
      if (!sessions || sessions.length === 0) return;
      let added = false;
      for (const s of sessions) {
        if (agents.has(s.name)) continue;
        added = true;
        try {
          if (s.type === "terminal") {
            addTerminalCard(s.name, s.workdir);
          } else {
            addAgentCard(s.name, s.workdir, s.branch, s.isWorktree, s.favorite, s.minimized);
          }
        } catch (e) {
          console.error("[reconcile] Failed to add card for", s.name, e);
        }
      }
      if (added) {
        console.log("[reconcile] Added missing agent cards");
        reorderCards();
        updateEmptyState();
        // Request fresh output for new cards
        if (ws && ws.readyState === WebSocket.OPEN) {
          for (const s of sessions) {
            if (!agents.get(s.name)?.terminal?._lastContent) {
              ws.send(JSON.stringify({ type: "request-refresh", session: s.name }));
            }
          }
        }
      }
    })
    .catch(() => {});
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
    _focusLog("reload-loaded", `found saved state: drafts=${Object.keys(_savedReloadState.drafts||{}).length}, focusedAgent=${_savedReloadState.focusedAgent||"none"}, modal=${!!_savedReloadState.modal}, cursor=${_savedReloadState.focusCursorStart}-${_savedReloadState.focusCursorEnd}`);
  }
} catch {}

// Save state on page hide (app kill, tab close, navigation away).
// pagehide fires reliably in WKWebView and mobile Safari; beforeunload does not.
window.addEventListener("pagehide", () => {
  try {
    const _ph = _mergeReloadState(buildReloadState());
    _focusLog("pagehide-save", `drafts=${Object.keys(_ph.drafts||{}).length}, focusedAgent=${_ph.focusedAgent||"none"}, cursor=${_ph.focusCursorStart}-${_ph.focusCursorEnd}`);
    _flushFocusLog();
    localStorage.setItem("ceo-reload-state", JSON.stringify(_ph));
  } catch {}
});

// Auto-save drafts every 1s so force-kills/restarts don't lose input
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
}, 1000);

// Immediate debounced save on any card textarea input (catches typing between auto-saves)
let _draftSaveTimer = null;
document.addEventListener("input", (e) => {
  if (!e.target.matches?.(".card-input textarea")) return;
  if (_draftSaveTimer) clearTimeout(_draftSaveTimer);
  _draftSaveTimer = setTimeout(() => {
    _draftSaveTimer = null;
    try { localStorage.setItem("ceo-reload-state", JSON.stringify(buildReloadState())); } catch {}
  }, 300);
}, true);

// Early restore: drafts + focus applied as soon as cards exist (before loader dismisses).
// This lets the user start typing immediately during load.
let _earlyStateApplied = false;
function _applyEarlyState(state) {
  if (_earlyStateApplied) return;
  _earlyStateApplied = true;
  _focusLog("reload-early", `restoring state: drafts=${Object.keys(state.drafts||{}).length}, focusedAgent=${state.focusedAgent||"none"}, focusedId=${state.focusedId||"none"}, cursor=${state.focusCursorStart}-${state.focusCursorEnd}`);
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
          _focusLog("reload-draft", `restored draft for [${name}]: ${text.length} chars`);
        }
      } else {
        _focusLog("reload-draft-miss", `agent [${name}] not found for draft restore`);
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
  let _scrolledCount = 0;
  for (const [name, agent] of agents) {
    if (agent.terminal) {
      agent.terminal._userScrolledUp = false;
      agent.terminal._forceScrollUntil = Date.now() + 5000;
      agent.terminal._wheelGraceUntil = Date.now() + 1500;
      scrollTerminalToBottom(agent.terminal);
      _scrolledCount++;
    }
  }
  _focusLog("reload-scroll", `force-scrolled ${_scrolledCount} terminals to bottom`);
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
    _focusLog("reload-modal", `restoring modal: name="${state.modal.name}", prompt=${(state.modal.prompt||"").length} chars, workdir=${state.modal.selectedWorkdirPath || "default"}`);
    modalOverlay.classList.remove("hidden");
    if (state.modal.selectedSessionId) {
      selectedSessionId = state.modal.selectedSessionId;
      // Restore the "Resuming" UI state — hide prompt, show selected info
      if (state.modal.selectedSessionLabel) {
        sessionSelectedLabel.textContent = state.modal.selectedSessionLabel;
      }
      sessionSelectedInfo.classList.remove("hidden");
      promptLabel.style.display = "none";
    }
    fetchClaudeSessions();
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
  function restoreFocus(el, source) {
    if (!el) return false;
    el.focus({ preventScroll: true });
    if (state.focusCursorStart != null && el.setSelectionRange) {
      try {
        const len = el.value?.length ?? 0;
        const wasNearEnd = state.focusCursorStart >= (state._savedTextLength || len) - 2;
        if (wasNearEnd) {
          el.setSelectionRange(len, len);
          _focusLog("reload-focus", `restored focus via ${source}, cursor snapped to end (${len})`, { guard: "restoreFocus" });
        } else {
          const start = Math.min(state.focusCursorStart, len);
          const end = Math.min(state.focusCursorEnd ?? start, len);
          el.setSelectionRange(start, end);
          _focusLog("reload-focus", `restored focus via ${source}, cursor at ${start}-${end} (len=${len})`, { guard: "restoreFocus" });
        }
      } catch {}
    } else {
      _focusLog("reload-focus", `restored focus via ${source}, no cursor to set`, { guard: "restoreFocus" });
    }
    return true;
  }
  if (state.focusedId) {
    const el = document.getElementById(state.focusedId);
    if (el && restoreFocus(el, `id:${state.focusedId}`)) return;
    _focusLog("reload-focus-miss", `focusedId=${state.focusedId} not found`);
  }
  if (state.focusedTodo) {
    let el = null;
    if (state.focusedTodo === "title") el = document.querySelector(".todo-title-input");
    else if (state.focusedTodo === "editor") el = document.querySelector(".todo-editor");
    else if (state.focusedTodo === "rich-editor") el = document.getElementById("todo-rich-editor");
    if (el && restoreFocus(el, `todo:${state.focusedTodo}`)) return;
  }
  if (state.focusedAgent) {
    const agent = agents.get(state.focusedAgent);
    if (agent) {
      const textarea = agent.card.querySelector(".card-input textarea");
      if (textarea && restoreFocus(textarea, `agent:${state.focusedAgent}`)) return;
    }
    _focusLog("reload-focus-miss", `focusedAgent=${state.focusedAgent} not found in agents map`);
  }
  if (state.focusedDocAgent) {
    const agent = agents.get(state.focusedDocAgent);
    if (agent) {
      const editArea = agent.card.querySelector(".agent-doc-edit-area");
      if (editArea && editArea.style.display !== "none" && restoreFocus(editArea, `doc:${state.focusedDocAgent}`)) return;
    }
  }
  _focusLog("reload-focus-miss", `no focus target matched (focusedAgent=${state.focusedAgent}, focusedId=${state.focusedId})`);
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


// ═══════════════════════════════════════════════════
// Milestone Celebration System (DOM-based, GPU-accelerated)
// ═══════════════════════════════════════════════════

const CONFETTI_COLORS = ["#ff6b6b","#ffd93d","#6bcb77","#4d96ff","#ff6eb4","#a855f7","#fb923c","#f472b6","#34d399"];
const MONEY_EMOJIS = ["💵", "💰", "💸", "🪙", "💲"];

const TOKEN_MILESTONES = [
  1_000,              // 1K
  5_000,              // 5K
  10_000,             // 10K
  50_000,             // 50K
  100_000,            // 100K
  500_000,            // 500K
  1_000_000,          // 1M
  5_000_000,          // 5M
  10_000_000,         // 10M
  25_000_000,         // 25M
  50_000_000,         // 50M
  100_000_000,        // 100M
  200_000_000,        // 200M
  500_000_000,        // 500M
  1_000_000_000,      // 1B
  2_000_000_000,      // 2B
  5_000_000_000,      // 5B
  10_000_000_000,     // 10B
  20_000_000_000,     // 20B
  50_000_000_000,     // 50B
  100_000_000_000,    // 100B
];

function getConfettiStyle() {
  return localStorage.getItem("ceo-confetti-style") || "auto";
}
function setConfettiStyle(id) {
  localStorage.setItem("ceo-confetti-style", id);
}
function _milestoneStorageKey(period) {
  if (period === "today") {
    const d = new Date();
    return `ceo-seen-milestones-today-${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  if (period === "month") {
    const d = new Date();
    return `ceo-seen-milestones-month-${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  }
  return "ceo-seen-milestones";
}
function getSeenMilestones(period) {
  try { return JSON.parse(localStorage.getItem(_milestoneStorageKey(period)) || "[]"); } catch { return []; }
}
function markMilestoneSeen(m, period) {
  const key = _milestoneStorageKey(period);
  const seen = getSeenMilestones(period);
  if (!seen.includes(m)) { seen.push(m); localStorage.setItem(key, JSON.stringify(seen)); }
}

const _PERIOD_LABELS = { today: "Today!", month: "This Month!", alltime: "All Time!" };

function checkMilestone(newTotal, period) {
  let prev;
  if (period === "today") { prev = _lastKnownTodayTokens; _lastKnownTodayTokens = newTotal; }
  else if (period === "month") { prev = _lastKnownMonthTokens; _lastKnownMonthTokens = newTotal; }
  else { prev = _lastKnownAllTimeTokens; _lastKnownAllTimeTokens = newTotal; }
  if (prev === 0) return;
  const seen = getSeenMilestones(period);
  for (const m of TOKEN_MILESTONES) {
    if (newTotal >= m && prev < m && !seen.includes(m)) {
      markMilestoneSeen(m, period);
      triggerCelebration(m, period);
      return;
    }
  }
}

function triggerCelebration(milestone, period) {
  const style = getConfettiStyle();
  if (style === "none") return;
  const useMoney = style === "auto" ? _tokenShowDollars : style === "money";
  _launchRockets(useMoney);
  _showMilestoneToast(milestone, period);
}

function _showMilestoneToast(milestone, period) {
  const toast = document.createElement("div");
  toast.className = "milestone-toast";
  const emoji = _tokenShowDollars ? "💰" : "🎉";
  const periodLabel = _PERIOD_LABELS[period] || "All Time!";
  toast.innerHTML = `
    <div class="milestone-period">${periodLabel}</div>
    <div class="milestone-emoji">${emoji}</div>
    <div class="milestone-label">Milestone Reached</div>
    <div class="milestone-value">${formatTokenCount(milestone)} tokens</div>
  `;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = "milestoneOut 0.5s ease forwards";
    setTimeout(() => toast.remove(), 500);
  }, 3000);
}

// DOM-based rockets + explosion — all CSS transforms = GPU composited, no canvas
function _launchRockets(useMoney) {
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:100000;overflow:hidden";
  document.body.appendChild(container);

  const W = window.innerWidth, H = window.innerHeight;
  const rocketCount = 7;

  for (let i = 0; i < rocketCount; i++) {
    // Spread evenly across the full width with slight randomness
    const slotWidth = W / rocketCount;
    const startX = slotWidth * i + slotWidth * (0.2 + Math.random() * 0.6);
    const explodeY = H * 0.12 + Math.random() * H * 0.3;
    const travelTime = 600 + Math.random() * 400;
    const delay = i * 150;

    // Rocket element
    const rocket = document.createElement("div");
    rocket.textContent = "🚀";
    rocket.style.cssText = `position:absolute;font-size:32px;left:${startX}px;bottom:-40px;will-change:transform;transition:transform ${travelTime}ms ease-out;z-index:2`;
    container.appendChild(rocket);

    setTimeout(() => {
      rocket.style.transform = `translateY(-${H - explodeY + 40}px)`;

      setTimeout(() => {
        rocket.remove();
        _spawnExplosion(container, startX, explodeY, useMoney);
      }, travelTime);
    }, delay);
  }

  // Cleanup container after all animations done
  setTimeout(() => container.remove(), rocketCount * 150 + 1200 + 2500);
}

function _spawnExplosion(container, cx, cy, useMoney) {
  const count = useMoney ? 20 : 30;

  for (let i = 0; i < count; i++) {
    const el = document.createElement("div");
    const angle = Math.random() * Math.PI * 2;
    const dist = 80 + Math.random() * 200;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist + 60; // gravity bias downward
    const duration = 1200 + Math.random() * 800;

    if (useMoney) {
      el.textContent = MONEY_EMOJIS[Math.floor(Math.random() * MONEY_EMOJIS.length)];
      el.style.cssText = `position:absolute;left:${cx}px;top:${cy}px;font-size:${16 + Math.random() * 14}px;will-change:transform,opacity;transition:transform ${duration}ms cubic-bezier(.2,.8,.3,1),opacity ${duration}ms ease;opacity:1;z-index:1;pointer-events:none`;
    } else {
      const color = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
      const w = 6 + Math.random() * 6;
      const h = 4 + Math.random() * 4;
      el.style.cssText = `position:absolute;left:${cx}px;top:${cy}px;width:${w}px;height:${h}px;background:${color};border-radius:1px;will-change:transform,opacity;transition:transform ${duration}ms cubic-bezier(.2,.8,.3,1),opacity ${duration}ms ease;opacity:1;z-index:1;pointer-events:none`;
    }

    container.appendChild(el);

    // Force layout then animate
    el.offsetWidth;
    const spin = Math.random() * 720 - 360;
    el.style.transform = `translate(${dx}px, ${dy}px) rotate(${spin}deg)`;
    el.style.opacity = "0";

    setTimeout(() => el.remove(), duration + 50);
  }
}

// --- Confetti Picker ---
const _CONFETTI_OPTIONS = [
  { id: "auto", name: "Auto", desc: "Money when viewing $, confetti when viewing tokens", preview: "🔄" },
  { id: "money", name: "Money Rockets", desc: "Rockets explode into money emojis", preview: "🚀💰💵" },
  { id: "confetti", name: "Confetti Rockets", desc: "Rockets explode into colorful confetti", preview: "🚀🎉🎊" },
  { id: "none", name: "None", desc: "No celebration effect", preview: "🔇" },
];

function openConfettiPicker() {
  const existing = document.querySelector(".confetti-picker-overlay");
  if (existing) existing.remove();

  const currentId = getConfettiStyle();
  const overlay = document.createElement("div");
  overlay.className = "confetti-picker-overlay";

  const cardsHtml = _CONFETTI_OPTIONS.map(s => `
    <div class="confetti-picker-card${s.id === currentId ? " selected" : ""}" data-style-id="${s.id}">
      <div class="picker-preview">${s.preview}</div>
      <div class="picker-name">${s.name}</div>
      <div class="picker-desc">${s.desc}</div>
    </div>
  `).join("");

  overlay.innerHTML = `
    <div class="confetti-picker-modal">
      <h2>Milestone Celebration Style</h2>
      <div class="picker-subtitle">Rockets launch, then explode. Click a card to preview.</div>
      <div class="confetti-picker-grid">${cardsHtml}</div>
      <div class="confetti-picker-actions">
        <button class="btn-cancel">Cancel</button>
        <button class="btn-save">Save</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  let selectedId = currentId;

  overlay.querySelectorAll(".confetti-picker-card").forEach(card => {
    card.addEventListener("click", () => {
      overlay.querySelectorAll(".confetti-picker-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
      selectedId = card.dataset.styleId;
      if (selectedId !== "none") {
        const useMoney = selectedId === "auto" ? _tokenShowDollars : selectedId === "money";
        _launchRockets(useMoney);
      }
    });
  });

  overlay.querySelector(".btn-save").addEventListener("click", () => {
    setConfettiStyle(selectedId);
    updateConfettiLabel();
    overlay.remove();
  });
  overlay.querySelector(".btn-cancel").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
}

function updateConfettiLabel() {
  const label = document.getElementById("confetti-current-label");
  if (!label) return;
  const opt = _CONFETTI_OPTIONS.find(o => o.id === getConfettiStyle());
  label.textContent = opt ? `Current: ${opt.name}` : "";
}

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("setting-confetti-picker");
  if (btn) btn.addEventListener("click", openConfettiPicker);
  updateConfettiLabel();
});
