import type { CoreRepository } from '../contracts/storage';
import type { CoreScope } from '../contracts/identity';
import type { CommitReceipt, OperationStage } from '../contracts/operation';

export type RecoveryDecision = { kind: 'committed'; receipt: CommitReceipt } | { kind: 'not_found' | 'cancelled' | 'needs_extraction' }
  | { kind: 'needs_review'; stage: OperationStage };
/** Inspection only: never auto-resends an API request or rewrites a stored operation. */
export async function recoverCoreOperation(repo: CoreRepository, scope: CoreScope, operationId: string): Promise<RecoveryDecision> {
  const operation = await repo.readOperation(scope, operationId);
  if (!operation) return { kind: 'not_found' };
  if (operation.receipt && ['committed', 'already_committed'].includes(operation.receipt.status)) return { kind: 'committed', receipt: operation.receipt };
  if (operation.status === 'cancelled') return { kind: 'cancelled' };
  return operation.stage ? { kind: 'needs_review', stage: operation.stage } : { kind: 'needs_extraction' };
}
