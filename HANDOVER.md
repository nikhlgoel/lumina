# Lumina — Handover / Continue-Here Doc

**Read this first if you are a fresh assistant (or a new account) picking up this project.**
Then read [SESSION-LOG.md](SESSION-LOG.md) for the running chronological log of what was done and what's next.
Keep **both** files updated as you work — that is how the next session continues seamlessly.

---

## 0. CURRENT STATE — read this first (updated 2026-09-18, end of session 12)

**⚠ NOTHING SINCE `65c3f55` IS COMMITTED.** ~85 files changed/added across sessions 8–12 live only in the working
tree. The user has been offered a commit and has not said yes yet — **ask before committing or pushing** (standing
rule). If they agree: commit, don't push unless asked.

**Verified state right now:** `npx tsc --noEmit` clean · `npx vitest run` **529 passed (30 files)** · `npx vite build`
ok · full offscreen regression run of all 48 capture steps: every screen renders.

**Built in sessions 8–12 (details in SESSION-LOG entries 8–12 and the sections referenced):**
- Embedded IDE: Monaco editor, file tree, tabs, Quick Open / Command Palette / Find in Files (§13).
- MCP client + Settings › Connected tools UI; real handshake proven against a test server (§13).
- Integrated terminal (node-pty + xterm), split terminals (§13, §14.1).
- VS Code-style shell: both sidebars, bottom panel, **every divider draggable** ("Freedom" — the user's stated
  design principle), editor groups side by side (§14.1).
- Source control: status, stage/unstage/discard, commit, diff view — a real commit proven (§14.3.1).
- Offscreen capture so testing never pops a window (§14.0); RAM/CPU measurement harness + two optimisations (§15).
- Deep property tests (§16) — they found and fixed two real Quick Open bugs.
- Tray: mute, volume, seek ±10 s, shuffle, repeat, pause/resume all downloads (SESSION-LOG 12).

**Status of the §14 IDE plan:** ✅ 14.0 · ✅ 14.1 (mostly) · ✅ 14.3.1 source control · ❌ 14.2 themes /
downloadable theme extensions · ❌ 14.3.2–7 (Problems panel, full status bar, Explorer context menus/drag-drop/
file watcher, breadcrumbs/outline, editor settings & keybindings) · ❌ 14.4 media-native editor + bundled tools on
the terminal PATH.

**Still needs the USER's live test:** #1 download speed, #2 embedded subtitles, #15 firewall UAC, #21 real AI key,
#24 real search, and the tray menu's *appearance* (its behaviour is verified). **Never proven:** typing into Monaco;
MCP `tools/call` live; MCP tools wired into the AI assistant (not built). **Owed by the user:** an answer on #5
(verify-button position); #20 Chrome Web Store submission is theirs.

**The user was offered these next steps and hasn't picked yet:** (1) commit; (2) finish the IDE plan — themes, then
the §14.3 basics; (3) the §14.4 media editor differentiator; (4) stabilise for release — their live test pass, a
long leak/soak test; (5) start the list of new ideas they said they have. **Ask which, don't assume.**

**Gotchas that cost time this week — don't relearn them:**
- **Never show the app window.** Screenshot runs: `env -u ELECTRON_RUN_AS_NODE LUMINA_CAPTURE=<dir>
  LUMINA_CAPTURE_ONLY=<regex> npx electron . --user-data-dir=<scratch>` — renders **offscreen**, nothing appears.
  A plain hidden window is NOT enough (it stops painting; screenshots go stale). Metrics: `LUMINA_METRICS` (§15).
- `ELECTRON_RUN_AS_NODE=1` leaks into this shell from the host app → Electron starts as plain Node
  ("does not provide an export named BrowserWindow"). Always `env -u ELECTRON_RUN_AS_NODE`.
- Capture scripts are JS inside TS strings/template literals: **avoid backslashes** (`\d` silently became `d`
  twice, and escaping got mangled between shell, Python and TS). Use `[0-9]`. Scripts share one page scope — wrap
  each step's helpers in an IIFE. Make steps idempotent: layout persists in the scratch profile.
- The **ECC plugin's gateguard hook** blocks the *first* write of every new file until you state importers/callers,
  affected API, data schemas and the user's verbatim instruction — state them, then retry the identical write.
- Don't add a static import of `views/ide` or `views/browser` anywhere — it pulls Monaco back into startup (§15).
- "Green checks are not proof" — tsc/vitest/build all passed while the editor rendered nothing. See UI running
  (offscreen capture) before calling it done.

---

## 1. What Lumina is

A free, open-source **universal download assistant + offline media player** — "download anything from the web,
play it beautifully offline." Not a piracy tool; a general downloader (the same class as IDM / JDownloader / yt-dlp
front-ends) plus a VLC-class local player with a music-library experience.

- **Repo:** `https://github.com/nikhlgoel/lumina.git` (owner `nikhlgoel`, `white.dev.sc@gmail.com`)
- **Working dir:** `D:\main\projects\temp\lumina-media`
- **Version:** `3.0.0-alpha.0` (semver; alpha.0 = first alpha, feature-incomplete, expect bugs)
- **Stack:** Electron 44 · Vite 8 · React 19 · Tailwind 4 · Zustand · Zod · `node:sqlite` (built in) · Monaco · xterm.js · `@lydell/node-pty`
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
- An embedded IDE. **Decision (2026-09-18, user's call): Monaco now, `openvscode-server` later.** Monaco is the
  editor core VS Code itself uses, so the editing experience is the real thing without bundling a 150–250 MB
  Code-OSS server, and every part is verifiable here. `openvscode-server` + **Open VSX** stays the documented
  upgrade path once Lumina is stable — the shell, workspace layer and terminal are reused, nothing is built twice.
  Progress is tracked in §13. Precedent: Cursor/Windsurf = VSCode fork + AI.
- AI chat as a **separate Lumina extension**: plan / edit / execute modes; OAuth providers (Claude, Gemini, OpenRouter)
  or a local model; toggle models off to save RAM.

**Later ideas captured (see §8 for detail + my recommendation):** offline music-platform experience (likes / albums /
local playlists / hybrid stream-if-not-downloaded); in-app **equalizer + audio profiles** (DONE); (declined) audio-
driver auto-updater; USB portable player + import/export/sync; Chrome Web Store listing for the extension;
**Lumina Sync** — Brave-Sync-like local device "chain" with no third-party cloud (full design in §11).

## 5. Verification suite (run from repo root)

```bash
npx tsc --noEmit                 # types — must be clean
npx vitest run                   # unit + property tests (currently 529 passing, 30 files)
npx vite build                   # production build must succeed
```

Host end-to-end smoke (Electron; needs its own user-data-dir because a single-instance lock is held by the user's app):
```bash
env -u ELECTRON_RUN_AS_NODE LUMINA_SELFTEST=1 LUMINA_SELFTEST_HOSTS=1 \
  LUMINA_SELFTEST_LOG=<logfile> ./node_modules/.bin/electron . --user-data-dir=<scratch>
# expect 14/14 checks
```

Screenshot capture harness (dev only) for visual review — renders OFFSCREEN, no window ever appears:
```bash
env -u ELECTRON_RUN_AS_NODE LUMINA_CAPTURE=<dir> LUMINA_CAPTURE_ONLY=<name-regex>   ./node_modules/.bin/electron . --user-data-dir=<scratch>
# steps live in src/main/capture.ts; 'tray-roundtrip' drives the tray commands through the real player.
# The 10a–10c source-control steps need a profile whose ide.lastFolder is a git repository.
```

Resource measurement (dev only, hidden window — memory realistic, CPU a lower bound; see §15):
```bash
env -u ELECTRON_RUN_AS_NODE LUMINA_METRICS=<out.jsonl> ./node_modules/.bin/electron . --user-data-dir=<fresh scratch>
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
| 3 | Group repacks as ONE download in Recent/Queue (not per-part) | ✅ **done** — a pasted release (its split-archive parts **and** the unpack job it spawns) now renders as **one row** in both the Queue and the Recent strip, with one byte-weighted progress bar, one combined speed/ETA, an `N files` badge, and group-level Pause/Resume/Retry/Cancel; a chevron expands to the individual parts. Pure rollup in `src/core/jobGroups.ts` (`groupJobs`/`summarizeGroup`/`groupActionTargets`, 23 tests); UI `views/queue/ReleaseRow.tsx` + `selectQueueRows`/`selectRecentRows` in `stores/jobs.ts`. **Renderer-only — no engine/scheduler change.** Verified visually: the host self-test's 13-job mock release collapses to one row (screenshot). |
| 4 | Captcha verification failing | 🟡 addressed via extension + in-app browser + visible-window reload |
| 5 | Block ads/redirects + reposition verify button | 🟡 ad/pop/redirect blocking shipped (147ad02); button reposition ⬜ |
| 6 | Skip-All + notifications to top-right (not bottom) | ✅ **done** — toasts top-right (ae099d2); **Skip-all now added** to the Quick-check dialog: when others are queued it shows "Skip all (N)" which skips the current file *and* every download-page challenge waiting behind it in one click (`hosters.ts` `challengeAction('skip-all')` drains `waitingTurns` then skips the active one; IPC enum + `QuickCheck.tsx` button). Self-test challenge flow still green. |
| 7 | Populate search menu | ✅ **done** — the search bar now drops a **Recent searches** menu when it's focused and empty (was a blank box). Persisted per-viewer in localStorage (guarded), click re-runs the search, Clear empties it (`download/recentSearches.ts` + `SearchSuggestions.tsx`, wired in `DownloadView.tsx`; recorded on each `runSearch`). |
| 8 | "500 MB repack limit" | ✅ audited — no cap exists (ae099d2) |
| 9 | Repack grouping in Queue (see #3) | ✅ **done** — same change as #3 (the Queue is where it lands). |
| 10 | Torrent file-selection + detail page + custom graph + "disk cache flush failure" fix | ⬜ |
| 11 | Test-accounts sign-in + privacy message | ✅ **done** — sign-in already existed (YouTube/Spotify/any site, in Settings ▸ Connections). This session added the missing **privacy message**: a clear panel at the top of the sign-in group stating the window is the real site, password/2FA go only to it (never to Lumina), only the session cookies are kept on this computer, Lumina has no account/server to send them to, and Sign-out deletes them (`sections/connections.tsx`). Wording kept accurate — no "encrypted" overclaim for the yt-dlp cookies.txt. |
| 12 | Bug-report destination / admin panel | 🟡 decided: GitHub Issues now, issue-backed admin later |
| 13 | Proper semver / what alpha.0 means | ✅ documented (here + PUBLISHING.md) |
| 14 | Portable USB media player | ✅ **done — verified live (PC → drive → a different PC).** New Settings ▸ **Portable drive**. **Detection (#19):** removable volumes polled every 5s — Windows via a read-only `Get-CimInstance Win32_LogicalDisk -Filter DriveType=2`, Linux `/media`+`/run/media`, macOS `/Volumes` (boot volume excluded); live `usb:drives-changed` event, label + free/total + a used bar. **Structure (#22):** `LuminaMedia/{Music,Videos,Playlists,Files}` + a README, exactly as `docs/05` specifies — music filed `Artist/Album/NN Title`, video flat, plus `All music.m3u8` / `All videos.m3u8` with relative `..\` paths and CRLF. **Portable player (#14):** the drive is deliberately *plain files in plain folders*, so it plays in a car stereo, TV or phone with no Lumina on the other end; Lumina can also import the folder back into a library on another PC. (A bootable Lumina.exe on the stick is **not** shipped — it can't be packaged or verified here.) **Export/import:** incremental (name+size, so a repeat run copies only what changed), each file written `.lumina-part` then renamed so an unplugged drive can't leave a half-file posing as whole, live progress + Stop, one transfer at a time. Also `storage.usbRouting`: finished downloads are copied to the drive **after** they complete — never during, because a stick can't keep up with a multi-connection download (docs/05 §4). All naming/collision/plan logic is pure in `src/core/portable.ts` (21 tests: FAT32-illegal characters, reserved device names, trailing dots, length caps, collision suffixes, skip-if-same-size). **Verified:** a real **102-file / 801 MB** export onto a test drive produced the correct tree and playlists with **zero** leftover `.lumina-part` files, then importing that drive into a **fresh empty profile** restored all 102 songs and indexed them. The real `DriveType=2` query was run on this machine (returns empty with nothing plugged in, which is handled). ⚠ **Needs the user's live test with actual hardware** — a real stick, and unplugging mid-copy. Dev-only `LUMINA_USB_FAKE=<folder>` seam makes a folder act as a drive; ignored in packaged builds. |
| 15 | Permission re-grant UI (Windows Firewall network access) | ✅ **built — needs live test.** Clarified by the user: it's the **Windows Firewall** "Allow access?" prompt aria2 triggers for torrent peers — deny it once and there's no way back. New `src/main/firewall.ts` (Windows-only, no-op elsewhere): `firewallStatus()` reads rules with non-elevated `netsh show`; `grantFirewallAccess()` writes a fixed batch (clears inbound rules bound to the tool's exe — removing Windows' auto-block — then adds a named allow rule) and runs it **elevated via one UAC prompt** (`Start-Process -Verb RunAs`). Generic tool list (aria2c now; extensible). IPC `firewall:status`/`firewall:grant`; UI = a "Network access (Windows Firewall)" group in Settings ▸ Connections with per-tool Allowed/Not-allowed badges + an "Allow through firewall" button; settings-search entry added. **No user input reaches the command line** (only our resolved, verified bundled-exe path). ⚠ The actual grant modifies the real firewall + needs UAC, so it **can't be verified headlessly** — the read-only status path was confirmed (`netsh show` needs no admin); the live grant + torrent-peer improvement is the maintainer's test. |
| 16 | Player format support (transcode/remux on play via bundled ffmpeg) | ✅ **already built** — the player streams undecodable files through ffmpeg on the fly (`lumina-media://remux/<id>`, seek re-streams at an offset) via the media element's `error` handler (`stores/player.ts`). |
| 17 | Like/rate + local playlists | ✅ **done — verified live** — the offline collection. **Likes:** new `likes` table keyed by *path* (survives rescans), a heart on every song row, a **Liked songs** list (newest first) and a `liked` count in stats; every item read carries its `liked` flag via one LEFT JOIN. **Playlists made here:** reuse the existing `playlists` table with `source='user'` (the scanner already refuses to delete those), create / rename / delete / add / remove / reorder, plus an **Add to playlist** dialog on each song. Pure list maths in `src/core/collection.ts` (18 tests); UI `views/library/Collection.tsx`; IPC `library:like` + `library:playlist-*`. Verified with screenshots in a scratch profile: like → Liked songs → create playlist → playlist detail. |
| 18 | Toggle AI models off for RAM | ✅ **done — verified live** — Settings ▸ Subtitles now has an **On-device AI** master switch: off means no speech model is ever loaded (no RAM, no GPU) and the “Generate English subtitles” buttons disappear from the Library; site subtitles still work. `whisperModelPath()` refuses via `assertLocalAiEnabled()`, so the setting is enforced in main, not just hidden in the UI. Also a **Models on this PC** table with each model's real on-disk size, its memory cost while running, and **Remove** for a downloaded model (bundled Base is marked Included and can't be removed; removing the selected model falls back to Base). Honest framing: whisper only uses memory *during* a subtitle job — nothing was ever resident. |
| 19 | USB detect + import/export/sync | ✅ **done** — same feature as #14; see that row. |
| 20 | Chrome Web Store extension listing | 🟡 **steps written, submission is the maintainer's.** The extension is MV3 and ready to zip (`extension/`, manifest + icons already correct). The blocker is review, not packaging: it requests `<all_urls>` + `webRequest` + `cookies` + `tabs` + `scripting`, which triggers manual review. Needed before submitting: $5 developer fee, a publicly hosted privacy policy (mandatory because of `cookies`), per-permission justifications, the data-use disclosure (declare *authentication information*), one 1280×800 screenshot, and a version bump off `1.0.0`. Recommend **Unlisted** for the first submission. Full steps were given in chat on 2026-09-18. |
| 21 | User AI API keys for lyrics | ✅ **done — built and unit-tested; the live call needs the user's own key.** New Settings ▸ **AI key**: pick a provider (OpenAI / Anthropic / Gemini / OpenRouter), optional model, paste a key, **Test**, **Remove**, **Get a key**. The key is stored via `secrets.ts` (safeStorage/DPAPI) — never in settings.json, never sent to the renderer (which only learns `hasKey` + the last 4 chars), never logged. Provider shapes/parsing are pure in `src/core/aiProviders.ts` (15 tests incl. junk responses); the call lives in `src/main/ai.ts`. Wired as an **opt-in last-resort lyrics fallback** (`lyrics.aiFallback`, default off) that runs only after the real sources fail. ⚠ **Deliberate honesty caveat:** a language model recalls lyrics imperfectly and is reproducing copyrighted text, so results are stored as `source:'ai'` and the player shows an “AI, unverified — these may be wrong” badge, and the setting says so. **Not verified live** — doing so needs a real paid key; the key-storage, validation, settings and UI paths were verified, the provider round-trip was not. |
| 22 | USB structure | ✅ **done** — same feature as #14; see that row. |
| 23 | Auto-update on launch + restart button | ✅ **done — verified live, with an honest boundary.** Lumina now checks GitHub Releases ~8s after launch (throttled to 6h, toggleable), announces a newer version with a toast, and the About page has an **Updates card**: current version, Check now, What's new (release notes), **Get it** (opens the release page in the real browser), **Skip this one**, prerelease toggle, and a **Restart Lumina** button (`app.relaunch()`, with a confirm step). Semver incl. prerelease ordering + release picking is pure in `src/core/version.ts` (16 tests, covers junk/rate-limited responses). **NOT built: in-place self-install** — that needs a signed published update feed (electron-updater), which can't exist or be verified before the first real release; the UI says so plainly rather than pretending. Verified both paths: real API (no releases yet → “up to date”) and a local fake feed (→ toast + card + notes). Dev-only `LUMINA_UPDATE_FEED` override, ignored in packaged builds. |
| 24 | Web search in search bar | ✅ **done — multi-source** — typing non-link text searches **YouTube Music (Songs)** + **YouTube (Videos)** in parallel and shows them as separate labelled sections (`main/search.ts` `searchMulti` reusing `services/ytmusic.searchSongs` + a flat yt-dlp video search; IPC `search:query`; UI `download/SearchResults.tsx`). Clicking a hit reuses the inspect→download flow (songs→audio, videos→video defaults). Bare domains → https; real links unchanged. **Needs live test** (real search + thumbnails). |
| 25 | Animated bigger search bar | ✅ **done** — the home bar is now the centrepiece: taller (68px), with a slow, **theme-accent glow** that drifts behind it (`.search-glow` in `styles.css`, auto-stilled by `data-motion="reduced"`); keeps the idle→compact animation. |
| 26 | Play-while-downloading | ✅ **covered for the reliable cases** — finished jobs have a Play button (`queue/JobRow.tsx`), and library playback runs fine during downloads (app is non-modal). *Partial-file playback of an in-progress download is intentionally NOT shipped:* multi-connection/segmented downloads leave holes until complete, so it'd be flaky. |
| 27 | UI placement shift with long title | ✅ player Dock fix (ae099d2) |
| 28 | Video fullscreen overlay controls | ✅ **already built** — the full control Dock (seek/play/subs/volume) overlays fullscreen video and auto-hides on idle (`data-idle` + wake on pointer move; cursor hidden). `PlayerView.tsx` + `player.css`. |
| 29 | Library docs / other file types | ✅ **done — verified live** — non-media downloads (documents, archives, installers, images, e-books, subtitles, text/data) were invisible once finished; the Library now has a **Files** tab that lists them grouped by kind with size, age and folder, and Open / Show-in-folder. Read from the downloads folder on demand (depth-limited, capped at 2000) rather than indexed, so it can't go stale. `src/core/fileKind.ts` classifies + hides `.aria2`/`.part` scratch files and later split-archive volumes (11 tests); `views/library/FilesTab.tsx`; IPC `library:files`. |
| 30 | Stuck at 6 GB + large-file optimization + expanded logging | ✅ **done** — aria2 stall root-cause fixed (cab6cfd); **cross-drive final-copy fixed** (volume-aware temp — likely the "stuck at 6 GB") + disk-cache bumps (see #1 / doc 13); aria2 already fails fast on a full disk. **Expanded logging added:** both engines now log a structured *download plan* at start (engine, connections, disk-cache MB, temp strategy, output dir, **free space on the destination volume**, speed limit) and a completion line (files/bytes) — so a stuck/slow download is diagnosable from `Open logs` alone (`jobs/ytdlp.ts`, `jobs/aria2.ts`). |
| 31 | Queue concurrency: extras auto-queue & auto-start when a slot frees; clearer than manual pause | ✅ scheduler already auto-manages; clarity/labels + tests added |
| 32 | Library view modes (compact list / grid / list) | ✅ music details/compact + video grid/list |

**Honest tally (updated 2026-09-18, do not overstate):** of the 32, **25 done** (#3, #6, #7, #8, #9, #11, #13, #14,
#15, #16, #17, #18, #19, #21, #22, #23, #24, #25, #26, #27, #28, #29, #30, #31, #32), **5 in progress/partial**
(#1 & #2 built-but-need-live-test, #4, #5, #12), and **2 not started** (#10, #20). Several "done" ones were
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

## 13. Embedded IDE (Phase 2, in progress)

**Approach:** Monaco now, `openvscode-server` later (see §4). Monaco 0.56 is a direct dependency.

**Done and verified (tsc · vitest · vite build):**
- **`src/core/ide.ts`** — pure core, **40 tests** in `tests/ide.test.ts`: path normalisation; `isInsideWorkspace`
  (the traversal guard — tested against `../`, prefix-sharing siblings like `proj-evil`, POSIX case sensitivity,
  empty input); language ids incl. extension-less files (Dockerfile/Makefile); tree sorting (dirs first, natural
  order, dotfiles not hoisted); the tab model (preview tabs replace, dirty never previews, focus moves right then
  left on close); and shell selection.
- **`src/main/ide/workspace.ts`** — all fs access confined to one opened folder. **Every** read/write/list resolves
  then re-checks with `isInsideWorkspace`, symlinks are listed but never followed, binaries are refused by a NUL
  sniff, saves are temp-file+rename and take an `mtimeMs` so a file changed on disk isn't clobbered. Plus
  create/rename and a bounded find-in-files.
- **IPC** `ide:open|close|info|list|read|write|create|rename|search`; settings `ide.{lastFolder,recentFolders,shell,
  fontSize,wordWrap,minimap,tabSize}`; workspace restored at startup.
- **UI** `views/ide/{IdeView,monaco}.tsx` — lazy folder tree, tab strip with dirty dots, Monaco with a theme built
  from Lumina's own CSS variables, Ctrl/Cmd+S, live settings. New **Code** item in the sidebar (Ctrl+5).
- **Monaco/Vite/CSP settled:** imports must be `monaco-editor/editor/...` (the package's `exports` map rewrites
  `esm/vs/...` into a doubled path), TS defaults moved to the language contribution in 0.56 (typed locally in
  `monaco-contrib.d.ts`), and Vite `?worker` emits **real same-origin worker files** — so the existing
  `script-src 'self'` CSP works unchanged, with no `blob:` exemption.
- **Size:** `dist` goes ~1 MB → **14 MB**. The 6.7 MB `ts.worker` is a separate chunk fetched only when a .ts/.js
  file is opened, so app start is unaffected; it buys in-file autocomplete/hover. Semantic validation is off
  (no `node_modules` in the browser, so "cannot find module" would be wrong more often than right).

**Added since (2026-09-18, later in the same session):**
- **Blank-editor bug found and fixed by actually launching it.** `monaco-editor/editor/editor.api` is the
  *types and API only* — no contributions, no stylesheet — so the editor mounted and rendered nothing. The real
  entry is `editor.main`, which pulls in the widgets, commands, Monarch tokenizers and CSS (the bundled stylesheet
  jumped to ~237 KB, which is how the fix was confirmed). `editor.main` ships no `.d.ts`, so it borrows
  `editor.api`'s in `monaco-contrib.d.ts`. **This is exactly the class of bug that tsc, vitest and vite build all
  pass cleanly — only running it caught it.**
- **Quick Open (Ctrl+P)**, **Command Palette (Ctrl+Shift+P)** and **Find in Files (Ctrl+Shift+F)** in
  `views/ide/Palette.tsx`, sharing one keyboard-driven overlay. Ranking is the pure `fuzzyMatch`/`fuzzyRank` in
  `core/ide.ts` (11 more tests: consecutive runs and post-separator hits outrank scattered ones). 13 commands
  registered, several delegating to Monaco's own actions (find, format, comment, go-to-line).
- **Find-in-files backend** `searchInFiles` + `allFiles` in `main/ide/workspace.ts`, bounded by file size, file
  count and hit count so a big repo can't hang the main process.

**Extensibility — MCP (the spine for “mcps / plugins / skills / connectors”):**
- `src/core/mcp.ts` (pure, **28 tests**) + `src/main/ide/mcp.ts` (processes and sockets). stdio and http
  transports, JSON-RPC 2.0, the `initialize` → `notifications/initialized` → `tools/list` handshake, and
  `tools/call`. IPC `mcp:list|save|remove|enable|call` + a `mcp:changed` event; config in `settings.ide.mcpServers`.
- **Security posture, deliberate and tested:** nothing is auto-discovered and nothing starts by itself — a server
  runs only once a person has *both* added it and switched it on. Commands are spawned with an argv array and
  `shell: false`, and `validateServerConfig` refuses shell metacharacters outright rather than letting a string be
  re-parsed. http is restricted to http/https (a `file://` or `javascript:` URL is rejected). Every request has a
  30s timeout. **A server's output is data, never instructions** — descriptions are truncated to 2000 chars so a
  hostile one can't crowd out a model's real instructions, malformed entries are dropped, and `callTool` refuses a
  tool the server didn't actually advertise. Child processes are killed on `will-quit` so quitting can't orphan them.
- **Why MCP is the answer to all four asks:** “connectors” and most “plugins” now ship *as* MCP servers, so one
  client covers them; “skills” are prompt/instruction bundles that ride the same channel. **Open VSX / VS Code
  extensions remain out of scope** until the `openvscode-server` upgrade — a Monaco editor cannot run them, and
  claiming otherwise would be a for-show feature.

**MCP settings UI — built and seen working (2026-09-18).** Settings › Connections › **Connected tools** lists every
server with a live status dot, the exact command line, an on/off switch, and an expandable list of the tools the
server advertised. Add/edit shows a **“Lumina will run”** breakdown of the parsed argv before anything can start,
and **Import JSON** accepts the `mcpServers` block people copy out of a README. Two pure helpers back this, both
unit-tested: `parseCommandLine` (quote-aware split with *no* shell semantics — `$VARS`, pipes and `;` stay literal)
and `parseMcpJson` (re-validates every entry and forces `enabled: false`, so importing a file can never start a
process). Capture steps `06d/06e/06f-settings-mcp*` screenshot all three.

**✅ The MCP client has now completed a real handshake.** A minimal stdio server
(`scratchpad/echo-mcp-server.js`, 2 tools) was configured and switched on; the main log recorded
`[mcp] MCP server "echo-test" ready with 2 tool(s)` and the UI showed it Connected with its tools listed. The
earlier caveat — protocol logic tested only against synthetic frames — no longer applies to
initialize → notifications/initialized → tools/list. `tools/call` is still only covered by unit tests.

**Integrated terminal — built (2026-09-18).** The `node-pty` gate is cleared: **`@lydell/node-pty` 1.2.0-beta.15
ships Node-API prebuilds and loads inside Electron 44 with no rebuild step** — proved by running a real
PowerShell from inside Electron before a line of UI was written (`PTY_OK exit=0 sawHello=true`). xterm.js 6 in
front, `src/main/ide/terminal.ts` behind: multiple tabs, a shell picker built from `shellCandidates()` filtered to
what is actually on the machine, `MAX_SESSIONS = 8`, resize clamped so conpty can't be handed a zero size, and
`shutdownTerminals()` on `will-quit`. Toggle with **Ctrl+`** or the palette. Packaging: node-pty is `external` in
the main Vite build and `asarUnpack`ed, because a `.node` binary cannot be loaded from inside an asar.

  *Bug worth remembering:* the panel first rendered completely blank. A shell prints its prompt within
  milliseconds of spawning — long before React has re-rendered and built the xterm — so that first output was
  being dropped on the floor. `TerminalPanel` now buffers per-session output until an xterm exists and replays it
  on mount (capped at 500 chunks), and fits on the next frame rather than the frame the host is attached, when it
  is often still zero-height. Neither bug was visible to tsc, vitest or vite build.

**Still not built:** git/source control, split panes, and wiring MCP tools into the BYO-key assistant from item
#21 — that last one needs a tool-calling loop across four provider APIs plus a chat UI, so it is a real piece of
work rather than a wire-up. Typing into Monaco has still never been simulated successfully; only the save path is
proven. (The *terminal* round-trip **is** proven — a command was written to the pty and its output screenshotted.)

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

---

## 14. IDE Phase 3 — the plan to make it a real IDE (agreed 2026-09-18)

Feedback that drove this: *"The current one is too basic… see the 3rd image of the real IDE, and see what is left…
we are not making this as a joke"*, plus a sketch asking for **panel toggle buttons on both sides**, **multiple
terminals seen together**, and **themes you can download**. And a standing complaint that must be fixed first:
**stop making the window appear.**

### 14.0 — STOP RELAUNCHING THE APP (do this before any feature work)

The user has now asked twice. Every `LUMINA_CAPTURE` run creates a visible window that steals focus.

1. **Make capture windowless.** In `src/main/index.ts`, when `LUMINA_CAPTURE` is set, create the BrowserWindow with
   `show: false` and `paintWhenInitiallyHidden: true`. `webContents.capturePage()` works on a hidden window, so the
   screenshots keep working and nothing ever appears on screen. If a window must be shown, use `showInactive()`,
   never `show()`.
2. **Use the live dev loop instead of cold launches.** `pnpm dev` runs Vite + `vite-plugin-electron`: **renderer
   edits hot-reload into the already-open window — no relaunch, no popping.** This is the `npm run dev` equivalent
   the user asked for. Keep ONE dev instance alive for a whole session.
   - Caveat to be honest about: a change to `src/main/**` restarts Electron, which *does* re-show the window. So
     batch main-process edits, and do renderer/UI iteration against the running instance.
3. Never start a second instance without `--user-data-dir=<scratch>` (existing rule).

**✅ 14.0 DONE (2026-09-18, session 10).** Capture runs now use **offscreen rendering** — `createWindow({ offscreen:
true })` when `LUMINA_CAPTURE` is set — so there is no native window at all, and `showWindow()` is a no-op during a
capture run (guarded centrally, because `openLink`, hoster checks and download notifications all call it).
**Lesson worth keeping:** the first attempt used a plain hidden window (`show: false`). It hid the window but
**broke the screenshots** — a hidden window stops producing frames after its first paint and stops firing
`requestAnimationFrame`, so `capturePage()` returned stale, half-faded frames. Offscreen keeps painting. Every
capture since has run this way with nothing appearing on screen. Remember to launch with
`env -u ELECTRON_RUN_AS_NODE` (see §6) — that env var leaks in from the host and makes Electron act as plain Node.

### 14.1 — Layout: panels, splits and sashes (the sketch)

**✅ Mostly DONE (2026-09-18, session 10)** — seen working in offscreen capture `08a-ide-layout`:
- `src/core/ideLayout.ts` (**34 tests**): part sizes/limits, an editor reserve no layout can eat, sash drags that
  grow each part in its own direction and **snap closed** past half the minimum (keeping the last size), panel
  maximize, activity-bar semantics, defensive `normalizeLayout`, and the **terminal group model** (split beside
  the focused terminal, `MAX_SPLIT = 4`, focus lands on a neighbour after a close). Persisted as
  `settings.ide.layout`, written once on sash release rather than every frame.
- Sketch, mark by mark: **blue** — the app sidebar's Collapse toggle moved from the footer to the header beside the
  logo; **green** — Explorer/Search switcher in the IDE top strip; **purple** — top-right toggles for left sidebar,
  panel and **right sidebar**, which shows Open Editors or Search.
- **Terminals side by side**: split button in the panel toolbar; each group shows its terminals at once.
  Keys: Ctrl+B, Ctrl+Alt+B, Ctrl+J / Ctrl+`, Ctrl+Shift+E, Ctrl+Shift+F, plus palette commands.
- Two real bugs caught *before* running: groups keyed by content would have remounted the host on split and
  orphaned the xterm; and the old panel re-`open()`ed an xterm on every tab switch, which xterm does not support.
  Hosts are now one flat list keyed by session id; group membership is pure CSS.
- **"Freedom" — every boundary is draggable (user's stated design principle, 2026-09-18).** One tested rule,
  `resizeBetween` in `core/ideLayout.ts`, moves space only between the two panes either side of a sash, never
  squeezes a pane below `MIN_PANE_PX` (120), and leaves every other pane exactly where the user put it. A new
  split takes half of the pane it splits; a closed pane gives its space to its neighbour. Weights are keyed by
  terminal/group **id**, not position, so they survive panes being added or removed around them. Double-click
  any split sash to even it out. Used by:
  - **split terminals** — sashes between terminals in a group;
  - **editor groups** — `core/editorGroups.ts` (**17 tests**) + `EditorGroup.tsx`: up to 3 editors side by side
    (Ctrl+\ or the split button), each with its own tabs and Monaco instance. Buffers are shared Monaco models,
    so one file open twice is one buffer: edits show in both, unsaved state is tracked per *file*, and a model
    is released only when its file is closed in every group. Closing a group that holds the only copy of an
    unsaved file is refused with a message instead of discarding the edits.
  - Verified numerically in offscreen capture `09a-ide-freedom`: editors `[271,271]` → `[119,423]` after a
    180px drag (held at the minimum), terminals `[257,257]` → `[400,113]`.
- Handlers that change groups compute the next state from a ref and apply side effects once — never inside a
  `setState` updater, which React may run twice (that would halve a split twice or release a buffer early).
- **Not yet:** drag-a-tab-to-split, split *down* (vertical editor groups), Problems/Output tabs in the panel, and
  persisting editor-group widths across launches (sidebar/panel sizes do persist). At the 120px minimum a
  group's own toolbar leaves its tab label only a few characters.

Target the VS Code shell, because that is what the user pointed at:

- **Activity bar** (far left, icons): Explorer · Search · Source Control · Run · Extensions/Themes.
- **Primary sidebar** (left) with a **collapse/expand toggle in its header**, not only the bottom "Collapse".
- **Secondary sidebar (right)** with its own toggle — this is the "same in the other direction… to see 2 things at
  once" from the sketch. Host: Outline, the assistant, or a second file tree.
- **Bottom panel** with tabs: Terminal · Problems · Output · Search results.
- **Editor splits**: split right / split down, drag a tab into a split, close/maximize a group.
- **Sashes**: every boundary drag-resizable, with min sizes; all sizes persisted in `settings.ide.layout`.
- **Toggle keys**: Ctrl+B primary, Ctrl+Alt+B secondary, Ctrl+J panel, Ctrl+` terminal (already done).

**Terminals side by side** (explicitly asked for): the bottom panel keeps the tab list *and* gains a split so two
or more ptys render at once. `TerminalPanel` already keeps one xterm per session in a ref map, so this is a layout
change, not an engine change — render N hosts instead of one and fit each.

### 14.2 — Themes, and "download extensions for the theme"

- One token set drives app chrome, Monaco **and** xterm. Today Monaco has a hand-made `lumina` theme and xterm reads
  CSS variables; unify them so one theme switch changes everything.
- Ship several built-ins (dark, light, high contrast, and a couple of real ones), picked in Settings.
- **Import a VS Code colour theme.** A VS Code *theme* extension is just JSON — no code runs. So Lumina can fetch a
  theme package from **Open VSX**, read its `themes/*.json`, and convert it to a Monaco theme + app tokens. This is
  the honest version of "download extensions": **theme extensions only.**
- ⚠ **Full syntax fidelity needs TextMate grammars**, which Monaco does not do natively — it needs `shiki` or
  `monaco-textmate` + an onigasm WASM. That is real work and a real bundle cost; decide deliberately. Without it,
  imported themes colour the UI correctly but token colours only map as far as Monarch allows.
- ⚠ **Code-running VS Code extensions remain out of scope** until `openvscode-server`. Do not imply otherwise.

### 14.3 — What is still missing vs a professional IDE

Ordered by how much it matters for real work:

1. **Source control**: git panel, changed-file list, diff view (Monaco has a diff editor built in), stage/unstage,
   commit, branch + ahead/behind in the status bar, and gutter marks for added/changed/removed lines.
2. **Problems panel** fed by Monaco's markers + a real TS language service.
3. **Proper status bar**: branch, error/warning counts, language, Ln/Col, spaces/tabs, encoding, EOL.
4. **Explorer parity**: context menus (new file/folder, rename, delete, duplicate, reveal in Explorer, copy path),
   drag-and-drop, multi-select, **Open Editors** section, and a file watcher so the tree refreshes when something
   changes on disk.
5. **Breadcrumbs + Outline** (symbols from the TS service).
6. **Editor settings UI** and a keybinding list.
7. **Recent folders / multi-root.**
8. **Debugger** — honestly, this is the one thing that is probably *not* worth building on Monaco. Say so rather
   than half-shipping it.

**✅ 14.3.1 Source control — DONE and proven against a real repository (2026-09-18, session 10).**
- `core/git.ts` (**21 tests**) parses `git status --porcelain=v2 --branch -z` — git's machine format, stable across
  versions and locales, NUL-separated so odd filenames survive. The test fixture is **real captured output** from
  a scratch repo containing a staged+modified file, a deletion, a rename, a path with a space, a real merge
  conflict and an untracked file — not hand-written.
- `main/ide/git.ts` runs the **user's own git** (not bundled): `execFile` + argv, every path after `--`, every path
  through the same `resolveInside` guard as file access, `GIT_TERMINAL_PROMPT=0`. Nothing pushes, pulls, resets
  or deletes. **Discard** only restores *tracked* files and needs a second click; untracked files are refused.
  A folder that is a *subfolder* of a repo works: paths are translated via `--show-prefix`, and changes outside
  the folder are listed read-only. Friendly errors for missing identity, index.lock, and "nothing to commit".
- UI: Source Control view (Ctrl+Shift+G) — commit box (Ctrl+Enter), staged/changes/conflicts lists with
  stage/unstage/discard, stage-all/unstage-all, "Initialise repository", and a clear message if git is missing.
  **Diff view** on Monaco's diff editor — the right side is the *live buffer*, so editing in a diff edits the file.
  Branch + ahead/behind + change count in the status bar. Refreshes on save and on window focus.
- **Proven end to end:** offscreen capture `10c` staged 3 files, typed a message and clicked Commit through the
  real UI; `git log` outside the app then showed commit `77e0998 "Commit made from the Lumina IDE"` (4 files) and a
  clean tree.
- Bugs found getting there: the diff pane attached its models twice on open (Monaco threw "no diff result
  available"); and in the harness, **a regex inside a template literal silently lost its `\d`** — which I first
  misdiagnosed as a timing problem. Capture scripts are template literals: avoid backslash escapes in them.
- **Not yet:** gutter change markers in the editor, branch switching/creation, push/pull (deliberately not
  automatic — would need credential handling done properly), staging individual hunks, merge-conflict editor.

### 14.4 — The differentiator (what no normal IDE has)

Lumina's IDE lives inside a media app with ffmpeg, yt-dlp and whisper already bundled. Two things fall out of that
which VS Code genuinely cannot do well:

- **A media-native editor.** Open an `.mp4`, `.mp3`, `.srt` or `.vtt` as a *first-class editor tab*: video preview,
  waveform, and a **subtitle editor synced to the playhead** — click a cue, the video jumps there; nudge timings
  against the waveform; run whisper to generate a draft track. Subtitle editing is miserable everywhere else, and
  Lumina already owns every piece needed. **This should be the headline feature.**
- **A terminal that already has the tools.** The integrated terminal puts Lumina's bundled `ffmpeg`, `yt-dlp`,
  `aria2c` and `whisper-cli` on `PATH` for the session — zero install, zero version drift. Quiet, but it is the
  thing people will tell each other about.

Both are honest: they use engines that are already shipping, and neither pretends to be something it is not.

### 14.5 — Suggested order

`14.0` (windowless capture + dev loop) → `14.1` layout & terminal splits → `14.3.1` source control → themes
(`14.2`) → `14.3.2–5` → `14.4` media editor. Ship each with a screenshot from the **hidden** capture window.

---

## 15. Resource usage — measured, not guessed (2026-09-18)

**How to measure:** `env -u ELECTRON_RUN_AS_NODE LUMINA_METRICS=<out.jsonl> npx electron . --user-data-dir=<fresh scratch dir>`
(`src/main/metrics.ts`, dev only). It walks Download → Library → Queue → Settings → Browser → Code (editor, then
terminal) → back to Download, and records per-process memory (`app.getAppMetrics()`) and CPU for each screen.
**Method caveats — keep them attached to any number you quote:** the window is *hidden* so nothing appears on
screen, which makes **memory realistic but CPU a lower bound** (a hidden window doesn't paint). Use **private**
memory, not working set — working set double-counts memory shared between processes (~2× inflated). The
**GPU process figure is noisy: ±20–40 MB between identical runs**, so a single before/after run cannot prove a
GPU change either way. Always use a *fresh* profile per run so caches and the library scan don't differ.

**Baseline after the session-10 work (fresh profile, private memory):**

| Screen | Total | Main | Renderer | GPU | Chromium helpers |
|---|---|---|---|---|---|
| Startup, idle | ~365 MB | ~120 | **41** (was 65) | ~125 | ~79 |
| Library | ~530 | ~150–180* | 51 (was 79) | 216–251 | ~79 |
| Code (editor + terminal) | ~475–495 | ~95 | ~110 | 190–215 | ~79 |

\* The main process briefly holds ~30 MB more the first time covers are resized; the small copies are cached.
Idle CPU: ~0–0.5% on every screen (lower bound). aria2c is not started until a download needs it.

**What changed, and what is proven:**
- ✅ **Code editor and in-app browser are lazy-loaded** (`React.lazy` in `App.tsx`). The startup JS bundle went
  **4,832 KB → 637 KB (−87%)**; renderer memory at startup **65 → 41 MB**, and about −25 MB on every screen other
  than Code. Stable to ±3 MB across runs, so this is real. **Never add a static import of `views/ide` or
  `views/browser` anywhere** — one would pull Monaco back into startup.
- ⚠ **Cover art is served at display size** (`core/artwork.ts`, `?s=` on `lumina-media://art/`, resized once
  with `nativeImage` and cached per size; no request can exceed 1024px). Covers went from ~250 KB to ~7 KB each
  for 36px rows. Sound in principle — Chromium holds decoded images at full size — **but my harness could not
  demonstrate the GPU saving** (hidden windows don't raster, and GPU noise exceeded the effect). Needs a
  measurement on a visible window with a large embedded-art library before it is claimed.
- **Known remaining costs, not yet addressed:** the GPU process baseline (~125 MB, Chromium's own); the in-app
  browser keeps its second renderer (~24 MB) alive after you leave it; Monaco stays loaded after leaving Code
  (JS modules cannot be unloaded; its workers stop after Monaco's own idle timeout).

## 16. Testing approach (user direction, 2026-09-18)

The user wants **deep** testing — thousands of tests are welcome — so features stay features and don't decay into
security, performance or correctness problems. Beyond examples, security-critical and stateful code gets
**property tests** (`tests/properties.test.ts`, seeded generator in `tests/helpers/rng.ts`, so any failure
reproduces exactly): the workspace path guard checked against `node:path` as an independent oracle on 40,000
random paths; the MCP command validator on 20,000 random configs; MCP framing re-assembled from streams cut at
random points; git/porcelain and layout parsers fed junk; and random 40-action user sessions through the terminal
and editor-group state machines with every invariant checked after each action.
**They already paid off:** they found that Quick Open's `fuzzyMatch` **crashed** on filenames containing `İ`
(lowercasing grew the string and an index ran past the end) and **mis-highlighted** everything after an emoji
(it returned UTF-16 indexes; the highlighter counts code points). Fixed, with both counterexamples kept as named
regressions. When adding a feature, add a property test for any rule that must *always* hold.
