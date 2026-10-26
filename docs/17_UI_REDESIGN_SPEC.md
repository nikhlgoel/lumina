# 17 · Front-end research and redesign spec (UI only, no new features)

2026-10-22. This replaces the feature list in `16_MUSIC_PLAYER_RESEARCH.md` as the thing to act on first. The owner's point:
the front end is the problem, and adding features to it only adds clutter. Everything here is about **hierarchy, density, focus,
typography, motion**. Sources are primary where possible: Apple's Human Interface Guidelines (read in full this time through a real
browser), Google's Android TV docs, Amazon's Fire TV docs, Google's Android Auto playback spec, and a video-player UI analysis.

## 1. What the guidelines actually say (with numbers)

**Hierarchy and disclosure (Apple HIG, Layout):** "Order content by relative importance." "Group related items" with space, not
boxes. "Use progressive disclosure to make layouts cleaner... *particularly useful for media-focused apps like those for video,
music*." "Differentiate controls from content" with a scrim/edge effect, **not** a solid background under every control.

**Playing video (Apple HIG):** put playback options in a **transport control or a content tab**, and "provide only the most useful
actions and information... make sure your actions don't take more than a step or two." Overlays should "defer to content". Do not
show splash/detail/intro screens before playback; **do not ask whether to resume, just resume**; if loading takes over 2 s show a
black screen with one centred spinner and nothing else; after exiting playback land on a relevant screen with a resume option.

**Player controls (Android Auto playback spec, the most formal one found):** primary order is *Queue, Previous, Play/Pause, Next,
optional*; **above 5 actions the last slot becomes an overflow button**; at most 4 secondary actions behind it (thumbs up/down
etc.). **Video-player analysis (Eleken):** thin progress bar that thickens on focus; auto-hide most controls during playback; "users
should never wonder how to bring controls back"; do not remove familiar controls in a redesign. Vimeo keeps play, 10 s skip, volume,
fullscreen on the bar and puts captions, quality, speed in an overflow menu.

**Focus (Apple HIG):** five distinct states - unfocused, **focused** (raised, lit, animated), **pressed/selected** (brief
feedback), selected-on (a filled heart), unavailable. Never move focus without the user's input. In a full-screen experience, let
the remote act on the content (seek), not on focus.

**Typography:** tvOS default **29 px**, minimum **23 px**; styles: Title 76, 57, 48, Headline 38, Subtitle 38, Callout 31, **Body 29**,
Caption 25, 23. Avoid light weights; keep few typefaces. Amazon: body **>= 28 px** at 1080p. Google: Display for short numerals/heads,
Title for cards and lists, Label for buttons, no decorative fonts for UI text.

**Safe area:** Apple **60 px top/bottom, 80 px sides**; Amazon **5% of each edge** (about 54 px top/bottom, 96 px sides).

**Grids and cards:** Google TV cards are 16:9, 1:1 or 2:3 with **20 dp between cards**; keep card text to a few words; over an
image use a **gradient scrim**, never a solid box. Apple: consistent spacing, extra space for titled rows, and partially hidden
offscreen content the same width on both sides.

**Amazon extras:** 1-D lists show "title + 3 of 24"; focus must always be visible; Select should flash a selected state.

## 2. Audit: where Lumina TV stands (measured from the code on 2026-10-22)

| Screen | Measured | Rule it breaks |
|---|---|---|
| Now Playing | **12 focus stops** (seek bar + Prev, Play, Next, Like, Not-for-me, Queue, Lyrics, Download, Shuffle, Repeat, Speed), in two rows, each in its own dark box; only Play differs in weight | one clear primary; > 5 actions needs an overflow; controls differentiated from content by scrim, not 12 boxes |
| Video player | **6 equal text buttons** in one row: Play, Quality, Speed, Download, Subtitles, Stats; "Stats" is a developer feature given the same weight as Play | importance by usage; progressive disclosure; "stats for nerds" belongs inside a menu |
| Safe area | top/bottom **27 dp = 40 px**; left rail starts at **40 dp = 59 px**; right **48 dp = 71 px** | all four are inside Apple's 60/80 and Amazon's 54/96 px: content can be cropped on an overscanning TV |
| Text | Body 18 sp = **26.6 px**, Small 16 sp = **23.6 px**, Button 26.6 px, Row 29.5 px, Title 41 px | Body is under Apple's 29 and Amazon's 28; Small is at Apple's minimum |
| Cards | 190 dp square, 300 dp wide video, gaps 22 dp | sizes ad hoc, not from a scale; gap near the 20 dp spec |
| Home | search + 3 round icons (2 of them open the same page) + up to 5 rows | duplicate destinations; the icons are decoration for a feature set that is one page |
| Focus feedback | scale + ring on focus, no distinct "pressed" state | Apple's five states; Amazon's selected flash |

## 3. Design principles for the redesign

1. **One primary per screen.** On Now Playing it is Play/Pause; on the video player it is the video itself.
2. **Size and position follow how often a control is used.** Frequent = large and central; occasional = small and at the edge;
   rare = inside a menu. Never five equal buttons.
3. **Icons without boxes.** A bare glyph, a ring only on focus. Twelve dark squares is what makes the screen look "filled".
4. **Chrome fades.** After ~4 s of no input the controls disappear and the cover/video is left alone; any key brings them back
   (Eleken: users must never wonder how).
5. **Panels, not rows.** Anything beyond the core goes into a side panel opened by one "more" button or the remote's Menu key.
6. **Stay inside the safe area and the type scale** (sections 4-5), so it is the same on every TV.
7. **Motion has one job each:** focus (lift), selection (flash), panels (slide 220 ms), song change (cross-fade). No decorative loops
   except the slow cover drift.

## 4. Now Playing: before and after

```
BEFORE (12 stops, 2 rows, 11 boxes)         AFTER (4 stops + 1 panel button)
[title]                                     [title]                       cover fills right
[artist]                                    [artist]
[========seek========]                     [=====thin seek (thickens on focus)=====]
[<<][ > ][>>][♡][👎]                        [  <<  ]  ( ▶ )  [  >>  ]        [♡]  [⋯]
[Q][Lyr][DL][Shuf][Rep][1x]                   small    BIG    small       small small
                                            Lyrics · Up next       <- two quiet text tabs, not buttons
```

* **Always visible (4):** Previous (52 dp, bare), **Play (76 dp, filled with the song accent)**, Next (52 dp, bare), Like (44 dp, bare;
  filled when on). Plus the seek bar (focus stop; Left/Right seek).
* **"More" (⋯, 44 dp) opens a right-hand panel** with, in this order: Download, Shuffle, Repeat, Speed, Sleep timer, Not for me.
  Each is a labelled row (icon + words + current state), not a mystery icon.
* **Lyrics and Up next are two quiet text tabs under the controls** (Apple's "content tabs"). Selecting one opens its panel;
  the choice is remembered. They are text at 22 px, low emphasis, no boxes.
* **Auto-hide:** after 4 s idle everything except title and artist fades; Back or any key restores it. Pause keeps it visible.
* Focus order: seek -> Prev -> Play -> Next -> Like -> More; Down from Play goes to the tabs.
* Cover stays full-bleed (done); lyrics at a size the user can change in the More panel's neighbour setting.

## 5. Video player: before and after

```
BEFORE: [Play][720p][1x][Download][Subtitles][Stats]   all equal, always shown
AFTER:  title (top, fades)                                                         
        [===== thin seek, time labels =====]                                       
        ( ▶ )                         [CC]  [⚙]        <- only 2-3 stops
```

* **Visible:** Play/Pause (big, left), seek bar, **CC** only if the video has subtitles, **⚙ Settings**.
* **⚙ opens a menu panel:** Quality, Speed, Subtitles, Audio, Download, then a last row **"Stats for nerds"** that opens the
  existing stats panel. Download keeps its state (Saved / 42%).
* Auto-hide after 3 s (already built, keep); the on-screen seek display stays.
* Apple rules to adopt: resume automatically (no prompt), black screen with one spinner if loading > 2 s, and on exit return to the
  screen you came from.

## 6. Global system

**Safe area:** content inset **65 dp left/right (96 px), 37 dp top/bottom (54 px)** at our 1.477 px/dp. The rail counts as content.

**Type ladder (px at 1080p, dp at 1.477):** Display 57 px / 38.6 dp (Now Playing title, Home greeting) · Headline 38 px / 25.7 dp (section
titles) · Body **29 px / 19.6 dp** (default) · Label 29 px bold (buttons) · Caption **25 px / 16.9 dp** (secondary lines; never below
23). That moves Body up from 26.6 px and Small up from 23.6 px; the zoom-out the owner asked for comes from spacing and card size,
not from text.

**Spacing scale:** 8 / 16 / 24 / 40 / 64 dp only. Card gap 20 dp. Row title to cards 12 dp. Row to row 32 dp.

**Colour:** keep amber as the brand mark only; **interactive accents everywhere come from the playing song** (already computed);
default to a calm cool tint when nothing plays (Amazon: cool, less saturated). One neutral for secondary text, one for tertiary.

**Focus system (all screens):** unfocused (60% emphasis) -> focused (scale 1.06, ring, lift) -> pressed (a 120 ms dip then
return) -> on (filled glyph) -> unavailable (35%). Select flashes; nothing moves focus by itself except to the first row on launch.

**Focus-stop budget:** at most **6 focus stops visible per screen region**. Any screen over budget gets a panel.

**Home:** keep greeting, search pill, rows. **Remove the three round icons** (Playlists, Phone, Downloads are one tab each in Library;
Library is already in the rail). Show row position ("3 of 24") on focus. Row spacing from the scale above.

**Library:** remove the extra refresh icon from the tab row; put it in the tab's own panel/Menu key. Cards from the 16:9 / 1:1 scale.

## 7. Order of work (each step is a visible change you can judge on the stick)

1. Safe area + type ladder + spacing scale (touches every screen, mostly constants).
2. Now Playing rebuilt as section 4.
3. Video player rebuilt as section 5.
4. Focus system states and the selected flash.
5. Home and Library tidy (section 6).
6. Idle auto-hide for Now Playing; then a visual pass at ten feet on the real TV.

## 8. What this research could not settle

* Exact focus-state numbers (scale/elevation) for Google TV: the pages show images only. Apple's are qualitative too. The values
  above (1.06, 120 ms, 220 ms) are my design choices, to be judged on the real TV.
* No Netflix or Spotify TV teardown with measurements was found; their behaviour is described, not specified, in the sources.
* All of it is from text; nothing was seen on a real Spotify/YouTube Music TV screen.

## Sources

[Apple HIG: Playing video](https://developer.apple.com/design/human-interface-guidelines/playing-video) ·
[Apple HIG: Layout](https://developer.apple.com/design/human-interface-guidelines/layout) ·
[Apple HIG: Typography](https://developer.apple.com/design/human-interface-guidelines/typography) ·
[Apple HIG: Focus and selection](https://developer.apple.com/design/human-interface-guidelines/focus-and-selection) ·
[Apple HIG: Designing for tvOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-tvos) ·
[Android TV: Design for TV](https://developer.android.com/design/ui/tv/guides/foundations/design-for-tv) ·
[Android TV: Cards](https://developer.android.com/design/ui/tv/guides/components/cards) ·
[Android TV: Typography](https://developer.android.com/design/ui/tv/guides/styles/typography) ·
[Android Auto playback view](https://developers.google.com/cars/design/android-auto/apps/playback-view) ·
[Amazon Fire TV design guidelines](https://developer.amazon.com/docs/fire-tv/design-and-user-experience-guidelines.html) ·
[Eleken: video player UI](https://www.eleken.co/blog-posts/video-player-ui)
