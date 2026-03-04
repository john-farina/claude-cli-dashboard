// --- Popout Terminal Window ---
// Standalone page for a single agent, opened from the dashboard via window.open.
// Communicates with the dashboard via BroadcastChannel.

const params = new URLSearchParams(location.search);
const agentName = params.get("agent");
if (!agentName) {
  document.body.textContent = "No agent specified.";
  throw new Error("No agent param");
}

let _popoutTitle = "CEO Dashboard";
document.title = `${agentName} — ${_popoutTitle}`;
document.getElementById("agent-name").textContent = agentName;

const terminal = document.getElementById("terminal");
const statusBadge = document.getElementById("status-badge");
const promptActions = document.getElementById("prompt-actions");
const workdirEl = document.getElementById("workdir");
const branchEl = document.getElementById("branch-info");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send-btn");
const killBtn = document.getElementById("kill-btn");
const restartBtn = document.getElementById("restart-btn");
const backBtn = document.getElementById("back-btn");
const attachmentChips = document.getElementById("attachment-chips");

const ansiUp = new AnsiUp();
let currentStatus = "working";
let promptOptions = null;
let slashCommands = [];

// --- BroadcastChannel coordination ---
const bc = new BroadcastChannel("ceo-popout");
bc.postMessage({ type: "popped-out", agent: agentName });

bc.onmessage = (event) => {
  const msg = event.data;
  if (msg.agent !== agentName) return;
  if (msg.type === "kill-agent") {
    window.close();
  }
  if (msg.type === "popped-back") {
    // Dashboard recalled us
    window.close();
  }
};

backBtn.addEventListener("click", () => {
  bc.postMessage({ type: "popped-back", agent: agentName });
  window.close();
});

window.addEventListener("beforeunload", () => {
  bc.postMessage({ type: "popped-back", agent: agentName });
});

// --- WebSocket ---
let ws;
let reconnectTimer;

function connect() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    ws.close();
  }
  ws = new WebSocket(`ws://${location.host}`);
  ws.binaryType = "arraybuffer";
  ws.onopen = () => { clearTimeout(reconnectTimer); };
  ws.onclose = () => { reconnectTimer = setTimeout(connect, 2000); };
  ws.onerror = () => { try { ws.close(); } catch {} };
  ws.onmessage = (event) => {
    // Binary frames are shell PTY data — popout windows don't use the shell, ignore them
    if (event.data instanceof ArrayBuffer) return;
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    if (msg.type === "reload") { location.reload(); return; }
    if (msg.type === "output" && msg.session === agentName) {
      updateTerminal(msg.lines);
      promptOptions = msg.promptOptions || null;
      updateStatus(msg.status, msg.promptType);
      if (msg.workdir) workdirEl.textContent = shortPath(msg.workdir);
      if (msg.branch !== undefined) updateBranch(msg.branch, msg.isWorktree);
    }
  };
}
connect();

function sendInput(text) {
  if (ws && ws.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify({ type: "input", session: agentName, text }));
}
function sendKeypress(keys) {
  if (ws && ws.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify({ type: "keypress", session: agentName, keys }));
}
function sendTypeOption(keys, text) {
  if (ws && ws.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify({ type: "type-option", session: agentName, keys, text }));
}
function sendInputWithImages(text, paths) {
  if (ws && ws.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify({ type: "input-with-images", session: agentName, text, paths }));
}
function requestRefresh() {
  if (ws && ws.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify({ type: "request-refresh", session: agentName }));
}
function scheduleRefresh() {
  for (const ms of [500, 1000, 2000, 3000, 5000])
    setTimeout(requestRefresh, ms);
}

// --- Terminal rendering ---
const LINK_RE = /(https?:\/\/[^\s<>"')\]]+)|((?:\/[\w.@:+-]+)+(?:\.[\w]+)?(?::\d+)?)/g;

function escapeAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function linkifyTerminal(html) {
  const parts = html.split(/(<[^>]+>)/);
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].startsWith("<")) continue;
    parts[i] = parts[i].replace(LINK_RE, (match, url, filepath) => {
      if (url) return `<a class="terminal-link" href="${escapeAttr(url)}" target="_blank" rel="noopener">${match}</a>`;
      if (filepath && filepath.length > 3) {
        const cleanPath = filepath.replace(/[,;:!?)]+$/, "");
        const trailing = filepath.slice(cleanPath.length);
        return `<a class="terminal-link terminal-path" data-path="${escapeAttr(cleanPath)}" href="vscode://file${escapeAttr(cleanPath)}">${cleanPath}</a>${trailing}`;
      }
      return match;
    });
  }
  return parts.join("");
}

function updateTerminal(lines) {
  const content = lines.join("\n");
  if (terminal._lastContent === content) return;

  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && !sel.isCollapsed && terminal.contains(sel.anchorNode)) return;

  const forceScroll = terminal._forceScrollUntil && Date.now() < terminal._forceScrollUntil;
  const wasScrolledToBottom = terminal.scrollHeight - terminal.scrollTop - terminal.clientHeight < 30;

  terminal._lastContent = content;
  const html = linkifyTerminal(ansiUp.ansi_to_html(content));
  terminal.innerHTML = `<pre>${html}</pre>`;

  if (forceScroll || wasScrolledToBottom) {
    requestAnimationFrame(() => { terminal.scrollTop = terminal.scrollHeight; });
  }
}

// Force scroll on initial load
terminal._forceScrollUntil = Date.now() + 5000;

// --- Status + prompt actions ---
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function afterPromptAction() {
  for (const ms of [500, 1000, 2000, 3000])
    setTimeout(() => { terminal.scrollTop = terminal.scrollHeight; }, ms);
  terminal._lastContent = null;
  scheduleRefresh();
}

function updateStatus(status, promptType) {
  currentStatus = status;
  const labels = { working: "working", waiting: "needs input", asking: "has question", idle: "" };
  statusBadge.textContent = labels[status] || "";
  statusBadge.className = `status-badge ${status}`;

  // Update tab title for attention
  if (status === "waiting" || status === "asking") {
    document.title = `\u26a0 ${agentName} — ${_popoutTitle}`;
  } else {
    document.title = `${agentName} — ${_popoutTitle}`;
  }

  if (status !== "waiting" || !promptType) {
    promptActions.innerHTML = "";
    promptActions.style.display = "none";
    return;
  }
  promptActions.style.display = "";

  if (promptType === "permission") {
    promptActions.innerHTML = `
      <button class="prompt-btn prompt-btn-allow" data-action="allow-once">Allow Once</button>
      <button class="prompt-btn prompt-btn-always" data-action="allow-always">Allow Always</button>
      <button class="prompt-btn prompt-btn-deny" data-action="deny">Deny</button>
    `;
    promptActions.querySelector('[data-action="allow-once"]').addEventListener("click", () => {
      sendKeypress("Enter"); afterPromptAction();
    });
    promptActions.querySelector('[data-action="allow-always"]').addEventListener("click", () => {
      sendKeypress("Down");
      setTimeout(() => { sendKeypress("Enter"); afterPromptAction(); }, 150);
    });
    promptActions.querySelector('[data-action="deny"]').addEventListener("click", () => {
      sendKeypress(["Down", "Down"]);
      setTimeout(() => { sendKeypress("Enter"); afterPromptAction(); }, 150);
    });
  } else if (promptType === "yesno") {
    promptActions.innerHTML = `
      <button class="prompt-btn prompt-btn-allow" data-action="yes">Yes</button>
      <button class="prompt-btn prompt-btn-deny" data-action="no">No</button>
    `;
    promptActions.querySelector('[data-action="yes"]').addEventListener("click", () => {
      sendInput("y"); afterPromptAction();
    });
    promptActions.querySelector('[data-action="no"]').addEventListener("click", () => {
      sendInput("n"); afterPromptAction();
    });
  } else if (promptType === "question" && promptOptions) {
    const isTypeOption = (label) => /type\s*something|^other$/i.test(label);
    let html = '<div class="prompt-options">';
    for (const opt of promptOptions) {
      if (isTypeOption(opt.label)) {
        html += `<div class="prompt-type-input-wrap">
          <input type="text" class="prompt-type-input" data-num="${opt.index + 1}" placeholder="Type your answer...">
          <button class="prompt-btn prompt-btn-allow prompt-type-send" data-num="${opt.index + 1}">\u21B5</button>
        </div>`;
      } else {
        const title = opt.description ? escapeHtml(opt.description) : "";
        html += `<button class="prompt-btn prompt-btn-option" data-num="${opt.index + 1}" title="${title}">${escapeHtml(opt.label)}</button>`;
      }
    }
    html += '</div>';
    promptActions.innerHTML = html;

    for (const btn of promptActions.querySelectorAll(".prompt-btn-option[data-num]")) {
      btn.addEventListener("click", () => {
        sendKeypress(btn.dataset.num); afterPromptAction();
      });
    }
    for (const inp of promptActions.querySelectorAll(".prompt-type-input")) {
      const num = inp.dataset.num;
      const doTypeSubmit = () => {
        const text = inp.value.trim();
        if (!text) return;
        sendTypeOption([num], text);
        inp.value = "";
        afterPromptAction();
      };
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") doTypeSubmit(); });
      const sBtn = promptActions.querySelector(`.prompt-type-send[data-num="${num}"]`);
      if (sBtn) sBtn.addEventListener("click", doTypeSubmit);
    }
  } else if (promptType === "enter") {
    promptActions.innerHTML = `
      <button class="prompt-btn prompt-btn-allow" data-action="enter">Press Enter</button>
    `;
    promptActions.querySelector('[data-action="enter"]').addEventListener("click", () => {
      sendKeypress("Enter"); afterPromptAction();
    });
  }
}

// --- Input handling ---
const pendingAttachments = [];

function doSend() {
  const text = input.value.trim();
  if (!text && pendingAttachments.length === 0) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (pendingAttachments.some(a => a.processing)) return;

  if (pendingAttachments.length > 0) {
    const paths = [];
    const videoContextParts = [];
    for (const a of pendingAttachments) {
      if (a.videoGroup) {
        paths.push(...a.paths);
        videoContextParts.push(`[Video: ${a.name} — ${a.frameCount} frames extracted from ${a.duration}s video, analyze each frame]`);
      } else {
        paths.push(a.path);
      }
    }
    const fullText = [...videoContextParts, text].filter(Boolean).join("\n");
    sendInputWithImages(fullText, paths);
    pendingAttachments.length = 0;
    attachmentChips.innerHTML = "";
  } else {
    sendInput(text);
  }
  input.value = "";
}

// Input history
const inputHistory = [];
let historyIndex = -1;
let historyDraft = "";

function doSendWithHistory() {
  const text = input.value.trim();
  if (text) {
    if (inputHistory.length === 0 || inputHistory[inputHistory.length - 1] !== text)
      inputHistory.push(text);
  }
  historyIndex = -1;
  historyDraft = "";
  doSend();
}

// Auto-resize textarea
function autoResize() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 150) + "px";
}
input.addEventListener("input", autoResize);

input.addEventListener("keydown", (e) => {
  const dropdown = document.querySelector(".slash-dropdown");
  const dropdownVisible = dropdown && dropdown.classList.contains("visible");

  if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !dropdownVisible && !e.shiftKey) {
    const isMultiline = input.value.includes("\n");
    if (e.key === "ArrowUp" && isMultiline && input.selectionStart > input.value.indexOf("\n")) return;
    if (e.key === "ArrowDown" && isMultiline && input.selectionStart < input.value.lastIndexOf("\n")) return;
    if (inputHistory.length === 0) return;

    e.preventDefault();
    if (e.key === "ArrowUp") {
      if (historyIndex === -1) { historyDraft = input.value; historyIndex = inputHistory.length - 1; }
      else if (historyIndex > 0) historyIndex--;
      input.value = inputHistory[historyIndex];
    } else {
      if (historyIndex === -1) return;
      if (historyIndex < inputHistory.length - 1) { historyIndex++; input.value = inputHistory[historyIndex]; }
      else { historyIndex = -1; input.value = historyDraft; }
    }
    autoResize();
    return;
  }

  if (e.key !== "Enter") return;
  if (e.shiftKey) return;
  e.preventDefault();
  const hasActiveItem = dropdown && dropdown.querySelector(".slash-item.active");
  if (!dropdownVisible || !hasActiveItem) {
    doSendWithHistory();
    input.style.height = "auto";
  }
});

sendBtn.addEventListener("click", () => {
  doSendWithHistory();
  input.style.height = "auto";
});

// Click on terminal focuses input
terminal.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key.length === 1) {
    input.focus();
  }
});

// --- Slash command autocomplete ---
async function loadSlashCommands() {
  try {
    const res = await fetch("/api/slash-commands");
    slashCommands = await res.json();
  } catch { slashCommands = []; }
}
loadSlashCommands();

function setupAutocomplete() {
  const dropdown = document.createElement("div");
  dropdown.className = "slash-dropdown";
  input.parentElement.appendChild(dropdown);

  let activeIndex = -1;

  function showDropdown(matches) {
    dropdown.innerHTML = "";
    activeIndex = -1;
    if (matches.length === 0) { dropdown.classList.remove("visible"); return; }
    for (const cmd of matches) {
      const item = document.createElement("div");
      item.className = "slash-item";
      item.innerHTML = `
        <span class="slash-item-name">${escapeHtml(cmd.name)}</span>
        <span class="slash-item-desc">${escapeHtml(cmd.description)}</span>
        ${cmd.custom ? '<span class="slash-item-badge">custom</span>' : ""}
      `;
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        input.value = cmd.name + " ";
        hideDropdown();
        input.focus();
      });
      dropdown.appendChild(item);
    }
    dropdown.classList.add("visible");
  }

  function hideDropdown() { dropdown.classList.remove("visible"); activeIndex = -1; }

  function setActive(index) {
    const items = dropdown.querySelectorAll(".slash-item");
    items.forEach(el => el.classList.remove("active"));
    if (index >= 0 && index < items.length) {
      activeIndex = index;
      items[index].classList.add("active");
      items[index].scrollIntoView({ block: "nearest" });
    }
  }

  input.addEventListener("input", () => {
    const val = input.value;
    if (val.startsWith("/") && !val.includes(" ")) {
      const q = val.toLowerCase();
      showDropdown(slashCommands.filter(c => c.name.startsWith(q)));
    } else hideDropdown();
  });

  input.addEventListener("keydown", (e) => {
    if (!dropdown.classList.contains("visible")) return;
    const items = dropdown.querySelectorAll(".slash-item");
    if (items.length === 0) return;
    if (e.key === "ArrowUp") { e.preventDefault(); setActive(activeIndex <= 0 ? items.length - 1 : activeIndex - 1); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive(activeIndex >= items.length - 1 ? 0 : activeIndex + 1); }
    else if (e.key === "Tab") { e.preventDefault(); const s = items[activeIndex >= 0 ? activeIndex : 0]; input.value = s.querySelector(".slash-item-name").textContent + " "; hideDropdown(); }
    else if (e.key === "Enter" && activeIndex >= 0) { e.preventDefault(); const s = items[activeIndex]; input.value = s.querySelector(".slash-item-name").textContent + " "; hideDropdown(); }
    else if (e.key === "Escape") hideDropdown();
  });

  input.addEventListener("blur", () => { setTimeout(hideDropdown, 150); });
}
setupAutocomplete();

// --- Image drag-and-drop ---
function addAttachmentChip(name, path) {
  const chip = document.createElement("span");
  chip.className = "attachment-chip";
  chip.innerHTML = `${escapeHtml(name)} <button class="attachment-remove">&times;</button>`;
  chip.querySelector(".attachment-remove").addEventListener("click", () => {
    const idx = pendingAttachments.findIndex(a => a.path === path);
    if (idx >= 0) pendingAttachments.splice(idx, 1);
    chip.remove();
  });
  attachmentChips.appendChild(chip);
}

async function uploadFile(file) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/upload", { method: "POST", body: formData });
  const data = await res.json();
  return data.path;
}

const handleDragOver = (e) => { e.preventDefault(); e.stopPropagation(); };
const handleDrop = async (e) => {
  e.preventDefault();
  e.stopPropagation();
  const files = Array.from(e.dataTransfer.files);
  for (const file of files) {
    if (file.type.startsWith("image/")) {
      const path = await uploadFile(file);
      pendingAttachments.push({ name: file.name, path });
      addAttachmentChip(file.name, path);
    }
  }
};

terminal.addEventListener("dragover", handleDragOver);
terminal.addEventListener("drop", handleDrop);
input.parentElement.addEventListener("dragover", handleDragOver);
input.parentElement.addEventListener("drop", handleDrop);

// --- Restart button ---
restartBtn.addEventListener("click", async () => {
  terminal.innerHTML = "";
  terminal._lastContent = null;
  const spinner = document.createElement("div");
  spinner.className = "terminal-loading";
  spinner.innerHTML = '<div class="loading-spinner"></div><span>Restarting Claude...</span>';
  terminal.appendChild(spinner);

  try {
    const res = await fetch(`/api/sessions/${encodeURIComponent(agentName)}/restart`, { method: "POST" });
    if (!res.ok) {
      const err = await res.json();
      spinner.querySelector("span").textContent = err.error || "Restart failed";
      return;
    }
    terminal._forceScrollUntil = Date.now() + 5000;
    scheduleRefresh();
  } catch {
    spinner.querySelector("span").textContent = "Restart failed";
  }
});

// --- Kill button (double-click pattern) ---
let killArmed = false;
let killTimer = null;

killBtn.addEventListener("click", async () => {
  if (!killArmed) {
    killArmed = true;
    killBtn.classList.add("armed");
    killBtn.textContent = "kill";
    killTimer = setTimeout(() => {
      killArmed = false;
      killBtn.classList.remove("armed");
      killBtn.innerHTML = "\u00d7";
    }, 2000);
    return;
  }
  clearTimeout(killTimer);
  await fetch(`/api/sessions/${encodeURIComponent(agentName)}`, { method: "DELETE" });
  bc.postMessage({ type: "kill-agent", agent: agentName });
  window.close();
});

// --- Helpers ---
let _popoutHomedir = "";
fetch("/api/config").then(r => r.json()).then(cfg => {
  _popoutHomedir = cfg.homedir || "";
  if (cfg.title) {
    _popoutTitle = cfg.title;
    document.title = `${agentName} — ${_popoutTitle}`;
  }
}).catch(() => {});

function shortPath(p) {
  if (!p) return "";
  if (!_popoutHomedir) return p;
  return p.replace(new RegExp("^" + _popoutHomedir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "~");
}

function updateBranch(branch, isWorktree) {
  if (!branch) { branchEl.textContent = ""; branchEl.className = "branch-info"; return; }
  branchEl.textContent = branch;
  branchEl.className = isWorktree ? "branch-info branch-worktree" : "branch-info";
}
