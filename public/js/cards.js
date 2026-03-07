// public/js/cards.js — Card layout management (extracted from app.js)
//
// Handles masonry grid layout, card height/order persistence, and reorder animations.
// Loads BEFORE app.js. References to app.js globals (agents, updateCardNumbers, etc.)
// are resolved at call time, not parse time, so they work correctly.

// --- Mobile detection ---
function isMobile() { return window.innerWidth <= 600; }

// --- Masonry grid layout ---
const GRID_ROW_PX = 10; // matches grid-auto-rows in CSS
const GRID_GAP_PX = 20; // visual gap between cards (achieved via margin-bottom + extra span)

// Own reference to the grid element (app.js has its own const)
const _cardsGrid = document.getElementById("agents-grid");
const _cardsMinimizedBar = document.getElementById("minimized-bar");

function getCardDefaultHeight() {
  return isMobile() ? 350 : 500; // matches .agent-card CSS heights
}

function masonryLayout() {
  const cards = _cardsGrid.querySelectorAll(".agent-card");
  const spanChanges = [];
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
    const oldSpan = card.style.gridRow;
    if (termOpen) console.log("[masonry]", card.querySelector(".agent-name")?.textContent, { cssH, scrollH: card.scrollHeight, h, span, inlineH });
    card.style.gridRow = `span ${span}`;
    if (oldSpan && oldSpan !== `span ${span}`) {
      const name = card.querySelector(".agent-name")?.textContent || "?";
      spanChanges.push(`${name}:${oldSpan}->${span}`);
    }
  }
  if (spanChanges.length > 0) {
    _focusLog("masonry-span", `span changes: ${spanChanges.join(", ")}`);
  }
  // Force browser to reflow grid after all spans are set
  void _cardsGrid.offsetHeight;
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

// --- Card Layout Persistence ---
// Mobile and desktop use separate layout keys so resizing on one doesn't affect the other.
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

// --- Card order persistence ---
const CARD_ORDER_KEY = "ceo-card-order";

function loadCardOrder() {
  try { return JSON.parse(localStorage.getItem(CARD_ORDER_KEY)) || []; } catch { return []; }
}

function saveCardOrder() {
  const g = _cardsGrid;
  if (!g) return;
  const gridNames = Array.from(g.querySelectorAll(".agent-card"))
    .map(c => c.querySelector(".agent-name")?.textContent)
    .filter(Boolean);
  const minNames = new Set(
    Array.from(_cardsMinimizedBar.querySelectorAll(".agent-card"))
      .map(c => c.querySelector(".agent-name")?.textContent)
      .filter(Boolean)
  );
  if (minNames.size === 0) {
    localStorage.setItem(CARD_ORDER_KEY, JSON.stringify(gridNames));
    return;
  }
  // Merge minimized cards back at their previous saved positions.
  // Walk previous order: emit grid cards in current DOM order,
  // and re-insert minimized cards at their old relative positions.
  const prevOrder = loadCardOrder();
  const gridSet = new Set(gridNames);
  const result = [];
  let gridIdx = 0;
  for (const name of prevOrder) {
    if (minNames.has(name)) {
      result.push(name); // minimized: keep at previous position
      minNames.delete(name);
    } else if (gridSet.has(name)) {
      // Slot for a grid card — emit next grid card in current DOM order
      if (gridIdx < gridNames.length) result.push(gridNames[gridIdx++]);
    }
  }
  // Append remaining grid cards (new cards not in previous order)
  while (gridIdx < gridNames.length) result.push(gridNames[gridIdx++]);
  // Append any minimized cards not in previous order
  for (const name of minNames) result.push(name);
  localStorage.setItem(CARD_ORDER_KEY, JSON.stringify(result));
}

// --- Card Reordering (favorites first, FLIP animation) ---

function reorderCards() {
  const cards = Array.from(_cardsGrid.querySelectorAll(".agent-card"));
  if (cards.length <= 1) { scheduleMasonry(); return; }

  // FIRST: record current positions
  const firstRects = new Map();
  cards.forEach(card => firstRects.set(card, card.getBoundingClientRect()));

  const beforeOrder = cards.map(c => c.querySelector(".agent-name")?.textContent || "?");

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

  const afterOrder = cards.map(c => c.querySelector(".agent-name")?.textContent || "?");

  // Check if order actually changed — skip DOM moves if already correct
  const currentOrder = Array.from(_cardsGrid.querySelectorAll(".agent-card"));
  let orderChanged = cards.length !== currentOrder.length;
  if (!orderChanged) {
    for (let i = 0; i < cards.length; i++) {
      if (cards[i] !== currentOrder[i]) { orderChanged = true; break; }
    }
  }

  if (orderChanged) {
    // Find which cards moved
    const movedCards = [];
    for (let i = 0; i < afterOrder.length; i++) {
      if (beforeOrder[i] !== afterOrder[i]) movedCards.push(`${beforeOrder[i]}->${afterOrder[i]}`);
    }
    _focusLog("reorder", `cards moved: ${movedCards.join(", ") || "none"} | savedOrder has ${savedOrder.length} entries`);
    // Save focused element + cursor position before DOM moves (appendChild causes blur)
    const focused = document.activeElement;
    const focusedInGrid = focused && _cardsGrid.contains(focused);
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
      _cardsGrid.appendChild(card);
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
      const agent = _getAgentName(focused);
      const nowDesc = document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : "null";
      _focusLog("reorder-restore", `DOM reorder stole focus from [${agent}], now on ${nowDesc}`, { guard: "reorderCards" });
      focused.focus({ preventScroll: true });
      if (cursorStart != null) {
        try { focused.setSelectionRange(cursorStart, cursorEnd); } catch {}
      }
    }
    }

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

// Cancel any pending masonry RAF (used before immediate masonryLayout calls)
function cancelMasonry() {
  if (_masonryTimer) { cancelAnimationFrame(_masonryTimer); _masonryTimer = null; }
}

// --- Export to global scope ---
window.isMobile = isMobile;
window.GRID_ROW_PX = GRID_ROW_PX;
window.GRID_GAP_PX = GRID_GAP_PX;
window.LAYOUT_KEY_DESKTOP = LAYOUT_KEY_DESKTOP;
window.LAYOUT_KEY_MOBILE = LAYOUT_KEY_MOBILE;
window.getCardDefaultHeight = getCardDefaultHeight;
window.masonryLayout = masonryLayout;
window.scheduleMasonry = scheduleMasonry;
window.cancelMasonry = cancelMasonry;
window.loadLayouts = loadLayouts;
window.saveLayout = saveLayout;
window.removeLayout = removeLayout;
window.applyLayout = applyLayout;
window.loadCardOrder = loadCardOrder;
window.saveCardOrder = saveCardOrder;
window.reorderCards = reorderCards;
