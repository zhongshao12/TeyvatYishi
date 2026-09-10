// 变量命令执行器：把通过校验的命令落地到 state setter。
// 输入一个命令 + 当前精简 state + setters 集合，执行后返回结果。
//
// 设计：每个命令都独立调用对应 setter。多条命令按顺序执行；前一条不会影响下一条的校验（因为校验是用旧 state 做的，由 sendWorkflow 决定是否每条都重校验）。

import type { 变量命令, 变量命令结果 } from '@/models/variableCommand';
import type { 角色数据结构 } from '@/models/character';
import type { 世界状态 } from '@/models/world';
import { 对齐世界日期与天数, 解析旅行日期序数, 格式化旅行日期序数 } from '@/models/world';
import type { 记忆系统 } from '@/models/memory';
import { normalizeArchiveCodex, type ArchiveCodex } from '@/models/teyvat/codex';
import { normalizeCourierSystem, type CourierSystem } from '@/models/teyvat/courier';
import type { IrminsulMemory } from '@/models/teyvat/irminsul';
import type { SteambirdNews } from '@/models/teyvat/steambird';
import type { NPC记录 } from '@/models/npc';
import { 创建NPC记录, 归一化NPC记录列表 } from '@/models/npc';
import { matchCanonical } from '@/data/canonicalCharacters';
import { readLegacyNpcKeyFromName, readLegacyNpcNameFromKey } from '@/compat/legacy-hsr/readOnly';
import type { 剧情节点 } from '@/models/plot';
import { addInventoryItem, consumeInventoryItem } from './inventoryActions';
import {
  ITEM_CATEGORIES,
  ITEM_RARITIES,
  normalizeTeyvatItem,
  type ItemCategory,
  type ItemRarity,
  type TeyvatInventory,
  type TeyvatItem,
} from '@/models/teyvat/items';
import { 应用路径命令, 解析路径片段 } from './variablePath';
import { extractRoot, validateCommand, type VariableState } from './variableRegistry';
import { appendWorldEvents } from './worldEvents';

/** 执行器需要的 setters 集合（与 useGameState 对齐）。 */
export interface VariableSetters {
  set旅人: React.Dispatch<React.SetStateAction<角色数据结构>>;
  set背包: React.Dispatch<React.SetStateAction<TeyvatInventory>>;
  set世界: React.Dispatch<React.SetStateAction<世界状态>>;
  set记忆: React.Dispatch<React.SetStateAction<记忆系统>>;
  set世界树: React.Dispatch<React.SetStateAction<IrminsulMemory>>;
  set图鉴: React.Dispatch<React.SetStateAction<ArchiveCodex>>;
  set手机: React.Dispatch<React.SetStateAction<CourierSystem>>;
  setNPC: React.Dispatch<React.SetStateAction<NPC记录[]>>;
  set蒸汽鸟报: React.Dispatch<React.SetStateAction<SteambirdNews>>;
  set剧情: React.Dispatch<React.SetStateAction<剧情节点[]>>;
}

/** 把当前 state 拍扁成 VariableState（执行器/校验用）。 */
export function snapshotVariableState(slices: {
  旅人: 角色数据结构;
  背包: TeyvatInventory;
  世界: 世界状态;
  记忆: 记忆系统;
  世界树: IrminsulMemory;
  图鉴: ArchiveCodex;
  手机: CourierSystem;
  NPC: NPC记录[];
  蒸汽鸟报: SteambirdNews;
  剧情: 剧情节点[];
}): VariableState {
  return {
    旅人: slices.旅人,
    背包: slices.背包,
    世界: slices.世界,
    记忆: slices.记忆,
    世界树: slices.世界树,
    图鉴: slices.图鉴,
    手机: slices.手机,
    NPC: slices.NPC,
    蒸汽鸟报: slices.蒸汽鸟报,
    剧情: slices.剧情,
  };
}

/** 单条命令执行：先校验 → 在 setter 内部用 functional updater 计算新值。 */
export function applyVariableCommand(
  cmd: 变量命令,
  state: VariableState,
  setters: VariableSetters,
): 变量命令结果 {
  cmd = 规范化世界时间命令(cmd);
  let effectiveState = state;
  const parsedForEnsure = extractRoot(cmd.key);
  if (parsedForEnsure?.root === 'NPC') {
    const ensuredNpc = 确保NPC目标存在(state.NPC as NPC记录[], parsedForEnsure.rest, cmd);
    if (ensuredNpc) {
      effectiveState = { ...state, NPC: ensuredNpc };
      setters.setNPC(ensuredNpc);
    }
  }
  const validation = validateCommand(cmd, effectiveState);
  if (!validation.allowed) {
    return { command: cmd, ok: false, reason: validation.reason };
  }
  const { root, rest } = validation;
  if (!root || rest === undefined) {
    return { command: cmd, ok: false, reason: '内部错误：校验通过但未提取到根路径' };
  }
  if (root === '背包') {
    const backpackQuantityChange = 应用背包数量扣减命令(effectiveState.背包 as TeyvatInventory, rest, cmd);
    if (backpackQuantityChange.matched) {
      if (backpackQuantityChange.nextInventory) setters.set背包(backpackQuantityChange.nextInventory);
      return { command: cmd, ok: backpackQuantityChange.ok !== false, reason: backpackQuantityChange.reason };
    }
  }

  if (root === '世界') {
    const timeGuardReason = 校验世界时间命令(cmd, rest, effectiveState.世界 as 世界状态, effectiveState.世界 as 世界状态);
    if (timeGuardReason) {
      return { command: cmd, ok: false, reason: timeGuardReason };
    }
  }

  let applyError: string | undefined;

  const isMalformedBackpackPush =
    root === '背包' &&
    rest === 'items' &&
    cmd.action === 'push' &&
    !解析TeyvatItemInput(cmd.value);
  if (isMalformedBackpackPush) {
    if (isPlaceholderBackpackObject(cmd.value)) {
      return { command: cmd, ok: true, reason: '已忽略背包占位符命令' };
    }
    return { command: cmd, ok: false, reason: '背包 push 值格式错误：请提供完整的物品对象' };
  }

  const runUpdate = <T,>(setter: React.Dispatch<React.SetStateAction<T>>): void => {
    setter((prev) => {
      if (root === '世界' && rest === '全局事件' && cmd.action === 'push') {
        return {
          ...(prev as 世界状态),
          全局事件: appendWorldEvents((prev as 世界状态).全局事件 ?? [], [cmd.value]),
        } as T;
      }
      const result = 应用路径命令(prev, rest, cmd.action, cmd.value);
      if (!result.ok) {
        applyError = result.reason ?? '应用失败';
        return prev;
      }
      // 整根删除：拒绝（避免把整个数组/对象置 undefined 破坏类型）
      if (rest.length === 0 && cmd.action === 'delete') {
        applyError = '禁止 delete 根路径';
        return prev;
      }
      return result.nextRootValue as T;
    });
  };

  switch (root) {
    case '旅人': runUpdate(setters.set旅人); break;
    case '背包':
      if (cmd.action === 'push' && rest === 'items') {
        const item = 解析TeyvatItemInput(cmd.value);
        if (item) setters.set背包((previous) => addInventoryItem(previous, item));
      } else {
        runUpdate(setters.set背包);
      }
      break;
    case '世界': runUpdate(setters.set世界); break;
    case '记忆': runUpdate(setters.set记忆); break;
    case '世界树': runUpdate(setters.set世界树); break;
    case '图鉴':
      runUpdate(setters.set图鉴);
      setters.set图鉴((prev) => normalizeArchiveCodex(prev));
      break;
    case '手机':
      runUpdate(setters.set手机);
      setters.set手机((prev) => normalizeCourierSystem(prev));
      break;
    case 'NPC': runUpdate(setters.setNPC); break;
    case '蒸汽鸟报': runUpdate(setters.set蒸汽鸟报); break;
    case '剧情': runUpdate(setters.set剧情); break;
  }

  if (applyError) return { command: cmd, ok: false, reason: applyError };
  return { command: cmd, ok: true };
}

/** 批量执行：依次跑每条命令，收集每条的结果。 */
export function applyVariableCommands(
  commands: 变量命令[],
  state: VariableState,
  setters: VariableSetters,
): 变量命令结果[] {
  return commands.map((cmd) => applyVariableCommand(cmd, state, setters));
}

/** 把 VariableState 拆回 8 个具名切片，方便组件/工作流消费。 */
export function unpackVariableState(state: VariableState) {
  return {
    旅人: state.旅人 as 角色数据结构,
    背包: state.背包 as TeyvatInventory,
    世界: state.世界 as 世界状态,
    记忆: state.记忆 as 记忆系统,
    世界树: state.世界树 as IrminsulMemory,
    图鉴: state.图鉴 as ArchiveCodex,
    手机: state.手机 as CourierSystem,
    NPC: state.NPC as NPC记录[],
    蒸汽鸟报: state.蒸汽鸟报 as SteambirdNews,
    剧情: state.剧情 as 剧情节点[],
  };
}

/** 纯函数批处理：在内存里累计推进 state，不接 setter。
 *  返回最终的新 state 与每条命令的结果（含失败原因）。
 *  适合 sendWorkflow —— 一次性算完，再用 setters 一次性提交，避免连续 setState 的中间状态。 */
export function reduceVariableCommands(
  commands: 变量命令[],
  initialState: VariableState,
): { results: 变量命令结果[]; nextState: VariableState } {
  let cursor = { ...initialState };
  const results: 变量命令结果[] = [];
  const normalizedCommands = commands.map(规范化世界时间命令);
  const batchTimePlan = 分析批次时间计划(normalizedCommands, initialState.世界 as 世界状态);

  for (const cmd of normalizedCommands) {
    const parsedRoot = extractRoot(cmd.key);
    const preEnsuredNpc = parsedRoot?.root === 'NPC'
      ? 确保NPC目标存在(cursor.NPC as NPC记录[], parsedRoot.rest, cmd)
      : null;
    if (preEnsuredNpc) {
      cursor = { ...cursor, NPC: preEnsuredNpc };
    }
    const validation = validateCommand(cmd, cursor);
    if (!validation.allowed) {
      results.push({ command: cmd, ok: false, reason: validation.reason });
      continue;
    }
    const { root, rest } = validation;
    if (!root || rest === undefined) {
      results.push({ command: cmd, ok: false, reason: '内部错误：校验通过但未提取到根路径' });
      continue;
    }
    if (root === '背包') {
      const backpackQuantityChange = 应用背包数量扣减命令(cursor.背包 as TeyvatInventory, rest, cmd);
      if (backpackQuantityChange.matched) {
        if (backpackQuantityChange.nextInventory) cursor = { ...cursor, 背包: backpackQuantityChange.nextInventory };
        results.push({ command: cmd, ok: backpackQuantityChange.ok !== false, reason: backpackQuantityChange.reason });
        continue;
      }
    }
    if (rest.length === 0 && cmd.action === 'delete') {
      results.push({ command: cmd, ok: false, reason: '禁止 delete 根路径' });
      continue;
    }

    if (root === '世界') {
      const timeGuardReason = 校验世界时间命令(
        cmd,
        rest,
        cursor.世界 as 世界状态,
        initialState.世界 as 世界状态,
        batchTimePlan,
      );
      if (timeGuardReason) {
        results.push({ command: cmd, ok: false, reason: timeGuardReason });
        continue;
      }
    }

    if (root === '世界' && rest === '当前时间' && cmd.action === 'set') {
      cursor = 补齐疑似跨夜时间(cursor, cmd);
    }

    if (root === '背包' && rest === 'items' && cmd.action === 'push' && !解析TeyvatItemInput(cmd.value)) {
      if (isPlaceholderBackpackObject(cmd.value)) {
        results.push({ command: cmd, ok: true, reason: '已忽略背包占位符命令' });
        continue;
      }
      results.push({ command: cmd, ok: false, reason: '背包 push 值格式错误：请提供完整的物品对象' });
      continue;
    }

    // 背包专用通道：push 背包.items → 走正式 TeyvatInventory action。
    if (root === '背包' && cmd.action === 'push' && rest === 'items') {
      const parsed = 解析TeyvatItemInput(cmd.value);
      if (parsed) {
        cursor = { ...cursor, 背包: addInventoryItem(cursor.背包 as TeyvatInventory, parsed) };
        results.push({ command: cmd, ok: true, reason: `获得 ${parsed.name} ×${parsed.quantity}` });
        continue;
      }
    }

    if (root === '世界' && rest === '全局事件' && cmd.action === 'push') {
      const world = cursor.世界 as 世界状态;
      cursor = {
        ...cursor,
        世界: {
          ...world,
          全局事件: appendWorldEvents(world.全局事件 ?? [], [cmd.value]),
        },
      };
      results.push({ command: cmd, ok: true });
      continue;
    }

    // 手机联系人去重：push 前检查是否已有同名/同 id 联系人
    if (root === '手机' && rest === 'contacts' && cmd.action === 'push') {
      const courier = cursor.手机 as CourierSystem | undefined;
      const incoming = cmd.value as Record<string, unknown> | undefined;
      if (courier?.contacts && incoming) {
        const incomingId = typeof incoming.id === 'string' ? incoming.id : '';
        const incomingName = typeof incoming.name === 'string' ? incoming.name : '';
        const duplicate = courier.contacts.some((c) =>
          (incomingId && c.id === incomingId) ||
          (incomingName && c.name === incomingName),
        );
        if (duplicate) {
          results.push({ command: cmd, ok: true, reason: `联系人 ${incomingName || incomingId} 已存在，跳过重复添加` });
          continue;
        }
      }
    }

    const applied = 应用路径命令(cursor[root], rest, cmd.action, cmd.value);
    if (!applied.ok) {
      results.push({ command: cmd, ok: false, reason: applied.reason ?? '应用失败' });
      continue;
    }
    cursor = { ...cursor, [root]: applied.nextRootValue };
    results.push({ command: cmd, ok: true });
  }

  cursor = 归一化变量世界状态(cursor);
  cursor = 去重NPC记录(cursor);
  return { results, nextState: cursor };
}

/** 轻量 NPC 去重：合并同 canonical name 的重复记录，保留数据更丰富的那条。 */
function 去重NPC记录(state: VariableState): VariableState {
  const records = state.NPC as NPC记录[] | undefined;
  if (!records || records.length <= 1) return state;
  const seen = new Map<string, NPC记录>();
  const deduped: NPC记录[] = [];
  for (const npc of records) {
    const canonical = matchCanonical(npc.姓名) ?? (npc.别名 ? matchCanonical(npc.别名) : null);
    const key = canonical?.name ?? npc.姓名;
    const existing = seen.get(key);
    if (existing) {
      // 保留数据更丰富的那条（字段非空数更多）
      const existingScore = NPC数据丰富度(existing);
      const currentScore = NPC数据丰富度(npc);
      if (currentScore > existingScore) {
        // 替换：把 existing 从 deduped 中移除，用 current 替代
        const idx = deduped.indexOf(existing);
        if (idx >= 0) deduped.splice(idx, 1);
        deduped.push(npc);
        seen.set(key, npc);
      }
      // 否则保留 existing，跳过 current
    } else {
      seen.set(key, npc);
      deduped.push(npc);
    }
  }
  if (deduped.length === records.length) return state;
  return { ...state, NPC: deduped };
}

function NPC数据丰富度(npc: NPC记录): number {
  let score = 0;
  if (npc.外貌) score++;
  if (npc.性格) score++;
  if (npc.介绍) score++;
  if (npc.性别) score++;
  if (npc.穿着) score++;
  if (npc.说话方式) score++;
  if (npc.最近互动) score++;
  if (npc.对玩家长期印象) score++;
  if (npc.当前关系阶段) score++;
  if ((npc.同行记忆?.length ?? 0) > 0) score += 2;
  if ((npc.共同经历?.length ?? 0) > 0) score++;
  if ((npc.未完成事项?.length ?? 0) > 0) score++;
  if ((npc.未解决冲突?.length ?? 0) > 0) score++;
  return score;
}

function 规范化世界时间命令(cmd: 变量命令): 变量命令 {
  const parsed = extractRoot(cmd.key);
  if (parsed?.root !== '世界') return cmd;

  // 旧协议键「世界.开拓天数」改写为「世界.旅程天数」，保证执行写入新字段。
  if (parsed.rest === '开拓天数') {
    cmd = { ...cmd, key: '世界.旅程天数' };
  }

  if ((parsed.rest === '当前时间' || parsed.rest === '当前日期') && cmd.action !== 'set' && cmd.action !== 'delete') {
    cmd = { ...cmd, action: 'set' };
  }

  if (parsed.rest === '当前时间' && typeof cmd.value === 'string') {
    const minutes = 解析分钟序数(cmd.value);
    if (minutes !== null) {
      return { ...cmd, value: 格式化分钟序数(minutes) };
    }
  }

  return cmd;
}

function 归一化变量世界状态(state: VariableState): VariableState {
  const world = state.世界 as 世界状态 | undefined;
  if (!world) return state;
  const aligned = 对齐世界日期与天数(world.旅程天数, world.当前日期);
  if (aligned.旅程天数 === world.旅程天数 && aligned.当前日期 === world.当前日期) return state;
  return {
    ...state,
    世界: {
      ...world,
      ...aligned,
    },
  };
}

function 补齐疑似跨夜时间(state: VariableState, cmd: 变量命令): VariableState {
  const world = state.世界 as 世界状态 | undefined;
  if (!world) return state;
  const current = 解析分钟序数(world.当前时间);
  const next = 解析分钟序数(cmd.value);
  if (current === null || next === null) return state;
  const looksOvernight = current >= 20 * 60 && next <= 6 * 60;
  if (!looksOvernight) return state;
  const aligned = 对齐世界日期与天数(
    Math.max(1, Math.trunc(Number(world.旅程天数) || 1)) + 1,
    world.当前日期,
  );
  return {
    ...state,
    世界: {
      ...world,
      ...aligned,
    },
  };
}

function 解析背包数量扣减目标(rest: string, cmd: 变量命令): { expected: string; count: number } | null {
  if (cmd.action !== 'sub') return null;
  const tokens = 解析路径片段(rest);
  if (tokens.length !== 3 || tokens[0] !== 'items' || tokens[2] !== 'quantity') return null;
  const selector = tokens[1];
  if (typeof selector !== 'string' || !selector.startsWith('[') || !selector.endsWith(']')) return null;
  const inner = selector.slice(1, -1);
  const eq = inner.indexOf('=');
  if (eq < 0) return null;
  const field = inner.slice(0, eq).trim();
  const expected = inner.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  if (field !== 'id' || !expected) return null;
  return {
    expected,
    count: Number(cmd.value),
  };
}

function 匹配背包物品(item: TeyvatItem, expectedId: string): boolean {
  return item.id === expectedId;
}

function 应用背包数量扣减命令(
  inventory: TeyvatInventory,
  rest: string,
  cmd: 变量命令,
): { matched: boolean; ok?: boolean; nextInventory?: TeyvatInventory; reason?: string } {
  const target = 解析背包数量扣减目标(rest, cmd);
  if (!target) return { matched: false };
  if (!Number.isInteger(target.count) || target.count <= 0) {
    return { matched: true, ok: false, reason: '背包消耗数量必须是正整数。' };
  }
  const index = inventory.items.findIndex((item) => 匹配背包物品(item, target.expected));
  if (index < 0) {
    return {
      matched: true,
      ok: false,
      reason: `背包中没有「${target.expected}」。`,
    };
  }
  const item = inventory.items[index];
  if (target.count > item.quantity) {
    return { matched: true, ok: false, reason: `背包物品 ${item.name} 数量不足。` };
  }
  const remain = item.quantity - target.count;
  return {
    matched: true,
    ok: true,
    nextInventory: consumeInventoryItem(inventory, item.id, target.count),
    reason: remain > 0
      ? `消耗 ${item.name} ×${target.count}（剩余 ${remain}）`
      : `消耗 ${item.name} ×${target.count}（已用尽）`,
  };
}

/** 把 reduceVariableCommands 的结果通过 setters 一次性提交。
 *  只对引用变化的 root 调 setter——这样:
 *  1. 变量模型没动的 root 不会 setState,避免覆盖玩家在校准期间的交互(如点击狭间邀请卡片)
 *  2. 没必要的 re-render 也省了
 *  initialState 必须是传给 reduceVariableCommands 的同一份初始 snapshot 引用。 */
export function commitVariableState(
  state: VariableState,
  initialState: VariableState,
  setters: VariableSetters,
): void {
  if (state.旅人 !== initialState.旅人) setters.set旅人(state.旅人 as 角色数据结构);
  if (state.背包 !== initialState.背包) setters.set背包(state.背包 as TeyvatInventory);
  if (state.世界 !== initialState.世界) setters.set世界(归一化变量世界状态(state).世界 as 世界状态);
  if (state.记忆 !== initialState.记忆) setters.set记忆(state.记忆 as 记忆系统);
  if (state.世界树 !== initialState.世界树) setters.set世界树(state.世界树 as IrminsulMemory);
  if (state.图鉴 !== initialState.图鉴) setters.set图鉴(normalizeArchiveCodex(state.图鉴));
  if (state.手机 !== initialState.手机) setters.set手机(normalizeCourierSystem(state.手机));
  if (state.NPC !== initialState.NPC) setters.setNPC(归一化NPC记录列表(state.NPC));
  if (state.蒸汽鸟报 !== initialState.蒸汽鸟报) setters.set蒸汽鸟报(state.蒸汽鸟报 as SteambirdNews);
  if (state.剧情 !== initialState.剧情) setters.set剧情(state.剧情 as 剧情节点[]);
}

function 校验世界时间命令(
  cmd: 变量命令,
  rest: string,
  currentWorld: 世界状态,
  baselineWorld?: 世界状态,
  batchTimePlan?: 批次时间计划,
): string | null {
  if (rest === '当前日期') {
    if (cmd.action !== 'set') return '世界.当前日期 只能使用 set 写入完整日期';
    const next = 解析旅行日期序数(cmd.value);
    if (next === null) return '当前日期必须使用“旅行历 YYYY.MM.DD”，禁止写现实日期或其他纪年';
    const current = 解析旅行日期序数(currentWorld?.当前日期);
    if (current !== null && next < current) return '拒绝时间回退：世界.当前日期 不能早于当前日期';
    const baseline = 解析旅行日期序数(baselineWorld?.当前日期);
    if (baseline !== null && next > baseline + 1) {
      cmd.value = 格式化旅行日期序数(baseline + 1);
      return null;
    }
    return null;
  }

  if (rest === '当前时间') {
    if (cmd.action !== 'set') return '世界.当前时间 只能使用 set 写入 HH:mm';
    const next = 解析分钟序数(cmd.value);
    if (next === null) return '当前时间必须使用 24 小时制 HH:mm，禁止写时段词或场景名';
    const current = 解析分钟序数(currentWorld?.当前时间);
    const currentDate = 解析旅行日期序数(currentWorld?.当前日期);
    const baselineDate = 解析旅行日期序数(baselineWorld?.当前日期);
    const baselineTime = 解析分钟序数(baselineWorld?.当前时间);
    const dateAlreadyAdvanced = currentDate !== null && baselineDate !== null && currentDate > baselineDate;
    const dateWillAdvanceInBatch = batchTimePlan?.dateAdvances === true && batchTimePlan?.dayAdvances === true;
    if (!dateAlreadyAdvanced && current !== null && next < current) {
      if (current >= 20 * 60 && next <= 6 * 60) return null;
      if (dateWillAdvanceInBatch) return null;
      return `已忽略疑似时间回退：同一日期内 世界.当前时间 不能早于当前时间（当前 ${currentWorld?.当前时间 || '未知'}，尝试写入 ${String(cmd.value)}）；若剧情已跨日，请同批写入 世界.当前日期 的下一天`;
    }
    if (!dateAlreadyAdvanced && !dateWillAdvanceInBatch && baselineTime !== null && next - baselineTime > 60) {
      const capped = Math.min(23 * 60 + 59, baselineTime + 30);
      cmd.value = 格式化分钟序数(capped);
      return null;
    }
    return null;
  }

  // 「开拓天数」为旧协议键，继续接受以保证老会话平滑迁移；新协议统一用「旅程天数」。
  if (rest === '旅程天数' || rest === '开拓天数') {
    const current = Math.max(1, Math.trunc(Number(currentWorld?.旅程天数) || 1));
    if (cmd.action !== 'add' && cmd.action !== 'set' && cmd.action !== 'sub') {
      return '世界.旅程天数 只能使用 add 或 set';
    }
    if (cmd.action === 'sub') return '拒绝时间回退：世界.旅程天数 不允许使用 sub';
    if (cmd.action === 'add') {
      const delta = Number(cmd.value);
      if (!Number.isFinite(delta)) return '旅程天数 add 必须是数字';
      if (delta < 0) return '拒绝时间回退：世界.旅程天数 不能减少';
      if (delta > 1) cmd.value = 1;
      return null;
    }
    if (cmd.action === 'set') {
      const next = Number(cmd.value);
      if (!Number.isFinite(next)) return '旅程天数 set 必须是数字';
      if (next < current) return '拒绝时间回退：世界.旅程天数 不能小于当前值';
      if (next < 1) return '旅程天数不能小于 1';
      if (next > current + 1) cmd.value = current + 1;
    }
  }

  return null;
}

interface 批次时间计划 {
  dateAdvances: boolean;
  dayAdvances: boolean;
}

function 分析批次时间计划(commands: 变量命令[], baselineWorld: 世界状态): 批次时间计划 {
  const baselineDate = 解析旅行日期序数(baselineWorld?.当前日期);
  const baselineDay = Math.max(1, Math.trunc(Number(baselineWorld?.旅程天数) || 1));
  const dateAdvances = commands.some((cmd) => {
    const parsed = extractRoot(cmd.key);
    if (parsed?.root !== '世界' || parsed.rest !== '当前日期' || cmd.action !== 'set') return false;
    const next = 解析旅行日期序数(cmd.value);
    return baselineDate !== null && next !== null && next === baselineDate + 1;
  });
  const dayAdvances = commands.some((cmd) => {
    const parsed = extractRoot(cmd.key);
    if (parsed?.root !== '世界' || (parsed.rest !== '旅程天数' && parsed.rest !== '开拓天数')) return false;
    const value = Number(cmd.value);
    if (!Number.isFinite(value)) return false;
    if (cmd.action === 'add') return value === 1;
    if (cmd.action === 'set') return value === baselineDay + 1;
    return false;
  });
  return { dateAdvances, dayAdvances };
}

function 确保NPC目标存在(records: NPC记录[], rest: string, cmd: 变量命令): NPC记录[] | null {
  if (cmd.action === 'push' && !rest) return null;
  const match = rest.match(/^\[([^\]]+)\]/);
  if (!match) return null;
  const eq = match[1].indexOf('=');
  if (eq < 0) return null;
  const selectorField = match[1].slice(0, eq).trim();
  const selectorValue = match[1].slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  if (!selectorValue) return null;
  // 严格匹配（id / 姓名 / 别名）
  const exists = records.some((item) =>
    item.id === selectorValue ||
    item.姓名 === selectorValue ||
    item.别名 === selectorValue,
  );
  if (exists) return null;
  // 模糊匹配（原著角色库 canonical name），与 findNpc 保持一致
  const canonicalName = NPC选择器值转角色名(selectorValue);
  const canonical = matchCanonical(canonicalName);
  if (canonical) {
    const fuzzyExists = records.some((item) =>
      item.姓名 === canonical.name ||
      canonical.aliases?.some((a) => a === item.姓名 || a === item.别名),
    );
    if (fuzzyExists) return null;
  }
  if (!canonical) return null;
  const stableId = selectorField === 'id' && selectorValue.startsWith('npc_')
    ? selectorValue
    : `npc_${角色名转NPCID(canonical.name)}`;
  const nowTurn = typeof cmd.value === 'number' ? cmd.value : 0;
  const created = {
    ...创建NPC记录({
    姓名: canonical.name,
    阶位: 'companion',
    初见回合: nowTurn,
    原著角色: true,
    性别: canonical.gender as import('@/models/npc').NPC性别 | undefined,
    外貌: canonical.appearance,
    性格: canonical.personality,
    介绍: `${canonical.name}是当前剧情中出现的原著角色。`,
    }),
    id: stableId,
    关系: 'acquaintance' as const,
    备注: ['原著角色自动建档'],
  };
  return [...records, created];
}

function NPC选择器值转角色名(value: string): string {
  const normalized = value.replace(/^npc[_-]/i, '').toLowerCase();
  const map: Record<string, string> = {
    aether: '空', lumine: '荧', paimon: '派蒙', amber: '安柏', kaeya: '凯亚',
    lisa: '丽莎', jean: '琴', venti: '温迪', diluc: '迪卢克', barbara: '芭芭拉',
  };
  return map[normalized] ?? (readLegacyNpcNameFromKey(normalized) || value);
}

function 角色名转NPCID(name: string): string {
  const map: Record<string, string> = {
    空: 'aether', 荧: 'lumine', 派蒙: 'paimon', 安柏: 'amber', 凯亚: 'kaeya',
    丽莎: 'lisa', 琴: 'jean', 温迪: 'venti', 迪卢克: 'diluc', 芭芭拉: 'barbara',
  };
  return map[name] ?? (readLegacyNpcKeyFromName(name) || name.toLowerCase().replace(/\s+/g, '_'));
}

function 解析分钟序数(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function 格式化分钟序数(minutesOfDay: number): string {
  const hours = Math.floor(minutesOfDay / 60);
  const minutes = minutesOfDay % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

// ── 背包 push 入参解析 ──
// 命令允许省略由运行时生成的 id / obtainedAtTurn；其余字段按正式 TeyvatItem 重建。
function 解析TeyvatItemInput(raw: unknown): TeyvatItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const name = typeof obj.name === 'string' ? obj.name.trim() : '';
  const category = obj.category as ItemCategory;
  const rarity = obj.rarity as ItemRarity;
  if (!name || isPlaceholderText(name) || !ITEM_CATEGORIES.includes(category) || !ITEM_RARITIES.includes(rarity)) return null;

  try {
    return normalizeTeyvatItem({
      id: typeof obj.id === 'string' && obj.id.trim() ? obj.id : `item:${category}:${name.toLowerCase()}`,
      category,
      name,
      description: typeof obj.description === 'string' && !isPlaceholderText(obj.description) ? obj.description : '',
      quantity: obj.quantity,
      rarity,
      obtainedAtTurn: typeof obj.obtainedAtTurn === 'number' ? obj.obtainedAtTurn : 0,
      artifactSlot: obj.artifactSlot,
      stackable: obj.stackable,
      source: obj.source,
      effects: obj.effects,
      narrativeEffects: obj.narrativeEffects,
      useEffects: obj.useEffects,
      value: obj.value,
      sourceDetail: obj.sourceDetail,
      obtainedAt: obj.obtainedAt,
    });
  } catch {
    return null;
  }
}

function isPlaceholderBackpackObject(raw: unknown): boolean {
  if (typeof raw === 'string') return isPlaceholderBackpackValue(raw);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const obj = raw as Record<string, unknown>;
  return (
    isPlaceholderText(obj.name) ||
    isPlaceholderText(obj.description) ||
    Object.values(obj).some((value) => isPlaceholderText(value))
  );
}

function isPlaceholderText(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return text === '' || text === '...' || text === '名称' || text === '描述' || text === '物品' || text === '未知物品';
}

function 清理变量命令块(block: string): string {
  return block
    .replace(/```(?:json|JSON|ts|typescript)?/g, '')
    .replace(/```/g, '')
    .replace(/\r/g, '')
    .trim();
}

function JSON括号是否闭合(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return true;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const ch of trimmed) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{' || ch === '[') depth++;
    if (ch === '}' || ch === ']') depth--;
  }
  return depth <= 0 && !inString;
}

function 查找赋值等号(line: string): number {
  let bracketDepth = 0;
  let braceDepth = 0;
  let parenDepth = 0;
  let inString = false;
  let quote = '';
  let escaped = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (inString) {
      if (ch === quote) {
        inString = false;
        quote = '';
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      continue;
    }
    if (ch === '[') bracketDepth++;
    else if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1);
    else if (ch === '{') braceDepth++;
    else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1);
    else if (ch === '(') parenDepth++;
    else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
    else if ((ch === '=' || ch === '＝') && bracketDepth === 0 && braceDepth === 0 && parenDepth === 0) {
      return i;
    }
  }
  return -1;
}

function 解析变量命令行(line: string): { action: 变量命令['action']; key: string; valueRaw?: string } | null {
  const head = line.match(/^(set|add|sub|push|delete)\s+/i);
  const action = (head ? head[1].toLowerCase() : 'set') as 变量命令['action'];
  const rest = (head ? line.slice(head[0].length) : line).trim();
  if (!rest) return null;

  const eqIndex = 查找赋值等号(rest);
  if (eqIndex < 0) {
    return { action, key: rest.trim() };
  }
  const key = rest.slice(0, eqIndex).trim();
  const valueRaw = rest.slice(eqIndex + 1).trim();
  if (!key) return null;
  return { action, key, valueRaw };
}

function 拆分变量命令行(block: string): string[] {
  const output: string[] = [];
  let current = '';

  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) continue;

    const startsCommand = /^(set|add|sub|push|delete)\s+/i.test(line) || /^[\w一-龥.[\]_-]+\s*[=＝]/.test(line);
    if (!current) {
      current = line;
      continue;
    }

    const eqIndex = 查找赋值等号(current);
    const valuePart = eqIndex >= 0 ? current.slice(eqIndex + 1).trim() : '';
    const currentJsonOpen = Boolean(valuePart) && !JSON括号是否闭合(valuePart);

    if (startsCommand && !currentJsonOpen) {
      output.push(current);
      current = line;
    } else {
      current += `\n${line}`;
    }
  }

  if (current) output.push(current);
  return output;
}

function 解析变量值(raw: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json|JSON)?\s*/, '')
    .replace(/```$/, '')
    .trim();
  if (!trimmed) return { ok: false, reason: '空值' };

  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    const repaired = trimmed
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/：/g, ':')
      .replace(/,\s*([}\]])/g, '$1');
    try {
      return { ok: true, value: JSON.parse(repaired) };
    } catch {
      if (/^[A-Za-z_一-龥][\w一-龥\s-]*$/.test(trimmed)) {
        return { ok: true, value: trimmed };
      }
      return { ok: false, reason: `JSON 值无法解析：${trimmed.slice(0, 120)}` };
    }
  }
}

function isPlaceholderBackpackValue(raw: string | undefined): boolean {
  if (!raw) return false;
  const text = raw.trim();
  return (
    text === '{id,名称,描述,...}' ||
    text === '{名称,描述,...}' ||
    text === '{"id","名称","描述"}' ||
    /\.\.\./.test(text)
  );
}

function isPlaceholderValue(raw: string | undefined): boolean {
  if (!raw) return false;
  const text = raw.trim();
  return /\.\.\./.test(text) || /[{,]\s*(id|回合|摘要|名称|描述)\s*[,}]/.test(text);
}

/** 从 AI 文本中解析 <变量更新>...</变量更新> 块。每条命令：`<action> <path> = <json>`。
 *  支持多行 JSON / 代码块 / 全角等号；delete 可省略 = 后面的值。 */
export function parseVariableCommands(rawText: string): { commands: 变量命令[]; parseErrors: string[] } {
  const commands: 变量命令[] = [];
  const parseErrors: string[] = [];

  const blockMatch = rawText.match(/<变量更新>([\s\S]*?)<\/变量更新>/);
  if (!blockMatch) return { commands, parseErrors };

  const lines = 拆分变量命令行(清理变量命令块(blockMatch[1]));

  for (const line of lines) {
    // 形如：  push  背包.items = {"category":"food","name":"提瓦特煎蛋","rarity":1,"quantity":1}
    //        delete 剧情[id=node_002]
    //        add   世界.旅程天数 = 1
    const parsedLine = 解析变量命令行(line);
    if (!parsedLine) {
      parseErrors.push(`无法解析：${line.slice(0, 160)}`);
      continue;
    }
    const { action, key, valueRaw } = parsedLine;

    if (action !== 'delete' && valueRaw === undefined) {
      parseErrors.push(`${action} 缺少值：${line}`);
      continue;
    }

    if (action === 'push' && key.trim() === '背包.items' && isPlaceholderBackpackValue(valueRaw)) {
      continue;
    }
    if (isPlaceholderValue(valueRaw)) {
      continue;
    }

    // 顺便确认根合法（错的也按拒绝处理，让 validateCommand 给出明确原因）
    if (!extractRoot(key)) {
      parseErrors.push(`未知根路径：${key}`);
      // 不 continue，让 validate 阶段也吐一遍，便于在面板里看到
    }

    let value: unknown = null;
    if (action !== 'delete' && valueRaw !== undefined) {
      const parsedValue = 解析变量值(valueRaw);
      if (!parsedValue.ok) {
        parseErrors.push(`${parsedValue.reason}；命令：${line.slice(0, 160)}`);
        continue;
      }
      value = parsedValue.value;
    }

    commands.push({ action, key, value });
  }

  return { commands, parseErrors };
}
