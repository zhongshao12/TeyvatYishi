import { CLIP_MEDIUM, CLIP_SMALL, insetRing } from '@/styles/clipPaths';
import type { SaveListItemSummary } from '@/services/dbService';
import type { SaveTreeDisplayGroup } from '@/utils/saveTreeView';
import { formatByteSize } from '@/utils/formatByteSize';

export function StorageLegacyBackupSection({
  backups,
  loadingId,
  deletingId,
  deletingAll,
  onLoad,
  onExport,
  onDelete,
  onDeleteAll,
}: {
  backups: SaveListItemSummary[];
  loadingId: number | null;
  deletingId: number | null;
  deletingAll: boolean;
  onLoad: (id: number) => void;
  onExport: (id: number) => void;
  onDelete: (id: number) => void;
  onDeleteAll: () => void;
}) {
  return (
    <details
      className="mb-3 overflow-hidden"
      style={{
        background: 'rgba(var(--tj-arcane-accent),0.04)',
        boxShadow: 'inset 0 0 0 1px rgba(var(--tj-arcane-accent),0.15)',
        clipPath: CLIP_MEDIUM,
      }}
    >
      <summary className="cursor-pointer px-4 py-3 font-serif text-[13px] tracking-[0.16em]" style={{ color: 'rgb(var(--tj-accent-secondary))' }}>
        历史恢复点 {backups.length} 个
      </summary>
      <div className="space-y-3 border-t px-3 pb-3 pt-3" style={{ borderColor: 'rgba(var(--tj-arcane-accent),0.12)' }}>
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] leading-relaxed tracking-wider" style={{ color: 'rgba(var(--tj-text-primary),0.62)' }}>
          <span>旧版本读档前自动创建的恢复点已停止新增，可按需读取、导出或清理。</span>
          <StorageActionButton
            label={deletingAll ? '清理中' : '清理全部旧恢复点'}
            disabled={deletingAll || loadingId !== null || deletingId !== null}
            onClick={onDeleteAll}
          />
        </div>
        {backups.map((backup) => (
          <SaveCard
            key={backup.id}
            save={backup}
            loadingId={loadingId}
            deletingId={deletingId}
            onLoad={onLoad}
            onExport={onExport}
            onDelete={onDelete}
            treeLabel="旧恢复点"
          />
        ))}
      </div>
    </details>
  );
}

export function StorageSaveTreeGroup({
  group,
  loadingId,
  deletingId,
  deletingRootId,
  onLoad,
  onExport,
  onExportTree,
  onDelete,
  onDeleteTree,
  catalogComplete,
}: {
  group: SaveTreeDisplayGroup;
  loadingId: number | null;
  deletingId: number | null;
  deletingRootId: string | null;
  onLoad: (id: number) => void;
  onExport: (id: number) => void;
  onExportTree: (rootId: string) => void;
  onDelete: (id: number) => void;
  onDeleteTree: (rootId: string, nodeCount: number) => void;
  catalogComplete: boolean;
}) {
  return (
    <section
      className="min-w-0 p-2"
      style={{
        background: 'linear-gradient(135deg, rgba(var(--tj-panel-bg-start),0.52), rgba(var(--tj-panel-bg-end),0.56))',
        boxShadow: 'inset 0 0 0 1px rgba(var(--tj-arcane-accent),0.18)',
        clipPath: CLIP_MEDIUM,
      }}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-2 py-1.5 font-serif">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-baseline gap-2">
            <span className="text-[11px] tracking-[0.18em]" style={{ color: 'rgb(var(--tj-arcane-accent))' }}>
              存档树
            </span>
            <span className="truncate text-[14px] font-bold tracking-wider" style={{ color: 'rgb(var(--tj-accent-secondary))' }}>
              {group.latestSave.travelerName || group.rootSave.travelerName || '未命名旅人'}
            </span>
            <span className="text-[11px]" style={{ color: 'rgba(var(--tj-text-primary),0.42)' }}>
              最新 #{group.latestSave.id}
            </span>
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] tracking-wider" style={{ color: 'rgba(var(--tj-text-primary),0.58)' }}>
            <span>{group.nodeCount} 个节点</span>
            <span>{group.branchCount} 个分支</span>
            <span>{formatByteSize(group.totalSizeBytes)}</span>
          </div>
        </div>
        <div className="text-[11px] tracking-[0.16em]" style={{ color: 'rgba(var(--tj-arcane-accent),0.82)' }}>
          第 {group.latestSave.turnCount} 回合
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!catalogComplete || loadingId !== null || deletingRootId !== null || deletingId !== null}
            onClick={() => onExportTree(group.rootId)}
            className="px-2.5 py-1 font-serif text-[11px] tracking-[0.14em] transition-all hover:opacity-90 disabled:opacity-50"
            style={{
              color: 'rgba(var(--tj-arcane-accent), 0.92)',
              boxShadow: 'inset 0 0 0 1px rgba(var(--tj-arcane-accent), 0.28)',
              clipPath: CLIP_SMALL,
            }}
          >
            导出整树
          </button>
          <button
            type="button"
            disabled={!catalogComplete || loadingId !== null || deletingRootId !== null || deletingId !== null}
            onClick={() => onDeleteTree(group.rootId, group.nodeCount)}
            className="px-2.5 py-1 font-serif text-[11px] tracking-[0.14em] transition-all hover:opacity-90 disabled:opacity-50"
            style={{
              color: 'rgba(var(--tj-danger), 0.92)',
              background: 'rgba(var(--tj-danger), 0.07)',
              boxShadow: 'inset 0 0 0 1px rgba(var(--tj-danger), 0.28)',
              clipPath: CLIP_SMALL,
            }}
          >
            {deletingRootId === group.rootId ? '删除中' : catalogComplete ? '删除整树' : '目录恢复后可删'}
          </button>
        </div>
      </div>
      <div className="relative space-y-2 pl-5">
        <span
          aria-hidden="true"
          className="absolute bottom-2 left-[7px] top-2 w-px"
          style={{ background: 'linear-gradient(rgb(var(--tj-arcane-accent)), rgba(var(--tj-arcane-accent),0.08))' }}
        />
        {group.nodes.map((node, index) => {
          const indent = Math.min(index, 5) * 14;
          return (
            <div key={node.save.id} className="relative" style={{ paddingLeft: indent }}>
              {node.depth > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute left-1 top-4 h-px"
                  style={{
                    width: Math.max(8, indent - 6),
                    background: 'rgba(var(--tj-arcane-accent),0.32)',
                  }}
                />
              )}
              <SaveCard
                save={node.save}
                loadingId={loadingId}
                deletingId={deletingId}
                onLoad={onLoad}
                onExport={onExport}
                onDelete={onDelete}
                treeLabel={node.isRoot ? '根节点' : `分支 +${node.depth}`}
                isLatest={node.isLatest}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function StorageTreeSelector({
  groups,
  selectedRootId,
  onSelect,
}: {
  groups: SaveTreeDisplayGroup[];
  selectedRootId: string | null;
  onSelect: (rootId: string) => void;
}) {
  return (
    <aside
      aria-label="存档树列表"
      className="teyvat-options-scroll min-h-0 p-3 pb-5 font-serif lg:max-h-[calc(100vh-330px)] lg:overflow-y-auto"
      style={{
        background: 'rgba(0,0,0,0.18)',
        boxShadow: 'inset 0 0 0 1px rgba(var(--tj-arcane-accent),0.12)',
        clipPath: CLIP_MEDIUM,
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-medium tracking-[0.22em]" style={{ color: 'rgba(var(--tj-arcane-accent),0.86)' }}>
          存档树列表
        </h3>
        <span className="text-[11px] tracking-[0.12em]" style={{ color: 'rgba(var(--tj-text-primary),0.42)' }}>
          点击切换
        </span>
      </div>
      <div className="grid gap-2">
        {groups.map((group) => {
          const active = group.rootId === selectedRootId;
          const title = group.latestSave.travelerName || group.rootSave.travelerName || '未命名旅人';
          return (
            <button
              key={group.rootId}
              type="button"
              aria-current={active || undefined}
              onClick={() => onSelect(group.rootId)}
              className="min-w-0 cursor-pointer px-3 py-2 text-left transition-all hover:opacity-90"
              style={{
                background: active
                  ? 'linear-gradient(90deg, rgba(var(--tj-arcane-accent),0.18), rgba(var(--tj-arcane-accent-deep),0.06))'
                  : 'rgba(var(--tj-arcane-accent),0.045)',
                boxShadow: active
                  ? 'inset 3px 0 0 rgb(var(--tj-arcane-accent)), inset 0 0 0 1px rgba(var(--tj-arcane-accent),0.32)'
                  : 'inset 0 0 0 1px rgba(var(--tj-arcane-accent),0.12)',
                clipPath: CLIP_SMALL,
              }}
            >
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span
                  className="truncate text-[13px] font-semibold tracking-[0.12em]"
                  style={{ color: active ? 'rgb(var(--tj-accent-secondary))' : 'rgba(var(--tj-text-primary),0.78)' }}
                >
                  {title}
                </span>
                <span className="shrink-0 text-[11px]" style={{ color: active ? 'rgb(var(--tj-arcane-accent))' : 'rgba(var(--tj-text-primary),0.42)' }}>
                  #{group.latestSave.id}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px] tracking-[0.1em]" style={{ color: 'rgba(var(--tj-text-primary),0.54)' }}>
                <span>{group.nodeCount} 节点</span>
                <span>{group.branchCount} 分支</span>
                <span>第 {group.latestSave.turnCount} 回合</span>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

export function StorageActionButton({
  label,
  tone = 'quiet',
  disabled,
  onClick,
}: {
  label: string;
  tone?: 'primary' | 'quiet';
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="w-full cursor-pointer px-4 py-2 text-sm font-serif tracking-[0.18em] transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
      style={{
        color: tone === 'primary' ? 'rgb(var(--tj-ui-active-text))' : 'rgba(var(--tj-arcane-accent),0.92)',
        background: tone === 'primary'
          ? 'linear-gradient(135deg, rgb(var(--tj-arcane-accent)), rgb(var(--tj-arcane-accent-deep)))'
          : 'rgba(var(--tj-arcane-accent),0.07)',
        boxShadow: tone === 'primary'
          ? 'inset 0 0 0 1px rgba(var(--tj-text-primary),0.55), 0 0 18px rgba(var(--tj-arcane-accent-deep),0.20)'
          : 'inset 0 0 0 1px rgba(var(--tj-arcane-accent),0.24)',
        clipPath: CLIP_SMALL,
      }}
    >
      {label}
    </button>
  );
}

function SaveCard({
  save,
  loadingId,
  deletingId,
  onLoad,
  onExport,
  onDelete,
  treeLabel,
  isLatest = false,
}: {
  save: SaveListItemSummary;
  loadingId: number | null;
  deletingId: number | null;
  onLoad: (id: number) => void;
  onExport: (id: number) => void;
  onDelete: (id: number) => void;
  treeLabel?: string;
  isLatest?: boolean;
}) {
  return (
    <div
      className={`grid min-w-0 gap-3 lg:grid-cols-[1fr_auto] ${isLatest ? 'p-4 lg:gap-4' : 'p-3'}`}
      style={{
        background: isLatest
          ? 'linear-gradient(135deg, rgba(var(--tj-arcane-accent),0.18), rgba(var(--tj-accent-primary),0.09)), rgba(var(--tj-panel-bg-start),0.92)'
          : 'rgba(var(--tj-panel-bg-start),0.74)',
        boxShadow: isLatest
          ? 'inset 0 0 0 1px rgba(var(--tj-accent-primary),0.46), inset 0 0 0 2px rgba(var(--tj-arcane-accent),0.08), 0 0 28px rgba(var(--tj-arcane-accent),0.10), 0 0 22px rgba(var(--tj-accent-primary),0.08)'
          : 'inset 0 0 0 1px rgba(var(--tj-arcane-accent),0.18)',
        clipPath: CLIP_MEDIUM,
      }}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className={`font-serif tracking-[0.16em] ${isLatest ? 'text-[12px]' : 'text-[11px]'}`} style={{ color: typeColor(save.type) }}>
            {typeLabel(save.type)}
          </span>
          <span className={`font-serif font-bold tracking-wider ${isLatest ? 'text-[17px]' : 'text-[15px]'}`} style={{ color: 'rgb(var(--tj-accent-secondary))' }}>
            {save.travelerName || '未命名旅人'}
          </span>
          <span className="text-[11px]" style={{ color: 'rgba(var(--tj-text-primary),0.42)' }}>#{save.id}</span>
          {treeLabel && (
            <span
              className="px-1.5 py-0.5 text-[10px] font-serif tracking-[0.12em]"
              style={{
                color: 'rgba(var(--tj-arcane-accent), 0.92)',
                background: 'rgba(var(--tj-arcane-accent), 0.09)',
                boxShadow: 'inset 0 0 0 1px rgba(var(--tj-arcane-accent), 0.25)',
                clipPath: CLIP_SMALL,
              }}
            >
              {treeLabel}
            </span>
          )}
          {isLatest && (
            <span
              className="px-1.5 py-0.5 text-[10px] font-serif tracking-[0.12em]"
              style={{
                color: 'rgb(var(--tj-accent-primary))',
                background: 'rgba(var(--tj-accent-primary),0.08)',
                boxShadow: insetRing(0.16),
                clipPath: CLIP_SMALL,
              }}
            >
              最新
            </span>
          )}
        </div>
        <div className={`flex flex-wrap gap-x-3 gap-y-1 font-serif tracking-wider ${isLatest ? 'mt-2 text-[13px]' : 'mt-1 text-[12px]'}`} style={{ color: 'rgba(var(--tj-text-primary),0.78)' }}>
          <span style={{ color: 'rgb(var(--tj-arcane-accent))' }}>第 {save.turnCount} 回合</span>
          <span>{[save.currentDate, save.currentTime, save.currentLocation].filter(Boolean).join(' / ') || save.worldPeriodName || '未知坐标'}</span>
          <span>{new Date(save.timestamp).toLocaleString('zh-CN')}</span>
          <span>体积估算 {formatByteSize(save.sizeBytes)}</span>
        </div>
        {save.lastSummary && (
          <div className={`leading-relaxed ${isLatest ? 'mt-2 line-clamp-3 text-[13px]' : 'mt-1.5 line-clamp-2 text-[12px]'}`} style={{ color: 'rgba(var(--tj-text-primary),0.62)' }}>
            {save.lastSummary}
          </div>
        )}
      </div>
      <div className="grid grid-cols-3 gap-1.5 sm:flex sm:flex-wrap sm:items-center">
        <StorageActionButton label={loadingId === save.id ? '读取中' : '读取'} disabled={loadingId !== null || deletingId !== null} onClick={() => onLoad(save.id)} />
        <StorageActionButton label="导出" disabled={loadingId !== null || deletingId !== null} onClick={() => onExport(save.id)} />
        <button
          type="button"
          disabled={loadingId !== null || deletingId !== null}
          onClick={() => onDelete(save.id)}
          className="w-full cursor-pointer px-3 py-2 text-[12px] font-serif tracking-[0.16em] transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          style={{
            color: 'rgba(var(--tj-danger),0.9)',
            boxShadow: 'inset 0 0 0 1px rgba(var(--tj-danger),0.28)',
            clipPath: CLIP_SMALL,
          }}
        >
          {deletingId === save.id ? '删除中' : '删除'}
        </button>
      </div>
    </div>
  );
}

function typeLabel(type: SaveListItemSummary['type']): string {
  if (type === 'auto') return '自动';
  if (type === 'backup') return '恢复点';
  if (type === 'imported') return '导入';
  return '手动';
}

function typeColor(type: SaveListItemSummary['type']): string {
  if (type === 'auto') return 'rgba(var(--tj-arcane-accent), 0.86)';
  if (type === 'backup') return 'rgba(var(--tj-arcane-accent), 0.9)';
  if (type === 'imported') return 'rgba(var(--tj-ui-success), 0.9)';
  return 'rgba(var(--tj-arcane-accent), 0.9)';
}
