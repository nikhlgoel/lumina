# Lumina — Handover / Continue-Here Doc

**Read this first if you are a fresh assistant (or a new account) picking up this project.**
Then read [SESSION-LOG.md](SESSION-LOG.md) for the running chronological log of what was done and what's next.
Keep **both** files updated as you work — that is how the next session continues seamlessly.

---

## 1. What Lumina is

A free, open-source **universal download assistant + offline media player** — "download anything from the web,
play it beautifully offline." Not a piracy tool; a general downloader (the same class as IDM / JDownloader / yt-dlp
front-ends) plus a VLC-class local player with a music-library experience.

- **Repo:** `https://github.com/nikhlgoel/lumina.git` (owner `nikhlgoel`, `white.dev.sc@gmail.com`)
- **Working dir:** `D:\main\projects\temp\lumine`
- **Version:** `3.0.0-alpha.0` (semver; alpha.0 = first alpha, feature-incomplete, expect bugs)
- **Stack:** Electron 44 · Vite 8 · React 19 · Tailwind 4 · Zustand · Zod · better-sqlite3
- **Bundled tools** (`resources/bin/win32-x64`): aria2c, yt-dlp, ffmpeg, 7-Zip, whisper-cli + llama.dll
- **Platform of the maintainer:** Windows 11, Brave is the primary browser, ~650 Mbps connection.

## 2. How to get oriented fast (read order)

1. This file (rules + state).
2. `SESSION-LOG.md` (what just happened, what's next).
3. `docs/10_SYSTEMATIC_EXECUTION_ROADMAP.md` and `docs/03_TECH_STACK_AND_SYSTEM_ARCHITECTURE.md`.
4. Code entry points: `src/main/index.ts` (main), `src/main/jobs/queue.ts` (the scheduler — central),
   `src/renderer/src/App.tsx` (renderer), `src/shared/settings.ts` (every setting + Zod schema).

## 3. HARD RULES — do not break these

These are non-negotiable and have already caused real blocks; re-litigating them wastes the user's paid time.

1. **NO bot-detection / Cloudflare Turnstile / DataDome evasion.** No `navigator.webdriver` spoofing, no
   `disable-blink-features=AutomationControlled`, no occlusion/visibility faking, no `cf_clearance`/clearance-token
   harvest-and-replay, no auto-solving, no solver farms. **The build environment's security classifier HARD-BLOCKS
   such code — it blocked `tsc` twice when this was attempted, and both attempts were reverted.** The *only* legitimate
   path is: the user solves the check themselves in a real browser — via the **browser extension** (rides their real
   Brave/Chrome session) or the **in-app browser** (`src/main/browser.ts`, a real Chromium `WebContentsView` the user
   drives). A real human in a real browser passes Turnstile normally; that is not evasion. Legitimate helpers that ARE
   allowed and shipped: ad/pop-up/redirect network blocking, and reloading a challenge page in a *visible* window.
   For the record: IDM/FDM don't "bypass" Turnstile either (they ride the browser via extension); JDownloader pops the
   captcha to the user. If asked again to evade flagging, hold this line and offer the extension/in-app-browser path.
2. **NO downloading pirated/infringing content for testing.** When a feature needs a live download to verify, use
   **public, non-infringing** URLs only (e.g. Big Buck Bunny, `sample-videos`, a YouTube Creative-Commons clip,
   a public direct-file host). Never test against pirate/repack/warez sources.
3. **Verify before you commit.** The user's standing instruction: *"do not commit without properly verifying live that
   the feature or change mentioned for that commit actually works."* Run the verification suite (§5). For UI-only CSS
   changes, tsc + build + reading the compiled output is acceptable when a live screenshot isn't feasible — say so
   honestly in the commit/among your notes.
4. **Releases:** publish to **winget + Homebrew + Linux terminal managers** and a **GitHub release** — **NO Microsoft
   Store**. Ship a public release **only** once the app is genuinely stable and every advertised feature/setting truly
   works. Bug reports go to **GitHub Issues** for now (collaborator-only issue-backed admin panel is a later idea).
   When the user says "put a release," publish only the latest real changes — no filler notes. See `PUBLISHING.md`.
5. **Honesty in claims.** No "for show" features. The supported-site count is stated truthfully (~1,300+ distinct
   sites; yt-dlp reports 1,700+ extractors) with a verifiable in-app link. Keep it that way.

## 4. Roadmap & phase priority

**Phase 1 (current): stability + the download engine + the 30-item testing-feedback fixes.** Finish and verify these
before anything big. See §7 for the item-by-item status.

**Phase 2 (deferred until Phase 1 is done & stable): the "GOAT edition."** A separate, fuller release:
- Full in-app browser (themed, multi-tab, extensions, cookie-carrying auto-capture).
- An embedded IDE (VSCode/Code-OSS-class): `openvscode-server` in a `WebContentsView`; command palette (Ctrl+Shift+P);
  movable/resizable panels; file explorer; source control; integrated terminal that auto-picks WSL/Git Bash/cmd/
  PowerShell; **Open VSX** marketplace. Precedent: Cursor/Windsurf = VSCode fork + AI.
- AI chat as a **separate Lumina extension**: plan / edit / execute modes; OAuth providers (Claude, Gemini, OpenRouter)
  or a local model; toggle models off to save RAM.

**Later ideas captured (see §8 for detail + my recommendation):** offline music-platform experience (likes / albums /
local playlists / hybrid stream-if-not-downloaded); in-app **equalizer + audio profiles** (DONE); (declined) audio-
driver auto-updater; USB portable player + import/export/sync; Chrome Web Store listing for the extension;
**Lumina Sync** — Brave-Sync-like local device "chain" with no third-party cloud (full design in §11).

## 5. Verification suite (run from repo root)

```bash
npx tsc --noEmit                 # types — must be clean
npx vitest run                   # unit tests (currently 154 passing)
npx vite build                   # production build must succeed
```

Host end-to-end smoke (Electron; needs its own user-data-dir because a single-instance lock is held by the user's app):
```bash
env -u ELECTRON_RUN_AS_NODE LUMINA_SELFTEST=1 LUMINA_SELFTEST_HOSTS=1 \
  LUMINA_SELFTEST_LOG=<logfile> ./node_modules/.bin/electron . --user-data-dir=<scratch>
# expect 14/14 checks
```

Screenshot capture harness (dev only) for visual review:
```bash
LUMINA_CAPTURE=<dir> LUMINA_CAPTURE_ONLY=<name-regex> ./node_modules/.bin/electron . --user-data-dir=<scratch>
# steps live in src/main/capture.ts
```

## 6. Environment quirks (Windows dev)

- **Shell:** PowerShell is primary; a Bash (Git Bash / POSIX) tool is also available — each needs its own syntax.
- **GUI Electron doesn't pipe stdout on Windows** → use the `LUMINA_SELFTEST_LOG` file sink to read self-test output.
- **Second Electron instance:** the user's running app holds the single-instance lock; always pass `--user-data-dir=`
  a scratch dir to launch a test instance.
- **`ELECTRON_RUN_AS_NODE`** must be *unset* (`env -u`) when launching the real app for self-test/capture.
- **Heredocs:** watch backslash escaping in Bash heredocs on Windows.
- **Tailwind arbitrary `calc()`** needs underscores for spaces: `top-[calc(var(--titlebar)_+_12px)]` compiles to
  `calc(var(--titlebar) + 12px)`. A literal space is invalid.
- Memory note file (local to this machine/account only, not in repo):
  `…/memory/lumina-dev-quirks.md`. A new account won't have it — this HANDOVER is the portable source of truth.

## 7. The 30-item testing feedback — status

Legend: ✅ done · 🟡 partial/in progress · ⬜ not started.

| # | Item | Status |
|---|------|--------|
| 1 | Slow/unstable download speed (route yt-dlp via aria2 / tune fragments for ~650 Mbps) | 🟡 **accelerator built** — plain http/https/ftp yt-dlp downloads go through bundled aria2 (`-x/-s` = Connections-per-file, `--disk-cache=64M`); HLS/DASH stay native. Setting `downloads.accelerate` (default on) + toggle. Also **volume-aware temp** (cross-drive downloads land straight in the output folder — no end-of-download copy) and aria2 daemon `--disk-cache` 32→64M. Full cause list: `docs/13_DOWNLOAD_SPEED_THROTTLE_AUDIT.md`. **Needs live speed + progress test.** |
| 2 | Subtitle display in player | 🟡 **already wired** (player attaches a `<track>` + CC toggle + cue styling); this session made the `lumina-media://subs` route robust — matches any English `.srt`/`.vtt` sidecar variant and **extracts embedded subtitle tracks via ffmpeg** when there's no sidecar (fixes embed-only downloads & imported videos). **Needs live check with an embedded-subs video.** |
| 3 | Group repacks as ONE download in Recent/Queue (not per-part) | ⬜ (batch UI exists; grouping pending) |
| 4 | Captcha verification failing | 🟡 addressed via extension + in-app browser + visible-window reload |
| 5 | Block ads/redirects + reposition verify button | 🟡 ad/pop/redirect blocking shipped (147ad02); button reposition ⬜ |
| 6 | Skip-All + notifications to top-right (not bottom) | ✅ **done** — toasts top-right (ae099d2); **Skip-all now added** to the Quick-check dialog: when others are queued it shows "Skip all (N)" which skips the current file *and* every download-page challenge waiting behind it in one click (`hosters.ts` `challengeAction('skip-all')` drains `waitingTurns` then skips the active one; IPC enum + `QuickCheck.tsx` button). Self-test challenge flow still green. |
| 7 | Populate search menu | ✅ **done** — the search bar now drops a **Recent searches** menu when it's focused and empty (was a blank box). Persisted per-viewer in localStorage (guarded), click re-runs the search, Clear empties it (`download/recentSearches.ts` + `SearchSuggestions.tsx`, wired in `DownloadView.tsx`; recorded on each `runSearch`). |
| 8 | "500 MB repack limit" | ✅ audited — no cap exists (ae099d2) |
| 9 | Repack grouping in Queue (see #3) | ⬜ |
| 10 | Torrent file-selection + detail page + custom graph + "disk cache flush failure" fix | ⬜ |
| 11 | Test-accounts sign-in + privacy message | ✅ **done** — sign-in already existed (YouTube/Spotify/any site, in Settings ▸ Connections). This session added the missing **privacy message**: a clear panel at the top of the sign-in group stating the window is the real site, password/2FA go only to it (never to Lumina), only the session cookies are kept on this computer, Lumina has no account/server to send them to, and Sign-out deletes them (`sections/connections.tsx`). Wording kept accurate — no "encrypted" overclaim for the yt-dlp cookies.txt. |
| 12 | Bug-report destination / admin panel | 🟡 decided: GitHub Issues now, issue-backed admin later |
| 13 | Proper semver / what alpha.0 means | ✅ documented (here + PUBLISHING.md) |
| 14 | Portable USB media player | ⬜ |
| 15 | Permission re-grant UI (Windows Firewall network access) | ✅ **built — needs live test.** Clarified by the user: it's the **Windows Firewall** "Allow access?" prompt aria2 triggers for torrent peers — deny it once and there's no way back. New `src/main/firewall.ts` (Windows-only, no-op elsewhere): `firewallStatus()` reads rules with non-elevated `netsh show`; `grantFirewallAccess()` writes a fixed batch (clears inbound rules bound to the tool's exe — removing Windows' auto-block — then adds a named allow rule) and runs it **elevated via one UAC prompt** (`Start-Process -Verb RunAs`). Generic tool list (aria2c now; extensible). IPC `firewall:status`/`firewall:grant`; UI = a "Network access (Windows Firewall)" group in Settings ▸ Connections with per-tool Allowed/Not-allowed badges + an "Allow through firewall" button; settings-search entry added. **No user input reaches the command line** (only our resolved, verified bundled-exe path). ⚠ The actual grant modifies the real firewall + needs UAC, so it **can't be verified headlessly** — the read-only status path was confirmed (`netsh show` needs no admin); the live grant + torrent-peer improvement is the maintainer's test. |
| 16 | Player format support (transcode/remux on play via bundled ffmpeg) | ✅ **already built** — the player streams undecodable files through ffmpeg on the fly (`lumina-media://remux/<id>`, seek re-streams at an offset) via the media element's `error` handler (`stores/player.ts`). |
| 17 | Like/rate + local playlists | ⬜ (see idea §8-A) |
| 18 | Toggle AI models off for RAM | ⬜ |
| 19 | USB detect + import/export/sync | ⬜ |
| 20 | Chrome Web Store extension listing | ⬜ |
| 21 | User AI API keys for lyrics | ⬜ |
| 22 | USB structure | ⬜ |
| 23 | Auto-update on launch + restart button | ⬜ |
| 24 | Web search in search bar | ✅ **done — multi-source** — typing non-link text searches **YouTube Music (Songs)** + **YouTube (Videos)** in parallel and shows them as separate labelled sections (`main/search.ts` `searchMulti` reusing `services/ytmusic.searchSongs` + a flat yt-dlp video search; IPC `search:query`; UI `download/SearchResults.tsx`). Clicking a hit reuses the inspect→download flow (songs→audio, videos→video defaults). Bare domains → https; real links unchanged. **Needs live test** (real search + thumbnails). |
| 25 | Animated bigger search bar | ✅ **done** — the home bar is now the centrepiece: taller (68px), with a slow, **theme-accent glow** that drifts behind it (`.search-glow` in `styles.css`, auto-stilled by `data-motion="reduced"`); keeps the idle→compact animation. |
| 26 | Play-while-downloading | ✅ **covered for the reliable cases** — finished jobs have a Play button (`queue/JobRow.tsx`), and library playback runs fine during downloads (app is non-modal). *Partial-file playback of an in-progress download is intentionally NOT shipped:* multi-connection/segmented downloads leave holes until complete, so it'd be flaky. |
| 27 | UI placement shift with long title | ✅ player Dock fix (ae099d2) |
| 28 | Video fullscreen overlay controls | ✅ **already built** — the full control Dock (seek/play/subs/volume) overlays fullscreen video and auto-hides on idle (`data-idle` + wake on pointer move; cursor hidden). `PlayerView.tsx` + `player.css`. |
| 29 | Library docs / other file types | ⬜ |
| 30 | Stuck at 6 GB + large-file optimization + expanded logging | ✅ **done** — aria2 stall root-cause fixed (cab6cfd); **cross-drive final-copy fixed** (volume-aware temp — likely the "stuck at 6 GB") + disk-cache bumps (see #1 / doc 13); aria2 already fails fast on a full disk. **Expanded logging added:** both engines now log a structured *download plan* at start (engine, connections, disk-cache MB, temp strategy, output dir, **free space on the destination volume**, speed limit) and a completion line (files/bytes) — so a stuck/slow download is diagnosable from `Open logs` alone (`jobs/ytdlp.ts`, `jobs/aria2.ts`). |
| 31 | Queue concurrency: extras auto-queue & auto-start when a slot frees; clearer than manual pause | ✅ scheduler already auto-manages; clarity/labels + tests added |
| 32 | Library view modes (compact list / grid / list) | ✅ music details/compact + video grid/list |

**Honest tally (updated 2026-09-18, do not overstate):** of the 32, roughly **16 done** (#6, #7, #8, #11, #13, #15,
#16, #24, #25, #26, #27, #28, #30, #31, #32), **~4 in progress/partial** (#1 & #2 built-but-need-live-test, #4, #5,
#12), and **~12 not started** (#3, #9, #10, #14, #17, #18, #19, #20, #21, #22, #23, #29). Several "done" ones were
**already implemented** and were mislabelled ⬜ — verified in code, not newly built. "Done" means code-complete +
tsc/vitest/build green (+ self-test for engine paths); items marked "needs live test" still require the user's real
run (#15's firewall grant + UAC especially can't be verified here). The app is **alpha**, not "100% verified."

**Built since the original 32 (not in the list):** Lumina Sync (crypto/merge/file transport + bookmarks provider +
Settings ▸ Sync), the portable Web-Crypto core for the Android LuminaBr companion (§12-doc), and a drag-resizable
sidebar. **In-app browser ad/malware blocking is DESIGNED, NOT BUILT** — see `docs/12_SAFE_BROWSING_AND_CONTENT_
BLOCKING.md`; today the user-facing browser (`persist:browser`) has no content blocking (only the hidden download
pages do). Browser toolbar redesign spec: `docs/11_IN_APP_BROWSER_REDESIGN.md`. Both are for the browser workday.

## 8. New ideas captured + my recommendation

**A. Offline music-platform experience (Spotify/YT-Music structure, offline).** Likes, albums, create/choose
playlists; downloaded songs kept offline; not-yet-downloaded songs can still stream (hybrid). **Recommendation: YES,
strong fit** — it formalizes item #17 and builds on the existing Library + player. Sequence it after Phase-1 stability.
Model: a "Collection" (liked/rated + user playlists) stored in sqlite, layered over the existing library scan; a track
can be `local` or `streamable`; the player queue already exists. Start with likes + local playlists + an Albums view.

**B. Equalizer + audio profiles.** **DONE (2026-09-17, opt-in; needs live audio test).** Implemented with the Web
Audio API — a lazily-built `AudioContext` + 5 `BiquadFilterNode` peaking bands over the single `media` element
(`src/renderer/src/lib/audio.ts`; profiles in `src/core/equalizer.ts`). Built-in profiles (Flat, Bass boost, Vocal,
Treble, Warm, Loudness) each with a description, plus a Custom 5-band curve. UI is a **player** Dock popover
(`views/player/AudioPanel.tsx`), not Settings. **Also (this session, per user request):** output-device switching via
`HTMLMediaElement.setSinkId`, and **system-tray quick-controls** for both output device and EQ profile (tray writes
`settings.player.*` → `settings:changed` → the renderer audio engine applies). EQ is off by default, so normal
playback is untouched until the user opts in. **Still needs the user's live test** (audio routing can't be verified in
the headless harness). Optional future stretch: WASAPI exclusive/bit-perfect output on Windows.

**C. Audio-driver detection + auto-download/update.** **Recommendation: NO — do not build this** (user agreed —
instead we added output-device switching under **B**). Installing system audio drivers is high-risk and largely
infeasible to do safely: it needs elevation, OEM drivers can't be legally redistributed, wrong/generic drivers can
break audio, and an app that fetches-and-installs drivers will trip SmartScreen/AV and create liability. The real
sound-quality win comes from **B**. Hardware detection, if ever wanted, should only *inform* (show the active output
device) and leave actual driver updates to the OS/vendor tools.

## 9. Architecture pointers

- **Queue/scheduler:** `src/main/jobs/queue.ts` — `JobQueue.schedule()` enforces `downloads.concurrency`, auto-starts
  `queued` jobs when a slot frees (called from `complete`/`fail`/`pause`/`resume`/`cancel`/`add`/`retry`). Separate
  pools: browser hand-offs (`origin==='browser'`, pool 16), CPU work (convert/subtitles, one at a time), extract
  (disk-bound, one at a time). aria2 supervision/restart/resume lives in `src/main/jobs/aria2.ts`.
- **Engines:** `aria2` (direct + torrent), `ytdlp` (streams/sites), plus `convert`/`subtitles`/`extract`.
- **Settings:** single Zod schema in `src/shared/settings.ts`; every field has a `.catch()` default so partial/old
  files parse. Renderer updates via `useApp().updateSettings(patch)` (optimistic). ~112 settings, all wired.
- **Renderer stores:** `src/renderer/src/stores/{app,jobs,library,player}.ts` (Zustand).
- **Pure logic** that should be unit-tested goes in `src/core/*` (aliased `@core`, importable from node tests);
  `@shared` is also node-importable. Renderer-only aliases (`@/…`) are **not** available in tests.

## 10. Git & commit conventions

- Conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`, `perf:`, `ci:`).
- Branch is `main`. Commit/push only when the user asks; the user often says "squash them all" → batch related fixes
  into one clean commit. No `Co-Authored-By` unless configured.
- Keep files focused (<~800 lines), immutable update patterns, explicit error handling (repo + ECC house style).

## 11. Planned feature — Lumina Sync (local device "chain", no third-party cloud)

**User ask (2026-09-17):** replicate Brave Sync — keep browser data (history, login data, cookies, bookmarks — and we'd
extend to library likes/playlists) synced across the user's own devices, **without a third-party cloud**. Devices join
a "chain"; each keeps its own copy but all data is merged and available on every device, so losing one device loses
nothing (add a new device to the chain to recover).

**Reality check on "no cloud":** Brave Sync actually relays through a Brave-run server, but data is **end-to-end
encrypted** with a BIP39 seed so the relay can't read it. Genuinely serverless options for Lumina:
- **A) LAN peer-to-peer** — devices on the same network discover each other (mDNS `_lumina-sync._tcp`) and sync
  directly over an encrypted socket. No server; instant; but only same-network + both online.
- **B) User-owned location** — sync through an encrypted blob on a place the user controls: a USB drive (ties into the
  planned USB import/export/sync, items #19/#22), a shared folder, or the user's own Syncthing/Drive/Dropbox folder.
  Works offline/asynchronously and across networks.
- **C) Self-hosted tiny relay** — advanced/optional.

**Recommendation: hybrid A + B.** LAN P2P for instant same-network sync; encrypted **sync file on USB/shared folder**
as the offline/cross-network fallback and the "lose a device, restore from another / from USB" story. This is the most
faithful "no cloud" match and reuses the USB roadmap.

**Security (non-negotiable — cookies & logins are secrets):**
- End-to-end encrypt everything with a key derived (Argon2id/HKDF) from a **sync seed** (BIP39 12 words, shown as words
  + QR). Pairing = transferring the seed to the new device (scan QR / type words on device B). The seed never leaves
  the chain and is never sent to any server.
- Cipher: XChaCha20-Poly1305 (or AES-256-GCM). Store the seed at rest in the OS keychain (`safeStorage`/DPAPI).
- Authenticate LAN peers by proving knowledge of the seed (challenge-response) before exchanging anything.

**Sync engine (CRDT-ish, testable in isolation):**
- Each syncable record: `{ id, type, payload, updatedAt, deviceId, deleted }` (tombstones for deletes).
- Merge = last-write-wins per record by `updatedAt`; history merges as a union; cookies LWW per `(domain,name)`;
  bookmarks LWW. Each device stores the full merged set.
- Deltas via a per-device high-water timestamp / simple vector clock.
- The browser data itself lives in the `persist:browser` Electron session (cookies/history) — read/write via
  `session.cookies`, a bookmarks store, and a history store; Lumina owns bookmarks/history persistence.

**UI:** Settings ▸ Sync — "Start a sync chain" (generate seed → show words + QR), "Add this device" (scan/enter seed),
list devices in the chain, per-type toggles (History · Logins & cookies · Bookmarks · Likes & playlists), "Sync now"
+ last-synced, "Remove device".

**Sequencing (Phase 2, security-sensitive — needs 2 devices to fully verify):**
1. ✅ **DONE (2026-09-17)** — the **crypto core** + the **merge/CRDT logic**, both pure and fully unit-tested here.
   - `src/core/syncCrypto.ts` (main-process only; `node:crypto`): 256-bit seed → grouped Crockford-base32 recovery
     code w/ checksum (`generateSeed`/`encodeSeed`/`decodeSeed`/`isValidSeed`); HKDF-SHA256 per-purpose keys;
     AES-256-GCM authenticated `encrypt`/`decrypt` (+`encryptJson`/`decryptJson`) with optional AAD binding;
     public non-secret `chainId` for LAN peer grouping; `authResponse`/`authVerify` HMAC challenge-response for
     pairing (constant-time). Tampered/wrong-seed/wrong-AAD/truncated input all return null (never throw).
   - `src/core/syncMerge.ts` (pure, no I/O): `SyncRecord {id,type,payload,updatedAt,deviceId,deleted}`; LWW
     `mergeRecord` (deterministic: updatedAt → deviceId → tombstone); immutable `upsert`/`mergeStores`/`mergeAll`
     (commutative, associative, idempotent — property-tested); tombstones + `liveRecords`; delta sync
     `highWater`/`changesSince`; `pruneTombstones`; `toArray`/`fromArray` serialisation.
   - Tests: `tests/syncCrypto.test.ts` (round-trips, tamper/wrong-seed/AAD rejection, checksum typos, pairing),
     `tests/syncMerge.test.ts` (LWW, convergence laws, tombstone wins, delta, prune). Verified: tsc clean ·
     vitest 101 passed · vite build ok. **No app wiring yet → zero runtime/regression risk.**
2. ✅ **DONE (2026-09-17)** — encrypted **file/USB/shared-folder sync**.
   - `src/core/syncDocument.ts` (pure): the `{ v, records }` envelope codec, `toDocument`/`fromDocument` with
     **Zod** validation. `fromDocument` returns a tagged result (`unsupported-version` | `malformed` | ok) so a
     future-version or corrupt doc can never be mistaken for an empty chain.
   - `src/main/sync/syncFile.ts` (**Electron-free** on purpose — node builtins + core only, so it's unit-tested
     here; the caller owns logging + the seed): `readSyncFile` (distinguishes `missing` from `unreadable`/
     `malformed`/`io`), `writeSyncFile` (atomic temp-file + rename, Windows replace fallback, 0o600, no stray
     temp on failure), `syncWithFile` (read → `mergeStores` → write-back union; returns merged store + `wrote` +
     `localChanged`). **Safety invariant enforced + tested:** an existing file that fails to decrypt (wrong seed/
     tamper/corrupt) is never overwritten and never treated as empty.
   - Tests: `tests/syncDocument.test.ts`, `tests/syncFile.test.ts` (two-device merge through a real temp file,
     tombstone propagation, wrong-seed refusal leaves bytes byte-for-byte intact, no leftover temp). Verified:
     tsc clean · vitest 116 passed · vite build ok. **Still not wired to IPC/settings/UI → zero runtime risk.**
3. **LAN P2P** transport (mDNS `_lumina-sync._tcp` discovery + `authResponse`/`authVerify` handshake + encrypted socket). ← next transport
4. 🟡 **Desktop wiring — mostly DONE (2026-09-17).** The PC side now produces/consumes sync records and has a UI:
   - **Provider engine** `src/core/syncEngine.ts` (pure): `SyncProvider` interface + `collect`/`distribute`/
     `recordsOfType` (tested).
   - **First provider + first user-data store:** `src/main/sync/bookmarks.ts` — a `BookmarkStore` (Electron-free,
     fs-backed, persists rows *as* sync records w/ tombstones) that *is* a `SyncProvider`. Bookmarks didn't exist
     before; this adds them (the in-app browser will get a "save page" button that calls `addBookmark`).
   - **Orchestrator** `src/main/sync/syncManager.ts` (Electron glue): seed lifecycle (`createChain`/`joinChain`/
     `leaveChain`) with the seed stored via `secrets.ts` (`safeStorage`/DPAPI, base64) + a stable per-install
     `device-id`; `syncNow()` = collect → `syncWithFile(folder/lumina-sync.bin)` → distribute; `syncStatus()`.
   - **IPC** (`sync:status|create-chain|join-chain|leave|now`, `bookmarks:list|add|remove`, event `sync:changed`)
     wired in `src/main/ipc.ts` (+`initSync()` at startup); settings `sync:{folder,deviceLabel,syncBookmarks}`.
   - **UI** Settings ▸ **Sync** (`src/renderer/src/views/settings/sections/sync.tsx`): create/join chain, show +
     copy recovery code, pick sync folder, Sync-now, and a bookmarks add/remove list to exercise it end-to-end.
   - **Verified:** tsc clean · vitest **138 passed** (full BookmarkStore⇄file⇄BookmarkStore pipeline test incl.
     delete propagation) · vite build ok · host self-test boots clean. **Live UI click-through + the actual
     2-device (PC⇄phone) round-trip still need a human** (and the phone needs LuminaBr, §12).
   - **Still to wire as providers:** cookies + history (browser session — sensitive), likes/playlists (idea §8-A).
     QR of the recovery code is deferred until LuminaBr camera scanning exists (code is shown/copyable for now).

**Cross-platform crypto (DONE 2026-09-17):** because the 2nd device is an **Android** phone/tablet (see §12), the
crypto core has a portable twin `src/core/syncCryptoWeb.ts` (Web Crypto API — runs in a browser, an Android
WebView/Capacitor, RN, and Node 20+). It's **byte-for-byte compatible** with `syncCrypto.ts` (same blob layout,
HKDF-SHA256, AES-256-GCM, Crockford-base32 recovery code, chainId, HMAC pairing). Locked down by cross-core
interop tests (`tests/syncCryptoWeb.test.ts`): a blob/recovery-code/challenge from one core is
accepted by the other. Shared Crockford base32 extracted to `src/core/base32.ts`. So the desktop and LuminaBr can
join the same chain. The two cores must stay in lockstep — the interop test fails loudly if they drift.

## 12. Planned — LuminaBr (Android companion browser + 2nd sync device)

**User ask (2026-09-17):** the second device in a sync chain is an **Android** phone/tablet (Android only for now).
To test sync end-to-end, produce an installable **APK "LuminaBr"** — a Lumina-themed browser — that the user
installs on their phone and pairs into the chain. (The desktop already carries the full customized in-app browser;
LuminaBr is its Android sibling.)

**Honesty / verification boundary (HARD RULE 3):** an Android APK **cannot be built or verified in this dev
environment** (no Android SDK/Gradle/device here), and shipping an unverified APK would be a "for-show" feature.
So the APK *build + install + on-device test* is the maintainer's step (Android Studio / SDK on their machine).
What *can* be built and verified here is all the **shared TypeScript** LuminaBr will run — which is why the sync
core was made portable first.

**Recommended stack: Capacitor (Ionic).** Rationale: it wraps a web app in an Android shell, so LuminaBr reuses
Lumina's existing React/TS UI and — crucially — the already-portable sync modules run **unchanged** in the Android
WebView: `syncCryptoWeb.ts`, `syncMerge.ts`, `syncDocument.ts`. Alternatives considered: React Native (more
native, less direct reuse of the existing React DOM UI); native Kotlin + WebView/GeckoView (a "realer" browser but
most work, zero code reuse). Capacitor is the fastest path to a *testable* 2nd device.
- **Browser surface:** a themed WebView (basic browsing + the Lumina start page) or system Custom Tabs.
- **Sync transport on Android (in order):** (1) **file-based** — read/write the encrypted `lumina-sync.bin` via
  Capacitor Filesystem to a location the PC also reaches (a shared Syncthing/Drive/Dropbox folder, or a file moved
  by hand/USB via SAF). This mirrors §11 step 2 and is the simplest thing to verify first. (2) **LAN P2P** later
  (§11 step 3) via a socket plugin + the `authResponse`/`authVerify` handshake.
- **Pairing UX:** desktop shows the recovery code as words + QR; LuminaBr scans the QR (camera) or the user types
  the code; `decodeSeed` validates the checksum; seed stored in Android Keystore (Capacitor Secure Storage).

**First testable milestone (recommended):** a minimal Capacitor LuminaBr that (a) shows the Lumina-themed start
page, (b) accepts/validates the chain seed, (c) does **file-based** sync of one record type (e.g. bookmarks/likes)
through a shared folder — proving PC⇄phone convergence. Then grow browsing + more record types + LAN.

**What Claude can deliver in-repo (verifiable here):** the shared web/TS modules (crypto+merge+document — done),
a `luminabr/` Capacitor scaffold (config + a `SyncService` wiring `syncCryptoWeb` to Capacitor Filesystem/Secure
Storage), and a step-by-step build/sign/install guide. **What needs the maintainer's machine:** running the
Android toolchain to emit and install the actual `.apk`, then the live 2-device sync test.
