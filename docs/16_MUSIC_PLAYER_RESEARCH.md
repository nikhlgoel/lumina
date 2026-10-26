# 16 · Music player research: what the best players do, and what Lumina TV should take

Researched 2026-10-22. **Read this first:** this is desk research from articles, release notes, GitHub READMEs and Amazon's
developer pages. I could not watch YouTube videos (no way to play video here), and the browser screenshots I tried were mostly
ads, so nothing below comes from seeing a screen myself. Several sources are old (2016-2020, noted) or low-quality SEO pages
(noted). Treat each line as "reported by", not "verified on the real app".

## 1. What each player is known for

**YouTube Music (phone, April 2026 redesign; 9to5Google, Android Authority).** Now Playing now has a split view: the *Up Next*
queue takes the space that the Lyrics and Related tabs used to have; Lyrics moved next to the like/dislike buttons; the
Song/Video switch became small icons; artwork is slightly larger. Reception: mixed, with one reader calling it a UX regression
because moving the Lyrics button made Save harder to reach. Lesson: **every time they moved a control, people complained** -
keep controls where they were.

**YouTube on Android TV / Google TV (Feb 2025; 9to5Google, Android Authority).** A "Display" button on a music video offers
three modes: **Artwork** (cover on a background drawn from its main colour), **Lyrics** (art moves aside, synced lyrics centre),
**Video**. Complaints: lyrics are rendered *too large* for a TV (no way to fit more lines) and the app often **snaps back to the
default view** instead of remembering the choice. Lesson: three display modes is the established TV pattern; remember the choice;
give a lyrics size setting.

**Spotify (TV app rebuilt Oct 2025, tvOS; AlternativeTo, iDropNews).** Real-time lyrics, view and manage the Up Next queue, a
"switch to video" prompt for music videos, playback speed for video podcasts, Spotify Connect (phone as remote), Spotify DJ.
Spotify **Canvas**: a 3-8 s vertical looping video replacing static cover art; Spotify's own guidance for artists is "no text, no
rapid cuts"; listeners are split, some find it distracting (Digital Music News). Lesson: motion behind the song is liked when it is
slow and quiet.

**Apple Music (iOS 26; MusicTech, MacRumors, BGR).** Time-synced lyrics (default on Apple TV), **lyrics translation** shown under
the original line, **lyrics pronunciation** (phonetic guide for CJK), **AutoMix** (AI beat-match/time-stretch transitions, reviewers
say it is inconsistent), animated cover, **offline lyrics** (iOS 26.2), Apple Music Sing (beat-by-beat lyrics, adjustable vocal
volume on Apple TV 4K). Lesson: lyrics are the most-iterated feature; offline lyrics and translation are the new baseline.

**Amazon Music on Fire TV (older, ~2016-2020, treat as dated; AFTVnews, Hypebot).** Now Playing = a **full-size image of the artist
as the background with everything overlaid**, lyrics in the upper right highlighted and scrolling in sync; **X-Ray** (credits,
song meaning, chart positions, "fun facts"). This is the closest existing layout to what Lumina now has.

**Plexamp (Plex forums, Android Authority, listing).** Loudness analysis drives **loudness levelling** and **Sweet Fades**
(DJ-style fade out/in); a **seekprint** (waveform of the song as the progress bar); **visualizers**; gapless. Known problem: fades
choppy when sample-rate matching is on. Lesson: a waveform progress bar and visualizers are what audiophile users love.

**Metrolist (GitHub README) - an open-source YouTube Music client, the same category as Lumina TV.** Stream or download, background
play, **skip silence**, **sleep timer**, **audio normalisation**, **tempo and pitch control**, **equalizer**, **crossfade**,
**live synced lyrics + AI translation**, personalised quick picks, **local playlists**, **import playlists**, **reorder songs in
a playlist or queue**, account sync, **listen together** with friends, **Last.fm scrobbling**, **dynamic theme (colours from the
cover)**, 19 palettes. This is the best checklist of what people who leave the official app expect.

**Poweramp / Musicolet (comparison pages, some low quality).** Power users: gapless, crossfade, replay gain, a graphic/parametric
EQ (band counts vary by source), sleep timer, tag editor, **many simultaneous queues** (Musicolet: 20).

**Unprompted wishes (informal polls).** Ad-supported YouTube Music poll (Dec 2022): background play 55%, better recommendations
20%, lyrics improvements 14%, sleep timer 11%. A Nextcloud Music user's top ask: **pre-load the next song, "otherwise gaps of
silence"** (one user, not a survey). Sleep timer options YouTube Music shipped: 5, 15, 30 min, 1 h, end of track.

## 2. Platform rules that apply to a Fire TV app (Amazon developer docs, Android developer docs)

* Keep UI out of the outer **5%** of each screen edge; design for 1920x1080 at 320 dpi.
* Body text at least **14 sp = 28 px at 1080p**. **Lumina's Small text is 16 sp at our 1.477 px/dp = 23.6 px, and Body is 26.6 px:
  both are under that floor.** Our "zoom out" request conflicts with the guideline; the way to reconcile is to shrink spacing and
  cards, not text.
* Prefer **less saturated, cool** colours over warm saturated ones. Our brand amber/copper is warm and saturated; the per-song
  accent (cover-derived) softens this on Now Playing but not elsewhere.
* Always show focus; on Select the focused item should **briefly show a "selected" state**; never trap focus.
* A 1-D list shows **its title plus "3 of 24"** (position and total); wraps at the ends.
* Home = left menu, right content rows; Left returns to the menu.
* **Now Playing card (Android TV quality rule):** an app that keeps playing audio after the user goes Home must show a *Now Playing
  card* on the home screen via an active MediaSession. Lumina uses a Media3 session, so it likely already does, but **this has not
  been checked** (the home screen showed our tile only; I did not look for a card while music played).
* The Amazon page does not cover motion, or the Back/Menu/Play-Pause behaviour, so those are open questions.

## 3. Candidate changes, grouped (everything found, not yet filtered)

**A. Listening essentials (what Metrolist/Poweramp users expect)**
A1 Sleep timer (5/15/30/60 min, end of track). A2 Crossfade/gapless: we only pre-resolve the next song, so there may still be a
gap; true gapless means pre-buffering the next media item. A3 Skip silence (ExoPlayer has it built in). A4 Loudness
normalisation. A5 Equalizer (Android's built-in effect). A6 Tempo/pitch (we have speed only). A7 Resume where you left off.
A8 Recently played / History. A9 Play next / Add to queue / reorder queue / clear queue.

**B. Now Playing**
B1 **Display modes: Artwork / Lyrics / Video**, remembered between songs and sessions (YouTube TV's known failing).
B2 Lyrics: size setting and "more lines" mode; offline lyrics (save an .lrc beside a downloaded song); optional translation. LRCLIB
has line-timed lyrics only, so word-by-word highlight is not possible with it.
B3 Waveform progress bar ("seekprint") instead of a plain bar. B4 Visualizer / idle screensaver: after a while of music with no
input, go to a slow full-screen art + lyrics view (Samsung/Plexamp idea). B5 Song info: credits/"about" (X-Ray) - needs a data
source, none chosen. B6 A "song / music video" toggle where a video exists. B7 Keep control positions stable (YouTube Music lesson).

**C. Library and playlists**
C1 **Playlists you create** (local), add-to-playlist from the player and from a card, reorder. C2 Liked songs as a playlist (a
row exists). C3 Import a YouTube playlist as a *local, editable* one (we sync read-only today). C4 "Download whole playlist" button.
C5 Home rows that explain themselves: "Because you liked X", "Daily mix", "Quick picks" by time of day. C6 Last.fm scrobbling
(optional).

**D. TV interface polish**
D1 Raise text to the 28 px floor; keep the "zoomed-out" feel by tightening spacing. D2 "3 of 24" on rows. D3 Select feedback state.
D4 Use the remote's **Menu** key for context actions (add to queue/playlist, like) instead of long-press, which nobody
discovers. D5 Splash for the ~5 s cold start. D6 Cooler, less saturated palette outside Now Playing, or per-song accent
everywhere. D7 Verify the Now Playing card on the Fire home screen.

**E. Things that would be ours alone (the "surprise")**
E1 **Phone as keyboard and remote**: the phone setup page already exists; extend it so you can search and add songs to the TV queue
from the phone (TV typing is the worst part of every TV music app). E2 **Everything breathes with the song**: the accent, glows
and motion already follow the cover on Now Playing; extend to Home and rows (focused card tints the page). E3 Slow, quiet motion only
(Canvas lesson). E4 Time-of-day greeting + tint (exists: greeting only).

## 4. Proposed plan (ordered by value for the effort on a 1.7 GB stick)

1. **Now Playing completeness** - B1 display modes (remembered), A9 queue actions + reorder, A1 sleep timer, B2 lyrics size, A3 skip
   silence. *Why first:* this is the screen the user lives in, and each item is small.
2. **Playlists** - C1/C3/C4 local playlists with add-from-player, plus "download all". Biggest missing feature vs. Metrolist.
3. **Gapless** - A2: pre-buffer the next item so there is no silence between songs; then optional crossfade.
4. **TV polish pass** - D1-D7 in one go, including the text floor and verifying the Now Playing card.
5. **Phone remote** - E1. The most distinctive feature and it reuses existing code.
6. **Listening depth** - A4 normalisation, A5 equaliser, A6 pitch, B3 waveform bar, B4 idle visualizer.
7. **Optional** - Last.fm, translation, X-Ray style credits (each needs an outside service).

## 5. Open decisions for the owner

* Text size vs. "zoom out": follow Amazon's 28 px floor for text (recommended) or keep smaller text.
* Which of 6-7 you actually want; they are the most speculative.
* Whether a per-song accent should replace amber everywhere or only on Now Playing.

## Sources

[YouTube Music split Now Playing, Android Authority](https://www.androidauthority.com/youtube-music-now-playing-redesign-split-screen-3657648/) ·
[9to5Google, YouTube Music split redesign](https://9to5google.com/2026/04/23/youtube-music-split-now-playing-redesign/) ·
[9to5Google, YouTube on TV displays music](https://9to5google.com/2025/02/18/youtube-tvs-display-music/) ·
[Android Authority, YouTube Android TV lyrics](https://androidauthority.com/youtube-android-tv-lyrics-3527564) ·
[AlternativeTo, Spotify Apple TV redesign](https://alternativeto.net/news/2025/10/spotify-rolls-out-redesigned-apple-tv-app-with-video-podcasts-and-music-videos) ·
[Digital Music News, Spotify Canvas](https://www.digitalmusicnews.com/2019/10/10/spotify-canvas-beta/) ·
[MusicTech, Apple Music iOS 26](https://musictech.com/news/music/apple-music-ios-26-updates/) ·
[MacRumors, iOS 26 Apple Music](https://www.macrumors.com/guide/ios-26-music/) ·
[Macworld, Apple TV synchronised lyrics](https://www.macworld.com/article/3430316/how-to-use-synchronized-lyrics-in-apple-music-on-your-iphone-ipad-or-apple-tv.html) ·
[AFTVnews, Amazon Music on Fire TV](https://www.aftvnews.com/?p=17436) ·
[Plex forums, Sweet Fades](https://forums.plex.tv/t/sweet-fades-problem-choppy/873222) ·
[Metrolist README](https://github.com/MetrolistGroup/Metrolist) ·
[Amazon Fire TV design guidelines](https://developer.amazon.com/docs/fire-tv/design-and-user-experience-guidelines.html) ·
[Android TV Now Playing card](https://developer.android.com/training/tv/playback/now-playing) ·
[9to5Google, YouTube Music feature poll](https://9to5google.com/2022/12/15/youtube-music-feature-poll/) ·
[Flow Journal, Netflix previews](https://www.flowjournal.org/2019/06/on-seeing-whats-next/)
