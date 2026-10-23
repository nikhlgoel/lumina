# Bugs and backlog

Honest status only. Something is **Fixed** when the real path has been run and the result looked at —
not when the types check. Anything believed-fixed but unverified says so.

Status: `Open` · `In progress` · `Fixed` · `Won't fix` · `Unexplained`

---

## Open — Fire TV app (`tv/`), only lightly tested on a real stick

* **TV-1 · Real device mostly untested.** Run on the real stick (AFTMA08C15, Fire OS 8 / API 30, armeabi-v7a, 1.7 GB RAM,
  checked 2026-10-22): install, launch, Home, Playlists page, Settings and the update check render and respond. NOT yet
  tried on it: playback and hardware decoding, downloads, the real remote's media keys, Amazon's keyboard, USB drive,
  memory pressure under load. The emulator is x86 with software decoding, so its performance says nothing about the stick.
* **TV-6 · The Fire launcher shows our icon in a grey tile, not the 16:9 banner. Not fixable from the manifest, as far
  as tested.** The banner is in the APK (application level, all four density buckets, opaque, in `mipmap-*`, exactly as
  Downloader ships it). Eight single-variable attempts changed nothing: banner on the activity too; `leanback` required;
  `mipmap` vs `drawable`; bumping `versionCode`; dropping the plain `LAUNCHER` filter; a reboot; all four buckets and
  opaque; a full uninstall and reinstall (so no cached tile). The telling evidence: NetMirror's own APK declares an
  application banner (`aapt2`: `banner='res/gU.png'`) and the launcher shows it as the same icon-on-grey tile. The
  working examples (Downloader, Steam Link, Amazon Music) are Amazon Appstore apps. Inference, from two sideloaded apps
  and not proven: this launcher draws banner art only for Appstore-catalogue apps. The remaining way to get a banner
  would be an Appstore listing, which the user has said they do not want. Brave and NetMirror show the same fallback tile
  and changing their art would mean re-signing other people's apps, which is not done.
* **TV-8 · USB drives: only a drive on the stick itself can work, and no real drive was ever plugged in.** Checked on
  the stick (AFTMA08C15): it reports `usb.host` and `usb_storage`, its only USB connection is the micro-USB power
  socket (so a drive needs an OTG adapter that also takes power), and `sm list-volumes` shows only built-in storage. A
  drive in the TV's own USB port is invisible to the stick: HDMI carries no USB. Detection, the "use this drive?"
  prompt, choosing it, and downloading onto it were verified end to end on the emulator with a virtual portable volume
  (`sm set-virtual-disk`); the file landed on the drive. NOT verified with real hardware: Fire OS's own format/adopt
  prompt, NTFS drives (only FAT32/exFAT are expected to mount), and unplugging mid-download.
* **TV-10 · Crackle on the TV's speakers is unexplained.** Reported after the audio buffer was raised to 1.5-3 s. The
  player reported 0 underruns across idle, rapid skips, seeks, pause/resume and browsing while playing, before and after
  reverting that buffer, so it is not a buffer underrun the app can see. The buffer is reverted and prefetching moved to
  background priority, but whether the crackle is gone is **unproven** (needs a listen on the real TV). Untested: network
  drops, speed changes, audio-to-video switches. `adb logcat -s LuminaAudio` lists any underrun.
* **TV-9 · "Dynamic" is partly done.** Now Playing (tint, drifting cover, equaliser, lyric easing) and the whole app's
  accent colour follow the cover art. Pages have no per-item motion beyond the focus lift and glow; the planned motion
  language (light pulse on press, cover-to-player transition) is not built. Nothing loops in the background any more:
  an always-running backdrop animation was the main cause of 19 fps (see SESSION-LOG 36).
* **TV-7 · Self-update is proven only as far as "check".** Against the real GitHub API the repository has no releases, so
  the live check correctly says "up to date". Download, checksum, package/version check and the system installer have
  not run end to end; they need a published `lumina-tv-<version>.apk` release. Android will refuse an update not signed
  with the installed app's key, so debug and release builds cannot update each other.
* **TV-2 · Voice.** The in-app Speak button needs a speech recogniser the stick may not have; the Alexa button cannot be
  taken over by an app. Hidden when unavailable. Whether Alexa sends `MEDIA_PLAY_FROM_SEARCH` is unknown.
* **TV-3 · No extractor updater.** When a site changes, search breaks until the app is rebuilt (Settings > Test
  connection reports it). A plain, honest limitation, not a fix.
* **TV-4 · Untested paths:** USB drive as storage, subtitles, the TV speed/quality menus, shuffle/repeat, mini player,
  cancel/retry/resume of a download, full drive, dropped connection mid-download, killed-app resume, 4K, sleep/wake.
* **TV-5 · "Video rate" and "Sound rate" in the stats panel read "unknown" for streamed items** (the player is not told a
  bitrate for progressive streams). Cosmetic; saved files show real values.
* **P-1 · "Square artwork" crops a YouTube thumbnail to its centre square inside the downloaded file.** For a wide
  thumbnail that loses the sides for good, in every player. Needs a decision: letterbox instead, or leave it.

## Open — reported from live use

### B11 · Cancelling a magnet link could leave its real download running — `Fixed (2026-10-23)`

aria2 runs a magnet as two downloads (metadata, then the files). `stop()` removed only the first, so a cancel just after
the metadata arrived left the second one writing unseen (259 MB after "Cancelled") and made Retry fail with "InfoHash is
already registered". Fixed by removing everything the first led to (`followedBy`). Also fixed: the row read 100% during the
metadata phase; aria2's `rpc-save-upload-metadata` littered every download folder with a `<sha1>.torrent`; the cancel now shows
"Cancelling…" until the files are actually gone. Not proven on a real swarm.

### B10 · A resumed download could silently mix two versions of the file — `Fixed for plain downloads (2026-10-23)`

Measured: the server's file changed during an outage; the resume appended the new bytes to the old partial and the job
finished "Done" (80 MiB old + 170 MiB new). aria2 resumes with `Range` and no `If-Range`; same size, so no check caught it.
Fix: `core/resumeCheck.ts` remembers ETag/Last-Modified/size and compares before a resume; a change restarts from zero.
Also: network failures now wait for the connection instead of a 3-try timer (`core/networkRetry.ts`).
Not proven: yt-dlp's `.part` resume, file-host links, proxies (check skipped), a real sleep/wake.

### B9 · The Queue row shows untrue or missing numbers — `Open (formatters fixed 2026-10-23; layout needs approval)`

A no-length download shows "0%", an empty bar and no bytes while data flows (photographed); paused rows show no
number; finished rows show no size/time/speed; a true 0 B prints "—"; the taskbar bar is an unweighted mean of
percents; sidebar speed hides anything under ~5 KB/s. Full list D1–D11 with evidence in
`docs/19_DOWNLOADER_IMPROVEMENT_PLAN.md` §2. Fixed already: `formatEta`/`formatBytes` carry bugs ("2m 60s", "1024 KB",
"277777h"). Layout changes wait for a mockup and a yes.

### B8 · Big downloads/torrents go to 0 B/s after minutes and never resume — `Fixed on the mechanism (2026-10-23); owner's real torrent not yet run`

Cause: on NTFS a write far past a file's end blocks the writer while the gap is zero-filled (37 s for one write 20 GB
in, measured); aria2 serves RPC on that thread, Lumina read the silence as death and restarted it, repeating.
Fixed by flagging big output files sparse (`src/main/sparse.ts`), giving a live engine 120 s of grace, and a
60/180/420 s stall ladder (`src/core/engineWatch.ts`). A/B on the real runner, 24 GB: 188 s + RPC timeouts → 73 s clean.
Not proven: the reporter's ~100 GB game torrent; exFAT/FAT32 targets; disk-full and cancel/retry on torrents.
Evidence: `docs/desktop-services-plan.md`.
Follow-up (same day): cancel/retry/pause verified on a real direct file and torrent; a torrent larger than the free
space now pauses with the reason instead of starting blind (`core/diskSpace.ts`). Still unproven: a disk that fills
mid-write (needs a small volume), magnet cancel.

### B1 · Downloads show no usable progress — `Fixed on the accelerated path (2026-10-23), UI row not yet photographed`

> **2026-10-23:** aria2's readout is now parsed (`src/core/progress.ts`) and `finished` completes a stream. A real
> Electron run on YouTube gave 0 → 100 with live speed/ETA and the video → audio stage change. A second cause was
> found only in the app: aria2's last readout has no newline, so yt-dlp's `finished` came glued to it and was lost
> (`splitYtdlpLine`). YouTube's https formats do take the aria2 path. Not proven: the Queue row drawn live; a
> multi-item playlist on this path. Evidence: `docs/desktop-services-plan.md`.

> **Reopened 2026-10-11, by measurement.** Everything below is true of the *native* yt-dlp downloader.
> With acceleration on (the default), plain http(s) downloads go through aria2c and yt-dlp prints
> **one** `LUMINA_DL|finished` line and **no** `downloading` lines — checked on two captures (5 MB and
> 30 MB, bundled yt-dlp 2026.08.19, Lumina's exact flags). aria2's own readout
> `[#id 7.3MiB/29MiB(25%) CN:16 DL:5.1MiB ETA:4s]` *does* reach stdout (this contradicts the
> "no `[#…]` aria2 line ever reaches stdout" note further down) and nothing parses it, so percent, speed,
> ETA and the real connection count are discarded. Plan: parse that readout in `core`, fixture = the
> captured log — see `docs/14_LENGINE_FRAMEWORK.md` Phase 0. **Not yet checked:** whether YouTube's own
> `https` formats take this path in the app (the capture used a direct mp4).

Reported three times. A download shows a bar that keeps moving without ever meaning anything, and no
per-file percentage or speed. First seen as "215 of 433" beside **0%** on a playlist.

**Cause found, by measurement.** The bundled yt-dlp was run against three public Big Buck Bunny
samples using the exact argv `buildDownloadArgs` produces, and all 105 output lines were replayed
through the live progress model. It produced a clean, monotonic 0→99% ramp with correct speeds and
byte totals — **the parser and the arithmetic were both fine**, which is why the two theories below
kept being disproved.

What was wrong is which number is on screen. `percent` is the whole job, and on a 433-item playlist
one song is **0.23%** of it, so the whole-number percentage changes **once every five songs** and
the bar creeps a quarter of a percent per song. For the first five songs it reads exactly `0%`. That
is "215 of 433 beside 0%", and "it just keeps progressing until it's complete", with no fault
anywhere in the pipeline.

Fixed by reporting `filePercent` as well, and giving the file in hand the headline number and the
main bar while the playlist keeps a thinner bar underneath. The model moved to
`src/core/ytdlpProgress.ts` and is pinned by the replayed capture (21 tests). See **D15**.

**Fixed alongside it, and an independent second cause:** every music download said "Processing"
instead of "Extracting audio" — see F10 — so the longest phase of a music download was unreadable
too.

**Not yet proven:** nobody has watched the new layout during a real 433-item playlist. The Queue row
was photographed with a seeded multi-item job, which renders both bars and the `49% of all 433`
label but is `paused`, so the headline percentage and the speed/ETA line — which draw only while a
job is `running` — are type-checked and built but not seen.

Two theories were built and **both disproved** — do not rebuild them:
* *"`percent` is per-file and the renderer must fold in the playlist position."* It must not:
  `overall()` in `src/main/jobs/ytdlp.ts` already folds it in, and `Runner.progress` merges rather
  than replaces. Doing it again double-counts.
* *"Acceleration hands the download to aria2c, which reports nothing through `--progress-template`."*
  Disproved by a live run against a public sample: bytes **and** speed arrive normally, and no
  `[#…]` aria2 line ever reaches stdout.

Real faults were found and fixed around it (the looping bar, progress on item boundaries, bar
shading), but the report survived them — because none of them was the cause.

The step that finally worked was the one written here as "stop theorising": run the real tool and
replay what it actually prints. It took one capture to rule out the entire family of parser
theories, and the arithmetic gave up the answer immediately afterwards.

**Narrowed (session 26), with evidence.** A direct download through aria2 shows *everything*: a real
download of a 30 MB public sample rendered
`16 connections · 7.6 MB of 29.3 MB · 4.0 MB/s · 5s left`, **25%**, and a bar filled to 25%. So this
is **specific to the yt-dlp path** — which is what the reporter downloads (YouTube music and
playlists) — and is not a renderer fault.

An attempt to reproduce it on the yt-dlp path in the capture harness did **not** get there: a cold
profile took longer than 12 s just to inspect a YouTube URL, so the download never started.

*Read again after session 28:* that aria2 run looked healthy because it was **one 30 MB file** — a
job of one item, where the file percentage and the job percentage are the same number. It was never
evidence that the yt-dlp path was broken; it was evidence that a job of one item displays fine. The
distinction the session-26 note drew (yt-dlp vs aria2) was really single-item vs many-item.

Fixed alongside it: the row printed the byte count twice (`7.6 MB of 29.3 MB · … · 7.6 MB of 29.3 MB`)
because the aria2 stage text repeated what the progress meta already said.

### B2 · Playback is quieter than Spotify and YouTube Music — `Fixed`
Same track, same system volume, same quality: Lumina sounded weaker and duller.

**The cause was not what either side assumed.** Measuring the library found tracks from **-14 to
-5.1 LUFS** — *louder* than Spotify’s target, not quieter. What they also were was **clipping**:
seven of eight peaked above full scale, up to **+5.6 dBFS**. A master that peaks above 0 distorts
on playback, and distortion reads as harsh and flat rather than loud. The 5-plus LU spread between
tracks did the rest.

Fixed by measuring each track once (`ebur128`, stored on the library row) and applying a gain at
playback to reach -14 LUFS, capped so nothing exceeds -1 dBTP. See **D14**.

**Proven:** through the real app — migration applied, ffmpeg ran, results persisted
(`-5.4 LUFS peak +2.8`, `-5.1 / +2.4`, `-11.6 / +2.0`).

**Proven since (session 28):** the toggle has now been photographed. Capture steps
`13b-player-sound` and `13c-player-loudness-off` show the sound panel open over a real track
playing, the checkbox on with its explanation, and then off with the explanation changed — so the
control renders, round-trips through settings and re-renders, mid-playback. The app log for that
run also shows the measurement happening for real:
`Love Me.opus: -11.6 LUFS, peak 2 dBFS, in 3276ms` — a track peaking 2 dB above full scale, which
is turned down 3 dB to keep it under the ceiling.

**Fixed in the same session:** flipping the toggle used to do nothing until the next song, because
`applyLoudness` ran only when a track loaded. A switch that appears inert is indistinguishable from
one that was never wired, so the setting is now re-applied to the track already playing.

**Still not proven:** nobody has *listened* to the result on this machine. The gain is measured,
decided, applied to the graph and photographed, but no ear has confirmed it.

### B3 · Equalizer is not a real equalizer — `Open`
A few named presets and a weak display. Needs proper bands with gain control, a profile system that
can be saved and named, and a display that shows the curve actually being applied.

### B4 · No Like control while playing — `Fixed`
Liking was only reachable from the library, which is the wrong moment. There is now a heart on the
player and an `H` shortcut.

**Proven:** through the real app — a capture run pressed `H` during playback and the `likes` table
went from 0 rows to 1, naming the track that was playing.

Worth recording: `F` was the obvious key and was already Fullscreen. TypeScript allows a duplicate
`case`, so `tsc` stayed green while Fullscreen would silently have stopped working. Found by reading
the switch, not by any tool.

### B5 · Playlists are thin — `Open`
No creation flow worth the name, and no playlist page with a title and description.

### B6 · Parallel downloading is shallow — `In progress`

**The premise was measured and turned out to be wrong.** "More connections" cannot help here: a
40 MB file takes the *same* time over 1 connection as over 16, because the link saturates at about
25 Mbit/s. What actually costs the time is **~4.8 s per item** of yt-dlp working out what to fetch,
serially, while the line sits idle — a 433-song playlist is ~53 minutes, of which ~35 are waiting.

Done: several items of one playlist now download at once (**D19**), which is the only change that
touches the real constraint. ~53 minutes to ~13 at four workers, by calculation.

**Not yet proven:** no real playlist has been run through it. The sharding, the argument building
and the aggregation are unit-tested (21 + 2 tests), but a signed-in profile is needed to watch four
workers actually running. The multi-interface part below is untouched.

Still open — the original, larger ask:
Currently aria2 with up to 16 connections per server. The intent is deeper: genuine multi-connection
scheduling, and **using several network interfaces at once** (Ethernet + Wi-Fi, later mobile data) so
throughput is the sum of the links rather than the best one. That is real engineering — per-socket
source-address binding, per-link health and backoff, reassembly — not a library import. Design
before code.

### B7 · Keyboard operation is incomplete — `Open`
The whole app should be usable from the keyboard, with a discoverable hint in the lower panel and
`Shift+?` for the full list — introduced gradually rather than dumped on the reader at once.

---

## Fixed recently

| # | Was | Fixed by |
|---|---|---|
| F1 | Copying Lumina to a drive died at `ENOENT … app.asar`, ~349 MB of 732 MB | `original-fs` (D9) — verified against the real installed app |
| F2 | Every video in the Library showed a placeholder instead of its thumbnail | `0:v:disp:attached_pic` (D11) — verified from a cold cache, all 8 videos |
| F3 | Music on a USB drive appeared as one folder per song, each holding a `cover.jpg` | Real-album layout (D12) — 383 folders → 42, measured on the real library |
| F4 | A folder `cover.jpg` beside audio was never requested by the UI | Scanner counts a folder image as artwork |
| F5 | The extension bridge reported itself listening when its port was taken | Status from the bound socket (D10) — verified against a real conflict |
| F6 | "Share to TV" drew an *on* switch beside the word "Off" | Distinct "Not working" state (D10) |
| F7 | `location.reload()` did nothing in a packaged build | Navigation guard narrowed to allow reloading the current page |
| F8 | Artwork that failed once kept its placeholder for every later image | Failure recorded per URL, not per component |
| F9 | The Files tab listed aria2's `<infohash>.torrent` bookkeeping | `isDownloaderArtifact` |
| F10 | Every music download said "Processing" instead of "Extracting audio" — 7 of 13 postprocessor labels matched nothing | Real names captured from the bundled yt-dlp (D17); a test forbids the `FFmpeg`-prefixed spellings |
| F11 | Shuffle replayed songs while others never played, and **Previous moved forward** | A kept order plus a cursor in `src/core/shuffle.ts` (D16), 13 tests |
| F12 | "Match the volume of every track" did nothing until the next song | The setting is re-applied to the track already playing |
| F13 | The app refused to start with "Lumina couldn’t start" after a volume above 100% was saved | Two places set the startup volume and only one learned the split; `applyStoredVolume` is now the only way in (D18) |
| F14 | Cosmetic filter rules listing several domains were misparsed | Element-hiding rules separate domains with commas, `$domain=` with pipes; caught by its own test on the first run |

---

## Reopened — the "won't fix" that was too quick

### R1 · A TV with no router could not use Share to TV — `In progress`

Previously filed as won't fix on the grounds that a television cannot run Lumina. That part is
still true and always will be. But it was answering the wrong question: the obstacle was never
"a TV cannot run our player", it was **"DLNA needs a network and there is no router"** — and those
are different problems.

A cable from the computer straight into the television *is* a network. What it lacks is anything
handing out addresses, so the TV reports "no network" and never looks for a media server. Lumina
can be the thing that hands out the address: [src/core/dhcp.ts](src/core/dhcp.ts) (the wire format,
30 tests) and [src/main/dhcp/server.ts](src/main/dhcp/server.ts) (the socket). Link-local adapters
only, so it needs no elevation and changes nothing about this computer’s own network settings.

**Not yet proven, and it needs a real cable and a real TV.** Also recorded honestly: the active
"is anyone already serving DHCP here?" probe **does not work on Windows** — the DHCP Client service
owns port 68, so a probe on a network that certainly has a router came back with no answer. The
real guard is that the person picks the adapter, and only link-local adapters are offered.

---

## Won't fix

### W1 · A TV asks "photos, video or music?" and won't open Lumina's player
That prompt is the television's own firmware, shown for any USB stick. A TV will not boot from USB,
will not autorun anything, and accepts only vendor-signed firmware. See **D6** for the three paths
that do work: HDMI, DLNA, or a well-made USB stick. This cannot be solved from inside Lumina, and
claiming otherwise would be a feature "for show".

---

## Audit of 2026-10-11 — partial: 2 of 15 slices, mostly unverified

An automated audit was started across 15 code slices. Nearly all of it died on a session limit: only
the **queue/scheduler** (32 findings) and the **host-page driver** (40 findings) returned, and the
independent skeptic pass never ran, so **none of the 72 was machine-verified**. The other 13 slices
(aria2, yt-dlp, inspect, bridge/extension, in-app browser, release/verify, renderer download UI, IPC
surface, library, devices, player UI, IDE/sync, shell) were **not audited** — re-run them.

### Checked by reading the code myself (confirmed in the code, not executed)

| Id | Where | Defect | Sev |
|---|---|---|---|
| queue-1 | `queue.ts:207-295` | `schedule()` iterates a stale snapshot and `start()` never re-checks status; a runner that fails synchronously re-enters `schedule()`, so the outer loop can start a job the inner call already started — two runners, first orphaned | high |
| queue-4 | `queue.ts:62`, `aria2.ts:393` | a job interrupted while `processing` (verifying) reloads as `queued`; the finished file has no `.aria2`, so `uniqueName()` picks `name (1).ext` and the whole file downloads again | high |
| queue-5 | `index.ts:286-287`, `aria2.ts:469` | quit fires an async `forceRemove`, then `aria2.stop()` kills the daemon immediately — control files may not flush, so resume turns into a duplicate | medium |
| queue-6 | `queue.ts:211` | jobs waiting for a hidden-page slot or a human check hold a download slot (`running`) and can starve the queue | medium |
| queue-8 | `queue.ts:126` | auto-retry classifier is bare substrings over message + stderr: `500` matches “500 MB”, `eof` matches inside words | medium |
| queue-15 | `queue.ts:297-315`, `ipc.ts:532` | every progress tick persists and IPC-broadcasts the whole `Job` including `source.entries` (433 entries on a big playlist) | medium |
| queue-22/23 | `power.ts:41-52` | “when downloads finish” ignores jobs awaiting auto-retry, any dialog error falls through to sleep/shutdown, and the queue is not re-checked after the countdown | high |
| queue-24 | `queue.ts:81` | `add()` never de-duplicates; the same link pasted twice runs as two parallel jobs | medium |
| hosters-3 | `core/hosts.ts:80-135` | a solved check widget stays visible, so `captcha` stays true and the driver never clicks on | high |
| hosters-6 / E7 | `core/hosts.ts:93`, `hosters.ts:378` | “you have to wait …” counts as `blocked` and throws before countdown handling — wording-dependent, **not reproduced** | high |
| hosters-8 / E4 | `hosters.ts:69` | fresh cookie jar per link, so every file on a host needs its own human check | high |
| hosters-9 / E5 | `hosters.ts:263`, `aria2.ts:424` | all cookies, including any Cloudflare clearance, replayed to aria2 — conflicts with AGENTS.md rule 1's spirit | medium |
| hosters-15 | `hosters.ts:337` | a failed page load is only logged at debug; the person is prompted after 60 s instead of seeing the error | high |
| hosters-26 / E6 | `aria2.ts:390-411`, `inspect.ts:71` | the host's real filename is discarded; extension-less links save as `download` | high |
| hosters-1 | `hosters.ts:255` | `sleep()` only listens for abort while sleeping; a cancel landing during `executeJavaScript`/click is missed | medium |
| queue-13 (partly) | `queue.ts:270` | completion strips cookies but not captured `Authorization` headers; failed/cancelled jobs keep both | medium |

### Raised by one finder pass, **not verified** — treat as leads

**queue** — high: queue-2 exception in `start()` (work-dir `mkdir`) escapes `schedule()` and blocks the queue; queue-7 a failing sqlite write aborts `complete()`/`fail()`. medium: queue-3 stale `RunnerContext` callbacks hit the next run; queue-9 “Retrying in N min” has no timer after restart; queue-10 stale `outputPaths` let a failed retry look completed; queue-11 cancel/remove of paused/failed jobs leaves partials and cookie jar; queue-12 work-dir recomputed from live settings; queue-14 throttle drops the trailing update; queue-16 jobs can start before tools are probed; queue-17 Mark-of-the-Web skipped for torrents/ftp/unpacked files; queue-28 a corrupt `lumina.db` blocks startup. low: queue-18/19/20/21/25/26/27/29/30/31/32.

**hosters** — high: hosters-2 first download the page triggers is accepted with no scheme/type/size check. medium: -4 invisible reCAPTCHA badge treated as a check; -5 Cloudflare's self-resolving interstitial opens a Quick check at once; -7 dead-file detection off once the check is shown; -11/-12 parked pages hold slots up to 15 min and may never hand the turn on; -16 scanning skipped while `isLoading()`; -17/-18 navigation guard bounces legitimate hops and acts after the foreign page loads; -19 `window.open` denied outright; -21 `placePage` reloads the page on every re-show; -22 Quick check covered by the in-app browser's native view; -24 POST / `blob:` / one-time links break when re-requested by aria2; -25 no per-host concurrency or cooldown; -27 cross-site “Download” anchors clicked repeatedly; -28 countdown detection both too loose and too narrow; -35 the self-test “several connections per file” cannot fail when parallelism is fake. low: -10, -13, -14, -20, -23, -29 to -34, -36, -37. legacy crawler (dead code): -38, -39, -40.

Full finder output (scenario, evidence, suggested fix per item) is in the workflow journal for run
`wf_96486c51-b2c`; re-audit rather than trusting it blindly.

## Not proven — untested, not passing

* **15 IDE and editor-theme capture steps** photograph the same "Open a folder to start editing"
  screen because the capture profile has no workspace. Give it a `settings.json` with `ide.workspace`
  set before trusting them.
* **`18b-portable-edges`** matched `18a`, so the portable install edge cases behind it are unverified.
* **A real television.** Every TV claim rests on a protocol probe, not a TV.
* **The portable copy running on a second PC.**
* **Cancelling a copy or conversion mid-way**, and a drive filling during a copy.
* **The Queue row while a multi-item job is actually running.** The two-bar layout was photographed
  from a seeded `paused` job; the headline percentage and the speed/ETA line draw only for a
  `running` job and have not been seen.
* **A real playlist through the parallel downloader.** Unit-tested throughout; four workers have
  never been watched running against a real playlist.
* **The shield against the real web.** Verified against a local page carrying two known trackers —
  both blocked, correctly classified and named in the panel — and measured against the real
  EasyList + EasyPrivacy (115,598 rules, 50 µs per request). No real ad-funded site has been loaded
  through it, so nothing is known about how often it breaks a page.
* **Anyone listening to the 200% boost.** The limiter is verified by its settings, not by ear.
* **Shuffle end to end in the app.** The order, the history and the wrap are covered by tests
  against a seeded generator, but nobody has pressed Shuffle and then Previous in the running app.
