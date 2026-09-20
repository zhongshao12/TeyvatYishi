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
  switch (config.provider) {
    case 'mimo': return 'mimo';
    case 'ark': return 'ark';
    case 'opencode': return 'opencode';
    case 'deepseek': return 'deepseek';
    case 'gemini': return 'gemini';
    case 'claude': return 'claude';
    case 'claude_compatible':
      return shouldUseClaudeMessagesApi(config) ? 'claude' : 'openai_compatible';
    case 'openai':
    case 'openai_compatible':
    case 'baidu':
      return 'openai_compatible';
    default:
      break;
  }

  // 仅为缺失 provider 的旧配置保留端点推断。任何受支持的显式 provider
  // 都必须优先，避免中转地址或模型别名中的品牌词切换请求协议。
  const url = config.baseUrl.toLowerCase();
  if (/xiaomimimo|mimo\.mi/i.test(url)) return 'mimo';
  if (isArkBaseUrl(config.baseUrl)) return 'ark';
  if (/opencode\.ai\/zen\/v1/i.test(url)) return 'opencode';
  if (url.includes('deepseek')) return 'deepseek';
  if (url.includes('gemini') || url.includes('googleapis')) return 'gemini';
  return 'openai_compatible';
}
