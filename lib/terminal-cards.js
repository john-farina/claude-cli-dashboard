// --- Terminal card PTY manager (tmux <-> xterm.js bridge) ---
const { execSync } = require("child_process");
const { createScrollback, getScrollback, appendScrollback, clearScrollback } = require("./scrollback");

let pty = null;
let PREFIX = "ceo-";

function init(config) {
  pty = config.pty;
  PREFIX = config.PREFIX;
}

const terminalPtys = new Map(); // name -> { pty, clients: Set<ws>, scrollback, ready }

function attachTerminalClient(name, ws) {
  let entry = terminalPtys.get(name);
  if (!entry) {
    if (!pty) {
      console.error("[terminal-card] node-pty not available");
      return;
    }
    const session = `${PREFIX}${name}`;
    try { execSync(`tmux set-option -t ${session} status off`, { stdio: "ignore" }); } catch {}
    let termPty;
    try {
      termPty = pty.spawn("tmux", ["attach-session", "-t", session], {
        name: "xterm-256color",
        cols: 120,
        rows: 50,
        env: { ...process.env, TERM: "xterm-256color" },
      });
    } catch (err) {
      console.error(`[terminal-card] Failed to attach to tmux session ${session}: ${err.message}`);
      return;
    }
    entry = { pty: termPty, clients: new Set(), scrollback: createScrollback(), ready: false };
    terminalPtys.set(name, entry);

    setTimeout(() => {
      entry.ready = true;
      clearScrollback(entry.scrollback);
      termPty.write("\x0c");
    }, 500);

    termPty.onData((data) => {
      if (!entry.ready) return;
      appendScrollback(entry.scrollback, data);
      const nameBuf = Buffer.from(name, "utf8");
      const dataBuf = Buffer.from(data, "utf8");
      const frame = Buffer.alloc(2 + nameBuf.length + dataBuf.length);
      frame[0] = 0x02;
      frame[1] = nameBuf.length;
      nameBuf.copy(frame, 2);
      dataBuf.copy(frame, 2 + nameBuf.length);
      for (const client of entry.clients) {
        if (client.readyState === 1 && client.bufferedAmount < 1048576) {
          client.send(frame);
        }
      }
    });

    termPty.onExit(() => {
      console.log(`[terminal-card] PTY wrapper for ${name} exited`);
      terminalPtys.delete(name);
    });

    console.log(`[terminal-card] Attached PTY wrapper for ${name} (pid ${termPty.pid})`);
  }

  entry.clients.add(ws);
  if (entry._killTimer) { clearTimeout(entry._killTimer); entry._killTimer = null; }

  // Replay scrollback
  const scrollback = getScrollback(entry.scrollback);
  if (scrollback) {
    const nameBuf = Buffer.from(name, "utf8");
    const dataBuf = Buffer.from(scrollback, "utf8");
    const CHUNK = 32768;
    let offset = 0;
    const sendChunk = () => {
      if (offset >= dataBuf.length || ws.readyState !== 1) return;
      const end = Math.min(offset + CHUNK, dataBuf.length);
      const chunk = dataBuf.subarray(offset, end);
      const frame = Buffer.alloc(2 + nameBuf.length + chunk.length);
      frame[0] = 0x02;
      frame[1] = nameBuf.length;
      nameBuf.copy(frame, 2);
      chunk.copy(frame, 2 + nameBuf.length);
      ws.send(frame);
      offset = end;
      if (offset < dataBuf.length) setImmediate(sendChunk);
    };
    sendChunk();
  }
}

function detachTerminalClient(name, ws) {
  const entry = terminalPtys.get(name);
  if (!entry) return;
  entry.clients.delete(ws);
  if (entry.clients.size === 0) {
    if (entry._killTimer) clearTimeout(entry._killTimer);
    entry._killTimer = setTimeout(() => {
      if (entry.clients.size === 0) {
        try { entry.pty.kill(); } catch {}
        terminalPtys.delete(name);
        console.log(`[terminal-card] Grace period expired for ${name}, killed PTY wrapper`);
      }
    }, 60000);
    console.log(`[terminal-card] Last client detached for ${name}, 60s grace period`);
  }
}

function writeTerminalStdin(name, data) {
  const entry = terminalPtys.get(name);
  if (entry) entry.pty.write(data);
}

function resizeTerminalPty(name, cols, rows) {
  const entry = terminalPtys.get(name);
  if (entry) entry.pty.resize(Math.max(1, cols), Math.max(1, rows));
}

module.exports = {
  init,
  terminalPtys,
  attachTerminalClient,
  detachTerminalClient,
  writeTerminalStdin,
  resizeTerminalPty,
};
