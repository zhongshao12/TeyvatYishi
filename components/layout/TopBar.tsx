import { CLIP_CARD, CLIP_MEDIUM, CLIP_SECTION, insetRing } from '@/styles/clipPaths';
import { memo, useState } from 'react';
import type { 世界状态 } from '@/models/world';
import type { 主题预设, API设置 } from '@/models/settings';
import type { SteambirdNews } from '@/models/teyvat';
import { 天气Emoji映射, 天气名映射 } from '@/data/weatherRules';
import { parseGameClock } from '@/utils/gameClock';
import type { SaveStatusSnapshot } from '@/utils/saveStatus';

interface TopBarProps {
  worldState: 世界状态;
  currentTheme: 主题预设;
  onHome: () => void;
  steambird: SteambirdNews;
  onOpenSteambird?: () => void;
  apiSettings: API设置;
  onApiSettingsChange: (s: API设置) => void;
  saveStatus: SaveStatusSnapshot;
  onRetrySave?: () => void;
}

const clip10 =
  CLIP_CARD;

const clip12 =
  CLIP_SECTION;

export const TopBar = memo(function TopBar({ worldState, onHome, steambird, saveStatus, onRetrySave }: TopBarProps) {
  const [mobileCollapsed, setMobileCollapsed] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const dateText = worldState.当前日期?.trim() || '日期未设定';
  const timeText = formatClock(worldState.当前时间) || '时间未设定';
  const locationText = worldState.当前地点?.trim() || '地点未设定';
  const dayText = `第 ${Math.max(1, worldState.旅程天数 || 1).toString().padStart(2, '0')} 日`;
  const saveText = formatSaveStatus(saveStatus);
  const saveTone = saveStatus.phase === 'failed' || saveStatus.hadFailure
    ? 'var(--journal-antique-gold-soft)'
    : saveStatus.phase === 'saved' ? 'var(--journal-travel-green)' : 'rgba(var(--tj-text-secondary), 0.92)';

  const weatherId = worldState.当前天气;
  const weatherDisplay = weatherId ? (
    <span className="flex min-w-0 items-center gap-1 whitespace-nowrap">
      <span className="text-[13px]">{天气Emoji映射[weatherId] ?? '🌤️'}</span>
      <span className="truncate text-[11px]" style={{ color: 'rgba(var(--tj-text-secondary), 0.82)' }}>
        {天气名映射[weatherId] ?? weatherId}
      </span>
    </span>
  ) : null;

  const headlines = buildHeadlines(steambird);

  return (
    <>
      {/* ===== 移动端悬浮面板（不变） ===== */}
      <div className="journal-mobile-status fixed left-2 top-[calc(var(--app-safe-top,0px)+10px)] z-30 flex items-start gap-2 md:hidden">
        <button
          type="button"
          onClick={() => {
            setMobileCollapsed((current) => !current);
            setMobileExpanded(false);
          }}
          className="journal-focus-target flex h-11 w-11 items-center justify-center text-sm transition-all"
          style={{
            color: 'var(--journal-antique-gold-soft)',
            background: 'rgba(var(--tj-surface), 0.88)',
            boxShadow: 'inset 0 0 0 1px rgba(var(--tj-accent-primary), 0.34), 0 10px 28px rgba(var(--tj-shadow), 0.28)',
            clipPath: clip10,
          }}
          aria-label={mobileCollapsed ? '展开状态栏' : '收起状态栏'}
        >
          {mobileCollapsed ? '>' : '<'}
        </button>

        {!mobileCollapsed && (
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => setMobileExpanded((current) => !current)}
              className="journal-focus-target min-h-11 max-w-[calc(100vw-96px)] px-3 py-2 text-left transition-all"
              style={{
                color: 'rgb(var(--tj-text-primary))',
                background: 'rgba(var(--tj-surface), 0.90)',
                boxShadow: 'inset 0 0 0 1px rgba(var(--tj-accent-primary), 0.3), 0 12px 30px rgba(var(--tj-shadow), 0.28)',
                clipPath: clip10,
              }}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 font-mono text-[11px] font-bold tracking-[0.14em]" style={{ color: 'rgb(var(--tj-text-primary))' }}>
                  {dayText}
                </span>
                <span className="shrink-0 text-[11px]" style={{ color: 'var(--journal-travel-green)' }}>
                  {timeText}
                </span>
                <span className="min-w-0 truncate text-[11px]" style={{ color: 'rgba(var(--tj-text-secondary), 0.92)' }}>
                  {locationText}
                </span>
              </div>
              <span className="block truncate text-xs" style={{ color: saveTone }} aria-live="polite">{saveText}</span>
            </button>

            {mobileExpanded && (
              <div
                className="max-w-[min(78vw,320px)] space-y-2 px-3 py-3 text-xs"
                style={{
                  color: 'rgba(var(--tj-text-primary), 0.92)',
                  background: 'rgba(var(--tj-surface), 0.94)',
                  boxShadow: 'inset 0 0 0 1px rgba(var(--tj-accent-primary), 0.26), 0 16px 36px rgba(var(--tj-shadow), 0.32)',
                  clipPath: clip12,
                }}
              >
                <MobileDetail label="日期" value={dateText} />
                <MobileDetail label="时间" value={timeText} />
                <MobileDetail label="地点" value={locationText} />
                <MobileDetail label="旅途" value={dayText} />
                <MobileDetail label="存档" value={saveText} />
                {saveStatus.phase === 'failed' && onRetrySave && (
                  <button type="button" onClick={onRetrySave} className="journal-focus-target min-h-11 w-full px-3 py-2 text-left" style={{ color: saveTone, boxShadow: insetRing(0.28) }}>
                    重试保存
                  </button>
                )}
                <button
                  type="button"
                  onClick={onHome}
                  className="mt-1 w-full px-3 py-2 font-serif text-[11px] tracking-[0.18em]"
                  style={{
                    color: 'rgba(var(--tj-accent-primary), 0.92)',
                    background: 'rgba(var(--tj-accent-primary), 0.08)',
                    boxShadow: insetRing(0.28),
                    clipPath: CLIP_MEDIUM,
                  }}
                >
                  返回首页
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ===== 桌面端顶栏：蒸汽鸟报底层 + 日期芯片上层 ===== */}
      <div
        className="teyvat-topbar journal-topbar relative hidden items-center overflow-hidden px-5 py-2.5 text-sm md:grid"
        style={{
          gridTemplateColumns: 'minmax(160px, 1fr) auto minmax(160px, 1fr)',
        }}
      >

        {/* ── 上层：左列品牌 ── */}
        <button
          onClick={onHome}
          className="journal-focus-target relative z-10 flex min-h-11 items-center gap-2.5 transition-opacity hover:opacity-80 justify-self-start"
          aria-label="返回旅途首页"
        >
          <span className="text-base" style={{ color: 'rgba(var(--tj-accent-primary), 0.75)' }}>+</span>
          <span
            className="font-serif font-bold tracking-[0.25em]"
            style={{
              background: 'linear-gradient(180deg, rgb(var(--tj-text-primary)) 0%, rgb(var(--tj-accent-primary)) 60%, rgb(var(--tj-accent-secondary)) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            旅行者纪事
          </span>
        </button>

        {/* ── 上层：中列日期芯片（浮在蒸汽鸟报上方） ── */}
        <div className="relative z-10 justify-self-center">
          <div
            className="flex max-w-[min(56vw,720px)] items-center gap-2 px-3 py-1.5"
            style={{
              background: 'linear-gradient(90deg, rgba(var(--tj-bg-primary), 0.92), rgba(var(--tj-surface-bg-start), 0.88), rgba(var(--tj-bg-primary), 0.92))',
              boxShadow: 'inset 0 1px 0 rgba(var(--tj-accent-primary), 0.22), inset 0 -1px 0 rgba(var(--tj-accent-primary), 0.18)',
            }}
          >
            <TimeChip label="日期" value={dateText} tone="bright" />
            <Divider />
            <TimeChip label="时间" value={timeText} />
            <Divider />
            {weatherDisplay}
            <Divider />
            <TimeChip label="地点" value={locationText} wide />
          </div>
        </div>

        {/* ── 上层：右列旅途日数徽章 ── */}
        <div className="relative z-10 flex flex-col items-end gap-1 justify-self-end">
          <div
            className="flex items-baseline gap-2 px-3 py-1"
            style={{
              background: 'rgba(var(--tj-bg-primary), 0.9)',
              boxShadow: insetRing(0.28),
              clipPath: CLIP_MEDIUM,
            }}
            title="冒险天数"
          >
            <span className="font-serif text-[10px] tracking-[0.22em]" style={{ color: 'rgba(var(--tj-text-secondary), 0.78)' }}>
              旅途
            </span>
            <span className="font-mono text-[13px] font-bold tracking-[0.14em]" style={{ color: 'rgb(var(--tj-text-primary))' }}>
              {dayText}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs" style={{ color: saveTone }} aria-live="polite" aria-label="存档状态">
            <span>{saveText}</span>
            {saveStatus.phase === 'failed' && onRetrySave && (
              <button type="button" onClick={onRetrySave} className="journal-focus-target min-h-8 px-2 underline underline-offset-2">
                重试保存
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
});

function formatSaveStatus(status: SaveStatusSnapshot): string {
  const kind = status.source === 'manual' ? '手动' : status.source === 'auto' ? '自动' : '';
  if (status.phase === 'unsaved') return '有未保存更改';
  if (status.phase === 'failed') return `${kind}保存失败`;
  if (status.phase === 'saving') return status.hadFailure ? '保存失败 · 正在重试' : `正在${kind}保存`;
  const time = status.savedAt && Number.isFinite(status.savedAt)
    ? ` · ${new Date(status.savedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
    : '';
  return status.source === 'loaded' ? `已读取存档${time}` : `${kind}存档已保存${time}`;
}

// ---- helpers ----

function MobileDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[52px_minmax(0,1fr)] gap-2">
      <span className="font-serif tracking-[0.18em]" style={{ color: 'rgba(var(--tj-accent-primary), 0.72)' }}>
        {label}
      </span>
      <span className="min-w-0 truncate" title={value}>
        {value}
      </span>
    </div>
  );
}

function TimeChip({
  label,
  value,
  tone = 'normal',
  wide = false,
}: {
  label: string;
  value: string;
  tone?: 'normal' | 'bright';
  wide?: boolean;
}) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
      <span
        className="font-serif text-[11px] tracking-[0.18em]"
        style={{ color: tone === 'bright' ? 'rgba(var(--tj-accent-primary), 0.92)' : 'rgba(var(--tj-text-secondary), 0.82)' }}
      >
        {label}
      </span>
      <span
        className={`${wide ? 'max-w-[220px]' : 'max-w-[140px]'} truncate text-[12px]`}
        style={{ color: tone === 'bright' ? 'rgb(var(--tj-text-primary))' : 'rgba(var(--tj-text-primary), 0.92)' }}
        title={value}
      >
        {value}
      </span>
    </span>
  );
}

function Divider() {
  return <span className="shrink-0 text-[10px]" style={{ color: 'rgba(var(--tj-accent-primary), 0.34)' }}>-</span>;
}

function formatClock(value?: string | null): string {
  const raw = value?.trim();
  if (!raw) return '';
  const parsed = parseGameClock(raw);
  if (parsed) return parsed;
  const legacyMap: Record<string, string> = {
    清晨: '06:40',
    上午: '09:40',
    午后: '14:10',
    黄昏: '18:20',
    夜晚: '21:30',
    深夜: '00:30',
  };
  return legacyMap[raw] ?? raw;
}

function buildHeadlines(steambird: SteambirdNews): string[] {
  const items = Array.isArray(steambird.articles) ? steambird.articles : [];
  const rank = (s: string) => {
    if (s === 'ongoing') return 0;
    if (s === 'upcoming') return 1;
    return 2;
  };
  const sorted = [...items]
    .filter((article) => article.title?.trim())
    .sort((left, right) => rank(left.status) - rank(right.status));
  const seen = new Set<string>();
  return sorted
    .map((article) => article.title.trim())
    .filter((t) => {
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    })
    .slice(0, 12);
}
