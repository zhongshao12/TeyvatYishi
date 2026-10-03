import type { TeyvatGameState } from '@/models/teyvat/state';
import type { QuestEntry } from '@/models/teyvat/runtimeSlices';
import type { WorldMoment } from '@/models/teyvat/worldMoment';

function questChanged(before: QuestEntry | undefined, after: QuestEntry): boolean {
  if (!before) return true;
  const { worldMoment: _beforeMoment, ...beforeContent } = before;
  const { worldMoment: _afterMoment, ...afterContent } = after;
  return JSON.stringify(beforeContent) !== JSON.stringify(afterContent);
}

/** Stamp domain events during the atomic settlement, never when a later clock is read. */
export function stampCommittedEventProvenance(
  before: TeyvatGameState,
  after: TeyvatGameState,
  moment: WorldMoment,
): TeyvatGameState {
  const oldQuests = new Map([
    ...before.任务.active, ...before.任务.completed, ...before.任务.abandoned,
  ].map((quest) => [quest.id, quest]));
  const stampQuests = (entries: QuestEntry[]) => entries.map((quest) =>
    questChanged(oldQuests.get(quest.id), quest) && quest.worldMoment?.settlementId !== moment.settlementId
      ? { ...quest, worldMoment: moment }
      : quest);

  const oldNpcs = new Map(before.NPC.map((npc) => [npc.id, npc]));
  const npcs = after.NPC.map((npc) => {
    const previousMemories = new Map(oldNpcs.get(npc.id)?.sharedMemories.map((memory) => [memory.id, memory]) ?? []);
    const memories = npc.sharedMemories.map((memory) => {
      const previous = previousMemories.get(memory.id);
      return (!previous || previous.summary !== memory.summary)
        && memory.worldMoment?.settlementId !== moment.settlementId
        ? { ...memory, worldMoment: moment }
        : memory;
    });
    return memories.some((memory, index) => memory !== npc.sharedMemories[index])
      ? { ...npc, sharedMemories: memories }
      : npc;
  });

  const oldEventCounts = new Map<string, number>();
  for (const event of before.世界.世界事件) oldEventCounts.set(event, (oldEventCounts.get(event) ?? 0) + 1);
  const records = [...after.世界.世界事件记录];
  after.世界.世界事件.forEach((event, index) => {
    const remaining = oldEventCounts.get(event) ?? 0;
    if (remaining > 0) {
      oldEventCounts.set(event, remaining - 1);
      return;
    }
    const id = `world_event_${moment.settlementId}_${index}`;
    if (!records.some((record) => record.id === id)) records.push({ id, text: event, worldMoment: moment });
  });

  return {
    ...after,
    世界: records.length === after.世界.世界事件记录.length ? after.世界 : { ...after.世界, 世界事件记录: records },
    任务: {
      ...after.任务,
      active: stampQuests(after.任务.active),
      completed: stampQuests(after.任务.completed),
      abandoned: stampQuests(after.任务.abandoned),
    },
    NPC: npcs,
  };
}
