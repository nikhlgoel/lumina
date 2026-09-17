# Lumina Rebuild Plan

Status: approved direction, 2026-09-16. This replaces the aspirational specs in `docs/01–10`, which describe features the code never implemented.

## Decisions

| Topic | Decision |
|---|---|
| External tools | yt-dlp, ffmpeg/ffprobe, aria2c, whisper.cpp ship **inside the installer** |
| Android | **Cut** (`android_app/` removed) |
| Repack crawler | **Kept**, made reliable |
| App UI | Linear-style: neutral, one accent, uncluttered, focused |
| Player | Full-window Player Mode with Exit back to the app; stage shows **one view at a time** (art/video **or** lyrics); queue is a slide-over; theme control is an **icon** |
| Player themes | Full themes with real effects (layout + motion + background), not recolors |
| Quality | Real source quality per type (music / video / series), video up to **8K/HDR**; no fake upscaled audio |
| Subtitles | English subtitles for any video: fetch, else generate with Whisper |
| Whisper model | `base` bundled (default); Settings can switch to `small` (downloaded on demand) |
| Future | Possible handheld music player running this software; keep core portable |

Design proof of the player: https://claude.ai/artifact/LtJyWiUq2g8z4F5A2EG9Kk

## Progress (2026-09-17)

Built and verified end to end (self-test downloads real media inside Electron; 35 unit tests):

- Electron 44 / Vite 8 / Tailwind 4 / React 19; typed, Zod-validated IPC; `node:sqlite` (no native module); sandboxed renderer with CSP.
- Bundled, checksum-verified tools (`pnpm tools:fetch`): yt-dlp, ffmpeg/ffprobe, aria2c, whisper.cpp + Base model. YouTube JS challenges run on Electron's own Node.
- Job queue: persistence, concurrency, pause/resume/cancel/retry, automatic retry for network failures, scheduled speed limit, sleep/shut down when finished.
- Quality tiers, TV-safe conversion (GPU encoders first), compatibility report, English subtitles (site → Whisper), sidecar/embed/burn with a user style, lyrics embedded into songs.
- Library scanning and playlist detection, player with Aurora/Vinyl/Pocket, lyrics, video with styled subtitles, resume positions, tray/media keys, taskbar progress.
- Universal downloader additions (below), Accounts, 13-section Settings with search and live previews, icon system, page/player transitions.

## Universal downloader

| Source | How |
|---|---|
| 1,800+ sites (YouTube, SoundCloud, Vimeo, …) | yt-dlp, kept current by weekly checksum-verified auto-update (stable or nightly) |
| Direct files | aria2, up to 16 connections, resume; ranged GET probe detects files behind extension-less links |
| HLS / DASH streams | yt-dlp with the browser's Referer, User-Agent and cookies |
| Torrents / magnets | aria2 with DHT, a daily public tracker list, seeding limits; "done" once data is complete |
| Spotify | Track lists read (embed page, or Web API when the user connects with their own Client ID); each song matched on YouTube Music by title/artist/duration, then downloaded from there |
| Anything playing in a browser | Lumina extension (Chromium MV3 + Firefox): detects streams/media per tab, catches browser downloads, context menu; talks to a loopback-only bridge that requires extension origin, correct Host, and a per-browser token approved inside Lumina |

Sign-in for private/members-only media uses Lumina's own sign-in window (cookies saved locally), a cookies.txt import, or Firefox cookies. Chromium browsers lock and encrypt cookies while running, so a failed cookie read retries without cookies instead of failing the download.

### Out of scope, by design

- DRM-protected media (Widevine/PlayReady, e.g. Netflix, Spotify's own audio): detected and reported, never circumvented.
- Getting paid-tier quality without the subscription (e.g. YouTube Music Premium 256 kbps): only available when the user signs in with an account that has it.
- Site-specific scrapers for unlicensed streaming sites. The generic extension path works on whatever the browser plays that isn't DRM-protected.

## Why things are broken today (audit summary)

- yt-dlp / ffmpeg / aria2c are not bundled or detected; every inspect/download fails with `spawn ENOENT`, and errors are swallowed (`useLuminaStore.startDownload`).
- Android WebView has no `window.luminaAPI`; the app cannot work there.
- USB detection uses `wmic` (absent on current Windows 11); macOS treats the system volume as removable; polling creates folders on drives.
- Themes set `data-theme` but no CSS reads it; light mode is `!important` overrides.
- Pause/resume exposed in preload but no IPC handler. Turbo slider allows 32 but aria2 caps `-x` at 16 → direct/repack downloads fail above 16.
- `App.tsx` effect re-runs `initialize()` on track/lyrics changes → duplicate IPC listeners. No store selectors → whole-app re-renders on every progress tick.
- Staging lookup can pick a `.vtt` instead of the video. No cleanup on cancel/quit, no persistence, no single-instance/magnet handling.
- Player: skip buttons unwired; `createMediaElementSource` on a cross-origin stream likely outputs silence; stream URLs expire.
- Library splits paths on `/` (broken on Windows); misses Repacks/Torrents/Downloads.
- Settings saved but unused: `blurIntensity`, `defaultVideoRes`, `defaultAudioFormat`, `enableBitTorrent`, `maxConcurrentDownloads`; `speedLimit` has no UI; no validation.
- Security: `sandbox:false`, `shell:open-file` opens any path, no CSP, runtime `--remote-components ejs:github`.
- Tests re-declare their own arrays and never import `src`.
- The user's YouTube Music playlist became MP4 because playlists default to video mode, and `bestvideo+bestaudio` → VP9/AV1 + Opus, which a 2020 Samsung FHD TV cannot play (FHD tier lists H.264 ≤1080p60 only).

## 1. Architecture

- Electron 34 → 44 (Node 24), latest Vite, Tailwind 4 with CSS-variable tokens.
- `packages/core` (no Electron imports): library scanning, playlists, tags, lyrics, presets — reusable on a future handheld.
- Main modules: `tools/`, `jobs/` (queue + yt-dlp / aria2-RPC / ffmpeg / whisper runners), `library/` (scanner, watcher, SQLite), `subtitles/`, `player/` (media protocol, remux), `settings/` (Zod schema + migrations), `updates/`.
- Typed IPC contract validated with Zod on both sides.
- SQLite (`better-sqlite3`): library index, playlists, history, resume positions, lyrics cache.
- Bundled binaries in `resources/bin/<platform>` via electron-builder `extraResources`; yt-dlp updates download to `userData/bin` and take precedence. App updates via `electron-updater`.
- yt-dlp YouTube support needs Deno ≥2.3 or Node ≥22: spike Electron's Node (`ELECTRON_RUN_AS_NODE=1`, `--js-runtimes node:<path>`); fall back to bundling Deno. No remote components at runtime.
- ffmpeg GPL builds ship as separate executables with license + source link.

## 2. Download engine

- Persistent job queue in main: concurrency limit, priorities, reorder, pause/resume/retry with backoff; survives restarts.
- Exact output paths via `--print after_move:filepath`; cleanup of partials on cancel; kill children on quit.
- Pre-checks: disk space, duplicate URL, download archive.
- Playlists: select items/range, numbered folder + `.m3u8`, playlist sync for new items.
- yt-dlp extras: embed thumbnail/metadata/chapters, SponsorBlock, section download, filename templates, cookies (browser/file), proxy, speed limit.
- Torrents: file selection, seed ratio/time, pause/resume.
- Repack: queue parts, correct task mapping, host support matrix ("needs browser" hosts open externally), verify parts, open folder / run setup.
- Tray + background downloads, notifications, clipboard watcher, single instance, OS magnet handler.

## 3. Quality system

Principle: the best tier downloads **original streams without re-encoding**; only offered tiers the source actually has are enabled; the inspector shows real resolution, fps, codec, HDR, bitrate and size.

### Video

| Tier | Result |
|---|---|
| Source Max | Best available up to 8K (4320p), highest fps, HDR when present; MKV |
| 8K / 4K / 1440p / 1080p / 720p | Best stream ≤ height, original codec; MKV or MP4 |
| TV-safe | MP4 · H.264 ≤1080p · AAC; re-encode only if no H.264 stream exists (GPU encoders first, x264 fallback) |
| Custom | Codec (AV1/VP9/HEVC/H.264), fps, HDR/SDR, container |

Notes: YouTube 8K is AV1 (sometimes VP9) and needs AV1 hardware decode to play smoothly; YouTube H.264 stops at 1080p.

### Audio

The audio equivalent of 8K is **lossless** (FLAC/ALAC, 16-bit/44.1 kHz CD or 24-bit hi-res), only when the source provides it.

| Source | Best real audio |
|---|---|
| YouTube / YouTube Music | Opus ~128–160 kbps |
| YouTube Music Premium (cookies) | Opus 256 kbps or AAC 256 kbps |
| SoundCloud / Bandcamp streams | ~128 kbps |
| Bandcamp purchases, own files | True lossless, up to hi-res |

- **Original (best)** keeps the source codec, no re-encode.
- **Convert for compatibility** (MP3 / M4A / FLAC) shows "conversion won't add quality".
- Library shows real codec/bitrate/sample rate/bit depth with Lossless / Hi-Res / Lossy badges.

### Presets per type

- Music: Original · Lossless (lossless sources only) · MP3/M4A for devices; tags, art, lyrics embedded; album/playlist folders + `.m3u8`.
- Video: tiers above.
- Series: `Show/Season 01/S01E03 - Title.ext`, episode detection, skip existing, fetch new episodes, per-episode subtitles, optional `.nfo`.
- Default preset per type in Settings; override per download. `music.youtube.com`, Spotify and audio-only sources default to audio.
- Change format: edit when queued; restart with new format while downloading; **Convert** (single or batch) after completion.
- Post-download ffprobe compatibility check with a TV-safe badge or one-click Convert.

## 4. English subtitles

Pipeline (first hit wins):
1. Official English subtitles.
2. YouTube English auto-captions, including auto-translation.
3. OpenSubtitles (movies/episodes, optional user API key).
4. whisper.cpp: transcribe English audio, or translate other languages to English.

Output: sidecar `.srt` (most TV-compatible), soft-embedded (`mov_text` in MP4, SRT in MKV), or burned-in (re-encode).

Model setting: **Base (142 MB, bundled, default)** / **Small (466 MB, downloaded with checksum)**; GPU toggle. Avoid `.en` and `large-v3-turbo` models (no translation). "Generate subtitles" also available for any library file and inside the player.

## 5. Player

- **Player Mode** takes over the window; **Exit** (button or Esc) returns to the app with a mini bar.
- Stage shows **one** view: Art/Video **or** Lyrics (segmented control or `L`). Queue and local playlists open as a slide-over (`Q`).
- Theme picker is an **icon** button in the top bar.
- Playback: HTML5 media via `lumina-media://` with range support; unsupported containers/codecs remuxed or transcoded on the fly by ffmpeg.
- Controls: play/pause, prev/next, seek, shuffle, repeat, speed, volume + loudness normalization, fullscreen, PiP, chapters, resume position, keyboard, media keys, `navigator.mediaSession`.
- Subtitles: track select, load external, style/size/offset, generate English.
- Audio track selection.
- Lyrics: embedded → `.lrc` → LRCLIB synced → plain; active-line emphasis, distance blur, spring scroll, click to seek, offset, manual search, save `.lrc`.
- Streaming (Discover) routed through main-process proxy (fixes silent visualizer, refreshes expired URLs).
- Queue, recently played, favorites, sleep timer.

### Themes

Each theme is layout + motion + background, colors derived from artwork.

| Theme | Concept | Effects |
|---|---|---|
| Aurora (default) | Calm, Apple Music-like | Near-still WebGL gradient from artwork colors (very slow drift, tiny amplitude), static grain, barely-there beat response; "Still background" option |
| Vinyl | Record-shop warmth | Spinning record with artwork label, tonearm drop/lift, dust motes, warm vignette |
| Pocket (Cassette) | Y2K handheld | Physical device, turning reels, dot-matrix LCD marquee, pressed keys |
| Neon Visualizer | Club | Butterchurn (Milkdrop) presets reacting to audio |
| Editorial | Minimal print | Huge type, dithered artwork, paper texture |
| Liquid Glass | Depth | Frosted layers over blurred art, cursor light, subtle 3D tilt |

Libraries: Paper Shaders (Apache-2.0) for gradients/grain/dithering; Butterchurn (MIT); `motion` for springs; optional react-three-fiber for a 3D record. **Do not copy applemusic-like-lyrics (AGPL-3.0)**; implement the ideas independently. Quality levels (high / balanced / battery), reduced-motion stills, pause effects when hidden.

### Background playback, tray and startup

- **Close → tray** (default on): closing the window hides it; playback and downloads keep running. First close shows a one-time notice explaining where Lumina went.
- **Tray menu**: track title, Play/Pause, Next, Previous, Open player, Open Lumina, active downloads count, Quit. Left-click opens the player (or the last window).
- **Start with system** (default off): launches hidden to tray via Electron `app.setLoginItemSettings({ openAtLogin, args: ['--hidden'] })`; Linux uses an XDG autostart `.desktop` entry.
- **Start mode** setting: *Downloader* / *Player* / *Last used* / *Tray only*. A "Lumina Player" desktop/start-menu shortcut launches straight into Player Mode (`--player`).
- Optional **resume last queue** on startup (paused, not auto-playing).
- OS media controls (`navigator.mediaSession`) and media keys work while the window is hidden.
- Low-footprint mode while hidden: stop shaders/visualizer rendering, keep only audio and the download engine.
- Mini bar in the app: clicking anywhere on it (except its play button) reopens the player.

## 6. Library and playlist detection

- Scan roots: OS Music/Videos/Downloads, Lumina folders, user folders, removable drives; file watcher.
- Detect playlist files (`.m3u/.m3u8/.pls/.xspf/.wpl/.zpl`), folder playlists (2+ media files), Lumina manifests.
- Metadata via ffprobe + `music-metadata`: title, artist, album, duration, resolution, codec, quality, cover art, video thumbnail.
- Views: Songs · Albums · Artists · Videos · Playlists · Recently added; search, sort, prune missing.
- User playlists saved as `.m3u8`. Row actions: Play, Convert, Generate subtitles, Show in folder, Delete.

## 7. Settings

- **General**: language, start with system (hidden to tray), start mode (Downloader / Player / Last used / Tray only), close button → tray or quit, resume last queue, clipboard watcher, notifications, sounds.
- **Appearance**: light/dark/system, accent, UI scale, density, reduced motion.
- **Downloads**: concurrency, speed limit, retries, default preset per type, filename template, playlist numbering + `.m3u8`, archive, disk warning.
- **Formats**: preset editor, preferred codecs, hardware encoding, re-encode quality.
- **Subtitles**: always English, source order, OpenSubtitles key, Whisper model (Base/Small), GPU, output mode, burn-in style.
- **Storage**: folders per type, USB auto-route (opt-in, folders created only on download), library scan roots.
- **Player**: theme, effect quality, resume, default speed/volume, normalization, subtitle style, lyrics sources and auto-open.
- **Network**: proxy, cookies, SponsorBlock, rate-limit pacing.
- **Torrents**: trackers, seeding, port, encryption.
- **Repack**: allowed hosts, verify parts, auto open setup.
- **Advanced**: tool versions/updates, custom tool paths, logs/diagnostics export, clear cache/history, import/export/reset.

All settings use one Zod schema with migrations; text inputs commit on blur.

## 8. App design system

- Neutral surfaces, one accent, hairline borders; no gradients, glows or pulses in the app chrome.
- Bundled Inter or Geist; body 13–14px.
- Collapsible 220px sidebar: Downloads · Library · Discover · Repack · Settings; Ctrl+K command palette; native window controls.
- Downloads: URL bar → side inspector sheet (preset + subtitles) → dense queue table (Active / Completed / Failed) with detail drawer.
- Primitives: Button, IconButton, Switch, Slider, Select, Input, Tabs, Table, Sheet, Dialog, Toast, Tooltip, Skeleton; hover/active/focus-visible and reduced motion everywhere.
- Remove Quick Test buttons, marketing badges, long splash.

## 9. Security and quality

- `sandbox: true`, strict CSP, local fonts, navigation/window-open guards, `openFile` restricted to library/download roots, no runtime remote code.
- Vitest on real modules (sanitizer, format mapping, progress parsers, subtitle order, playlist parsers, settings schema, queue state machine).
- Playwright-Electron smoke tests: paste → download → play; open/exit player.
- CI: typecheck, lint, test, package Windows + Linux.

## 10. Future handheld player

- Keep `packages/core` free of Electron.
- Portable output: `.m3u8`, embedded tags + `.lrc`, embedded art.
- Later "Sync to device": choose playlists → convert to device profile → copy to SD/USB.
- Pocket theme doubles as the device UI study.

## Build order

| Phase | Deliverable |
|---|---|
| 0 | Remove Android; upgrade Electron/Vite/Tailwind; typed IPC + settings schema; `packages/core`; spikes: Electron-as-Node for yt-dlp, Chromium AV1/HEVC/MKV playback, shader + visualizer performance |
| 1 | Bundled tools, tool manager, diagnostics |
| 2 | Download engine |
| 3 | Quality system (tiers, audio honesty, per-type presets, TV-safe, Convert, badges) |
| 4 | App design system + shell + Settings |
| 5 | Library + playlist detection |
| 6 | Player Mode |
| 7 | Player themes (Aurora → Vinyl → Pocket → Neon → Editorial → Liquid Glass) |
| 8 | English subtitles + Whisper Base/Small setting |
| 9 | Series mode, Discover, Repack/torrent polish |
| 10 | Security, tests, CI, auto-update, installers |
| Later | Device sync → handheld |

## References

- yt-dlp JS runtimes: https://github.com/yt-dlp/yt-dlp/wiki/EJS
- YouTube Music audio bitrates: https://github.com/yt-dlp/yt-dlp/issues/9724
- whisper.cpp models: https://github.com/ggml-org/whisper.cpp/blob/master/models/README.md
- Samsung 2020 TV video specs: https://developer.samsung.com/smarttv/develop/specifications/media-specifications/2020-tv-video-specifications.html
- Paper Shaders: https://github.com/paper-design/shaders
- Butterchurn: https://github.com/jberg/butterchurn
- applemusic-like-lyrics (AGPL-3.0, reference only): https://github.com/amll-dev/applemusic-like-lyrics
- Electron releases: https://releases.electronjs.org/
