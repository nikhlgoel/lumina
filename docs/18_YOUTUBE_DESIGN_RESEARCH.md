# 18 · YouTube / YouTube Music design research, with real screens (2026-10-23)

This closes the one gap `17_UI_REDESIGN_SPEC.md` named in its own §8: *"nothing was seen on a real
Spotify/YouTube Music TV screen."* Doc 17 was built entirely from text guidelines. This one is built
from screens actually observed, each labelled by how it was seen. Read 17 first — this doesn't replace
it, it supplies the missing evidence and turns 17's qualitative rules into a concrete, source-backed
component plan for Lumina.

**Evidence labels, used throughout:**
- **[live]** — driven over ADB on the real Fire TV stick, with your account signed in, screenshotted this session.
- **[official-archival]** — Google's own 2020 blog post and its screenshots, fetched and viewed directly. Dated; labelled as such.
- **[mobile, yours]** — the 10 screenshots you sent from your phone's YouTube Music app. Real, current, but a phone layout, not TV — used only for color, type and component *character*, never for layout geometry.
- **[recalled]** — my own prior knowledge, used only to fill a gap, always flagged.

## 0. Why YouTube Music couldn't be live-tested on TV, and what that means

Confirmed by running it, not assumed: **YouTube Music has no standalone TV app that works without
Google Play Services.** I installed both Google's internal device-prebuilt APK and the real published
APKMirror release on your Fire Stick; both hit `requires the Google Play Store, but it is missing`
(read from logcat) and then "External Market links disabled" (Fire OS blocking the redirect). Fire OS
ships no GMS at all, so no APK swap fixes this — confirmed, not guessed.

What Google actually ships instead, **and what I found live, right now, on your stick**: there is no
separate "YouTube Music" app on Android TV. Music lives as a **tab inside the YouTube app itself**
(`com.amazon.firetv.youtube`, a Cobalt-based build) — same shell, same rail, same cards, a different
content feed. I saw this rail entry myself: **Music**, sitting between **Library** and **Movies & TV**
in your real, signed-in sidebar. This single fact reframes the whole research: Lumina TV's plan to
combine music and video in one shell isn't a compromise — it's exactly what YouTube itself does.

## 1. The real YouTube TV shell [live]

### 1.1 Left rail — collapsed and expanded

Collapsed (default, no focus): a column of bare glyphs, no labels, no boxes, ~78px wide, left-aligned
with generous padding, sitting on pure black (`#0F0F0F`-ish, read by eye, not sampled).

Order, top to bottom, exactly as seen: **profile avatar** (circular, top, own row) → **Search**
(magnifier) → **Home** → **Shorts** (bolt-in-pill glyph) → **Subscriptions** → **Library** → *hairline
divider* → **Music** → **Movies & TV** → **Live** → **Gaming** → **News** → **Sport** → (more
below, cut off) → **Settings** (gear, pinned to the very bottom, separated from everything above it).

The moment focus lands on the rail (one Left press from content), it **expands in place** to roughly
480px: every icon gains a text label to its right, the current item gets a full-width light pill
(`#F1F1F1`-ish) behind icon+label, and your account name appears next to the avatar. This is a single
state change, not a separate screen — collapsed is ambient navigation, expanded is "I'm now driving
the menu." The **divider line** after Library is a real, deliberate grouping: *destinations you
go to* (Home, Shorts, Subscriptions, Library) above it, *content categories* (Music, Movies & TV,
Live, Gaming, News, Sport…) below it. Lumina's current home-row rail has no such grouping or
collapse/expand state [cross-ref 17 §2's "duplicate destinations" finding].

### 1.2 Home feed

Top bar: **Search pill** (dark gray, rounded, placeholder text "Search", wide — spans most of the
header) on the left, **YouTube wordmark + play-button mark** top right, nothing else in the header.
No greeting text, no date, no weather — just search and the logo. Lumina's "Good morning, N songs
on this device" greeting is heavier than this precedent, though not necessarily wrong — see §4.

Content is **row after row of 16:9 cards**, title below each card in two lines max, channel/sub-line
under the title in a dimmer gray, duration badge bottom-right on the thumbnail. Card gaps: visually
even, tight, roughly in doc 17's already-adopted 20dp range. **No card has a background box or
border except the focused one**, which gets a **white 1:1 ring**, not a glow or scale-up I could
measure precisely from a static screenshot — doc 17 §3's own "focus scale/elevation couldn't be
settled from text sources" is still true here; a screenshot can't show motion. Row titles ("Recommended",
"Recently uploaded") are plain, left-aligned, no icon, no "see all" arrow visible on Home specifically.

### 1.3 Library — the single strongest, most transferable pattern [live]

This is the best single find of the whole session. Library is **not a list of plain cards**. It's a
horizontal row of **solid-color blocks**, each a different saturated hue, white bold label in the
lower-left corner, no artwork, no icon — just color and a word:

```
[ History ]  [ Watch Later ]  [ Playlists ]  [ Music ]  [ Movies & TV ]  [ Pod… ]
  purple         teal           deep green      burnt-orange   gold/amber    violet
```

Below the color-block row, each category expands into its own titled shelf of real video cards
(History showed three recently-watched videos with progress bars baked into the thumbnail — a thin
red line along the bottom edge). Selecting a block doesn't navigate away; it's an anchor-jump down
the same scrolling page, Watch Later's shelf starting right under its own heading.

This solves something doc 17 flagged without an answer: *how do you make a destination list feel
like content, not a settings menu?* Flat color + one word, at a size equal to a video card, reads as
a deliberate design decision, not a placeholder.

### 1.4 Watch page (video player overlay) [live]

Confirms doc 17 §5 closely, with real values to replace its guesses:

- **Title + channel name + stats**, top-left, over the paused/playing video, plain white text, no box.
- **Thin progress bar** full-width, current/total time at each end in small gray text.
- **Below the bar, one row, three zones:**
  - **left:** channel avatar (circular) + **Description** and **Subscribe** as two separate pill
    buttons, dark gray fill, rounded-full.
  - **center:** one **big white circular Play/Pause**, visibly larger than every other control —
    this is doc 17's "one primary per screen" already shipped by Google, not just a guideline.
  - **right:** a row of **bare icon buttons, no pills, no boxes**: thumbs-up, thumbs-down, comment
    count, a sparkle ("ask" / AI) icon, bookmark/save, then two **boxed** icons at the very end — CC
    and a **gear (Settings)** — slightly set apart from the rest, the overflow doc 17 asked for.
  - **Up-next row** of thumbnails directly beneath, no heading, just appears.

Compare to Lumina's current 6-equal-button row (doc 17 §5 "before"): the real app has **one giant
primary, a handful of bare reaction icons, and exactly one settings overflow** — not six peers. This
is the clearest live confirmation of doc 17's whole thesis.

### 1.5 Settings [live]

Two-pane layout: a **left list of plain text rows**, grouped under **small gray uppercase section
headers** (`LINK TV & PHONE`, `LANGUAGE AND LOCATION`), each row just an icon + label, current
selection shown as a light pill fill, same visual language as the rail's focused state. The **right
pane is empty space plus one centered promo** (logo, headline, description, one pill button) when
the selected row is informational — i.e., the right side is a detail canvas, not a fixed form.
Lumina's Settings already uses roughly this two-pane shape; the main gap is the **grouped,
uppercase-labelled sections**, which Lumina's flat tab row doesn't have.

## 2. YouTube Music, historical but official [official-archival, 2020]

Since the TV app can't be run, here is what Google itself published and photographed, read directly
from `blog.youtube` and its hosted assets. **This is six years old** — treat it as evidence of the
*pattern family*, not the current pixel values.

- **Same rail shell as YouTube itself** — confirmed directly: the mock shows the identical icon
  column, just with a **YT Music roundel replacing the YouTube mark**, top-right.
- **"Listen Again" row mixes card shapes on purpose**: square album art, a **circular** artist-avatar
  card, and a **square gradient tile** for an auto-generated "Your Likes" playlist, all in one row,
  all the same height. Shape itself carries meaning (square = release, circle = person).
- **"Your Music Library" row is a row of pill-shaped filter chips** — Recent Activity, Playlists,
  Albums, Liked Songs, Subscriptions, Uploaded songs — each a small icon + word in a rounded-full
  dark pill. This is a distinct pattern from both the Library color-blocks (§1.3) and a normal card
  row: a *compact, textual, single-row* way to expose many destinations without eating vertical space.
- **On the shared Android TV home screen, YouTube Music contributes its own row**, title-card style,
  with a focused card expanding and darkening the backdrop into a **colour lifted from the artwork**
  (a dusty purple scrim in the sample) — the same adaptive-color idea Lumina's Now Playing already
  does, independently confirmed as the right call.

## 3. YouTube Music today, from your phone [mobile, yours — characterful reference only]

These are real, current, and yours, but phone geometry — read them for **color, type weight and
component character**, never for TV layout or spacing.

- **Ground: true black** (`#000000`-reading), not dark gray. White text, two weights only — bold for
  titles, regular/gray for sub-lines, exactly doc 17's "few weights" rule.
- **Bottom tab bar**: Home / Explore / Library, icon + label, active tab marked by a **short white
  underline**, not a filled pill — a second valid "current selection" language, distinct from
  YouTube TV's filled-pill rail. Worth deciding which one Lumina standardises on (see §5).
- **Home → Explore grid**: 2×2 grid of rounded dark-gray tiles (New releases, Charts, Moods and
  genres, Podcasts), each an icon top-left and a label bottom-left, no imagery — a third shelf
  pattern alongside cards and color-blocks: the **plain icon+label tile**, for *categories*, not
  *content*.
- **"Speed dial"**: a 3-column mosaic grid mixing a **pinned gradient tile** (Liked Music, thumb-up
  glyph, pink-to-purple gradient, pinned with a small pin icon and a **white focus/selected ring**),
  **2×2 photo-mosaic playlist tiles**, and a **circular artist tile** — again, shape = content type.
- **Mini player**: docked bar just above the tab bar, thumbnail + title/artist + a single Pause
  button, nothing else — the smallest, most restrained control set seen anywhere in this research,
  consistent with doc 17's "one primary" rule taken to its logical extreme.
- **Full Now Playing**: huge square art, title/artist, then a **row of pill reaction buttons** (👍
  count, 👎, comment-count pill, **Save** pill) — pills here, not bare icons like the TV watch page;
  phone and TV genuinely differ on this one point. Thin scrubber, then transport: **shuffle — prev —
  big center play/pause — next — repeat**, matching doc 17 §4's proposed order exactly, independently
  confirmed. Below that, three **quiet text tabs**: UP NEXT / LYRICS / RELATED — not boxed, an
  underline marks the active one — this is precisely what doc 17 §4 specified as "two quiet text
  tabs," now with a third (Related) and the real visual language (underline, not color) to copy.
- **Lyrics tab**: the **blurred, darkened album art fills the whole screen as backdrop**, lyrics
  centered in large type, the current line full-white-bold, every other line dimmed to maybe 40%
  opacity, a floating **Share** pill bottom-center. Lumina's current lyrics screen (per SESSION-LOG
  2026-10-22) already does a similar veil-over-artwork approach — this confirms that choice.
- **Related tab**: "You might also like" — a plain vertical list of song rows (small square art,
  title/artist, a small **add-to-queue** icon on the right, no chip/box); then "Similar artists" —
  circular avatars, name, subscriber count, no card background at all. Bare rows, not cards, once
  you're three levels into detail — a density gradient doc 17 never specified: **cards up top,
  rows once you're deep**.

## 4. Where this changes doc 17's prescriptions, not just confirms them

| Doc 17 said | This research found | What to do |
|---|---|---|
| "Home: keep greeting, search pill, rows" | Real YouTube Home has **no greeting at all**, just search + rows | Keep Lumina's greeting — it's a deliberate point of difference, not an oversight — but shrink it: it should not outweigh the search pill the way YouTube's bare header doesn't compete with anything |
| Library: "remove the extra refresh icon… cards from the 16:9/1:1 scale" | Real Library is **not cards at all**, it's colour-blocks + shelves | This is bigger than doc 17 assumed: adopt the colour-block pattern for Lumina's Library top row (Music, Videos, Playlists, Downloads, On this device), replacing the current panel-of-rows design entirely |
| Now Playing "More" panel, 5 items in a side panel | Phone app uses **pill reaction buttons inline**, TV watch page uses **bare icons inline** — neither hides 5 items behind one more button the way doc 17's "after" sketch did | Keep doc 17's primary-control sizing (big center Play), but the overflow bar itself should be a row of bare/pill icons at reduced size, not hidden a layer deeper — match what both real apps actually ship |
| Focus states: "scale 1.06, ring, lift" (doc 17's own guess) | Real YouTube TV's focused card: a **clean white 1:1 ring**, no visible scale-up in a static capture | Simplify: ring-only is confirmed live; keep scale subtle (1.02–1.04) rather than the stronger 1.06 doc 17 guessed, since the real app reads as calmer than that |
| No prior evidence on category tiles (Playlists, Settings groups) | Phone Explore grid gives a clean **icon+label tile** pattern distinct from cards | Use this for Lumina's Settings tab headers and for any "pick a category" screen, instead of inventing a new shape |
| Current-selection language undecided | Two real, different answers exist: **filled pill** (TV rail, TV Settings) vs **underline** (phone tabs, phone Now Playing sub-tabs) | Standardise: **filled pill for rail/list navigation** (matches TV precedent, which is what matters most for Lumina), **underline for in-page tab switches** (Up next/Lyrics/Related-style) — this is a rule doc 17 never stated because it had no evidence either way |

## 5. Concrete next steps for Lumina TV (ties to the existing `tv/` code)

> **Correction, same day, after the owner looked at the stick and saw no change.** The list below was
> first implemented as a few chips, one tab and a divider — and the sidebar was *dropped* on the strength
> of a code comment ("every sidebar design shown so far was rejected"). That was wrong: the sidebar was the
> headline of what was asked, and the comment is not a decision by the owner. What is **now built and seen
> on the stick** (2026-10-23, `tv/` debug build): the **left sidebar** (`ui/SideRail.kt`: icons at rest, widens
> to names on focus, light pill on the focused row, hairline between Search/Home and Music/Videos/Playlists/
> Downloads, profile at the top, Settings pinned at the bottom, lands on the open page); the **top bar
> removed**; **YouTube-style cards** (square covers, 16:9 videos with a duration badge, clean white ring, no glow,
> 14 dp corners, two-line video titles); **Home** with one wide search bar, white filter chips and a smaller
> Shuffle; **Library pages** headed by a bar in the section's colour, the sidebar choosing the section; **Settings**
> as a two-pane YouTube layout (grouped list left, page right); a **Song | Video** switch at the top of both players
> for streamed tracks; and the **Related** tab. Items 2 and 3 below describe the earlier, wrong decision and are
> kept only as the record of it. **Not done / unproven:** the focus-lift scale and timings are still my own
> values; Search's on-screen-keyboard flow is unchanged; the rail's behaviour with a *real remote's* Back key
> was not exercised (taps and D-pad keys over ADB only).

**Re-verified against the actual code on 2026-10-23, before implementing — two items below were
wrong as first written, and are corrected here rather than left to mislead a later reader.**

1. **`ui/LibraryScreen.kt`** — rebuild its top row (currently plain `LButton`s in a `TabBar`, Library
   and Settings sharing one generic look) as YouTube's colour-block pattern (§1.3): one saturated hue
   per category (Music, Videos, Playlists, Downloads), white bold label bottom-left, no artwork. This
   is a new component (`ColorBlockTab`), not a change to the shared `TabBar`/`LButton` — Settings
   uses the same `TabBar` for a different kind of row (§5.2) and must not inherit this look by
   accident. **Keep** the existing "look for new files" refresh action and the info line; Library
   owns on-device file discovery, which has no YouTube equivalent to copy.
2. ~~`ui/AppShell.kt` / the rail — add collapsed↔expanded state~~ **— does not apply.** Re-reading
   `AppShell.kt`: Lumina has no left rail. Navigation is a **horizontal top bar** (`TopNav`), and the
   code carries its own comment: *"every sidebar design shown so far was rejected... replace or
   delete freely."* Porting YouTube's left-rail collapse/expand would fight a decision already made
   on this project, not just add a feature. Dropped. What *does* transfer: `TopNav`'s current-item
   treatment (a filled pill via `LButton(primary = true)`) already matches §4's own rule ("filled
   pill for rail/list navigation") — independently arrived at, now confirmed correct, left unchanged.
3. ~~`ui/VideoScreen.kt` — already mid-redesign...~~ **— already done.** Re-reading the file: a prior
   session (SESSION-LOG entry 34) already rebuilt this screen on exactly this model — round Play
   left, Previous/Next beside it, CC + a Settings-gear overflow on the right, a slide-in sheet for
   Quality/Speed/Audio/Subtitles. This matches §1.4's live findings closely enough that no further
   change is justified here. Not touched.
4. **`ui/NowPlayingScreen.kt`** — the existing `Panel` enum (`Lyrics`, `Queue`, `More`) gains a third
   tab, **Related**, next to the existing `TextTab`s. Backed by `StreamRepo.related(seed, limit)`,
   which already exists and already returns `List<Track>` — verified in the code, not assumed.
   Selecting a row plays it via `graph.player.playStreamQueue(...)`, the same "select it, it plays"
   language every other list in Lumina already uses, rather than inventing a YouTube-style
   add-to-queue icon that appears nowhere else in this app.
5. **`ui/SettingsScreen.kt`** — its eight tabs sit in the same horizontal `TabBar` as Library, which
   doesn't fit §1.5's vertical-list-with-headers layout without a much bigger structural change than
   this research justifies. Adapted instead of copied: group the existing horizontal tabs into three
   visual clusters with a divider and extra spacing between them — **content** (Storage, Sound,
   Playback, Music), **device** (General), **system** (Streaming, Updates, About) — keeping the
   grouping *idea* from §1.5 inside the shape Lumina already has.
6. **Lyrics** (already built, SESSION-LOG 2026-10-22) — no change; independently confirmed correct
   by §3's phone screenshots.

## 6. What's still unproven

- **Every real motion value** (focus-ring timing, card scale, panel slide) — a static screenshot
  cannot show this on either YouTube property; doc 17's numbers (120ms, 220ms) remain this project's
  own design choice, to be judged on the real TV, not sourced from Google.
- **YouTube Music's current, 2026 TV visual values** — only the 2020 official mock was available;
  colours, spacing and type may have shifted since. The *pattern family* (shared rail, mixed card
  shapes, pill filter rows) is very unlikely to have been abandoned, since it still exists on the
  live YouTube TV app's Music tab I drove this session — but exact pixels are not verified current.
- **Whether Amazon's own forked YouTube build (`com.amazon.firetv.youtube`) differs visually from
  Google's stock Google TV build** — not tested; the Google TV emulator's version was blocked by the
  device-certification wall before any comparison was possible.

## Sources

- **[live]** `com.amazon.firetv.youtube`, driven over ADB on the real Fire TV Stick (AFTMA08C15), signed in, 2026-10-23.
- **[official-archival]** [YouTube Blog — Expanding the YouTube Music experience for TVs](https://blog.youtube/news-and-events/expanding-youtube-music-experience-tvs) (2020-10-12), with its two hosted screenshots, viewed directly.
- **[official-archival, secondary]** [XDA — YouTube Music for Android TV adds uploaded music playback support, a new player UI, and more](https://www.xda-developers.com/youtube-music-android-tv-uploaded-music-playback-new-player-ui/) (2020) · [XDA — YouTube Music is now available on Android TV through the YouTube app](https://www.xda-developers.com/youtube-music-android-tv/) (2020)
- **[mobile, yours]** 10 screenshots of your phone's YouTube Music app, supplied 2026-10-23.
- `docs/17_UI_REDESIGN_SPEC.md` — the prior, text-sourced redesign spec this document extends.
