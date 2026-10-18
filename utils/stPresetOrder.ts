import type { STPreset, STPresetOrder } from '@/models/stTypes';

/**
 * SillyTavern 的 prompt_order 允许同一预设保存多个 character_id 槽位。
 *
 * 常见导出形态（Reborn 2.4 等使用 SPreset 插件的预设最典型）：
 *   [{ character_id: 100000, order: [] }, { character_id: 100001, order: [52 项] }]
 * 100000 是插件留下的空壳槽位，真正可用的顺序在 100001。旧实现按
 * `prompt_order[0]` 或「命中 character_id 优先」取值，会把空槽位当成有效顺序，
 * 结果预设导入了、消息链却是空的（只在系统守卫里剩两条消息）。
 *
 * 规则：优先用请求的槽位，但只有它**确实有顺序项**时才算命中；否则依次回退到
 * 100001、第一个非空槽位、请求槽位本身、第一项。这样既保持显式选择，也不会被空壳槽位坑到。
 */
export function hasUsableSTOrder(order: STPresetOrder | null | undefined): boolean {
  return Boolean(order && Array.isArray(order.order) && order.order.length > 0);
}

export function resolveSTPresetOrder(
  preset: STPreset | null | undefined,
  characterId?: number | null,
): STPresetOrder | null {
  const orders = Array.isArray(preset?.prompt_order) ? preset!.prompt_order : [];
  if (orders.length === 0) return null;
  const requested = characterId === null || characterId === undefined
    ? undefined
    : orders.find((order) => order.character_id === characterId);
  if (hasUsableSTOrder(requested)) return requested!;
  const standard = orders.find((order) => order.character_id === 100001 && hasUsableSTOrder(order));
  if (standard) return standard;
  const firstUsable = orders.find((order) => hasUsableSTOrder(order));
  if (firstUsable) return firstUsable;
  return requested ?? orders[0] ?? null;
}

/** 启用（enabled !== false）的顺序项数量，用于导入提示与结构预览。 */
export function countEnabledSTOrderSlots(
  preset: STPreset | null | undefined,
  characterId?: number | null,
): number {
  const order = resolveSTPresetOrder(preset, characterId);
  if (!order) return 0;
  return order.order.filter((slot) => slot && slot.enabled !== false).length;
}
