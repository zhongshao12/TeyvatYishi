import { describe, expect, it } from 'vitest';
import { normalizeOpenCodeBaseUrl } from '@/services/ai/openCodeEndpointPolicy';

describe('OpenCode endpoint policy', () => {
  it.each([
    ['https://opencode.ai', 'https://opencode.ai/zen/v1'],
    ['https://opencode.ai/zen', 'https://opencode.ai/zen/v1'],
    ['https://opencode.ai/zen/go/v1', 'https://opencode.ai/zen/v1'],
    ['https://opencode.ai/zen/v1/chat/completions', 'https://opencode.ai/zen/v1'],
    ['https://opencode.ai/zen/v1/messages?debug=1', 'https://opencode.ai/zen/v1'],
    ['https://opencode.ai/zen/v1/responses/', 'https://opencode.ai/zen/v1'],
    ['https://opencode.ai/zen/v1/models/gemini-2.5-pro:streamGenerateContent?alt=sse', 'https://opencode.ai/zen/v1'],
    ['https://opencode.ai/zen/v1/models', 'https://opencode.ai/zen/v1'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeOpenCodeBaseUrl(input)).toBe(expected);
  });
});
