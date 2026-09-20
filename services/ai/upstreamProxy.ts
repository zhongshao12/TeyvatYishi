export interface UpstreamProxyPayload {
  baseUrl?: string;
  apiKey?: string;
  kind?: 'chat' | 'models';
  body?: unknown;
}

export interface UpstreamProxyOptions<TPayload extends UpstreamProxyPayload> {
  missingCredentialsMessage: string;
  buildUrl: (payload: TPayload) => string;
  buildHeaders: (payload: TPayload) => HeadersInit;
}

export function readProxyText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function createProxyHeaders(upstream?: Response): Headers {
  const headers = new Headers();
  headers.set('access-control-allow-origin', '*');
  headers.set('access-control-allow-methods', 'GET,POST,OPTIONS');
  headers.set('access-control-allow-headers', 'content-type');
  headers.set('cache-control', 'no-store');
  headers.set('content-type', upstream?.headers.get('content-type') || 'application/json; charset=utf-8');
  return headers;
}

export function createProxyErrorResponse(error: unknown, status: number): Response {
  return new Response(JSON.stringify({
    error: error instanceof Error ? error.message : String(error),
  }), {
    status,
    headers: createProxyHeaders(),
  });
}

export function forwardProxyResponse(upstream: Response): Response {
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: createProxyHeaders(upstream),
  });
}

export async function handleUpstreamProxyRequest<TPayload extends UpstreamProxyPayload>(
  request: Request,
  options: UpstreamProxyOptions<TPayload>,
): Promise<Response> {
  let payload: TPayload;
  try {
    payload = await request.json() as TPayload;
  } catch {
    return createProxyErrorResponse('请求体不是有效 JSON。', 400);
  }

  if (!readProxyText(payload.baseUrl) || !readProxyText(payload.apiKey)) {
    return createProxyErrorResponse(options.missingCredentialsMessage, 400);
  }

  try {
    const isModelsRequest = payload.kind === 'models';
    const headers = new Headers(options.buildHeaders(payload));
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    const upstream = await fetch(options.buildUrl(payload), {
      method: isModelsRequest ? 'GET' : 'POST',
      headers,
      body: isModelsRequest ? undefined : JSON.stringify(payload.body ?? {}),
      signal: request.signal,
    });
    return forwardProxyResponse(upstream);
  } catch (error) {
    return createProxyErrorResponse(error, 502);
  }
}
