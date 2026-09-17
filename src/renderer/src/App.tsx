import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { errorMessage } from '@/lib/bridge';
import { useApp, type View } from '@/stores/app';
import { useJobs } from '@/stores/jobs';
import { useLibrary } from '@/stores/library';
import { media, usePlayer } from '@/stores/player';
import { MiniBar, Sidebar, Toasts } from '@/components/Shell';
import { QuickCheck } from '@/components/QuickCheck';
import { DownloadView } from '@/views/download/DownloadView';
import { QueueView } from '@/views/queue/QueueView';
import { LibraryView } from '@/views/library/LibraryView';
import { SettingsView } from '@/views/settings/SettingsView';
import { AboutView } from '@/views/about/AboutView';
import { PlayerView } from '@/views/player/PlayerView';

function useAppearance() {
  const appearance = useApp((s) => s.settings?.appearance);
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (!appearance) return;
    const root = document.documentElement;
    const dark = appearance.colorMode === 'dark' || (appearance.colorMode === 'system' && systemDark);
    root.dataset.theme = dark ? 'dark' : 'light';
    root.dataset.accent = appearance.accent;
    root.dataset.density = appearance.density;
    root.style.setProperty('--ui-scale', appearance.uiScale);
    const reduced = appearance.reducedMotion === 'on' || (appearance.reducedMotion === 'system' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (reduced) root.dataset.motion = 'reduced';
    else delete root.dataset.motion;
  }, [appearance, systemDark]);
}

const VIEWS: Record<View, () => React.JSX.Element | null> = {
  download: DownloadView,
  queue: QueueView,
  library: LibraryView,
  settings: SettingsView,
  about: AboutView,
};

export function App() {
  const ready = useApp((s) => s.ready);
  const view = useApp((s) => s.view);
  const mode = useApp((s) => s.mode);
  const setView = useApp((s) => s.setView);
  const [failure, setFailure] = useState<string | null>(null);
  useAppearance();

  useEffect(() => {
    (async () => {
      await useApp.getState().init();
      await Promise.all([useJobs.getState().init(), useLibrary.getState().init()]);
      const player = useApp.getState().settings?.player;
      if (player) {
        media.volume = player.volume;
        usePlayer.setState({ volume: player.volume, stage: player.autoOpenLyrics ? 'lyrics' : 'art' });
      }
    })().catch((err) => setFailure(errorMessage(err)));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || useApp.getState().mode === 'player') return;
      const map: Record<string, View> = { '1': 'download', '2': 'queue', '3': 'library', ',': 'settings' };
      const target = map[e.key];
      if (target) {
        e.preventDefault();
        setView(target);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [setView]);

  if (failure) {
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <div>
          <p className="font-serif text-3xl">Lumina couldn’t start</p>
          <p className="mt-2 max-w-md text-sm text-ink-3" data-selectable>{failure}</p>
        </div>
      </div>
    );
  }

  if (!ready) {
    return <div className="drag grid h-full place-items-center"><LoaderCircle className="size-6 animate-spin text-ink-3" /></div>;
  }

  const Current = VIEWS[view];
  return (
    <>
      <div className="flex h-full flex-col" aria-hidden={mode === 'player' || undefined}>
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <main className="vt-page min-w-0 flex-1 bg-ground">
            <Current />
          </main>
        </div>
        <MiniBar />
      </div>
      {mode === 'player' && <PlayerView />}
      <QuickCheck />
      <Toasts />
    </>
  );
}
