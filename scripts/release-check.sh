#!/usr/bin/env bash
# Everything that must be true before a release is published. Run it from the repo root:
#
#   bash scripts/release-check.sh
#
# It stops at the first failure and says which gate failed. It takes about 15 minutes and opens no window you can see: the real-app suites run
# the built app offscreen in fresh scratch profiles (never your own profile or downloads folder).
#
# What it cannot do: tell you the app is pleasant to use, or that a real host still behaves as it did. The "soak" step at the end of
# PUBLISHING.md covers that, and it is the part that matters most.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

fail() { echo; echo "RELEASE CHECK FAILED: $1"; exit 1; }
step() { echo; echo "=== $1"; }

step "1. Versions agree"
app=$(node -p "require('./package.json').version")
ext=$(node -p "require('./extension/manifest.json').version")
top=$(grep -m1 -E '^## \[' CHANGELOG.md | sed -E 's/^## \[([^]]+)\].*/\1/')
echo "app $app | extension $ext | newest CHANGELOG heading: $top"
[ "$top" = "Unreleased" ] && echo "note: CHANGELOG still has an [Unreleased] heading at the top; rename it to $app before tagging"
[ "$top" != "Unreleased" ] && [ "$top" != "$app" ] && fail "CHANGELOG's newest version ($top) is not package.json's ($app)"
# The store refuses an upload whose version is not higher than the one it has. Bump extension/manifest.json when the extension changed.
if [ -n "$(git log -1 --format=%H "$app" -- extension 2>/dev/null)" ] && [ -n "$(git diff --name-only "$app" -- extension 2>/dev/null)" ]; then
  echo "note: the extension changed since the last release tag ($app). Raise extension/manifest.json (now $ext) before uploading it to a store."
fi

step "2. Types, unit tests, build"
npx tsc --noEmit || fail "type check"
npx vitest run 2>&1 | grep -E "Test Files|Tests |FAIL"
[ "${PIPESTATUS[0]}" -eq 0 ] || fail "unit tests"
npx vite build >/dev/null 2>&1 || fail "vite build"

S="$(mktemp -d 2>/dev/null || echo "$PWD/.release-check")"
mkdir -p "$S"/p{1,2,3,4} "$S"/s{1,2,3,4}
run() { env -u ELECTRON_RUN_AS_NODE LUMINA_SELFTEST=1 "$@"; }
suite() {
  local name="$1" want="$2"; shift 2
  : > "$S/$name.log"
  "$@" >/dev/null 2>&1
  grep -E "^\[selftest\] (FAIL|[0-9]+/)" "$S/$name.log"
  grep -qE "$want" "$S/$name.log" || fail "the $name suite (see $S/$name.log)"
}

step "3. The real app, offscreen: page-driving layouts, host handling, challenge gate, streams"
suite driver "^\[selftest\] ([0-9]+)/\1 layouts read" run LUMINA_SELFTEST_DRIVER=1 LUMINA_SELFTEST_DIR="$S/s1" LUMINA_SELFTEST_LOG="$S/driver.log" timeout 420 ./node_modules/.bin/electron . --user-data-dir="$S/p1"
suite hosts "^\[selftest\] ([0-9]+)/\1 checks passed" run LUMINA_SELFTEST_HOSTS=1 LUMINA_SELFTEST_OFFSCREEN=1 LUMINA_SELFTEST_DIR="$S/s2" LUMINA_SELFTEST_LOG="$S/hosts.log" timeout 420 ./node_modules/.bin/electron . --user-data-dir="$S/p2"
suite gate "^\[selftest\] ([0-9]+)/\1 checks passed" run LUMINA_SELFTEST_GATE=1 LUMINA_SELFTEST_DIR="$S/s3" LUMINA_SELFTEST_LOG="$S/gate.log" timeout 320 ./node_modules/.bin/electron . --user-data-dir="$S/p3"
suite stream "^\[selftest\] ([0-9]+)/\1 checks passed" run LUMINA_SELFTEST_STREAM=1 LUMINA_SELFTEST_DIR="$S/s4" LUMINA_SELFTEST_LOG="$S/stream.log" timeout 240 ./node_modules/.bin/electron . --user-data-dir="$S/p4"
mkdir -p "$S"/p{5,6} "$S"/s{5,6}
# Cancelling running downloads must end as "Cancelled", never "failed"; downloading files that are already in the folder must skip, replace or keep both as asked.
suite cancel "^\[selftest\] ([0-9]+)/\1 checks passed" run LUMINA_SELFTEST_CANCEL=1 LUMINA_SELFTEST_DIR="$S/s5" LUMINA_SELFTEST_LOG="$S/cancel.log" timeout 240 ./node_modules/.bin/electron . --user-data-dir="$S/p5"
suite existing "^\[selftest\] ([0-9]+)/\1 checks passed" run LUMINA_SELFTEST_EXISTING=1 LUMINA_SELFTEST_DIR="$S/s6" LUMINA_SELFTEST_LOG="$S/existing.log" timeout 240 ./node_modules/.bin/electron . --user-data-dir="$S/p6"
mkdir -p "$S"/p7 "$S"/s7
# The torrent settings in the real engine: presets reach aria2, "Stop" stops sharing, the sharing choices share, no local tracker gets through.
suite torrent "^\[selftest\] ([0-9]+)/\1 checks passed" run LUMINA_SELFTEST_TORRENT=1 LUMINA_SELFTEST_DIR="$S/s7" LUMINA_SELFTEST_LOG="$S/torrent.log" timeout 240 ./node_modules/.bin/electron . --user-data-dir="$S/p7"
# Not run here: LUMINA_SELFTEST_TRASH (deleting a folder playlist) really uses the Recycle Bin; run it by hand when that code changes (see SESSION-LOG 63).

step "4. The browser extension, end to end"
timeout 300 node tests/e2e/extension-links-e2e.mjs 2>&1 | tee "$S/extension.log" | grep -E "^FAIL|checks passed"
grep -qE "^([0-9]+) of \1 checks passed" "$S/extension.log" || fail "extension end-to-end (see $S/extension.log)"
# A whole series: the episode list is read, each episode is opened in a background tab, the ones with a video are told from the empty ones, and the series is sent.
timeout 300 node tests/e2e/extension-episodes-e2e.mjs 2>&1 | tee "$S/episodes.log" | grep -E "^FAIL|checks passed"
grep -qE "^([0-9]+) of \1 checks passed" "$S/episodes.log" || fail "episodes end-to-end (see $S/episodes.log)"

step "4b. The equalizer's sound, measured: the real audio chain, real pink noise through the real player, and the panel"
mkdir -p "$S/audio/cap" "$S/audio/prof" "$S/audio/scratch"
env -u ELECTRON_RUN_AS_NODE LUMINA_CAPTURE="$S/audio/cap" LUMINA_PROBE_AUDIO="$S/audio/scratch" LUMINA_CAPTURE_ONLY='probe-audio|9100|9101|9102|9103|9104' timeout 600 ./node_modules/.bin/electron . --user-data-dir="$S/audio/prof" >/dev/null 2>&1
node scripts/check-probes.mjs "$S/audio/cap/probe-audio-offline.json" "$S/audio/cap/probe-audio-live.json" | tail -20
node scripts/check-probes.mjs "$S/audio/cap/probe-audio-offline.json" "$S/audio/cap/probe-audio-live.json" >/dev/null || fail "equalizer sound checks (see $S/audio/cap)"

step "4c. A whole series through the real app: delivered over the real bridge, picked, downloaded under its names"
mkdir -p "$S/series/cap" "$S/series/prof" "$S/series/scratch"
echo '{"extension":{"port":17999}}' > "$S/series/prof/settings.json"
env -u ELECTRON_RUN_AS_NODE LUMINA_TEST_AUTO_APPROVE=1 LUMINA_PROBE_EPISODES_PORT=17999 LUMINA_CAPTURE="$S/series/cap" LUMINA_PROBE_EPISODES="$S/series/scratch" LUMINA_CAPTURE_ONLY='8100|probe-episodes|8101' timeout 400 ./node_modules/.bin/electron . --user-data-dir="$S/series/prof" >/dev/null 2>&1
node scripts/check-series.mjs "$S/series/scratch" "$S/series/cap" || fail "series through the real app (see $S/series)"

step "4d. Robustness in the real app: hostile input to the IPC channels, and a soak that visits every screen over and over"
mkdir -p "$S/fuzz/cap" "$S/fuzz/prof" "$S/fuzz/scratch" "$S/leak/cap" "$S/leak/prof" "$S/leak/scratch"
env -u ELECTRON_RUN_AS_NODE LUMINA_CAPTURE="$S/fuzz/cap" LUMINA_PROBE_FUZZ="$S/fuzz/scratch" LUMINA_CAPTURE_ONLY='probe-ipc-fuzz' timeout 900 ./node_modules/.bin/electron . --user-data-dir="$S/fuzz/prof" >/dev/null 2>&1
node scripts/check-robust.mjs fuzz "$S/fuzz/scratch" "$S/fuzz/cap" || fail "IPC fuzz (see $S/fuzz)"
env -u ELECTRON_RUN_AS_NODE LUMINA_CAPTURE="$S/leak/cap" LUMINA_PROBE_LEAK="$S/leak/scratch" LUMINA_CAPTURE_ONLY='probe-leak' timeout 900 ./node_modules/.bin/electron . --user-data-dir="$S/leak/prof" >/dev/null 2>&1
node scripts/check-robust.mjs leak "$S/leak/scratch" "$S/leak/cap" || fail "leak soak (see $S/leak)"

step "5. Property tests, pushed harder than usual"
FUZZ_RUNS=5000 npx vitest run tests/invariants.test.ts 2>&1 | grep -E "Tests |FAIL"
[ "${PIPESTATUS[0]}" -eq 0 ] || fail "property tests"

echo
echo "ALL GATES PASSED for $app."
echo "Not done by this script (do them by hand, in order):"
echo "  - build the installers and install the Standard one on a second Windows account or a clean VM, and open it"
echo "  - the soak: use the release candidate yourself for at least 3 days, then read the log for WARN/ERROR lines (PUBLISHING.md)"
