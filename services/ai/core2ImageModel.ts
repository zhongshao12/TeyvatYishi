import type { API配置项, 文生图系统设置 } from '@/models/settings';
import type { CoreImageModels } from '@/core/jobs/imageJob';
import { generateImage } from './imageGeneration';
import { translateImageCharacterFacts } from './imageCharacterTranslation';
import { core2TextCompletion } from './core2TextCompletion';
import { buildCoreImageRequest } from '@/core/retrieval/imageContext';
import { ownCoreImageRequest } from '@/core/jobs/imagePlan';
import { ownCoreImage } from '@/core/assets/images';
import { stableJson } from '@/core/persistence/repositoryValidation';
import { checksumUtf8 } from '@/core/sources/sourceIntegrity';
import { 获取当前画师串预设, 获取当前详细画风预设, 质量增强正面提示词, 质量增强负面提示词 } from '@/utils/imagePromptRules';
const coreTranslate: typeof translateImageCharacterFacts = (facts, config, signal) => translateImageCharacterFacts(facts, config, signal, core2TextCompletion);
export function createCore2ImagePort(settings: 文生图系统设置, main: API配置项 | null, generate = generateImage, translate = coreTranslate): CoreImageModels {
  const owned = structuredClone(settings), mainConfig = main && structuredClone(main);
  const apiFor = (kind: string) => kind !== 'character' && owned.useSeparateSceneApi ? owned.场景接口 : owned.普通接口;
  const metadata = [owned.普通接口, owned.useSeparateSceneApi ? owned.场景接口 : null].map(api => {
    if (!api) return null; const { apiKey: _, baseUrl, ...data } = api;
    let endpoint = 'invalid-endpoint'; try { const url = new URL(baseUrl); url.username = ''; url.password = ''; url.hash = ''; for (const key of [...url.searchParams.keys()]) if (/key|token|auth|secret|password|signature/iu.test(key)) url.searchParams.delete(key); endpoint = url.toString(); } catch { /* Invalid config is rejected by the existing backend. */ }
    return { ...data, endpoint };
  });
  const identity = 'core2-image-v1:' + checksumUtf8(stableJson(JSON.parse(JSON.stringify({ enabled: owned.enabled, metadata }))));
  return { getModelIdentity: () => identity,
    async prepare(snapshot, input, signal) {
      if (signal?.aborted) throw Error('图片准备已取消。');
      if (!owned.enabled) throw Error('生图系统已关闭，请先在设置中开启。');
      if (!apiFor(input.kind).enabled) throw Error('所选生图接口未启用，请先在设置中开启。');
      const scope = input.kind === 'character' ? 'npc' : 'scene', artist = 获取当前画师串预设(owned.rules, scope), detailed = 获取当前详细画风预设(owned.rules, scope);
      const positive = [artist?.画师串, artist?.正面提示词, detailed?.正面提示词, 质量增强正面提示词(owned.rules), ...input.positive].filter((text): text is string => !!text?.trim());
      const negative = [artist?.负面提示词, detailed?.负面提示词, 质量增强负面提示词(owned.rules), owned.rules.commonNegative, apiFor(input.kind).negativePrompt, ...input.negative].filter((text): text is string => !!text?.trim());
      const request = { title: input.title, kind: input.kind, size: input.size, npcIds: [] as string[], prompt: [input.userInput, ...new Set(positive)].filter(Boolean).join('\n'), negative: [...new Set(negative)].join(', '), characters: [] as import('@/models/imageCharacterEnglish').EnglishImageCharacterFacts[] };
      if (!input.npcId) { if (input.kind === 'character') throw Error('请先选择要绘制的角色。'); return { request: ownCoreImageRequest(request) }; }
      const npc = snapshot.records.find(row => row.domain === 'npc' && row.entityId === input.npcId); if (npc?.domain !== 'npc' || npc.value.archived) throw Error('CORE2_IMAGE_CHARACTER_MISSING');
      const override = owned.词组转化器API, translation = mainConfig ? { ...mainConfig, provider: override.provider || mainConfig.provider, baseUrl: override.baseUrl.trim() || mainConfig.baseUrl,
        apiKey: override.apiKey.trim() || mainConfig.apiKey, model: override.model.trim() || mainConfig.model, temperature: 0, maxTokens: 1600 } : null;
      const prepared = await buildCoreImageRequest({ snapshot, npcId: npc.entityId, userInput: input.userInput, positive, negative, translationConfig: translation, signal }, { prepare: translate });
      request.npcIds = [npc.entityId]; request.prompt = prepared.request.prompt; request.negative = prepared.request.negativePrompt ?? ''; request.characters = JSON.parse(JSON.stringify([prepared.englishCache.facts]));
      return { request: ownCoreImageRequest({ ...request, ...(input.phoneOrigin ? { phoneOrigin: input.phoneOrigin } : {}) }), cache: { npcId: npc.entityId, expectedVersion: npc.version, value: JSON.parse(JSON.stringify(prepared.englishCache)) } };
    },
    async generate(input, signal) {
      if (signal.aborted) throw Error('图片生成已取消。');
      if (!owned.enabled) throw Error('生图系统已关闭，请先在设置中开启。');
      const request = ownCoreImageRequest(input), config = apiFor(request.kind);
      const output = await generate(config, { prompt: request.prompt, negativePrompt: request.negative, size: request.size, signal,
        protectedCharacters: request.characters.map(facts => ({ name: facts.name, facts, visualPrompt: facts.appearance ?? '' })) });
      if (signal.aborted) throw Error('图片生成已取消。');
      const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/u.exec(output.src);
      if (!match || match[2]!.length > Math.ceil(20 * 1024 * 1024 / 3) * 4 + 4) throw Error('图片接口没有返回可保存的内联图片，或图片超过20MiB。');
      const image = ownCoreImage(Uint8Array.from(atob(match[2]!), c => c.charCodeAt(0)), match[1]!);
      return { bytes: image.bytes, mimeType: image.mimeType, ...(output.finalPrompt !== undefined ? { finalPrompt: output.finalPrompt } : {}), ...(output.finalNegativePrompt !== undefined ? { finalNegative: output.finalNegativePrompt } : {}) };
    },
  };
}
