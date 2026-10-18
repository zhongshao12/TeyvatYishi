import type { MemoryRecord } from '../contracts/memory';
import type { MaintenanceInput, MaintenanceStep } from './maintenancePlan';
import { sourceRefKey } from '../persistence/repositoryValidation';
import { validateCoreDto } from '../contracts/validation';

export function planCoreRebuild(input: MaintenanceInput): { steps: MaintenanceStep[]; replaceable: MemoryRecord[] } {
  const selected = new Set(input.selectedTurns ?? input.turns.map(turn => turn.completion.turn));
  const turns = input.turns.filter(({ operation, completion }) => selected.has(completion.turn) && operation.kind === 'main' && operation.status === 'committed' && operation.receipt && operation.receipt.coreSeq <= input.cutoffSeq
    && validateCoreDto('event', completion).ok && completion.type === 'turn.complete' && completion.operationId === operation.operationId && operation.receipt.eventIds.includes(completion.eventId));
  if (new Set(turns.map(turn => turn.completion.turn)).size !== selected.size) throw Error('所选范围缺少完整回合来源，不能补造摘要。');
  const refs = new Set(turns.flatMap(turn => turn.operation.sourceRefs.map(sourceRefKey)));
  return { steps: turns.sort((a, b) => a.completion.turn - b.completion.turn).map(({ operation }, index) => ({ stepId: `turn-${index}`, kind: 'turn', layer: 'short', memoryRefs: [], operationId: operation.operationId })),
    replaceable: input.memories.filter(memory => memory.status === 'active' && !memory.pinned && memory.editVersion === 0 && memory.turns.length > 0 && memory.turns.every(turn => selected.has(turn)) && memory.sourceRefs.length > 0 && memory.sourceRefs.every(ref => refs.has(sourceRefKey(ref)))) };
}
