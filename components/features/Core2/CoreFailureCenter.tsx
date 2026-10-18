import { useState } from 'react';
import type { CoreRepository } from '@/core/contracts/storage';
import type { BranchHead } from '@/core/contracts/identity';
import { useCore2Query } from '@/hooks/useCore2Query';

export interface CoreFailureActions { onRetryJob(id: string): Promise<unknown>; onStopJob(id: string): Promise<unknown>; onRetryTurn(id: string): Promise<unknown>; onStopTurn(id: string): Promise<unknown> }
export function CoreFailureCenter({ repo, head, revision = 0, ...actions }: { repo: CoreRepository; head: BranchHead; revision?: number } & CoreFailureActions) {
  const jobs = useCore2Query({ kind: 'failure', head, category: 'job' }, repo, revision), operations = useCore2Query({ kind: 'failure', head, category: 'operation' }, repo, revision);
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState('');
  const run = async (id: string, work: () => Promise<unknown>) => { setBusy(id); setError(''); try { await work(); jobs.refresh(); operations.refresh(); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); } finally { setBusy(null); } };
  return <section className="core2-card" aria-label="失败结算中心"><h2>失败结算中心</h2><p>剧情已保存与后台任务失败分别记录；重试不会重新生成已保存正文。</p>
    {[operations, jobs].map((view, index) => <section key={index} aria-label={index ? '后台任务' : '主流程'}><h3>{index ? '后台任务' : '主流程'}</h3>
      {view.loading && <p role="status">正在读取这一页……</p>}{view.error && <p role="alert">{view.error}</p>}
      {view.items.map(item => <article key={`${item.category}:${item.id}`}><h4>{item.title}</h4><p>{item.detail}</p><small>{item.id}</small>
        {item.canRetry && <button disabled={busy !== null} onClick={() => void run(item.id, () => item.category === 'job' ? actions.onRetryJob(item.id) : actions.onRetryTurn(item.id))}>{item.category === 'job' ? '重试此任务' : '重试本回合'}</button>}
        {item.canStop && <button disabled={busy !== null} onClick={() => void run(item.id, () => item.category === 'job' ? actions.onStopJob(item.id) : actions.onStopTurn(item.id))}>{item.category === 'job' ? '停止此任务' : '停止本回合'}</button>}
      </article>)}{view.cursor && <button disabled={view.loading} onClick={() => void view.loadMore()}>加载下一页</button>}
    </section>)}{error && <p role="alert">{error}</p>}</section>;
}
