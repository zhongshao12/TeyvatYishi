import type { CoreRepository } from '../contracts/storage';
import type { CoreScope } from '../contracts/identity';
import type { AlbumState, StateRecord } from '../contracts/state';
import { validateCoreDto } from '../contracts/validation';
import { ownCoreImage } from '../assets/images';
import { checksumUtf8 } from '../sources/sourceIntegrity';
import { freezeSource } from '../sources/sourceRecords';
import { sameData, stableJson } from '../persistence/repositoryValidation';
import { publishCoreAsset } from '../persistence/assets';
import { commitHostPublication, hostPublicationEvent } from './commitHostPublication';

export interface CoreImageUpload { title: string; kind: AlbumState['kind']; npcIds: string[]; bytes: Uint8Array; mimeType: string }
export async function publishCoreUploadedImage(input: CoreImageUpload & { scope: CoreScope; sessionId: string; operationId: string }, deps: { repo: CoreRepository; getActiveSession(): { scope: CoreScope; sessionId: string } | null }) {
  const image = ownCoreImage(input.bytes, input.mimeType);
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 200 || !['character', 'scene', 'snapshot'].includes(input.kind)
    || !Array.isArray(input.npcIds) || input.npcIds.length > 20 || !input.npcIds.every(id => validateCoreDto('sourceRef', { sourceId: id, sourceVersion: 1 }).ok)
    || !validateCoreDto('scope', input.scope).ok || !validateCoreDto('sourceRef', { sourceId: input.operationId, sourceVersion: 1 }).ok) throw Error('CORE2_IMAGE_INPUT_INVALID');
  const scope = structuredClone(input.scope), sessionId = input.sessionId, operationId = input.operationId;
  const npcIds = [...new Set(input.npcIds)].sort(), title = input.title.trim(), kind = input.kind;
  const key = checksumUtf8(stableJson([scope, operationId])), sourceRef = { sourceId: 'image-upload-source-' + key, sourceVersion: 1 };
  const assetId = 'image-upload-asset-' + key, entryId = 'image-entry-' + key;
  const text = stableJson({ type: 'upload_image', title, kind, npcIds, assetId, checksum: image.checksum, mimeType: image.mimeType });
  const current = async () => {
    const head = await deps.repo.readHead(scope);
    if (head.sessionId !== sessionId || !sameData(deps.getActiveSession(), { scope, sessionId })) throw Error('CORE2_IMAGE_SESSION_CHANGED');
  };
  await current();
  const saved = await deps.repo.readSource(sourceRef), prior = await deps.repo.readOperation(scope, operationId);
  if (saved && (saved.kind !== 'manual' || saved.operationId !== operationId || saved.blocks.length !== 1 || saved.blocks[0]?.text !== text)) throw Error('CORE2_IMAGE_PUBLICATION_CHANGED');
  if (prior?.status === 'committed' && prior.receipt) {
    if (!saved || prior.kind !== 'manual' || !sameData(prior.sourceRefs, [sourceRef])) throw Error('CORE2_IMAGE_OPERATION_ID_REUSED');
    return { ...prior.receipt, status: 'already_committed' as const };
  }
  const state = await deps.repo.readState(scope), world = state.records.find(row => row.domain === 'world'); if (world?.domain !== 'world') throw Error('CORE2_WORLD_MISSING');
  const people = npcIds.map(id => { const npc = state.records.find(row => row.domain === 'npc' && row.entityId === id); if (npc?.domain !== 'npc' || npc.value.archived) throw Error('CORE2_IMAGE_CHARACTER_MISSING'); return npc; });
  const source = saved ?? { ...freezeSource({ scope, operationId, kind: 'manual', moment: world.value.moment, blocks: [{ blockId: 'upload', kind: 'configuration', text }] }), ref: sourceRef };
  await current(); await publishCoreAsset(deps.repo, { scope, sessionId, asset: { ...image, scope, assetId } }); await current();
  const record: StateRecord<'album'> = { scope, domain: 'album', entityId: entryId, version: 1, value: { entryId, title, kind, assetId, sourceRefs: [source.ref], npcIds, moment: source.moment } };
  const change = { ref: { domain: 'album' as const, entityId: entryId, version: 0 }, before: null, after: record, effectKey: 'effect-' + entryId };
  const readSet = [change.ref, ...people.map(npc => ({ domain: 'npc' as const, entityId: npc.entityId, version: npc.version }))];
  return commitHostPublication(deps.repo, source, { sessionId, readSet, changes: [change], events: [hostPublicationEvent(source, 'publication.image', [change])], jobs: [] });
}
