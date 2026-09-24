import { 获取NPC兼容关系, 获取NPC关系阶段, 限制NPC好感度, type NPC记录 } from '@/models/npc';

/**
 * 手机回信作业的 NPC 写回：按 id 与**活体根**合并，而不是整片替换。
 *
 * 背景（对抗审查 2026-09-20 第 4 条）：`App.tsx` 把发起回信那一刻的 `state.NPC` 交给
 * `runCourierReplyPass`，几十秒后拿到结果再 `state.setNPC(result.npcs)` 整片写回。
 * 变量结算提交修好之后，结算对 NPC（好感度 / 档案 / 同行记忆）的写入会真正落地，
 * 于是「飞行中的回信写回」会把它整片顶掉 —— 与第二轮审计 A3 在结算提交处修掉的是同一类缺陷
 * （长耗时任务的返回值基于陈旧快照，整片覆盖会静默回退并发写入）。
 *
 * 规则（按 id，全部用引用比较，本仓库所有写入都是整切片/整记录替换）：
 * - 活体里没有 → 用作业结果（作业新建的联系人记录）；
 * - 作业没产出这条（或产出就是输入那条）→ 保留活体；
 * - 只有作业改过 → 用作业结果；
 * - 两边都改过 → 保留活体，只补回作业**新追加**的同行记忆及其好感增量，
 *   避免覆盖结算写入，也避免复活活体期间被删除的旧记忆。
 */
export interface NpcWriteBackInput {
  /** 发起回信作业那一刻的 NPC 切片（作业的输入快照）。 */
  start: NPC记录[];
  /** 作业返回的 NPC 切片。 */
  next: NPC记录[];
  /** 写回那一刻的活体 NPC 切片。 */
  current: NPC记录[];
  expectedSessionId?: number;
  currentSessionId?: number;
}

export interface NpcWriteBackResult {
  records: NPC记录[];
  /** 两边都改过、因此以活体值为准（只补回追加式同行记忆）的 NPC id。 */
  concurrentNpcIds: string[];
}

export function mergeNpcWriteBack(input: NpcWriteBackInput): NpcWriteBackResult {
  if (input.expectedSessionId !== undefined && input.currentSessionId !== input.expectedSessionId) {
    return { records: input.current, concurrentNpcIds: [] };
  }
  const startById = new Map(input.start.map((record) => [record.id, record]));
  const nextById = new Map(input.next.map((record) => [record.id, record]));
  const currentById = new Map(input.current.map((record) => [record.id, record]));
  const concurrentNpcIds: string[] = [];
  const records = input.current.map((live) => {
    const produced = nextById.get(live.id);
    if (!produced) return live;
    const base = startById.get(live.id);
    if (produced === base) return live;
    if (live === base) return produced;
    concurrentNpcIds.push(live.id);
    return withAppendedMemories(live, produced, base);
  });
  for (const produced of input.next) {
    if (!currentById.has(produced.id)) records.push(produced);
  }
  return { records, concurrentNpcIds };
}

/** 只把作业**新增**的同行记忆补到活体记录上（按记忆 id 去重）。 */
function withAppendedMemories(live: NPC记录, produced: NPC记录, base?: NPC记录): NPC记录 {
  const producedMemories = produced.同行记忆 ?? [];
  if (!producedMemories.length) return live;
  const liveMemories = live.同行记忆 ?? [];
  const known = new Set(liveMemories.map((memory) => memory.id));
  const original = new Set((base?.同行记忆 ?? []).map((memory) => memory.id));
  const appended = producedMemories.filter((memory) => !original.has(memory.id) && !known.has(memory.id));
  if (!appended.length) return live;
  const phoneAffinityDelta = appended.reduce((total, memory) => total + (memory.来源 === '手机' || memory.好感变动 !== undefined
    ? Number(memory.好感变动) || 0
    : 0), 0);
  const 好感度 = 限制NPC好感度(live.好感度 + phoneAffinityDelta);
  return {
    ...live,
    同行记忆: [...liveMemories, ...appended],
    ...(phoneAffinityDelta !== 0 ? {
      好感度,
      关系: 获取NPC兼容关系(好感度),
      当前关系阶段: 获取NPC关系阶段(好感度),
    } : {}),
  };
}
