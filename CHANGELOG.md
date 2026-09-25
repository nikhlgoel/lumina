# Changelog

Notable changes to Lumina, written for the person using it rather than the person building it.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Engineering detail lives in `SESSION-LOG.md`, reasoning in `DECISIONS.md`, open defects in `BUGS.md`.

---

## [Unreleased]

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

### Documentation
- Added `AGENTS.md` (canonical working rules), `CLAUDE.md`, `DECISIONS.md`, `BUGS.md` and this
  changelog, so an agent or a new contributor starts from written rules instead of re-deriving them.

---

## [3.0.0-alpha.0] — 2026-09-19

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
