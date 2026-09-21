import { describe, expect, it } from 'vitest';
import { NPC_AFFINITY_DEAREST_FRIEND_THRESHOLD } from '@/models/npc';
import { matchCanonical } from '@/data/canonicalCharacters';
import { 归一化NPC记录列表 } from '@/models/npc';
import { TEYVAT_AVATAR_SETS } from '@/data/teyvatAvatarRegistry.generated';
import { getDefaultBuiltinAvatar } from '@/data/builtinAvatars';
import { enrichNpcArchives } from '@/utils/npcArchiveEnrichment';

/**
 * 玩家要求：把「影」做成独立角色，头像等信息复用雷电将军。
 *
 * 关键约束：「影」原本是雷电将军的别名，留着就会在归一化时被合并成同一个人，
 * 玩家永远见不到独立的影。所以别名表必须拆开，同时雷电将军与 Raiden Shogun 仍要合并。
 */

describe('影 作为独立原著角色', () => {
  it('resolves 影 / 雷电影 to its own canonical identity', () => {
    expect(matchCanonical('影')?.name).toBe('影');
    expect(matchCanonical('雷电影')?.name).toBe('影');
    expect(matchCanonical('Raiden Ei')?.name).toBe('影');
  });

  it('keeps 雷电将军 and Raiden Shogun as one identity', () => {
    expect(matchCanonical('雷电将军')?.name).toBe('雷电将军');
    expect(matchCanonical('Raiden Shogun')?.name).toBe('雷电将军');
  });

  it('does not merge 影 into 雷电将军 when normalizing records', () => {
    const records = 归一化NPC记录列表([
      { id: 'npc_raiden', 姓名: '雷电将军', 阶位: 'companion', 好感度: 20, 关系: 'acquaintance', 同行: false, 初见回合: 1, 最近回合: 2, 备注: [] },
      { id: 'npc_ei', 姓名: '影', 阶位: 'companion', 好感度: 30, 关系: 'acquaintance', 同行: false, 初见回合: 3, 最近回合: 4, 备注: [] },
    ]);

    expect(records.map((record) => record.姓名).sort()).toEqual(['影', '雷电将军'].sort());
  });

  it('reuses 雷电将军 appearance so the two share one look', () => {
    expect(matchCanonical('影')?.appearance).toBe(matchCanonical('雷电将军')?.appearance);
    expect(matchCanonical('影')?.gender).toBe('女');
  });

  it('resolves a default avatar for 影 from the generated registry', () => {
    const set = TEYVAT_AVATAR_SETS.find((item) => item.canonicalName === '影');
    expect(set?.candidates[0]?.src).toContain('%E5%BD%B1');
    expect(getDefaultBuiltinAvatar('影')).toBe(set?.candidates[0]?.src);
  });

  it('enriches 影 with its own archive baseline', () => {
    const result = enrichNpcArchives(
      [{ id: 'npc_ei', 姓名: '影', 阶位: 'companion', 好感度: 0, 关系: 'stranger', 同行: false, 初见回合: 1, 最近回合: 1, 备注: [] }],
      { nsfwEnabled: true, maleNsfwArchiveEnabled: false },
    );

    expect(result.records[0]).toMatchObject({ 原著角色: true, 阶位: 'companion' });
    expect(result.records[0]?.介绍).toContain('雷电将军');
  });

  it('keeps the 生死挚友 threshold unrelated to this identity split', () => {
    expect(NPC_AFFINITY_DEAREST_FRIEND_THRESHOLD).toBe(100);
  });
});
