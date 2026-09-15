# Lumina Media Workstation — UI/UX & Motion Design Specification

## 1. Visual Architecture & Design Philosophy
Lumina does not use off-the-shelf standard OS widgets or generic web forms. Every visual element—from the canvas backdrop to the smallest slider thumb—is custom-crafted with a **Cyber-Minimalist Glassmorphism** design language.

```
+-----------------------------------------------------------------------------------------------+
| [L] Lumina Media Workstation    [Search/Filter...]                [_] [口] [X] Custom Titlebar |
+-----------------------------------------------------------------------------------------------+
| [NAV]       | [MAIN WORKSPACE]                                                                |
|             | +-----------------------------------------------------------------------------+ |
| ⚡ Ingest    | | [ 🔗 Paste any Video or Playlist Link (YouTube, Insta, etc.) ]   [⚡ ANALYZE]| |
|             | +-----------------------------------------------------------------------------+ |
| ⬇ Downloads  |                                                                                 |
|             | [INSPECTED MEDIA CARD: 4K Video Preview]                                        |
| 🎵 Music Hub| +-------------------------+ +-------------------+ +--------------+ +----------+ |
|             | | Video Resolutions       | | Audio Formats     | | Subtitles    | | Action   | |
| 📂 Library  | | (•) 4K 2160p60 (AV1)    | | (•) FLAC Lossless | | [x] Embed    | | [START   | |
|             | | ( ) 1440p 60fps (VP9)   | | ( ) MP3 320kbps   | | Lang: [EN ▾] | | DOWNLOAD]| |
| ⚙ Settings  | | ( ) 1080p 60fps (H.264) | | ( ) OPUS High-Res | | [ ] Auto-Gen | |          | |
|             | +-------------------------+ +-------------------+ +--------------+ +----------+ |
|             |                                                                                 |
|             | [ACTIVE DOWNLOADS QUEUE]                                                        |
|             | +-----------------------------------------------------------------------------+ |
|             | | Starfield 4K Gameplay Reveal • Bethesda • 68% • 14.2 MB/s • ETA: 1m 25s     | |
|             | | [==========================================-----------------] [MUXING STAGE]| |
|             | +-----------------------------------------------------------------------------+ |
|             |                                                                                 |
| [STORAGE]   | [MINI-PLAYER DOCK]                                                              |
| 💾 USB: ON  | [⏮] [▶] [⏭]  "Track Title - Artist"  [===|||||||||||||||||||====]  🔊 [===---]  |
+-----------------------------------------------------------------------------------------------+
```

---

## 2. Dynamic Ambient Background Canvas
To achieve a living, breathing interface without impacting CPU/GPU performance:
- **Renderer**: HTML5 2D Canvas or lightweight WebGL fragment shader running on an independent `requestAnimationFrame` loop.
- **Behavior**:
  - Three soft radial plasma nodes (Cyan `#00F2FE`, Deep Violet `#7928CA`, Dark Indigo `#10121A`) drift smoothly across the viewport with Perlin noise / trigonometric oscillation.
  - **Bandwidth Reactive**: When active downloads exceed 10 MB/s, the plasma nodes subtly intensify in luminance (+15% brightness) and gently pulse in sync with network throughput.
  - **Audio Reactive**: During in-app music playback, the background subtly ripples with low-frequency bass hits.
  - **Battery & Eco Saver Mode**: User toggle in Settings switches the dynamic shader to a high-efficiency static multi-stop CSS gradient (`radial-gradient(ellipse at top, #181928, #08090D)`).

---

## 3. Custom Component Design Library

### 3.1 Custom Window Frame & Titlebar
- **Window Behavior**: Frameless window (`frame: false` in Electron) with custom window drag region (`-webkit-app-region: drag`).
- **KDE Plasma & Windows Integration**: Interactive controls on the top right (`minimize`, `maximize/restore`, `close`) respect standard OS button orders while matching the Lumina glow theme.
- **Always-on-Top Pin**: Dedicated pin icon button allowing users to keep Lumina as a floating companion while browsing.

### 3.2 Smart Omnibox (URL Input Bar)
- **Clipboard Auto-Snoop**: An intelligent listener monitors clipboard text changes when the window regains focus. If a valid YouTube, Instagram, TikTok, or Twitter URL is detected, a floating glass pill badge appears above the input:
  `"📋 YouTube link detected from clipboard — [Click to Paste & Inspect]"`
- **Glowing Interactive Border**: While focused, the omnibox border illuminates with a continuous conic gradient glow animation running around its perimeter.
- **Clear & Analyze Micro-buttons**: One-click clear (`X`) and dynamic `Analyze` button with an animated spinning orbital ring during stream extraction.

### 3.3 Format & Stream Inspection Matrix
Once a link is analyzed, a high-density, beautifully arranged inspector appears:
1. **Media Hero Preview**:
   - High-definition thumbnail with duration overlay pill (`15:24`).
   - Platform badge (`YouTube`, `Instagram Reels`, `TikTok`, `SoundCloud`).
   - Metadata rows: Title, Channel/Author with verified icon, View count, Upload date, and Live Stream indicator.
2. **Video Quality Selector**:
   - Displays all streams provided by the platform:
     - `8K 4320p (60fps HDR • AV1) ~ 8.4 GB`
     - `4K 2160p (60fps • AV1/VP9) ~ 3.8 GB`
     - `2K 1440p (60fps • VP9) ~ 1.9 GB`
     - `1080p (60fps • H.264/AVC) ~ 850 MB`
     - `720p / 480p / 360p (Data Saver)`
   - Codec tags (`AV1`, `VP9`, `H.264`) allow users to prioritize hardware compatibility or compression efficiency.
3. **Audio Extraction Selector**:
   - One-click toggle between "Full Video" or "Audio Only".
   - Target audio formats:
     - `FLAC (Lossless 24-bit/48kHz)`
     - `MP3 (320 kbps CBR High-Fidelity)`
     - `OPUS (160 kbps VBR — Optimal Voice/Music clarity)`
     - `AAC / M4A (256 kbps — Apple / Mobile native)`
     - `WAV (Uncompressed PCM)`
4. **Subtitles & Closed Captions Panel**:
   - **With/Without Toggle**: Master switch to enable or disable subtitle fetching.
   - **Source Tabs**: Creator-Uploaded (clean, punctuated) vs. Auto-Generated (ASR).
   - **Language Multi-Select**: Dropdown with instant search and flags/language tags (English, Spanish, French, German, Hindi, Japanese, etc.).
   - **Container Mode**:
     - `Soft Subtitles (Embed as subtitle track inside MKV/MP4 container)`
     - `Hardcoded / Burn-in (Permanently rendered into video frames)`
     - `External Files (Export alongside as .srt or .vtt)`

### 3.4 Download Queue & Real-time Progress Cards
- **Card Anatomy**:
  - Elevated glass container with a subtle 1px border.
  - Video thumbnail avatar on the left.
  - Dynamic Title and Channel.
  - Metrics line: `68% completed • 2.58 GB / 3.80 GB • 14.2 MB/s • ETA: 1m 25s`.
  - Continuous animated progress bar with a glowing cyan head that emits light on the track.
  - **Dynamic Stage Badge**:
    - `[PROBING]` (Violet)
    - `[DOWNLOADING VIDEO]` (Cyan)
    - `[DOWNLOADING AUDIO]` (Indigo)
    - `[MUXING STREAMS (FFmpeg)]` (Amber)
    - `[TRANSFERRING TO USB]` (Emerald)
    - `[COMPLETE]` (Emerald Glow)
- **Control Bar**:
  - Pause / Resume download.
  - Cancel & delete temp files.
  - Open File directly with system default player.
  - Open target folder in file manager (Dolphin on Fedora KDE, Explorer on Windows).

### 3.5 Removable Storage (USB Pendrive) Detection Banner
- When a USB flash drive is connected to the computer:
  - An animated bottom-right glass banner slides in with spring physics:
    `"💾 Pendrive Detected: SanDisk Ultra (38.4 GB Free) • Auto-save directory configured"`
  - Status indicator in the sidebar turns from Gray (Internal Only) to Glowing Emerald (USB Active).
  - Hovering reveals a tooltip detailing the exact mount path (`/run/media/nikhl/SANDISK/LuminaMedia`).

### 3.6 In-App Audio & Video Mini-Player Dock
- Docked persistently at the bottom or expandable into a full-screen theater modal:
  - Live audio waveform canvas visualizer reflecting frequency bins.
  - Smooth seek bar with hover timestamp preview.
  - Volume slider with logarithmic curve.
  - Playlist & play queue drawer with drag-and-drop reordering.
  - Equalizer presets (Flat, Bass Boost, Vocal Enhance, Treble Boost).

---

## 4. Motion Design & Animation Physics

| Interaction | Animation Curve / Physics | Duration | Visual Feedback |
| :--- | :--- | :--- | :--- |
| **Button Hover** | `cubic-bezier(0.16, 1, 0.3, 1)` | 180ms | +10% scale, border glow intensify, soft drop-shadow |
| **Button Click / Tap** | `spring(damping: 18, stiffness: 350)` | 120ms | -4% scale compression, ripple radiating from click coordinate |
| **Modal / Card Slide In** | `spring(damping: 24, stiffness: 280)` | 340ms | Slide up 20px, fade from 0 to 1, backdrop blur ramps to 24px |
| **Tab Transition** | Framer Motion layoutId pill | 220ms | Animated pill background glides between active tabs |
| **Progress Fill** | Linear interpolation (lerp 0.15) | Real-time | Smooth progress bar movement without jagged jumps on network bursts |
| **USB Connected Banner** | `spring(damping: 20, stiffness: 220)` | 400ms | Slides up from bottom right with soft emerald halo |
