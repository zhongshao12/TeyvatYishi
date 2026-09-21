import type { 角色数据结构 } from '@/models/character';
import type { 世界状态 } from '@/models/world';
import type { 记忆系统 } from '@/models/memory';
import type { 游戏设置 } from '@/models/settings';
import type { 提示词模块, 提示词模块作用域 } from '@/models/prompts';
import { PROMPT_MODULE_TOP_THRESHOLD } from '@/models/prompts';
import type { 开局来源 } from '@/models/teyvat/opening';
import type { ElementId } from '@/models/teyvat/elements';
import type { 世界书 } from '@/models/worldbook';
import type { NPC记录, NPC账本选择结果, NPC同行记忆条目 } from '@/models/npc';
import { formatNpcLedgerForPrompt, 格式化NPC关系, selectNpcLedgersForTurn, 提取NPC同行记忆文本列表 } from '@/models/npc';
import type { 剧情节点 } from '@/models/plot';
import { PLOT_STATUS_LABELS } from '@/models/plot';
import type { 剧情编织系统 } from '@/models/storyWeaving';
import type { ArchiveCodex, CanonTrack, CourierSystem, IrminsulMemory, SteambirdNews } from '@/models/teyvat';
import type { 任务系统 } from '@/models/quest';
import type { ItemCategory, TeyvatInventory, TeyvatItem } from '@/models/teyvat/items';
import { getStartingScenario } from '@/data/journeyPresets';
import { buildPromptLikeWorldbookInjection, buildWorldbookChatModuleMessages, buildWorldbookInjection, replaceWorldbookPlaceholders, type FilterContext } from '@/utils/worldbook';
import { retrieveCodexEntries } from '@/services/codexRetrieval';
import { retrieveIrminsulEntries } from '@/services/irminsulRetrieval';
import { buildStoryWeavingInjection } from '@/services/storyWeaving';
import {
  MAIN_LONG_TERM_MEMORY_PROMPT_LIMIT,
  MAIN_MIDDLE_TERM_MEMORY_PROMPT_LIMIT,
  MAIN_SHORT_TERM_MEMORY_PROMPT_LIMIT,
} from './historyWindow';
import { getAnticipatedNpcNamesForTurn } from './npcPresence';
import { processMacros, type MacroContext } from '@/utils/macroEngine';
import { 分析提示词构成, type 提示词构成 } from '@/utils/contextComposition';
import { isSTImportedModule } from '@/utils/stPresetParser';
import { canInviteElementalEcho, ELEMENTAL_ECHO_INVITE_MASTERY } from '@/services/elementalAttunementService';
import { ELEMENT_NAMES } from '@/styles/elementTokens';

const ELEMENT_ECHO_QUESTIONS: Record<ElementId, readonly string[]> = {
  anemo: ['自由是否也意味着承担离去的代价？', '当羁绊成为束缚，你愿意留下还是远行？', '你如何让他人也能自由呼吸？'],
  geo: ['承诺与变化冲突时，你会守住什么？', '坚固是否必然意味着拒绝改变？', '你愿意为守护承担怎样的重量？'],
  electro: ['永恒与当下相冲突时，你珍惜哪一个？', '失去是否会让你停在原地？', '你如何在瞬息中确认自己的选择？'],
  dendro: ['知识与生命相冲突时，你会如何取舍？', '理解他人是否也要接受未知？', '成长要求割舍旧认知时，你愿意吗？'],
  hydro: ['裁决他人之前，你如何审视自己？', '真相伤人时，你仍会让它流向众人吗？', '公正与怜悯相冲突时，你守护什么？'],
  pyro: ['热望燃尽之后，什么还能支撑你？', '胜负与同伴相冲突时，你会选择什么？', '你的火焰是为了证明自己还是照亮他人？'],
  cryo: ['保护自己与回应他人相冲突时，你会怎么做？', '旧伤是否必须决定今天的距离？', '你愿意为重要之人融化哪一道防线？'],
};

// 当前 prompt 为重构期的中性骨架，具体的世界观/人物设定由世界书注入，
// 「踏上旅途」向导写入的字段在此被汇总输出。
//
export type 元素回响阶段 = 'question' | 'judgement';

export function buildSystemPrompt(
  traveler: 角色数据结构,
  worldState: 世界状态,
  memorySystem: 记忆系统,
  settings: 游戏设置,
  _turnCount: number,
  worldbooks?: 世界书[],
  worldbookCtx?: FilterContext & { canonTrack?: CanonTrack },
  npcRecords?: NPC记录[],
  steambird?: SteambirdNews,
  plotNodes?: 剧情节点[],
  storyWeaving?: 剧情编织系统,
  codex?: ArchiveCodex,
  irminsul?: IrminsulMemory,
  courier?: CourierSystem,
  awakeningPhase?: 元素回响阶段,
  irminsulInjectionOverride?: string,
  codexInjectionOverride?: string,
  suppressMemoryInjection?: boolean,
  npcLedgerSelectionOverride?: NPC账本选择结果,
  triggerType?: string,
  macroCtx?: MacroContext,
  任务?: 任务系统,
  inventory?: TeyvatInventory,
): BuiltSystemPrompt {
  const parts: string[] = [];
  const allChatMessages: ChatModuleMessage[] = [];
  // ST 预设总开关：关闭时过滤所有 st_import_* 模块（保留预设库数据，仅不注入）。
  // V2 酒馆预设使用原始 prompts + prompt_order 消息链；选中 V2 时也隔离 V1 st_import_* 残留，
  // 避免同一份 ST 预设以 V1 模块和 V2 消息链两种形态重复注入。
  const shouldFilterLegacyStModules = settings.enableStPreset === false || Boolean(settings.currentStPresetIdV2);
  const effectiveModules = shouldFilterLegacyStModules
    ? settings.promptModules.filter((m) => !isSTImportedModule(m))
    : settings.promptModules;

  const personLabel =
    settings.narrativePerson === 'second' ? '第二人称"你"'
    : settings.narrativePerson === 'first' ? '第一人称"我"'
    : '第三人称"他/她"';
  // 提示词模块按当前 scope 过滤；scope 信息来自 worldbookCtx.currentScope（与世界书共用一个）。
  // 元素回响进行中时，专用作用域替代主剧情流程。
  const baseScope: 提示词模块作用域 = worldbookCtx?.currentScope ?? 'main';
  const currentScope: 提示词模块作用域 = worldState.进行中元素回响 ? 'elementalEcho' : baseScope;
  const moduleCtx: PromptModuleInjectionCtx = {
    wordCountTarget: settings.wordCountTarget,
    personLabel,
    playerName: getPromptPlayerName(traveler),
    currentScope,
    openingSource: worldState.开局档案?.来源,
    triggerType,
    macroCtx,
    worldbookCtx,
  };

  // ── 提示词模块·顶部（order < 30：开发者模式、叙述者人格等） ──
  const topResult = injectPromptModules(effectiveModules, moduleCtx, 'top');
  if (topResult.systemSection) parts.push(topResult.systemSection);
  allChatMessages.push(...topResult.chatModuleMessages);

  // ── 世界书稳定规则（system_rule + 少量核心锚点）：保留稳定位置，同时统一受世界书总开关控制 ──
  if (settings.enableWorldbookInjection && worldbooks && worldbookCtx) {
    const promptLikeWorldbook = buildPromptLikeWorldbookInjection(worldbooks, worldbookCtx);
    if (promptLikeWorldbook) parts.push(promptLikeWorldbook);
  }

  // ── 提示词模块·稳定协议（order >= 30：CoT、回复格式、文风、玩家自定义模块） ──
  // DeepSeek 等前缀缓存要求从请求开头连续一致。把大块固定协议放在动态场景/记忆/图鉴之前，
  // 可以让后续回合即便状态块变化，也尽量复用前面的稳定前缀。
  const bottomResult = injectPromptModules(effectiveModules, moduleCtx, 'bottom');
  if (bottomResult.systemSection) parts.push(bottomResult.systemSection);
  allChatMessages.push(...bottomResult.chatModuleMessages);

  // ── 思维链输出语言（cotLanguage，参考 Izumi，P2 可选）──
  // 仅 main scope 且 cotLanguage 非 zh 时注入。位置紧随 bottom 模块（含主剧情 CoT）之后，
  // 让 AI 在进入思考段前看到语言指示。
  const cotLanguageSection = buildCotLanguageSection(settings, currentScope);
  if (cotLanguageSection) parts.push(cotLanguageSection);

  // ── 结构轮(D1/D2, 2026-07-26)：基调行删除(剧情模式世界书为唯一出处)；字数/发言归属硬编码段删除
  //    (唯一权威=「回复格式」模块,生成点兜底=sendWorkflow 区E执法块)；运行锚点瘦身并后移至
  //    区D(紧贴即时回顾/编织/图鉴数据,见下方 storyWeaving 之前)。──
  const innerVoiceSection = buildInnerVoiceSection(settings);
  if (innerVoiceSection) parts.push(innerVoiceSection);

  const openingArchiveSection = buildOpeningArchiveSection(worldState, currentScope === 'opening');
  if (openingArchiveSection) parts.push(openingArchiveSection);

  // ── 当前角色与相对稳定的角色能力：通常比本回合状态变化慢，放在动态块之前提高缓存前缀长度。 ──
  parts.push(buildCharacterSection(traveler));

  const skillSection = buildSkillSection(traveler);
  if (skillSection) parts.push(skillSection);

  // ── 以下为每回合运行时上下文：半稳定资料先放，高波动回合锚点与 NPC 承接块在尾部兜底。 ──
  // ── 背包（最多前 10 件，按 category 分组） ──
  const inventorySection = buildInventorySection(inventory);
  if (inventorySection) parts.push(inventorySection);

  // ── 剧情（active + 最近 3 个 completed + hintForAI） ──
  const plotSection = buildPlotSection(plotNodes);
  if (plotSection) parts.push(plotSection);

  // ── 蒸汽鸟报（最近 5 条标题） ──
  const steambirdSection = buildSteambirdSection(steambird);
  if (steambirdSection) parts.push(steambirdSection);

  // ── 信使通讯（只注入已压缩摘要与待处理来信，不注入完整通信原文） ──
  const courierSection = buildCourierSection(courier);
  if (courierSection) parts.push(courierSection);

  // ── 剧情任务（只注入进行中任务清单与进度；协议模块由 builtinPromptModules 注入）──
  if (settings.任务系统?.enabled) {
    const questSection = buildQuestSection(任务);
    if (questSection) parts.push(questSection);
  }

  // ── 世界书注入（受 settings.enableWorldbookInjection 控制；首回合规范以条目形式存在于内置世界书）──
  if (settings.enableWorldbookInjection && worldbooks && worldbookCtx) {
    const injection = buildWorldbookInjection(worldbooks, worldbookCtx);
    if (injection) {
      parts.push(injection);
    }
    // Phase 7.2：世界书深度插入条目转 ChatModuleMessage（注入到聊天历史指定 depth）
    const worldbookDepthMessages = buildWorldbookChatModuleMessages(worldbooks, worldbookCtx);
    if (worldbookDepthMessages.length > 0) {
      allChatMessages.push(...worldbookDepthMessages);
    }
  }

  // ── 高波动回合锚点后置，用于保护 DeepSeek/OpenAI-compatible 前缀缓存。 ──
  // 时间、场景、即时回顾、图鉴表演卡、记忆和 NPC 账本仍完整注入，只是不再抢占稳定前缀。
  const timeAnchor = buildCurrentTimeAnchorSection(worldState);
  if (timeAnchor) parts.push(timeAnchor);

  // ── 当前场景：仍紧跟时间锚点，确保地点 / 环境优先于后续回忆与角色承接块被读取 ──
  const sceneFromWorldbook = buildSceneSection(worldState);
  if (sceneFromWorldbook) parts.push(sceneFromWorldbook);

  // ── 区D(结构轮)：剧情与知识——运行锚点瘦身版先声明数据使用优先级,随后紧跟被它引用的
  //    即时回顾/编织滑窗/图鉴数据块,消除"指令与数据相隔11段"的失效因素。──
  if (currentScope === 'main') {
    parts.push(buildMainStoryControlSection(worldState));
  }

  // ── 世界树记忆召回（沿用现有记忆设置阈值） ──
  const irminsulEnabled = settings.记忆系统?.世界树启用 !== false;
  const irminsulThreshold = settings.记忆系统?.世界树召回最早触发回合 ?? 10;
  if (irminsulInjectionOverride !== undefined) {
    if (irminsulInjectionOverride.trim()) parts.push(irminsulInjectionOverride.trim());
  } else if (irminsulEnabled && irminsul && worldbookCtx?.recentUserInput && worldbookCtx.turnCount > irminsulThreshold) {
    const limit = settings.记忆系统?.世界树召回条数 ?? 8;
    const entries = retrieveIrminsulEntries(irminsul, worldbookCtx.recentUserInput, limit);
    const injection = entries.map((entry) => entry.summary || entry.sourceText).filter(Boolean).join('\n\n');
    if (injection) parts.push(injection);
  }

  // ── 剧情编织（玩家导入 TXT 后生成的章节滑窗）：高波动，放在当前事实与即时回顾之后。──
  if (settings.剧情编织系统?.enabled && settings.剧情编织系统.currentWindow) {
    const storyWeavingSection = buildStoryWeavingInjection(storyWeaving, worldbookCtx);
    if (storyWeavingSection) parts.push(storyWeavingSection);
  }

  // ── 图鉴（只注入按本回合输入检索到的条目，不注入整库） ──
  if (codexInjectionOverride !== undefined) {
    if (codexInjectionOverride.trim()) parts.push(codexInjectionOverride.trim());
  } else if (settings.图鉴系统?.enabled && codex && worldbookCtx?.recentUserInput) {
    const codexHit = retrieveCodexEntries(codex, worldbookCtx.recentUserInput, settings.图鉴系统.maxRelatedEntries);
    if (codexHit.injection) parts.push(codexHit.injection);
  }

  // ── 元素回响状态注入 ──
  const awakeningSection = buildElementalEchoSection(traveler, worldState, awakeningPhase);
  if (awakeningSection) parts.push(awakeningSection);

  const recentWorldEventsSection = buildRecentWorldEventsSection(worldState.全局事件);
  if (recentWorldEventsSection) parts.push(recentWorldEventsSection);

  // ── 记忆注入 ──
  if (settings.enableMemoryInjection && !suppressMemoryInjection) {
    const memSections = buildLayeredMemorySections(memorySystem);
    if (memSections.length) {
      parts.push(memSections.join('\n\n---\n\n'));
    }
  }

  // ── 高波动 NPC 连续性块后置。 ──
  // 内容仍然完整注入，且位于 system prompt 尾部，对正文生成保持强承接优先级。
  const npcLedgerSelection = npcLedgerSelectionOverride ?? selectNpcLedgersForTurn({
    records: npcRecords,
    turnCount: _turnCount,
    explicitNames: worldbookCtx?.npcNames,
    sceneNames: worldState.当前时段?.人物?.map((npc) => npc.姓名),
    recalledNames: worldbookCtx?.npcNames,
  });
  const npcPresenceSection = buildNpcPresenceSection(worldState, npcRecords, _turnCount, worldbookCtx?.recentUserInput, worldbookCtx?.npcNames);
  if (npcPresenceSection) parts.push(npcPresenceSection);

  const npcLedgerSection = buildNpcLedgerContinuitySection(npcLedgerSelection);
  if (npcLedgerSection) parts.push(npcLedgerSection);

  const npcContinuitySection = buildNpcContinuitySection(worldState, npcRecords, _turnCount, worldbookCtx?.npcNames);
  if (npcContinuitySection) parts.push(npcContinuitySection);

  // ── 已知伙伴（只把 tier='companion' 的喂给 AI，路人不进上下文） ──
  const companionsSection = buildCompanionsSection(npcRecords, _turnCount);
  if (companionsSection) parts.push(companionsSection);

  // ── 成人关系长期事实（仅 NSFW 开启时注入）──
  // 这些是玩家与角色**已经确立**的私密长期事实、边界与偏好。此前它们只存在档案里、
  // 从不进入提示词，于是「长期事实没有发生作用」。放在 NPC 区块之后，保持承接优先级。
  const nsfwArchiveSection = buildNsfwArchiveContinuitySection(
    npcRecords,
    settings.enableNsfw === true,
    settings.enableMaleNsfwArchive === true,
  );
  if (nsfwArchiveSection) parts.push(nsfwArchiveSection);

  return {
    systemPrompt: parts.join('\n\n---\n\n'),
    chatModuleMessages: allChatMessages,
    sections: 分析提示词构成(parts.join('\n\n---\n\n')),
  };
}

export function buildOpeningSystemPrompt(
  traveler: 角色数据结构,
  worldState: 世界状态,
  settings: 游戏设置,
  turnCount: number,
  worldbooks?: 世界书[],
  worldbookCtx?: FilterContext,
  steambird?: SteambirdNews,
  triggerType?: string,
  macroCtx?: MacroContext,
  任务?: 任务系统,
): BuiltSystemPrompt {
  const parts: string[] = [];
  const allChatMessages: ChatModuleMessage[] = [];
  // 开局首回合也注入任务清单（内置主线任务）。
  if (settings.任务系统?.enabled) {
    const questSection = buildQuestSection(任务);
    if (questSection) parts.push(questSection);
  }
  // ST 预设总开关：关闭时过滤所有 st_import_* 模块（保留预设库数据，仅不注入）。
  // V2 酒馆预设使用原始 prompts + prompt_order 消息链；选中 V2 时也隔离 V1 st_import_* 残留，
  // 避免同一份 ST 预设以 V1 模块和 V2 消息链两种形态重复注入。
  const shouldFilterLegacyStModules = settings.enableStPreset === false || Boolean(settings.currentStPresetIdV2);
  const effectiveModules = shouldFilterLegacyStModules
    ? settings.promptModules.filter((m) => !isSTImportedModule(m))
    : settings.promptModules;

  const personLabel =
    settings.narrativePerson === 'second' ? '第二人称"你"'
    : settings.narrativePerson === 'first' ? '第一人称"我"'
    : '第三人称"他/她"';
  const moduleCtx: PromptModuleInjectionCtx = {
    wordCountTarget: settings.wordCountTarget,
    personLabel,
    playerName: getPromptPlayerName(traveler),
    currentScope: 'opening' as 提示词模块作用域,
    openingSource: worldState.开局档案?.来源,
    triggerType,
    macroCtx,
    worldbookCtx,
  };

  const topResult = injectPromptModules(effectiveModules, moduleCtx, 'top');
  if (topResult.systemSection) parts.push(topResult.systemSection);
  allChatMessages.push(...topResult.chatModuleMessages);

  if (settings.enableWorldbookInjection && worldbooks && worldbookCtx) {
    const promptLikeWorldbook = buildPromptLikeWorldbookInjection(worldbooks, {
      ...worldbookCtx,
      currentScope: 'opening',
      turnCount,
    });
    if (promptLikeWorldbook) parts.push(promptLikeWorldbook);
  }

  const bottomResult = injectPromptModules(effectiveModules, moduleCtx, 'bottom');
  if (bottomResult.systemSection) parts.push(bottomResult.systemSection);
  allChatMessages.push(...bottomResult.chatModuleMessages);

  // 结构轮(D1): 基调/字数/归属硬编码段删除,与主剧情 builder 同步(唯一权威=「回复格式」模块)。
  const innerVoiceSection = buildInnerVoiceSection(settings);
  if (innerVoiceSection) parts.push(innerVoiceSection);

  parts.push(buildCharacterSection(traveler));

  const timeAnchor = buildCurrentTimeAnchorSection(worldState);
  if (timeAnchor) parts.push(timeAnchor);

  const openingCutIn = buildOpeningCutInSection(worldState);
  if (openingCutIn) parts.push(openingCutIn);

  const openingArchiveSection = buildOpeningArchiveSection(worldState, true);
  if (openingArchiveSection) parts.push(openingArchiveSection);

  const scene = buildSceneSection(worldState);
  if (scene) parts.push(scene);

  const recentWorldEventsSection = buildRecentWorldEventsSection(worldState.全局事件);
  if (recentWorldEventsSection) parts.push(recentWorldEventsSection);
  const steambirdSection = buildSteambirdSection(steambird);
  if (steambirdSection) parts.push(steambirdSection);

  if (settings.enableWorldbookInjection && worldbooks && worldbookCtx) {
    const openingWorldbookCtx: FilterContext = {
      ...worldbookCtx,
      currentScope: 'opening',
      turnCount,
    };
    const injection = buildWorldbookInjection(worldbooks, openingWorldbookCtx);
    if (injection) parts.push(injection);
    // Phase 7.2：世界书深度插入条目（开局流程同样支持）
    const worldbookDepthMessages = buildWorldbookChatModuleMessages(worldbooks, openingWorldbookCtx);
    if (worldbookDepthMessages.length > 0) {
      allChatMessages.push(...worldbookDepthMessages);
    }
  }

  return {
    systemPrompt: parts.join('\n\n---\n\n'),
    chatModuleMessages: allChatMessages,
    sections: 分析提示词构成(parts.join('\n\n---\n\n')),
  };
}

function normalizeMemoryFingerprint(text: string): string {
  return text
    .replace(/【[^】]{0,24}】/g, '')
    .replace(/[第回合纪要即时短期中期长期压缩档案记忆总结：:，,。！？!?、；;\s\-\d]/g, '')
    .toLowerCase()
    .slice(0, 160);
}

function isSimilarMemoryEntry(entry: string, seen: string[]): boolean {
  const fp = normalizeMemoryFingerprint(entry);
  if (fp.length < 18) return false;
  return seen.some((item) => {
    if (!item) return false;
    if (fp.includes(item) || item.includes(fp)) return true;
    const left = new Set([...fp]);
    let overlap = 0;
    for (const ch of item) {
      if (left.has(ch)) overlap += 1;
    }
    return overlap / Math.max(fp.length, item.length) >= 0.72;
  });
}

function pickDedupedMemoryEntries(entries: string[], limit: number, seen: string[]): string[] {
  const picked: string[] = [];
  const source = entries.map((item) => item.trim()).filter(Boolean);
  for (let i = source.length - 1; i >= 0 && picked.length < limit; i -= 1) {
    const entry = source[i];
    if (!entry) continue;
    if (isSimilarMemoryEntry(entry, seen)) continue;
    picked.unshift(entry);
    const fp = normalizeMemoryFingerprint(entry);
    if (fp) seen.push(fp);
  }
  return picked;
}

function formatMemorySection(title: string, entries: string[]): string {
  return `# 记忆｜${title}\n\n${entries.map((m, i) => `${i + 1}. ${m}`).join('\n')}`;
}

function buildLayeredMemorySections(memorySystem: 记忆系统): string[] {
  const seen: string[] = [];
  const shortTerm = pickDedupedMemoryEntries(
    memorySystem.短期记忆,
    MAIN_SHORT_TERM_MEMORY_PROMPT_LIMIT,
    seen,
  );
  const middleTerm = pickDedupedMemoryEntries(
    memorySystem.中期记忆 ?? [],
    MAIN_MIDDLE_TERM_MEMORY_PROMPT_LIMIT,
    seen,
  );
  const longTerm = pickDedupedMemoryEntries(
    memorySystem.长期记忆,
    MAIN_LONG_TERM_MEMORY_PROMPT_LIMIT,
    seen,
  );

  const sections: string[] = [];
  if (longTerm.length) sections.push(formatMemorySection('长期记忆', longTerm));
  if (middleTerm.length) sections.push(formatMemorySection('中期记忆', middleTerm));
  if (shortTerm.length) sections.push(formatMemorySection('短期记忆', shortTerm));
  return sections;
}

interface PromptModuleInjectionCtx {
  wordCountTarget: number;
  personLabel: string;
  playerName: string;
  currentScope: 提示词模块作用域;
  openingSource?: 开局来源;
  /** ST 预设兼容：当前触发生成类型。空=全触发（旧行为）。 */
  triggerType?: string;
  /** ST 预设兼容：宏变量上下文。不传=不执行宏处理（旧行为）。 */
  macroCtx?: MacroContext;
  /** 批次5(D10)：迁移自世界书的规则模块含 {originalProtagonistSubject} 等世界书占位符,
   *  传入时复用世界书替换管线；不传=仅做模块自有三占位符替换（旧行为）。 */
  worldbookCtx?: FilterContext;
}

/** 非 system 角色的提示词模块消息。带元数据字段供 Phase 4 depth 注入使用。 */
export interface ChatModuleMessage {
  role: string;
  content: string;
  /** 0=相对位置（已在 systemSection 中），1=In-Chat（需 depth 插入）。 */
  _injectionPosition?: number;
  /** In-Chat depth 值。0=末条消息后，1=末条消息前，依此类推。 */
  _injectionDepth?: number;
  /** 同 role 同 depth 内排序值。 */
  _injectionOrder?: number;
}

/** injectPromptModules 的返回值。 */
interface InjectedModules {
  systemSection: string;
  chatModuleMessages: ChatModuleMessage[];
}

/** buildSystemPrompt / buildOpeningSystemPrompt 的返回值。 */
export interface BuiltSystemPrompt {
  systemPrompt: string;
  chatModuleMessages: ChatModuleMessage[];
  /** 提示词构成统计（供上下文可视化）。 */
  sections?: 提示词构成;
}

function getPromptPlayerName(traveler: 角色数据结构): string {
  return traveler.姓名?.trim() || '无名旅者';
}

/** 思维链输出语言标签映射（cotLanguage 设置 → AI 可读的语言名） */
const COT_LANGUAGE_LABELS: Record<string, string> = {
  zh: '中文',
  en: 'English',
  ja: '日本語',
  fr: 'Français',
  ru: 'Русский',
  de: 'Deutsch',
  es: 'Español',
  it: 'Italiano',
};

/** NarrativeTurn 可见文本语言提示段；内部推理永不要求输出。 */
function buildCotLanguageSection(settings: 游戏设置, currentScope: 提示词模块作用域): string {
  if (currentScope !== 'main') return '';
  const lang = settings.cotLanguage;
  if (!lang || lang === 'zh') return '';
  const label = COT_LANGUAGE_LABELS[lang];
  if (!label) return '';
  return `# 内部推理与可见文本语言\n\n- 内部完成判断但不要输出推理过程、thinking 或 analysis。\n- NarrativeTurn JSON 的字段名保持固定英文。\n- body、choices、factCandidates 与 continuation 中的可见文本仍使用中文；当前偏好 ${label} 仅供内部理解，不改变正式输出语言。`;
}

function buildInnerVoiceSection(settings: 游戏设置): string {
  return settings.enableInnerVoice
    ? '# 心声开关\n\n- 当前设置：心声输出开启。正文可使用【心声】段呈现主角的即时内心微动，但不要替玩家做决定。'
    : '# 心声开关\n\n- 当前设置：心声输出关闭。正文只保留【旁白】与【角色名】，不要输出【心声】段，也不要用内心独白替代旁白。';
}

// 结构轮(D1, 2026-07-26): 字数与发言归属两个硬编码段构建函数已删除——
// 唯一权威在「回复格式」模块(migratePromptModules 强刷保证触达),
// 生成点兜底在 sendWorkflow 的区E执法块(本回合生成前核对)。

function injectPromptModules(
  modules: 提示词模块[] | undefined,
  ctx: PromptModuleInjectionCtx,
  position: 'top' | 'bottom',
): InjectedModules {
  if (!modules || modules.length === 0) return { systemSection: '', chatModuleMessages: [] };
  const filtered = modules
    .filter((m) => m.enabled)
    .filter((m) => {
      const scope = m.scope?.length ? m.scope : (['all'] as 提示词模块作用域[]);
      return scope.includes('all') || scope.includes(ctx.currentScope);
    })
    .filter((m) => {
      if (!m.openingSourceGate?.length) return true;
      return ctx.currentScope === 'opening' && !!ctx.openingSource && m.openingSourceGate.includes(ctx.openingSource);
    })
    .filter((m) => {
      // ST 预设兼容：injectionTrigger 为空 = 全触发（旧行为）。
      // 非空时必须包含当前 triggerType 才注入。
      if (!m.injectionTrigger?.length) return true;
      return !!ctx.triggerType && m.injectionTrigger.includes(ctx.triggerType);
    })
    .filter((m) =>
      position === 'top'
        ? m.order < PROMPT_MODULE_TOP_THRESHOLD
        : m.order >= PROMPT_MODULE_TOP_THRESHOLD,
    )
    .sort((a, b) => a.order - b.order);
  if (filtered.length === 0) return { systemSection: '', chatModuleMessages: [] };

  // ST 预设兼容：role 分流。system 角色拼接到 systemSection，
  // user/assistant 角色加入 chatModuleMessages（Phase 4 用于 depth 注入）。
  const systemParts: string[] = [];
  const chatMessages: ChatModuleMessage[] = [];
  for (const m of filtered) {
    const baseReplaced = m.content
      .replace(/\{wordCountTarget\}/g, String(ctx.wordCountTarget))
      .replace(/\{personLabel\}/g, ctx.personLabel)
      .replace(/\{playerName\}/g, ctx.playerName);
    // 批次5(D10): 迁移规则模块复用世界书占位符管线({originalProtagonistSubject}/{openingArchiveText} 等)
    const replaced = ctx.worldbookCtx ? replaceWorldbookPlaceholders(baseReplaced, ctx.worldbookCtx) : baseReplaced;
    // ST 预设兼容：宏预处理（setvar/getvar/if 等）。不传 macroCtx = 旧行为（不处理）。
    const content = ctx.macroCtx ? processMacros(replaced, ctx.macroCtx) : replaced;
    const role = m.role ?? 'system';
    if (role === 'system') {
      systemParts.push(content);
    } else {
      chatMessages.push({
        role,
        content,
        _injectionPosition: m.injectionPosition ?? 0,
        _injectionDepth: m.injectionDepth ?? 4,
        _injectionOrder: m.injectionOrder ?? m.order,
      });
    }
  }
  return {
    systemSection: systemParts.join('\n\n---\n\n'),
    chatModuleMessages: chatMessages,
  };
}

// 结构轮: 基调段构建函数已删除——剧情模式的唯一注入出处是 4 选 1 的剧情模式世界书条目。

function buildMainStoryControlSection(worldState: 世界状态): string {
  // 结构轮(D2)瘦身: 世界观级规则(新闻露出/战斗定位/元素表达/时间戳/编织描述)已归
  // builtin_rule_* 模块与批次3注入头部,此处只保留"数据使用优先级+承接铁则+原著主角配置"。
  const lines: string[] = [];
  lines.push('- 本回合属于主剧情正文，不是开局校准、元素回响、蒸汽鸟报后台、信使通信或图鉴检索回合。');
  lines.push('- 主剧情优先级：玩家本回合输入 > 当前场景与上一回合钩子 > 即时剧情回顾 > 世界树记忆（强记忆优先） > 当前剧情事实 > 剧情编织滑窗（仅作门禁素材） > 图鉴注入 > 蒸汽鸟报苗头 > 普通背景资料。');
  lines.push('- 若 system 中存在「# 即时剧情回顾」或「【剧情回忆】」，正文必须先承接其中的人物、地点、上一动作、未结问题和强回忆事实；不得假装角色不认识刚刚或过去已见过的人。');
  lines.push('- 如果强回忆或即时剧情回顾显示某 NPC 已与玩家见过、同行、约定或发生冲突，本回合必须沿用该关系状态；除非正文明确失忆/伪装/信息隔离，不得重新写成陌生人初见。');
  lines.push('- 图鉴人物主体人格优先校准长期口吻与行为边界；NPC 档案主要提供与玩家的关系、称呼、共同经历和临时状态。若两者冲突，不要用 NPC 档案里的旧性格覆盖图鉴主体人格。');
  lines.push('- 玩家不是空 / 荧，也不是西风骑士团既定成员；原著主角信息只作为原著线索和时间锚点，不要覆盖玩家身份。');
  if (worldState.原著主角 === '空荧双主角') {
    lines.push('- 当前原著主角配置为“空荧双主角”：空与荧是两个并列存在的独立个体，主剧情中继续保持分离，不混写成同一人；若镜头暂时只写其中一位，也必须保留另一位的独立存在，不得默认只选荧。');
  } else if (worldState.原著主角 === '荧') {
    lines.push('- 当前原著主角配置：荧。空不是本周目默认原著主角，不自动登场，不被默认召回为旅行者，除非后续剧情或玩家设定明确引入。');
  } else if (worldState.原著主角 === '空') {
    lines.push('- 当前原著主角配置：空。荧不是本周目默认原著主角，不自动登场，不被默认召回为旅行者；涉及沉睡之地、深渊线索或原著主角线索时优先写空。');
  } else if (worldState.原著主角 === '无主角') {
    lines.push('- 当前原著主角配置：无主角。空与荧都不作为本周目原著主角自动登场或被召回；原著旅行者相关设定仅作背景参考。');
  } else if (worldState.原著主角) {
    lines.push(`- 当前原著主角配置：${worldState.原著主角}。另一性别主角不自动登场，除非后续剧情或玩家设定明确引入。`);
  }
  // 开局档案的承接铁则由「# 开局档案（长期锚点）」段（含 D4 精简版）承担,此处不再复述。
  return `# 主剧情运行锚点\n\n${lines.join('\n')}`;
}

function buildOpeningArchiveSection(worldState: 世界状态, isOpeningTurn: boolean): string {
  const archive = worldState.开局档案;
  if (!archive) return '';
  const summary = archive.整理档案;
  // D4(结构轮): 非开局回合降级为摘要——全量档案只在开局回合注入,后续回合保留身份/地点/承接铁则。
  if (!isOpeningTurn) {
    const slim: string[] = [];
    slim.push(`- 开局：${archive.来源 === 'free' ? '自由开局' : archive.来源 === 'workshop' ? '创意工坊' : '官方预设'} / ${archive.地区名称} / ${archive.章节锚点名称}（锚点之前的主线只作既成背景，不得补演）`);
    if (summary?.玩家身份 || summary?.当前目标) slim.push(`- 玩家身份与目标：${[summary?.玩家身份, summary?.当前目标].filter(Boolean).join('；')}`);
    slim.push('- 后续回合必须承接开局档案和当前地点，不能无理由回到默认蒙德开局，也不得把玩家强行拉回导入章节的默认入口。');
    return `# 开局档案（长期锚点）\n\n${slim.join('\n')}`;
  }
  const lines: string[] = [];
  lines.push(`- 当前开局模式：${archive.来源 === 'free' ? '自由开局' : archive.来源 === 'workshop' ? '创意工坊' : '官方预设'}`);
  lines.push(`- 来源：${archive.来源 === 'free' ? '自由开局' : archive.来源 === 'workshop' ? '创意工坊' : '官方预设'}`);
  lines.push(`- 地区：${archive.地区名称}（${archive.地区ID}）`);
  lines.push(`- 章节锚点：${archive.章节锚点名称}（${archive.章节锚点ID}）`);
  lines.push(`- 章节参考性质：${archive.参考性质}。章节只提供背景参考，不硬锁玩家自由设定。`);
  lines.push('- 进度边界：选择的章节锚点就是当前开局起点；锚点之前的主线只作既成背景/资料参考，不得作为正文自动跳转、补演或推进目标。');
  if (archive.章节参考说明) lines.push(`- 章节参考说明：${archive.章节参考说明}`);
  if (archive.玩家介入原文) lines.push(`- 玩家介入原文：${archive.玩家介入原文}`);
  if (archive.来源 !== 'official_preset') {
    lines.push('- 自由开局现实：玩家介入原文和整理档案可以建立原著之外的起始地点、原创事件、原创组织、自定义切入点或平行支线；这些内容若已写入开局档案，必须作为已成立设定承接，不得强行改回原著默认地点。');
  }
  if (archive.官方预设ID) lines.push(`- 官方预设ID：${archive.官方预设ID}`);
  if (archive.创意工坊模板ID) lines.push(`- 创意工坊模板ID：${archive.创意工坊模板ID}`);
  if (summary?.玩家身份) lines.push(`- 玩家身份：${summary.玩家身份}`);
  if (summary?.来到此地原因) lines.push(`- 来到此地原因：${summary.来到此地原因}`);
  if (summary?.当前目标) lines.push(`- 当前目标：${summary.当前目标}`);
  if (summary?.起始情境) lines.push(`- 起始情境：${summary.起始情境}`);
  if (summary?.初始地点参考) lines.push(`- 初始地点参考：${summary.初始地点参考}`);
  if (summary?.关键角色参考?.length) lines.push(`- 关键角色参考：${summary.关键角色参考.join('、')}（只用于背景资料和可能牵引，不代表已认识或当前在场）`);
  if (summary?.已认识角色?.length) lines.push(`- 已认识角色：${summary.已认识角色.join('、')}`);
  if (summary?.初始关系?.length) lines.push(`- 初始关系：${summary.初始关系.join('；')}`);
  if (summary?.叙事倾向?.length) lines.push(`- 叙事倾向：${summary.叙事倾向.join('、')}`);
  if (summary?.特别要求?.length) lines.push(`- 特别要求：${summary.特别要求.join('；')}`);
  if (summary?.冲突协调?.length) lines.push(`- 冲突协调：${summary.冲突协调.join('；')}`);
  if (summary?.关键角色参考?.length || summary?.已认识角色?.length || summary?.初始关系?.length) {
    lines.push('- 人物边界：关键角色参考只代表背景相关人物；已认识角色/初始关系只代表长期关系参考；这些都不代表当前在场，是否入场仍以当前场景、玩家点名和剧情调度为准。');
  }
  if (archive.防回退规则.length) {
    lines.push('- 防回退规则：');
    for (const rule of archive.防回退规则) lines.push(`  · ${rule}`);
  }
  lines.push(
    isOpeningTurn
      ? '- 首回合写法：必须把开局档案视为已经成立的事实，快速建立当前地区氛围、玩家切入点和可接触对象。'
      : '- 后续写法：开局档案持续生效；除非剧情明确转场，不得把玩家强行拉回默认蒙德开局。',
  );
  return `# 开局档案（长期锚点）\n\n${lines.join('\n')}`;
}

function buildCurrentTimeAnchorSection(worldState: 世界状态): string {
  const lines: string[] = [];
  lines.push(`- 纪年法：${worldState.纪年法 || '旅行纪年'}`);
  lines.push(`- 旅行天数：第 ${Math.max(1, worldState.旅程天数 || 1)} 天`);
  lines.push(`- 当前日期：${worldState.当前日期 || '未设定'}`);
  lines.push(`- 当前时间：${worldState.当前时间 || '未设定'}`);
  lines.push(`- 当前地点：${worldState.当前地点 || '未设定'}`);
  lines.push('');
  lines.push('生成 body 与 factCandidates 前必须先读取本锚点。');
  lines.push('同一日期内，任何时间推进都只能从“当前时间”向后推，不能写早于当前时间的时刻。');
  lines.push('如果剧情从 23:40 推进到 00:10，body 必须明确写出跨日，并可在同一 NarrativeTurn.factCandidates 中加入 domain="time" 的候选事实；evidence 必须逐字摘自 body.text。');
  lines.push('没有等待、赶路、休息、睡眠、检修或明确耗时证据时，不要为了气氛改写时间。');
  return `# 当前时间锚点（变量一致性硬约束）\n\n${lines.join('\n')}`;
}

function buildCharacterSection(traveler: 角色数据结构): string {
  const lines: string[] = [];
  lines.push(`你正在叙述的主角：`);
  lines.push(`- 姓名：${traveler.姓名 || '未命名'}${traveler.别名 ? `（${traveler.别名}）` : ''}`);

  const basics = [
    traveler.性别 ? `性别 ${traveler.性别}` : '',
    traveler.年龄 > 0 ? `${traveler.年龄} 岁` : '',
    traveler.生日 ? `生日 ${traveler.生日}` : '',
  ].filter(Boolean);
  if (basics.length) lines.push(`- 基本：${basics.join(' · ')}`);

  if (traveler.外貌) lines.push(`- 外貌：${traveler.外貌}`);
  if (traveler.性格) lines.push(`- 性格：${traveler.性格}`);
  if (traveler.背景) lines.push(`- 背景：${traveler.背景}`);

  if (traveler.元素共鸣.length > 0) {
    const attunementLines = traveler.元素共鸣.map((attunement) => {
      const primaryMark = attunement.element === traveler.主元素 ? '【主】' : '';
      return `  · ${primaryMark}${ELEMENT_NAMES[attunement.element]}：掌握度 ${attunement.mastery}/100，来源 ${attunement.source}`;
    });
    lines.push(`- 已解锁元素共鸣：\n${attunementLines.join('\n')}`);
    lines.push('- 元素力应通过环境反应、施放方式和实际后果表现，不写成自动替旅行者做决定的意志。');
  }

  if (traveler.能力?.length) {
    lines.push(`- 能力：${traveler.能力.join('、')}`);
  }

  if (traveler.专长知识?.length) {
    lines.push(`- 特长：${traveler.专长知识.join('、')}`);
  }

  return `# 当前角色\n\n${lines.join('\n')}`;
}

function buildOpeningCutInSection(worldState: 世界状态): string {
  const lines: string[] = [];

  if (worldState.原著主角) {
    lines.push(`- 原著主角选择：${worldState.原著主角}`);
  }
  if (worldState.原著主角 === '空荧双主角') {
    lines.push('- 双原著主角提醒：空与荧是两个独立存在的原著主角，不可写成同一人、互相替代或混合性别设定。若开局镜头只聚焦其中一位，另一位也必须作为并列存在的原著线索被保留；涉及沉睡之地、深渊线索或原著主角线索时，不得默认只选荧。');
  } else if (worldState.原著主角 === '荧') {
    lines.push('- 原著主角门禁：当前为单主角「荧」，空不是本周目默认原著主角；不得召回或表现「空」为并列原著主角，也不要把开局苏醒场景写成空的视角。');
  } else if (worldState.原著主角 === '空') {
    lines.push('- 原著主角门禁：当前为单主角「空」，荧不是本周目默认原著主角；不得召回或表现「荧」为并列原著主角。涉及沉睡之地、深渊线索或原著主角线索时优先写空，开局苏醒场景应以空的视角和性别推进，不要默认写成荧。');
  } else if (worldState.原著主角 === '无主角') {
    lines.push('- 原著主角门禁：当前为无主角配置；空与荧都不作为原著主角自动登场，开局以玩家的自定义身份推进。');
  }
  if (worldState.自定义开局?.trim()) {
    lines.push(`- 切入说明：${worldState.自定义开局.trim()}`);
  }

  if (!lines.length) return '';
  lines.push('- 使用方式：把以上内容视为开局已经成立的私有设定，融入道具、通讯、来历或行动动机中；不要原文复读，也不要当成还需要玩家确认的说明。');
  return `# 开局切入说明\n\n${lines.join('\n')}`;
}

function buildSkillSection(traveler: 角色数据结构): string {
  const lines: string[] = [];
  if (traveler.天赋.length > 0) {
    lines.push('- 已登记天赋：');
    for (const talent of traveler.天赋) {
      const element = talent.关联元素 ? ELEMENT_NAMES[talent.关联元素] : '无特定元素';
      lines.push(`  · ${talent.名称}（${talent.类别}/${element}/Lv.${talent.等级}）：${talent.说明}`);
    }
  } else {
    lines.push('- 已登记天赋：暂无。');
  }
  lines.push('- 使用原则：天赋是旅行者已经掌握的能力边界；正文可自然描写其动作和元素效果，不作界面式技能播报。');
  return `# 天赋系统\n\n${lines.join('\n')}`;
}

function buildSceneSection(worldState: 世界状态): string {
  const lines: string[] = [];

  if (worldState.起航之地ID) {
    const s = getStartingScenario(worldState.起航之地ID);
    if (s) lines.push(`【起航之地】${s.name}\n${s.description}`);
  }

  const calendarLines: string[] = [];
  calendarLines.push(`纪年法：${worldState.纪年法 || '旅行纪年'}`);
  calendarLines.push(`旅行天数：第 ${Math.max(1, worldState.旅程天数 || 1)} 天`);
  if (worldState.当前日期) calendarLines.push(`日期：${worldState.当前日期}`);
  if (worldState.当前时间) calendarLines.push(`时间：${worldState.当前时间}`);
  if (worldState.当前地点) calendarLines.push(`地点：${worldState.当前地点}`);
  if (worldState.原著主角) calendarLines.push(`原著主角：${worldState.原著主角}`);
  if (calendarLines.length) {
    lines.push(`【时空坐标】${calendarLines.join(' · ')}`);
  }

  const period = worldState.当前时段;
  if (period && period.id) {
    const npcLine = period.人物.length
      ? `\n\n场内人物：\n${period.人物.map((n) => `- ${n.姓名}：${n.角色}，${n.性格}`).join('\n')}`
      : '';
    lines.push(`【${period.名称}】${period.年代 ? `（${period.年代}）` : ''}${period.描述 ? `\n${period.描述}` : ''}${period.氛围 ? `\n${period.氛围}` : ''}${npcLine}`);
  }

  if (!lines.length) return '';
  return `# 当前场景\n\n${lines.join('\n\n')}`;
}

const RECENT_WORLD_EVENT_PROMPT_LIMIT = 12;

function normalizeWorldEventFingerprint(text: string): string {
  return text
    .replace(/【[^】]{0,24}】/g, '')
    .replace(/[第回合纪要动态世界事件新闻线索：:，,。！？!?、；;\s\-\d]/g, '')
    .toLowerCase()
    .slice(0, 120);
}

function compactWorldEvent(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  return cleaned.length > 160 ? `${cleaned.slice(0, 160)}...` : cleaned;
}

function buildRecentWorldEventsSection(events: string[]): string {
  if (!events.length) return '';
  const picked: string[] = [];
  const seen = new Set<string>();
  for (let i = events.length - 1; i >= 0 && picked.length < RECENT_WORLD_EVENT_PROMPT_LIMIT; i -= 1) {
    const event = compactWorldEvent(events[i] ?? '');
    if (!event) continue;
    const fp = normalizeWorldEventFingerprint(event);
    if (fp && seen.has(fp)) continue;
    if (fp) seen.add(fp);
    picked.unshift(event);
  }
  return picked.length ? `# 近期事件\n\n${picked.map((e) => `- ${e}`).join('\n')}` : '';
}

const COMPANION_PROMPT_LIMIT = 12;
const RECENT_EXTRA_NPC_PROMPT_TURN_WINDOW = 15;
const EXTRA_NPC_PROMPT_LIMIT = 8;
const NPC_CONTINUITY_PROMPT_LIMIT = 10;
const NPC_PRESENCE_RECENT_WINDOW = 6;

function normalizeExplicitNpcNames(names?: string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const raw of names ?? []) {
    const name = raw.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    normalized.push(name);
  }
  return normalized;
}

function buildNpcPresenceSection(
  worldState: 世界状态,
  npcRecords?: NPC记录[],
  turnCount = 0,
  userInput = '',
  explicitNpcNames: string[] = [],
): string {
  const sceneNames = (worldState.当前时段?.人物 ?? []).map((npc) => npc.姓名.trim()).filter(Boolean);
  const records = npcRecords ?? [];
  const explicitNames = normalizeExplicitNpcNames(explicitNpcNames);
  const current = records
    .filter((npc) => npc.同行 || sceneNames.some((name) => name === npc.姓名 || name === npc.别名))
    .map((npc) => npc.姓名);
  const recentCutoff = Math.max(1, turnCount - NPC_PRESENCE_RECENT_WINDOW);
  const nearby = records
    .filter((npc) =>
      !current.includes(npc.姓名) &&
      Number(npc.最近回合 || 0) >= recentCutoff &&
      (npc.阶位 === 'companion' || npc.原著角色 || 提取NPC同行记忆文本列表(npc).length > 0),
    )
    .sort((a, b) => Number(b.最近回合 || 0) - Number(a.最近回合 || 0))
    .slice(0, 8)
    .map((npc) => `${npc.姓名}（最近第${Math.max(1, Number(npc.最近回合 || 1))}回合）`);
  const sceneOnly = sceneNames.filter((name) => !current.some((item) => item === name));
  const anticipated = getAnticipatedNpcNamesForTurn({ world: worldState, userInput, npcRecords });
  if (!current.length && !nearby.length && !sceneOnly.length && !anticipated.length && !explicitNames.length) return '';

  return [
    '# 角色在场状态',
    '',
    `- 当前明确在场/同行：${current.length ? Array.from(new Set(current)).join('、') : '无明确记录'}`,
    `- 近期正文/玩家输入明确人物或预期相关：${explicitNames.length ? explicitNames.join('、') : '无'}`,
    `- 近期相关但不在场：${nearby.length ? nearby.join('、') : '无'}`,
    `- 预期登场/需提前校准：${anticipated.length ? anticipated.join('、') : '无'}`,
    `- 当前场景候选人物：${sceneOnly.length ? sceneOnly.join('、') : '无'}`,
    '- 写作规则：只有“当前明确在场/同行”、玩家本回合明确点名、或即时剧情回顾/最近正文锚点显示仍在当前镜头、通讯、同行链路中的人物，可以自然发言、行动或被图鉴召回为角色锚点。',
    '- “近期正文/玩家输入明确人物或预期相关”不是自动在场名单；但若即时剧情回顾或最近正文锚点显示他们刚与玩家对话、行动、委托、冲突或同行，正文必须承接这段关系与刚发生的事实，禁止写成完全陌生、初次见面或突然遗忘。',
    '- “预期登场/需提前校准”的人物允许图鉴提前召回口吻和人格，用于他们即将入场、广播、通讯或被他人提及时不 OOC；但在正文里仍要通过合理镜头让其入场，不得凭空站到当前地点。',
    '- “近期相关但不在场”的人物只能通过回忆、通讯、旁人提及或后续登场铺垫出现，不得凭空站到当前镜头里。',
    '- “当前场景候选人物”只代表地点可能相关，不等于本人已在场；例如地点叫蒙德城时，不得自动让琴或凯亚出场，除非正文、玩家输入或即时回顾明确让其进入当前镜头。',
    current.length
      ? `- 队伍完整性硬约束：本回合正文必须让每位同行成员（${Array.from(new Set(current)).join('、')}）至少出现一次具名发言、行动或可观察反应；不得只写其中一人后省略其他队员。`
      : '',
    '- 角色认知硬约束：NPC 只知道自己亲眼见证、被直接告知、其私有记忆账本记录，或确属公开新闻的事实。系统状态、图鉴资料、其他 NPC 的私密记忆、旅行者未说出口的经历均不是该角色知识。缺少信息来源时必须表现为不知道、询问或合理猜测，禁止全知视角。',
    worldState.原著主角 === '荧'
      ? '- 单主角“荧”，图鉴与正文不得同时召回或表现“空”为并列原著主角。'
      : worldState.原著主角 === '空'
        ? '- 单主角“空”，图鉴与正文不得同时召回或表现“荧”为并列原著主角；涉及原著主角线索时不得默认落到“荧”。'
        : worldState.原著主角 === '空荧双主角'
          ? '- 原著主角门禁：当前为“空荧双主角”，空与荧都存在且彼此独立；若本回合只表现其中一人，也不得把另一人从设定中抹除或默认只剩荧。'
          : '',
  ].join('\n');
}

function buildNpcLedgerContinuitySection(selection: NPC账本选择结果): string {
  if (!selection.selected.length) return '';
  return [
    '# 本回合 NPC 关系与记忆强制承接',
    '',
    '以下 NPC 账本属于当前状态事实，不是普通背景资料。若这些 NPC 本回合出场、通讯、被玩家点名或由当前镜头自然牵引，正文必须承接其关系、记忆、承诺、冲突和最近互动。',
    '- 禁止把已认识、已同行、已承诺、已冲突或已有私有记忆的 NPC 写成初识、陌生、无共同经历。',
    '- 来源为“信使”的同行记忆代表玩家与该 NPC 已有私下通讯热度；若该 NPC 当前在场、被玩家点名或自然入场，正文应承接信使通信中的熟悉度、情绪余温、称呼和未尽话题，不要写成不温不火的陌生寒暄。',
    '- 若要表现 NPC 不记得或装作不认识，正文必须给出明确原因：失忆、伪装、通讯隔离、误认、被迫演戏、时间线重置或认知污染。',
    '- 账本相关不等于自动在场；不在当前镜头的人只能通过通讯、回忆、旁人提及或后续合理入场承接。',
    '- 每份 NPC 账本按姓名严格隔离：A 的私下互动、手机内容、共同经历和约定不能自动成为 B 的知识；只有亲历、被当面告知或已列为公开事实时才能跨角色传播。',
    '',
    ...selection.selected.map(formatNpcLedgerForPrompt),
  ].join('\n');
}

/** 档案里是否存在需要正文承接的私密长期事实。 */
function hasDurableIntimateFacts(archive: NPC记录['NSFW档案'] | undefined): boolean {
  if (!archive?.enabled) return false;
  return Boolean(
    archive.长期事实?.length
    || archive.边界?.trim()
    || archive.偏好?.length
    || archive.敏感点?.length
    || archive.禁忌?.length
    || archive.亲密阶段?.trim(),
  );
}

function formatNsfwArchiveContinuityLine(npc: NPC记录, archive: NonNullable<NPC记录['NSFW档案']>): string {
  const segments = [
    clampNsfwItem(archive.亲密阶段) ? `关系阶段：${clampNsfwItem(archive.亲密阶段)}` : '',
    archive.长期事实?.length ? `长期事实：${clampNsfwItems(archive.长期事实, 5).join('；')}` : '',
    clampNsfwItem(archive.边界) ? `边界：${clampNsfwItem(archive.边界)}` : '',
    archive.偏好?.length ? `偏好：${clampNsfwItems(archive.偏好, 6).join('、')}` : '',
    archive.敏感点?.length ? `敏感点：${clampNsfwItems(archive.敏感点, 6).join('、')}` : '',
    archive.禁忌?.length ? `禁忌（硬约束）：${clampNsfwItems(archive.禁忌, 6).join('、')}` : '',
  ].filter(Boolean);
  return `- ${npc.姓名}${npc.别名 ? `（${npc.别名}）` : ''}｜${segments.join('｜')}`;
}

const NSFW_ARCHIVE_PROMPT_LIMIT = 8;
/** 单条文本上限：长期事实由模型写入，可能很长；同一文件的 :791 已有同样的截断先例。 */
const NSFW_ARCHIVE_ITEM_MAX_LENGTH = 160;

function clampNsfwItem(value: string | undefined): string {
  const text = (value ?? '').trim();
  return text.length > NSFW_ARCHIVE_ITEM_MAX_LENGTH ? `${text.slice(0, NSFW_ARCHIVE_ITEM_MAX_LENGTH)}…` : text;
}

function clampNsfwItems(values: readonly string[] | undefined, limit: number): string[] {
  return (values ?? []).slice(-limit).map((item) => clampNsfwItem(item)).filter(Boolean);
}

/**
 * 把「已确立的亲密长期事实」注入正文提示词。
 *
 * 在此之前 `matureArchive` 只在档案面板里展示，**从不进入任何提示词**，
 * 所以玩家写进去的长期事实对剧情没有任何影响。
 * 只在 NSFW 总开关打开时注入；每个角色的档案严格隔离，且不得违反已写明的边界与禁忌。
 */
function buildNsfwArchiveContinuitySection(
  npcRecords: NPC记录[] | undefined,
  enabled: boolean,
  maleArchiveEnabled = false,
): string {
  if (!enabled) return '';
  const rows = (npcRecords ?? [])
    .filter((npc) => Boolean(npc.姓名?.trim()) && hasDurableIntimateFacts(npc.NSFW档案))
    // 男性档案开关关闭时不得注入男性角色的档案（写入侧受同一开关约束，两侧口径必须一致）。
    .filter((npc) => npc.性别 !== '男' || maleArchiveEnabled)
    .sort((a, b) => Number(b.最近回合 || 0) - Number(a.最近回合 || 0))
    .slice(0, NSFW_ARCHIVE_PROMPT_LIMIT);
  if (!rows.length) return '';
  return [
    '# 已确立的亲密长期事实（成人向档案）',
    '',
    '以下是当前状态下**已经确立**的私密关系事实与边界，属于状态事实而非背景设定。',
    '- 已建立的关系、阶段、承诺与关键经历必须被承接：不得写成从未发生、初次接触或关系归零，也不得凭空推翻。',
    '- 「边界」与「禁忌」是硬约束：正文不得违反；需要改变时，必须先在正文里写出明确的重新协商过程，而不是直接越过。',
    '- 「偏好」与「敏感点」只作用于对应角色本人，不代表其他角色，也不得据此推断未写明的取向。',
    '- 逐行隔离：某位角色的私密事实不是其他角色的知识；只能通过亲历、当面告知或公开事实传播。',
    '- 不在本回合镜头内的人物只能通过回忆、通讯或旁人提及承接，不得凭空出现在当前场景。',
    '- 与本回合玩家输入、当前地点和既有关系冲突时，以玩家输入为准并让角色做出符合人格的反应。',
    '',
    ...rows.map((npc) => formatNsfwArchiveContinuityLine(npc, npc.NSFW档案 as NonNullable<NPC记录['NSFW档案']>)),
  ].join('\n');
}

function buildNpcContinuitySection(  worldState: 世界状态,
  npcRecords?: NPC记录[],
  turnCount = 0,
  explicitNpcNames: string[] = [],
): string {
  const records = npcRecords ?? [];
  const explicitNames = normalizeExplicitNpcNames(explicitNpcNames);
  const recentCutoff = Math.max(1, turnCount - RECENT_EXTRA_NPC_PROMPT_TURN_WINDOW);
  const sceneNames = new Set((worldState.当前时段?.人物 ?? []).map((n) => n.姓名.trim()).filter(Boolean));
  const currentLocation = worldState.当前地点?.trim();

  const candidates = records
    .map((npc) => {
      const memories = 提取NPC同行记忆文本列表(npc);
      const isRecent = Number(npc.最近回合 || 0) >= recentCutoff;
      const isExplicit = explicitNames.some((name) => name === npc.姓名 || name === npc.别名);
      const isSceneNpc = sceneNames.has(npc.姓名) || Boolean(npc.别名 && sceneNames.has(npc.别名));
      const hasContinuity =
        npc.同行 ||
        isRecent ||
        isExplicit ||
        isSceneNpc ||
        memories.length > 0 ||
        npc.关系 !== 'stranger' ||
        npc.亲密关系 ||
        npc.好感度 !== 0;
      if (!hasContinuity) return null;
      const score =
        (isExplicit ? 120 : 0) +
        (isSceneNpc ? 100 : 0) +
        (npc.同行 ? 80 : 0) +
        (isRecent ? 50 : 0) +
        Math.min(memories.length, 6) * 8 +
        (npc.关系 !== 'stranger' || npc.亲密关系 ? 12 : 0) +
        Math.min(Math.abs(npc.好感度), 20);
      return { npc, memories, isRecent, isSceneNpc, score };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => b.score - a.score || Number(b.npc.最近回合 || 0) - Number(a.npc.最近回合 || 0))
    .slice(0, NPC_CONTINUITY_PROMPT_LIMIT);

  const representedNames = new Set<string>();
  for (const { npc } of candidates) {
    representedNames.add(npc.姓名);
    if (npc.别名) representedNames.add(npc.别名);
  }
  const fallbackNames = explicitNames
    .filter((name) => !representedNames.has(name))
    .slice(0, Math.max(0, NPC_CONTINUITY_PROMPT_LIMIT - candidates.length));

  if (!candidates.length && !fallbackNames.length) return '';

  const lines: string[] = [
    '# 本回合人物关系连续性核对',
    '',
    '这段是正文生成前必须读取的关系状态表。凡是下列人物在本回合出场、被玩家提到、或由当前场景自然牵引出现，都必须沿用既有关系和共同经历。',
    '- 若人物已见过玩家、委托过玩家、共同作战、同行、通信、产生承诺或冲突，正文禁止写成初次见面、禁止重新自我介绍、禁止问“你是谁/为什么来”这类陌生人模板。',
    '- 可以因为职责、危机、信息差而质疑玩家，但质疑必须建立在既有关系上，例如“任务结果如何”“为什么只回来两人”“你们刚才遭遇了什么”，而不是抹掉前文。',
    '- 关系表逐行隔离：每行的共同经历、私下通信、称呼与关系只归该行姓名本人，其他人物不得读取；跨角色传播必须有本回合亲历、被告知或公开事实来源。',
    '- 若要表现 NPC 不记得或装作不认识，正文必须给出明确原因：失忆、伪装、通讯隔离、误认、被迫演戏或认知污染；否则视为错误。',
  ];
  if (currentLocation) lines.push(`- 当前地点：${currentLocation}。人物回应必须同时承接当前地点和之前任务链。`);

  lines.push('', '关系表：');
  for (const { npc, memories, isRecent, isSceneNpc } of candidates) {
    const tags = [
      格式化NPC关系(npc.好感度, Boolean(npc.亲密关系)),
      npc.同行 ? '同行中' : '',
      isSceneNpc ? '当前场景人物' : '',
      isRecent ? '近期见过' : '',
      npc.原著角色 ? '原著角色' : '',
    ].filter(Boolean);
    const turnLine = `初见第${Math.max(1, Number(npc.初见回合 || 1))}回合，最近第${Math.max(1, Number(npc.最近回合 || npc.初见回合 || 1))}回合`;
    const memoryLine = memories.length ? `；${npc.姓名}本人私有共同经历：${memories.slice(-3).join('；')}` : '';
    const courierMemoryLine = buildRecentCourierMemoryLine(npc);
    const introLine = npc.介绍 ? `；身份/职责：${npc.介绍}` : '';
    lines.push(`- ${npc.姓名}${npc.别名 ? `（${npc.别名}）` : ''}｜${tags.join(' · ')}｜好感${npc.好感度 > 0 ? '+' : ''}${npc.好感度}｜${turnLine}${introLine}${memoryLine}${courierMemoryLine}`);
  }

  for (const name of fallbackNames) {
    lines.push(`- ${name}｜近期正文/玩家输入明确出现或预期相关｜档案尚未落库｜必须读取即时剧情回顾和最近正文锚点；若其中显示其刚发生对话、动作、委托、冲突或同行状态，正文必须承接，禁止写成完全陌生、初次见面或无记忆。`);
  }

  return lines.join('\n');
}

// 已知伙伴注入：按相关度过滤（同行 > 近回合见过 > 有记忆/好感 > 高好感），避免刚见过的人过早掉出上下文。
// 路人（tier='extra'）只注入近期或已有可承接关系/记忆的少量对象，避免上下文爆炸。
function buildCompanionsSection(npcRecords?: NPC记录[], turnCount = 0): string {
  if (!npcRecords || npcRecords.length === 0) return '';
  const companions = npcRecords.filter((n) => n.阶位 === 'companion');
  const recentCutoff = Math.max(1, turnCount - RECENT_EXTRA_NPC_PROMPT_TURN_WINDOW);
  const recentExtras = npcRecords
    .filter((n) => {
      if (n.阶位 !== 'extra') return false;
      const memoryCount = 提取NPC同行记忆文本列表(n).length;
      return Number(n.最近回合 || 0) >= recentCutoff || memoryCount > 0 || n.好感度 !== 0 || n.关系 !== 'stranger';
    })
    .sort((a, b) => {
      const recentDiff = Number(b.最近回合 || 0) - Number(a.最近回合 || 0);
      if (recentDiff !== 0) return recentDiff;
      const memoryDiff = 提取NPC同行记忆文本列表(b).length - 提取NPC同行记忆文本列表(a).length;
      if (memoryDiff !== 0) return memoryDiff;
      return Math.abs(b.好感度) - Math.abs(a.好感度);
    });
  if (companions.length === 0 && recentExtras.length === 0) return '';

  const sorted = [...companions].sort((a, b) => {
    if (a.同行 !== b.同行) return a.同行 ? -1 : 1;
    const recentDiff = Number(b.最近回合 || 0) - Number(a.最近回合 || 0);
    const aIsRecent = Number(a.最近回合 || 0) >= recentCutoff;
    const bIsRecent = Number(b.最近回合 || 0) >= recentCutoff;
    if (aIsRecent !== bIsRecent) return aIsRecent ? -1 : 1;
    const affDiff = Math.abs(b.好感度) - Math.abs(a.好感度);
    if (affDiff !== 0) return affDiff;
    return recentDiff;
  });

  const formatNpc = (n: NPC记录) => {
    const tags: string[] = [格式化NPC关系(n.好感度, Boolean(n.亲密关系))];
    if (n.同行) tags.push('同行中');
    if (n.原著角色) tags.push('原著角色');
    const desc: string[] = [];
    if (n.对玩家称呼) desc.push(`称呼：${n.对玩家称呼}`);
    if (n.外貌) desc.push(`外貌：${n.外貌}`);
    if (n.穿着) desc.push(`穿着：${n.穿着}`);
    if (n.说话方式) desc.push(`说话方式：${n.说话方式}`);
    if (n.性格 && !n.原著角色) desc.push(`性格：${n.性格}`);
    if (n.性格 && n.原著角色) desc.push(`临时/旧档案性格参考：${n.性格}（只作状态线索，长期人格以图鉴人物主体资料为准）`);
    if (n.介绍) desc.push(`介绍：${n.介绍}`);
    if ((n.玩家纠正记录 ?? []).length > 0) {
      desc.push(`玩家纠正记录（必须遵守，避免重复跑偏）：${(n.玩家纠正记录 ?? []).slice(-3).join('；')}`);
    }
    if (n.原著角色 && (n.说话方式 || n.性格)) {
      desc.push('表现要求：本回合若该角色在场或被自然牵引出场，必须体现说话方式和主体人格；不要连续数回合只沉默旁观。');
    }
    const memories = 提取NPC同行记忆文本列表(n).slice(-4);
    if (memories.length) desc.push(`${n.姓名}本人私有同行记忆：${memories.join('；')}（其他 NPC 禁止读取）`);
    const courierMemories = getRecentCourierMemoryTexts(n).slice(-2);
    if (courierMemories.length) desc.push(`${n.姓名}本人私有手机消息：${courierMemories.join('；')}（其他 NPC 禁止读取；正文若该角色入场，承接通信热度与未尽话题）`);
    const descPart = desc.length ? `\n  ${desc.join('；')}` : '';
    return `- ${n.姓名}${n.别名 ? `（${n.别名}）` : ''}｜${tags.join(' · ')}｜好感${n.好感度 > 0 ? '+' : ''}${n.好感度}${descPart}`;
  };

  const lines: string[] = [];
  if (sorted.length > 0) {
    lines.push(...sorted.slice(0, COMPANION_PROMPT_LIMIT).map(formatNpc));
  }
  if (recentExtras.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push('最近遇见的路人：');
    lines.push(...recentExtras.slice(0, EXTRA_NPC_PROMPT_LIMIT).map(formatNpc));
  }
  return `# 已知伙伴与路人\n\n${lines.join('\n')}`;
}
// 背包注入：按 category 分桶，每桶最多取 3 件；总数控制在前 10 件，避免上下文膨胀。
// 末尾附物品获取协议：所有写入落到正式根 背包.items。
function buildInventorySection(inventory?: TeyvatInventory): string {
  const items = inventory?.items ?? [];
  const categoryLabels: Record<ItemCategory, string> = {
    weapon: '武器', artifact: '圣遗物', food: '食物', material: '材料',
    gadget: '小道具', quest: '任务道具', furnishing: '摆设',
  };
  const buckets = new Map<ItemCategory, TeyvatItem[]>();
  for (const item of items) {
    const arr = buckets.get(item.category) ?? [];
    arr.push(item);
    buckets.set(item.category, arr);
  }

  const blocks: string[] = [];
  let total = 0;
  for (const [cat, items] of buckets) {
    if (total >= 10) break;
    const slice = items.slice(0, Math.min(3, 10 - total));
    total += slice.length;
    const names = slice.map((it) => `${it.name}×${it.quantity}(${it.rarity}星${it.artifactSlot ? `·${it.artifactSlot}` : ''})`).join('、');
    blocks.push(`- ${categoryLabels[cat]}：${names}`);
  }

  const overview = items.length === 0
    ? '- (空)'
    : blocks.join('\n');

  const protocol = [
    '',
    '## 物品获取协议',
    '剧情中旅行者获得任何实体物品（食物、小道具、武器、圣遗物、材料、任务道具、摆设）都要用变量命令落地到背包，',
    '不要只在叙述里提及而不入库。格式:',
    '`push 背包.items = {"category":"food","name":"提瓦特煎蛋","rarity":1,"quantity":2}`',
    '- category 只能是 weapon / artifact / food / material / gadget / quest / furnishing。',
    '- rarity 必须是 1 / 2 / 3 / 4 / 5 的整数；quantity 必须是正整数。',
    '- artifact 必须额外写 artifactSlot：flower / plume / sands / goblet / circlet；其他类别不得写 artifactSlot。',
    '- 同 id 的可堆叠物品会自动合并数量，直接 push 即可，不要手动修改 quantity。',
    '- narrativeEffects 使用字符串数组；useEffects 使用 `{target,value,basis?}` 对象数组，只用于 food / gadget 的叙事提示。',
    '- 不要写旧颜色品质、旧分类、装备槽位或穿戴状态。',
  ].join('\n');

  return `# 背包概览\n\n${overview}\n${protocol}`;
}

// 剧情注入：当前 active 节点 + 最近 3 个 completed 节点 + active 节点的 AI引导。
function buildPlotSection(plotNodes?: 剧情节点[]): string {
  if (!plotNodes || plotNodes.length === 0) return '';
  const active = plotNodes.filter((n) => n.状态 === 'active');
  const recentCompleted = plotNodes
    .filter((n) => n.状态 === 'completed')
    .sort((a, b) => b.更新回合 - a.更新回合)
    .slice(0, 3);
  if (active.length === 0 && recentCompleted.length === 0) return '';

  const lines: string[] = [];
  if (active.length) {
    lines.push('- 进行中节点：');
    for (const n of active) {
      lines.push(`  · ${n.标题}（${PLOT_STATUS_LABELS[n.状态]}）${n.摘要 ? ` — ${n.摘要}` : ''}`);
      if (n.AI引导) lines.push(`    引导：${n.AI引导}`);
    }
  }
  if (recentCompleted.length) {
    lines.push('- 近期完成节点：');
    for (const n of recentCompleted) {
      lines.push(`  · ${n.标题}${n.摘要 ? ` — ${n.摘要}` : ''}`);
    }
  }
  return `# 主线进度\n\n${lines.join('\n')}`;
}

// 蒸汽鸟报注入：最近 5 条标题摘要，按 turn 倒序。
function buildSteambirdSection(steambird?: SteambirdNews): string {
  if (!steambird?.articles.length) return '';
  const recent = [...steambird.articles].sort((a, b) => b.turn - a.turn).slice(0, 5);
  const lines = recent.map(
    (article) => `- [${article.section} · 第 ${article.turn} 回] ${article.title}`,
  );
  return `# 近期蒸汽鸟报\n\n${lines.join('\n')}`;
}

function getRecentCourierMemoryTexts(npc: NPC记录): string[] {
  return (npc.同行记忆 ?? [])
    .filter((item): item is NPC同行记忆条目 => typeof item !== 'string' && item?.来源 === '手机')
    .map((item) => item.摘要?.trim())
    .filter((text): text is string => Boolean(text));
}

function buildRecentCourierMemoryLine(npc: NPC记录): string {
  const courierMemories = getRecentCourierMemoryTexts(npc).slice(-2);
  return courierMemories.length
    ? `；${npc.姓名}本人私有手机消息：${courierMemories.join('；')}（其他 NPC 禁止读取）`
    : '';
}

function buildQuestSection(任务?: 任务系统): string {
  const active = Array.isArray(任务?.进行中) ? 任务.进行中 : [];
  if (active.length === 0) return '';
  const lines = ['## 当前剧情任务', ''];;
  for (const task of active) {
    lines.push(`- 【${task.标题}】${task.描述 || ''}`);
    for (const target of task.目标 ?? []) {
      const progress = target.完成 ? '✔ 已完成' : `${target.当前数量}/${target.目标数量}`;
      lines.push(`  - ${target.描述}（${progress}）`);
    }
  }
  lines.push('', '规则：任务进度由系统结算，AI 不得替玩家完成任务或擅自变更任务状态。');
  return lines.join('\n');
}

function buildCourierSection(courier?: CourierSystem): string {
  if (!courier) return '';
  const compressed = courier.conversations
    .flatMap((conversation) =>
      (conversation.localArchive?.compressedSummaries ?? []).map((summary) => ({
        title: conversation.title,
        type: conversation.type,
        summary,
      })),
    )
    .filter((item) => item.summary.trim())
    .slice(-6);
  const pendingSeeds = courier.deliverySeeds
    .filter((seed) => seed.status === 'pending')
    .slice(-5);
  if (!compressed.length && !pendingSeeds.length) return '';

  const lines: string[] = [];
  lines.push('# 手机通讯摘要（内部协议名：信使）');
  lines.push('');
  lines.push('- 「手机」是提瓦特世界中的传讯法器界面；内部协议里的「信使通讯」就是玩家手机中的聊天。叙事可描写传讯法器或符合地区文化的传讯形式，但事实必须以这里的聊天记录为准。');
  lines.push('- 这里不是完整通讯原文，只是已经压缩落地的通讯事实与系统待投递数据。');
  lines.push('- 叙事只能让实际会话参与者承接对应事实、约定与关系变化；私聊只归私聊双方，群聊只归当时群成员，禁止让未参与的 NPC 莫名知情。');
  lines.push('- 不要代替玩家回复，也不要把通讯改写成正文大段复述。');
  if (compressed.length) {
    lines.push('');
    lines.push('## 已压缩通讯摘要');
    for (const item of compressed) {
      const typeLabel = item.type === 'group'
        ? '群聊·仅群成员知情'
        : item.type === 'system'
          ? '系统·仅玩家界面可见'
          : '私聊·仅会话参与者知情';
      lines.push(`- [${typeLabel}] ${item.title}：${item.summary}`);
    }
  }
  if (pendingSeeds.length) {
    lines.push('');
    lines.push('## 待处理来信（系统调度信息，任何 NPC 不知情）');
    lines.push('- 以下内容尚未投递，不是已经发生的通讯或公开事实；不得据此让任何 NPC 提前行动、回应或知情。');
    for (const seed of pendingSeeds) {
      lines.push(`- [系统调度信息，任何 NPC 不知情 · ${seed.priority}] ${seed.title}：${seed.context}`);
    }
  }
  return lines.join('\n');
}

function buildElementalEchoSection(
  traveler: 角色数据结构,
  worldState: 世界状态,
  awakeningPhase?: 元素回响阶段,
): string {
  const activeElement = worldState.进行中元素回响;
  if (activeElement) {
    const attunement = traveler.元素共鸣.find((item) => item.element === activeElement);
    if (!attunement) return '';
    const elementName = ELEMENT_NAMES[activeElement];
    if (awakeningPhase === 'judgement') {
      return `# 元素回响·回应回合

玩家已经回答了三道诘问。用 2-4 段叙事回应其选择，让意识空间中的${elementName}元素回应旅行者，再将旅行者带回原本的现实场景。结论固定为共鸣深化，不设置失败、惩罚或滞留。

在 body 中加入一个玩家可见的 system 块，其 text 明确包含“共鸣深化”；同时在 factCandidates 中加入 {"domain":"system","fact":"elemental_echo_result:共鸣深化","evidence":"共鸣深化"}。其余根字段仍按 NarrativeTurn 合同输出。

本回合不要重复出题，也不要用变量命令修改元素掌握度。`;
    }

    const questions = ELEMENT_ECHO_QUESTIONS[activeElement];
    return `# 元素回响·出题回合

旅行者正在回应${elementName}元素。不要推进主剧情、不要描写现实动作，choices 输出空数组。结合旅行者的具体经历，把下列主题加工为三道有真实取舍的诘问：
${questions.map((question, index) => `${index + 1}. ${question}`).join('\n')}

把三道题作为玩家可见的 body system 块输出，仍保持完整 NarrativeTurn JSON。factCandidates 为空，不输出元素结果或变量更新。`;
  }

  const invitedElement = worldState.元素回响邀请;
  if (invitedElement) {
    return `# 元素回响·待玩家进入

${ELEMENT_NAMES[invitedElement]}元素已经发出回响邀请，等待玩家在界面确认。本回合不要重复邀请，也不要提前描写旅行者进入意识空间。`;
  }

  const ready = traveler.元素共鸣.filter(canInviteElementalEcho);
  if (ready.length === 0) return '';
  const inviteElement = ready[0];
  if (!inviteElement) return '';
  return `# 元素回响·时机判定

以下元素掌握度已达到回响阈值 ${ELEMENTAL_ECHO_INVITE_MASTERY}：${ready.map((item) => `${ELEMENT_NAMES[item.element]}（${item.element}）`).join('、')}。仅在安静且适合内省的剧情间隙，至多发出一条邀请。若发出邀请，在 body 中加入可见 system 块并在 factCandidates 中加入 {"domain":"system","fact":"elemental_echo_invite:${inviteElement.element}","evidence":"<逐字摘自该 system 块的非空片段>"}。`;
}
