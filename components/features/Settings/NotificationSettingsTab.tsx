import type { 游戏设置 } from '@/models/settings';
import { DEFAULT_NOTIFICATION_SETTINGS, type 通知设置, type 通知事件类型 } from '@/utils/notifications';

interface NotificationSettingsTabProps {
  settings: 游戏设置;
  onChange: (s: 游戏设置) => void;
}

const smallClip = 'polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px)';

export function NotificationSettingsTab({ settings, onChange }: NotificationSettingsTabProps) {
  const current: 通知设置 = { ...DEFAULT_NOTIFICATION_SETTINGS, ...(settings.notificationSettings ?? {}), events: { ...DEFAULT_NOTIFICATION_SETTINGS.events, ...(settings.notificationSettings?.events ?? {}) } };
  const patch = (next: Partial<通知设置>) => onChange({ ...settings, notificationSettings: { ...current, ...next } });
  const eventLabels: Array<{ key: 通知事件类型; label: string }> = [
    { key: "courier", label: "手机消息" },
    { key: "steambird", label: "蒸汽鸟报发布" },
    { key: "image", label: "生图完成" },
    { key: "quest", label: "任务更新" },
  ];
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 px-3 py-2" style={{ boxShadow: "inset 0 0 0 1px rgba(var(--tj-accent-primary),0.16)", clipPath: smallClip }}>
        <div>
          <div className="text-sm" style={{ color: "rgb(var(--tj-text-primary))" }}>启用通知</div>
          <div className="text-[11px]" style={{ color: "rgba(var(--tj-text-secondary),0.7)" }}>Web 通知（桌面端同样走浏览器通知）</div>
        </div>
        <button type="button" onClick={() => patch({ enabled: !current.enabled })} className="px-3 py-1.5 text-xs" style={{ color: current.enabled ? "rgb(var(--tj-text-primary))" : "rgba(var(--tj-text-secondary),0.75)", background: current.enabled ? "rgba(var(--tj-accent-primary),0.16)" : "transparent", boxShadow: "inset 0 0 0 1px rgba(var(--tj-accent-primary),0.35)", clipPath: smallClip }}>{current.enabled ? "已开启" : "已关闭"}</button>
      </div>
      <div className="space-y-2">
        {eventLabels.map((item) => (
          <div key={item.key} className="flex items-center justify-between px-3 py-2" style={{ background: "rgba(var(--tj-bg-primary),0.45)", boxShadow: "inset 0 0 0 1px rgba(var(--tj-border),0.45)", clipPath: smallClip }}>
            <span className="text-xs" style={{ color: "rgba(var(--tj-text-secondary),0.88)" }}>{item.label}</span>
            <button type="button" onClick={() => patch({ events: { ...current.events, [item.key]: !current.events[item.key] } })} className="px-3 py-1 text-[11px]" style={{ color: current.events[item.key] ? "rgb(var(--tj-text-primary))" : "rgba(var(--tj-text-secondary),0.75)", background: current.events[item.key] ? "rgba(var(--tj-accent-primary),0.16)" : "transparent", boxShadow: "inset 0 0 0 1px rgba(var(--tj-accent-primary),0.3)", clipPath: smallClip }}>{current.events[item.key] ? "通知" : "静默"}</button>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 px-3 py-3" style={{ boxShadow: "inset 0 0 0 1px rgba(var(--tj-border),0.45)", clipPath: smallClip }}>
        <label className="block">
          <span className="mb-1 block text-[11px]" style={{ color: "rgba(var(--tj-text-secondary),0.75)" }}>静默开始（时）</span>
          <input type="number" min={0} max={23} value={current.quietStartHour ?? 23} onChange={(event) => patch({ quietStartHour: Math.max(0, Math.min(23, Number(event.target.value) || 0)) })} className="teyvat-input w-full px-3 py-2 text-sm" style={{ clipPath: smallClip }} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px]" style={{ color: "rgba(var(--tj-text-secondary),0.75)" }}>静默结束（时）</span>
          <input type="number" min={0} max={23} value={current.quietEndHour ?? 8} onChange={(event) => patch({ quietEndHour: Math.max(0, Math.min(23, Number(event.target.value) || 0)) })} className="teyvat-input w-full px-3 py-2 text-sm" style={{ clipPath: smallClip }} />
        </label>
      </div>
    </div>
  );
}
