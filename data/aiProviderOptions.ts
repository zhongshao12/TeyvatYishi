import type { AI提供商 } from '@/models/settings';

export interface AIProviderOption {
  value: AI提供商;
  label: string;
  defaultBaseUrl: string;
  defaultModel: string;
}

export const AI_PROVIDER_OPTIONS: readonly [AIProviderOption, ...AIProviderOption[]] = [
  { value: 'openai_compatible', label: 'OpenAI 兼容', defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o' },
  { value: 'openai', label: 'OpenAI', defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o' },
  { value: 'deepseek', label: 'DeepSeek', defaultBaseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat' },
  { value: 'baidu', label: '百度千帆', defaultBaseUrl: 'https://qianfan.baidubce.com/v2', defaultModel: 'ernie-4.5-turbo-128k' },
  { value: 'opencode', label: 'OpenCode Zen', defaultBaseUrl: 'https://opencode.ai/zen/v1', defaultModel: 'deepseek-v4-flash' },
  { value: 'mimo', label: '小米 MiMo', defaultBaseUrl: 'https://api.xiaomimimo.com/v1', defaultModel: 'mimo-v2.5-pro' },
  { value: 'ark', label: '火山方舟', defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3', defaultModel: 'doubao-seed-1-6' },
  { value: 'claude', label: 'Claude', defaultBaseUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-sonnet-4-5' },
  { value: 'claude_compatible', label: 'Claude 兼容', defaultBaseUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-sonnet-4-5' },
  { value: 'gemini', label: 'Gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: 'gemini-2.5-pro' },
] as const;

export function getAIProviderOption(provider: AI提供商): AIProviderOption {
  return AI_PROVIDER_OPTIONS.find((option) => option.value === provider) ?? AI_PROVIDER_OPTIONS[0];
}
