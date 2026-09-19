// Portable drive: detect a USB stick, give it the LuminaMedia layout, and move media both ways.
// The drive is written as plain files in plain folders, so it plays on anything — not just Lumina.
import { useEffect, useState } from 'react';
import { HardDriveDownload, HardDriveUpload, PackageOpen, RefreshCw, Usb } from 'lucide-react';
import type { PortableDrive, PortableInstallStatus, PortableTransfer } from '@shared/types';
import { formatBytes, plural } from '@core/format';
import { call, errorMessage, on } from '@/lib/bridge';
import { cn } from '@/lib/cn';
import { useApp } from '@/stores/app';
import { Badge, Button, EmptyState, ProgressBar, Select, Switch } from '@/components/ui';
import { Group, Row, type SectionProps } from '../controls';

/** Mirrors describeInstallState in @core/portableInstall, using what the status actually reports. */
function describeState(p: PortableInstallStatus): string {
  if (p.state === 'current') return 'This drive already has the version you’re running.';
  if (p.state === 'outdated') {
    return `This drive has ${p.versionOnDrive ?? 'an older version'}. Updating replaces the program files and leaves the drive’s library alone.`;
  }
  if (p.state === 'unknown') return 'There’s a Lumina folder here with no version file. Copying will overwrite the program files.';
  return 'Copies the program onto the drive so you can plug it into any Windows PC and run Lumina straight from there — settings and library included, and nothing left behind on that PC.';
}

export function PortableSection({ s, set }: SectionProps) {
  const toast = useApp((a) => a.toast);
  const [drives, setDrives] = useState<PortableDrive[] | null>(null);
  const [transfer, setTransfer] = useState<PortableTransfer | null>(null);
  const [busy, setBusy] = useState(false);
  const [portable, setPortable] = useState<PortableInstallStatus | null>(null);

  const refresh = () => void call('usb:drives').then(setDrives).catch(() => setDrives([]));

  /** Whether a copy of Lumina is already on this drive — re-read whenever the drive changes. */
  const refreshPortable = (root: string) =>
    void call('usb:portable-status', { root }).then(setPortable).catch(() => setPortable(null));

  useEffect(() => {
    refresh();
    const offDrives = on('usb:drives-changed', setDrives);
    const offTransfer = on('usb:transfer', setTransfer);
    return () => { offDrives(); offTransfer(); };
  }, []);

  const selected = drives?.find((d) => d.root === s.storage.usbDrive) ?? drives?.[0] ?? null;

  useEffect(() => {
    if (selected?.root) refreshPortable(selected.root);
    else setPortable(null);
  }, [selected?.root]);

  const act = async (label: string, fn: () => Promise<PortableTransfer | unknown>) => {
    setBusy(true);
    try {
      const result = await fn();
      const t = result as PortableTransfer;
      if (t && typeof t === 'object' && 'done' in t) {
        setTransfer(t);
        if (t.error) toast(t.error, 'error');
        else toast(`${label}: ${plural(t.files, 'file')}${t.skipped ? `, ${t.skipped} already there` : ''}`, 'success');
      }
      refresh();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Group
        title="Portable drive"
        description="Copy your library onto a USB stick as ordinary files — Music/Artist/Album, Videos, and .m3u8 playlists — so it plays in any car stereo, TV or phone, not just in Lumina."
        action={<Button variant="ghost" size="sm" icon={<RefreshCw className="size-3.5" />} onClick={refresh}>Rescan</Button>}
      >
        {drives == null ? (
          <p className="px-1 py-2 text-[13px] text-ink-3">Looking for drives…</p>
        ) : drives.length === 0 ? (
          <div className="py-2">
            <EmptyState icon={<Usb />} title="No removable drive connected">
              Plug in a USB stick or memory card and it appears here within a few seconds.
            </EmptyState>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line">
            {drives.map((d) => {
              const used = d.totalBytes > 0 ? ((d.totalBytes - d.freeBytes) / d.totalBytes) * 100 : 0;
              const active = selected?.root === d.root;
              return (
                <button
                  key={d.root}
                  onClick={() => set({ storage: { usbDrive: d.root } })}
                  className={cn('flex w-full items-center gap-3 border-b border-line px-3 py-2.5 text-left last:border-b-0 transition-colors hover:bg-hover',
                    active && 'bg-accent-soft')}
                >
                  <Usb className={cn('size-5 shrink-0', active ? 'text-accent' : 'text-ink-3')} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{d.label}</span>
                    <span className="block truncate text-[13px] text-ink-3">
                      {d.root} · {formatBytes(d.freeBytes)} free of {formatBytes(d.totalBytes)}
                      {d.ready ? ' · set up for Lumina' : ' · not set up yet'}
                    </span>
                    <ProgressBar className="mt-1.5" value={used} tone={used > 92 ? 'danger' : 'muted'} />
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {selected && (
          <>
            <Row id="usbPrepare" label="Set up this drive" description="Creates LuminaMedia/Music, Videos, Playlists and Files, plus a README explaining the layout.">
              <Button variant={selected.ready ? 'ghost' : 'primary'} size="sm" disabled={busy}
                onClick={() => void act('Drive set up', () => call('usb:prepare', { root: selected.root }))}>
                {selected.ready ? 'Repair folders' : 'Set up'}
              </Button>
            </Row>
            <Row
              id="usbPortableApp"
              label="Put Lumina itself on the drive"
              description={
                portable
                  ? portable.reason ?? describeState(portable)
                  : 'Copies the program onto the drive so you can plug it into any Windows PC and run Lumina straight from there — settings and library included, and nothing left behind on that PC.'
              }
            >
              <div className="flex items-center gap-2">
                {portable && portable.state !== 'absent' && (
                  <Badge tone={portable.state === 'current' ? 'success' : 'warning'}>
                    {portable.state === 'current' ? 'Up to date' : portable.state === 'outdated' ? 'Older copy' : 'Unrecognised'}
                  </Badge>
                )}
                <Button
                  variant={portable?.state === 'current' ? 'ghost' : 'primary'}
                  size="sm"
                  disabled={busy || !portable?.canInstall}
                  icon={<PackageOpen className="size-4" />}
                  onClick={() => void act('Lumina copied to the drive', async () => {
                    const r = await call('usb:install-portable', { root: selected.root });
                    void refreshPortable(selected.root);
                    return r;
                  })}
                >
                  {portable?.state === 'absent' ? 'Copy Lumina' : portable?.state === 'current' ? 'Copy again' : 'Update'}
                </Button>
              </div>
            </Row>
            <Row id="usbExport" label="Copy library to the drive" description="Only copies what isn’t already there, so running it again is quick.">
              <div className="flex gap-2">
                <Button variant="primary" size="sm" disabled={busy} icon={<HardDriveUpload className="size-4" />}
                  onClick={() => void act('Copied to the drive', () => call('usb:export', { root: selected.root, kinds: ['audio'] }))}>
                  Music
                </Button>
                <Button variant="ghost" size="sm" disabled={busy}
                  onClick={() => void act('Copied to the drive', () => call('usb:export', { root: selected.root, kinds: ['audio', 'video'] }))}>
                  Everything
                </Button>
              </div>
            </Row>
            <Row id="usbImport" label="Bring the drive’s media into this PC" description="Copies anything on the drive your library doesn’t already have, then indexes it.">
              <Button variant="ghost" size="sm" disabled={busy} icon={<HardDriveDownload className="size-4" />}
                onClick={() => void act('Imported', () => call('usb:import', { root: selected.root }))}>
                Import
              </Button>
            </Row>
            <Row
              id="usbTvCompatibility"
              label="Make files playable on a TV"
              description="Televisions decode much less than a PC — HEVC, 10-bit, MKV, DTS and 4K usually show “unsupported file”. Converting to H.264/AAC MP4 while copying fixes that, but takes far longer than a plain copy."
            >
              <Select
                label="TV compatibility"
                value={s.storage.usbTvCompatibility}
                onChange={(v) => set({ storage: { usbTvCompatibility: v } })}
                options={[
                  { value: 'safe', label: 'Convert what a TV can’t play' },
                  { value: 'original', label: 'Copy everything as it is' },
                ]}
              />
            </Row>
            <Row id="usbRouting" label="Send new downloads here while it’s plugged in"
              description="Downloads still finish on this PC first and are copied over when they’re done — a USB stick is too slow to download straight onto.">
              <Switch label="Route downloads to the drive" checked={s.storage.usbRouting} onChange={(v) => set({ storage: { usbRouting: v } })} />
            </Row>
          </>
        )}

        {transfer && (
          <div className="rounded-lg border border-line bg-sunken p-3">
            <div className="flex items-center justify-between gap-3 text-[13px]">
              <span className="min-w-0 truncate font-semibold">
                {transfer.direction === 'export' ? 'Copying to the drive' : 'Importing from the drive'} · {transfer.stage}
              </span>
              <span className="shrink-0 text-ink-3 tabular">
                {transfer.files} / {transfer.totalFiles} · {formatBytes(transfer.bytes)} of {formatBytes(transfer.totalBytes)}
              </span>
            </div>
            <ProgressBar
              className="mt-2"
              value={transfer.totalBytes > 0 ? (transfer.bytes / transfer.totalBytes) * 100 : transfer.done ? 100 : 0}
              tone={transfer.error ? 'danger' : transfer.done ? 'success' : 'accent'}
            />
            {!transfer.done && (
              <Button className="mt-2" variant="ghost" size="sm" onClick={() => void call('usb:cancel').catch(() => {})}>Stop</Button>
            )}
            {transfer.error && <p className="mt-2 text-[13px] text-danger">{transfer.error}</p>}
          </div>
        )}
      </Group>
    </>
  );
}
