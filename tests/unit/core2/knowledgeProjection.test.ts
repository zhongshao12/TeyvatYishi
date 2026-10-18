import { describe, expect, it } from 'vitest';
import { projectCoreKnowledge } from '@/core/knowledge/knowledgeProjection';
import { makeCommit, makeSeed } from './fixtures';

function setup(text: string, isPublic = false) {
  const seed = makeSeed(); const event = makeCommit(seed.head).events[0]!;
  event.actorIds = ['npc-amber']; event.targetIds = [seed.playerId]; event.visibility = { kind: isPublic ? 'public' : 'participants', npcIds: ['npc-amber'] };
  event.evidenceRefs[0]!.quote = text; event.evidenceRefs[0]!.end = text.length;
  return { event, state: { head: seed.head, records: seed.records, contentRefs: [] } };
}
describe('core2 evidence-based NPC knowledge', () => {
  it('does not grant knowledge through presence, travel membership, participant lists or public availability', () => {
    const { event, state } = setup('玩家在房间记录秘密，安柏在门外等候。');
    expect(projectCoreKnowledge([event], state)).toEqual([]);
    event.visibility.kind = 'public'; event.evidenceRefs[0]!.quote = '报纸刊登了事件。'; event.evidenceRefs[0]!.end = event.evidenceRefs[0]!.quote.length;
    expect(projectCoreKnowledge([event], state)).toEqual([]);
  });
  it.each([
    ['安柏亲眼看见玩家拿起苹果。', 'witnessed', 'fact'],
    ['安柏把一枚苹果交给玩家。', 'witnessed', 'fact'],
    ['玩家亲口告诉安柏，明天去璃月。', 'told', 'fact'],
    ['安柏读到了报纸上这则消息。', 'read_public', 'fact'],
    ['安柏听说玩家去了璃月。', 'rumor', 'belief'],
  ])('records evidence, learning time and mode: %s', (text, mode, nature) => {
    const { event, state } = setup(text, mode === 'read_public');
    expect(projectCoreKnowledge([event], state)).toMatchObject([{ npcId: 'npc-amber', eventId: event.eventId, mode, nature, learnedMoment: event.occurredMoment, evidenceRefs: event.evidenceRefs }]);
  });
  it('does not rewrite truth from a rumor or create knowledge for a negated or future witness', () => {
    const { event, state } = setup('安柏没有看见玩家拿苹果。'); const before = structuredClone(state);
    expect(projectCoreKnowledge([event], state)).toEqual([]);
    expect(state).toEqual(before);
    event.evidenceRefs[0]!.quote = '安柏准备读报纸。'; event.evidenceRefs[0]!.end = event.evidenceRefs[0]!.quote.length;
    expect(projectCoreKnowledge([event], state)).toEqual([]);
  });
  it('does not make manual edits into a shared historical experience', () => {
    const { event, state } = setup('玩家将安柏的档案外貌改为红色头发。'); event.type = 'player.edit_npc';
    expect(projectCoreKnowledge([event], state)).toEqual([]);
  });
  it('rejects a foreign branch instead of issuing cross-save knowledge', () => {
    const { event, state } = setup('安柏亲眼看见玩家拿起苹果。'); event.branchId = 'foreign';
    expect(() => projectCoreKnowledge([event], state)).toThrow('CORE2_KNOWLEDGE_SCOPE');
  });
  it('does not treat looking toward someone or a name inside a normal word as telling or witnessing', () => {
    const { event, state } = setup('玩家望向安柏，默默把苹果藏进包里。');
    expect(projectCoreKnowledge([event], state)).toEqual([]);
    const amber = state.records.find(r => r.domain === 'npc')!;
    if (amber.domain !== 'npc') throw Error('fixture');
    state.records.push({ ...structuredClone(amber), entityId: 'npc-jean', value: { ...structuredClone(amber.value), id: 'npc-jean', 姓名: '琴', aliases: [] } });
    event.evidenceRefs[0]!.quote = '琴声里，安柏亲眼看见玩家拿起苹果。'; event.evidenceRefs[0]!.end = event.evidenceRefs[0]!.quote.length;
    expect(projectCoreKnowledge([event], state).map(row => row.npcId)).toEqual(['npc-amber']);
    event.evidenceRefs[0]!.quote = '琴声里安柏亲眼看见玩家拿起苹果。'; event.evidenceRefs[0]!.end = event.evidenceRefs[0]!.quote.length;
    expect(projectCoreKnowledge([event], state).map(row => row.npcId)).toEqual(['npc-amber']);
  });
});
