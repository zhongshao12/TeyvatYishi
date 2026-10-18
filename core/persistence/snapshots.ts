import type { CoreRepository, SnapshotRecord } from '../contracts/storage';
import type { CoreScope } from '../contracts/identity';
import type { CoreSnapshot } from '../contracts/state';
import { ownDto, sameScope, stableJson } from './repositoryValidation';
import { checksumUtf8 } from '../sources/sourceIntegrity';

/** Capturing is read-only. Publication still checks the durable live head atomically. */
export async function createCheckpoint(repo: CoreRepository, input: CoreScope): Promise<SnapshotRecord> {
  const scope = ownDto('scope', input);
  const state = ownDto('snapshot', await repo.readState(scope));
  if (!sameScope(state.head.scope, scope)) throw new Error('CORE2_SNAPSHOT_SCOPE_MISMATCH');
  return checkpointForState(state);
}
/** Pure capture used inside a backend's existing transaction, never a nested repository call. */
export function checkpointForState(input: CoreSnapshot): SnapshotRecord {
  const state = ownDto('snapshot',input);
  return { snapshotId: `snapshot-${crypto.randomUUID()}`, scope: state.head.scope, coreSeq: state.head.coreSeq,
    memoryRevision: state.head.memoryRevision, state, createdAt: Date.now(), checksum: checksumUtf8(stableJson(state)) };
}
