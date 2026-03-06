// --- Embedded Shell Terminal (xterm.js) ---
{
  const shellPanel = document.getElementById("shell-panel");
  const shellHeader = document.getElementById("shell-header");
  const shellContainer = document.getElementById("shell-terminal");
  const shellResize = shellPanel.querySelector(".shell-panel-resize");
  // Set initial shell height CSS var for todo view sizing
  document.documentElement.style.setProperty("--shell-panel-h", (shellPanel.offsetHeight || 42) + 8 + "px");

  // Create xterm.js terminal — respect saved shell color (uses shared infra with theme override)
  const _shellBg = localStorage.getItem("shellColor") || "#0d1117";
  const _shellTheme = buildXtermTheme(_shellBg);
  const { term, fitAddon } = createXtermInstance(2000, _shellTheme);

  // --- URL Opener wrapper detection + install ---
  const urlOpenerWrap = document.getElementById("url-opener-wrap");
  const urlOpenerBtn = document.getElementById("url-opener-btn");
  const urlOpenerTooltip = document.getElementById("url-opener-tooltip");
  const urlOpenerDeleteBtn = document.getElementById("url-opener-delete-btn");
  urlOpenerWrap.addEventListener("click", (e) => e.stopPropagation());
  async function checkUrlOpener() {
    try {
      const res = await fetch("/api/url-opener");
      const data = await res.json();
      if (data.installed) {
        urlOpenerBtn.textContent = "URL Opener Active";
        urlOpenerBtn.classList.add("installed");
        urlOpenerWrap.style.display = "";
        urlOpenerBtn.onclick = null;
        urlOpenerTooltip.querySelector(".url-opener-tooltip-title").textContent = "URL Opener — Active";
        urlOpenerDeleteBtn.style.display = "";
        urlOpenerDeleteBtn.onclick = async () => {
          urlOpenerDeleteBtn.textContent = "Removing...";
          urlOpenerDeleteBtn.disabled = true;
          try {
            await fetch("/api/url-opener", { method: "DELETE" });
            checkUrlOpener();
          } catch {
            urlOpenerDeleteBtn.textContent = "Failed";
            setTimeout(checkUrlOpener, 2000);
          }
          urlOpenerDeleteBtn.disabled = false;
        };
      } else {
        urlOpenerBtn.textContent = "Enable URL Opener";
        urlOpenerBtn.classList.remove("installed");
        urlOpenerWrap.style.display = "";
        urlOpenerTooltip.querySelector(".url-opener-tooltip-title").textContent = "URL Opener — Not Installed";
        urlOpenerDeleteBtn.style.display = "none";
        urlOpenerBtn.onclick = async () => {
          urlOpenerBtn.textContent = "Installing...";
          urlOpenerBtn.disabled = true;
          try {
            await fetch("/api/url-opener/install", { method: "POST" });
            checkUrlOpener();
          } catch {
            urlOpenerBtn.textContent = "Install Failed";
            setTimeout(checkUrlOpener, 2000);
          }
          urlOpenerBtn.disabled = false;
        };
      }
    } catch {}
  }
  checkUrlOpener();

  let shellInitialized = false;

  function initShellTerminal() {
    if (shellInitialized) return;
    shellInitialized = true;
    term.open(shellContainer);

    initXtermWebGL(term);

    // Send input from xterm to server PTY
    // Handles selection-based editing for paste (keyboard is handled by attachCustomKeyEventHandler)
    term.onData((data) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        // Intercept Enter: if the current line is a `claude` command, open new agent modal instead
        if (data === "\r" || data === "\n") {
          const buf = term.buffer.active;
          const line = buf.getLine(buf.baseY + buf.cursorY);
          if (line) {
            const lineText = line.translateToString(true);
            // Match "claude" or "claude <prompt>" (strip shell prompt prefix)
            const cmd = lineText.replace(/^.*?[%$#>]\s*/, "").trim();
            if (cmd === "claude" || cmd.startsWith("claude ")) {
              // Clear the typed command from the terminal (Ctrl+U clears line, then Enter to get fresh prompt)
              _sendShellStdin("\x15\r");
              // Extract prompt if any (e.g., "claude fix the bug" → "fix the bug")
              const prompt = cmd.startsWith("claude ") ? cmd.slice(7).trim() : "";
              // Open the new agent modal with the prompt pre-filled
              modalOverlay.classList.remove("hidden");
              fetchClaudeSessions();
              if (prompt) {
                setTimeout(() => {
                  const promptEl = document.getElementById("agent-prompt");
                  if (promptEl) { promptEl.value = prompt; promptEl.focus(); }
                }, 50);
              } else {
                document.getElementById("agent-name").focus();
              }
              return;
            }
          }
        }

        let sendData = data;
        // If pasting while text is selected, replace the selection with pasted content
        if (term.hasSelection() && data.length > 0 && data.charCodeAt(0) >= 32) {
          const prefix = _shellSelectionEditPrefix();
          if (prefix !== null) {
            sendData = prefix + data;
          }
          term.clearSelection();
        }
        _sendShellStdin(sendData);
      }
    });

    // Don't fit here — the caller does it after DOM layout
  }

  // Helper: generate move-to-selection-start + delete sequence for selection editing
  function _shellSelectionEditPrefix() {
    const sel = typeof term.getSelectionPosition === "function" ? term.getSelectionPosition() : null;
    const selectedText = term.getSelection();
    if (!sel || !selectedText) return null;
    if (sel.start.y !== sel.end.y) return null;
    const buf = term.buffer.active;
    const cursorAbsRow = buf.baseY + buf.cursorY;
    if (sel.start.y !== cursorAbsRow) return null;
    const delta = sel.start.x - buf.cursorX;
    let prefix = "";
    if (delta > 0) prefix += "\x1b[C".repeat(delta);
    else if (delta < 0) prefix += "\x1b[D".repeat(-delta);
    prefix += "\x1b[3~".repeat(selectedText.length);
    return prefix;
  }

  // --- Autocomplete Dropdown ---
  let _acDropdown = null;   // DOM element
  let _acDomItems = [];     // cached DOM item elements
  let _acItems = [];        // completion objects
  let _acIndex = 0;         // selected index
  let _acWord = "";         // original word being completed
  let _acFetching = false;  // prevent double-fetch

  function _getCursorScreenPos() {
    const screen = shellContainer.querySelector(".xterm-screen");
    if (!screen) return null;
    const rect = screen.getBoundingClientRect();
    const cellW = rect.width / term.cols;
    const cellH = rect.height / term.rows;
    const buf = term.buffer.active;
    return {
      x: rect.left + buf.cursorX * cellW,
      y: rect.top + (buf.cursorY + 1) * cellH,
      cellH,
    };
  }

  function _acRender() {
    if (!_acDomItems.length) return;
    for (let i = 0; i < _acDomItems.length; i++) {
      _acDomItems[i].classList.toggle("selected", i === _acIndex);
    }
    _acDomItems[_acIndex]?.scrollIntoView({ block: "nearest" });
  }

  function _acShow(completions, currentWord) {
    _acDismiss();
    _acItems = completions;
    _acWord = currentWord;
    _acIndex = 0;

    const dropdown = document.createElement("div");
    dropdown.className = "shell-autocomplete";

    completions.forEach((item, i) => {
      const row = document.createElement("div");
      const typeClass = item.type === "dir" ? "dir-item" : item.type === "link" ? "link-item" : "";
      row.className = "shell-autocomplete-item" + (typeClass ? " " + typeClass : "") + (i === 0 ? " selected" : "");
      row.dataset.index = i;

      const icon = document.createElement("span");
      icon.className = "shell-autocomplete-icon";
      icon.textContent = item.type === "dir" ? "\uD83D\uDCC1" : item.type === "link" ? "\uD83D\uDD17" : "\uD83D\uDCC4";

      const name = document.createElement("span");
      name.className = "shell-autocomplete-name";
      name.textContent = item.name + (item.type === "dir" ? "/" : "");

      row.appendChild(icon);
      row.appendChild(name);

      if (item.type === "dir") {
        const hint = document.createElement("span");
        hint.className = "shell-autocomplete-hint";
        hint.textContent = "dir";
        row.appendChild(hint);
      }

      row.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        _acIndex = i;
        _acAccept();
      });

      dropdown.appendChild(row);
    });

    // Position at cursor
    const pos = _getCursorScreenPos();
    if (pos) {
      dropdown.style.left = Math.min(pos.x, window.innerWidth - 440) + "px";
      const estH = Math.min(completions.length * 28 + 8, 268);
      if (pos.y + estH > window.innerHeight - 10) {
        dropdown.style.bottom = (window.innerHeight - pos.y + pos.cellH + 2) + "px";
      } else {
        dropdown.style.top = pos.y + "px";
      }
    }

    document.body.appendChild(dropdown);
    _acDropdown = dropdown;
    _acDomItems = Array.from(dropdown.querySelectorAll(".shell-autocomplete-item"));
    setTimeout(() => document.addEventListener("mousedown", _acClickOutside), 0);
  }

  function _acClickOutside(e) {
    if (_acDropdown && !_acDropdown.contains(e.target)) _acDismiss();
  }

  function _acDismiss() {
    if (_acDropdown) {
      _acDropdown.remove();
      _acDropdown = null;
      _acDomItems = [];
      _acItems = [];
      _acIndex = 0;
      document.removeEventListener("mousedown", _acClickOutside);
    }
  }

  function _acMove(delta) {
    if (!_acDropdown || _acItems.length === 0) return;
    _acIndex = (_acIndex + delta + _acItems.length) % _acItems.length;
    _acRender();
  }

  function _acAccept() {
    const item = _acItems[_acIndex];
    if (!item) return;
    // Figure out what prefix is already typed for this filename
    const wordBase = _acWord.includes("/") ? _acWord.split("/").pop() : _acWord;
    let remaining = item.name.slice(wordBase.length);
    if (item.type === "dir") remaining += "/";
    // Escape spaces and special chars for shell
    remaining = remaining.replace(/([ '\\()\[\]{}$#&!;|<>*?`])/g, "\\$1");
    _sendShellStdin(remaining);
    _acDismiss();
  }

  function _acTrigger() {
    if (_acFetching) return;
    const buf = term.buffer.active;
    const line = buf.getLine(buf.baseY + buf.cursorY);
    if (!line) return;
    const lineText = line.translateToString(false, 0, buf.cursorX);
    // Extract current word (everything after last unescaped space)
    const match = lineText.match(/(\S+)$/);
    const currentWord = match ? match[1] : "";
    // Get shell cwd
    const cwdEl = document.getElementById("shell-cwd");
    const cwd = cwdEl?.dataset.fullPath;
    if (!cwd) { _sendShellStdin("\t"); return; }
    // Detect directory-only commands
    const firstWord = lineText.replace(/^.*?%\s*/, "").trim().split(/\s+/)[0] || "";
    const dirsOnly = ["cd", "pushd"].includes(firstWord) && currentWord !== firstWord;
    _acFetching = true;
    fetch("/api/shell/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word: currentWord, cwd, dirsOnly }),
    })
    .then(r => r.json())
    .then(({ completions }) => {
      _acFetching = false;
      if (!completions || completions.length === 0) {
        // No matches — fall back to shell native Tab
        _sendShellStdin("\t");
      } else if (completions.length === 1) {
        // Single match — auto-insert
        _acWord = currentWord;
        _acItems = completions;
        _acIndex = 0;
        _acAccept();
      } else {
        // Insert common prefix if any, then show dropdown
        const wordBase = currentWord.includes("/") ? currentWord.split("/").pop() : currentWord;
        const common = _commonPrefix(completions);
        if (common.length > wordBase.length) {
          const insert = common.slice(wordBase.length).replace(/([ '\\()\[\]{}$#&!;|<>*?`])/g, "\\$1");
          _sendShellStdin(insert);
          const newWord = currentWord.slice(0, currentWord.length - wordBase.length) + common;
          _acShow(completions, newWord);
        } else {
          _acShow(completions, currentWord);
        }
      }
    })
    .catch(() => { _acFetching = false; _sendShellStdin("\t"); });
  }

  function _commonPrefix(items) {
    if (items.length === 0) return "";
    let pfx = items[0].name;
    for (let i = 1; i < items.length; i++) {
      const n = items[i].name;
      let j = 0;
      while (j < pfx.length && j < n.length && pfx[j] === n[j]) j++;
      pfx = pfx.slice(0, j);
      if (!pfx) return "";
    }
    return pfx;
  }

  // Custom key handler: autocomplete, Tab, selection editing, Escape
  // Cached selection state to avoid calling term.hasSelection() on every keypress
  let _shellHasSelection = false;
  term.onSelectionChange(() => { _shellHasSelection = term.hasSelection(); });

  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== "keydown") return true;

    // Fast path: no dropdown, no selection — only check Tab and Escape
    if (!_acDropdown && !_shellHasSelection) {
      if (e.key === "Tab" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        _acTrigger();
        return false;
      }
      if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey) return false;
      return true;
    }

    // --- Autocomplete dropdown is open: handle navigation ---
    if (_acDropdown) {
      if (e.key === "ArrowDown") { e.preventDefault(); _acMove(1); return false; }
      if (e.key === "ArrowUp") { e.preventDefault(); _acMove(-1); return false; }
      if (e.key === "Tab") { e.preventDefault(); _acAccept(); return false; }
      if (e.key === "Enter") { e.preventDefault(); _acAccept(); return false; }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); _acDismiss(); return false; }
      // Any other key: dismiss dropdown and let the key pass through
      _acDismiss();
      // Fall through to normal handling below
    }

    // Escape: bubble out to close the panel
    if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey) return false;

    // Tab: trigger autocomplete dropdown
    if (e.key === "Tab" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      _acTrigger();
      return false;
    }

    // Selection-based editing
    if (_shellHasSelection) {
      if (e.key === "Backspace" || e.key === "Delete") {
        const prefix = _shellSelectionEditPrefix();
        if (prefix !== null) {
          _sendShellStdin(prefix);
          term.clearSelection();
          return false;
        }
      }
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const prefix = _shellSelectionEditPrefix();
        if (prefix !== null) {
          _sendShellStdin(prefix + e.key);
          term.clearSelection();
          return false;
        }
      }
    }

    return true;
  });

  // Expose globally for WS handler
  window._shellXterm = term;

  // --- Click-to-position: move cursor to clicked cell on the active input line ---
  // Translates mouse clicks into arrow key sequences (like iTerm2 / Warp).
  // Handles wrapped commands spanning multiple terminal rows.
  {
    let _shellScreen = null;
    shellContainer.addEventListener("mouseup", (e) => {
      // Only left-click, no modifiers
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (!shellInitialized) return;
      // Defer to let xterm.js finish processing selection state
      setTimeout(() => {
        // Skip if text was selected (drag, not click)
        if (term.hasSelection()) return;
        const buf = term.buffer.active;
        // Only when scrolled to bottom (current prompt is visible)
        if (buf.viewportY < buf.baseY) return;
        // Calculate clicked cell position
        if (!_shellScreen) _shellScreen = shellContainer.querySelector(".xterm-screen");
        if (!_shellScreen) return;
        const rect = _shellScreen.getBoundingClientRect();
        const cellWidth = rect.width / term.cols;
        const cellHeight = rect.height / term.rows;
        const clickCol = Math.min(Math.max(0, Math.floor((e.clientX - rect.left) / cellWidth)), term.cols - 1);
        const clickRow = Math.min(Math.max(0, Math.floor((e.clientY - rect.top) / cellHeight)), term.rows - 1);
        const curRow = buf.cursorY;
        const curCol = buf.cursorX;
        // For multi-row clicks, verify all rows between are part of the same wrapped line
        if (clickRow !== curRow) {
          const minRow = Math.min(clickRow, curRow);
          const maxRow = Math.max(clickRow, curRow);
          for (let r = minRow + 1; r <= maxRow; r++) {
            const rowLine = buf.getLine(buf.viewportY + r);
            if (!rowLine || !rowLine.isWrapped) return; // Different lines — don't move
          }
        }
        // Clamp click column to actual content length on the clicked row
        const clickLine = buf.getLine(buf.viewportY + clickRow);
        if (!clickLine) return;
        const lineText = clickLine.translateToString(true);
        const targetCol = Math.min(clickCol, lineText.length);
        // Calculate total character delta (handles wrapped lines naturally)
        const delta = (clickRow - curRow) * term.cols + (targetCol - curCol);
        if (delta === 0) return;
        // Send arrow key sequences to move the shell cursor
        const arrowKey = delta > 0 ? "\x1b[C" : "\x1b[D";
        const keys = arrowKey.repeat(Math.abs(delta));
        _sendShellStdin(keys);
      }, 10);
    });
  }

  // Fit terminal when panel resizes — always sends resize to PTY
  function fitShell() {
    if (!shellInitialized || !shellPanel.classList.contains("open")) return;
    try {
      fitAddon.fit();
    } catch {}
    if (ws && ws.readyState === WebSocket.OPEN && term.cols && term.rows) {
      ws.send(JSON.stringify({ type: "shell-resize", cols: term.cols, rows: term.rows }));
    }
  }

  // Dynamic grid padding — keeps cards above the terminal panel
  function updateShellPadding() {
    const h = shellPanel.offsetHeight || 42;
    document.documentElement.style.setProperty("--shell-panel-h", h + 8 + "px");
    if (shellPanel.classList.contains("open")) {
      grid.style.paddingBottom = (h + 40) + "px";
    } else {
      grid.style.paddingBottom = "";
    }
  }

  // Click CWD pill → open folder in Finder
  document.getElementById("shell-cwd").addEventListener("click", (e) => {
    e.stopPropagation(); // Don't toggle the panel
    const fullPath = e.currentTarget.dataset.fullPath;
    if (fullPath) {
      fetch("/api/shell/open-finder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: fullPath }),
      });
    }
  });

  // Click branch pill → copy branch name to clipboard
  document.getElementById("shell-branch").addEventListener("click", (e) => {
    e.stopPropagation(); // Don't toggle the panel
    const branch = e.currentTarget.textContent.trim();
    if (!branch) return;
    navigator.clipboard.writeText(branch).then(() => {
      const el = e.currentTarget;
      const original = el.textContent;
      el.textContent = "Copied!";
      setTimeout(() => { el.textContent = original; }, 1200);
    });
  });

  // Toggle panel by clicking header bar (not a tab stop — use T/Escape hotkeys)
  shellHeader.addEventListener("click", (e) => {
    // Don't toggle if clicking a link or info pill
    if (e.target.closest("a") || e.target.closest(".shell-info-pill")) return;
    // Save height before toggling (while still open)
    if (shellPanel.classList.contains("open")) {
      shellPanel._savedHeight = shellPanel.offsetHeight;
    }
    const isOpen = shellPanel.classList.toggle("open");
    try { localStorage.setItem("ceo-shell-open", isOpen ? "1" : "0"); } catch {}
    if (isOpen) {
      initShellTerminal();
      // Restore user-resized height, or clear to let CSS default (280px)
      if (shellPanel._savedHeight && shellPanel._savedHeight > 80) {
        shellPanel.style.height = shellPanel._savedHeight + "px";
      } else {
        shellPanel.style.height = "";
      }
      // Hide xterm viewport scrollbar during expand to prevent glitch
      const viewport = shellContainer.querySelector(".xterm-viewport");
      if (viewport) viewport.style.overflow = "hidden";
      requestAnimationFrame(() => {
        fitShell();
        term.focus();
        updateShellPadding();
        if (viewport) setTimeout(() => { viewport.style.overflow = ""; }, 50);
      });
    } else {
      // Clear inline style so CSS auto-height collapses it
      shellPanel.style.height = "";
      updateShellPadding();
      _acDismiss();
    }
  });

  // Block ALL wheel scroll from leaking out of the shell panel to the dashboard
  shellPanel.addEventListener("wheel", (e) => {
    e.preventDefault();
  }, { passive: false });

  // Block touch scroll from leaking out of the shell panel to the dashboard
  shellPanel.addEventListener("touchmove", (e) => {
    e.stopPropagation();
  }, { passive: true });

  // Resize handle — debounce fitShell during drag (expensive DOM reflow)
  let _dragFitTimer = null;
  function fitShellDebounced() {
    clearTimeout(_dragFitTimer);
    _dragFitTimer = setTimeout(fitShell, 50);
  }

  shellResize.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = shellPanel.offsetHeight;
    document.body.style.userSelect = "none";
    const onMove = (ev) => {
      const newH = Math.max(120, startH + (startY - ev.clientY));
      shellPanel.style.height = newH + "px";
      fitShellDebounced();
      updateShellPadding();
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      fitShell(); // final precise fit
      updateShellPadding();
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  // Touch resize for shell panel (mobile)
  shellResize.addEventListener("touchstart", (e) => {
    e.preventDefault();
    const startY = e.touches[0].clientY;
    const startH = shellPanel.offsetHeight;

    const onTouchMove = (ev) => {
      const newH = Math.max(120, startH + (startY - ev.touches[0].clientY));
      shellPanel.style.height = newH + "px";
      fitShellDebounced();
      updateShellPadding();
    };

    const onTouchEnd = () => {
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      fitShell(); // final precise fit
      updateShellPadding();
    };

    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd);
  });

  // Re-fit on window resize
  // Debounce window resize — fitAddon.fit() triggers expensive DOM reflow
  let _fitResizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(_fitResizeTimer);
    _fitResizeTimer = setTimeout(fitShell, 100);
  });
}
