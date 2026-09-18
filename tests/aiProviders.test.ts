import { describe, it, expect } from 'vitest';
import {
  AI_PROVIDERS, authHeaders, buildChatRequest, explainAiError, extractText, keyLooksValid, providerById,
} from '@core/aiProviders';

describe('providers', () => {
  it('every provider has a default model and a place to get a key', () => {
    for (const p of AI_PROVIDERS) {
      expect(p.defaultModel).toBeTruthy();
      expect(p.keyUrl).toMatch(/^https:\/\//);
      expect(providerById(p.id)).toBe(p);
    }
  });

  it('"none" is not a provider', () => {
    expect(providerById('none')).toBeNull();
    expect(buildChatRequest('none', 'x', 'hi')).toBeNull();
    expect(authHeaders('none', 'k')).toEqual({});
  });
});

describe('keyLooksValid', () => {
  it('accepts the right shape and rejects the wrong one', () => {
    expect(keyLooksValid('openai', 'sk-abcdefghijklmnopqrst')).toBe(true);
    expect(keyLooksValid('openai', 'sk-ant-abcdefghijklmnopqrst')).toBe(true); // still an sk- key
    expect(keyLooksValid('anthropic', 'sk-abcdefghijklmnopqrst')).toBe(false);
    expect(keyLooksValid('anthropic', 'sk-ant-abcdefghijklmnopqrst')).toBe(true);
    expect(keyLooksValid('openrouter', 'sk-or-abcdefghijklmnopqrst')).toBe(true);
  });

  it('ignores surrounding whitespace from a paste', () => {
    expect(keyLooksValid('openai', '  sk-abcdefghijklmnopqrst\n')).toBe(true);
  });

  it('rejects empties and an unknown provider', () => {
    expect(keyLooksValid('openai', '')).toBe(false);
    expect(keyLooksValid('none', 'sk-abcdefghijklmnopqrst')).toBe(false);
  });
});

describe('buildChatRequest', () => {
  it('targets each provider’s own endpoint', () => {
    expect(buildChatRequest('openai', 'gpt-4o-mini', 'hi')!.url).toContain('api.openai.com');
    expect(buildChatRequest('anthropic', 'claude-haiku-4-5-20251001', 'hi')!.url).toContain('api.anthropic.com');
    expect(buildChatRequest('gemini', 'gemini-2.0-flash', 'hi')!.url).toContain('generativelanguage.googleapis.com');
    expect(buildChatRequest('openrouter', 'openai/gpt-4o-mini', 'hi')!.url).toContain('openrouter.ai');
  });

  it('falls back to the provider default when no model is given', () => {
    const body = buildChatRequest('openai', '   ', 'hi')!.body as { model: string };
    expect(body.model).toBe('gpt-4o-mini');
  });

  it('url-encodes the model into the Gemini path', () => {
    expect(buildChatRequest('gemini', 'models/a b', 'hi')!.url).toContain('models%2Fa%20b');
  });

  it('never puts the key in the request it builds', () => {
    const req = buildChatRequest('openai', 'gpt-4o-mini', 'hi')!;
    expect(JSON.stringify(req)).not.toContain('sk-');
  });
});

describe('authHeaders', () => {
  it('uses each provider’s own scheme', () => {
    expect(authHeaders('openai', 'K')).toEqual({ Authorization: 'Bearer K' });
    expect(authHeaders('openrouter', 'K')).toEqual({ Authorization: 'Bearer K' });
    expect(authHeaders('anthropic', 'K')).toEqual({ 'x-api-key': 'K' });
    expect(authHeaders('gemini', 'K')).toEqual({ 'x-goog-api-key': 'K' });
  });
});

describe('extractText', () => {
  it('reads an OpenAI-shaped reply', () => {
    expect(extractText('openai', { choices: [{ message: { content: 'hello' } }] })).toBe('hello');
    expect(extractText('openrouter', { choices: [{ message: { content: 'hello' } }] })).toBe('hello');
  });

  it('reads an Anthropic-shaped reply, skipping non-text blocks', () => {
    expect(extractText('anthropic', { content: [{ type: 'thinking' }, { type: 'text', text: 'hello' }] })).toBe('hello');
  });

  it('joins Gemini parts', () => {
    expect(extractText('gemini', { candidates: [{ content: { parts: [{ text: 'he' }, { text: 'llo' }] } }] })).toBe('hello');
  });

  it('returns null for empty, missing or unexpected shapes instead of throwing', () => {
    expect(extractText('openai', null)).toBeNull();
    expect(extractText('openai', {})).toBeNull();
    expect(extractText('openai', { choices: [] })).toBeNull();
    expect(extractText('openai', { choices: [{ message: { content: '   ' } }] })).toBeNull();
    expect(extractText('anthropic', { content: 'not-an-array' })).toBeNull();
    expect(extractText('gemini', { candidates: [{}] })).toBeNull();
    expect(extractText('none', { choices: [{ message: { content: 'x' } }] })).toBeNull();
  });
});

describe('explainAiError', () => {
  it('turns a status into something the user can act on', () => {
    expect(explainAiError(401)).toMatch(/key was rejected/i);
    expect(explainAiError(429)).toMatch(/rate-limit/i);
    expect(explainAiError(503)).toMatch(/server error/i);
    expect(explainAiError(418)).toContain('418');
  });
});
