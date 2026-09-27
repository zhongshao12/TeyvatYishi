import { Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useGame } from '@/hooks/useGame';
import { mapTeyvatNpcsToLegacy, readLiveGameState } from '@/hooks/useGameState';
import { prepareNewGameState } from '@/hooks/useGame/newGameOpening';
import { useKeyboardShortcuts } from '@/hooks/useGame/useKeyboardShortcuts';
import { KEYBOARD_SHORTCUT_DEFAULTS } from '@/data/keyboardShortcutDefaults';
import { RecoveryBanner } from '@/components/layout/RecoveryBanner';
import {
  canAutoResume,
  checkInterruptedWorkflow,
  dismissInterruptedWorkflow,
  resolveRecoveryTarget,
} from '@/hooks/useGame/recoveryResume';
import { resumeCommittedSettlementWorkflow, resumePendingSettlementWorkflow } from '@/hooks/useGame/sendWorkflow';
import type { WorkflowResumeResult } from '@/hooks/useGame/recoveryResume';
import type { WorkflowRecoveryJournal } from '@/utils/workflowRecoveryModel';
import { LandingPage } from '@/components/layout/LandingPage';
import { DesktopHomeScreen } from '@/components/layout/DesktopHomeScreen';
import { GameView } from '@/components/layout/GameView';
import { TopBar } from '@/components/layout/TopBar';
import { LeftPanel } from '@/components/layout/LeftPanel';
import { RightMenu } from '@/components/layout/RightMenu';
import { SystemDrawer } from '@/components/layout/SystemDrawer';
import { MobileQuickMenu } from '@/components/layout/MobileQuickMenu';
import { ChatList } from '@/components/features/Chat/ChatList';
import { InputArea } from '@/components/features/Chat/InputArea';
import { VariableDrawer } from '@/components/features/Variable/VariableDrawer';
import type { SettingsTab } from '@/components/features/Settings/SettingsModal';
import { PathAwakeningInvitation } from '@/components/features/Path/PathAwakeningInvitation';
import { closeTopModal } from '@/components/ui/Modal';
import { MAP_REGION_MAIN_LOCATIONS, markTeleport, unlockStatue } from '@/models/teyvat';
import { ToastHost } from '@/components/ui/ToastHost';
import { CLIP_SMALL } from '@/styles/clipPaths';
import { OFFLINE_HINT, useNetworkStatus } from '@/hooks/useNetworkStatus';
import { LazySurfaceFallback, MemoryRebuildModal } from '@/components/layout/AppPanels';
import { TravelerProfileModal } from '@/components/features/Character/TravelerProfileModal';
import { GAME_MENU_ITEMS, type GameSystemId } from '@/data/gameMenu';
import { deleteSave as deleteStoredSave, saveGame, saveSetting } from '@/services/dbService';
import { runStartupStorageMaintenance } from '@/services/storage/startupStorageMaintenance';
import { resolveActiveApiConfig } from '@/services/ai/activeApiConfig';
import { buildSavePayload, clearActiveSaveTreeMetaIfMatches, commitActiveSaveTreeMeta, getActiveSaveTreeNodeId, handleLoadById } from '@/hooks/useGame/saveLoadWorkflow';
import { runPostTurnAutosaveTask } from '@/hooks/useGame/postTurnAutosaveTask';
import { useDebouncedCourierAutosave } from '@/hooks/useGame/useDebouncedCourierAutosave';
import { pushToast } from '@/utils/toastStore';
import { runTrackedSave, saveStatusStore } from '@/utils/saveStatus';
import { isDesktopRuntime } from '@/utils/platform/desktopRuntime';
import type { 角色数据结构 } from '@/models/character';
import { 切换剧情书签 } from '@/utils/storyBookmarks';
import { mergeNpcWriteBack } from '@/utils/npcWriteBack';
import { 累计Token用量 } from '@/utils/tokenUsageStats';
import { TokenMeter } from '@/components/features/Chat/TokenMeter';
import { CommandPalette } from '@/components/features/Chat/CommandPalette';
import { clearCommands, registerCommand, type CommandItem } from '@/utils/commandRegistry';
import type { 世界状态 } from '@/models/world';
import type { NPC记录 } from '@/models/npc';
import type { QuestJournal, TeyvatInventory } from '@/models/teyvat';
import type { 记忆失败草稿 } from '@/models/memory';
import type { 世界书 } from '@/models/worldbook';
import { lazyWithRetry, preloadAll } from '@/utils/lazyWithRetry';
import { buildManuallyEditedNarrativeTurn } from '@/services/ai/narrativeTurnParser';
import {
  BookOpenOverlay,
  HomeJourneyOverlay,
  JourneyLaunchOverlay,
  MysteryChatModal,
  SaveLoadOverlay,
} from '@/components/layout/AppTransitionOverlays';

const NewGameWizard = lazyWithRetry(() => import('@/components/features/NewGame/NewGameWizard').then((module) => ({ default: module.NewGameWizard })), 'new-game-wizard');
const SettingsModal = lazyWithRetry(() => import('@/components/features/Settings/SettingsModal').then((module) => ({ default: module.SettingsModal })), 'settings-modal');
const SaveLoadModal = lazyWithRetry(() => import('@/components/features/SaveLoad/SaveLoadModal').then((module) => ({ default: module.SaveLoadModal })), 'save-load-modal');
const CourierModal = lazyWithRetry(() => import('@/components/features/Courier/CourierModal').then((module) => ({ default: module.CourierModal })), 'courier-modal');
const WorldbookManagerModal = lazyWithRetry(() => import('@/components/features/Worldbook/WorldbookManagerModal').then((module) => ({ default: module.WorldbookManagerModal })), 'worldbook-manager-modal');
const CodexManagerModal = lazyWithRetry(() => import('@/components/features/Codex/CodexManagerModal').then((module) => ({ default: module.CodexManagerModal })), 'codex-manager-modal');
const GitHubCloudSaveModal = lazyWithRetry(() => import('@/components/features/CloudSave/GitHubCloudSaveModal').then((module) => ({ default: module.GitHubCloudSaveModal })), 'github-cloud-save-modal');
const ReleaseAnnouncementsModal = lazyWithRetry(() => import('@/components/features/Release/ReleaseAnnouncementsModal').then((module) => ({ default: module.ReleaseAnnouncementsModal })), 'release-announcements-modal');
const PlotPanel = lazyWithRetry(() => import('@/components/features/GameSystems/PlotPanel').then((module) => ({ default: module.PlotPanel })), 'plot-panel');
const IrminsulPanel = lazyWithRetry(() => import('@/components/features/GameSystems/IrminsulPanel').then((module) => ({ default: module.IrminsulPanel })), 'irminsul-panel');
const MapPanel = lazyWithRetry(() => import('@/components/features/GameSystems/MapPanel').then((module) => ({ default: module.MapPanel })), 'map-panel');
const MemoryPanel = lazyWithRetry(() => import('@/components/features/GameSystems/MemoryPanel').then((module) => ({ default: module.MemoryPanel })), 'memory-panel');
const AlbumPanel = lazyWithRetry(() => import('@/components/features/GameSystems/AlbumPanel').then((module) => ({ default: module.AlbumPanel })), 'album-panel');
const SkillPanel = lazyWithRetry(() => import('@/components/features/GameSystems/SkillPanel').then((module) => ({ default: module.SkillPanel })), 'skill-panel');
const InventoryPanel = lazyWithRetry(() => import('@/components/features/GameSystems/InventoryPanel').then((module) => ({ default: module.InventoryPanel })), 'inventory-panel');
const SteambirdPanel = lazyWithRetry(() => import('@/components/features/GameSystems/SteambirdPanel').then((module) => ({ default: module.SteambirdPanel })), 'steambird-panel');
const TimelinePanel = lazyWithRetry(() => import('@/components/features/GameSystems/TimelinePanel').then((module) => ({ default: module.TimelinePanel })), 'timeline-panel');
const CompanionPanel = lazyWithRetry(() => import('@/components/features/GameSystems/CompanionPanel').then((module) => ({ default: module.CompanionPanel })), 'companion-panel');
const PathPanel = lazyWithRetry(() => import('@/components/features/GameSystems/PathPanel').then((module) => ({ default: module.PathPanel })), 'path-panel');
const QuestPanel = lazyWithRetry(() => import('@/components/features/GameSystems/QuestPanel').then((module) => ({ default: module.QuestPanel })), 'quest-panel');


import type { 相册系统 } from '@/models/imageGeneration';
import type { 剧情节点 } from '@/models/plot';
import type { 记忆系统 } from '@/models/memory';
import type { ElementId } from '@/models/teyvat/elements';
import { 创建默认记忆系统设置 } from '@/models/settings';
import { buildPersistedStoryWeavingSystem, loadAllBundledStoryWeavingPresets } from '@/data/storyWeavingPreset';
import { getCurrentStoryChapterLabel } from '@/services/storyProgressService';
import { generateTravelerTemplate, type TravelerTemplateContext, type TravelerTemplateDraft } from '@/services/ai/travelerTemplate';
import { revealCourierMessages, runCourierReplyPass, type CourierReplyPassResult } from '@/hooks/useGame/courierBackgroundJobs';
import { createCourierReplyQueue, type CourierReplyBatchIntent, type CourierReplyDispatchResult } from '@/hooks/useGame/courierReplyQueue';
import { resolveCourierApiConfig } from '@/services/ai/courierLetterModel';
import { beginCourierReply, endCourierReply, selectGroupReplyMembers } from '@/services/ai/courierService';
import { buildCourierPlayerBatch } from '@/utils/courierReplyBatch';
import { applyCourierReplyMessageIfLive, isCourierReplyTargetLive } from '@/utils/courierReplyCommit';
import { 天气列表 } from '@/data/weatherRules';
import { normalizeCourierSystem, type CourierSystem } from '@/models/teyvat/courier';
import { runMomentComments } from '@/hooks/useGame/courierMomentWorkflow';
import { generateMomentComment } from '@/services/ai/courierMomentComments';

const JOURNEY_LAUNCH_ANIMATION_MS = 1680;
const HOME_JOURNEY_ANIMATION_MS = 1180;
const HOME_JOURNEY_VIEW_SWITCH_MS = 520;
const SAVE_LOAD_ANIMATION_MS = 1040;
const SAVE_LOAD_VIEW_SWITCH_MS = 430;
const BOOK_OPEN_ANIMATION_MS = 1080;
const BOOK_OPEN_VIEW_SWITCH_MS = 460;
const JOURNEY_LAUNCH_REDUCED_MOTION_MS = 320;
const HOME_JOURNEY_REDUCED_MOTION_MS = 260;
const HOME_JOURNEY_REDUCED_VIEW_SWITCH_MS = 90;
const SAVE_LOAD_REDUCED_MOTION_MS = 260;
const SAVE_LOAD_REDUCED_VIEW_SWITCH_MS = 90;
const BOOK_OPEN_REDUCED_MOTION_MS = 260;
const BOOK_OPEN_REDUCED_VIEW_SWITCH_MS = 90;
const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const getJourneyLaunchDelay = () => prefersReducedMotion() ? JOURNEY_LAUNCH_REDUCED_MOTION_MS : JOURNEY_LAUNCH_ANIMATION_MS;
const getHomeJourneyDelay = () => prefersReducedMotion() ? HOME_JOURNEY_REDUCED_MOTION_MS : HOME_JOURNEY_ANIMATION_MS;
const getHomeJourneyViewSwitchDelay = () => prefersReducedMotion() ? HOME_JOURNEY_REDUCED_VIEW_SWITCH_MS : HOME_JOURNEY_VIEW_SWITCH_MS;
const getSaveLoadDelay = () => prefersReducedMotion() ? SAVE_LOAD_REDUCED_MOTION_MS : SAVE_LOAD_ANIMATION_MS;
const getSaveLoadViewSwitchDelay = () => prefersReducedMotion() ? SAVE_LOAD_REDUCED_VIEW_SWITCH_MS : SAVE_LOAD_VIEW_SWITCH_MS;
const getBookOpenDelay = () => prefersReducedMotion() ? BOOK_OPEN_REDUCED_MOTION_MS : BOOK_OPEN_ANIMATION_MS;
const getBookOpenViewSwitchDelay = () => prefersReducedMotion() ? BOOK_OPEN_REDUCED_VIEW_SWITCH_MS : BOOK_OPEN_VIEW_SWITCH_MS;

export default function App() {
  const { state, actions } = useGame();
  const setWorldbooks = state.setWorldbooks;
  const persistWorldbooks = useCallback(async (books: 世界书[]) => {
    await saveSetting('worldbooks', books);
    setWorldbooks(books);
  }, [setWorldbooks]);
  const persistWorldbooksWithFeedback = useCallback((books: 世界书[]) => {
    void persistWorldbooks(books).catch((error: unknown) => {
      pushToast({ kind: 'error', title: '世界书保存失败', detail: error instanceof Error ? error.message : String(error) });
    });
  }, [persistWorldbooks]);
  const canGenerateMomentComments = useMemo(() => {
    const main = state.apiSettings.configs.find((config) => config.id === state.apiSettings.activeConfigId)
      ?? state.apiSettings.configs[0] ?? null;
    const config = resolveCourierApiConfig(state.gameSettings.手机系统?.api, main);
    if (!config?.apiKey.trim() || !config.model.trim()) return false;
    try {
      const url = new URL(config.baseUrl);
      return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname);
    } catch {
      return false;
    }
  }, [state.apiSettings, state.gameSettings.手机系统?.api]);
  const saveStatus = useSyncExternalStore(saveStatusStore.subscribe, saveStatusStore.getSnapshot);
  const saveSessionId = state.getGameSessionId();
  useEffect(() => {
    saveStatusStore.observeGame(saveSessionId, state.game);
  }, [saveSessionId, state.game]);
  const retryFailedSave = useCallback(() => {
    void actions.handleSave().catch(() => {
      pushToast({ kind: 'error', title: '存档仍未写入', detail: '请检查可用存储空间后重试。' });
    });
  }, [actions.handleSave]);
  const latestStateRef = useRef(state);
  latestStateRef.current = state;
  const saveCourierOutsideTurn = useCallback(async (courier: CourierSystem, sessionId: number): Promise<boolean> => {
    const live = latestStateRef.current;
    if (live.getGameSessionId() !== sessionId || live.view !== 'game' || live.loading || live.pendingVariable) return false;
    const root = readLiveGameState(live);
    if (root.手机 !== courier) return false;
    const parentNodeId = getActiveSaveTreeNodeId();
    const payload = buildSavePayload(live, 'auto', undefined, root);
    const result = await runTrackedSave(saveStatusStore, sessionId, root, 'auto', () => runPostTurnAutosaveTask({
      enabled: true,
      build: () => payload,
      assertActive: () => undefined,
      isCurrent: () => {
        const current = latestStateRef.current;
        return current.getGameSessionId() === sessionId
          && current.view === 'game'
          && !current.loading
          && !current.pendingVariable
          && current.game === root
          && getActiveSaveTreeNodeId() === parentNodeId;
      },
      persist: saveGame,
      discardStale: async (id) => {
        if (typeof id === 'number' && Number.isInteger(id) && id > 0) await deleteStoredSave(id);
      },
      commit: commitActiveSaveTreeMeta,
      markSaved: () => latestStateRef.current.setHasSave(true),
    }), () => readLiveGameState(latestStateRef.current), (value) => value.status === 'saved');
    return result.status === 'saved';
  }, []);
  const onCourierAutosaveError = useCallback((error: unknown) => {
    pushToast({ kind: 'error', title: '手机自动存档失败', detail: error instanceof Error ? error.message : String(error) });
  }, []);
  const [companionSaveRevision, setCompanionSaveRevision] = useState(0);
  const requestCompanionSave = useCallback(() => setCompanionSaveRevision((revision) => revision + 1), []);
  const saveCompanionOutsideTurn = useCallback(async (_revision: number, sessionId: number): Promise<boolean> => {
    const live = latestStateRef.current;
    if (live.getGameSessionId() !== sessionId || live.view !== 'game' || live.loading || live.pendingVariable) return false;
    const saveSnapshot = saveStatusStore.getSnapshot();
    if (saveSnapshot.sessionId === sessionId && saveSnapshot.phase === 'saved') return true;
    return saveCourierOutsideTurn(live.game.手机, sessionId);
  }, [saveCourierOutsideTurn]);
  useDebouncedCourierAutosave({
    value: companionSaveRevision,
    sessionId: state.getGameSessionId(),
    active: state.view === 'game' && !state.loading && !state.pendingVariable,
    enabled: true,
    save: saveCompanionOutsideTurn,
    onError: (error) => pushToast({ kind: 'error', title: '同伴资料自动存档失败', detail: error instanceof Error ? error.message : String(error) }),
  });
  useDebouncedCourierAutosave({
    value: state.game.手机,
    sessionId: state.getGameSessionId(),
    active: state.view === 'game' && !state.loading && !state.pendingVariable,
    enabled: state.gameSettings.enableAutoSaveEveryTurn,
    save: saveCourierOutsideTurn,
    onError: onCourierAutosaveError,
  });
  const pendingMomentCommentsRef = useRef(new Map<string, { postId: string; revision: number; npcId?: string; sessionId: number }>());
  const [momentRequestVersion, setMomentRequestVersion] = useState(0);
  const handleMomentCommentRequest = useCallback((postId: string, revision: number, npcId?: string) => {
    const key = JSON.stringify([postId, revision, npcId ?? null]);
    pendingMomentCommentsRef.current.set(key, { postId, revision, npcId, sessionId: latestStateRef.current.getGameSessionId() });
    // A retry does not itself change the post; wake the dispatch effect explicitly.
    setMomentRequestVersion((version) => version + 1);
  }, []);
  useEffect(() => {
    for (const [key, pending] of pendingMomentCommentsRef.current) {
      if (pending.sessionId !== latestStateRef.current.getGameSessionId()) {
        pendingMomentCommentsRef.current.delete(key);
        continue;
      }
      if (!latestStateRef.current.game.手机.moments?.some((post) => post.id === pending.postId && post.revision === pending.revision)) continue;
      pendingMomentCommentsRef.current.delete(key);
      void runMomentComments({
        getSessionId: () => latestStateRef.current.getGameSessionId(),
        getCourier: () => latestStateRef.current.game.手机,
        setCourier: (update) => latestStateRef.current.set手机(update),
        getNpcs: () => latestStateRef.current.NPC,
        getApiConfig: () => {
          const live = latestStateRef.current;
          const main = live.apiSettings.configs.find((item) => item.id === live.apiSettings.activeConfigId)
            ?? live.apiSettings.configs[0] ?? null;
          return resolveCourierApiConfig(live.gameSettings.手机系统?.api, main);
        },
        generateComment: generateMomentComment,
      }, pending.postId, pending.revision, pending.npcId);
    }
  }, [state.game.手机.moments, state.getGameSessionId, momentRequestVersion]);
  const networkStatus = useNetworkStatus();
  const pendingMemoryDraftCount = (state.记忆.失败草稿 ?? []).filter(
    (draft) => draft.status === 'pending' || draft.status === 'retrying',
  ).length;
  const [showSettings, setShowSettings] = useState(false);
  const [showWorldbookManager, setShowWorldbookManager] = useState(false);
  const [showCodexManager, setShowCodexManager] = useState(false);
  const [showSaveLoad, setShowSaveLoad] = useState(false);
  const [showCloudSave, setShowCloudSave] = useState(false);
  const [showReleaseAnnouncements, setShowReleaseAnnouncements] = useState(false);
  const [showMysteryChat, setShowMysteryChat] = useState(false);
  const [showCharacter, setShowCharacter] = useState(false);
  const [showCourier, setShowCourier] = useState(false);
  const [showMemoryRebuild, setShowMemoryRebuild] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>('api');
  const [activeSystem, setActiveSystem] = useState<GameSystemId | null>(null);
  const [launchingJourney, setLaunchingJourney] = useState(false);
  const [homeJourneyTransitioning, setHomeJourneyTransitioning] = useState(false);
  const [saveLoadTransitioning, setSaveLoadTransitioning] = useState(false);
  const [bookOpenTransitioning, setBookOpenTransitioning] = useState(false);
  const [recoveryJournal, setRecoveryJournal] = useState<WorkflowRecoveryJournal | null>(null);
  const [showCommandPalette, setShowCommandPalette] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      runStartupStorageMaintenance(),
      checkInterruptedWorkflow(),
    ]).then(([, journal]) => {
      if (!cancelled) setRecoveryJournal(journal);
    });
    return () => { cancelled = true; };
  }, []);

  const [courierReplyErrors, setCourierReplyErrors] = useState<Record<string, string>>({});
  const courierDispatchRef = useRef<(batch: CourierReplyBatchIntent) => Promise<CourierReplyDispatchResult>>(async () => 'retry');
  const [courierReplyQueue] = useState(() => createCourierReplyQueue({
    getSessionId: () => latestStateRef.current.getGameSessionId(),
    dispatch: (batch) => courierDispatchRef.current(batch),
  }));
  const activeCourierSessionId = state.getGameSessionId();
  useEffect(() => {
    courierReplyQueue.invalidateSession();
    setCourierReplyErrors({});
  }, [activeCourierSessionId, courierReplyQueue]);
  useEffect(() => {
    courierReplyQueue.activate();
    return () => courierReplyQueue.dispose();
  }, [courierReplyQueue]);

  const commitAndRevealCourierReply = useCallback(async (
    result: CourierReplyPassResult,
    batch: CourierReplyBatchIntent,
    startCourier: CourierSystem,
    npcWriteBackBase: NPC记录[],
  ): Promise<void> => {
    const resultConversation = result.courier.conversations.find((item) => item.id === batch.conversationId);
    const startConversation = startCourier.conversations.find((item) => item.id === batch.conversationId);
    const newMessages = resultConversation && startConversation
      ? resultConversation.messages.slice(startConversation.messages.length)
      : [];
    const live = latestStateRef.current;
    if (live.getGameSessionId() !== batch.sessionId
      || !isCourierReplyTargetLive(readLiveGameState(live).手机, batch.conversationId, batch.messageIds)) return;

    live.updateGameState((current) => {
      if (live.getGameSessionId() !== batch.sessionId
        || !isCourierReplyTargetLive(current.手机, batch.conversationId, batch.messageIds)) return current;
      return {
        ...current,
        手机: {
          ...current.手机,
          contacts: normalizeCourierSystem({ contacts: [...current.手机.contacts, ...result.courier.contacts] }).contacts,
        },
      };
    });

    await revealCourierMessages(newMessages, (message) => {
      const currentLive = latestStateRef.current;
      currentLive.updateGameState((current) => {
        const nextCourier = applyCourierReplyMessageIfLive({
          current: current.手机,
          currentSessionId: currentLive.getGameSessionId(),
          expectedSessionId: batch.sessionId,
          conversationId: batch.conversationId,
          messageIds: batch.messageIds,
          message: { ...message, timestamp: Date.now() },
        });
        return nextCourier === current.手机 ? current : { ...current, 手机: nextCourier };
      });
    });

    const afterReveal = latestStateRef.current;
    if (afterReveal.getGameSessionId() !== batch.sessionId
      || !isCourierReplyTargetLive(readLiveGameState(afterReveal).手机, batch.conversationId, batch.messageIds)) return;
    afterReveal.setNPC((previous) => mergeNpcWriteBack({
      start: npcWriteBackBase,
      next: result.npcs,
      current: previous,
      expectedSessionId: batch.sessionId,
      currentSessionId: afterReveal.getGameSessionId(),
    }).records);
  }, []);

  const dispatchCourierReply = useCallback(async (batch: CourierReplyBatchIntent): Promise<CourierReplyDispatchResult> => {
    const live = latestStateRef.current;
    if (live.getGameSessionId() !== batch.sessionId || live.gameSettings.手机系统.enabled === false) return 'sent';
    const root = readLiveGameState(live);
    if (!isCourierReplyTargetLive(root.手机, batch.conversationId, batch.messageIds)) return 'sent';
    const conversation = root.手机.conversations.find((item) => item.id === batch.conversationId);
    const playerMessage = conversation && buildCourierPlayerBatch(conversation, batch.messageIds);
    if (!conversation || !playerMessage) return 'sent';
    if (!beginCourierReply(batch.conversationId, batch.sessionId)) return 'defer';

    const typingIds = conversation.type === 'group'
      ? selectGroupReplyMembers(conversation, playerMessage, 3, root.手机.contacts)
      : [([...conversation.messages].reverse().find((message) => message.senderId !== 'player')?.senderId
        ?? conversation.participantIds.find((id) => id !== 'player'))].filter((id): id is string => Boolean(id));
    if (!typingIds.length) {
      endCourierReply(batch.conversationId, batch.sessionId);
      return 'sent';
    }
    const npcWriteBackBase = mapTeyvatNpcsToLegacy(root);
    live.updateGameState((current) => live.getGameSessionId() !== batch.sessionId
      || !isCourierReplyTargetLive(current.手机, batch.conversationId, batch.messageIds) ? current : ({
        ...current,
        手机: {
          ...current.手机,
          conversations: current.手机.conversations.map((item) => item.id === batch.conversationId
            ? { ...item, typingMemberIds: typingIds }
            : item),
        },
      }));

    try {
      const mainApiConfig = live.apiSettings.configs.find((item) => item.id === live.apiSettings.activeConfigId)
        ?? live.apiSettings.configs[0] ?? null;
      const letterApiConfig = resolveCourierApiConfig(live.gameSettings.手机系统?.api, mainApiConfig);
      const weatherName = 天气列表.find((item) => item.id === root.世界.当前天气)?.name;
      const result = await runCourierReplyPass({
        courier: root.手机,
        npcs: npcWriteBackBase,
        environment: {
          location: root.世界.当前地点 || undefined,
          timeText: root.世界.当前时间 || undefined,
          ...(weatherName ? { weather: weatherName } : {}),
        },
        travelerName: root.旅行者.姓名 || undefined,
        letterApiConfig,
        turn: root.turnCount,
        maxReplies: 1,
        replyBatch: batch,
        fallbackPolicy: 'error',
        sessionId: batch.sessionId,
        preclaimedConversationIds: [batch.conversationId],
      });
      const currentLive = latestStateRef.current;
      if (currentLive.getGameSessionId() !== batch.sessionId
        || !isCourierReplyTargetLive(readLiveGameState(currentLive).手机, batch.conversationId, batch.messageIds)) return 'sent';
      await commitAndRevealCourierReply(result, batch, root.手机, npcWriteBackBase);
      if (latestStateRef.current.getGameSessionId() !== batch.sessionId) return 'sent';
      setCourierReplyErrors((previous) => {
        if (!previous[batch.conversationId]) return previous;
        const next = { ...previous };
        delete next[batch.conversationId];
        return next;
      });
      return result.replied > 0 ? 'sent' : 'retry';
    } catch (error) {
      const currentLive = latestStateRef.current;
      if (currentLive.getGameSessionId() !== batch.sessionId
        || !isCourierReplyTargetLive(readLiveGameState(currentLive).手机, batch.conversationId, batch.messageIds)) return 'sent';
      setCourierReplyErrors((previous) => ({
        ...previous,
        [batch.conversationId]: error instanceof Error && error.message === 'PHONE_REPLY_API_UNAVAILABLE'
          ? 'api_unavailable' : 'reply_failed',
      }));
      return 'retry';
    } finally {
      const currentLive = latestStateRef.current;
      currentLive.updateGameState((current) => currentLive.getGameSessionId() !== batch.sessionId ? current : ({
        ...current,
        手机: {
          ...current.手机,
          conversations: current.手机.conversations.map((item) => item.id === batch.conversationId
            ? { ...item, typingMemberIds: [] }
            : item),
        },
      }));
      endCourierReply(batch.conversationId, batch.sessionId);
    }
  }, [commitAndRevealCourierReply]);
  useEffect(() => {
    courierDispatchRef.current = dispatchCourierReply;
  }, [dispatchCourierReply]);

  const handleCourierReplyRequest = useCallback((conversationId: string, messageId: string) => {
    courierReplyQueue.enqueue({ conversationId, messageId, sessionId: latestStateRef.current.getGameSessionId() });
  }, [courierReplyQueue]);
  const handleCourierReplyRetry = useCallback((conversationId: string) => {
    setCourierReplyErrors((previous) => {
      if (!previous[conversationId]) return previous;
      const next = { ...previous };
      delete next[conversationId];
      return next;
    });
    courierReplyQueue.retry(conversationId);
  }, [courierReplyQueue]);

  const handleResumeRecovery = useCallback(async () => {
    if (!recoveryJournal) return;
    const target = resolveRecoveryTarget(recoveryJournal);
    if (!target) {
      await dismissInterruptedWorkflow(recoveryJournal);
      setRecoveryJournal(null);
      return;
    }
    try {
      let result: WorkflowResumeResult;
      if (target.kind === 'pending_settlement') {
        result = await resumePendingSettlementWorkflow(state, recoveryJournal);
      } else {
        result = await resumeCommittedSettlementWorkflow(state, recoveryJournal);
      }
      if (!result.ok) {
        console.error('[workflow-recovery] resume failed:', result.error);
        setRecoveryJournal(result.journal);
        return;
      }
      await dismissInterruptedWorkflow(result.journal);
      setRecoveryJournal(null);
    } catch (error) {
      console.error('[workflow-recovery] durable resume barrier failed:', error);
      setRecoveryJournal(recoveryJournal);
    }
  }, [actions, recoveryJournal, state]);

  const handleDismissRecovery = useCallback(async () => {
    if (!recoveryJournal) return;
    await dismissInterruptedWorkflow(recoveryJournal);
    setRecoveryJournal(null);
  }, [recoveryJournal]);

  const sessionTokenTotals = useMemo(() => 累计Token用量(state.chatHistory), [state.chatHistory]);
  const lastTurnTokens = useMemo(() => {
    const last = [...state.chatHistory].reverse().find((message) => message.tokenUsage);
    return last?.tokenUsage ? { inputTokens: last.tokenUsage.inputTokens, outputTokens: last.tokenUsage.outputTokens, totalTokens: last.tokenUsage.totalTokens } : undefined;
  }, [state.chatHistory]);
  const keyboardShortcutHandlers = useMemo(() => ({
    reroll: () => void actions.handleReroll(),
    save: () => void actions.handleSave(),
    systemDrawer: () => setActiveSystem((current) => (current === null ? 'path' : null)),
    courier: () => setShowCourier(true),
    commandPalette: () => setShowCommandPalette(true),
    closeTop: () => {
      // 与 Modal 栈保持同一语义：只关真正的栈顶弹窗，不再硬关指定布尔开关。
      closeTopModal();
    },
  }), [actions]);
  const keyboardBindings = useMemo(() => ({
    ...KEYBOARD_SHORTCUT_DEFAULTS,
    ...(state.gameSettings.keyboardShortcuts ?? {}),
  }), [state.gameSettings.keyboardShortcuts]);
  useKeyboardShortcuts(keyboardShortcutHandlers, keyboardBindings, state.view === 'game');

  const commandItems = useMemo<CommandItem[]>(() => [
    { id: 'save', label: '手动存档', keywords: ['存档', 'save'], run: () => void actions.handleSave() },
    { id: 'reroll', label: '重新生成（重 roll）', keywords: ['重 roll', 'reroll', '重新生成'], run: () => void actions.handleReroll() },
    { id: 'settings', label: '打开设置', keywords: ['设置', 'settings'], run: () => setShowSettings(true) },
    { id: 'courier', label: '打开手机', keywords: ['手机', '聊天', 'courier'], run: () => setShowCourier(true) },
    { id: 'codex', label: '北陆图书馆', keywords: ['图鉴', '北陆图书馆', 'codex'], run: () => setShowCodexManager(true) },
    { id: 'companion', label: '伙伴', keywords: ['伙伴', 'companion'], run: () => setActiveSystem('companion') },
    { id: 'worldbook', label: '提瓦特之书（世界书）', keywords: ['世界书', 'worldbook', '提瓦特之书'], run: () => setShowWorldbookManager(true) },
    ...GAME_MENU_ITEMS
      .filter((item) => item.id !== 'codex' && item.id !== 'companion' && item.id !== 'worldbook')
      .map((item) => ({
        id: `menu_${item.id}`,
        label: `打开系统：${item.label}`,
        keywords: [item.label, item.subtitle],
        run: () => setActiveSystem(item.id),
      })),
  ], [actions]);

  useEffect(() => {
    clearCommands();
    for (const item of commandItems) registerCommand(item);
    return () => clearCommands();
  }, [commandItems]);

  const recoveryBannerElement = recoveryJournal ? (
    <RecoveryBanner
      journal={recoveryJournal}
      resumable={canAutoResume(recoveryJournal, state.game, {
        allowPristineRoot: state.getGameSessionId() === 0,
        currentSaveTreeNodeId: getActiveSaveTreeNodeId(),
      })}
      onResume={() => void handleResumeRecovery()}
      onDismiss={() => void handleDismissRecovery()}
    />
  ) : null;

  // 断网提示：浏览器已经能一眼判定断网时，不该让玩家白等 45 秒首字节看门狗。
  const offlineNoticeElement = networkStatus.online ? null : (
    <div className="fixed bottom-4 left-1/2 z-[125] -translate-x-1/2" role="status" aria-live="polite">
      <div
        className="px-4 py-2 text-xs"
        style={{
          color: 'rgba(var(--tj-text-primary))',
          background: 'rgba(var(--tj-surface-strong),0.96)',
          boxShadow: 'inset 0 0 0 1px rgba(var(--tj-accent-primary),0.45), 0 12px 32px rgba(0,0,0,0.35)',
          clipPath: CLIP_SMALL,
        }}
      >
        {OFFLINE_HINT}
      </div>
    </div>
  );

  const gamePanelsPreloadedRef = useRef(false);
  useEffect(() => {
    if (state.turnCount < 1 || gamePanelsPreloadedRef.current) return;
    gamePanelsPreloadedRef.current = true;
    const cancelPreload = preloadAll([
      PlotPanel, IrminsulPanel, MapPanel, MemoryPanel, AlbumPanel, SkillPanel, InventoryPanel, QuestPanel, SteambirdPanel, TimelinePanel, CompanionPanel, PathPanel,
    ]);
    return cancelPreload;
  }, [state.turnCount]);

  const storyConflictFacts = useMemo(() => {
    const facts: string[] = [];
    for (const batch of (state.variableBatches ?? []).slice(-15)) {
      const raw = typeof batch.rawText === 'string'
        ? batch.rawText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000)
        : '';
      if (raw) facts.push(raw);
      for (const result of batch.results ?? []) {
        if (result.ok) {
          const valueText = typeof result.command.value === 'string'
            ? result.command.value
            : JSON.stringify(result.command.value ?? '');
          facts.push(`${result.command.key}=${String(valueText).slice(0, 300)}`);
        }
      }
    }
    return facts;
  }, [state.variableBatches]);

  const handleMenuSelect = useCallback((id: GameSystemId) => {
    if (id === 'worldbook') {
      setActiveSystem(null);
      setShowWorldbookManager(true);
      return;
    }
    if (id === 'codex') {
      setActiveSystem(null);
      setShowCodexManager(true);
      return;
    }
    setActiveSystem((current) => (current === id ? null : id));
  }, []);

  const handleOpenSteambird = useCallback(() => setActiveSystem('steambird'), []);
  const handleOpenProfile = useCallback(() => setShowCharacter(true), []);
  const handleOpenCourier = useCallback(() => setShowCourier(true), []);
  const handleCloseCourier = useCallback(() => setShowCourier(false), []);
  const handleOpenMemoryRebuild = useCallback(() => setShowMemoryRebuild(true), []);
  const handleOpenSaveLoad = useCallback(() => setShowSaveLoad(true), []);
  const handleOpenSettings = useCallback(() => setShowSettings(true), []);
  const handleCloseSystemDrawer = useCallback(() => setActiveSystem(null), []);
  const handleToggleStreaming = useCallback(() => {
    state.setGameSettings((prev) => ({
      ...prev,
      enableStreaming: !prev.enableStreaming,
    }));
  }, [state.setGameSettings]);
  const handleToggleBookmark = useCallback((id: string) => {
    state.setChatHistory((prev) => 切换剧情书签(prev, id));
  }, [state.setChatHistory]);
  const handleEditBody = useCallback((id: string, newBody: string) => {
    state.setChatHistory((prev) =>
      prev.map((m) => {
        if (m.id !== id || !m.parsedResponse) return m;
        const parsedResponse = buildManuallyEditedNarrativeTurn(m.parsedResponse, newBody);
        if (!parsedResponse) return m;
        return {
          ...m,
          content: parsedResponse.body[0]?.text ?? newBody,
          parsedResponse,
        };
      }),
    );
  }, [state.setChatHistory]);
  const handleElementalEchoTrigger = useCallback(() => {
    void actions.handleSend('[系统] 踏入元素回响');
  }, [actions]);
  const handleUnlockedElement = useCallback((id: ElementId) => {
    console.info('[element] 元素共鸣已解锁:', id);
  }, []);

  const handleHomeNewGame = useCallback(async () => {
    if (homeJourneyTransitioning || saveLoadTransitioning || bookOpenTransitioning || launchingJourney) return;
    void NewGameWizard.preload();
    setHomeJourneyTransitioning(true);
    const totalDelay = getHomeJourneyDelay();
    const switchDelay = Math.min(getHomeJourneyViewSwitchDelay(), totalDelay);
    await wait(switchDelay);
    actions.handleNewGame();
    await wait(Math.max(totalDelay - switchDelay, 0));
    setHomeJourneyTransitioning(false);
  }, [actions, bookOpenTransitioning, homeJourneyTransitioning, launchingJourney, saveLoadTransitioning]);

  const handleHomeLoadSave = useCallback(async () => {
    if (saveLoadTransitioning || homeJourneyTransitioning || bookOpenTransitioning || launchingJourney) return;
    void SaveLoadModal.preload();
    setSaveLoadTransitioning(true);
    const totalDelay = getSaveLoadDelay();
    const switchDelay = Math.min(getSaveLoadViewSwitchDelay(), totalDelay);
    await wait(switchDelay);
    setShowSaveLoad(true);
    await wait(Math.max(totalDelay - switchDelay, 0));
    setSaveLoadTransitioning(false);
  }, [bookOpenTransitioning, homeJourneyTransitioning, launchingJourney, saveLoadTransitioning]);

  const handleHomeWorldbookManager = useCallback(async () => {
    if (bookOpenTransitioning || saveLoadTransitioning || homeJourneyTransitioning || launchingJourney) return;
    void WorldbookManagerModal.preload();
    setBookOpenTransitioning(true);
    const totalDelay = getBookOpenDelay();
    const switchDelay = Math.min(getBookOpenViewSwitchDelay(), totalDelay);
    await wait(switchDelay);
    setShowWorldbookManager(true);
    await wait(Math.max(totalDelay - switchDelay, 0));
    setBookOpenTransitioning(false);
  }, [bookOpenTransitioning, homeJourneyTransitioning, launchingJourney, saveLoadTransitioning]);

  const handleHomeMysteryChat = useCallback(() => {
    if (bookOpenTransitioning || saveLoadTransitioning || homeJourneyTransitioning || launchingJourney) return;
    setShowMysteryChat(true);
  }, [bookOpenTransitioning, homeJourneyTransitioning, launchingJourney, saveLoadTransitioning]);

  const activeMenuItem = activeSystem
    ? GAME_MENU_ITEMS.find((item) => item.id === activeSystem) ?? null
    : null;
  const currentStoryChapter = useMemo(() => {
    return getCurrentStoryChapterLabel(state.剧情编织);
  }, [state.剧情编织]);
  const latestRecallSummary = useMemo(() => {
    if (state.loading && state.liveRecallSummary.trim()) return state.liveRecallSummary.trim();
    const latest = [...state.chatHistory]
      .reverse()
      .find((msg) =>
        msg.role === 'assistant' &&
        (
          msg.debugContext?.recallSummary?.trim() ||
          msg.debugContext?.codexRecallPreview?.trim()
        ),
      );
    return latest?.debugContext?.recallSummary?.trim()
      || latest?.debugContext?.codexRecallPreview?.trim()
      || '';
  }, [state.chatHistory, state.liveRecallSummary, state.loading]);
  const latestRecallFullContent = useMemo(() => {
    if (state.loading && state.liveRecallFullContent.trim()) return state.liveRecallFullContent.trim();
    const latest = [...state.chatHistory]
      .reverse()
      .find((msg) =>
        msg.role === 'assistant' &&
        (
          msg.debugContext?.recallFullContent?.trim() ||
          msg.debugContext?.codexRecallInjection?.trim()
        ),
      );
    return latest?.debugContext?.recallFullContent?.trim()
      || latest?.debugContext?.codexRecallInjection?.trim()
      || '';
  }, [state.chatHistory, state.liveRecallFullContent, state.loading]);
  const latestActiveTask = useMemo(() => (
    [...state.queueTasks].reverse().find((task) =>
      ['main_story', 'memory', 'variable', 'steambird', 'irminsul', 'codex'].includes(task.id),
    )
  ), [state.queueTasks]);

  const actionOptions = useMemo(() => (
    [...state.chatHistory]
      .reverse()
      .find((m) => m.role === 'assistant')?.parsedResponse?.choices.map((choice) => choice.label) ?? []
  ), [state.chatHistory]);

  const canReroll = useMemo(
    () => state.chatHistory.some((m) => m.role === 'assistant'),
    [state.chatHistory],
  );

  const narrativeImageManualEnabled = Boolean(
    state.gameSettings.文生图系统?.正文生图?.enabled
    && state.gameSettings.文生图系统.正文生图.mode === 'manual',
  );

  const rewriteConfig = useMemo(() => resolveActiveApiConfig(
    state.apiSettings,
    state.gameSettings.enableClaudeMode === true,
  ), [state.apiSettings, state.gameSettings.enableClaudeMode]);

  const recoveryDraft = useMemo(() => (
    state.interruptedWorkflow ? {
      workflowId: state.interruptedWorkflow.workflowId,
      input: state.interruptedWorkflow.input,
    } : null
  ), [state.interruptedWorkflow]);

  // 自动触发第 0 回合：handleStartGame 把触发文本写入 pendingOpeningTrigger，
  // 此 effect 在 view 切到 'game' 且标记存在时调一次 handleSend，然后清空标记。
  // 注意：先清空再 send，避免 React 18 StrictMode 下重复触发。
  useEffect(() => {
    if (state.view === 'game' && state.pendingOpeningTrigger) {
      const text = state.pendingOpeningTrigger;
      state.setPendingOpeningTrigger(null);
      void actions.handleSend(text);
    }
  }, [state.view, state.pendingOpeningTrigger, state, actions]);

  useEffect(() => {
    if (window.location.pathname === '/oauth/github/callback') {
      setShowCloudSave(true);
    }
  }, []);

  useEffect(() => {
    if (state.view !== 'home') return;

    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const preloadCodex = () => {
      void CodexManagerModal.preload();
    };

    if (idleWindow.requestIdleCallback) {
      const idleHandle = idleWindow.requestIdleCallback(preloadCodex, { timeout: 1200 });
      return () => idleWindow.cancelIdleCallback?.(idleHandle);
    }

    const timer = window.setTimeout(preloadCodex, 300);
    return () => window.clearTimeout(timer);
  }, [state.view]);

  useEffect(() => {
    if (state.view !== 'game') return;
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const preloadFrequentPanels = () => {
      void Promise.allSettled([CourierModal.preload(), CompanionPanel.preload()]);
    };
    if (idleWindow.requestIdleCallback) {
      const idleHandle = idleWindow.requestIdleCallback(preloadFrequentPanels, { timeout: 800 });
      return () => idleWindow.cancelIdleCallback?.(idleHandle);
    }
    const timer = window.setTimeout(preloadFrequentPanels, 180);
    return () => window.clearTimeout(timer);
  }, [state.view]);

  // ── Game shell slots ──
  const topBar = (
    <TopBar
      worldState={state.世界}
      currentTheme={state.currentTheme}
      onHome={actions.handleGoHome}
      steambird={state.蒸汽鸟报}
      onOpenSteambird={handleOpenSteambird}
      apiSettings={state.apiSettings}
      onApiSettingsChange={state.setApiSettings}
      saveStatus={saveStatus}
      onRetrySave={retryFailedSave}
    />
  );

  const leftPanel = (
    <LeftPanel
      traveler={state.旅人}
      album={state.相册}
      npcRecords={state.NPC}
      onOpenProfile={handleOpenProfile}
      onOpenCourier={handleOpenCourier}
      courierUnread={state.手机.unreadTotal}
      currentStoryChapter={currentStoryChapter}
      recallSummary={latestRecallSummary}
      recallFullContent={latestRecallFullContent}
    />
  );

  const rightPanel = (
    <RightMenu
      activeId={activeSystem}
      onSelect={handleMenuSelect}
      onSaveGame={handleOpenSaveLoad}
      onLoadGame={handleOpenSaveLoad}
      onSettings={handleOpenSettings}
      memoryUnread={pendingMemoryDraftCount}
    />
  );

  const chatArea = (
    <>
      <VariableDrawer
        batches={state.variableBatches}
        tasks={state.queueTasks}
        pending={state.pendingVariable}
        onRetryTask={actions.handleRetryQueueTask}
        onCancelTask={actions.handleAbort}
      />
      <ChatList
        messages={state.chatHistory}
        variableBatches={state.variableBatches}
        loading={state.loading}
        scrollRef={state.scrollRef}
        npcRecords={state.NPC}
        traveler={state.旅人}
        album={state.相册}
        showInnerVoice={state.gameSettings.enableInnerVoice}
        visualTextSettings={state.gameSettings.visualTextSettings}
        onRegenerateNarrativeImage={actions.handleRegenerateNarrativeImage}
        narrativeImageManualEnabled={narrativeImageManualEnabled}
        onEditBody={handleEditBody}
        onToggleBookmark={handleToggleBookmark}
        rewriteConfig={rewriteConfig ?? undefined}
      />
      <PathAwakeningInvitation
        world={state.世界}
        setWorld={state.set世界}
        onTrigger={handleElementalEchoTrigger}
        disabled={state.loading || state.pendingVariable}
      />
      <TokenMeter
        turnTokens={lastTurnTokens}
        sessionTotal={sessionTokenTotals}
        budgetTokens={state.gameSettings.tokenStats?.enabled === false ? undefined : state.gameSettings.tokenStats?.budgetTokens}
      />
      <InputArea
        onSend={actions.handleSend}
        onAbort={actions.handleAbort}
        loading={state.loading}
        disabled={state.pendingVariable}
        canRestartOpening={state.turnCount <= 5}
        canReroll={canReroll}
        onRestartOpening={actions.handleRestartOpening}
        onReroll={actions.handleReroll}
        streamingEnabled={state.gameSettings.enableStreaming}
        onToggleStreaming={handleToggleStreaming}
        workflowHint={state.workflowHint}
        workflowStatus={state.workflowStatus}
        workflowFailed={latestActiveTask?.status === 'failed'}
        workflowFailCount={latestActiveTask?.failCount ?? (latestActiveTask?.status === 'failed' ? 1 : 0)}
        workflowRetrying={latestActiveTask?.retrying === true}
        onCancelWorkflow={actions.handleAbort}
        actionOptions={actionOptions}
        recoveryDraft={recoveryDraft}
        onCommandIntent={() => setShowCommandPalette(true)}
      />
      {showCommandPalette && <CommandPalette commands={commandItems} onClose={() => setShowCommandPalette(false)} />}
      <SystemDrawer
        open={activeSystem !== null}
        title={activeMenuItem?.label ?? ''}
        subtitle={activeMenuItem?.subtitle}
        glyph={activeMenuItem?.glyph}
        onClose={handleCloseSystemDrawer}
      >
        <Suspense fallback={<LazySurfaceFallback label="系统面板载入中" />}>
          {renderSystemPanel(activeSystem, {
            traveler: state.旅人,
            inventory: state.背包,
            world: state.世界,
            onTravelerChange: state.set旅人,
            onInventoryChange: state.set背包,
            getGameSessionId: state.getGameSessionId,
            onUnlockedElement: handleUnlockedElement,
            npcRecords: state.NPC,
            onNpcRecordsChange: state.setNPC,
            onCompanionProfileSaved: requestCompanionSave,
            courier: state.game.手机,
            onCourierChange: (update) => state.set手机(update),
            variableBatches: state.variableBatches,
            quest: state.game.任务,
            onQuestChange: (updater) => state.updateGameState((current) => ({
              ...current,
              任务: updater(current.任务),
            })),
            album: state.相册,
            onAlbumChange: state.set相册,
            memorySystem: state.记忆,
            onMemorySystemChange: state.set记忆,
            failedDrafts: state.记忆.失败草稿 ?? [],
            onRetryFailedDraft: (draft) => void actions.handleRetryMemoryFailureDraft(draft.id),
            onIgnoreFailedDraft: (draft) => void actions.handleIgnoreMemoryFailureDraft(draft.id),
            onOpenMemoryRebuild: handleOpenMemoryRebuild,
            irminsulMemory: state.世界树,
            codex: state.图鉴,
            memorySettings: state.gameSettings.记忆系统 ?? 创建默认记忆系统设置(),
            steambirdNews: state.蒸汽鸟报,
            plotNodes: state.剧情,
            onPlotNodesChange: state.set剧情,
            storyWeaving: state.剧情编织,
            onStoryWeavingChange: state.set剧情编织,
            gameSettings: state.gameSettings,
            onGameSettingsChange: state.setGameSettings,
            apiSettings: state.apiSettings,
            turnCount: state.turnCount,
            mainChatHistory: state.chatHistory,
            variableFacts: storyConflictFacts,
            canonTrack: state.game.原著轨道,
            elementalField: state.game.叙事.元素场面,
            elementalEvents: state.game.叙事.元素事件,
            mapState: state.game.地图,
            currentRegion: state.game.世界.当前地区,
            onUnlockStatue: (regionId) => state.updateGameState((current) => ({ ...current, 地图: unlockStatue(current.地图, regionId) })),
            onTeleport: (regionId) => state.updateGameState((current) => ({
              ...current,
              世界: {
                ...current.世界,
                当前地区: regionId,
                // 传送同步更新当前地点到该地区主地标，避免地区/地点错位一回合。
                当前地点: MAP_REGION_MAIN_LOCATIONS[regionId] ?? current.世界.当前地点,
              },
              地图: markTeleport(current.地图, current.turnCount),
            })),
          })}
        </Suspense>
      </SystemDrawer>
      {recoveryBannerElement}
      {offlineNoticeElement}
    </>
  );

  // ── Home ──
  if (state.view === 'home') {
    return (
      <>
        {isDesktopRuntime() ? (
          <DesktopHomeScreen
            onNewGame={handleHomeNewGame}
            onLoadSave={handleHomeLoadSave}
            onContinue={actions.handleContinue}
            onOpenSettings={(tab = 'api') => {
              setSettingsInitialTab(tab);
              setShowSettings(true);
            }}
            onOpenStorageManager={() => {
              setSettingsInitialTab('storage');
              setShowSettings(true);
            }}
            onOpenWorldbookManager={handleHomeWorldbookManager}
            onOpenCodexManager={() => setShowCodexManager(true)}
            onOpenCloudSave={() => setShowCloudSave(true)}
            onOpenReleaseAnnouncements={() => setShowReleaseAnnouncements(true)}
            onDiscordPost={() => window.open('https://discord.com/channels/1380075940285124724/1509136913792241704', '_blank', 'noopener,noreferrer')}
            onMysteryChat={handleHomeMysteryChat}
            currentTheme={state.currentTheme}
          />
        ) : (
          <LandingPage
            onNewGame={handleHomeNewGame}
            onLoadSave={handleHomeLoadSave}
            onSettings={() => {
              setSettingsInitialTab('api');
              setShowSettings(true);
            }}
            onWorldbookManager={handleHomeWorldbookManager}
            onCodexManager={() => setShowCodexManager(true)}
            onCloudSave={() => setShowCloudSave(true)}
            onReleaseAnnouncements={() => setShowReleaseAnnouncements(true)}
            onDiscordPost={() => window.open('https://discord.com/channels/1380075940285124724/1509136913792241704', '_blank', 'noopener,noreferrer')}
            onMysteryChat={handleHomeMysteryChat}
            onContinue={actions.handleContinue}
            currentTheme={state.currentTheme}
          />
        )}
        {recoveryBannerElement}
        {homeJourneyTransitioning ? <HomeJourneyOverlay /> : null}
        {saveLoadTransitioning ? <SaveLoadOverlay /> : null}
        {bookOpenTransitioning ? <BookOpenOverlay /> : null}
        {showWorldbookManager && (
          <Suspense fallback={<LazySurfaceFallback label="提瓦特之书载入中" />}>
            <WorldbookManagerModal
              worldbooks={state.worldbooks}
              onSave={persistWorldbooks}
              onClose={() => setShowWorldbookManager(false)}
            />
          </Suspense>
        )}
        {showCodexManager && (
          <Suspense fallback={<LazySurfaceFallback label="图鉴载入中" />}>
            <CodexManagerModal
              codex={state.图鉴}
              onClose={() => setShowCodexManager(false)}
            />
          </Suspense>
        )}
        {showSaveLoad && (
          <Suspense fallback={<LazySurfaceFallback label="存档系统载入中" />}>
            <SaveLoadModal
              onSave={actions.handleSave}
              onLoad={async (id) => {
                const ok = await handleLoadById(id, state);
                if (ok) setShowSaveLoad(false);
                return ok;
              }}
              onClose={() => setShowSaveLoad(false)}
              chatHistory={state.chatHistory}
              旅人={state.旅人}
              worldbooks={state.worldbooks}
              album={state.相册}
            />
          </Suspense>
        )}
        {showCloudSave && (
          <Suspense fallback={<LazySurfaceFallback label="云存档载入中" />}>
            <GitHubCloudSaveModal
              onSave={actions.handleSave}
              onClose={() => setShowCloudSave(false)}
            />
          </Suspense>
        )}
        {showReleaseAnnouncements && (
          <Suspense fallback={<LazySurfaceFallback label="公告载入中" />}>
            <ReleaseAnnouncementsModal
              onClose={() => setShowReleaseAnnouncements(false)}
            />
          </Suspense>
        )}
        {showMysteryChat && (
          <MysteryChatModal onClose={() => setShowMysteryChat(false)} />
        )}
        {showSettings && (
          <Suspense fallback={<LazySurfaceFallback label="设置载入中" />}>
            <SettingsModal
              onClose={() => setShowSettings(false)}
              apiSettings={state.apiSettings}
              onApiSettingsChange={state.setApiSettings}
              gameSettings={state.gameSettings}
              onGameSettingsChange={state.setGameSettings}
              currentTheme={state.currentTheme}
              onThemeChange={state.setCurrentTheme}
              onSave={actions.handleSave}
              onContinue={actions.handleContinue}
              onLoadSave={(id) => handleLoadById(id, state)}
              initialTab={settingsInitialTab}
              旅人={state.旅人}
              世界={state.世界}
              on世界Change={state.set世界}
              记忆={state.记忆}
              世界树={state.世界树}
              图鉴={state.图鉴}
              手机={state.手机}
              NPC={state.NPC}
              蒸汽鸟报={state.蒸汽鸟报}
              剧情编织={state.剧情编织}
              on剧情编织Change={state.set剧情编织}
              getContextSnapshot={actions.getContextSnapshot}

              worldbooks={state.worldbooks}

              onWorldbooksChange={persistWorldbooksWithFeedback}
              chatHistory={state.chatHistory}
              variableSetters={{
                set旅人: state.set旅人,
                set背包: state.set背包,
                set世界: state.set世界,
                set记忆: state.set记忆,
                set世界树: state.set世界树,
                set图鉴: state.set图鉴,
                set手机: state.set手机,
                setNPC: state.setNPC,
                set蒸汽鸟报: state.set蒸汽鸟报,
                set剧情: state.set剧情,
              }}
              variableEditingLocked={state.loading || state.pendingVariable}
            />
          </Suspense>
        )}
        <ToastHost />
        {offlineNoticeElement}
      </>
    );
  }

  // ── New Game Wizard ──
  if (state.view === 'new_game') {
    const getActiveApiConfig = () => {
      if (state.apiSettings.activeConfigId) {
        return state.apiSettings.configs.find((item) => item.id === state.apiSettings.activeConfigId) ?? state.apiSettings.configs[0] ?? null;
      }
      return state.apiSettings.configs[0] ?? null;
    };
    const handleGenerateTravelerTemplate = async (context: TravelerTemplateContext): Promise<TravelerTemplateDraft> => {
      const config = getActiveApiConfig();
      if (!config) throw new Error('请先在设置中配置至少一个 API 接口。');
      return generateTravelerTemplate(config, context);
    };

    const handleStartGame = async (traveler: 角色数据结构, worldState: 世界状态, initialNpcRecords: NPC记录[] = []) => {
      state.invalidateGameSession();
      const openingSessionId = state.getGameSessionId();
      const { game, storyWeaving } = await prepareNewGameState({
        traveler,
        world: worldState,
        initialNpcs: initialNpcRecords,
        codexCatalog: state.图鉴,
        loadStoryWeaving: loadAllBundledStoryWeavingPresets,
      });
      if (state.getGameSessionId() !== openingSessionId) return;
      try {
        await saveSetting('storyWeavingSystem', buildPersistedStoryWeavingSystem(storyWeaving));
      } catch (err) {
        console.warn('[story-weaving] 新开局剧情目录保存失败，继续使用本局状态:', err);
      }
      if (state.getGameSessionId() !== openingSessionId) return;
      clearActiveSaveTreeMetaIfMatches();
      state.replaceGameState(game);
      const launchedSessionId = state.getGameSessionId();
      state.setPendingOpeningTrigger('[系统] 开启第 0 回合');
      setLaunchingJourney(true);
      await wait(getJourneyLaunchDelay());
      if (state.getGameSessionId() !== launchedSessionId) {
        setLaunchingJourney(false);
        return;
      }
      state.setView('game');
      setLaunchingJourney(false);
    };

    return (
      <>
        <Suspense fallback={<LazySurfaceFallback label="开局档案载入中" />}>
          <NewGameWizard
            onStart={handleStartGame}
            onBack={() => state.setView('home')}
            currentTheme={state.currentTheme}
            gameSettings={state.gameSettings}
            onGameSettingsChange={state.setGameSettings}
            apiSettings={state.apiSettings}
            onOpenApiSettings={() => {
              setSettingsInitialTab('api');
              setShowSettings(true);
            }}
            openingArchiveApiConfig={getActiveApiConfig()}
            onGenerateTravelerTemplate={handleGenerateTravelerTemplate}
          />
        </Suspense>
        {showSettings && (
          <Suspense fallback={<LazySurfaceFallback label="设置载入中" />}>
            <SettingsModal
              onClose={() => setShowSettings(false)}
              apiSettings={state.apiSettings}
              onApiSettingsChange={state.setApiSettings}
              gameSettings={state.gameSettings}
              onGameSettingsChange={state.setGameSettings}
              currentTheme={state.currentTheme}
              onThemeChange={state.setCurrentTheme}
              onSave={actions.handleSave}
              onContinue={actions.handleContinue}
              onLoadSave={(id) => handleLoadById(id, state)}
              initialTab={settingsInitialTab}
              旅人={state.旅人}
              世界={state.世界}
              on世界Change={state.set世界}
              记忆={state.记忆}
              世界树={state.世界树}
              图鉴={state.图鉴}
              手机={state.手机}
              NPC={state.NPC}
              蒸汽鸟报={state.蒸汽鸟报}
              剧情编织={state.剧情编织}
              on剧情编织Change={state.set剧情编织}
              getContextSnapshot={actions.getContextSnapshot}
              worldbooks={state.worldbooks}
              onWorldbooksChange={persistWorldbooksWithFeedback}
              chatHistory={state.chatHistory}
              variableSetters={{
                set旅人: state.set旅人,
                set背包: state.set背包,
                set世界: state.set世界,
                set记忆: state.set记忆,
                set世界树: state.set世界树,
                set图鉴: state.set图鉴,
                set手机: state.set手机,
                setNPC: state.setNPC,
                set蒸汽鸟报: state.set蒸汽鸟报,
                set剧情: state.set剧情,
              }}
              variableEditingLocked
            />
          </Suspense>
        )}
        {homeJourneyTransitioning ? <HomeJourneyOverlay /> : null}
        {launchingJourney ? <JourneyLaunchOverlay /> : null}
        <ToastHost />
      </>
    );
  }

  // ── Game ──
  return (
    <>
      <GameView
        region={state.世界.当前地区}
        weatherId={state.世界.当前天气}
        topBar={topBar}
        leftPanel={leftPanel}
        rightPanel={rightPanel}
        chatArea={chatArea}
      />

      {/* Mobile bottom menu */}
      {!activeSystem && !showSettings && !showWorldbookManager && !showCodexManager && !showSaveLoad && !showCharacter && !showCourier && !showMemoryRebuild && (
        <MobileQuickMenu
          onHome={actions.handleGoHome}
          onCharacter={handleOpenProfile}
          onCourier={handleOpenCourier}
          onSettings={handleOpenSettings}
          onSave={handleOpenSaveLoad}
          onSystemSelect={handleMenuSelect}
          courierUnread={state.手机.unreadTotal}
          memoryUnread={pendingMemoryDraftCount}
        />
      )}

      {/* Modals */}
      {showSettings && (
        <Suspense fallback={<LazySurfaceFallback label="设置载入中" />}>
          <SettingsModal
            onClose={() => setShowSettings(false)}
            apiSettings={state.apiSettings}
            onApiSettingsChange={state.setApiSettings}
            gameSettings={state.gameSettings}
            onGameSettingsChange={state.setGameSettings}
            currentTheme={state.currentTheme}
            onThemeChange={state.setCurrentTheme}
            onSave={actions.handleSave}
            onContinue={actions.handleContinue}
            onLoadSave={(id) => handleLoadById(id, state)}
            initialTab={settingsInitialTab}
            旅人={state.旅人}
            世界={state.世界}
            on世界Change={state.set世界}
            记忆={state.记忆}
            世界树={state.世界树}
            图鉴={state.图鉴}
            手机={state.手机}
            NPC={state.NPC}
            蒸汽鸟报={state.蒸汽鸟报}
            剧情编织={state.剧情编织}
            on剧情编织Change={state.set剧情编织}
            getContextSnapshot={actions.getContextSnapshot}
            worldbooks={state.worldbooks}
            onWorldbooksChange={persistWorldbooksWithFeedback}
            chatHistory={state.chatHistory}
            variableSetters={{
              set旅人: state.set旅人,
              set背包: state.set背包,
              set世界: state.set世界,
              set记忆: state.set记忆,
              set世界树: state.set世界树,
              set图鉴: state.set图鉴,
              set手机: state.set手机,
              setNPC: state.setNPC,
              set蒸汽鸟报: state.set蒸汽鸟报,
              set剧情: state.set剧情,
            }}
            variableEditingLocked={state.loading || state.pendingVariable}
          />
        </Suspense>
      )}

      {showCharacter && (
        <TravelerProfileModal
          traveler={state.旅人}
          album={state.相册}
          onClose={() => setShowCharacter(false)}
          onTravelerChange={(旅人) => state.set旅人(旅人)}
        />
      )}

      {showCourier && (
        <Suspense fallback={<LazySurfaceFallback label="手机载入中" />}>
          <CourierModal
            courier={state.game.手机}
            album={state.相册}
            npcRecords={state.NPC}
            travelerName={state.旅人.姓名}
            travelerAvatar={state.旅人.头像}
            currentTurn={state.game.turnCount}
            onCourierChange={state.set手机}
            getGameSessionId={state.getGameSessionId}
            onRequestReply={handleCourierReplyRequest}
            replyErrorByConversationId={courierReplyErrors}
            onRetryReply={handleCourierReplyRetry}
            onRequestMomentComments={handleMomentCommentRequest}
            canGenerateMomentComments={canGenerateMomentComments}
            onClose={handleCloseCourier}
          />
        </Suspense>
      )}

      {showMemoryRebuild && (
        <MemoryRebuildModal
          defaultEnd={Math.max(1, state.turnCount - 1)}
          onClose={() => setShowMemoryRebuild(false)}
          onAbort={actions.handleAbort}
          onRun={actions.handleBatchMemoryRebuild}
        />
      )}

      {showWorldbookManager && (
        <Suspense fallback={<LazySurfaceFallback label="提瓦特之书载入中" />}>
          <WorldbookManagerModal
            worldbooks={state.worldbooks}
            onSave={persistWorldbooks}
            onClose={() => setShowWorldbookManager(false)}
          />
        </Suspense>
      )}

      {showCodexManager && (
        <Suspense fallback={<LazySurfaceFallback label="图鉴载入中" />}>
          <CodexManagerModal
            codex={state.图鉴}
            onClose={() => setShowCodexManager(false)}
          />
        </Suspense>
      )}

      {showSaveLoad && (
        <Suspense fallback={<LazySurfaceFallback label="存档系统载入中" />}>
          <SaveLoadModal
            onSave={actions.handleSave}
            onLoad={async (id) => {
              const ok = await handleLoadById(id, state);
              if (ok) setShowSaveLoad(false);
              return ok;
            }}
            onClose={() => setShowSaveLoad(false)}
            chatHistory={state.chatHistory}
            旅人={state.旅人}
            worldbooks={state.worldbooks}
            album={state.相册}
          />
        </Suspense>
      )}

      {showCloudSave && (
        <Suspense fallback={<LazySurfaceFallback label="云存档载入中" />}>
          <GitHubCloudSaveModal
            onSave={actions.handleSave}
            onClose={() => setShowCloudSave(false)}
          />
        </Suspense>
      )}
      <ToastHost />
      {offlineNoticeElement}
    </>
  );
}

// ── Inline character editor ──

function renderSystemPanel(
  id: GameSystemId | null,
  ctx: {
    traveler: 角色数据结构;
    inventory: TeyvatInventory;
    world: 世界状态;
    onTravelerChange: React.Dispatch<React.SetStateAction<角色数据结构>>;
    onInventoryChange: React.Dispatch<React.SetStateAction<TeyvatInventory>>;
    getGameSessionId: () => number;
    onUnlockedElement: (id: ElementId) => void;
    npcRecords: NPC记录[];
    onNpcRecordsChange: React.Dispatch<React.SetStateAction<NPC记录[]>>;
    onCompanionProfileSaved: () => void;
    courier: import('@/models/teyvat').CourierSystem;
    onCourierChange: (update: import('@/models/teyvat').CourierSystem | ((previous: import('@/models/teyvat').CourierSystem) => import('@/models/teyvat').CourierSystem)) => void;
    quest: QuestJournal;
    onQuestChange: (updater: (previous: QuestJournal) => QuestJournal) => void;
    variableBatches: import('@/models/variableCommand').变量命令批次[];
    album: 相册系统;
    onAlbumChange: React.Dispatch<React.SetStateAction<相册系统>>;
    memorySystem: 记忆系统;
    onMemorySystemChange: React.Dispatch<React.SetStateAction<记忆系统>>;
    failedDrafts?: 记忆失败草稿[];
    onRetryFailedDraft?: (draft: 记忆失败草稿) => void;
    onIgnoreFailedDraft?: (draft: 记忆失败草稿) => void;
    onOpenMemoryRebuild?: () => void;
    irminsulMemory: import('@/models/teyvat').IrminsulMemory;
    codex: import('@/models/teyvat').ArchiveCodex;
    memorySettings: import('@/models/settings').记忆系统设置;
    steambirdNews: import('@/models/teyvat').SteambirdNews;
    plotNodes: 剧情节点[];
    onPlotNodesChange: React.Dispatch<React.SetStateAction<剧情节点[]>>;
    storyWeaving: import('@/models/storyWeaving').剧情编织系统;
    onStoryWeavingChange: React.Dispatch<React.SetStateAction<import('@/models/storyWeaving').剧情编织系统>>;
    gameSettings: import('@/models/settings').游戏设置;
    onGameSettingsChange: React.Dispatch<React.SetStateAction<import('@/models/settings').游戏设置>>;
    apiSettings: import('@/models/settings').API设置;
    turnCount: number;
    mainChatHistory: import('@/models/chat').聊天消息[];
    variableFacts?: string[];
    canonTrack: import('@/models/teyvat').CanonTrack;
    elementalField: import('@/models/teyvat').ElementalFieldState;
    elementalEvents: import('@/models/teyvat').ElementalReactionEvent[];
    mapState: import('@/models/teyvat').TeyvatMapState;
    currentRegion: import('@/models/teyvat').RegionId | '';
    onUnlockStatue: (regionId: import('@/models/teyvat').RegionId) => void;
    onTeleport: (regionId: import('@/models/teyvat').RegionId) => void;
  },
) {
  switch (id) {
    case 'path':
      return (
        <PathPanel
          traveler={ctx.traveler}
          onTravelerChange={ctx.onTravelerChange}
          onUnlockedElement={ctx.onUnlockedElement}
          elementalField={ctx.elementalField}
          elementalEvents={ctx.elementalEvents}
        />
      );
      case 'skill':
        return <SkillPanel traveler={ctx.traveler} onTravelerChange={ctx.onTravelerChange} apiSettings={ctx.apiSettings} />;
    case 'quest':
      return (
        <QuestPanel
          quest={ctx.quest}
          onQuestChange={ctx.onQuestChange}
        />
      );
    case 'inventory':
      return (
        <InventoryPanel
          inventory={ctx.inventory}
          onInventoryChange={ctx.onInventoryChange}
          getGameSessionId={ctx.getGameSessionId}
          turnCount={ctx.turnCount}
        />
      );
    case 'companion':
      return (
        <CompanionPanel
          npcRecords={ctx.npcRecords}
          onNpcRecordsChange={ctx.onNpcRecordsChange}
          onProfileSaved={ctx.onCompanionProfileSaved}
          album={ctx.album}
          turnCount={ctx.turnCount}
          nsfwEnabled={ctx.gameSettings.enableNsfw}
          maleNsfwArchiveEnabled={ctx.gameSettings.enableMaleNsfwArchive}
          codex={ctx.codex}
          devMode={ctx.gameSettings.devMode}
          variableBatches={ctx.variableBatches}
          courier={ctx.courier}
          onCourierChange={ctx.onCourierChange}
          travelerName={ctx.traveler.姓名}
        />
      );
    case 'album':
      return (
        <AlbumPanel
          album={ctx.album}
          onAlbumChange={ctx.onAlbumChange}
          traveler={ctx.traveler}
          onTravelerChange={ctx.onTravelerChange}
          npcs={ctx.npcRecords}
          onNpcChange={ctx.onNpcRecordsChange}
          apiSettings={ctx.apiSettings}
          gameSettings={ctx.gameSettings}
          onGameSettingsChange={ctx.onGameSettingsChange}
          imageSettings={ctx.gameSettings.文生图系统}
          nsfwEnabled={ctx.gameSettings.enableNsfw}
          nsfwImageEnabled={ctx.gameSettings.文生图系统.enableNsfwImageGeneration}
          mainChatHistory={ctx.mainChatHistory}
        />
      );
    case 'timeline':
      return (
        <TimelinePanel
          world={ctx.world}
          steambird={ctx.steambirdNews}
          storyWeaving={ctx.storyWeaving}
          memory={ctx.memorySystem}
        />
      );
    case 'steambird':
      return <SteambirdPanel steambird={ctx.steambirdNews} turnCount={ctx.turnCount} />;
    case 'plot':
      return (
        <PlotPanel
          storyWeaving={ctx.storyWeaving}
          onStoryWeavingChange={ctx.onStoryWeavingChange}
          gameSettings={ctx.gameSettings}
          apiSettings={ctx.apiSettings}
          variableFacts={ctx.variableFacts}
          canonTrack={ctx.canonTrack}
        />
      );
    case 'map':
      return <MapPanel map={ctx.mapState} currentRegion={ctx.currentRegion} turnCount={ctx.turnCount} onUnlockStatue={ctx.onUnlockStatue} onTeleport={ctx.onTeleport} />;
    case 'irminsul':
      return <IrminsulPanel memory={ctx.irminsulMemory} />;
    case 'memory':
      return (
        <MemoryPanel
          memorySystem={ctx.memorySystem}
          onMemorySystemChange={ctx.onMemorySystemChange}
          getGameSessionId={ctx.getGameSessionId}
          turnCount={ctx.turnCount}
          settings={ctx.memorySettings}
          failedDrafts={ctx.failedDrafts}
          onRetryFailedDraft={ctx.onRetryFailedDraft}
          onIgnoreFailedDraft={ctx.onIgnoreFailedDraft}
          onOpenBatchRebuild={ctx.onOpenMemoryRebuild}
        />
      );
    default:
      return null;
  }
}
