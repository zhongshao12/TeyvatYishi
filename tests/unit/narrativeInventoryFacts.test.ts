import { expect, it } from 'vitest';
import type { TeyvatItem } from '@/models/teyvat/items';
import type { 变量事实 } from '@/models/variableCommand';
import { createEmptyTeyvatGameState, type TeyvatGameState } from '@/models/teyvat';
import { commitTeyvatTurn } from '@/services/teyvatTurnTransaction';
import { deriveNarrativeInventoryGainFacts, deriveNarrativeInventoryRemovalFacts, factsToTeyvatDomainCommands, mergeNarrativeInventoryFacts } from '@/utils/variableFacts';

const potion: TeyvatItem = {
  id: 'item_potion', category: 'food', name: '药剂', description: '', quantity: 2, rarity: 1, obtainedAtTurn: 1,
};

it('derives a named fruit that the player actually receives', () => {
  const result = deriveNarrativeInventoryGainFacts('安柏递给你一枚日落果，你收下并放进背包。', []);
  expect(result.facts).toContainEqual(expect.objectContaining({
    type: 'item', action: 'gain', name: '日落果', category: 'food', rarity: 1, quantity: 1,
  }));
  expect(result.warnings).toEqual([]);
});

it('ignores an NPC-to-NPC handoff, mere observation and a refused receipt', () => {
  expect(deriveNarrativeInventoryGainFacts('安柏拿出一枚日落果递给琴。你在旁边看着。', []).facts).toEqual([]);
  expect(deriveNarrativeInventoryGainFacts('你看见桌上有一枚日落果。', []).facts).toEqual([]);
  expect(deriveNarrativeInventoryGainFacts('安柏递给你一枚日落果，但你没有收下。', []).facts).toEqual([]);
});

it('does not add hypothetical or negated handoffs to the backpack', () => {
  expect(deriveNarrativeInventoryGainFacts('如果安柏递给你一枚日落果，你会很开心。', []).facts).toEqual([]);
  expect(deriveNarrativeInventoryGainFacts('安柏没有递给你日落果。', []).facts).toEqual([]);
});

it('binds gained items to the receipt clause and keeps multiple received objects', () => {
  expect(deriveNarrativeInventoryGainFacts('你收下一枚苹果，看了一眼桌上的日落果。', []).facts.map((fact) => fact.name)).toEqual(['苹果']);
  expect(deriveNarrativeInventoryGainFacts('你收下一枚日落果和两枚苹果。', []).facts.map((fact) => [fact.name, fact.quantity]))
    .toEqual([['日落果', 1], ['苹果', 2]]);
});

it('warns instead of inventing an unknown weapon rarity', () => {
  const result = deriveNarrativeInventoryGainFacts('安柏递给你一把无名长剑，你收下。', []);
  expect(result.facts).toEqual([]);
  expect(result.warnings).toContain('背包结算待确认：无名长剑缺少可靠分类或星级');
});

it('consumes a player-owned potion in first person but not NPC or negated actions', () => {
  expect(deriveNarrativeInventoryRemovalFacts('我喝下一瓶药剂，空瓶留在桌上。', [potion]))
    .toContainEqual(expect.objectContaining({ action: 'consume', name: '药剂', quantity: 1 }));
  expect(deriveNarrativeInventoryRemovalFacts('我没有喝下药剂。', [potion])).toEqual([]);
  expect(deriveNarrativeInventoryRemovalFacts('丽莎喝下药剂，我在旁边看着。', [potion])).toEqual([]);
});

it('does not remove items for intended or hypothetical use', () => {
  expect(deriveNarrativeInventoryRemovalFacts('如果我喝下一瓶药剂，就能恢复精神。', [potion])).toEqual([]);
  expect(deriveNarrativeInventoryRemovalFacts('我打算喝下一瓶药剂。', [potion])).toEqual([]);
});

it('merges model and fallback gain once through the formal inventory transaction', () => {
  const body = '安柏递给你一枚日落果，你收下并放进背包。';
  const modelFacts: 变量事实[] = [{ type: 'item', action: 'gain', name: '日落果', category: 'food', rarity: 1, quantity: 1, evidence: body }];
  const derived = deriveNarrativeInventoryGainFacts(body, []).facts;
  const merged = mergeNarrativeInventoryFacts(modelFacts, derived);
  expect(merged.filter((fact) => fact.type === 'item' && fact.action === 'gain' && fact.name === '日落果')).toHaveLength(1);

  const initial = createEmptyTeyvatGameState();
  const commands = factsToTeyvatDomainCommands(merged, initial, 1);
  let committed: TeyvatGameState | null = null;
  const result = commitTeyvatTurn(initial, commands.commands, (next) => { committed = next; }, { trustedEvidence: [body], lenientEvidence: true });
  expect(result.status).toBe('committed');
  expect((committed as TeyvatGameState | null)?.背包.items).toEqual([expect.objectContaining({ name: '日落果', quantity: 1 })]);
});
