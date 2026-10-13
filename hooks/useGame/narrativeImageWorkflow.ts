import { applyLegacyGameStateOverrides, createLegacyGameViewSelector, readLiveGameState, type UseGameStateReturn } from '@/hooks/useGameState';
import { flushSync } from 'react-dom';
import type { 叙事插图 } from '@/models/chat';
import type { TeyvatGameState } from '@/models/teyvat';
import { narrativeTurnBodyText } from '@/models/teyvat/narrativeTurn';
import type { API配置项, API设置, 文生图API配置 } from '@/models/settings';
import { generateNarrativeImage } from '@/services/ai/imageGeneration';
import { buildImagePromptTokenizerConfig } from '@/services/ai/imagePromptTokenizer';
import { resolveStorySnapshot, selectPresentStorySnapshotNpcs } from '@/services/ai/storySnapshotPipeline';
import { 创建相册图片条目, 添加图片到相册, 创建相册资源引用 } from '@/utils/albumActions';
import { applyNovelAIRulePreset } from '@/utils/imagePromptRules';
import { imageCharacterSourceKey } from '@/utils/imageCharacterFacts';
import { pushWorkflowQueueTask } from './workflowQueue';

function buildSingleApiSettings(config: API配置项): API设置 {
  return { activeConfigId: config.id, configs: [config] };
}

export function resolveNarrativeImageTokenizerConfig(
  state: UseGameStateReturn,
  mainConfig: API配置项 | null,
): API配置项 | null {
  if (!mainConfig) return null;
  return buildImagePromptTokenizerConfig(state.gameSettings, buildSingleApiSettings(mainConfig));
}

export function resolveNarrativeImageGenerationApi(state: UseGameStateReturn): 文生图API配置 | null {
  const imageSettings = state.gameSettings.文生图系统;
  return imageSettings.普通接口.enabled
    ? applyNovelAIRulePreset(imageSettings.普通接口, imageSettings.rules)
    : null;
}

function prepareNarrativeSnapshotForAlbum(
  image: 叙事插图,
  params: { title: string; size: string; sourcePrompt: string },
): { image: 叙事插图; item?: ReturnType<typeof 创建相册图片条目> } {
  if (image.status !== 'done' || !image.dataUrl) return { image };
  const item = 创建相册图片条目({
    title: params.title || image.description || '故事快照',
    src: image.dataUrl,
    source: 'generated',
    targetType: 'scene',
    slot: 'scene',
    prompt: image.prompt,
    negativePrompt: image.negativePrompt,
    sourcePrompt: params.sourcePrompt,
    finalPrompt: image.prompt,
    finalNegativePrompt: image.negativePrompt,
    dimensions: image.dimensions || params.size,
    tags: ['故事快照', '正文生图'],
    note: '故事快照',
  });
  return { item, image: { ...image, dataUrl: 创建相册资源引用(item.asset.id), assetId: item.asset.id } };
}

function narrativeImageCharacterKey(character: UseGameStateReturn['旅人'] | UseGameStateReturn['NPC'][number]): string {
  return JSON.stringify([imageCharacterSourceKey(character), character.图像档案?.角色锚点 ?? null, character.图像档案?.englishFacts ?? null]);
}

export interface GenerateNarrativeImagesParams {
  state: UseGameStateReturn;
  messageId: string;
  body: string;
  tokenizerConfig: API配置项 | null;
  imageApiConfig: 文生图API配置;
  turn: number;
  signal?: AbortSignal;
  replaceExisting?: boolean;
  domainContext?: Pick<UseGameStateReturn, '旅人' | 'NPC' | '相册'> & {
    onAlbumChange?: (next: UseGameStateReturn['相册']) => void;
  };
  writeDomainState?: boolean;
}

export async function generateNarrativeImagesForMessage(
  params: GenerateNarrativeImagesParams,
): Promise<叙事插图[] | null> {
  const {
    state, messageId, body, tokenizerConfig, imageApiConfig, turn, signal,
    replaceExisting = false, domainContext, writeDomainState = true,
  } = params;
  const sessionId = state.getGameSessionId();
  const selectView = createLegacyGameViewSelector();
  const sessionLive = () => !signal?.aborted && state.getGameSessionId() === sessionId;
  if (!sessionLive()) return null;
  const initialView = writeDomainState ? selectView(readLiveGameState(state)) : null;
  const sourceMessage = initialView?.chatHistory.find(message => message.id === messageId && message.role === 'assistant');
  const messageBody = (message: UseGameStateReturn['chatHistory'][number]) =>
    message.parsedResponse ? narrativeTurnBodyText(message.parsedResponse) : message.content.trim();
  const sourceBody = sourceMessage ? messageBody(sourceMessage) : undefined;
  const imageStateKey = (images: 叙事插图[] | undefined) => JSON.stringify((images ?? []).map(image => [image.id, image.status]));
  const sourceImagesKey = imageStateKey(sourceMessage?.narrativeImages);
  const traveler = domainContext?.旅人 ?? initialView?.旅人 ?? state.旅人;
  const presentNpcs = selectPresentStorySnapshotNpcs(domainContext?.NPC ?? initialView?.NPC ?? state.NPC ?? [], body);
  const initialNpcKeys = new Map(presentNpcs.map(npc => [npc.id, narrativeImageCharacterKey(npc)]));
  const initialTravelerKey = narrativeImageCharacterKey(traveler);
  let includedNpcIds: string[] = [];
  let includedTraveler = false;
  const isLive = (current?: TeyvatGameState) => {
    if (!sessionLive()) return false;
    // Recovery owns a local working copy and its later atomic root commit.
    if (!writeDomainState) return true;
    const view = selectView(current ?? readLiveGameState(state));
    const message = view.chatHistory.find(entry => entry.id === messageId && entry.role === 'assistant');
    if (!message || sourceBody !== body.trim() || messageBody(message) !== sourceBody) return false;
    if (imageStateKey(message.narrativeImages) !== sourceImagesKey) return false;
    if (includedTraveler && narrativeImageCharacterKey(view.旅人) !== initialTravelerKey) return false;
    return includedNpcIds.every(id => {
      const npc = view.NPC.find(entry => entry.id === id);
      return npc && narrativeImageCharacterKey(npc) === initialNpcKeys.get(id);
    });
  };
  if (!isLive()) return null;
  const queueState: UseGameStateReturn = { ...state, setQueueTasks: action => state.setQueueTasks(previous =>
    sessionLive() ? (typeof action === 'function' ? action(previous) : action) : previous) };
  const failMessage = (error: string) => {
    if (!replaceExisting || !writeDomainState) return;
    flushSync(() => state.updateGameState(current => {
      if (!isLive(current)) return current;
      return applyLegacyGameStateOverrides(current, { chatHistory: selectView(current).chatHistory.map((message) =>
      message.id === messageId && message.role === 'assistant'
        ? {
            ...message,
            narrativeImages: [{
              id: `narrative_failed_${turn}_${Date.now()}`,
              dataUrl: '',
              type: 'scene' as const,
              kind: 'snapshot' as const,
              prompt: '',
              negativePrompt: '',
              description: '故事快照',
              status: 'failed' as const,
              error,
            }],
          }
        : message) });
    }));
  };

  pushWorkflowQueueTask(queueState, 'narrative_image_parse', 'pending', {
    detail: '正在解析正文中的故事快照提示词。', turn, targetMessageId: messageId,
  });
  try {
    const playerAppearanceMode = state.gameSettings.文生图系统?.正文生图?.playerAppearanceMode ?? 'auto';
    const snapshot = await resolveStorySnapshot({
      apiConfig: tokenizerConfig,
      body,
      traveler,
      playerAppearanceMode,
      presentNpcs,
      rules: state.gameSettings.文生图系统.rules,
      size: '1280x720',
      slot: 'scene',
      signal,
    });
    const visibleNames = new Set(snapshot.renderContext.characters.filter(character => character.enabled !== false).map(character => character.name));
    includedNpcIds = presentNpcs.filter(npc => visibleNames.has(npc.姓名) || Boolean(npc.别名 && visibleNames.has(npc.别名))).map(npc => npc.id);
    includedTraveler = visibleNames.has(traveler.姓名) || Boolean(traveler.别名 && visibleNames.has(traveler.别名));
    if (!isLive()) return null;
    pushWorkflowQueueTask(queueState, 'narrative_image_parse', 'success', {
      detail: snapshot.source === 'local'
        ? `模型解析未完成，已使用本地草稿：${snapshot.summary.title || '剧情瞬间'}。${snapshot.warning ? ` ${snapshot.warning}` : ''}`
        : `已解析故事快照：${snapshot.summary.title || '剧情瞬间'}。`,
      rawText: snapshot.diagnosticRawText,
      turn,
      targetMessageId: messageId,
    });
    pushWorkflowQueueTask(queueState, 'narrative_image_generate', 'pending', {
      detail: `正在生成故事快照：${snapshot.summary.title || '剧情瞬间'}。`, turn, targetMessageId: messageId,
    });
    const result = await generateNarrativeImage(
      imageApiConfig,
      snapshot.prompt,
      snapshot.negativePrompt,
      'scene',
      snapshot.summary.title || '故事快照',
      `narrative_${turn}_snapshot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      snapshot.renderContext,
      signal,
    );
    if (!isLive()) return null;
    if (result.status === 'done' || result.status === 'failed') result.kind = 'snapshot';
    const archived = prepareNarrativeSnapshotForAlbum(result, {
      title: snapshot.summary.title || '故事快照',
      size: '1280x720',
      sourcePrompt: body,
    });
    const generatedImages = [archived.image];
    if (writeDomainState) {
      let accepted = false;
      flushSync(() => state.updateGameState(current => {
        if (!isLive(current)) return current;
        const view = selectView(current);
        accepted = true;
        return applyLegacyGameStateOverrides(current, {
          ...(archived.item ? { 相册: 添加图片到相册(view.相册, archived.item) } : {}),
          chatHistory: view.chatHistory.map(message => message.id === messageId && message.role === 'assistant'
            ? { ...message, narrativeImages: replaceExisting ? generatedImages : [...(message.narrativeImages ?? []), ...generatedImages] }
            : message),
        });
      }));
      if (!accepted) return null;
    } else if (archived.item) {
      domainContext?.onAlbumChange?.(添加图片到相册(domainContext.相册, archived.item));
    }
    pushWorkflowQueueTask(queueState, 'narrative_image_generate', result.status === 'done' ? 'success' : 'failed', {
      detail: result.status === 'done'
        ? `${snapshot.summary.title || '故事快照'} 故事快照生成完成。`
        : `${snapshot.summary.title || '故事快照'} 故事快照生成失败：${result.error}`,
      turn,
      targetMessageId: messageId,
    });
    return generatedImages;
  } catch (error) {
    if (isLive() && (error as Error).name !== 'AbortError') {
      failMessage((error as Error).message);
      pushWorkflowQueueTask(queueState, 'narrative_image_parse', 'failed', {
        detail: `故事快照解析失败：${(error as Error).message}`, turn, targetMessageId: messageId,
      });
    }
    return null;
  }
}

export async function regenerateNarrativeImagesForMessage(
  state: UseGameStateReturn,
  getActiveConfig: () => API配置项 | null,
  messageId: string,
): Promise<void> {
  const sessionId = state.getGameSessionId();
  const message = createLegacyGameViewSelector()(readLiveGameState(state)).chatHistory.find((item) => item.id === messageId);
  if (!message || message.role !== 'assistant') return;
  const body = message.parsedResponse ? narrativeTurnBodyText(message.parsedResponse) : message.content.trim();
  if (!body) return;
  const narrative = state.gameSettings.文生图系统?.正文生图;
  if (!narrative?.enabled) {
    pushWorkflowQueueTask(state, 'narrative_image_parse', 'failed', {
      detail: '正文生图未启用，无法重新生成故事快照。',
      turn: Number(message.gameTime) || state.turnCount,
      targetMessageId: messageId,
    });
    return;
  }
  const tokenizerConfig = resolveNarrativeImageTokenizerConfig(state, getActiveConfig());
  const imageApiConfig = resolveNarrativeImageGenerationApi(state);
  if (!imageApiConfig) {
    pushWorkflowQueueTask(state, 'narrative_image_generate', 'failed', {
      detail: '正文生图主文生图接口未启用，无法生成故事快照。',
      turn: Number(message.gameTime) || state.turnCount,
      targetMessageId: messageId,
    });
    return;
  }
  const turn = Number(message.gameTime) || state.turnCount;
  const previousImages = message.narrativeImages ?? [];
  const generationId = `narrative_regen_${turn}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  // Transient IDs identify this request without adding a new persisted field.
  const pendingImages: 叙事插图[] = previousImages.length
    ? previousImages.map((image, index) => ({ ...image, id: `${generationId}_${index}`, status: 'generating', error: undefined }))
    : [{ id: generationId, dataUrl: '', type: 'scene', prompt: '', negativePrompt: '',
      description: '故事快照', kind: 'snapshot', status: 'generating' }];
  state.setChatHistory((previous) => state.getGameSessionId() !== sessionId ? previous : previous.map((item) => item.id === messageId
    ? { ...item, narrativeImages: pendingImages }
    : item));
  try {
    await generateNarrativeImagesForMessage({
      state, messageId, body, tokenizerConfig, imageApiConfig, turn, replaceExisting: true,
    });
  } finally {
    let restored = false;
    const selectView = createLegacyGameViewSelector();
    flushSync(() => state.updateGameState(current => {
      if (state.getGameSessionId() !== sessionId) return current;
      const view = selectView(current);
      const target = view.chatHistory.find(item => item.id === messageId && item.role === 'assistant');
      if (!target || target.narrativeImages?.length !== pendingImages.length
        || !target.narrativeImages.every((image, index) => image.id === pendingImages[index]?.id && image.status === 'generating')) return current;
      restored = true;
      const images = previousImages.map(image => image.status === 'generating'
        ? { ...image, status: 'failed' as const, error: '前一次生成已失效，可重新生成。' } : image);
      return applyLegacyGameStateOverrides(current, {
        chatHistory: view.chatHistory.map(item => item === target ? { ...item, narrativeImages: images } : item),
      });
    }));
    if (restored) pushWorkflowQueueTask(state, 'narrative_image_generate', 'cancelled', {
      detail: '源正文或人物资料已变化，本次故事快照已弃用；可以重新生成。', turn, targetMessageId: messageId,
    });
  }
}
