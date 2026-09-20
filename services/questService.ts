import type { TeyvatItem } from '@/models/teyvat/items';
import type { IrminsulMemory } from '@/models/teyvat/irminsul';
import type { TeyvatGameState } from '@/models/teyvat/state';
import type { QuestEntry, QuestJournal } from '@/models/teyvat/runtimeSlices';
import { buildTeyvatIdSelector, buildTeyvatStableId, type TeyvatDomainCommand } from '@/models/teyvat/domainCommand';
import type { 任务系统, 剧情任务, 任务目标, 任务奖励, 任务目标类型, 任务状态 } from '@/models/quest';
import { 创建空任务系统 } from '@/models/quest';

export interface 任务更新命令 {
  kind: 'accept' | 'objective' | 'progress' | 'complete' | 'abandon';
  任务标题: string;
  目标类型?: 任务目标类型;
  描述?: string;
  数量?: number;
  关联对象?: string;
  来源?: string;
  目标ID?: string;
}

export interface 任务结算上下文 {
  正文: string;
  变量事实: Array<{ 路径: string; 值: unknown }>;
  当前地点?: string;
  背包物品?: TeyvatItem[];
  当前回合: number;
}

export interface QuestArchiveFact {
  questId: string;
  title: string;
  summary: string;
}

export interface QuestDomainSettlementInput {
  state: TeyvatGameState;
  questUpdates: readonly string[];
  body: string;
  variableFacts: ReadonlyArray<{ 路径: string; 值: unknown }>;
  turn: number;
  evidence: string;
}

export interface QuestDomainSettlement {
  commands: TeyvatDomainCommand[];
  archiveFacts: QuestArchiveFact[];
  updates: string[];
}

const TARGET_TYPES: readonly 任务目标类型[] = ['达成', '收集', '交谈', '前往', '击杀', '时间'];
let questCounter = 0;
let targetCounter = 0;

function 生成任务ID(): string {
  questCounter += 1;
  return `quest_${Date.now()}_${questCounter}_${Math.random().toString(36).slice(2, 7)}`;
}

function 生成目标ID(): string {
  targetCounter += 1;
  return `target_${Date.now()}_${targetCounter}`;
}

function stableToken(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function command(
  evidence: string,
  action: TeyvatDomainCommand['action'],
  root: TeyvatDomainCommand['root'],
  path: string,
  value?: unknown,
): TeyvatDomainCommand {
  return { action, root, path, ...(action === 'delete' ? {} : { value }), evidence };
}

function rewardParts(raw: string): { type: 'item' | 'affinity' | 'memory'; content: string; quantity: number } {
  const parts = raw.split(/[:|]/).map((part) => part.trim());
  const tag = parts[0];
  const content = (parts[1] || (tag !== '物品' && tag !== '好感' && tag !== '记忆' ? tag : '') || '').trim();
  const quantity = Math.max(1, Math.trunc(Number(parts[2]) || (tag === '好感' ? 5 : 1)));
  if (tag === '好感') return { type: 'affinity', content, quantity };
  if (tag === '记忆') return { type: 'memory', content, quantity: 1 };
  return { type: 'item', content, quantity };
}

function objectiveHitCount(
  objective: TeyvatGameState['任务']['active'][number]['objectives'][number],
  input: QuestDomainSettlementInput,
): number {
  const factText = input.variableFacts.map((fact) => `${fact.路径}=${String(fact.值)}`).join('\n');
  const corpus = `${input.body}\n${factText}`;
  if (objective.type === 'travel') {
    const location = input.state.世界.当前地点;
    return location && (objective.description.includes(location) || corpus.includes(location)) ? 1 : 0;
  }
  if (objective.type === 'collect') {
    const words = objective.description.replace(/[\d\s份个枚收集获得]/g, '');
    const total = input.state.背包.items
      .filter((item) => words.includes(item.name) || objective.description.includes(item.name))
      .reduce((sum, item) => sum + item.quantity, 0);
    return total;
  }
  const keywords = objective.description
    .split(/[，。；、\s]/)
    .map((item) => item.replace(/^(与|向|抵达|前往|击败|完成)/, ''))
    .filter((item) => item.length >= 2);
  return keywords.some((keyword) => corpus.includes(keyword)) ? 1 : 0;
}

/**
 * Purely derives every synchronous quest side effect as formal domain commands.
 * It never mutates the supplied state and never performs a partial write.
 */
export function deriveQuestDomainCommands(input: QuestDomainSettlementInput): QuestDomainSettlement {
  const commands: TeyvatDomainCommand[] = [];
  const archiveFacts: QuestArchiveFact[] = [];
  const updates: string[] = [];
  const projectedInventory = input.state.背包.items.map((item) => ({ ...item }));
  const quests = new Map(input.state.任务.active.map((quest) => [quest.id, structuredClone(quest)]));
  const byTitle = () => new Map([...quests.values()].map((quest) => [quest.title, quest]));
  const parsed = 解析任务更新命令(input.questUpdates.join('\n'));

  for (const update of parsed) {
    if (update.kind === 'accept' && update.任务标题.trim()) {
      if ([...quests.values()].some((quest) => quest.title === update.任务标题)) continue;
      const id = buildTeyvatStableId('quest', [input.turn, stableToken(update.任务标题)]);
      const quest: TeyvatGameState['任务']['active'][number] = {
        id,
        title: update.任务标题,
        description: update.描述 ?? '',
        source: update.来源 === '自定义' ? 'custom' : update.来源 === '来信' ? 'letter' : update.来源 === '主线' ? 'main' : 'side',
        status: 'active', objectives: [], rewards: [], createdAtTurn: input.turn, updatedAt: input.turn,
      };
      quests.set(id, quest);
      commands.push(command(input.evidence, 'push', '任务', 'active', quest));
      updates.push(`接取任务：${quest.title}`);
      continue;
    }
    let quest = byTitle().get(update.任务标题) ?? quests.get(update.任务标题);
    // 模型有时先报告“目标”，没有单独报告“接取”。目标本身就是可验证的任务事实，
    // 因此立即补建活动任务，避免界面显示更新提示却没有任何任务条目。
    if (!quest && update.kind === 'objective' && update.任务标题.trim()) {
      const id = buildTeyvatStableId('quest', [input.turn, stableToken(update.任务标题)]);
      quest = {
        id,
        title: update.任务标题,
        description: update.描述 ?? '',
        source: 'side',
        status: 'active',
        objectives: [],
        rewards: [],
        createdAtTurn: input.turn,
        updatedAt: input.turn,
      };
      quests.set(id, quest);
      commands.push(command(input.evidence, 'push', '任务', 'active', quest));
      updates.push(`接取任务：${quest.title}`);
    }
    if (!quest) continue;
    if (update.kind === 'objective' && update.描述?.trim()) {
      if (quest.objectives.some((item) => item.description === update.描述)) continue;
      const objective = {
        id: buildTeyvatStableId('objective', [input.turn, stableToken(`${quest.id}:${update.描述}`)]),
        type: ({ 达成: 'reach', 收集: 'collect', 交谈: 'talk', 前往: 'travel', 击杀: 'defeat', 时间: 'time' } as const)[update.目标类型 ?? '达成'],
        description: update.描述,
        targetCount: Math.max(1, Math.trunc(update.数量 ?? 1)),
        currentCount: 0,
        completed: false,
      };
      quest.objectives.push(objective);
      commands.push(command(input.evidence, 'push', '任务', `active${buildTeyvatIdSelector(quest.id)}.objectives`, objective));
      continue;
    }
    if (update.kind === 'progress' && update.目标ID) {
      const objective = quest.objectives.find((item) => item.id === update.目标ID);
      if (!objective) continue;
      const count = Math.min(objective.targetCount, Math.max(objective.currentCount, Math.trunc(update.数量 ?? 0)));
      if (count !== objective.currentCount) {
        objective.currentCount = count;
        objective.completed = count >= objective.targetCount;
        commands.push(command(input.evidence, 'set', '任务', `active${buildTeyvatIdSelector(quest.id)}.objectives${buildTeyvatIdSelector(objective.id)}.currentCount`, count));
      }
      continue;
    }
    if (update.kind === 'complete' || update.kind === 'abandon') {
      quest.status = update.kind === 'complete' ? 'completed' : 'abandoned';
    }
  }

  for (const quest of quests.values()) {
    if (quest.status === 'active') {
      for (const objective of quest.objectives) {
        if (objective.completed) continue;
        const next = Math.min(objective.targetCount, Math.max(objective.currentCount, objectiveHitCount(objective, input)));
        if (next === objective.currentCount) continue;
        objective.currentCount = next;
        objective.completed = next >= objective.targetCount;
        commands.push(command(input.evidence, 'set', '任务', `active${buildTeyvatIdSelector(quest.id)}.objectives${buildTeyvatIdSelector(objective.id)}.currentCount`, next));
      }
      if (quest.objectives.length > 0 && quest.objectives.every((objective) => objective.completed)) quest.status = 'completed';
    }
    if (quest.status !== 'completed' && quest.status !== 'abandoned') continue;
    const status = quest.status;
    commands.push(command(input.evidence, 'set', '任务', `active${buildTeyvatIdSelector(quest.id)}.status`, status));
    const updateLine = `${status === 'completed' ? '完成' : '放弃'}任务：${quest.title}`;
    updates.push(updateLine);
    if (status === 'completed') {
      const memoryRewards: string[] = [];
      for (const rawReward of quest.rewards) {
        const reward = rewardParts(rawReward);
        if (reward.type === 'memory') {
          if (reward.content) memoryRewards.push(reward.content);
          continue;
        }
        if (reward.type === 'affinity') {
          const npc = input.state.NPC.find((item) => item.id === reward.content || item.姓名 === reward.content || item.aliases.includes(reward.content));
          const npcId = npc?.id ?? buildTeyvatStableId('missing', [stableToken(reward.content)]);
          commands.push(command(input.evidence, 'add', 'NPC', `${buildTeyvatIdSelector(npcId)}.affinity`, reward.quantity));
          continue;
        }
        if (!reward.content) continue;
        const existing = projectedInventory.find((item) => item.name === reward.content && item.stackable !== false);
        if (existing) {
          commands.push(command(input.evidence, 'add', '背包', `items${buildTeyvatIdSelector(existing.id)}.quantity`, reward.quantity));
          existing.quantity += reward.quantity;
        } else {
          const item = {
            id: buildTeyvatStableId('quest_reward', [quest.id, stableToken(reward.content)]),
            category: 'quest' as const, name: reward.content, description: '任务奖励', quantity: reward.quantity,
            rarity: 4 as const, stackable: true, obtainedAtTurn: input.turn, source: '任务奖励',
          };
          commands.push(command(input.evidence, 'push', '背包', 'items', item));
          projectedInventory.push({ ...item });
        }
      }
      archiveFacts.push({
        questId: quest.id,
        title: quest.title,
        summary: memoryRewards.length ? memoryRewards.join('；') : updateLine,
      });
    }
  }

  for (const update of updates.slice(-5)) commands.push(command(input.evidence, 'push', '任务', 'lastUpdates', update));
  return { commands, archiveFacts, updates };
}

/** Builds the idempotent post-commit quest archive from committed quest state. */
export function buildCommittedQuestArchive(
  current: IrminsulMemory,
  committedState: TeyvatGameState,
  facts: readonly QuestArchiveFact[],
  turn: number,
): IrminsulMemory {
  const entries = [...current.entries];
  for (const fact of facts) {
    if (!committedState.任务.completed.some((quest) => quest.id === fact.questId)) continue;
    const id = `irminsul_quest_${turn}_${fact.questId}`;
    if (entries.some((entry) => entry.id === id)) continue;
    entries.push({
      id,
      title: `任务完成：${fact.title}`,
      summary: fact.summary,
      sourceTurns: [turn],
      keywords: ['任务', fact.title],
      recordedAt: committedState.世界.当前日期 || String(turn),
      archiveType: 'short',
      sourceText: fact.summary,
      turn,
    });
  }
  return { entries };
}

export function deriveCommittedQuestArchiveFacts(
  committedState: TeyvatGameState,
  questFacts: readonly string[],
  turn: number,
): QuestArchiveFact[] {
  const summary = questFacts.map((fact) => fact.trim()).filter(Boolean).join('；');
  return committedState.任务.completed
    .filter((quest) => quest.completedAtTurn === turn)
    .map((quest) => {
      const memorySummary = quest.rewards
        .map(rewardParts)
        .filter((reward) => reward.type === 'memory')
        .map((reward) => reward.content)
        .filter(Boolean)
        .join('；');
      return {
        questId: quest.id,
        title: quest.title,
        summary: memorySummary || summary || `完成任务：${quest.title}`,
      };
    });
}

export function 解析任务更新命令(raw: string): 任务更新命令[] {
  const commands: 任务更新命令[] = [];
  if (!raw) return commands;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    const match = trimmed.match(/^(接取|目标|进展|完成|放弃):\s*(.+)$/);
    if (!match) continue;
    const [ , kind, rest ] = match;
    if (!rest) continue;
    const parts = rest.split('|').map((part) => part.trim());
    if (kind === '接取') commands.push({ kind: 'accept', 任务标题: parts[0] ?? '', 描述: parts[1] ?? '', 来源: parts[2] ?? '支线' });
    if (kind === '目标') commands.push({
      kind: 'objective',
      任务标题: parts[0] ?? '',
      目标类型: TARGET_TYPES.includes(parts[1] as 任务目标类型) ? parts[1] as 任务目标类型 : '达成',
      描述: parts[2] ?? '',
      数量: Math.max(1, Number(parts[3]) || 1),
      关联对象: parts[4] || undefined,
    });
    if (kind === '进展') commands.push({ kind: 'progress', 任务标题: parts[0] ?? '', 目标ID: parts[1], 数量: Math.max(0, Number(parts[2]) || 0) });
    if (kind === '完成') commands.push({ kind: 'complete', 任务标题: parts[0] ?? '' });
    if (kind === '放弃') commands.push({ kind: 'abandon', 任务标题: parts[0] ?? '' });
  }
  return commands;
}

function findTask(system: 任务系统, title: string): 剧情任务 | undefined {
  return [...system.进行中, ...system.已完成, ...system.已放弃].find((task) => task.标题 === title || task.id === title);
}

export function 应用任务更新命令(system: 任务系统, commands: 任务更新命令[], 当前回合: number): 任务系统 {
  let next = { ...system, 进行中: [...system.进行中], 已完成: [...system.已完成], 已放弃: [...system.已放弃], 上一轮任务更新: [...system.上一轮任务更新] };
  for (const command of commands) {
    if (command.kind === 'accept') {
      if (next.进行中.some((task) => task.标题 === command.任务标题)) continue;
      const task: 剧情任务 = {
        id: 生成任务ID(),
        标题: command.任务标题,
        描述: command.描述 ?? '',
        来源: command.来源 === '支线' || command.来源 === '自定义' || command.来源 === '来信' ? command.来源 : '支线',
        状态: '进行中',
        目标: [],
        奖励: [],
        创建回合: 当前回合,
        更新时间: Date.now(),
      };
      next = { ...next, 进行中: [task, ...next.进行中], 上一轮任务更新: [...next.上一轮任务更新, `接取任务：${task.标题}`].slice(-5) };
    }
    if (command.kind === 'objective') {
      next = {
        ...next,
        进行中: next.进行中.map((task) => {
          if (task.标题 !== command.任务标题 || task.目标.some((item) => item.描述 === command.描述)) return task;
          const target: 任务目标 = {
            id: 生成目标ID(),
            类型: command.目标类型 ?? '达成',
            描述: command.描述 ?? '',
            目标数量: command.数量 ?? 1,
            当前数量: 0,
            关联对象: command.关联对象,
            完成: false,
          };
          return { ...task, 目标: [...task.目标, target], 更新时间: Date.now() };
        }),
      };
    }
    if (command.kind === 'progress') {
      next = {
        ...next,
        进行中: next.进行中.map((task) => {
          if (task.标题 !== command.任务标题 || !command.目标ID) return task;
          return {
            ...task,
            目标: task.目标.map((item) => item.id === command.目标ID
              ? { ...item, 当前数量: Math.min(item.目标数量, Math.max(item.当前数量, command.数量 ?? 0)), 完成: Math.min(item.目标数量, Math.max(item.当前数量, command.数量 ?? 0)) >= item.目标数量 }
              : item),
            更新时间: Date.now(),
          };
        }),
      };
    }
    if (command.kind === 'complete') {
      const existing = findTask(next, command.任务标题);
      if (!existing || existing.状态 === '已完成') continue;
      const completed: 剧情任务 = { ...existing, 状态: '已完成', 完成回合: 当前回合, 更新时间: Date.now() };
      next = {
        ...next,
        进行中: next.进行中.filter((task) => task.id !== existing.id),
        已完成: [completed, ...next.已完成],
        上一轮任务更新: [...next.上一轮任务更新, `完成任务：${existing.标题}`].slice(-5),
      };
    }
    if (command.kind === 'abandon') {
      const existing = next.进行中.find((task) => task.标题 === command.任务标题 || task.id === command.任务标题);
      if (!existing) continue;
      const abandoned: 剧情任务 = { ...existing, 状态: '已放弃', 更新时间: Date.now() };
      next = {
        ...next,
        进行中: next.进行中.filter((task) => task.id !== existing.id),
        已放弃: [abandoned, ...next.已放弃],
        上一轮任务更新: [...next.上一轮任务更新, `放弃任务：${existing.标题}`].slice(-5),
      };
    }
  }
  return next;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle || !haystack) return 0;
  let count = 0;
  let index = 0;
  while ((index = haystack.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}

function factTexts(ctx: 任务结算上下文): string[] {
  return (ctx.变量事实 ?? [])
    .map((fact) => {
      const value = typeof fact.值 === 'string'
        ? fact.值
        : JSON.stringify(fact.值 ?? '');
      return `${fact.路径}=${String(value)}`;
    });
}

/** 结算目标进展；全部目标完成的任务自动转为已完成并返回奖励。 */
export function 结算任务进展(system: 任务系统, ctx: 任务结算上下文): { system: 任务系统; rewards: 任务奖励[] } {
  let rewards: 任务奖励[] = [];
  let next: 任务系统 = { ...system, 进行中: [...system.进行中] };
  const factLines = factTexts(ctx);
  const body = ctx.正文 ?? '';
  next = {
    ...next,
    进行中: next.进行中.map((task) => {
      const 目标 = task.目标.map((item) => {
        if (item.完成) return item;
        const 关联对象 = item.关联对象;
        let current = item.当前数量;
        if (item.类型 === '交谈' && 关联对象) {
          const hit = body.includes(关联对象) || factLines.some((line) => line.includes(关联对象));
          if (hit) current = Math.max(current, 1);
        }
        if (item.类型 === '前往' && 关联对象) {
          if (ctx.当前地点 && ctx.当前地点.includes(关联对象)) current = Math.max(current, 1);
        }
        if (item.类型 === '收集' && 关联对象) {
          const total = (ctx.背包物品 ?? []).filter((item2) => item2.name.includes(关联对象)).reduce((sum, item2) => sum + item2.quantity, 0);
          current = Math.min(item.目标数量, Math.max(current, total));
        }
        if (item.类型 === '击杀' || item.类型 === '达成' || item.类型 === '时间') {
          const needle = 关联对象 || item.描述.slice(0, 12);
          const hits = countOccurrences(body, needle) + factLines.reduce((sum, line) => sum + countOccurrences(line, needle), 0);
          current = Math.min(item.目标数量, current + hits);
        }
        return { ...item, 当前数量: current, 完成: current >= item.目标数量 };
      });
      return { ...task, 目标, 更新时间: Date.now() };
    }),
  };
  const justCompleted = next.进行中.filter((task) => task.目标.length > 0 && task.目标.every((item) => item.完成) && !task.目标.every((item) => item.当前数量 === 0));
  for (const task of justCompleted) {
    const result = 完成任务并生成奖励命令(next, task.id, ctx.当前回合);
    next = result.system;
    rewards = [...rewards, ...result.rewards];
  }
  return { system: next, rewards };
}

export function 完成任务并生成奖励命令(system: 任务系统, taskId: string, 当前回合?: number): { system: 任务系统; rewards: 任务奖励[] } {
  const task = system.进行中.find((item) => item.id === taskId);
  if (!task) return { system, rewards: [] };
  const completed: 剧情任务 = {
    ...task,
    状态: '已完成',
    完成回合: 当前回合 ?? (task.创建回合 + 1),
    更新时间: Date.now(),
  };
  return {
    system: {
      ...system,
      进行中: system.进行中.filter((item) => item.id !== taskId),
      已完成: [completed, ...system.已完成],
      上一轮任务更新: [...system.上一轮任务更新, `完成任务：${task.标题}`].slice(-5),
    },
    rewards: task.奖励,
  };
}

export function 放弃任务(system: 任务系统, taskId: string): 任务系统 {
  const task = system.进行中.find((item) => item.id === taskId);
  if (!task) return system;
  const abandoned: 剧情任务 = { ...task, 状态: '已放弃' as 任务状态, 更新时间: Date.now() };
  return {
    ...system,
    进行中: system.进行中.filter((item) => item.id !== taskId),
    已放弃: [abandoned, ...system.已放弃],
    上一轮任务更新: [...system.上一轮任务更新, `放弃任务：${task.标题}`].slice(-5),
  };
}

export function abandonQuest(
  journal: QuestJournal,
  questId: string,
  updatedAt = Date.now(),
): QuestJournal {
  const quest = journal.active.find((entry) => entry.id === questId);
  if (!quest) return journal;
  const abandoned: QuestEntry = {
    ...quest,
    status: 'abandoned',
    updatedAt,
  };
  return {
    ...journal,
    active: journal.active.filter((entry) => entry.id !== questId),
    abandoned: [abandoned, ...journal.abandoned],
    lastUpdates: [...journal.lastUpdates, `放弃任务：${quest.title}`].slice(-5),
  };
}

export { 创建空任务系统 };
