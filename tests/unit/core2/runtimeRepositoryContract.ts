import { expect, it, vi } from 'vitest';
import type { CoreRepository } from '@/core/contracts/storage';
import { createCoreController } from '@/core/settlement/coreController';
import { makeSeed } from './fixtures';
import { exportCorePackage, prepareCoreImport } from '@/core/persistence/packageTransfer';

export function assertRuntimeRepositoryContract(factory: () => Promise<CoreRepository>): void {
  it('restores a registered staged reply after export without another model call, and rejects an unregistered orphan', async () => {
    const repo = await factory(), seed = makeSeed(); seed.records = seed.records.filter(row => row.domain !== 'album');
    const generate = vi.fn(async () => ({ text: '云，已经保存的回信应该只生成一次。' })), put = repo.putSource.bind(repo);
    let lost = false;
    vi.spyOn(repo, 'putSource').mockImplementation(async source => { const ref = await put(source); if (!lost && source.kind === 'courier' && source.blocks[0]?.speakerId === 'npc-amber') { lost = true; throw Error('TEST_OUTPUT_ACK_LOST'); } return ref; });
    const controller = createCoreController({ repo, phoneModels: { generate, getModelIdentity: () => 'staged-output-fixture' }, turnDependencies: () => ({
      rulePolicy: { ruleVersion: 'test', storyNodes: [] }, assembleContext: async () => ({ systemPrompt: '', messages: [] }), generateNarrative: async () => { throw Error('NO_MAIN_MODEL'); }, factModel: async () => ({ kind: 'extracted', candidates: [], attempts: 0 }),
    }) });
    try {
      await controller.initialize(seed);
      await controller.command({ type: 'conversation_create', conversationId: 'staged-chat', conversationType: 'private', name: '安柏', memberIds: ['npc-amber'] });
      await controller.sendPhone({ conversationId: 'staged-chat', operationId: 'staged-player-send', text: '你好，安柏。' }); await controller.waitForBackground();
      const imported = await prepareCoreImport(await exportCorePackage(repo, seed.head.scope));
      const output = imported.sources.find(row => row.commitSeq === null && row.record.kind === 'courier' && row.record.blocks[0]?.speakerId === 'npc-amber'); expect(output).toBeTruthy();
      const forged = structuredClone(imported); forged.sources.find(row => row.record.ref.sourceId === output!.record.ref.sourceId)!.record.operationId = 'unregistered-output';
      await expect(repo.importPrepared(forged)).rejects.toThrow('CORE2_IMPORT_SOURCE_POSITION');
      await repo.importPrepared(imported); await controller.attach({ scope: imported.manifest.scope });
      const task = imported.jobs.find(row => row.record.kind === 'courier' && row.record.status === 'failed')!;
      expect((await controller.retryJob(task.record.jobId)).kind).toBe('completed'); await controller.waitForBackground();
      expect(generate).toHaveBeenCalledTimes(1);
    } finally { controller.dispose(); }
  });
  it('persists an actual proactive task and refreshes the same automatic node after delivery', async () => {
    const repo = await factory(), seed = makeSeed(), world = seed.records.find(row => row.domain === 'world'), npc = seed.records.find(row => row.domain === 'npc');
    if (world?.domain !== 'world' || npc?.domain !== 'npc') throw Error('fixture');
    world.value.completedMainTurns = 14; world.value.moment.turn = 14; npc.value.affinity = 100;
    const controller = createCoreController({ repo, phoneModels: { generate: async () => ({ text: '云，今天的蒙德很热闹，你还好吗？' }), getModelIdentity: () => 'local-native-fixture' }, turnDependencies: () => ({
      rulePolicy: { ruleVersion: 'test', storyNodes: [] }, assembleContext: async () => ({ systemPrompt: '', messages: [] }), factModel: async () => ({ kind: 'extracted', candidates: [], attempts: 0 }),
      generateNarrative: async () => JSON.stringify({ body: [{ kind: 'narration', text: '蒙德城里微风拂过。' }], choices: [], factCandidates: [], continuation: { summary: '', unresolved: [] } }),
    }) });
    await controller.initialize(seed);
    const result = await controller.send({ scope: seed.head.scope, sessionId: seed.head.sessionId, operationId: 'native-proactive-main', text: '继续' });
    expect(result.kind).toBe('committed'); await controller.waitForBackground();
    const head = await repo.readHead(seed.head.scope), state = await repo.readState(head.scope);
    expect(state.records.find(row => row.domain === 'world')).toMatchObject({ value: { proactiveLastTurn: 15, completedMainTurns: 15 } });
    const messages = (await repo.queryEvents({ scope: head.scope, cutoffSeq: head.coreSeq, types: ['communication.private'] })).items;
    expect(messages).toHaveLength(1);
    const jobs = (await repo.queryJobs({ scope: head.scope, cutoffSeq: head.coreSeq, kinds: ['courier'] })).items;
    expect(jobs).toHaveLength(1); expect(jobs[0]!.status).toBe('completed');
    const slots = (await repo.listSaveSlots(head.scope.journeyId)).filter(row => row.kind === 'auto'); expect(slots).toHaveLength(1);
    const saved = await repo.readSnapshot(slots[0]!.snapshotId);
    expect(saved?.coreSeq).toBe(head.coreSeq);
    expect(saved?.state.records.find(row => row.domain === 'world')).toMatchObject({ value: { proactiveLastTurn: 15 } });
    controller.dispose();
  });
}
