import { describe, expect, it } from 'vitest';
import type { API配置项, AI提供商 } from '../../models/settings';
import {
  detectChatProvider,
  isLikelyClaudeModel,
  shouldUseClaudeMessagesApi,
} from '../../services/ai/providerRouting';

function config(overrides: Partial<API配置项> = {}): API配置项 {
  return {
    id: 'route-test',
    name: 'route test',
    provider: 'openai_compatible',
    baseUrl: 'https://proxy.example/v1',
    apiKey: 'test-key',
    model: 'generic-chat',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('providerRouting', () => {
  it.each<[AI提供商, string]>([
    ['mimo', 'mimo'],
    ['ark', 'ark'],
    ['opencode', 'opencode'],
    ['deepseek', 'deepseek'],
    ['gemini', 'gemini'],
    ['claude', 'claude'],
    ['openai', 'openai_compatible'],
    ['openai_compatible', 'openai_compatible'],
  ])('honors explicit %s provider routing', (provider, expected) => {
    expect(detectChatProvider(config({ provider }))).toBe(expected);
  });

  it.each([
    ['https://api.xiaomimimo.com/v1', 'mimo'],
    ['https://ark.cn-beijing.volces.com/api/v3', 'ark'],
    ['https://opencode.ai/zen/v1', 'opencode'],
    ['https://api.deepseek.com/v1', 'deepseek'],
    ['https://generativelanguage.googleapis.com/v1beta', 'gemini'],
  ])('infers %s as %s', (baseUrl, expected) => {
    expect(detectChatProvider(config({ provider: '' as AI提供商, baseUrl }))).toBe(expected);
  });

  it('guards Claude-compatible routing with both the mode and model family', () => {
    const claude = config({
      provider: 'claude_compatible',
      enableClaudeMode: true,
      model: 'anthropic/claude-sonnet-4',
    });

    expect(isLikelyClaudeModel(claude.model)).toBe(true);
    expect(shouldUseClaudeMessagesApi(claude)).toBe(true);
    expect(detectChatProvider(claude)).toBe('claude');
    expect(detectChatProvider({ ...claude, enableClaudeMode: false })).toBe('openai_compatible');
    expect(detectChatProvider({ ...claude, model: 'gemini-2.5-pro' })).toBe('openai_compatible');
  });

  it('always routes the official Claude provider through Messages API', () => {
    const official = config({ provider: 'claude', enableClaudeMode: false, model: 'custom-name' });
    expect(shouldUseClaudeMessagesApi(official)).toBe(true);
    expect(detectChatProvider(official)).toBe('claude');
  });

  it('does not override an explicit OpenAI-compatible provider from URL or model substrings', () => {
    expect(detectChatProvider(config({
      provider: 'openai_compatible',
      baseUrl: 'https://relay.example.com/googleapis/v1',
      model: 'vendor/gemini-compatible-chat',
    }))).toBe('openai_compatible');
  });
});
