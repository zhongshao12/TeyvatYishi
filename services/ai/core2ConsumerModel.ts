import { 归一化手机系统设置, type API配置项, type 手机系统设置 } from '@/models/settings';
import type { 提示词模块 } from '@/models/prompts';
import type { ConsumerContextBundle } from '@/core/retrieval/consumerContext';
import { core2TextCompletion as chatCompletionNonStream } from './core2TextCompletion';
import { sanitizeCourierMessageText } from '@/utils/courierTextSanitizer';
import { validateMomentComment } from './courierMomentComments';
import { buildIndependentPromptModulesSection } from '@/services/promptModuleScopes';
import { resolveCourierApiConfig } from './courierLetterModel';
import { checksumUtf8 } from '@/core/sources/sourceIntegrity';
import { stableJson } from '@/core/persistence/repositoryValidation';
import type { CorePhoneJobDependencies } from '@/core/jobs/phoneJob';

export interface CorePhoneModelInput { config: API配置项; context: ConsumerContextBundle; npcName: string; target: 'private' | 'group' | 'moment'; signal?: AbortSignal; promptModules?: 提示词模块[] }
/** Shares the existing transport, provider normalization and cancellation. No fabricated fallback. */
export function createCore2PhoneModel(complete = chatCompletionNonStream) {
  return async (input: CorePhoneModelInput) => {
    if (!input.config.baseUrl.trim() || !input.config.model.trim()) throw Error('CORE2_PHONE_MODEL_UNCONFIGURED');
    const context = structuredClone(input.context), config = structuredClone(input.config);
    const instruction = input.target === 'moment' ? `你是${input.npcName}，只输出一条1～120字的完整评论，以句末标点或表情结束。不署名，不替别人回答。`
      : `你是${input.npcName}。只输出本人自然的手机消息，可分行，遵守人设与已知经历。不写旁白、技术标签、提醒模板或其它人的回复。`;
    const raw = await complete(config, { purpose: 'courier', systemPrompt: [buildIndependentPromptModulesSection(input.promptModules, 'courier'), instruction].filter(Boolean).join('\n\n'),
      messages: [{ role: 'user', content: context.prompt }], signal: input.signal, maxTokens: input.target === 'moment' ? Math.min(config.maxTokens ?? 384, 384) : config.maxTokens,
      temperature: config.temperature, topP: config.topP, topK: config.topK, topA: config.topA, minP: config.minP, repetitionPenalty: config.repetitionPenalty,
      frequencyPenalty: config.frequencyPenalty, presencePenalty: config.presencePenalty, maxContext: config.maxContext });
    if (input.signal?.aborted) throw Error('CORE2_PHONE_REPLY_CANCELLED');
    const text = input.target === 'moment' ? validateMomentComment(raw, input.npcName) : sanitizeCourierMessageText(raw);
    if (!text.trim() || /<(?:char_seven|time_format|变量事实)(?:\s|>)/iu.test(text)) throw Error('CORE2_PHONE_REPLY_INVALID');
    return { text, delivery: { bundleId: context.bundle.bundleId, selectedLeafIds: [...context.bundle.selectedLeafIds] } };
  };
}
export const generateCore2PhoneReply = createCore2PhoneModel();

/** A job configuration marker, not an authentication hash. Credentials never enter it. */
export function coreTextModelIdentity(config: API配置项, modules: 提示词模块[], purpose: 'phone' | 'news' = 'phone'): string {
  let endpoint: string;
  try {
    const url = new URL(config.baseUrl); url.username = ''; url.password = ''; url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/key|token|auth|secret|password|signature/iu.test(key)) url.searchParams.delete(key);
    endpoint = url.toString();
  } catch { endpoint = 'invalid-endpoint'; }
  const metadata = Object.fromEntries(Object.entries(config).filter(([key]) => !['apiKey', 'baseUrl', 'createdAt', 'updatedAt'].includes(key)));
  return `core2-${purpose}-v1:${checksumUtf8(stableJson({ metadata, endpoint, modules }))}`;
}

export function createCore2PhonePort(input: { mainConfig: API配置项 | null; settings: 手机系统设置; promptModules: 提示词模块[] }, complete = chatCompletionNonStream): Pick<CorePhoneJobDependencies, 'generate' | 'getModelIdentity'> {
  const settings = 归一化手机系统设置(structuredClone(input.settings)), modules = structuredClone(input.promptModules);
  const config = resolveCourierApiConfig(settings.api, input.mainConfig ? structuredClone(input.mainConfig) : null);
  const identity = !settings.enabled ? 'disabled' : config ? coreTextModelIdentity(config, modules) : 'unconfigured';
  const generate = createCore2PhoneModel(complete);
  return {
    getModelIdentity: () => identity,
    async generate(request) {
      if (!settings.enabled) throw Error('手机系统已关闭；消息已保存，没有调用模型。');
      if (!config) throw Error('手机回复 API 未配置；消息已保存，可在配置后重试。');
      return generate({ ...request, config, promptModules: modules });
    },
  };
}
