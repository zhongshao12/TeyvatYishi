import type { CoreJobRunInput, JobRunResult } from './jobRunner';
import { readCoreJob, runCoreJob } from './jobRunner';
import { readCoreMomentPlan } from './momentPlan';
import type { CorePhoneJobDependencies } from './phoneJob';
import { coreMomentAudience } from '../settlement/momentRules';
import { coreMomentText, readCoreMomentOrigin } from '../settlement/momentSources';
import { buildCoreConsumerContext, type ConsumerContextBundle } from '../retrieval/consumerContext';
import { freezeSource } from '../sources/sourceRecords';
import { consumerDelivery } from '../sources/consumerDelivery';
import { sameScope, sameData } from '../persistence/repositoryValidation';
import { commitCoreInteraction } from '../settlement/consumerOperations';

/** Per-member work: a failed commenter never discards another member's result. */
export async function runCoreMomentJob(input: CoreJobRunInput, deps: CorePhoneJobDependencies): Promise<JobRunResult> {
  const job = await readCoreJob(deps.repo, input.scope, input.jobId);
  if (!job) return { kind: 'failed', jobId: input.jobId, detail: '找不到评论任务。' };
  const plan = readCoreMomentPlan(job);
  if (job.status === 'completed') return { kind: 'completed', jobId: job.jobId };
  const descriptor = { target: 'moment' as const, channelId: plan.channelId, momentSourceRef: plan.postSourceRef, momentVersion: plan.postVersion };
  const current = async (signal: AbortSignal, requireModel: boolean) => {
    const snapshot = await deps.repo.readState(input.scope), active = deps.getActiveSession?.(), saved = await readCoreJob(deps.repo, input.scope, input.jobId);
    if (signal.aborted || snapshot.head.sessionId !== input.sessionId || deps.getActiveSession && (!active || !sameScope(active.scope, input.scope) || active.sessionId !== input.sessionId)) throw Error('CORE2_MOMENT_SESSION_CHANGED');
    if (!saved || saved.status === 'cancelled') throw Error('CORE2_MOMENT_CANCELLED');
    if (requireModel && plan.modelIdentity !== deps.getModelIdentity()) throw Error('评论模型配置已改变，未混用旧计划或发布迟到结果。');
    const origin = await readCoreMomentOrigin(deps.repo, snapshot, descriptor), post = snapshot.records.find(row => row.domain === 'courier' && row.entityId === plan.channelId);
    if (!origin || post?.domain !== 'courier' || post.value.kind !== 'moment' || !post.value.commentNpcIds?.includes(plan.npcId) || !post.value.visibilityNpcIds.includes(plan.npcId) || !coreMomentAudience(snapshot).includes(plan.npcId)) throw Error('CORE2_MOMENT_COMMENT_UNAVAILABLE');
    return { snapshot, origin, post };
  };
  return runCoreJob(input, { repo: deps.repo, getActiveSession: deps.getActiveSession, handlers: { courier: { fingerprint: job.configFingerprint,
    steps: [{ stepId: 'moment-comment-v1', run: async ({ signal }) => {
      const prior = await deps.repo.readOperation(input.scope, plan.replyOperationId);
      if (prior?.status === 'committed') return [];
      const previous = await deps.repo.readSource(plan.outputSourceRef);
      if (previous) {
        if (!sameScope(previous.scope, plan.scope) || previous.operationId !== plan.replyOperationId || previous.kind !== 'moment' || previous.blocks.length !== 1 || previous.blocks[0]!.speakerId !== plan.npcId) throw Error('CORE2_MOMENT_STAGED_SOURCE_MISMATCH');
        await current(signal, false); return [];
      }
      let context: ConsumerContextBundle | undefined, name = '', origin;
      for (let attempt = 0; attempt < 3; attempt++) {
        const live = await current(signal, true), npc = live.snapshot.records.find(row => row.domain === 'npc' && row.entityId === plan.npcId);
        if (npc?.domain !== 'npc') throw Error('CORE2_MOMENT_NPC_MISSING');
        name = npc.value.姓名; origin = live.origin;
        const text = coreMomentText(origin, plan.channelId);
        try { context = await buildCoreConsumerContext({ snapshot: live.snapshot, target: 'moment', npcIds: [plan.npcId], conversationId: plan.channelId,
          userInput: text || '玩家发布了图片。文字模型未见画面，不得猜测图片内容。', signal }, { repo: deps.repo, contentCatalog: deps.contentCatalog }); break; }
        catch (error) { if (attempt === 2 || !(error instanceof Error) || !/CORE2_(?:RECALL_POSITION_CHANGED|INDEX_POSITION_MISMATCH)|CORE2_INDEX_UNAVAILABLE: head_advanced/u.test(error.message)) throw error; }
      }
      if (!context || !origin) throw Error('CORE2_MOMENT_CONTEXT_UNAVAILABLE');
      await current(signal, true);
      const generated = await deps.generate({ context, npcName: name, target: 'moment', signal });
      await current(signal, true);
      if (!generated.text.trim()) throw Error('CORE2_MOMENT_COMMENT_EMPTY');
      await deps.repo.putSource({ ...freezeSource({ scope: input.scope, operationId: plan.replyOperationId, kind: 'moment', moment: origin.moment,
        blocks: [{ blockId: 'comment', kind: 'message', speakerId: plan.npcId, text: generated.text }], delivery: consumerDelivery(context.bundle, 'moment', plan.npcId) }), ref: plan.outputSourceRef });
      return [];
    } }], finalize: async ({ signal, job: owned }) => {
      const source = await deps.repo.readSource(plan.outputSourceRef); if (!source) throw Error('CORE2_MOMENT_COMMENT_SOURCE_MISSING');
      // A committed result takes precedence over a later edit/configuration change.
      const prior = await deps.repo.readOperation(input.scope, plan.replyOperationId);
      if (prior?.receipt && ['committed', 'already_committed'].includes(prior.receipt.status)) return;
      const live = await current(signal, false);
      if (!sameData(source.moment, { ...live.origin.moment, settlementId: plan.replyOperationId })) throw Error('CORE2_MOMENT_STAGED_SOURCE_MISMATCH');
      if (live.post.value.kind !== 'moment') throw Error('CORE2_MOMENT_NOT_FOUND');
      const available = new Set(coreMomentAudience(live.snapshot));
      const receipt = await commitCoreInteraction({ ...descriptor, scope: input.scope, sessionId: input.sessionId, source, recipientIds: live.post.value.visibilityNpcIds.filter(id => available.has(id)), signal },
        { ...deps, summarySettings: plan.summarySettings, jobGuard: { jobId: owned.jobId, leaseId: owned.leaseId!, expectedVersion: owned.version, sourceRefs: owned.sourceRefs }, factModel: async () => ({ kind: 'extracted', candidates: [], attempts: 0 }) });
      if (!['committed', 'already_committed'].includes(receipt.status)) throw Error(`CORE2_MOMENT_COMMENT_NOT_COMMITTED: ${receipt.status}`);
    },
  } } });
}
