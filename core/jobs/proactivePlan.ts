import type { CoreScope, SourceRef, RecordRef } from '../contracts/identity';
import type { JobRecord, MemorySettings } from '../contracts/memory';
import type { CoreSnapshot, StateRecord } from '../contracts/state';
import type { EventDraft } from '../contracts/event';
import type { WorldMoment } from '@/models/teyvat/worldMoment';
import { isCoreJsonData, validateCoreDto } from '../contracts/validation';
import { sameScope, stableJson, compareCoreIds } from '../persistence/repositoryValidation';
import { freezeCoreSummarySettings } from './summaryPlan';
import { planCoreProactiveContact } from '../settlement/proactiveContact';

export const CORE_PROACTIVE_PLAN_PREFIX = 'core2-proactive-plan-v1:';
export interface CoreProactiveJobPlan {
  version: 1; scope: CoreScope; npcId: string; contactId: string; channelId: string; atTurn: number; previousTurn: number;
  replyOperationId: string; outputSourceRef: SourceRef; anchorOperationId: string; reservedMoment: WorldMoment; modelIdentity: string; summarySettings: MemorySettings;
}
function ownPlan(plan: CoreProactiveJobPlan): CoreProactiveJobPlan {
  if (!isCoreJsonData(plan) || !plan || Object.keys(plan).length !== 13 || !Object.keys(plan).every(key => ['version', 'scope', 'npcId', 'contactId', 'channelId', 'atTurn', 'previousTurn', 'replyOperationId', 'outputSourceRef', 'anchorOperationId', 'reservedMoment', 'modelIdentity', 'summarySettings'].includes(key))
    || plan.version !== 1 || !validateCoreDto('scope', plan.scope).ok || !validateCoreDto('sourceRef', plan.outputSourceRef).ok || !validateCoreDto('worldMoment', plan.reservedMoment).ok
    || ![plan.npcId, plan.contactId, plan.channelId, plan.replyOperationId, plan.anchorOperationId].every(id => validateCoreDto('sourceRef', { sourceId: id, sourceVersion: 1 }).ok)
    || !Number.isSafeInteger(plan.atTurn) || !Number.isSafeInteger(plan.previousTurn) || plan.previousTurn < 0 || plan.atTurn - plan.previousTurn < 15 || plan.reservedMoment.turn !== plan.atTurn
    || typeof plan.modelIdentity !== 'string' || !plan.modelIdentity.trim() || plan.modelIdentity.length > 2000) throw Error('CORE2_PROACTIVE_PLAN_INVALID');
  return { ...structuredClone(plan), summarySettings: freezeCoreSummarySettings(plan.summarySettings) };
}
export function serializeCoreProactivePlan(plan: CoreProactiveJobPlan): string { return CORE_PROACTIVE_PLAN_PREFIX + stableJson(ownPlan(plan)); }
export function readCoreProactivePlan(job: JobRecord): CoreProactiveJobPlan {
  if (job.kind !== 'courier' || !job.configFingerprint.startsWith(CORE_PROACTIVE_PLAN_PREFIX)) throw Error('CORE2_PROACTIVE_PLAN_UNSUPPORTED');
  const plan = ownPlan(JSON.parse(job.configFingerprint.slice(CORE_PROACTIVE_PLAN_PREFIX.length)));
  if (!sameScope(job.scope, plan.scope) || job.operationId !== plan.anchorOperationId) throw Error('CORE2_PROACTIVE_PLAN_BINDING');
  return plan;
}
/** Add reservation, optional private channel, and durable task to the MAIN commit. No provider call here. */
export function reserveCoreProactiveTask(snapshot: CoreSnapshot, completion: EventDraft, sourceRefs: SourceRef[], sessionId: string, settings: MemorySettings, modelIdentity: string): { jobs: JobRecord[]; readSet: RecordRef[] } {
  const world = completion.committedChanges.find(change => change.after?.domain === 'world')?.after;
  if (world?.domain !== 'world') throw Error('CORE2_WORLD_MISSING');
  if (modelIdentity === 'disabled') {
    delete world.value.proactivePending;
    return { jobs: [], readSet: [] };
  }
  const projected = { ...snapshot, records: snapshot.records.map(row => row.domain === 'world' ? world : row) };
  const readSet = snapshot.records.filter(row => row.domain === 'npc' || row.domain === 'courier').map(row => ({ domain: row.domain, entityId: row.entityId, version: row.version }));
  if (world.value.proactivePending) {
    const pending = world.value.proactivePending;
    const contact = snapshot.records.find(row => row.domain === 'courier' && row.entityId === pending.contactId), npc = snapshot.records.find(row => row.domain === 'npc' && row.entityId === pending.npcId);
    if (pending.originBranchId === snapshot.head.scope.branchId && contact?.domain === 'courier' && contact.value.kind === 'contact' && contact.value.available && npc?.domain === 'npc' && !npc.value.archived && npc.value.affinity >= 100) return { jobs: [], readSet };
    // Lost contact/eligibility releases the reservation on a real main turn; an old task cannot publish into the new reservation.
    delete world.value.proactivePending;
  }
  const planned = planCoreProactiveContact(projected); if (!planned) return { jobs: [], readSet };
  const existing = snapshot.records.filter(row => row.domain === 'courier' && row.value.kind === 'conversation' && !row.value.dissolved && row.value.conversationType === 'private' && row.value.memberIds.length === 1 && row.value.memberIds[0] === planned.npcId).sort((a, b) => compareCoreIds(a.entityId, b.entityId))[0];
  const key = planned.operationId.slice('proactive-'.length), channelId = existing?.entityId ?? `proactive-chat-${key}`, jobId = `proactive-job-${key}`;
  if (!existing) {
    const npc = snapshot.records.find(row => row.domain === 'npc' && row.entityId === planned.npcId);
    const after: StateRecord<'courier'> = { scope: snapshot.head.scope, domain: 'courier', entityId: channelId, version: 1, value: { kind: 'conversation', name: npc?.domain === 'npc' ? npc.value.姓名 : '联系人', memberIds: [planned.npcId], conversationType: 'private', unreadCount: 0, lastReadSeq: 0, dissolved: false } };
    completion.committedChanges.push({ ref: { domain: 'courier', entityId: channelId, version: 0 }, before: null, after, effectKey: `effect-channel-${key}` });
  }
  world.value.proactivePending = { ...planned, originBranchId: snapshot.head.scope.branchId, jobId, channelId, moment: structuredClone(world.value.moment) };
  const plan: CoreProactiveJobPlan = { version: 1, scope: snapshot.head.scope, npcId: planned.npcId, contactId: planned.contactId, channelId, atTurn: planned.atTurn, previousTurn: planned.previousTurn,
    replyOperationId: planned.operationId, outputSourceRef: { sourceId: `proactive-output-${key}`, sourceVersion: 1 }, anchorOperationId: completion.operationId, reservedMoment: world.value.moment, modelIdentity, summarySettings: settings };
  return { readSet, jobs: [{ jobId, scope: snapshot.head.scope, sessionId, kind: 'courier', operationId: completion.operationId, sourceRefs, status: 'pending', leaseId: null, configFingerprint: serializeCoreProactivePlan(plan), attempts: 0, steps: [], version: 1 }] };
}
