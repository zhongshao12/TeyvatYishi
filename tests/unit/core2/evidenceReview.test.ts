import { describe, expect, it } from 'vitest';
import { reviewCoreFacts } from '@/core/settlement/evidenceReview';
import { makeCandidate, makeSeed, makeSource } from './fixtures';
import type { FactProposal } from '@/core/contracts/state';

function setup(text: string, proposal: FactProposal = { kind: 'inventory', action: 'gain', itemId: 'apple', quantity: 2 }, actors = ['npc-amber']) {
  const seed = makeSeed();
  const source = makeSource({ scope: seed.head.scope, blocks: [{ blockId: 'b', kind: 'narration', text }] });
  const candidate = makeCandidate({ scope: source.scope, operationId: source.operationId, kind: proposal.kind, proposal, actors, targets: [seed.playerId], evidenceRefs: [{ ref: structuredClone(source.ref), blockId: 'b', start: 0, end: text.length, quote: text }] });
  return { candidates: [candidate], sources: [source], snapshot: { head: seed.head, records: seed.records, contentRefs: [] }, policy: {} };
}
describe('core2 evidence meaning, not merely a matching quote', () => {
  it.each(['安柏准备送两枚苹果给玩家。', '安柏没有送两枚苹果给玩家。', '安柏回忆曾送两枚苹果给玩家。', '安柏说：“明天送两枚苹果给玩家。”'])('does not settle unrealized or historical evidence: %s', text => {
    expect(reviewCoreFacts(setup(text)).verified).toEqual([]);
  });
  it.each([['两', 2], ['十二', 12], ['二十', 20], ['一百零一', 101]])('accepts completed player receipt with precise quantity %s', (quantity, count) => {
    const result = reviewCoreFacts(setup(`🙂安柏把${quantity}枚苹果放入玩家背包。`, { kind: 'inventory', action: 'gain', itemId: 'apple', quantity: count }));
    expect(result.verified).toHaveLength(1);
  });
  it('does not default a vague or missing quantity to one', () => {
    expect(reviewCoreFacts(setup('安柏送了几枚苹果给玩家。')).pending).toHaveLength(1);
    expect(reviewCoreFacts(setup('安柏把苹果放入玩家背包。')).pending).toHaveLength(1);
    expect(reviewCoreFacts(setup('安柏把十二枚苹果放入玩家背包。')).disputed).toHaveLength(1);
  });
  it('checks the true actor and recipient, not just the item keyword', () => {
    expect(reviewCoreFacts(setup('凯亚把两枚苹果放入玩家背包。')).rejected).toHaveLength(1);
    expect(reviewCoreFacts(setup('安柏把两枚苹果送给凯亚。')).verified).toEqual([]);
    const input = setup('安柏把两枚苹果放入玩家背包。', undefined, ['npc-nonexistent']);
    expect(reviewCoreFacts(input).pending).toHaveLength(1);
  });
  it('validates complete sentence context outside a cherry-picked quote', () => {
    const input = setup('安柏没有把两枚苹果放入玩家背包。');
    const ref = input.candidates[0]!.evidenceRefs[0]!;
    ref.start = 4; ref.quote = input.sources[0]!.blocks[0]!.text.slice(4); ref.end = input.sources[0]!.blocks[0]!.text.length;
    expect(reviewCoreFacts(input).verified).toEqual([]);
  });
  it('rejects source/scope mismatches and does not let player intent assert a world fact', () => {
    const input = setup('安柏把两枚苹果放入玩家背包。');
    input.candidates[0]!.evidenceRefs[0]!.ref.sourceVersion = 2;
    expect(reviewCoreFacts(input).rejected).toHaveLength(1);
    const player = setup('安柏把两枚苹果放入玩家背包。'); player.sources[0]!.kind = 'player_input';
    expect(reviewCoreFacts(player).pending).toHaveLength(1);
  });
  it('does not turn smiling into marriage or a temporary outfit into the usual clothing', () => {
    expect(reviewCoreFacts(setup('安柏朝玩家点头微笑。', { kind: 'relationship', npcId: 'npc-amber', affinityDelta: 5, relationship: '已婚' })).verified).toEqual([]);
    const clothes = setup('安柏临时换上礼服。', { kind: 'profile', npcId: 'npc-amber', field: 'clothing', value: '礼服' });
    const npc = clothes.snapshot.records.find(r => r.domain === 'npc')!;
    if (npc.domain === 'npc') npc.value.clothing = '骑士制服';
    // Fixed basics are no longer offered as an ambiguous automatic rewrite.
    expect(reviewCoreFacts(clothes).rejected).toHaveLength(1);
    expect(reviewCoreFacts(clothes).verified).toHaveLength(0);
  });
  it('leaves negated departure unchanged and preserves valid explicit departure', () => {
    expect(reviewCoreFacts(setup('安柏没有离开队伍。', { kind: 'npc', action: 'leave', npcId: 'npc-amber', name: '安柏' })).verified).toEqual([]);
    expect(reviewCoreFacts(setup('安柏离开了队伍。', { kind: 'npc', action: 'leave', npcId: 'npc-amber', name: '安柏' })).verified).toHaveLength(1);
  });
  it('does not let a spectator consume another person’s food or omit the subject entirely', () => {
    const watched = setup('玩家看着安柏吃下两枚苹果。', { kind: 'inventory', action: 'consume', itemId: 'apple', quantity: 2 });
    watched.candidates[0]!.actors = [watched.snapshot.records.find(r => r.domain === 'traveler')!.entityId];
    expect(reviewCoreFacts(watched).verified).toEqual([]);
    expect(reviewCoreFacts(setup('安柏把两枚苹果放入玩家背包。', undefined, [])).verified).toEqual([]);
  });
  it('records a promise made now without falsely completing the promised future activity', () => {
    const proposal: FactProposal = { kind: 'commitment', action: 'create', commitmentId: 'promise', text: '明天一起旅行', participantIds: ['npc-amber'] };
    expect(reviewCoreFacts(setup('安柏与玩家约定明天一起旅行。', proposal)).verified).toHaveLength(1);
    expect(reviewCoreFacts(setup('安柏与玩家约定明天一起旅行。', { ...proposal, action: 'fulfill' })).verified).toEqual([]);
  });
  it('binds a reliable introduction to a host-owned journey ID rather than the model ID', () => {
    const input = setup('一位女子来到玩家面前，自我介绍：“我叫丽莎。”', { kind: 'npc', action: 'meet', npcId: 'model-lisa', name: '丽莎' }, ['model-lisa']);
    const first = reviewCoreFacts(input).verified[0];
    expect(first).toBeDefined();
    expect(first?.proposal).toMatchObject({ kind: 'npc', name: '丽莎' });
    if (first?.proposal.kind !== 'npc') throw Error('fixture');
    expect(first.proposal.npcId).not.toBe('model-lisa');
    expect(first.actors).toEqual([first.proposal.npcId]);
    expect(reviewCoreFacts(input).verified[0]?.proposal).toEqual(first.proposal);
  });
});
