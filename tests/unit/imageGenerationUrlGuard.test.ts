import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { 创建默认文生图API配置 } from '../../models/settings';
import { generateImage } from '../../services/ai/imageGeneration';

const UPSTREAM_PREFIX = 'https://image.example.com';

function buildConfig() {
  return {
    ...创建默认文生图API配置(),
    enabled: true,
    backend: 'openai_compatible' as const,
    baseUrl: 'https://image.example.com/v1',
    apiKey: 'test-token',
    model: 'gpt-image-1',
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** node 环境没有 FileReader；happy path 只关心 URL 校验没有把合法下载挡掉。 */
class StubFileReader {
  result: string | ArrayBuffer | null = null;
  error: Error | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  readAsDataURL(blob: Blob): void {
    void blob.arrayBuffer().then((buffer) => {
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buffer).toString('base64')}`;
      this.onload?.();
    }).catch((error: unknown) => {
      this.error = error instanceof Error ? error : new Error(String(error));
      this.onerror?.();
    });
  }
}

function stubFetch(handler: (url: string) => Promise<Response> | Response) {
  const spy = vi.fn(async (input: RequestInfo | URL) => handler(String(input)));
  vi.stubGlobal('fetch', spy as unknown as typeof fetch);
  return spy;
}

describe('remote image URL trust boundary', () => {
  beforeEach(() => {
    vi.stubGlobal('FileReader', StubFileReader);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refuses a provider image URL that targets a link-local address', async () => {
    const spy = stubFetch((url) => {
      if (url.startsWith(UPSTREAM_PREFIX)) return jsonResponse({ data: [{ url: 'http://169.254.169.254/latest/meta-data' }] });
      throw new Error(`不应请求 ${url}`);
    });

    await expect(generateImage(buildConfig(), { prompt: 'a clear portrait' })).rejects.toThrow('不受信任');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('refuses file:// image URLs returned by the upstream', async () => {
    const spy = stubFetch((url) => {
      if (url.startsWith(UPSTREAM_PREFIX)) return jsonResponse({ data: [{ url: 'file:///C:/Windows/win.ini' }] });
      throw new Error(`不应请求 ${url}`);
    });

    await expect(generateImage(buildConfig(), { prompt: 'a clear portrait' })).rejects.toThrow('不受信任');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('refuses an http:// provider URL from a third-party host', async () => {
    const spy = stubFetch((url) => {
      if (url.startsWith(UPSTREAM_PREFIX)) return jsonResponse({ data: [{ url: 'http://cdn.attacker.example/image.png' }] });
      throw new Error(`不应请求 ${url}`);
    });

    await expect(generateImage(buildConfig(), { prompt: 'a clear portrait' })).rejects.toThrow('不受信任');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not persist the remote URL when the image download fails', async () => {
    const spy = stubFetch((url) => {
      if (url.startsWith(UPSTREAM_PREFIX)) return jsonResponse({ data: [{ url: 'https://cdn.example.com/gone.png' }] });
      throw new Error('network down');
    });

    await expect(generateImage(buildConfig(), { prompt: 'a clear portrait' })).rejects.toThrow('图片下载失败');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('still downloads a public https image and keeps it as the provenance URL', async () => {
    const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const spy = stubFetch((url) => {
      if (url.startsWith(UPSTREAM_PREFIX)) return jsonResponse({ data: [{ url: 'https://cdn.example.com/ok.png' }] });
      if (url === 'https://cdn.example.com/ok.png') {
        return new Response(imageBytes, { status: 200, headers: { 'content-type': 'image/png' } });
      }
      throw new Error(`不应请求 ${url}`);
    });

    const result = await generateImage(buildConfig(), { prompt: 'a clear portrait' });

    expect(result.src.startsWith('data:image/png;base64,')).toBe(true);
    expect(result.originalUrl).toBe('https://cdn.example.com/ok.png');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('refuses a file:// reference image before contacting the provider', async () => {
    const spy = stubFetch(() => jsonResponse({ data: [{ b64_json: 'AA==' }] }));

    await expect(generateImage(buildConfig(), {
      prompt: 'a clear portrait',
      referenceImages: [{ src: 'file:///etc/passwd', role: 'character', weight: 1 }],
    })).rejects.toThrow('参考图地址不受信任');
    expect(spy).not.toHaveBeenCalled();
  });

  it('still accepts a data: reference image', async () => {
    const spy = stubFetch(() => jsonResponse({ data: [{ b64_json: 'AA==' }] }));

    const result = await generateImage(buildConfig(), {
      prompt: 'a clear portrait',
      referenceImages: [{ src: 'data:image/png;base64,AQID', role: 'character', weight: 1 }],
    });

    expect(result.src).toBe('data:image/png;base64,AA==');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
