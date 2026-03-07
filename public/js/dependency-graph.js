(function() {
  "use strict";

  function _getCssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || null;
  }

  let _panel = null;
  let _svg = null;
  let _pollInterval = null;
  let _isOpen = false;

  // Canvas state
  let _canvasNodes = []; // { id, x, y, name, prompt, workdir, type: 'existing'|'new', configured: bool, status, branch, chain }
  let _canvasConnections = []; // { fromId, toId, prompt, condition }
  let _nextNodeId = 1;

  // Interaction state
  let _draggingNode = null;
  let _dragOffset = { x: 0, y: 0 };
  let _dragPort = null; // { nodeId, type: 'out' }
  let _tempLine = null;
  let _selectedNode = null;
  let _launching = false;

  // Cached workspaces
  let _workspaces = [];

  // Chain form state for existing chain editing
  let _editMode = false;
  let _chainFormState = null;

  function toggle() {
    if (_isOpen) close(); else open();
  }

  function open() {
    if (!_panel) _createDOM();
    _panel.classList.add("visible");
    _isOpen = true;
    _fetchWorkspaces();
    _populateExistingAgents();
    _render();
    _pollInterval = setInterval(_refreshExisting, 10000);
  }

  function close() {
    if (_panel) _panel.classList.remove("visible");
    _isOpen = false;
    if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
    _selectedNode = null;
    _draggingNode = null;
    _dragPort = null;
    _chainFormState = null;
    // Clear new nodes on close (they're ephemeral)
    _canvasNodes = _canvasNodes.filter(function(n) { return n.type === "existing"; });
    _canvasConnections = _canvasConnections.filter(function(c) {
      var fromNode = _canvasNodes.find(function(n) { return n.id === c.fromId; });
      var toNode = _canvasNodes.find(function(n) { return n.id === c.toId; });
      return fromNode && toNode;
    });
  }

  function isOpen() { return _isOpen; }

  function _createDOM() {
    _panel = document.createElement("div");
    _panel.id = "workflow-canvas-panel";
    _panel.className = "workflow-canvas";
    _panel.innerHTML = `
      <div class="workflow-header">
        <span>Workflow Canvas</span>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="dep-graph-edit-toggle" title="Toggle chain editing mode">Edit Chains</button>
          <button class="workflow-add-btn" title="Add new agent node">+ Add Agent</button>
          <button class="workflow-launch" title="Launch all new agents" disabled>Launch Workflow</button>
          <button class="dep-graph-close" title="Close (G)">&times;</button>
        </div>
      </div>
      <div class="workflow-body" style="flex:1;display:flex;flex-direction:column;overflow:hidden">
        <svg class="workflow-svg"></svg>
        <div class="dep-graph-legend">
          <span><span class="dep-dot" style="background:var(--dep-status-working)"></span> working</span>
          <span><span class="dep-dot" style="background:var(--dep-status-idle)"></span> idle</span>
          <span><span class="dep-dot" style="background:var(--dep-status-waiting)"></span> waiting</span>
          <span><span class="dep-dot" style="background:var(--dep-status-other)"></span> other</span>
          <span><span class="dep-line dep-line-red"></span> conflict</span>
          <span><span class="dep-line dep-line-chain"></span> chain</span>
          <span><span class="dep-dot" style="background:transparent;border:2px dashed #c9a84c;width:6px;height:6px"></span> new</span>
        </div>
        <div class="dep-graph-chain-form-container"></div>
        <div class="workflow-config" style="display:none"></div>
      </div>
    `;
    document.body.appendChild(_panel);
    _svg = _panel.querySelector(".workflow-svg");

    _panel.querySelector(".dep-graph-close").addEventListener("click", close);
    _panel.querySelector(".workflow-add-btn").addEventListener("click", _addNewNode);
    _panel.querySelector(".workflow-launch").addEventListener("click", _launchWorkflow);

    // Edit mode toggle
    var editBtn = _panel.querySelector(".dep-graph-edit-toggle");
    editBtn.addEventListener("click", function() {
      _editMode = !_editMode;
      editBtn.classList.toggle("active", _editMode);
      if (!_editMode) {
        _chainFormState = null;
        _hideChainForm();
      }
    });

    // SVG mouse events
    _svg.addEventListener("mousemove", _onSvgMouseMove);
    _svg.addEventListener("mouseup", _onSvgMouseUp);
    _svg.addEventListener("mouseleave", _onSvgMouseLeave);
  }

  async function _fetchWorkspaces() {
    try {
      var res = await fetch("/api/config");
      if (res.ok) {
        var data = await res.json();
        _workspaces = data.workspaces || [];
      }
    } catch (e) { /* ignore */ }
  }

  function _populateExistingAgents() {
    var existingIds = new Set(_canvasNodes.filter(function(n) { return n.type === "existing"; }).map(function(n) { return n.name; }));
    var currentAgents = new Set();

    if (typeof agents !== "undefined") {
      var idx = 0;
      for (var entry of agents) {
        var name = entry[0];
        var agent = entry[1];
        if (agent.type === "terminal") continue;
        currentAgents.add(name);

        var existing = _canvasNodes.find(function(n) { return n.type === "existing" && n.name === name; });
        if (existing) {
          // Update status/branch
          existing.status = agent.status || "idle";
          existing.branch = agent.branch || "";
          existing.chain = agent.chain || null;
        } else {
          // Add new existing agent
          _canvasNodes.push({
            id: "existing-" + name,
            x: 0, y: 0, // Will be auto-laid out
            name: name,
            prompt: "",
            workdir: agent.workdir || "",
            type: "existing",
            configured: true,
            status: agent.status || "idle",
            branch: agent.branch || "",
            chain: agent.chain || null,
          });
        }
        idx++;
      }
    }

    // Remove stale existing agents
    _canvasNodes = _canvasNodes.filter(function(n) {
      return n.type !== "existing" || currentAgents.has(n.name);
    });

    // Auto-layout positions
    _autoLayout();
  }

  function _autoLayout() {
    var existingNodes = _canvasNodes.filter(function(n) { return n.type === "existing"; });
    var newNodes = _canvasNodes.filter(function(n) { return n.type === "new"; });

    var svgRect = _svg ? _svg.getBoundingClientRect() : { width: 560, height: 400 };
    var w = svgRect.width || 560;
    var h = svgRect.height || 400;

    // Layout existing nodes on the left side in a column
    var startX = 100;
    var startY = 60;
    var ySpacing = 70;

    for (var i = 0; i < existingNodes.length; i++) {
      if (existingNodes[i].x === 0 && existingNodes[i].y === 0) {
        existingNodes[i].x = startX;
        existingNodes[i].y = startY + i * ySpacing;
      }
    }

    // Layout new nodes to the right
    var newStartX = 340;
    for (var j = 0; j < newNodes.length; j++) {
      if (newNodes[j].x === 0 && newNodes[j].y === 0) {
        newNodes[j].x = newStartX;
        newNodes[j].y = startY + j * ySpacing;
      }
    }
  }

  function _refreshExisting() {
    if (!_isOpen) return;
    _populateExistingAgents();
    _render();
    if (_chainFormState) _renderChainForm();
  }

  // --- Add new node ---

  function _addNewNode() {
    var id = "new-" + _nextNodeId++;
    _canvasNodes.push({
      id: id,
      x: 0, y: 0,
      name: "",
      prompt: "",
      workdir: _workspaces.length > 0 ? _workspaces[0].path : "",
      type: "new",
      configured: false,
      status: "new",
      branch: "",
      chain: null,
    });
    _autoLayout();
    _selectedNode = id;
    _render();
    _showNodeConfig(id);
    _updateLaunchButton();
  }

  // --- Node config panel ---

  function _showNodeConfig(nodeId) {
    var node = _canvasNodes.find(function(n) { return n.id === nodeId; });
    if (!node || node.type !== "new") {
      _hideNodeConfig();
      return;
    }
    _selectedNode = nodeId;

    var configEl = _panel.querySelector(".workflow-config");
    configEl.style.display = "";

    var workdirOptions = _workspaces.map(function(ws) {
      var selected = ws.path === node.workdir ? " selected" : "";
      return '<option value="' + _escHtml(ws.path) + '"' + selected + '>' + _escHtml(ws.label || ws.path) + '</option>';
    }).join("");

    configEl.innerHTML = `
      <div class="workflow-config-title">Configure Node</div>
      <div style="display:flex;gap:8px">
        <input type="text" class="wf-node-name" placeholder="Agent name (auto-generated if blank)" value="${_escHtml(node.name)}" style="flex:1" />
        <select class="wf-node-workdir" style="flex:1">${workdirOptions}</select>
      </div>
      <textarea class="wf-node-prompt" placeholder="Prompt / task for this agent..." rows="3">${_escHtml(node.prompt)}</textarea>
      <div class="workflow-config-actions">
        <button class="workflow-btn-primary wf-save-node">Save Node</button>
        <button class="workflow-btn-danger wf-remove-node">Remove</button>
        <button class="workflow-btn-secondary wf-cancel-config">Cancel</button>
      </div>
    `;

    configEl.querySelector(".wf-save-node").addEventListener("click", function() {
      var nameVal = configEl.querySelector(".wf-node-name").value.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "");
      var promptVal = configEl.querySelector(".wf-node-prompt").value.trim();
      var workdirVal = configEl.querySelector(".wf-node-workdir").value;

      node.name = nameVal;
      node.prompt = promptVal;
      node.workdir = workdirVal;
      node.configured = !!promptVal;

      _hideNodeConfig();
      _render();
      _updateLaunchButton();
    });

    configEl.querySelector(".wf-remove-node").addEventListener("click", function() {
      _canvasNodes = _canvasNodes.filter(function(n) { return n.id !== nodeId; });
      _canvasConnections = _canvasConnections.filter(function(c) { return c.fromId !== nodeId && c.toId !== nodeId; });
      _selectedNode = null;
      _hideNodeConfig();
      _render();
      _updateLaunchButton();
    });

    configEl.querySelector(".wf-cancel-config").addEventListener("click", function() {
      _hideNodeConfig();
    });

    _render();
    setTimeout(function() { configEl.querySelector(".wf-node-prompt").focus(); }, 50);
  }

  function _hideNodeConfig() {
    var configEl = _panel.querySelector(".workflow-config");
    if (configEl) {
      configEl.style.display = "none";
      configEl.innerHTML = "";
    }
  }

  // --- Launch workflow ---

  function _updateLaunchButton() {
    var btn = _panel.querySelector(".workflow-launch");
    if (!btn) return;
    var newNodes = _canvasNodes.filter(function(n) { return n.type === "new" && n.configured; });
    btn.disabled = newNodes.length === 0 || _launching;
    btn.textContent = _launching ? "Launching..." : "Launch Workflow (" + newNodes.length + ")";
  }

  async function _launchWorkflow() {
    var newNodes = _canvasNodes.filter(function(n) { return n.type === "new" && n.configured; });
    if (newNodes.length === 0) return;

    _launching = true;
    _updateLaunchButton();

    // Build payload: nodes in topological order
    // Simple topological sort: sources first (no incoming connections from new nodes)
    var ordered = _topologicalSort(newNodes);

    var payload = {
      nodes: ordered.map(function(n) {
        return { id: n.id, name: n.name, workdir: n.workdir, prompt: n.prompt };
      }),
      connections: _canvasConnections.map(function(c) {
        return { from: c.fromId, to: c.toId, prompt: c.prompt || "", condition: c.condition || "always" };
      }),
    };

    try {
      var res = await fetch("/api/workflow/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      var data = await res.json();
      if (data.error) {
        alert("Workflow launch failed: " + data.error);
      } else {
        // Remove launched nodes from canvas (they become existing on next refresh)
        var createdIds = new Set((data.created || []).map(function(c) { return c.id; }));
        _canvasNodes = _canvasNodes.filter(function(n) { return !createdIds.has(n.id); });
        _canvasConnections = _canvasConnections.filter(function(c) {
          return !createdIds.has(c.fromId) || !createdIds.has(c.toId);
        });
        // Force refresh to pick up new agents
        setTimeout(function() { _refreshExisting(); }, 1000);
        setTimeout(function() { _refreshExisting(); }, 3000);
      }
    } catch (e) {
      alert("Workflow launch error: " + e.message);
    }

    _launching = false;
    _updateLaunchButton();
    _render();
  }

  function _topologicalSort(nodes) {
    var nodeIds = new Set(nodes.map(function(n) { return n.id; }));
    var inDegree = {};
    nodes.forEach(function(n) { inDegree[n.id] = 0; });

    _canvasConnections.forEach(function(c) {
      if (nodeIds.has(c.toId)) {
        inDegree[c.toId] = (inDegree[c.toId] || 0) + 1;
      }
    });

    var queue = nodes.filter(function(n) { return (inDegree[n.id] || 0) === 0; });
    var result = [];

    while (queue.length > 0) {
      var node = queue.shift();
      result.push(node);
      _canvasConnections.forEach(function(c) {
        if (c.fromId === node.id && nodeIds.has(c.toId)) {
          inDegree[c.toId]--;
          if (inDegree[c.toId] === 0) {
            var targetNode = nodes.find(function(n) { return n.id === c.toId; });
            if (targetNode) queue.push(targetNode);
          }
        }
      });
    }

    // Append any remaining (cycles or disconnected)
    nodes.forEach(function(n) {
      if (!result.includes(n)) result.push(n);
    });

    return result;
  }

  // --- SVG Rendering ---

  function _render() {
    if (!_svg) return;

    var w = _svg.clientWidth || 560;
    var h = _svg.clientHeight || 400;
    var nodeW = 140;
    var nodeH = 50;

    var parts = [];

    // Defs
    parts.push('<defs>');
    parts.push('<marker id="wf-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#c9a84c"/></marker>');
    parts.push('<marker id="wf-arrow-hover" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#e8c960"/></marker>');
    parts.push('<marker id="wf-arrow-overlap" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="rgba(255,255,255,0.15)"/></marker>');
    parts.push('</defs>');

    // --- File overlap edges (from existing agents) ---
    _renderOverlapEdges(parts, nodeW, nodeH);

    // --- Existing chain edges ---
    _renderExistingChains(parts, nodeW, nodeH);

    // --- Canvas connections (new workflow connections) ---
    for (var ci = 0; ci < _canvasConnections.length; ci++) {
      var conn = _canvasConnections[ci];
      var fromNode = _canvasNodes.find(function(n) { return n.id === conn.fromId; });
      var toNode = _canvasNodes.find(function(n) { return n.id === conn.toId; });
      if (!fromNode || !toNode) continue;

      // Don't draw if this is an existing chain (already drawn above)
      if (fromNode.type === "existing" && toNode.type === "existing") continue;

      var x1 = fromNode.x + nodeW;
      var y1 = fromNode.y + nodeH / 2;
      var x2 = toNode.x;
      var y2 = toNode.y + nodeH / 2;
      var path = _bezierPath(x1, y1, x2, y2);

      parts.push('<path class="workflow-connection" d="' + path + '" marker-end="url(#wf-arrow)" />');

      // Condition label
      if (conn.condition && conn.condition !== "always") {
        var midX = (x1 + x2) / 2;
        var midY = (y1 + y2) / 2 - 10;
        var label = conn.condition === "branch-has-changes" ? "if changes" : conn.condition;
        parts.push('<text x="' + midX + '" y="' + midY + '" text-anchor="middle" fill="#c9a84c" font-size="9" opacity="0.7" pointer-events="none">' + _escHtml(label) + '</text>');
      }
    }

    // --- Temp drag line ---
    // (drawn dynamically, not in static SVG)

    // --- Nodes ---
    var statusColors = {
      working: _getCssVar("--dep-status-working") || "#4ade80",
      idle: _getCssVar("--dep-status-idle") || "#60a5fa",
      waiting: _getCssVar("--dep-status-waiting") || "#fbbf24",
      asking: _getCssVar("--dep-status-other") || "#888",
      new: "transparent",
    };

    for (var ni = 0; ni < _canvasNodes.length; ni++) {
      var node = _canvasNodes[ni];
      var isExisting = node.type === "existing";
      var isSelected = _selectedNode === node.id;
      var nodeColor = statusColors[node.status] || (_getCssVar("--dep-status-other") || "#888");

      var fillColor = isExisting ? "rgba(255,255,255,0.04)" : "rgba(201,168,76,0.06)";
      var strokeColor = isExisting ? nodeColor : (node.configured ? "#c9a84c" : "#c9a84c");
      var strokeDash = isExisting ? "" : (node.configured ? "" : ' stroke-dasharray="6,3"');
      var strokeWidth = isSelected ? 2 : 1.5;
      var opacity = isExisting ? 0.7 : 1;
      var cls = "workflow-node" + (isExisting ? " existing" : " new") + (node.configured ? " configured" : "") + (isSelected ? " selected" : "");

      parts.push('<g class="' + cls + '" data-id="' + _escHtml(node.id) + '" transform="translate(' + node.x + ',' + node.y + ')" style="opacity:' + opacity + '">');

      // Background rect
      parts.push('<rect width="' + nodeW + '" height="' + nodeH + '" rx="8" fill="' + fillColor + '" stroke="' + strokeColor + '" stroke-width="' + strokeWidth + '"' + strokeDash + ' />');

      // Status indicator (small circle)
      if (isExisting) {
        parts.push('<circle cx="12" cy="14" r="4" fill="' + nodeColor + '" />');
      }

      // Name
      var displayName = node.name || (isExisting ? "?" : "Untitled");
      if (displayName.length > 14) displayName = displayName.substring(0, 13) + "\u2026";
      var textX = isExisting ? 22 : 10;
      parts.push('<text x="' + textX + '" y="19" fill="var(--text, #eee)" font-size="12" font-family="var(--font-mono, monospace)" pointer-events="none">' + _escHtml(displayName) + '</text>');

      // Subtitle
      var subtitle = isExisting ? (node.status + (node.branch ? " \u00B7 " + node.branch : "")) : (node.configured ? "configured" : "click to configure");
      if (subtitle.length > 22) subtitle = subtitle.substring(0, 21) + "\u2026";
      parts.push('<text x="10" y="36" fill="var(--text-dim, #888)" font-size="10" font-family="var(--font-mono, monospace)" pointer-events="none">' + _escHtml(subtitle) + '</text>');

      // Output port (right side)
      parts.push('<circle cx="' + nodeW + '" cy="' + (nodeH / 2) + '" r="6" class="port port-out" data-node="' + _escHtml(node.id) + '" data-port="out" />');

      // Input port (left side)
      parts.push('<circle cx="0" cy="' + (nodeH / 2) + '" r="6" class="port port-in" data-node="' + _escHtml(node.id) + '" data-port="in" />');

      parts.push('</g>');
    }

    _svg.innerHTML = parts.join("\n");

    // Wire event listeners
    _wireNodeEvents();
  }

  function _renderOverlapEdges(parts, nodeW, nodeH) {
    // Fetch overlaps asynchronously (cached from last poll)
    // For now, just draw same-branch edges between existing agents
    var existingNodes = _canvasNodes.filter(function(n) { return n.type === "existing"; });
    for (var i = 0; i < existingNodes.length; i++) {
      for (var j = i + 1; j < existingNodes.length; j++) {
        if (existingNodes[i].branch && existingNodes[i].branch === existingNodes[j].branch) {
          var ax = existingNodes[i].x + nodeW / 2;
          var ay = existingNodes[i].y + nodeH / 2;
          var bx = existingNodes[j].x + nodeW / 2;
          var by = existingNodes[j].y + nodeH / 2;
          var bothWorking = existingNodes[i].status === "working" && existingNodes[j].status === "working";
          var color = bothWorking ? (_getCssVar("--dep-status-conflict") || "#ef4444") : "rgba(255,255,255,0.08)";
          parts.push('<line x1="' + ax + '" y1="' + ay + '" x2="' + bx + '" y2="' + by + '" stroke="' + color + '" stroke-width="1" stroke-dasharray="4,4"><title>Same branch: ' + _escHtml(existingNodes[i].branch) + '</title></line>');
        }
      }
    }
  }

  function _renderExistingChains(parts, nodeW, nodeH) {
    var existingNodes = _canvasNodes.filter(function(n) { return n.type === "existing"; });
    for (var ci = 0; ci < existingNodes.length; ci++) {
      var agent = existingNodes[ci];
      if (!agent.chain) continue;
      var chainTargets = Array.isArray(agent.chain) ? agent.chain : [agent.chain];

      for (var cti = 0; cti < chainTargets.length; cti++) {
        var ct = chainTargets[cti];
        var targetNode = _canvasNodes.find(function(n) { return n.name === ct.next; });
        if (!targetNode) continue;

        var x1 = agent.x + nodeW;
        var y1 = agent.y + nodeH / 2;
        var x2 = targetNode.x;
        var y2 = targetNode.y + nodeH / 2;
        var path = _bezierPath(x1, y1, x2, y2);
        var chainId = agent.name + "|" + ct.next;

        parts.push('<path class="workflow-connection existing-chain" d="' + path + '" stroke-dasharray="6,4" marker-end="url(#wf-arrow)" data-chain-id="' + _escHtml(chainId) + '" />');
        // Hit area for editing
        parts.push('<path class="workflow-chain-hitarea" d="' + path + '" stroke="transparent" stroke-width="14" fill="none" data-chain-id="' + _escHtml(chainId) + '" style="cursor:pointer" />');

        if (ct.condition && ct.condition !== "always") {
          var midX = (x1 + x2) / 2;
          var midY = (y1 + y2) / 2 - 10;
          var label = ct.condition === "branch-has-changes" ? "if changes" : ct.condition;
          parts.push('<text x="' + midX + '" y="' + midY + '" text-anchor="middle" fill="#c9a84c" font-size="9" opacity="0.7" pointer-events="none">' + _escHtml(label) + '</text>');
        }
      }
    }
  }

  function _bezierPath(x1, y1, x2, y2) {
    var dx = Math.abs(x2 - x1) * 0.5;
    return "M" + x1 + "," + y1 + " C" + (x1 + dx) + "," + y1 + " " + (x2 - dx) + "," + y2 + " " + x2 + "," + y2;
  }

  // --- Event wiring ---

  function _wireNodeEvents() {
    // Node body drag (move) and click (select)
    _svg.querySelectorAll(".workflow-node").forEach(function(g) {
      var nodeId = g.dataset.id;
      var rect = g.querySelector("rect");

      rect.addEventListener("mousedown", function(e) {
        if (e.target.classList.contains("port")) return;
        e.preventDefault();

        var node = _canvasNodes.find(function(n) { return n.id === nodeId; });
        if (!node) return;

        var svgRect = _svg.getBoundingClientRect();
        _draggingNode = nodeId;
        _dragOffset = { x: e.clientX - svgRect.left - node.x, y: e.clientY - svgRect.top - node.y };
      });

      rect.addEventListener("click", function(e) {
        if (_draggingNode) return; // Was dragging, don't count as click
        var node = _canvasNodes.find(function(n) { return n.id === nodeId; });
        if (!node) return;

        if (node.type === "new") {
          _showNodeConfig(nodeId);
        } else if (node.type === "existing") {
          // Scroll to agent card
          var ag = (typeof agents !== "undefined") ? agents.get(node.name) : null;
          if (ag && ag.card) {
            close();
            ag.card.scrollIntoView({ behavior: "smooth", block: "center" });
            var inp = ag.card.querySelector(".card-input textarea");
            if (inp) inp.focus();
          }
        }
      });
    });

    // Port drag (create connection)
    _svg.querySelectorAll(".port").forEach(function(port) {
      port.addEventListener("mousedown", function(e) {
        e.preventDefault();
        e.stopPropagation();
        var nodeId = port.dataset.node;
        var portType = port.dataset.port;

        _dragPort = { nodeId: nodeId, type: portType };

        // Create temp line
        var node = _canvasNodes.find(function(n) { return n.id === nodeId; });
        if (!node) return;

        var nodeW = 140, nodeH = 50;
        var sx = portType === "out" ? node.x + nodeW : node.x;
        var sy = node.y + nodeH / 2;

        var line = document.createElementNS("http://www.w3.org/2000/svg", "path");
        line.setAttribute("d", "M" + sx + "," + sy + " L" + sx + "," + sy);
        line.setAttribute("class", "workflow-temp-line");
        _svg.appendChild(line);
        _tempLine = { el: line, sx: sx, sy: sy };
      });
    });

    // Chain hitarea click (edit existing chain)
    _svg.querySelectorAll(".workflow-chain-hitarea").forEach(function(hitarea) {
      hitarea.addEventListener("click", function(e) {
        if (!_editMode) return;
        e.stopPropagation();
        var chainId = hitarea.dataset.chainId;
        if (!chainId) return;
        var parts = chainId.split("|");
        var source = parts[0];
        var target = parts[1];

        var agent = (typeof agents !== "undefined") ? agents.get(source) : null;
        var chain = agent && agent.chain ? (Array.isArray(agent.chain) ? agent.chain : [agent.chain]) : [];
        var existing = chain.find(function(t) { return t.next === target; });

        _showChainForm(source, target, existing ? existing.prompt : "", existing ? existing.condition : "always", true);
      });

      // Hover effects
      var chainId = hitarea.dataset.chainId;
      var visiblePath = _svg.querySelector('.existing-chain[data-chain-id="' + chainId + '"]');
      hitarea.addEventListener("mouseenter", function() {
        if (!_editMode) return;
        if (visiblePath) {
          visiblePath.setAttribute("stroke", "#e8c960");
          visiblePath.setAttribute("stroke-width", "3");
        }
      });
      hitarea.addEventListener("mouseleave", function() {
        if (visiblePath) {
          visiblePath.setAttribute("stroke", "#c9a84c");
          visiblePath.setAttribute("stroke-width", "2");
        }
      });
    });
  }

  // --- SVG interaction handlers ---

  function _onSvgMouseMove(e) {
    var svgRect = _svg.getBoundingClientRect();
    var mx = e.clientX - svgRect.left;
    var my = e.clientY - svgRect.top;

    // Node dragging
    if (_draggingNode) {
      var node = _canvasNodes.find(function(n) { return n.id === _draggingNode; });
      if (node) {
        node.x = mx - _dragOffset.x;
        node.y = my - _dragOffset.y;
        _render();
      }
      return;
    }

    // Port dragging (temp connection line)
    if (_dragPort && _tempLine) {
      var path = _bezierPath(_tempLine.sx, _tempLine.sy, mx, my);
      _tempLine.el.setAttribute("d", path);
    }
  }

  function _onSvgMouseUp(e) {
    if (_draggingNode) {
      _draggingNode = null;
      return;
    }

    if (_dragPort && _tempLine) {
      // Check if we're over a port
      var target = e.target.closest(".port");
      if (target && target.dataset.node !== _dragPort.nodeId) {
        var fromId, toId;
        if (_dragPort.type === "out") {
          fromId = _dragPort.nodeId;
          toId = target.dataset.node;
        } else {
          fromId = target.dataset.node;
          toId = _dragPort.nodeId;
        }

        // Don't duplicate
        var exists = _canvasConnections.some(function(c) { return c.fromId === fromId && c.toId === toId; });
        if (!exists) {
          _canvasConnections.push({ fromId: fromId, toId: toId, prompt: "", condition: "always" });
        }
      }

      // Clean up temp line
      if (_tempLine.el && _tempLine.el.parentNode) {
        _tempLine.el.parentNode.removeChild(_tempLine.el);
      }
      _tempLine = null;
      _dragPort = null;
      _render();
    }
  }

  function _onSvgMouseLeave(e) {
    if (_tempLine) {
      if (_tempLine.el && _tempLine.el.parentNode) {
        _tempLine.el.parentNode.removeChild(_tempLine.el);
      }
      _tempLine = null;
      _dragPort = null;
    }
    if (_draggingNode) {
      _draggingNode = null;
    }
  }

  // --- Chain form (for editing existing chains, same as before) ---

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

    var textarea = container.querySelector(".chain-form-prompt");
    var select = container.querySelector(".chain-form-condition");

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

    textarea.focus();
  }

  async function _saveChain(source, target, prompt, condition) {
    if (!prompt.trim()) {
      alert("Prompt cannot be empty.");
      return;
    }

    var agent = (typeof agents !== "undefined") ? agents.get(source) : null;
    var existingChain = (agent && agent.chain) ? (Array.isArray(agent.chain) ? agent.chain : [agent.chain]) : [];

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
      if (agent) agent.chain = newTargets;
      _hideChainForm();
      _refreshExisting();
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
        await fetch("/api/sessions/" + encodeURIComponent(source) + "/chain", { method: "DELETE" });
        if (agent) agent.chain = null;
      } else {
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
      _refreshExisting();
    } catch (e) {
      alert("Failed to delete chain: " + e.message);
    }
  }

  // --- Utility ---

  function _escHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  window.DependencyGraph = { toggle: toggle, open: open, close: close, isOpen: isOpen };
})();
