# 14 — Lengine: the Lumina download framework

**Status:** design, 2026-10-11. Nothing here is built yet. Read `AGENTS.md` §1 first — the hard rules bound this design.

Every claim carries an evidence label, because this project has repeatedly built on claims nobody checked:

* **[measured]** — run on the dev machine on 2026-10-11, numbers quoted.
* **[read]** — read in the code at the cited `file:line`; not executed.
* **[doc]** — taken from the vendor's primary documentation.
* **[recalled]** — from general knowledge, not checked in this session. Verify before building on it.

---

## 0. What the evidence says (the design rests on these)

| # | Finding | Label |
|---|---|---|
| E1 | With acceleration on, yt-dlp hands plain http(s) downloads to aria2c and emits **exactly one** `LUMINA_DL\|finished` line and **no** `downloading` lines during the transfer (two captures, 5 MB and 30 MB). The live data is in aria2's own readout, `[#id 7.3MiB/29MiB(25%) CN:16 DL:5.1MiB ETA:4s]`, which reaches stdout — and nothing in `src/` parses it (`parseYtdlpLine` accepts only its four prefixes). So on this path Lumina receives **no live percent, speed, ETA or connection count**. This contradicts the claim in `BUGS.md` B1 that no `[#…]` line reaches stdout. | measured |
| E2 | aria2's parallel connections are **real**: `CN:16` reached with `-x16`. They bought **no speed**: 1 vs 16 connections took 38.8 s vs 38.7 s for the same 30 MB file; an earlier run of 1 / 4 / 16 all settled at ~6 MiB/s. | measured |
| E3 | The line is the ceiling. Cloudflare's public speed endpoint: **1 stream 2.8 MB/s, 4 streams 3.0 MB/s aggregate (~24 Mbit/s)**. This matches the project's earlier "~25 Mbit/s" and not the "~650 Mbps" in `HANDOVER.md`. Same sample file ran 0.85 MiB/s in one run and 6.6 MiB/s minutes earlier — cause unknown (line load or host throttling). | measured |
| E4 | Every hosted link gets a brand-new in-memory cookie jar (`hosters.ts:69`, partition = fresh UUID, wiped in `finally`). A human check solved for file 1 is **forgotten**, so N files = N checks. | read |
| E5 | After the page is driven, **all** its cookies go to aria2 (`hosters.ts:263` → `aria2.ts:424`), including any Cloudflare clearance. Cloudflare says that cookie is "securely tied to the specific visitor and device" and advises against reuse from another client. This is the grey zone of AGENTS.md rule 1. | read + doc |
| E6 | The filename the host sends is discarded: `inspectHosted` always sets `direct.filename` (to `'download'` when the URL has no extension), so `aria2.ts:411` never applies the resolved name. Extension-less host links save as `download`, `download (1)`. | read |
| E7 | `core/hosts.ts:93` treats "you have to wait …" as `blocked`, and the resolver throws on `blocked` **before** it looks at the countdown. A page that merely says "You have to wait 5 seconds" can fail the download and trip auto-retry. Wording-dependent — must be confirmed against the mock host (§4.4). | read |
| E8 | The engine is chosen once, in `queue.addFromInfo`, from `sourceKind`. There is no fallback between engines, no re-resolve when a signed link expires, and the in-app browser forwards only the URL (`index.ts:66`) — no cookies, referer or headers. | read |
| E9 | Turnstile **widget** tokens are single-use and valid 300 s. A Cloudflare **clearance cookie** is not single-use and covers the zone for the Challenge Passage duration. Two different mechanisms; "solve once" is achievable for the second and **not** for the first. | doc |
| E10 | `MpCmdRun.exe` custom scans need an **elevated** prompt (docs list `hr=80070005` otherwise). "Ask Defender to scan each download" is not available to a normal-privilege app. | doc |
| E11 | aria2 options Lumina does not use: `--lowest-speed-limit` (default 0 = a stalled connection is never recycled), `--uri-selector` (`inorder`/`feedback`/`adaptive`), `--max-resume-failure-tries`, `--max-file-not-found`. `--optimize-concurrent-downloads` exists. | doc |
| E12 | `ses.downloadURL(url, { headers })` exists and fires `will-download`; `DownloadItem` has `setSavePath`, `pause/resume/cancel`, `canResume`, `getETag`, `getLastModifiedTime`. Cookie semantics for `downloadURL` are not documented. | doc |

### What this changes

* "Faster" is **not** more sockets. On this line it is: overlap everything that waits (host timers, extraction, page resolves), avoid redundant work, recover stalls quickly, and learn per host whether extra connections help.
* The parallel-connection UI must come from **observed** values (`CN:`, `aria2.getServers`), never from the setting.
* "One check for many files" splits in two (E9), and the design must say which half it can deliver.

---

## 1. Goals, non-goals, constraints

**Goals**

1. From any link, find the real file — or the top few candidates — by looking around the link, and say how sure it is.
2. Drive multi-step host flows (landing page → click → redirect → timer → click → file) and stay stable on harder ones.
3. Ask the human **once per host session**, not once per link, where the mechanism allows it; otherwise make each check cheap.
4. Protect the device from whatever is behind a link.
5. Make downloads stable, make speed gains real, and make the UI show what is actually happening.

**Non-goals**

* Bypassing, solving or farming human checks, or spoofing automation signals (rule 1).
* Skipping server-side timers. The server enforces them; Lumina waits, and waits **in parallel** across files.
* A new native download engine as step one (§6 — it is gated on evidence).

**Constraints that bind every phase**

* `AGENTS.md` §1: no evasion; no infringing fixtures; verify before claiming; never commit unprompted.
* **Test fixtures never touch real file hosts.** Multi-part repack hosting is used here only as a *flow shape*. All flow testing runs against a local mock host (§4.4).
* Pure decisions in `src/core` with tests; I/O in `src/main`. The capture harness and a bench harness, not green checks, earn "done".

---

## 2. Architecture

```
 CAPTURE            NORMALISE        DISCOVER          RESOLVE            PLAN          GUARD→TRANSFER→GUARD
 ─────────          ─────────        ────────          ───────            ────          ────────────────────
 extension    ┐                      candidates        flow engine        pick the      pre-fetch guard
 in-app web   ├─▶ Lead ─▶ canon. ─▶ from headers, ─▶  (host session, ─▶  best          ─▶ Supervisor wraps
 paste/clip   │   (url +   + dedupe  DOM, network,     timers, forms,     Candidate +     aria2 / yt-dlp /
 protocol     ┘   ctx)     + group   manifests, API    human checks)      a Transport     in-session download
                                      │                    │             + fallbacks     post-download guard
                                      ▼                    ▼                              ─▶ finish / quarantine
                                  RANK (score, top-N)   Host Session store
```

Each box is a module with one job and a pure core where possible.

### 2.1 Core types (`src/core/lengine/types.ts`)

```ts
/** What the user (or a capture surface) handed us. Carries everything the capture surface knew. */
interface Lead {
  url: string;
  origin: 'extension' | 'browser' | 'paste' | 'clipboard' | 'protocol' | 'search';
  context?: { pageUrl?: string; pageTitle?: string; headers?: Record<string,string>; cookies?: CapturedCookie[] };
}

/** Something that might be the file the user wants. */
interface Candidate {
  id: string;                    // stable: hash of canonical url + method
  url: string;
  how: 'direct' | 'resolved-flow' | 'media-extractor' | 'manifest' | 'torrent' | 'api';
  evidence: Evidence[];          // why we think so — shown to the user
  score: number;                 // 0..1, see §3.3
  confidence: 'sure' | 'likely' | 'guess';
  probe?: { status: number; mime?: string; size?: number; ranges: boolean; filename?: string; etag?: string };
  group?: string;                // mirrors of the same file share a group
}

/** A recorded, replayable path from a page to bytes. */
interface FlowStep { kind: 'load' | 'click' | 'wait-timer' | 'submit' | 'human' | 'catch-download'; detail: string; at: number }

/** Why a transfer can or cannot keep going. Drives the retry policy (§8). */
type FailureClass = 'retry-now' | 'retry-later' | 're-resolve' | 'needs-human' | 'fatal';
```

### 2.2 State a job passes through (replaces today's single `running`)

`captured → normalising → discovering → resolving → waiting-host (timer / slot) → needs-you (human check) → queued → transferring → verifying → scanning → done | failed(class) | cancelled`

`waiting-host` and `needs-you` **do not hold a download slot** (today they do — queue finding queue-6, `queue.ts:211`).

---

## 3. Discovery: finding the real file

### 3.1 Sources of candidates (cheapest first)

1. **The URL itself**: extension, `Content-Disposition`, 1-byte ranged probe (exists in `inspect.ts`).
2. **Known resolvers**: host APIs (pixeldrain-style), the yt-dlp media extractors (kept as one resolver among several, not the whole engine), magnet/torrent.
3. **Page fetch + parse** (plain `fetch`, no JS): `<a href>` targets, `<video>/<source>`, `og:video`, JSON-LD `contentUrl`/`encodingFormat`, `<link rel=alternate>`, `meta refresh`, obvious `window.location=` strings, `<iframe>` embeds one hop deep.
4. **Rendered page** (hidden sandboxed window): the same extraction after scripts run, plus **network observation** — every response with a media/archive/octet-stream type or an attachment disposition becomes a candidate. This is what the extension already does for the user's browser; Lengine does it for hidden pages **and the in-app browser**.
5. **Manifests**: parse HLS master / DASH to list variants instead of treating the manifest as "the file".

### 3.2 Crawl discipline

* Breadth-first, **budgeted**: max depth 2 by default, max ~30 fetches, max ~60 s, per-host politeness delay. Loop protection by canonical URL.
* **Stay near the link**: follow only same-registrable-domain links, links to known hosts, and links whose text looks download-like. Never crawl a whole site.
* Everything fetched server-side goes through the SSRF guard (§7) and never forwards cookies cross-origin.
* Cache by canonical URL for a few minutes so the same link pasted five times does one crawl.

### 3.3 Ranking (initial weights are guesses — tune against the mock host and real captures)

| Feature | Direction |
|---|---|
| Confirmed by probe: `Content-Disposition: attachment`, or archive / media / installer MIME | strong + |
| Size plausible (not 0, not a few KB of HTML) | + ; tiny `text/html` strongly − |
| Extension is a payload type (`rar 7z zip iso exe msi mkv mp4 …`, `.partNN.rar`, `.001`) | + |
| Filename shares tokens with page title / link text | + |
| Link text: "download", "free download", "slow download" | + ; "premium", "fast", "buy", "torrent client" − |
| Reached by a click chain that ended in a browser download event | strongest + |
| Host is a known file host | + ; known ad / tracker host strongly − |
| Same-site navigation vs off-site hop | mild +/− |
| Part of a recognised multi-part set (siblings found) | + and grouped |

Present **top 3** with their evidence (“Found after clicking *Free download* → redirect → 5 s timer → 412 MB archive”). One is pre-selected when `confidence = 'sure'`; otherwise ask. Mirrors of the same file collapse into one candidate with alternates, which the transfer layer can use for fallback.

### 3.4 Dedupe and grouping

Canonical key = scheme/host lower-cased, default ports and fragments dropped, tracking params removed (exists in `cleanUrl`), host-specific id extraction where known. A duplicate paste **joins the existing lead** and tells the user so; it never starts a parallel job (queue-24). Multi-part sets group by the existing `splitVolume` logic (`core/batch.ts`).

---

## 4. Flow engine: multi-step host pages

### 4.1 Why the current driver is not enough

`PAGE_DRIVER` (`core/hosts.ts`) is one text-matching script run every 700 ms. It has no notion of *where it is* in a flow, so it cannot tell a timer from a block message (E7), a solved check from an unsolved one (finding hosters-3: the widget stays visible after solving, so `captcha` stays true and the driver never clicks), a failed page load from a slow one (hosters-15), or progress from a loop.

### 4.2 Model: a small state machine with observed transitions

States: `LOADING → LANDING → (INTERSTITIAL | TIMER | FORM | HUMAN | READY) → CLICKED → … → CAUGHT | DEAD | LIMITED | STUCK`.

* **Observations** are cheap and pure (`core`): visible controls with scores, countdown text, check widgets and their *solved* state, URL change, DOM mutation count, network responses. A pure classifier turns an observation into a state — unit-testable against saved HTML snapshots.
* **Actions** are the only effects: click (real input event), wait, reload, hand to human.
* **Per-host recipes** (small JSON: ordered hints such as `{ click: "#method_free" }`, `{ expectTimer: true }`) override the generic heuristic for hosts where it is wrong. Recipes are data, shipped and updatable without a release; they never contain code.
* Final file detection stays what it is today and is correct: the page session's own download event (`will-download`), cancelled, with the URL chain captured.

### 4.3 Timers and parallelism

A server-side countdown cannot be skipped, only overlapped. So: for N links on one host, open pages up to the host's concurrency limit (default 3, adaptive), run all their countdowns at once, and **park each finished page at the point where only a human click remains**. The human then clicks through them in sequence with no waiting. This is where the "multiple downloads" time actually goes.

### 4.4 The mock host lab (how this gets tested without touching real sites)

A localhost-only server in `tests/e2e/mockhost/` that reproduces each flow, so the engine is tested deterministically:

| Fixture | Behaviour |
|---|---|
| F1 plain timer | landing → click → 5 s countdown → enabled button → file |
| F2 redirect chain | landing → 302 → 302 → intermediate page → file |
| F3 form token | hidden input must be echoed on POST |
| F4 POST → redirect → file | a plain GET replay fails |
| F5 signed URL | expires after N s; second use 403 |
| F6 cookie-bound code | file selected by a cookie (the cross-contamination bug that motivated per-page jars) |
| F7 per-IP wait | "You have to wait 60 seconds" **as a real block**, vs F1's countdown wording (E7) |
| F8 one connection per IP | rejects parallel ranged requests |
| F9 no Range | ignores `Range` — checks the “parallel is fake” detection |
| F10 human-check **stand-in** | a local page with an “I am human” button that sets a cookie. It is not Cloudflare and never claims to be; it exercises the session/queue UX only |
| F11 dead file | 404 text page |
| F12 HTML pretending to be a file | `200`, `application/octet-stream`, body is HTML |
| F13 double extension / RTLO name | `invoice.pdf.exe` |
| F14 redirect into a private address | 302 → `http://127.0.0.1:…` (SSRF guard) |
| F15 multi-part set | `.part1.rar … .part12.rar` behind F1 + F10 |

---

## 5. Human checks: the Host Session model

### 5.1 The two mechanisms (E9)

* **(A) Clearance interstitial** (a managed challenge in front of the whole site). One solve grants a clearance that the *browser* then applies to every request to that zone, for the Challenge Passage duration. **Solve once per host is achievable.**
* **(B) Per-form widget** (a Turnstile / reCAPTCHA widget on each file's download form). The token is single-use, 300 s. **Each file genuinely needs its own solve.** Lumina cannot change that; it can make each one cheap (§4.3 pre-warming, one panel, auto-advance).

Real hosts mix both. The UI must say honestly which one it saw ("This site asks for a check on every file").

### 5.2 Host Session

* One **persistent partition per registrable host** (e.g. `lumina-hs-<site>`), replacing the per-link throw-away jar. It lives for the app session (cleared on quit unless the user opts to remember), is never shared between hosts, and is never exported.
* Every later link for that host loads **inside that same session**, so the browser applies its own state. For (A) the second file opens with no prompt.
* **Solved-detection** is fixed at the source: a widget is “solved” when its response token/field is populated or the clearance cookie exists in the *session* (checked in-process; the value is never read out), not merely when it is visible (hosters-3).
* **One panel, many files**: “*example-host* needs a check — **3 of 12** ready”. The person solves, the engine clicks on, the next parked page is brought forward. “Skip this host” drops the remaining files at once. Pages for other hosts keep progressing meanwhile.

### 5.3 Rule compliance — cookie replay (decision needed, see §11)

AGENTS.md rule 1 forbids harvesting and replaying a clearance. Today `capturedCookies` hands **everything** to aria2 (E5). Proposed, in order of preference:

1. **Replay only what the file request needs** and **strip Cloudflare clearance cookies** (`cf_clearance`, `__cf_bm`, `cf_*`) before building aria2's `Cookie` header. Most signed CDN links need none of them.
2. **If the CDN rejects it (401/403/challenge), move the transfer into the same browser session** via `session.downloadURL` + `will-download` + `setSavePath` (E12). The clearance never leaves the browser. Cost: Chromium's single-stream stack, no aria2 segmenting. Cookie semantics for `downloadURL` are undocumented, so this must be proven with a mock host before relying on it.
3. **Otherwise ask the user.**

Rejected: copying clearance into aria2/yt-dlp (violates rule 1, and Cloudflare says it is device-bound so it would fail anyway), and any automated solving.

---

## 6. Transfer: wrap first, build only if the evidence demands it

### 6.1 What aria2 and yt-dlp cannot do
(Verified against the aria2 manual where marked [doc]; the rest [read].)

| Gap | Today |
|---|---|
| Re-resolve a signed link that expired mid-transfer | neither tool can; the job just fails |
| Recycle a stalled connection | `--lowest-speed-limit` exists [doc] but is **not set**, so default 0 = never |
| Tell the user the real connection count on the yt-dlp path | data exists, **discarded** (E1) |
| Learn per host whether extra connections help | fixed 16 for every host |
| Fall back between strategies | none (E8) |
| Cheap polling | one RPC per job per second, each returning the full file list; `aria2.tellActive` / `system.multicall` would do it in one call |

aria2 **can** race mirrors (multiple URIs, `--uri-selector=adaptive`) [doc]. So a native engine is **not** needed for mirrors.

### 6.2 The Transfer Supervisor (Phase 4)

A layer around the existing runners — not a rewrite:

* **Transport interface** (`aria2`, `ytdlp`, `in-session`, later `native`) with `start / pause / stop / liveStats()`. Existing runners are adapted, not replaced.
* **Live stats from observation**: parse aria2's readout in `core` (fixture = the captured log from E1) for % / speed / ETA / **CN**; use `aria2.getServers` on the daemon path. The UI shows “6 connections · 5.1 MB/s”, from data.
* **Stall watchdog**: no progress for N s → recycle the connection (`--lowest-speed-limit`, plus a supervisor timer) → re-resolve the link → switch candidate.
* **Per-host connection tuner**: start at 1, ramp 1→2→4→8 while aggregate throughput rises > ~15 %, stop at the knee, remember per host. Back off on 429/503. This also self-detects fake parallelism (F9) and single-connection hosts (F8). On a saturated line (E3) it settles at 1–2 and does not hammer servers.
* **Fallback chain** per job: preferred candidate → alternate mirror → alternate transport → in-session download → ask.
* **Slot accounting**: only `transferring` and `verifying` hold download slots.

### 6.3 Gate for a native engine (Phase 6 — conditional)

Build a native segmented HTTP engine only if, after Phase 4, **measured** results fail one of: (a) hosts that cap per connection but allow many are not served by aria2 well enough; (b) HLS/DASH needs more than yt-dlp's `--concurrent-fragments`; (c) multi-interface aggregation (`BUGS.md` B6) is wanted — aria2 has `--interface` / `--multiple-interface` [doc], so check that first. Otherwise do not build it. Writing a downloader is easy; getting resume, Windows file behaviour, and edge cases right is the cost.

### 6.4 Where real speed comes from (measured basis)

1. **Overlap** host timers, page resolves and playlist extraction (D19 already does this for playlists; extend it).
2. **Skip redundant extraction**: inspection already ran yt-dlp; the download runs it again (the ~4.8 s/item). Reuse the info JSON (`--load-info-json`) where URLs are still fresh. *[recalled — verify with a timing run before relying on it.]*
3. **Honest tuning** (§6.2) instead of a fixed 16.
4. **A measured line speed** in Settings (“Your line: ~24 Mbit/s”) so nobody tunes for a link they do not have.

---

## 7. Guards: keeping the device safe

Principle: **fail closed on execution, never on download.** Lumina may fetch almost anything; it should be reluctant to *open, run or unpack* what it cannot vouch for, and honest about why.

| Stage | Guard | Status |
|---|---|---|
| Pre-fetch | **SSRF guard** for every server-side fetch: resolve DNS first, refuse loopback / private / link-local / metadata ranges unless the user typed that address; re-check **after each redirect**; pin the resolved IP to defeat DNS rebinding. (The legacy crawler had none — hosters-39.) | new |
| Pre-fetch | scheme allow-list (`http`, `https`, `magnet`); strip credentials from URLs in logs | partly exists |
| Pre-fetch | never forward cookies or `Authorization` cross-origin on redirects | new |
| During | hidden pages: sandbox, context isolation, no node, permissions denied, popups denied, navigation locked to the host family | exists — keep; fix guard timing (hosters-17/18) |
| During | **download sanity**: reject `text/html` bodies when a file was expected (F12), absurd size jumps, `Content-Length` lies | new |
| Post | **type sniff**: magic bytes vs MIME vs extension; flag mismatch and double extensions; flag RTLO / bidi characters in names (F13) | `core/verify` has headers for some types — extend |
| Post | **dangerous-extension class** (`exe scr msi lnk hta js vbs ps1 bat cmd jar iso …`) → risk tier | new |
| Post | **Mark-of-the-Web** on every output incl. torrents, unpacked files, ftp (queue-17: skipped today) | extend |
| Pre-unpack | `7z l -slt` listing check **before** extraction: absolute paths, `..`, symlinks, compression ratio, nesting depth. *[Whether 7-Zip already neutralises traversal by default is [recalled] — verify; do not rely on it.]* | new; `release.ts` lists for size only |
| Pre-open | **“Run setup” / open gating** by risk tier; never auto-run | new |
| Optional | Authenticode signature status for `.exe/.msi` via PowerShell `Get-AuthenticodeSignature` as an *informational* signal *[recalled — verify non-elevated]* | later |
| Not v1 | per-file Defender scan via `MpCmdRun` — needs elevation (E10). Windows real-time protection already scans on write; say so rather than implying Lumina scans. | rejected for now |
| Not v1 | hash-reputation lookups (VirusTotal etc.) — sends file identity to a third party; opt-in only | later, opt-in |

**Risk tiers, one action each** (avoids alarm fatigue): **Green** — media / documents / known-good types, opens normally. **Amber** — archives, disk images, anything with a type mismatch: “Scan before opening” hint, unpack allowed after the listing check. **Red** — executables and scripts, or a mismatch on an executable: held in a *Review* state, never opened or run until the person confirms, with the reason in plain words.

---

## 8. Reliability

### 8.1 Failure taxonomy → policy

| Class | Examples | Policy |
|---|---|---|
| `retry-now` | transient reset, 502 once | immediate retry, jittered |
| `retry-later` | 429 / 503 (honour `Retry-After`), host “wait 60 s” | back off with jitter; per-host circuit breaker; **does not burn the retry budget** |
| `re-resolve` | 403 on a signed URL, expired link, page changed | re-run the flow, then resume bytes |
| `needs-human` | check shown, stuck page | `needs-you`, no slot held |
| `fatal` | dead file, DRM, disk full, bad certificate | stop, say why, one action |

Replaces the substring regex in `queue.ts:126` (queue-8: `500` also matches “500 MB”; `eof` matches inside words).

### 8.2 Plumbing the audit flagged

* A `schedule()` re-entrancy guard and a status re-check in `start()` (queue-1: the same job can start twice and orphan its first runner).
* Do not re-download a finished-but-unverified file under a new name after pause/restart (queue-4; `aria2.ts:393`).
* Quit must wait for aria2 to flush (queue-5; `index.ts:286-287`).
* “When downloads finish” must count jobs awaiting auto-retry, and must re-check after the countdown (queue-22/23; `power.ts:41-52`).
* Split the **static** job (source, entries, options) from the **live** progress; broadcast and persist only the live part, rate-limited (queue-15).
* One poller for all aria2 jobs (`tellActive` / `multicall`) instead of one RPC per job per second.

---

## 9. UI / UX

* **Link grabber**: pasted or crawled leads land in a staging list — ranked candidates with the likely file highlighted and its evidence, grouped by host and package, duplicates collapsed, online status shown. Nothing starts until the person confirms (or has chosen “start sure matches”).
* **Honest status line per job**: “Waiting for host timer · 3 s” / “Needs your check” / “Downloading · 6 live connections · 5.1 MB/s” / “Verifying” / “Scanning”. No state may be an invented label.
* **Per-host strip** in Queue: host, session state (checked / needs check), concurrency in use, observed best connection count.
* **Batch check panel** (§5.2) instead of the single modal.
* **Actionable errors**: each `fatal`/`needs-human` shows one primary action (Open page, Retry, Choose another file, Free space).
* **Connection test** in Settings: runs the bench against public endpoints and shows the measured line speed and the connections knee.
* Keyboard operation and `Shift+?` help (`BUGS.md` B7) land with the grabber, not after.

---

## 10. Phases and exit criteria

Each phase is “done” only when its **exit evidence** exists. Tests alone do not count (AGENTS.md §3).

| Phase | Content | Exit evidence |
|---|---|---|
| **0 — make the truth visible** | Parse aria2 readout in `core` (fixture: captured log E1) → live %/speed/ETA/`CN` on yt-dlp downloads. Bench script + Settings connection test. Quick fixes: resolved filename (E6), countdown-before-blocked (E7), `schedule()` re-entrancy, no re-download on processing-restart, power-action fixes, link de-dupe, strip Cloudflare cookies from replay, slim job broadcast | a real yt-dlp download photographed in the Queue with live progress and connection count; bench output captured; each fix has a test pinning it |
| **1 — Lengine core (pure)** | `src/core/lengine/`: types, canonical URL + dedupe, candidate model + scorer, failure taxonomy + retry policy, SSRF guard, filename/type guard | unit tests incl. the F12–F14 cases |
| **2 — host sessions + flows** | per-host persistent session, solved-detection, pre-warming, batch panel, state-machine classifier, mock host lab F1–F11, F15 | mock lab run end-to-end; capture harness photographs the batch panel; “12 files, one host” measured against serial time |
| **3 — discovery + capture** | page parse, rendered-page network observation, in-app browser forwarding cookies/headers/referer, link grabber UI | grabber ranks the correct file first on the fixtures; in-app browser hand-off keeps an authenticated link working |
| **4 — transfer supervisor** | Transport interface, stall watchdog, re-resolve, fallback chain, per-host tuner, single poller, slot accounting | F5 (expiring link) resumes; F8/F9 detected; stall injected and recovered |
| **5 — guards** | type sniff, archive pre-listing, MOTW completeness, risk tiers + Review state | F12/F13/F14 refused or held; a hostile archive fixture refused before extraction |
| **6 — conditional** | native segmented / HLS engine, multi-interface | only if the §6.3 gate fails on measured numbers |

When Phase 1 starts, the **scoring weights** (§3.3) are the first piece I will hand to you to decide, because they encode what “the file you probably want” means.

---

## 11. Decisions needed from the maintainer

1. **Cookie replay (§5.3).** Approve: strip Cloudflare clearance cookies from the aria2 replay, and fall back to an in-session download when the CDN refuses. This touches AGENTS.md rule 1, so it is your call.
2. **Line speed.** Measured ~24 Mbit/s on 2026-10-11 against a documented ~650 Mbps. Which is right for the machine you actually use? It decides how much effort goes to parallelism versus overlap.
3. **Guard scope (§7).** Accept “heuristics + MOTW + review tier” for v1, with no per-file Defender scan (E10)?
4. **Fixtures.** Confirm all flow testing uses the local mock host only — no real file hosts, including repack hosts.
5. **Native engine.** Confirm it stays deferred behind the §6.3 gate.

---

## 12. Not proven

* No flow has been run end-to-end by Lengine; nothing in §4–§6 is built.
* E7 (a countdown line failing a download) is read from the code, not reproduced.
* The in-session download keeping working without exporting a clearance is a hypothesis (E12 leaves cookie semantics undocumented).
* `--load-info-json` reuse, 7-Zip traversal behaviour and `Get-AuthenticodeSignature` without elevation are **[recalled]**.
* The ~24 Mbit/s figure is one machine, one evening, one endpoint; the same sample ran 8× faster minutes earlier. It shows parallelism is not the lever *here and now*, not that it never is.
* The bug audit that fed this document covered only two of fifteen code slices (queue/scheduler and the host driver) and none of its 72 findings went through independent verification — see `BUGS.md`.
