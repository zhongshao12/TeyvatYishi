import type { UseGameStateReturn } from '@/hooks/useGameState';
import type { 聊天消息 } from '@/models/chat';
import { buildSteambirdGenerationRequest } from '@/services/ai/steambirdModel';
import { buildVariableModelPrompt } from '@/services/ai/variableModel';
import { buildCodexAiCandidateIndex } from '@/services/codexAiRetrievalIndex';
import { retrieveCodexEntries } from '@/services/codexRetrieval';
import { retrieveIrminsulEntries } from '@/services/irminsulRetrieval';
import { estimateTextTokens } from '@/utils/tokenEstimate';
import { createMacroContext } from '@/utils/macroEngine';
import { 格式化开局档案上下文 } from '@/models/world';
import { NPC_MEMORY_WRITE_RULE_PROMPT } from '@/data/variableWorldbook';
import { getBuiltinPresetsV2, loadSelectedBuiltinTavernPreset } from '@/data/builtinPresets';
import { getCurrentSTPresetV2 } from '@/utils/stSettingsNormalizer';
import { selectNpcLedgersForTurn } from '@/models/npc';
import { buildTavernMessageChain } from './tavernMessageChainBuilder';
import { buildImmediateStoryReview, buildLeanAssistantHistoryContent, getMainHistoryWindow } from './historyWindow';
import { buildOpeningSystemPrompt, buildSystemPrompt } from './systemPromptBuilder';
import { getCodexNpcNamesForTurn } from './npcPresence';
import type { ContextSection, ContextSnapshot, ContextSnapshotKind } from './contextSnapshotTypes';

export type { ContextSection, ContextSnapshot, ContextSnapshotKind } from './contextSnapshotTypes';

function latestUserInput(history: 聊天消息[]): string {
  return [...history].reverse().find((message) => message.role === 'user' && message.content.trim())?.content.trim() ?? '';
}

function addSection(sections: ContextSection[], section: Omit<ContextSection, 'order' | 'estimatedTokens'>): void {
  const content = section.content.trim();
  if (!content) return;
  sections.push({ ...section, content, order: sections.length + 1, estimatedTokens: estimateTextTokens(content) });
}

function finalizeSnapshot(kind: ContextSnapshotKind, title: string, sections: ContextSection[], sourceInput: string): ContextSnapshot {
  const fullText = sections.map((section) => section.content).join('\n\n---\n\n');
  return {
    kind,
    title,
    sections,
    fullText,
    estimatedTokens: estimateTextTokens(fullText),
    uploadEstimatedTokens: sections.filter((section) => section.upload !== false).reduce((sum, section) => sum + section.estimatedTokens, 0),
    diagnosticEstimatedTokens: sections.filter((section) => section.diagnostic === true).reduce((sum, section) => sum + section.estimatedTokens, 0),
    createdAt: Date.now(),
    sourceInput,
  };
}

function formatMessages(messages: readonly Pick<聊天消息, 'role' | 'content'>[]): string {
  return messages.map((message, index) => `#${index + 1} ${message.role}\n${message.content}`).join('\n\n');
}

function splitPromptSections(systemPrompt: string): Array<{ title: string; content: string }> {
  return systemPrompt
    .split(/\n\n---\n\n/g)
    .map((content, index) => {
      const trimmed = content.trim();
      const title = trimmed.match(/^#\s+(.+)$/m)?.[1]?.trim() || `System Prompt ${index + 1}`;
      return { title, content: trimmed };
    })
    .filter((section) => section.content.length > 0);
}

function formatMainRequestOrderOverview(systemSections: readonly { title: string }[], apiMessages: readonly Pick<聊天消息, 'role'>[]): string {
  return [
    'System Prompt 分段',
    ...systemSections.map((section, index) => `${index + 1}. ${section.title}`),
    '',
    'API Messages',
    ...apiMessages.map((message, index) => `${index + 1}. ${message.role}`),
  ].join('\n');
}

export function buildContextSnapshot(state: UseGameStateReturn, kind: ContextSnapshotKind = 'main'): ContextSnapshot {
  switch (kind) {
    case 'variable': return buildVariableContextSnapshot(state);
    case 'courier': return buildCourierContextSnapshot(state);
    case 'steambird': return buildSteambirdContextSnapshot(state);
    case 'irminsul': return buildIrminsulContextSnapshot(state);
    case 'codex': return buildCodexContextSnapshot(state);
    case 'main':
    default: return buildMainContextSnapshot(state);
  }
}

function buildMainContextSnapshot(state: UseGameStateReturn): ContextSnapshot {
  const sourceInput = latestUserInput(state.chatHistory);
  const isOpening = state.turnCount === 1 && sourceInput.startsWith('[系统]');
  const currentScope = state.世界.进行中元素回响 ? 'elementalEcho' as const : isOpening ? 'opening' as const : 'main' as const;
  const worldbookCtx = {
    recentUserInput: sourceInput,
    recentAIResponse: '',
    worldName: state.世界.当前时段?.名称 ?? '',
    travelerName: state.旅人.姓名,
    turnCount: state.turnCount,
    startScenarioId: state.世界.起航之地ID,
    startSceneName: state.世界.开局档案?.章节锚点名称 ?? state.世界.当前地点,
    currentLocation: state.世界.当前地点,
    openingRegionName: state.世界.开局档案?.地区名称,
    openingChapterName: state.世界.开局档案?.章节锚点名称,
    openingEntryText: state.世界.开局档案?.玩家介入原文,
    openingSource: state.世界.开局档案?.来源,
    openingArchiveText: 格式化开局档案上下文(state.世界.开局档案),
    npcNames: getCodexNpcNamesForTurn({ world: state.世界, npcs: state.NPC, history: state.chatHistory, userInput: sourceInput, turnCount: state.turnCount }),
    originalProtagonist: state.世界.原著主角,
    currentScope,
    storyMode: state.世界.剧情模式,
    canonTrack: state.game.原著轨道,
  };
  const macro = createMacroContext(state.gameSettings.macroGlobalVars);
  const immediateStoryReview = buildImmediateStoryReview(state.chatHistory);
  const npcLedgerSelection = selectNpcLedgersForTurn({
    records: state.NPC,
    turnCount: state.turnCount,
    explicitNames: worldbookCtx.npcNames,
    sceneNames: state.世界.当前时段?.人物?.map((npc) => npc.姓名),
    recalledNames: worldbookCtx.npcNames,
  });
  const built = isOpening
    ? buildOpeningSystemPrompt(
        state.旅人, state.世界, state.gameSettings, state.turnCount, state.worldbooks,
        worldbookCtx, state.蒸汽鸟报, 'opening', macro, state.任务,
      )
    : buildSystemPrompt(
        state.旅人, state.世界, state.记忆, state.gameSettings, state.turnCount,
        state.worldbooks, worldbookCtx, state.NPC, state.蒸汽鸟报, state.剧情,
        state.剧情编织, state.图鉴, state.世界树, state.手机,
        state.世界.进行中元素回响 ? 'judgement' : undefined,
        immediateStoryReview ? `# 即时剧情回顾\n\n【即时剧情回顾】\n${immediateStoryReview}` : undefined,
        undefined, false, npcLedgerSelection, 'normal', macro, state.任务, state.背包,
      );
  const sections: ContextSection[] = [];
  const systemPrompt = built.systemPrompt;
  const systemSections = splitPromptSections(systemPrompt);
  systemSections.forEach((section, index) => addSection(sections, {
    id: `main_system_${index + 1}`,
    title: section.title,
    category: 'System Prompt 分段',
    content: section.content,
    upload: true,
  }));

  const recentHistory = getMainHistoryWindow(state.chatHistory, state.gameSettings, state.记忆);
  const currentUserIndex = (() => {
    for (let index = recentHistory.length - 1; index >= 0; index -= 1) {
      if (recentHistory[index]?.role === 'user') return index;
    }
    return -1;
  })();
  const tavernHistory = recentHistory.filter((msg, index) => {
    return index !== currentUserIndex;
  });
  const currentPresetV2 = getCurrentSTPresetV2(state.gameSettings, getBuiltinPresetsV2());
  // 内置酒馆预设按需加载：预览为同步快照，这里触发后台加载，下次快照即可带上完整预设。
  void loadSelectedBuiltinTavernPreset(state.gameSettings.currentStPresetIdV2, state.gameSettings.enableStPreset !== false);
  const shouldTryTavernV2 =
    state.gameSettings.enableStPreset !== false &&
    Boolean(currentPresetV2?.preset?.prompts?.length) &&
    Boolean(currentPresetV2?.preset?.prompt_order?.length);
  let tavernMessages: 聊天消息[] = [];
  let tavernStatus = shouldTryTavernV2 ? '已启用；额外 API messages，原生游戏底座 systemPrompt 仍会完整发送。' : '未启用。';
  if (shouldTryTavernV2 && currentPresetV2) {
    try {
      tavernMessages = buildTavernMessageChain({
        settings: state.gameSettings,
        preset: currentPresetV2.preset,
        characterId: state.gameSettings.currentStCharacterId ?? currentPresetV2.characterId ?? null,
        chatHistory: tavernHistory,
        latestUserInput: sourceInput,
        playerName: state.旅人.姓名 || state.旅人.别名 || '旅行者',
        playerRole: state.旅人,
        includeNativeContextInWorldbook: false,
        includeNativeNarrative: false,
        triggerType: isOpening ? 'opening' : 'normal',
        macroCtx: macro,
      }).map((message, index) => ({ ...message, id: `context-tavern-${index}`, timestamp: Date.now() }));
      if (!tavernMessages.length) tavernStatus = '已配置但消息链为空；真实发送将回退原生历史。';
    } catch (error) {
      tavernMessages = [];
      tavernStatus = `预览失败；真实发送将回退原生历史：${error instanceof Error ? error.message : String(error)}`;
    }
  }
  const nativeMessages = recentHistory.map((msg) => msg.role === 'assistant'
    ? { ...msg, content: buildLeanAssistantHistoryContent(msg) }
    : msg);
  const apiMessages = tavernMessages.length ? tavernMessages : nativeMessages;
  built.chatModuleMessages.forEach((message) => apiMessages.push({
    id: `context-module-${apiMessages.length}`,
    role: message.role === 'assistant' || message.role === 'user' ? message.role : 'system',
    content: message.content,
    timestamp: Date.now(),
  }));

  addSection(sections, {
    id: 'main_request_order_overview', title: '主剧情真实请求顺序总览', category: '诊断',
    content: formatMainRequestOrderOverview(systemSections, apiMessages), upload: false, diagnostic: true,
  });
  addSection(sections, {
    id: 'tavern_preset_status', title: '酒馆预设状态', category: '诊断',
    content: `${tavernStatus}\n酒馆预设历史只使用原生近期历史窗口，并排除当前用户输入。`, upload: false, diagnostic: true,
  });
  if (tavernMessages.length) addSection(sections, {
    id: 'tavern_preset_message_chain', title: '酒馆预设消息链', category: 'API Messages',
    content: `只使用原生近期历史窗口；排除当前用户输入。\n\n${formatMessages(tavernMessages)}`, upload: true,
  });
  if (!tavernMessages.length) addSection(sections, {
    id: 'main_history', title: `历史记录（${nativeMessages.length} 条）`, category: 'API Messages',
    content: formatMessages(nativeMessages), upload: true,
  });

  const previousAssistant = [...state.chatHistory].reverse().find((message) => message.role === 'assistant');
  addSection(sections, {
    id: 'previous_npc_ledger_diagnostics', title: '上一回合真实保存的 NPC 账本诊断', category: '诊断',
    content: `【NPC账本更新诊断】\n${JSON.stringify(previousAssistant?.debugContext?.npcLedgerUpdate ?? {}, null, 2)}`,
    upload: false, diagnostic: true,
  });
  addSection(sections, {
    id: 'current_npc_ledger_injection', title: '本回合 NPC 账本预期注入', category: '诊断',
    content: JSON.stringify(npcLedgerSelection, null, 2), upload: false, diagnostic: true,
  });
  return finalizeSnapshot('main', '主剧情当前 AI 上下文', sections, sourceInput);
}

function buildVariableContextSnapshot(state: UseGameStateReturn): ContextSnapshot {
  const sourceInput = latestUserInput(state.chatHistory);
  const lastAssistant = [...state.chatHistory].reverse().find((message) => message.role === 'assistant');
  const sections: ContextSection[] = [];
  addSection(sections, {
    id: 'variable_system', title: '变量模型系统提示词', category: '系统', upload: true,
    content: buildVariableModelPrompt(state.game, { enabled: state.gameSettings.enableNsfw, maleArchiveEnabled: state.gameSettings.enableMaleNsfwArchive }, state.gameSettings.promptModules),
  });
  addSection(sections, {
    id: 'variable_user', title: '变量模型用户消息', category: '用户', upload: true,
    content: [
      `玩家输入：${sourceInput || '（无）'}`,
      `事实候选：${lastAssistant?.parsedResponse?.factCandidates.map((candidate) => candidate.fact).join('；') || '（无）'}`,
      `主模型正文：${lastAssistant?.parsedResponse?.body.map((block) => block.text).join('\n') || lastAssistant?.content || '（无）'}`,
    ].join('\n\n'),
  });
  addSection(sections, {
    id: 'variable_npc_memory_rule', title: 'NPC档案记忆写入法则（完整）', category: '系统',
    content: NPC_MEMORY_WRITE_RULE_PROMPT, upload: true,
  });
  return finalizeSnapshot('variable', '变量模型上下文', sections, sourceInput);
}

function buildCourierContextSnapshot(state: UseGameStateReturn): ContextSnapshot {
  const sourceInput = latestUserInput(state.chatHistory);
  const archiveFacts = state.手机.conversations.flatMap((conversation) =>
    (conversation.localArchive?.compressedSummaries ?? []).map((summary) => ({ conversation: conversation.title, type: conversation.type, summary })),
  );
  const sections: ContextSection[] = [];
  addSection(sections, {
    id: 'courier_archives', title: '手机聊天本地归档', category: '通讯', upload: true,
    content: JSON.stringify({ archiveFacts, pendingDeliverySeeds: state.手机.deliverySeeds.filter((seed) => seed.status === 'pending') }, null, 2),
  });
  return finalizeSnapshot('courier', '手机聊天上下文', sections, sourceInput);
}

function buildSteambirdContextSnapshot(state: UseGameStateReturn): ContextSnapshot {
  const sourceInput = latestUserInput(state.chatHistory);
  const publicFacts = state.蒸汽鸟报.articles.slice(0, 8).map((article) => ({ title: article.title, detail: article.body }));
  const sections: ContextSection[] = [];
  addSection(sections, {
    id: 'steambird_public_facts', title: '蒸汽鸟报公开事实 DTO', category: '公开事实', upload: true,
    content: JSON.stringify(buildSteambirdGenerationRequest({ publicFacts }), null, 2),
  });
  return finalizeSnapshot('steambird', '蒸汽鸟报上下文', sections, sourceInput);
}

function buildIrminsulContextSnapshot(state: UseGameStateReturn): ContextSnapshot {
  const sourceInput = latestUserInput(state.chatHistory);
  const entries = retrieveIrminsulEntries(state.世界树, sourceInput, state.gameSettings.记忆系统?.世界树召回条数 ?? 8);
  const sections: ContextSection[] = [];
  addSection(sections, {
    id: 'irminsul_recall', title: '世界树召回结果', category: '记忆', upload: true,
    content: entries.length ? entries.map((entry) => `${entry.title}\n${entry.summary || entry.sourceText}`).join('\n\n') : '（未命中）',
  });
  return finalizeSnapshot('irminsul', '世界树召回上下文', sections, sourceInput);
}

function buildCodexContextSnapshot(state: UseGameStateReturn): ContextSnapshot {
  const sourceInput = latestUserInput(state.chatHistory);
  const result = retrieveCodexEntries(state.图鉴, sourceInput, state.gameSettings.图鉴系统?.maxRelatedEntries ?? 5);
  const index = buildCodexAiCandidateIndex(state.图鉴, result.entries);
  const sections: ContextSection[] = [];
  addSection(sections, {
    id: 'codex_recall', title: '图鉴召回结果', category: '图鉴', upload: true,
    content: JSON.stringify({ candidates: index.candidates, injection: result.injection }, null, 2),
  });
  return finalizeSnapshot('codex', '图鉴召回上下文', sections, sourceInput);
}
