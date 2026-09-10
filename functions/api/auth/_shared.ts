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
  if (text.length > maxBytes) {
    return jsonResponse({ error: `请求体超过 ${maxBytes} 字节上限。` }, { status: 413 });
  }
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: text,
  });
}

export function readRequiredEnv(env: Record<string, unknown>, key: string): string {
  const raw = env[key];
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) throw new Error(`Cloudflare 环境变量缺失：${key}`);
  return value;
}
