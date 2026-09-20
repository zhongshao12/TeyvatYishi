import type { NPC关系阶段, NPC记录 } from '@/models/npc';
import { buildNpcMemoryLedgerView, 创建NPC记录, 格式化NPC关系, 获取NPC关系阶段, 获取NPC兼容关系, 读取NPC头像, 限制NPC好感度 } from '@/models/npc';
import { getDefaultBuiltinAvatar } from '@/data/builtinAvatars';
import { matchCanonical } from '@/data/canonicalCharacters';
import { normalizeCourierConversation, normalizeCourierSystem, type CourierContact, type CourierConversation, type CourierDeliverySeed, type CourierMessage, type CourierSystem } from '@/models/teyvat/courier';
import type { 提示词模块 } from '@/models/prompts';
import { buildIndependentPromptModulesSection } from '@/services/promptModuleScopes';

export function buildCourierPromptModulesSection(promptModules?: 提示词模块[]): string {
  return buildIndependentPromptModulesSection(promptModules, 'courier');
}

export function calculateCourierUnread(system: Pick<CourierSystem, 'conversations' | 'deliverySeeds'>): number {
  const conversationUnread = system.conversations.reduce((total, conversation) => total + Math.max(0, Math.trunc(conversation.unread) || 0), 0);
  const pendingSeeds = system.deliverySeeds.filter((seed) => seed.status === 'pending').length;
  return conversationUnread + pendingSeeds;
}

export function appendCourierMessage(system: CourierSystem, conversationId: string, message: CourierMessage): CourierSystem {
  const conversations = system.conversations.map((conversation) => conversation.id !== conversationId
    ? conversation
    : conversation.messages.some((existing) => existing.id === message.id)
      ? conversation
      : {
          ...conversation,
          messages: [...conversation.messages, { ...message, readBy: [...message.readBy] }],
          unread: conversation.unread + 1,
          updatedAt: Math.max(conversation.updatedAt, message.timestamp),
        });
  return { ...system, conversations, unreadTotal: calculateCourierUnread({ conversations, deliverySeeds: system.deliverySeeds }) };
}

const courierReplyInFlight = new Set<string>();

/** Prevent the immediate UI path and the post-turn background path from replying to the same snapshot. */
export function beginCourierReply(conversationId: string): boolean {
  if (!conversationId || courierReplyInFlight.has(conversationId)) return false;
  courierReplyInFlight.add(conversationId);
  return true;
}

export function endCourierReply(conversationId: string): void {
  courierReplyInFlight.delete(conversationId);
}

export function isCourierReplyInFlight(conversationId: string): boolean {
  return courierReplyInFlight.has(conversationId);
}

/**
 * Apply a task result to the newest phone state. The task's input snapshot is
 * used only to compute unread deltas; live messages, typing state and user UI
 * edits are never replaced by a stale object graph.
 */
export function mergeCourierSystemUpdates(
  current: CourierSystem,
  taskBase: CourierSystem,
  taskResult: CourierSystem,
): CourierSystem {
  const baseById = new Map(taskBase.conversations.map((conversation) => [conversation.id, conversation]));
  const currentById = new Map(current.conversations.map((conversation) => [conversation.id, conversation]));
  const resultById = new Map(taskResult.conversations.map((conversation) => [conversation.id, conversation]));
  const conversationIds = Array.from(new Set([
    ...current.conversations.map((conversation) => conversation.id),
    ...taskResult.conversations.map((conversation) => conversation.id),
  ]));
  const conversations = conversationIds.flatMap((id) => {
    const live = currentById.get(id);
    const result = resultById.get(id);
    if (!live) return result ? [{ ...result, messages: result.messages.map((message) => ({ ...message, readBy: [...message.readBy] })) }] : [];
    if (!result) return [live];
    const messageIds = new Set(live.messages.map((message) => message.id));
    const appended = result.messages
      .filter((message) => !messageIds.has(message.id))
      .map((message) => ({ ...message, readBy: [...message.readBy] }));
    const baseUnread = baseById.get(id)?.unread ?? 0;
    const unreadDelta = Math.max(0, result.unread - baseUnread);
    return [{
      ...live,
      messages: [...live.messages, ...appended],
      unread: live.unread + unreadDelta,
      updatedAt: Math.max(live.updatedAt, result.updatedAt),
    }];
  });

  const mergeById = <T extends { id: string }>(live: readonly T[], result: readonly T[]): T[] => {
    const map = new Map(result.map((item) => [item.id, item]));
    for (const item of live) map.set(item.id, item);
    return Array.from(map.values());
  };
  const resultSeeds = new Map(taskResult.deliverySeeds.map((seed) => [seed.id, seed]));
  for (const seed of current.deliverySeeds) {
    if (!resultSeeds.has(seed.id)) resultSeeds.set(seed.id, seed);
  }
  const contacts = normalizeCourierSystem({ contacts: [...current.contacts, ...taskResult.contacts] }).contacts;
  const deliverySeeds = Array.from(resultSeeds.values());
  const merged = {
    ...current,
    contacts,
    letters: mergeById(current.letters, taskResult.letters),
    conversations,
    deliverySeeds,
  };
  return { ...merged, unreadTotal: calculateCourierUnread(merged) };
}

/** 玩家维护群聊的唯一服务入口：始终保留玩家，并过滤不存在、重复的联系人。 */
export function updateCourierGroupConversation(
  system: CourierSystem,
  conversationId: string,
  input: { title: string; memberIds: string[] },
): CourierSystem {
  const validContactIds = new Set(system.contacts.map((contact) => contact.id));
  const memberIds = Array.from(new Set(input.memberIds.map((id) => id.trim()).filter((id) => validContactIds.has(id))));
  const conversations = system.conversations.map((conversation) => {
    if (conversation.id !== conversationId || conversation.type !== 'group') return conversation;
    return {
      ...conversation,
      title: input.title.trim() || conversation.title || '未命名群聊',
      participantIds: ['player', ...memberIds],
      typingMemberIds: conversation.typingMemberIds.filter((id) => memberIds.includes(id)),
      updatedAt: Date.now(),
    };
  });
  return { ...system, conversations, unreadTotal: calculateCourierUnread({ conversations, deliverySeeds: system.deliverySeeds }) };
}

/** 解散玩家创建的群聊；联系人和其他会话保持不变。 */
export function dissolveCourierGroupConversation(
  system: CourierSystem,
  conversationId: string,
  requesterId = 'player',
): CourierSystem {
  const target = system.conversations.find((conversation) => conversation.id === conversationId);
  if (!target || target.type !== 'group') return system;
  if (target.creatorId && target.creatorId !== requesterId) return system;
  const conversations = system.conversations.filter((conversation) => conversation.id !== conversationId);
  const deliverySeeds = system.deliverySeeds.filter((seed) => seed.targetId !== conversationId);
  return {
    ...system,
    conversations,
    deliverySeeds,
    unreadTotal: calculateCourierUnread({ conversations, deliverySeeds }),
  };
}

/** 只有已经与玩家建立可证明关系的角色，才允许从同伴档案手动加入手机。 */
export function canAddNpcToCourierContacts(npc: NPC记录): boolean {
  return npc.阶位 === 'companion'
    || npc.同行
    || npc.好感度 !== 0
    || Boolean(npc.亲密关系)
    || Boolean(npc.最近互动?.trim())
    || Boolean(npc.同行记忆?.length)
    || Boolean(npc.共同经历?.length);
}

/** 将已经建立关系的同伴加入手机；按 NPC id/姓名统一去重。 */
export function addNpcToCourierContacts(system: CourierSystem, npc: NPC记录): CourierSystem {
  const name = npc.姓名.trim();
  if (!name || !canAddNpcToCourierContacts(npc)) return system;
  const existing = system.contacts.find((contact) => contact.npcId === npc.id || contact.name === name);
  if (existing) {
    const contacts = system.contacts.map((contact) => contact !== existing ? contact : {
      ...contact,
      npcId: npc.id,
      name,
      available: true,
      status: 'available' as const,
    });
    return normalizeCourierSystem({ ...system, contacts });
  }
  const avatar = 读取NPC头像(npc, '手机') || 读取NPC头像(npc, '档案') || undefined;
  return normalizeCourierSystem({
    ...system,
    contacts: [...system.contacts, {
      id: `contact_${npc.id}`,
      npcId: npc.id,
      name,
      ...(avatar ? { avatar } : {}),
      relationLabel: 格式化NPC关系(npc.好感度, Boolean(npc.亲密关系)),
      available: true,
      status: 'available',
      unlockSource: 'manual',
      lastActiveTurn: npc.最近回合,
    }],
  });
}

export function consumeCourierSeed(system: CourierSystem, seedId: string): CourierSystem {
  const deliverySeeds = system.deliverySeeds.map((seed): CourierDeliverySeed => seed.id === seedId && seed.status === 'pending'
    ? { ...seed, status: 'generated' }
    : seed);
  return { ...system, deliverySeeds, unreadTotal: calculateCourierUnread({ conversations: system.conversations, deliverySeeds }) };
}

// ── 来信正文生成 ─────────────────────────────────────────────
// 种子（deliverySeed）里存的是「事件描述 / 投递指令」，绝不是信件原文。
// 送到收件夹前必须把它改写成寄件人视角的书信；禁止把 seed.context 原文照抄。

export interface CourierSenderProfile {
  name: string;
  playerAddress?: string;
  personality?: string;
  speechStyle?: string;
  affinityLabel?: string;
  /** 好感度数值（-50..150），用于派生关系阶段、决定称呼与语气温度。 */
  affinity?: number;
  background?: string;
  recentMemories?: string[];
  summaryMemories?: string[];
  recentInteraction?: string;
  longTermImpression?: string;
  sharedExperiences?: string[];
  unfinishedBusiness?: string[];
  unresolvedConflicts?: string[];
  mustRemember?: string[];
  recentMessages?: string[];
}

/** 从 NPC 账本与当前会话生成手机模型唯一使用的人物上下文。 */
export function buildCourierSenderProfile(
  npc: NPC记录 | undefined,
  conversation?: Pick<CourierConversation, 'messages'>,
  fallbackName = '联系人',
): CourierSenderProfile {
  const ledger = npc ? buildNpcMemoryLedgerView(npc, 6) : null;
  const canonical = matchCanonical(npc?.姓名?.trim() || fallbackName);
  const canonicalBackground = canonical
    ? [canonical.appearance, canonical.aliases?.length ? `常用身份或别名：${canonical.aliases.join('、')}` : '']
      .filter(Boolean)
      .join('；')
    : '';
  return {
    name: npc?.姓名?.trim() || canonical?.name || fallbackName,
    ...(npc?.对玩家称呼?.trim() ? { playerAddress: npc.对玩家称呼.trim() } : {}),
    ...(npc?.性格?.trim() || canonical?.personality ? { personality: npc?.性格?.trim() || canonical?.personality } : {}),
    ...(npc?.说话方式?.trim() ? { speechStyle: npc.说话方式.trim() } : {}),
    ...(npc?.介绍?.trim() || canonicalBackground ? { background: npc?.介绍?.trim() || canonicalBackground } : {}),
    ...(npc ? { affinityLabel: 格式化NPC关系(npc.好感度, Boolean(npc.亲密关系)), affinity: npc.好感度 } : {}),
    recentMemories: ledger?.最近原始记忆 ?? [],
    summaryMemories: ledger?.总结记忆.map((item) => item.摘要).filter(Boolean) ?? [],
    ...(ledger?.最近互动 ? { recentInteraction: ledger.最近互动 } : {}),
    ...(ledger?.对玩家长期印象 ? { longTermImpression: ledger.对玩家长期印象 } : {}),
    sharedExperiences: ledger?.共同经历 ?? [],
    unfinishedBusiness: ledger?.未完成事项 ?? [],
    unresolvedConflicts: ledger?.未解决冲突 ?? [],
    mustRemember: [...(ledger?.必须记得 ?? []), ...(ledger?.禁止遗忘 ?? [])],
    recentMessages: (conversation?.messages ?? [])
      .slice(-8)
      .map((message) => `${message.senderName || (message.senderId === 'player' ? '旅行者' : message.senderId)}：${message.content.trim()}`)
      .filter((line) => !line.endsWith('：')),
  };
}

export interface CourierContactNpcRegistrationInput {
  contactId: string;
  npcId?: string;
  name: string;
  turn: number;
}

/** 首次手机聊天时补建联系人档案，使第一轮对话即可回写同行记忆。 */
export function ensureCourierContactNpcRecord(
  npcs: NPC记录[],
  input: CourierContactNpcRegistrationInput,
): NPC记录[] {
  const name = input.name.trim() || '未知联系人';
  const existing = npcs.find((npc) =>
    (input.npcId && npc.id === input.npcId)
    || npc.id === input.contactId
    || npc.姓名 === name
    || npc.别名 === name);
  if (existing) return npcs;

  const canonical = matchCanonical(name);
  const avatar = getDefaultBuiltinAvatar(canonical?.name || name);
  const created = 创建NPC记录({
    姓名: canonical?.name || name,
    阶位: canonical ? 'companion' : 'extra',
    初见回合: Math.max(1, Math.trunc(input.turn) || 1),
    ...(canonical?.aliases?.length ? { 别名: canonical.aliases.join(' / ') } : {}),
    ...(canonical?.gender ? { 性别: canonical.gender } : {}),
    ...(canonical?.appearance ? { 外貌: canonical.appearance } : {}),
    ...(canonical?.personality ? { 性格: canonical.personality } : {}),
    介绍: canonical
      ? `${canonical.name}的原著角色基础档案；首次通过手机建立同行记忆账本。`
      : '首次通过手机建立同行记忆账本。',
    ...(avatar ? { 头像: avatar } : {}),
    原著角色: Boolean(canonical),
  });
  return [...npcs, { ...created, id: input.npcId?.trim() || input.contactId }];
}

export interface PhoneExchangeMemoryInput {
  npcId: string;
  conversationId: string;
  exchangeId: string;
  turn: number;
  playerText?: string;
  replyTexts: string[];
  relatedNpcIds?: string[];
}

/** 将一次完整手机交流写回对应 NPC 的同行记忆；确定性 id 使后台任务重跑时保持幂等。 */
export function appendPhoneExchangeMemory(npcs: NPC记录[], input: PhoneExchangeMemoryInput): NPC记录[] {
  const memoryId = `phone_${input.conversationId}_${input.exchangeId}_${input.npcId}`;
  return npcs.map((npc) => {
    if (npc.id !== input.npcId) return npc;
    const memories = npc.同行记忆 ?? [];
    if (memories.some((memory) => memory.id === memoryId)) return npc;
    const playerText = input.playerText?.replace(/\s+/g, ' ').trim() || '';
    const replyText = input.replyTexts.map((text) => text.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ');
    const original = [playerText ? `旅行者：${playerText}` : '', replyText ? `${npc.姓名}：${replyText}` : '']
      .filter(Boolean)
      .join('\n');
    const summary = playerText
      ? `通过手机与旅行者交谈：旅行者提到“${playerText.slice(0, 48)}”；${npc.姓名}回应“${replyText.slice(0, 64)}”。`
      : `${npc.姓名}通过手机发来消息：“${replyText.slice(0, 96)}”。`;
    const positive = /(谢谢|感谢|关心|想你|喜欢|爱你|抱歉|对不起|一起|陪你|辛苦|相信你|支持你)/u.test(playerText);
    const negative = /(讨厌|滚开|闭嘴|废物|威胁|不想见|别烦|恨你)/u.test(playerText);
    const affinityDelta = negative ? -2 : positive ? 2 : playerText ? 1 : 0;
    const 好感度 = 限制NPC好感度(npc.好感度 + affinityDelta);
    return {
      ...npc,
      好感度,
      关系: 获取NPC兼容关系(好感度),
      当前关系阶段: 获取NPC关系阶段(好感度),
      最近回合: Math.max(npc.最近回合 || 1, Math.max(1, Math.trunc(input.turn) || 1)),
      最近互动: summary,
      同行记忆: [
        ...memories,
        {
          id: memoryId,
          回合: Math.max(1, Math.trunc(input.turn) || 1),
          摘要: summary,
          ...(original ? { 原文: original } : {}),
          来源: '手机',
          ...(input.relatedNpcIds?.length ? { 关联NPCID: Array.from(new Set(input.relatedNpcIds)) } : {}),
        },
      ],
    };
  });
}

/** 将本轮已送达的主动手机消息按会话归并后写回各发件人的同行记忆。 */
export function appendPhoneDeliveryMemories(
  npcs: NPC记录[],
  system: Pick<CourierSystem, 'conversations' | 'contacts'>,
  seeds: CourierDeliverySeed[],
  turn: number,
): NPC记录[] {
  let updated = npcs;
  for (const seed of seeds) {
    const conversation = system.conversations.find((item) =>
      item.messages.some((message) => message.sourceSeedId === seed.id));
    if (!conversation) continue;
    const contact = system.contacts.find((item) => item.id === seed.senderId);
    const npc = updated.find((item) =>
      (contact?.npcId && item.id === contact.npcId)
      || item.id === seed.senderId
      || seed.relatedNpcIds.includes(item.id)
      || (contact?.name && item.姓名 === contact.name));
    if (!npc) continue;
    const replyTexts = conversation.messages
      .filter((message) => message.sourceSeedId === seed.id && message.senderId === seed.senderId)
      .map((message) => message.content);
    if (!replyTexts.length) continue;
    updated = appendPhoneExchangeMemory(updated, {
      npcId: npc.id,
      conversationId: conversation.id,
      exchangeId: seed.id,
      turn,
      replyTexts,
      relatedNpcIds: seed.relatedNpcIds.filter((id) => id !== npc.id),
    });
  }
  return updated;
}

/** 由好感度派生关系阶段；无数据时给出中性「熟识」，避免信件冷硬。 */
function resolveAffinityStage(affinity?: number): NPC关系阶段 {
  if (typeof affinity !== 'number' || !Number.isFinite(affinity)) return '熟识';
  return 获取NPC关系阶段(affinity);
}

type StageTone = 'hostile' | 'distant' | 'neutral' | 'warm' | 'close' | 'devoted';

function stageToTone(stage: NPC关系阶段): StageTone {
  switch (stage) {
    case '敌对': return 'hostile';
    case '陌生': return 'distant';
    case '初见': return 'neutral';
    case '熟识': return 'warm';
    case '知己': return 'close';
    case '生死挚友': return 'devoted';
    default: return 'neutral';
  }
}

export interface CourierLetterEnvironment {
  location?: string;
  timeText?: string;
  weather?: string;
}

export interface CourierLetterContext {
  seed: CourierDeliverySeed;
  sender?: CourierSenderProfile;
  environment?: CourierLetterEnvironment;
  travelerName?: string;
}

/** 从种子描述里提取「发生过什么事」：剥离投递指令式语句，只留事件本体。 */
function extractEventBasis(context: string): string {
  const raw = context.trim();
  if (!raw) return '';
  const factMark = raw.lastIndexOf('已发生事实');
  if (factMark >= 0) {
    const tail = raw.slice(factMark).replace(/^已发生事实[:：]?/, '').trim();
    if (tail) return tail;
  }
  // 逐句剥离元指令（提到投递/来信/种子/生成的句子都不是事件本身）。
  const sentences = raw.split(/(?<=[。！？!?；;])/).map((item) => item.trim()).filter(Boolean);
  const eventSentences = sentences.filter((item) => !/投递|来信|信件|种子|低频|生成|汇报|跟进|确认状况|window|seed|deliver/i.test(item));
  const merged = (eventSentences.length ? eventSentences : sentences).join('');
  return merged.replace(/^[:：、,，\s]+/, '').trim();
}

function hashText(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function pick<T>(items: readonly T[], seedText: string): T {
  const item = items[hashText(seedText) % items.length];
  if (item === undefined) throw new Error('手机消息模板列表不能为空。');
  return item;
}

// ── 关系阶段化称呼与落款 ─────────────────────────────────────
// 来信/回信的温度随好感阶段变化：敌对简短戒备，挚友亲昵挂念，避免千人一面。
/** 寄件人视角的近况/挂念句，按关系阶段增添私人温度（不照抄任何种子原文）。 */
const STAGE_PERSONAL_LINES: Record<StageTone, readonly string[]> = {
  hostile: ['话不多说，你我心里都有数。'],
  distant: ['我们算不上熟，但这事我觉得还是该告诉你。'],
  neutral: ['说起来，也有段日子没见你了。'],
  warm: ['上回分别后，我偶尔还会想起我们聊过的事。', '你不在的这段日子，我这儿倒也平静。'],
  close: ['上次一别，总想起你说过的那些话。', '有时候遇到有意思的事，第一个就想讲给你听。'],
  devoted: ['你不在身边，连风都像少了点什么。', '我常想起我们一起走过的路，那些日子是我最珍贵的记忆。'],
};

const TRIGGER_BODY_TEMPLATES: Record<CourierDeliverySeed['triggerType'], readonly string[]> = {
  injury: [
    '听说你{event}，我坐立难安。伤一定要先养好，旅途不会跑，可你要是倒下了，谁都没办法。',
    '听闻{event}，我心里很不是滋味。别逞强，先把伤养好——大家都在等你回来。',
  ],
  victory: [
    '{event}——干得漂亮！这份战绩我记下了，等下次见面，庆功的酒我来请。',
    '听到了{event}的消息，忍不住立刻跟你说：真有你的！',
  ],
  defeat: [
    '听闻{event}，胜败乃兵家常事，别太往心里去。调整好状态，我们下次再战。',
    '关于{event}……谁都有失手的时候。好好休息，来日方长。',
  ],
  location_change: [
    '听说你到了{place}。那边{weatherHint}多加小心，若是遇到有意思的事，记得告诉我。',
    '听说你一路走到了{place}。那里我也有许久没去，{weatherHint}路上千万当心。',
  ],
  important_item: [
    '关于{event}——那件东西非同小可，务必收好，别在人前显露。',
    '想起{event}，特意提醒你：重要之物要贴身收藏，小心起觊觎之心的人。',
  ],
  relationship: [
    '近来可好？{event}说起来，我还挺想念一起冒险的日子，有空聊聊近况。',
    '忽然想起{event}。你还记得吗？希望你那边一切都好。',
  ],
  steambird: [
    '《蒸汽鸟报》上登了{event}，众人议论纷纷。你既然在场，肯定比报上写的更清楚，跟我说说详情？',
    '报上都在传{event}的事。眼看风波不小，你务必谨慎行事。',
  ],
  quest: [
    '提醒一声：{event}。约定的事别忘了，我这边也都安排好了。',
    '关于{event}——时间不等人，若已有了眉目，记得给我个消息。',
  ],
  time: [
    '{timeHint}没有特别的事，只是想问候一声：旅途可还顺利？',
    '{timeHint}刚好想起你了。旅途还顺利吗？得空跟我说一声。',
  ],
  custom: [
    '有件事想告诉你：{event}。若有什么打算，和我说一声。',
    '近来惦记着一件事——{event}。你那边怎么看？',
  ],
};

/** 无事件可引时的兜底句：只依触发类型与寄件人，不照抄任何种子原文。 */
const TRIGGER_FALLBACK_LINES: Record<CourierDeliverySeed['triggerType'], readonly string[]> = {
  injury: ['听闻你在旅途中受了伤，我很挂念。请务必先把伤养好。'],
  victory: ['听说你打了一场漂亮仗，由衷为你高兴。'],
  defeat: ['听闻这回不太顺利，别放在心上，来日方长。'],
  location_change: ['听说你换了新的落脚处，一路辛苦了。'],
  important_item: ['有件要紧的东西想再叮嘱你一句：务必收好。'],
  relationship: ['许久没有你的消息，忽然有点想你了。近来还好吗？'],
  steambird: ['报纸上那些风言风语，你听听就好，别往心里去。'],
  quest: ['之前说好的事，别忘了。'],
  time: ['没有特别的事，只是想问候一声。'],
  custom: ['有件事想和你说一声。看到后回我一下？'],
};

/** 把种子改写成一封寄件人视角的书信（本地兜底版；不照抄 seed.context，随好感阶段变温度）。 */
export function composeCourierLetterLocally(context: CourierLetterContext): string {
  const { seed, sender, environment } = context;
  const senderName = sender?.name?.trim() || seed.senderId || '联系人';
  const address = sender?.playerAddress?.trim();
  const travelerName = context.travelerName?.trim() || '旅行者';
  const tone = stageToTone(resolveAffinityStage(sender?.affinity));
  const greeting = address
    ? `${address}，`
    : tone === 'close' || tone === 'devoted' ? `${travelerName}，` : '';

  const event = extractEventBasis(seed.context);
  const templates = TRIGGER_BODY_TEMPLATES[seed.triggerType] ?? TRIGGER_BODY_TEMPLATES.custom;
  const body = event
    ? pick(templates, `${seed.id}:${event}`).replace('{event}', event.length > 90 ? `${event.slice(0, 89)}…` : event)
    : pick(TRIGGER_FALLBACK_LINES[seed.triggerType] ?? TRIGGER_FALLBACK_LINES.custom, seed.id);

  const place = environment?.location?.trim();
  const weather = environment?.weather?.trim();
  const weatherHint = weather ? `${weather}，` : '';
  const bodyWithEnv = body
    .replace('{place}', place || '新的地方')
    .replace('{weatherHint}', weatherHint);
  // 只有关系够近的寄件人才添一句私人挂念，冷淡关系保持简短，信件温度贴合人设。
  const personalLine = tone === 'warm' || tone === 'close' || tone === 'devoted'
    ? pick(STAGE_PERSONAL_LINES[tone], `${seed.id}:personal`)
    : '';
  const memoryAnchor = sender?.unfinishedBusiness?.[0]
    || sender?.recentInteraction
    || sender?.sharedExperiences?.at(-1);
  const memoryLine = memoryAnchor && !bodyWithEnv.includes(memoryAnchor)
    ? `对了，${memoryAnchor.replace(/[。！？!?]+$/u, '')}，我还记着。`
    : '';

  return [greeting, personalLine, bodyWithEnv, memoryLine]
    .filter(Boolean)
    .join('\n');
}

// ── 玩家来信的回信 ───────────────────────────────────────────
// 玩家投递后，最后一条消息仍是玩家自己 —— 回信作业以此为信号：
// 每个会话最多回一封，回完后该会话不再命中，玩家再次来信才会再回。

export interface CourierReplyContext {
  conversation: CourierConversation;
  playerMessage: CourierMessage;
  sender?: CourierSenderProfile;
  environment?: CourierLetterEnvironment;
  travelerName?: string;
}

export interface CourierReplyCandidate {
  conversation: CourierConversation;
  playerMessage: CourierMessage;
  contactId: string;
}

/** 找出需要回信的会话：最后一条是玩家发送、非系统会话，且存在可回信的联系人。 */
export function findCourierReplyCandidates(
  system: CourierSystem,
  maxPerTurn = 2,
  includeInFlightIds: ReadonlySet<string> = new Set(),
): CourierReplyCandidate[] {
  const limit = Math.max(1, Math.trunc(maxPerTurn) || 1);
  const candidates: CourierReplyCandidate[] = [];
  const byRecent = [...system.conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  for (const conversation of byRecent) {
    if (candidates.length >= limit) break;
    if (conversation.type === 'system') continue;
    if (courierReplyInFlight.has(conversation.id) && !includeInFlightIds.has(conversation.id)) continue;
    const last = conversation.messages.at(-1);
    if (!last || last.senderId !== 'player' || !last.content.trim()) continue;
    const lastContactMessage = [...conversation.messages].reverse().find((message) => message.senderId !== 'player');
    const contactId = lastContactMessage?.senderId
      ?? conversation.participantIds.find((id) => id !== 'player');
    if (!contactId) continue;
    candidates.push({ conversation, playerMessage: last, contactId });
  }
  return candidates;
}

const REPLY_BODY_TEMPLATES = [
  '好，我记住了。等我忙完手边的事，就来找你。',
  '嗯，我懂你的意思。等我们碰面时，再慢慢说。',
  '知道啦。你先照顾好自己，剩下的交给我。',
  '好，这件事就这么说定了。你可别临时跑远。',
];

const REPLY_INVITATION_TEMPLATES = [
  '当然愿意！等你准备好，我们就一起去。',
  '好啊，算我一个。到时候记得来喊我。',
  '没问题，就这么约好了。你可不许偷偷先走。',
];

const REPLY_QUESTION_TEMPLATES = [
  '我看到啦。让我想想，等碰面时认真告诉你。',
  '嗯，我明白你在问什么。答案先留到见面时说。',
  '这个嘛，我心里已经有答案了。到时候你就知道啦。',
];

const REPLY_SHORT_TEMPLATES = [
  '看到啦。别担心，我这边都好。',
  '嗯，我在呢。没别的事，就是想让你知道：有人在惦记你。',
  '知道了。路上小心，常联系。',
];

/** 本地回信写作器：回应玩家来信内容，不照抄原文，随好感阶段变温度，保证无 API 时回信链路也成立。 */
export function composeCourierReplyLocally(context: CourierReplyContext): string {
  const address = context.sender?.playerAddress?.trim();
  const travelerName = context.travelerName?.trim() || '旅行者';
  const seedText = `${context.conversation.id}:${context.playerMessage.id}`;
  const tone = stageToTone(resolveAffinityStage(context.sender?.affinity));
  const greeting = address ? `${address}，` : (tone === 'close' || tone === 'devoted' ? `${travelerName}，` : '');

  const playerText = context.playerMessage.content.replace(/\s+/g, ' ').trim();
  const isInvitation = /一起|陪我|愿意|约好|要不要|能不能|可以吗|好吗/u.test(playerText);
  const isQuestion = /[？?]|怎么|什么|哪里|为何|为什么|是否/u.test(playerText);
  const body = playerText.length < 6
    ? pick(REPLY_SHORT_TEMPLATES, seedText)
    : isInvitation
      ? pick(REPLY_INVITATION_TEMPLATES, seedText)
      : isQuestion
        ? pick(REPLY_QUESTION_TEMPLATES, seedText)
        : pick(REPLY_BODY_TEMPLATES, seedText);

  const personalLine = tone === 'close' || tone === 'devoted'
    ? pick(STAGE_PERSONAL_LINES[tone], `${seedText}:personal`)
    : '';
  const memoryAnchor = context.sender?.unfinishedBusiness?.[0]
    || context.sender?.recentInteraction
    || context.sender?.sharedExperiences?.at(-1);
  const memoryLine = memoryAnchor
    ? `还有，${memoryAnchor.replace(/[。！？!?]+$/u, '')}这件事，我可没忘。`
    : '';
  return [greeting, body, personalLine, memoryLine]
    .filter(Boolean)
    .join('\n');
}

// ── 群聊：多人跟帖回信 ───────────────────────────────────────
// 普通群消息与 @全体成员 由全员接话；使用单独 @ 时收束为被点名者与至多两位旁听成员，
// 旁听成员按消息稳定变化，保证打字指示与最终气泡保持一致。

/**
 * 选出本条玩家消息会跟帖的群成员：普通消息全员回复；有 @ 时，
 * 所有被点名者加至多两位按消息稳定选出的未点名成员回复。
 */
export function selectGroupReplyMembers(
  conversation: Pick<CourierConversation, 'id' | 'participantIds'>,
  playerMessage: Pick<CourierMessage, 'id'> & Partial<CourierMessage>,
  maxMembers = 3,
  contacts: readonly Pick<CourierContact, 'id' | 'name'>[] = [],
): string[] {
  const members = conversation.participantIds.filter((id) => id !== 'player');
  if (!members.length) return [];
  // 保留参数以兼容既有调用；当前产品规则明确要求普通群消息由全员回应。
  void maxMembers;
  const seedBase = `${conversation.id}:${playerMessage.id}`;
  // 稳定打乱：同一玩家消息得到的成员顺序可复现，便于打字指示与回帖保持一致。
  const ranked = [...members].sort((a, b) => hashText(`${seedBase}:${a}`) - hashText(`${seedBase}:${b}`));
  if (/[@＠]全体成员(?=\s|$|[，。！？、,.!?])/u.test(playerMessage.content ?? '')) return ranked;
  const mentioned = contacts
    .filter((contact) => members.includes(contact.id) && new RegExp(`[@＠]${contact.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$|[，。！？、,.!?])`, 'u').test(playerMessage.content ?? ''))
    .map((contact) => contact.id);
  if (!mentioned.length) return ranked;
  const bystanders = ranked.filter((memberId) => !mentioned.includes(memberId)).slice(0, 2);
  return [...mentioned, ...bystanders];
}

export interface CourierGroupReplyContext {
  conversation: CourierConversation;
  playerMessage: CourierMessage;
  sender?: CourierSenderProfile;
  travelerName?: string;
}

const GROUP_REPLY_OPENERS: Record<StageTone, readonly string[]> = {
  hostile: ['……', '哼，', ''],
  distant: ['', '嗯，'],
  neutral: ['', '唔，'],
  warm: ['哎，', '哈，'],
  close: ['哈哈，', '诶，'],
  devoted: ['诶，', '嗯，'],
};

const GROUP_REPLY_BODIES: readonly string[] = [
  '关于「{quote}」，我愿意认真说说自己的想法。',
  '既然你说到「{quote}」，那也听听大家各自的心意吧。',
  '「{quote}」——我会按自己的方式回应，也会尊重大家。',
  '这件事关系到「{quote}」，可不能只用一句玩笑带过呀。',
  '{traveler}，关于「{quote}」，我想先把自己的态度说清楚。',
];

const GROUP_RELATIONSHIP_BODIES: readonly string[] = [
  '突然把关系说得这么直白……我会认真回应，但你也要好好听每个人自己的心意。',
  '这种称呼可不能替大家一口决定呀。先彼此尊重、把话说开，我再告诉你我的答案。',
  '想让大家好好相处，光靠一句宣告可不够。你得认真珍惜每个人不同的心意。',
];

/**
 * 群内单个成员的跟帖回复（本地兜底）：一条口语化短消息，引用玩家来信的片段，
 * 语气随该成员与旅行者的好感阶段变化。聊天消息自带署名，无需落款。
 */
export function composeCourierGroupReplyLocally(context: CourierGroupReplyContext): string {
  const travelerName = context.travelerName?.trim() || '旅行者';
  const seedText = `${context.conversation.id}:${context.playerMessage.id}:${context.sender?.name ?? ''}`;
  const tone = stageToTone(resolveAffinityStage(context.sender?.affinity));
  const opener = pick(GROUP_REPLY_OPENERS[tone], seedText);
  const playerText = context.playerMessage.content
    .replace(/[@＠][^\s，。！？、,.!?]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const quote = playerText.slice(0, 20);
  const relationshipTopic = /老婆|老公|恋人|爱你|喜欢你|在一起|好好相处/u.test(playerText);
  const body = relationshipTopic
    ? pick(GROUP_RELATIONSHIP_BODIES, seedText)
    : (quote ? pick(GROUP_REPLY_BODIES, seedText) : '我在听，也会认真回应大家正在聊的事。');
  const memoryAnchor = context.sender?.unfinishedBusiness?.[0]
    || context.sender?.recentInteraction
    || context.sender?.sharedExperiences?.at(-1);
  const memoryTail = memoryAnchor
    ? ` 至于${memoryAnchor.replace(/[。！？!?]+$/u, '')}，我也没有忘。`
    : '';
  return `${opener}${body.replace('{quote}', quote).replace('{traveler}', travelerName)}${memoryTail}`.trim();
}

// ── 手机消息拆条：一句一句话 ─────────────────────────────────

function splitOutsideChineseQuotes(line: string): string[] {
  const sentences: string[] = [];
  const openingQuotes = new Set(['「', '『', '“', '‘']);
  const closingQuotes = new Set(['」', '』', '”', '’']);
  let quoteDepth = 0;
  let buffer = '';
  for (const char of line) {
    buffer += char;
    if (openingQuotes.has(char)) {
      quoteDepth += 1;
      continue;
    }
    if (closingQuotes.has(char)) {
      quoteDepth = Math.max(0, quoteDepth - 1);
      continue;
    }
    // 省略号常用于把引用或停顿接到后半句，单独切开会产生“……”碎气泡。
    if (quoteDepth === 0 && /[。！？!?]/u.test(char)) {
      sentences.push(buffer.trim());
      buffer = '';
    }
  }
  if (buffer.trim()) sentences.push(buffer.trim());
  return sentences;
}

/** 把完整手机回复拆成逐句消息；中文引号中的句读保持在同一气泡内。 */
export function splitLetterIntoLines(letter: string): string[] {
  const parts: string[] = [];
  for (const rawLine of letter.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    // 短行整行保留。
    if (line.startsWith('——') || line.length <= 30) {
      parts.push(line);
      continue;
    }
    const sentences = splitOutsideChineseQuotes(line);
    let buffer = '';
    for (const rawSentence of sentences) {
      const sentence = rawSentence.trim();
      if (!sentence) continue;
      if (!buffer) {
        buffer = sentence;
        continue;
      }
      // 相邻短句合并，避免一字一条；超长句各自成条。
      if (buffer.length < 10 && (buffer + sentence).length <= 48) {
        buffer += sentence;
        continue;
      }
      parts.push(buffer);
      buffer = sentence;
    }
    if (buffer) parts.push(buffer);
  }
  const trimmed = letter.trim();
  return parts.length ? parts.slice(0, 12) : (trimmed ? [trimmed] : []);
}

// ── 定时投递：自动建档 + 单人单窗口 ──────────────────────────

export interface CourierDeliveryContext {
  npcs?: NPC记录[];
  environment?: CourierLetterEnvironment;
  travelerName?: string;
}

export interface ScheduledCourierResult {
  next: CourierSystem;
  due: CourierDeliverySeed[];
}

function deriveSenderName(seed: CourierDeliverySeed, npc: NPC记录 | undefined): string {
  if (npc?.姓名?.trim()) return npc.姓名.trim();
  const fromTitle = seed.title?.trim().match(/^(.+?)(?:的(?:跟进)?来信|来信)$/);
  if (fromTitle?.[1]?.trim() && fromTitle[1].trim() !== '定时') return fromTitle[1].trim();
  if (seed.title?.trim()) return seed.title.trim();
  return seed.senderId || '未知信使';
}

function buildContactForSeed(seed: CourierDeliverySeed, npc: NPC记录 | undefined, senderName: string): import('@/models/teyvat/courier').CourierContact {
  const avatar = npc ? 读取NPC头像(npc, '手机') || 读取NPC头像(npc, '档案') : getDefaultBuiltinAvatar(senderName);
  return {
    id: seed.senderId,
    name: senderName,
    available: true,
    unlockSource: 'story',
    ...(npc?.id ? { npcId: npc.id } : {}),
    ...(avatar ? { avatar } : {}),
    ...(npc ? { relationLabel: 格式化NPC关系(npc.好感度, Boolean(npc.亲密关系)) } : {}),
  };
}

/**
 * 把到期种子投递进收件夹：
 * 1. 寄件人不在联系人列表时自动建档（NPC 档案 / 原著头像兜底）；
 * 2. 同一寄件人永远复用同一个会话窗口（先按参与人找，再按旧 targetId 兼容）；
 * 3. 信件正文一律由种子改写生成，绝不照抄 seed.context。
 */
export function deliverDueCourierSeeds(
  system: CourierSystem,
  currentTurn: number,
  now = Date.now(),
  context: CourierDeliveryContext = {},
): ScheduledCourierResult {
  // Runtime state is already canonical. Re-normalizing the whole phone here
  // cloned every message in every conversation before and after one delivery.
  const normalizedSystem = system;
  const npcByName = new Map<string, NPC记录>();
  for (const npc of context.npcs ?? []) {
    if (npc.姓名 && !npcByName.has(npc.姓名)) npcByName.set(npc.姓名, npc);
    if (npc.别名 && !npcByName.has(npc.别名)) npcByName.set(npc.别名, npc);
  }

  const due: CourierDeliverySeed[] = [];
  const deliverySeeds = normalizedSystem.deliverySeeds.map((seed) => {
    const dueTurn = seed.scheduledAtTurn ?? seed.turn;
    if (seed.status !== 'pending' || currentTurn < dueTurn) return seed;
    due.push(seed);
    return { ...seed, status: 'generated' as const };
  });
  if (!due.length) return { next: normalizedSystem, due };

  let contacts = [...normalizedSystem.contacts];
  let conversations = [...normalizedSystem.conversations];

  for (const seed of due) {
    const npc = npcByName.get(seed.senderId)
      ?? (context.npcs ?? []).find((item) => item.id === seed.senderId)
      ?? seed.relatedNpcIds.map((id) => (context.npcs ?? []).find((item) => item.id === id)).find(Boolean);
    const knownContact = contacts.find((contact) => contact.id === seed.senderId)
      ?? (npc ? contacts.find((contact) => contact.npcId === npc.id) : undefined)
      ?? contacts.find((contact) => contact.name.trim() === deriveSenderName(seed, npc));
    const senderName = knownContact?.name?.trim() || deriveSenderName(seed, npc);
    const senderId = knownContact?.id ?? seed.senderId;
    if (!knownContact) {
      contacts = [...contacts, buildContactForSeed(seed, npc, senderName)];
    }

    // 私聊种子只能进入私聊，不能因为寄件人也在某个群里就误投进群聊。
    // 群聊种子优先使用明确 targetId，再退回到包含寄件人的同类型群。
    let conversationIndex = seed.targetType === 'group'
      ? conversations.findIndex((conversation) => conversation.type === 'group' && conversation.id === seed.targetId)
      : conversations.findIndex((conversation) => conversation.type === 'private' && conversation.participantIds.includes(senderId));
    if (conversationIndex < 0) {
      conversationIndex = seed.targetType === 'group'
        ? conversations.findIndex((conversation) => conversation.type === 'group' && conversation.participantIds.includes(senderId))
        : conversations.findIndex((conversation) => conversation.type === 'private' && conversation.id === seed.targetId);
    }
    if (conversationIndex < 0) {
      const participantIds = Array.from(new Set(['player', senderId, ...seed.relatedNpcIds].filter(Boolean)));
      conversations.push({
        id: `courier_conv_${senderId}`,
        title: senderName,
        participantIds,
        messages: [],
        unread: 0,
        type: seed.targetType,
        typingMemberIds: [],
        updatedAt: now,
      });
      conversationIndex = conversations.length - 1;
    }
    const conversation = conversations[conversationIndex];
    const dueTurn = seed.scheduledAtTurn ?? seed.turn;
    const contactAvatar = (contacts.find((contact) => contact.id === senderId)?.avatar)
      ?? (npc ? 读取NPC头像(npc, '手机') || 读取NPC头像(npc, '档案') : getDefaultBuiltinAvatar(senderName));
    const letter = composeCourierLetterLocally({
      seed,
      sender: buildCourierSenderProfile(npc, conversation, senderName),
      environment: context.environment,
      travelerName: context.travelerName,
    });
    // 一句一句话：信件按句读拆成多条消息依次投递。
    const letterLines = splitLetterIntoLines(letter);
    const deliveredMessages = letterLines.map((text, lineIndex) => ({
      id: `courier_seed_message_${seed.id}_${lineIndex}`,
      senderId,
      senderName,
      role: 'contact' as const,
      content: text,
      turn: currentTurn,
      timestamp: now + lineIndex,
      ...(contactAvatar ? { avatar: contactAvatar } : {}),
      sourceSeedId: seed.id,
      readBy: [] as string[],
      scheduledAtTurn: dueTurn,
      deliveredAtTurn: currentTurn,
    }));
    if (!conversation) continue;
    const updatedConversation: CourierConversation = {
      ...conversation,
      title: conversation.title || senderName,
      messages: [...conversation.messages, ...deliveredMessages],
      unread: conversation.unread + 1,
      updatedAt: now + Math.max(0, deliveredMessages.length - 1),
    };
    conversations[conversationIndex] = normalizeCourierConversation(updatedConversation) ?? updatedConversation;
  }

  const next = {
    ...normalizedSystem,
    contacts,
    conversations,
    deliverySeeds,
    unreadTotal: calculateCourierUnread({ conversations, deliverySeeds }),
  };
  return {
    next,
    due,
  };
}

// ── 来信发件人建档 ───────────────────────────────────────────
// 信使引入的新角色（联系人）同步落成 NPC 路人档案，让其进入同伴面板与后续剧情。

export interface CourierSenderRegistrationInput {
  dueSeeds: CourierDeliverySeed[];
  contacts: CourierContact[];
  npcs: NPC记录[];
  turn: number;
}

export function buildCourierSenderNpcRecords(input: CourierSenderRegistrationInput): NPC记录[] {
  const records: NPC记录[] = [];
  for (const seed of input.dueSeeds) {
    const contact = input.contacts.find((item) => item.id === seed.senderId);
    const senderName = contact?.name?.trim() || seed.title || seed.senderId;
    const exists = input.npcs.some((npc) =>
      npc.id === seed.senderId || npc.姓名 === senderName || (npc.别名 != null && npc.别名 === senderName))
      || records.some((npc) => npc.id === seed.senderId || npc.姓名 === senderName);
    if (exists) continue;
    records.push({
      id: seed.senderId,
      姓名: senderName,
      阶位: 'extra',
      好感度: 0,
      关系: 获取NPC兼容关系(0),
      亲密关系: false,
      同行: false,
      初见回合: input.turn,
      最近回合: input.turn,
      介绍: `通过手机消息结识。${seed.reason || seed.title || ''}`.trim(),
      最近互动: `${senderName} 发来消息：${seed.title || seed.reason || '一条消息'}。`,
      备注: [],
      ...(getDefaultBuiltinAvatar(senderName) ? { 原著角色: true } : {}),
    });
  }
  return records;
}
