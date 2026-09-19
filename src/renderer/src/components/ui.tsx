import { forwardRef, useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { LoaderCircle, X } from 'lucide-react';
import { cn } from '@/lib/cn';

/* ---------- Button ---------- */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink shadow-sm hover:brightness-[1.06] active:brightness-95',
  secondary: 'bg-raised text-ink border border-line-strong shadow-sm hover:bg-hover active:bg-press',
  ghost: 'text-ink-2 hover:bg-hover hover:text-ink active:bg-press',
  danger: 'text-danger hover:bg-danger/10 active:bg-danger/15',
};
const sizes: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-[13px] gap-1.5 rounded-md',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-5 text-[15px] gap-2 rounded-xl',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-semibold whitespace-nowrap select-none',
        'transition-[background-color,filter,transform,color] duration-150 ease-out-soft active:scale-[0.98]',
        'disabled:pointer-events-none disabled:opacity-45',
        variants[variant], sizes[size], className,
      )}
      {...rest}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: 'sm' | 'md';
  active?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = 'md', active, className, children, ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-lg text-ink-3 transition-[background-color,color,transform] duration-150',
        'hover:bg-hover hover:text-ink active:scale-95 active:bg-press disabled:pointer-events-none disabled:opacity-40',
        active && 'text-accent hover:text-accent',
        size === 'sm' ? 'size-7 [&_svg]:size-4' : 'size-9 [&_svg]:size-[18px]',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

/* ---------- Switch ---------- */

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-[22px] w-[38px] shrink-0 rounded-full border transition-colors duration-200 disabled:opacity-45',
        checked ? 'border-transparent bg-accent' : 'border-line-strong bg-sunken',
      )}
    >
      <span
        className={cn(
          'absolute top-1/2 left-[2px] size-4 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.3)] transition-transform duration-200 ease-out-soft',
          checked && 'translate-x-4',
        )}
      />
    </button>
  );
}

/* ---------- Segmented control ---------- */

interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  hint?: string;
}

export function Segmented<T extends string>({ value, onChange, options, label, size = 'md', className }: {
  value: T; onChange: (v: T) => void; options: SegmentOption<T>[]; label: string; size?: 'sm' | 'md'; className?: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const el = refs.current[value];
    if (el) setThumb({ left: el.offsetLeft, width: el.offsetWidth });
  }, [value, options.length]);

  return (
    <div role="radiogroup" aria-label={label} className={cn('relative inline-flex rounded-lg border border-line bg-sunken p-0.5', className)}>
      {thumb && (
        <span
          className="absolute top-0.5 bottom-0.5 rounded-md bg-raised shadow-sm transition-[left,width] duration-250 ease-out-soft"
          style={{ left: thumb.left, width: thumb.width }}
        />
      )}
      {options.map((o) => (
        <button
          key={o.value}
          ref={(el) => { refs.current[o.value] = el; }}
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          title={o.hint}
          onClick={() => onChange(o.value)}
          className={cn(
            'relative z-10 rounded-md font-semibold whitespace-nowrap transition-colors duration-150 disabled:opacity-35',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-[13px]',
            value === o.value ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Progress ---------- */

/**
 * A progress bar that reads as progress.
 *
 * The fill carries a light-to-dark ramp anchored to the *track*, not to itself, so the colour
 * deepens as the bar advances: a glance at the shade says roughly how far along it is, without
 * reading the number. Early progress is pale and tentative; finishing is full strength.
 *
 * `indeterminate` is for when nothing is known yet, and nothing else. A looping bar shown over
 * real progress reads as "stuck", which is the opposite of what it is there to say.
 */
export function ProgressBar({ value, tone = 'accent', indeterminate, className }: { value: number; tone?: 'accent' | 'success' | 'danger' | 'muted'; indeterminate?: boolean; className?: string }) {
  const color = { accent: 'var(--accent)', success: 'var(--success)', danger: 'var(--danger)', muted: 'var(--ink-3)' }[tone];
  const pct = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  // The ramp is drawn at the width of the whole track and then clipped to `pct` by its parent —
  // which is what ties the visible shade to how far along the bar is rather than to its own length.
  const rampWidth = pct > 0.5 ? (100 / pct) * 100 : 100;
  return (
    <div className={cn('relative h-1.5 overflow-hidden rounded-full bg-sunken', className)} role="progressbar" aria-valuenow={indeterminate ? undefined : Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      {indeterminate ? (
        <span className="absolute inset-y-0 w-2/5 rounded-full" style={{ background: color, animation: 'indeterminate 1.3s var(--ease) infinite' }} />
      ) : (
        <span className="absolute inset-y-0 left-0 overflow-hidden rounded-full transition-[width] duration-300 ease-out" style={{ width: `${pct}%` }}>
          <span
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ width: `${rampWidth}%`, background: `linear-gradient(90deg, color-mix(in oklab, ${color} 40%, transparent), ${color})` }}
          />
        </span>
      )}
    </div>
  );
}

/* ---------- Badge ---------- */

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'; className?: string }) {
  const tones = {
    neutral: 'bg-sunken text-ink-2 border-line',
    accent: 'bg-accent-soft text-accent border-transparent',
    success: 'bg-success/12 text-success border-transparent',
    warning: 'bg-warning/12 text-warning border-transparent',
    danger: 'bg-danger/12 text-danger border-transparent',
  };
  return <span className={cn('inline-flex h-5 items-center gap-1 rounded-md border px-1.5 text-[11px] font-semibold tracking-wide whitespace-nowrap', tones[tone], className)}>{children}</span>;
}

/* ---------- Field row (settings) ---------- */

export function Field({ label, description, children, htmlFor }: { label: string; description?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3.5">
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="block text-sm font-semibold text-ink">{label}</label>
        {description && <p className="mt-0.5 text-[13px] leading-relaxed text-ink-3">{description}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

/* ---------- Select ---------- */

export function Select<T extends string>({ value, onChange, options, label, className }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string; className?: string;
}) {
  const id = useId();
  return (
    <select
      id={id}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={cn('h-9 rounded-lg border border-line-strong bg-raised px-2.5 pr-8 text-sm font-medium text-ink shadow-sm outline-none transition-colors hover:bg-hover focus-visible:border-accent', className)}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/* ---------- Sheet / dialog ---------- */

export function Dialog({ open, onClose, title, children, footer, width = 520 }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; width?: number;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const restore = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restore.current = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => panel.current?.querySelector<HTMLElement>('input,button,select,textarea')?.focus(), 30);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      removeEventListener('keydown', onKey);
      restore.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    // Safe centring: a panel taller than the viewport overflows downward only, so its header and
    // first field stay reachable. Plain centring splits the overflow and cuts the title off.
    <div className="fixed inset-0 z-50 grid p-6 [justify-items:center] [align-items:safe_center]">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] animate-rise" onClick={onClose} />
      <div ref={panel} role="dialog" aria-modal="true" aria-label={title} style={{ width }} className="relative max-h-[86vh] max-w-full overflow-hidden rounded-2xl border border-line bg-overlay shadow-lg animate-rise flex flex-col">
        <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <IconButton label="Close" size="sm" onClick={onClose}><X /></IconButton>
        </header>
        <div className="min-h-0 overflow-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-line bg-panel px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

/* ---------- Empty state ---------- */

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center py-16 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-2xl border border-line bg-raised text-ink-3 shadow-sm [&_svg]:size-5">{icon}</div>
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {children && <p className="mt-1.5 text-sm leading-relaxed text-ink-3">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* ---------- Page header ---------- */

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-6">
      <div className="min-w-0">
        <h1 className="font-serif text-[40px] leading-none tracking-[-0.01em]">{title}</h1>
        {subtitle && <p className="mt-2 text-sm text-ink-3">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
