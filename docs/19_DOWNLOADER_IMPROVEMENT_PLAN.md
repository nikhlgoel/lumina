# 19 — Making the downloader trustworthy, then fast

**Status:** plan, 2026-10-23. **Update 2026-10-26:** Phase E is done (the rigs are in `scripts/dl-lab/`); Phase B is joined by a
graceful quit, a crash guard and plain-words failures (BUGS B12, SESSION-LOG 45); D5, D7 and D8 are fixed (weighted taskbar
progress, slow speeds shown, smoothed ETA). D1, D2, D3 and D11 were built from the owner-approved mockup (BUGS B9, SESSION-LOG 46); D4, D6, D9 and D10 are still open. Written after a day of measuring the engine. Read `AGENTS.md` §1 first.
Related: `docs/13` (speed audit), `docs/14` (Lengine: hoster flow, discovery), `docs/desktop-services-plan.md`
(evidence log). This file does not repeat them; it adds what they did not cover — *stability under failure* and
*whether the screen tells the truth*.

Evidence labels: **[measured]** run here, numbers quoted · **[read]** read in code, not executed ·
**[doc]** vendor documentation · **[inference]** reasoning, not checked.

**Order of work:** make the numbers on screen true → make the engine survive failure → *then* chase speed.
A download manager that is fast but shows 0% for four minutes, or dies silently on a full disk, loses to one
that is slower and honest. The measurements agree: on this machine the link, not the engine, is the ceiling
(docs/13 E2/E3), so speed work has the smallest return.

---

## 1. What is already fixed (all on the real runner, none committed)

| # | Fault | Evidence |
|---|---|---|
| F1 | yt-dlp+aria2 path showed no live progress; a second cause (aria2's last readout glues onto yt-dlp's `finished` line) made the bar fall 49%→5% | [measured] 37 samples, 0→100, no backward step |
| F2 | Torrents/large files stalled at 0 B/s for good: NTFS zero-fills the gap before a far write (one 1 MB write 20 GB in = 37 s, 0 ms if sparse); aria2 serves RPC on that thread; Lumina read silence as death and killed it | [measured] 24 GB: 188 s + RPC timeouts → 73 s clean |
| F3 | Stall ladder (60/180/420 s: re-announce, re-add, restart) | [measured] torrent rig: resumed 94 s vs aria2 alone 125 s |
| F4 | A torrent larger than the disk started blind | [measured] 205 GB on 77 GB free now pauses with the reason; picking one file or freeing space resumes it |
| F5 | Full disk showed raw Windows text (`Failed to write into the file …\r\n`) | [measured] real 300 MB volume; now "The disk is full… press Retry" |
| F6 | A failed non-resumable download left its partial behind; Retry made `name (1)` and died of the same space | [measured] fixed; retry completes under the same name |
| F7 | The space check counted received bytes, but a non-sparse file's zero-fill is already on disk, so it blocked a download that fit | [measured] 246 MB torrent on 286 MB drive now completes |
| F8 | `formatEta`/`formatBytes` printed "2m 60s", "59m 60s", "1024 KB", "72h", "277777h 46m" | [measured] `tests/formatDisplay.test.ts` |

## 2. Display bugs still open — what the person sees

Photographed: a 2 MB/s download with no declared length, 14 s in (≈28 MB received) shows **"0%", an empty bar,
no bytes, no ETA** (`probe-shot.png`, session scratchpad) **[measured]**. The rest are read from code **[read]**
unless marked.

| ID | Where | Fault | Why it matters |
|---|---|---|---|
| D1 | `JobRow.tsx:87`, `core/progress.ts progressIndeterminate` | Unknown total ⇒ percent 0, and the bar is *determinate at 0%* because bytes > 0 turns the looping bar off. Bytes are only printed when a total exists, so **nothing moves on screen** | Looks frozen while data flows. Real for chunked/`Content-Length`-less servers, many CDNs and some hosters **[measured]** |
| D2 | `JobRow.tsx:136` | The percent number draws only while *active*; a **paused** 62% download shows a bar but no number, no "x of y", no ETA | A paused job should say where it stopped |
| D3 | `JobRow.tsx:119`, `queue.ts:274` | A **completed** row says "Done" (or the TV badge). No final size, time taken or average speed; for yt-dlp jobs `totalBytes` may be null | "How many MB did I get" is unanswerable after the fact |
| D4 | `format.ts formatBytes` | A genuine 0 bytes prints "—", so "0 B of 29 MB" reads "— of 29 MB" at the start of every download | Unknown and zero look identical |
| D5 | `tray.ts:121` | Taskbar progress is the **unweighted mean of percents** of active jobs (a 1 KB file at 100% and a 50 GB file at 1% ⇒ ~50%) and ignores bytes | The taskbar lies when sizes differ |
| D6 | `ytdlp.ts report()` | "item N of M" uses *finished + 1*, which is wrong while several workers run at once (D19); no per-worker view | Misleading during parallel playlists |
| D7 | `Shell.tsx:136` | Sidebar speed rounds to 10 KB/s: ≤5 KB/s prints "—" even while a slow download is moving | A crawling download looks dead |
| D8 | `aria2Progress` | ETA is computed from the instantaneous `downloadSpeed` **[inference]**: it will swing with speed; no smoothing of its own | Flickering ETA |
| D9 | queue rows after a restart | A *failed* job keeps its last percent/bytes, which read as current | Stale numbers |
| D10 | `jobGroups.summarizeGroup` | If any member lacks `totalBytes`, the group falls back to an **unweighted** mean of percents and prints no bytes at all | One unknown-size file hides the whole group's size |
| D11 | engine → UI | The engine now knows connection count (`CN:`), a "writing to disk" state, a stall-recovery state; the UI has no place for them beyond the stage text | Useful truth is discarded |

Not bugs, checked: aria2's `totalLength` follows the *selected* files of a torrent (5 GB shown for a 205 GB torrent
with one file chosen) **[measured]**, so torrent percent is right; `formatBytes` uses 1024 with "KB/MB" labels,
the Windows convention (some people expect MiB or 1000 — a Settings choice, not a bug).

## 3. Engine and stability gaps still open

| ID | Gap | Evidence / source | Idea |
|---|---|---|---|
| S1 | ~~Torrent `ENOSPC` mid-write~~ **Done 2026-10-23** | [measured] with the space check off, a 260 MB torrent failed at 63.7% with "Couldn't write to the disk… press Retry to resume"; Retry after freeing space completed **byte-identical**. With the check on, the same scenario *pauses* instead and resumes when space returns, so a real ENOSPC now needs the disk to fill between two 1 s polls | — |
| S2 | ~~No network-change / sleep-wake handling~~ **Done 2026-10-23** | [measured] outage 10→80 s: old build resumed at 199 s (119 s late, 3-try budget of ~12 min); now a network failure *waits* and probes at 5/10/20/30/60 s, resumed at 94 s, from 26% not 0%. Simulated wake (`powerMonitor` `resume` emitted) resumed 5 s after the server returned instead of waiting for the next probe | **Not proven:** a real sleep/wake; a *running* torrent after sleep still relies on the 60 s stall ladder (no wake nudge yet) |
| S3 | ~~Resume validation~~ **Done 2026-10-23** — and it was a real **silent corruption** | [measured] file changed during an outage ⇒ resume joined 80 MiB old + 170 MiB new, reported "Done". Now ETag/Last-Modified/size are remembered and re-checked before a resume: 0 old / 250 new, restart from zero | Skipped for proxies (plain fetch would bypass them) and file-host links (one-time URLs). **Not proven:** yt-dlp's own `.part` resume, hosted links |
| S4 | A slow connection is never recycled (`--lowest-speed-limit` default 0) | [doc] aria2 manual; **does not apply to BitTorrent** | For direct downloads only, a modest floor (e.g. 20 KB/s) lets aria2 drop and reopen a throttled socket. **Test before enabling**: it can also thrash |
| S5 | `--max-file-not-found`, `--max-tries` coupling; expired signed links are not re-resolved | [doc] manual; docs/14 E8 | Re-resolve on 403/410 mid-download (hoster flow) |
| S6 | `--bt-stop-timeout` is off (default 0) | [doc] | Deliberately left off: our ladder acts instead of killing the torrent |
| S7 | Small-file/`yt-dlp` children get no sparse flag | [measured] only big files matter (zero-fill ~540 MB/s here) | Skip unless a >256 MB yt-dlp download shows the freeze |
| S8 | exFAT/FAT32 targets: no sparse flag, and (doc) no `falloc` | [doc] aria2 manual: "Don't use falloc with … FAT32" | Detect filesystem; use `prealloc` there, with a visible "reserving space" stage |
| S9 | ~~Stray `<hash>.torrent` in the download folder~~ **Done 2026-10-23** | [measured] cause was aria2's `rpc-save-upload-metadata` (default on): every `.torrent` we upload over RPC is saved as `<SHA-1 of the FILE>.torrent` — not the info hash — and kept open while seeding. Turned off; a `.torrent` job now leaves no copy at any moment. A magnet's own metadata copy (`<info hash>.torrent`) is kept for resume and removed on cancel/complete | Magnet copy removal after completion is best-effort while aria2 seeds: not proven on a long seed |
| S10 | ~~Magnet cancel/retry~~ **Done 2026-10-23**, and it found two real bugs | [measured] (1) cancelling a magnet right after its metadata arrived left the **real download running unseen** (259 MB written after "Cancelled", Retry refused with "InfoHash is already registered") — `stop()` removed only the first of aria2's two downloads; (2) the row read **100%** during the metadata phase. Both fixed; cancel mid-download leaves an empty folder that stays empty, retry completes | Only a local rig; aria2 seeder + tracker, not a real swarm |
| S11 | ~~The 5-second lag between "Cancelled" and files deleted~~ **retracted** | [measured, corrected] with absolute clocks the files were gone within 150 ms of the cancel. The "~5 s" came from a folder watcher whose clock started ~5 s before the app's. The queue now shows "Cancelling…" until cleanup truly finishes (deleting a file aria2 still holds fails on Windows; it is retried) — a defensive guarantee, not a fix for a proven lag | — |

## 4. What the better downloaders do, and what to copy

Sources are linked; weaker evidence is marked.

* **Dynamic segmentation (IDM)** — a new connection takes *half of the largest remaining segment*, so no connection
  idles while another has a long tail ([IDM features](https://www.internetdownloadmanager.com/features.html), vendor
  claim). aria2 splits statically at start (`--split`, `--min-split-size`). **Measured here:** on this link extra
  connections gave no speed (docs/13 E2) and, before the sparse fix, 16 splits were *worse* than 1 on this disk — so
  copy the *idea* only where a measurement shows a long-tail problem, never as a default.
* **"Force reannounce" is the first thing people reach for on a stalled torrent**
  ([qBittorrent forum](https://forum.qbittorrent.org/viewtopic.php?p=33087), community guidance). Our stall ladder
  does this automatically; measured modest gain (94 s vs 125 s) because aria2 re-announces by itself eventually.
* **aria2 knobs** ([manual](https://aria2.github.io/manual/en/html/aria2c.html), **[doc]**): `--uri-selector=feedback`
  (default) already prefers faster mirrors; `--optimize-concurrent-downloads` adapts parallelism to bandwidth;
  `--stream-piece-selector=inorder` makes a partially downloaded media file playable from the start (useful for
  watch-while-downloading); `--conditional-get` skips unchanged files; `--file-allocation` default is `prealloc`,
  `falloc` on NTFS only in some builds (the bundled build behaved like `none` in our test).
* **What no search could confirm** (do not assume): Free Download Manager's recovery behaviour, and any browser's
  exact resume-validation rules. Test our own instead.

## 5. Roadmap — each step ends in a proof, not a green check

**Phase A — the screen tells the truth (do first; needs the owner's yes on a mockup, per `ui-needs-approval-first`)**
1. D1: unknown total ⇒ indeterminate bar **and** "28 MB downloaded · 2.0 MB/s" in the meta line. Proof: re-run the
   `LUMINA_PROBE_SHOT` capture (NOLEN server) and look at the picture.
2. D2/D3/D4: paused rows show "62% · 1.2 of 1.9 GB"; finished rows show "Done · 1.9 GB · 2 min · 16 MB/s"; a true
   zero prints "0 B". Pure decisions go in `core` with tests; photograph paused, completed, failed.
3. D5/D7: byte-weighted taskbar progress; sidebar speed shows real small speeds.
4. D6/D10/D11: group and playlist summaries use bytes when any are known; surface "writing to disk", "reconnecting"
   and the real connection count as small status chips.

**Phase B — survive failure (mostly engine; no new UI)**
5. S2 sleep/wake + online/offline. Proof: scripted offline (block the local server), expect pause → auto-resume,
   and a resumed file byte-identical.
6. S3 resume validation with a server that changes content mid-way.
7. S1/S10/S11 in the lab: torrent ENOSPC, magnet cancel, "Cancelling…" state.
8. S8 filesystem-aware allocation; S9 stop littering `.torrent` files.

**Phase C — then speed (measure each; keep only what wins)**
9. S4 `--lowest-speed-limit` for direct downloads; adopt only if a throttled-server test shows a gain and the
   no-throttle test shows no loss.
10. Long-tail test for dynamic segmentation (a server where one range is slow): if aria2's static split loses
    measurably, consider re-splitting the slow range; otherwise do nothing.
11. Multi-interface bonding (BUGS B6) stays last: it needs a second real link to even test.

**Phase D — know why it is slow**
12. A per-download "details" panel built from facts the engine already reports: per-server speeds
    (`aria2.getServers`), peers/seeds, tracker status, bytes written vs received, and the last recovery action.
    Plus honest totals: bytes today/this week, average speed, failures by reason.

**Phase E — keep the lab**
13. Move the session's scratch rigs into `scripts/dl-lab/` (range server with throttle/no-length, tiny swarm,
    fake huge torrent, folder watcher, small-volume recipe) so every item above stays re-runnable. These found five
    real bugs in two days; they should not live in a temp folder.

## 6. What would change the order

* If the owner's real RDR2 torrent still stalls after F2–F4, stop and instrument *that* (log `getPeers`,
  `getServers`, tracker responses) before any Phase B–C work. It is the only unproven headline claim.
* If Phase A's mockup is rejected, Phase B still stands on its own; nothing in B depends on A.
