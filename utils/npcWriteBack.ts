import type { NPC记录 } from '@/models/npc';
import { 获取NPC兼容关系, 获取NPC关系阶段, 限制NPC好感度 } from '@/models/npc';

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

/**
 * 结算尾段（变量校准阶段）的档案整理写回：B07。
 *
 * 症状：记忆压缩 `await` 之后才开始整理 NPC，随后还要 `await` 剧情设置与恢复日志落库；
 * 最后**无条件**用这份旧投影替换活体切片 —— 这段等待期间玩家在角色档案面板/记忆面板
 * 做的修改会被静默回退。手机链路已经有 `mergeNpcWriteBack`，这里缺的是同等保护。
 *
 * 与 `mergeNpcWriteBack` 的差别：不是「谁动过就整条保留谁」，而是
 * **活体为底 + 逐字段 delta**，因为本回合的整理结果（压缩后的同行记忆、剧情进度记忆）
 * 本身是追加式写入，必须叠加到活体上而不是被丢掉。
 *
 * 规则（按 id，全部引用比较；本仓库所有写入都是整记录替换）：
 * - 活体没有、整理新增 → 追加整理结果；
 * - 整理删掉了基准里有的、而活体还是基准那份 → 同样删除；
 * - 活体还是基准那份 → 用整理结果；
 * - 两边都改过 → 保留活体，只补回整理**新增**的数组项（按 id 去重），并如实上报并发。
 */
interface SettlementRecordBase {
  id: string;
}

/** 同行记忆只按 id 去重与求差集，因此不绑定具体记忆类型（legacy / teyvat 两种记录都适用）。 */
type MemoryRecordLike = { id?: string } | unknown;

export interface SettlementRecordLike extends SettlementRecordBase {
  同行记忆?: readonly MemoryRecordLike[];
}

function memoryRecordId(memory: MemoryRecordLike): string | null {
  const id = (memory as { id?: unknown } | null | undefined)?.id;
  return typeof id === 'string' && id ? id : null;
}

export interface SettlementSliceWriteBackResult<T extends SettlementRecordBase> {
  records: T[];
  /** 整理与活体都改过、因此以活体为底并只补追加项的记录 id。 */
  concurrentRecordIds: string[];
}

export function mergeSettlementSliceWriteBack<T extends SettlementRecordLike>(input: {
  /** 整理作业的输入快照。 */
  base: readonly T[];
  /** 整理作业的产出。 */
  next: readonly T[];
  /** 提交那一刻的活体切片。 */
  current: readonly T[];
}): SettlementSliceWriteBackResult<T> {
  const baseById = new Map(input.base.map((record) => [record.id, record]));
  const nextById = new Map(input.next.map((record) => [record.id, record]));
  const currentById = new Map(input.current.map((record) => [record.id, record]));
  const concurrentRecordIds: string[] = [];

  const records = input.current.map((live) => {
    const produced = nextById.get(live.id);
    if (!produced) {
      // 整理删掉了基准里存在的记录；活体仍是未被动过的基准那份 → 同意删除。
      const base = baseById.get(live.id);
      return base && live === base ? undefined : live;
    }
    const base = baseById.get(live.id);
    if (produced === base) return live;
    if (live === base) return produced;
    concurrentRecordIds.push(live.id);
    return mergeAppendedMemories(live, produced, base);
  }).filter((record): record is T => record !== undefined);

  for (const produced of input.next) {
    if (!currentById.has(produced.id) && !baseById.has(produced.id)) records.push(produced);
  }
  return { records, concurrentRecordIds };
}

/** 活体为底，只补回整理新增的同行记忆（按 id 去重）。 */
function mergeAppendedMemories<T extends SettlementRecordLike>(live: T, produced: T, base?: T): T {
  const liveMemories = live.同行记忆 ?? [];
  const producedMemories = produced.同行记忆 ?? [];
  const baseIds = new Set((base?.同行记忆 ?? []).map(memoryRecordId).filter((id): id is string => Boolean(id)));
  const liveIds = new Set(liveMemories.map(memoryRecordId).filter((id): id is string => Boolean(id)));
  const appended = producedMemories.filter((memory) => {
    const id = memoryRecordId(memory);
    return !id || (!baseIds.has(id) && !liveIds.has(id));
  });
  if (!appended.length) return live;
  return { ...live, 同行记忆: [...liveMemories, ...appended] };
}

/**
 * 剧情进度记忆的写回：只把本回合**新增**的那条记忆追加到活体记忆上（B07 的记忆那一半）。
 *
 * 旧实现把 `memoryAfterStoryProgress` 整片写回，于是压缩 `await` 之后的等待期间
 * 玩家新增的记忆被旧数组顶掉。这里按 id 求差集，并且用「活体已有同 id 就跳过」保证重放幂等。
 */
export interface SettlementMemoryLike {
  即时记忆: readonly string[];
  即时记忆ID?: readonly (string | null)[];
  来源时刻?: Record<string, unknown>;
  短期记忆?: readonly string[];
  短期归档ID?: readonly (string | null)[];
  中期记忆?: readonly string[];
  中期归档ID?: readonly (string | null)[];
  长期记忆?: readonly string[];
  长期归档ID?: readonly (string | null)[];
}

export function rebaseStoryProgressMemory<T extends SettlementMemoryLike>(input: {
  /** 加入本回合剧情进度记忆**之前**的记忆切片。 */
  base: T;
  /** 加入本回合剧情进度记忆之后的记忆切片。 */
  next: T;
  /** 提交那一刻的活体记忆切片。 */
  current: T;
}): { memory: T; applied: boolean } {
  const baseIds = new Set(immediateMemoryIds(input.base));
  const nextIds = immediateMemoryIds(input.next);
  const liveIds = new Set(immediateMemoryIds(input.current));
  const fresh: Array<{ id: string; text: string; moment: unknown }> = [];
  for (let index = 0; index < input.next.即时记忆.length; index += 1) {
    const id = nextIds[index];
    if (!id || baseIds.has(id) || liveIds.has(id)) continue;
    fresh.push({ id, text: input.next.即时记忆[index] ?? '', moment: input.next.来源时刻?.[id] });
  }
  if (!fresh.length) return { memory: input.current, applied: false };
  const moments: Record<string, unknown> = { ...(input.current.来源时刻 ?? {}) };
  for (const entry of fresh) {
    if (entry.moment === undefined) continue;
    moments[entry.id] = entry.moment;
  }
  return {
    memory: {
      ...input.current,
      即时记忆: [...input.current.即时记忆, ...fresh.map((entry) => entry.text)].slice(-50),
      即时记忆ID: [...immediateMemoryIds(input.current), ...fresh.map((entry) => entry.id)].slice(-50),
      来源时刻: moments,
    },
    applied: true,
  };
}

/** 与 `addImmediateMemory` 保持一致：缺省时按位置补空串，数组长度永远与 即时记忆 对齐。 */
function immediateMemoryIds(memory: SettlementMemoryLike): string[] {
  if (memory.即时记忆ID) return memory.即时记忆ID.map((id) => id ?? '');
  return memory.即时记忆.map(() => '');
}
