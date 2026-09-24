import type { API设置, 游戏设置 } from '@/models/settings';

export interface ReadinessItem {
  status: 'ready' | 'warning' | 'disabled';
  label: string;
  detail: string;
}

export interface NewGameApiReadiness {
  main: ReadinessItem;
  variable: ReadinessItem;
  image: ReadinessItem;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function missingFields(input: { baseUrl: string; apiKey: string; model: string }, requireKey = true, requireModel = true): string[] {
  const missing: string[] = [];
  if (!isHttpUrl(input.baseUrl)) missing.push('有效的 HTTP(S) 地址');
  if (requireKey && !input.apiKey.trim()) missing.push('密钥');
  if (requireModel && !input.model.trim()) missing.push('模型 ID');
  return missing;
}

function item(label: string, missing: string[], readyDetail: string): ReadinessItem {
  return missing.length
    ? { status: 'warning', label, detail: `请检查${missing.join('、')}。` }
    : { status: 'ready', label, detail: readyDetail };
}

/** Checks only local fields. No network requests, URLs, model names, or keys enter the result. */
export function evaluateNewGameApiReadiness(
  apiSettings: API设置,
  gameSettings: Pick<游戏设置, 'variableApi' | '文生图系统'>,
): NewGameApiReadiness {
  const mainConfig = apiSettings.configs.find((config) => config.id === apiSettings.activeConfigId)
    ?? apiSettings.configs[0];
  const main: ReadinessItem = mainConfig
    ? item('主模型', missingFields(mainConfig), '已配置（尚未测试连接）。')
    : { status: 'warning', label: '主模型', detail: '未配置主模型，请先填写接口地址、密钥和模型 ID。' };

  const override = gameSettings.variableApi;
  const variableConfig = {
    baseUrl: override.baseUrl.trim() || mainConfig?.baseUrl || '',
    apiKey: override.apiKey.trim() || mainConfig?.apiKey || '',
    model: override.model.trim() || mainConfig?.model || '',
  };
  const hasOverride = Boolean(override.baseUrl.trim() || override.apiKey.trim() || override.model.trim());
  const variable = item(
    '变量处理', missingFields(variableConfig),
    hasOverride ? '独立字段已配置，留空字段沿用主模型；尚未测试连接。' : '沿用主模型配置（尚未测试连接）。',
  );

  const imageSettings = gameSettings.文生图系统;
  let image: ReadinessItem;
  if (!imageSettings.enabled) {
    image = { status: 'disabled', label: '图片生成', detail: '未开启，不影响文字游戏。' };
  } else if (!imageSettings.普通接口.enabled) {
    image = { status: 'warning', label: '图片生成', detail: '图片系统已开启，但普通接口未启用。' };
  } else {
    const config = imageSettings.普通接口;
    const needsCredentials = config.backend === 'openai_compatible' || config.backend === 'novelai';
    image = item('图片生成', missingFields(config, needsCredentials, needsCredentials), '已配置（尚未测试连接）。');
  }

  return { main, variable, image };
}
