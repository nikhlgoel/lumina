# Decisions

Why Lumina is built the way it is. **Append only** — when a decision is reversed, add a new entry
that supersedes the old one rather than editing history. A decision nobody can find the reasoning
for gets re-litigated every few sessions, usually badly.

Format: what was decided, what it rules out, and what forced it.

---

## D1 — No bot-detection evasion, at any cost

**Decided:** Lumina will never spoof `navigator.webdriver`, disable automation flags, fake element
visibility, harvest or replay `cf_clearance` cookies, auto-solve CAPTCHAs, or call a solver service.

**Instead:** when a site challenges, the person solves it themselves in the in-app browser or through
the extension, and Lumina uses the session that results.

**Why:** it is the difference between a download tool and an abuse tool, and no amount of user
convenience justifies crossing it. It is also enforced from outside — the build environment's
classifier blocks such code — so attempting it only wastes the session.

## D2 — Bundled binaries, not system dependencies

**Decided:** ship aria2c, yt-dlp, ffmpeg, ffprobe, 7-Zip and whisper-cli inside the app
(`resources/bin/<platform>`), and put that directory on the PATH of every tool process.

**Why:** the target user wants a download to work, not to install ffmpeg. It costs roughly 200 MB of
installer and removes the entire category of "works on the developer's machine" bugs. yt-dlp also
self-updates into `userData/bin`, which takes precedence, so a site change does not need a release.

## D3 — Pure logic lives in `src/core`

**Decided:** every decision that can be expressed without Electron goes in `src/core`, is imported by
main and renderer through the `@core` alias, and is unit-tested.

**Why:** it is the only way most of this is testable at all. It has repeatedly been the fix rather
than a style preference — the ffmpeg cover-art specifier (D11) and the download-progress rules were
both bugs no test could catch while the logic sat inline in a main-process file.

## D4 — A typed, whitelisted IPC surface

**Decided:** every channel has a Zod input schema in `src/shared/ipc.ts`, a handler in
`src/main/ipc.ts`, and events must appear in the `src/shared/channels.ts` whitelist. The preload is
sandboxed and exposes no Node.

**Why:** the renderer loads remote content in the browser view. Anything less than a closed list is
an open door.

## D5 — The app screenshots itself

**Decided:** UI is verified by an offscreen capture harness (`src/main/capture.ts`) driven by
`LUMINA_CAPTURE`, not by opening a window.

**Why:** the development machine is the user's daily machine, and popping windows open is
disruptive. More importantly it makes UI claims falsifiable: `tsc`, `vitest` and `vite build` have
all passed while the editor rendered nothing and the Library showed placeholders instead of
thumbnails.

**Refined (session 25):** read the run *mechanically* — hash every screenshot and flag identical
pairs. Two steps producing the same image means one of them changed nothing. That check found three
real bugs in one pass, including a navigation guard that left the page unable to reload itself.

## D6 — A television cannot run Lumina's player

**Decided:** stop trying. A TV's USB port is served by its own firmware media browser; it will not
boot from a stick, will not autorun, and accepts only vendor-signed firmware. The prompt asking
whether you are browsing photos, video or music is the television's own UI and cannot be replaced.

**Instead**, three honest paths, best first:
1. **HDMI** from the computer — full Lumina, every format.
2. **DLNA** (`Settings › Share to TV`) — Lumina's own library on the TV, needs a network.
3. **USB done properly** — the stick is a plain media folder, so make what the TV *can* read as good
   as possible: TV-safe codecs (D7), embedded artwork, and a sane folder layout (D12).

## D7 — Convert to a TV-safe profile on export, not on download

**Decided:** files are downloaded at full quality and converted only when copied to a drive, using
the profile in `src/core/tvSafe.ts` (H.264 High, yuv420p 8-bit, AAC stereo, MP4).

**Why:** the library keeps its quality; only the copy going to a television is compromised. Export is
also idempotent — a re-export copies nothing — because conversion and artwork embedding both change
file size, so matching on name-and-size re-did the work every time. The check is modification time.

## D8 — Portable mode keeps all data beside the executable

**Decided:** a marker file (or electron-builder's `PORTABLE_EXECUTABLE_DIR`) switches `userData` and
`sessionData` to `Lumina-Data` next to the binary. `src/main/portableMode.ts` must stay the **first**
Lumina import in `index.ts`.

**Why:** if any module reads a path before the redirect, half the app writes to `AppData` and half to
the stick, and the failure stays invisible until the drive is moved to another machine.

## D9 — Copying Lumina onto a drive uses `original-fs`

**Decided:** `src/main/portableInstall.ts` takes its filesystem from Electron's unpatched
`original-fs`, scoped to that module.

**Why:** Electron presents a packaged `app.asar` to `fs` as a *directory*. A recursive copy walks
into the archive and dies with `ENOENT, not found in …app.asar` — exactly how this failed on a real
stick at 349 MB of 732 MB. The process-wide `process.noAsar` would also fix it and would break every
other read from the archive while a copy ran, so it is deliberately not used.

## D10 — Status is reported from reality, never from settings

**Decided:** a server reports `running` only when its socket is bound, carries the reason when it is
not, and broadcasts state changes so the UI follows.

**Why:** the extension bridge reported `running: settings.enabled`. With port 17865 taken, Settings
said "Listening only on this computer" while nothing was listening, and the one thing that would fix
it — changing the port — appeared only in a log file. The same class of error made "Share to TV" draw
an *on* switch beside the word "Off".

## D11 — ffmpeg arguments belong in `core`, with tests pinning them

**Decided:** commands such as the video-thumbnail attempts live in `src/core/artwork.ts`, pinned by
tests that also **forbid** the wrong form.

**Why:** `-map 0:v:m:disposition:attached_pic` looks correct and matches nothing — `m:` selects by
*metadata tag*, so it read as "metadata key `disposition` equals `attached_pic`". Every video with an
embedded thumbnail, which is every video yt-dlp downloads, silently fell back to no artwork. No
crash, no error in the UI, just a placeholder that looked like a design choice.

## D12 — A music drive is filed by real albums only

**Decided:** on export, a track goes into `Music/Artist/Album/NN Title` only when that album is named
*and* more than one exported track belongs to it. Everything else goes flat as
`Music/Artist - Title`. A folder image is written only inside a genuine album folder.

**Why:** downloads carry an album tag that is usually unique per track, so `Artist/Album/` produced
one folder per song, each holding a single track and a `cover.jpg`. On a television, which lists
folders, a music library became hundreds of folders instead of songs. Measured on the development
library: **383 folders for 455 songs, down to 42.**

**Note:** this changes target paths, so a drive exported under the old layout is written again in the
new shape; the old folders are not removed automatically.

## D13 — Documentation is split by purpose, and records what is *not* proven

**Decided:** `AGENTS.md` (rules, canonical) · `CLAUDE.md` (pointer) · `HANDOVER.md` (current state) ·
`SESSION-LOG.md` (narrative) · `DECISIONS.md` (this file) · `BUGS.md` (defects) ·
`CHANGELOG.md` (releases). Each session updates the log, and the handover when state changed.

**Why:** state and narrative drifted badly when they shared a file — the handover claimed 529 tests
and "not built" for a feature that had worked for days. An explicit "proven vs never proven" list is
what stops a reader inheriting an overstatement and building on it.

## D14 — Every track plays at one level, and nothing is allowed to clip

**Decided:** measure each track's integrated loudness and true peak once with ffmpeg's `ebur128`,
store it on the library row, and apply a gain at playback so everything lands at -14 LUFS — capped
so the result never exceeds -1 dBTP. On by default (`player.normalizeLoudness`).

**Why:** asked why Lumina sounded weaker and duller than Spotify at the same volume, the library was
measured rather than guessed about. Tracks ran from **-14 to -5.1 LUFS**, so quietness was never the
problem — but **seven of eight peaked above full scale**, up to **+5.6 dBFS**. A master that peaks
above 0 clips on playback, and clipping is heard as harsh and flat, not loud. Streaming services
pull everything to a common target, which drags those peaks back under the ceiling as a side effect;
that is the whole of what they do differently here.

The gain is a node in the audio graph, ahead of the equalizer, **not** a change to `media.volume` —
the volume slider has to keep meaning what the listener set it to. The peak ceiling beats the
loudness target whenever they disagree, because boosting a quiet track into clipping would recreate
the exact fault this removes.

## D15 — A download reports two figures, because one of them cannot move

**Decided:** `JobProgress` carries `percent` (the whole job) **and** `filePercent` (the file being
downloaded now). A multi-item job gives the file the headline number and the main bar, and draws the
job's own progress as a thinner bar underneath, labelled `N% of all 433`. A single download is
unchanged — there, the two figures are the same thing. The arithmetic moved out of
`src/main/jobs/ytdlp.ts` into `src/core/ytdlpProgress.ts`, where it is replayed against a real
capture of yt-dlp's output.

**Why:** "downloads show no usable progress" was reported three times, and two theories were built
and disproved — the parser was blamed twice, wrongly. This time the bundled yt-dlp was run against
three public samples with the exact argv `buildDownloadArgs` produces, and all 105 output lines were
replayed through the model. It produced a clean, monotonic 0→99% ramp with correct speeds and byte
totals. **Nothing was broken.**

The fault is what the number *means*. On the reported 433-item playlist one song is **0.23%** of the
job, so:

* the whole-number percentage changes **once every five songs**, and
* the bar advances a quarter of a percent per song, which is not distinguishable from a bar that is
  stuck.

For the first five songs it reads exactly `0%`. Both figures were always honest; only one of them is
legible, and it is the wrong one to put in front of someone watching a single song download.

**This also rules out a whole family of future theories.** The parser, the event order, the
`n_entries`/`playlist_index` handling in batch mode and the item counting are now pinned by a
replayed real capture. A new explanation for a progress complaint has to survive those tests first.

## D16 — Shuffle is an order, not a dice roll

**Decided:** `src/core/shuffle.ts` holds a permutation of the queue plus a cursor. Every track plays
once before any track plays twice; the end of a pass deals a fresh order that never opens with the
song that just finished; Previous walks the cursor back through what actually played, and refuses to
go back past the first track of the pass.

**Why:** the old code picked a random *other* index on every advance, which fails twice over. It
repeats songs while others never play at all — over a long queue you hear a fraction of it. And
because the random branch ignored the direction argument entirely, **Previous moved forward**: it
dealt another random track rather than returning to the one just heard. There was no record of what
had played, so there was nothing to go back to. A history is the whole reason this is state rather
than a call to `Math.random` at the point of use.

The randomness is injectable, so the tests assert real properties — full coverage of the queue, no
repeat across the seam, exact retracing backwards — instead of hoping.

## D17 — Names that come from another program are pinned by a capture, never by guesswork

**Decided:** where Lumina matches on a string another tool emits, the accepted spellings are taken
from a real run of that tool, written into a test, and the plausible-but-wrong form is **forbidden**
by that same test.

**Why:** `POSTPROCESSOR_LABELS` was keyed on names like `FFmpegExtractAudio`. yt-dlp reports a
postprocessor by its `pp_key()`, which strips the trailing `PP` *and the leading `FFmpeg`* — the
real string is `ExtractAudio`. Seven of thirteen entries therefore matched nothing, and every music
download in the app's history said a flat "Processing" where it should have said "Extracting audio",
"Merging video and audio" or "Writing metadata". Nothing failed; a fallback quietly covered it.

That is the same failure as D11's `-map 0:v:m:disposition:attached_pic`, which looked right and
selected no stream. Both were found only by running the real tool and reading what it actually
printed. Captured here: `ExtractAudio`, `Metadata`, `MoveFiles`, `ThumbnailsConvertor`,
`VideoRemuxer`.

## D18 — Volume goes past 100%, and a limiter stops that meaning distortion

**Decided:** the volume control runs 0–200%. Up to 100% it is `media.volume` alone and the Web
Audio graph is not involved. Above it the element sits at unity and a gain node makes up the rest,
followed by a limiter that is *configured to do nothing* below 100% and becomes a brick wall at
-1.5 dBFS above it. The split lives in `src/core/volume.ts`.

**Why:** `HTMLMediaElement.volume` is defined as 0..1 and silently clamps anything more, so louder
than 100% is impossible through the element. Gain on its own is the naive version, and it is why
"volume boost" has a bad name: a track already peaking near full scale simply clips, which is the
exact fault D14 was about. The limiter is what makes the extra loudness clean rather than harsh.

D14 also makes the boost mostly free — normalised material sits near -14 LUFS with about 13 dB of
headroom, so doubling it is comfortably inside what the limiter can hold.

**One function sets it, not two.** The store set the startup volume and `App.tsx` set it again after
settings loaded. When the range grew past 1, only one of them was taught the split, the element
threw, the throw was caught as a startup failure, and the app showed **"Lumina couldn't start"** —
with `tsc`, 893 tests and the build all green. `applyStoredVolume` is now the only way in.

## D19 — A playlist downloads several items at once, because the wait is per item

**Decided:** one playlist is split between several yt-dlp processes (`downloads.playlistWorkers`,
default 4, hard ceiling 8), each given its own `--playlist-items` slice and its own copy of the
download archive, merged back at the end. Round-robin, so a run of long tracks is spread rather than
landing on one worker.

**Why — measured, not assumed:**

* A 40 MB file takes the **same** time over 1 connection as over 16. The link saturates around
  **25 Mbit/s**; more sockets per file buy nothing.
* yt-dlp spends about **4.8 s per item** deciding what to fetch, before any audio moves.
* A song is ~8 MB, so ~2.5 s of actual transfer.

A 433-song playlist is therefore **~53 minutes**, of which ~35 are spent waiting, with the line
running at about **9 of its 25 Mbit/s** throughout. The bottleneck is per-item latency. Four at a
time takes it to ~13 minutes, and is the only change that touches the real constraint.

**Why not more:** past a handful of parallel extractions YouTube answers with rate limits rather
than data, which is slower than doing less. The ceiling is deliberate.

**Archives are copied, not shared.** Several processes appending to one file is a race nobody should
have to reason about. Each worker gets a seeded copy and the union is folded back when the job ends.

## D20 — The browser's shield is a filter engine, not a blocklist

**Decided:** `src/core/shields.ts` implements Adblock Plus syntax — `||domain^` anchors, wildcards,
separators, `$type`, `$third-party`, `$domain=`, `@@` exceptions and element hiding — with rules
indexed by token. `src/main/shields/` attaches it to the browser session's `onBeforeRequest`, adds
https upgrading, per-site "shields down", and the counters the badge shows.

**Why a real engine:** a rule is a pattern with conditions, and exceptions *unblock*. `example.com`
in a list does not mean "block that host". A `Set` of hostnames cannot express `$third-party`, and
without `@@` support the sign-in flows people depend on break — at which point the shield gets
switched off entirely, which protects nobody.

**Blocking happens before the connection.** A blocked tracker is not fetched and discarded; it never
leaves the machine. That is the difference between blocking an ad and hiding one.

**Indexed by the rarest token, not the longest.** Filing by length looked sensible and measured
badly: `analytics` is long, so 838 rules landed in one bucket and every request to an analytics host
was compared against all of them. Measured on the real EasyList + EasyPrivacy (115,598 network
rules, 24,347 cosmetic): biggest bucket **2766 → 79**, and per-request cost **114 µs → 50 µs**, or
about 5 ms across a hundred-request page.

**There is always a floor.** A small built-in list ships inside the app, so a first run, a metered
connection or a captive portal still blocks the large ad and tracking networks rather than silently
doing nothing. The public lists refresh weekly into userData on top of it.

**Not implemented, and skipped rather than half-applied:** `$redirect`, `$rewrite`, `$removeparam`,
scriptlet injection, and procedural cosmetic selectors. A rule carrying one of those is dropped, not
approximated — approximating it would let a request through while believing it had been handled.
