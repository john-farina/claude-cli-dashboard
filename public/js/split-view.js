(function() {
  "use strict";

  let _overlay = null;
  let _leftAgent = null;
  let _rightAgent = null;
  let _isOpen = false;

  function promptAndOpen() {
    const agentNames = [];
    if (typeof agents !== "undefined") {
      for (const [name, agent] of agents) {
        if (agent.type !== "terminal") agentNames.push(name);
      }
    }
    if (agentNames.length < 2) {
      alert("Need at least 2 agents for split view");
      return;
    }
    _showPicker(agentNames);
  }

  function _showPicker(agentNames) {
    let picked = [];
    const overlay = document.createElement("div");
    overlay.className = "command-palette-overlay";
    overlay.innerHTML = `
      <div class="command-palette" style="max-width:400px">
        <div class="split-picker-title" style="padding:16px 20px 8px;font-size:15px;font-weight:600">Split View -- pick left agent</div>
        <div class="split-picker-list" style="padding:8px 0;max-height:300px;overflow-y:auto"></div>
      </div>
    `;
    const list = overlay.querySelector(".split-picker-list");

    function renderList(exclude) {
      list.innerHTML = "";
      agentNames.filter(n => n !== exclude).forEach(name => {
        const item = document.createElement("div");
        item.className = "command-palette-item";
        item.innerHTML = `<span class="command-palette-label">${name}</span>`;
        item.addEventListener("click", () => {
          picked.push(name);
          if (picked.length === 1) {
            overlay.querySelector(".split-picker-title").textContent = "Split View -- pick right agent";
            renderList(picked[0]);
          } else {
            document.body.removeChild(overlay);
            open(picked[0], picked[1]);
          }
        });
        list.appendChild(item);
      });
    }

    renderList(null);
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) document.body.removeChild(overlay);
    });
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (overlay.parentNode) document.body.removeChild(overlay);
      }
    });
    document.body.appendChild(overlay);
    // Focus overlay so Escape works
    overlay.setAttribute("tabindex", "-1");
    overlay.focus();
  }

  function open(leftName, rightName) {
    if (!_overlay) _createDOM();
    _leftAgent = leftName;
    _rightAgent = rightName;
    _isOpen = true;

    // Set headers
    _overlay.querySelector(".split-left-name").textContent = leftName;
    _overlay.querySelector(".split-right-name").textContent = rightName;

    // Clear terminals
    _overlay.querySelector(".split-left-terminal").innerHTML = "";
    _overlay.querySelector(".split-right-terminal").innerHTML = "";

    // Clear inputs
    _overlay.querySelector(".split-left-input").value = "";
    _overlay.querySelector(".split-right-input").value = "";

    // Copy current terminal content from agent cards
    const leftAgent = typeof agents !== "undefined" ? agents.get(leftName) : null;
    const rightAgent = typeof agents !== "undefined" ? agents.get(rightName) : null;
    if (leftAgent?.terminal) {
      _overlay.querySelector(".split-left-terminal").innerHTML = leftAgent.terminal.innerHTML;
    }
    if (rightAgent?.terminal) {
      _overlay.querySelector(".split-right-terminal").innerHTML = rightAgent.terminal.innerHTML;
    }

    // Scroll terminals to bottom
    _overlay.querySelectorAll(".split-view-terminal").forEach(t => {
      t.scrollTop = t.scrollHeight;
    });

    // Reset pane sizes
    _overlay.querySelector(".split-view-left").style.flex = "";
    _overlay.querySelector(".split-view-right").style.flex = "";

    _overlay.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }

  function close() {
    if (_overlay) _overlay.classList.add("hidden");
    _isOpen = false;
    _leftAgent = null;
    _rightAgent = null;
    document.body.style.overflow = "";
  }

  function isOpen() { return _isOpen; }
  function getAgents() { return { left: _leftAgent, right: _rightAgent }; }

  // Called by app.js when it receives terminal output for an agent
  function onOutput(agentName, html) {
    if (!_isOpen) return;
    let terminal = null;
    if (agentName === _leftAgent) {
      terminal = _overlay?.querySelector(".split-left-terminal");
    } else if (agentName === _rightAgent) {
      terminal = _overlay?.querySelector(".split-right-terminal");
    }
    if (terminal) {
      terminal.innerHTML = html;
      terminal.scrollTop = terminal.scrollHeight;
    }
  }

  function _createDOM() {
    _overlay = document.createElement("div");
    _overlay.id = "split-view-overlay";
    _overlay.className = "split-view-overlay hidden";
    _overlay.setAttribute("tabindex", "-1");
    _overlay.innerHTML = `
      <div class="split-view-pane split-view-left">
        <div class="split-view-header">
          <span class="split-left-name"></span>
          <button class="split-view-close" title="Close split view (Esc)">&times;</button>
        </div>
        <div class="split-view-terminal split-left-terminal"></div>
        <div class="split-view-input-wrap">
          <textarea class="split-left-input" placeholder="Message left agent..." rows="1"></textarea>
        </div>
      </div>
      <div class="split-view-divider"></div>
      <div class="split-view-pane split-view-right">
        <div class="split-view-header">
          <span class="split-right-name"></span>
        </div>
        <div class="split-view-terminal split-right-terminal"></div>
        <div class="split-view-input-wrap">
          <textarea class="split-right-input" placeholder="Message right agent..." rows="1"></textarea>
        </div>
      </div>
    `;
    document.body.appendChild(_overlay);

    // Close button
    _overlay.querySelector(".split-view-close").addEventListener("click", close);

    // Draggable divider
    const divider = _overlay.querySelector(".split-view-divider");
    const leftPane = _overlay.querySelector(".split-view-left");
    const rightPane = _overlay.querySelector(".split-view-right");
    let dragging = false;

    divider.addEventListener("mousedown", (e) => {
      e.preventDefault();
      dragging = true;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    });
    document.addEventListener("mousemove", (e) => {
      if (!dragging || !_isOpen) return;
      const rect = _overlay.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      const clamped = Math.max(20, Math.min(80, pct));
      leftPane.style.flex = `0 0 ${clamped}%`;
      rightPane.style.flex = `0 0 ${100 - clamped}%`;
    });
    document.addEventListener("mouseup", () => {
      if (dragging) {
        dragging = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    });

    // Input handling -- send via WebSocket
    const setupInput = (textarea, getAgent) => {
      textarea.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          const text = textarea.value.trim();
          if (!text) return;
          const agent = getAgent();
          if (agent && typeof ws !== "undefined" && ws.readyState === 1) {
            ws.send(JSON.stringify({ type: "input", session: agent, text }));
          }
          textarea.value = "";
        }
      });
    };
    setupInput(_overlay.querySelector(".split-left-input"), () => _leftAgent);
    setupInput(_overlay.querySelector(".split-right-input"), () => _rightAgent);
  }

  window.SplitView = { promptAndOpen, open, close, isOpen, getAgents, onOutput };
})();
