import { memo, type CSSProperties, type ReactNode } from 'react';

import type { NPC记录, NPC阶位 } from '@/models/npc';
import {
  NPC_AFFINITY_MAX,
  NPC_AFFINITY_MIN,
  格式化NPC关系,
  读取NPC头像,
} from '@/models/npc';
import type { 相册系统 } from '@/models/imageGeneration';
import { 解析相册资源引用 } from '@/utils/albumActions';
import { CLIP_ITEM, CLIP_SECTION } from '@/styles/clipPaths';

const panelStyle: CSSProperties = {
  background: 'radial-gradient(circle at 12% 0%, rgba(var(--tj-arcane-accent), 0.12), transparent 34%), linear-gradient(180deg, rgba(var(--tj-surface), 0.74), rgba(var(--tj-bg-primary), 0.92))',
  boxShadow: 'inset 0 0 0 1px rgba(var(--tj-border), 0.72), inset 3px 0 0 rgba(var(--tj-arcane-accent-deep, var(--tj-accent-primary)), 0.36)',
  clipPath: CLIP_SECTION,
};
const titleColor = 'rgb(var(--tj-ui-title))';
const bodyColor = 'rgba(var(--tj-ui-body), 0.95)';
const mutedColor = 'rgba(var(--tj-ui-muted), 0.82)';
const faintColor = 'rgba(var(--tj-ui-faint), 0.74)';
const accentColor = 'rgb(var(--tj-accent-primary))';
const activeSurface = 'linear-gradient(90deg, rgba(var(--tj-btn-primary-start), 0.16), rgba(var(--tj-arcane-accent), 0.055))';
const quietSurface = 'linear-gradient(135deg, rgba(var(--tj-ui-panel), 0.62), rgba(var(--tj-ui-panel-strong), 0.72))';

interface CompanionRosterSidebarProps {
  tab: NPC阶位 | 'graph';
  onTabChange: (tab: NPC阶位 | 'graph') => void;
  companions: NPC记录[];
  extras: NPC记录[];
  visible: NPC记录[];
  hiddenNpcCount: number;
  nextPageCount: number;
  onShowMore: () => void;
  selectedId: string | null;
  onSelectNpc: (id: string) => void;
  album?: 相册系统;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  travelingCount: number;
  friendCount: number;
  totalCount: number;
  relationshipOverview: string;
}

export const CompanionRosterSidebar = memo(function CompanionRosterSidebar({
  tab,
  onTabChange,
  companions,
  extras,
  visible,
  hiddenNpcCount,
  nextPageCount,
  onShowMore,
  selectedId,
  onSelectNpc,
  album,
  searchQuery,
  onSearchQueryChange,
  travelingCount,
  friendCount,
  totalCount,
  relationshipOverview,
}: CompanionRosterSidebarProps) {
  return (
    <aside className="flex min-w-0 shrink-0 flex-col gap-3 md:min-h-0 md:w-[260px]">
      <div className="hidden px-3 py-3 md:block" style={panelStyle}>
        <div className="font-serif text-[12px] tracking-[0.3em]" style={{ color: accentColor }}>
          人际档案
        </div>
        <div className="mt-1 font-serif text-[12px] tracking-[0.12em]" style={{ color: mutedColor }}>
          同行 {travelingCount} / 朋友 {friendCount} / 全部 {totalCount}
        </div>
        <div className="mt-3 text-[11px] leading-relaxed" style={{ color: mutedColor }}>
          关系规划：{relationshipOverview}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <TabButton active={tab === 'companion'} onClick={() => onTabChange('companion')}>
          伙伴 {companions.length}
        </TabButton>
        <TabButton active={tab === 'extra'} onClick={() => onTabChange('extra')}>
          路人 {extras.length}
        </TabButton>
        <TabButton active={tab === 'graph'} onClick={() => onTabChange('graph')}>
          关系图
        </TabButton>
      </div>

      {tab !== 'graph' && (
        <input
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          aria-label="搜索同伴"
          placeholder="搜索姓名、别名、身份或备注…"
          className="teyvat-input w-full px-3 py-2 text-xs"
          style={{ clipPath: CLIP_ITEM }}
        />
      )}

      <div className="flex min-w-0 gap-2 overflow-x-auto overflow-y-hidden pb-1 md:min-h-0 md:flex-1 md:block md:space-y-2 md:overflow-y-auto md:overflow-x-hidden md:pb-0 md:pr-1">
        {visible.length ? (
          <>
            {visible.map((npc) => (
              <NpcListItem
                key={npc.id}
                npc={npc}
                album={album}
                selected={npc.id === selectedId}
                onSelect={onSelectNpc}
              />
            ))}
            {hiddenNpcCount > 0 && (
              <div
                className="w-[132px] shrink-0 px-3 py-3 text-center font-serif text-[11px] tracking-[0.12em] md:w-full"
                style={{
                  color: mutedColor,
                  background: 'rgba(var(--tj-ui-panel), 0.56)',
                  boxShadow: 'inset 0 0 0 1px rgba(var(--tj-border), 0.48)',
                  clipPath: CLIP_ITEM,
                }}
              >
                <span className="block">还有 {hiddenNpcCount} 位未显示</span>
                <button type="button" onClick={onShowMore} className="mt-1 block w-full" style={{ color: accentColor }}>
                  再显示 {nextPageCount} 位
                </button>
              </div>
            )}
          </>
        ) : (
          <EmptyRoster tab={tab} />
        )}
      </div>
    </aside>
  );
});

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-w-0 flex-1 whitespace-nowrap px-2.5 py-2 font-serif text-[12px] tracking-[0.18em] transition-all"
      style={{
        color: active ? titleColor : faintColor,
        background: active ? activeSurface : 'rgba(var(--tj-btn-primary-start), 0.035)',
        boxShadow: active
          ? 'inset 0 0 0 1px rgba(var(--tj-btn-primary-start), 0.56), 0 8px 18px rgba(var(--tj-shadow), 0.08)'
          : 'inset 0 0 0 1px rgba(var(--tj-border), 0.46)',
        clipPath: CLIP_ITEM,
      }}
    >
      {children}
    </button>
  );
}

const NpcListItem = memo(function NpcListItem({
  npc,
  album,
  selected,
  onSelect,
}: {
  npc: NPC记录;
  album?: 相册系统;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const relation = 格式化NPC关系(npc.好感度, Boolean(npc.亲密关系));
  return (
    <button
      type="button"
      onClick={() => onSelect(npc.id)}
      className="group flex w-[132px] shrink-0 flex-col items-center gap-2 px-2 py-3 text-center transition-all hover:bg-[rgba(var(--tj-btn-primary-start),0.07)] md:w-full md:flex-row md:gap-3 md:px-3 md:text-left"
      style={{
        background: selected ? activeSurface : quietSurface,
        boxShadow: selected
          ? 'inset 0 0 0 1px rgba(var(--tj-btn-primary-start), 0.56), inset 3px 0 0 linear-gradient(135deg, rgba(var(--tj-btn-primary-start),0.86), rgba(var(--tj-btn-primary-end),0.82))'
          : 'inset 0 0 0 1px rgba(var(--tj-border), 0.5)',
        clipPath: CLIP_ITEM,
        contentVisibility: 'auto',
        containIntrinsicSize: '74px',
      }}
    >
      <CompanionAvatar npc={npc} album={album} size={46} selected={selected} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center justify-center gap-2 md:justify-start">
          <span className="max-w-full truncate font-serif text-[13px] font-semibold tracking-[0.08em] md:text-[14px]" style={{ color: selected ? titleColor : bodyColor }}>
            {npc.姓名}
          </span>
          {npc.同行 && <PresenceDot />}
        </div>
        <div className="mt-0.5 truncate font-serif text-[11px] tracking-[0.1em] md:text-[12px]" style={{ color: mutedColor }}>
          {relation}{npc.原著角色 ? ' / 原著' : ''}
        </div>
        <AffinityMeter value={npc.好感度} compact />
      </div>
    </button>
  );
});

export function CompanionAvatar({
  npc,
  album,
  size,
  selected = false,
  slot = '档案',
}: {
  npc: NPC记录;
  album?: 相册系统;
  size: number;
  selected?: boolean;
  slot?: '档案' | '正文' | '手机';
}) {
  const src = 解析相册资源引用(album, 读取NPC头像(npc, slot));
  const style: CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    background: 'linear-gradient(145deg, rgba(var(--tj-btn-primary-start), 0.14), rgba(var(--tj-arcane-accent), 0.055))',
    boxShadow: selected
      ? '0 0 0 1px rgba(var(--tj-btn-primary-start), 0.72), 0 0 18px rgba(var(--tj-btn-primary-start), 0.16)'
      : '0 0 0 1px rgba(var(--tj-border), 0.72)',
  };

  if (src) {
    return (
      <span className="relative shrink-0" style={{ width: size, height: size }}>
        <img src={src} alt={npc.姓名} className="h-full w-full object-cover" style={style} />
        <span className="pointer-events-none absolute inset-0 rounded-full" style={{ boxShadow: 'inset 0 0 12px rgba(var(--tj-text-primary),0.12)' }} />
      </span>
    );
  }

  return (
    <div
      className="relative shrink-0 flex items-center justify-center overflow-hidden font-serif font-semibold"
      style={{ ...style, fontSize: Math.max(16, Math.floor(size * 0.42)), color: selected ? titleColor : accentColor }}
    >
      <span className="absolute inset-[6px] rounded-full" style={{ boxShadow: 'inset 0 0 0 1px rgba(var(--tj-border), 0.38)' }} />
      {npc.姓名.slice(0, 1)}
    </div>
  );
}

function PresenceDot() {
  return <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: 'rgb(128, 224, 166)', boxShadow: '0 0 8px rgba(var(--tj-ui-success),0.7)' }} />;
}

export function AffinityMeter({ value, compact = false }: { value: number; compact?: boolean }) {
  const tone = getAffinityTone(value);
  const percent = Math.max(0, Math.min(100, ((value - NPC_AFFINITY_MIN) / (NPC_AFFINITY_MAX - NPC_AFFINITY_MIN)) * 100));
  return (
    <div className={compact ? 'mt-1.5 flex items-center gap-2' : 'mt-2 flex items-center gap-2'}>
      <span className="font-serif text-[12px]" style={{ color: tone.color }}>♥</span>
      <div className="relative h-1.5 flex-1 overflow-hidden" style={{ background: 'rgba(var(--tj-surface-strong),0.72)', boxShadow: 'inset 0 0 0 1px rgba(var(--tj-border), 0.42)' }}>
        <div className="absolute inset-y-0 left-0" style={{ width: `${percent}%`, background: tone.fill }} />
      </div>
      <span className="w-8 text-right font-mono text-[11px]" style={{ color: mutedColor }}>{value > 0 ? '+' : ''}{value}</span>
    </div>
  );
}

export function getAffinityTone(value: number) {
  if (value >= 60) return { color: 'rgba(var(--tj-ui-nsfw),0.98)', stroke: 'rgba(var(--tj-ui-nsfw),0.45)', fill: 'linear-gradient(90deg, rgba(var(--tj-ui-nsfw),0.62), rgba(var(--tj-ui-nsfw),0.96))' };
  if (value >= 30) return { color: 'rgba(var(--tj-ui-nsfw),0.96)', stroke: 'rgba(var(--tj-ui-nsfw),0.38)', fill: 'linear-gradient(90deg, rgba(var(--tj-ui-nsfw),0.5), rgba(var(--tj-ui-nsfw),0.9))' };
  if (value >= 0) return { color: 'rgba(var(--tj-text-secondary),0.9)', stroke: 'rgba(var(--tj-border), 0.42)', fill: 'linear-gradient(90deg, rgba(var(--tj-text-secondary),0.4), rgba(var(--tj-text-secondary),0.78))' };
  return { color: 'rgba(var(--tj-arcane-blue),0.86)', stroke: 'rgba(var(--tj-arcane-blue),0.34)', fill: 'linear-gradient(90deg, rgba(var(--tj-panel-bg-start),0.75), rgba(var(--tj-arcane-blue),0.62))' };
}

function EmptyRoster({ tab }: { tab: NPC阶位 | 'graph' }) {
  return (
    <div className="px-4 py-8 text-center" style={panelStyle}>
      <div className="font-serif text-[20px]" style={{ color: 'rgba(var(--tj-btn-primary-start), 0.45)' }}>✦</div>
      <div className="mt-2 font-serif text-[13px] tracking-[0.18em]" style={{ color: faintColor }}>
        {tab === 'companion' ? '尚未结识伙伴' : '尚无路人档案'}
      </div>
    </div>
  );
}
