import type { CourierDeliverySeed, CourierSystem } from '@/models/teyvat/courier';
import { deliverDueCourierSeeds, type CourierDeliveryContext } from '@/services/ai/courierService';

export type { CourierDeliveryContext };

export interface ScheduledCourierResult {
  next: CourierSystem;
  due: CourierDeliverySeed[];
}

/**
 * 把到期种子投递进收件夹（自动建档、单人单窗口、来信由种子改写生成）。
 * 透传 CourierDeliveryContext 后由 services/ai/courierService 完成投递。
 */
export function processScheduledCourierSeeds(
  system: CourierSystem,
  currentTurn: number,
  now = Date.now(),
  context: CourierDeliveryContext = {},
): ScheduledCourierResult {
  return deliverDueCourierSeeds(system, currentTurn, now, context);
}
