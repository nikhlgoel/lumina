import type { ReactNode } from 'react';
import { ArrowUpRight, Bug, Check, Copy, Sparkles } from 'lucide-react';
import type { ToolName } from '@shared/types';
import { useApp } from '@/stores/app';
import { BrandMark, TitleBar } from '@/components/Shell';

const REPO_URL = 'https://github.com/nikhlgoel/lumina';
const ISSUES_URL = `${REPO_URL}/issues/new`;
const SITES_URL = 'https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md';

/** The projects Lumina is built on. Bundled command-line tools are annotated with their live version. */
const TECH: { name: string; role: string; tool?: ToolName; url: string }[] = [
  { name: 'yt-dlp', role: 'Finds and pulls media from 1,300+ sites', tool: 'yt-dlp', url: 'https://github.com/yt-dlp/yt-dlp' },
  { name: 'FFmpeg', role: 'Muxes, converts and re-encodes for any device', tool: 'ffmpeg', url: 'https://ffmpeg.org' },
  { name: 'aria2', role: 'Multi-connection engine for fast, resumable downloads', tool: 'aria2c', url: 'https://aria2.github.io' },
  { name: '7-Zip', role: 'Unpacks split archives and verifies them', tool: '7z', url: 'https://www.7-zip.org' },
  { name: 'whisper.cpp', role: 'Generates subtitles on your own machine', tool: 'whisper-cli', url: 'https://github.com/ggml-org/whisper.cpp' },
  { name: 'Electron', role: 'The cross-platform desktop shell', url: 'https://electronjs.org' },
  { name: 'React', role: 'The interface you are looking at', url: 'https://react.dev' },
  { name: 'Vite', role: 'Builds and bundles the app', url: 'https://vite.dev' },
  { name: 'Tailwind CSS', role: 'The styling system', url: 'https://tailwindcss.com' },
  { name: 'Lucide', role: 'The icon set', url: 'https://lucide.dev' },
];

const CAN_DO = [
  'Download video and music from 1,300+ sites at the best available quality',
  'Match Spotify playlists to sources and grab whole playlists at once',
  'Handle direct files, file-host download pages (with an in-app quick check) and torrents',
  'Download multi-part repacks together, then unpack and checksum-verify them',
  'Re-encode to a TV-safe format and generate subtitles locally',
  'Play everything back with a built-in player, lyrics and a library',
];

const NEXT = [
  'Wider file-host coverage and smarter page handling',
  'Scheduled and bandwidth-limited downloads',
  'Polished packaging and auto-update on macOS and Linux',
  'A richer library: smart playlists and better metadata editing',
];

function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.05-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.49 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.95 0-1.31.47-2.39 1.24-3.23-.12-.31-.54-1.53.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.24 2.87.12 3.18.77.84 1.23 1.92 1.23 3.23 0 4.62-2.81 5.64-5.49 5.94.43.37.81 1.1.81 2.22 0 1.61-.01 2.9-.01 3.29 0 .32.22.7.83.58C20.56 22.29 24 17.79 24 12.5 24 5.87 18.63.5 12 .5Z" />
    </svg>
  );
}

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-panel p-5 ${className ?? ''}`}>{children}</div>;
}

export function AboutView() {
  const info = useApp((s) => s.info);
  const tools = useApp((s) => s.tools);
  const toast = useApp((s) => s.toast);
  const versionOf = (name?: ToolName) => (name ? tools.find((t) => t.name === name && t.ok)?.version ?? null : null);

  const copyDiagnostics = async () => {
    const lines = [
      `Lumina ${info?.version ?? '?'} · ${info?.platform ?? '?'}${info?.isPackaged === false ? ' (dev)' : ''}`,
      `Tools: ${tools.map((t) => `${t.name} ${t.ok ? (t.version ?? 'ok') : 'MISSING'}`).join(', ')}`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      toast('Diagnostics copied — paste them into your bug report', 'success');
    } catch {
      toast('Couldn’t copy to the clipboard', 'error');
    }
  };

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-[980px] px-8 pb-20">
          {/* Hero */}
          <div className="flex flex-wrap items-center gap-5 pt-2 pb-8">
            <BrandMark className="size-16 shrink-0 drop-shadow-[0_6px_16px_rgb(232_117_47/0.35)]" />
            <div className="min-w-0">
              <h1 className="font-serif text-[44px] leading-none tracking-[-0.01em]">Lumina</h1>
              <p className="mt-2 text-sm text-ink-3">
                A free, open-source download assistant and player{info?.version ? <> · v{info.version}</> : null}
              </p>
            </div>
          </div>

          <p className="max-w-[64ch] text-[15px] leading-relaxed text-ink-2">
            Lumina brings anything worth keeping down to your machine — one link, the best quality, no paywalls or
            speed caps. It picks the right sources and formats for you, so downloading stays simple even when the
            web makes it complicated.
          </p>
          <a
            href={SITES_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-accent transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-accent rounded outline-none"
          >
            See every site Lumina can download from
            <ArrowUpRight className="size-4" />
          </a>

          {/* Capabilities */}
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            <Card>
              <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
                <span className="grid size-6 place-items-center rounded-md bg-success/12 text-success"><Check className="size-4" /></span>
                What Lumina does today
              </h2>
              <ul className="mt-3.5 space-y-2.5">
                {CAN_DO.map((item) => (
                  <li key={item} className="flex gap-2.5 text-[13px] leading-relaxed text-ink-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-success" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card>
              <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
                <span className="grid size-6 place-items-center rounded-md bg-accent-soft text-accent"><Sparkles className="size-4" /></span>
                What we’re working on next
              </h2>
              <ul className="mt-3.5 space-y-2.5">
                {NEXT.map((item) => (
                  <li key={item} className="flex gap-2.5 text-[13px] leading-relaxed text-ink-2">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent/70" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          {/* Open-source credits */}
          <div className="mt-10">
            <h2 className="font-serif text-[26px] tracking-tight">Standing on open source</h2>
            <p className="mt-2 max-w-[64ch] text-sm leading-relaxed text-ink-3">
              Lumina exists because of the projects below — battle-tested, freely given, and doing the heavy lifting.
              Our thanks to everyone who builds and maintains them.
            </p>
            <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
              {TECH.map((t) => {
                const version = versionOf(t.tool);
                return (
                  <a
                    key={t.name}
                    href={t.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group flex items-start gap-3 rounded-xl border border-line bg-panel px-4 py-3 transition-[background-color,border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-line-strong hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent outline-none"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-ink">{t.name}</span>
                        {version && <span className="rounded bg-sunken px-1.5 py-px font-mono text-[10px] text-ink-3">{version}</span>}
                      </div>
                      <p className="mt-0.5 text-[13px] leading-snug text-ink-3">{t.role}</p>
                    </div>
                    <ArrowUpRight className="size-4 shrink-0 text-ink-3 transition-colors group-hover:text-accent" />
                  </a>
                );
              })}
            </div>
          </div>

          {/* Contribute */}
          <div className="mt-10 overflow-hidden rounded-2xl border border-accent/25 bg-accent-soft/50">
            <div className="flex flex-wrap items-center gap-5 p-6">
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-ink text-ink-inverse"><GithubMark className="size-6" /></span>
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-semibold tracking-tight">Lumina is open source — come build it with us</h2>
                <p className="mt-1 max-w-[60ch] text-[13px] leading-relaxed text-ink-2">
                  Found a bug, want a site supported, or have an idea? Open an issue or a pull request. Every
                  contribution helps keep Lumina free and fast for everyone.
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <button
                  onClick={copyDiagnostics}
                  className="inline-flex items-center gap-2 rounded-lg border border-line-strong bg-raised px-3.5 py-2.5 text-sm font-semibold text-ink transition-[background-color,transform] duration-150 hover:bg-hover active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-accent outline-none"
                >
                  <Copy className="size-4" /> Copy diagnostics
                </button>
                <a
                  href={ISSUES_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg border border-line-strong bg-raised px-3.5 py-2.5 text-sm font-semibold text-ink transition-[background-color,transform] duration-150 hover:bg-hover active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-accent outline-none"
                >
                  <Bug className="size-4" /> Report a bug
                </a>
                <a
                  href={REPO_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-ink-inverse transition-transform duration-150 hover:-translate-y-0.5 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ground outline-none"
                >
                  <GithubMark className="size-4" /> View the repository
                </a>
              </div>
            </div>
          </div>

          <p className="mt-8 text-center text-xs text-ink-3">
            Made with care · MIT licensed · Downloads are your responsibility — please respect creators and the law.
          </p>
        </div>
      </div>
    </div>
  );
}
