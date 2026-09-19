// The Explorer's right-click menu, and the little prompt it needs for naming things.
//
// Two rules shape this:
//   * Nothing destructive happens without a confirmation that names what will be deleted, and a
//     non-empty folder has to be confirmed explicitly — the main process refuses a recursive delete
//     unless it is asked for.
//   * Every path the menu acts on is workspace-relative and goes back through the main process,
//     which re-checks it against the open folder. The menu cannot reach outside the workspace.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Copy, FilePlus, FolderPlus, FolderOpen, Pencil, Trash2 } from 'lucide-react';
import { call, errorMessage } from '@/lib/bridge';
import { useApp } from '@/stores/app';
import { Button, Dialog } from '@/components/ui';

export interface MenuTarget {
  /** Workspace-relative path that was right-clicked. Empty string means the workspace root. */
  path: string;
  name: string;
  kind: 'file' | 'directory';
  x: number;
  y: number;
}

interface Item {
  label: string;
  icon: ReactNode;
  run: () => void;
  danger?: boolean;
  separatorBefore?: boolean;
}

/** A prompt for one line of text. Used for "new file" and "rename". */
function TextPrompt({ open, title, label, initial, confirmLabel, onCancel, onConfirm }: {
  open: boolean;
  title: string;
  label: string;
  initial: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  useEffect(() => { if (open) setValue(initial); }, [open, initial]);

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed) onConfirm(trimmed);
  };

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" disabled={!value.trim()} onClick={submit}>{confirmLabel}</Button>
        </>
      }
    >
      <label className="block text-sm font-semibold text-ink">{label}</label>
      <input
        autoFocus
        value={value}
        aria-label={label}
        spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
        className="mt-2 h-9 w-full rounded-lg border border-line-strong bg-raised px-3 font-mono text-sm outline-none focus:border-accent"
      />
    </Dialog>
  );
}

/** Confirm a delete, naming exactly what goes. */
function ConfirmDelete({ target, onCancel, onConfirm }: {
  target: MenuTarget | null;
  onCancel: () => void;
  onConfirm: (recursive: boolean) => void;
}) {
  return (
    <Dialog
      open={Boolean(target)}
      onClose={onCancel}
      title={`Delete ${target?.kind === 'directory' ? 'folder' : 'file'}?`}
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="danger" onClick={() => onConfirm(target?.kind === 'directory')}>Delete</Button>
        </>
      }
    >
      <p className="text-[13px] leading-relaxed text-ink-2">
        <span className="font-mono font-semibold">{target?.name}</span> will be deleted from disk.
        {target?.kind === 'directory' && ' Everything inside it goes too.'}
      </p>
      <p className="mt-2 text-[12px] text-ink-3">This cannot be undone from inside Lumina.</p>
    </Dialog>
  );
}

export function ExplorerMenu({ target, onClose, onChanged, onOpenPath }: {
  target: MenuTarget | null;
  onClose: () => void;
  /** Called after anything that changes the tree, so the caller can reload it. */
  onChanged: () => void;
  onOpenPath: (path: string) => void;
}) {
  const toast = useApp((s) => s.toast);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [prompt, setPrompt] = useState<null | { mode: 'file' | 'folder' | 'rename'; initial: string }>(null);
  const [confirming, setConfirming] = useState<MenuTarget | null>(null);
  // The menu closes as soon as an item is picked, so remember what it was acting on.
  const acting = useRef<MenuTarget | null>(null);
  if (target) acting.current = target;

  // Keep the menu on screen: opening near the right or bottom edge must not push it out of view.
  useLayoutEffect(() => {
    if (!target || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    setPos({
      x: Math.min(target.x, window.innerWidth - rect.width - 8),
      y: Math.min(target.y, window.innerHeight - rect.height - 8),
    });
  }, [target]);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [target, onClose]);

  if (!target && !prompt && !confirming) return null;

  const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  /** New things go inside a folder, or beside a file. */
  const containerFor = (t: MenuTarget) => (t.kind === 'directory' ? t.path : parentOf(t.path));

  const guard = async (fn: () => Promise<void>) => {
    try {
      await fn();
      onChanged();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const createIn = (name: string, directory: boolean) => {
    const t = acting.current;
    if (!t) return;
    const base = containerFor(t);
    const path = base ? `${base}/${name}` : name;
    void guard(async () => {
      await call('ide:create', { path, directory });
      if (!directory) onOpenPath(path);
      toast(`Created ${name}`, 'success');
    });
  };

  const rename = (name: string) => {
    const t = acting.current;
    if (!t) return;
    const base = parentOf(t.path);
    void guard(async () => {
      await call('ide:rename', { from: t.path, to: base ? `${base}/${name}` : name });
      toast(`Renamed to ${name}`, 'success');
    });
  };

  const items: Item[] = target ? [
    { label: 'New file…', icon: <FilePlus className="size-3.5" />, run: () => setPrompt({ mode: 'file', initial: '' }) },
    { label: 'New folder…', icon: <FolderPlus className="size-3.5" />, run: () => setPrompt({ mode: 'folder', initial: '' }) },
    { label: 'Rename…', icon: <Pencil className="size-3.5" />, separatorBefore: true, run: () => setPrompt({ mode: 'rename', initial: target.name }) },
    { label: 'Delete', icon: <Trash2 className="size-3.5" />, danger: true, run: () => setConfirming(target) },
    {
      label: 'Reveal in File Explorer',
      icon: <FolderOpen className="size-3.5" />,
      separatorBefore: true,
      run: () => void call('ide:reveal', { path: target.path }).catch((err) => toast(errorMessage(err), 'error')),
    },
    {
      label: 'Copy path',
      icon: <Copy className="size-3.5" />,
      run: () => void call('ide:abs-path', { path: target.path })
        .then((abs) => navigator.clipboard.writeText(abs))
        .then(() => toast('Path copied', 'success'))
        .catch((err) => toast(errorMessage(err), 'error')),
    },
    {
      label: 'Copy relative path',
      icon: <Copy className="size-3.5" />,
      run: () => void navigator.clipboard.writeText(target.path).then(() => toast('Relative path copied', 'success')),
    },
  ] : [];

  return (
    <>
      {target && (
        <div className="fixed inset-0 z-[80]" onMouseDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
          <div
            ref={menuRef}
            role="menu"
            aria-label={`Actions for ${target.name}`}
            style={{ left: pos.x, top: pos.y }}
            className="absolute min-w-52 rounded-lg border border-line bg-overlay py-1 shadow-lg"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {items.map((item) => (
              <div key={item.label}>
                {item.separatorBefore && <div className="my-1 border-t border-line" />}
                <button
                  role="menuitem"
                  onClick={() => { onClose(); item.run(); }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-hover ${item.danger ? 'text-danger' : ''}`}
                >
                  {item.icon}
                  {item.label}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <TextPrompt
        open={prompt?.mode === 'file' || prompt?.mode === 'folder'}
        title={prompt?.mode === 'folder' ? 'New folder' : 'New file'}
        label="Name"
        initial=""
        confirmLabel="Create"
        onCancel={() => setPrompt(null)}
        onConfirm={(name) => { const dir = prompt?.mode === 'folder'; setPrompt(null); createIn(name, Boolean(dir)); }}
      />

      <TextPrompt
        open={prompt?.mode === 'rename'}
        title="Rename"
        label="New name"
        initial={prompt?.initial ?? ''}
        confirmLabel="Rename"
        onCancel={() => setPrompt(null)}
        onConfirm={(name) => { setPrompt(null); rename(name); }}
      />

      <ConfirmDelete
        target={confirming}
        onCancel={() => setConfirming(null)}
        onConfirm={(recursive) => {
          const victim = confirming;
          setConfirming(null);
          if (!victim) return;
          void guard(async () => {
            await call('ide:delete', { path: victim.path, recursive });
            toast(`Deleted ${victim.name}`, 'success');
          });
        }}
      />
    </>
  );
}
