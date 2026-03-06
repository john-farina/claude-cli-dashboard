// --- Shared scrollback management (shell + terminal cards) ---
const SCROLLBACK_LIMIT = 50000;

function createScrollback() {
  return { chunks: [], size: 0 };
}

function getScrollback(sb) {
  return sb.chunks.join("");
}

function appendScrollback(sb, data) {
  sb.chunks.push(data);
  sb.size += data.length;
  if (sb.size > SCROLLBACK_LIMIT * 1.2) {
    const full = sb.chunks.join("").slice(-SCROLLBACK_LIMIT);
    sb.chunks.length = 0;
    sb.chunks.push(full);
    sb.size = full.length;
  }
}

function clearScrollback(sb) {
  sb.chunks.length = 0;
  sb.size = 0;
}

module.exports = {
  SCROLLBACK_LIMIT,
  createScrollback,
  getScrollback,
  appendScrollback,
  clearScrollback,
};
