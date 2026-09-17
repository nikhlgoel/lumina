# Lumina — Session Log

Append-only, newest entry at the top. Each entry: date, what changed, commit(s), verification, and what's next.
Read [HANDOVER.md](HANDOVER.md) first for the rules and full project state. **Update this file every session.**

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
