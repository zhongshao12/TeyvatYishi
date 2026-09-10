import type { 聊天消息 } from '@/models/chat';
import type { NPC记录 } from '@/models/npc';
import type { 世界状态 } from '@/models/world';
import { narrativeTurnBodyText } from '@/models/teyvat/narrativeTurn';

function namesLikelySame(a: string, b: string): boolean {
  const left = a.trim();
  const right = b.trim();
  return !!left && !!right && (left === right || left.includes(right) || right.includes(left));
}

function nameAppearsInText(name: string, text: string): boolean {
  const cleanName = name.trim();
  if (!cleanName || !text.trim()) return false;
  if (cleanName.length <= 1) {
    const escaped = cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[\\s，。！？、：；“”"'（）()《》【】])${escaped}($|[\\s，。！？、：；“”"'（）()《》【】])`).test(text);
  }
  return text.includes(cleanName);
}

function recentNarrativeText(history: 聊天消息[], limit = 4): string {
  return history
    .slice(-limit)
    .map((msg) => msg.parsedResponse ? narrativeTurnBodyText(msg.parsedResponse) : msg.content)
    .join('\n');
}

export function getExplicitNpcNamesForTurn(input: {
  world: 世界状态;
  npcs?: NPC记录[];
  history?: 聊天消息[];
  userInput?: string;
  turnCount: number;
}): string[] {
  const npcs = input.npcs ?? [];
  const text = [input.userInput ?? '', recentNarrativeText(input.history ?? [])].join('\n');
  const sceneNames = new Set((input.world.当前时段?.人物 ?? []).map((npc) => npc.姓名.trim()).filter(Boolean));
  const recentCutoff = Math.max(1, input.turnCount - 3);
  const picked: string[] = [];
  const push = (name?: string) => {
    const trimmed = name?.trim();
    if (trimmed && !picked.some((item) => namesLikelySame(item, trimmed))) picked.push(trimmed);
  };

  for (const npc of npcs) {
    const isExplicit =
      npc.同行 ||
      sceneNames.has(npc.姓名) ||
      Boolean(npc.别名 && sceneNames.has(npc.别名)) ||
      Number(npc.最近回合 || 0) >= recentCutoff ||
      nameAppearsInText(npc.姓名, text) ||
      Boolean(npc.别名 && nameAppearsInText(npc.别名, text));
    if (isExplicit) push(npc.姓名);
    if (picked.length >= 12) break;
  }

  return picked;
}

function addUnique(list: string[], name: string): void {
  const trimmed = name.trim();
  if (trimmed && !list.some((item) => namesLikelySame(item, trimmed))) list.push(trimmed);
}

function filterOriginalProtagonistNames(names: string[], originalProtagonist?: 世界状态['原著主角']): string[] {
  if (originalProtagonist === '荧') return names.filter((name) => !namesLikelySame(name, '空'));
  if (originalProtagonist === '空') return names.filter((name) => !namesLikelySame(name, '荧'));
  return names;
}

/** 队伍成员（旅行者 + 同行同伴）每回合强制注入anticipated名单。 */
export function getPartyMemberNames(npcRecords: NPC记录[] | undefined): string[] {
  if (!npcRecords) return [];
  return npcRecords
    .filter((npc) => npc.同行 && npc.阶位 === 'companion')
    .map((npc) => npc.姓名)
    .filter(Boolean)
    .slice(0, 3);
}

/** 返回本轮正文里完全没有露面的同行成员，用于生成结果的确定性完整性校验。 */
export function getMissingPartyMembers(body: string, npcRecords: NPC记录[] | undefined): string[] {
  return getPartyMemberNames(npcRecords).filter((name) => !nameAppearsInText(name, body));
}

export function getAnticipatedNpcNamesForTurn(input: {
  world: 世界状态;
  history?: 聊天消息[];
  userInput?: string;
  npcRecords?: NPC记录[];
}): string[] {
  const text = [
    input.userInput ?? '',
    recentNarrativeText(input.history ?? [], 6),
    input.world.当前地点 ?? '',
    input.world.当前时段?.名称 ?? '',
  ].join('\n');
  const names: string[] = [];

  if (/派蒙|蒙德城|低语森林|风起地|西风骑士团|冒险家协会|广播|龙灾/.test(text)) {
    addUnique(names, '派蒙');
  }
  if (/西风骑士团|冒险家协会|蒙德城|低语森林|风起地|旅途/.test(text)) {
    for (const name of ['安柏', '凯亚', '琴', '丽莎']) {
      if (nameAppearsInText(name, text)) addUnique(names, name);
    }
  }

  // 队伍成员强制在列：每次对话都带上这四个人
  for (const name of getPartyMemberNames(input.npcRecords)) {
    if (!names.includes(name)) addUnique(names, name);
  }
  return filterOriginalProtagonistNames(names, input.world.原著主角).slice(0, 8);
}

export function getCodexNpcNamesForTurn(input: {
  world: 世界状态;
  npcs?: NPC记录[];
  history?: 聊天消息[];
  userInput?: string;
  turnCount: number;
}): string[] {
  const names: string[] = [];
  for (const name of getExplicitNpcNamesForTurn(input)) addUnique(names, name);
  for (const name of getAnticipatedNpcNamesForTurn(input)) addUnique(names, name);
  return filterOriginalProtagonistNames(names, input.world.原著主角).slice(0, 12);
}
