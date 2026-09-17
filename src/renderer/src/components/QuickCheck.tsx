import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Lock, RotateCw, ShieldQuestion, SkipForward } from 'lucide-react';
import type { HostChallenge } from '@shared/types';
import { call, on } from '@/lib/bridge';
import { Badge, Button } from './ui';

/**
 * "Quick check": a file host's download page that needs a person (usually a captcha), shown inside Lumina
 * as a small browser. The page itself is a real, sandboxed browser window the main process lays exactly over
 * the frame below; it keeps its cookies and state, and Lumina carries on clicking through and closes this the
 * moment the download starts.
 */
export function QuickCheck() {
  const [challenge, setChallenge] = useState<HostChallenge | null>(null);
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void call('hosts:challenge-current').then((c) => c && setChallenge(c)).catch(() => undefined);
    const offShow = on('hosts:challenge', setChallenge);
    const offDone = on('hosts:challenge-done', ({ id }) => setChallenge((c) => (c?.id === id ? null : c)));
    return () => {
      offShow();
      offDone();
    };
  }, []);

  // Keep the page window glued to the frame through window resizes and layout changes.
  useLayoutEffect(() => {
    if (!challenge || !frame.current) return;
    const el = frame.current;
    let raf = 0;
    const report = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        void call('hosts:challenge-frame', { id: challenge.id, x: r.left, y: r.top, width: r.width, height: r.height }).catch(() => undefined);
      });
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    addEventListener('resize', report);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      removeEventListener('resize', report);
    };
  }, [challenge]);

  if (!challenge) return null;
  const act = (action: 'reload' | 'skip') => void call('hosts:challenge-action', { id: challenge.id, action }).catch(() => undefined);
  let shownHost = challenge.host;
  try {
    shownHost = new URL(challenge.url).host;
  } catch {
    // keep the plain host
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center p-6" role="dialog" aria-modal="true" aria-label="Quick check">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" />
      <section className="relative flex h-[min(780px,92vh)] w-[min(1000px,94vw)] flex-col overflow-hidden rounded-2xl border border-line bg-overlay shadow-[0_24px_60px_-20px_rgb(0_0_0/0.55)]">
        <header className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent"><ShieldQuestion className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] font-semibold tracking-tight">
              {challenge.reason === 'captcha' ? 'Finish the quick check' : 'This download page needs you'}
            </h2>
            <p className="truncate text-[13px] text-ink-2" data-selectable>
              <span className="font-medium text-ink">{challenge.label}</span>
            </p>
          </div>
          {challenge.waiting > 0 && <Badge tone="warning">{challenge.waiting} more waiting</Badge>}
        </header>

        <div className="border-b border-line bg-sunken/60 px-5 py-2.5 text-[13px] leading-relaxed text-ink-2">
          {challenge.reason === 'captcha' ? (
            <p>
              <span className="font-medium text-ink">{shownHost}</span> is asking you to prove you’re human
              {challenge.check ? <> with a <span className="font-medium text-ink">{challenge.check}</span></> : null}. Solve it below — tick
              the box or pick the images. Lumina does nothing but pass your answer to the site, then finishes the download for you.
            </p>
          ) : (
            <p>Lumina couldn’t finish this page by itself. Do what it asks below (usually a download button); Lumina catches the file and downloads it.</p>
          )}
        </div>

        {/* Address bar: makes it read as a small, trustworthy browser rather than a bare frame. */}
        <div className="flex items-center gap-2 border-b border-line bg-panel px-4 py-2">
          <Lock className="size-3.5 shrink-0 text-success" />
          <span className="min-w-0 flex-1 truncate rounded-md bg-sunken px-2.5 py-1 font-mono text-xs text-ink-2" data-selectable>{shownHost}</span>
          <button
            onClick={() => act('reload')}
            aria-label="Reload the page"
            className="grid size-7 place-items-center rounded-md text-ink-3 transition-colors hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent outline-none"
          >
            <RotateCw className="size-4" />
          </button>
        </div>

        {/* The download page is placed exactly over this frame by the main process. */}
        <div ref={frame} className="relative min-h-0 flex-1 bg-white">
          <div className="absolute inset-0 grid place-items-center">
            <span className="inline-flex items-center gap-2 text-sm text-neutral-500">
              <RotateCw className="size-4 animate-spin" /> Loading the download page…
            </span>
          </div>
        </div>

        <footer className="flex items-center gap-3 border-t border-line bg-panel px-5 py-3">
          <span className="inline-flex size-2 shrink-0 rounded-full bg-accent" />
          <p className="mr-auto min-w-0 truncate text-[13px] text-ink-2" title={challenge.stage}>{challenge.stage}</p>
          <Button variant="ghost" icon={<SkipForward className="size-4" />} onClick={() => act('skip')}>Skip this file</Button>
        </footer>
      </section>
    </div>
  );
}
