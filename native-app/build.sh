#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CEO_DIR="$(dirname "$SCRIPT_DIR")"
APP_NAME="CEO Dashboard"
APP_DIR="${CEO_DASHBOARD_APP_DIR:-$HOME/Applications/$APP_NAME.app}"
CONTENTS="$APP_DIR/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"
TMP_DIR=$(mktemp -d)

echo "Building $APP_NAME..."

# 1. Compile Swift
mkdir -p "$MACOS" "$RESOURCES"
swiftc "$SCRIPT_DIR/main.swift" \
    -o "$MACOS/CEODashboard" \
    -framework Cocoa \
    -framework WebKit \
    -O

echo "Compiled Swift binary"

# 2. Generate .icns from Python-rendered PNG
TMP_PNG="$TMP_DIR/icon-1024.png"
ICONSET="$TMP_DIR/AppIcon.iconset"
mkdir -p "$ICONSET"

python3 "$SCRIPT_DIR/generate-icon.py" "$TMP_PNG"

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
cat > "$CONTENTS/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>CEO Dashboard</string>
  <key>CFBundleDisplayName</key>
  <string>CEO Dashboard</string>
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

# Cleanup
rm -rf "$TMP_DIR"

echo ""
echo "Installed to: $APP_DIR"
echo "You can now find 'CEO Dashboard' in Spotlight and Launchpad."
echo "To pin to Dock: open the app, right-click its Dock icon > Options > Keep in Dock"
