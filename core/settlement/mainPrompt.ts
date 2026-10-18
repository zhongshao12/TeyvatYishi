import type { 游戏设置 } from '@/models/settings';
import type { 聊天消息 } from '@/models/chat';
import type { CoreContextInput, CoreTurnContext } from './turnRunner';
import { buildTavernMessageChain, resolveModulePlaceholders } from '@/hooks/useGame/tavernMessageChainBuilder';
import { getCurrentSTPresetV2 } from '@/utils/stSettingsNormalizer';
import { explainPromptDelivery } from '@/services/promptDelivery';
import { createMacroContext, processMacros } from '@/utils/macroEngine';
import { resolvePresetPresentation } from '@/utils/presetPresentation';
import type { 世界书 } from '@/models/worldbook';
import { selectWorldbookDelivery } from '@/utils/worldbook';

const visibleTurnProtocol = `输出完整合法 JSON：{"body":[{"kind":"narration","text":"正文"},{"kind":"dialogue","speaker":"人物姓名","text":"台词"}],"choices":[],"factCandidates":[],"continuation":{"summary":"简短续接提示","unresolved":[]}}。
文风、字数、人称和段落按已启用的预设；这个合同只规定载体，不用默认风格或固定字数压过预设。不要输出模型内部思考。变量由独立提取审核，不输出可执行状态路径。
当前事实用于作者核对，不代表所有 NPC 都知情。角色只使用自己亲历、被明确告知或确实读过的消息；在场和同行不是全知。当前队伍所有同行角色需要在回复中得到符合场景的表现。`;

/** Reuses the existing preset compiler. No writable legacy game root is constructed. */
export function assembleCore2MainPrompt(input: CoreContextInput, settings: 游戏设置, worldbooks: readonly 世界书[] = []): CoreTurnContext {
  const traveler = input.snapshot.records.find(record => record.domain === 'traveler');
  const world = input.snapshot.records.find(record => record.domain === 'world');
  if (traveler?.domain !== 'traveler' || world?.domain !== 'world') throw Error('CORE2_PROMPT_STATE_MISSING');
  const playerName = traveler.value.姓名;
  const delivered = settings.enableWorldbookInjection ? selectWorldbookDelivery([...worldbooks], {
    recentUserInput: input.userInput, recentAIResponse: [...input.history].reverse().find(source => source.kind === 'narrative')?.blocks.map(block => block.text).join('\n') ?? '',
    recentMessages: input.history.map(source => source.blocks.map(block => block.text).join('\n')), worldName: world.value.moment.worldName, travelerName: playerName,
    turnCount: world.value.completedMainTurns, messageCount: world.value.completedMainTurns + 1, currentScope: world.value.completedMainTurns === 0 ? 'opening' : 'main',
    currentLocation: world.value.moment.location ?? '', storyMode: world.value.opening?.storyMode, worldbookTriggerStates: world.value.worldbookTriggers,
    npcNames: input.snapshot.records.flatMap(row => row.domain === 'npc' && row.value.travelingTogether ? [row.value.姓名] : []),
  }) : [];
  const reference = delivered.filter(row => row.depth === undefined).map(row => row.content).join('\n\n');
  const finish = (context: CoreTurnContext): CoreTurnContext => {
    const messages = [...context.messages], anchors = messages.filter(row => row.role === 'user' || row.role === 'assistant');
    for (const row of delivered.filter(row => row.depth !== undefined).sort((a, b) => b.depth! - a.depth! || a.priority - b.priority)) {
      const anchor = anchors[Math.max(0, anchors.length - row.depth!)];
      messages.splice(anchor ? messages.indexOf(anchor) : messages.length, 0, { role: 'system', content: row.content });
    }
    return { ...context, messages, worldbookEntryIds: delivered.map(row => row.id) };
  };
  const modules = settings.promptModules.filter(module => explainPromptDelivery(module, 'main') === 'selected'
    && (!module.scope.length || module.scope.includes('all') || module.scope.includes(world.value.completedMainTurns === 0 ? 'opening' : 'main')));
  const names = new Map(input.snapshot.records.filter(record => record.domain === 'npc').map(record => [record.entityId, record.value.姓名]));
  const history: 聊天消息[] = input.history.map(source => ({ id: `${source.ref.sourceId}:${source.ref.sourceVersion}`, role: source.kind === 'player_input' ? 'user' : 'assistant', timestamp: source.createdAt,
    content: source.blocks.filter(block => block.kind !== 'configuration').map(block => block.speakerId ? `${names.get(block.speakerId) ?? '角色'}：${block.text}` : block.text).join('\n\n') }));
  const facts = {
    player: { id: traveler.entityId, name: playerName, alias: traveler.value.别名, identity: traveler.value.身份, gender: traveler.value.性别, age: traveler.value.年龄, birthday: traveler.value.生日, height: traveler.value.身高,
      appearance: traveler.value.外貌, personality: traveler.value.性格, background: traveler.value.背景, expertise: traveler.value.专长知识, level: traveler.value.level, health: traveler.value.health, experience: traveler.value.experience,
      attributes: traveler.value.attributes, capabilities: traveler.value.capabilities, elements: traveler.value.元素共鸣, talents: traveler.value.天赋 },
    world: world.value,
    party: input.snapshot.records.flatMap(record => record.domain === 'npc' && record.value.travelingTogether ? [{ id: record.entityId, name: record.value.姓名, appearance: record.value.appearance, clothing: record.value.clothing, personality: record.value.personality, speechStyle: record.value.speechStyle }] : []),
    inventory: input.snapshot.records.flatMap(record => record.domain === 'inventory' ? [{ id: record.entityId, ...record.value }] : []),
    quests: input.snapshot.records.flatMap(record => record.domain === 'quest' ? [record.value] : []),
    story: input.snapshot.records.flatMap(record => record.domain === 'story' ? [record.value] : []),
    commitments: input.commitments,
  };
  const currentFacts = `已确认当前事实（作者资料，不授予旁人知识）：\n${JSON.stringify(facts)}`;
  const preset = settings.enableStPreset === false ? null : getCurrentSTPresetV2(settings);
  if (preset) {
    const messages = buildTavernMessageChain({ settings: { ...settings, promptModules: modules }, preset: preset.preset, characterId: settings.currentStCharacterId ?? preset.characterId ?? null,
      chatHistory: history, latestUserInput: input.userInput, playerName, playerRole: null, worldbookExtraTexts: reference ? [reference] : [], includeNativeNarrative: false, preserveLatestInput: true,
      macroCtx: createMacroContext(settings.macroGlobalVars, { charName: '当前出场角色', userName: playerName, lastMessage: input.userInput, lastUserMessage: input.userInput, lastCharMessage: [...history].reverse().find(message => message.role === 'assistant')?.content ?? '', messageCount: history.length, turnCount: world.value.completedMainTurns }) });
    if (!messages.length) throw Error('CORE2_PRESET_ORDER_UNAVAILABLE');
    return finish({ systemPrompt: [currentFacts, visibleTurnProtocol].join('\n\n'), messages, validation: { wordCountTarget: resolvePresetPresentation(settings)?.wordCountTarget ?? null, partyNpcIds: facts.party.map(npc => npc.id) } });
  }
  const placeholders = { ...resolveModulePlaceholders(settings, playerName), wordCountTarget: String(settings.wordCountTarget) };
  const macros = createMacroContext(settings.macroGlobalVars, { charName: '当前出场角色', userName: playerName });
  const rules = modules.map(module => processMacros(module.content.replace(/\{(wordCountTarget|personLabel|playerName)\}/gu, (original, key: keyof typeof placeholders) => placeholders[key] ?? original), macros)).join('\n\n');
  return finish({ systemPrompt: [rules, reference, currentFacts, visibleTurnProtocol].filter(Boolean).join('\n\n'), messages: [...history.map(({ role, content }) => ({ role, content })), { role: 'user', content: input.userInput }], validation: { wordCountTarget: null, partyNpcIds: facts.party.map(npc => npc.id) } });
}
