import type { CoreRepository } from '../contracts/storage';
import type { SourceRecord, EventDraft } from '../contracts/event';
import type { PreparedCommit, OperationRecord } from '../contracts/operation';
import { sameData } from '../persistence/repositoryValidation';

/** Registered host output only: no extraction, arbitrary paths, or mutable UI mirror. */
export async function commitHostPublication(repo: CoreRepository, source: SourceRecord, input: Omit<PreparedCommit, 'scope' | 'operationId' | 'sourceRefs' | 'knowledge' | 'commitments'>, kind: 'manual' | 'system' = 'manual') {
  const prior = await repo.readOperation(source.scope, source.operationId);
  if (prior?.receipt && prior.status === 'committed') return { ...prior.receipt, status: 'already_committed' as const };
  const refs = [source.ref], effects = input.changes.map(change => change.effectKey);
  if (prior && !sameData(prior.sourceRefs, refs)) throw Error('CORE2_PUBLICATION_SOURCE_CHANGED');
  await repo.putSource(source);
  const draft: OperationRecord = { scope: source.scope, operationId: source.operationId, kind, sourceRefs: refs, status: 'draft', readSet: input.readSet, candidateRefs: [], effects: [], attempts: 0 };
  if (!prior) await repo.prepareOperation(draft);
  if (prior?.status !== 'prepared') {
    await repo.stageOperation({ scope: source.scope, sessionId: input.sessionId, operationId: source.operationId, sourceRefs: refs, candidates: [], review: [], stageVersion: (prior?.stage?.stageVersion ?? 0) + 1 });
    await repo.prepareOperation({ ...draft, status: 'prepared', readSet: input.readSet, effects });
  }
  return repo.commit({ ...input, scope: source.scope, operationId: source.operationId, sourceRefs: refs, knowledge: [], commitments: [] });
}
export function hostPublicationEvent(source: SourceRecord, type: string, changes: PreparedCommit['changes']): EventDraft {
  return { eventId: 'event-' + source.operationId, journeyId: source.scope.journeyId, branchId: source.scope.branchId, operationId: source.operationId, turn: source.moment.turn, type,
    actorIds: [], targetIds: changes.map(change => change.ref.entityId), evidenceRefs: source.blocks.map(block => ({ ref: source.ref, blockId: block.blockId, start: 0, end: block.text.length, quote: block.text })),
    occurredMoment: source.moment, ruleVersion: 'core2-publication-v1', committedChanges: changes, visibility: { kind: 'private', npcIds: [] }, recordedAt: source.createdAt };
}
