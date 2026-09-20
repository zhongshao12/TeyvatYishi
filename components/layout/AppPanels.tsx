import { insetRing } from '@/styles/clipPaths';
import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import type { MemoryRebuildProgress, MemoryRebuildTask } from '@/services/memoryRebuild';

const memoryRebuildPanelStyle = {
  background: 'rgba(var(--tj-surface-strong),0.72)',
  boxShadow: 'inset 0 0 0 1px rgba(var(--tj-border),0.55)',
};

export function LazySurfaceFallback({ label = '系统载入中' }: { label?: string }) {
  return (
    <div className="flex min-h-[180px] items-center justify-center p-6 text-sm" style={{ color: 'rgba(var(--tj-text-secondary),0.82)' }}>
      {label}
    </div>
  );
}

export function MemoryRebuildModal({
  defaultEnd,
  onClose,
  onAbort,
  onRun,
}: {
  defaultEnd: number;
  onClose: () => void;
  onAbort: () => void;
  onRun: (options: {
    batchSize: number;
    range: { start: number; end: number };
    task?: MemoryRebuildTask;
    onProgress: (progress: MemoryRebuildProgress) => void;
  }) => Promise<MemoryRebuildTask>;
}) {
  const [start, setStart] = useState(1);
  const [end, setEnd] = useState(Math.max(1, defaultEnd));
  const [batchSize, setBatchSize] = useState(15);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<MemoryRebuildProgress | null>(null);
  const [result, setResult] = useState<MemoryRebuildTask | null>(null);
  const [error, setError] = useState('');

  const handleRun = async () => {
    setRunning(true);
    setResult(null);
    setError('');
    try {
      const task = await onRun({
        batchSize: Math.max(1, Math.min(100, Math.trunc(batchSize) || 15)),
        range: {
          start: Math.max(1, Math.trunc(start) || 1),
          end: Math.max(1, Math.trunc(end) || Math.max(1, defaultEnd)),
        },
        task: result?.status === 'paused_failed' ? result : undefined,
        onProgress: setProgress,
      });
      setResult(task);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '批量重建失败。');
    } finally {
      setRunning(false);
    }
  };

  const handleClose = () => {
    if (running) onAbort();
    onClose();
  };
  const statusText = result?.status === 'committed'
    ? `已重建 ${result.progress.processedTurns} 回合，四层记忆已一次性替换并自动保存。`
    : result?.status === 'paused_failed'
      ? `在第 ${result.failedBatch?.sourceTurns.start ?? '?'}-${result.failedBatch?.sourceTurns.end ?? '?'} 回合暂停；原记忆未改动，失败批次已保存到失败草稿。`
      : result?.status === 'blocked'
        ? result.blockedReason ?? '当前设置不允许批量重建。'
        : result?.status === 'cancelled'
          ? '重建已取消，原记忆未改动。'
          : '';

  return (
    <Modal title="批量重建记忆" onClose={handleClose} className="max-w-xl">
      <div className="grid gap-4">
        <div className="px-3 py-3 text-[13px] leading-relaxed" style={{ ...memoryRebuildPanelStyle, color: 'rgba(var(--tj-text-secondary),0.86)' }}>
          系统会从存档中的历史正文按回合顺序重新总结。处理中只写入临时 staging；全部批次成功后才替换即时、短期、中期、长期记忆，失败或取消都不会覆盖原记忆。
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField label="开始回合" value={start} min={1} max={Math.max(1, defaultEnd)} disabled={running || result?.status === 'paused_failed'} onChange={setStart} />
          <NumberField label="结束回合" value={end} min={1} max={Math.max(1, defaultEnd)} disabled={running || result?.status === 'paused_failed'} onChange={setEnd} />
          <NumberField label="每批回合" value={batchSize} min={1} max={100} disabled={running || result?.status === 'paused_failed'} onChange={setBatchSize} />
        </div>
        {progress && (
          <div className="px-3 py-3" style={memoryRebuildPanelStyle}>
            <div className="flex items-center justify-between gap-3 text-[12px]" style={{ color: 'rgba(var(--tj-text-secondary),0.84)' }}>
              <span>{running ? '正在重建' : '处理结果'}</span>
              <span>{progress.completedBatches}/{progress.totalBatches} 批 · {progress.processedTurns}/{progress.totalTurns} 回合</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden bg-[rgba(var(--tj-text-secondary),0.12)]">
              <div
                className="h-full bg-[rgb(var(--tj-accent-primary))] transition-[width] duration-200"
                style={{ width: `${progress.totalBatches ? Math.round(progress.completedBatches / progress.totalBatches * 100) : 0}%` }}
              />
            </div>
          </div>
        )}
        {(statusText || error) && (
          <div className="px-3 py-3 text-[13px] leading-relaxed" style={{ ...memoryRebuildPanelStyle, color: error || result?.status === 'paused_failed' || result?.status === 'blocked' ? 'rgba(var(--tj-danger),0.95)' : 'rgba(var(--tj-ui-success),0.95)' }}>
            {error || statusText}
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          {!running && result?.status === 'paused_failed' && (
            <button
              type="button"
              onClick={() => {
                setResult(null);
                setProgress(null);
              }}
              className="teyvat-close-btn px-4 py-2 text-sm"
            >
              放弃本次进度
            </button>
          )}
          {running ? (
            <button type="button" onClick={onAbort} className="teyvat-close-btn px-4 py-2 text-sm">取消重建</button>
          ) : (
            <button type="button" onClick={handleClose} className="teyvat-close-btn px-4 py-2 text-sm">关闭</button>
          )}
          <button
            type="button"
            onClick={() => void handleRun()}
            disabled={running}
            className="px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-45"
            style={{ color: 'rgb(var(--tj-text-primary))', boxShadow: insetRing(0.5), background: 'rgba(var(--tj-accent-primary),0.12)' }}
          >
            {running ? '重建中...' : result?.status === 'paused_failed' ? '从失败批次继续' : '开始重建'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function NumberField({
  label,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid min-w-0 gap-1.5 text-[12px]" style={{ color: 'rgba(var(--tj-text-secondary),0.82)' }}>
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="min-w-0 bg-[rgba(var(--tj-bg-primary),0.55)] px-3 py-2 outline-none disabled:opacity-50"
        style={{ color: 'rgb(var(--tj-text-primary))', boxShadow: 'inset 0 0 0 1px rgba(var(--tj-border),0.6)' }}
      />
    </label>
  );
}
