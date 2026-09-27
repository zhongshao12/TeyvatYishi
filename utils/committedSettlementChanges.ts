import type { TeyvatGameState } from '@/models/teyvat/state';
import type { QuestEntry, QuestStatus } from '@/models/teyvat/runtimeSlices';
import type { CommittedSettlementChange } from '@/models/variableCommand';

const MAX_CHANGES = 50;
const safeName = (value: string, fallback: string): string =>
  (value || fallback).replace(/[\u0000-\u001f\u007f]/gu, ' ').trim().slice(0, 80) || fallback.slice(0, 80);

function questMap(state: TeyvatGameState): Map<string, QuestEntry> {
  return new Map([...state.任务.active, ...state.任务.completed, ...state.任务.abandoned].map((quest) => [quest.id, quest]));
}

/** Bounded receipt facts derived exclusively from the before/after committed roots. */
export function projectCommittedSettlementChanges(
  before: TeyvatGameState,
  after: TeyvatGameState,
): { changes: CommittedSettlementChange[]; omitted: number } {
  const changes: CommittedSettlementChange[] = [];
  const beforeItems = new Map(before.背包.items.map((item) => [item.id, item]));
  const afterItems = new Map(after.背包.items.map((item) => [item.id, item]));
  for (const id of new Set([...beforeItems.keys(), ...afterItems.keys()])) {
    const oldItem = beforeItems.get(id);
    const newItem = afterItems.get(id);
    const oldQuantity = oldItem?.quantity ?? 0;
    const newQuantity = newItem?.quantity ?? 0;
    if (oldQuantity !== newQuantity) changes.push({
      kind: 'item', id, name: safeName(newItem?.name ?? oldItem?.name ?? id, id),
      before: oldQuantity, after: newQuantity,
    });
  }

  const beforeNpcs = new Map(before.NPC.map((npc) => [npc.id, npc]));
  for (const npc of after.NPC) {
    const oldNpc = beforeNpcs.get(npc.id);
    if (!oldNpc || !Number.isFinite(oldNpc.affinity) || !Number.isFinite(npc.affinity) || oldNpc.affinity === npc.affinity) continue;
    changes.push({ kind: 'affinity', id: npc.id, name: safeName(npc.姓名, npc.id), before: oldNpc.affinity, after: npc.affinity });
  }

  const oldQuests = questMap(before);
  const newQuests = questMap(after);
  for (const id of new Set([...oldQuests.keys(), ...newQuests.keys()])) {
    const oldQuest = oldQuests.get(id);
    const newQuest = newQuests.get(id);
    const oldStatus: QuestStatus | 'absent' = oldQuest?.status ?? 'absent';
    const newStatus: QuestStatus | 'absent' = newQuest?.status ?? 'absent';
    if (oldStatus !== newStatus) changes.push({
      kind: 'quest', id, title: safeName(newQuest?.title ?? oldQuest?.title ?? id, id),
      before: oldStatus, after: newStatus,
    });
  }

  if (before.世界.当前日期 !== after.世界.当前日期 || before.世界.当前时间 !== after.世界.当前时间) {
    changes.push({
      kind: 'time', beforeDate: before.世界.当前日期, beforeTime: before.世界.当前时间,
      afterDate: after.世界.当前日期, afterTime: after.世界.当前时间,
    });
  }
  return { changes: changes.slice(0, MAX_CHANGES), omitted: Math.max(0, changes.length - MAX_CHANGES) };
}
