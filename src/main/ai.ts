// The user's own AI provider key. The key is stored with the OS keychain (safeStorage/DPAPI) and
// never enters settings.json, the renderer, or a log line — the renderer only ever learns whether
// one is set. Today this powers the lyrics fallback; the same plumbing is what a future AI
// extension would use.
import { shell } from 'electron';
import {
  authHeaders, buildChatRequest, explainAiError, extractText, keyLooksValid, providerById,
  type AiProviderId,
} from '../core/aiProviders';
import { deleteSecret, loadSecret, saveSecret } from './secrets';
import { settings } from './settings';
import { logger } from './log';

const log = logger('ai');
const SECRET = 'ai-key';

interface StoredKey { provider: AiProviderId; key: string }

export interface AiKeyStatus {
  provider: AiProviderId;
  model: string;
  /** Whether a key is stored for the selected provider. The key itself never crosses IPC. */
  hasKey: boolean;
  /** Last four characters, so the user can tell which key is in there. */
  hint: string | null;
}

const stored = (): StoredKey | null => loadSecret<StoredKey>(SECRET);

export function aiKeyStatus(): AiKeyStatus {
  const { provider, model } = settings.get().lyrics;
  const s = stored();
  const match = s && s.provider === provider && s.key.length > 0;
  return {
    provider,
    model,
    hasKey: Boolean(match),
    hint: match ? s!.key.slice(-4) : null,
  };
}

/** Save a key for a provider. Rejects an obviously malformed paste before it ever reaches the wire. */
export function setAiKey(provider: AiProviderId, key: string): AiKeyStatus {
  const trimmed = key.trim();
  if (!providerById(provider)) throw new Error('Pick a provider first.');
  if (!keyLooksValid(provider, trimmed)) throw new Error('That doesn’t look like a key for this provider.');
  saveSecret(SECRET, { provider, key: trimmed } satisfies StoredKey);
  settings.update({ lyrics: { provider } });
  log.info(`Stored an API key for ${provider}`);
  return aiKeyStatus();
}

export function clearAiKey(): AiKeyStatus {
  deleteSecret(SECRET);
  log.info('Removed the stored API key');
  return aiKeyStatus();
}

export const openKeyPage = async (provider: AiProviderId) => {
  const url = providerById(provider)?.keyUrl;
  if (url) await shell.openExternal(url);
};

/**
 * One-shot prompt against the user's provider. Returns null when no key is configured; throws with
 * a readable message when the provider refuses, so "Test key" can show something useful.
 */
export async function askAi(prompt: string, maxTokens = 1200): Promise<string | null> {
  const { provider, model } = settings.get().lyrics;
  const s = stored();
  if (provider === 'none' || !s || s.provider !== provider || !s.key) return null;

  const req = buildChatRequest(provider, model, prompt, maxTokens);
  if (!req) return null;
  const res = await fetch(req.url, {
    method: 'POST',
    headers: { ...req.headers, ...authHeaders(provider, s.key) },
    body: JSON.stringify(req.body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(explainAiError(res.status));
  return extractText(provider, await res.json());
}

/** "Test key": prove the key + model actually work, without pretending a canned answer is a test. */
export async function testAiKey(): Promise<string> {
  const answer = await askAi('Reply with exactly the word: ready', 16);
  if (answer == null) throw new Error('No key is set for the selected provider.');
  return answer.trim().slice(0, 80);
}
