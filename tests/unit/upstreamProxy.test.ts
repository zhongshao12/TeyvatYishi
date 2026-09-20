import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleUpstreamProxyRequest } from '@/services/ai/upstreamProxy';

type Payload = {
  baseUrl?: string;
  apiKey?: string;
  kind?: 'chat' | 'models';
  body?: unknown;
};

const options = {
  missingCredentialsMessage: 'missing credentials',
  buildUrl: (payload: Payload) => `${payload.baseUrl}/${payload.kind === 'models' ? 'models' : 'chat'}`,
  buildHeaders: (payload: Payload) => ({ Authorization: `Bearer ${payload.apiKey}` }),
};

describe('shared upstream proxy', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('rejects malformed JSON before contacting upstream', async () => {
    const fetchSpy = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchSpy);
    const response = await handleUpstreamProxyRequest<Payload>(new Request('https://app.invalid/proxy', {
      method: 'POST',
      body: '{',
    }), options);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: '请求体不是有效 JSON。' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('uses the provider-specific missing credentials message', async () => {
    const response = await handleUpstreamProxyRequest<Payload>(new Request('https://app.invalid/proxy', {
      method: 'POST',
      body: JSON.stringify({ baseUrl: '', apiKey: '' }),
    }), options);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'missing credentials' });
  });

  it('forwards method, body, signal, status and content type', async () => {
    const fetchSpy = vi.fn<typeof fetch>(async () => new Response('stream-body', {
      status: 202,
      headers: { 'content-type': 'text/event-stream' },
    }));
    vi.stubGlobal('fetch', fetchSpy);
    const request = new Request('https://app.invalid/proxy', {
      method: 'POST',
      body: JSON.stringify({ baseUrl: 'https://upstream.invalid', apiKey: 'secret', kind: 'chat', body: { prompt: 'hi' } }),
    });

    const response = await handleUpstreamProxyRequest<Payload>(request, options);

    expect(fetchSpy).toHaveBeenCalledWith('https://upstream.invalid/chat', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ prompt: 'hi' }),
      signal: request.signal,
    }));
    expect(response.status).toBe(202);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(await response.text()).toBe('stream-body');
  });

  it('turns upstream failures into a diagnosable 502 response', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => { throw new Error('network down'); }));
    const response = await handleUpstreamProxyRequest<Payload>(new Request('https://app.invalid/proxy', {
      method: 'POST',
      body: JSON.stringify({ baseUrl: 'https://upstream.invalid', apiKey: 'secret' }),
    }), options);

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'network down' });
  });
});
