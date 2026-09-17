import { useEffect, useState } from 'react';
import { CircleCheck, CircleX, Download, FileText, FolderOpen, RefreshCw, RotateCcw, Upload } from 'lucide-react';
import type { DiskUsage } from '@shared/ipc';
import { parseExtraArgs } from '@shared/settings';
import { formatBytes } from '@core/format';
import { call, errorMessage } from '@/lib/bridge';
import { cn } from '@/lib/cn';
import { useApp } from '@/stores/app';
import { Badge, Button, Dialog, Segmented, Switch } from '@/components/ui';
import { FolderRow, Group, NumberInput, Row, TextInput, type SectionProps } from '../controls';

export function StorageSection({ s, set }: SectionProps) {
  const st = s.storage;
  const [usage, setUsage] = useState<DiskUsage[] | null>(null);
  useEffect(() => {
    void call('storage:usage').then(setUsage);
  }, [st.musicDir, st.videoDir, st.otherDir]);

  // One bar per drive, not per folder.
  const drives = usage ? [...new Map(usage.filter((u) => u.totalBytes).map((u) => [`${u.totalBytes}-${u.freeBytes}`, u])).values()] : [];

  return (
    <>
      {drives.length > 0 && (
        <Group title="Space">
          {drives.map((d) => {
            const used = 1 - (d.freeBytes ?? 0) / (d.totalBytes ?? 1);
            return (
              <Row key={d.path} label={d.path.match(/^[A-Za-z]:\\/)?.[0] ?? d.path.split('/').slice(0, 3).join('/') ?? d.label} description={`${formatBytes(d.freeBytes)} free of ${formatBytes(d.totalBytes)}`}>
                <div className="h-2 w-48 overflow-hidden rounded-full bg-sunken" role="meter" aria-valuenow={Math.round(used * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Disk used">
                  <div className={cn('h-full rounded-full transition-[width] duration-700', used > 0.92 ? 'bg-danger' : used > 0.8 ? 'bg-warning' : 'bg-accent')} style={{ width: `${Math.round(used * 100)}%` }} />
                </div>
              </Row>
            );
          })}
        </Group>
      )}

      <Group title="Where downloads go">
        <FolderRow id="musicDir" label="Music" value={st.musicDir} onPick={(d) => set({ storage: { musicDir: d } })} />
        <FolderRow id="videoDir" label="Videos" value={st.videoDir} onPick={(d) => set({ storage: { videoDir: d } })} />
        <FolderRow id="seriesDir" label="Series" value={st.seriesDir} onPick={(d) => set({ storage: { seriesDir: d } })} />
        <FolderRow id="otherDir" label="Files and torrents" value={st.otherDir} onPick={(d) => set({ storage: { otherDir: d } })} />
        <FolderRow id="tempDir" label="Work-in-progress folder" value={st.tempDir || 'System temp folder'} description="Pick a fast drive with space for large videos while they’re being merged." onPick={(d) => set({ storage: { tempDir: d } })} />
      </Group>

      <Group title="Library" description="Lumina also plays and organizes what’s already on your computer.">
        {st.libraryRoots.map((root) => (
          <Row key={root} label={root.split(/[\\/]/).filter(Boolean).pop() || root} description={<span data-selectable>{root}</span>}>
            <Button size="sm" variant="danger" onClick={() => set({ storage: { libraryRoots: st.libraryRoots.filter((r) => r !== root) } })}>Remove</Button>
          </Row>
        ))}
        <Row id="addLibrary" label="Add a folder">
          <Button size="sm" icon={<FolderOpen className="size-3.5" />} onClick={async () => {
            const d = await call('dialog:pick-folder', { title: 'Add a library folder' });
            if (d && !st.libraryRoots.includes(d)) await set({ storage: { libraryRoots: [...st.libraryRoots, d] } });
          }}>Choose folder</Button>
        </Row>
        <Row id="watch" label="Watch folders for changes" description="New files show up without a manual rescan.">
          <Switch label="Watch folders" checked={s.library.watchFolders} onChange={(v) => set({ library: { watchFolders: v } })} />
        </Row>
        <Row id="minAudio" label="Hide sounds shorter than" description="Keeps notification sounds and voice clips out of your songs.">
          <NumberInput value={s.library.minAudioSeconds} min={0} max={600} suffix="seconds" onCommit={(v) => set({ library: { minAudioSeconds: v } })} />
        </Row>
      </Group>
    </>
  );
}

export function PrivacySection({ s, set }: SectionProps) {
  const toast = useApp((x) => x.toast);
  const [sizes, setSizes] = useState<{ artworkBytes: number; lyricsEntries: number } | null>(null);
  const refresh = () => void call('cache:sizes').then(setSizes);
  useEffect(refresh, []);

  return (
    <>
      <Group title="History">
        <Row id="keepHistory" label="Keep a list of finished downloads" description="Off clears finished downloads the next time Lumina starts. Your files are never touched.">
          <Switch label="Keep history" checked={s.privacy.keepHistory} onChange={(v) => set({ privacy: { keepHistory: v } })} />
        </Row>
        {s.privacy.keepHistory && (
          <Row id="historyDays" label="Forget finished downloads after" description="0 keeps them until you clear the list.">
            <NumberInput value={s.privacy.historyDays} min={0} suffix="days" onCommit={(v) => set({ privacy: { historyDays: v } })} />
          </Row>
        )}
      </Group>

      <Group title="Stored on this computer">
        <Row id="artworkCache" label="Artwork and thumbnails" description={sizes ? formatBytes(sizes.artworkBytes) : '…'}>
          <Button size="sm" variant="ghost" onClick={async () => { await call('cache:clear', { what: 'artwork' }); refresh(); toast('Artwork cache cleared'); }}>Clear</Button>
        </Row>
        <Row id="lyricsCache" label="Saved lyrics" description={sizes ? `${sizes.lyricsEntries.toLocaleString()} songs` : '…'}>
          <Button size="sm" variant="ghost" onClick={async () => { await call('cache:clear', { what: 'lyrics' }); refresh(); toast('Lyrics cache cleared'); }}>Clear</Button>
        </Row>
      </Group>

      <Group title="What Lumina connects to" description="No accounts, analytics or tracking. Lumina only contacts:">
        {[
          ['The sites you download from', 'Plus YouTube Music search to match Spotify songs.'],
          ['lrclib.net and lyrics.ovh', 'To find lyrics for the song that’s playing or being downloaded.'],
          ['GitHub', 'To update yt-dlp and fetch a public torrent tracker list, if those are on.'],
          ['SponsorBlock', 'Only when sponsor segment handling is on.'],
        ].map(([title, detail]) => <Row key={title} label={title} description={detail} />)}
      </Group>
    </>
  );
}

export function AdvancedSection({ s, set }: SectionProps) {
  const tools = useApp((x) => x.tools);
  const toast = useApp((x) => x.toast);
  const info = useApp((x) => x.info);
  const [updating, setUpdating] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  const updateYtdlp = async () => {
    setUpdating(true);
    try {
      const st = await call('tools:update-ytdlp');
      toast(`yt-dlp is now ${st.version}`, 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setUpdating(false);
    }
  };

  const lastCheck = s.updates.lastYtdlpCheck ? new Date(s.updates.lastYtdlpCheck).toLocaleDateString() : 'never';

  return (
    <>
      <Group title="Download engines" action={<Badge>Lumina {info?.version}</Badge>}>
        {tools.map((t) => (
          <Row key={t.name} label={<span className="flex items-center gap-2">{t.ok ? <CircleCheck className="size-4 text-success" /> : <CircleX className="size-4 text-danger" />}{t.name}</span>}
            description={t.ok ? <span data-selectable>{t.version} · {t.source === 'bundled' ? 'included with Lumina' : t.source}</span> : <span className="text-danger">{t.error ?? 'Missing'}</span>}>
            {t.name === 'yt-dlp' && <Button size="sm" loading={updating} icon={<RefreshCw className="size-3.5" />} onClick={updateYtdlp}>Update now</Button>}
          </Row>
        ))}
      </Group>

      <Group title="Updates" description="Sites change often. Keeping yt-dlp current is the single biggest fix for downloads that stop working.">
        <Row id="autoUpdate" label="Update yt-dlp automatically" description={`Checked weekly, verified before use. Last updated: ${lastCheck}.`}>
          <Switch label="Auto update yt-dlp" checked={s.updates.autoUpdateYtdlp} onChange={(v) => set({ updates: { autoUpdateYtdlp: v } })} />
        </Row>
        <Row id="channel" label="Release channel" description="Nightly gets site fixes days earlier, with a little more risk.">
          <Segmented label="yt-dlp channel" value={s.updates.ytdlpChannel} onChange={(v) => set({ updates: { ytdlpChannel: v } })} options={[{ value: 'stable', label: 'Stable' }, { value: 'nightly', label: 'Nightly' }]} />
        </Row>
      </Group>

      <Group title="For power users">
        <Row id="extraArgs" label="Extra yt-dlp options" description="Added to every download. Options that run programs or change file locations are blocked." stacked>
          <TextInput mono width="w-full min-w-[420px]" placeholder="--geo-bypass --no-mtime" value={s.advanced.extraYtdlpArgs}
            validate={(v) => parseExtraArgs(v).error} onCommit={(v) => set({ advanced: { extraYtdlpArgs: v } })} />
        </Row>
        <Row id="verbose" label="Detailed logs" description="Record more detail to help track down problems.">
          <Switch label="Verbose logs" checked={s.advanced.verboseLogs} onChange={(v) => set({ advanced: { verboseLogs: v } })} />
          <Button size="sm" variant="ghost" icon={<FileText className="size-3.5" />} onClick={() => void call('app:open-logs')}>Open logs</Button>
        </Row>
      </Group>

      <Group title="Your settings">
        <Row id="export" label="Back up or move your settings" description="Accounts and connected browsers aren’t included.">
          <Button size="sm" icon={<Download className="size-3.5" />} onClick={async () => { const f = await call('settings:export'); if (f) toast('Settings exported', 'success'); }}>Export</Button>
          <Button size="sm" icon={<Upload className="size-3.5" />} onClick={async () => {
            try {
              if (await call('settings:import')) toast('Settings imported', 'success');
            } catch (err) {
              toast(errorMessage(err), 'error');
            }
          }}>Import</Button>
        </Row>
        <Row id="reset" label="Reset all settings" description="Your download folders, library, accounts and history are kept.">
          <Button size="sm" variant="danger" icon={<RotateCcw className="size-3.5" />} onClick={() => setResetOpen(true)}>Reset</Button>
        </Row>
      </Group>

      <Dialog open={resetOpen} onClose={() => setResetOpen(false)} title="Reset all settings?" width={440} footer={
        <>
          <Button variant="ghost" onClick={() => setResetOpen(false)}>Cancel</Button>
          <Button variant="primary" onClick={async () => { await call('settings:reset', {}); setResetOpen(false); toast('Settings reset'); }}>Reset settings</Button>
        </>
      }>
        <p className="text-sm leading-relaxed text-ink-2">Every option goes back to how Lumina ships. Folders, your library, sign-ins and download history stay as they are.</p>
      </Dialog>
    </>
  );
}
