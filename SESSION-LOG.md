# Lumina — Session Log

Append-only, newest entry at the top. Each entry: date, what changed, commit(s), verification, and what's next.
Read [HANDOVER.md](HANDOVER.md) first for the rules and full project state. **Update this file every session.**

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

**Commit(s):** _pending in this session_ (previous head `ae099d2`).

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
