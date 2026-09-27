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

describe('NPC 成年资格必须有独立可信来源', () => {
  it('accepts_trusted_adult_source: a listed canonical adult or explicit manual confirmation is eligible', () => {
    expect(resolveNpcAdultEligibility({ name: '安柏', canonicalBaselineAge: 'adult' }).confirmed).toBe(true);
    expect(resolveNpcAdultEligibility({
      name: '原创冒险家', ageConfirmation: 'adult', ageSource: 'manual',
    }).confirmed).toBe(true);
  });

  it('rejects_unverified_adult: a forged canonical source does not validate an unrelated custom name', () => {
    expect(resolveNpcAdultEligibility({
      name: '原创冒险家', ageConfirmation: 'adult', ageSource: 'canonical', canonicalBaselineAge: 'adult',
    }).confirmed).toBe(false);
    expect(resolveNpcAdultEligibility({
      name: '原创冒险家', ageConfirmation: 'adult', ageSource: 'legacy_unverified',
    }).confirmed).toBe(false);
  });

  it('rejects_minor_even_if_model_says_adult: protected identity and minor description override a manual flag', () => {
    expect(resolveNpcAdultEligibility({ name: '可莉', ageConfirmation: 'adult', ageSource: 'manual' }).confirmed).toBe(false);
    expect(resolveNpcAdultEligibility({
      name: '原创冒险家', description: '十岁的学徒', ageConfirmation: 'adult', ageSource: 'manual',
    }).confirmed).toBe(false);
  });

  it('rejects_unverified_adult: an unknown-age custom companion is not made adult by baseline enrichment', () => {
    const result = enrichNpcArchives([customNpc()], {
      nsfwEnabled: true, maleNsfwArchiveEnabled: false,
    }).records[0]!;

    expect(result.NSFW档案?.年龄确认).not.toBe('adult');
    expect(result.NSFW档案?.是否处女).toBeUndefined();
  });

  it('rejects_minor_even_if_model_says_adult: an archive fact cannot confirm its own subject age', () => {
    const state = createEmptyTeyvatGameState();
    state.NPC = normalizeTeyvatNpcRecords([{
      id: 'npc_custom_1', 姓名: '原创冒险家', gender: '女',
      说明: '在蒙德旅行的冒险家。', matureArchive: null,
    }]);

    const translated = factsToTeyvatDomainCommands([{
      type: 'nsfw_archive', npcId: 'npc_custom_1', npcName: '原创冒险家',
      ageConfirm: 'adult', virginityStatus: 'not_virgin',
      evidence: '原创冒险家出现在这次对话中。',
    }], state, 2);

    expect(translated.commands.some((command) => command.path.includes('matureArchive'))).toBe(false);
    expect(translated.warnings.join(' ')).toContain('成年');
  });
});
