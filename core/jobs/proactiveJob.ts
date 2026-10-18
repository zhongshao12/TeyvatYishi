import { buildCoreConsumerContext, type ConsumerContextBundle } from '../retrieval/consumerContext';
import { runCoreJob, readCoreJob, type CoreJobRunInput, type JobRunResult } from './jobRunner';
import { readCoreProactivePlan } from './proactivePlan';
import { freezeSource } from '../sources/sourceRecords';
import { consumerDelivery } from '../sources/consumerDelivery';
import { sameScope, sameData } from '../persistence/repositoryValidation';
import { commitCoreInteraction } from '../settlement/consumerOperations';
import type { CorePhoneJobDependencies } from './phoneJob';

export async function runCoreProactiveJob(input: CoreJobRunInput, deps: CorePhoneJobDependencies): Promise<JobRunResult> {
  const job = await readCoreJob(deps.repo, input.scope, input.jobId);
  if (!job) return { kind: 'failed', jobId: input.jobId, detail: '找不到主动来信任务。' };
  const plan = readCoreProactivePlan(job), proactive = { npcId: plan.npcId, contactId: plan.contactId, operationId: plan.replyOperationId, atTurn: plan.atTurn, previousTurn: plan.previousTurn };
  if (job.status === 'completed') return { kind: 'completed', jobId: job.jobId };
  const current = async (signal: AbortSignal, requireModel: boolean) => {
    const snapshot = await deps.repo.readState(input.scope), active = deps.getActiveSession?.(), live = await readCoreJob(deps.repo, input.scope, input.jobId);
    if (signal.aborted || snapshot.head.sessionId !== input.sessionId || deps.getActiveSession && (!active || !sameScope(active.scope, input.scope) || active.sessionId !== input.sessionId)) throw Error('CORE2_PROACTIVE_SESSION_CHANGED');
    if (!live || live.status === 'cancelled' || live.retriedByJobId) throw Error('CORE2_PROACTIVE_CANCELLED');
    if (requireModel && deps.getModelIdentity() !== plan.modelIdentity) throw Error('主动来信模型已改变，请显式重试；未发布迟到结果。');
    const world = snapshot.records.find(row => row.domain === 'world'), npc = snapshot.records.find(row => row.domain === 'npc' && row.entityId === plan.npcId), contact = snapshot.records.find(row => row.domain === 'courier' && row.entityId === plan.contactId), channel = snapshot.records.find(row => row.domain === 'courier' && row.entityId === plan.channelId);
    const reservation = world?.domain === 'world' && world.value.proactivePending;
    if (!reservation || reservation.originBranchId !== input.scope.branchId || reservation.operationId !== plan.replyOperationId || reservation.npcId !== plan.npcId || reservation.contactId !== plan.contactId || reservation.channelId !== plan.channelId || !sameData(reservation.moment, plan.reservedMoment)
      || world?.domain !== 'world' || world.value.proactiveLastTurn !== plan.previousTurn || npc?.domain !== 'npc' || npc.value.archived || npc.value.affinity < 100
      || contact?.domain !== 'courier' || contact.value.kind !== 'contact' || !contact.value.available || contact.value.npcId !== plan.npcId
      || channel?.domain !== 'courier' || channel.value.kind !== 'conversation' || channel.value.dissolved || channel.value.conversationType !== 'private' || channel.value.memberIds.length !== 1 || channel.value.memberIds[0] !== plan.npcId) throw Error('CORE2_PROACTIVE_INELIGIBLE');
    return { snapshot, npc };
  };
  return runCoreJob(input, { repo: deps.repo, getActiveSession: deps.getActiveSession, handlers: { courier: { fingerprint: job.configFingerprint,
    steps: [{ stepId: 'proactive-contact-v1', run: async ({ signal }) => {
      const prior = await deps.repo.readOperation(input.scope, plan.replyOperationId);
      if (prior?.status === 'committed') return [];
      const saved = await deps.repo.readSource(plan.outputSourceRef);
      if (saved) {
        if (!sameScope(saved.scope, input.scope) || saved.operationId !== plan.replyOperationId || saved.kind !== 'courier' || saved.blocks.length !== 1 || saved.blocks[0]!.speakerId !== plan.npcId) throw Error('CORE2_PROACTIVE_SOURCE_MISMATCH');
        await current(signal, false); return [];
      }
      let context: ConsumerContextBundle | undefined, npcName = '';
      for (let attempt = 0; attempt < 3; attempt++) {
        const live = await current(signal, true); npcName = live.npc.value.姓名;
        try { context = await buildCoreConsumerContext({ snapshot: live.snapshot, target: 'private', npcIds: [plan.npcId], conversationId: plan.channelId,
          userInput: '请以角色自己的口吻主动联系旅行者，结合当前世界时刻和自己确实知道的共同经历自然问候或延续话题。不要编造约定或引用后台指令；这不是玩家刚发送的一条消息。', signal }, { repo: deps.repo, contentCatalog: deps.contentCatalog }); break; }
        catch (error) { if (attempt === 2 || !(error instanceof Error) || !/CORE2_(?:RECALL_POSITION_CHANGED|INDEX_POSITION_MISMATCH)|CORE2_INDEX_UNAVAILABLE: head_advanced/u.test(error.message)) throw error; }
      }
      if (!context) throw Error('CORE2_PROACTIVE_CONTEXT_UNAVAILABLE');
      await current(signal, true); const generated = await deps.generate({ context, npcName, target: 'private', signal }); await current(signal, true);
      if (!generated.text.trim()) throw Error('CORE2_PROACTIVE_EMPTY');
      await deps.repo.putSource({ ...freezeSource({ scope: input.scope, operationId: plan.replyOperationId, kind: 'courier', moment: plan.reservedMoment, blocks: [{ blockId: 'proactive', kind: 'message', speakerId: plan.npcId, text: generated.text }], delivery: consumerDelivery(context.bundle, 'private', plan.npcId) }), ref: plan.outputSourceRef });
      return [];
    } }], finalize: async ({ signal, job: owned }) => {
      const prior = await deps.repo.readOperation(input.scope, plan.replyOperationId); if (prior?.status === 'committed') return;
      await current(signal, false);
      const source = await deps.repo.readSource(plan.outputSourceRef); if (!source) throw Error('CORE2_PROACTIVE_SOURCE_MISSING');
      const receipt = await commitCoreInteraction({ scope: input.scope, sessionId: input.sessionId, source, target: 'private', channelId: plan.channelId, recipientIds: [plan.npcId], proactive, signal }, {
        ...deps, summarySettings: plan.summarySettings, jobGuard: { jobId: owned.jobId, leaseId: owned.leaseId!, expectedVersion: owned.version, sourceRefs: owned.sourceRefs }, factModel: async () => ({ kind: 'extracted', candidates: [], attempts: 0 }),
      });
      if (!['committed', 'already_committed'].includes(receipt.status)) throw Error(`CORE2_PROACTIVE_NOT_COMMITTED: ${receipt.status}`);
    },
  } } });
}
