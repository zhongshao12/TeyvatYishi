import { describe, expect, it } from 'vitest';
import { 创建空角色 } from '@/models/character';
import { 创建空记忆系统 } from '@/models/memory';
import { 创建NPC记录 } from '@/models/npc';
import { 创建默认游戏设置 } from '@/models/settings';
import { createEmptyTeyvatGameState, normalizeTeyvatGameState } from '@/models/teyvat/state';
import { 创建空世界状态 } from '@/models/world';
import { buildSystemPrompt } from '@/hooks/useGame/systemPromptBuilder';
import { applyLegacyNpcRecords, mapTeyvatNpcsToLegacy } from '@/hooks/useGameState';
import { archiveNpc, restoreNpc } from '@/services/npcArchiving';
import { enrichNpcArchives } from '@/utils/npcArchiveEnrichment';

function prompt(records: ReturnType<typeof 创建NPC记录>[]) {
  return buildSystemPrompt(创建空角色(), 创建空世界状态(), 创建空记忆系统(), 创建默认游戏设置(), 4,
    undefined, undefined, records).systemPrompt;
}

describe('companion archiving', () => {
  it('archived_party_member_leaves_active_prompt_but_keeps_history', () => {
    const record = {
      ...创建NPC记录({ 姓名: '阿明', 阶位: 'companion', 初见回合: 1, 原著角色: false }),
      id: 'npc_aming', 同行: true, 好感度: 48,
      同行记忆: [{ id: 'memory-1', 回合: 2, 摘要: '一起经过风起地。', 关联NPCID: [] }],
    };
    const archived = archiveNpc(record);
    expect(archived).toMatchObject({ id: record.id, 阶位: 'extra', 归档前阶位: 'companion', 已归档: true, 同行: false, 好感度: 48 });
    expect(archived.同行记忆).toBe(record.同行记忆);
    expect(archiveNpc(archived)).toBe(archived);
    expect(prompt([record])).toContain('阿明');
    expect(prompt([archived])).not.toContain('阿明');
  });

  it('restore_keeps_identity_without_rejoining_party', () => {
    const record = { ...创建NPC记录({ 姓名: '阿明', 阶位: 'companion', 初见回合: 1 }), id: 'npc_aming', 同行: true };
    const restored = restoreNpc(archiveNpc(record));
    expect(restored).toMatchObject({ id: record.id, 阶位: 'companion', 同行: false });
    expect(restored.已归档).not.toBe(true);
    expect(restoreNpc(restored)).toBe(restored);
  });

  it('same_name_and_legacy_roundtrip_isolated_by_id', () => {
    const first = { ...创建NPC记录({ 姓名: '阿明', 阶位: 'companion', 初见回合: 1 }), id: 'npc_a', 同行: true };
    const second = { ...创建NPC记录({ 姓名: '阿明', 阶位: 'extra', 初见回合: 1 }), id: 'npc_b' };
    const initial = createEmptyTeyvatGameState();
    initial.手机.contacts = [{ id: 'contact-a', npcId: 'npc_a', name: '阿明', available: true }];
    const saved = applyLegacyNpcRecords(initial, [archiveNpc(first), second]);
    const restored = normalizeTeyvatGameState(JSON.parse(JSON.stringify(saved)));
    const records = mapTeyvatNpcsToLegacy(restored);
    expect(records).toHaveLength(2);
    expect(records.find((npc) => npc.id === 'npc_a')).toMatchObject({ 已归档: true, 归档前阶位: 'companion', 阶位: 'extra', 同行: false });
    expect(records.find((npc) => npc.id === 'npc_b')).not.toHaveProperty('已归档', true);
    expect(restored.手机.contacts[0]).toMatchObject({ id: 'contact-a', npcId: 'npc_a' });
  });

  it('keeps a canonical archived character archived during profile enrichment', () => {
    const amber = { ...创建NPC记录({ 姓名: '安柏', 阶位: 'companion', 初见回合: 1, 原著角色: true }), id: 'npc_amber' };
    const archived = archiveNpc(amber);
    const enriched = enrichNpcArchives([archived], { nsfwEnabled: false, maleNsfwArchiveEnabled: false }).records[0]!;
    expect(enriched).toMatchObject({ id: 'npc_amber', 已归档: true, 阶位: 'extra', 原著角色: true });
  });
});
