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
  mapTeyvatNpcsToLegacy,
  readLiveGameState,
  toLegacyMemory,
  toLegacyStoryWeaving,
  withLegacyMemory,
  type UseGameStateReturn} from '@/hooks/useGameState';
import { flushSync } from 'react-dom';
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
import { runCourierDeliveryTask, runCourierReplyTask } from './courierBackgroundJobs';
import { applyCourierDeliveryTaskResult, applyCourierReplyTaskResult } from './courierReplyCommitWorkflow';
import { planProactiveContacts } from '@/services/proactiveContacts';
import { mergeSettlementSliceWriteBack, rebaseStoryProgressMemory } from '@/utils/npcWriteBack';
import { getCommittedCourierMessages } from '@/utils/courierReplyCommit';
import { applyStoryArchiveCodexRuntimeUnlock } from '@/services/codexRuntimeUnlock';
import { buildPersistedStoryWeavingSystem } from '@/data/storyWeavingPreset';
import { runPostTurnBackgroundTasks, runSteambirdPostTurnTask } from './postTurnBackgroundTasks';
import { collectSteambirdPublicFacts, selectUnreportedPublicFacts } from '@/services/steambirdPublicFacts';
import { normalizeConfirmedSteambirdFacts } from '@/models/teyvat/steambird';
import { resolveSteambirdApiConfig } from '@/services/ai/steambirdModel';
import { steambirdTaskId } from './postTurnSteambirdTask';
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
import { markSettlementTailTask, type SettlementTailTask } from './postSettlementTaskState';

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
    worldAfter,
    travelerAfter,
    worldFactCandidates,
  } = deps;
  let finalHistory = deps.finalHistory;
  let mem = deps.mem;
  let irminsulWithCompression = deps.irminsulWithCompression;
  let recoveryJournal = deps.recoveryJournal;
  const checkpointTailTask = async (task: SettlementTailTask) => {
    assertWorkflowActive();
    flushSync(() => state.updateGameState(current => current.叙事.lastCommittedMoment?.settlementId === recoveryJournal.workflowId
      ? markSettlementTailTask(current, recoveryJournal.workflowId, task) : current));
    recoveryJournal = updateWorkflowRecoveryJournal(recoveryJournal, { committedState: readLiveGameState(state) });
    deps.onJournalUpdated(recoveryJournal);
    await persistWorkflowRecoveryJournal(recoveryJournal);
    assertWorkflowActive();
  };

    // 8.5 变量模型校准：主回复完成 → 调用独立的变量模型分析正文，把结构化命令落地。
    //     失败时保留冻结正文与恢复日志，不允许继续后台任务或自动存档。
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
      // Recovery must retain the gate even when the variable request is interrupted.
      storyAlignment: { openingSystemTurn: isOpeningSystemTrigger, gateSnapshot: storyWeavingGate },
      pendingSettlement: {
        settlementId: recoveryJournal.workflowId,
        source: frozenSettlementWithBackground,
        ...(settlementVariableDraft ? { variableDraft: settlementVariableDraft } : {}),
      },
    });
    deps.onJournalUpdated(recoveryJournal);
    await persistWorkflowRecoveryJournal(recoveryJournal);
    assertWorkflowActive();
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
      assertWorkflowActive();
      if (abortController.signal.aborted || !isCurrentWorkflow()) {
        throw new DOMException('本回合已停止。', 'AbortError');
      }
      if (!variableOverrides?.committedGame) {
        const failure = variableOverrides?.failure;
        const reasons = variableOverrides?.batch?.results
          .filter(item => !item.ok && item.reason).map(item => item.reason).slice(0, 4).join('；');
        throw new Error(`${failure?.code ?? 'TEYVAT_SETTLEMENT_REJECTED'}：${failure?.detail || reasons || '变量结算未返回已提交结果，正文已保留，请重试变量结算。'}`);
      }
      // The settlement callback may rebase concurrent player edits; use the actual live committed root.
      let committedSettlementGame = readLiveGameState(state);
      const {
        applyStoryProgressNpcMemory,
        buildSettlementCommitFeedback,
        commitTurnContext,
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
        storyAlignment: { openingSystemTurn: isOpeningSystemTrigger, gateSnapshot: storyWeavingGate },
      });
      deps.onJournalUpdated(recoveryJournal);
      assertWorkflowActive();
      await persistWorkflowRecoveryJournal(recoveryJournal);
      publishSettlementCommitFeedback(commitFeedback, {
        queue: (task, status, detail) => pushQueueTask(state, task, status, { detail }),
        toast: (kind, title, detail) => pushToast({ kind, title, detail }),
        notifyQuest: (detail) => notifyCommittedQuestUpdate(state.gameSettings.notificationSettings, detail),
      });

      const settledMoment = committedSettlementGame.叙事.lastCommittedMoment;
      if (!settledMoment || settledMoment.settlementId !== recoveryJournal.workflowId) {
        throw new Error('提交后的世界时刻缺失，已停止记忆写入。');
      }
      const { runMemoryUpdateStage } = await import('./memoryUpdateStage');
      const memoryBase = toLegacyMemory(committedSettlementGame);
      const irminsulBaseBeforeCompression = committedSettlementGame.世界树;
      const memoryUpdate = await runMemoryUpdateStage({
        state,
        userInput,
        config,
        displayText,
        parsedForDisplay,
        abortController,
        assertWorkflowActive,
        memory: memoryBase,
        irminsul: irminsulBaseBeforeCompression,
        moment: settledMoment,
      });
      const { rebasePostNarrativeMemorySettlement } = await import('./postNarrativeMemoryStage');
      const memoryWrite: {
        commit: ReturnType<typeof rebasePostNarrativeMemorySettlement> | null;
        root: typeof committedSettlementGame | null;
      } = { commit: null, root: null };
      flushSync(() => state.updateGameState((current) => {
        if (current.叙事.lastCommittedMoment?.settlementId !== settledMoment.settlementId) return current;
        const memoryCommit = rebasePostNarrativeMemorySettlement({
          baseMemory: memoryBase,
          liveMemory: toLegacyMemory(current),
          compressedMemory: memoryUpdate.mem,
          baseIrminsul: irminsulBaseBeforeCompression,
          liveIrminsul: current.世界树,
          compressedIrminsul: memoryUpdate.irminsulWithCompression,
          userInput,
          narrativeSummary: parsedForDisplay.continuation.summary,
          body: displayText,
          moment: settledMoment,
          patch: memoryUpdate.patch,
        });
        const next = withLegacyMemory(current, memoryCommit.memory);
        memoryWrite.commit = memoryCommit;
        memoryWrite.root = { ...next, 世界树: memoryCommit.irminsul,
          对话: { ...next.对话, entries: next.对话.entries.map((entry) => entry.id === aiMsg.id && entry.role === 'assistant'
            ? { ...entry, worldMoment: { ...settledMoment } } : entry) },
        };
        return memoryWrite.root;
      }));
      if (!memoryWrite.commit || !memoryWrite.root) throw new Error('记忆结算被新的存档取代，已停止旧回合写入。');
      mem = memoryWrite.commit.memory;
      irminsulWithCompression = memoryWrite.commit.irminsul;
      committedSettlementGame = memoryWrite.root;
      finalHistory = finalHistory.map((message) => message.id === aiMsg.id && message.role === 'assistant'
        ? { ...message, worldMoment: { ...settledMoment } } : message);
      if (memoryWrite.commit.compressionDeferred) {
        pushQueueTask(state, 'memory', 'success', { detail: '压缩期间检测到记忆或世界树来源发生修改，已保留编辑与本回合记忆；压缩推迟到下回合。' });
      }
      await checkpointTailTask('memory');

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
      // B07：整理（记忆压缩）的输入快照就是提交点合并的基准；
      // 之后还有剧情设置落库与恢复日志保存两处 await，那时玩家可能已经改过档案。
      const npcAnchorForSettlement = npcSource;
      let concurrentNpcWriteBacks: string[] = [];
      let npcAfterCompression = preparedNpcs.records;
      let npcChanged = preparedNpcs.changed;
      if (preparedNpcs.debug) {
        finalHistory = attachNpcLedgerUpdateDebug(finalHistory, aiMsg.id, preparedNpcs.debug);
        state.setChatHistory(finalHistory);
      }

      // The memory stage starts from the committed root (including variable overrides)
      // and may have appended/compressed this turn; never replace it with the earlier batch projection.
      let memoryAfterStoryProgress = mem;
      // B07：剧情进度记忆是**追加式**写入，提交点只补这一条，不再整片重放旧数组。
      // 基准是「加入剧情进度记忆之前」的记忆切片（`mem`），产出是加了那一条之后的切片。
      let memoryBeforeStoryProgress = mem;
      let memoryChangedAfterSettlement = false;
      // 剧情进度写进 NPC 同行记忆之前的那一份（同样只用于求 delta）。
      let npcBeforeStoryProgress = npcAfterCompression;
      const storyWeavingBase = toLegacyStoryWeaving(committedSettlementGame.叙事.storyWeaving);
      const storyPlan = planPostSettlementStoryAlignment({
        openingSystemTurn: isOpeningSystemTrigger,
        storyWeaving: storyWeavingBase,
        turn: state.turnCount + 1,
        userInput,
        body: displayText,
        currentLocation: variableOverrides?.世界?.当前地点 ?? worldAfter.当前地点 ?? effectiveWorld.当前地点,
        gateSnapshot: storyWeavingGate,
        canonTrack: committedSettlementGame.原著轨道,
      });
      const storyAlignment = storyPlan.alignment;
      const storyProgressMemoryLine = storyPlan.memoryLine;
      let storyWeavingForSave = toLegacyStoryWeaving(readLiveGameState(state).叙事.storyWeaving);
      let storyWeavingConcurrentChange = false;
      if (storyAlignment.changed) {
        assertWorkflowActive();
        const liveStory = await resolveStoryWeavingForBackgroundWrite({
          workflowBase: storyWeavingBase,
          proposed: storyAlignment.system,
          loadLatest: async () => toLegacyStoryWeaving(readLiveGameState(state).叙事.storyWeaving),
        });
        const resolvedStory = liveStory.concurrentChange ? liveStory : await resolveStoryWeavingForBackgroundWrite({
          workflowBase: storyWeavingBase,
          proposed: storyAlignment.system,
          loadLatest: () => loadSetting('storyWeavingSystem'),
        });
        storyWeavingForSave = resolvedStory.system;
        storyWeavingConcurrentChange = resolvedStory.concurrentChange;
        if (!storyWeavingConcurrentChange) {
          await saveSetting('storyWeavingSystem', buildPersistedStoryWeavingSystem(storyWeavingForSave));
        } else {
          pushQueueTask(state, 'codex', 'success', {
            detail: '检测到剧情编织面板已有更新，本回合后台未覆盖最新导入/分解结果。',
          });
        }
        assertWorkflowActive();
        if (storyProgressMemoryLine && !storyWeavingConcurrentChange) {
          memoryBeforeStoryProgress = memoryAfterStoryProgress;
          memoryAfterStoryProgress = addImmediateMemory(
            memoryAfterStoryProgress, storyProgressMemoryLine, state.turnCount + 1,
            settledMoment, `memory_story_${settledMoment.settlementId}`,
          );
          mem = memoryAfterStoryProgress;
          memoryChangedAfterSettlement = true;
          // B07：这一段同样是「追加式」写入 —— 提交点只补这份 delta，
          // 不再用旧投影整片替换等待期间被玩家改过的档案。
          npcBeforeStoryProgress = npcAfterCompression;
          const npcAfterStoryProgress = applyStoryProgressNpcMemory(
            npcAfterCompression,
            storyWeavingForSave,
            state.turnCount + 1,
            settledMoment,
          );
          if (npcAfterStoryProgress !== npcAfterCompression) {
            npcAfterCompression = npcAfterStoryProgress;
            npcChanged = true;
          }
        }
      }
      if (memoryChangedAfterSettlement) {
        committedSettlementGame = applyLegacyGameStateOverrides(committedSettlementGame, { 记忆: memoryAfterStoryProgress });
      }
      const committedTurn = commitTurnContext({
        game: committedSettlementGame,
        storyWeaving: storyWeavingForSave,
        settlementId: recoveryJournal.workflowId,
        warnings: storyWeavingConcurrentChange
          ? ['剧情编织面板发生并发修改，本回合自动推进未覆盖较新的设置。']
          : storyPlan.warning ? [storyPlan.warning] : [],
      });
      committedSettlementGame = committedTurn.game;
      const committedTurnContext = committedTurn.context;
      committedSettlementGame = { ...committedSettlementGame, 蒸汽鸟报: collectSteambirdPublicFacts(committedSettlementGame.蒸汽鸟报, parsedForDisplay, committedTurnContext.moment) };
      state.updateGameState((current) => {
        if (current.叙事.lastCommittedMoment?.settlementId !== committedTurnContext.settlementId) return current;
        return {
          ...current,
          蒸汽鸟报: { ...current.蒸汽鸟报, confirmedFacts: normalizeConfirmedSteambirdFacts([...(current.蒸汽鸟报.confirmedFacts ?? []), ...(committedSettlementGame.蒸汽鸟报.confirmedFacts ?? [])]) },
          叙事: {
            ...current.叙事,
            lastCommittedMoment: committedTurnContext.moment,
            ...(storyAlignment.changed && !storyWeavingConcurrentChange
              ? { storyWeaving: committedSettlementGame.叙事.storyWeaving } : {}),
          },
        };
      });
      recoveryJournal = updateWorkflowRecoveryJournal(recoveryJournal, { committedState: committedSettlementGame });
      deps.onJournalUpdated(recoveryJournal);
      await persistWorkflowRecoveryJournal(recoveryJournal);
      // B07：提交点读取 **live**，按各自明确的追加/压缩 delta 合并 ——
      // 不再用记忆压缩 await 之前算出的旧数组无条件替换当前切片。
      // 这段等待（压缩 + 剧情设置落库 + 恢复日志保存）里玩家改的同伴资料与新增的记忆必须保留。
      assertWorkflowActive();
      if (npcChanged) {
        state.setNPC((current) => {
          const merged = mergeSettlementSliceWriteBack({
            base: npcAnchorForSettlement, next: npcAfterCompression, current,
          });
          concurrentNpcWriteBacks = merged.concurrentRecordIds;
          return merged.records;
        });
        if (concurrentNpcWriteBacks.length) {
          pushQueueTask(state, 'variable', 'success', {
            detail: `等待期间角色档案也被改动：${concurrentNpcWriteBacks.length} 位同伴的档案以最新值为底并已补回本回合的记忆整理。`,
          });
        }
      }
      if (memoryChangedAfterSettlement) {
        state.updateGameState((current) => withLegacyMemory(current, rebaseStoryProgressMemory({
          base: memoryBeforeStoryProgress,
          next: memoryAfterStoryProgress,
          current: toLegacyMemory(current),
        }).memory));
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
      await checkpointTailTask('npcStory');
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
        const sessionId = state.getGameSessionId();
        const current = readLiveGameState(state).蒸汽鸟报;
        const task = { sessionId, settlementId: committedTurnContext.settlementId, turn: steambirdTurn, worldMoment: committedTurnContext.moment,
          facts: selectUnreportedPublicFacts(current, { firstTurn: Math.max(0, steambirdTurn - steambirdInterval + 1), lastTurn: steambirdTurn }),
          config: resolveSteambirdApiConfig(steambirdSettings?.api, config), promptModules: state.gameSettings.promptModules,
          maxEntries: steambirdSettings?.maxNewEntriesPerTurn ?? 3, signal: abortController.signal };
        const batchId = steambirdTaskId(task);
        if (shouldRunSteambird && task.facts.length) pushQueueTask(state, 'steambird', 'pending', { detail: '正在调用独立 API，仅投递确认公开事实。', turn: steambirdTurn, targetBatchId: batchId, cancellable: true });
        const taskResult = await runSteambirdPostTurnTask({
          enabled: Boolean(steambirdSettings?.enabled && steambirdSettings?.autoGenerate),
          shouldRun: shouldRunSteambird,
          openingTurn: shouldRunOpeningSteambird,
          interval: steambirdInterval,
          current,
          turn: steambirdTurn,
          userInput,
          body: displayText,
          worldMoment: committedTurnContext.moment,
          task, owner: { read: () => readLiveGameState(state).蒸汽鸟报, isCurrent: () => state.getGameSessionId() === sessionId,
            update: updater => flushSync(() => state.set蒸汽鸟报(updater)) },
        });
        assertWorkflowActive();
        if (taskResult.status === 'skipped') {
          pushQueueTask(state, 'steambird', 'skipped', { detail: taskResult.detail });
          return;
        }
        steambirdAfterGeneration = taskResult.news;
        pushQueueTask(state, 'steambird', taskResult.status, { detail: taskResult.detail, turn: steambirdTurn, targetBatchId: batchId });
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
          moment: committedTurnContext.moment,
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
        // 「角色主动行为」（2026-09-29 第 4 项）：由纯函数按仓库规格算出本回合该不该有人主动联系
        // （只限已有手机联系人、好感度 ≥ 100、每 15 回合最多一位、全局冷却），
        // 再交给同一条投递链路（来信 → 未读 → 记忆回写），不新增 schema 与 UI。
        const proactivePlan = planProactiveContacts({
          courier: courierAfterFallbackSeed,
          npcs: taskBaseNpc,
          turn: state.turnCount + 1,
          travelDay: Number(committedSettlementGame.世界.旅程天数 ?? 0),
          ...(committedSettlementGame.世界.当前地点 ? { location: committedSettlementGame.世界.当前地点 } : {}),
          ...(committedSettlementGame.世界.当前时间 ? { clock: committedSettlementGame.世界.当前时间 } : {}),
        });
        if (state.gameSettings.手机系统.enabled && !proactivePlan.seeds.length && proactivePlan.skippedReason) {
          // 不静默：主动联系没发生也要留下可查原因（诊断面板/失败结算中心消费）。
          pushQueueTask(state, 'courier', 'skipped', { detail: `本回合无角色主动联系：${proactivePlan.skippedReason}。` });
        }
        const taskResult = await runCourierDeliveryTask({
          enabled: state.gameSettings.手机系统.enabled,
          autoGenerateSeeds: state.gameSettings.手机系统.autoGenerateSeeds,
          courier: courierAfterFallbackSeed,
          npcs: taskBaseNpc,
          turn: state.turnCount + 1,
          now: Date.now(),
          worldMoment: committedTurnContext.moment,
          userInput,
          body: displayText,
          maxSeedsPerTurn: state.gameSettings.手机系统.maxSeedsPerTurn,
          contactCooldownTurns: state.gameSettings.手机系统.contactCooldownTurns,
          allowStoryCreatedGroups: state.gameSettings.手机系统.allowStoryCreatedGroups === true,
          environment: courierEnvironment,
          travelerName: courierTravelerName,
          letterApiConfig: courierLetterApiConfig,
          proactiveSeeds: proactivePlan.seeds,
        });
        assertWorkflowActive();
        if (taskResult.courier !== taskBaseCourier || taskResult.npcs !== taskBaseNpc) {
          flushSync(() => state.updateGameState(current => applyCourierDeliveryTaskResult(current, {
            baseCourier: taskBaseCourier, resultCourier: taskResult.courier, baseNpcs: taskBaseNpc,
            expectedSessionId: taskSessionId, currentSessionId: state.getGameSessionId(),
          })));
        }
        const committedDelivery = readLiveGameState(state);
        courierAfterFallbackSeed = committedDelivery.手机;
        npcAfterCompression = mapTeyvatNpcsToLegacy(committedDelivery);
        const received = getCommittedCourierMessages(taskBaseCourier, taskResult.courier, committedDelivery.手机);
        const delivered = new Set(received.flatMap(message => message.sourceSeedId ?? [])).size;
        pushQueueTask(state, 'courier', delivered > 0 ? 'success' : 'skipped', {
          detail: delivered > 0 ? `已送达 ${delivered} 条定时手机消息。` : taskResult.status === 'success' ? '接收对象已变化，迟到来信已跳过。' : taskResult.detail,
        });
        if (delivered > 0) {
          notifyEvent(state.gameSettings.notificationSettings ?? DEFAULT_NOTIFICATION_SETTINGS, 'courier', '手机新消息', `收到 ${delivered} 条新消息`);
          if ((state.gameSettings.notificationSettings?.events.courier) !== false) {
            pushToast({ kind: 'info', title: '手机新消息', detail: `收到 ${delivered} 条新消息` });
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
          worldMoment: committedTurnContext.moment,
          onPending: (detail) => {
            if (state.getGameSessionId() === taskSessionId) pushQueueTask(state, 'courier', 'pending', { detail });
          },
        });
        assertWorkflowActive();
        if (taskResult.status !== 'success') return;
        flushSync(() => state.updateGameState(current => applyCourierReplyTaskResult(current, {
          baseCourier: taskBaseCourier, resultCourier: taskResult.courier, baseNpcs: taskBaseNpc,
          expectedSessionId: taskSessionId, currentSessionId: state.getGameSessionId(),
        })));
        const committedReply = readLiveGameState(state);
        courierAfterFallbackSeed = committedReply.手机;
        npcAfterCompression = mapTeyvatNpcsToLegacy(committedReply);
        if (!getCommittedCourierMessages(taskBaseCourier, taskResult.courier, committedReply.手机).length) {
          pushQueueTask(state, 'courier', 'skipped', { detail: '接收成员已变化，迟到回信已跳过。' });
          return;
        }
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
      await checkpointTailTask('phone');

  return {
    variableOverrides,
    committedSettlementGame,
    committedTurnContext,
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
