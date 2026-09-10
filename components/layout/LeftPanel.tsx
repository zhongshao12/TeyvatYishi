import { memo, useMemo, useState } from 'react';
import type { 角色数据结构 } from '@/models/character';
import type { 相册系统 } from '@/models/imageGeneration';
import type { ElementId } from '@/models/teyvat/elements';
import type { NPC记录 } from '@/models/npc';
import { 读取NPC头像 } from '@/models/npc';
import { getDefaultTravelerBuiltinAvatar } from '@/data/builtinAvatars';
import { ELEMENT_NAMES } from '@/styles/elementTokens';
import { 解析相册资源引用 } from '@/utils/albumActions';

// The bookmark is always a dark leather surface, even when the central page uses
// dark ink tokens. Keep its text palette independent from the paper palette.
const BOOKMARK_TEXT = '#f1e2bd';
const BOOKMARK_MUTED = '#d6bd8b';
const BOOKMARK_PANEL = 'rgba(24, 16, 12, 0.34)';
const BOOKMARK_BORDER = 'rgba(213, 182, 110, 0.42)';

interface LeftPanelProps {
  traveler: 角色数据结构;
  /** 点击头像 / 名字时触发，打开旅人档案只读弹窗。 */
  onOpenProfile?: () => void;
  onOpenCourier?: () => void;
  courierUnread?: number;
  album?: 相册系统;
  npcRecords?: NPC记录[];
  currentStoryChapter?: string;
  recallSummary?: string;
  recallFullContent?: string;
  desktop?: boolean;
}

export const LeftPanel = memo(function LeftPanel({
  traveler,
  onOpenProfile,
  onOpenCourier,
  courierUnread = 0,
  album,
  npcRecords = [],
  currentStoryChapter,
  recallSummary = '',
  recallFullContent = '',
  desktop = true,
}: LeftPanelProps) {
  const primaryAttunement = traveler.元素共鸣.find((entry) => entry.element === traveler.主元素) ?? traveler.元素共鸣[0];
  const elementLabel = primaryAttunement ? `${ELEMENT_NAMES[primaryAttunement.element]} · 熟练度 ${primaryAttunement.mastery}` : '尚未共鸣';
  // 与聊天区同一条头像解析链：正文头像 → 档案头像 → 手动头像 → 空/荧专属头像 → 通用旅行者兜底。
  const avatarUrl = (() => {
    const direct = 解析相册资源引用(album, traveler.图像档案?.正文头像?.trim() || traveler.图像档案?.头像?.trim() || traveler.头像?.trim());
    if (direct) return direct;
    const builtin = getDefaultTravelerBuiltinAvatar(traveler.姓名, traveler.别名);
    return builtin ? 解析相册资源引用(album, builtin) || builtin : undefined;
  })();
  // 队伍：旅行者 + 最多 3 名同行同伴（队伍成员身份由同行状态唯一决定，阶位只影响名册分组）
  const partyMembers = useMemo(
    () => npcRecords
      .filter((npc) => npc.同行)
      .sort((a, b) => b.最近回合 - a.最近回合)
      .slice(0, 3),
    [npcRecords],
  );

  if (!desktop) return null;

  return (
    <div className="teyvat-left-panel journal-bookmark-content relative hidden min-h-0 flex-col md:flex">
      {/* 顶部金线装饰条 */}
      <div
        className="px-4 py-3.5 text-center"
        style={{ borderBottom: '1px solid rgba(var(--tj-border), 0.72)' }}
      >
        <div
          className="font-serif text-[11px] tracking-[0.5em]"
          style={{ color: 'var(--journal-antique-gold-soft)', fontWeight: 700, textShadow: '0 1px 2px rgba(0,0,0,0.55)' }}
        >
          ◆ TRAVELER
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-y-auto p-4">
        {/* 头像 + 姓名：整块可点击，打开只读档案弹窗 */}
        <button
          type="button"
          onClick={onOpenProfile}
          disabled={!onOpenProfile}
          title={onOpenProfile ? '查看旅人档案' : undefined}
          className="journal-focus-target group mt-1 flex min-h-11 flex-col items-center transition-all hover:opacity-95 disabled:cursor-default disabled:hover:opacity-100"
        >
          {/* Avatar */}
          <div className="relative">
            <div
              className="flex h-[88px] w-[88px] items-center justify-center overflow-hidden font-serif text-4xl font-bold transition-all group-hover:scale-[1.03]"
              style={{
                background:
                  avatarUrl
                    ? 'rgba(var(--tj-surface-strong), 0.72)'
                    : 'radial-gradient(circle, rgba(var(--tj-bubble), 0.98) 0%, rgba(var(--tj-surface-strong), 0.95) 100%)',
                boxShadow:
                  'inset 0 0 0 1.5px rgba(var(--tj-border), 0.9), 0 10px 18px rgba(var(--tj-shadow), 0.1)',
                color: 'rgb(var(--tj-accent-primary))',
                clipPath:
                  'polygon(14px 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%, 0 14px)',
              }}
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt={`${traveler.姓名 || '旅人'} 头像`} className="h-full w-full object-cover" />
              ) : (
                traveler.姓名 ? traveler.姓名[0] : '?'
              )}
            </div>
            <span
              className="absolute -top-1.5 -right-1.5 text-base"
              style={{ color: 'rgba(var(--tj-accent-primary), 0.8)', textShadow: '0 0 6px rgba(var(--tj-accent-primary), 0.6)' }}
            >
              ✦
            </span>
            <span
              className="absolute -bottom-1.5 -left-1.5 text-base"
              style={{ color: 'rgba(var(--tj-accent-primary), 0.45)' }}
            >
              ◆
            </span>
          </div>

          {/* Name */}
          <div className="mt-4 text-center">
            <div
              className="font-serif text-xl font-bold tracking-[0.2em]"
              style={{
                background: 'linear-gradient(180deg, #fff1ca 0%, var(--journal-antique-gold-soft) 62%, #bd8f46 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              {traveler.姓名 || '无名旅行者'}
            </div>
            {traveler.别名 && (
              <div
                className="mt-1 font-serif text-[11px] italic tracking-[0.22em]"
                style={{ color: BOOKMARK_MUTED, fontWeight: 600, textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}
              >
                「{traveler.别名}」
              </div>
            )}
            {onOpenProfile && (
              <div
                className="mt-2 font-serif text-[10px] tracking-[0.3em] opacity-0 transition-opacity group-hover:opacity-100"
                style={{ color: 'rgba(var(--tj-accent-primary), 0.7)' }}
              >
                ✦ 查看档案
              </div>
            )}
          </div>
        </button>

        {/* 旅人摘要 */}
        <div className="mt-5 space-y-3">
          <InfoLine label="身份" value={traveler.身份 || traveler.背景 || '未记录'} />
          <InfoLine label="元素" value={elementLabel} />
        </div>

        {/* 队伍 */}
        <div className="mt-4 px-3 py-2.5" style={{ background: BOOKMARK_PANEL, boxShadow: `inset 0 0 0 1px ${BOOKMARK_BORDER}`, clipPath: 'polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px)' }}>
          <div className="flex items-center justify-between">
            <span className="font-serif text-[10px] font-bold tracking-[0.3em]" style={{ color: BOOKMARK_TEXT }}>◆ 队伍</span>
            <span className="text-[10px] font-semibold" style={{ color: BOOKMARK_MUTED }}>{partyMembers.length + 1}/4</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <div className="flex flex-col items-center gap-0.5" title={traveler.姓名 || '旅行者'}>
              {avatarUrl ? (
                <img src={avatarUrl} alt={traveler.姓名} className="h-9 w-9 rounded-full object-cover" style={{ boxShadow: '0 0 0 1.5px var(--journal-antique-gold)' }} />
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded-full font-serif text-sm" style={{ color: 'rgb(var(--tj-accent-primary))', boxShadow: 'inset 0 0 0 1.5px var(--journal-antique-gold)' }}>
                  {(traveler.姓名 || '旅').charAt(0)}
                </span>
              )}
              <span className="max-w-[44px] truncate text-[9px] font-semibold" style={{ color: BOOKMARK_TEXT }}>{traveler.姓名 || '旅人'}</span>
            </div>
            {partyMembers.map((member) => {
              const memberAvatar = 解析相册资源引用(album, 读取NPC头像(member, '档案'));
              return (
                <div key={member.id} className="flex flex-col items-center gap-0.5" title={member.姓名}>
                  {memberAvatar ? (
                    <img src={memberAvatar} alt={member.姓名} className="h-9 w-9 rounded-full object-cover" style={{ boxShadow: '0 0 0 1.5px rgba(var(--tj-accent-primary), 0.6)' }} />
                  ) : (
                    <span className="flex h-9 w-9 items-center justify-center rounded-full font-serif text-sm" style={{ color: 'rgba(var(--tj-text-primary), 0.8)', boxShadow: 'inset 0 0 0 1.5px rgba(var(--tj-accent-primary), 0.45)' }}>
                      {member.姓名.charAt(0)}
                    </span>
                  )}
                  <span className="max-w-[44px] truncate text-[9px] font-semibold" style={{ color: BOOKMARK_TEXT }}>{member.姓名}</span>
                </div>
              );
            })}
            {Array.from({ length: Math.max(0, 3 - partyMembers.length) }).map((_, i) => (
              <div key={`empty-${i}`} className="flex flex-col items-center gap-0.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-full text-xs" style={{ color: 'rgba(var(--tj-text-secondary), 0.4)', boxShadow: 'inset 0 0 0 1px dashed rgba(var(--tj-text-secondary), 0.3)', border: '1px dashed rgba(var(--tj-text-secondary), 0.3)' }}>
                  ＋
                </span>
                <span className="text-[9px] font-medium" style={{ color: BOOKMARK_MUTED }}>空位</span>
              </div>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={onOpenCourier}
          disabled={!onOpenCourier}
          className="journal-focus-target mt-4 flex min-h-11 items-center justify-between px-3 py-2.5 transition-all hover:opacity-90 disabled:cursor-default"
          style={{
            background: BOOKMARK_PANEL,
            boxShadow: `inset 0 0 0 1px ${BOOKMARK_BORDER}`,
            clipPath:
              'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)',
          }}
          title="打开手机"
        >
          <span className="flex items-center gap-2">
            <span className="font-serif text-base" style={{ color: 'rgb(var(--tj-accent-primary))' }}>▣</span>
            <span className="font-serif text-[13px] font-bold tracking-[0.22em]" style={{ color: BOOKMARK_TEXT }}>
              手机
            </span>
          </span>
          {courierUnread > 0 && (
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-bold"
              style={{
                color: 'rgb(var(--tj-ui-active-text))',
                background: 'rgba(220, 80, 80, 0.42)',
                boxShadow: '0 0 10px rgba(220, 80, 80, 0.35)',
              }}
            >
              {courierUnread}
            </span>
          )}
        </button>
        {currentStoryChapter && (
          <div
            className="mt-2 px-3 py-2"
style={{
          background: BOOKMARK_PANEL,
          boxShadow: `inset 0 0 0 1px ${BOOKMARK_BORDER}`,
              clipPath:
                'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)',
            }}
          >
            <div className="font-serif text-[10px] font-bold tracking-[0.28em]" style={{ color: 'var(--journal-antique-gold-soft)' }}>
              当前篇章
            </div>
            <div className="mt-1 line-clamp-2 text-[12px] font-medium leading-relaxed" style={{ color: BOOKMARK_TEXT }}>
              {currentStoryChapter}
            </div>
          </div>
        )}
        <RecallSummaryWindow content={recallSummary} fullContent={recallFullContent} />
      </div>
    </div>
  );
});

function RecallSummaryWindow({ content, fullContent }: { content: string; fullContent: string }) {
  const [expanded, setExpanded] = useState(false);
  const trimmed = content.trim();
  const full = fullContent.trim();
  const lines = trimmed ? trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : [];
  const entryCount = lines.reduce((sum, line) => {
    const [, value = ''] = line.split(/[:：]/);
    if (!value.trim() || value.trim() === '无') return sum;
    return sum + value.split(/[，,|]/).map((item) => item.trim()).filter(Boolean).length;
  }, 0);
  return (
    <section
      className="mt-3 flex min-h-[150px] flex-1 flex-col overflow-hidden px-3 py-2.5"
      style={{
        background: BOOKMARK_PANEL,
        boxShadow: `inset 0 0 0 1px ${BOOKMARK_BORDER}`,
        clipPath:
          'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)',
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="font-serif text-[10px] tracking-[0.28em]" style={{ color: 'var(--journal-antique-gold-soft)' }}>
          旅途回忆
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <div className="font-serif text-[10px] tracking-[0.18em]" style={{ color: 'rgba(var(--tj-accent-primary),0.72)' }}>
            {entryCount > 0 ? `${entryCount} 条` : '无命中'}
          </div>
          <button
            type="button"
            disabled={!full}
            onClick={() => setExpanded((value) => !value)}
            className="px-1.5 py-0.5 font-serif text-[10px] tracking-[0.14em] transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-35"
            style={{
              color: BOOKMARK_TEXT,
              boxShadow: `inset 0 0 0 1px ${BOOKMARK_BORDER}`,
              background: 'rgba(213, 182, 110, 0.09)',
              clipPath: 'polygon(4px 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%, 0 4px)',
            }}
            title={full ? '显示完整旅途回忆' : '本回合暂无完整旅途回忆'}
          >
            {expanded ? '收起' : '完整'}
          </button>
        </div>
      </div>
      <div
        className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1 text-[11px] leading-relaxed"
        style={{ color: BOOKMARK_TEXT }}
      >
        {expanded && full ? (
          <pre className="whitespace-pre-wrap break-words font-sans text-[10.5px] leading-relaxed">{full}</pre>
        ) : lines.length ? (
          <div className="space-y-2">
            {lines.map((line, index) => {
              const [label, ...rest] = line.split(/[:：]/);
              const value = rest.join('：').trim();
              return (
                <div key={`${label}-${index}`}>
                  <div className="font-serif text-[10px] tracking-[0.2em]" style={{ color: 'var(--journal-antique-gold-soft)' }}>
                    {label}
                  </div>
                  <div className="mt-0.5 text-[11px] leading-relaxed" style={{ color: BOOKMARK_TEXT }}>
                    {value || '无'}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="font-serif tracking-[0.12em]" style={{ color: BOOKMARK_MUTED }}>
            此页尚无旅途回忆
          </div>
        )}
      </div>
    </section>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="px-3 py-2"
      style={{
        background: BOOKMARK_PANEL,
        boxShadow: `inset 0 0 0 1px ${BOOKMARK_BORDER}`,
        clipPath:
          'polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px)',
      }}
    >
      <div className="font-serif text-[11px] font-bold tracking-[0.32em]" style={{ color: 'var(--journal-antique-gold-soft)' }}>
        ◆ {label}
      </div>
      <div className="mt-1 truncate font-serif text-[13px] font-bold tracking-[0.12em]" style={{ color: BOOKMARK_TEXT }}>
        {value}
      </div>
    </div>
  );
}
