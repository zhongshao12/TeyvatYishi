import { describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { createCoreGameController } from '@/core/view/coreGameController';
import { freezeSource } from '@/core/sources/sourceRecords';
import { makeSeed } from './fixtures';

async function fixture() {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-controller-${crypto.randomUUID()}` });
  const seed = makeSeed();
  const generateNarrative = vi.fn(async () => JSON.stringify({ body: [{ kind: 'dialogue', speaker: '安柏', text: '云，路上小心。' }], choices: [], factCandidates: [], continuation: { summary: '', unresolved: [] } }));
  const assembleContext = vi.fn(async (_input: import('@/core/settlement/turnRunner').CoreContextInput) => ({ systemPrompt: '', messages: [] }));
  const controller = createCoreGameController(repo, { turnDependencies: () => ({ generateNarrative, assembleContext, factModel: async () => ({ kind: 'extracted', candidates: [], attempts: 1 }), rulePolicy: { ruleVersion: 'test', storyNodes: [] } }) });
  await controller.initialize(seed);
  return { repo, seed, controller, generateNarrative, assembleContext };
}
describe('core2 authoritative controller', () => {
  it.each(['putSource', 'prepareOperation'] as const)('unblocks a main turn when its initial %s fails before there is a recoverable operation', async method => {
    const f = await fixture(); vi.spyOn(f.repo, method).mockRejectedValueOnce(Error('TEST_INITIAL_WRITE_FAILED'));
    const input = { scope: f.seed.head.scope, sessionId: f.seed.head.sessionId, operationId: 'unsaved-input', text: '原输入不能丢。' };
    expect(await f.controller.send(input)).toMatchObject({ kind: 'failed' });
    expect(await f.repo.readOperation(input.scope, input.operationId)).toBeNull();
    expect(f.controller.getView().pendingOperationId).toBeNull();
    expect(f.generateNarrative).not.toHaveBeenCalled();
    expect((await f.controller.send({ ...input, operationId: 'new-input' })).kind).toBe('committed');
  });
  it.each(['missing', 'committed'] as const)('clears an obsolete %s pending navigation pointer when reopening the journey', async status => {
    const f = await fixture(), operationId = 'old-pointer';
    if (status === 'committed') await f.controller.send({ scope: f.seed.head.scope, sessionId: f.seed.head.sessionId, operationId, text: '已经保存的原输入' });
    await f.controller.attach({ scope: f.seed.head.scope, pendingOperationId: operationId });
    expect(f.controller.getView().pendingOperationId).toBeNull();
    const head = f.controller.getView().snapshot!.head;
    expect((await f.controller.send({ scope: head.scope, sessionId: head.sessionId, operationId: 'after-reopen', text: '继续' })).kind).toBe('committed');
  });
  it('keeps recent main turns visible and delivered after many non-main commits and a branch restore', async () => {
    const f = await fixture();
    await f.controller.send({ scope: f.seed.head.scope, sessionId: f.seed.head.sessionId, operationId: 'before-many-edits', text: '今天约好在城门见。' });
    for (let i = 0; i < 25; i++) {
      const operationId = 'history-edit-' + i, command = { type: 'edit_npc' as const, npcId: 'npc-amber', field: 'appearance' as const, value: '红棕发' + i };
      const source = freezeSource({ scope: f.seed.head.scope, operationId, kind: 'manual', moment: f.seed.sources[0]!.moment, blocks: [{ blockId: 'command', kind: 'configuration', text: JSON.stringify(command) }] });
      await f.controller.execute({ kind: 'player', actionId: operationId, source, command });
    }
    expect(f.controller.getView().messages).toHaveLength(2);
    const saved = await f.controller.save({ scope: f.seed.head.scope, kind: 'manual', asNew: true, turn: 1, name: '云' });
    const restored = await f.controller.restore(saved.snapshotId);
    expect(f.controller.getView().messages).toHaveLength(2);
    await f.controller.send({ scope: restored.scope, sessionId: restored.sessionId, operationId: 'after-many-edits', text: '继续刚才的话题。' });
    expect(f.assembleContext.mock.calls.at(-1)![0].history.map(source => source.operationId)).toEqual(['before-many-edits', 'before-many-edits']);
  });
  it('does not apply an earlier background receipt refresh to a newer main-turn receipt', async () => {
    const { repo, seed, controller } = await fixture();
    const input = { scope: seed.head.scope, sessionId: seed.head.sessionId, text: '你好' };
    await controller.send({ ...input, operationId: 'receipt-one' });
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    const read = repo.readHead.bind(repo); vi.spyOn(repo, 'readHead').mockImplementationOnce(async scope => { const head = await read(scope); enter(); await held; return head; });
    const refresh = controller.refreshDerived(); await entered;
    const second = await controller.send({ ...input, operationId: 'receipt-two' }); if (second.kind !== 'committed') throw Error('fixture');
    const jobId = second.receipt.jobIds[0]!, job = (await repo.queryJobs({ scope: seed.head.scope, cutoffSeq: second.receipt.coreSeq, jobIds: [jobId] })).items[0]!;
    const owned = await repo.claimJob({ scope: seed.head.scope, sessionId: seed.head.sessionId, jobId, leaseId: 'new-receipt-worker', sourceRefs: job.sourceRefs, expectedVersion: job.version }); if (!owned?.leaseId) throw Error('fixture');
    await repo.finishJob({ scope: seed.head.scope, sessionId: seed.head.sessionId, jobId, leaseId: owned.leaseId, sourceRefs: owned.sourceRefs, expectedVersion: owned.version, status: 'completed' });
    await controller.refreshDerived(); const actual = controller.getView().receipt; expect(actual?.memoryPending).toBe(false);
    release(); await refresh;
    expect(controller.getView().receipt).toBe(actual);
    expect(controller.getView().receipt?.memoryPending).toBe(false);
    expect(controller.getView().snapshot!.head.coreSeq).toBe(2);
  });
  it('serializes manual commands while their captured state is being committed', async () => {
    const { repo, seed, controller } = await fixture();
    const command = { type: 'edit_npc' as const, npcId: 'npc-amber', field: 'appearance' as const, value: '红棕头发' };
    const source = freezeSource({ scope: seed.head.scope, operationId: 'serialized-edit', kind: 'manual', moment: seed.sources[0]!.moment, blocks: [{ blockId: 'command', kind: 'configuration', text: JSON.stringify(command) }] });
    let release!: () => void, entered!: () => void;
    const reached = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    const put = repo.putSource.bind(repo); vi.spyOn(repo, 'putSource').mockImplementationOnce(async input => { entered(); await held; return put(input); });
    const action = { kind: 'player' as const, actionId: 'serialized-edit', source, command }, pending = controller.execute(action); await reached;
    expect(controller.getView().busy).toBe(true);
    await expect(controller.execute(action)).rejects.toThrow('CORE2_PLAYER_ACTION_AUTHORITY');
    release(); expect((await pending).status).toBe('committed'); expect(controller.getView().busy).toBe(false);
  });
  it('publishes a read-only projection with one user message and one body, including after an explicit retry', async () => {
    const { seed, controller, generateNarrative } = await fixture();
    const input = { scope: seed.head.scope, sessionId: seed.head.sessionId, operationId: 'controller-turn', text: '问候' };
    expect((await controller.send(input)).kind).toBe('committed');
    await controller.retry(input.operationId);
    expect(controller.getView().messages).toHaveLength(2);
    expect(new Set(controller.getView().messages.map(message => message.id)).size).toBe(2);
    expect(generateNarrative).toHaveBeenCalledTimes(1);
  });
  it('overwrites the current manual slot and reports a failed save without claiming a new success', async () => {
    const { repo, seed, controller } = await fixture();
    const request = { scope: seed.head.scope, kind: 'manual' as const, asNew: false, turn: 0, name: '云' };
    const first = await controller.save(request), second = await controller.save(request);
    expect(second.slotId).toBe(first.slotId);
    expect(await repo.listSaveSlots(seed.head.scope.journeyId)).toHaveLength(1);
    vi.spyOn(repo, 'publishSnapshot').mockRejectedValueOnce(Error('disk failed'));
    await expect(controller.save(request)).rejects.toThrow('disk failed');
    expect(controller.getView().error).toContain('disk failed');
    expect(controller.getView().lastSaved?.snapshotId).toBe(second.snapshotId);
  });
  it('executes a registered manual field command without calling a model or granting NPC historical knowledge', async () => {
    const { repo, seed, controller, generateNarrative } = await fixture();
    const command = { type: 'edit_npc' as const, npcId: 'npc-amber', field: 'appearance' as const, value: '红棕色头发' };
    const source = freezeSource({ scope: seed.head.scope, operationId: 'manual-edit', kind: 'manual', moment: seed.sources[0]!.moment, blocks: [{ blockId: 'command', kind: 'configuration', text: JSON.stringify(command) }] });
    expect((await controller.execute({ kind: 'player', actionId: 'manual-edit', source, command })).status).toBe('committed');
    expect((await controller.read()).records.find(r => r.domain === 'npc')?.value).toMatchObject({ appearance: '红棕色头发' });
    expect(generateNarrative).not.toHaveBeenCalled();
    expect((await repo.queryKnowledge({ scope: seed.head.scope, cutoffSeq: 1 })).items).toEqual([]);
  });
  it('restores by creating an isolated branch and never rewrites the saved branch', async () => {
    const { repo, seed, controller } = await fixture();
    const saved = await controller.save({ scope: seed.head.scope, kind: 'manual', asNew: false, turn: 0, name: '云' });
    const head = await controller.restore(saved.snapshotId);
    expect(head.scope.branchId).not.toBe(seed.head.scope.branchId);
    expect(head.scope.journeyId).toBe(seed.head.scope.journeyId);
    expect((await repo.readHead(seed.head.scope)).coreSeq).toBe(0);
  });
  it('restores the actual manual saved indicator from the validated navigation pointer', async () => {
    const { repo, seed, controller } = await fixture();
    const slot = await controller.save({ scope: seed.head.scope, kind: 'manual', asNew: false, turn: 0, name: '云' });
    const fresh = createCoreGameController(repo, { turnDependencies: () => ({ generateNarrative: async () => { throw Error('not called'); }, assembleContext: async () => ({ systemPrompt: '', messages: [] }), rulePolicy: { ruleVersion: 'test', storyNodes: [] } }) });
    await fresh.attach({ scope: seed.head.scope, manualSlotId: slot.slotId });
    expect(fresh.getView().lastSaved?.snapshotId).toBe(slot.snapshotId);
  });
  it('does not let a delayed old save poison a new journey’s current slot or saved indicator', async () => {
    const { repo, seed, controller } = await fixture();
    let release!: () => void, entered!: () => void;
    const reached = new Promise<void>(resolve => { entered = resolve; }); const held = new Promise<void>(resolve => { release = resolve; });
    const publish = repo.publishSnapshot.bind(repo);
    vi.spyOn(repo, 'publishSnapshot').mockImplementationOnce(async (...args) => { await publish(...args); entered(); await held; });
    const saving = controller.save({ scope: seed.head.scope, kind: 'manual', asNew: false, turn: 0, name: '云' });
    await reached;
    const next = makeSeed(); await controller.initialize(next);
    release(); await saving;
    expect(controller.getView().lastSaved).toBeNull();
    const fresh = await controller.save({ scope: next.head.scope, kind: 'manual', asNew: false, turn: 0, name: '云' });
    expect(fresh.journeyId).toBe(next.head.scope.journeyId);
  });
  it('never adopts another tab’s writer session just by refreshing the read-only view', async () => {
    const { repo, seed, controller, generateNarrative } = await fixture();
    await repo.activateSession(seed.head.scope, 'other-tab-session');
    await controller.read();
    await expect(controller.send({ scope: seed.head.scope, sessionId: 'other-tab-session', operationId: 'stolen', text: '问候' })).rejects.toThrow('CORE2_SESSION_CHANGED');
    expect(generateNarrative).not.toHaveBeenCalled();
    expect((await repo.readHead(seed.head.scope)).coreSeq).toBe(0);
  });
});
