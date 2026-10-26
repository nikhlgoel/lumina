import { applyTrackGain, applyVolumeBoost } from '@/lib/audio';
import { create } from 'zustand';
import type { Lyrics, PlayableItem } from '@shared/types';
import { call, errorMessage, on } from '@/lib/bridge';
import { useApp } from './app';
import { useLibrary } from './library';
import { nextVolume } from '@core/trayMenu';
import { clampVolume, volumeSplit } from '@core/volume';
import { clampSpeed } from '@core/playbackSpeed';
import { createShuffle, shuffleMatches, stepShuffle, syncShuffle, type ShuffleState } from '@core/shuffle';

export type Repeat = 'off' | 'all' | 'one';
export type StageView = 'art' | 'lyrics';

interface PlayerState {
  queue: PlayableItem[];
  index: number;
  playing: boolean;
  buffering: boolean;
  time: number;
  duration: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: Repeat;
  stage: StageView;
  subtitles: boolean;
  /** Playback speed, kept across tracks the way YouTube keeps it across videos. */
  rate: number;
  lyrics: Lyrics | null;
  lyricsState: 'idle' | 'loading' | 'ready' | 'missing';
  current: () => PlayableItem | null;
  setRate: (rate: number) => void;
  playQueue: (items: PlayableItem[], startIndex?: number) => void;
  playIds: (ids: string[], startIndex?: number) => Promise<void>;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  jump: (index: number) => void;
  seek: (seconds: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setStage: (v: StageView) => void;
  toggleSubtitles: () => void;
  toggleLike: () => Promise<void>;
}

/** The single media element used by the whole app. Video elements also play audio-only files. */
export const media: HTMLVideoElement = document.createElement('video');
media.preload = 'auto';
media.crossOrigin = 'anonymous';
media.playsInline = true;

// When Chromium can't decode a file, it is streamed through ffmpeg; seeking then restarts the stream at an offset.
let remuxOffset = 0;
let usingRemux = false;
/** Whether the current file is being converted live by ffmpeg (shown in the stats panel). */
export const isRemuxing = () => usingRemux;
let lyricsToken = 0;
let artworkBlobUrl: string | null = null;

const clampIndex = (i: number, n: number) => (n === 0 ? 0 : ((i % n) + n) % n);

/** Which track a loudness answer belongs to, so a slow measurement cannot land on a later song. */
let loudnessFor: string | null = null;

/** The shuffled order and where we are in it, or null when shuffle is off. See D16. */
let shuffleState: ShuffleState | null = null;

function applyLoudness(item: PlayableItem) {
  const key = item.path ?? item.src;
  loudnessFor = key;
  if (!useApp.getState().settings?.player.normalizeLoudness || !item.path) {
    applyTrackGain(1);
    return;
  }
  void call('player:loudness', { path: item.path })
    .then((answer) => { if (loudnessFor === key) applyTrackGain(answer.gainLinear); })
    .catch(() => { if (loudnessFor === key) applyTrackGain(1); });
}
export const usePlayer = create<PlayerState>((set, get) => {
  const load = (index: number, autoplay: boolean) => {
    const { queue } = get();
    const item = queue[index];
    if (!item) return;
    // A link that can only be played through ffmpeg already points at it; seeking then restarts that pipe.
    usingRemux = Boolean(item.pipe);
    remuxOffset = 0;
    // Assigning a new src runs the load algorithm, which resets playbackRate to defaultPlaybackRate
    // — so a chosen speed would silently snap back to 1x on every track unless the default carries it.
    media.defaultPlaybackRate = get().rate;
    media.src = item.src;
    for (const t of Array.from(media.querySelectorAll('track'))) t.remove();
    if (item.kind === 'video') {
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.label = 'English';
      track.srclang = 'en';
      track.src = `lumina-media://subs/${item.id}`;
      track.addEventListener('load', () => {
        track.track.mode = get().subtitles ? 'showing' : 'hidden';
        // Top-positioned subtitles (Settings › Subtitles) are placed per cue.
        if (useApp.getState().settings?.subtitles.style.position === 'top') {
          for (const cue of Array.from(track.track.cues ?? []) as VTTCue[]) cue.line = 0;
        }
      });
      media.appendChild(track);
    }
    media.load();
    // Match this track's level to everything else, and stop a clipping master from distorting.
    // Deliberately not awaited: the first measurement of a file needs a decode, and playback must
    // not wait on it. Until the answer arrives the track plays at its own level, as it always did.
    applyLoudness(item);
    set({ index, time: 0, duration: item.durationSec ?? 0, buffering: true, lyrics: null, lyricsState: 'idle' });
    if (item.resumeAtSec) {
      const at = item.resumeAtSec;
      media.addEventListener('loadedmetadata', () => {
        if (get().current()?.id !== item.id) return;
        media.currentTime = at;
        useApp.getState().toast(`Continuing from ${Math.floor(at / 60)}:${String(Math.floor(at % 60)).padStart(2, '0')}`, 'info', {
          label: 'Start over', run: () => get().seek(0),
        });
      }, { once: true });
    }
    if (autoplay) void media.play().catch(() => undefined);
    updateSession(item);
    void fetchLyrics(item);
  };

  const fetchLyrics = async (item: PlayableItem) => {
    if (item.kind !== 'audio') return;
    const token = ++lyricsToken;
    set({ lyricsState: 'loading' });
    try {
      const lyrics = await call('lyrics:get', { title: item.title, artist: item.artist, durationSec: item.durationSec, path: item.path });
      if (token !== lyricsToken) return;
      set({ lyrics, lyricsState: lyrics ? 'ready' : 'missing' });
    } catch {
      if (token === lyricsToken) set({ lyricsState: 'missing' });
    }
  };

  const updateSession = (item: PlayableItem) => {
    if (!('mediaSession' in navigator)) return;
    const metadata = { title: item.title, artist: item.artist ?? '', album: item.album ?? '' };
    navigator.mediaSession.metadata = new MediaMetadata(metadata);
    if (!item.artworkUrl) return;
    // OS media controls only accept http/data/blob artwork, so hand them a blob copy.
    void fetch(item.artworkUrl)
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (!blob || get().current()?.id !== item.id) return;
        if (artworkBlobUrl) URL.revokeObjectURL(artworkBlobUrl);
        artworkBlobUrl = URL.createObjectURL(blob);
        navigator.mediaSession.metadata = new MediaMetadata({ ...metadata, artwork: [{ src: artworkBlobUrl, sizes: '512x512', type: blob.type }] });
      })
      .catch(() => undefined);
  };

  const reportState = () => reportPlayback(get());

  const advance = (step: 1 | -1, fromEnded: boolean) => {
    const { queue, index, shuffle, repeat } = get();
    if (!queue.length) return;
    if (fromEnded && repeat === 'one') {
      get().seek(0);
      void media.play();
      return;
    }
    const autoplay = fromEnded || get().playing;

    if (shuffle && queue.length > 1) {
      // Rebuilt lazily, so a queue that changed underneath cannot hand out an index it no longer has.
      if (!shuffleState || !shuffleMatches(shuffleState, queue.length)) shuffleState = createShuffle(queue.length, index);
      const moved = stepShuffle(shuffleState, step, { allowWrap: repeat !== 'off' || !fromEnded });
      // Nowhere to go: the end of the order with repeat off, or back past the first track played.
      if (!moved) {
        if (fromEnded) set({ playing: false });
        return;
      }
      shuffleState = moved.state;
      load(moved.index, autoplay);
      return;
    }

    let nextIndex = index + step;
    if (nextIndex >= queue.length || nextIndex < 0) {
      if (repeat === 'off' && fromEnded) {
        set({ playing: false });
        return;
      }
      nextIndex = clampIndex(nextIndex, queue.length);
    }
    load(nextIndex, autoplay);
  };

  /** Remember where long media was left, so it can continue next time. */
  let lastSaved = 0;
  const savePosition = (force = false) => {
    const item = get().current();
    if (!item?.durationSec || item.durationSec < 600) return;
    const now = Date.now();
    if (!force && now - lastSaved < 5000) return;
    lastSaved = now;
    void call('player:save-position', { id: item.id, positionSec: get().time }).catch(() => undefined);
  };

  media.addEventListener('play', () => { set({ playing: true }); reportState(); });
  media.addEventListener('pause', () => { set({ playing: false }); reportState(); savePosition(true); });
  media.addEventListener('timeupdate', () => savePosition());
  media.addEventListener('waiting', () => set({ buffering: true }));
  media.addEventListener('playing', () => set({ buffering: false }));
  media.addEventListener('canplay', () => set({ buffering: false }));
  media.addEventListener('timeupdate', () => set({ time: remuxOffset + media.currentTime }));
  media.addEventListener('durationchange', () => {
    if (!usingRemux && Number.isFinite(media.duration)) set({ duration: media.duration });
  });
  media.addEventListener('ended', () => advance(1, true));
  media.addEventListener('error', () => {
    const item = get().current();
    if (!item) return;
    if (!usingRemux) {
      // Unsupported codec or container: stream it through ffmpeg instead.
      usingRemux = true;
      remuxOffset = 0;
      media.src = `lumina-media://remux/${item.id}?t=0`;
      void media.play().catch(() => undefined);
      return;
    }
    set({ playing: false, buffering: false });
    useApp.getState().toast(`Can’t play “${item.title}”.`, 'error');
  });

  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => void media.play());
    navigator.mediaSession.setActionHandler('pause', () => media.pause());
    navigator.mediaSession.setActionHandler('nexttrack', () => advance(1, false));
    navigator.mediaSession.setActionHandler('previoustrack', () => get().previous());
    navigator.mediaSession.setActionHandler('seekto', (d) => d.seekTime != null && get().seek(d.seekTime));
  }

  // Commands from the tray (and anything else in main). Every branch reuses the same action the
  // in-app controls use, so the tray can never put the player in a state the UI couldn't.
  on('player:command', (cmd) => {
    const p = get();
    switch (cmd.command) {
      case 'toggle': p.toggle(); break;
      case 'next': p.next(); break;
      case 'previous': p.previous(); break;
      case 'seek-by': if (p.current()) p.seek(Math.max(0, p.time + cmd.value)); break;
      case 'mute': p.toggleMute(); break;
      case 'volume': p.setVolume(cmd.value); break;
      case 'volume-by': p.setVolume(nextVolume(p.volume, cmd.value)); break;
      case 'shuffle': p.toggleShuffle(); break;
      case 'repeat': set({ repeat: cmd.mode }); break;
    }
  });

  const settingsVolume = clampVolume(useApp.getState().settings?.player.volume ?? 0.8);
  // The saved volume goes through the same split, or a stored 150% would quietly start at 100%.
  const startSplit = volumeSplit(settingsVolume);
  media.volume = startSplit.elementVolume;
  if (startSplit.boostGain !== 1) applyVolumeBoost(startSplit.boostGain);

  return {
    queue: [],
    index: 0,
    playing: false,
    buffering: false,
    time: 0,
    duration: 0,
    volume: settingsVolume,
    muted: false,
    shuffle: false,
    repeat: 'off',
    stage: useApp.getState().settings?.player.autoOpenLyrics ? 'lyrics' : 'art',
    subtitles: false,
    rate: 1,
    lyrics: null,
    lyricsState: 'idle',

    current: () => get().queue[get().index] ?? null,

    setRate: (value) => {
      const rate = clampSpeed(value);
      media.defaultPlaybackRate = rate;
      media.playbackRate = rate;
      // Speed without a chipmunk: keep the pitch where it was. Chromium defaults to true; said
      // outright so a future default change cannot quietly turn 2x into a squeak.
      media.preservesPitch = true;
      set({ rate });
    },

    playQueue: (items, startIndex = 0) => {
      if (!items.length) return;
      const start = clampIndex(startIndex, items.length);
      set({ queue: items });
      shuffleState = get().shuffle ? createShuffle(items.length, start) : null;
      load(start, true);
    },

    playIds: async (ids, startIndex = 0) => {
      try {
        const items = await call('player:resolve', { ids });
        if (!items.length) {
          useApp.getState().toast('Those files are no longer available.', 'error');
          return;
        }
        get().playQueue(items, Math.min(startIndex, items.length - 1));
      } catch (err) {
        useApp.getState().toast(errorMessage(err), 'error');
      }
    },

    toggle: () => {
      if (!get().current()) return;
      if (media.paused) void media.play().catch(() => undefined);
      else media.pause();
    },

    next: () => advance(1, false),

    previous: () => {
      if (get().time > 3) get().seek(0);
      else advance(-1, false);
    },

    jump: (index) => {
      const target = clampIndex(index, get().queue.length);
      // Carry on from what was chosen, rather than from wherever the shuffle had got to.
      if (shuffleState) shuffleState = syncShuffle(shuffleState, target);
      load(target, true);
    },

    seek: (seconds) => {
      const item = get().current();
      if (!item) return;
      const target = Math.max(0, Math.min(seconds, get().duration || seconds));
      if (usingRemux) {
        const wasPlaying = !media.paused;
        remuxOffset = target;
        media.src = `lumina-media://remux/${item.id}?t=${Math.floor(target)}`;
        if (wasPlaying) void media.play().catch(() => undefined);
      } else {
        media.currentTime = target;
      }
      set({ time: target });
    },

    setVolume: (v) => {
      const volume = clampVolume(v);
      // Up to 100% this is the element alone; past it the element sits at unity and the graph makes
      // up the rest, with a limiter so the extra gain cannot clip. See D18.
      const { elementVolume, boostGain } = volumeSplit(volume);
      media.volume = elementVolume;
      media.muted = false;
      applyVolumeBoost(boostGain);
      set({ volume, muted: false });
    },

    toggleMute: () => {
      media.muted = !media.muted;
      set({ muted: media.muted });
    },

    toggleShuffle: () => {
      const { shuffle, queue, index } = get();
      const next = !shuffle;
      // Deal the order now, with whatever is playing first, so turning shuffle on does not interrupt it.
      shuffleState = next ? createShuffle(queue.length, index) : null;
      set({ shuffle: next });
    },
    cycleRepeat: () => set((s) => ({ repeat: s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off' })),
    setStage: (stage) => set({ stage }),

    /**
     * Like the song that is playing.
     *
     * Liking used to be reachable only from the Library, which is the wrong moment - the time you
     * decide you love a song is while it is playing. The queue is updated in place so the heart is
     * right immediately, and the library store is told so its lists agree.
     */
    toggleLike: async () => {
      const item = get().current();
      if (!item?.path) return;
      const liked = !item.liked;
      try {
        await call('library:like', { path: item.path, liked });
      } catch (err) {
        useApp.getState().toast(errorMessage(err), 'error');
        return;
      }
      set((s) => ({ queue: s.queue.map((i) => (i.id === item.id ? { ...i, liked } : i)) }));
      void useLibrary.getState().refreshLiked(item.id, liked);
    },

    toggleSubtitles: () => {
      const on = !get().subtitles;
      for (const track of Array.from(media.textTracks)) track.mode = on ? 'showing' : 'hidden';
      set({ subtitles: on });
    },
  };
});

/**
 * Tell the main process what the tray should show. Called on play/pause/track change, and whenever
 * volume, mute, shuffle or repeat change — from the tray or from the app — so its ticks never lie.
 */
function reportPlayback(s: PlayerState) {
  const item = s.current();
  void call('player:state', {
    playing: s.playing,
    title: item?.title ?? null,
    artist: item?.artist ?? null,
    volume: s.volume,
    muted: s.muted,
    shuffle: s.shuffle,
    repeat: s.repeat,
  }).catch(() => undefined);
}

// Dragging the volume slider changes volume dozens of times a second; the tray only needs the value
// the drag settles on, so these reports are debounced rather than sent per pixel.
let settingsReportTimer: ReturnType<typeof setTimeout> | null = null;
usePlayer.subscribe((s, prev) => {
  if (s.volume === prev.volume && s.muted === prev.muted && s.shuffle === prev.shuffle && s.repeat === prev.repeat) return;
  if (settingsReportTimer) clearTimeout(settingsReportTimer);
  settingsReportTimer = setTimeout(() => reportPlayback(usePlayer.getState()), 250);
});

/**
 * Apply a saved volume to the element, the graph and the store.
 *
 * One function because there were two: the store set it up at creation and App.tsx set it again
 * after settings loaded, and when volume gained a range above 1 only one of them was taught the
 * split. The element throws on anything above 1, the throw was caught as a startup failure, and the
 * app refused to launch with the message 'Lumina couldn’t start'. See D18.
 */
export function applyStoredVolume(volume: number) {
  const v = clampVolume(volume);
  const { elementVolume, boostGain } = volumeSplit(v);
  media.volume = elementVolume;
  applyVolumeBoost(boostGain);
  usePlayer.setState({ volume: v });
}

/**
 * Make the loudness switch audible the moment it is flipped.
 *
 * `applyLoudness` otherwise runs only when a track loads, so turning "match the volume of every
 * track" on or off did nothing at all until the next song — and a switch that appears to do nothing
 * is indistinguishable from a switch that was never wired up.
 */
let lastLoudnessSettings = useApp.getState().settings?.player ?? null;
useApp.subscribe((s) => {
  const player = s.settings?.player;
  if (!player || player === lastLoudnessSettings) return;
  const changed = !lastLoudnessSettings
    || player.normalizeLoudness !== lastLoudnessSettings.normalizeLoudness
    || player.loudnessTarget !== lastLoudnessSettings.loudnessTarget;
  lastLoudnessSettings = player;
  if (!changed) return;
  const item = usePlayer.getState().current();
  if (item) applyLoudness(item);
});

/** Persist volume changes, debounced. */
let volumeTimer: ReturnType<typeof setTimeout> | null = null;
usePlayer.subscribe((s, prev) => {
  if (s.volume === prev.volume) return;
  if (volumeTimer) clearTimeout(volumeTimer);
  volumeTimer = setTimeout(() => void useApp.getState().updateSettings({ player: { volume: s.volume } }), 600);
});
