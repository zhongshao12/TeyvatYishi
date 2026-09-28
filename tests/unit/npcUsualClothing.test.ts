import { describe, expect, it } from 'vitest';
import { createEmptyTeyvatGameState } from '@/models/teyvat/state';
import { normalizeTeyvatNpcRecords } from '@/models/teyvat/character';
import { factsToTeyvatDomainCommands, factsToVariableCommands } from '@/utils/variableFacts';
import { shouldReplaceUsualClothing } from '@/utils/npcUsualClothing';
import type { VariableState } from '@/utils/variableRegistry';
import { 创建空世界状态 } from '@/models/world';
import { 创建NPC记录 } from '@/models/npc';

const stateWithUsualClothing = () => {
  const state = createEmptyTeyvatGameState();
  state.NPC = normalizeTeyvatNpcRecords([{ id: 'npc_custom_1', 姓名: '阿明', gender: '女', clothing: '常穿的骑士制服' }]);
  return state;
};

describe('usual NPC clothing', () => {
  it('temporary_outfit_does_not_replace_usual_clothing', () => {
    expect(shouldReplaceUsualClothing('常穿的骑士制服', '临时披上斗篷', '今天为避雨临时换了斗篷。')).toBe(false);
    const commands = factsToTeyvatDomainCommands([{
      type: 'npc', id: 'npc_custom_1', name: '阿明', clothing: '斗篷', memory: '和旅人一起避雨，临时披上斗篷。', evidence: '阿明今天临时换上斗篷。',
    }], stateWithUsualClothing(), 2).commands;
    expect(commands.some((command) => command.path.endsWith('.clothing'))).toBe(false);
    expect(commands.some((command) => command.path.includes('sharedMemories'))).toBe(true);
    const legacyRecord = { ...创建NPC记录({ 姓名: '阿明', 阶位: 'companion', 初见回合: 1, 穿着: '常穿的骑士制服' }), id: 'npc_custom_1' };
    const legacy = factsToVariableCommands([{
      type: 'npc', id: 'npc_custom_1', name: '阿明', clothing: '斗篷', memory: '临时披上斗篷避雨。', evidence: '阿明今天临时换上斗篷。',
    }], { 世界: 创建空世界状态(), NPC: [legacyRecord] } as VariableState, 2).commands;
    expect(legacy.some((command) => command.key.endsWith('.穿着'))).toBe(false);
    expect(legacy.some((command) => command.key.includes('同行记忆'))).toBe(true);
  });

  it('explicit_permanent_change_updates_usual_clothing', () => {
    expect(shouldReplaceUsualClothing('常穿的骑士制服', '长袍', '阿明从此改穿长袍，成为新的常用装束。')).toBe(true);
    const commands = factsToTeyvatDomainCommands([{
      type: 'npc', id: 'npc_custom_1', name: '阿明', clothing: '长袍', evidence: '阿明从此改穿长袍，成为新的常用装束。',
    }], stateWithUsualClothing(), 2).commands;
    expect(commands).toContainEqual(expect.objectContaining({ action: 'set', path: expect.stringMatching(/\.clothing$/), value: '长袍' }));
  });

  it('manual changes and first known outfit remain possible', () => {
    expect(shouldReplaceUsualClothing('', '旅行披风', '初次见面')).toBe(true);
    expect(shouldReplaceUsualClothing('骑士制服', '旅行披风', '今天换装', true)).toBe(true);
  });
});
