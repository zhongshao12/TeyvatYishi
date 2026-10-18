import { afterEach, describe, expect, it, vi } from 'vitest';
import type { API配置项 } from '@/models/settings';
import {
  ANT_LING_API_BASE,
  ANT_LING_PROXY_PREFIX,
  buildAntLingProxyBody,
  clampAntLingTemperature,
  isAntLingBaseUrl,
  isAntLingThinkingModel,
  normalizeAntLingBaseUrl,
} from '@/services/ai/antLingPolicy';
import { assertAntLingBaseUrl, handleAntLingProxyRequest } from '@/services/ai/antLingProxyCore';
import { chatCompletion, chatCompletionNonStream } from '@/services/ai/chatCompletionClient';
import { fetchOpenAICompatibleModels } from '@/services/ai/openAICompatibleModels';

vi.mock('@/services/ai/apiErrorReportService', () => ({ appendApiErrorReport: vi.fn(async () => undefined) }));
afterEach(() => vi.unstubAllGlobals());

const baseConfig = (overrides: Partial<API配置项> = {}): API配置项 => ({
  id: 'ant-ling', name: '蚂蚁百灵', provider: 'openai_compatible',
  baseUrl: ANT_LING_API_BASE, apiKey: 'test-key-not-real', model: 'Ling-3.1-flash',
  temperature: 1.4, createdAt: 1, updatedAt: 1, ...overrides,
});

describe('ant ling base url normalization', () => {
  it.each([
    ['https://api.ant-ling.com', 'https://api.ant-ling.com/v1'],
    ['https://api.ant-ling.com/', 'https://api.ant-ling.com/v1'],
    ['https://api.ant-ling.com/v1/', 'https://api.ant-ling.com/v1'],
    ['https://api.ant-ling.com/v1/chat/completions', 'https://api.ant-ling.com/v1'],
    ['https://api.ant-ling.com/chat/completions', 'https://api.ant-ling.com/v1'],
    ['https://api.ant-ling.com/v1/models', 'https://api.ant-ling.com/v1'],
    ['https://api.ant-ling.com/v1?debug=1', 'https://api.ant-ling.com/v1'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeAntLingBaseUrl(input)).toBe(expected);
    expect(isAntLingBaseUrl(input)).toBe(true);
  });

  it('leaves other providers untouched and rejects lookalike hosts', () => {
    expect(normalizeAntLingBaseUrl('https://example.invalid/v1')).toBe('https://example.invalid/v1');
    expect(isAntLingBaseUrl('https://example.invalid/v1')).toBe(false);
    expect(isAntLingBaseUrl('http://api.ant-ling.com/v1')).toBe(false);
    expect(isAntLingBaseUrl('https://api.ant-ling.com.evil.example/v1')).toBe(false);
    expect(isAntLingBaseUrl('https://evil.example/?next=https://api.ant-ling.com/v1')).toBe(false);
    expect(() => assertAntLingBaseUrl('https://evil.example/v1')).toThrow('api.ant-ling.com');
  });
});

describe('ant ling request policy', () => {
  it('clamps temperature into the documented [0, 1] range only for ant ling', () => {
    expect(clampAntLingTemperature(1.5)).toBe(1);
    expect(clampAntLingTemperature(-0.2)).toBe(0);
    expect(clampAntLingTemperature(0.7)).toBe(0.7);
    expect(clampAntLingTemperature(Number.NaN)).toBeUndefined();
    expect(clampAntLingTemperature(undefined)).toBeUndefined();
  });

  it('only disables thinking on the 3.0 / 3.1 series', () => {
    expect(isAntLingThinkingModel('Ling-3.1-flash')).toBe(true);
    expect(isAntLingThinkingModel('Ling-3.0-flash-VL')).toBe(true);
    expect(isAntLingThinkingModel('Ling-3.0-tiny')).toBe(true);
    expect(isAntLingThinkingModel('Ling-2.6-flash')).toBe(false);
    expect(isAntLingThinkingModel('Ring-2.6-1T')).toBe(false);
    expect(isAntLingThinkingModel('AntAngelMed')).toBe(false);
  });

  it('builds a proxy body that carries the normalized base url', () => {
    const body = JSON.parse(buildAntLingProxyBody({ baseUrl: 'https://api.ant-ling.com', apiKey: 'k' }, { model: 'Ling-3.1-flash' }));
    expect(body).toEqual({ kind: 'chat', baseUrl: 'https://api.ant-ling.com/v1', apiKey: 'k', body: { model: 'Ling-3.1-flash' } });
    const models = JSON.parse(buildAntLingProxyBody({ baseUrl: ANT_LING_API_BASE, apiKey: 'k' }, {}, 'models'));
    expect(models.kind).toBe('models');
  });
});

describe('ant ling proxy handler', () => {
  const proxyRequest = (payload: unknown): Request => new Request('https://game.example.com/api/antling', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  });

  it('forwards chat to the official host only, with the caller key', async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => { seen.url = url; seen.init = init; return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }); });
    const response = await handleAntLingProxyRequest(proxyRequest({ kind: 'chat', baseUrl: 'https://api.ant-ling.com', apiKey: 'secret-key', body: { model: 'Ling-3.1-flash', messages: [] } }));
    expect(response.status).toBe(200);
    expect(seen.url).toBe('https://api.ant-ling.com/v1/chat/completions');
    expect(seen.init?.method).toBe('POST');
    expect(new Headers(seen.init?.headers).get('authorization')).toBe('Bearer secret-key');
    expect(JSON.parse(String(seen.init?.body))).toEqual({ model: 'Ling-3.1-flash', messages: [] });
  });

  it('uses GET /v1/models for catalog requests', async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => { seen.url = url; seen.init = init; return new Response('{"data":[]}'); });
    await handleAntLingProxyRequest(proxyRequest({ kind: 'models', baseUrl: ANT_LING_API_BASE, apiKey: 'k' }));
    expect(seen.url).toBe('https://api.ant-ling.com/v1/models');
    expect(seen.init?.method).toBe('GET');
    expect(seen.init?.body).toBeUndefined();
  });

  it('refuses to act as an open relay and reports missing credentials', async () => {
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    const foreign = await handleAntLingProxyRequest(proxyRequest({ kind: 'chat', baseUrl: 'https://evil.example/v1', apiKey: 'k', body: {} }));
    expect(foreign.status).toBe(502);
    expect(await foreign.text()).toContain('api.ant-ling.com');
    const missing = await handleAntLingProxyRequest(proxyRequest({ kind: 'chat', baseUrl: ANT_LING_API_BASE }));
    expect(missing.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe('ant ling client routing', () => {
  it('sends non-stream requests through the same-origin proxy with thinking disabled and clamped temperature', async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      seen.url = url; seen.init = init;
      return new Response(JSON.stringify({ choices: [{ message: { content: '你好' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { headers: { 'content-type': 'application/json' } });
    });
    const text = await chatCompletionNonStream(baseConfig(), { messages: [{ role: 'user', content: '你好' }], deepSeekRecovery: 'disabled' });
    expect(text).toBe('你好');
    expect(seen.url).toBe(ANT_LING_PROXY_PREFIX);
    expect(new Headers(seen.init?.headers).get('authorization')).toBeNull();
    const payload = JSON.parse(String(seen.init?.body));
    expect(payload).toMatchObject({ kind: 'chat', baseUrl: 'https://api.ant-ling.com/v1', apiKey: 'test-key-not-real' });
    expect(payload.body).toMatchObject({ model: 'Ling-3.1-flash', stream: false, temperature: 1, thinking: { type: 'disabled' } });
  });

  it('keeps ordinary OpenAI-compatible configs direct, without proxy or thinking fields', async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      seen.url = url; seen.init = init;
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { headers: { 'content-type': 'application/json' } });
    });
    await chatCompletionNonStream(baseConfig({ baseUrl: 'https://example.invalid/v1', model: 'gpt-4o', temperature: 1.4 }), { messages: [{ role: 'user', content: 'hi' }], deepSeekRecovery: 'disabled' });
    expect(seen.url).toBe('https://example.invalid/v1/chat/completions');
    expect(new Headers(seen.init?.headers).get('authorization')).toBe('Bearer test-key-not-real');
    const payload = JSON.parse(String(seen.init?.body));
    expect(payload.model).toBe('gpt-4o');
    expect(payload.temperature).toBe(1.4);
    expect(payload.thinking).toBeUndefined();
  });

  it('streams through the proxy and tolerates the usage-only trailing chunk', async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const frames = [
      { choices: [{ delta: { content: '你' } }] },
      { choices: [{ delta: { content: '好' } }] },
      { choices: [{ delta: { content: '' }, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } },
    ];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      seen.url = url; seen.init = init;
      return new Response(`${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('')}data: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const deltas: string[] = [];
    const onDone = vi.fn();
    const onUsage = vi.fn();
    const text = await chatCompletion(baseConfig(), { messages: [{ role: 'user', content: '你好' }], deepSeekRecovery: 'disabled', onUsage }, {
      onDelta: (delta) => deltas.push(delta), onDone, onError: () => {},
    });
    expect(seen.url).toBe(ANT_LING_PROXY_PREFIX);
    expect(text).toBe('你好');
    expect(deltas).toEqual(['你', '好']);
    expect(onDone).toHaveBeenCalledOnce();
    // usage 来自官方结尾帧，不需要非文档的 stream_options。
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ totalTokens: 30 }));
    expect(JSON.parse(String(seen.init?.body)).body.stream_options).toBeUndefined();
  });

  it('loads the model catalog through the proxy and surfaces auth failures', async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      seen.url = url; seen.init = init;
      return new Response(JSON.stringify({ data: [{ id: 'Ling-3.1-flash' }, { id: 'Ling-3.0-tiny' }] }), { headers: { 'content-type': 'application/json' } });
    });
    await expect(fetchOpenAICompatibleModels('https://api.ant-ling.com', 'k')).resolves.toEqual(['Ling-3.1-flash', 'Ling-3.0-tiny']);
    expect(seen.url).toBe(ANT_LING_PROXY_PREFIX);
    expect(JSON.parse(String(seen.init?.body))).toMatchObject({ kind: 'models', baseUrl: 'https://api.ant-ling.com/v1' });

    vi.stubGlobal('fetch', async () => new Response('{"error":{"code":401,"message":"授权令牌无效"}}', { status: 401, headers: { 'content-type': 'application/json' } }));
    await expect(fetchOpenAICompatibleModels(ANT_LING_API_BASE, 'k')).rejects.toThrow('蚂蚁百灵 /models 失败 401');
  });
});
