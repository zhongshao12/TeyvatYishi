import { insetRing } from '@/styles/clipPaths';
import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import type { MemoryRebuildProgress, MemoryRebuildTask } from '@/services/memoryRebuild';
import type { 聊天消息 } from '@/models/chat';

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
  chatHistory,
}: {
  defaultEnd: number;
  onClose: () => void;
  onAbort: () => void;
  chatHistory?: 聊天消息[];
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
  const [preview, setPreview] = useState<{ calls: number; warnings: string[] } | null>(null);
  const runningRef = useRef(false); const runSequence = useRef(0); const abortRef = useRef(onAbort); abortRef.current = onAbort;
  const resumable = result?.status === 'paused_failed' || (result?.status === 'committed' && result.persistence === 'failed');
  useEffect(() => {
    if (!chatHistory || running || resumable) return;
    let active = true; setPreview(null);
    void import('@/services/memoryRebuild').then(({ createMemoryRebuildTask }) => {
      const task = createMemoryRebuildTask({ chatHistory, batchSize, range: { start, end } });
      if (active) setPreview({ calls: task.turns.length, warnings: task.warnings });
    }).catch(() => { if (active) setError('历史回合预览未载入，请关闭后重试。'); });
    return () => { active = false; };
  }, [chatHistory, start, end, batchSize, running, resumable]);
  useEffect(() => () => { runSequence.current++; if (runningRef.current) { runningRef.current = false; abortRef.current(); } }, []);

  const handleRun = async () => {
    if (runningRef.current || (chatHistory && !preview)) return;
    runningRef.current = true; const sequence = ++runSequence.current;
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
        task: resumable ? result ?? undefined : undefined,
        onProgress: progress => { if (sequence === runSequence.current) setProgress({ ...progress }); },
      });
      if (sequence === runSequence.current) { setResult(task); setProgress({ ...task.progress }); }
    } catch (cause) {
      if (sequence === runSequence.current) setError(cause instanceof Error ? cause.message : '批量重建失败。');
    } finally {
      if (sequence === runSequence.current) { runningRef.current = false; setRunning(false); }
    }
  };
  const handleCancel = () => {
    if (!runningRef.current) return;
    runSequence.current++; runningRef.current = false; onAbort(); setRunning(false); setResult(null);
    setError('本次重建已取消，未提交结果不会覆盖现有记忆。');
  };
  const handleClose = () => {
    handleCancel();
    onClose();
  };
  const statusText = result?.status === 'committed'
    ? result.persistence === 'saved'
      ? `已重建 ${result.progress.processedTurns} 个完整回合，所选来源已合并并保存；范围外和受保护资料保留。`
      : result.persistence === 'failed' ? '页面已合并，但保存失败；可只重试保存，不重复请求模型。' : '页面已合并，保存尚未确认。'
    : result?.status === 'paused_failed'
      ? `在第 ${result.failedBatch?.sourceTurns.start ?? '?'}-${result.failedBatch?.sourceTurns.end ?? '?'} 回合暂停；原记忆未覆盖。${result.persistence === 'saved' ? '失败材料已保存到失败草稿。' : '失败材料保存尚未确认。'}`
      : result?.status === 'blocked'
        ? result.blockedReason ?? '当前设置不允许批量重建。'
        : result?.status === 'cancelled'
          ? '重建已取消，未提交结果不会覆盖现有记忆。'
          : '';

  return (
    <Modal title="批量重建记忆" onClose={handleClose} className="max-w-xl" portal layer="nested">
      <div className="grid gap-4">
        <div className="px-3 py-3 text-[13px] leading-relaxed" style={{ ...memoryRebuildPanelStyle, color: 'rgba(var(--tj-text-secondary),0.86)' }}>
          每个完整回合独立总结，原文与来源回合保留。全部成功后仅替换所选可定位、未被手动编辑的来源；范围外、跨范围和无法定位的旧记忆保留。分层晋升与重试可能增加调用。
        </div>
        <p role="status" className="text-sm">{preview ? `可恢复 ${preview.calls} 个完整回合 · 基础模型调用：${preview.calls} 次` : chatHistory ? '正在核对完整历史回合…' : `所选最多 ${Math.max(0, end - start + 1)} 回合；实际调用以完整正文为准。`}</p>
        {(result?.warnings ?? preview?.warnings)?.length ? <ul className="max-h-40 overflow-y-auto space-y-1 text-xs break-words" aria-label="来源保留与缺口提示">
          {(result?.warnings ?? preview?.warnings ?? []).map((warning, index) => <li key={index}>{warning}</li>)}
        </ul> : null}
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField label="开始回合" value={start} min={1} max={Math.max(1, defaultEnd)} disabled={running || resumable} onChange={setStart} />
          <NumberField label="结束回合" value={end} min={1} max={Math.max(1, defaultEnd)} disabled={running || resumable} onChange={setEnd} />
          <NumberField label="进度分组回合" value={batchSize} min={1} max={100} disabled={running || resumable} onChange={setBatchSize} />
        </div>
        {progress && (
          <div className="px-3 py-3" style={memoryRebuildPanelStyle}>
            <div className="flex items-center justify-between gap-3 text-[12px]" style={{ color: 'rgba(var(--tj-text-secondary),0.84)' }}>
              <span>{progress.phase === 'saving' ? '正在保存' : progress.phase === 'turns' ? '逐回合总结' : progress.phase === 'short' ? '短期整理' : progress.phase === 'middle' ? '中期整理' : progress.phase === 'long' ? '长期整理' : running ? '正在重建' : '处理结果'} · 当前回合：{progress.currentTurn ?? '—'}</span>
              <span>{progress.completedBatches}/{progress.totalBatches} 批 · {progress.processedTurns}/{progress.totalTurns} 回合</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden bg-[rgba(var(--tj-text-secondary),0.12)]">
              <div
                className="h-full bg-[rgb(var(--tj-accent-primary))] transition-[width] duration-200"
                style={{ width: `${progress.totalTurns ? Math.round(progress.processedTurns / progress.totalTurns * 100) : 0}%` }}
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
            <button type="button" onClick={handleCancel} className="teyvat-close-btn px-4 py-2 text-sm">取消重建</button>
          ) : (
            <button type="button" onClick={handleClose} className="teyvat-close-btn px-4 py-2 text-sm">关闭</button>
          )}
          <button
            type="button"
            onClick={() => void handleRun()}
            disabled={running || Boolean(chatHistory && !preview)}
            className="px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-45"
            style={{ color: 'rgb(var(--tj-text-primary))', boxShadow: insetRing(0.5), background: 'rgba(var(--tj-accent-primary),0.12)' }}
          >
            {running ? '重建中...' : result?.status === 'committed' && result.persistence === 'failed' ? '重试保存' : result?.status === 'paused_failed' ? '从失败回合或阶段继续' : '开始重建'}
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
