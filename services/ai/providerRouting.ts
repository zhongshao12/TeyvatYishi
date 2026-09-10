import type { API配置项 } from '@/models/settings';
import { isArkBaseUrl } from './arkProxyCore';

export type ChatProvider =
  | 'mimo'
  | 'ark'
  | 'opencode'
  | 'deepseek'
  | 'gemini'
  | 'claude'
  | 'openai_compatible';

export function isLikelyClaudeModel(model: string): boolean {
  return /(^|[\/:._\-\s])(claude|opus|sonnet|haiku)([\/:._\-\s]|$)/i.test(model.trim());
}

export function shouldUseClaudeMessagesApi(config: API配置项): boolean {
  if (config.provider === 'claude') return true;
  if (config.provider !== 'claude_compatible') return false;
  if (config.enableClaudeMode !== true) return false;
  return isLikelyClaudeModel(config.model);
}

export function detectChatProvider(config: API配置项): ChatProvider {
  const url = config.baseUrl.toLowerCase();
  if (config.provider === 'mimo' || /xiaomimimo|mimo\.mi/i.test(url)) return 'mimo';
  if (config.provider === 'ark' || isArkBaseUrl(config.baseUrl)) return 'ark';
  if (config.provider === 'opencode' || /opencode\.ai\/zen\/v1/i.test(url)) return 'opencode';
  if (config.provider === 'deepseek' || url.includes('deepseek')) return 'deepseek';
  if (config.provider === 'gemini' || url.includes('gemini') || url.includes('googleapis')) return 'gemini';
  if (shouldUseClaudeMessagesApi(config)) return 'claude';
  return 'openai_compatible';
}
