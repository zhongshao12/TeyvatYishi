import type { ConsumerContextBundle } from '../retrieval/consumerContext';
import { buildCoreConsumerContext } from '../retrieval/consumerContext';
import { runCoreJob, readCoreJob, type CoreJobRunInput, type JobRunResult } from './jobRunner';
import { readCorePhonePlan } from './phonePlan';
import { freezeSource } from '../sources/sourceRecords';
import { consumerDelivery } from '../sources/consumerDelivery';
import { sameScope, sameData } from '../persistence/repositoryValidation';
import { commitCoreInteraction } from '../settlement/consumerOperations';
import type { SettlementDependencies } from '../settlement/settleOperation';

export interface CorePhoneGenerationInput { context: ConsumerContextBundle; npcName: string; target: 'private' | 'group' | 'moment'; signal: AbortSignal }
export interface CorePhoneJobDependencies extends SettlementDependencies {
  generate(input: CorePhoneGenerationInput): Promise<{ text: string }>;
  getModelIdentity(): string;
}
export async function runCorePhoneJob(input: CoreJobRunInput, deps: CorePhoneJobDependencies): Promise<JobRunResult> {
  const job = await readCoreJob(deps.repo, input.scope, input.jobId);
  if (!job) return { kind: 'failed', jobId: input.jobId, detail: '找不到回信任务。' };
  const plan = readCorePhonePlan(job);
  if (job.status === 'completed') return { kind: 'completed', jobId: job.jobId };
  const staged = await deps.repo.readSource(plan.outputSourceRef);
  if (plan.modelIdentity !== deps.getModelIdentity() && !staged) return { kind: 'conflict', jobId: job.jobId, detail: '手机模型配置已改变；未混用不同配置的步骤，也未再次调用模型。' };
  const current = async (signal: AbortSignal) => {
    const head = await deps.repo.readHead(input.scope), active = deps.getActiveSession?.(), liveJob = await readCoreJob(deps.repo, input.scope, input.jobId);
    if (signal.aborted || head.sessionId !== input.sessionId || deps.getActiveSession && (!active || !sameScope(active.scope, input.scope) || active.sessionId !== input.sessionId)) throw Error('CORE2_PHONE_REPLY_SESSION_CHANGED');
    if (!liveJob || liveJob.status === 'cancelled') throw Error('CORE2_PHONE_REPLY_CANCELLED');
    if (plan.modelIdentity !== deps.getModelIdentity()) throw Error('手机模型配置已改变，迟到回信未保存或投递。');
  };
  return runCoreJob(input, { repo: deps.repo, getActiveSession: deps.getActiveSession, handlers: { courier: { fingerprint: job.configFingerprint,
    steps: [{ stepId: 'phone-reply-v1', run: async ({ signal }) => {
      const prior = await deps.repo.readOperation(input.scope, plan.replyOperationId);
      if (prior?.status === 'committed') return [];
      const previous = await deps.repo.readSource(plan.outputSourceRef);
      if (previous) {
        if (!sameScope(previous.scope, plan.scope) || previous.operationId !== plan.replyOperationId || previous.kind !== 'courier' || previous.blocks.length !== 1 || previous.blocks[0]!.speakerId !== plan.npcId) throw Error('CORE2_PHONE_STAGED_SOURCE_MISMATCH');
        return [];
      }
      const snapshot = await deps.repo.readState(input.scope);
      const player = snapshot.records.find(row => row.domain === 'traveler'), npc = snapshot.records.find(row => row.domain === 'npc' && row.entityId === plan.npcId);
      const anchor = (await deps.repo.queryEvents({ scope: input.scope, cutoffSeq: snapshot.head.coreSeq, eventIds: [plan.playerEventId], limit: 1 })).items[0];
      const operation = await deps.repo.readOperation(input.scope, plan.playerOperationId);
      const channel = snapshot.records.find(row => row.domain === 'courier' && row.entityId === plan.channelId);
      if (!player || npc?.domain !== 'npc' || !anchor || anchor.operationId !== plan.playerOperationId || anchor.type !== `communication.${plan.target}` || anchor.channelId !== plan.channelId || anchor.actorIds.length !== 1 || anchor.actorIds[0] !== player.entityId
        || !anchor.targetIds.includes(plan.npcId) || !operation || !sameData(operation.sourceRefs, job.sourceRefs) || channel?.domain !== 'courier' || channel.value.kind !== 'conversation' || channel.value.dissolved || !channel.value.memberIds.includes(plan.npcId)) throw Error('CORE2_REPLY_ANCHOR');
      let context: ConsumerContextBundle | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        const position = attempt ? await deps.repo.readState(input.scope) : snapshot;
        await current(signal);
        try { context = await buildCoreConsumerContext({ snapshot: position, target: plan.target, npcIds: [plan.npcId], userInput: anchor.evidenceRefs.map(ref => ref.quote).join('\n'), conversationId: plan.channelId, signal }, { repo: deps.repo, contentCatalog: deps.contentCatalog }); break; }
        catch (error) {
          // An independent summary may advance only the derived view while we
          // collect recall. Re-read the view BEFORE any provider call, bounded.
          if (attempt === 2 || !(error instanceof Error) || !/CORE2_(?:RECALL_POSITION_CHANGED|INDEX_POSITION_MISMATCH)|CORE2_INDEX_UNAVAILABLE: head_advanced/u.test(error.message)) throw error;
        }
      }
      if (!context) throw Error('CORE2_PHONE_CONTEXT_UNAVAILABLE');
      await current(signal);
      const generated = await deps.generate({ context, npcName: npc.value.姓名, target: plan.target, signal });
      await current(signal);
      if (!generated.text.trim()) throw Error('CORE2_PHONE_REPLY_EMPTY');
      const source = { ...freezeSource({ scope: input.scope, operationId: plan.replyOperationId, kind: 'courier', moment: anchor.occurredMoment, blocks: [{ blockId: 'reply', kind: 'message', speakerId: plan.npcId, text: generated.text }], delivery: consumerDelivery(context.bundle, plan.target, plan.npcId) }), ref: plan.outputSourceRef };
      // Persist the returned body BEFORE the step acknowledgement. An uncertain
      // step write can then recover it without paying for a second generation.
      await deps.repo.putSource(source); return [];
    } }],
    finalize: async ({ signal, job: owned }) => {
      const prior = await deps.repo.readOperation(input.scope, plan.replyOperationId);
      if (prior?.status === 'committed') return;
      const source = await deps.repo.readSource(plan.outputSourceRef); if (!source) throw Error('CORE2_PHONE_REPLY_SOURCE_MISSING');
      const snapshot = await deps.repo.readState(input.scope), channel = snapshot.records.find(row => row.domain === 'courier' && row.entityId === plan.channelId);
      if (channel?.domain !== 'courier' || channel.value.kind !== 'conversation') throw Error('CORE2_INTERACTION_CHANNEL');
      const result = await commitCoreInteraction({ scope: input.scope, sessionId: input.sessionId, source, target: plan.target, channelId: plan.channelId, recipientIds: channel.value.memberIds, replyToEventId: plan.playerEventId, signal }, { ...deps, summarySettings: plan.summarySettings,
        jobGuard: { jobId: owned.jobId, leaseId: owned.leaseId!, expectedVersion: owned.version, sourceRefs: owned.sourceRefs } });
      if (result.status !== 'committed' && result.status !== 'already_committed') throw Error(`CORE2_PHONE_REPLY_NOT_COMMITTED: ${result.status}`);
    },
  } } });
}
