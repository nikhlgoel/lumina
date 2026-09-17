import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, FolderOpen, Globe, LogOut, Puzzle, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { ExtensionStatus, SiteAccountInfo, SpotifyStatus } from '@shared/ipc';
import { call, errorMessage, on } from '@/lib/bridge';
import { useApp } from '@/stores/app';
import { Badge, Button, Segmented, Select, Switch } from '@/components/ui';
import { FolderRow, Group, NumberInput, Row, TextInput, type SectionProps } from '../controls';

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button size="sm" variant="ghost" icon={done ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      onClick={() => { void navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}>
      {done ? 'Copied' : label}
    </Button>
  );
}

const relative = (ts: number) => {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
};

export function AccountsSection({ s, set }: SectionProps) {
  const toast = useApp((x) => x.toast);
  const [accounts, setAccounts] = useState<SiteAccountInfo[] | null>(null);
  const [spotify, setSpotify] = useState<SpotifyStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [site, setSite] = useState('');

  useEffect(() => {
    void call('accounts:list').then(setAccounts);
    void call('spotify:status').then(setSpotify);
  }, []);

  const run = async <T,>(key: string, fn: () => Promise<T>, done?: (v: T) => void) => {
    setBusy(key);
    try {
      done?.(await fn());
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  };

  const youtube = accounts?.find((a) => a.domain === 'youtube.com' || a.domain === 'google.com');
  const browserCookies = ['chrome', 'edge', 'brave'].includes(s.network.cookiesFrom);

  return (
    <>
      <Group title="Sign in for private and members-only media" description="Sign in once inside Lumina. Your password goes only to the site; Lumina keeps the session on this computer and uses it for downloads.">
        <Row id="youtubeAccount" label={<span className="flex items-center gap-2">YouTube {youtube && <Badge tone="success"><ShieldCheck className="size-3" /> Signed in</Badge>}</span>}
          description="For age-restricted, private, members-only videos and your own playlists. Also stops “confirm you’re not a bot” errors.">
          {youtube
            ? <Button size="sm" variant="ghost" icon={<LogOut className="size-3.5" />} loading={busy === 'yt-out'} onClick={() => run('yt-out', async () => { await call('accounts:sign-out', { domain: 'google.com' }); return call('accounts:sign-out', { domain: 'youtube.com' }); }, setAccounts)}>Sign out</Button>
            : <Button size="sm" variant="primary" loading={busy === 'yt'} onClick={() => run('yt', () => call('accounts:sign-in', { target: 'youtube' }), (a) => { setAccounts(a); if (a.some((x) => x.domain.endsWith('google.com') || x.domain.endsWith('youtube.com'))) toast('Signed in to YouTube', 'success'); })}>Sign in</Button>}
        </Row>
        {accounts?.filter((a) => !['youtube.com', 'google.com'].includes(a.domain)).map((a) => (
          <Row key={a.domain} label={<span className="flex items-center gap-2"><Globe className="size-4 text-ink-3" />{a.domain}</span>} description="Signed in">
            <Button size="sm" variant="ghost" icon={<LogOut className="size-3.5" />} loading={busy === a.domain} onClick={() => run(a.domain, () => call('accounts:sign-out', { domain: a.domain }), setAccounts)}>Sign out</Button>
          </Row>
        ))}
        <Row id="otherSite" label="Another site" description="Paste the site’s address, sign in, then close the window.">
          <input value={site} onChange={(e) => setSite(e.target.value)} placeholder="https://www.example.com" spellCheck={false}
            className="h-9 w-56 rounded-lg border border-line-strong bg-raised px-3 text-sm shadow-sm outline-none focus:border-accent" />
          <Button size="sm" disabled={!/^https:\/\/\S+\.\S+/.test(site.trim())} loading={busy === 'site'} onClick={() => run('site', () => call('accounts:sign-in', { target: site.trim() }), (a) => { setAccounts(a); setSite(''); })}>Sign in</Button>
        </Row>
      </Group>

      <Group title="Which sign-in to use">
        <Row id="cookiesFrom" label="Downloads use" description={
          browserCookies
            ? <span className="flex items-start gap-1 text-warning"><TriangleAlert className="mt-0.5 size-3.5 shrink-0" />Chrome, Edge and Brave lock and encrypt their cookies while running, so this often fails. Lumina retries without them, but signing in above is more reliable.</span>
            : s.network.cookiesFrom === 'file' ? <span data-selectable>{s.network.cookiesFile}</span> : undefined
        }>
          <Select label="Cookies source" value={s.network.cookiesFrom} onChange={(v) => set({ network: { cookiesFrom: v } })} options={[
            { value: 'lumina', label: 'Lumina sign-ins (recommended)' }, { value: 'none', label: 'No sign-in' }, { value: 'firefox', label: 'Firefox’s cookies' },
            { value: 'chrome', label: 'Chrome’s cookies' }, { value: 'edge', label: 'Edge’s cookies' }, { value: 'brave', label: 'Brave’s cookies' },
            { value: 'file', label: 'A cookies.txt file' },
          ]} />
        </Row>
        <Row id="cookiesFile" label="Import a cookies.txt file" description="Exported from a browser extension like “Get cookies.txt LOCALLY”.">
          <Button size="sm" loading={busy === 'import'} onClick={() => run('import', () => call('accounts:import-cookies'), (f) => f && toast('Cookies file imported', 'success'))}>Choose file</Button>
        </Row>
      </Group>

      <Group title="Spotify" description="Spotify doesn’t allow downloading its audio, so Lumina finds each song on YouTube Music. Connecting reads your playlists (including private ones and Liked Songs) and whole playlists beyond 100 songs.">
        <Row id="spotifyConnect" label={<span className="flex items-center gap-2">Spotify account {spotify?.connected && <Badge tone="success"><ShieldCheck className="size-3" /> {spotify.user ?? 'Connected'}</Badge>}</span>}
          description={spotify?.hasClientId ? 'Read-only access to your playlists and liked songs.' : 'Add a Client ID below first (a one-time, two-minute setup).'}>
          {spotify?.connected
            ? <Button size="sm" variant="ghost" icon={<LogOut className="size-3.5" />} onClick={() => run('sp-out', () => call('spotify:disconnect'), setSpotify)}>Disconnect</Button>
            : <Button size="sm" variant="primary" disabled={!s.accounts.spotifyClientId} loading={busy === 'sp'} onClick={() => run('sp', () => call('spotify:connect'), (st) => { setSpotify(st); toast('Spotify connected', 'success'); })}>Connect</Button>}
        </Row>
        <Row id="spotifyClientId" label="Client ID" stacked description={
          <ol className="mt-1 list-decimal space-y-1 pl-4">
            <li>Open the <a className="font-semibold text-accent underline-offset-2 hover:underline" href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">Spotify Developer Dashboard <ExternalLink className="inline size-3" /></a> and create an app (any name).</li>
            <li>Add this Redirect URI: <code className="rounded bg-sunken px-1.5 py-0.5 font-mono text-[12px] text-ink" data-selectable>{spotify?.redirectUri ?? 'http://127.0.0.1:43821/callback'}</code> {spotify && <CopyButton text={spotify.redirectUri} />}</li>
            <li>Tick “Web API”, save, and paste the Client ID here.</li>
          </ol>
        }>
          <TextInput mono width="w-[340px]" placeholder="32-character Client ID" value={s.accounts.spotifyClientId}
            validate={(v) => (v && !/^[0-9a-f]{32}$/.test(v.trim()) ? 'A Client ID is 32 letters and numbers.' : null)}
            onCommit={(v) => set({ accounts: { spotifyClientId: v } })} />
        </Row>
      </Group>
    </>
  );
}

export function ExtensionSection({ s, set }: SectionProps) {
  const e = s.extension;
  const toast = useApp((x) => x.toast);
  const [status, setStatus] = useState<ExtensionStatus | null>(null);

  useEffect(() => {
    void call('extension:status').then(setStatus);
    return on('extension:changed', setStatus);
  }, [e.enabled, e.port]);

  return (
    <>
      <Group title="Browser extension" description="Catches downloads you start in your browser and finds videos and streams playing on any page, including ones Lumina can’t open from a link alone.">
        <Row id="extEnabled" label="Allow the extension to connect" description={e.enabled ? `Listening only on this computer (127.0.0.1:${e.port}).` : 'The extension can’t reach Lumina while this is off.'}>
          <Switch label="Extension bridge" checked={e.enabled} onChange={(v) => set({ extension: { enabled: v } })} />
        </Row>
        <Row id="extCapture" label="Take over browser downloads" description="Downloads you start in the browser go to Lumina instead, with multi-connection speed and resume.">
          <Switch label="Capture downloads" checked={e.captureDownloads} onChange={(v) => set({ extension: { captureDownloads: v } })} />
        </Row>
        <Row id="extMode" label="When the browser starts a download" description={e.browserDownloads === 'auto'
          ? 'Starts right away in the background. If Lumina can’t fetch a file (sign-in pages, one-time links), the browser finishes it as usual.'
          : 'Opens Lumina so you can choose where and how to save it.'}>
          <Segmented label="Browser download mode" value={e.browserDownloads} onChange={(v) => set({ extension: { browserDownloads: v } })} options={[{ value: 'auto', label: 'Download it' }, { value: 'ask', label: 'Ask me' }]} />
        </Row>
        <FolderRow id="extSaveDir" label="Save browser downloads to" value={e.saveDir || 'Your Downloads folder'} onPick={(d) => set({ extension: { saveDir: d } })} />
        <Row id="extMinSize" label="Leave small files to the browser" description={e.minCaptureSizeMb ? `Files under ${e.minCaptureSizeMb} MB download normally.` : 'Lumina takes every download, whatever the size.'}>
          <NumberInput value={e.minCaptureSizeMb} min={0} suffix="MB" onCommit={(v) => set({ extension: { minCaptureSizeMb: v } })} />
        </Row>
        <Row id="extSkipTypes" label="Always leave these file types to the browser" description="Separate with spaces, for example: torrent ics pkpass">
          <TextInput mono width="w-72" placeholder="none" value={e.skipExtensions.join(' ')}
            validate={(v) => (v.split(/[\s,]+/).filter(Boolean).some((x) => !/^\.?[a-z0-9]{1,10}$/i.test(x)) ? 'Use extensions like zip or .exe' : null)}
            onCommit={(v) => set({ extension: { skipExtensions: [...new Set(v.split(/[\s,]+/).filter(Boolean).map((x) => x.replace(/^\./, '').toLowerCase()))] } })} />
        </Row>
        <Row id="extSkipSites" label="Always leave these sites to the browser" description="For banking or work portals. Separate with spaces, for example: mybank.com">
          <TextInput mono width="w-72" placeholder="none" value={e.skipSites.join(' ')}
            onCommit={(v) => set({ extension: { skipSites: [...new Set(v.split(/[\s,]+/).filter(Boolean).map((x) => x.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase()))] } })} />
        </Row>
        <Row id="extPort" label="Port" description="Change only if another app uses this port, then set the same port in the extension.">
          <NumberInput value={e.port} min={1024} max={65535} onCommit={(v) => set({ extension: { port: v } })} />
        </Row>
      </Group>

      <Group title="Connected browsers">
        {status?.paired.length ? status.paired.map((p) => (
          <Row key={p.id} label={<span className="flex items-center gap-2"><Puzzle className="size-4 text-ink-3" />{p.browser}</span>} description={`Connected ${relative(p.createdAt)} · last used ${relative(p.lastUsedAt)}`}>
            <Button size="sm" variant="danger" onClick={async () => { setStatus(await call('extension:revoke', { id: p.id })); toast(`${p.browser} disconnected`); }}>Disconnect</Button>
          </Row>
        )) : (
          <Row label="No browsers connected yet" description="Install the extension, click its toolbar button, and choose Connect. Lumina will ask you to confirm." />
        )}
      </Group>

      <Group title="Install">
        <Row id="extChrome" label="Chrome, Edge, Brave, Opera" stacked description={
          <ol className="mt-1 list-decimal space-y-1 pl-4">
            <li>Open <code className="rounded bg-sunken px-1.5 py-0.5 font-mono text-[12px] text-ink" data-selectable>chrome://extensions</code> (or <code className="rounded bg-sunken px-1.5 py-0.5 font-mono text-[12px] text-ink">edge://extensions</code>) and turn on Developer mode.</li>
            <li>Choose “Load unpacked” and pick the Lumina extension folder.</li>
          </ol>
        }>
          <Button size="sm" icon={<FolderOpen className="size-3.5" />} onClick={() => void call('extension:open-folder').catch((err) => toast(errorMessage(err), 'error'))}>Open extension folder</Button>
          <CopyButton text="chrome://extensions" label="Copy address" />
        </Row>
        <Row id="extFirefox" label="Firefox" description="Open about:debugging, choose This Firefox › Load Temporary Add-on, and pick manifest.json in the extension folder." />
      </Group>
    </>
  );
}

export function NetworkSection({ s, set }: SectionProps) {
  const n = s.network;
  return (
    <Group title="Connection">
      <Row id="proxy" label="Proxy" description="For example socks5://127.0.0.1:1080 or http://user:pass@host:8080. Leave empty to connect directly.">
        <TextInput value={n.proxy} placeholder="None" mono validate={(v) => (v && !/^(https?|socks4a?|socks5h?):\/\/\S+$/i.test(v) ? 'Start with http://, https://, socks4:// or socks5://' : null)} onCommit={(v) => set({ network: { proxy: v } })} />
      </Row>
      <Row id="userAgent" label="Custom user agent" description="Leave empty unless a site blocks the default.">
        <TextInput value={n.userAgent} placeholder="Default" width="w-80" onCommit={(v) => set({ network: { userAgent: v } })} />
      </Row>
      <Row id="ipv4" label="Use IPv4 only" description="Fixes slow or failing downloads on some networks with broken IPv6.">
        <Switch label="Force IPv4" checked={n.forceIpv4} onChange={(v) => set({ network: { forceIpv4: v } })} />
      </Row>
    </Group>
  );
}
