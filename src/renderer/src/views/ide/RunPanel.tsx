// "Run" — the project's own scripts, and whatever they end up listening on.
//
// Running a script does not invent a new execution mechanism: it opens a normal terminal tab and
// types the command into it. So the output, the colours, Ctrl+C and the exit code are all exactly
// what the user would get from their own shell, and there is no second, half-working code path.
//
// Ports are discovered by watching that output for an http(s) URL with a port (see @core/tasks).
// That is a heuristic and is presented as one — a server that prints nothing shows nothing here.
import { useEffect, useState } from 'react';
import { ExternalLink, Globe, Play, RefreshCw, Terminal as TerminalIcon } from 'lucide-react';
import type { DetectedUrl, PackageManager, ProjectTask, TerminalPorts } from '@shared/types';
import { runCommand } from '@core/tasks';
import { call, errorMessage, on } from '@/lib/bridge';
import { useApp } from '@/stores/app';
import { Button } from '@/components/ui';

export function RunPanel({ onOpenUrl, onRan }: {
  /** Open a URL in Lumina's own browser tab. */
  onOpenUrl: (url: string) => void;
  /** Called after a task starts, so the caller can show the terminal it is running in. */
  onRan: (sessionId: string) => void;
}) {
  const toast = useApp((s) => s.toast);
  const [manager, setManager] = useState<PackageManager>('npm');
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [ports, setPorts] = useState<TerminalPorts[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    void call('ide:tasks')
      .then((r) => { setManager(r.manager); setTasks(r.tasks); })
      .catch((err) => toast(errorMessage(err), 'error'))
      .finally(() => setLoading(false));
    void call('ide:ports').then(setPorts).catch(() => {});
  };

  useEffect(load, []);

  // Ports arrive as they are noticed, per session; an empty list means that session ended.
  useEffect(() => on('ide:term-ports', (update) => {
    setPorts((current) => {
      const rest = current.filter((p) => p.id !== update.id);
      return update.urls.length > 0 ? [...rest, update] : rest;
    });
  }), []);

  const run = async (task: ProjectTask) => {
    setBusy(task.name);
    try {
      const session = await call('ide:term-start', {
        command: runCommand(manager, task.name),
        label: task.name,
        // The project's toolchain is native, so a task must not land in WSL.
        native: true,
      });
      onRan(session.id);
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  };

  const allUrls: DetectedUrl[] = ports.flatMap((p) => p.urls);

  return (
    <div className="flex h-full min-h-0">
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
          <TerminalIcon className="size-3.5 shrink-0 text-ink-3" />
          <span className="text-[12px] font-semibold">Scripts</span>
          <span className="rounded bg-hover px-1.5 py-0.5 font-mono text-[11px] text-ink-3">{manager}</span>
          <button onClick={load} aria-label="Reload scripts" title="Reload scripts"
            className="ml-auto rounded p-1 text-ink-3 hover:bg-hover hover:text-ink">
            <RefreshCw className="size-3.5" />
          </button>
        </div>

        {loading && <p className="px-3 py-2 text-[12px] text-ink-3">Reading package.json…</p>}

        {!loading && tasks.length === 0 && (
          <p className="px-3 py-2 text-[12px] leading-relaxed text-ink-3">
            No scripts found. This panel lists the <code className="font-mono">scripts</code> in the open folder’s
            package.json.
          </p>
        )}

        <ul>
          {tasks.map((task) => (
            <li key={task.name} className="flex items-center gap-2 border-b border-line px-3 py-1.5 last:border-b-0">
              <button
                onClick={() => void run(task)}
                disabled={busy !== null}
                aria-label={`Run ${task.name}`}
                title={`${manager} run ${task.name}`}
                className="rounded p-1 text-ink-3 hover:bg-accent-soft hover:text-accent disabled:opacity-50"
              >
                <Play className="size-3.5" />
              </button>
              <span className="shrink-0 font-mono text-[12px] font-semibold">{task.name}</span>
              <span className="truncate font-mono text-[11px] text-ink-3" title={task.command}>{task.command}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="min-h-0 w-72 shrink-0 overflow-auto border-l border-line">
        <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
          <Globe className="size-3.5 shrink-0 text-ink-3" />
          <span className="text-[12px] font-semibold">Ports</span>
        </div>

        {allUrls.length === 0 ? (
          <p className="px-3 py-2 text-[12px] leading-relaxed text-ink-3">
            Nothing yet. Start a server above and any address it prints appears here.
          </p>
        ) : (
          <ul>
            {allUrls.map((u) => (
              <li key={u.url} className="border-b border-line px-3 py-1.5 last:border-b-0">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-hover px-1.5 py-0.5 font-mono text-[11px] font-semibold">{u.port}</span>
                  {u.local ? (
                    <Button variant="ghost" size="sm" icon={<ExternalLink className="size-3" />} onClick={() => onOpenUrl(u.url)}>
                      Open
                    </Button>
                  ) : (
                    <span className="text-[11px] text-ink-3">network</span>
                  )}
                </div>
                <p className="mt-0.5 truncate font-mono text-[11px] text-ink-3" title={u.url}>{u.url}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
