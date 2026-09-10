import type { 时段定义 } from '@/models/world';

// 时代预设已清空，等待提瓦特地区、元素与冒险场景预设接入。
export const timePeriodPresets: 时段定义[] = [];

export function getTimePeriodById(id: string): 时段定义 | undefined {
  return timePeriodPresets.find((p) => p.id === id);
}
