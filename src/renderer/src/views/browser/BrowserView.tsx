import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Globe, Lock, RotateCw, X } from 'lucide-react';
import type { BrowserState } from '@shared/types';
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
