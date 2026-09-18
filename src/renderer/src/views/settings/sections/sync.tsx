import { useEffect, useState } from 'react';
import { Bookmark as BookmarkIcon, Check, Copy, Link2, Plus, RefreshCw, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react';
import type { Bookmark, SyncStatus } from '@shared/types';
import { call, errorMessage, on } from '@/lib/bridge';
import { useApp } from '@/stores/app';
import { Badge, Button, Switch } from '@/components/ui';
import { FolderRow, Group, Row, TextInput, type SectionProps } from '../controls';

const relative = (ts: number) => {
  if (!ts) return 'never';
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
};

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button size="sm" variant="ghost" icon={done ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      onClick={() => { void navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}>
      {done ? 'Copied' : 'Copy'}
    </Button>
  );
}

export function SyncSection({ s, set }: SectionProps) {
  const toast = useApp((x) => x.toast);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [code, setCode] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const loadBookmarks = () => void call('bookmarks:list').then(setBookmarks);
  useEffect(() => {
    void call('sync:status').then(setStatus);
    loadBookmarks();
    return on('sync:changed', (st) => { setStatus(st); loadBookmarks(); });
  }, []);

  const run = async <T,>(key: string, fn: () => Promise<T>, ok?: (v: T) => void) => {
    setBusy(key);
    try {
      ok?.(await fn());
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  };

  if (!status) return null;

  if (!status.encryptionAvailable) {
    return (
      <Group title="Sync across your devices">
        <Row label={<span className="flex items-center gap-2"><TriangleAlert className="size-4 text-warning" /> Sync isn’t available on this system</span>}
          description="Lumina Sync needs your operating system’s secure key store (Keychain / DPAPI / libsecret) to protect the chain key, and it isn’t available here. Once it is, sync can be set up." />
      </Group>
    );
  }

  return (
    <>
      <Group title="Sync across your devices"
        description="A private “chain” keeps your bookmarks (and more soon) in step across your devices — with no third-party cloud. Data is end-to-end encrypted with a recovery code that only your devices hold, and exchanged through a folder you control (a USB drive, or a folder both devices reach).">
        {!status.hasChain ? (
          <>
            <Row id="createChain" label="Start a new chain" description="Creates this device’s chain and a recovery code you enter on your other devices.">
              <Button size="sm" variant="primary" loading={busy === 'create'}
                onClick={() => run('create', () => call('sync:create-chain'), () => toast('Sync chain created', 'success'))}>
                Create chain
              </Button>
            </Row>
            <Row id="joinChain" label="Join an existing chain" description="Enter the recovery code shown on a device that’s already in the chain." stacked>
              <div className="flex w-full items-center gap-2">
                <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX-…" spellCheck={false}
                  className="h-9 min-w-0 flex-1 rounded-lg border border-line-strong bg-raised px-3 font-mono text-[13px] text-ink shadow-sm outline-none placeholder:text-ink-3 focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]" />
                <Button size="sm" variant="primary" icon={<Link2 className="size-3.5" />} loading={busy === 'join'} disabled={!code.trim()}
                  onClick={() => run('join', () => call('sync:join-chain', { code }), () => { setCode(''); toast('Joined the sync chain', 'success'); })}>
                  Join
                </Button>
              </div>
            </Row>
          </>
        ) : (
          <>
            <Row id="recoveryCode" label={<span className="flex items-center gap-2">Recovery code <Badge tone="success"><ShieldCheck className="size-3" /> Chain active</Badge></span>}
              description="Enter this on another device — or in the LuminaBr app on your phone — to add it to the chain. Anyone with this code can read the chain, so share it only with your own devices." stacked>
              <div className="flex w-full items-center gap-2">
                <code data-selectable className="min-w-0 flex-1 rounded-lg border border-line bg-raised px-3 py-2 font-mono text-[13px] break-all text-ink">{status.recoveryCode}</code>
                {status.recoveryCode && <CopyButton text={status.recoveryCode} />}
              </div>
            </Row>
            <Row id="deviceLabel" label="This device’s name" description="Shown to other devices in the chain.">
              <TextInput value={s.sync.deviceLabel} placeholder={status.deviceLabel} onCommit={(v) => set({ sync: { deviceLabel: v } })} width="w-56" />
            </Row>
            <Row id="leaveChain" label="Leave the chain" description="Forgets the chain key on this device. Your local bookmarks stay; they just stop syncing.">
              <Button size="sm" variant="ghost" loading={busy === 'leave'}
                onClick={() => run('leave', () => call('sync:leave'), () => toast('Left the sync chain', 'success'))}>
                Leave
              </Button>
            </Row>
          </>
        )}
      </Group>

      {status.hasChain && (
        <Group title="Sync folder" description="An encrypted lumina-sync.bin lives here. Point every device at the same place — a USB drive you move between them, or a shared/cloud-synced folder both can reach.">
          <FolderRow id="syncFolder" label="Folder" value={s.sync.folder || 'Not set'} onPick={(dir) => set({ sync: { folder: dir } })} />
          <Row id="syncBookmarks" label="Sync bookmarks" description="Keep saved sites in step across the chain. (More types — likes, history — arrive as they’re built.)">
            <Switch checked={s.sync.syncBookmarks} onChange={(v) => set({ sync: { syncBookmarks: v } })} label="Sync bookmarks" />
          </Row>
          <Row id="syncNow" label="Sync now" description={`Last synced ${relative(status.lastSyncedAt)} · ${status.bookmarkCount} bookmark${status.bookmarkCount === 1 ? '' : 's'} on this device.`}>
            <Button size="sm" variant="primary" icon={<RefreshCw className="size-3.5" />} loading={busy === 'now'} disabled={!s.sync.folder}
              onClick={() => run('now', () => call('sync:now'), () => toast('Synced', 'success'))}>
              Sync now
            </Button>
          </Row>
        </Group>
      )}

      <Group title="Bookmarks" description="Saved sites from the in-app browser. Add one here to try sync end-to-end: save it, Sync now to your folder, then sync from your other device.">
        <Row label="Add a bookmark" stacked>
          <div className="flex w-full items-center gap-2">
            <input value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="https://example.com" spellCheck={false}
              onKeyDown={(e) => { if (e.key === 'Enter' && newUrl.trim()) void run('add', () => call('bookmarks:add', { url: newUrl.trim(), title: newUrl.trim() }), () => setNewUrl('')); }}
              className="h-9 min-w-0 flex-1 rounded-lg border border-line-strong bg-raised px-3 text-sm text-ink shadow-sm outline-none placeholder:text-ink-3 focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]" />
            <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} loading={busy === 'add'} disabled={!newUrl.trim()}
              onClick={() => run('add', () => call('bookmarks:add', { url: newUrl.trim(), title: newUrl.trim() }), () => setNewUrl(''))}>
              Add
            </Button>
          </div>
        </Row>
        {bookmarks.length === 0 ? (
          <Row label={<span className="flex items-center gap-2 text-ink-3"><BookmarkIcon className="size-4" /> No bookmarks yet</span>} />
        ) : (
          bookmarks.map((b) => (
            <Row key={b.id} label={<span className="block truncate">{b.title || b.url}</span>} description={<span className="block truncate">{b.url}</span>}>
              <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} aria-label={`Remove ${b.title || b.url}`}
                onClick={() => run(`rm-${b.id}`, () => call('bookmarks:remove', { id: b.id }))}>
                Remove
              </Button>
            </Row>
          ))
        )}
      </Group>
    </>
  );
}
