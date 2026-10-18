import { handleUpstreamProxyRequest, readProxyText as readText } from './upstreamProxy';
import { normalizeAntLingBaseUrl } from './antLingPolicy';

export {
  ANT_LING_API_BASE,
  ANT_LING_MODELS,
  ANT_LING_ORIGIN,
  ANT_LING_PROXY_PREFIX,
  buildAntLingProxyBody,
  clampAntLingTemperature,
  isAntLingBaseUrl,
  isAntLingThinkingModel,
  normalizeAntLingBaseUrl,
} from './antLingPolicy';

/**
 * 蚂蚁百灵的服务端转发（Cloudflare Pages Function / 本机 Vite 插件共用）。
 * 只允许官方主机，避免被当成任意地址的中转；Key 由调用方随请求体传入，不落盘。
 */
export function assertAntLingBaseUrl(baseUrl: string): string {
  const base = normalizeAntLingBaseUrl(baseUrl);
  if (!/^https:\/\/api\.ant-ling\.com\/v1$/i.test(base)) {
    throw new Error('仅允许代理蚂蚁百灵 OpenAI 兼容接口：https://api.ant-ling.com/v1。');
  }
  return base;
}

type AntLingProxyBody = {
  baseUrl?: string;
  apiKey?: string;
  kind?: 'chat' | 'models';
  body?: unknown;
};

function buildAntLingUpstreamUrl(payload: AntLingProxyBody): string {
  const base = assertAntLingBaseUrl(readText(payload.baseUrl));
  return payload.kind === 'models' ? `${base}/models` : `${base}/chat/completions`;
}

export async function handleAntLingProxyRequest(request: Request): Promise<Response> {
  return handleUpstreamProxyRequest<AntLingProxyBody>(request, {
    missingCredentialsMessage: '缺少蚂蚁百灵 Base URL 或 API Key。',
    buildUrl: buildAntLingUpstreamUrl,
    buildHeaders: (payload) => ({
      'Content-Type': 'application/json',
      Accept: payload.kind === 'models' ? 'application/json' : 'text/event-stream, application/json',
      Authorization: `Bearer ${readText(payload.apiKey)}`,
    }),
  });
}

/**
 * 本机开发/预览转发只接受同源页面：非浏览器客户端不带 Origin，浏览器页面必须与转发服务同源。
 * 这样即使 dev server 监听 0.0.0.0，外部站点也不能借它花掉玩家的 Key。
 */
export function antLingLocalOriginAllowed(url: URL, headers: Headers): boolean {
  const origin = headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === url.host;
  } catch {
    return false;
  }
}
