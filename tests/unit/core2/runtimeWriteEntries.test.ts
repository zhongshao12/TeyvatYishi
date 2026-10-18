import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { BasicPlayerCommand } from '@/core/settlement/actions';
import { makeSeed } from './fixtures';
import { seedAmberImageFacts, AMBER_IMAGE_FACTS } from './imageEnglishFixture';
import { CORE_COMMAND_ENTRIES } from '@/core/view/writeEntrypoints';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const png = () => Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1cAAAAASUVORK5CYII='), ch => ch.charCodeAt(0));
async function fixture() {
  // Observe the actual global database boundary before importing the runtime.
  vi.resetModules(); const factory = new IDBFactory(), opens: string[] = [], forbidden: string[] = [];
  const open = factory.open.bind(factory);
  vi.spyOn(factory, 'open').mockImplementation((name, version) => { opens.push(name); if (!name.startsWith('test-core2-') && !['TeyvatCore2DB', 'TeyvatCore2SettingsDB'].includes(name)) { forbidden.push(name); throw Error('TEST_LEGACY_WRITER_DETECTED'); } return open(name, version); });
  vi.stubGlobal('indexedDB', factory); vi.stubGlobal('fetch', vi.fn(async () => { throw Error('UNEXPECTED_NETWORK'); }));
  const { createIndexedRepository } = await import('@/core/persistence/indexedRepository'), { createCoreController } = await import('@/core/settlement/coreController');
  const seed = makeSeed(); seed.records = seed.records.filter(row => row.domain !== 'album'); seedAmberImageFacts(seed);
  const traveler = seed.records.find(row => row.domain === 'traveler')!, amber = seed.records.find(row => row.domain === 'npc')!;
  if (traveler.domain !== 'traveler' || amber.domain !== 'npc') throw Error('fixture');
  traveler.value.元素共鸣 = [{ element: 'anemo', source: 'traveler_resonance', mastery: 0, unlocked: true, unlockedAt: '', notes: '' }];
  seed.records.push({ ...structuredClone(amber), entityId: 'npc-lisa', value: { ...structuredClone(amber.value), id: 'npc-lisa', 姓名: '丽莎' } }, { scope: seed.head.scope, domain: 'courier', entityId: 'contact-lisa', version: 1, value: { kind: 'contact', npcId: 'npc-lisa', name: '丽莎', remark: '', available: true } });
  const repo = createIndexedRepository({ factory, databaseName: `test-core2-all-entries-${crypto.randomUUID()}` });
  const story = { seriesId: 'fixture-series', seriesTitle: '测试主线', chapterId: 'fixture-chapter', chapterTitle: '测试章', nodeId: 'fixture-node', title: '测试节点', location: '蒙德城', goal: '问候安柏', completionEvidence: [], prerequisites: [] };
  const controller = createCoreController({ repo, autoSave: false,
    profileCatalog: { read: async () => ({ version: 'fixture', fields: { speechStyle: '爽朗' }, appearanceFacts: {} }) },
    phoneModels: { getModelIdentity: () => 'fixture', generate: async () => ({ text: '今天巡逻很顺利，收到你的问候啦。' }) },
    newsModels: { getModelIdentity: () => 'fixture', generate: async () => ({ kind: 'empty', articles: [], bundle: { bundleId: 'fixture-public-news', mandatoryText: '', optionalText: '', selectedLeafIds: [], estimatedTokens: 0, budgetOverflow: false, diagnostics: [] } }) },
    imageModels: { getModelIdentity: () => 'fixture', generate: async () => ({ bytes: png(), mimeType: 'image/png' }), prepare: async (_snapshot, input) => ({ request: { title: input.title, kind: 'character', npcIds: ['npc-amber'], prompt: 'Amber at Windrise', negative: '', size: '512x512', characters: [AMBER_IMAGE_FACTS] } }) },
    turnDependencies: () => ({ rulePolicy: { ruleVersion: 'fixture', storyNodes: [story], storyContent: [story], talents: [{ id: 'anemo-skill', 名称: '风涡剑', 类别: 'elemental_skill', 关联元素: 'anemo', 等级: 1, 说明: '' }] },
      summarySettings: { mode: 'local', shortThreshold: 3, middleThreshold: 15, longThreshold: 15, prompt: '' },
      assembleContext: async () => ({ systemPrompt: '', messages: [] }), factModel: async ({ source, snapshot }) => {
        const block = source.blocks.find(row => row.text.includes('完成了问候任务'));
        return { kind: 'extracted', candidates: block && snapshot.records.some(row => row.domain === 'quest' && row.entityId === 'quest-1' && row.value.status === 'active') ? [{ candidateId: 'fixture-quest-complete', scope: source.scope, operationId: source.operationId, kind: 'quest', actors: ['npc-amber'], targets: ['quest-1'], proposal: { kind: 'quest', questId: 'quest-1', action: 'complete' }, evidenceRefs: [{ ref: source.ref, blockId: block.blockId, start: 0, end: block.text.length, quote: block.text }], status: 'proposed' }] : [], attempts: 0 };
      },
      generateNarrative: async () => JSON.stringify({ body: [{ kind: 'narration', text: '安柏与你完成了问候任务。' }], choices: [], factCandidates: [], continuation: { summary: '', unresolved: [] } }) }) });
  await controller.initialize(seed); return { controller, repo, seed, opens, forbidden, factory, story };
}
it('executes every registered command through the real controller/repository while observing the legacy database boundary', async () => {
  const f = await fixture(), observed = new Set<string>();
  const commit = f.repo.commit.bind(f.repo); let injectLegacy = false;
  vi.spyOn(f.repo, 'commit').mockImplementation(async input => { if (injectLegacy) { injectLegacy = false; f.factory.open('TimeJourneyDB'); } return commit(input); });
  const command = async (value: BasicPlayerCommand) => {
    const before = (await f.repo.readHead(f.seed.head.scope)).coreSeq;
    injectLegacy = true; await expect(f.controller.command(value)).rejects.toThrow('TEST_LEGACY_WRITER_DETECTED');
    expect(f.forbidden.splice(0)).toEqual(['TimeJourneyDB']); expect((await f.repo.readHead(f.seed.head.scope)).coreSeq).toBe(before);
    const receipt = await f.controller.command(value); expect(receipt.status).toBe('committed'); expect((await f.repo.readHead(f.seed.head.scope)).coreSeq).toBeGreaterThan(before); observed.add(value.type); await f.controller.waitForBackground(); expect(f.forbidden).toEqual([]);
  };
  try {
    await command({ type: 'edit_traveler', field: '背景', value: '玩家填写的身世' });
    await command({ type: 'edit_npc', npcId: 'npc-amber', field: 'affinity', value: 100 });
    await command({ type: 'contact', npcId: 'npc-amber', action: 'add' });
    await command({ type: 'contact_remark', contactId: 'contact-amber', remark: '侦察骑士' });
    await command({ type: 'inventory', itemId: 'apple', action: 'consume', quantity: 1 });
    await command({ type: 'conversation_create', conversationId: 'fixture-chat', conversationType: 'group', name: '冒险伙伴', memberIds: ['npc-amber', 'npc-lisa'] });
    await command({ type: 'group', conversationId: 'fixture-chat', action: 'rename', name: '今日巡逻' });
    const chat = f.controller.getView().snapshot!.records.find(row => row.entityId === 'fixture-chat')!;
    await command({ type: 'conversation_read', conversationId: chat.entityId, expectedVersion: chat.version, throughSeq: f.controller.getView().snapshot!.head.coreSeq });
    await command({ type: 'moment', momentId: 'fixture-moment', action: 'publish', text: '今天的蒙德很晴朗', mentionedNpcIds: ['npc-amber'] });
    await command({ type: 'map', locationId: 'mondstadt-city' });
    await command({ type: 'element', element: 'anemo' });
    await command({ type: 'talent', talentId: 'anemo-skill', element: 'anemo', level: 1 });
    await command({ type: 'story_edit', seriesId: f.story.seriesId, chapterId: f.story.chapterId, nodeId: f.story.nodeId });
    const { storyFieldFingerprint } = await import('@/core/content/storyEdits');
    await command({ type: 'story_content', action: 'set', seriesId: f.story.seriesId, nodeId: f.story.nodeId, field: 'goal', value: '与安柏一起看风车', expectedVersion: f.controller.getView().snapshot!.records.find(row => row.domain === 'story')!.version, baseFingerprint: storyFieldFingerprint('问候安柏') });
    await command({ type: 'doudizhu_start', npcIds: ['npc-amber', 'npc-lisa'], gameId: 'fixture-cards', seed: 42 });
    let cards = f.controller.getView().snapshot!.records.find(row => row.domain === 'doudizhu')!;
    await command({ type: 'doudizhu_turn', gameId: 'fixture-cards', expectedVersion: cards.version, move: { type: 'bid', seat: 0, points: 3 } });
    cards = f.controller.getView().snapshot!.records.find(row => row.domain === 'doudizhu')!;
    await command({ type: 'doudizhu_abandon', gameId: 'fixture-cards', expectedVersion: cards.version });
    await f.controller.uploadImage({ bytes: png(), mimeType: 'image/png', title: '合成照片', kind: 'scene', npcIds: [] });
    const album = f.controller.getView().snapshot!.records.find(row => row.domain === 'album')!, npc = f.controller.getView().snapshot!.records.find(row => row.domain === 'npc' && row.entityId === 'npc-amber')!;
    await command({ type: 'image_bind', entryId: album.entityId, target: 'npc', targetId: 'npc-amber', slot: 'courier', expectedVersion: npc.version });
    const current = f.controller.getView().snapshot!.records.find(row => row.domain === 'npc' && row.entityId === 'npc-amber')!; if (current.domain !== 'npc') throw Error('fixture');
    await command({ type: 'image_profile_cache', npcId: current.entityId, expectedVersion: current.version, cache: current.value.visualArchive.englishFacts! });
    await command({ type: 'image_delete', entryId: album.entityId, expectedVersion: album.version });
    expect([...observed].sort()).toEqual(Object.entries(CORE_COMMAND_ENTRIES).filter(([, entry]) => entry.method === 'command').map(([type]) => type).sort());
    expect((await f.repo.readState(f.seed.head.scope)).records.find(row => row.domain === 'traveler')).toMatchObject({ value: { 背景: '玩家填写的身世', 主元素: 'anemo' } });
    expect(f.opens).toEqual(expect.arrayContaining([expect.stringContaining('test-core2-')])); expect(f.forbidden).toEqual([]);
    // An aliased/swallower legacy writer is still detected by the runtime spy.
    try { f.factory.open('TimeJourneyDB'); } catch { /* A legacy caller might swallow its own error. */ }
    expect(f.forbidden).toEqual(['TimeJourneyDB']);
  } finally { f.controller.dispose(); }
});
it.each(['message', 'memory_edit', 'image', 'doudizhu_move'] as const)('does not expose the raw %s command as an alternate writable UI path', async type => {
  const f = await fixture();
  try { const before = await f.repo.readHead(f.seed.head.scope); await expect(f.controller.command({ type } as BasicPlayerCommand)).rejects.toThrow(/入口/); expect(await f.repo.readHead(f.seed.head.scope)).toEqual(before); expect(f.forbidden).toEqual([]); }
  finally { f.controller.dispose(); }
});
it('runs the direct main/quest, phone, profile, image, news, save/restore and memory entries without opening the legacy database', async () => {
  const f = await fixture();
  try {
    const main = await f.controller.send({ scope: f.seed.head.scope, sessionId: f.seed.head.sessionId, operationId: 'fixture-main', text: '向安柏问好' });
    expect(main.kind).toBe('committed'); await f.controller.waitForBackground();
    expect(f.controller.getView().snapshot!.records.find(row => row.domain === 'quest')).toMatchObject({ value: { status: 'completed' } });
    expect((await f.controller.retry('fixture-main')).kind).toBe('committed'); await f.controller.waitForBackground();
    await f.controller.command({ type: 'conversation_create', conversationId: 'direct-chat', conversationType: 'private', name: '安柏', memberIds: ['npc-amber'] });
    await f.controller.sendPhone({ conversationId: 'direct-chat', text: '今天的巡逻还顺利吗', operationId: 'direct-phone' }); await f.controller.waitForBackground();
    const phoneSources = (await f.repo.querySources({ scope: f.seed.head.scope, cutoffSeq: (await f.repo.readHead(f.seed.head.scope)).coreSeq, kinds: ['courier'] })).items;
    expect(phoneSources.some(source => source.blocks.some(row => row.text.includes('巡逻很顺利')))).toBe(true);
    await f.controller.completeNpcProfile('npc-lisa'); await f.controller.waitForBackground();
    const image = await f.controller.prepareImage({ title: '角色照片', kind: 'character', npcId: 'npc-amber', userInput: 'Windrise', positive: [], negative: [], size: '512x512' });
    await f.controller.requestImage(image); await f.controller.waitForBackground();
    expect(f.controller.getView().snapshot!.records.find(row => row.domain === 'album')).toBeTruthy();
    await f.controller.requestNews('direct-news'); await f.controller.waitForBackground();
    const jobs = (await f.repo.queryJobs({ scope: f.seed.head.scope, cutoffSeq: (await f.repo.readHead(f.seed.head.scope)).coreSeq })).items;
    expect(jobs.every(job => job.status === 'completed')).toBe(true);
    const memoryHead = await f.repo.readHead(f.seed.head.scope), memories = (await f.repo.queryMemories({ scope: f.seed.head.scope, cutoffSeq: memoryHead.coreSeq, memoryRevision: memoryHead.memoryRevision, statuses: ['active'] })).items;
    const memory = memories[0]!; expect(memory).toBeTruthy();
    await f.controller.editMemory({ memoryId: memory.memoryId, expectedVersion: memory.version, text: '玩家确认的旅途摘要', pinned: true });
    expect((await f.repo.queryMemories({ scope: f.seed.head.scope, cutoffSeq: f.controller.getView().snapshot!.head.coreSeq, memoryRevision: f.controller.getView().snapshot!.head.memoryRevision, statuses: ['active'] })).items.some(row => row.text === '玩家确认的旅途摘要')).toBe(true);
    const selected = await f.controller.previewMaintenance('rebuild', [memory.memoryId]); expect(selected.turns).toEqual([1]);
    expect((await f.controller.runMaintenance(selected.token)).kind).toBe('completed');
    const automatic = await f.controller.saveAutomatic(); expect(automatic?.turn).toBe(1);
    const manual = await f.controller.save({ scope: f.seed.head.scope, kind: 'manual', asNew: true, turn: 1, name: '入口验收' });
    const child = await f.controller.restore(manual.snapshotId); expect(child.scope.branchId).not.toBe(f.seed.head.scope.branchId);
    await f.controller.attach({ scope: f.seed.head.scope }); expect(f.controller.getView().snapshot!.head.scope).toEqual(f.seed.head.scope); expect(f.forbidden).toEqual([]);
  } finally { f.controller.dispose(); }
});
