(function() {
  "use strict";

  function _getCssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || null;
  }

  let _panel = null;
  let _svg = null;
  let _pollInterval = null;
  let _isOpen = false;
  let _editMode = false;

  // Drag state
  let _dragFrom = null;
  let _dragLine = null;
  let _dragStartX = 0;
  let _dragStartY = 0;

  // Chain form state (preserve across refreshes)
  let _chainFormState = null; // { source, target, prompt, condition, editing }

  // Cached positions for event handlers
  let _nodePositions = {};
  let _lastAgentList = [];
  let _lastOverlaps = [];

  function toggle() {
    if (_isOpen) close(); else open();
  }

  function open() {
    if (!_panel) _createDOM();
    _panel.classList.add("visible");
    _isOpen = true;
    _refresh();
    _pollInterval = setInterval(_refresh, 10000);
  }

  function close() {
    if (_panel) _panel.classList.remove("visible");
    _isOpen = false;
    if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
    _clearDrag();
    _chainFormState = null;
  }

  function isOpen() { return _isOpen; }

  function _createDOM() {
    _panel = document.createElement("div");
    _panel.id = "dep-graph-panel";
    _panel.className = "dep-graph-panel";
    _panel.innerHTML = `
      <div class="dep-graph-header">
        <span>Agent Dependencies</span>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="dep-graph-edit-toggle" title="Toggle chain editing">Edit Chains</button>
          <button class="dep-graph-close" title="Close (G)">&times;</button>
        </div>
      </div>
      <div class="dep-graph-body">
        <svg class="dep-graph-svg"></svg>
        <div class="dep-graph-legend">
          <span><span class="dep-dot" style="background:var(--dep-status-working)"></span> working</span>
          <span><span class="dep-dot" style="background:var(--dep-status-idle)"></span> idle</span>
          <span><span class="dep-dot" style="background:var(--dep-status-waiting)"></span> waiting</span>
          <span><span class="dep-dot" style="background:var(--dep-status-other)"></span> other</span>
          <span><span class="dep-line dep-line-red"></span> conflict</span>
          <span><span class="dep-line dep-line-chain"></span> chain</span>
        </div>
        <div class="dep-graph-chain-form-container"></div>
        <div class="dep-graph-empty" style="display:none">No agents or no file overlaps detected yet.</div>
      </div>
    `;
    document.body.appendChild(_panel);
    _svg = _panel.querySelector(".dep-graph-svg");
    _panel.querySelector(".dep-graph-close").addEventListener("click", close);

    // Edit mode toggle
    var editBtn = _panel.querySelector(".dep-graph-edit-toggle");
    editBtn.addEventListener("click", function() {
      _editMode = !_editMode;
      editBtn.classList.toggle("active", _editMode);
      _svg.classList.toggle("edit-mode", _editMode);
      if (!_editMode) {
        _clearDrag();
        _hideChainForm();
      }
    });

    // SVG mouse events for drag-to-chain
    _svg.addEventListener("mousemove", _onSvgMouseMove);
    _svg.addEventListener("mouseup", _onSvgMouseUp);
    _svg.addEventListener("mouseleave", _onSvgMouseLeave);
  }

  // --- Drag interaction ---

  function _onNodeMouseDown(e, agentName) {
    if (!_editMode) return;
    e.preventDefault();
    e.stopPropagation();
    _dragFrom = agentName;
    var pos = _nodePositions[agentName];
    if (!pos) return;
    _dragStartX = pos.x;
    _dragStartY = pos.y;

    // Create temp drag line
    var line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", pos.x);
    line.setAttribute("y1", pos.y);
    line.setAttribute("x2", pos.x);
    line.setAttribute("y2", pos.y);
    line.setAttribute("stroke", "#c9a84c");
    line.setAttribute("stroke-width", "2");
    line.setAttribute("stroke-dasharray", "4,4");
    line.setAttribute("opacity", "0.7");
    line.setAttribute("pointer-events", "none");
    line.classList.add("dep-drag-line");
    _svg.appendChild(line);
    _dragLine = line;
    _svg.classList.add("dragging");
  }

  function _onSvgMouseMove(e) {
    if (!_dragLine) return;
    var rect = _svg.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var my = e.clientY - rect.top;
    _dragLine.setAttribute("x2", mx);
    _dragLine.setAttribute("y2", my);
  }

  function _onNodeMouseUp(e, agentName) {
    if (!_dragFrom || _dragFrom === agentName) {
      _clearDrag();
      return;
    }
    _showChainForm(_dragFrom, agentName, "", "always", false);
    _clearDrag();
  }

  function _onSvgMouseUp(e) {
    // If we didn't land on a node, cancel
    if (_dragLine) _clearDrag();
  }

  function _onSvgMouseLeave(e) {
    if (_dragLine) _clearDrag();
  }

  function _clearDrag() {
    _dragFrom = null;
    if (_dragLine && _dragLine.parentNode) {
      _dragLine.parentNode.removeChild(_dragLine);
    }
    _dragLine = null;
    if (_svg) _svg.classList.remove("dragging");
  }

  // --- Chain form ---

  function _showChainForm(source, target, prompt, condition, editing) {
    _chainFormState = { source: source, target: target, prompt: prompt || "", condition: condition || "always", editing: !!editing };
    _renderChainForm();
  }

  function _hideChainForm() {
    _chainFormState = null;
    var container = _panel.querySelector(".dep-graph-chain-form-container");
    if (container) container.innerHTML = "";
  }

  function _renderChainForm() {
    var container = _panel.querySelector(".dep-graph-chain-form-container");
    if (!container || !_chainFormState) return;
    var s = _chainFormState;

    container.innerHTML = `
      <div class="chain-form">
        <div class="chain-form-header">${s.editing ? "Edit" : "New"} Chain: ${_escHtml(s.source)} \u2192 ${_escHtml(s.target)}</div>
        <textarea class="chain-form-prompt" placeholder="Prompt to send to target agent when source goes idle..." rows="3">${_escHtml(s.prompt)}</textarea>
        <select class="chain-form-condition">
          <option value="always"${s.condition === "always" ? " selected" : ""}>Always</option>
          <option value="branch-has-changes"${s.condition === "branch-has-changes" ? " selected" : ""}>When branch has changes</option>
        </select>
        <div class="chain-form-actions">
          <button class="chain-form-save">${s.editing ? "Update" : "Create"} Chain</button>
          <button class="chain-form-cancel">Cancel</button>
          ${s.editing ? '<button class="chain-form-delete">Delete Chain</button>' : ''}
        </div>
      </div>
    `;

    // Wire events
    var textarea = container.querySelector(".chain-form-prompt");
    var select = container.querySelector(".chain-form-condition");

    // Keep form state in sync
    textarea.addEventListener("input", function() { _chainFormState.prompt = textarea.value; });
    select.addEventListener("change", function() { _chainFormState.condition = select.value; });

    container.querySelector(".chain-form-save").addEventListener("click", function() {
      _saveChain(s.source, s.target, textarea.value, select.value);
    });

    container.querySelector(".chain-form-cancel").addEventListener("click", function() {
      _hideChainForm();
    });

    var delBtn = container.querySelector(".chain-form-delete");
    if (delBtn) {
      delBtn.addEventListener("click", function() {
        _deleteChainTarget(s.source, s.target);
      });
    }

    // Focus textarea
    textarea.focus();
  }

  async function _saveChain(source, target, prompt, condition) {
    if (!prompt.trim()) {
      alert("Prompt cannot be empty.");
      return;
    }

    // Fetch existing chain targets for the source agent, replace/add this target
    var agent = (typeof agents !== "undefined") ? agents.get(source) : null;
    var existingChain = (agent && agent.chain) ? (Array.isArray(agent.chain) ? agent.chain : [agent.chain]) : [];

    // Replace existing target or add new
    var found = false;
    var newTargets = existingChain.map(function(t) {
      if (t.next === target) {
        found = true;
        return { next: target, prompt: prompt, condition: condition };
      }
      return t;
    });
    if (!found) {
      newTargets.push({ next: target, prompt: prompt, condition: condition });
    }

    try {
      var res = await fetch("/api/sessions/" + encodeURIComponent(source) + "/chain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets: newTargets })
      });
      if (!res.ok) {
        var err = await res.json().catch(function() { return {}; });
        alert("Failed to save chain: " + (err.error || res.statusText));
        return;
      }
      // Update local agent data
      if (agent) agent.chain = newTargets;
      _hideChainForm();
      _refresh();
    } catch (e) {
      alert("Failed to save chain: " + e.message);
    }
  }

  async function _deleteChainTarget(source, target) {
    var agent = (typeof agents !== "undefined") ? agents.get(source) : null;
    var existingChain = (agent && agent.chain) ? (Array.isArray(agent.chain) ? agent.chain : [agent.chain]) : [];

    var remaining = existingChain.filter(function(t) { return t.next !== target; });

    try {
      if (remaining.length === 0) {
        // Delete all chains for this agent
        await fetch("/api/sessions/" + encodeURIComponent(source) + "/chain", { method: "DELETE" });
        if (agent) agent.chain = null;
      } else {
        // Update with remaining targets
        var res = await fetch("/api/sessions/" + encodeURIComponent(source) + "/chain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targets: remaining })
        });
        if (!res.ok) {
          alert("Failed to update chain.");
          return;
        }
        if (agent) agent.chain = remaining;
      }
      _hideChainForm();
      _refresh();
    } catch (e) {
      alert("Failed to delete chain: " + e.message);
    }
  }

  // --- Refresh & drawing ---

  async function _refresh() {
    if (!_isOpen || !_svg) return;

    var agentList = [];
    if (typeof agents !== "undefined") {
      for (var entry of agents) {
        var name = entry[0];
        var agent = entry[1];
        if (agent.type !== "terminal") {
          agentList.push({ name: name, status: agent.status || "idle", branch: agent.branch || "", chain: agent.chain || null });
        }
      }
    }

    var overlaps = [];
    try {
      var res = await fetch("/api/file-overlaps");
      if (res.ok) overlaps = await res.json();
    } catch (e) { /* ignore */ }

    var emptyEl = _panel.querySelector(".dep-graph-empty");
    if (agentList.length === 0) {
      _svg.innerHTML = "";
      emptyEl.style.display = "";
      return;
    }
    emptyEl.style.display = "none";

    _lastAgentList = agentList;
    _lastOverlaps = overlaps;
    _drawGraph(agentList, overlaps);

    // Re-render chain form if it's open (preserve across refreshes)
    if (_chainFormState) {
      _renderChainForm();
    }
  }

  function _drawGraph(agentList, overlaps) {
    var w = _svg.clientWidth || 300;
    var h = _svg.clientHeight || 300;
    var cx = w / 2;
    var cy = h / 2;
    var radius = Math.min(cx, cy) - 50;
    var nodeRadius = 18;

    if (agentList.length === 1) {
      radius = 0;
    }

    // Position nodes in a circle
    _nodePositions = {};
    agentList.forEach(function(agent, i) {
      var angle = (2 * Math.PI * i) / agentList.length - Math.PI / 2;
      _nodePositions[agent.name] = {
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle)
      };
    });

    var parts = [];

    // Defs: arrowhead marker
    parts.push('<defs>');
    parts.push('<marker id="chain-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#c9a84c"/></marker>');
    parts.push('<marker id="chain-arrow-hover" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#e8c960"/></marker>');
    parts.push('</defs>');

    // --- File overlap edges ---
    for (var oi = 0; oi < overlaps.length; oi++) {
      var overlap = overlaps[oi];
      var agentNames = overlap.agents || [];
      var sharedFiles = overlap.file || overlap.files || "";
      for (var i = 0; i < agentNames.length; i++) {
        for (var j = i + 1; j < agentNames.length; j++) {
          var a = _nodePositions[agentNames[i]];
          var b = _nodePositions[agentNames[j]];
          if (!a || !b) continue;
          var aAgent = agentList.find(function(x) { return x.name === agentNames[i]; });
          var bAgent = agentList.find(function(x) { return x.name === agentNames[j]; });
          var aStatus = aAgent ? aAgent.status : "";
          var bStatus = bAgent ? bAgent.status : "";
          var isConflict = aStatus === "working" && bStatus === "working";
          var color = isConflict ? (_getCssVar("--dep-status-conflict") || "#ef4444") : "rgba(255,255,255,0.15)";
          var strokeW = isConflict ? 2.5 : 1.5;
          var title = typeof sharedFiles === "string" ? sharedFiles : "";
          parts.push('<line x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '" stroke="' + color + '" stroke-width="' + strokeW + '"><title>' + _escHtml(title) + '</title></line>');
        }
      }
    }

    // --- Same-branch edges ---
    for (var ai = 0; ai < agentList.length; ai++) {
      for (var bi = ai + 1; bi < agentList.length; bi++) {
        if (agentList[ai].branch && agentList[ai].branch === agentList[bi].branch) {
          var pa = _nodePositions[agentList[ai].name];
          var pb = _nodePositions[agentList[bi].name];
          if (pa && pb) {
            var bothWorking = agentList[ai].status === "working" && agentList[bi].status === "working";
            parts.push('<line x1="' + pa.x + '" y1="' + pa.y + '" x2="' + pb.x + '" y2="' + pb.y + '" stroke="' + (bothWorking ? (_getCssVar("--dep-status-conflict") || "#ef4444") : "rgba(255,255,255,0.08)") + '" stroke-width="1" stroke-dasharray="4,4"><title>Same branch: ' + _escHtml(agentList[ai].branch) + '</title></line>');
          }
        }
      }
    }

    // --- Chain edges (directed, dashed gold with arrowheads) ---
    for (var ci = 0; ci < agentList.length; ci++) {
      var chainAgent = agentList[ci];
      if (!chainAgent.chain) continue;
      var chainTargets = Array.isArray(chainAgent.chain) ? chainAgent.chain : [chainAgent.chain];
      var isFanOut = chainTargets.length > 1;

      for (var cti = 0; cti < chainTargets.length; cti++) {
        var ct = chainTargets[cti];
        var fromPos = _nodePositions[chainAgent.name];
        var toPos = _nodePositions[ct.next];
        if (!fromPos || !toPos) continue;

        var dx = toPos.x - fromPos.x;
        var dy = toPos.y - fromPos.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist === 0) continue;

        var x1 = fromPos.x + (dx / dist) * nodeRadius;
        var y1 = fromPos.y + (dy / dist) * nodeRadius;
        var x2 = toPos.x - (dx / dist) * nodeRadius;
        var y2 = toPos.y - (dy / dist) * nodeRadius;

        // Unique data attribute for click handling
        var chainId = chainAgent.name + "|" + ct.next;

        // Chain line (visible)
        parts.push('<line class="dep-chain-edge" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="#c9a84c" stroke-width="2" stroke-dasharray="6,4" marker-end="url(#chain-arrow)" data-chain-id="' + _escHtml(chainId) + '"><title>Chain: ' + _escHtml(chainAgent.name) + ' \u2192 ' + _escHtml(ct.next) + (ct.condition && ct.condition !== "always" ? " (" + ct.condition + ")" : "") + '</title></line>');

        // Wider invisible hit-area for clicking
        parts.push('<line class="dep-chain-hitarea" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="transparent" stroke-width="12" data-chain-id="' + _escHtml(chainId) + '" style="cursor:pointer"></line>');

        // Condition label on chain edge (if not "always")
        if (ct.condition && ct.condition !== "always") {
          var midX = (x1 + x2) / 2;
          var midY = (y1 + y2) / 2;
          // Offset label perpendicular to the line
          var perpX = -dy / dist * 12;
          var perpY = dx / dist * 12;
          var labelText = ct.condition === "branch-has-changes" ? "if changes" : ct.condition;
          parts.push('<text x="' + (midX + perpX) + '" y="' + (midY + perpY) + '" text-anchor="middle" fill="#c9a84c" font-size="9" font-family="var(--font-mono, monospace)" opacity="0.7" pointer-events="none">' + _escHtml(labelText) + '</text>');
        }

        // Fan-out indicator: small dot at the source end
        if (isFanOut) {
          var dotX = fromPos.x + (dx / dist) * (nodeRadius + 6);
          var dotY = fromPos.y + (dy / dist) * (nodeRadius + 6);
          parts.push('<circle cx="' + dotX + '" cy="' + dotY + '" r="3" fill="#c9a84c" opacity="0.6" pointer-events="none"/>');
        }
      }
    }

    // --- Nodes ---
    var statusColors = {
      working: _getCssVar("--dep-status-working") || "#4ade80",
      idle: _getCssVar("--dep-status-idle") || "#60a5fa",
      waiting: _getCssVar("--dep-status-waiting") || "#fbbf24",
      asking: _getCssVar("--dep-status-other") || "#888"
    };
    for (var ni = 0; ni < agentList.length; ni++) {
      var agent = agentList[ni];
      var p = _nodePositions[agent.name];
      var nodeColor = statusColors[agent.status] || (_getCssVar("--dep-status-other") || "#888");

      // Glow ring for nodes with outgoing chains
      if (agent.chain) {
        parts.push('<circle cx="' + p.x + '" cy="' + p.y + '" r="' + (nodeRadius + 4) + '" fill="none" stroke="#c9a84c" stroke-width="1.5" opacity="0.4" pointer-events="none"/>');
      }

      parts.push('<circle cx="' + p.x + '" cy="' + p.y + '" r="' + nodeRadius + '" fill="' + nodeColor + '" opacity="0.85" data-agent="' + _escHtml(agent.name) + '"><title>' + _escHtml(agent.name) + " (" + agent.status + ")" + '</title></circle>');
      parts.push('<text x="' + p.x + '" y="' + (p.y + nodeRadius + 14) + '" text-anchor="middle" fill="var(--text-dim, #999)" font-size="11" font-family="var(--font-mono, monospace)" pointer-events="none">' + _escHtml(agent.name) + '</text>');
    }

    _svg.innerHTML = parts.join("\n");

    // --- Wire event listeners ---

    // Node click (scroll to card) and drag-to-chain
    _svg.querySelectorAll("circle[data-agent]").forEach(function(circle) {
      var agentName = circle.dataset.agent;

      circle.addEventListener("mousedown", function(e) {
        if (_editMode) {
          _onNodeMouseDown(e, agentName);
        }
      });

      circle.addEventListener("mouseup", function(e) {
        if (_editMode && _dragFrom) {
          _onNodeMouseUp(e, agentName);
          return;
        }
      });

      circle.addEventListener("click", function(e) {
        if (_editMode) return; // In edit mode, clicks are for dragging
        var ag = (typeof agents !== "undefined") ? agents.get(agentName) : null;
        if (ag && ag.card) {
          close();
          ag.card.scrollIntoView({ behavior: "smooth", block: "center" });
          var inp = ag.card.querySelector(".card-input textarea");
          if (inp) inp.focus();
        }
      });
    });

    // Chain edge click (edit existing chain)
    _svg.querySelectorAll(".dep-chain-hitarea").forEach(function(hitarea) {
      hitarea.addEventListener("click", function(e) {
        if (!_editMode) return;
        e.stopPropagation();
        var chainId = hitarea.dataset.chainId;
        if (!chainId) return;
        var parts = chainId.split("|");
        var source = parts[0];
        var target = parts[1];

        // Find existing chain data
        var agent = (typeof agents !== "undefined") ? agents.get(source) : null;
        var chain = agent && agent.chain ? (Array.isArray(agent.chain) ? agent.chain : [agent.chain]) : [];
        var existing = chain.find(function(t) { return t.next === target; });

        _showChainForm(source, target, existing ? existing.prompt : "", existing ? existing.condition : "always", true);
      });
    });

    // Hover effect on chain edges
    _svg.querySelectorAll(".dep-chain-hitarea").forEach(function(hitarea) {
      var chainId = hitarea.dataset.chainId;
      var visibleLine = _svg.querySelector('.dep-chain-edge[data-chain-id="' + chainId + '"]');
      hitarea.addEventListener("mouseenter", function() {
        if (!_editMode) return;
        if (visibleLine) {
          visibleLine.setAttribute("stroke", "#e8c960");
          visibleLine.setAttribute("stroke-width", "3");
          visibleLine.setAttribute("marker-end", "url(#chain-arrow-hover)");
        }
      });
      hitarea.addEventListener("mouseleave", function() {
        if (visibleLine) {
          visibleLine.setAttribute("stroke", "#c9a84c");
          visibleLine.setAttribute("stroke-width", "2");
          visibleLine.setAttribute("marker-end", "url(#chain-arrow)");
        }
      });
    });
  }

  function _escHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  window.DependencyGraph = { toggle: toggle, open: open, close: close, isOpen: isOpen };
})();
