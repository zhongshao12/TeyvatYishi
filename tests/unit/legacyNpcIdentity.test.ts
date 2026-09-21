import { describe, expect, it } from 'vitest';
import {
  LEGACY_NPC_ID_TO_CHINESE_NAME,
  normalizeLegacyNpcSelector,
  readLegacyNpcNameFromSelector,
} from '@/utils/legacyNpcIdentity';

/**
 * D3/S5：legacy id → 中文名 的映射曾有三份逐字副本
 * （variableRegistry / variableFacts / variableExecutor），现在收敛为单一真源。
 * 这里守住映射内容与前缀归一化语义，避免合并时悄悄改变解析结果。
 */

describe('legacy NPC 身份映射（单一真源）', () => {
  it('maps the ten legacy ids to their canonical Chinese names', () => {
    expect(LEGACY_NPC_ID_TO_CHINESE_NAME).toEqual({
      aether: '空',
      lumine: '荧',
      paimon: '派蒙',
      amber: '安柏',
      kaeya: '凯亚',
      lisa: '丽莎',
      jean: '琴',
      venti: '温迪',
      diluc: '迪卢克',
      barbara: '芭芭拉',
    });
  });

  it('normalizes the npc_ / npc- prefix and letter case', () => {
    expect(normalizeLegacyNpcSelector('npc_amber')).toBe('amber');
    expect(normalizeLegacyNpcSelector('NPC-KAEYA')).toBe('kaeya');
    expect(normalizeLegacyNpcSelector('lisa')).toBe('lisa');
  });

  it('resolves selectors to Chinese names and returns undefined for unknown ids', () => {
    expect(readLegacyNpcNameFromSelector('npc_amber')).toBe('安柏');
    expect(readLegacyNpcNameFromSelector('NPC-LISA')).toBe('丽莎');
    expect(readLegacyNpcNameFromSelector('npc_unknown_character')).toBeUndefined();
  });

  it('is frozen so a caller cannot mutate the shared table', () => {
    expect(Object.isFrozen(LEGACY_NPC_ID_TO_CHINESE_NAME)).toBe(true);
  });
});
