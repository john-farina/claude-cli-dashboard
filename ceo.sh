#!/bin/bash

# Resolve dashboard directory: use CEO_DIR env var, or detect from this script's location
if [ -z "$CEO_DIR" ]; then
  CEO_DIR="$(cd "$(dirname "$0")" && pwd)"
fi

# Read port from config.json, fall back to 9145
if [ -f "$CEO_DIR/config.json" ] && command -v python3 &>/dev/null; then
  PORT=$(python3 -c "import json; print(json.load(open('$CEO_DIR/config.json')).get('port', 9145))" 2>/dev/null || echo 9145)
else
  PORT=9145
fi

APP_PATH="$HOME/Applications/CEO Dashboard.app"

# Check tmux
if ! command -v tmux &>/dev/null; then
  echo "tmux required: brew install tmux"
  exit 1
fi

# Stop launchd-managed server if active (KeepAlive would respawn after kill)
LAUNCHD_PLIST="$HOME/Library/LaunchAgents/com.ceo-dashboard.plist"
if launchctl list com.ceo-dashboard &>/dev/null; then
  launchctl bootout "gui/$(id -u)" "$LAUNCHD_PLIST" 2>/dev/null
  sleep 0.3
fi

# Kill any remaining processes on the port (belt + suspenders)
EXISTING_PIDS=$(lsof -ti :$PORT -sTCP:LISTEN 2>/dev/null)
if [ -n "$EXISTING_PIDS" ]; then
  echo "$EXISTING_PIDS" | xargs kill 2>/dev/null
  for i in {1..15}; do
    lsof -ti :$PORT -sTCP:LISTEN &>/dev/null || break
    sleep 0.2
  done
  REMAINING=$(lsof -ti :$PORT -sTCP:LISTEN 2>/dev/null)
  if [ -n "$REMAINING" ]; then
    echo "$REMAINING" | xargs kill -9 2>/dev/null
    sleep 0.5
  fi
  echo "Killed previous server (pids $EXISTING_PIDS)"
fi

# Start server via launchd (handles crash recovery via KeepAlive)
if [ -f "$LAUNCHD_PLIST" ]; then
  launchctl bootstrap "gui/$(id -u)" "$LAUNCHD_PLIST" 2>/dev/null
  sleep 1
  echo "CEO Dashboard started via launchd on http://localhost:$PORT"
else
  # Fallback: no plist, run directly
  cd "$CEO_DIR" && env -u CLAUDECODE node server.js &
  disown
  sleep 1
  echo "CEO Dashboard started on http://localhost:$PORT"
fi

# Build native app if not installed
if [ ! -d "$APP_PATH" ]; then
  echo "Building native app..."
  bash "$CEO_DIR/native-app/build.sh"
fi

# Kill any zombie CEODashboard processes (prevents RunningBoard EPROCLIM on next open)
pkill -9 -x CEODashboard 2>/dev/null

# If app is already running, just refresh it. Otherwise open it.
if pgrep -x CEODashboard >/dev/null 2>&1; then
  # Send reload notification — app refreshes & comes to front
  osascript -e 'tell application "CEO Dashboard" to activate' 2>/dev/null
  /usr/bin/python3 -c "
import Foundation
dn = Foundation.NSDistributedNotificationCenter.defaultCenter()
dn.postNotificationName_object_userInfo_deliverImmediately_('com.ceo-dashboard.reload', None, None, True)
" 2>/dev/null
  echo "Refreshed existing window"
else
  # Try opening normally; if RunningBoard is stuck (e.g. after force-quit),
  # temporarily swap the bundle ID to get a fresh launch identity
  if ! open "$APP_PATH" 2>/dev/null; then
    echo "App launch blocked (likely force-quit residue), recovering..."
    /usr/libexec/PlistBuddy -c "Set CFBundleIdentifier com.ceo-dashboard.app-recover" "$APP_PATH/Contents/Info.plist"
    codesign --force --sign - --entitlements /dev/stdin "$APP_PATH" <<'ENTITLEMENTS'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.security.app-sandbox</key><false/>
  <key>com.apple.security.network.client</key><true/>
</dict></plist>
ENTITLEMENTS
    open "$APP_PATH"
    # Restore original bundle ID for next time
    /usr/libexec/PlistBuddy -c "Set CFBundleIdentifier com.ceo-dashboard.app" "$APP_PATH/Contents/Info.plist"
  fi
fi
