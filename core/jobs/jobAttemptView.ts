import type { CoreScope } from '../contracts/identity';
import type { CoreRepository } from '../contracts/storage';
import type { JobRecord } from '../contracts/memory';
import { sameScope } from '../persistence/repositoryValidation';

/** Exact metadata reads only; no task execution or raw source reads while projecting a view. */
export async function readCoreJobAttemptView(repo: CoreRepository, scope: CoreScope, cutoffSeq: number, ids: string[]): Promise<JobRecord[]> {
  const seen = new Set<string>(), rows: JobRecord[] = []; let pending = [...new Set(ids)];
  while (pending.length) {
    if (seen.size > 1000) throw Error('CORE2_JOB_RETRY_CHAIN_INVALID');
    const batch = pending.splice(0, 200).filter(id => !seen.has(id));
    if (!batch.length) continue;
    batch.forEach(id => seen.add(id));
    const page = await repo.queryJobs({ scope, cutoffSeq, jobIds: batch, limit: 200 }); rows.push(...page.items);
    pending.push(...page.items.flatMap(job => job.retriedByJobId && !seen.has(job.retriedByJobId) ? [job.retriedByJobId] : []));
  }
  return rows;
}
export function coreJobAttemptsPending(scope: CoreScope, operationId: string | undefined, ids: string[], jobs: JobRecord[]): boolean {
  const indexed = new Map(jobs.filter(job => sameScope(job.scope, scope) && (!operationId || job.operationId === operationId)).map(job => [job.jobId, job]));
  return ids.some(id => {
    const seen = new Set<string>(); let job = indexed.get(id);
    while (job?.retriedByJobId) {
      if (seen.has(job.jobId)) return true;
      seen.add(job.jobId); const next = indexed.get(job.retriedByJobId);
      if (!next || next.retryOfJobId !== job.jobId) return true;
      job = next;
    }
    return !job || job.status !== 'completed' && job.publicationReceipt?.status !== 'published';
  });
}
