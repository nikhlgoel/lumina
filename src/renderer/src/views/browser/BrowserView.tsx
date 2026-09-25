import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Globe, Lock, RotateCw, ShieldCheck, ShieldOff, X } from 'lucide-react';
import type { BrowserState, ShieldStatus } from '@shared/types';
import { call, on } from '@/lib/bridge';
import { cn } from '@/lib/cn';
import { useApp } from '@/stores/app';

const isMac = window.lumina.platform === 'darwin';

/**
 * The in-app browser. A real Chromium view lives in the main process and is laid exactly over the frame
 * below (like the quick-check panel). The person browses here themselves, so logins and site checks work
 * as in any browser; downloads it starts are handed to Lumina's engine.
 */
export function BrowserView() {
  const [state, setState] = useState<BrowserState | null>(null);
  const [address, setAddress] = useState('');
  const [editing, setEditing] = useState(false);
  const [shields, setShields] = useState<ShieldStatus | null>(null);
  const [shieldOpen, setShieldOpen] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const mode = useApp((s) => s.mode);

  // The native browser view always paints above the renderer, so hide it whenever the player (or any
  // full-screen mode) is showing, and put it back when we return to the downloader.
  useEffect(() => {
    if (mode !== 'downloader') {
      void call('browser:hide').catch(() => undefined);
    } else if (frame.current) {
      const r = frame.current.getBoundingClientRect();
      void call('browser:show', { x: r.left, y: r.top, width: r.width, height: r.height }).catch(() => undefined);
    }
  }, [mode]);

  useEffect(() => on('browser:state', (s) => {
    setState(s);
    if (!editing) setAddress(s.url);
  }), [editing]);

  // The shield reports its own counts as they change, and once up front so the badge is right
  // even on a page that was already open when this view mounted.
  useEffect(() => on('browser:shield-state', setShields), []);
  useEffect(() => { void call('browser:shields').then(setShields).catch(() => undefined); }, []);

  /** Just the host, so the blocked list reads as names rather than tracking URLs. */
  const hostOf = (url: string) => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  };

  // Lay the native browser view over the frame, and keep it there through resizes/layout changes.
  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    let raf = 0;
    const report = (fn: 'browser:show' | 'browser:bounds') => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        void call(fn, { x: r.left, y: r.top, width: r.width, height: r.height }).catch(() => undefined);
      });
    };
    report('browser:show');
    const ro = new ResizeObserver(() => report('browser:bounds'));
    ro.observe(el);
    addEventListener('resize', () => report('browser:bounds'));
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      void call('browser:hide').catch(() => undefined);
    };
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setEditing(false);
    void call('browser:go', { url: address }).catch(() => undefined);
  };

  const host = (() => {
    try {
      return new URL(state?.url ?? '').host;
    } catch {
      return '';
    }
  })();
  const secure = (state?.url ?? '').startsWith('https://');
  const blockedHere = (shields?.counts.ads ?? 0) + (shields?.counts.trackers ?? 0);

  return (
    <div className="flex h-full flex-col">
      <div className={cn('drag flex h-[var(--titlebar)] shrink-0 items-center gap-1.5 border-b border-line px-3', !isMac && 'pr-[150px]')}>
        <div className="no-drag flex flex-1 items-center gap-1.5">
          <NavBtn label="Back" disabled={!state?.canGoBack} onClick={() => call('browser:back')}><ArrowLeft /></NavBtn>
          <NavBtn label="Forward" disabled={!state?.canGoForward} onClick={() => call('browser:forward')}><ArrowRight /></NavBtn>
          <NavBtn label={state?.loading ? 'Stop' : 'Reload'} onClick={() => call(state?.loading ? 'browser:stop' : 'browser:reload')}>
            {state?.loading ? <X /> : <RotateCw />}
          </NavBtn>
          <form onSubmit={submit} className="group relative flex-1">
            {host ? <Lock className={cn('pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2', secure ? 'text-success' : 'text-ink-3')} />
              : <Globe className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-ink-3" />}
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onFocus={(e) => { setEditing(true); e.target.select(); }}
              onBlur={() => setEditing(false)}
              placeholder="Search or enter a web address"
              aria-label="Address bar"
              spellCheck={false}
              className="h-9 w-full rounded-lg border border-line bg-sunken pr-3 pl-9 text-[13px] outline-none transition-colors placeholder:text-ink-3 focus:border-accent focus:bg-raised"
            />
          </form>

          {/* The shield. The count is the point: a blocker that cannot show its work is asking to
              be taken on trust, and the first thing anyone does when a page breaks is look for the
              switch that turns it off for this site. */}
          <div className="relative">
            <button
              onClick={() => setShieldOpen((v) => !v)}
              aria-label={`Shield — ${blockedHere} blocked on this page`}
              aria-haspopup="dialog"
              aria-expanded={shieldOpen}
              title={shields && !shields.siteEnabled ? 'Shield off for this site' : `${blockedHere} blocked on this page`}
              className={cn(
                'relative grid size-9 place-items-center rounded-lg transition-colors hover:bg-raised',
                shields?.enabled && shields.siteEnabled ? 'text-accent' : 'text-ink-3',
              )}
            >
              {shields?.enabled && shields.siteEnabled ? <ShieldCheck className="size-[18px]" /> : <ShieldOff className="size-[18px]" />}
              {blockedHere > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-accent px-1 text-[10px] leading-4 font-semibold text-accent-ink tabular">
                  {blockedHere > 99 ? '99+' : blockedHere}
                </span>
              )}
            </button>

            {shieldOpen && (
              <div role="dialog" aria-label="Shield" className="absolute top-11 right-0 z-30 w-72 rounded-xl border border-line bg-panel p-3 shadow-xl">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-semibold">{shields?.hostname ?? 'This page'}</span>
                  <button
                    role="switch"
                    aria-checked={shields?.siteEnabled ?? true}
                    aria-label="Shield for this site"
                    onClick={() => void call('browser:shields-site', { enabled: !(shields?.siteEnabled ?? true) }).catch(() => undefined)}
                    className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors', shields?.siteEnabled ? 'bg-accent' : 'bg-white/15')}
                  >
                    <span className={cn('absolute top-0.5 size-4 rounded-full bg-white transition-all', shields?.siteEnabled ? 'left-[18px]' : 'left-0.5')} />
                  </button>
                </div>

                <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-sunken py-2">
                    <dd className="text-base font-semibold tabular">{shields?.counts.ads ?? 0}</dd>
                    <dt className="text-[11px] text-ink-3">Ads</dt>
                  </div>
                  <div className="rounded-lg bg-sunken py-2">
                    <dd className="text-base font-semibold tabular">{shields?.counts.trackers ?? 0}</dd>
                    <dt className="text-[11px] text-ink-3">Trackers</dt>
                  </div>
                  <div className="rounded-lg bg-sunken py-2">
                    <dd className="text-base font-semibold tabular">{shields?.counts.upgraded ?? 0}</dd>
                    <dt className="text-[11px] text-ink-3">Upgraded</dt>
                  </div>
                </dl>

                {/* Said plainly rather than implied by a green tick. */}
                <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
                  {shields?.enabled
                    ? `${(shields.ruleCount ?? 0).toLocaleString()} rules loaded. Blocked before the request leaves your computer.`
                    : 'The shield is switched off in Settings.'}
                </p>

                {shields && shields.recent.length > 0 && (
                  <ul className="mt-2 max-h-28 overflow-auto border-t border-line pt-2 text-[11px] text-ink-3">
                    {shields.recent.slice(0, 8).map((r, i) => (
                      <li key={`${r.url}-${i}`} className="truncate" title={`${r.url} — matched ${r.rule}`}>{hostOf(r.url)}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {/* The native browser view is placed exactly over this region. */}
      <div ref={frame} className="min-h-0 flex-1 bg-white" />
    </div>
  );
}

function NavBtn({ children, label, onClick, disabled }: { children: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-hover hover:text-ink disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-[18px]"
    >
      {children}
    </button>
  );
}
