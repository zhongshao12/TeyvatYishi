import { describe, expect, it } from 'vitest';
import { mapTeyvatNpcsToLegacy, applyLegacyNpcRecords } from '@/hooks/useGameState';
import { createEmptyTeyvatGameState, normalizeTeyvatGameState } from '@/models/teyvat/state';
import { normalizeTeyvatNpcRecords } from '@/models/teyvat/character';
import { displayFirstPartner, migrateLegacyFirstPartner } from '@/utils/npcFirstPartner';

function oldSave(partner: string | undefined, status: 'virgin' | 'not_virgin' | 'unknown' = 'not_virgin') {
  const game = createEmptyTeyvatGameState();
  game.旅行者.姓名 = '云';
  game.NPC = normalizeTeyvatNpcRecords([{
    id: 'npc_lisa', 姓名: '丽莎', gender: '女', roleTier: 'companion',
    matureArchive: {
      enabled: true, ageConfirmation: 'adult', ageConfirmationSource: 'canonical',
      virginityStatus: status, firstSexualPartner: partner, experiences: ['图书馆初遇'],
    },
  }]);
  return game;
}

describe('NPC 首次对象与旧档迁移', () => {
  it('backfills_only_adult_not_virgin_missing_partner exactly once on load', () => {
    const loaded = normalizeTeyvatGameState(oldSave('无'));
    const archive = loaded.NPC[0]?.matureArchive;
    expect(archive?.firstSexualPartnerRef).toBe('player');
    expect(archive?.firstSexualPartnerSource).toBe('legacy_assumed');
    expect(archive?.experiences).toEqual(['图书馆初遇', '旧档推定，具体回合未知']);
    expect(normalizeTeyvatGameState(loaded).NPC[0]?.matureArchive).toEqual(archive);
  });

  it('keeps a named non-player partner and a virgin or unknown status unchanged', () => {
    const named = normalizeTeyvatGameState(oldSave('凯亚')).NPC[0]?.matureArchive;
    expect(named?.firstSexualPartner).toBe('凯亚');
    expect(named?.firstSexualPartnerRef).toBeUndefined();
    for (const status of ['virgin', 'unknown'] as const) {
      const archive = normalizeTeyvatGameState(oldSave('无', status)).NPC[0]?.matureArchive;
      expect(archive?.firstSexualPartnerRef).toBeUndefined();
      expect(archive?.virginityStatus).toBe(status);
    }
  });

  it('round-trips a player identity without persisting the current display name', () => {
    const loaded = normalizeTeyvatGameState(oldSave('玩家'));
    const legacy = mapTeyvatNpcsToLegacy(loaded);
    expect(legacy[0]?.NSFW档案?.首次性行为对象引用).toBe('player');
    const rebuilt = applyLegacyNpcRecords(loaded, legacy);
    expect(rebuilt.NPC[0]?.matureArchive?.firstSexualPartnerRef).toBe('player');
    expect(rebuilt.NPC[0]?.matureArchive?.firstSexualPartner).not.toBe('云');
  });

  it('player_rename_changes_display_not_storage for a legacy record', () => {
    const loaded = normalizeTeyvatGameState(oldSave('无'));
    const legacy = mapTeyvatNpcsToLegacy(loaded)[0]!;
    expect(displayFirstPartner(legacy.NSFW档案, '云')).toBe('云');
    expect(displayFirstPartner(legacy.NSFW档案, '新名字')).toBe('新名字');
    expect(migrateLegacyFirstPartner(legacy, '新名字')).toBe(legacy);
    expect(legacy.NSFW档案?.首次性行为对象).toBeUndefined();
  });

  it('does not replace a preexisting narrative provenance with a legacy assumption', () => {
    const game = oldSave(undefined);
    game.NPC[0]!.matureArchive!.firstSexualPartnerSource = 'narrative';
    const archive = normalizeTeyvatGameState(game).NPC[0]?.matureArchive;
    expect(archive?.firstSexualPartnerSource).toBe('narrative');
    expect(archive?.firstSexualPartnerRef).toBeUndefined();
  });
});
