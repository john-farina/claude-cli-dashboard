// --- Agent Todo Refs ---

function renderAgentTodoRefs(card, todos) {
  const container = card.querySelector(".agent-todo-refs");
  if (!container) return;
  if (!todos || todos.length === 0) {
    container.innerHTML = "";
    container.style.display = "none";
    return;
  }
  container.style.display = "flex";
  container.innerHTML = todos.map((t) => `
    <span class="agent-todo-pill" title="${escapeHtml(t.title)}" data-todo-id="${t.id}">
      <span class="agent-todo-pill-dot" style="background:${safeHex(t.hex)}"></span>
      <span class="agent-todo-pill-label">${escapeHtml(t.title)}</span>
    </span>
  `).join("");
  // Click a pill → switch to todo view and select that list
  const cardName = card.querySelector(".agent-name")?.textContent || "";
  container.querySelectorAll(".agent-todo-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      const todoId = pill.dataset.todoId;
      showTodoView(cardName);
      if (todoData && todoData.lists) {
        activeListId = todoId;
        saveTodoLastList();
        renderTodoDots();
        renderActiveList();
      }
    });
  });
}

function startTodoRefsPolling() {
  async function poll() {
    for (const [name, agent] of agents) {
      try {
        const res = await fetch(`/api/todos/by-agent/${encodeURIComponent(name)}`);
        const todos = await res.json();
        renderAgentTodoRefs(agent.card, todos);
      } catch {}
    }
  }
  poll();
  setInterval(poll, 10000);
}

// --- Todo view: capture-phase shortcut overrides ---
// Cmd+8/B/I must be caught in capture phase to prevent browser tab-switching (Cmd+8)
// and ensure they work even when the editor textarea isn't focused.
document.addEventListener("keydown", (e) => {
  if (typeof currentView === "undefined" || currentView !== "todo") return;
  if (!e.metaKey && !e.ctrlKey) return;

  const key = e.key;
  const rawEditor = document.querySelector(".todo-editor");
  const richEditor = document.getElementById("todo-rich-editor");
  const isRich = !!richEditor;

  if (key === "z" && isRich) {
    e.preventDefault();
    e.stopPropagation();
    if (e.shiftKey) richRedo();
    else richUndo();
    return;
  }

  if (key === "8") {
    e.preventDefault();
    e.stopPropagation();
    if (isRich) {
      toggleCurrentItemCheckbox();
    } else if (rawEditor) {
      rawEditor.focus();
      insertCheckbox(rawEditor);
      scheduleTodoSave();
    }
    return;
  }

  if (key === "b") {
    e.preventDefault();
    e.stopPropagation();
    if (isRich) {
      document.execCommand("bold");
      scheduleRichSave();
    } else if (rawEditor) {
      rawEditor.focus();
      wrapSelection(rawEditor, "**");
      scheduleTodoSave();
    }
    return;
  }

  if (key === "i") {
    e.preventDefault();
    e.stopPropagation();
    if (isRich) {
      document.execCommand("italic");
      scheduleRichSave();
    } else if (rawEditor) {
      rawEditor.focus();
      wrapSelection(rawEditor, "*");
      scheduleTodoSave();
    }
    return;
  }

  if (key === "=" || key === "+") {
    e.preventDefault();
    e.stopPropagation();
    if (isRich) {
      richToggleHeading(true);
      scheduleRichSave();
    } else if (rawEditor) {
      rawEditor.focus();
      toggleHeading(rawEditor);
      scheduleTodoSave();
    }
    return;
  }

  if (key === "-" || key === "_") {
    e.preventDefault();
    e.stopPropagation();
    if (isRich) {
      richToggleHeading(false);
      scheduleRichSave();
    }
    return;
  }

  // Cmd+[ / Cmd+] — switch to prev/next list
  if (key === "[" || key === "]") {
    e.preventDefault();
    e.stopPropagation();
    const sorted = [...todoData.lists].sort((a, b) => a.order - b.order);
    if (sorted.length < 2) return;
    const idx = sorted.findIndex((l) => l.id === activeListId);
    const next = key === "]"
      ? sorted[(idx + 1) % sorted.length]
      : sorted[(idx - 1 + sorted.length) % sorted.length];
    activeListId = next.id;
    saveTodoLastList();
    renderTodoDots();
    renderActiveList();
    return;
  }
}, true); // capture phase — fires before browser default behavior

// --- Todo View ---

let currentView = "agents"; // "agents" | "todo"
let todoData = { lists: [], colors: [] };
let activeListId = null;
function _todoStorageKey() {
  return window.innerWidth <= 600 ? "todo-last-mobile" : "todo-last-desktop";
}
function saveTodoLastList() {
  if (activeListId) localStorage.setItem(_todoStorageKey(), activeListId);
}
function restoreTodoLastList() {
  if (!activeListId) {
    activeListId = localStorage.getItem(_todoStorageKey()) || null;
  }
}
let todoSaveTimer = null;
let todoRawMode = false; // false = rich editor (default), true = raw textarea

const todoView = document.getElementById("todo-view");
const todoDotsEl = document.getElementById("todo-dots");
const todoContentEl = document.getElementById("todo-content");
const todoBtn = document.getElementById("todo-btn");
const todoBackBtn = document.getElementById("todo-back");
const todoNewBtn = document.getElementById("todo-new");
const todoSettingsOverlayEl = document.getElementById("todo-settings-overlay");
const todoSettingsClose = document.getElementById("todo-settings-close");
const todoAddColor = document.getElementById("todo-add-color");
const todoColorRows = document.getElementById("todo-color-rows");

let _savedScrollY = 0;
let _returnToCard = null;

function showTodoView(fromCardName) {
  _savedScrollY = window.scrollY;
  _returnToCard = fromCardName || null;
  currentView = "todo";
  grid.style.display = "none";
  minimizedBar.style.display = "none";
  todoView.classList.remove("hidden");
  todoBtn.classList.add("active");
  document.querySelector(".header-right").classList.add("todo-mode");
  loadTodoData();
}

function showAgentsView() {
  currentView = "agents";
  // Clear pending save timers
  if (todoSaveTimer) { clearTimeout(todoSaveTimer); todoSaveTimer = null; }
  if (_richSaveTimer) { clearTimeout(_richSaveTimer); _richSaveTimer = null; }
  if (_todoSaveMaxWait) { clearTimeout(_todoSaveMaxWait); _todoSaveMaxWait = null; }
  if (_richSaveMaxWait) { clearTimeout(_richSaveMaxWait); _richSaveMaxWait = null; }
  // Flush any unsaved content before leaving
  saveTodoContent();
  todoView.classList.add("hidden");
  grid.style.display = "";
  minimizedBar.style.display = "";
  todoBtn.classList.remove("active");
  const headerRight = document.querySelector(".header-right");
  if (headerRight) headerRight.classList.remove("todo-mode");
  scheduleMasonry();
  // Restore scroll: if came from a card pill, scroll to that card; otherwise restore position
  requestAnimationFrame(() => {
    if (_returnToCard && agents.has(_returnToCard)) {
      const card = agents.get(_returnToCard).card;
      card.scrollIntoView({ behavior: "instant", block: "center" });
      _returnToCard = null;
    } else {
      window.scrollTo(0, _savedScrollY);
    }
  });
}

function toggleTodoView() {
  if (currentView === "todo") showAgentsView();
  else showTodoView();
}

todoBtn.addEventListener("click", toggleTodoView);
todoBackBtn.addEventListener("click", showAgentsView);


todoNewBtn.addEventListener("click", async () => {
  try {
    const res = await fetch("/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New List" }),
    });
    const list = await res.json();
    activeListId = list.id;
    saveTodoLastList();
  } catch (err) {
    console.error("Failed to create todo list:", err);
  }
});

async function loadTodoData() {
  try {
    const res = await fetch("/api/todos");
    todoData = await res.json();
    restoreTodoLastList();
    // Validate restored ID still exists
    if (activeListId && !todoData.lists.find((l) => l.id === activeListId)) {
      activeListId = null;
    }
    if (!activeListId && todoData.lists.length > 0) {
      activeListId = todoData.lists[0].id;
    }
    saveTodoLastList();
    renderTodoDots();
    renderActiveList();
  } catch (err) {
    console.error("Failed to load todos:", err);
  }
}

function handleTodoUpdate(data) {
  const rawEditor = document.querySelector(".todo-editor");
  const richEditor = document.getElementById("todo-rich-editor");
  const titleInput = document.querySelector(".todo-title-input");
  const active = document.activeElement;
  const editorFocused = (rawEditor && active === rawEditor) || (richEditor && (active === richEditor || richEditor.contains(active)));
  const titleFocused = titleInput && active === titleInput;

  todoData = data;

  // If active list was deleted, clear selection
  if (activeListId && !todoData.lists.find((l) => l.id === activeListId)) {
    activeListId = todoData.lists.length > 0 ? todoData.lists[0].id : null;
  }

  renderTodoDots();

  // Skip re-rendering content area if user is actively editing (avoids cursor jumps)
  if (editorFocused || titleFocused) return;
  renderActiveList();
}

function getColorHex(colorId) {
  const color = todoData.colors.find((c) => c.id === colorId);
  return color ? color.hex : "#8A9BA8";
}

function renderTodoDots() {
  todoDotsEl.innerHTML = "";
  const sorted = [...todoData.lists].sort((a, b) => a.order - b.order);
  for (const list of sorted) {
    const tab = document.createElement("div");
    tab.className = "todo-dot" + (list.id === activeListId ? " active" : "");
    tab.tabIndex = 0;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", list.id === activeListId ? "true" : "false");

    const circle = document.createElement("span");
    circle.className = "todo-dot-circle";
    circle.style.background = getColorHex(list.colorId);
    tab.appendChild(circle);

    const label = document.createElement("span");
    label.className = "todo-dot-label";
    label.textContent = list.title || "Untitled";
    tab.appendChild(label);

    tab.addEventListener("click", () => {
      activeListId = list.id;
      saveTodoLastList();
      renderTodoDots();
      renderActiveList();
    });
    tab.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        tab.click();
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const tabs = [...todoDotsEl.querySelectorAll(".todo-dot")];
        const i = tabs.indexOf(tab);
        const next = e.key === "ArrowRight"
          ? tabs[(i + 1) % tabs.length]
          : tabs[(i - 1 + tabs.length) % tabs.length];
        if (next) { next.focus(); next.click(); }
      }
    });
    todoDotsEl.appendChild(tab);
  }
  // Settings gear
  const gear = document.createElement("div");
  gear.className = "todo-dot-settings";
  gear.innerHTML = "\u2699";
  gear.title = "Color settings";
  gear.addEventListener("click", openTodoSettings);
  todoDotsEl.appendChild(gear);
}

function renderActiveList() {
  const list = todoData.lists.find((l) => l.id === activeListId);
  if (!list) {
    todoContentEl.innerHTML = '<div class="todo-empty-state"><p>No lists yet. Click <strong>+ New List</strong> to create one.</p></div>';
    return;
  }

  const hex = safeHex(getColorHex(list.colorId));
  const tintBg = hex + "0a";

  todoContentEl.innerHTML = `
    <div class="todo-list-active" style="background:${tintBg};--list-accent:${hex}">
      <div class="todo-title-bar">
        <div class="todo-color-trigger" style="background:${hex}" title="Change color"></div>
        <div class="todo-color-dropdown" id="todo-color-dropdown"></div>
        <input class="todo-title-input" value="${escapeHtml(list.title)}" placeholder="List title" style="color:${hex}">
        <button class="todo-delete-btn" title="Delete list">&times;</button>
      </div>
      <div class="todo-editor-area">
        ${todoRawMode
          ? `<textarea class="todo-editor" placeholder="- [ ] Your first task...">${escapeHtml(list.content)}</textarea>`
          : '<div class="todo-rich-editor" id="todo-rich-editor"></div>'
        }
      </div>
      <div class="todo-status-bar">
        <div class="todo-status-counts" id="todo-status-counts"></div>
        <div class="todo-status-right">
          <button class="todo-hotkey-btn" title="Keyboard shortcuts">?</button>
          <button class="todo-preview-toggle${todoRawMode ? " active" : ""}">${todoRawMode ? "Rich" : "Raw"}</button>
        </div>
      </div>
      <div class="todo-hotkey-panel hidden">
        <div class="todo-hotkey-grid">
          <kbd>\u2318B</kbd><span>Bold</span>
          <kbd>\u2318I</kbd><span>Italic</span>
          <kbd>\u2318Z</kbd><span>Undo</span>
          <kbd>\u21e7\u2318Z</kbd><span>Redo</span>
          <kbd>\u23188</kbd><span>Checkbox</span>
          <kbd>\u2318=</kbd><span>Heading \u2191</span>
          <kbd>\u2318\u2013</kbd><span>Heading \u2193</span>
          <kbd>\u2318[</kbd><span>Prev list</span>
          <kbd>\u2318]</kbd><span>Next list</span>
          <kbd>Esc</kbd><span>Back to agents</span>
        </div>
      </div>
    </div>
  `;

  // Wire up title input
  const titleInput = todoContentEl.querySelector(".todo-title-input");
  titleInput.addEventListener("input", () => scheduleTodoSave());

  // Wire up raw textarea (only in raw mode)
  const textarea = todoContentEl.querySelector(".todo-editor");
  if (textarea) {
    textarea.addEventListener("input", () => scheduleTodoSave());
    setupRawEditorKeys(textarea);
  }

  // Populate rich editor (only in rich mode)
  if (!todoRawMode) renderRichEditorContent(list);

  // Delete — double-click arm pattern
  const deleteBtn = todoContentEl.querySelector(".todo-delete-btn");
  let deleteArmed = false;
  let deleteTimer = null;
  deleteBtn.addEventListener("click", async () => {
    if (!deleteArmed) {
      deleteArmed = true;
      deleteBtn.classList.add("armed");
      deleteBtn.textContent = "delete";
      deleteTimer = setTimeout(() => {
        deleteArmed = false;
        deleteBtn.classList.remove("armed");
        deleteBtn.innerHTML = "\u00d7";
      }, 2000);
      return;
    }
    clearTimeout(deleteTimer);
    await fetch(`/api/todos/${list.id}`, { method: "DELETE" });
  });

  // Color trigger
  const trigger = todoContentEl.querySelector(".todo-color-trigger");
  const dropdown = todoContentEl.querySelector(".todo-color-dropdown");
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdown.classList.toggle("visible");
    if (dropdown.classList.contains("visible")) renderColorDropdown(list);
  });
  document.addEventListener("click", function closeDropdown(e) {
    if (!dropdown.contains(e.target) && e.target !== trigger) {
      dropdown.classList.remove("visible");
      document.removeEventListener("click", closeDropdown);
    }
  });

  // Hotkey panel toggle
  const hotkeyBtn = todoContentEl.querySelector(".todo-hotkey-btn");
  const hotkeyPanel = todoContentEl.querySelector(".todo-hotkey-panel");
  if (hotkeyBtn && hotkeyPanel) {
    hotkeyBtn.addEventListener("click", () => hotkeyPanel.classList.toggle("hidden"));
  }

  // Mode toggle (Rich ↔ Raw)
  todoContentEl.querySelector(".todo-preview-toggle").addEventListener("click", () => {
    if (todoRawMode) {
      const ta = todoContentEl.querySelector(".todo-editor");
      if (ta) { list.content = ta.value; saveTodoNow(list); }
    } else {
      const md = richEditorToMarkdown();
      if (md !== null) { list.content = md; saveTodoNow(list); }
    }
    todoRawMode = !todoRawMode;
    renderActiveList();
  });

  updateTodoStatusBar(list);
}

function saveTodoNow(list) {
  fetch(`/api/todos/${list.id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: list.content }),
  });
}

// ═══════════════════════════════════════════════════
// RICH EDITOR — contenteditable structured items
// ═══════════════════════════════════════════════════

function parseMarkdownToItems(markdown) {
  if (!markdown || !markdown.trim()) return [];
  const lines = markdown.split("\n");
  const items = [];
  for (const line of lines) {
    const cbU = line.match(/^(\s*)- \[ \] (.*)/);
    const cbC = line.match(/^(\s*)- \[x\] (.*)/i);
    const bullet = line.match(/^(\s*)[-*] (.*)/);
    const numbered = line.match(/^(\s*)(\d+)\. (.*)/);
    const heading = line.match(/^(#{1,6}) (.*)/);
    if (cbU) items.push({ type: "checkbox", checked: false, text: cbU[2] });
    else if (cbC) items.push({ type: "checkbox", checked: true, text: cbC[2] });
    else if (bullet) items.push({ type: "bullet", text: bullet[2] });
    else if (numbered) items.push({ type: "numbered", text: numbered[3] });
    else if (heading) items.push({ type: "heading", level: heading[1].length, text: heading[2] });
    else if (line.trim() === "") {
      if (items.length === 0 || items[items.length - 1].type !== "separator") items.push({ type: "separator" });
    } else items.push({ type: "text", text: line });
  }
  if (items.length > 0 && items[items.length - 1].type === "separator") items.pop();
  return items;
}

function inlineMarkdownToHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}

function htmlToInlineMarkdown(el) {
  let md = "";
  for (const node of el.childNodes) {
    if (node.nodeType === 3) { md += node.textContent; }
    else if (node.nodeType === 1) {
      const tag = node.tagName.toLowerCase();
      if (tag === "strong" || tag === "b") md += "**" + htmlToInlineMarkdown(node) + "**";
      else if (tag === "em" || tag === "i") md += "*" + htmlToInlineMarkdown(node) + "*";
      else if (tag === "code") md += "`" + node.textContent + "`";
      else if (tag !== "br") md += htmlToInlineMarkdown(node);
    }
  }
  return md;
}

function richEditorToMarkdown() {
  const editor = document.getElementById("todo-rich-editor");
  if (!editor) return null;
  const items = editor.querySelectorAll(".todo-rich-item");
  const lines = [];
  let numCount = 0;
  for (const item of items) {
    const type = item.dataset.type;
    if (type === "separator") { lines.push(""); numCount = 0; continue; }
    const textEl = item.querySelector(".todo-rich-text");
    const text = textEl ? htmlToInlineMarkdown(textEl) : "";
    if (type === "checkbox") { lines.push(`- [${item.dataset.checked === "true" ? "x" : " "}] ${text}`); numCount = 0; }
    else if (type === "bullet") { lines.push(`- ${text}`); numCount = 0; }
    else if (type === "numbered") { numCount++; lines.push(`${numCount}. ${text}`); }
    else if (type === "heading") { lines.push(`${"#".repeat(parseInt(item.dataset.level) || 1)} ${text}`); numCount = 0; }
    else { lines.push(text); numCount = 0; }
  }
  return lines.join("\n");
}

function createRichItem(itemData, isInitialEmpty) {
  const div = document.createElement("div");
  div.className = "todo-rich-item";
  div.dataset.type = itemData.type;
  if (itemData.type === "separator") { div.contentEditable = "false"; return div; }

  if (itemData.type === "checkbox") {
    div.dataset.checked = itemData.checked ? "true" : "false";
    const cb = document.createElement("span");
    cb.className = "todo-checkbox" + (itemData.checked ? " checked" : "");
    cb.contentEditable = "false";
    cb.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const was = div.dataset.checked === "true";
      div.dataset.checked = was ? "false" : "true";
      cb.classList.toggle("checked");
      const t = div.querySelector(".todo-rich-text");
      if (t) t.classList.toggle("checked-text", !was);
      scheduleRichSave();
    });
    div.appendChild(cb);
  } else if (itemData.type === "bullet") {
    const b = document.createElement("span");
    b.className = "todo-rich-bullet";
    b.contentEditable = "false";
    b.textContent = "\u2022";
    div.appendChild(b);
  } else if (itemData.type === "numbered") {
    const n = document.createElement("span");
    n.className = "todo-rich-bullet";
    n.contentEditable = "false";
    n.textContent = (itemData.num || 1) + ".";
    div.appendChild(n);
  }

  const textEl = document.createElement("span");
  textEl.className = "todo-rich-text";
  if (itemData.type === "checkbox" && itemData.checked) textEl.classList.add("checked-text");
  textEl.innerHTML = inlineMarkdownToHtml(itemData.text || "");

  if (itemData.type === "heading") {
    div.dataset.level = itemData.level || 1;
    const lvl = itemData.level || 1;
    textEl.style.fontSize = lvl === 1 ? "20px" : lvl === 2 ? "17px" : "15px";
    textEl.style.fontWeight = "700";
  }

  // Only show placeholder on the initial empty item when a list is brand new
  if (isInitialEmpty && !itemData.text) {
    textEl.dataset.placeholder = "New item...";
  }

  div.appendChild(textEl);
  return div;
}

function autoConvertMarkdownPrefix(itemEl, textEl) {
  // Only auto-convert plain text or bullet items — don't re-convert existing checkboxes/headings
  const type = itemEl.dataset.type;
  const raw = textEl.textContent;

  // Checkbox: "- [ ] " or "- [x] "
  const cbU = raw.match(/^- \[ \] (.*)/);
  const cbC = raw.match(/^- \[x\] (.*)/i);
  if (cbU || cbC) {
    const checked = !!cbC;
    const rest = checked ? cbC[1] : cbU[1];
    replaceItemAs(itemEl, textEl, "checkbox", rest, checked);
    return;
  }

  // Bullet: "- " or "* " at start (only if item is currently text)
  if (type === "text" || type === "bullet") {
    const bm = raw.match(/^[-*] (.+)/);
    if (bm && type === "text") {
      replaceItemAs(itemEl, textEl, "bullet", bm[1], false);
      return;
    }
  }

  // Heading: "# " through "###### "
  if (type === "text") {
    const hm = raw.match(/^(#{1,6}) (.+)/);
    if (hm) {
      replaceItemAs(itemEl, textEl, "heading", hm[2], false, hm[1].length);
      return;
    }
  }

  // Numbered: "1. " etc.
  if (type === "text") {
    const nm = raw.match(/^(\d+)\. (.+)/);
    if (nm) {
      replaceItemAs(itemEl, textEl, "numbered", nm[2], false);
      return;
    }
  }
}

function replaceItemAs(itemEl, textEl, newType, newText, checked, headingLevel) {
  pushRichUndo();
  // Remove old prefix element
  const oldPrefix = itemEl.querySelector(".todo-checkbox, .todo-rich-bullet");
  if (oldPrefix) oldPrefix.remove();

  itemEl.dataset.type = newType;
  delete itemEl.dataset.checked;
  textEl.classList.remove("checked-text");
  textEl.style.fontSize = "";
  textEl.style.fontWeight = "";
  delete itemEl.dataset.level;

  if (newType === "checkbox") {
    itemEl.dataset.checked = checked ? "true" : "false";
    const cb = document.createElement("span");
    cb.className = "todo-checkbox" + (checked ? " checked" : "");
    cb.contentEditable = "false";
    cb.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const was = itemEl.dataset.checked === "true";
      itemEl.dataset.checked = was ? "false" : "true";
      cb.classList.toggle("checked");
      if (textEl) textEl.classList.toggle("checked-text", !was);
      scheduleRichSave();
    });
    itemEl.insertBefore(cb, textEl);
    if (checked) textEl.classList.add("checked-text");
  } else if (newType === "bullet") {
    const b = document.createElement("span");
    b.className = "todo-rich-bullet";
    b.contentEditable = "false";
    b.textContent = "\u2022";
    itemEl.insertBefore(b, textEl);
  } else if (newType === "numbered") {
    const n = document.createElement("span");
    n.className = "todo-rich-bullet";
    n.contentEditable = "false";
    n.textContent = "1.";
    itemEl.insertBefore(n, textEl);
  } else if (newType === "heading") {
    itemEl.dataset.level = headingLevel || 1;
    const lvl = headingLevel || 1;
    textEl.style.fontSize = lvl === 1 ? "20px" : lvl === 2 ? "17px" : "15px";
    textEl.style.fontWeight = "700";
  }

  // Set the remaining text and place cursor at end
  textEl.innerHTML = inlineMarkdownToHtml(newText);
  delete textEl.dataset.placeholder;
  focusAtEnd(textEl);
}

function handleRichItemKey(e, itemEl, textEl) {
  const editor = document.getElementById("todo-rich-editor");
  if (!editor) return;

  // Cmd+B: bold
  if ((e.metaKey || e.ctrlKey) && e.key === "b") {
    e.preventDefault(); document.execCommand("bold"); scheduleRichSave(); return;
  }
  // Cmd+I: italic
  if ((e.metaKey || e.ctrlKey) && e.key === "i") {
    e.preventDefault(); document.execCommand("italic"); scheduleRichSave(); return;
  }

  // Enter: new item below
  if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    pushRichUndo();
    const sel = window.getSelection();
    const range = sel.getRangeAt(0);
    const afterRange = document.createRange();
    afterRange.setStart(range.endContainer, range.endOffset);
    if (textEl.lastChild) afterRange.setEndAfter(textEl.lastChild);
    else afterRange.setEnd(textEl, textEl.childNodes.length);
    const frag = afterRange.extractContents();
    const tmp = document.createElement("div");
    tmp.appendChild(frag);
    const afterText = htmlToInlineMarkdown(tmp);

    if (!textEl.textContent.trim() && !afterText.trim() && itemEl.dataset.type !== "text") {
      convertItemToText(itemEl); scheduleRichSave(); return;
    }

    const newItem = createRichItem({
      type: itemEl.dataset.type, checked: false,
      level: parseInt(itemEl.dataset.level) || 1, text: afterText,
    });
    itemEl.after(newItem);
    const newText = newItem.querySelector(".todo-rich-text");
    if (newText) focusAtStart(newText);
    scheduleRichSave();
    return;
  }

  // Backspace at start
  if (e.key === "Backspace") {
    const sel = window.getSelection();
    if (!sel.isCollapsed) return;
    if (!isCaretAtStart(textEl)) return;
    pushRichUndo();
    const items = [...editor.querySelectorAll(".todo-rich-item:not([data-type='separator'])")];
    const idx = items.indexOf(itemEl);

    if (!textEl.textContent.trim()) {
      if (items.length <= 1) return;
      e.preventDefault();
      if (itemEl.dataset.type !== "text") {
        convertItemToText(itemEl);
      } else {
        const focusIdx = Math.max(0, idx - 1);
        itemEl.remove();
        const rest = [...editor.querySelectorAll(".todo-rich-item:not([data-type='separator'])")];
        if (rest[focusIdx]) { const t = rest[focusIdx].querySelector(".todo-rich-text"); if (t) focusAtEnd(t); }
      }
      scheduleRichSave(); return;
    }
    if (idx > 0) {
      e.preventDefault();
      const prevText = items[idx - 1].querySelector(".todo-rich-text");
      if (!prevText) return;
      const prevLen = prevText.textContent.length;
      while (textEl.firstChild) prevText.appendChild(textEl.firstChild);
      itemEl.remove();
      setCursorAtOffset(prevText, prevLen);
      scheduleRichSave();
    }
  }
}

function convertItemToText(itemEl) {
  itemEl.dataset.type = "text";
  delete itemEl.dataset.checked;
  const prefix = itemEl.querySelector(".todo-checkbox, .todo-rich-bullet");
  if (prefix) prefix.remove();
  const textEl = itemEl.querySelector(".todo-rich-text");
  if (textEl) { textEl.classList.remove("checked-text"); delete textEl.dataset.placeholder; }
}

function richToggleHeading(increase) {
  pushRichUndo();
  const editor = document.getElementById("todo-rich-editor");
  if (!editor) return;
  const sel = window.getSelection();
  let itemEl = null;
  if (sel.anchorNode) {
    const node = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    if (node && editor.contains(node)) itemEl = node.closest(".todo-rich-item");
  }
  // Fallback: use the first item if cursor isn't in one
  if (!itemEl) itemEl = editor.querySelector(".todo-rich-item:not([data-type='separator'])");
  if (!itemEl) return;
  const textEl = itemEl.querySelector(".todo-rich-text");
  if (!textEl) return;

  const currentLevel = parseInt(itemEl.dataset.level) || 0;
  const isHeading = itemEl.dataset.type === "heading";

  if (increase) {
    if (!isHeading) {
      // Convert to heading level 1
      const oldPrefix = itemEl.querySelector(".todo-checkbox, .todo-rich-bullet");
      if (oldPrefix) oldPrefix.remove();
      itemEl.dataset.type = "heading";
      itemEl.dataset.level = "1";
      delete itemEl.dataset.checked;
      textEl.classList.remove("checked-text");
      textEl.style.fontSize = "20px";
      textEl.style.fontWeight = "700";
    } else if (currentLevel < 6) {
      const newLvl = currentLevel + 1;
      itemEl.dataset.level = newLvl;
      textEl.style.fontSize = newLvl === 1 ? "20px" : newLvl === 2 ? "17px" : "15px";
    }
  } else {
    // Decrease
    if (isHeading && currentLevel > 1) {
      const newLvl = currentLevel - 1;
      itemEl.dataset.level = newLvl;
      textEl.style.fontSize = newLvl === 1 ? "20px" : newLvl === 2 ? "17px" : "15px";
    } else if (isHeading && currentLevel <= 1) {
      // Remove heading — convert back to text
      itemEl.dataset.type = "text";
      delete itemEl.dataset.level;
      textEl.style.fontSize = "";
      textEl.style.fontWeight = "";
    }
  }
}

function toggleCurrentItemCheckbox() {
  pushRichUndo();
  const sel = window.getSelection();
  if (!sel.anchorNode) return;
  const node = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
  const itemEl = node?.closest(".todo-rich-item");
  if (!itemEl) return;
  const textEl = itemEl.querySelector(".todo-rich-text");

  if (itemEl.dataset.type === "checkbox") {
    convertItemToText(itemEl);
  } else {
    itemEl.dataset.type = "checkbox";
    itemEl.dataset.checked = "false";
    const cb = document.createElement("span");
    cb.className = "todo-checkbox";
    cb.contentEditable = "false";
    cb.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const was = itemEl.dataset.checked === "true";
      itemEl.dataset.checked = was ? "false" : "true";
      cb.classList.toggle("checked");
      if (textEl) textEl.classList.toggle("checked-text", !was);
      scheduleRichSave();
    });
    const bullet = itemEl.querySelector(".todo-rich-bullet");
    if (bullet) bullet.remove();
    itemEl.insertBefore(cb, textEl);
    if (textEl) textEl.classList.remove("checked-text");
  }
  scheduleRichSave();
  if (textEl) focusAtEnd(textEl);
}

function isCaretAtStart(el) {
  const sel = window.getSelection();
  if (!sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  const pre = document.createRange();
  pre.setStart(el, 0);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length === 0;
}

function focusAtStart(el) {
  const host = el.closest("[contenteditable='true']") || el;
  host.focus();
  const r = document.createRange(); r.setStart(el, 0); r.collapse(true);
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
}

function focusAtEnd(el) {
  const host = el.closest("[contenteditable='true']") || el;
  host.focus();
  const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
}

function setCursorAtOffset(el, charOffset) {
  const host = el.closest("[contenteditable='true']") || el;
  host.focus();
  let count = 0;
  const walk = (node) => {
    if (node.nodeType === 3) {
      const len = node.textContent.length;
      if (count + len >= charOffset) {
        const r = document.createRange(); r.setStart(node, charOffset - count); r.collapse(true);
        const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
        return true;
      }
      count += len;
    } else { for (const c of node.childNodes) { if (walk(c)) return true; } }
    return false;
  };
  if (!walk(el)) focusAtEnd(el);
}

// ═══════════════════════════════════════════════════
// UNDO / REDO — markdown-level snapshots
// ═══════════════════════════════════════════════════
const _richUndoStack = [];
const _richRedoStack = [];
let _richUndoBatchTimer = null;

function pushRichUndo() {
  const md = richEditorToMarkdown();
  if (md === null) return;
  if (_richUndoStack.length > 0 && _richUndoStack[_richUndoStack.length - 1] === md) return;
  _richUndoStack.push(md);
  if (_richUndoStack.length > 200) _richUndoStack.shift();
  _richRedoStack.length = 0;
}

function batchPushRichUndo() {
  if (_richUndoBatchTimer) clearTimeout(_richUndoBatchTimer);
  _richUndoBatchTimer = setTimeout(pushRichUndo, 800);
}

function richUndo() {
  const editor = document.getElementById("todo-rich-editor");
  if (!editor || _richUndoStack.length === 0) return;
  const currentMd = richEditorToMarkdown();
  let prevMd = _richUndoStack.pop();
  if (prevMd === currentMd && _richUndoStack.length > 0) {
    _richRedoStack.push(prevMd);
    prevMd = _richUndoStack.pop();
  }
  if (currentMd !== null && currentMd !== prevMd) _richRedoStack.push(currentMd);
  restoreRichEditor(prevMd);
}

function richRedo() {
  const editor = document.getElementById("todo-rich-editor");
  if (!editor || _richRedoStack.length === 0) return;
  const currentMd = richEditorToMarkdown();
  if (currentMd !== null) _richUndoStack.push(currentMd);
  const nextMd = _richRedoStack.pop();
  restoreRichEditor(nextMd);
}

function restoreRichEditor(md) {
  const editor = document.getElementById("todo-rich-editor");
  if (!editor) return;
  const items = parseMarkdownToItems(md);
  editor.innerHTML = "";
  if (items.length === 0) {
    editor.appendChild(createRichItem({ type: "checkbox", checked: false, text: "" }, true));
  } else {
    let numCount = 0;
    for (const item of items) {
      if (item.type === "numbered") { numCount++; item.num = numCount; }
      else if (item.type !== "separator") numCount = 0;
      editor.appendChild(createRichItem(item));
    }
  }
  const texts = editor.querySelectorAll(".todo-rich-text");
  if (texts.length) focusAtEnd(texts[texts.length - 1]);
  const list = todoData.lists.find((l) => l.id === activeListId);
  if (list) {
    list.content = md;
    fetch(`/api/todos/${activeListId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: md }),
    });
    updateTodoStatusBar(list);
    renderTodoDots();
  }
}

let _richSaveTimer = null;
let _richSaveMaxWait = null;
function _doRichSave() {
  const md = richEditorToMarkdown();
  if (md === null) return;
  const list = todoData.lists.find((l) => l.id === activeListId);
  if (!list) return;
  list.content = md;
  const titleInput = todoContentEl.querySelector(".todo-title-input");
  const updates = { content: md };
  if (titleInput) { updates.title = titleInput.value; list.title = updates.title; }
  fetch(`/api/todos/${activeListId}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  updateTodoStatusBar(list);
  renderTodoDots();
}
function scheduleRichSave() {
  if (_richSaveTimer) clearTimeout(_richSaveTimer);
  _richSaveTimer = setTimeout(_doRichSave, 300);
  // Max-wait: force a save every 800ms during continuous typing for cross-device sync
  if (!_richSaveMaxWait) {
    _richSaveMaxWait = setTimeout(() => {
      _richSaveMaxWait = null;
      if (_richSaveTimer) { clearTimeout(_richSaveTimer); _richSaveTimer = null; }
      _doRichSave();
    }, 800);
  }
}

function renderRichEditorContent(list) {
  const editor = document.getElementById("todo-rich-editor");
  if (!editor) return;
  editor.contentEditable = "true";
  // Initialize undo stack with current content
  _richUndoStack.length = 0;
  _richRedoStack.length = 0;
  _richUndoStack.push(list.content || "");
  const items = parseMarkdownToItems(list.content);
  editor.innerHTML = "";
  if (items.length === 0) {
    editor.appendChild(createRichItem({ type: "checkbox", checked: false, text: "" }, true));
  } else {
    let numCount = 0;
    for (const item of items) {
      if (item.type === "numbered") { numCount++; item.num = numCount; }
      else if (item.type !== "separator") numCount = 0;
      editor.appendChild(createRichItem(item));
    }
  }

  // Only attach handlers once — undo/redo repopulates items but keeps the same editor element
  if (!editor._handlersAttached) {
    editor._handlersAttached = true;

    // Editor-level keydown — detect active item and delegate
    editor.addEventListener("keydown", (e) => {
      const { itemEl, textEl } = getActiveRichItem(editor);
      if (textEl && itemEl) {
        handleRichItemKey(e, itemEl, textEl);
      } else if (e.key === "Enter") {
        e.preventDefault();
        pushRichUndo();
        const newItem = createRichItem({ type: "text", text: "" });
        editor.appendChild(newItem);
        const t = newItem.querySelector(".todo-rich-text");
        if (t) focusAtStart(t);
        scheduleRichSave();
      }
    });

    // Editor-level input — detect active item, run auto-convert + save
    editor.addEventListener("input", () => {
      const { itemEl, textEl } = getActiveRichItem(editor);
      if (textEl) {
        if (textEl.textContent) delete textEl.dataset.placeholder;
        else if (editor.querySelectorAll(".todo-rich-item:not([data-type='separator'])").length <= 1) {
          textEl.dataset.placeholder = "New item...";
        }
        if (itemEl) autoConvertMarkdownPrefix(itemEl, textEl);
      }
      batchPushRichUndo();
      scheduleRichSave();
    });
  }

  // Only auto-focus if editor doesn't already have focus (first open, not WebSocket re-render)
  if (document.activeElement !== editor && !editor.contains(document.activeElement)) {
    const first = editor.querySelector(".todo-rich-text");
    if (first) setTimeout(() => focusAtEnd(first), 50);
  }
}

function getActiveRichItem(editor) {
  const sel = window.getSelection();
  if (!sel.anchorNode) return {};
  const node = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
  if (!node || !editor.contains(node)) return {};
  const textEl = node.closest ? node.closest(".todo-rich-text") : null;
  const itemEl = textEl ? textEl.closest(".todo-rich-item") : (node.closest ? node.closest(".todo-rich-item") : null);
  return { itemEl, textEl };
}

// ═══════════════════════════════════════════════════
// RAW TEXTAREA EDITOR (fallback mode)
// ═══════════════════════════════════════════════════

function setupRawEditorKeys(editor) {
  editor.addEventListener("keydown", (e) => {
    const { selectionStart: start, selectionEnd: end, value } = editor;
    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const line = value.slice(lineStart, start);
      const cbMatch = line.match(/^(\s*- \[[ x]\] )(.*)/i);
      const bMatch = line.match(/^(\s*- )(.*)/);
      const nMatch = line.match(/^(\s*)(\d+)\. (.*)/);
      const match = cbMatch || bMatch;
      if (match) {
        const content = cbMatch ? cbMatch[2] : bMatch[2];
        if (!content.trim()) { e.preventDefault(); editor.value = value.slice(0, lineStart) + value.slice(start); editor.selectionStart = editor.selectionEnd = lineStart; editor.dispatchEvent(new Event("input")); return; }
        e.preventDefault();
        const prefix = cbMatch ? cbMatch[1].replace(/\[x\]/i, "[ ]") : bMatch[1];
        const ins = "\n" + prefix;
        editor.value = value.slice(0, start) + ins + value.slice(end);
        editor.selectionStart = editor.selectionEnd = start + ins.length;
        editor.dispatchEvent(new Event("input"));
        return;
      }
      if (nMatch) {
        if (!nMatch[3].trim()) { e.preventDefault(); editor.value = value.slice(0, lineStart) + value.slice(start); editor.selectionStart = editor.selectionEnd = lineStart; editor.dispatchEvent(new Event("input")); return; }
        e.preventDefault();
        const ins = "\n" + nMatch[1] + (parseInt(nMatch[2]) + 1) + ". ";
        editor.value = value.slice(0, start) + ins + value.slice(end);
        editor.selectionStart = editor.selectionEnd = start + ins.length;
        editor.dispatchEvent(new Event("input"));
        return;
      }
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      if (e.shiftKey && value[lineStart] === " ") {
        const n = Math.min(2, value.slice(lineStart).search(/\S/));
        editor.value = value.slice(0, lineStart) + value.slice(lineStart + n);
        editor.selectionStart = editor.selectionEnd = start - n;
      } else if (!e.shiftKey) {
        editor.value = value.slice(0, lineStart) + "  " + value.slice(lineStart);
        editor.selectionStart = editor.selectionEnd = start + 2;
      }
      editor.dispatchEvent(new Event("input"));
    }
  });
}

function insertCheckbox(editor) {
  const { selectionStart: start, value } = editor;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = value.indexOf("\n", start);
  const line = value.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
  const endPos = lineEnd === -1 ? value.length : lineEnd;
  let newLine;
  if (line.match(/^\s*- \[[ x]\] /i)) newLine = line.replace(/^(\s*)- \[[ x]\] /i, "$1");
  else if (line.match(/^\s*- /)) newLine = line.replace(/^(\s*)- /, "$1- [ ] ");
  else newLine = line.match(/^(\s*)/)[1] + "- [ ] " + line.trimStart();
  editor.value = value.slice(0, lineStart) + newLine + value.slice(endPos);
  editor.selectionStart = editor.selectionEnd = lineStart + newLine.length;
  editor.dispatchEvent(new Event("input"));
}

function wrapSelection(editor, marker) {
  const { selectionStart: start, selectionEnd: end, value } = editor;
  const selected = value.slice(start, end);
  if (selected) {
    const before = value.slice(Math.max(0, start - marker.length), start);
    const after = value.slice(end, end + marker.length);
    if (before === marker && after === marker) {
      editor.value = value.slice(0, start - marker.length) + selected + value.slice(end + marker.length);
      editor.selectionStart = start - marker.length; editor.selectionEnd = end - marker.length;
    } else {
      editor.value = value.slice(0, start) + marker + selected + marker + value.slice(end);
      editor.selectionStart = start + marker.length; editor.selectionEnd = end + marker.length;
    }
  } else {
    editor.value = value.slice(0, start) + marker + marker + value.slice(end);
    editor.selectionStart = editor.selectionEnd = start + marker.length;
  }
  editor.dispatchEvent(new Event("input"));
}

function toggleHeading(editor) {
  const { selectionStart: start, value } = editor;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = value.indexOf("\n", start);
  const line = value.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
  const hm = line.match(/^(#{1,6})\s/);
  let newLine;
  if (hm && hm[1].length >= 6) newLine = line.replace(/^#{1,6}\s/, "");
  else if (hm) newLine = "#" + line;
  else newLine = "# " + line;
  const endPos = lineEnd === -1 ? value.length : lineEnd;
  editor.value = value.slice(0, lineStart) + newLine + value.slice(endPos);
  editor.selectionStart = editor.selectionEnd = lineStart + newLine.length;
  editor.dispatchEvent(new Event("input"));
}

function renderColorDropdown(list) {
  const dropdown = document.getElementById("todo-color-dropdown");
  dropdown.innerHTML = "";
  for (const color of todoData.colors) {
    const swatch = document.createElement("div");
    swatch.className = "todo-color-swatch" + (color.id === list.colorId ? " selected" : "");
    swatch.style.background = color.hex;
    swatch.title = color.name;
    swatch.addEventListener("click", async (e) => {
      e.stopPropagation();
      await fetch(`/api/todos/${list.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colorId: color.id }),
      });
      dropdown.classList.remove("visible");
    });
    dropdown.appendChild(swatch);
  }
}


let _todoSaveMaxWait = null;
function scheduleTodoSave() {
  if (todoSaveTimer) clearTimeout(todoSaveTimer);
  todoSaveTimer = setTimeout(saveTodoContent, 300);
  // Max-wait: force a save every 800ms during continuous typing for cross-device sync
  if (!_todoSaveMaxWait) {
    _todoSaveMaxWait = setTimeout(() => {
      _todoSaveMaxWait = null;
      if (todoSaveTimer) { clearTimeout(todoSaveTimer); todoSaveTimer = null; }
      saveTodoContent();
    }, 800);
  }
}

async function saveTodoContent() {
  const list = todoData.lists.find((l) => l.id === activeListId);
  if (!list) return;

  const titleInput = todoContentEl.querySelector(".todo-title-input");
  const rawEditor = todoContentEl.querySelector(".todo-editor");
  const richEditor = document.getElementById("todo-rich-editor");

  const updates = {};
  if (titleInput) updates.title = titleInput.value;

  // Read content from whichever editor is active
  if (!todoRawMode && richEditor) {
    const md = richEditorToMarkdown();
    if (md !== null) updates.content = md;
  } else if (rawEditor) {
    updates.content = rawEditor.value;
  }

  // Update local state immediately for snappy feel
  if (updates.title !== undefined) list.title = updates.title;
  if (updates.content !== undefined) list.content = updates.content;

  try {
    await fetch(`/api/todos/${activeListId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
  } catch (err) {
    console.error("Failed to save todo:", err);
  }

  updateTodoStatusBar(list);
  renderTodoDots(); // update dot title
}

function updateTodoStatusBar(list) {
  const countsEl = document.getElementById("todo-status-counts");
  if (!countsEl) return;

  const content = list.content || "";
  const lines = content.split("\n").length;
  const words = content.trim() ? content.trim().split(/\s+/).length : 0;
  const chars = content.length;

  const checked = (content.match(/- \[x\]/gi) || []).length;
  const total = (content.match(/- \[[ x]\]/gi) || []).length;

  let text = `${lines} lines \u00b7 ${words} words \u00b7 ${chars} chars`;
  if (total > 0) text += ` \u00b7 ${checked}/${total} done`;

  countsEl.textContent = text;
}

// --- Color Settings Modal ---

function openTodoSettings() {
  todoSettingsOverlayEl.classList.remove("hidden");
  renderTodoColorSettings();
}

function closeTodoSettings() {
  // Save colors on close
  const rows = todoColorRows.querySelectorAll(".todo-color-row");
  const colors = [];
  rows.forEach((row) => {
    const name = row.querySelector('input[type="text"]').value.trim();
    const hex = row.querySelector('input[type="color"]').value;
    const id = row.dataset.colorId;
    if (name && hex) colors.push({ id, name, hex });
  });
  fetch("/api/todo-colors", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ colors }),
  });
  todoSettingsOverlayEl.classList.add("hidden");
}

todoSettingsClose.addEventListener("click", closeTodoSettings);
todoSettingsOverlayEl.addEventListener("click", (e) => {
  if (e.target === todoSettingsOverlayEl) closeTodoSettings();
});

function renderTodoColorSettings() {
  todoColorRows.innerHTML = "";
  for (const color of todoData.colors) {
    const row = document.createElement("div");
    row.className = "todo-color-row";
    row.dataset.colorId = color.id;
    row.innerHTML = `
      <input type="color" value="${safeHex(color.hex)}">
      <input type="text" value="${escapeHtml(color.name)}" placeholder="Color name">
      <button class="todo-color-remove" title="Remove">&times;</button>
    `;
    row.querySelector(".todo-color-remove").addEventListener("click", () => row.remove());
    todoColorRows.appendChild(row);
  }
}

todoAddColor.addEventListener("click", () => {
  const id = "c" + Math.random().toString(36).slice(2, 8);
  const row = document.createElement("div");
  row.className = "todo-color-row";
  row.dataset.colorId = id;
  row.innerHTML = `
    <input type="color" value="#8A9BA8">
    <input type="text" value="" placeholder="Color name">
    <button class="todo-color-remove" title="Remove">&times;</button>
  `;
  row.querySelector(".todo-color-remove").addEventListener("click", () => row.remove());
  todoColorRows.appendChild(row);
});


