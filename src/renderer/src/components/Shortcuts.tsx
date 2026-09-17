import { useEffect, useState } from 'react';
import { Dialog } from './ui';

const mod = window.lumina.platform === 'darwin' ? '⌘' : 'Ctrl';

interface Shortcut {
  keys: string[];
  label: string;
}

const GROUPS: { title: string; items: Shortcut[] }[] = [
  {
    title: 'Getting around',
    items: [
      { keys: [mod, '1'], label: 'Download' },
      { keys: [mod, '2'], label: 'Queue' },
      { keys: [mod, '3'], label: 'Library' },
      { keys: [mod, ','], label: 'Settings' },
      { keys: ['?'], label: 'Show this cheat sheet' },
    ],
  },
  {
    title: 'Downloading',
    items: [
      { keys: [mod, 'L'], label: 'Jump to the link box' },
      { keys: [mod, 'V'], label: 'Paste a link (in the box)' },
    ],
  },
  {
    title: 'Player',
    items: [
      { keys: ['Space'], label: 'Play / pause' },
      { keys: ['←', '→'], label: 'Seek 5 seconds' },
      { keys: ['↑', '↓'], label: 'Volume' },
      { keys: ['M'], label: 'Mute' },
      { keys: ['N', 'P'], label: 'Next / previous' },
      { keys: ['L'], label: 'Lyrics' },
      { keys: ['C'], label: 'Subtitles (video)' },
      { keys: ['F'], label: 'Fullscreen' },
      { keys: ['T'], label: 'Change visual theme' },
      { keys: ['Q'], label: 'Toggle the queue' },
      { keys: ['Esc'], label: 'Close the player' },
    ],
  },
];

function isTyping(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable;
}

/** Press ? anywhere (outside a text field) to see every keyboard shortcut. */
export function Shortcuts() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTyping(e.target)) return;
      e.preventDefault();
      setOpen((o) => !o);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  return (
    <Dialog open={open} onClose={() => setOpen(false)} title="Keyboard shortcuts" width={560}>
      <div className="grid gap-6 sm:grid-cols-2">
        {GROUPS.map((group) => (
          <section key={group.title} className={group.title === 'Player' ? 'sm:col-span-2' : undefined}>
            <h3 className="mb-2 text-xs font-semibold tracking-[0.06em] text-ink-3 uppercase">{group.title}</h3>
            <ul className={group.title === 'Player' ? 'grid gap-y-1.5 sm:grid-cols-2 sm:gap-x-8' : 'space-y-1.5'}>
              {group.items.map((s) => (
                <li key={s.label} className="flex items-center justify-between gap-4">
                  <span className="text-[13px] text-ink-2">{s.label}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {s.keys.map((k) => (
                      <kbd key={k} className="grid h-6 min-w-6 place-items-center rounded-md border border-line-strong bg-sunken px-1.5 font-sans text-[11px] font-semibold text-ink-2 shadow-sm">{k}</kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
