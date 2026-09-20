export interface 通知设置 {
  enabled: boolean;
  events: { courier: boolean; steambird: boolean; image: boolean; quest: boolean };
  quietStartHour?: number;
  quietEndHour?: number;
}

export const DEFAULT_NOTIFICATION_SETTINGS: 通知设置 = {
  enabled: true,
  events: { courier: true, steambird: true, image: true, quest: true },
  quietStartHour: 23,
  quietEndHour: 8,
};

export type 通知事件类型 = keyof 通知设置["events"];

export function 归一化通知设置(input: unknown): 通知设置 {
  const raw = isRecord(input) ? input : {};
  const events = isRecord(raw.events) ? raw.events : {};
  const readFlag = (formal: string, historical: string, fallback: boolean): boolean => (
    typeof events[formal] === 'boolean'
      ? events[formal] as boolean
      : typeof events[historical] === 'boolean'
        ? events[historical] as boolean
        : fallback
  );
  const readHour = (key: 'quietStartHour' | 'quietEndHour', fallback: number): number => (
    Number.isFinite(Number(raw[key])) ? Math.max(0, Math.min(23, Math.trunc(Number(raw[key])))) : fallback
  );
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_NOTIFICATION_SETTINGS.enabled,
    events: {
      courier: readFlag('courier', 'phone', DEFAULT_NOTIFICATION_SETTINGS.events.courier),
      steambird: readFlag('steambird', 'news', DEFAULT_NOTIFICATION_SETTINGS.events.steambird),
      image: readFlag('image', 'image', DEFAULT_NOTIFICATION_SETTINGS.events.image),
      quest: readFlag('quest', 'quest', DEFAULT_NOTIFICATION_SETTINGS.events.quest),
    },
    quietStartHour: readHour('quietStartHour', DEFAULT_NOTIFICATION_SETTINGS.quietStartHour ?? 23),
    quietEndHour: readHour('quietEndHour', DEFAULT_NOTIFICATION_SETTINGS.quietEndHour ?? 8),
  };
}

const lastNotifyAt: Record<string, number> = {};

export function isQuietTime(settings: 通知设置, now = new Date()): boolean {
  const start = settings.quietStartHour ?? 23;
  const end = settings.quietEndHour ?? 8;
  const hour = now.getHours();
  if (start <= end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

export function isNotificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (!isNotificationSupported()) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    const permission = await Notification.requestPermission();
    return permission === "granted";
  } catch {
    return false;
  }
}

/** 按设置触发通知：总开关、事件开关、静默时段、同类型冷却。桌面端仅 Web Notification。 */
export function notifyEvent(
  settings: 通知设置,
  type: 通知事件类型,
  title: string,
  body?: string,
  cooldownMs = 60000,
): void {
  if (!settings.enabled || !settings.events[type]) return;
  if (isQuietTime(settings)) return;
  const now = Date.now();
  if (now - (lastNotifyAt[type] ?? 0) < cooldownMs) return;
  lastNotifyAt[type] = now;
  void ensureNotificationPermission().then((ok) => {
    if (!ok) return;
    try {
      new Notification(title, { body });
    } catch {
      // 通知创建失败不影响游戏流程
    }
  });
}
import { isRecord } from '@/utils/valueGuards';
