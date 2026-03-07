const { execSync } = require("child_process");

function getDiffStat(workdir, branch) {
  if (!workdir) return null;
  try {
    let raw = execSync("git diff --stat", { cwd: workdir, encoding: "utf8", timeout: 5000 }).trim();
    if (!raw && branch && branch !== "main" && branch !== "master") {
      try {
        const base = execSync("git merge-base HEAD main 2>/dev/null || git merge-base HEAD master 2>/dev/null", { cwd: workdir, encoding: "utf8", timeout: 5000 }).trim();
        if (base) raw = execSync(`git diff --stat ${base}..HEAD`, { cwd: workdir, encoding: "utf8", timeout: 5000 }).trim();
      } catch {}
    }
    const files = _parseDiffStat(raw);
    return { files, raw };
  } catch { return null; }
}

function getFullDiff(workdir, branch, filePath) {
  if (!workdir) return null;
  try {
    const fileArg = filePath ? ` -- "${filePath}"` : "";
    let diff = execSync(`git diff${fileArg}`, { cwd: workdir, encoding: "utf8", timeout: 10000 }).trim();
    if (!diff && branch && branch !== "main" && branch !== "master") {
      try {
        const base = execSync("git merge-base HEAD main 2>/dev/null || git merge-base HEAD master 2>/dev/null", { cwd: workdir, encoding: "utf8", timeout: 5000 }).trim();
        if (base) diff = execSync(`git diff ${base}..HEAD${fileArg}`, { cwd: workdir, encoding: "utf8", timeout: 10000 }).trim();
      } catch {}
    }
    return diff || null;
  } catch { return null; }
}

function _parseDiffStat(stat) {
  if (!stat) return [];
  return stat.split("\n").filter(l => l.includes("|")).map(line => {
    const match = line.match(/^\s*(.+?)\s*\|\s*(\d+)/);
    if (!match) return null;
    const [, file, changes] = match;
    const plusCount = (line.match(/\+/g) || []).length;
    const minusCount = (line.match(/-/g) || []).length;
    return { file: file.trim(), changes: parseInt(changes), adds: plusCount, dels: minusCount };
  }).filter(Boolean);
}

module.exports = { getDiffStat, getFullDiff };
