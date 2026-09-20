import { afterEach, describe, expect, it, vi } from 'vitest';
import { 创建默认文生图API配置 } from '../../models/settings';
import { generateImage } from '../../services/ai/imageGeneration';

describe('NovelAI image responses', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports missing image data instead of reading a JSON response body twice', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ data: [] }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    )));
    const config = {
      ...创建默认文生图API配置(),
      enabled: true,
      backend: 'novelai' as const,
      baseUrl: 'https://image.novelai.net',
      apiKey: 'test-token',
      model: 'nai-diffusion-3',
      presetPath: 'novelai_generate' as const,
    };

    await expect(generateImage(config, { prompt: 'a clear portrait' })).rejects.toThrow(
      'NovelAI 图片接口返回 JSON，但未包含可用的图片数据。',
    );
  });
});
