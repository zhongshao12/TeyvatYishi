import type { API配置项 } from '@/models/settings';

/** Verified for this local Ollama/Gemma4 installation; never infer capabilities
 * from a cloud model name or a URL merely containing "localhost". */
export function supportsLocalGemma4Thinking(config: API配置项): boolean {
  if (config.provider !== 'openai_compatible' || !/^gemma4(?:[-:/.]|$)/iu.test(config.model)) return false;
  try {
    const url = new URL(config.baseUrl);
    return ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      && url.port === '11434' && /^\/v1(?:\/chat\/completions)?\/?$/u.test(url.pathname);
  } catch { return false; }
}

/** Boolean-only Ollama models map "high" to true and "none" to false.
 * https://docs.ollama.com/api/openai-compatibility */
export function localGemma4ThinkingEffort(config: API配置项): 'high' | 'none' | undefined {
  return supportsLocalGemma4Thinking(config) && typeof config.ollamaThinking === 'boolean'
    ? config.ollamaThinking ? 'high' : 'none' : undefined;
}
