import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { LoaderCircle, MicVocal } from 'lucide-react';
import type { PlayableItem } from '@shared/types';
import type { PlayerTheme } from '@shared/settings';
import { activeLineIndex } from '@core/lyrics';
import { formatDuration } from '@core/format';
import { media, usePlayer } from '@/stores/player';
import { Artwork } from '@/components/Artwork';

export function ArtView({ item, theme, off }: { item: PlayableItem; theme: PlayerTheme; off: boolean }) {
  const time = usePlayer((s) => (theme === 'pocket' ? Math.floor(s.time) : 0));
  const playing = usePlayer((s) => s.playing);
  const volume = usePlayer((s) => (s.muted ? 0 : Math.round(s.volume * 10)));
  const art = item.artworkUrl;

  return (
    <div className="p-view absolute inset-0 grid place-items-center" data-off={off || undefined}>
      {theme === 'aurora' && (
        <div style={{ viewTransitionName: off ? undefined : 'now-playing-art' }} className="rounded-[18px]">
          <Artwork src={art} seed={item.album ?? item.title} className="p-cover" rounded="rounded-[18px]" />
        </div>
      )}
      {theme === 'vinyl' && (
        <div className="p-deck">
          <div className="p-record">
            <div className="p-label"><Artwork src={art} seed={item.album ?? item.title} className="size-full" rounded="rounded-none" /></div>
          </div>
          <div className="p-tonearm" aria-hidden="true"><b /><i /><em /></div>
        </div>
      )}
      {theme === 'pocket' && (
        <div className="p-pocket">
          <div className="p-lcd">
            <span className="marq">{item.artist ? `${item.artist} — ` : ''}{item.title}{item.album ? `  ★  ${item.album}` : ''}</span>
            <div className="row"><span>{formatDuration(time)}</span><span>{playing ? 'PLAY ▶' : 'PAUSE ‖'}</span><span>VOL {volume}</span></div>
          </div>
          <div className="p-tape">
            <div className="p-sticker">{item.album ?? item.title} · side A</div>
            <div className="p-window"><span className="p-reel" /><span className="p-reel" /></div>
          </div>
          <div className="p-keys" aria-hidden="true"><span /><span /><span /><span /></div>
        </div>
      )}
    </div>
  );
}

export function VideoView({ off }: { off: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const toggle = usePlayer((s) => s.toggle);

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    el.appendChild(media);
    media.controls = false;
    return () => {
      // Keep the element alive (and playing) when the player closes.
      if (media.parentElement === el) el.removeChild(media);
    };
  }, []);

  return <div ref={host} onClick={toggle} className="p-video p-view absolute inset-0" data-off={off || undefined} />;
}

export function LyricsView({ off }: { off: boolean }) {
  const lyrics = usePlayer((s) => s.lyrics);
  const state = usePlayer((s) => s.lyricsState);
  const seek = usePlayer((s) => s.seek);
  const container = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const synced = Boolean(lyrics?.synced);
  const active = usePlayer((s) => (lyrics?.synced ? activeLineIndex(lyrics.lines, s.time + 0.25) : -1));

  const lines = useMemo(() => lyrics?.lines ?? [], [lyrics]);

  useEffect(() => {
    if (off || !synced) return;
    const box = container.current;
    const list = inner.current;
    const el = list?.children[Math.max(0, active)] as HTMLElement | undefined;
    if (!box || !list || !el) return;
    list.style.transform = `translateY(${box.clientHeight * 0.4 - el.offsetTop - el.offsetHeight / 2}px)`;
  }, [active, off, synced, lines]);

  const body = (() => {
    if (state === 'loading' || state === 'idle') {
      return <p className="flex items-center gap-3 text-lg text-[var(--p-ink-3)]"><LoaderCircle className="size-5 animate-spin" /> Finding lyrics…</p>;
    }
    if (!lyrics) {
      return (
        <div className="text-center text-[var(--p-ink-3)]">
          <MicVocal className="mx-auto mb-3 size-8 opacity-60" />
          <p className="text-lg font-semibold text-[var(--p-ink-2)]">No lyrics for this song</p>
          <p className="mt-1 text-sm">Lumina checked the file, a matching .lrc file and online lyric sources.</p>
        </div>
      );
    }
    return null;
  })();

  return (
    <div className="p-view absolute inset-0 grid place-items-center" data-off={off || undefined}>
      {/* Lyrics recalled by a language model can be wrong or paraphrased — never present them as the real thing. */}
      {lyrics?.source === 'ai' && !body && (
        <p className="absolute top-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-[var(--p-ink-3)]">
          AI, unverified — these may be wrong
        </p>
      )}
      {body ?? (
        synced ? (
          <div ref={container} className="p-lyrics relative h-full w-[min(900px,100%)] overflow-hidden">
            <div ref={inner} className="p-lyrics-inner absolute inset-x-0 top-0">
              {lines.map((line, i) => {
                const d = Math.abs(i - active);
                const gap = !line.text || line.text === '♪';
                return (
                  <button
                    key={`${i}-${line.timeSec}`}
                    className="p-line"
                    data-active={i === active || undefined}
                    data-gap={gap || undefined}
                    onClick={() => seek(line.timeSec)}
                    style={{ filter: i === active ? 'none' : `blur(${Math.min(d * 0.9, 3)}px)`, opacity: d > 5 ? 0.3 : 1 }}
                  >
                    {gap ? '• • •' : line.text}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="h-full w-[min(760px,100%)] overflow-auto py-[10vh]">
            {lines.map((line, i) => <p key={i} className="p-line" data-plain>{line.text}</p>)}
            <p className="mt-6 text-sm text-[var(--p-ink-3)]">These lyrics aren’t time-synced.</p>
          </div>
        )
      )}
    </div>
  );
}
