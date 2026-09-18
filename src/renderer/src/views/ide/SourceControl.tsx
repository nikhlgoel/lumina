// The Source Control view: commit box, staged and unstaged changes, and the actions on them.
//
// All git state is read fresh from main (see src/main/ide/git.ts) and every action returns the new
// state, so this view never guesses what git did. Changes outside the open folder are listed so
// nothing is hidden, but they are read-only here.
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, GitBranch, Minus, Plus, RefreshCw, Undo2 } from 'lucide-react';
import type { GitFileView, GitView } from '@shared/types';
import { branchSummary, commitMessageProblem, conflictedFiles, letterFor, stagedFiles, unstagedFiles } from '@core/git';
import { call, errorMessage } from '@/lib/bridge';
import { cn } from '@/lib/cn';
import { useApp } from '@/stores/app';
import { Button } from '@/components/ui';
import { PartHeader } from './IdeChrome';

const TONE: Record<string, string> = {
  M: 'text-warning', A: 'text-success', U: 'text-success', D: 'text-danger', R: 'text-accent', C: 'text-accent', T: 'text-warning', '!': 'text-danger',
};

function Row({ file, letter, actions, onOpen }: {
  file: GitFileView;
  letter: string;
  actions: React.ReactNode;
  onOpen: () => void;
}) {
  const name = file.path.split('/').pop() ?? file.path;
  const dir = file.path.slice(0, Math.max(0, file.path.length - name.length - 1));
  const outside = file.workspacePath === null;
  const deleted = file.index === 'deleted' || file.worktree === 'deleted';
  return (
    <li className="group flex items-center gap-1.5 pr-1.5 pl-3 text-[13px] hover:bg-hover">
      <button
        onClick={onOpen}
        disabled={outside}
        title={outside ? `${file.path} — outside the open folder, read-only here` : file.origPath ? `${file.origPath} → ${file.path}` : file.path}
        className={cn('flex min-w-0 flex-1 items-baseline gap-2 py-[3px] text-left', outside && 'cursor-default opacity-60', deleted && 'line-through decoration-ink-3')}
      >
        <span className="truncate">{name}</span>
        {dir && <span className="truncate text-[11px] text-ink-3">{dir}</span>}
      </button>
      {!outside && <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">{actions}</span>}
      <span className={cn('w-4 shrink-0 text-center font-mono text-[11px] font-semibold', TONE[letter] ?? 'text-ink-3')}>{letter}</span>
    </li>
  );
}

function Act({ label, onClick, children, danger }: { label: string; onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick(); }} aria-label={label} title={label}
      className={cn('grid size-5 place-items-center rounded text-ink-3 hover:bg-line [&_svg]:size-3.5', danger ? 'hover:text-danger' : 'hover:text-ink')}>
      {children}
    </button>
  );
}

function Section({ title, count, action, children }: { title: string; count: number; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mt-1">
      <div className="group flex items-center gap-2 px-3 py-1">
        <span className="flex-1 text-[11px] font-semibold tracking-[0.08em] text-ink-3 uppercase">{title}</span>
        <span className="hidden group-hover:flex">{action}</span>
        <span className="rounded-full bg-hover px-1.5 text-[11px] tabular text-ink-3">{count}</span>
      </div>
      <ul>{children}</ul>
    </div>
  );
}

export function SourceControl({ view, onChange, onRefresh, onOpenDiff }: {
  view: GitView | null;
  onChange: (next: GitView) => void;
  onRefresh: () => void;
  onOpenDiff: (file: GitFileView, staged: boolean) => void;
}) {
  const toast = useApp((s) => s.toast);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  /** Discard is the one destructive action, so it takes a second click within a few seconds. */
  const [arming, setArming] = useState<string | null>(null);
  const disarm = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (disarm.current) clearTimeout(disarm.current); }, []);

  const run = async (fn: () => Promise<GitView>) => {
    setBusy(true);
    try {
      onChange(await fn());
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const discard = (paths: string[], key: string) => {
    if (arming !== key) {
      setArming(key);
      if (disarm.current) clearTimeout(disarm.current);
      disarm.current = setTimeout(() => setArming(null), 3500);
      toast('Click discard again to throw away these changes — this cannot be undone.', 'info');
      return;
    }
    setArming(null);
    void run(() => call('git:discard', { paths }));
  };

  if (!view) return <><PartHeader title="Source control" /><p className="px-3 py-3 text-[12px] text-ink-3">Reading git…</p></>;

  if (!view.available) {
    return (
      <>
        <PartHeader title="Source control" />
        <p className="px-3 py-3 text-[12px] leading-relaxed text-ink-3">
          Git isn’t installed, or isn’t on your PATH. Install it from git-scm.com and reopen Lumina — Lumina uses your
          own git rather than bundling one.
        </p>
      </>
    );
  }

  if (!view.repo || !view.status) {
    return (
      <>
        <PartHeader title="Source control" />
        <div className="space-y-3 px-3 py-3 text-[12px] leading-relaxed text-ink-3">
          <p>This folder isn’t a git repository.</p>
          <Button variant="primary" size="sm" disabled={busy} onClick={() => void run(() => call('git:init'))}>Initialise repository</Button>
        </div>
      </>
    );
  }

  const status = view.status;
  const withView = (files: { path: string }[]) =>
    files.map((f) => view.files.find((v) => v.path === f.path)).filter((f): f is GitFileView => f !== undefined);
  const staged = withView(stagedFiles(status));
  const changes = withView(unstagedFiles(status));
  const conflicts = withView(conflictedFiles(status));
  const mine = (files: GitFileView[]) => files.map((f) => f.workspacePath).filter((p): p is string => p !== null);
  const problem = commitMessageProblem(message);
  const canCommit = !busy && staged.length > 0 && !problem;

  const commit = async () => {
    if (!canCommit) return;
    await run(() => call('git:commit', { message }));
    setMessage('');
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PartHeader title="Source control">
        <button onClick={onRefresh} aria-label="Refresh" title="Refresh" className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink">
          <RefreshCw className={cn('size-3.5', busy && 'animate-spin')} />
        </button>
      </PartHeader>

      <div className="space-y-2 border-b border-line p-3">
        <div className="flex items-center gap-1.5 text-[12px] text-ink-3">
          <GitBranch className="size-3.5" />
          <span className="truncate">{branchSummary(status)}</span>
        </div>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void commit(); } }}
          placeholder={`Message (Ctrl+Enter to commit on ${status.branch ?? 'HEAD'})`}
          aria-label="Commit message"
          rows={3}
          className="w-full resize-y rounded-lg border border-line-strong bg-raised px-2.5 py-2 text-[13px] outline-none placeholder:text-ink-3 focus:border-accent"
        />
        <div className="flex">
          <Button variant="primary" size="sm" disabled={!canCommit} onClick={() => void commit()}>
            {staged.length > 0 ? `Commit ${staged.length} file${staged.length === 1 ? '' : 's'}` : 'Commit'}
          </Button>
        </div>
        {staged.length === 0 && changes.length > 0 && (
          <p className="text-[11px] text-ink-3">Stage changes with <Plus className="inline size-3" /> to include them.</p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto pb-2">
        {conflicts.length > 0 && (
          <Section title="Merge conflicts" count={conflicts.length}>
            {conflicts.map((f) => (
              <Row key={f.path} file={f} letter="!" onOpen={() => onOpenDiff(f, false)}
                actions={<Act label="Mark resolved (stage)" onClick={() => void run(() => call('git:stage', { paths: [f.workspacePath!] }))}><Plus /></Act>} />
            ))}
          </Section>
        )}

        {staged.length > 0 && (
          <Section title="Staged changes" count={staged.length}
            action={<Act label="Unstage all" onClick={() => void run(() => call('git:unstage', { paths: mine(staged) }))}><Minus /></Act>}>
            {staged.map((f) => (
              <Row key={`s-${f.path}`} file={f} letter={letterFor(f.index)} onOpen={() => onOpenDiff(f, true)}
                actions={<Act label="Unstage" onClick={() => void run(() => call('git:unstage', { paths: [f.workspacePath!] }))}><Minus /></Act>} />
            ))}
          </Section>
        )}

        <Section title="Changes" count={changes.length}
          action={changes.length > 0 && <Act label="Stage all" onClick={() => void run(() => call('git:stage', { paths: mine(changes) }))}><Plus /></Act>}>
          {changes.length === 0 && <li className="px-3 py-1 text-[12px] text-ink-3">No changes.</li>}
          {changes.map((f) => {
            const key = `c-${f.path}`;
            return (
              <Row key={key} file={f} letter={letterFor(f.worktree)} onOpen={() => onOpenDiff(f, false)}
                actions={
                  <>
                    {!f.untracked && (
                      <Act label={arming === key ? 'Click again to discard' : 'Discard changes'} danger onClick={() => discard([f.workspacePath!], key)}>
                        {arming === key ? <AlertTriangle className="text-danger" /> : <Undo2 />}
                      </Act>
                    )}
                    <Act label="Stage" onClick={() => void run(() => call('git:stage', { paths: [f.workspacePath!] }))}><Plus /></Act>
                  </>
                } />
            );
          })}
        </Section>
      </div>
    </div>
  );
}
