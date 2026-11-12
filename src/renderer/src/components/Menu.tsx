import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { IconButton } from './ui';

export interface MenuItem {
  key: string;
  label: string;
  /** A second, quieter line: what the choice will do. */
  hint?: string;
  icon?: ReactNode;
  /** A choice that cannot be taken back is drawn in the warning colour. */
  tone?: 'danger';
  disabled?: boolean;
  onSelect: () => void;
}

/** Close a menu on Escape, a press anywhere else (outside every box given), or the window losing focus. */
function useDismiss(open: boolean, close: () => void, inside: React.RefObject<HTMLElement | null>[]) {
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!inside.some((r) => r.current?.contains(e.target as Node))) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', close);
    };
    // `inside` is a fresh array each render; the refs in it are what matter
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, close]);
}

/** Up and Down move between the choices; Home and End jump to the ends. */
function arrowKeys(e: React.KeyboardEvent<HTMLElement>) {
  const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
  const at = items.indexOf(document.activeElement as HTMLButtonElement);
  const go = (n: number) => { e.preventDefault(); items[(n + items.length) % items.length]?.focus(); };
  if (e.key === 'ArrowDown') go(at + 1);
  else if (e.key === 'ArrowUp') go(at < 0 ? -1 : at - 1);
  else if (e.key === 'Home') go(0);
  else if (e.key === 'End') go(items.length - 1);
}

function Items({ items, close }: { items: MenuItem[]; close: () => void }) {
  return (
    <>
      {items.map((item) => (
        <button
          key={item.key}
          role="menuitem"
          disabled={item.disabled}
          onClick={() => { close(); item.onSelect(); }}
          className={cn(
            'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none transition-colors',
            'hover:bg-hover focus-visible:bg-hover disabled:cursor-default disabled:opacity-45',
            item.tone === 'danger' ? 'text-danger' : 'text-ink',
          )}
        >
          {item.icon && <span className="mt-0.5 shrink-0 [&_svg]:size-4">{item.icon}</span>}
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold leading-snug">{item.label}</span>
            {item.hint && <span className="block text-xs leading-snug text-ink-3">{item.hint}</span>}
          </span>
        </button>
      ))}
    </>
  );
}

const PANEL = 'z-50 min-w-[230px] max-w-[320px] rounded-xl border border-line bg-panel p-1 shadow-lg animate-rise';

/**
 * An icon button that opens a small menu right beside it. The menu is drawn on top of the page (not inside the card the button is in), so a
 * card with rounded, clipped corners cannot cut it off; it opens below the button, or above it when there is no room.
 */
export function PopoverMenu({ label, icon, items, className }: { label: string; icon: ReactNode; items: MenuItem[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  useDismiss(open, close, [box, panel]);
  useLayoutEffect(() => {
    if (!open || !box.current || !panel.current) return;
    const b = box.current.getBoundingClientRect();
    const { width, height } = panel.current.getBoundingClientRect();
    const below = b.bottom + 4 + height <= window.innerHeight - 8;
    setPos({
      left: Math.max(8, Math.min(b.right - width, window.innerWidth - width - 8)),
      top: below ? b.bottom + 4 : Math.max(8, b.top - 4 - height),
    });
  }, [open]);
  // Focus the first choice once the menu is shown (while it is measured it is hidden, and a hidden element cannot take focus).
  useEffect(() => {
    if (open && pos) panel.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [open, pos]);
  useEffect(() => {
    if (!open) return;
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);
  return (
    <div ref={box} className={cn('relative', className)}>
      <IconButton label={label} onClick={() => { setPos(null); setOpen(!open); }} aria-haspopup="menu" aria-expanded={open}>{icon}</IconButton>
      {open && createPortal(
        <div
          ref={panel}
          role="menu"
          aria-label={label}
          onKeyDown={arrowKeys}
          style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
          className={cn(PANEL, 'fixed')}
        >
          <Items items={items} close={close} />
        </div>,
        document.body,
      )}
    </div>
  );
}

/** A menu at the pointer (a right-click), kept inside the window. Render it while `at` is set; `onClose` clears it. */
export function ContextMenu({ at, items, onClose }: { at: { x: number; y: number }; items: MenuItem[]; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  useDismiss(true, onClose, [box]);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({ x: Math.max(8, Math.min(at.x, window.innerWidth - width - 8)), y: Math.max(8, Math.min(at.y, window.innerHeight - height - 8)) });
    el.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [at]);
  useEffect(() => {
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);
  return createPortal(
    <div ref={box} role="menu" onKeyDown={arrowKeys} onContextMenu={(e) => e.preventDefault()} style={{ left: pos.x, top: pos.y }} className={cn(PANEL, 'fixed')}>
      <Items items={items} close={onClose} />
    </div>,
    document.body,
  );
}
