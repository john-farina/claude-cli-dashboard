#!/usr/bin/env node

const readline = require("readline");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

// --- Clean sandbox ---
const cleanIdx = process.argv.indexOf("--clean-sandbox");
if (cleanIdx !== -1) {
  const cleanPath = process.argv[cleanIdx + 1] || "/tmp/ceo-test";
  const appBundle = path.join(cleanPath, "CEO Dashboard.app");

  console.log();
  console.log(`  Cleaning sandbox at ${cleanPath}...`);

  // Quit the sandbox app if it's running
  if (fs.existsSync(appBundle)) {
    try {
      execSync(`osascript -e 'tell application "${appBundle}" to quit' 2>/dev/null`, { timeout: 3000 });
    } catch { /* not running, fine */ }
    // Kill any process launched from the sandbox binary
    try {
      execSync(`pkill -f "${path.join(appBundle, "Contents")}" 2>/dev/null`, { timeout: 3000 });
    } catch { /* nothing to kill */ }
  }

  // Remove the sandbox directory
  if (fs.existsSync(cleanPath)) {
    fs.rmSync(cleanPath, { recursive: true, force: true });
    console.log(`  ✓ Removed ${cleanPath}`);
  } else {
    console.log(`  Nothing to clean — ${cleanPath} doesn't exist.`);
  }

  console.log("  Done.");
  console.log();
  process.exit(0);
}

// --- Sandbox mode ---
const sandboxIdx = process.argv.indexOf("--sandbox");
const SANDBOX = sandboxIdx !== -1 ? (process.argv[sandboxIdx + 1] || "/tmp/ceo-test") : null;

if (SANDBOX) {
  fs.mkdirSync(SANDBOX, { recursive: true });
}

// --- All file paths (redirected in sandbox) ---
const paths = {
  configJson: SANDBOX ? path.join(SANDBOX, "config.json") : path.join(__dirname, "config.json"),
  docsDir: SANDBOX ? path.join(SANDBOX, "docs") : path.join(__dirname, "docs"),
  shellRc: SANDBOX ? path.join(SANDBOX, ".zshrc") : null, // resolved later if not sandbox
  launchAgentDir: SANDBOX
    ? path.join(SANDBOX, "LaunchAgents")
    : path.join(os.homedir(), "Library", "LaunchAgents"),
  claudeDocs: SANDBOX
    ? path.join(SANDBOX, ".claude", "docs")
    : path.join(os.homedir(), ".claude", "docs"),
};

// --- Readline setup ---
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let aborted = false;

rl.on("close", () => {
  if (!aborted) {
    aborted = true;
    console.log("\n\nSetup cancelled.");
    process.exit(0);
  }
});

// --- Utilities ---

function expandTilde(p) {
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function ask(prompt, defaultVal) {
  const suffix = defaultVal != null ? ` (${defaultVal})` : "";
  return new Promise((resolve) => {
    rl.question(`  ${prompt}${suffix}: `, (answer) => {
      resolve(answer.trim() || (defaultVal != null ? String(defaultVal) : ""));
    });
  });
}

function askYesNo(prompt, defaultYes = true) {
  const hint = defaultYes ? "Y/n" : "y/N";
  return new Promise((resolve) => {
    rl.question(`  ${prompt} [${hint}]: `, (answer) => {
      const a = answer.trim().toLowerCase();
      if (a === "") resolve(defaultYes);
      else resolve(a === "y" || a === "yes");
    });
  });
}

function isGitRepo() {
  try {
    execSync("git rev-parse --is-inside-work-tree", { stdio: "ignore", cwd: __dirname });
    return true;
  } catch {
    return false;
  }
}

function getGitBranch() {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { stdio: "pipe", cwd: __dirname }).toString().trim();
  } catch {
    return null;
  }
}

function gitBranchExists(name) {
  try {
    execSync(`git rev-parse --verify "${name}"`, { stdio: "ignore", cwd: __dirname });
    return true;
  } catch {
    return false;
  }
}

function commandExists(cmd) {
  try {
    execSync(`command -v ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function runCommand(cmd, opts = {}) {
  if (SANDBOX) {
    console.log(`  [sandbox] Would run: ${cmd}`);
    return true;
  }
  try {
    execSync(cmd, { stdio: "inherit", timeout: 120000, ...opts });
    return true;
  } catch (e) {
    console.log(`  Warning: command failed — ${e.message}`);
    return false;
  }
}

function getShellRcFile() {
  if (paths.shellRc) return paths.shellRc;
  const shell = process.env.SHELL || "/bin/zsh";
  return shell.endsWith("zsh")
    ? path.join(os.homedir(), ".zshrc")
    : path.join(os.homedir(), ".bashrc");
}

function generatePlist(nodePath, serverPath, workDir) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.ceo-dashboard</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${serverPath}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${workDir}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/ceo-dashboard.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/ceo-dashboard-err.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:${path.dirname(nodePath)}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>HOME</key>
        <string>${os.homedir()}</string>
    </dict>
</dict>
</plist>`;
}

// --- Main wizard ---

async function main() {
  // ============================================================
  // Step 1: Welcome
  // ============================================================
  console.log();
  if (SANDBOX) {
    console.log("  ⚠  SANDBOX MODE — all writes go to " + SANDBOX);
    console.log();
  }
  console.log("  ┌─────────────────────────────────────────┐");
  console.log("  │         CEO Dashboard Setup              │");
  console.log("  └─────────────────────────────────────────┘");
  console.log();
  console.log("  This wizard configures CEO Dashboard — a multi-agent");
  console.log("  management UI for Claude Code. It will:");
  console.log("    1. Create your personal branch (off main)");
  console.log("    2. Check system dependencies (tmux, python3)");
  console.log("    3. Install npm packages");
  console.log("    4. Configure workspaces, alias, and auto-start");
  console.log();

  // Load existing config as defaults
  let existing = {};
  try {
    existing = JSON.parse(fs.readFileSync(paths.configJson, "utf8"));
    console.log("  Found existing config.json — using as defaults.");
    console.log();
  } catch {
    // No existing config, that's fine
  }

  // ============================================================
  // Step 2: Personal Branch
  // ============================================================
  let branchName = null;
  if (isGitRepo() && !SANDBOX) {
    const currentBranch = getGitBranch();
    console.log("  ── Step 1/11: Personal Branch ──");
    console.log();
    console.log("  The 'main' branch stays clean as the upstream source.");
    console.log("  You work on your own branch. This way you can:");
    console.log("    - Pull updates from main without conflicts");
    console.log("    - Submit PRs if you build something others would want");
    console.log();

    if (currentBranch === "main" || currentBranch === "master") {
      console.log(`  You're currently on '${currentBranch}' — let's create your branch.`);
      console.log();
      const defaultName = os.userInfo().username || "my-setup";
      while (true) {
        branchName = await ask("Branch name", defaultName);
        // Sanitize: lowercase, spaces to dashes, strip invalid chars
        branchName = branchName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9._/-]/g, "");
        if (!branchName) {
          console.log("  Branch name cannot be empty.");
          continue;
        }
        if (branchName === "main" || branchName === "master") {
          console.log("  Cannot use main/master — pick a different name.");
          continue;
        }
        if (gitBranchExists(branchName)) {
          const useExisting = await askYesNo(`Branch '${branchName}' already exists. Switch to it?`);
          if (useExisting) {
            execSync(`git checkout "${branchName}"`, { stdio: "inherit", cwd: __dirname });
            console.log(`  ✓ Switched to existing branch '${branchName}'`);
            break;
          }
          continue;
        }
        // Create and switch
        execSync(`git checkout -b "${branchName}"`, { stdio: "inherit", cwd: __dirname });
        console.log(`  ✓ Created and switched to branch '${branchName}'`);
        break;
      }
    } else {
      branchName = currentBranch;
      console.log(`  ✓ Already on branch '${currentBranch}' — good to go.`);
    }
    console.log();
  } else if (SANDBOX) {
    console.log("  ── Step 1/11: Personal Branch ──");
    console.log();
    console.log("  [sandbox] Would check git branch and create personal branch if on main.");
    console.log();
  }

  // ============================================================
  // Step 3: System Dependencies
  // ============================================================
  console.log("  ── Step 2/11: System Dependencies ──");
  console.log();

  const hasTmux = commandExists("tmux");
  const hasPython = commandExists("python3");
  const hasBrew = commandExists("brew");

  console.log(`  tmux:    ${hasTmux ? "✓ found" : "✗ not found"}`);
  console.log(`  python3: ${hasPython ? "✓ found" : "✗ not found"}`);
  console.log();

  if (!hasTmux || !hasPython) {
    const missing = [!hasTmux && "tmux", !hasPython && "python3"].filter(Boolean).join(" ");
    if (hasBrew) {
      const install = await askYesNo(`Install ${missing} via Homebrew?`);
      if (install) {
        runCommand(`brew install ${missing}`);
      }
    } else {
      console.log(`  Homebrew not found. Install manually:`);
      if (!hasTmux) console.log("    brew install tmux  (or: apt install tmux)");
      if (!hasPython) console.log("    brew install python3");
      console.log();
    }
  }

  // ============================================================
  // Step 3: npm install
  // ============================================================
  console.log();
  console.log("  ── Step 3/11: npm packages ──");
  console.log();

  const hasExpress = fs.existsSync(path.join(__dirname, "node_modules", "express"));
  if (hasExpress) {
    console.log("  ✓ node_modules already installed");
  } else {
    console.log("  Installing npm dependencies...");
    const ok = runCommand("npm install", { cwd: __dirname });
    if (!ok && !SANDBOX) {
      console.log("  npm install failed. You may need Xcode CLI tools:");
      console.log("    xcode-select --install");
      console.log("  Then re-run: npm run setup");
    }
  }

  // ============================================================
  // Step 4: Workspace Configuration
  // ============================================================
  console.log();
  console.log("  ── Step 4/11: Workspaces ──");
  console.log();
  console.log("  Workspaces are project directories where agents work.");
  console.log("  Enter absolute paths, one per line. Empty line to finish.");
  console.log();

  let workspaces = [];
  let defaultWorkspace = null;

  if (existing.workspaces && existing.workspaces.length > 0) {
    console.log("  Current workspaces:");
    for (const ws of existing.workspaces) {
      console.log(`    ${ws.label}: ${ws.path}`);
    }
    console.log();
    const keep = await askYesNo("Keep existing workspaces?");
    if (keep) {
      workspaces = existing.workspaces;
      defaultWorkspace = existing.defaultWorkspace;
    }
  }

  if (workspaces.length === 0) {
    let idx = 1;
    while (true) {
      const raw = await ask(`Workspace ${idx} path (empty to finish)`);
      if (!raw) break;

      const wsPath = expandTilde(raw);
      if (!fs.existsSync(wsPath)) {
        const create = await askYesNo(`${wsPath} doesn't exist. Create it?`);
        if (create) {
          if (SANDBOX) {
            console.log(`  [sandbox] Would run: mkdir -p ${wsPath}`);
          } else {
            fs.mkdirSync(wsPath, { recursive: true });
          }
        }
      }

      const label = path.basename(wsPath);
      workspaces.push({ path: wsPath, label });
      console.log(`  Added: ${label} → ${wsPath}`);
      idx++;
    }

    // Fallback if none entered
    if (workspaces.length === 0) {
      console.log(`  No workspaces entered — using dashboard directory.`);
      workspaces = [{ path: __dirname, label: path.basename(__dirname) }];
    }

    // Ask for default if multiple
    if (workspaces.length > 1) {
      console.log();
      console.log("  Which workspace should be the default?");
      for (let i = 0; i < workspaces.length; i++) {
        console.log(`    ${i + 1}. ${workspaces[i].label} (${workspaces[i].path})`);
      }
      const choice = await ask("Default workspace number", "1");
      const idx = parseInt(choice, 10) - 1;
      defaultWorkspace = workspaces[Math.max(0, Math.min(idx, workspaces.length - 1))].path;
    } else {
      defaultWorkspace = workspaces[0].path;
    }
  }

  // ============================================================
  // Step 5: PR Link Style
  // ============================================================
  console.log();
  console.log("  ── Step 5/11: PR Link Style ──");
  console.log();
  console.log("  How should PR links be displayed?");
  console.log("    1. Graphite — stacked PR view (default)");
  console.log("    2. GitHub  — standard PR links");
  console.log();

  const prChoice = await ask("Choice", "1");
  const prLinkStyle = prChoice === "2" ? "github" : "graphite";

  // ============================================================
  // Step 6: Port Selection
  // ============================================================
  console.log();
  console.log("  ── Step 6/11: Port ──");
  console.log();
  console.log("  The dashboard runs a local web server.");

  const port = parseInt(await ask("Port", existing.port || 9145), 10) || 9145;

  // ============================================================
  // Step 7: Write config.json
  // ============================================================
  console.log();
  console.log("  ── Step 7/11: Writing config.json ──");
  console.log();

  // Preserve unknown keys from existing config
  const config = {
    ...existing,
    workspaces,
    defaultWorkspace,
    port,
    agentPrefix: existing.agentPrefix || "ceo-",
    defaultAgentName: existing.defaultAgentName || "agent",
    shellCommand: existing.shellCommand || "ceo",
    prLinkStyle,
  };

  fs.writeFileSync(paths.configJson, JSON.stringify(config, null, 2) + "\n");
  console.log(`  ✓ Written to ${paths.configJson}`);

  // ============================================================
  // Step 8: Create Directories
  // ============================================================
  console.log();
  console.log("  ── Step 8/11: Creating directories ──");
  console.log();

  for (const dir of [paths.docsDir, paths.claudeDocs]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`  ✓ Created ${dir}`);
    } else {
      console.log(`  ✓ Exists: ${dir}`);
    }
  }

  // ============================================================
  // Step 9: Shell Alias
  // ============================================================
  console.log();
  console.log("  ── Step 9/11: Shell Alias ──");
  console.log();

  const cmd = config.shellCommand || "ceo";
  const scriptPath = path.join(__dirname, "ceo.sh");
  const aliasLine = `alias ${cmd}="bash ${scriptPath}"`;
  const rcFile = getShellRcFile();

  try {
    let rc = fs.existsSync(rcFile) ? fs.readFileSync(rcFile, "utf8") : "";
    // Remove any existing dashboard alias
    rc = rc.replace(/\nalias [a-zA-Z0-9_-]+="bash [^"]*\/ceo\.sh"/g, "");
    rc = rc.replace(/^alias [a-zA-Z0-9_-]+="bash [^"]*\/ceo\.sh"\n?/, "");
    rc = rc.trimEnd() + "\n" + aliasLine + "\n";
    fs.writeFileSync(rcFile, rc);
    console.log(`  ✓ Added alias to ${rcFile}:`);
    console.log(`    ${aliasLine}`);
    console.log();
    console.log(`  Run: source ${rcFile}`);
  } catch (e) {
    console.log(`  Warning: could not write alias — ${e.message}`);
  }

  // ============================================================
  // Step 10: Auto-Start on Login
  // ============================================================
  console.log();
  console.log("  ── Step 10/11: Auto-Start on Login ──");
  console.log();

  const plistPath = path.join(paths.launchAgentDir, "com.ceo-dashboard.plist");
  const plistExists = fs.existsSync(plistPath);

  let installPlist = false;
  if (plistExists) {
    console.log("  LaunchAgent plist already exists.");
    installPlist = await askYesNo("Regenerate it?", false);
  } else {
    console.log("  A LaunchAgent can start the dashboard automatically on login.");
    installPlist = await askYesNo("Enable auto-start?");
  }

  if (installPlist) {
    const nodePath = process.execPath;
    const serverPath = path.join(__dirname, "server.js");
    const plistContent = generatePlist(nodePath, serverPath, __dirname);

    if (!fs.existsSync(paths.launchAgentDir)) {
      fs.mkdirSync(paths.launchAgentDir, { recursive: true });
    }
    fs.writeFileSync(plistPath, plistContent);
    console.log(`  ✓ Written to ${plistPath}`);

    if (!SANDBOX) {
      try {
        execSync(`launchctl load "${plistPath}" 2>/dev/null`, { timeout: 5000 });
        console.log("  ✓ Loaded into launchctl");
      } catch {
        console.log("  Warning: launchctl load failed — you can load it manually later.");
      }
    } else {
      console.log("  [sandbox] Would run: launchctl load ...");
    }
  } else {
    console.log("  Skipped auto-start.");
  }

  // ============================================================
  // Step 11: Native macOS App
  // ============================================================
  console.log();
  console.log("  ── Step 11/11: Native macOS App ──");
  console.log();

  const hasSwift = commandExists("swiftc");
  const sandboxAppPath = SANDBOX ? path.join(SANDBOX, "CEO Dashboard.app") : null;
  const appPath = sandboxAppPath || path.join(os.homedir(), "Applications", "CEO Dashboard.app");
  const appExists = fs.existsSync(appPath);

  if (!hasSwift) {
    console.log("  swiftc not found — skipping native app build.");
    console.log("  Install Xcode or Xcode CLI tools to enable this later.");
  } else {
    let buildApp = false;
    if (appExists) {
      console.log(`  Native app already exists at ${appPath}`);
      buildApp = await askYesNo("Rebuild it?", false);
    } else {
      console.log("  A native macOS app gives you a Dock icon and in-app browser.");
      if (SANDBOX) console.log(`  Sandbox build will go to: ${sandboxAppPath}`);
      buildApp = await askYesNo("Build and install the native app?");
    }

    if (buildApp) {
      const buildScript = path.join(__dirname, "native-app", "build.sh");
      if (fs.existsSync(buildScript)) {
        // Always run the build for real — in sandbox it just targets a different path
        const buildEnv = { ...process.env };
        if (SANDBOX) buildEnv.CEO_DASHBOARD_APP_DIR = sandboxAppPath;
        try {
          execSync(`bash "${buildScript}"`, { stdio: "inherit", timeout: 120000, cwd: __dirname, env: buildEnv });
          if (SANDBOX) {
            console.log();
            console.log(`  Test it with: open "${sandboxAppPath}"`);
          }
        } catch (e) {
          console.log(`  Warning: build failed — ${e.message}`);
        }
      } else {
        console.log("  Warning: native-app/build.sh not found — skipping.");
      }
    } else {
      console.log("  Skipped native app.");
    }
  }

  // ============================================================
  // Step 12: Summary
  // ============================================================
  console.log();
  console.log("  ┌─────────────────────────────────────────┐");
  console.log("  │            Setup Complete!               │");
  console.log("  └─────────────────────────────────────────┘");
  console.log();
  if (branchName) console.log(`  ✓ On branch '${branchName}'`);
  console.log("  ✓ config.json written");
  console.log(`  ✓ ${workspaces.length} workspace(s) configured`);
  console.log(`  ✓ Shell alias: ${aliasLine}`);
  console.log(`  ✓ Directories created`);
  if (installPlist) console.log("  ✓ Auto-start enabled");
  console.log();

  if (SANDBOX) {
    console.log(`  Sandbox complete. Inspect results at: ${SANDBOX}`);
    console.log();
  } else {
    const rcName = path.basename(rcFile);
    console.log("  To start the dashboard:");
    console.log(`    source ~/${rcName} && ${cmd}`);
    console.log();
    console.log("  Or without the alias:");
    console.log("    npm start");
    console.log();
    if (branchName) {
      console.log("  Built something cool? Submit a PR:");
      console.log("    git push -u origin " + branchName);
      console.log("    Then open a pull request on GitHub.");
      console.log();
    }
  }

  rl.close();
  aborted = true; // prevent "Setup cancelled" on normal close
}

main().catch((e) => {
  console.error(`\n  Setup error: ${e.message}`);
  rl.close();
  process.exit(1);
});
