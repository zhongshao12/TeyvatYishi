import { expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { createCoreController } from '@/core/settlement/coreController';
import { makeSeed } from './fixtures';
import { makeMemoryMaintenanceFixture } from './memoryMaintenanceFixture';
import { buildCoreView } from '@/core/retrieval/viewModels';

async function setup() {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-runtime-controller-${crypto.randomUUID()}` }), seed = makeSeed();
  const generateNarrative = vi.fn(), factModel = vi.fn();
  const controller = createCoreController({ repo, turnDependencies: () => ({ generateNarrative, factModel, assembleContext: async () => ({ systemPrompt: '', messages: [] }), rulePolicy: { ruleVersion: 'test', storyNodes: [] } }) });
  await controller.initialize(seed); return { repo, seed, controller, generateNarrative, factModel };
}
it('follows a stopped summary to its replacement and removes only the superseded failure row', async () => {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-summary-attempt-${crypto.randomUUID()}` }), seed = makeSeed();
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  const summarize = vi.fn().mockImplementationOnce(async () => { enter(); await held; return { kind: 'model', text: '这次已经停止。' }; }).mockResolvedValue({ kind: 'model', text: '安柏向云问候。' });
  const controller = createCoreController({ repo, memoryModels: { summarize }, turnDependencies: () => ({ summarySettings: { mode: 'model', shortThreshold: 15, middleThreshold: 15, longThreshold: 15, prompt: '' },
    rulePolicy: { ruleVersion: 'test', storyNodes: [] }, assembleContext: async () => ({ systemPrompt: '', messages: [] }), factModel: async () => ({ kind: 'extracted', candidates: [], attempts: 0 }),
    generateNarrative: async () => JSON.stringify({ body: [{ kind: 'dialogue', speaker: '安柏', text: '云，你好。' }], choices: [], factCandidates: [], continuation: { summary: '', unresolved: [] } }) }) });
  await controller.initialize(seed);
  const result = await controller.send({ scope: seed.head.scope, sessionId: seed.head.sessionId, operationId: 'stopped-summary-main', text: '你好' });
  if (result.kind !== 'committed') throw Error('fixture'); const first = result.receipt.jobIds[0]!;
  await entered; await controller.stopJob(first); release(); await controller.waitForBackground();
  const failedView = await buildCoreView({ kind: 'failure', category: 'job', head: await repo.readHead(seed.head.scope) }, { repo });
  expect(failedView.items.find(row => row.id === first)?.canRetry).toBe(true);
  expect((await controller.retryJob(first)).kind).toBe('completed'); await controller.waitForBackground();
  const count = (await repo.queryJobs({ scope: seed.head.scope, cutoffSeq: (await repo.readHead(seed.head.scope)).coreSeq })).items.length;
  expect((await controller.retryJob(first)).kind).toBe('completed'); await controller.waitForBackground();
  expect((await repo.queryJobs({ scope: seed.head.scope, cutoffSeq: (await repo.readHead(seed.head.scope)).coreSeq })).items).toHaveLength(count);
  expect(summarize).toHaveBeenCalledTimes(2);
  expect(controller.getView().receipt?.memoryPending).toBe(false);
  expect((await buildCoreView({ kind: 'failure', category: 'job', head: await repo.readHead(seed.head.scope) }, { repo })).items).toEqual([]);
});
it('routes explicit inventory removal through a recorded command, with idempotent retry and no model call', async () => {
  const f = await setup(), command = { type: 'inventory' as const, action: 'discard' as const, itemId: 'apple', quantity: 1 };
  expect((await f.controller.command(command, 'discard-once')).status).toBe('committed');
  expect((await f.controller.command(command, 'discard-once')).status).toBe('already_committed');
  const item = (await f.repo.readState(f.seed.head.scope)).records.find(row => row.domain === 'inventory' && row.entityId === 'apple');
  expect(item?.value).toMatchObject({ quantity: 0, status: 'discarded' });
  expect((await f.repo.queryEvents({ scope: f.seed.head.scope, cutoffSeq: 1 })).items).toHaveLength(1);
  expect(f.generateNarrative).not.toHaveBeenCalled(); expect(f.factModel).not.toHaveBeenCalled();
});
it('creates contacts/conversations by stable identity and gives player moments an explicit visible audience', async () => {
  const f = await setup();
  await f.controller.command({ type: 'conversation_create', conversationId: 'runtime-private', conversationType: 'private', name: '安柏', memberIds: ['npc-amber'] });
  await f.controller.command({ type: 'moment', momentId: 'runtime-post', action: 'publish', text: '今天在风起地散步。', mentionedNpcIds: ['npc-amber'] });
  const post = f.controller.getView().snapshot!.records.find(row => row.domain === 'courier' && row.entityId === 'runtime-post');
  expect(post?.domain === 'courier' && post.value.kind === 'moment' && post.value.visibilityNpcIds).toEqual(['npc-amber']);
  await f.controller.command({ type: 'contact', npcId: 'npc-amber', action: 'add' });
  expect(f.controller.getView().snapshot!.records.filter(row => row.domain === 'courier' && row.value.kind === 'contact' && row.value.npcId === 'npc-amber')).toHaveLength(1);
  await f.controller.command({ type: 'contact', npcId: 'npc-amber', action: 'remove' });
  await expect(f.controller.command({ type: 'conversation_create', conversationId: 'not-allowed', conversationType: 'private', name: '安柏', memberIds: ['npc-amber'] })).rejects.toThrow('CORE2_PLAYER_ACTION_REJECTED');
});
it('runs committed summary jobs outside the main turn without reloading chat bodies on progress', async () => {
  const f = await setup();
  f.generateNarrative.mockResolvedValue(JSON.stringify({ body: [{ kind: 'dialogue', speaker: '安柏', text: '云，一路顺风。' }], choices: [], factCandidates: [], continuation: { summary: '', unresolved: [] } }));
  f.factModel.mockResolvedValue({ kind: 'extracted', candidates: [], attempts: 1 });
  const sourceReads = vi.spyOn(f.repo, 'readSource');
  const result = await f.controller.send({ scope: f.seed.head.scope, sessionId: f.seed.head.sessionId, operationId: 'background-main', text: '出发' });
  expect(result.kind).toBe('committed'); const before = sourceReads.mock.calls.length;
  await f.controller.waitForBackground();
  expect((await f.repo.readHead(f.seed.head.scope)).memoryRevision).toBe(1);
  expect(sourceReads.mock.calls.length).toBe(before); expect(f.controller.getView().snapshot!.head.memoryRevision).toBe(1);
  expect(f.controller.getView().jobRevision).toBeGreaterThan(0);
});
it('schedules the same independent summary after a variable retry without regenerating the body', async () => {
  const f = await setup();
  f.generateNarrative.mockResolvedValue(JSON.stringify({ body: [{ kind: 'dialogue', speaker: '安柏', text: '云，今天也要加油。' }], choices: [], factCandidates: [], continuation: { summary: '', unresolved: [] } }));
  f.factModel.mockResolvedValue({ kind: 'extracted', candidates: [], attempts: 1 }).mockResolvedValueOnce({ kind: 'failed', code: 'TEST_TEMP_FAILURE', detail: '临时失败', attempts: 1 });
  expect((await f.controller.send({ scope: f.seed.head.scope, sessionId: f.seed.head.sessionId, operationId: 'retry-with-summary', text: '问候' })).kind).toBe('failed');
  expect((await f.controller.retry('retry-with-summary')).kind).toBe('committed'); await f.controller.waitForBackground();
  expect((await f.repo.readHead(f.seed.head.scope)).memoryRevision).toBe(1); expect(f.generateNarrative).toHaveBeenCalledTimes(1);
});
it('automatically compresses only after the independent layer threshold, preserving all original turn sources', async () => {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-auto-compress-${crypto.randomUUID()}` }), seed = makeSeed();
  const controller = createCoreController({ repo, turnDependencies: () => ({ summarySettings: { mode: 'local', shortThreshold: 3, middleThreshold: 4, longThreshold: 5, prompt: '' },
    rulePolicy: { ruleVersion: 'test', storyNodes: [] }, assembleContext: async () => ({ systemPrompt: '', messages: [] }), factModel: async () => ({ kind: 'extracted', candidates: [], attempts: 1 }),
    generateNarrative: async () => JSON.stringify({ body: [{ kind: 'dialogue', speaker: '安柏', text: '云，今天也要顺风。' }], choices: [], factCandidates: [], continuation: { summary: '', unresolved: [] } }) }) });
  await controller.initialize(seed);
  for (let turn = 1; turn <= 3; turn++) { await controller.send({ scope: seed.head.scope, sessionId: seed.head.sessionId, operationId: `automatic-turn-${turn}`, text: '问候安柏' }); await controller.waitForBackground(); }
  const head = await repo.readHead(seed.head.scope), memories = (await repo.queryMemories({ scope: seed.head.scope, cutoffSeq: head.coreSeq, memoryRevision: head.memoryRevision, statuses: ['active'] })).items;
  expect(memories).toHaveLength(1); expect(memories[0]!.layer).toBe('middle'); expect(memories[0]!.turns).toEqual([1, 2, 3]);
  expect((await repo.querySources({ scope: seed.head.scope, cutoffSeq: head.coreSeq, kinds: ['narrative'] })).items.filter(row => row.operationId.startsWith('automatic-turn-'))).toHaveLength(3);
  expect(await repo.readSource(seed.sources[0]!.ref)).not.toBeNull();
});
it('offers a read-only preview token, then publishes exactly that plan through the real memory controller', async () => {
  const f = await makeMemoryMaintenanceFixture(), summarize = vi.fn(async () => ({ kind: 'model' as const, text: '三次问候安柏。' }));
  const controller = createCoreController({ repo: f.repo, memoryModels: { summarize }, turnDependencies: () => ({ summarySettings: f.input.settings,
    rulePolicy: { ruleVersion: 'test', storyNodes: [] }, assembleContext: async () => ({ systemPrompt: '', messages: [] }), generateNarrative: vi.fn(), factModel: vi.fn() }) });
  await controller.attach({ scope: f.seed.head.scope });
  const preview = await controller.previewMaintenance('compress', []);
  expect(preview.turns).toEqual([1, 2, 3]); expect(preview.modelRequests).toBe(1); expect(summarize).not.toHaveBeenCalled();
  expect((await controller.runMaintenance(preview.token)).kind).toBe('completed');
  expect(controller.getView().snapshot!.head.memoryRevision).toBe(4); expect(summarize).toHaveBeenCalledTimes(1);
  await expect(controller.runMaintenance(preview.token)).rejects.toThrow('CORE2_MAINTENANCE_PREVIEW_EXPIRED');
});
it('invalidates a prepared memory token on switching journeys without calling the model', async () => {
  const f = await makeMemoryMaintenanceFixture(), summarize = vi.fn();
  const controller = createCoreController({ repo: f.repo, memoryModels: { summarize }, turnDependencies: () => ({ summarySettings: f.input.settings,
    rulePolicy: { ruleVersion: 'test', storyNodes: [] }, assembleContext: async () => ({ systemPrompt: '', messages: [] }), generateNarrative: vi.fn(), factModel: vi.fn() }) });
  await controller.attach({ scope: f.seed.head.scope }); const preview = await controller.previewMaintenance('compress', []);
  await controller.initialize(makeSeed()); await expect(controller.runMaintenance(preview.token)).rejects.toThrow('CORE2_MAINTENANCE_PREVIEW_EXPIRED');
  expect(summarize).not.toHaveBeenCalled();
});
it('retries a failed summary independently and edits the published memory through an audited request', async () => {
  const f = await setup();
  const settings = { mode: 'model' as const, shortThreshold: 15, middleThreshold: 15, longThreshold: 15, prompt: '客观记录' };
  const summarize = vi.fn().mockResolvedValueOnce({ kind: 'failed', code: 'timeout', detail: '临时超时' }).mockResolvedValue({ kind: 'model', text: '安柏向云问好。' });
  const controller = createCoreController({ repo: f.repo, memoryModels: { summarize }, turnDependencies: () => ({ summarySettings: settings,
    rulePolicy: { ruleVersion: 'test', storyNodes: [] }, assembleContext: async () => ({ systemPrompt: '', messages: [] }), factModel: async () => ({ kind: 'extracted', candidates: [], attempts: 1 }),
    generateNarrative: async () => JSON.stringify({ body: [{ kind: 'dialogue', speaker: '安柏', text: '云，你好。' }], choices: [], factCandidates: [], continuation: { summary: '', unresolved: [] } }) }) });
  await controller.attach({ scope: f.seed.head.scope }); const head = controller.getView().snapshot!.head;
  const result = await controller.send({ scope: head.scope, sessionId: head.sessionId, operationId: 'failed-summary-main', text: '你好' });
  if (result.kind !== 'committed') throw Error('fixture'); await controller.waitForBackground();
  expect((await f.repo.readHead(head.scope)).memoryRevision).toBe(0);
  expect((await controller.retryJob(result.receipt.jobIds[0]!)).kind).toBe('completed');
  const current = await f.repo.readHead(head.scope), memory = (await f.repo.queryMemories({ scope: head.scope, cutoffSeq: current.coreSeq, memoryRevision: current.memoryRevision })).items[0]!;
  expect((await controller.editMemory({ memoryId: memory.memoryId, expectedVersion: 1, text: '玩家校正的问候。', pinned: true })).status).toBe('published');
  expect(controller.getView().snapshot!.head.memoryRevision).toBe(2);
  expect((await f.repo.queryMemories({ scope: head.scope, cutoffSeq: controller.getView().snapshot!.head.coreSeq, memoryRevision: 2 })).items[0]).toMatchObject({ version: 2, text: '玩家校正的问候。', pinned: true });
  expect(summarize).toHaveBeenCalledTimes(2);
});
it('saves a private message before requesting its reply and delivers it with its own summary', async () => {
  const f = await setup(), generate = vi.fn(async () => ({ text: '云，巡逻刚结束，收到你的消息啦！' }));
  const controller = createCoreController({ repo: f.repo, phoneModels: { generate, getModelIdentity: () => 'phone-model-test' }, turnDependencies: () => ({
    rulePolicy: { ruleVersion: 'test', storyNodes: [] }, assembleContext: async () => ({ systemPrompt: '', messages: [] }), generateNarrative: vi.fn(), factModel: async () => ({ kind: 'extracted', candidates: [], attempts: 1 }) }) });
  await controller.attach({ scope: f.seed.head.scope });
  await controller.command({ type: 'conversation_create', conversationId: 'phone-controller-chat', conversationType: 'private', name: '安柏', memberIds: ['npc-amber'] });
  const receipt = await controller.sendPhone({ conversationId: 'phone-controller-chat', text: '谢谢你，辛苦啦！', operationId: 'phone-controller-send' });
  expect(receipt.status).toBe('committed');
  await controller.waitForBackground();
  const head = await f.repo.readHead(f.seed.head.scope), events = (await f.repo.queryEvents({ scope: head.scope, cutoffSeq: head.coreSeq, types: ['communication.private'] })).items;
  expect((await f.repo.queryJobs({ scope: head.scope, cutoffSeq: head.coreSeq, kinds: ['courier'] })).items.map(job => ({ status: job.status, failure: job.failure }))).toEqual([{ status: 'completed', failure: undefined }]);
  expect(events).toHaveLength(2); expect(events.map(event => event.actorIds[0])).toEqual([f.seed.playerId, 'npc-amber']);
  expect(head.memoryRevision).toBe(2); expect(generate).toHaveBeenCalledTimes(1);
  expect(controller.getView().snapshot!.head.coreSeq).toBe(head.coreSeq);
  expect(controller.getView().messages).toEqual([]); // Phone writes never create another main body.
  expect((await controller.sendPhone({ conversationId: 'phone-controller-chat', text: '谢谢你，辛苦啦！', operationId: 'phone-controller-send' })).status).toBe('already_committed');
  await controller.waitForBackground(); expect(generate).toHaveBeenCalledTimes(1);
});
it('recovers a failed manual memory edit without recording another player operation', async () => {
  const f = await makeMemoryMaintenanceFixture();
  const controller = createCoreController({ repo: f.repo, turnDependencies: () => ({ rulePolicy: { ruleVersion: 'test', storyNodes: [] }, assembleContext: async () => ({ systemPrompt: '', messages: [] }), generateNarrative: vi.fn(), factModel: vi.fn() }) });
  await controller.attach({ scope: f.seed.head.scope });
  const snapshot = controller.getView().snapshot!, memory = (await f.repo.queryMemories({ scope: snapshot.head.scope, cutoffSeq: snapshot.head.coreSeq, memoryRevision: snapshot.head.memoryRevision })).items[0]!;
  const publish = vi.spyOn(f.repo, 'publishDerived').mockRejectedValueOnce(Error('temporary disk failure'));
  expect((await controller.editMemory({ memoryId: memory.memoryId, expectedVersion: memory.version, text: '玩家手动校正的经历。' })).status).toBe('conflict');
  const before = await f.repo.readHead(snapshot.head.scope), job = (await f.repo.queryJobs({ scope: snapshot.head.scope, cutoffSeq: before.coreSeq, kinds: ['manual_memory'] })).items[0]!;
  expect(job.status).toBe('failed');
  expect((await controller.retryJob(job.jobId)).kind).toBe('completed');
  expect((await f.repo.readHead(snapshot.head.scope)).coreSeq).toBe(before.coreSeq);
  expect((await f.repo.queryMemories({ scope: snapshot.head.scope, cutoffSeq: before.coreSeq, memoryRevision: controller.getView().snapshot!.head.memoryRevision, memoryIds: [memory.memoryId] })).items[0]).toMatchObject({ text: '玩家手动校正的经历。', version: memory.version + 1 });
  expect(publish).toHaveBeenCalledTimes(2);
});
it('captures the current settlement dependencies when a reply job starts, not at controller creation', async () => {
  const f = await setup(), first = vi.fn(async () => ({ kind: 'extracted' as const, candidates: [], attempts: 0 })), latest = vi.fn(async () => ({ kind: 'extracted' as const, candidates: [], attempts: 0 }));
  let factModel = first;
  const controller = createCoreController({ repo: f.repo, phoneModels: { generate: async () => ({ text: '云，收到你的消息啦！' }), getModelIdentity: () => 'test' }, turnDependencies: () => ({
    factModel, rulePolicy: { ruleVersion: 'test', storyNodes: [] }, generateNarrative: vi.fn(), assembleContext: async () => ({ systemPrompt: '', messages: [] }),
  }) });
  await controller.attach({ scope: f.seed.head.scope });
  await controller.command({ type: 'conversation_create', conversationId: 'latest-config', name: '安柏', conversationType: 'private', memberIds: ['npc-amber'] });
  factModel = latest;
  await controller.sendPhone({ conversationId: 'latest-config', text: '你好', operationId: 'latest-config-send' }); await controller.waitForBackground();
  expect(first).not.toHaveBeenCalled(); expect(latest).toHaveBeenCalledTimes(1);
});
