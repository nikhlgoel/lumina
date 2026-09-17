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
local playlists / hybrid stream-if-not-downloaded); in-app **equalizer + audio profiles**; (declined) audio-driver
auto-updater; USB portable player + import/export/sync; Chrome Web Store listing for the extension.

## 5. Verification suite (run from repo root)

```bash
npx tsc --noEmit                 # types — must be clean
npx vitest run                   # unit tests (currently 58 passing)
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
| 1 | Slow/unstable download speed (route yt-dlp via aria2 / tune fragments for ~650 Mbps) | ⬜ needs live test |
| 2 | Subtitle display in player | ⬜ |
| 3 | Group repacks as ONE download in Recent/Queue (not per-part) | ⬜ (batch UI exists; grouping pending) |
| 4 | Captcha verification failing | 🟡 addressed via extension + in-app browser + visible-window reload |
| 5 | Block ads/redirects + reposition verify button | 🟡 ad/pop/redirect blocking shipped (147ad02); button reposition ⬜ |
| 6 | Skip-All + notifications to top-right (not bottom) | ✅ toasts top-right (ae099d2); Skip-All ⬜ |
| 7 | Populate search menu | ⬜ |
| 8 | "500 MB repack limit" | ✅ audited — no cap exists (ae099d2) |
| 9 | Repack grouping in Queue (see #3) | ⬜ |
| 10 | Torrent file-selection + detail page + custom graph + "disk cache flush failure" fix | ⬜ |
| 11 | Test-accounts sign-in + privacy message | ⬜ |
| 12 | Bug-report destination / admin panel | 🟡 decided: GitHub Issues now, issue-backed admin later |
| 13 | Proper semver / what alpha.0 means | ✅ documented (here + PUBLISHING.md) |
| 14 | Portable USB media player | ⬜ |
| 15 | Permission re-grant UI | ⬜ |
| 16 | Player format support (transcode/remux on play via bundled ffmpeg) | ⬜ (decision: transcode/remux on play) |
| 17 | Like/rate + local playlists | ⬜ (see idea §8-A) |
| 18 | Toggle AI models off for RAM | ⬜ |
| 19 | USB detect + import/export/sync | ⬜ |
| 20 | Chrome Web Store extension listing | ⬜ |
| 21 | User AI API keys for lyrics | ⬜ |
| 22 | USB structure | ⬜ |
| 23 | Auto-update on launch + restart button | ⬜ |
| 24 | Web search in search bar | ⬜ |
| 25 | Animated bigger search bar | ⬜ |
| 26 | Play-while-downloading | ⬜ |
| 27 | UI placement shift with long title | ✅ player Dock fix (ae099d2) |
| 28 | Video fullscreen overlay controls | ⬜ |
| 29 | Library docs / other file types | ⬜ |
| 30 | Stuck at 6 GB + large-file optimization + expanded logging | 🟡 aria2 stall root-cause fixed (cab6cfd); large-file tuning + expanded logging ⬜ |
| 31 | Queue concurrency: extras auto-queue & auto-start when a slot frees; clearer than manual pause | ✅ scheduler already auto-manages; clarity/labels + tests added (this session) |
| 32 | Library view modes (compact list / grid / list) | ✅ music details/compact + video grid/list (this session) |

## 8. New ideas captured + my recommendation

**A. Offline music-platform experience (Spotify/YT-Music structure, offline).** Likes, albums, create/choose
playlists; downloaded songs kept offline; not-yet-downloaded songs can still stream (hybrid). **Recommendation: YES,
strong fit** — it formalizes item #17 and builds on the existing Library + player. Sequence it after Phase-1 stability.
Model: a "Collection" (liked/rated + user playlists) stored in sqlite, layered over the existing library scan; a track
can be `local` or `streamable`; the player queue already exists. Start with likes + local playlists + an Albums view.

**B. Equalizer + audio profiles.** **Recommendation: YES.** Fully doable in-app with the Web Audio API
(`AudioContext` + a chain of `BiquadFilterNode`s) on the player's audio element — no drivers, no native code. Ship
named profiles (Flat, Bass, Vocal, Warm, etc.) each with a one-line description, plus a custom band UI. Place it in the
**player** (a dedicated EQ panel/sheet), not buried in Settings, so it doesn't clutter. Optional stretch: output-device
picker and, on Windows, WASAPI exclusive/bit-perfect output for quality.

**C. Audio-driver detection + auto-download/update.** **Recommendation: NO — do not build this.** Downloading and
installing system audio drivers is high-risk and largely infeasible to do safely: it needs elevation, OEM drivers
can't be legally redistributed, wrong/generic drivers can break audio, and an app that fetches-and-installs drivers
will trip SmartScreen/AV and create liability. The real sound-quality win is achieved by **B** (in-app EQ + high-
quality resampling + exclusive/bit-perfect output). If hardware detection is wanted, use it only to *inform* (show the
active output device and offer the in-app high-quality path) and leave actual driver updates to the OS/vendor tools.

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
