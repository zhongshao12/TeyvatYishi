import type { API配置项 } from '@/models/settings';
import type { ChatCompletionRequest } from './chatCompletionClient';
import { core2TextCompletion as chatCompletionNonStream } from './core2TextCompletion';

/** Provider routing, sampling normalization and stream/body cancellation remain in the shared client. */
export function completeCore2VariableModel(config: API配置项, request: ChatCompletionRequest): Promise<string> {
  return chatCompletionNonStream(config, request);
}
