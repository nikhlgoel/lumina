#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
echo "=== 1/3 full ==="
npx vite build
npx electron-builder --win nsis
echo "=== 2/3 no-ide ==="
LUMINA_NO_IDE=1 npx vite build
npx electron-builder --win nsis --config.nsis.artifactName="Lumina Setup_v\${version}-no-ide.exe"
echo "=== 3/3 player ==="
LUMINA_NO_IDE=1 LUMINA_NO_BROWSER=1 npx vite build
npx electron-builder --win nsis --config.nsis.artifactName="Lumina Setup_v\${version}-player.exe"
echo "=== done ==="
ls -la release/*.exe
