import type { Audience } from '../contracts/knowledge';
import type { CoreSnapshot } from '../contracts/state';
import type { 游戏设置 } from '@/models/settings';
import type { EnglishImageCharacterFacts } from '@/models/imageCharacterEnglish';
import { containsCjk } from '@/models/imageCharacterEnglish';
import type { CoreContextInput, CoreTurnContext } from '../settlement/turnRunner';
import { assembleCore2MainPrompt } from '../settlement/mainPrompt';
import { retrieveCoreMemories, type RecallDependencies } from './retrieveMemory';
import { assembleCoreMemoryContext } from './assembleMemoryContext';
import type { MemoryContextBundle } from './recallTypes';
import { selectGroupReplyMembers } from '@/services/ai/courierService';
import { selectCoreContentReferences, type CoreContentReference } from './contentReferences';
import type { CoreCodexCatalog } from '../content/codexCatalog';

export type CoreConsumerDependencies = RecallDependencies & { contentCatalog?: CoreCodexCatalog; worldbooks?: readonly import('@/models/worldbook').世界书[] };

export interface ConsumerContextInput {
  snapshot: CoreSnapshot; target: Audience['target']; npcIds: string[]; userInput: string; conversationId?: string;
  optionalTokenBudget?: number; signal?: AbortSignal; references?: CoreContentReference[];
  imageFacts?: EnglishImageCharacterFacts; positive?: string[]; negative?: string[];
}
export interface ConsumerContextBundle { prompt: string; negative?: string; bundle: MemoryContextBundle }
const empty = (): MemoryContextBundle => ({ bundleId: `visual-bundle-${crypto.randomUUID()}`, mandatoryText: '', optionalText: '', selectedLeafIds: [], estimatedTokens: 0, budgetOverflow: false, diagnostics: [] });
export function buildCoreVisualContext(input: Pick<ConsumerContextInput, 'userInput' | 'imageFacts' | 'positive' | 'negative'>): ConsumerContextBundle {
    const facts = input.imageFacts;
    if (!facts || facts.language !== 'en' || !facts.name.trim() || [facts.name, facts.gender, facts.appearance, facts.outfit, facts.profileHeight, ...Object.values(facts.appearanceDetails ?? {}).map(fact => fact?.value)].some(value => value && containsCjk(value))) throw Error('CORE2_IMAGE_ENGLISH_FACTS_REQUIRED');
    // Explicit allowlist; no memory or relationship state is read for image prompts.
    const details = Object.entries(facts.appearanceDetails ?? {}).flatMap(([key, fact]) => fact ? [`${({ 发色: 'hair color', 瞳色: 'eye color', 身高: 'height', 体重: 'weight', 三围: 'bust/waist/hips' } as Record<string, string>)[key] ?? 'visual detail'}: ${fact.value}`] : []);
    const prompt = [`request: ${input.userInput}`, `character name: ${facts.name}`, facts.gender ? `gender: ${facts.gender}` : '', facts.appearance ? `appearance: ${facts.appearance}` : '', ...details,
      facts.profileHeight ? `height: ${facts.profileHeight}` : '', facts.outfit ? `outfit: ${facts.outfit}` : '', ...new Set(input.positive ?? [])].filter(Boolean).join('\n');
    return { prompt, negative: [...new Set(input.negative ?? [])].join(', '), bundle: empty() };
}
export async function buildCoreConsumerContext(input: ConsumerContextInput, deps: CoreConsumerDependencies): Promise<ConsumerContextBundle> {
  if (input.target === 'image') return buildCoreVisualContext(input);
  const { snapshot } = input, world = snapshot.records.find(row => row.domain === 'world');
  if (world?.domain !== 'world') throw Error('CORE2_CONSUMER_WORLD_MISSING');
  const audience: Audience = { target: input.target, npcIds: input.npcIds, ...(input.conversationId ? { conversationId: input.conversationId } : {}) };
  const request = { scope: snapshot.head.scope, head: snapshot.head, audience, entityIds: input.npcIds, locations: world.value.moment.location ? [world.value.moment.location] : [], query: input.userInput,
    moment: world.value.moment, ...(input.optionalTokenBudget !== undefined ? { optionalTokenBudget: input.optionalTokenBudget } : {}), ...(input.signal ? { signal: input.signal } : {}) };
  const recalled = await retrieveCoreMemories(request, deps), bundle = assembleCoreMemoryContext(recalled, request);
  const profiles = snapshot.records.flatMap(row => row.domain === 'npc' && input.npcIds.includes(row.entityId) ? [{ id: row.entityId, name: row.value.姓名, personality: row.value.personality,
    speechStyle: row.value.speechStyle, playerAddress: row.value.playerAddress, relationship: row.value.relationship, affinity: row.value.affinity }] : []);
  const catalog = await deps.contentCatalog?.select({ snapshot, query: [input.userInput, world.value.moment.location].filter(Boolean).join('\n'), audience, signal: input.signal }) ?? [];
  const references = selectCoreContentReferences([...catalog, ...input.references ?? []], audience);
  return { bundle, prompt: [input.target === 'news' ? '仅用下列已确认公开事件写简短新闻，不得补造私聊、私密经历或把发言当作客观事实。' : '只扮演指定回复者。严格区分已确认事件与被记录的发言；说过、邀请和传闻不等于实际履行。不得猜测未授权经历。',
    `memory bundle: ${bundle.bundleId}`, input.target === 'news' ? '' : `当前回复者资料：${JSON.stringify(profiles)}`,
    bundle.mandatoryText ? `必须记住：\n${bundle.mandatoryText}` : '', bundle.optionalText ? `相关经历：\n${bundle.optionalText}` : '',
    references.length ? `只读设定参考（不是新经历）：${JSON.stringify(references)}` : '', input.target === 'news' ? '' : `当前消息：${input.userInput}`].filter(Boolean).join('\n\n') };
}

/** The actual request context, not a separate diagnostics preview. */
export async function buildCoreMainContext(input: CoreContextInput, settings: 游戏设置, deps: CoreConsumerDependencies): Promise<CoreTurnContext> {
  const author = await buildCoreConsumerContext({ snapshot: input.snapshot, target: 'main', npcIds: [], userInput: input.userInput, signal: input.signal }, deps);
  const npcIds = input.snapshot.records.flatMap(row => row.domain === 'npc' && row.value.travelingTogether ? [row.entityId] : []);
  const npcContexts = [];
  for (const npcId of npcIds) npcContexts.push({ npcId, ...await buildCoreConsumerContext({ snapshot: input.snapshot, target: 'main', npcIds: [npcId], userInput: input.userInput, signal: input.signal }, deps) });
  const base = assembleCore2MainPrompt(input, settings, deps.worldbooks);
  return { ...base, systemPrompt: [base.systemPrompt, `作者历史参考，绝不授予NPC知识：\n${author.prompt}`, ...npcContexts.map(row => `仅${row.npcId}可知：\n${row.prompt}`)].join('\n\n'),
    memoryDelivery: { authorBundle: author.bundle, npcBundles: npcContexts.map(row => ({ npcId: row.npcId, ...row.bundle })) } };
}
export async function buildCoreReplyRequests(input: { snapshot: CoreSnapshot; conversationId: string; messageId: string; text: string; signal?: AbortSignal }, deps: CoreConsumerDependencies) {
  const { npcIds, target } = selectCoreReplyRecipients(input);
  const requests = [];
  for (const npcId of npcIds) requests.push({ npcId, ...await buildCoreConsumerContext({ snapshot: input.snapshot, target, npcIds: [npcId], userInput: input.text, conversationId: input.conversationId, signal: input.signal }, deps) });
  return { requests, estimatedRequests: requests.length, displayIntervalMs: 500 };
}
export function selectCoreReplyRecipients(input: { snapshot: CoreSnapshot; conversationId: string; messageId: string; text: string }) {
  const conversation = input.snapshot.records.find(row => row.domain === 'courier' && row.entityId === input.conversationId);
  if (conversation?.domain !== 'courier' || conversation.value.kind !== 'conversation' || conversation.value.dissolved) throw Error('CORE2_INTERACTION_CHANNEL');
  const members = conversation.value.memberIds;
  const contacts = input.snapshot.records.flatMap(row => row.domain === 'courier' && row.value.kind === 'contact' && row.value.available ? [{ id: row.value.npcId, name: row.value.name }] : []);
  const npcIds = conversation.value.conversationType === 'private' ? members : selectGroupReplyMembers({ id: conversation.entityId, participantIds: members }, { id: input.messageId, content: input.text }, 3, contacts);
  return { npcIds, target: conversation.value.conversationType, memberIds: [...members] };
}
