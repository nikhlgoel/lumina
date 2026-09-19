# Lumina — Session Log

Append-only, newest entry at the top. Each entry: date, what changed, commit(s), verification, and what's next.
Read [HANDOVER.md](HANDOVER.md) first for the rules and full project state. **Update this file every session.**

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
`ENOENT, not found in C:Program FilesLuminaesourcesapp.asar`. The cause is Electron, not the copy logic:
a packaged `app.asar` is presented to `fs` as a **directory**, so `copyDir` walked *into* the archive and tried
to copy the files it believed were inside it. `measure()` had the same fault, reporting the archive's
uncompressed contents as the size to copy.

`src/main/portableInstall.ts` now takes its filesystem from `original-fs` (Electron's unpatched `fs`) via
`createRequire`, so the archive is seen as the one file it is. Scoped to this module deliberately, rather than
setting the process-wide `process.noAsar`, which would break every other read from the archive while a copy ran.

**Proven, not assumed.** A probe under real Electron against the installed `C:Program FilesLuminaesources`:

    app.asar via patched fs   : isDirectory=true  isFile=false
    app.asar via original-fs  : isDirectory=false isFile=true

    patched fs  (the bug): FAILED -- ENOENT,  not found in C:Program FilesLuminaesourcesapp.asar
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
