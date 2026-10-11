import { expect, it } from 'vitest';
import { deriveNarrativeInventoryGainFacts, deriveNarrativeInventoryRemovalFacts, mergeNarrativeInventoryFacts, resolveTurnTimeFact } from '@/utils/variableFacts';
import { createEmptyTeyvatGameState, normalizeTeyvatGameState, normalizeTeyvatNpcRecords } from '@/models/teyvat';
import type { TeyvatItem } from '@/models/teyvat/items';

it.each([
  '安柏说：三天后我们会在蒙德重逢。你点头答应。',
  '如果两小时后雨停了，就可以出发。',
  '你回忆起三天后才会履行的约定。',
  '丽莎说：“现在是晚上八点了。”实际上你们仍在上午的课堂。',
  '安柏告诉你，三天后我们会在蒙德重逢。你点头答应。',
  '等两小时后雨停了，就可以出发。',
])('does not advance the world clock to a planned, conditional or quoted time: %s', (body) => {
  const result = resolveTurnTimeFact(body, '10:00').fact;
  expect(result?.mode).not.toBe('next_day');
  if (result?.mode === 'elapsed') expect(result.minutes).toBeLessThanOrEqual(15);
  if (result?.mode === 'set_time') expect(result.targetTime).not.toBe('20:00');
});
it('does not discard actual elapsed time spent on preparations', () => {
  expect(resolveTurnTimeFact('一个小时后，你完成了准备工作。', '10:00').fact).toMatchObject({ mode: 'elapsed', minutes: 60 });
});
it('rejects a hypothetical model evidence even when followed by unrelated actual narration', () => {
  const evidence = '如果两小时后雨停了，就可以出发。你点头答应。';
  const result = resolveTurnTimeFact(evidence, '10:00', { type: 'time', mode: 'elapsed', minutes: 120, evidence }).fact;
  expect(result?.mode !== 'elapsed' || (result.minutes ?? 0) <= 15).toBe(true);
});
it('recognizes actual time spent without requiring a 后 suffix', () => {
  expect(resolveTurnTimeFact('你花了两个小时完成准备工作。', '10:00').fact).toMatchObject({ mode: 'elapsed', minutes: 120 });
});
it.each(['两个小时后，你终于回忆起开门的口诀，打开石门。', '三天过去后，你回忆起过去，走出了山谷。'])('keeps actual elapsed time before a recollection: %s', body => {
  expect(resolveTurnTimeFact(body, '10:00').fact?.mode).not.toBeUndefined();
  expect(resolveTurnTimeFact(body, '10:00').fact).not.toBeNull();
});
it('still accumulates real elapsed narration', () => {
  expect(resolveTurnTimeFact('三天后，旅人走出山谷。两个小时后抵达城门。', '10:00').fact)
    .toMatchObject({ mode: 'elapsed', minutes: 4440 });
});

const apples: TeyvatItem[] = [{ id: 'apple', category: 'food', name: '苹果', description: '', quantity: 10, rarity: 1, obtainedAtTurn: 0 }];
it('accumulates separate receipt events without duplicating a model-owned receipt', () => {
  const derived = deriveNarrativeInventoryGainFacts('你收下两枚苹果。你收下三枚苹果。', apples).facts;
  expect(mergeNarrativeInventoryFacts([], derived)).toEqual([expect.objectContaining({ quantity: 5 })]);
  const model = { ...derived[0]!, quantity: 5 };
  expect(mergeNarrativeInventoryFacts([model], derived)).toEqual([model]);
});
it('removes all items with a postfix all quantity', () => {
  expect(deriveNarrativeInventoryRemovalFacts('你把苹果全部交给安柏。', apples))
    .toEqual([expect.objectContaining({ action: 'give', quantity: 10 })]);
});
it('keeps sentence fallbacks even if another sentence has a complete clause', () => {
  expect(deriveNarrativeInventoryRemovalFacts('你吃掉两枚苹果。旅行者取出苹果，交给安柏。', apples))
    .toEqual([expect.objectContaining({ action: 'consume', quantity: 2 }), expect.objectContaining({ action: 'give', quantity: 1 })]);
});
it('counts repeated actions joined without punctuation', () => {
  expect(deriveNarrativeInventoryRemovalFacts('你吃掉两枚苹果又吃掉三枚苹果。', apples))
    .toEqual([expect.objectContaining({ action: 'consume', quantity: 5 })]);
});
it.each([
  ['你吃掉两枚苹果，随后把剩下的苹果全部交给安柏。', 8],
  ['你吃掉两枚苹果，随后你取出三枚苹果，交给安柏。', 3],
] as const)('keeps the next action with an inherited actor/object: %s', (body, quantity) => {
  expect(deriveNarrativeInventoryRemovalFacts(body, apples)).toEqual([
    expect.objectContaining({ action: 'consume', quantity: 2 }), expect.objectContaining({ action: 'give', quantity }),
  ]);
});
it('accumulates repeated consumes but never exceeds the live quantity', () => {
  expect(deriveNarrativeInventoryRemovalFacts('你吃掉两枚苹果，随后你吃掉三枚苹果。', apples))
    .toEqual([expect.objectContaining({ action: 'consume', quantity: 5 })]);
});
it('keeps an unselected canonical sibling encountered after the opening', () => {
  const root = createEmptyTeyvatGameState();
  root.turnCount = 100;
  root.世界.原著旅行者 = '荧';
  root.NPC = normalizeTeyvatNpcRecords([{ id: 'npc_aether', 姓名: '空', canonical: true, roleTier: 'companion', firstSeenTurn: 100, lastSeenTurn: 100 }]);
  const next = normalizeTeyvatGameState(root);
  expect(next.NPC.map((npc) => npc.姓名)).toEqual(['空']);
});
