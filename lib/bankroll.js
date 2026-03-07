// lib/bankroll.js — Dashboard currency system
// Agents earn currency through detected work events; spend it in the arcade.
const fs = require("fs");
const path = require("path");

const BANKROLL_FILE = path.join(__dirname, "..", "bankroll.json");

// Per-agent state (not persisted — resets on server restart, which is fine)
const _agentState = new Map(); // name -> { earned, lastEarnAt, seenCommits, seenFiles, workStart }
let _earnCallback = null; // called on every earn for real-time broadcast

let _data = null;

function _load() {
  if (_data) return _data;
  try {
    _data = JSON.parse(fs.readFileSync(BANKROLL_FILE, "utf8"));
  } catch {
    _data = { balance: 0, lastDailySeed: null, history: [] };
  }
  return _data;
}

function _save() {
  if (!_data) return;
  try { fs.writeFileSync(BANKROLL_FILE, JSON.stringify(_data, null, 2)); } catch {}
}

function _getAgent(name) {
  if (!_agentState.has(name)) {
    _agentState.set(name, { earned: 0, lastEarnAt: 0, seenCommits: new Set(), seenFiles: new Set(), workStart: 0 });
  }
  return _agentState.get(name);
}

function getBalance() { return _load().balance; }

function getInfo() {
  const d = _load();
  return { balance: d.balance, history: (d.history || []).slice(-50) };
}

function getAgentEarned(name) {
  return _getAgent(name).earned;
}

function getAllAgentEarnings() {
  const result = {};
  for (const [name, state] of _agentState) {
    result[name] = state.earned;
  }
  return result;
}

function getStats() {
  const d = _load();
  const history = d.history || [];

  let totalEarned = 0, totalWagered = 0, totalWon = 0;
  let taskComplete = 0, commits = 0, docSaves = 0, fileEdits = 0, testPasses = 0;
  let agentCleanups = 0, dailySeeds = 0;
  let gamesPlayed = 0, gamesWon = 0;
  const earningsByDay = {};

  for (const entry of history) {
    const day = new Date(entry.timestamp).toISOString().split("T")[0];
    const r = entry.reason;

    if (r === "task-complete") { totalEarned += entry.amount; taskComplete++; }
    else if (r === "commit") { totalEarned += entry.amount; commits++; }
    else if (r === "doc-save") { totalEarned += entry.amount; docSaves++; }
    else if (r === "file-edit") { totalEarned += entry.amount; fileEdits++; }
    else if (r === "test-pass") { totalEarned += entry.amount; testPasses++; }
    else if (r === "agent-cleanup") { totalEarned += entry.amount; agentCleanups++; }
    else if (r === "daily-seed") { totalEarned += entry.amount; dailySeeds++; }
    else if (r === "wager") { totalWagered += Math.abs(entry.amount); gamesPlayed++; }
    else if (r === "game-win") { totalWon += entry.amount; gamesWon++; }
    else if (r === "testing-credit") { totalEarned += entry.amount; }

    if (entry.amount > 0) {
      earningsByDay[day] = (earningsByDay[day] || 0) + entry.amount;
    }
  }

  const gamingPnl = totalWon - totalWagered;
  const lifetimePnl = totalEarned + gamingPnl;

  return {
    balance: d.balance,
    totalEarned, totalWagered, totalWon, gamingPnl, lifetimePnl,
    breakdown: { taskComplete, commits, docSaves, fileEdits, testPasses, agentCleanups, dailySeeds },
    gaming: { played: gamesPlayed, won: gamesWon, winRate: gamesPlayed > 0 ? Math.round((gamesWon / gamesPlayed) * 100) : 0 },
    earningsByDay,
  };
}

function checkDailySeed() {
  const d = _load();
  const today = new Date().toISOString().split("T")[0];
  if (d.lastDailySeed !== today) {
    d.lastDailySeed = today;
    _earn(500, "daily-seed", null);
    console.log("[bankroll] Daily seed: +$500");
  }
}

// Register callback for real-time earn notifications
function onEarn(cb) { _earnCallback = cb; }

// ===================== SMART OUTPUT DETECTION =====================
// Called every poll cycle with the agent's terminal output.
// Detects meaningful work events and awards currency once per unique event.

function detectWork(agentName, output, statusTransition) {
  const agent = _getAgent(agentName);
  const events = [];

  // 1. Status transition: working -> idle/waiting = task unit completed
  if (statusTransition === "task-complete") {
    const now = Date.now();
    const workDuration = agent.workStart > 0 ? now - agent.workStart : 0;
    // Must have worked at least 10s, and 60s cooldown between task-complete rewards
    if (workDuration >= 10000 && now - agent.lastEarnAt >= 60000) {
      // Scale reward by work duration: $50 base + $10 per minute worked (cap at $200)
      const minutes = Math.min(10, workDuration / 60000);
      const amount = Math.round(50 + minutes * 15);
      agent.lastEarnAt = now;
      events.push({ amount, reason: "task-complete" });
    }
  }

  if (statusTransition === "work-start") {
    agent.workStart = Date.now();
    return events; // no earnings on work start
  }

  // 2. Commit detection — unique by hash
  const commitMatches = output.match(/\[[\w\s./-]+\s+([0-9a-f]{7,10})\]/g);
  if (commitMatches) {
    for (const m of commitMatches) {
      const hash = m.match(/([0-9a-f]{7,10})\]/)?.[1];
      if (hash && !agent.seenCommits.has(hash)) {
        agent.seenCommits.add(hash);
        events.push({ amount: 150, reason: "commit" });
      }
    }
  }

  // 3. File write/edit detection — unique by filepath
  const fileWrites = output.match(/(?:Created|Updated|Wrote|Edited|Modified)\s+([^\s]+\.\w{1,10})/g);
  if (fileWrites) {
    for (const m of fileWrites) {
      const file = m.replace(/^(Created|Updated|Wrote|Edited|Modified)\s+/, "");
      if (!agent.seenFiles.has(file)) {
        agent.seenFiles.add(file);
        events.push({ amount: 25, reason: "file-edit" });
      }
    }
  }

  // 4. Test pass detection
  const testPass = output.match(/(\d+)\s+(tests?\s+)?pass(ed|ing)?/i);
  if (testPass) {
    const testKey = "test:" + testPass[0];
    if (!agent.seenFiles.has(testKey)) {
      agent.seenFiles.add(testKey);
      const count = parseInt(testPass[1]) || 1;
      events.push({ amount: Math.min(100, count * 10), reason: "test-pass" });
    }
  }

  // Apply all events
  for (const ev of events) {
    _earn(ev.amount, ev.reason, agentName);
    agent.earned += ev.amount;
  }

  return events;
}

function _earn(amount, reason, agentName) {
  console.log(`[bankroll] +$${amount} ${reason}${agentName ? ` (${agentName})` : ""} — balance: $${_load().balance + amount}`);
  _addBalance(amount, reason, agentName);
  if (_earnCallback) _earnCallback(amount, reason, agentName);
}

// Direct earn for doc-save and agent-cleanup (called from server routes, not output detection)
function earn(amount, reason, agentName) {
  const agent = agentName ? _getAgent(agentName) : null;
  if (agent) agent.earned += amount;
  _earn(amount, reason, agentName);
  return true;
}

function wager(amount) {
  const d = _load();
  if (amount <= 0 || amount > d.balance) return false;
  d.balance -= amount;
  d.history.push({ amount: -amount, reason: "wager", timestamp: Date.now() });
  _trimHistory();
  _save();
  return true;
}

function win(amount) {
  if (amount <= 0) return;
  const d = _load();
  d.balance += amount;
  d.history.push({ amount, reason: "game-win", timestamp: Date.now() });
  _trimHistory();
  _save();
}

function _addBalance(amount, reason, agentName) {
  const d = _load();
  d.balance += amount;
  const entry = { amount, reason, timestamp: Date.now() };
  if (agentName) entry.agent = agentName;
  d.history.push(entry);
  _trimHistory();
  _save();
}

function _trimHistory() {
  if (_data && _data.history.length > 500) _data.history = _data.history.slice(-500);
}

function removeAgent(name) {
  _agentState.delete(name);
}

module.exports = { getBalance, getInfo, getStats, getAgentEarned, getAllAgentEarnings, checkDailySeed, onEarn, detectWork, earn, wager, win, removeAgent };
