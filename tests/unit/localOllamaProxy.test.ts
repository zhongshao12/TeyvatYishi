import { expect, it, vi } from 'vitest';
import { handleLocalOllamaProxyRequest } from '@/services/ai/localOllamaProxyCore';
const model = 'gemma4-heretic-128k:latest';
const request = (path = '/v1/chat/completions', origin = 'http://127.0.0.1:3000', body: unknown = { model, messages: [{ role: 'user', content: '你好' }], stream: false, reasoning_effort: 'none' }) => new Request('http://127.0.0.1:3000/api/local-ollama' + path, {
  method: path === '/v1/models' ? 'GET' : 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, ...(path === '/v1/models' ? {} : { body: JSON.stringify(body) }),
});
it('forwards the frozen local target and request stream without accepting user-supplied upstream addresses', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const response = await handleLocalOllamaProxyRequest(request(), { remoteAddress: '127.0.0.1', fetch: async (url, init) => { calls.push({ url: String(url), init: init! }); return new Response('data: {"choices":[{"delta":{"content":"你好"}}]}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }); } });
  expect(response.status).toBe(200); expect(await response.text()).toContain('你好'); expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toBe('http://127.0.0.1:11434/v1/chat/completions'); expect(calls[0]!.init.redirect).toBe('error');
  expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ model, reasoning_effort: 'none' });
  expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
});
it.each([
  ['foreign origin', () => request('/v1/chat/completions', 'https://evil.invalid'), '127.0.0.1', 403],
  ['LAN peer', () => request(), '192.168.1.8', 403],
  ['rebound hostname', () => new Request('http://evil.invalid:3000/api/local-ollama/v1/models'), '127.0.0.1', 403],
  ['unknown path', () => request('/api/pull'), '127.0.0.1', 404],
  ['external address override', () => request('/v1/chat/completions', 'http://127.0.0.1:3000', { model, messages: [], baseUrl: 'https://evil.invalid' }), '127.0.0.1', 400],
  ['cloud model', () => request('/v1/chat/completions', 'http://127.0.0.1:3000', { model: 'some-cloud-model', messages: [] }), '127.0.0.1', 400],
  ['cross-site simple request', () => new Request('http://127.0.0.1:3000/api/local-ollama/v1/chat/completions', { method: 'POST', headers: { 'Sec-Fetch-Site': 'cross-site' }, body: '{}' }), '127.0.0.1', 403],
] as const)('rejects %s before contacting the model', async (_label, create, remoteAddress, status) => {
  const upstream = vi.fn(async () => Response.json({}));
  expect((await handleLocalOllamaProxyRequest(create(), { remoteAddress, fetch: upstream })).status).toBe(status); expect(upstream).not.toHaveBeenCalled();
});
it('lists models locally, never follows redirects, and forwards caller cancellation', async () => {
  const abort = new AbortController(); let actualSignal: AbortSignal | undefined;
  const input = request('/v1/models');
  const response = await handleLocalOllamaProxyRequest(new Request(input, { signal: abort.signal }), { remoteAddress: '::ffff:127.0.0.1', fetch: async (url, init) => {
    expect(String(url)).toBe('http://127.0.0.1:11434/v1/models'); expect(init?.method).toBe('GET'); actualSignal = init?.signal ?? undefined;
    return Response.json({ data: [{ id: model }] });
  } });
  expect(await response.json()).toEqual({ data: [{ id: model }] }); abort.abort(); expect(actualSignal?.aborted).toBe(true);
});
