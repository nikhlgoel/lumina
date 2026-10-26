#!/usr/bin/env bash
# Builds the signed, installable release APK for the Fire TV app.
#
#   1. refuses to run without a signing key (tv/keystore.properties), so an unsigned or throwaway-signed file can never
#      be mistaken for a release;
#   2. runs the unit tests, then builds the minified release;
#   3. verifies the signature with apksigner;
#   4. writes dist/lumina-tv-<version>.apk (the name the in-app updater looks for) and a .sha256 beside it.
#
# Needs JAVA_HOME (JDK 17 or 21), `gradle` (or GRADLE=...), and ANDROID_HOME pointing at the Android SDK.
# Run from anywhere:   bash tv/tools/release.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f keystore.properties ]; then
  echo "No tv/keystore.properties, so there is no signing key to use." >&2
  echo "Create one first: see 'Signing a release' in docs/15_FIRE_TV.md." >&2
  exit 1
fi

: "${ANDROID_HOME:?Set ANDROID_HOME to the Android SDK folder (it holds build-tools/)}"
apksigner=$(ls -d "$ANDROID_HOME"/build-tools/*/apksigner* 2>/dev/null | sort | tail -1 || true)
if [ -z "$apksigner" ]; then
  echo "apksigner not found under $ANDROID_HOME/build-tools" >&2
  exit 1
fi

GRADLE=${GRADLE:-gradle}
"$GRADLE" :app:testDebugUnitTest :app:assembleRelease

version=$(grep -m1 -oE 'versionName = "[^"]+"' app/build.gradle.kts | cut -d'"' -f2)
apk=app/build/outputs/apk/release/app-release.apk
if [ ! -f "$apk" ]; then
  echo "The release build did not produce $apk (an unsigned build is named app-release-unsigned.apk)." >&2
  exit 1
fi

"$apksigner" verify --verbose "$apk"

mkdir -p dist
out="dist/lumina-tv-$version.apk"
cp "$apk" "$out"
( cd dist && sha256sum "lumina-tv-$version.apk" > "lumina-tv-$version.apk.sha256" )
echo
echo "Signed release: tv/$out"
cat "dist/lumina-tv-$version.apk.sha256"
