import type { API配置项 } from '@/models/settings';
import { chatCompletionNonStream } from './chatCompletionClient';
import { buildRewritePrompt, type 改写模式 } from '@/prompts/cot/rewriteCot';

/**
 * W18 正文润色：非流式调用主模型，仅返回改写后的正文。
 * 调用方确认后才写回消息 content/parsedResponse.body，不重跑回合副作用。
 */
export async function rewriteBody(
  config: API配置项,
  body: string,
  mode: 改写模式 = 'polish',
): Promise<string> {
  const prompt = buildRewritePrompt(body, mode);
  const text = await chatCompletionNonStream(config, {
    messages: [{ role: 'user', content: prompt }],
    maxTokens: Math.max(1024, config.maxTokens ?? 4096),
    temperature: config.temperature ?? 0.8,
  });
  const trimmed = text.trim();
  if (!trimmed) throw new Error('模型未返回改写后的正文。');
  return trimmed;
}
