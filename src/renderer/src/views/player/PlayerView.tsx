import { withArtSize } from '@core/artwork';
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, Library, Maximize2, Minimize2, Palette } from 'lucide-react';
import { PLAYER_THEMES, type PlayerTheme } from '@shared/settings';
import { cn } from '@/lib/cn';
import { useApp } from '@/stores/app';
import { usePlayer } from '@/stores/player';
import { AuroraCanvas } from './AuroraCanvas';
import { Dock } from './Dock';
import { QueueSheet } from './QueueSheet';
import { ArtView, LyricsView, VideoView } from './Stage';
import { StatsPanel, VideoControls } from './VideoControls';
import { extractPalette, toCss, type RGB } from './palette';
import { cueCss } from '@core/subtitleStyle';
import { CONTROLS_IDLE_MS, controlsHidden } from '@core/idleControls';
import { speedLabel, stepSpeed } from '@core/playbackSpeed';
import './player.css';

/** Anything that counts as "the person is here" and brings hidden controls back. */
const WAKE_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const;

const THEME_INFO: Record<PlayerTheme, { name: string; hint: string; swatch: string }> = {
  aurora: { name: 'Aurora', hint: 'Soft color from the artwork', swatch: 'radial-gradient(circle at 30% 30%,#FF7A59,transparent 60%),radial-gradient(circle at 70% 70%,#1FC8B4,transparent 60%),#7B5CFF' },
  vinyl: { name: 'Vinyl', hint: 'Spinning record, warm room', swatch: 'repeating-radial-gradient(circle,#111 0 2px,#1d1d22 2px 3px)' },
  pocket: { name: 'Pocket', hint: 'Y2K handheld with tape reels', swatch: 'linear-gradient(160deg,#EDE7DA,#CFC6B4)' },
};
const MODE_VALUE: Record<PlayerTheme, number> = { aurora: 0, vinyl: 0.85, pocket: 0.55 };

export function PlayerView() {
  const item = usePlayer((s) => s.queue[s.index] ?? null);
  const playing = usePlayer((s) => s.playing);
  const stage = usePlayer((s) => s.stage);
  const setStage = usePlayer((s) => s.setStage);
  const settings = useApp((s) => s.settings)!;
  const updateSettings = useApp((s) => s.updateSettings);
  const setMode = useApp((s) => s.setMode);
  const setView = useApp((s) => s.setView);
  const toast = useApp((s) => s.toast);

  const theme = settings.player.theme;
  const [colors, setColors] = useState<RGB[]>([[0.3, 0.25, 0.5], [0.5, 0.3, 0.25], [0.15, 0.4, 0.4]]);
  const [queueOpen, setQueueOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement));
  const [idle, setIdle] = useState(false);
  const [overChrome, setOverChrome] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [osd, setOsd] = useState<{ id: number; text: string } | null>(null);
  const osdId = useRef(0);
  /** A brief message in the middle of the picture, the way YouTube confirms a key press. */
  const flash = (text: string) => setOsd({ id: ++osdId.current, text });
  const root = useRef<HTMLDivElement>(null);
  const isVideo = item?.kind === 'video';
  const reduced = settings.appearance.reducedMotion === 'on' || (settings.appearance.reducedMotion === 'system' && matchMedia('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => {
    if (!item) return;
    let alive = true;
    void extractPalette(withArtSize(item.artworkUrl, 64) ?? item.artworkUrl, item.album ?? item.title).then((p) => alive && setColors(p));
    return () => { alive = false; };
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const setTheme = (t: PlayerTheme, announce = true) => {
    void updateSettings({ player: { theme: t } });
    if (announce) toast(`${THEME_INFO[t].name} theme`);
  };

  const exit = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    setMode('downloader');
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void root.current?.requestFullscreen().catch(() => toast('Full screen isn’t available.', 'error'));
  };

  useEffect(() => {
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // Hide controls after a few seconds of stillness while a video plays; any movement or key brings
  // them straight back. `playing` is a dependency so the countdown restarts on resume — otherwise a
  // video paused long enough to go "idle" would lose its controls the instant it started again.
  useEffect(() => {
    if (!isVideo) return;
    let timer = setTimeout(() => setIdle(true), CONTROLS_IDLE_MS);
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), CONTROLS_IDLE_MS);
    };
    wake();
    for (const ev of WAKE_EVENTS) addEventListener(ev, wake, { passive: true });
    return () => {
      clearTimeout(timer);
      for (const ev of WAKE_EVENTS) removeEventListener(ev, wake);
      setIdle(false);
    };
  }, [isVideo, playing]);

  // A new video starts with a clean slate: no leftover menu or stats from the last one.
  useEffect(() => { setSettingsOpen(false); setOverChrome(false); }, [item?.id]);

  /** Play or pause, and say which — a click on the picture otherwise gives no sign it registered. */
  const togglePlay = () => {
    const p = usePlayer.getState();
    const willPlay = !p.playing;
    p.toggle();
    if (isVideo) flash(willPlay ? '▶  Play' : '❚❚  Paused');
  };

  const seekBy = (seconds: number) => {
    const p = usePlayer.getState();
    p.seek(p.time + seconds);
    if (isVideo) flash(`${seconds > 0 ? '+' : '−'}${Math.abs(seconds)} s`);
  };

  const changeRate = (direction: 1 | -1) => {
    const p = usePlayer.getState();
    const next = stepSpeed(p.rate, direction);
    p.setRate(next);
    flash(`Speed ${speedLabel(next)}`);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : document.body;
      if (target.matches('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
      const p = usePlayer.getState();
      switch (e.key) {
        case ' ':
          if (target.matches('button, [role="slider"]')) return;
          e.preventDefault();
          togglePlay();
          break;
        // K is YouTube's play/pause, so it works for anyone who already types it.
        case 'k': case 'K': togglePlay(); break;
        case 'ArrowRight': if (!target.matches('[role="slider"]')) seekBy(5); break;
        case 'ArrowLeft': if (!target.matches('[role="slider"]')) seekBy(-5); break;
        case 'j': case 'J': if (isVideo) seekBy(-10); break;
        case 'ArrowUp': case 'ArrowDown': {
          e.preventDefault();
          p.setVolume(p.volume + (e.key === 'ArrowUp' ? 0.05 : -0.05));
          if (isVideo) flash(`Volume ${Math.round(usePlayer.getState().volume * 100)}%`);
          break;
        }
        // In a video L skips ahead (YouTube); on a song it flips between art and lyrics.
        case 'l': case 'L':
          if (isVideo) seekBy(10);
          else p.setStage(p.stage === 'art' ? 'lyrics' : 'art');
          break;
        case 'q': case 'Q': setQueueOpen((o) => !o); break;
        case 'h': case 'H': void p.toggleLike(); break;
        case 'm': case 'M': p.toggleMute(); if (isVideo) flash(usePlayer.getState().muted ? 'Muted' : 'Sound on'); break;
        case 'c': case 'C': if (isVideo) { p.toggleSubtitles(); flash(usePlayer.getState().subtitles ? 'Subtitles on' : 'Subtitles off'); } break;
        case 'i': case 'I': if (isVideo) setStatsOpen((on) => !on); break;
        case '<': if (isVideo) changeRate(-1); break;
        case '>': if (isVideo) changeRate(1); break;
        case 'f': case 'F': toggleFullscreen(); break;
        case 'n': case 'N': p.next(); break;
        case 'p': case 'P': p.previous(); break;
        case 't': case 'T': setTheme(PLAYER_THEMES[(PLAYER_THEMES.indexOf(theme) + 1) % PLAYER_THEMES.length]!); break;
        case 'Escape':
          if (settingsOpen) setSettingsOpen(false);
          else if (menuOpen) setMenuOpen(false);
          else if (queueOpen) setQueueOpen(false);
          else if (!document.fullscreenElement) exit();
          break;
        default:
          // 0–9 jump to that tenth of the video, as on YouTube.
          if (isVideo && /^[0-9]$/.test(e.key) && p.duration > 0) {
            p.seek((p.duration * Number(e.key)) / 10);
            flash(`${Number(e.key) * 10}%`);
          }
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }); // re-bind each render so handlers see current theme/menu state

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('[data-theme-menu]')) setMenuOpen(false); };
    addEventListener('pointerdown', close);
    return () => removeEventListener('pointerdown', close);
  }, [menuOpen]);

  useEffect(() => {
    if (!settingsOpen) return;
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('[data-video-menu]')) setSettingsOpen(false); };
    addEventListener('pointerdown', close);
    return () => removeEventListener('pointerdown', close);
  }, [settingsOpen]);

  // The pointer resting on the bar or header must keep them up; see controlsHidden.
  const chromeHover = { onPointerEnter: () => setOverChrome(true), onPointerLeave: () => setOverChrome(false) };

  const view = isVideo ? 'art' : stage;

  return (
    <div
      ref={root}
      className="player fixed inset-0 z-40 grid grid-rows-[auto_1fr_auto]"
      data-player-theme={theme}
      data-playing={playing || undefined}
      data-video={isVideo || undefined}
      data-idle={(isVideo && controlsHidden({ idle, playing, pointerOverChrome: overChrome, menuOpen: settingsOpen, queueOpen })) || undefined}
      data-lyrics-size={settings.player.lyricsSize}
      style={{ viewTransitionName: 'player', ['--p-c1' as string]: toCss(colors[0]!), ['--p-c2' as string]: toCss(colors[1]!) }}
    >
      {/* Subtitle look comes from Settings › Subtitles, shared with the preview and burn-in. */}
      <style>{`.player video::cue{${cueCss(settings.subtitles.style)}}`}</style>
      {!isVideo && <AuroraCanvas colors={colors} mode={MODE_VALUE[theme]} still={reduced || settings.player.effects === 'still'} />}
      {!isVideo && <div className="scrim pointer-events-none absolute inset-0 -z-10" />}

      <header className={cn('p-top drag flex items-center justify-between px-[clamp(16px,3vw,32px)] pt-3', isVideo && 'relative z-10', window.lumina.platform !== 'darwin' && !fullscreen && 'pr-[150px]')}>
        <button onClick={exit} title="Exit player (Esc)" {...chromeHover} className={cn('p-btn no-drag flex shrink-0 items-center gap-2 rounded-xl py-2 pr-3 pl-2 text-sm font-medium', window.lumina.platform === 'darwin' && !fullscreen && 'ml-[70px]')}>
          <ChevronLeft className="size-5" /> Exit
        </button>
        {/* The title lives up here for video, so the bottom bar can be a thin strip over the picture. */}
        {isVideo && item && <span className="min-w-0 flex-1 truncate px-3 text-[15px] font-medium" data-selectable>{item.title}</span>}
        <div className="no-drag relative flex gap-1" data-theme-menu>
          {!isVideo && (
            <button className="p-btn grid size-10 place-items-center rounded-xl" aria-label="Player theme" title="Theme (T)" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
              <Palette className="size-5" />
            </button>
          )}
          {/* Video has its own full-screen button in the control bar. */}
          {!isVideo && (
            <button className="p-btn grid size-10 place-items-center rounded-xl" aria-label={fullscreen ? 'Exit full screen' : 'Full screen'} title="Full screen (F)" onClick={toggleFullscreen}>
              {fullscreen ? <Minimize2 className="size-5" /> : <Maximize2 className="size-5" />}
            </button>
          )}
          {menuOpen && (
            <div role="menu" className="p-menu absolute top-12 right-11 z-20 w-[240px] rounded-2xl p-1.5 animate-rise">
              {PLAYER_THEMES.map((t) => (
                <button key={t} role="menuitemradio" aria-checked={theme === t} onClick={() => { setTheme(t, false); setMenuOpen(false); }}
                  className={cn('flex w-full items-center gap-3 rounded-[11px] p-2.5 text-left transition-colors hover:bg-white/6', theme === t && 'bg-white/9')}>
                  <span className="size-[34px] shrink-0 rounded-[9px] border border-white/12" style={{ background: THEME_INFO[t].swatch }} />
                  <span className="min-w-0 flex-1">
                    <b className="block text-sm font-semibold">{THEME_INFO[t].name}</b>
                    <small className="text-xs text-[var(--p-ink-3)]">{THEME_INFO[t].hint}</small>
                  </span>
                  {theme === t && <Check className="size-4 text-[var(--p-accent)]" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {/*
        Video fills the whole player and the chrome floats over it. Keeping video in the middle grid
        row with margins was why it stayed a small rectangle even in full screen: the row could never
        be taller than the space left by the header and the dock.
      */}
      <section
        className={cn(isVideo ? 'absolute inset-0 z-0' : 'relative mx-[clamp(16px,4vw,48px)] my-3 min-h-0')}
        aria-live="polite"
      >
        {!item ? (
          <div className="grid h-full place-items-center text-center">
            <div>
              <p className="font-serif text-4xl">Nothing playing</p>
              <p className="mt-2 text-[var(--p-ink-3)]">Pick something from your library or a playlist on this PC.</p>
              <div className="mt-6 flex justify-center gap-2">
                <button onClick={() => setView('library')} className="flex items-center gap-2 rounded-xl bg-[var(--p-ink)] px-4 py-2.5 text-sm font-semibold text-[#0b0a10] transition-transform hover:scale-[1.02] active:scale-[0.98]"><Library className="size-4" /> Open library</button>
                <button onClick={() => setQueueOpen(true)} className="p-btn rounded-xl border border-white/12 px-4 py-2.5 text-sm font-semibold">Playlists on this PC</button>
              </div>
            </div>
          </div>
        ) : isVideo ? (
          <VideoView off={false} onTap={togglePlay} onDoubleTap={toggleFullscreen} />
        ) : (
          <>
            <ArtView item={item} theme={theme} off={view !== 'art'} />
            <LyricsView off={view !== 'lyrics'} />
          </>
        )}
      </section>

      {item
        ? (
          // Row 3 on purpose: in video mode the stage is absolutely positioned and leaves the grid, so
          // without an explicit row this wrapper slid up into the empty middle row, directly under
          // the header — the controls ended up across the top of the screen.
          <div className={cn('row-start-3', isVideo && 'relative z-10')} {...(isVideo ? chromeHover : {})}>
            {isVideo
              ? (
                <VideoControls
                  fullscreen={fullscreen} onFullscreen={toggleFullscreen}
                  queueOpen={queueOpen} onQueue={() => setQueueOpen((o) => !o)}
                  settingsOpen={settingsOpen} onSettings={setSettingsOpen}
                  statsOpen={statsOpen} onStats={setStatsOpen}
                />
              )
              : <Dock item={item} stage={view} onStage={setStage} queueOpen={queueOpen} onQueue={() => setQueueOpen((o) => !o)} />}
          </div>
        )
        : <div className="h-6" />}

      {isVideo && statsOpen && item && <StatsPanel item={item} onClose={() => setStatsOpen(false)} />}
      {/* Keyed so each message restarts the animation, even when the text is the same twice running. */}
      {isVideo && osd && <div key={osd.id} className="p-osd" role="status">{osd.text}</div>}

      <QueueSheet open={queueOpen} onClose={() => setQueueOpen(false)} />
    </div>
  );
}
