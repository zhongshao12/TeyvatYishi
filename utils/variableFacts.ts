import type { 变量事实, 变量命令 } from '@/models/variableCommand';
import type { VariableState } from './variableRegistry';
import type { 世界状态 } from '@/models/world';
import { 对齐世界日期与天数, 推进旅行日期 } from '@/models/world';
import type { NPC记录, NPC关系类型 } from '@/models/npc';
import { isReservedNpcIdentityName, NPC_AFFINITY_DEAREST_FRIEND_THRESHOLD, 获取NPC关系阶段, 获取NPC兼容关系, 限制NPC好感度 } from '@/models/npc';
import { CANONICAL_CHARACTERS, matchCanonical, matchCanonicalIdentity } from '@/data/canonicalCharacters';
import { isCanonicalIdentity } from '@/data/canonicalIdentity';
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
import { resolveNpcAdultEligibility } from '@/utils/npcAdultEligibility';
import { getCanonicalArchiveBaselineAge } from '@/utils/npcArchiveEnrichment';
import { getNsfwArchiveBlockReason } from '@/utils/nsfwArchivePolicy';
import { scanNpcIntimacyEvents, type NpcIntimacySubject } from '@/utils/npcIntimacyEvidence';
import {
  normalizeLegacyFactKind,
  readLegacyNpcKeyFromName,
  readLegacyNpcNameFromKey,
} from '@/compat/legacy-hsr/readOnly';
import { LEGACY_NPC_ID_TO_CHINESE_NAME, normalizeLegacyNpcSelector } from '@/utils/legacyNpcIdentity';
import { shouldReplaceUsualClothing } from '@/utils/npcUsualClothing';

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
  const canonical = matchCanonicalIdentity({ id });
  if (canonical) return canonical.name;
  const normalized = normalizeLegacyNpcSelector(id);
  return LEGACY_NPC_ID_TO_CHINESE_NAME[normalized] ?? readLegacyNpcNameFromKey(normalized);
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
      days: 数字(raw.days ?? raw.天数),
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
    const rawName = 读字符串(raw.name || raw.姓名 || raw.名称) || npcNameFromId(id);
    const rawAlias = 读字符串(raw.alias || raw.别名);
    const canonical = matchCanonicalIdentity({ id, name: rawName, aliases: rawAlias ? [rawAlias] : [] });
    const name = canonical?.name ?? rawName;
    if (!name || isReservedNpcIdentityName(name)) return null;
    const tier = 读字符串(raw.tier || raw.阶位);
    const relation = 读字符串(raw.relation || raw.关系);
    return {
      type: 'npc',
      id: id || undefined,
      name,
      alias: rawAlias || undefined,
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
      usualUnderwear: 读字符串(raw.usualUnderwear ?? raw.常用内衣) || undefined,
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

  const block = 清理事实块(blockMatch[1] ?? '');
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
  // 百/千 量级（「一百年」「一千年」等）：原文旧实现只认到「十」，导致这些跨度解析失败、
  // 退回凭空 3 分钟；现在能算出真实天数，让「超出可结算范围」走警告路径而不是静默乱跳。
  if (/^[零〇一二两三四五六七八九十百千]+$/u.test(value)) {
    const units: Array<[string, number]> = [['千', 1000], ['百', 100], ['十', 10]];
    let total = 0;
    let section = 0;
    for (const char of value) {
      if (char === '零' || char === '〇') continue;
      const digit = CHINESE_HOUR_DIGITS[char];
      if (digit !== undefined) {
        section = digit;
        continue;
      }
      const unit = units.find(([token]) => token === char)?.[1];
      if (unit === undefined) return null;
      total += (section || 1) * unit;
      section = 0;
    }
    const resolved = total + section;
    return resolved > 0 ? resolved : null;
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
    const whole = match[0] ?? '';
    const hour = match[1] ?? '0';
    const minute = match[2] ?? '00';
    candidates.push({
      index,
      end: index + whole.length,
      targetTime: `${hour.padStart(2, '0')}:${minute}`,
    });
  }

  const chinesePattern = /(凌晨|清晨|早上|上午|中午|下午|傍晚|晚上|夜里)?\s*([零〇一二两三四五六七八九十]{1,3}|\d{1,2})\s*[点時时](半|[零〇一二两三四五六七八九十]{1,3}分?|\d{1,2}分?)?/gu;
  for (const match of body.matchAll(chinesePattern)) {
    const hourText = match[2] ?? '';
    let hour = /^\d+$/.test(hourText) ? Number(hourText) : 解析中文整数(hourText);
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
    candidates.push({ index, end: index + (match[0]?.length ?? 0), targetTime: 格式化分钟(hour * 60 + minute) });
  }
  return candidates.sort((a, b) => a.index - b.index || a.end - b.end);
}

function 读取正文耗时候选(body: string): Array<{ index: number; end: number; minutes: number }> {
  const candidates: Array<{ index: number; end: number; minutes: number }> = [];
  const pattern = /(半|几|数|\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百]+)\s*(?:个)?\s*(小时|钟头|分钟)\s*(?:以后|之后|后|过去)/gu;
  for (const match of body.matchAll(pattern)) {
    const amount = 解析中文整数(match[1] ?? '');
    if (amount === null || amount <= 0) continue;
    const minutes = Math.round(amount * (match[2] === '分钟' ? 1 : 60));
    const index = match.index ?? 0;
    candidates.push({ index, end: index + (match[0]?.length ?? 0), minutes });
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

/**
 * 正文里的跨日/跨周/跨月表达 → 天数（2026-09-29 第二轮，用户报「时间推进有问题」）。
 *
 * 旧实现只认「N 天后」，于是「数日后」「几天后」「一周后」「半个月后」「一个月后」全都落到
 * 保底的「+3 分钟」——日期与旅行天数纹丝不动，玩家看到的就是时间没有推进（实测四条全中）。
 * 这里给出确定性的天数换算；无法量化但明确跨日的表达按最小可辩护值（1 天/3 天）处理。
 */
const 跨日短语天数: Array<{ pattern: RegExp; days: (m: RegExpMatchArray) => number | null }> = [
  // 具体天数：「三天后」「3 天之后」「五日后」
  { pattern: /(\d+|[一二两三四五六七八九十百千]+)\s*(?:天|日)(?:之)?后/gu, days: (m) => 解析中文整数(m[1] ?? '') },
  // 周：「一周后」「两周后」「3 个星期后」
  { pattern: /(\d+|[一二两三四五六七八九十]+)\s*(?:个)?\s*(?:周|星期|礼拜)(?:之)?后/gu, days: (m) => { const n = 解析中文整数(m[1] ?? ''); return n === null ? null : n * 7; } },
  // 月：「一个月后」「半个月后」「3 个月后」
  { pattern: /半\s*(?:个)?\s*月(?:之)?后/gu, days: () => 15 },
  { pattern: /(\d+|[一二两三四五六七八九十]+)\s*(?:个)?\s*月(?:之)?后/gu, days: (m) => { const n = 解析中文整数(m[1] ?? ''); return n === null ? null : n * 30; } },
  // 年：「一年后」「两年后」「一千年后」（超出上限由 validate 拦下并给警告，不在这里静默丢弃）
  { pattern: /(\d+|[一二两三四五六七八九十百千]+)\s*(?:个)?\s*年(?:之)?后/gu, days: (m) => { const n = 解析中文整数(m[1] ?? ''); return n === null ? null : n * 365; } },
  // 模糊但明确跨日：「数日后」「几天后」「好几天后」「许多天后」（「日」写法同样常见）
  { pattern: /(?:数|几|好几|好|许多|很多)\s*(?:天|日)(?:之)?后/gu, days: () => 3 },
  { pattern: /(?:数|几|好几|好|许多|很多)\s*(?:个)?\s*(?:周|星期|礼拜)(?:之)?后/gu, days: () => 21 },
  { pattern: /(?:数|几|好几|好|许多|很多)\s*(?:个)?\s*月(?:之)?后/gu, days: () => 90 },
  // 2026-10-03（玩家报「明确跨越时间没有跨越」）：补上「N 天」的其它句式 ——
  // 「过了两天」「两天过去」「隔了三天」此前一条都认不出来，全部落到最小步长 15 分钟。
  { pattern: /(?:过了|经过|过去了)\s*(\d+|[一二两三四五六七八九十百千]+)\s*(?:天|日)/gu, days: (m) => 解析中文整数(m[1] ?? '') },
  { pattern: /(\d+|[一二两三四五六七八九十百千]+)\s*(?:天|日)\s*(?:过去|已过|过去之后)/gu, days: (m) => 解析中文整数(m[1] ?? '') },
  { pattern: /(?:隔了|隔)\s*(\d+|[一二两三四五六七八九十百千]+)\s*(?:天|日)/gu, days: (m) => 解析中文整数(m[1] ?? '') },
];

/**
 * 单次结算允许推进的最大天数。
 * 正文明确写出的「一个月后」是合法跨度，不能被当成无效值拦掉（用户报的「时间推进有问题」的一条）；
 * 但十年以上的跳转更可能是解析错误，仍然拦下并给警告，绝不静默乱跳。
 */
const 最大跨日天数 = 365;

/**
 * 时间推进策略（2026-10-03，用户第三轮报「时间老是莫名其妙倒退和大幅度跨越」）。
 *
 * 规则（照玩家原话）：
 *  - 每回合至少推进 `minStepMinutes`（设置项，下限 15 分钟）；
 *  - **绝不倒退**：同一天里出现的更早钟点只是回溯/重复提及，不产生时间事实；
 *  - **不主动跨日**：除非正文明确写到「第二天/次日/翌日/过夜…」（或深夜 + 凌晨类钟点），
 *    否则推进后的时刻不得越过当天 23:59；
 *  - **同日跨度默认上限 3 小时**；只有正文明确写出小时数（「两个小时后」「八小时后」）
 *    才按该小时数放行，并同样受 12 小时封顶与「不跨日」约束；
 *  - 正文**明确写出钟点**（「下午三点，会议结束」）属于故事自己报时，按目标钟点落位，
 *    上限 12 小时，且只允许向前。
 */
export interface TimeAdvancePolicy {
  minStepMinutes: number;
  sameDayCapMinutes: number;
  explicitHoursCapMinutes: number;
  explicitClockCapMinutes: number;
}

export const DEFAULT_TIME_ADVANCE_POLICY: TimeAdvancePolicy = {
  minStepMinutes: 15,
  sameDayCapMinutes: 180,
  explicitHoursCapMinutes: 12 * 60,
  explicitClockCapMinutes: 12 * 60,
};

/**
 * 自动跨夜的终点（分钟，自次日 00:00 起算）：**次日 01:00**。
 *
 * 2026-10-03 玩家要求：「允许剧情到 23:59 自动跨越时间到下一天，但是只能到次日的凌晨一点」。
 * 即：没有写明跨日证据时，允许推算出来的推进把时间带过午夜，但最多到次日 01:00，
 * 不许一路冲到清晨。写明耗时（「两个小时后」）仍按正文跨度照做。
 */
export const AUTO_OVERNIGHT_DEADLINE_MINUTES = 60;

/** 次日凌晨的跨零点时段词（用于「深夜/半夜写出小钟点」的过夜判定）。 */
const 跨零点时段判据 = /凌晨|清晨|早上|夜里|半夜|深夜|午夜/;

/** 设置项的最小值：玩家要求「最少 15 分钟」。 */
export const MIN_TIME_ADVANCE_MINUTES = 15;

export function resolveTimeAdvancePolicy(input?: { minStepMinutes?: number }): TimeAdvancePolicy {
  const raw = Number(input?.minStepMinutes);
  const minStepMinutes = Number.isFinite(raw)
    ? Math.min(DEFAULT_TIME_ADVANCE_POLICY.sameDayCapMinutes, Math.max(MIN_TIME_ADVANCE_MINUTES, Math.trunc(raw)))
    : DEFAULT_TIME_ADVANCE_POLICY.minStepMinutes;
  return { ...DEFAULT_TIME_ADVANCE_POLICY, minStepMinutes };
}

/** 「今天过完就是明天」类表达：次日 / 第二天 / 翌日 / 隔天 / 隔日 / 明日 / 转天 / 跨日 / 过夜 / 醒来。 */
const 跨日明确表达 = /次日|第二天|翌日|隔天|隔日|明日|转天|跨日|跨夜|过夜|一夜(?:过去|过后|之后|后)|睡醒|醒来/gu;
/** 同一套判据的非全局版本（`test` 不共享 lastIndex）。 */
const 跨日证据判据 = /次日|第二天|翌日|隔天|隔日|明日|转天|跨日|跨夜|过夜|一夜|睡醒|醒来|明天/;

/** 正文是否**明确**允许跨到第二天。 */
export function 正文允许跨日(body: string, currentTime: string): boolean {
  if (跨日证据判据.test(body)) return true;
  // 「三天后」「一周后」「数日后」这类明确的天数跨度同样属于「正文写明跨日」。
  if (读取正文跨日候选(body).length > 0) return true;
  const current = 分钟序数(currentTime);
  if (current === null || current < 20 * 60) return false;
  // 深夜 + 正文写了跨零点的钟点（凌晨/清晨/早上/半夜）
  return 读取正文钟点候选(body).some((candidate) => {
    const target = 分钟序数(candidate.targetTime);
    if (target === null || target > 8 * 60) return false;
    return 跨零点时段判据.test(读取时间证据句(body, candidate.index, candidate.end));
  });
}

/** 正文里是否明确写出了**小时**级跨度（「两个小时后」「半天后」）。 */
function 正文明确小时跨度(body: string): boolean {
  if (/(?:半|几|数|\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百]+)\s*(?:个)?\s*(?:小时|钟头)\s*(?:以后|之后|后|过去)/u.test(body)) return true;
  // 「半天后 / 半日后」同样是正文写明的跨半天跨度（2026-10-03：此前只落到 15 分钟兜底）。
  return /半\s*(?:天|日)\s*(?:以后|之后|后|过去)/u.test(body);
}

/**
 * 正文里的**明确跨度**（小时 / 半天）→ 分钟。返回 null 表示正文没有写明跨度。
 * 明确写明的跨度允许跨过午夜（故事自己说了过去多久，就该照做）。
 */
function 读取正文明确跨度分钟(body: string): number | null {
  let best: number | null = null;
  const consider = (minutes: number) => {
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    if (best === null || minutes > best) best = minutes;
  };
  for (const match of body.matchAll(/(半|几|数|\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百]+)\s*(?:个)?\s*(小时|钟头)\s*(?:以后|之后|后|过去)/gu)) {
    const amount = 解析中文整数(match[1] ?? '');
    if (amount === null || amount <= 0) continue;
    consider(Math.round(amount * 60));
  }
  if (/半\s*(?:天|日)\s*(?:以后|之后|后|过去)/u.test(body)) consider(12 * 60);
  return best;
}

/** 同一天里更早的钟点（回溯/重复提及）→ 返回给调用方生成「不倒退」说明。 */
function 找同日回退钟点(body: string, currentTime: string): { current: string; target: string } | null {
  const current = 分钟序数(currentTime);
  if (current === null) return null;
  for (const candidate of 读取正文钟点候选(body)) {
    const target = 分钟序数(candidate.targetTime);
    if (target === null || target >= current) continue;
    const evidence = 读取时间证据句(body, candidate.index, candidate.end);
    if (跨日证据判据.test(evidence)) continue;
    const overnight = current >= 20 * 60 && target <= 8 * 60 && 跨零点时段判据.test(evidence);
    if (overnight) continue;
    return { current: currentTime, target: candidate.targetTime };
  }
  return null;
}

/** 当天还剩多少分钟可推进（不含 23:59 → 次日 00:00 的那一分钟）。 */
function 当天剩余分钟(currentTime: string): number | null {
  const current = 分钟序数(currentTime);
  if (current === null) return null;
  return Math.max(0, 1439 - current);
}

function 事实结果(
  fact: Extract<变量事实, { type: 'time' }> | null,
  warning: string | null = null,
): { fact: Extract<变量事实, { type: 'time' }> | null; warning: string | null } {
  return { fact, warning };
}

/**
 * 把推进量夹进策略：最小步长 / 同日上限 / 跨夜边界。
 *
 * `allowMidnightCrossing`：正文**自己写明**了跨度（「两个小时后」「半天后」）时，故事已经说了过去多久，
 * 就该照做 —— 可以跨过午夜（日期由结算侧照常推进）。
 * 未写明时也允许跨过午夜，但只到 **次日 01:00**（`AUTO_OVERNIGHT_DEADLINE_MINUTES`），
 * 这样「23:59 的闲聊不会永远卡在最后一分钟」，同时不会凭空冲到清晨。
 */
function 夹紧同日推进(
  minutes: number,
  policy: TimeAdvancePolicy,
  currentTime: string,
  cap: number,
  options: { allowMidnightCrossing?: boolean; storyDriven?: boolean } = {},
): { minutes: number; warning: string | null } {
  const current = 分钟序数(currentTime);
  const remaining = 当天剩余分钟(currentTime);
  // 到「次日 01:00」为止还允许走多少分钟（current 未知时不设跨夜上限）。
  const autoOvernightBudget = current === null ? null : (1440 - current) + AUTO_OVERNIGHT_DEADLINE_MINUTES;
  // 未写明跨日证据时：既服从策略上限（例如同日 3 小时 / 模型自报上限），
  // 也服从「最多自动跨到次日 01:00」这条跨夜边界 —— 两者取更小。
  const effectiveCap = options.allowMidnightCrossing || autoOvernightBudget === null
    ? cap
    : Math.min(cap, autoOvernightBudget);
  if (effectiveCap <= 0) {
    return { minutes: 0, warning: '已到当天最后一分钟；需要正文写出「第二天/翌日」或写明耗时才能跨日，本回合时间未推进。' };
  }
  const wanted = Math.max(minutes, policy.minStepMinutes);
  if (wanted <= effectiveCap) {
    const crossing = 跨夜说明(wanted, current, options.storyDriven === true);
    return crossing ? { minutes: wanted, warning: crossing } : { minutes: wanted, warning: null };
  }
  const note = !options.allowMidnightCrossing && remaining !== null && remaining < cap
    ? (autoOvernightBudget !== null && autoOvernightBudget > remaining
      ? `未写明跨日证据，最多自动推进到次日 01:00，已按 ${effectiveCap} 分钟结算。`
      : `同日推进不得超过当天剩余时间，已按 ${effectiveCap} 分钟结算（不跨日）。`)
    : `推进上限 ${Math.round(cap / 60)} 小时，已按 ${effectiveCap} 分钟结算。`;
  return { minutes: effectiveCap, warning: note };
}

/** 推进量是否越过午夜；越过时给出说明（区分「正文时间线」与「自动跨夜兜底」）。 */
function 跨夜说明(minutes: number, current: number | null, storyDriven: boolean): string | null {
  if (current === null) return null;
  if (minutes <= 1440 - current) return null;
  if (storyDriven) return '已跨入次日（按正文写明的时间线）。';
  return `已跨入次日（自动跨夜上限 ${String(Math.floor(AUTO_OVERNIGHT_DEADLINE_MINUTES / 60)).padStart(2, '0')}:${String(AUTO_OVERNIGHT_DEADLINE_MINUTES % 60).padStart(2, '0')}）。`;
}

function 读取正文跨日天数(body: string): { days: number; index: number; evidence: string } | null {
  // 保留越界的明确跳转（例如「一千年后」）由调用方的 validate 给出「超出可结算范围」的
  // 警告 —— 绝不静默退回凭空 3 分钟（那是用户报的「时间推进有问题」的形态之一）；
  // 因此这里按场景各自判断上限，不做统一过滤。
  const candidates: Array<{ days: number; index: number; evidence: string }> = [];
  for (const { pattern, days: toDays } of 跨日短语天数) {
    for (const match of body.matchAll(pattern)) {
      const days = toDays(match);
      const index = match.index ?? 0;
      candidates.push({ days: days ?? 0, index, evidence: 读取时间证据句(body, index, index + match[0].length) });
    }
  }
  const last = candidates
    .filter((entry) => Number.isSafeInteger(entry.days) && entry.days >= 1)
    .sort((a, b) => a.index - b.index)
    .at(-1);
  return last ?? null;
}

/** 从正文里提取明确钟点，作为模型漏报时间事实时的确定性兜底。 */
export function deriveNarrativeClockFact(
  body: string,
  currentTime: string,
): Extract<变量事实, { type: 'time' }> | null {
  const events = 归一化时间事件(body, 收集时间事件(body));
  if (!events.length) return null;

  const onlyEvent = events.length === 1 ? events[0]! : null;
  if (onlyEvent && onlyEvent.kind === 'clock' && (onlyEvent.days ?? 0) === 0
    && 分钟序数(onlyEvent.targetTime) === 分钟序数(currentTime)) {
    // 明确写下「就是现在这个钟点」——不推进、也不虚构耗时。
    return null;
  }
  const first = events[0]!;
  // 单一事件：保持原有语义（跨日 / 改钟点 / 耗时），不做任何累计。
  if (events.length === 1) {
    if (first.kind === 'elapsed') {
      return {
        type: 'time', mode: 'elapsed', minutes: first.duration,
        evidence: 读取时间证据句(body, first.index, first.end),
      };
    }
    const evidence = 读取时间证据句(body, first.index, first.end);
    if (first.kind === 'dayAdvance') {
      return { type: 'time', mode: 'next_day', days: first.days,
        targetTime: 推断跨日目标时间(evidence, currentTime), evidence };
    }
    const current = 分钟序数(currentTime);
    const target = 分钟序数(first.targetTime);
    const explicitDayAdvance = 有明确跨日证据(evidence) || (first.days ?? 0) > 0;
    const overnightClock = current !== null && target !== null && (current >= 20 * 60) && (target <= 8 * 60) && 跨零点时段判据.test(evidence);
    // 2026-10-03（用户报「莫名其妙倒退」）：同一天里写出的更早钟点只是回溯/重复提及。
    // 旧实现在这里放行 set_time，于是在 02:00 读到「凌晨一点」会把时钟倒拨一小时；
    // 多事件路径更糟 —— `raw < 0` 会被加成 +1440，一步跳掉 23 小时。这里统一按「无推进信号」处理。
    if (current !== null && target !== null && target < current && !explicitDayAdvance && !overnightClock) {
      return null;
    }
    const mode = explicitDayAdvance || overnightClock ? 'next_day' : 'set_time';
    // 明确写下「就是现在这个钟点」——不推进、也不虚构耗时。
    if (mode === 'set_time' && target !== null && target === current) return null;
    return { type: 'time', mode, targetTime: first.targetTime,
      ...(first.days !== undefined ? { days: first.days } : {}),
      evidence };
  }

  // 多段：按叙事顺序累计跨度（B10）。
  //
  // 为什么不能只看「最后一段」：旧实现取最后一个候选就返回，于是
  // 「三天后…两个小时后…」只结算 120 分钟、三天整段丢失。这里改为按顺序走完整条时间线：
  //  - `cursor` 是**绝对分钟坐标**（0 = 第 0 天 00:00），跨日与耗时直接累加；
  //  - 绝对钟点先折算到**当天钟点**（取模）再与 cursor 比较，因此永远不会出现
  //    「拿已经加了 N 天的坐标去比钟点」而把半天算成负数；
  //  - 同一个跨度的重复表述在两处被合并（相邻合并 + 同句同跨度去重），不会重复计时。
  let cursor: number | null = 分钟序数(currentTime);
  let totalMinutes = 0;
  let dayAdvanceMinutes = 0;
  let advanced = false;
  /** 只有「纯粹的天数推进」才回退到 next_day；一旦有钟点落位或相对耗时就是累计跨度。 */
  let onlyDayAdvance = true;
  const evidences: string[] = [];
  let seenClock = false;
  for (const event of events) {
    const evidence = 读取时间证据句(body, event.index, event.end);
    if (!evidences.includes(evidence)) evidences.push(evidence);
    if (event.kind === 'elapsed') {
      totalMinutes += event.duration;
      if (cursor !== null) cursor += event.duration;
      advanced = true;
      onlyDayAdvance = false;
      continue;
    }
    const days = typeof event.days === 'number' && event.days > 0 ? event.days * 1440 : 0;
    if (days > 0) {
      totalMinutes += days;
      dayAdvanceMinutes += days;
      if (cursor !== null) cursor += days;
      advanced = true;
    }
    if (event.kind !== 'clock') continue;
    const clock = 分钟序数(event.targetTime);
    if (clock === null) continue;
    const isFirstClock = !seenClock;
    seenClock = true;
    // 「现在是上午十点」这类**当前时刻的声明**不是推进目标：它既可能出现在跨日短语之前
    // （基线），也可能是跨日后的复述。两者都不该被算成额外流逝的时间。
    if (isFirstClock && (clock === cursor) && /现在|此时|此刻|钟楼/.test(evidence)) continue;
    // 只要正文写出钟点，这次推进就不是「纯粹的天数推进」：钟点本身就是落位语义。
    onlyDayAdvance = false;
    if (cursor === null) {
      cursor = clock;
      continue;
    }
    const dayPart = Math.floor(cursor / 1440) * 1440;
    const at = cursor - dayPart;
    const raw = clock - at;
    // 2026-10-03（用户报「莫名其妙大幅度跨越」）：旧实现在 `raw < 0` 时直接 `+1440`，
    // 于是一句回溯式的「晚上八点」（当前 21:30）会被算成 22.5 小时后，日期都跟着跳。
    // 现在的规则：只有**已经发生过跨日/耗时**时，钟点才可能是新一天里的落位；
    // 否则这一天里更早的钟点只是回溯/重复提及，忽略该事件、不产生任何推进。
    if (raw < 0) {
      // 2026-10-03 玩家实测「明明说了凌晨两点，时间没有跳转过去」：
      // 多段写法里（「夜里十一点，两人回到房间。凌晨两点，砂糖才睡着。」）先前只按
      // 「更早的钟点 = 回溯」丢弃，于是跨零点的钟点整段丢失。
      // 这里补上过夜规则：**跨零点时段**（凌晨/清晨/半夜/深夜…）里的小钟点（≤ 08:00）
      // 一定是「次日」的时刻，按跨日处理；其余更早的钟点仍然按回溯忽略。
      const clockHour = Math.floor(clock / 60);
      if (clockHour <= 8 && 跨零点时段判据.test(evidence)) {
        const overnightStep = raw + 1440;
        totalMinutes += overnightStep;
        dayAdvanceMinutes += 1440;
        cursor = Math.floor(cursor / 1440) * 1440 + 1440 + clock;
        advanced = true;
        onlyDayAdvance = false;
        continue;
      }
      // 正文明确写了跨日证据时同样按次日落位。
      if (跨日证据判据.test(evidence)) {
        const nextDayStep = raw + 1440;
        totalMinutes += nextDayStep;
        dayAdvanceMinutes += 1440;
        cursor = Math.floor(cursor / 1440) * 1440 + 1440 + clock;
        advanced = true;
        onlyDayAdvance = false;
        continue;
      }
      if (!advanced && dayPart === 0) continue;
      // 已经跨过日：钟点落在「新的一天里更早的时刻」属于歧义写法，同样忽略。
      continue;
    }
    const step = raw;
    // 只有「已经发生过跨度」或「这个钟点本身晚于当前时刻」才算真实流逝；
    // 纯基线钟点（例如「现在是上午十点。三天后……」）不产生额外耗时。
    if (advanced || step > 0) {
      totalMinutes += step;
      cursor = dayPart + clock;
      advanced = true;
    } else {
      cursor = clock;
    }
  }
  const evidence = evidences.join(' ').trim() || 读取时间证据句(body, first.index, first.end);
  // 没有任何推进（同日同钟点）→ 不产生时间事实，也不虚构耗时。
  if (totalMinutes === 0 && dayAdvanceMinutes === 0) return null;
  // 纯粹的跨日推进（没有耗时、也没有需要落位的钟点）保留 next_day 语义：
  // 日期 / 旅行天数 / 同行奖励完全一致，但不虚构一个「耗时」。
  if (onlyDayAdvance && dayAdvanceMinutes > 0) {
    return { type: 'time', mode: 'next_day', days: Math.max(1, Math.round(dayAdvanceMinutes / 1440)), evidence };
  }
  return { type: 'time', mode: 'elapsed', minutes: totalMinutes, evidence };
}

type 时间事件 =
  /** `days` 存在时表示这个钟点由跨日短语给定（「三天后的早上八点」）。 */
  | { kind: 'clock'; index: number; end: number; targetTime: string; days?: number }
  | { kind: 'elapsed'; index: number; end: number; duration: number }
  | { kind: 'dayAdvance'; index: number; end: number; days: number };

/** 收集正文里的全部时间表述：钟点 / 相对耗时 / 跨日短语。 */
function 收集时间事件(body: string): 时间事件[] {
  const dayCandidates = 读取正文跨日候选(body);
  const events: 时间事件[] = [];
  const absorbedDays = new Set<number>();
  for (const clock of 读取正文钟点候选(body)) {
    // 钟点与跨日短语描述同一个时刻（「三天后的早上八点」「三天后，众人在清晨六点抵达」）→
    // 天数**只保留在钟点事件上**，跨日短语事件不再单独计入（否则会算两遍）。
    // 只认**在该钟点之前**出现的跨日短语：否则「上午十点……第二天早上八点」里的
    // 后一句跨日证据会被错误地套到前面的钟点上。
    const clockEvidence = 读取时间证据句(body, clock.index, clock.end);
    const nearby = dayCandidates.find((candidate) =>
      (clock.index >= candidate.index) && (clock.index - candidate.index <= 4));
    const preceded = dayCandidates.find((candidate) =>
      (candidate.index < clock.index) && clockEvidence.includes(candidate.evidence));
    const dayAdvance = nearby ?? preceded;
    if (dayAdvance) absorbedDays.add(dayAdvance.index);
    events.push({
      kind: 'clock', index: clock.index, end: clock.end, targetTime: clock.targetTime,
      ...(dayAdvance ? { days: dayAdvance.days } : {}),
    });
  }
  for (const duration of 读取正文耗时候选(body)) {
    events.push({ kind: 'elapsed', index: duration.index, end: duration.end, duration: duration.minutes });
  }
  for (const candidate of dayCandidates) {
    if (absorbedDays.has(candidate.index)) continue;
    events.push({ kind: 'dayAdvance', index: candidate.index, end: candidate.end, days: candidate.days });
  }
  return events;
}

/**
 * 按位置归并同一件事的多种写法：
 *  - 「三天后的早上八点」= 一个钟点 + 一份天数；
 *  - 紧挨着重复出现的同一个钟点 / 同一段耗时 = 同一次时间推进。
 * 另外把**同一句里重复表述的同一段耗时**也去重：两句话都只说「两个小时后」时，
 * 它们是同一段时间的重复表述，不是两段各自的耗时。
 */
function 归一化时间事件(body: string, events: 时间事件[]): 时间事件[] {
  const sorted = [...events].sort((a, b) => a.index - b.index || a.end - b.end);
  const out: 时间事件[] = [];
  for (const event of sorted) {
    const previous = out.at(-1);
    if (previous && event.index < previous.end) {
      if (previous.kind === 'dayAdvance' && event.kind === 'clock') {
        out[out.length - 1] = { ...event, index: previous.index, end: Math.max(previous.end, event.end), days: previous.days };
        continue;
      }
      if (previous.kind === 'clock' && event.kind === 'dayAdvance') {
        out[out.length - 1] = { ...previous, end: Math.max(previous.end, event.end), days: event.days };
        continue;
      }
      if (previous.kind === 'clock' && event.kind === 'clock' && previous.targetTime === event.targetTime) {
        out[out.length - 1] = { ...previous, end: Math.max(previous.end, event.end) };
        continue;
      }
      if (previous.kind === 'elapsed' && event.kind === 'elapsed' && previous.duration === event.duration) {
        out[out.length - 1] = { ...previous, end: Math.max(previous.end, event.end) };
        continue;
      }
      continue;
    }
    out.push(event);
  }
  // 同一跨度紧接着重复表述只算一次（相邻合并处理不到「A句+同一跨度+A句」这种重复）。
  const seen = new Set<string>();
  return out.filter((event) => {
    if (event.kind !== 'elapsed') return true;
    const key = String(event.duration);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function 读取正文跨日候选(body: string): Array<{ index: number; end: number; days: number; evidence: string }> {
  const candidates: Array<{ index: number; end: number; days: number; evidence: string }> = [];
  const push = (index: number, end: number, days: number) => {
    if (!Number.isSafeInteger(days) || days < 1) return;
    candidates.push({ days, index, end, evidence: 读取时间证据句(body, index, end) });
  };
  for (const { pattern, days: toDays } of 跨日短语天数) {
    for (const match of body.matchAll(pattern)) {
      const index = match.index ?? 0;
      push(index, index + (match[0]?.length ?? 0), toDays(match) ?? 0);
    }
  }
  // 明确的「第二天」类表达同样是一整天的推进（旧实现只在完全没有钟点时才用它，
  // 于是「翌日，队伍继续赶路。」这类文本一条时间事实都产不出来）。
  for (const match of body.matchAll(跨日明确表达)) {
    const index = match.index ?? 0;
    push(index, index + (match[0]?.length ?? 0), 1);
  }
  // 同一句里重复表述的**同一次跨日**只算一次（2026-10-03）：
  // 「一觉醒来已是第二天。」里的「醒来」与「第二天」是同一天，旧实现按两条事件累加，
  // 于是跨了 2 天。按证据句归并、保留最大天数：既不会翻倍，也不会吞掉真正的多段跨度。
  const byEvidence = new Map<string, { index: number; end: number; days: number; evidence: string }>();
  for (const candidate of candidates) {
    const existing = byEvidence.get(candidate.evidence);
    if (!existing || candidate.days > existing.days) byEvidence.set(candidate.evidence, candidate);
  }
  return [...byEvidence.values()].sort((a, b) => a.index - b.index || a.end - b.end);
}

/** Decide the one time fact for a turn; explicit conflicts never become fabricated elapsed time. */
export function resolveTurnTimeFact(
  body: string,
  currentTime: string,
  modelFact?: Extract<变量事实, { type: 'time' }>,
  policyInput?: { minStepMinutes?: number },
): { fact: Extract<变量事实, { type: 'time' }> | null; warning: string | null } {
  const policy = resolveTimeAdvancePolicy(policyInput);
  const explicit = deriveNarrativeClockFact(body, currentTime);
  const current = 分钟序数(currentTime);
  const allowDayCrossing = 正文允许跨日(body, currentTime);
  const hasExplicitHourSpan = 正文明确小时跨度(body);
  const explicitSpanMinutes = 读取正文明确跨度分钟(body);
  const backwardClock = 找同日回退钟点(body, currentTime);
  const clockLike = body.match(/(?:时间|现在|此时|钟楼)[^。！？\n]{0,12}?(\d{1,2}:\d{2})/u);
  if (clockLike && 分钟序数(clockLike[1]) === null) {
    return 事实结果(null, `正文时刻 ${clockLike[1]} 无效，时间未推进。`);
  }
  // 正文**明确声明**了当前时刻（「钟楼显示现在是 10:00」「现在是上午十点」）时，
  // 即使它与当前时刻相同、因而没有产生推进事实，也绝不能落到「凭空 +3 分钟」的兜底：
  // 那会让玩家看到「正文说时间没变，结算却推进了 3 分钟」。
  const declaresCurrentClock = /(?:现在|此时|此刻|钟楼)[^。！？\n]{0,8}(?:\d{1,2}:\d{2}|[零〇一二两三四五六七八九十]{1,3}\s*[点時时])/u.test(body);
  const validate = (fact: Extract<变量事实, { type: 'time' }>, source: 'prose' | 'model' = 'prose'): string | null => {
    // 模型自报的跳转仍然收紧到 7 天（防它随手编一个跨度）；正文明确写出的「半个月后/一个月后」
    // 是合法跨度，按 最大跨日天数 判断（2026-09-29 第二轮：旧实现把两者都卡在 7 天，
    // 于是「半个月后」「一个月后」被判成无效、时间完全不推进）。
    const dayCap = source === 'model' ? 7 : 最大跨日天数;
    if (fact.mode === 'next_day' && fact.days !== undefined && (!Number.isSafeInteger(fact.days) || fact.days < 1 || fact.days > dayCap)) {
      return source === 'model' ? '时间跳转天数无效，已阻止结算。' : `正文跨日天数 ${fact.days} 天超出可结算范围（上限 ${dayCap} 天），已阻止结算。`;
    }
    if (fact.mode === 'elapsed' && (fact.minutes === undefined || !Number.isFinite(fact.minutes) || fact.minutes <= 0)) return '耗时分钟无效，已阻止结算。';
    if ((fact.mode === 'set_time' || fact.targetTime !== undefined) && 分钟序数(fact.targetTime) === null) return '目标时间格式无效，已阻止结算。';
    return null;
  };
  /** 跨日类事实必须先有明确跨日证据（玩家要求：不主动跨越到第二天）。 */
  const dayCrossingRejected = (fact: Extract<变量事实, { type: 'time' }>): string | null => (
    (fact.mode === 'next_day' || fact.mode === 'overnight') && !allowDayCrossing
      ? '正文没有明确写到「第二天/翌日/过夜」，已按当天推进（不主动跨日）。'
      : null
  );
  /** 应用同日策略：最小步长 / 同日上限 / 只向前落位。 */
  const acceptSameDayFact = (
    fact: Extract<变量事实, { type: 'time' }>,
    cap: number,
    allowMidnightCrossing = false,
    storyDriven = false,
  ): { fact: Extract<变量事实, { type: 'time' }> | null; warning: string | null } => {
    if (fact.mode === 'next_day' || fact.mode === 'overnight') return 事实结果(fact);
    if (fact.mode === 'elapsed') {
      // 日级跨度（正文写明「三天后」这类）：已经由跨日证据放行，按 最大跨日天数 校验即可，
      // 不再套用「同日 3 小时」上限。
      const minutes = fact.minutes ?? 0;
      if (allowDayCrossing && minutes >= 1440) return 事实结果(fact);
      const clamped = 夹紧同日推进(minutes, policy, currentTime, cap, { allowMidnightCrossing, storyDriven });
      if (!clamped.minutes) return 事实结果(null, clamped.warning);
      return 事实结果({ ...fact, minutes: clamped.minutes }, clamped.warning);
    }
    const target = 分钟序数(fact.targetTime);
    if (current !== null && target !== null) {
      if (target < current) {
        return 事实结果(null, `同日时间回退：当前 ${currentTime}，正文目标 ${fact.targetTime}；已忽略该钟点，时间未推进。`);
      }
      const step = target - current;
      if (step === 0) return 事实结果(null, null);
      if (step > cap) {
        return 事实结果(null, `目标钟点比当前晚 ${step} 分钟，超出同日落位上限 ${Math.round(cap / 60)} 小时；已忽略该钟点。`);
      }
    }
    return 事实结果(fact);
  };

  if (explicit) {
    const warning = validate(explicit) ?? dayCrossingRejected(explicit);
    if (warning) return 事实结果(null, warning);
    return acceptSameDayFact(
      explicit,
      hasExplicitHourSpan ? policy.explicitHoursCapMinutes : policy.explicitClockCapMinutes,
      // 正文派生出来的事实（含多段累计）一律允许跨过午夜：它是故事自己写出来的时间线，
      // 不该被「自动跨夜只到 01:00」这条兜底规则截断。
      // （2026-10-03 玩家实测：正文写了「夜里十一点…凌晨两点」却被夹到 01:00。）
      true,
      true,
    );
  }
  if (modelFact && modelFact.mode !== 'no_change') {
    const warning = validate(modelFact, 'model') ?? dayCrossingRejected(modelFact);
    if (!warning) {
      // 模型自报的同日推进按「正文是否写了明确小时数」判上限；
      // set_time 还要求正文确实写出了钟点，否则只按 3 小时上限对待。
      const modelCap = modelFact.mode === 'set_time'
        ? (读取正文钟点候选(modelFact.evidence ?? '').length ? policy.explicitClockCapMinutes : policy.sameDayCapMinutes)
        : (hasExplicitHourSpan ? policy.explicitHoursCapMinutes : policy.sameDayCapMinutes);
      // 只有在**正文也写了跨度**时才允许越过午夜：模型单独自报的跨度仍受「不跨日」约束。
      return acceptSameDayFact(modelFact, modelCap, hasExplicitHourSpan && modelFact.mode === 'elapsed');
    }
    // 被拒的模型事实不是终点：继续走正文/兜底，但把原因留在诊断里。
    const fallback = 兜底推进(policy, currentTime, declaresCurrentClock, body, backwardClock, explicitSpanMinutes);
    return 事实结果(fallback.fact, [warning, fallback.warning].filter(Boolean).join(' ') || null);
  }
  // 显式 no_change 不再冻结时钟（2026-10-03 玩家实测「时间没有正常推进」）。
  // 变量模型在「短对话 / 原地互动」场景会一直回 no_change，于是整场戏时间一动不动；
  // 而 no_change 的语义与「正文没有写出耗时证据」完全重合 —— 应用对那种情况的既定策略
  // 就是「按最小耗时推进」。因此这里让它落到同一条兜底：只有在正文**明确声明了当前钟点**
  // 时才真的不推进（那才是「故事自己说时间没变」）。
  return 兜底推进(policy, currentTime, declaresCurrentClock, body, backwardClock, explicitSpanMinutes);
}

/** 无事实可用时的推进：正文写明跨度就照做，否则按设置里的最小步长（都不主动跨日，除非写明跨度）。 */
function 兜底推进(
  policy: TimeAdvancePolicy,
  currentTime: string,
  declaresCurrentClock: boolean,
  body: string,
  backwardClock: { current: string; target: string } | null,
  explicitSpanMinutes: number | null = null,
): { fact: Extract<变量事实, { type: 'time' }> | null; warning: string | null } {
  const backwardNote = backwardClock
    ? `正文提到的 ${backwardClock.target} 早于当前 ${backwardClock.current}（同日回退），已忽略该钟点，不倒退。`
    : null;
  if (declaresCurrentClock) return 事实结果(null, backwardNote);
  const 写明跨度 = typeof explicitSpanMinutes === 'number' && explicitSpanMinutes > 0;
  const clamped = 夹紧同日推进(
    写明跨度 ? explicitSpanMinutes : policy.minStepMinutes,
    policy,
    currentTime,
    写明跨度 ? policy.explicitHoursCapMinutes : policy.sameDayCapMinutes,
    { allowMidnightCrossing: 写明跨度 },
  );
  if (!clamped.minutes) return 事实结果(null, [backwardNote, clamped.warning].filter(Boolean).join(' ') || null);
  const evidence = body.replace(/\s+/g, ' ').trim().slice(0, 100);
  if (!evidence) return 事实结果(null, backwardNote);
  return 事实结果(
    { type: 'time', mode: 'elapsed', minutes: clamped.minutes, evidence },
    [backwardNote, clamped.warning].filter(Boolean).join(' ') || null,
  );
}

/** 供结算报告/诊断展示的「本回合时间决策」一行说明。 */
export function describeTimeDecision(
  decision: { fact: Extract<变量事实, { type: 'time' }> | null; warning: string | null },
  currentTime: string,
): string {
  if (decision.warning) return `时间未推进（${decision.warning}）`;
  const fact = decision.fact;
  if (!fact) return `时间未推进（正文与本回合事实都没有耗时证据；当前 ${currentTime}）`;
  switch (fact.mode) {
    case 'elapsed':
      return `时间推进 ${fact.minutes ?? 0} 分钟（当前 ${currentTime}）`;
    case 'next_day':
      return `时间跨日 ${fact.days ?? 1} 天${fact.targetTime ? `，落在 ${fact.targetTime}` : ''}（当前 ${currentTime}）`;
    case 'set_time':
      return `时间设定为 ${fact.targetTime ?? '未知'}（当前 ${currentTime}）`;
    case 'overnight':
      return `时间跨夜（当前 ${currentTime}）`;
    default:
      return `时间未推进（当前 ${currentTime}）`;
  }
}

export function deriveNarrativeTimeFact(
  body: string,
  currentTime: string,
  modelFact?: Extract<变量事实, { type: 'time' }>,
): Extract<变量事实, { type: 'time' }> | null {
  return resolveTurnTimeFact(body, currentTime, modelFact).fact;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Conservative fallback for named canon characters who visibly participate in the settled scene.
 * A plain historical/lore mention is intentionally insufficient: the name must speak, act toward
 * the player, or be explicitly met by the player.
 */
export function deriveNarrativeCanonicalNpcFacts(
  body: string,
): Array<Extract<变量事实, { type: 'npc' }>> {
  if (!body.trim()) return [];
  const facts: Array<Extract<变量事实, { type: 'npc' }>> = [];
  for (const canonical of CANONICAL_CHARACTERS) {
    const name = canonical.name;
    if (!body.includes(name)) continue;
    const escaped = escapeRegExp(name);
    const speaks = new RegExp(`(?:^|\\n)\\s*[「『“\"']?${escaped}[」』”\"']?\\s*[：:]`, 'u');
    const actsWithPlayer = new RegExp(`${escaped}.{0,36}(?:看向|望向|注视|打量|对你|向你|与你|朝你|问道|说道|开口|回答|递给|走向|靠近|迎上|伸手|微笑|轻笑)`, 'u');
    const playerMeets = new RegExp(`(?:你|旅行者).{0,30}(?:见到|遇见|认识|碰见|看见|拜访|找到|走到|来到).{0,18}${escaped}`, 'u');
    const canonicalMeetsPlayer = new RegExp(`${escaped}.{0,30}(?:见到|遇见|看见|找到|走到|来到|迎接).{0,18}(?:你|旅行者)`, 'u');
    const matched = body.match(speaks) ?? body.match(actsWithPlayer) ?? body.match(playerMeets) ?? body.match(canonicalMeetsPlayer);
    if (!matched) continue;
    const matchIndex = matched.index ?? body.indexOf(name);
    const sentenceStart = Math.max(0, body.lastIndexOf('\n', matchIndex), body.lastIndexOf('。', matchIndex - 1) + 1);
    const sentenceEndCandidates = ['。', '！', '？', '\n']
      .map((token) => body.indexOf(token, matchIndex + name.length))
      .filter((index) => index >= 0);
    const sentenceEnd = sentenceEndCandidates.length ? Math.min(...sentenceEndCandidates) + 1 : Math.min(body.length, matchIndex + 160);
    const evidence = body.slice(sentenceStart, sentenceEnd).replace(/\s+/g, ' ').trim().slice(0, 240);
    facts.push({
      type: 'npc',
      id: npcIdFromName(name),
      name,
      tier: 'companion',
      recentInteraction: evidence,
      memory: evidence,
      evidence,
    });
  }
  return facts;
}

/** 意图/否定窗口：与 `inventoryActionIsUnrealized` 同一套中文未实现前缀。 */
const PARTY_UNREALIZED_PREFIX = /(?:如果|假如|倘若|要是|假设|可能|或许|也许|打算|准备|计划|想要|试图|考虑|犹豫|没有|并未|未曾|不曾|尚未|拒绝|不再|打消)/u;

const PARTY_DEPARTURE_KEYWORD = /(?:离开(?:了)?队伍|离队|退出队伍|不再同行|结束同行)/u;

/**
 * 正文里「队伍状态」相关短语的**从句内**前缀（不含上一句/上一分句）。
 * 只看同句前缀，避免「他打算休息。安柏离开队伍。」被邻句的意图词误判成未实现。
 */
function 离队关键词前缀(body: string, keywordIndex: number): string {
  const clauseStart = Math.max(
    ...['。', '！', '？', '\n', '；', ';', '，', ',', '、'].map((token) => body.lastIndexOf(token, keywordIndex - 1) + 1),
    0,
  );
  return body.slice(Math.max(clauseStart, keywordIndex - 20), keywordIndex);
}

/**
 * 正文里出现「离开/走向」等词时，判断方向是否真的是**离开队伍/靠近队伍**。
 * 「走近队伍」「迎接归队」这类靠近语义在旧实现里也会被判成离队。
 */
function 归属方向是靠近(body: string, departureIndex: number, departureLength: number): boolean {
  const near = body.slice(Math.max(0, departureIndex - 20), departureIndex + departureLength + 6);
  const approach = near.match(/(?:向|朝|往|来到|走近|靠近|迎向|迎上)\s*([^，。！？、\s]{0,4})/u);
  return Boolean(approach && /(?:队伍|队|旅行者|你|大家|众人)/u.test(approach[1] ?? ''));
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
    // B11：「没有/并未/不再离队」「打算离队但尚未执行」都不能写成 following=false；
    // 旧实现只要出现「离开队伍」字样就写 false，而且还会把模型正确的 following=true 整条滤掉。
    const departure = new RegExp(`${escaped}.{0,24}?(?:告别.{0,12}?)?${PARTY_DEPARTURE_KEYWORD.source}`, 'u');
    const matched = departure.exec(body);
    if (!matched || matched.index === undefined) continue;
    // 用匹配文本里关键词的真实下标定位「意图/否定」窗口（不能用姓名字符数推算）。
    const keywordOffset = matched[0].search(PARTY_DEPARTURE_KEYWORD);
    const keywordIndex = matched.index + (keywordOffset >= 0 ? keywordOffset : matched[0].length);
    if (PARTY_UNREALIZED_PREFIX.test(离队关键词前缀(body, keywordIndex))) continue;
    if (归属方向是靠近(body, matched.index, matched[0].length)) continue;
    // 证据取**完整句子**（而不是只有「名字+关键词」这一小段）：既保留可读的上下文，
    // 也让命令层的证据校验（lenient ≥ 8 字 / 与正文逐字相同）都能通过。
    const evidence = 读取时间证据句(body, matched.index, matched.index + matched[0].length) || matched[0];
    facts.push({ type: 'npc', id: npc.id, name: npc.姓名, following: false, evidence });
  }
  return facts;
}

const INVENTORY_REMOVAL_VERBS = /(使用|用掉|耗掉|消耗|服用|喝下|吃下|吃掉|交给|递给|赠给|送给|交付|上交|归还|丢失|遗失|失去|损毁|毁坏)/u;

/** 每日同行好感加成：每过一个自然日，队伍中的同行角色固定 +10（玩家指定值）。 */
export const 每日同行好感加成 = 10;

/**
 * 亲密事件好感规则（玩家指定）：
 * 亲吻 +5、性爱事件 +30、暧昧／谈情说爱 +3、肢体接触（牵手、搂抱等）+3。
 *
 * 同一回合同一角色**只按命中的最高档结算一次**，不逐档相加：
 * 这几档在实践中是包含关系（性爱场景必然同时出现亲吻与拥抱），
 * 相加会让一次剧情涨 30+5+3+3 = 41 点，与「亲吻 +5」的口径明显不符。
 *
 * 要改成叠加，只需改 `utils/npcIntimacyEvidence.ts` 的 `scanNpcIntimacyEvents`：
 * 它现在对每个 NPC 只保留 rank 最小（档位最高）的一条命中；把那段 `best` 逻辑换成
 * 逐档累加即可 —— 数值本身集中在下面的 `亲密事件档位数值`，不会漏改第二处。
 */
export const 亲密事件好感规则 = {
  性爱事件: 30,
  亲吻: 5,
  暧昧: 3,
  肢体接触: 3,
} as const;

/**
 * 档位 → 固定数值的**唯一**映射点。
 * 这里直接引用 `亲密事件好感规则`，不再写第二份字面量：
 * 旧实现里 `event.tier === 'sex' ? 30 : event.tier === 'kiss' ? 5 : 3` 与常量各写一份，
 * 于是「改一处即可换成累加」的注释是假的（2026-09-29 修正）。
 */
const 亲密事件档位数值: Record<'sex' | 'kiss' | 'flirt' | 'touch', number> = {
  sex: 亲密事件好感规则.性爱事件,
  kiss: 亲密事件好感规则.亲吻,
  flirt: 亲密事件好感规则.暧昧,
  touch: 亲密事件好感规则.肢体接触,
};

export function buildNpcIntimacyEventId(settlementId: string, turn: number, npcId: string, tier: string): string {
  return `npc_intimacy:${JSON.stringify([settlementId, turn, npcId, tier])}`;
}

/**
 * 正文里的直接玩家↔NPC亲密事件 → 固定好感度事实。
 *
 * 归属、代词回指、跨子句、引号与否定窗口全部交给 `scanNpcIntimacyEvents`（2026-09-29 重写）：
 * 旧版在这里按子句共现判定，并要求子句 ≥ 8 字，导致 `安柏亲吻了你。`、`安柏俯下身，轻轻吻住了云。`、
 * `她轻轻吻住了云。`、`「不要停……」安柏吻住了云。` 这类真实行文全部漏判 —— 而变量模型被明确要求
 * 「亲密事件不要输出 affinityDelta」，于是漏判等于好感度静默不涨。
 *
 * 本函数只负责：① 逐角色的成年硬闸；② 把命中的档位换成固定数值；③ 性爱档的女角色档案事实。
 * 旧的「证据里出现任何其他 NPC 名字就整条丢弃」已删除 —— 它会被单字名/别名的**子串**误杀
 * （`琴声`、`派蒙`、`Lisa`），现在改为由扫描器的**归属竞争**（`ambiguous`）处理：
 * 只有同句多人共同完成同一动作才丢弃，第三方仅在旁出现不再牵连。
 */
export function deriveNarrativeIntimacyFacts(
  body: string,
  records: readonly (Pick<NPC记录, 'id' | '姓名'> & {
    aliases?: readonly string[];
    gender?: string;
    travelingTogether?: boolean;
    同行?: boolean;
    /** 以下三项用于「未成年年龄证据」判定（Teyvat 记录的字段名与 legacy 不同）。 */
    说明?: string;
    appearance?: string;
    notes?: readonly string[];
    matureArchive?: { ageConfirmation?: 'adult' | 'unknown' | 'minor_blocked'; ageConfirmationSource?: 'canonical' | 'manual' | 'legacy_unverified' } | null;
    NSFW档案?: NPC记录['NSFW档案'];
  })[],
  options: { nsfwEnabled?: boolean; playerName?: string; turn?: number; settlementId?: string } = {},
): 变量事实[] {
  if (!body.trim()) return [];
  const byId = new Map(records.map((record) => [record.id, record]));
  const subjects: NpcIntimacySubject[] = [];
  for (const record of records) {
    const name = (record.姓名 ?? '').trim();
    if (!name) continue;
    // 描述文本里可能写着年龄（自定义角色没有原著名单可依）。
    const identityText = [record.说明, record.appearance, ...(record.notes ?? [])]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join(' ');
    const canonicalBaselineAge = getCanonicalArchiveBaselineAge(name);
    const eligibility = resolveNpcAdultEligibility({
      name, aliases: record.aliases, description: identityText,
      ageConfirmation: record.matureArchive?.ageConfirmation ?? record.NSFW档案?.年龄确认,
      ageSource: record.matureArchive?.ageConfirmationSource ?? record.NSFW档案?.年龄确认来源,
      canonicalBaselineAge,
    });
    // 事实层**显式**再过一次集中 NSFW 资格策略（`getNsfwArchiveBlockReason`）：
    // 硬禁名单 / 未成年证据 / 机械非人形命中时，这个角色连性爱档都不参与 ——
    // 与 `resolveNpcAdultEligibility` 内部那次调用同源，但在这里写明白，避免「间接调用」被重构掉。
    // 原著成年基线同样传下去：职责描述里的「魔物」「机械地」不再误伤（2026-10-03）。
    const sexArchiveBlocked = getNsfwArchiveBlockReason(
      undefined,
      name,
      `${[name, ...(record.aliases ?? [])].join(' ')} ${identityText}`,
      { canonicalAdultBaseline: canonicalBaselineAge === 'adult' && Boolean(matchCanonical(name)) },
    ) !== null;
    // 未通过硬闸的角色既不结算、也不参与主体竞争（否则它会以名字子串的形式把别人的事件带走）。
    subjects.push({
      id: record.id,
      姓名: name,
      aliases: record.aliases,
      eligible: eligibility.confirmed,
      allowSex: !sexArchiveBlocked,
    });
  }
  if (!subjects.some((subject) => subject.eligible !== false)) return [];
  const matches = scanNpcIntimacyEvents(body, subjects, {
    playerName: options.playerName ?? '',
    allowSex: options.nsfwEnabled !== false,
  });

  const facts: 变量事实[] = [];
  for (const match of matches) {
    const record = byId.get(match.npcId);
    const name = (record?.姓名 ?? '').trim();
    if (!record || !name) continue;
    // 归属不唯一（同句多人共同完成同一动作）→ 不结算，交由模型的普通关系变化处理。
    if (match.ambiguous) continue;
    const delta = 亲密事件档位数值[match.tier];
    const eventId = options.settlementId && options.turn
      ? buildNpcIntimacyEventId(options.settlementId, options.turn, record.id, match.tier)
      : undefined;
    facts.push({
      type: 'npc',
      id: record.id,
      name,
      affinityDelta: delta,
      eventId,
      evidence: match.evidence,
    });
    if (match.tier === 'sex' && record.gender === '女') {
      facts.push({
        type: 'nsfw_archive',
        npcId: record.id,
        npcName: name,
        virginityStatus: 'not_virgin',
        firstSexualPartnerRef: 'player',
        firstSexualPartnerSource: 'narrative',
        firstSexualPartnerTurn: options.turn,
        eventId,
        experiences: [options.turn ? `第${options.turn}回合：与玩家建立亲密关系` : '与玩家建立亲密关系'],
        evidence: match.evidence,
      });
    }
  }
  return facts;
}

function classifyPlayerInventoryRemoval(sentence: string, itemName: string): Extract<变量事实, { type: 'item' }>['action'] | null {
  const itemIndex = sentence.indexOf(itemName);
  const verbMatch = sentence.match(INVENTORY_REMOVAL_VERBS);
  if (itemIndex < 0 || !verbMatch || verbMatch.index === undefined) return null;
  if (inventoryActionIsUnrealized(sentence.slice(0, verbMatch.index))) return null;
  const playerIndexes = ['我', '你', '旅行者', '玩家'].map((token) => sentence.indexOf(token)).filter((index) => index >= 0);
  const playerIndex = playerIndexes.length ? Math.min(...playerIndexes) : -1;
  if (playerIndex < 0 || playerIndex > Math.max(itemIndex, verbMatch.index)) return null;
  const actorSpan = sentence.slice(playerIndex, Math.max(itemIndex, verbMatch.index) + verbMatch[0].length);
  if (/(?:看着|看见|目睹|望着).{0,20}(?:使用|服用|喝下|吃下|吃掉|交给|递给)/u.test(actorSpan)) return null;
  if (/(?:接过|收到|看见|发现|目睹).{0,20}(?:交给|递给|赠给|送给)/u.test(actorSpan)) return null;
  if (/(交给|递给|赠给|送给|交付|上交|归还)/u.test(verbMatch[0])) return 'give';
  if (/(丢失|遗失|失去|损毁|毁坏)/u.test(verbMatch[0])) return 'lose';
  return 'consume';
}

const INVENTORY_UNREALIZED_PREFIX = /(?:如果|假如|倘若|要是|假设|可能|或许|也许|打算|准备|计划|想要|试图|没有|并未|未曾|不曾|尚未|拒绝)/u;
function inventoryActionIsUnrealized(prefix: string): boolean {
  return INVENTORY_UNREALIZED_PREFIX.test(prefix.slice(-28));
}

function inventoryClauses(text: string): string[] {
  return text.split(/(?<=[。！？!?；;，,\n])/u).map((part) => part.trim()).filter(Boolean);
}

/**
 * 正文里的数量解析（获得与消耗共用）。
 *
 * B12：旧实现只认单个汉字（`values[quantityText] ?? 1`），于是「十二枚苹果」「二十枚苹果」
 * 全都变成 1。复合中文数量统一交给 `解析中文整数`（已支持 十/百/千 与 几/数）。
 */
function parseNarrativeQuantity(text: string, itemName: string): number {
  const escapedName = itemName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`([零〇一二两三四五六七八九十百千]+|\\d+)\\s*(?:个|枚|份|瓶|块|件|颗|串|袋|盒)?\\s*${escapedName}`, 'u'));
  if (!match) return 1;
  const parsed = 解析中文整数(match[1] ?? '');
  return parsed !== null && Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 1;
}

/**
 * 「剩余数量」语义：玩家使用/消耗的是**背包里剩下的全部**。
 * 正文里的量词可能缺省（「使用剩余的苹果」），此时不能再按默认 1 处理。
 */
function parseRemainingQuantity(text: string, itemName: string): number | null {
  const escapedName = itemName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`(?:全部|所有|剩余|剩下的?)\\s*(?:的)?\\s*(?:[零〇一二两三四五六七八九十百千]+|\\d+)?\\s*(?:个|枚|份|瓶|块|件|颗|串|袋|盒)?\\s*${escapedName}\\s*(?:的)?\\s*(?:全部|所有|剩余|剩下的?)?`, 'u'));
  if (!match) return null;
  if (!/(?:全部|所有|剩余|剩下的?)/u.test(match[0])) return null;
  const quantityText = match[0].match(/([零〇一二两三四五六七八九十百千]+|\d+)/u)?.[1];
  if (quantityText) {
    const parsed = 解析中文整数(quantityText);
    return parsed !== null && parsed > 0 ? Math.trunc(parsed) : null;
  }
  return Number.POSITIVE_INFINITY;
}

const KNOWN_NARRATIVE_ITEMS = new Map<string, Pick<TeyvatItem, 'category' | 'rarity'>>([
  ['日落果', { category: 'food', rarity: 1 }],
  ['苹果', { category: 'food', rarity: 1 }],
  ['甜甜花', { category: 'material', rarity: 1 }],
]);

/** A narrow fallback when the variable model omits an unambiguous player receipt. */
export function deriveNarrativeInventoryGainFacts(
  body: string,
  items: readonly TeyvatItem[],
): { facts: Array<Extract<变量事实, { type: 'item' }>>; warnings: string[] } {
  const facts: Array<Extract<变量事实, { type: 'item' }>> = [];
  const warnings: string[] = [];
  const known = new Map(KNOWN_NARRATIVE_ITEMS);
  for (const item of items) known.set(item.name, { category: item.category, rarity: item.rarity });
  const sentences = body.split(/(?<=[。！？!?\n])/u).map((part) => part.trim()).filter(Boolean);
  for (const sentence of sentences) {
    // A later explicit refusal cancels a handoff mentioned earlier in the same sentence.
    if (/(?:但|然而|却).{0,10}(?:没有|并未|未曾|拒绝).{0,8}(?:接过|收下|接受|拿走)/u.test(sentence)) continue;
    for (const clause of inventoryClauses(sentence)) {
      const receipt = clause.match(/(?:递给|交给|送给)(?:了)?(?:你|我)|(?:你|我|旅行者|玩家)(?:接过|收下|捡起|拾起|获得)/u);
      if (!receipt || receipt.index === undefined || inventoryActionIsUnrealized(clause.slice(0, receipt.index))) continue;
      const receivedText = clause.slice(receipt.index + receipt[0].length);
      const receivedNames = [...known.keys()]
        .filter((candidate) => receivedText.includes(candidate))
        .sort((left, right) => receivedText.indexOf(left) - receivedText.indexOf(right));
      if (!receivedNames.length) {
        const unknown = receivedText.match(/^\s*一[把件枚个瓶份]\s*([^，。！？\s]{2,12})/u)?.[1];
        if (unknown) warnings.push(`背包结算待确认：${unknown}缺少可靠分类或星级`);
        continue;
      }
      for (const name of receivedNames) {
        const item = known.get(name);
        if (!item) continue;
        facts.push({ type: 'item', action: 'gain', name, category: item.category, rarity: item.rarity, quantity: parseNarrativeQuantity(receivedText, name), evidence: clause });
      }
    }
  }
  return { facts, warnings };
}

/** The model owns an action when it reported it; prose fallback fills only missing action/name pairs. */
export function mergeNarrativeInventoryFacts(
  modelFacts: 变量事实[],
  derived: Array<Extract<变量事实, { type: 'item' }>>,
): 变量事实[] {
  const key = (fact: Extract<变量事实, { type: 'item' }>) => `${fact.action}:${fact.name.trim().toLocaleLowerCase('zh-CN')}`;
  const seen = new Set(modelFacts.filter((fact): fact is Extract<变量事实, { type: 'item' }> => fact.type === 'item').map(key));
  const added = derived.filter((fact) => {
    const identity = key(fact);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
  return [...modelFacts, ...added];
}

/** 变量模型漏报时，只对正文中“物品名 + 明确扣除动词”做保守兜底。 */
export function deriveNarrativeInventoryRemovalFacts(
  body: string,
  items: readonly TeyvatItem[],
): Array<Extract<变量事实, { type: 'item' }>> {
  const sentences = body.split(/(?<=[。！？!?\n])/u).map((item) => item.trim()).filter(Boolean);
  // Prefer a single clause, but retain a whole-sentence fallback for omitted subjects/objects:
  // “旅行者取出日落果，交给安柏” states the item only before the comma.
  const evidenceCandidates = [...inventoryClauses(body), ...sentences];
  const facts: Array<Extract<变量事实, { type: 'item' }>> = [];
  for (const item of items) {
    const matched = evidenceCandidates.flatMap((evidence) => {
      if (!evidence.includes(item.name) || !INVENTORY_REMOVAL_VERBS.test(evidence)) return [];
      const action = classifyPlayerInventoryRemoval(evidence, item.name);
      return action ? [{ evidence, action }] : [];
    })[0];
    if (!matched) continue;
    // 「剩余的苹果」= 扣除活体背包里的全部（仍然由这里的 Math.min 封顶在真实数量上）。
    const quantity = parseRemainingQuantity(matched.evidence, item.name)
      ?? parseNarrativeQuantity(matched.evidence, item.name);
    facts.push({
      type: 'item',
      action: matched.action,
      category: item.category,
      name: item.name,
      quantity: Math.min(item.quantity, quantity),
      evidence: matched.evidence,
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
  // 上限 7 天是最后一道闸：防止模型报出荒谬的分钟数一次跳掉几个月。
  //
  // 这里曾经还有一条「证据里没有 小时/等待/赶路… 就压到 30 分钟」的规则，已移除：
  // 它让「三天后，队伍抵达璃月港。」被压成半小时 —— 天数、日期、每日同行好感加成全都静止；
  // 而语义完全相同的句子只要多写一个「等待」就立刻走满 3 天（+15 好感）。
  // 同一个意思两种结算，玩家看到的就是「好感度时涨时不涨」，所以改为按事实自报的耗时结算。
  return Math.min(7 * 1440, raw);
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

function matchCanonicalNpcFact(fact: Extract<变量事实, { type: 'npc' }>) {
  return matchCanonicalIdentity({
    id: fact.id,
    name: fact.name,
    aliases: fact.alias ? [fact.alias] : [],
  });
}

function findNpc(records: NPC记录[], id: string, name: string): NPC记录 | undefined {
  const targetCanonical = matchCanonicalIdentity({ id, name })?.name;
  return records.find((npc) =>
    npc.id === id ||
    npc.姓名 === name ||
    npc.别名 === name ||
    (Boolean(targetCanonical) && matchCanonicalIdentity({ id: npc.id, name: npc.姓名, aliases: npc.别名 ? [npc.别名] : [] })?.name === targetCanonical),
  );
}

function isCanonicalNpcPersonalityProtected(npc: NPC记录 | undefined, name: string): boolean {
  // 「有官方头像即原著角色」（2026-09-29 第 9 项）：`matchCanonical` 只认 58 个精简名单，
  // 而头像注册表有 127 个 —— 统一走 isCanonicalIdentity，避免那批角色的长期性格被变量模型改写。
  return Boolean(npc?.原著角色 || isCanonicalIdentity(npc?.姓名) || isCanonicalIdentity(name));
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
  archive.enabled = fact.enabled ?? current.enabled ?? true;
  archive.年龄确认 = 'adult';
  archive.年龄确认来源 = getCanonicalArchiveBaselineAge(existing.姓名) === 'adult' ? 'canonical' : current.年龄确认来源;
  if (existing.性别 === '女') {
    archive.是否处女 = fact.virginityStatus === 'virgin' ? '是' : fact.virginityStatus === 'not_virgin' ? '否' : fact.virginityStatus === 'unknown' ? '未知' : current.是否处女;
    // 常用内衣只允许女性角色写入；未提供时保留旧值。
    if (fact.usualUnderwear) archive.常用内衣 = fact.usualUnderwear;
    const hasFirstPartner = Boolean(current.首次性行为对象引用 || current.首次性行为对象来源
      || (current.首次性行为对象 && current.首次性行为对象 !== '无'));
    archive.首次性行为对象 = hasFirstPartner ? current.首次性行为对象 : fact.firstSexualPartner;
    if (!hasFirstPartner && fact.firstSexualPartnerRef === 'player') {
      archive.首次性行为对象引用 = 'player';
      archive.首次性行为对象来源 = fact.firstSexualPartnerSource ?? 'narrative';
      archive.首次性行为对象回合 = fact.firstSexualPartnerTurn;
    } else {
      archive.首次性行为对象引用 = current.首次性行为对象引用;
      archive.首次性行为对象来源 = current.首次性行为对象来源;
      archive.首次性行为对象回合 = current.首次性行为对象回合;
    }
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
  let timeSettled = false;

  const push = (command: 变量命令) => commands.push(command);

  for (const fact of facts) {
    if (fact.type === 'traveler_profile') {
      notes.push('已静默忽略 traveler_profile：旅人核心档案由玩家手写维护，变量系统不再修改身份、外貌、性格、背景、能力或专长知识。');
      continue;
    }

    if (fact.type === 'time') {
      if (timeSettled) continue;
      timeSettled = true;
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
        // 上限与 resolveTurnTimeFact 的校验收口一致：正文明确写出的「半个月后/一个月后」不再被压成 7 天。
        const days = fact.mode === 'next_day' && Number.isSafeInteger(fact.days) && (fact.days ?? 0) >= 1
          ? Math.min(最大跨日天数, fact.days ?? 1)
          : 1;
        const nextDate = 推进旅行日期(world?.当前日期 ?? '', days);
        const aligned = 对齐世界日期与天数((world?.旅程天数 ?? 1) + days, nextDate);
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
      const canonical = matchCanonicalNpcFact(fact);
      const resolvedName = canonical?.name ?? fact.name;
      const id = fact.id?.trim() || npcIdFromName(resolvedName);
      const existing = findNpc(npcs, id, resolvedName);
      if (!existing) {
        const initialAffinity = 限制NPC好感度(fact.affinitySet ?? fact.affinityDelta ?? 0);
        push({
          action: 'push',
          key: 'NPC',
          value: {
            id,
            姓名: resolvedName,
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
        if (fact.clothing && shouldReplaceUsualClothing(existing.穿着, fact.clothing, fact.evidence ?? '')) {
          push({ action: 'set', key: `${key}.穿着`, value: fact.clothing });
        }
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
      const eligibility = resolveNpcAdultEligibility({
        name: existing.姓名, aliases: existing.别名 ? [existing.别名] : [],
        description: [existing.介绍, existing.外貌, existing.备注.join(' ')].filter(Boolean).join(' '),
        ageConfirmation: existing.NSFW档案?.年龄确认,
        ageSource: existing.NSFW档案?.年龄确认来源,
        canonicalBaselineAge: getCanonicalArchiveBaselineAge(existing.姓名),
      });
      if (!eligibility.confirmed) {
        warnings.push(`nsfw_archive 已忽略：${eligibility.reason}。`);
        continue;
      }
      const key = `NPC[id=${existing.id}].NSFW档案`;
      const archive = buildNsfwArchiveUpdate(existing, fact);
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
  let timeSettled = false;
  const projectedInventory = (state.背包?.items ?? []).map((item) => ({ ...item }));
  /**
   * 本回合队伍成员的有序投影（B13）。
   *
   * 旧实现直接遍历 `state.NPC.filter((entry) => entry.travelingTogether)` —— 也就是
   * **回合开始那一刻**的队伍。于是「本回合先离队、再跨三天」里已经离队的人照样拿满三天同行奖励，
   * 而「本回合先入队、再跨日」的新同伴却拿不到。这里按事实顺序维护投影：
   * 时间事实发奖励时用的是「那一刻已经生效」的队伍状态。
   */
  const projectedParty = new Set(state.NPC.filter((entry) => entry.travelingTogether).map((entry) => entry.id));
  const projectPartyChange = (fact: 变量事实) => {
    if (fact.type !== 'npc' || typeof fact.following !== 'boolean') return;
    const npc = state.NPC.find((entry) =>
      entry.id === (fact as { id?: string }).id
      || entry.姓名 === (fact as { name?: string }).name
      || entry.aliases.includes((fact as { name?: string }).name ?? ''));
    if (!npc) return;
    if (fact.following) projectedParty.add(npc.id);
    else projectedParty.delete(npc.id);
  };
  const push = (command: Omit<TeyvatDomainCommand, 'evidence'>, evidence?: string) => commands.push({
    ...command,
    evidence: evidence?.trim() ?? '',
  });
  const rewardCurrentPartyForNewDay = (evidence?: string, dayCount = 1) => {
    if (dailyPartyRewardIssued) return;
    dailyPartyRewardIssued = true;
    for (const npc of state.NPC.filter((entry) => projectedParty.has(entry.id))) {
      push({ action: 'add', root: 'NPC', path: `${buildTeyvatIdSelector(npc.id)}.affinity`, value: 每日同行好感加成 * Math.max(1, dayCount) }, evidence || '每日同行固定好感度');
    }
  };

  for (const fact of facts) {
    projectPartyChange(fact);
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
      if (timeSettled) continue;
      timeSettled = true;
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
      const days = fact.mode === 'next_day' && Number.isSafeInteger(fact.days) && (fact.days ?? 0) >= 1
        ? Math.min(最大跨日天数, fact.days ?? 1)
        : 1;
      push({ action: 'add', root: '世界', path: '旅程天数', value: days }, fact.evidence);
      push({ action: 'set', root: '世界', path: '当前日期', value: 推进旅行日期(world.当前日期, days) }, fact.evidence);
      rewardCurrentPartyForNewDay(fact.evidence, days);
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
        if (!existing) {
          warnings.push(`item(${fact.action}) 已忽略：背包中的「${fact.name}」记录无效。`);
          continue;
        }
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
        const existing = projectedInventory[existingIndex];
        if (!existing) continue;
        push({ action: 'add', root: '背包', path: `items${buildTeyvatIdSelector(id)}.quantity`, value: fact.quantity }, fact.evidence);
        projectedInventory[existingIndex] = { ...existing, quantity: existing.quantity + fact.quantity };
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
      const canonical = matchCanonicalNpcFact(fact);
      const resolvedName = canonical?.name ?? fact.name;
      const id = requestedId && isTeyvatStableId(requestedId) ? requestedId : npcIdFromName(resolvedName);
      const existing = state.NPC.find((entry) => entry.id === id || entry.姓名 === resolvedName || entry.aliases.includes(resolvedName)
        || (Boolean(canonical) && matchCanonicalIdentity({ id: entry.id, name: entry.姓名, aliases: entry.aliases })?.name === canonical?.name));
      if (!existing) {
        const affinity = 限制NPC好感度(fact.affinitySet ?? fact.affinityDelta ?? 0);
        push({ action: 'push', root: 'NPC', path: 'records', value: {
          id, 姓名: resolvedName, 地区: '', 身份: fact.intro ?? '', 天赋: [], 说明: fact.intro ?? '',
          aliases: Array.from(new Set([...(canonical?.aliases ?? []), ...(fact.alias ? [fact.alias] : [])])), roleTier: inferNpcTier(fact, canonical), affinity,
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
      // 好感度（2026-09-29 第二轮，用户报「好感度变化还是不对」）：
      // 模型经常把提示里印出的当前好感原样回显成 `affinitySet`/`好感度`，而旧实现是
      // `set` 优先于 `add` —— 一次回显就把本回合真实的 +/- 整个抹掉（实测 120 → 120，而不是 123）。
      // 现在：同时出现时**增量优先**（增量表达「变了多少」，绝对覆盖只在确有必要时才用）。
      if (typeof fact.affinityDelta === 'number' && typeof fact.affinitySet === 'number'
        && fact.affinitySet !== 0 && (existing.affinity ?? 0) !== 0) {
        push({ action: 'add', root: 'NPC', path: `${prefix}.affinity`, value: fact.affinityDelta }, fact.evidence);
        warnings.push(`affinity: 已忽略 ${existing.姓名} 的绝对值 ${fact.affinitySet}（与增量 ${fact.affinityDelta} 同时出现，按增量结算）。`);
      } else if (typeof fact.affinitySet === 'number') {
        // 绝对值覆盖：高于生死挚友门槛（>100）的角色**不得被一次变量结算压低** ——
        // 模型回显/猜一个更小的数就能把关系打回去，是比「增量丢失」更严重的缺陷（实测 140 → 20）。
        const currentAffinity = existing.affinity ?? 0;
        if (currentAffinity > NPC_AFFINITY_DEAREST_FRIEND_THRESHOLD && fact.affinitySet < currentAffinity) {
          warnings.push(`affinity: 已拒绝把 ${existing.姓名} 的好感度从 ${currentAffinity} 改成 ${fact.affinitySet}（生死挚友不因一次变量结算下降）。`);
        } else {
          push({ action: 'set', root: 'NPC', path: `${prefix}.affinity`, value: fact.affinitySet }, fact.evidence);
        }
      } else if (typeof fact.affinityDelta === 'number') {
        push({ action: 'add', root: 'NPC', path: `${prefix}.affinity`, value: fact.affinityDelta }, fact.evidence);
      }
      if (typeof fact.intimateRelationship === 'boolean') push({ action: 'set', root: 'NPC', path: `${prefix}.intimate`, value: fact.intimateRelationship }, fact.evidence);
      if (typeof fact.following === 'boolean') push({ action: 'set', root: 'NPC', path: `${prefix}.travelingTogether`, value: fact.following }, fact.evidence);
      if (fact.playerAddress) push({ action: 'set', root: 'NPC', path: `${prefix}.playerAddress`, value: fact.playerAddress }, fact.evidence);
      if (fact.appearance) push({ action: 'set', root: 'NPC', path: `${prefix}.appearance`, value: fact.appearance }, fact.evidence);
      if (fact.clothing && shouldReplaceUsualClothing(existing.clothing, fact.clothing, fact.evidence ?? '')) {
        push({ action: 'set', root: 'NPC', path: `${prefix}.clothing`, value: fact.clothing }, fact.evidence);
      }
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
      // 只有事实名命中原著库时才做规范化名比较：否则 `undefined === undefined` 会把任意两个
      // 非原著角色判成同一身份，命中硬闸对象的 nsfw_archive 因此被写到列表里第一个 NPC 身上。
      const factCanonicalName = matchCanonical(fact.npcName)?.name;
      let existing = state.NPC.find((entry) => entry.id === id || entry.姓名 === fact.npcName || entry.aliases.includes(fact.npcName)
        || (factCanonicalName !== undefined && matchCanonical(entry.姓名)?.name === factCanonicalName));
      const canonicalBaselineAge = getCanonicalArchiveBaselineAge(existing?.姓名 ?? fact.npcName);
      const eligibility = resolveNpcAdultEligibility({
        name: existing?.姓名 ?? fact.npcName, aliases: existing?.aliases,
        description: [existing?.说明, existing?.appearance, ...(existing?.notes ?? [])].filter(Boolean).join(' '),
        ageConfirmation: existing?.matureArchive?.ageConfirmation,
        ageSource: existing?.matureArchive?.ageConfirmationSource,
        canonicalBaselineAge,
      });
      if (!eligibility.confirmed) {
        warnings.push(`nsfw_archive 已忽略：${eligibility.reason}。`);
        continue;
      }
      if (!existing) {
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
      if (existing) {
        const currentFirstPartner = existing.matureArchive;
        const hasFirstPartner = Boolean(currentFirstPartner?.firstSexualPartnerRef || currentFirstPartner?.firstSexualPartnerSource
          || (currentFirstPartner?.firstSexualPartner && currentFirstPartner.firstSexualPartner !== '无'));
        push({ action: 'set', root: 'NPC', path: `${buildTeyvatIdSelector(existing.id)}.matureArchive`, value: {
          ...(existing.matureArchive ?? { preferences: [], sensitivePoints: [], taboos: [], femaleBodyProfile: {}, maleBodyProfile: {}, experiences: [], longTermFacts: [], tags: [], partImages: {} }),
          enabled: fact.enabled ?? existing.matureArchive?.enabled ?? true,
          ageConfirmation: 'adult',
          ageConfirmationSource: canonicalBaselineAge === 'adult' ? 'canonical' : existing.matureArchive?.ageConfirmationSource,
          intimacyStage: fact.intimacyStage ?? existing.matureArchive?.intimacyStage,
          boundaries: fact.boundaries ?? existing.matureArchive?.boundaries,
          ...(existing.gender === '女' ? {
            // 常用内衣只允许女性角色写入；未提供时保留旧值（首部已展开现有档案）。
            ...(fact.usualUnderwear ? { usualUnderwear: fact.usualUnderwear } : {}),
            virginityStatus: fact.virginityStatus ?? existing.matureArchive?.virginityStatus,
            firstSexualPartner: hasFirstPartner ? currentFirstPartner?.firstSexualPartner : fact.firstSexualPartner,
            firstSexualPartnerRef: hasFirstPartner ? currentFirstPartner?.firstSexualPartnerRef : fact.firstSexualPartnerRef,
            firstSexualPartnerSource: hasFirstPartner ? currentFirstPartner?.firstSexualPartnerSource : fact.firstSexualPartnerSource,
            firstSexualPartnerTurn: hasFirstPartner ? currentFirstPartner?.firstSexualPartnerTurn : fact.firstSexualPartnerTurn,
          } : {}),
          preferences: fact.preferences ?? existing.matureArchive?.preferences ?? [], sensitivePoints: fact.sensitivePoints ?? existing.matureArchive?.sensitivePoints ?? [],
          taboos: fact.taboos ?? existing.matureArchive?.taboos ?? [], experiences: mergeUniqueTexts(existing.matureArchive?.experiences, fact.experiences) ?? [],
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
