import { useState } from 'react';
import { AppWindow, ArrowDownToLine, Captions, ChevronDown, Disc3, File, FileArchive, FileText, Film, FolderOpen, Info, Magnet, Music, Play, Radio, ShieldCheck, Sparkles, Tv } from 'lucide-react';
import type { ContentType, DownloadOptions, MediaInfo, SubtitleOutput } from '@shared/types';
import { defaultPresetFor, guessContentType, presetById, qualityNote, sourceMaxHeight } from '@core/presets';
import { hasEnglishSubtitles } from '@core/streams';
import { canPlayLink, linkMetaLine } from '@core/linkMeta';
import { call, errorMessage } from '@/lib/bridge';
import { playLink } from '@/lib/playLink';
import { cn } from '@/lib/cn';
import { useApp } from '@/stores/app';
import { Badge, Button, Segmented, Switch } from '@/components/ui';
import { Artwork } from '@/components/Artwork';
import { FormatPicker } from './FormatPicker';
import { PlaylistPicker } from './PlaylistPicker';

/** A file-type tile for direct downloads and torrents, instead of a blank thumbnail. */
function FileTile({ name, torrent }: { name: string; torrent: boolean }) {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  const icon = torrent ? <Magnet /> : /^(zip|rar|7z|tar|gz|xz|bz2|\d{3})$/.test(ext) ? <FileArchive /> : /^(mp4|mkv|webm|mov|avi|m4v)$/.test(ext) ? <Film />
    : /^(mp3|flac|wav|m4a|ogg|opus|aac)$/.test(ext) ? <Music /> : /^(iso|img|dmg)$/.test(ext) ? <Disc3 /> : /^(exe|msi|appimage|deb|rpm|apk|pkg)$/.test(ext) ? <AppWindow />
      : /^(pdf|txt|epub|docx?)$/.test(ext) ? <FileText /> : <File />;
  return (
    <div className="relative grid size-[72px] shrink-0 place-items-center rounded-lg border border-line bg-sunken text-ink-3 [&_svg]:size-7">
      {icon}
      {ext && !torrent && <span className="absolute bottom-1 rounded bg-ink px-1.5 py-px text-[10px] font-bold tracking-wide text-ink-inverse uppercase">{ext.slice(0, 5)}</span>}
    </div>
  );
}

const OUTPUT_LABELS: Record<SubtitleOutput, { label: string; hint: string }> = {
  sidecar: { label: 'Separate .srt file', hint: 'Works with almost every TV and player' },
  embed: { label: 'Inside the video', hint: 'A track you can turn on or off' },
  burn: { label: 'Burned in', hint: 'Always visible. Re-encodes the video (slower)' },
};

export function InspectResult({ url, info, onDone }: { url: string; info: MediaInfo; onDone: () => void }) {
  const settings = useApp((s) => s.settings)!;
  const presets = useApp((s) => s.presets);
  const toast = useApp((s) => s.toast);
  const setView = useApp((s) => s.setView);

  const isTransfer = info.sourceKind === 'direct' || info.sourceKind === 'torrent';
  const [contentType, setContentType] = useState<ContentType>(() => guessContentType(info));
  const [presetId, setPresetId] = useState(() => defaultPresetFor(contentType, settings.downloads.defaultPreset).id);
  const [subs, setSubs] = useState(settings.subtitles.englishByDefault);
  const [outputs, setOutputs] = useState<SubtitleOutput[]>(settings.subtitles.output);
  const [selected, setSelected] = useState<Set<number>>(() => new Set(info.entries.map((e) => e.index)));
  const [series, setSeries] = useState({ show: info.title, season: 1 });
  const [targetDir, setTargetDir] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [opening, setOpening] = useState(false);
  const [more, setMore] = useState(false);

  const preset = presetById(presetId) ?? defaultPresetFor(contentType, settings.downloads.defaultPreset);
  const isVideo = preset.format.kind === 'video';
  const siteSubs = hasEnglishSubtitles(info.subtitles);
  const max = sourceMaxHeight(info);
  const qualities = presets.filter((p) => p.appliesTo.includes(contentType)
    && (p.format.kind === 'audio' || !p.format.maxHeight || p.format.tvSafe || !max || p.format.maxHeight <= max));
  const note = qualityNote(preset.format, info);

  const defaultDir = isTransfer ? settings.storage.otherDir
    : contentType === 'music' ? settings.storage.musicDir : contentType === 'series' ? settings.storage.seriesDir : settings.storage.videoDir;

  const changeType = (t: ContentType) => {
    setContentType(t);
    setPresetId(defaultPresetFor(t, settings.downloads.defaultPreset).id);
  };

  const itemCount = info.sourceKind === 'playlist' ? selected.size : 1;
  const by = info.uploader && info.uploader !== info.site ? `${info.uploader} · ` : '';

  const pickFolder = async () => {
    const dir = await call('dialog:pick-folder', { title: 'Save downloads to' });
    if (dir) setTargetDir(dir);
  };

  const play = async () => {
    setOpening(true);
    await playLink(url, { info, request: info.request });
    setOpening(false);
  };

  const add = async () => {
    const options: DownloadOptions = {
      contentType,
      format: preset.format,
      englishSubtitles: isVideo && subs,
      subtitleOutput: outputs,
      embedMetadata: settings.downloads.embedMetadata,
      embedLyrics: settings.downloads.embedLyrics,
      sponsorBlock: settings.downloads.sponsorBlock !== 'off',
      playlistItems: info.sourceKind === 'playlist' && selected.size !== info.entries.length ? [...selected].sort((a, b) => a - b) : [],
      series: contentType === 'series' ? series : undefined,
      targetDir: targetDir ?? undefined,
    };
    setAdding(true);
    try {
      const job = await call('jobs:add', { url, info, options });
      toast(`Added “${job.title}” to the queue`, 'success', { label: 'View', run: () => setView('queue') });
      onDone();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setAdding(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-panel shadow-sm animate-rise" aria-label="Link ready">
      {/* What the link is */}
      <header className="flex gap-4 p-5">
        {info.thumbnail ? (
          <img src={info.thumbnail} alt="" className={cn('shrink-0 rounded-lg object-cover shadow-sm', info.isMusic ? 'size-[72px]' : 'h-[72px] w-32')} />
        ) : isTransfer ? (
          <FileTile name={info.direct?.filename ?? info.title} torrent={info.sourceKind === 'torrent'} />
        ) : (
          <Artwork src={null} seed={info.title} kind={info.isMusic ? 'audio' : 'video'} className="size-[72px]" />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="line-clamp-2 text-[17px] leading-snug font-semibold tracking-tight" data-selectable>{info.title}</h2>
          <p className="mt-1 truncate text-sm text-ink-3">{by}{linkMetaLine(info, itemCount)}</p>
          {(info.isLive || info.stream || (info.request && (info.request.cookies.length > 0 || info.request.pageUrl))) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {info.isLive && <Badge tone="danger">Live</Badge>}
              {info.stream && <Badge tone="accent"><Radio className="size-3" /> {info.stream.protocol.toUpperCase()} stream</Badge>}
              {info.request && (info.request.cookies.length > 0 || info.request.pageUrl) && (
                <span title="Lumina will make the same request your browser did"><Badge><ShieldCheck className="size-3" /> Browser session</Badge></span>
              )}
            </div>
          )}
        </div>
      </header>

      {info.notes && info.notes.length > 0 && (
        <div className="space-y-1.5 border-t border-line bg-sunken/50 px-5 py-3">
          {info.notes.map((n) => (
            <p key={n} className="flex items-start gap-2 text-[13px] leading-relaxed text-ink-2"><Info className="mt-0.5 size-3.5 shrink-0 text-ink-3" />{n}</p>
          ))}
        </div>
      )}

      {/* The few choices most people make, and the two things to do with them */}
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3.5">
        {!isTransfer && qualities.length > 0 && (
          <label className="relative inline-flex">
            <span className="sr-only">Quality</span>
            <select
              value={preset.id}
              onChange={(e) => setPresetId(e.target.value)}
              className="h-9 max-w-[220px] appearance-none rounded-lg border border-line-strong bg-raised pr-8 pl-3 text-[13px] font-medium text-ink outline-none focus:border-accent"
            >
              {qualities.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-ink-3" />
          </label>
        )}
        <button onClick={pickFolder} className="flex h-9 min-w-0 max-w-[260px] items-center gap-2 rounded-lg border border-line-strong bg-raised px-3 text-[13px] text-ink-2 transition-colors hover:bg-hover hover:text-ink" title="Change folder">
          <FolderOpen className="size-4 shrink-0 text-ink-3" />
          <span className="truncate" data-selectable>{targetDir ?? defaultDir}</span>
        </button>
        <div className="ml-auto flex items-center gap-2">
          {canPlayLink(info) && (
            <Button loading={opening} icon={<Play className="size-4 fill-current" />} onClick={() => void play()} title="Play it now, without downloading">Play</Button>
          )}
          <Button variant="primary" loading={adding} disabled={itemCount === 0 || (isVideo && subs && outputs.length === 0)} icon={<ArrowDownToLine className="size-4" />} onClick={add}>
            {itemCount > 1 ? `Download ${itemCount}` : 'Download'}
          </Button>
        </div>
      </div>
      {note && !isTransfer && <p className="-mt-1 flex items-start gap-2 px-5 pb-3.5 text-[13px] leading-relaxed text-ink-3"><Info className="mt-0.5 size-3.5 shrink-0" />{note}</p>}

      {info.sourceKind === 'playlist' && info.entries.length > 0 && (
        <div className="border-t border-line p-5">
          <PlaylistPicker entries={info.entries} selected={selected} onChange={setSelected} />
        </div>
      )}

      {/* Everything else, one click away */}
      {!isTransfer && (
        <div className="border-t border-line">
          <button
            onClick={() => setMore(!more)}
            aria-expanded={more}
            className="flex w-full items-center gap-2 px-5 py-2.5 text-[13px] font-medium text-ink-3 transition-colors hover:bg-hover hover:text-ink"
          >
            <ChevronDown className={cn('size-4 transition-transform duration-200', more && 'rotate-180')} />
            More options
            <span className="font-normal text-ink-3/80">format, subtitles{contentType === 'series' ? ', series' : ''}</span>
          </button>
          {more && (
            <div className="space-y-6 px-5 pt-1 pb-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">Save as</h3>
                <Segmented
                  label="Content type"
                  value={contentType}
                  onChange={changeType}
                  options={[
                    { value: 'music', label: 'Music' },
                    { value: 'video', label: 'Video', disabled: info.site === 'Spotify' || (info.videoStreams.length === 0 && info.sourceKind !== 'playlist'), hint: 'This source has no video' },
                    { value: 'series', label: 'Series', disabled: info.site === 'Spotify' || info.sourceKind !== 'playlist', hint: 'Series needs a playlist' },
                  ]}
                />
              </div>

              {contentType === 'series' && (
                <div className="grid grid-cols-[1fr_120px] gap-3">
                  <label className="text-xs font-semibold text-ink-3">Show name
                    <input value={series.show} onChange={(e) => setSeries({ ...series, show: e.target.value })} className="mt-1 h-9 w-full rounded-lg border border-line-strong bg-raised px-3 text-sm font-medium text-ink outline-none focus:border-accent" />
                  </label>
                  <label className="text-xs font-semibold text-ink-3">Season
                    <input type="number" min={0} max={999} value={series.season} onChange={(e) => setSeries({ ...series, season: Math.max(0, Number(e.target.value) || 0) })} className="mt-1 h-9 w-full rounded-lg border border-line-strong bg-raised px-3 text-sm font-medium text-ink outline-none tabular focus:border-accent" />
                  </label>
                </div>
              )}

              <FormatPicker presets={presets} contentType={contentType} info={info} value={preset.id} onChange={setPresetId} />

              {isVideo && (
                <div className="rounded-xl border border-line bg-raised">
                  <div className="flex items-center gap-3 p-3.5">
                    <span className="grid size-9 place-items-center rounded-lg bg-sunken text-ink-2"><Captions className="size-[18px]" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">English subtitles</p>
                      <p className="text-[13px] text-ink-3">
                        {siteSubs ? 'Downloaded from the site.' : <span className="inline-flex items-center gap-1"><Sparkles className="size-3.5 text-accent" /> Not on the site, so Lumina will generate them on this PC.</span>}
                      </p>
                    </div>
                    <Switch label="English subtitles" checked={subs} onChange={setSubs} />
                  </div>
                  {subs && (
                    <div className="grid grid-cols-3 gap-2 border-t border-line p-3.5">
                      {(Object.keys(OUTPUT_LABELS) as SubtitleOutput[]).map((o) => {
                        const on = outputs.includes(o);
                        return (
                          <button
                            key={o}
                            aria-pressed={on}
                            onClick={() => setOutputs(on ? outputs.filter((x) => x !== o) : [...outputs, o])}
                            className={cn('rounded-lg border p-2.5 text-left transition-colors', on ? 'border-accent bg-accent-soft' : 'border-line hover:bg-hover')}
                          >
                            <span className="block text-[13px] font-semibold">{OUTPUT_LABELS[o].label}</span>
                            <span className="mt-0.5 block text-xs leading-snug text-ink-3">{OUTPUT_LABELS[o].hint}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {preset.format.kind === 'video' && preset.format.tvSafe && (
                <p className="flex items-center gap-2 text-[13px] text-ink-3"><Tv className="size-4" /> Lumina checks the finished file and converts it only if a TV couldn’t play it.</p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
