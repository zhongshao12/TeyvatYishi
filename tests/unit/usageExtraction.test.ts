import { describe, expect, it } from 'vitest';
import type { API配置项 } from '@/models/settings';
import { extractUsage } from '@/services/ai/usageExtraction';

const config = (provider: API配置项['provider'], model: string): API配置项 => ({
  provider,
  model,
} as API配置项);

describe('usage extraction', () => {
  it('normalizes OpenAI-compatible usage and derives the cache hit rate', () => {
    const usage = extractUsage({
      usage: {
        prompt_tokens: 100,
        completion_tokens: 25,
        total_tokens: 125,
        prompt_tokens_details: { cached_tokens: 40 },
      },
    }, config('openai', 'gpt-4o'));

    expect(usage).toMatchObject({
      inputTokens: 100,
      outputTokens: 25,
      totalTokens: 125,
      cachedTokens: 40,
      uncachedTokens: 60,
      cacheHitRate: 0.4,
      usageFormat: 'openai_compatible',
      usagePath: 'usage',
      source: 'api',
    });
  });

  it('recognizes Gemini native fields', () => {
    const usage = extractUsage({
      usageMetadata: {
        promptTokenCount: 80,
        candidatesTokenCount: 20,
        totalTokenCount: 100,
        cachedContentTokenCount: 30,
      },
    }, config('gemini', 'gemini-2.5-pro'));

    expect(usage).toMatchObject({
      inputTokens: 80,
      outputTokens: 20,
      totalTokens: 100,
      cachedTokens: 30,
      uncachedTokens: 50,
      usageFormat: 'gemini_native',
      usagePath: 'usageMetadata',
    });
  });

  it('merges cache-rich and core token payloads without losing either signal', () => {
    const usage = extractUsage({
      usage: { prompt_tokens: 60, completion_tokens: 15, total_tokens: 75 },
      usageMetadata: { cachedContentTokenCount: 24 },
    }, config('gemini', 'gemini-compatible'));

    expect(usage).toMatchObject({
      inputTokens: 60,
      outputTokens: 15,
      totalTokens: 75,
      cachedTokens: 24,
      usagePath: 'usageMetadata+usage',
    });
  });

  it('returns null when the response contains no numeric usage signal', () => {
    expect(extractUsage({ usage: { note: 'not provided' } }, config('openai', 'test'))).toBeNull();
  });
});
