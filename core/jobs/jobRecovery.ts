import type { CoreScope } from '../contracts/identity';
import type { CoreRepository } from '../contracts/storage';
import type { JobRecord } from '../contracts/memory';

export interface JobRecoverySummary { items: { job: JobRecord; resultUnconfirmed: boolean; explanation: string }[] }
/** Inspection never resumes a provider call. The player explicitly chooses a retry. */
export async function recoverCoreJobs(repo: CoreRepository, scope: CoreScope): Promise<JobRecoverySummary> {
  scope = structuredClone(scope);
  const head = await repo.readHead(scope), items: JobRecoverySummary['items'] = []; let cursor: string | undefined;
  do {
    const page = await repo.queryJobs({ scope, cutoffSeq: head.coreSeq, statuses: ['pending', 'running', 'failed'], limit: 50, ...(cursor ? { cursor } : {}) });
    for (const job of page.items) items.push({ job, resultUnconfirmed: job.status === 'running' && job.publicationReceipt?.status !== 'published', explanation: job.publicationReceipt?.status === 'published' ? '记忆已经发布；只需恢复完成标记，不再调用模型。' : job.status === 'running' ? '执行中的步骤结果未确认；手动重试可能再次调用模型并产生费用。已保存的成功步骤会复用。' : job.status === 'failed' ? '已失败，等待手动重试；刷新不会自动调用模型。' : '等待执行；查看此列表不会调用模型。' });
    cursor = page.nextCursor;
  } while (cursor);
  return { items };
}
