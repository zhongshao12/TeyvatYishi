import { expect, it } from 'vitest';
import { makeCandidate, makeSeed, makeSource } from './fixtures';
import { makeNodeRepository } from './nodeCorpusSession';
import { settleCoreOperation } from '@/core/settlement/settleOperation';
import { displayFirstPartner } from '@/utils/npcFirstPartner';
import { deriveCoreRelationshipCandidates } from '@/core/settlement/relationshipRules';
import { reviewCoreFacts } from '@/core/settlement/evidenceReview';
import { buildCoreActions } from '@/core/settlement/actions';
import { applyCoreGroups } from '@/core/settlement/domainRules';

it.each([true, false, 'both'] as const)('records separate eligible NPC interactions with fixed deltas, even when the model proposes no relationship (%s)', async modelProposes => {
  const seed = makeSeed(), base = seed.records.find(row => row.domain === 'npc'); if (base?.domain !== 'npc') throw Error('fixture');
  seed.records = seed.records.filter(row => row.domain !== 'npc');
  for (const [id, name, initial] of [['npc-noelle', '诺艾尔', 20], ['npc-lumine', '荧', 40]] as const) seed.records.push({ ...structuredClone(base), entityId: id, value: { ...structuredClone(base.value), id, 姓名: name, affinity: initial, travelingTogether: false,
    matureArchive: { ageConfirmation: 'adult', ageConfirmationSource: 'manual', virginityStatus: 'virgin', preferences: [], sensitivePoints: [], taboos: [], tags: [], femaleBodyProfile: {}, maleBodyProfile: {}, partImages: {} } } });
  const texts = ['诺艾尔与云调情。', '荧与云首次发生了性爱关系。'], source = makeSource({ scope: seed.head.scope, blocks: texts.map((text, i) => ({ blockId: `body-${i}`, kind: 'narration', text })) });
  const candidates = texts.map((text, i) => makeCandidate({ candidateId: `relation-${i}`, kind: 'relationship', scope: seed.head.scope, operationId: source.operationId, actors: [seed.playerId, ...(modelProposes === 'both' ? [i === 0 ? 'npc-noelle' : 'npc-lumine'] : [])], targets: [i === 0 ? 'npc-noelle' : 'npc-lumine'], proposal: { kind: 'relationship', npcId: i === 0 ? 'npc-noelle' : 'npc-lumine', affinityDelta: 1 }, evidenceRefs: [{ ref: source.ref, blockId: `body-${i}`, start: 0, end: text.length, quote: text }] }));
  const repo = makeNodeRepository(`test-core2-multiple-relationships-${crypto.randomUUID()}`); await repo.initialize(seed);
  const input = { scope: seed.head.scope, sessionId: seed.head.sessionId, operationId: source.operationId, kind: 'main' as const, sources: [source] }, deps = { repo, rulePolicy: { ruleVersion: 'test', storyNodes: [] }, factModel: async () => ({ kind: 'extracted' as const, candidates: modelProposes ? candidates : [], attempts: 0 }) };
  expect((await settleCoreOperation(input, deps)).status).toBe('committed');
  const audited = (await repo.readOperation(seed.head.scope, source.operationId))?.stage?.candidates;
  expect(audited?.length).toBeGreaterThanOrEqual(2);
  expect(audited?.every(row => row.status === 'verified'), JSON.stringify(audited?.map(row => row.reason))).toBe(true);
  const state = await repo.readState(seed.head.scope), noelle = state.records.find(row => row.entityId === 'npc-noelle'), lumine = state.records.find(row => row.entityId === 'npc-lumine');
  expect(noelle?.value).toMatchObject({ affinity: 23 }); expect(lumine?.value).toMatchObject({ affinity: 70, matureArchive: { virginityStatus: 'not_virgin', firstSexualPartnerRef: 'player', firstSexualPartnerSource: 'narrative', firstSexualPartnerTurn: 1 } });
  expect((await settleCoreOperation(input, deps)).status).toBe('already_committed');
  expect((await repo.readState(seed.head.scope)).records.find(row => row.entityId === 'npc-lumine')?.value).toMatchObject({ affinity: 70 });
  const knowledge = (await repo.queryKnowledge({ scope: state.head.scope, cutoffSeq: state.head.coreSeq })).items;
  expect(new Set(knowledge.map(row => row.npcId))).toEqual(new Set(['npc-noelle', 'npc-lumine']));
  for (const row of knowledge) expect(row.evidenceRefs.every(ref => ref.blockId === (row.npcId === 'npc-noelle' ? 'body-0' : 'body-1'))).toBe(true);
  expect(displayFirstPartner({ 首次性行为对象引用: 'player' }, '改名后的旅人')).toBe('改名后的旅人');
});

it('does not fall back to a model reward when identity notes fail the existing adult policy', () => {
  const seed = makeSeed(), npc = seed.records.find(row => row.domain === 'npc')!;
  if (npc.domain !== 'npc') throw Error('fixture'); npc.value.notes = ['年龄17周岁'];
  const text = '安柏亲吻了云。', source = makeSource({ scope: seed.head.scope, blocks: [{ blockId: 'body', kind: 'narration', text }] });
  const state = { head: seed.head, records: seed.records, contentRefs: [] }, candidate = makeCandidate({ kind: 'relationship', scope: seed.head.scope, operationId: source.operationId, actors: [seed.playerId], targets: [npc.entityId],
    proposal: { kind: 'relationship', npcId: npc.entityId, affinityDelta: 99 }, evidenceRefs: [{ ref: source.ref, blockId: 'body', start: 0, end: text.length, quote: text }] });
  const review = reviewCoreFacts({ candidates: [candidate], sources: [source], snapshot: state, policy: {} });
  const applied = applyCoreGroups(state, buildCoreActions(review, state).groups, { ruleVersion: 'test', storyNodes: [] });
  expect(applied.state.records.find(row => row.entityId === npc.entityId)?.value).toMatchObject({ affinity: 10, matureArchive: null });
});

it.each(['安柏没有亲吻云。', '安柏打算明天亲吻云。', '安柏和丽莎一起拥抱了云。'])('does not create a fixed reward from an unrealized or ambiguous interaction: %s', text => {
  const seed = makeSeed(), amber = seed.records.find(row => row.domain === 'npc')!;
  if (amber.domain !== 'npc') throw Error('fixture');
  seed.records.push({ ...structuredClone(amber), entityId: 'npc-lisa', value: { ...structuredClone(amber.value), id: 'npc-lisa', 姓名: '丽莎' } });
  expect(deriveCoreRelationshipCandidates([makeSource({ scope: seed.head.scope, blocks: [{ blockId: 'body', kind: 'narration', text }] })], { head: seed.head, records: seed.records, contentRefs: [] })).toEqual([]);
});
