import { afterEach, describe, expect, it, vi } from 'vitest';
import { guardProxyEndpoint, limitRequestBody } from '@/functions/api/auth/_shared';
import { onRequestPost as arkProxyPost } from '@/functions/api/ark';
import { onRequestPost as qianfanProxyPost } from '@/functions/api/qianfan';

function buildRequest(options: { origin?: string; ip?: string; body?: string } = {}): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.origin) headers.origin = options.origin;
  if (options.ip) headers['CF-Connecting-IP'] = options.ip;
  return new Request('https://game.example.com/api/ark', {
    method: 'POST',
    headers,
    body: options.body ?? '{"baseUrl":"https://ark.cn-beijing.volces.com/api/v3","apiKey":"k"}',
  });
}

describe('proxy request body byte limit', () => {
  it('measures real UTF-8 bytes instead of UTF-16 code units', async () => {
    const text = JSON.stringify({ prompt: '中'.repeat(800) });
    expect(text.length).toBeLessThan(2000);

    const result = await limitRequestBody(buildRequest({ body: text }), 2000);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(413);
    const payload = await (result as Response).json() as { error?: string };
    expect(payload.error).toContain('字节');
  });

  it('still accepts a body inside the byte limit and preserves it byte for byte', async () => {
    const text = JSON.stringify({ prompt: '中'.repeat(10) });

    const result = await limitRequestBody(buildRequest({ body: text }), 4096);

    expect(result).not.toBeInstanceOf(Response);
    expect(await (result as Request).text()).toBe(text);
  });

  it('rejects a declared content-length above the limit before reading the body', async () => {
    const request = new Request('https://game.example.com/api/ark', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '4096' },
      body: 'x',
    });

    const result = await limitRequestBody(request, 1024);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(413);
  });
});

describe('AI proxy endpoint guard', () => {
  it('rejects a cross-origin browser caller before the upstream is contacted', async () => {
    const response = await guardProxyEndpoint({
      request: buildRequest({ origin: 'https://attacker.example' }),
      env: {},
    }, { scope: 'ark' });

    expect(response?.status).toBe(403);
    expect(await response?.json()).toMatchObject({ error: expect.stringContaining('跨来源') });
  });

  it('accepts a same-origin caller', async () => {
    const response = await guardProxyEndpoint({
      request: buildRequest({ origin: 'https://game.example.com' }),
      env: {},
    }, { scope: 'ark' });

    expect(response).toBeNull();
  });

  it('accepts an explicitly allowed origin from env', async () => {
    const response = await guardProxyEndpoint({
      request: buildRequest({ origin: 'http://tauri.localhost' }),
      env: { AI_PROXY_ALLOWED_ORIGINS: 'http://tauri.localhost, http://localhost:5173' },
    }, { scope: 'ark' });

    expect(response).toBeNull();
  });

  it('accepts a non-browser caller without an Origin header', async () => {
    const response = await guardProxyEndpoint({ request: buildRequest(), env: {} }, { scope: 'ark' });

    expect(response).toBeNull();
  });

  it('returns 429 as soon as the edge rate limiter rejects the caller', async () => {
    const limiter = { limit: vi.fn(async () => ({ success: false })) };

    const response = await guardProxyEndpoint({
      request: buildRequest({ origin: 'https://game.example.com', ip: '203.0.113.9' }),
      env: { AI_PROXY_RATE_LIMITER: limiter },
    }, { scope: 'ark' });

    expect(response?.status).toBe(429);
    expect(limiter.limit).toHaveBeenCalledWith({ key: 'ark:203.0.113.9' });
  });

  it('lets the request through when the limiter accepts it', async () => {
    const limiter = { limit: vi.fn(async () => ({ success: true })) };

    const response = await guardProxyEndpoint({
      request: buildRequest({ origin: 'https://game.example.com', ip: '203.0.113.9' }),
      env: { AI_PROXY_RATE_LIMITER: limiter },
    }, { scope: 'ark' });

    expect(response).toBeNull();
    expect(limiter.limit).toHaveBeenCalledTimes(1);
  });
});

const ARK_BODY = { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', apiKey: 'k', kind: 'chat', body: { model: 'm' } };

function endpointRequest(origin?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (origin) headers.origin = origin;
  return new Request('https://game.example.com/api/ark', {
    method: 'POST',
    headers,
    body: JSON.stringify(ARK_BODY),
  });
}

describe('proxy endpoints are actually wired to the guard', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('rejects a cross-origin caller at the endpoint boundary without contacting the upstream', async () => {
    const fetchSpy = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchSpy);

    const response = await arkProxyPost({ request: endpointRequest('https://attacker.example'), env: {} });

    expect(response.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 429 at the endpoint boundary when the edge limiter rejects the caller', async () => {
    const fetchSpy = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchSpy);
    const limiter = { limit: vi.fn(async () => ({ success: false })) };

    const response = await qianfanProxyPost({
      request: endpointRequest(),
      env: { AI_PROXY_RATE_LIMITER: limiter },
    });

    expect(response.status).toBe(429);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('still forwards a same-origin request to the configured upstream', async () => {
    const fetchSpy = vi.fn(async () => new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch);

    const response = await arkProxyPost({ request: endpointRequest('https://game.example.com'), env: {} });

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
      expect.anything(),
    );
  });
});
