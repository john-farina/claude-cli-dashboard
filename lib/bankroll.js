// lib/bankroll.js — Dashboard currency system
const fs = require("fs");
const path = require("path");

const BANKROLL_FILE = path.join(__dirname, "..", "bankroll.json");
const DAILY_CAP = 5000;
const COOLDOWNS = new Map();
const MIN_WORK_TIME = new Map();

let _data = null;

function _load() {
  if (_data) return _data;
  try {
    _data = JSON.parse(fs.readFileSync(BANKROLL_FILE, "utf8"));
  } catch {
    _data = { balance: 0, lastDailySeed: null, dailyEarned: 0, dailyDate: null, history: [] };
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

function checkDailySeed() {
  const d = _load();
  const today = new Date().toISOString().split("T")[0];
  if (d.lastDailySeed !== today) {
    d.lastDailySeed = today;
    d.dailyEarned = 0;
    d.dailyDate = today;
    _addBalance(500, "daily-seed", null);
    console.log("[bankroll] Daily seed: +$500");
  }
}

function markWorking(agentName) {
  MIN_WORK_TIME.set(agentName, Date.now());
}

function earn(amount, reason, agentName) {
  const d = _load();
  const today = new Date().toISOString().split("T")[0];
  if (d.dailyDate !== today) { d.dailyEarned = 0; d.dailyDate = today; }
  if (d.dailyEarned >= DAILY_CAP) return false;

  if (reason === "task-complete" && agentName) {
    const last = COOLDOWNS.get(agentName) || 0;
    if (Date.now() - last < 30000) return false;
    const workStart = MIN_WORK_TIME.get(agentName) || 0;
    if (Date.now() - workStart < 10000) return false;
    COOLDOWNS.set(agentName, Date.now());
  }

  const capped = Math.min(amount, DAILY_CAP - d.dailyEarned);
  _addBalance(capped, reason, agentName);
  d.dailyEarned += capped;
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

module.exports = { getBalance, getInfo, checkDailySeed, markWorking, earn, wager, win, removeAgent };
