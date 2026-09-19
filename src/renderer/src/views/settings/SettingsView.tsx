import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Captions, Cast, Code2, Download, Film, Globe, HardDrive, Magnet, Monitor, Music2, Palette, Plug, Puzzle, RefreshCw, Search, Settings2, Shield, Sparkles, Usb, UserRound, Wrench, X,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useApp } from '@/stores/app';
import { TitleBar } from '@/components/Shell';
import { AppearanceSection, GeneralSection, PlayerSection } from './sections/app';
import { DownloadsSection, FormatsSection, SubtitlesSection, TorrentsSection } from './sections/downloading';
import { AccountsSection, ExtensionSection, NetworkSection } from './sections/connections';
import { SyncSection } from './sections/sync';
import { SharingSection } from './sections/sharing';
import { AiSection } from './sections/ai';
import { McpSection } from './sections/mcp';
import { EditorThemeSection } from './sections/editorTheme';
import { PortableSection } from './sections/portable';
import { AdvancedSection, PrivacySection, StorageSection } from './sections/system';
import type { SectionProps } from './controls';

interface SectionDef {
  id: string;
  label: string;
  icon: ReactNode;
  group: string;
  component: (p: SectionProps) => ReactNode;
  /** Searchable setting labels: [row id, label, extra keywords]. */
  index: [string, string, string?][];
}

const SECTIONS: SectionDef[] = [
  { id: 'general', label: 'General', icon: <Settings2 />, group: 'App', component: GeneralSection, index: [
    ['closeToTray', 'Keep running when the window is closed', 'tray background'], ['startWithSystem', 'Start with your computer', 'startup login boot'],
    ['startMode', 'When Lumina opens, show'], ['resumeQueue', 'Resume unfinished downloads'], ['confirmQuit', 'Ask before quitting'],
    ['clipboard', 'Notice copied links', 'clipboard watcher'], ['shortcut', 'Download copied link from anywhere', 'global hotkey keyboard'],
    ['notifyComplete', 'Notify when a download finishes', 'notifications'], ['notifyFail', 'Notify when a download fails'], ['sound', 'Play a sound'],
    ['whenFinished', 'When all downloads finish', 'sleep shutdown shut down'],
  ] },
  { id: 'appearance', label: 'Appearance', icon: <Palette />, group: 'App', component: AppearanceSection, index: [
    ['accent', 'Accent color', 'theme colour'], ['uiScale', 'Interface size', 'zoom scale font'], ['density', 'Density', 'compact'],
    ['sidebarStats', 'Library counts in the sidebar'], ['motion', 'Reduce motion', 'animations transitions'],
  ] },
  { id: 'editorTheme', label: 'Editor theme', icon: <Code2 />, group: 'App', component: EditorThemeSection, index: [
    ['editorThemeAuto', 'Editor theme', 'code editor terminal colours colors syntax highlighting vs code vscode theme import vsix monaco xterm'],
  ] },
  { id: 'player', label: 'Player', icon: <Music2 />, group: 'App', component: PlayerSection, index: [
    ['effects', 'Background motion', 'aurora vinyl pocket theme'], ['hints', 'Keyboard hints'], ['openOnPlay', 'Open the full player when playing'],
    ['resume', 'Continue long videos where you left off', 'resume position'], ['autoLyrics', 'Open lyrics automatically'], ['lyricsSize', 'Lyrics size'],
  ] },
  { id: 'downloads', label: 'Downloads', icon: <Download />, group: 'Downloading', component: DownloadsSection, index: [
    ['presetMusic', 'Default music format', 'quality mp3 flac'], ['presetVideo', 'Default video format', 'quality 4k 1080p'], ['concurrency', 'Downloads at the same time', 'parallel simultaneous'],
    ['fragments', 'Parallel pieces per video', 'speed fragments'], ['connections', 'Connections per file', 'speed aria2'], ['accelerate', 'Faster downloads (multi-connection)', 'speed aria2 slow kb'], ['speedLimit', 'Speed limit', 'bandwidth throttle'],
    ['speedSchedule', 'Only limit during these hours', 'schedule'], ['retries', 'Retries on network errors'], ['autoRetry', 'Try failed downloads again later'],
    ['preventSleep', 'Keep the computer awake'], ['filename', 'File name', 'template naming'], ['musicLayout', 'Organize music', 'artist album folders'],
    ['videoLayout', 'Organize videos', 'channel folders'], ['numbering', 'Number playlist items'], ['playlistFile', 'Write a playlist file', 'm3u8'],
    ['skipExisting', 'Skip what’s already downloaded', 'archive duplicate'], ['afterDownload', 'When a download finishes', 'open folder'],
    ['metadata', 'Add title, artist and album tags'], ['thumbnail', 'Add cover art', 'artwork thumbnail'], ['squareArt', 'Square album art'],
    ['embedLyrics', 'Add synced lyrics to songs'], ['lrcFile', 'Save a .lrc lyrics file'], ['sponsorBlock', 'Sponsor segments', 'sponsorblock ads'],
  ] },
  { id: 'formats', label: 'Formats', icon: <Film />, group: 'Downloading', component: FormatsSection, index: [
    ['container', 'Preferred file type', 'mp4 mkv'], ['hwEncode', 'Use the graphics card for conversion', 'gpu nvenc hardware'],
    ['encodeQuality', 'Conversion quality'], ['keepOriginal', 'Keep the original after converting'], ['mp3Bitrate', 'MP3 quality', 'bitrate 320'],
  ] },
  { id: 'subtitles', label: 'Subtitles', icon: <Captions />, group: 'Downloading', component: SubtitlesSection, index: [
    ['localAi', 'On-device AI', 'whisper model ram memory gpu offline speech'],
    ['aiModels', 'Models on this PC', 'whisper disk space remove ram'],
    ['subFont', 'Subtitle font'], ['subSize', 'Subtitle size'], ['subColor', 'Subtitle text color'], ['subBackground', 'Subtitle readability', 'outline box shadow'],
    ['subPosition', 'Subtitle position'], ['subDefault', 'English subtitles for every video', 'captions'], ['subAuto', 'Auto-generated captions'],
    ['subOutput', 'Save subtitles as', 'burn embed srt'], ['whisperModel', 'Speech model', 'whisper generate'], ['whisperGpu', 'Use the graphics card for subtitles'],
  ] },
  { id: 'torrents', label: 'Torrents', icon: <Magnet />, group: 'Downloading', component: TorrentsSection, index: [
    ['maxPeers', 'Peers per torrent'], ['uploadLimit', 'Upload limit'], ['trackers', 'Public tracker list'], ['dht', 'DHT'],
    ['seedRatio', 'Keep sharing until ratio', 'seed'], ['seedMinutes', 'Seeding time'], ['torrentPort', 'Torrent listening port'], ['encryption', 'Only connect with encryption'],
  ] },
  { id: 'storage', label: 'Storage & library', icon: <HardDrive />, group: 'Places', component: StorageSection, index: [
    ['musicDir', 'Music folder', 'location path'], ['videoDir', 'Videos folder'], ['otherDir', 'Files and torrents folder'], ['tempDir', 'Work-in-progress folder', 'temp'],
    ['addLibrary', 'Add a library folder'], ['watch', 'Watch folders for changes'], ['minAudio', 'Hide short sounds'],
  ] },
  { id: 'portable', label: 'Portable drive', icon: <Usb />, group: 'Places', component: PortableSection, index: [
    ['usbPrepare', 'Set up this drive', 'usb pendrive stick memory card luminamedia folders structure'],
    ['usbExport', 'Copy library to the drive', 'export backup car stereo tv'],
    ['usbImport', 'Bring the drive’s media into this PC', 'import sync'],
    ['usbRouting', 'Send new downloads here while it’s plugged in', 'route storage'],
  ] },
  { id: 'accounts', label: 'Accounts', icon: <UserRound />, group: 'Connections', component: AccountsSection, index: [
    ['youtubeAccount', 'Sign in to YouTube', 'login members age-restricted private bot'], ['otherSite', 'Sign in to another site'],
    ['cookiesFrom', 'Which sign-in downloads use', 'cookies browser chrome firefox'], ['cookiesFile', 'Import a cookies.txt file'],
    ['spotifyConnect', 'Connect Spotify', 'private playlists liked songs'], ['spotifyClientId', 'Spotify Client ID'],
    ['fw-aria2c', 'Allow torrents through Windows Firewall', 'network access permission peers block denied re-grant'],
  ] },
  { id: 'extension', label: 'Browser extension', icon: <Puzzle />, group: 'Connections', component: ExtensionSection, index: [
    ['extEnabled', 'Allow the extension to connect', 'chrome edge firefox'], ['extCapture', 'Take over browser downloads', 'catch integrate'],
    ['extMinSize', 'Leave small files to the browser'], ['extPort', 'Extension port'], ['extChrome', 'Install the extension'],
  ] },
  { id: 'network', label: 'Network', icon: <Globe />, group: 'Connections', component: NetworkSection, index: [
    ['proxy', 'Proxy', 'socks vpn'], ['userAgent', 'Custom user agent'], ['ipv4', 'Use IPv4 only'],
  ] },
  { id: 'sharing', label: 'Share to TV', icon: <Cast />, group: 'Connections', component: SharingSection, index: [
    ['dlnaEnabled', 'Share my library on this network', 'dlna upnp tv television cast stream media server share'],
    ['dlnaName', 'Name shown on the TV'], ['dlnaPort', 'Port'], ['dlnaAddress', 'Address'],
  ] },
  { id: 'sync', label: 'Sync', icon: <RefreshCw />, group: 'Connections', component: SyncSection, index: [
    ['createChain', 'Start a sync chain', 'devices phone android luminabr brave chain'], ['joinChain', 'Join a sync chain', 'recovery code pair'],
    ['recoveryCode', 'Recovery code', 'seed encrypt e2e'], ['syncFolder', 'Sync folder', 'usb shared cloud'],
    ['syncBookmarks', 'Sync bookmarks'], ['syncNow', 'Sync now'],
  ] },
  { id: 'ai', label: 'AI key', icon: <Sparkles />, group: 'Connections', component: AiSection, index: [
    ['aiProvider', 'AI provider', 'openai anthropic claude gemini google openrouter bring your own key byok'],
    ['aiModel', 'Model'], ['aiKey', 'API key', 'token secret keychain'],
    ['aiLyrics', 'Ask your AI for lyrics as a last resort', 'lyrics fallback'],
  ] },
  { id: 'mcp', label: 'Connected tools', icon: <Plug />, group: 'Connections', component: McpSection, index: [
    ['mcpServers', 'Connected tools (MCP)', 'mcp model context protocol server connector plugin skill tools integration'],
  ] },
  { id: 'privacy', label: 'Privacy', icon: <Shield />, group: 'System', component: PrivacySection, index: [
    ['keepHistory', 'Keep a list of finished downloads', 'history'], ['historyDays', 'Forget finished downloads after'],
    ['artworkCache', 'Clear artwork cache'], ['lyricsCache', 'Clear saved lyrics'],
  ] },
  { id: 'advanced', label: 'Tools & updates', icon: <Wrench />, group: 'System', component: AdvancedSection, index: [
    ['autoUpdate', 'Update yt-dlp automatically'], ['channel', 'Release channel', 'nightly'], ['extraArgs', 'Extra yt-dlp options', 'arguments flags'],
    ['verbose', 'Detailed logs', 'debug'], ['export', 'Export or import settings', 'backup'], ['reset', 'Reset all settings'],
  ] },
];

const GROUPS = [...new Set(SECTIONS.map((s) => s.group))];

export function SettingsView() {
  const settings = useApp((s) => s.settings);
  const update = useApp((s) => s.updateSettings);
  const requested = useApp((s) => s.settingsSection);
  const [section, setSection] = useState(() => (requested && SECTIONS.some((x) => x.id === requested) ? requested : 'general'));
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState<string | null>(null);
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (requested && SECTIONS.some((x) => x.id === requested)) setSection(requested);
  }, [requested]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return SECTIONS.flatMap((sec) => sec.index
      .filter(([, label, kw]) => `${label} ${kw ?? ''} ${sec.label}`.toLowerCase().includes(q))
      .map(([id, label]) => ({ section: sec, id, label })))
      .slice(0, 12);
  }, [query]);

  // Scroll to and flash a setting picked from search.
  useEffect(() => {
    if (!highlight) return;
    const t = setTimeout(() => {
      const el = content.current?.querySelector<HTMLElement>(`[data-setting="${highlight}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.backgroundColor = 'var(--accent-soft)';
      el.style.boxShadow = '0 0 0 8px var(--accent-soft)';
      setTimeout(() => {
        el.style.backgroundColor = '';
        el.style.boxShadow = '';
      }, 1400);
      setHighlight(null);
    }, 80);
    return () => clearTimeout(t);
  }, [highlight, section]);

  if (!settings) return null;
  const current = SECTIONS.find((x) => x.id === section) ?? SECTIONS[0]!;
  const Section = current.component;

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="mx-auto flex min-h-0 w-full max-w-[1100px] flex-1 gap-10 px-[var(--page-x)]">
        <nav aria-label="Settings sections" className="flex w-[210px] shrink-0 flex-col">
          <h1 className="mb-4 font-serif text-[40px] leading-none">Settings</h1>
          <div className="relative mb-4">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search settings" aria-label="Search settings"
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery('');
                if (e.key === 'Enter' && results[0]) {
                  setSection(results[0].section.id);
                  setHighlight(results[0].id);
                  setQuery('');
                }
              }}
              className="h-9 w-full rounded-lg border border-line-strong bg-raised pr-8 pl-8 text-sm shadow-sm outline-none placeholder:text-ink-3 focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]" />
            {query && <button aria-label="Clear search" onClick={() => setQuery('')} className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-ink-3 hover:text-ink"><X className="size-3.5" /></button>}
          </div>

          <div className="min-h-0 flex-1 overflow-auto pb-8">
            {query.trim().length >= 2 ? (
              <ul className="space-y-0.5 animate-rise">
                {results.length === 0 && <li className="px-2.5 py-2 text-[13px] text-ink-3">No settings match “{query}”.</li>}
                {results.map((r) => (
                  <li key={`${r.section.id}-${r.id}`}>
                    <button onClick={() => { setSection(r.section.id); setHighlight(r.id); setQuery(''); }} className="w-full rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-hover">
                      <span className="block text-[13px] font-semibold text-ink">{r.label}</span>
                      <span className="block text-xs text-ink-3">{r.section.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : GROUPS.map((group) => (
              <div key={group} className="mb-3">
                <div className="px-2.5 pb-1 text-[11px] font-semibold tracking-[0.08em] text-ink-3 uppercase">{group}</div>
                <ul className="space-y-0.5">
                  {SECTIONS.filter((x) => x.group === group).map((x) => (
                    <li key={x.id}>
                      <button onClick={() => setSection(x.id)} aria-current={section === x.id ? 'page' : undefined}
                        className={cn('flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm font-semibold transition-colors [&_svg]:size-4',
                          section === x.id ? 'bg-raised text-ink shadow-sm ring-1 ring-line' : 'text-ink-3 hover:bg-hover hover:text-ink')}>
                        <span className={section === x.id ? 'text-accent' : ''}>{x.icon}</span>
                        {x.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <div className="mt-2 flex items-center gap-2 px-2.5 text-xs text-ink-3"><Monitor className="size-3.5" /> Changes save instantly.</div>
          </div>
        </nav>

        <div ref={content} className="min-h-0 flex-1 overflow-auto pt-[56px] pb-16" key={section}>
          <div className="animate-rise">
            <h2 className="mb-6 text-2xl font-semibold tracking-tight">{current.label}</h2>
            <Section s={settings} set={update} />
          </div>
        </div>
      </div>
    </div>
  );
}
