import type { CoreScope } from '../contracts/identity';
import type { CoreRepository } from '../contracts/storage';
import type { CommitReceipt } from '../contracts/operation';
import type { BasicPlayerCommand, PlayerCommand } from './actions';
import type { SettlementDependencies } from './settleOperation';
import { settleCoreOperation } from './settleOperation';
import { freezeSource } from '../sources/sourceRecords';
import { checksumUtf8 } from '../sources/sourceIntegrity';
import { sameScope } from '../persistence/repositoryValidation';
import { buildCoreActions, coreCandidateReviewId } from './actions';

interface ManualIdentity { scope: CoreScope; sessionId: string; operationId: string }
type Dependencies = Omit<SettlementDependencies, 'repo'>;
export interface CandidateReviewAction extends ManualIdentity { originOperationId: string; candidateId: string; sourceVersion: number; decision: 'accept' | 'reject' }
export interface ManualProfileAction extends ManualIdentity { command: Extract<BasicPlayerCommand, { type: 'edit_npc' | 'edit_traveler' }> }
export interface EventCorrectionAction extends ManualIdentity { originalEventId: string; reason: string; command: BasicPlayerCommand }

async function manual(repo: CoreRepository, input: ManualIdentity, command: PlayerCommand, deps: Dependencies, actionId = input.operationId): Promise<CommitReceipt> {
  input = { ...input, scope: structuredClone(input.scope) }; command = structuredClone(command);
  const snapshot = await repo.readState(input.scope);
  if (snapshot.head.sessionId !== input.sessionId) throw Error('CORE2_SESSION_CHANGED');
  const moment = snapshot.records.find(row => row.domain === 'world')?.value.moment;
  if (!moment) throw Error('CORE2_WORLD_MISSING');
  const previous = await repo.readOperation(input.scope, input.operationId);
  const saved = previous?.sourceRefs.length === 1 ? await repo.readSource(previous.sourceRefs[0]!) : null;
  if (previous && (!saved || saved.kind !== 'manual' || !sameScope(saved.scope, input.scope) || saved.blocks.length !== 1 || saved.blocks[0]?.text !== JSON.stringify(command))) throw Error('CORE2_OPERATION_SOURCE_MISMATCH');
  const source = saved ?? freezeSource({ scope: input.scope, operationId: input.operationId, kind: 'manual', moment, blocks: [{ blockId: 'command', kind: 'configuration', text: JSON.stringify(command) }] });
  return settleCoreOperation({ ...input, kind: 'manual', sources: [source], playerActions: [{ kind: 'player', actionId, source, command }] }, { ...deps, repo });
}
export async function reviewPendingCandidate(repo: CoreRepository, input: CandidateReviewAction, deps: Dependencies): Promise<CommitReceipt> {
  const head = await repo.readHead(input.scope);
  if (head.sessionId !== input.sessionId || !['accept', 'reject'].includes(input.decision)) throw Error('CORE2_REVIEW_AUTHORITY');
  const id = coreCandidateReviewId(input.scope, input.originOperationId, input.candidateId);
  const prior = (await repo.queryEvents({ scope: input.scope, cutoffSeq: head.coreSeq, eventIds: [`event:${id}`] })).items[0];
  if (prior) { const operation = await repo.readOperation(input.scope, prior.operationId); if (operation?.receipt) return { ...operation.receipt, status: 'already_committed' }; }
  const origin = await repo.readOperation(input.scope, input.originOperationId);
  const candidate = origin?.stage?.candidates.find(row => row.candidateId === input.candidateId);
  if (origin?.status !== 'committed' || !candidate || !['pending', 'disputed'].includes(candidate.status) || !sameScope(candidate.scope, input.scope)) throw Error('CORE2_CANDIDATE_NOT_PENDING');
  const snapshot = await repo.readState(input.scope), candidates = origin.stage!.candidates.filter(row => ['pending', 'disputed'].includes(row.status));
  const group = buildCoreActions({ verified: [], pending: candidates, disputed: [], rejected: [] }, snapshot).groups.find(row => row.actions.some(action => action.kind === 'narrative' && action.candidate.candidateId === candidate.candidateId));
  const groupCandidates = group?.actions.flatMap(action => action.kind === 'narrative' ? [action.candidate] : []) ?? [candidate];
  for (const member of groupCandidates) {
    if ((await repo.queryEvents({ scope: input.scope, cutoffSeq: head.coreSeq, eventIds: [`event:${coreCandidateReviewId(input.scope, input.originOperationId, member.candidateId)}`] })).items.length) throw Error('同组已有决定，请刷新核对列表。');
    for (const ref of member.evidenceRefs) {
    if (ref.ref.sourceVersion !== input.sourceVersion) throw Error('CORE2_REVIEW_SOURCE_VERSION_CHANGED');
    const source = await repo.readSource(ref.ref), next = await repo.readSource({ ...ref.ref, sourceVersion: ref.ref.sourceVersion + 1 });
    if (!source || next) throw Error('CORE2_REVIEW_SOURCE_VERSION_CHANGED');
    }
  }
  return manual(repo, input, { type: 'review_fact', candidate, ...(groupCandidates.length > 1 ? { groupCandidates } : {}), decision: input.decision, originOperationId: input.originOperationId }, deps, id);
}
export function editCoreProfile(repo: CoreRepository, input: ManualProfileAction, deps: Dependencies): Promise<CommitReceipt> {
  return manual(repo, input, input.command, deps);
}
export function executeCorePlayerCommand(repo: CoreRepository, input: ManualIdentity & { command: BasicPlayerCommand }, deps: Dependencies): Promise<CommitReceipt> {
  return manual(repo, input, input.command, deps);
}
export async function correctCoreEvent(repo: CoreRepository, input: EventCorrectionAction, deps: Dependencies): Promise<CommitReceipt> {
  if (!input.reason.trim()) throw Error('请填写更正原因。');
  const head = await repo.readHead(input.scope);
  if (!(await repo.queryEvents({ scope: input.scope, cutoffSeq: head.coreSeq, eventIds: [input.originalEventId] })).items.length) throw Error('CORE2_CORRECTION_EVENT_UNREACHABLE');
  return manual(repo, input, { type: 'correct_event', originalEventId: input.originalEventId, reason: input.reason, command: input.command }, deps);
}
