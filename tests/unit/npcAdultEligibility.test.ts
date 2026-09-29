import { describe, expect, it } from 'vitest';
import type { NPC记录 } from '@/models/npc';
import { createEmptyTeyvatGameState } from '@/models/teyvat/state';
import { normalizeTeyvatNpcRecords } from '@/models/teyvat/character';
import { enrichNpcArchives } from '@/utils/npcArchiveEnrichment';
import { factsToTeyvatDomainCommands } from '@/utils/variableFacts';
import { resolveNpcAdultEligibility } from '@/utils/npcAdultEligibility';

const customNpc = (patch: Partial<NPC记录> = {}): NPC记录 => ({
  id: 'npc_custom_1', 姓名: '原创冒险家', 阶位: 'companion', 好感度: 0,
  关系: 'stranger', 亲密关系: false, 同行: false, 初见回合: 1,
  最近回合: 1, 性别: '女', 介绍: '在蒙德旅行的冒险家。', 备注: [],
  原著角色: false, ...patch,
} as NPC记录);

describe('NPC 档案资格：只受三条硬闸约束', () => {
  it('accepts_trusted_adult_source: a listed canonical adult or explicit manual confirmation is eligible', () => {
    expect(resolveNpcAdultEligibility({ name: '安柏', canonicalBaselineAge: 'adult' }).confirmed).toBe(true);
    expect(resolveNpcAdultEligibility({
      name: '原创冒险家', ageConfirmation: 'adult', ageSource: 'manual',
    }).confirmed).toBe(true);
  });

  it('relaxes the age gate: an unverified or unknown-age custom name is eligible when no hard gate hits', () => {
    // 放宽契约：年龄来源（canonical 伪造 / legacy_unverified / 完全未知）不再是资格条件，
    // 只要未命中受保护名单、未成年证据与机械/非人形三条硬闸即可。
    expect(resolveNpcAdultEligibility({
      name: '原创冒险家', ageConfirmation: 'adult', ageSource: 'canonical', canonicalBaselineAge: 'adult',
    }).confirmed).toBe(true);
    expect(resolveNpcAdultEligibility({
      name: '原创冒险家', ageConfirmation: 'adult', ageSource: 'legacy_unverified',
    }).confirmed).toBe(true);
    expect(resolveNpcAdultEligibility({ name: '原创冒险家' }).confirmed).toBe(true);
  });

  it('rejects_minor_even_if_model_says_adult: protected identity and minor description override a manual flag', () => {
    expect(resolveNpcAdultEligibility({ name: '可莉', ageConfirmation: 'adult', ageSource: 'manual' }).confirmed).toBe(false);
    expect(resolveNpcAdultEligibility({
      name: '原创冒险家', description: '十岁的学徒', ageConfirmation: 'adult', ageSource: 'manual',
    }).confirmed).toBe(false);
  });

  it('builds a baseline for an unknown-age custom companion without promoting her age label', () => {
    const result = enrichNpcArchives([customNpc()], {
      nsfwEnabled: true, maleNsfwArchiveEnabled: false,
    }).records[0]!;

    expect(result.NSFW档案?.enabled).toBe(true);
    // 年龄确认只作展示信息：没有可信来源时保持 unknown，不伪造成 adult。
    expect(result.NSFW档案?.年龄确认).not.toBe('adult');
    expect(result.NSFW档案?.是否处女).toBe('是');
    expect(result.NSFW档案?.首次性行为对象).toBe('无');
  });

  it('accepts an nsfw_archive fact for a non-blocked subject but still refuses a minor-evidence subject', () => {
    const state = createEmptyTeyvatGameState();
    state.NPC = normalizeTeyvatNpcRecords([
      {
        id: 'npc_custom_1', 姓名: '原创冒险家', gender: '女',
        说明: '在蒙德旅行的冒险家。', matureArchive: null,
      },
      {
        id: 'npc_minor', 姓名: '小满', gender: '女',
        说明: '十岁的学徒', matureArchive: null,
      },
    ]);

    const fact = {
      type: 'nsfw_archive' as const, ageConfirm: 'adult' as const, virginityStatus: 'not_virgin' as const,
      evidence: '正文明确记录双方均为成年人且自愿建立了关系。',
    };

    const allowed = factsToTeyvatDomainCommands(
      [{ ...fact, npcId: 'npc_custom_1', npcName: '原创冒险家' }], state, 2,
    );
    expect(allowed.commands.some((command) => command.path.includes('matureArchive'))).toBe(true);

    const blocked = factsToTeyvatDomainCommands(
      [{ ...fact, npcId: 'npc_minor', npcName: '小满' }], state, 2,
    );
    expect(blocked.commands.some((command) => command.path.includes('matureArchive'))).toBe(false);
    expect(blocked.warnings.join(' ')).toContain('未成年');
  });
});
