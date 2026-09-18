// Update status: what's running, whether something newer exists, and the two buttons that matter —
// get the new version, and restart Lumina. Lumina checks and announces; it doesn't replace itself
// (see src/main/update.ts for why), so "Get it" opens the release page in the real browser.
import { useEffect, useState } from 'react';
import { ArrowUpRight, CircleCheck, RefreshCw, RotateCw, TriangleAlert } from 'lucide-react';
import type { UpdateState } from '@shared/types';
import { call, errorMessage, on } from '@/lib/bridge';
import { cn } from '@/lib/cn';
import { useApp } from '@/stores/app';
import { Button, Switch } from '@/components/ui';

export function UpdateCard() {
  const toast = useApp((s) => s.toast);
  const settings = useApp((s) => s.settings);
  const updateSettings = useApp((s) => s.updateSettings);
  const [state, setState] = useState<UpdateState | null>(null);
  const [confirmRestart, setConfirmRestart] = useState(false);

  useEffect(() => {
    void call('update:status').then(setState).catch(() => {});
    return on('update:changed', setState);
  }, []);

  const check = async () => {
    try {
      setState(await call('update:check'));
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const available = state?.available ?? null;
  const checking = state?.checking ?? false;

  return (
    <section className="rounded-xl border border-line bg-panel p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className={cn('grid size-10 shrink-0 place-items-center rounded-lg [&_svg]:size-5',
          available ? 'bg-accent-soft text-accent' : state?.error ? 'bg-sunken text-warning' : 'bg-sunken text-ink-3')}>
          {available ? <ArrowUpRight /> : state?.error ? <TriangleAlert /> : <CircleCheck />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {available ? `Lumina ${available.version} is available` : checking ? 'Checking for updates…' : 'Lumina is up to date'}
          </p>
          <p className="mt-0.5 text-[13px] text-ink-3">
            {available
              ? `You're on ${state?.currentVersion ?? '?'}${available.prerelease ? ' · this one is a prerelease' : ''}`
              : state?.error
                ? `Couldn't check just now — ${state.error}`
                : `Version ${state?.currentVersion ?? '?'}${state?.lastCheckAt ? ` · checked ${new Date(state.lastCheckAt).toLocaleString()}` : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {available && (
            <>
              <Button variant="primary" size="sm" icon={<ArrowUpRight className="size-4" />}
                onClick={() => void call('update:open-release').catch((err) => toast(errorMessage(err), 'error'))}>
                Get it
              </Button>
              <Button variant="ghost" size="sm"
                onClick={() => void call('update:skip', { version: available.version })
                  .then(() => call('update:status').then(setState))
                  .catch((err) => toast(errorMessage(err), 'error'))}>
                Skip this one
              </Button>
            </>
          )}
          <Button variant="ghost" size="sm" disabled={checking} icon={<RefreshCw className={cn('size-3.5', checking && 'animate-spin')} />} onClick={() => void check()}>
            Check now
          </Button>
        </div>
      </div>

      {available?.notes && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[13px] font-semibold text-ink-2">What's new</summary>
          <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-sunken p-3 text-[12px] leading-relaxed whitespace-pre-wrap text-ink-2" data-selectable>{available.notes}</pre>
        </details>
      )}

      <div className="mt-4 space-y-3 border-t border-line pt-3">
        <ToggleRow
          label="Check for a newer Lumina after launch"
          checked={settings?.updates.checkAppOnLaunch ?? true}
          onChange={(v) => void updateSettings({ updates: { checkAppOnLaunch: v } })}
        />
        <ToggleRow
          label="Include alpha and beta builds"
          checked={settings?.updates.allowPrereleases ?? true}
          onChange={(v) => void updateSettings({ updates: { allowPrereleases: v } })}
        />
        <p className="text-[13px] text-ink-3">
          Lumina tells you when there's a new version and opens its download page — it never installs anything by
          itself. Updates are installed the same way you installed Lumina.
        </p>
        <div className="flex items-center gap-2">
          {confirmRestart ? (
            <>
              <Button variant="danger" size="sm" onClick={() => void call('app:restart').catch((err) => toast(errorMessage(err), 'error'))}>
                Restart now
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmRestart(false)}>Cancel</Button>
              <span className="text-[13px] text-ink-3">Downloads in progress will stop.</span>
            </>
          ) : (
            <Button variant="ghost" size="sm" icon={<RotateCw className="size-3.5" />} onClick={() => setConfirmRestart(true)}>
              Restart Lumina
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

/** The bare Switch carries its label only for screen readers; here it needs a visible one too. */
function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm">{label}</span>
      <Switch label={label} checked={checked} onChange={onChange} />
    </div>
  );
}
