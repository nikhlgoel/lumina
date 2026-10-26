# Lumina — Session Log

Append-only, newest entry at the top. Each entry: date, what changed, commit(s), verification, and what's next.
Read [HANDOVER.md](HANDOVER.md) first for the rules and full project state. **Update this file every session.**

---

## 2026-10-27 (48) - Play a link without downloading it, and the lighter link bar

Owner approved the mockup ("Yes, build the lighter link bar with Play beside Download exactly as drawn, including streaming the link into the
player"). Nothing committed.

* **Design.** A link is resolved in the main process to a *plan* (`src/core/streamPlan.ts`, pure, 19 tests) kept in memory (cap 24; it holds the
  site's headers and cookies, so the page only ever sees a token). Two shapes: `proxy` (one progressive file the browser can decode, passed through
  with its Range requests, so seeking is the server's) and `pipe` (HLS/DASH, video and audio as separate files, or a container Chromium can't
  open: ffmpeg copies it to a fragmented MP4, seek restarts it at an offset like the existing `remux`). New IPC `media:play`
  (`main/media/streams.ts`), new `lumina-media://stream/<token>` route, and `remux/stream-<token>` for the pipe. The player starts in pipe mode
  when `PlayableItem.pipe` is set. `ffmpegResponse` (shared with the old file `remux`) now pauses ffmpeg's stdout when the player has all it
  asked for; before, a fast source would have piled a whole film into memory.
* **UI as drawn.** Idle: smaller heading, one muted line, one 52 px bar with icon-only Torrent/Paste, then Play and Download; the dashed
  drop box is gone (a hint line says a .torrent can be dropped anywhere). After a link is read: X in the bar, a card with thumbnail, title, one
  meta line (`core/linkMeta.ts`, 7 tests), a quality select + folder, Play and Download; everything else is behind "More options" (the playlist
  picker stays visible). Torrents and file-host pages get no Play (nothing to stream until downloaded).
* **A real bug found by playing a real link.** Apple's public HLS test stream lists no resolution, and `parseStreams` only counted a format as video
  if it had a height. Its video variants vanished, the only audio variant was left, and the link was read as **music**: Play asked for audio, and a
  download would have saved audio only. A format with a video codec and no height is now a video stream with height 0 (`core/streams.ts`, test in
  `tests/core.test.ts`).
* **Measured in the real app (offscreen, `LUMINA_PROBE_PLAY`; the probe types the link, presses Play, then reads the player's clock twice, presses
  →, and pauses at the end).** archive.org mp4 (passthrough): 320×240, clock 7.7→11.9 s, → jumped about 5 s. Wikimedia webm (passthrough), from the
  bar and from the result card (the card hands main the already-read info; the log says "already read"): 640×360, clock advancing, seek ok. Apple
  HLS (pipe): 960×720, clock advancing, seek restarts the pipe at the offset. Akamai DASH, video and audio as two sources (pipe): 1024×576, clock
  advancing. A public mp3 (passthrough, music view): slider advancing. A photograph of the playing video was looked at.
* **Known limits, measured.** A DASH *manifest* is slow to open: ffmpeg took 9.0 s to the first byte at the start and 12.8 s / 21.1 s when starting 25 s /
  120 s in (timed by hand; smaller `-probesize`/`-analyzeduration` changed nothing: 9.0 s both ways). Progressive files and HLS are quick. A
  playlist plays its first item. A live stream is refused in words. YouTube from this clean profile hit its "confirm you're not a bot" check, so
  **YouTube's own separate-streams case is unverified** (the DASH sample above exercises the same two-source path); Lumina says "YouTube wants a
  sign-in check" and does not try to get around it.
* **Harness.** The input's label is now "Link to play, download or search"; the capture steps look for the prefix "Link to" (commit `c49cec6` renamed it
  once and three steps failed silently). `LUMINA_PROBE_PLAY=<url>` (+ `_PLAY_WAIT`, `_PLAY_FROM=card`) is documented in `capture.ts`.
* **Verification:** `tsc` clean · `vitest` 1164 passed (64 files) · `vite build` ok. Not done: not heard by an ear (the window is offscreen), the
  multi-network ask (see 47), a sleep/wake while streaming.

---

## 2026-10-27 (47) - Links of every kind through the real app; calmer waiting and error colours

Owner's ask: make it download from any kind of link; use one supplied link only to understand why it failed ("do not play the
video"); calmer colour for reconnecting/restored; a lighter link bar with Play; use all networks. Nothing committed. BUGS B13.

* **The supplied link was not downloaded.** AGENTS.md rule 2 forbids content of unknown licence even as a test, and it was not needed: the
  log already had it failing with curl (35) reset and (28) timeout. A no-content check (DNS + a bare TCP connect, nothing requested): this
  network's DNS returns an address for the site that never answers, while two ordinary sites connect. A network-level
  block, not Lumina. No bypass was built; the error now says so and points at Settings › Network.
* **14 kinds of link measured** with the new `scripts/dl-lab/link-matrix.mjs` (real app, lawful samples). Direct, `download.*` zip, 2×HLS,
  DASH, archive.org (page and audio), `.torrent` URL, **magnet (a real public swarm, 123 MB at 11 MB/s)**, Wikimedia page: all fine at
  22–44 MB/s (link-limited). Vimeo needs a sign-in (said plainly now).
* **Two real bugs found by it:** (1) a 404 on a file link started the file-host click-through flow and waited for a person; (2) a web page
  whose address ends in `.webm` was taken for a file host. Both in `inspectDirect`'s caller: any failed probe meant "a web page". Now a
  404/410 or network error is reported at once, and yt-dlp's site-specific extractors are tried before the click-through.
* **Wording and colour:** curl errors and yt-dlp scaffolding turned into sentences (`plainCurlError`, `tidyYtdlpMessage`); a
  network-type read failure is an amber "couldn't reach that site" card; a job waiting for the network sits with the active ones, in amber
  (`isWaitingForNetwork`); Node's nested error codes are read (a refused connection says so). Photographed: amber card, amber waiting row.
* **Not built (visible or unverifiable):** Play from the link bar + a lighter bar (mockup shown, awaiting a yes); multi-network. This PC has
  one real uplink (Wi-Fi), so nothing could be measured; and on Windows a socket bound to one adapter's address can still leave through
  another, so real bonding needs `IP_UNICAST_IF` in a small native helper (or route changes, which need admin).
* **Flake seen, not mine:** `tests/syncCrypto.test.ts` "single-char typo" failed once in a full run and passed 8 of 8 reruns (a random
  seed whose flipped character the checksum sometimes accepts). Left alone.
* **Verification:** `tsc` clean · `vitest` **1136 passed (62 files)** · `vite build` ok.

---

## 2026-10-26 (46) - Queue rows built from the approved mockup (D1–D3, D11)

Owner approved the mockup drawn in this session ("build it exactly as drawn"). Nothing committed. BUGS B9.

* **Rules in `core/jobDisplay.ts`** (22 tests, `tests/jobDisplay.test.ts`): unknown size ⇒ bytes in the number slot, "size not announced", a
  looping bar; paused ⇒ "1.2 GB of 1.9 GB" and a muted percent; finished ⇒ size, time active, average speed (downloads only; "took" ≥ 1 s,
  average ≥ 2 s); one chip at most (waiting for network > reconnecting > writing to disk > "N connections").
* **New data:** `JobProgress.connections`/`activity`, `Job.summary`, `engineState.activeMs` (all optional, so stored jobs load). The queue
  now times how long a job is *active* (not queued, paused or waiting), stores a summary when it completes (size on disk, bounded walk),
  and clears a stale "waiting" mark. aria2 reports `connections` and `activity`; its status word is now plain "Downloading".
* **A flaw in my own design, caught while photographing:** the "Reconnecting" chip would have cleared on the very next poll even while
  still stalled. It now stays while `stall.steps > 0` (recovery ran, no bytes since).
* **Photographed in the real app** (harness probe `LUMINA_PROBE_ROWS`, three local servers): unknown-size, paused 18% and finished rows
  match the drawing; finished read "Done · 41.0 MB · 11 s · 3.6 MB/s average"; the amber "Waiting for network" chip on a real dropped
  connection. **Not photographed from a real run:** "Writing to disk", "Reconnecting".
* **Seen, not changed (visible, needs a yes):** a job waiting for the network is listed under "Finished" with its message in red.
* **Verification:** `tsc` clean · `vitest` **1129 passed (62 files)** · `vite build` ok.

---

## 2026-10-26 (45) - Reading the installed build's log, stability pass on the desktop engine, graceful quit

Owner's ask: stop working on the TV; the friend's copy (the 25 Sep release) had a lot of downloader bugs; read the log, fix
everything stability-related, verify, report. Nothing committed. Full table with evidence: `BUGS.md` B12.

* **The log** (`%APPDATA%/lumina-media/logs/lumina.log`, 10,254 lines, written by the *installed* build): grouped by message. Most
  of it is old (915 aria2 poll failures are one day in September). Still true in the current code: the volume schema rejecting
  boost (90×), a PowerShell started every 5 s forever (41 failures with stack traces), RPC timeouts on `addTorrent`, raw
  `fetch failed` / `aborted due to timeout` / `aria2c exited with code 22` as failure text (and `fetch failed` never retried),
  corrupt-tag artwork re-parsed 491×.
* **Found by reading, not in the log:** no `uncaughtException` / `unhandledRejection` / `render-process-gone` handling at all
  (`crashGuard.ts`, `core/crashPolicy.ts`); the log only rotated at start-up; and the code that removes an "unresumable partial"
  would have deleted a **pre-existing file** when aria2 refused with "control file does not exist" (guarded now).
* **Quit was not graceful:** `queue.shutdown()` fired each runner's async stop and the next line killed aria2, so no control
  file was written. Measured with real aria2 (`scripts/dl-lab/quit-and-resume.mjs`): killed 3.5 s in, the restart began again
  from zero; shut down with `aria2.shutdown`, it resumed with `Range: bytes=22036480-`. Quit now waits (≤ 4 s + 3 s), and
  `--auto-save-interval=10`. My own first test reproduced the log's exact `errorCode=13 … control file` message by killing aria2.
* **Verified in the real app** (offscreen harness, scratch profile, local servers): a 300 MB direct download byte-exact; quit
  mid-download wrote a 396-byte control file; **a 120 MB torrent from 3 seeders capped at 1 MB/s each ran at ~3.1 MB/s, "3 seeds
  · 3 peers", SHA-256 identical to the source**; a 30 s server outage waited, resumed ~5 s after the server returned and never
  went backwards in percent (157,286,400 bytes); a forced renderer crash was logged and the window reloaded; full 82-step capture
  ran with 0 script failures (identical screenshots: the IDE steps without a workspace, as documented; `17a/17b` because port
  8200 was held by the owner's own Lumina, so the toggle correctly failed; `16/17` both light).
* **Test-rig mistake worth keeping:** my new multi-seeder rig crawled at 80 KB/s and I first suspected Lumina. A plain aria2c
  leecher crawled too; the seeder's own log said "Checksum error detected". `fs.writeSync(fd, string, 0, 'latin1')` takes the 0 as
  the file *position*: the data file never grew past one block. The old scratch rig had the same line and only worked because its
  file pre-existed. Rigs now live in `scripts/dl-lab/` with a README (this was Phase E).
* **TV:** `LyricsLog` writes one block per lyrics lookup to `<external files>/lyrics-matches.log` (title, channel, length used and
  where it came from, every variant, every LRCLIB candidate with its own title/artist/length and why it was chosen or refused).
  Observation only; matching is unchanged. 173 Kotlin tests pass; **not run on a device**.
* **Verification:** `tsc --noEmit` clean · `vitest` **1107 passed (61 files)**, from 1061 (46 new) · `vite build` ok (16 MB, 96 chunks).
  A local installer was built into `release/candidate/` (322,926,814 bytes, **unsigned**; the 25 Sep installer in `release/` was
  left alone). The unpacked packaged build was started hidden with a scratch profile: window, tray and all six bundled tools came up.
* **NOT proven:** the installer itself (installing it); real sleep/wake; a real swarm or the owner's large game torrent; a real 20 GB
  torrent for the 90 s add limit; the yt-dlp accelerator fallback (needs a server that makes aria2c exit 22); the corrupt-tag
  cover fallback; the Fire TV keyboard and the lyrics log on a device; the graceful quit when quitting through the tray menu or the
  Windows shutdown path (the harness quits through `app.quit()`).
* **Open from the plan, needing the owner's yes first (visible):** Queue row D1–D3 (unknown total, paused/finished rows), D11
  (connection/status chips). `formatBytes(0)` still prints "—" (D4): changing it affects every caller.

---

## 2026-10-23 (44) - Rest of Phase B: torrent ENOSPC, magnet cancel/retry, Cancelling, stray .torrent

Plan: `docs/19_DOWNLOADER_IMPROVEMENT_PLAN.md` S1, S9–S11. Nothing committed.

* **Torrent ENOSPC (real 300 MB drive):** with the space check on, filling the drive just *pauses* the torrent and it resumes
  when space is freed (completed, 272,629,760 bytes). To reach the engine's own error path I disabled the check once
  (temporary switch, removed): failed at 63.7% with a readable message, Retry resumed, **byte-identical**.
* **Magnet cancel/retry found two real bugs.** (1) `stop()` removed only the first of aria2's two downloads, so cancelling
  just after the metadata arrived left the real download running unseen (259 MB written after "Cancelled"; Retry failed
  with "InfoHash … is already registered"). Now removes everything `followedBy` too. (2) The row read 100% during the
  metadata phase (`isMetadataPhase`, `tests/torrentPhase.test.ts`). After the fixes: cancel mid-download ⇒ empty folder that
  stays empty for 30 s; retry completes.
* **Stray `.torrent`:** not `bt-save-metadata` at all — aria2's `rpc-save-upload-metadata` saves every RPC-uploaded .torrent
  as `<SHA-1 of the file>.torrent` (not the info hash). Turned off. A magnet's own `<info hash>.torrent` copy is kept for resume
  and cleaned up on cancel/complete (best effort while seeding). Also enabled `--bt-load-saved-metadata`, which was missing, so a
  resumed magnet no longer re-fetches its metadata.
* **Cancelling state:** a cancelled job stays "running" with "Cancelling…" until cleanup is really done (files deleted with
  retry, because Windows refuses to delete a file aria2 still holds), then becomes "Cancelled"; Retry is not offered before that.
  `isCurrent()` now also ignores a cancelling job's late callbacks.
* **RETRACTION:** the "cancel cleanup lags ~5 s" claim from entries 41/43 is wrong. With absolute timestamps the files were
  gone within 150 ms. The watcher's clock started ~5 s before the app's. The generation guard and the Cancelling state stay as
  defensive measures, not as fixes for a proven problem.
* **Rig mistakes worth not repeating:** I took a saved file's name for the info hash (it is the SHA-1 of the *file*), so my
  first magnet tests were refused by the seeder; the seeder must be started and hashed before the leecher arrives; Windows
  paths are case-insensitive (`t2` = `T2`); a "warm-up" run left a control file that made the seeder serve nothing.
* tsc clean, vitest 1061/1061, build ok.
* **Not proven:** a real swarm / real tracker (everything is one local seeder); magnet copy cleanup after a long seed; a real
  mid-piece ENOSPC with the check on (it pauses first).

## 2026-10-23 (43) - Phase B: outages, sleep/wake, and a silent-corruption bug in resume

Plan: `docs/19_DOWNLOADER_IMPROVEMENT_PLAN.md` (S2, S3). Nothing committed.

* **Measured first.** Local range server (`serve2.mjs`: throttle, scheduled outage, optional content change, ETag/If-Range).
  Outage 10→80 s: the job failed at ~29 s, then waited fixed 30 s / 2 min timers and resumed at **199 s**; three tries
  (≈12.5 min) is the whole budget, so a longer outage ended as permanent "Failed". The label said "Retrying in 1 min"
  for 30 s, and failed rows never show the stage text at all.
* **Silent corruption found.** File changed during the outage ⇒ resume appended new content to the old partial:
  80 MiB old + 170 MiB new, status "Done". aria2 sends no `If-Range`; the size was identical.
* **Fixed:** `core/resumeCheck.ts` (validators: parse/compare, 10 tests) + `main/resumeProbe.ts` (one-byte ranged GET) +
  a check in `aria2.ts` before a resume; changed ⇒ delete partial and restart, unreachable ⇒ fail as a network problem
  so the retry re-checks. Skipped for proxies and file-host links. Result: 0 old / 250 new MiB.
* **Fixed:** `core/networkRetry.ts` (classify network/transient/permanent, probe schedule, labels, 9 tests) + queue waiter:
  network failures wait for the connection with no try-cap (6 h limit), probe the URL, resume the moment it answers;
  `powerMonitor` `resume` asks immediately; no "Download failed" notification for a job that will retry itself. Also
  "503 Service Unavailable" no longer classed as permanent (old regex matched "unavailable").
* **Proven on the real runner:** outage → resumed at 94 s from 26% (was 199 s); simulated wake resumed 5 s after the
  server returned; outage + changed file → waiting, restart, all-new content. tsc, vitest 1058, build ok.
* **Not proven:** a real sleep/wake (only the event path); torrents after sleep (the 60 s stall ladder covers them, no
  wake nudge); yt-dlp's own resume; hosted links; behaviour through a proxy (validation skipped).

## 2026-10-23 (42) - Real full disk, display audit, and the improvement plan

Plan and evidence: `docs/19_DOWNLOADER_IMPROVEMENT_PLAN.md`. Nothing committed.

* **Real full disk** (owner made `V:`, a 300 MB NTFS VHD): direct download failed cleanly in ~8 s but showed Windows' raw
  text, and Retry made `big (1).bin` beside an orphaned 111 MB partial and died of the same space. Fixed:
  `friendlyAria2Error` knows "not enough space"/ENOSPC (+ trims line breaks); an unresumable partial (no `.aria2`) is
  deleted when the job fails. Re-run: friendly message; Retry after freeing space completed under the same name.
* **My own check was wrong:** the torrent space check counted received bytes, but a non-sparse file's gap is zero-filled
  and allocated at once, so it blocked a torrent that fit. New `allocatedBytes` in `core/diskSpace.ts`; the 246 MB torrent
  now completes on the 286 MB drive. "Space is available again; resuming" also seen firing after real freeing.
* **Display audit** (code + one photograph): a no-length download shows "0%", an empty bar, no bytes, no ETA while data
  flows. Eleven display faults logged (D1–D11) — none of the *layout* ones changed, they need the owner's mockup approval.
  Fixed the pure ones: `formatEta` ("2m 60s", "59m 60s", "72h", "277777h 46m") and `formatBytes` ("1024 KB"),
  `tests/formatDisplay.test.ts` (9).
* **Research:** aria2 manual read for the options that matter (`--lowest-speed-limit` does not apply to BitTorrent;
  `--bt-stop-timeout` off by default); IDM's dynamic segmentation and qBittorrent's "force reannounce" noted as vendor/
  community claims. Searches for Free Download Manager recovery and browser resume rules found nothing usable.
* **Plan:** `docs/19_DOWNLOADER_IMPROVEMENT_PLAN.md` — display truth first, then failure survival, then speed.
* tsc clean, vitest 1038/1038, build ok. New capture probes: `LUMINA_PROBE_FULLDISK`, `LUMINA_PROBE_SHOT`.
* **Not proven:** torrent ENOSPC mid-piece; the owner's real RDR2 torrent; anything in plan phases A–E.
* Cleanup: my test files on `V:` and local servers removed. The owner still needs to detach the VHD (steps in the plan).

## 2026-10-23 (41) - Download engine: cancel, retry, full disk

Details in `docs/desktop-services-plan.md` ("Cancel, retry, full disk"). Nothing committed.

* **Worked as is:** pause/resume continues, cancel removes partial + control file, retry restarts and completes —
  for a 2 GB direct file and a 120 MB torrent (real runner, folder watched from outside).
* **Gap found and fixed:** a torrent bigger than the disk had no check at all. New `src/core/diskSpace.ts` + a poll check
  in `aria2.ts`: it pauses with the reason and resumes when it fits (proven: 205 GB torrent on 77 GB free paused, picking
  the 5 GB file resumed it in 3 s). Direct-file pre-check also seen working (95 GB on 77 GB free, instant failure).
* **Defensive change:** per-job run number so a cancelled run's delayed cleanup (≈5 s measured) can't delete the files of
  an immediate Retry. I could not make that race fail, so this is not proven to fix anything.
* **Mistakes in my own tooling, not the app:** two fake-torrent generator bugs, a hung `python` fallback, and a probe
  step ordered before the point it needed. Noted so they aren't mistaken for app faults.
* **Not proven:** real mid-write ENOSPC (needs an elevated prompt to make a small VHD; recipe in the plan), magnet
  cancel, retry after a real disk-full failure.

## 2026-10-23 (40) - Download engine: the "fine for minutes, then 0 B/s, never restarts" stall

Owner redirected to one thing at a time: downloading, normal/parallel/torrent. Details and numbers in
`docs/desktop-services-plan.md` ("Download stability"). Nothing committed.

* **Evidence first:** the owner's `lumina.log` shows aria2's RPC going silent after 3–10 min on a 4.2 GB direct file and
  on a torrent, then `aria2 exited (1)` after Lumina's 3-poll restart, repeating.
* **Cause (measured, not assumed):** NTFS zero-fills the gap before a write past the end of a file — one 1 MB write
  20 GB in took 37 s on this disk, 0 ms on a sparse file. aria2 serves RPC on the writing thread, so it looked dead,
  and killing it threw the zero-fill away.
* **Changed:** `src/main/sparse.ts` (new), `src/core/engineWatch.ts` (new: `needsSparse`, `rpcAction`, `stallStep`),
  `src/main/jobs/aria2.ts` (sparse guard, 120 s grace before restarting a live engine, stall ladder),
  `src/main/capture.ts` (`LUMINA_PROBE_URL`, `LUMINA_PROBE_SECS`).
* **Proven on the real runner:** 24 GB local file 188 s with RPC timeouts → 73 s without; torrent rig recovery
  by the ladder; final build byte-identical on a 120 MB torrent. tsc, vitest 1016, build ok.
* **Dead ends worth knowing:** my first "baseline" swarm runs were invalid twice (the scratch seeder wasn't seeding
  until `--continue --check-integrity`; a leftover swarm held the tracker port). A quiet-but-cooperative swarm
  recovers by itself in ~80 s, so that is *not* the owner's failure; the hung engine is.
* **Not proven:** the owner's ~100 GB torrent on their disk; non-NTFS drives; the new status texts on screen.

## 2026-10-23 (39) - Desktop services: honest progress on the yt-dlp + aria2 path (B1)

Working plan and evidence live in `docs/desktop-services-plan.md`. Nothing committed.

* **Reproduced** with the bundled yt-dlp 2026.08.19 + aria2c 1.37.0 and the real `buildDownloadArgs` argv: with
  acceleration on, a download prints one `LUMINA_DL|finished` and no `downloading` lines; aria2's own readout carries the
  live figures and nothing parsed it. YouTube's https formats take this path too (two aria2 runs, video then audio).
* **Fixed in `src/core`:** `progress.ts` parses the readout (`aria2` event) and gains `splitYtdlpLine`;
  `ytdlpProgress.ts` folds the event into the model and completes a stream on `finished`; `ytdlp.ts` splits lines first.
* **A second cause only the app showed:** aria2 ends its last readout without a newline, so yt-dlp's `finished` arrives
  glued to it and was lost; the audio stream never started and the bar fell 49% → 5%. Found by logging the raw line
  inside the runner after the shell run looked fine — a replay of the shell capture could not have shown it.
* **Proven:** `tests/aria2Readout.test.ts` (13, real lines); tsc clean, vitest 1004/1004, vite build ok; a real
  Electron run on a scratch profile (new `probe-` capture step) sampled 37 running states, 0 → 100, no backward step,
  video → audio → merging → completed.
* **Not proven:** the Queue row was not photographed live; readout byte totals are aria2-rounded; native (non-accelerated)
  path not re-run; `CN:` parsed but shown nowhere (a UI change needs the owner's yes).
* **Playlist question settled by code:** one playlist job (`JobRow.tsx:84` is the only `N of M`; groups say `N of M done`).
  The "0%" half cannot be reproduced with current code.
* Added `probe-` support to `src/main/capture.ts` (`LUMINA_PROBE_DIR`, `downloadProbe`). Note `electron .` runs
  `dist-electron`; run `npx vite build` first or the app runs old code (it did, once, and nothing was captured).
* Next: item 2 (parallel playlist downloads: concurrency, cancel, retry, full disk).

## 2026-10-23 (38) - Fire TV: new signing key, and real YouTube/YouTube Music design research

* **Follow-up, same day: the redesign was first reported "done" when it was not.** A first pass changed Library
  chips, Settings tab grouping and added a Related tab, and I declared it finished; the owner opened the stick and
  saw the same app, with the old top bar. I had dropped the sidebar (the main request) because `AppShell.kt`'s
  comment said earlier sidebar designs were rejected. Second pass, built and **seen on the stick**: `ui/SideRail.kt`
  (new) replaces the top bar; `Cards.kt` (square covers, 16:9 videos, duration badge, white ring, no glow);
  `HomeScreen.kt` (one search bar, white chips, small Shuffle); `LibraryScreen.kt` (coloured heading, sidebar picks the
  section); `SettingsScreen.kt` (two-pane, grouped); `NowPlayingScreen.kt`/`VideoScreen.kt` (Song | Video switch,
  Related tab). 135 unit tests pass; zero crashes in the stick's crash log. Mistake to avoid next time: do not
  treat a code comment as the owner's decision, and do not report "done" before looking at the screen.

* **Re-signed for release under a new key.** Created `lumina-tv-nikhlgoel.jks` (RSA 2048, default
  Android passwords, `CN=NIKHLGOEL`) at the owner's request, replacing `lumina-tv.jks` for new builds.
  `tv/keystore.properties` points at it; both keys and `SIGNING-INFO.txt` files are kept in
  `C:\Users\datan\LuminaSigning\` and the backup folder. Built and verified `tv/dist/lumina-tv-0.1.0.apk`
  (v2 scheme, one signer, `apksigner verify` passed). **Not yet installed anywhere** — any stick
  signed with the old key needs an uninstall first.
* **Emulator checks (Google TV AVD, API 34):** found and fixed a bug from the debug build — the video
  player's Settings sheet showed an empty "Quality —" row for saved videos with no quality list; now
  hidden like the Audio/Subtitles rows already were. Fixed in `VideoScreen.kt`, confirmed on screen.
  135 Kotlin tests pass.
* **YouTube Music TV: tried and confirmed impossible on Fire OS as shipped.** Pulled the real
  `YouTubeMusicTVPrebuilt.apk` off a Google TV emulator and separately downloaded the published
  APKMirror release; both installed but both fail identically: logcat shows
  `requires the Google Play Store, but it is missing`, then Fire OS blocks the resulting market-link
  redirect ("External Market links disabled"). Fire OS has no Google Play Services at all, so no APK
  swap fixes this. Uninstalled afterward — nothing non-functional left on the stick.
* **YouTube (video) works natively** on the stick as `com.amazon.firetv.youtube` (a Cobalt build),
  installed from the Amazon Appstore and signed in. Used it live for design research.
  **New: [docs/18_YOUTUBE_DESIGN_RESEARCH.md](docs/18_YOUTUBE_DESIGN_RESEARCH.md)** — real screens
  this time, not just text guidelines like doc 17: the YouTube TV rail's collapsed/expanded states,
  the Library screen's colour-block category pattern (its strongest, most transferable find), the
  watch-page control layout, and Settings' grouped sections, all screenshotted live, signed in, on
  the real stick. Combined with Google's 2020 official YouTube-Music-on-TV blog post (archival, dated,
  labelled as such) and the owner's own current phone YouTube Music screenshots (mobile reference only,
  not TV layout). Closes doc 17 §8's own gap: "nothing was seen on a real YouTube Music TV screen."
  Produces a concrete to-do list against `tv/`'s actual files (LibraryScreen, the rail in AppShell,
  VideoScreen, NowPlayingScreen, Settings) — not yet implemented.
* **Also investigated and declined:** wiping the stick for Google TV (bootloader is locked,
  `verifiedbootstate=green`, confirmed via `adb shell getprop`; no unlock exists for this chip family
  that doesn't mean losing Fire OS entirely); a bootloader-unlock exploit chain for this exact model
  and firmware (researched on XDA — a real, maintained exploit exists for the karat/mantra family, but
  the newest tested build in its compatibility table is one increment behind the stick's actual
  firmware, so it's unverified for this device; not run). Settled instead on the no-root "Home on
  Fire" accessibility-service launcher-swap approach, researched but not yet installed.
* **Not done this session:** no code changes to `tv/` beyond the one-line Settings-sheet fix; the
  design research's §5 to-do list is unimplemented; the re-signed release isn't installed anywhere.

## 2026-10-22 (37) - Fire TV app: one page layout everywhere, a YouTube-style video player, profile picture, playlist page

* **Release signed and installed (2026-10-23).** The release key was created: `C:\Users\datan\LuminaSigning\lumina-tv.jks`
  (PKCS12, alias `lumina`, RSA 4096, SHA-384 with RSA, valid until 2054, owner `CN=NHHLUUL, OU=Lumina, O=NHHLUUL, C=IN`, the
  country was assumed), with `SIGNING-INFO.txt` beside it holding the passwords and fingerprint
  (SHA-256 `20:C5:E3:9B:...:9A:D1:AF`), and a copy in `D:\main\LuminaSigning-backup\`. `tv/keystore.properties` points at
  it (git-ignored). `bash tv/tools/release.sh` ran the tests, built the minified release, and `apksigner` verified it
  (v2 scheme, one signer, certificate matches the key): `tv/dist/lumina-tv-0.1.0.apk`, sha256
  `48077b89bf3ab82146b645bb37a44c7ef6a1422c240c090142edab41d552a155`. Installed on the stick as `com.lumina.tv` and
  launched once (first-start welcome shown). `pm trim-caches` freed about 215 MB (1.53 GB to 1.75 GB free). The debug
  build `com.lumina.tv.debug` is still installed, with its own saved songs; it was not removed because that would delete them.
  **Both key copies are on this PC: put one on a USB drive or in a password manager.**

* **Later in this session (verified on the stick unless marked).**
  * **Home categories:** each account playlist is classed music / video / mixed from the YouTube category of its first 20
    videos (`PlaylistKinds`, `AccountPlaylistsRepo.kinds`, cached on disk); "Liked videos" is always video. Seen: the Videos
    chip lists only Liked videos and Training. The Music chip was not looked at.
  * **Lyrics:** why "null"/"No lyrics" appeared: every failure (a dropped connection, a 429) showed as "no lyrics", the
    song length was read before the player knew it, and LRCLIB was asked one way only. Now: exact LRCLIB lookup, then
    field search, then word search, under every plausible reading of the YouTube title/channel (`Lrc.queryVariants`),
    then lyrics.ovh (plain only, no length check, so it can return another version); a 429 waits once; "none exist" and
    "could not ask" are different answers with a Try again button. Tested sources from the PC: NetEase now returns
    encrypted search results and Lyrist/Textyl failed, so they are not used.
  * **Other-language songs:** each line as written, then in Latin letters when the script is not Latin, then English
    (`LyricsTranslator`: the free endpoint Google's Chrome extension uses; undocumented, so it may stop working; the screen
    says the English is machine translated; done once per song and cached). Seen on the stick with a Hindi song.
    Romanised-Hindi lyrics are translated using the language voted from all lines; not seen on the stick.
  * **Music screen:** artwork large in the middle; one bottom block (progress bar with times, title left, Previous/Play/Next
    centre, Lyrics/Up next/Like/More/Watch right); after 4.5 s everything but the picture fades and the picture grows.
    Lyrics fill the screen over the artwork behind a translucent veil and fade down to the words. The old drifting cover
    and bouncing bars are gone (nothing animates while the controls are hidden).
  * **Audio:** measured `dumpsys media.audio_flinger`: HDMI, 48 kHz 16-bit stereo, underrun counters 0, so the output path
    is not the problem. Changed: audio buffer 0.5-1 s (was the default 0.25-0.75 s), decoder fallback on, sink errors logged
    (`adb logcat -s LuminaAudio`). **Not proven by ear** that broken sound is gone.
  * **Splash:** none existed before (the earlier concept was never built). Now `ui/Splash.kt`: six copper facets fly in
    spinning and snap into a gem, which winks; a light sweep, a ring and sparks burst out; LUMINA rises letter by letter;
    fades into the app (built underneath; keys are ignored meanwhile). The first light version was replaced at the
    owner's request. Seen: the finished gem with the letters rising; **not seen**: the fly-in and the burst (screenshots too slow).
  * Tests: all pass (new: `PlaylistKindTest`, `LrcVariantsTest`, `InitialsTest`).
  * **More settings (2026-10-23).** Settings now has eight tabs. New **Sound**: streaming audio quality (Best / Balanced
    up to 128 kbps / Data saver up to 64 kbps, never refusing to play if nothing is that small; downloads keep the best),
    equalizer presets (Off, Bass boost, Vocal, Treble boost, Bass and treble, through the system equalizer, capped at 6 dB, and
    silently off on a device without one), audio buffer (Standard 0.5-1 s or Large 1-2 s, read at start), and a read-out of
    where the sound goes (HDMI, 48 kHz). Playback: subtitle size. Music: translate lyrics, Latin letters, clear lyrics cache.
    New **General**: hide-controls delay (3-20 s, used by both players) and the opening animation on/off. Tests: 135, all pass.
    Seen on the stick: the Sound, Playback and General tabs and the audio read-out. **Not tried**: changing the equalizer
    (whether this Fire OS build's equalizer works is unknown), the Large buffer, Balanced/Data saver on a real song, and the
    lyrics toggles.

* **Why.** The owner found Settings, Playlists and Downloads still in the old layout (loose buttons and paragraphs, a box
  per playlist, buttons beside each box) while Library had been fixed, and the video player old and missing audio and
  subtitle languages. Standing instruction from this: when a design is corrected, correct it everywhere, and check every
  page without being told.
* **Shared page kit (`ui/PageKit.kt`).** `TabBar` (the row of tabs/actions every page opens with), `Panel` + `PanelRow` +
  `PanelDivider` (one surface of divided rows), `PanelInfo`, `SectionHeading`, `PanelNote`, `panelShape` (rounds only the
  outer ends so a lazy list draws as one panel). Library, Settings, Playlists and Downloads all use it now.
* **Settings** is six tabs (Storage, Playback, Music, Streaming, Updates, About), each a panel of divided rows with an
  icon, a title, one line of explanation and the current value at the right. The country picker is a scrolling grid
  that opens on the current country (it used to be an unscrolled stack of buttons).
* **Playlists** is a Library-style grid: actions in one row on top, covers underneath, "Kept on this device" below.
  Per-playlist actions (play, sync now, music/video, stop keeping) moved into a dialog opened by holding Select on a
  cover, the same gesture Library uses to delete. **Downloads** is one panel of divided rows with an info line.
* **Playlist page (`ui/PlaylistScreen.kt`).** Select on any playlist card (Home or Playlists) opens a page: cover, name,
  facts (song count, total length, source, on this device), Play all / Shuffle / Keep on this device, and every song in
  order to pick from; Select on a song plays from it and queues the rest. The song being played is in the accent colour.
  Back returns to where you were. Track durations are blank for account playlists (the YouTube API call used does not
  return them); not fixed.
* **Profile picture.** The signed-in account's YouTube channel picture (new `YouTubeApi.myChannel()`) sits at the right end of
  the top row; without a sign-in, the initials of the name typed at a first-start welcome (or changed later from the
  picture) are drawn on the accent colour (`core/Initials`, tested). Select on it: sign in / sign out / change name.
  First-start welcome asks for a name, offers sign-in, or skip; asked once (`AppSettings.onboarded`).
* **Video player rewritten on YouTube's model (`ui/VideoScreen.kt`).** Title and channel at the top; progress bar; round
  Play/Pause with Previous/Next on the left; CC and Settings on the right. Settings is a sheet at the right edge with
  Quality, Playback speed, **Audio language**, **Subtitles**, Listen only, Download and Stats for nerds, each opening a
  list with a tick on the current choice. Audio: tracks grouped by language, original first (never a dub chosen only for
  bitrate); a language other than the original needs a picture-only stream plus that sound, so the quality may step
  down one level. Subtitles: every caption track the video has (written before auto-generated, the last-used language
  first, English next, capped at 12), the choice remembered in `AppSettings.subtitleLanguage`. New tests for both
  rules (`SubtitlesAndAudioTracksTest`, `InitialsTest`): 134 Kotlin tests pass.
* **Verified on the stick:** the profile picture at the top (it showed the real channel photo), the playlist page
  (cover, name, facts, actions, song list), the Library tab row. **Not verified:** the video player on a real
  multi-language video (audio switch, subtitle switch, the settings sheet), the first-start welcome, the rename and
  sign-out dialogs, the playlist options dialog, Back from the playlist page, and Settings tabs and Downloads with
  active jobs on the stick.
* **Stability run (release build, before these changes):** 0 crashes in the whole run, 1 audio underrun, memory flat over an
  8-minute soak with a skip every 25 s (PSS 171-181 MB). Playback state showed *stopped* at minutes 7-8 of the soak;
  not explained (the queue may simply have ended). During the real-video segment frames were 18-25 ms (the video decoder
  and the page compose together); not investigated.
* **Problems seen:** the stick becomes very slow after hours of use (about 650 MB swapped, screenshots taking a minute or
  more), which cost much time in checking; a debug build cold-starts in 8 s (the release build's 1.4 s is the real
  figure). On Home, when a lower row is focused the row above leaves a clipped strip of captions under the filter
  chips: not fixed.

## 2026-10-22 (36) - Fire TV app: smoothness, one accent, a rebuilt Home and Now Playing, speed dial, country shuffle

* **Why the screen "shook" (measured, not guessed).** `dumpsys gfxinfo` showed a median 69 ms frame (100% janky), debug
  and release alike. Switching pieces off from the command line (a temporary `--es perf` extra, since removed) showed each
  of four things cost 8-21 ms of GPU work and added up: the full-screen backdrop (two radial gradients plus ~45 large
  stroked arcs, redrawn every frame), the focused card's elevation shadow, the card clip, and a looping background drift.
  Fixes: the backdrop is painted once off the main thread into a bitmap and cross-faded when the tint changes; the
  glow is two translucent rectangles; nothing loops. Median frame now 9-11 ms, 90th percentile 24-32 ms.
* **A second cause of "the page jumps":** a lazy list scrolls by whatever nudge the focused card needs, at the same moment
  as the row scrolls sideways. Rows now anchor to one fixed height with one eased move (`rowAnchoredScroll`). Rows that
  load late are keyed placeholders in a fixed slot, so a row appearing above the remote cannot drop focus; first focus is
  re-asked once when the account's playlists arrive, if the remote has not been used.
* **One accent colour.** `LuminaColors.Amber` is now a state-backed accent taken from the cover art (light tone of its
  hue; lavender when nothing plays); the brand amber is only the launcher banner. Focus is a white ring + lift + glow;
  primary buttons take the accent. Background and surfaces are a little greyer and lighter (`#1A1920`).
* **Home.** Cards are wider than tall (250 dp, picture 1.45:1; videos 306 dp so heights match), text sits on the page,
  not in a box. Filter chips (All / Music / Videos / On this device). **Every** playlist on the account shows with its
  cover (new `AccountPlaylistsRepo`, shared with the Playlists page) and a tap plays it straight from the internet; the
  Shuffle shape mixes hits from the country chosen in Settings (`ShuffleMix`, tested). A hero panel that followed the
  focus, and a pinnable **speed dial**, were built and then **removed on the owner's say-so** (the hero lagged behind the
  remote and ate the header; speed dial is wanted later, as a separate piece of work).
* **Now Playing rebuilt:** big accent Play with bare Previous/Next, Like and More, "Lyrics" and "Up next" as text tabs,
  everything else (download, shuffle, repeat, speed, not-for-me) in a labelled More panel, a Watch video pill that
  switches a song to its video at the same moment, controls that fade when idle.
* **Audio.** The player's `onAudioUnderrun` is logged (`adb logcat -s LuminaAudio`). Across idle on Now Playing, three
  rapid skips, five seeks, four pause/resumes and browsing Home while playing: player state stayed "playing" and there
  were **0 underruns**, before and after the changes below. The 1.5-3 s audio buffer added earlier (never proven to
  help) was removed because crackling was reported afterwards; next-track prefetch now runs on one background-priority
  thread. **Not proven:** that the crackle is gone (it cannot be measured from here; it needs a listen), network
  drops, speed changes, audio-to-video switches.
* **Verified on the stick:** frame times, Home layout and first focus, all account playlists with covers, hold-to-pin both
  ways (a pin saved by an earlier run made the first hold read as "Removed"; I briefly mistook that for a double fire
  and removed the handler, which stopped the feature, then restored it), the new Now Playing's layout, Lyrics tab and More
  panel. **Not verified:** the controls' idle fade, Shuffle playback, the country picker, the regenerated launcher banner on
  the real launcher (the image file only), the Library grid at the new card size.
* **The sidebar is gone.** Three designs were shown and none accepted (a glass capsule, an arc of beads, a pill with a
  tray). All sidebar code, the left-edge fade mask and the "bleed" layout that existed only for it were deleted; the logo
  is no longer on any screen. Navigation is now a deliberately plain row of four buttons across the top (`TopNav`), only
  so that every page stays reachable until a design is chosen. Splash screen (a beam/prism/engraved-lines concept) and
  an icon-only Shuffle shape were shown as mockups and are **not built** (not approved). Video player redesign not started.
* 97 Kotlin tests pass (5 new: shuffle mix, countries).

## 2026-10-22 (35) - Fire TV app: USB drives, a living Now Playing, small corrections

* **USB**: see BUGS TV-8 for the hardware fact (a pendrive in the TV's USB port cannot reach the stick). In the app:
  live drive list (volume callback + mount broadcasts), a one-time "USB drive found - use it?" prompt remembered on disk
  (an earlier version kept it in screen state and lost it when the system backgrounded the app on mount), songs on an
  unplugged drive hide instead of failing, Settings explains OTG/portable/FAT32-exFAT.
* **Now Playing is alive**: song tint and accent cross-fade, cover drifts and zooms (clipped, masked to fade into the
  moving background; a measured 6-12 level seam was found by reading pixels and fixed), equaliser bars, lyrics ease in
  size/colour/opacity by distance from the current line, accent from the cover. Poppins now set as the Material
  typography, so unstyled text cannot fall back to the system font.
* **Fixed**: keyboard staying open over the player; video player had no Download; "1 songs"; empty-state wording;
  duplicate headings under the Library tabs; refresh button moved to an icon aligned with the tabs.
* 92 Kotlin tests pass. Not done: playlists you create yourself, a download-all button on a synced playlist, motion on
  the other screens, Settings restyle, splash for the ~5 s cold start.

## 2026-10-22 (34) - Fire TV app: direct play, new Now Playing, lyrics, queue, like/dislike, card grids

* **No more menu.** Tapping a song on Home or in Search plays it straight away and queues the rest of that row
  (Next/Previous work across it, a finished song moves on, an unavailable one is skipped with a short message). The
  Play/Download sheet and every Download button in lists are gone; Download lives in the player. Search results and the
  Library are card rows / a cover grid (long-press a cover to delete, with a confirmation).
* **Now Playing** redesigned: the cover bleeds off the right edge, tinted by its own colours (no framed square); the
  +/-10 buttons are gone (Left/Right on the focused seek bar and the media keys seek); one big Play; Like, Not-for-me,
  Queue, Lyrics, Download, Shuffle, Repeat and a small speed chip. Lyrics (LRCLIB, free, time-synced when available)
  replace the artwork; the queue slides in. Lyrics matching is by cleaned title/artist and song length, so a different
  recording's words are refused; a song LRCLIB lacks (checked: a Punjabi track) says "No lyrics found".
* **Taste**: Liked songs row on Home; "Not for me" hides the song and mutes that artist in Recommended.
* **Smoothness**: the next queued song is resolved while the current one plays; resolved streams cached 20 min;
  steady-state playback measured on the stick (state PLAYING, real-time position, ~44 s buffered ahead). First start is
  still several seconds (extractor on a slow CPU); not measured precisely.
* Focus: after a search, focus moves once to the first result. A "jump to Settings" seen during testing was someone
  using the real remote at the same time, not an app navigation (the app starts on Home with the search bar focused).
* 91 Kotlin tests pass. Not done: add-to-playlist/create-playlist, "download whole playlist" button on the playlist
  view, system media-notification Next for streamed queues, a splash for the ~5 s dark cold start, Settings restyle.

## 2026-10-22 (33) - Fire TV app: calm Home, search bar, 4-item sidebar, faster streaming, debloat round 3

* **Home** rebuilt as rows: greeting, a minimal search bar, three small round quick-action buttons (was three big "Get
  started" banners), Your playlists (with thumbnails), Recommended (related to what was saved; popular songs when the
  library is empty - YouTube has no public "my feed" API), Your music, Your videos. Placeholder cards hold the
  Recommended slot while it loads, because a row inserted above the focused card made the lazy list drop focus to the
  sidebar. Cards have a fixed text height so rows are tidy.
* **Sidebar** is Home, Search, Library, Settings; Library has Music/Videos/Playlists/Downloads tabs. Deleting a song also
  excludes it from every playlist.
* **Scale** comes from the real pixel width (1300 dp design width), so 720p/1080p/4K share one layout. 720p checked on an
  emulator; **4K not rendered** (the emulator ignores sizes above its screen), only unit-tested. Background is dynamic:
  tinted from the playing/latest artwork, with two drifting glows.
* **Streaming**: resolved streams cached 20 min and pre-resolved when a card is focused (500 ms); retries and downloads
  bypass the cache; load control starts playback after 1 s of data; audio output buffer raised to 1.5-3 s. The "music
  pauses when something busy happens" report was NOT reproduced (playback state stayed PLAYING across Home presses), so
  the deeper buffer is a mitigation for CPU/IO starvation, not a confirmed cure.
* **Stick**: disabled Amazon Kids, Photos, MX Player TV (miniTV); JioHotstar is an Amazon-injected promo tile that
  returns after a restart (not removable from the app side). Launcher banner: see BUGS TV-6.
* 84 Kotlin tests pass. Not done: Now Playing redesign (lyrics, queue, like/dislike, add-to-playlist, full-bleed cover,
  no confined artwork box), video search path check, Netflix-style transitions, Search/Library restyle.

## 2026-10-22 (32) - Fire TV app: real stick, playlists/account, redesign, self-update

* **Real stick reached** (ADB over Wi-Fi). Verified: AFTMA08C15, Android 11/API 30, `armeabi-v7a` only, 1.7 GB RAM, ~1.4 GB
  free. Debug APK installs and runs; Home, Playlists and Settings render on it.
* **Debloat of the user's own stick**, each step backed up and logged in `tv/tools/stick-backup/REVERT.md`: uninstalled
  LocalSend, VLC, Pixel Music, Downloader, the "TV File Manager"; disabled Prime Video and Luna (system apps); removed
  YouTube for the user. JioHotstar and MX Player are *not installed* - they are promoted tiles the Fire launcher injects.
  NetMirror, Brave, Steam Link untouched. Amazon telemetry services deliberately left alone.
* **New in `tv/`:** playlist sync (public links + Google account via device flow), phone setup page, `SyncWorker`;
  redesigned Home (hero + rows), smaller rail, Poppins (OFL) type, 0.85 density scale (the stick runs 1080p at 320 dpi,
  so Compose saw 960x540dp and drew everything 2x), ambient background; self-update (`UpdateLogic` pure + 12 tests,
  `Updater`, `UpdateWorker`, dialog + Settings panel). 73 Kotlin tests pass.
* **Not solved:** the launcher banner (BUGS TV-6). Six single-variable experiments ruled out; cause unknown.
* **Not proven:** Google sign-in live (needs the user's own Cloud client), update download/install (no release exists yet).
* A wrong theory worth keeping: "Fire OS caches the tile until a reboot" - disproved, a reboot changed nothing.

## 2026-10-22 (31) - Player fixes (PC) and the Fire TV app (`tv/`)

Nothing committed. Two pieces of work, one folder of new code.

**PC player, all checked by rendering it offscreen** (new capture steps `41a-c`, `42a-h`):

* **Video controls were across the top of the screen.** In video mode the stage is `absolute`, so the dock
  wrapper fell into the empty middle grid row. Pinned to row 3. Now a YouTube-style bar: auto-hides after 3 s
  while playing (rule in `src/core/idleControls.ts`, tested), comes back on any movement or key, never hides while
  paused or with a menu open. Gear menu: playback speed (0.25-2x, `core/playbackSpeed.ts`), subtitles, a *read-only*
  quality row (a file on disk has one quality; a chooser would do nothing), and a **Stats for nerds** panel with real
  numbers (resolution, codec, bitrate, dropped frames, buffer, loudness gain, direct vs ffmpeg). Keys: `K` `J` `L`
  `0-9` `<` `>` `I`, double-click for fullscreen, a brief message in the middle of the picture after each.
  Measured, not assumed: auto-hide true while playing, false after movement, `playbackRate` 1.5 with pitch
  preserved, `>` steps to 1.75.
* **Vinyl.** The old animation was exactly 33 1/3 rpm but stopped dead and spun its own sheen. Now one turn per 2.8 s,
  with spin-up and coast-down (`core/platter.ts`, tested), the sheen stays still, and it runs on the compositor.
  **A probe caught that my first version never started** (`animations=0`): the effect ran once on mount, before the
  record existed. Measured afterwards: 131.5 deg/s against an expected 128.6.
* **Cut-off artwork.** The vinyl label cropped a square cover to a circle (title text lost its corners): now the whole
  picture inside the label. The big cover now sizes to the picture's shape. **Not changed, needs your decision:** the
  "Square artwork" download setting crops YouTube's wide thumbnails to a centre square *inside the file*.
* `AudioContext` asks for `latencyHint: 'playback'` (fewer dropouts). Downloads already default to untouched original audio.
* 991 vitest tests (47 files), `tsc` clean, `vite build` ok. Not heard by an ear, not run in a live window.

**Fire TV app, in `tv/`** (design and the full verified / not-proven table: `docs/15_FIRE_TV.md`; decisions D22, D23):
native Kotlin + Compose, NewPipe Extractor v0.26.5 (GPL-3.0, so `tv/` is GPL-3.0), Media3. Built and run on an
Android TV API 30 emulator: search with the TV keyboard, play, download, offline playback, video with auto-hiding
controls, a video download joined by the on-device muxer (plays as H.264 + AAC), release build with R8. 29 Kotlin tests.
The PC app and the TV app share one tested contract: `shared/contract/portable-names.json` (generated from the PC
functions; 30 vitest cases and the Kotlin `FileNamesTest` both read it).
**Bugs found only by running it**, all fixed: missing `desugar_jdk_libs_nio` (every search crashed), the text field
swallowing Down, a disabled Download button throwing focus into the search box, overflowing Now Playing controls, the
wrong (wide) cover, the rail pushing content and drawing over video, focus lost after leaving a player.

**NOT proven, and I would not claim otherwise:** anything on a real Fire TV Stick (32-bit ARM, 2 GB, hardware decode, the
real remote and keyboard, the launcher row showing the banner); voice (the Alexa button is system-owned; the in-app
Speak button depends on a recogniser the stick may not have); USB drive storage; subtitles and the TV speed/quality menus;
cancel/retry/resume; a full drive; a dropped connection. The emulator's slow 1080p60 start and "frames dropped" are
software decoding and network, not evidence about the stick.

**A test-harness trap worth keeping:** `adb shell input keyevent` sends key-down and key-up ~2 ms apart. When the app is
busy the up can arrive before Android has marked the press trackable, so a Back press is silently dropped. I spent real
time chasing this as a product bug. A real remote does not behave like that.

**Next:** put the debug APK on the stick (`tv/README.md`), run the not-proven list, fix what it finds. Then Lumina Sync
between PC and TV, an extractor updater, and the three waiting items from (30). Please also decide the square-artwork
setting.

---

## 2026-10-11 (30) - Lengine: design, a partial audit, and two measurements that moved the plan

No product code changed this session. Docs only: `docs/14_LENGINE_FRAMEWORK.md` (new), `BUGS.md`
(B1 reopened, audit section added), this entry.

**The audit mostly did not happen.** A 71-agent workflow (15 code slices x 3 lenses, skeptic
verification, 7 research tracks, a connection probe) lost 69 agents to a session limit. Two slices
returned (queue/scheduler: 32 findings, host driver: 40) and nothing was independently verified. I
re-read the code behind the most important of them and recorded which are confirmed-by-reading and
which are leads, in `BUGS.md`. The other 13 slices need a re-run. A wrong theory worth keeping: I
first read `handoff.ts:28`'s filename regex as one that would turn digits into underscores; the file
holds raw control bytes (`[NUL-US<>:"|?*]`) and is correct — but git treats it as binary because of
them, which is a real, small annoyance.

**Measured (public samples only, ~200 MB total):**

* With acceleration on, yt-dlp->aria2 prints one `finished` line and **no** `downloading` lines; aria2's
  readout reaches stdout and nothing parses it. This reopens B1 for the accelerated path and
  contradicts the earlier "no `[#...]` line reaches stdout" note. Not yet checked: whether YouTube's
  own https formats take this path in the app.
* aria2 reaches `CN:16` with `-x16` (the parallelism is real) and 1 vs 16 connections took the same
  time. Cloudflare's speed endpoint gave 2.8 MB/s on one stream and 3.0 MB/s across four: the line is
  ~24 Mbit/s right now, not the ~650 Mbps in HANDOVER. The same sample ran 8x faster minutes earlier,
  so one evening proves little.

**Docs read for the design (primary sources):** Cloudflare clearance and Turnstile pages, Electron
`session` and `DownloadItem`, the aria2 manual, Microsoft's `MpCmdRun` page. The consequences are in
`docs/14` section 0 (E9-E12): a clearance cookie is device-bound and reusable only in its browser; a
Turnstile widget token is single-use; Defender custom scans need elevation.

**Not done / next:** nothing is built. Phase 0 in `docs/14` section 10 is the start (parse the aria2
readout in `core` with the captured log as the fixture; bench script; the quick scheduler/host-driver
fixes). Five decisions are waiting on the maintainer in `docs/14` section 11, the cookie-replay one
because it touches hard rule 1. Re-run the 13 unaudited slices — in smaller batches this time.

---

## 2026-09-25 (29) - Four asks, and three of them turned on a measurement

### Volume past 100%, without the distortion that usually comes with it

`HTMLMediaElement.volume` is 0..1 by specification and silently clamps anything more, so louder than
100% cannot come from the element. Above it the element sits at unity and a gain node makes up the
difference - followed by a limiter, because gain on its own is exactly how "volume boost" got its
bad name. Below 100% the limiter is configured to do nothing at all (ratio 1), so ordinary listening
is not coloured to pay for a feature it does not use. **D18**, 13 tests.

### The app would not start, and every check was green

The capture step saved 170%, and the next launch showed **"Lumina couldn't start - The volume
provided (1.7) is outside the range [0, 1]"**. `tsc` clean, 893 tests passing, `vite build` clean.
Two places set the startup volume - the store at creation and `App.tsx` after settings loaded - and
only one of them had been taught the split. `applyStoredVolume` is now the only way in.

This is the second time in two sessions that a green suite sat on top of a dead app. It is the whole
argument for the capture harness.

### Downloads: the premise was wrong, and measuring said so in two commands

"More connections" was the assumed fix. It cannot be:

    connections=1  : 12017ms => 26 Mbps
    connections=4  : 13127ms => 24 Mbps
    connections=16 : 12847ms => 24 Mbps

The link saturates around 25 Mbit/s; extra sockets buy nothing. What does cost time is **~4.8 s per
item** for yt-dlp to work out what to fetch - measured twice, consistently - against ~2.5 s of
actual transfer for an 8 MB song. So a 433-song playlist is ~53 minutes, of which ~35 are *waiting*,
with the line running at about 9 of its 25 Mbit/s.

The only lever is doing several items at once. One playlist is now split between four yt-dlp
processes, each with its own `--playlist-items` slice and its own copy of the download archive
(several processes appending to one file is a race nobody should have to reason about), merged at
the end. ~53 minutes to ~13, by calculation. **D19**, 21 + 2 tests. Not yet watched on a real
playlist - that needs a signed-in profile.

Also checked and cleared rather than assumed: yt-dlp's JS runtime. `JS runtimes: node-24.21.0`, so
the app is **not** falling into the slow-interpreter trap that throttles YouTube to a crawl. A first
attempt reported `none` and was my own path-format mistake, not a finding.

### A Like on the player, and a key collision TypeScript is happy with

`F` was the obvious shortcut and was already Fullscreen. A duplicate `case` in a `switch` is legal
TypeScript, so `tsc` stayed green while Fullscreen would silently have stopped working. Found by
reading the switch. Moved to `H`. Proven end to end: a capture pressed `H` during playback and the
`likes` table went 0 to 1 for the track that was playing.

### The browser shield

A real Adblock Plus engine in `src/core/shields.ts` - `||domain^`, wildcards, separators, `$type`,
`$third-party`, `$domain=`, `@@` exceptions, element hiding - attached to the browser session's
`onBeforeRequest`, so a blocked tracker never leaves the machine. Plus https upgrading, per-site
"shields down", and a badge that counts and names what it stopped. **D20**, 44 tests.

Its own test caught a parser bug on the first run: element-hiding rules separate domains with
**commas**, `$domain=` with **pipes**, and I had conflated them.

Then the index was measured against the real lists - 115,598 network rules, 24,347 cosmetic:

| | biggest bucket | per request |
|---|---|---|
| filed by longest token | 2766 | 114 us |
| filed by rarest token | **79** | **50 us** |

Filing by length looks sensible and is wrong: `analytics` is long, so 838 rules shared one bucket
and every analytics request was compared against all of them. A first attempt at the same problem -
removing a per-request array allocation - changed nothing, which is worth recording as a wrong
theory that measurement killed in one run.

Verified against a local page carrying two known trackers: both blocked, correctly split into
1 ad + 1 tracker, named in the panel, and an unrelated CDN script left alone - on the 47 built-in
rules alone, with nothing downloaded. That floor is deliberate: a shield that only works after a
download silently does nothing on a first run.

**Verified:** `npx tsc --noEmit` clean, `npx vitest run` **937 passed (44 files)**,
`npx vite build` clean, four capture runs, each looked at.

**Not proven:** no real playlist through the parallel downloader; no real ad-funded site through the
shield, so nothing is known about how often it breaks a page; nobody has listened to the 200% boost.

**Next:** B5 (playlists), B3 (a real equalizer), B7 (keyboard + `Shift+?`), and the multi-interface
half of B6.

---

## 2026-09-25 (28) — The progress bar was never broken; it was measuring the wrong thing

### Two sessions blamed the parser. A capture settled it in one run.

B1 — "downloads show no usable progress" — had been reported three times, and two theories about the
parser had been built and disproved. Rather than build a third, the bundled yt-dlp was run against
three public Big Buck Bunny samples using the **exact argv `buildDownloadArgs` produces** (dumped
from the real function through a throwaway test, so the flags could not drift from the app's), and
every output line was captured.

All 105 lines then went through the live progress model. It produced a clean, monotonic 0→99% ramp
with correct speeds and byte totals. **Nothing was broken.**

The fault is arithmetic, and it is complete on its own:

    433 items: each file is 0.23% of the bar; the % number changes once every 5 files

So on the reported playlist the whole-number percentage sat on one value for five songs, the bar
crept a quarter of a percent per song, and for the first five songs it read exactly `0%`. That is
"215 of 433 beside 0%" and "it just keeps progressing until it's complete" — with every figure in
the pipeline honest. The number on screen was simply the wrong one for someone watching a single
song download.

Fixed by reporting `filePercent` as well and giving the file in hand the headline and the main bar,
with the playlist on a thinner bar underneath (**D15**). The model moved into
`src/core/ytdlpProgress.ts`, where the real capture is replayed against it — it had been sitting in
a main-process file where no test could reach it, which is precisely how it absorbed blame twice.

### The replay test found a second bug on its first run

It asserted that `ExtractAudio` is labelled "Extracting audio" and got **"Processing"**. yt-dlp
reports a postprocessor by its `pp_key()`, which strips the trailing `PP` *and the leading
`FFmpeg`* — so `FFmpegExtractAudio` in the lookup matched nothing. **Seven of thirteen labels were
dead.** Every music download in the app's history said a flat "Processing" during its longest phase.
Confirmed against the real binary, which printed `Metadata`, `MoveFiles`, `ThumbnailsConvertor` and
`VideoRemuxer` — none of them prefixed.

This is D11's bug again in a different costume (`-map 0:v:m:disposition:attached_pic` also looked
right and matched nothing), so it is written down as a rule this time: **D17 — names another program
emits are pinned by a capture, and the wrong form is forbidden by the same test.**

### Shuffle was not a shuffle

Reading `advance()`: with shuffle on it picked a random *other* index and **ignored the direction
argument entirely**. Two consequences, both real — songs repeat while others never play, and
**Previous moved forward**, dealing another random track instead of returning to the one just heard.
There was no history, so there was nothing to go back to. Replaced by a kept permutation plus a
cursor in `src/core/shuffle.ts` (**D16**, 13 tests, seeded generator so the properties are actually
asserted: full coverage, no repeat across the seam, exact retracing backwards).

### The loudness switch was inert, and now it isn't

`applyLoudness` ran only when a track loaded, so flipping "match the volume of every track" did
nothing until the next song. By the user's own standard that is a feature "for show" — it is
indistinguishable from a switch that was never wired up. It now re-applies to the track playing.

### Seen, not just type-checked

The sound panel had **no capture step at all**, which is exactly why last session's toggle shipped
unseen. Two steps were added. `13b-player-sound` shows the panel open over a real track playing with
the checkbox on; `13c-player-loudness-off` shows it off with the explanation changed — so it
renders, round-trips through settings and re-renders, mid-playback. Six screenshots, six distinct
hashes, no identical pairs. The app log for that run:

    [loudness] Love Me.opus: -11.6 LUFS, peak 2 dBFS, in 3276ms

A real track peaking 2 dB above full scale, turned down 3 dB to keep it under the ceiling.

The Queue layout was photographed with a seeded multi-item job: two bars, `49% of all 433`. Recorded
honestly — that job is `paused`, so the headline number and the speed/ETA line, which draw only for
a `running` job, are built but unseen.

### A false alarm, checked rather than filed

The capture run exited 1 with no `after_move` lines, which looked like "successful downloads
reported as failures". It was not: `ffprobe` showed the Big Buck Bunny samples are **video-only**, so
`--extract-audio` legitimately failed and no final file was ever moved. Correct behaviour from both
programs. Worth recording because the instinct to file it as a bug was wrong.

**Verified:** `npx tsc --noEmit` clean · `npx vitest run` **857 passed (41 files)** · `npx vite build`
clean · capture run of six steps, all distinct.

**Next:** B7 (keyboard + `Shift+?`) and B4 (Like on the player) are both self-contained; then B5
(playlists) and B3 (a real equalizer). R1 still needs its adapter picker and a real cable.

---

## 2026-09-25 (27) — Why it sounded worse than Spotify: it was clipping, not quiet

### The measurement came first, and it inverted the assumption

"Their music sounded better at the same volume, ours was weak." The obvious reading is that Lumina
plays too quietly, so the library was measured before anything was written. Six tracks:

    -11.2 LUFS   peak  +0.1 dBFS
    -14.0 LUFS   peak  -2.2
     -9.7 LUFS   peak  +0.4
     -8.7 LUFS   peak  +1.9
     -9.2 LUFS   peak  +2.1
     -9.4 LUFS   peak  +1.6

They are **louder** than Spotify's -14 LUFS target, not quieter — and almost all of them peak
**above full scale**. A wider sample through the real app found -5.4 and -5.1 LUFS masters peaking
at +2.8 and +2.4, and one track at **+5.6 dBFS**. Seven of eight were clipping. That is heard as
harsh and flat, which is exactly what "weak" describes — the opposite diagnosis from the obvious one.

### What was built

`src/core/loudness.ts` (21 tests) decides the gain: reach the target, but never exceed -1 dBTP, and
where those disagree the peak wins — boosting a quiet track into clipping would recreate the very
fault being removed. `src/main/media/loudness.ts` runs `ebur128` once per file and stores the answer
on the library row (migration 3); the scanner clears it when a file changes. The renderer applies it
as a **gain node ahead of the equalizer**, never by touching `media.volume`, so the volume slider
keeps meaning what the listener set it to.

**Proven through the real app, not the unit tests**: a capture run called the new `player:loudness`
channel for three library tracks — the migration applied, ffmpeg ran, the parser read the summary,
and the results persisted (`-5.4 / +2.8`, `-5.1 / +2.4`, `-11.6 / +2.0`).

**Not proven:** nobody has listened to it, and the toggle added to the player's sound panel
type-checks but has not been seen rendered.

### Two harness mistakes worth recording

`execFileSync` only exposes stderr when the command *fails*, and `ebur128` exits 0 — so the first
run of the real-file check reported "no summary" for all eight tracks. The parser was fine; the
harness was wrong. Second: the capture step guessed the channel `library:list`, which does not
exist (it is `library:items`), and failed silently because renderer `console.log` never reaches the
shell on Windows. Both were found by checking the database rather than trusting the absence of output.

**Verification:** `tsc --noEmit` clean · **823 tests, 39 files** · `vite build` clean.

---

## 2026-09-24 (26) — A music drive that made sense, and a written home for the rules

The installer from session 25 did land: `C:Program FilesLumina
esourcesapp.asar` is the 15:15 build and
carries all three fix markers. So everything reported this session was against the **fixed** build, which matters
— the download-progress complaint has now survived a fix, so the earlier diagnosis was wrong.

### Songs appeared on the television as folders — fixed, and measured

Every track was filed as `Music/Artist/Album/Title`. The assumption that most downloads carry no album tag was
**wrong** — 435 of 455 do — but the tag YouTube Music writes is usually *unique to that one track*, so
`Artist/Album/` still produced a folder per song, each holding one song and a `cover.jpg`. On a television,
which lists folders, a music library became hundreds of folders.

`realAlbums()` in `src/core/portable.ts` now treats an album as real only when it is named **and** more than one
exported track belongs to it. Real albums keep `Artist/Album/NN Title`; everything else goes flat as
`Music/Artist - Title`. The folder image follows the same rule, so a lone track no longer gets a `cover.jpg`
next to it.

**Measured on the real library through the actual `planExport`**, not a replica: **383 folders → 42**, for 455
songs. Sample of each shape: `Music/dollelita - cinnamon girl - lana del rey (sped up).flac` and
`Music/Arctic Monkeys/AM/I Wanna Be Yours.flac`.

Consequence worth knowing: target paths changed, so a drive exported under the old layout will be written again
in the new shape, and the old folders are not removed automatically.

### Download progress — narrowed with evidence, still not solved

Reported for the third time. This time it was reproduced rather than reasoned about: a real 30 MB download of a
public sample, driven through the actual paste → inspect → Download flow and photographed as it ran, showed
`16 connections · 7.6 MB of 29.3 MB · 4.0 MB/s · 5s left`, **25%**, and a bar filled to a quarter.

So the **aria2 path is fine**, and this is specific to the **yt-dlp path** — which is exactly what the reporter
downloads. The attempt to reproduce it there did not get far enough: a cold capture profile took over 12 seconds
merely to inspect a YouTube URL, so the download never started and the Download button was still a skeleton.
Recorded in `BUGS.md` as B1 with both disproved theories, so nobody rebuilds them.

Found in passing and fixed: the row printed the byte count **twice**, because the aria2 stage text repeated what
the progress meta already showed.

### Documentation the project has never had

`AGENTS.md` (canonical rules, workflow, the traps that keep biting), `CLAUDE.md` (a pointer, not a second copy),
`DECISIONS.md` (13 decisions with what forced each one), `BUGS.md` (open defects, fixed list, won't-fix, and an
explicit *not proven* section) and `CHANGELOG.md`. Until now every session re-derived the rules from a 813-line
handover.

`BUGS.md` also records the backlog raised this session: loudness against Spotify/YouTube Music, a real equalizer,
a Like control on the player, playlists worth the name, multi-interface downloading, and full keyboard operation.

**Verification:** `tsc --noEmit` clean · **772 tests, 37 files** · `vite build` clean · the layout measured
through the real planner, and the progress row photographed from a real download.

---

## 2026-09-19 (25) — The first full 67-step capture run, and four things it caught

The full capture sweep has been outstanding since session 13. It ran, all 67 steps, and was read
**mechanically** rather than by eye: every screenshot hashed, and any two steps producing an identical image
flagged. An identical pair means a step changed nothing — which is exactly how a silently broken feature looks.
That found more in one pass than reading code did.

### Reloading the page was impossible in a packaged build

Five steps produced the same image, including all four splash steps, which do nothing but `location.reload()`.
The reload was being swallowed. `src/main/window.ts` guarded the window against being navigated away:

    const devUrl = process.env.VITE_DEV_SERVER_URL;
    if (devUrl && url.startsWith(devUrl)) return;
    event.preventDefault();

In a packaged build there is no `VITE_DEV_SERVER_URL`, so the condition can never be true and **every**
navigation was prevented — including the page reloading itself. The guard now allows a navigation whose target is
the page already loaded, and blocks everything else, so the security property is unchanged.

**Proven:** the four splash steps now render the splash screen and differ from each other. They had never once
captured anything real.

### The browser extension reported itself as working when it was dead

`extensionStatus()` returned `running: s.enabled` — the *setting*, not whether the socket had bound. With the
port taken, Settings said "Listening only on this computer (127.0.0.1:17865)" while nothing was listening, and
the one thing that fixes it (change the port) appeared only in a log file nobody reads.

`BridgeServer` now tracks whether it is genuinely bound and why not, `running` means `enabled && listening`, and
a state change broadcasts `extension:changed` so Settings follows along live.

**Proven** against a real conflict (the machine's own Lumina holds 17865): the row reads *"Switched on, but not
listening yet"* above *"Port 17865 is already used by another program… Pick a different port below."*

### "Share to TV" showed an on switch beside the word "Off"

Caught by looking at the capture, not by reading code. The switch shows what was asked for; the badge showed
reality; a port clash makes them disagree, so the screen contradicted itself. Being switched on and not running is
now its own state: an amber **"Not working"** badge and *"Switched on, but it isn't running — see the reason
below."* The reason itself was `listen EADDRINUSE: address already in use :::8200`, which is accurate and
useless, and now reads *"Port 8200 is already used by another program on this PC. Change the port below…"*.

### Artwork remembered failure per component instead of per URL

`Artwork` kept a single `failed` flag, so once a slot had failed to load an image it kept showing the placeholder
even when handed a different, perfectly good one. It now records *which* URL failed.

### What the run did NOT prove — said plainly

Twelve IDE steps and three editor-theme steps also came back identical. That is **not** a fault: the scratch
profile has no `settings.json`, so no workspace is restored and every one of them photographed the same
"Open a folder to start editing" screen. Checked before concluding. Those 15 steps are therefore **untested** in
this run, not passed. `18a`/`18b` likewise matched, and the portable edge cases behind `18b` remain unverified.

**Verification:** `tsc --noEmit` clean · **765 tests, 37 files** · `vite build` clean · the live captures above,
each against a genuine port conflict rather than a simulated one.

---

## 2026-09-19 (24) — A sweep for more of the same, by looking rather than guessing

Asked to find other small things worth fixing. Method: render the real screens offscreen against a *copy* of the
live library and read them, which is how the badge contrast was caught. Two fixes, and two things deliberately
left alone because looking showed they were not faults.

### Fixed: a folder cover beside the tracks was never shown

The same shape as the thumbnail bug — the UI gates on a flag, so working code is never reached.
`src/main/media/protocol.ts` has always been willing to serve a `cover.jpg`/`folder.jpg` sitting beside an audio
file, but `library.ts` set `has_artwork` from the **embedded** picture alone, and both list views render
`item.hasArtwork ? art(item.id) : null`. So for a library whose art is files rather than tags — ripped CDs, most
organised collections — the cover was findable, servable, and never once requested.

The folder-image names now live in `FOLDER_IMAGE_NAMES` in `src/core/artwork.ts` and are used by *both* sides, so
they cannot drift apart again. The scanner's lookup is memoised per folder: 20 tracks in an album would otherwise
stat the same five names 20 times, a whole library hundreds of times. The memo is cleared when a scan starts, so a
cover added since last time is noticed.

**Proven end to end** with a synthetic album — a 35-second silent MP3 with *no* embedded picture (confirmed by
ffprobe: zero video streams) beside a `cover.jpg`. After a scan, `has_artwork = 1`, and a 128px sized entry
(3,689 bytes) appeared in the artwork cache, which only happens once `sourceArt` has successfully returned the
folder image. Both halves confirmed, not just the flag.

Worth noting this does nothing on *this* machine: all 450 audio items already carry embedded art, so it was
verified synthetically. It matters for other people's libraries, which is the stated goal.

### Fixed: the Files tab listed our own bookkeeping as "Other files"

Two entries named `c9625df298353912c52657774bb3de80a9941277.torrent` and similar. aria2 writes an
`<infohash>.torrent` beside the download when `--bt-save-metadata` is on (`src/main/jobs/aria2.ts`) so a magnet
can resume without fetching metadata again. It is ours, not the user's, and forty characters of hex says nothing.

`isDownloaderArtifact` in `src/core/fileKind.ts` now covers it alongside the `.aria2`/`.part` exclusions that were
already there — one function instead of a chain of `endsWith`. **Only the infohash form is matched**, so a torrent
someone saved themselves keeps its name and stays listed. Re-captured against the real downloads folder: the two
hex rows are gone, the archive, image and subtitle remain.

### Looked at and deliberately not changed

* **`35.0 GB` for a 37,577,372,813-byte archive.** Checked rather than assumed: that is 35.00 GiB, and Windows
  Explorer labels it "35.0 GB" too. Matching the platform beats being pedantically correct.
* **Placeholder art on three rows of the Music list.** Suspected a second instance of the cover bug, so the
  covers were probed: all fourteen sampled tracks are `mjpeg` with `attached_pic`. It was artwork still loading
  on a cold cache, not a failure. No change made — the point of looking is to find the real thing, not to fix
  something imaginary.

Two capture steps added for screens that had none: `05c-library-playlists` and `05d-library-files`.

**Verification:** `tsc --noEmit` clean · **765 tests, 37 files** · `vite build` clean · the two captures above.
Uncommitted.

---

## 2026-09-19 (23) — Video thumbnails: one wrong ffmpeg stream specifier had disabled them all

The Library's Videos grid showed placeholder gradients, so choosing a video meant reading eight long titles.
The renderer was never at fault — it asks for artwork unconditionally (`art(item.id, 256)`), and the media
protocol has extracted video artwork all along. The extraction simply always failed.

**The cause.** `src/main/media/protocol.ts` selected the embedded cover with
`-map 0:v:m:disposition:attached_pic`. That is not what it looks like: in ffmpeg's stream-specifier grammar
`m:` selects by **metadata tag**, so it read as *"the stream whose metadata key `disposition` equals
`attached_pic`"* — which matches nothing. Run against a real file:

    Stream map '' matches no streams.
    Failed to set value '0:v:m:disposition:attached_pic' for option 'map': Invalid argument

The disposition specifier is `disp:`. And because **every** video yt-dlp downloads carries an embedded
thumbnail, all 8 videos in the library had `has_artwork = 1`, all 8 took that branch, and all 8 fell back to
no artwork. The frame-grab branch — which works — was unreachable for exactly the files people actually have.

**The fix.** `videoThumbnailAttempts` in `src/core/artwork.ts` returns the runs to try, in order: the cover via
`0:v:disp:attached_pic`, then **always** a frame from 10% in. The frame grab is appended rather than used as an
alternative, so a cover that is missing, mislabelled or corrupt still yields a picture. A zero-byte output counts
as failure (ffmpeg can create the file before giving up), and the `full` cache read is size-checked too, so a
truncated entry cannot be served for ever.

It lives in core because a test now pins the specifier and **forbids the `m:disposition` form**. This bug was
invisible: no crash, no error in the UI, just a placeholder that looked like a deliberate design.

**Proven, twice over.** All 8 library videos extracted successfully via the cover branch (15 KB–116 KB JPEGs),
and then end to end through the real app: a new capture step `05b-library-videos` renders the grid offscreen with
**an empty artwork cache**, building 39 cache entries on the spot and showing all 8 real thumbnails. Run against a
*copy* of the library database in a scratch profile, since the user's own Lumina was running.

**Also fixed, and found by looking at the result.** The duration and quality pills were tuned against the old
gradients, which were uniformly mid-dark. Over a real thumbnail — the C++ course one is white — a 70%-black pill
became mid-grey and collided with the artwork's own lettering. Now 80% with a hairline ring, checked by
re-capturing and zooming rather than by eye.

**One side effect, disclosed.** The first capture attempt seeded the scratch profile from the library database
*including its jobs table*, and the app dutifully resumed the queued "English Songs" download for ~3 seconds
against the real `C:UsersdatanMusicLumina`. It left no `.part`/`.ytdl` files behind (checked). The scratch
profile is now seeded with its job rows cleared, so a capture run can never touch a real download again.

**Verification:** `tsc --noEmit` clean · **761 tests, 37 files** · `vite build` clean · the cold-cache capture above.
Uncommitted.

---

## 2026-09-19 (22) — The portable copy was broken by asar; the progress bar was reporting honestly but reading badly

Two things from live use, one proven fixed and one only partly understood. Both are written up as they are.

### 1. Copying Lumina to a drive failed at `app.asar` — fixed and proven

The screenshot showed the copy stopping at 349 MB of 732 MB with
`ENOENT, not found in C:Program FilesLumina
esourcesapp.asar`. The cause is Electron, not the copy logic:
a packaged `app.asar` is presented to `fs` as a **directory**, so `copyDir` walked *into* the archive and tried
to copy the files it believed were inside it. `measure()` had the same fault, reporting the archive's
uncompressed contents as the size to copy.

`src/main/portableInstall.ts` now takes its filesystem from `original-fs` (Electron's unpatched `fs`) via
`createRequire`, so the archive is seen as the one file it is. Scoped to this module deliberately, rather than
setting the process-wide `process.noAsar`, which would break every other read from the archive while a copy ran.

**Proven, not assumed.** A probe under real Electron against the installed `C:Program FilesLumina
esources`:

    app.asar via patched fs   : isDirectory=true  isFile=false
    app.asar via original-fs  : isDirectory=false isFile=true

    patched fs  (the bug): FAILED -- ENOENT,  not found in C:Program FilesLumina
esourcesapp.asar
    original-fs (the fix): COPIED 22 files, 165361985 bytes
    copied app.asar byte-identical: true (16424011 bytes)

The failing line reproduces the reported error exactly, and the fix copies the 16 MB archive byte for byte. Also
confirmed the dynamic require survives bundling: `createRequire(import.meta.url)("original-fs")` is present
verbatim in `dist-electron/main/index.js` rather than inlined away.

### 2. Queue progress — what was actually wrong, and what was not

The claim that a percentage/speed display had been **removed** was checked before anything was changed, and it is
not what happened: `git show` of `JobRow.tsx` at c641268, f8a008e and 317fb25 shows the four `meta.push` lines
and the `{Math.floor(p.percent)}%` readout **byte-identical in all three**. The only change across those commits
*reduced* the looping animation. Nothing was taken away. Said plainly because the opposite was assumed.

Two real faults were found and fixed:

* **The bar flipped to its looping "loading" animation whenever `percent` touched 0**, which on a long playlist
  happens at every file boundary. A looping bar over real progress reads as *stuck* — exactly the reported
  impression. `progressIndeterminate` now reserves that animation for when nothing at all is known: no percent,
  no bytes, no position in a playlist.
* **Starting a playlist item did not report progress**, only a title. An item that produces no download ticks of
  its own left the bar motionless. The engine now sends `percent` (and clears the previous file's byte counts) on
  each item boundary, so the bar steps forward per song regardless.

And the requested shading: `ProgressBar` now draws a light-to-dark ramp **anchored to the track**, so the colour
deepens as the bar advances and the shade alone says roughly how far along it is. Byte counts on a playlist are
labelled `this file …` so they cannot be read as a total that keeps resetting.

**A wrong turn, recorded because it matters.** The first diagnosis was that `p.percent` was per-file and needed
folding with the playlist position in the renderer. It is not: `overall()` in `src/main/jobs/ytdlp.ts` already
folds the playlist position in, and the queue *merges* progress rather than replacing it — so that change would
have double-counted. It was reverted. The second theory was that acceleration hands downloads to aria2c, which
reports nothing through `--progress-template`; a full aria2 console-line parser was written and tested for it.
**That theory is also wrong**, and was disproved with a live run against a public sample
(`test-videos.co.uk` Big Buck Bunny) through the bundled yt-dlp with aria2c as external downloader:

    LUMINA_PROGRESS|downloading|25973876|30704510|NA|3108898.05|1|NA|NA

Bytes *and* speed arrive normally, and no `[#…]` aria2 line ever reaches stdout. The parser was deleted rather
than shipped as a fix for a problem that does not exist.

**So: the "0%" itself is not yet explained.** Neither code path can produce 0% at 215 of 433 — a single playlist
job reports `100 * 214/433 ≈ 49%`, and a group of 433 jobs counts each completed member as 100. Answering it
needs one detail from the next live run: whether that row was **one playlist download** or **433 separate
downloads grouped together**.

**Verification:** `tsc --noEmit` clean · **754 tests, 37 files** · `vite build` clean · the Electron probe above.
Uncommitted, as always, until asked.

---

## 2026-09-19 (21) — Docs audit: both files brought back in line with reality

Asked to check whether the handover and session log were stale. They were, in four ways:

1. **Order was wrong.** Entry (13) sat *above* entries 14–20 despite the file's own "newest entry at the top"
   rule — my earlier insertions had gone in against the wrong anchor. Re-sorted; it now reads 21 → 1.
2. **HANDOVER §0 was two days behind**: still headed "end of session 12", still claiming 591 tests, and
   describing only session 13's work. Rewritten around what a fresh session actually needs — what is committed,
   what is verified *right now* (751 tests, 37 files), what was built in 13–20, the §14 plan status, and an
   explicit **"proven vs. never proven"** list so nobody inherits an overstatement.
3. **Stale claims elsewhere**: §5 said "529 passing, 30 files"; §17 called the DLNA server "not built" when it has
   been working since session 17; §13 still listed git/source control and split panes as missing.
4. **The commit was pushed and the docs said otherwise.** `origin/main` is now `317fb25` and
   `git reflog show origin/main` records "update by push". No assistant session ever ran `git push`, so this
   happened by another route — corrected in both files rather than left contradicting the repository.

Also made the regression claim precise: `capture.ts` defines **64** steps, the last *full* run covered **56/56**,
and the eight added since were captured individually — so a full 64-step run is still outstanding.

**Verification:** every number in §0 was re-checked against the repository (`vitest`, `git log`, `git status`,
`ls release`), not copied forward.

---

## 2026-09-19 (20) — One setup screen per device, and a hazard found on the real stick

**Settings › Places › Portable drive** is now the single place a device is set up: set up the folders, **put
Lumina itself on the drive**, copy the library, import from it, choose TV compatibility, and route downloads —
both routes to a television configured from one screen, as asked.

`src/core/portableInstall.ts` (**32 tests**) decides everything before a byte moves: is a copy already there and
is it ours (`absent` / `current` / `outdated` / `unknown`), is there room (size plus slack, so an exact fit is
refused), is the drive writable, is this a packaged build at all. `src/main/portableInstall.ts` does the copying —
through `.part` names so a file that exists is a file that copied completely, with the marker and version file
written **last**, so an interrupted copy is recognisably incomplete rather than looking installed and failing to
run. It also refuses to copy into itself.

**A real hazard, found by running it against the user's own USB stick.** The drive already had `F:\Lumina` —
*their* folder, holding "English Songs" and "Videos". The screen reported it as "Unrecognised" and offered an
**Update** button that would have copied program files straight into their media. It was disabled only because
this is a dev build; in the packaged app it would have been live. People name a folder after the app they use it
with, so this was always going to happen.

Fixed with `looksLikeInstall` / `folderConflict`: a destination folder that exists, is not empty, and contains
neither our version file, nor our marker, nor a Lumina executable is **refused outright** — *"There is already a
'Lumina' folder on that drive with your own files in it. Rename or move it first."* Tested against the exact
directory listing from that stick.

**Edge cases checked through the real IPC** (`18b-portable-edges`): no drive selected, a path that does not
exist, and a non-removable folder — all three refuse. **Honest limit:** in a dev build the "not a packaged build"
check runs first and masks the others at runtime, so the room, read-only, self-copy and folder-conflict guards are
proven by unit test rather than observed live. They need a packaged build to exercise end to end.

**Verification:** tsc clean · vitest **751 passed (37 files)** · vite build ok · offscreen captures `18a`, `18b`.

---

## 2026-09-19 (19) — Portable Lumina: the app runs from the stick

User's plan: **"Both, portable build first"** — carry Lumina *and* the media on one drive, plug it into any PC,
and from there either play directly or switch on Share to TV.

- **`src/core/portableApp.ts` (12 tests)** decides one thing: where `userData` goes. Portable mode turns on from
  `PORTABLE_EXECUTABLE_DIR` (electron-builder sets it to the folder the .exe was launched from — the stick), from
  a `lumina-portable.txt` dropped beside a copied folder, or from `LUMINA_PORTABLE=<dir>`. The filesystem is
  injected, so every branch is tested without a USB stick.
- **`src/main/portableMode.ts`** applies it. **Import order is the whole trick**: settings, the database, the log
  file and the artwork cache all derive from `userData` *at import time*, so this module is the first Lumina
  import in `index.ts` and ES modules are evaluated in order. It also redirects `sessionData`, because Chromium's
  caches are large and constantly rewritten — leaving those on a borrowed PC would defeat the point. A read-only
  or full stick falls back to the normal folder rather than refusing to start.
- **Build target**: `portable` added for Windows → **`Lumina Portable_v3.0.0-alpha.0.exe`**, with a
  `package:portable` script and a Menu.cmd entry ("Portable (.exe) - runs from a USB stick, keeps its data there").

**Proven by running it**, not by reasoning: launched with `LUMINA_PORTABLE` pointed at a fake stick. The log says
`[portable] Using …\lumina-fake-stick\Lumina-Data for all data`, and the drive then holds `settings.json`,
`lumina.db`, `logs/`, `bin/`, `Session/`, `sync/` and `window.json`. The other half of the claim was measured too:
**0 files** written under `%APPDATA%\Lumina` during that run, so nothing is left on the host machine.

**Bug caught by a test, in the test:** `portableDataPath` looked wrong (`E://Lumina-Data`) — but the fault was my
fake `join` in the spec, which concatenated naively where node's `path.join` collapses separators. Fixed the
helper, not the code, after checking real `path.join('E:/','Lumina-Data')`.

**Verification:** tsc clean · vitest **719 passed (36 files)** · vite build ok.

**Next:** the second half of the user's request — one "set up this device" screen covering both routes (portable
copy onto the drive, plus the TV-safe export), so a stick can be prepared in one place.

---

## 2026-09-19 (18) — Share-to-TV settings toggle, and a flaky test made honest

**Settings › Connections › Share to TV** (`sections/sharing.tsx`): the switch, a live **Sharing/Off** badge driven
by the `dlna:changed` event rather than the switch position, the address a TV would use (with Copy), the name
shown on the TV, and the port. Captured offscreen with sharing on: the badge reads *Sharing* and the address is
`http://192.168.1.4:8200/description.xml`.

Two warnings are on the page in plain words rather than a tooltip: **DLNA has no password** — anyone who can reach
the computer can browse and play the whole library, which is the protocol on every media server, not a gap here —
and **Windows will ask about the firewall** the first time, with the note that refusing leaves sharing running but
unreachable.

**A property test failed, and the cause is worth recording.** `validateServerConfig never lets an unsafe server
through (20,000 random configs)` failed once, then passed twice. The seed is fixed (`rng(301)`) and the inputs are
identical every run, so the failure could not have been input-dependent — it was a **timeout**. There was no
`testTimeout` in `vitest.config.ts`, so vitest's 5s default applied, and the suite had been started *while an
Electron capture and ffmpeg were running*. The test's real work takes ~1.3s.

Fixed by giving that file `vi.setConfig({ testTimeout: 30_000 })` with a comment explaining why. A suite that
reports a red failure for a fixed-seed test with unchanged inputs is worse than no suite, because the next person
to see it will assume the validator broke.

**Verification:** tsc clean · vitest **707 passed (35 files)** · vite build ok.

---

## 2026-09-19 (17) — DLNA server running, and a TV-like probe proves it

**`src/main/dlna/server.ts`** — the working MediaServer on top of the tested protocol core: a UDP multicast
socket answering SSDP, and an HTTP server for `/description.xml`, both SCPDs, `/control/ContentDirectory`,
`/control/ConnectionManager`, `/media/<id>` and `/art/<id>`. Settings section `sharing`
(`dlnaEnabled` **off by default**, `dlnaPort` 8200, `dlnaName`), IPC `dlna:status` / `dlna:set-enabled`, a
`dlna:changed` broadcast, started at launch only when enabled and stopped on `will-quit` with an `ssdp:byebye` so
TVs drop the entry instead of showing a dead one.

**Proven against a probe that behaves like a television** (`scratchpad/tvprobe.js` — real M-SEARCH to the
multicast group, then SOAP and HTTP):

```
PROBE ssdp location: http://192.168.1.4:8200/description.xml
PROBE description:   200  Lumina on W
PROBE browse root:   200  containers: 2
PROBE browse music:  200  items: 3  total: 3
PROBE range GET:     206  bytes 0-99/97845   bytes: 100
PROBE art:           200  image/png  8284 bytes
PROBE unknown id:    404
```

Discovery, description, browsing, **byte-range seeking**, album art, and the security property (an id that is not
in the library is a 404 — paths never come off the wire) all confirmed.

**Bug the probe found:** `dlna:set-enabled` returned `running: false` for a server that was already listening,
because `startDlna()` returned before `server.listen()`'s callback. It now awaits listening, so the toggle reports
the truth instead of flickering to "off" and correcting itself via the change event a moment later.

**Security, stated plainly and repeated in the UI:** DLNA has **no authentication at all** — anyone who can reach
the port can browse and play the whole library. That is the protocol, not a gap here, and it is why the feature is
off by default. Only ids from the library index are accepted, nothing is writable, and Lumina never exposes the
port beyond the LAN.

**Verification:** tsc clean · vitest **707 passed (35 files)** · vite build ok.

**Still missing:** the settings UI for the toggle (the IPC works; nothing in Settings switches it on yet), and
Windows Firewall will prompt on first start. **No real television has seen this** — the probe is a good stand-in
but it is not a TV, and the user's own set may have no network at all.

---

## 2026-09-19 (16) — DLNA server, part 1: the protocol core

The user picked **"Both — USB first, then DLNA"**. The USB half is done and verified (entry 15); this is the start
of the DLNA/UPnP MediaServer that makes a TV list **Lumina** beside HDMI and AV.

**`src/core/dlna.ts` (56 tests)** — everything that is protocol *text*, with nothing touching a socket, so it can
be tested properly before a single packet is sent:

- **SSDP**: `parseSsdp` (tolerates bare LF and quoted `MAN`, both common in the wild), `searchMatches` (answers
  `ssdp:all`, `upnp:rootdevice`, the MediaServer and ContentDirectory types, and our own UUID — and stays silent
  for anything else), `ssdpSearchResponse`, `ssdpNotify` for alive/byebye. CRLF throughout and a trailing blank
  line are enforced by test, because devices that dislike either fail *silently*.
- **`deviceUuid`** is derived from a stable seed rather than randomised per launch — otherwise every restart
  leaves another dead "Lumina" in the TV's source list.
- **ContentDirectory**: `parseBrowse` reads a SOAP Browse forgivingly (namespace prefixes vary by device, and a
  fault just shows an empty folder with no explanation); `didlItemXml` / `didlContainerXml` / `didlDocument` build
  DIDL-Lite; `browseResponse` escapes that document *into* the SOAP body — XML inside XML, which is genuinely how
  the protocol works and is asserted in a test.
- **`parseRange`** — how a TV seeks. Open-ended, closed, and suffix ranges; clamps an end past EOF; returns
  `'invalid'` (→ HTTP 416) for a reversed range, `bytes=-0`, a start past EOF, an unknown unit, or a multi-part
  range, rather than quietly serving the wrong bytes.
- `protocolInfo` advertises `DLNA.ORG_OP=01`, without which many sets refuse to scrub at all.

**Verification:** tsc clean · vitest **707 passed (35 files)**.

**Not built yet:** the server itself — the UDP multicast socket, the HTTP endpoints
(`/description.xml`, the two SCPDs, `/control/ContentDirectory`, media and art streaming), mapping the library
into containers, the settings toggle, and the Windows Firewall prompt this will inevitably raise. **Nothing has
talked to a real TV**, and the user's own set may have no network at all — so this will need someone with a
DLNA-capable TV to confirm.

---

## 2026-09-19 (15) — TV compatibility for the USB drive (DLNA next)

**Context:** the user's TV has no network, so DLNA would not help them — but they want this right for
other people too: *"we are going to add such features with proper compatibility so others can use it too"*. They
also asked whether the drive could boot a mini-OS or run Lumina's player on the TV. **It cannot** — see
HANDOVER §17 for the four independent reasons (TVs don't boot from USB, no autorun, proprietary SoC with no public
display drivers, and the only USB code path is vendor-signed firmware update). They chose: **USB compatibility
first, then DLNA.**

**The real problem with a USB drive on a TV is codecs, not artwork.** A set will show "unsupported file" for
HEVC, 10-bit, MKV, DTS or 4K, and the export was copying files verbatim.

- **`src/core/tvSafe.ts` (27 tests)** now owns the rules — profile, reasons, summary, output naming. These rules
  already existed *inline* in `src/main/media/probe.ts`, untested and used only to label downloads; `compatibility()`
  now delegates to the shared module, so the export and the label can no longer disagree. Reasons are returned as
  a list ("HEVC video, 10-bit, not MP4") because the user is about to wait minutes for a conversion and deserves
  to know why.
- **Bug the tests caught immediately:** my first bit-depth check was a loose "contains 10/12/16", which called
  **nv12 10-bit** (the 12 is chroma subsampling) and missed **p010le** (which really is 10-bit). Now matches only
  the two real conventions: a depth after the plane marker (`yuv420p10le`) and the Microsoft semi-planar names
  (`p010le`).
- **Export converts instead of copying** (`storage.usbTvCompatibility`, default `safe`): each file is probed
  first, video that is not TV-safe goes through the existing `transcodeTvSafe` (H.264/AAC/yuv420p/faststart), and
  unsafe audio (FLAC, Opus, ALAC) is converted to AAC `.m4a`. `original` copies untouched. A file ffprobe cannot
  read is copied rather than guessed at. Cancelling the transfer now also kills the running ffmpeg.

**Proven with real ffmpeg, not asserted:** built a deliberately hostile file — `hevc / yuv420p10le /
matroska,webm` — ran the exact conversion, and probed the result: **`h264 / yuv420p / mov,mp4,m4a` at 360p**,
which is precisely what the profile requires.

**Then verified against the REAL export path, which found three bugs the unit tests could not.**
A controlled library (safe MP3, FLAC, safe MP4, HEVC/10-bit/MKV, and a name full of unicode and an apostrophe) was
scanned into a scratch profile and `usb:export` was driven **twice** through the actual IPC:

1. **ffmpeg failed on every conversion.** ffmpeg picks its muxer from the *output extension*, and the export was
   handing it the usual `….flac.lumina-part` temp name — "Error initializing the muxer … Invalid argument". Not one
   file would have converted. The conversion temp is now `.lumina-part-<pid>.mp4` / `.m4a`.
2. **Re-export re-converted everything.** `planExport` recognises "already on the drive" by the source's name and
   size, and a converted file has neither — `.mkv` becomes `.mp4` at a different size. Every export would have
   transcoded the whole library again.
3. **Re-export also re-copied every tagged audio file**, because embedding a cover *changes the copied file's
   size* (measured: 97,845 → 106,045 bytes), so the size match could never succeed again. Caused by the artwork
   feature added earlier the same day.

Bugs 2 and 3 are now one check: the destination — converted name or not — is skipped when it exists and its mtime
is at least the source's, so an edited original is still redone. **Proven:** two consecutive exports both report
`files: 0, skipped: 5`, having done no work at all; the run before the fix re-copied 2 files.

The drive's final contents are what a TV needs: `02 Lossless Song.flac` → **`.m4a`**, `04 Hostile Clip.mkv` →
**`.mp4`**, the already-safe MP3/MP4 copied untouched, `folder.jpg` in the music folder, a `.jpg` beside each
video, both `.m3u8` playlists, and the unicode filename intact.

**Not exercised, stated honestly:** the "ffprobe can't read it → copy untouched" branch and cancelling mid-convert
are written and typed but were not triggered by this test.

**Verification:** tsc clean · vitest **651 passed (34 files)** · vite build ok.

**Next:** the DLNA/UPnP server (SSDP + ContentDirectory + HTTP streaming) so networked TVs list Lumina as a
source. Still not built from the previous session: the YouTube music-video option.

---

## 2026-09-19 (14) — Artwork etched into files, and video gets its own player

**Context:** after the first live test the user reported: music played from the USB drive on a TV shows **no
thumbnail**; the artwork Lumina draws should be written *into* the file; a song with a music video on YouTube
should offer to play it; the USB drive should present Lumina's player to the TV; and the music player is wrong for
video — "the controls remain on the screen and the video only displays in a small space even in fullscreen".

**Video player — fixed and measured.** The cause was layout, not styling: in video mode the stage still sat in the
middle row of a `grid-rows-[auto_1fr_auto]` with `mx-[clamp(16px,4vw,48px)] my-3` margins, so it could never be
taller than whatever the header and dock left over. Auto-hide already worked (`[data-video][data-idle]`), but the
picture never grew. Video now renders `absolute inset-0` behind the chrome, which floats over it with gradient
scrims; music is untouched. Measured offscreen: `stage=1360x860 of 1360x860`, `video=1360x860` — previously it was
inset on all four sides.

**Artwork embedding — built and proven against real ffmpeg.** The reason a TV showed nothing is that Lumina
*generates* art for files that have none: `Artwork.tsx` drew a CSS `linear-gradient` from a hash of the title, so
it existed only inside the app. `src/core/coverArt.ts` (**33 tests**) now owns that maths — the same FNV-1a hash,
oklch→sRGB conversion, and a rasteriser for the 135° gradient — and `Artwork.tsx` imports it, so what gets embedded
is by construction what was on screen. `src/main/coverArt.ts` encodes it as a PNG (a ~40-line encoder using
`node:zlib`, rather than adding an image dependency for one gradient) and writes it in with ffmpeg.

Proven with real files, not inferred: the generated PNG probes as `png,600,600,rgb24`; embedding into a test MP3
gives `codec_name=png width=600 height=600`; and the audio stream is identical before and after
(`mp3,44100,2,128000` → `mp3,44100,2,128000`), the file growing only by the cover. Streams are copied, never
re-encoded, and ffmpeg writes a temp file that is renamed over the original only on success, so a failure leaves
the original untouched.

Wired into the USB export: every file copied to the drive gets art. **Audio** is tagged and gets a `folder.jpg`
per album; **video** gets a `<name>.jpg` beside it and is *not* re-tagged, because embedding a cover makes ffmpeg
rewrite the whole container — a 2 GB film would be copied twice for a thumbnail most TVs ignore. Ogg/Opus is
refused outright rather than silently doing nothing, since ffmpeg cannot write their cover format.

**Verification:** tsc clean · vitest **624 passed (33 files)** · vite build ok · offscreen capture `14a`.

**NOT built, stated plainly:** the YouTube music-video lookup and its "play the video" option. And the USB drive
**cannot** make a TV run Lumina's player — see HANDOVER §17.

---

**Stability check before the first installer (2026-09-19)**

- tsc clean · vitest **591 passed (32 files)** · vite build ok.
- **Full offscreen regression: 56/56 capture steps rendered.** Only two log lines, and neither is an app fault:
  a benign `Transition was skipped` from fast navigation (known since session 11), and a **harness** bug in the
  source-control steps.
- The harness bug is worth remembering because it made a *verification* silently pass: `10c-ide-commit` looked up
  the commit textarea and called `set.call(t, …)` without checking `t`, so when Source Control was not the
  showing view it threw `Illegal invocation`, typed nothing, and simply reported "commit button never enabled".
  Three fixes: `10a` now opens Source Control explicitly instead of trusting the persisted layout; `10c` guards
  the null; and both only click the activity-bar item **when it is not already active**, because clicking the
  active one collapses the sidebar — which is exactly what broke the first attempt at this fix.
- Re-verified afterwards: `[scm] clicking Commit 3 files` and a real new commit (`3d17f1e`) in the test repo.

**Installer naming:** `electron-builder.json` nsis `artifactName` is now `Lumina Setup_v${version}.exe`, so this
build produces **`Lumina Setup_v3.0.0-alpha.0.exe`**. The installer already registers the `magnet:` and `lumina:`
protocol handlers and the `.torrent` file association.

**A release-blocking bug the first build attempt exposed.** `electron-builder` refused to start:
`configuration has an unknown property '//asarUnpack'`. That key was added a session earlier as a JSON "comment"
next to the real `asarUnpack` entry that keeps node-pty's `.node` binaries outside the asar — but
electron-builder validates its config strictly, so **the node-pty packaging change had never once survived a
build**, and any attempt to ship would have failed at this exact point. JSON has no comments; the explanation now
lives in this log and HANDOVER instead of in the config file.

Second lesson from the same run: the build command was piped into `tail`, so `$?` reported **`tail`'s** exit code
and printed `BUILD_EXIT=0` while the build had actually failed. Re-run with `set -o pipefail` and the output
redirected to a log rather than piped.

**Installer built (2026-09-19):** `release/Lumina Setup_v3.0.0-alpha.0.exe`, **322,889,206 bytes**,
SHA-256 `38967ef57332564656e3d28411004959e7fbc38439d2ec0ee355282648384416`. Copied to the user's **Downloads**
folder and the copy's hash re-checked against the source. Packaged contents confirmed: 31 files in
`resources/bin` (ffmpeg, yt-dlp, aria2c, 7-Zip, whisper), the browser extension in `resources/extension`, and
node-pty's `conpty.node` in **`app.asar.unpacked`** — so the integrated terminal will work in the installed build.
Also noted for later: electron-builder warns that the *other* platforms' node-pty binaries are not bundled
(darwin-arm64/x64, linux-arm64/x64, win32-arm64). Harmless for Windows x64; **a Linux or macOS build will need
them in `optionalDependencies` first.** The build is **unsigned** — Windows SmartScreen will warn on first run.

**Next:** the rest of §14.3 — Problems panel, full status bar (Ln/Col, indentation, EOL, problem counts), a file
watcher so the tree follows external changes, breadcrumbs/outline, editor settings & keybindings — then §14.4's
media-native editor. After that the user wants a **stage-2 live test**: install the app on their machine and use it.

---

## ⏸ HANDOFF (2026-09-18, after entry 12) — continuing on another account

- **Uncommitted:** ~85 files from entries 8–12. HEAD is still `65c3f55` (= `origin/main`). Ask the user before
  committing; don't push unless asked.
- **Green at handoff:** tsc clean · vitest **529 passed** · vite build ok · all 48 offscreen capture steps render.
- **Waiting on the user's choice of next step** — the five options are listed in HANDOVER **§0**.
- Start with HANDOVER §0 (current state + gotchas), then entries 12 → 8 below.

---

## 2026-09-18 (13) — Committed sessions 8–12, then editor themes and the Explorer context menu

**Context:** New account picking the work up. Confirmed the handover state first (HEAD `65c3f55`, 85 changed
paths, tsc clean, **529 passed**, build ok — exactly what the docs claimed), then the user said to commit with a
short message and no co-author, and to do option **1** (finish the IDE plan) "and then do the others too".

- **Commit `317fb25`** — "feat: embedded IDE, MCP client, integrated terminal, and source control", 96 files,
  +12,094/−214. Not pushed *by this session*. (Checked again on 2026-09-19: `origin/main` is now `317fb25` and the
  reflog shows an "update by push", so it reached GitHub later by some other route.)

**§14.2 themes — built and proven**

- `src/core/theme.ts` (**34 new tests**): one `EditorTheme` drives the editor chrome, 14 token roles and the
  terminal's 16 ANSI colours; `toMonacoTheme` / `toXtermTheme` adapt it. Monaco and xterm now read the same object
  instead of each reading CSS variables separately, which is what let them drift before.
- Four built-ins + **Settings › App › Editor theme**, each card previewing in its own colours; `auto` follows the
  app's light/dark.
- **VS Code colour-theme import** (`src/main/ide/themes.ts`): `.json`/`.jsonc` directly, `.vsix` via the bundled
  7-Zip extracting only `extension/themes/*` into a temp dir that is then deleted. Nothing is executed. Sparse
  themes are completed from a built-in; JSONC is tolerated; the *background* decides dark/light because a theme's
  `type` field is often wrong.
- **Measured rather than eyeballed:** the first screenshot was ambiguous, so capture probe `11d-theme-probe` reads
  the computed colour back out of Monaco — Midnight `rgb(15, 17, 23)`, Paper `rgb(253, 252, 247)`, auto
  `rgb(20, 19, 18)`. Exact matches.

**§14.3.4 Explorer context menu — built and proven**

- New file / New folder / Rename / **Delete** (confirm names the victim; a non-empty folder needs the explicit
  recursive flag, which main refuses to infer) / Reveal in File Explorer / Copy path / Copy relative path.
  New main-process `deleteEntry` + `absolutePathOf`, both behind the same `resolveInside` workspace guard.
- Capture `12b` drives the real menu: right-click → New file… → type a name → Create. `menu-made.txt` appears on
  disk, the tree reloads, the file opens as a tab, status bar reads `menu-made.txt plaintext`.

**Verification:** tsc clean · vitest **563 passed (31 files)** · vite build ok · offscreen captures `11a`–`11d`,
`12a`–`12b`.

**Honest gaps from this session:** the theme *import dialog* is native, so the harness can't drive it — conversion
is unit-tested and the list/apply path is proven, but picking a real `.vsix` still needs the user's live test.
Browsing/downloading themes from Open VSX inside Lumina is **not** built.

**Then (same session): Menu.cmd and running the project from the IDE**

- **`Menu.cmd`** at the repo root — quick actions for the user: verify / type-check / tests (all, watch, one file,
  by name) / build; dev server; launch with a scratch profile; **offscreen screenshots**; diagnostics (host
  self-test, resource metrics, fetch bundled tools); **releases** (Windows NSIS or unpacked, Linux AppImage or
  AppImage+RPM, and an honest explanation that macOS cannot be cross-built from Windows, with the exact commands
  to run on a Mac); git; dependencies; open folders; clean; source search; project info. It calls the project's
  own npm scripts, so it cannot drift from package.json, and it bakes in the two project rules
  (`ELECTRON_RUN_AS_NODE` cleared, captures offscreen).
  - It also takes an argument: **`Menu.cmd 1`** runs "Verify everything" and exits, so it works from a shortcut,
    a scheduled task or another script.
  - Three real bugs found while testing it: the file was written with **LF endings**, which makes every `goto`
    fail with "cannot find the batch label"; `exit /b` inside a CALLed label only returns from the call, so
    argument mode fell back into the menu; and on EOF `set /p` returns instantly forever, which spun the menu at
    100% CPU. All fixed; a static check confirms all 43 labels and 43 jump targets match.

- **§14.5 Run panel** — the project's `package.json` scripts listed in the bottom panel with a play button, plus a
  **Ports** list. `src/core/tasks.ts` (**28 tests**): package-manager detection from the lockfile, script parsing,
  and URL/port extraction from terminal output (ANSI stripped, `0.0.0.0` rewritten to `localhost`, port-less URLs
  ignored). Running a task opens a normal terminal tab and types the command in, so there is no second execution
  path. A loopback URL gets an **Open** button that loads it in Lumina's own browser; a LAN address is shown but
  marked "network".
- **Bundled tools on PATH**: terminals now get `resources/bin` appended to PATH, so ffmpeg/yt-dlp/aria2c/whisper
  are available in any project opened here without installing anything. Appended, so a user's own tool still wins.

**Bug that only the offscreen run could find:** the first Ports capture came back empty. The default shell on this
machine is **WSL**, whose userland here is broken — but the real point is that a Windows project's toolchain is
native, so tasks now force a native shell (`startTerminal({ native: true })`). Manual terminals still honour the
user's choice. Re-captured: port 5173 listed with Open, and the LAN address correctly marked "network".

**Verification after all of the above:** tsc clean · vitest **591 passed (32 files)** · vite build ok · offscreen
captures `13a`, `13b`.

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
