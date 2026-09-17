import { SPONSOR_CATEGORIES } from '@shared/settings';
import { previewTemplate, outputTemplate } from '@core/ytdlpArgs';
import type { DownloadOptions } from '@shared/types';
import { useApp } from '@/stores/app';
import { Segmented, Select, Switch } from '@/components/ui';
import { Chips, Group, NumberInput, Row, TextInput, TimeInput, type SectionProps } from '../controls';
import { SubtitlePreview } from '../SubtitlePreview';

const SAMPLE = {
  title: 'One More Time', artist: 'Daft Punk', creator: 'Daft Punk', uploader: 'Daft Punk - Topic', channel: 'Daft Punk',
  album: 'Discovery', track_number: 1, playlist_title: 'Road trip', playlist_index: 3, upload_date: '20010312', id: 'FGBhQbmPwH8', ext: 'opus',
};

export function DownloadsSection({ s, set }: SectionProps) {
  const d = s.downloads;
  const presets = useApp((x) => x.presets);
  const opts = (type: 'music' | 'video') => presets.filter((p) => p.appliesTo.includes(type)).map((p) => ({ value: p.id, label: p.name }));
  const layout = { music: d.musicLayout, video: d.videoLayout };
  const musicPreview = previewTemplate(outputTemplate({ contentType: 'music' } as DownloadOptions, false, d.playlistNumbering, d.filenameTemplate, layout), SAMPLE);
  const playlistPreview = previewTemplate(outputTemplate({ contentType: 'music' } as DownloadOptions, true, d.playlistNumbering, d.filenameTemplate, layout), SAMPLE);

  return (
    <>
      <Group title="Defaults" description="What Lumina picks when you paste a link. You can always change it for a single download.">
        <Row id="presetMusic" label="Music"><Select label="Default music format" value={d.defaultPreset.music} onChange={(v) => set({ downloads: { defaultPreset: { ...d.defaultPreset, music: v } } })} options={opts('music')} /></Row>
        <Row id="presetVideo" label="Videos"><Select label="Default video format" value={d.defaultPreset.video} onChange={(v) => set({ downloads: { defaultPreset: { ...d.defaultPreset, video: v } } })} options={opts('video')} /></Row>
        <Row id="presetSeries" label="Series"><Select label="Default series format" value={d.defaultPreset.series} onChange={(v) => set({ downloads: { defaultPreset: { ...d.defaultPreset, series: v } } })} options={opts('video')} /></Row>
      </Group>

      <Group title="Speed">
        <Row id="concurrency" label="Downloads at the same time">
          <Segmented label="Concurrent downloads" value={String(d.concurrency)} onChange={(v) => set({ downloads: { concurrency: Number(v) } })} options={['1', '2', '3', '4', '6', '8'].map((v) => ({ value: v, label: v }))} />
        </Row>
        <Row id="fragments" label="Parallel pieces per video" description="Streams are split into pieces; fetching more at once is faster on good connections.">
          <Segmented label="Concurrent fragments" value={String(d.concurrentFragments)} onChange={(v) => set({ downloads: { concurrentFragments: Number(v) } })} options={['1', '4', '8', '16'].map((v) => ({ value: v, label: v }))} />
        </Row>
        <Row id="connections" label="Connections per file" description="For direct file downloads. Most servers allow up to 16.">
          <Segmented label="Connections per server" value={String(s.network.connectionsPerServer)} onChange={(v) => set({ network: { connectionsPerServer: Number(v) } })} options={['1', '4', '8', '16'].map((v) => ({ value: v, label: v }))} />
        </Row>
        <Row id="speedLimit" label="Speed limit" description={d.speedLimitKbps ? `About ${(d.speedLimitKbps / 1024).toFixed(1)} MB/s` : 'No limit.'}>
          <NumberInput value={d.speedLimitKbps} min={0} suffix="KB/s" onCommit={(v) => set({ downloads: { speedLimitKbps: v } })} />
        </Row>
        {d.speedLimitKbps > 0 && (
          <Row id="speedSchedule" label="Only limit during these hours" description="Download at full speed at night, stay polite during the day.">
            <TimeInput label="From" value={d.speedLimitSchedule.from} onCommit={(v) => set({ downloads: { speedLimitSchedule: { ...d.speedLimitSchedule, from: v } } })} />
            <span className="text-xs text-ink-3">to</span>
            <TimeInput label="To" value={d.speedLimitSchedule.to} onCommit={(v) => set({ downloads: { speedLimitSchedule: { ...d.speedLimitSchedule, to: v } } })} />
            <Switch label="Speed limit schedule" checked={d.speedLimitSchedule.enabled} onChange={(v) => set({ downloads: { speedLimitSchedule: { ...d.speedLimitSchedule, enabled: v } } })} />
          </Row>
        )}
        <Row id="retries" label="Retries on network errors"><NumberInput value={d.retries} min={0} max={10} onCommit={(v) => set({ downloads: { retries: v } })} /></Row>
        <Row id="autoRetry" label="Try failed downloads again later" description="Up to 3 times, after 30 seconds, 2 minutes and 10 minutes. Only for network problems.">
          <Switch label="Auto retry" checked={d.autoRetryFailed} onChange={(v) => set({ downloads: { autoRetryFailed: v } })} />
        </Row>
        <Row id="preventSleep" label="Keep the computer awake while downloading">
          <Switch label="Prevent sleep" checked={d.preventSleep} onChange={(v) => set({ downloads: { preventSleep: v } })} />
        </Row>
      </Group>

      <Group title="Files and folders">
        <Row id="filename" label="File name" description="Uses yt-dlp fields like %(title)s, %(artist)s, %(upload_date)s." stacked>
          <TextInput mono width="w-full min-w-[420px]" value={d.filenameTemplate} onCommit={(v) => set({ downloads: { filenameTemplate: v } })}
            validate={(v) => (!v.trim() ? 'A file name is needed.' : /[\\/]\.\.|^\.\.|[<>|"]/.test(v) ? 'Remove path characters like .. < > | or quotes.' : !/%\(/.test(v) ? 'Include at least one field, like %(title)s.' : null)} />
        </Row>
        <Row id="musicLayout" label="Organize music">
          <Segmented label="Music layout" value={d.musicLayout} onChange={(v) => set({ downloads: { musicLayout: v } })} options={[{ value: 'flat', label: 'One folder' }, { value: 'artist', label: 'By artist' }, { value: 'artist-album', label: 'Artist › Album' }]} />
        </Row>
        <Row id="videoLayout" label="Organize videos">
          <Segmented label="Video layout" value={d.videoLayout} onChange={(v) => set({ downloads: { videoLayout: v } })} options={[{ value: 'flat', label: 'One folder' }, { value: 'channel', label: 'By channel' }]} />
        </Row>
        <div className="py-3">
          <div className="rounded-lg border border-line bg-sunken px-3 py-2.5 font-mono text-[12px] leading-relaxed text-ink-2" data-selectable>
            <div><span className="text-ink-3">Song      </span>Music/{musicPreview}</div>
            <div><span className="text-ink-3">Playlist  </span>Music/{playlistPreview}</div>
          </div>
        </div>
        <Row id="numbering" label="Number playlist items" description="“03 - Song” keeps playlists in order on any device.">
          <Switch label="Number playlist items" checked={d.playlistNumbering} onChange={(v) => set({ downloads: { playlistNumbering: v } })} />
        </Row>
        <Row id="playlistFile" label="Write a playlist file" description="Adds an .m3u8 next to downloaded playlists so TVs and players keep the order.">
          <Switch label="Write playlist file" checked={d.writePlaylistFile} onChange={(v) => set({ downloads: { writePlaylistFile: v } })} />
        </Row>
        <Row id="skipExisting" label="Skip what’s already downloaded" description="Downloading a playlist again only fetches new songs.">
          <Switch label="Skip existing" checked={d.skipExisting} onChange={(v) => set({ downloads: { skipExisting: v } })} />
        </Row>
        <Row id="afterDownload" label="When a download finishes">
          <Segmented label="After download" value={d.afterDownload} onChange={(v) => set({ downloads: { afterDownload: v } })} options={[{ value: 'nothing', label: 'Stay here' }, { value: 'reveal', label: 'Show in folder' }]} />
        </Row>
      </Group>

      <Group title="Tags and artwork">
        <Row id="metadata" label="Add title, artist and album tags"><Switch label="Embed metadata" checked={d.embedMetadata} onChange={(v) => set({ downloads: { embedMetadata: v } })} /></Row>
        <Row id="thumbnail" label="Add cover art"><Switch label="Embed thumbnail" checked={d.embedThumbnail} onChange={(v) => set({ downloads: { embedThumbnail: v } })} /></Row>
        <Row id="squareArt" label="Square album art for music" description="YouTube thumbnails are widescreen; this crops them like a real album cover.">
          <Switch label="Square artwork" checked={d.squareMusicArtwork} disabled={!d.embedThumbnail} onChange={(v) => set({ downloads: { squareMusicArtwork: v } })} />
        </Row>
        <Row id="embedLyrics" label="Add synced lyrics to songs" description="Players like Poweramp, foobar2000 and Apple Music show them.">
          <Switch label="Embed lyrics" checked={d.embedLyrics} onChange={(v) => set({ downloads: { embedLyrics: v } })} />
        </Row>
        <Row id="lrcFile" label="Also save a .lrc lyrics file"><Switch label="Write LRC file" checked={d.writeLrcFile} onChange={(v) => set({ downloads: { writeLrcFile: v } })} /></Row>
      </Group>

      <Group title="Sponsor segments" description="Uses SponsorBlock community data on YouTube.">
        <Row id="sponsorBlock" label="Sponsor segments">
          <Segmented label="SponsorBlock" value={d.sponsorBlock} onChange={(v) => set({ downloads: { sponsorBlock: v } })} options={[{ value: 'off', label: 'Keep' }, { value: 'mark', label: 'Mark as chapters' }, { value: 'remove', label: 'Cut out' }]} />
        </Row>
        {d.sponsorBlock !== 'off' && (
          <Row id="sponsorCategories" label="Which segments" stacked>
            <Chips label="SponsorBlock categories" value={d.sponsorCategories} onChange={(v) => set({ downloads: { sponsorCategories: v } })}
              options={SPONSOR_CATEGORIES.map((c) => ({ value: c, label: { sponsor: 'Sponsors', selfpromo: 'Self-promotion', interaction: 'Like/subscribe reminders', intro: 'Intros', outro: 'Endcards', preview: 'Previews', music_offtopic: 'Non-music parts', filler: 'Filler' }[c] }))} />
          </Row>
        )}
      </Group>
    </>
  );
}

export function FormatsSection({ s, set }: SectionProps) {
  const f = s.formats;
  return (
    <>
      <Group title="Video">
        <Row id="container" label="Preferred file type" description="MP4 plays almost everywhere. MKV can hold every codec and subtitle track without conversion.">
          <Segmented label="Video container" value={f.videoContainer} onChange={(v) => set({ formats: { videoContainer: v } })} options={[{ value: 'mp4', label: 'MP4' }, { value: 'mkv', label: 'MKV' }]} />
        </Row>
        <Row id="hwEncode" label="Use the graphics card for conversion" description="Much faster TV-ready conversion on NVIDIA, Intel and AMD. Falls back to the CPU automatically.">
          <Switch label="Hardware encoding" checked={f.hardwareEncoding} onChange={(v) => set({ formats: { hardwareEncoding: v } })} />
        </Row>
        <Row id="encodeQuality" label="Conversion quality">
          <Segmented label="Encode quality" value={f.encodeQuality} onChange={(v) => set({ formats: { encodeQuality: v } })} options={[{ value: 'fast', label: 'Faster' }, { value: 'balanced', label: 'Balanced' }, { value: 'quality', label: 'Best' }]} />
        </Row>
        <Row id="keepOriginal" label="Keep the original after converting" description="Saves the TV-ready copy as “Name (TV).mp4” next to the untouched download.">
          <Switch label="Keep original" checked={f.keepOriginalAfterConvert} onChange={(v) => set({ formats: { keepOriginalAfterConvert: v } })} />
        </Row>
      </Group>
      <Group title="Music">
        <Row id="mp3Bitrate" label="MP3 quality" description="Only used when converting to MP3. “Original audio” never re-encodes.">
          <Segmented label="MP3 bitrate" value={f.mp3Bitrate} onChange={(v) => set({ formats: { mp3Bitrate: v } })} options={[{ value: '192', label: '192 kbps' }, { value: '256', label: '256 kbps' }, { value: '320', label: '320 kbps' }]} />
        </Row>
      </Group>
    </>
  );
}

export function SubtitlesSection({ s, set }: SectionProps) {
  const x = s.subtitles;
  const st = x.style;
  const style = (patch: Partial<typeof st>) => set({ subtitles: { style: { ...st, ...patch } } });
  const colors = ['#FFFFFF', '#FFE066', '#9BE7FF', '#B8FFCB'];

  return (
    <>
      <Group title="Appearance" description="Used in Lumina’s player and when subtitles are burned into a video.">
        <div className="py-4">
          <SubtitlePreview style={st} burned={x.output.includes('burn')} />
          <p className="mt-2 text-xs text-ink-3">Click the frame to see another line.</p>
        </div>
        <Row id="subFont" label="Font">
          <Segmented label="Subtitle font" value={st.font} onChange={(v) => style({ font: v })} options={[{ value: 'sans', label: 'Clean' }, { value: 'serif', label: 'Classic' }, { value: 'rounded', label: 'Rounded' }, { value: 'mono', label: 'Mono' }]} />
        </Row>
        <Row id="subSize" label="Size" description={`${Math.round(st.size * 100)}%`}>
          <input type="range" min={0.6} max={2} step={0.05} value={st.size} aria-label="Subtitle size" onChange={(e) => style({ size: Number(e.target.value) })} className="w-48 accent-[var(--accent)]" />
        </Row>
        <Row id="subColor" label="Text color">
          <div className="flex items-center gap-2">
            {colors.map((c) => (
              <button key={c} aria-label={c} aria-pressed={st.color.toUpperCase() === c} onClick={() => style({ color: c })}
                className={`size-7 rounded-full ring-1 ring-line-strong ring-offset-2 ring-offset-panel transition-transform hover:scale-110 ${st.color.toUpperCase() === c ? 'ring-2 ring-ink' : ''}`} style={{ background: c }} />
            ))}
            <label className="relative size-7 cursor-pointer overflow-hidden rounded-full ring-1 ring-line-strong" title="Custom color" style={{ background: 'conic-gradient(red,yellow,lime,cyan,blue,magenta,red)' }}>
              <input type="color" value={st.color} onChange={(e) => style({ color: e.target.value.toUpperCase() })} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Custom subtitle color" />
            </label>
          </div>
        </Row>
        <Row id="subBackground" label="Readability">
          <Segmented label="Subtitle background" value={st.background} onChange={(v) => style({ background: v })} options={[{ value: 'outline', label: 'Outline' }, { value: 'box', label: 'Box' }, { value: 'shadow', label: 'Shadow' }, { value: 'none', label: 'None' }]} />
        </Row>
        {st.background !== 'none' && (
          <Row id="subOpacity" label={st.background === 'box' ? 'Box opacity' : 'Strength'} description={`${Math.round(st.backgroundOpacity * 100)}%`}>
            <input type="range" min={0.1} max={1} step={0.05} value={st.backgroundOpacity} aria-label="Background opacity" onChange={(e) => style({ backgroundOpacity: Number(e.target.value) })} className="w-48 accent-[var(--accent)]" />
          </Row>
        )}
        <Row id="subBold" label="Bold"><Switch label="Bold subtitles" checked={st.bold} onChange={(v) => style({ bold: v })} /></Row>
        <Row id="subPosition" label="Position">
          <Segmented label="Subtitle position" value={st.position} onChange={(v) => style({ position: v })} options={[{ value: 'bottom', label: 'Bottom' }, { value: 'top', label: 'Top' }]} />
        </Row>
      </Group>

      <Group title="English subtitles">
        <Row id="subDefault" label="Turn on for every video" description="Uses the site’s subtitles, or generates them on this PC when there are none.">
          <Switch label="English subtitles by default" checked={x.englishByDefault} onChange={(v) => set({ subtitles: { englishByDefault: v } })} />
        </Row>
        <Row id="subAuto" label="Accept the site’s auto-generated captions" description="Off means Lumina generates its own when there are no human-made subtitles.">
          <Switch label="Auto-generated captions" checked={x.includeAutoGenerated} onChange={(v) => set({ subtitles: { includeAutoGenerated: v } })} />
        </Row>
        <Row id="subOutput" label="Save subtitles as">
          <Segmented label="Subtitle output" value={x.output.join('+')} onChange={(v) => set({ subtitles: { output: v.split('+') as typeof x.output } })} options={[
            { value: 'sidecar+embed', label: 'File + inside video' }, { value: 'sidecar', label: 'File only' }, { value: 'embed', label: 'Inside only' }, { value: 'burn', label: 'Burned in' },
          ]} />
        </Row>
      </Group>

      <Group title="Generating subtitles">
        <Row id="whisperModel" label="Speech model" description={x.whisperModel === 'base' ? 'Base is fast and included with Lumina.' : 'Small is more accurate for accents and noisy audio (about 470 MB, downloaded when first used).'}>
          <Segmented label="Whisper model" value={x.whisperModel} onChange={(v) => set({ subtitles: { whisperModel: v } })} options={[{ value: 'base', label: 'Base' }, { value: 'small', label: 'Small' }]} />
        </Row>
        <Row id="whisperGpu" label="Use the graphics card"><Switch label="Use GPU for subtitles" checked={x.useGpu} onChange={(v) => set({ subtitles: { useGpu: v } })} /></Row>
      </Group>
    </>
  );
}

export function TorrentsSection({ s, set }: SectionProps) {
  const t = s.torrents;
  return (
    <>
      <Group title="Speed and peers">
        <Row id="maxPeers" label="Peers per torrent" description="More peers can mean faster downloads on a good connection.">
          <NumberInput value={t.maxPeers} min={10} max={500} onCommit={(v) => set({ torrents: { maxPeers: v } })} />
        </Row>
        <Row id="uploadLimit" label="Upload limit" description={t.uploadLimitKbps ? `About ${(t.uploadLimitKbps / 1024).toFixed(1)} MB/s` : 'No limit.'}>
          <NumberInput value={t.uploadLimitKbps} min={0} suffix="KB/s" onCommit={(v) => set({ torrents: { uploadLimitKbps: v } })} />
        </Row>
        <Row id="trackers" label="Use a fresh public tracker list" description="Updated daily. Helps magnet links find peers faster.">
          <Switch label="Auto trackers" checked={t.autoTrackers} onChange={(v) => set({ torrents: { autoTrackers: v } })} />
        </Row>
        <Row id="dht" label="Find peers without trackers (DHT)"><Switch label="DHT" checked={t.dht} onChange={(v) => set({ torrents: { dht: v } })} /></Row>
      </Group>
      <Group title="Sharing">
        <Row id="seedRatio" label="Keep sharing until ratio" description="0 stops sharing as soon as the download finishes.">
          <NumberInput value={t.seedRatio} min={0} max={10} step={0.5} onCommit={(v) => set({ torrents: { seedRatio: v } })} />
        </Row>
        <Row id="seedMinutes" label="Or for at most" description="0 means no time limit.">
          <NumberInput value={t.seedMinutes} min={0} suffix="minutes" onCommit={(v) => set({ torrents: { seedMinutes: v } })} />
        </Row>
      </Group>
      <Group title="Connection">
        <Row id="torrentPort" label="Listening port"><NumberInput value={t.listenPort} min={1024} max={65535} onCommit={(v) => set({ torrents: { listenPort: v } })} /></Row>
        <Row id="encryption" label="Only connect with encryption" description="Can reduce peers, but helps on networks that slow down torrents.">
          <Switch label="Require encryption" checked={t.requireEncryption} onChange={(v) => set({ torrents: { requireEncryption: v } })} />
        </Row>
      </Group>
    </>
  );
}
