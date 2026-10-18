import { expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { createCoreController } from '@/core/settlement/coreController';
import { makeSeed } from './fixtures';
import type { CorePhoneGenerationInput } from '@/core/jobs/phoneJob';
import { exportCorePackage, prepareCoreImport } from '@/core/persistence/packageTransfer';
import { checksumBytes } from '@/core/sources/sourceIntegrity';
import { readCoreMomentPlan } from '@/core/jobs/momentPlan';

async function setup(generate = vi.fn(async (_input: CorePhoneGenerationInput) => ({ text: '今天一起出发，沿途的风景真不错。' })), getModelIdentity = () => 'moment-model-v1') {
  const seed = makeSeed(), amber = seed.records.find(row => row.domain === 'npc');
  if (amber?.domain !== 'npc') throw Error('fixture');
  for (const [id, name, team, affinity] of [
    ['lisa', '丽莎', true, 0], ['kaeya', '凯亚', false, 0],
    ...['琴', '诺艾尔', '砂糖', '莫娜', '优菈'].map((name, i) => [`friend-${i}`, name, false, 100]),
  ] as [string, string, boolean, number][]) {
    const npcId = `npc-${id}`;
    seed.records.push({ ...structuredClone(amber), entityId: npcId, value: { ...structuredClone(amber.value), id: npcId, 姓名: name, travelingTogether: team, affinity } });
    seed.records.push({ scope: seed.head.scope, domain: 'courier', entityId: `contact-${id}`, version: 1, value: { kind: 'contact', npcId, name, remark: '', available: true } });
  }
  // A party member without a phone contact must still be allowed to comment.
  seed.records = seed.records.filter(row => row.entityId !== 'contact-lisa');
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-moment-job-${crypto.randomUUID()}` });
  const controller = createCoreController({ repo, phoneModels: { generate, getModelIdentity }, turnDependencies: () => ({
    rulePolicy: { ruleVersion: 'test', storyNodes: [] }, generateNarrative: vi.fn(), assembleContext: async () => ({ systemPrompt: '', messages: [] }),
    factModel: async () => ({ kind: 'extracted', candidates: [], attempts: 0 }),
  }) });
  await controller.initialize(seed);
  return { repo, controller, seed, generate };
}
it('freezes team, mentions and three other friends as durable jobs in the publication commit', async () => {
  const f = await setup();
  const receipt = await f.controller.command({ type: 'moment', action: 'publish', momentId: 'post-one', text: '今天一起出发。', mentionedNpcIds: ['npc-kaeya'] }, 'publish-one');
  expect(receipt.jobIds).toHaveLength(6);
  await f.controller.waitForBackground();
  const snapshot = await f.repo.readState(f.seed.head.scope);
  const tasks = (await f.repo.queryJobs({ scope: snapshot.head.scope, cutoffSeq: snapshot.head.coreSeq, kinds: ['courier'] })).items;
  expect(tasks.map(task => ({ status: task.status, failure: task.failure }))).toEqual(Array.from({ length: 6 }, () => ({ status: 'completed', failure: undefined })));
  const post = snapshot.records.find(row => row.domain === 'courier' && row.entityId === 'post-one');
  expect(post).toMatchObject({ value: { commentNpcIds: expect.arrayContaining(['npc-amber', 'npc-lisa', 'npc-kaeya']) } });
  const comments = (await f.repo.queryEvents({ scope: snapshot.head.scope, cutoffSeq: snapshot.head.coreSeq, types: ['communication.moment'] })).items;
  expect(comments).toHaveLength(6);
  expect(new Set(comments.map(row => row.actorIds[0])).size).toBe(6);
  expect(f.generate).toHaveBeenCalledTimes(6);
  expect(f.generate.mock.calls.every(([input]) => input.target === 'moment')).toBe(true);
  for (const task of tasks) {
    const source = await f.repo.readSource(readCoreMomentPlan(task).outputSourceRef);
    const delivered = f.generate.mock.calls.find(([input]) => input.context.bundle.bundleId === source?.delivery?.bundles[0]?.bundleId)?.[0];
    expect(delivered).toBeTruthy();
    expect(source?.delivery).toEqual({ version: 1, bundles: [{ bundleId: delivered!.context.bundle.bundleId, target: 'moment', npcIds: [source!.blocks[0]!.speakerId!], selectedLeafIds: delivered!.context.bundle.selectedLeafIds }], worldbookEntryIds: [] });
  }
  expect(snapshot.records.find(row => row.domain === 'world')).toMatchObject({ value: { completedMainTurns: 0, moment: f.seed.records.find(row => row.domain === 'world')!.value.moment } });
  await f.controller.command({ type: 'moment', action: 'publish', momentId: 'post-one', text: '今天一起出发。', mentionedNpcIds: ['npc-kaeya'] }, 'publish-one');
  await f.controller.waitForBackground(); expect(f.generate).toHaveBeenCalledTimes(6);
});

it('does not repeat the preceding random trio even when previous comments failed', async () => {
  const generate = vi.fn(async (_input: CorePhoneGenerationInput): Promise<{ text: string }> => { throw Error('temporary provider failure'); });
  const f = await setup(generate);
  await f.controller.command({ type: 'moment', action: 'publish', momentId: 'post-one', text: '第一条动态。' }); await f.controller.waitForBackground();
  const first = f.controller.getView().snapshot!.records.find(row => row.domain === 'courier' && row.entityId === 'post-one');
  await f.controller.command({ type: 'moment', action: 'publish', momentId: 'post-two', text: '第二条动态。' }); await f.controller.waitForBackground();
  const second = f.controller.getView().snapshot!.records.find(row => row.domain === 'courier' && row.entityId === 'post-two');
  expect(first?.domain === 'courier' && first.value.kind === 'moment' && first.value.randomCommentNpcIds).toHaveLength(3);
  expect(second?.domain === 'courier' && second.value.kind === 'moment' && [...second.value.randomCommentNpcIds!].sort()).not.toEqual(first?.domain === 'courier' && first.value.kind === 'moment' && [...first.value.randomCommentNpcIds!].sort());
});
it('retains successful comments and retries only the failed member', async () => {
  const generate = vi.fn(async ({ npcName }: CorePhoneGenerationInput) => { if (npcName === '丽莎') throw Error('temporary provider failure'); return { text: '风景很好，下次再一起出发。' }; });
  const f = await setup(generate);
  await f.controller.command({ type: 'moment', action: 'publish', momentId: 'post-one', text: '第一条动态。' }); await f.controller.waitForBackground();
  const head = await f.repo.readHead(f.seed.head.scope), jobs = (await f.repo.queryJobs({ scope: head.scope, cutoffSeq: head.coreSeq, kinds: ['courier'], statuses: ['failed'] })).items;
  expect(jobs).toHaveLength(1);
  const before = generate.mock.calls.length; generate.mockImplementation(async () => ({ text: '小可爱，图书馆的茶准备好啦。' }));
  expect((await f.controller.retryJob(jobs[0]!.jobId)).kind).toBe('completed'); await f.controller.waitForBackground();
  expect(generate.mock.calls.length).toBe(before + 1);
});
it('acknowledges an already committed comment from a new retry attempt after its post was deleted, without regenerating or reviving it', async () => {
  const f = await setup(), finish = f.repo.finishJob.bind(f.repo); let lost = false;
  vi.spyOn(f.repo, 'finishJob').mockImplementation(async input => {
    const task = (await f.repo.queryJobs({ scope: input.scope, cutoffSeq: (await f.repo.readHead(input.scope)).coreSeq, jobIds: [input.jobId] })).items[0];
    if (!lost && task?.kind === 'courier' && input.status === 'completed') { lost = true; throw Error('TEST_COMPLETION_ACK_LOST'); }
    return finish(input);
  });
  await f.controller.command({ type: 'moment', action: 'publish', momentId: 'ack-post', text: '这条动态已经被评论过。', visibilityNpcIds: ['npc-amber'] }); await f.controller.waitForBackground();
  const head = await f.repo.readHead(f.seed.head.scope), failed = (await f.repo.queryJobs({ scope: head.scope, cutoffSeq: head.coreSeq, kinds: ['courier'], statuses: ['failed'] })).items[0]!;
  expect(failed).toBeTruthy(); expect(f.generate).toHaveBeenCalledTimes(1);
  await f.controller.stopJob(failed.jobId);
  await f.controller.command({ type: 'moment', action: 'delete', momentId: 'ack-post' });
  expect((await f.controller.retryJob(failed.jobId)).kind).toBe('completed'); await f.controller.waitForBackground();
  expect(f.generate).toHaveBeenCalledTimes(1);
  const state = await f.repo.readState(head.scope);
  expect(state.records.some(row => row.domain === 'courier' && row.entityId === 'ack-post')).toBe(false);
  expect((await f.repo.queryEvents({ scope: head.scope, cutoffSeq: state.head.coreSeq, types: ['communication.moment'] })).items).toHaveLength(1);
});

it.each(['edit', 'delete'] as const)('does not publish an old comment after the post is %s during generation', async action => {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  const generate = vi.fn(async () => { enter(); await held; return { text: '这条过期评论不能发布。' }; });
  const f = await setup(generate);
  await f.controller.command({ type: 'moment', action: 'publish', momentId: 'post-one', text: '发布时的文字。' });
  await entered;
  await f.controller.command({ type: 'moment', action, momentId: 'post-one', ...(action === 'edit' ? { text: '编辑后的新文字。', visibilityNpcIds: [] } : {}) });
  release(); await f.controller.waitForBackground();
  const head = await f.repo.readHead(f.seed.head.scope);
  expect((await f.repo.queryEvents({ scope: head.scope, cutoffSeq: head.coreSeq, types: ['communication.moment'] })).items).toEqual([]);
  expect(generate).toHaveBeenCalledTimes(1);
});
it('atomically rejects cancellation arriving at the final comment commit, not just during generation', async () => {
  const f = await setup(), commit = f.repo.commit.bind(f.repo);
  vi.spyOn(f.repo, 'commit').mockImplementation(async batch => {
    if (batch.operationId.startsWith('moment-reply-')) {
      const jobs = (await f.repo.queryJobs({ scope: batch.scope, cutoffSeq: (await f.repo.readHead(batch.scope)).coreSeq, kinds: ['courier'] })).items;
      const running = jobs.find(job => job.status === 'running')!;
      await f.repo.cancelJob(batch.scope, running.jobId);
    }
    return commit(batch);
  });
  await f.controller.command({ type: 'moment', action: 'publish', momentId: 'cancelled-at-commit', text: '本次评论在提交前已停止。', visibilityNpcIds: ['npc-amber'] });
  await f.controller.waitForBackground();
  const head = await f.repo.readHead(f.seed.head.scope);
  expect((await f.repo.queryEvents({ scope: head.scope, cutoffSeq: head.coreSeq, types: ['communication.moment'] })).items).toEqual([]);
});
it('explicitly retries a stopped member with a new job, and never regenerates an acknowledged body', async () => {
  let identity = 'moment-model-v1', release!: () => void, enter!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  const generate = vi.fn(async (_input: CorePhoneGenerationInput) => { enter(); await held; return { text: '这次已经收到，风景真好。' }; });
  const f = await setup(generate, () => identity);
  await f.controller.command({ type: 'moment', action: 'publish', momentId: 'restart-member', text: '只给安柏的动态。', visibilityNpcIds: ['npc-amber'] });
  await entered;
  const head = await f.repo.readHead(f.seed.head.scope), job = (await f.repo.queryJobs({ scope: head.scope, cutoffSeq: head.coreSeq, kinds: ['courier'] })).items[0]!;
  await f.controller.stopJob(job.jobId); release(); await f.controller.waitForBackground();
  identity = 'moment-model-v2';
  expect((await f.controller.retryJob(job.jobId)).kind).toBe('completed'); await f.controller.waitForBackground();
  const before = generate.mock.calls.length; identity = 'moment-model-v3';
  const latest = (await f.repo.queryJobs({ scope: head.scope, cutoffSeq: (await f.repo.readHead(head.scope)).coreSeq, kinds: ['courier'], statuses: ['completed'] })).items[0]!;
  expect((await f.controller.retryJob(latest.jobId)).kind).toBe('completed'); await f.controller.waitForBackground();
  expect(generate.mock.calls.length).toBe(before);
  const count = (await f.repo.queryJobs({ scope: head.scope, cutoffSeq: (await f.repo.readHead(head.scope)).coreSeq, kinds: ['courier'] })).items.length;
  expect((await f.controller.retryJob(job.jobId)).kind).toBe('completed');
  expect((await f.repo.queryJobs({ scope: head.scope, cutoffSeq: (await f.repo.readHead(head.scope)).coreSeq, kinds: ['courier'] })).items).toHaveLength(count);
  expect(generate.mock.calls.length).toBe(before);
});
it('restores an exported failed comment in an independent journey with matching UI reply identities', async () => {
  const generate = vi.fn(async (_input: CorePhoneGenerationInput): Promise<{ text: string }> => { throw Error('temporary provider failure'); });
  const f = await setup(generate);
  const bytes = new Uint8Array([137, 80, 78, 71]);
  await f.repo.publishAsset({ scope: f.seed.head.scope, sessionId: f.seed.head.sessionId, asset: { scope: f.seed.head.scope, assetId: 'asset-fixture', mimeType: 'image/png', bytes, checksum: checksumBytes(bytes) } });
  await f.controller.command({ type: 'moment', action: 'publish', momentId: 'imported-post', text: '原来的动态内容。', visibilityNpcIds: ['npc-amber'] }); await f.controller.waitForBackground();
  const prepared = await prepareCoreImport(await exportCorePackage(f.repo, f.seed.head.scope));
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-moment-import-${crypto.randomUUID()}` });
  const head = await repo.importPrepared(prepared), reply = vi.fn(async (_input: CorePhoneGenerationInput) => ({ text: '这次收到你的动态啦！' }));
  const controller = createCoreController({ repo, phoneModels: { generate: reply, getModelIdentity: () => 'moment-model-v1' }, turnDependencies: () => ({
    rulePolicy: { ruleVersion: 'test', storyNodes: [] }, generateNarrative: vi.fn(), assembleContext: async () => ({ systemPrompt: '', messages: [] }), factModel: async () => ({ kind: 'extracted', candidates: [], attempts: 0 }),
  }) });
  await controller.attach({ scope: head.scope });
  const job = (await repo.queryJobs({ scope: head.scope, cutoffSeq: head.coreSeq, kinds: ['courier'] })).items[0]!;
  expect((await controller.retryJob(job.jobId)).kind).toBe('completed'); await controller.waitForBackground();
  const snapshot = controller.getView().snapshot!, post = snapshot.records.find(row => row.domain === 'courier' && row.entityId === 'imported-post');
  const event = (await repo.queryEvents({ scope: head.scope, cutoffSeq: snapshot.head.coreSeq, types: ['communication.moment'] })).items[0]!;
  expect(post).toMatchObject({ value: { commentReplies: [{ npcId: 'npc-amber', jobId: job.jobId, operationId: event.operationId }] } });
  expect(reply).toHaveBeenCalledTimes(1); expect(snapshot.head.scope.journeyId).not.toBe(f.seed.head.scope.journeyId);
});
