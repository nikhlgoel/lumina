# Changelog

Notable changes to Lumina, written for the person using it rather than the person building it.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Engineering detail lives in `SESSION-LOG.md`, reasoning in `DECISIONS.md`, open defects in `BUGS.md`.

---

## [Unreleased]

Not released yet; everything below is in the working tree only.

### Fixed
- **A playlist you had downloaded before no longer ends as "Done" with nothing in the folder.** Lumina remembered every YouTube video it had
  ever fetched in one list, so songs you had deleted, moved, or fetched as a video were skipped silently. It now remembers per kind (music or
  video) and per folder, notices when "already downloaded" songs are not actually in the playlist's folder and downloads them, and says
  "Nothing new" when they are. Checked in the real app: download, delete the files, ask again: the songs came back.
- **A saved sign-in that stopped working no longer sinks a public download.** If a link fails while the saved sign-in was in use, Lumina tries
  once more without it, and tells you.
- **"The download engine (aria2) did not start" no longer stops a download.** It happened when a network connection Lumina had saved
  (Settings › Downloading) was no longer there, for example after changing Wi-Fi. Lumina now skips connections that are not present, tells you
  which ones, and if the engine still cannot start it tries again in simpler ways before giving up. Checked in the real app with the exact
  setting that failed: the download completed.
- **A download that the engine forgot is put back at once.** If the download engine was restarted by one download's recovery, the others
  could sit "reconnecting" for two minutes and then restart it again. Checked by stopping the engine under two running downloads: before, one
  was still stuck at 150 s; now both finish in 40 s.
- **Torrents with few seeds no longer crawl because of Lumina's own upload limit.** With fewer than 3 seeds the limit is switched off, so
  other downloaders can feed the swarm.
- **Servers that send the wrong part of a file** ("Invalid range header") now get a retry on one connection, with a plain message if that
  fails too. The retry itself is only unit-tested; see `SESSION-LOG.md` (54).
- **Pop-ups for a release's parts come one after another faster:** once a check is solved, the next part's pop-up opens while the first page
  finishes (stand-in host, 6 parts: 39.6 s to 18.7 s). Each part may still ask for its own check.

### Added
- **Pages that list files now work.** Paste a GitHub release page, an open folder on a web server, or a page of download links and Lumina
  reads it for the files and shows them in the usual list to pick from (it used to say it did not recognise media on the page). Links to a
  file's page rather than the file (GitHub, GitLab, Codeberg, Hugging Face, Dropbox, Google Drive) are turned into the file itself.
  Checked in the real app with a GitHub release (6 files), an open folder (202 files) and a GitHub file page. Dropbox and Google Drive are
  not yet tried on a real file.
- **YouTube sign-in through your own browser.** Google refuses sign-in inside apps. The Lumina extension can now pass the YouTube sign-in your
  browser already has to Lumina (on this computer only), for private and age-restricted videos. Settings › Connections explains it.
  Not yet tried with a real private video.
- **The extension finds more download links:** buttons that only say "Download" are named after the file in their row, buttons that are not
  links (a data attribute or a click handler) are found, and a link labelled with a file name counts on any site. When a page offers the same
  files on several hosts, the extension starts on one host (Pixeldrain first) and lets you switch, so nothing is sent several times over.
- **A quick check you solve once now covers the rest of that site's files.** A release of fifty parts used to ask for the same human check
  fifty times. Lumina now remembers that you passed it, for that site only, in memory only and for at most half an hour, and the other
  parts go through. Files already waiting for their turn are cleared by the same click. If the site does not accept it, Lumina asks again.
  Checked in the real app against a stand-in site: four files asked once instead of four times. Not yet tried on a real protected site.
- **Download pages that get redesigned keep working.** Lumina used to find a host's download button mostly by an English name, so a renamed or
  restyled button meant waiting for a new release. It now reads the button in some twenty languages, finds icon-only, image and click-handler
  buttons, buttons inside frames and web components, and file links worded "Mirror 1", and it leaves Premium, advert and installer buttons
  and menu links alone. Checked in the real app against 35 page layouts: 17 worked before, all 35 now.
- **Lumina learns from your click.** If a page needs you and you click its download button, Lumina remembers that control for the site (only a
  description of the button, kept on this computer) and finds it again on the site's next page, even if it was moved or restyled.
- **"Skip all" skips them all.** It used to skip only the files already waiting, so a long list asked again, a few files at a time.
- **Hoster pages that hide their other mirrors are read in full.** Some pages show one host's links and keep the rest in tabs drawn by
  script, so the extension saw only the first host. It now reads those lists too, so the mirror chooser can offer Pixeldrain or Gofile, and
  leaves out any entry the page itself marks as dangerous. Checked on a real hoster page by reading it (3 usable lists, 2 flagged ones
  skipped); not yet tried in the extension in a real browser, only in tests.

## [1.2.1] — 2026-11-03

A stability release: the downloader's torrent and queue handling, and the browser extension's new way of sending several links at once.
The browser extension is updated too (it carries the app's version number); the TV app is unchanged (0.3.0).

### Added
- **Browser extension: send several links at once.** On a page with a release's download links, highlight them and a small button appears
  beside the highlight ("Send 3 links to Lumina"); or right-click the highlight, or open the extension and tick the links it lists for the
  page. They arrive in Lumina as one batch plan (archive parts together, optional extras unticked, checksums first, missing parts flagged)
  and you confirm once, instead of up to 200 separate single links. The button can be switched off in the extension's popup. Checked in a
  real (headless) Chrome with the real extension against a stand-in for Lumina, and the batch screen was photographed in the real app.
  Not tried in Firefox, and not yet against a real file host's page.

### Fixed
- **Links that keep their file name after a `#` are understood.** Several file hosts write a link as `host/AbC123#Release.part01.rar`. Lumina
  read only the path, so such links looked like unnamed files: a release's parts were not grouped, ordered or checked for a missing part, and
  the download was titled "download". The name after the `#` is now used (a name in the path still wins). Checked: three such links in any
  order become one set in order, and a missing part is flagged before anything is downloaded.
- **The extension's prompt works on strict pages and on long ones.** On a page whose content-security-policy forbids inline styles the button
  appeared with no styling; and Select All on a long page put it far below the visible screen. It now uses a stylesheet the page cannot
  block and stays inside what is on screen. Both found by testing in a real browser.
- **A big batch can no longer fail on a big cookie jar.** The extension trims cookies to fit the bridge's size limit (a site's own cookies
  last, the links and the page never). The bridge itself now answers an oversized request with a plain "Request too large" instead of
  dropping the connection, which could also stall the next request.
- **A link already in Lumina no longer harms the download that is there.** The browser hand-off could, for a link you had paused and then
  clicked again, remove that paused download and its partial file. It now leaves it alone and hands the file back to the browser. The
  duplicate rule also tells apart another format, another engine and another release, so converting one file two ways, or adding a part to a
  new release, is never swallowed.
- **A file host's link sent from the browser is now opened as a download page.** It arrived with a browser request attached, and Lumina only
  clicked through a host's page when no request came with it, so the link was probed as if it were the file (pasting the same link worked).
- **Bot-check cookies no longer leave your browser.** The extension sent every cookie for a page, Cloudflare's clearance cookie included, and
  Lumina accepted them (against the project's own rule that a check is solved by the person, in Lumina's browser). The extension no longer
  sends them and Lumina drops them if an older extension does.
- **After you solve a check, Lumina carries on.** A solved Turnstile, reCAPTCHA or hCaptcha stays on the page (a green tick), and Lumina
  took that for "still waiting for you" and never pressed the host's own Download button. It now notices the response token that solving
  produces. It still never solves anything itself: an unsolved check, and an image code, still wait for you. Checked in hidden pages: the old
  code failed the three solved cases, the new code passes all eight.
- **The same link no longer starts two downloads.** A double click on Send, or one link arriving from the browser and the clipboard, ran two
  jobs writing the same file. A download that is already queued, running or paused with the same link, folder and kind is now just that one.
- **A queue whose first job fails at once no longer starts the next ones twice.** The scheduler re-entered itself and started jobs it had
  already started (two runners for one file). Shown failing before the fix and passing after.
- **A full disk or unwritable working folder no longer stops the queue.** It used to throw out of the scheduler, so no job behind it started;
  that job now fails with a plain message and the rest go on.
- **A torrent that was downloading is no longer "reconnected" for no reason.** Lumina decided a torrent had stalled when its completed-byte
  count had not grown for a minute, even while the engine reported hundreds of KB/s, and then paused and resumed it, which drops every peer.
  The speed fell to zero and took minutes to climb back, and it could happen again and again ("Reconnecting", a climb, a cliff). In the log:
  a stall declared at 61 s while the speed was 300 to 750 KB/s. Download speed now counts as activity (a download that receives data but
  completes nothing is still caught, after ten times as long), and a drop in the completed count, as when the choice of files changes, starts
  the count from the new figure. A download that really stops (the only seed gone) is still nudged after about a minute: checked by killing
  the seed mid-download. The exact reason the count stood still in that log is not reproduced; a throttled local swarm with big pieces
  did not do it.
- **The automatic upload limit no longer lapses once a minute.** The settings re-apply that runs every minute wrote "no limit" over it, and
  the limit only came back at the next look a few seconds later. It is now put back at once (seen in the log, 60 s apart).
- **The yt-dlp update works while a download is using yt-dlp.** Windows refuses to overwrite a program that is running, so the update failed
  (and left a 17 MB `yt-dlp.exe.new` behind). It now moves the running copy aside, puts the new one in, and removes the old copy on the next
  update. Tested against a really running program.

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
- **The files you choose in a torrent stay chosen.** After you untick files and press Apply, the choice used to be forgotten the next time the
  download engine re-added the torrent (a pause and resume, a restart, a recovery), so the torrent went back to all files, the header showed
  the full size again, and the panel listed every file as selected. The choice is now saved with the download and re-applied each time.
  Checked on a running 8-file torrent: the size dropped from 1200 MB to 600 MB and stayed there, with 4 of 8 files shown, through a pause and
  resume; only those four files were written to disk.
- **A torrent no longer gives away as much as it takes.** Nothing limited the upload, so a download could send out as fast as it received
  (a user's screen showed 646 KB/s up against 628 KB/s down). While a torrent downloads, the upload is now held to about a tenth of the
  download speed (never below 50 KB/s, so peers still send to you), and the limit comes off when everything has finished and you are seeding.
  A limit of your own in Settings › Torrents still wins. Checked in the app: the limit followed the download speed, dropped to 50 KB/s while
  paused and came off at the end. Whether the smaller upload changes download speed in a busy swarm with many peers that expect something
  in return has not been measured; the test swarm was one local seed that asks for nothing.
- **The Library no longer lists songs that are gone.** If a library folder was deleted or moved, every song in it stayed listed for good: no
  cover, "Can't play" on every click, and no rescan removed them, because a folder that no longer exists was never scanned. A rescan now forgets
  any file that is no longer on disk (files on a drive that is simply unplugged are kept). Checked on a copy of a real library: 475 of 478
  entries were gone and were removed, and the 3 files that exist stayed. A song that fails to play also triggers a rescan, and the Liked count
  no longer counts deleted songs.
- **Music has a Tiles view**: large square covers with the title and artist underneath, next to Details and Compact.
- **Lumina opens on the first click.** The window could open behind other windows, or not appear, when Lumina was started from a shortcut, so a
  second click was needed. It now appears as soon as the page is ready (or after a few seconds at most) and is brought to the front. This was
  found by reading the code and the logs, not reproduced: the window cannot be opened here without taking over the screen, so it is unconfirmed
  until it is tried on a real double-click.
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
