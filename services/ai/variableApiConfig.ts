import type { API配置项, 变量API覆盖 } from '@/models/settings';

/** Configuration only: importing this helper never imports a writable game root. */
export function resolveVariableSettlementApiConfig(mainApiConfig: API配置项, override: 变量API覆盖): { config: API配置项; overrodeAny: boolean } {
  const baseUrl = override.baseUrl.trim(), apiKey = override.apiKey.trim(), model = override.model.trim();
  return {
    overrodeAny: Boolean(baseUrl || apiKey || model),
    config: { ...mainApiConfig, provider: override.provider || mainApiConfig.provider, baseUrl: baseUrl || mainApiConfig.baseUrl,
      apiKey: apiKey || mainApiConfig.apiKey, model: model || mainApiConfig.model, maxTokens: override.maxTokens ?? mainApiConfig.maxTokens,
      temperature: override.temperature ?? mainApiConfig.temperature },
  };
}
