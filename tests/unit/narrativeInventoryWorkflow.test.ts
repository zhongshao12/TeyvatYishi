import { expect, it, vi } from 'vitest';
import { createEmptyTeyvatGameState, type TeyvatGameState } from '@/models/teyvat';
import { 创建默认游戏设置 } from '@/models/settings';
import { 创建空记忆系统 } from '@/models/memory';
import { callVariableModel } from '@/services/ai/variableModel';
import { runVariableSettlementWorkflow } from '@/hooks/useGame/variableSettlementWorkflow';

vi.mock('@/services/ai/variableModel', () => ({ callVariableModel: vi.fn() }));

const config = {
  id: 'main', name: '主模型', provider: 'openai_compatible' as const,
  baseUrl: 'https://invalid.example', apiKey: 'unused', model: 'test', createdAt: 1, updatedAt: 1,
};

async function settle(body: string, initial: TeyvatGameState) {
  vi.mocked(callVariableModel).mockResolvedValue({ rawText: '<变量事实>{"facts":[]}</变量事实>' });
  let committed: TeyvatGameState | null = null;
  const result = await runVariableSettlementWorkflow({
    mainApiConfig: config,
    currentGame: initial,
    settings: 创建默认游戏设置(),
    npcRecords: [],
    commitGame: (next) => { committed = next; return true; },
    userInput: '继续',
    body,
    turnAfter: 2,
    memorySystemSnapshot: 创建空记忆系统(),
    settlementId: 'narrative_inventory_test',
  });
  return { result, committed };
}

it('adds an explicitly received item when the variable model omits it', async () => {
  const { committed } = await settle('安柏递给你一枚日落果，你收下并放进背包。', createEmptyTeyvatGameState());
  expect((committed as TeyvatGameState | null)?.背包.items).toEqual([expect.objectContaining({ name: '日落果', quantity: 1 })]);
});

it('removes an explicitly consumed item when the variable model omits it', async () => {
  const initial = createEmptyTeyvatGameState();
  initial.背包.items = [{ id: 'item_potion', category: 'food', name: '药剂', description: '', quantity: 1, rarity: 1, obtainedAtTurn: 1 }];
  const { committed } = await settle('我喝下一瓶药剂，空瓶留在桌上。', initial);
  expect((committed as TeyvatGameState | null)?.背包.items).toEqual([]);
});

it('does not change inventory for hypothetical handoff or planned use', async () => {
  const initial = createEmptyTeyvatGameState();
  initial.背包.items = [{ id: 'item_potion', category: 'food', name: '药剂', description: '', quantity: 1, rarity: 1, obtainedAtTurn: 1 }];
  const { committed } = await settle('如果安柏递给你一枚日落果，你会很开心。我打算喝下一瓶药剂。', initial);
  expect((committed as TeyvatGameState | null)?.背包.items).toEqual(initial.背包.items);
});

it('commits both named items from one explicit handoff', async () => {
  const { committed } = await settle('你收下一枚日落果和两枚苹果。', createEmptyTeyvatGameState());
  expect((committed as TeyvatGameState | null)?.背包.items.map((item) => [item.name, item.quantity]))
    .toEqual([['日落果', 1], ['苹果', 2]]);
});
