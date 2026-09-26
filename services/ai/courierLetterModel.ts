import type { API配置项 } from '@/models/settings';
import { chatCompletion } from './chatCompletionClient';
import { composeCourierLetterLocally, extractCourierSpeechEvent, type CourierGroupReplyContext, type CourierLetterContext, type CourierReplyContext, type CourierSenderProfile } from './courierService';
import type { 手机API覆盖 } from '@/models/settings';

/** 手机消息独立模型：按上下文、人设、关系与同行记忆生成即时聊天。 */

const META_PATTERN = /deliverySeed|triggerType|seed\.context|系统提示|以下是?消息[:：]|如下是?消息[:：]|(?:API|提示词|记忆库)(?:参数|内容|字段|数据)?/i;
const META_NARRATIVE_PATTERN = /关于.{0,30}对.*(?:印象|好感)|可能会有后续联络|可低频投递|已发生事实|玩家一行人/u;

function speechSafeSender(sender: CourierSenderProfile | undefined): CourierSenderProfile | undefined {
  if (!sender) return undefined;
  const line = (value: string | undefined) => value && !META_NARRATIVE_PATTERN.test(value) ? value : undefined;
  const lines = (value: string[] | undefined) => value?.filter((item) => !META_NARRATIVE_PATTERN.test(item));
  return {
    ...sender,
    recentInteraction: line(sender.recentInteraction),
    longTermImpression: line(sender.longTermImpression),
    sharedExperiences: lines(sender.sharedExperiences),
    unfinishedBusiness: lines(sender.unfinishedBusiness),
    unresolvedConflicts: lines(sender.unresolvedConflicts),
    mustRemember: lines(sender.mustRemember),
    summaryMemories: lines(sender.summaryMemories),
    recentMemories: lines(sender.recentMemories),
    recentMessages: lines(sender.recentMessages),
  };
}

function cleanLetterText(raw: string): string {
  return raw
    .replace(/```[a-z]*\s*[\s\S]*?```/gi, (match) => (match.includes('{') ? '' : match.slice(3, -3)))
    .replace(/^```[a-z]*|```$/gim, '')
    .replace(/^【?.*来信】?[:：]?\s*/g, '')
    .trim();
}

/**
 * 手机消息只需要模型的原始文本，不能经过主剧情的 NarrativeTurn JSON 解析器。
 * 使用流式兼容通道收集完整文本；不向 UI 逐 token 输出，因此界面仍表现为一次性消息。
 */
async function requestCourierText(config: API配置项, prompt: string): Promise<string> {
  const configuredMaxTokens = config.maxTokens;
  const configuredLimit = configuredMaxTokens && configuredMaxTokens > 0
    ? configuredMaxTokens
    : 4096;
  const run = async (maxTokens: number): Promise<{ text: string; finishReason?: string }> => {
    let finishReason: string | undefined;
    const text = await chatCompletion(config, {
      messages: [{ role: 'user', content: prompt }],
      systemPrompt: '',
      maxTokens,
    }, {
      onDelta: () => undefined,
      onDone: () => undefined,
      onError: (error) => { throw error; },
      onFinishReason: (reason) => { finishReason = reason; },
    });
    return { text, finishReason };
  };

  const firstLimit = Math.min(configuredLimit, 2048);
  let result = await run(firstLimit);
  const wasTruncated = result.finishReason === 'length' || result.finishReason === 'max_tokens';
  if (wasTruncated && configuredLimit > firstLimit) {
    result = await run(Math.min(configuredLimit, 4096));
  }
  if (result.finishReason === 'length' || result.finishReason === 'max_tokens') {
    throw new Error('PHONE_REPLY_TRUNCATED');
  }
  return result.text;
}

export function buildCourierLetterPrompt(context: CourierLetterContext): string {
  const { seed, environment } = context;
  const sender = speechSafeSender(context.sender);
  const senderName = sender?.name || seed.senderId;
  const event = extractCourierSpeechEvent(seed.context);
  return [
    '你正在为《原神》文字冒险生成角色主动发来的手机消息。请完全进入该角色，以第一人称自然联系旅行者。',
    '要求：',
    '- 只输出 1~4 条短消息，每条单独一行；不要标题、解释、引号、书信腔或旁白。',
    '- 像熟人即时聊天：不要写落款，不要每条重复称呼，不要使用“见信如晤”“盼复”等套话。',
    '- 要自然承接共同经历、近期互动、约定或未解决的事，但不要机械罗列记忆。',
    '- 语气温度要符合与旅行者的关系亲疏：越亲近越挂念亲昵，越生疏越克制有礼。',
    '- 若给了说话方式/口癖，要让消息读起来就是这个人发的，避免千人一面的套话。',
    '- 不要照抄给你的事件描述原文，要用寄件人自己的口吻转述。',
    '- 只能使用下方明确给出的事实与记忆；不得擅自发明初遇地点、共同经历、约定或关系进展。',
    '- 角色只能知道亲历、被告知、近期手机对话或明确私有记忆中的事。下方环境只是系统连续性参考，不代表寄件人自动知道旅行者当前位置、时间与遭遇。',
    '- 总长度 30~140 字；“手机”只是界面载体，措辞仍符合提瓦特世界，不提 API、提示词、记忆库等系统术语。',
    '',
    `寄件人：${senderName}${sender?.affinityLabel ? `（与旅行者关系：${sender.affinityLabel}）` : ''}`,
    sender?.playerAddress ? `寄件人对旅行者的称呼：${sender.playerAddress}` : '',
    sender?.personality ? `寄件人性格：${sender.personality}` : '',
    sender?.speechStyle ? `寄件人说话方式：${sender.speechStyle}` : '',
    sender?.background ? `人物背景：${sender.background}` : '',
    sender?.longTermImpression ? `对旅行者的长期印象：${sender.longTermImpression}` : '',
    sender?.recentInteraction ? `最近互动：${sender.recentInteraction}` : '',
    sender?.sharedExperiences?.length ? `共同经历：${sender.sharedExperiences.slice(-5).join('；')}` : '',
    sender?.unfinishedBusiness?.length ? `约定与未完成事项：${sender.unfinishedBusiness.slice(0, 5).join('；')}` : '',
    sender?.unresolvedConflicts?.length ? `未解决冲突：${sender.unresolvedConflicts.slice(0, 4).join('；')}` : '',
    sender?.mustRemember?.length ? `必须记得：${sender.mustRemember.slice(0, 6).join('；')}` : '',
    sender?.summaryMemories?.length ? `长期同行记忆：${sender.summaryMemories.slice(-3).join('；')}` : '',
    sender?.recentMemories?.length ? `近期同行记忆：${sender.recentMemories.slice(-6).join('；')}` : '',
    sender?.recentMessages?.length ? `近期手机对话：\n${sender.recentMessages.slice(-8).join('\n')}` : '',
    environment?.location ? `当前地点：${environment.location}` : '',
    environment?.timeText ? `当前时间：${environment.timeText}` : '',
    environment?.weather ? `当前天气：${environment.weather}` : '',
    event ? `寄件人可知的近期事件：${event}` : '',
    `旅行者名字：${context.travelerName || '旅行者'}`,
  ].filter(Boolean).join('\n');
}

export async function generateCourierLetter(config: API配置项, context: CourierLetterContext): Promise<string> {
  const prompt = buildCourierLetterPrompt(context);
  const letter = cleanLetterText(await requestCourierText(config, prompt));
  if (!letter || letter.length < 6) throw new Error('EMPTY_LETTER');
  if (META_PATTERN.test(letter) || META_NARRATIVE_PATTERN.test(letter)) throw new Error('LETTER_CONTAINS_META_TEXT');
  return letter.slice(0, 600);
}

/** 把手机独立 API 覆盖叠到主接口上：留空字段回退主接口。 */
export function resolveCourierApiConfig(
  override: 手机API覆盖 | undefined,
  mainConfig: API配置项 | null | undefined,
): API配置项 | null {
  if (!override) return mainConfig ?? null;
  const baseUrl = override.baseUrl.trim() || mainConfig?.baseUrl || '';
  const model = override.model.trim() || mainConfig?.model || '';
  const apiKey = override.apiKey.trim() || mainConfig?.apiKey || '';
  if (!baseUrl.trim() || !model.trim()) return mainConfig ?? null;
  const now = Date.now();
  const base: API配置项 = mainConfig ?? {
    id: '__phone_api__',
    name: '手机消息独立接口',
    provider: override.provider,
    baseUrl,
    apiKey,
    model,
    createdAt: now,
    updatedAt: now,
  };
  return {
    ...base,
    provider: override.provider,
    baseUrl,
    model,
    apiKey,
    ...(override.maxTokens !== undefined ? { maxTokens: override.maxTokens } : {}),
    ...(override.temperature !== undefined ? { temperature: override.temperature } : {}),
    ...(override.retryCount !== undefined ? { retryCount: override.retryCount } : {}),
  };
}

/** 本地兜底消息：永不照抄种子原文，保证无 API 时也能完成聊天。 */
export function composeCourierLetter(context: CourierLetterContext): string {
  return composeCourierLetterLocally(context);
}

/**
 * 玩家手机消息的回复生成：以联系人第一人称自然接话。
 * 失败时抛错，由调用方回退到 composeCourierReplyLocally 的本地聊天。
 */
export function buildCourierReplyPrompt(context: CourierReplyContext): string {
  const { playerMessage, environment } = context;
  const sender = speechSafeSender(context.sender);
  const isConsecutiveBatch = /^1\. [\s\S]*\n2\. /u.test(playerMessage.content);
  return [
    '你正在为《原神》文字冒险生成角色的手机回复。旅行者刚发来消息，请完全进入该角色，用第一人称接话。',
    '要求：',
    '- 只输出 1~3 条短消息，每条单独一行；不要标题、解释、引号、书信腔或旁白。',
    '- 像真实即时聊天：不要写落款，不要每条重复称呼，不要说“来信收到”。',
    '- 要回应旅行者消息里的内容，体现联系人的性格、心情与说话习惯，语气自然有温度。',
    isConsecutiveBatch ? '- 旅行者连续发了多条消息；按顺序回应整段意思，不要逐条机械复读。' : '',
    '- 语气温度要符合与旅行者的关系亲疏：越亲近越亲切挂念，越生疏越克制有礼。',
    '- 若给了说话方式/口癖，要让回复读起来就是这个人发的，避免千人一面的套话。',
    '- 不要照抄旅行者原文，用联系人自己的口吻回应。',
    '- 自然承接共同经历、近期对话、约定或关系变化，不要机械复述记忆条目。',
    '- 只能使用下方明确给出的事实与记忆；不得擅自发明初遇地点、共同经历、约定或关系进展。',
    '- 角色只能知道亲历、被告知、近期手机对话或明确私有记忆中的事。下方环境只是系统连续性参考，不代表联系人自动知道旅行者当前位置、时间与遭遇。',
    '- 总长度 20~120 字，保持提瓦特人物语言风格，不要出现 API、提示词、记忆库等系统术语。',
    '',
    `收信人：${sender?.name || context.conversation.title || '联系人'}${sender?.affinityLabel ? `（与旅行者关系：${sender.affinityLabel}）` : ''}`,
    sender?.playerAddress ? `收信人对旅行者的称呼：${sender.playerAddress}` : '',
    sender?.personality ? `收信人性格：${sender.personality}` : '',
    sender?.speechStyle ? `收信人说话方式：${sender.speechStyle}` : '',
    sender?.background ? `人物背景：${sender.background}` : '',
    sender?.longTermImpression ? `对旅行者的长期印象：${sender.longTermImpression}` : '',
    sender?.recentInteraction ? `最近互动：${sender.recentInteraction}` : '',
    sender?.sharedExperiences?.length ? `共同经历：${sender.sharedExperiences.slice(-5).join('；')}` : '',
    sender?.unfinishedBusiness?.length ? `约定与未完成事项：${sender.unfinishedBusiness.slice(0, 5).join('；')}` : '',
    sender?.unresolvedConflicts?.length ? `未解决冲突：${sender.unresolvedConflicts.slice(0, 4).join('；')}` : '',
    sender?.mustRemember?.length ? `必须记得：${sender.mustRemember.slice(0, 6).join('；')}` : '',
    sender?.summaryMemories?.length ? `长期同行记忆：${sender.summaryMemories.slice(-3).join('；')}` : '',
    sender?.recentMemories?.length ? `近期同行记忆：${sender.recentMemories.slice(-6).join('；')}` : '',
    sender?.recentMessages?.length ? `近期手机对话：\n${sender.recentMessages.slice(-8).join('\n')}` : '',
    environment?.location ? `当前地点：${environment.location}` : '',
    environment?.timeText ? `当前时间：${environment.timeText}` : '',
    environment?.weather ? `当前天气：${environment.weather}` : '',
    `旅行者刚发的消息：${playerMessage.content}`,
    `旅行者名字：${context.travelerName || '旅行者'}`,
  ].filter(Boolean).join('\n');
}

export async function generateCourierReply(config: API配置项, context: CourierReplyContext): Promise<string> {
  const prompt = buildCourierReplyPrompt(context);
  const letter = cleanLetterText(await requestCourierText(config, prompt));
  if (!letter || letter.length < 4) throw new Error('EMPTY_REPLY');
  if (META_PATTERN.test(letter) || META_NARRATIVE_PATTERN.test(letter)) throw new Error('REPLY_CONTAINS_META_TEXT');
  return letter.slice(0, 600);
}

/**
 * 群聊跟帖：群里某个成员针对旅行者发言回一条口语化短消息。
 * 失败时抛错，由调用方回退到 composeCourierGroupReplyLocally。
 */
export function buildCourierGroupReplyPrompt(context: CourierGroupReplyContext): string {
  const { playerMessage } = context;
  const sender = speechSafeSender(context.sender);
  const isConsecutiveBatch = /^1\. [\s\S]*\n2\. /u.test(playerMessage.content);
  return [
    '你是《原神》文字冒险手机群聊中的一位成员。旅行者刚在群里说了一句话，请以这位成员的身份跟帖回应。',
    '要求：',
    '- 只输出这一条群聊消息本身，不要称呼、不要落款、不要引号包裹、不要解释。',
    '- 要像真实群聊里随口接话：简短、口语、自然，长度 10~45 字。',
    '- 必须从该成员独有的性格、身份、口癖和与旅行者的关系出发作答，让人遮住名字也能辨认角色。',
    '- 必须回应旅行者这句话的核心含义；涉及恋爱、承诺、冲突或请求时，要给出该角色自己的明确态度。',
    isConsecutiveBatch ? '- 旅行者连续发了多条消息；按顺序回应整段意思，不要逐条机械复读。' : '',
    '- 自然承接一项最相关的同行记忆、近期互动或未完成约定（若有），但不要逐项复述档案。',
    '- 禁止使用“这事我记下了”“你展开讲讲”“我也在想这个”“待会儿聊”一类万能敷衍句。',
    '- 不要照抄旅行者的原话，可以顺着话题接、调侃、关心或补充。',
    '- 只能使用下方明确给出的事实与记忆，不得虚构共同经历或关系进展。',
    '- 成员只能知道亲历、被告知、本群消息或明确私有记忆里的内容，不得读取系统状态、旅行者未说出口的信息或别人的私密记忆。',
    '',
    `发言成员：${sender?.name || '群成员'}${sender?.affinityLabel ? `（与旅行者关系：${sender.affinityLabel}）` : ''}`,
    sender?.playerAddress ? `该成员对旅行者的称呼：${sender.playerAddress}` : '',
    sender?.personality ? `成员性格：${sender.personality}` : '',
    sender?.speechStyle ? `成员说话方式：${sender.speechStyle}` : '',
    sender?.background ? `人物背景：${sender.background}` : '',
    sender?.longTermImpression ? `对旅行者的长期印象：${sender.longTermImpression}` : '',
    sender?.recentInteraction ? `与旅行者最近互动：${sender.recentInteraction}` : '',
    sender?.sharedExperiences?.length ? `共同经历：${sender.sharedExperiences.slice(-4).join('；')}` : '',
    sender?.unfinishedBusiness?.length ? `尚未完成的约定：${sender.unfinishedBusiness.slice(0, 4).join('；')}` : '',
    sender?.unresolvedConflicts?.length ? `未解决的顾虑或冲突：${sender.unresolvedConflicts.slice(0, 3).join('；')}` : '',
    sender?.mustRemember?.length ? `必须记得：${sender.mustRemember.slice(0, 5).join('；')}` : '',
    sender?.summaryMemories?.length ? `长期同行记忆：${sender.summaryMemories.slice(-3).join('；')}` : '',
    sender?.recentMemories?.length ? `近期同行记忆：${sender.recentMemories.slice(-5).join('；')}` : '',
    sender?.recentMessages?.length ? `本群近期对话：\n${sender.recentMessages.slice(-8).join('\n')}` : '',
    `旅行者刚说的：${playerMessage.content}`,
    `旅行者名字：${context.travelerName || '旅行者'}`,
  ].filter(Boolean).join('\n');
}

export async function generateCourierGroupReply(config: API配置项, context: CourierGroupReplyContext): Promise<string> {
  const prompt = buildCourierGroupReplyPrompt(context);
  const reply = cleanLetterText(await requestCourierText(config, prompt)).replace(/^——.*$/gm, '').trim();
  if (!reply || reply.length < 4) throw new Error('EMPTY_GROUP_REPLY');
  if (META_PATTERN.test(reply) || META_NARRATIVE_PATTERN.test(reply)) throw new Error('GROUP_REPLY_CONTAINS_META_TEXT');
  return reply.slice(0, 160);
}
