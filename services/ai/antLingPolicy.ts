/**
 * 蚂蚁百灵（Ant Ling）OpenAI 兼容接口的客户端策略。
 *
 * 这个模块只放浏览器端也用得到的纯函数与常量：它会被打进主包，因此不得引入
 * Node 侧转发实现（`upstreamProxy` / `handleAntLingProxyRequest`）。
 * 官方接口固定返回 `Access-Control-Allow-Origin: https://api.ant-ling.com`，
 * 所以真正的请求由同源转发 `/api/antling` 代发。
 */
export const ANT_LING_ORIGIN = 'https://api.ant-ling.com';
export const ANT_LING_API_BASE = `${ANT_LING_ORIGIN}/v1`;
export const ANT_LING_PROXY_PREFIX = '/api/antling';

/** 官方文档列出的模型；用于设置页提示，不参与请求校验。 */
export const ANT_LING_MODELS = [
  'Ling-3.1-flash',
  'Ling-3.0-flash-VL',
  'Ling-3.0-flash',
  'Ling-3.0-tiny',
  'Ling-2.6-1T',
  'Ring-2.6-1T',
  'Ling-2.6-flash',
  'AntAngelMed',
] as const;

/** 用户常把 Base URL 填成根域名或整条 chat/completions；统一收敛到 .../v1。 */
export function normalizeAntLingBaseUrl(baseUrl: string): string {
  let base = baseUrl.trim().replace(/\/+$/, '');
  base = base.split('?')[0] ?? base;
  base = base.replace(/\/(?:chat\/completions|models)$/i, '');
  if (/^https:\/\/api\.ant-ling\.com$/i.test(base)) return `${base}/v1`;
  return base;
}

export function isAntLingBaseUrl(baseUrl: string): boolean {
  const trimmed = baseUrl.trim();
  if (!/^https:\/\/api\.ant-ling\.com(?:[/:?#]|$)/i.test(trimmed)) return false;
  try {
    return new URL(normalizeAntLingBaseUrl(trimmed)).hostname.toLowerCase() === 'api.ant-ling.com';
  } catch {
    return false;
  }
}

/** 3.0 / 3.1 系列默认开启思考，会先消耗输出额度；本应用的协议不需要思考过程。 */
export function isAntLingThinkingModel(model: string): boolean {
  return /^Ling-3\.[01](?:$|[-_.: ])/i.test(model.trim());
}

/** 官方 temperature 只接受 [0.0, 1.0]；写作预设里的 1.2/1.5 会直接 400。 */
export function clampAntLingTemperature(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(1, Math.max(0, value));
}

export function buildAntLingProxyBody(
  config: { baseUrl: string; apiKey: string },
  body: Record<string, unknown>,
  kind: 'chat' | 'models' = 'chat',
): string {
  return JSON.stringify({
    kind,
    baseUrl: normalizeAntLingBaseUrl(config.baseUrl),
    apiKey: config.apiKey,
    body,
  });
}
