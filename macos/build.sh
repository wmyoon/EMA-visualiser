#!/bin/bash
# Builds "Regulatory Atlas.app" from this repository. Run it on a Mac:
#
#   npm run build:mac                 # or: bash macos/build.sh
#
# Options:
#   --universal   build for Apple silicon and Intel (default: this Mac only)
#   --install     copy the app to /Applications when done
#   --open        open the app when done
#
# Needs only Apple's Command Line Tools (xcode-select --install); not Xcode,
# not Node. The app bundles a snapshot of data/: run `npm run update-data`
# first for fresh EMA data, then build again.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/.." && pwd)"
name="Regulatory Atlas"
out="$here/build/$name.app"
min_macos="12.0"

universal=0; install=0; open_app=0
for arg in "$@"; do
  case "$arg" in
    --universal) universal=1 ;;
    --install) install=1 ;;
    --open) open_app=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This builds a macOS app, so it has to run on a Mac." >&2; exit 1
fi
if ! xcrun --find swiftc >/dev/null 2>&1; then
  echo "Swift is not installed. Install Apple's Command Line Tools with:" >&2
  echo "  xcode-select --install" >&2
  exit 1
fi

step() { printf '\n\033[1m%s\033[0m\n' "$1"; }
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
# The app is assembled and signed in a temporary folder, then copied into
# place. Folders synced by iCloud (Desktop, Documents) add Finder information
# to files, which codesign refuses to sign over.
app="$work/$name.app"

step "1/5  Copying the page and data"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources/web"
for part in index.html css js data vendor; do
  ditto --norsrc --noextattr --noqtn "$repo/$part" "$app/Contents/Resources/web/$part"
done
# The app works offline: the page must not load anything from the network.
if grep -rqE "https://(cdnjs|fonts\.googleapis|fonts\.gstatic)" "$app/Contents/Resources/web/index.html" "$app/Contents/Resources/web/js" "$app/Contents/Resources/web/css"; then
  echo "The page still loads a CDN resource; run 'npm run vendor' and point the page at vendor/." >&2; exit 1
fi
du -sh "$app/Contents/Resources/web" | awk '{print "     " $1 " of page files"}'

step "2/5  Compiling"
if [ "$universal" = 1 ]; then archs="arm64 x86_64"; else archs="$(uname -m)"; fi
bins=()
for arch in $archs; do
  echo "     $arch"
  xcrun swiftc -O -swift-version 5 -target "$arch-apple-macos$min_macos" \
    -o "$work/atlas-$arch" "$here/RegulatoryAtlas.swift"
  bins+=("$work/atlas-$arch")
done
if [ "${#bins[@]}" -gt 1 ]; then
  lipo -create "${bins[@]}" -output "$app/Contents/MacOS/$name"
else
  cp "${bins[0]}" "$app/Contents/MacOS/$name"
fi

step "3/5  Making the icon"
iconset="$work/AppIcon.iconset"; mkdir -p "$iconset"
for size in 16 32 128 256 512; do
  sips -z $size $size "$here/AppIcon.png" --out "$iconset/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z $double $double "$here/AppIcon.png" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$iconset" -o "$app/Contents/Resources/AppIcon.icns"

step "4/5  Writing Info.plist"
version="$(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' "$repo/package.json")"
build="$(git -C "$repo" rev-list --count HEAD 2>/dev/null || echo 1)"
snapshot="$(sed -n 's/.*"timestamp": *"\([0-9-]*\).*/\1/p' "$repo/data/guidelines.meta.json" | head -1)"
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$name</string>
  <key>CFBundleDisplayName</key><string>$name</string>
  <key>CFBundleIdentifier</key><string>io.github.wmyoon.regulatory-atlas</string>
  <key>CFBundleExecutable</key><string>$name</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${version:-1.0.0}</string>
  <key>CFBundleVersion</key><string>$build</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>LSMinimumSystemVersion</key><string>$min_macos</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.medical</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSSupportsAutomaticGraphicsSwitching</key><true/>
  <key>NSHumanReadableCopyright</key><string>Unofficial viewer of EMA open data${snapshot:+ (snapshot $snapshot)}. Not affiliated with EMA.</string>
</dict>
</plist>
PLIST
plutil -lint "$app/Contents/Info.plist" >/dev/null

step "5/5  Signing (ad hoc, for this Mac)"
xattr -cr "$app" # clear any extended attributes the copies picked up
codesign --force --deep --sign - "$app"
codesign --verify --deep --strict "$app"

rm -rf "$out"
mkdir -p "$(dirname "$out")"
ditto "$app" "$out"
echo
echo "Built: $out"
if [ "$install" = 1 ]; then
  rm -rf "/Applications/$name.app"
  ditto "$app" "/Applications/$name.app"
  out="/Applications/$name.app"
  echo "Installed: $out"
fi
if [ "$open_app" = 1 ]; then open "$out"; fi
