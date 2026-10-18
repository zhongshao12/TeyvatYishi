import { chatCompletionNonStream, type ChatCompletionRequest } from './chatCompletionClient';
import type { API配置项 } from '@/models/settings';

/** Core operations/jobs own durable failures; no legacy diagnostics database. */
export function core2TextCompletion(config: API配置项, request: ChatCompletionRequest): Promise<string> {
  return chatCompletionNonStream(config, { ...request, errorReporting: 'caller' });
}
