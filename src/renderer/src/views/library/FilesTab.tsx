// Everything downloaded that isn't music or video — documents, archives, installers, images.
// Before this, those files finished and then vanished from the app; now the Library lists them.
import { useEffect, useState } from 'react';
import { Archive, BookOpen, Code2, ExternalLink, FileText, FolderOpen, Image, Package, Subtitles, File as FileIcon } from 'lucide-react';
import type { LibraryFile } from '@shared/types';
import { formatBytes, plural } from '@core/format';
import { type FileKind, groupByKind } from '@core/fileKind';
import { call, errorMessage } from '@/lib/bridge';
import { useApp } from '@/stores/app';
import { Button, EmptyState, IconButton } from '@/components/ui';

const ICONS: Record<FileKind, React.ReactNode> = {
  document: <FileText />, ebook: <BookOpen />, archive: <Archive />, image: <Image />,
  app: <Package />, subtitle: <Subtitles />, code: <Code2 />, other: <FileIcon />,
};

const relativeDay = (ms: number) => {
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(ms).toLocaleDateString();
};

export function FilesTab({ query }: { query: string }) {
  const toast = useApp((s) => s.toast);
  const otherDir = useApp((s) => s.settings?.storage.otherDir ?? '');
  const [files, setFiles] = useState<LibraryFile[] | null>(null);

  useEffect(() => {
    let live = true;
    void call('library:files')
      .then((list) => { if (live) setFiles(list); })
      .catch((err) => { if (live) { setFiles([]); toast(errorMessage(err), 'error'); } });
    return () => { live = false; };
  }, [toast]);

  const q = query.trim().toLowerCase();
  const visible = (files ?? []).filter((f) => !q || f.name.toLowerCase().includes(q) || f.folder.toLowerCase().includes(q));
  const groups = groupByKind(visible);

  const open = (f: LibraryFile) => void call('shell:open-path', { path: f.path }).catch((err) => toast(errorMessage(err), 'error'));
  const reveal = (f: LibraryFile) => void call('shell:show-in-folder', { path: f.path }).catch((err) => toast(errorMessage(err), 'error'));

  if (files == null) {
    return <div className="space-y-2" aria-busy="true">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton h-12 rounded-lg" style={{ opacity: 1 - i * 0.14 }} />)}</div>;
  }

  if (visible.length === 0) {
    return (
      <EmptyState
        icon={<FileIcon />}
        title={q ? 'No files match' : 'No other files yet'}
        action={!q && otherDir ? <Button variant="ghost" size="sm" icon={<FolderOpen className="size-3.5" />} onClick={() => void call('shell:open-path', { path: otherDir }).catch((err) => toast(errorMessage(err), 'error'))}>Open the folder</Button> : undefined}
      >
        {q ? 'Try a different search.' : 'Documents, archives, installers and anything else you download shows up here — music and video have their own tabs.'}
      </EmptyState>
    );
  }

  return (
    <div className="h-full space-y-6 overflow-auto pb-4">
      {groups.map((group) => (
        <section key={group.kind}>
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-[0.08em] text-ink-3 uppercase">
            <span className="[&_svg]:size-3.5">{ICONS[group.kind]}</span>
            {group.label}
            <span className="font-medium normal-case tracking-normal">· {plural(group.files.length, 'file')}</span>
          </h3>
          <div className="overflow-hidden rounded-xl border border-line bg-panel">
            {group.files.map((f) => (
              <div
                key={f.path}
                role="button"
                tabIndex={0}
                onDoubleClick={() => open(f)}
                onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && open(f)}
                className="group grid grid-cols-[36px_1fr_auto] items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0 transition-colors hover:bg-hover"
              >
                <span className="grid size-9 place-items-center rounded-md bg-sunken text-ink-3 [&_svg]:size-4">{ICONS[group.kind]}</span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold" title={f.name}>{f.name}</p>
                  <p className="truncate text-[13px] text-ink-3">
                    {formatBytes(f.sizeBytes)} · {relativeDay(f.mtimeMs)}{f.folder && ` · ${f.folder}`}
                  </p>
                </div>
                <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <IconButton label={`Open ${f.name}`} size="sm" onClick={() => open(f)}><ExternalLink /></IconButton>
                  <IconButton label="Show in folder" size="sm" onClick={() => reveal(f)}><FolderOpen /></IconButton>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
      <p className="text-xs text-ink-3">Double-click a file to open it in whatever app your PC uses for it.</p>
    </div>
  );
}
