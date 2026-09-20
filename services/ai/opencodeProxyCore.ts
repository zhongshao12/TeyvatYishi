import { normalizeOpenCodeBaseUrl } from './openCodeEndpointPolicy';
import { handleUpstreamProxyRequest, readProxyText as readText } from './upstreamProxy';

type OpenCodeProxyBody = {
  baseUrl?: string;
  apiKey?: string;
  kind?: 'chat' | 'models';
  endpoint?: 'chat' | 'messages' | 'responses' | 'gemini';
  body?: unknown;
  model?: string;
  stream?: boolean;
};

export function assertOpenCodeBaseUrl(baseUrl: string): string {
  const base = normalizeOpenCodeBaseUrl(baseUrl);
  if (!/^https:\/\/opencode\.ai\/zen\/v1(?:\/|$)/i.test(base)) {
    throw new Error('仅允许代理 OpenCode Zen：opencode.ai/zen/v1。');
  }
  return base;
}

function buildOpenCodeUpstreamUrl(payload: OpenCodeProxyBody): string {
  const base = assertOpenCodeBaseUrl(readText(payload.baseUrl));
  if (payload.kind === 'models') return `${base}/models`;

  const endpoint = payload.endpoint ?? 'chat';
  if (endpoint === 'messages') return `${base}/messages`;
  if (endpoint === 'responses') return `${base}/responses`;
  if (endpoint === 'gemini') {
    const model = encodeURIComponent(readText(payload.model));
    if (!model) throw new Error('缺少 OpenCode Zen Gemini 模型 ID。');
    return `${base}/models/${model}:${payload.stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
  }
  return `${base}/chat/completions`;
}

function openCodeUpstreamHeaders(payload: OpenCodeProxyBody): HeadersInit {
  const apiKey = readText(payload.apiKey);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
  if (payload.endpoint === 'messages') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  }
  if (payload.endpoint === 'gemini') {
    headers['x-goog-api-key'] = apiKey;
  }
  return headers;
}

export async function handleOpenCodeProxyRequest(request: Request): Promise<Response> {
  return handleUpstreamProxyRequest<OpenCodeProxyBody>(request, {
    missingCredentialsMessage: '缺少 OpenCode Zen Base URL 或 API Key。',
    buildUrl: buildOpenCodeUpstreamUrl,
    buildHeaders: openCodeUpstreamHeaders,
  });
}
