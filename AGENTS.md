# Working on Lumina

Canonical instructions for any agent or person working in this repository. `CLAUDE.md` points here;
do not maintain a second copy of these rules anywhere.

Lumina is a free, open-source Electron app: a universal download assistant and an offline media
player. Windows is the development machine; Linux and macOS are supported targets.

---

## 1. Hard rules — these are not preferences

1. **No bot-detection evasion.** No `navigator.webdriver` spoofing, no
   `disable-blink-features=AutomationControlled`, no occlusion or visibility faking, no `cf_clearance`
   harvesting or replay, no automated CAPTCHA/Turnstile/DataDome solving, no solver services. When a
   site puts up a challenge, the only supported path is the person solving it themselves, in the
   in-app browser or through the extension.
2. **No pirated or infringing content, ever, including as a test fixture.** Use public,
   non-infringing sources: Big Buck Bunny (`test-videos.co.uk`, `download.blender.org`),
   `sample-videos.com`, Creative-Commons YouTube clips. A file already sitting on the machine is not
   a licence to test with it.
3. **Verify before you claim.** See §3. "The types check" is not "it works".
4. **Never commit or push without being asked.** The user decides when work lands.
5. **Releases** go through winget, Homebrew, Linux package managers and GitHub Releases.
   **Never the Microsoft Store.**
6. **No features "for show".** If something only half works, say so plainly and record it in
   `BUGS.md`. A green checkmark that isn't earned is worse than no checkmark.

## 2. The repository

```
src/core/      Pure logic. No Electron. Aliased @core.
               Everything here is unit-testable, and most of it is tested.
src/main/      Electron main process: engines, IPC handlers, servers, filesystem.
src/preload/   Sandboxed bridge. CommonJS, no Node exposed to the renderer.
src/renderer/  React 19 + Tailwind 4 + Zustand. Aliased @/… (NOT available in tests).
src/shared/    Types and the typed IPC contract shared by main and renderer.
tests/         Vitest. Imports @core and @shared only.
resources/bin/ Bundled tools: aria2c, yt-dlp, ffmpeg, ffprobe, 7-Zip, whisper-cli.
docs/          Design specs, numbered. Background, not current state.
```

**Put logic in `src/core` whenever it can go there.** It is the difference between a rule that can be
tested and a rule that can only be observed. Two bugs that silently disabled entire features — the
ffmpeg cover-art specifier and the extension bridge's status — were fixed by moving the decision into
`core` with a test pinning it.

**IPC**: add the input schema to `src/shared/ipc.ts` (Zod), the handler to `src/main/ipc.ts`, and any
event channel to the whitelist in `src/shared/channels.ts`. The preload is sandboxed; nothing reaches
the renderer that is not on that list.

## 3. Verifying work

Run all three before claiming anything:

```bash
npx tsc --noEmit
npx vitest run
npx vite build
```

**Then actually look at it.** All three have passed while the editor rendered nothing, the Library
showed placeholder gradients instead of thumbnails, and the extension bridge reported itself as
listening while nothing was bound. Type checks cannot see any of that.

### The offscreen capture harness

The app screenshots itself without opening a window. This is how UI claims get earned.

```bash
LUMINA_CAPTURE=<dir> LUMINA_CAPTURE_ONLY=<regex> \
  env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron . --user-data-dir=<scratch>
```

* `env -u ELECTRON_RUN_AS_NODE` is required; without it Electron starts as plain Node.
* **Always pass `--user-data-dir`** pointing at a scratch directory. The user's own Lumina may be
  running, and two instances sharing a profile will fight.
* Seed the scratch profile by **copying** `lumina.db`, and **clear its job rows** — a capture run
  once resumed a real queued download against the user's real music folder.
* The IDE steps also need a `settings.json` with a workspace, or every one of them photographs the
  same "Open a folder to start editing" screen and looks falsely identical.
* Steps live in `src/main/capture.ts`. Add one when you add a screen.

**Read the run mechanically, not by eye**: hash every screenshot and flag any two steps that produced
an identical image. An identical pair means that step changed nothing, which is exactly what a
silently broken feature looks like. That technique found three real bugs in a single pass.

### Rules for testing on this machine

* **Never show the app window.** Use the capture harness. If a foreground launch is genuinely needed,
  ask first.
* Electron on Windows is a GUI-subsystem binary: **`console.log` from the main process never reaches
  the shell.** Write probe output to a file, or read `<profile>/logs/lumina.log`.
* Bundled tools in `resources/bin/win32-x64` can be run directly when probing behaviour.

## 4. Style

Match the code around you. Specifically:

* **Comments explain why, not what.** The valuable ones here record the failure that forced the code
  to be the way it is — *"`m:` selects by metadata tag, so this matched no stream"*. Write those;
  delete decorative ones.
* Tests are named as sentences describing behaviour, not the function under test
  (`'never falls back to zero when a file finishes and the next begins'`).
* No `any`. No non-null assertions outside tests unless the invariant is stated nearby.
* Prefer narrow, honest state over a boolean that means two things. A "running" flag that actually
  means "switched on in settings" is how a dead feature reports success.

## 5. Documentation — which file is for what

| File | Holds |
|---|---|
| `AGENTS.md` | These rules and the workflow. Canonical. |
| `CLAUDE.md` | A pointer here, plus anything Claude-specific. |
| `HANDOVER.md` | Current state: what is built, what is proven, what is not. Read §0 first. |
| `SESSION-LOG.md` | Chronological narrative, newest at top. One entry per session. |
| `DECISIONS.md` | Why the architecture is the way it is. Append; never rewrite history. |
| `BUGS.md` | Known defects and the backlog, with honest status. |
| `CHANGELOG.md` | User-facing changes per release. |
| `docs/01..13` | Original design specs. Background; not current state. |

**Every session updates `SESSION-LOG.md`, and `HANDOVER.md` §0 if state changed.** Record what was
*not* proven as carefully as what was — a reader who inherits an overstatement will build on sand.

## 6. Things that have bitten, repeatedly

* **ffmpeg picks its encoder from the output extension.** A file named `.lumina-part` has no muxer.
* **ffmpeg stream specifiers**: `m:` is *metadata*, `disp:` is *disposition*. `0:v:disp:attached_pic`
  selects embedded cover art; the `m:` form silently matches nothing and exits non-zero.
* **Electron presents `app.asar` to `fs` as a directory.** Any recursive copy of the app folder must
  use `original-fs`, or it walks into the archive and dies part-way through.
* **`process.noAsar` is global** — do not reach for it to fix the above; scope `original-fs` to the
  one module that needs it.
* **Status must come from reality, not from settings.** Report a server as running only when its
  socket is bound, and surface the reason when it is not.
* Shell heredocs in this environment **strip backslashes**. Writing a regex or a Windows path through
  one corrupts it; use the Write tool, or build the string without backslashes.
