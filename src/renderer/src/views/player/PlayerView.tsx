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
import { extractPalette, toCss, type RGB } from './palette';
import { cueCss } from '@core/subtitleStyle';
import './player.css';

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

  // Hide controls after a moment of stillness while a video plays.
  useEffect(() => {
    if (!isVideo) return;
    let timer = setTimeout(() => setIdle(true), 2500);
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), 2500);
    };
    addEventListener('pointermove', wake);
    addEventListener('keydown', wake);
    return () => {
      clearTimeout(timer);
      removeEventListener('pointermove', wake);
      removeEventListener('keydown', wake);
      setIdle(false);
    };
  }, [isVideo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : document.body;
      if (target.matches('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
      const p = usePlayer.getState();
      switch (e.key) {
        case ' ':
          if (target.matches('button, [role="slider"]')) return;
          e.preventDefault();
          p.toggle();
          break;
        case 'ArrowRight': if (!target.matches('[role="slider"]')) p.seek(p.time + 5); break;
        case 'ArrowLeft': if (!target.matches('[role="slider"]')) p.seek(p.time - 5); break;
        case 'ArrowUp': e.preventDefault(); p.setVolume(p.volume + 0.05); break;
        case 'ArrowDown': e.preventDefault(); p.setVolume(p.volume - 0.05); break;
        case 'l': case 'L': if (!isVideo) p.setStage(p.stage === 'art' ? 'lyrics' : 'art'); break;
        case 'q': case 'Q': setQueueOpen((o) => !o); break;
        case 'm': case 'M': p.toggleMute(); break;
        case 'c': case 'C': if (isVideo) p.toggleSubtitles(); break;
        case 'f': case 'F': toggleFullscreen(); break;
        case 'n': case 'N': p.next(); break;
        case 'p': case 'P': p.previous(); break;
        case 't': case 'T': setTheme(PLAYER_THEMES[(PLAYER_THEMES.indexOf(theme) + 1) % PLAYER_THEMES.length]!); break;
        case 'Escape':
          if (menuOpen) setMenuOpen(false);
          else if (queueOpen) setQueueOpen(false);
          else if (!document.fullscreenElement) exit();
          break;
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

  const view = isVideo ? 'art' : stage;

  return (
    <div
      ref={root}
      className="player fixed inset-0 z-40 grid grid-rows-[auto_1fr_auto]"
      data-player-theme={theme}
      data-playing={playing || undefined}
      data-video={isVideo || undefined}
      data-idle={(isVideo && idle && playing && !queueOpen) || undefined}
      data-lyrics-size={settings.player.lyricsSize}
      style={{ viewTransitionName: 'player', ['--p-c1' as string]: toCss(colors[0]!), ['--p-c2' as string]: toCss(colors[1]!) }}
    >
      {/* Subtitle look comes from Settings › Subtitles, shared with the preview and burn-in. */}
      <style>{`.player video::cue{${cueCss(settings.subtitles.style)}}`}</style>
      {!isVideo && <AuroraCanvas colors={colors} mode={MODE_VALUE[theme]} still={reduced || settings.player.effects === 'still'} />}
      {!isVideo && <div className="scrim pointer-events-none absolute inset-0 -z-10" />}

      <header className={cn('p-top drag flex items-center justify-between px-[clamp(16px,3vw,32px)] pt-3', isVideo && 'relative z-10', window.lumina.platform !== 'darwin' && !fullscreen && 'pr-[150px]')}>
        <button onClick={exit} title="Exit player (Esc)" className={cn('p-btn no-drag flex items-center gap-2 rounded-xl py-2 pr-3 pl-2 text-sm font-medium', window.lumina.platform === 'darwin' && !fullscreen && 'ml-[70px]')}>
          <ChevronLeft className="size-5" /> Exit
        </button>
        <div className="no-drag relative flex gap-1" data-theme-menu>
          {!isVideo && (
            <button className="p-btn grid size-10 place-items-center rounded-xl" aria-label="Player theme" title="Theme (T)" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
              <Palette className="size-5" />
            </button>
          )}
          <button className="p-btn grid size-10 place-items-center rounded-xl" aria-label={fullscreen ? 'Exit full screen' : 'Full screen'} title="Full screen (F)" onClick={toggleFullscreen}>
            {fullscreen ? <Minimize2 className="size-5" /> : <Maximize2 className="size-5" />}
          </button>
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
          <VideoView off={false} />
        ) : (
          <>
            <ArtView item={item} theme={theme} off={view !== 'art'} />
            <LyricsView off={view !== 'lyrics'} />
          </>
        )}
      </section>

      {item
        ? (
          <div className={cn(isVideo && 'relative z-10')}>
            <Dock item={item} stage={view} onStage={setStage} queueOpen={queueOpen} onQueue={() => setQueueOpen((o) => !o)} />
          </div>
        )
        : <div className="h-6" />}

      <QueueSheet open={queueOpen} onClose={() => setQueueOpen(false)} />
    </div>
  );
}
