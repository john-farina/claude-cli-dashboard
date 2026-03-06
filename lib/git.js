// --- Git info: branch detection, worktree status, cached lookups ---
const { execSync, exec } = require("child_process");
const path = require("path");
const fs = require("fs");

function getGitInfo(dir) {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: dir, encoding: "utf8", timeout: 3000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const gitPath = path.join(dir, ".git");
    let isWorktree = false;
    try {
      const stat = fs.statSync(gitPath);
      isWorktree = stat.isFile();
    } catch {}
    return { branch: branch || null, isWorktree };
  } catch {
    return null;
  }
}

function getGitInfoAsync(dir) {
  return new Promise((resolve) => {
    try {
      if (!dir || !fs.statSync(dir).isDirectory()) return resolve(null);
    } catch { return resolve(null); }
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

// Cache git info per workdir — refreshed every 5s
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

module.exports = {
  getGitInfo,
  getGitInfoAsync,
  getCachedGitInfo,
};
