const { execSync } = require("child_process");

let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 15000;

function getPRs(agentBranches) {
  const now = Date.now();
  if (_cache && now - _cacheTime < CACHE_TTL) return _cache;

  try {
    const raw = execSync(
      'gh pr list --state=open --author=@me --json number,title,headRefName,state,statusCheckRollup,reviewDecision,createdAt,url --limit=50',
      { encoding: "utf8", timeout: 15000 }
    );
    let prs = JSON.parse(raw);

    // Also fetch PRs for agent branches not authored by me
    if (agentBranches && agentBranches.length > 0) {
      for (const branch of agentBranches) {
        if (prs.some(pr => pr.headRefName === branch)) continue;
        try {
          const branchRaw = execSync(
            `gh pr list --state=open --head="${branch}" --json number,title,headRefName,state,statusCheckRollup,reviewDecision,createdAt,url --limit=5`,
            { encoding: "utf8", timeout: 10000 }
          );
          const branchPrs = JSON.parse(branchRaw);
          prs.push(...branchPrs.filter(bp => !prs.some(p => p.number === bp.number)));
        } catch {}
      }
    }

    prs = prs.map(pr => ({
      ...pr,
      checksStatus: _computeChecksStatus(pr.statusCheckRollup),
      needsAttention: _needsAttention(pr),
    }));

    _cache = prs;
    _cacheTime = now;
    return prs;
  } catch (e) {
    return _cache || [];
  }
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

module.exports = { getPRs };
