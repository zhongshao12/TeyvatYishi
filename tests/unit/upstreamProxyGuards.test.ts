import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertArkBaseUrl, handleArkProxyRequest, isArkBaseUrl } from '@/services/ai/arkProxyCore';
import { assertPioneerBaseUrl, isPioneerBaseUrl } from '@/services/ai/pioneerProxyCore';
import { assertOpenCodeBaseUrl } from '@/services/ai/opencodeProxyCore';
import { handleQianfanProxyRequest } from '@/services/ai/qianfanProxyCore';

const ARK_CANONICAL = 'https://ark.cn-beijing.volces.com/api/v3';
const PIONEER_CANONICAL = 'https://api.pioneer.ai/v1';
const OPENCODE_CANONICAL = 'https://opencode.ai/zen/v1';

const HOSTILE_BASE_URLS = [
  'http://ark.cn-beijing.volces.com/api/v3',
  'https://ark.cn-beijing.volces.com.evil.example/api/v3',
  'https://ark.cn-beijing.volces.com@evil.example/api/v3',
  'https://evil.example/api/v3',
  'https://127.0.0.1/api/v3',
  'https://169.254.169.254/api/v3',
  'https://10.0.0.5/api/v3',
  'https://192.168.1.10/api/v3',
  'https://[::1]/api/v3',
  'file:///etc/passwd',
  'data:text/html;base64,PHNjcmlwdD4=',
  `${ARK_CANONICAL}/../../../etc/passwd`,
  '',
];

function proxyRequest(body: unknown): Request {
  return new Request('https://app.invalid/api/proxy', { method: 'POST', body: JSON.stringify(body) });
}

describe('provider base URL invariants (SSRF single point of failure)', () => {
  it('accepts only the canonical Ark endpoint and normalizes the documented suffixes', () => {
    expect(assertArkBaseUrl(ARK_CANONICAL)).toBe(ARK_CANONICAL);
    expect(assertArkBaseUrl(`${ARK_CANONICAL}/`)).toBe(ARK_CANONICAL);
    expect(assertArkBaseUrl(`${ARK_CANONICAL}/chat/completions`)).toBe(ARK_CANONICAL);
    expect(assertArkBaseUrl(`${ARK_CANONICAL}/models?x=1`)).toBe(ARK_CANONICAL);
    expect(isArkBaseUrl(ARK_CANONICAL)).toBe(true);
  });

  it('rejects every non-canonical Ark base URL', () => {
    for (const baseUrl of HOSTILE_BASE_URLS) {
      expect(() => assertArkBaseUrl(baseUrl), `Ark 必须拒绝 ${baseUrl}`).toThrow('仅允许代理火山方舟');
    }
  });

  it('rejects every non-canonical Pioneer base URL', () => {
    expect(assertPioneerBaseUrl(PIONEER_CANONICAL)).toBe(PIONEER_CANONICAL);
    expect(isPioneerBaseUrl(PIONEER_CANONICAL)).toBe(true);
    for (const baseUrl of HOSTILE_BASE_URLS) {
      expect(() => assertPioneerBaseUrl(baseUrl), `Pioneer 必须拒绝 ${baseUrl}`).toThrow('仅允许代理 Pioneer');
    }
    expect(() => assertPioneerBaseUrl('https://api.pioneer.ai.evil.example/v1')).toThrow();
  });

  it('rejects every non-canonical OpenCode Zen base URL', () => {
    expect(assertOpenCodeBaseUrl(OPENCODE_CANONICAL)).toBe(OPENCODE_CANONICAL);
    for (const baseUrl of HOSTILE_BASE_URLS) {
      expect(() => assertOpenCodeBaseUrl(baseUrl), `OpenCode 必须拒绝 ${baseUrl}`).toThrow('仅允许代理 OpenCode Zen');
    }
    expect(() => assertOpenCodeBaseUrl('https://opencode.ai.evil.example/zen/v1')).toThrow();
  });
});

describe('proxy handlers never fetch a non-allow-listed address', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('aborts an Ark request whose base URL points at a non-provider host', async () => {
    const fetchSpy = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchSpy);

    const response = await handleArkProxyRequest(proxyRequest({
      baseUrl: 'https://169.254.169.254/api/v3',
      apiKey: 'attacker-key',
      kind: 'chat',
      body: { model: 'm' },
    }));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('仅允许代理火山方舟') });
  });

  it('aborts a Qianfan request whose base URL points at a non-provider host', async () => {
    const fetchSpy = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchSpy);

    const response = await handleQianfanProxyRequest(proxyRequest({
      baseUrl: 'http://127.0.0.1:8080',
      apiKey: 'attacker-key',
      kind: 'chat',
      body: { model: 'm' },
    }));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('仅允许代理百度千帆') });
  });
});
