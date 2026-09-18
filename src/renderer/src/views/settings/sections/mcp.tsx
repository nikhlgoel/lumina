// "Connected tools" — the UI for Model Context Protocol servers.
//
// MCP is the one connector standard worth having: most "plugins", "connectors" and skill bundles
// now ship as an MCP server, so one honest client covers all of them. This screen is deliberately
// blunt about what it is doing, because adding a server means Lumina will run a program:
//
//   * The exact command line is shown back to the user before anything can be switched on.
//   * A server arrives switched OFF. Importing a JSON block never starts anything.
//   * Validation (including the refusal of shell metacharacters) happens in @core/mcp and again in
//     the main process — this file cannot talk a server past those checks.
//   * Tool names and descriptions come from the server and are rendered as plain text. They are
//     data, never instructions.
import { useEffect, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronRight, Plug, Plus, Trash2 } from 'lucide-react';
import { describeCommand, parseCommandLine, parseMcpJson, type McpServerConfig } from '@core/mcp';
import type { McpServerState } from '@shared/types';
import { call, errorMessage, on } from '@/lib/bridge';
import { cn } from '@/lib/cn';
import { useApp } from '@/stores/app';
import { Badge, Button, Dialog, Select, Switch } from '@/components/ui';
import { Group, Row } from '../controls';

const STATUS: Record<McpServerState['status'], { label: string; dot: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }> = {
  stopped: { label: 'Off', dot: 'bg-ink-3', tone: 'neutral' },
  starting: { label: 'Starting…', dot: 'bg-warning animate-pulse', tone: 'warning' },
  ready: { label: 'Connected', dot: 'bg-success', tone: 'success' },
  error: { label: 'Failed', dot: 'bg-danger', tone: 'danger' },
};

/**
 * A label above its control. The shared `Field` puts the two side by side with a shrink-0 control,
 * which squeezes a command line into a few characters — here the input needs the full width.
 */
function Stack({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-sm font-semibold text-ink">{label}</div>
      {description && <p className="mt-0.5 mb-1.5 text-[12px] leading-relaxed text-ink-3">{description}</p>}
      <div className={description ? '' : 'mt-1.5'}>{children}</div>
    </div>
  );
}

/** The add/edit sheet. Everything typed here is re-validated in the main process before use. */
function ServerDialog({ open, initial, onClose, onSaved }: {
  open: boolean;
  initial: McpServerConfig | null;
  onClose: () => void;
  onSaved: (states: McpServerState[]) => void;
}) {
  const toast = useApp((s) => s.toast);
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<'stdio' | 'http'>('stdio');
  const [commandLine, setCommandLine] = useState('');
  const [url, setUrl] = useState('');
  const [env, setEnv] = useState('');
  const [busy, setBusy] = useState(false);

  // Re-seed whenever the dialog opens, so editing one server never leaks into adding the next.
  useEffect(() => {
    if (!open) return;
    setId(initial?.id ?? '');
    setName(initial?.name ?? '');
    setTransport(initial?.transport ?? 'stdio');
    setCommandLine(initial ? describeCommand({ ...initial, transport: 'stdio' }) : '');
    setUrl(initial?.url ?? '');
    setEnv(Object.entries(initial?.env ?? {}).map(([k, v]) => `${k}=${v}`).join('\n'));
  }, [open, initial]);

  const argv = parseCommandLine(commandLine);

  const save = async () => {
    setBusy(true);
    try {
      const envPairs = Object.fromEntries(
        env.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
          const eq = line.indexOf('=');
          return eq === -1 ? [line, ''] : [line.slice(0, eq).trim(), line.slice(eq + 1).trim()];
        }),
      );
      onSaved(await call('mcp:save', {
        id: id.trim(),
        name: name.trim() || id.trim(),
        transport,
        command: transport === 'stdio' ? argv[0] : undefined,
        args: transport === 'stdio' ? argv.slice(1) : undefined,
        env: transport === 'stdio' ? envPairs : undefined,
        url: transport === 'http' ? url.trim() : undefined,
        // Editing never changes whether a server runs; that is the switch on the list, on purpose.
        enabled: initial?.enabled ?? false,
      }));
      toast(initial ? 'Server updated' : 'Server added — switch it on when you’re ready', 'success');
      onClose();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const ready = id.trim().length > 0 && (transport === 'stdio' ? argv.length > 0 : url.trim().length > 0);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={initial ? `Edit “${initial.name}”` : 'Add an MCP server'}
      width={580}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!ready || busy} onClick={() => void save()}>{initial ? 'Save' : 'Add'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Stack label="Id" description="Short and unique. Tools are shown to models as id__toolname.">
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            disabled={!!initial}
            placeholder="filesystem"
            aria-label="Server id"
            spellCheck={false}
            className="h-9 w-full rounded-lg border border-line-strong bg-raised px-3 font-mono text-sm outline-none focus:border-accent disabled:text-ink-3"
          />
        </Stack>

        <Stack label="Name" description="What you'll see in this list.">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={id || 'Filesystem'}
            aria-label="Server name"
            className="h-9 w-full rounded-lg border border-line-strong bg-raised px-3 text-sm outline-none focus:border-accent"
          />
        </Stack>

        <Stack label="Connection">
          <Select
            label="Transport"
            className="w-full"
            value={transport}
            onChange={setTransport}
            options={[
              { value: 'stdio', label: 'Run a program on this computer (stdio)' },
              { value: 'http', label: 'Connect to a URL (http)' },
            ]}
          />
        </Stack>

        {transport === 'stdio' ? (
          <>
            <Stack
              label="Command"
              description="Run exactly as typed — there is no shell, so quotes group arguments but $VARS, pipes and ; do nothing."
            >
              <input
                value={commandLine}
                onChange={(e) => setCommandLine(e.target.value)}
                placeholder="npx -y @modelcontextprotocol/server-filesystem C:\Users\you\Documents"
                aria-label="Command line"
                spellCheck={false}
                className="h-9 w-full rounded-lg border border-line-strong bg-raised px-3 font-mono text-sm outline-none placeholder:font-sans placeholder:text-ink-3 focus:border-accent"
              />
            </Stack>
            {argv.length > 0 && (
              <div className="rounded-lg border border-line bg-raised px-3 py-2">
                <p className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Lumina will run</p>
                <ol className="mt-1 space-y-0.5 font-mono text-[12px]">
                  {argv.map((part, i) => (
                    <li key={i} className={i === 0 ? 'text-ink' : 'text-ink-2'}>
                      <span className="mr-2 text-ink-3">{i === 0 ? 'program' : `arg ${i}`}</span>{part}
                    </li>
                  ))}
                </ol>
              </div>
            )}
            <Stack label="Environment" description="One NAME=value per line. Optional.">
              <textarea
                value={env}
                onChange={(e) => setEnv(e.target.value)}
                rows={3}
                placeholder="API_TOKEN=…"
                aria-label="Environment variables"
                spellCheck={false}
                className="w-full resize-y rounded-lg border border-line-strong bg-raised px-3 py-2 font-mono text-[12px] outline-none placeholder:font-sans placeholder:text-ink-3 focus:border-accent"
              />
            </Stack>
          </>
        ) : (
          <Stack label="URL" description="An http or https MCP endpoint. Nothing else is accepted.">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/mcp"
              aria-label="Server URL"
              spellCheck={false}
              className="h-9 w-full rounded-lg border border-line-strong bg-raised px-3 font-mono text-sm outline-none placeholder:font-sans placeholder:text-ink-3 focus:border-accent"
            />
          </Stack>
        )}
      </div>
    </Dialog>
  );
}

/** Paste the `mcpServers` block from a server's README. Imports arrive switched off. */
function ImportDialog({ open, onClose, onSaved }: {
  open: boolean;
  onClose: () => void;
  onSaved: (states: McpServerState[]) => void;
}) {
  const toast = useApp((s) => s.toast);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const parsed = text.trim() ? parseMcpJson(text) : null;

  const run = async () => {
    if (!parsed?.ok) return;
    setBusy(true);
    try {
      let states: McpServerState[] = [];
      for (const config of parsed.configs) states = await call('mcp:save', config);
      onSaved(states);
      toast(`Imported ${parsed.configs.length} server${parsed.configs.length === 1 ? '' : 's'} — all switched off`, 'success');
      setText('');
      onClose();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Import servers from JSON"
      width={580}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!parsed?.ok || busy} onClick={() => void run()}>Import</Button>
        </>
      }
    >
      <p className="mb-3 text-[13px] leading-relaxed text-ink-3">
        Paste the <code className="font-mono">mcpServers</code> block from a server’s instructions. Everything is
        imported switched off, and each entry still has to pass the same checks as one you add by hand.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        spellCheck={false}
        aria-label="MCP JSON"
        placeholder={'{\n  "mcpServers": {\n    "filesystem": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]\n    }\n  }\n}'}
        className="w-full resize-y rounded-lg border border-line-strong bg-raised px-3 py-2 font-mono text-[12px] outline-none placeholder:text-ink-3 focus:border-accent"
      />
      {parsed && !parsed.ok && <p className="mt-2 text-[12px] text-danger">{parsed.reason}</p>}
      {parsed?.ok && (
        <p className="mt-2 text-[12px] text-ink-3">
          Found {parsed.configs.length}: {parsed.configs.map((c) => c.id).join(', ')}
        </p>
      )}
    </Dialog>
  );
}

function ServerCard({ state, onChanged, onEdit }: {
  state: McpServerState;
  onChanged: (states: McpServerState[]) => void;
  onEdit: () => void;
}) {
  const toast = useApp((s) => s.toast);
  const [open, setOpen] = useState(false);
  const status = STATUS[state.status];

  const guard = async (fn: () => Promise<McpServerState[]>) => {
    try {
      onChanged(await fn());
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  return (
    <div className="py-[var(--row-y)]">
      <div className="flex items-center gap-3">
        <span className={cn('size-2 shrink-0 rounded-full', status.dot)} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-ink">{state.config.name}</span>
            <Badge tone={status.tone}>{status.label}</Badge>
            {state.status === 'ready' && (
              <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink">
                {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                {state.tools.length} tool{state.tools.length === 1 ? '' : 's'}
              </button>
            )}
          </div>
          <p className="mt-0.5 truncate font-mono text-[12px] text-ink-3" title={describeCommand(state.config)}>
            {describeCommand(state.config)}
          </p>
        </div>
        <Switch
          label={`Enable ${state.config.name}`}
          checked={state.config.enabled}
          onChange={(v) => void guard(() => call('mcp:enable', { id: state.config.id, enabled: v }))}
        />
        <Button variant="ghost" size="sm" onClick={onEdit}>Edit</Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<Trash2 className="size-3.5" />}
          onClick={() => void guard(() => call('mcp:remove', { id: state.config.id }))}
        >
          Remove
        </Button>
      </div>

      {state.error && (
        <p className="mt-2 flex items-start gap-1.5 text-[12px] text-danger">
          <AlertCircle className="mt-px size-3.5 shrink-0" />
          {state.error}
        </p>
      )}

      {open && state.tools.length > 0 && (
        <ul className="mt-2 space-y-1 rounded-lg border border-line bg-raised p-2">
          {state.tools.map((tool) => (
            <li key={tool.name} className="text-[12px]">
              <span className="font-mono text-ink">{tool.name}</span>
              {tool.description && <span className="text-ink-3"> — {tool.description.slice(0, 200)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function McpSection() {
  const [states, setStates] = useState<McpServerState[]>([]);
  const [editing, setEditing] = useState<McpServerConfig | null>(null);
  const [dialog, setDialog] = useState<'none' | 'server' | 'import'>('none');

  useEffect(() => {
    void call('mcp:list').then(setStates).catch(() => {});
    // The main process broadcasts as servers start, connect or fail, so the list is never stale.
    return on('mcp:changed', setStates);
  }, []);

  const close = () => { setDialog('none'); setEditing(null); };

  return (
    <>
      <Group
        title="Connected tools (MCP)"
        description={
          <>
            Model Context Protocol servers give Lumina’s assistant extra abilities — reading a folder, searching
            an issue tracker, querying a database. Most “connectors” and plugins ship as MCP servers, so this one
            screen covers them. A server is a real program on your computer: it only runs when you switch it on,
            and Lumina shows you the exact command first.
          </>
        }
        action={
          <div className="flex shrink-0 gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDialog('import')}>Import JSON</Button>
            <Button variant="primary" size="sm" icon={<Plus className="size-3.5" />} onClick={() => { setEditing(null); setDialog('server'); }}>
              Add server
            </Button>
          </div>
        }
      >
        {states.length === 0 ? (
          <Row
            label={<span className="flex items-center gap-2 text-ink-3"><Plug className="size-4" /> No servers yet</span>}
            description="Add one above, or paste the JSON block from a server’s setup instructions."
          />
        ) : (
          states.map((state) => (
            <ServerCard
              key={state.config.id}
              state={state}
              onChanged={setStates}
              onEdit={() => { setEditing(state.config); setDialog('server'); }}
            />
          ))
        )}
      </Group>

      <ServerDialog open={dialog === 'server'} initial={editing} onClose={close} onSaved={setStates} />
      <ImportDialog open={dialog === 'import'} onClose={close} onSaved={setStates} />
    </>
  );
}
