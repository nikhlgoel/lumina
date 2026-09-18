// The user's own AI provider: which services Lumina can call with a key they supply, and how to
// shape the request/response for each. Pure description + parsing so it is unit-tested; the actual
// fetch (and the key, which never leaves the main process) lives in src/main/ai.ts.

export type AiProviderId = 'none' | 'openai' | 'anthropic' | 'gemini' | 'openrouter';

export interface AiProvider {
  id: Exclude<AiProviderId, 'none'>;
  label: string;
  /** Where the user gets a key — shown next to the input, opened in their real browser. */
  keyUrl: string;
  defaultModel: string;
  /** Rough shape check so an obviously-wrong paste is caught before a network call. */
  keyPattern: RegExp;
}

export const AI_PROVIDERS: AiProvider[] = [
  { id: 'openai', label: 'OpenAI', keyUrl: 'https://platform.openai.com/api-keys', defaultModel: 'gpt-4o-mini', keyPattern: /^sk-[A-Za-z0-9_-]{16,}$/ },
  { id: 'anthropic', label: 'Anthropic', keyUrl: 'https://console.anthropic.com/settings/keys', defaultModel: 'claude-haiku-4-5-20251001', keyPattern: /^sk-ant-[A-Za-z0-9_-]{16,}$/ },
  { id: 'gemini', label: 'Google Gemini', keyUrl: 'https://aistudio.google.com/apikey', defaultModel: 'gemini-2.0-flash', keyPattern: /^[A-Za-z0-9_-]{20,}$/ },
  { id: 'openrouter', label: 'OpenRouter', keyUrl: 'https://openrouter.ai/keys', defaultModel: 'openai/gpt-4o-mini', keyPattern: /^sk-or-[A-Za-z0-9_-]{16,}$/ },
];

export const providerById = (id: AiProviderId): AiProvider | null =>
  AI_PROVIDERS.find((p) => p.id === id) ?? null;

/** True when the key is at least the right shape for that provider. Never a guarantee it works. */
export function keyLooksValid(id: AiProviderId, key: string): boolean {
  const provider = providerById(id);
  if (!provider) return false;
  return provider.keyPattern.test(key.trim());
}

export interface ChatRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Build the one-shot completion call for a provider. Kept in one place so main stays thin. */
export function buildChatRequest(id: AiProviderId, model: string, prompt: string, maxTokens = 1200): ChatRequest | null {
  const m = model.trim() || providerById(id)?.defaultModel || '';
  switch (id) {
    case 'openai':
      return {
        url: 'https://api.openai.com/v1/chat/completions',
        headers: { 'Content-Type': 'application/json' },
        body: { model: m, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] },
      };
    case 'openrouter':
      return {
        url: 'https://openrouter.ai/api/v1/chat/completions',
        headers: { 'Content-Type': 'application/json', 'HTTP-Referer': 'https://github.com/nikhlgoel/lumina', 'X-Title': 'Lumina' },
        body: { model: m, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] },
      };
    case 'anthropic':
      return {
        url: 'https://api.anthropic.com/v1/messages',
        headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' },
        body: { model: m, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] },
      };
    case 'gemini':
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`,
        headers: { 'Content-Type': 'application/json' },
        body: { contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTokens } },
      };
    default:
      return null;
  }
}

/** The auth header for a provider — separated so the key is only added at the moment of the call. */
export function authHeaders(id: AiProviderId, key: string): Record<string, string> {
  switch (id) {
    case 'openai':
    case 'openrouter':
      return { Authorization: `Bearer ${key}` };
    case 'anthropic':
      return { 'x-api-key': key };
    case 'gemini':
      return { 'x-goog-api-key': key };
    default:
      return {};
  }
}

/** Pull the assistant's text out of whichever envelope the provider returned. Never throws. */
export function extractText(id: AiProviderId, payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  try {
    if (id === 'openai' || id === 'openrouter') {
      const choices = p.choices as { message?: { content?: unknown } }[] | undefined;
      const text = choices?.[0]?.message?.content;
      return typeof text === 'string' && text.trim() ? text : null;
    }
    if (id === 'anthropic') {
      const content = p.content as { type?: string; text?: unknown }[] | undefined;
      const text = content?.find((c) => c?.type === 'text')?.text;
      return typeof text === 'string' && text.trim() ? text : null;
    }
    if (id === 'gemini') {
      const candidates = p.candidates as { content?: { parts?: { text?: unknown }[] } }[] | undefined;
      const parts = candidates?.[0]?.content?.parts ?? [];
      const text = parts.map((x) => (typeof x?.text === 'string' ? x.text : '')).join('').trim();
      return text || null;
    }
  } catch {
    // Remote shape drifted; treat it as no answer rather than crashing the lyrics lookup.
  }
  return null;
}

/** Message for an HTTP failure that says what the user can actually do about it. */
export function explainAiError(status: number): string {
  if (status === 401 || status === 403) return 'That key was rejected. Check it, or make sure it has credit.';
  if (status === 404) return 'That model name isn’t available on this account.';
  if (status === 429) return 'The provider is rate-limiting this key right now. Try again shortly.';
  if (status >= 500) return 'The provider had a server error. Try again shortly.';
  return `The provider replied ${status}.`;
}
