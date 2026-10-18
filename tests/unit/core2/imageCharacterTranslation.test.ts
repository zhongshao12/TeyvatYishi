import { IDBFactory } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';
import { translateImageCharacterFacts } from '@/services/ai/imageCharacterTranslation';
import type { ImageCharacterFacts } from '@/utils/imageCharacterFacts';
import type { API配置项 } from '@/models/settings';
afterEach(() => vi.unstubAllGlobals());
const config: API配置项 = { id: 'translation-fixture', name: 'fixture', provider: 'openai_compatible', baseUrl: 'https://example.invalid/v1', apiKey: 'test-not-a-key', model: 'fixture', createdAt: 1, updatedAt: 1 };
const source: ImageCharacterFacts = { name: '琴', gender: '女', appearance: '金色头发', outfit: '骑士制服', appearanceDetails: { 发色: { value: '金色', source: 'manual' }, 身高: { value: '169cm', source: 'canon' } } };
const translated = { name: 'Jean', gender: 'female', appearance: 'blonde hair', outfit: 'knight uniform', appearanceDetails: { 发色: { value: 'blonde' }, 身高: { value: '169cm' } } };
it('translates only supplied facts without touching any database and preserves exact measurements and provenance', async () => {
  const factory = new IDBFactory(); vi.stubGlobal('indexedDB', factory);
  let actual: string | undefined;
  const result = await translateImageCharacterFacts(source, config, undefined, async (_config, request) => { actual = request.messages[0]?.content; return JSON.stringify(translated); });
  expect(actual).toBe(JSON.stringify(source));
  expect(result).toMatchObject({ schemaVersion: 1, sourceKey: JSON.stringify(source), facts: { language: 'en', name: 'Jean', gender: 'female', appearanceDetails: { 身高: { value: '169cm', source: 'canon' } } } });
  expect(await factory.databases()).toEqual([]);
});
it('rejects invented or changed appearance measurements before any cache can be published', async () => {
  await expect(translateImageCharacterFacts(source, config, undefined, async () => JSON.stringify({ ...translated, appearanceDetails: { ...translated.appearanceDetails, 身高: { value: '170cm' } } }))).rejects.toThrow('英文外貌细项与已记录数值不一致');
});
it('reuses already-English facts locally and rejects an aborted request without making a model call', async () => {
  const complete = vi.fn(async () => 'unused');
  expect(await translateImageCharacterFacts({ name: 'Amber', gender: 'female' }, null, undefined, complete)).toMatchObject({ facts: { language: 'en', name: 'Amber', gender: 'female' } });
  const abort = new AbortController(); abort.abort();
  await expect(translateImageCharacterFacts(source, config, abort.signal, complete)).rejects.toThrow(); expect(complete).not.toHaveBeenCalled();
});
