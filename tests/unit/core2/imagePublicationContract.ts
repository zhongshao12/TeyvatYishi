import { expect, it, vi } from 'vitest';
import type { CoreRepository } from '@/core/contracts/storage';
import { createCoreController } from '@/core/settlement/coreController';
import { makeSeed } from './fixtures';
import { exportCorePackage, prepareCoreImport } from '@/core/persistence/packageTransfer';

const png = () => Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1cAAAAASUVORK5CYII='), char => char.charCodeAt(0));
export function assertImagePublicationContract(factory: () => Promise<CoreRepository>): void {
async function fixture() {
  const repo = await factory(), seed = makeSeed(); seed.records = seed.records.filter(row => row.domain !== 'album');
  const generate = vi.fn(async () => { throw Error('NO_MODEL_CALL'); });
  const controller = createCoreController({ repo, turnDependencies: () => ({ rulePolicy: { ruleVersion: 'test', storyNodes: [] }, assembleContext: async () => ({ systemPrompt: '', messages: [] }), generateNarrative: generate }) });
  await controller.initialize(seed); return { repo, seed, generate, controller };
}
it('owns uploaded image bytes and publishes a branch-bound album entry exactly once without changing world time or NPC knowledge', async () => {
  const f = await fixture(), before = await f.repo.readState(f.seed.head.scope), bytes = png(), original = [...bytes];
  try {
    const pending = f.controller.uploadImage({ operationId: 'upload-one', title: '安柏的照片', kind: 'character', npcIds: ['npc-amber'], mimeType: 'image/png', bytes }); bytes.fill(0);
    const receipt = await pending; expect(receipt.status).toBe('committed');
    const state = await f.repo.readState(f.seed.head.scope), album = state.records.find(row => row.domain === 'album');
    expect(album?.domain).toBe('album'); if (album?.domain !== 'album') throw Error('missing photo');
    expect(album.value).toMatchObject({ title: '安柏的照片', kind: 'character', npcIds: ['npc-amber'] });
    expect([...(await f.repo.readAsset(album.value.assetId))!.bytes]).toEqual(original);
    expect(state.records.find(row => row.domain === 'world')).toEqual(before.records.find(row => row.domain === 'world'));
    expect((await f.repo.queryKnowledge({ scope: state.head.scope, cutoffSeq: state.head.coreSeq })).items).toEqual([]);
    expect((await f.controller.uploadImage({ operationId: 'upload-one', title: '安柏的照片', kind: 'character', npcIds: ['npc-amber'], mimeType: 'image/png', bytes: png() })).status).toBe('already_committed');
    expect((await f.repo.readState(f.seed.head.scope)).records.filter(row => row.domain === 'album')).toHaveLength(1);
    expect(f.generate).not.toHaveBeenCalled();
    expect(JSON.stringify(await f.repo.readSource(album.value.sourceRefs[0]!))).not.toContain('base64');
  } finally { f.controller.dispose(); }
});
it('rejects non-image bytes, false MIME and unregistered people before publishing album state', async () => {
  const f = await fixture();
  try {
    for (const patch of [{ mimeType: 'image/svg+xml' }, { bytes: new Uint8Array([1, 2, 3]) }, { npcIds: ['missing-npc'] }]) {
      await expect(f.controller.uploadImage({ operationId: crypto.randomUUID(), title: '坏图片', kind: 'character', npcIds: ['npc-amber'], mimeType: 'image/png', bytes: png(), ...patch })).rejects.toThrow();
    }
    expect((await f.repo.readState(f.seed.head.scope)).records.filter(row => row.domain === 'album')).toEqual([]);
  } finally { f.controller.dispose(); }
});
it('does not attach a late upload to a different active journey', async () => {
  const f = await fixture(), put = f.repo.publishAsset.bind(f.repo); let entered!: () => void, release!: () => void;
  const entry = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(f.repo, 'publishAsset').mockImplementation(async value => { await put(value); entered(); await held; });
  try {
    const pending = f.controller.uploadImage({ operationId: 'late-upload', title: '迟到照片', kind: 'character', npcIds: ['npc-amber'], mimeType: 'image/png', bytes: png() });
    const failed = expect(pending).rejects.toThrow('CORE2_IMAGE_SESSION_CHANGED'); await entry;
    const other = makeSeed(); other.records = other.records.filter(row => row.domain !== 'album'); await f.controller.initialize(other);
    release(); await failed;
    for (const scope of [f.seed.head.scope, other.head.scope]) expect((await f.repo.readState(scope)).records.filter(row => row.domain === 'album')).toEqual([]);
  } finally { release(); f.controller.dispose(); }
});
it('binds a selected image through versioned profile fields and preserves avatar bytes when removing only the album entry', async () => {
  const f = await fixture();
  try {
    await f.controller.uploadImage({ operationId: 'upload-avatar', title: '安柏头像', kind: 'character', npcIds: ['npc-amber'], mimeType: 'image/png', bytes: png() });
    const state = await f.repo.readState(f.seed.head.scope), entry = state.records.find(row => row.domain === 'album')!, before = state.records.find(row => row.domain === 'npc' && row.entityId === 'npc-amber')!;
    if (entry.domain !== 'album' || before.domain !== 'npc') throw Error('fixture');
    await expect(f.controller.command({ type: 'image_bind', entryId: entry.entityId, target: 'npc', targetId: 'npc-amber', slot: 'profile', expectedVersion: 99 })).rejects.toThrow();
    const bind = { type: 'image_bind' as const, entryId: entry.entityId, target: 'npc' as const, targetId: 'npc-amber', slot: 'profile' as const, expectedVersion: before.version };
    expect((await f.controller.command(bind, 'bind-avatar-one')).status).toBe('committed');
    expect((await f.controller.command(bind, 'bind-avatar-one')).status).toBe('already_committed');
    let npc = (await f.repo.readState(f.seed.head.scope)).records.find(row => row.domain === 'npc' && row.entityId === 'npc-amber')!;
    if (npc.domain !== 'npc') throw Error('fixture');
    expect(npc.value.avatar).toBe('asset:' + entry.value.assetId); expect(npc.version).toBe(before.version + 1);
    expect(npc.value.matureArchive).toEqual(before.value.matureArchive); expect(npc.value.affinity).toBe(before.value.affinity);
    await f.controller.command({ ...bind, slot: 'courier', expectedVersion: npc.version });
    const updated = await f.repo.readState(f.seed.head.scope); npc = updated.records.find(row => row.domain === 'npc' && row.entityId === 'npc-amber')!;
    expect(npc.domain === 'npc' && npc.value.visualArchive.slotImages.courier).toBe('asset:' + entry.value.assetId);
    const contact = updated.records.find(row => row.domain === 'courier' && row.value.kind === 'contact' && row.value.npcId === 'npc-amber');
    if (contact?.domain === 'courier' && contact.value.kind === 'contact') expect(contact.value.avatarAssetId).toBe(entry.value.assetId);
    await f.controller.command({ type: 'image_delete', entryId: entry.entityId, expectedVersion: entry.version });
    const final = await f.repo.readState(f.seed.head.scope);
    expect(final.records.filter(row => row.domain === 'album')).toEqual([]);
    expect((await f.repo.queryKnowledge({ scope: final.head.scope, cutoffSeq: final.head.coreSeq })).items).toEqual([]);
    expect(await f.repo.readAsset(entry.value.assetId)).not.toBeNull();
    const exported = await prepareCoreImport(await exportCorePackage(f.repo, final.head.scope));
    expect(exported.assets).toHaveLength(1);
  } finally { f.controller.dispose(); }
});
}
