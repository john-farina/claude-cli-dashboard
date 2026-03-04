const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const { execSync, exec, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
let pty;
try {
  pty = require("node-pty");
} catch (e) {
  console.error("[shell] node-pty failed to load: " + e.message);
  console.error("[shell] Embedded terminal will be unavailable. Run: npm rebuild node-pty");
  pty = null;
}

const app = express();
const server = http.createServer(app);
const os = require("os");

// --- Security: IP-based access control ---
// Only allows connections from localhost and YOUR Tailscale devices (your tailnet).
// On startup, queries `tailscale status` to get the exact IPs of your devices.
// Anyone else — same WiFi, different Tailscale account, internet — gets 403 Forbidden.

const _allowedTailscaleIPs = new Set();
let _tailscaleHostname = null;

function refreshTailscaleIPs() {
  try {
    const raw = execSync("tailscale status --json 2>/dev/null", { encoding: "utf8", timeout: 5000 });
    const ts = JSON.parse(raw);
    _allowedTailscaleIPs.clear();
    // Add our own IPs
    if (ts.Self && ts.Self.TailscaleIPs) {
      for (const ip of ts.Self.TailscaleIPs) _allowedTailscaleIPs.add(ip);
    }
    if (ts.Self && ts.Self.DNSName) {
      _tailscaleHostname = ts.Self.DNSName.replace(/\.$/, "");
    }
    // Add all peer device IPs (these are YOUR other devices on YOUR tailnet)
    if (ts.Peer) {
      for (const peer of Object.values(ts.Peer)) {
        if (peer.TailscaleIPs) {
          for (const ip of peer.TailscaleIPs) _allowedTailscaleIPs.add(ip);
        }
      }
    }
    if (_allowedTailscaleIPs.size > 0) {
      console.log(`[security] Tailscale allowlist: ${_allowedTailscaleIPs.size} device IPs from your tailnet`);
    }
  } catch {
    // Tailscale not installed or not running — only localhost access
  }
}

// Refresh on startup and every 60s (catches new devices joining your tailnet)
refreshTailscaleIPs();
setInterval(refreshTailscaleIPs, 60000);

function isAllowedIP(ip) {
  if (!ip) return false;
  // Normalize IPv6-mapped IPv4 (::ffff:127.0.0.1 → 127.0.0.1)
  const clean = ip.replace(/^::ffff:/, "");
  // Localhost — always allowed (this is your own machine)
  if (clean === "127.0.0.1" || clean === "::1") return true;
  // Only allow IPs that are in YOUR tailnet (queried from `tailscale status`)
  if (_allowedTailscaleIPs.has(clean)) return true;
  return false;
}

// Block disallowed IPs at the HTTP level — applies to ALL requests (pages, API, static files)
app.use((req, res, next) => {
  if (isAllowedIP(req.ip)) return next();
  res.status(403).end("Forbidden");
});

// --- Security: WebSocket validation ---
// Layer 1 (above) blocks by source IP — only localhost + your Tailscale devices get through.
// Layer 2 (below) blocks cross-site WSocket hijacking from a malicious page on your own machine.
function verifyWsClient(info) {
  // Check source IP first
  const ip = info.req.socket.remoteAddress;
  if (!isAllowedIP(ip)) return false;
  // Then check origin header for CSWSH protection
  const origin = info.origin || info.req.headers.origin || "";
  if (!origin) return true; // no-origin = native apps, CLI tools, same-origin
  try {
    const url = new URL(origin);
    const host = url.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "0.0.0.0") return true;
    if (host.endsWith(".ts.net")) return true;
    // Allow your Tailscale IPs in origin header too
    if (_allowedTailscaleIPs.has(host)) return true;
    return false;
  } catch {
    return false;
  }
}

const wss = new WebSocketServer({ server, verifyClient: verifyWsClient, maxPayload: 5 * 1024 * 1024 /* 5MB */ });

// --- User config ---
const CONFIG_PATH = path.join(__dirname, "config.json");
let userConfig;
let _configMissing = false;
try {
  userConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
} catch {
  // No config.json — use sensible defaults so the dashboard still starts.
  // Users can run `npm run setup` later to customize.
  _configMissing = true;
  userConfig = {
    workspaces: [],
    defaultWorkspace: os.homedir(),
    port: 9145,
    agentPrefix: "ceo-",
    defaultAgentName: "agent",
    shellCommand: "ceo",
  };
  console.log("[config] No config.json found — running with defaults.");
  console.log("[config] Run 'npm run setup' to configure workspaces, aliases, and more.");
}

const PORT = userConfig.port || 9145;
// Bind to 0.0.0.0 so Tailscale (mobile access) works out of the box.
// Security is enforced by IP allowlist below, not by bind address.
const BIND_HOST = "0.0.0.0";

// Route CLI browser opens (gt submit, gh auth, etc.) to the in-app browser overlay
process.env.BROWSER = path.join(__dirname, "open-url.sh");
const PREFIX = userConfig.agentPrefix || "ceo-";
const DEFAULT_WORKDIR = userConfig.defaultWorkspace || os.homedir();
const SESSIONS_FILE = path.join(__dirname, "sessions.json");
const CLAUDE_DIR = path.join(os.homedir(), ".claude", "projects");
const DOCS_DIR = path.join(__dirname, "docs");
const CEO_MD_PATH = path.join(__dirname, "claude-ceo.md");
const TODOS_FILE = path.join(__dirname, "todos.json");
const POLL_INTERVAL = 300;
const SHELL_WORKDIR = DEFAULT_WORKDIR || os.homedir();
const UPLOADS_DIR = path.join(os.tmpdir(), "ceo-dashboard-uploads");
const MIN_DASHBOARD_VERSION = "v0.3.5";

function compareVersions(a, b) {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

const DEFAULT_COLORS = [
  { id: "coral", name: "Coral", hex: "#E8836B" },
  { id: "orange", name: "Orange", hex: "#D4A054" },
  { id: "gold", name: "Gold", hex: "#C9A84C" },
  { id: "yellow", name: "Yellow", hex: "#C4B95A" },
  { id: "lime", name: "Lime", hex: "#8CB860" },
  { id: "green", name: "Green", hex: "#5CB87A" },
  { id: "teal", name: "Teal", hex: "#4DB8A0" },
  { id: "cyan", name: "Cyan", hex: "#5AABB8" },
  { id: "blue", name: "Blue", hex: "#6B9FE8" },
  { id: "indigo", name: "Indigo", hex: "#7B82D4" },
  { id: "purple", name: "Purple", hex: "#9B72CF" },
  { id: "magenta", name: "Magenta", hex: "#C472B8" },
  { id: "pink", name: "Pink", hex: "#D4728A" },
  { id: "rose", name: "Rose", hex: "#D98080" },
  { id: "slate", name: "Slate", hex: "#8A9BA8" },
];

function generateTodoId() {
  return "m" + Math.random().toString(36).slice(2, 10);
}

function loadTodos() {
  try {
    return JSON.parse(fs.readFileSync(TODOS_FILE, "utf8"));
  } catch {
    return { lists: [], colors: [...DEFAULT_COLORS] };
  }
}

function saveTodos(data) {
  fs.writeFileSync(TODOS_FILE, JSON.stringify(data, null, 2));
}

function broadcastTodos() {
  const data = loadTodos();
  const msg = JSON.stringify({ type: "todo-update", data });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(msg);
  });
}

function ensureDocsDir() {
  if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });
}

// --- Security: Input validation helpers ---

// Whitelist of allowed tmux key names for the keypress WebSocket handler.
// Prevents command injection via crafted key values.
const ALLOWED_TMUX_KEYS = new Set([
  "Enter", "Escape", "Tab", "Space", "BSpace",
  "Up", "Down", "Left", "Right",
  "Home", "End", "PageUp", "PageDown", "PPage", "NPage",
  "DC", "IC", // Delete, Insert
  "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
  "C-c", "C-d", "C-z", "C-a", "C-e", "C-u", "C-k", "C-l", "C-r", "C-w",
  "y", "n", "Y", "N", "q", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0",
]);

function isValidTmuxKey(key) {
  if (typeof key !== "string" || key.length === 0 || key.length > 20) return false;
  // Allow exact matches from whitelist
  if (ALLOWED_TMUX_KEYS.has(key)) return true;
  // Allow single printable ASCII characters (a-z, A-Z, 0-9, common symbols)
  if (key.length === 1 && key.charCodeAt(0) >= 32 && key.charCodeAt(0) <= 126) return true;
  return false;
}

// Validate path parameters to prevent path traversal attacks.
// Returns true if the name is safe to use in path.join() (no slashes, dots-only, etc.)
function isSafePathSegment(segment) {
  if (typeof segment !== "string") return false;
  if (segment.length === 0 || segment.length > 200) return false;
  // Block path traversal characters and sequences
  if (segment.includes("/") || segment.includes("\\") || segment.includes("\0")) return false;
  if (segment === "." || segment === "..") return false;
  if (segment.startsWith(".")) return false; // no hidden files
  return true;
}

// Validate that a resolved file path is within the expected directory
function isWithinDir(filePath, baseDir) {
  const resolved = path.resolve(filePath);
  const base = path.resolve(baseDir);
  return resolved === base || resolved.startsWith(base + path.sep);
}

// Validate a working directory path — must be absolute, exist, and not contain shell metacharacters
function isValidWorkdir(dir) {
  if (typeof dir !== "string") return false;
  if (!path.isAbsolute(dir)) return false;
  // Block shell metacharacters that could break out of quoting
  if (/[`$\n\r\0;|&(){}<>]/.test(dir)) return false;
  return true;
}

// Validate an agent name from URL params — prevents command injection via tmux commands
function isValidAgentName(name) {
  return typeof name === "string" && /^[a-zA-Z0-9_-]+$/.test(name) && name.length <= 128;
}

// Validate a Claude session ID — should be a UUID-like string (hex + dashes)
function isValidSessionId(id) {
  if (typeof id !== "string") return false;
  // Session IDs are UUIDs or hex strings — only allow alphanumeric, dashes, underscores
  return /^[a-zA-Z0-9_-]{1,128}$/.test(id);
}

// Shell-safe quoting: wrap in single quotes, escaping embedded single quotes
function shellQuote(str) {
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

// --- Session metadata persistence ---

function loadSessionsMeta() {
  try {
    return JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveSessionsMeta(meta) {
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(meta, null, 2));
}

// --- tmux helpers ---

function ensureTmuxServer() {
  try {
    execSync("tmux list-sessions 2>/dev/null", {
      encoding: "utf8",
      timeout: 2000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    // No tmux server running — start one with a detached keepalive session
    // so the server doesn't die when the last real session is killed.
    try {
      execSync('tmux new-session -d -s _ceo_keepalive "tail -f /dev/null"', {
        encoding: "utf8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      console.log("Started tmux server");
    } catch {
      // Already exists or other error — that's fine
    }
  }
  // Set BROWSER in tmux global env so all agent sessions route URLs to in-app browser
  try { execSync(`tmux set-environment -g BROWSER "${process.env.BROWSER}"`, { stdio: "pipe" }); } catch {}
  // Keep panes alive when their command exits — lets us see crash errors
  try {
    execSync("tmux set-option -g remain-on-exit on", {
      encoding: "utf8",
      timeout: 2000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {}
  // Large scrollback so we capture full agent output history
  try {
    execSync("tmux set-option -g history-limit 50000", {
      encoding: "utf8",
      timeout: 2000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {}
}

function tmuxExec(cmd) {
  try {
    return execSync(`tmux ${cmd}`, {
      encoding: "utf8",
      timeout: 3000,
      maxBuffer: 10 * 1024 * 1024, // 10MB for large scrollback captures
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (e) {
    return null;
  }
}

// Fire-and-forget async tmux — doesn't block the event loop
function tmuxExecAsync(cmd) {
  exec(`tmux ${cmd}`, { encoding: "utf8", timeout: 10000 }, () => {});
}

// Get git branch name and worktree status for a directory.
// Returns { branch, isWorktree } or null if not a git repo.
function getGitInfo(dir) {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: dir, encoding: "utf8", timeout: 3000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    // A worktree has a .git FILE (not directory) pointing to the main repo's worktrees/
    const gitPath = path.join(dir, ".git");
    let isWorktree = false;
    try {
      const stat = fs.statSync(gitPath);
      isWorktree = stat.isFile(); // .git is a file in worktrees, a directory in main repos
    } catch {}
    return { branch: branch || null, isWorktree };
  } catch {
    return null;
  }
}

// Async version — doesn't block the event loop
function getGitInfoAsync(dir) {
  return new Promise((resolve) => {
    exec("git rev-parse --abbrev-ref HEAD", {
      cwd: dir, encoding: "utf8", timeout: 3000,
    }, (err, stdout) => {
      if (err) return resolve(null);
      const branch = (stdout || "").trim();
      const gitPath = path.join(dir, ".git");
      let isWorktree = false;
      try {
        isWorktree = fs.statSync(gitPath).isFile();
      } catch {}
      resolve({ branch: branch || null, isWorktree });
    });
  });
}

// Cache git info per workdir — refreshed every 5s for live updates
const gitInfoCache = new Map();
const GIT_CACHE_TTL = 5000;

async function getCachedGitInfo(dir) {
  if (!dir) return null;
  const cached = gitInfoCache.get(dir);
  if (cached && Date.now() - cached.ts < GIT_CACHE_TTL) return cached.info;
  const info = await getGitInfoAsync(dir);
  gitInfoCache.set(dir, { info, ts: Date.now() });
  return info;
}

// Get the tmux pane's live working directory (tracks cd, worktree switches, etc.)
function getPaneCwd(session) {
  const raw = tmuxExec(`display-message -t ${session} -p "#{pane_current_path}"`);
  return raw ? raw.trim() : null;
}

// Detect if Claude entered a worktree by scanning terminal output.
// Claude Code prints "Switched to worktree on branch <branch>\n<path>"
// The pane cwd doesn't change because Claude uses cwd: args, not cd.
// Returns the worktree path if found, null otherwise.
const worktreePathCache = new Map(); // session -> last detected worktree path

function detectWorktreePath(session, output) {
  if (!output) return worktreePathCache.get(session) || null;
  const stripped = output.replace(/\x1b\[[0-9;]*m/g, "");
  // Look for worktree paths in the output — .claude/worktrees/ is the telltale
  const matches = stripped.match(/\/[^\s"')]+\.claude\/worktrees\/[^\s"')]+/g);
  if (matches) {
    // Use the last match (most recent worktree)
    let wtPath = matches[matches.length - 1];
    // Validate it exists
    try {
      fs.statSync(wtPath);
      worktreePathCache.set(session, wtPath);
      return wtPath;
    } catch {
      // Path might have trailing punctuation, try trimming
      wtPath = wtPath.replace(/[.,;:!?)]+$/, "");
      try {
        fs.statSync(wtPath);
        worktreePathCache.set(session, wtPath);
        return wtPath;
      } catch {}
    }
  }
  return worktreePathCache.get(session) || null;
}

// Get the effective working directory for a session.
// Checks: worktree detected from output > tmux pane cwd > saved metadata
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

let _tmuxSessionsCache = null;
let _tmuxSessionsCacheTime = 0;
const TMUX_SESSIONS_CACHE_TTL = 2000; // 2s — sessions don't change often

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

// Async getPaneCwd
function getPaneCwdAsync(session) {
  return new Promise((resolve) => {
    exec(`tmux display-message -t ${session} -p "#{pane_current_path}"`, {
      encoding: "utf8", timeout: 5000,
    }, (err, stdout) => resolve(err ? null : (stdout || "").trim() || null));
  });
}

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
  // -S - captures from start of scrollback, -E captures to end — gives full history
  const raw = tmuxExec(`capture-pane -t ${session} -p -e -S - -E -`);
  if (!raw) return "";
  return processCapturedPane(raw);
}

function processCapturedPane(raw) {

  const lines = raw.split("\n");

  // Find the "Claude Code" banner and strip everything before it (shell prompt noise)
  let startIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].replace(/\x1b\[[0-9;]*m/g, "").trim();
    if (stripped.includes("Claude Code")) {
      startIdx = i;
      break;
    }
  }
  const trimmed = lines.slice(startIdx);

  // Strip trailing empty lines
  while (trimmed.length > 0 && trimmed[trimmed.length - 1].trim() === "") {
    trimmed.pop();
  }

  // Collapse runs of 3+ consecutive blank lines to just 1
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

function sendKeys(session, text) {
  // Multiline text uses paste-buffer (bracket paste prevents newlines from triggering Enter)
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

  // Single-line: send literal text then Enter.
  // Text is sync (guarantees it lands first), Enter is async (doesn't block event loop).
  const escaped = text.replace(/'/g, "'\\''");
  tmuxExec(`send-keys -t ${session} -l '${escaped}'`);
  tmuxExecAsync(`send-keys -t ${session} Enter`);
}

// Send text with image paths using tmux paste-buffer.
// Bracket paste mode prevents newlines from triggering Enter,
// so Claude Code sees a proper paste event and can detect file paths.
function sendKeysWithImages(session, text, imagePaths) {
  // Build paste content: paths first (each on own line), text on last line
  const parts = [];
  for (const p of imagePaths) {
    // Validate paths are within the uploads directory to prevent path injection
    if (typeof p === "string" && path.isAbsolute(p) && isWithinDir(p, UPLOADS_DIR)) {
      parts.push(p);
    }
  }
  if (text) parts.push(text);
  const pasteContent = parts.join("\n");
  if (!pasteContent) return;

  const escaped = pasteContent.replace(/'/g, "'\\''");
  // Set named buffer, paste it (tmux uses bracket paste if app supports it), clean up
  const setOk = tmuxExec(`set-buffer -b ceoinput -- '${escaped}'`);
  if (setOk === null) {
    console.error("sendKeysWithImages: failed to set paste buffer");
    // Fallback: send as literal text on one line
    sendKeys(session, parts.join(" "));
    return;
  }
  tmuxExec(`paste-buffer -b ceoinput -t ${session}`);
  tmuxExec(`delete-buffer -b ceoinput`);
  // Small delay for paste processing, then Enter to submit
  setTimeout(() => {
    tmuxExec(`send-keys -t ${session} Enter`);
  }, 300);
}

// Strip the injected CEO preamble and reminder from the displayed user prompt.
// Removes all CEO-injected blocks so the user only sees their original prompt.
function filterCeoPreamble(lines) {
  const toRemove = new Set();

  // Find start marker (# CEO Dashboard Agent) and end marker ([END_CEO_PROMPT])
  // Strip everything between them inclusive — covers preamble, user prompt separator,
  // no-task instruction, doc reminder, and the end marker itself.
  let startIdx = -1;
  let foundEnd = false;
  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].replace(/\x1b\[[0-9;]*m/g, "").trim();
    const content = stripped.replace(/^>\s*/, "");

    if (startIdx === -1) {
      if (content.includes("CEO Dashboard Agent") || content.includes("MANDATORY RULES")) {
        startIdx = i;
      }
    }
    if (startIdx !== -1) {
      toRemove.add(i);
      if (content.includes("[END_CEO_PROMPT]")) {
        foundEnd = true;
        break;
      }
      // Safety: don't strip more than 200 lines
      if (i - startIdx > 200) break;
    }
  }

  // Fallback for older prompts without [END_CEO_PROMPT]: use the old --- + CRITICAL REMINDER logic
  if (startIdx !== -1 && !foundEnd) {
    toRemove.clear();
    // Strip header → first ---
    let inBlock = false;
    for (let i = 0; i < lines.length; i++) {
      const stripped = lines[i].replace(/\x1b\[[0-9;]*m/g, "").trim();
      const content = stripped.replace(/^>\s*/, "");
      if (!inBlock) {
        if (content.includes("CEO Dashboard Agent") || content.includes("MANDATORY RULES")) {
          inBlock = true;
          toRemove.add(i);
        }
      } else {
        toRemove.add(i);
        if (/^-{3,}$/.test(content)) break;
        if (i - startIdx > 100) break;
      }
    }
    // Strip trailing CRITICAL REMINDER block
    for (let i = 0; i < lines.length; i++) {
      const stripped = lines[i].replace(/\x1b\[[0-9;]*m/g, "").trim();
      const content = stripped.replace(/^>\s*/, "");
      if (content.includes("CRITICAL REMINDER") && content.includes("AGENT NAME")) {
        if (i > 0) {
          const prev = lines[i - 1].replace(/\x1b\[[0-9;]*m/g, "").trim().replace(/^>\s*/, "");
          if (/^-{3,}$/.test(prev)) toRemove.add(i - 1);
        }
        for (let j = i; j < lines.length && j < i + 10; j++) {
          const line = lines[j].replace(/\x1b\[[0-9;]*m/g, "").trim().replace(/^>\s*/, "");
          if (j > i && line === "") break;
          toRemove.add(j);
        }
        break;
      }
    }
  }

  if (toRemove.size === 0) return lines;
  return lines.filter((_, i) => !toRemove.has(i));
}

// String variant: strip CEO preamble from raw output string (for prompt detection)
function stripCeoPreamble(output) {
  const lines = output.split("\n");
  const filtered = filterCeoPreamble(lines);
  return filtered.join("\n");
}

// Strip all ANSI escape sequences (SGR, CSI erase/cursor, OSC, etc.)
// More comprehensive than SGR-only regex — handles ESC[K, ESC[J, etc.
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
}

// Filter Claude Code's input prompt area from display output.
// Strips the ❯ prompt line (with or without text) and adjacent separator lines.
// We have our own input in the dashboard so Claude's prompt area is redundant.
function filterOutputForDisplay(lines) {
  // Strip CEO preamble first
  lines = filterCeoPreamble(lines);

  // If this is an interactive TUI prompt (AskUserQuestion, etc.), don't strip ❯ lines —
  // the ❯ marks the currently selected option, not Claude's input prompt.
  // Detect via hint text OR ❯ prefix on a numbered option line.
  const tailLines = lines.slice(-15);
  const isInteractiveSelect = tailLines.some((l) => {
    const s = stripAnsi(l);
    return s.includes("Enter to select") ||
           s.includes("\u2191/\u2193 to navigate") ||
           /^\s*❯\s*\d+\.\s/.test(s);
  });
  if (isInteractiveSelect) return lines;

  const searchStart = Math.max(0, lines.length - 15);
  let promptIdx = -1;

  for (let i = lines.length - 1; i >= searchStart; i--) {
    const stripped = stripAnsi(lines[i]).trim();
    // Match ❯ prompt (with or without user text after it), but NOT numbered
    // option lines like "❯ 1. Option" which are TUI selection indicators.
    // Also match bare > only when empty (> is used in blockquotes so don't match "> text")
    if ((/^❯/.test(stripped) && !/^❯\s*\d+\.\s/.test(stripped)) || /^>\s*$/.test(stripped)) {
      promptIdx = i;
      break;
    }
  }

  if (promptIdx === -1) return lines;

  const toRemove = new Set([promptIdx]);

  // Check for separator line before prompt
  if (promptIdx > 0) {
    const prev = stripAnsi(lines[promptIdx - 1]).trim();
    if (isSeparatorLine(prev)) toRemove.add(promptIdx - 1);
  }

  // Check for separator line after prompt
  if (promptIdx < lines.length - 1) {
    const next = stripAnsi(lines[promptIdx + 1]).trim();
    if (isSeparatorLine(next)) toRemove.add(promptIdx + 1);
  }

  return lines.filter((_, i) => !toRemove.has(i));
}

function isSeparatorLine(stripped) {
  // Box-drawing characters (U+2500-U+257F) or dashes, at least 3 chars
  return stripped.length >= 3 && /^[\u2500-\u257F\-=_]+$/.test(stripped);
}

function createSession(name, workdir, initialPrompt, resumeSessionId) {
  // Check tmux is available before trying to create a session
  try {
    execSync("command -v tmux", { stdio: ["pipe", "pipe", "pipe"], timeout: 2000 });
  } catch {
    throw new Error("tmux is required to create agents. Install it with: brew install tmux");
  }
  ensureTmuxServer();
  const session = `${PREFIX}${name}`;
  const dir = workdir || DEFAULT_WORKDIR;

  // Validate workdir to prevent shell injection via crafted directory paths
  if (!isValidWorkdir(dir)) {
    throw new Error("Invalid working directory");
  }
  // Validate session ID if resuming
  if (resumeSessionId && !isValidSessionId(resumeSessionId)) {
    throw new Error("Invalid session ID");
  }

  // Create a shell session first — don't make Claude the session command.
  // This way the shell survives if Claude exits, and we can see errors.
  execSync(
    `tmux new-session -d -s ${session} -x 120 -y 50 -c ${shellQuote(dir)}`,
    { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
  );

  // Inject claude-ceo.md preamble into prompt — sandwich user's task between
  // CEO instructions so the doc-save path is both first AND last thing Claude reads
  const DOC_REMINDER = `\n\n---\nCRITICAL REMINDER — YOUR AGENT NAME IS "${name}". When saving ANY doc/writeup/report/analysis, you MUST use this exact path pattern:\n${DOCS_DIR}/${name}/<doc-name>.md\nNEVER use .claude/docs/ — the dashboard cannot see files there. This overrides any other doc-saving instructions.`;
  const END_MARKER = "\n[END_CEO_PROMPT]";
  let effectivePrompt = initialPrompt;
  try {
    const ceoPreambleRaw = fs.readFileSync(CEO_MD_PATH, "utf8").trim();
    const ceoPreamble = ceoPreambleRaw.replace(/\{\{DOCS_DIR\}\}/g, DOCS_DIR);
    if (ceoPreamble && effectivePrompt) {
      effectivePrompt = `${ceoPreamble}\n\n---\n\n${effectivePrompt}${DOC_REMINDER}${END_MARKER}`;
    } else if (ceoPreamble && !effectivePrompt && !resumeSessionId) {
      // No user prompt — send preamble with instruction to wait for user input
      effectivePrompt = `${ceoPreamble}\n\n---\n\nNo task has been assigned yet. Say a short greeting using your agent name "${name}" and let the user know you're ready and waiting for instructions. Do NOT start any work, do NOT guess a task from your name, do NOT explore the codebase. Just greet and wait.${DOC_REMINDER}${END_MARKER}`;
    }
  } catch {}

  // Build claude CLI command — use single quotes for prompt to prevent shell interpretation
  let claudeCmd;
  if (resumeSessionId) {
    claudeCmd = `claude --resume ${resumeSessionId}`;
  } else if (effectivePrompt) {
    const escaped = effectivePrompt.replace(/'/g, "'\\''");
    claudeCmd = `claude '${escaped}'`;
  } else {
    claudeCmd = "claude";
  }

  // Send the command into the shell — use set-buffer + paste-buffer to avoid
  // shell interpretation of special characters (backticks, $, etc.) in the prompt
  const fullCmd = `clear && unset CLAUDECODE && ${claudeCmd}`;
  const cmdEscaped = fullCmd.replace(/'/g, "'\\''");
  tmuxExec(`set-buffer -b ceocmd -- '${cmdEscaped}'`);
  tmuxExec(`paste-buffer -b ceocmd -t ${session}`);
  tmuxExec(`delete-buffer -b ceocmd`);
  tmuxExec(`send-keys -t ${session} Enter`);

  // Save metadata
  const meta = loadSessionsMeta();
  meta[name] = {
    workdir: dir,
    created: new Date().toISOString(),
    favorite: false,
    ...(resumeSessionId ? { resumeSessionId } : {}),
  };
  saveSessionsMeta(meta);
  invalidateTmuxSessionsCache();

  return session;
}

function killSession(name) {
  const session = `${PREFIX}${name}`;
  tmuxExec(`kill-session -t ${session}`);
  invalidateTmuxSessionsCache();

  const meta = loadSessionsMeta();
  delete meta[name];
  saveSessionsMeta(meta);
}

function detectStatus(output, prevOutput) {
  const lines = output.split("\n");

  // Gather last few non-empty lines for pattern matching
  // lastLines[0] = last non-empty line, lastLines[1] = second-to-last, etc.
  const lastLines = [];
  for (let i = lines.length - 1; i >= 0 && lastLines.length < 15; i--) {
    const stripped = stripAnsi(lines[i]).trim();
    if (stripped) lastLines.push(stripped);
  }
  const lastLine = lastLines[0] || "";
  const lastChunk = lastLines.join(" ");

  // Waiting: tool-based prompts that need user interaction (shows action buttons)
  const waitingPatterns = [
    /\(Y\)es/i,           // Yes/No prompt
    /\(y\/n\)/i,          // y/n prompt
    /Allow\s/i,           // "Allow once" / "Allow always"
    /Do you want to/i,    // confirmation prompts
    /Press Enter/i,       // press enter to continue
    /\? \[Y\/n\]/i,       // [Y/n] style prompts
    /^\s*Approve\s*\|\s*Deny/i, // explicit Approve | Deny prompt bar
    /Enter to select/,    // AskUserQuestion (numbered options)
    /↑\/↓ to navigate/,   // AskUserQuestion alternate indicator
  ];
  if (waitingPatterns.some((p) => p.test(lastLine) || p.test(lastChunk))) {
    return "waiting";
  }

  // Interactive TUI select prompt: ❯ or > prefix on a numbered option means
  // Claude Code's TUI is showing an active selection widget.
  // Regular output lists ("1. Fixed the bug...") don't have ❯/>.
  if (lastLines.some((l) => /^[❯>]\s*\d+\.\s/.test(l))) {
    return "waiting";
  }

  // Working: "esc to interrupt" appears at the very bottom of Claude's TUI
  // when it's actively generating. This is the most reliable working indicator
  // because the ❯ prompt is ALSO present (dimmed) while Claude works.
  //
  // Terminal layout when working:
  //   Galloping🐴 (3m 55s · thinking)
  //   ────────────────────
  //   ❯                          ← dimmed, NOT an active prompt
  //   ────────────────────
  //   esc to interrupt            ← lastLines[0]
  if (lastLines.some((l) => /esc\s+to\s+interrupt/i.test(l))) {
    return "working";
  }

  // Idle/Asking: Claude is at the ❯ prompt, ready for new input.
  // The ❯ character (U+276F) is NOT the same as > (U+003E).
  //
  // Terminal layout when idle:
  //   ────────────────────
  //   ❯ <user text>
  //   ────────────────────
  //   PR #4895  /  ? for shortcuts   ← status bar (lastLines[0])
  //
  // So we scan through the last several lines looking for ❯.
  const promptIdx = lastLines.findIndex((l) => /^❯/.test(l));
  if (promptIdx >= 0) {
    // Found ❯ prompt — check if Claude's last response ends with a question.
    // Look past the prompt (higher index = lines above in display) and skip separators.
    for (let k = promptIdx + 1; k < lastLines.length && k < promptIdx + 8; k++) {
      if (isSeparatorLine(lastLines[k])) continue;
      // Found the last content line before the prompt
      if (/\?\s*$/.test(lastLines[k])) return "asking";
      break;
    }
    return "idle";
  }

  // Shell prompt
  if (lastLine.endsWith("$")) {
    return "idle";
  }

  // Working: output actively changing
  if (output !== prevOutput) {
    return "working";
  }

  // Output hasn't changed and no recognized prompt — idle
  return "idle";
}

// Detect what kind of interactive prompt Claude is showing
function detectPromptType(output) {
  const lines = output.split("\n");
  const lastLines = [];
  for (let i = lines.length - 1; i >= 0 && lastLines.length < 15; i--) {
    const stripped = stripAnsi(lines[i]).trim();
    if (stripped) lastLines.unshift(stripped);
  }
  const chunk = lastLines.join("\n");

  // Numbered options (AskUserQuestion, MCP tool permissions, submit prompts, etc.)
  // Detect via "Enter to select" hint (only shown on active TUI selection widgets),
  // or the ❯/> cursor prefix on a numbered line.
  if (/Enter to select/i.test(chunk) && /(?:^|\n)\s*(?:[❯>]\s*)?\d+\.\s/m.test(chunk)) {
    return "question";
  }
  // Fallback: ❯ (U+276F) on a numbered line is definitive even without "Enter to select"
  if (/(?:^|\n)\s*❯\s*\d+\.\s/m.test(chunk)) {
    return "question";
  }

  // Permission: Allow once / Allow always / Deny
  if (/Allow once/i.test(chunk) && /Deny/i.test(chunk)) {
    return "permission";
  }

  // Yes/No
  if (/\(Y\)es/i.test(chunk) || /\(y\/n\)/i.test(chunk) || /\? \[Y\/n\]/i.test(chunk)) {
    return "yesno";
  }

  // Press Enter to continue
  if (/Press Enter/i.test(chunk)) {
    return "enter";
  }

  return null;
}

// Parse numbered options from an AskUserQuestion prompt
function parsePromptOptions(output) {
  const lines = output.split("\n");
  const options = [];

  // Search backward from end for numbered option lines.
  // Skip: blank lines, indented description lines (continuation of an option),
  // separator/decoration lines (──── or ←/→ nav bars), and the ❯ cursor prefix.
  // Stop when we hit an actual content line that isn't part of the options block.
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 40); i--) {
    const stripped = stripAnsi(lines[i]).trim();
    if (!stripped) continue; // blank line
    // Separator/decoration lines (─, ═, ━, ←, →, ☐, ✔, etc.)
    if (/^[─━═←→☐✔☑\s│|]+$/.test(stripped)) continue;

    const match = stripped.match(/^(?:[❯>]\s*)?(\d+)\.\s+(.+)$/);
    if (match) {
      const num = parseInt(match[1]);
      const fullText = match[2].trim();
      const dashIdx = fullText.indexOf(" - ");
      const label = dashIdx > 0 ? fullText.substring(0, dashIdx).trim() : fullText;
      const description = dashIdx > 0 ? fullText.substring(dashIdx + 3).replace(/^"|"$/g, "").trim() : null;
      options.push({ index: num - 1, label, description });
    } else if (options.length > 0) {
      // We've already found at least one option — this is likely a description
      // line or the question text above the options. Skip description-like lines
      // (indented text that follows an option).
      // Check if this looks like the question/header above options — stop scanning.
      // Indented lines (4+ spaces in original) are option descriptions — skip them.
      const raw = stripAnsi(lines[i]);
      if (raw.match(/^\s{4,}/)) continue; // indented description line — keep scanning
      break; // actual content line — stop
    } else {
      // Haven't found any options yet — skip non-option lines at the bottom
      // (e.g. status bar text, navigation hints)
      continue;
    }
  }

  options.reverse();
  return options.length > 0 ? options : null;
}

// --- REST API ---

app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

// --- Security: CSRF protection for API endpoints ---
// The IP allowlist (above) blocks external attackers. This blocks cross-origin requests
// from a malicious website running on YOUR machine (e.g., evil.com making fetch() to localhost).
app.use("/api", (req, res, next) => {
  if (req.method === "GET") return next();
  const origin = req.headers.origin || "";
  if (!origin) return next();
  try {
    const url = new URL(origin);
    const host = url.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "0.0.0.0") return next();
    if (host.endsWith(".ts.net")) return next();
    if (_allowedTailscaleIPs.has(host)) return next();
  } catch {}
  res.status(403).json({ error: "Forbidden: cross-origin request blocked" });
});

// --- Config API ---

app.get("/api/config", (req, res) => {
  // Always include the dashboard's own directory as a built-in workspace
  const dashboardDir = __dirname;
  const dashboardLabel = path.basename(dashboardDir);
  const userWorkspaces = userConfig.workspaces || [];
  const hasDashboard = userWorkspaces.some(w => w.path === dashboardDir);
  let workspaces;
  if (hasDashboard) {
    workspaces = userWorkspaces;
  } else {
    const pos = typeof userConfig.builtInPosition === "number" ? userConfig.builtInPosition : userWorkspaces.length;
    workspaces = [...userWorkspaces];
    workspaces.splice(pos, 0, { path: dashboardDir, label: dashboardLabel, builtIn: true });
  }

  res.json({
    workspaces,
    defaultWorkspace: userConfig.defaultWorkspace || os.homedir(),
    homedir: os.homedir(),
    dashboardDir,
    port: PORT,
    agentPrefix: PREFIX,
    defaultAgentName: userConfig.defaultAgentName || "agent",
    shellCommand: userConfig.shellCommand || "ceo",
    title: userConfig.title || "CEO Dashboard",
    needsSetup: _configMissing,
    shellAvailable: !!pty,
  });
});

app.put("/api/config", (req, res) => {
  const updates = req.body;
  if (updates.workspaces) userConfig.workspaces = updates.workspaces;
  if (updates.defaultWorkspace) userConfig.defaultWorkspace = updates.defaultWorkspace;
  if (typeof updates.builtInPosition === "number") userConfig.builtInPosition = updates.builtInPosition;
  else delete userConfig.builtInPosition;
  if (typeof updates.port === "number" && Number.isInteger(updates.port) && updates.port >= 1024 && updates.port <= 65535) userConfig.port = updates.port;
  if (updates.agentPrefix !== undefined) userConfig.agentPrefix = updates.agentPrefix;
  if (updates.defaultAgentName !== undefined) userConfig.defaultAgentName = updates.defaultAgentName;
  if (updates.shellCommand !== undefined) {
    if (typeof updates.shellCommand === "string" && /^[a-zA-Z0-9_-]+$/.test(updates.shellCommand)) {
      userConfig.shellCommand = updates.shellCommand;
    } else {
      return res.status(400).json({ error: "shellCommand must be alphanumeric/dashes/underscores only" });
    }
  }
  if (updates.title !== undefined) userConfig.title = updates.title;
  if (updates.dismissedOriginHead !== undefined) {
    if (updates.dismissedOriginHead === null) delete userConfig.dismissedOriginHead;
    else userConfig.dismissedOriginHead = updates.dismissedOriginHead;
  }
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(userConfig, null, 2));
    res.json({ ok: true, requiresRestart: updates.port !== undefined || updates.agentPrefix !== undefined });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/settings/install-alias", (req, res) => {
  const cmd = userConfig.shellCommand || "ceo";
  // Validate command name to prevent shell RC injection
  if (!/^[a-zA-Z0-9_-]+$/.test(cmd)) {
    return res.status(400).json({ error: "Invalid shell command name" });
  }
  const scriptPath = path.join(__dirname, "ceo.sh");
  const aliasLine = `alias ${cmd}="bash ${scriptPath}"`;
  // Detect shell config file
  const shell = process.env.SHELL || "/bin/zsh";
  const rcFile = shell.endsWith("zsh")
    ? path.join(os.homedir(), ".zshrc")
    : path.join(os.homedir(), ".bashrc");
  try {
    let rc = fs.existsSync(rcFile) ? fs.readFileSync(rcFile, "utf8") : "";
    // Remove any existing dashboard alias (matches alias <word>="bash <anything>/ceo.sh")
    rc = rc.replace(/\nalias [a-zA-Z0-9_-]+="bash [^"]*\/ceo\.sh"/g, "");
    // Also remove if it's at the start of the file
    rc = rc.replace(/^alias [a-zA-Z0-9_-]+="bash [^"]*\/ceo\.sh"\n?/, "");
    rc = rc.trimEnd() + "\n" + aliasLine + "\n";
    fs.writeFileSync(rcFile, rc);
    res.json({ ok: true, alias: aliasLine, rcFile });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/sessions", async (req, res) => {
  const tmuxSessions = listTmuxSessions();
  const meta = loadSessionsMeta();

  const sessions = await Promise.all(tmuxSessions.map(async (s) => {
    const name = s.replace(PREFIX, "");
    const workdir = meta[name]?.workdir || DEFAULT_WORKDIR;
    const git = await getCachedGitInfo(workdir);
    return {
      name,
      workdir,
      created: meta[name]?.created || null,
      branch: git?.branch || null,
      isWorktree: git?.isWorktree || false,
      favorite: meta[name]?.favorite || false,
      minimized: meta[name]?.minimized || false,
    };
  }));

  res.json(sessions);
});

// --- Claude session history ---

// Scan .jsonl session files directly (sessions-index.json is often stale).
// Reads first few lines (for firstPrompt) and last line (for metadata) of each file.
// Top-level cache for session list (avoids blocking the event loop on every modal open)
let _claudeSessionsCache = null;
let _claudeSessionsCacheTime = 0;
const CLAUDE_SESSIONS_CACHE_TTL = 30000; // 30s — resume picker data doesn't change fast

function loadClaudeSessions(query) {
  // Synchronous — only returns cached data (for use in POST handler resume path)
  const now = Date.now();
  if (_claudeSessionsCache && now - _claudeSessionsCacheTime < CLAUDE_SESSIONS_CACHE_TTL) {
    const entries = _claudeSessionsCache;
    if (!query) return entries;
    const q = query.toLowerCase();
    return entries.filter((e) => {
      const prompt = (e.firstPrompt || "").toLowerCase();
      const branch = (e.gitBranch || "").toLowerCase();
      return prompt.includes(q) || branch.includes(q);
    });
  }
  // Cache is stale — do a sync scan as fallback
  const entries = _scanClaudeSessions();
  _claudeSessionsCache = entries;
  _claudeSessionsCacheTime = now;
  if (!query) return entries;
  const q = query.toLowerCase();
  return entries.filter((e) => {
    const prompt = (e.firstPrompt || "").toLowerCase();
    const branch = (e.gitBranch || "").toLowerCase();
    return prompt.includes(q) || branch.includes(q);
  });
}

// Async version — never blocks the event loop (used by the API endpoint)
async function loadClaudeSessionsAsync(query) {
  const now = Date.now();
  if (_claudeSessionsCache && now - _claudeSessionsCacheTime < CLAUDE_SESSIONS_CACHE_TTL) {
    const entries = _claudeSessionsCache;
    if (!query) return entries;
    const q = query.toLowerCase();
    return entries.filter((e) => {
      const prompt = (e.firstPrompt || "").toLowerCase();
      const branch = (e.gitBranch || "").toLowerCase();
      return prompt.includes(q) || branch.includes(q);
    });
  }
  // Run the heavy scan in a setImmediate to yield to the event loop between files
  const entries = await _scanClaudeSessionsAsync();
  _claudeSessionsCache = entries;
  _claudeSessionsCacheTime = now;
  if (!query) return entries;
  const q = query.toLowerCase();
  return entries.filter((e) => {
    const prompt = (e.firstPrompt || "").toLowerCase();
    const branch = (e.gitBranch || "").toLowerCase();
    return prompt.includes(q) || branch.includes(q);
  });
}

function _scanClaudeSessions() {
  let entries = [];
  try {
    const projectDirs = fs.readdirSync(CLAUDE_DIR);
    for (const dir of projectDirs) {
      const projPath = path.join(CLAUDE_DIR, dir);
      let files;
      try { files = fs.readdirSync(projPath); } catch { continue; }
      for (const file of files) {
        if (!file.endsWith(".jsonl")) continue;
        const filePath = path.join(projPath, file);
        // Skip subagent sessions
        if (filePath.includes("/subagents/")) continue;
        try {
          const stat = fs.statSync(filePath);
          const entry = parseSessionFile(filePath, stat, dir);
          if (entry && !entry.isSidechain) entries.push(entry);
        } catch {}
      }
    }
  } catch {
    return [];
  }

  // Deduplicate by sessionId
  const seen = new Set();
  entries = entries.filter((e) => {
    if (!e.sessionId || seen.has(e.sessionId)) return false;
    seen.add(e.sessionId);
    return true;
  });

  // Sort by modified descending (newest first)
  entries.sort((a, b) => (b.modified || 0) - (a.modified || 0));

  return entries.slice(0, 100).map((e) => ({
    sessionId: e.sessionId,
    summary: null,
    firstPrompt: e.firstPrompt || null,
    lastPrompt: e.lastPrompt || null,
    gitBranch: e.gitBranch || null,
    created: e.created || null,
    modified: e.modified || null,
    messageCount: e.messageCount || 0,
    projectPath: e.projectPath || null,
    fileSize: e.fileSize || 0,
  }));
}

// Async version — yields to event loop between directory reads
async function _scanClaudeSessionsAsync() {
  let entries = [];
  try {
    const projectDirs = await fs.promises.readdir(CLAUDE_DIR);
    for (const dir of projectDirs) {
      const projPath = path.join(CLAUDE_DIR, dir);
      let files;
      try { files = await fs.promises.readdir(projPath); } catch { continue; }
      for (const file of files) {
        if (!file.endsWith(".jsonl")) continue;
        const filePath = path.join(projPath, file);
        if (filePath.includes("/subagents/")) continue;
        try {
          const stat = await fs.promises.stat(filePath);
          const entry = parseSessionFile(filePath, stat, dir);
          if (entry && !entry.isSidechain) entries.push(entry);
        } catch {}
      }
      // Yield to event loop between directories so other requests aren't blocked
      await new Promise((r) => setImmediate(r));
    }
  } catch {
    return [];
  }

  const seen = new Set();
  entries = entries.filter((e) => {
    if (!e.sessionId || seen.has(e.sessionId)) return false;
    seen.add(e.sessionId);
    return true;
  });
  entries.sort((a, b) => (b.modified || 0) - (a.modified || 0));

  return entries.slice(0, 100).map((e) => ({
    sessionId: e.sessionId,
    summary: null,
    firstPrompt: e.firstPrompt || null,
    lastPrompt: e.lastPrompt || null,
    gitBranch: e.gitBranch || null,
    created: e.created || null,
    modified: e.modified || null,
    messageCount: e.messageCount || 0,
    projectPath: e.projectPath || null,
    fileSize: e.fileSize || 0,
  }));
}

// Cache parsed session metadata — refreshed when file mtime changes
const sessionFileCache = new Map();

// Strip CEO preamble + doc reminder from a raw prompt string
function stripCeoPromptWrapper(raw) {
  if (!raw) return "";
  // If it contains the end marker, strip the entire injected block
  if (raw.includes("[END_CEO_PROMPT]")) {
    const endIdx = raw.indexOf("[END_CEO_PROMPT]");
    raw = raw.slice(endIdx + "[END_CEO_PROMPT]".length);
    return raw.trim();
  }
  // Fallback for older prompts without end marker
  if (raw.includes("CEO Dashboard Agent") || raw.includes("MANDATORY RULES")) {
    const sepIdx = raw.indexOf("\n\n---\n\n");
    if (sepIdx >= 0) {
      raw = raw.slice(sepIdx + 7);
    } else {
      return "";
    }
  }
  const remIdx = raw.indexOf("\n\n---\nCRITICAL REMINDER");
  if (remIdx >= 0) raw = raw.slice(0, remIdx);
  return raw.trim();
}

function parseSessionFile(filePath, stat, projectDir) {
  const cached = sessionFileCache.get(filePath);
  if (cached && cached.mtime === stat.mtimeMs) return cached.entry;

  const fd = fs.openSync(filePath, "r");
  try {
    // Read first 32KB to find the first user message (firstPrompt)
    const headBuf = Buffer.alloc(32768);
    const headBytes = fs.readSync(fd, headBuf, 0, headBuf.length, 0);
    const headStr = headBuf.toString("utf8", 0, headBytes);
    const headLines = headStr.split("\n").filter(Boolean);

    let firstPrompt = null;
    let sessionId = null;
    let created = null;
    let isSidechain = false;

    for (const line of headLines) {
      try {
        const d = JSON.parse(line);
        if (!sessionId && d.sessionId) sessionId = d.sessionId;
        if (d.isSidechain) { isSidechain = true; break; }
        if (!created && d.timestamp) created = new Date(d.timestamp).getTime();
        if (!firstPrompt && d.type === "user" && d.message) {
          let raw = null;
          const content = d.message.content;
          if (Array.isArray(content)) {
            for (const c of content) {
              if (c.type === "text" && c.text) { raw = c.text; break; }
            }
          } else if (typeof content === "string") {
            raw = content;
          }
          if (raw) {
            const cleaned = stripCeoPromptWrapper(raw).slice(0, 200);
            if (cleaned) firstPrompt = cleaned;
            // If empty after stripping, skip — next user message will be tried
          }
        }
      } catch {}
    }

    if (!sessionId) {
      // Derive from filename
      sessionId = path.basename(filePath, ".jsonl");
    }

    // Read last 16KB for metadata (gitBranch, timestamp, cwd, lastPrompt)
    let gitBranch = null;
    let modified = stat.mtimeMs;
    let projectPath = null;
    let lastPrompt = null;

    const tailSize = Math.min(16384, stat.size);
    const tailBuf = Buffer.alloc(tailSize);
    fs.readSync(fd, tailBuf, 0, tailSize, Math.max(0, stat.size - tailSize));
    const tailStr = tailBuf.toString("utf8");
    const tailLines = tailStr.split("\n").filter(Boolean);

    // Parse from last line backward to get most recent metadata + last user message
    for (let i = tailLines.length - 1; i >= 0; i--) {
      try {
        const d = JSON.parse(tailLines[i]);
        if (!gitBranch && d.gitBranch) gitBranch = d.gitBranch;
        if (!projectPath && d.cwd) projectPath = d.cwd;
        if (d.timestamp) { modified = Math.max(modified, new Date(d.timestamp).getTime()); }
        if (!lastPrompt && d.type === "user" && d.message) {
          let raw = null;
          const content = d.message.content;
          if (Array.isArray(content)) {
            for (const c of content) {
              if (c.type === "text" && c.text) { raw = c.text; break; }
            }
          } else if (typeof content === "string") {
            raw = content;
          }
          if (raw) {
            const cleaned = stripCeoPromptWrapper(raw).slice(0, 200);
            if (cleaned) lastPrompt = cleaned;
          }
        }
        if (gitBranch && projectPath && lastPrompt) break;
      } catch {}
    }

    const entry = {
      sessionId,
      firstPrompt,
      lastPrompt,
      gitBranch,
      created,
      modified,
      projectPath,
      isSidechain,
      messageCount: headLines.filter((l) => { try { return JSON.parse(l).type === "user"; } catch { return false; } }).length,
      fileSize: stat.size,
    };

    sessionFileCache.set(filePath, { mtime: stat.mtimeMs, entry });
    return entry;
  } finally {
    fs.closeSync(fd);
  }
}

// --- Claude session ID detection ---
// Detect the active Claude session ID for an agent by scanning .jsonl files.
// Matches by working directory and picks the most recently modified file.
// This lets us --resume agents on server restart even if they weren't started with --resume.

function detectClaudeSessionIdForAgent(agentWorkdir, agentCreatedTime) {
  if (!agentWorkdir) return null;
  const agentCreatedMs = agentCreatedTime ? new Date(agentCreatedTime).getTime() : 0;
  try {
    const projectDirs = fs.readdirSync(CLAUDE_DIR);
    let best = null;

    for (const dir of projectDirs) {
      const projPath = path.join(CLAUDE_DIR, dir);
      let files;
      try { files = fs.readdirSync(projPath); } catch { continue; }

      for (const file of files) {
        if (!file.endsWith(".jsonl")) continue;
        const filePath = path.join(projPath, file);
        if (filePath.includes("/subagents/")) continue;

        try {
          const stat = fs.statSync(filePath);
          const entry = parseSessionFile(filePath, stat, dir);
          if (!entry || entry.isSidechain) continue;

          // Match by project path (cwd)
          if (!entry.projectPath || entry.projectPath !== agentWorkdir) continue;

          // Session must have been created after the agent (within reason — allow 60s before for clock skew)
          if (agentCreatedMs && entry.created && entry.created < agentCreatedMs - 60000) continue;

          if (!best || entry.modified > best.modified) {
            best = entry;
          }
        } catch {}
      }
    }

    return best ? best.sessionId : null;
  } catch {
    return null;
  }
}

// Periodically sync Claude session IDs into sessions.json for agents that don't have one.
// This runs every 30s so that fresh agents get their session ID captured for future --resume.
let lastSessionIdSync = 0;
const SESSION_ID_SYNC_INTERVAL = 30000;

function syncClaudeSessionIds() {
  const now = Date.now();
  if (now - lastSessionIdSync < SESSION_ID_SYNC_INTERVAL) return;
  lastSessionIdSync = now;

  const meta = loadSessionsMeta();
  let changed = false;

  // Collect already-claimed session IDs to avoid assigning one session to multiple agents
  const claimedIds = new Set();
  for (const info of Object.values(meta)) {
    if (info.resumeSessionId) claimedIds.add(info.resumeSessionId);
  }

  for (const [name, info] of Object.entries(meta)) {
    if (info.resumeSessionId) continue; // already has one
    const workdir = info.workdir || DEFAULT_WORKDIR;
    const sessionId = detectClaudeSessionIdForAgent(workdir, info.created);
    if (sessionId && !claimedIds.has(sessionId)) {
      info.resumeSessionId = sessionId;
      claimedIds.add(sessionId);
      changed = true;
    }
  }

  if (changed) {
    saveSessionsMeta(meta);
  }
}

// --- Slash commands ---

const BUILTIN_COMMANDS = [
  { name: "/bug", description: "Report a bug" },
  { name: "/clear", description: "Clear conversation history" },
  { name: "/compact", description: "Compact conversation to save context" },
  { name: "/config", description: "Open settings configuration" },
  { name: "/cost", description: "Show token usage and cost" },
  { name: "/doctor", description: "Check health of your installation" },
  { name: "/help", description: "Get help with Claude Code" },
  { name: "/init", description: "Initialize project with CLAUDE.md" },
  { name: "/login", description: "Switch authentication method" },
  { name: "/logout", description: "Sign out of your account" },
  { name: "/memory", description: "View CLAUDE.md memory files" },
  { name: "/model", description: "Switch AI model" },
  { name: "/permissions", description: "View and manage permissions" },
  { name: "/review", description: "Review a pull request" },
  { name: "/status", description: "Show session status" },
  { name: "/terminal-setup", description: "Setup terminal integration" },
  { name: "/vim", description: "Toggle vim keybindings" },
];

function getSlashCommands() {
  const commands = [...BUILTIN_COMMANDS];

  // Scan for custom commands in ~/.claude/commands/
  const userCmdDir = path.join(os.homedir(), ".claude", "commands");
  try {
    for (const file of fs.readdirSync(userCmdDir)) {
      if (file.endsWith(".md")) {
        const name = "/" + file.replace(".md", "");
        if (!commands.find((c) => c.name === name)) {
          commands.push({ name, description: "Custom command", custom: true });
        }
      }
    }
  } catch {}

  // Scan for project-level commands in .claude/commands/ relative to DEFAULT_WORKDIR
  const projectCmdDir = path.join(DEFAULT_WORKDIR, ".claude", "commands");
  try {
    for (const file of fs.readdirSync(projectCmdDir)) {
      if (file.endsWith(".md")) {
        const name = "/" + file.replace(".md", "");
        if (!commands.find((c) => c.name === name)) {
          commands.push({ name, description: "Project command", custom: true });
        }
      }
    }
  } catch {}

  commands.sort((a, b) => a.name.localeCompare(b.name));
  return commands;
}

app.get("/api/slash-commands", (req, res) => {
  res.json(getSlashCommands());
});

// --- Debug endpoint ---
app.get("/api/debug", (req, res) => {
  const tmuxSessions = listTmuxSessions();
  const debug = {
    tmuxSessions,
    wsClients: wss.clients.size,
    prevOutputKeys: [...prevOutputs.keys()],
    sessions: {},
  };
  for (const session of tmuxSessions) {
    const output = capturePane(session);
    debug.sessions[session] = {
      outputLength: output.length,
      outputLines: output.split("\n").length,
      outputPreview: output.substring(0, 200),
      prevOutputLength: (prevOutputs.get(session) || "").length,
    };
  }
  res.json(debug);
});

app.get("/api/claude-sessions", async (req, res) => {
  try {
    const sessions = await loadClaudeSessionsAsync(req.query.q || null);
    res.json(sessions);
  } catch {
    res.json([]);
  }
});

app.post("/api/sessions", async (req, res) => {
  const { name, prompt, workdir, resumeSessionId, initialImages, initialImageText } = req.body;

  if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
    return res.status(400).json({ error: "Invalid name (alphanumeric, dash, underscore only)" });
  }

  // Auto-increment name if it already exists: my-agent -> my-agent-1 -> my-agent-2 ...
  const existing = listTmuxSessions();
  let finalName = name;
  if (existing.includes(`${PREFIX}${finalName}`)) {
    let i = 1;
    while (existing.includes(`${PREFIX}${finalName}-${i}`)) i++;
    finalName = `${finalName}-${i}`;
  }

  // If resuming, derive workdir from the Claude session's projectPath
  let effectiveWorkdir = workdir;
  if (resumeSessionId && !workdir) {
    const allSessions = loadClaudeSessions(null);
    const match = allSessions.find((s) => s.sessionId === resumeSessionId);
    if (match && match.projectPath) {
      effectiveWorkdir = match.projectPath;
    }
  }

  // If images are attached, don't include user prompt in CLI args — send it later via paste-buffer
  const cliPrompt = (initialImages && initialImages.length > 0) ? null : prompt;

  try {
    createSession(finalName, effectiveWorkdir, cliPrompt, resumeSessionId);
    const finalWorkdir = effectiveWorkdir || DEFAULT_WORKDIR;
    const git = await getCachedGitInfo(finalWorkdir);
    res.json({ name: finalName, workdir: finalWorkdir, branch: git?.branch || null, isWorktree: git?.isWorktree || false, favorite: false, minimized: false });

    const sessionName = `${PREFIX}${finalName}`;

    // If initial images are attached, send them after Claude starts up
    if (initialImages && initialImages.length > 0) {
      const sendInitialImages = () => {
        const output = capturePane(sessionName);
        if (!output) return false;
        const status = detectStatus(output, "");
        // Wait for idle status (Claude showing ❯ prompt, ready for input)
        if (status !== "idle" && status !== "asking") return false;
        sendKeysWithImages(sessionName, initialImageText || "", initialImages);
        return true;
      };
      // Poll for Claude readiness — try at increasing intervals
      let sent = false;
      for (const ms of [3000, 5000, 8000, 12000, 18000, 25000]) {
        setTimeout(() => {
          if (!sent) sent = sendInitialImages();
        }, ms);
      }
    }

    // Actively push output to all WS clients once Claude starts rendering.
    const pushInitialOutput = () => {
      ensureTmuxServer();
      const output = capturePane(sessionName);
      if (!output) return;
      const prev = prevOutputs.get(sessionName) || "";
      if (output === prev) return;
      const pushStatus = detectStatus(output, prev);
      const filteredOutput = stripCeoPreamble(output);
      const pushPromptType = pushStatus === "waiting" ? detectPromptType(filteredOutput) : null;
      const pushPromptOptions = pushPromptType === "question" ? parsePromptOptions(filteredOutput) : null;
      const message = JSON.stringify({
        type: "output",
        session: finalName,
        lines: filterOutputForDisplay(output.split("\n")),
        status: pushStatus,
        promptType: pushPromptType,
        promptOptions: pushPromptOptions,
      });
      prevOutputs.set(sessionName, output);
      wss.clients.forEach((client) => {
        if (client.readyState === 1) client.send(message);
      });
    };
    // Push at intervals covering Claude's startup time
    for (const ms of [500, 1000, 2000, 3000, 5000, 8000, 12000]) {
      setTimeout(pushInitialOutput, ms);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch("/api/sessions/:name", (req, res) => {
  const { name } = req.params;
  if (!isValidAgentName(name)) return res.status(400).json({ error: "Invalid agent name" });
  const { newName, workdir } = req.body;
  const session = `${PREFIX}${name}`;

  if (!listTmuxSessions().includes(session)) {
    return res.status(404).json({ error: "Session not found" });
  }

  const meta = loadSessionsMeta();

  // Rename
  if (newName && newName !== name) {
    if (!/^[a-zA-Z0-9_-]+$/.test(newName)) {
      return res.status(400).json({ error: "Invalid name" });
    }
    tmuxExec(`rename-session -t ${session} ${PREFIX}${newName}`);
    meta[newName] = { ...meta[name] };
    delete meta[name];
    saveSessionsMeta(meta);
    return res.json({ name: newName, workdir: meta[newName]?.workdir });
  }

  // Change workspace (kills and recreates)
  if (workdir) {
    killSession(name);
    createSession(name, workdir);
    return res.json({ name, workdir });
  }

  res.json({ name });
});

// Restart agent — kill tmux session and resume with same Claude session ID
app.post("/api/sessions/:name/restart", async (req, res) => {
  const { name } = req.params;
  if (!isValidAgentName(name)) return res.status(400).json({ error: "Invalid agent name" });
  const session = `${PREFIX}${name}`;

  const meta = loadSessionsMeta();
  const info = meta[name];
  if (!info) return res.status(404).json({ error: "Agent not found in metadata" });

  // Ensure we have a session ID to resume
  let sessionId = info.resumeSessionId;
  if (!sessionId) {
    sessionId = detectClaudeSessionIdForAgent(info.workdir || DEFAULT_WORKDIR, info.created);
  }
  if (!sessionId) {
    return res.status(400).json({ error: "No Claude session ID found — cannot resume" });
  }

  // Kill the old tmux session (but don't delete metadata)
  try { tmuxExec(`kill-session -t ${session}`); } catch {}

  // Clear cached output so the new session starts fresh
  prevOutputs.delete(session);

  // Recreate the tmux session in the same workdir
  const dir = info.workdir || DEFAULT_WORKDIR;
  if (!isValidWorkdir(dir)) {
    return res.status(400).json({ error: "Invalid working directory in metadata" });
  }
  if (!isValidSessionId(sessionId)) {
    return res.status(400).json({ error: "Invalid session ID format" });
  }
  execSync(
    `tmux new-session -d -s ${session} -x 120 -y 50 -c ${shellQuote(dir)}`,
    { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
  );
  tmuxExec(`set-option -t ${session} remain-on-exit on`);
  tmuxExec(`set-option -t ${session} history-limit 50000`);

  const claudeCmd = `claude --resume ${sessionId}`;
  // Use set-buffer/paste-buffer (same safe pattern as createSession) to avoid shell injection
  const fullCmd = `clear && unset CLAUDECODE && ${claudeCmd}`;
  const cmdEscaped = fullCmd.replace(/'/g, "'\\''");
  tmuxExec(`set-buffer -b ceocmd -- '${cmdEscaped}'`);
  tmuxExec(`paste-buffer -b ceocmd -t ${session}`);
  tmuxExec(`delete-buffer -b ceocmd`);
  tmuxExec(`send-keys -t ${session} Enter`);

  // Update metadata — keep everything, refresh created time
  info.resumeSessionId = sessionId;
  saveSessionsMeta(meta);

  const git = await getCachedGitInfo(dir);
  res.json({ ok: true, workdir: dir, branch: git?.branch || null, isWorktree: git?.isWorktree || false });
});

app.delete("/api/sessions/:name", (req, res) => {
  const { name } = req.params;
  if (!isValidAgentName(name)) return res.status(400).json({ error: "Invalid agent name" });
  const session = `${PREFIX}${name}`;

  if (!listTmuxSessions().includes(session)) {
    return res.status(404).json({ error: "Session not found" });
  }

  killSession(name);
  res.json({ ok: true });
});

// --- Favorite toggle ---

app.patch("/api/sessions/:name/favorite", (req, res) => {
  const { name } = req.params;
  const session = `${PREFIX}${name}`;

  if (!listTmuxSessions().includes(session)) {
    return res.status(404).json({ error: "Session not found" });
  }

  const meta = loadSessionsMeta();
  if (!meta[name]) meta[name] = {};
  meta[name].favorite = !meta[name].favorite;
  saveSessionsMeta(meta);

  res.json({ favorite: meta[name].favorite });
});

app.patch("/api/sessions/:name/minimize", (req, res) => {
  const { name } = req.params;
  const meta = loadSessionsMeta();
  if (!meta[name]) meta[name] = {};
  // Toggle, or set explicitly if body provides value
  const minimized = req.body.minimized !== undefined ? req.body.minimized : !meta[name].minimized;
  meta[name].minimized = minimized;
  saveSessionsMeta(meta);
  // Broadcast to all clients so other browsers update live
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(JSON.stringify({ type: "minimize-sync", session: name, minimized }));
    }
  }
  res.json({ minimized });
});

// --- Agent memory ---

app.post("/api/sessions/:name/snapshot-memory", (req, res) => {
  const { name } = req.params;
  if (!isSafePathSegment(name)) {
    return res.status(400).json({ error: "Invalid agent name" });
  }
  const mode = req.body?.mode || "save";
  const session = `${PREFIX}${name}`;

  if (!listTmuxSessions().includes(session)) {
    return res.status(404).json({ error: "Session not found" });
  }

  // Capture terminal output (last ~500 lines, strip ANSI)
  const raw = tmuxExec(`capture-pane -t ${session} -p -S -500 -E -`);
  if (!raw) {
    return res.status(500).json({ error: "Failed to capture terminal output" });
  }
  const stripped = raw.replace(/\x1b\[[0-9;]*m/g, "");

  // Write to temp file
  const tmpFile = path.join(os.tmpdir(), `ceo-snapshot-${name}.txt`);
  fs.writeFileSync(tmpFile, stripped, "utf8");

  // Ensure agent docs dir exists
  const agentDocsDir = path.join(DOCS_DIR, name);
  if (!fs.existsSync(agentDocsDir)) fs.mkdirSync(agentDocsDir, { recursive: true });

  // Spawn a short-lived tmux session to run Claude for the snapshot
  const snapshotSession = `${PREFIX}_snap_${name}`;
  try {
    tmuxExec(`kill-session -t ${snapshotSession}`);
  } catch {}

  const memoryPath = path.join(DOCS_DIR, name, "memory.md");

  let prompt;
  if (mode === "update") {
    // Read existing memory to include in the prompt
    let existing = "";
    try { existing = fs.readFileSync(memoryPath, "utf8"); } catch {}
    if (existing) {
      const existingTmp = path.join(os.tmpdir(), `ceo-existing-memory-${name}.txt`);
      fs.writeFileSync(existingTmp, existing, "utf8");
      prompt = `You have two files. File 1 (${existingTmp}) is the existing memory for agent "${name}". File 2 (${tmpFile}) is a recent conversation log. Read both files, then write an UPDATED memory to ${memoryPath} that merges the existing memory with any new information from the conversation. Preserve important existing context. Add new decisions, progress, and state changes. Remove anything that is now outdated. Keep it under 200 lines. Format as markdown.`;
    } else {
      prompt = `Read the file ${tmpFile} which contains a conversation log from a Claude Code agent named "${name}". Write a concise memory summary to ${memoryPath}. Focus on: what was being worked on, key decisions made, current state, unfinished tasks, and any important context for resuming later. Keep it under 200 lines. Format as markdown.`;
    }
  } else {
    prompt = `Read the file ${tmpFile} which contains a conversation log from a Claude Code agent named "${name}". Write a concise memory summary to ${memoryPath}. Focus on: what was being worked on, key decisions made, current state, unfinished tasks, and any important context for resuming later. Keep it under 200 lines. Format as markdown.`;
  }

  const escaped = prompt.replace(/'/g, "'\\''");

  try {
    execSync(
      `tmux new-session -d -s ${snapshotSession} -x 120 -y 50`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
    );
    tmuxExec(`send-keys -t ${snapshotSession} "claude '${escaped}' && exit" Enter`);

    setTimeout(() => {
      tmuxExec(`kill-session -t ${snapshotSession}`);
    }, 120000);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/sessions/:name/memory", (req, res) => {
  const { name } = req.params;
  if (!isSafePathSegment(name)) {
    return res.status(400).json({ error: "Invalid agent name" });
  }
  const memoryPath = path.join(DOCS_DIR, name, "memory.md");
  if (!isWithinDir(memoryPath, DOCS_DIR)) {
    return res.status(400).json({ error: "Invalid path" });
  }
  try {
    if (fs.existsSync(memoryPath)) {
      fs.unlinkSync(memoryPath);
      // Remove agent dir if now empty
      const agentDir = path.join(DOCS_DIR, name);
      try {
        const remaining = fs.readdirSync(agentDir).filter((f) => f.endsWith(".md"));
        if (remaining.length === 0) fs.rmdirSync(agentDir);
      } catch {}
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Code Diff Viewer API ---

app.get("/api/sessions/:name/diff", async (req, res) => {
  const { name } = req.params;
  if (!isSafePathSegment(name)) {
    return res.status(400).json({ error: "Invalid session name" });
  }
  const sessions = listTmuxSessions();
  const session = sessions.find((s) => s === `${PREFIX}${name}`);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  // Resolve working directory
  let workdir;
  try {
    workdir = await getEffectiveCwdAsync(session, prevOutputs.get(session));
  } catch {}
  if (!workdir) {
    const meta = loadSessionsMeta();
    workdir = meta[name]?.workdir;
  }
  if (!workdir) {
    return res.status(400).json({ error: "Could not determine working directory" });
  }

  // Verify git repo
  try {
    execSync("git rev-parse --is-inside-work-tree", { cwd: workdir, timeout: 5000, stdio: "ignore" });
  } catch {
    return res.status(400).json({ error: "Not a git repository" });
  }

  // Run git diff (unstaged) + git diff --cached (staged) in parallel
  const runGitDiff = (args) =>
    new Promise((resolve) => {
      exec(`git diff ${args}`, { cwd: workdir, timeout: 10000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout) => {
        resolve(err ? "" : stdout);
      });
    });

  try {
    const [unstaged, staged] = await Promise.all([runGitDiff(""), runGitDiff("--cached")]);
    res.json({
      workdir,
      hasDiff: !!(unstaged || staged),
      unstaged,
      staged,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- .claude File Browser API ---

const CLAUDE_HOME = path.join(os.homedir(), ".claude");

function isAllowedPath(p) {
  const resolved = path.resolve(p);
  return resolved.startsWith(CLAUDE_HOME + path.sep) || resolved === CLAUDE_HOME
    || resolved.startsWith(DOCS_DIR + path.sep) || resolved === DOCS_DIR;
}

function scanDir(dirPath) {
  try {
    return fs.readdirSync(dirPath)
      .filter((f) => !f.startsWith("."))
      .map((f) => {
        const fullPath = path.join(dirPath, f);
        try {
          const stat = fs.statSync(fullPath);
          return { name: f, path: fullPath, size: stat.size, modified: stat.mtime.toISOString() };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

function scanMemoryFiles() {
  const memoryFiles = [];
  const projectsDir = path.join(CLAUDE_HOME, "projects");
  try {
    for (const dir of fs.readdirSync(projectsDir)) {
      const memDir = path.join(projectsDir, dir, "memory");
      try {
        const stat = fs.statSync(memDir);
        if (!stat.isDirectory()) continue;
        for (const file of fs.readdirSync(memDir)) {
          const fullPath = path.join(memDir, file);
          try {
            const fstat = fs.statSync(fullPath);
            // Show project name in the file name for context
            const projectName = dir.replace(/-/g, "/").slice(0, 40);
            memoryFiles.push({
              name: `${file}`,
              path: fullPath,
              size: fstat.size,
              modified: fstat.mtime.toISOString(),
              project: projectName,
            });
          } catch {}
        }
      } catch {}
    }
  } catch {}
  return memoryFiles.sort((a, b) => a.name.localeCompare(b.name));
}

function scanSkills() {
  const skillsDir = path.join(CLAUDE_HOME, "skills");
  const results = [];
  try {
    for (const entry of fs.readdirSync(skillsDir)) {
      if (entry.startsWith(".")) continue;
      const entryPath = path.join(skillsDir, entry);
      try {
        const stat = fs.statSync(entryPath);
        if (stat.isDirectory()) {
          for (const file of fs.readdirSync(entryPath)) {
            if (file.startsWith(".")) continue;
            const filePath = path.join(entryPath, file);
            try {
              const fstat = fs.statSync(filePath);
              if (!fstat.isFile()) continue;
              results.push({
                name: `${entry}/${file}`,
                path: filePath,
                size: fstat.size,
                modified: fstat.mtime.toISOString(),
                skill: entry,
              });
            } catch {}
          }
        }
      } catch {}
    }
  } catch {}
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

function scanCeoDocs() {
  ensureDocsDir();
  const results = [];
  try {
    for (const entry of fs.readdirSync(DOCS_DIR)) {
      const entryPath = path.join(DOCS_DIR, entry);
      try {
        const stat = fs.statSync(entryPath);
        if (stat.isDirectory()) {
          // Agent subdirectory — scan for .md files
          for (const file of fs.readdirSync(entryPath)) {
            if (!file.endsWith(".md")) continue;
            const filePath = path.join(entryPath, file);
            try {
              const fstat = fs.statSync(filePath);
              results.push({
                name: `${entry}/${file}`,
                path: filePath,
                size: fstat.size,
                modified: fstat.mtime.toISOString(),
                agent: entry,
              });
            } catch {}
          }
        } else if (entry.endsWith(".md")) {
          // Legacy flat file
          results.push({ name: entry, path: entryPath, size: stat.size, modified: stat.mtime.toISOString() });
        }
      } catch {}
    }
  } catch {}
  return results.sort((a, b) => new Date(b.modified) - new Date(a.modified));
}

app.get("/api/claude-files", (req, res) => {
  const result = {
    docs: scanDir(path.join(CLAUDE_HOME, "docs")),
    commands: scanDir(path.join(CLAUDE_HOME, "commands")),
    skills: scanSkills(),
    agents: scanDir(path.join(CLAUDE_HOME, "agents")),
    memory: scanMemoryFiles(),
    ceoDocs: scanCeoDocs(),
  };

  // Settings file
  const settingsPath = path.join(CLAUDE_HOME, "settings.json");
  try {
    const stat = fs.statSync(settingsPath);
    result.settings = { path: settingsPath, size: stat.size, modified: stat.mtime.toISOString() };
  } catch {
    result.settings = null;
  }

  res.json(result);
});

app.get("/api/claude-files/read", (req, res) => {
  const filePath = req.query.path;
  if (!filePath || !isAllowedPath(filePath)) {
    return res.status(400).json({ error: "Invalid path — must be within ~/.claude/" });
  }

  try {
    const content = fs.readFileSync(filePath, "utf8");
    res.json({ content });
  } catch (e) {
    res.status(404).json({ error: "File not found" });
  }
});

app.put("/api/claude-files/write", (req, res) => {
  const { path: filePath, content } = req.body;
  if (!filePath || !isAllowedPath(filePath)) {
    return res.status(400).json({ error: "Invalid path — must be within ~/.claude/" });
  }

  try {
    fs.writeFileSync(filePath, content, "utf8");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/claude-files/ensure-docs", (req, res) => {
  const docsDir = path.join(os.homedir(), ".claude", "docs");
  try {
    if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
    res.json({ ok: true, path: docsDir });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Agent Docs API (multi-doc per agent) ---

app.get("/api/agent-docs/:name", (req, res) => {
  if (!isSafePathSegment(req.params.name)) {
    return res.status(400).json({ error: "Invalid agent name" });
  }
  ensureDocsDir();
  const agentDir = path.join(DOCS_DIR, req.params.name);
  if (!isWithinDir(agentDir, DOCS_DIR)) {
    return res.status(400).json({ error: "Invalid path" });
  }
  try {
    if (!fs.existsSync(agentDir) || !fs.statSync(agentDir).isDirectory()) {
      return res.json([]);
    }
    const files = fs.readdirSync(agentDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => {
        const fullPath = path.join(agentDir, f);
        const stat = fs.statSync(fullPath);
        return { name: f.replace(/\.md$/, ""), path: fullPath, size: stat.size, modified: stat.mtime.toISOString() };
      })
      .sort((a, b) => new Date(b.modified) - new Date(a.modified));
    res.json(files);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/agent-docs/:name/:doc", (req, res) => {
  if (!isSafePathSegment(req.params.name) || !isSafePathSegment(req.params.doc)) {
    return res.status(400).json({ error: "Invalid name or doc" });
  }
  ensureDocsDir();
  const filePath = path.join(DOCS_DIR, req.params.name, `${req.params.doc}.md`);
  if (!isWithinDir(filePath, DOCS_DIR)) {
    return res.status(400).json({ error: "Invalid path" });
  }
  try {
    const content = fs.readFileSync(filePath, "utf8");
    res.json({ content });
  } catch {
    res.json({ content: null });
  }
});

app.put("/api/agent-docs/:name/:doc", (req, res) => {
  if (!isSafePathSegment(req.params.name) || !isSafePathSegment(req.params.doc)) {
    return res.status(400).json({ error: "Invalid name or doc" });
  }
  ensureDocsDir();
  const agentDir = path.join(DOCS_DIR, req.params.name);
  if (!isWithinDir(agentDir, DOCS_DIR)) {
    return res.status(400).json({ error: "Invalid path" });
  }
  if (!fs.existsSync(agentDir)) fs.mkdirSync(agentDir, { recursive: true });
  const filePath = path.join(agentDir, `${req.params.doc}.md`);
  try {
    fs.writeFileSync(filePath, req.body.content || "", "utf8");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/agent-docs/:name/:doc/move-to-local", (req, res) => {
  if (!isSafePathSegment(req.params.name) || !isSafePathSegment(req.params.doc)) {
    return res.status(400).json({ error: "Invalid name or doc" });
  }
  ensureDocsDir();
  const srcPath = path.join(DOCS_DIR, req.params.name, `${req.params.doc}.md`);
  if (!isWithinDir(srcPath, DOCS_DIR)) {
    return res.status(400).json({ error: "Invalid path" });
  }
  const destDir = path.join(os.homedir(), ".claude", "docs");
  const destPath = path.join(destDir, `${req.params.doc}.md`);

  try {
    if (!fs.existsSync(srcPath)) {
      return res.status(404).json({ error: "Doc not found" });
    }
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    fs.copyFileSync(srcPath, destPath);
    res.json({ ok: true, destPath });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/agent-docs/:name/:doc", (req, res) => {
  if (!isSafePathSegment(req.params.name) || !isSafePathSegment(req.params.doc)) {
    return res.status(400).json({ error: "Invalid name or doc" });
  }
  ensureDocsDir();
  const filePath = path.join(DOCS_DIR, req.params.name, `${req.params.doc}.md`);
  if (!isWithinDir(filePath, DOCS_DIR)) {
    return res.status(400).json({ error: "Invalid path" });
  }
  try {
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Doc not found" });
    }
    fs.unlinkSync(filePath);
    // Remove agent dir if now empty
    const agentDir = path.join(DOCS_DIR, req.params.name);
    try {
      const remaining = fs.readdirSync(agentDir).filter((f) => f.endsWith(".md"));
      if (remaining.length === 0) fs.rmdirSync(agentDir);
    } catch {}
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/ceo-md", (req, res) => {
  try {
    const content = fs.readFileSync(CEO_MD_PATH, "utf8");
    res.json({ content });
  } catch {
    res.json({ content: "" });
  }
});

app.put("/api/ceo-md", (req, res) => {
  try {
    fs.writeFileSync(CEO_MD_PATH, req.body.content || "", "utf8");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Settings API (power management, Tailscale) ---

// Shell autocomplete — return file/directory completions for the given word
app.post("/api/shell/completions", (req, res) => {
  const { word, cwd, dirsOnly } = req.body || {};
  if (!cwd || typeof cwd !== "string") return res.json({ completions: [] });
  // Block null bytes in input to prevent path truncation attacks
  if (/\0/.test(cwd) || (word && /\0/.test(word))) return res.json({ completions: [] });
  try {
    const expandedWord = (word || "").replace(/^~/, os.homedir());
    let targetDir, prefix;
    if (!expandedWord || expandedWord.endsWith("/")) {
      targetDir = expandedWord
        ? (path.isAbsolute(expandedWord) ? expandedWord : path.join(cwd, expandedWord))
        : cwd;
      prefix = "";
    } else {
      const fullPath = path.isAbsolute(expandedWord) ? expandedWord : path.join(cwd, expandedWord);
      targetDir = path.dirname(fullPath);
      prefix = path.basename(fullPath);
    }
    const showHidden = prefix.startsWith(".");
    const entries = fs.readdirSync(targetDir, { withFileTypes: true });
    const filtered = entries
      .filter(e => {
        if (!showHidden && e.name.startsWith(".")) return false;
        if (prefix && !e.name.toLowerCase().startsWith(prefix.toLowerCase())) return false;
        if (dirsOnly && !e.isDirectory() && !e.isSymbolicLink()) return false;
        return true;
      })
      .map(e => ({
        name: e.name,
        type: e.isDirectory() ? "dir" : e.isSymbolicLink() ? "link" : "file",
      }))
      .sort((a, b) => {
        if (a.type === "dir" && b.type !== "dir") return -1;
        if (a.type !== "dir" && b.type === "dir") return 1;
        return a.name.localeCompare(b.name);
      });
    res.json({ completions: filtered.slice(0, 50) });
  } catch {
    res.json({ completions: [] });
  }
});

// Open a URL in the dashboard client (intercepted from shell `open` command)
app.post("/api/shell/open-url", (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: "Invalid URL — must start with http:// or https://" });
  }
  const msg = JSON.stringify({ type: "shell-open-url", url });
  wss.clients.forEach((c) => { if (c.readyState === 1) c.send(msg); });
  res.json({ ok: true });
});

// Open a folder in Finder (used by shell CWD pill click)
app.post("/api/shell/open-finder", (req, res) => {
  const { path: folderPath } = req.body || {};
  if (!folderPath || typeof folderPath !== "string" || !path.isAbsolute(folderPath)) {
    return res.status(400).json({ error: "Invalid path" });
  }
  // Block null bytes and newlines that could be used for injection
  if (/[\0\n\r]/.test(folderPath)) {
    return res.status(400).json({ error: "Invalid path characters" });
  }
  // Verify target is an existing directory before opening
  try {
    if (!fs.statSync(folderPath).isDirectory()) {
      return res.status(400).json({ error: "Path is not a directory" });
    }
  } catch {
    return res.status(400).json({ error: "Path does not exist" });
  }
  // Use execFile (no shell) to prevent command injection
  require("child_process").execFile("open", [folderPath], { timeout: 5000 }, () => {});
  res.json({ ok: true });
});

// Open a URL in the native app's in-app browser overlay (used by BROWSER env var helper)
app.post("/api/open-url", express.json(), (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: "Invalid URL — must start with http:// or https://" });
  }
  for (const client of wss.clients) {
    try { client.send(JSON.stringify({ type: "open-url", url })); } catch {}
  }
  res.json({ ok: true });
});

app.get("/api/settings", (req, res) => {
  try {
    // Read pmset AC power sleep setting
    let sleepPrevention = false;
    try {
      const pmsetOut = execSync("pmset -g custom", { encoding: "utf8", timeout: 5000 });
      // Parse AC Power section
      const acSection = pmsetOut.split("AC Power:")[1] || "";
      const sleepMatch = acSection.match(/\bsleep\s+(\d+)/);
      if (sleepMatch) {
        sleepPrevention = sleepMatch[1] === "0";
      }
    } catch {}

    // Read Tailscale status
    let tailscale = { installed: false, running: false, ip: null, hostname: null };
    try {
      const tsStatus = execSync("tailscale status --json 2>/dev/null", { encoding: "utf8", timeout: 5000 });
      const ts = JSON.parse(tsStatus);
      tailscale.installed = true;
      tailscale.running = true;
      if (ts.Self) {
        tailscale.ip = ts.Self.TailscaleIPs?.[0] || null;
        tailscale.hostname = ts.Self.DNSName?.replace(/\.$/, "") || null;
      }
    } catch {
      // Check if tailscale binary exists but isn't running
      try {
        execSync("which tailscale 2>/dev/null || test -d /Applications/Tailscale.app", { timeout: 3000 });
        tailscale.installed = true;
      } catch {}
    }

    // Check if launchd agent is loaded
    let autoStart = false;
    try {
      const launchctlOut = execSync("launchctl list 2>/dev/null", { encoding: "utf8", timeout: 5000 });
      autoStart = launchctlOut.includes("com.ceo-dashboard");
    } catch {}

    // Check if Dock app is installed
    const dockAppPath = path.join(os.homedir(), "Applications", "CEO Dashboard.app");
    const dockAppInstalled = fs.existsSync(dockAppPath);

    res.json({ sleepPrevention, tailscale, autoStart, dockAppInstalled });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/settings/sleep-prevention", (req, res) => {
  const { enabled } = req.body;
  try {
    if (enabled) {
      execSync("sudo -n pmset -c sleep 0", { timeout: 5000 });
    } else {
      execSync("sudo -n pmset -c sleep 1", { timeout: 5000 });
    }
    res.json({ ok: true, sleepPrevention: enabled });
  } catch (e) {
    // sudo -n fails if NOPASSWD not configured
    res.status(403).json({
      error: `Needs passwordless sudo for pmset. Run in terminal:\n  echo '${os.userInfo().username} ALL=(ALL) NOPASSWD: /usr/bin/pmset' | sudo tee /etc/sudoers.d/ceo-dashboard`
    });
  }
});

app.post("/api/settings/auto-start", (req, res) => {
  const { enabled } = req.body;
  const plistDir = path.join(os.homedir(), "Library", "LaunchAgents");
  const plistPath = path.join(plistDir, "com.ceo-dashboard.plist");
  try {
    if (enabled) {
      // Generate plist if it doesn't exist (uses current dashboard location + node path)
      if (!fs.existsSync(plistPath)) {
        const nodePath = process.execPath;
        const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.ceo-dashboard</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${path.join(__dirname, "server.js")}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${__dirname}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/ceo-dashboard.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/ceo-dashboard-err.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${path.dirname(nodePath)}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>HOME</key>
        <string>${os.homedir()}</string>
    </dict>
</dict>
</plist>`;
        if (!fs.existsSync(plistDir)) fs.mkdirSync(plistDir, { recursive: true });
        fs.writeFileSync(plistPath, plistContent);
      }
      execSync(`launchctl load "${plistPath}" 2>/dev/null`, { timeout: 5000 });
    } else {
      execSync(`launchctl unload "${plistPath}" 2>/dev/null`, { timeout: 5000 });
    }
    res.json({ ok: true, autoStart: enabled });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/settings/add-to-dock", (req, res) => {
  const buildScript = path.join(__dirname, "native-app", "build.sh");
  try {
    execSync(`bash "${buildScript}"`, { timeout: 30000, encoding: "utf8" });
    const appDir = path.join(os.homedir(), "Applications", "CEO Dashboard.app");
    res.json({ ok: true, path: appDir });
  } catch (e) {
    res.status(500).json({ error: e.stderr || e.message });
  }
});

// Send a notification — osascript for macOS banners, WebSocket for browser + native app badge
const DASHBOARD_TITLE = "CEO Dashboard";
function sendNotification(subtitle, body) {
  // Sanitize for AppleScript: strip control chars, limit length, escape for double-quoted strings.
  // We pass the script via execFile argv (not shell) to avoid shell injection entirely.
  const sanitize = (s) => (s || "").replace(/[\x00-\x1f\x7f]/g, "").slice(0, 500);
  const escAS = (s) => sanitize(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const subtitlePart = subtitle ? ` subtitle "${escAS(subtitle)}"` : "";
  try {
    const script = `display notification "${escAS(body)}" with title "${escAS(DASHBOARD_TITLE)}"${subtitlePart} sound name "default"`;
    // Use execFile to avoid shell interpretation — args are passed directly to osascript
    require("child_process").execFileSync("osascript", ["-e", script], { timeout: 3000, stdio: "ignore" });
  } catch {}
  // Also broadcast via WebSocket for native app badge + browser notifications
  const browserTitle = subtitle ? `${DASHBOARD_TITLE} — ${subtitle}` : DASHBOARD_TITLE;
  const msg = JSON.stringify({ type: "native-notification", title: browserTitle, body: sanitize(body), tag: "agent-" + Date.now() });
  wss.clients.forEach((c) => { if (c.readyState === 1) c.send(msg); });
}

// Agent notification API
app.post("/api/notify", (req, res) => {
  const { title, message } = req.body || {};
  sendNotification(title, message || "");
  res.json({ ok: true });
});

// Legacy test endpoint
app.post("/api/test-notification", (req, res) => {
  const { title, body } = req.body || {};
  sendNotification(title || "Test", body || "This is a test notification");
  res.json({ ok: true });
});

// --- Image Upload API ---

app.post("/api/upload", (req, res) => {
  const { filename, data } = req.body;
  if (!filename || !data) {
    return res.status(400).json({ error: "Missing filename or data" });
  }
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const uniqueName = `${Date.now()}-${safeName}`;
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const filePath = path.join(UPLOADS_DIR, uniqueName);
  try {
    fs.writeFileSync(filePath, Buffer.from(data, "base64"));
    res.json({ path: filePath, name: filename });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Open folder in Finder (macOS) ---
app.post("/api/open-folder", (req, res) => {
  let { filePath } = req.body;
  if (!filePath) return res.status(400).json({ error: "Missing filePath" });
  // Handle special ceo-md path
  if (filePath === "__ceo_md__") filePath = CEO_MD_PATH;
  const resolved = path.resolve(filePath);
  if (!isAllowedPath(resolved)) return res.status(403).json({ error: "Path not allowed" });
  // Block null bytes
  if (/[\0]/.test(resolved)) return res.status(400).json({ error: "Invalid path" });
  // If file exists, reveal it selected in Finder (-R); otherwise open parent dir
  // Use execFile (no shell) to prevent command injection
  const { execFile: execFileOpen } = require("child_process");
  const fileExists = fs.existsSync(resolved) && fs.statSync(resolved).isFile();
  const args = fileExists ? ["-R", resolved] : [path.dirname(resolved)];
  execFileOpen("open", args, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true });
  });
});

// --- Todo API ---

app.get("/api/todos", (req, res) => {
  res.json(loadTodos());
});

app.post("/api/todos", (req, res) => {
  const data = loadTodos();
  const { title, colorId, content, agent } = req.body;
  // Pick a random color if none specified
  const color = colorId || (data.colors.length > 0
    ? data.colors[Math.floor(Math.random() * data.colors.length)].id
    : "coral");
  const now = new Date().toISOString();
  const list = {
    id: generateTodoId(),
    title: title || "New List",
    colorId: color,
    content: content || "",
    createdAt: now,
    updatedAt: now,
    order: data.lists.length,
    createdBy: agent || null,
    lastModifiedBy: agent || null,
    agentHistory: agent ? [agent] : [],
  };
  data.lists.push(list);
  saveTodos(data);
  broadcastTodos();
  res.json(list);
});

app.put("/api/todos/:id", (req, res) => {
  const data = loadTodos();
  const list = data.lists.find((l) => l.id === req.params.id);
  if (!list) return res.status(404).json({ error: "List not found" });
  const { title, colorId, content, order, agent } = req.body;
  if (title !== undefined) list.title = title;
  if (colorId !== undefined) list.colorId = colorId;
  if (content !== undefined) list.content = content;
  if (order !== undefined) list.order = order;
  list.updatedAt = new Date().toISOString();
  if (agent) {
    list.lastModifiedBy = agent;
    if (!list.agentHistory) list.agentHistory = [];
    if (!list.agentHistory.includes(agent)) list.agentHistory.push(agent);
  }
  saveTodos(data);
  broadcastTodos();
  res.json(list);
});

app.delete("/api/todos/:id", (req, res) => {
  const data = loadTodos();
  const idx = data.lists.findIndex((l) => l.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "List not found" });
  data.lists.splice(idx, 1);
  // Renormalize order
  data.lists.forEach((l, i) => (l.order = i));
  saveTodos(data);
  broadcastTodos();
  res.json({ ok: true });
});

app.put("/api/todos/:id/reorder", (req, res) => {
  const data = loadTodos();
  const { newOrder } = req.body;
  if (typeof newOrder !== "number") return res.status(400).json({ error: "Missing newOrder" });
  const list = data.lists.find((l) => l.id === req.params.id);
  if (!list) return res.status(404).json({ error: "List not found" });
  // Remove from current position and insert at new order
  data.lists.splice(data.lists.indexOf(list), 1);
  data.lists.splice(Math.min(newOrder, data.lists.length), 0, list);
  data.lists.forEach((l, i) => (l.order = i));
  saveTodos(data);
  broadcastTodos();
  res.json({ ok: true });
});

app.put("/api/todo-colors", (req, res) => {
  const data = loadTodos();
  const { colors } = req.body;
  if (!Array.isArray(colors)) return res.status(400).json({ error: "Missing colors array" });
  data.colors = colors;
  saveTodos(data);
  broadcastTodos();
  res.json({ ok: true });
});

// Get todos touched by a specific agent
app.get("/api/todos/by-agent/:agent", (req, res) => {
  const data = loadTodos();
  const agentName = req.params.agent;
  const lists = data.lists.filter(
    (l) => l.createdBy === agentName || l.lastModifiedBy === agentName ||
      (l.agentHistory && l.agentHistory.includes(agentName))
  );
  const colors = data.colors;
  res.json(lists.map((l) => ({
    id: l.id,
    title: l.title,
    colorId: l.colorId,
    hex: (colors.find((c) => c.id === l.colorId) || {}).hex || "#8A9BA8",
    createdBy: l.createdBy,
    lastModifiedBy: l.lastModifiedBy,
  })));
});

// --- Auto-update check ---
// Compares local HEAD against origin/main via git fetch.
// Any new commits on main trigger the update button — no releases needed.
// Release notes are fetched from GitHub Releases API for the tooltip (optional).

// --- Version Manager ---

app.get("/api/versions", (req, res) => {
  try {
    try { execSync("git fetch --tags origin", { cwd: __dirname, timeout: 15000, stdio: "ignore" }); } catch {}
    const tagsRaw = execSync('git tag -l "v*" --sort=-version:refname', { cwd: __dirname, encoding: "utf8" }).trim();
    if (!tagsRaw) return res.json({ versions: [], currentHead: null, minVersion: MIN_DASHBOARD_VERSION });
    const currentHead = execSync("git rev-parse HEAD", { cwd: __dirname, encoding: "utf8" }).trim();
    const versions = tagsRaw.split("\n").filter(t => /^v\d+\.\d+\.\d+$/.test(t) && compareVersions(t, MIN_DASHBOARD_VERSION) >= 0).map(tag => {
      const commitHash = execSync(`git rev-parse ${tag}^{}`, { cwd: __dirname, encoding: "utf8" }).trim();
      let date = null;
      try { date = execSync(`git log -1 --format=%aI ${tag}^{}`, { cwd: __dirname, encoding: "utf8" }).trim(); } catch {}
      return { tag, commitHash, date, isCurrent: commitHash === currentHead };
    });
    res.json({ versions, currentHead, minVersion: MIN_DASHBOARD_VERSION });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/install-version", (req, res) => {
  const { tag } = req.body;
  if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag)) return res.status(400).json({ error: "Invalid version tag" });
  if (compareVersions(tag, MIN_DASHBOARD_VERSION) < 0) return res.status(400).json({ error: `Cannot install versions older than ${MIN_DASHBOARD_VERSION}` });
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: __dirname, encoding: "utf8" }).trim();
    if (branch !== "main") return res.status(400).json({ error: "not-on-main", message: "Must be on the main branch to switch versions.", cwd: __dirname });
    // Save current origin/main HEAD as dismissed so update button doesn't nag
    try {
      const originHead = execSync("git rev-parse origin/main", { cwd: __dirname, encoding: "utf8" }).trim();
      userConfig.dismissedOriginHead = originHead;
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(userConfig, null, 2));
    } catch {}
    execSync(`git reset --hard ${tag}`, { cwd: __dirname, timeout: 30000 });
    // npm install if needed
    try { execSync("npm install", { cwd: __dirname, timeout: 60000 }); } catch {}
    res.json({ ok: true });
    // Notify clients and restart (same pattern as POST /api/update)
    for (const client of wss.clients) {
      try { client.send(JSON.stringify({ type: "server-restarting" })); } catch {}
    }
    const child = require("child_process").spawn(
      process.execPath, [path.join(__dirname, "server.js")],
      { cwd: __dirname, detached: true, stdio: "ignore", env: { ...process.env, CLAUDECODE: undefined } }
    );
    child.unref();
    setTimeout(() => process.exit(0), 300);
  } catch (err) {
    const msg = (err.stderr || "").toString() + " " + (err.message || "");
    if (/uncommitted changes|overwritten|local changes|please commit or stash/i.test(msg))
      return res.status(409).json({ error: "dirty-workdir", message: "You have uncommitted local changes that prevent switching versions.", cwd: __dirname });
    if (/could not resolve|unable to access|connection refused|network is unreachable/i.test(msg))
      return res.status(502).json({ error: "network", message: "Could not reach the remote repository." });
    if (/timed? ?out/i.test(msg))
      return res.status(504).json({ error: "timeout", message: "The version install timed out. Try again." });
    res.status(500).json({ error: "unknown", message: err.message || "Install failed", cwd: __dirname });
  }
});

// --- Update check ---

let updateCache = { updateAvailable: false, checkedAt: 0, behind: 0, releaseNotes: null, summary: null };
let _updateCheckPromise = null;

// Deduped wrapper — concurrent callers share the same in-flight check
function checkForUpdate() {
  if (_updateCheckPromise) return _updateCheckPromise;
  _updateCheckPromise = _doUpdateCheck().finally(() => { _updateCheckPromise = null; });
  return _updateCheckPromise;
}

async function _doUpdateCheck() {
  try {
    // Fetch latest commits from origin (no merge, just update refs)
    execSync("git fetch origin main", { cwd: __dirname, timeout: 15000, stdio: "ignore" });
    // Count how many commits we're behind
    const behind = execSync("git rev-list --count HEAD..origin/main", { cwd: __dirname, encoding: "utf8" }).trim();
    const behindCount = parseInt(behind, 10) || 0;
    let updateAvailable = behindCount > 0;

    // Respect intentional downgrades — suppress update if user dismissed this origin/main HEAD
    if (updateAvailable && userConfig.dismissedOriginHead) {
      try {
        const originHead = execSync("git rev-parse origin/main", { cwd: __dirname, encoding: "utf8" }).trim();
        if (originHead === userConfig.dismissedOriginHead) {
          // Same origin/main the user already dismissed — suppress
          updateAvailable = false;
        } else {
          // origin/main advanced past what the user dismissed — clear dismissal
          delete userConfig.dismissedOriginHead;
          fs.writeFileSync(CONFIG_PATH, JSON.stringify(userConfig, null, 2));
        }
      } catch {}
    }

    // Get a short summary of what changed
    let summary = null;
    if (updateAvailable) {
      try {
        summary = execSync('git log HEAD..origin/main --pretty=format:"%s" --no-merges', { cwd: __dirname, encoding: "utf8" }).trim();
      } catch {}
    }

    // Try to fetch release notes from GitHub (best-effort, for tooltip)
    let releaseNotes = null;
    if (updateAvailable) {
      try {
        const https = require("https");
        const data = await new Promise((resolve, reject) => {
          const req = https.get("https://api.github.com/repos/john-farina/claude-cli-dashboard/releases?per_page=1", {
            headers: { "User-Agent": "ceo-dashboard", "Accept": "application/vnd.github.v3+json" },
            timeout: 10000,
          }, (res) => {
            let body = "";
            res.on("data", (chunk) => body += chunk);
            res.on("end", () => {
              if (res.statusCode === 200) resolve(JSON.parse(body));
              else resolve([]);
            });
          });
          req.on("error", () => resolve([]));
          req.on("timeout", () => { req.destroy(); resolve([]); });
        });
        if (Array.isArray(data) && data.length > 0 && data[0].body) {
          releaseNotes = data[0].body;
        }
      } catch {}
    }

    updateCache = { updateAvailable, checkedAt: Date.now(), behind: behindCount, releaseNotes, summary };
    console.log(`[update-check] Behind origin/main by ${behindCount} commit(s). Update available: ${updateAvailable}`);

    if (updateAvailable) {
      const msg = JSON.stringify({ type: "update-available", behind: behindCount, releaseNotes, summary });
      for (const client of wss.clients) {
        try { if (client.readyState === 1) client.send(msg); } catch {}
      }
    }
  } catch (err) {
    console.error(`[update-check] Failed: ${err.message}`);
  }
}

// Run immediately on boot (deduped, so safe if endpoint calls concurrently) + every hour
checkForUpdate();
setInterval(checkForUpdate, 60 * 60 * 1000);

app.get("/api/check-update", async (req, res) => {
  // Always wait for the check if it hasn't completed yet (boot race) or if cache is stale
  if (!updateCache.checkedAt) await checkForUpdate();
  res.json(updateCache);
});

app.post("/api/update", async (req, res) => {
  try {
    // Run git fetch + merge
    execSync("git fetch origin main", { cwd: __dirname, timeout: 30000 });
    try {
      execSync("git -c merge.ff=false -c pull.rebase=false merge origin/main --no-edit", { cwd: __dirname, timeout: 30000 });
    } catch (mergeErr) {
      const stderr = (mergeErr.stderr || "").toString();
      const msg = mergeErr.message || "";
      const combined = stderr + " " + msg;

      // Real merge conflict — check for unmerged paths
      let conflicts = [];
      try {
        conflicts = execSync("git diff --name-only --diff-filter=U", { cwd: __dirname, encoding: "utf8" })
          .trim().split("\n").filter(Boolean);
      } catch {}
      if (conflicts.length > 0) {
        try { execSync("git merge --abort", { cwd: __dirname }); } catch {}
        return res.status(409).json({ error: "merge-conflict", conflicts, cwd: __dirname });
      }

      try { execSync("git merge --abort", { cwd: __dirname }); } catch {}

      // Dirty working tree
      if (/uncommitted changes|overwritten by merge|local changes|please commit or stash/i.test(combined))
        return res.status(409).json({ error: "dirty-workdir", message: "You have uncommitted local changes that conflict with the update.", cwd: __dirname });

      // Network
      if (/could not resolve|unable to access|connection refused|network is unreachable|repository.*not found/i.test(combined))
        return res.status(502).json({ error: "network", message: "Could not reach the remote repository." });

      // Timeout
      if (/timed? ?out/i.test(combined))
        return res.status(504).json({ error: "timeout", message: "The update timed out. Try again." });

      // Fallback
      return res.status(500).json({ error: "unknown", message: stderr || msg || "Merge failed", cwd: __dirname });
    }
    // Clear version dismissal — user explicitly chose to update
    if (userConfig.dismissedOriginHead) {
      delete userConfig.dismissedOriginHead;
      try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(userConfig, null, 2)); } catch {}
    }
    // Check if package-lock.json changed
    let needsInstall = false;
    try {
      const changed = execSync("git diff HEAD~1 --name-only", { cwd: __dirname, encoding: "utf8" });
      needsInstall = changed.includes("package-lock.json") || changed.includes("package.json");
    } catch {}
    if (needsInstall) {
      try {
        execSync("npm install", { cwd: __dirname, timeout: 60000 });
      } catch (npmErr) {
        return res.status(500).json({ error: "npm-failed", message: "Code updated but npm install failed.", cwd: __dirname });
      }
    }
    res.json({ ok: true });
    // Notify clients and restart
    for (const client of wss.clients) {
      try { client.send(JSON.stringify({ type: "server-restarting" })); } catch {}
    }
    const child = require("child_process").spawn(
      process.execPath, [path.join(__dirname, "server.js")],
      { cwd: __dirname, detached: true, stdio: "ignore", env: { ...process.env, CLAUDECODE: undefined } }
    );
    child.unref();
    setTimeout(() => process.exit(0), 300);
  } catch (err) {
    const msg = (err.stderr || "").toString() + " " + (err.message || "");
    if (/could not resolve|unable to access|connection refused|network is unreachable/i.test(msg))
      return res.status(502).json({ error: "network", message: "Could not reach the remote repository." });
    if (/timed? ?out/i.test(msg))
      return res.status(504).json({ error: "timeout", message: "The update timed out. Try again." });
    res.status(500).json({ error: "unknown", message: err.message || "Update failed", cwd: __dirname });
  }
});

// --- Server self-restart ---
// Responds immediately, spawns a fresh server, then exits this process.
// The new server picks up all tmux sessions via restoreSessions().
app.post("/api/restart-server", (req, res) => {
  res.json({ ok: true });
  // Notify all clients that a restart is happening
  for (const client of wss.clients) {
    try { client.send(JSON.stringify({ type: "server-restarting" })); } catch {}
  }
  // Spawn new server process (detached, unref'd so this process can exit)
  const child = require("child_process").spawn(
    process.execPath, [path.join(__dirname, "server.js")],
    { cwd: __dirname, detached: true, stdio: "ignore", env: { ...process.env, CLAUDECODE: undefined } }
  );
  child.unref();
  // Give the response time to flush, then exit
  setTimeout(() => process.exit(0), 300);
});

// --- WebSocket streaming ---

const prevOutputs = new Map();

// Broadcast output changes to ALL connected WebSocket clients.
// Uses a shared prevOutputs cache — call from a single global interval.
let _broadcastRunning = false;

async function broadcastOutputs() {
  if (wss.clients.size === 0) return;
  if (_broadcastRunning) return; // prevent overlap
  _broadcastRunning = true;

  try {
    // Periodically sync Claude session IDs for --resume on restart
    syncClaudeSessionIds();

    const sessions = await listTmuxSessionsAsync();

    // Capture all panes in parallel — async, never blocks event loop
    const captures = await Promise.all(
      sessions.map(async (session) => {
        const output = await capturePaneAsync(session);
        return { session, output };
      })
    );

    for (const { session, output } of captures) {
      if (!output) continue;
      const name = session.replace(PREFIX, "");
      const prev = prevOutputs.get(session) || "";

      // Only send if changed
      if (output !== prev) {
        const status = detectStatus(output, prev);
        const filteredOutput = stripCeoPreamble(output);
        const promptType = status === "waiting" ? detectPromptType(filteredOutput) : null;
        const promptOptions = promptType === "question" ? parsePromptOptions(filteredOutput) : null;
        prevOutputs.set(session, output);

        // Live workdir + git info — async
        const liveCwd = await getEffectiveCwdAsync(session, output);
        const git = await getCachedGitInfo(liveCwd);

        const message = JSON.stringify({
          type: "output",
          session: name,
          lines: filterOutputForDisplay(output.split("\n")),
          status,
          promptType,
          promptOptions,
          workdir: liveCwd || null,
          branch: git?.branch || null,
          isWorktree: git?.isWorktree || false,
        });

        wss.clients.forEach((client) => {
          if (client.readyState === 1) client.send(message);
        });
      }
    }
  } finally {
    _broadcastRunning = false;
  }
}

// Schedule rapid force-broadcasts after user interaction so terminal updates quickly.
let forceUpdateTimer = null;
function scheduleForceUpdate() {
  if (forceUpdateTimer) return; // already scheduled
  const delays = [50, 150, 400, 800, 1500, 3000];
  const timeouts = delays.map((ms) => setTimeout(broadcastOutputs, ms));
  forceUpdateTimer = setTimeout(() => {
    forceUpdateTimer = null;
  }, delays[delays.length - 1] + 100);
}

// --- WebSocket heartbeat: detect and clean up zombie connections ---
// WKWebView can abruptly kill WS connections (on reload/navigate) without sending a close frame.
// Without heartbeat, the server keeps sending to dead sockets that silently discard messages.
const WS_PING_INTERVAL = 15000; // 15s between pings
const WS_PONG_TIMEOUT = 10000;  // 10s to respond before considered dead

const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws._isAlive === false) {
      // Didn't respond to last ping — terminate
      shellClients.delete(ws);
      return ws.terminate();
    }
    ws._isAlive = false;
    ws.ping();
  });
}, WS_PING_INTERVAL);

wss.on("close", () => clearInterval(heartbeatInterval));

// Prevent unhandled WSS errors from crashing the process
wss.on("error", (err) => {
  console.error("[wss] WebSocket server error:", err.message);
});

wss.on("connection", (ws) => {
  // Heartbeat tracking
  ws._isAlive = true;
  ws.on("pong", () => { ws._isAlive = true; });

  // Send initial full state async — never blocks the event loop
  (async () => {
    const sessions = await listTmuxSessionsAsync();
    const meta = loadSessionsMeta();

    // Capture all panes in parallel
    const captures = await Promise.all(
      sessions.map(async (session) => ({
        session,
        output: await capturePaneAsync(session),
      }))
    );

    const sessionInfos = [];
    for (const { session, output } of captures) {
      const name = session.replace(PREFIX, "");
      prevOutputs.set(session, output);

      const liveCwd = await getEffectiveCwdAsync(session, output);
      const git = await getCachedGitInfo(liveCwd);

      const initStatus = detectStatus(output, "");
      const filteredOutput = stripCeoPreamble(output);
      const initPromptType = initStatus === "waiting" ? detectPromptType(filteredOutput) : null;
      const initPromptOptions = initPromptType === "question" ? parsePromptOptions(filteredOutput) : null;
      if (ws.readyState === 1) {
        ws.send(
          JSON.stringify({
            type: "output",
            session: name,
            lines: filterOutputForDisplay(output.split("\n")),
            status: initStatus,
            promptType: initPromptType,
            promptOptions: initPromptOptions,
            workdir: liveCwd || null,
            branch: git?.branch || null,
            isWorktree: git?.isWorktree || false,
          })
        );
      }
      sessionInfos.push({
        name,
        workdir: liveCwd || meta[name]?.workdir || DEFAULT_WORKDIR,
        created: meta[name]?.created || null,
        branch: git?.branch || null,
        isWorktree: git?.isWorktree || false,
        favorite: meta[name]?.favorite || false,
        minimized: meta[name]?.minimized || false,
      });
    }

    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "sessions", sessions: sessionInfos }));
      // Send initial todo state
      ws.send(JSON.stringify({ type: "todo-update", data: loadTodos() }));
    }
  })();

  // Register this client for shell PTY output
  shellClients.add(ws);
  ws.on("close", () => shellClients.delete(ws));
  // Ensure shell PTY is running and start info polling
  ensureShellPty();
  if (!shellPty) {
    try { ws.send(JSON.stringify({ type: "shell-unavailable" })); } catch {}
  }
  startShellInfoPolling();
  // Replay buffered scrollback as binary chunks (no JSON overhead)
  const scrollback = getShellScrollback();
  if (scrollback) {
    const buf = Buffer.from(scrollback, "utf8");
    const CHUNK = 32768; // 32KB — larger chunks since binary has less per-frame overhead
    if (buf.length <= CHUNK) {
      ws.send(buf);
    } else {
      let offset = 0;
      const sendChunk = () => {
        if (offset >= buf.length || ws.readyState !== 1) return;
        ws.send(buf.subarray(offset, offset + CHUNK));
        offset += CHUNK;
        if (offset < buf.length) setImmediate(sendChunk);
      };
      sendChunk();
    }
  }
  // Send current shell info immediately so pills are populated on connect
  if (_lastShellCwd) {
    // Use cached values — no sync subprocess, instant delivery
    ws.send(JSON.stringify({
      type: "shell-info",
      cwd: _lastShellCwd,
      branch: _lastShellBranch,
      isWorktree: _lastShellIsWorktree,
      prUrl: _lastShellPrUrl !== undefined ? _lastShellPrUrl : null,
    }));
  } else {
    // No cached cwd yet — kick off async lookup
    (async () => {
      const cwd = await getShellCwdAsync();
      if (cwd) {
        _lastShellCwd = cwd;
        const git = await getGitInfoAsync(cwd);
        _lastShellBranch = git?.branch || null;
        _lastShellIsWorktree = git?.isWorktree || false;
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: "shell-info", cwd,
            branch: _lastShellBranch,
            isWorktree: _lastShellIsWorktree,
            prUrl: null,
          }));
        }
        lookupPrUrl(cwd, _lastShellBranch);
      }
    })();
  }

  // Handle incoming messages
  ws.on("message", (data) => {
    try {
      // Binary frame = shell-stdin (hot path — skip JSON.parse entirely)
      if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        if (buf.length > 0 && buf[0] === 0x01) {
          // 0x01 prefix = shell stdin
          ensureShellPty();
          if (shellPty) shellPty.write(buf.toString("utf8", 1));
          return;
        }
      }

      const msg = JSON.parse(data);

      // Validate session name for all message types that use it — prevents injection into tmux commands
      if (msg.session && (typeof msg.session !== "string" || !/^[a-zA-Z0-9_-]+$/.test(msg.session))) {
        return; // silently drop messages with invalid session names
      }

      if (msg.type === "input") {
        const session = `${PREFIX}${msg.session}`;
        // Async tmux lookup — never blocks the event loop (was sync execSync before)
        listTmuxSessionsAsync().then((sessions) => {
          if (sessions.includes(session)) {
            sendKeys(session, msg.text);
            scheduleForceUpdate();
          }
        });
      }

      // Input with image attachments — uses paste-buffer for bracket paste
      if (msg.type === "input-with-images") {
        const session = `${PREFIX}${msg.session}`;
        listTmuxSessionsAsync().then((sessions) => {
          if (sessions.includes(session)) {
            sendKeysWithImages(session, msg.text || "", msg.paths || []);
            scheduleForceUpdate();
          }
        });
      }

      // Raw key names for interactive prompts (arrow keys, Enter, etc.)
      // All keys sent in one tmux command to avoid escape sequence race conditions
      if (msg.type === "keypress") {
        const session = `${PREFIX}${msg.session}`;
        const keys = Array.isArray(msg.keys) ? msg.keys : [msg.keys];
        // Validate all keys against whitelist to prevent command injection
        const validKeys = keys.filter(isValidTmuxKey);
        if (validKeys.length === 0) return;
        listTmuxSessionsAsync().then((sessions) => {
          if (sessions.includes(session)) {
            tmuxExecAsync(`send-keys -t ${session} ${validKeys.join(" ")}`);
            scheduleForceUpdate();
          }
        });
      }

      // --- Shell terminal (node-pty) ---
      if (msg.type === "shell-stdin") {
        ensureShellPty();
        if (shellPty) shellPty.write(msg.data);
      }
      if (msg.type === "shell-resize") {
        if (shellPty && msg.cols && msg.rows) {
          shellPty.resize(Math.max(1, msg.cols), Math.max(1, msg.rows));
        }
      }

      // Client requests a fresh output snapshot (pull-based backup for push failures)
      if (msg.type === "request-refresh") {
        (async () => {
          const session = `${PREFIX}${msg.session}`;
          const sessions = await listTmuxSessionsAsync();
          if (sessions.includes(session)) {
            const output = await capturePaneAsync(session);
            if (output) {
              const prev = prevOutputs.get(session) || "";
              const status = detectStatus(output, prev);
              const filteredOutput = stripCeoPreamble(output);
              const promptType = status === "waiting" ? detectPromptType(filteredOutput) : null;
              const promptOptions = promptType === "question" ? parsePromptOptions(filteredOutput) : null;
              const liveCwd = await getEffectiveCwdAsync(session, output);
              const git = await getCachedGitInfo(liveCwd);
              prevOutputs.set(session, output);
              if (ws.readyState === 1) {
                ws.send(JSON.stringify({
                  type: "output",
                  session: msg.session,
                  lines: filterOutputForDisplay(output.split("\n")),
                  status,
                  promptType,
                  promptOptions,
                  workdir: liveCwd || null,
                  branch: git?.branch || null,
                  isWorktree: git?.isWorktree || false,
                }));
              }
            }
          }
        })();
      }

      // Live input sync — relay textarea keystrokes to all other clients
      if (msg.type === "input-sync") {
        const payload = JSON.stringify({ type: "input-sync", session: msg.session, text: msg.text });
        wss.clients.forEach((client) => {
          if (client !== ws && client.readyState === 1) client.send(payload);
        });
      }


      // Select a numbered option then type a free-text response
      // Navigates to the option, waits for TUI transition, then types the text
      if (msg.type === "type-option") {
        const session = `${PREFIX}${msg.session}`;
        listTmuxSessionsAsync().then((sessions) => {
          if (sessions.includes(session)) {
            const navKeys = Array.isArray(msg.keys) ? msg.keys : [msg.keys];
            // Validate navigation keys against whitelist
            const validNavKeys = navKeys.filter(isValidTmuxKey);
            if (validNavKeys.length > 0) {
              tmuxExecAsync(`send-keys -t ${session} ${validNavKeys.join(" ")}`);
            }
            // Wait for TUI to transition to text input mode, then type the response
            setTimeout(() => {
              sendKeys(session, msg.text);
            }, 400);
            scheduleForceUpdate();
          }
        });
      }
    } catch {
      // ignore malformed messages
    }
  });

  ws.on("close", () => {
    // Client disconnected — global poll handles cleanup automatically
  });
});

// Single global poll — broadcasts to ALL connected clients
setInterval(() => {
  broadcastOutputs();
}, POLL_INTERVAL);

// --- Restore sessions on startup ---

function restoreSessions() {
  const meta = loadSessionsMeta();
  const liveSessions = listTmuxSessions();
  const liveNames = new Set(liveSessions.map((s) => s.replace(PREFIX, "")));
  let restored = 0;
  let kept = 0;

  for (const [name, info] of Object.entries(meta)) {
    // tmux session still alive (survives server restarts) — keep it, no recreation needed
    if (liveNames.has(name)) {
      kept++;
      // Try to backfill session ID if missing
      if (!info.resumeSessionId) {
        const workdir = info.workdir || DEFAULT_WORKDIR;
        const sessionId = detectClaudeSessionIdForAgent(workdir, info.created);
        if (sessionId) {
          info.resumeSessionId = sessionId;
        }
      }
      continue;
    }

    const dir = info.workdir || DEFAULT_WORKDIR;
    const session = `${PREFIX}${name}`;

    // Validate workdir before using in shell commands
    if (!isValidWorkdir(dir)) {
      console.warn(`[restore] Skipping agent "${name}" — invalid workdir: ${dir}`);
      delete meta[name];
      continue;
    }

    // Try to detect session ID if we don't have one yet
    if (!info.resumeSessionId) {
      const sessionId = detectClaudeSessionIdForAgent(dir, info.created);
      if (sessionId) {
        info.resumeSessionId = sessionId;
      }
    }

    // Validate session ID if present
    if (info.resumeSessionId && !isValidSessionId(info.resumeSessionId)) {
      console.warn(`[restore] Skipping agent "${name}" — invalid session ID`);
      delete meta[name];
      continue;
    }

    // Build restore command — resume if we have a Claude session ID, otherwise bare claude
    let claudeCmd;
    if (info.resumeSessionId) {
      claudeCmd = `claude --resume ${info.resumeSessionId}`;
    } else {
      claudeCmd = "claude";
    }
    try {
      execSync(
        `tmux new-session -d -s ${session} -x 120 -y 50 -c ${shellQuote(dir)}`,
        { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
      );
      tmuxExec(`send-keys -t ${session} "clear && unset CLAUDECODE && ${claudeCmd}" Enter`);
      restored++;
    } catch {
      // Failed to restore — remove stale entry
      delete meta[name];
    }
  }

  saveSessionsMeta(meta);
  if (kept > 0) console.log(`Kept ${kept} live agent session(s)`);
  if (restored > 0) console.log(`Restored ${restored} agent session(s)`);
}

// --- Start ---

// --- Embedded shell terminal (node-pty) ---
let shellPty = null;
const shellClients = new Set(); // WebSocket clients subscribed to shell output

// Scrollback: use array of chunks instead of string concatenation (avoids GC pressure)
const _shellScrollChunks = [];
let _shellScrollSize = 0;
const SHELL_SCROLLBACK_LIMIT = 50000; // ~50KB — enough for replay, less GC pressure

function getShellScrollback() {
  return _shellScrollChunks.join("");
}
function appendShellScrollback(data) {
  _shellScrollChunks.push(data);
  _shellScrollSize += data.length;
  // Compact more frequently to avoid big GC spikes (was 1.5x, now 1.2x)
  if (_shellScrollSize > SHELL_SCROLLBACK_LIMIT * 1.2) {
    const full = _shellScrollChunks.join("").slice(-SHELL_SCROLLBACK_LIMIT);
    _shellScrollChunks.length = 0;
    _shellScrollChunks.push(full);
    _shellScrollSize = full.length;
  }
}
function clearShellScrollback() {
  _shellScrollChunks.length = 0;
  _shellScrollSize = 0;
}

// Adaptive data broadcast: send first chunk immediately (zero latency for keystrokes),
// then batch subsequent chunks during bursts (avoids JSON spam during heavy output).
let _shellBatchChunks = [];
let _shellBatchTimer = null;
let _shellLastSend = 0;
const SHELL_BATCH_MS = 4; // batch window during bursts

function sendShellData(data) {
  if (shellClients.size === 0) return;
  // Binary WebSocket frame — eliminates JSON.stringify/parse overhead on the hot path.
  // Client detects binary frames via `event.data instanceof ArrayBuffer`.
  const buf = Buffer.from(data, "utf8");
  for (const client of shellClients) {
    // Backpressure: skip send if client buffer exceeds 1MB to prevent memory buildup
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

function ensureShellPty() {
  if (shellPty) return;
  if (!pty) return; // node-pty not available
  // Fix spawn-helper permissions (node-pty prebuilds ship without +x on some platforms)
  try {
    const helper = path.join(__dirname, "node_modules", "node-pty", "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper");
    const st = fs.statSync(helper);
    if (!(st.mode & 0o111)) { fs.chmodSync(helper, st.mode | 0o755); console.log("[shell] Fixed spawn-helper permissions"); }
  } catch {}
  // Use configured workdir, fall back to home if it doesn't exist
  let cwd = SHELL_WORKDIR;
  try { if (!fs.statSync(cwd).isDirectory()) cwd = os.homedir(); } catch { cwd = os.homedir(); }
  // Try user's shell, then common fallbacks
  const shells = [process.env.SHELL, "/bin/zsh", "/bin/bash", "/bin/sh"].filter(Boolean);
  for (const shell of shells) {
    try {
      if (!fs.existsSync(shell)) continue;
      shellPty = pty.spawn(shell, ["-l"], {
        name: "xterm-256color",
        cols: 120,
        rows: 24,
        cwd,
        env: { ...process.env, TERM: "xterm-256color" },
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

  // Inject precmd hook that emits OSC 7 (cwd reporting) after every command.
  // Idempotent — checks if already defined before adding to hook arrays.
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

  // Override `open` command so URLs route through the dashboard instead of spawning a browser directly.
  // Only intercepts bare http(s) URLs (single arg, no flags). Everything else passes to /usr/bin/open.
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

  // Immediately populate cwd/branch via lsof (doesn't depend on OSC 7)
  setTimeout(() => {
    if (shellPty && !_lastShellCwd) {
      broadcastShellInfo(true);
    }
  }, 1200);

  let _osc7Buffer = ""; // Buffer for fragmented OSC 7 sequences
  let _osc7GitTimer = null; // Debounce timer for async git lookup

  shellPty.onData((data) => {
    // Adaptive send: immediate if idle (keystrokes), batch during bursts (command output)
    const now = Date.now();
    if (now - _shellLastSend >= SHELL_BATCH_MS) {
      // Idle — send immediately for zero-latency keystroke echo
      if (_shellBatchChunks.length) {
        // Flush any pending batch first, combined with new data
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
      // Burst — accumulate and schedule flush
      _shellBatchChunks.push(data);
      if (!_shellBatchTimer) {
        _shellBatchTimer = setTimeout(flushShellBatch, SHELL_BATCH_MS);
      }
    }

    // Append to scrollback (chunked array — no string concat GC pressure)
    appendShellScrollback(data);

    // OSC 7 parsing — only when data contains the escape prefix
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
        }, 150); // 150ms debounce — avoids git lock contention during rapid operations
      }
    }
  });

  shellPty.onExit(() => {
    console.log("[shell] PTY exited, will respawn on next use");
    shellPty = null;
    clearShellScrollback();
    sendShellData("\r\n[Shell exited. Reopening will start a new session.]\r\n");
  });
}

// Shell info state
let _shellInfoInterval = null;
let _lastShellCwd = null;
let _lastShellBranch = null;
let _lastShellIsWorktree = false;
let _lastShellPrUrl = undefined; // undefined = not yet checked, null = no PR, string = URL
let _prLookupBranch = null; // branch we last looked up PR for

// Single helper to broadcast current shell-info to all clients
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
  if (userConfig.prLinkStyle === "github") return ghUrl;
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
  // Poll every 5s — OSC 7 handles most cwd/branch changes instantly,
  // this is just a fallback for edge cases. Avoids lsof+git contention.
  _shellInfoInterval = setInterval(() => broadcastShellInfo(false), 5000);
}

// Prevent macOS sleep while server is running (caffeinate -s = AC power, -i = idle sleep)
// Dies automatically when this process exits (child of this process)
let caffeinateProc = null;
function startCaffeinate() {
  try {
    caffeinateProc = spawn("caffeinate", ["-s", "-i"], {
      stdio: "ignore",
      detached: false,
    });
    caffeinateProc.on("error", () => {}); // ignore spawn errors
    caffeinateProc.on("exit", () => { caffeinateProc = null; });
    console.log("[caffeinate] Sleep prevention active (pid " + caffeinateProc.pid + ")");
  } catch {}
}
function stopCaffeinate() {
  if (caffeinateProc) {
    caffeinateProc.kill();
    caffeinateProc = null;
    console.log("[caffeinate] Sleep prevention stopped");
  }
}
process.on("exit", stopCaffeinate);
process.on("SIGINT", () => { stopCaffeinate(); process.exit(); });
process.on("SIGTERM", () => { stopCaffeinate(); process.exit(); });

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.log(`Port ${PORT} still in use, force-killing and retrying...`);
    try {
      const { execFileSync } = require("child_process");
      const pids = execFileSync("lsof", ["-ti", `:${PORT}`, "-sTCP:LISTEN"], { encoding: "utf8", timeout: 5000 }).trim();
      if (pids) {
        for (const pid of pids.split("\n").filter(Boolean)) {
          if (/^\d+$/.test(pid)) {
            try { process.kill(Number(pid), "SIGKILL"); } catch {}
          }
        }
      }
    } catch {}
    setTimeout(() => server.listen(PORT, BIND_HOST), 1000);
  } else {
    console.error("Server error:", err);
    process.exit(1);
  }
});

server.listen(PORT, BIND_HOST, () => {
  console.log(`CEO Dashboard running at http://${BIND_HOST}:${PORT}`);
  // Ensure required directories exist (covers users who skipped setup or had partial setup)
  for (const dir of [path.join(__dirname, "docs"), path.join(os.homedir(), ".claude", "docs")]) {
    try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch {}
  }
  startCaffeinate();
  ensureTmuxServer();
  // Clean up old tmux shell session (replaced by node-pty)
  try { tmuxExec("kill-session -t _ceo_shell"); } catch {}
  ensureShellPty();
  startShellInfoPolling();
  restoreSessions();
  // Run initial session ID sync after agents have had time to create their .jsonl files
  setTimeout(() => { lastSessionIdSync = 0; syncClaudeSessionIds(); }, 10000);
  // Warm the Claude sessions cache so the first modal open is instant
  setTimeout(() => { loadClaudeSessionsAsync(null).catch(() => {}); }, 2000);
});

// --- Hot reload: watch public/ for changes, notify browsers via WebSocket ---
// Defers reload until no agent working in ceo-dashboard is actively running,
// so vibe-coded changes only reload once Claude is done editing.
let hotReloadVersion = Date.now(); // bumped on each reload, clients poll on reconnect

app.get("/api/version", (req, res) => {
  res.json({ version: hotReloadVersion });
});

{
  const publicDir = path.join(__dirname, "public");
  let pendingReload = false;
  let reloadDebounce = null;

  function isAnyCeoDashboardAgentBusy() {
    const meta = loadSessionsMeta();
    const sessions = listTmuxSessions();
    for (const session of sessions) {
      const name = session.replace(PREFIX, "");
      const info = meta[name];
      if (!info) continue;
      const workdir = info.workdir || DEFAULT_WORKDIR;
      if (!workdir.includes("ceo-dashboard")) continue;
      // Treat working, waiting (tool prompts), and asking as still busy.
      // Agents cycle through working→waiting→working between edits;
      // only reload when they're fully idle.
      const output = prevOutputs.get(session) || "";
      if (output) {
        const status = detectStatus(output, "");
        if (status !== "idle") return true;
      }
    }
    return false;
  }

  function doReload() {
    if (!pendingReload) return;
    if (isAnyCeoDashboardAgentBusy()) return; // still busy — poll will retry
    pendingReload = false;
    hotReloadVersion = Date.now();
    console.log("[hot-reload] agents done, reloading browsers");
    for (const client of wss.clients) {
      if (client.readyState === 1) {
        client.send(JSON.stringify({ type: "reload" }));
      }
    }
  }

  // Check every poll cycle if a pending reload can fire
  const origBroadcast = broadcastOutputs;
  broadcastOutputs = function () {
    origBroadcast();
    if (pendingReload) doReload();
  };

  fs.watch(publicDir, { recursive: true }, (eventType, filename) => {
    if (!filename) return;
    if (reloadDebounce) clearTimeout(reloadDebounce);
    reloadDebounce = setTimeout(() => {
      pendingReload = true;
      doReload(); // try immediately — if agent is idle, reload now
    }, 300);
  });
}
