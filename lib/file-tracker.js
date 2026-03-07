// lib/file-tracker.js — Track which agents touch which files
const _agentFiles = new Map(); // agentName -> Set<filepath>

// Parse file paths from Claude's terminal output
// Claude Code tool calls appear in output like:
//   Edit file_path: /path/to/file.js
//   Write file_path: /path/to/file.js
//   Read file_path: /path/to/file.js
//   Editing /path/to/file.js
//   Writing /path/to/file.js
//   Created /path/to/file.js
// Also matches paths in backtick code blocks
function parseFilePaths(output) {
  const files = new Set();
  const patterns = [
    // Tool call patterns (file_path parameter)
    /file_path["':\s]+([/][^\s"'`\x00-\x1f]+\.\w+)/g,
    // "Editing/Writing/Reading/Created path" patterns
    /(?:Edit(?:ing|ed)?|Writ(?:ing|e|ten)|Read(?:ing)?|Creat(?:ing|ed))\s+(?:`)?([/][^\s"'`\x00-\x1f]+\.\w+)/gi,
    // Backtick-wrapped absolute paths with extensions
    /`(\/[^\s`]+\.\w+)`/g,
  ];
  for (const pat of patterns) {
    pat.lastIndex = 0;
    let m;
    while ((m = pat.exec(output))) {
      const fp = m[1];
      // Sanity checks: must start with /, have a reasonable length, no control chars
      if (fp && fp.startsWith("/") && fp.length < 500 && fp.length > 2) {
        files.add(fp);
      }
    }
  }
  return files;
}

// Update the file set for an agent based on new terminal output
function updateAgentFiles(agentName, output) {
  const files = parseFilePaths(output);
  if (files.size === 0) return;
  if (!_agentFiles.has(agentName)) _agentFiles.set(agentName, new Set());
  const agentSet = _agentFiles.get(agentName);
  for (const f of files) agentSet.add(f);
}

// Get all files where 2+ agents have touched the same path
function getOverlaps() {
  const fileToAgents = new Map();
  for (const [agent, files] of _agentFiles) {
    for (const f of files) {
      if (!fileToAgents.has(f)) fileToAgents.set(f, new Set());
      fileToAgents.get(f).add(agent);
    }
  }
  const overlaps = [];
  for (const [file, agentSet] of fileToAgents) {
    if (agentSet.size > 1) {
      overlaps.push({ file, agents: [...agentSet] });
    }
  }
  return overlaps;
}

// Get all files tracked for a specific agent
function getAgentFiles(name) {
  return [...(_agentFiles.get(name) || [])];
}

// Remove an agent's file tracking (on kill)
function removeAgent(name) {
  _agentFiles.delete(name);
}

// Get the full map for debugging
function getAll() {
  const result = {};
  for (const [agent, files] of _agentFiles) {
    result[agent] = [...files];
  }
  return result;
}

module.exports = { parseFilePaths, updateAgentFiles, getOverlaps, getAgentFiles, removeAgent, getAll };
