/**
 * M6 拆分 · 阶段 3：主剧情提示词装配（原 `executeSendWorkflow` 内部步骤 2，
 * 原 `sendWorkflow.ts:745-1074`，共 330 行）。
 *
 * 拆分原则：**纯搬运，不改行为**。
 *  - 被搬动的代码逐字保留（含原有换行与缩进），回归脚本会对源码文本做断言；
 *  - 唯一改动是把 `deps.rerollContext` 改成入参 `rerollContext`（纯 token 替换，语义不变）；
 *  - 块内**没有顶层 return**，也不需要回写外层可变量（写入外层 0 处），
 *    因此本阶段只通过返回值把块内声明的值交给调用方。
 */
import type { SteambirdNews } from '@/models/teyvat/steambird';
import { buildOpeningSystemPrompt, buildSystemPrompt } from './systemPromptBuilder';
import { buildTavernMessageChain, formatTavernChainReport, type TavernChainReport } from './tavernMessageChainBuilder';
import { getCurrentSTPresetV2, explainTavernPresetActivation } from '@/utils/stSettingsNormalizer';
import {
  buildPresentationForPreset,
  buildPresetPrecedenceHeader,
  formatPresetPresentationSummary,
  resolvePresetPresentation,
} from '@/utils/presetPresentation';
import { pushToast } from '@/utils/toastStore';

/** 已提示过投递报告的预设（每个会话一次即可，避免每回合刷屏）。 */
const reportedTavernPresets = new Set<string>();
/** 已提示过的「未使用预设」原因（同样只提示一次）。 */
const reportedTavernInactiveReasons = new Set<string>();
/** 已提示过的预设表现层问题（例如文风填充模块没勾选，只提示一次）。 */
const reportedPresetPresentationIssues = new Set<string>();
import { evaluateStoryWeavingGate, getStoryWeavingInjectionDiagnostics } from '@/services/storyWeaving';
import { selectNpcLedgersForTurn} from '@/models/npc';
import {
  buildImmediateStoryReview,
  buildCodexKeywordRecallQuery,
  buildMainRecallQuery,
  getMainHistoryWindow} from './historyWindow';
import { getAnticipatedNpcNamesForTurn, getCodexNpcNamesForTurn} from './npcPresence';
import { buildElementalFieldPromptSection } from '@/models/teyvat';
import { createMacroContext, type MacroContext, type MacroGameState } from '@/utils/macroEngine';
import { updateTriggerStatesAfterTurn } from '@/utils/worldbook';
import { pushWorkflowQueueTask as pushQueueTask } from './workflowQueue';
import { buildMainRecallStage } from './mainRecallStage';
import { buildOpeningSteambirdPreprocess } from './openingSteambirdStage';
import type { UseGameStateReturn } from '@/hooks/useGameState';
import type { API配置项 } from '@/models/settings';
import type { SendWorkflowDeps } from './sendWorkflow';
import { compactForRerollInstruction } from './sendWorkflow';
import { 创建聊天消息, type 聊天消息 } from '@/models/chat';
import { 格式化开局档案上下文 } from '@/models/world';
import { 创建默认图鉴系统设置 } from '@/models/settings';
import { 构建天气Prompt片段 } from '@/data/weatherRules';

export interface MainPromptAssemblyDeps {
  state: UseGameStateReturn;
  userInput: string;
  updatedHistory: 聊天消息[];
  userMsg: 聊天消息;
  mainStoryConfig: API配置项;
  effectiveWorld: UseGameStateReturn['世界'];
  isOpeningSystemTrigger: boolean;
  isAwakeningEnterTrigger: boolean;
  assertWorkflowActive: () => void;
  openingInstruction: string;
  awakeningInstruction: string;
  rerollContext: SendWorkflowDeps['rerollContext'];
}

export type MainPromptAssemblyResult = Awaited<ReturnType<typeof runMainPromptAssembly>>;

export async function runMainPromptAssembly(deps: MainPromptAssemblyDeps) {
  const {
    state,
    userInput,
    updatedHistory,
    userMsg,
    mainStoryConfig,
    effectiveWorld,
    isOpeningSystemTrigger,
    isAwakeningEnterTrigger,
    assertWorkflowActive,
    openingInstruction,
    awakeningInstruction,
    rerollContext,
  } = deps;

    // 2. Build system prompt
    const currentScope: 'opening' | 'main' | 'elementalEcho' = effectiveWorld.进行中元素回响
      ? 'elementalEcho'
      : state.turnCount === 1
        ? 'opening'
        : 'main';
    const awakeningPhase: 'question' | 'judgement' | undefined = effectiveWorld.进行中元素回响
      ? (isAwakeningEnterTrigger ? 'question' : 'judgement')
      : undefined;
    const openingArchiveText = 格式化开局档案上下文(effectiveWorld.开局档案);
    const worldbookCtx = {
      recentUserInput: userInput,
      recentAIResponse: '',
      worldName: effectiveWorld.当前时段?.名称 ?? '',
      travelerName: state.旅人.姓名,
      turnCount: state.turnCount,
      startScenarioId: effectiveWorld.起航之地ID,
      startSceneName: effectiveWorld.开局档案?.章节锚点名称 ?? effectiveWorld.当前地点,
      currentLocation: effectiveWorld.当前地点,
      openingRegionName: effectiveWorld.开局档案?.地区名称,
      openingChapterName: effectiveWorld.开局档案?.章节锚点名称,
      openingEntryText: effectiveWorld.开局档案?.玩家介入原文,
      openingSource: effectiveWorld.开局档案?.来源,
      openingArchiveText,
      npcNames: getCodexNpcNamesForTurn({
        world: effectiveWorld,
        npcs: state.NPC,
        history: updatedHistory,
        userInput,
        turnCount: state.turnCount,
      }),
      originalProtagonist: effectiveWorld.原著主角,
      currentScope,
      // 当前剧情模式，用于按 storyModeGate 过滤主线世界书（4 选 1）
      storyMode: effectiveWorld.剧情模式,
      canonTrack: state.game.原著轨道,
      // Phase 7.1：世界书扫描扩展（消息历史 + 触发状态）
      recentMessages: updatedHistory
        .map((m) => (typeof m.content === 'string' ? m.content : ''))
        .filter(Boolean)
        .slice(-100),
      messageCount: state.turnCount,
      worldbookTriggerStates: state.gameSettings.worldbookTriggerStates,
    };
    const anticipatedCodexNpcNames = getAnticipatedNpcNamesForTurn({
      world: effectiveWorld,
      history: updatedHistory,
      userInput,
      npcRecords: state.NPC,
    });
    const immediateStoryReviewForCodex = !isOpeningSystemTrigger ? buildImmediateStoryReview(updatedHistory) : '';
    const latestCodexStoryPlan = [...updatedHistory]
      .reverse()
      .find((message) => message.role === 'assistant' && message.parsedResponse?.continuation.summary.trim())
      ?.parsedResponse?.continuation.summary.trim();
    const storyWeavingDiagnostics = state.gameSettings.剧情编织系统?.enabled && state.gameSettings.剧情编织系统.currentWindow
      ? getStoryWeavingInjectionDiagnostics(state.剧情编织)
      : null;
    const recallQuery = buildMainRecallQuery({
      userInput,
      history: updatedHistory,
      currentLocation: effectiveWorld.当前地点,
      npcNames: worldbookCtx.npcNames,
    });
    const codexRecallQuery = buildCodexKeywordRecallQuery({
      userInput,
      history: updatedHistory,
    });
    let steambirdForPrompt = state.蒸汽鸟报;
    let openingSteambirdForSave: SteambirdNews | null = null;
    let openingSteambirdPreprocessed = false;
    if (isOpeningSystemTrigger && state.gameSettings.蒸汽鸟报系统?.enabled && state.gameSettings.蒸汽鸟报系统?.autoGenerate) {
      pushQueueTask(state, 'steambird', 'pending', {
        detail: '开局前正在先处理一次蒸汽鸟报，用作首回合世界背景。',
        cancellable: true,
      });
      try {
        const preSteambird = buildOpeningSteambirdPreprocess({
          current: state.蒸汽鸟报,
          world: effectiveWorld,
          turnCount: state.turnCount,
        });
        assertWorkflowActive();
        if (preSteambird?.changed) state.set蒸汽鸟报(preSteambird.steambird);
        openingSteambirdPreprocessed = preSteambird?.changed === true;
        steambirdForPrompt = preSteambird?.steambird ?? state.蒸汽鸟报;
        openingSteambirdForSave = preSteambird?.steambird ?? null;
        pushQueueTask(state, 'steambird', preSteambird ? 'success' : 'skipped', {
          detail: preSteambird?.changed
            ? `开局蒸汽鸟报预处理完成，当前 ${preSteambird.steambird.articles.length} 篇报道。`
            : preSteambird
              ? '开局蒸汽鸟报预处理完成，但本轮没有可写报道变化。'
              : '开局私人配置不作为新闻；待正文结算后确认公开事实。',
        });
      } catch (err) {
        pushQueueTask(state, 'steambird', 'failed', {
          detail: err instanceof Error ? err.message : '开局蒸汽鸟报预处理失败。',
          failCount: state.gameSettings.蒸汽鸟报系统?.api.retryCount ?? 1,
        });
      }
    }
    const recallStage = buildMainRecallStage({
      isOpeningSystemTrigger,
      turnCount: state.turnCount,
      memoryInjectionEnabled: state.gameSettings.enableMemoryInjection,
      memorySettings: {
        irminsulEnabled: state.gameSettings.记忆系统?.世界树启用 !== false,
        earliestRecallTurn: state.gameSettings.记忆系统?.世界树召回最早触发回合 ?? 10,
        recallLimit: state.gameSettings.记忆系统?.世界树召回条数 ?? 8,
      },
      codexSettings: {
        enabled: Boolean(state.gameSettings.图鉴系统?.enabled && state.图鉴 && worldbookCtx.recentUserInput),
        aiSupplementEnabled: state.gameSettings.图鉴系统?.enableAiSupplement === true,
        maxRelatedEntries: state.gameSettings.图鉴系统?.maxRelatedEntries ?? 创建默认图鉴系统设置().maxRelatedEntries,
      },
      memoryCounts: {
        short: state.记忆.短期记忆.length,
        medium: (state.记忆.中期记忆 ?? []).length,
        long: state.记忆.长期记忆.length,
        immediate: state.记忆.即时记忆.length,
      },
      irminsul: state.世界树,
      codex: state.图鉴,
      recallQuery,
      codexRecallQuery,
    });
    const {
      irminsulEnabled,
      irminsulRecallEnabled,
      codexRecallEnabled,
      irminsulPreview,
      codexPreview,
      summary: recallSummaryForTurn,
      fullContent: recallFullContentForTurn,
    } = recallStage;
    const storyWeavingGate = state.gameSettings.剧情编织系统?.enabled && state.gameSettings.剧情编织系统.currentWindow
      ? evaluateStoryWeavingGate(state.剧情编织, worldbookCtx)
      : null;
    pushQueueTask(state, 'irminsul', irminsulRecallEnabled ? 'pending' : 'skipped', {
      detail: irminsulRecallEnabled ? '正在检索世界树记忆档案。' : '未到世界树召回回合，已跳过。',
      cancellable: irminsulRecallEnabled,
    });
    assertWorkflowActive();
    state.setLiveRecallSummary(recallSummaryForTurn);
    state.setLiveRecallFullContent(recallFullContentForTurn);
    state.setWorkflowHint(recallStage.workflowHint);
    state.setWorkflowStatus('done');
    const immediateStoryReview = !isOpeningSystemTrigger ? buildImmediateStoryReview(updatedHistory) : '';
    const storyRecallInjection = [
      immediateStoryReview
        ? ['# 即时剧情回顾', '', '【即时剧情回顾】', immediateStoryReview].join('\n')
        : '',
      irminsulPreview?.injection ?? '',
    ].filter((item) => item.trim()).join('\n\n');
    const npcLedgerSelection = !isOpeningSystemTrigger
      ? selectNpcLedgersForTurn({
          records: state.NPC,
          turnCount: state.turnCount,
          explicitNames: worldbookCtx.npcNames,
          sceneNames: effectiveWorld.当前时段?.人物?.map((npc) => npc.姓名),
          recalledNames: worldbookCtx.npcNames,
        })
      : undefined;
    const currentTriggerType = rerollContext
      ? 'swipe'
      : isOpeningSystemTrigger
        ? 'opening'
        : 'normal';

    // ST 预设兼容：宏引擎上下文。
    // local 每回合重置；global 从 settings 读取副本（避免直接 mutate state）。
    // 处理完后若 global 变化，回写到 settings.macroGlobalVars 实现跨会话持久化。
    const prevGlobalSnapshot = state.gameSettings.macroGlobalVars ?? {};
    // 组装游戏状态快照供 ST 标准宏使用（{{char}}/{{user}}/{{lastMessage}} 等）
    const lastMsg = updatedHistory[updatedHistory.length - 1];
    const lastUserMsg = [...updatedHistory].reverse().find((m) => m.role === 'user');
    const lastAssistantMsg = [...updatedHistory].reverse().find((m) => m.role === 'assistant');
    const macroGameState: MacroGameState = {
      charName: state.旅人.姓名 || state.旅人.别名 || '无名旅者',
      userName: state.旅人.姓名 || '无名旅者',
      lastMessage: lastMsg?.content ?? '',
      lastUserMessage: lastUserMsg?.content ?? '',
      lastCharMessage: lastAssistantMsg?.content ?? '',
      messageCount: updatedHistory.length,
      turnCount: state.turnCount,
      modelName: mainStoryConfig.model,
      maxContext: mainStoryConfig.maxContext,
    };
    const macroCtx: MacroContext = createMacroContext(prevGlobalSnapshot, macroGameState);

    const builtPrompt = isOpeningSystemTrigger
      ? buildOpeningSystemPrompt(
          state.旅人,
          effectiveWorld,
          state.gameSettings,
          state.turnCount,
          state.worldbooks,
          worldbookCtx,
          steambirdForPrompt,
          currentTriggerType,
          macroCtx,
          state.任务,
        )
      : buildSystemPrompt(
          state.旅人,
          effectiveWorld,
          state.记忆,
          state.gameSettings,
          state.turnCount,
          state.worldbooks,
          worldbookCtx,
          state.NPC,
          state.蒸汽鸟报,
          state.剧情,
          state.剧情编织,
          state.图鉴,
          state.世界树,
          state.手机,
          awakeningPhase,
          storyRecallInjection || (irminsulRecallEnabled ? '' : undefined),
          codexRecallEnabled ? (codexPreview?.injection ?? '') : undefined,
          Boolean(irminsulPreview?.injection),
          npcLedgerSelection,
          currentTriggerType,
          macroCtx,
          state.任务,
          state.背包,
        );

    // 宏引擎处理后回写 globalVars（仅当 global 变化时）
    if (Object.keys(macroCtx.global).length !== Object.keys(prevGlobalSnapshot).length
      || Object.entries(macroCtx.global).some(([k, v]) => prevGlobalSnapshot[k] !== v)) {
      state.setGameSettings((prev) => ({ ...prev, macroGlobalVars: { ...macroCtx.global } }));
    }

    // Phase 7.1：本回合世界书注入完成后，回写触发状态表（用于 delay / cooldown 判断）。
    // 必须在 buildSystemPrompt 之后调用，保证本回合 cooldown 检查用的是上一回合的状态。
    const nextTriggerStates = updateTriggerStatesAfterTurn(state.worldbooks, worldbookCtx);
    if (nextTriggerStates !== state.gameSettings.worldbookTriggerStates) {
      state.setGameSettings((prev) => ({ ...prev, worldbookTriggerStates: nextTriggerStates }));
    }
    let systemPrompt = builtPrompt.systemPrompt;
    // 天气判断 prompt 注入
    const 天气片断 = 构建天气Prompt片段(effectiveWorld.当前地点, effectiveWorld.当前天气);
    systemPrompt = systemPrompt + '\n\n' + 天气片断;
    // G1：场面元素状态一致性提示（追加在末尾，保持缓存前缀稳定）。
    const elementalSection = buildElementalFieldPromptSection(state.game.叙事.元素场面, state.game.叙事.元素事件);
    if (elementalSection) {
      systemPrompt = systemPrompt + '\n\n' + elementalSection;
    }
    // Phase 4: In-Chat depth 注入。非 system 角色的模块消息按 depth 插入聊天历史。
    const moduleChatMessages = builtPrompt.chatModuleMessages;
    const currentPresetV2 = getCurrentSTPresetV2(state.gameSettings);
    // 明确告知「为什么这次没走预设链」——总开关关了 / 库里有预设但没选中 / 选中的预设已不在库里。
    // 旧行为是完全静默，玩家只能感到「预设没生效」（2026-10-03 用户实测反馈）。
    const presetInactiveReason = currentPresetV2 ? null : explainTavernPresetActivation(state.gameSettings);
    if (presetInactiveReason && !reportedTavernInactiveReasons.has(presetInactiveReason)) {
      reportedTavernInactiveReasons.add(presetInactiveReason);
      console.warn(`[ST V2] 本次未使用酒馆预设：${presetInactiveReason}`);
      pushToast({ kind: 'info', title: '本次未使用酒馆预设', detail: presetInactiveReason, durationMs: 12000 });
    }
    const shouldTryTavernV2 =
      state.gameSettings.enableStPreset !== false &&
      Boolean(currentPresetV2?.preset?.prompts?.length) &&
      Boolean(currentPresetV2?.preset?.prompt_order?.length);
    let tavernV2Messages: 聊天消息[] | null = null;
    let tavernV2Error: unknown = null;
    /** 投递报告：本次酒馆预设哪些条目真的进了请求（供界面与诊断展示）。 */
    let tavernChainReport: TavernChainReport | null = null;
    const recentHistory = getMainHistoryWindow(updatedHistory, state.gameSettings, state.记忆);
    const tavernHistory = recentHistory.filter((msg) => msg.id !== userMsg.id);
    if (rerollContext && !isOpeningSystemTrigger) {
      systemPrompt = [
        systemPrompt,
        '',
        '# 重roll生成约束',
        `本次请求是玩家对上一版回复的重roll。重roll nonce: ${rerollContext.nonce}`,
        '必须基于同一事实起点重新组织镜头、描写、对话和节奏；禁止复用上一版回复的具体段落、句式、变量草稿或行动选项。',
        '开场方式、对白切入、段落顺序和结尾钩子都要换；不要复用上一版前三句、连续短语或相同收束。',
        '可以保留必要事实一致性，但正文展开方式必须明显不同；如果上一版已经处理某事件，本次不得因为重roll而把旧副作用当作已发生事实。',
        rerollContext.previousResponse
          ? `上一版回复摘录（仅用于避重复，不是当前事实）：${compactForRerollInstruction(rerollContext.previousResponse)}`
          : '',
      ].filter(Boolean).join('\n');
    }

    if (shouldTryTavernV2 && currentPresetV2) {
      try {
        const latestTavernInput = isOpeningSystemTrigger
          ? openingInstruction
          : isAwakeningEnterTrigger
            ? awakeningInstruction
            : userInput;
        const tavernReportOut = { current: null as TavernChainReport | null };
        const tavernChain = buildTavernMessageChain({
          settings: state.gameSettings,
          preset: currentPresetV2.preset,
          characterId: state.gameSettings.currentStCharacterId ?? currentPresetV2.characterId ?? null,
          chatHistory: tavernHistory,
          latestUserInput: latestTavernInput,
          playerName: state.旅人.姓名 || state.旅人.别名 || '无名旅者',
          playerRole: state.旅人,
          includeNativeContextInWorldbook: false,
          includeNativeNarrative: false,
          triggerType: currentTriggerType,
          macroCtx,
        }, tavernReportOut);
        tavernChainReport = tavernReportOut.current;
        tavernV2Messages = tavernChain.map((msg) => 创建聊天消息(msg.role, msg.content));
        // 表现层契约（字数下限 / 文风段 / 外壳标签 / 是否要求可见思维链）：解析自预设自身的变量与正文。
        const presentation = resolvePresetPresentation(state.gameSettings)
          ?? buildPresentationForPreset(currentPresetV2.preset, {
            presetId: currentPresetV2.id,
            presetName: currentPresetV2.name,
            characterId: state.gameSettings.currentStCharacterId ?? currentPresetV2.characterId ?? null,
          });
        const presentationSummary = presentation ? formatPresetPresentationSummary(presentation) : '';
        if (tavernChainReport) {
          // 投递报告（2026-10-03）：玩家能直接看到「预设到底哪一步没生效」，
          // 而不是只看到导入时那句「已存入预设库」。每个预设每个会话只提示一次，避免刷屏。
          console.info(
            `[ST V2] 预设「${currentPresetV2.name}」投递：${formatTavernChainReport(tavernChainReport)}`,
            tavernChainReport,
          );
          if (presentationSummary) {
            console.info(`[ST V2] 预设「${currentPresetV2.name}」表现层：${presentationSummary}`, presentation);
          }
          if (!reportedTavernPresets.has(currentPresetV2.id)) {
            reportedTavernPresets.add(currentPresetV2.id);
            pushToast({
              kind: 'info',
              title: `酒馆预设已生效：${currentPresetV2.name}`,
              detail: `${formatTavernChainReport(tavernChainReport)}${presentationSummary ? `｜${presentationSummary}` : ''}。定义型条目按 ST 语义不产出消息，但它们的变量已生效；「悬空」是预设里引用了不存在的条目。`,
              durationMs: 12000,
            });
          }
        }
        if (tavernV2Messages.length === 0) {
          tavernV2Messages = null;
          tavernV2Error = new Error('ST V2 消息链为空，已回退 legacy 主剧情路径');
          console.warn('[ST V2] 消息链为空，已回退 legacy 主剧情路径');
        } else {
          // 预设优先声明（2026-10-03 用户要求：「保证预设能起作用，而且不会被别的强消息压过」）。
          // 放在 system prompt（请求的第一条）里：靠后的预设消息链因此拥有更强的支配力，
          // 同时把本应用真正不能放弃的两条机器契约写清楚，避免模型在两者之间摇摆。
          //
          // 2026-10-03 第二轮修正（用户实测「字数没有达标、文风没有启动」）：
          // 声明里现在带上**预设的实际要求**（字数下限、文风段是否有内容、外壳标签、是否需要可见
          // 思维链），而不是一段通用措辞 —— 通用措辞无法阻止内置默认值在生成点附近把预设压回去。
          systemPrompt = [
            presentation
              ? buildPresetPrecedenceHeader(presentation)
              : `# 酒馆预设优先（本回合已激活：${currentPresetV2?.name ?? '玩家导入预设'}）\n已启用玩家导入的酒馆预设作为**表现层权威**：文风、人称、叙事语气、人格演绎、输出标签、节奏与篇幅一律以该预设为准。\n本应用只保留两条机器契约，无论预设怎么写都必须同时满足：\n1) 正文必须按本应用要求的**载体格式**输出（结构化字段/行动选项），否则无法解析并会判定为失败回复；\n2) 本回合的 \`<变量事实>\` 块必须输出（数值结算依赖它）。\n除这两条之外，任何冲突**一律以预设为准**；严禁用应用内置的文风/思维链/格式写法去覆盖预设的人设与输出要求。`,
            '',
            systemPrompt,
          ].filter(Boolean).join('\n');

          if (presentation) {
            // 文风段空 = 玩家自己的预设没勾文风填充模块。这不是应用能替他决定的，
            // 但必须**明确说出来**并给出可点的条目名，否则他会一直以为是应用没生效。
            if (!presentation.styleText && presentation.disabledStyleCandidates.length) {
              const issueKey = `${presentation.presetId}::style-empty`;
              if (!reportedPresetPresentationIssues.has(issueKey)) {
                reportedPresetPresentationIssues.add(issueKey);
                pushToast({
                  kind: 'error',
                  title: `预设「${presentation.presetName}」的文风段是空的`,
                  detail: `预设的〈文风〉包装已开启，但里面的填充模块没有勾选：${presentation.disabledStyleCandidates.join('、')}。到「设置 → 提示词模块 → 酒馆预设 → 条目列表」用「已关闭」筛选勾选其中一个，预设文风才会生效。`,
                  durationMs: 16000,
                });
              }
            }
          }
        }
      } catch (error) {
        tavernV2Messages = null;
        tavernV2Error = error;
        console.warn('[ST V2] 消息链构建失败，已回退 legacy 主剧情路径', error);
      }
    }

  return {
    awakeningPhase,
    storyWeavingDiagnostics,
    openingSteambirdForSave,
    openingSteambirdPreprocessed,
    irminsulEnabled,
    irminsulRecallEnabled,
    codexRecallEnabled,
    irminsulPreview,
    codexPreview,
    recallSummaryForTurn,
    recallFullContentForTurn,
    storyWeavingGate,
    npcLedgerSelection,
    systemPrompt,
    moduleChatMessages,
    currentPresetV2,
    shouldTryTavernV2,
    tavernV2Messages,
    tavernV2Error,
    recentHistory,
  };
}
