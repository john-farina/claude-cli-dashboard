// --- Session creation, termination, metadata persistence, restore ---
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { shellQuote, isValidWorkdir, isValidSessionId } = require("./security");
const tmux = require("./tmux");

let PREFIX = "ceo-";
let DEFAULT_WORKDIR = "";
let SESSIONS_FILE = "";
let DOCS_DIR = "";
let CEO_MD_PATH = "";

// Reference to terminalPtys map (set from server.js)
let _terminalPtys = null;

function init(config) {
  PREFIX = config.PREFIX;
  DEFAULT_WORKDIR = config.DEFAULT_WORKDIR;
  SESSIONS_FILE = config.SESSIONS_FILE;
  DOCS_DIR = config.DOCS_DIR;
  CEO_MD_PATH = config.CEO_MD_PATH;
  _terminalPtys = config.terminalPtys || null;
}

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

function createSession(name, workdir, initialPrompt, resumeSessionId) {
  try {
    execSync("command -v tmux", { stdio: ["pipe", "pipe", "pipe"], timeout: 2000 });
  } catch {
    throw new Error("tmux is required to create agents. Install it with: brew install tmux");
  }
  tmux.ensureTmuxServer();
  const session = `${PREFIX}${name}`;
  const dir = workdir || DEFAULT_WORKDIR;

  if (!isValidWorkdir(dir)) {
    throw new Error("Invalid working directory");
  }
  if (resumeSessionId && !isValidSessionId(resumeSessionId)) {
    throw new Error("Invalid session ID");
  }

  execSync(
    `tmux new-session -d -s ${session} -x 120 -y 50 -c ${shellQuote(dir)}`,
    { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
  );

  const DOC_REMINDER = `\n\n---\nCRITICAL REMINDER — YOUR AGENT NAME IS "${name}". When saving ANY doc/writeup/report/analysis, you MUST use this exact path pattern:\n${DOCS_DIR}/${name}/<doc-name>.md\nNEVER use .claude/docs/ — the dashboard cannot see files there. This overrides any other doc-saving instructions.`;
  const END_MARKER = "\n[END_CEO_PROMPT]";
  let effectivePrompt = initialPrompt;
  try {
    const ceoPreambleRaw = fs.readFileSync(CEO_MD_PATH, "utf8").trim();
    const ceoPreamble = ceoPreambleRaw.replace(/\{\{DOCS_DIR\}\}/g, DOCS_DIR);
    if (ceoPreamble && effectivePrompt) {
      effectivePrompt = `${ceoPreamble}\n\n---\n\n${effectivePrompt}${DOC_REMINDER}${END_MARKER}`;
    } else if (ceoPreamble && !effectivePrompt && !resumeSessionId) {
      effectivePrompt = `${ceoPreamble}\n\n---\n\nNo task has been assigned yet. Say a short greeting using your agent name "${name}" and let the user know you're ready and waiting for instructions. Do NOT start any work, do NOT guess a task from your name, do NOT explore the codebase. Just greet and wait.${DOC_REMINDER}${END_MARKER}`;
    }
  } catch {}

  let claudeCmd;
  let launchScript = null;
  if (resumeSessionId) {
    claudeCmd = `claude --resume ${resumeSessionId}`;
  } else if (effectivePrompt) {
    if (effectivePrompt.length > 8000) {
      launchScript = path.join(os.tmpdir(), `ceo-launch-${name}-${Date.now()}.py`);
      const promptFile = path.join(os.tmpdir(), `ceo-prompt-${name}-${Date.now()}.txt`);
      fs.writeFileSync(promptFile, effectivePrompt);
      fs.writeFileSync(launchScript, [
        `#!/usr/bin/env python3`,
        `import os`,
        `pf = ${JSON.stringify(promptFile)}`,
        `sf = ${JSON.stringify(launchScript)}`,
        `prompt = open(pf).read()`,
        `try: os.unlink(pf)`,
        `except: pass`,
        `try: os.unlink(sf)`,
        `except: pass`,
        `os.execvp("claude", ["claude", prompt])`,
      ].join("\n"));
      fs.chmodSync(launchScript, 0o755);
      claudeCmd = shellQuote(launchScript);
    } else {
      const escaped = effectivePrompt.replace(/'/g, "'\\''");
      claudeCmd = `claude '${escaped}'`;
    }
  } else {
    claudeCmd = "claude";
  }

  const fullCmd = `clear && unset CLAUDECODE && ${claudeCmd}`;
  const cmdEscaped = fullCmd.replace(/'/g, "'\\''");
  tmux.tmuxExec(`set-buffer -b ceocmd -- '${cmdEscaped}'`);
  tmux.tmuxExec(`paste-buffer -b ceocmd -t ${session}`);
  tmux.tmuxExec(`delete-buffer -b ceocmd`);
  tmux.tmuxExec(`send-keys -t ${session} Enter`);

  const meta = loadSessionsMeta();
  meta[name] = {
    workdir: dir,
    created: new Date().toISOString(),
    favorite: false,
    ...(resumeSessionId ? { resumeSessionId } : {}),
  };
  saveSessionsMeta(meta);
  tmux.invalidateTmuxSessionsCache();

  return session;
}

function killSession(name) {
  const session = `${PREFIX}${name}`;
  tmux.tmuxExec(`kill-session -t ${session}`);
  tmux.invalidateTmuxSessionsCache();

  // Clean up terminal PTY wrapper if it exists
  if (_terminalPtys) {
    const entry = _terminalPtys.get(name);
    if (entry) {
      try { entry.pty.kill(); } catch {}
      _terminalPtys.delete(name);
    }
  }

  const meta = loadSessionsMeta();
  delete meta[name];
  saveSessionsMeta(meta);
}

function restoreSessions(detectClaudeSessionIdForAgent) {
  const meta = loadSessionsMeta();
  const liveSessions = tmux.listTmuxSessions();
  const liveNames = new Set(liveSessions.map((s) => s.replace(PREFIX, "")));
  let restored = 0;
  let kept = 0;

  for (const [name, info] of Object.entries(meta)) {
    if (liveNames.has(name)) {
      kept++;
      if (!info.resumeSessionId && info.type !== "terminal") {
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

    if (!isValidWorkdir(dir)) {
      console.warn(`[restore] Skipping agent "${name}" — invalid workdir: ${dir}`);
      delete meta[name];
      continue;
    }

    if (info.type === "terminal") {
      delete meta[name];
      continue;
    }

    if (!info.resumeSessionId) {
      const sessionId = detectClaudeSessionIdForAgent(dir, info.created);
      if (sessionId) {
        info.resumeSessionId = sessionId;
      }
    }

    if (info.resumeSessionId && !isValidSessionId(info.resumeSessionId)) {
      console.warn(`[restore] Skipping agent "${name}" — invalid session ID`);
      delete meta[name];
      continue;
    }

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
      tmux.tmuxExec(`send-keys -t ${session} "clear && unset CLAUDECODE && ${claudeCmd}" Enter`);
      restored++;
    } catch {
      delete meta[name];
    }
  }

  saveSessionsMeta(meta);
  if (kept > 0) console.log(`Kept ${kept} live agent session(s)`);
  if (restored > 0) console.log(`Restored ${restored} agent session(s)`);
}

module.exports = {
  init,
  loadSessionsMeta,
  saveSessionsMeta,
  createSession,
  killSession,
  restoreSessions,
};
