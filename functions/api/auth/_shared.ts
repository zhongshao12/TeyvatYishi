export interface PagesContextLike {
  request: Request;
  env: Record<string, unknown>;
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('access-control-allow-origin', '*');
  headers.set('access-control-allow-methods', 'GET,POST,OPTIONS');
  headers.set('access-control-allow-headers', 'content-type');

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

export function optionsResponse(): Response {
  return jsonResponse({ ok: true });
}

export const DEFAULT_REQUEST_BODY_LIMIT = 2 * 1024 * 1024;

/** 代理端点使用的边缘限流器绑定名（Cloudflare Rate Limiting binding）。 */
export const AI_PROXY_RATE_LIMITER_BINDING = 'AI_PROXY_RATE_LIMITER';
/** 允许调用代理端点的额外来源白名单（逗号分隔），默认只允许同源。 */
export const AI_PROXY_ALLOWED_ORIGINS_ENV = 'AI_PROXY_ALLOWED_ORIGINS';

const utf8Encoder = new TextEncoder();
let warnedMissingRateLimiter = false;

/**
 * 真实 UTF-8 字节数。
 * `String.length` 是 UTF-16 码元数：一个中文字符只算 1，但编码后是 3 字节，
 * 用它跟字节上限比较会让中文请求体实际可以超标约 3 倍。
 */
export function readUtf8ByteLength(text: string): number {
  return utf8Encoder.encode(text).byteLength;
}

/** 限制请求体大小，防止代理接口被滥用造成资源消耗。超限返回 413。 */
export async function limitRequestBody(
  request: Request,
  maxBytes = DEFAULT_REQUEST_BODY_LIMIT,
): Promise<Request | Response> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return jsonResponse({ error: `请求体超过 ${maxBytes} 字节上限。` }, { status: 413 });
  }
  const text = await request.text();
  const actualBytes = readUtf8ByteLength(text);
  if (actualBytes > maxBytes) {
    return jsonResponse({ error: `请求体超过 ${maxBytes} 字节上限（实际 ${actualBytes} 字节）。` }, { status: 413 });
  }
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: text,
  });
}

type RateLimiterLike = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

function readTrimmedHeader(request: Request, name: string): string {
  const raw = request.headers.get(name);
  return typeof raw === 'string' ? raw.trim() : '';
}

function readClientKey(request: Request): string {
  const direct = readTrimmedHeader(request, 'CF-Connecting-IP');
  if (direct) return direct;
  const forwarded = readTrimmedHeader(request, 'X-Forwarded-For');
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown';
  return readTrimmedHeader(request, 'X-Real-IP') || 'unknown';
}

function getRateLimiter(env: Record<string, unknown>): RateLimiterLike | null {
  const candidate = env[AI_PROXY_RATE_LIMITER_BINDING];
  if (candidate && typeof candidate === 'object' && typeof (candidate as RateLimiterLike).limit === 'function') {
    return candidate as RateLimiterLike;
  }
  return null;
}

function isAllowedProxyOrigin(request: Request, env: Record<string, unknown>): boolean {
  const suppliedOrigin = readTrimmedHeader(request, 'Origin');
  // 非浏览器客户端（桌面端、本地 Vite 代理、脚本）不带 Origin 头；
  // 浏览器跨站请求一定带 Origin，因此缺头不是绕过点。
  if (!suppliedOrigin) return true;
  const requestOrigin = new URL(request.url).origin;
  if (suppliedOrigin === requestOrigin) return true;
  const configured = typeof env[AI_PROXY_ALLOWED_ORIGINS_ENV] === 'string'
    ? (env[AI_PROXY_ALLOWED_ORIGINS_ENV] as string).split(',').map((item) => item.trim()).filter(Boolean)
    : [];
  return configured.includes(suppliedOrigin);
}

/**
 * AI 代理端点的最小来源校验 + 边缘限流。
 * 返回 Response 表示拒绝本次请求；返回 null 表示放行。
 *
 * 说明：Origin 校验只能挡住浏览器发起的跨站滥用；真正的配额保护来自
 * `AI_PROXY_RATE_LIMITER` 绑定（不可用时降级为仅来源校验并记录告警）。
 */
export async function guardProxyEndpoint(
  { request, env }: PagesContextLike,
  options: { scope: string },
): Promise<Response | null> {
  if (!isAllowedProxyOrigin(request, env)) {
    return jsonResponse({ error: '拒绝跨来源代理请求。' }, { status: 403 });
  }
  const limiter = getRateLimiter(env);
  if (!limiter) {
    if (!warnedMissingRateLimiter) {
      warnedMissingRateLimiter = true;
      console.warn(`[ai-proxy] ${AI_PROXY_RATE_LIMITER_BINDING} 未配置：仅执行来源校验，请在部署环境绑定边缘限流器。`);
    }
    return null;
  }
  const rate = await limiter.limit({ key: `${options.scope}:${readClientKey(request)}` });
  if (!rate.success) {
    return jsonResponse({ error: '代理请求过于频繁，请稍后再试。' }, { status: 429 });
  }
  return null;
}

export function readRequiredEnv(env: Record<string, unknown>, key: string): string {
  const raw = env[key];
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) throw new Error(`Cloudflare 环境变量缺失：${key}`);
  return value;
}
