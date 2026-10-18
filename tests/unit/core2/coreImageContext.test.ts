import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { buildCoreImageRequest } from '@/core/retrieval/imageContext';
import { makeSeed } from './fixtures';
afterEach(() => vi.unstubAllGlobals());

it('uses current permitted visual facts, translates and anchors them without relationship or memory metadata', async () => {
  const seed = makeSeed(), npc = seed.records.find(row => row.domain === 'npc'); if (npc?.domain !== 'npc') throw Error('fixture');
  npc.value.appearance = '棕色头发，琥珀眼眸'; npc.value.appearanceFacts = { 发色: { value: '棕色', source: 'manual' } }; npc.value.notes = ['PRIVATE_SENTINEL'];
  const prepare = vi.fn().mockImplementation(async facts => ({ schemaVersion: 1, sourceKey: JSON.stringify(facts), preparedAt: 0,
    facts: { language: 'en', name: 'Amber', gender: 'female', appearance: 'brown hair, amber eyes', appearanceDetails: { 发色: { value: 'brown', source: 'manual' } } } }));
  const result = await buildCoreImageRequest({ snapshot: { head: seed.head, records: seed.records, contentRefs: [] }, npcId: npc.entityId, userInput: '请拍一张在风起地的照片', positive: ['anime'], negative: ['blurry'], translationConfig: null }, { prepare });
  expect(JSON.stringify(prepare.mock.calls)).not.toMatch(/PRIVATE_SENTINEL|affinity|七维|relationship/);
  expect(result.request.prompt).toContain('Amber'); expect(result.request.prompt).toContain('brown'); expect(result.request.prompt).toContain('风起地');
  expect(result.request.protectedCharacters?.[0]?.facts?.language).toBe('en');
  expect(result.englishCache.sourceKey).toBe(JSON.stringify(prepare.mock.calls[0]![0]));
});

it('rejects a translated cache belonging to another appearance snapshot', async () => {
  const seed = makeSeed();
  const prepare = vi.fn().mockResolvedValue({ schemaVersion: 1, sourceKey: 'other', preparedAt: 0, facts: { language: 'en', name: 'Lisa' } });
  await expect(buildCoreImageRequest({ snapshot: { head: seed.head, records: seed.records, contentRefs: [] }, npcId: 'npc-amber', userInput: 'portrait', translationConfig: null }, { prepare })).rejects.toThrow('CORE2_IMAGE_TRANSLATION_SOURCE');
});

it('requires an explicit preparation port instead of opening or writing the old settings database', async () => {
  const factory = new IDBFactory(); vi.stubGlobal('indexedDB', factory);
  const seed = makeSeed(), npc = seed.records.find(row => row.domain === 'npc'); if (npc?.domain !== 'npc') throw Error('fixture');
  npc.value.姓名 = 'Amber'; npc.value.gender = 'female'; npc.value.aliases = []; npc.value.appearance = ''; npc.value.clothing = '';
  const failure: unknown = await buildCoreImageRequest({ snapshot: { head: seed.head, records: seed.records, contentRefs: [] }, npcId: npc.entityId, userInput: 'portrait', translationConfig: null }, {}).then(() => null, error => error);
  expect(await factory.databases()).toEqual([]);
  expect(failure).toBeInstanceOf(Error); expect((failure as Error).message).toBe('CORE2_IMAGE_PREPARER_REQUIRED');
});
