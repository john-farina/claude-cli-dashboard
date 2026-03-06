// --- Auto-update check, version manager ---
const { execSync, exec } = require("child_process");
const path = require("path");
const fs = require("fs");

const UPSTREAM_REPO_URL = "https://github.com/john-farina/claude-cli-dashboard.git";
const UPSTREAM_SLUG = "john-farina/claude-cli-dashboard";

let _rootDir = "";
let _configPath = "";
let _userConfig = {};
let _wss = null;
let MIN_DASHBOARD_VERSION = "v0.3.5";

function init(config) {
  _rootDir = config.rootDir;
  _configPath = config.configPath;
  _userConfig = config.userConfig;
  _wss = config.wss;
  MIN_DASHBOARD_VERSION = config.MIN_DASHBOARD_VERSION || MIN_DASHBOARD_VERSION;
}

function compareVersions(a, b) {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

// --- Upstream remote detection ---
let _upstreamRemote = null;

function _getUpstreamRemote() {
  try {
    const remotes = execSync("git remote -v", { cwd: _rootDir, encoding: "utf8" });
    for (const name of ["upstream", "origin"]) {
      const re = new RegExp(`^${name}\\s+.*${UPSTREAM_SLUG}`, "m");
      if (re.test(remotes)) return name;
    }
    for (const line of remotes.split("\n")) {
      if (line.includes(UPSTREAM_SLUG) && line.includes("(fetch)")) {
        return line.split(/\s+/)[0];
      }
    }
    try {
      execSync(`git remote add upstream ${UPSTREAM_REPO_URL}`, { cwd: _rootDir, timeout: 5000, stdio: "ignore" });
      console.log("[update] Added 'upstream' remote pointing to", UPSTREAM_REPO_URL);
      return "upstream";
    } catch (addErr) {
      try {
        execSync(`git remote add ceo-upstream ${UPSTREAM_REPO_URL}`, { cwd: _rootDir, timeout: 5000, stdio: "ignore" });
        return "ceo-upstream";
      } catch { return "origin"; }
    }
  } catch {
    return "origin";
  }
}

function getUpstreamRemote() {
  if (!_upstreamRemote) _upstreamRemote = _getUpstreamRemote();
  return _upstreamRemote;
}

// --- Update check ---
let updateCache = { updateAvailable: false, checkedAt: 0, behind: 0, releaseNotes: null, summary: null };
let _updateCheckPromise = null;

function checkForUpdate() {
  if (_updateCheckPromise) return _updateCheckPromise;
  _updateCheckPromise = _doUpdateCheck().finally(() => { _updateCheckPromise = null; });
  return _updateCheckPromise;
}

async function _doUpdateCheck() {
  try {
    const remote = getUpstreamRemote();
    execSync(`git fetch ${remote} main`, { cwd: _rootDir, timeout: 15000, stdio: "ignore" });
    const behind = execSync(`git rev-list --count HEAD..${remote}/main`, { cwd: _rootDir, encoding: "utf8" }).trim();
    const behindCount = parseInt(behind, 10) || 0;
    let updateAvailable = behindCount > 0;

    if (updateAvailable && _userConfig.dismissedOriginHead) {
      try {
        const originHead = execSync(`git rev-parse ${remote}/main`, { cwd: _rootDir, encoding: "utf8" }).trim();
        if (originHead === _userConfig.dismissedOriginHead) {
          updateAvailable = false;
        } else {
          delete _userConfig.dismissedOriginHead;
          fs.writeFileSync(_configPath, JSON.stringify(_userConfig, null, 2));
        }
      } catch {}
    }

    let summary = null;
    if (updateAvailable) {
      try {
        summary = execSync(`git log HEAD..${remote}/main --pretty=format:"%s" --no-merges`, { cwd: _rootDir, encoding: "utf8" }).trim();
      } catch {}
    }

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

    if (updateAvailable && _wss) {
      const msg = JSON.stringify({ type: "update-available", behind: behindCount, releaseNotes, summary });
      for (const client of _wss.clients) {
        try { if (client.readyState === 1) client.send(msg); } catch {}
      }
    }
  } catch (err) {
    console.error(`[update-check] Failed: ${err.message}`);
  }
}

function getUpdateCache() {
  return updateCache;
}

module.exports = {
  init,
  compareVersions,
  getUpstreamRemote,
  checkForUpdate,
  getUpdateCache,
  MIN_DASHBOARD_VERSION,
};
