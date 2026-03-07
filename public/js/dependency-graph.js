(function() {
  "use strict";

  let _panel = null;
  let _svg = null;
  let _pollInterval = null;
  let _isOpen = false;

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
  }

  function isOpen() { return _isOpen; }

  function _createDOM() {
    _panel = document.createElement("div");
    _panel.id = "dep-graph-panel";
    _panel.className = "dep-graph-panel";
    _panel.innerHTML = `
      <div class="dep-graph-header">
        <span>Agent Dependencies</span>
        <button class="dep-graph-close" title="Close (G)">&times;</button>
      </div>
      <div class="dep-graph-body">
        <svg class="dep-graph-svg"></svg>
        <div class="dep-graph-legend">
          <span><span class="dep-dot" style="background:#4ade80"></span> working</span>
          <span><span class="dep-dot" style="background:#60a5fa"></span> idle</span>
          <span><span class="dep-dot" style="background:#fbbf24"></span> waiting</span>
          <span><span class="dep-dot" style="background:#888"></span> other</span>
          <span><span class="dep-line dep-line-red"></span> conflict</span>
        </div>
        <div class="dep-graph-empty" style="display:none">No agents or no file overlaps detected yet.</div>
      </div>
    `;
    document.body.appendChild(_panel);
    _svg = _panel.querySelector(".dep-graph-svg");
    _panel.querySelector(".dep-graph-close").addEventListener("click", close);
  }

  async function _refresh() {
    if (!_isOpen || !_svg) return;

    // Get agent data from the global agents Map
    var agentList = [];
    if (typeof agents !== "undefined") {
      for (var entry of agents) {
        var name = entry[0];
        var agent = entry[1];
        if (agent.type !== "terminal") {
          agentList.push({ name: name, status: agent.status || "idle", branch: agent.branch || "" });
        }
      }
    }

    // Get file overlaps from API
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

    _drawGraph(agentList, overlaps);
  }

  function _drawGraph(agentList, overlaps) {
    var w = _svg.clientWidth || 300;
    var h = _svg.clientHeight || 300;
    var cx = w / 2;
    var cy = h / 2;
    var radius = Math.min(cx, cy) - 50;
    var nodeRadius = 18;

    // Single agent: place in center
    if (agentList.length === 1) {
      radius = 0;
    }

    // Position nodes in a circle
    var positions = {};
    agentList.forEach(function(agent, i) {
      var angle = (2 * Math.PI * i) / agentList.length - Math.PI / 2;
      positions[agent.name] = {
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle)
      };
    });

    // Build SVG content
    var parts = [];

    // Draw edges
    for (var oi = 0; oi < overlaps.length; oi++) {
      var overlap = overlaps[oi];
      var agentNames = overlap.agents || [];
      var sharedFiles = overlap.file || overlap.files || "";
      for (var i = 0; i < agentNames.length; i++) {
        for (var j = i + 1; j < agentNames.length; j++) {
          var a = positions[agentNames[i]];
          var b = positions[agentNames[j]];
          if (!a || !b) continue;
          // Red if both are working
          var aAgent = agentList.find(function(x) { return x.name === agentNames[i]; });
          var bAgent = agentList.find(function(x) { return x.name === agentNames[j]; });
          var aStatus = aAgent ? aAgent.status : "";
          var bStatus = bAgent ? bAgent.status : "";
          var isConflict = aStatus === "working" && bStatus === "working";
          var color = isConflict ? "#ef4444" : "rgba(255,255,255,0.15)";
          var strokeW = isConflict ? 2.5 : 1.5;
          var title = typeof sharedFiles === "string" ? sharedFiles : "";
          parts.push('<line x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '" stroke="' + color + '" stroke-width="' + strokeW + '"><title>' + _escHtml(title) + '</title></line>');
        }
      }
    }

    // Also draw edges for agents on same branch
    for (var ai = 0; ai < agentList.length; ai++) {
      for (var bi = ai + 1; bi < agentList.length; bi++) {
        if (agentList[ai].branch && agentList[ai].branch === agentList[bi].branch) {
          var pa = positions[agentList[ai].name];
          var pb = positions[agentList[bi].name];
          if (pa && pb) {
            var bothWorking = agentList[ai].status === "working" && agentList[bi].status === "working";
            parts.push('<line x1="' + pa.x + '" y1="' + pa.y + '" x2="' + pb.x + '" y2="' + pb.y + '" stroke="' + (bothWorking ? "#ef4444" : "rgba(255,255,255,0.08)") + '" stroke-width="1" stroke-dasharray="4,4"><title>Same branch: ' + _escHtml(agentList[ai].branch) + '</title></line>');
          }
        }
      }
    }

    // Draw nodes
    var statusColors = { working: "#4ade80", idle: "#60a5fa", waiting: "#fbbf24", asking: "#888" };
    for (var ni = 0; ni < agentList.length; ni++) {
      var agent = agentList[ni];
      var p = positions[agent.name];
      var nodeColor = statusColors[agent.status] || "#888";
      parts.push('<circle cx="' + p.x + '" cy="' + p.y + '" r="' + nodeRadius + '" fill="' + nodeColor + '" opacity="0.85" style="cursor:pointer" data-agent="' + _escHtml(agent.name) + '"><title>' + _escHtml(agent.name) + " (" + agent.status + ")" + '</title></circle>');
      parts.push('<text x="' + p.x + '" y="' + (p.y + nodeRadius + 14) + '" text-anchor="middle" fill="var(--text-dim, #999)" font-size="11" font-family="var(--font-mono, monospace)">' + _escHtml(agent.name) + '</text>');
    }

    _svg.innerHTML = parts.join("\n");

    // Click node to scroll to card
    _svg.querySelectorAll("circle[data-agent]").forEach(function(circle) {
      circle.addEventListener("click", function() {
        var name = circle.dataset.agent;
        var agent = (typeof agents !== "undefined") ? agents.get(name) : null;
        if (agent && agent.card) {
          close();
          agent.card.scrollIntoView({ behavior: "smooth", block: "center" });
          var inp = agent.card.querySelector(".card-input textarea");
          if (inp) inp.focus();
        }
      });
    });
  }

  function _escHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  window.DependencyGraph = { toggle: toggle, open: open, close: close, isOpen: isOpen };
})();
