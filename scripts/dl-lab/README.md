# The download lab

Small servers and checks for testing the download engine against **real failure**, not just unit tests. Each of these found a
real bug in Lumina (stalls, silent corruption, a download left running after Cancel, progress lost on quit), and none of them
can be reproduced by `vitest` alone. They were scattered through a temporary folder; they live here so they can be re-run.

All of them use only local servers and generated data (no real sites, nothing copyrighted: see AGENTS.md rule 2). Run from the
repository root. They need Node and the bundled `aria2c` (`resources/bin/<platform>/`).

| Script | What it does | Example |
|---|---|---|
| `swarm.mjs` | A tracker plus N throttled aria2 **seeders** on 127.0.0.1 and a generated `.torrent`. Each seeder is capped, so N seeders let a leecher reach up to N times the cap **only if it really opens several peer connections**: the test for "parallel connections to a torrent". `DOWN_AT`/`UP_AT` take every seeder away and bring them back (stall recovery). | `SEEDERS=3 SEED_KBPS=1024 node scripts/dl-lab/swarm.mjs <workdir> 120` |
| `range-server.mjs` | HTTP server with Range, ETag and `Last-Modified`; `RATE` (MB/s **per connection**), `OUTAGE="down,up"` seconds, `CHANGE=1` swaps the content during the outage. For resume, network-loss and "file changed on the server" tests. | `RATE=0.1 node scripts/dl-lab/range-server.mjs 18720 300` |
| `quit-and-resume.mjs` | Stops aria2 3.5 s into a download (`kill` = the old way Lumina quit, `graceful` = `aria2.shutdown`), restarts it and prints which byte offset the resume asked for. Measured: after `kill` the restart began again from zero; after `graceful` it resumed at 22 MB. | `node scripts/dl-lab/quit-and-resume.mjs graceful <outDir> <aria2c> scripts/dl-lab/range-server.mjs` |
| `fake-torrent.mjs` | A `.torrent` that claims a huge file (no data, no seeder), for the "does it fit on the disk" check. | `node scripts/dl-lab/fake-torrent.mjs out.torrent 200` |
| `rpc-stall.mjs` | Does aria2's RPC stop answering while it writes a big file on this disk (the NTFS zero-fill stall)? | `node scripts/dl-lab/rpc-stall.mjs none 2 60 <outDir>` |
| `disk-gap.mjs` | How long one small write takes far past the end of a fresh file (sparse or not). | `node scripts/dl-lab/disk-gap.mjs <dir> 20` |
| `watch-folder.mjs` | Logs a folder's names and sizes whenever they change, with **absolute** clocks (a relative-time watcher once reported a "5 s cancel lag" that did not exist). | `node scripts/dl-lab/watch-folder.mjs <dir> <log> 300` |

## Driving the real app

The app's own harness runs a download through the real IPC path and records what the Queue shows (see AGENTS.md §3):

```bash
npx vite build        # first: electron runs dist-electron, which tsc and vitest do not rebuild
LUMINA_PROBE_URL=<url or path to a .torrent> LUMINA_PROBE_DIR=<scratch>/dl LUMINA_CAPTURE=<scratch>/cap \
  LUMINA_CAPTURE_ONLY=probe- LUMINA_PROBE_SECS=170 env -u ELECTRON_RUN_AS_NODE \
  ./node_modules/.bin/electron . --user-data-dir=<scratch>/profile
```

The samples land in `<scratch>/cap/probe-download-url.json`. Other probe switches live in `src/main/capture.ts`
(`LUMINA_PROBE_MODE=lifecycle`, `_FAST_RETRY`, `_SELECT`, `_FULLDISK`, `_CANCELONLY`, `_WATCH`, `_WAKE_AT`, `_CRASH_AT`).
Always pass a fresh `--user-data-dir`: the person's own Lumina may be running.

## Pitfalls that cost hours

* **Let the seeders hash before the leecher arrives** (`swarm.mjs` waits `READY_AFTER_S` before its tracker answers). A leecher told
  "no seeds" does not ask again for the announce interval.
* **`fs.writeSync(fd, string, 0, 'latin1')`: the 0 is the file position**, not an offset into the string. The swarm's data
  generator once wrote every block at the start of the file, so the seeders held one valid piece (their own log said
  "Checksum error detected") and every leecher, aria2 included, crawled at tens of KB/s. Give the seeders a log (`swarm.mjs` does)
  before blaming the engine.
* A saved `<sha1>.torrent` file name is **not** the info hash. Windows paths are case-insensitive (`t2` and `T2` are one folder).
  Folder-watcher clocks must be absolute.
* `RATE` in `range-server.mjs` is per connection, and aria2 opens 16: `RATE=3` is 48 MB/s, not 3.
