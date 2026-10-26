# 20. Fire TV players and lyrics: plan (2026-10-24)

Planned, **not built**. Written from a read of the code on 2026-10-24; nothing below has been run unless it says "seen".
Work happens on the emulator first; the real stick is tomorrow's check (docs/15_FIRE_TV.md §5e/§5f list what is still unseen there).

Rules that apply to every step (from AGENTS.md and the standing instructions): a visible change gets a mockup and a yes before it is
built; a fix is applied on every page that has the problem; the app must stay light on a 1 GB stick (no per-frame recomposition of
long lists, no `RenderEffect` blur: Fire OS 7 is below API 31); no audio left playing after a test; nothing committed unless asked.

---

## A. What the user reported, and what the code says is behind it

| # | Report | What the code does today (read, not yet reproduced) |
|---|---|---|
| 1 | Lyrics sit small and centred; wants them bigger and moved left | `LyricsPane` is a centred `Column`, `textAlign = Center`, 140 dp padding each side, 34 sp for the line being sung and `scale 0.84` (about 29 sp) for the rest. `NowPlayingScreen.kt` ~L199, L450-545 |
| 2 | Background should be a proper translucent layer with the words over it; "hasn't changed at all" | The cover is stretched full screen and covered by one flat `Bg` at **80 % alpha** (L196): it reads as a dark slab, not glass, and the cover is neither blurred nor colour-matched |
| 3 | Lines "jump", no connection between them | `LaunchedEffect(active) { listState.animateScrollToItem(active, -260) }`: one scroll per line change, to the line's top, with the stock spring. Alpha/scale tween 420 ms by *integer distance* (1 -> 0.62, 2 -> 0.4, else 0.26), so the look changes in steps. Nothing is continuous between two lines |
| 4 | Lyrics should fade away at the edges and be live-synced | No edge fade at all. Sync is line-level only, off `ui.positionMs`, which is **polled every 500 ms** (`rememberPlayerUi`, `Components.kt` L294), so a line can light up to half a second late; no allowance for audio-output latency; no way to nudge it |
| 5 | Sometimes lyrics of a different song | See B. Several independent causes in `LyricsRepo`/`Lrc` |
| 6 | Other minor improvements in both players | See D |

---

## B. Lyrics fetch accuracy (fix first: showing the wrong song is worse than showing none)

Read in `data/LyricsRepo.kt` and `core/Lrc.kt`. Each is a possible cause of a wrong match, ordered by how likely it looks:

1. **Names are never compared.** `candidateLyrics` reads only `duration`, `syncedLyrics`, `plainLyrics` from LRCLIB's answer. It ignores
   `trackName` and `artistName`, so a search hit is accepted if the length is close, whoever it is by. `Lrc.pick` then takes the nearest length.
2. **The length rule is loose.** +/- 6 s is accepted. Two songs of similar length, or a cover/remix, pass. With `durationSec == 0` the check is skipped entirely.
3. **Title-only fallbacks.** `queryVariants` ends with `"" to main` and, for "A - B" titles, `"" to B`, and tries both orders (`A,B` and `B,A`). A bare title such as "Stuck" or "Home" matches many songs.
4. **`lyrics.ovh` has no verification at all** (no length, and it is asked with the swapped/guessed pairs from 3). It is the last resort but it can still return a different song's words.
5. **Probably a stale duration.** `rememberPlayerUi` keeps the previous duration when the new one is unset (`?: duration`, L293), and `LyricsPane` only waits while `durationMs <= 0` (L458). Right after a track change the lookup can therefore run with the *previous* song's length. This is a code-reading hypothesis; confirm it with a log line before relying on it.
6. **The player's own title/artist are raw YouTube strings** ("(Official Video)", reaction/live uploads, channel names that are not the artist) even when the item came from a YouTube Music song search, where the clean title and artist were available.
7. A wrong match is **cached for the session** (24 entries) and there is no way to say "this is wrong".

### Plan
- **B1. Match on identity, not just length.** Read `trackName`/`artistName`/`albumName` from every LRCLIB candidate. Normalise both sides (case, accents, punctuation, "feat./remaster/live/sped up/ver." tags). Score title and artist separately (token overlap plus edit distance). Accept a candidate only when the title score clears a high bar and the artist score clears a lower one (or the artist is genuinely unknown). Reject -> "No lyrics found", never a guess.
- **B2. Tiered length rule.** Within 2 s: accept on a good name match. 2-6 s: only on a near-exact name match. Beyond: refuse. Unknown length: require an exact name match.
- **B3. Order and prune variants.** Keep the "artist + clean title" pairs first; drop the swapped pair unless the original title really has the "A - B" shape; allow a title-only search only when the title is distinctive (several words) and the result passes B1 on the title alone.
- **B4. `lyrics.ovh`:** only with the original (not swapped) artist and title, only if the returned text passes a sanity check, and flagged `unverified` in the UI. Decide tomorrow whether to drop it entirely (recommended if B1 makes LRCLIB coverage good enough).
- **B5. Use the best metadata.** When the track came from YouTube Music search, carry its clean title/artist/album into `Now` and use those for the lookup; fall back to the cleaned video title only for plain videos.
- **B6. Fix the stale length.** Take the length from the track's own metadata when known, else the player's duration *tagged with the media id it belongs to*; never reuse the previous item's value.
- **B7. Fetch ahead.** Start the lookup when the song starts (not when the panel is opened), so Lyrics opens instantly and the length is the right one.
- **B8. Remember per song on disk** (small JSON in app files, capped), including a user's correction, so the same song is instant and stays right.
- **B9. "Wrong lyrics?" action** in the lyrics view: re-search and list the top few candidates (title - artist - length) to choose from; the choice is saved (B8). Also a per-song **timing offset** (see C4).
- **Tests (unit, JVM):** record real LRCLIB JSON answers as fixtures and assert: the right song is chosen; a same-length different song is refused; a cover is refused; a "feat."/"(sped up ver.)" title still matches its song; empty/unknown length behaves. Needs from the user: **a few songs where the wrong lyrics showed** (title and channel as shown), to use as regression cases.

---

## C. Lyrics display and sync

**Needs a mockup and a yes before building** (standing rule). Proposed design to mock up:

- **Layout.** Lyrics become a **left-aligned column**, starting about 96 dp from the left edge and about 60 % of the width, with the line being sung anchored at about 38 % of the height (not the centre). A compact cover with title and artist sits on the right (or is hidden when the controls hide). The mockup will show two variants (cover right, cover hidden) for the user to pick.
- **Size.** Sung line about 46-50 sp (Sora, semi-bold), neighbours about 34-36 sp, the rest smaller and dimmer. Scaling is done around the left edge (`transformOrigin` left-centre) so left-aligned text does not drift, and from a large base size so text stays sharp.
- **Background.** A real translucent layer: the cover blurred and darkened, colour-matched to the accent, with a gradient veil that is darker behind the words (left) and lighter at the cover side. No `RenderEffect`: blur via a small pre-blurred bitmap (a Coil transformation at about 1/8 size, the same idea as `AmbientBackground`), cross-faded over about 800 ms when the song changes. Static: nothing animates on this layer, to keep the processor for the sound.
- **Fade at the edges.** The top and bottom of the column fade out (a gradient mask on the lyric column only), so lines enter and leave softly instead of being cut by the screen edge or the controls.
- **Continuous motion instead of jumps.** Drive the whole list from one *fractional* position: `active line + progress through that line`. Scroll offset, each line's scale, alpha and colour are functions of the signed distance to that position, so as one line finishes the next rises into place along one smooth curve (about 500-650 ms, ease-out), with no step at a line change. Seeks snap (no long animated sweep) when the target is more than about 3 lines away.
- **Sung-line sweep.** The active line fills left-to-right with the accent colour in proportion to how far through the line the song is: a karaoke feel from line-level timestamps. LRCLIB has no per-word times, so this is an interpolation, not true word timing.
- **Interludes.** A gap longer than about 8 s between lines shows a soft "dots" indicator that fills over the gap, and the intro before the first line is handled the same way.
- **Translation lines** (Latin letters, English) keep their place under the original, smaller and dimmer, shown for the sung line and its neighbours only.
- **Browse and seek.** Up/Down move a highlight through the lines; Select seeks to the highlighted line; after about 4 s idle the view glides back to following the song, with a small "Back to live" chip while it is away. Plain (untimed) lyrics use the same layout and scroll with Up/Down. Left/Right keep seeking 10 s as elsewhere.
- **States.** A skeleton while loading (not only text), and for "none"/"unreachable" the actions "Try again", "Search again" and "Pick from matches" (B9).

### Sync, concretely
- **C1. A lyric clock.** While the song plays and the lyrics view is open, derive the position every frame: last player position + elapsed time x playback speed, re-anchored on every poll/seek/speed/buffering event. The clock is read in draw/layout lambdas (`graphicsLayer {}`), not in composition, so only the lines on screen update and nothing recomposes the whole list per frame.
- **C2. Latency allowance.** Lead the clock by a small constant (start at +250 ms for the audio path; to be tuned on the stick: HDMI and Bluetooth outputs differ).
- **C3. Pause/seek/buffering** freeze or re-anchor the clock correctly (no drift after a stall).
- **C4. Per-song offset.** +/- in 250 ms steps from the lyrics view, saved with the song (B8), for official videos whose audio starts later than the album version the timestamps were made for.
- **Unit tests:** pure functions for "fractional position -> line index and progress", interlude detection, and offset application, in `core/Lrc.kt` beside `activeIndex`.

### Cost and risk
- Frame-driven updates only while lyrics are visible and playing; the pre-blurred background is one small bitmap; the edge mask needs one offscreen layer of the column (check memory on the 1 GB emulator, `-memory 1024`).
- Risk: a left-aligned layout with a right-hand cover must still leave the bottom control bar clear (today's 260 dp bottom padding is a workaround; replace it with a measured inset).

---

## D. Other player improvements (both players)

Observed on the emulator this session, or found while reading. Marked **seen** or **read**.

1. **(seen) Closing a popover returns the remote to Play, not to the button that opened it** (More in the music player, Settings/CC in the video player). Return it to the opener. Apply to the Queue/Related trays too.
2. **(seen, unexplained) Unliking from the player's heart did not remove the song.** On the emulator, three more Select presses on the heart left the song in `shared_prefs/taste.xml`. Could be a test artefact (focus, press count) or a real toggle bug in `taste.toggleLike`; investigate first with a unit test of `toggleLike` and a re-run with a screenshot after each press.
3. **(seen) The control row needed six Right presses from Play to reach the heart where five stops were expected.** Check the focus order for an extra stop and make it match what is drawn.
4. **(read) Lyrics / Up next / Related are plain text tabs;** the drawn `Lyrics` and `UpNext` icons exist but are unused. Option: icon + word. Visible, so mockup first.
5. **(read) Unverified on screen:** the repeat-one "1" tick, the downloaded tick and the replay glyph. Check them on the emulator.
6. **(read) Stock icons still mixed in:** heart, thumb-down, quality, audio language, headphones, info, chevrons, check. Draw them in the same style so each popover is one family (the drawings need approval).
7. **(read) Seeking:** holding Left/Right could step 10 s, then 30 s, then 60 s the longer it is held (long videos and long mixes), with the time shown.
8. **(read) Prefetch the next song** (its stream link and lyrics) in the last 20-30 s of the current one, so the change is gapless and the lyrics are ready. The existing warm-up and prewarm hooks are the place.
9. **(read) Video player:** when the controls hide, the first key only brings them back (by design); verify the same for the new popovers, and that Back closes a popover before it stops the video.
10. **(read) "Loading..." and error pills** in the music player: confirm they never overlap the cover or the lyrics column in the new layout.
11. **Ideas not asked for, listed only so they can be refused:** a sleep timer; a strip showing the next song's name; remembering the chosen speed per video. None is planned unless the user asks.

---

## E. Order of work (tomorrow)

1. **Reproduce first.** Add a log/test that shows the length passed to `LyricsRepo.load` on a track change (confirms B5/B6). Get the user's wrong-lyrics examples. Reproduce D2 and D3.
2. **B1-B3, B6 with fixtures and unit tests** (no UI): the biggest correctness win, smallest risk.
3. **Mockup for C** (two variants), shown to the user for a yes. Build nothing visible before it.
4. **C1-C4 and the display**, on the emulator with network, checked at `-memory 1024`. Screenshots at several moments of a song to show the transition, not just one frame.
5. **B7-B9** (prefetch, disk memory, "wrong lyrics?").
6. **D1, D3, D5, then D2** (after it is understood); D4 and D6 after approval.
7. Full run: `./gradlew :app:testDebugUnitTest :app:assembleDebug :app:assembleRelease`, an emulator walk-through of both players, then the real stick (docs/15 §6 list plus the lyrics view and the Search change). Stop audio after every test.

## F. Acceptance (what "done" means for the lyrics work)

- A song never shows another song's words: every fixture case passes, and an unknown song shows "No lyrics" rather than a guess.
- The sung line lights within about 100 ms of the sung word on the emulator's clock, and an offset can correct a video whose audio starts late.
- Moving from one line to the next shows no step in position, size or brightness (checked by screenshots a fraction of a second apart).
- Text is left-aligned, larger than today, fades at both ends, over a blurred translucent cover; the controls never overlap it.
- Memory on the 1 GB emulator is no worse than the current lyrics view by more than a few MB (to be measured, not assumed).

## G. Open questions for the user

1. Two or three songs where the wrong lyrics appeared (title and channel as shown).
2. Cover on the right, or hidden, when lyrics are open? (the mockup will show both)
3. Keep the `lyrics.ovh` plain-text fallback, or drop it if it cannot be verified?
4. Should translations (Latin letters, English) stay on by default, as now?
