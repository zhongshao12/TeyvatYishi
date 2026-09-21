/**
 * legacy NPC 稳定 id ↔ 原著角色中文名。
 *
 * 背景（第二轮审计 D3/S5）：这三份映射曾分别在 `utils/variableRegistry.ts`、
 * `utils/variableFacts.ts`、`utils/variableExecutor.ts` 各写一份（逐字相同的 10 条）——
 * 新增原著角色时漏改一处就会出现身份不一致（本轮拆「影」时正是先去核对这三处才敢动）。
 * 现在收敛为单一真源。
 */

/** legacy 稳定 id（已小写）→ 原著角色中文名。 */
export const LEGACY_NPC_ID_TO_CHINESE_NAME: Readonly<Record<string, string>> = Object.freeze({
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

/** legacy 选择器归一化：去掉 `npc_` / `npc-` 前缀并转小写。 */
export function normalizeLegacyNpcSelector(value: string): string {
  return value.replace(/^npc[_-]/i, '').toLowerCase();
}

/** 按 legacy 选择器查中文名；查不到返回 undefined（调用方自行决定兜底）。 */
export function readLegacyNpcNameFromSelector(value: string): string | undefined {
  return LEGACY_NPC_ID_TO_CHINESE_NAME[normalizeLegacyNpcSelector(value)];
}
