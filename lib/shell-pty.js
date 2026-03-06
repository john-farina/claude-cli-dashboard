// --- Embedded shell terminal (node-pty) ---
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { createScrollback, getScrollback, appendScrollback, clearScrollback } = require("./scrollback");
const { getGitInfoAsync } = require("./git");

let pty = null;
let PORT = 9145;
let SHELL_WORKDIR = "";
let _userConfig = {};
let _shellLog = null;

function init(config) {
  pty = config.pty;
  PORT = config.PORT;
  SHELL_WORKDIR = config.SHELL_WORKDIR;
  _userConfig = config.userConfig;
  _shellLog = config.shellLog;
}

let shellPty = null;
const shellClients = new Set();
const _shellScrollback = createScrollback();

// Adaptive batching
let _shellBatchChunks = [];
let _shellBatchTimer = null;
let _shellLastSend = 0;
const SHELL_BATCH_MS = 4;

function sendShellData(data) {
  if (shellClients.size === 0) return;
  const buf = Buffer.from(data, "utf8");
  for (const client of shellClients) {
    if (client.readyState === 1 && client.bufferedAmount < 1048576) {
      client.send(buf);
    }
  }
}

function flushShellBatch() {
  _shellBatchTimer = null;
  if (!_shellBatchChunks.length) return;
  sendShellData(_shellBatchChunks.length === 1 ? _shellBatchChunks[0] : _shellBatchChunks.join(""));
  _shellBatchChunks.length = 0;
  _shellLastSend = Date.now();
}

// Shell info state
let _shellInfoInterval = null;
let _lastShellCwd = null;
let _lastShellBranch = null;
let _lastShellIsWorktree = false;
let _lastShellPrUrl = undefined;
let _prLookupBranch = null;

function broadcastShellInfoMsg() {
  const msg = JSON.stringify({
    type: "shell-info",
    cwd: _lastShellCwd,
    branch: _lastShellBranch,
    isWorktree: _lastShellIsWorktree,
    prUrl: _lastShellPrUrl !== undefined ? _lastShellPrUrl : undefined,
  });
  for (const client of shellClients) {
    if (client.readyState === 1) client.send(msg);
  }
}

function toPrUrl(ghUrl) {
  if (_userConfig.prLinkStyle === "github") return ghUrl;
  const m = ghUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!m) return ghUrl;
  return `https://app.graphite.com/github/pr/${m[1]}/${m[2]}/${m[3]}`;
}

function lookupPrUrl(cwd, branch) {
  if (!branch || branch === "main" || branch === "master") {
    _lastShellPrUrl = null;
    _prLookupBranch = branch;
    return;
  }
  if (branch === _prLookupBranch) return;
  _prLookupBranch = branch;
  exec(`gh pr view "${branch}" --json url -q .url 2>/dev/null`, {
    cwd, encoding: "utf8", timeout: 5000,
  }, (err, stdout) => {
    const url = (stdout || "").trim();
    const newPrUrl = url.startsWith("http") ? toPrUrl(url) : null;
    if (newPrUrl !== _lastShellPrUrl) {
      _lastShellPrUrl = newPrUrl;
      broadcastShellInfoMsg();
    }
  });
}

function getShellCwdAsync() {
  return new Promise((resolve) => {
    if (!shellPty) return resolve(null);
    exec(`lsof -a -p ${shellPty.pid} -d cwd -Fn 2>/dev/null | grep '^n/' | head -1 | cut -c2-`,
      { encoding: "utf8", timeout: 3000 },
      (err, stdout) => resolve(err ? null : (stdout || "").trim() || null)
    );
  });
}

async function broadcastShellInfo(force) {
  if (!shellPty || shellClients.size === 0) return;
  try {
    const cwd = await getShellCwdAsync();
    if (!cwd) return;
    const git = await getGitInfoAsync(cwd);
    const branch = git?.branch || null;
    const isWorktree = git?.isWorktree || false;
    if (!force && cwd === _lastShellCwd && branch === _lastShellBranch) return;
    const branchChanged = branch !== _lastShellBranch;
    _lastShellCwd = cwd;
    _lastShellBranch = branch;
    _lastShellIsWorktree = isWorktree;
    broadcastShellInfoMsg();
    if (branchChanged || force) {
      lookupPrUrl(cwd, branch);
    }
  } catch {}
}

function startShellInfoPolling() {
  if (_shellInfoInterval) return;
  _shellInfoInterval = setInterval(() => broadcastShellInfo(false), 5000);
}

function ensureShellPty() {
  if (shellPty) return;
  if (!pty) return;
  // Fix spawn-helper permissions
  try {
    const helper = path.join(path.dirname(require.resolve("node-pty")), "..", "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper");
    const st = fs.statSync(helper);
    if (!(st.mode & 0o111)) { fs.chmodSync(helper, st.mode | 0o755); console.log("[shell] Fixed spawn-helper permissions"); }
  } catch {}
  let cwd = SHELL_WORKDIR;
  try { if (!fs.statSync(cwd).isDirectory()) cwd = os.homedir(); } catch { cwd = os.homedir(); }
  const shells = [process.env.SHELL, "/bin/zsh", "/bin/bash", "/bin/sh"].filter(Boolean);
  for (const shell of shells) {
    try {
      if (!fs.existsSync(shell)) continue;
      shellPty = pty.spawn(shell, ["-l"], {
        name: "xterm-256color",
        cols: 120,
        rows: 24,
        cwd,
        env: { ...process.env, TERM: "xterm-256color", CEO_DASHBOARD: "1" },
      });
      console.log(`[shell] Spawned PTY (pid ${shellPty.pid}) using ${shell} in ${cwd}`);
      break;
    } catch (err) {
      console.error(`[shell] Failed to spawn PTY (${shell}): ${err.message}`);
      shellPty = null;
    }
  }
  if (!shellPty) {
    console.error("[shell] All shells failed. Try: npm rebuild node-pty");
    console.error("[shell] Embedded terminal will be unavailable. The dashboard still works.");
    return;
  }

  const injectOsc7Hook = () => {
    if (!shellPty) return;
    shellPty.write(
      `if ! typeset -f __ceo_osc7 > /dev/null 2>&1; then ` +
      `__ceo_osc7() { printf '\\e]7;file://%s%s\\a' "$(hostname)" "$(pwd)"; }; ` +
      `precmd_functions+=(__ceo_osc7); chpwd_functions+=(__ceo_osc7); ` +
      `fi; __ceo_osc7\r`
    );
    setTimeout(() => { if (shellPty) shellPty.write("\x0c"); }, 300);
  };
  setTimeout(injectOsc7Hook, 800);
  setTimeout(injectOsc7Hook, 2000);

  const injectOpenOverride = () => {
    if (!shellPty) return;
    shellPty.write(
      `if ! typeset -f __ceo_open_injected > /dev/null 2>&1; then ` +
      `__ceo_open_injected() { :; }; ` +
      `open() { ` +
        `if [[ $# -eq 1 && "$1" =~ ^https?:// ]]; then ` +
          `curl -s -X POST http://localhost:${PORT}/api/shell/open-url ` +
          `-H 'Content-Type: application/json' ` +
          `-d "{\\"url\\":\\"$1\\"}" > /dev/null 2>&1; ` +
        `else command open "$@"; fi; ` +
      `}; ` +
      `fi\r`
    );
  };
  setTimeout(injectOpenOverride, 900);
  setTimeout(injectOpenOverride, 2100);

  setTimeout(() => {
    if (shellPty && !_lastShellCwd) {
      broadcastShellInfo(true);
    }
  }, 1200);

  let _osc7Buffer = "";
  let _osc7GitTimer = null;

  shellPty.onData((data) => {
    // Log URLs
    const urlMatches = data.match(/https?:\/\/[^\s\x1b\x07\]"'<>]+/g);
    if (urlMatches && _shellLog) {
      for (const url of urlMatches) {
        _shellLog("url-in-output", { url, snippet: data.substring(0, 200).replace(/[\x1b\x07]/g, "") });
      }
    }
    // Adaptive send
    const now = Date.now();
    if (now - _shellLastSend >= SHELL_BATCH_MS) {
      if (_shellBatchChunks.length) {
        _shellBatchChunks.push(data);
        sendShellData(_shellBatchChunks.join(""));
        _shellBatchChunks.length = 0;
        clearTimeout(_shellBatchTimer);
        _shellBatchTimer = null;
      } else {
        sendShellData(data);
      }
      _shellLastSend = now;
    } else {
      _shellBatchChunks.push(data);
      if (!_shellBatchTimer) {
        _shellBatchTimer = setTimeout(flushShellBatch, SHELL_BATCH_MS);
      }
    }

    appendScrollback(_shellScrollback, data);

    // OSC 7 parsing
    if (data.indexOf("\x1b]7;") >= 0 || _osc7Buffer.length > 0) {
      let searchData = _osc7Buffer + data;
      _osc7Buffer = "";

      const partialIdx = searchData.lastIndexOf("\x1b]7;");
      if (partialIdx >= 0) {
        const tail = searchData.substring(partialIdx);
        if (tail.indexOf("\x07") < 0 && tail.indexOf("\x1b\\") < 0) {
          _osc7Buffer = tail;
          searchData = searchData.substring(0, partialIdx);
        }
      }

      const osc7Match = searchData.match(/\x1b\]7;file:\/\/[^/]*(\/[^\x07\x1b]*?)(?:\x07|\x1b\\)/);
      if (osc7Match) {
        const newCwd = decodeURIComponent(osc7Match[1]);
        if (newCwd !== _lastShellCwd) {
          _lastShellCwd = newCwd;
          broadcastShellInfoMsg();
        }
        clearTimeout(_osc7GitTimer);
        _osc7GitTimer = setTimeout(async () => {
          const git = await getGitInfoAsync(newCwd);
          const branch = git?.branch || null;
          const isWorktree = git?.isWorktree || false;
          if (branch !== _lastShellBranch || isWorktree !== (_lastShellIsWorktree || false)) {
            const branchChanged = branch !== _lastShellBranch;
            _lastShellBranch = branch;
            _lastShellIsWorktree = isWorktree;
            broadcastShellInfoMsg();
            if (branchChanged) lookupPrUrl(newCwd, branch);
          }
        }, 150);
      }
    }
  });

  shellPty.onExit(() => {
    console.log("[shell] PTY exited, will respawn on next use");
    shellPty = null;
    clearScrollback(_shellScrollback);
    sendShellData("\r\n[Shell exited. Reopening will start a new session.]\r\n");
  });
}

// Accessors for server.js
function getShellPty() { return shellPty; }
function getShellClients() { return shellClients; }
function getShellScrollback() { return _shellScrollback; }
function getLastShellCwd() { return _lastShellCwd; }
function getLastShellBranch() { return _lastShellBranch; }
function getLastShellIsWorktree() { return _lastShellIsWorktree; }
function getLastShellPrUrl() { return _lastShellPrUrl; }

module.exports = {
  init,
  ensureShellPty,
  startShellInfoPolling,
  broadcastShellInfo,
  broadcastShellInfoMsg,
  sendShellData,
  toPrUrl,
  lookupPrUrl,
  getShellCwdAsync,
  getShellPty,
  getShellClients,
  getShellScrollback,
  getLastShellCwd,
  getLastShellBranch,
  getLastShellIsWorktree,
  getLastShellPrUrl,
};
