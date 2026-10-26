#!/usr/bin/env bash
# Builds the Windows installers.
#
#   bash build-variants.sh standard   downloader, player and in-app browser (no code editor)
#   bash build-variants.sh full       everything: adds the code editor, terminal, source control and MCP client
#   bash build-variants.sh            both (standard first, so the last build left in dist/ is the full one)
#
# Each is a different Vite build, not a runtime switch: an excluded feature's code is never bundled.
set -euo pipefail
cd "$(dirname "$0")"
which=${1:-all}

standard() {
  echo "=== Standard (downloader, player, browser) ==="
  LUMINA_NO_IDE=1 npx vite build
  # The renderer of a build without the editor is about 1 MB; if this prints ~16 MB the exclusion did nothing.
  du -sh dist
  npx electron-builder --win nsis --config.nsis.artifactName='Lumina-${version}-Standard-Setup.exe'
}

full() {
  echo "=== Full (adds editor, terminal, source control) ==="
  npx vite build
  du -sh dist
  npx electron-builder --win nsis --config.nsis.artifactName='Lumina-${version}-Full-Setup.exe'
}

case "$which" in
  standard) standard ;;
  full) full ;;
  all) standard; full ;;
  *) echo "usage: bash build-variants.sh [standard|full|all]" >&2; exit 1 ;;
esac

echo "=== done ==="
ls -la release/*-Setup.exe
