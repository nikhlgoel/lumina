import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Lock, RotateCw, SkipForward } from 'lucide-react';
import type { HostChallenge } from '@shared/types';
import { call, on } from '@/lib/bridge';
import { cn } from '@/lib/cn';
import { Button } from './ui';

/**
 * "Quick check": a file host's download page that needs a person, shown inside Lumina.
 *
 * The page itself is a real, sandboxed browser window the main process lays exactly over the frame below; it keeps its cookies and state,
 * and Lumina carries on clicking through and closes this the moment the download starts. The screen is built around that one thing: a
 * headline that says what to do, the live check in the middle with a soft ring that says where, and nothing else competing with it.
 */
export function QuickCheck() {
  const [challenge, setChallenge] = useState<HostChallenge | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLElement>(null);

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
    // The frame can move without changing size (the pop-up grows around it when the line about other files appears), so watch the card too.
    const ro = new ResizeObserver(report);
    ro.observe(el);
    if (card.current) ro.observe(card.current);
    addEventListener('resize', report);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      removeEventListener('resize', report);
    };
  }, [challenge?.id, challenge?.reason]);

  if (!challenge) return null;
  const act = (action: 'reload' | 'skip' | 'skip-all') => void call('hosts:challenge-action', { id: challenge.id, action }).catch(() => undefined);
  // A check is a small box: a small frame puts it right in front of the eye. A page that needs a button pressed needs room to be read.
  const isCheck = challenge.reason === 'captcha';
  let shownHost = challenge.host;
  try {
    shownHost = new URL(challenge.url).host;
  } catch {
    // keep the plain host
  }
  const more = challenge.waiting;

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center p-6" role="dialog" aria-modal="true" aria-label="Quick check">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" />
      <section
        ref={card}
        className={cn(
          'relative flex flex-col overflow-hidden rounded-3xl border border-line bg-overlay shadow-[0_28px_70px_-24px_rgb(0_0_0/0.6)]',
          isCheck ? 'w-[min(580px,94vw)]' : 'h-[min(720px,92vh)] w-[min(900px,94vw)]',
        )}
      >
        <header className="flex items-center gap-2 px-6 pt-5 text-[12px] text-ink-3">
          <Lock className="size-3.5 text-success" aria-hidden />
          <span className="min-w-0 truncate font-medium" data-selectable>{shownHost}</span>
          <button
            onClick={() => act('reload')}
            aria-label="Reload the page"
            className="ml-auto grid size-7 place-items-center rounded-md text-ink-3 outline-none transition-colors hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
          >
            <RotateCw className="size-3.5" />
          </button>
        </header>

        <div className="px-6 pt-1 text-center">
          <h2 className="text-[22px] font-semibold tracking-tight">{isCheck ? 'Tick the box to continue' : 'Press the button to continue'}</h2>
          <p className="mx-auto mt-1 max-w-full truncate text-[13px] text-ink-2" title={challenge.label} data-selectable>{challenge.label}</p>
        </div>

        <div className={cn('grid min-h-0 place-items-center px-6 py-5', !isCheck && 'flex-1')}>
          <div className={cn('relative w-full', isCheck ? 'max-w-[500px]' : 'h-full')}>
            {/* The ring says where to look; it breathes a little, and stops for anyone who has asked for less motion. */}
            <div aria-hidden className="pointer-events-none absolute -inset-1.5 rounded-[12px] ring-2 ring-accent/55 motion-safe:animate-pulse" />
            <div
              ref={frame}
              className={cn('relative w-full overflow-hidden rounded-md bg-white shadow-[inset_0_0_0_1px_rgb(0_0_0/0.1)]', isCheck ? 'h-[300px]' : 'h-full')}
            >
              <div className="absolute inset-0 grid place-items-center">
                <span className="inline-flex items-center gap-2 text-sm text-neutral-500">
                  <RotateCw className="size-4 animate-spin" /> Opening the page…
                </span>
              </div>
            </div>
          </div>
        </div>

        {isCheck && more > 0 && (
          <p className="px-6 pb-1 text-center text-[13px] text-ink-2">
            Once is enough: the other {more} file{more === 1 ? '' : 's'} from this site should carry on by themselves.
          </p>
        )}

        <footer className="flex items-center gap-2 px-6 pb-5 pt-3">
          <span className="inline-flex size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
          <p className="mr-auto min-w-0 truncate text-[12px] text-ink-3" title={challenge.stage} aria-live="polite">{challenge.stage}</p>
          {more > 0 && (
            <Button variant="ghost" size="sm" icon={<SkipForward className="size-3.5" />} onClick={() => act('skip-all')}>
              Skip all {more + 1}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => act('skip')}>Skip this file</Button>
        </footer>
      </section>
    </div>
  );
}
