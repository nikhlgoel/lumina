// The IDE's shell pieces: the drag handles between parts, the view switcher in the top strip, the
// layout toggles at top-right, and the Open Editors list. All state lives in @core/ideLayout; these
// components only draw it and report what the user did.
import { useRef, type ReactNode } from 'react';
import {
  Files, GitBranch, PanelBottom, PanelBottomClose, PanelLeft, PanelLeftClose, PanelRight, PanelRightClose, Search, X,
} from 'lucide-react';
import type { ActivityView, PartId } from '@core/ideLayout';
import type { TabState } from '@core/ide';
import { cn } from '@/lib/cn';

/**
 * A drag handle between two parts. Reports the pointer's travel since the drag began, so the
 * caller can apply it to the size the part had at that moment — which keeps a fast drag exact
 * instead of accumulating rounding error frame by frame.
 */
export function Sash({ orientation, label, onDragStart, onDrag, onDragEnd, onDoubleClick }: {
  orientation: 'vertical' | 'horizontal';
  label: string;
  onDragStart: () => void;
  onDrag: (deltaPx: number) => void;
  onDragEnd: () => void;
  onDoubleClick?: () => void;
}) {
  const origin = useRef(0);
  /** Tracked here rather than read back from pointer capture, which can fail and is best-effort. */
  const dragging = useRef(false);
  const vertical = orientation === 'vertical';

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try {
      // Keeps the drag alive when the pointer races ahead of the 6px handle.
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // No capture (e.g. a synthetic event): the drag still works while the pointer stays over us.
    }
    dragging.current = true;
    origin.current = vertical ? e.clientX : e.clientY;
    onDragStart();
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    onDrag((vertical ? e.clientX : e.clientY) - origin.current);
  };
  const up = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    onDragEnd();
  };

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={onDoubleClick}
      className={cn(
        'group relative z-10 shrink-0 touch-none',
        vertical ? '-mx-[3px] w-[6px] cursor-col-resize' : '-my-[3px] h-[6px] cursor-row-resize',
      )}
    >
      <span className={cn(
        'absolute bg-transparent transition-colors duration-150 group-hover:bg-accent group-active:bg-accent',
        vertical ? 'inset-y-0 left-1/2 w-px -translate-x-1/2' : 'inset-x-0 top-1/2 h-px -translate-y-1/2',
      )} />
    </div>
  );
}

function IconToggle({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        'no-drag grid size-7 place-items-center rounded-md transition-colors [&_svg]:size-4',
        active ? 'bg-hover text-ink' : 'text-ink-3 hover:bg-hover hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

/**
 * The view switcher that sits in the IDE's top strip. Only views that actually exist are listed —
 * Extensions joins this row when that feature ships, not before.
 */
export function ViewSwitcher({ active, sidebarOpen, onSelect }: {
  active: ActivityView;
  sidebarOpen: boolean;
  onSelect: (view: ActivityView) => void;
}) {
  const views: { id: ActivityView; label: string; icon: ReactNode }[] = [
    { id: 'explorer', label: 'Explorer (Ctrl+Shift+E)', icon: <Files /> },
    { id: 'search', label: 'Search (Ctrl+Shift+F)', icon: <Search /> },
    { id: 'scm', label: 'Source Control (Ctrl+Shift+G)', icon: <GitBranch /> },
  ];
  return (
    <div className="flex items-center gap-0.5" role="toolbar" aria-label="Views">
      {views.map((v) => (
        <IconToggle key={v.id} label={v.label} active={sidebarOpen && active === v.id} onClick={() => onSelect(v.id)}>
          {v.icon}
        </IconToggle>
      ))}
    </div>
  );
}

/** Top-right layout toggles — left sidebar, bottom panel, right sidebar — the same trio VS Code has. */
export function LayoutToggles({ visible, onToggle }: {
  visible: Record<PartId, boolean>;
  onToggle: (part: PartId) => void;
}) {
  return (
    <div className="flex items-center gap-0.5" role="toolbar" aria-label="Layout">
      <IconToggle label={`${visible.primary ? 'Hide' : 'Show'} primary sidebar (Ctrl+B)`} active={visible.primary} onClick={() => onToggle('primary')}>
        {visible.primary ? <PanelLeftClose /> : <PanelLeft />}
      </IconToggle>
      <IconToggle label={`${visible.panel ? 'Hide' : 'Show'} panel (Ctrl+J)`} active={visible.panel} onClick={() => onToggle('panel')}>
        {visible.panel ? <PanelBottomClose /> : <PanelBottom />}
      </IconToggle>
      <IconToggle label={`${visible.secondary ? 'Hide' : 'Show'} secondary sidebar (Ctrl+Alt+B)`} active={visible.secondary} onClick={() => onToggle('secondary')}>
        {visible.secondary ? <PanelRightClose /> : <PanelRight />}
      </IconToggle>
    </div>
  );
}

/** A sidebar's heading row, with room for actions on the right. */
export function PartHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
      <span className="min-w-0 flex-1 truncate text-[11px] font-semibold tracking-[0.08em] text-ink-3 uppercase">{title}</span>
      {children}
    </div>
  );
}

/** Every open file, with its unsaved state — the list VS Code calls Open Editors. */
export function OpenEditors({ tabs, onSelect, onClose }: {
  tabs: TabState;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}) {
  if (tabs.tabs.length === 0) {
    return <p className="px-3 py-3 text-[12px] text-ink-3">No files open.</p>;
  }
  return (
    <ul className="py-1">
      {tabs.tabs.map((t) => {
        const name = t.path.split('/').pop() ?? t.path;
        const dir = t.path.slice(0, Math.max(0, t.path.length - name.length - 1));
        return (
          <li key={t.path} className={cn('group flex items-center gap-1.5 pr-1.5 pl-3 text-[13px]', tabs.active === t.path ? 'bg-accent-soft text-accent' : 'hover:bg-hover')}>
            <button onClick={() => onSelect(t.path)} className={cn('flex min-w-0 flex-1 items-baseline gap-2 py-[3px] text-left', t.preview && 'italic')} title={t.path}>
              <span className="truncate">{name}</span>
              {dir && <span className="truncate text-[11px] text-ink-3">{dir}</span>}
            </button>
            <button onClick={() => onClose(t.path)} aria-label={`Close ${t.path}`} className="grid size-5 shrink-0 place-items-center rounded text-ink-3 hover:bg-line hover:text-ink">
              {t.dirty && <span className="block size-2 rounded-full bg-accent group-hover:hidden" aria-label="Unsaved" />}
              <X className={cn('size-3.5', t.dirty && 'hidden group-hover:block')} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
