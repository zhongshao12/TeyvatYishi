import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTransition } from 'react';
import { normalizeStorySnapshotRenderContext, 图片是否参考角色, 读取图片参考目标 } from '@/models/imageGeneration';
import type { NovelAITaskOverrides, StorySnapshotRenderContext, 图片槽位, 图片生成任务, 图片目标类型, 相册条目, 相册系统 } from '@/models/imageGeneration';
import type { 角色数据结构 } from '@/models/character';
import type { 聊天消息 } from '@/models/chat';
import type { API设置, PNG画风预设来源, 游戏设置, 文生图API配置, 文生图规则中心设置, 文生图系统设置 } from '@/models/settings';
import type { NPC记录, NPC头像槽位, NPC角色锚点档案 } from '@/models/npc';
import { 读取NPC头像 } from '@/models/npc';
import { saveSetting } from '@/services/dbService';
import { ConfirmDialogHost, useConfirmDialog } from '@/components/ui/Modal';
import {
  添加图片到相册,
  创建相册图片条目,
  创建相册资源引用,
  fileToDataUrl,
  挂载NPC头像图片,
  挂载NPC立绘图片,
  挂载NPC_NSFW部位图片,
  挂载旅人图片,
  读取相册条目地址,
  解析相册资源引用,
  解析相册资源地址,
} from '@/utils/albumActions';
import { buildNovelAIRequestPayload, generateImage } from '@/services/ai/imageGeneration';
import { ImageRuleTemplateEditor } from '@/components/features/ImageGeneration/ImageRuleTemplateEditor';
import { ImagePromptLibraryPicker } from '@/components/features/ImageGeneration/ImagePromptLibraryPicker';
import { appendImagePromptFragments, applyImagePromptSelection } from '@/utils/imagePromptLibrary';
import { ImageGenerationSettingsTab } from '@/components/features/Settings/ImageGenerationSettingsTab';
import { parseSceneImagePrompt } from '@/services/ai/narrativeImageParse';
import { resolveStorySnapshot, trimStorySnapshotSource } from '@/services/ai/storySnapshotPipeline';
import { extractCharacterAnchorWithAI } from '@/services/ai/characterAnchorExtract';
import { applyNovelAIRulePreset, buildNpcImagePrompt, buildSceneImagePrompt, buildTravelerImagePrompt, readImagePromptCharacter, readImagePromptParserCharacter, selectImagePromptSceneNpcs, 应用场景角色锚点锁, 应用质量增强提示词 } from '@/utils/imagePromptRules';
import { readImageError, runImageGenerationWithRetry } from '@/utils/imageGenerationRetry';
import { globalImageTaskQueue, recoverInterruptedTasks, recoverStaleTasks } from '@/utils/imageTaskQueue';
import { buildImagePromptTokenizerConfig, buildImagePromptTokenizerSystemPrompt, tokenizeImagePrompt } from '@/services/ai/imagePromptTokenizer';
import { compactImagePrompts, sanitizeImageModelPrompt, type PromptCharacter } from '@/utils/imagePromptCompaction';

import {
  generateTargets, smallClip, groupForTab, navGroups, tabs,
} from './album/foundation';
import type {
  AnchorSelection, GenerateOverride, GenerateTarget, PromptMeta,
  SceneImageSummary, StorySnapshotSource, StorySnapshotSummary, WorkTab, NavGroupId,
} from './album/foundation';

import {
  buildAlbumResourceEntries, buildCharacterLibraryRecords, buildNpcSourceText, buildPresentSceneNpcs,
  buildSceneLibraryEntries, buildSceneSourceText, buildStorySnapshotSourceOptions,
  buildTravelerSourceText, CharacterAnchorWorkspace, cleanupAlbumAssets, createTask,
  CreateWorkspace, defaultAlbumEntryNote, defaultAlbumEntryTags,
  getNpcAnchorStatus, getSceneAnchorStatus, getTravelerAnchorStatus,
  isNpcLibraryRecord, mapImageSlotToNpcAvatarSlot,
  mapImageSlotToTravelerSlot, NsfwVisibilityToggle,
  CourierBackgroundWorkspace, requiresCharacterTarget,
  resolveGenerationTargetId, resolveSize, RulesWorkspace, SceneImageWorkspace,
  slotLabel, StorySnapshotWorkspace, WorkspaceTabs,
} from './album/workspaces';
import type { CharacterLibraryRecord } from './album/workspaces';
import { ImageLibraryWorkspace } from './album/libWorkspace';
import { ImageTaskWorkspace } from './album/taskWorkspace';
import { evaluateReferenceInjection, resolveReferenceImagesForGeneration } from './album/referenceInjection';
import { ReferenceInjectionWorkspace } from './album/referenceWorkspace';
import {
  albumOperationStageLabel,
  exportAlbumInWorker,
  importAlbumInWorker,
  type AlbumOperationProgress,
} from './album/albumArchiveWorkerClient';
import { addOrReuseAlbumImage, dataUrlToBytes, hydrateAlbumContentHashes, normalizeContentHash, sha256Bytes } from './album/albumContent';
import { getLiveGameSessionId } from '@/hooks/useTeyvatRuntime';

interface AlbumPanelProps {
  album: 相册系统;
  onAlbumChange: React.Dispatch<React.SetStateAction<相册系统>>;
  traveler: 角色数据结构;
  onTravelerChange: React.Dispatch<React.SetStateAction<角色数据结构>>;
  npcs: NPC记录[];
  onNpcChange: React.Dispatch<React.SetStateAction<NPC记录[]>>;
  apiSettings: API设置;
  gameSettings: 游戏设置;
  onGameSettingsChange: React.Dispatch<React.SetStateAction<游戏设置>>;
  imageSettings: 文生图系统设置;
  nsfwEnabled: boolean;
  nsfwImageEnabled: boolean;
  mainChatHistory?: 聊天消息[];
  /**
   * 当前对局身份（`useGameState.getGameSessionId`）。
   *
   * 相册里所有异步动作（手动生图、AI 锚点提取、导入导出、参考图上传）在 await 之后
   * 只能用「启动时那一次渲染」的 setter 提交；如果这段时间里玩家读档/开了新档，
   * 那个 setter 会把旧档的结果写进**新档**（P1-B02）。提交前必须核对身份。
   */
  getGameSessionId?: () => number;
}

function setEntryReferenceTargets(entries: 相册条目[], entryId: string, characterId: string, enabled: boolean): 相册条目[] {
  return entries.map((entry) => {
    const targets = 读取图片参考目标(entry);
    if (entry.id !== entryId) {
      return enabled ? { ...entry, referenceTargets: targets.filter((targetId) => targetId !== characterId) } : entry;
    }
    return {
      ...entry,
      referenceTargets: enabled
        ? Array.from(new Set([...targets, characterId]))
        : targets.filter((targetId) => targetId !== characterId),
    };
  });
}

/**
 * 把 `hydrateAlbumContentHashes` 补出来的 `contentHash` 当作**增量**合并进当前相册。
 *
 * 为什么不让 hydrate 的结果直接当基准：hydrate 是一次异步遍历，期间玩家可能已经生成/删除图片，
 * 直接用它替换整份相册就会回滚那些改动（P1-B03）。它唯一有用的产出就是「某资源缺的 hash」，
 * 按 id 取回来补即可，条目集合始终以当前相册为准。
 */
function mergeHydratedContentHashes(
  current: 相册系统,
  hydratedHashes: ReadonlyMap<string, string | undefined>,
): 相册系统 {
  let changed = false;
  const assets = current.assets.map((asset) => {
    const hash = hydratedHashes.get(asset.id);
    if (!hash || hash === asset.contentHash) return asset;
    changed = true;
    return { ...asset, contentHash: hash };
  });
  return changed ? { ...current, assets } : current;
}

export function AlbumPanel(props: AlbumPanelProps) {
  // Keep each panel's async closures bound to one session. A new session needs
  // a fresh guard and fresh UI drafts even when the surrounding system stays open.
  const sessionId = props.getGameSessionId?.() ?? getLiveGameSessionId() ?? 0;
  return <SessionAlbumPanel key={sessionId} {...props} />;
}

function SessionAlbumPanel({ album, onAlbumChange, traveler, onTravelerChange, npcs, onNpcChange, apiSettings, gameSettings, onGameSettingsChange, imageSettings, nsfwEnabled, nsfwImageEnabled, mainChatHistory = [], getGameSessionId }: AlbumPanelProps) {
  const [activeTab, setActiveTab] = useState<WorkTab>('manual');
  const [showNsfw, setShowNsfw] = useState(false);
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  // B9：批量删除图片此前零确认，误点即永久丢图；统一走样式化危险确认弹窗。
  const confirmDialog = useConfirmDialog();
  const askConfirm = confirmDialog.confirm;
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [promptEditorOpen, setPromptEditorOpen] = useState(false);
  const [lastPromptMeta, setLastPromptMeta] = useState<PromptMeta | null>(null);
  const [generateTitle, setGenerateTitle] = useState('');
  const [generating, setGenerating] = useState(false);

  // ── 对局身份守卫（P1-B02）────────────────────────────────────────────────
  // 相册里的异步动作跨越多次 await；期间玩家可能读档或开新档，而提交用的 setter 仍是
  // 「启动时那一次渲染」的闭包，会直接写进新档。这里在提交前核对身份：
  // 身份变了就丢弃本次提交（旧任务的结果既不写新档，也不回流到原档任务区）。
  //
  // 三个提交包装器必须是**引用稳定**的：`recoverAlbumTasks` 依赖它们，而它又是
  // `useEffect`（挂载即恢复 + 30s 兜底）的依赖项；身份一变 effect 就重挂，
  // 每次重挂都再提交一次 → 自激渲染循环。所以真正的 setter 走 ref 读取。
  const readAlbumHandlerRef = useRef(onAlbumChange);
  readAlbumHandlerRef.current = onAlbumChange;
  const readTravelerHandlerRef = useRef(onTravelerChange);
  readTravelerHandlerRef.current = onTravelerChange;
  const readNpcHandlerRef = useRef(onNpcChange);
  readNpcHandlerRef.current = onNpcChange;
  const getGameSessionIdRef = useRef(getGameSessionId);
  getGameSessionIdRef.current = getGameSessionId;
  /** 始终指向最新一次渲染的相册：异步流程要在 await 之后读「现在」而不是闭包里的旧值。 */
  const albumRef = useRef(album);
  albumRef.current = album;
  const 面板会话号 = useRef<number | null>(null);
  if (面板会话号.current === null) {
    面板会话号.current = getGameSessionId ? getGameSessionId() : (getLiveGameSessionId() ?? 0);
  }
  /** 本次会话身份是否仍与面板挂载时一致；不一致时禁止任何 setter 提交。 */
  const 提交仍属于本会话 = (): boolean => {
    const captured = 面板会话号.current;
    if (captured === null) return true;
    const live = getLiveGameSessionId();
    if (live !== undefined) return live === captured;
    const fromProps = getGameSessionIdRef.current;
    return fromProps ? fromProps() === captured : true;
  };
  const 丢弃跨档提交 = () => {
    setMessage('已切换存档，本次图片操作的结果未写入当前存档。');
    return false;
  };
  const 提交相册 = useCallback((action: React.SetStateAction<相册系统>) => {
    if (!提交仍属于本会话()) return 丢弃跨档提交();
    readAlbumHandlerRef.current(action);
    return true;
  }, []);
  const 提交旅人 = useCallback((action: React.SetStateAction<角色数据结构>) => {
    if (!提交仍属于本会话()) return 丢弃跨档提交();
    readTravelerHandlerRef.current(action);
    return true;
  }, []);
  const 提交NPC列表 = useCallback((action: React.SetStateAction<NPC记录[]>) => {
    if (!提交仍属于本会话()) return 丢弃跨档提交();
    readNpcHandlerRef.current(action);
    return true;
  }, []);

  const recoverAlbumTasks = useCallback(() => {
    提交相册((prev) => {
      const liveIds = new Set(globalImageTaskQueue.runningIds());
      return {
        ...prev,
        tasks: recoverInterruptedTasks(recoverStaleTasks(prev.tasks), liveIds),
      };
    });
  }, [提交相册]);

  useEffect(() => {
    globalImageTaskQueue.setConcurrency(imageSettings.并发数 ?? 1);
    // 挂载即恢复：页面重启后旧的 running 任务没有实际 worker，立即标记中断；
    // 之后再周期性兜底超过 10 分钟的残留任务。
    recoverAlbumTasks();
    const timer = window.setInterval(recoverAlbumTasks, 30 * 1000);
    return () => window.clearInterval(timer);
  }, [recoverAlbumTasks, imageSettings.并发数]);
  const [lastTaskId, setLastTaskId] = useState<string | null>(null);
  const [generateTarget, setGenerateTarget] = useState<GenerateTarget>('npc_avatar');
  const [sizePreset, setSizePreset] = useState<'default' | '1:1' | '3:4' | '16:9' | 'custom'>('default');
  const [customSize, setCustomSize] = useState('');
  const [extraRequirement, setExtraRequirement] = useState('');
  const [selectedCharacterId, setSelectedCharacterId] = useState('');
  const [tokenizing, setTokenizing] = useState(false);
  const [sceneText, setSceneText] = useState('');
  const [sceneImageText, setSceneImageText] = useState('');
  const [sceneImageSummary, setSceneImageSummary] = useState<SceneImageSummary | null>(null);
  const [sceneImageAnalyzing, setSceneImageAnalyzing] = useState(false);
  const [storySnapshotSource, setStorySnapshotSource] = useState<StorySnapshotSource>('latest_assistant');
  const [storySnapshotDraft, setStorySnapshotDraft] = useState('');
  const [storySnapshotSummary, setStorySnapshotSummary] = useState<StorySnapshotSummary | null>(null);
  const [storySnapshotContext, setStorySnapshotContext] = useState<StorySnapshotRenderContext | null>(null);
  const [novelAIOverrides, setNovelAIOverrides] = useState<NovelAITaskOverrides>({});
  const [storySnapshotAnalyzing, setStorySnapshotAnalyzing] = useState(false);
  const [libraryNpcId, setLibraryNpcId] = useState('');
  const [anchorSelection, setAnchorSelection] = useState<AnchorSelection>('traveler');
  const [anchorExtractingTarget, setAnchorExtractingTarget] = useState<AnchorSelection | null>(null);
  const [anchorBatchExtracting, setAnchorBatchExtracting] = useState(false);
  const [travelerAnchorRequirement, setTravelerAnchorRequirement] = useState('');
  const [anchorRequirement, setAnchorRequirement] = useState('');
  const [archiveProgress, setArchiveProgress] = useState<AlbumOperationProgress | null>(null);
  const [albumUpdatePending, startAlbumUpdate] = useTransition();
  const nsfwVisible = nsfwEnabled && nsfwImageEnabled;
  const albumOperationBusy = Boolean(archiveProgress) || albumUpdatePending;
  const albumOperationLabel = archiveProgress
    ? albumOperationStageLabel(archiveProgress)
    : albumUpdatePending
      ? '正在更新图库…'
      : '';

  const assetMap = useMemo(() => new Map(album.assets.map((asset) => [asset.id, asset])), [album.assets]);
  const activeEntry = album.entries.find((entry) => entry.id === activeEntryId) ?? album.entries[0] ?? null;
  const companions = npcs.filter((npc) => npc.阶位 === 'companion');
  const resourceEntries = useMemo(
    () => buildAlbumResourceEntries(album, assetMap, nsfwVisible && showNsfw),
    [album, assetMap, nsfwVisible, showNsfw],
  );
  const sceneLibraryEntries = useMemo(() => buildSceneLibraryEntries(album, assetMap), [album, assetMap]);
  const storySnapshotSourceOptions = useMemo(() => buildStorySnapshotSourceOptions(mainChatHistory), [mainChatHistory]);
  const importCurrentBodyText = () => {
    const latestAssistant = [...mainChatHistory]
      .reverse()
      .find((message) => message.role === 'assistant' && message.content.trim());
    const text = trimStorySnapshotSource(latestAssistant?.content ?? '');
    if (!text) {
      setMessage('暂无可导入正文。');
      return;
    }
    setSceneImageText(text);
    setMessage('已导入当前正文。');
  };
  useEffect(() => {
    if (storySnapshotDraft.trim()) return;
    const initial = storySnapshotSourceOptions.find((option) => option.id === storySnapshotSource)?.text || storySnapshotSourceOptions[0]?.text || '';
    if (initial) setStorySnapshotDraft(initial);
  }, [storySnapshotDraft, storySnapshotSource, storySnapshotSourceOptions]);
  const libraryRecords = useMemo(
    () => buildCharacterLibraryRecords(traveler, npcs, album, assetMap, nsfwVisible && showNsfw),
    [traveler, npcs, album, assetMap, nsfwVisible, showNsfw],
  );
  const activeLibraryRecord = libraryRecords.find((record) => record.id === libraryNpcId) ?? libraryRecords[0] ?? null;
  const persistGameSettingsChange = (next: 游戏设置) => {
    onGameSettingsChange(next);
    void saveSetting('gameSettings', next);
  };

  const setReferenceInjectionEnabled = (enabled: boolean) => {
    persistGameSettingsChange({
      ...gameSettings,
      文生图系统: {
        ...imageSettings,
        参考图: {
          ...imageSettings.参考图,
          enabled,
        },
      },
    });
    setMessage(enabled ? '已开启参考图注入。' : '已关闭参考图注入，生成时不会读取或发送参考图。');
  };

  const setOpenAICompatibleReferenceEnabled = (enabled: boolean) => {
    persistGameSettingsChange({
      ...gameSettings,
      文生图系统: {
        ...imageSettings,
        参考图: {
          ...imageSettings.参考图,
          enableOpenAICompatibleReference: enabled,
        },
      },
    });
    setMessage(enabled
      ? '已允许 OpenAI 兼容接口发送参考图。'
      : '已关闭 OpenAI 兼容参考图发送。');
  };

  const addAlbumItem = (item: ReturnType<typeof 创建相册图片条目>) => {
    提交相册((prev) => 添加图片到相册(prev, item));
    setActiveEntryId(item.entry.id);
    setActiveTab('gallery');
    setMessage('图片已加入相册。');
  };

  const clearPromptDraft = () => {
    setPrompt('');
    setNegativePrompt('');
    setLastPromptMeta(null);
    setStorySnapshotContext(null);
    setNovelAIOverrides({});
  };

  const invalidatePromptDraft = (reason: string) => {
    clearPromptDraft();
    setPromptEditorOpen(false);
    setMessage(reason);
  };

  const uploadReferenceImages = async (files: FileList | null, record: CharacterLibraryRecord | null) => {
    if (!files?.length || !record) return;
    const file = Array.from(files).find((item) => item.type.startsWith('image/'));
    if (!file) {
      setMessage('没有找到可导入的图片文件。');
      return;
    }
    let src: string;
    let contentHash: string;
    try {
      src = await fileToDataUrl(file);
      const decoded = dataUrlToBytes(src);
      if (!decoded) throw new Error('无法读取图片字节');
      contentHash = await sha256Bytes(decoded.bytes);
    } catch {
      setMessage('导入失败：图片未能读取或超过 12MB。');
      return;
    }

    // ── 准备阶段与提交阶段分离（P1-B03）──────────────────────────────────────
    // 这里经历文件读取 + 两次摘要 + hydrate 一共多次 await。此前最终提交用的是
    // **这段等待开始时的闭包旧相册**派生的整份对象，于是等待期间新增的生成图片、
    // 删除操作都会被整份回滚（审查者实测：新增图片在上传结束后消失）。
    // 现在只准备「要加的那一条」与 hydrate 出来的 hash 增量，最终合并放进函数式更新里，
    // 以**当前**相册为基准（`setAlbum(prev => ...)`）。
    const preparedAlbum = await hydrateAlbumContentHashes(albumRef.current);
    const hydratedHashes = new Map(
      preparedAlbum.assets.map((asset) => [asset.id, normalizeContentHash(asset.contentHash)]),
    );
    const item = 创建相册图片条目({
      title: `${record.name} 参考图`,
      src,
      source: 'upload',
      targetType: record.kind === 'traveler' ? 'traveler' : 'npc',
      targetId: record.id,
      slot: 'misc',
      mimeType: file.type,
      contentHash,
      tags: ['参考图'],
      note: '手动上传参考图',
      referenceTargets: [record.id],
    });
    // 复用判定按「现在」的相册预览一次，只用于提示文案与选中项；真正的写入仍是函数式合并。
    const preview = addOrReuseAlbumImage(albumRef.current, item, contentHash, src);
    提交相册((prev) => {
      // hydrate 只补 contentHash（不改条目集合），所以把它当作增量合并进当前相册，
      // 既保留去重能力，又不会覆盖等待期间发生的其它改动。
      const base = mergeHydratedContentHashes(prev, hydratedHashes);
      const upserted = addOrReuseAlbumImage(base, item, contentHash, src);
      return {
        ...upserted.album,
        entries: setEntryReferenceTargets(upserted.album.entries, upserted.entry.id, record.id, true),
      };
    });
    setActiveEntryId(preview.entry.id);
    setMessage(preview.reused
      ? `已复用图库中的相同图片并设为 ${record.name} 的参考图。`
      : `已导入并替换 ${record.name} 的参考图。`);
  };

  const setEntryReference = (entryId: string, record: CharacterLibraryRecord, enabled: boolean) => {
    提交相册((prev) => ({
      ...prev,
      entries: setEntryReferenceTargets(prev.entries, entryId, record.id, enabled),
    }));
    setMessage(enabled ? `已替换为 ${record.name} 的参考图。` : `已取消 ${record.name} 的参考图。`);
  };

  const patchImageRules = (patch: Partial<文生图规则中心设置>) => {
    onGameSettingsChange((prev) => ({
      ...prev,
      文生图系统: {
        ...prev.文生图系统,
        rules: {
          ...prev.文生图系统.rules,
          ...patch,
        },
      },
    }));
  };

  const persistImageRulesPatch = (patch: Partial<文生图规则中心设置>) => {
    const nextSettings: 游戏设置 = {
      ...gameSettings,
      文生图系统: {
        ...imageSettings,
        rules: {
          ...imageSettings.rules,
          ...patch,
        },
      },
    };
    persistGameSettingsChange(nextSettings);
  };

  const handleSaveRules = async () => {
    const nextSettings: 游戏设置 = {
      ...gameSettings,
      文生图系统: imageSettings,
    };
    try {
      await saveSetting('gameSettings', nextSettings);
      setMessage('规则中心已保存。');
    } catch (err) {
      setMessage(`规则中心保存失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const resolveStorySnapshotParserConfig = () => buildImagePromptTokenizerConfig(gameSettings, apiSettings);

  const resolveCharacterAnchorExtractConfig = () => {
    const mainApi = apiSettings.configs.find((item) => item.id === apiSettings.activeConfigId) ?? apiSettings.configs[0];
    if (!mainApi) return null;
    const override = imageSettings.词组转化器API;
    return {
      ...mainApi,
      id: '__character_anchor_extract__',
      name: '角色视觉锚点提取',
      provider: override.provider || mainApi.provider,
      baseUrl: override.baseUrl.trim() || mainApi.baseUrl,
      apiKey: override.apiKey.trim() || mainApi.apiKey,
      model: override.model.trim() || mainApi.model,
      maxTokens: override.maxTokens ?? mainApi.maxTokens ?? 1600,
      temperature: override.temperature ?? mainApi.temperature ?? 0.35,
      retryCount: override.retryCount ?? mainApi.retryCount ?? 1,
      enableClaudeMode: gameSettings.enableClaudeMode === true,
      updatedAt: Date.now(),
    };
  };

  const currentTarget = generateTargets.find((item) => item.id === generateTarget) ?? generateTargets[0];
  const resolvedSize = resolveSize(sizePreset, customSize, currentTarget.slot);
  const currentCanvasTargetId = resolveGenerationTargetId(currentTarget, undefined, selectedCharacterId);
  const currentCanvasTask = useMemo(() => {
    const byLastTask = lastTaskId ? album.tasks.find((item) => item.id === lastTaskId) : undefined;
    const matchesCurrentTarget = (item: 图片生成任务) =>
      item.slot === currentTarget.slot &&
      item.targetType === currentTarget.targetType &&
      (!currentCanvasTargetId || !item.targetId || item.targetId === currentCanvasTargetId);
    if (byLastTask && matchesCurrentTarget(byLastTask)) return byLastTask;
    return album.tasks.find(matchesCurrentTarget);
  }, [album.tasks, currentTarget.slot, currentTarget.targetType, currentCanvasTargetId, lastTaskId]);
  const currentCanvasAsset = currentCanvasTask?.resultAssetId ? assetMap.get(currentCanvasTask.resultAssetId) : undefined;
  const currentCanvasSrc = 解析相册资源地址(currentCanvasAsset) || '';
  const currentCanvasEntry = currentCanvasTask?.resultAssetId ? album.entries.find((entry) => entry.assetId === currentCanvasTask.resultAssetId) : undefined;
  const currentGenerationRecord = currentTarget.targetType === 'traveler'
    ? libraryRecords.find((record) => record.kind === 'traveler') ?? null
    : libraryRecords.find((record) => record.id === selectedCharacterId) ?? null;
  const currentResultIsReference = Boolean(currentCanvasEntry && currentGenerationRecord && 图片是否参考角色(currentCanvasEntry, currentGenerationRecord.id));
  const currentReferenceStatus = evaluateReferenceInjection({
    target: currentTarget,
    targetId: currentCanvasTargetId,
    api: currentTarget.nsfw ? imageSettings.NSFW接口 : imageSettings.普通接口,
    settings: imageSettings.参考图,
    album,
  }).status;
  const nonCharacterReferenceStatus = evaluateReferenceInjection({
    target: generateTargets.find((item) => item.id === 'scene') ?? currentTarget,
    api: imageSettings.普通接口,
    settings: imageSettings.参考图,
    album,
  }).status;
  const storySnapshotCompiledPayload = useMemo(() => {
    const api = applyNovelAIRulePreset(imageSettings.普通接口, imageSettings.rules);
    if (api.backend !== 'novelai' || !storySnapshotContext || !prompt.trim()) return null;
    return buildNovelAIRequestPayload(api, {
      prompt,
      negativePrompt,
      size: resolveSize(sizePreset, customSize, 'scene'),
      storySnapshotContext,
      novelAIOverrides,
    }, 0);
  }, [customSize, imageSettings.普通接口, imageSettings.rules, negativePrompt, novelAIOverrides, prompt, sizePreset, storySnapshotContext]);

  const handleGenerate = async (_requestedNsfw = false, override?: GenerateOverride) => {
    const target = override?.target ?? currentTarget;
    const nsfw = target.nsfw === true;
    const targetSize = override?.size ?? (override?.target ? resolveSize(sizePreset, customSize, target.slot) : resolvedSize);
    let promptText = override?.prompt ?? prompt;
    let negativeText = override?.negativePrompt ?? negativePrompt;
    const titleText = override?.title ?? generateTitle;
    const resolvedTargetId = resolveGenerationTargetId(target, override?.targetId, selectedCharacterId);
    const entryTags = override?.tags ?? defaultAlbumEntryTags(target);
    const entryNote = override?.note ?? defaultAlbumEntryNote(target);
    if (requiresCharacterTarget(target) && !resolvedTargetId) {
      setMessage('请先选择角色，再生成图片。');
      return;
    }
    if (!imageSettings.enabled) {
      setMessage('请先在设置里启用文生图。');
      return;
    }
    if (nsfw && !nsfwVisible) {
      setMessage('NSFW 生图未开启。');
      return;
    }
    let taskAnchorMode = override?.anchorMode ?? lastPromptMeta?.anchorMode ?? false;
    let taskAnchorSummary = override?.anchorSummary ?? lastPromptMeta?.anchorSummary ?? '';
    let sourcePrompt = override?.sourcePrompt ?? lastPromptMeta?.sourcePrompt ?? promptText;
    if (!promptText.trim()) {
      const built = await buildPromptForTarget(target);
      if (!built) return;
      promptText = built.prompt;
      negativeText = negativeText || built.negative;
      taskAnchorMode = built.anchorMode;
      taskAnchorSummary = built.anchorSummary;
      sourcePrompt = built.sourcePrompt;
      setPrompt(promptText);
      setNegativePrompt((prev) => prev || built.negative);
      setLastPromptMeta({ anchorMode: built.anchorMode, anchorSummary: built.anchorSummary, sourcePrompt: built.sourcePrompt });
    }
    const rawApi = override?.imageApi ?? (nsfw
      ? imageSettings.NSFW接口
      : imageSettings.普通接口);
    const api = applyNovelAIRulePreset(rawApi, imageSettings.rules);
    if (!api.enabled) {
      setMessage(override?.disabledMessage || '当前文生图接口未启用。');
      return;
    }
    const referencePayload = resolveReferenceImagesForGeneration({
      target,
      targetId: resolvedTargetId,
      api,
      settings: imageSettings.参考图,
      album,
      assetMap,
    });
    const task = createTask({
      source: override?.source ?? 'manual',
      prompt: promptText,
      negativePrompt: negativeText,
      sourcePrompt,
      finalPrompt: promptText,
      finalNegativePrompt: negativeText,
      anchorMode: taskAnchorMode,
      anchorSummary: taskAnchorSummary,
      nsfw,
      backend: api.backend,
      slot: target.slot,
      targetType: target.targetType,
      targetId: resolvedTargetId,
      dimensions: targetSize,
      referenceImageIds: referencePayload.entries.map((entry) => entry.id),
      storySnapshotContext: override?.storySnapshotContext,
      novelAIOverrides: override?.novelAIOverrides,
    });
    setLastTaskId(task.id);
    提交相册((prev) => ({ ...prev, tasks: [{ ...task, status: 'queued' }, ...prev.tasks] }));
    setGenerating(true);
    setMessage(override?.statusMessage || (nsfw ? '正在调用 NSFW 独立接口...' : '正在调用文生图接口...'));
    try {
      const queueResult = await globalImageTaskQueue.createRunner((_taskId, signal) => runImageGenerationWithRetry(
        (innerSignal) => generateImage(api, {
          prompt: promptText,
          negativePrompt: negativeText,
          nsfw,
          size: targetSize,
          referenceImages: referencePayload.images,
          referenceStrength: imageSettings.参考图.sdWebuiDenoisingStrength,
          storySnapshotContext: override?.storySnapshotContext,
          novelAIOverrides: override?.novelAIOverrides,
          signal: innerSignal,
        }),
        {
          maxRetries: api.retryCount,
          onAttempt: (attempt, total) => {
            提交相册((prev) => ({
              ...prev,
              tasks: prev.tasks.map((old) =>
                old.id === task.id
                  ? { ...old, status: 'running', retryCount: attempt - 1, error: attempt > 1 ? `正在重试：${attempt}/${total}` : undefined }
                  : old,
              ),
            }));
            setMessage(referencePayload.images.length
              ? (total > 1 ? `正在参考图片生成（${attempt}/${total}）...` : '正在参考图片生成...')
              : (total > 1 ? `正在生成图片（${attempt}/${total}）...` : '正在生成图片...'));
          },
          onRetry: (attempt, total, errorMessage) => {
            提交相册((prev) => ({
              ...prev,
              tasks: prev.tasks.map((old) =>
                old.id === task.id
                  ? { ...old, status: 'running', retryCount: attempt, error: `第 ${attempt}/${total} 次失败：${errorMessage}` }
                  : old,
              ),
            }));
            setMessage(`生成失败，正在自动重试（${attempt}/${total}）：${errorMessage}`);
          },
        signal,
      },
      ))(task.id);
      const result = queueResult.status === 'failed'
        ? null
        : (queueResult.value as Awaited<ReturnType<typeof generateImage>> | null);
      if (!result) throw new Error(queueResult.error ?? '文生图失败。');
      const item = 创建相册图片条目({
        title: titleText || target.label,
        src: result.src,
        source: 'generated',
        nsfw,
        targetType: target.targetType,
        targetId: resolvedTargetId,
        slot: target.slot,
        prompt: result.finalPrompt ?? promptText,
        negativePrompt: result.finalNegativePrompt ?? negativeText,
        sourcePrompt,
        finalPrompt: result.finalPrompt ?? promptText,
        finalNegativePrompt: result.finalNegativePrompt ?? negativeText,
        anchorMode: taskAnchorMode,
        anchorSummary: taskAnchorSummary,
        dimensions: result.width && result.height ? `${result.width}x${result.height}` : targetSize,
        model: result.model,
        backend: result.backend,
        mimeType: result.mimeType,
        originalUrl: result.originalUrl,
        tags: entryTags,
        note: entryNote,
      });
      提交相册((prev) => ({
        ...添加图片到相册(prev, item),
        tasks: prev.tasks.map((old) => old.id === task.id ? { ...old, status: 'success', finalPrompt: result.finalPrompt ?? promptText, finalNegativePrompt: result.finalNegativePrompt ?? negativeText, resultAssetId: item.asset.id, finishedAt: Date.now() } : old),
      }));
      setActiveEntryId(item.entry.id);
      setMessage(result.promptCompacted ? '图片已生成并加入相册；发送前已自动精简，实际提示词已保存在图片详情中。' : '图片已生成并加入相册。');
    } catch (err) {
      const error = readImageError(err);
      提交相册((prev) => ({
        ...prev,
        tasks: prev.tasks.map((old) => old.id === task.id ? { ...old, status: 'failed', error, finishedAt: Date.now() } : old),
      }));
      setMessage(`生成失败：${error}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleCancelTask = (taskId: string) => {
    globalImageTaskQueue.cancel(taskId);
    提交相册((prev) => ({
      ...prev,
      tasks: prev.tasks.map((item) =>
        item.id === taskId
          ? { ...item, status: 'cancelled' as const, finishedAt: Date.now(), error: '任务已取消。' }
          : item,
      ),
    }));
  };

  const handleRetryTask = (task?: 图片生成任务) => {
    const target = task ?? album.tasks.find((item) => item.id === lastTaskId) ?? album.tasks.find((item) => item.status === 'failed');
    if (!target) {
      setMessage('没有可重试的失败任务。');
      return;
    }
    setPrompt(target.prompt);
    setNegativePrompt(target.negativePrompt ?? '');
    setGenerateTitle('重试生成');
    setLastPromptMeta({
      anchorMode: target.anchorMode === true,
      anchorSummary: target.anchorSummary || (target.anchorMode ? '沿用上次角色锚点' : '沿用上次档案回退结果'),
      sourcePrompt: target.sourcePrompt,
    });
    void handleGenerate(target.nsfw, {
      source: 'retry',
      prompt: target.prompt,
      negativePrompt: target.negativePrompt,
      title: '重试生成',
      target: generateTargets.find((item) => item.targetType === target.targetType && item.slot === target.slot),
      targetId: target.targetId,
      anchorMode: target.anchorMode,
      anchorSummary: target.anchorSummary,
      sourcePrompt: target.sourcePrompt,
      storySnapshotContext: target.storySnapshotContext,
      novelAIOverrides: target.novelAIOverrides,
    });
  };

  const mountSelectedToCharacter = (params: { targetKind: CharacterLibraryRecord['kind']; targetId: string; entryId: string; src: string; slot: 图片槽位 }) => {
    const entry = album.entries.find((item) => item.id === params.entryId);
    const isBuiltinEntry = params.entryId.startsWith('builtin-avatar:');
    if (!entry && !isBuiltinEntry) return;
    const sourceLabel = isBuiltinEntry ? '原著' : '文生图';
    const mountedSrc = entry ? 创建相册资源引用(entry.assetId) : params.src;
    if (params.targetKind === 'traveler') {
      if (params.slot === 'portrait') {
        提交旅人((prev) => 挂载旅人图片(prev, { slot: '立绘', src: mountedSrc }));
      } else if (params.slot.toString().startsWith('nsfw_')) {
        setMessage('旅人档案暂不支持挂载 NSFW 部位图。');
        return;
      } else {
        提交旅人((prev) => 挂载旅人图片(prev, { slot: mapImageSlotToTravelerSlot(params.slot), src: mountedSrc }));
      }
      if (entry) {
        提交相册((prev) => ({
          ...prev,
          entries: prev.entries.map((item) =>
            item.id === params.entryId
              ? {
                  ...item,
                  targetType: 'traveler',
                  targetId: params.targetId,
                  slot: params.slot,
                }
              : item,
          ),
        }));
      }
      setMessage(`已挂载到 ${slotLabel(params.slot)}。`);
      return;
    }
    if (params.slot === 'portrait') {
      提交NPC列表((prev) => 挂载NPC立绘图片(prev, { npcId: params.targetId, src: mountedSrc, source: sourceLabel }));
    } else if (params.slot === 'nsfw_female_chest') {
      提交NPC列表((prev) => 挂载NPC_NSFW部位图片(prev, { npcId: params.targetId, slot: '女性胸部', src: mountedSrc }));
    } else if (params.slot === 'nsfw_female_genital') {
      提交NPC列表((prev) => 挂载NPC_NSFW部位图片(prev, { npcId: params.targetId, slot: '女性私处', src: mountedSrc }));
    } else if (params.slot === 'nsfw_male_genital') {
      if (!gameSettings.enableMaleNsfwArchive) {
        setMessage('男性 NSFW 档案未开启，不能挂载男性器部位图。');
        return;
      }
      // 女角色的档案不接收男性器部位图（玩家要求）。
      if (npcs.find((npc) => npc.id === params.targetId)?.性别 === '女') {
        setMessage('女角色的 NSFW 档案不挂载男性器部位图。');
        return;
      }
      提交NPC列表((prev) => 挂载NPC_NSFW部位图片(prev, { npcId: params.targetId, slot: '男性器', src: mountedSrc }));
    } else if (params.slot === 'nsfw_rear') {
      提交NPC列表((prev) => 挂载NPC_NSFW部位图片(prev, { npcId: params.targetId, slot: '后庭', src: mountedSrc }));
    } else if (params.slot === 'nsfw_body_reference') {
      提交NPC列表((prev) => 挂载NPC_NSFW部位图片(prev, { npcId: params.targetId, slot: '体态参考', src: mountedSrc }));
    } else {
      提交NPC列表((prev) => 挂载NPC头像图片(prev, { npcId: params.targetId, slot: mapImageSlotToNpcAvatarSlot(params.slot), src: mountedSrc, source: sourceLabel }));
    }
    if (entry) {
      提交相册((prev) => ({
        ...prev,
        entries: prev.entries.map((item) =>
          item.id === params.entryId
            ? {
                ...item,
                targetType: params.slot.toString().startsWith('nsfw_') ? 'nsfw_part' : 'npc',
                targetId: params.targetId,
                slot: params.slot,
                nsfw: item.nsfw || params.slot.toString().startsWith('nsfw_'),
              }
            : item,
        ),
      }));
    }
    setMessage(`已挂载到 ${slotLabel(params.slot)}。`);
  };

  const deleteLibraryEntries = async (entryIds: string[]) => {
    if (albumOperationBusy) return;
    const ids = Array.from(new Set(entryIds)).filter(Boolean);
    if (!ids.length) {
      setMessage('请先选择要删除的图片。');
      return;
    }
    if (!await askConfirm({
      title: '删除图片',
      message: `确定删除选中的 ${ids.length} 张图片？删除后无法找回。`,
      confirmLabel: `删除 ${ids.length} 张`,
      tone: 'danger',
    })) return;
    const idSet = new Set(ids);
    setMessage(`正在删除 ${ids.length} 张图片…`);
    startAlbumUpdate(() => {
      提交相册((prev) => cleanupAlbumAssets({
        ...prev,
        entries: prev.entries.filter((entry) => !idSet.has(entry.id)),
      }));
      setActiveEntryId((current) => (current && idSet.has(current) ? null : current));
      setMessage(`已删除 ${ids.length} 张图片。`);
    });
  };

  const setLibraryEntryToSlot = (params: { record: CharacterLibraryRecord | null; entryId: string; src: string; slot: 图片槽位 }) => {
    const record = params.record;
    if (!record) {
      setMessage('请先选择一个角色。');
      return;
    }
    const scopedEntries = [...record.entries, ...resourceEntries];
    const item = scopedEntries.find((entry) => entry.entry.id === params.entryId);
    const src = item?.src || params.src;
    if (!src) {
      setMessage('请选择一张可用图片。');
      return;
    }
    mountSelectedToCharacter({
      targetKind: record.kind,
      targetId: record.id,
      entryId: params.entryId,
      src,
      slot: params.slot,
    });
  };

  const openCurrentResultInGallery = () => {
    if (currentCanvasEntry) setActiveEntryId(currentCanvasEntry.id);
    setActiveTab('gallery');
  };

  const setCurrentResultAsReference = () => {
    if (!currentCanvasEntry || !currentGenerationRecord) return;
    setEntryReference(currentCanvasEntry.id, currentGenerationRecord, true);
  };

  const mountCurrentResultToDefaultSlot = () => {
    if (!currentCanvasEntry || !currentGenerationRecord || !currentCanvasSrc) return;
    if (currentTarget.targetType !== 'traveler' && currentTarget.targetType !== 'npc') return;
    setLibraryEntryToSlot({
      record: currentGenerationRecord,
      entryId: currentCanvasEntry.id,
      src: currentCanvasSrc,
      slot: currentTarget.slot,
    });
  };

  const saveNpcAnchor = (npcId: string, patch: NonNullable<NPC记录['图像档案']>['角色锚点']) => {
    提交NPC列表((prev) => prev.map((npc) => {
      if (npc.id !== npcId) return npc;
      return {
        ...npc,
        图像档案: {
          ...(npc.图像档案 ?? {}),
          角色锚点: {
            ...(npc.图像档案?.角色锚点 ?? {}),
            ...(patch ?? {}),
            id: patch?.id || npc.图像档案?.角色锚点?.id || `anchor_${npcId}_${Date.now()}`,
            名称: patch?.名称 || npc.图像档案?.角色锚点?.名称 || npc.姓名,
            来源: patch?.来源 || npc.图像档案?.角色锚点?.来源 || 'manual',
            createdAt: npc.图像档案?.角色锚点?.createdAt || Date.now(),
            updatedAt: Date.now(),
          },
        },
      };
    }));
    invalidatePromptDraft('角色锚点已保存，当前生成草稿已清空，请重新生成。');
  };

  const deleteNpcAnchor = (npcId: string) => {
    提交NPC列表((prev) => prev.map((npc) => {
      if (npc.id !== npcId) return npc;
      return {
        ...npc,
        图像档案: {
          ...(npc.图像档案 ?? {}),
          角色锚点: undefined,
        },
      };
    }));
    invalidatePromptDraft('角色锚点已删除，当前生成草稿已清空，请重新生成。');
  };

  const extractNpcAnchor = async (npcId: string, requirement: string) => {
    const npc = npcs.find((item) => item.id === npcId);
    if (!npc) return;
    const config = resolveCharacterAnchorExtractConfig();
    if (!config) {
      setMessage('角色锚点提取模型未配置：请先在 API 设置里启用一个可用模型。');
      return;
    }
    setAnchorExtractingTarget(npcId);
    setMessage(`正在 AI 提取 ${npc.姓名} 的角色锚点...`);
    try {
      const anchor = await extractCharacterAnchorWithAI(config, {
        name: npc.姓名,
        kind: 'npc',
        sourceText: [npc.外貌, npc.穿着, npc.装备摘要, npc.图像档案?.头像提示词, npc.图像档案?.立绘提示词].filter(Boolean).join('\n'),
        requirement,
      });
      saveNpcAnchor(npcId, anchor);
      invalidatePromptDraft(`已 AI 提取并保存 ${npc.姓名} 的角色锚点，当前生成草稿已清空，请重新生成。`);
    } catch (err) {
      setMessage(`角色锚点 AI 提取失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAnchorExtractingTarget((current) => (current === npcId ? null : current));
    }
  };

  const saveTravelerAnchor = (patch: NPC角色锚点档案 | undefined) => {
    提交旅人((prev) => ({
      ...prev,
      图像档案: {
        ...(prev.图像档案 ?? {}),
        角色锚点: {
          ...(prev.图像档案?.角色锚点 ?? {}),
          ...(patch ?? {}),
          id: patch?.id || prev.图像档案?.角色锚点?.id || `anchor_traveler_${Date.now()}`,
          名称: patch?.名称 || prev.图像档案?.角色锚点?.名称 || prev.姓名 || '旅人',
          来源: patch?.来源 || prev.图像档案?.角色锚点?.来源 || 'manual',
          createdAt: prev.图像档案?.角色锚点?.createdAt || Date.now(),
          updatedAt: Date.now(),
        },
      },
    }));
    invalidatePromptDraft('主控锚点已保存，当前生成草稿已清空，请重新生成。');
  };

  const deleteTravelerAnchor = () => {
    提交旅人((prev) => ({
      ...prev,
      图像档案: {
        ...(prev.图像档案 ?? {}),
        角色锚点: undefined,
      },
    }));
    invalidatePromptDraft('主控锚点已删除，当前生成草稿已清空，请重新生成。');
  };

  const extractTravelerAnchor = async (requirement: string) => {
    const config = resolveCharacterAnchorExtractConfig();
    if (!config) {
      setMessage('主控锚点提取模型未配置：请先在 API 设置里启用一个可用模型。');
      return;
    }
    setAnchorExtractingTarget('traveler');
    setMessage('正在 AI 提取主控锚点...');
    try {
      const anchor = await extractCharacterAnchorWithAI(config, {
        name: traveler.姓名 || '旅人',
        kind: 'traveler',
        sourceText: [traveler.性别, traveler.年龄 ? `${traveler.年龄}` : '', traveler.身高, traveler.身份, traveler.外貌, traveler.主元素, ...(traveler.能力 ?? [])].filter(Boolean).join('\n'),
        requirement,
      });
      saveTravelerAnchor(anchor);
      invalidatePromptDraft('已 AI 提取并保存主控锚点，当前生成草稿已清空，请重新生成。');
    } catch (err) {
      setMessage(`主控锚点 AI 提取失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAnchorExtractingTarget((current) => (current === 'traveler' ? null : current));
    }
  };

  const handleGenerateStorySnapshot = (nsfw = false, override?: GenerateOverride) => {
    const sceneTarget = generateTargets.find((item) => item.id === 'scene') ?? currentTarget;
    void handleGenerate(nsfw, {
      ...override,
      source: override?.source ?? (storySnapshotSource === 'manual' ? 'manual' : 'auto'),
      target: sceneTarget,
      size: resolveSize(sizePreset, customSize, sceneTarget.slot),
      tags: ['故事快照'],
      note: '故事快照',
      statusMessage: '正在调用主文生图接口...',
      disabledMessage: '请先在文生图设置中启用统一接口。',
      storySnapshotContext: override?.storySnapshotContext ?? storySnapshotContext ?? undefined,
      novelAIOverrides: override?.novelAIOverrides ?? novelAIOverrides,
    });
  };

  const handleRetryStorySnapshotTask = (task?: 图片生成任务) => {
    const target = task ?? currentCanvasTask;
    if (!target) {
      setMessage('没有可重试的故事快照任务。');
      return;
    }
    setPrompt(target.prompt);
    setNegativePrompt(target.negativePrompt ?? '');
    setGenerateTitle('重试生成');
    setStorySnapshotContext(target.storySnapshotContext ?? null);
    setNovelAIOverrides(target.novelAIOverrides ?? {});
    setLastPromptMeta({
      anchorMode: target.anchorMode === true,
      anchorSummary: target.anchorSummary || (target.anchorMode ? '沿用上次角色锚点' : '沿用上次档案回退结果'),
      sourcePrompt: target.sourcePrompt,
    });
    handleGenerateStorySnapshot(target.nsfw, {
      source: 'retry',
      prompt: target.prompt,
      negativePrompt: target.negativePrompt,
      title: '重试生成',
      anchorMode: target.anchorMode,
      anchorSummary: target.anchorSummary,
      sourcePrompt: target.sourcePrompt,
      size: target.dimensions || resolveSize(sizePreset, customSize, 'scene'),
      storySnapshotContext: target.storySnapshotContext,
      novelAIOverrides: target.novelAIOverrides,
    });
  };

  const applyTokenizerIfAvailable = async (input: {
    title: string;
    mode: string;
    sourceText: string;
    prompt: string;
    negative: string;
    anchorMode: boolean;
    anchorSummary: string;
    characters?: PromptCharacter[];
  }) => {
    const finalize = (value: { prompt: string; negative: string }) => ({ ...input, ...compactImagePrompts({ ...value, characters: input.characters }) });
    const tokenizerConfig = buildImagePromptTokenizerConfig(gameSettings, apiSettings);
    if (!tokenizerConfig) return finalize(input);
    setTokenizing(true);
    try {
      const refined = await tokenizeImagePrompt(
        tokenizerConfig,
        buildImagePromptTokenizerSystemPrompt(gameSettings, input.mode),
        {
          title: input.title,
          mode: input.mode,
          sourceText: input.sourceText,
          basePrompt: input.prompt,
          baseNegative: input.negative,
          extraRequirement,
          anchorMode: input.anchorMode,
          anchorSummary: input.anchorSummary,
          characters: input.characters,
        },
        tokenizerConfig.retryCount ?? 2,
      );
      setMessage('已通过词组转化器整理最终提示词。');
      return finalize(refined);
    } catch (err) {
      setMessage(`词组转化器失败，已自动精简本地提示词：${err instanceof Error ? err.message : String(err)}`);
      return finalize(input);
    } finally {
      setTokenizing(false);
    }
  };

  const buildPromptForTarget = async (target: typeof currentTarget, override?: { sceneText?: string }) => {
    if (target.tokenizerMode === 'scene') {
      const sourceSceneText = override?.sceneText ?? sceneText;
      const presentNpcs = buildPresentSceneNpcs(npcs, sourceSceneText).filter(npc => sourceSceneText.includes(npc.姓名) || Boolean(npc.别名 && sourceSceneText.includes(npc.别名)));
      const visibleTraveler = (traveler.姓名 && sourceSceneText.includes(traveler.姓名)) || (traveler.别名 && sourceSceneText.includes(traveler.别名)) ? traveler : undefined;
      const anchorInfo = getSceneAnchorStatus(traveler, presentNpcs);
      const built = buildSceneImagePrompt({
        text: sourceSceneText,
        mode: target.id === 'phone_wallpaper' ? 'phone_wallpaper' : 'scene',
        rules: imageSettings.rules,
        traveler: visibleTraveler,
        presentNpcs,
        extraRequirement,
        size: resolvedSize,
        slot: target.slot,
      });
      const refined = await applyTokenizerIfAvailable({
        title: target.label,
        mode: target.id,
        sourceText: buildSceneSourceText(sourceSceneText || target.desc, traveler, presentNpcs),
        prompt: built.prompt,
        negative: built.negative,
        anchorMode: anchorInfo.anchorMode,
        anchorSummary: anchorInfo.anchorSummary,
        characters: [...(visibleTraveler ? [readImagePromptCharacter(visibleTraveler, true)] : []), ...presentNpcs.map(npc => readImagePromptCharacter(npc, true))],
      });
      return { prompt: refined.prompt, negative: refined.negative, anchorMode: anchorInfo.anchorMode, anchorSummary: anchorInfo.anchorSummary, sourcePrompt: built.prompt };
    }
    if (target.targetType === 'traveler' || (target.nsfw && selectedCharacterId === 'traveler')) {
      const anchorInfo = getTravelerAnchorStatus(traveler);
      const built = buildTravelerImagePrompt({
        traveler,
        mode: target.nsfw ? 'nsfw' : target.tokenizerMode === 'portrait' ? 'portrait' : 'avatar',
        rules: imageSettings.rules,
        extraRequirement,
        size: resolvedSize,
      });
      const refined = await applyTokenizerIfAvailable({
        title: target.label,
        mode: target.id,
        sourceText: buildTravelerSourceText(traveler),
        prompt: built.prompt,
        negative: built.negative,
        anchorMode: anchorInfo.anchorMode,
        anchorSummary: anchorInfo.anchorSummary,
        characters: [readImagePromptCharacter(traveler)],
      });
      return { prompt: refined.prompt, negative: refined.negative, anchorMode: anchorInfo.anchorMode, anchorSummary: anchorInfo.anchorSummary, sourcePrompt: built.prompt };
    }
    const npc = npcs.find((item) => item.id === selectedCharacterId);
    if (!npc) {
      setMessage('请先选择一个伙伴。');
      return null;
    }
    const anchorInfo = getNpcAnchorStatus(npc);
    const built = buildNpcImagePrompt({
      npc,
      mode: target.nsfw ? 'nsfw' : target.tokenizerMode === 'portrait' ? 'portrait' : 'avatar',
      rules: imageSettings.rules,
      extraRequirement,
      size: resolvedSize,
    });
    const refined = await applyTokenizerIfAvailable({
      title: target.label,
      mode: target.id,
      sourceText: buildNpcSourceText(npc, { nsfw: target.nsfw }),
      prompt: built.prompt,
      negative: built.negative,
      anchorMode: anchorInfo.anchorMode,
      anchorSummary: anchorInfo.anchorSummary,
      characters: [readImagePromptCharacter(npc)],
    });
    return { prompt: refined.prompt, negative: refined.negative, anchorMode: anchorInfo.anchorMode, anchorSummary: anchorInfo.anchorSummary, sourcePrompt: built.prompt };
  };

  const handleBuildPrompt = async () => {
    try {
      const target = currentTarget;
      const built = await buildPromptForTarget(target);
      if (!built) return;
      setPrompt(built.prompt);
      setNegativePrompt(built.negative);
      setLastPromptMeta({ anchorMode: built.anchorMode, anchorSummary: built.anchorSummary, sourcePrompt: built.sourcePrompt });
      if (target.tokenizerMode === 'scene') {
        setGenerateTitle(sceneText.trim().slice(0, 16) || target.label);
      } else if (target.targetType === 'traveler' || (target.nsfw && selectedCharacterId === 'traveler')) {
        setGenerateTitle(`${traveler.姓名 || '旅人'}${target.label}`);
      } else {
        const npc = npcs.find((item) => item.id === selectedCharacterId);
        setGenerateTitle(`${npc?.姓名 || ''}${target.label}`);
      }
      setPromptEditorOpen(true);
      setMessage(`${built.anchorMode ? '已按角色锚点模式生成提示词。' : '已按档案回退模式生成提示词。'}已自动精简，可在高级编辑里微调。`);
    } catch (error) {
      setMessage(`提示词生成失败，已保留原草稿：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleBuildSceneImagePrompt = async () => {
    const sourceText = sceneImageText.trim();
    if (!sourceText) {
      setMessage('请先填写场景说明。');
      return;
    }
    const target = generateTargets.find((item) => item.id === 'scene') ?? currentTarget;
    setSceneImageAnalyzing(true);
    setMessage('正在解析场景画面...');
    try {
      const parserConfig = resolveStorySnapshotParserConfig();
      const presentNpcs = buildPresentSceneNpcs(npcs, sourceText);
      const anchorInfo = getSceneAnchorStatus(traveler, presentNpcs);
      let parsed: Awaited<ReturnType<typeof parseSceneImagePrompt>> | null = null;
      let usedLocalFallback = false;
      if (parserConfig) {
        try {
          parsed = await parseSceneImagePrompt(parserConfig, {
            body: sourceText,
            traveler: {
              ...readImagePromptParserCharacter(traveler),
              identity: traveler.身份 || undefined,
            },
            playerAppearanceMode: 'auto',
            presentNpcs: presentNpcs.map(readImagePromptParserCharacter),
          });
        } catch (error) {
          usedLocalFallback = true;
          const reason = error instanceof Error ? error.message : String(error);
          setMessage(`场景图模型解析失败，已改用本地草稿兜底：${reason}`);
        }
      } else {
        usedLocalFallback = true;
      }

      if (parsed) {
        const visibleText = `${parsed.subject}\n${parsed.prompt}`;
        const visibleNpcs = selectImagePromptSceneNpcs(presentNpcs, sourceText, visibleText);
        const visibleTraveler = (traveler.姓名 && visibleText.includes(traveler.姓名)) || (traveler.别名 && visibleText.includes(traveler.别名)) ? traveler : undefined;
        const characters = [...(visibleTraveler ? [readImagePromptCharacter(visibleTraveler, true)] : []), ...visibleNpcs.map(npc => readImagePromptCharacter(npc, true))];
        const lockedPrompt = 应用场景角色锚点锁({
          prompt: sanitizeImageModelPrompt(parsed.prompt, characters),
          negative: parsed.negativePrompt,
          traveler: visibleTraveler,
          presentNpcs: visibleNpcs,
        });
        const enhanced = 应用质量增强提示词(imageSettings.rules, lockedPrompt.prompt, lockedPrompt.negative);
        const summary: SceneImageSummary = {
          title: parsed.title,
          location: parsed.location,
          atmosphere: parsed.atmosphere,
          subject: parsed.subject,
          camera: parsed.camera,
          avoid: parsed.avoid,
        };
        const compacted = compactImagePrompts({ ...enhanced, characters });
        setSceneImageSummary(summary);
        setGenerateTitle(summary.title);
        setPrompt(compacted.prompt);
        setNegativePrompt(compacted.negative);
        setLastPromptMeta({ anchorMode: anchorInfo.anchorMode, anchorSummary: anchorInfo.anchorSummary, sourcePrompt: parsed.prompt });
        setPromptEditorOpen(false);
        setMessage('已完成场景图解析并自动精简提示词，可直接普通生成。');
        return;
      }

      const built = await buildPromptForTarget(target, { sceneText: sourceText });
      if (!built) return;
      setSceneImageSummary(null);
      setPrompt(built.prompt);
      setNegativePrompt(built.negative);
      setLastPromptMeta({ anchorMode: built.anchorMode, anchorSummary: built.anchorSummary, sourcePrompt: built.sourcePrompt });
      setGenerateTitle(sourceText.slice(0, 16) || target.label);
      setPromptEditorOpen(true);
      setMessage(usedLocalFallback ? '已用本地兜底草稿整理并自动精简场景图提示词，可在高级编辑里微调。' : '已完成场景图提示词整理并自动精简。');
    } catch (error) {
      setMessage(`场景提示词生成失败，已保留原草稿：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSceneImageAnalyzing(false);
    }
  };

  const handleBuildStorySnapshotPrompt = async () => {
    const sourceText = storySnapshotDraft.trim();
    if (!sourceText) {
      setMessage('请先选择或填写正文片段。');
      return;
    }
    setStorySnapshotAnalyzing(true);
    setMessage('正在解析正文画面...');
    try {
      const target = generateTargets.find((item) => item.id === 'scene') ?? currentTarget;
      const parserConfig = resolveStorySnapshotParserConfig();
      const presentNpcs = buildPresentSceneNpcs(npcs, sourceText);
      const anchorInfo = getSceneAnchorStatus(traveler, presentNpcs);
      const resolution = await resolveStorySnapshot({
        apiConfig: parserConfig,
        body: sourceText,
        traveler,
        presentNpcs,
        playerAppearanceMode: 'auto',
        rules: imageSettings.rules,
        extraRequirement,
        size: resolvedSize,
        slot: target.slot,
      });
      setNovelAIOverrides({});
      setSceneText('');
      setGenerateTitle(resolution.summary.title);
      setStorySnapshotSummary(resolution.summary);
      setStorySnapshotContext(resolution.renderContext);
      setSceneText(resolution.sceneText);
      setPrompt(resolution.prompt);
      setNegativePrompt(resolution.negativePrompt);
      setLastPromptMeta({
        anchorMode: anchorInfo.anchorMode,
        anchorSummary: anchorInfo.anchorSummary,
        sourcePrompt: resolution.sourcePrompt,
      });
      setPromptEditorOpen(false);
      setMessage(resolution.source === 'local'
        ? `模型解析未完成，已用本地草稿整理故事快照并自动精简提示词，可直接普通生成。${resolution.warning ? ` 原因：${resolution.warning.slice(0, 160)}` : ''}`
        : '已完成故事快照解析并自动精简提示词，可直接普通生成。');
    } catch (error) {
      setMessage(`快照提示词生成失败，已保留原草稿：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setStorySnapshotAnalyzing(false);
    }
  };

  const handleTargetChange = (next: GenerateTarget) => {
    setGenerateTarget(next);
    if (next === 'traveler_avatar' || next === 'npc_avatar') setSizePreset('1:1');
    if (next === 'traveler_portrait' || next === 'npc_portrait') setSizePreset((prev) => (prev === '1:1' ? '3:4' : prev));
    setGenerateTitle('');
    clearPromptDraft();
  };

  const handleManualTargetSelection = (purpose: 'avatar' | 'portrait' | 'nsfw', characterId: string) => {
    setSelectedCharacterId(characterId);
    if (purpose === 'nsfw') {
      handleTargetChange('nsfw_reference');
      return;
    }
    handleTargetChange(`${characterId === 'traveler' ? 'traveler' : 'npc'}_${purpose}` as GenerateTarget);
  };

  return (
    <div
      className="relative isolate min-h-0 pb-3"
      data-testid="album-content-layer"
      style={{ color: 'rgb(var(--tj-ui-body))' }}
    >
      <div className="grid min-h-0 gap-4 xl:h-[calc(100vh-220px)] xl:min-h-[560px] xl:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="relative z-[2] min-h-0 space-y-3 overflow-y-auto pr-1">
          <WorkspaceTabs
            activeTab={activeTab}
            setActiveTab={(tab) => {
              setActiveTab(tab);
              if (tab === 'scene') handleTargetChange('scene');
              if (tab === 'sceneImage') handleTargetChange('scene');
              if (tab === 'phone') handleTargetChange('phone_wallpaper');
              if (tab === 'manual' && (generateTarget === 'scene' || generateTarget === 'phone_wallpaper')) handleTargetChange('traveler_avatar');
            }}
          />
          <NsfwVisibilityToggle nsfwVisible={nsfwVisible} showNsfw={showNsfw} setShowNsfw={setShowNsfw} />
        </aside>

        <section className={`relative z-[2] min-h-0 min-w-0 pr-1 ${activeTab === 'gallery' ? 'xl:overflow-hidden' : 'overflow-y-auto'}`}>
          <main className={activeTab === 'gallery' ? 'h-full min-h-0 min-w-0' : 'min-w-0'}>
            {(['manual', 'scene', 'sceneImage', 'phone'] as WorkTab[]).includes(activeTab) && <ImagePromptLibraryPicker
              disabled={generating || tokenizing || storySnapshotAnalyzing || sceneImageAnalyzing}
              onApply={selection => {
                setPrompt(previous => appendImagePromptFragments(previous, selection.positive ?? ''));
                setNegativePrompt(previous => appendImagePromptFragments(previous, selection.negative ?? ''));
                if (activeTab === 'scene') setStorySnapshotContext(previous => applyImagePromptSelection({ prompt: '', negative: '', context: previous }, selection).context ?? null);
                setPromptEditorOpen(true);
              }}
            />}
            {activeTab === 'gallery' && (
              <ImageLibraryWorkspace
                records={libraryRecords}
                album={album}
                activeRecord={activeLibraryRecord}
                activeEntryId={activeEntryId ?? undefined}
                resourceEntries={resourceEntries}
                sceneEntries={sceneLibraryEntries}
                traveler={traveler}
                onSelectRecord={(id) => {
                  setLibraryNpcId(id);
                  setActiveEntryId(null);
                }}
                onSelectEntry={setActiveEntryId}
                onDeleteEntries={deleteLibraryEntries}
                onSetSlot={setLibraryEntryToSlot}
                onUploadReference={(files, record) => void uploadReferenceImages(files, record)}
                onSetReference={setEntryReference}
                operationBusy={albumOperationBusy}
                operationLabel={albumOperationLabel}
                onExport={() => {
                  if (albumOperationBusy) return;
                  setArchiveProgress({ stage: 'hashing', completed: 0, total: album.assets.length });
                  void exportAlbumInWorker(album, (progress) => {
                    setArchiveProgress(progress);
                    setMessage(albumOperationStageLabel(progress));
                  }).then((result) => {
                    setMessage(result.warningCount > 0
                      ? `相册备份已导出；${result.warningCount} 个资源未能打包，请查看清单警告。`
                      : `相册备份已导出：${result.assetCount} 个资源，${result.entryCount} 个条目。`);
                  }).catch((err) => setMessage(`导出失败：${err instanceof Error ? err.message : String(err)}`))
                    .finally(() => setArchiveProgress(null));
                }}
                onImport={(file, target, mode) => {
                  if (albumOperationBusy) return;
                  setArchiveProgress({ stage: 'reading' });
                  void importAlbumInWorker({ file, currentAlbum: album, target, mode, onProgress: (progress) => {
                    setArchiveProgress(progress);
                    setMessage(albumOperationStageLabel(progress));
                  } }).then((result) => {
                    if (!result) return;
                    // 归档导入同样是多次 await 之后提交：沿用同一 session 守卫，
                    // 切档后不再把旧档的导入结果写进新档。
                    startAlbumUpdate(() => { 提交相册(result.album); });
                    const stats = result.stats;
                    setMessage(mode === 'replace'
                      ? `相册已覆盖恢复：${stats.addedAssets} 个资源，${stats.addedEntries} 个条目。`
                      : `相册已合并：新增 ${stats.addedEntries} 项，复用 ${stats.reusedAssets} 个资源，合并 ${stats.mergedEntries} 项。`);
                  }).catch((err) => setMessage(`导入失败：${err instanceof Error ? err.message : String(err)}`))
                    .finally(() => setArchiveProgress(null));
                }}
              />
            )}
            {activeTab === 'anchor' && (
              <CharacterAnchorWorkspace
                traveler={traveler}
                travelerRequirement={travelerAnchorRequirement}
                setTravelerRequirement={setTravelerAnchorRequirement}
                onSaveTravelerAnchor={saveTravelerAnchor}
                onDeleteTravelerAnchor={deleteTravelerAnchor}
                onExtractTravelerAnchor={extractTravelerAnchor}
                records={libraryRecords.filter(isNpcLibraryRecord)}
                activeRecord={isNpcLibraryRecord(activeLibraryRecord) ? activeLibraryRecord : null}
                activeSelection={anchorSelection}
                anchorExtractingTarget={anchorExtractingTarget}
                setAnchorExtractingTarget={setAnchorExtractingTarget}
                anchorBatchExtracting={anchorBatchExtracting}
                setAnchorBatchExtracting={setAnchorBatchExtracting}
                onSelectAnchor={(selection) => {
                  setAnchorSelection(selection);
                  if (selection !== 'traveler') setLibraryNpcId(selection);
                }}
                requirement={anchorRequirement}
                setRequirement={setAnchorRequirement}
                onSaveAnchor={saveNpcAnchor}
                onDeleteAnchor={deleteNpcAnchor}
                onExtractAnchor={extractNpcAnchor}
              />
            )}
            {activeTab === 'manual' && (
              <CreateWorkspace
                imageEnabled={imageSettings.enabled}
                currentTarget={currentTarget}
                sizePreset={sizePreset}
                setSizePreset={setSizePreset}
                customSize={customSize}
                setCustomSize={setCustomSize}
                resolvedSize={resolvedSize}
                extraRequirement={extraRequirement}
                setExtraRequirement={setExtraRequirement}
                prompt={prompt}
                setPrompt={setPrompt}
                negativePrompt={negativePrompt}
                setNegativePrompt={setNegativePrompt}
                generateTitle={generateTitle}
                setGenerateTitle={setGenerateTitle}
                onGenerate={handleGenerate}
                generating={generating}
                nsfwVisible={nsfwVisible}
                companions={companions}
                travelerName={traveler.姓名 || '主角'}
                selectedCharacterId={currentTarget.targetType === 'traveler' ? 'traveler' : selectedCharacterId}
                onSelectManualTarget={handleManualTargetSelection}
                imageRules={imageSettings.rules}
                onImageRulesChange={persistImageRulesPatch}
                onBuildPrompt={handleBuildPrompt}
                tokenizing={tokenizing}
                promptEditorOpen={promptEditorOpen}
                setPromptEditorOpen={setPromptEditorOpen}
                promptMeta={lastPromptMeta}
                canvasTask={currentCanvasTask}
                canvasSrc={currentCanvasSrc}
                onRetryTask={handleRetryTask}
                onOpenGallery={openCurrentResultInGallery}
                onSetResultReference={setCurrentResultAsReference}
                onMountResultToSlot={mountCurrentResultToDefaultSlot}
                resultIsReference={currentResultIsReference}
                referenceStatus={currentReferenceStatus}
              />
            )}
            {activeTab === 'scene' && (
              <StorySnapshotWorkspace
                imageEnabled={imageSettings.enabled}
                currentTarget={generateTargets.find((item) => item.id === 'scene') ?? currentTarget}
                sizePreset={sizePreset}
                setSizePreset={setSizePreset}
                customSize={customSize}
                setCustomSize={setCustomSize}
                resolvedSize={resolveSize(sizePreset, customSize, 'scene')}
                extraRequirement={extraRequirement}
                setExtraRequirement={setExtraRequirement}
                prompt={prompt}
                setPrompt={setPrompt}
                negativePrompt={negativePrompt}
                setNegativePrompt={setNegativePrompt}
                generateTitle={generateTitle}
                setGenerateTitle={setGenerateTitle}
                onGenerate={handleGenerateStorySnapshot}
                generating={generating}
                sceneText={sceneText}
                setSceneText={setSceneText}
                sourceMode={storySnapshotSource}
                setSourceMode={(value) => {
                  setStorySnapshotSource(value);
                  setStorySnapshotContext(null);
                  setNovelAIOverrides({});
                }}
                sourceText={storySnapshotDraft}
                setSourceText={(value) => {
                  setStorySnapshotDraft(value);
                  setStorySnapshotContext(null);
                  setNovelAIOverrides({});
                }}
                sourceOptions={storySnapshotSourceOptions}
                summary={storySnapshotSummary}
                analyzing={storySnapshotAnalyzing}
                onBuildSnapshotPrompt={handleBuildStorySnapshotPrompt}
                onBuildPrompt={handleBuildStorySnapshotPrompt}
                tokenizing={tokenizing}
                promptEditorOpen={promptEditorOpen}
                setPromptEditorOpen={setPromptEditorOpen}
                promptMeta={lastPromptMeta}
                canvasTask={currentCanvasTask}
                canvasSrc={currentCanvasSrc}
                onRetryTask={handleRetryStorySnapshotTask}
                onOpenGallery={openCurrentResultInGallery}
                referenceStatus={nonCharacterReferenceStatus}
                backend={imageSettings.普通接口.backend}
                storySnapshotContext={storySnapshotContext}
                onStorySnapshotContextChange={(value) => setStorySnapshotContext(normalizeStorySnapshotRenderContext(value) ?? null)}
                novelAIOverrides={novelAIOverrides}
                onNovelAIOverridesChange={setNovelAIOverrides}
                compiledNovelAIPreview={storySnapshotCompiledPayload}
              />
            )}
            {activeTab === 'sceneImage' && (
              <SceneImageWorkspace
                imageEnabled={imageSettings.enabled}
                currentTarget={generateTargets.find((item) => item.id === 'scene') ?? currentTarget}
                sizePreset={sizePreset}
                setSizePreset={setSizePreset}
                customSize={customSize}
                setCustomSize={setCustomSize}
                resolvedSize={resolveSize(sizePreset, customSize, 'scene')}
                extraRequirement={extraRequirement}
                setExtraRequirement={setExtraRequirement}
                prompt={prompt}
                setPrompt={setPrompt}
                negativePrompt={negativePrompt}
                setNegativePrompt={setNegativePrompt}
                generateTitle={generateTitle}
                setGenerateTitle={setGenerateTitle}
                onGenerate={handleGenerate}
                generating={generating}
                sceneText={sceneImageText}
                setSceneText={setSceneImageText}
                onBuildPrompt={handleBuildSceneImagePrompt}
                tokenizing={tokenizing}
                promptEditorOpen={promptEditorOpen}
                setPromptEditorOpen={setPromptEditorOpen}
                promptMeta={lastPromptMeta}
                canvasTask={currentCanvasTask}
                canvasSrc={currentCanvasSrc}
                onRetryTask={handleRetryTask}
                onOpenGallery={openCurrentResultInGallery}
                sceneSummary={sceneImageSummary}
                analyzing={sceneImageAnalyzing}
                onImportCurrentBody={importCurrentBodyText}
                referenceStatus={nonCharacterReferenceStatus}
              />
            )}
            {activeTab === 'phone' && (
              <CourierBackgroundWorkspace
                imageEnabled={imageSettings.enabled}
                currentTarget={generateTargets.find((item) => item.id === 'phone_wallpaper') ?? currentTarget}
                sizePreset={sizePreset}
                setSizePreset={setSizePreset}
                customSize={customSize}
                setCustomSize={setCustomSize}
                resolvedSize={resolveSize(sizePreset, customSize, 'phone_wallpaper')}
                extraRequirement={extraRequirement}
                setExtraRequirement={setExtraRequirement}
                prompt={prompt}
                setPrompt={setPrompt}
                negativePrompt={negativePrompt}
                setNegativePrompt={setNegativePrompt}
                generateTitle={generateTitle}
                setGenerateTitle={setGenerateTitle}
                onGenerate={handleGenerate}
                generating={generating}
                sceneText={sceneText}
                setSceneText={setSceneText}
                onBuildPrompt={handleBuildPrompt}
                tokenizing={tokenizing}
                promptEditorOpen={promptEditorOpen}
                setPromptEditorOpen={setPromptEditorOpen}
                promptMeta={lastPromptMeta}
                canvasTask={currentCanvasTask}
                canvasSrc={currentCanvasSrc}
                onRetryTask={handleRetryTask}
                onOpenGallery={openCurrentResultInGallery}
                referenceStatus={nonCharacterReferenceStatus}
              />
            )}
            {activeTab === 'reference' && (
              <ReferenceInjectionWorkspace
                settings={imageSettings.参考图}
                normalApi={imageSettings.普通接口}
                nsfwApi={imageSettings.NSFW接口}
                onEnabledChange={setReferenceInjectionEnabled}
                onOpenAICompatibleReferenceChange={setOpenAICompatibleReferenceEnabled}
              />
            )}
            {activeTab === 'rules' && (
              <RulesWorkspace
                rules={imageSettings.rules}
                onChange={patchImageRules}
                onSave={handleSaveRules}
              />
            )}
            {activeTab === 'queue' && <ImageTaskWorkspace album={album} includeNsfw={nsfwVisible && showNsfw} onSelectEntry={setActiveEntryId} onRetry={handleRetryTask} onCancel={handleCancelTask} />}
            {activeTab === 'settings' && (
              <ImageGenerationSettingsTab
                settings={gameSettings}
                onChange={persistGameSettingsChange}
                apiSettings={apiSettings}
              />
            )}
          </main>
          {message && (
            <div className="mt-4 px-3 py-2 text-xs leading-relaxed" style={{ color: message.includes('失败') ? 'rgba(var(--tj-danger),0.9)' : 'rgba(var(--tj-ui-success),0.88)', boxShadow: 'inset 0 0 0 1px rgba(var(--tj-btn-primary-start),0.14)', clipPath: smallClip }}>
              {message}
            </div>
          )}
        </section>
      </div>
      <ConfirmDialogHost dialog={confirmDialog} />
    </div>
  );
}




