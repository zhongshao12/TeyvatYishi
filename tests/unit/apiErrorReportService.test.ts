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
