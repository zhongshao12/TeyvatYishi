import type { CommitReceipt, CoreCommitFailure, StateChange } from '../contracts/operation';
import type { GameEvent } from '../contracts/event';
import type { JobRecord } from '../contracts/memory';
import type { SourceRef } from '../contracts/identity';
import { sameScope, sourceRefKey } from '../persistence/repositoryValidation';
import { sanitizeApiErrorReportText } from '@/services/ai/apiErrorReportService';
import { coreJobAttemptsPending } from '../jobs/jobAttemptView';

export interface ReceiptViewModel { saved: boolean; memoryPending: boolean; status: CommitReceipt['status'] | 'failed'; changes: StateChange[]; sourceRefs: SourceRef[]; reason?: string; operationId?: string; jobIds?: string[] }
export function projectCoreReceipt(receipt: CommitReceipt | CoreCommitFailure, events: GameEvent[], jobs: JobRecord[]): ReceiptViewModel {
  const saved = receipt.status === 'committed' || receipt.status === 'already_committed';
  if (!saved) return { saved: false, memoryPending: false, status: receipt.status, changes: [], sourceRefs: [], reason: sanitizeApiErrorReportText('detail' in receipt ? receipt.detail : 'reason' in receipt ? receipt.reason : '') };
  const matched = events.filter(event => receipt.eventIds.includes(event.eventId) && event.operationId === receipt.operationId && sameScope({ journeyId: event.journeyId, branchId: event.branchId }, receipt.scope));
  const refs = new Map<string, SourceRef>();
  for (const event of matched) for (const evidence of event.evidenceRefs) refs.set(sourceRefKey(evidence.ref), evidence.ref);
  return { saved: true, status: receipt.status, operationId: receipt.operationId, jobIds: [...receipt.jobIds], memoryPending: coreJobAttemptsPending(receipt.scope, receipt.operationId, receipt.jobIds, jobs), changes: structuredClone(matched.flatMap(event => event.committedChanges)), sourceRefs: structuredClone([...refs.values()]) };
}
