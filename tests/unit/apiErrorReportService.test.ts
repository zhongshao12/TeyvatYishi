import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  loadSetting: vi.fn<(key: string) => Promise<unknown>>(async () => []),
  saveSetting: vi.fn<(key: string, value: unknown) => Promise<void>>(async () => undefined),
}));

vi.mock('../../services/dbService', () => dbMocks);

import * as apiErrorReportService from '../../services/ai/apiErrorReportService';

type UrlSanitizer = (value: string | undefined) => string | undefined;

function sanitize(value: string | undefined): string | undefined {
  const candidate = Reflect.get(apiErrorReportService, 'sanitizeApiErrorReportUrl') as unknown;
  return typeof candidate === 'function'
    ? (candidate as UrlSanitizer)(value)
    : value;
}

describe('sanitizeApiErrorReportUrl', () => {
  beforeEach(() => {
    dbMocks.loadSetting.mockClear();
    dbMocks.loadSetting.mockResolvedValue([]);
    dbMocks.saveSetting.mockClear();
  });

  it('redacts secret query parameters without changing diagnostic parameters', () => {
    const original = 'https://generativelanguage.googleapis.com/v1beta/models?key=gg-secret&alt=json';
    const sanitized = sanitize(original);
    const parsed = new URL(sanitized ?? '');

    expect(parsed.searchParams.get('key')).toBe('[REDACTED]');
    expect(parsed.searchParams.get('alt')).toBe('json');
  });

  it.each(['key', 'API_KEY', 'apikey', 'access_token', 'token'])(
    'redacts the %s query parameter case-insensitively',
    (parameter) => {
      const sanitized = sanitize(`/models?${parameter}=secret-value&limit=20`);

      expect(sanitized).not.toContain('secret-value');
      expect(sanitized).toContain(`${parameter}=[REDACTED]`);
      expect(sanitized).toContain('limit=20');
    },
  );

  it('keeps absent URLs absent', () => {
    expect(sanitize(undefined)).toBeUndefined();
  });

  it('sanitizes the URL at the persistence boundary', async () => {
    await apiErrorReportService.appendApiErrorReport({
      source: 'Gemini 模型列表',
      requestUrl: 'https://example.test/models?key=must-not-be-saved&alt=json',
      requestMode: 'models',
      error: new Error('network failed'),
    });

    const storedReports = dbMocks.saveSetting.mock.calls[0]?.[1] as Array<{ requestUrl?: string }>;
    expect(storedReports[0]?.requestUrl).not.toContain('must-not-be-saved');
    expect(storedReports[0]?.requestUrl).toContain('key=[REDACTED]');
  });

  it('sanitizes previously stored reports before returning them', async () => {
    dbMocks.loadSetting.mockResolvedValueOnce([{
      id: 'legacy-report',
      createdAt: '2026-09-10T00:00:00.000Z',
      source: 'Gemini 模型列表',
      provider: 'gemini',
      model: '',
      baseUrl: 'https://example.test',
      apiKeyHint: '********aved',
      requestUrl: 'https://example.test/models?key=previously-saved-secret',
      requestMode: 'models',
      message: 'network failed',
    }]);

    const reports = await apiErrorReportService.loadApiErrorReports();

    expect(reports[0]?.requestUrl).not.toContain('previously-saved-secret');
    expect(reports[0]?.requestUrl).toContain('key=[REDACTED]');
    expect(dbMocks.saveSetting).toHaveBeenCalledWith(
      apiErrorReportService.API_ERROR_REPORTS_KEY,
      reports,
    );
  });
});

// ── B19：诊断报告只脱敏 requestUrl，baseUrl / message / responseText 会原样带出 API Key ──

type ReportBuilder = (report: Record<string, unknown>) => Record<string, unknown>;

function buildSanitizedReport(report: Record<string, unknown>): Record<string, unknown> {
  const candidate = Reflect.get(apiErrorReportService, 'sanitizeApiErrorReportFields') as unknown;
  if (typeof candidate !== 'function') return report;
  return (candidate as ReportBuilder)(report);
}

function legacyReport(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'legacy-secret-report',
    createdAt: '2026-09-10T00:00:00.000Z',
    source: '主剧情',
    provider: 'openai_compatible',
    model: 'gpt-4o-mini',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyHint: '********1234',
    requestMode: 'stream',
    message: 'request failed',
    ...overrides,
  };
}

describe('diagnostic report redaction beyond requestUrl', () => {
  beforeEach(() => {
    dbMocks.loadSetting.mockClear();
    dbMocks.loadSetting.mockResolvedValue([]);
    dbMocks.saveSetting.mockClear();
  });

  it('redacts a key embedded in baseUrl', () => {
    const sanitized = buildSanitizedReport(legacyReport({
      baseUrl: 'https://gateway.test/v1?key=sk-live-baseurl-secret',
    }));

    expect(JSON.stringify(sanitized)).not.toContain('sk-live-baseurl-secret');
    expect(String(sanitized.baseUrl)).toContain('[REDACTED]');
  });

  it('redacts a key echoed inside message', () => {
    const sanitized = buildSanitizedReport(legacyReport({
      message: 'Authorization: Bearer sk-live-message-secret rejected',
    }));

    expect(String(sanitized.message)).not.toContain('sk-live-message-secret');
    expect(String(sanitized.message)).toContain('rejected');
  });

  it('redacts keys echoed inside responseText in several provider shapes', () => {
    const sanitized = buildSanitizedReport(legacyReport({
      responseText: [
        '{"error":{"message":"invalid api_key: \\"sk-ant-response-secret\\""}}',
        'x-goog-api-key: AIzaSyDUMMYgOOGLEsecret1234567890',
        'curl -H "Authorization: Bearer gsk_dummyGrokSecret123456"',
      ].join('\n'),
    }));
    const text = String(sanitized.responseText);

    expect(text).not.toContain('sk-ant-response-secret');
    expect(text).not.toContain('AIzaSyDUMMYgOOGLEsecret1234567890');
    expect(text).not.toContain('gsk_dummyGrokSecret123456');
    expect(text).toContain('invalid api_key');
  });

  it('redacts a key inside a nested URL in the response body', () => {
    const sanitized = buildSanitizedReport(legacyReport({
      responseText: '{"detail":"check https://dash.test/keys?access_token=nested-token-secret&alt=json"}',
    }));
    const text = String(sanitized.responseText);

    expect(text).not.toContain('nested-token-secret');
    expect(text).toContain('access_token=[REDACTED]');
    expect(text).toContain('alt=json');
  });

  it('redacts every credential field at the persistence boundary', async () => {
    await apiErrorReportService.appendApiErrorReport({
      source: '主剧情',
      config: {
        provider: 'openai_compatible',
        model: 'gpt-4o-mini',
        baseUrl: 'https://gateway.test/v1?apikey=sk-live-config-secret',
      },
      status: 401,
      requestUrl: 'https://gateway.test/v1/chat?key=sk-live-url-secret',
      requestMode: 'stream',
      error: new Error('upstream said token=sk-live-error-secret is invalid'),
      responseText: '{"error":"apiKey: sk-live-body-secret"}',
    });

    const stored = dbMocks.saveSetting.mock.calls[0]?.[1] as Array<Record<string, unknown>>;
    const serialized = JSON.stringify(stored);
    for (const secret of [
      'sk-live-config-secret',
      'sk-live-url-secret',
      'sk-live-error-secret',
      'sk-live-body-secret',
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(String(stored[0]?.baseUrl)).toContain('[REDACTED]');
    expect(String(stored[0]?.message)).toContain('[REDACTED]');
    expect(String(stored[0]?.responseText)).toContain('[REDACTED]');
  });

  it('redacts historical reports loaded from disk', async () => {
    dbMocks.loadSetting.mockResolvedValueOnce([legacyReport({
      baseUrl: 'https://gateway.test/v1?key=sk-live-history-base',
      message: 'apikey=sk-live-history-message',
      responseText: '{"error":"key sk-live-history-body rejected"}',
    })]);

    const reports = await apiErrorReportService.loadApiErrorReports();
    const serialized = JSON.stringify(reports);

    expect(serialized).not.toContain('sk-live-history-base');
    expect(serialized).not.toContain('sk-live-history-message');
    expect(serialized).not.toContain('sk-live-history-body');
    expect(dbMocks.saveSetting).toHaveBeenCalledWith(
      apiErrorReportService.API_ERROR_REPORTS_KEY,
      reports,
    );
  });

  it('does not damage diagnostics that carry no credentials', async () => {
    await apiErrorReportService.appendApiErrorReport({
      source: 'Claude 非流式补全',
      config: { provider: 'claude', model: 'claude-sonnet-4-5', baseUrl: 'https://api.anthropic.com' },
      status: 429,
      requestUrl: 'https://api.anthropic.com/v1/messages?alt=json&limit=20',
      requestMode: 'non-stream',
      error: new Error('rate limit exceeded, retry after 30s'),
    });

    const stored = dbMocks.saveSetting.mock.calls[0]?.[1] as Array<Record<string, unknown>>;
    expect(stored[0]?.baseUrl).toBe('https://api.anthropic.com');
    expect(stored[0]?.message).toBe('rate limit exceeded, retry after 30s');
    expect(stored[0]?.requestUrl).toBe('https://api.anthropic.com/v1/messages?alt=json&limit=20');
  });
});

describe('diagnostic report copy output', () => {
  beforeEach(() => {
    dbMocks.loadSetting.mockClear();
    dbMocks.loadSetting.mockResolvedValue([]);
    dbMocks.saveSetting.mockClear();
  });

  it('copies a redacted report when the caller supplies a raw report', async () => {
    const tab = await import('../../components/features/Settings/ApiErrorReportsTab');
    const formatReport = Reflect.get(tab, 'formatReport') as unknown;
    expect(typeof formatReport).toBe('function');

    const text = (formatReport as ReportBuilder)(legacyReport({
      apiKeyHint: '********1234',
      baseUrl: 'https://gateway.test/v1?key=sk-live-copy-base',
      message: 'Bearer sk-live-copy-message',
      responseText: '{"error":"key sk-live-copy-body"}',
    })) as unknown as string;

    expect(text).not.toContain('sk-live-copy-base');
    expect(text).not.toContain('sk-live-copy-message');
    expect(text).not.toContain('sk-live-copy-body');
    expect(text).toContain('主剧情');
    expect(text).toContain('API Key');
    expect(text).toContain('[REDACTED]');
  });
});
