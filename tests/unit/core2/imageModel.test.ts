import { IDBFactory } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';
import { createCore2ImagePort } from '@/services/ai/core2ImageModel';
import { 创建默认游戏设置, type 文生图API配置 } from '@/models/settings';
import type { ImageGenerationRequest } from '@/services/ai/imageGeneration';
import { makeSeed } from './fixtures';
afterEach(() => vi.unstubAllGlobals());
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1cAAAAASUVORK5CYII=';
function settings() { const s = 创建默认游戏设置().文生图系统; s.enabled = true; s.普通接口.enabled = true; s.普通接口.backend = 'comfyui'; s.普通接口.baseUrl = 'http://127.0.0.1:8188'; s.普通接口.model = 'local-fixture'; return s; }
it('prepares only recorded English visual facts and decodes the existing backend result into owned bytes without a legacy database', async () => {
  const factory = new IDBFactory(); vi.stubGlobal('indexedDB', factory);
  const seed = makeSeed(), npc = seed.records.find(row => row.domain === 'npc')!; if (npc.domain !== 'npc') throw Error('fixture'); npc.value.appearance = '棕色长发'; npc.value.notes = ['PRIVATE_SENTINEL'];
  const generate = vi.fn(async (_config: 文生图API配置, _request: ImageGenerationRequest) => ({ src: 'data:image/png;base64,' + png, finalPrompt: 'compressed visual prompt', finalNegativePrompt: 'blurry' }));
  const translate = vi.fn(async facts => ({ schemaVersion: 1 as const, sourceKey: JSON.stringify(facts), preparedAt: 1, facts: { language: 'en' as const, name: 'Amber', gender: 'female', appearance: 'long brown hair' } }));
  const port = createCore2ImagePort(settings(), null, generate, translate);
  const prepared = await port.prepare!({ head: seed.head, records: seed.records, contentRefs: [] }, { title: '照片', kind: 'character', npcId: 'npc-amber', userInput: '在风起地微笑', positive: ['anime'], negative: ['watermark'], size: '512x512' });
  expect(prepared.request.prompt).toContain('character name: Amber'); expect(prepared.request.prompt).toContain('long brown hair'); expect(JSON.stringify(prepared.request)).not.toMatch(/PRIVATE_SENTINEL|七维|affinity/);
  expect(prepared.cache).toMatchObject({ npcId: 'npc-amber', expectedVersion: 1, value: { facts: { name: 'Amber' } } });
  const result = await port.generate(prepared.request, new AbortController().signal); expect([...result.bytes]).toEqual([...Uint8Array.from(atob(png), c => c.charCodeAt(0))]); expect(result).toMatchObject({ mimeType: 'image/png', finalPrompt: 'compressed visual prompt' });
  expect(generate.mock.calls[0]?.[1]).toMatchObject({ protectedCharacters: [{ name: 'Amber', facts: { language: 'en', gender: 'female' } }] }); expect(await factory.databases()).toEqual([]);
});
it('prepares scenes locally without translation and rejects remote, malformed or cancelled result data', async () => {
  const seed = makeSeed(), generate = vi.fn(async () => ({ src: 'https://untrusted.invalid/image.png' })), translate = vi.fn();
  const port = createCore2ImagePort(settings(), null, generate, translate), abort = new AbortController();
  const prepared = await port.prepare!({ head: seed.head, records: seed.records, contentRefs: [] }, { title: '风景', kind: 'scene', npcId: null, userInput: 'Windrise', positive: ['anime'], negative: [], size: '512x512' });
  expect(prepared.request.prompt).toContain('Windrise'); expect(translate).not.toHaveBeenCalled();
  await expect(port.generate(prepared.request, abort.signal)).rejects.toThrow('图片接口没有返回可保存的内联图片');
  abort.abort(); await expect(port.generate(prepared.request, abort.signal)).rejects.toThrow(); expect(generate).toHaveBeenCalledTimes(1);
});
it('does not call disabled image backends and excludes key rotation from the durable configuration identity', async () => {
  const s = settings(), generate = vi.fn(); s.enabled = false;
  const port = createCore2ImagePort(s, null, generate); await expect(port.generate({ title: 'x', kind: 'scene', npcIds: [], prompt: 'x', negative: '', size: '512x512', characters: [] }, new AbortController().signal)).rejects.toThrow('已关闭'); expect(generate).not.toHaveBeenCalled();
  s.enabled = true; const first = createCore2ImagePort(s, null).getModelIdentity(); s.普通接口.apiKey = 'rotated-secret'; expect(createCore2ImagePort(s, null).getModelIdentity()).toBe(first); expect(first).not.toContain('rotated-secret');
});
