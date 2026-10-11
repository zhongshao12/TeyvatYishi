import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { 创建默认文生图API配置, 归一化文生图API配置, type 文生图API配置 } from '@/models/settings';
import { generateImage, testImageGenerationConnection } from '@/services/ai/imageGeneration';
import { runImageGenerationWithRetry } from '@/utils/imageGenerationRetry';
import { referenceBackendCapability } from '@/components/features/GameSystems/album/referenceInjection';
import { 创建默认游戏设置 } from '@/models/settings';
import { evaluateNewGameApiReadiness } from '@/utils/newGameApiReadiness';
import * as latentAdapter from '@/services/ai/latentImageGeneration';
import { buildNpcImagePrompt } from '@/utils/imagePromptRules';
import type { NPC记录 } from '@/models/npc';

const config = (): 文生图API配置 => ({
  ...创建默认文生图API配置(), enabled: true, backend: 'latent' as 文生图API配置['backend'],
  baseUrl: 'https://latent.moe', apiKey: 'lat_sk_test_only', model: '', seed: 0,
});

// Stored ZIP with a tiny PNG fixture; the real ZIP reader is exercised, not mocked.
function imageZip() {
  const image = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
  const name = new TextEncoder().encode('image_0.png');
  const bytes = new Uint8Array(30 + name.length + image.length + 46 + name.length + 22);
  const view = new DataView(bytes.buffer);
  const central = 30 + name.length + image.length;
  view.setUint32(0, 0x04034b50, true);
  view.setUint32(18, image.length, true); view.setUint32(22, image.length, true);
  view.setUint16(26, name.length, true); bytes.set(name, 30); bytes.set(image, 30 + name.length);
  view.setUint32(central, 0x02014b50, true);
  view.setUint32(central + 20, image.length, true); view.setUint32(central + 24, image.length, true);
  view.setUint16(central + 28, name.length, true); bytes.set(name, central + 46);
  const end = central + 46 + name.length;
  view.setUint32(end, 0x06054b50, true); view.setUint16(end + 8, 1, true); view.setUint16(end + 10, 1, true);
  view.setUint32(end + 12, 46 + name.length, true); view.setUint32(end + 16, central, true);
  return new Response(bytes, { headers: { 'content-type': 'application/zip' } });
}

class TestFileReader {
  result = ''; onload?: () => void;
  readAsDataURL(blob: Blob) {
    void blob.arrayBuffer().then(bytes => {
      this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`;
      this.onload?.();
    });
  }
}

describe('Latent browser-compatible generation', () => {
  beforeEach(() => { vi.stubGlobal('FileReader', TestFileReader); vi.stubGlobal('window', globalThis); });
  afterEach(() => {
    const acknowledge = Reflect.get(latentAdapter, 'acknowledgeLatentJobResolved');
    if (typeof acknowledge === 'function') acknowledge(config());
    vi.useRealTimers(); vi.unstubAllGlobals();
  });

  it('uses the documented endpoint and flattens scene characters rather than losing them in V4 fields', async () => {
    let endpoint = ''; let authorization = ''; let payload: any;
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      endpoint = url; authorization = new Headers(init.headers).get('authorization') || '';
      payload = JSON.parse(String(init.body)); return imageZip();
    });
    const result = await generateImage(config(), { prompt: 'sunlit Mondstadt', size: '1280x720', storySnapshotContext: {
      schemaVersion: 1, scenePrompt: 'sunlit Mondstadt', sceneNegativePrompt: 'fog', stylePrompt: 'watercolor',
      characters: [
        { name: 'Amber', subjectType: 'girl', visualPrompt: 'Amber, red ribbon', negativePrompt: 'blue ribbon', source: 'npc' },
        { name: 'Lisa', subjectType: 'girl', visualPrompt: 'Lisa, purple witch hat', negativePrompt: '', source: 'npc' },
        { name: 'Hidden', subjectType: 'girl', visualPrompt: 'hidden character', negativePrompt: '', source: 'npc', enabled: false },
      ],
    } });
    expect(endpoint).toBe('https://latent.moe/api/novelai/ai/generate-image');
    expect(authorization).toBe('Bearer lat_sk_test_only');
    expect(payload.input).toContain('red ribbon'); expect(payload.input).toContain('purple witch hat');
    expect(payload.input).not.toContain('hidden character'); expect(payload.parameters.uc).toContain('blue ribbon');
    expect(payload.parameters).toMatchObject({ width: 1536, height: 920, steps: 12, seed: 0 });
    expect(payload.parameters.characterPrompts).toBeUndefined(); expect(payload.parameters.v4_prompt).toBeUndefined();
    expect(payload.parameters.scale).toBeUndefined();
    expect(result).toMatchObject({ backend: 'latent', mimeType: 'image/png' });
    expect(result.src).toMatch(/^data:image\/png;base64,iVBOR/);
  });

  it('disallows reference images before contacting the service', async () => {
    const fetch = vi.fn(async () => imageZip()); vi.stubGlobal('fetch', fetch);
    await expect(generateImage(config(), { prompt: 'portrait', referenceImages: [{ src: 'data:image/png;base64,AA==' }] })).rejects.toThrow('参考图');
    expect(fetch).not.toHaveBeenCalled();
    expect(referenceBackendCapability(config().backend, 创建默认游戏设置().文生图系统.参考图).message).toContain('Latent');
  });

  it('does not repeat scene and negative captions already included in the expanded narrative prompt', async () => {
    const scene = 's'.repeat(1200);
    let payload: any;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => { payload = JSON.parse(String(init.body)); return imageZip(); });
    await generateImage(config(), { prompt: `${scene}, watercolor, quality`, negativePrompt: 'fog, low quality', storySnapshotContext: {
      schemaVersion: 1, scenePrompt: scene, sceneNegativePrompt: 'fog', stylePrompt: 'watercolor',
      characters: [{ name: 'Amber', source: 'npc', subjectType: 'girl', visualPrompt: 'red-haired character', negativePrompt: 'low quality' }],
    } });
    expect(payload.input).toBe(`${scene}, watercolor, quality, red-haired character`);
    expect(payload.parameters.uc).toBe('fog, low quality');
  });

  it.each([502, 503, 504])('pauses queued jobs after HTTP %s until the player acknowledges the control panel', async status => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => ++calls === 1 ? new Response('upstream unavailable', { status }) : imageZip());
    const first = generateImage(config(), { prompt: 'first' });
    const second = generateImage(config(), { prompt: 'waiting' });
    const firstError = expect(first).rejects.toThrow(String(status));
    const secondError = expect(second).rejects.toThrow('控制台');
    void secondError.catch(() => undefined);
    await firstError; await secondError;
    expect(calls).toBe(1);
    const acknowledge = Reflect.get(latentAdapter, 'acknowledgeLatentJobResolved');
    expect(typeof acknowledge).toBe('function');
    acknowledge(config());
    await expect(generateImage(config(), { prompt: 'after checking' })).resolves.toMatchObject({ backend: 'latent' });
    expect(calls).toBe(2);
  });

  it('automatically compacts a real generated avatar while retaining identity and recording the sent caption', async () => {
    let payload: any;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => { payload = JSON.parse(String(init.body)); return imageZip(); });
    const built = buildNpcImagePrompt({
      npc: { id: 'amber', 姓名: '安柏', 原著角色: true, 性别: '女', 外貌: 'brown hair, amber eyes', 穿着: 'red outrider outfit, red rabbit ribbon' } as NPC记录,
      mode: 'avatar', rules: 创建默认游戏设置().文生图系统.rules,
    });
    expect(built.prompt.length).toBeGreaterThan(2000);
    const result = await generateImage(config(), { prompt: built.prompt, negativePrompt: built.negative });
    expect(payload.input.length).toBeLessThanOrEqual(2000);
    for (const identity of ['安柏', 'brown hair', 'amber eyes', 'red rabbit ribbon']) expect(payload.input).toContain(identity);
    expect(payload.input).not.toContain('output format');
    expect(result).toMatchObject({ finalPrompt: payload.input, finalNegativePrompt: payload.parameters.uc, promptCompacted: true });
  });

  it('reserves room for every enabled snapshot character after merging long captions and negatives', async () => {
    let payload: any;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => { payload = JSON.parse(String(init.body)); return imageZip(); });
    const characters = ['Amber', 'Lisa', 'Jean', 'Lumine'].map((name, index) => ({
      name, subjectType: 'girl' as const, source: 'npc' as const,
      visualPrompt: `${'beautiful fantasy detail, '.repeat(60)}${name}, signature ribbon ${index}, golden eyes`,
      negativePrompt: 'blurry, malformed hands, '.repeat(100),
    }));
    await generateImage({ ...config(), negativePrompt: 'low quality, '.repeat(300) }, {
      prompt: 'Mondstadt fountain, sunset, walking together, '.repeat(150),
      storySnapshotContext: { schemaVersion: 1, scenePrompt: 'Mondstadt fountain, sunset', sceneNegativePrompt: '', characters },
    });
    expect(payload.input.length).toBeLessThanOrEqual(2000);
    expect(payload.parameters.uc.length).toBeLessThanOrEqual(2000);
    for (const [index, name] of ['Amber', 'Lisa', 'Jean', 'Lumine'].entries()) {
      expect(payload.input).toContain(name); expect(payload.input).toContain(`signature ribbon ${index}`);
    }
    expect(payload.input).toContain('Mondstadt fountain');
  });

  it.each([401, 402, 429, 504])('does not automatically resubmit a failed Latent job (%s)', async status => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => Response.json({ statusCode: status, message: 'test provider error' }, { status }));
    vi.stubGlobal('fetch', fetch);
    const task = runImageGenerationWithRetry(() => generateImage(config(), { prompt: 'portrait' }), { maxRetries: 2 });
    const assertion = expect(task).rejects.toThrow('Latent');
    void assertion.catch(() => undefined);
    await vi.runAllTimersAsync(); await assertion;
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('serializes concurrent calls even outside the album queue', async () => {
    let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
    let calls = 0;
    vi.stubGlobal('fetch', async () => { if (++calls === 1) await pending; return imageZip(); });
    const first = generateImage(config(), { prompt: 'first' });
    const second = generateImage(config(), { prompt: 'second' });
    void first.catch(() => undefined); void second.catch(() => undefined);
    await new Promise(resolve => setTimeout(resolve, 10));
    const beforeRelease = calls; release(); await Promise.all([first, second]);
    expect(beforeRelease).toBe(1); expect(calls).toBe(2);
  });

  it('cancels a waiting call immediately without submitting it after the active render finishes', async () => {
    let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
    let calls = 0;
    vi.stubGlobal('fetch', async () => { if (++calls === 1) await pending; return imageZip(); });
    const first = generateImage(config(), { prompt: 'active' });
    const controller = new AbortController();
    const second = generateImage(config(), { prompt: 'waiting', signal: controller.signal });
    let cancelled = false;
    void second.catch(() => { cancelled = true; });
    controller.abort();
    await new Promise(resolve => setTimeout(resolve, 10));
    const immediate = cancelled;
    release(); await first;
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    expect(immediate).toBe(true); expect(calls).toBe(1);
  });

  it('warns on in-flight cancellation without retrying a potentially accepted job', async () => {
    let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
    const fetch = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError')), { once: true });
      started();
    }));
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    const task = runImageGenerationWithRetry(() => generateImage(config(), { prompt: 'portrait', signal: controller.signal }), { maxRetries: 2 });
    const assertion = expect(task).rejects.toThrow('不会停止服务器');
    await ready; controller.abort(); await assertion;
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('times out the entire response body and does not repeat the accepted request', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async (_url: string, init: RequestInit) => new Response(new ReadableStream({
      start(controller) { init.signal?.addEventListener('abort', () => controller.error(new DOMException('abort', 'AbortError')), { once: true }); },
    }), { headers: { 'content-type': 'application/zip' } }));
    vi.stubGlobal('fetch', fetch);
    const task = runImageGenerationWithRetry(() => generateImage(config(), { prompt: 'portrait' }), { maxRetries: 2 });
    const assertion = expect(task).rejects.toThrow('180 秒');
    void assertion.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(180_001); await assertion;
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('checks connectivity without generating a paid image or claiming key verification', async () => {
    let method = ''; let endpoint = '';
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => { method = String(init.method); endpoint = url; return new Response(null, { status: 204 }); });
    const message = await testImageGenerationConnection(config());
    expect(method).toBe('OPTIONS'); expect(endpoint).toContain('/api/novelai/ai/generate-image');
    expect(message).toContain('未验证');
  });

  it('preserves Latent as a saved provider while normalizing unsafe retry/step defaults', () => {
    const restored = 归一化文生图API配置(JSON.parse(JSON.stringify(config())));
    expect(restored).toMatchObject({ backend: 'latent', steps: 12, retryCount: 0 });
    const settings = 创建默认游戏设置();
    settings.文生图系统.enabled = true; settings.文生图系统.普通接口 = restored;
    expect(evaluateNewGameApiReadiness({ configs: [], activeConfigId: null }, settings).image.status).toBe('ready');
    settings.文生图系统.普通接口.apiKey = '';
    expect(evaluateNewGameApiReadiness({ configs: [], activeConfigId: null }, settings).image.detail).toContain('密钥');
  });
});
