import { expect, it } from 'vitest';
import type { CoreRepository } from '@/core/contracts/storage';
import { encodePreparedImport, type WirePreparedImport } from '@/core/persistence/desktopProtocol';
import { stableJson } from '@/core/persistence/repositoryValidation';
import { checksumUtf8 } from '@/core/sources/sourceIntegrity';
import { createCoreController } from '@/core/settlement/coreController';
import { readCorePhonePhotoBatch } from '@/core/retrieval/phonePhotoContext';
import { exportCorePackage, prepareCoreImport } from '@/core/persistence/packageTransfer';
import { makeSeed } from './fixtures';
import { AMBER_IMAGE_FACTS, seedAmberImageFacts } from './imageEnglishFixture';
const png = () => Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1cAAAAASUVORK5CYII='), c => c.charCodeAt(0));
export function assertPhonePhotoContextContract(factory: () => Promise<CoreRepository>, rawImport?: (input: WirePreparedImport) => Promise<unknown>): void {
async function fixture(initiallyOffline = false) {
  const repo = await factory(), seed = makeSeed(); seedAmberImageFacts(seed); seed.records = seed.records.filter(row => row.domain !== 'album');
  seed.records.push({ scope: seed.head.scope, domain: 'courier', entityId: 'photo-chat', version: 1, value: { kind: 'conversation', conversationType: 'private', name: '安柏', memberIds: ['npc-amber'], unreadCount: 0, lastReadSeq: 0, dissolved: false } });
  let ready = !initiallyOffline;
  const controller = createCoreController({ repo, phoneModels: { getModelIdentity: () => 'phone-test', generate: async () => { if (!ready) throw Error('TEST_OFFLINE'); return { text: '好呀，我就在风起地的大树旁边！' }; } }, imageModels: { getModelIdentity: () => 'image-test', generate: async () => ({ bytes: png(), mimeType: 'image/png' }) }, turnDependencies: () => ({ rulePolicy: { ruleVersion: 'test', storyNodes: [] }, assembleContext: async () => ({ systemPrompt: '', messages: [] }), generateNarrative: async () => 'not called', factModel: async () => ({ kind: 'extracted', candidates: [], attempts: 0 }) }) });
  await controller.initialize(seed); const receipt = await controller.sendPhone({ conversationId: 'photo-chat', text: '请拍一张风起地的照片', operationId: 'photo-request-message' }); await controller.waitForBackground();
  const snapshot = await repo.readState(seed.head.scope), events = (await repo.queryEvents({ scope: seed.head.scope, cutoffSeq: snapshot.head.coreSeq, channelIds: ['photo-chat'] })).items;
  const playerEventId = receipt.eventIds.find(id => events.some(event => event.eventId === id && event.actorIds[0] === seed.playerId))!;
  return { repo, seed, controller, snapshot, events, playerEventId, finishReply: async () => { ready = true; const job = (await repo.queryJobs({ scope: seed.head.scope, cutoffSeq: (await repo.readHead(seed.head.scope)).coreSeq, kinds: ['courier'], statuses: ['failed'] })).items[0]!; await controller.retryJob(job.jobId); await controller.waitForBackground(); } };
}
it('offers one batch after a completed chat using only actual responders and the exact player request', async () => {
  const f = await fixture(); try {
    expect(await readCorePhonePhotoBatch(f.snapshot, 'photo-chat', f.events, f.repo)).toEqual({ playerEventId: f.playerEventId, userInput: '请拍一张风起地的照片', npcIds: ['npc-amber'], waiting: false });
  } finally { f.controller.dispose(); }
});
it('binds a generated phone photo to its confirmed message batch and preserves typed references through export/import', async () => {
  const f = await fixture(); try {
    const origin = { conversationId: 'photo-chat', playerEventId: f.playerEventId, npcId: 'npc-amber' };
    await f.controller.requestImage({ title: '手机照片', kind: 'character', npcIds: ['npc-amber'], prompt: 'Amber, outdoors', negative: '', size: '512x512', characters: [AMBER_IMAGE_FACTS], phoneOrigin: origin }); await f.controller.waitForBackground();
    const state = await f.repo.readState(f.seed.head.scope), album = state.records.find(row => row.domain === 'album'); expect(album).toMatchObject({ value: { phoneOrigin: origin } });
    const pack = await prepareCoreImport(await exportCorePackage(f.repo, f.seed.head.scope)), imported = pack.branches.find(row => row.state.head.scope.branchId === pack.manifest.scope.branchId)!.state.records.find(row => row.domain === 'album');
    expect(imported).toMatchObject({ value: { phoneOrigin: { conversationId: 'photo-chat', npcId: 'npc-amber', playerEventId: expect.not.stringMatching(new RegExp('^' + f.playerEventId + '$')) } } });
    await f.repo.importPrepared(pack);
  } finally { f.controller.dispose(); }
});
it('rejects a phone photo if the anchor is not that conversation’s player message or the person did not reply', async () => {
  const f = await fixture(); try {
    await expect(f.controller.requestImage({ title: '错误照片', kind: 'character', npcIds: ['npc-amber'], prompt: 'Amber', negative: '', size: '512x512', characters: [AMBER_IMAGE_FACTS], phoneOrigin: { conversationId: 'photo-chat', playerEventId: f.events.find(event => event.actorIds[0] === 'npc-amber')!.eventId, npcId: 'npc-amber' } })).rejects.toThrow();
    expect((await f.repo.readState(f.seed.head.scope)).records.filter(row => row.domain === 'album')).toEqual([]);
  } finally { f.controller.dispose(); }
});
it('allows a new photo from reachable historical chat after restoring a saved branch without changing the parent album', async () => {
  const f = await fixture(); try {
    const slot = await f.controller.save({ scope: f.seed.head.scope, kind: 'manual', asNew: true, turn: 1, name: '拍照前' });
    const head = await f.controller.restore(slot.snapshotId);
    await f.controller.requestImage({ title: '分支照片', kind: 'character', npcIds: ['npc-amber'], prompt: 'Amber', negative: '', size: '512x512', characters: [AMBER_IMAGE_FACTS], phoneOrigin: { conversationId: 'photo-chat', playerEventId: f.playerEventId, npcId: 'npc-amber' } }); await f.controller.waitForBackground();
    expect((await f.repo.readState(head.scope)).records.find(row => row.domain === 'album')).toMatchObject({ scope: head.scope, value: { title: '分支照片' } });
    expect((await f.repo.readState(f.seed.head.scope)).records.filter(row => row.domain === 'album')).toEqual([]);
  } finally { f.controller.dispose(); }
});
it('does not use a parent reply delivered after the restored snapshot to authorize a photo', async () => {
  const f = await fixture(true); try {
    const slot = await f.controller.save({ scope: f.seed.head.scope, kind: 'manual', asNew: true, turn: 1, name: '回信前' });
    await f.finishReply();
    const head = await f.controller.restore(slot.snapshotId);
    await expect(f.controller.requestImage({ title: '不能预知回信', kind: 'character', npcIds: ['npc-amber'], prompt: 'Amber', negative: '', size: '512x512', characters: [AMBER_IMAGE_FACTS], phoneOrigin: { conversationId: 'photo-chat', playerEventId: f.playerEventId, npcId: 'npc-amber' } })).rejects.toThrow('CORE2_IMAGE_PHONE_REPLY_REQUIRED');
    expect((await f.repo.readState(head.scope)).records.filter(row => row.domain === 'album')).toEqual([]);
  } finally { f.controller.dispose(); }
});
it('rejects a forged imported phone-photo link even when state history and snapshot checksums are internally consistent', async () => {
  const f = await fixture(); try {
    await f.controller.requestImage({ title: '手机照片', kind: 'character', npcIds: ['npc-amber'], prompt: 'Amber', negative: '', size: '512x512', characters: [AMBER_IMAGE_FACTS], phoneOrigin: { conversationId: 'photo-chat', playerEventId: f.playerEventId, npcId: 'npc-amber' } }); await f.controller.waitForBackground();
    const pack = await prepareCoreImport(await exportCorePackage(f.repo, f.seed.head.scope));
    const wrong = pack.events.find(event => event.actorIds[0] === 'npc-amber' && event.channelId === 'photo-chat')!.eventId;
    const forge = (value: unknown): void => {
      if (!value || typeof value !== 'object' || value instanceof Uint8Array) return;
      for (const [key, child] of Object.entries(value)) {
        if (key === 'phoneOrigin' && child && typeof child === 'object') (child as { playerEventId: string }).playerEventId = wrong;
        else forge(child);
      }
    };
    const forged = structuredClone(pack); forge(forged); for (const snapshot of forged.snapshots) snapshot.checksum = checksumUtf8(stableJson(snapshot.state));
    await expect(f.repo.importPrepared(forged)).rejects.toThrow('CORE2_IMPORT_PHONE_PHOTO');
    if (rawImport) { const wire = encodePreparedImport(pack); forge(wire); for (const snapshot of wire.snapshots) snapshot.checksum = checksumUtf8(stableJson(snapshot.state)); await expect(rawImport(wire)).rejects.toThrow('CORE2_IMPORT_PHONE_PHOTO'); }
    await expect(f.repo.readHead(pack.manifest.scope)).rejects.toThrow('CORE2_BRANCH_NOT_FOUND');
  } finally { f.controller.dispose(); }
});
}
