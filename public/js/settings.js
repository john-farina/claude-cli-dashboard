// --- Bug Report ---

{
  const bugReportBtn = document.getElementById("bug-report-btn");
  const bugOverlay = document.getElementById("bug-report-overlay");
  const bugForm = document.getElementById("bug-report-form");
  const bugTitle = document.getElementById("bug-title");
  const bugDesc = document.getElementById("bug-description");
  const bugSteps = document.getElementById("bug-steps");
  const bugSubmit = document.getElementById("bug-submit");
  const bugCancel = document.getElementById("bug-cancel");
  const bugTargetRepo = document.getElementById("bug-target-repo");
  const bugSysinfoLoading = document.getElementById("bug-sysinfo-loading");
  const bugSysinfoContent = document.getElementById("bug-sysinfo-content");
  const bugSysinfoError = document.getElementById("bug-sysinfo-error");
  const bugSysinfoRetry = document.getElementById("bug-sysinfo-retry");
  const bugScreenshotZone = document.getElementById("bug-screenshot-zone");
  const bugScreenshotInput = document.getElementById("bug-screenshot-input");
  const bugScreenshotPlaceholder = document.getElementById("bug-screenshot-placeholder");
  const bugScreenshotPreview = document.getElementById("bug-screenshot-preview");
  const bugScreenshotImg = document.getElementById("bug-screenshot-img");
  const bugScreenshotRemove = document.getElementById("bug-screenshot-remove");
  const bugSuccessOverlay = document.getElementById("bug-success-overlay");
  const bugSuccessMsg = document.getElementById("bug-success-msg");
  const bugSuccessClose = document.getElementById("bug-success-close");
  const bugSuccessSpawn = document.getElementById("bug-success-spawn");

  const bugScreenshotCapture = document.getElementById("bug-screenshot-capture");

  let bugSelectedSeverity = "medium";
  let bugScreenshotFile = null;
  let bugScreenshotServerPath = null;
  let bugSystemInfo = null;
  let _lastIssueUrl = "";
  let _lastBugTitle = "";
  let _lastBugDesc = "";
  let _lastBugSteps = "";
  let _lastBugSeverity = "";
  let _lastBugScreenshotPath = "";

  function setSysinfoState(state) {
    bugSysinfoLoading.classList.toggle("hidden", state !== "loading");
    bugSysinfoContent.classList.toggle("hidden", state !== "content");
    bugSysinfoError.classList.toggle("hidden", state !== "error");
  }

  function openBugReportModal() {
    bugOverlay.classList.remove("hidden");
    bugTargetRepo.textContent = _bugReportRepo;
    bugTitle.focus();
    fetchSystemInfo();
  }

  // Expose globally for Escape handler
  window.closeBugReportModal = closeBugReportModal;
  function closeBugReportModal() {
    bugOverlay.classList.add("hidden");
    bugForm.reset();
    bugSelectedSeverity = "medium";
    bugScreenshotFile = null;
    bugScreenshotServerPath = null;
    bugScreenshotPreview.classList.add("hidden");
    bugScreenshotPlaceholder.style.display = "";
    bugSystemInfo = null;
    setSysinfoState("loading");
    // Reset severity pills
    bugOverlay.querySelectorAll(".severity-pill").forEach(p => {
      p.classList.toggle("active", p.dataset.severity === "medium");
    });
  }

  let _bugReportRepo = "john-farina/claude-cli-dashboard";

  async function fetchSystemInfo() {
    setSysinfoState("loading");
    try {
      const res = await fetch("/api/system-info");
      bugSystemInfo = await res.json();
      bugSystemInfo.browser = navigator.userAgent.replace(/^Mozilla\/5\.0 /, "");
      if (bugSystemInfo.bugReportRepo) _bugReportRepo = bugSystemInfo.bugReportRepo;
      bugTargetRepo.textContent = _bugReportRepo;
      bugSysinfoContent.textContent =
        `Dashboard: ${bugSystemInfo.dashboardVersion} (${bugSystemInfo.dashboardBranch})\n` +
        `Node: ${bugSystemInfo.nodeVersion}\n` +
        `OS: ${bugSystemInfo.platform} ${bugSystemInfo.osVersion}\n` +
        `Agents: ${bugSystemInfo.activeAgents}\n` +
        `Browser: ${bugSystemInfo.browser}`;
      setSysinfoState("content");
    } catch {
      setSysinfoState("error");
    }
  }

  bugSysinfoRetry.addEventListener("click", fetchSystemInfo);

  // Open modal
  bugReportBtn.addEventListener("click", openBugReportModal);

  // Close modal
  bugCancel.addEventListener("click", closeBugReportModal);
  bugOverlay.addEventListener("click", (e) => {
    if (e.target === bugOverlay) closeBugReportModal();
  });

  // Severity pills
  bugOverlay.querySelectorAll(".severity-pill").forEach(pill => {
    pill.addEventListener("click", () => {
      bugOverlay.querySelectorAll(".severity-pill").forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      bugSelectedSeverity = pill.dataset.severity;
    });
  });

  // Screenshot upload
  bugScreenshotZone.addEventListener("click", () => bugScreenshotInput.click());
  bugScreenshotZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    bugScreenshotZone.classList.add("dragover");
  });
  bugScreenshotZone.addEventListener("dragleave", () => {
    bugScreenshotZone.classList.remove("dragover");
  });
  bugScreenshotZone.addEventListener("drop", (e) => {
    e.preventDefault();
    bugScreenshotZone.classList.remove("dragover");
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) handleScreenshot(file);
  });
  bugScreenshotInput.addEventListener("change", () => {
    if (bugScreenshotInput.files[0]) handleScreenshot(bugScreenshotInput.files[0]);
  });
  bugScreenshotRemove.addEventListener("click", (e) => {
    e.stopPropagation();
    bugScreenshotFile = null;
    bugScreenshotServerPath = null;
    bugScreenshotPreview.classList.add("hidden");
    bugScreenshotPlaceholder.style.display = "";
    bugScreenshotInput.value = "";
  });

  // Capture screenshot via macOS screencapture
  bugScreenshotCapture.addEventListener("click", async () => {
    // Hide the modal so user can capture the screen (use classList not inline style)
    bugOverlay.classList.add("hidden");
    bugScreenshotCapture.disabled = true;
    bugScreenshotCapture.textContent = "Capturing...";

    try {
      const res = await fetch("/api/screenshot", { method: "POST" });
      const data = await res.json();
      if (data.ok && data.path) {
        // Show the captured screenshot in the preview
        bugScreenshotServerPath = data.path;
        bugScreenshotFile = null; // server already has the file
        bugScreenshotImg.src = `/api/screenshot-preview?path=${encodeURIComponent(data.path)}&t=${Date.now()}`;
        bugScreenshotPreview.classList.remove("hidden");
        bugScreenshotPlaceholder.style.display = "none";
      }
    } catch {
      // User cancelled or error — do nothing
    } finally {
      // Show the modal again
      bugOverlay.classList.remove("hidden");
      bugScreenshotCapture.disabled = false;
      bugScreenshotCapture.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="10" rx="1"/><circle cx="8" cy="8.5" r="2.5"/><path d="M5 3L6 1h4l1 2"/></svg> Capture Screen`;
    }
  });

  function handleScreenshot(file) {
    bugScreenshotFile = file;
    bugScreenshotServerPath = null;
    const reader = new FileReader();
    reader.onload = () => {
      bugScreenshotImg.src = reader.result;
      bugScreenshotPreview.classList.remove("hidden");
      bugScreenshotPlaceholder.style.display = "none";
    };
    reader.readAsDataURL(file);
  }

  // Submit bug report
  bugForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = bugTitle.value.trim();
    if (!title) return;

    bugSubmit.disabled = true;
    bugSubmit.textContent = "Submitting...";

    try {
      // Upload screenshot first if present (client-side file)
      let screenshotPath = bugScreenshotServerPath || null;
      if (!screenshotPath && bugScreenshotFile) {
        const formData = new FormData();
        formData.append("file", bugScreenshotFile);
        const upRes = await fetch("/api/upload", { method: "POST", body: formData });
        if (upRes.ok) {
          const upData = await upRes.json();
          screenshotPath = upData.path;
        }
      }

      const res = await fetch("/api/bug-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: bugDesc.value.trim(),
          steps: bugSteps.value.trim(),
          severity: bugSelectedSeverity,
          systemInfo: bugSystemInfo,
          screenshotPath,
        }),
      });

      const data = await res.json();
      if (res.ok && data.issueUrl) {
        _lastIssueUrl = data.issueUrl;
        _lastBugTitle = title;
        _lastBugDesc = bugDesc.value.trim();
        _lastBugSteps = bugSteps.value.trim();
        _lastBugSeverity = bugSelectedSeverity;
        _lastBugScreenshotPath = screenshotPath || "";
        closeBugReportModal();
        // Show success modal with spawn option
        bugSuccessMsg.innerHTML = `Issue created: <a href="${escapeAttr(data.issueUrl)}" target="_blank">${escapeHtml(data.issueUrl)}</a>`;
        bugSuccessOverlay.classList.remove("hidden");
      } else {
        alert(data.error || "Failed to create issue. Make sure `gh` CLI is authenticated.");
      }
    } catch {
      alert("Failed to submit bug report. Check your network connection and gh CLI auth.");
    } finally {
      bugSubmit.disabled = false;
      bugSubmit.textContent = "Submit Bug Report";
    }
  });

  // Success modal actions
  bugSuccessClose.addEventListener("click", () => {
    bugSuccessOverlay.classList.add("hidden");
  });
  bugSuccessOverlay.addEventListener("click", (e) => {
    if (e.target === bugSuccessOverlay) bugSuccessOverlay.classList.add("hidden");
  });

  bugSuccessSpawn.addEventListener("click", async () => {
    bugSuccessOverlay.classList.add("hidden");
    // Build comprehensive bug-fix agent prompt
    let prompt = `You are a bug-fix agent. Your job is to investigate and fix the following bug, then ensure the codebase passes a security review, and finally create a PR or file a detailed issue.

## Bug Report

**Title:** ${_lastBugTitle}
${_lastBugDesc ? `**Description:** ${_lastBugDesc}\n` : ""}${_lastBugSteps ? `**Steps to Reproduce:** ${_lastBugSteps}\n` : ""}**Severity:** ${_lastBugSeverity || "medium"}
**Issue:** ${_lastIssueUrl}
${_lastBugScreenshotPath ? `**Screenshot:** ${_lastBugScreenshotPath}\n` : ""}

## Your Workflow

### Step 1: Investigate & Fix the Bug
- Read the relevant code and understand the root cause
- Implement a fix
- Test the fix if possible (run existing tests, verify the fix addresses the issue)
- **If you need more information from the user, ask them directly** — don't guess

### Step 2: Security Check
- Once the bug is fixed, run a security review of the entire codebase
- Check for OWASP Top 10 vulnerabilities: command injection, XSS, SQL injection, path traversal, etc.
- Pay special attention to user input handling, shell commands, file path validation, and HTML rendering
- If you find security issues, fix them before proceeding

### Step 3: Create a PR or File an Issue
- **If the bug is fixed and security checks pass:**
  - Create a feature branch, commit your changes, and open a PR against \`main\` that references the issue (${_lastIssueUrl})
  - PR title should be concise and describe the fix
  - PR body should include a summary of the bug, the fix, and any security improvements made
- **If you cannot fix the bug or resolve security issues:**
  - File a detailed GitHub issue with your findings: what you tried, what failed, relevant code locations, and suggested approaches for someone else to try
  - Reference the original issue (${_lastIssueUrl})

## Important
- Always ask the user if you need clarification — don't make assumptions about ambiguous behavior
- Keep changes minimal and focused on the bug fix + any security issues found
- Do not refactor unrelated code`;

    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "bugfix-" + _lastBugTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30).replace(/-$/, ""),
          prompt,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        addAgentCard(data.name, data.workdir, data.branch, data.isWorktree, false);
      } else {
        alert("Failed to spawn fix agent");
      }
    } catch {
      alert("Failed to spawn fix agent");
    }
  });
}

// --- .claude File Browser ---

const filesBtn = document.getElementById("files-btn");
const filesPanel = document.getElementById("files-panel");
const filesBackdrop = document.getElementById("files-backdrop");
const filesClose = document.getElementById("files-close");
const filesCategories = document.getElementById("files-categories");
const fileEditor = document.getElementById("file-editor");
const fileEditorName = document.getElementById("file-editor-name");
const fileEditorContent = document.getElementById("file-editor-content");
const fileEditorBack = document.getElementById("file-editor-back");
const fileEditorSave = document.getElementById("file-editor-save");
const fileEditorToggle = document.getElementById("file-editor-toggle");
const fileEditorRendered = document.getElementById("file-editor-rendered");
const fileEditorFinder = document.getElementById("file-editor-finder");
const fileEditorHint = document.getElementById("file-editor-hint");
const ceoMdBtn = document.getElementById("ceo-md-btn");

let currentFilePath = null;

function toggleFilesPanel() {
  const isOpen = filesPanel.classList.contains("visible");
  if (isOpen) {
    closeFilesPanel();
  } else {
    // Close other panels if open
    const sp = document.getElementById("settings-panel");
    if (sp && sp.classList.contains("visible")) closeSettingsPanel();
    if (_bmPanel && _bmPanel.classList.contains("visible")) closeBookmarksPanel();
    filesPanel.classList.add("visible");
    filesBackdrop.classList.add("visible");
    filesBtn.classList.add("panel-active");
    loadClaudeFiles();
    // Focus the close button so Tab navigation starts inside the panel
    setTimeout(() => filesClose.focus(), 100);
  }
}

function closeFilesPanel() {
  filesPanel.classList.remove("visible");
  filesBackdrop.classList.remove("visible");
  filesBtn.classList.remove("panel-active");
  closeFileEditor();
}

filesBtn.addEventListener("click", toggleFilesPanel);
filesClose.addEventListener("click", closeFilesPanel);
filesBackdrop.addEventListener("click", closeFilesPanel);
filesPanel.addEventListener("keydown", (e) => {
  if (filesPanel.classList.contains("visible")) trapFocus(filesPanel, e);
});

async function loadClaudeFiles() {
  try {
    const res = await fetch("/api/claude-files");
    const data = await res.json();
    renderFileCategories(data);
  } catch {
    filesCategories.innerHTML = '<div style="padding:20px;color:var(--text-dim)">Failed to load files</div>';
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  return (bytes / 1024).toFixed(1) + " KB";
}

function renderFileCategories(data) {
  filesCategories.innerHTML = "";

  const categories = [
    { key: "ceoDocs", label: "CEO Docs", files: data.ceoDocs || [] },
    { key: "docs", label: "Docs", files: data.docs || [] },
    { key: "commands", label: "Commands", files: data.commands || [] },
    { key: "skills", label: "Skills", files: data.skills || [] },
    { key: "agents", label: "Agents", files: data.agents || [] },
    { key: "memory", label: "Memory", files: data.memory || [] },
  ];

  // Settings as a special single-file category
  if (data.settings) {
    categories.push({
      key: "settings",
      label: "Settings",
      files: [{ name: "settings.json", path: data.settings.path, size: data.settings.size || 0 }],
    });
  }

  for (const cat of categories) {
    // Always show Docs category (even when empty) so users discover it
    if (cat.files.length === 0 && cat.key !== "docs") continue;

    const section = document.createElement("div");
    section.className = "files-category";

    const header = document.createElement("div");
    header.className = "files-category-header";
    header.innerHTML = `${escapeHtml(cat.label)} <span class="files-category-count">${cat.files.length}</span>`;
    header.addEventListener("click", () => section.classList.toggle("open"));
    makeKeyboardActivatable(header);

    const list = document.createElement("div");
    list.className = "files-category-list";

    if (cat.key === "docs" && cat.files.length === 0) {
      const empty = document.createElement("div");
      empty.className = "files-docs-empty";
      empty.innerHTML = `
        <p>Save docs here for all future Claude sessions — coding guidelines, architecture notes, API references.</p>
        <button class="btn-secondary files-create-docs-btn">Create Docs Folder</button>
      `;
      empty.querySelector("button").addEventListener("click", async () => {
        try {
          await fetch("/api/claude-files/ensure-docs", { method: "POST" });
          loadClaudeFiles();
        } catch {}
      });
      list.appendChild(empty);
    }

    for (const file of cat.files) {
      const item = document.createElement("div");
      item.className = "file-item";
      item.innerHTML = `
        <span>${escapeHtml(file.name)}</span>
        <span class="file-item-size">${formatSize(file.size)}</span>
      `;
      item.addEventListener("click", () => openFile(file.path, file.name));
      makeKeyboardActivatable(item);
      list.appendChild(item);
    }

    section.appendChild(header);
    section.appendChild(list);
    filesCategories.appendChild(section);
  }
}

async function openFile(filePath, fileName) {
  try {
    const res = await fetch(`/api/claude-files/read?path=${encodeURIComponent(filePath)}`);
    if (!res.ok) {
      const err = await res.json();
      alert(err.error || "Failed to read file");
      return;
    }
    const data = await res.json();
    currentFilePath = filePath;
    fileEditorHint.style.display = "none";
    fileEditorName.textContent = fileName;
    fileEditorContent.value = data.content;
    filesCategories.style.display = "none";
    fileEditor.classList.remove("hidden");

    // Markdown files: show rendered by default
    const isMd = fileName.endsWith(".md");
    if (isMd) {
      fileEditorRendered.innerHTML = marked.parse(data.content);
      fileEditorRendered.style.display = "";
      fileEditorContent.style.display = "none";
      fileEditorToggle.style.display = "";
      fileEditorToggle.textContent = "Raw";
      fileEditorToggle.classList.remove("active");
    } else {
      fileEditorRendered.style.display = "none";
      fileEditorContent.style.display = "";
      fileEditorToggle.style.display = "none";
    }
  } catch {
    alert("Failed to read file");
  }
}

function closeFileEditor() {
  fileEditor.classList.add("hidden");
  filesCategories.style.display = "";
  currentFilePath = null;
  // Reset toggle state
  fileEditorRendered.style.display = "none";
  fileEditorContent.style.display = "";
  fileEditorToggle.style.display = "none";
  fileEditorToggle.classList.remove("active");
}

async function saveFile() {
  if (!currentFilePath) return;

  // CEO.md uses its own endpoint
  if (currentFilePath === "__ceo_md__") {
    try {
      const res = await fetch("/api/ceo-md", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: fileEditorContent.value }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to save CEO.md");
        return;
      }
      closeFileEditor();
    } catch {
      alert("Failed to save CEO.md");
    }
    return;
  }

  try {
    const res = await fetch("/api/claude-files/write", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: currentFilePath, content: fileEditorContent.value }),
    });
    if (!res.ok) {
      const err = await res.json();
      alert(err.error || "Failed to save file");
      return;
    }
    closeFileEditor();
    loadClaudeFiles(); // refresh list (sizes may have changed)
  } catch {
    alert("Failed to save file");
  }
}

fileEditorBack.addEventListener("click", () => {
  closeFileEditor();
  loadClaudeFiles();
});
fileEditorSave.addEventListener("click", saveFile);

// Open containing folder in Finder
async function openInFinder(filePath) {
  try {
    const res = await fetch("/api/open-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath }),
    });
    if (!res.ok) {
      const err = await res.json();
      alert(err.error || "Failed to open folder");
    }
  } catch { alert("Failed to open folder"); }
}

fileEditorFinder.addEventListener("click", () => {
  if (currentFilePath) openInFinder(currentFilePath);
});

// Toggle between raw and rendered in file editor
fileEditorToggle.addEventListener("click", () => {
  const isRaw = fileEditorToggle.classList.contains("active");
  if (isRaw) {
    // Switch to rendered
    fileEditorRendered.innerHTML = marked.parse(fileEditorContent.value);
    fileEditorRendered.style.display = "";
    fileEditorContent.style.display = "none";
    fileEditorToggle.textContent = "Raw";
    fileEditorToggle.classList.remove("active");
  } else {
    // Switch to raw
    fileEditorRendered.style.display = "none";
    fileEditorContent.style.display = "";
    fileEditorContent.focus();
    fileEditorToggle.textContent = "Rendered";
    fileEditorToggle.classList.add("active");
  }
});

// CEO.md button — open in files panel with its own endpoint
ceoMdBtn.addEventListener("click", async () => {
  // Open files panel if not already open
  if (!filesPanel.classList.contains("visible")) {
    filesPanel.classList.add("visible");
    filesBackdrop.classList.add("visible");
  }
  try {
    const res = await fetch("/api/ceo-md");
    const data = await res.json();
    currentFilePath = "__ceo_md__";
    fileEditorHint.style.display = "";
    fileEditorName.textContent = "claude-ceo.md";
    fileEditorContent.value = data.content || "";
    filesCategories.style.display = "none";
    fileEditor.classList.remove("hidden");

    // Show rendered by default
    const content = data.content || "";
    if (content.trim()) {
      fileEditorRendered.innerHTML = marked.parse(content);
      fileEditorRendered.style.display = "";
      fileEditorContent.style.display = "none";
    } else {
      // Empty — go straight to raw editing
      fileEditorRendered.style.display = "none";
      fileEditorContent.style.display = "";
    }
    fileEditorToggle.style.display = "";
    fileEditorToggle.textContent = content.trim() ? "Raw" : "Rendered";
    fileEditorToggle.classList.toggle("active", !content.trim());
  } catch {
    alert("Failed to load CEO.md");
  }
});

// Files panel Escape is handled by the main keyboard shortcuts handler

// --- Restart Server ---

const restartServerBtn = document.getElementById("restart-server-btn");

async function restartServer() {
  restartServerBtn.disabled = true;
  const restartLabel = restartServerBtn.querySelector(".dock-label");
  if (restartLabel) restartLabel.textContent = "Restarting...";
  else restartServerBtn.textContent = "Restarting...";
  sessionStorage.setItem("ceo-reload-state", JSON.stringify(buildReloadState()));

  // Capture the current server's version so we can detect the NEW server
  let oldVersion = null;
  try {
    const vr = await fetch("/api/version", { signal: AbortSignal.timeout(2000) });
    const vd = await vr.json();
    oldVersion = vd.version;
  } catch {}

  try {
    await fetch("/api/restart-server", { method: "POST" });
  } catch {}

  // Poll until the NEW server is ready (version changed = new process)
  const pollUntilReady = () => {
    fetch("/api/version", { signal: AbortSignal.timeout(2000) })
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((data) => {
        if (oldVersion && data.version === oldVersion) throw new Error("same server");
        location.reload();
      })
      .catch(() => setTimeout(pollUntilReady, 500));
  };
  // Wait for old server to die (exits after 300ms)
  setTimeout(pollUntilReady, 600);
}

restartServerBtn.addEventListener("click", restartServer);

// --- Auto-Update ---

const updateBtn = document.getElementById("update-btn");
const updateWrapper = document.getElementById("update-wrapper");
const updateTooltip = document.getElementById("update-tooltip");

function showUpdateButton(data) {
  if (!updateBtn || !updateWrapper) return;
  updateWrapper.style.display = "";
  const n = data.behind || 0;
  updateBtn.textContent = n > 1 ? `Update (${n} new commits)` : "Update Available";
  // Build tooltip content: release notes + commit summary
  let tooltipHtml = "";
  if (data.releaseNotes && typeof marked !== "undefined") {
    tooltipHtml += marked.parse(data.releaseNotes);
  }
  if (data.summary) {
    const commits = data.summary.split("\n").filter(Boolean);
    if (commits.length) {
      if (tooltipHtml) tooltipHtml += "<hr style='border-color:var(--border);margin:10px 0'>";
      tooltipHtml += "<strong>Recent changes:</strong><ul>" +
        commits.slice(0, 15).map(c => `<li>${escapeHtml(c)}</li>`).join("") +
        "</ul>";
    }
  }
  if (tooltipHtml && updateTooltip) updateTooltip.innerHTML = tooltipHtml;
}

updateBtn.addEventListener("click", async () => {
  updateBtn.disabled = true;
  updateBtn.textContent = "Updating\u2026";
  sessionStorage.setItem("ceo-reload-state", JSON.stringify(buildReloadState()));
  try {
    const res = await fetch("/api/update", { method: "POST" });
    if (!res.ok) {
      let data = {};
      try { data = await res.json(); } catch {}
      sessionStorage.removeItem("ceo-reload-state");
      showUpdateError(data);
      updateBtn.disabled = false;
      updateBtn.textContent = "Update Available";
      return; // Don't poll-and-reload — error modal needs to stay visible
    }
  } catch {
    // Server likely died during restart — that's expected, fall through to poll
  }
  const pollUntilReady = () => {
    fetch("/api/version", { signal: AbortSignal.timeout(2000) })
      .then((r) => { if (r.ok) location.reload(); else throw new Error(); })
      .catch(() => setTimeout(pollUntilReady, 500));
  };
  setTimeout(pollUntilReady, 800);
});

let _updateErrorShowing = false; // suppress auto-reload while error modal is visible

// Update error modal — handles all error types from /api/update and /api/install-version
const _ueOverlay = document.getElementById("update-error-overlay");
const _ueTitle = document.getElementById("update-error-title");
const _ueDesc = document.getElementById("update-error-desc");
const _ueFiles = document.getElementById("update-error-files");
const _uePromptWrap = document.getElementById("update-error-prompt-wrap");
const _uePrompt = document.getElementById("update-error-prompt");
const _ueCopy = document.getElementById("update-error-copy");
const _ueAgentBtn = document.getElementById("update-error-agent-btn");
const _ueAgentDesc = document.getElementById("update-error-agent-desc");
const _ueManual = document.getElementById("update-error-manual");
const _uePromptLegacy = document.getElementById("update-error-prompt-legacy");
const _ueCopyLegacy = document.getElementById("update-error-copy-legacy");
const _ueRetry = document.getElementById("update-error-retry");
const _ueClose = document.getElementById("update-error-close");

function _buildConflictAgentPrompt(files, cwd, localDiff, diffTruncated, remote) {
  remote = remote || "origin";
  const fileList = files.map(f => `- ${f}`).join("\n");
  const parts = [
    `You are in the CEO Dashboard repository at ${cwd}. An update from ${remote}/main caused merge conflicts.`,
    ``,
    `## The user's local customizations`,
    `Below is the diff of local changes this user has made. Study it carefully — these are their personal customizations (hotkeys, styles, layout tweaks, etc.) and you MUST preserve them.`,
  ];
  if (localDiff) {
    parts.push(``, `\`\`\`diff`, localDiff.trimEnd(), `\`\`\``);
    if (diffTruncated) {
      parts.push(``, `**NOTE: The diff above was truncated because it's very large. The conflicting files are fully shown, but some non-conflicting files may be summarized. Run \`git diff HEAD\` on any file you need to see in full, and read the actual file contents before resolving conflicts.**`);
    }
  } else {
    parts.push(``, `(Diff was not captured — run \`git diff HEAD\` to see local changes before proceeding.)`);
  }
  parts.push(
    ``,
    `## Step 0: Save a backup of local changes to memory`,
    `Before touching ANYTHING, save the above diff to your memory file. Include:`,
    `- Every file and what was modified`,
    `- Full code snippets for every change`,
    `- Your interpretation of each change's purpose (e.g. "changed accent color to blue", "added custom Ctrl+K hotkey for X", "restyled header to be more compact")`,
    `This is the safety net — if the merge goes wrong, these exact snippets let us restore everything.`,
    ``,
    `## Conflicting files:`,
    fileList,
    ``,
    `## Step 1: Start the merge`,
    `\`git fetch ${remote} main && git merge ${remote}/main --no-edit\``,
    ``,
    `## Step 2: Resolve each conflict INTELLIGENTLY`,
    `You already know exactly what the user changed (from the diff above). Use that knowledge to make smart decisions.`,
    ``,
    `For each \`<<<<<<<\` / \`>>>>>>>\` block:`,
    ``,
    `**If both sides added different things** (e.g. both added a new function, CSS rule, or feature):`,
    `→ KEEP BOTH. Include the upstream addition AND the local addition.`,
    ``,
    `**If upstream changed something the user also customized:**`,
    `→ ASK THE USER with full context. You know what their change does — explain it back to them. Examples:`,
    `  - "You changed the accent color to #3B82F6 (blue). Upstream changed it to #10B981 (green). Want to keep your blue, take the new green, or pick a different color?"`,
    `  - "You added a Ctrl+K hotkey for killing agents. Upstream also added Ctrl+K but for search. Want to keep yours and I'll rebind the upstream one to a different key? Or take theirs and I'll move yours?"`,
    `  - "You made the header more compact (removed padding, smaller font). Upstream redesigned the header with a new layout. Want me to apply your compact style to the new layout, keep yours as-is, or take theirs?"`,
    ``,
    `**If upstream changed something the user didn't touch:**`,
    `→ Take the upstream version (it's a required update).`,
    ``,
    `**If the user changed something upstream didn't touch:**`,
    `→ Keep the user's version (it's their customization).`,
    ``,
    `## Step 3: Show me the result BEFORE committing`,
    `Do NOT commit yet. Instead:`,
    `1. Show a summary of every conflict and how you resolved it`,
    `2. For each file, show the key changes you made`,
    `3. Ask: "Does this look good? I can commit this, or if something looks wrong I can undo the entire merge with \`git merge --abort\` and we start fresh."`,
    ``,
    `## Step 4: Commit only after approval`,
    `Only after I confirm:`,
    `\`git add ${files.join(" ")} && git commit -m "Merge ${remote}/main — resolve conflicts"\``,
    ``,
    `If I say something looks wrong:`,
    `- Run \`git merge --abort\` to undo everything`,
    `- Tell me what happened and ask how I want to proceed`,
    `- My local changes from the memory backup can be restored if needed`,
    ``,
    `## Step 5: Restart the server`,
    `Once committed, the code on disk is updated but the running server is still using the old code. Restart it:`,
    `1. If \`package.json\` changed upstream, run: \`cd ${cwd} && npm install\``,
    `2. Run: \`curl -s -X POST http://localhost:9145/api/restart-server\``,
    `3. Tell me: "Merge complete and server is restarting! The page will reload automatically in a few seconds. After it reloads, verify your customizations are intact. If anything looks off, let me know — I have the full backup of your changes in memory."`,
  );
  return parts.join("\n");
}

function _buildConflictManualSteps(files, cwd, remote) {
  remote = remote || "origin";
  return [
    `cd ${cwd}`,
    `git fetch ${remote} main`,
    `git merge ${remote}/main --no-edit`,
    `# Resolve conflicts in each file`,
    `git add ${files.join(" ")}`,
    `git commit -m "Merge ${remote}/main — resolve conflicts"`,
  ].join("\n");
}

function _buildDirtyWorkdirAgentPrompt(cwd, localDiff, diffTruncated, remote) {
  remote = remote || "origin";
  const parts = [
    `You are in the CEO Dashboard repository at ${cwd}. There are uncommitted local changes blocking an auto-update from ${remote}/main.`,
    ``,
    `## The user's local customizations`,
    `Below is the diff of local changes this user has made. Study it carefully — these are their personal customizations and you MUST preserve them.`,
  ];
  if (localDiff) {
    parts.push(``, `\`\`\`diff`, localDiff.trimEnd(), `\`\`\``);
    if (diffTruncated) {
      parts.push(``, `**NOTE: The diff above was truncated because it's very large. Run \`git diff\` to see the full changes for any file you need, and read the actual file contents before resolving conflicts.**`);
    }
  } else {
    parts.push(``, `(Diff was not captured — run \`git diff\` to see local changes before proceeding.)`);
  }
  parts.push(
    ``,
    `## Step 0: Save a backup of local changes to memory`,
    `Before touching ANYTHING, save the above diff to your memory file. Include:`,
    `- Every file and what was modified`,
    `- Full code snippets for every change`,
    `- Your interpretation of each change's purpose (e.g. "changed accent color to blue", "added custom Ctrl+K hotkey for X", "restyled header to be more compact")`,
    `This is the safety net — if the merge goes wrong, these exact snippets let us restore everything.`,
    ``,
    `## Step 1: Stash and update`,
    `\`\`\``,
    `git stash`,
    `git fetch ${remote} main && git merge ${remote}/main --no-edit`,
    `git stash pop`,
    `\`\`\``,
    ``,
    `## Step 2: If conflicts after stash pop — resolve INTELLIGENTLY`,
    `You already know exactly what the user changed (from the diff above). Use that knowledge to make smart decisions.`,
    ``,
    `For each conflict:`,
    ``,
    `**If both sides added different things:**`,
    `→ KEEP BOTH.`,
    ``,
    `**If upstream changed something the user also customized:**`,
    `→ ASK THE USER with full context. You know what their change does — explain it back to them:`,
    `  - "You changed X to Y for [reason]. Upstream changed it to Z. Want to keep yours, take theirs, or combine them?"`,
    ``,
    `**If only one side changed a given line:**`,
    `→ Keep that side's version.`,
    ``,
    `## Step 3: Show me the result BEFORE finalizing`,
    `Do NOT just say "done". Instead:`,
    `1. Show a summary of what changed and any conflicts you resolved`,
    `2. Ask: "Does this look good? Or should I undo everything with \`git checkout -- . && git stash pop\` to restore your original state?"`,
    ``,
    `## Step 4: Only finalize after approval`,
    `If I say something looks wrong:`,
    `- Undo: \`git reset --hard HEAD\` then \`git stash pop\` to restore the original local state`,
    `- My local changes from the memory backup can be restored manually if the stash is lost`,
    ``,
    `## Step 5: Restart the server`,
    `Once I confirm, the code on disk is updated but the running server is still using the old code. Restart it:`,
    `1. If \`package.json\` changed upstream, run: \`cd ${cwd} && npm install\``,
    `2. Run: \`curl -s -X POST http://localhost:9145/api/restart-server\``,
    `3. Tell me: "Update complete and server is restarting! The page will reload automatically in a few seconds. After it reloads, verify your customizations are intact. If anything looks off, let me know — I have the full backup of your changes in memory."`,
  );
  return parts.join("\n");
}

function _buildDirtyWorkdirManualSteps(cwd, remote) {
  remote = remote || "origin";
  return [
    `cd ${cwd}`,
    `git stash`,
    `git fetch ${remote} main`,
    `git merge ${remote}/main --no-edit`,
    `git stash pop`,
    `# Resolve any conflicts if needed`,
  ].join("\n");
}

function _buildUnknownPrompt(message, cwd, remote) {
  remote = remote || "origin";
  return `The CEO Dashboard update at ${cwd || "."} failed with this error:\n\n${message}\n\nDiagnose and fix this so the dashboard can update. Check git status, resolve any issues, then run: git fetch ${remote} main && git -c merge.ff=false merge ${remote}/main --no-edit`;
}

function showUpdateError(data) {
  _updateErrorShowing = true;
  const errorType = data.error || "unknown";
  const cwd = data.cwd || ".";
  const message = data.message || "";
  const files = data.conflicts || [];
  const localDiff = data.localDiff || "";
  const diffTruncated = data.diffTruncated || false;
  const remote = data.remote || "origin";

  // Reset all sections
  _ueFiles.classList.add("hidden");
  _ueFiles.innerHTML = "";
  _uePromptWrap.classList.add("hidden");
  _uePromptLegacy.textContent = "";
  _ueRetry.classList.add("hidden");
  _ueCopy.textContent = "Copy";
  _ueCopyLegacy.textContent = "Copy";
  _ueAgentBtn.classList.add("hidden");
  _ueAgentDesc.classList.add("hidden");
  _ueManual.classList.add("hidden");
  _ueManual.removeAttribute("open");
  _uePrompt.textContent = "";
  _ueAgentBtn.disabled = false;
  _ueAgentBtn.textContent = "Launch Resolver Agent";
  _ueAgentBtn._agentPrompt = null;
  _ueAgentBtn._agentCwd = null;

  switch (errorType) {
    case "merge-conflict":
      _ueTitle.textContent = "Merge Conflict";
      _ueTitle.style.color = "var(--red)";
      _ueDesc.textContent = "Your local changes conflict with the latest update. Nothing is broken \u2014 the dashboard is still running.";
      _ueAgentBtn.classList.remove("hidden");
      _ueAgentDesc.classList.remove("hidden");
      _ueAgentBtn._agentPrompt = _buildConflictAgentPrompt(files, cwd, localDiff, diffTruncated, remote);
      _ueAgentBtn._agentCwd = cwd;
      _ueFiles.innerHTML = files.map(f => `<li>${escapeHtml(f)}</li>`).join("");
      _ueFiles.classList.remove("hidden");
      _uePrompt.textContent = _buildConflictManualSteps(files, cwd, remote);
      _ueManual.classList.remove("hidden");
      break;

    case "dirty-workdir":
      _ueTitle.textContent = "Uncommitted Changes";
      _ueTitle.style.color = "var(--accent)";
      _ueDesc.textContent = "Your local changes prevent the update. Nothing is broken \u2014 the dashboard is still running.";
      _ueAgentBtn.classList.remove("hidden");
      _ueAgentDesc.classList.remove("hidden");
      _ueAgentBtn._agentPrompt = _buildDirtyWorkdirAgentPrompt(cwd, localDiff, diffTruncated, remote);
      _ueAgentBtn._agentCwd = cwd;
      _uePrompt.textContent = _buildDirtyWorkdirManualSteps(cwd, remote);
      _ueManual.classList.remove("hidden");
      break;

    case "network":
      _ueTitle.textContent = "Network Error";
      _ueTitle.style.color = "var(--accent)";
      _ueDesc.textContent = message || "Could not reach the remote repository. Check your internet connection and try again.";
      _ueRetry.classList.remove("hidden");
      break;

    case "timeout":
      _ueTitle.textContent = "Timed Out";
      _ueTitle.style.color = "var(--accent)";
      _ueDesc.textContent = message || "The update timed out. This is usually temporary — try again.";
      _ueRetry.classList.remove("hidden");
      break;

    case "not-on-main": {
      const branch = data.branch || "unknown";
      _ueTitle.textContent = "Wrong Branch";
      _ueTitle.style.color = "var(--accent)";
      _ueDesc.innerHTML = `You're on <code>${escapeHtml(branch)}</code>. Updates apply to the <code>main</code> branch. Switch first, then retry:`;
      _uePromptLegacy.textContent = `cd ${cwd} && git checkout main`;
      _uePromptWrap.classList.remove("hidden");
      _ueRetry.classList.remove("hidden");
      break;
    }

    case "npm-failed":
      _ueTitle.textContent = "Install Failed";
      _ueTitle.style.color = "var(--red)";
      _ueDesc.textContent = "The code was updated, but npm install failed. Run this manually:";
      _uePromptLegacy.textContent = `cd ${cwd} && npm install`;
      _uePromptWrap.classList.remove("hidden");
      break;

    default: // "unknown" or unrecognized
      _ueTitle.textContent = "Update Failed";
      _ueTitle.style.color = "var(--red)";
      _ueDesc.textContent = message || "An unexpected error occurred during the update.";
      if (cwd) {
        _uePromptLegacy.textContent = _buildUnknownPrompt(message, cwd, remote);
        _uePromptWrap.classList.remove("hidden");
      }
      break;
  }

  updateBtn.textContent = "Update Available";
  _ueOverlay.classList.remove("hidden");
}

_ueCopy.addEventListener("click", () => {
  navigator.clipboard.writeText(_uePrompt.textContent).then(() => {
    _ueCopy.textContent = "Copied!";
    setTimeout(() => { _ueCopy.textContent = "Copy"; }, 2000);
  });
});

_ueCopyLegacy.addEventListener("click", () => {
  navigator.clipboard.writeText(_uePromptLegacy.textContent).then(() => {
    _ueCopyLegacy.textContent = "Copied!";
    setTimeout(() => { _ueCopyLegacy.textContent = "Copy"; }, 2000);
  });
});

_ueAgentBtn.addEventListener("click", async () => {
  const prompt = _ueAgentBtn._agentPrompt;
  const workdir = _ueAgentBtn._agentCwd;
  if (!prompt || !workdir) return;

  _ueAgentBtn.disabled = true;
  _ueAgentBtn.textContent = "Creating\u2026";

  try {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "update-fix", workdir, prompt }),
    });
    if (res.ok) {
      const data = await res.json();
      addAgentCard(data.name, data.workdir, data.branch, data.isWorktree, false);
      _ueOverlay.classList.add("hidden");
      _updateErrorShowing = false;
      setTimeout(() => {
        const agent = agents.get(data.name);
        if (agent) agent.card.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 300);
    } else {
      _ueAgentBtn.textContent = "Launch Resolver Agent";
      _ueAgentBtn.disabled = false;
      const err = await res.json().catch(() => ({}));
      alert(err.error || "Failed to create resolver agent");
    }
  } catch {
    _ueAgentBtn.textContent = "Launch Resolver Agent";
    _ueAgentBtn.disabled = false;
    alert("Failed to create resolver agent");
  }
});

_ueRetry.addEventListener("click", () => {
  _ueOverlay.classList.add("hidden");
  _updateErrorShowing = false;
  updateBtn.click();
});

_ueClose.addEventListener("click", () => {
  _ueOverlay.classList.add("hidden");
  _updateErrorShowing = false;
});

// Click backdrop (overlay) to close update error modal
_ueOverlay.addEventListener("click", (e) => {
  if (e.target === _ueOverlay) {
    _ueOverlay.classList.add("hidden");
    _updateErrorShowing = false;
  }
});

// --- Code Diff Viewer ---

const _diffOverlay = document.getElementById("diff-overlay");
const _diffAgentName = document.getElementById("diff-agent-name");
const _diffWorkdir = document.getElementById("diff-workdir");
const _diffContent = document.getElementById("diff-content");
const _diffEmpty = document.getElementById("diff-empty");
const _diffLoading = document.getElementById("diff-loading");
const _diffError = document.getElementById("diff-error");
const _diffErrorMsg = document.getElementById("diff-error-msg");
const _diffClose = document.getElementById("diff-close");
const _diffRefresh = document.getElementById("diff-refresh");
const _diffRetry = document.getElementById("diff-retry");
const _diffTabGroup = document.getElementById("diff-tab-group");
const _diffCtxGroup = document.getElementById("diff-context-group");
const _diffLiveDot = document.getElementById("diff-live-dot");

let _diffCurrentAgent = null;
let _diffSideBySide = false;
let _diffContextLines = 3;
let _diffPollTimer = null;
let _diffLastRaw = "";
// Two pre-built DOM containers — one for each view. Tab switch just swaps display.
let _diffDomUnified = null;
let _diffDomSplit = null;

// Code review state
const _diffReviewPending = new Map();   // agentName → Map<key, comment>
const _diffReviewSubmitted = new Map(); // agentName → Map<key, comment>
let _diffReviewComments = new Map();    // active session pending
let _diffSubmittedComments = new Map(); // active session submitted
const _diffReviewFooter = document.getElementById("diff-review-footer");
const _diffReviewCount = document.getElementById("diff-review-count");
const _diffReviewSubmit = document.getElementById("diff-review-submit");

const _DIFF_STATE_KEY = "ceo-diff-state";
const _DIFF_POLL_INTERVAL = 3000;

function _diffSaveState() {
  if (_diffCurrentAgent && !_diffOverlay.classList.contains("hidden")) {
    localStorage.setItem(_DIFF_STATE_KEY, JSON.stringify({
      agent: _diffCurrentAgent, sideBySide: _diffSideBySide, contextLines: _diffContextLines,
    }));
  } else {
    localStorage.removeItem(_DIFF_STATE_KEY);
  }
}

function _diffSetState(state) {
  _diffContent.innerHTML = "";
  _diffDomUnified = null;
  _diffDomSplit = null;
  _diffEmpty.classList.add("hidden");
  _diffLoading.classList.add("hidden");
  _diffError.classList.add("hidden");
  if (state === "loading") _diffLoading.classList.remove("hidden");
  else if (state === "empty") _diffEmpty.classList.remove("hidden");
  else if (state === "error") _diffError.classList.remove("hidden");
}

// ── Code Review helpers ──────────────────────────────────────

function _diffReviewKey(filePath, lineNumber, side) {
  return `${filePath}::${side}::${lineNumber}`;
}

function _diffReviewGetLineInfo(tr) {
  const wrapper = tr.closest(".d2h-file-wrapper");
  if (!wrapper) return null;
  const nameEl = wrapper.querySelector(".d2h-file-name");
  if (!nameEl) return null;
  const filePath = nameEl.textContent.trim();

  let side = null;
  let lineNumber = null;

  const sideLineNum = tr.querySelector(".d2h-code-side-linenumber");
  const uniLineNum = tr.querySelector(".d2h-code-linenumber");
  if (sideLineNum) {
    // Split view: read only text nodes to exclude injected "+" button text
    lineNumber = _diffGetTextOnly(sideLineNum);
    // First side-linenumber in the row = old, second = new
    const allSideCells = tr.querySelectorAll(".d2h-code-side-linenumber");
    side = (allSideCells.length >= 2 && sideLineNum === allSideCells[1]) ? "new" : "old";
  } else if (uniLineNum) {
    // Unified view: use .line-num1 (old) / .line-num2 (new) divs
    const ln1 = uniLineNum.querySelector(".line-num1")?.textContent?.trim() || "";
    const ln2 = uniLineNum.querySelector(".line-num2")?.textContent?.trim() || "";
    if (ln1 && !ln2) {
      side = "old";
      lineNumber = ln1;
    } else if (ln2) {
      side = "new";
      lineNumber = ln2;
    } else {
      // Fallback: read text nodes only (excludes injected button)
      const raw = _diffGetTextOnly(uniLineNum);
      const nums = raw.split(/\s+/).filter(Boolean);
      side = "new";
      lineNumber = nums[0] || null;
    }
  }
  if (!lineNumber || lineNumber === "…") return null;

  const codeEl = tr.querySelector(".d2h-code-line-ctn");
  const codeSnippet = codeEl ? codeEl.textContent : "";

  return { filePath, lineNumber, side, codeSnippet };
}

// Read text content from a DOM node, excluding injected review button text
function _diffGetTextOnly(el) {
  let text = "";
  for (const node of el.childNodes) {
    if (node.nodeType === 3) text += node.textContent;
    else if (node.nodeType === 1 && !node.classList.contains("diff-review-add-btn")) text += node.textContent;
  }
  return text.trim();
}

function _diffReviewInjectGutterButtons(container) {
  const rows = container.querySelectorAll("tr");
  for (const tr of rows) {
    if (tr.classList.contains("d2h-info")) continue;
    // Find line number cells
    const cells = tr.querySelectorAll(".d2h-code-linenumber, .d2h-code-side-linenumber");
    for (const td of cells) {
      if (td.querySelector(".diff-review-add-btn")) continue;
      const btn = document.createElement("span");
      btn.className = "diff-review-add-btn";
      btn.textContent = "+";
      td.appendChild(btn);
    }
  }
}

function _diffReviewFindRow(container, filePath, lineNumber, side) {
  const wrappers = container.querySelectorAll(".d2h-file-wrapper");
  for (const wrapper of wrappers) {
    const nameEl = wrapper.querySelector(".d2h-file-name");
    if (!nameEl || nameEl.textContent.trim() !== filePath) continue;
    const rows = wrapper.querySelectorAll("tr");
    for (const tr of rows) {
      if (tr.classList.contains("d2h-info")) continue;
      const info = _diffReviewGetLineInfo(tr);
      if (!info) continue;
      if (info.lineNumber === lineNumber && info.side === side) return tr;
    }
  }
  return null;
}

function _diffReviewInsertCommentRow(targetTr, commentKey, text, isSubmitted) {
  // Determine colspan from target row
  const cols = targetTr.querySelectorAll("td").length || 3;
  const tr = document.createElement("tr");
  tr.className = "diff-review-comment-row";
  tr.dataset.reviewKey = commentKey;
  if (isSubmitted) tr.classList.add("submitted");
  const td = document.createElement("td");
  td.colSpan = cols;

  if (text === null) {
    // Editable textarea
    td.innerHTML = `<div class="diff-review-comment-box">
      <textarea data-key="${escapeHtml(commentKey)}" placeholder="Add review comment…"></textarea>
      <div class="diff-review-comment-actions">
        <button class="diff-review-save-btn" data-key="${escapeHtml(commentKey)}">Save</button>
        <button class="diff-review-cancel-btn" data-key="${escapeHtml(commentKey)}">Cancel</button>
      </div>
    </div>`;
  } else {
    // Saved comment display
    td.innerHTML = `<div class="diff-review-saved-comment">
      <span class="diff-review-saved-text">${escapeHtml(text)}</span>
      <span class="diff-review-saved-actions">
        <button class="diff-review-edit-btn" data-key="${escapeHtml(commentKey)}" title="Edit">&#9998;</button>
        <button class="diff-review-delete-btn" data-key="${escapeHtml(commentKey)}" title="Delete">&times;</button>
      </span>
    </div>`;
  }

  tr.appendChild(td);
  targetTr.insertAdjacentElement("afterend", tr);
  return tr;
}

function _diffReviewRemoveCommentRows(key) {
  // Remove from both DOM trees
  for (const container of [_diffDomUnified, _diffDomSplit]) {
    if (!container) continue;
    const existing = container.querySelectorAll(`.diff-review-comment-row[data-review-key="${CSS.escape(key)}"]`);
    existing.forEach(r => r.remove());
  }
}

function _diffReviewInjectComments(container) {
  // Inject pending editable comments
  for (const [key, comment] of _diffReviewComments) {
    const tr = _diffReviewFindRow(container, comment.filePath, comment.lineNumber, comment.side);
    if (tr) _diffReviewInsertCommentRow(tr, key, comment.text, false);
  }
  // Inject submitted dimmed comments
  for (const [key, comment] of _diffSubmittedComments) {
    // Don't inject if a pending comment exists for this key (user is editing a replacement)
    if (_diffReviewComments.has(key)) continue;
    const tr = _diffReviewFindRow(container, comment.filePath, comment.lineNumber, comment.side);
    if (tr) _diffReviewInsertCommentRow(tr, key, comment.text, true);
  }
}

function _diffReviewUpdateFooter() {
  const count = _diffReviewComments.size;
  if (count > 0) {
    _diffReviewFooter.classList.remove("hidden");
    _diffReviewCount.innerHTML = `<b style="color:var(--accent)">${count}</b> comment${count !== 1 ? "s" : ""}`;
  } else {
    _diffReviewFooter.classList.add("hidden");
  }
}

// Delegated click handler for all review interactions
_diffContent.addEventListener("click", (e) => {
  const target = e.target;

  // "+" gutter button
  if (target.closest(".diff-review-add-btn")) {
    const tr = target.closest("tr");
    if (!tr) return;
    const info = _diffReviewGetLineInfo(tr);
    if (!info) return;
    const key = _diffReviewKey(info.filePath, info.lineNumber, info.side);

    // Remove any submitted version for this key
    _diffSubmittedComments.delete(key);
    _diffReviewRemoveCommentRows(key);

    // Insert blank comment row in BOTH trees
    for (const container of [_diffDomUnified, _diffDomSplit]) {
      if (!container) continue;
      const targetRow = _diffReviewFindRow(container, info.filePath, info.lineNumber, info.side);
      if (targetRow) _diffReviewInsertCommentRow(targetRow, key, null, false);
    }
    // Focus textarea in active view
    const active = _diffSideBySide ? _diffDomSplit : _diffDomUnified;
    if (active) {
      const ta = active.querySelector(`.diff-review-comment-row[data-review-key="${CSS.escape(key)}"] textarea`);
      if (ta) ta.focus();
    }
    return;
  }

  // Save button
  if (target.closest(".diff-review-save-btn")) {
    const btn = target.closest(".diff-review-save-btn");
    const key = btn.dataset.key;
    const row = btn.closest(".diff-review-comment-row");
    const textarea = row ? row.querySelector("textarea") : null;
    const text = textarea ? textarea.value.trim() : "";
    if (!text) return;

    // Parse key: "filePath::side::lineNumber" — use lastIndexOf to handle :: in paths
    const lastSep = key.lastIndexOf("::");
    const lineNumber = key.substring(lastSep + 2);
    const rest = key.substring(0, lastSep);
    const secondSep = rest.lastIndexOf("::");
    const side = rest.substring(secondSep + 2);
    const filePath = rest.substring(0, secondSep);

    const codeRow = _diffReviewFindRow(_diffSideBySide ? _diffDomSplit : _diffDomUnified, filePath, lineNumber, side);
    const codeSnippet = codeRow ? (codeRow.querySelector(".d2h-code-line-ctn")?.textContent || "") : "";

    _diffReviewComments.set(key, { filePath, lineNumber, side, text, codeSnippet });

    // Replace textarea with saved display in BOTH trees
    _diffReviewRemoveCommentRows(key);
    for (const container of [_diffDomUnified, _diffDomSplit]) {
      if (!container) continue;
      const targetRow = _diffReviewFindRow(container, filePath, lineNumber, side);
      if (targetRow) _diffReviewInsertCommentRow(targetRow, key, text, false);
    }
    _diffReviewUpdateFooter();
    return;
  }

  // Cancel button
  if (target.closest(".diff-review-cancel-btn")) {
    const btn = target.closest(".diff-review-cancel-btn");
    const key = btn.dataset.key;
    _diffReviewRemoveCommentRows(key);

    // If there's a saved comment in the map, re-insert it
    if (_diffReviewComments.has(key)) {
      const comment = _diffReviewComments.get(key);
      for (const container of [_diffDomUnified, _diffDomSplit]) {
        if (!container) continue;
        const targetRow = _diffReviewFindRow(container, comment.filePath, comment.lineNumber, comment.side);
        if (targetRow) _diffReviewInsertCommentRow(targetRow, key, comment.text, false);
      }
    }
    return;
  }

  // Edit button
  if (target.closest(".diff-review-edit-btn")) {
    const btn = target.closest(".diff-review-edit-btn");
    const key = btn.dataset.key;
    const comment = _diffReviewComments.get(key);
    if (!comment) return;
    const existingText = comment.text;

    _diffReviewRemoveCommentRows(key);
    for (const container of [_diffDomUnified, _diffDomSplit]) {
      if (!container) continue;
      const targetRow = _diffReviewFindRow(container, comment.filePath, comment.lineNumber, comment.side);
      if (targetRow) {
        const insertedRow = _diffReviewInsertCommentRow(targetRow, key, null, false);
        const ta = insertedRow.querySelector("textarea");
        if (ta) ta.value = existingText;
      }
    }
    // Focus textarea in active view
    const active = _diffSideBySide ? _diffDomSplit : _diffDomUnified;
    if (active) {
      const ta = active.querySelector(`.diff-review-comment-row[data-review-key="${CSS.escape(key)}"] textarea`);
      if (ta) ta.focus();
    }
    return;
  }

  // Delete button
  if (target.closest(".diff-review-delete-btn")) {
    const btn = target.closest(".diff-review-delete-btn");
    const key = btn.dataset.key;
    _diffReviewComments.delete(key);
    _diffReviewRemoveCommentRows(key);
    _diffReviewUpdateFooter();
    return;
  }
});

// Keyboard shortcuts for comment textareas (Ctrl+Enter to save, Escape to cancel)
_diffContent.addEventListener("keydown", (e) => {
  const textarea = e.target.closest(".diff-review-comment-box textarea");
  if (!textarea) return;
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    const saveBtn = textarea.closest(".diff-review-comment-box").querySelector(".diff-review-save-btn");
    if (saveBtn) saveBtn.click();
  } else if (e.key === "Escape") {
    e.preventDefault();
    const cancelBtn = textarea.closest(".diff-review-comment-box").querySelector(".diff-review-cancel-btn");
    if (cancelBtn) cancelBtn.click();
  }
});

// Submit review
_diffReviewSubmit.addEventListener("click", () => {
  if (_diffReviewComments.size === 0) return;

  // Sort comments by file path, then line number
  const sorted = [..._diffReviewComments.entries()].sort((a, b) => {
    const ca = a[1], cb = b[1];
    if (ca.filePath !== cb.filePath) return ca.filePath.localeCompare(cb.filePath);
    return parseInt(ca.lineNumber, 10) - parseInt(cb.lineNumber, 10);
  });

  // Build markdown message
  const lines = [`## Code Review (${sorted.length} comment${sorted.length !== 1 ? "s" : ""})\n`];
  for (const [, comment] of sorted) {
    lines.push(`### ${comment.filePath}:${comment.lineNumber}`);
    if (comment.codeSnippet.trim()) {
      lines.push("```");
      lines.push(comment.codeSnippet);
      lines.push("```");
    }
    lines.push(comment.text);
    lines.push("\n---\n");
  }
  const markdownMessage = lines.join("\n").replace(/\n---\n$/, "");

  // Send to agent
  sendInput(_diffCurrentAgent, markdownMessage);

  // Move pending → submitted
  for (const [key, comment] of _diffReviewComments) {
    _diffSubmittedComments.set(key, comment);
  }
  // Persist to per-agent maps
  if (_diffCurrentAgent) {
    _diffReviewSubmitted.set(_diffCurrentAgent, new Map(_diffSubmittedComments));
    _diffReviewPending.delete(_diffCurrentAgent);
  }
  _diffReviewComments.clear();
  _diffReviewUpdateFooter();
  closeDiffModal();
});

// ── End Code Review helpers ──────────────────────────────────

function _diffBuildDom(combined, outputFormat) {
  const html = Diff2Html.html(combined, {
    drawFileList: true,
    fileListToggle: false,
    matching: "lines",
    outputFormat,
    colorScheme: "dark",
    renderNothingWhenEmpty: false,
  });
  const container = document.createElement("div");
  container.innerHTML = html;
  // Ensure file list is visible
  const fileList = container.querySelector(".d2h-file-list-wrapper");
  if (fileList) {
    fileList.style.display = "block";
    fileList.style.maxHeight = "none";
    fileList.style.overflow = "visible";
  }
  return container;
}

function _diffHighlightContainer(container) {
  if (typeof hljs === "undefined") return;
  // Highlight visible blocks now, lazy-highlight the rest via IntersectionObserver
  const blocks = container.querySelectorAll(".d2h-code-line-ctn");
  if (blocks.length <= 200) {
    blocks.forEach(el => hljs.highlightElement(el));
  } else {
    // Only highlight once attached to DOM via IntersectionObserver
    const obs = new IntersectionObserver((entries, observer) => {
      const batch = [];
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        batch.push(entry.target);
        observer.unobserve(entry.target);
      }
      if (batch.length > 0) {
        requestAnimationFrame(() => batch.forEach(el => hljs.highlightElement(el)));
      }
    }, { root: _diffContent, rootMargin: "600px 0px" });
    blocks.forEach(el => obs.observe(el));
    // Store observer on container so we can disconnect later
    container._hlObs = obs;
  }
}

function _diffShowView() {
  const active = _diffSideBySide ? _diffDomSplit : _diffDomUnified;
  const inactive = _diffSideBySide ? _diffDomUnified : _diffDomSplit;
  if (!active) return;
  active.style.display = "";
  if (inactive) inactive.style.display = "none";
}

async function _diffFetchAndRender(isPolling) {
  const agentName = _diffCurrentAgent;
  if (!agentName) return;
  const ctxParam = _diffContextLines === "all" ? 99999 : _diffContextLines;
  try {
    const res = await fetch(`/api/sessions/${encodeURIComponent(agentName)}/diff?context=${ctxParam}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to fetch diff");
    if (agentName !== _diffCurrentAgent) return; // agent changed while fetching

    _diffWorkdir.textContent = shortPath(data.workdir);

    let combined = "";
    if (data.unstaged) combined += data.unstaged;
    if (data.staged) combined += (combined ? "\n" : "") + data.staged;

    // Skip re-render if content unchanged (live poll optimization)
    if (isPolling && combined === _diffLastRaw) return;
    _diffLastRaw = combined;

    if (!combined) { _diffSetState("empty"); return; }

    // Clear loading state
    _diffEmpty.classList.add("hidden");
    _diffLoading.classList.add("hidden");
    _diffError.classList.add("hidden");

    // Save scroll position before re-render
    const prevScroll = _diffContent.scrollTop;

    // Capture open textarea content before rebuild
    const _openTextareas = new Map();
    for (const container of [_diffDomUnified, _diffDomSplit]) {
      if (!container) continue;
      for (const ta of container.querySelectorAll(".diff-review-comment-row textarea")) {
        if (ta.value.trim()) _openTextareas.set(ta.dataset.key, ta.value);
      }
    }

    _diffContent.innerHTML = "";
    if (_diffDomUnified && _diffDomUnified._hlObs) _diffDomUnified._hlObs.disconnect();
    if (_diffDomSplit && _diffDomSplit._hlObs) _diffDomSplit._hlObs.disconnect();

    // Build both views upfront
    _diffDomUnified = _diffBuildDom(combined, "line-by-line");
    _diffDomSplit = _diffBuildDom(combined, "side-by-side");

    // Inject review gutter buttons and comments into both trees
    _diffReviewInjectGutterButtons(_diffDomUnified);
    _diffReviewInjectGutterButtons(_diffDomSplit);
    _diffReviewInjectComments(_diffDomUnified);
    _diffReviewInjectComments(_diffDomSplit);

    // Restore open textarea content
    for (const container of [_diffDomUnified, _diffDomSplit]) {
      for (const [key, val] of _openTextareas) {
        const ta = container.querySelector(`.diff-review-comment-row[data-review-key="${CSS.escape(key)}"] textarea`);
        if (ta) ta.value = val;
      }
    }

    // Append both, hide the inactive one
    _diffDomUnified.style.display = _diffSideBySide ? "none" : "";
    _diffDomSplit.style.display = _diffSideBySide ? "" : "none";
    _diffContent.appendChild(_diffDomUnified);
    _diffContent.appendChild(_diffDomSplit);

    // Highlight the active view now, defer the other
    _diffHighlightContainer(_diffSideBySide ? _diffDomSplit : _diffDomUnified);
    requestAnimationFrame(() => {
      _diffHighlightContainer(_diffSideBySide ? _diffDomUnified : _diffDomSplit);
    });

    // Restore scroll position on live updates
    if (isPolling) _diffContent.scrollTop = prevScroll;

  } catch (e) {
    if (!isPolling) {
      _diffErrorMsg.textContent = e.message;
      _diffSetState("error");
    }
  }
}

function _diffStartPolling() {
  _diffStopPolling();
  _diffLiveDot.classList.add("active");
  _diffPollTimer = setInterval(() => _diffFetchAndRender(true), _DIFF_POLL_INTERVAL);
}

function _diffStopPolling() {
  if (_diffPollTimer) { clearInterval(_diffPollTimer); _diffPollTimer = null; }
  _diffLiveDot.classList.remove("active");
}

async function openDiffModal(agentName) {
  _diffCurrentAgent = agentName;
  _diffLastRaw = "";
  _diffOverlay.classList.remove("hidden");
  _diffAgentName.textContent = agentName;
  _diffWorkdir.textContent = "";
  _diffSetState("loading");

  // Load per-agent review state
  _diffReviewComments = _diffReviewPending.get(agentName) || new Map();
  _diffSubmittedComments = _diffReviewSubmitted.get(agentName) || new Map();
  _diffReviewUpdateFooter();

  // Sync tab UI
  _diffTabGroup.querySelectorAll(".diff-tab").forEach(t => {
    t.classList.toggle("active", t.dataset.view === (_diffSideBySide ? "side-by-side" : "unified"));
  });
  _diffCtxGroup.querySelectorAll(".diff-ctx-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.ctx === String(_diffContextLines));
  });
  _diffSaveState();

  await _diffFetchAndRender(false);
  _diffStartPolling();
}

function closeDiffModal() {
  _diffStopPolling();
  // Save per-agent review state before clearing
  if (_diffCurrentAgent) {
    if (_diffReviewComments.size > 0) {
      _diffReviewPending.set(_diffCurrentAgent, new Map(_diffReviewComments));
    } else {
      _diffReviewPending.delete(_diffCurrentAgent);
    }
    if (_diffSubmittedComments.size > 0) {
      _diffReviewSubmitted.set(_diffCurrentAgent, new Map(_diffSubmittedComments));
    } else {
      _diffReviewSubmitted.delete(_diffCurrentAgent);
    }
  }
  _diffOverlay.classList.add("hidden");
  // Disconnect any highlight observers
  if (_diffDomUnified && _diffDomUnified._hlObs) _diffDomUnified._hlObs.disconnect();
  if (_diffDomSplit && _diffDomSplit._hlObs) _diffDomSplit._hlObs.disconnect();
  _diffContent.innerHTML = "";
  _diffDomUnified = null;
  _diffDomSplit = null;
  _diffLastRaw = "";
  _diffCurrentAgent = null;
  _diffSaveState();
}

_diffClose.addEventListener("click", closeDiffModal);

_diffOverlay.addEventListener("click", (e) => {
  if (e.target === _diffOverlay) closeDiffModal();
});

_diffRefresh.addEventListener("click", () => {
  if (_diffCurrentAgent) { _diffLastRaw = ""; openDiffModal(_diffCurrentAgent); }
});

_diffRetry.addEventListener("click", () => {
  if (_diffCurrentAgent) openDiffModal(_diffCurrentAgent);
});

_diffTabGroup.addEventListener("click", (e) => {
  const tab = e.target.closest(".diff-tab");
  if (!tab || tab.classList.contains("active")) return;
  _diffTabGroup.querySelectorAll(".diff-tab").forEach(t => t.classList.remove("active"));
  tab.classList.add("active");
  _diffSideBySide = tab.dataset.view === "side-by-side";
  _diffSaveState();
  _diffShowView();
});

_diffCtxGroup.addEventListener("click", (e) => {
  const btn = e.target.closest(".diff-ctx-btn");
  if (!btn || btn.classList.contains("active")) return;
  _diffCtxGroup.querySelectorAll(".diff-ctx-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  _diffContextLines = btn.dataset.ctx === "all" ? "all" : parseInt(btn.dataset.ctx, 10);
  _diffLastRaw = ""; // force re-render
  _diffSaveState();
  if (_diffCurrentAgent) {
    _diffSetState("loading");
    _diffFetchAndRender(false);
  }
});

// Restore diff modal on page load
(function _diffRestoreState() {
  try {
    const saved = JSON.parse(localStorage.getItem(_DIFF_STATE_KEY));
    if (saved && saved.agent) {
      _diffSideBySide = !!saved.sideBySide;
      if (saved.contextLines) _diffContextLines = saved.contextLines;
      const tryOpen = () => {
        if (typeof agents !== "undefined" && agents.has(saved.agent)) {
          openDiffModal(saved.agent);
        } else {
          localStorage.removeItem(_DIFF_STATE_KEY);
        }
      };
      setTimeout(tryOpen, 1500);
    }
  } catch {}
})();

// --- Settings Panel ---

const settingsBtn = document.getElementById("settings-btn");
const settingsPanel = document.getElementById("settings-panel");
const settingsBackdrop = document.getElementById("settings-backdrop");
const settingsClose = document.getElementById("settings-close");
const settingAutostart = document.getElementById("setting-autostart");
const settingAddToDock = document.getElementById("setting-add-to-dock");
const dockDesc = document.getElementById("dock-desc");
const tailscaleDesc = document.getElementById("tailscale-desc");
const tailscaleBadge = document.getElementById("tailscale-badge");
const tailscaleDetails = document.getElementById("tailscale-details");
const tailscaleIp = document.getElementById("tailscale-ip");
const tailscaleUrl = document.getElementById("tailscale-url");

function toggleSettingsPanel() {
  const isOpen = settingsPanel.classList.contains("visible");
  if (isOpen) {
    closeSettingsPanel();
  } else {
    // Close other panels if open
    if (filesPanel.classList.contains("visible")) closeFilesPanel();
    if (_bmPanel && _bmPanel.classList.contains("visible")) closeBookmarksPanel();
    settingsPanel.classList.add("visible");
    settingsBackdrop.classList.add("visible");
    settingsBtn.classList.add("panel-active");
    loadSettings();
    setTimeout(() => settingsClose.focus(), 100);
  }
}

function closeSettingsPanel() {
  settingsPanel.classList.remove("visible");
  settingsBackdrop.classList.remove("visible");
  settingsBtn.classList.remove("panel-active");
}

settingsBtn.addEventListener("click", toggleSettingsPanel);
settingsClose.addEventListener("click", closeSettingsPanel);
settingsBackdrop.addEventListener("click", closeSettingsPanel);
settingsPanel.addEventListener("keydown", (e) => {
  if (settingsPanel.classList.contains("visible")) trapFocus(settingsPanel, e);
});

async function loadSettings() {
  try {
    const res = await fetch("/api/settings");
    const data = await res.json();

    // Auto-Start
    settingAutostart.checked = data.autoStart;
    _settingAutoRename.checked = data.autoRenameAgents;
    _autoRenameNewOnlyRow.style.display = data.autoRenameAgents ? "" : "none";
    _settingAutoRenameNewOnly.checked = data.autoRenameNewOnly !== false;

    // Dock App
    const rebuildHint = document.getElementById("customize-rebuild-hint");
    if (data.dockAppInstalled) {
      settingAddToDock.textContent = "Rebuild";
      settingAddToDock.classList.add("installed");
      settingAddToDock.disabled = false;
      dockDesc.textContent = "Rebuild to apply title and accent color changes to the Dock app";
      if (rebuildHint) rebuildHint.classList.remove("hidden");
    } else {
      settingAddToDock.textContent = "Install";
      settingAddToDock.classList.remove("installed");
      settingAddToDock.disabled = false;
      dockDesc.textContent = "Install as a standalone app in your Dock";
      if (rebuildHint) rebuildHint.classList.add("hidden");
    }

    // Tailscale
    const ts = data.tailscale;
    if (ts.running) {
      tailscaleBadge.textContent = "Connected";
      tailscaleBadge.className = "settings-badge running";
      tailscaleDesc.textContent = "Mesh VPN for secure remote access";
      tailscaleDetails.classList.remove("hidden");
      tailscaleIp.textContent = ts.ip || "—";
      const port = location.port || (location.protocol === "https:" ? "443" : "80");
      const url = `http://${ts.ip}:${port}`;
      tailscaleUrl.textContent = url;
      tailscaleUrl.href = url;
    } else if (ts.installed) {
      tailscaleBadge.textContent = "Installed";
      tailscaleBadge.className = "settings-badge installed";
      tailscaleDesc.textContent = "Tailscale installed but not running. Open Tailscale.app to connect.";
      tailscaleDetails.classList.add("hidden");
    } else {
      tailscaleBadge.textContent = "Not Installed";
      tailscaleBadge.className = "settings-badge offline";
      tailscaleDesc.innerHTML = 'Access your dashboard from your phone or any device on your network.';
      tailscaleDetails.classList.remove("hidden");
      tailscaleIp.textContent = "—";
      tailscaleUrl.textContent = "";
      tailscaleUrl.href = "#";
      tailscaleDetails.innerHTML = `<div class="tailscale-setup-guide">
        <p><strong>Setup:</strong></p>
        <ol>
          <li>Install from <a href="https://tailscale.com/download/mac" target="_blank">tailscale.com/download/mac</a></li>
          <li>Open Tailscale.app and sign in (Google, Microsoft, or GitHub)</li>
          <li>Install Tailscale on your phone too — same account</li>
          <li>Both devices join the same private network automatically</li>
          <li>Reopen Settings here — your dashboard URL will appear</li>
        </ol>
        <p style="margin-top:8px;color:var(--text-dim);font-size:11px;">Free for personal use. No port forwarding, no firewall changes needed.</p>
      </div>`;
    }
  } catch {
    tailscaleDesc.textContent = "Failed to load settings";
  }

  // Accent Color swatches
  const accentGrid = document.getElementById("accent-color-grid");
  if (accentGrid) renderAccentGrid(accentGrid);

  // Background color swatches
  const bgGrid = document.getElementById("bg-color-grid");
  if (bgGrid) renderBgGrid(bgGrid);

  // Terminal color swatches
  const termGrid = document.getElementById("terminal-color-grid");
  if (termGrid) renderTerminalGrid(termGrid);

  // Shell color swatches
  const shellGrid = document.getElementById("shell-color-grid");
  if (shellGrid) renderShellGrid(shellGrid);
}

function _removeBgOverrides() {
  const s = document.documentElement.style;
  const props = ["--bg","--bg-gradient","--input-bg","--header-bg","--surface","--modal-bg",
   "--surface-raised","--border","--scrollbar-thumb","--scrollbar-hover","--gray","--text-dim",
   "--text","--header-border","--modal-backdrop","--card-shadow"];
  // Only reset terminal-bg if user hasn't set a custom terminal color
  if (!localStorage.getItem("terminalColor")) {
    props.push("--terminal-bg");
    s.removeProperty("--terminal-text");
    s.removeProperty("--terminal-text-dim");
    s.removeProperty("--terminal-link-color");
  }
  props.forEach(v => s.removeProperty(v));
}

settingAutostart.addEventListener("change", async () => {
  const enabled = settingAutostart.checked;
  try {
    const res = await fetch("/api/settings/auto-start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) {
      const err = await res.json();
      settingAutostart.checked = !enabled;
      alert(err.error || "Failed to toggle auto-start");
    }
  } catch {
    settingAutostart.checked = !enabled;
  }
});

settingAddToDock.addEventListener("click", async () => {
  if (settingAddToDock.disabled) return;
  const wasInstalled = settingAddToDock.classList.contains("installed");
  settingAddToDock.textContent = wasInstalled ? "Rebuilding..." : "Installing...";
  settingAddToDock.disabled = true;
  // Listen for async build result via WebSocket
  const handler = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type !== "dock-build-result") return;
      window._ceoWs?.removeEventListener("message", handler);
      if (msg.ok) {
        settingAddToDock.textContent = "Rebuild";
        settingAddToDock.classList.add("installed");
        dockDesc.textContent = "Rebuild to apply title and accent color changes to the Dock app";
      } else {
        settingAddToDock.textContent = wasInstalled ? "Rebuild" : "Install";
        alert("Build failed — check /tmp/ceo-rebuild.log for details");
      }
      settingAddToDock.disabled = false;
    } catch {}
  };
  if (window._ceoWs) window._ceoWs.addEventListener("message", handler);
  try {
    const res = await fetch("/api/settings/add-to-dock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) {
      const err = await res.json();
      settingAddToDock.textContent = wasInstalled ? "Rebuild" : "Install";
      settingAddToDock.disabled = false;
      window._ceoWs?.removeEventListener("message", handler);
      alert(err.error || "Failed to install");
    }
    // If res.ok, wait for WebSocket result
  } catch {
    settingAddToDock.textContent = wasInstalled ? "Rebuild" : "Install";
    settingAddToDock.disabled = false;
    window._ceoWs?.removeEventListener("message", handler);
  }
});

// --- In-App Browser settings ---

document.getElementById("setting-clear-browser").addEventListener("click", () => {
  if (!confirm("Clear all in-app browser cookies, cache, and logins?")) return;
  // Post to native bridge to clear WKWebsiteDataStore
  if (window.webkit?.messageHandlers?.ceoBridge) {
    window.webkit.messageHandlers.ceoBridge.postMessage({ action: "clearBrowserData" });
  }
  const btn = document.getElementById("setting-clear-browser");
  btn.textContent = "Cleared";
  btn.disabled = true;
  setTimeout(() => { btn.textContent = "Clear"; btn.disabled = false; }, 2000);
});

// --- Delete All Worktrees (double-click confirm) ---
{
  const btn = document.getElementById("setting-delete-worktrees");
  let armed = false;
  let timer = null;
  btn.addEventListener("click", async () => {
    if (!armed) {
      armed = true;
      btn.classList.add("armed");
      btn.textContent = "Confirm Delete";
      timer = setTimeout(() => {
        armed = false;
        btn.classList.remove("armed");
        btn.textContent = "Delete All";
      }, 2000);
      return;
    }
    clearTimeout(timer);
    armed = false;
    btn.classList.remove("armed");
    btn.disabled = true;
    btn.textContent = "Deleting...";
    try {
      const resp = await fetch("/api/worktrees/delete-all", { method: "POST" });
      const data = await resp.json();
      if (resp.ok) {
        btn.textContent = data.removed > 0 ? `Removed ${data.removed}` : "None found";
      } else {
        btn.textContent = "Error";
      }
    } catch {
      btn.textContent = "Error";
    }
    setTimeout(() => { btn.textContent = "Delete All"; btn.disabled = false; }, 2000);
  });
}

// --- Reset / Undo Today Tokens ---
{
  const resetBtn = document.getElementById("setting-reset-today-tokens");
  const restoreBtn = document.getElementById("setting-restore-today-tokens");

  resetBtn.addEventListener("click", async () => {
    resetBtn.disabled = true;
    resetBtn.textContent = "Resetting...";
    try {
      const resp = await fetch("/api/token-usage/reset-today", { method: "POST" });
      if (resp.ok) {
        resetBtn.textContent = "Done!";
        setTimeout(() => location.reload(), 800);
      } else {
        resetBtn.textContent = "Error";
        setTimeout(() => { resetBtn.textContent = "Reset"; resetBtn.disabled = false; }, 1500);
      }
    } catch {
      resetBtn.textContent = "Error";
      setTimeout(() => { resetBtn.textContent = "Reset"; resetBtn.disabled = false; }, 1500);
    }
  });

  restoreBtn.addEventListener("click", async () => {
    restoreBtn.disabled = true;
    restoreBtn.textContent = "Rebuilding from JSONL...";
    try {
      const resp = await fetch("/api/token-usage/restore-today", { method: "POST" });
      if (resp.ok) {
        restoreBtn.textContent = "Restored!";
        setTimeout(() => location.reload(), 800);
      } else {
        restoreBtn.textContent = "Error";
        setTimeout(() => { restoreBtn.textContent = "Restore from midnight"; restoreBtn.disabled = false; }, 1500);
      }
    } catch {
      restoreBtn.textContent = "Error";
      setTimeout(() => { restoreBtn.textContent = "Restore from midnight"; restoreBtn.disabled = false; }, 1500);
    }
  });
}

// --- Agent Defaults config ---

// Collapsible toggle
document.getElementById("customize-toggle").addEventListener("click", () => {
  const section = document.getElementById("customize-toggle").closest(".settings-collapse");
  const body = document.getElementById("customize-body");
  section.classList.toggle("open");
  body.classList.toggle("hidden");
});

document.getElementById("agent-defaults-toggle").addEventListener("click", () => {
  const section = document.getElementById("agent-defaults-toggle").closest(".settings-collapse");
  const body = document.getElementById("agent-defaults-body");
  section.classList.toggle("open");
  body.classList.toggle("hidden");
});

const _settingAutoRename = document.getElementById("setting-auto-rename");
const _settingAutoRenameNewOnly = document.getElementById("setting-auto-rename-new-only");
const _autoRenameNewOnlyRow = document.getElementById("auto-rename-new-only-row");
const _settingTitle = document.getElementById("setting-title");
const _settingDefaultName = document.getElementById("setting-default-agent-name");
const _settingPrefix = document.getElementById("setting-agent-prefix");
const _settingPort = document.getElementById("setting-port");
const _settingShellCmd = document.getElementById("setting-shell-command");
const _settingInstallAlias = document.getElementById("setting-install-alias");

function _loadAgentDefaults() {
  fetch("/api/config").then(r => r.json()).then(cfg => {
    _settingAutoRename.checked = !!cfg.autoRenameAgents;
    _autoRenameNewOnlyRow.style.display = cfg.autoRenameAgents ? "" : "none";
    _settingAutoRenameNewOnly.checked = cfg.autoRenameNewOnly !== false; // default true
    _settingTitle.value = cfg.title || "CEO Dashboard";
    _defaultAgentName = cfg.defaultAgentName || "agent";
    _settingDefaultName.value = cfg.defaultAgentName || "agent";
    _settingPrefix.value = cfg.agentPrefix || "ceo-";
    _settingPort.value = cfg.port || 9145;
    _settingShellCmd.value = cfg.shellCommand || "ceo";
    // Sync accent color from server config (for cross-device consistency)
    if (cfg.accentColor && ACCENT_PRESETS[cfg.accentColor] && !localStorage.getItem("accentColor")) {
      localStorage.setItem("accentColor", cfg.accentColor);
      applyAccentColor(cfg.accentColor);
    }
    if (cfg.bgColor && !localStorage.getItem("bgColor")) {
      localStorage.setItem("bgColor", cfg.bgColor);
      applyBgColor(cfg.bgColor);
    }
  }).catch(() => {});
}

let _agentDefaultsSaveTimer = null;
function _saveAgentDefault(key, value) {
  clearTimeout(_agentDefaultsSaveTimer);
  _agentDefaultsSaveTimer = setTimeout(async () => {
    try {
      await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
    } catch {}
  }, 400);
}

_settingAutoRename.addEventListener("change", async () => {
  const enabled = _settingAutoRename.checked;
  _autoRenameNewOnlyRow.style.display = enabled ? "" : "none";
  try {
    const res = await fetch("/api/settings/auto-rename-agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) {
      _settingAutoRename.checked = !enabled;
      _autoRenameNewOnlyRow.style.display = !enabled ? "" : "none";
    }
  } catch {
    _settingAutoRename.checked = !enabled;
    _autoRenameNewOnlyRow.style.display = !enabled ? "" : "none";
  }
});

_settingAutoRenameNewOnly.addEventListener("change", async () => {
  const newOnly = _settingAutoRenameNewOnly.checked;
  try {
    const res = await fetch("/api/settings/auto-rename-new-only", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: newOnly }),
    });
    if (!res.ok) {
      _settingAutoRenameNewOnly.checked = !newOnly;
    }
  } catch {
    _settingAutoRenameNewOnly.checked = !newOnly;
  }
});
_settingTitle.addEventListener("input", () => {
  const v = _settingTitle.value.trim() || "CEO Dashboard";
  TAB_TITLE_DEFAULT = v;
  document.title = v;
  const headerTitle = document.getElementById("header-title");
  if (headerTitle) headerTitle.textContent = v;
  _saveAgentDefault("title", v);
});
_settingDefaultName.addEventListener("input", () => {
  const v = _settingDefaultName.value.trim();
  _defaultAgentName = v || "agent";
  _saveAgentDefault("defaultAgentName", v || "agent");
});
_settingPrefix.addEventListener("input", () => {
  _saveAgentDefault("agentPrefix", _settingPrefix.value.trim() || "ceo-");
});
_settingPort.addEventListener("input", () => {
  const v = parseInt(_settingPort.value);
  if (v > 0) _saveAgentDefault("port", v);
});
_settingShellCmd.addEventListener("input", () => {
  const v = _settingShellCmd.value.trim().replace(/[^a-zA-Z0-9_-]/g, "");
  if (v) _saveAgentDefault("shellCommand", v);
});
_settingInstallAlias.addEventListener("click", async () => {
  _settingInstallAlias.disabled = true;
  _settingInstallAlias.textContent = "Installing...";
  try {
    const res = await fetch("/api/settings/install-alias", { method: "POST" });
    const data = await res.json();
    if (data.ok) {
      _settingInstallAlias.textContent = "Installed";
      setTimeout(() => { _settingInstallAlias.textContent = "Install"; _settingInstallAlias.disabled = false; }, 2000);
    } else {
      _settingInstallAlias.textContent = "Error";
      setTimeout(() => { _settingInstallAlias.textContent = "Install"; _settingInstallAlias.disabled = false; }, 2000);
    }
  } catch {
    _settingInstallAlias.textContent = "Error";
    setTimeout(() => { _settingInstallAlias.textContent = "Install"; _settingInstallAlias.disabled = false; }, 2000);
  }
});

// --- Workspace config editor ---

// Collapsible toggle
document.getElementById("workspace-toggle").addEventListener("click", () => {
  const section = document.getElementById("workspace-toggle").closest(".settings-collapse");
  const body = document.getElementById("workspace-collapse-body");
  section.classList.toggle("open");
  body.classList.toggle("hidden");
});

const _wsListEl = document.getElementById("workspace-list");
const _wsAddPath = document.getElementById("workspace-add-path");
const _wsAddLabel = document.getElementById("workspace-add-label");
const _wsAddBtn = document.getElementById("workspace-add-btn");
const _wsDefaultSelectEl = document.getElementById("workspace-default-select");
let _wsConfig = { workspaces: [], defaultWorkspace: "" };

let _wsDragIdx = -1;
let _wsDragOverIdx = -1;

function _renderWorkspaceEditor() {
  // Render workspace rows
  _wsListEl.innerHTML = "";
  for (let i = 0; i < _wsConfig.workspaces.length; i++) {
    const ws = _wsConfig.workspaces[i];
    const row = document.createElement("div");
    row.className = "workspace-row" + (ws.builtIn ? " workspace-row-builtin" : "");
    row.draggable = true;
    row.dataset.idx = i;
    row.innerHTML = `
      <span class="workspace-drag-handle" title="Drag to reorder">&#x2630;</span>
      <span class="workspace-row-path" title="${escapeAttr(ws.path)}">${escapeHtml(shortPath(ws.path))}</span>
      <span class="workspace-row-label">${escapeHtml(ws.label || "")}${ws.builtIn ? ' <span class="workspace-builtin-badge">built-in</span>' : ""}</span>
      ${ws.builtIn ? "" : '<button class="workspace-row-remove" title="Remove">&times;</button>'}
    `;
    if (!ws.builtIn) {
      row.querySelector(".workspace-row-remove").addEventListener("click", () => {
        _wsConfig.workspaces.splice(i, 1);
        if (_wsConfig.defaultWorkspace === ws.path && _wsConfig.workspaces.length > 0) {
          _wsConfig.defaultWorkspace = _wsConfig.workspaces[0].path;
        }
        _saveWorkspaceConfig();
      });
    }
    // Drag events
    row.addEventListener("dragstart", (e) => {
      _wsDragIdx = i;
      row.classList.add("workspace-row-dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragend", () => {
      row.classList.remove("workspace-row-dragging");
      _wsListEl.querySelectorAll(".workspace-row").forEach(r => r.classList.remove("workspace-row-dragover-above", "workspace-row-dragover-below"));
      if (_wsDragIdx !== -1 && _wsDragOverIdx !== -1 && _wsDragIdx !== _wsDragOverIdx) {
        const [moved] = _wsConfig.workspaces.splice(_wsDragIdx, 1);
        _wsConfig.workspaces.splice(_wsDragOverIdx, 0, moved);
        _saveWorkspaceConfig();
      }
      _wsDragIdx = -1;
      _wsDragOverIdx = -1;
    });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const rect = row.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      const targetIdx = parseInt(row.dataset.idx);
      row.classList.remove("workspace-row-dragover-above", "workspace-row-dragover-below");
      if (e.clientY < mid) {
        row.classList.add("workspace-row-dragover-above");
        _wsDragOverIdx = targetIdx > _wsDragIdx ? targetIdx - 1 : targetIdx;
      } else {
        row.classList.add("workspace-row-dragover-below");
        _wsDragOverIdx = targetIdx < _wsDragIdx ? targetIdx + 1 : targetIdx;
      }
    });
    row.addEventListener("dragleave", () => {
      row.classList.remove("workspace-row-dragover-above", "workspace-row-dragover-below");
    });
    _wsListEl.appendChild(row);
  }
  // Render default custom select
  const trigger = _wsDefaultSelectEl.querySelector(".custom-select-label");
  const optionsContainer = _wsDefaultSelectEl.querySelector(".custom-select-options");
  optionsContainer.innerHTML = "";
  const current = _wsConfig.workspaces.find(w => w.path === _wsConfig.defaultWorkspace);
  trigger.textContent = current ? current.label : "—";
  for (const ws of _wsConfig.workspaces) {
    const opt = document.createElement("div");
    opt.className = "custom-select-option" + (ws.path === _wsConfig.defaultWorkspace ? " selected" : "");
    opt.textContent = ws.label;
    opt.addEventListener("click", () => {
      _wsConfig.defaultWorkspace = ws.path;
      _wsDefaultSelectEl.classList.remove("open");
      _saveWorkspaceConfig();
    });
    optionsContainer.appendChild(opt);
  }
}

function _loadWorkspaceConfig() {
  fetch("/api/config").then(r => r.json()).then(cfg => {
    _wsConfig.workspaces = cfg.workspaces || [];
    _wsConfig.defaultWorkspace = cfg.defaultWorkspace || "";
    _renderWorkspaceEditor();
  }).catch(() => {});
}

async function _saveWorkspaceConfig() {
  _renderWorkspaceEditor();
  _renderWorkdirPills(_wsConfig.workspaces);
  DEFAULT_WORKDIR = _wsConfig.defaultWorkspace;
  selectedWorkdirPath = DEFAULT_WORKDIR;
  // Find built-in position, filter it out before saving
  const builtInIdx = _wsConfig.workspaces.findIndex(w => w.builtIn);
  const userWorkspaces = _wsConfig.workspaces.filter(w => !w.builtIn);
  const payload = { workspaces: userWorkspaces, defaultWorkspace: _wsConfig.defaultWorkspace };
  if (builtInIdx !== -1) payload.builtInPosition = builtInIdx;
  try {
    await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {}
}

_wsAddBtn.addEventListener("click", () => {
  const pathVal = _wsAddPath.value.trim();
  if (!pathVal) return;
  const label = _wsAddLabel.value.trim() || pathVal.split("/").filter(Boolean).pop() || pathVal;
  if (_wsConfig.workspaces.some(w => w.path === pathVal)) return; // no dupes
  _wsConfig.workspaces.push({ path: pathVal, label });
  if (!_wsConfig.defaultWorkspace) _wsConfig.defaultWorkspace = pathVal;
  _wsAddPath.value = "";
  _wsAddLabel.value = "";
  _saveWorkspaceConfig();
  // Auto-select the newly added workspace in the new agent modal
  setWorkdir(pathVal);
});

_wsAddPath.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); _wsAddBtn.click(); }
});
_wsAddLabel.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); _wsAddBtn.click(); }
});

// Custom select toggle
_wsDefaultSelectEl.querySelector(".custom-select-trigger").addEventListener("click", () => {
  _wsDefaultSelectEl.classList.toggle("open");
});
// Close custom select when clicking outside
document.addEventListener("click", (e) => {
  if (!_wsDefaultSelectEl.contains(e.target)) {
    _wsDefaultSelectEl.classList.remove("open");
  }
});

// --- Bookmarks Panel (slide-out) ---

const _bmPanel = document.getElementById("bookmarks-panel");
const _bmBackdrop = document.getElementById("bookmarks-backdrop");
const _bmClose = document.getElementById("bookmarks-close");
const _bmList = document.getElementById("bookmarks-list");
const _bmAddToggle = document.getElementById("bookmarks-add-toggle");
const _bmAddForm = document.getElementById("bookmarks-add-form");
const _bmAddUrl = document.getElementById("bookmark-add-url");
const _bmAddTitle = document.getElementById("bookmark-add-title");
const _bmAddSave = document.getElementById("bookmark-add-save");
const _bmAddCancel = document.getElementById("bookmark-add-cancel");
const _bmBtn = document.getElementById("bookmarks-btn");

function toggleBookmarksPanel() {
  if (_bmPanel.classList.contains("visible")) {
    closeBookmarksPanel();
  } else {
    // Close other panels
    const sp = document.getElementById("settings-panel");
    if (sp && sp.classList.contains("visible")) closeSettingsPanel();
    if (filesPanel && filesPanel.classList.contains("visible")) closeFilesPanel();
    _bmPanel.classList.add("visible");
    _bmBackdrop.classList.add("visible");
    if (_bmBtn) _bmBtn.classList.add("panel-active");
    _bmAddForm.classList.add("hidden");
    _bmAddUrl.value = "";
    _bmAddTitle.value = "";
    loadBookmarks();
    setTimeout(() => _bmClose.focus(), 100);
  }
}

function closeBookmarksPanel() {
  _bmPanel.classList.remove("visible");
  _bmBackdrop.classList.remove("visible");
  if (_bmBtn) _bmBtn.classList.remove("panel-active");
  _bmAddForm.classList.add("hidden");
}

async function loadBookmarks() {
  try {
    const res = await fetch("/api/favorites");
    const favs = await res.json();
    renderBookmarks(favs);
  } catch {}
}

function renderBookmarks(favs) {
  if (!favs.length) {
    _bmList.innerHTML = '<div class="bookmarks-empty">No bookmarks yet. Click <strong>+</strong> to add one.</div>';
    return;
  }
  _bmList.innerHTML = favs.map(f => `
    <div class="bookmark-item" data-id="${escapeAttr(f.id)}">
      <img class="bookmark-favicon" src="${escapeAttr(f.favicon || "")}" alt="" onerror="this.style.display='none'">
      <div class="bookmark-info">
        <span class="bookmark-title" data-url="${escapeAttr(f.url)}" title="${escapeAttr(f.url)}">${escapeHtml(f.title || f.url)}</span>
        <span class="bookmark-url">${escapeHtml(f.url)}</span>
      </div>
      <button class="bookmark-remove" title="Remove">&times;</button>
    </div>
  `).join("");

  // Click anywhere on bookmark row → open in browser
  _bmList.querySelectorAll(".bookmark-item").forEach(el => {
    el.style.cursor = "pointer";
    el.addEventListener("click", () => {
      const url = el.querySelector(".bookmark-title").dataset.url;
      if (url) window.open(url, "_blank");
    });
  });

  // Click remove → delete
  _bmList.querySelectorAll(".bookmark-remove").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.closest(".bookmark-item").dataset.id;
      try {
        await fetch(`/api/favorites/${id}`, { method: "DELETE" });
        loadBookmarks();
      } catch {}
    });
  });
}

// Add form toggle
_bmAddToggle.addEventListener("click", () => {
  _bmAddForm.classList.toggle("hidden");
  if (!_bmAddForm.classList.contains("hidden")) _bmAddUrl.focus();
});
_bmAddCancel.addEventListener("click", () => {
  _bmAddForm.classList.add("hidden");
  _bmAddUrl.value = "";
  _bmAddTitle.value = "";
});

// Save new bookmark
_bmAddSave.addEventListener("click", async () => {
  const url = _bmAddUrl.value.trim();
  if (!url) return;
  const title = _bmAddTitle.value.trim();
  try {
    await fetch("/api/favorites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, title }),
    });
    _bmAddUrl.value = "";
    _bmAddTitle.value = "";
    _bmAddForm.classList.add("hidden");
    loadBookmarks();
  } catch {}
});
_bmAddUrl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); _bmAddSave.click(); }
});
_bmAddTitle.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); _bmAddSave.click(); }
});

if (_bmBtn) _bmBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleBookmarksPanel(); });
_bmClose.addEventListener("click", closeBookmarksPanel);
_bmBackdrop.addEventListener("click", closeBookmarksPanel);
_bmPanel.addEventListener("keydown", (e) => {
  if (_bmPanel.classList.contains("visible")) trapFocus(_bmPanel, e);
});

// --- Version Manager ---

const _versionSection = document.getElementById("version-toggle").closest(".settings-collapse");

document.getElementById("version-toggle").addEventListener("click", () => {
  const body = document.getElementById("version-collapse-body");
  _versionSection.classList.toggle("open");
  body.classList.toggle("hidden");
});

// Config collapsible
{
  const configToggle = document.getElementById("config-toggle");
  const configSection = configToggle.closest(".settings-collapse");
  configToggle.addEventListener("click", () => {
    const body = document.getElementById("config-collapse-body");
    configSection.classList.toggle("open");
    body.classList.toggle("hidden");
  });
}

let _versionsLoaded = false;

async function _loadVersions() {
  const listEl = document.getElementById("version-list");
  // Hide section until we know there's something to show
  _versionSection.style.display = "none";
  listEl.innerHTML = '<span class="settings-hint">Loading versions...</span>';
  try {
    const res = await fetch("/api/versions");
    const data = await res.json();
    _versionsLoaded = true;
    const versions = data.versions || [];
    const hasInstallable = versions.some(v => !v.isCurrent);
    if (!hasInstallable) return; // nothing to downgrade to — keep hidden
    _versionSection.style.display = "";
    _renderVersionList(versions, listEl);
  } catch {
    // On error, keep hidden
  }
}

function _renderVersionList(versions, listEl) {
  listEl.innerHTML = "";
  if (!versions.length) {
    listEl.innerHTML = '<span class="settings-hint">No tagged versions found.</span>';
    return;
  }
  for (const v of versions) {
    const row = document.createElement("div");
    row.className = "version-row" + (v.isCurrent ? " version-row-current" : "");
    const tag = document.createElement("span");
    tag.className = "version-tag";
    tag.textContent = v.tag;
    const date = document.createElement("span");
    date.className = "version-date";
    date.textContent = v.date ? new Date(v.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
    row.appendChild(tag);
    row.appendChild(date);
    if (v.isCurrent) {
      const badge = document.createElement("span");
      badge.className = "version-current-badge";
      badge.textContent = "Current";
      row.appendChild(badge);
    } else {
      const btn = document.createElement("button");
      btn.className = "version-install-btn";
      btn.textContent = "Install";
      btn.addEventListener("click", () => _installVersion(v.tag, btn));
      row.appendChild(btn);
    }
    listEl.appendChild(row);
  }
}

async function _installVersion(tag, btn) {
  if (!confirm(`Switch to ${tag}? The server will restart.`)) return;
  btn.disabled = true;
  btn.textContent = "Installing...";
  try {
    const res = await fetch("/api/install-version", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag }),
    });
    const data = await res.json();
    if (!res.ok) {
      showUpdateError(data);
      btn.textContent = "Install";
      btn.disabled = false;
      return;
    }
    // Server is restarting — poll until it's back
    btn.textContent = "Restarting...";
    const start = Date.now();
    const poll = setInterval(async () => {
      if (Date.now() - start > 30000) { clearInterval(poll); btn.textContent = "Timeout"; return; }
      try {
        const r = await fetch("/api/version", { signal: AbortSignal.timeout(2000) });
        if (r.ok) { clearInterval(poll); location.reload(); }
      } catch {}
    }, 1500);
  } catch {
    btn.textContent = "Error";
    setTimeout(() => { btn.textContent = "Install"; btn.disabled = false; }, 2000);
  }
}

// Load config sections when settings panel opens
const _origLoadSettings = loadSettings;
loadSettings = async function() {
  _versionsLoaded = false;
  _versionSection.style.display = "none";
  _versionSection.classList.remove("open");
  document.getElementById("version-collapse-body").classList.add("hidden");
  _loadVersions();
  _loadAgentDefaults();
  _loadWorkspaceConfig();
  return _origLoadSettings();
};

// --- "New" settings badge system ---
// Add setting IDs here when shipping new features. Remove them after a few versions.
// ═══════════════════════════════════════════════════
// NEW SETTINGS BADGE SYSTEM
//
// To mark a setting as "New":
//   1. Add its data-setting-id to _NEW_SETTINGS below
//   2. Ensure the HTML row has data-setting-id="your-id"
//   3. That's it — dot on settings button, pill on section toggle,
//      and pill on the individual row all appear automatically.
//   4. Pills disappear after the user opens the section and views them.
//   5. Remove from _NEW_SETTINGS after a few versions.
// ═══════════════════════════════════════════════════

const _NEW_SETTINGS = ["auto-rename-agents", "milestone-celebration"];
const _SEEN_KEY = "ceo-seen-settings";

function _getSeenSettings() {
  try { return JSON.parse(localStorage.getItem(_SEEN_KEY)) || []; } catch { return []; }
}

function _markSeen(ids) {
  const seen = new Set(_getSeenSettings());
  for (const id of ids) seen.add(id);
  localStorage.setItem(_SEEN_KEY, JSON.stringify([...seen]));
  _updateSettingsNewDot();
}

function _getUnseenSettings() {
  const seen = new Set(_getSeenSettings());
  return _NEW_SETTINGS.filter(id => !seen.has(id));
}

function _updateSettingsNewDot() {
  const dot = document.getElementById("settings-new-dot");
  if (!dot) return;
  dot.style.display = _getUnseenSettings().length > 0 ? "" : "none";
}

function _createNewPill() {
  const pill = document.createElement("span");
  pill.className = "settings-new-pill";
  pill.dataset.auto = "1";
  pill.textContent = "New";
  return pill;
}

function _renderNewPills() {
  settingsPanel.querySelectorAll(".settings-new-pill[data-auto]").forEach(el => el.remove());

  const unseen = new Set(_getUnseenSettings());
  if (unseen.size === 0) return;

  // Pills on individual setting rows (next to label)
  settingsPanel.querySelectorAll("[data-setting-id]").forEach(row => {
    if (!unseen.has(row.dataset.settingId)) return;
    const label = row.querySelector(".settings-label");
    if (label && !label.querySelector(".settings-new-pill")) {
      label.appendChild(document.createTextNode(" "));
      label.appendChild(_createNewPill());
    }
  });

  // Pills on parent collapsible section toggles
  const sections = new Set();
  settingsPanel.querySelectorAll("[data-setting-id]").forEach(row => {
    if (!unseen.has(row.dataset.settingId)) return;
    const collapse = row.closest(".settings-collapse");
    if (collapse) sections.add(collapse);
  });
  for (const section of sections) {
    const toggle = section.querySelector(".settings-collapse-toggle");
    if (toggle && !toggle.querySelector(".settings-new-pill")) {
      toggle.appendChild(_createNewPill());
    }
  }
}

function _hookCollapsibleSeen() {
  settingsPanel.querySelectorAll(".settings-collapse-toggle").forEach(toggle => {
    if (toggle._newSettingHooked) return;
    toggle._newSettingHooked = true;
    toggle.addEventListener("click", () => {
      const section = toggle.closest(".settings-collapse");
      if (!section) return;
      setTimeout(() => {
        const body = section.querySelector(".settings-collapse-body");
        if (!body || body.classList.contains("hidden")) return;
        // Remove pill from the section toggle immediately — user expanded it
        toggle.querySelectorAll(".settings-new-pill[data-auto]").forEach(el => el.remove());
        // Keep individual row pills visible so user can see WHICH settings are new.
        // Fade them out after 3s, then mark as seen.
        const rowPills = body.querySelectorAll(".settings-new-pill[data-auto]");
        if (rowPills.length === 0) return;
        setTimeout(() => {
          const ids = [];
          body.querySelectorAll("[data-setting-id]").forEach(row => ids.push(row.dataset.settingId));
          rowPills.forEach(pill => {
            pill.style.transition = "opacity 0.4s ease";
            pill.style.opacity = "0";
            setTimeout(() => pill.remove(), 400);
          });
          if (ids.length > 0) _markSeen(ids);
        }, 3000);
      }, 50);
    });
  });
}

function _markVisibleNewSeen() {
  const ids = [];
  settingsPanel.querySelectorAll("[data-setting-id]").forEach(row => {
    const body = row.closest(".settings-collapse-body");
    if (!body || !body.classList.contains("hidden")) {
      ids.push(row.dataset.settingId);
    }
  });
  if (ids.length > 0) _markSeen(ids);
}

(function _initNewSettingsDot() {
  const btn = document.getElementById("settings-btn");
  if (!btn) return;
  const dot = document.createElement("span");
  dot.id = "settings-new-dot";
  dot.className = "settings-new-dot";
  dot.style.display = "none";
  btn.appendChild(dot);
  _updateSettingsNewDot();
})();

const _origLoadSettings2 = loadSettings;
loadSettings = async function() {
  const result = _origLoadSettings2();
  _renderNewPills();
  _hookCollapsibleSeen();
  setTimeout(_markVisibleNewSeen, 800);
  return result;
};

