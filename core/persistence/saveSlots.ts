import type { CoreRepository, SaveSlot, SaveSlotRequest, SnapshotRecord } from '../contracts/storage';
import type { CoreScope } from '../contracts/identity';
import { isCoreJsonData } from '../contracts/validation';
import { assertId, ownDto, sameScope, stableJson } from './repositoryValidation';
import { checkpointForState, createCheckpoint } from './snapshots';

export const VISIBLE_AUTO_TURNS = 10;
async function autoSlotId(request: SaveSlotRequest): Promise<string> {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stableJson([request.scope,request.turn%VISIBLE_AUTO_TURNS])));
  return `auto-${Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('')}`;
}
function ownRequest(input: SaveSlotRequest): SaveSlotRequest {
  if (!isCoreJsonData(input) || !input || typeof input !== 'object' || Array.isArray(input) ||
    !Object.keys(input).every(key => ['scope', 'kind', 'currentSlotId', 'asNew', 'turn', 'name'].includes(key)) ||
    !['manual', 'auto'].includes(input.kind) || typeof input.asNew !== 'boolean' || typeof input.name !== 'string' ||
    !Number.isSafeInteger(input.turn) || input.turn < 0) throw new Error('CORE2_INVALID_SAVE_REQUEST');
  ownDto('scope', input.scope); if (input.currentSlotId !== undefined) assertId(input.currentSlotId);
  return structuredClone(input);
}
/** Reusing a slot never deletes the immutable snapshot or any source/event history. */
export async function saveSlot(repo: CoreRepository, input: SaveSlotRequest): Promise<SaveSlot> {
  const request = ownRequest(input);
  const snapshot = await createCheckpoint(repo, request.scope);
  return publishSlot(repo, request, snapshot);
}
/** Derive the visible turn from the captured state, never from a stale UI label. */
export async function saveAutomaticCoreTurn(repo: CoreRepository, scope: CoreScope, sessionId: string): Promise<SaveSlot | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const state = ownDto('snapshot', await repo.readState(ownDto('scope', scope)));
    if (!sameScope(state.head.scope, scope)) throw Error('CORE2_SNAPSHOT_SCOPE_MISMATCH');
    if (state.head.sessionId !== sessionId) throw Error('CORE2_SESSION_CHANGED');
    const world = state.records.find(row => row.domain === 'world'), player = state.records.find(row => row.domain === 'traveler');
    if (world?.domain !== 'world') throw Error('CORE2_WORLD_MISSING');
    const turn = world.value.completedMainTurns;
    if (!turn) return null;
    const snapshot = checkpointForState(state);
    try { return await publishSlot(repo, { scope, kind: 'auto', asNew: false, turn, name: `${player?.domain === 'traveler' ? player.value.姓名 : '旅人'} · 自动存档` }, snapshot); }
    catch (error) {
      if (attempt === 2 || !(error instanceof Error) || error.message !== 'CORE2_SNAPSHOT_HEAD_CHANGED') throw error;
    }
  }
  throw Error('CORE2_AUTOSAVE_HEAD_UNSTABLE');
}
async function publishSlot(repo: CoreRepository, request: SaveSlotRequest, snapshot: SnapshotRecord): Promise<SaveSlot> {
  const saved = await repo.listSaveSlots(request.scope.journeyId);
  let previous: SaveSlot | undefined;
  if (request.kind === 'manual' && !request.asNew && request.currentSlotId !== undefined) {
    previous = saved.find(slot => slot.slotId === request.currentSlotId);
    if (!previous || previous.kind !== 'manual') throw new Error('CORE2_MANUAL_SLOT_NOT_FOUND');
  } else if (request.kind === 'auto') {
    const current: SaveSlot[] = [];
    for (const slot of saved.filter(slot => slot.kind === 'auto')) {
      const old = await repo.readSnapshot(slot.snapshotId);
      if (!old) throw new Error('CORE2_SLOT_SNAPSHOT_MISSING');
      if (sameScope(old.scope, request.scope)) current.push(slot);
    }
    previous = current.find(slot => slot.turn === request.turn);
    if (!previous && current.length >= VISIBLE_AUTO_TURNS) previous = current.slice().sort((a,b) => a.turn - b.turn || a.updatedAt - b.updatedAt || (a.slotId < b.slotId ? -1 : 1))[0];
  }
  const slotId=previous?.slotId ?? (request.kind==='auto'?await autoSlotId(request):`slot-${crypto.randomUUID()}`);
  const collision=saved.find(slot=>slot.slotId===slotId);
  if (collision && request.kind==='auto') {
    const old=await repo.readSnapshot(collision.snapshotId);
    if (!old || !sameScope(old.scope,request.scope) || collision.kind!=='auto') throw new Error('CORE2_AUTO_SLOT_IDENTITY_MISMATCH');
  }
  const slot: SaveSlot = { slotId, journeyId: request.scope.journeyId,
    kind: request.kind, snapshotId: snapshot.snapshotId, turn: request.turn, name: request.name, updatedAt: Date.now() };
  await repo.publishSnapshot(snapshot, slot);
  return slot;
}
