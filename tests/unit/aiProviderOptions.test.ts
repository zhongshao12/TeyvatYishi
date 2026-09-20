import { describe, expect, it } from 'vitest';
import { AI_PROVIDER_OPTIONS, getAIProviderOption } from '@/data/aiProviderOptions';

describe('AI provider options', () => {
  it('keeps each provider unique and supplies usable defaults', () => {
    expect(new Set(AI_PROVIDER_OPTIONS.map((option) => option.value)).size).toBe(AI_PROVIDER_OPTIONS.length);
    expect(AI_PROVIDER_OPTIONS.every((option) => option.label && option.defaultBaseUrl.startsWith('https://') && option.defaultModel)).toBe(true);
  });

  it('uses OpenCode Zen canonical defaults', () => {
    expect(getAIProviderOption('opencode')).toMatchObject({
      label: 'OpenCode Zen',
      defaultBaseUrl: 'https://opencode.ai/zen/v1',
      defaultModel: 'deepseek-v4-flash',
    });
  });

  it('falls back to the OpenAI-compatible option for unknown persisted values', () => {
    expect(getAIProviderOption('removed-provider' as never).value).toBe('openai_compatible');
  });
});
