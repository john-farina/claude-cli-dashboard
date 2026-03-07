const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const { execSync, exec, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
let pty;
try {
  pty = require("node-pty");
} catch (e) {
  console.error("[shell] node-pty failed to load: " + e.message);
  console.error("[shell] Embedded terminal will be unavailable. Run: npm rebuild node-pty");
  pty = null;
}

// --- Lib modules ---
const security = require("./lib/security");
const tmux = require("./lib/tmux");
const { getGitInfo, getGitInfoAsync, getCachedGitInfo } = require("./lib/git");
const {
  stripAnsi, isSeparatorLine, filterCeoPreamble, stripCeoPreamble,
  filterOutputForDisplay, detectStatus, detectPromptType, parsePromptOptions,
} = require("./lib/output");
const sessionMod = require("./lib/session");
const claudeSessions = require("./lib/claude-sessions");
const updateMod = require("./lib/update");
const { createScrollback, getScrollback, appendScrollback, clearScrollback } = require("./lib/scrollback");
const terminalCards = require("./lib/terminal-cards");
const shellPtyMod = require("./lib/shell-pty");
const fileTracker = require("./lib/file-tracker");

// Destructure security
const {
  refreshTailscaleIPs, isAllowedIP, verifyWsClient,
  isValidTmuxKey, isSafePathSegment, isWithinDir, isValidWorkdir,
  isValidAgentName, isValidSessionId, shellQuote,
} = security;

// Destructure tmux
const {
  ensureTmuxServer, tmuxExec, tmuxExecAsync,
  listTmuxSessions, invalidateTmuxSessionsCache, listTmuxSessionsAsync,
  capturePaneAsync, capturePane, sendKeys, sendKeysWithImages,
  getEffectiveCwd, getEffectiveCwdAsync, clearWorktreeCache,
} = tmux;

// Destructure session
const { loadSessionsMeta, saveSessionsMeta, createSession, killSession, restoreSessions } = sessionMod;

// Destructure claude-sessions
const { loadClaudeSessions, loadClaudeSessionsAsync, detectClaudeSessionIdForAgent, syncClaudeSessionIds } = claudeSessions;

// Destructure update
const { compareVersions, getUpstreamRemote, checkForUpdate, getUpdateCache } = updateMod;

// Destructure terminal-cards
const { terminalPtys, attachTerminalClient, detachTerminalClient, writeTerminalStdin, resizeTerminalPty } = terminalCards;

// Destructure shell-pty
const {
  ensureShellPty, startShellInfoPolling, broadcastShellInfo, broadcastShellInfoMsg,
  sendShellData, toPrUrl, lookupPrUrl, getShellCwdAsync,
  getShellPty, getShellClients, getShellScrollback,
  getLastShellCwd, getLastShellBranch, getLastShellIsWorktree, getLastShellPrUrl,
} = shellPtyMod;

const app = express();
const server = http.createServer(app);

// --- User config ---
const CONFIG_PATH = path.join(__dirname, "config.json");
let userConfig;
let _configMissing = false;
try {
  userConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
} catch {
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
const BIND_HOST = "0.0.0.0";
process.env.BROWSER = path.join(__dirname, "open-url.sh");
const PREFIX = userConfig.agentPrefix || "ceo-";
const DEFAULT_WORKDIR = userConfig.defaultWorkspace || os.homedir();
const SESSIONS_FILE = path.join(__dirname, "sessions.json");
const CLAUDE_DIR = path.join(os.homedir(), ".claude", "projects");
const DOCS_DIR = path.join(__dirname, "docs");
const CEO_MD_PATH = path.join(__dirname, "claude-ceo.md");
const TODOS_FILE = path.join(__dirname, "todos.json");
const FAVORITES_FILE = path.join(__dirname, "favorites.json");
const TOKEN_USAGE_FILE = path.join(__dirname, "token-usage.json");
const POLL_INTERVAL = 300;
const SHELL_WORKDIR = DEFAULT_WORKDIR || os.homedir();
const UPLOADS_DIR = path.join(os.tmpdir(), "ceo-dashboard-uploads");
const MIN_DASHBOARD_VERSION = "v0.3.5";

// --- Security setup ---
refreshTailscaleIPs();
setInterval(refreshTailscaleIPs, 60000);
app.use(security.ipMiddleware());

const wss = new WebSocketServer({ server, verifyClient: verifyWsClient, maxPayload: 5 * 1024 * 1024 });

// --- Initialize lib modules ---
tmux.init({ PREFIX, UPLOADS_DIR });
sessionMod.init({ PREFIX, DEFAULT_WORKDIR, SESSIONS_FILE, DOCS_DIR, CEO_MD_PATH, terminalPtys });
claudeSessions.init({ CLAUDE_DIR, DEFAULT_WORKDIR, loadSessionsMeta, saveSessionsMeta });
updateMod.init({ rootDir: __dirname, configPath: CONFIG_PATH, userConfig, wss, MIN_DASHBOARD_VERSION });
terminalCards.init({ pty, PREFIX });

// --- Shell Debug Log (needed before shell-pty init) ---
const SHELL_LOG_FILE = path.join(__dirname, "shell-debug.log");
const _shellLog = [];
const SHELL_LOG_MAX = 500;

function shellLog(type, data) {
  const entry = { ts: new Date().toISOString(), type, ...data };
  _shellLog.push(entry);
  if (_shellLog.length > SHELL_LOG_MAX) _shellLog.shift();
  fs.appendFile(SHELL_LOG_FILE, JSON.stringify(entry) + "\n", () => {});
}

shellPtyMod.init({ pty, PORT, SHELL_WORKDIR, userConfig, shellLog });

// --- Helper constants & functions ---

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

function loadFavorites() {
  try {
    return JSON.parse(fs.readFileSync(FAVORITES_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveFavorites(data) {
  fs.writeFileSync(FAVORITES_FILE, JSON.stringify(data, null, 2));
}

function broadcastFavorites() {
  const data = loadFavorites();
  const msg = JSON.stringify({ type: "favorites-update", data });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(msg);
  });
}

function generateFavId() {
  return "f" + Math.random().toString(36).slice(2, 8);
}

function ensureDocsDir() {
  if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });
}

// --- Token usage tracking ---
const _tokenUsageCache = new Map();
const _dailyByDayCache = new Map(); // sid -> { size, byDay } for parseTokenUsageByDay caching
let _tokenUsageTotals = {};

function loadTokenUsage() {
  try {
    const data = JSON.parse(fs.readFileSync(TOKEN_USAGE_FILE, "utf8"));
    // Migrate legacy flat per-agent entries into data.agents
    if (!data.agents) data.agents = {};
    let migrated = false;
    for (const key of Object.keys(data)) {
      if (key === "agents" || key === "daily") continue;
      if (data[key] && typeof data[key] === "object" && data[key].sessionId) {
        data.agents[key] = data[key];
        delete data[key];
        migrated = true;
      }
    }
    if (!data.daily) data.daily = {};
    if (migrated) {
      try { fs.writeFileSync(TOKEN_USAGE_FILE, JSON.stringify(data, null, 2)); } catch {}
    }
    return data;
  } catch {
    return { agents: {}, daily: {} };
  }
}

function saveTokenUsage(data) {
  fs.writeFileSync(TOKEN_USAGE_FILE, JSON.stringify(data, null, 2));
}

// Snapshot a killed agent's per-day token contributions into killedDaily
// Must be called BEFORE the agent is removed from sessions.json
function snapshotKilledAgentTokens(name) {
  try {
    const meta = loadSessionsMeta();
    const agentInfo = meta[name];
    const sid = agentInfo?.resumeSessionId;
    if (!sid) return;
    const filePath = findJsonlFileForSession(sid);
    if (!filePath) return;
    const byDay = parseTokenUsageByDay(filePath);
    if (Object.keys(byDay).length === 0) return;
    const tokenData = loadTokenUsage();
    tokenData.killedDaily = tokenData.killedDaily || {};
    for (const [dayKey, dayUsage] of Object.entries(byDay)) {
      const existing = tokenData.killedDaily[dayKey] || { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
      existing.input += dayUsage.input;
      existing.output += dayUsage.output;
      existing.cacheCreation += dayUsage.cacheCreation;
      existing.cacheRead += dayUsage.cacheRead;
      tokenData.killedDaily[dayKey] = existing;
    }
    saveTokenUsage(tokenData);
  } catch (e) {
    console.error(`[token snapshot] Failed to snapshot tokens for killed agent ${name}:`, e.message);
  }
}

function findJsonlFileForSession(sessionId) {
  if (!sessionId) return null;
  try {
    const projectDirs = fs.readdirSync(CLAUDE_DIR);
    for (const dir of projectDirs) {
      const filePath = path.join(CLAUDE_DIR, dir, sessionId + ".jsonl");
      try {
        fs.accessSync(filePath);
        return filePath;
      } catch {}
    }
  } catch {}
  return null;
}

function parseTokenUsageFromBytes(buf, byteLength) {
  const str = buf.toString("utf8", 0, byteLength);
  const lines = str.split("\n");
  let input = 0, output = 0, cacheCreation = 0, cacheRead = 0;
  for (const line of lines) {
    if (!line || !line.includes('"usage"')) continue;
    try {
      const d = JSON.parse(line);
      const u = d.message?.usage;
      if (!u) continue;
      input += u.input_tokens || 0;
      output += u.output_tokens || 0;
      cacheCreation += u.cache_creation_input_tokens || 0;
      cacheRead += u.cache_read_input_tokens || 0;
    } catch {}
  }
  return { input, output, cacheCreation, cacheRead };
}

function parseTokenUsageByDay(filePath) {
  const daily = {};
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    for (const line of lines) {
      if (!line || !line.includes('"usage"')) continue;
      try {
        const d = JSON.parse(line);
        const u = d.message?.usage;
        if (!u) continue;
        const ts = d.timestamp;
        if (!ts) continue;
        const dt = new Date(ts);
        if (isNaN(dt.getTime())) continue;
        const dayKey = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
        const day = daily[dayKey] || { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
        day.input += u.input_tokens || 0;
        day.output += u.output_tokens || 0;
        day.cacheCreation += u.cache_creation_input_tokens || 0;
        day.cacheRead += u.cache_read_input_tokens || 0;
        daily[dayKey] = day;
      } catch {}
    }
  } catch {}
  return daily;
}

function getTokenUsageForSession(sessionId) {
  const filePath = findJsonlFileForSession(sessionId);
  if (!filePath) return null;
  let stat;
  try { stat = fs.statSync(filePath); } catch { return null; }
  const cached = _tokenUsageCache.get(sessionId);
  if (cached && cached.bytesRead >= stat.size) return cached.usage;
  const startOffset = cached ? cached.bytesRead : 0;
  const newBytes = stat.size - startOffset;
  if (newBytes <= 0) return cached?.usage || null;
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(newBytes);
    fs.readSync(fd, buf, 0, newBytes, startOffset);
    const delta = parseTokenUsageFromBytes(buf, newBytes);
    const prev = cached?.usage || { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
    const usage = {
      input: prev.input + delta.input,
      output: prev.output + delta.output,
      cacheCreation: prev.cacheCreation + delta.cacheCreation,
      cacheRead: prev.cacheRead + delta.cacheRead,
    };
    _tokenUsageCache.set(sessionId, { bytesRead: stat.size, usage });
    return usage;
  } finally {
    fs.closeSync(fd);
  }
}

function syncTokenUsage() {
  const meta = loadSessionsMeta();
  const saved = loadTokenUsage();
  saved.agents = saved.agents || {};
  let changed = false;

  // --- Per-agent cumulative totals (incremental, session-aware) ---
  for (const [name, info] of Object.entries(meta)) {
    if (info.type === "terminal") continue;
    const sessionId = info.resumeSessionId;
    if (!sessionId) continue;
    const usage = getTokenUsageForSession(sessionId);
    if (!usage) continue;
    const prev = saved.agents[name];
    const sameSession = prev && prev.sessionId === sessionId;
    const prevSU = sameSession && prev?._sessionUsage;
    const sessionChanged = !sameSession
      || !prevSU
      || prevSU.input !== usage.input || prevSU.output !== usage.output
      || prevSU.cacheCreation !== usage.cacheCreation || prevSU.cacheRead !== usage.cacheRead;
    if (sessionChanged) {
      if (sameSession && prevSU) {
        const delta = {
          input: Math.max(0, usage.input - prevSU.input),
          output: Math.max(0, usage.output - prevSU.output),
          cacheCreation: Math.max(0, usage.cacheCreation - prevSU.cacheCreation),
          cacheRead: Math.max(0, usage.cacheRead - prevSU.cacheRead),
        };
        saved.agents[name] = {
          input: (prev.input || 0) + delta.input,
          output: (prev.output || 0) + delta.output,
          cacheCreation: (prev.cacheCreation || 0) + delta.cacheCreation,
          cacheRead: (prev.cacheRead || 0) + delta.cacheRead,
          sessionId,
          _sessionUsage: { ...usage },
        };
      } else {
        // New session or missing baseline — set baseline, don't guess deltas
        const prevTotal = prev ? {
          input: prev.input || 0, output: prev.output || 0,
          cacheCreation: prev.cacheCreation || 0, cacheRead: prev.cacheRead || 0,
        } : { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
        saved.agents[name] = {
          input: prevTotal.input + usage.input,
          output: prevTotal.output + usage.output,
          cacheCreation: prevTotal.cacheCreation + usage.cacheCreation,
          cacheRead: prevTotal.cacheRead + usage.cacheRead,
          sessionId,
          _sessionUsage: { ...usage },
        };
      }
      changed = true;
    }
  }

  // --- Daily buckets: rebuild from JSONL ground truth (cached by file size) ---
  const daily = {};
  const seen = new Set();
  let dailyChanged = false;
  for (const [name, info] of Object.entries(meta)) {
    if (info.type === "terminal") continue;
    const sid = info.resumeSessionId;
    if (!sid || seen.has(sid)) continue;
    seen.add(sid);
    const filePath = findJsonlFileForSession(sid);
    if (!filePath) continue;
    // Use size-based cache to avoid re-parsing unchanged files
    let stat;
    try { stat = fs.statSync(filePath); } catch { continue; }
    const cacheEntry = _dailyByDayCache.get(sid);
    let byDay;
    if (cacheEntry && cacheEntry.size === stat.size) {
      byDay = cacheEntry.byDay;
    } else {
      byDay = parseTokenUsageByDay(filePath);
      _dailyByDayCache.set(sid, { size: stat.size, byDay });
      dailyChanged = true;
    }
    for (const [dayKey, dayUsage] of Object.entries(byDay)) {
      const existing = daily[dayKey] || { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
      existing.input += dayUsage.input;
      existing.output += dayUsage.output;
      existing.cacheCreation += dayUsage.cacheCreation;
      existing.cacheRead += dayUsage.cacheRead;
      daily[dayKey] = existing;
    }
  }
  // Merge daily: killedDaily (snapshotted at kill time) + live agents' JSONL ground truth
  const killedDaily = saved.killedDaily || {};
  const mergedDaily = {};
  // 1. Start with killed agents' snapshotted contributions
  for (const [dayKey, kd] of Object.entries(killedDaily)) {
    mergedDaily[dayKey] = { ...kd };
  }
  // 2. Add live agents' JSONL ground truth on top
  for (const [dayKey, dayUsage] of Object.entries(daily)) {
    const existing = mergedDaily[dayKey] || { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
    existing.input += dayUsage.input;
    existing.output += dayUsage.output;
    existing.cacheCreation += dayUsage.cacheCreation;
    existing.cacheRead += dayUsage.cacheRead;
    mergedDaily[dayKey] = existing;
  }
  // Apply reset offsets (subtract tokens cleared by user)
  const offsets = saved.dailyOffset || {};
  for (const [dayKey, offset] of Object.entries(offsets)) {
    const day = mergedDaily[dayKey];
    if (day) {
      day.input = Math.max(0, day.input - offset.input);
      day.output = Math.max(0, day.output - offset.output);
      day.cacheCreation = Math.max(0, day.cacheCreation - offset.cacheCreation);
      day.cacheRead = Math.max(0, day.cacheRead - offset.cacheRead);
    }
  }
  if (dailyChanged) changed = true;
  saved.daily = mergedDaily;

  if (changed) {
    saveTokenUsage(saved);
  }
  _tokenUsageTotals = saved;
  return saved;
}

function broadcastTokenUsage() {
  const usage = syncTokenUsage();
  const message = JSON.stringify({ type: "token-usage", usage });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(message);
  });
}

// --- Slash commands ---
// Built-in Claude Code slash commands (stable across versions)
const BUILTIN_COMMANDS = [
  { name: "/agents", description: "List configured agents" },
  { name: "/bug", description: "Report a bug" },
  { name: "/chrome", description: "Toggle Chrome integration" },
  { name: "/clear", description: "Clear conversation history" },
  { name: "/commit", description: "Commit changes" },
  { name: "/compact", description: "Compact conversation to save context" },
  { name: "/config", description: "Open settings configuration" },
  { name: "/cost", description: "Show token usage and cost" },
  { name: "/doctor", description: "Check health of your installation" },
  { name: "/fast", description: "Toggle fast mode" },
  { name: "/help", description: "Get help with Claude Code" },
  { name: "/hooks", description: "View and manage hooks" },
  { name: "/ide", description: "Connect to IDE" },
  { name: "/init", description: "Initialize project with CLAUDE.md" },
  { name: "/login", description: "Switch authentication method" },
  { name: "/logout", description: "Sign out of your account" },
  { name: "/mcp", description: "Configure and manage MCP servers" },
  { name: "/memory", description: "View CLAUDE.md memory files" },
  { name: "/model", description: "Switch AI model" },
  { name: "/permissions", description: "View and manage permissions" },
  { name: "/plugin", description: "Manage Claude Code plugins" },
  { name: "/review", description: "Review a pull request" },
  { name: "/status", description: "Show session status" },
  { name: "/terminal-setup", description: "Setup terminal integration" },
  { name: "/vim", description: "Toggle vim keybindings" },
];

function scanCommandDir(dir, commands, label) {
  try {
    for (const file of fs.readdirSync(dir)) {
      if (file.endsWith(".md")) {
        const name = "/" + file.replace(".md", "");
        if (!commands.find((c) => c.name === name)) {
          commands.push({ name, description: label, custom: true });
        }
      }
    }
  } catch {}
}

function getPluginCommands() {
  const commands = [];
  const pluginsFile = path.join(os.homedir(), ".claude", "plugins", "installed_plugins.json");
  try {
    const data = JSON.parse(fs.readFileSync(pluginsFile, "utf8"));
    const plugins = data.plugins || {};
    for (const [key, installs] of Object.entries(plugins)) {
      const pluginName = key.split("@")[0]; // e.g. "superpowers" from "superpowers@claude-plugins-official"
      for (const install of installs) {
        // Scan commands/ directory for slash commands
        const cmdDir = path.join(install.installPath, "commands");
        try {
          const files = fs.readdirSync(cmdDir, { withFileTypes: true });
          for (const entry of files) {
            if (entry.isFile() && entry.name.endsWith(".md")) {
              const cmdName = entry.name.replace(".md", "");
              const name = `/${pluginName}:${cmdName}`;
              if (!commands.find((c) => c.name === name)) {
                commands.push({ name, description: `${pluginName} plugin`, custom: true, plugin: pluginName });
              }
            } else if (entry.isDirectory()) {
              // Nested commands like commands/tasks/build.md → /plugin:tasks:build
              try {
                for (const sub of fs.readdirSync(path.join(cmdDir, entry.name))) {
                  if (sub.endsWith(".md")) {
                    const subName = sub.replace(".md", "");
                    const name = `/${pluginName}:${entry.name}:${subName}`;
                    if (!commands.find((c) => c.name === name)) {
                      commands.push({ name, description: `${pluginName} plugin`, custom: true, plugin: pluginName });
                    }
                  }
                }
              } catch {}
            }
          }
        } catch {}
        // Scan skills/ directory — each subdir with a SKILL.md becomes a slash command
        const skillsDir = path.join(install.installPath, "skills");
        try {
          for (const skillEntry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
            if (!skillEntry.isDirectory()) continue;
            const skillPath = path.join(skillsDir, skillEntry.name);
            // Skills can be nested: skills/<namespace>/<skill-name>/SKILL.md
            if (fs.existsSync(path.join(skillPath, "SKILL.md"))) {
              const name = `/${pluginName}:${skillEntry.name}`;
              if (!commands.find((c) => c.name === name)) {
                commands.push({ name, description: `${pluginName} skill`, custom: true, plugin: pluginName });
              }
            } else {
              // Check one level deeper for namespaced skills
              try {
                for (const nested of fs.readdirSync(skillPath, { withFileTypes: true })) {
                  if (nested.isDirectory() && fs.existsSync(path.join(skillPath, nested.name, "SKILL.md"))) {
                    const name = `/${pluginName}:${nested.name}`;
                    if (!commands.find((c) => c.name === name)) {
                      commands.push({ name, description: `${pluginName} skill`, custom: true, plugin: pluginName });
                    }
                  }
                }
              } catch {}
            }
          }
        } catch {}
      }
    }
  } catch {}
  return commands;
}

function getSlashCommands() {
  const commands = [...BUILTIN_COMMANDS];
  scanCommandDir(path.join(os.homedir(), ".claude", "commands"), commands, "Custom command");
  scanCommandDir(path.join(DEFAULT_WORKDIR, ".claude", "commands"), commands, "Project command");
  // Add plugin commands
  for (const cmd of getPluginCommands()) {
    if (!commands.find((c) => c.name === cmd.name)) {
      commands.push(cmd);
    }
  }
  commands.sort((a, b) => a.name.localeCompare(b.name));
  return commands;
}

// --- Notification helper ---
const DASHBOARD_TITLE = "CEO Dashboard";
function sendNotification(subtitle, body) {
  const sanitize = (s) => (s || "").replace(/[\x00-\x1f\x7f]/g, "").slice(0, 500);
  const escAS = (s) => sanitize(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const subtitlePart = subtitle ? ` subtitle "${escAS(subtitle)}"` : "";
  try {
    const script = `display notification "${escAS(body)}" with title "${escAS(DASHBOARD_TITLE)}"${subtitlePart} sound name "default"`;
    require("child_process").execFileSync("osascript", ["-e", script], { timeout: 3000, stdio: "ignore" });
  } catch {}
  const browserTitle = subtitle ? `${DASHBOARD_TITLE} — ${subtitle}` : DASHBOARD_TITLE;
  const msg = JSON.stringify({ type: "native-notification", title: browserTitle, body: sanitize(body), tag: "agent-" + Date.now() });
  wss.clients.forEach((c) => { if (c.readyState === 1) c.send(msg); });
}

// --- Native app path ---
function getNativeAppDir() {
  const title = userConfig.title || "CEO Dashboard";
  return path.join(os.homedir(), "Applications", `${title}.app`);
}

// --- .claude File Browser helpers ---
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
          results.push({ name: entry, path: entryPath, size: stat.size, modified: stat.mtime.toISOString() });
        }
      } catch {}
    }
  } catch {}
  return results.sort((a, b) => new Date(b.modified) - new Date(a.modified));
}

// --- Focus Theft Debug Log ---
const _focusLogEntries = [];
const FOCUS_LOG_MAX = 500;
const FOCUS_LOG_FILE = path.join(__dirname, "focus-debug.log");

// --- URL Opener ---
const URL_OPENER_PATH = path.join(os.homedir(), ".local", "bin", "open");
const URL_OPENER_SCRIPT = `#!/bin/bash
# CEO Dashboard wrapper for /usr/bin/open
# Only intercepts HTTP(S) URLs when running inside the dashboard's embedded terminal.
# All other contexts pass through to the real /usr/bin/open immediately.

if [[ "$CEO_DASHBOARD" == "1" && $# -eq 1 && "$1" =~ ^https?:// ]]; then
  if curl -s -f -X POST http://localhost:${PORT}/api/shell/open-url \\
    -H 'Content-Type: application/json' \\
    -d "{\\"url\\":\\"$1\\"}" > /dev/null 2>&1; then
    exit 0
  fi
fi

/usr/bin/open "$@"
`;

// --- REST API ---

app.use(express.json({ limit: "10mb" }));
app.get("/", (req, res) => {
  const htmlPath = path.join(__dirname, "public", "index.html");
  let html = fs.readFileSync(htmlPath, "utf8");
  const appJsMtime = fs.statSync(path.join(__dirname, "public", "app.js")).mtimeMs | 0;
  const cssMtime = fs.statSync(path.join(__dirname, "public", "style.css")).mtimeMs | 0;
  html = html.replace(/src="app\.js[^"]*"/, `src="app.js?v=${appJsMtime}"`);
  html = html.replace(/href="style\.css[^"]*" id="main-css"/, `href="style.css?v=${cssMtime}" id="main-css"`);
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".js") || filePath.endsWith(".css") || filePath.endsWith(".html")) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
  }
}));

// CSRF protection
app.use("/api", security.csrfMiddleware());

// --- Config API ---

app.get("/api/config", (req, res) => {
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
    accentColor: userConfig.accentColor || "gold",
    bgColor: userConfig.bgColor || null,
    autoRenameAgents: !!userConfig.autoRenameAgents,
    autoRenameNewOnly: userConfig.autoRenameNewOnly !== false,
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
  if (updates.accentColor !== undefined) userConfig.accentColor = updates.accentColor;
  if (updates.bgColor !== undefined) {
    if (updates.bgColor === null) delete userConfig.bgColor;
    else userConfig.bgColor = updates.bgColor;
  }
  if (updates.autoRenameAgents !== undefined) userConfig.autoRenameAgents = !!updates.autoRenameAgents;
  if (updates.autoRenameNewOnly !== undefined) userConfig.autoRenameNewOnly = !!updates.autoRenameNewOnly;
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
  if (!/^[a-zA-Z0-9_-]+$/.test(cmd)) {
    return res.status(400).json({ error: "Invalid shell command name" });
  }
  const scriptPath = path.join(__dirname, "ceo.sh");
  const aliasLine = `alias ${cmd}="bash ${scriptPath}"`;
  const shell = process.env.SHELL || "/bin/zsh";
  const rcFile = shell.endsWith("zsh")
    ? path.join(os.homedir(), ".zshrc")
    : path.join(os.homedir(), ".bashrc");
  try {
    let rc = fs.existsSync(rcFile) ? fs.readFileSync(rcFile, "utf8") : "";
    rc = rc.replace(/\nalias [a-zA-Z0-9_-]+="bash [^"]*\/ceo\.sh"/g, "");
    rc = rc.replace(/^alias [a-zA-Z0-9_-]+="bash [^"]*\/ceo\.sh"\n?/, "");
    rc = rc.trimEnd() + "\n" + aliasLine + "\n";
    fs.writeFileSync(rcFile, rc);
    res.json({ ok: true, alias: aliasLine, rcFile });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Sessions API ---

app.get("/api/sessions", async (req, res) => {
  try {
    const tmuxSessions = listTmuxSessions();
    const meta = loadSessionsMeta();
    const filteredSessions = tmuxSessions.filter((s) => {
      const n = s.replace(PREFIX, "");
      return !_firingAgents.has(n) && !_renameInProgress.has(n);
    });
    if (filteredSessions.length === 0 && Object.keys(meta).length > 0) {
      console.warn(`[api/sessions] 0 tmux sessions but ${Object.keys(meta).length} in metadata. tmuxRaw=${tmuxSessions.length}, firing=${_firingAgents.size}`);
    }
    const sessions = await Promise.all(filteredSessions.map(async (s) => {
      const name = s.replace(PREFIX, "");
      const workdir = meta[name]?.workdir || DEFAULT_WORKDIR;
      const git = await getCachedGitInfo(workdir).catch(() => null);
      return {
        name,
        workdir,
        created: meta[name]?.created || null,
        branch: git?.branch || null,
        isWorktree: git?.isWorktree || false,
        favorite: meta[name]?.favorite || false,
        minimized: meta[name]?.minimized || false,
        type: meta[name]?.type || "agent",
      };
    }));
    res.json(sessions);
  } catch (err) {
    console.error("[api/sessions] Error:", err.message);
    // Return whatever we can from metadata alone
    try {
      const meta = loadSessionsMeta();
      const sessions = Object.entries(meta).map(([name, info]) => ({
        name,
        workdir: info.workdir || DEFAULT_WORKDIR,
        created: info.created || null,
        branch: null,
        isWorktree: false,
        favorite: info.favorite || false,
        minimized: info.minimized || false,
        type: info.type || "agent",
      }));
      res.json(sessions);
    } catch {
      res.json([]);
    }
  }
});

app.get("/api/claude-sessions", async (req, res) => {
  try {
    const sessions = await loadClaudeSessionsAsync(req.query.q || null);
    res.json(sessions);
  } catch {
    res.json([]);
  }
});

app.get("/api/slash-commands", (req, res) => {
  res.json(getSlashCommands());
});

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

app.post("/api/sessions", async (req, res) => {
  const { name, prompt, workdir, resumeSessionId, initialImages, initialImageText, type } = req.body;

  if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
    return res.status(400).json({ error: "Invalid name (alphanumeric, dash, underscore only)" });
  }

  const existing = listTmuxSessions();
  let finalName = name;
  if (existing.includes(`${PREFIX}${finalName}`)) {
    let i = 1;
    while (existing.includes(`${PREFIX}${finalName}-${i}`)) i++;
    finalName = `${finalName}-${i}`;
  }

  // Terminal card: bare tmux shell, no Claude CLI
  if (type === "terminal") {
    try {
      ensureTmuxServer();
      const dir = workdir || DEFAULT_WORKDIR;
      if (!isValidWorkdir(dir)) {
        return res.status(400).json({ error: "Invalid working directory" });
      }
      const wantedSession = `${PREFIX}${name}`;
      const alreadyExists = existing.includes(wantedSession);
      const session = alreadyExists ? wantedSession : `${PREFIX}${finalName}`;
      if (!alreadyExists) {
        execSync(
          `tmux new-session -d -s ${session} -x 120 -y 50 -c ${shellQuote(dir)}`,
          { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
        );
        try { execSync(`tmux set-option -t ${session} status off`, { stdio: "ignore" }); } catch {}
      }
      const usedName = alreadyExists ? name : finalName;
      invalidateTmuxSessionsCache();
      const git = await getCachedGitInfo(dir);
      res.json({ name: usedName, workdir: dir, type: "terminal", branch: git?.branch || null, isWorktree: git?.isWorktree || false });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
    return;
  }

  let effectiveWorkdir = workdir;
  if (resumeSessionId && !workdir) {
    const allSessions = loadClaudeSessions(null);
    const match = allSessions.find((s) => s.sessionId === resumeSessionId);
    if (match && match.projectPath) {
      effectiveWorkdir = match.projectPath;
    }
  }

  const cliPrompt = (initialImages && initialImages.length > 0) ? null : prompt;

  try {
    createSession(finalName, effectiveWorkdir, cliPrompt, resumeSessionId);
    // Set autoRename on new agents when global setting is enabled
    if (userConfig.autoRenameAgents) {
      const meta = loadSessionsMeta();
      if (meta[finalName]) {
        meta[finalName].autoRename = true;
        saveSessionsMeta(meta);
      }
    }
    const finalWorkdir = effectiveWorkdir || DEFAULT_WORKDIR;
    const git = await getCachedGitInfo(finalWorkdir);
    res.json({ name: finalName, workdir: finalWorkdir, branch: git?.branch || null, isWorktree: git?.isWorktree || false, favorite: false, minimized: false });

    const sessionName = `${PREFIX}${finalName}`;

    if (initialImages && initialImages.length > 0) {
      const sendInitialImages = () => {
        const output = capturePane(sessionName);
        if (!output) return false;
        const status = detectStatus(output, "");
        if (status !== "idle" && status !== "asking") return false;
        sendKeysWithImages(sessionName, initialImageText || "", initialImages);
        return true;
      };
      let sent = false;
      for (const ms of [3000, 5000, 8000, 12000, 18000, 25000]) {
        setTimeout(() => {
          if (!sent) sent = sendInitialImages();
        }, ms);
      }
    }

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
  if (newName && newName !== name) {
    if (!/^[a-zA-Z0-9_-]+$/.test(newName)) {
      return res.status(400).json({ error: "Invalid name" });
    }
    _renameInProgress.add(name);
    _renameInProgress.add(newName);
    tmuxExec(`rename-session -t ${session} ${PREFIX}${newName}`);
    invalidateTmuxSessionsCache();
    meta[newName] = { ...meta[name] };
    delete meta[name];
    saveSessionsMeta(meta);
    // Update output/status cache keys
    const cachedOutput = prevOutputs.get(session);
    if (cachedOutput) {
      prevOutputs.delete(session);
      prevOutputs.set(`${PREFIX}${newName}`, cachedOutput);
    }
    const cachedStatus = prevStatuses.get(session);
    if (cachedStatus) {
      prevStatuses.delete(session);
      prevStatuses.set(`${PREFIX}${newName}`, cachedStatus);
    }
    _migrateAgentDocs(name, newName);
    _queueRenamePrefix(name, newName);
    // Broadcast rename to all clients (not just the one that initiated it)
    _broadcastWs({ type: "rename", oldName: name, newName });
    // Keep BOTH names blocked briefly so stale caches don't create ghost cards
    setTimeout(() => _renameInProgress.delete(name), 2000);
    setTimeout(() => _renameInProgress.delete(newName), 2000);
    return res.json({ name: newName, workdir: meta[newName]?.workdir });
  }
  if (workdir) {
    killSession(name);
    createSession(name, workdir);
    return res.json({ name, workdir });
  }
  res.json({ name });
});

app.post("/api/sessions/:name/restart", async (req, res) => {
  const { name } = req.params;
  if (!isValidAgentName(name)) return res.status(400).json({ error: "Invalid agent name" });
  const session = `${PREFIX}${name}`;
  const meta = loadSessionsMeta();
  const info = meta[name];
  if (!info) return res.status(404).json({ error: "Agent not found in metadata" });
  let sessionId = info.resumeSessionId;
  if (!sessionId) {
    sessionId = detectClaudeSessionIdForAgent(info.workdir || DEFAULT_WORKDIR, info.created);
  }
  if (!sessionId) {
    return res.status(400).json({ error: "No Claude session ID found — cannot resume" });
  }
  try { tmuxExec(`kill-session -t ${session}`); } catch {}
  prevOutputs.delete(session);
  clearWorktreeCache(session);
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
  const fullCmd = `clear && unset CLAUDECODE && ${claudeCmd}`;
  const cmdEscaped = fullCmd.replace(/'/g, "'\\''");
  tmuxExec(`set-buffer -b ceocmd -- '${cmdEscaped}'`);
  tmuxExec(`paste-buffer -b ceocmd -t ${session}`);
  tmuxExec(`delete-buffer -b ceocmd`);
  tmuxExec(`send-keys -t ${session} Enter`);
  info.resumeSessionId = sessionId;
  saveSessionsMeta(meta);
  const git = await getCachedGitInfo(dir);
  res.json({ ok: true, workdir: dir, branch: git?.branch || null, isWorktree: git?.isWorktree || false });
});

app.delete("/api/sessions/:name", async (req, res) => {
  const { name } = req.params;
  if (!isValidAgentName(name)) return res.status(400).json({ error: "Invalid agent name" });
  const session = `${PREFIX}${name}`;
  if (!listTmuxSessions().includes(session)) {
    return res.status(404).json({ error: "Session not found" });
  }

  // If cleanWorktree requested, detect and remove the worktree before killing
  let worktreeCleaned = null;
  if (req.query.cleanWorktree === "true") {
    try {
      const output = capturePane(session);
      const wtPath = require("./lib/tmux").detectWorktreePath(session, output);
      if (wtPath) {
        execSync(`git worktree remove --force ${shellQuote(wtPath)}`, { timeout: 10000, stdio: "pipe" });
        try { execSync("git worktree prune", { timeout: 5000, stdio: "pipe" }); } catch {}
        worktreeCleaned = wtPath;
      }
    } catch (e) {
      console.error(`[worktree cleanup] Failed for ${name}:`, e.message);
    }
  }

  // Snapshot killed agent's per-day token contributions before removing it
  snapshotKilledAgentTokens(name);

  killSession(name);
  clearWorktreeCache(`${PREFIX}${name}`);
  prevStatuses.delete(`${PREFIX}${name}`);
  _autoRenamed.delete(name);
  _pendingRenamePrefix.delete(name);
  _firingAgents.delete(name);
  fileTracker.removeAgent(name);
  res.json({ ok: true, worktreeCleaned });
});

// Fire agent — send postmortem prompt, hide from UI, kill after completion
app.post("/api/sessions/:name/fire", async (req, res) => {
  const { name } = req.params;
  if (!isValidAgentName(name)) return res.status(400).json({ error: "Invalid agent name" });
  const session = `${PREFIX}${name}`;
  if (!listTmuxSessions().includes(session)) {
    return res.status(404).json({ error: "Session not found" });
  }

  const { reason } = req.body;
  _firingAgents.add(name);

  // Capture last 200 lines of terminal output for context
  let lastOutput = "";
  try {
    const raw = capturePane(session);
    if (raw) {
      const lines = raw.split("\n");
      lastOutput = lines.slice(-200).join("\n");
    }
  } catch {}

  const FIRED_PATH = path.join(__dirname, "fired.md");
  const timestamp = new Date().toISOString();

  // Ensure fired.md exists with a header
  if (!fs.existsSync(FIRED_PATH)) {
    fs.writeFileSync(FIRED_PATH, "# Fired Agent Lessons\n\nThis file contains lessons from agents that were fired. Future agents should read this and avoid repeating these mistakes.\n\n");
  }

  // Build the fire prompt
  const reasonPart = reason
    ? `The user fired you for this reason: "${reason}"\n\n`
    : "The user fired you without giving a specific reason. You need to figure out what went wrong.\n\n";

  const firePrompt = [
    `URGENT: You have been FIRED by the user. ${reasonPart}`,
    "Your task: Write a concise post-mortem entry to prevent future agents from making the same mistake.",
    "",
    "Instructions:",
    `1. Review your recent actions and the user's feedback`,
    `2. Identify the specific behavior that caused the firing`,
    `3. Write a single markdown entry and append it to the file: ${FIRED_PATH}`,
    "",
    "Use this exact format when writing to the file (append, don't overwrite existing content):",
    "```",
    `## ${name} — ${timestamp.split("T")[0]}`,
    "",
    "**What happened:** <1-2 sentence description of what went wrong>",
    "",
    "**Lesson:** <Clear, actionable rule for future agents to follow>",
    "```",
    "",
    "After writing the entry, type /exit to terminate yourself. Do NOT do anything else.",
  ].join("\n");

  // Send the fire prompt to the agent
  try {
    sendKeys(session, firePrompt);
  } catch (e) {
    // If we can't send keys, write a basic entry ourselves and kill
    _firingAgents.delete(name);
    snapshotKilledAgentTokens(name);
    killSession(name);
    clearWorktreeCache(session);
    return res.json({ ok: true, fallback: true });
  }

  res.json({ ok: true });

  // Background: poll for agent completion, then kill
  const maxWait = 120000; // 2 minutes max
  const pollInterval = 3000;
  const startTime = Date.now();

  const checkDone = () => {
    if (Date.now() - startTime > maxWait) {
      // Timeout — write a basic entry if the agent didn't
      try {
        if (!fs.existsSync(FIRED_PATH) || !fs.readFileSync(FIRED_PATH, "utf8").includes(`## ${name}`)) {
          const fallbackEntry = [
            "",
            `## ${name} — ${timestamp.split("T")[0]}`,
            "",
            `**What happened:** Agent was fired${reason ? `: ${reason}` : " (no reason given)"}. Agent did not complete post-mortem in time.`,
            "",
            `**Lesson:** ${reason || "Unknown — the agent failed to self-reflect. Pay close attention to user feedback and instructions."}`,
            "",
          ].join("\n");
          fs.appendFileSync(FIRED_PATH, fallbackEntry);
        }
      } catch {}
      _firingAgents.delete(name);
      snapshotKilledAgentTokens(name);
      killSession(name);
      clearWorktreeCache(session);
      prevStatuses.delete(session);
      _autoRenamed.delete(name);
      _pendingRenamePrefix.delete(name);
      return;
    }

    try {
      const sessions = listTmuxSessions();
      if (!sessions.includes(session)) {
        // Agent already exited (via /exit)
        _firingAgents.delete(name);
        snapshotKilledAgentTokens(name);
        clearWorktreeCache(session);
        prevStatuses.delete(session);
        _autoRenamed.delete(name);
        _pendingRenamePrefix.delete(name);
        // Clean up metadata
        const meta = loadSessionsMeta();
        delete meta[name];
        saveSessionsMeta(meta);
        return;
      }

      const output = capturePane(session);
      if (output) {
        const status = detectStatus(output, "");
        // Agent is idle = it finished and is waiting at prompt
        if (status === "idle") {
          _firingAgents.delete(name);
          snapshotKilledAgentTokens(name);
          killSession(name);
          clearWorktreeCache(session);
          prevStatuses.delete(session);
          _autoRenamed.delete(name);
          _pendingRenamePrefix.delete(name);
          const meta = loadSessionsMeta();
          delete meta[name];
          saveSessionsMeta(meta);
          return;
        }
      }
    } catch {}

    setTimeout(checkDone, pollInterval);
  };

  setTimeout(checkDone, pollInterval);
});

// Toggle per-agent auto-rename flag
app.post("/api/sessions/:name/auto-rename", (req, res) => {
  const { name } = req.params;
  if (!isValidAgentName(name)) return res.status(400).json({ error: "Invalid agent name" });
  const session = `${PREFIX}${name}`;
  if (!listTmuxSessions().includes(session)) {
    return res.status(404).json({ error: "Session not found" });
  }
  const { enabled } = req.body;
  const meta = loadSessionsMeta();
  if (!meta[name]) meta[name] = {};
  meta[name].autoRename = !!enabled;
  saveSessionsMeta(meta);
  if (enabled) {
    _autoRenamed.delete(name);
    // Rename immediately — user just enabled it
    const output = prevOutputs.get(session);
    if (output) {
      _pendingAutoRename.add(name);
      tryAutoRename(name, output);
    }
  }
  res.json({ ok: true, autoRename: !!enabled });
});

// Trigger an immediate rename for an agent
app.post("/api/sessions/:name/queue-rename", (req, res) => {
  const { name } = req.params;
  if (!isValidAgentName(name)) return res.status(400).json({ error: "Invalid agent name" });
  const session = `${PREFIX}${name}`;
  if (!listTmuxSessions().includes(session)) {
    return res.status(404).json({ error: "Session not found" });
  }
  _pendingAutoRename.add(name);
  _autoRenamed.delete(name);

  // Try immediately regardless of status — user explicitly requested
  const output = prevOutputs.get(session);
  if (output) {
    tryAutoRename(name, output);
  }

  res.json({ ok: true });
});

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
  const minimized = req.body.minimized !== undefined ? req.body.minimized : !meta[name].minimized;
  meta[name].minimized = minimized;
  saveSessionsMeta(meta);
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
  const raw = tmuxExec(`capture-pane -t ${session} -p -S -500 -E -`);
  if (!raw) {
    return res.status(500).json({ error: "Failed to capture terminal output" });
  }
  const stripped = raw.replace(/\x1b\[[0-9;]*m/g, "");
  const tmpFile = path.join(os.tmpdir(), `ceo-snapshot-${name}.txt`);
  fs.writeFileSync(tmpFile, stripped, "utf8");
  const agentDocsDir = path.join(DOCS_DIR, name);
  if (!fs.existsSync(agentDocsDir)) fs.mkdirSync(agentDocsDir, { recursive: true });
  const snapshotSession = `${PREFIX}_snap_${name}`;
  try { tmuxExec(`kill-session -t ${snapshotSession}`); } catch {}
  const memoryPath = path.join(DOCS_DIR, name, "memory.md");
  let prompt;
  if (mode === "update") {
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
    setTimeout(() => { tmuxExec(`kill-session -t ${snapshotSession}`); }, 120000);
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

// --- Code Diff Viewer ---

app.get("/api/sessions/:name/diff", async (req, res) => {
  const { name } = req.params;
  if (!isSafePathSegment(name)) return res.status(400).json({ error: "Invalid session name" });
  const sessions = listTmuxSessions();
  const session = sessions.find((s) => s === `${PREFIX}${name}`);
  if (!session) return res.status(404).json({ error: "Session not found" });
  let workdir;
  try { workdir = await getEffectiveCwdAsync(session, prevOutputs.get(session)); } catch {}
  if (!workdir) {
    const meta = loadSessionsMeta();
    workdir = meta[name]?.workdir;
  }
  if (!workdir) return res.status(400).json({ error: "Could not determine working directory" });
  try {
    execSync("git rev-parse --is-inside-work-tree", { cwd: workdir, timeout: 5000, stdio: "ignore" });
  } catch {
    return res.status(400).json({ error: "Not a git repository" });
  }
  const ctxParam = parseInt(req.query.context, 10);
  const ctxFlag = ctxParam > 0 ? `-U${ctxParam}` : "";
  const runGitDiff = (args) =>
    new Promise((resolve) => {
      exec(`git diff ${ctxFlag} ${args}`, { cwd: workdir, timeout: 10000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout) => {
        resolve(err ? "" : stdout);
      });
    });
  try {
    const [unstaged, staged] = await Promise.all([runGitDiff(""), runGitDiff("--cached")]);
    res.json({ workdir, hasDiff: !!(unstaged || staged), unstaged, staged });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- PR URL lookup ---

app.get("/api/sessions/:name/pr-url", async (req, res) => {
  const { name } = req.params;
  if (!isSafePathSegment(name)) return res.status(400).json({ error: "Invalid session name" });
  const meta = loadSessionsMeta();
  const sessions = listTmuxSessions();
  const session = sessions.find((s) => s === `${PREFIX}${name}`);
  let workdir;
  if (session) {
    try { workdir = await getEffectiveCwdAsync(session, prevOutputs.get(session)); } catch {}
  }
  if (!workdir) workdir = meta[name]?.workdir;
  if (!workdir) return res.json({ prUrl: null });
  try {
    const git = await getGitInfoAsync(workdir);
    if (!git?.branch || git.branch === "main" || git.branch === "master") {
      return res.json({ prUrl: null });
    }
    const result = await new Promise((resolve) => {
      exec(`gh pr view "${git.branch}" --json url -q .url 2>/dev/null`, {
        cwd: workdir, encoding: "utf8", timeout: 5000,
      }, (err, stdout) => {
        const url = (stdout || "").trim();
        resolve(url.startsWith("http") ? toPrUrl(url) : null);
      });
    });
    res.json({ prUrl: result });
  } catch {
    res.json({ prUrl: null });
  }
});

// --- Agent Output Search ---
app.get("/api/sessions/:name/search", (req, res) => {
  const { name } = req.params;
  const { q } = req.query;
  if (!isSafePathSegment(name) || !q || typeof q !== "string") {
    return res.status(400).json({ error: "invalid params" });
  }
  const session = PREFIX + name;
  try {
    const output = execSync(
      `tmux capture-pane -t ${shellQuote(session)} -p -S -50000`,
      { encoding: "utf8", timeout: 5000 }
    );
    const lines = output.split("\n");
    const matches = [];
    const query = q.toLowerCase();
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(query)) {
        matches.push({ line: i, text: lines[i] });
      }
    }
    res.json({ matches, total: matches.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- .claude File Browser API ---

app.get("/api/claude-files", (req, res) => {
  const result = {
    docs: scanDir(path.join(CLAUDE_HOME, "docs")),
    commands: scanDir(path.join(CLAUDE_HOME, "commands")),
    skills: scanSkills(),
    agents: scanDir(path.join(CLAUDE_HOME, "agents")),
    memory: scanMemoryFiles(),
    ceoDocs: scanCeoDocs(),
  };
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

// --- Agent Docs API ---

app.get("/api/agent-docs/:name", (req, res) => {
  if (!isSafePathSegment(req.params.name)) return res.status(400).json({ error: "Invalid agent name" });
  ensureDocsDir();
  const agentDir = path.join(DOCS_DIR, req.params.name);
  if (!isWithinDir(agentDir, DOCS_DIR)) return res.status(400).json({ error: "Invalid path" });
  try {
    if (!fs.existsSync(agentDir) || !fs.statSync(agentDir).isDirectory()) return res.json([]);
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
  if (!isSafePathSegment(req.params.name) || !isSafePathSegment(req.params.doc)) return res.status(400).json({ error: "Invalid name or doc" });
  ensureDocsDir();
  const filePath = path.join(DOCS_DIR, req.params.name, `${req.params.doc}.md`);
  if (!isWithinDir(filePath, DOCS_DIR)) return res.status(400).json({ error: "Invalid path" });
  try {
    const content = fs.readFileSync(filePath, "utf8");
    res.json({ content });
  } catch {
    res.json({ content: null });
  }
});

app.put("/api/agent-docs/:name/:doc", (req, res) => {
  if (!isSafePathSegment(req.params.name) || !isSafePathSegment(req.params.doc)) return res.status(400).json({ error: "Invalid name or doc" });
  ensureDocsDir();
  const agentDir = path.join(DOCS_DIR, req.params.name);
  if (!isWithinDir(agentDir, DOCS_DIR)) return res.status(400).json({ error: "Invalid path" });
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
  if (!isSafePathSegment(req.params.name) || !isSafePathSegment(req.params.doc)) return res.status(400).json({ error: "Invalid name or doc" });
  ensureDocsDir();
  const srcPath = path.join(DOCS_DIR, req.params.name, `${req.params.doc}.md`);
  if (!isWithinDir(srcPath, DOCS_DIR)) return res.status(400).json({ error: "Invalid path" });
  const destDir = path.join(os.homedir(), ".claude", "docs");
  const destPath = path.join(destDir, `${req.params.doc}.md`);
  try {
    if (!fs.existsSync(srcPath)) return res.status(404).json({ error: "Doc not found" });
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(srcPath, destPath);
    res.json({ ok: true, destPath });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/agent-docs/:name/:doc", (req, res) => {
  if (!isSafePathSegment(req.params.name) || !isSafePathSegment(req.params.doc)) return res.status(400).json({ error: "Invalid name or doc" });
  ensureDocsDir();
  const filePath = path.join(DOCS_DIR, req.params.name, `${req.params.doc}.md`);
  if (!isWithinDir(filePath, DOCS_DIR)) return res.status(400).json({ error: "Invalid path" });
  try {
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Doc not found" });
    fs.unlinkSync(filePath);
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

// File tracker endpoints
app.get("/api/file-overlaps", (req, res) => {
  res.json(fileTracker.getOverlaps());
});

app.get("/api/agent-files/:name", (req, res) => {
  const { name } = req.params;
  if (!isSafePathSegment(name)) return res.status(400).json({ error: "invalid" });
  res.json(fileTracker.getAgentFiles(name));
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

// --- Shell completions ---

app.post("/api/shell/completions", (req, res) => {
  const { word, cwd, dirsOnly } = req.body || {};
  if (!cwd || typeof cwd !== "string") return res.json({ completions: [] });
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

app.post("/api/shell/open-url", (req, res) => {
  const { url } = req.body || {};
  shellLog("shell-open-url-hit", { url, source: "shell-open-override" });
  if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: "Invalid URL — must start with http:// or https://" });
  }
  const msg = JSON.stringify({ type: "shell-open-url", url });
  wss.clients.forEach((c) => { if (c.readyState === 1) c.send(msg); });
  res.json({ ok: true });
});

app.post("/api/shell/open-finder", (req, res) => {
  const { path: folderPath } = req.body || {};
  if (!folderPath || typeof folderPath !== "string" || !path.isAbsolute(folderPath)) {
    return res.status(400).json({ error: "Invalid path" });
  }
  if (/[\0\n\r]/.test(folderPath)) return res.status(400).json({ error: "Invalid path characters" });
  try {
    if (!fs.statSync(folderPath).isDirectory()) return res.status(400).json({ error: "Path is not a directory" });
  } catch {
    return res.status(400).json({ error: "Path does not exist" });
  }
  require("child_process").execFile("open", [folderPath], { timeout: 5000 }, () => {});
  res.json({ ok: true });
});

app.post("/api/open-url", express.json(), (req, res) => {
  const { url } = req.body || {};
  shellLog("open-url-hit", { url, source: "BROWSER-env-var" });
  if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: "Invalid URL — must start with http:// or https://" });
  }
  for (const client of wss.clients) {
    try { client.send(JSON.stringify({ type: "open-url", url })); } catch {}
  }
  res.json({ ok: true });
});

// --- Settings API ---

app.get("/api/settings", (req, res) => {
  try {
    let sleepPrevention = false;
    try {
      const pmsetOut = execSync("pmset -g custom", { encoding: "utf8", timeout: 5000 });
      const acSection = pmsetOut.split("AC Power:")[1] || "";
      const sleepMatch = acSection.match(/\bsleep\s+(\d+)/);
      if (sleepMatch) sleepPrevention = sleepMatch[1] === "0";
    } catch {}
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
      try {
        execSync("which tailscale 2>/dev/null || test -d /Applications/Tailscale.app", { timeout: 3000 });
        tailscale.installed = true;
      } catch {}
    }
    let autoStart = false;
    try {
      const launchctlOut = execSync("launchctl list 2>/dev/null", { encoding: "utf8", timeout: 5000 });
      autoStart = launchctlOut.includes("com.ceo-dashboard");
    } catch {}
    const dockAppPath = getNativeAppDir();
    const dockAppInstalled = fs.existsSync(dockAppPath);
    res.json({ sleepPrevention, tailscale, autoStart, dockAppInstalled, autoRenameAgents: !!userConfig.autoRenameAgents, autoRenameNewOnly: userConfig.autoRenameNewOnly !== false });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/settings/sleep-prevention", (req, res) => {
  const { enabled } = req.body;
  try {
    if (enabled) { execSync("sudo -n pmset -c sleep 0", { timeout: 5000 }); }
    else { execSync("sudo -n pmset -c sleep 1", { timeout: 5000 }); }
    res.json({ ok: true, sleepPrevention: enabled });
  } catch (e) {
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

app.post("/api/settings/auto-rename-agents", (req, res) => {
  const { enabled } = req.body;
  userConfig.autoRenameAgents = !!enabled;
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(userConfig, null, 2));
    res.json({ ok: true, autoRenameAgents: !!enabled });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/settings/auto-rename-new-only", (req, res) => {
  const { enabled } = req.body;
  userConfig.autoRenameNewOnly = !!enabled;
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(userConfig, null, 2));
    // When turning OFF "new only", enable auto-rename for all existing agents
    if (!enabled) {
      const meta = loadSessionsMeta();
      const sessions = listTmuxSessions();
      let changed = false;
      for (const [name, info] of Object.entries(meta)) {
        if (info.type === "terminal") continue;
        if (!sessions.includes(`${PREFIX}${name}`)) continue;
        if (!info.autoRename) {
          meta[name].autoRename = true;
          _autoRenamed.delete(name);
          changed = true;
        }
      }
      if (changed) saveSessionsMeta(meta);
    }
    res.json({ ok: true, autoRenameNewOnly: !!enabled });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/settings/add-to-dock", (req, res) => {
  const buildScript = path.join(__dirname, "native-app", "build.sh");
  if (!fs.existsSync(buildScript)) return res.status(404).json({ error: "build.sh not found" });
  const appDir = getNativeAppDir();
  // Run build async — respond immediately, notify via WebSocket when done
  res.json({ ok: true, path: appDir, async: true });
  const child = require("child_process").spawn("/bin/bash", [buildScript],
    { cwd: __dirname, env: { ...process.env, CEO_NO_OPEN: "1" } });
  let output = "";
  child.stdout.on("data", (d) => { output += d; });
  child.stderr.on("data", (d) => { output += d; });
  child.on("close", (code) => {
    const msg = JSON.stringify({ type: "dock-build-result", ok: code === 0, output, path: appDir });
    for (const c of wss.clients) { try { c.send(msg); } catch {} }
  });
});

// --- Notification API ---

app.post("/api/notify", (req, res) => {
  const { title, message } = req.body || {};
  sendNotification(title, message || "");
  res.json({ ok: true });
});

app.post("/api/test-notification", (req, res) => {
  const { title, body } = req.body || {};
  sendNotification(title || "Test", body || "This is a test notification");
  res.json({ ok: true });
});

// --- Focus debug log ---

app.post("/api/focus-log", (req, res) => {
  // Accept both {entries: [...]} (batched) and single object
  const entries = Array.isArray(req.body.entries) ? req.body.entries : [req.body];
  for (const entry of entries) {
    if (!entry) continue;
    entry._server_ts = new Date().toISOString();
    _focusLogEntries.push(entry);
    if (_focusLogEntries.length > FOCUS_LOG_MAX) _focusLogEntries.shift();
  }
  const lines = entries.map(e => {
    if (e.event) {
      const ts = new Date(e.ts || Date.now()).toISOString();
      return `[${ts}] ${e.event} | active=${e.active || ""} | related=${e.related || ""} | guard=${e.guard || ""} | ${e.detail || ""}`;
    }
    return JSON.stringify(e);
  }).join("\n") + "\n";
  fs.appendFile(FOCUS_LOG_FILE, lines, () => {});
  res.json({ ok: true });
});

app.get("/api/focus-log", (req, res) => {
  const unrestored = req.query.all ? _focusLogEntries : _focusLogEntries.filter(e => !e.wasRestored);
  res.json(unrestored);
});

app.delete("/api/focus-log", (req, res) => {
  _focusLogEntries.length = 0;
  fs.writeFile(FOCUS_LOG_FILE, "", () => {});
  res.json({ ok: true });
});

// --- Shell debug log ---

app.get("/api/shell-log", (req, res) => {
  const type = req.query.type;
  const entries = type ? _shellLog.filter(e => e.type === type) : _shellLog;
  res.json(entries);
});

app.delete("/api/shell-log", (req, res) => {
  _shellLog.length = 0;
  fs.writeFile(SHELL_LOG_FILE, "", () => {});
  res.json({ ok: true });
});

// --- URL Opener ---

app.get("/api/url-opener", (req, res) => {
  try {
    if (!fs.existsSync(URL_OPENER_PATH)) return res.json({ installed: false });
    const content = fs.readFileSync(URL_OPENER_PATH, "utf8");
    const isOurs = content.includes("CEO_DASHBOARD") && content.includes("api/shell/open-url");
    res.json({ installed: isOurs, path: URL_OPENER_PATH });
  } catch {
    res.json({ installed: false });
  }
});

app.post("/api/url-opener/install", (req, res) => {
  try {
    const dir = path.dirname(URL_OPENER_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(URL_OPENER_PATH, URL_OPENER_SCRIPT, { mode: 0o755 });
    res.json({ ok: true, path: URL_OPENER_PATH });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/url-opener", (req, res) => {
  try {
    if (fs.existsSync(URL_OPENER_PATH)) fs.unlinkSync(URL_OPENER_PATH);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Image Upload ---

app.post("/api/upload", (req, res) => {
  const { filename, data } = req.body;
  if (!filename || !data) return res.status(400).json({ error: "Missing filename or data" });
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

// --- Open folder in Finder ---

app.post("/api/open-folder", (req, res) => {
  let { filePath } = req.body;
  if (!filePath) return res.status(400).json({ error: "Missing filePath" });
  if (filePath === "__ceo_md__") filePath = CEO_MD_PATH;
  const resolved = path.resolve(filePath);
  if (!isAllowedPath(resolved)) return res.status(403).json({ error: "Path not allowed" });
  if (/[\0]/.test(resolved)) return res.status(400).json({ error: "Invalid path" });
  const { execFile: execFileOpen } = require("child_process");
  const fileExists = fs.existsSync(resolved) && fs.statSync(resolved).isFile();
  const args = fileExists ? ["-R", resolved] : [path.dirname(resolved)];
  execFileOpen("open", args, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true });
  });
});

// --- Todo API ---

app.get("/api/todos", (req, res) => { res.json(loadTodos()); });

app.post("/api/todos", (req, res) => {
  const data = loadTodos();
  const { title, colorId, content, agent } = req.body;
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

// --- Favorites ---

app.get("/api/favorites", (req, res) => { res.json(loadFavorites()); });

app.post("/api/favorites", (req, res) => {
  const { url, title } = req.body;
  if (!url) return res.status(400).json({ error: "Missing url" });
  const favs = loadFavorites();
  if (favs.find((f) => f.url === url)) return res.json({ ok: true, duplicate: true });
  let domain;
  try { domain = new URL(url).hostname; } catch { domain = ""; }
  const fav = {
    id: generateFavId(), url,
    title: title || url,
    favicon: domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32` : "",
    addedAt: Date.now(),
  };
  favs.unshift(fav);
  saveFavorites(favs);
  broadcastFavorites();
  res.json({ ok: true, favorite: fav });
});

app.put("/api/favorites/:id", (req, res) => {
  const favs = loadFavorites();
  const fav = favs.find((f) => f.id === req.params.id);
  if (!fav) return res.status(404).json({ error: "Not found" });
  if (req.body.title !== undefined) fav.title = req.body.title;
  saveFavorites(favs);
  broadcastFavorites();
  res.json({ ok: true });
});

app.delete("/api/favorites/:id", (req, res) => {
  let favs = loadFavorites();
  favs = favs.filter((f) => f.id !== req.params.id);
  saveFavorites(favs);
  broadcastFavorites();
  res.json({ ok: true });
});

app.get("/api/favorites/check", (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "Missing url" });
  const favs = loadFavorites();
  const fav = favs.find((f) => f.url === url);
  res.json({ favorited: !!fav, id: fav ? fav.id : null });
});

// --- Version Manager ---

app.get("/api/versions", (req, res) => {
  try {
    try { execSync(`git fetch --tags ${getUpstreamRemote()}`, { cwd: __dirname, timeout: 15000, stdio: "ignore" }); } catch {}
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
    try {
      const remote = getUpstreamRemote();
      const originHead = execSync(`git rev-parse ${remote}/main`, { cwd: __dirname, encoding: "utf8" }).trim();
      userConfig.dismissedOriginHead = originHead;
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(userConfig, null, 2));
    } catch {}
    execSync(`git reset --hard ${tag}`, { cwd: __dirname, timeout: 30000 });
    try { execSync("npm install", { cwd: __dirname, timeout: 60000 }); } catch {}
    res.json({ ok: true });
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

checkForUpdate();
setInterval(checkForUpdate, 60 * 60 * 1000);

app.get("/api/check-update", async (req, res) => {
  const cache = getUpdateCache();
  if (!cache.checkedAt) await checkForUpdate();
  res.json(getUpdateCache());
});

app.post("/api/update", async (req, res) => {
  try {
    const remote = getUpstreamRemote();
    const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: __dirname, encoding: "utf8" }).trim();
    if (currentBranch !== "main") {
      return res.status(409).json({
        error: "not-on-main",
        message: `You're on branch "${currentBranch}". Switch to main before updating.`,
        cwd: __dirname,
        branch: currentBranch,
      });
    }
    execSync(`git fetch ${remote} main`, { cwd: __dirname, timeout: 30000 });
    try {
      execSync(`git -c merge.ff=false -c pull.rebase=false merge ${remote}/main --no-edit`, { cwd: __dirname, timeout: 30000 });
    } catch (mergeErr) {
      const stderr = (mergeErr.stderr || "").toString();
      const msg = mergeErr.message || "";
      const combined = stderr + " " + msg;

      let conflicts = [];
      try {
        conflicts = execSync("git diff --name-only --diff-filter=U", { cwd: __dirname, encoding: "utf8" })
          .trim().split("\n").filter(Boolean);
      } catch {}
      if (conflicts.length > 0) {
        try { execSync("git merge --abort", { cwd: __dirname }); } catch {}
        let localDiff = "";
        let diffTruncated = false;
        const DIFF_MAX = 80000;
        try {
          const conflictDiff = execSync(`git diff HEAD -- ${conflicts.map(f => `"${f}"`).join(" ")}`, { cwd: __dirname, encoding: "utf8", maxBuffer: 1024 * 512 });
          if (conflictDiff.length <= DIFF_MAX) {
            const fullDiff = execSync("git diff HEAD", { cwd: __dirname, encoding: "utf8", maxBuffer: 1024 * 512 });
            if (fullDiff.length <= DIFF_MAX) {
              localDiff = fullDiff;
            } else {
              const otherFiles = execSync("git diff HEAD --name-only", { cwd: __dirname, encoding: "utf8" })
                .trim().split("\n").filter(f => f && !conflicts.includes(f));
              localDiff = conflictDiff;
              if (otherFiles.length > 0) {
                localDiff += `\n\n# Also modified locally (not shown — non-conflicting):\n${otherFiles.map(f => `# - ${f}`).join("\n")}\n`;
              }
              diffTruncated = true;
            }
          } else {
            localDiff = conflictDiff.slice(0, DIFF_MAX);
            diffTruncated = true;
          }
        } catch {}
        return res.status(409).json({ error: "merge-conflict", conflicts, cwd: __dirname, localDiff, diffTruncated, remote });
      }

      try { execSync("git merge --abort", { cwd: __dirname }); } catch {}

      if (/uncommitted changes|overwritten by merge|local changes|please commit or stash/i.test(combined)) {
        let localDiff = "";
        let diffTruncated = false;
        const DIFF_MAX = 80000;
        try {
          const fullDiff = execSync("git diff HEAD", { cwd: __dirname, encoding: "utf8", maxBuffer: 1024 * 512 });
          if (fullDiff.length <= DIFF_MAX) {
            localDiff = fullDiff;
          } else {
            const stat = execSync("git diff HEAD --stat", { cwd: __dirname, encoding: "utf8" });
            localDiff = `# Diff is large — showing stat summary first:\n${stat}\n\n# Truncated diff (first ${DIFF_MAX} chars):\n${fullDiff.slice(0, DIFF_MAX)}`;
            diffTruncated = true;
          }
        } catch {}
        return res.status(409).json({ error: "dirty-workdir", message: "You have uncommitted local changes that conflict with the update.", cwd: __dirname, localDiff, diffTruncated, remote });
      }
      if (/could not resolve|unable to access|connection refused|network is unreachable|repository.*not found/i.test(combined))
        return res.status(502).json({ error: "network", message: "Could not reach the remote repository." });
      if (/timed? ?out/i.test(combined))
        return res.status(504).json({ error: "timeout", message: "The update timed out. Try again." });
      return res.status(500).json({ error: "unknown", message: stderr || msg || "Merge failed", cwd: __dirname, remote });
    }
    if (userConfig.dismissedOriginHead) {
      delete userConfig.dismissedOriginHead;
      try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(userConfig, null, 2)); } catch {}
    }
    let needsInstall = false;
    try {
      const changed = execSync("git diff HEAD~1 --name-only", { cwd: __dirname, encoding: "utf8" });
      needsInstall = changed.includes("package-lock.json") || changed.includes("package.json");
    } catch {}
    if (needsInstall) {
      try { execSync("npm install", { cwd: __dirname, timeout: 60000 }); }
      catch (npmErr) { return res.status(500).json({ error: "npm-failed", message: "Code updated but npm install failed.", cwd: __dirname }); }
    }
    const nativeAppDir = getNativeAppDir();
    let nativeChanged = false;
    try {
      const changed = execSync("git diff HEAD~1 --name-only", { cwd: __dirname, encoding: "utf8" });
      nativeChanged = changed.includes("native-app/");
    } catch {}
    // Native app rebuild is handled by the startup stale-binary check in the new server process
    res.json({ ok: true });
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

// --- Worktrees ---

app.post("/api/worktrees/delete-all", (req, res) => {
  try {
    const raw = execSync("git worktree list --porcelain", { encoding: "utf8", timeout: 10000 });
    const worktrees = [];
    let current = {};
    for (const line of raw.split("\n")) {
      if (line.startsWith("worktree ")) { current = { path: line.slice(9) }; }
      else if (line === "") { if (current.path) worktrees.push(current); current = {}; }
    }
    if (current.path) worktrees.push(current);
    const toRemove = worktrees.slice(1);
    if (toRemove.length === 0) return res.json({ removed: 0, message: "No worktrees to remove" });
    let removed = 0;
    const errors = [];
    for (const wt of toRemove) {
      try { execSync(`git worktree remove --force ${shellQuote(wt.path)}`, { timeout: 10000, stdio: "pipe" }); removed++; }
      catch (e) { errors.push(`${wt.path}: ${e.message}`); }
    }
    try { execSync("git worktree prune", { timeout: 5000, stdio: "pipe" }); } catch {}
    const claudeWorktrees = path.join(os.homedir(), ".claude", "worktrees");
    if (fs.existsSync(claudeWorktrees)) {
      try { fs.rmSync(claudeWorktrees, { recursive: true, force: true }); } catch {}
    }
    res.json({ removed, total: toRemove.length, errors: errors.length ? errors : undefined });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- System info ---

app.get("/api/agent-templates", (req, res) => {
  res.json(userConfig.agentTemplates || []);
});

app.get("/api/system-info", (req, res) => {
  const info = {};
  try { info.dashboardVersion = execSync("git rev-parse --short HEAD", { cwd: __dirname, encoding: "utf8", timeout: 3000 }).trim(); } catch { info.dashboardVersion = "unknown"; }
  try { info.dashboardBranch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: __dirname, encoding: "utf8", timeout: 3000 }).trim(); } catch { info.dashboardBranch = "unknown"; }
  info.nodeVersion = process.version;
  info.platform = `${process.platform} ${process.arch}`;
  try { info.osVersion = execSync("sw_vers -productVersion 2>/dev/null || uname -r", { encoding: "utf8", timeout: 3000 }).trim(); } catch { info.osVersion = "unknown"; }
  info.activeAgents = listTmuxSessions().filter(s => s.startsWith(PREFIX)).length;
  info.bugReportRepo = userConfig.bugReportRepo || "john-farina/claude-cli-dashboard";
  res.json(info);
});

app.get("/api/token-usage", (req, res) => { res.json(_tokenUsageTotals); });

function _broadcastTokens(saved) {
  const message = JSON.stringify({ type: "token-usage", usage: saved });
  wss.clients.forEach((client) => { if (client.readyState === 1) client.send(message); });
}

// Rebuild today's usage from JSONL source files (ground truth)
function _rebuildTodayFromJsonl() {
  const meta = loadSessionsMeta();
  const d = new Date();
  const todayKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const today = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
  const seen = new Set();
  for (const info of Object.values(meta)) {
    if (info.type === "terminal") continue;
    const sid = info.resumeSessionId;
    if (!sid || seen.has(sid)) continue;
    seen.add(sid);
    const filePath = findJsonlFileForSession(sid);
    if (!filePath) continue;
    const byDay = parseTokenUsageByDay(filePath);
    const dayUsage = byDay[todayKey];
    if (dayUsage) {
      today.input += dayUsage.input;
      today.output += dayUsage.output;
      today.cacheCreation += dayUsage.cacheCreation;
      today.cacheRead += dayUsage.cacheRead;
    }
  }
  return { todayKey, today };
}

app.post("/api/token-usage/reset-today", (req, res) => {
  // Snapshot current JSONL ground truth for today as an offset to subtract
  const { todayKey, today } = _rebuildTodayFromJsonl();
  const saved = loadTokenUsage();
  saved.dailyOffset = saved.dailyOffset || {};
  // Accumulate offsets (multiple resets stack)
  const prev = saved.dailyOffset[todayKey] || { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
  saved.dailyOffset[todayKey] = {
    input: prev.input + (today.input || 0),
    output: prev.output + (today.output || 0),
    cacheCreation: prev.cacheCreation + (today.cacheCreation || 0),
    cacheRead: prev.cacheRead + (today.cacheRead || 0),
  };
  saveTokenUsage(saved);
  // Force re-sync to apply offset
  _dailyByDayCache.clear();
  broadcastTokenUsage();
  res.json({ ok: true });
});

app.post("/api/token-usage/restore-today", (req, res) => {
  // Clear offset — daily goes back to JSONL ground truth from midnight
  const d = new Date();
  const todayKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const saved = loadTokenUsage();
  if (saved.dailyOffset) delete saved.dailyOffset[todayKey];
  saveTokenUsage(saved);
  _dailyByDayCache.clear();
  broadcastTokenUsage();
  res.json({ ok: true });
});

// --- Bug Report ---

app.post("/api/bug-report", (req, res) => {
  const { title, description, steps, severity, systemInfo, screenshotPath } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: "Title is required" });
  const repo = userConfig.bugReportRepo || "john-farina/claude-cli-dashboard";
  const severityLabels = { low: "Low", medium: "Medium", high: "High", critical: "Critical" };
  let body = "";
  if (description) body += `## Description\n\n${description}\n\n`;
  if (steps) body += `## Steps to Reproduce\n\n${steps}\n\n`;
  body += `## Severity\n\n${severityLabels[severity] || "Medium"}\n\n`;
  if (systemInfo) {
    body += `## System Info\n\n\`\`\`\n`;
    body += `Dashboard: ${systemInfo.dashboardVersion} (${systemInfo.dashboardBranch})\n`;
    body += `Node: ${systemInfo.nodeVersion}\n`;
    body += `OS: ${systemInfo.platform} ${systemInfo.osVersion}\n`;
    body += `Active Agents: ${systemInfo.activeAgents}\n`;
    if (systemInfo.browser) body += `Browser: ${systemInfo.browser}\n`;
    body += `\`\`\`\n\n`;
  }
  if (screenshotPath) body += `## Screenshot\n\n*Screenshot saved locally at: \`${screenshotPath}\`*\n\n`;
  body += `---\n*Filed via CEO Dashboard Bug Report*`;
  const labels = ["bug"];
  if (severity === "critical") labels.push("priority: critical");
  else if (severity === "high") labels.push("priority: high");
  const tmpBodyFile = path.join(os.tmpdir(), `ceo-bug-report-${Date.now()}.md`);
  fs.writeFileSync(tmpBodyFile, body);
  const { execFile } = require("child_process");
  const args = ["issue", "create", "--repo", repo, "--title", title.trim(), "--body-file", tmpBodyFile];
  for (const l of labels) { args.push("--label", l); }
  execFile("gh", args, { encoding: "utf8", timeout: 30000 }, (err, stdout, stderr) => {
    try { fs.unlinkSync(tmpBodyFile); } catch {}
    if (err) {
      const output = (stdout || "") + (stderr || "");
      if (output.includes("label") && labels.length > 0) {
        const retryArgs = ["issue", "create", "--repo", repo, "--title", title.trim(), "--body-file", tmpBodyFile];
        fs.writeFileSync(tmpBodyFile, body);
        execFile("gh", retryArgs, { encoding: "utf8", timeout: 30000 }, (err2, stdout2, stderr2) => {
          try { fs.unlinkSync(tmpBodyFile); } catch {}
          if (err2) return res.status(500).json({ error: "Failed to create issue", details: (stdout2 || "") + (stderr2 || "") });
          res.json({ ok: true, issueUrl: stdout2.trim() });
        });
        return;
      }
      return res.status(500).json({ error: "Failed to create issue", details: output });
    }
    res.json({ ok: true, issueUrl: stdout.trim() });
  });
});

// --- Screenshot Capture ---

app.get("/api/screenshot-preview", (req, res) => {
  const filePath = req.query.path;
  const resolved = filePath ? path.resolve(filePath) : "";
  if (!resolved || !resolved.startsWith(UPLOADS_DIR + path.sep)) {
    return res.status(403).json({ error: "Invalid path" });
  }
  if (!fs.existsSync(resolved)) return res.status(404).json({ error: "Not found" });
  res.sendFile(resolved);
});

app.post("/api/screenshot", (req, res) => {
  const screenshotPath = path.join(UPLOADS_DIR, `screenshot-${Date.now()}.png`);
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  // screencapture -i: interactive selection mode (user drags to select area)
  // Returns exit code 1 if user cancels (presses Escape)
  execFile("screencapture", ["-i", screenshotPath], { timeout: 120000 }, (err) => {
    if (err || !fs.existsSync(screenshotPath)) {
      return res.json({ ok: false, cancelled: true });
    }
    res.json({ ok: true, path: screenshotPath });
  });
});

// --- Native app rebuild ---

app.post("/api/rebuild-native-app", (req, res) => {
  const buildScript = path.join(__dirname, "native-app", "build.sh");
  const nativeAppDir = getNativeAppDir();
  if (!fs.existsSync(buildScript)) return res.status(404).json({ error: "build.sh not found" });
  res.json({ ok: true });
  const appTitle = userConfig.title || "CEO Dashboard";
  const notify = (msg) => `osascript -e 'display notification "${msg}" with title "${appTitle}"'`;
  const script = [
    notify("Rebuilding app — compiling Swift..."),
    `CEO_NO_OPEN=1 CEO_FORCE_ICON=1 bash "${buildScript}" 2>&1`,
    `if [ $? -eq 0 ]; then`,
    `  ${notify("Build complete — reopening app")}`,
    `  sleep 0.5`,
    `  open "${nativeAppDir}"`,
    `else`,
    `  ${notify("Build failed — check the terminal for details")}`,
    `fi`,
  ].join("\n");
  const child = require("child_process").spawn("/bin/bash", ["-c", script],
    { cwd: __dirname, detached: true, stdio: "ignore" });
  child.unref();
});

app.post("/api/reopen-native-app", (req, res) => {
  const nativeAppDir = getNativeAppDir();
  res.json({ ok: true });
  const child = require("child_process").spawn("/bin/bash", ["-c",
    `sleep 1 && open "${nativeAppDir}"`
  ], { detached: true, stdio: "ignore" });
});

// --- Server self-restart ---

app.post("/api/restart-server", (req, res) => {
  res.json({ ok: true });
  for (const client of wss.clients) {
    try { client.send(JSON.stringify({ type: "server-restarting" })); } catch {}
  }
  const child = require("child_process").spawn(
    process.execPath, [path.join(__dirname, "server.js")],
    { cwd: __dirname, detached: true, stdio: "ignore", env: { ...process.env, CLAUDECODE: undefined } }
  );
  child.unref();
  setTimeout(() => process.exit(0), 300);
});

// --- WebSocket streaming ---

const prevOutputs = new Map();
const prevStatuses = new Map(); // track previous status per session for auto-rename
const _autoRenamed = new Set(); // sessions already auto-renamed (by original name)
const _pendingAutoRename = new Set(); // agents queued for rename on next idle (explicit user request)
const _firingAgents = new Set(); // agents being fired — hidden from UI, running in background
let _broadcastRunning = false;

// --- Auto-rename logic ---

function _extractText(content) {
  if (Array.isArray(content)) return content.filter(c => c.type === "text").map(c => c.text).join(" ");
  if (typeof content === "string") return content;
  return "";
}

function _parseJsonlMessages(lines) {
  const messages = [];
  let isFirstUser = true;
  for (const line of lines) {
    try {
      const d = JSON.parse(line);
      if (d.type === "user" && d.message) {
        let text = _extractText(d.message.content).trim();
        if (isFirstUser) {
          isFirstUser = false;
          text = claudeSessions.stripCeoPromptWrapper(text);
        }
        if (!text || text.length < 15) continue;
        if (text.startsWith("Tool loaded") || text.startsWith("[Request interrupted")) continue;
        if (text.includes("<system-reminder>")) text = text.split("<system-reminder>")[0].trim();
        if (text.length < 15) continue;
        if (/^\/\S+\.(png|jpg|jpeg|gif|webp)$/i.test(text.trim())) continue;
        messages.push({ role: "user", text: text.slice(0, 400) });
      }
      if (d.type === "assistant" && d.message) {
        let text = _extractText(d.message.content).trim();
        if (text && text.length > 20) {
          messages.push({ role: "assistant", text: text.slice(0, 250) });
        }
      }
    } catch {}
  }
  return messages;
}

function _getSessionContext(name) {
  const meta = loadSessionsMeta();
  const info = meta[name];
  if (!info) return null;

  let sessionId = info.resumeSessionId;
  if (!sessionId) {
    sessionId = detectClaudeSessionIdForAgent(info.workdir || DEFAULT_WORKDIR, info.created);
  }
  if (!sessionId) return null;

  const projectsDir = path.join(os.homedir(), ".claude", "projects");
  try {
    const projectDirs = fs.readdirSync(projectsDir).map(d => path.join(projectsDir, d));
    for (const dir of projectDirs) {
      const jsonlPath = path.join(dir, `${sessionId}.jsonl`);
      if (!fs.existsSync(jsonlPath)) continue;

      const stat = fs.statSync(jsonlPath);

      // Sample start (first 256KB) + end (last 128KB) for full coverage
      const startSize = Math.min(256 * 1024, stat.size);
      const startBuf = Buffer.alloc(startSize);
      const fd = fs.openSync(jsonlPath, "r");
      fs.readSync(fd, startBuf, 0, startSize, 0);

      let endLines = [];
      if (stat.size > startSize + 32 * 1024) {
        // File is large enough that end section is distinct from start
        const endSize = Math.min(128 * 1024, stat.size - startSize);
        const endBuf = Buffer.alloc(endSize);
        fs.readSync(fd, endBuf, 0, endSize, stat.size - endSize);
        const endRaw = endBuf.toString("utf8");
        // Drop first partial line
        const firstNl = endRaw.indexOf("\n");
        endLines = (firstNl >= 0 ? endRaw.slice(firstNl + 1) : endRaw).split("\n").filter(Boolean);
      }
      fs.closeSync(fd);

      const startLines = startBuf.toString("utf8").split("\n").filter(Boolean);
      const startMsgs = _parseJsonlMessages(startLines);
      const endMsgs = endLines.length > 0 ? _parseJsonlMessages(endLines) : [];

      // Sample: 3 from start, 2 from middle (if available), 3 from end
      const start = startMsgs.slice(0, 3);
      const mid = startMsgs.length > 6 ? startMsgs.slice(Math.floor(startMsgs.length / 2), Math.floor(startMsgs.length / 2) + 2) : [];
      const end = endMsgs.length > 0 ? endMsgs.slice(-3) : startMsgs.slice(-3);

      // Dedupe (end might overlap with start for short sessions)
      const seen = new Set();
      const result = [];
      for (const msg of [...start, ...mid, ...end]) {
        const key = msg.text.slice(0, 80);
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(msg);
      }
      if (result.length > 0) return result;
    }
  } catch (e) {
    console.error("[auto-rename] Error reading session context:", e.message);
  }
  return null;
}

// Cache resolved claude binary path
let _claudeBinPath = null;
function _getClaudeBin() {
  if (_claudeBinPath) return _claudeBinPath;
  const augmentedPath = `${process.env.HOME}/.local/bin:${process.env.PATH}`;
  try {
    _claudeBinPath = require("child_process").execSync("which claude", { encoding: "utf8", env: { ...process.env, PATH: augmentedPath } }).trim();
  } catch {
    _claudeBinPath = "claude";
  }
  return _claudeBinPath;
}

function _trackRenameTokenUsage() {
  // Find the most recently modified JSONL in ~/.claude/projects/ (the rename session)
  try {
    const projectsDir = path.join(os.homedir(), ".claude", "projects");
    let newest = null, newestMtime = 0;
    for (const dir of fs.readdirSync(projectsDir)) {
      const dirPath = path.join(projectsDir, dir);
      let stat;
      try { stat = fs.statSync(dirPath); } catch { continue; }
      if (!stat.isDirectory()) continue;
      for (const f of fs.readdirSync(dirPath)) {
        if (!f.endsWith(".jsonl")) continue;
        const fp = path.join(dirPath, f);
        try {
          const s = fs.statSync(fp);
          if (s.mtimeMs > newestMtime) { newestMtime = s.mtimeMs; newest = fp; }
        } catch {}
      }
    }
    // Only count if modified in the last 30s (it's from our rename call)
    if (!newest || Date.now() - newestMtime > 30000) return;
    const content = fs.readFileSync(newest, "utf8");
    const usage = parseTokenUsageFromBytes(Buffer.from(content), content.length);
    if (usage.input === 0 && usage.output === 0) return;

    const saved = loadTokenUsage();
    const d = new Date();
    const todayKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const day = saved.daily[todayKey] || { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
    day.input += usage.input;
    day.output += usage.output;
    day.cacheCreation += usage.cacheCreation;
    day.cacheRead += usage.cacheRead;
    saved.daily[todayKey] = day;
    saveTokenUsage(saved);
    console.log(`[auto-rename] Tracked ${usage.input + usage.output} tokens (${usage.input}in/${usage.output}out)`);
  } catch (e) {
    console.error("[auto-rename] Token tracking error:", e.message);
  }
}

function _generateNameWithClaude(context) {
  return new Promise((resolve) => {
    let summary = "";
    for (const msg of context.slice(0, 3)) {
      summary += `${msg.role}: ${msg.text.slice(0, 200)}\n`;
    }
    if (summary.length > 800) summary = summary.slice(0, 800);

    const prompt = `Name this coding session in kebab-case (3-5 words, e.g. "fix-auth-redirect", "add-dark-mode-toggle"). Output ONLY the name.\n\n${summary}`;

    try {
      const { spawn } = require("child_process");
      const child = spawn(_getClaudeBin(), ["-p", "--model", "claude-haiku-4-5-20251001", "--effort", "low"], {
        env: { ...process.env, CLAUDECODE: undefined, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` },
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "", stderr = "";
      child.stdout.on("data", (d) => { stdout += d; });
      child.stderr.on("data", (d) => { stderr += d; });
      child.stdin.write(prompt);
      child.stdin.end();

      const timer = setTimeout(() => { child.kill(); resolve(null); }, 20000);

      child.on("close", (code) => {
        clearTimeout(timer);
        // Track token usage from the CLI session
        _trackRenameTokenUsage();
        if (code !== 0) {
          console.error("[auto-rename] claude CLI failed (code " + code + "):", stderr.slice(0, 200));
          resolve(null);
          return;
        }
        let name = stdout.trim().toLowerCase()
          .replace(/^["'`]+|["'`]+$/g, "")
          .replace(/\s+/g, "-")
          .replace(/[^a-z0-9-]/g, "")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "");
        if (name.length < 3 || name.length > 50) {
          console.log("[auto-rename] Generated name rejected (length):", name);
          resolve(null);
          return;
        }
        resolve(name);
      });

      child.on("error", (e) => {
        clearTimeout(timer);
        console.error("[auto-rename] claude CLI error:", e.message);
        resolve(null);
      });
    } catch (e) {
      console.error("[auto-rename] claude CLI spawn error:", e.message);
      resolve(null);
    }
  });
}

function _broadcastWs(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((c) => { if (c.readyState === 1) c.send(msg); });
}

function _migrateAgentDocs(oldName, newName) {
  const oldDir = path.join(DOCS_DIR, oldName);
  const newDir = path.join(DOCS_DIR, newName);
  if (fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
    try { fs.renameSync(oldDir, newDir); } catch (e) {
      console.error(`[rename] Failed to migrate docs ${oldName} → ${newName}:`, e.message);
    }
  }
}

// Pending rename prefixes — prepended to the agent's next user message (saves a full conversation turn)
const _pendingRenamePrefix = new Map(); // agentName → prefix string

function _queueRenamePrefix(oldName, newName) {
  _pendingRenamePrefix.set(newName, `[SYSTEM: You were renamed from "${oldName}" to "${newName}". Your docs path is now docs/${newName}/. Do NOT acknowledge — just proceed with the task below.]\n\n`);
}

function _consumeRenamePrefix(agentName) {
  const prefix = _pendingRenamePrefix.get(agentName);
  if (prefix) _pendingRenamePrefix.delete(agentName);
  return prefix || "";
}

// Lightweight check: ask Haiku if current name still fits the session
function _checkNameStillFits(name, context) {
  return new Promise((resolve) => {
    // Get the last 2 messages for a quick check
    const recent = context.slice(-2);
    let snippet = "";
    for (const msg of recent) {
      snippet += `${msg.role}: ${msg.text.slice(0, 150)}\n`;
    }
    const prompt = `The current name for this coding session is "${name}". Based on the latest activity, does this name still accurately describe what the session is about? Answer ONLY "yes" or "no".

Recent activity:
${snippet}`;

    try {
      const { spawn } = require("child_process");
      const child = spawn(_getClaudeBin(), ["-p", "--model", "claude-haiku-4-5-20251001", "--effort", "low"], {
        env: { ...process.env, CLAUDECODE: undefined, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      child.stdout.on("data", (d) => { stdout += d; });
      child.stdin.write(prompt);
      child.stdin.end();
      const timer = setTimeout(() => { child.kill(); resolve(true); }, 15000);
      child.on("close", (code) => {
        clearTimeout(timer);
        _trackRenameTokenUsage();
        if (code !== 0) { resolve(true); return; }
        const answer = stdout.trim().toLowerCase();
        resolve(answer.startsWith("yes"));
      });
      child.on("error", () => { clearTimeout(timer); resolve(true); });
    } catch { resolve(true); }
  });
}

const _renameInProgress = new Set(); // prevent concurrent renames for same agent
const _lastRenameCheck = new Map(); // name → timestamp of last rename check
const _lastRenameContextLen = new Map(); // name → context length at last check
const RENAME_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes between rename checks

async function tryAutoRename(name, output) {
  if (_renameInProgress.has(name)) return;
  const isQueued = _pendingAutoRename.has(name);
  const meta = loadSessionsMeta();
  const agentMeta = meta[name];

  if (!isQueued) {
    if (!agentMeta?.autoRename) return;
  }

  const isFirstRename = !_autoRenamed.has(name);
  _pendingAutoRename.delete(name);

  // Step 1: Cooldown — skip if checked recently (unless first rename or queued)
  if (!isFirstRename && !isQueued) {
    const lastCheck = _lastRenameCheck.get(name) || 0;
    if (Date.now() - lastCheck < RENAME_COOLDOWN_MS) return;
  }

  _renameInProgress.add(name);
  let _renamedTo = null; // track new name for cleanup on error

  try {
    // Get session context from JSONL files
    const context = _getSessionContext(name);
    if (!context || context.length === 0) {
      console.log(`[auto-rename] No session context found for ${name}, skipping`);
      return;
    }

    // Step 2: Skip if conversation hasn't advanced since last check
    if (!isFirstRename && !isQueued) {
      const prevLen = _lastRenameContextLen.get(name) || 0;
      if (context.length === prevLen) return;
    }
    _lastRenameCheck.set(name, Date.now());
    _lastRenameContextLen.set(name, context.length);

    // For agents already renamed: lightweight check if name still fits
    if (!isFirstRename && !isQueued) {
      const stillFits = await _checkNameStillFits(name, context);
      if (stillFits) {
        console.log(`[auto-rename] Name "${name}" still fits, skipping`);
        return;
      }
      console.log(`[auto-rename] Name "${name}" is stale, renaming`);
    }

    _autoRenamed.add(name);

    // Broadcast "renaming" indicator to clients
    _broadcastWs({ type: "renaming", session: name, renaming: true });

    const newName = await _generateNameWithClaude(context);
    if (!newName || newName === name) return;

    // Check for conflicts
    const session = `${PREFIX}${name}`;
    const existing = listTmuxSessions();
    if (!existing.includes(session)) return;
    let finalName = newName;
    if (existing.includes(`${PREFIX}${finalName}`)) {
      let i = 1;
      while (existing.includes(`${PREFIX}${finalName}-${i}`)) i++;
      finalName = `${finalName}-${i}`;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(finalName)) return;

    // Block the new name from broadcasts BEFORE the tmux rename to prevent
    // a race where broadcastOutputs picks up the new tmux session name
    // before the frontend receives the rename WS message (causing duplicate cards).
    _renameInProgress.add(finalName);
    _renamedTo = finalName;

    tmuxExec(`rename-session -t ${session} ${PREFIX}${finalName}`);
    invalidateTmuxSessionsCache();
    const freshMeta = loadSessionsMeta();
    freshMeta[finalName] = { ...freshMeta[name], autoRename: true };
    delete freshMeta[name];
    saveSessionsMeta(freshMeta);

    // Update cache keys
    const cachedOutput = prevOutputs.get(session);
    if (cachedOutput) {
      prevOutputs.delete(session);
      prevOutputs.set(`${PREFIX}${finalName}`, cachedOutput);
    }
    const cachedStatus = prevStatuses.get(session);
    if (cachedStatus) {
      prevStatuses.delete(session);
      prevStatuses.set(`${PREFIX}${finalName}`, cachedStatus);
    }

    _autoRenamed.add(finalName);
    _migrateAgentDocs(name, finalName);
    _broadcastWs({ type: "rename", oldName: name, newName: finalName });
    _queueRenamePrefix(name, finalName);
    console.log(`[auto-rename] ${name} → ${finalName}`);
    _renameInProgress.delete(name);
    // Keep finalName in _renameInProgress briefly so the next broadcast cycle
    // doesn't race the client processing the rename message
    setTimeout(() => _renameInProgress.delete(finalName), 2000);
    _renamedTo = null; // success — cleanup handled by setTimeout above
  } catch (e) {
    console.error(`[auto-rename] Failed to rename ${name}:`, e.message);
  } finally {
    _renameInProgress.delete(name);
    if (_renamedTo) _renameInProgress.delete(_renamedTo);
    _broadcastWs({ type: "renaming", session: name, renaming: false });
  }
}

async function broadcastOutputs() {
  if (wss.clients.size === 0) return;
  if (_broadcastRunning) return;
  _broadcastRunning = true;
  try {
    syncClaudeSessionIds();
    const sessions = await listTmuxSessionsAsync();
    const meta = loadSessionsMeta();
    const agentSessions = sessions.filter((s) => {
      const n = s.replace(PREFIX, "");
      if (meta[n]?.type === "terminal") return false;
      if (/-term(-\d+)?$/.test(n)) return false;
      if (_firingAgents.has(n)) return false;
      if (_renameInProgress.has(n)) return false;
      return true;
    });
    const captures = await Promise.all(
      agentSessions.map(async (session) => {
        const output = await capturePaneAsync(session);
        return { session, output };
      })
    );
    const pendingRenames = [];
    for (const { session, output } of captures) {
      if (!output) continue;
      const name = session.replace(PREFIX, "");
      const prev = prevOutputs.get(session) || "";
      if (output !== prev) {
        const status = detectStatus(output, prev);
        const filteredOutput = stripCeoPreamble(output);
        const promptType = status === "waiting" ? detectPromptType(filteredOutput) : null;
        const promptOptions = promptType === "question" ? parsePromptOptions(filteredOutput) : null;
        prevOutputs.set(session, output);
        fileTracker.updateAgentFiles(name, output);

        // Track status transitions for auto-rename
        const prevStatus = prevStatuses.get(session);
        prevStatuses.set(session, status);
        // Trigger on any transition to idle (working→idle, waiting→idle, asking→idle)
        if (status === "idle" && prevStatus && prevStatus !== "idle") {
          pendingRenames.push({ name, output });
        }

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
      // Also check _pendingAutoRename for agents already idle (no output change needed)
      if (_pendingAutoRename.has(name)) {
        const curStatus = detectStatus(output);
        if (curStatus === "idle") {
          pendingRenames.push({ name, output });
        }
      }
    }
    // Process auto-renames after all output messages are sent
    for (const { name, output } of pendingRenames) {
      tryAutoRename(name, output);
    }
  } finally {
    _broadcastRunning = false;
  }
}

let forceUpdateTimer = null;
function scheduleForceUpdate() {
  if (forceUpdateTimer) return;
  const delays = [50, 150, 400, 800, 1500, 3000];
  const timeouts = delays.map((ms) => setTimeout(broadcastOutputs, ms));
  forceUpdateTimer = setTimeout(() => { forceUpdateTimer = null; }, delays[delays.length - 1] + 100);
}

// --- WebSocket heartbeat ---
const WS_PING_INTERVAL = 15000;
const WS_PONG_TIMEOUT = 10000;

const shellClients = getShellClients();

const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws._isAlive === false) {
      shellClients.delete(ws);
      return ws.terminate();
    }
    ws._isAlive = false;
    ws.ping();
  });
}, WS_PING_INTERVAL);

wss.on("close", () => clearInterval(heartbeatInterval));
wss.on("error", (err) => { console.error("[wss] WebSocket server error:", err.message); });

wss.on("connection", (ws) => {
  ws._isAlive = true;
  ws.on("pong", () => { ws._isAlive = true; });

  // Send initial full state async
  (async () => {
    try {
      const allSessions = await listTmuxSessionsAsync();
      const meta = loadSessionsMeta();
      const sessions = allSessions.filter((s) => {
        const n = s.replace(PREFIX, "");
        return !_firingAgents.has(n) && !_renameInProgress.has(n);
      });
      const captures = await Promise.all(
        sessions.map(async (session) => ({
          session,
          output: await capturePaneAsync(session),
        }))
      );
      const sessionInfos = [];
      for (const { session, output } of captures) {
        const name = session.replace(PREFIX, "");
        const isTerminal = meta[name]?.type === "terminal";
        const liveCwd = isTerminal ? null : await getEffectiveCwdAsync(session, output);
        const git = isTerminal ? null : await getCachedGitInfo(liveCwd);
        if (!isTerminal) {
          prevOutputs.set(session, output);
          const initStatus = detectStatus(output, "");
          const filteredOutput = stripCeoPreamble(output);
          const initPromptType = initStatus === "waiting" ? detectPromptType(filteredOutput) : null;
          const initPromptOptions = initPromptType === "question" ? parsePromptOptions(filteredOutput) : null;
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: "output",
              session: name,
              lines: filterOutputForDisplay(output.split("\n")),
              status: initStatus,
              promptType: initPromptType,
              promptOptions: initPromptOptions,
              workdir: liveCwd || null,
              branch: git?.branch || null,
              isWorktree: git?.isWorktree || false,
            }));
          }
        }
        sessionInfos.push({
          name,
          workdir: liveCwd || meta[name]?.workdir || DEFAULT_WORKDIR,
          created: meta[name]?.created || null,
          branch: git?.branch || null,
          isWorktree: git?.isWorktree || false,
          autoRename: meta[name]?.autoRename || false,
          favorite: meta[name]?.favorite || false,
          minimized: meta[name]?.minimized || false,
          type: meta[name]?.type || "agent",
        });
      }
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "sessions", sessions: sessionInfos }));
        ws.send(JSON.stringify({ type: "token-usage", usage: _tokenUsageTotals }));
        ws.send(JSON.stringify({ type: "todo-update", data: loadTodos() }));
        ws.send(JSON.stringify({ type: "favorites-update", data: loadFavorites() }));
      }
    } catch (err) {
      console.error("[ws] Error sending initial state:", err.message);
      // Fallback: send session list from metadata even if pane capture failed
      try {
        const fallbackSessionsRaw = listTmuxSessions();
        const fallbackMeta = loadSessionsMeta();
        const fallbackSessions = fallbackSessionsRaw.filter((s) => {
          const n = s.replace(PREFIX, "");
          return !_firingAgents.has(n) && !_renameInProgress.has(n);
        });
        const sessionInfos = fallbackSessions.map((session) => {
          const name = session.replace(PREFIX, "");
          return {
            name,
            workdir: fallbackMeta[name]?.workdir || DEFAULT_WORKDIR,
            created: fallbackMeta[name]?.created || null,
            branch: null,
            isWorktree: false,
            autoRename: fallbackMeta[name]?.autoRename || false,
            favorite: fallbackMeta[name]?.favorite || false,
            minimized: fallbackMeta[name]?.minimized || false,
            type: fallbackMeta[name]?.type || "agent",
          };
        });
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "sessions", sessions: sessionInfos }));
          ws.send(JSON.stringify({ type: "token-usage", usage: _tokenUsageTotals }));
          ws.send(JSON.stringify({ type: "todo-update", data: loadTodos() }));
          ws.send(JSON.stringify({ type: "favorites-update", data: loadFavorites() }));
        }
      } catch (fallbackErr) {
        console.error("[ws] Fallback session send also failed:", fallbackErr.message);
      }
    }
  })();

  // Register for shell PTY output
  shellClients.add(ws);
  ws.on("close", () => {
    shellClients.delete(ws);
    for (const [tName] of terminalPtys) {
      detachTerminalClient(tName, ws);
    }
  });

  ensureShellPty();
  const shellPty = getShellPty();
  if (!shellPty) {
    try { ws.send(JSON.stringify({ type: "shell-unavailable" })); } catch {}
  }
  startShellInfoPolling();

  // Replay shell scrollback
  const _shellScrollback = getShellScrollback();
  const scrollback = getScrollback(_shellScrollback);
  if (scrollback) {
    const buf = Buffer.from(scrollback, "utf8");
    const CHUNK = 32768;
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

  // Send current shell info
  const _lastShellCwd = getLastShellCwd();
  const _lastShellBranch = getLastShellBranch();
  const _lastShellIsWorktree = getLastShellIsWorktree();
  const _lastShellPrUrl = getLastShellPrUrl();
  if (_lastShellCwd) {
    ws.send(JSON.stringify({
      type: "shell-info",
      cwd: _lastShellCwd,
      branch: _lastShellBranch,
      isWorktree: _lastShellIsWorktree,
      prUrl: _lastShellPrUrl !== undefined ? _lastShellPrUrl : null,
    }));
  } else {
    (async () => {
      const cwd = await getShellCwdAsync();
      if (cwd && ws.readyState === 1) {
        const git = await getGitInfoAsync(cwd);
        ws.send(JSON.stringify({
          type: "shell-info", cwd,
          branch: git?.branch || null,
          isWorktree: git?.isWorktree || false,
          prUrl: null,
        }));
        lookupPrUrl(cwd, git?.branch || null);
      }
    })();
  }

  // Handle incoming messages
  ws.on("message", (data) => {
    try {
      // Binary frame = shell-stdin or terminal card
      if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        if (buf.length > 0 && buf[0] === 0x01) {
          const text = buf.toString("utf8", 1);
          if (!ws._shellCmdBuf) ws._shellCmdBuf = "";
          if (text === "\r" || text === "\n") {
            if (ws._shellCmdBuf.trim()) shellLog("shell-cmd", { cmd: ws._shellCmdBuf.trim() });
            ws._shellCmdBuf = "";
          } else if (text === "\x7f") {
            ws._shellCmdBuf = ws._shellCmdBuf.slice(0, -1);
          } else if (text.length === 1 && text.charCodeAt(0) >= 32) {
            ws._shellCmdBuf += text;
          } else if (text.length > 1 && !text.startsWith("\x1b")) {
            ws._shellCmdBuf += text;
          }
          ensureShellPty();
          const sp = getShellPty();
          if (sp) sp.write(text);
          return;
        }
        if (buf.length > 2 && buf[0] === 0x03) {
          const nameLen = buf[1];
          if (buf.length >= 2 + nameLen) {
            const tName = buf.toString("utf8", 2, 2 + nameLen);
            const tData = buf.toString("utf8", 2 + nameLen);
            if (/^[a-zA-Z0-9_-]+$/.test(tName)) writeTerminalStdin(tName, tData);
          }
          return;
        }
        if (buf.length > 2 && buf[0] === 0x04) {
          const nameLen = buf[1];
          if (buf.length >= 2 + nameLen + 4) {
            const tName = buf.toString("utf8", 2, 2 + nameLen);
            const cols = buf.readUInt16BE(2 + nameLen);
            const rows = buf.readUInt16BE(2 + nameLen + 2);
            if (/^[a-zA-Z0-9_-]+$/.test(tName) && cols > 0 && rows > 0) resizeTerminalPty(tName, cols, rows);
          }
          return;
        }
      }

      const msg = JSON.parse(data);
      if (msg.session && (typeof msg.session !== "string" || !/^[a-zA-Z0-9_-]+$/.test(msg.session))) return;

      if (msg.type === "input") {
        const session = `${PREFIX}${msg.session}`;
        const renamePrefix = _consumeRenamePrefix(msg.session);
        const text = renamePrefix + (msg.text || "");
        listTmuxSessionsAsync().then((sessions) => {
          if (sessions.includes(session)) { sendKeys(session, text); scheduleForceUpdate(); }
        });
      }
      if (msg.type === "input-with-images") {
        const session = `${PREFIX}${msg.session}`;
        const renamePrefix = _consumeRenamePrefix(msg.session);
        const text = renamePrefix + (msg.text || "");
        listTmuxSessionsAsync().then((sessions) => {
          if (sessions.includes(session)) { sendKeysWithImages(session, text, msg.paths || []); scheduleForceUpdate(); }
        });
      }
      if (msg.type === "keypress") {
        const session = `${PREFIX}${msg.session}`;
        const keys = Array.isArray(msg.keys) ? msg.keys : [msg.keys];
        const validKeys = keys.filter(isValidTmuxKey);
        if (validKeys.length === 0) return;
        listTmuxSessionsAsync().then((sessions) => {
          if (sessions.includes(session)) { tmuxExecAsync(`send-keys -t ${session} ${validKeys.join(" ")}`); scheduleForceUpdate(); }
        });
      }
      if (msg.type === "shell-stdin") {
        ensureShellPty();
        const sp = getShellPty();
        if (sp) sp.write(msg.data);
      }
      if (msg.type === "shell-resize") {
        const sp = getShellPty();
        if (sp && msg.cols && msg.rows) sp.resize(Math.max(1, msg.cols), Math.max(1, msg.rows));
      }
      if (msg.type === "terminal-subscribe" && msg.session) attachTerminalClient(msg.session, ws);
      if (msg.type === "terminal-unsubscribe" && msg.session) detachTerminalClient(msg.session, ws);
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
                  type: "output", session: msg.session,
                  lines: filterOutputForDisplay(output.split("\n")),
                  status, promptType, promptOptions,
                  workdir: liveCwd || null, branch: git?.branch || null, isWorktree: git?.isWorktree || false,
                }));
              }
            }
          }
        })();
      }
      if (msg.type === "input-sync") {
        const payload = JSON.stringify({ type: "input-sync", session: msg.session, text: msg.text });
        wss.clients.forEach((client) => {
          if (client !== ws && client.readyState === 1) client.send(payload);
        });
      }
      if (msg.type === "type-option") {
        const session = `${PREFIX}${msg.session}`;
        listTmuxSessionsAsync().then((sessions) => {
          if (sessions.includes(session)) {
            const navKeys = Array.isArray(msg.keys) ? msg.keys : [msg.keys];
            const validNavKeys = navKeys.filter(isValidTmuxKey);
            if (validNavKeys.length > 0) tmuxExecAsync(`send-keys -t ${session} ${validNavKeys.join(" ")}`);
            setTimeout(() => { sendKeys(session, msg.text); }, 400);
            scheduleForceUpdate();
          }
        });
      }
    } catch {}
  });

  ws.on("close", () => {});
});

// Single global poll
setInterval(() => { broadcastOutputs(); }, POLL_INTERVAL);

// Token usage sync — every 5s
setInterval(broadcastTokenUsage, 5000);

// Broadcast file overlaps every 15s
setInterval(() => {
  const overlaps = fileTracker.getOverlaps();
  const msg = JSON.stringify({ type: "file-overlaps", overlaps: overlaps.length > 0 ? overlaps : [] });
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}, 15000);

// --- Start ---

// Caffeinate
let caffeinateProc = null;
function startCaffeinate() {
  try {
    caffeinateProc = spawn("caffeinate", ["-s", "-i"], { stdio: "ignore", detached: false });
    caffeinateProc.on("error", () => {});
    caffeinateProc.on("exit", () => { caffeinateProc = null; });
    console.log("[caffeinate] Sleep prevention active (pid " + caffeinateProc.pid + ")");
  } catch {}
}
function stopCaffeinate() {
  if (caffeinateProc) { caffeinateProc.kill(); caffeinateProc = null; console.log("[caffeinate] Sleep prevention stopped"); }
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
          if (/^\d+$/.test(pid)) { try { process.kill(Number(pid), "SIGKILL"); } catch {} }
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
  for (const dir of [path.join(__dirname, "docs"), path.join(os.homedir(), ".claude", "docs")]) {
    try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch {}
  }
  startCaffeinate();
  ensureTmuxServer();
  try { tmuxExec("kill-session -t _ceo_shell"); } catch {}
  ensureShellPty();
  startShellInfoPolling();
  restoreSessions(detectClaudeSessionIdForAgent);
  _tokenUsageTotals = loadTokenUsage();
  // Auto-rebuild native app if binary is stale (main.swift changed since last compile)
  {
    const nativeAppDir = getNativeAppDir();
    const buildCache = path.join(__dirname, "native-app", ".build-cache", "swift.hash");
    const mainSwift = path.join(__dirname, "native-app", "main.swift");
    if (fs.existsSync(nativeAppDir) && fs.existsSync(mainSwift)) {
      try {
        const currentHash = execSync(`shasum -a 256 "${mainSwift}" | cut -d' ' -f1`, { encoding: "utf8" }).trim() + "|" + __dirname;
        const cachedHash = fs.existsSync(buildCache) ? fs.readFileSync(buildCache, "utf8").trim() : "";
        const lockFile = "/tmp/ceo-rebuild.lock";
        const lockStale = fs.existsSync(lockFile) && (Date.now() - fs.statSync(lockFile).mtimeMs > 120000);
        if (currentHash !== cachedHash && (!fs.existsSync(lockFile) || lockStale)) {
          console.log("[native-app] Binary is stale — rebuilding with progress window...");
          fs.writeFileSync(lockFile, String(process.pid));
          const appTitle = userConfig.title || "CEO Dashboard";
          const buildScript = path.join(__dirname, "native-app", "build.sh");
          const progressSrc = path.join(__dirname, "native-app", "rebuild-progress.swift");
          const statusFile = "/tmp/ceo-rebuild-status";
          const titleFile = "/tmp/ceo-rebuild-title";
          const progressBin = "/tmp/ceo-rebuild-progress";
          const script = `#!/bin/bash
STATUS="${statusFile}"
rm -f "$STATUS"

echo "Updating ${appTitle}..." > "${titleFile}"
echo "PROGRESS:5:1:6:Compiling progress window..." > "$STATUS"
swiftc "${progressSrc}" -o "${progressBin}" -framework Cocoa -O 2>/tmp/ceo-rebuild.log
if [ $? -ne 0 ]; then
    osascript -e 'display notification "Progress window failed to compile" with title "${appTitle}"'
else
    "${progressBin}" &
    PROGRESS_PID=$!
fi

sleep 0.5
echo "PROGRESS:10:1:6:Closing app for rebuild..." > "$STATUS"
osascript -e 'tell application "${appTitle}" to quit' 2>/dev/null
sleep 1
echo "PROGRESS:15:2:6:Compiling Swift application..." > "$STATUS"

cd "${__dirname}"
bash "${buildScript}" > /tmp/ceo-rebuild.log 2>&1 &
BUILD_PID=$!

LAST_STAGE=""
while kill -0 $BUILD_PID 2>/dev/null; do
    if [ -f /tmp/ceo-rebuild.log ]; then
        CURRENT=$(tail -1 /tmp/ceo-rebuild.log 2>/dev/null)
        if [ "$CURRENT" != "$LAST_STAGE" ] && [ -n "$CURRENT" ]; then
            LAST_STAGE="$CURRENT"
            case "$CURRENT" in
                *"Compiled Swift"*)
                    echo "PROGRESS:50:3:6:Generating app icon..." > "$STATUS" ;;
                *"Generated app icon"*)
                    echo "PROGRESS:70:4:6:Code signing..." > "$STATUS" ;;
                *"Signed with"*|*"ad-hoc signing"*)
                    echo "PROGRESS:85:5:6:Registering with Launch Services..." > "$STATUS" ;;
                *"Installed to"*)
                    echo "PROGRESS:95:6:6:Finalizing..." > "$STATUS" ;;
            esac
        fi
    fi
    sleep 0.3
done

wait $BUILD_PID
BUILD_EXIT=$?

if [ $BUILD_EXIT -eq 0 ]; then
    echo "DONE:Build complete — reopening app" > "$STATUS"
    sleep 2
    open "${nativeAppDir}"
else
    echo "FAIL:Build failed — see /tmp/ceo-rebuild.log" > "$STATUS"
    sleep 5
fi

[ -n "$PROGRESS_PID" ] && kill $PROGRESS_PID 2>/dev/null
rm -f "${statusFile}" "${titleFile}" /tmp/ceo-rebuild-screen /tmp/ceo-rebuild.lock
`;
          const scriptPath = "/tmp/ceo-rebuild.sh";
          fs.writeFileSync(scriptPath, script, { mode: 0o755 });
          require("child_process").spawn("/bin/bash", [scriptPath],
            { cwd: __dirname, detached: true, stdio: "ignore" }).unref();
        }
      } catch (err) {
        console.error("[native-app] Auto-rebuild check failed:", err.message);
      }
    }
  }
  setTimeout(() => { claudeSessions.resetSyncTimer(); syncClaudeSessionIds(); }, 10000);
  setTimeout(() => { syncTokenUsage(); }, 15000);
  setTimeout(() => { loadClaudeSessionsAsync(null).catch(() => {}); }, 2000);
});

// --- Hot reload ---
let hotReloadVersion = Date.now();

app.get("/api/version", (req, res) => { res.json({ version: hotReloadVersion }); });

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
      const output = prevOutputs.get(session) || "";
      if (output) {
        const status = detectStatus(output, "");
        if (status !== "idle") return true;
      }
    }
    return false;
  }

  let lastReloadTime = 0;
  const RELOAD_COOLDOWN = 10000;

  function doReload() {
    if (!pendingReload) return;
    if (isAnyCeoDashboardAgentBusy()) return;
    if (Date.now() - lastReloadTime < RELOAD_COOLDOWN) return;
    pendingReload = false;
    lastReloadTime = Date.now();
    hotReloadVersion = Date.now();
    console.log("[hot-reload] agents done, reloading browsers");
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(JSON.stringify({ type: "reload" }));
    }
  }

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
      doReload();
    }, 300);
  });
}
