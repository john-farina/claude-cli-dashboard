// --- DOM elements (must be declared here since modals.js loads before app.js) ---
const newAgentBtn = document.getElementById("new-agent-btn");
const modalOverlay = document.getElementById("modal-overlay");
const modalCancel = document.getElementById("modal-cancel");
const newAgentForm = document.getElementById("new-agent-form");
const wsModalOverlay = document.getElementById("workspace-modal-overlay");
const wsCancel = document.getElementById("workspace-cancel");
const wsForm = document.getElementById("workspace-form");
const sessionSearch = document.getElementById("session-search");
const sessionList = document.getElementById("session-list");
const sessionSelectedInfo = document.getElementById("session-selected-info");
const sessionSelectedLabel = document.getElementById("session-selected-label");
const sessionDeselect = document.getElementById("session-deselect");
const promptLabel = document.getElementById("prompt-label");

// --- Session Picker ---

function relativeTime(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function formatSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return bytes + "B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + "KB";
  return (bytes / (1024 * 1024)).toFixed(1) + "MB";
}

function renderSessionList(sessions) {
  sessionList.innerHTML = "";
  for (const s of sessions) {
    const item = document.createElement("div");
    item.className = "session-item" + (selectedSessionId === s.sessionId ? " selected" : "");
    item.dataset.sessionId = s.sessionId;
    item.dataset.projectPath = s.projectPath || "";

    const title = s.lastPrompt?.slice(0, 120) || s.firstPrompt?.slice(0, 120) || s.summary?.slice(0, 120) || "Untitled session";
    const subtitle = s.lastPrompt && s.firstPrompt && s.lastPrompt !== s.firstPrompt
      ? s.firstPrompt.slice(0, 80) : "";
    const branch = s.gitBranch || "";
    const time = relativeTime(s.modified);
    const size = formatSize(s.fileSize);

    item.innerHTML = `
      <div class="session-item-summary">${escapeHtml(title)}</div>
      ${subtitle ? `<div class="session-item-first-prompt">${escapeHtml(subtitle)}</div>` : ""}
      <div class="session-item-meta">
        <span>${time}</span>
        ${branch ? `<span class="session-branch">${escapeHtml(branch)}</span>` : ""}
        ${size ? `<span>${size}</span>` : ""}
      </div>
    `;

    item.addEventListener("click", () => selectSession(s));
    item.setAttribute("tabindex", "-1");
    sessionList.appendChild(item);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function extractVideoFrames(file, onProgress) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  const url = URL.createObjectURL(file);
  video.src = url;

  await new Promise((resolve, reject) => {
    video.onloadedmetadata = resolve;
    video.onerror = () => reject(new Error("Failed to load video"));
  });

  const duration = video.duration;
  const frameCount = Math.min(20, Math.max(5, Math.floor(duration / 2)));
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const frames = [];
  const baseName = file.name.replace(/\.[^.]+$/, "");

  for (let i = 0; i < frameCount; i++) {
    const time = (duration * i) / frameCount;
    video.currentTime = time;
    await new Promise((resolve) => {
      video.onseeked = resolve;
    });
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85)
    );
    const base64 = await blobToBase64(blob);
    const frameName = `${baseName}-frame-${i + 1}.jpg`;
    const res = await fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: frameName, data: base64 }),
    });
    const result = await res.json();
    if (result.path) {
      frames.push({ path: result.path, name: frameName });
    }
    if (onProgress) onProgress(i + 1, frameCount);
  }

  URL.revokeObjectURL(url);
  return { frames, duration, frameCount };
}

function renderAttachmentChips(card, attachments) {
  const container = card.querySelector(".attachment-chips");
  if (!container) return;
  // Preserve paste chip across re-renders
  const pasteChip = container.querySelector(".attachment-chip.paste");
  if (attachments.length === 0) {
    container.innerHTML = "";
    if (pasteChip) container.appendChild(pasteChip);
    return;
  }
  container.innerHTML = attachments
    .map((a, i) => {
      if (a.videoGroup) {
        const label = a.processing
          ? escapeHtml(a.progressText || `Processing ${a.name}...`)
          : `${escapeHtml(a.name)} (${a.frameCount} frames)`;
        return `<span class="attachment-chip video${a.processing ? " processing" : ""}">
          <span class="attachment-chip-name">${label}</span>
          ${a.processing ? "" : `<button class="attachment-chip-remove" data-idx="${i}">&times;</button>`}
        </span>`;
      }
      return `<span class="attachment-chip">
          <span class="attachment-chip-name">${escapeHtml(a.name)}</span>
          <button class="attachment-chip-remove" data-idx="${i}">&times;</button>
        </span>`;
    })
    .join("");
  for (const btn of container.querySelectorAll(".attachment-chip-remove")) {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.idx);
      attachments.splice(idx, 1);
      renderAttachmentChips(card, attachments);
    });
  }
  // Re-append preserved paste chip
  if (pasteChip) container.appendChild(pasteChip);
}

function renderPasteChip(card, lineCount, onRemove) {
  const container = card.querySelector(".attachment-chips");
  if (!container) return;
  // Remove any existing paste chip first
  const existing = container.querySelector(".attachment-chip.paste");
  if (existing) existing.remove();

  const chip = document.createElement("span");
  chip.className = "attachment-chip paste";
  chip.innerHTML = `
    <span class="attachment-chip-name">\u{1F4CB} ${lineCount} lines pasted</span>
    <button class="attachment-chip-remove">&times;</button>
  `;
  chip.querySelector(".attachment-chip-remove").addEventListener("click", () => {
    chip.remove();
    onRemove();
  });
  container.appendChild(chip);
}

function selectSession(session) {
  // Toggle: clicking selected session deselects
  if (selectedSessionId === session.sessionId) {
    deselectSession();
    return;
  }

  selectedSessionId = session.sessionId;

  // Highlight selected item
  sessionList.querySelectorAll(".session-item").forEach((el) => {
    el.classList.toggle("selected", el.dataset.sessionId === session.sessionId);
  });

  // Show selected info
  const label = session.lastPrompt?.slice(0, 60) || session.firstPrompt?.slice(0, 60) || "Untitled";
  sessionSelectedLabel.textContent = `Resuming: ${label}`;
  sessionSelectedInfo.classList.remove("hidden");

  // Hide prompt textarea (not needed when resuming)
  promptLabel.style.display = "none";

  // Auto-fill workdir from session's projectPath
  if (session.projectPath) {
    setWorkdir(session.projectPath);
  }
}

function deselectSession() {
  selectedSessionId = null;
  sessionList.querySelectorAll(".session-item").forEach((el) => el.classList.remove("selected"));
  sessionSelectedInfo.classList.add("hidden");
  promptLabel.style.display = "";
  resetWorkdir();
}

async function fetchClaudeSessions() {
  try {
    const res = await fetch("/api/claude-sessions");
    claudeSessions = await res.json();
    renderSessionList(claudeSessions);
  } catch {
    claudeSessions = [];
  }
}

function filterSessions(query) {
  if (!query) {
    renderSessionList(claudeSessions);
    return;
  }
  const q = query.toLowerCase();
  const filtered = claudeSessions.filter((s) => {
    return (s.summary || "").toLowerCase().includes(q)
      || (s.lastPrompt || "").toLowerCase().includes(q)
      || (s.firstPrompt || "").toLowerCase().includes(q)
      || (s.gitBranch || "").toLowerCase().includes(q);
  });
  renderSessionList(filtered);
}

let searchDebounce;
sessionSearch.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => filterSessions(sessionSearch.value.trim()), 200);
});

sessionDeselect.addEventListener("click", (e) => {
  e.preventDefault();
  deselectSession();
});

let DEFAULT_WORKDIR = "";
let _homedir = ""; // set by /api/config — shortPath() is a no-op until then
let _defaultAgentName = "agent";
let _needsSetup = false;

// --- Config loading ---

fetch("/api/config")
  .then((r) => r.json())
  .then((cfg) => {
    DEFAULT_WORKDIR = cfg.defaultWorkspace || "";
    _homedir = cfg.homedir || _homedir;
    _defaultAgentName = cfg.defaultAgentName || "agent";
    selectedWorkdirPath = DEFAULT_WORKDIR;
    _needsSetup = cfg.needsSetup || false;
    if (cfg.title) {
      TAB_TITLE_DEFAULT = cfg.title;
      document.title = cfg.title;
      const headerTitle = document.getElementById("header-title");
      if (headerTitle) headerTitle.textContent = cfg.title;
    }
    // Populate the contribute tooltip with the dashboard directory + spawn button
    if (cfg.dashboardDir) {
      const dir = typeof shortPath === "function" ? shortPath(cfg.dashboardDir) : cfg.dashboardDir;
      const tip = document.querySelector(".contribute-tooltip");
      if (tip) tip.querySelector(".dashboard-dir").textContent = dir;
      const spawnBtn = document.getElementById("contribute-spawn-btn");
      if (spawnBtn) {
        spawnBtn.addEventListener("click", async () => {
          spawnBtn.disabled = true;
          spawnBtn.textContent = "Creating…";
          try {
            const res = await fetch("/api/sessions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: "contributor", workdir: cfg.dashboardDir }),
            });
            if (res.ok) {
              const data = await res.json();
              addAgentCard(data.name, data.workdir, data.branch, data.isWorktree, false);
              spawnBtn.textContent = "Created!";
              setTimeout(() => {
                const agent = agents.get(data.name);
                if (agent) agent.card.scrollIntoView({ behavior: "smooth", block: "center" });
              }, 300);
            } else {
              spawnBtn.textContent = "Create Agent";
              spawnBtn.disabled = false;
            }
          } catch {
            spawnBtn.textContent = "Create Agent";
            spawnBtn.disabled = false;
          }
        });
      }
    }
    _renderWorkdirPills(cfg.workspaces || []);
    if (typeof updateEmptyState === "function") updateEmptyState();
  })
  .catch((err) => console.error("[config] Failed to load config:", err));

function _renderWorkdirPills(workspaces) {
  const customBtn = workdirOptions.querySelector('[data-path="__custom__"]');
  // Remove any previously rendered workspace pills
  workdirOptions.querySelectorAll(".workdir-pill:not([data-path='__custom__'])").forEach((p) => p.remove());
  // Insert workspace pills before the Custom button
  for (const ws of workspaces) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "workdir-pill";
    btn.dataset.path = ws.path;
    btn.textContent = ws.label;
    workdirOptions.insertBefore(btn, customBtn);
  }
  // Activate the default workspace pill
  const defaultPill = workdirOptions.querySelector(`.workdir-pill[data-path="${CSS.escape(DEFAULT_WORKDIR)}"]`);
  if (defaultPill) defaultPill.classList.add("active");
}

// --- Workdir picker ---

const workdirOptions = document.getElementById("workdir-options");
const workdirCustom = document.getElementById("agent-workdir-custom");
let selectedWorkdirPath = DEFAULT_WORKDIR;

workdirOptions.addEventListener("click", (e) => {
  const pill = e.target.closest(".workdir-pill");
  if (!pill) return;
  workdirOptions.querySelectorAll(".workdir-pill").forEach((p) => p.classList.remove("active"));
  pill.classList.add("active");
  const path = pill.dataset.path;
  if (path === "__custom__") {
    workdirCustom.classList.remove("hidden");
    workdirCustom.focus();
    selectedWorkdirPath = "__custom__";
  } else {
    workdirCustom.classList.add("hidden");
    workdirCustom.value = "";
    selectedWorkdirPath = path;
  }
});

function getSelectedWorkdir() {
  if (selectedWorkdirPath === "__custom__") return workdirCustom.value.trim();
  return selectedWorkdirPath;
}

function setWorkdir(path) {
  const pill = workdirOptions.querySelector(`.workdir-pill[data-path="${CSS.escape(path)}"]`);
  workdirOptions.querySelectorAll(".workdir-pill").forEach((p) => p.classList.remove("active"));
  if (pill) {
    pill.classList.add("active");
    workdirCustom.classList.add("hidden");
    workdirCustom.value = "";
    selectedWorkdirPath = path;
  } else {
    workdirOptions.querySelector('.workdir-pill[data-path="__custom__"]').classList.add("active");
    workdirCustom.classList.remove("hidden");
    workdirCustom.value = path;
    selectedWorkdirPath = "__custom__";
  }
}

function resetWorkdir() {
  workdirOptions.querySelectorAll(".workdir-pill").forEach((p) => p.classList.remove("active"));
  const defaultPill = workdirOptions.querySelector(`.workdir-pill[data-path="${CSS.escape(DEFAULT_WORKDIR)}"]`);
  if (defaultPill) defaultPill.classList.add("active");
  workdirCustom.classList.add("hidden");
  workdirCustom.value = "";
  selectedWorkdirPath = DEFAULT_WORKDIR;
}
// --- Keyboard Accessibility Helpers ---

function makeKeyboardActivatable(el) {
  if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
  el.setAttribute("role", "button");
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      el.click();
    }
  });
}

// Track keyboard vs mouse navigation — scoped styles only show during keyboard use
document.addEventListener("keydown", (e) => {
  if (e.key === "Tab") document.body.classList.add("keyboard-nav");
});
document.addEventListener("mousedown", () => {
  document.body.classList.remove("keyboard-nav");
});

function trapFocus(container, e) {
  if (e.key !== "Tab") return;
  const focusable = [...container.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter(el => el.offsetParent !== null); // only visible elements
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

// Scroll focused element into view — generous positioning so the user always has context
document.addEventListener("focusin", (e) => {
  if (typeof _loaderDismissed !== "undefined" && !_loaderDismissed) return; // don't scroll during page load
  const el = e.target;
  // Skip elements inside fixed/overlay panels that manage their own scroll
  if (el.closest("#shell-terminal") || el.closest(".modal") || el.closest("#files-panel") || el.closest("#settings-panel")) return;
  const card = el.closest(".agent-card");
  const headerH = 60; // sticky dashboard header height
  const margin = 80;  // generous breathing room above the element

  // When focusing the card's textarea input, scroll so the input sits just
  // above the shell panel (or viewport bottom), with the agent terminal visible above
  const isCardInput = card && el.closest(".card-input");
  if (isCardInput) {
    const inputArea = el.closest(".card-input");
    const inputRect = inputArea.getBoundingClientRect();
    const shellPanel = document.getElementById("shell-panel");
    const bottomCutoff = shellPanel ? shellPanel.offsetHeight : 0;
    const viewBottom = window.innerHeight - bottomCutoff;
    const isHidden = inputRect.bottom > viewBottom - 10 || inputRect.top < headerH;
    const isTooLow = inputRect.bottom > viewBottom - 60; // too close to shell panel edge
    if (isHidden || isTooLow) {
      // Place input bottom just above the shell panel with breathing room
      const targetBottom = viewBottom - 20;
      window.scrollBy({ top: inputRect.bottom - targetBottom, behavior: "smooth" });
    }
    return;
  }

  // Only scroll if the card's input area is not visible
  if (!card) return;
  const inputArea = card.querySelector(".card-input");
  if (!inputArea) return;
  const inputRect = inputArea.getBoundingClientRect();
  const shellPanel = document.getElementById("shell-panel");
  const bottomCutoff = shellPanel ? shellPanel.offsetHeight : 0;
  const viewTop = headerH;
  const viewBottom = window.innerHeight - bottomCutoff;
  // If any part of the input is visible, don't scroll
  if (inputRect.bottom > viewTop && inputRect.top < viewBottom) return;
  // Input completely above viewport
  if (inputRect.bottom <= viewTop) {
    window.scrollBy({ top: inputRect.top - viewTop - margin, behavior: "smooth" });
  }
  // Input completely below viewport
  if (inputRect.top >= viewBottom) {
    const targetBottom = viewBottom - 20;
    window.scrollBy({ top: inputRect.bottom - targetBottom, behavior: "smooth" });
  }
});

function updateCardNumbers() {
  const cards = [...grid.querySelectorAll(".agent-card:not(.minimized)")];
  cards.forEach((card, i) => {
    let badge = card.querySelector(".card-number-badge");
    if (cards.length >= 2 && i < 9) {
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "card-number-badge";
        card.querySelector(".card-header-left").prepend(badge);
      }
      badge.textContent = i + 1;
    } else if (badge) {
      badge.remove();
    }
  });
}
// --- Modals ---

let _selectedTemplate = null;

async function fetchAndRenderTemplates() {
  // Find or create container above the form fields
  let container = document.getElementById("template-cards-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "template-cards-container";
    container.className = "template-cards";
    // Insert before the first label/field in the form
    const firstLabel = newAgentForm.querySelector("label, .form-group, #workdir-options");
    const target = firstLabel ? firstLabel.parentElement : newAgentForm;
    if (firstLabel) {
      target.insertBefore(container, firstLabel);
    } else {
      newAgentForm.prepend(container);
    }
  }
  container.innerHTML = "";
  _selectedTemplate = null;

  try {
    const res = await fetch("/api/agent-templates");
    const templates = await res.json();
    if (!templates || templates.length === 0) {
      container.style.display = "none";
      return;
    }
    container.style.display = "";
    for (const tpl of templates) {
      const card = document.createElement("div");
      card.className = "template-card";
      card.title = tpl.prompt || "";
      card.innerHTML = `
        <span class="template-card-icon">${escapeHtml(tpl.icon || tpl.name.charAt(0).toUpperCase())}</span>
        <span>${escapeHtml(tpl.name)}</span>
      `;
      card.addEventListener("click", () => {
        const nameInput = document.getElementById("agent-name");
        const promptInput = document.getElementById("agent-prompt");
        if (_selectedTemplate === tpl) {
          // Deselect
          card.classList.remove("selected");
          _selectedTemplate = null;
          nameInput.value = _defaultAgentName;
          // Remove prepended prompt
          if (tpl.prompt && promptInput.value.startsWith(tpl.prompt)) {
            promptInput.value = promptInput.value.slice(tpl.prompt.length).replace(/^\n+/, "");
          }
          nameInput.focus();
          nameInput.select();
          return;
        }
        // Deselect previous
        container.querySelectorAll(".template-card").forEach(c => c.classList.remove("selected"));
        card.classList.add("selected");
        // Remove previous template prompt if any
        if (_selectedTemplate && _selectedTemplate.prompt && promptInput.value.startsWith(_selectedTemplate.prompt)) {
          promptInput.value = promptInput.value.slice(_selectedTemplate.prompt.length).replace(/^\n+/, "");
        }
        _selectedTemplate = tpl;
        // Set prefix
        nameInput.value = tpl.prefix || _defaultAgentName;
        // Prepend prompt
        if (tpl.prompt) {
          const existing = promptInput.value.trim();
          promptInput.value = existing ? tpl.prompt + "\n" + existing : tpl.prompt;
        }
        nameInput.focus();
        nameInput.select();
      });
      container.appendChild(card);
    }
  } catch (err) {
    console.error("[templates] Failed to load agent templates:", err);
    container.style.display = "none";
  }
}

function populateChainAgentDropdown() {
  const select = document.getElementById("chain-next-select");
  if (!select) return;
  // Keep the "None" option, clear the rest
  select.innerHTML = '<option value="">None</option>';
  if (typeof agents !== "undefined") {
    for (const [agentName] of agents) {
      const opt = document.createElement("option");
      opt.value = agentName;
      opt.textContent = agentName;
      select.appendChild(opt);
    }
  }
}

newAgentBtn.addEventListener("click", () => {
  modalOverlay.classList.remove("hidden");
  fetchClaudeSessions();
  fetchAndRenderTemplates();
  populateChainAgentDropdown();
  // Reset chain fields
  const chainConfig = document.getElementById("chain-config");
  if (chainConfig) chainConfig.removeAttribute("open");
  const chainPrompt = document.getElementById("chain-prompt");
  if (chainPrompt) chainPrompt.value = "";
  const chainNext = document.getElementById("chain-next-select");
  if (chainNext) chainNext.value = "";
  const chainCondition = document.getElementById("chain-condition");
  if (chainCondition) chainCondition.value = "always";
  const nameInput = document.getElementById("agent-name");
  if (!nameInput.value) nameInput.value = _defaultAgentName;
  nameInput.focus();
  nameInput.select();
});

// + Terminal button — instant create, no modal
const newTerminalBtn = document.getElementById("new-terminal-btn");
if (newTerminalBtn) {
  newTerminalBtn.addEventListener("click", () => {
    fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "terminal", type: "terminal" }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { console.error("[terminal] Create failed:", data.error); return; }
        addTerminalCard(data.name, data.workdir);
        reorderCards();
        updateEmptyState();
        scheduleMasonry();
      })
      .catch((err) => console.error("[terminal] Create failed:", err));
  });
}

function closeNewAgentModal() {
  modalOverlay.classList.add("hidden");
  deselectSession();
  sessionSearch.value = "";
  sessionList.innerHTML = "";
  document.getElementById("agent-name").value = "";
  document.getElementById("agent-prompt").value = "";
  // Clear template selection
  _selectedTemplate = null;
  const tplContainer = document.getElementById("template-cards-container");
  if (tplContainer) tplContainer.querySelectorAll(".template-card").forEach(c => c.classList.remove("selected"));
  // Clear modal attachments
  modalPendingAttachments.length = 0;
  const chips = document.getElementById("modal-attachment-chips");
  if (chips) chips.innerHTML = "";
}

modalCancel.addEventListener("click", closeNewAgentModal);

modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) closeNewAgentModal();
});

modalOverlay.addEventListener("keydown", (e) => {
  if (!modalOverlay.classList.contains("hidden")) trapFocus(modalOverlay.querySelector(".modal"), e);
});
// --- Modal drag-and-drop for images/videos ---
const modalPendingAttachments = [];
const promptDropZone = document.getElementById("prompt-drop-zone");

if (promptDropZone) {
  promptDropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
    promptDropZone.classList.add("drag-over");
  });
  promptDropZone.addEventListener("dragleave", (e) => {
    e.preventDefault();
    e.stopPropagation();
    promptDropZone.classList.remove("drag-over");
  });
  promptDropZone.addEventListener("drop", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    promptDropZone.classList.remove("drag-over");
    const files = Array.from(e.dataTransfer.files);
    const chipsContainer = document.getElementById("modal-attachment-chips");
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        try {
          const base64 = await fileToBase64(file);
          const res = await fetch("/api/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename: file.name, data: base64 }),
          });
          const result = await res.json();
          if (result.path) {
            modalPendingAttachments.push({ path: result.path, name: file.name });
            renderAttachmentChips({ querySelector: () => chipsContainer }, modalPendingAttachments);
          }
        } catch (err) {
          console.error("Modal upload failed:", err);
        }
      } else if (file.type.startsWith("video/")) {
        const videoId = `video-${Date.now()}`;
        modalPendingAttachments.push({
          name: file.name,
          videoGroup: videoId,
          processing: true,
          paths: [],
          frameCount: 0,
          duration: 0,
        });
        renderAttachmentChips({ querySelector: () => chipsContainer }, modalPendingAttachments);
        try {
          const entry = modalPendingAttachments.find((a) => a.videoGroup === videoId);
          const { frames, duration, frameCount } = await extractVideoFrames(
            file,
            (done, total) => {
              if (entry) {
                entry.frameCount = total;
                entry.duration = duration;
                entry.progressText = `Extracting frames... ${done}/${total}`;
                renderAttachmentChips({ querySelector: () => chipsContainer }, modalPendingAttachments);
              }
            }
          );
          if (entry) {
            entry.processing = false;
            entry.paths = frames.map((f) => f.path);
            entry.frameCount = frameCount;
            entry.duration = Math.round(duration);
            renderAttachmentChips({ querySelector: () => chipsContainer }, modalPendingAttachments);
          }
        } catch (err) {
          console.error("Modal video extraction failed:", err);
          const idx = modalPendingAttachments.findIndex((a) => a.videoGroup === videoId);
          if (idx !== -1) modalPendingAttachments.splice(idx, 1);
          renderAttachmentChips({ querySelector: () => chipsContainer }, modalPendingAttachments);
        }
      }
    }
  });
}
// --- Modal paste for images ---
const agentPromptTextarea = document.getElementById("agent-prompt");
if (agentPromptTextarea) {
  agentPromptTextarea.addEventListener("paste", async (e) => {
    const clipboardData = e.clipboardData || window.clipboardData;
    if (!clipboardData) return;
    const imageFiles = Array.from(clipboardData.files || []).filter(f => f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    e.preventDefault();
    const chipsContainer = document.getElementById("modal-attachment-chips");
    for (const file of imageFiles) {
      try {
        const base64 = await fileToBase64(file);
        const filename = file.name === "image.png" ? `clipboard-${Date.now()}.png` : file.name;
        const res = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename, data: base64 }),
        });
        const result = await res.json();
        if (result.path) {
          modalPendingAttachments.push({ path: result.path, name: filename });
          renderAttachmentChips({ querySelector: () => chipsContainer }, modalPendingAttachments);
        }
      } catch (err) {
        console.error("Modal clipboard upload failed:", err);
      }
    }
  });
}

let creatingAgent = false;

newAgentForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (creatingAgent) return; // prevent double submit
  // Don't submit while video frames are still extracting
  if (modalPendingAttachments.some((a) => a.processing)) return;

  // Sanitize name: spaces → dashes, strip invalid chars, lowercase
  let name = document.getElementById("agent-name").value.trim();
  name = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "");
  if (!name) {
    alert("Please enter a name");
    return;
  }
  // Update the input to show the sanitized name
  document.getElementById("agent-name").value = name;

  const workdir = getSelectedWorkdir();
  const prompt = document.getElementById("agent-prompt").value.trim();

  // Collect attachment paths for initial prompt
  const hasAttachments = modalPendingAttachments.length > 0;
  let initialImages = [];
  let imageContextText = "";
  if (hasAttachments) {
    const videoContextParts = [];
    for (const a of modalPendingAttachments) {
      if (a.videoGroup) {
        initialImages.push(...a.paths);
        videoContextParts.push(
          `[Video: ${a.name} — ${a.frameCount} frames extracted from ${a.duration}s video, analyze each frame]`
        );
      } else {
        initialImages.push(a.path);
      }
    }
    imageContextText = videoContextParts.join("\n");
  }

  const body = { name, workdir: workdir || undefined };
  if (selectedSessionId) {
    body.resumeSessionId = selectedSessionId;
  } else if (hasAttachments) {
    // Send prompt text separately via paste-buffer after creation so images are included
    body.initialImages = initialImages;
    body.initialImageText = [imageContextText, prompt].filter(Boolean).join("\n");
  } else if (prompt) {
    body.prompt = prompt;
  }

  // Disable button while creating
  const submitBtn = newAgentForm.querySelector('button[type="submit"]');
  creatingAgent = true;
  submitBtn.disabled = true;
  submitBtn.textContent = "Creating...";

  try {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = await res.json();
      // Set chain if configured
      const chainNext = document.getElementById("chain-next-select")?.value;
      const chainPrompt = document.getElementById("chain-prompt")?.value?.trim();
      if (chainNext && chainPrompt) {
        const chainCondition = document.getElementById("chain-condition")?.value || "always";
        try {
          await fetch(`/api/sessions/${encodeURIComponent(data.name)}/chain`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ next: chainNext, prompt: chainPrompt, condition: chainCondition }),
          });
        } catch (err) {
          console.error("[chain] Failed to set chain:", err);
        }
      }
      addAgentCard(data.name, data.workdir, data.branch, data.isWorktree, false);
      closeNewAgentModal();
      newAgentForm.reset();
      resetWorkdir();
      // Scroll the new card into view
      const agent = agents.get(data.name);
      if (agent) {
        setTimeout(() => agent.card.scrollIntoView({ behavior: "smooth", block: "center" }), 300);
      }
    } else {
      const err = await res.json();
      alert(err.error || "Failed to create agent");
    }
  } catch {
    alert("Failed to create agent");
  } finally {
    creatingAgent = false;
    submitBtn.disabled = false;
    submitBtn.textContent = "Create";
  }
});

wsCancel.addEventListener("click", () => {
  wsModalOverlay.classList.add("hidden");
});

wsModalOverlay.addEventListener("click", (e) => {
  if (e.target === wsModalOverlay) wsModalOverlay.classList.add("hidden");
});

wsModalOverlay.addEventListener("keydown", (e) => {
  if (!wsModalOverlay.classList.contains("hidden")) trapFocus(wsModalOverlay.querySelector(".modal"), e);
});

wsForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("workspace-agent-name").value;
  const workdir = document.getElementById("workspace-path").value.trim();

  const res = await fetch(`/api/sessions/${name}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workdir }),
  });

  if (res.ok) {
    const agent = agents.get(name);
    if (agent) {
      agent.workdir = workdir;
      agent.card.querySelector(".workdir-link").textContent = shortPath(workdir);
      if (agent.terminal) agent.terminal.innerHTML = "";
    }
    wsModalOverlay.classList.add("hidden");
  } else {
    const err = await res.json();
    alert(err.error || "Failed to update workspace");
  }
});
