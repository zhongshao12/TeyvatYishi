import type { UseGameStateReturn } from '@/hooks/useGameState';
import type { 叙事插图 } from '@/models/chat';
import { narrativeTurnBodyText } from '@/models/teyvat/narrativeTurn';
import type { API配置项, API设置, 文生图API配置 } from '@/models/settings';
import { generateNarrativeImage } from '@/services/ai/imageGeneration';
import { buildImagePromptTokenizerConfig } from '@/services/ai/imagePromptTokenizer';
import { resolveStorySnapshot, selectPresentStorySnapshotNpcs } from '@/services/ai/storySnapshotPipeline';
import { 创建相册图片条目, 添加图片到相册, 创建相册资源引用 } from '@/utils/albumActions';
import { applyNovelAIRulePreset } from '@/utils/imagePromptRules';
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

function archiveNarrativeSnapshotToAlbum(
  state: UseGameStateReturn,
  image: 叙事插图,
  params: { title: string; size: string; sourcePrompt: string },
  domainAlbum?: UseGameStateReturn['相册'],
  onDomainAlbumChange?: (next: UseGameStateReturn['相册']) => void,
  writeState = true,
): 叙事插图 {
  if (image.status !== 'done' || !image.dataUrl) return image;
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
    dimensions: params.size,
    tags: ['故事快照', '正文生图'],
    note: '故事快照',
  });
  const nextAlbum = 添加图片到相册(domainAlbum ?? state.相册, item);
  onDomainAlbumChange?.(nextAlbum);
  if (writeState) state.set相册(nextAlbum);
  return { ...image, dataUrl: 创建相册资源引用(item.asset.id), assetId: item.asset.id };
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
  const failMessage = (error: string) => {
    if (!replaceExisting || !writeDomainState) return;
    state.setChatHistory((previous) => previous.map((message) =>
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
        : message));
  };

  pushWorkflowQueueTask(state, 'narrative_image_parse', 'pending', {
    detail: '正在解析正文中的故事快照提示词。', turn, targetMessageId: messageId,
  });
  try {
    const playerAppearanceMode = state.gameSettings.文生图系统?.正文生图?.playerAppearanceMode ?? 'auto';
    const presentNpcs = selectPresentStorySnapshotNpcs(domainContext?.NPC ?? state.NPC ?? [], body);
    const snapshot = await resolveStorySnapshot({
      apiConfig: tokenizerConfig,
      body,
      traveler: domainContext?.旅人 ?? state.旅人,
      playerAppearanceMode,
      presentNpcs,
      rules: state.gameSettings.文生图系统.rules,
      size: '1280x720',
      slot: 'scene',
      signal,
    });
    pushWorkflowQueueTask(state, 'narrative_image_parse', 'success', {
      detail: snapshot.source === 'local'
        ? `模型解析未完成，已使用本地草稿：${snapshot.summary.title || '剧情瞬间'}。${snapshot.warning ? ` ${snapshot.warning}` : ''}`
        : `已解析故事快照：${snapshot.summary.title || '剧情瞬间'}。`,
      rawText: snapshot.diagnosticRawText,
      turn,
      targetMessageId: messageId,
    });
    pushWorkflowQueueTask(state, 'narrative_image_generate', 'pending', {
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
    if (result.status === 'done' || result.status === 'failed') result.kind = 'snapshot';
    const generatedImages = [archiveNarrativeSnapshotToAlbum(state, result, {
      title: snapshot.summary.title || '故事快照',
      size: '1280x720',
      sourcePrompt: body,
    }, domainContext?.相册, domainContext?.onAlbumChange, writeDomainState)];
    pushWorkflowQueueTask(state, 'narrative_image_generate', result.status === 'done' ? 'success' : 'failed', {
      detail: result.status === 'done'
        ? `${snapshot.summary.title || '故事快照'} 故事快照生成完成。`
        : `${snapshot.summary.title || '故事快照'} 故事快照生成失败：${result.error}`,
      turn,
      targetMessageId: messageId,
    });
    if (writeDomainState) {
      state.setChatHistory((previous) => previous.map((message) => message.id === messageId && message.role === 'assistant'
        ? {
            ...message,
            narrativeImages: replaceExisting
              ? generatedImages
              : [...(message.narrativeImages ?? []), ...generatedImages],
          }
        : message));
    }
    return generatedImages;
  } catch (error) {
    if ((error as Error).name !== 'AbortError') {
      failMessage((error as Error).message);
      pushWorkflowQueueTask(state, 'narrative_image_parse', 'failed', {
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
  const message = state.chatHistory.find((item) => item.id === messageId);
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
  state.setChatHistory((previous) => previous.map((item) => item.id === messageId
    ? {
        ...item,
        narrativeImages: previousImages.length
          ? previousImages.map((image) => ({ ...image, status: 'generating' as const, error: undefined }))
          : [{
              id: `narrative_regen_${turn}_${Date.now()}`,
              dataUrl: '', type: 'scene' as const, prompt: '', negativePrompt: '',
              description: '故事快照', kind: 'snapshot' as const, status: 'generating' as const,
            }],
      }
    : item));
  await generateNarrativeImagesForMessage({
    state, messageId, body, tokenizerConfig, imageApiConfig, turn, replaceExisting: true,
  });
}
