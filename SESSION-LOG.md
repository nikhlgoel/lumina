# Lumina — Session Log

Append-only, newest entry at the top. Each entry: date, what changed, commit(s), verification, and what's next.
Read [HANDOVER.md](HANDOVER.md) first for the rules and full project state. **Update this file every session.**

---

## ⚠ UNCOMMITTED STATE (as of 2026-09-18, HEAD `acecbc2`)

**Nothing from sessions (1)–(6) below is committed yet** — the user's standing rule is *ask before committing*
(memory `lumina-commit-permission.md`). Everything is verified green (tsc · vitest 154 · vite build · self-test) but
sits in the working tree. When the user says go, suggest either one squashed commit or grouped commits
(sync / download-engine / UI-findings). Full working tree:

- **Modified:** `HANDOVER.md`, `SESSION-LOG.md`, `src/core/url.ts`, `src/core/ytdlpArgs.ts`, `src/main/hosters.ts`,
  `src/main/ipc.ts`, `src/main/jobs/aria2.ts`, `src/main/jobs/ytdlp.ts`, `src/main/media/protocol.ts`,
  `src/renderer/src/components/QuickCheck.tsx`, `src/renderer/src/components/Shell.tsx`,
  `src/renderer/src/styles.css`, `src/renderer/src/views/download/DownloadView.tsx`,
  `src/renderer/src/views/settings/SettingsView.tsx`, `.../sections/connections.tsx`,
  `.../sections/downloading.tsx`, `src/shared/channels.ts`, `src/shared/ipc.ts`, `src/shared/settings.ts`,
  `src/shared/types.ts`, `tests/core.test.ts`.
- **New (untracked):** `docs/11_*`, `docs/12_*`, `docs/13_*`; `src/core/{base32,subtitleFiles,syncCrypto,`
  `syncCryptoWeb,syncDocument,syncEngine,syncMerge,tuning}.ts`; `src/main/firewall.ts`, `src/main/search.ts`,
  `src/main/sync/` (bookmarks, syncFile, syncManager); `src/renderer/src/views/download/{SearchResults,`
  `SearchSuggestions}.tsx` + `recentSearches.ts`; `src/renderer/src/views/settings/sections/sync.tsx`;
  `tests/{bookmarks,subtitleFiles,syncCrypto,syncCryptoWeb,syncDocument,syncEngine,syncFile,syncMerge,tuning}.test.ts`.

What each change is and why: see the dated entries below + HANDOVER §7 (32-item status) and §11 (Lumina Sync).

---

## 2026-09-18 (6) — More testing findings: Skip-All (#6), Recent-searches menu (#7), sign-in privacy message (#11), firewall re-grant (#15), expanded download logging (#30)

**Context:** Continuing the 32 testing findings. Five items completed this session.

- **#6 Skip-All.** The Quick-check dialog (file-host download pages that need a person) showed "N more waiting" but
  only let you skip the current file. Added **"Skip all (N)"**: skips the current challenge *and* every download-page
  challenge queued behind it in one click. `hosters.ts` — `waitingTurns` restructured from `(() => void)[]` to
  `{ resume, skip }[]`; new `challengeAction(id, 'skip-all')` drains the queue (each waiting page wakes and gives up
  its file) then skips the active one; ordering avoids a skipped page's cleanup resuming a page we're about to skip.
  IPC enum extended (`shared/ipc.ts`, `main/ipc.ts`); `QuickCheck.tsx` shows the button only when others wait.
- **#7 Populate search menu.** The search bar's dropdown was empty. Now it drops a **Recent searches** menu when
  focused + empty. `download/recentSearches.ts` (localStorage, guarded, max 8) + `SearchSuggestions.tsx`
  (onMouseDown so it fires before input blur); `DownloadView.tsx` records each `runSearch` and renders the menu in
  the idle phase. Clear empties it.
- **#11 Sign-in privacy message.** Sign-in already existed (YouTube/Spotify/any site). Added the missing **privacy
  panel** at the top of Settings ▸ Connections' sign-in group: the window is the real site; password/2FA go only to
  it, never to Lumina; only session cookies are kept on this computer; Lumina has no account/server; Sign-out
  deletes them. Wording kept accurate — dropped an initial "encrypted" claim because the yt-dlp `cookies.txt` is
  plaintext on disk (`sections/connections.tsx`).
- **#30 Expanded logging.** Both download engines now log a structured **download plan** at start — engine
  (yt-dlp+aria2c vs native), connections, disk-cache MB, temp strategy (same-volume vs direct-to-output),
  output dir, **free space on the destination volume** (a real cause of "stuck at N GB"), speed limit — plus a
  completion line (files/bytes). `jobs/ytdlp.ts` (+`fs.statfsSync` free-space helper), `jobs/aria2.ts`.

- **#15 Permission re-grant UI (Windows Firewall).** User clarified: it's the Windows Firewall "Allow access?"
  prompt aria2 triggers for torrent peers — deny once, no way back. New `main/firewall.ts` (Windows-only, no-op
  elsewhere): `firewallStatus()` reads rules via non-elevated `netsh show`; `grantFirewallAccess()` writes a fixed
  batch (delete inbound rules bound to the tool's exe → clears Windows' auto-block; then add a named allow rule)
  and runs it elevated in one UAC prompt (`Start-Process -Verb RunAs`, exit-code checked; refusal = friendly error).
  Generic tool list (aria2c now). IPC `firewall:status`/`firewall:grant`; UI "Network access (Windows Firewall)"
  group in Settings ▸ Connections (per-tool Allowed/Not-allowed + "Allow through firewall"); settings-search entry.
  **Security:** no user input on the command line — only the resolved, existence-checked bundled-exe path.
  ⚠ Grant needs UAC + changes the real firewall → maintainer's live test; read-only status path verified here
  (`netsh show` needs no admin, and returns no-match cleanly).

**Verification:** `tsc` clean · `vitest` **154 passed** · `vite build` ok · host self-test boots — all challenge/plan
checks PASS (the Skip-All change touches that flow; still green). No unit tests for these paths: `hosters.ts` imports
Electron and `recentSearches.ts` uses `localStorage`, neither runs in the node vitest env (honest gap).
⚠ Live test needed: a wall of file-host captchas → "Skip all" clears them; recent-searches menu appears/persists;
sign-in panel reads right; logs show the plan line under "Open logs"; **firewall grant → UAC → torrents allowed**.

**Commit(s):** _not yet committed_ — ask first.

**Next:** the bigger deferred items — #3/#9 repack-as-one grouping, #10 torrent detail page, #14/#19/#22 USB,
#17 likes/playlists, #23 auto-update, #29 other file types. Browser/IDE = the browser workday.

---

## 2026-09-18 (5) — Home search bar: theme glow + multi-source (songs vs videos) results

**Context:** User asked to (a) make the search bar the centrepiece with a slow theme-based glow, and (b) fix search
disambiguation — "animal" could be a song or a video; show both, properly separated.

**(a) Bar restyle:** taller home bar (68px) with a slow, accent-coloured **glow** drifting behind it
(`.search-glow` keyframes in `styles.css`; auto-stilled by the existing `data-motion="reduced"` rule). Idle→compact
animation kept. `DownloadView.tsx` wraps the form with the glow (idle only) and sizes the input by phase.

**(b) Multi-source search:** typing non-link text now runs a **parallel** search across:
- **Songs** — YouTube Music via the existing `services/ytmusic.searchSongs`.
- **Videos** — a flat yt-dlp `ytsearchN:` YouTube search.
`main/search.ts` `searchMulti` aggregates + dedups (a track under Songs isn't repeated under Videos), tolerant of
one source failing (`Promise.allSettled`). New IPC `search:query` → `SearchResults` (`shared/types.ts`,
`shared/ipc.ts`, `main/ipc.ts`). UI `download/SearchResults.tsx` shows two labelled sections (Songs / Videos) with
thumbnails (CSP `img-src https:` allows i.ytimg), duration, and a Get song/Get video action; clicking hands the URL
to the normal inspect→download flow, which already defaults songs→audio and videos→video. Pure helpers
`youtubeId`/`youtubeThumb` in `core/url.ts` (+ tests).

**Verification:** `tsc` clean · `vitest` **154 passed** · `vite build` ok · self-test boots (5 PASS, no errors).
⚠ Live test needed: real query returns songs+videos, thumbnails load, clicking downloads in the right format.

**Commit(s):** _not yet committed_ — ask first.

**Next:** more findings — #6 Skip-All, #7 populate search, #11 accounts privacy message, #15 permission re-grant,
#30 expanded logging.

---

## 2026-09-18 (4) — #24 web search in the download bar; verified #16/#25/#26/#28 already done; adaptive disk cache

**Context:** User: keep completing the testing findings today; ask before committing (saved as standing rule
[[lumina-commit-permission]]). Worked more findings and — importantly — **verified several against the code that
were mislabelled ⬜ but are actually already implemented** (honest cleanup, not new claims).

**Built this pass:**
- **#24 web search in the download bar.** Typing non-link text now searches YouTube instead of erroring: pure
  `toInspectTarget` (`core/url.ts`) → real link stays as-is, bare domain → `https://`, anything else →
  `ytsearchN:query`; wired in `DownloadView.tsx` (+ placeholder "…or type to search"). Test in `core.test.ts`.
  ⚠ needs live test (yt-dlp search + how results render).

**Verified already-implemented (marked ✅ in §7, corrected from ⬜):**
- **#16** transcode/remux-on-play — player streams undecodable files via `lumina-media://remux` on the element's
  `error` event (`stores/player.ts`).
- **#25** animated bigger search bar — 56px rounded bar with idle→compact animation (`DownloadView.tsx`).
- **#26** play-while-downloading — finished jobs have a Play button (`queue/JobRow.tsx`); library plays fine during
  downloads (non-modal). *Partial-file playback intentionally not shipped* (multi-connection downloads leave holes
  → unreliable).
- **#28** fullscreen overlay controls — the Dock overlays fullscreen video and auto-hides on idle (`player.css`
  `[data-idle]`).

**Tally now:** ~10 done, ~6 partial/in-progress, ~15 not started (see HANDOVER §7). Still alpha, not "100%".

**Verification:** `tsc` clean · `vitest` **153 passed** · `vite build` ok.

**Commit(s):** _not yet committed_ — **ask the user first** (standing rule).

**Next genuine gaps:** #6 Skip-All, #7 populate search, #11 accounts privacy message, #15 permission re-grant,
#30 expanded logging; larger: #17 likes/playlists, #10 torrent detail/graph, #14/#19/#22 USB, #23 auto-update.

---

## 2026-09-18 (3) — Full download-speed throttle audit + fixes

**Context:** User: continue, and check **all** causes that could throttle speed. Did a first-principles sweep of the
whole pipeline (yt-dlp + aria2 + queue + environment); full writeup in `docs/13_DOWNLOAD_SPEED_THROTTLE_AUDIT.md`.

**Fixed/tuned this pass (on top of the #1 accelerator from entry 2):**
- **Cross-drive final-copy (big one, ties to #30):** the download temp was the OS temp (usually C:), but libraries
  often sit on D:/USB → every such download did a full multi-GB **cross-drive copy at the end** (looks "stuck at
  6 GB"). Now: when temp and output are on different volumes, yt-dlp downloads **straight into the output folder**
  (same-volume rename on finish). Same-volume check via `fs.stat().dev`. `buildDownloadArgs` skips `-P temp:` when
  tempDir is empty. Files: `src/main/jobs/ytdlp.ts`, `src/core/ytdlpArgs.ts`; test added.
- **aria2 disk cache** made **machine-adaptive** (user asked to keep it universal for 1–25 Gbps setups):
  `core/tuning.diskCacheMb(totalMem)` sizes it from RAM (≈16 MB/GB, floor 64 / cap 512) for both the daemon
  (`aria2.ts`) and the yt-dlp accelerator (`ytdlpArgs.ts` via a new `diskCacheMb` arg). Tests: `tests/tuning.test.ts`.
  Clarified in doc 13 that disk-cache is a smoothing buffer, **not a rate cap**, and the real 10–25 Gbps ceilings
  are disk write speed / connection count / source server.
- Confirmed no hidden caps: `dynamicOptions` sets `max-overall-download-limit=0` unless a speed limit is set;
  `jsRuntime` (YouTube nsig) always present via Electron-as-Node.

**Doc:** `docs/13_DOWNLOAD_SPEED_THROTTLE_AUDIT.md` — every cause across yt-dlp/aria2/queue/environment with status
(fixed/tuned/environmental) and a live-verify checklist (YouTube nsig, AV, IPv6, proxy, disk, ISP baseline).

**Verification:** `tsc` clean · `vitest` **152 passed** · `vite build` ok · host self-test boots clean (aria2
daemon starts, downloads complete). ⚠ Real speed still needs the user's live test (see doc 13 checklist).

**Commit(s):** _not yet committed_.

**Next:** continue findings — #26 play-while-downloading / #16 transcode-on-play / #28 overlay controls / #30
expanded logging.

---

## 2026-09-18 (2) — Testing findings: #1 download-speed accelerator, #2 player subtitles robustness

**Context:** User: do the real testing findings first (browser/IDE later). Started with the two biggest normal-use
pain points.

**#1 — Download speed (the KB/s complaint).** Root cause: aria2 direct downloads already use 16 connections, but
**yt-dlp streams used its native single-connection HTTP downloader** for progressive links → slow. Fix: route
yt-dlp's `http/https/ftp` downloads through the **bundled aria2c** (`--downloader http:…`, `--downloader-args
aria2c:-xN -sN -k1M …`, N = Connections-per-file), while **HLS/DASH keep the native fragment path** (so YouTube etc.
and their progress reporting are untouched). New setting `downloads.accelerate` (default on) + a "Faster downloads"
toggle in Settings ▸ Downloads. Honors the speed limit via aria2's `--max-overall-download-limit`.
- Files: `src/core/ytdlpArgs.ts` (`accelerationArgs`), `src/main/jobs/ytdlp.ts` (passes bundled aria2c path +
  connections + toggle; missing tool → native fallback), `src/shared/settings.ts`, `downloading.tsx`, `SettingsView`.
- Tests: 3 new in `tests/core.test.ts` (accelerated args; off/no-aria2 → none; speed-limit passthrough).
- ⚠ **Needs the user's live test:** actual speed gain + that progress still shows for aria2-downloaded files.

**#2 — Subtitles in player.** Correction to the earlier audit: **it was already wired** (player attaches a
`<track>` → `lumina-media://subs/<id>`, CC toggle, cue styling). Real gap: the `subs` route only read
`<name>.en.srt`, so **embed-only downloads (sidecar deleted after embedding) and imported videos with embedded subs
showed nothing.** Fix: `src/core/subtitleFiles.ts` `pickSubtitleSidecar` (pure, tested — matches any English
`.srt`/`.vtt` variant, ranked, with fallback) + the `subs` route now uses it and, when no sidecar exists,
**extracts the first embedded subtitle track as WebVTT via ffmpeg**. Files: `src/main/media/protocol.ts`,
`src/core/subtitleFiles.ts`, `tests/subtitleFiles.test.ts` (6 tests). ⚠ **Needs a live check** with an embedded-subs
video.

**Verification:** `tsc` clean · `vitest` **147 passed** (was 138) · `vite build` ok · host self-test boots clean
(all early PASS checks). No commits yet (awaiting go-ahead).

**Next:** keep working the findings — candidates: #26 play-while-downloading, #16 transcode/remux-on-play (remux
path already exists), #28 fullscreen overlay controls, #3/#9 repack-as-one grouping, #30 large-file + logging.

---

## 2026-09-18 (1) — Honest 32-item status; browser+safe-browsing docs; drag-resizable sidebar

**Context:** User asked for an honest check on whether the 32 feedback items are all fixed and the app is truly
stable/100% (not just claimed). Also: prep docs for tomorrow's browser work (toolbar redesign + a deep
ad/malware/safe-browsing analysis), and make the sidebar adjustable.

**Done:**
- **Honest audit** recorded in HANDOVER §7: ~6 done, ~4 partial, ~22 not started. Core download+play engine works
  and passes the self-test, but the app is **alpha, not "all 32 fixed / 100%."** Corrected the record rather than
  reassure. Key finding: the **in-app browser has no ad/malware blocking** (only the hidden download pages do).
- **`docs/11_IN_APP_BROWSER_REDESIGN.md`** — lighter, on-brand toolbar + the missing controls (Bookmark★ [reuses
  the Sync bookmarks store], Downloads⭳ w/ badge, Extensions/Shield🧩, Menu⋮), and three "picks up links" behaviours
  (smart omnibox, grab-links-on-page, visible auto-capture). Grounded in the real `BrowserView.tsx`.
- **`docs/12_SAFE_BROWSING_AND_CONTENT_BLOCKING.md`** — deep 7-layer analysis: real filter engine
  (`@ghostery/adblocker-electron` + EasyList/EasyPrivacy/uBO) for ads/trackers/cosmetic; popup/redirect/tab-under
  policy; malware/phishing feeds (URLhaus + Google Safe Browsing v4); download safety (Mark-of-the-Web, dangerous-
  type warnings, SHA-256/URLhaus/VT reputation); permission hardening; optional DNS. Honest limits + the anti-bot
  boundary (blocking ≠ captcha evasion) called out. Phased plan for the browser workday.
- **Adjustable sidebar** (`src/renderer/src/components/Shell.tsx`): drag the right edge to resize (190–360px,
  persisted); drag below 150px snaps to the icon-only rail; double-click the edge toggles. The icon-only collapse
  already existed — this adds the drag. No transition lag during drag.

**Verification:** `tsc` clean · `vitest` **138 passed** · `vite build` ok. ⚠ Sidebar visual/interaction needs the
user's eyes (renderer DOM; can't drag headlessly). Docs are planning only — no browser code changed yet.

**Commit(s):** _not yet committed_ — awaiting go-ahead. Browser changes happen tomorrow per the user.

**Next:** browser workday — implement docs 11 + 12 (toolbar redesign, then content-blocking Layer 1/6/3 first).
Still pending: commit the Sync work (entries 4–5); live audio test; and the remaining Phase-1 items from §7.

---

## 2026-09-17 (5) — Lumina Sync desktop wiring: provider engine, bookmarks store, IPC, Settings ▸ Sync UI

**Context:** User steer — "desktop wiring first" (so there's a real sync source before building the Android
LuminaBr app). Also clarified the 2nd device is an Android phone/tablet (see entry 4 + HANDOVER §12).

**Done (§11 step 4, mostly complete):**
- **`src/core/syncEngine.ts`** (pure): `SyncProvider` interface + `collect`/`distribute`/`recordsOfType`. Tests:
  `tests/syncEngine.test.ts`.
- **Bookmarks — the first real user-data store *and* first sync provider.** There was **no** bookmarks/likes
  store before; added `src/main/sync/bookmarks.ts` — `BookmarkStore` (Electron-free, fs-backed, persists rows as
  sync records with tombstones) implementing `SyncProvider`. Tests: `tests/bookmarks.test.ts`, incl. a full
  **BookmarkStore ⇄ encrypted file ⇄ BookmarkStore** pipeline test (add propagates A→B, delete propagates back).
- **`src/main/sync/syncManager.ts`** (Electron glue): seed lifecycle via `secrets.ts` (safeStorage/DPAPI) +
  stable `device-id`; `syncNow()` = collect → `syncWithFile` → distribute; `syncStatus()`; refuses when the OS key
  store is unavailable and never overwrites an unreadable file.
- **IPC**: `sync:status|create-chain|join-chain|leave|now`, `bookmarks:list|add|remove`, event `sync:changed`,
  `initSync()` at startup (`src/main/ipc.ts`, `src/shared/ipc.ts`, `src/shared/channels.ts`). New shared types
  `Bookmark`/`SyncStatus` in `src/shared/types.ts`. New settings `sync:{folder,deviceLabel,syncBookmarks}`.
- **UI**: Settings ▸ **Sync** (`.../settings/sections/sync.tsx`, registered in `SettingsView.tsx`) — create/join
  chain, show+copy recovery code, pick sync folder, Sync-now (last-synced + count), bookmarks add/remove list.

**Verification:** `tsc` clean · `vitest` **138 passed** (was 128) · `vite build` ok · **host self-test boots clean**
(all captcha/plan/queue checks PASS; no crash from `initSync`/new IPC). ⚠ **Needs a human:** live click-through of
Settings ▸ Sync, and the real PC⇄phone round-trip (phone needs LuminaBr, §12). QR deferred until LuminaBr scanning.

**Commit(s):** _not yet committed_ — awaiting go-ahead (per §10). Suggested single commit for entries 4+5, e.g.
`feat(sync): E2E crypto (Node+Web), CRDT merge, file transport, bookmarks provider + Settings ▸ Sync`.

**Next:** LuminaBr Capacitor scaffold (§12) so the phone can join; or wire cookies/history/likes providers; or
LAN P2P (§11 step 3). Still pending: live audio test (EQ/output device); minimal browser start-page visual check.

---

## 2026-09-17 (4) — Lumina Sync: crypto core + CRDT merge + file sync + portable (Android) crypto twin

**Context:** Continuing from the Sync design (HANDOVER §11). Built the parts fully verifiable *here* without two
devices: crypto + merge foundation (step 1), encrypted file/USB transport (step 2), and — after the user said the
2nd device is an **Android** phone needing an APK "LuminaBr" — a **portable Web Crypto twin** so the phone can
join the same chain. LuminaBr plan captured in **HANDOVER §12** (recommend Capacitor; APK build/verify is the
maintainer's step since there's no Android toolchain/device here — shipping an unverified APK would break the
"no for-show / verify-before-commit" rule).

### Cross-platform crypto (for the Android 2nd device)
- **`src/core/base32.ts`** — Crockford base32 extracted (shared, single source of truth).
- **`src/core/syncCryptoWeb.ts`** — portable **Web Crypto** twin of `syncCrypto.ts` (async; runs in a browser /
  Android WebView / Capacitor / RN / Node 20+). **Byte-for-byte compatible**: same blob layout, HKDF-SHA256,
  AES-256-GCM, recovery code, chainId, HMAC pairing.
- **`tests/syncCryptoWeb.test.ts`** — self round-trips **plus PC⇄Android interop**: a blob/recovery-code/pairing
  challenge from one core is accepted by the other; both derive the same chainId + recovery code. If the two cores
  ever drift, these fail loudly.
- `syncCrypto.ts` refactored to import the shared base32 (no behaviour change; existing tests still green).

### Step 2 — encrypted file / USB / shared-folder sync
- **`src/core/syncDocument.ts`** (pure): the `{ v, records }` envelope codec — `toDocument`/`fromDocument` with
  **Zod** validation, returning a tagged result (`unsupported-version` | `malformed` | ok) so a future-version or
  corrupt document is never mistaken for an empty chain.
- **`src/main/sync/syncFile.ts`** (deliberately **Electron-free** — node builtins + core only, so the fs logic is
  unit-testable; the caller owns logging + the seed): `readSyncFile` (distinguishes `missing` from `unreadable`/
  `malformed`/`io`), `writeSyncFile` (atomic temp+rename, Windows replace fallback, `0o600`, cleans up temp on
  failure), `syncWithFile` (read → `mergeStores` → write union back; returns merged store + `wrote` +
  `localChanged`). **Safety invariant (tested): an existing file that fails to decrypt is never overwritten and
  never treated as empty.**
- **Tests:** `tests/syncDocument.test.ts`, `tests/syncFile.test.ts` (two devices merging through a real temp
  file, tombstone propagation, wrong-seed refusal leaves the file byte-for-byte intact, no leftover temp).
- Minor: `SYNC_TYPES` const added to `syncMerge.ts` as the single source of truth (reused by the Zod validator).

### Step 1 — crypto core + CRDT merge engine (recap)

**Done (new files, imported only by tests — no app wiring yet, so zero runtime/regression risk):**
- **`src/core/syncCrypto.ts`** (main-process only; `node:crypto`): E2E crypto core.
  - 256-bit seed → grouped Crockford-base32 **recovery code** with a checksum (`generateSeed`, `encodeSeed`,
    `decodeSeed`, `isValidSeed`); decode tolerates spaces/case/O·I·L look-alikes and rejects checksum typos.
  - **HKDF-SHA256** per-purpose keys; **AES-256-GCM** authenticated `encrypt`/`decrypt` (+ `encryptJson`/
    `decryptJson`) with optional **AAD** binding. Wrong seed / tamper / wrong AAD / truncation → `null`, never throw.
  - `chainId` (public, non-secret peer-grouping id) and `authResponse`/`authVerify` (constant-time HMAC
    challenge-response) for the future LAN pairing handshake.
- **`src/core/syncMerge.ts`** (pure, no I/O): the CRDT-ish merge engine. `SyncRecord`, deterministic LWW
  `mergeRecord` (updatedAt → deviceId → tombstone), immutable `upsert`/`mergeStores`/`mergeAll`
  (commutative + associative + idempotent), tombstones + `liveRecords`, delta sync (`highWater`/`changesSince`),
  `pruneTombstones`, `toArray`/`fromArray`.
- **Tests:** `tests/syncCrypto.test.ts` + `tests/syncMerge.test.ts` (convergence-law and tamper-rejection
  properties).

**Verification (all of the above):** `tsc` clean · `vitest` **128 passed** (was 63; stable across 5 full runs) ·
`vite build` ok. All new files are imported only by tests / not wired into main·renderer runtime yet → **zero
regression risk**.

**Commit(s):** _not yet committed_ — awaiting the user's go-ahead (per HANDOVER §10, commit only when asked).
Suggested: one commit, e.g. `feat(sync): E2E crypto (Node + portable Web Crypto), CRDT merge, encrypted file transport`.

**Next (needs a decision):** LuminaBr Android companion — recommend scaffolding a **Capacitor** app (`luminabr/`)
that reuses the portable core (`syncCryptoWeb` + `syncMerge` + `syncDocument`) with file-based sync first; the
`.apk` build/sign/install + live 2-device test is the maintainer's step (no Android toolchain here). Then §11
step 3 (LAN P2P) and step 4 (record providers + Settings UI + seed-at-rest). Still pending from before: live audio
test of the EQ/output-device feature; the minimal browser start page visual check.

---

## 2026-09-17 (3) — Minimal browser start page; Lumina Sync design

**Context:** User: the in-app browser's landing page looked crowded (that clutter was DuckDuckGo's *own* homepage menu).
Wants it minimal — search/functions only. Also asked to add a Brave-Sync-like local (no-cloud) device "chain" that
keeps history/logins/cookies/bookmarks synced across devices.

**Done:**
- **Minimal browser start page** (`src/main/browser.ts`): replaced the DuckDuckGo homepage as `HOME` with a clean,
  self-contained data-URL start page (Lumina wordmark + a single search box → DuckDuckGo results). The address bar
  shows blank on the start page (data: URLs are hidden in `emitState`), like a real new-tab page. Search/typing in the
  address bar unchanged. Verified: `tsc` clean · `vite build` ok. (Native browser view isn't captured by the
  screenshot harness → the user confirms visually.)
- **Lumina Sync — full design** written to HANDOVER §11 (no code yet). Recommendation: hybrid LAN-P2P + encrypted
  USB/shared-file sync, E2E-encrypted with a BIP39 seed ("chain"), LWW/CRDT merge with tombstones. It's Phase-2 and
  security-sensitive (moves cookies/logins) and needs 2 devices to verify, so **not implemented this session**.
  Recommended first step: build the pure, unit-testable **crypto core + merge logic** in `src/core/*`.

**Verification:** `tsc` clean · `vitest` 63 passed · `vite build` ok.

**Commit(s):** `e462709` (pushed to `main`).

**Next:** await the user's steer on Sync (start with the testable crypto+merge core?); otherwise continue #1 speed +
#30 logging. Still pending from before: live audio test of the EQ/output-device feature.

---

## 2026-09-17 (2) — Audio output switching + equalizer + tray quick-controls (idea B)

**Context:** User asked to add audio **output-device switching** (for people with multiple outputs), **tray menu
controls** to change it quickly, and a **quick equalizer profile change** from the tray. This lands idea B (EQ) and
replaces idea C (driver auto-updater) with output-device switching, per the user.

**Done:**
- **Equalizer engine** (`src/renderer/src/lib/audio.ts`): lazy Web Audio graph (`AudioContext` + 5 `BiquadFilter`
  peaking bands) over the single `media` element. Off by default → normal playback path is untouched until opt-in.
- **Profiles** (`src/core/equalizer.ts`): Flat, Bass boost, Vocal, Treble, Warm, Loudness (+ Custom 5-band), each with
  a description. Pure helpers (`gainsFor`/`normalizeBands`/`profileById`) + unit tests (`tests/equalizer.test.ts`).
- **Output-device switching:** `setSinkId` on the media element; renderer enumerates outputs and reports them to main
  (`audio:report-devices` IPC) for the tray.
- **System-tray quick-controls** (`src/main/tray.ts`): "Audio output" and "Equalizer" submenus (radio items). Tray
  writes `settings.player.*` → `settings:changed` → the renderer audio engine applies. Tray rebuilds on settings
  change to keep the radio marks correct.
- **In-app UI:** a Sound popover in the player Dock (`views/player/AudioPanel.tsx`) — output-device select, EQ on/off,
  profile chips, and Custom band sliders.
- **Settings:** `player.outputDeviceId`, `player.eqEnabled`, `player.eqProfile`, `player.eqBands`.
- **CORS fix:** added `Access-Control-Allow-Origin: *` to the `lumina-media://` file + remux responses so
  `createMediaElementSource` doesn't mute a "cross-origin" tap (`src/main/media/protocol.ts`).

**Verification:** `tsc` clean · `vitest` 63 passed · `vite build` ok · host self-test boots clean (captcha/detection/
plan/queue checks PASS; no crash from tray/IPC/protocol changes). **⚠ Needs the user's live audio test:** the actual
sound of the EQ and the output-device switch can't be verified in the headless harness.

**Commit(s):** `fc6a280` (pushed to `main`).

**Next:** live-verify audio with the user; then #1 speed + #30 logging.

---

## 2026-09-17 — Queue clarity (#31), library view modes (#32), handover docs

**Context:** Continuing the 30-item testing-feedback fixes (Phase 1 stability). User added two items (#31 queue
concurrency/auto-resume, #32 library view modes) and asked for handover docs + captured two new voice-note ideas
(offline music platform; EQ + audio-driver auto-update).

**Done:**
- **#32 — Library view modes.** Added persisted view modes: Music = *Details* / *Compact*; Videos = *Grid* / *List*.
  New settings `library.musicView` / `library.videoView` (`src/shared/settings.ts`); a `ViewToggle` icon control +
  compact music rows and a virtualized video list in `src/renderer/src/views/library/LibraryView.tsx`.
- **#31 — Queue concurrency clarity.** The main-process scheduler (`src/main/jobs/queue.ts`) **already** limits to
  `downloads.concurrency` and auto-starts the next `queued` job when a slot frees — so "extra downloads auto-pause and
  auto-resume" already works; the gap was that it was unclear (users manually paused). Made it obvious:
  - `queued` now labelled **"Queued"** (was "Waiting"); shows **"Up next — starts automatically"** or
    **"Queued · N in line — starts automatically"**; queued progress bar no longer shows a misleading spinner.
    (`src/renderer/src/views/queue/JobRow.tsx`)
  - Added a clarifying description to the "Downloads at the same time" setting.
  - New pure helper `queuePosition()` in `src/core/jobOrder.ts` (re-exported from the jobs store) + unit tests
    (`tests/jobOrder.test.ts`, +4 tests).
  - **Note:** did NOT auto-resume *user-initiated* pauses (that would violate explicit intent). The user's described
    scenario (concurrency=2, add 3 → 1 waits & auto-starts) is exactly the `queued` behavior, now clearly surfaced.
- **Docs:** created `HANDOVER.md` and this `SESSION-LOG.md`.

**Ideas recorded (full detail + recommendation in HANDOVER §8):** (A) offline music platform — recommend YES, after
stability; (B) in-app equalizer + audio profiles — recommend YES (Web Audio, no drivers, put it in the player);
(C) audio-driver auto-updater — recommend NO (unsafe/infeasible; achieve the quality win via B instead).

**Verification:** `npx tsc --noEmit` clean · `npx vitest run` 58 passed · `npx vite build` succeeded.

**Commit(s):** `f8a008e` (pushed to `main`; previous head `ae099d2`).

**Next:** #1 download speed (route eligible yt-dlp through aria2 / tune fragments — needs a **public** test file) and
#30 expanded logging + large-file tuning; then #2 subtitles + #28 video overlay controls; then the bigger #3/#9
repack-as-one-download grouping.

---

## Baseline before this log (recent commits)

- `ae099d2` fix(ui): long-title overflow in player (#27), toast position top-right (#6), repack-size audit (#8 — no cap)
- `c1a16a4` feat(browser): in-app browser foundation — real Chromium view the user drives (legit captcha path)
- `f291347` feat(extension): "Send all download links on this page to Lumina"
- `147ad02` feat(hosters): block ad/pop-up/redirect networks; reload checks in a visible window (#5 partial)
- `cab6cfd` fix(aria2): supervise the engine — recover from crash/hang instead of stalling forever (root cause of #30)
- `ad9f2a1` fix(cookies): stop retrying an unreadable browser cookie store every download
- `0bfdaa2` chore(release): release CI workflow + honest publishing guide (winget/Homebrew, no MS Store)
- `2e2af83` feat(about): in-app searchable list of supported sites (honest ~1,300+ sites / 1,700+ extractors)
