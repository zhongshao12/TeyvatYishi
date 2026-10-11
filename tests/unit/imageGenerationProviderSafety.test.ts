import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { 创建默认文生图API配置 } from '@/models/settings';
import { generateImage, testImageGenerationConnection } from '@/services/ai/imageGeneration';

class TestFileReader {
  result = '';
  onload?: () => void;
  readAsDataURL(blob: Blob) {
    void blob.arrayBuffer().then(bytes => {
      this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`;
      this.onload?.();
    });
  }
}

const config = { ...创建默认文生图API配置(), enabled: true, baseUrl: 'https://images.example', apiKey: 'test-only', model: 'nai-diffusion-3' };

describe('image provider response safety', () => {
  beforeEach(() => vi.stubGlobal('FileReader', TestFileReader));
  afterEach(() => vi.unstubAllGlobals());

  it('does not report a missing NovelAI endpoint as reachable', async () => {
    vi.stubGlobal('fetch', async () => new Response('missing', { status: 404 }));
    await expect(testImageGenerationConnection({ ...config, backend: 'novelai' })).rejects.toThrow('404');
  });

  it('does not claim OPTIONS verified the NovelAI token', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 204 }));
    await expect(testImageGenerationConnection({ ...config, backend: 'novelai' })).resolves.toContain('未验证');
  });

  it('rejects a successful HTTP response containing HTML instead of a NovelAI image', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html>unavailable</html>', { headers: { 'content-type': 'text/html' } }));
    await expect(generateImage({ ...config, backend: 'novelai' }, { prompt: 'portrait' })).rejects.toThrow('图片');
  });

  it('rejects HTML downloaded from a provider image URL', async () => {
    vi.stubGlobal('fetch', async (url: string) => url.startsWith('https://images.example')
      ? Response.json({ data: [{ url: 'https://cdn.example/image.png' }] })
      : new Response('<html>expired</html>', { headers: { 'content-type': 'text/html' } }));
    await expect(generateImage({ ...config, backend: 'openai_compatible' }, { prompt: 'portrait' })).rejects.toThrow('图片');
  });

  it('rejects an empty successful image response', async () => {
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array(), { headers: { 'content-type': 'image/png' } }));
    await expect(generateImage({ ...config, backend: 'novelai' }, { prompt: 'portrait' })).rejects.toThrow('图片');
  });

  it('submits ComfyUI prompts with quotes, backslashes and line breaks without corrupting workflow JSON', async () => {
    const positive = 'a "red" cape\\wind\nmoonlight';
    const negative = 'text "logo"\nblur';
    let submitted: unknown;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.includes('/object_info/')) return Response.json({});
      submitted = JSON.parse(String(init?.body));
      return new Response('submission reached', { status: 418 });
    });
    const workflow = JSON.stringify({
      '1': { class_type: 'CLIPTextEncode', inputs: { text: '__PROMPT__' } },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: '{{negative_prompt}}' } },
      '3': { class_type: 'EmptyLatentImage', inputs: { width: '__WIDTH__', height: '__HEIGHT__' } },
    });
    await expect(generateImage({ ...config, backend: 'comfyui', negativePrompt: '', comfyWorkflowJson: workflow }, {
      prompt: positive, negativePrompt: negative, size: '1024x1024',
    })).rejects.toThrow('418');
    expect(submitted).toMatchObject({ prompt: {
      '1': { inputs: { text: positive } },
      '2': { inputs: { text: negative } },
      '3': { inputs: { width: 1024, height: 1024 } },
    } });
  });
});
