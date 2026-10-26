import { useEffect, useState } from 'react';
import { Activity, Captions, Check, ChevronLeft, ChevronRight, Gauge, ListMusic, Maximize2, Minimize2, Pause, Play, Settings, SkipBack, SkipForward, SlidersHorizontal, Volume2, VolumeX } from 'lucide-react';
import type { PlayableItem } from '@shared/types';
import { PLAYBACK_SPEEDS, speedLabel } from '@core/playbackSpeed';
import { bufferedAhead, droppedPercent, formatKbps, formatResolution, gainDb } from '@core/videoStats';
import { MAX_VOLUME, isBoosting, volumeLabel } from '@core/volume';
import { cn } from '@/lib/cn';
import { audioGains } from '@/lib/audio';
import { isRemuxing, media, usePlayer } from '@/stores/player';
import { AudioPanel } from './AudioPanel';
import { SeekBar } from './Dock';

/**
 * The control bar for video: the layout people already know from YouTube and Netflix.
 *
 * Deliberately not the music Dock. That one has a large serif title, lyrics tabs and keyboard hints,
 * which suit a song and sit on top of a film. This one is a thin bar — seek line, then transport on
 * the left and settings on the right — that PlayerView fades away while the picture plays.
 */
export function VideoControls({ fullscreen, onFullscreen, queueOpen, onQueue, settingsOpen, onSettings, statsOpen, onStats }: {
  fullscreen: boolean; onFullscreen: () => void;
  queueOpen: boolean; onQueue: () => void;
  settingsOpen: boolean; onSettings: (open: boolean) => void;
  statsOpen: boolean; onStats: (on: boolean) => void;
}) {
  const p = usePlayer();
  const item = p.current();
  const [soundOpen, setSoundOpen] = useState(false);
  if (!item) return null;
  const many = p.queue.length > 1;

  return (
    <footer className="p-dock p-vbar mx-auto grid w-full max-w-[1400px] gap-1 px-[clamp(16px,2.4vw,32px)] pb-4" aria-label="Video controls">
      <SeekBar />
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button onClick={p.toggle} aria-label={p.playing ? 'Pause' : 'Play'} title={p.playing ? 'Pause (K)' : 'Play (K)'} className="p-btn grid size-11 place-items-center rounded-xl">
            {p.playing ? <Pause className="size-6 fill-current" /> : <Play className="ml-0.5 size-6 fill-current" />}
          </button>
          {many && <button onClick={p.previous} aria-label="Previous" title="Previous (P)" className="p-btn grid size-10 place-items-center rounded-xl"><SkipBack className="size-5 fill-current" /></button>}
          {many && <button onClick={p.next} aria-label="Next" title="Next (N)" className="p-btn grid size-10 place-items-center rounded-xl"><SkipForward className="size-5 fill-current" /></button>}
          <button onClick={p.toggleMute} aria-label={p.muted ? 'Unmute' : 'Mute'} title="Mute (M)" className="p-btn grid size-10 place-items-center rounded-xl">
            {p.muted || p.volume === 0 ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
          </button>
          <input
            className="p-range" type="range" min={0} max={MAX_VOLUME} step={0.01} value={p.muted ? 0 : p.volume} aria-label="Volume"
            aria-valuetext={volumeLabel(p.muted ? 0 : p.volume)} onChange={(e) => p.setVolume(Number(e.target.value))} onDoubleClick={() => p.setVolume(1)}
            title="Volume — double-click for 100%"
          />
          <span className={cn('w-10 shrink-0 text-[11px] tabular', isBoosting(p.volume) && !p.muted ? 'font-semibold text-[var(--p-accent)]' : 'text-[var(--p-ink-3)]')}>
            {volumeLabel(p.muted ? 0 : p.volume)}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button onClick={p.toggleSubtitles} aria-label="English subtitles" aria-pressed={p.subtitles} title="Subtitles (C)" className="p-btn grid size-10 place-items-center rounded-xl"><Captions className="size-5" /></button>
          <div className="relative">
            <button onClick={() => setSoundOpen((v) => !v)} aria-label="Sound and equalizer" aria-haspopup="dialog" aria-expanded={soundOpen} title="Sound & equalizer" className="p-btn grid size-10 place-items-center rounded-xl"><SlidersHorizontal className="size-5" /></button>
            {soundOpen && <AudioPanel onClose={() => setSoundOpen(false)} />}
          </div>
          <div className="relative" data-video-menu>
            <button onClick={() => onSettings(!settingsOpen)} aria-label="Settings" aria-haspopup="menu" aria-expanded={settingsOpen} title="Settings" className="p-btn grid size-10 place-items-center rounded-xl">
              <Settings className={cn('size-5 transition-transform duration-300', settingsOpen && 'rotate-45')} />
            </button>
            {settingsOpen && <SettingsMenu item={item} statsOpen={statsOpen} onStats={onStats} onClose={() => onSettings(false)} />}
          </div>
          {many && <button onClick={onQueue} aria-pressed={queueOpen} aria-label="Queue" title="Queue (Q)" className="p-btn grid size-10 place-items-center rounded-xl"><ListMusic className="size-5" /></button>}
          <button onClick={onFullscreen} aria-label={fullscreen ? 'Exit full screen' : 'Full screen'} title="Full screen (F)" className="p-btn grid size-10 place-items-center rounded-xl">
            {fullscreen ? <Minimize2 className="size-5" /> : <Maximize2 className="size-5" />}
          </button>
        </div>
      </div>
    </footer>
  );
}

function SettingsMenu({ item, statsOpen, onStats, onClose }: { item: PlayableItem; statsOpen: boolean; onStats: (on: boolean) => void; onClose: () => void }) {
  const [page, setPage] = useState<'main' | 'speed'>('main');
  const rate = usePlayer((s) => s.rate);
  const setRate = usePlayer((s) => s.setRate);
  const subtitles = usePlayer((s) => s.subtitles);
  const toggleSubtitles = usePlayer((s) => s.toggleSubtitles);

  const row = 'flex w-full items-center gap-3 rounded-[11px] px-3 py-2.5 text-left text-sm transition-colors hover:bg-white/8';
  const size = formatResolution(item.tech?.width ?? media.videoWidth, item.tech?.height ?? media.videoHeight);

  return (
    <div role="menu" aria-label="Video settings" className="p-menu absolute right-0 bottom-12 z-20 w-[300px] rounded-2xl p-1.5 animate-rise" style={{ transformOrigin: 'bottom right' }}>
      {page === 'main' ? (
        <>
          <button role="menuitem" className={row} onClick={() => setPage('speed')}>
            <Gauge className="size-[18px] text-[var(--p-ink-2)]" />
            <span className="flex-1">Playback speed</span>
            <span className="text-[var(--p-ink-3)]">{speedLabel(rate)}</span>
            <ChevronRight className="size-4 text-[var(--p-ink-3)]" />
          </button>
          <button role="menuitemcheckbox" aria-checked={subtitles} className={row} onClick={toggleSubtitles}>
            <Captions className="size-[18px] text-[var(--p-ink-2)]" />
            <span className="flex-1">Subtitles</span>
            <span className="text-[var(--p-ink-3)]">{subtitles ? 'English' : 'Off'}</span>
          </button>
          {/* Informational on purpose. A file on disk has exactly one quality, so a chooser would be
              a control that does nothing; the real chooser belongs to streaming, where there are
              renditions to choose between. */}
          <div role="menuitem" aria-disabled="true" className={cn(row, 'cursor-default hover:bg-transparent')} title="This is a file on this computer, so there is one quality — the original.">
            <SlidersHorizontal className="size-[18px] text-[var(--p-ink-2)]" />
            <span className="flex-1">Quality</span>
            <span className="text-[var(--p-ink-3)]">Original · {size}</span>
          </div>
          <button role="menuitemcheckbox" aria-checked={statsOpen} className={row} onClick={() => { onStats(!statsOpen); onClose(); }}>
            <Activity className="size-[18px] text-[var(--p-ink-2)]" />
            <span className="flex-1">Stats for nerds</span>
            <span className="text-[var(--p-ink-3)]">{statsOpen ? 'On' : 'Off'}</span>
          </button>
        </>
      ) : (
        <>
          <button role="menuitem" className={cn(row, 'font-semibold')} onClick={() => setPage('main')}>
            <ChevronLeft className="size-[18px]" /> Playback speed
          </button>
          <div className="my-1 h-px bg-[var(--p-line)]" />
          {PLAYBACK_SPEEDS.map((s) => (
            <button key={s} role="menuitemradio" aria-checked={rate === s} className={row} onClick={() => { setRate(s); onClose(); }}>
              <span className="flex-1">{speedLabel(s)}</span>
              {rate === s && <Check className="size-4 text-[var(--p-accent)]" />}
            </button>
          ))}
        </>
      )}
    </div>
  );
}

/** Live numbers off the media element, refreshed twice a second while open. */
export function StatsPanel({ item, onClose }: { item: PlayableItem; onClose: () => void }) {
  const [, tick] = useState(0);
  const rate = usePlayer((s) => s.rate);
  const volume = usePlayer((s) => s.volume);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);

  const q = media.getVideoPlaybackQuality?.();
  const ranges = Array.from({ length: media.buffered.length }, (_, i) => ({ start: media.buffered.start(i), end: media.buffered.end(i) }));
  const gains = audioGains();
  const dropped = q ? `${q.droppedVideoFrames} / ${q.totalVideoFrames} (${droppedPercent(q.droppedVideoFrames, q.totalVideoFrames).toFixed(1)}%)` : 'unavailable';
  const t = item.tech;
  const rows: [string, string][] = [
    ['Resolution', `${formatResolution(media.videoWidth, media.videoHeight)} in ${innerWidth}×${innerHeight}`],
    ['Codec', t?.codec ?? 'unknown'],
    ['Bitrate', formatKbps(t?.bitrateKbps)],
    ['Audio', t?.sampleRate ? `${(t.sampleRate / 1000).toFixed(1)} kHz${t.bitDepth ? ` · ${t.bitDepth}-bit` : ''}${t.lossless ? ' · lossless' : ''}` : 'unknown'],
    ['Frames dropped', dropped],
    ['Buffer ahead', `${bufferedAhead(ranges, media.currentTime).toFixed(1)} s`],
    ['Speed', speedLabel(rate)],
    ['Volume', `${Math.round(volume * 100)}%`],
    ['Loudness gain', `${gainDb(gains.track)} track · ${gainDb(gains.boost)} boost`],
    ['Playback', isRemuxing() ? 'Converted live by ffmpeg' : 'Direct'],
  ];

  return (
    <div className="absolute top-[68px] left-4 z-20 w-[360px] rounded-xl bg-black/75 p-3 font-mono text-[11.5px] leading-[1.55] text-white/85 backdrop-blur-md" role="status" aria-label="Stats for nerds">
      <div className="mb-1 flex items-center justify-between font-sans text-xs font-semibold tracking-wide text-white/60 uppercase">
        Stats for nerds
        <button onClick={onClose} className="rounded px-1.5 py-0.5 hover:bg-white/10" aria-label="Close stats">Close</button>
      </div>
      <dl className="grid grid-cols-[110px_1fr] gap-x-2">
        {rows.map(([k, v]) => (
          <div key={k} className="contents"><dt className="text-white/50">{k}</dt><dd className="break-words">{v}</dd></div>
        ))}
      </dl>
    </div>
  );
}
