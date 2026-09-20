import type { API设置, API配置项 } from '@/models/settings';

/** Resolve the same effective main configuration for execution and UI helpers. */
export function resolveActiveApiConfig(
  apiSettings: Pick<API设置, 'activeConfigId' | 'configs'>,
  enableClaudeMode: boolean,
): API配置项 | null {
  const selected = apiSettings.configs.find((config) => config.id === apiSettings.activeConfigId)
    ?? apiSettings.configs[0]
    ?? null;
  return selected ? { ...selected, enableClaudeMode } : null;
}
