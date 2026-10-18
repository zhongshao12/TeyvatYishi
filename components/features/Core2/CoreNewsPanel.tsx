import { useEffect, useState } from 'react';
import type { CoreController } from '@/core/settlement/coreController';
import type { CoreRepository } from '@/core/contracts/storage';
import type { CoreSnapshot, StateRecord } from '@/core/contracts/state';
import type { BranchHead } from '@/core/contracts/identity';
import type { JobRecord } from '@/core/contracts/memory';
import { useCore2Query } from '@/hooks/useCore2Query';
import { readCoreNewsArticles } from '@/core/jobs/newsJob';
import { readCoreNewsPlan } from '@/core/jobs/newsPlan';
import { sanitizeApiErrorReportText } from '@/services/ai/apiErrorReportService';

function CoreNewsIssue({ issue, head, repo }: { issue: StateRecord<'news'>; head: BranchHead; repo: CoreRepository }) {
  const [open, setOpen] = useState(false), [position] = useState(head);
  // The body is immutable. Background job progress must not repeatedly read it.
  const source = useCore2Query(open ? { kind: 'source', head: position, ref: issue.value.sourceRef } : null, repo);
  let articles: ReturnType<typeof readCoreNewsArticles> = [], error = '';
  try { if (source.items[0]) articles = readCoreNewsArticles(source.items[0]); } catch (failure) { error = sanitizeApiErrorReportText(String(failure)); }
  const moment = issue.value.moment;
  return <article className="core2-record-entry"><button data-issue-id={issue.entityId} onClick={() => setOpen(value => !value)} aria-expanded={open}>阅读简报 · 第 {moment.turn} 回合</button>
    <p>{moment.date ?? '日期未记录'} {moment.clock ?? ''} · {moment.weather ?? '天气未记录'} · {moment.location ?? '地点未记录'} · 旅行第 {moment.travelDay ?? '?'} 天</p>
    {open && <>{source.loading && <p role="status">正在翻开这一期……</p>}{articles.map((row, index) => <section key={index}><h3>{row.title}</h3><p>{row.lead}</p><p>{row.body}</p><small>依据 {row.eventIds.length} 条已确认公开事件</small></section>)}{(source.error || error) && <p role="alert">{source.error || error}</p>}</>}
  </article>;
}
export function CoreNewsPanel({ controller, repo, snapshot, revision, disabled = false }: { controller: CoreController; repo: CoreRepository; snapshot: CoreSnapshot; revision: number; disabled?: boolean }) {
  const [count, setCount] = useState(50), [busy, setBusy] = useState(false), [error, setError] = useState(''), [lastJob, setLastJob] = useState(''), [job, setJob] = useState<JobRecord | null>(null);
  const { scope, sessionId, coreSeq } = snapshot.head;
  const issues = snapshot.records.filter((row): row is StateRecord<'news'> => row.domain === 'news').sort((a, b) => b.value.moment.turn - a.value.moment.turn || b.entityId.localeCompare(a.entityId));
  useEffect(() => {
    let live = true; if (!lastJob) return;
    void repo.queryJobs({ scope, cutoffSeq: coreSeq, jobIds: [lastJob], limit: 1 }).then(result => { if (live) setJob(result.items[0] ?? null); }).catch(failure => { if (live) setError(sanitizeApiErrorReportText(String(failure))); });
    return () => { live = false; };
  }, [repo, scope, sessionId, coreSeq, revision, lastJob]);
  const generate = async () => {
    if (disabled || busy) return; setBusy(true); setError('');
    try { const receipt = await controller.requestNews(); setLastJob(receipt.jobIds[0] ?? ''); }
    catch (failure) { setError(sanitizeApiErrorReportText(String(failure))); } finally { setBusy(false); }
  };
  const retry = async () => { setBusy(true); setError(''); try { const result = await controller.retryJob(lastJob); setLastJob(result.jobId); if (result.kind !== 'completed') setError(result.detail ?? '简报尚未完成，可在失败结算中心继续查看。'); } catch (failure) { setError(sanitizeApiErrorReportText(String(failure))); } finally { setBusy(false); } };
  let completedIssue = false;
  try { if (job) completedIssue = issues.some(row => row.entityId === readCoreNewsPlan(job).issueId); } catch { /* Invalid task metadata is shown in the failure center. */ }
  return <section className="core2-card" aria-label="蒸汽鸟报"><h2>蒸汽鸟报</h2><p>独立生成短简报，只使用已确认公开的事件；不会读取私聊或私密经历。打开页面不会调用模型。</p>
    <button disabled={disabled || busy || job?.status === 'running' || job?.status === 'pending'} onClick={() => void generate()}>生成本期简报</button>
    {job && <p role="status">{job.status === 'completed' ? completedIssue ? '本期简报已保存。' : '没有已确认公开的事实可供报道。' : job.status === 'failed' ? job.failure?.detail ?? '本期简报生成失败，剧情未受影响。' : job.status === 'cancelled' ? '本期简报已停止。' : '正在准备本期简报……'}</p>}
    {job && ['failed', 'cancelled'].includes(job.status) && <button disabled={disabled || busy} onClick={() => void retry()}>重试本期简报</button>}
    {issues.slice(0, count).map(issue => <CoreNewsIssue key={issue.entityId + ':' + sessionId} {...{ issue, head: snapshot.head, repo }} />)}
    {!issues.length && <p>尚未刊登简报。公开事件足够时再来看看。</p>}{issues.length > count && <button onClick={() => setCount(value => value + 50)}>再看50期</button>}{error && <p role="alert">{error}</p>}
  </section>;
}
