import type { FactCandidate } from '@/core/contracts/event';
import type { ReceiptViewModel } from '@/core/settlement/receiptProjection';
import { groupCoreActions } from '@/core/settlement/dependencyGroups';

export interface PendingCoreReview { originOperationId: string; candidate: FactCandidate }
export function CoreReviewPanel({ receipt, pending, busy, onReview }: {
  receipt: ReceiptViewModel | null; pending: PendingCoreReview[]; busy: boolean;
  onReview: (operationId: string, candidate: FactCandidate, decision: 'accept' | 'reject') => Promise<unknown>;
}) {
  const origins = [...new Set(pending.map(row => row.originOperationId))];
  const groups = origins.flatMap(originOperationId => groupCoreActions(pending.filter(row => row.originOperationId === originOperationId).map(({ candidate }) => ({ kind: 'narrative' as const, actionId: candidate.candidateId, candidate })))
    .map(group => ({ originOperationId, members: group.actions.flatMap(action => action.kind === 'narrative' ? [action.candidate] : []) })));
  return <section className="core2-card" aria-label="结算与核对">
    <h2>这一页的变化</h2>
    {receipt && <><p role="status">{receipt.saved ? '核心已保存' : '核心未保存'}{receipt.memoryPending ? ' · 记忆整理尚未完成，不影响已保存的状态' : ''}</p>{receipt.reason && <p role="alert">{receipt.reason}</p>}<details><summary>查看已提交的变化与来源</summary>{receipt.changes.map(change => <p key={change.effectKey}>{change.ref.domain} · {change.ref.entityId} · 版本 {change.ref.version} → {change.after?.version ?? '已移除'}</p>)}{receipt.sourceRefs.map(ref => <p key={ref.sourceId}>{ref.sourceId} · 来源版本 {ref.sourceVersion}</p>)}</details></>}
    {groups.map(({ originOperationId, members }) => <article key={`${originOperationId}:${members[0]!.candidateId}`}><h3>待核对：{members.length > 1 ? `${members.length} 项关联变化` : members[0]!.kind}</h3>
      {members.map(candidate => <div key={candidate.candidateId}><p>{candidate.reason || '这项内容尚未成为确定事实。'}</p>{candidate.evidenceRefs.map((ref, index) => <blockquote key={index}>{ref.quote}<small>（来源版本 {ref.ref.sourceVersion}）</small></blockquote>)}<details><summary>查看拟议变化</summary><pre>{JSON.stringify(candidate.proposal, null, 2)}</pre></details></div>)}
      <p>{members.length > 1 ? '这些变化依赖同一份证据，确认或拒绝会对本组一起处理，不会只扣物品或只涨任务进度。' : ''}确认只会按当前状态重新检查并记录本次决定，不会改写原始回合。库存不足、前置未完成等限制仍然生效。</p>
      <button disabled={busy} onClick={() => { void onReview(originOperationId, members[0]!, 'accept'); }}>{members.length > 1 ? '确认整组并重新校验' : '确认并重新校验'}</button><button disabled={busy} onClick={() => { void onReview(originOperationId, members[0]!, 'reject'); }}>{members.length > 1 ? '拒绝整组' : '拒绝此项'}</button></article>)}
  </section>;
}
