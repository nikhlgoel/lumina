#!/usr/bin/env bash
# ============================================================
#  Lumina — Linux Installer
#  Installs the Lumina AppImage + desktop integration + engine
#  to ~/.local without requiring root/sudo
# ============================================================
set -euo pipefail

APP_NAME="Lumina"
APP_ID="com.lumina.media"
DESKTOP_NAME="lumina-media"
VERSION="1.3.1"

# ── Resolve source directory (where this script lives) ───────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
APPIMAGE="$PROJECT_ROOT/release/Lumina-${VERSION}-x86_64.AppImage"

# ── Target installation directories ─────────────────────────
INSTALL_DIR="$HOME/.local/share/lumina"
BIN_DIR="$HOME/.local/bin"
DESKTOP_DIR="$HOME/.local/share/applications"
ICON_BASE="$HOME/.local/share/icons/hicolor"

echo "╔════════════════════════════════════════════════════════╗"
echo "║           Lumina v${VERSION} — Linux Installer              ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""

# ── Verify AppImage exists ───────────────────────────────────
if [[ ! -f "$APPIMAGE" ]]; then
  echo "✗ AppImage not found at: $APPIMAGE"
  echo "  Run 'pnpm build && npx electron-builder --linux AppImage' first."
  exit 1
fi
echo "✓ Found AppImage: $(basename "$APPIMAGE") ($(du -h "$APPIMAGE" | cut -f1))"

# ── Create directories ──────────────────────────────────────
echo ""
echo "→ Creating installation directories..."
mkdir -p "$INSTALL_DIR"
mkdir -p "$BIN_DIR"
mkdir -p "$DESKTOP_DIR"

# ── Copy AppImage ────────────────────────────────────────────
echo "→ Installing AppImage to $INSTALL_DIR/"
cp -f "$APPIMAGE" "$INSTALL_DIR/Lumina.AppImage"
chmod +x "$INSTALL_DIR/Lumina.AppImage"
echo "  ✓ AppImage installed ($(du -h "$INSTALL_DIR/Lumina.AppImage" | cut -f1))"

# ── Copy engine (yt-dlp, spotdl, etc.) ──────────────────────
ENGINE_SRC="$PROJECT_ROOT/engine"
if [[ -d "$ENGINE_SRC" ]]; then
  echo "→ Installing engine (yt-dlp, spotdl, aria2c bindings)..."
  if [[ -d "$INSTALL_DIR/engine" ]]; then
    rm -rf "$INSTALL_DIR/engine"
  fi
  cp -a "$ENGINE_SRC" "$INSTALL_DIR/engine"
  echo "  ✓ Engine installed ($(du -sh "$INSTALL_DIR/engine" | cut -f1))"
else
  echo "  ⚠ Engine directory not found, skipping."
fi

# ── Create launcher symlink in PATH ─────────────────────────
echo "→ Creating launcher symlink..."
cat > "$BIN_DIR/lumina" << 'LAUNCHER'
#!/usr/bin/env bash
# Lumina launcher — sets CWD to install dir so engine/ is found
INSTALL_DIR="$HOME/.local/share/lumina"
cd "$INSTALL_DIR" && exec "$INSTALL_DIR/Lumina.AppImage" "$@"
LAUNCHER
chmod +x "$BIN_DIR/lumina"
echo "  ✓ Launcher: $BIN_DIR/lumina"

# ── Install icons at all standard sizes ─────────────────────
echo "→ Installing application icons..."
ICON_SIZES=(16 24 32 48 64 128 256 512 1024)
ICONS_SRC="$PROJECT_ROOT/assets/icons"
INSTALLED_ICONS=0

for size in "${ICON_SIZES[@]}"; do
  src="$ICONS_SRC/icon_${size}.png"
  if [[ -f "$src" ]]; then
    dest_dir="$ICON_BASE/${size}x${size}/apps"
    mkdir -p "$dest_dir"
    cp -f "$src" "$dest_dir/${DESKTOP_NAME}.png"
    INSTALLED_ICONS=$((INSTALLED_ICONS + 1))
  fi
done
echo "  ✓ Installed $INSTALLED_ICONS icon sizes (16px → 1024px)"

# ── Create .desktop file ────────────────────────────────────
echo "→ Creating desktop entry..."
cat > "$DESKTOP_DIR/${DESKTOP_NAME}.desktop" << DESKTOP
[Desktop Entry]
Name=Lumina
GenericName=Media Downloader
Comment=Ultra-sleek universal media downloader & player
Exec=$BIN_DIR/lumina %U
Icon=${DESKTOP_NAME}
Terminal=false
Type=Application
Categories=AudioVideo;Audio;Video;Network;FileTransfer;
Keywords=download;video;music;torrent;youtube;spotify;media;
StartupWMClass=lumina-media
MimeType=application/x-bittorrent;x-scheme-handler/magnet;
StartupNotify=true
DESKTOP
chmod +x "$DESKTOP_DIR/${DESKTOP_NAME}.desktop"
echo "  ✓ Desktop entry: $DESKTOP_DIR/${DESKTOP_NAME}.desktop"

# ── Register MIME types ──────────────────────────────────────
echo "→ Registering MIME type associations..."
if command -v xdg-mime &> /dev/null; then
  xdg-mime default "${DESKTOP_NAME}.desktop" application/x-bittorrent 2>/dev/null || true
  xdg-mime default "${DESKTOP_NAME}.desktop" x-scheme-handler/magnet 2>/dev/null || true
  echo "  ✓ Registered as handler for .torrent files and magnet: links"
else
  echo "  ⚠ xdg-mime not found, skipping MIME registration"
fi

# ── Update desktop database ─────────────────────────────────
echo "→ Updating desktop database..."
if command -v update-desktop-database &> /dev/null; then
  update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
  echo "  ✓ Desktop database updated"
fi

# ── Update icon cache ───────────────────────────────────────
if command -v gtk-update-icon-cache &> /dev/null; then
  gtk-update-icon-cache -f -t "$ICON_BASE" 2>/dev/null || true
  echo "  ✓ Icon cache refreshed"
fi

# ── Verify PATH includes ~/.local/bin ────────────────────────
echo ""
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo "⚠ $BIN_DIR is not in your PATH."
  echo "  Add this to your ~/.bashrc or ~/.zshrc:"
  echo "    export PATH=\"\$HOME/.local/bin:\$PATH\""
  echo ""
fi

# ── Summary ──────────────────────────────────────────────────
echo "╔════════════════════════════════════════════════════════╗"
echo "║          ✓ Lumina v${VERSION} Installed Successfully!       ║"
echo "╠════════════════════════════════════════════════════════╣"
echo "║                                                        ║"
echo "║  Launch methods:                                       ║"
echo "║   • App Menu  → Search 'Lumina'                        ║"
echo "║   • Terminal  → lumina                                  ║"
echo "║   • Direct    → ~/.local/share/lumina/Lumina.AppImage   ║"
echo "║                                                        ║"
echo "║  Install path: ~/.local/share/lumina/                   ║"
echo "║  Launcher:     ~/.local/bin/lumina                      ║"
echo "║                                                        ║"
echo "╚════════════════════════════════════════════════════════╝"
