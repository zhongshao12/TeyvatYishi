//  ============================== Tavern Message Chain Builder ==============================
//  核心功能：按 ST 预设的 prompt_order 构建消息链，识别内置 identifier 并注入项目内容
//  参考实现：MoRanJiangHu-main/hooks/useGame/promptRuntime.ts 构建酒馆预设消息链函数 (L612-773)

import type { STMessageRole, STPreset, STPresetPrompt, STPresetOrder, STWorldInfoEntry, TavernMessage, TavernInternalMessage, TavernPostProcessMode } from '@/models/stTypes';
import { BUILTIN_MAIN_NARRATIVE_ID, type 提示词模块 } from '@/models/prompts';
import type { 角色数据结构 } from '@/models/character';
import type { 聊天消息 } from '@/models/chat';
import type { MacroContext } from '@/utils/macroEngine';
import { collectMacroAssignments, createMacroContext, processMacros } from '@/utils/macroEngine';
import { applyTavernFormatGuard, matchesTavernCotPlaceholder, matchesTavernFormatPlaceholder } from './tavernFormatGuard';

export const TAVERN_CHAR_COMPAT_PROMPT =
  '当前剧情中的主要互动对象、出场 NPC、同伴、敌对角色以及由 AI 负责扮演和调度的剧情角色集合。不要把 {{char}} 理解为固定角色卡；应根据最近剧情、玩家输入、聊天历史和世界状态判断当前焦点对象。';
const TAVERN_CHAR_FALLBACK_PROMPT =
  '你将扮演当前提瓦特剧情中所有由 AI 控制的原著角色、NPC、同伴、敌人和旁白，不代替自定义旅行者做决定。';

//  ---------- 辅助类型 ----------
export interface TavernChainParams {
  settings: any; // 游戏设置 - 需要访问 promptModules 获取上下文片段
  preset: STPreset;
  characterId: number | null;
  chatHistory: 聊天消息[];
  latestUserInput: string;
  playerName: string;
  playerRole: 角色数据结构 | null;
  worldbookExtraTexts?: string[];
  includeNativeContextInWorldbook?: boolean;
  /** false when the caller sends the native systemPrompt alongside this chain. */
  includeNativeNarrative?: boolean;
  triggerType?: string;
  macroCtx?: MacroContext;
}

interface TavernContextPieces {
  worldPrompt: string;
  cotPrompt: string;
  formatPrompt: string;
  actionOptionsPrompt: string;
  noControlPrompt: string;
  playerSpeechExpansionPrompt: string;
  personaPrompt: string;
  devModePrompt: string;
  writingStylePrompt: string;
}

//  ---------- 主函数 ----------
/**
 * 投递报告（2026-10-03）：让玩家看得到「预设到底哪一步没生效」。
 * 之前的导入提示只报总数（promptCount/orderCount），于是「预设没起作用」无法自查。
 */
export interface TavernChainReport {
  /** 本次构建是否产出了消息（false ⇒ 主剧情会回退 legacy 路径）。 */
  built: boolean;
  /** 启用的 order 条目数。 */
  enabledSlots: number;
  /** 真正作为消息送入请求的条目名。 */
  delivered: string[];
  /** ST 原生占位符（marker，设计上跳过，本体也不产出内容）。 */
  markers: string[];
  /** 「只定义变量」的条目：展开后为空、不产出消息（与本体一致），但变量已生效。 */
  definitionOnly: string[];
  /** order 里引用了、但 prompts 数组里不存在的悬空条目。 */
  dangling: string[];
  /** 渲染后仍残留的未展开宏（如非标准写法），它们会以字面量进入请求。 */
  unresolvedMacros: string[];
}

/** 每条消息的来源标注 → 人类可读的投递结论。 */
function buildReportNote(report: TavernChainReport): string {
  return [
    `送入 ${report.delivered.length}`,
    `定义型 ${report.definitionOnly.length}`,
    `原生占位 ${report.markers.length}`,
    `悬空 ${report.dangling.length}`,
    report.unresolvedMacros.length ? `未展开宏 ${report.unresolvedMacros.join('/')}` : '宏全部展开',
  ].join(' · ');
}

export function formatTavernChainReport(report: TavernChainReport): string {
  return buildReportNote(report);
}

export function buildTavernMessageChain(params: TavernChainParams, reportOut?: { current: TavernChainReport | null }): TavernMessage[] {
  // 1. 取预设与选中顺序
  const selectedOrder = getSTPresetOrder(params.preset, params.characterId);
  if (!params.preset || !selectedOrder) return [];
  
  // 2. 建立 identifier → prompt 索引
  const promptMap = new Map(
    (Array.isArray(params.preset.prompts) ? params.preset.prompts : [])
      .map((item) => [item.identifier, item] as const)
  );

  // 3. 过滤启用的 slot：enabled !== false
  const enabledOrderSlots = (Array.isArray(selectedOrder.order) ? selectedOrder.order : [])
    .filter((slot) => Boolean(slot) && slot.enabled !== false);

  // 4. 探测占位符和冲突规则
  const useCotVariableInjection = enabledOrderSlots.some((slot) => {
    const prompt = promptMap.get(slot.identifier);
    return matchesTavernCotPlaceholder(prompt?.content ?? '');
  });
  const useFormatVariableInjection = enabledOrderSlots.some((slot) => {
    const prompt = promptMap.get(slot.identifier);
    return matchesTavernFormatPlaceholder(prompt?.content ?? '');
  });
  const presetHasNoControl = presetContainsNoControl(params.preset, selectedOrder);
  const presetHasPlayerSpeechExpansion = presetContainsPlayerSpeechExpansion(params.preset, selectedOrder);

  // 5. 构建项目上下文片段（从 settings.promptModules 中提取内置模块内容）
  const contextPieces = buildContextPieces(params.settings, params.includeNativeNarrative !== false);

  // 6. 构建嫁接文本 combinedWorldbookText
  const worldbookText = params.includeNativeContextInWorldbook === false
    ? ''
    : buildWorldbookText(contextPieces, presetHasNoControl, presetHasPlayerSpeechExpansion);
  const presetWorldInfoText = buildPresetWorldInfoText(params);
  const combinedWorldbookText = [
    worldbookText,
    presetWorldInfoText,
    ...(Array.isArray(params.worldbookExtraTexts) ? params.worldbookExtraTexts : [])
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
  ]
    .filter(Boolean)
    .join('\n\n')
    .trim();

  // 7. 构建历史消息
  const historyMessages = buildTavernChatHistory(params.chatHistory);
  const personaProfile = buildTavernPersonaProfile(params.playerRole);
  const charRuntimeProfile = buildTavernCharRuntimeProfile(params);
  const macroCtx = params.macroCtx ?? createMacroContext(undefined, {
    charName: charRuntimeProfile,
    userName: params.playerName,
    lastMessage: getLastMessageContent(params.chatHistory),
    lastUserMessage: getLastMessageContent(params.chatHistory, 'user'),
    lastCharMessage: getLastMessageContent(params.chatHistory, 'assistant'),
    messageCount: params.chatHistory.length,
    turnCount: params.chatHistory.length,
  });

  // 7b. 预扫描变量定义（2026-10-03）：ST 预设里「只定义变量」的模块展开后是空串、不产生消息
  // （与 ST 一致），但消费方若排在定义之前就会读到空值，玩家会以为「预设没生效」。
  // 先把所有启用槽位的赋值宏按顺序跑一遍，让定义与顺序解耦。
  collectMacroAssignments(
    enabledOrderSlots.map((slot) => promptMap.get(slot.identifier)?.content ?? ''),
    macroCtx,
  );

  // 7c. 投递报告：逐槽位记下「送入 / 原生占位 / 定义型 / 悬空」，构建结束后交给调用方展示。
  const report: TavernChainReport = {
    built: false, enabledSlots: enabledOrderSlots.length,
    delivered: [], markers: [], definitionOnly: [], dangling: [], unresolvedMacros: [],
  };
  if (reportOut) reportOut.current = report;

  // 8. 遍历启用的 slot，按 identifier 分派
  const messages: TavernInternalMessage[] = [];
  let worldbookInjected = false;
  let latestInputInjected = false;
  let cotInjectedViaPlaceholder = false;
  let formatInjectedViaPlaceholder = false;

  for (const slot of enabledOrderSlots) {
    const identifier = slot.identifier;
    const prompt = promptMap.get(identifier);

    // 特殊 identifier 是 prompt_order 的运行时槽位。部分 ST 导出不会在 prompts
    // 数组里附带对应对象，因此必须先按槽位处理，再要求普通 prompt 存在。
    if (identifier === 'worldInfoBefore' || identifier === 'worldInfoAfter') {
      if (!worldbookInjected && combinedWorldbookText) {
        messages.push({ role: 'system', content: combinedWorldbookText, source: 'worldbook' });
        worldbookInjected = true;
      }
      continue;
    }

    if (identifier === 'chatHistory') {
      historyMessages.forEach((msg) => messages.push({ ...msg, source: 'history' }));
      if (historyContainsLatestInput(historyMessages, params.latestUserInput)) latestInputInjected = true;
      continue;
    }

    if (identifier === 'personaDescription') {
      if (personaProfile) {
        const role = prompt?.role === 'user' || prompt?.role === 'assistant' ? prompt.role : 'system';
        messages.push({ role, content: personaProfile, source: 'persona' });
      }
      continue;
    }

    if (identifier === 'userInput' || identifier === 'user_input' || identifier === 'latestUserInput' || identifier === 'input') {
      if (params.latestUserInput) {
        messages.push({ role: 'user', content: params.latestUserInput, source: 'latest_input' });
        latestInputInjected = true;
      }
      continue;
    }

    if (!prompt) {
      report.dangling.push(identifier);
      continue;
    }

    // 其他普通 prompt 项：变量替换 + 按 role 推送
    const rawContent = typeof prompt.content === 'string' ? prompt.content : '';
    const slotName = prompt.name?.trim() || identifier;
    if (prompt.marker === true) report.markers.push(slotName);
    const resolved = replaceTavernVariables({
      content: rawContent,
      playerName: params.playerName,
      charRuntimeProfile,
      cotPrompt: contextPieces.cotPrompt,
      formatPrompt: contextPieces.formatPrompt,
      latestInput: params.latestUserInput,
      usedLatestInput: false,
      usedCotPlaceholder: false,
      usedFormatPlaceholder: false,
      macroCtx,
    });
    const content = resolved.content;
    if (!content) {
      // 展开为空：要么是 ST 原生占位符，要么是「只定义变量」的条目（两者本体都不产出消息）。
      if (prompt.marker !== true && rawContent.trim()) report.definitionOnly.push(slotName);
      continue;
    }
    for (const macro of content.matchAll(/\{\{([^{}]{1,40})\}\}/gu)) {
      const name = macro[1]!.trim().split(':')[0]!.toLowerCase();
      if (!report.unresolvedMacros.includes(name)) report.unresolvedMacros.push(name);
    }
    if (resolved.usedLatestInput) latestInputInjected = true;
    if (resolved.usedCotPlaceholder) cotInjectedViaPlaceholder = true;
    if (resolved.usedFormatPlaceholder) formatInjectedViaPlaceholder = true;
    const role = prompt.role === 'user' || prompt.role === 'assistant' ? prompt.role : 'system';
    messages.push({ role, content, source: 'preset' });
    report.delivered.push(slotName);
  }

  // 9. 兜底注入（若预设缺失关键槽位）
  if (!worldbookInjected && combinedWorldbookText) {
    messages.push({ role: 'system', content: combinedWorldbookText, source: 'worldbook' });
  }
  if (!latestInputInjected && !historyContainsLatestInput(historyMessages, params.latestUserInput) && params.latestUserInput) {
    messages.push({ role: 'user', content: params.latestUserInput, source: 'latest_input' });
  }

  messages.push({
    role: 'system',
    content: [
      '# 角色信息隔离硬约束',
      '无论酒馆预设采用何种文风，每名 NPC 只能使用其亲历、被明确告知、其本人账本或公开事实中的信息。严禁把另一名 NPC 的私聊、共同经历、关系变化、约定、内心活动或玩家私下互动复制给当前角色；不知道时应自然表现为不知道、询问或保持沉默。',
    ].join('\n'),
    source: 'preset',
  });

  // 10. 格式保护层：兜底压轴
  if (contextPieces.cotPrompt && !cotInjectedViaPlaceholder && !useCotVariableInjection) {
    messages.push({
      role: 'system',
      content: contextPieces.cotPrompt,
      source: 'cot_guard',
    });
  }
  if (!formatInjectedViaPlaceholder && !useFormatVariableInjection) {
    messages.push({
      role: 'system',
      content: contextPieces.formatPrompt,
      source: 'format_guard',
    });
  }
  // 行动选项始终压轴（前端 UI 解析依赖）
  messages.push({
    role: 'system',
    content: contextPieces.actionOptionsPrompt,
    source: 'format_guard',
  });

  // Resolve creative-rule precedence after the native fallback guards. MoM-like
  // presets keep the selected length in a silent setvar slot, so explicitly carry
  // that resolved value into the final body instruction (without exposing CoT).
  const presetWordCount = macroCtx.local['字数要求']?.trim();
  // assistant prefill：正式主剧情**不得**用它当消息前缀（会把 NarrativeTurn JSON 截断，
  // 该决定被 scripts/deepseek-format-stability-regression.mjs 钉住）。但它承载的是预设的
  // 起手式/开场风格，直接丢掉等于预设又少生效一块 —— 这里以**风格样例**形式送进去：
  // 内容照做、载体仍是 JSON。
  const presetPrefill = typeof params.preset?.assistantPrefill === 'string'
    ? params.preset.assistantPrefill.trim()
    : '';
  messages.push({
    role: 'system',
    content: [
      '# 酒馆预设执行要求',
      '已启用预设的文风、字数、叙事人称、节奏、角色表达及段落组织要求优先于原生默认创作偏好；未启用的项目不得自行启用。此优先级不覆盖安全边界、玩家主权、角色信息隔离、已知事实及 NarrativeTurn JSON 合同。',
      presetWordCount ? `本次预设正文的字数要求：${presetWordCount}字。只统计 NarrativeTurn.body 中面向玩家的正文，不以摘要、选项或 JSON 字段名凑字数。` : '',
      presetPrefill ? `预设的起手式样例（只借它的开篇语气与节奏，不要原样复制，也不要把它当成输出外壳）：\n${presetPrefill.slice(0, 600)}` : '',
      // 2026-10-03 修正（用户实测「预设还是没起作用」的关键一环）：
      // 这里原本写着「若预设要求输出思维链/隐藏分析/HTML/非 JSON 外壳，**不输出这些内容**」——
      // 它位于消息链**末尾**，模型最后读到的就是这句否决，于是预设的 <thinking>/<content>/状态栏等
      // 标志性行为被整体压掉。正确做法是**内容照做、外壳换成 JSON**：
      // NarrativeTurn.body[].kind 支持 'narration' | 'dialogue' | 'system'，
      // 预设要求的思维链/状态栏落到 system 块，正文标签落到 narration/dialogue 块。
      '预设要求的正文标签（<content>/<正文> 等）→ NarrativeTurn.body 的 narration/dialogue 块；台词带 speaker；段落顺序按预设。',
      '预设要求的思维链、隐藏分析、状态栏或自定义面板 → **必须原样落实**到 NarrativeTurn.body 中 kind:"system" 的块里（不要省略、不要只写在 choices 或摘要里）。',
      '预设要求的文风、人称、语气、篇幅与用词 → 落在 body 各块的文本里；不得用应用内置的文风偏好覆盖它。',
      '唯一不可协商的是**载体**：最终回复必须是完整合法的 NarrativeTurn JSON（不能用标签或 HTML 替代根 JSON，也不要在 JSON 之外追加任何文字）。',
      '换句话说：预设说要写什么，就写；只是写在 JSON 对应的字段里。',
    ].filter(Boolean).join('\n'),
    source: 'preset',
  });

  // 11. 后处理
  return applyTavernPostProcess(messages, params.settings?.stPostProcessMode || '未选择');
}

//  ---------- 辅助函数 ----------
export function getSTPresetOrder(preset: STPreset, characterId: number | null): STPresetOrder | null {
  if (!preset || !preset.prompt_order || preset.prompt_order.length === 0) return null;
  
  // 优先使用指定的 characterId
  if (characterId !== null) {
    const found = preset.prompt_order.find((order) => order.character_id === characterId);
    if (found) return found;
  }
  
  // 回退到默认 100001（ST 通用默认）
  const defaultOrder = preset.prompt_order.find((order) => order.character_id === 100001);
  if (defaultOrder) return defaultOrder;
  
  // 最后回退到第一项
  return preset.prompt_order[0] ?? null;
}

function matchesCotPlaceholder(content: string): boolean {
  return /\{\{\s*cot\s*\}\}/i.test(content);
}

function matchesFormatPlaceholder(content: string): boolean {
  return /\{\{\s*格式\s*\}\}/i.test(content) || /\{\{\s*format\s*\}\}/i.test(content);
}

function buildContextPieces(settings: any, includeNativeNarrative: boolean): TavernContextPieces {
  // 从 settings.promptModules 中查找内置模块内容
  const modules = settings.promptModules || [];
  
  const findModuleContent = (id: string): string => {
    const mod = modules.find((m: 提示词模块) => m.id === id);
    return mod ? (mod.content || '') : '';
  };
  
  // 提取关键内置模块的内容
  const worldPrompt = findModuleContent('builtin_world_prompt') || 
                     (settings.世界观提示词 || '');
  const cotPrompt = includeNativeNarrative ? findModuleContent(BUILTIN_MAIN_NARRATIVE_ID) || '' : '';
  const formatPrompt = findModuleContent('builtin_response_format') || '';
  const actionOptionsPrompt = findModuleContent('builtin_action_options') || '';
  const noControlPrompt = settings?.enableNoControl === false ? '' : findModuleContent('builtin_no_control') || '';
  const playerSpeechExpansionPrompt = settings?.enablePlayerSpeechExpansion === true ? findModuleContent('builtin_player_speech_expansion') || '' : '';
  const personaPrompt = findModuleContent('builtin_narrator_persona') || '';
  const devModePrompt = findModuleContent('builtin_dev_mode') || '';
  const writingStylePrompt = findModuleContent('builtin_writing_style') || '';
  
  return {
    worldPrompt,
    cotPrompt,
    formatPrompt,
    actionOptionsPrompt,
    noControlPrompt,
    playerSpeechExpansionPrompt,
    personaPrompt,
    devModePrompt,
    writingStylePrompt,
  };
}

function buildWorldbookText(pieces: TavernContextPieces, presetHasNoControl: boolean, presetHasPlayerSpeechExpansion: boolean): string {
  const parts: string[] = [
    pieces.worldPrompt,
    pieces.personaPrompt,
    pieces.devModePrompt,
    pieces.writingStylePrompt,
    presetHasNoControl ? '' : pieces.noControlPrompt,
    presetHasPlayerSpeechExpansion ? '' : pieces.playerSpeechExpansionPrompt,
  ];
  return parts.filter(Boolean).join('\n\n').trim();
}

export function buildPresetWorldInfoText(params: TavernChainParams): string {
  const entries = getPresetWorldInfoEntries(params.preset);
  if (entries.length === 0) return '';

  const haystack = buildWorldInfoHaystack(params);
  const triggered = entries
    .filter((entry) => shouldInjectPresetWorldInfoEntry(entry, haystack))
    .sort((a, b) => readNumber(a.order, 100) - readNumber(b.order, 100));

  if (triggered.length === 0) return '';

  const blocks = triggered.map((entry) => {
    const title = readWorldInfoTitle(entry);
    const content = readString(entry.content).trim();
    return title ? `### ${title}\n${content}` : content;
  }).filter(Boolean);

  return blocks.length > 0 ? ['# 预设世界书', ...blocks].join('\n\n') : '';
}

function getPresetWorldInfoEntries(preset: STPreset): STWorldInfoEntry[] {
  const worldInfo = preset.world_info;
  if (Array.isArray(worldInfo)) return worldInfo;
  if (worldInfo && typeof worldInfo === 'object') return Object.values(worldInfo);
  return [];
}

function shouldInjectPresetWorldInfoEntry(entry: STWorldInfoEntry, haystack: string): boolean {
  const content = readString(entry.content).trim();
  if (!content) return false;
  if (entry.enabled === false) return false;
  if (readBool(entry.constant)) return passesPresetWorldInfoProbability(entry, haystack);

  const primaryKeys = readStringArray(entry.key);
  const secondaryKeys = readStringArray(entry.keysecondary);
  if (primaryKeys.length === 0) return false;
  const useRegex = readBool((entry as { useRegex?: unknown }).useRegex);
  const primaryMatched = matchAnyWorldInfoKey(primaryKeys, haystack, useRegex);
  if (!primaryMatched) return false;

  if (readBool(entry.selective) && secondaryKeys.length > 0) {
    const secondaryMatched = matchAnyWorldInfoKey(secondaryKeys, haystack, useRegex);
    if (!secondaryMatched) return false;
  }

  return passesPresetWorldInfoProbability(entry, haystack);
}

function buildWorldInfoHaystack(params: TavernChainParams): string {
  const historyText = params.chatHistory
    .slice(-20)
    .map((msg) => (typeof msg.content === 'string' ? msg.content : ''))
    .filter(Boolean)
    .join('\n');
  return [
    params.latestUserInput,
    params.playerName,
    historyText,
  ].filter(Boolean).join('\n').toLowerCase();
}

function matchAnyWorldInfoKey(keys: string[], haystack: string, useRegex: boolean): boolean {
  return keys.some((key) => {
    const normalized = key.trim();
    if (!normalized) return false;
    if (!useRegex) return haystack.includes(normalized.toLowerCase());
    try {
      return new RegExp(normalized, 'iu').test(haystack);
    } catch {
      return haystack.includes(normalized.toLowerCase());
    }
  });
}

function passesPresetWorldInfoProbability(entry: STWorldInfoEntry, haystack: string): boolean {
  const probability = Math.max(0, Math.min(100, readNumber(entry.probability, 100)));
  if (probability >= 100) return true;
  if (probability <= 0) return false;
  return stablePercent(`${readString(entry.uid)}:${readString(entry.content)}:${haystack}`) < probability;
}

function stablePercent(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 100;
}

function readWorldInfoTitle(entry: STWorldInfoEntry): string {
  return readString(entry.comment) || readString(entry.uid && `world_info_${entry.uid}`);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => readString(item).trim()).filter(Boolean);
}

function readBool(value: unknown): boolean {
  return value === true || value === 1 || value === 'true';
}

function readNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function buildTavernChatHistory(history: 聊天消息[]): Array<{role: STMessageRole; content: string; source: 'history'}> {
  const messages: Array<{role: STMessageRole; content: string; source: 'history'}> = [];
  for (const msg of history) {
    const role = msg.role === 'user' || msg.role === 'assistant' || msg.role === 'system' ? msg.role : 'system';
    const content = buildTavernHistoryContent(msg);
    if (!content) continue;
    messages.push({
      role,
      content,
      source: 'history'
    });
  }
  return messages;
}

function buildTavernHistoryContent(msg: 聊天消息): string {
  if (msg.role !== 'assistant') return typeof msg.content === 'string' ? msg.content.trim() : '';
  const parsed = msg.parsedResponse;
  return parsed ? JSON.stringify(parsed) : (typeof msg.content === 'string' ? msg.content.trim() : '');
}

function getLastMessageContent(history: 聊天消息[], role?: STMessageRole): string {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const msg = history[i];
    if (!msg) continue;
    if (role && msg.role !== role) continue;
    const content = typeof msg.content === 'string' ? msg.content.trim() : '';
    if (content) return content;
  }
  return '';
}

function historyContainsLatestInput(history: Array<{role: STMessageRole; content: string; source: 'history'}> | undefined, latestInput: string): boolean {
  if (!history || !latestInput) return false;
  return history.some(msg => msg.role === 'user' && msg.content.includes(latestInput));
}

function buildTavernPersonaProfile(playerRole: 角色数据结构 | null): string {
  if (!playerRole) return '';
  const lines = [
    playerRole.姓名 ? `姓名：${playerRole.姓名}` : '',
    playerRole.别名 ? `别名：${playerRole.别名}` : '',
    playerRole.性别 ? `性别：${playerRole.性别}` : '',
    Number.isFinite(playerRole.年龄) ? `年龄：${playerRole.年龄}` : '',
    playerRole.生日 ? `生日：${playerRole.生日}` : '',
    playerRole.身高 ? `身高：${playerRole.身高}` : '',
    playerRole.身份 ? `身份：${playerRole.身份}` : '',
    playerRole.外貌 ? `外貌：${playerRole.外貌}` : '',
    playerRole.性格 ? `性格：${playerRole.性格}` : '',
    playerRole.背景 ? `背景：${playerRole.背景}` : '',
    Array.isArray(playerRole.专长知识) && playerRole.专长知识.length > 0
      ? `专长知识：${playerRole.专长知识.join('、')}`
      : '',
  ].filter(Boolean);
  return lines.length > 0 ? ['# 玩家档案', ...lines].join('\n') : '';
}

export function buildTavernCharRuntimeProfile(params: TavernChainParams): string {
  const focusNames = extractPossibleNpcNames([
    params.latestUserInput,
    getLastMessageContent(params.chatHistory, 'assistant'),
    getLastMessageContent(params.chatHistory, 'user'),
  ]);
  const focusText = focusNames.length > 0
    ? `当前剧情焦点角色候选：${focusNames.slice(0, 8).join('、')}。`
    : '';
  const historyHint = getLastMessageContent(params.chatHistory, 'assistant');
  const historyText = historyHint
    ? `最近一次 AI 叙事片段可作为判断当前登场 NPC 和旁白职责的依据：${historyHint.slice(0, 240)}`
    : '';
  return [
    TAVERN_CHAR_COMPAT_PROMPT,
    focusText,
    historyText,
    TAVERN_CHAR_FALLBACK_PROMPT,
  ].filter(Boolean).join('\n');
}

function extractPossibleNpcNames(texts: string[]): string[] {
  const found = new Set<string>();
  const patterns = [
    /(?:【|「|『)([^】」』]{1,16})(?:】|」|』)/g,
    /(?:^|[\s，。、“”])([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z·]{1,15})(?:说|问|答|看向|望向|走来|喊道|低声|轻声|笑道)/g,
  ];
  for (const text of texts) {
    if (!text) continue;
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        const name = match[1]?.trim();
        if (name && !isLikelyNonCharacterName(name)) found.add(name);
      }
    }
  }
  return [...found];
}

function isLikelyNonCharacterName(name: string): boolean {
  return /^(玩家|用户|系统|旁白|正文|行动选项|变量更新|天气|剧情规划|发送者|assistant|user|system)$/i.test(name);
}

function replaceTavernVariables(params: {
  content: string;
  playerName: string;
  charRuntimeProfile: string;
  cotPrompt: string;
  formatPrompt: string;
  latestInput: string;
  usedLatestInput: boolean;
  usedCotPlaceholder: boolean;
  usedFormatPlaceholder: boolean;
  macroCtx?: MacroContext;
}): {content: string; usedLatestInput: boolean; usedCotPlaceholder: boolean; usedFormatPlaceholder: boolean} {
  let resolved = params.content;
  let usedLatestInput = params.usedLatestInput;
  let usedCotPlaceholder = params.usedCotPlaceholder;
  let usedFormatPlaceholder = params.usedFormatPlaceholder;

  // 用户输入类占位符
  const inputPatterns = [
    /\{\{\s*userinput\s*\}\}/gi,
    /\{\{\s*input\s*\}\}/gi,
    /\{\{\s*lastinput\s*\}\}/gi,
    /<\s*userinput\s*>/gi,
    /<\s*user_input\s*>/gi,
    /<\s*input\s*>/gi
  ];
  for (const pattern of inputPatterns) {
    if (pattern.test(resolved)) {
      resolved = resolved.replace(pattern, params.latestInput);
      usedLatestInput = true;
    }
  }

  // 其他占位符
  if (params.playerName) {
    resolved = resolved.replace(/\{\{\s*user\s*\}\}/gi, params.playerName);
  }
  resolved = resolved.replace(/\{\{\s*char\s*\}\}/gi, params.charRuntimeProfile);
  resolved = resolved.replace(/<\s*charname\s*>/gi, params.charRuntimeProfile);
  
  const cotMatch = resolved.match(/\{\{\s*cot\s*\}\}/i);
  if (cotMatch) {
    resolved = resolved.replace(/\{\{\s*cot\s*\}\}/gi, params.cotPrompt);
    usedCotPlaceholder = true;
  }
  
  const formatMatch = resolved.match(/\{\{\s*(?:格式|format)\s*\}\}/i);
  if (formatMatch) {
    resolved = resolved.replace(/\{\{\s*(?:格式|format)\s*\}\}/gi, params.formatPrompt);
    usedFormatPlaceholder = true;
  }

  if (params.macroCtx) {
    try {
      resolved = processMacros(resolved, params.macroCtx);
    } catch (error) {
      console.warn('[TavernPreset] 宏处理失败，保留原文本', error);
    }
  }

  return {content: resolved, usedLatestInput, usedCotPlaceholder, usedFormatPlaceholder};
}

function presetContainsNoControl(preset: STPreset, selectedOrder: STPresetOrder): boolean {
  const noControlKeywords = /NoControl|防止说话|防抢话|禁止代写|不得代写|不代写玩家|不替玩家|绝不控制|禁止控制玩家|不控制玩家|玩家的台词|玩家言行|代替玩家发言/iu;
  const enabledIds = new Set(selectedOrder.order
    .filter(slot => slot.enabled !== false)
    .map(slot => slot.identifier));
  
  return (Array.isArray(preset.prompts) ? preset.prompts : []).some(prompt => {
    if (!enabledIds.has(prompt.identifier)) return false;
    return noControlKeywords.test(`${prompt.identifier}\n${prompt.name || ''}\n${prompt.content || ''}`);
  });
}

function presetContainsPlayerSpeechExpansion(preset: STPreset, selectedOrder: STPresetOrder): boolean {
  const speechExpansionKeywords = /抢话|嘴替|代写玩家对白|代替玩家说话|玩家对白扩写|扩写玩家|加强复述|扩写后推进|主动替玩家|user 的嘴替/iu;
  const enabledIds = new Set(selectedOrder.order
    .filter(slot => slot.enabled !== false)
    .map(slot => slot.identifier));

  return (Array.isArray(preset.prompts) ? preset.prompts : []).some(prompt => {
    if (!enabledIds.has(prompt.identifier)) return false;
    return speechExpansionKeywords.test(`${prompt.identifier}\n${prompt.name || ''}\n${prompt.content || ''}`);
  });
}

function applyTavernPostProcess(messages: TavernInternalMessage[], mode: TavernPostProcessMode): TavernMessage[] {
  // 角色重写
  const mapped: TavernMessage[] = messages.map((item) => {
    if (mode === '严格') {
      if (item.source === 'history' || item.source === 'latest_input') {
        return { role: item.role, content: item.content };
      }
      return { role: 'system', content: item.content };
    }
    if (mode === '半严格') {
      if (item.source === 'history' || item.source === 'latest_input') {
        return { role: item.role, content: item.content };
      }
      return {
        role: item.role === 'assistant' ? 'user' : item.role,
        content: item.content
      };
    }
    if (mode === '单一用户') {
      if (item.source === 'history' || item.source === 'latest_input') {
        return { role: item.role, content: item.content };
      }
      return {
        role: item.role === 'system' ? 'system' : 'user',
        content: item.content
      };
    }
    // 未选择或其他：保持原 role
    return item;
  });

  // 相邻同角色合并 + 空内容过滤
  const merged: TavernMessage[] = [];
  mapped.forEach((item) => {
    const trimmed = (item.content || '').trim();
    if (!trimmed) return;
    const last = merged[merged.length - 1];
    if (last && last.role === item.role) {
      last.content = `${last.content}\n\n${trimmed}`.trim();
      return;
    }
    merged.push({ role: item.role, content: trimmed });
  });
  return merged;
}
