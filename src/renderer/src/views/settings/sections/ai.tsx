// "Your AI key" — bring your own provider. The key goes straight to the main process and into the
// OS keychain; the renderer only ever sees whether one is stored and its last four characters.
import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { AI_PROVIDERS } from '@core/aiProviders';
import type { AiKeyStatus } from '@shared/types';
import { call, errorMessage } from '@/lib/bridge';
import { useApp } from '@/stores/app';
import { Button, Select, Switch } from '@/components/ui';
import { Group, Row, TextInput, type SectionProps } from '../controls';

type Provider = AiKeyStatus['provider'];
type RealProvider = Exclude<Provider, 'none'>;

export function AiSection({ s, set }: SectionProps) {
  const toast = useApp((s2) => s2.toast);
  const [status, setStatus] = useState<AiKeyStatus | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = () => void call('ai:key-status').then(setStatus).catch(() => {});
  useEffect(refresh, []);

  const provider = s.lyrics.provider;
  const chosen = AI_PROVIDERS.find((p) => p.id === provider) ?? null;

  const save = async () => {
    if (provider === 'none') return;
    setBusy(true);
    try {
      setStatus(await call('ai:set-key', { provider: provider as RealProvider, key }));
      setKey('');
      toast('Key saved to this computer’s keychain', 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      toast(`Provider replied: “${await call('ai:test-key')}”`, 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    try {
      setStatus(await call('ai:clear-key'));
      toast('Key removed', 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  return (
    <>
      <Group
        title="Your own AI key"
        description="Optional. Lumina has no AI account of its own — if you want AI features, you bring a key from a provider you already pay for. It is stored encrypted by Windows on this computer and is only ever sent to the provider you pick."
      >
        <Row id="aiProvider" label="Provider">
          <Select
            label="AI provider"
            value={provider}
            onChange={(v) => set({ lyrics: { provider: v as Provider } })}
            options={[{ value: 'none', label: 'None' }, ...AI_PROVIDERS.map((p) => ({ value: p.id, label: p.label }))]}
          />
        </Row>

        {chosen && (
          <>
            <Row id="aiModel" label="Model" description={`Leave empty to use ${chosen.defaultModel}.`}>
              <TextInput value={s.lyrics.model} placeholder={chosen.defaultModel} onCommit={(v) => set({ lyrics: { model: v } })} mono />
            </Row>
            <Row
              id="aiKey"
              label="API key"
              description={status?.hasKey ? `A key ending …${status.hint} is stored. Paste a new one to replace it.` : 'Nothing stored yet.'}
              stacked
            >
              <div className="flex w-full flex-wrap items-center gap-2">
                <input
                  type="password"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder={`${chosen.label} API key`}
                  aria-label={`${chosen.label} API key`}
                  autoComplete="off"
                  spellCheck={false}
                  className="h-9 min-w-0 flex-1 rounded-lg border border-line-strong bg-raised px-3 font-mono text-sm outline-none placeholder:font-sans placeholder:text-ink-3 focus:border-accent"
                />
                <Button variant="primary" size="sm" disabled={busy || key.trim().length < 8} onClick={() => void save()}>Save key</Button>
                {status?.hasKey && <Button variant="ghost" size="sm" disabled={busy} onClick={() => void test()}>Test</Button>}
                {status?.hasKey && <Button variant="ghost" size="sm" onClick={() => void clear()}>Remove</Button>}
                <Button variant="ghost" size="sm" icon={<ExternalLink className="size-3.5" />}
                  onClick={() => void call('ai:open-key-page', { provider: chosen.id }).catch(() => {})}>
                  Get a key
                </Button>
              </div>
            </Row>
          </>
        )}
      </Group>

      <Group title="Lyrics">
        <Row
          id="aiLyrics"
          label="Ask your AI for lyrics as a last resort"
          description="Only when the real lyrics sources have nothing. A language model recalls lyrics from memory, so it can paraphrase or get them wrong — these are labelled “AI, unverified” in the player. Uses your key and costs you money."
        >
          <Switch
            label="AI lyrics fallback"
            disabled={provider === 'none' || !status?.hasKey}
            checked={s.lyrics.aiFallback}
            onChange={(v) => set({ lyrics: { aiFallback: v } })}
          />
        </Row>
      </Group>
    </>
  );
}
