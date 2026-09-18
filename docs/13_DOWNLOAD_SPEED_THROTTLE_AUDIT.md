# Download Speed — Full Throttle-Cause Audit

**Why:** user reports real-world speed far below the ~650 Mbps line (KB/s at times). This is a first-principles
sweep of **every** place the pipeline can throttle a download, what's been fixed, what's tuned, and what's
environmental (needs the user's machine/live check). Engine: yt-dlp (streams/sites) + aria2 (direct/torrent).

Legend: ✅ fixed in code · 🔧 tuned · 🌍 environmental / live-verify · ✔️ already fine.

---

## A. yt-dlp path (streams, sites, most "videos")

| # | Cause | Effect | Status |
|---|---|---|---|
| A1 | **Native single-connection HTTP downloader** for progressive links | 1 socket → the KB/s complaint on fast links | ✅ **Fixed** — http/https/ftp now routed through bundled **aria2c** (`--downloader …`, `-xN -sN`, N = Connections-per-file). Setting `downloads.accelerate` (default on). |
| A2 | **Cross-drive temp → output copy** on finish (temp was OS temp on C:, library often on D:/USB) | Full multi-GB copy after the download → looks "stuck at N GB", tanks perceived speed | ✅ **Fixed** — when temp and output are on different volumes, yt-dlp downloads **straight into the output folder** (same-volume rename on finish). Same-volume detection via `fs.stat().dev`. Ties into #30. |
| A3 | **YouTube `nsig` throttling** (the classic ~50 KB/s YouTube) | Heavy per-connection throttle unless the JS challenge is solved | ✔️ Mitigated — `--js-runtimes node:<electron>` (Electron-as-Node, always present). 🌍 **Verify live** that a YouTube download runs full speed; if not, the JS runtime isn't executing (check `ELECTRON_RUN_AS_NODE` reaches the child). |
| A4 | `--concurrent-fragments` (DASH/HLS parallel pieces) | Default **8**; more can help on fast links | ✔️ Reasonable; user-tunable (Settings ▸ Downloads, 1–16). Consider raising to 16 for very fast connections. |
| A5 | aria2 accelerator disk cache | Small cache stalls sockets at high throughput | 🔧 **Adaptive** — `--disk-cache` sized from system RAM (`core/tuning.diskCacheMb`, ≈16 MB/GB, floor 64 / cap 512). |
| A6 | `--limit-rate` / speed-limit schedule | A leftover speed limit silently caps everything | ✔️ Only applied when `speedLimitKbps > 0`; honored by aria2 too (`--max-overall-download-limit`). 🌍 Check the user hasn't a limit/schedule set. |

## B. aria2 path (direct files, file hosts, torrents)

| # | Cause | Effect | Status |
|---|---|---|---|
| B1 | Connections per server / split | Few connections = slow on multi-connection-friendly servers | ✔️ `--max-connection-per-server=16 --split=16 --min-split-size=1M`. |
| B2 | Disk cache | Small cache stalls at ~80 MB/s | 🔧 **Adaptive** — daemon `--disk-cache` sized from RAM (`core/tuning.diskCacheMb`, 64–512M) so it suits 1 Gbps up to 10–25 Gbps machines, not a fixed guess. |
| B3 | File allocation | `prealloc`/`falloc` can stall at start on huge files | ✔️ `none` on Windows, `falloc` (instant on modern FS) elsewhere. |
| B4 | Global download limit | An accidental cap throttles all | ✔️ `max-overall-download-limit=0` (unlimited) unless a speed limit is set (`dynamicOptions`). |
| B5 | `max-concurrent-downloads` | Too low queues hand-offs | ✔️ `max(32, concurrency+16)`. |
| B6 | Torrent-specific (peers, encryption, DHT) | Few peers = slow torrents | ✔️ maxPeers/DHT/PEX/LPD/tracker list all set; not an HTTP-speed factor. |

## C. Queue / app-level

| # | Cause | Effect | Status |
|---|---|---|---|
| C1 | **Concurrency** (`downloads.concurrency`, default 3) | 3 downloads **share** the pipe → each looks slow | ✔️ By design. For max single-file speed, set to 1 (surfaced in Settings copy). This is the intended lever behind feedback #31. |
| C2 | Post-processing counted as the job (convert / TV-safe transcode / embed / square-art) | The job sits in "processing" after the bytes are done → feels slow though the network part finished | ✔️ Expected; it's CPU, not network. Could label it more clearly (minor UX). |
| C3 | Per-file-host page pacing (free hosts rate-limit per IP; countdowns) | Slow *start* on file-host links, by the host | 🌍 External; Lumina already blocks ad/redirect nets and drives the page. Not our throttle. |

## D. Environmental (needs the user's machine / live check) 🌍

| # | Cause | What to check / do |
|---|---|---|
| D1 | **Antivirus real-time scanning** writes | Real-time AV can gate disk writes at high speed. Try excluding the temp + library folders. |
| D2 | **Broken IPv6** | If IPv6 is advertised but dead, connections stall/retry. Toggle **Use IPv4 only** (Settings ▸ Network) to test. |
| D3 | **Proxy/VPN** | A slow proxy/VPN caps everything. Check Settings ▸ Network ▸ Proxy is empty (or fast). |
| D4 | **Disk speed** of the destination | A slow USB/HDD or a near-full SSD caps sustained write. Same-volume temp (A2) removes the double-write. |
| D5 | **The source server itself** | Some hosts cap per-IP/per-connection; multi-connection (A1/B1) helps but can't beat a hard server cap. |
| D6 | **Wi-Fi vs Ethernet / ISP** | 650 Mbps is the line rate; Wi-Fi, peering, and the CDN edge all cap real throughput. Compare a browser download of the same file as a baseline. |

---

## A note on very fast links (1 → 25 Gbps) and "universality"
`--disk-cache` is a **write-smoothing buffer, not a rate cap** — a small value never limits download speed, it only
smooths bursts, so no user is "bottlenecked" by it. It's now **RAM-adaptive** (`core/tuning.diskCacheMb`) so every
machine gets a fit-for-purpose buffer without a hardcoded number. Past a point the buffer stops mattering, and the
real ceilings at 10–25 Gbps are: **destination disk write speed** (need NVMe/RAID to sustain 1.25–3 GB/s),
**connections/splits** (capped at 16 per server — usually the server's own limit anyway; a future setting could
raise it for niche cases), and the **source server / CDN**. No app setting overcomes those hardware/server limits.

## Changes made this pass (verified: tsc + tests + build + self-test boot)
- **A1** yt-dlp aria2 accelerator (prior session), **A5** `--disk-cache=64M` on it.
- **A2** volume-aware temp: cross-drive downloads go straight to the output folder (no end-of-download copy).
- **B2** aria2 daemon `--disk-cache` 32M → 64M.

## Still to verify live (user)
A1 real speed + progress still updates · A2 large cross-drive download no longer stalls at the end · A3 YouTube
full speed · plus the environmental checks (D1–D6). A quick baseline: download one public test file (e.g. Big Buck
Bunny) with concurrency = 1 and watch MB/s; compare to the same file in a normal browser.
