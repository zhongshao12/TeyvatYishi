import { expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { settleCoreOperation } from '@/core/settlement/settleOperation';
import { reviewCoreFacts } from '@/core/settlement/evidenceReview';
import { retrieveCoreMemories } from '@/core/retrieval/retrieveMemory';
import type { FactCandidate } from '@/core/contracts/event';
import { makeCandidate, makeSeed, makeSource } from './fixtures';

function fixture(text = '云和安柏一起在风起地散步。', kind: 'narrative' | 'courier' = 'narrative') {
  const seed = makeSeed(), amber = seed.records.find(row => row.domain === 'npc')!;
  if (amber.domain !== 'npc') throw Error('fixture');
  seed.records.push({ ...structuredClone(amber), entityId: 'npc-lisa', value: { ...structuredClone(amber.value), id: 'npc-lisa', 姓名: '丽莎', aliases: [], canonicalId: 'lisa' } });
  const source = makeSource({ scope: seed.head.scope, operationId: 'shared-walk', kind, blocks: [{ blockId: 'walk', kind: 'narration', text }] });
  // Deliberately cross the JSON boundary: an unregistered proposal must fail RED.
  const candidate = makeCandidate({ scope: seed.head.scope, operationId: source.operationId, kind: 'experience', actors: [seed.playerId, 'npc-amber'], targets: [],
    proposal: { kind: 'experience', participantIds: [seed.playerId, 'npc-amber'], description: text },
    evidenceRefs: [{ ref: source.ref, blockId: 'walk', start: 0, end: text.length, quote: text }] } as Partial<FactCandidate>);
  return { seed, source, candidate };
}

it('records an evidenced joint experience without inventing state changes, and recalls it only to participants', async () => {
  const { seed, source, candidate } = fixture();
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-shared-${crypto.randomUUID()}` }); await repo.initialize(seed);
  const receipt = await settleCoreOperation({ scope: seed.head.scope, sessionId: seed.head.sessionId, operationId: source.operationId, kind: 'main', sources: [source] },
    { repo, rulePolicy: { ruleVersion: 'test', storyNodes: [] }, factModel: async () => ({ kind: 'extracted', candidates: [candidate], attempts: 1 }) });
  const events = (await repo.queryEvents({ scope: seed.head.scope, cutoffSeq: receipt.coreSeq })).items;
  const experience = events.find(row => row.fact?.kind === 'experience');
  expect(experience).toMatchObject({ type: 'experience', committedChanges: [], fact: { description: source.blocks[0]!.text } });
  expect((await repo.readState(seed.head.scope)).records.find(row => row.entityId === 'npc-amber')).toMatchObject({ value: { affinity: 10 } });
  const head = await repo.readHead(seed.head.scope), request = { scope: head.scope, head, entityIds: ['npc-amber'], locations: ['风起地'], query: '一起散步', moment: source.moment };
  const amber = await retrieveCoreMemories({ ...request, audience: { target: 'private', npcIds: ['npc-amber'] } }, { repo });
  expect(amber.selectedLeafIds).toContain(experience!.eventId);
  expect(amber.optional.map(row => row.text).join('\n')).toContain('一起在风起地散步');
  const lisa = await retrieveCoreMemories({ ...request, audience: { target: 'private', npcIds: ['npc-lisa'] } }, { repo });
  expect(lisa.selectedLeafIds).not.toContain(experience!.eventId);
});

it.each([
  '云和安柏准备一起在风起地散步。',
  '云和安柏没有一起在风起地散步。',
  '丽莎说云和安柏一起在风起地散步。',
  '云和安柏一起在风起地散步，丽莎私下去了秘密房间。',
  '云和丽莎一起散步，安柏只在远处看着。',
  '云听说安柏一起在风起地散步。',
])('does not promote a plan, negation, report, or mixed private clause: %s', text => {
  const { seed, source, candidate } = fixture(text);
  expect(reviewCoreFacts({ candidates: [candidate], sources: [source], snapshot: { head: seed.head, records: seed.records, contentRefs: [] }, policy: {} }).verified).toEqual([]);
});

it('does not promote courier or spoken claims to physical shared experiences', () => {
  for (const mode of ['courier', 'dialogue'] as const) {
    const { seed, source, candidate } = fixture(undefined, mode === 'courier' ? 'courier' : 'narrative');
    if (mode === 'dialogue') source.blocks[0] = { ...source.blocks[0]!, kind: 'dialogue', speakerId: 'npc-amber' };
    expect(reviewCoreFacts({ candidates: [candidate], sources: [source], snapshot: { head: seed.head, records: seed.records, contentRefs: [] }, policy: {} }).verified).toEqual([]);
  }
});
