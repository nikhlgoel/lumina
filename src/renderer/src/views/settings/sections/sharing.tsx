// "Share to TV" — the DLNA/UPnP server, which makes a television list Lumina beside HDMI and AV.
//
// The tone here is deliberate. DLNA has no authentication of any kind, so switching this on really
// does mean "anyone on this network can browse and play my library". That is the protocol's design
// rather than a shortcut in Lumina, and it belongs on the screen in plain words — not in a tooltip,
// and not softened.
import { useEffect, useState } from 'react';
import { Cast, CircleAlert, Copy } from 'lucide-react';
import type { DlnaStatus } from '@shared/types';
import { call, errorMessage, on } from '@/lib/bridge';
import { useApp } from '@/stores/app';
import { Badge, Button, Switch } from '@/components/ui';
import { Group, NumberInput, Row, TextInput, type SectionProps } from '../controls';

export function SharingSection({ s, set }: SectionProps) {
  const toast = useApp((x) => x.toast);
  const [status, setStatus] = useState<DlnaStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void call('dlna:status').then(setStatus).catch(() => {});
    // Starting binds a socket, so the truth comes from main, not from the switch position.
    return on('dlna:changed', setStatus);
  }, []);

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    try {
      setStatus(await call('dlna:set-enabled', { enabled }));
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const running = status?.running ?? false;

  return (
    <>
      <Group
        title="Share to TV"
        description={
          <>
            Lets a TV, games console or another player on this network find Lumina and play from your library —
            the same way it lists HDMI and AV. Your TV needs to be on the network and support DLNA; many sets call
            it “Media”, “Home Network” or “DMP”.
          </>
        }
      >
        <Row
          id="dlnaEnabled"
          label="Share my library on this network"
          description={
            running
              ? 'Running. Look for it in your TV’s source or media list.'
              : s.sharing.dlnaEnabled
                ? 'Switched on, but it isn’t running — see the reason below.'
                : 'Off. Nothing is shared and no port is open.'
          }
        >
          <span className="flex items-center gap-2">
            {status && (
              <Badge tone={running ? 'success' : s.sharing.dlnaEnabled ? 'warning' : 'neutral'}>
                {running ? 'Sharing' : s.sharing.dlnaEnabled ? 'Not working' : 'Off'}
              </Badge>
            )}
            <Switch
              label="Share my library on this network"
              disabled={busy}
              checked={s.sharing.dlnaEnabled}
              onChange={(v) => void toggle(v)}
            />
          </span>
        </Row>

        {status?.error && (
          <Row
            label={<span className="flex items-center gap-1.5 text-danger"><CircleAlert className="size-4" /> It couldn’t start</span>}
            description={status.error}
          />
        )}

        {running && status?.location && (
          <Row
            id="dlnaAddress"
            label="Address"
            description="If the TV can’t find Lumina by itself, some players let you type this in. It’s also worth checking that this address is on the same network as your TV."
          >
            <span className="flex items-center gap-2">
              <code className="rounded bg-hover px-2 py-1 font-mono text-[12px]">{status.location}</code>
              <Button
                variant="ghost"
                size="sm"
                icon={<Copy className="size-3.5" />}
                onClick={() => void navigator.clipboard.writeText(status.location ?? '').then(() => toast('Address copied', 'success'))}
              >
                Copy
              </Button>
            </span>
          </Row>
        )}

        <Row
          id="dlnaName"
          label="Name shown on the TV"
          description="Leave empty to use “Lumina on” plus this computer’s name."
        >
          <TextInput
            value={s.sharing.dlnaName}
            placeholder={status?.friendlyName ?? 'Lumina'}
            onCommit={(v) => void set({ sharing: { dlnaName: v } })}
          />
        </Row>

        <Row
          id="dlnaPort"
          label="Port"
          description="Only worth changing if something else on this PC already uses 8200. Switch sharing off and on again after changing it."
        >
          <NumberInput
            value={s.sharing.dlnaPort}
            min={1024}
            max={65535}
            onCommit={(v) => void set({ sharing: { dlnaPort: v } })}
          />
        </Row>
      </Group>

      <Group title="Before you switch it on">
        <Row
          label={<span className="flex items-center gap-1.5"><Cast className="size-4 text-ink-3" /> There is no password on this</span>}
          description={
            <>
              DLNA has no way to ask for one — that is how the protocol works, on every media server, not something
              Lumina left out. While sharing is on, <strong>anyone who can reach this computer on the network can
              browse and play your whole library</strong>. On your own home network that is usually fine. On shared
              or public Wi-Fi, leave it off. Lumina only listens on your local network and never opens your router
              to the internet; nothing can be deleted or changed through it, only played.
            </>
          }
        />
        <Row
          label="Windows will ask about the firewall"
          description="The first time you switch this on, Windows asks whether to allow Lumina on the network. Allow it for private networks — if you refuse, sharing runs but no TV can reach it."
        />
      </Group>
    </>
  );
}
