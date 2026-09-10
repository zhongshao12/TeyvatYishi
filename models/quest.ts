export type 任务状态 = '未开始' | '进行中' | '已完成' | '已失败' | '已放弃';
export type 任务目标类型 = '达成' | '收集' | '交谈' | '前往' | '击杀' | '时间';
export type 任务来源 = '主线' | '支线' | '自定义' | '来信';
export type 任务奖励类型 = '物品' | '好感' | '记忆' | '蒸汽鸟报' | '元素';

export interface 任务目标 {
  id: string;
  类型: 任务目标类型;
  描述: string;
  目标数量: number;
  当前数量: number;
  关联对象?: string;
  完成: boolean;
}

export interface 任务奖励 {
  类型: 任务奖励类型;
  内容: string;
  数量?: number;
}

export interface 剧情任务 {
  id: string;
  标题: string;
  描述: string;
  来源: 任务来源;
  状态: 任务状态;
  目标: 任务目标[];
  奖励: 任务奖励[];
  创建回合: number;
  更新时间: number;
  完成回合?: number;
  /** 剧情编织分段弱关联：分段被标记为「已偏离」时任务保持进行中，玩家可手动放弃。 */
  关联分段?: string;
  备注?: string;
}

export interface 任务系统 {
  进行中: 剧情任务[];
  已完成: 剧情任务[];
  已放弃: 剧情任务[];
  上一轮任务更新: string[];
}

export function 创建空任务系统(): 任务系统 {
  return { 进行中: [], 已完成: [], 已放弃: [], 上一轮任务更新: [] };
}

const TASK_STATUSES: readonly 任务状态[] = ['未开始', '进行中', '已完成', '已失败', '已放弃'];
const TARGET_TYPES: readonly 任务目标类型[] = ['达成', '收集', '交谈', '前往', '击杀', '时间'];
const REWARD_TYPES: readonly 任务奖励类型[] = ['物品', '好感', '记忆', '蒸汽鸟报', '元素'];

function normalizeTaskReward(input: unknown): 任务奖励 | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as { 类型?: unknown; 内容?: unknown; 数量?: unknown };
  const type = raw.类型 === '新闻' ? '蒸汽鸟报' : raw.类型;
  if (!REWARD_TYPES.includes(String(type) as 任务奖励类型) || typeof raw.内容 !== 'string' || !raw.内容.trim()) return null;
  return {
    类型: type as 任务奖励类型,
    内容: raw.内容.trim(),
    数量: Number.isFinite(Number(raw.数量)) ? Number(raw.数量) : undefined,
  };
}

function normalizeTaskTarget(input: unknown): 任务目标 | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Partial<任务目标>;
  if (typeof raw.id !== 'string' || !raw.id.trim()) return null;
  const type = TARGET_TYPES.includes(String(raw.类型) as 任务目标类型) ? String(raw.类型) as 任务目标类型 : '达成';
  const target = Math.max(1, Math.trunc(Number(raw.目标数量) || 1));
  const current = Math.max(0, Math.trunc(Number(raw.当前数量) || 0));
  return {
    id: raw.id,
    类型: type,
    描述: typeof raw.描述 === 'string' ? raw.描述 : '',
    目标数量: target,
    当前数量: Math.min(current, target),
    关联对象: typeof raw.关联对象 === 'string' ? raw.关联对象 : undefined,
    完成: current >= target,
  };
}

function normalizeTask(input: unknown): 剧情任务 | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Partial<剧情任务>;
  if (typeof raw.id !== 'string' || !raw.id.trim()) return null;
  if (typeof raw.标题 !== 'string' || !raw.标题.trim()) return null;
  const status = TASK_STATUSES.includes(String(raw.状态) as 任务状态) ? String(raw.状态) as 任务状态 : '进行中';
  const 目标 = Array.isArray(raw.目标)
    ? raw.目标.map(normalizeTaskTarget).filter((item): item is 任务目标 => item !== null)
    : [];
  const task: 剧情任务 = {
    id: raw.id,
    标题: raw.标题.trim(),
    描述: typeof raw.描述 === 'string' ? raw.描述 : '',
    来源: raw.来源 === '支线' || raw.来源 === '自定义' || raw.来源 === '来信' ? raw.来源 : '主线',
    状态: status,
    目标,
    奖励: Array.isArray(raw.奖励)
      ? raw.奖励.map(normalizeTaskReward).filter((item): item is 任务奖励 => item !== null)
      : [],
    创建回合: Math.max(1, Math.trunc(Number(raw.创建回合) || 1)),
    更新时间: Number.isFinite(Number(raw.更新时间)) ? Number(raw.更新时间) : Date.now(),
    完成回合: Number.isFinite(Number(raw.完成回合)) ? Number(raw.完成回合) : undefined,
    关联分段: typeof raw.关联分段 === 'string' ? raw.关联分段 : undefined,
    备注: typeof raw.备注 === 'string' ? raw.备注 : undefined,
  };
  // 全部目标完成的任务强制为已完成。
  if (task.目标.length > 0 && task.目标.every((item) => item.完成) && task.状态 !== '已完成') {
    task.状态 = '已完成';
    task.完成回合 = task.完成回合 ?? task.创建回合;
  }
  return task;
}

export function 归一化任务系统(input: unknown): 任务系统 {
  const base = 创建空任务系统();
  if (!input || typeof input !== 'object' || Array.isArray(input)) return base;
  const raw = input as Partial<任务系统>;
  return {
    进行中: Array.isArray(raw.进行中) ? raw.进行中.map(normalizeTask).filter((item): item is 剧情任务 => item !== null) : base.进行中,
    已完成: Array.isArray(raw.已完成) ? raw.已完成.map(normalizeTask).filter((item): item is 剧情任务 => item !== null) : base.已完成,
    已放弃: Array.isArray(raw.已放弃) ? raw.已放弃.map(normalizeTask).filter((item): item is 剧情任务 => item !== null) : base.已放弃,
    上一轮任务更新: Array.isArray(raw.上一轮任务更新)
      ? raw.上一轮任务更新.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(-5)
      : base.上一轮任务更新,
  };
}

/** 运行时压缩：已完成 / 已放弃各保留最近 keep 条，进行中全保留。 */
export function compact任务系统(system: 任务系统, keep = 50): 任务系统 {
  return {
    进行中: Array.isArray(system.进行中) ? system.进行中 : [],
    已完成: (Array.isArray(system.已完成) ? system.已完成 : []).slice(-keep),
    已放弃: (Array.isArray(system.已放弃) ? system.已放弃 : []).slice(-keep),
    上一轮任务更新: Array.isArray(system.上一轮任务更新) ? system.上一轮任务更新.slice(-5) : [],
  };
}
