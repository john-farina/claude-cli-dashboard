// public/js/polling-manager.js — Central timer registry with lifecycle management
(function() {
  "use strict";

  const _timers = new Map(); // name -> { id, interval, fn, owner, type }

  // Register a repeating interval
  function register(name, fn, intervalMs, owner) {
    if (_timers.has(name)) clear(name);
    const id = setInterval(fn, intervalMs);
    _timers.set(name, { id, interval: intervalMs, fn, owner: owner || null, type: "interval" });
    return id;
  }

  // Register a one-shot timeout
  function registerTimeout(name, fn, delayMs, owner) {
    if (_timers.has(name)) clear(name);
    const id = setTimeout(() => {
      _timers.delete(name);
      fn();
    }, delayMs);
    _timers.set(name, { id, delay: delayMs, fn, owner: owner || null, type: "timeout" });
    return id;
  }

  // Clear a specific timer by name
  function clear(name) {
    const timer = _timers.get(name);
    if (!timer) return;
    if (timer.type === "interval") clearInterval(timer.id);
    else clearTimeout(timer.id);
    _timers.delete(name);
  }

  // Clear all timers owned by a specific owner (e.g., agent name)
  function clearByOwner(owner) {
    for (const [name, timer] of _timers) {
      if (timer.owner === owner) {
        if (timer.type === "interval") clearInterval(timer.id);
        else clearTimeout(timer.id);
        _timers.delete(name);
      }
    }
  }

  // List all registered timer names (for debugging)
  function list() {
    return [..._timers.entries()].map(([name, t]) => ({
      name, type: t.type, owner: t.owner,
      interval: t.interval || t.delay,
    }));
  }

  // Check if a timer exists
  function has(name) { return _timers.has(name); }

  // Get count of registered timers
  function count() { return _timers.size; }

  window.PollingManager = { register, registerTimeout, clear, clearByOwner, list, has, count };
})();
