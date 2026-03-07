(function() {
  "use strict";

  let _panel = null;
  let _activeTab = "prs";
  let _isOpen = false;
  let _pollInterval = null;
  let _filterAgent = null;
  let _prCache = null;
  let _expandedFiles = new Set(); // track expanded file lists in workspace tab
  let _expandedDiffs = new Set(); // track expanded inline diffs

  function toggle() { if (_isOpen) close(); else open(); }

  function open(tab, filterAgent) {
    if (tab) _activeTab = tab;
    if (filterAgent !== undefined) _filterAgent = filterAgent || null;
    if (!_panel) _createDOM();
    _panel.classList.add("visible");
    _isOpen = true;
    _switchTab(_activeTab);
  }

  function close() {
    if (_panel) _panel.classList.remove("visible");
    _isOpen = false;
    _filterAgent = null;
    if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
  }

  function isOpen() { return _isOpen; }

  // ── DOM Creation ──────────────────────────────────
  function _createDOM() {
    _panel = document.createElement("div");
    _panel.className = "ops-panel";
    _panel.innerHTML = `
      <div class="ops-header">
        <span>Operations</span>
        <button class="ops-close" title="Close">&times;</button>
      </div>
      <div class="ops-tabs">
        <div class="ops-tab" data-tab="prs">PRs</div>
        <div class="ops-tab" data-tab="workspace">Workspace</div>
        <div class="ops-tab" data-tab="diffs">Diffs</div>
      </div>
      <div class="ops-content"></div>
    `;
    document.body.appendChild(_panel);

    _panel.querySelector(".ops-close").addEventListener("click", close);
    _panel.querySelectorAll(".ops-tab").forEach(function(tab) {
      tab.addEventListener("click", function() {
        _switchTab(tab.dataset.tab);
      });
    });
  }

  function _switchTab(tab) {
    _activeTab = tab;
    if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }

    _panel.querySelectorAll(".ops-tab").forEach(function(t) {
      t.classList.toggle("active", t.dataset.tab === tab);
    });

    var content = _panel.querySelector(".ops-content");
    content.innerHTML = '<div class="ops-empty">Loading...</div>';

    if (tab === "prs") {
      _loadPRs();
      _pollInterval = setInterval(_loadPRs, 30000);
    } else if (tab === "workspace") {
      _loadWorkspace();
    } else if (tab === "diffs") {
      _loadDiffs();
    }
  }

  // ── Utility ───────────────────────────────────────
  function _relativeTime(dateStr) {
    if (!dateStr) return "";
    var diff = Date.now() - new Date(dateStr).getTime();
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + "h ago";
    var days = Math.floor(hrs / 24);
    return days + "d ago";
  }

  function _escHtml(s) {
    var d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  // ── PRs Tab ───────────────────────────────────────
  function _loadPRs() {
    fetch("/api/prs")
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var prs = data.prs || data || [];
        _renderPRs(prs);
      })
      .catch(function(err) {
        var content = _panel.querySelector(".ops-content");
        content.innerHTML = '<div class="ops-empty">Failed to load PRs: ' + _escHtml(err.message) + '</div>';
      });
  }

  function _renderPRs(prs) {
    var content = _panel.querySelector(".ops-content");
    if (!prs.length) {
      content.innerHTML = '<div class="ops-empty">No open pull requests</div>';
      _updatePRBadge(0);
      return;
    }

    var needsAttention = 0;
    var html = "";
    prs.forEach(function(pr) {
      var checksClass = "ops-check-none";
      var checksIcon = "&mdash;";
      if (pr.checksStatus === "pass" || pr.checksStatus === "success") {
        checksClass = "ops-check-pass"; checksIcon = "&#10003;";
      } else if (pr.checksStatus === "fail" || pr.checksStatus === "failure") {
        checksClass = "ops-check-fail"; checksIcon = "&#10007;"; needsAttention++;
      } else if (pr.checksStatus === "pending") {
        checksClass = "ops-check-pending"; checksIcon = "&#9679;";
      }

      var reviewHtml = "";
      if (pr.reviewStatus === "APPROVED") {
        reviewHtml = '<span style="color:#4ade80">approved</span>';
      } else if (pr.reviewStatus === "CHANGES_REQUESTED") {
        reviewHtml = '<span style="color:#fbbf24">changes</span>'; needsAttention++;
      } else {
        reviewHtml = '<span style="color:var(--text-dim)">pending</span>';
      }

      html += '<div class="ops-pr-row" data-url="' + _escHtml(pr.url || pr.html_url || "") + '">' +
        '<div class="ops-pr-title">#' + (pr.number || "") + " " + _escHtml(pr.title || "") + '</div>' +
        '<div class="ops-pr-meta">' +
          '<span class="ops-pr-branch">' + _escHtml(pr.branch || pr.head && pr.head.ref || "") + '</span>' +
          '<span class="' + checksClass + '">' + checksIcon + '</span>' +
          reviewHtml +
          '<span>' + _relativeTime(pr.createdAt || pr.created_at) + '</span>' +
        '</div>' +
      '</div>';
    });

    content.innerHTML = html;
    _updatePRBadge(needsAttention);

    content.querySelectorAll(".ops-pr-row").forEach(function(row) {
      row.addEventListener("click", function() {
        var url = row.dataset.url;
        if (url) window.open(url, "_blank");
      });
    });
  }

  function _updatePRBadge(count) {
    var tab = _panel.querySelector('.ops-tab[data-tab="prs"]');
    var badge = tab.querySelector(".ops-tab-badge");
    if (count > 0) {
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "ops-tab-badge";
        tab.appendChild(badge);
      }
      badge.textContent = count;
    } else if (badge) {
      badge.remove();
    }
  }

  // ── Workspace Tab ─────────────────────────────────
  function _loadWorkspace() {
    fetch("/api/workspace-status")
      .then(function(r) { return r.json(); })
      .then(function(data) {
        _renderWorkspace(data);
      })
      .catch(function() {
        // Fallback: build from global agents map
        _renderWorkspaceFromAgents();
      });
  }

  function _renderWorkspaceFromAgents() {
    var groups = {};
    if (typeof agents !== "undefined") {
      agents.forEach(function(agentData, name) {
        var workdir = agentData.workdir || "unknown";
        if (!groups[workdir]) groups[workdir] = [];
        groups[workdir].push({ name: name, status: agentData.status || "idle", files: [] });
      });
    }
    _renderWorkspaceGroups(groups);
  }

  function _renderWorkspace(data) {
    var groups = data.workspaces || data || {};
    // Normalize: if it's an array, group by workdir
    if (Array.isArray(groups)) {
      var map = {};
      groups.forEach(function(item) {
        var wd = item.workdir || "unknown";
        if (!map[wd]) map[wd] = [];
        map[wd].push(item);
      });
      groups = map;
    }
    _renderWorkspaceGroups(groups);
  }

  function _renderWorkspaceGroups(groups) {
    var content = _panel.querySelector(".ops-content");
    var keys = Object.keys(groups);
    if (!keys.length) {
      content.innerHTML = '<div class="ops-empty">No active workspaces</div>';
      return;
    }

    var html = "";
    keys.forEach(function(path) {
      var agentsList = groups[path];
      html += '<div class="ops-workspace">';
      html += '<div class="ops-workspace-path">' + _escHtml(path) + '</div>';

      agentsList.forEach(function(ag) {
        var name = ag.name || "unknown";
        var statusDot = _statusDot(ag.status);
        var fileCount = (ag.files && ag.files.length) || 0;
        var fileId = "ops-wf-" + name.replace(/[^a-z0-9-]/gi, "_");

        html += '<div class="ops-agent-row">' +
          statusDot +
          '<span class="ops-agent-name">' + _escHtml(name) + '</span>';
        if (fileCount > 0) {
          html += '<span class="ops-agent-files" data-fileid="' + fileId + '">' + fileCount + ' files</span>';
        }
        html += '</div>';

        if (fileCount > 0) {
          var expanded = _expandedFiles.has(fileId);
          html += '<div class="ops-file-list" id="' + fileId + '" style="display:' + (expanded ? "block" : "none") + '">';
          ag.files.forEach(function(f) {
            html += '<div>' + _escHtml(typeof f === "string" ? f : f.path || f.file || "") + '</div>';
          });
          html += '</div>';
        }
      });
      html += '</div>';
    });

    content.innerHTML = html;

    // Wire up file toggles
    content.querySelectorAll(".ops-agent-files").forEach(function(el) {
      el.addEventListener("click", function() {
        var fid = el.dataset.fileid;
        var list = document.getElementById(fid);
        if (list) {
          var show = list.style.display === "none";
          list.style.display = show ? "block" : "none";
          if (show) _expandedFiles.add(fid); else _expandedFiles.delete(fid);
        }
      });
    });
  }

  function _statusDot(status) {
    var colors = {
      working: "var(--status-working-color, #7eb8da)",
      waiting: "var(--status-waiting-color, #d9534f)",
      asking: "var(--status-asking-color, #c9a84c)",
      idle: "var(--text-dim)"
    };
    var c = colors[status] || colors.idle;
    return '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + c + ';flex-shrink:0"></span>';
  }

  // ── Diffs Tab ─────────────────────────────────────
  function _loadDiffs() {
    var content = _panel.querySelector(".ops-content");
    // Get list of agents from global Map
    var agentNames = [];
    if (typeof agents !== "undefined") {
      agents.forEach(function(_, name) {
        if (_filterAgent && name !== _filterAgent) return;
        agentNames.push(name);
      });
    }

    if (!agentNames.length) {
      content.innerHTML = '<div class="ops-empty">' + (_filterAgent ? "Agent not found" : "No agents") + '</div>';
      return;
    }

    // Fetch diff-stat for each agent
    var promises = agentNames.map(function(name) {
      return fetch("/api/sessions/" + encodeURIComponent(name) + "/diff-stat")
        .then(function(r) { return r.ok ? r.json() : { files: [] }; })
        .then(function(data) { return { name: name, files: data.files || [] }; })
        .catch(function() { return { name: name, files: [] }; });
    });

    Promise.all(promises).then(function(results) {
      // Filter to agents with changes
      var withChanges = results.filter(function(r) { return r.files.length > 0; });
      if (!withChanges.length) {
        content.innerHTML = '<div class="ops-empty">No uncommitted changes</div>';
        return;
      }
      _renderDiffs(withChanges);
    });
  }

  function _renderDiffs(agentDiffs) {
    var content = _panel.querySelector(".ops-content");
    var html = "";

    agentDiffs.forEach(function(ag) {
      html += '<div class="ops-diff-agent">';
      html += '<div class="ops-diff-agent-name">' + _escHtml(ag.name) + '</div>';

      ag.files.forEach(function(f) {
        var filePath = typeof f === "string" ? f : (f.file || f.path || "");
        var adds = f.additions || f.adds || 0;
        var dels = f.deletions || f.dels || 0;
        var diffId = "ops-diff-" + ag.name.replace(/[^a-z0-9-]/gi, "_") + "-" + filePath.replace(/[^a-z0-9.-]/gi, "_");

        html += '<div class="ops-diff-file" data-agent="' + _escHtml(ag.name) + '" data-file="' + _escHtml(filePath) + '" data-diffid="' + diffId + '">' +
          '<span>' + _escHtml(filePath) + '</span>' +
          '<span>' +
            (adds ? '<span class="ops-diff-adds">+' + adds + '</span> ' : '') +
            (dels ? '<span class="ops-diff-dels">-' + dels + '</span> ' : '') +
            '<button class="ops-open-editor" data-agent="' + _escHtml(ag.name) + '" data-file="' + _escHtml(filePath) + '">Open</button>' +
          '</span>' +
        '</div>';
        html += '<div class="ops-diff-inline" id="' + diffId + '" style="display:none"></div>';
      });

      html += '</div>';
    });

    content.innerHTML = html;

    // Wire click-to-expand inline diffs
    content.querySelectorAll(".ops-diff-file").forEach(function(row) {
      row.addEventListener("click", function(e) {
        if (e.target.closest(".ops-open-editor")) return; // handled separately
        var agentName = row.dataset.agent;
        var file = row.dataset.file;
        var diffId = row.dataset.diffid;
        var container = document.getElementById(diffId);
        if (!container) return;

        if (container.style.display !== "none") {
          container.style.display = "none";
          _expandedDiffs.delete(diffId);
          return;
        }

        container.style.display = "block";
        _expandedDiffs.add(diffId);
        container.innerHTML = '<div style="color:var(--text-dim);font-size:11px;padding:8px">Loading diff...</div>';

        fetch("/api/sessions/" + encodeURIComponent(agentName) + "/full-diff?file=" + encodeURIComponent(file))
          .then(function(r) { return r.ok ? r.text() : Promise.reject(new Error("Not found")); })
          .then(function(diffText) {
            var diffContainer = document.createElement("div");
            diffContainer.className = "ops-diff-content";
            if (typeof Diff2Html !== "undefined") {
              diffContainer.innerHTML = Diff2Html.html(diffText, {
                drawFileList: false,
                matching: "lines",
                outputFormat: "line-by-line"
              });
            } else {
              diffContainer.innerHTML = '<pre style="white-space:pre-wrap;font-size:11px">' + _escHtml(diffText) + '</pre>';
            }
            container.innerHTML = "";
            // If it's a renderable file, add rendered view toggle
            if (file.endsWith(".md") || file.endsWith(".html") || file.endsWith(".htm")) {
              var toggleDiv = document.createElement("div");
              toggleDiv.className = "ops-diff-toggle";
              toggleDiv.innerHTML = '<button class="ops-diff-toggle-btn active" data-view="diff">Diff</button><button class="ops-diff-toggle-btn" data-view="rendered">Rendered</button>';
              // Parse added lines from unified diff to get current content
              var addedLines = diffText.split("\n")
                .filter(function(l) { return l.startsWith("+") && !l.startsWith("+++"); })
                .map(function(l) { return l.slice(1); })
                .join("\n");
              var renderedDiv = document.createElement("div");
              renderedDiv.className = "ops-diff-rendered hidden";
              if (file.endsWith(".html") || file.endsWith(".htm")) {
                // HTML files — render in a sandboxed iframe
                var iframe = document.createElement("iframe");
                iframe.className = "ops-diff-iframe";
                iframe.sandbox = "allow-same-origin";
                iframe.srcdoc = addedLines;
                renderedDiv.appendChild(iframe);
              } else if (typeof marked !== "undefined") {
                renderedDiv.innerHTML = marked.parse(addedLines);
              } else {
                renderedDiv.innerHTML = '<pre style="white-space:pre-wrap;font-size:12px">' + _escHtml(addedLines) + '</pre>';
              }
              toggleDiv.addEventListener("click", function(e) {
                var btn = e.target.closest(".ops-diff-toggle-btn");
                if (!btn) return;
                var view = btn.dataset.view;
                toggleDiv.querySelectorAll(".ops-diff-toggle-btn").forEach(function(b) { b.classList.toggle("active", b === btn); });
                diffContainer.classList.toggle("hidden", view === "rendered");
                renderedDiv.classList.toggle("hidden", view === "diff");
              });
              container.appendChild(toggleDiv);
              container.appendChild(diffContainer);
              container.appendChild(renderedDiv);
            } else {
              container.appendChild(diffContainer);
            }
          })
          .catch(function(err) {
            container.innerHTML = '<div style="color:var(--text-dim);font-size:11px;padding:8px">No diff available</div>';
          });
      });
    });

    // Wire "Open in Editor" buttons
    content.querySelectorAll(".ops-open-editor").forEach(function(btn) {
      btn.addEventListener("click", function(e) {
        e.stopPropagation();
        var agentName = btn.dataset.agent;
        var file = btn.dataset.file;
        _openInEditor(agentName, file);
      });
    });
  }

  function _openInEditor(agentName, file) {
    // Resolve full path
    var fullPath = file;
    if (typeof agents !== "undefined") {
      var ag = agents.get(agentName);
      if (ag && ag.workdir && !file.startsWith("/")) {
        fullPath = ag.workdir + "/" + file;
      }
    }

    // Read file and show in dashboard
    fetch("/api/read-file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: fullPath })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) { alert(data.error); return; }
      _showFileViewer(data.content, data.ext, fullPath);
    })
    .catch(function(e) { alert("Failed to read file"); });
  }

  function _showFileViewer(content, ext, filePath) {
    var viewer = document.getElementById("ops-file-viewer");
    if (!viewer) {
      viewer = document.createElement("div");
      viewer.id = "ops-file-viewer";
      viewer.className = "ops-file-viewer";
      _panel.querySelector(".ops-content").appendChild(viewer);
    }

    var fileName = filePath.split("/").pop();
    var isMarkdown = ext === ".md";
    var isHtml = ext === ".html" || ext === ".htm";
    var isJson = ext === ".json";

    var header = '<div class="ops-viewer-header">' +
      '<span class="ops-viewer-title">' + _escHtml(fileName) + '</span>' +
      '<span class="ops-viewer-path">' + _escHtml(filePath) + '</span>' +
      '<div class="ops-viewer-actions">';

    if (isMarkdown || isHtml) {
      header += '<button class="ops-diff-toggle-btn active" data-view="rendered">Rendered</button>' +
        '<button class="ops-diff-toggle-btn" data-view="source">Source</button>';
    }
    header += '<button class="ops-viewer-close">&times;</button></div></div>';

    var rendered = '';
    if (isMarkdown && typeof marked !== "undefined") {
      rendered = '<div class="ops-viewer-rendered ops-diff-rendered">' + marked.parse(content) + '</div>';
    } else if (isHtml) {
      rendered = '<div class="ops-viewer-rendered"><iframe class="ops-diff-iframe" sandbox="allow-same-origin" srcdoc="' + _escAttr(content) + '"></iframe></div>';
    }

    var source = '<pre class="ops-viewer-source' + (isMarkdown || isHtml ? ' hidden' : '') + '">' +
      '<code>' + _escHtml(content) + '</code></pre>';

    viewer.innerHTML = header + rendered + source;
    viewer.style.display = '';

    // Toggle rendered/source
    viewer.querySelectorAll('.ops-diff-toggle-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var view = btn.dataset.view;
        viewer.querySelectorAll('.ops-diff-toggle-btn').forEach(function(b) { b.classList.toggle('active', b === btn); });
        var renderedEl = viewer.querySelector('.ops-viewer-rendered');
        var sourceEl = viewer.querySelector('.ops-viewer-source');
        if (renderedEl) renderedEl.classList.toggle('hidden', view === 'source');
        if (sourceEl) sourceEl.classList.toggle('hidden', view === 'rendered');
      });
    });

    // Close
    viewer.querySelector('.ops-viewer-close').addEventListener('click', function() {
      viewer.style.display = 'none';
      viewer.innerHTML = '';
    });

    // Scroll to viewer
    viewer.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function _escAttr(s) {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Open a protocol URL (vscode://, cursor://) without navigating away
  function _triggerProtocol(url) {
    var a = document.createElement("a");
    a.href = url;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(function() { a.remove(); }, 100);
  }

  // ── Exports ───────────────────────────────────────
  window.OpsPanel = { toggle: toggle, open: open, close: close, isOpen: isOpen };
})();
