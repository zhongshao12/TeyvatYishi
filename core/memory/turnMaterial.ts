import type { CoreRepository } from '../contracts/storage';
import type { CoreScope } from '../contracts/identity';
import type { SourceRecord, GameEvent } from '../contracts/event';
export async function readCoreTurnMaterial(repo: CoreRepository, input: { scope: CoreScope; cutoffSeq: number; operationId: string }) {
  input = structuredClone(input);
  const operation = await repo.readOperation(input.scope, input.operationId);
  if (!operation || !['main', 'courier', 'moment', 'manual'].includes(operation.kind) || operation.status !== 'committed' || !operation.receipt || operation.receipt.coreSeq > input.cutoffSeq) throw Error('所选回合或交流尚未提交或超出冻结范围。');
  const sources: SourceRecord[] = [], events: GameEvent[] = [];
  // Exact-ID batches cannot need a continuation cursor and never load unrelated bodies.
  for (let start = 0; start < operation.sourceRefs.length; start += 100) {
    const page = await repo.querySources({ scope: input.scope, cutoffSeq: input.cutoffSeq, refs: operation.sourceRefs.slice(start, start + 100), limit: 200 });
    if (page.nextCursor) throw Error('来源索引异常，未猜测不完整材料。'); sources.push(...page.items);
  }
  for (let start = 0; start < operation.receipt.eventIds.length; start += 100) {
    const page = await repo.queryEvents({ scope: input.scope, cutoffSeq: input.cutoffSeq, eventIds: operation.receipt.eventIds.slice(start, start + 100), limit: 200 });
    if (page.nextCursor) throw Error('事件索引异常，未猜测不完整材料。'); events.push(...page.items);
  }
  if (sources.length !== operation.sourceRefs.length || events.length !== operation.receipt.eventIds.length) throw Error('原始回合材料缺失，不能补造记忆。');
  if (operation.kind === 'manual' && !events.some(event => event.type === 'game.doudizhu.completed' && event.fact?.kind === 'experience')) throw Error('普通手动编辑不作为完整经历生成摘要。');
  return { operation, sources, events };
}
