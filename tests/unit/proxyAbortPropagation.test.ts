import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleArkProxyRequest } from '../../services/ai/arkProxyCore';
import { handleOpenCodeProxyRequest } from '../../services/ai/opencodeProxyCore';
import { handlePioneerProxyRequest } from '../../services/ai/pioneerProxyCore';
import { handleQianfanProxyRequest } from '../../services/ai/qianfanProxyCore';
import { onRequestPost as arkPost } from '@/functions/api/ark';
import { onRequestPost as openCodePost } from '@/functions/api/opencode';
import { onRequestPost as pioneerPost } from '@/functions/api/pioneer';
import { onRequestPost as qianfanPost } from '@/functions/api/qianfan';

const cases = [
  ['Ark', handleArkProxyRequest, { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', apiKey: 'k', kind: 'chat', body: {} }],
  ['Pioneer', handlePioneerProxyRequest, { baseUrl: 'https://api.pioneer.ai/v1', apiKey: 'k', kind: 'chat', body: {} }],
  ['OpenCode', handleOpenCodeProxyRequest, { baseUrl: 'https://opencode.ai/zen/v1', apiKey: 'k', kind: 'chat', body: {} }],
  ['Qianfan', handleQianfanProxyRequest, { baseUrl: 'https://qianfan.baidubce.com/v2', apiKey: 'k', kind: 'models', body: {} }],
] as const;

describe('AI proxy abort propagation', () => {
  afterEach(() => vi.unstubAllGlobals());

  for (const [name, handler, body] of cases) {
    it(`${name} forwards the incoming request signal to upstream fetch`, async () => {
      const fetchSpy = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));
      vi.stubGlobal('fetch', fetchSpy);
      const controller = new AbortController();
      const request = new Request('https://app.invalid/api/proxy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      await handler(request);

      expect(fetchSpy).toHaveBeenCalledOnce();
      expect(fetchSpy.mock.calls[0]?.[1]?.signal).toBe(request.signal);
    });
  }
});

const endpointCases = [
  ['Ark', arkPost, cases[0][2]],
  ['OpenCode', openCodePost, cases[2][2]],
  ['Pioneer', pioneerPost, cases[1][2]],
  ['Qianfan', qianfanPost, cases[3][2]],
] as const;

describe('deployed proxy wrapper cancellation (A06)', () => {
  afterEach(() => vi.unstubAllGlobals());
  for (const [name, post, payload] of endpointCases) {
    it.each(['before', 'connecting', 'body'] as const)(`${name} preserves cancellation during %s`, async phase => {
      let upstreamSignal: AbortSignal | null | undefined;
      let release: (() => void) | undefined;
      const stream = new ReadableStream<Uint8Array>();
      const fetchSpy = vi.fn<typeof fetch>(async (_input, init) => {
        upstreamSignal = init?.signal;
        if (phase === 'connecting') await new Promise<void>(resolve => { release = resolve; });
        return new Response(phase === 'body' ? stream : '{}');
      });
      vi.stubGlobal('fetch', fetchSpy);
      const controller = new AbortController();
      const request = new Request('https://app.invalid/api/proxy', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload), signal: controller.signal,
      });
      if (phase === 'before') controller.abort();
      const pending = post({ request, env: { AI_PROXY_RATE_LIMITER: { limit: async () => ({ success: true }) } } });
      if (phase === 'connecting') {
        await vi.waitFor(() => expect(release).toBeTypeOf('function'));
        controller.abort();
        release!();
      }
      const response = await pending;
      if (phase === 'body') controller.abort();
      const wasAborted = upstreamSignal?.aborted;
      // Close the fixture stream even on the failing path; no real network is used.
      await response.body?.cancel();
      expect(fetchSpy).toHaveBeenCalledOnce();
      expect(wasAborted).toBe(true);
    });
  }
});
