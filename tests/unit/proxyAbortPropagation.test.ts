import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleArkProxyRequest } from '../../services/ai/arkProxyCore';
import { handleOpenCodeProxyRequest } from '../../services/ai/opencodeProxyCore';
import { handlePioneerProxyRequest } from '../../services/ai/pioneerProxyCore';
import { handleQianfanProxyRequest } from '../../services/ai/qianfanProxyCore';

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
