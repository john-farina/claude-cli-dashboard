(function() {
  "use strict";

  let _panel = null;
  let _list = null;
  let _pollInterval = null;
  let _isOpen = false;
  let _lastTimestamp = 0;

  function toggle() { if (_isOpen) close(); else open(); }

  function open() {
    if (!_panel) _createDOM();
    _panel.classList.add("visible");
    _isOpen = true;
    _lastTimestamp = Date.now() - 3600000; // last hour
    _refresh();
    _pollInterval = setInterval(_refresh, 5000);
  }

  function close() {
    if (_panel) _panel.classList.remove("visible");
    _isOpen = false;
    if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
  }

  function isOpen() { return _isOpen; }

  function _createDOM() {
    _panel = document.createElement("div");
    _panel.id = "activity-timeline-panel";
    _panel.className = "activity-timeline-panel";
    _panel.innerHTML =
      '<div class="activity-timeline-header">' +
        '<span>Activity Timeline</span>' +
        '<button class="activity-timeline-close" title="Close (L)">&times;</button>' +
      '</div>' +
      '<div class="activity-timeline-list"></div>';
    // Insert before the shell panel
    var shellPanel = document.getElementById("shell-panel");
    if (shellPanel) {
      shellPanel.parentNode.insertBefore(_panel, shellPanel);
    } else {
      document.body.appendChild(_panel);
    }
    _list = _panel.querySelector(".activity-timeline-list");
    _panel.querySelector(".activity-timeline-close").addEventListener("click", close);
  }

  async function _refresh() {
    if (!_isOpen || !_list) return;
    try {
      var res = await fetch("/api/activity?since=" + _lastTimestamp);
      if (!res.ok) return;
      var events = await res.json();
      if (events.length === 0 && _list.children.length > 0) return;

      // Append new events
      for (var i = 0; i < events.length; i++) {
        var evt = events[i];
        if (evt.timestamp <= _lastTimestamp) continue;
        _lastTimestamp = evt.timestamp;

        var item = document.createElement("div");
        item.className = "activity-timeline-item";

        var icon = _getIcon(evt.type);
        var time = _formatTime(evt.timestamp);
        var agentColor = _getAgentColor(evt.agent);

        item.innerHTML =
          '<span class="activity-timeline-icon">' + icon + '</span>' +
          '<span class="activity-timeline-agent" style="color:' + agentColor + '">' + _escapeHtml(evt.agent) + '</span>' +
          '<span class="activity-timeline-detail">' + _escapeHtml(evt.detail) + '</span>' +
          '<span class="activity-timeline-time">' + time + '</span>';

        (function(agentName) {
          item.addEventListener("click", function() {
            var agentEntry = typeof agents !== "undefined" ? agents.get(agentName) : null;
            if (agentEntry && agentEntry.card) {
              agentEntry.card.scrollIntoView({ behavior: "smooth", block: "center" });
            }
          });
        })(evt.agent);

        _list.appendChild(item);
      }

      // Auto-scroll to newest
      _list.scrollTop = _list.scrollHeight;

      // Trim old items
      while (_list.children.length > 200) _list.removeChild(_list.firstChild);
    } catch (e) { /* ignore */ }
  }

  function _getIcon(type) {
    switch (type) {
      case "status-change": return "\u25CF";
      case "doc-save": return "\uD83D\uDCC4";
      case "file-edit": return "\u270E";
      default: return "\u2022";
    }
  }

  function _getAgentColor(name) {
    // Simple hash to color
    var hash = 0;
    for (var i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    var hue = Math.abs(hash) % 360;
    return "hsl(" + hue + ", 60%, 65%)";
  }

  function _formatTime(ts) {
    var d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function _escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  window.ActivityTimeline = { toggle: toggle, open: open, close: close, isOpen: isOpen };
})();
