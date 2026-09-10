import type { 变量事实, 变量命令 } from '@/models/variableCommand';
import type { VariableState } from './variableRegistry';
import type { 世界状态 } from '@/models/world';
import { 对齐世界日期与天数, 推进旅行日期 } from '@/models/world';
import type { NPC记录, NPC关系类型 } from '@/models/npc';
import { isReservedNpcIdentityName, 获取NPC关系阶段, 获取NPC兼容关系, 限制NPC好感度 } from '@/models/npc';
import { matchCanonical } from '@/data/canonicalCharacters';
import {
  ARTIFACT_SLOTS,
  ITEM_CATEGORIES,
  ITEM_RARITIES,
  type ArtifactSlot,
  type ItemCategory,
  type ItemRarity,
  type TeyvatInventory,
  type TeyvatItem,
} from '@/models/teyvat/items';
import type { CourierDeliverySeed, CourierSystem } from '@/models/teyvat/courier';
import type { TeyvatGameState } from '@/models/teyvat/state';
import {
  buildTeyvatIdSelector,
  buildTeyvatStableId,
  isTeyvatStableId,
  type TeyvatDomainCommand,
} from '@/models/teyvat/domainCommand';
import { extractJsonLikeText, parseJsonWithRepair } from '@/services/ai/structuredOutputRepair';
import { 天气列表 } from '@/data/weatherRules';
import { getNsfwArchiveBlockReason } from '@/utils/nsfwArchivePolicy';
import {
  normalizeLegacyFactKind,
  readLegacyNpcKeyFromName,
  readLegacyNpcNameFromKey,
} from '@/compat/legacy-hsr/readOnly';

const ITEM_CATEGORY_SET = new Set<ItemCategory>(ITEM_CATEGORIES);
const NPC_RELATIONS = new Set<NPC关系类型>(['stranger', 'acquaintance', 'friend', 'close', 'rival', 'enemy']);
const COURIER_TRIGGER_TYPES = new Set<CourierDeliverySeed['triggerType']>(['injury', 'victory', 'defeat', 'location_change', 'important_item', 'relationship', 'steambird', 'quest', 'time', 'custom']);
const COURIER_PRIORITIES = new Set<CourierDeliverySeed['priority']>(['low', 'normal', 'high', 'urgent']);
const NSFW_AGE_VALUES = new Set(['adult', 'unknown', 'minor_blocked']);
const FACT_TYPE_ALIASES: Record<string, 变量事实['type']> = {
  旅人: 'traveler_profile',
  旅人档案: 'traveler_profile',
  traveler: 'traveler_profile',
  travelerProfile: 'traveler_profile',
  traveler_profile: 'traveler_profile',
  时间: 'time',
  time: 'time',
  地点: 'location',
  location: 'location',
  天气: 'weather',
  weather: 'weather',
  NPC: 'npc',
  npc: 'npc',
  npc_memory: 'npc',
  npcMemory: 'npc',
  relationship: 'npc',
  伙伴记忆: 'npc',
  物品: 'item',
  item: 'item',
  item_gain: 'item',
  itemGain: 'item',
  获得物品: 'item',
  item_use: 'item',
  itemUse: 'item',
  item_give: 'item',
  itemGive: 'item',
  item_loss: 'item',
  itemLoss: 'item',
  使用物品: 'item',
  交付物品: 'item',
  失去物品: 'item',
  世界事件: 'world_event',
  world_event: 'world_event',
  worldEvent: 'world_event',
  event: 'world_event',
  信使来信: 'courier_seed',
  courier_seed: 'courier_seed',
  courierSeed: 'courier_seed',
  courier_message_seed: 'courier_seed',
  delivery_seed: 'courier_seed',
  message_seed: 'courier_seed',
  NSFW档案: 'nsfw_archive',
  nsfw: 'nsfw_archive',
  nsfw_archive: 'nsfw_archive',
  nsfwArchive: 'nsfw_archive',
  技能使用: 'skill_used',
  skill_used: 'skill_used',
  skillUsed: 'skill_used',
  talent_used: 'skill_used',
  talentUsed: 'skill_used',
};
const ITEM_CATEGORY_ALIASES: Record<string, ItemCategory> = {
  食物: 'food',
  餐食: 'food',
  小道具: 'gadget',
  道具: 'gadget',
  武器: 'weapon',
  圣遗物: 'artifact',
  材料: 'material',
  任务道具: 'quest',
  摆设: 'furnishing',
};
type ItemFactAction = Extract<变量事实, { type: 'item' }>['action'];
const ITEM_ACTION_ALIASES: Record<string, ItemFactAction> = {
  获得: 'gain',
  获取: 'gain',
  得到: 'gain',
  拾取: 'gain',
  gain: 'gain',
  使用: 'consume',
  消耗: 'consume',
  吃掉: 'consume',
  use: 'consume',
  consume: 'consume',
  给予: 'give',
  给出: 'give',
  交给: 'give',
  赠送: 'give',
  交付: 'give',
  give: 'give',
  丢失: 'lose',
  失去: 'lose',
  损失: 'lose',
  lose: 'lose',
};
const COURIER_TRIGGER_ALIASES: Record<string, CourierDeliverySeed['triggerType']> = {
  受伤: 'injury',
  胜利: 'victory',
  失败: 'defeat',
  地点变化: 'location_change',
  关键物品: 'important_item',
  关系变化: 'relationship',
  新闻: 'steambird',
  news: 'steambird',
  任务: 'quest',
  时间: 'time',
  自定义: 'custom',
};
const COURIER_PRIORITY_ALIASES: Record<string, CourierDeliverySeed['priority']> = {
  低: 'low',
  普通: 'normal',
  一般: 'normal',
  高: 'high',
  紧急: 'urgent',
};

function 清理事实块(block: string): string {
  return extractJsonLikeText(block, 'any');
}

function 读字符串(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function 是对象(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function 数字(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function 读字符串或数组(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean).join('；');
  return '';
}

function 字符串数组(value: unknown): string[] | undefined {
  const list = Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    : typeof value === 'string' && value.trim()
      ? [value.trim()]
      : [];
  return list.length ? list : undefined;
}

function 读取字符串对象(value: unknown, allowedKeys: string[]): Record<string, string> | undefined {
  if (!是对象(value)) return undefined;
  const output: Record<string, string> = {};
  for (const key of allowedKeys) {
    const text = 读字符串(value[key]);
    if (text) output[key] = text;
  }
  return Object.keys(output).length ? output : undefined;
}

function 归一化年龄确认(value: unknown): 'adult' | 'unknown' | 'minor_blocked' | undefined {
  const text = 读字符串(value);
  const normalized = ({
    成人: 'adult',
    成年: 'adult',
    未知: 'unknown',
    年龄不明: 'unknown',
    未成年阻止: 'minor_blocked',
    未成年: 'minor_blocked',
    禁止: 'minor_blocked',
  } as Record<string, string>)[text] ?? text;
  return NSFW_AGE_VALUES.has(normalized) ? normalized as 'adult' | 'unknown' | 'minor_blocked' : undefined;
}

function npcNameFromId(id: string): string {
  const normalized = id.replace(/^npc[_-]/i, '').toLowerCase();
  const map: Record<string, string> = {
    aether: '空', lumine: '荧', paimon: '派蒙', amber: '安柏', kaeya: '凯亚',
    lisa: '丽莎', jean: '琴', venti: '温迪', diluc: '迪卢克', barbara: '芭芭拉',
  };
  return map[normalized] ?? readLegacyNpcNameFromKey(normalized);
}

function inferNpcTier(fact: Extract<变量事实, { type: 'npc' }>, canonical: ReturnType<typeof matchCanonical>): 'companion' | 'extra' {
  if (fact.tier) return fact.tier;
  if (canonical) return 'companion';
  if (fact.following) return 'companion';
  if (fact.memory) return 'companion';
  if (fact.recentInteraction || fact.longTermImpression || fact.relationshipStage) return 'companion';
  if (fact.sharedExperiences?.length || fact.openItems?.length || fact.resolvedItems?.length || fact.unresolvedConflicts?.length || fact.mustRemember?.length || fact.doNotForget?.length) return 'companion';
  if (typeof fact.affinityDelta === 'number' && fact.affinityDelta !== 0) return 'companion';
  if (typeof fact.affinitySet === 'number' && fact.affinitySet !== 0) return 'companion';
  if (fact.relation && fact.relation !== 'stranger' && fact.relation !== 'acquaintance') return 'companion';
  return 'extra';
}

function 读取记忆摘要(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!是对象(value)) return '';
  return 读字符串(value.摘要 || value.summary || value.text || value.内容);
}

function pushNpcLedgerListCommands(
  push: (command: 变量命令) => void,
  key: string,
  field: '共同经历' | '未完成事项' | '未解决冲突' | '必须记得' | '禁止遗忘',
  incoming?: string[],
  existing?: string[],
) {
  if (!incoming?.length) return;
  const seen = new Set((existing ?? []).map((item) => item.trim()).filter(Boolean));
  for (const item of incoming) {
    const text = item.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    push({ action: 'push', key: `${key}.${field}`, value: text });
  }
}

function 归一化事实类型(value: unknown): 变量事实['type'] | '' {
  const text = 读字符串(value);
  return FACT_TYPE_ALIASES[text] ?? normalizeLegacyFactKind(text) ?? '';
}

function 归一化物品分类(value: unknown): ItemCategory | '' {
  const text = 读字符串(value);
  return (ITEM_CATEGORY_ALIASES[text] ?? text) as ItemCategory | '';
}

function 归一化物品动作(value: unknown): ItemFactAction | '' {
  const text = 读字符串(value) || 'gain';
  return ITEM_ACTION_ALIASES[text] ?? '';
}

function 归一化触发类型(value: unknown): CourierDeliverySeed['triggerType'] | '' {
  const text = 读字符串(value);
  return (COURIER_TRIGGER_ALIASES[text] ?? text) as CourierDeliverySeed['triggerType'] | '';
}

function 归一化优先级(value: unknown): CourierDeliverySeed['priority'] | '' {
  const text = 读字符串(value);
  return (COURIER_PRIORITY_ALIASES[text] ?? text) as CourierDeliverySeed['priority'] | '';
}

function 归一化事实(raw: unknown): 变量事实 | null {
  if (!是对象(raw)) return null;
  const type = 归一化事实类型(raw.type || raw.类型);
  if (type === 'traveler_profile') {
    const abilityAdd = 字符串数组(raw.abilityAdd ?? raw.新增能力 ?? raw.能力新增);
    const knowledgeAdd = 字符串数组(raw.knowledgeAdd ?? raw.新增专长知识 ?? raw.专长知识新增);
    const fact = {
      type: 'traveler_profile' as const,
      identity: 读字符串(raw.identity || raw.身份) || undefined,
      appearance: 读字符串(raw.appearance || raw.外貌) || undefined,
      personality: 读字符串(raw.personality || raw.性格) || undefined,
      background: 读字符串(raw.background || raw.背景) || undefined,
      abilityAdd,
      knowledgeAdd,
      evidence: 读字符串(raw.evidence || raw.证据) || undefined,
    };
    if (!fact.identity && !fact.appearance && !fact.personality && !fact.background && !fact.abilityAdd && !fact.knowledgeAdd) {
      return null;
    }
    return fact;
  }
  if (type === 'time') {
    const mode = 读字符串(raw.mode || raw.模式);
    const normalizedMode = ({
      不变: 'no_change',
      无变化: 'no_change',
      推进: 'elapsed',
      耗时: 'elapsed',
      设定时间: 'set_time',
      同日设定: 'set_time',
      跨夜: 'overnight',
      次日: 'next_day',
      跨日: 'next_day',
    } as Record<string, string>)[mode] ?? mode;
    if (!['no_change', 'elapsed', 'set_time', 'overnight', 'next_day'].includes(normalizedMode)) return null;
    return {
      type: 'time',
      mode: normalizedMode as 'no_change' | 'elapsed' | 'set_time' | 'overnight' | 'next_day',
      minutes: 数字(raw.minutes ?? raw.分钟),
      targetTime: 读字符串(raw.targetTime || raw.目标时间 || raw.time || raw.时间) || undefined,
      evidence: 读字符串(raw.evidence || raw.证据) || undefined,
    };
  }
  if (type === 'location') {
    const location = 读字符串(raw.location || raw.地点);
    if (!location) return null;
    return { type: 'location', location, evidence: 读字符串(raw.evidence || raw.证据) || undefined };
  }
  if (type === 'weather') {
    const weather = 读字符串(raw.weather || raw.天气);
    if (!weather) return null;
    return { type: 'weather', weather, evidence: 读字符串(raw.evidence || raw.证据) || undefined };
  }
  if (type === 'npc') {
    const id = 读字符串(raw.id);
    const name = 读字符串(raw.name || raw.姓名 || raw.名称) || npcNameFromId(id);
    if (!name || isReservedNpcIdentityName(name)) return null;
    const tier = 读字符串(raw.tier || raw.阶位);
    const relation = 读字符串(raw.relation || raw.关系);
    return {
      type: 'npc',
      id: id || undefined,
      name,
      alias: 读字符串(raw.alias || raw.别名) || undefined,
      tier: tier === 'companion' || tier === 'extra' ? tier : undefined,
      affinityDelta: 数字(raw.affinityDelta ?? raw.好感变化),
      affinitySet: 数字(raw.affinitySet ?? raw.好感度),
      relation: NPC_RELATIONS.has(relation as NPC关系类型) ? relation : undefined,
      intimateRelationship: typeof raw.intimateRelationship === 'boolean'
        ? raw.intimateRelationship
        : typeof raw.亲密关系 === 'boolean'
          ? raw.亲密关系
          : undefined,
      following: typeof raw.following === 'boolean' ? raw.following : typeof raw.同行 === 'boolean' ? raw.同行 : undefined,
      gender: raw.gender === '男' || raw.gender === '女' || raw.gender === '其他'
        ? raw.gender
        : raw.性别 === '男' || raw.性别 === '女' || raw.性别 === '其他'
          ? raw.性别
          : undefined,
      appearance: 读字符串(raw.appearance || raw.外貌) || undefined,
      clothing: 读字符串(raw.clothing || raw.穿着) || undefined,
      speechStyle: 读字符串(raw.speechStyle || raw.说话方式) || undefined,
      personality: 读字符串(raw.personality || raw.性格) || undefined,
      intro: 读字符串(raw.intro || raw.介绍) || undefined,
      playerAddress: 读字符串(raw.playerAddress || raw.对玩家称呼) || undefined,
      memory: 读取记忆摘要(raw.memory ?? raw.同行记忆 ?? raw.记忆) || undefined,
      recentInteraction: 读字符串(raw.recentInteraction || raw.最近互动) || undefined,
      longTermImpression: 读字符串(raw.longTermImpression || raw.对玩家长期印象 || raw.长期印象) || undefined,
      relationshipStage: 读字符串(raw.relationshipStage || raw.当前关系阶段 || raw.关系阶段) || undefined,
      sharedExperiences: 字符串数组(raw.sharedExperiences ?? raw.共同经历),
      openItems: 字符串数组(raw.openItems ?? raw.未完成事项 ?? raw.未完成承诺),
      resolvedItems: 字符串数组(raw.resolvedItems ?? raw.已完成事项 ?? raw.已完成约定 ?? raw.已解决事项),
      unresolvedConflicts: 字符串数组(raw.unresolvedConflicts ?? raw.未解决冲突 ?? raw.冲突),
      mustRemember: 字符串数组(raw.mustRemember ?? raw.必须记得),
      doNotForget: 字符串数组(raw.doNotForget ?? raw.禁止遗忘),
      evidence: 读字符串(raw.evidence || raw.证据) || undefined,
    };
  }
  if (type === 'item') {
    const action = 归一化物品动作(raw.action || raw.动作);
    const category = 归一化物品分类(raw.category || raw.类别);
    const name = 读字符串(raw.name || raw.名称);
    if (!action || !name) return null;
    const quantity = 数字(raw.quantity);
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0) return null;
    const rarity = 数字(raw.rarity);
    if (action === 'gain') {
      if (!category || !ITEM_CATEGORY_SET.has(category)) return null;
      if (!ITEM_RARITIES.includes(rarity as ItemRarity)) return null;
    } else if (category && !ITEM_CATEGORY_SET.has(category)) {
      return null;
    }
    const artifactSlot = 读字符串(raw.artifactSlot);
    if (action === 'gain' && category === 'artifact' && !ARTIFACT_SLOTS.includes(artifactSlot as ArtifactSlot)) return null;
    if (action === 'gain' && category !== 'artifact' && artifactSlot) return null;
    const source = 读字符串(raw.source || raw.来源);
    const narrativeEffectsRaw = raw.narrativeEffects ?? raw.叙事效果;
    return {
      type: 'item',
      action,
      category: category || undefined,
      name,
      description: 读字符串(raw.description || raw.描述) || undefined,
      quantity,
      rarity: action === 'gain' ? rarity as ItemRarity : undefined,
      artifactSlot: action === 'gain' && category === 'artifact' ? artifactSlot as ArtifactSlot : undefined,
      stackable: typeof raw.stackable === 'boolean' ? raw.stackable : typeof raw.可堆叠 === 'boolean' ? raw.可堆叠 : undefined,
      source: ['剧情掉落', '任务奖励', '商店', '打造', '其它'].includes(source) ? source as never : undefined,
      sourceDescription: 读字符串(raw.sourceDescription || raw.来源描述) || undefined,
      narrativeEffects: Array.isArray(narrativeEffectsRaw)
        ? narrativeEffectsRaw.filter((item: unknown): item is string => typeof item === 'string')
        : undefined,
      evidence: 读字符串(raw.evidence || raw.证据) || undefined,
    };
  }
  if (type === 'world_event') {
    const text = 读字符串(raw.text || raw.内容 || raw.事件);
    if (!text) return null;
    return { type: 'world_event', text, evidence: 读字符串(raw.evidence || raw.证据) || undefined };
  }
  if (type === 'skill_used') {
    const talentName = 读字符串(raw.talentName || raw.技能名 || raw.名称 || raw.name);
    if (!talentName) return null;
    return { type: 'skill_used', talentName, evidence: 读字符串(raw.evidence || raw.证据) || undefined };
  }
  if (type === 'courier_seed') {
    const title = 读字符串(raw.title || raw.标题);
    const context = 读字符串(raw.context || raw.上下文 || raw.内容);
    if (!title || !context) return null;
    const targetType = 读字符串(raw.targetType || raw.目标类型);
    const triggerType = 归一化触发类型(raw.triggerType || raw.触发类型);
    const priority = 归一化优先级(raw.priority || raw.优先级);
    const relatedNpcIdsRaw = raw.relatedNpcIds ?? raw.关联NPCID;
    return {
      type: 'courier_seed',
      targetType: targetType === 'group' ? 'group' : 'private',
      targetId: 读字符串(raw.targetId || raw.目标ID) || undefined,
      targetName: 读字符串(raw.targetName || raw.目标名称) || undefined,
      title,
      context,
      triggerType: COURIER_TRIGGER_TYPES.has(triggerType as CourierDeliverySeed['triggerType']) ? triggerType as CourierDeliverySeed['triggerType'] : undefined,
      priority: COURIER_PRIORITIES.has(priority as CourierDeliverySeed['priority']) ? priority as CourierDeliverySeed['priority'] : undefined,
      relatedNpcIds: Array.isArray(relatedNpcIdsRaw)
        ? relatedNpcIdsRaw.filter((item: unknown): item is string => typeof item === 'string')
        : undefined,
      evidence: 读字符串(raw.evidence || raw.证据) || undefined,
    };
  }
  if (type === 'nsfw_archive') {
    const npcId = 读字符串(raw.npcId || raw.NPCID || raw.id);
    const npcName = 读字符串(raw.npcName || raw.name || raw.姓名 || raw.名称) || npcNameFromId(npcId);
    if (!npcName) return null;
    const femaleBody = 读取字符串对象(raw.femaleBodyArchive ?? raw.女性身体档案, ['胸部', '女性私处', '后庭', '体态', '体味']);
    const maleBody = 读取字符串对象(raw.maleBodyArchive ?? raw.男性身体档案, ['男性器', '后庭', '体态', '体味']);
    const virginityRaw = 读字符串(raw.virginityStatus ?? raw.是否处女);
    const virginityStatus = ({
      virgin: 'virgin', not_virgin: 'not_virgin', unknown: 'unknown', 是: 'virgin', 否: 'not_virgin', 未知: 'unknown',
    } as const)[virginityRaw as 'virgin' | 'not_virgin' | 'unknown' | '是' | '否' | '未知'];
    return {
      type: 'nsfw_archive',
      npcId: npcId || undefined,
      npcName,
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : typeof raw.启用 === 'boolean' ? raw.启用 : undefined,
      ageConfirm: 归一化年龄确认(raw.ageConfirm ?? raw.年龄确认),
      virginityStatus,
      firstSexualPartner: 读字符串(raw.firstSexualPartner ?? raw.首次性行为对象) || undefined,
      intimacyStage: 读字符串(raw.intimacyStage || raw.亲密阶段) || undefined,
      boundaries: 读字符串或数组(raw.boundaries ?? raw.边界) || undefined,
      preferences: 字符串数组(raw.preferences ?? raw.偏好),
      sensitivePoints: 字符串数组(raw.sensitivePoints ?? raw.敏感点),
      taboos: 字符串数组(raw.taboos ?? raw.禁忌),
      femaleBodyArchive: femaleBody,
      maleBodyArchive: maleBody,
      experiences: 字符串数组(raw.experiences ?? raw.经历),
      longTermFacts: 字符串数组(raw.longTermFacts ?? raw.长期事实),
      tags: 字符串数组(raw.tags ?? raw.标签),
      notes: 读字符串或数组(raw.notes ?? raw.备注) || undefined,
      evidence: 读字符串(raw.evidence || raw.证据) || undefined,
    };
  }
  return null;
}

export function parseVariableFacts(rawText: string): { facts: 变量事实[]; parseErrors: string[] } {
  const facts: 变量事实[] = [];
  const parseErrors: string[] = [];
  const blockMatch = rawText.match(/<变量事实>([\s\S]*?)<\/变量事实>/);
  if (!blockMatch) return { facts, parseErrors };

  const block = 清理事实块(blockMatch[1]);
  if (!block) return { facts, parseErrors };

  let parsed: unknown;
  try {
    parsed = parseJsonWithRepair(block, 'any');
  } catch (err) {
    parseErrors.push(`变量事实 JSON 无法解析：${err instanceof Error ? err.message : String(err)}`);
    return { facts, parseErrors };
  }

  const list = Array.isArray(parsed)
    ? parsed
    : 是对象(parsed) && Array.isArray(parsed.facts)
      ? parsed.facts
      : null;
  if (!list) {
    parseErrors.push('变量事实必须是数组，或形如 {"facts":[...]} 的对象');
    return { facts, parseErrors };
  }

  list.forEach((item, index) => {
    const fact = 归一化事实(item);
    if (fact) facts.push(fact);
    else parseErrors.push(`变量事实第 ${index + 1} 条无法识别或缺少必填字段`);
  });

  return { facts, parseErrors };
}

function 分钟序数(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

function 格式化分钟(total: number): string {
  const safe = ((Math.trunc(total) % 1440) + 1440) % 1440;
  return `${Math.floor(safe / 60).toString().padStart(2, '0')}:${(safe % 60).toString().padStart(2, '0')}`;
}

const CHINESE_HOUR_DIGITS: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6,
  七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12,
};

function 解析中文整数(value: string): number | null {
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (value === '几' || value === '数') return 3;
  if (value === '半') return 0.5;
  if (CHINESE_HOUR_DIGITS[value] !== undefined) return CHINESE_HOUR_DIGITS[value];
  const tenIndex = value.indexOf('十');
  if (tenIndex >= 0) {
    const tensText = value.slice(0, tenIndex);
    const onesText = value.slice(tenIndex + 1);
    const tens = tensText ? CHINESE_HOUR_DIGITS[tensText] : 1;
    const ones = onesText ? CHINESE_HOUR_DIGITS[onesText] : 0;
    if (tens !== undefined && ones !== undefined) return tens * 10 + ones;
  }
  return null;
}

interface NarrativeClockCandidate {
  index: number;
  end: number;
  targetTime: string;
}

function 读取正文钟点候选(body: string): NarrativeClockCandidate[] {
  const candidates: NarrativeClockCandidate[] = [];
  const numericPattern = /(?:现在|此时|钟楼(?:显示)?|时间(?:来到|到了|是)?)?\s*([01]?\d|2[0-3]):([0-5]\d)/gu;
  for (const match of body.matchAll(numericPattern)) {
    const index = match.index ?? 0;
    candidates.push({
      index,
      end: index + match[0].length,
      targetTime: `${match[1].padStart(2, '0')}:${match[2]}`,
    });
  }

  const chinesePattern = /(凌晨|清晨|早上|上午|中午|下午|傍晚|晚上|夜里)?\s*([零〇一二两三四五六七八九十]{1,3}|\d{1,2})\s*[点時时](半|[零〇一二两三四五六七八九十]{1,3}分?|\d{1,2}分?)?/gu;
  for (const match of body.matchAll(chinesePattern)) {
    let hour = /^\d+$/.test(match[2]) ? Number(match[2]) : 解析中文整数(match[2]);
    if (hour === null || !Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    const period = match[1] ?? '';
    if (/下午|傍晚|晚上|夜里/.test(period) && hour < 12) hour += 12;
    if (/凌晨/.test(period) && hour === 12) hour = 0;
    if (/中午/.test(period) && hour < 11) hour += 12;
    let minute = 0;
    if (match[3] === '半') minute = 30;
    else if (match[3]) {
      const rawMinute = match[3].replace('分', '');
      const parsedMinute = 解析中文整数(rawMinute);
      if (parsedMinute === null || !Number.isInteger(parsedMinute)) continue;
      minute = parsedMinute;
    }
    if (minute < 0 || minute > 59) continue;
    const index = match.index ?? 0;
    candidates.push({ index, end: index + match[0].length, targetTime: 格式化分钟(hour * 60 + minute) });
  }
  return candidates.sort((a, b) => a.index - b.index || a.end - b.end);
}

function 读取正文耗时候选(body: string): Array<{ index: number; end: number; minutes: number }> {
  const candidates: Array<{ index: number; end: number; minutes: number }> = [];
  const pattern = /(半|几|数|\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百]+)\s*(?:个)?\s*(小时|钟头|分钟)\s*(?:以后|之后|后|过去)/gu;
  for (const match of body.matchAll(pattern)) {
    const amount = 解析中文整数(match[1]);
    if (amount === null || amount <= 0) continue;
    const minutes = Math.round(amount * (match[2] === '分钟' ? 1 : 60));
    const index = match.index ?? 0;
    candidates.push({ index, end: index + match[0].length, minutes });
  }
  return candidates;
}

function 读取时间证据句(body: string, index: number, end: number): string {
  const prefix = body.slice(0, index);
  const sentenceStart = Math.max(prefix.lastIndexOf('。'), prefix.lastIndexOf('！'), prefix.lastIndexOf('？'), prefix.lastIndexOf('\n')) + 1;
  const suffix = body.slice(end);
  const nextStops = ['。', '！', '？', '\n']
    .map((token) => suffix.indexOf(token))
    .filter((value) => value >= 0);
  const sentenceEnd = nextStops.length ? end + Math.min(...nextStops) + 1 : end;
  return body.slice(sentenceStart, sentenceEnd).trim();
}

/** 从正文里提取明确钟点，作为模型漏报时间事实时的确定性兜底。 */
export function deriveNarrativeClockFact(
  body: string,
  currentTime: string,
): Extract<变量事实, { type: 'time' }> | null {
  const clocks = 读取正文钟点候选(body);
  const durations = 读取正文耗时候选(body);
  const finalClock = clocks.at(-1);
  const finalDuration = durations.at(-1);

  if (finalDuration && (!finalClock || finalDuration.index > finalClock.index)) {
    const evidence = 读取时间证据句(body, finalDuration.index, finalDuration.end);
    return { type: 'time', mode: 'elapsed', minutes: finalDuration.minutes, evidence };
  }

  if (finalClock) {
    const evidence = 读取时间证据句(body, finalClock.index, finalClock.end);
    const current = 分钟序数(currentTime);
    const target = 分钟序数(finalClock.targetTime);
    const explicitDayAdvance = 有明确跨日证据(evidence);
    const overnightClock = current !== null && target !== null && current >= 20 * 60 && target <= 8 * 60 && /凌晨|清晨|早上/.test(evidence);
    const mode = explicitDayAdvance || overnightClock ? 'next_day' : 'set_time';
    if (finalClock.targetTime === currentTime && mode === 'set_time') return null;
    return { type: 'time', mode, targetTime: finalClock.targetTime, evidence };
  }

  const explicitDayMatch = [...body.matchAll(/次日|第二天|翌日|隔天|跨日|跨夜|过夜|一夜(?:过去|过后|之后|后)|睡醒|醒来/gu)].at(-1);
  if (explicitDayMatch) {
    const index = explicitDayMatch.index ?? 0;
    const evidence = 读取时间证据句(body, index, index + explicitDayMatch[0].length);
    return { type: 'time', mode: 'next_day', targetTime: 推断跨日目标时间(evidence, currentTime), evidence };
  }

  return null;
}

/** 正文未给出明确时间时，优先沿用变量模型的时间事实；仍无结果则保证普通剧情至少前进 3 分钟。 */
export function deriveNarrativeTimeFact(
  body: string,
  currentTime: string,
  modelFact?: Extract<变量事实, { type: 'time' }>,
): Extract<变量事实, { type: 'time' }> | null {
  const explicit = deriveNarrativeClockFact(body, currentTime);
  const current = 分钟序数(currentTime);
  const isContradictorySameDayClock = (fact: Extract<变量事实, { type: 'time' }>): boolean => {
    if (fact.mode !== 'set_time' || 有跨日证据(fact.evidence)) return false;
    const target = 分钟序数(fact.targetTime);
    return current !== null && target !== null && target <= current;
  };
  if (explicit && !isContradictorySameDayClock(explicit)) return explicit;
  if (modelFact && modelFact.mode !== 'no_change' && !isContradictorySameDayClock(modelFact)) return modelFact;
  const evidence = body.replace(/\s+/g, ' ').trim().slice(0, 100);
  return evidence ? { type: 'time', mode: 'elapsed', minutes: 3, evidence } : null;
}

/** 正文明确写出离队时的确定性兜底，防止变量模型漏报后队伍状态仍滞留。 */
export function derivePartyPresenceFacts(
  body: string,
  records: readonly (Pick<NPC记录, 'id' | '姓名'> & Partial<Pick<NPC记录, '同行'>> & { travelingTogether?: boolean })[],
): Array<Extract<变量事实, { type: 'npc' }>> {
  const facts: Array<Extract<变量事实, { type: 'npc' }>> = [];
  for (const npc of records) {
    if (!(npc.同行 || npc.travelingTogether) || !npc.姓名.trim()) continue;
    const escaped = npc.姓名.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const departure = new RegExp(`${escaped}.{0,24}(?:告别.{0,12})?(?:离开(?:了)?队伍|离队|退出队伍|不再同行|结束同行)`, 'u');
    if (departure.test(body)) facts.push({ type: 'npc', id: npc.id, name: npc.姓名, following: false, evidence: body.match(departure)?.[0] });
  }
  return facts;
}

const INVENTORY_REMOVAL_VERBS = /(使用|用掉|耗掉|消耗|服用|喝下|吃下|吃掉|交给|递给|赠给|送给|交付|上交|归还|丢失|遗失|失去|损毁|毁坏)/u;

function classifyPlayerInventoryRemoval(sentence: string, itemName: string): Extract<变量事实, { type: 'item' }>['action'] | null {
  const itemIndex = sentence.indexOf(itemName);
  const verbMatch = sentence.match(INVENTORY_REMOVAL_VERBS);
  if (itemIndex < 0 || !verbMatch || verbMatch.index === undefined) return null;
  const playerIndexes = ['你', '旅行者', '玩家'].map((token) => sentence.indexOf(token)).filter((index) => index >= 0);
  const playerIndex = playerIndexes.length ? Math.min(...playerIndexes) : -1;
  if (playerIndex < 0 || playerIndex > Math.max(itemIndex, verbMatch.index)) return null;
  const actorSpan = sentence.slice(playerIndex, Math.max(itemIndex, verbMatch.index) + verbMatch[0].length);
  if (/(?:接过|收到|看见|发现|目睹).{0,20}(?:交给|递给|赠给|送给)/u.test(actorSpan)) return null;
  if (/(交给|递给|赠给|送给|交付|上交|归还)/u.test(verbMatch[0])) return 'give';
  if (/(丢失|遗失|失去|损毁|毁坏)/u.test(verbMatch[0])) return 'lose';
  return 'consume';
}

function parseNarrativeQuantity(text: string, itemName: string): number {
  const escapedName = itemName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`([一二两三四五六七八九十\\d]+)\\s*(?:个|枚|份|瓶|块|件|颗|串)?\\s*${escapedName}`, 'u'));
  if (!match) return 1;
  if (/^\d+$/.test(match[1])) return Math.max(1, Number(match[1]));
  const values: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  return values[match[1]] ?? 1;
}

/** 变量模型漏报时，只对正文中“物品名 + 明确扣除动词”做保守兜底。 */
export function deriveNarrativeInventoryRemovalFacts(
  body: string,
  items: readonly TeyvatItem[],
): Array<Extract<变量事实, { type: 'item' }>> {
  const sentences = body.split(/(?<=[。！？!?\n])/u).map((item) => item.trim()).filter(Boolean);
  const facts: Array<Extract<变量事实, { type: 'item' }>> = [];
  for (const item of items) {
    const evidence = sentences.find((sentence) => sentence.includes(item.name) && INVENTORY_REMOVAL_VERBS.test(sentence));
    if (!evidence || /(?:没有|并未|未曾|不曾|尚未).{0,8}(?:使用|消耗|服用|喝下|吃下|吃掉|交给|递给|赠给|送给|交付|上交|归还|丢失|遗失|失去|损毁|毁坏)/u.test(evidence)) continue;
    const action = classifyPlayerInventoryRemoval(evidence, item.name);
    if (!action) continue;
    facts.push({
      type: 'item',
      action,
      category: item.category,
      name: item.name,
      quantity: Math.min(item.quantity, parseNarrativeQuantity(evidence, item.name)),
      evidence,
    });
  }
  return facts;
}

function agreementSimilarity(left: string, right: string): number {
  const normalize = (value: string) => value
    .replace(/旅行者|玩家|终于|已经|成功|完成了?|结束了?|兑现了?|解决了?|取消了?|终止了?|一起|帮忙|帮助|和|与|复命/gu, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
  const a = new Set([...normalize(left)]);
  const b = new Set([...normalize(right)]);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  a.forEach((char) => { if (b.has(char)) intersection += 1; });
  return intersection < 3 ? 0 : intersection / Math.min(a.size, b.size);
}

/** 将正文中明确完成/取消的既有约定转换成 resolvedItems 事实。 */
export function deriveResolvedNpcLedgerFacts(
  body: string,
  records: ReadonlyArray<{
    id: string;
    姓名: string;
    relationshipLedger?: { unfinishedBusiness?: string[] };
    未完成事项?: string[];
  }>,
): Array<Extract<变量事实, { type: 'npc' }>> {
  const completion = /(完成|办完|做完|兑现|履行|解决|结清|交付|复命|取消|终止|不再继续)/u;
  const sentences = body.split(/(?<=[。！？!?\n])/u).map((item) => item.trim()).filter(Boolean);
  const facts: Array<Extract<变量事实, { type: 'npc' }>> = [];
  for (const npc of records) {
    const openItems = npc.relationshipLedger?.unfinishedBusiness ?? npc.未完成事项 ?? [];
    if (!openItems.length || !npc.姓名.trim()) continue;
    const relevant = sentences.filter((sentence) => sentence.includes(npc.姓名) && completion.test(sentence));
    if (!relevant.length) continue;
    const resolvedItems = openItems.filter((item) => relevant.some((sentence) => agreementSimilarity(item, sentence) >= 0.7));
    if (!resolvedItems.length) continue;
    const evidence = relevant.find((sentence) => resolvedItems.some((item) => agreementSimilarity(item, sentence) >= 0.7)) ?? relevant[0];
    facts.push({ type: 'npc', id: npc.id, name: npc.姓名, resolvedItems, recentInteraction: evidence, memory: evidence, evidence });
  }
  return facts;
}

function 有跨日证据(text: string | undefined): boolean {
  return Boolean(text && /次日|第二天|翌日|隔天|跨日|跨夜|过夜|一夜|睡醒|醒来|凌晨|清晨/.test(text));
}

function 有明确跨日证据(text: string | undefined): boolean {
  return Boolean(text && /次日|第二天|翌日|隔天|跨日|跨夜|过夜|一夜(?:过去|过后|之后|后)|睡醒|醒来/.test(text));
}

function 推断跨日目标时间(evidence: string | undefined, currentTime: string): string {
  const text = evidence ?? '';
  if (/凌晨/.test(text)) return '04:30';
  if (/清晨|拂晓|黎明/.test(text)) return '06:30';
  if (/早上|上午/.test(text)) return '08:00';
  if (/中午/.test(text)) return '12:00';
  if (/下午/.test(text)) return '14:00';
  if (/傍晚|黄昏/.test(text)) return '18:30';
  if (/晚上|夜里/.test(text)) return '21:00';
  return 分钟序数(currentTime) === null ? '07:00' : currentTime;
}

function 归一化耗时分钟(fact: Extract<变量事实, { type: 'time' }>): number {
  const raw = Math.max(1, Math.trunc(fact.minutes ?? 3));
  const hasLongDurationEvidence = Boolean(fact.evidence && /小时|钟头|半日|整日|整天|长途|赶路|等待|休整|睡眠|过夜/.test(fact.evidence));
  return Math.min(hasLongDurationEvidence ? 7 * 1440 : 30, raw);
}

function 计算耗时结果(currentMinutes: number, elapsedMinutes: number): { dayDelta: number; targetTime: string } {
  const total = currentMinutes + elapsedMinutes;
  return {
    dayDelta: Math.floor(total / 1440),
    targetTime: 格式化分钟(total),
  };
}

function npcIdFromName(name: string): string {
  const canonical = matchCanonical(name);
  const map: Record<string, string> = {
    空: 'aether', 荧: 'lumine', 派蒙: 'paimon', 安柏: 'amber', 凯亚: 'kaeya',
    丽莎: 'lisa', 琴: 'jean', 温迪: 'venti', 迪卢克: 'diluc', 芭芭拉: 'barbara',
  };
  const key = canonical ? map[canonical.name] ?? (readLegacyNpcKeyFromName(canonical.name) || canonical.name) : name;
  return buildTeyvatStableId('npc', [key]);
}

function findNpc(records: NPC记录[], id: string, name: string): NPC记录 | undefined {
  const targetCanonical = matchCanonical(name)?.name;
  return records.find((npc) =>
    npc.id === id ||
    npc.姓名 === name ||
    npc.别名 === name ||
    (Boolean(targetCanonical) && matchCanonical(npc.姓名)?.name === targetCanonical),
  );
}

function isCanonicalNpcPersonalityProtected(npc: NPC记录 | undefined, name: string): boolean {
  return Boolean(npc?.原著角色 || matchCanonical(npc?.姓名 ?? name) || matchCanonical(name));
}

function 数组已有文本(value: unknown, text: string): boolean {
  return Array.isArray(value) && value.some((item) => typeof item === 'string' && item.trim() === text.trim());
}

function mergeUniqueTexts(...groups: Array<string[] | undefined>): string[] | undefined {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const group of groups) {
    for (const item of group ?? []) {
      const text = item.trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      output.push(text);
    }
  }
  return output.length ? output : undefined;
}

function normalizeLedgerItemText(value: string): string {
  return value.toLowerCase().replace(/[\s，。！？、,.!?:：；;"'“”‘’（）()\[\]【】]/g, '');
}

function removeResolvedLedgerItems(current: readonly string[] | undefined, resolved: readonly string[] | undefined): string[] | undefined {
  if (!resolved?.length) return undefined;
  const targets = resolved.map(normalizeLedgerItemText).filter(Boolean);
  if (!targets.length) return undefined;
  return (current ?? []).filter((item) => {
    const normalized = normalizeLedgerItemText(item);
    return !targets.some((target) => normalized === target || (Math.min(normalized.length, target.length) >= 4 && (normalized.includes(target) || target.includes(normalized))));
  });
}

function mergePreferredText(current: unknown, incoming: unknown): string | undefined {
  const next = typeof incoming === 'string' ? incoming.trim() : '';
  if (next) return next;
  const existing = typeof current === 'string' ? current.trim() : '';
  return existing || undefined;
}

function buildNsfwArchiveUpdate(existing: NPC记录, fact: Extract<变量事实, { type: 'nsfw_archive' }>): Record<string, unknown> {
  const current = existing.NSFW档案 ?? {};
  const archive: Record<string, unknown> = {};
  // NSFW 年龄门禁已解除：年龄确认降级为纯展示信息，不再限制档案写入。
  // 落库改为字段级合并（existing 优先，fact 补充），不再强制塞入保守基线占位文案。
  archive.enabled = fact.enabled ?? current.enabled ?? true;
  archive.年龄确认 = fact.ageConfirm ?? current.年龄确认 ?? 'unknown';
  if (existing.性别 === '女' && archive.年龄确认 === 'adult') {
    archive.是否处女 = fact.virginityStatus === 'virgin' ? '是' : fact.virginityStatus === 'not_virgin' ? '否' : fact.virginityStatus === 'unknown' ? '未知' : current.是否处女;
    archive.首次性行为对象 = fact.firstSexualPartner ?? current.首次性行为对象;
  }
  archive.亲密阶段 = fact.intimacyStage ?? current.亲密阶段 ?? (existing.亲密关系 ? '已建立亲密关系（私密细节未记录）' : '未建立');
  // 边界/备注只在 fact 或 existing 有值时写入，不再写保守基线默认长文。
  if (fact.boundaries) archive.边界 = fact.boundaries;
  else if (current.边界) archive.边界 = current.边界;
  const longTermFacts = mergeUniqueTexts(current.长期事实, fact.longTermFacts);
  if (longTermFacts?.length) archive.长期事实 = longTermFacts;
  const tags = mergeUniqueTexts(current.标签, fact.tags);
  if (tags?.length) archive.标签 = tags;
  const experiences = mergeUniqueTexts(current.经历, fact.experiences);
  if (experiences?.length) archive.经历 = experiences;
  const currentFemale = current.女性身体档案 ?? {};
  const currentMale = current.男性身体档案 ?? {};
  const femaleIncoming = fact.femaleBodyArchive ?? {};
  const maleIncoming = fact.maleBodyArchive ?? {};
  if (Object.keys(femaleIncoming).length || Object.keys(currentFemale).length) {
    const femaleArchive = {
      胸部: mergePreferredText(currentFemale.胸部, femaleIncoming.胸部),
      女性私处: mergePreferredText(currentFemale.女性私处, femaleIncoming.女性私处),
      后庭: mergePreferredText(currentFemale.后庭, femaleIncoming.后庭),
      体态: mergePreferredText(currentFemale.体态, femaleIncoming.体态),
      体味: mergePreferredText(currentFemale.体味, femaleIncoming.体味),
    };
    if (pruneEmptyObject(femaleArchive)) archive.女性身体档案 = femaleArchive;
  }
  if (Object.keys(maleIncoming).length || Object.keys(currentMale).length) {
    const maleArchive = {
      男性器: mergePreferredText(currentMale.男性器, maleIncoming.男性器),
      后庭: mergePreferredText(currentMale.后庭, maleIncoming.后庭),
      体态: mergePreferredText(currentMale.体态, maleIncoming.体态),
      体味: mergePreferredText(currentMale.体味, maleIncoming.体味),
    };
    if (pruneEmptyObject(maleArchive)) archive.男性身体档案 = maleArchive;
  }
  if (fact.notes) archive.备注 = fact.notes;
  else if (current.备注) archive.备注 = current.备注;
  return archive;
}

function pruneEmptyObject<T extends Record<string, unknown>>(obj: T): T | undefined {
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (typeof value === 'string' && !value.trim()) delete obj[key];
  }
  return Object.keys(obj).length ? obj : undefined;
}

const NON_INVENTORY_INFORMATION_RE = /(坐标|座标|位置|地点|方位|路线|路径|权限$|访问权限|通行权限|许可$|口令|密码|暗号|线索|情报|消息|讯息|资料|记录|名单|名单信息|地址|坐标点)/;
const PHYSICAL_INFORMATION_CARRIER_RE = /(卡|钥匙|钥|芯片|终端|地图|纸条|便签|信件|文书|档案袋|票|通行证|徽章|铭牌|印章|玉牌|玉兆|令牌|样本|碎片|装置|模块|硬盘|数据盘|存储器)/;

function 是非背包信息物品(input: {
  name: string;
  description?: string;
  evidence?: string;
  sourceDescription?: string;
}): boolean {
  const name = input.name.trim();
  const haystack = [name, input.description, input.evidence, input.sourceDescription].filter(Boolean).join(' ');
  if (!NON_INVENTORY_INFORMATION_RE.test(haystack)) return false;
  return !PHYSICAL_INFORMATION_CARRIER_RE.test(name);
}

function resolveCourierTargetId(fact: Extract<变量事实, { type: 'courier_seed' }>, npcs: NPC记录[]): string | null {
  if (fact.targetId?.trim()) return fact.targetId.trim();
  if (fact.targetName?.trim()) {
    const id = npcIdFromName(fact.targetName.trim());
    const existing = findNpc(npcs, id, fact.targetName.trim());
    return existing?.id ?? id;
  }
  const related = fact.relatedNpcIds?.find((id) => id.trim());
  if (related?.trim()) return related.trim();
  // 兜底:从 title/context/evidence 文本里匹配已知 NPC 姓名。
  // AI 经常只写 context 不写 targetName，需从事件文本解析明确投递对象。
  // 优先匹配已登记的 NPC，其次匹配提瓦特经典角色（安柏/凯亚等）。
  const haystack = `${fact.title ?? ''}\n${fact.context ?? ''}\n${fact.evidence ?? ''}`;
  for (const npc of npcs) {
    const name = npc.姓名?.trim();
    if (name && name.length >= 2 && haystack.includes(name)) {
      return npc.id;
    }
    const alias = npc.别名?.trim();
    if (alias && alias.length >= 2 && haystack.includes(alias)) {
      return npc.id;
    }
  }
  // 经典角色兜底：即使 NPC 列表里没有，也允许生成种子，后续信使入口会创建联系人。
  const canonicalNames = ['空', '荧', '派蒙', '安柏', '凯亚', '丽莎', '琴', '温迪', '迪卢克', '芭芭拉'];
  for (const name of canonicalNames) {
    if (haystack.includes(name)) {
      return npcIdFromName(name);
    }
  }
  return null;
}

function normalizeCourierSeedComparableText(text: string): string {
  return text
    .replace(/\s+/g, '')
    .replace(/[，。！？!?；;、,.…~～“”"'\[\]（）()《》<>]/g, '')
    .trim();
}

function isCourierSeedTextSimilar(a: string, b: string): boolean {
  const left = normalizeCourierSeedComparableText(a);
  const right = normalizeCourierSeedComparableText(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length >= 12 && right.includes(left)) return true;
  if (right.length >= 12 && left.includes(right)) return true;
  const shared = [...new Set(left)].filter((char) => right.includes(char)).length;
  return shared / Math.max(1, Math.min(left.length, right.length)) >= 0.82;
}

function hasRecentSimilarCourierSeed(courier: CourierSystem | undefined, input: {
  turn: number;
  targetId: string;
  relatedNpcIds: string[];
  title: string;
  context: string;
  windowTurns?: number;
}): boolean {
  if (!courier?.deliverySeeds?.length) return false;
  const windowTurns = Math.max(3, input.windowTurns ?? 12);
  const ids = new Set([input.targetId, ...input.relatedNpcIds].filter(Boolean));
  const currentText = `${input.title}\n${input.context}`;
  return courier.deliverySeeds.some((seed) => {
    if (input.turn - (Number(seed.turn) || 0) > windowTurns) return false;
    const seedIds = new Set([seed.targetId, ...seed.relatedNpcIds].filter(Boolean));
    const sameTarget = [...ids].some((id) => seedIds.has(id) || seedIds.has(`npc_${id}`) || id === seed.targetId);
    if (!sameTarget) return false;
    return isCourierSeedTextSimilar(currentText, `${seed.title}\n${seed.context}`);
  });
}

function hasRecentNonUrgentCourierSeed(courier: CourierSystem | undefined, turn: number, windowTurns = 3): boolean {
  if (!courier?.deliverySeeds?.length) return false;
  const safeWindow = Math.max(3, Math.trunc(windowTurns) || 3);
  return courier.deliverySeeds.some((seed) => {
    if (seed.priority === 'urgent' || seed.priority === 'high') return false;
    return turn - (Number(seed.turn) || 0) < safeWindow;
  });
}

export function factsToVariableCommands(
  facts: 变量事实[],
  state: VariableState,
  turn: number,
  options: {
    courierSeedsEnabled?: boolean;
    maxCourierSeedsPerTurn?: number;
  } = {},
): { commands: 变量命令[]; notes: string[]; warnings: string[] } {
  const commands: 变量命令[] = [];
  const notes: string[] = [];
  const warnings: string[] = [];
  const world = state.世界 as 世界状态;
  const npcs = (state.NPC as NPC记录[]) ?? [];
  const courier = state.手机 as CourierSystem | undefined;
  const inventoryItems = ((state.背包 as TeyvatInventory | undefined)?.items ?? []).map((item) => ({ ...item }));
  const courierSeedsEnabled = options.courierSeedsEnabled !== false;
  const maxCourierSeedsPerTurn = Math.max(0, Math.trunc(options.maxCourierSeedsPerTurn ?? 2));
  let courierSeedsWritten = 0;

  const push = (command: 变量命令) => commands.push(command);

  for (const fact of facts) {
    if (fact.type === 'traveler_profile') {
      notes.push('已静默忽略 traveler_profile：旅人核心档案由玩家手写维护，变量系统不再修改身份、外貌、性格、背景、能力或专长知识。');
      continue;
    }

    if (fact.type === 'time') {
      const current = 分钟序数(world?.当前时间);
      if (fact.mode === 'no_change') continue;
      if (fact.mode === 'elapsed') {
        const delta = 归一化耗时分钟(fact);
        if (current !== null) {
          const elapsed = 计算耗时结果(current, delta);
          if (elapsed.dayDelta > 0) {
            const nextDate = 推进旅行日期(world?.当前日期 ?? '', elapsed.dayDelta);
            const aligned = 对齐世界日期与天数((world?.旅程天数 ?? 1) + elapsed.dayDelta, nextDate);
            push({ action: 'set', key: '世界.旅程天数', value: aligned.旅程天数 });
            push({ action: 'set', key: '世界.当前日期', value: aligned.当前日期 });
          }
          push({ action: 'set', key: '世界.当前时间', value: elapsed.targetTime });
        } else warnings.push('time(elapsed) 已忽略：当前时间不是 HH:mm，无法计算推进。');
        continue;
      }
      if (fact.mode === 'set_time') {
        const next = 分钟序数(fact.targetTime);
        if (next === null) {
          warnings.push(`time(set_time) 已忽略：无法识别目标时间 ${fact.targetTime ?? '空'}。`);
          continue;
        }
        const explicitlyNextDay = 有明确跨日证据(fact.evidence);
        if (explicitlyNextDay || (next !== null && current !== null && next < current && 有跨日证据(fact.evidence))) {
          const nextDate = 推进旅行日期(world?.当前日期 ?? '');
          const aligned = 对齐世界日期与天数((world?.旅程天数 ?? 1) + 1, nextDate);
          push({ action: 'set', key: '世界.旅程天数', value: aligned.旅程天数 });
          push({ action: 'set', key: '世界.当前日期', value: aligned.当前日期 });
          push({ action: 'set', key: '世界.当前时间', value: fact.targetTime });
          continue;
        }
        if (current !== null && next < current) {
          warnings.push(`time(set_time) 已忽略疑似同日时间回退：当前 ${world?.当前时间 ?? '未知'}，事实目标 ${fact.targetTime}；若剧情跨日，请输出 mode=next_day/overnight 并写明证据。`);
          continue;
        }
        push({ action: 'set', key: '世界.当前时间', value: fact.targetTime });
        continue;
      }
      if (fact.mode === 'overnight' || fact.mode === 'next_day') {
        const nextDate = 推进旅行日期(world?.当前日期 ?? '');
        const aligned = 对齐世界日期与天数((world?.旅程天数 ?? 1) + 1, nextDate);
        push({ action: 'set', key: '世界.旅程天数', value: aligned.旅程天数 });
        push({ action: 'set', key: '世界.当前日期', value: aligned.当前日期 });
        push({ action: 'set', key: '世界.当前时间', value: fact.targetTime || 推断跨日目标时间(fact.evidence, world?.当前时间 ?? '') });
        continue;
      }
    }

    if (fact.type === 'location') {
      push({ action: 'set', key: '世界.当前地点', value: fact.location });
      continue;
    }

    if (fact.type === 'weather') {
      // 天气中文名 → ID
      const def = 天气列表.find((w) => w.name === fact.weather || w.id === fact.weather);
      if (def) {
        push({ action: 'set', key: '世界.当前天气', value: def.id });
      } else {
        warnings.push(`weather: 无法识别的天气名「${fact.weather}」，已忽略。`);
      }
      continue;
    }

    if (fact.type === 'npc') {
      const id = fact.id?.trim() || npcIdFromName(fact.name);
      const existing = findNpc(npcs, id, fact.name);
      if (!existing) {
        const canonical = matchCanonical(fact.name);
        const initialAffinity = 限制NPC好感度(fact.affinitySet ?? fact.affinityDelta ?? 0);
        push({
          action: 'push',
          key: 'NPC',
          value: {
            id,
            姓名: canonical?.name ?? fact.name,
            别名: fact.alias,
            阶位: inferNpcTier(fact, canonical),
            好感度: initialAffinity,
            关系: 获取NPC兼容关系(initialAffinity),
            亲密关系: fact.intimateRelationship ?? false,
            同行: fact.following ?? false,
            初见回合: turn,
            最近回合: turn,
            对玩家称呼: fact.playerAddress,
            性别: fact.gender ?? (canonical?.gender as import('@/models/npc').NPC性别 | undefined),
            外貌: fact.appearance ?? canonical?.appearance,
            穿着: fact.clothing,
            说话方式: fact.speechStyle,
            性格: canonical?.personality ?? fact.personality,
            介绍: fact.intro ?? (canonical ? `${canonical.name}是当前剧情中出现的原著角色。` : ''),
            同行记忆: fact.memory ? [{
              id: `npc_mem_${id}_${turn}_${Math.random().toString(36).slice(2, 6)}`,
              回合: turn,
              摘要: fact.memory,
              来源: '变量',
              关联NPCID: [id],
            }] : [],
            最近互动: fact.recentInteraction ?? fact.memory,
            对玩家长期印象: fact.longTermImpression,
            当前关系阶段: 获取NPC关系阶段(initialAffinity),
            共同经历: fact.sharedExperiences,
            未完成事项: fact.openItems,
            未解决冲突: fact.unresolvedConflicts,
            必须记得: fact.mustRemember,
            禁止遗忘: fact.doNotForget,
            备注: fact.evidence ? [fact.evidence] : [],
            原著角色: Boolean(canonical),
          },
        });
      } else {
        const key = `NPC[id=${existing.id}]`;
        push({ action: 'set', key: `${key}.最近回合`, value: turn });
        if (typeof fact.affinitySet === 'number') push({ action: 'set', key: `${key}.好感度`, value: fact.affinitySet });
        else if (typeof fact.affinityDelta === 'number') push({ action: 'add', key: `${key}.好感度`, value: fact.affinityDelta });
        if (typeof fact.intimateRelationship === 'boolean') push({ action: 'set', key: `${key}.亲密关系`, value: fact.intimateRelationship });
        if (typeof fact.following === 'boolean') push({ action: 'set', key: `${key}.同行`, value: fact.following });
        if (fact.gender) push({ action: 'set', key: `${key}.性别`, value: fact.gender });
        if (fact.appearance) push({ action: 'set', key: `${key}.外貌`, value: fact.appearance });
        if (fact.clothing) push({ action: 'set', key: `${key}.穿着`, value: fact.clothing });
        if (fact.speechStyle) push({ action: 'set', key: `${key}.说话方式`, value: fact.speechStyle });
        if (fact.personality) {
          if (isCanonicalNpcPersonalityProtected(existing, fact.name)) {
            notes.push(`已忽略 ${existing.姓名} 的 personality 更新：原著角色长期性格由图鉴人物主体资料校准，变量系统只记录本回合经历和关系变化。`);
          } else {
            push({ action: 'set', key: `${key}.性格`, value: fact.personality });
          }
        }
        if (fact.intro) push({ action: 'set', key: `${key}.介绍`, value: fact.intro });
        if (fact.playerAddress) push({ action: 'set', key: `${key}.对玩家称呼`, value: fact.playerAddress });
        if (fact.recentInteraction || fact.memory) push({ action: 'set', key: `${key}.最近互动`, value: fact.recentInteraction ?? fact.memory });
        if (fact.longTermImpression) push({ action: 'set', key: `${key}.对玩家长期印象`, value: fact.longTermImpression });
        pushNpcLedgerListCommands(push, key, '共同经历', fact.sharedExperiences, existing.共同经历);
        pushNpcLedgerListCommands(push, key, '未完成事项', fact.openItems, existing.未完成事项);
        const remainingOpenItems = removeResolvedLedgerItems(existing.未完成事项, fact.resolvedItems);
        if (remainingOpenItems) push({ action: 'set', key: `${key}.未完成事项`, value: remainingOpenItems });
        pushNpcLedgerListCommands(push, key, '未解决冲突', fact.unresolvedConflicts, existing.未解决冲突);
        pushNpcLedgerListCommands(push, key, '必须记得', fact.mustRemember, existing.必须记得);
        pushNpcLedgerListCommands(push, key, '禁止遗忘', fact.doNotForget, existing.禁止遗忘);
        if (fact.memory) push({
          action: 'push',
          key: `${key}.同行记忆`,
          value: {
            id: `npc_mem_${existing.id}_${turn}_${Math.random().toString(36).slice(2, 6)}`,
            回合: turn,
            摘要: fact.memory,
            来源: '变量',
            关联NPCID: [existing.id],
          },
        });
      }
      continue;
    }

    if (fact.type === 'nsfw_archive') {
      const id = fact.npcId?.trim() || npcIdFromName(fact.npcName);
      const existing = findNpc(npcs, id, fact.npcName);
      if (!existing) {
        warnings.push(`nsfw_archive 已忽略：找不到 NPC ${fact.npcName}，NSFW 档案只更新已入档 NPC。`);
        continue;
      }
      const blockedReason = getNsfwArchiveBlockReason(existing, fact.npcName);
      if (blockedReason) {
        warnings.push(`nsfw_archive 已忽略：${blockedReason}。`);
        continue;
      }
      const key = `NPC[id=${existing.id}].NSFW档案`;
      const archive = buildNsfwArchiveUpdate(existing, fact);
      if (fact.ageConfirm) archive.年龄确认 = fact.ageConfirm;
      if (fact.intimacyStage) archive.亲密阶段 = fact.intimacyStage;
      if (fact.boundaries) archive.边界 = fact.boundaries;
      if (fact.preferences?.length) archive.偏好 = fact.preferences;
      if (fact.sensitivePoints?.length) archive.敏感点 = fact.sensitivePoints;
      if (fact.taboos?.length) archive.禁忌 = fact.taboos;
      if (fact.femaleBodyArchive && Object.keys(fact.femaleBodyArchive).length) archive.女性身体档案 = fact.femaleBodyArchive;
      if (fact.maleBodyArchive && Object.keys(fact.maleBodyArchive).length) archive.男性身体档案 = fact.maleBodyArchive;
      if (fact.experiences?.length) archive.经历 = fact.experiences;
      if (fact.longTermFacts?.length) archive.长期事实 = fact.longTermFacts;
      if (fact.tags?.length) archive.标签 = fact.tags;
      if (fact.notes) archive.备注 = fact.notes;
      push({ action: 'set', key, value: archive });
      continue;
    }

    if (fact.type === 'item') {
      if (fact.action !== 'gain') {
        const existing = inventoryItems.find((item) => item.name.trim() === fact.name.trim() && (!fact.category || item.category === fact.category));
        if (!existing) {
          warnings.push(`item(${fact.action}) 已忽略：背包中找不到「${fact.name}」。`);
          continue;
        }
        if (existing.quantity < fact.quantity) {
          warnings.push(`item(${fact.action}) 已忽略：「${fact.name}」仅有 ${existing.quantity}，不能扣除 ${fact.quantity}。`);
          continue;
        }
        push({ action: 'sub', key: `背包.items[id=${existing.id}].quantity`, value: fact.quantity });
        existing.quantity -= fact.quantity;
        continue;
      }
      if (!fact.category || !fact.rarity) {
        warnings.push(`item(gain) 已忽略：${fact.name} 缺少 category 或 rarity。`);
        continue;
      }
      if (是非背包信息物品({
        name: fact.name,
        description: fact.description,
        evidence: fact.evidence,
        sourceDescription: fact.sourceDescription,
      })) {
        warnings.push(`item 已忽略：${fact.name} 是坐标/权限/线索/情报等信息，不是可放入背包的实体物品；请用 world_event、npc.memory 或剧情承接。`);
        continue;
      }
      push({
        action: 'push',
        key: '背包.items',
        value: {
          category: fact.category,
          name: fact.name,
          description: fact.description || fact.evidence || `${fact.name}。`,
          quantity: fact.quantity,
          rarity: fact.rarity,
          artifactSlot: fact.artifactSlot,
          stackable: fact.stackable,
          source: fact.source ?? '剧情掉落',
          sourceDetail: fact.sourceDescription ?? fact.evidence,
          narrativeEffects: fact.narrativeEffects,
          obtainedAt: `${world?.当前日期 || ''} ${world?.当前时间 || ''}`.trim(),
        },
      });
      continue;
    }

    if (fact.type === 'world_event') {
      push({ action: 'push', key: '世界.全局事件', value: fact.text });
      continue;
    }

    if (fact.type === 'courier_seed') {
      if (!courierSeedsEnabled || maxCourierSeedsPerTurn <= 0) {
        warnings.push(`courier seed 已忽略：信使主动投递已关闭或每回合上限为 0（${fact.title}）。`);
        continue;
      }
      if (courierSeedsWritten >= maxCourierSeedsPerTurn) {
        warnings.push(`courier seed 已忽略：本回合投递种子已达到上限 ${maxCourierSeedsPerTurn}（${fact.title}）。`);
        continue;
      }
      const targetId = resolveCourierTargetId(fact, npcs);
      if (!targetId) {
        warnings.push(`courier seed 已忽略：缺少 targetId/targetName/relatedNpcIds，无法确定来信目标（${fact.title}）。`);
        continue;
      }
      const priority = fact.priority ?? 'normal';
      if ((priority === 'low' || priority === 'normal') && hasRecentNonUrgentCourierSeed(courier, turn)) {
        warnings.push(`courier seed 已忽略：近期已有普通主动来信，低频/普通来信进入全局冷却（${fact.title}）。`);
        continue;
      }
      const relatedNpcIds = Array.from(new Set([
        ...(fact.relatedNpcIds ?? []),
        targetId.startsWith('npc_') || targetId.startsWith('npc-') ? targetId : '',
      ].map((id) => id.trim()).filter(Boolean)));
      if (hasRecentSimilarCourierSeed(courier, {
        turn,
        targetId,
        relatedNpcIds,
        title: fact.title,
        context: fact.context,
      })) {
        warnings.push(`courier seed 已忽略：近期已有同对象同事件的主动来信，避免重复刷屏（${fact.title}）。`);
        continue;
      }
      push({
        action: 'push',
        key: '信使.deliverySeeds',
        value: {
          id: `courier_seed_${turn}_${Math.random().toString(36).slice(2, 8)}`,
          turn,
          source: 'main_story',
          triggerType: fact.triggerType ?? 'custom',
          priority,
          targetType: fact.targetType ?? 'private',
          targetId,
          title: fact.title,
          context: fact.context,
          relatedNpcIds,
          expiresAfterTurns: 6,
          status: 'pending',
        },
      });
      courierSeedsWritten += 1;
    }
  }

  return { commands, notes, warnings };
}

function stableDomainId(prefix: string, parts: readonly string[]): string {
  return buildTeyvatStableId(prefix, parts);
}

/** 唯一正式 live translator：变量事实 -> native TeyvatDomainCommand，不经过旧 key-path 执行器。 */
export function factsToTeyvatDomainCommands(
  facts: 变量事实[],
  state: TeyvatGameState,
  turn: number,
  options: { courierSeedsEnabled?: boolean; maxCourierSeedsPerTurn?: number } = {},
): { commands: TeyvatDomainCommand[]; notes: string[]; warnings: string[] } {
  const commands: TeyvatDomainCommand[] = [];
  const notes: string[] = [];
  const warnings: string[] = [];
  const world = state.世界;
  const courierSeedsEnabled = options.courierSeedsEnabled !== false;
  const maxCourierSeedsPerTurn = Math.max(0, Math.trunc(options.maxCourierSeedsPerTurn ?? 2));
  let courierSeedsWritten = 0;
  let dailyPartyRewardIssued = false;
  const projectedInventory = (state.背包?.items ?? []).map((item) => ({ ...item }));
  const push = (command: Omit<TeyvatDomainCommand, 'evidence'>, evidence?: string) => commands.push({
    ...command,
    evidence: evidence?.trim() ?? '',
  });
  const rewardCurrentPartyForNewDay = (evidence?: string, dayCount = 1) => {
    if (dailyPartyRewardIssued) return;
    dailyPartyRewardIssued = true;
    for (const npc of state.NPC.filter((entry) => entry.travelingTogether)) {
      push({ action: 'add', root: 'NPC', path: `${buildTeyvatIdSelector(npc.id)}.affinity`, value: 5 * Math.max(1, dayCount) }, evidence || '每日同行固定好感度');
    }
  };

  for (const fact of facts) {
    if (fact.type === 'traveler_profile') {
      notes.push('已忽略 traveler_profile：旅行者核心档案由玩家手写维护。');
      continue;
    }
    if (fact.type === 'location') {
      push({ action: 'set', root: '世界', path: '当前地点', value: fact.location }, fact.evidence);
      continue;
    }
    if (fact.type === 'weather') {
      const definition = 天气列表.find((item) => item.name === fact.weather || item.id === fact.weather);
      if (definition) push({ action: 'set', root: '世界', path: '当前天气', value: definition.id }, fact.evidence);
      else warnings.push(`weather: 无法识别的天气名「${fact.weather}」，已忽略。`);
      continue;
    }
    if (fact.type === 'time') {
      if (fact.mode === 'no_change') continue;
      const current = 分钟序数(world.当前时间);
      if (fact.mode === 'elapsed') {
        if (current === null) warnings.push('time(elapsed) 已忽略：当前时间不是 HH:mm。');
        else {
          const elapsed = 计算耗时结果(current, 归一化耗时分钟(fact));
          if (elapsed.dayDelta > 0) {
            push({ action: 'add', root: '世界', path: '旅程天数', value: elapsed.dayDelta }, fact.evidence);
            push({ action: 'set', root: '世界', path: '当前日期', value: 推进旅行日期(world.当前日期, elapsed.dayDelta) }, fact.evidence);
            rewardCurrentPartyForNewDay(fact.evidence, elapsed.dayDelta);
          }
          push({ action: 'set', root: '世界', path: '当前时间', value: elapsed.targetTime }, fact.evidence);
        }
        continue;
      }
      if (fact.mode === 'set_time') {
        const target = 分钟序数(fact.targetTime);
        if (target === null) warnings.push(`time(set_time) 已忽略：无法识别目标时间 ${fact.targetTime ?? '空'}。`);
        else if (current !== null && target < current && !有跨日证据(fact.evidence)) warnings.push('time(set_time) 已忽略疑似同日时间回退。');
        else {
          if (有明确跨日证据(fact.evidence) || (current !== null && target < current)) {
            push({ action: 'add', root: '世界', path: '旅程天数', value: 1 }, fact.evidence);
            push({ action: 'set', root: '世界', path: '当前日期', value: 推进旅行日期(world.当前日期) }, fact.evidence);
            rewardCurrentPartyForNewDay(fact.evidence);
          }
          push({ action: 'set', root: '世界', path: '当前时间', value: fact.targetTime }, fact.evidence);
        }
        continue;
      }
      push({ action: 'add', root: '世界', path: '旅程天数', value: 1 }, fact.evidence);
      push({ action: 'set', root: '世界', path: '当前日期', value: 推进旅行日期(world.当前日期) }, fact.evidence);
      rewardCurrentPartyForNewDay(fact.evidence);
      push({ action: 'set', root: '世界', path: '当前时间', value: fact.targetTime || 推断跨日目标时间(fact.evidence, world.当前时间) }, fact.evidence);
      continue;
    }
    if (fact.type === 'world_event') {
      push({ action: 'push', root: '世界', path: '世界事件', value: fact.text }, fact.evidence);
      continue;
    }
    if (fact.type === 'item') {
      if (fact.action !== 'gain') {
        const existingIndex = projectedInventory.findIndex((item) => item.name.trim() === fact.name.trim() && (!fact.category || item.category === fact.category));
        if (existingIndex < 0) {
          warnings.push(`item(${fact.action}) 已忽略：背包中找不到「${fact.name}」。`);
          continue;
        }
        const existing = projectedInventory[existingIndex];
        if (existing.quantity < fact.quantity) {
          warnings.push(`item(${fact.action}) 已忽略：「${fact.name}」仅有 ${existing.quantity}，不能扣除 ${fact.quantity}。`);
          continue;
        }
        push({ action: 'sub', root: '背包', path: `items${buildTeyvatIdSelector(existing.id)}.quantity`, value: fact.quantity }, fact.evidence);
        if (existing.quantity === fact.quantity) projectedInventory.splice(existingIndex, 1);
        else projectedInventory[existingIndex] = { ...existing, quantity: existing.quantity - fact.quantity };
        continue;
      }
      if (!fact.category || !fact.rarity) {
        warnings.push(`item(gain) 已忽略：${fact.name} 缺少 category 或 rarity。`);
        continue;
      }
      if (是非背包信息物品({ name: fact.name, description: fact.description, evidence: fact.evidence, sourceDescription: fact.sourceDescription })) {
        warnings.push(`item 已忽略：${fact.name} 不是可放入背包的实体物品。`);
        continue;
      }
      const id = stableDomainId('item', [fact.category, fact.name]);
      const discarded = new Set(state.背包.discardedItemIds ?? []);
      const explicitlyReacquired = /(重新获得|再次获得|重新拾取|捡回|买回|重新购得|重新取得)/.test(fact.evidence ?? '')
        && !/(没有|并未|未能|不曾|尚未).{0,4}(重新获得|再次获得|重新拾取|捡回|买回|重新购得|重新取得)/.test(fact.evidence ?? '');
      if ((discarded.has(id) || discarded.has(`name:${fact.name.trim()}`)) && !explicitlyReacquired) {
        warnings.push(`item 已忽略：${fact.name} 已由玩家主动丢弃，正文没有明确的重新获得证据。`);
        continue;
      }
      const existingIndex = projectedInventory.findIndex((item) => item.id === id && item.stackable !== false && fact.stackable !== false);
      if (existingIndex >= 0) {
        push({ action: 'add', root: '背包', path: `items${buildTeyvatIdSelector(id)}.quantity`, value: fact.quantity }, fact.evidence);
        projectedInventory[existingIndex] = { ...projectedInventory[existingIndex], quantity: projectedInventory[existingIndex].quantity + fact.quantity };
        continue;
      }
      const nextItem = {
        id,
        category: fact.category,
        name: fact.name,
        description: fact.description || fact.evidence || `${fact.name}。`,
        quantity: fact.quantity,
        rarity: fact.rarity,
        artifactSlot: fact.artifactSlot,
        stackable: fact.stackable,
        source: fact.source ?? '剧情掉落',
        sourceDetail: fact.sourceDescription ?? fact.evidence,
        narrativeEffects: fact.narrativeEffects,
        obtainedAtTurn: turn,
        obtainedAt: `${world.当前日期} ${world.当前时间}`.trim(),
      };
      push({ action: 'push', root: '背包', path: 'items', value: nextItem }, fact.evidence);
      projectedInventory.push(nextItem);
      continue;
    }
    if (fact.type === 'npc') {
      const requestedId = fact.id?.trim();
      const id = requestedId && isTeyvatStableId(requestedId) ? requestedId : npcIdFromName(fact.name);
      const existing = state.NPC.find((entry) => entry.id === id || entry.姓名 === fact.name || entry.aliases.includes(fact.name));
      if (!existing) {
        const canonical = matchCanonical(fact.name);
        const affinity = 限制NPC好感度(fact.affinitySet ?? fact.affinityDelta ?? 0);
        push({ action: 'push', root: 'NPC', path: 'records', value: {
          id, 姓名: canonical?.name ?? fact.name, 地区: '', 身份: fact.intro ?? '', 天赋: [], 说明: fact.intro ?? '',
          aliases: fact.alias ? [fact.alias] : [], roleTier: inferNpcTier(fact, canonical), affinity,
          relationship: 获取NPC兼容关系(affinity), intimate: fact.intimateRelationship ?? false,
          travelingTogether: fact.following ?? false, firstSeenTurn: turn, lastSeenTurn: turn,
          gender: fact.gender ?? canonical?.gender ?? '', playerAddress: fact.playerAddress ?? '',
          appearance: fact.appearance ?? canonical?.appearance ?? '', clothing: fact.clothing ?? '', speechStyle: fact.speechStyle ?? '',
          personality: canonical?.personality ?? fact.personality ?? '', equipmentSummary: '',
          sharedMemories: fact.memory ? [{ id: stableDomainId(`${id}:memory`, [String(turn), fact.memory]), turn, summary: fact.memory, source: 'variable', relatedNpcIds: [id] }] : [],
          relationshipLedger: { recentInteraction: fact.recentInteraction ?? fact.memory ?? '', longTermImpression: fact.longTermImpression ?? '', currentStage: 获取NPC关系阶段(affinity), sharedExperiences: fact.sharedExperiences ?? [], unfinishedBusiness: fact.openItems ?? [], unresolvedConflicts: fact.unresolvedConflicts ?? [], mustRemember: fact.mustRemember ?? [], protectedFacts: fact.doNotForget ?? [], summaries: [] },
          notes: fact.evidence ? [fact.evidence] : [], playerCorrections: [], canonical: Boolean(canonical), avatar: '', visualArchive: { slotImages: {} }, matureArchive: null,
        } }, fact.evidence);
        continue;
      }
      const prefix = buildTeyvatIdSelector(existing.id);
      push({ action: 'set', root: 'NPC', path: `${prefix}.lastSeenTurn`, value: turn }, fact.evidence);
      if (typeof fact.affinitySet === 'number') push({ action: 'set', root: 'NPC', path: `${prefix}.affinity`, value: fact.affinitySet }, fact.evidence);
      else if (typeof fact.affinityDelta === 'number') push({ action: 'add', root: 'NPC', path: `${prefix}.affinity`, value: fact.affinityDelta }, fact.evidence);
      if (typeof fact.intimateRelationship === 'boolean') push({ action: 'set', root: 'NPC', path: `${prefix}.intimate`, value: fact.intimateRelationship }, fact.evidence);
      if (typeof fact.following === 'boolean') push({ action: 'set', root: 'NPC', path: `${prefix}.travelingTogether`, value: fact.following }, fact.evidence);
      if (fact.playerAddress) push({ action: 'set', root: 'NPC', path: `${prefix}.playerAddress`, value: fact.playerAddress }, fact.evidence);
      if (fact.appearance) push({ action: 'set', root: 'NPC', path: `${prefix}.appearance`, value: fact.appearance }, fact.evidence);
      if (fact.clothing) push({ action: 'set', root: 'NPC', path: `${prefix}.clothing`, value: fact.clothing }, fact.evidence);
      if (fact.speechStyle) push({ action: 'set', root: 'NPC', path: `${prefix}.speechStyle`, value: fact.speechStyle }, fact.evidence);
      const ledgerSet = (field: string, value?: string) => { if (value) push({ action: 'set', root: 'NPC', path: `${prefix}.relationshipLedger.${field}`, value }, fact.evidence); };
      const ledgerPush = (field: string, values?: string[]) => values?.forEach((value) => push({ action: 'push', root: 'NPC', path: `${prefix}.relationshipLedger.${field}`, value }, fact.evidence));
      ledgerSet('recentInteraction', fact.recentInteraction ?? fact.memory);
      ledgerSet('longTermImpression', fact.longTermImpression);
      ledgerPush('sharedExperiences', fact.sharedExperiences);
      ledgerPush('unfinishedBusiness', fact.openItems);
      const remainingUnfinishedBusiness = removeResolvedLedgerItems(existing.relationshipLedger?.unfinishedBusiness, fact.resolvedItems);
      if (remainingUnfinishedBusiness) {
        push({ action: 'set', root: 'NPC', path: `${prefix}.relationshipLedger.unfinishedBusiness`, value: remainingUnfinishedBusiness }, fact.evidence);
      }
      ledgerPush('unresolvedConflicts', fact.unresolvedConflicts);
      ledgerPush('mustRemember', fact.mustRemember);
      ledgerPush('protectedFacts', fact.doNotForget);
      if (fact.memory) push({ action: 'push', root: 'NPC', path: `${prefix}.sharedMemories`, value: {
        id: stableDomainId(`${existing.id}:memory`, [String(turn), fact.memory]), turn, summary: fact.memory,
        source: 'variable', relatedNpcIds: [existing.id],
      } }, fact.evidence);
      continue;
    }
    if (fact.type === 'nsfw_archive') {
      const requestedId = fact.npcId?.trim();
      const id = requestedId && isTeyvatStableId(requestedId) ? requestedId : npcIdFromName(fact.npcName);
      let existing = state.NPC.find((entry) => entry.id === id || entry.姓名 === fact.npcName || entry.aliases.includes(fact.npcName)
        || matchCanonical(entry.姓名)?.name === matchCanonical(fact.npcName)?.name);
      const blockedReason = getNsfwArchiveBlockReason(undefined, fact.npcName, fact.evidence);
      if (!existing && !blockedReason) {
        const canonical = matchCanonical(fact.npcName);
        existing = {
          id, 姓名: canonical?.name ?? fact.npcName, 地区: '', 身份: '', 天赋: [], 说明: '',
          aliases: canonical?.aliases ?? [], roleTier: canonical ? 'companion' : 'extra', affinity: 0,
          relationship: 'stranger', intimate: false, travelingTogether: false, firstSeenTurn: turn, lastSeenTurn: turn,
          gender: canonical?.gender ?? '', playerAddress: '', appearance: canonical?.appearance ?? '', clothing: '', speechStyle: '',
          personality: canonical?.personality ?? '', equipmentSummary: '', sharedMemories: [],
          relationshipLedger: { recentInteraction: '', longTermImpression: '', currentStage: '初见', sharedExperiences: [], unfinishedBusiness: [], unresolvedConflicts: [], mustRemember: [], protectedFacts: [], summaries: [] },
          notes: [], playerCorrections: [], canonical: Boolean(canonical), avatar: '', visualArchive: { slotImages: {} }, matureArchive: null,
        };
        push({ action: 'push', root: 'NPC', path: 'records', value: existing }, fact.evidence);
      }
      if (blockedReason) warnings.push(`nsfw_archive 已忽略：${blockedReason}。`);
      else if (existing) {
        const archiveBlockedReason = getNsfwArchiveBlockReason(undefined, fact.npcName, fact.evidence);
        if (archiveBlockedReason) warnings.push(`nsfw_archive 已忽略：${archiveBlockedReason}。`);
        else push({ action: 'set', root: 'NPC', path: `${buildTeyvatIdSelector(existing.id)}.matureArchive`, value: {
          ...(existing.matureArchive ?? { preferences: [], sensitivePoints: [], taboos: [], femaleBodyProfile: {}, maleBodyProfile: {}, experiences: [], longTermFacts: [], tags: [], partImages: {} }),
          enabled: fact.enabled ?? existing.matureArchive?.enabled ?? true,
          ageConfirmation: fact.ageConfirm ?? existing.matureArchive?.ageConfirmation ?? 'unknown',
          intimacyStage: fact.intimacyStage ?? existing.matureArchive?.intimacyStage,
          boundaries: fact.boundaries ?? existing.matureArchive?.boundaries,
          ...(existing.gender === '女' && (fact.ageConfirm ?? existing.matureArchive?.ageConfirmation) === 'adult' ? {
            virginityStatus: fact.virginityStatus ?? existing.matureArchive?.virginityStatus,
            firstSexualPartner: fact.firstSexualPartner ?? existing.matureArchive?.firstSexualPartner,
          } : {}),
          preferences: fact.preferences ?? existing.matureArchive?.preferences ?? [], sensitivePoints: fact.sensitivePoints ?? existing.matureArchive?.sensitivePoints ?? [],
          taboos: fact.taboos ?? existing.matureArchive?.taboos ?? [], experiences: fact.experiences ?? existing.matureArchive?.experiences ?? [],
          longTermFacts: fact.longTermFacts ?? existing.matureArchive?.longTermFacts ?? [], tags: fact.tags ?? existing.matureArchive?.tags ?? [], notes: fact.notes,
          femaleBodyProfile: {
            ...(existing.matureArchive?.femaleBodyProfile ?? {}),
            ...(fact.femaleBodyArchive?.胸部 ? { chest: fact.femaleBodyArchive.胸部 } : {}),
            ...(fact.femaleBodyArchive?.女性私处 ? { genital: fact.femaleBodyArchive.女性私处 } : {}),
            ...(fact.femaleBodyArchive?.后庭 ? { rear: fact.femaleBodyArchive.后庭 } : {}),
            ...(fact.femaleBodyArchive?.体态 ? { build: fact.femaleBodyArchive.体态 } : {}),
            ...(fact.femaleBodyArchive?.体味 ? { scent: fact.femaleBodyArchive.体味 } : {}),
          },
          maleBodyProfile: {
            ...(existing.matureArchive?.maleBodyProfile ?? {}),
            ...(fact.maleBodyArchive?.男性器 ? { genital: fact.maleBodyArchive.男性器 } : {}),
            ...(fact.maleBodyArchive?.后庭 ? { rear: fact.maleBodyArchive.后庭 } : {}),
            ...(fact.maleBodyArchive?.体态 ? { build: fact.maleBodyArchive.体态 } : {}),
            ...(fact.maleBodyArchive?.体味 ? { scent: fact.maleBodyArchive.体味 } : {}),
          },
        } }, fact.evidence);
      }
      continue;
    }
    if (fact.type === 'courier_seed') {
      if (!courierSeedsEnabled || courierSeedsWritten >= maxCourierSeedsPerTurn) {
        warnings.push(`courier seed 已忽略：主动投递关闭或达到上限（${fact.title}）。`);
        continue;
      }
      const requested = [fact.targetId, fact.targetName, ...(fact.relatedNpcIds ?? [])]
        .map((value) => value?.trim()).filter((value): value is string => Boolean(value));
      let targetId = '';
      for (const value of requested) {
        const contact = state.手机.contacts.find((entry) => entry.id === value || entry.npcId === value || entry.name === value);
        if (contact) { targetId = contact.id; break; }
        const npc = state.NPC.find((entry) => entry.id === value || entry.姓名 === value || entry.aliases.includes(value));
        if (npc) { targetId = npc.id; break; }
        const canonical = matchCanonical(value);
        if (canonical && (canonical.name === value || canonical.aliases?.includes(value))) {
          targetId = state.NPC.find((entry) => entry.姓名 === canonical.name)?.id ?? npcIdFromName(canonical.name);
          break;
        }
      }
      if (!targetId) {
        warnings.push(`courier seed 已忽略：${requested.join(' / ') || fact.title} 不是有效联系人或已入档角色。`);
        continue;
      }
      push({ action: 'push', root: '信使', path: 'deliverySeeds', value: {
        id: stableDomainId('courier_seed', [String(turn), targetId, fact.title]), senderId: targetId, reason: fact.context,
        turn, source: 'main_story', triggerType: fact.triggerType ?? 'custom', priority: fact.priority ?? 'normal',
        targetType: fact.targetType ?? 'private', targetId, title: fact.title, context: fact.context,
        relatedNpcIds: fact.relatedNpcIds ?? [], expiresAfterTurns: 6, status: 'pending',
      } }, fact.evidence);
      courierSeedsWritten += 1;
      continue;
    }
    if (fact.type === 'skill_used') {
      const talent = state.旅行者.天赋.find((entry) => entry.名称 === fact.talentName || entry.id === fact.talentName);
      if (!talent) {
        warnings.push(`skill_used 已忽略：技能面板没有登记「${fact.talentName}」。`);
        continue;
      }
      if (!isTeyvatStableId(talent.id)) {
        warnings.push(`skill_used 已忽略：天赋「${talent.名称}」的 id 不是稳定 id，无法定位。`);
        continue;
      }
      if (talent.等级 >= 20) {
        warnings.push(`skill_used 已忽略：天赋「${talent.名称}」已达最高等级 20。`);
        continue;
      }
      push({ action: 'add', root: '旅行者', path: `天赋${buildTeyvatIdSelector(talent.id)}.等级`, value: 1 }, fact.evidence);
      continue;
    }
  }
  return { commands, notes, warnings };
}
