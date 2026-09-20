import { CLIP_ITEM, CLIP_SECTION, insetRing } from '@/styles/clipPaths';
﻿// 背包系统面板(v4)。
// 左侧概览 + 分类切换，右侧方格网格 + 详情浮层。
// 所有写入走 utils/inventoryActions 服务层，避免直接戳数组遗漏堆叠合并等副作用。

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ARTIFACT_SLOTS,
  ITEM_CATEGORIES,
  type ArtifactSlot,
  type ItemCategory,
  type TeyvatInventory,
  type TeyvatItem,
} from '@/models/teyvat/items';
import { consumeInventoryItem, discardInventoryItem } from '@/utils/inventoryActions';

interface InventoryPanelProps {
  inventory: TeyvatInventory;
  onInventoryChange: React.Dispatch<React.SetStateAction<TeyvatInventory>>;
  turnCount: number;
}

type 标签 = ItemCategory | '全部';



const cellClip =
  'polygon(9px 0, 100% 0, 100% calc(100% - 9px), calc(100% - 9px) 100%, 0 100%, 0 9px)';

const ITEM_CATEGORY_LABELS: Record<ItemCategory, string> = {
  weapon: '武器', artifact: '圣遗物', food: '食物', material: '材料',
  gadget: '小道具', quest: '任务道具', furnishing: '摆设',
};
const ARTIFACT_SLOT_LABELS: Record<ArtifactSlot, string> = {
  flower: '生之花', plume: '死之羽', sands: '时之沙', goblet: '空之杯', circlet: '理之冠',
};
const ITEM_RARITY_COLORS: Record<number, string> = {
  1: '#8b857b', 2: '#5f8f6c', 3: '#4f78a8', 4: '#9a6aae', 5: '#c89036',
};
const USABLE_CATEGORIES: ItemCategory[] = ['food', 'gadget'];

const CATEGORY_GLYPHS: Record<ItemCategory, string> = {
  food: '□',
  gadget: '✚',
  weapon: '✦',
  artifact: '✧',
  material: '◈',
  quest: '◆',
  furnishing: '▣',
};

const panelStyle = {
  background:
    'radial-gradient(circle at 10% 0%, rgba(var(--tj-arcane-accent), 0.075), transparent 34%), linear-gradient(180deg, rgba(var(--tj-bubble), 0.96), rgba(var(--tj-surface-strong), 0.94))',
  boxShadow:
    'inset 0 0 0 1px rgba(var(--tj-border), 0.62), 0 14px 32px rgba(var(--tj-shadow), 0.1)',
  clipPath: CLIP_SECTION,
};

export function InventoryPanel({ inventory, onInventoryChange, turnCount }: InventoryPanelProps) {
  const items = inventory.items;
  const [tab, setTab] = useState<标签>('全部');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [flash, setFlash] = useState('');
  const flashTimerRef = useRef<number | null>(null);

  const counts = useMemo(() => {
    const c = Object.fromEntries(ITEM_CATEGORIES.map((category) => [category, 0])) as Record<ItemCategory, number>;
    for (const it of items) c[it.category] += 1;
    return c;
  }, [items]);

  const usableCount = useMemo(
    () => items.filter((it) => USABLE_CATEGORIES.includes(it.category)).length,
    [items],
  );

  const totalQuantity = useMemo(
    () => items.reduce((sum, it) => sum + it.quantity, 0),
    [items],
  );

  const visible = useMemo(
    () => (tab === '全部' ? items : items.filter((it) => it.category === tab)),
    [items, tab],
  );

  const selectedItem = useMemo(
    () => (selectedId ? items.find((it) => it.id === selectedId) ?? null : null),
    [items, selectedId],
  );

  useEffect(() => {
    return () => {
      if (flashTimerRef.current != null) {
        window.clearTimeout(flashTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (selectedId && !items.some((it) => it.id === selectedId)) {
      setSelectedId(null);
    }
  }, [items, selectedId]);

  const showFlash = (msg: string) => {
    if (flashTimerRef.current != null) {
      window.clearTimeout(flashTimerRef.current);
    }
    setFlash(msg);
    flashTimerRef.current = window.setTimeout(() => {
      setFlash('');
      flashTimerRef.current = null;
    }, 2400);
  };

  const handleUse = (itemId: string) => {
    onInventoryChange((prev) => {
      try {
        const next = consumeInventoryItem(prev, itemId, 1);
        showFlash('物品已使用。');
        return next;
      } catch (error) {
        showFlash(error instanceof Error ? error.message : '物品使用失败。');
        return prev;
      }
    });
  };

  const handleDrop = (itemId: string, count?: number) => {
    if (!confirm(count ? `确认丢弃 ${count} 件?` : '确认全部丢弃该物品?')) return;
    let willEmpty = false;
    onInventoryChange((prev) => {
      const cur = prev.items.find((it) => it.id === itemId);
      if (!cur) return prev;
      const amount = count ?? cur.quantity;
      if (amount >= cur.quantity) willEmpty = true;
      try {
        const next = discardInventoryItem(prev, itemId, amount);
        showFlash('物品已丢弃。');
        return next;
      } catch (error) {
        showFlash(error instanceof Error ? error.message : '物品丢弃失败。');
        return prev;
      }
    });
    if (willEmpty) setSelectedId(null);
  };

  const cellMinCount = 12;
  const cells: (TeyvatItem | null)[] = [
    ...visible,
    ...Array(Math.max(0, cellMinCount - visible.length)).fill(null),
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overflow-x-hidden md:flex-row md:gap-4 md:overflow-hidden">
      <aside className="flex min-w-0 shrink-0 flex-col gap-3 md:w-[260px]">
        <div className="px-3 py-3 md:px-4 md:py-4" style={panelStyle}>
          <SectionHeader title="背包总览" />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <MetricTile label="物品总数" value={`${items.length}`} />
            <MetricTile label="总堆叠量" value={`${totalQuantity}`} />
            <MetricTile label="可用道具" value={`${usableCount}`} />
            <MetricTile label="圣遗物" value={`${counts.artifact}`} />
          </div>
          <div className="mt-3">
            <MiniBar value={items.length} />
          </div>
        </div>

        <div className="px-3 py-3 md:px-4 md:py-3" style={panelStyle}>
          <SectionHeader title="分类切换" />
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1 md:block md:space-y-2 md:overflow-visible md:pb-0">
            {(['全部', ...ITEM_CATEGORIES] as 标签[]).map((cat) => {
              const label = cat === '全部' ? '全部' : ITEM_CATEGORY_LABELS[cat];
              const count = cat === '全部' ? items.length : counts[cat];
              const active = tab === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => {
                    setTab(cat);
                    setSelectedId(null);
                  }}
                  className="min-w-[112px] flex-none px-3 py-2.5 text-left transition-all hover:bg-[rgba(var(--tj-accent-primary),0.08)] md:w-full md:min-w-0 md:flex-auto"
                  style={{
                    background: active
                      ? 'linear-gradient(135deg, rgba(var(--tj-accent-primary), 0.16), rgba(var(--tj-accent-primary), 0.04))'
                      : 'rgba(var(--tj-text-secondary), 0.04)',
                    boxShadow: active
                      ? 'inset 0 0 0 1px rgba(var(--tj-accent-primary), 0.58), inset 3px 0 0 linear-gradient(135deg, rgba(var(--tj-accent-primary),0.94), rgba(var(--tj-accent-secondary),0.9))'
                      : 'inset 0 0 0 1px rgba(var(--tj-text-secondary), 0.18)',
                    clipPath: CLIP_ITEM,
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className="inline-flex min-w-0 items-center gap-2 font-serif text-[13px] tracking-[0.2em]"
                      style={{ color: active ? 'rgb(var(--tj-accent-primary))' : 'rgba(var(--tj-text-secondary), 0.88)' }}
                    >
                      <span className="shrink-0 text-[12px]" style={{ color: active ? 'rgb(var(--tj-arcane-accent))' : 'rgba(var(--tj-arcane-accent), 0.68)' }}>
                        {cat === '全部' ? '✦' : CATEGORY_GLYPHS[cat]}
                      </span>
                      <span className="truncate">{label}</span>
                    </span>
                    <span
                      className="font-serif text-[12px]"
                      style={{ color: active ? 'rgb(var(--tj-text-primary))' : 'rgba(210, 198, 168, 0.8)' }}
                    >
                      {count}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      <main className="min-h-0 min-w-0 flex-1 overflow-visible md:overflow-hidden">
        <div className="flex h-full min-h-0 flex-col gap-3">
          <div className="px-3 py-3 md:px-4 md:py-4" style={panelStyle}>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <SectionHeader title="物品陈列" />
                <div
                  className="mt-2 font-serif text-[13px] leading-relaxed tracking-[0.14em] md:text-[14px] md:tracking-[0.18em]"
                  style={{ color: 'rgba(var(--tj-text-secondary), 0.86)' }}
                >
                  {tab === '全部' ? '全部物品' : ITEM_CATEGORY_LABELS[tab]} · 共 {visible.length} 件
                </div>
              </div>
              <div
                className="font-serif text-[12px] tracking-[0.16em]"
                style={{ color: 'rgba(200, 188, 160, 0.78)' }}
              >
                第 {turnCount} 回合
              </div>
            </div>

            {flash && (
              <div
                className="mt-3 px-3 py-2 font-serif text-[12px] tracking-[0.14em]"
                style={{
                  color: 'rgba(var(--tj-text-primary), 0.96)',
                  background: 'rgba(var(--tj-accent-primary), 0.06)',
                  boxShadow: insetRing(0.3),
                  clipPath: CLIP_ITEM,
                }}
              >
                {flash}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-4 xl:grid xl:min-h-0 xl:flex-1 xl:grid-cols-[1fr_330px]">
            <div className="min-h-fit overflow-visible xl:min-h-0 xl:overflow-y-auto xl:pr-1">
              <div
                className="grid gap-2"
                style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(4.25rem, 1fr))' }}
              >
                {cells.map((item, i) =>
                  item ? (
                    <ItemCell
                      key={item.id}
                      item={item}
                      selected={selectedId === item.id}
                      onClick={() => setSelectedId(item.id)}
                    />
                  ) : (
                    <EmptyCell key={`empty-${i}`} />
                  ),
                )}
              </div>
            </div>

            <div className="relative z-10 min-h-fit overflow-visible xl:min-h-0 xl:overflow-y-auto xl:pr-1">
              <div className="xl:sticky xl:top-0">
                <ItemDetailOverlay
                  item={selectedItem}
                  onClose={() => setSelectedId(null)}
                  onUse={() => selectedItem && handleUse(selectedItem.id)}
                  onDropOne={() => selectedItem && handleDrop(selectedItem.id, 1)}
                  onDropAll={() => selectedItem && handleDrop(selectedItem.id)}
                />
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function ItemCell({
  item,
  selected,
  onClick,
}: {
  item: TeyvatItem;
  selected: boolean;
  onClick: () => void;
}) {
  const qualityColor = ITEM_RARITY_COLORS[item.rarity] ?? ITEM_RARITY_COLORS[1] ?? '#8b857b';
  const qualityStroke = qualityColor;

  return (
    <button
      data-testid="inventory-item-cell"
      type="button"
      onClick={onClick}
      title={item.name}
      className="group relative aspect-square w-full transition-all hover:brightness-110"
      style={{
        background: selected
          ? 'linear-gradient(180deg, rgba(var(--tj-accent-primary), 0.24), rgba(255,252,240,0.9))'
          : 'linear-gradient(160deg, rgba(255,252,240,0.92), rgba(var(--tj-accent-primary),0.07))',
        boxShadow: `inset 0 0 0 ${selected ? 2 : 1}px ${selected ? 'rgba(var(--tj-accent-primary),0.94)' : qualityStroke}, 0 2px 8px rgba(var(--tj-shadow),0.12)`,
        clipPath: cellClip,
      }}
    >
      <div
        className="absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100"
        style={{
          background: `radial-gradient(circle at 50% 36%, ${qualityColor.replace(/0\.\d+\)/, '0.22)')}, transparent 58%)`,
        }}
      />

      <div className="absolute left-0 top-0 h-1.5 w-full" style={{ background: qualityColor }} />

      <div
        className="absolute left-1 top-1 flex h-5 w-5 items-center justify-center font-serif text-[12px]"
        style={{
          color: 'rgba(var(--tj-arcane-accent-deep),0.9)',
          background: 'rgba(var(--tj-ui-panel-strong), 0.5)',
          boxShadow: 'inset 0 0 0 1px rgba(var(--tj-border), 0.42)',
          clipPath: CLIP_ITEM,
        }}
      >
        {CATEGORY_GLYPHS[item.category]}
      </div>

      <div className="absolute inset-0 flex items-center justify-center pb-2.5">
        <span
          className="font-serif text-[22px] font-semibold leading-none drop-shadow-sm"
          style={{ color: qualityColor }}
        >
          {item.name.slice(0, 1)}
        </span>
      </div>

      <div
        className="absolute inset-x-0 bottom-0 truncate px-1 py-0.5 text-center font-serif text-[12px] leading-tight tracking-wide"
        style={{
          color: 'rgba(45,38,30,0.98)',
          background: 'linear-gradient(180deg, rgba(255,252,240,0.35), rgba(239,227,201,0.96))',
        }}
      >
        {item.name}
      </div>

      {item.quantity > 1 && (
        <div
          className="absolute right-0.5 top-0.5 px-1 font-serif text-[12px] font-semibold leading-none tracking-wider"
          style={{
            color: 'rgb(var(--tj-text-primary))',
            background: 'rgba(var(--tj-bubble), 0.92)',
            boxShadow: insetRing(0.45),
            paddingTop: 2,
            paddingBottom: 2,
          }}
        >
          ×{item.quantity}
        </div>
      )}
    </button>
  );
}

function EmptyCell() {
  return (
    <div
      className="aspect-square w-full"
      style={{
        background: 'rgba(var(--tj-surface-strong), 0.46)',
        boxShadow: 'inset 0 0 0 1px rgba(var(--tj-border), 0.24)',
        clipPath: cellClip,
      }}
    />
  );
}

function ItemDetailOverlay({
  item,
  onClose,
  onUse,
  onDropOne,
  onDropAll,
}: {
  item: TeyvatItem | null;
  onClose: () => void;
  onUse: () => void;
  onDropOne: () => void;
  onDropAll: () => void;
}) {
  if (!item) {
    return (
      <div
        className="px-3 py-4 md:px-4 md:py-5"
        style={{
          background: 'linear-gradient(180deg, rgba(var(--tj-bubble), 0.96), rgba(var(--tj-surface-strong), 0.94))',
          boxShadow: insetRing(0.2),
          clipPath: CLIP_SECTION,
        }}
      >
        <SectionHeader title="物品详情" />
        <EmptyNotice title="未选择物品" text="点击物品格子后，这里会显示更完整的详情。" />
      </div>
    );
  }

  const usable = USABLE_CATEGORIES.includes(item.category);
  const qualityColor = ITEM_RARITY_COLORS[item.rarity] ?? ITEM_RARITY_COLORS[1] ?? '#8b857b';
  const effectEntries = item.narrativeEffects ?? item.effects ?? [];
  const effects = item.useEffects ?? [];

  return (
    <div
      data-testid="inventory-detail-panel"
      className="relative z-10 mt-1 overflow-hidden px-3 py-4 md:mt-0 md:px-4 md:py-4"
      style={{
        background: `radial-gradient(circle at 12% 0%, ${qualityColor.replace(/0\.\d+\)/, '0.13)')}, transparent 38%), linear-gradient(180deg, rgba(var(--tj-ui-panel-strong), 0.98), rgba(var(--tj-ui-panel), 0.96))`,
        boxShadow: `inset 0 0 0 1px ${qualityColor}, 0 14px 32px rgba(var(--tj-shadow), 0.08)`,
        clipPath: CLIP_SECTION,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <div
            className="flex h-[58px] w-[58px] shrink-0 items-center justify-center font-serif text-[26px] md:h-[68px] md:w-[68px] md:text-[30px]"
            style={{
              color: qualityColor,
              background: 'rgba(var(--tj-bg-primary), 0.56)',
              boxShadow: `inset 0 0 0 1px ${qualityColor}, 0 0 20px rgba(var(--tj-accent-primary), 0.08)`,
              clipPath: CLIP_ITEM,
            }}
          >
            {CATEGORY_GLYPHS[item.category]}
          </div>
          <div className="min-w-0">
            <SectionHeader title="物品详情" />
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <MetaChip text={`${'★'.repeat(item.rarity)} ${item.rarity} 星`} color={qualityColor} />
              <MetaChip text={`×${item.quantity}`} color="rgba(245,235,210,0.92)" />
              <MetaChip text={ITEM_CATEGORY_LABELS[item.category]} color="rgba(var(--tj-arcane-accent), 0.9)" />
              {item.category === 'artifact' && item.artifactSlot && (
                <MetaChip text={ARTIFACT_SLOT_LABELS[item.artifactSlot] ?? item.artifactSlot} color={qualityColor} />
              )}
            </div>
            <h3
              className="mt-2 break-words font-serif text-[19px] font-semibold leading-tight tracking-[0.08em] md:text-[24px] md:tracking-[0.12em]"
              style={{ color: qualityColor }}
            >
              {item.name}
            </h3>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="font-serif text-[14px] tracking-wider px-2 py-1 transition-all hover:bg-[rgba(var(--tj-accent-primary),0.08)]"
          style={{
            color: 'rgb(var(--tj-ui-title))',
            boxShadow: 'inset 0 0 0 1px rgba(var(--tj-border), 0.65)',
            clipPath: CLIP_ITEM,
          }}
          aria-label="关闭"
        >
          ✕
        </button>
      </div>

      {item.description && (
        <p
          className="mt-3 font-serif text-[13px] leading-[1.8] md:text-[14px]"
          style={{ color: 'rgb(var(--tj-ui-body))' }}
        >
          {item.description}
        </p>
      )}

      <div className="mt-4 grid gap-3">
        {effectEntries.length > 0 && (
          <DetailBlock title="叙事效果">
            <div className="flex flex-wrap gap-2">
              {effectEntries.map((effect) => (
                <EffectChip key={effect} text={effect} />
              ))}
            </div>
          </DetailBlock>
        )}

        {effects.length > 0 && (
          <DetailBlock title="使用效果">
            <div className="flex flex-wrap gap-2">
              {effects.map((eff, i) => (
                <StatChip key={`${eff.target}-${i}`} label={eff.target} value={eff.value} />
              ))}
            </div>
          </DetailBlock>
        )}

        <DetailBlock title="来源记录">
          <div className="space-y-1">
            <InfoLine label="来源" value={item.source ?? '未记录'} />
            <InfoLine label="时间" value={item.obtainedAt ?? `第 ${item.obtainedAtTurn} 回合`} />
            {item.sourceDetail && <InfoLine label="备注" value={item.sourceDetail} />}
            {item.category === 'artifact' && item.artifactSlot && (
              <InfoLine label="部位" value={ARTIFACT_SLOT_LABELS[item.artifactSlot]} />
            )}
          </div>
        </DetailBlock>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {usable && <ActionButton onClick={onUse} tone="gold">使用</ActionButton>}
        {item.quantity > 1 && <ActionButton onClick={onDropOne} tone="red">丢弃 1</ActionButton>}
        <ActionButton onClick={onDropAll} tone="red">
          {item.quantity > 1 ? `全部丢弃 ×${item.quantity}` : '丢弃'}
        </ActionButton>
      </div>
    </div>
  );
}

function MetaChip({ text, color }: { text: string; color: string }) {
  return (
    <span
      className="inline-flex px-2 py-0.5 font-serif text-[12px] tracking-[0.14em]"
      style={{
        color,
        background: 'rgba(var(--tj-bubble), 0.78)',
        boxShadow: insetRing(0.18),
        clipPath: CLIP_ITEM,
      }}
    >
      {text}
    </span>
  );
}

function ActionButton({
  onClick,
  tone,
  children,
}: {
  onClick: () => void;
  tone: 'gold' | 'red';
  children: React.ReactNode;
}) {
  const palette =
    tone === 'gold'
      ? { color: 'rgb(var(--tj-text-primary))', stroke: 'rgba(var(--tj-accent-primary), 0.45)' }
      : { color: 'rgba(230, 170, 170, 0.95)', stroke: 'rgba(220, 150, 150, 0.45)' };

  return (
    <button
      type="button"
      onClick={onClick}
      className="font-serif text-[12px] tracking-[0.2em] px-3 py-1 transition-all hover:bg-[rgba(var(--tj-accent-primary),0.08)]"
      style={{
        color: palette.color,
        boxShadow: `inset 0 0 0 1px ${palette.stroke}`,
        clipPath: CLIP_ITEM,
      }}
    >
      {children}
    </button>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-4 w-[3px]" style={{ background: 'rgb(var(--tj-accent-primary))' }} />
      <span className="font-serif text-[12px] font-semibold tracking-[0.18em] md:text-[13px] md:tracking-[0.28em]" style={{ color: 'rgb(var(--tj-accent-primary))' }}>
        {title}
      </span>
      <span
        className="h-px flex-1"
        style={{ background: 'linear-gradient(90deg, rgba(var(--tj-accent-primary),0.35), transparent)' }}
      />
    </div>
  );
}

function DetailBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="px-3 py-3"
      style={{
        background: 'linear-gradient(135deg, rgba(var(--tj-bubble), 0.78), rgba(var(--tj-surface-strong), 0.58))',
        boxShadow: 'inset 0 0 0 1px rgba(var(--tj-border), 0.48)',
        clipPath: CLIP_ITEM,
      }}
    >
      <div className="mb-2 font-serif text-[12px] font-semibold tracking-[0.22em]" style={{ color: 'rgb(var(--tj-ui-title))' }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="px-3 py-2"
      style={{
        background: 'rgba(var(--tj-accent-primary), 0.055)',
        boxShadow: insetRing(0.22),
        clipPath: CLIP_ITEM,
      }}
    >
      <div className="font-serif text-[11px] leading-tight tracking-[0.12em] md:text-[12px] md:tracking-[0.16em]" style={{ color: 'rgba(var(--tj-text-secondary), 0.82)' }}>
        {label}
      </div>
      <div className="mt-1 truncate font-serif text-[14px] font-semibold md:text-[15px]" style={{ color: 'rgb(var(--tj-text-primary))' }}>
        {value}
      </div>
    </div>
  );
}

function MiniBar({ value }: { value: number }) {
  return (
    <div className="flex gap-1">
      {Array.from({ length: 8 }).map((_, index) => (
        <div
          key={index}
          className="h-1.5 flex-1"
          style={{
            background: index < Math.min(8, Math.max(0, value)) ? 'rgb(var(--tj-accent-primary))' : 'rgba(var(--tj-text-secondary), 0.18)',
            boxShadow: index < Math.min(8, Math.max(0, value)) ? '0 0 8px rgba(var(--tj-accent-primary), 0.45)' : undefined,
          }}
        />
      ))}
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: number }) {
  return (
    <span
      className="inline-flex items-center gap-2 px-3 py-1 font-serif text-[12px] tracking-[0.14em]"
      style={{
        color: 'rgb(var(--tj-ui-body))',
        background: 'rgba(var(--tj-accent-primary), 0.08)',
        boxShadow: insetRing(0.28),
        clipPath: CLIP_ITEM,
      }}
    >
      <span style={{ color: 'rgba(var(--tj-text-secondary), 0.82)' }}>{label}</span>
      <span>+{value}</span>
    </span>
  );
}

function EffectChip({ text }: { text: string }) {
  return (
    <span
      className="inline-flex px-3 py-1 font-serif text-[12px] tracking-[0.14em]"
      style={{
        color: 'rgb(var(--tj-ui-body))',
        background: 'rgba(var(--tj-arcane-accent), 0.08)',
        boxShadow: 'inset 0 0 0 1px rgba(var(--tj-arcane-accent), 0.28)',
        clipPath: CLIP_ITEM,
      }}
    >
      {text}
    </span>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 font-serif text-[12px] leading-relaxed md:flex-row md:gap-3 md:text-[13px]">
      <span className="shrink-0 font-semibold tracking-[0.12em] md:tracking-[0.16em]" style={{ color: 'rgba(var(--tj-ui-title), 0.84)' }}>
        {label}
      </span>
      <span className="min-w-0 break-words" style={{ color: 'rgb(var(--tj-ui-body))' }}>
        {value}
      </span>
    </div>
  );
}

function EmptyNotice({ title, text }: { title: string; text: string }) {
  return (
    <div
      className="px-4 py-5 text-center"
      style={{
        background: 'rgba(var(--tj-text-secondary), 0.055)',
        boxShadow: 'inset 0 0 0 1px rgba(var(--tj-text-secondary), 0.2)',
        clipPath: CLIP_ITEM,
      }}
    >
      <div className="font-serif text-[15px] font-semibold tracking-[0.18em]" style={{ color: 'rgb(var(--tj-ui-title))' }}>
        {title}
      </div>
      <div className="mt-2 font-serif text-[13px] leading-relaxed tracking-wider" style={{ color: 'rgb(var(--tj-ui-body))' }}>
        {text}
      </div>
    </div>
  );
}
