import type { CoreRepository } from '../contracts/storage';
import type { CoreScope } from '../contracts/identity';
import { freezeSource } from '../sources/sourceRecords';
import { commitHostPublication } from './commitHostPublication';
import { buildCoreProfileJob } from '../jobs/profilePlan';
import { sameData, stableJson } from '../persistence/repositoryValidation';
export async function requestCoreProfile(input: { scope: CoreScope; sessionId: string; npcId: string; operationId: string }, deps: { repo: CoreRepository; getActiveSession(): { scope: CoreScope; sessionId: string } | null }) {
  const snapshot = await deps.repo.readState(input.scope), npc = snapshot.records.find(row => row.domain === 'npc' && row.entityId === input.npcId), world = snapshot.records.find(row => row.domain === 'world');
  if (snapshot.head.sessionId !== input.sessionId || !sameData(deps.getActiveSession(), { scope: input.scope, sessionId: input.sessionId }) || npc?.domain !== 'npc' || npc.value.archived || world?.domain !== 'world') throw Error('CORE2_PROFILE_REQUEST_INVALID');
  const source = freezeSource({ scope: input.scope, operationId: input.operationId, kind: 'manual', moment: world.value.moment, blocks: [{ blockId: 'profile-request', kind: 'configuration', text: stableJson({ action: 'complete_public_profile', npcId: input.npcId }) }] });
  const job = buildCoreProfileJob({ ...input, sourceRefs: [source.ref] });
  return commitHostPublication(deps.repo, source, { sessionId: input.sessionId, readSet: [{ domain: 'npc', entityId: npc.entityId, version: npc.version }], changes: [], events: [], jobs: [job] });
}
