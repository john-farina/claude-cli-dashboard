// --- Claude session history: scanning, parsing, session ID detection ---
const path = require("path");
const fs = require("fs");

let CLAUDE_DIR = "";
let DEFAULT_WORKDIR = "";
let _loadSessionsMeta = null;
let _saveSessionsMeta = null;

function init(config) {
  CLAUDE_DIR = config.CLAUDE_DIR;
  DEFAULT_WORKDIR = config.DEFAULT_WORKDIR;
  _loadSessionsMeta = config.loadSessionsMeta;
  _saveSessionsMeta = config.saveSessionsMeta;
}

// Cache for session list
let _claudeSessionsCache = null;
let _claudeSessionsCacheTime = 0;
const CLAUDE_SESSIONS_CACHE_TTL = 30000;

// Cache parsed session metadata by file
const sessionFileCache = new Map();

// --- CEO prompt stripping ---
function stripCeoPromptWrapper(raw) {
  if (!raw) return "";
  if (raw.includes("[END_CEO_PROMPT]")) {
    const endIdx = raw.indexOf("[END_CEO_PROMPT]");
    raw = raw.slice(endIdx + "[END_CEO_PROMPT]".length);
    return raw.trim();
  }
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

// --- Session file parsing ---
function parseSessionFile(filePath, stat, projectDir) {
  const cached = sessionFileCache.get(filePath);
  if (cached && cached.mtime === stat.mtimeMs) return cached.entry;

  const fd = fs.openSync(filePath, "r");
  try {
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
          }
        }
      } catch {}
    }

    if (!sessionId) {
      sessionId = path.basename(filePath, ".jsonl");
    }

    let gitBranch = null;
    let modified = stat.mtimeMs;
    let projectPath = null;
    let lastPrompt = null;

    const tailSize = Math.min(16384, stat.size);
    const tailBuf = Buffer.alloc(tailSize);
    fs.readSync(fd, tailBuf, 0, tailSize, Math.max(0, stat.size - tailSize));
    const tailStr = tailBuf.toString("utf8");
    const tailLines = tailStr.split("\n").filter(Boolean);

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

// --- Scanning ---
function _formatEntries(entries) {
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

function _dedupeAndSort(entries) {
  const seen = new Set();
  entries = entries.filter((e) => {
    if (!e.sessionId || seen.has(e.sessionId)) return false;
    seen.add(e.sessionId);
    return true;
  });
  entries.sort((a, b) => (b.modified || 0) - (a.modified || 0));
  return entries;
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
  return _formatEntries(_dedupeAndSort(entries));
}

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
      await new Promise((r) => setImmediate(r));
    }
  } catch {
    return [];
  }
  return _formatEntries(_dedupeAndSort(entries));
}

function _filterByQuery(entries, query) {
  if (!query) return entries;
  const q = query.toLowerCase();
  return entries.filter((e) => {
    const prompt = (e.firstPrompt || "").toLowerCase();
    const branch = (e.gitBranch || "").toLowerCase();
    return prompt.includes(q) || branch.includes(q);
  });
}

function loadClaudeSessions(query) {
  const now = Date.now();
  if (_claudeSessionsCache && now - _claudeSessionsCacheTime < CLAUDE_SESSIONS_CACHE_TTL) {
    return _filterByQuery(_claudeSessionsCache, query);
  }
  const entries = _scanClaudeSessions();
  _claudeSessionsCache = entries;
  _claudeSessionsCacheTime = now;
  return _filterByQuery(entries, query);
}

async function loadClaudeSessionsAsync(query) {
  const now = Date.now();
  if (_claudeSessionsCache && now - _claudeSessionsCacheTime < CLAUDE_SESSIONS_CACHE_TTL) {
    return _filterByQuery(_claudeSessionsCache, query);
  }
  const entries = await _scanClaudeSessionsAsync();
  _claudeSessionsCache = entries;
  _claudeSessionsCacheTime = now;
  return _filterByQuery(entries, query);
}

// --- Session ID detection for --resume ---
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
          if (!entry.projectPath || entry.projectPath !== agentWorkdir) continue;
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

// --- Periodic sync ---
let lastSessionIdSync = 0;
const SESSION_ID_SYNC_INTERVAL = 30000;

function syncClaudeSessionIds() {
  const now = Date.now();
  if (now - lastSessionIdSync < SESSION_ID_SYNC_INTERVAL) return;
  lastSessionIdSync = now;

  const meta = _loadSessionsMeta();
  let changed = false;

  const claimedIds = new Set();
  for (const info of Object.values(meta)) {
    if (info.resumeSessionId) claimedIds.add(info.resumeSessionId);
  }

  for (const [name, info] of Object.entries(meta)) {
    if (info.resumeSessionId) continue;
    const workdir = info.workdir || DEFAULT_WORKDIR;
    const sessionId = detectClaudeSessionIdForAgent(workdir, info.created);
    if (sessionId && !claimedIds.has(sessionId)) {
      info.resumeSessionId = sessionId;
      claimedIds.add(sessionId);
      changed = true;
    }
  }

  if (changed) {
    _saveSessionsMeta(meta);
  }
}

// Reset sync timer (used after server start delay)
function resetSyncTimer() {
  lastSessionIdSync = 0;
}

module.exports = {
  init,
  loadClaudeSessions,
  loadClaudeSessionsAsync,
  detectClaudeSessionIdForAgent,
  syncClaudeSessionIds,
  resetSyncTimer,
  stripCeoPromptWrapper,
  parseSessionFile,
};
