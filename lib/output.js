// --- Output filtering, status detection, prompt parsing ---
// Pure text processing — no external dependencies

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
}

function isSeparatorLine(stripped) {
  return stripped.length >= 3 && /^[\u2500-\u257F\-=_]+$/.test(stripped);
}

function filterCeoPreamble(lines) {
  const toRemove = new Set();

  let startIdx = -1;
  let foundEnd = false;
  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].replace(/\x1b\[[0-9;]*m/g, "").trim();
    const content = stripped.replace(/^>\s*/, "");

    if (startIdx === -1) {
      if (content.includes("CEO Dashboard Agent") || content.includes("MANDATORY RULES")) {
        startIdx = i;
      }
    }
    if (startIdx !== -1) {
      toRemove.add(i);
      if (content.includes("[END_CEO_PROMPT]")) {
        foundEnd = true;
        break;
      }
      if (i - startIdx > 200) break;
    }
  }

  // Fallback for older prompts without [END_CEO_PROMPT]
  if (startIdx !== -1 && !foundEnd) {
    toRemove.clear();
    let inBlock = false;
    for (let i = 0; i < lines.length; i++) {
      const stripped = lines[i].replace(/\x1b\[[0-9;]*m/g, "").trim();
      const content = stripped.replace(/^>\s*/, "");
      if (!inBlock) {
        if (content.includes("CEO Dashboard Agent") || content.includes("MANDATORY RULES")) {
          inBlock = true;
          toRemove.add(i);
        }
      } else {
        toRemove.add(i);
        if (/^-{3,}$/.test(content)) break;
        if (i - startIdx > 100) break;
      }
    }
    // Strip trailing CRITICAL REMINDER block
    for (let i = 0; i < lines.length; i++) {
      const stripped = lines[i].replace(/\x1b\[[0-9;]*m/g, "").trim();
      const content = stripped.replace(/^>\s*/, "");
      if (content.includes("CRITICAL REMINDER") && content.includes("AGENT NAME")) {
        if (i > 0) {
          const prev = lines[i - 1].replace(/\x1b\[[0-9;]*m/g, "").trim().replace(/^>\s*/, "");
          if (/^-{3,}$/.test(prev)) toRemove.add(i - 1);
        }
        for (let j = i; j < lines.length && j < i + 10; j++) {
          const line = lines[j].replace(/\x1b\[[0-9;]*m/g, "").trim().replace(/^>\s*/, "");
          if (j > i && line === "") break;
          toRemove.add(j);
        }
        break;
      }
    }
  }

  if (toRemove.size === 0) return lines;
  return lines.filter((_, i) => !toRemove.has(i));
}

function stripCeoPreamble(output) {
  const lines = output.split("\n");
  const filtered = filterCeoPreamble(lines);
  return filtered.join("\n");
}

function filterOutputForDisplay(lines) {
  lines = filterCeoPreamble(lines);

  // Filter out rename notification messages sent to agents (may wrap across lines)
  {
    const removeSet = new Set();
    for (let i = 0; i < lines.length; i++) {
      const s = stripAnsi(lines[i]).trim();
      if (s.startsWith("SYSTEM NOTICE: Your agent name changed from") ||
          s.startsWith("IMPORTANT: You have been renamed from")) {
        // Remove from start through the end of the wrapped message
        for (let j = i; j < lines.length && j < i + 8; j++) {
          removeSet.add(j);
          const t = stripAnsi(lines[j]).trim();
          if (t.endsWith("any action.") || t.endsWith("any action.'") ||
              t.endsWith("going forward.") || t.endsWith("going forward.'")) break;
        }
      }
    }
    if (removeSet.size > 0) lines = lines.filter((_, i) => !removeSet.has(i));
  }

  const tailLines = lines.slice(-15);
  const isInteractiveSelect = tailLines.some((l) => {
    const s = stripAnsi(l);
    return s.includes("Enter to select") ||
           s.includes("\u2191/\u2193 to navigate") ||
           /^\s*❯\s*\d+\.\s/.test(s);
  });
  if (isInteractiveSelect) return lines;

  const searchStart = Math.max(0, lines.length - 15);
  let promptIdx = -1;

  for (let i = lines.length - 1; i >= searchStart; i--) {
    const stripped = stripAnsi(lines[i]).trim();
    if ((/^❯/.test(stripped) && !/^❯\s*\d+\.\s/.test(stripped)) || /^>\s*$/.test(stripped)) {
      promptIdx = i;
      break;
    }
  }

  if (promptIdx === -1) return lines;

  const toRemove = new Set([promptIdx]);

  if (promptIdx > 0) {
    const prev = stripAnsi(lines[promptIdx - 1]).trim();
    if (isSeparatorLine(prev)) toRemove.add(promptIdx - 1);
  }

  if (promptIdx < lines.length - 1) {
    const next = stripAnsi(lines[promptIdx + 1]).trim();
    if (isSeparatorLine(next)) toRemove.add(promptIdx + 1);
  }

  return lines.filter((_, i) => !toRemove.has(i));
}

function detectStatus(output, prevOutput) {
  const lines = output.split("\n");

  const lastLines = [];
  for (let i = lines.length - 1; i >= 0 && lastLines.length < 15; i--) {
    const stripped = stripAnsi(lines[i]).trim();
    if (stripped) lastLines.push(stripped);
  }
  const lastLine = lastLines[0] || "";
  const lastChunk = lastLines.join(" ");

  const waitingPatterns = [
    /\(Y\)es/i,
    /\(y\/n\)/i,
    /Allow\s/i,
    /Do you want to/i,
    /Press Enter/i,
    /\? \[Y\/n\]/i,
    /^\s*Approve\s*\|\s*Deny/i,
    /Enter to select/,
    /↑\/↓ to navigate/,
  ];
  if (waitingPatterns.some((p) => p.test(lastLine) || p.test(lastChunk))) {
    return "waiting";
  }

  if (lastLines.some((l) => /^[❯>]\s*\d+\.\s/.test(l))) {
    return "waiting";
  }

  if (lastLines.some((l) => /esc\s+to\s+interrupt/i.test(l))) {
    return "working";
  }

  const promptIdx = lastLines.findIndex((l) => /^❯/.test(l));
  if (promptIdx >= 0) {
    for (let k = promptIdx + 1; k < lastLines.length && k < promptIdx + 8; k++) {
      if (isSeparatorLine(lastLines[k])) continue;
      if (/\?\s*$/.test(lastLines[k])) return "asking";
      break;
    }
    return "idle";
  }

  if (lastLine.endsWith("$")) {
    return "idle";
  }

  if (output !== prevOutput) {
    return "working";
  }

  return "idle";
}

function detectPromptType(output) {
  const lines = output.split("\n");
  const lastLines = [];
  for (let i = lines.length - 1; i >= 0 && lastLines.length < 15; i--) {
    const stripped = stripAnsi(lines[i]).trim();
    if (stripped) lastLines.unshift(stripped);
  }
  const chunk = lastLines.join("\n");

  if (/Enter to select/i.test(chunk) && /(?:^|\n)\s*(?:[❯>]\s*)?\d+\.\s/m.test(chunk)) {
    return "question";
  }
  if (/(?:^|\n)\s*❯\s*\d+\.\s/m.test(chunk)) {
    return "question";
  }

  if (/Allow once/i.test(chunk) && /Deny/i.test(chunk)) {
    return "permission";
  }

  if (/\(Y\)es/i.test(chunk) || /\(y\/n\)/i.test(chunk) || /\? \[Y\/n\]/i.test(chunk)) {
    return "yesno";
  }

  if (/Press Enter/i.test(chunk)) {
    return "enter";
  }

  return null;
}

function parsePromptOptions(output) {
  const lines = output.split("\n");
  const options = [];

  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 40); i--) {
    const stripped = stripAnsi(lines[i]).trim();
    if (!stripped) continue;
    if (/^[─━═←→☐✔☑\s│|]+$/.test(stripped)) continue;

    const match = stripped.match(/^(?:[❯>]\s*)?(\d+)\.\s+(.+)$/);
    if (match) {
      const num = parseInt(match[1]);
      const fullText = match[2].trim();
      const dashIdx = fullText.indexOf(" - ");
      const label = dashIdx > 0 ? fullText.substring(0, dashIdx).trim() : fullText;
      const description = dashIdx > 0 ? fullText.substring(dashIdx + 3).replace(/^"|"$/g, "").trim() : null;
      options.push({ index: num - 1, label, description });
    } else if (options.length > 0) {
      const raw = stripAnsi(lines[i]);
      if (raw.match(/^\s{4,}/)) continue;
      break;
    } else {
      continue;
    }
  }

  options.reverse();
  return options.length > 0 ? options : null;
}

module.exports = {
  stripAnsi,
  isSeparatorLine,
  filterCeoPreamble,
  stripCeoPreamble,
  filterOutputForDisplay,
  detectStatus,
  detectPromptType,
  parsePromptOptions,
};
