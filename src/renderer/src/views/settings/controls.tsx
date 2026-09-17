import { useEffect, useState, type ReactNode } from 'react';
import { Check, FolderOpen, Keyboard } from 'lucide-react';
import type { Settings, SettingsPatch } from '@shared/settings';
import { call } from '@/lib/bridge';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui';

export interface SectionProps {
  s: Settings;
  set: (patch: SettingsPatch) => Promise<void>;
}

export function Group({ title, description, children, action }: { title?: string; description?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="mb-8">
      {(title || action) && (
        <div className="mb-2 flex items-end justify-between gap-4">
          <div>
            {title && <h2 className="text-xs font-semibold tracking-[0.08em] text-ink-3 uppercase">{title}</h2>}
            {description && <p className="mt-1 max-w-[62ch] text-[13px] leading-relaxed text-ink-3">{description}</p>}
          </div>
          {action}
        </div>
      )}
      <div className="divide-y divide-line rounded-xl border border-line bg-panel px-4 shadow-sm">{children}</div>
    </section>
  );
}

/** One setting. `id` lets settings search scroll to and highlight it. */
export function Row({ id, label, description, children, stacked }: { id?: string; label: ReactNode; description?: ReactNode; children?: ReactNode; stacked?: boolean }) {
  return (
    <div data-setting={id} className={cn('rounded-lg transition-[background-color,box-shadow] duration-700', stacked ? 'py-[var(--row-y)]' : 'flex items-center justify-between gap-6 py-[var(--row-y)]')}>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-ink">{label}</div>
        {description && <div className="mt-0.5 text-[13px] leading-relaxed text-ink-3">{description}</div>}
      </div>
      {children && <div className={cn('flex items-center gap-2', stacked ? 'mt-3' : 'shrink-0')}>{children}</div>}
    </div>
  );
}

const inputClass = 'h-9 rounded-lg border border-line-strong bg-raised px-3 text-sm text-ink shadow-sm outline-none transition-[border-color,box-shadow] placeholder:text-ink-3 focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]';

export function NumberInput({ value, onCommit, suffix, step = 1, min, max, width = 'w-24' }: {
  value: number; onCommit: (v: number) => void; suffix?: string; step?: number; min?: number; max?: number; width?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    let n = Number(draft);
    if (!Number.isFinite(n) || draft.trim() === '') return setDraft(String(value));
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    setDraft(String(n));
    if (n !== value) onCommit(n);
  };
  return (
    <span className="flex items-center gap-2">
      <input type="number" step={step} min={min} max={max} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()}
        className={cn(inputClass, width, 'px-2.5 text-right tabular')} />
      {suffix && <span className="text-xs text-ink-3">{suffix}</span>}
    </span>
  );
}

export function TextInput({ value, onCommit, placeholder, width = 'w-64', mono, validate }: {
  value: string; onCommit: (v: string) => void; placeholder?: string; width?: string; mono?: boolean; validate?: (v: string) => string | null;
}) {
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(false);
  useEffect(() => setDraft(value), [value]);
  const error = validate ? validate(draft) : null;
  const commit = () => {
    if (error || draft.trim() === value) return;
    onCommit(draft.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 1400);
  };
  return (
    <span className="flex flex-col items-end gap-1">
      <span className="relative flex items-center">
        <input value={draft} placeholder={placeholder} spellCheck={false} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()}
          className={cn(inputClass, width, mono && 'font-mono text-[13px]', error && 'border-danger focus:border-danger')} />
        {saved && <Check className="absolute right-2.5 size-4 text-success animate-pop" />}
      </span>
      {error && <span className="max-w-72 text-right text-xs text-danger">{error}</span>}
    </span>
  );
}

export function TimeInput({ value, onCommit, label }: { value: string; onCommit: (v: string) => void; label: string }) {
  return <input type="time" aria-label={label} value={value} onChange={(e) => e.target.value && onCommit(e.target.value)} className={cn(inputClass, 'w-[110px] px-2 tabular')} />;
}

export function FolderRow({ id, label, value, onPick, description }: { id?: string; label: string; value: string; onPick: (dir: string) => void; description?: string }) {
  return (
    <Row id={id} label={label} description={<><span className="break-all" data-selectable>{value}</span>{description && <span className="block">{description}</span>}</>}>
      <Button size="sm" icon={<FolderOpen className="size-3.5" />} onClick={async () => { const d = await call('dialog:pick-folder', { title: label }); if (d) onPick(d); }}>Change</Button>
    </Row>
  );
}

/** Multi-select pills (e.g. SponsorBlock categories). */
export function Chips<T extends string>({ value, options, onChange, label }: { value: T[]; options: { value: T; label: string }[]; onChange: (v: T[]) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button key={o.value} aria-pressed={on} onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
            className={cn('h-7 rounded-full border px-3 text-xs font-semibold transition-colors active:scale-[0.97]', on ? 'border-accent bg-accent-soft text-accent' : 'border-line-strong text-ink-3 hover:bg-hover hover:text-ink')}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const KEY_NAMES: Record<string, string> = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Escape: 'Esc' };

/** Records a key combination and returns an Electron accelerator string. */
export function ShortcutInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [recording, setRecording] = useState(false);
  const pretty = (acc: string) => acc.replace('CommandOrControl', window.lumina.platform === 'darwin' ? '⌘' : 'Ctrl').split('+').join(' + ');
  return (
    <button
      onClick={() => setRecording(true)}
      onBlur={() => setRecording(false)}
      onKeyDown={(e) => {
        if (!recording) return;
        e.preventDefault();
        if (e.key === 'Escape') return setRecording(false);
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
        const mods = [(e.ctrlKey || e.metaKey) && 'CommandOrControl', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean) as string[];
        if (!mods.length) return; // global shortcuts need a modifier
        const key = KEY_NAMES[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
        onCommit([...mods, key].join('+'));
        setRecording(false);
      }}
      className={cn(inputClass, 'flex min-w-44 items-center gap-2 font-semibold', recording && 'border-accent shadow-[0_0_0_3px_var(--accent-soft)]')}
    >
      <Keyboard className="size-4 text-ink-3" />
      {recording ? <span className="text-accent">Press keys…</span> : <span className="tabular">{pretty(value)}</span>}
    </button>
  );
}
