const { execSync } = require("child_process");

let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 15000;

function clearCache() { _cache = null; _cacheTime = 0; }

function getPRs(agentBranches, workspaces) {
  const now = Date.now();
  if (_cache && now - _cacheTime < CACHE_TTL) return _cache;

  let allPrs = [];
  const seen = new Set();

  // 1. Search all open PRs authored by me across all of GitHub
  try {
    const raw = execSync(
      'gh search prs --author=@me --state=open --json number,title,repository,url,createdAt,state --limit=50',
      { encoding: "utf8", timeout: 20000 }
    );
    const results = JSON.parse(raw);
    console.log("[prs] gh search found " + results.length + " PRs across all repos");
    for (const pr of results) {
      const key = (pr.repository?.nameWithOwner || "") + "#" + pr.number;
      if (seen.has(key)) continue;
      seen.add(key);
      allPrs.push({
        number: pr.number,
        title: pr.title,
        url: pr.url,
        repo: pr.repository?.nameWithOwner || "",
        createdAt: pr.createdAt,
        state: pr.state,
        headRefName: "",
        statusCheckRollup: [],
        reviewDecision: null,
      });
    }
  } catch (e) {
    console.error("[prs] gh search failed:", e.message);
  }

  // 2. Get detailed info from each workspace repo (has status checks, review, branch)
  const repos = new Set();
  if (workspaces && workspaces.length > 0) {
    for (const ws of workspaces) {
      try {
        const raw = execSync(
          'gh pr list --state=open --author=@me --json number,title,headRefName,state,statusCheckRollup,reviewDecision,createdAt,url --limit=20',
          { cwd: ws, encoding: "utf8", timeout: 15000 }
        );
        const prs = JSON.parse(raw);
        // Get repo name from this workspace
        let repoName = "";
        try {
          repoName = execSync("gh repo view --json nameWithOwner -q .nameWithOwner", { cwd: ws, encoding: "utf8", timeout: 5000 }).trim();
        } catch {}
        repos.add(repoName);

        for (const pr of prs) {
          const key = repoName + "#" + pr.number;
          // Replace the basic search result with detailed one
          const idx = allPrs.findIndex(p => p.repo === repoName && p.number === pr.number);
          const detailed = {
            ...pr,
            repo: repoName,
            checksStatus: _computeChecksStatus(pr.statusCheckRollup),
            needsAttention: _needsAttention(pr),
          };
          if (idx >= 0) {
            allPrs[idx] = detailed;
          } else if (!seen.has(key)) {
            seen.add(key);
            allPrs.push(detailed);
          }
        }
      } catch {}
    }
  }

  // 3. Also check agent branches in their workdirs
  if (agentBranches && agentBranches.length > 0) {
    for (const { branch, workdir } of agentBranches) {
      if (!branch || !workdir) continue;
      try {
        const raw = execSync(
          `gh pr list --state=open --head="${branch}" --json number,title,headRefName,state,statusCheckRollup,reviewDecision,createdAt,url --limit=5`,
          { cwd: workdir, encoding: "utf8", timeout: 10000 }
        );
        let repoName = "";
        try { repoName = execSync("gh repo view --json nameWithOwner -q .nameWithOwner", { cwd: workdir, encoding: "utf8", timeout: 5000 }).trim(); } catch {}
        const prs = JSON.parse(raw);
        for (const pr of prs) {
          const key = repoName + "#" + pr.number;
          if (seen.has(key)) continue;
          seen.add(key);
          allPrs.push({ ...pr, repo: repoName, checksStatus: _computeChecksStatus(pr.statusCheckRollup), needsAttention: _needsAttention(pr) });
        }
      } catch {}
    }
  }

  // Add computed fields to any PRs that don't have them
  allPrs = allPrs.map(pr => ({
    ...pr,
    checksStatus: pr.checksStatus || _computeChecksStatus(pr.statusCheckRollup),
    needsAttention: pr.needsAttention !== undefined ? pr.needsAttention : _needsAttention(pr),
  }));

  _cache = allPrs;
  _cacheTime = now;
  return allPrs;
}

function _computeChecksStatus(rollup) {
  if (!rollup || rollup.length === 0) return "none";
  if (rollup.some(c => c.conclusion === "FAILURE")) return "failed";
  if (rollup.some(c => c.status === "IN_PROGRESS" || c.status === "QUEUED")) return "pending";
  return "passed";
}

function _needsAttention(pr) {
  return _computeChecksStatus(pr.statusCheckRollup) === "failed" || pr.reviewDecision === "CHANGES_REQUESTED";
}

module.exports = { getPRs, clearCache };
