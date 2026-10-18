import { expect, it } from 'vitest';
import { commitCoreInteraction } from '@/core/settlement/consumerOperations';
import { retrieveCoreMemories } from '@/core/retrieval/retrieveMemory';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { makeSeed } from './fixtures';
import { freezeSource } from '@/core/sources/sourceRecords';
import { summarizeCoreTurn } from '@/core/memory/turnSummary';
import { readCoreTurnMaterial } from '@/core/memory/turnMaterial';
import { planCoreProactiveContact } from '@/core/settlement/proactiveContact';
import { settleCoreOperation } from '@/core/settlement/settleOperation';
import { makeCandidate } from './fixtures';
import { createCoreController } from '@/core/settlement/coreController';

export async function interactionFixture() {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-interaction-${crypto.randomUUID()}` }), seed = makeSeed();
  seed.records.push({ scope: seed.head.scope, domain: 'courier', entityId: 'amber-chat', version: 1, value: { kind: 'conversation', name: '安柏', memberIds: ['npc-amber'], conversationType: 'private', unreadCount: 0, lastReadSeq: 0, dissolved: false } });
  await repo.initialize(seed);
  const source = freezeSource({ scope: seed.head.scope, operationId: 'phone-exchange', kind: 'courier', moment: seed.sources[0]!.moment,
    blocks: [{ blockId: 'p1', kind: 'message', speakerId: seed.playerId, text: '谢谢你，今天辛苦了。' }, { blockId: 'a1', kind: 'message', speakerId: 'npc-amber', text: '我说给你送苹果，只是说说，先别增加背包哦！' }] });
  return { repo, seed, source, deps: { repo, rulePolicy: { ruleVersion: 'test', storyNodes: [] }, factModel: async () => ({ kind: 'extracted' as const, candidates: [], attempts: 1 }) } };
}

it('commits attributed exchanges, knowledge, phone affinity and a summary job atomically without advancing time', async () => {
  const f = await interactionFixture(), input = { scope: f.seed.head.scope, sessionId: f.seed.head.sessionId, source: f.source, target: 'private' as const, channelId: 'amber-chat', recipientIds: ['npc-amber'] };
  const before = await f.repo.readState(input.scope), first = await commitCoreInteraction(input, f.deps), repeat = await commitCoreInteraction(input, f.deps);
  expect(first.status).toBe('committed'); expect(repeat.status).toBe('already_committed');
  const after = await f.repo.readState(input.scope), npc = after.records.find(row => row.domain === 'npc');
  expect(npc?.domain === 'npc' && npc.value.affinity).toBe(12);
  expect(after.records.find(row => row.domain === 'world')).toEqual(before.records.find(row => row.domain === 'world'));
  expect(after.records.find(row => row.domain === 'inventory')).toEqual(before.records.find(row => row.domain === 'inventory'));
  expect(first.jobIds).toHaveLength(1);
  const events = (await f.repo.queryEvents({ scope: input.scope, cutoffSeq: after.head.coreSeq })).items;
  expect(events.filter(event => event.type === 'communication.private')).toHaveLength(2);
  const recall = await retrieveCoreMemories({ scope: input.scope, head: after.head, audience: { target: 'private', npcIds: ['npc-amber'] }, entityIds: ['npc-amber'], locations: [], query: '苹果', moment: f.source.moment }, { repo: f.repo });
  expect(recall.optional.map(row => row.text).join('\n')).toContain('只是说说');
  const stranger = await retrieveCoreMemories({ scope: input.scope, head: after.head, audience: { target: 'private', npcIds: ['npc-lisa'] }, entityIds: ['npc-amber'], locations: [], query: '苹果', moment: f.source.moment }, { repo: f.repo });
  expect(stranger.selectedLeafIds).toEqual([]);
  const material = await readCoreTurnMaterial(f.repo, { scope: input.scope, cutoffSeq: after.head.coreSeq, operationId: input.source.operationId });
  const summary = await summarizeCoreTurn({ ...material, mode: 'local', prompt: '' }, {});
  expect(summary.kind).toBe('staged');
  if (summary.kind === 'staged') { expect(summary.memory.text).toContain('只是说说'); expect(summary.memory.text).toContain('recorded_utterance'); }
  await expect(commitCoreInteraction({ ...input, source: { ...input.source, blocks: [{ ...input.source.blocks[0]!, text: '换一条同ID消息' }] } }, f.deps)).rejects.toThrow('CORE2_INTERACTION_REPLAY_MISMATCH');
});

it('rejects forged recipients, source kind and player-controlled world timestamps', async () => {
  const f = await interactionFixture(), input = { scope: f.seed.head.scope, sessionId: f.seed.head.sessionId, source: f.source, target: 'private' as const, channelId: 'amber-chat', recipientIds: ['npc-amber'] };
  await expect(commitCoreInteraction({ ...input, recipientIds: ['npc-lisa'] }, f.deps)).rejects.toThrow('CORE2_INTERACTION_CHANNEL');
  await expect(commitCoreInteraction({ ...input, source: { ...f.source, kind: 'manual' } }, f.deps)).rejects.toThrow('CORE2_INTERACTION_SOURCE');
  await expect(commitCoreInteraction({ ...input, source: { ...f.source, moment: { ...f.source.moment, clock: '23:59' } } }, f.deps)).rejects.toThrow('CORE2_INTERACTION_WORLD_TIME');
  expect((await f.repo.readHead(input.scope)).coreSeq).toBe(0);
});
it('replies to an already committed player message once without duplicating it, using delivery world time', async () => {
  const f = await interactionFixture(), scope = f.seed.head.scope, sessionId = f.seed.head.sessionId;
  const sent = { ...f.source, blocks: [f.source.blocks[0]!] };
  const player = await commitCoreInteraction({ scope, sessionId, source: sent, target: 'private', channelId: 'amber-chat', recipientIds: ['npc-amber'] }, f.deps);
  const replyToEventId = player.eventIds[0]!;
  const time = freezeSource({ scope, operationId: 'phone-two-hours-later', kind: 'narrative', moment: sent.moment, blocks: [{ blockId: 'time', kind: 'narration', text: '两个小时后。' }] });
  const candidate = makeCandidate({ scope, operationId: time.operationId, kind: 'time', actors: [], targets: [], proposal: { kind: 'time', elapsedMinutes: 120 }, evidenceRefs: [{ ref: time.ref, blockId: 'time', start: 0, end: 6, quote: '两个小时后。' }] });
  await settleCoreOperation({ scope, sessionId, operationId: time.operationId, kind: 'main', sources: [time] }, { ...f.deps, factModel: async () => ({ kind: 'extracted', candidates: [candidate], attempts: 1 }) });
  const reply = freezeSource({ scope, operationId: 'phone-delayed-reply', kind: 'courier', moment: sent.moment, blocks: [{ blockId: 'reply', kind: 'message', speakerId: 'npc-amber', text: '谢谢云，刚刚巡逻回来，收到啦！' }] });
  const input = { scope, sessionId, source: reply, target: 'private' as const, channelId: 'amber-chat', recipientIds: ['npc-amber'], replyToEventId };
  expect((await commitCoreInteraction(input, f.deps)).status).toBe('committed');
  expect((await commitCoreInteraction(input, f.deps)).status).toBe('already_committed');
  const state = await f.repo.readState(scope), events = (await f.repo.queryEvents({ scope, cutoffSeq: state.head.coreSeq, types: ['communication.private'] })).items;
  expect(events).toHaveLength(2); expect(events.filter(event => event.actorIds.includes(f.seed.playerId))).toHaveLength(1);
  expect(events.find(event => event.actorIds.includes('npc-amber'))).toMatchObject({ replyToEventId, occurredMoment: { clock: '12:00' } });
  expect(state.records.find(row => row.domain === 'npc')).toMatchObject({ value: { affinity: 12 } });
});
it('rejects a reply anchor that is not a reachable player message in the same channel', async () => {
  const f = await interactionFixture(), scope = f.seed.head.scope;
  const source = { ...f.source, blocks: [f.source.blocks[1]!] };
  await expect(commitCoreInteraction({ scope, sessionId: f.seed.head.sessionId, source, target: 'private', channelId: 'amber-chat', recipientIds: ['npc-amber'], replyToEventId: 'forged-player-event' }, f.deps)).rejects.toThrow('CORE2_REPLY_ANCHOR');
});
it('stores unread counts and rejects a stale read acknowledgement instead of hiding a newer arrival', async () => {
  const f = await interactionFixture(), scope = f.seed.head.scope;
  await commitCoreInteraction({ scope, sessionId: f.seed.head.sessionId, source: f.source, target: 'private', channelId: 'amber-chat', recipientIds: ['npc-amber'] }, f.deps);
  const controller = createCoreController({ repo: f.repo, turnDependencies: () => ({ ...f.deps, generateNarrative: async () => '', assembleContext: async () => ({ systemPrompt: '', messages: [] }) }) });
  await controller.attach({ scope });
  const before = controller.getView().snapshot!, conversation = before.records.find(row => row.domain === 'courier' && row.entityId === 'amber-chat')!;
  expect(conversation).toMatchObject({ value: { unreadCount: 1 } });
  await controller.command({ type: 'conversation_read', conversationId: 'amber-chat', expectedVersion: conversation.version, throughSeq: before.head.coreSeq });
  expect(controller.getView().snapshot!.records.find(row => row.entityId === 'amber-chat')).toMatchObject({ value: { unreadCount: 0, lastReadSeq: before.head.coreSeq } });
  const owner = controller.getView().snapshot!.head, source = freezeSource({ scope, operationId: 'incoming-after-read', kind: 'courier', moment: f.source.moment, blocks: [{ blockId: 'incoming', kind: 'message', speakerId: 'npc-amber', text: '还有一条新的消息。' }] });
  await commitCoreInteraction({ scope, sessionId: owner.sessionId, source, target: 'private', channelId: 'amber-chat', recipientIds: ['npc-amber'] }, f.deps);
  await expect(controller.command({ type: 'conversation_read', conversationId: 'amber-chat', expectedVersion: conversation.version, throughSeq: before.head.coreSeq })).rejects.toThrow('CORE2_PLAYER_ACTION_REJECTED');
  expect((await f.repo.readState(scope)).records.find(row => row.entityId === 'amber-chat')).toMatchObject({ value: { unreadCount: 1 } });
});

it('atomically records the global proactive cooldown only with the one successful message, never on failure', async () => {
  const f = await interactionFixture();
  // Separate fresh seeded journey, not direct writes to the live repository.
  const seed = makeSeed(), world = seed.records.find(row => row.domain === 'world'), npc = seed.records.find(row => row.domain === 'npc');
  if (world?.domain !== 'world' || npc?.domain !== 'npc') throw Error('fixture');
  world.value.completedMainTurns = 15; world.value.moment.turn = 15; npc.value.affinity = 100;
  seed.records.push({ scope: seed.head.scope, domain: 'courier', entityId: 'proactive-chat', version: 1, value: { kind: 'conversation', name: '安柏', memberIds: ['npc-amber'], conversationType: 'private', unreadCount: 0, lastReadSeq: 0, dissolved: false } });
  await f.repo.initialize(seed);
  const plan = planCoreProactiveContact({ head: seed.head, records: seed.records, contentRefs: [] })!;
  const source = freezeSource({ scope: seed.head.scope, operationId: plan.operationId, kind: 'courier', moment: world.value.moment, blocks: [{ blockId: 'a', kind: 'message', speakerId: 'npc-amber', text: '云，今天还好吗？' }] });
  const input = { scope: seed.head.scope, sessionId: seed.head.sessionId, source, target: 'private' as const, channelId: 'proactive-chat', recipientIds: ['npc-amber'], proactive: plan };
  await expect(commitCoreInteraction(input, { ...f.deps, factModel: async () => ({ kind: 'failed', code: 'MODEL_FAILED', detail: 'test', attempts: 1 }) })).rejects.toThrow('MODEL_FAILED');
  const failedState = await f.repo.readState(seed.head.scope); expect(planCoreProactiveContact(failedState)).toEqual(plan);
  expect((await commitCoreInteraction(input, f.deps)).status).toBe('committed');
  expect((await commitCoreInteraction(input, f.deps)).status).toBe('already_committed');
  const state = await f.repo.readState(seed.head.scope); expect(planCoreProactiveContact(state)).toBeNull();
  const updated = state.records.find(row => row.domain === 'world');
  expect(updated?.domain === 'world' && updated.value.proactiveLastTurn).toBe(15);
  expect(updated?.domain === 'world' && updated.value.completedMainTurns).toBe(15);
});
