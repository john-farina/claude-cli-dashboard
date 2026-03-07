// lib/activity-events.js — In-memory event aggregator
const MAX_EVENTS = 500;
const _events = [];

function addEvent(event) {
  // event: { type, agent, detail, timestamp }
  _events.push({
    type: event.type,
    agent: event.agent,
    detail: event.detail || "",
    timestamp: event.timestamp || Date.now(),
  });
  // Trim to max
  while (_events.length > MAX_EVENTS) _events.shift();
}

function getEvents(since, agentFilter) {
  let filtered = _events;
  if (since) filtered = filtered.filter(e => e.timestamp > since);
  if (agentFilter) filtered = filtered.filter(e => e.agent === agentFilter);
  return filtered;
}

function clear() { _events.length = 0; }

module.exports = { addEvent, getEvents, clear };
