// --- Security: IP-based access control, input validation, CSRF ---
const { execSync } = require("child_process");
const path = require("path");

// --- Tailscale IP allowlist ---
const _allowedTailscaleIPs = new Set();
let _tailscaleHostname = null;

function refreshTailscaleIPs() {
  try {
    const raw = execSync("tailscale status --json 2>/dev/null", { encoding: "utf8", timeout: 5000 });
    const ts = JSON.parse(raw);
    _allowedTailscaleIPs.clear();
    if (ts.Self && ts.Self.TailscaleIPs) {
      for (const ip of ts.Self.TailscaleIPs) _allowedTailscaleIPs.add(ip);
    }
    if (ts.Self && ts.Self.DNSName) {
      _tailscaleHostname = ts.Self.DNSName.replace(/\.$/, "");
    }
    if (ts.Peer) {
      for (const peer of Object.values(ts.Peer)) {
        if (peer.TailscaleIPs) {
          for (const ip of peer.TailscaleIPs) _allowedTailscaleIPs.add(ip);
        }
      }
    }
    if (_allowedTailscaleIPs.size > 0) {
      console.log(`[security] Tailscale allowlist: ${_allowedTailscaleIPs.size} device IPs from your tailnet`);
    }
  } catch {
    // Tailscale not installed or not running — only localhost access
  }
}

function isAllowedIP(ip) {
  if (!ip) return false;
  const clean = ip.replace(/^::ffff:/, "");
  if (clean === "127.0.0.1" || clean === "::1") return true;
  if (_allowedTailscaleIPs.has(clean)) return true;
  return false;
}

function verifyWsClient(info) {
  const ip = info.req.socket.remoteAddress;
  if (!isAllowedIP(ip)) return false;
  const origin = info.origin || info.req.headers.origin || "";
  if (!origin) return true;
  try {
    const url = new URL(origin);
    const host = url.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "0.0.0.0") return true;
    if (host.endsWith(".ts.net")) return true;
    if (_allowedTailscaleIPs.has(host)) return true;
    return false;
  } catch {
    return false;
  }
}

function getAllowedTailscaleIPs() {
  return _allowedTailscaleIPs;
}

// --- Input validation ---

const ALLOWED_TMUX_KEYS = new Set([
  "Enter", "Escape", "Tab", "Space", "BSpace",
  "Up", "Down", "Left", "Right",
  "Home", "End", "PageUp", "PageDown", "PPage", "NPage",
  "DC", "IC",
  "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
  "C-c", "C-d", "C-z", "C-a", "C-e", "C-u", "C-k", "C-l", "C-r", "C-w",
  "y", "n", "Y", "N", "q", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0",
]);

function isValidTmuxKey(key) {
  if (typeof key !== "string" || key.length === 0 || key.length > 20) return false;
  if (ALLOWED_TMUX_KEYS.has(key)) return true;
  if (key.length === 1 && key.charCodeAt(0) >= 32 && key.charCodeAt(0) <= 126) return true;
  return false;
}

function isSafePathSegment(segment) {
  if (typeof segment !== "string") return false;
  if (segment.length === 0 || segment.length > 200) return false;
  if (segment.includes("/") || segment.includes("\\") || segment.includes("\0")) return false;
  if (segment === "." || segment === "..") return false;
  if (segment.startsWith(".")) return false;
  return true;
}

function isWithinDir(filePath, baseDir) {
  const resolved = path.resolve(filePath);
  const base = path.resolve(baseDir);
  return resolved === base || resolved.startsWith(base + path.sep);
}

function isValidWorkdir(dir) {
  if (typeof dir !== "string") return false;
  if (!path.isAbsolute(dir)) return false;
  if (/[`$\n\r\0;|&(){}<>]/.test(dir)) return false;
  return true;
}

function isValidAgentName(name) {
  return typeof name === "string" && /^[a-zA-Z0-9_-]+$/.test(name) && name.length <= 128;
}

function isValidSessionId(id) {
  if (typeof id !== "string") return false;
  return /^[a-zA-Z0-9_-]{1,128}$/.test(id);
}

function shellQuote(str) {
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

// --- CSRF middleware factory ---
function csrfMiddleware() {
  return (req, res, next) => {
    if (req.method === "GET") return next();
    const origin = req.headers.origin || "";
    if (!origin) return next();
    try {
      const url = new URL(origin);
      const host = url.hostname;
      if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "0.0.0.0") return next();
      if (host.endsWith(".ts.net")) return next();
      if (_allowedTailscaleIPs.has(host)) return next();
    } catch {}
    res.status(403).json({ error: "Forbidden: cross-origin request blocked" });
  };
}

// --- IP middleware factory ---
function ipMiddleware() {
  return (req, res, next) => {
    if (isAllowedIP(req.ip)) return next();
    res.status(403).end("Forbidden");
  };
}

module.exports = {
  refreshTailscaleIPs,
  isAllowedIP,
  verifyWsClient,
  getAllowedTailscaleIPs,
  isValidTmuxKey,
  isSafePathSegment,
  isWithinDir,
  isValidWorkdir,
  isValidAgentName,
  isValidSessionId,
  shellQuote,
  csrfMiddleware,
  ipMiddleware,
};
