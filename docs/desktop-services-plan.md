# Desktop services plan — working memory

Read this first in every new context window, then `SESSION-LOG.md` (newest entry) and `git log`.
Scope: the Electron main process and services. Ignore `tv/` (finished). Rules: `AGENTS.md` §1, §3.
Standing constraints from the owner: scratch `--user-data-dir`, never open the window, never commit or
push, ask before deleting anything or touching the real library, minimal changes, report only what was
run and seen.

## How to run the real path (works, proven 2026-10-23)

```bash
npx vite build        # REQUIRED: `electron .` runs dist-electron, which is NOT rebuilt by tsc/vitest
S=<scratch dir>; mkdir -p "$S/prof" "$S/cap" "$S/out"
LUMINA_PROBE_DIR="$S/out" LUMINA_CAPTURE="$S/cap" LUMINA_CAPTURE_ONLY="probe-download" \
  env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron . --user-data-dir="$S/prof"
```

`probe-download-yt` (src/main/capture.ts, `downloadProbe`) adds one job through the real IPC
(`media:inspect` → `jobs:add`), samples `jobs:list` every 500 ms and writes `probe-download-yt.json`.
Only runs when `LUMINA_PROBE_DIR` is set. Downloads go to that folder, not the library.
Side effect seen: a fresh profile still starts a library scan of the default music folder (read-only).

Raw yt-dlp capture without Electron: a scratch script that builds argv with the real
`buildDownloadArgs` and spawns `resources/bin/win32-x64/yt-dlp.exe` (see session 39 in SESSION-LOG).

Public fixtures that work: `https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_30MB.mp4`
(32 MB, direct), `https://www.youtube.com/watch?v=jNQXAC9IVRw` (Me at the zoo, the project's own fixture).
The `download.blender.org/.../BigBuckBunny_320x180.mp4` URL in older notes now 404s.

## Owner's redirect (2026-10-23): ONE thing at a time — the download engine

The owner asked to stop spreading across all items and focus on **downloading (normal, parallel, and the
torrent downloader)**: torrents start at ~1–2 Mbps, then drop to zero after minutes and never restart.
Items 2–4 below are paused until the owner says otherwise. Evidence for this work is in "Download stability".

## Download stability — findings (2026-10-23)

**Cause, measured:** on Windows/NTFS one 1 MB write 20 GB past the end of a normal file blocks **37 s**
(NTFS zero-fills the gap); in a sparse-flagged file it takes **0 ms** (even at 40 GB). aria2 does file writes and
RPC on one thread, so it goes silent. Lumina counted 3 failed 10 s polls and killed it, throwing the zero-fill
away; the resumed run froze the same way. Seen in the owner's own log (`%APPDATA%/lumina-media/logs/lumina.log`):
`Water.You.Doing…rar` (4.2 GB direct) polled out after 3 min; torrent `Forest Escape Last Train` after 10 min,
twice; each ended in `aria2 exited (1)`. A game torrent writes pieces all over a 100+ GB file.

**Fix:** `src/main/sparse.ts` marks big output files sparse right after aria2 creates them (`fsutil sparse
setflag`, lands ~7 ms after creation, works on a file aria2 has open); `core/engineWatch.ts` `rpcAction` gives a
live-but-silent engine 120 s before it is restarted; `stallStep` is a 60/180/420 s ladder (re-announce, re-add,
restart engine) for a download that stops moving. Wired in `src/main/jobs/aria2.ts`.

**Measured, loopback range server, Lumina's exact aria2 flags:**
* harness, 8 GB, 16 connections: `none` worst RPC call 6.3 s and not finished at 60 s; `falloc` 5.4 s (falls back
  on Windows without the privilege); `prealloc` 0.65 s; `none` with 1 connection 0.4 s (8 GB in 30 s);
  `none` + sparse flag 0.28 s, 8 GB in 19.6 s.
* the real runner in Electron, 24 GB: without the flag 188 s, 2 RPC timeouts, "Writing to disk" shown, 11-sample
  zero-speed run; with it **73 s**, no timeouts, longest zero run 1 sample. Content intact (48 sampled MiB).
* torrent rig (`swarm.mjs` in the session scratchpad: tiny tracker with a 1800 s interval + throttled aria2
  seeder that disappears at 30 s and returns at 75 s): aria2 alone recovered at ~125 s; with the ladder the stall
  was seen at 42 s, nudge at 93 s, fresh `started` announce at 91.6 s, resumed at 94 s, done at 199 s vs 227 s.
* final build, healthy swarm, 120 MB at 7.7 MB/s: byte-identical to the source, no stall or poll warnings.
* Tests: `tests/engineWatch.test.ts` (12). tsc clean, vitest 1016/1016, vite build ok.

**Parallel connections and speed:** more sockets are not a speed lever on this link (earlier measurement: 1 vs 16
connections took 38.8 s vs 38.7 s). On this disk 16 splits were also *worse* than 1 until the file was sparse.

**Not proven:**
* The owner's exact case (a ~100 GB game torrent on their disk with real peers) — never run. The mechanism is
  proven and the log matches it; the cure on that exact torrent is not.
* Only NTFS. exFAT/FAT32 sticks have no sparse flag; the flag fails quietly and those keep the old behaviour.
* A swarm that is genuinely empty (no peers anywhere) still sits at 0 B/s — nothing can fix that; the ladder only
  keeps retrying.
* yt-dlp's own aria2c children (media files, small) get no sparse flag.
* The Queue row's "Writing to disk, please wait…" / "No data arriving, reconnecting…" text was not photographed.
* Disk full / cancel / retry of a torrent were not tested this round.

## Cancel, retry, full disk — findings (2026-10-23, same day)

Probes: `LUMINA_PROBE_MODE=lifecycle` (pause → resume → cancel → retry), `LUMINA_PROBE_FAST_RETRY=1` (cancel and
retry with no gap), `LUMINA_PROBE_SELECT=1` (pick files on a too-big torrent), plus `lswatch.mjs` logging the folder.

* **Direct file, 2 GB (real runner):** pause/resume continued 16.4% → 30.5% (no restart); cancel left the folder
  **empty** (partial and `.aria2` both removed); retry restarted from ~0% and completed 100%.
* **Torrent, 120 MB, 1 seed:** the same sequence worked; resume continued 15% → 30%; retry restarted and the result
  was byte-identical to the source. Cancel's file removal landed **~5 s after** "Cancelled" is shown.
* **Race, found by reading that lag:** a Retry inside that 5 s starts a new run on the same paths and the old run's
  late cleanup could delete them. Cancel + instant retry (L4) completed intact, byte-identical, so I could NOT make it
  fail. Added a per-job run number so a stale cleanup does nothing (`generation` in aria2.ts). Defensive, unproven by failure.
* **Full disk, direct:** a 95 GB file with 77 GB free failed instantly: "Not enough free space for this download
  (needs ~95.0 GB, 77.3 GB free)…", no files written. (This check already existed; now seen working.)
* **Full disk, torrent — was missing, now added:** a torrent bigger than the free space started and would die far
  in. `core/diskSpace.ts` `spaceShortfall` + a check in the torrent poll: it **pauses with the reason** ("Not enough disk
  space: needs 129 GB more. Free some space or choose fewer files.") instead of failing, because the user can still pick
  fewer files. Real run: 205 GB torrent on a 77 GB disk paused at once, 0 bytes written; choosing only the 5 GB file via
  `torrent:select-files` resumed it within 3 s. `tests/diskSpace.test.ts` (5).
* tsc clean, vitest 1021/1021, vite build ok.

**Not proven:** (1) a disk that fills **during** a write (real ENOSPC) — needs a small volume and the shell is not
elevated, so no VHD could be made. To run it, in an **elevated** prompt:
`diskpart` → `create vdisk file=C:\lumina-small.vhd maximum=300 type=expandable` → `attach vdisk` →
`create partition primary` → `format fs=ntfs quick` → `assign letter=V`; afterwards `detach vdisk` and delete the file.
(2) Space freed later than the pause (the unblock path was proven by shrinking the selection, not by freeing disk).
(3) Retry after a real disk-full failure. (4) The pause/cancel texts on screen. (5) Cancel of a **magnet** torrent
(only a `.torrent` file was used). (6) A stray `<infohash>.torrent` is left in the download folder after a run
(aria2's `--bt-save-metadata`); not changed, litter only.

## Full disk on a real 300 MB volume, and display audit (2026-10-23, later)

Details in `docs/19_DOWNLOADER_IMPROVEMENT_PLAN.md` and SESSION-LOG (42). Direct ENOSPC mid-write: now a friendly
message, no orphan partial, Retry completes. Torrent: the space check had a bug of its own (counted received bytes, not
allocated) — fixed, 246 MB torrent completes on 286 MB; pause→resume after real freeing seen. Still not run: torrent
ENOSPC mid-piece. The `V:` VHD still needs detaching by the owner.

## Rest of Phase B (2026-10-23, latest)

**Correction:** the "cancel's file removal lands ~5 s after Cancelled" finding above (and the race built on it) was a
measurement artifact — see `docs/19` S11. The `generation` guard in `aria2.ts` is therefore defensive only.
Also learned: `serve`-style rigs must start the seeder *before* the leecher, and Windows paths are case-insensitive
(scratch dirs `t2` and `T2` are the same folder). See SESSION-LOG (44).

## Phase B (2026-10-23, later): outages, wake, resume validation

See SESSION-LOG (43) and `docs/19` S2/S3. Rigs: `serve2.mjs` (outage + content change + ETag/If-Range) in the session
scratchpad — to be moved into `scripts/dl-lab/` (plan Phase E). Probes: `LUMINA_PROBE_WATCH`, `LUMINA_PROBE_WAKE_AT`.

## Items

| # | Item | Status | Evidence |
|---|---|---|---|
| 1a | B1 progress on the yt-dlp + aria2 path | **Done, proven on the real path** | below |
| 1b | HANDOVER §0 playlist question | **Settled by code**; the "0%" half is not reproducible | below |
| 2 | Parallel playlist downloads: concurrency, cancel, retry, full disk (B6, D19) | Not started | needs a local multi-item source (idea: a local RSS feed with enclosures, which yt-dlp's generic extractor turns into a playlist) |
| 3 | Extension bridge 17865, DLNA 8200, Sync: bind, true state when port taken, recover | Not started | |
| 4 | Lumina Sync PC↔TV protocol | Not started | design against `shared/contract` first; **show the owner the protocol before building** |

## 1a. Evidence

* **Reproduced (shell):** bundled yt-dlp 2026.08.19 + aria2c 1.37.0, argv from the real `buildDownloadArgs`,
  accelerate on. 30 MB direct file: 1 `LUMINA_DL|finished`, 0 `downloading` lines, aria2 readout every second
  (`[#be47bb 2.6MiB/30MiB(8%) CN:16 DL:1.3MiB ETA:20s]`) that nothing parsed.
* **YouTube takes this path too** (BUGS B1 listed it as unchecked): "Me at the zoo" = two aria2 downloads,
  video then audio, each followed by its own `finished`, `CN:1`.
* **Fix 1 (`src/core/progress.ts`, `ytdlpProgress.ts`):** parse the readout into an `aria2` event
  (summed over several downloads on one line); percent is the printed whole number (aria2 rounds sizes).
* **Fix 2 — found only by running the app, not the shell:** aria2 ends its last readout with no newline, so
  yt-dlp's next line is glued on (`[#88f7c9 … DL:44KiB]LUMINA_DL|finished|…`). The `finished` was swallowed, the
  audio stream never started, and the bar fell from 49% to 5% mid-download. `splitYtdlpLine` splits such lines;
  the same fusion would have eaten a `LUMINA_FILE` path.
* **Fix 3:** `finished` now completes the stream from its exact byte count (the last readout is 93–98%).
* Tests: `tests/aria2Readout.test.ts` (13, fixture = real lines). tsc clean, vitest 1004 passed (48 files), vite build ok.
* **Real app run (Electron, scratch profile, YouTube clip), 37 running samples:** 0 → 100, speed and ETA live,
  stage "Downloading video" → "Downloading audio" → "Merging…" → "Moving files" → completed, **0 backward steps**.
  Before the fix the same run fell 49% → 5% and said "video" twice.

### Not proven (1a)
* The Queue **row** was not photographed with a live job: the probe reads job state over IPC. The numbers
  are what the row is given; how it draws them was not looked at this session.
* Byte totals from the readout are aria2-rounded ("30MiB" for 30.6 MB). Only the finish line is exact.
* Native yt-dlp path (acceleration off) was not re-run; its code is unchanged except for line splitting.
* `CN:` (real connection count) is parsed but no UI shows it. Showing it is a visible change → needs a mockup + yes first.
* Playlist of many items on this path: see item 2.

## 1b. The playlist question

"One playlist download, or 433 separate downloads grouped?" → **one job**. `JobRow.tsx:84` is the only place
that prints `N of M` (from `progress.item`, set by a single yt-dlp playlist job); a group of separate jobs prints
`N of M done` (`ReleaseRow.tsx:50`). The remaining oddity — 0% beside 215 — cannot be produced by the current code
(`overallPercent` ≈ 49%); the build that showed it predates D15 and is not reproducible. Closed as "cannot reproduce".

## Next

Item 2. Build a local multi-item source, run a real job with `playlistWorkers` ≥ 2, then cancel, retry and
fill-disk cases. Look first at `planShards`/`aggregateProgress` (`src/core/playlistShards.ts`) and `ytdlp.ts`
`stop()`/`finish()`.
