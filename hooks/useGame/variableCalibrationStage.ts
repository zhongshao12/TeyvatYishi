/**
 * M6 拆分 · 阶段 2：变量模型校准（原 `executeSendWorkflow` 内部步骤 8.5，
 * 原 `sendWorkflow.ts:1481-1858`，共 378 行）。
 *
 * 拆分原则：**纯搬运，不改行为**。
 *  - 被搬动的代码逐字保留（含原有换行与缩进）：回归脚本会对源码文本做断言，重新格式化会打红它们；
 *  - 原代码对 `recoveryJournal` 的两次赋值在**原始位置**通过 `deps.onJournalUpdated` 回写外层，
 *    而不是"函数返回后统一赋值" —— 赋值点与随后的 `await persistWorkflowRecoveryJournal` 之间
 *    存在可抛错点，而调用方在恢复路径上会读取该变量，统一赋值会造成异常路径下的行为差异；
 *  - 块内**没有顶层 return**（return 都在嵌套函数内），因此不需要早退信号量。
 */
import {
  applyLegacyGameStateOverrides,
  readLiveGameState,
  type UseGameStateReturn} from '@/hooks/useGameState';
import type { SteambirdNews } from '@/models/teyvat/steambird';
import {
  addImmediateMemory} from './memoryUtils';
import {
  collectQuestUpdatePayloads,
  notifyCommittedQuestUpdate} from './questWorkflow';
import { loadSetting, saveSetting} from '@/services/dbService';
import {
  persistWorkflowRecoveryJournal,
  updateWorkflowRecoveryJournal,
  type WorkflowRecoveryJournal} from '@/services/workflowRecovery';
import { resolveCourierApiConfig } from '@/services/ai/courierLetterModel';
import { mergeCourierSystemUpdates } from '@/services/ai/courierService';
import { runCourierDeliveryTask, runCourierReplyTask } from './courierBackgroundJobs';
import { mergeNpcWriteBack } from '@/utils/npcWriteBack';
import { applyStoryArchiveCodexRuntimeUnlock } from '@/services/codexRuntimeUnlock';
import { buildPersistedStoryWeavingSystem } from '@/data/storyWeavingPreset';
import { runPostTurnBackgroundTasks, runSteambirdPostTurnTask } from './postTurnBackgroundTasks';
import { runPostTurnIrminsulArchiveTask } from './postTurnIrminsulTask';
import { runPostTurnNarrativeImageTask } from './postTurnNarrativeImageTask';
import {
  attachNpcLedgerUpdateDebug} from './turnDebugContext';
import { globalImageTaskQueue } from '@/utils/imageTaskQueue';
import { DEFAULT_NOTIFICATION_SETTINGS, notifyEvent } from '@/utils/notifications';
import { pushToast } from '@/utils/toastStore';
import { pushWorkflowQueueTask as pushQueueTask } from './workflowQueue';
import type { API配置项 } from '@/models/settings';
import type { 聊天消息 } from '@/models/chat';
import type { NarrativeTurn } from '@/models/teyvat/narrativeTurn';
import { buildMainRecallStage } from './mainRecallStage';
import { evaluateStoryWeavingGate } from '@/services/storyWeaving';
import { 天气列表 } from '@/data/weatherRules';
import { 创建默认记忆系统设置 } from '@/models/settings';
import { runVariableCalibrationStep } from './sendWorkflow';

export interface VariableCalibrationDeps {
  state: UseGameStateReturn;
  userInput: string;
  config: API配置项;
  abortController: AbortController;
  assertWorkflowActive: () => void;
  isCurrentWorkflow: () => boolean;
  isOpeningSystemTrigger: boolean;
  effectiveWorld: UseGameStateReturn['世界'];
  displayText: string;
  parsedForDisplay: NarrativeTurn;
  aiMsg: 聊天消息;
  openingSteambirdForSave: SteambirdNews | null;
  openingSteambirdPreprocessed: boolean;
  storyWeavingGate: ReturnType<typeof evaluateStoryWeavingGate> | null;
  irminsulEnabled: boolean;
  irminsulRecallEnabled: boolean;
  irminsulPreview: ReturnType<typeof buildMainRecallStage>['irminsulPreview'];
  irminsulWithCompression: UseGameStateReturn['世界树'];
  worldAfter: UseGameStateReturn['世界'];
  travelerAfter: UseGameStateReturn['旅人'];
  worldFactCandidates: string[];
  finalHistory: 聊天消息[];
  mem: UseGameStateReturn['记忆'];
  recoveryJournal: WorkflowRecoveryJournal;
  /** 在原始位置回写外层 recoveryJournal（赋值点与落库之间可能抛错）。 */
  onJournalUpdated: (journal: WorkflowRecoveryJournal) => void;
}

export type VariableCalibrationResult = Awaited<ReturnType<typeof runVariableCalibrationStage>>;
export async function runVariableCalibrationStage(deps: VariableCalibrationDeps) {
  const {
    state,
    userInput,
    config,
    abortController,
    assertWorkflowActive,
    isCurrentWorkflow,
    isOpeningSystemTrigger,
    effectiveWorld,
    displayText,
    parsedForDisplay,
    aiMsg,
    openingSteambirdForSave,
    openingSteambirdPreprocessed,
    storyWeavingGate,
    irminsulEnabled,
    irminsulRecallEnabled,
    irminsulPreview,
    irminsulWithCompression,
    worldAfter,
    travelerAfter,
    worldFactCandidates,
  } = deps;
  let finalHistory = deps.finalHistory;
  let mem = deps.mem;
  let recoveryJournal = deps.recoveryJournal;

    // 8.5 变量模型校准：主回复完成 → 调用独立的变量模型分析正文，把结构化命令落地。
    //     失败/超时不影响主流程，只在 console 报警。
    pushQueueTask(state, 'variable', 'pending', {
      detail: '正在调用变量模型并结算回复后的状态变化。',
    });
    // 结算的基线必须是**活体根**：`state.game` 是本次发送开始那次渲染的快照，
    // 连本回合的 user 消息都还没有（`prepareSendTurn` 之后写入的），
    // 用它当基线会让变量模型看到过期状态，也会让提交时的 CAS/并发比对全部失真
    // （每次结算都被判成「存档已切换」而丢弃 —— 见 readLiveGameState 注释）。
    const liveBaseGame = readLiveGameState(state);
    const frozenSettlementState = applyLegacyGameStateOverrides(liveBaseGame, {
        chatHistory: finalHistory,
        记忆: mem,
        世界: worldAfter,
        旅人: travelerAfter,
        turnCount: liveBaseGame.turnCount + 1,
      });
    const frozenSettlementWithBackground = {
      ...frozenSettlementState,
      世界树: irminsulWithCompression,
      蒸汽鸟报: openingSteambirdForSave ?? liveBaseGame.蒸汽鸟报,
    };
    const settlementVariableDraft = parsedForDisplay.factCandidates.length
      ? JSON.stringify({ facts: parsedForDisplay.factCandidates })
      : undefined;
    recoveryJournal = updateWorkflowRecoveryJournal(recoveryJournal, {
      phase: 'settlement_pending',
      pendingSettlement: {
        settlementId: recoveryJournal.workflowId,
        source: frozenSettlementWithBackground,
        ...(settlementVariableDraft ? { variableDraft: settlementVariableDraft } : {}),
      },
    });
    deps.onJournalUpdated(recoveryJournal);
    await persistWorkflowRecoveryJournal(recoveryJournal);
    const variableOverrides = await runVariableCalibrationStep({
      state,
      mainApiConfig: config,
      userInput,
      body: displayText,
      variableDraft: settlementVariableDraft,
      turnAfter: state.turnCount + 1,
      // 结算开始那一刻的活体根：提交时用它做存档身份 CAS 基准与并发合并的祖先（见 readLiveGameState）。
      liveBaseGame,
      // 本回合主流程已经更新过的切片，传入保证变量模型看到最新值
      memorySystemSnapshot: mem,
      // 7/7a/7b 累积的 旅人 / 世界 也要带进去——否则校准 commit 会用旧值覆盖,
      // 避免抹掉刚写入的元素回响状态或元素共鸣变化。
      travelerSnapshot: travelerAfter,
      worldSnapshot: worldAfter,
      signal: abortController.signal,
      allowIrminsul: irminsulEnabled,
      shouldCommit: isCurrentWorkflow,
      baseGameSnapshot: frozenSettlementWithBackground,
      factCandidates: parsedForDisplay.factCandidates,
      questUpdates: collectQuestUpdatePayloads({ factCandidates: parsedForDisplay.factCandidates }),
      questEnabled: state.gameSettings.任务系统?.enabled === true,
      settlementId: recoveryJournal.workflowId,
      });
      if (!variableOverrides?.committedGame) {
        // 两种来源：等待期间存档已切换（CAS 拒绝）/ 流程已被取消（shouldCommit 为 false，走 abort 分支）。
        throw new Error('TEYVAT_SETTLEMENT_REJECTED：本次变量结算未写入活体存档（等待期间存档已切换或流程已取消）。');
      }
      const committedSettlementGame = variableOverrides.committedGame;
      const {
        applyStoryProgressNpcMemory,
        buildSettlementCommitFeedback,
        planPostSettlementStoryAlignment,
        preparePostSettlementNpcState,
        publishSettlementCommitFeedback,
        resolveStoryWeavingForBackgroundWrite,
      } = await import('./postSettlementCommitStage');
      const committedQuestUpdate = variableOverrides.questUpdates?.at(-1);
      const commitFeedback = buildSettlementCommitFeedback({
        beforeTalents: frozenSettlementWithBackground.旅行者.天赋,
        afterTalents: committedSettlementGame.旅行者.天赋,
        questEnabled: state.gameSettings.任务系统?.enabled === true,
        committedQuestUpdate,
        variableApplied: Object.keys(variableOverrides).some((key) => key !== 'batch' && key !== 'npcLedgerUpdate'),
      });
      recoveryJournal = updateWorkflowRecoveryJournal(recoveryJournal, {
        phase: 'settlement_committed',
        committedState: committedSettlementGame,
      });
      deps.onJournalUpdated(recoveryJournal);
      assertWorkflowActive();
      await persistWorkflowRecoveryJournal(recoveryJournal);
      publishSettlementCommitFeedback(commitFeedback, {
        queue: (task, status, detail) => pushQueueTask(state, task, status, { detail }),
        toast: (kind, title, detail) => pushToast({ kind, title, detail }),
        notifyQuest: (detail) => notifyCommittedQuestUpdate(state.gameSettings.notificationSettings, detail),
      });

      const npcSource = variableOverrides?.NPC ?? state.NPC;
      const memorySettings = state.gameSettings.记忆系统 ?? 创建默认记忆系统设置();
      const preparedNpcs = preparePostSettlementNpcState({
        source: npcSource,
        nsfwEnabled: state.gameSettings.enableNsfw,
        maleNsfwArchiveEnabled: state.gameSettings.enableMaleNsfwArchive,
        compressionThreshold: memorySettings.NPC记忆压缩阈值,
        compressionPrompt: memorySettings.NPC记忆压缩提示词,
        turn: state.turnCount,
        variableDebug: variableOverrides.npcLedgerUpdate,
      });
      let npcAfterCompression = preparedNpcs.records;
      let npcChanged = preparedNpcs.changed;
      if (preparedNpcs.debug) {
        finalHistory = attachNpcLedgerUpdateDebug(finalHistory, aiMsg.id, preparedNpcs.debug);
        state.setChatHistory(finalHistory);
      }

      let memoryAfterStoryProgress = variableOverrides?.记忆 ?? mem;
      let memoryChangedAfterSettlement = false;
      const storyPlan = planPostSettlementStoryAlignment({
        openingSystemTurn: isOpeningSystemTrigger,
        storyWeaving: state.剧情编织,
        turn: state.turnCount + 1,
        userInput,
        body: displayText,
        currentLocation: variableOverrides?.世界?.当前地点 ?? worldAfter.当前地点 ?? effectiveWorld.当前地点,
        gateSnapshot: storyWeavingGate,
        canonTrack: committedSettlementGame.原著轨道,
      });
      const storyAlignment = storyPlan.alignment;
      const storyProgressMemoryLine = storyPlan.memoryLine;
      let storyWeavingForSave = storyAlignment.system;
      let storyWeavingConcurrentChange = false;
      if (storyAlignment.changed) {
        assertWorkflowActive();
        const resolvedStory = await resolveStoryWeavingForBackgroundWrite({
          workflowBase: state.剧情编织,
          proposed: storyAlignment.system,
          loadLatest: () => loadSetting('storyWeavingSystem'),
        });
        storyWeavingForSave = resolvedStory.system;
        storyWeavingConcurrentChange = resolvedStory.concurrentChange;
        if (!storyWeavingConcurrentChange) {
          state.set剧情编织(storyWeavingForSave);
          await saveSetting('storyWeavingSystem', buildPersistedStoryWeavingSystem(storyWeavingForSave));
        } else {
          pushQueueTask(state, 'codex', 'success', {
            detail: '检测到剧情编织面板已有更新，本回合后台未覆盖最新导入/分解结果。',
          });
        }
        assertWorkflowActive();
        if (storyProgressMemoryLine && !storyWeavingConcurrentChange) {
          memoryAfterStoryProgress = addImmediateMemory(memoryAfterStoryProgress, storyProgressMemoryLine, state.turnCount + 1);
          mem = memoryAfterStoryProgress;
          memoryChangedAfterSettlement = true;
          const npcAfterStoryProgress = applyStoryProgressNpcMemory(
            npcAfterCompression,
            storyWeavingForSave,
            state.turnCount + 1,
          );
          if (npcAfterStoryProgress !== npcAfterCompression) {
            npcAfterCompression = npcAfterStoryProgress;
            npcChanged = true;
          }
        }
      }
      if (npcChanged || memoryChangedAfterSettlement) {
        state.updateGameState((current) => applyLegacyGameStateOverrides(current, {
          ...(npcChanged ? { NPC: npcAfterCompression } : {}),
          ...(memoryChangedAfterSettlement ? { 记忆: memoryAfterStoryProgress } : {}),
        }));
      }
      let codexAfterRuntimeUnlock = state.图鉴;
      if (storyAlignment.progressed && !storyWeavingConcurrentChange) {
        const codexUnlock = applyStoryArchiveCodexRuntimeUnlock({
          codex: state.图鉴,
          storyWeaving: storyWeavingForSave,
        });
        if (codexUnlock.changed) {
          assertWorkflowActive();
          codexAfterRuntimeUnlock = codexUnlock.codex;
          state.set图鉴(codexAfterRuntimeUnlock);
          assertWorkflowActive();
          pushQueueTask(state, 'codex', 'success', {
            detail: `剧情归档已更新图鉴门禁：${codexUnlock.unlocked.slice(0, 3).map((item) => `${item.name}→${item.status}`).join('、')}${codexUnlock.unlocked.length > 3 ? ` 等 ${codexUnlock.unlocked.length} 项` : ''}。`,
          });
        }
      }
      const steambirdSettings = state.gameSettings.蒸汽鸟报系统;
      const steambirdEnabled = Boolean(steambirdSettings?.enabled && steambirdSettings?.autoGenerate);
      const steambirdInterval = Math.max(5, Math.min(10, Math.trunc(steambirdSettings?.generateIntervalTurns ?? 5) || 5));
      const steambirdTurn = state.turnCount + 1;
      const shouldRunOpeningSteambird = isOpeningSystemTrigger && steambirdEnabled;
      const shouldRunSteambird = steambirdEnabled && ((shouldRunOpeningSteambird && !openingSteambirdPreprocessed) || (steambirdTurn > 0 && steambirdTurn % steambirdInterval === 0));
      const irminsulBase = committedSettlementGame.世界树;
      const turnRecallSource = {
        turn: committedSettlementGame.turnCount,
        userInput,
        body: displayText,
        memory: parsedForDisplay.continuation.summary,
        worldEvents: storyProgressMemoryLine
          ? [...worldFactCandidates, storyProgressMemoryLine]
          : worldFactCandidates,
        actionOptions: parsedForDisplay.choices.map((choice) => choice.label),
        gameTime: committedSettlementGame.世界.当前日期 || undefined,
        gameClock: committedSettlementGame.世界.当前时间 || undefined,
        location: committedSettlementGame.世界.当前地点 || undefined,
      };
      let steambirdAfterGeneration: SteambirdNews | null = openingSteambirdForSave;
      let irminsulAfterTurnRecall = irminsulBase;
      let courierAfterFallbackSeed = variableOverrides?.手机 ?? state.手机;
      let finalHistoryForSave = finalHistory;

      const runSteambirdBackgroundJob = async (): Promise<void> => {
        const taskResult = runSteambirdPostTurnTask({
          enabled: Boolean(steambirdSettings?.enabled && steambirdSettings?.autoGenerate),
          shouldRun: shouldRunSteambird,
          openingTurn: shouldRunOpeningSteambird,
          interval: steambirdInterval,
          current: committedSettlementGame.蒸汽鸟报,
          turn: steambirdTurn,
          userInput,
          body: displayText,
        });
        if (taskResult.status === 'skipped') {
          pushQueueTask(state, 'steambird', 'skipped', { detail: taskResult.detail });
          return;
        }
        pushQueueTask(state, 'steambird', 'pending', {
          detail: taskResult.pendingDetail,
          cancellable: true,
        });
        assertWorkflowActive();
        steambirdAfterGeneration = taskResult.news;
        if (taskResult.changed) state.set蒸汽鸟报(steambirdAfterGeneration);
        pushQueueTask(state, 'steambird', 'success', { detail: taskResult.detail });
        if (taskResult.changed) {
          notifyEvent(state.gameSettings.notificationSettings ?? DEFAULT_NOTIFICATION_SETTINGS, 'steambird', '蒸汽鸟报已更新', steambirdAfterGeneration.articles[0]?.title);
          if ((state.gameSettings.notificationSettings?.events.steambird) !== false) {
            pushToast({ kind: 'info', title: '蒸汽鸟报已更新', detail: steambirdAfterGeneration.articles[0]?.title });
          }
        }
      };

      const runIrminsulArchiveJob = async (): Promise<void> => {
        assertWorkflowActive();
        const taskResult = runPostTurnIrminsulArchiveTask({
          base: irminsulBase,
          committedGame: committedSettlementGame,
          turn: turnRecallSource.turn,
          summary: parsedForDisplay.continuation.summary || displayText.slice(0, 360),
          body: displayText,
          location: turnRecallSource.location,
          worldEvents: turnRecallSource.worldEvents,
          gameTime: turnRecallSource.gameTime,
          questFactCandidates: parsedForDisplay.factCandidates,
          recallEnabled: irminsulEnabled,
          recallEligible: irminsulRecallEnabled,
          earliestRecallTurn: memorySettings.世界树召回最早触发回合 ?? 10,
          recallHitCount: irminsulPreview?.entries.length ?? 0,
          recallUsedModel: irminsulPreview?.usedModel === true,
        });
        assertWorkflowActive();
        irminsulAfterTurnRecall = taskResult.memory;
        state.set世界树(irminsulAfterTurnRecall);
        pushQueueTask(state, 'memory', 'success', { detail: taskResult.memoryDetail });
        pushQueueTask(state, 'irminsul', taskResult.recallStatus, { detail: taskResult.recallDetail });
      };

      // 信使后台共享上下文：定时投递润色与玩家来信回信共用同一套环境 / API 解析。
      const courierWeatherName = 天气列表.find((item) => item.id === committedSettlementGame.世界.当前天气)?.name;
      const courierEnvironment = {
        location: committedSettlementGame.世界.当前地点 || undefined,
        timeText: committedSettlementGame.世界.当前时间 || undefined,
        ...(courierWeatherName ? { weather: courierWeatherName } : {}),
      };
      const courierTravelerName = committedSettlementGame.旅行者.姓名 || state.旅人.姓名 || undefined;
      const courierMainApiConfig = state.apiSettings.configs.find((item) => item.id === state.apiSettings.activeConfigId)
        ?? state.apiSettings.configs[0]
        ?? null;
      const courierLetterApiConfig = resolveCourierApiConfig(state.gameSettings.手机系统?.api, courierMainApiConfig);

      const runCourierFallbackJob = async (): Promise<void> => {
        const taskBaseCourier = courierAfterFallbackSeed;
        const taskBaseNpc = npcAfterCompression;
        const taskSessionId = state.getGameSessionId();
        const taskResult = await runCourierDeliveryTask({
          enabled: state.gameSettings.手机系统.enabled,
          autoGenerateSeeds: state.gameSettings.手机系统.autoGenerateSeeds,
          courier: courierAfterFallbackSeed,
          npcs: taskBaseNpc,
          turn: state.turnCount + 1,
          now: Date.now(),
          userInput,
          body: displayText,
          maxSeedsPerTurn: state.gameSettings.手机系统.maxSeedsPerTurn,
          contactCooldownTurns: state.gameSettings.手机系统.contactCooldownTurns,
          environment: courierEnvironment,
          travelerName: courierTravelerName,
          letterApiConfig: courierLetterApiConfig,
        });
        assertWorkflowActive();
        courierAfterFallbackSeed = taskResult.courier;
        npcAfterCompression = taskResult.npcs;
        if (taskResult.newNpcNames.length) {
          pushQueueTask(state, 'courier', 'success', {
            detail: `已登记 ${taskResult.newNpcNames.length} 位通过手机结识的新角色：${taskResult.newNpcNames.join('、')}。`,
          });
        }
        pushQueueTask(state, 'courier', taskResult.status, { detail: taskResult.detail });
        if (taskResult.status === 'success') {
          state.setNPC((current) => mergeNpcWriteBack({
            start: taskBaseNpc, next: taskResult.npcs, current,
            expectedSessionId: taskSessionId, currentSessionId: state.getGameSessionId(),
          }).records);
          state.set手机((current) => state.getGameSessionId() === taskSessionId
            ? mergeCourierSystemUpdates(current, taskBaseCourier, taskResult.courier)
            : current);
          notifyEvent(state.gameSettings.notificationSettings ?? DEFAULT_NOTIFICATION_SETTINGS, 'courier', '手机新消息', `收到 ${taskResult.delivered} 条新消息`);
          if ((state.gameSettings.notificationSettings?.events.courier) !== false) {
            pushToast({ kind: 'info', title: '手机新消息', detail: `收到 ${taskResult.delivered} 条新消息` });
          }
        }
      };

      const runCourierReplyJob = async (): Promise<void> => {
        const taskBaseCourier = courierAfterFallbackSeed;
        const taskBaseNpc = npcAfterCompression;
        const taskSessionId = state.getGameSessionId();
        const taskResult = await runCourierReplyTask({
          enabled: state.gameSettings.手机系统.enabled,
          sessionId: taskSessionId,
          courier: courierAfterFallbackSeed,
          npcs: taskBaseNpc,
          environment: courierEnvironment,
          travelerName: courierTravelerName,
          letterApiConfig: courierLetterApiConfig,
          turn: state.turnCount + 1,
          onPending: (detail) => {
            if (state.getGameSessionId() === taskSessionId) pushQueueTask(state, 'courier', 'pending', { detail });
          },
        });
        assertWorkflowActive();
        if (taskResult.status !== 'success') return;
        courierAfterFallbackSeed = taskResult.courier;
        npcAfterCompression = taskResult.npcs;
        state.set手机((current) => state.getGameSessionId() === taskSessionId
          ? mergeCourierSystemUpdates(current, taskBaseCourier, taskResult.courier)
          : current);
        state.setNPC((current) => mergeNpcWriteBack({
          start: taskBaseNpc, next: taskResult.npcs, current,
          expectedSessionId: taskSessionId, currentSessionId: state.getGameSessionId(),
        }).records);
        pushQueueTask(state, 'courier', 'success', { detail: taskResult.detail });
        notifyEvent(state.gameSettings.notificationSettings ?? DEFAULT_NOTIFICATION_SETTINGS, 'courier', '手机回复', `收到 ${taskResult.replied} 个会话回复`);
        if ((state.gameSettings.notificationSettings?.events.courier) !== false) {
          pushToast({ kind: 'info', title: '手机回复', detail: `收到 ${taskResult.replied} 个会话回复` });
        }
      };

      const runNarrativeImageJob = async (): Promise<void> => {
        const imageWorkflow = await import('./narrativeImageWorkflow');
        const 正文生图设置 = state.gameSettings.文生图系统?.正文生图;
        const targetMessageId = aiMsg.id;
        const tokenizerConfig = imageWorkflow.resolveNarrativeImageTokenizerConfig(state, config);
        const imageApiConfig = imageWorkflow.resolveNarrativeImageGenerationApi(state);
        const taskResult = await runPostTurnNarrativeImageTask({
          enabled: 正文生图设置?.enabled === true,
          mode: 正文生图设置?.mode ?? 'manual',
          hasImageConfig: Boolean(imageApiConfig),
          history: finalHistory,
          targetMessageId,
          assertActive: assertWorkflowActive,
          generate: async () => {
            if (!imageApiConfig) return null;
            const queueResult = await globalImageTaskQueue.createRunner(() => imageWorkflow.generateNarrativeImagesForMessage({
              state,
              messageId: targetMessageId,
              body: displayText,
              tokenizerConfig,
              imageApiConfig,
              turn: state.turnCount,
              signal: abortController.signal,
            }))(targetMessageId);
            return queueResult.status === 'success'
              ? (queueResult.value as import('@/models/chat').叙事插图[] | null)
              : null;
          },
        });
        if (taskResult.status === 'failed') {
          pushQueueTask(state, 'narrative_image_generate', 'failed', {
            detail: taskResult.detail,
            turn: state.turnCount,
            targetMessageId,
          });
          return;
        }
        if (taskResult.status === 'success') {
          finalHistoryForSave = taskResult.history;
          notifyEvent(state.gameSettings.notificationSettings ?? DEFAULT_NOTIFICATION_SETTINGS, 'image', '故事快照已生成', taskResult.detail);
          if ((state.gameSettings.notificationSettings?.events.image) !== false) {
            pushToast({ kind: 'success', title: '故事快照已生成', detail: taskResult.detail });
          }
        }
      };

      await runPostTurnBackgroundTasks({
        mode: state.gameSettings.backgroundTaskMode ?? 'sequential',
        steambird: runSteambirdBackgroundJob,
        irminsul: runIrminsulArchiveJob,
        courierDelivery: runCourierFallbackJob,
        courierReply: runCourierReplyJob,
        narrativeImage: runNarrativeImageJob,
      });

  return {
    variableOverrides,
    committedSettlementGame,
    npcAfterCompression,
    memoryAfterStoryProgress,
    storyWeavingForSave,
    codexAfterRuntimeUnlock,
    steambirdAfterGeneration,
    irminsulAfterTurnRecall,
    courierAfterFallbackSeed,
    finalHistoryForSave,
    finalHistory,
    mem,
    recoveryJournal,
  };
}
