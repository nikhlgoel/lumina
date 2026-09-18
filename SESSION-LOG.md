# Lumina — Session Log

Append-only, newest entry at the top. Each entry: date, what changed, commit(s), verification, and what's next.
Read [HANDOVER.md](HANDOVER.md) first for the rules and full project state. **Update this file every session.**

---

## ⏸ HANDOFF (2026-09-18, after entry 12) — continuing on another account

- **Uncommitted:** ~85 files from entries 8–12. HEAD is still `65c3f55` (= `origin/main`). Ask the user before
  committing; don't push unless asked.
- **Green at handoff:** tsc clean · vitest **529 passed** · vite build ok · all 48 offscreen capture steps render.
- **Waiting on the user's choice of next step** — the five options are listed in HANDOVER **§0**.
- Start with HANDOVER §0 (current state + gotchas), then entries 12 → 8 below.

---

## 2026-09-18 (12) — Tray: mute, volume, seek, shuffle, repeat, pause/resume all downloads

**Context:** User (screenshot of the tray menu): "Add mute & other controls also here, it's required."

- Menu model is pure and tested: `src/core/trayMenu.ts` (**22 tests**, incl. a 10,000-state property test that the
  menu never contradicts the player). `tray.ts` just maps it to Electron. New: **Mute** (checkbox), **Volume**
  submenu (Louder/Quieter ±10%, presets 100/75/50/25/10 with the active one marked, title reads "Volume — muted"
  when muted), **Back/Forward 10 seconds**, **Shuffle** (checkbox), **Repeat** (Off/All/One radio), and **Pause
  all / Resume all downloads**. Pause-all pauses *waiting* jobs before running ones — otherwise each freed slot
  would just start the next download.
- The player now reports volume/mute/shuffle/repeat to main (debounced 250 ms; the tray coalesces rebuilds), so
  ticks are always true. "Like" was deliberately left out: playable items don't carry a reliable liked flag, and a
  tray tick that might be wrong is worse than none.
- **Verified through the real player** (offscreen capture step `tray-roundtrip`, sends the exact command each
  menu item carries and reads back what the tray believes): Mute on/off, 25%, Louder → 35%, Shuffle, Repeat
  one/all all round-trip correctly; Forward 10 s moved playback 10 → 21 s. The native menu itself can't be
  screenshotted — its *appearance* still needs a look from the user.
- Harness lesson (again): backslashes in capture scripts get mangled somewhere between the shell, Python and TS
  string literals. Use backslash-free patterns (`[0-9]`) in capture scripts.

**Verification:** tsc clean · vitest **529 passed** · vite build ok.

---

## 2026-09-18 (11) — Measured RAM/CPU, two optimisations, and deep property tests

**Context:** User asked whether the app is stable with everything running, what its RAM/CPU use is (it must run
on low-spec machines — optimise by better engineering, not by cutting features), and asked for deep testing,
"even 1000s of tests".

- **Measurement harness** `src/main/metrics.ts` (`LUMINA_METRICS`, dev only, hidden window). Full method,
  caveats and the baseline table are in **HANDOVER §15**. Headline, private memory on a fresh profile: ~365 MB at
  startup, ~475–530 MB after visiting every screen; idle CPU ~0–0.5% (a lower bound — hidden windows don't paint).
- **Lazy-loaded the code editor and in-app browser** — startup bundle **4,832 KB → 637 KB**, renderer at startup
  **65 → 41 MB** (stable across runs, so real).
- **Cover art served at display size** (`core/artwork.ts`): ~250 KB → ~7 KB per row cover. **GPU saving NOT
  demonstrated** — GPU memory varies ±20–40 MB between identical runs, more than the effect; claimed only as sound
  in principle until measured on a visible window.
- **Property tests** (`tests/properties.test.ts`, HANDOVER §16): 200k+ generated cases over the path guard (vs
  `node:path` oracle), MCP validator/framing, parsers and the layout state machines. They **found two real bugs**:
  Quick Open crashed on filenames containing `İ`, and mis-highlighted after emoji. Fixed; regressions kept.

**Verification:** tsc clean · vitest **507 passed** (was 466) · vite build ok · **full offscreen regression run of
all 48 capture steps**: every screen renders. Errors seen were all harness-side and were fixed or explained —
three Download steps had been silently failing since commit `c49cec6` renamed the input to "Link to download or
search" (selectors now prefix-match; re-run clean, and the steps really inspect a live link and expand a
23-part release); the commit step needs the git profile (correct "not a repository" state otherwise); one benign
"Transition was skipped" from fast navigation.

---

## 2026-09-18 (10) — Offscreen capture (no more pop-ups) and the VS Code-style IDE shell

**Context:** User said they continued on another account; checked for that work first. **Nothing had landed** —
local `main` and `origin/main` both at `65c3f55`, no stash, no other worktree, no file newer than entry (9). So
this session resumed from HANDOVER §14 in order.

**Shipped**

- **§14.0 — capture runs no longer show a window.** `LUMINA_CAPTURE` now builds the window with
  `webPreferences.offscreen: true`, and `showWindow()` is a no-op during capture (guarded centrally).
  **First attempt failed honestly:** a plain hidden window hid itself but its screenshots came back stale (hidden
  windows stop painting and stop firing rAF after the first frame). Offscreen keeps painting — verified with real
  terminal output and a full settings page captured while nothing was on screen.
- **§14.1 — the IDE shell** (`src/core/ideLayout.ts`, **34 tests**; `IdeChrome.tsx`; `IdeView` relaid out;
  `TerminalPanel` rewritten). Left sidebar (Explorer/Search) and **right sidebar** (Open Editors/Search), both
  toggleable and drag-resizable with snap-to-close; bottom panel resizable and maximizable; top-strip view
  switcher; top-right layout toggles; **split terminals side by side**. App sidebar's Collapse moved to the header.
  Layout persists in `settings.ide.layout`.

**Bugs caught before they shipped:** terminal groups keyed by content would remount on split and orphan the
xterm; the old panel re-opened an xterm on every tab switch (unsupported). Capture scripts share one page scope,
so each step's helpers now live in an IIFE (a `const` clash had silently skipped a step).

- **Terminals and Monaco now follow light/dark switches.** Both read their colours once at creation, so a
  terminal opened in dark mode stayed a black box after the app went light. They now watch `<html data-theme>`
  (which also catches the OS flipping under colour mode "system"). Verified by capture `08c-ide-theme-follow`.

**Harness notes:** layouts persist to the scratch profile, so capture steps must be idempotent (a persisted
maximized panel made two captures pixel-identical — caught by md5, not by eye). The `08a` restore-click delay
was fixed after the last run and **has not been re-run**.

**Verification:** tsc clean · vitest **466 passed** (was 384) · vite build ok · offscreen captures `08a`–`08c`, `09a`, `10a`–`10c`.

**Commit(s):** none — still uncommitted, awaiting the user's go-ahead.

- **"Freedom" — resize everything** (user: *"resizing between different windows should be there so the user can
  adjust everything to exactly as he wants"*). Shared `resizeBetween` rule (9 tests) drives draggable sashes
  between split terminals and between the new **editor groups** (`core/editorGroups.ts`, 17 tests): up to 3
  editors side by side with shared buffers and per-file unsaved state. Sash drags verified by measured widths in
  capture `09a`. `Sash` now tracks its own drag rather than trusting pointer capture (best-effort).

- **Source control** (HANDOVER §14.3.1): porcelain-v2 parser tested on *real captured* git output (21 tests);
  main-process git with no shell, `--` before paths, the workspace guard, and no push/pull/reset/delete; Source
  Control view, Monaco diff view on the live buffer, branch in the status bar. **Proven:** a commit made by
  clicking through the UI appears in `git log` (`77e0998`). Two bugs caught: a double model attach in the diff
  pane, and a template-literal regex escape in the harness that I first misread as a timing issue.

**Next (§14):** themes (§14.2), then the media-native editor (§14.4); gutter change markers and branch switching
for source control; editor-group widths should also persist.

---

## 2026-09-18 (9) — MCP settings UI, a real MCP handshake, and the integrated terminal

**Context:** User installed the **ECC plugin** (`ecc@ecc` v2.2.1 — 292 skills / 68 agents / 94 commands) and asked
me to use it, then continue. Checked it honestly against this project: its `windows-desktop-e2e` skill explicitly
excludes Electron and `mcp-server-patterns` is about *building* a server (we write a client), so the useful
surfaces here are `security-review`, `typescript-reviewer` and `react-reviewer`. Its **gateguard hook is live** and
fired on every new file and on a recursive-delete command; complied each time rather than working around it.

**Shipped**

- **MCP settings UI** — Settings › Connections › **Connected tools**. Status dot, exact command line, on/off switch
  (the only thing that starts a process), expandable list of advertised tools, add/edit sheet with a
  **"Lumina will run"** argv breakdown, and **Import JSON** for the `mcpServers` block from a README.
  New pure helpers with 12 tests: `parseCommandLine` (quote-aware, *no* shell semantics — `$VARS`, pipes and `;`
  stay literal) and `parseMcpJson` (re-validates everything, forces `enabled: false`).
- **The MCP client completed a real handshake** against a minimal stdio server (`scripts/echo-mcp-server.js`):
  `[mcp] MCP server "echo-test" ready with 2 tool(s)`. The "synthetic frames only" caveat is retired for
  initialize → notifications/initialized → tools/list. `tools/call` is still unit-tests only.
- **Integrated terminal** — the `node-pty` gate is **cleared**: `@lydell/node-pty` ships Node-API prebuilds and
  loads in Electron 44 with no rebuild (`PTY_OK exit=0 sawHello=true`, proved *before* any UI was written).
  xterm.js 6 + `src/main/ide/terminal.ts`: tabs, shell picker, `MAX_SESSIONS = 8`, clamped resize,
  `shutdownTerminals()` on quit, Ctrl+`. node-pty is `external` in the main build and `asarUnpack`ed.
  **Typing is proven here** — a command was written to the pty and its output screenshotted.

**Bugs only launching could find** (tsc, vitest and vite build were green through all of them)

- `capture.ts`'s re-applied `goto()` emitted the literal text `${JSON.stringify(label)}` into the page — a syntax
  error, so every nav click silently did nothing.
- `Dialog` **clipped its own header** whenever content exceeded the viewport: plain centring splits the overflow
  top and bottom. Now safe-centred (fixed in the shared component, so every dialog benefits). Took two attempts —
  the first tried scrolling the overlay and broke the backdrop.
- Settings `Field` is a two-column row with a `shrink-0` control, so full-width inputs collapsed.
- **The terminal rendered blank.** A shell prints its prompt milliseconds after spawn, before React has built the
  xterm, so that output was dropped. Now buffered per session and replayed on mount; `fit()` moved to the next
  frame because the host is zero-height on the frame it is attached.

**Verification:** `npx tsc --noEmit` clean · `npx vitest run` **384 passed** (was 372) · `npx vite build` ok.

**Commit(s):** none — 66 files changed/added, still uncommitted pending the user's go-ahead.

**Process failure to not repeat:** the user asked a **second** time to stop the app window popping up over what
they were watching. Every `LUMINA_CAPTURE` run shows a window. **Fix it in code before any more feature work** —
see HANDOVER §14.0: create the capture window with `show: false` + `paintWhenInitiallyHidden: true`
(`capturePage()` works hidden), and iterate UI against one long-lived `pnpm dev` instance with HMR instead of
repeated cold launches.

**Next:** HANDOVER **§14** is the agreed Phase 3 plan — windowless capture + live dev loop, then the VS Code-style
shell (activity bar, collapsible primary/secondary sidebars, bottom panel, editor **and terminal** splits with
draggable sashes), then source control, then themes incl. importing Open VSX **theme-only** extensions, then the
differentiator: a **media-native editor** (video/waveform-synced subtitle editing) and a terminal that already has
ffmpeg/yt-dlp/whisper on PATH.

---

## ✅ COMMITTED (2026-09-18) — HEAD `c49cec6`

All of sessions (1)–(6) below — Lumina Sync core, the download-speed engine work, subtitles/search/sidebar, and
the testing-feedback fixes (#6, #7, #11, #15, #30 and more) — landed in **one commit `c49cec6`** on `main`
(50 files, +3592/−68). Verified green before commit (tsc · vitest 154 · vite build · host self-test).
**Not pushed** — the user asked to commit, not push; `git push` when they say so.

---

## 2026-09-18 (8) — Remaining testing items finished, then the embedded IDE (Monaco) + MCP

**Context:** User: finish the remaining items, then start the IDE. Mid-session they interrupted because repeated
Electron capture runs kept stealing focus over a film — saved as a standing rule
[[lumina-no-foreground-app-launches]]: **never launch the app without asking; batch everything into one
backgrounded run.** Followed for the rest of the session.

**Testing items finished (all verified live with screenshots / engine logs):** #17 likes + local playlists,
#29 Files tab, #23 update check + restart, #18 on-device AI switch + model RAM/disk table, #21 BYO AI key,
#14/#19/#22 USB portable drive (a real 102-file / 801 MB export, then re-imported into an empty profile),
#10 torrent detail page (real Big Buck Bunny torrent; `select-file: 2` confirmed reaching aria2 in the log).
#20 Chrome Web Store: steps written for the user; submission is theirs.

**Honest audit of the 32:** 10 fully verified by me, 14 built + machine-checked but needing the user's live test,
3 genuinely open (#4 captcha is mitigation not a fix; #5's "reposition verify button" half is undone and I asked
what they actually saw rather than guessing; #12 is a decision not a build), #20 theirs. Every earlier-session
"done" claim was re-checked against the code — none was a phantom, but nine have only ever been read, not run.

**Embedded IDE — decision: Monaco now, `openvscode-server` later (user's call).**
- `core/ide.ts` (**51 tests**): the `isInsideWorkspace` traversal guard, language ids, tree sorting, the tab
  model, shell selection, and fuzzy ranking for quick-open.
- `main/ide/workspace.ts`: every read/write/list re-checked against the root, symlinks not followed, binaries
  refused, temp-file+rename saves with an mtime check, bounded find-in-files.
- `views/ide/`: file tree, tabs, Monaco themed from Lumina's CSS variables, Quick Open, Command Palette,
  Find in Files. New **Code** sidebar item (Ctrl+5).
- **Bug only a launch could find:** the editor mounted *blank* — `editor.api` is types/API only, with no
  contributions and no CSS. Fixed by importing `editor.main`. tsc, vitest and vite build were all green the
  whole time it was broken.
- Monaco/Vite/CSP notes: the package `exports` map breaks `esm/vs/...` paths; TS defaults moved to a language
  contribution in 0.56; Vite `?worker` emits real same-origin worker files, so the strict `script-src 'self'`
  CSP needed **no** change. `dist` ~1 MB → 15 MB (6.7 MB is the ts.worker, loaded only when a .ts/.js opens).

**MCP client (the answer to "mcps / plugins / skills / connectors"):** `core/mcp.ts` (**28 tests**) +
`main/ide/mcp.ts`. stdio + http, JSON-RPC 2.0, full handshake, `tools/call`. Nothing auto-discovers or
auto-starts; `shell: false` with an argv array and shell metacharacters refused outright; http restricted to
http/https; 30s timeouts; server output treated as data with descriptions truncated so a hostile server can't
crowd out a model's instructions; `callTool` refuses unadvertised tools; children killed on `will-quit`.
Open VSX / VS Code extensions stay out of scope until `openvscode-server` — Monaco cannot run them.

**Verification:** `tsc` clean · `vitest` **372 passed** · `vite build` ok · host self-test 14/14.
⚠ Not done: integrated terminal (needs `node-pty` — confirm it rebuilds for Electron first), git/source control,
split panes, an MCP settings UI, and wiring MCP tools into the #21 assistant. ⚠ The MCP client has **never
talked to a real server**.

**Commit(s):** _not yet committed_ — ask first (standing rule).

**Next:** MCP settings UI, terminal, git panel; then the browser workday (docs/11, docs/12).

---

## 2026-09-18 (7) — #3/#9: a pasted repack is now ONE download in the Queue and Recent

**Context:** Next of the bigger deferred findings. A multi-part repack filled the Queue with a row per volume
(the self-test's mock release = **13 rows**); the user wants one download.

**Built — renderer-only, no engine/scheduler change (so no download-path risk):**
- **`src/core/jobGroups.ts` (pure, testable).** `groupJobs` collapses jobs sharing `options.release.id` — which
  covers both the downloaded volumes *and* the `extract` job `advanceRelease` spawns, since that job inherits the
  same release tag. A release with a single job stays ungrouped; input order is preserved; standalone jobs are
  groups of one. `summarizeGroup` rolls members up into one status/progress: status by rank
  (running > processing > queued > paused > failed > cancelled > completed — so a live part outranks an earlier
  failure, and a failure surfaces once nothing is in flight); progress **byte-weighted** when every member knows
  its size, else the mean percent; a `completed` part counts as 100% even if its last tick lagged; speed = sum of
  the parts running *now* (a finished part's stale speed is excluded); ETA derived from remaining bytes.
  `groupActionTargets` maps a group action to the members it validly applies to.
- **UI `views/queue/ReleaseRow.tsx`.** One row: lead thumbnail, release title, an `N files` badge, one status line
  ("Downloading · 4 of 13 done · speed · ETA · bytes"), one progress bar, and group-level Pause / Resume /
  Retry-failed / Cancel / Show-in-folder / Remove. A chevron expands to the individual parts (compact `JobRow`s).
- **Wiring.** `selectQueueRows` / `selectRecentRows` + `parseQueueRows` in `stores/jobs.ts` encode rows as strings
  ("key»id,id") so the list selector still only re-renders on *shape* change — progress ticks keep flowing
  straight to the rows, as before. `QueueView` groups across the whole list (not per active/done section, so a
  half-finished release stays one row) and the Queue subtitle now counts rows, not parts; `RecentStrip` takes the
  newest 3 *groups*, so a repack no longer swallows the strip.

**Verification:** `tsc` clean · `vitest` **177 passed** (23 new in `tests/jobGroups.test.ts`) · `vite build` ok ·
host self-test **14/14**. **Visually verified**, not just claimed: seeded a scratch profile by running the hosts
self-test (13 real release jobs persist in its sqlite), then re-launched it under the capture harness — the Queue
shows **one** "Mock Release · 13 files" row, and expanding it lists all 13 parts. That screenshot caught two real
bugs, both fixed: a finished-but-failed group rendered a full red progress bar (now the bar shows only while
active/queued/paused, matching `JobRow`), and "Show in folder" was hidden when any part failed (now shown whenever
something landed and nothing is still running).
⚠ Still the maintainer's live test: a **real** multi-part repack from a file host — group speed/ETA look sane
while several parts run in parallel, and group Pause/Resume/Cancel behave across them.

**Commit(s):** _not yet committed_ — ask first (standing rule).

**Next:** #10 torrent detail page, #14/#19/#22 USB, #17 likes/playlists, #23 auto-update, #29 other file types.

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

**Commit(s):** `c49cec6` (with sessions 1–5; on `main`, not pushed).

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
