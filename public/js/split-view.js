// public/js/split-view.js — Focus mode: 1-4 agents in smart layouts within the grid area
(function() {
  "use strict";

  let _container = null;
  let _agents = []; // array of selected agent names
  let _isOpen = false;

  function promptAndOpen() {
    const agentNames = [];
    if (typeof agents !== "undefined") {
      for (const [name, agent] of agents) {
        if (agent.type !== "terminal") agentNames.push(name);
      }
    }
    if (agentNames.length === 0) return;
    _showPicker(agentNames);
  }

  function _showPicker(agentNames) {
    const picked = [];
    const overlay = document.createElement("div");
    overlay.className = "command-palette-overlay";
    overlay.setAttribute("tabindex", "-1");

    function render() {
      const count = picked.length;
      const label = count === 0
        ? "Focus View \u2014 pick agents (1\u20134), then press Enter"
        : `Selected ${count} agent${count > 1 ? "s" : ""} \u2014 pick more or press Enter`;
      overlay.innerHTML = `
        <div class="command-palette" style="max-width:440px">
          <div style="padding:16px 20px 4px;font-size:15px;font-weight:600">${label}</div>
          <div style="padding:4px 20px 8px;font-size:12px;color:var(--text-dim)">
            1 = full \u2022 2 = side-by-side \u2022 3 = thirds \u2022 4 = 2\u00d72 grid
          </div>
          <div class="split-picker-list" style="padding:4px 0 8px;max-height:300px;overflow-y:auto"></div>
          ${count > 0 ? '<div style="padding:8px 20px 16px"><button class="split-picker-go" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--accent);background:rgba(var(--accent-rgb,201,168,76),0.15);color:var(--accent);cursor:pointer;font-size:14px;font-weight:600">Open Focus View (' + count + ')</button></div>' : ''}
        </div>
      `;
      const list = overlay.querySelector(".split-picker-list");
      agentNames.forEach(name => {
        const selected = picked.includes(name);
        const item = document.createElement("div");
        item.className = "command-palette-item" + (selected ? " selected" : "");
        item.innerHTML = `<span class="command-palette-icon">${selected ? "\u2713" : ""}</span><span class="command-palette-label">${name}</span>`;
        item.addEventListener("click", () => {
          const idx = picked.indexOf(name);
          if (idx >= 0) {
            picked.splice(idx, 1);
          } else if (picked.length < 4) {
            picked.push(name);
          }
          render();
        });
        list.appendChild(item);
      });
      const goBtn = overlay.querySelector(".split-picker-go");
      if (goBtn) goBtn.addEventListener("click", () => { _removePicker(); open(picked); });
    }

    function _removePicker() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }

    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) _removePicker();
    });
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); _removePicker(); }
      if (e.key === "Enter" && picked.length > 0) { e.preventDefault(); _removePicker(); open(picked); }
    });

    document.body.appendChild(overlay);
    overlay.focus();
    render();
  }

  function open(agentList) {
    if (!agentList || agentList.length === 0) return;
    _agents = agentList.slice(0, 4);
    _isOpen = true;

    // Hide the normal grid, show focus container
    const grid = document.getElementById("agents-grid");
    const emptyState = document.getElementById("empty-state");
    if (grid) grid.style.display = "none";
    if (emptyState) emptyState.style.display = "none";

    if (!_container) {
      _container = document.createElement("div");
      _container.id = "focus-view-container";
      grid.parentNode.insertBefore(_container, grid);
    }

    _container.innerHTML = "";
    _container.className = "focus-view-container focus-view-count-" + _agents.length;
    _container.style.display = "";

    // Create panes
    _agents.forEach((name, i) => {
      const agent = typeof agents !== "undefined" ? agents.get(name) : null;
      const pane = document.createElement("div");
      pane.className = "focus-view-pane";
      pane.dataset.agent = name;

      const header = document.createElement("div");
      header.className = "focus-view-header";
      header.innerHTML = `<span class="focus-view-name">${name}</span>` +
        (i === 0 ? `<button class="focus-view-close" title="Close Focus View (Esc)">&times;</button>` : "");

      const terminal = document.createElement("div");
      terminal.className = "focus-view-terminal";
      // Copy current terminal content
      if (agent?.terminal) {
        terminal.innerHTML = agent.terminal.innerHTML;
      }

      const inputWrap = document.createElement("div");
      inputWrap.className = "focus-view-input-wrap";
      const textarea = document.createElement("textarea");
      textarea.placeholder = `Message ${name}...`;
      textarea.rows = 1;
      textarea.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          const text = textarea.value.trim();
          if (!text) return;
          if (typeof ws !== "undefined" && ws.readyState === 1) {
            ws.send(JSON.stringify({ type: "input", session: name, text }));
          }
          textarea.value = "";
        }
      });
      inputWrap.appendChild(textarea);

      pane.appendChild(header);
      pane.appendChild(terminal);
      pane.appendChild(inputWrap);
      _container.appendChild(pane);

      // Scroll to bottom
      terminal.scrollTop = terminal.scrollHeight;
    });

    // Close button
    const closeBtn = _container.querySelector(".focus-view-close");
    if (closeBtn) closeBtn.addEventListener("click", close);
  }

  function close() {
    _isOpen = false;
    _agents = [];
    if (_container) {
      _container.style.display = "none";
      _container.innerHTML = "";
    }
    const grid = document.getElementById("agents-grid");
    const emptyState = document.getElementById("empty-state");
    if (grid) grid.style.display = "";
    // Re-show empty state only if no agents
    if (emptyState && typeof agents !== "undefined" && agents.size === 0) {
      emptyState.style.display = "";
    }
    if (typeof scheduleMasonry === "function") scheduleMasonry();
  }

  function isOpen() { return _isOpen; }
  function getAgents() { return _agents.slice(); }

  // Called by app.js when it receives terminal output
  function onOutput(agentName, html) {
    if (!_isOpen || !_container) return;
    const pane = _container.querySelector(`.focus-view-pane[data-agent="${CSS.escape(agentName)}"]`);
    if (pane) {
      const terminal = pane.querySelector(".focus-view-terminal");
      if (terminal) {
        terminal.innerHTML = html;
        terminal.scrollTop = terminal.scrollHeight;
      }
    }
  }

  window.SplitView = { promptAndOpen, open, close, isOpen, getAgents, onOutput };
})();
