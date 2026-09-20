import { describe, expect, it } from 'vitest';
import { 创建空API设置, type API配置项 } from '../../models/settings';

describe('active API configuration resolution', () => {
  it('falls back to the first configuration and applies the runtime Claude mode consistently', async () => {
    const module = await import('../../services/ai/activeApiConfig');
    const first: API配置项 = {
      id: 'first',
      name: 'Main',
      provider: 'openai_compatible',
      baseUrl: 'https://example.invalid',
      apiKey: 'test',
      model: 'test-model',
      enableClaudeMode: false,
      createdAt: 1,
      updatedAt: 1,
    };
    const settings = {
      ...创建空API设置(),
      activeConfigId: 'missing',
      configs: [first],
    };

    const resolved = module.resolveActiveApiConfig(settings, true);

    expect(resolved).toMatchObject({ id: 'first', enableClaudeMode: true });
    expect(resolved).not.toBe(first);
  });
});
