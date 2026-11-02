# Changelog

Notable changes to Lumina, written for the person using it rather than the person building it.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Engineering detail lives in `SESSION-LOG.md`, reasoning in `DECISIONS.md`, open defects in `BUGS.md`.

---

## [1.2.0] — 2026-11-02

A release about big downloads and about not losing them. Most of it came from testing with very large files and from reading the log of a
download that kept getting stuck.

### Added
- **Download over more than one network connection at once.** Settings › Downloads › "Network connections to use" lists your connections
  (Wi-Fi, Ethernet, a phone shared over USB). Tick two or more and a download is shared between them. Lumina measures each connection for
  a few seconds when it starts and gives the faster one more of the work, so a slow connection no longer holds a fast one back. It only helps
  when the connections are separate internet lines (two adapters on the same router share one line). It applies to file downloads, not to
  torrents, and the measurement is taken once, at start-up. Measured with a 34 MB/s phone connection and a 2 MB/s Wi-Fi: 40 MB/s together,
  against 34 MB/s for the phone alone.
- **Move a torrent to another drive.** In a torrent's details, **Move…** carries what is already downloaded to another folder or drive and
  carries on from there. When a torrent does not fit on its drive, the message now names a drive that has room.

- **Lumina TV 0.3.0** (the Android app, version 0.3.0): it now steps the picture down a quality by itself when a video keeps running
  dry, instead of cycling "playing, loading, playing, loading", and it waits for a little more data after a stall before resuming. The
  video controls are readable over a bright picture (white times, a darker band behind the controls). The recommended videos now favour
  tech, programming, AI, study and money-skills videos, follow the tech and learning videos you have watched on that device, and leave
  out Shorts and entertainment clips; with nothing watched yet they start from a few evergreen topics that change daily. If your TV is on
  a 2.4 GHz Wi-Fi network, connecting it to a 5 GHz one is the biggest improvement to streaming of all.

### Fixed
- **Searching for "Lumina" in the Windows Start menu finds the app.** A copy of Lumina run from source registered a shortcut named
  "Electron" under Lumina's own app identity, so Windows offered an app called Electron instead of Lumina. A run from source now uses its own
  identity.
- **A download no longer fails when you wake the computer from sleep.** The time spent asleep was counted as the download engine not answering,
  and a healthy engine was stopped.
- **Changing a network or torrent setting no longer drops your torrent connections** while something is downloading or seeding.
- **A big download that is already partly on disk is no longer refused for lack of space.** Only what is still missing has to fit.
- **A new download starts straight away.** It used to wait up to 15 seconds for a check that only matters when resuming.
- **A full disk is said plainly** ("The disk is almost full…") instead of the download restarting over and over, and a torrent that was paused for
  lack of space no longer flips between paused and running as free space changes.
- **A finished download shows its exact size**, not a figure a fraction of a percent short.
- **Choosing which files of a torrent to download works after the connection was re-made.** It used to fail with "Cannot change option".
- **Torrents with thousands of files update more smoothly.** The progress check no longer reads every file once a second.
- **A settings file saved with a byte-order mark** (Notepad does this) is read, instead of being replaced by the defaults without a word.
- **The optional speed limit can be set above 1 GB/s** (the new maximum is 100 GB/s), for connections and disks faster than that. Lumina itself
  sets no speed ceiling: the default is unlimited, and the write buffer only smooths writes. Measured on a fast SSD with an unthrottled local
  source, the download ran at 287 to 399 MB/s and the disk-write rate followed it almost one for one.
- **"Connections per file" starts at 8, not 16** for new installs. On the test line 8 was fastest and 16 was slower. Your own choice is kept.

### Tested
- Direct downloads of 4 GiB and 100 GiB were checked byte for byte against their source, including a pause and resume part-way. A 200 GiB
  download completed at the same speed (about 340 MB/s on a fast disk); it was not checksummed. A 50 GiB torrent and a torrent of 3,000
  files were checked the same way, and the download engine was killed twice during the 50 GiB one and recovered each time.

## [1.1.0] — 2026-10-27

The first release published on GitHub. Earlier builds were numbered 3.0.0-alpha.0 and 3.0.0; those numbers were never published and
are retired, so this is version 1.1.0 and numbering continues from here. If you have one of those builds installed, Lumina will not offer
this as an update (its number is lower), so run the installer yourself. Your downloads and settings are kept in your user folder.

Lumina comes in two Windows installers. **Standard** is the downloader, the player and the built-in browser. **Full** adds the code
editor, terminal, source control and MCP client. A feature left out of Standard is not in the program at all, so it costs no memory.
There is also an Android app (0.2.0) with its own version number.

### Added
- **Play a link without downloading it.** A Play button sits beside Download in the link bar and on the result card. It plays web pages
  (YouTube-style sites), direct audio and video files, and stream links (HLS/DASH) straight in Lumina's player, with seeking, and
  nothing is saved to disk. Torrents and file-host download pages have no Play, because there is nothing to stream until they are downloaded.
  A DASH stream (as opposed to a plain file or HLS) can take around ten seconds to open.

### Changed
- **A lighter link bar.** A shorter heading, one quiet line of text, and a single bar with Torrent and Paste as icons, then Play and Download.
  The dashed ".torrent" box is gone (drop a .torrent anywhere on the window). Once a link is read, the card shows a title, one line of facts
  (site, length, format, best quality, size), a quality menu and a folder, and Play / Download; format, subtitles and series choices are under
  "More options".
- **The Queue tells you more about each download.** A download whose size the website never gives now shows how much has arrived
  (instead of a stuck "0%") with a moving bar; a paused download says how far it got ("1.2 GB of 1.9 GB"); a finished one says its
  size, how long it took and its average speed. A small label next to the title shows how many connections are open, and says
  when Lumina is saving to disk, reconnecting, or waiting for the network.

### Fixed
- **A stream link with no listed resolution was taken for a song.** Apple's HLS test stream is one: its video was ignored, so the link was
  read as music and would have downloaded as audio only. Such links are now read as video.
- **A link to a file that is gone now says so at once** ("The file wasn't found on the server (404)") instead of opening a download-page
  flow and waiting for you to finish it. The same goes for a server that cannot be reached.
- **Pages whose address ends in a video file name** (such as Wikimedia Commons file pages) are now read by their site's own support
  instead of being mistaken for a file host's download page.
- **Error messages for links are readable.** No more curl codes, links to curl's manual, or "caused by TransportError". A site that needs
  you signed in says so, and a site that does not answer (or is blocked on your network) says that and points you at Settings › Network.
- **A download waiting for your connection no longer looks like a failure.** It stays with your active downloads in a calm amber, and
  a link Lumina could not reach shows an amber "couldn't reach that site" card, not a red alarm.
- **Quitting Lumina no longer throws away a download's progress.** Lumina used to close its download engine so abruptly that it
  never saved where each download had got to, and a download restarted from the beginning. It now lets the engine save first
  (a few seconds at most), and saves its place every 10 seconds rather than every minute.
- **A download that stopped with "control file does not exist" now carries on** under a new name instead of failing, and Lumina
  can no longer delete a file of yours that happens to have the same name.
- **Downloads recover from a dropped connection on their own.** A lost connection ("fetch failed", a timeout) is waited out and
  resumed from where it stopped, instead of ending as a failure you had to retry. Failures now say what happened in words
  ("The server took too long to answer") instead of "aria2c exited with code 22" or "The operation was aborted due to timeout".
- **Starting a large torrent that is already partly on your disk waits longer** before giving up, instead of failing with "timeout".
- **If the fast download mode is refused by a site, Lumina retries once with a single connection** instead of giving up.
- **A crash in one part of Lumina no longer takes the rest with it.** The window comes back by itself if its page crashes
  (your downloads keep running meanwhile), and an unexpected error no longer pops up a raw error box.
- **Lumina no longer launches PowerShell every five seconds** to look for USB drives. It checks the drive letters cheaply, so a
  plugged-in drive is still noticed within a few seconds, and otherwise it stays quiet.
- **Volume above 100%** no longer makes the tray's "now playing" state go stale.
- **Albums with a damaged picture tag** show the cover from their folder instead of nothing.
- **The taskbar progress** reflects how much of the total has been downloaded, not the average of each download's percentage; the
  sidebar speed shows slow downloads instead of a dash; the time remaining no longer jumps about.
- **The log file** no longer grows without limit while Lumina stays open for weeks.

---

## Earlier builds, never published

These two builds were numbered 3.0.0-alpha.0 and 3.0.0. They were used on one machine and never released on GitHub, and the
numbering was reset to 1.1.0. Kept here because the changes are real and still part of Lumina.

## [3.0.0] — 2026-09-25 (never published)

### Added
- **The volume goes to 200%.** Quiet recordings, laptop speakers and noisy rooms all need more than
  the 100% a browser will give you. Past 100% a limiter keeps the extra loudness from turning into
  distortion, and below 100% nothing is added to the sound at all. The reading is shown beside the
  slider, and double-clicking it returns to 100%.
- **Like the song you are listening to.** A heart on the player, or the H key. Liking used to be
  reachable only from the Library, which is the wrong moment.
- **A shield in the browser.** Ads, trackers, malware hosts and cookie-banner nagging are blocked
  *before the request leaves your computer*, not hidden after arriving. The shield button counts
  what it stopped on the page you are on and names it, and one switch turns it off for a single site
  when something breaks. Pages are also upgraded to https where the site supports it. It works out
  of the box with a built-in list and refreshes the public lists weekly.
- **Every track plays at the same volume.** Lumina measures how loud each song really is and evens
  them out, so you stop reaching for the volume knob between tracks. It also fixes something you
  could hear but not name: most loud modern masters peak above what the format can hold and clip
  during playback, which sounds harsh and flat. Seven of eight tracks in a test library did exactly
  that. Turn it off under the speaker icon in the player if you prefer songs at their own level.

### Changed
- **A long playlist downloads several songs at once** instead of one after another. Measured on a
  433-song playlist: most of the time was spent waiting rather than transferring, with the
  connection running at about a third of its speed. Four at a time takes roughly 53 minutes down to
  roughly 13. Adjustable if your connection prefers fewer.

### Fixed
- **A downloading playlist finally shows something that moves.** The percentage used to describe the
  whole job, so on a 433-song playlist one song was 0.23% of it: the number sat on the same value
  for five songs at a time, started at 0%, and the bar crept a quarter of a percent per song. There
  was nothing wrong with the download — it was simply the wrong figure to show. The song being
  fetched now gets the big number and the main bar, with the playlist's own progress on a thinner
  bar beneath it.
- **Downloads say what they are doing.** Every music download reported a flat "Processing" during
  its longest phase, because the names Lumina matched on were not the names the downloader actually
  prints. It now says "Extracting audio", "Merging video and audio", "Writing metadata" and the rest.
- **Shuffle plays your whole queue.** It used to pick a song at random each time, so some came round
  again quickly while others never played at all. It now shuffles the queue properly and plays
  everything once before repeating anything.
- **Previous works while shuffling.** It used to jump to yet another random song; it now goes back
  to the song you just heard.
- **The volume-matching switch takes effect straight away** instead of waiting for the next song.
- **The app starts again after the volume was left above 100%.** Saving a boosted volume and
  restarting showed "Lumina couldn't start".
- **Music copied to a drive is filed sensibly.** Tracks used to be filed as `Artist/Album/Title` even
  when the album tag was unique to a single song, so a television showed one folder per song, each
  containing that song and a picture. Albums are now used as folders only when more than one exported
  track belongs to them; everything else sits directly in `Music/`. On a 455-song library that is 42
  folders instead of 383.
- **No stray cover image beside single tracks.** A folder picture is written only where the folder
  genuinely holds an album.

### Builds

Lumina now ships in three Windows builds from the same source. They are alternatives — install one.

| Build | Contains | Renderer size |
|---|---|---|
| **Lumina** | Everything: downloader, player, browser, code editor | 16 MB |
| **Lumina (no editor)** | Downloader, player, browser | 1.1 MB |
| **Lumina Player** | Downloader and player only | 1.1 MB |

An excluded feature is genuinely not in the build — its code is never bundled, not hidden behind a
switch. The installer download is a similar size for all three regardless, because it is dominated
by the bundled media tools (ffmpeg is ~180 MB, the offline-subtitles model 142 MB, yt-dlp 18 MB),
not by the app.

### Documentation
- Added `AGENTS.md` (canonical working rules), `CLAUDE.md`, `DECISIONS.md`, `BUGS.md` and this
  changelog, so an agent or a new contributor starts from written rules instead of re-deriving them.

---

## [3.0.0-alpha.0] — 2026-09-19 (never published)

First packaged build installed and used on a real machine.

### Added
- **Play on a television, three ways.** Share the library over DLNA (`Settings › Share to TV`), copy
  it to a USB drive converted to a TV-friendly format, or carry Lumina itself on the drive.
- **Artwork is embedded into the files themselves**, so a television or car stereo shows a picture
  for every track instead of a blank tile.
- **Video has its own player**, full-bleed, instead of borrowing the music player's layout.
- **Portable mode** — Lumina on a stick keeps its library, settings and playlists beside the
  executable and leaves nothing behind on the host machine.
- **Copy Lumina onto a drive** from `Settings › Portable drive`, with a refusal to write program
  files into a folder that already holds your own.
- **An editor** with importable themes, a run panel that finds the ports a task opens, and source
  control.
- `Menu.cmd` in the project root for builds, releases and everyday tasks.

### Fixed
- **Copying Lumina to a drive no longer stops part-way.** It failed at roughly 349 MB of 732 MB
  because the copy walked *into* the packaged application archive instead of copying it as a file.
- **Videos show their real thumbnail in the Library.** Every video with an embedded thumbnail — which
  is every video Lumina downloads — showed a placeholder gradient, because the command asking ffmpeg
  for the cover art selected nothing at all.
- **A cover picture sitting beside your music is used.** Previously only artwork embedded inside the
  file counted, so a library organised with `cover.jpg` files showed placeholders.
- **Settings tells the truth about connections.** The browser extension reported itself as listening
  when its port was taken by another program, and "Share to TV" showed an *on* switch beside the word
  "Off". Both now report what is actually happening, and say what to do about it.
- **Progress bars stop pretending.** The looping "loading" animation is reserved for when nothing is
  known; a real bar deepens in colour as it advances.
- The Files tab no longer lists Lumina's own torrent bookkeeping as though you had downloaded it.

### Known issues
See `BUGS.md`. The significant ones: downloads still do not show a trustworthy percentage or speed;
playback is quieter than Spotify and YouTube Music; the equalizer is not yet a real one.
