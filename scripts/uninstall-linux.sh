#!/usr/bin/env bash
# ============================================================
#  Lumina — Linux Uninstaller
#  Removes all installed components cleanly
# ============================================================
set -euo pipefail

DESKTOP_NAME="lumina-media"
INSTALL_DIR="$HOME/.local/share/lumina"
BIN_DIR="$HOME/.local/bin"
DESKTOP_DIR="$HOME/.local/share/applications"
ICON_BASE="$HOME/.local/share/icons/hicolor"

echo "╔════════════════════════════════════════════════════════╗"
echo "║           Lumina — Linux Uninstaller                   ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""

# ── Remove AppImage + Engine ────────────────────────────────
if [[ -d "$INSTALL_DIR" ]]; then
  echo "→ Removing $INSTALL_DIR/ ..."
  rm -rf "$INSTALL_DIR"
  echo "  ✓ Removed"
else
  echo "  • Install directory not found (already removed)"
fi

# ── Remove launcher ─────────────────────────────────────────
if [[ -f "$BIN_DIR/lumina" ]]; then
  echo "→ Removing launcher $BIN_DIR/lumina ..."
  rm -f "$BIN_DIR/lumina"
  echo "  ✓ Removed"
fi

# ── Remove desktop entry ────────────────────────────────────
if [[ -f "$DESKTOP_DIR/${DESKTOP_NAME}.desktop" ]]; then
  echo "→ Removing desktop entry..."
  rm -f "$DESKTOP_DIR/${DESKTOP_NAME}.desktop"
  echo "  ✓ Removed"
fi

# ── Remove icons ────────────────────────────────────────────
echo "→ Removing application icons..."
REMOVED=0
for size in 16 24 32 48 64 128 256 512 1024; do
  icon="$ICON_BASE/${size}x${size}/apps/${DESKTOP_NAME}.png"
  if [[ -f "$icon" ]]; then
    rm -f "$icon"
    REMOVED=$((REMOVED + 1))
  fi
done
echo "  ✓ Removed $REMOVED icon files"

# ── Update databases ────────────────────────────────────────
if command -v update-desktop-database &> /dev/null; then
  update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
fi
if command -v gtk-update-icon-cache &> /dev/null; then
  gtk-update-icon-cache -f -t "$ICON_BASE" 2>/dev/null || true
fi

echo ""
echo "✓ Lumina has been completely uninstalled."
echo "  User data at ~/.config/lumina/ was preserved."
echo "  To remove user data too: rm -rf ~/.config/lumina/"
