import { LOCAL_GEMMA4_128K_PROFILE } from '../../data/localTextModelPresets';

export const LOCAL_OLLAMA_PROXY_PREFIX = '/api/local-ollama';
const allowedPaths = new Set(['/v1/chat/completions', '/v1/models']);
const loopback = (hostname: string) => ['127.0.0.1', 'localhost', '[::1]'].includes(hostname);
const responseError = (message: string, status: number) => Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });

/** Local Vite only. Never redirects a remote deployment to the deployment server's loopback. */
export function localOllamaRequestUrl(input: string, model?: string, origin: string | undefined = globalThis.location?.origin): string {
  if (model !== LOCAL_GEMMA4_128K_PROFILE.model) return input;
  try {
    const target = new URL(input), page = new URL(origin ?? '');
    if (['http:', 'https:'].includes(page.protocol) && loopback(page.hostname) && loopback(target.hostname)
      && target.protocol === 'http:' && target.port === '11434' && !target.username && !target.password && !target.search && !target.hash && allowedPaths.has(target.pathname)) return LOCAL_OLLAMA_PROXY_PREFIX + target.pathname;
  } catch { /* Node, desktop and non-local URLs keep their original direct transport. */ }
  return input;
}

export function localOllamaOriginAllowed(url: URL, headers: Headers, remoteAddress: string): boolean {
  const peer = remoteAddress.replace(/^::ffff:/u, '');
  return ['127.0.0.1', '::1'].includes(peer) && loopback(url.hostname) && !url.username && !url.password
    && headers.get('Sec-Fetch-Site') !== 'cross-site' && (!headers.has('Origin') || headers.get('Origin') === url.origin);
}

/** Fixed destination, loopback peers, same-origin browser requests and two routes only.
 * No model management, installs, cloud model access or user-controlled target URL. */
export async function handleLocalOllamaProxyRequest(request: Request, deps: { remoteAddress: string; fetch?: typeof fetch }): Promise<Response> {
  const url = new URL(request.url);
  if (!localOllamaOriginAllowed(url, request.headers, deps.remoteAddress)) return responseError('本地模型转发只接受本机同源请求。', 403);
  const path = url.pathname.slice(LOCAL_OLLAMA_PROXY_PREFIX.length);
  if (!url.pathname.startsWith(LOCAL_OLLAMA_PROXY_PREFIX + '/') || !allowedPaths.has(path) || url.search) return responseError('未开放此本地模型接口。', 404);
  if (request.method !== (path === '/v1/models' ? 'GET' : 'POST')) return responseError('Method Not Allowed', 405);
  if (request.signal.aborted) throw request.signal.reason;
  let body: string | undefined;
  if (request.method === 'POST') {
    if (!/^application\/json(?:\s*;|$)/iu.test(request.headers.get('Content-Type') ?? '')) return responseError('本地模型请求必须为JSON。', 415);
    body = await request.text(); if (new TextEncoder().encode(body).byteLength > 8 * 1024 * 1024) return responseError('本地模型请求超过8MiB。', 413);
    let value: unknown; try { value = JSON.parse(body); } catch { return responseError('JSON无效。', 400); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return responseError('请求必须为JSON对象。', 400);
    const data = value as Record<string, unknown>;
    if (data.model !== LOCAL_GEMMA4_128K_PROFILE.model || !Array.isArray(data.messages) || ['baseUrl', 'url', 'target'].some(key => key in data)) return responseError('本地转发仅允许已配置的Gemma4 128k模型，不接受上游地址覆盖。', 400);
  }
  try {
    const upstream = await (deps.fetch ?? fetch)('http://127.0.0.1:11434' + path, { method: request.method, headers: { 'Content-Type': 'application/json' }, body, signal: request.signal, redirect: 'error' });
    return new Response(upstream.body, { status: upstream.status, headers: { 'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json', 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (request.signal.aborted) throw request.signal.reason;
    return responseError('无法连接本机127.0.0.1:11434，请检查本地模型服务是否开启。' + (error instanceof Error ? error.message : ''), 502);
  }
}
