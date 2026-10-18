import type { CoreRepository } from '../contracts/storage';
import type { CoreScope } from '../contracts/identity';
import type { NpcState } from '../contracts/state';
import type { CoreProfileCatalog, CoreProfileData } from '../content/profileCatalog';
import { PUBLIC_PROFILE_FIELDS } from '../content/profileCatalog';
import { readCoreProfilePlan } from './profilePlan';
import { readCoreJob, runCoreJob, type CoreJobRunInput } from './jobRunner';
import { isCoreJsonData } from '../contracts/validation';
import { freezeSource } from '../sources/sourceRecords';
import { sameData, stableJson } from '../persistence/repositoryValidation';
import { commitHostPublication, hostPublicationEvent } from '../settlement/commitHostPublication';

export interface CoreProfileDependencies { repo: CoreRepository; catalog: CoreProfileCatalog; getActiveSession(): { scope: CoreScope; sessionId: string } | null }
function ownProfileData(value: CoreProfileData): CoreProfileData {
  if (!isCoreJsonData(value) || !value || Object.keys(value).length !== 3 || !Object.keys(value).every(key => ['version', 'fields', 'appearanceFacts'].includes(key)) || typeof value.version !== 'string' || !value.version.trim() || value.version.length > 200
    || !value.fields || Array.isArray(value.fields) || !Object.entries(value.fields).every(([key, text]) => (PUBLIC_PROFILE_FIELDS as readonly string[]).includes(key) && typeof text === 'string' && !!text.trim() && text.length <= 20000)
    || !value.appearanceFacts || Array.isArray(value.appearanceFacts) || !Object.entries(value.appearanceFacts).every(([key, fact]) => ['发色', '瞳色', '身高', '体重'].includes(key) && fact && Object.keys(fact).length === 2 && fact.source === 'canon' && typeof fact.value === 'string' && !!fact.value.trim() && fact.value.length <= 1000)) throw Error('CORE2_PROFILE_OUTPUT_INVALID');
  return structuredClone(value);
}
export async function runCoreProfileJob(input: CoreJobRunInput, deps: CoreProfileDependencies) {
  const job = await readCoreJob(deps.repo, input.scope, input.jobId); if (!job) throw Error('CORE2_PROFILE_JOB_MISSING'); const plan = readCoreProfilePlan(job);
  const current = async (signal: AbortSignal) => {
    const snapshot = await deps.repo.readState(input.scope), saved = await readCoreJob(deps.repo, input.scope, input.jobId);
    if (signal.aborted || snapshot.head.sessionId !== input.sessionId || !sameData(deps.getActiveSession(), { scope: input.scope, sessionId: input.sessionId }) || !saved || saved.status === 'cancelled') throw Error('CORE2_PROFILE_SESSION_CHANGED');
    const npc = snapshot.records.find(row => row.domain === 'npc' && row.entityId === plan.npcId); if (npc?.domain !== 'npc' || npc.value.archived) throw Error('CORE2_PROFILE_NPC_UNAVAILABLE');
    return { snapshot, npc };
  };
  return runCoreJob(input, { repo: deps.repo, getActiveSession: deps.getActiveSession, handlers: { profile: { fingerprint: job.configFingerprint, steps: [{ stepId: 'public-profile-v1', run: async ({ signal }) => {
    if ((await deps.repo.readOperation(input.scope, plan.publicationOperationId))?.status === 'committed' || await deps.repo.readSource(plan.outputSourceRef)) return [];
    const { snapshot, npc } = await current(signal), data = ownProfileData(await deps.catalog.read({ 姓名: npc.value.姓名, aliases: [...npc.value.aliases], canonical: npc.value.canonical }, signal)); await current(signal);
    const world = snapshot.records.find(row => row.domain === 'world'); if (world?.domain !== 'world') throw Error('CORE2_WORLD_MISSING');
    await deps.repo.putSource({ ...freezeSource({ scope: input.scope, operationId: plan.publicationOperationId, kind: 'content', moment: world.value.moment, blocks: [{ blockId: 'public-profile', kind: 'content', text: stableJson({ npcId: plan.npcId, name: npc.value.姓名, data }) }] }), ref: plan.outputSourceRef }); return [];
  } }], finalize: async ({ signal, job: owned }) => {
    if ((await deps.repo.readOperation(input.scope, plan.publicationOperationId))?.status === 'committed') return;
    const source = await deps.repo.readSource(plan.outputSourceRef); if (!source || source.kind !== 'content' || !sameData(source.scope, input.scope) || source.operationId !== plan.publicationOperationId || source.blocks.length !== 1 || source.blocks[0]!.kind !== 'content') throw Error('CORE2_PROFILE_SOURCE_INVALID');
    const payload = JSON.parse(source.blocks[0]!.text) as { npcId: string; name: string; data: CoreProfileData };
    if (Object.keys(payload).length !== 3 || payload.npcId !== plan.npcId) throw Error('CORE2_PROFILE_OUTPUT_INVALID'); const data = ownProfileData(payload.data);
    const { npc } = await current(signal); if (npc.value.姓名 !== payload.name) throw Error('CORE2_PROFILE_IDENTITY_CHANGED');
    const after = structuredClone(npc), blocked = new Set(npc.value.playerCorrections);
    if (!npc.value.visualArchive.englishFacts) {
      for (const [field, value] of Object.entries(data.fields) as [keyof CoreProfileData['fields'], string][]) if (!npc.value[field].trim() && !blocked.has(`core2-manual:${field}`)) after.value[field] = value;
      for (const [field, fact] of Object.entries(data.appearanceFacts) as [keyof NonNullable<NpcState['appearanceFacts']>, NonNullable<NonNullable<NpcState['appearanceFacts']>[keyof NonNullable<NpcState['appearanceFacts']>]>][]) if (!npc.value.appearanceFacts?.[field]) { after.value.appearanceFacts ??= {}; after.value.appearanceFacts[field] = fact; }
    }
    const changed = !sameData(after.value, npc.value); after.version++;
    const ref = { domain: 'npc' as const, entityId: npc.entityId, version: npc.version }, changes = changed ? [{ ref, before: npc, after, effectKey: `effect-${plan.publicationOperationId}` }] : [];
    const receipt = await commitHostPublication(deps.repo, source, { sessionId: input.sessionId, readSet: [ref], changes, events: [hostPublicationEvent(source, 'publication.profile', changes)], jobs: [], jobGuard: { jobId: owned.jobId, leaseId: owned.leaseId!, expectedVersion: owned.version, sourceRefs: owned.sourceRefs } }, 'system');
    if (!['committed', 'already_committed'].includes(receipt.status)) throw Error(`CORE2_PROFILE_PUBLICATION_${receipt.status}`);
  } } } });
}
