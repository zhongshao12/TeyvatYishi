import { describe, expect, it } from 'vitest';
import * as modelCatalog from '@/services/ai/openAICompatibleModels';

describe('model catalog credential safety', () => {
  it('uses a deterministic digest rather than the plaintext API key in cache identity', async () => {
    const buildKey = Reflect.get(modelCatalog, 'buildOpenAICompatibleModelCacheKey') as undefined | ((baseUrl: string, apiKey: string) => Promise<string>);
    expect(buildKey).toBeTypeOf('function');
    const first = await buildKey?.('https://example.test/v1/', 'super-secret-token');
    const same = await buildKey?.('https://example.test/v1', 'super-secret-token');
    const different = await buildKey?.('https://example.test/v1', 'other-token');
    expect(first).toBe(same);
    expect(first).not.toBe(different);
    expect(first).not.toContain('super-secret-token');
  });
});
