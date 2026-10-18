import type { CoreRecallRequest, CoreRecallResult, MemoryContextBundle, RecallItem } from './recallTypes';
export type { MemoryContextBundle } from './recallTypes';

/** Conservative local estimate, not a provider tokenizer or reported API usage. */
export const estimateCoreMemoryTokens = (text: string): number => Math.ceil(Array.from(text).length * 0.75);
const render = (item: RecallItem) => JSON.stringify({ kind: item.kind, eventIds: item.leafIds, ...(item.speakerId ? { speakerId: item.speakerId, meaning: '记录说过这句话，不证明话中宣称已发生。' } : {}), ...(item.meaning ? { meaning: item.meaning } : {}), ...(item.commitmentId ? { commitmentId: item.commitmentId, state: 'due_not_fulfilled' } : {}), text: item.text });
export function assembleCoreMemoryContext(result: CoreRecallResult, request: CoreRecallRequest): MemoryContextBundle {
  if (result.scope.journeyId !== request.scope.journeyId || result.scope.branchId !== request.scope.branchId
    || result.coreSeq !== request.head.coreSeq || result.memoryRevision !== request.head.memoryRevision
    || JSON.stringify(result.audience) !== JSON.stringify(request.audience)) throw Error('CORE2_RECALL_BUNDLE_MISMATCH');
  const mandatoryText = result.mandatory.map(render).join('\n'), optional: string[] = [];
  let estimatedTokens = estimateCoreMemoryTokens(mandatoryText);
  const diagnostics = [...result.diagnostics], selected = new Set(result.mandatory.flatMap(row => row.leafIds));
  const budget = request.optionalTokenBudget;
  if (budget !== undefined && (!Number.isSafeInteger(budget) || budget < 0)) throw Error('CORE2_RECALL_BUDGET_INVALID');
  for (const item of result.optional) {
    const text = render(item), cost = estimateCoreMemoryTokens(text);
    if (budget !== undefined && estimatedTokens + cost > budget) { diagnostics.push({ id: item.memoryId ?? item.eventId, reason: 'optional_budget_excluded' }); continue; }
    optional.push(text); estimatedTokens += cost; item.leafIds.forEach(id => selected.add(id));
  }
  return { bundleId: result.bundleId, mandatoryText, optionalText: optional.join('\n'), selectedLeafIds: [...selected], estimatedTokens,
    budgetOverflow: budget !== undefined && estimateCoreMemoryTokens(mandatoryText) > budget, diagnostics };
}
