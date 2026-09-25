# Bugs and backlog

Honest status only. Something is **Fixed** when the real path has been run and the result looked at —
not when the types check. Anything believed-fixed but unverified says so.

Status: `Open` · `In progress` · `Fixed` · `Won't fix` · `Unexplained`

---

## Open — reported from live use

### B1 · Downloads show no usable progress — `Fixed`
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
