import { useSyncExternalStore } from 'react';
import { getContentResourceStatuses, subscribeContentResourceStatuses } from '@/services/contentResourceStatus';

const labels = { loading: '加载中', ready: '已就绪', failed: '加载失败' } as const;

export function ContentResourceStatusPanel() {
  const statuses = useSyncExternalStore(subscribeContentResourceStatuses, getContentResourceStatuses);
  const failed = statuses.filter((status) => status.state === 'failed');
  const remaining = statuses.filter((status) => status.state !== 'failed');
  return (
    <section aria-label="内容资源诊断" className="space-y-2 rounded border border-[rgb(var(--tj-arcane-accent))]/20 px-3 py-2 text-xs text-[rgb(var(--tj-text-primary))]/80">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>内容资源诊断</span>
        <span>{statuses.length} 项 · {failed.length} 项失败</span>
      </div>
      {statuses.length === 0 && <p className="opacity-70">本次启动尚无资源加载记录。</p>}
      {failed.length > 0 && (
        <div role="alert" className="space-y-1">
          {failed.map((status) => (
            <p key={status.resourceId} className="break-all">
              {status.resourceId} · {labels[status.state]} · {status.stage}：{status.recoveryHint}
            </p>
          ))}
          <p>确认安装文件完整后重新加载页面；本页面不会自动重置存档或用户世界书。</p>
        </div>
      )}
      {remaining.length > 0 && (
        <details>
          <summary className="cursor-pointer">查看其余 {remaining.length} 项资源</summary>
          <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto break-all">
            {remaining.map((status) => <li key={status.resourceId}>{status.resourceId} · {labels[status.state]}{status.stage ? ` · ${status.stage}` : ''}</li>)}
          </ul>
        </details>
      )}
    </section>
  );
}
