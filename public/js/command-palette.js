/* command-palette.js — Cmd+K command palette for the CEO Dashboard */
(function () {
  "use strict";

  const _actions = [];
  let _overlay = null;
  let _input = null;
  let _list = null;
  let _activeIndex = -1;
  let _filteredItems = [];
  let _isOpen = false;

  /* ── Action registry ── */

  function registerAction(action) {
    if (!action.id || !action.label || !action.handler) return;
    // Avoid duplicates
    const idx = _actions.findIndex((a) => a.id === action.id);
    if (idx >= 0) _actions[idx] = action;
    else _actions.push(action);
  }

  function registerActions(actions) {
    actions.forEach(registerAction);
  }

  /* ── Fuzzy match scorer ── */

  function _score(query, text) {
    const q = query.toLowerCase();
    const t = text.toLowerCase();

    // Exact substring match — prefer earlier position
    const subIdx = t.indexOf(q);
    if (subIdx >= 0) return 100 - subIdx;

    // Sequential character match
    let qi = 0;
    let score = 0;
    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
      if (t[ti] === q[qi]) {
        score += 10 - Math.min(ti, 9);
        qi++;
      }
    }
    return qi === q.length ? score : 0;
  }

  function search(query) {
    if (!query) return _allItems();

    const scored = _allItems()
      .map((item) => {
        const haystack = [item.label, item.category, item.keywords || ""].join(" ");
        return { item, score: _score(query, haystack) };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, 15).map((s) => s.item);
  }

  function _allItems() {
    // Merge static + dynamic actions
    const dynamic = _getDynamicActions();
    const deduped = new Map();
    for (const a of _actions) deduped.set(a.id, a);
    for (const a of dynamic) deduped.set(a.id, a);
    return [...deduped.values()];
  }

  /* ── Dynamic actions (refreshed each open) ── */

  function _getDynamicActions() {
    const results = [];
    if (typeof agents !== "undefined" && agents instanceof Map) {
      agents.forEach((data, name) => {
        results.push({
          id: "focus-agent-" + name,
          category: "Agents",
          label: "Focus: " + name,
          keywords: "agent switch " + name,
          icon: "\u25CF",
          _dynamic: true,
          handler: function () {
            const card = data.card;
            if (!card) return;
            card.scrollIntoView({ behavior: "smooth", block: "center" });
            const inp = card.querySelector(".card-input textarea");
            if (inp) inp.focus();
          },
        });
      });
    }
    return results;
  }

  /* ── DOM creation ── */

  function _ensureDOM() {
    if (_overlay) return;

    _overlay = document.createElement("div");
    _overlay.className = "command-palette-overlay hidden";
    _overlay.addEventListener("mousedown", function (e) {
      if (e.target === _overlay) close();
    });

    const palette = document.createElement("div");
    palette.className = "command-palette";

    _input = document.createElement("input");
    _input.className = "command-palette-input";
    _input.type = "text";
    _input.placeholder = "Search actions, agents, docs...";
    _input.setAttribute("autocomplete", "off");
    _input.setAttribute("spellcheck", "false");
    _input.addEventListener("input", _onInput);
    _input.addEventListener("keydown", _onKeydown);

    _list = document.createElement("div");
    _list.className = "command-palette-list";

    palette.appendChild(_input);
    palette.appendChild(_list);
    _overlay.appendChild(palette);
    document.body.appendChild(_overlay);
  }

  /* ── Render ── */

  function _render(items) {
    _filteredItems = items;
    _list.innerHTML = "";

    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "command-palette-empty";
      empty.textContent = "No results found";
      _list.appendChild(empty);
      _activeIndex = -1;
      return;
    }

    let currentCategory = null;
    items.forEach(function (item, i) {
      if (item.category !== currentCategory) {
        currentCategory = item.category;
        const hdr = document.createElement("div");
        hdr.className = "command-palette-category";
        hdr.textContent = currentCategory;
        _list.appendChild(hdr);
      }

      const row = document.createElement("div");
      row.className = "command-palette-item";
      row.dataset.index = i;

      if (item.icon) {
        const icon = document.createElement("span");
        icon.className = "command-palette-icon";
        icon.textContent = item.icon;
        row.appendChild(icon);
      }

      const label = document.createElement("span");
      label.className = "command-palette-label";
      label.textContent = item.label;
      row.appendChild(label);

      if (item.hint) {
        const hint = document.createElement("span");
        hint.className = "command-palette-hint";
        hint.textContent = item.hint;
        row.appendChild(hint);
      }

      row.addEventListener("mouseenter", function () {
        _setActive(i);
      });
      row.addEventListener("click", function () {
        _selectItem(i);
      });

      _list.appendChild(row);
    });

    _activeIndex = 0;
    _highlightActive();
  }

  function _setActive(idx) {
    _activeIndex = idx;
    _highlightActive();
  }

  function _highlightActive() {
    const items = _list.querySelectorAll(".command-palette-item");
    items.forEach(function (el, i) {
      el.classList.toggle("selected", i === _activeIndex);
    });
    // Scroll into view
    if (_activeIndex >= 0 && items[_activeIndex]) {
      items[_activeIndex].scrollIntoView({ block: "nearest" });
    }
  }

  function _selectItem(idx) {
    const item = _filteredItems[idx];
    if (!item) return;
    close();
    try {
      item.handler();
    } catch (err) {
      console.error("[CommandPalette] handler error:", err);
    }
  }

  /* ── Event handlers ── */

  function _onInput() {
    const q = _input.value.trim();
    _render(search(q));
  }

  function _onKeydown(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (_filteredItems.length === 0) return;
      _activeIndex = (_activeIndex + 1) % _filteredItems.length;
      _highlightActive();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (_filteredItems.length === 0) return;
      _activeIndex = (_activeIndex - 1 + _filteredItems.length) % _filteredItems.length;
      _highlightActive();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (_activeIndex >= 0) _selectItem(_activeIndex);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  /* ── Open / Close ── */

  function open() {
    _ensureDOM();
    _overlay.classList.remove("hidden");
    _input.value = "";
    _isOpen = true;
    _render(search(""));
    // Defer focus so overlay transition doesn't steal it
    requestAnimationFrame(function () {
      _input.focus();
    });
  }

  function close() {
    if (!_overlay) return;
    _overlay.classList.add("hidden");
    _isOpen = false;
  }

  function isOpen() {
    return _isOpen;
  }

  /* ── Built-in actions ── */

  function registerBuiltinActions() {
    registerActions([
      {
        id: "new-agent",
        category: "Actions",
        label: "New Agent",
        keywords: "create spawn add",
        icon: "+",
        hint: "N",
        handler: function () {
          var btn = document.getElementById("new-agent-btn");
          if (btn) btn.click();
        },
      },
      {
        id: "toggle-shell",
        category: "Panels",
        label: "Toggle Terminal",
        keywords: "shell bash console",
        icon: "\u2318",
        hint: "T",
        handler: function () {
          var hdr = document.getElementById("shell-header");
          if (hdr) hdr.click();
        },
      },
      {
        id: "toggle-files",
        category: "Panels",
        label: "Toggle Files",
        keywords: "file browser explorer",
        icon: "\uD83D\uDCC1",
        hint: "F",
        handler: function () {
          var btn = document.getElementById("files-btn");
          if (btn) btn.click();
        },
      },
      {
        id: "toggle-settings",
        category: "Panels",
        label: "Toggle Settings",
        keywords: "config preferences options",
        icon: "\u2699",
        hint: "S",
        handler: function () {
          var btn = document.getElementById("settings-btn");
          if (btn) btn.click();
        },
      },
      {
        id: "toggle-bookmarks",
        category: "Panels",
        label: "Toggle Bookmarks",
        keywords: "bookmark saved",
        icon: "\u2605",
        hint: "B",
        handler: function () {
          if (typeof toggleBookmarksPanel === "function") toggleBookmarksPanel();
        },
      },
      {
        id: "toggle-todos",
        category: "Views",
        label: "Toggle Todos",
        keywords: "todo task checklist",
        icon: "\u2713",
        hint: "D",
        handler: function () {
          if (typeof toggleTodoView === "function") toggleTodoView();
        },
      },
      {
        id: "bug-report",
        category: "Actions",
        label: "File Bug Report",
        keywords: "bug issue report",
        icon: "!",
        hint: "!",
        handler: function () {
          var btn = document.getElementById("bug-report-btn");
          if (btn) btn.click();
        },
      },
      {
        id: "ceo-md",
        category: "Actions",
        label: "Edit CEO Prompt",
        keywords: "ceo prompt instructions claude md",
        icon: "\u270E",
        hint: "C",
        handler: function () {
          var btn = document.getElementById("ceo-md-btn");
          if (btn) btn.click();
        },
      },
      {
        id: "restart",
        category: "Actions",
        label: "Restart Server",
        keywords: "restart reload server",
        icon: "\u21BB",
        hint: "R",
        handler: function () {
          if (typeof restartServer === "function") restartServer();
        },
      },
      {
        id: "help",
        category: "Actions",
        label: "Keyboard Shortcuts",
        keywords: "help keys hotkeys shortcuts",
        icon: "?",
        hint: "?",
        handler: function () {
          if (typeof _toggleHelpOverlay === "function") _toggleHelpOverlay();
        },
      },
    ]);
  }

  /* ── Export ── */

  window.CommandPalette = {
    registerAction: registerAction,
    registerActions: registerActions,
    registerBuiltinActions: registerBuiltinActions,
    search: search,
    open: open,
    close: close,
    isOpen: isOpen,
  };
})();
