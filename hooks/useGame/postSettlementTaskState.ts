import type { TeyvatGameState } from '@/models/teyvat/state';

export type SettlementTailTask = 'memory' | 'npcStory' | 'phone' | 'elements';
/** Only the latest settlement is retained; task markers travel with the save, not a process-global cache. */
export function hasSettlementTailTask(game: TeyvatGameState, settlementId: string, task: SettlementTailTask): boolean {
  return game.叙事.postSettlementTasks?.settlementId === settlementId
    && game.叙事.postSettlementTasks.completed.includes(task);
}
export function markSettlementTailTask(game: TeyvatGameState, settlementId: string, task: SettlementTailTask): TeyvatGameState {
  if (hasSettlementTailTask(game, settlementId, task)) return game;
  const previous = game.叙事.postSettlementTasks;
  return { ...game, 叙事: { ...game.叙事, postSettlementTasks: {
    settlementId, completed: [...(previous?.settlementId === settlementId ? previous.completed : []), task],
  } } };
}
