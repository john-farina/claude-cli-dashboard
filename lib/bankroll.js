// lib/bankroll.js — Dashboard currency system
const fs = require("fs");
const path = require("path");

const BANKROLL_FILE = path.join(__dirname, "..", "bankroll.json");
const COOLDOWNS = new Map();
const MIN_WORK_TIME = new Map();

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

function getBalance() { return _load().balance; }

function getInfo() {
  const d = _load();
  return { balance: d.balance, history: (d.history || []).slice(-50) };
}

function getStats() {
  const d = _load();
  const history = d.history || [];

  // Compute stats from full history
  let totalEarned = 0, totalWagered = 0, totalWon = 0;
  let taskComplete = 0, commits = 0, docSaves = 0, agentCleanups = 0, dailySeeds = 0;
  let gamesPlayed = 0, gamesWon = 0;
  const earningsByDay = {};

  for (const entry of history) {
    const day = new Date(entry.timestamp).toISOString().split("T")[0];

    if (entry.reason === "task-complete") { totalEarned += entry.amount; taskComplete++; }
    else if (entry.reason === "commit") { totalEarned += entry.amount; commits++; }
    else if (entry.reason === "doc-save") { totalEarned += entry.amount; docSaves++; }
    else if (entry.reason === "agent-cleanup") { totalEarned += entry.amount; agentCleanups++; }
    else if (entry.reason === "daily-seed") { totalEarned += entry.amount; dailySeeds++; }
    else if (entry.reason === "wager") { totalWagered += Math.abs(entry.amount); gamesPlayed++; }
    else if (entry.reason === "game-win") { totalWon += entry.amount; gamesWon++; }
    else if (entry.reason === "testing-credit") { totalEarned += entry.amount; }

    if (entry.amount > 0) {
      earningsByDay[day] = (earningsByDay[day] || 0) + entry.amount;
    }
  }

  const gamingPnl = totalWon - totalWagered;
  const lifetimePnl = totalEarned + gamingPnl;

  return {
    balance: d.balance,
    totalEarned,
    totalWagered,
    totalWon,
    gamingPnl,
    lifetimePnl,
    breakdown: { taskComplete, commits, docSaves, agentCleanups, dailySeeds },
    gaming: { played: gamesPlayed, won: gamesWon, winRate: gamesPlayed > 0 ? Math.round((gamesWon / gamesPlayed) * 100) : 0 },
    earningsByDay,
  };
}

function checkDailySeed() {
  const d = _load();
  const today = new Date().toISOString().split("T")[0];
  if (d.lastDailySeed !== today) {
    d.lastDailySeed = today;
    _addBalance(500, "daily-seed", null);
    console.log("[bankroll] Daily seed: +$500");
  }
}

function markWorking(agentName) {
  MIN_WORK_TIME.set(agentName, Date.now());
}

function earn(amount, reason, agentName) {
  if (reason === "task-complete" && agentName) {
    const last = COOLDOWNS.get(agentName) || 0;
    if (Date.now() - last < 30000) {
      console.log(`[bankroll] SKIP $${amount} ${reason} (${agentName}) — cooldown ${Math.round((Date.now() - last) / 1000)}s < 30s`);
      return false;
    }
    const workStart = MIN_WORK_TIME.get(agentName) || 0;
    if (Date.now() - workStart < 10000) {
      console.log(`[bankroll] SKIP $${amount} ${reason} (${agentName}) — worked only ${Math.round((Date.now() - workStart) / 1000)}s < 10s`);
      return false;
    }
    COOLDOWNS.set(agentName, Date.now());
  }

  console.log(`[bankroll] +$${amount} ${reason}${agentName ? ` (${agentName})` : ""} — balance: $${_load().balance + amount}`);
  _addBalance(amount, reason, agentName);
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
  if (_data && _data.history.length > 200) _data.history = _data.history.slice(-200);
}

function removeAgent(name) {
  COOLDOWNS.delete(name);
  MIN_WORK_TIME.delete(name);
}

module.exports = { getBalance, getInfo, getStats, checkDailySeed, markWorking, earn, wager, win, removeAgent };
