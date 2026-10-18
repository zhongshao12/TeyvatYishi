import { expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { createCoreController } from '@/core/settlement/coreController';
import { createCoreOpeningSeed, CORE_OPENING_SERIES } from '@/core/view/openingSeed';
import type { CoreStoryNode } from '@/core/content/storyCatalog';

it('binds an opening to its actual regional story resource before creating the baseline, without invented events or rewards', async () => {
  const seed = createCoreOpeningSeed({ name: '云', travelerPreset: 'custom', canonicalCompanion: '荧', openingPresetId: 'official_sumeru_dream' });
  const node: CoreStoryNode = { seriesId: CORE_OPENING_SERIES.official_sumeru_dream, chapterId: 'sumeru-start', nodeId: 'sumeru-arrival', prerequisites: ['prior-finale'], seriesTitle: '须弥主线', chapterTitle: '来到须弥', title: '抵达宝商街', location: '须弥城', goal: '寻找线索', completionEvidence: [] };
  const prepare = vi.fn(async () => ({ baselineCatalog: [node], catalog: [node], nodes: [node], prompt: '' }));
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: 'test-core2-opening-resources-' + crypto.randomUUID() }), model = vi.fn();
  const controller = createCoreController({ repo, storyResources: { getNodes: () => [node], prepare }, turnDependencies: () => ({ rulePolicy: { ruleVersion: 'test', storyNodes: [node] }, generateNarrative: model, factModel: model, assembleContext: async () => ({ systemPrompt: '', messages: [] }) }) });
  await controller.initialize(seed);
  expect(controller.getView().snapshot).not.toBeNull(); expect(prepare).toHaveBeenCalled();
  const state = await repo.readState(seed.head.scope);
  expect(state.records.find(row => row.domain === 'story')).toMatchObject({ value: { seriesId: node.seriesId, chapterId: node.chapterId, nodeId: node.nodeId, completedNodeIds: ['prior-finale'], status: 'progressing' } });
  expect(state.contentRefs).toEqual([expect.objectContaining({ contentId: node.seriesId, checksum: expect.any(String) })]);
  expect(controller.getCurrentStoryTitle()).toContain('抵达宝商街');
  expect((await repo.queryEvents({ scope: seed.head.scope, cutoffSeq: 0 })).items).toEqual([]);
  expect((await repo.queryKnowledge({ scope: seed.head.scope, cutoffSeq: 0 })).items).toEqual([]); expect(model).not.toHaveBeenCalled();
  expect(seed.contentRefs).toEqual([]); expect(seed.records.find(row => row.domain === 'story')).toMatchObject({ value: { nodeId: null } });
});
it('does not publish a half-created journey when the selected regional resource cannot load', async () => {
  const seed = createCoreOpeningSeed({ name: '云', travelerPreset: 'custom', openingPresetId: 'official_fontaine_prophecy' });
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: 'test-core2-opening-failure-' + crypto.randomUUID() }), model = vi.fn();
  const controller = createCoreController({ repo, storyResources: { getNodes: () => [], prepare: async () => { throw Error('TEST_RESOURCE_UNAVAILABLE'); } }, turnDependencies: () => ({ rulePolicy: { ruleVersion: 'test', storyNodes: [] }, generateNarrative: model, factModel: model, assembleContext: async () => ({ systemPrompt: '', messages: [] }) }) });
  await expect(controller.initialize(seed)).rejects.toThrow('TEST_RESOURCE_UNAVAILABLE');
  await expect(repo.readHead(seed.head.scope)).rejects.toThrow('CORE2_BRANCH_NOT_FOUND');
});
it('does not let a late opening-resource response replace a newer journey selection', async () => {
  const first = createCoreOpeningSeed({ name: '先选的档', travelerPreset: 'custom', openingPresetId: 'official_mondstadt_dragon' }), second = createCoreOpeningSeed({ name: '后选的档', travelerPreset: 'custom', openingPresetId: 'official_liyue_ritual' });
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: 'test-core2-opening-navigation-' + crypto.randomUUID() }), model = vi.fn();
  const controller = createCoreController({ repo, storyResources: { getNodes: () => [], prepare: async snapshot => {
    if (snapshot.head.scope.journeyId === first.head.scope.journeyId) { enter(); await held; }
    const seriesId = snapshot.records.find(row => row.domain === 'story')!.value.seriesId!;
    const node: CoreStoryNode = { seriesId, chapterId: 'opening-chapter', nodeId: 'opening-node', prerequisites: [], seriesTitle: '开局主线', chapterTitle: '第一章', title: '启程', location: '', goal: '', completionEvidence: [] };
    return { baselineCatalog: [node], catalog: [node], nodes: [node], prompt: '' };
  } }, turnDependencies: () => ({ rulePolicy: { ruleVersion: 'test', storyNodes: [] }, generateNarrative: model, factModel: model, assembleContext: async () => ({ systemPrompt: '', messages: [] }) }) });
  const stale = controller.initialize(first); await entered;
  await controller.initialize(second); release();
  await expect(stale).rejects.toThrow('CORE2_OPENING_NAVIGATION_CHANGED');
  expect(controller.getView().snapshot?.head.scope).toEqual(second.head.scope);
  await expect(repo.readHead(first.head.scope)).rejects.toThrow('CORE2_BRANCH_NOT_FOUND');
});
