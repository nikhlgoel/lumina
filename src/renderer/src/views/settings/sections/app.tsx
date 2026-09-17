import { useEffect, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { call } from '@/lib/bridge';
import { cn } from '@/lib/cn';
import { Segmented, Select, Switch } from '@/components/ui';
import { BrandMark } from '@/components/Shell';
import { Group, Row, ShortcutInput, type SectionProps } from '../controls';

export function GeneralSection({ s, set }: SectionProps) {
  const g = s.general;
  const [shortcut, setShortcut] = useState<{ ok: boolean; error: string | null } | null>(null);
  useEffect(() => {
    void call('app:shortcut-status').then(setShortcut);
  }, [g.globalShortcut, g.globalShortcutEnabled]);

  return (
    <>
      <Group title="Running in the background">
        <Row id="closeToTray" label="Keep running when the window is closed" description="Music and downloads continue. Open or quit Lumina from the tray icon.">
          <Switch label="Close to tray" checked={g.closeToTray} onChange={(v) => set({ general: { closeToTray: v } })} />
        </Row>
        <Row id="startWithSystem" label="Start with your computer" description="Lumina starts quietly in the tray when you sign in.">
          <Switch label="Start with system" checked={g.startWithSystem} onChange={(v) => set({ general: { startWithSystem: v } })} />
        </Row>
        <Row id="startMode" label="When Lumina opens, show">
          <Select label="Start mode" value={g.startMode} onChange={(v) => set({ general: { startMode: v } })} options={[
            { value: 'last', label: 'Where I left off' }, { value: 'downloader', label: 'Downloads' },
            { value: 'player', label: 'The player' }, { value: 'tray', label: 'Nothing (tray only)' },
          ]} />
        </Row>
        <Row id="resumeQueue" label="Resume unfinished downloads" description="Continue the queue automatically after a restart.">
          <Switch label="Resume queue" checked={g.resumeQueue} onChange={(v) => set({ general: { resumeQueue: v } })} />
        </Row>
        <Row id="confirmQuit" label="Ask before quitting during downloads">
          <Switch label="Confirm quit" checked={g.confirmQuitWithDownloads} onChange={(v) => set({ general: { confirmQuitWithDownloads: v } })} />
        </Row>
      </Group>

      <Group title="Quick downloading">
        <Row id="clipboard" label="Notice copied links" description="When you copy a link Lumina can download, it offers to grab it. Nothing is read until you copy something new.">
          <Switch label="Clipboard watcher" checked={g.clipboardWatcher} onChange={(v) => set({ general: { clipboardWatcher: v } })} />
        </Row>
        <Row id="shortcut" label="Download copied link from anywhere" description={
          shortcut && !shortcut.ok ? <span className="inline-flex items-center gap-1 text-warning"><TriangleAlert className="size-3.5" />{shortcut.error}</span> : 'Copy a link in any app, then press this shortcut.'
        }>
          <ShortcutInput value={g.globalShortcut} onCommit={(v) => set({ general: { globalShortcut: v } })} />
          <Switch label="Global shortcut" checked={g.globalShortcutEnabled} onChange={(v) => set({ general: { globalShortcutEnabled: v } })} />
        </Row>
      </Group>

      <Group title="Notifications">
        <Row id="notifyComplete" label="When a download finishes" description="Only shown when Lumina isn’t in front. Click it to open the file’s folder.">
          <Switch label="Notify on complete" checked={g.notifyOnComplete} onChange={(v) => set({ general: { notifyOnComplete: v } })} />
        </Row>
        <Row id="notifyFail" label="When a download fails">
          <Switch label="Notify on fail" checked={g.notifyOnFail} onChange={(v) => set({ general: { notifyOnFail: v } })} />
        </Row>
        <Row id="sound" label="Play a sound">
          <Switch label="Notification sound" checked={g.completionSound} onChange={(v) => set({ general: { completionSound: v } })} />
        </Row>
      </Group>

      <Group title="When all downloads finish">
        <Row id="whenFinished" label="Then" description={g.whenQueueFinishes === 'nothing' ? 'Handy for big overnight downloads. You’ll get 60 seconds to cancel.' : 'Turns itself off after it runs once.'}>
          <Segmented label="When queue finishes" value={g.whenQueueFinishes} onChange={(v) => set({ general: { whenQueueFinishes: v } })} options={[
            { value: 'nothing', label: 'Do nothing' }, { value: 'sleep', label: 'Sleep' }, { value: 'shutdown', label: 'Shut down' },
          ]} />
        </Row>
      </Group>
    </>
  );
}

const ACCENTS = { ember: '#e0762a', iris: '#6e6ee0', jade: '#23a574', sky: '#3990db', rose: '#dc5379' } as const;

export function AppearanceSection({ s, set }: SectionProps) {
  const a = s.appearance;
  return (
    <>
      <Group title="Theme">
        <div className="grid grid-cols-3 gap-3 py-4">
          {(['system', 'light', 'dark'] as const).map((mode) => (
            <button key={mode} onClick={() => set({ appearance: { colorMode: mode } })} aria-pressed={a.colorMode === mode}
              className={cn('group rounded-xl border p-2 text-left transition-[border-color,box-shadow,transform] active:scale-[0.99]', a.colorMode === mode ? 'border-accent shadow-[0_0_0_1px_var(--accent)]' : 'border-line hover:border-line-strong')}>
              <ThemeThumb mode={mode} accent={ACCENTS[a.accent]} />
              <span className="mt-2 block px-1 text-[13px] font-semibold capitalize">{mode === 'system' ? 'Match Windows' : mode}</span>
            </button>
          ))}
        </div>
        <Row id="accent" label="Accent color">
          <div className="flex gap-2" role="radiogroup" aria-label="Accent color">
            {(Object.keys(ACCENTS) as (keyof typeof ACCENTS)[]).map((k) => (
              <button key={k} role="radio" aria-checked={a.accent === k} aria-label={k} title={k[0]!.toUpperCase() + k.slice(1)} onClick={() => set({ appearance: { accent: k } })}
                className={cn('size-7 rounded-full ring-offset-2 ring-offset-panel transition-transform hover:scale-110 active:scale-95', a.accent === k && 'ring-2 ring-ink')}
                style={{ background: ACCENTS[k] }} />
            ))}
          </div>
        </Row>
      </Group>

      <Group title="Layout">
        <Row id="uiScale" label="Interface size">
          <Segmented label="Interface size" value={a.uiScale} onChange={(v) => set({ appearance: { uiScale: v } })} options={[
            { value: '0.9', label: 'Small' }, { value: '1', label: 'Default' }, { value: '1.1', label: 'Large' }, { value: '1.25', label: 'Larger' },
          ]} />
        </Row>
        <Row id="density" label="Density" description="Compact fits more downloads and songs on screen.">
          <Segmented label="Density" value={a.density} onChange={(v) => set({ appearance: { density: v } })} options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} />
        </Row>
        <Row id="sidebarStats" label="Show library counts in the sidebar">
          <Switch label="Sidebar stats" checked={a.showSidebarStats} onChange={(v) => set({ appearance: { showSidebarStats: v } })} />
        </Row>
        <Row id="motion" label="Reduce motion" description="Turns off page transitions and moving backgrounds.">
          <Segmented label="Reduce motion" value={a.reducedMotion} onChange={(v) => set({ appearance: { reducedMotion: v } })} options={[
            { value: 'system', label: 'Match Windows' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' },
          ]} />
        </Row>
      </Group>
    </>
  );
}

function ThemeThumb({ mode, accent }: { mode: 'system' | 'light' | 'dark'; accent: string }) {
  const half = (dark: boolean) => (
    <div className="flex h-full" style={{ background: dark ? '#0d0c0b' : '#f4f2ee' }}>
      <div className="w-[30%] border-r p-1.5" style={{ background: dark ? '#141312' : '#fbfaf8', borderColor: dark ? '#ffffff14' : '#28201418' }}>
        <div className="mb-1.5 size-2.5 rounded-[3px]" style={{ background: '#1E1813' }} />
        {[0, 1, 2].map((i) => <div key={i} className="mb-1 h-1.5 rounded-sm" style={{ background: i === 0 ? accent : dark ? '#ffffff1f' : '#2820141a', width: `${80 - i * 15}%` }} />)}
      </div>
      <div className="flex-1 p-2">
        <div className="mb-1.5 h-2 w-3/5 rounded-sm" style={{ background: dark ? '#f1ede6' : '#1b1813', opacity: 0.85 }} />
        <div className="h-3.5 rounded" style={{ background: dark ? '#1b1a18' : '#ffffff', boxShadow: `inset 0 0 0 1px ${dark ? '#ffffff14' : '#28201418'}` }} />
        <div className="mt-1.5 ml-auto h-2.5 w-1/3 rounded-sm" style={{ background: accent }} />
      </div>
    </div>
  );
  return (
    <div className="relative h-20 overflow-hidden rounded-lg ring-1 ring-line">
      {mode === 'system' ? (
        <div className="grid h-full grid-cols-2">
          <div className="overflow-hidden">{half(false)}</div>
          <div className="overflow-hidden">{half(true)}</div>
        </div>
      ) : half(mode === 'dark')}
    </div>
  );
}

export function PlayerSection({ s, set }: SectionProps) {
  const p = s.player;
  const themes = [
    { value: 'aurora' as const, name: 'Aurora', swatch: 'radial-gradient(circle at 30% 30%,#FF7A59,transparent 60%),radial-gradient(circle at 70% 70%,#1FC8B4,transparent 60%),#7B5CFF' },
    { value: 'vinyl' as const, name: 'Vinyl', swatch: 'repeating-radial-gradient(circle,#111 0 2px,#1d1d22 2px 3px)' },
    { value: 'pocket' as const, name: 'Pocket', swatch: 'linear-gradient(160deg,#EDE7DA,#CFC6B4)' },
  ];
  return (
    <>
      <Group title="Look">
        <div className="grid grid-cols-3 gap-3 py-4">
          {themes.map((t) => (
            <button key={t.value} onClick={() => set({ player: { theme: t.value } })} aria-pressed={p.theme === t.value}
              className={cn('rounded-xl border p-2 text-left transition-[border-color,box-shadow] active:scale-[0.99]', p.theme === t.value ? 'border-accent shadow-[0_0_0_1px_var(--accent)]' : 'border-line hover:border-line-strong')}>
              <span className="grid h-20 place-items-center rounded-lg" style={{ background: t.swatch }}>
                {t.value === 'aurora' && <BrandMark className="size-7 opacity-90" />}
              </span>
              <span className="mt-2 block px-1 text-[13px] font-semibold">{t.name}</span>
            </button>
          ))}
        </div>
        <Row id="effects" label="Background motion" description="Still keeps the colors from the artwork without any movement.">
          <Segmented label="Background motion" value={p.effects} onChange={(v) => set({ player: { effects: v } })} options={[{ value: 'balanced', label: 'Gentle' }, { value: 'still', label: 'Still' }]} />
        </Row>
        <Row id="hints" label="Show keyboard hints">
          <Switch label="Keyboard hints" checked={p.showKeyboardHints} onChange={(v) => set({ player: { showKeyboardHints: v } })} />
        </Row>
      </Group>
      <Group title="Playback">
        <Row id="openOnPlay" label="Open the full player when playing from the library" description="Off keeps you in the library with the mini player at the bottom.">
          <Switch label="Open player on play" checked={p.openPlayerOnPlay} onChange={(v) => set({ player: { openPlayerOnPlay: v } })} />
        </Row>
        <Row id="resume" label="Continue long videos where you left off" description="For anything longer than 10 minutes.">
          <Switch label="Resume position" checked={p.resumePosition} onChange={(v) => set({ player: { resumePosition: v } })} />
        </Row>
      </Group>
      <Group title="Lyrics">
        <Row id="autoLyrics" label="Open lyrics automatically"><Switch label="Auto lyrics" checked={p.autoOpenLyrics} onChange={(v) => set({ player: { autoOpenLyrics: v } })} /></Row>
        <Row id="lyricsSize" label="Lyrics size">
          <Segmented label="Lyrics size" value={p.lyricsSize} onChange={(v) => set({ player: { lyricsSize: v } })} options={[{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }]} />
        </Row>
      </Group>
    </>
  );
}
