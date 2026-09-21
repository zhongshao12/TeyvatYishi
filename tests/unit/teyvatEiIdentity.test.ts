import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NPC_AFFINITY_DEAREST_FRIEND_THRESHOLD } from '@/models/npc';
import { matchCanonical } from '@/data/canonicalCharacters';
import { 归一化NPC记录列表 } from '@/models/npc';
import { TEYVAT_AVATAR_SETS } from '@/data/teyvatAvatarRegistry.generated';
import { getDefaultBuiltinAvatar } from '@/data/builtinAvatars';
import { findBundledCodexIdentity, resolveBundledCodexIdentity } from '@/data/codexIdentityRegistry';
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

/**
 * 影的独立人格由**图鉴词条**承载。
 * 关键约束：词条必须追加在预设末尾（`resolveBundledCodexIdentity` 按 sourceIndex 对齐注册表，
 * 中间插入会让后面所有角色身份错位），并且「角色:影」这个关键词必须从雷电将军身上摘掉 ——
 * 否则补档匹配会把影的档案套上雷电将军的人格。
 */
const preset = JSON.parse(
  readFileSync('public/codex-presets/teyvat-characters-core.json', 'utf8'),
) as { entries: Array<Record<string, any>> };

const codexEntry = (name: string, tags: string[], personality: string) => ({
  id: `codex_${name}`, category: 'character', name, description: '', unlockedAtTurn: 0,
  tags, summary: `${name}的资料`, sourceText: '', source: '', keywords: tags, triggerKeywords: [],
  injection: { type: 'character' as const, personalityAndBehavior: personality },
  runtimeUnlock: { status: '', note: '' },
  usage: { narrative: true, courier: false, steambird: false, variables: false },
  importance: 5, linkable: true,
});

describe('影 的图鉴词条（独立人格）', () => {
  it('ships its own character entry with an independent personality', () => {
    const ei = preset.entries.find((entry) => entry.标题 === '影');
    const raiden = preset.entries.find((entry) => entry.标题 === '雷电将军');

    expect(ei?.分类).toBe('character');
    expect(ei?.注入内容.独立人格与行为).toContain('内省');
    expect(ei?.注入内容.独立人格与行为).not.toBe(raiden?.注入内容.独立人格与行为);
    expect(ei?.关键词).toContain('角色:影');
    expect(raiden?.关键词).not.toContain('角色:影');
    expect(raiden?.原文).not.toContain('别名：Raiden Shogun、巴尔泽布、影');
  });

  it('keeps the identity registry index-aligned with the preset', () => {
    const eiIndex = preset.entries.findIndex((entry) => entry.标题 === '影');

    expect(eiIndex).toBe(110);
    expect(resolveBundledCodexIdentity('codex_teyvat_characters_core', eiIndex, 'codex_teyvat_character_111', '影')?.id).toBe('JS-110');
    // 已有条目的下标未被打乱。
    expect(resolveBundledCodexIdentity('codex_teyvat_characters_core', 43, 'codex_teyvat_character_44', '雷电将军')?.id).toBe('JS-043');
    expect(findBundledCodexIdentity('codex_teyvat_character_111')?.sourceTitle).toBe('影');
  });

  it('applies the Ei entry personality instead of the Shogun one', () => {
    // 用**真实预设**构造图鉴：只要雷电将军的词条还认领「角色:影」，
    // 影的档案就会被套上雷电将军的人格（这条用例就是为此设的）。
    const codex = {
      entries: preset.entries
        .filter((entry) => entry.分类 === 'character')
        .map((entry) => ({
          id: entry.id, category: 'character', name: entry.标题, description: '', unlockedAtTurn: 0,
          tags: [...(entry.关键词 ?? [])], summary: entry.摘要 ?? '', sourceText: '', source: '',
          keywords: [], triggerKeywords: [],
          injection: {
            type: 'character' as const,
            personalityAndBehavior: entry.注入内容?.独立人格与行为,
            appearanceAnchor: entry.注入内容?.外貌锚点,
            speechStyle: entry.注入内容?.说话方式,
          },
          runtimeUnlock: { status: '', note: '' },
          usage: { narrative: true, courier: false, steambird: false, variables: false },
          importance: Number(entry.重要度) || 5,
          linkable: entry.可用于联动 !== false,
        })),
    } as never;
    const result = enrichNpcArchives(
      [{ id: 'npc_ei', 姓名: '影', 阶位: 'companion', 好感度: 0, 关系: 'stranger', 同行: false, 初见回合: 1, 最近回合: 1, 备注: [] }],
      { nsfwEnabled: false, maleNsfwArchiveEnabled: false, codex },
    );

    // 逐字对齐影词条的人格文本；若匹配到雷电将军的词条，这里会变成另一段文字。
    const eiPersonality = preset.entries.find((entry) => entry.标题 === '影')?.注入内容.独立人格与行为;
    expect(result.records[0]?.性格).toBe(eiPersonality);
    expect(result.records[0]?.性格).not.toBe(
      preset.entries.find((entry) => entry.标题 === '雷电将军')?.注入内容.独立人格与行为,
    );
  });
});
