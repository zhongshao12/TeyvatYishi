import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { core2TextCompletion } from '@/services/ai/core2TextCompletion';
import type { API配置项 } from '@/models/settings';
import { 创建默认记忆系统设置 } from '@/models/settings';
import { recallFixture } from './recallFixture';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
beforeEach(() => vi.resetModules());
const config: API配置项 = { id: 'diagnostic-test', name: 'fixture', provider: 'openai_compatible', baseUrl: 'https://fixture.invalid/v1', apiKey: 'fixture-not-a-key', model: 'fixture', createdAt: 1, updatedAt: 1, retryCount: 0 };
it('returns the actual HTTP failure to its operation without opening or writing a legacy diagnostics database', async () => {
  const factory = new IDBFactory(), open = vi.spyOn(factory, 'open'); vi.stubGlobal('indexedDB', factory);
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: { message: 'fixture provider rejection' } }), { status: 400 }));
  await expect(core2TextCompletion(config, { messages: [{ role: 'user', content: 'test' }] })).rejects.toThrow('fixture provider rejection');
  await new Promise(resolve => setTimeout(resolve, 25));
  expect(open).not.toHaveBeenCalled(); expect(await factory.databases()).toEqual([]);
});
it('keeps a failed memory summary in its owning job without opening the legacy database', async () => {
  const { createCore2MemoryModel } = await import('@/services/ai/core2MemoryModel');
  const factory = new IDBFactory(), open = vi.spyOn(factory, 'open'); vi.stubGlobal('indexedDB', factory);
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: { message: 'fixture summary rejection' } }), { status: 400 }));
  const result = await createCore2MemoryModel(config, 创建默认记忆系统设置())({ layer: 'short', turn: 1, items: ['安柏赠送苹果'], prompt: '归纳' });
  expect(result).toMatchObject({ kind: 'failed', code: 'request_failed' });
  await new Promise(resolve => setTimeout(resolve, 25));
  expect(open).not.toHaveBeenCalled(); expect(await factory.databases()).toEqual([]);
});
it.each(['openai_compatible', 'claude', 'gemini', 'mimo'] as const)('does not use the legacy report store for %s network failures', async provider => {
  const factory = new IDBFactory(), open = vi.spyOn(factory, 'open'); vi.stubGlobal('indexedDB', factory);
  vi.stubGlobal('fetch', async () => { throw Error('fixture connection refusal'); });
  await expect(core2TextCompletion({ ...config, provider }, { messages: [{ role: 'user', content: 'test' }] })).rejects.toThrow('fixture connection refusal');
  await new Promise(resolve => setTimeout(resolve, 25)); expect(open).not.toHaveBeenCalled();
});
it('keeps an independent news request failure out of the legacy database', async () => {
  const { generateCoreNews } = await import('@/core/retrieval/newsContext');
  const f = await recallFixture(), factory = new IDBFactory(), open = vi.spyOn(factory, 'open'); vi.stubGlobal('indexedDB', factory);
  vi.stubGlobal('fetch', async () => new Response('fixture news rejection', { status: 400 }));
  await expect(generateCoreNews({ snapshot: await f.repo.readState(f.seed.head.scope), config }, { repo: f.repo })).rejects.toThrow('400');
  await new Promise(resolve => setTimeout(resolve, 25)); expect(open).not.toHaveBeenCalled();
});
