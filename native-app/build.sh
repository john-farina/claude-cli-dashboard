#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CEO_DIR="$(dirname "$SCRIPT_DIR")"

# Read custom title and accent color from config.json if available
if [ -f "$CEO_DIR/config.json" ]; then
  _cfg_title=$(python3 -c "import json; c=json.load(open('$CEO_DIR/config.json')); print(c.get('title',''))" 2>/dev/null)
  _cfg_accent=$(python3 -c "import json; c=json.load(open('$CEO_DIR/config.json')); print(c.get('accentColor',''))" 2>/dev/null)
  _cfg_bg=$(python3 -c "import json; c=json.load(open('$CEO_DIR/config.json')); print(c.get('bgColor',''))" 2>/dev/null)
fi
APP_NAME="${_cfg_title:-CEO Dashboard}"
ACCENT_COLOR="${_cfg_accent:-}"
BG_COLOR="${_cfg_bg:-}"
APP_DIR="${CEO_DASHBOARD_APP_DIR:-$HOME/Applications/$APP_NAME.app}"
CONTENTS="$APP_DIR/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"
TMP_DIR=$(mktemp -d)

# Remove any old app with our bundle ID but a different name, preserving Dock position
BUNDLE_ID="com.ceo-dashboard.app"
OLD_APP_PATH=""
for old_app in "$HOME/Applications/"*.app; do
  [ -d "$old_app" ] || continue
  [ "$old_app" = "$APP_DIR" ] && continue
  old_plist="$old_app/Contents/Info.plist"
  if [ -f "$old_plist" ]; then
    old_id=$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$old_plist" 2>/dev/null)
    if [ "$old_id" = "$BUNDLE_ID" ]; then
      OLD_APP_PATH="$old_app"
      echo "Removing old app: $old_app"
      rm -rf "$old_app"
    fi
  fi
done

echo "Building $APP_NAME..."

CACHE_DIR="$SCRIPT_DIR/.build-cache"
mkdir -p "$CACHE_DIR" "$MACOS" "$RESOURCES"

# 1. Compile Swift (skip if main.swift unchanged)

# Generate a small Swift file that embeds the dashboard directory path at compile time.
# This way the binary works regardless of where the repo was cloned.
GENERATED_SWIFT="$TMP_DIR/GeneratedConfig.swift"
cat > "$GENERATED_SWIFT" << SWIFT
let CEO_DASHBOARD_DIR = "$CEO_DIR"
SWIFT

SWIFT_HASH="$(shasum -a 256 "$SCRIPT_DIR/main.swift" | cut -d' ' -f1)|$CEO_DIR"
SWIFT_CACHE="$CACHE_DIR/swift.hash"
if [ -f "$SWIFT_CACHE" ] && [ "$(cat "$SWIFT_CACHE")" = "$SWIFT_HASH" ] && [ -f "$MACOS/CEODashboard" ]; then
    echo "Swift binary unchanged — skipped compilation"
else
    swiftc "$SCRIPT_DIR/main.swift" "$GENERATED_SWIFT" \
        -o "$MACOS/CEODashboard" \
        -framework Cocoa \
        -framework WebKit \
        -O
    echo "$SWIFT_HASH" > "$SWIFT_CACHE"
    echo "Compiled Swift binary"
fi

# 2. Generate .icns from Python-rendered PNG (skip if inputs unchanged)

# Map accent color name to hex
ICON_COLOR_ARG=""
case "$ACCENT_COLOR" in
  cyan)   ICON_COLOR_ARG="--color 00e5ff" ;;
  rose)   ICON_COLOR_ARG="--color c64c75" ;;
  violet) ICON_COLOR_ARG="--color 894cc6" ;;
  green)  ICON_COLOR_ARG="--color 4cc67f" ;;
  orange) ICON_COLOR_ARG="--color c67f4c" ;;
  blue)   ICON_COLOR_ARG="--color 4c7fc6" ;;
  coral)  ICON_COLOR_ARG="--color c6614c" ;;
  *)      ICON_COLOR_ARG="" ;;  # gold (default)
esac
# Pass background color if set (raw hex from config, e.g. "#1a0a2e" → "1a0a2e")
ICON_BG_ARG=""
if [ -n "$BG_COLOR" ] && [ "$BG_COLOR" != "None" ]; then
  ICON_BG_ARG="--bg ${BG_COLOR#\#}"
fi

# Always regenerate icon (ensures name/color changes take effect immediately)
TMP_PNG="$TMP_DIR/icon-1024.png"
ICONSET="$TMP_DIR/AppIcon.iconset"
mkdir -p "$ICONSET"

python3 "$SCRIPT_DIR/generate-icon.py" "$TMP_PNG" $ICON_COLOR_ARG $ICON_BG_ARG

if [ -f "$TMP_PNG" ]; then
    for SIZE in 16 32 128 256 512; do
        sips -z $SIZE $SIZE "$TMP_PNG" --out "$ICONSET/icon_${SIZE}x${SIZE}.png" 2>/dev/null
        DOUBLE=$((SIZE * 2))
        sips -z $DOUBLE $DOUBLE "$TMP_PNG" --out "$ICONSET/icon_${SIZE}x${SIZE}@2x.png" 2>/dev/null
    done
    iconutil -c icns "$ICONSET" -o "$RESOURCES/AppIcon.icns" 2>/dev/null
    echo "Generated app icon"
else
    echo "Warning: Icon generation failed"
fi

# 3. Write Info.plist
cat > "$CONTENTS/Info.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>$APP_NAME</string>
  <key>CFBundleDisplayName</key>
  <string>$APP_NAME</string>
  <key>CFBundleIdentifier</key>
  <string>com.ceo-dashboard.app</string>
  <key>CFBundleVersion</key>
  <string>1.0</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleExecutable</key>
  <string>CEODashboard</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key>
    <true/>
  </dict>
</dict>
</plist>
PLIST

# 4. Codesign with development certificate + entitlements
SIGN_IDENTITY=$(security find-identity -v -p codesigning | head -1 | sed 's/.*"\(.*\)"/\1/')
if [ -n "$SIGN_IDENTITY" ]; then
    codesign --force --sign "$SIGN_IDENTITY" --entitlements "$SCRIPT_DIR/entitlements.plist" "$APP_DIR"
    echo "Signed with: $SIGN_IDENTITY"
else
    codesign --force --sign - --entitlements "$SCRIPT_DIR/entitlements.plist" "$APP_DIR"
    echo "Warning: No dev certificate found, using ad-hoc signing (passkeys may not work)"
fi

# 5. Register with Launch Services & flush icon cache
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP_DIR" 2>/dev/null
touch "$APP_DIR"

# 6. If we renamed the app, swap the old Dock entry to point to the new path
if [ -n "$OLD_APP_PATH" ] && [ "$OLD_APP_PATH" != "$APP_DIR" ]; then
  DOCK_PLIST="$HOME/Library/Preferences/com.apple.dock.plist"
  if [ -f "$DOCK_PLIST" ]; then
    # Use python3 to properly URL-encode paths (matching macOS Dock format: only spaces→%20)
    OLD_URL=$(python3 -c "import sys; print('file:///' + sys.argv[1].lstrip('/').replace(' ', '%20') + '/')" "$OLD_APP_PATH" 2>/dev/null)
    NEW_URL=$(python3 -c "import sys; print('file:///' + sys.argv[1].lstrip('/').replace(' ', '%20') + '/')" "$APP_DIR" 2>/dev/null)
    # Find which persistent-apps entry has the old URL and update it
    IDX=0
    DOCK_UPDATED=false
    while true; do
      ENTRY_URL=$(/usr/libexec/PlistBuddy -c "Print :persistent-apps:${IDX}:tile-data:file-data:_CFURLString" "$DOCK_PLIST" 2>/dev/null) || break
      if [ "$ENTRY_URL" = "$OLD_URL" ]; then
        /usr/libexec/PlistBuddy -c "Set :persistent-apps:${IDX}:tile-data:file-data:_CFURLString ${NEW_URL}" "$DOCK_PLIST" 2>/dev/null
        /usr/libexec/PlistBuddy -c "Set :persistent-apps:${IDX}:tile-data:file-label ${APP_NAME}" "$DOCK_PLIST" 2>/dev/null
        DOCK_UPDATED=true
        echo "Updated Dock position for renamed app"
        break
      fi
      IDX=$((IDX + 1))
    done
    if $DOCK_UPDATED; then
      killall Dock 2>/dev/null
    fi
  fi
fi

# 7. Auto-open the app after build (unless running in CI or explicitly suppressed)
if [ -z "$CEO_NO_OPEN" ] && [ -z "$CI" ]; then
  open "$APP_DIR" 2>/dev/null &
fi

# Cleanup
rm -rf "$TMP_DIR"

echo ""
echo "Installed to: $APP_DIR"
echo "You can now find '$APP_NAME' in Spotlight and Launchpad."
