// --- tmux helpers: session management, pane capture, key input ---
const { execSync, exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const { shellQuote, isWithinDir } = require("./security");

let PREFIX = "ceo-";
let UPLOADS_DIR = "";

function init(config) {
  PREFIX = config.PREFIX;
  UPLOADS_DIR = config.UPLOADS_DIR;
}

function ensureTmuxServer() {
  try {
    execSync("tmux list-sessions 2>/dev/null", {
      encoding: "utf8", timeout: 2000, stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    try {
      execSync('tmux new-session -d -s _ceo_keepalive "tail -f /dev/null"', {
        encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"],
      });
      console.log("Started tmux server");
    } catch {}
  }
  try { execSync(`tmux set-environment -g BROWSER "${process.env.BROWSER}"`, { stdio: "pipe" }); } catch {}
  try {
    execSync("tmux set-option -g remain-on-exit on", {
      encoding: "utf8", timeout: 2000, stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {}
  try {
    execSync("tmux set-option -g history-limit 50000", {
      encoding: "utf8", timeout: 2000, stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {}
}

function tmuxExec(cmd) {
  try {
    return execSync(`tmux ${cmd}`, {
      encoding: "utf8", timeout: 3000, maxBuffer: 10 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (e) {
    return null;
  }
}

function tmuxExecAsync(cmd) {
  exec(`tmux ${cmd}`, { encoding: "utf8", timeout: 10000 }, () => {});
}

// --- Pane CWD ---
function getPaneCwd(session) {
  const raw = tmuxExec(`display-message -t ${session} -p "#{pane_current_path}"`);
  return raw ? raw.trim() : null;
}

function getPaneCwdAsync(session) {
  return new Promise((resolve) => {
    exec(`tmux display-message -t ${session} -p "#{pane_current_path}"`, {
      encoding: "utf8", timeout: 5000,
    }, (err, stdout) => resolve(err ? null : (stdout || "").trim() || null));
  });
}

// --- Worktree detection ---
const worktreePathCache = new Map();

function detectWorktreePath(session, output) {
  if (!output) return worktreePathCache.get(session) || null;
  const stripped = output.replace(/\x1b\[[0-9;]*m/g, "");

  // Only scan from the LAST Claude Code banner to avoid matching pasted context
  // from other agents' conversations. The last banner is this session's actual start.
  const lines = stripped.split("\n");
  let bannerIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/Claude Code/.test(lines[i]) && /v\d+\.\d+/.test(lines[i])) {
      bannerIdx = i;
      break;
    }
  }
  const scanText = bannerIdx >= 0 ? lines.slice(bannerIdx).join("\n") : stripped;

  // 1. .claude/worktrees/ paths (most explicit pattern)
  const claudeWtMatches = scanText.match(/\/[^\s"')]+\.claude\/worktrees\/[^\s"')]+/g);
  if (claudeWtMatches) {
    let wtPath = claudeWtMatches[claudeWtMatches.length - 1];
    try { fs.statSync(wtPath); worktreePathCache.set(session, wtPath); return wtPath; } catch {
      wtPath = wtPath.replace(/[.,;:!?)]+$/, "");
      try { fs.statSync(wtPath); worktreePathCache.set(session, wtPath); return wtPath; } catch {}
    }
  }

  // 2. "git worktree add <path>" commands in output
  const wtAdds = [...scanText.matchAll(/git\s+worktree\s+add\s+(\/[^\s"')\n]+)/g)];
  for (let i = wtAdds.length - 1; i >= 0; i--) {
    const p = wtAdds[i][1].replace(/[.,;:!?)]+$/, "");
    try { if (fs.statSync(p).isDirectory()) { worktreePathCache.set(session, p); return p; } } catch {}
  }

  // 3. Absolute paths in tool calls — walk up to find git worktree roots
  //    A git worktree has a .git FILE (not directory) at its root
  const toolPaths = [...scanText.matchAll(/(?:Update|Read|Write|Bash)\((?:cd\s+)?(\/[^\s"')\n]+)/g)];
  const checkedRoots = new Set();
  for (let i = toolPaths.length - 1; i >= 0; i--) {
    let dir = toolPaths[i][1].replace(/[.,;:!?)]+$/, "");
    for (let depth = 0; depth < 15 && dir.length > 1; depth++) {
      if (checkedRoots.has(dir)) break;
      checkedRoots.add(dir);
      try {
        const gitStat = fs.statSync(path.join(dir, ".git"));
        if (gitStat.isFile()) {
          // .git is a file → this is a git worktree
          worktreePathCache.set(session, dir);
          return dir;
        }
        break; // .git is a directory → main repo, skip
      } catch { dir = path.dirname(dir); }
    }
    if (checkedRoots.size > 30) break; // safety limit
  }

  return worktreePathCache.get(session) || null;
}

function clearWorktreeCache(session) {
  worktreePathCache.delete(session);
}

function getEffectiveCwd(session, output) {
  const wt = detectWorktreePath(session, output);
  if (wt) return wt;
  return getPaneCwd(session);
}

async function getEffectiveCwdAsync(session, output) {
  const wt = detectWorktreePath(session, output);
  if (wt) return wt;
  return getPaneCwdAsync(session);
}

// --- Session listing (cached) ---
let _tmuxSessionsCache = null;
let _tmuxSessionsCacheTime = 0;
const TMUX_SESSIONS_CACHE_TTL = 2000;

function listTmuxSessions() {
  const now = Date.now();
  if (_tmuxSessionsCache && now - _tmuxSessionsCacheTime < TMUX_SESSIONS_CACHE_TTL) {
    return _tmuxSessionsCache;
  }
  const raw = tmuxExec(`list-sessions -F "#{session_name}" 2>/dev/null`);
  if (!raw) { _tmuxSessionsCache = []; _tmuxSessionsCacheTime = now; return []; }
  _tmuxSessionsCache = raw.trim().split("\n").filter((s) => s.startsWith(PREFIX));
  _tmuxSessionsCacheTime = now;
  return _tmuxSessionsCache;
}

function invalidateTmuxSessionsCache() {
  _tmuxSessionsCache = null;
  _tmuxSessionsCacheTime = 0;
}

function listTmuxSessionsAsync() {
  return new Promise((resolve) => {
    const now = Date.now();
    if (_tmuxSessionsCache && now - _tmuxSessionsCacheTime < TMUX_SESSIONS_CACHE_TTL) {
      return resolve(_tmuxSessionsCache);
    }
    exec(`tmux list-sessions -F "#{session_name}" 2>/dev/null`, {
      encoding: "utf8", timeout: 5000,
    }, (err, stdout) => {
      if (err || !stdout) {
        _tmuxSessionsCache = [];
        _tmuxSessionsCacheTime = Date.now();
        return resolve([]);
      }
      _tmuxSessionsCache = stdout.trim().split("\n").filter((s) => s.startsWith(PREFIX));
      _tmuxSessionsCacheTime = Date.now();
      resolve(_tmuxSessionsCache);
    });
  });
}

// --- Pane capture ---
function capturePaneAsync(session) {
  return new Promise((resolve) => {
    exec(`tmux capture-pane -t ${session} -p -e -S - -E -`, {
      encoding: "utf8", timeout: 10000, maxBuffer: 10 * 1024 * 1024,
    }, (err, stdout) => {
      if (err || !stdout) return resolve("");
      resolve(processCapturedPane(stdout));
    });
  });
}

function capturePane(session) {
  const raw = tmuxExec(`capture-pane -t ${session} -p -e -S - -E -`);
  if (!raw) return "";
  return processCapturedPane(raw);
}

function processCapturedPane(raw) {
  const lines = raw.split("\n");
  let startIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].replace(/\x1b\[[0-9;]*m/g, "").trim();
    if (stripped.includes("Claude Code")) {
      startIdx = i;
      break;
    }
  }
  const trimmed = lines.slice(startIdx);
  while (trimmed.length > 0 && trimmed[trimmed.length - 1].trim() === "") {
    trimmed.pop();
  }
  const result = [];
  let blankCount = 0;
  for (const line of trimmed) {
    if (line.trim() === "") {
      blankCount++;
      if (blankCount <= 1) result.push(line);
    } else {
      blankCount = 0;
      result.push(line);
    }
  }
  return result.join("\n");
}

// --- Key input ---
function sendKeys(session, text) {
  if (text.includes("\n")) {
    const escaped = text.replace(/'/g, "'\\''");
    const setOk = tmuxExec(`set-buffer -b ceoinput -- '${escaped}'`);
    if (setOk === null) {
      console.error("sendKeys: failed to set paste buffer for multiline");
      return;
    }
    tmuxExecAsync(`paste-buffer -b ceoinput -t ${session}`);
    setTimeout(() => {
      tmuxExecAsync(`delete-buffer -b ceoinput`);
      tmuxExecAsync(`send-keys -t ${session} Enter`);
    }, 300);
    return;
  }
  const escaped = text.replace(/'/g, "'\\''");
  tmuxExec(`send-keys -t ${session} -l '${escaped}'`);
  tmuxExecAsync(`send-keys -t ${session} Enter`);
}

function sendKeysWithImages(session, text, imagePaths) {
  const parts = [];
  for (const p of imagePaths) {
    if (typeof p === "string" && path.isAbsolute(p) && isWithinDir(p, UPLOADS_DIR)) {
      parts.push(p);
    }
  }
  if (text) parts.push(text);
  const pasteContent = parts.join("\n");
  if (!pasteContent) return;

  const escaped = pasteContent.replace(/'/g, "'\\''");
  const setOk = tmuxExec(`set-buffer -b ceoinput -- '${escaped}'`);
  if (setOk === null) {
    console.error("sendKeysWithImages: failed to set paste buffer");
    sendKeys(session, parts.join(" "));
    return;
  }
  tmuxExec(`paste-buffer -b ceoinput -t ${session}`);
  tmuxExec(`delete-buffer -b ceoinput`);
  setTimeout(() => {
    tmuxExec(`send-keys -t ${session} Enter`);
  }, 300);
}

module.exports = {
  init,
  ensureTmuxServer,
  tmuxExec,
  tmuxExecAsync,
  getPaneCwd,
  getPaneCwdAsync,
  detectWorktreePath,
  clearWorktreeCache,
  getEffectiveCwd,
  getEffectiveCwdAsync,
  listTmuxSessions,
  invalidateTmuxSessionsCache,
  listTmuxSessionsAsync,
  capturePaneAsync,
  capturePane,
  processCapturedPane,
  sendKeys,
  sendKeysWithImages,
};
