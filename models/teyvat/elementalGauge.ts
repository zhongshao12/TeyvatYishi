import type { ElementId } from './elements';

/**
 * 元素附着与反应（G1 一期，极简版）。
 *
 * 只回答一个问题："这一回合打出了什么元素反应"——
 * 场面残留一个附着元素；新元素打上来时按表判定是否触发反应并记录事件。
 * 没有量槽、没有衰减、没有伤害数值、没有 actor 建模。
 */

export interface ElementalFieldState {
  /** 当前场面残留的附着元素；空串表示无。 */
  auraElement: ElementId | '';
  updatedTurn: number;
  /** 最近一次反应/附着变化的简述。 */
  lastSummary: string;
}

export interface ElementalReactionEvent {
  id: string;
  turn: number;
  name: string;
  auraElement: ElementId;
  appliedElement: ElementId;
  /** 一句话描述，用于叙事一致性提示。 */
  narrative: string;
}

/** 场面元素事件最多保留的条数。 */
export const MAX_ELEMENT_EVENTS = 30;

export function createEmptyElementalField(): ElementalFieldState {
  return { auraElement: '', updatedTurn: 0, lastSummary: '' };
}

const ELEMENT_NAMES: Record<ElementId, string> = {
  anemo: '风元素',
  geo: '岩元素',
  electro: '雷元素',
  dendro: '草元素',
  hydro: '水元素',
  pyro: '火元素',
  cryo: '冰元素',
};

const ELEMENT_CHAR_MAP: Record<string, ElementId> = {
  风: 'anemo',
  岩: 'geo',
  雷: 'electro',
  草: 'dendro',
  水: 'hydro',
  火: 'pyro',
  冰: 'cryo',
};

/** 从回合正文中检测元素应用（约定写法："火元素"、"水元素" 等）。 */
export function detectAppliedElements(text: string): ElementId[] {
  if (!text) return [];
  const found: ElementId[] = [];
  const pattern = /([火水雷冰风岩草])元素/gu;
  for (const match of text.matchAll(pattern)) {
    const elementChar = match[1];
    const element = elementChar ? ELEMENT_CHAR_MAP[elementChar] : undefined;
    if (element && !found.includes(element)) found.push(element);
  }
  return found;
}

const SPEAKER_LINE_RE = /^【\s*([^】]+?)\s*】\s*([\s\S]*)$/;

/**
 * 仅检测旅行者本人施放的元素（熟练度结算专用，避免把敌人的元素攻击算进旅行者头上）。
 * - 【旅行者名】对白行：计入；
 * - 旁白 / 心声行：仅当句中提及旅行者时计入；
 * - 其他角色对白行：不计入。
 */
export function detectTravelerAppliedElements(text: string, travelerNames: readonly string[]): ElementId[] {
  if (!text) return [];
  const aliases = travelerNames.map((name) => name.trim()).filter((name) => name.length >= 1);
  const mentionsTraveler = (line: string): boolean => line.includes('旅行者') || aliases.some((alias) => line.includes(alias));
  const isTravelerSpeaker = (speaker: string): boolean => speaker === '你' || speaker === '我' || aliases.some((alias) => alias === speaker);

  const found: ElementId[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(SPEAKER_LINE_RE);
    let counts = false;
    if (match) {
      let speaker = (match[1] ?? '').trim().replace(/[：:].*$/, '');
      if (speaker === '角色') {
        const nameMatch = (match[2] ?? '').match(/^([^：:]+)[：:]/);
        if (nameMatch?.[1]) speaker = nameMatch[1].trim();
      }
      if (speaker === '旁白' || speaker === '心声' || speaker === '角色') {
        counts = mentionsTraveler(line);
      } else {
        counts = isTravelerSpeaker(speaker) || mentionsTraveler(line);
      }
    } else {
      counts = mentionsTraveler(line);
    }
    if (!counts) continue;
    for (const elementMatch of line.matchAll(/([火水雷冰风岩草])元素/gu)) {
      const elementChar = elementMatch[1];
      const element = elementChar ? ELEMENT_CHAR_MAP[elementChar] : undefined;
      if (element && !found.includes(element)) found.push(element);
    }
  }
  return found;
}

interface ReactionDef {
  name: string;
  narrative: string;
}

/** 反应表：附着元素 + 新应用元素 → 反应。风=扩散、岩=结晶对任意附着生效。 */
const REACTION_TABLE: Record<string, ReactionDef> = {
  'pyro+hydro': { name: '蒸发', narrative: '水汽裹住火焰，灼热的水雾炸开。' },
  'hydro+pyro': { name: '蒸发', narrative: '火焰点燃了湿气，白雾轰然蒸腾。' },
  'pyro+cryo': { name: '融化', narrative: '寒冰在烈焰中骤然消融，热浪翻倍涌出。' },
  'cryo+pyro': { name: '融化', narrative: '烈焰遇上冰棱，冰层崩裂成滚烫的水汽。' },
  'pyro+electro': { name: '超载', narrative: '电流引燃火焰，爆炸般的冲击向四周迸发。' },
  'electro+pyro': { name: '超载', narrative: '火焰被电弧点燃，轰然爆裂。' },
  'hydro+electro': { name: '感电', narrative: '电流顺着水渍窜行，电弧在湿气中跳跃。' },
  'electro+hydro': { name: '感电', narrative: '水幕导电，蓝白色的电蛇四处游走。' },
  'hydro+cryo': { name: '冻结', narrative: '寒气冻结水汽，冰霜瞬间封住一切。' },
  'cryo+hydro': { name: '冻结', narrative: '水面结出冰壳，寒霜蔓延成冻结的镜面。' },
  'hydro+dendro': { name: '绽放', narrative: '草木种子在水中生根，绽出发光的孢子。' },
  'dendro+hydro': { name: '绽放', narrative: '水润唤醒草籽，孢子如萤火般绽开。' },
  'electro+cryo': { name: '超导', narrative: '寒冰导引电流，霜与雷交织出刺骨的寒电。' },
  'cryo+electro': { name: '超导', narrative: '电流冻结成霜雷，刺骨寒意在空中炸开。' },
  'electro+dendro': { name: '原激化', narrative: '雷电催动草木，激荡出耀眼的绿雷之光。' },
  'dendro+electro': { name: '原激化', narrative: '草木引下天雷，青绿色的电光照亮全场。' },
  'pyro+dendro': { name: '燃烧', narrative: '草木被火焰点燃，烈焰在藤蔓间持续蔓延。' },
  'dendro+pyro': { name: '燃烧', narrative: '火焰攀上草木，燃起经久不熄的火苗。' },
};

const CRYSTAL_NAMES: Record<ElementId, string> = {
  pyro: '火结晶',
  hydro: '水结晶',
  cryo: '冰结晶',
  electro: '雷结晶',
  anemo: '风结晶',
  dendro: '草结晶',
  geo: '岩结晶',
};

const ELEMENT_NAMES_BY_ID = ELEMENT_NAMES;

/** 求反应：同元素为刷新附着（null）；风=扩散、岩=结晶对任意附着生效；其余查表。 */
export function resolveReaction(auraElement: ElementId, appliedElement: ElementId): ReactionDef | null {
  if (auraElement === appliedElement) return null;
  if (appliedElement === 'anemo' || auraElement === 'anemo') {
    const other = appliedElement === 'anemo' ? auraElement : appliedElement;
    const crystal = CRYSTAL_NAMES[other];
    return { name: `${ELEMENT_NAMES_BY_ID[other]}扩散`, narrative: `风卷起${crystal.replace('结晶', '')}元素，向四周扩散开来。` };
  }
  if (appliedElement === 'geo' || auraElement === 'geo') {
    const other = appliedElement === 'geo' ? auraElement : appliedElement;
    return { name: CRYSTAL_NAMES[other], narrative: `岩元素碰撞后凝出一枚${CRYSTAL_NAMES[other]}。` };
  }
  return REACTION_TABLE[`${auraElement}+${appliedElement}`] ?? null;
}

export interface ApplyElementOutcome {
  field: ElementalFieldState;
  events: ElementalReactionEvent[];
}

/**
 * 把一次元素应用结算到场面上：
 * 同元素 → 附着不变；有反应 → 记录事件并把附着换成新元素；无反应的不同元素 → 直接覆盖附着。
 */
export function applyElementToField(
  field: ElementalFieldState,
  appliedElement: ElementId,
  turn: number,
): ApplyElementOutcome {
  if (!ELEMENT_NAMES[appliedElement]) return { field, events: [] };

  // 无附着：直接附着。
  if (!field.auraElement) {
    return {
      field: { auraElement: appliedElement, updatedTurn: turn, lastSummary: `${ELEMENT_NAMES[appliedElement]}附着于场面。` },
      events: [],
    };
  }

  const reaction = resolveReaction(field.auraElement, appliedElement);

  // 同元素：附着保持。
  if (!reaction && field.auraElement === appliedElement) {
    return { field: { ...field, updatedTurn: turn }, events: [] };
  }

  // 有反应：记录事件，附着易主为新元素。
  if (reaction) {
    return {
      field: { auraElement: appliedElement, updatedTurn: turn, lastSummary: `触发${reaction.name}。` },
      events: [{
        id: `reaction_${turn}_${appliedElement}_${Date.now()}`,
        turn,
        name: reaction.name,
        auraElement: field.auraElement,
        appliedElement,
        narrative: reaction.narrative,
      }],
    };
  }

  // 无反应的不同元素：覆盖附着。
  return {
    field: { auraElement: appliedElement, updatedTurn: turn, lastSummary: `${ELEMENT_NAMES[appliedElement]}取代了先前的附着。` },
    events: [],
  };
}

/** 给下一回合提示词的一致性提示（无附着且无事件时返回空串）。 */
export function buildElementalFieldPromptSection(
  field: ElementalFieldState,
  events: ElementalReactionEvent[],
): string {
  const lines: string[] = [];
  if (field.auraElement) {
    lines.push(`【场面元素状态】当前场面残留着${ELEMENT_NAMES[field.auraElement]}附着。描写后续战斗时请保持元素效果的一致性。`);
  }
  const recent = events.slice(-2);
  for (const event of recent) {
    lines.push(`【元素反应记录】回合 ${event.turn} 触发${event.name}：${event.narrative}`);
  }
  return lines.join('\n');
}
