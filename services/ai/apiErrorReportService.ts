import type { API配置项 } from '@/models/settings';
import { loadSetting, saveSetting } from '@/services/dbService';

export const API_ERROR_REPORTS_KEY = 'apiErrorReports';
const MAX_API_ERROR_REPORTS = 80;
const REDACTED_QUERY_VALUE = '[REDACTED]';
const SECRET_QUERY_PARAMETER = /([?&](?:key|api[_-]?key|apikey|access[_-]?token|token)=)[^&#]*/gi;

export interface ApiErrorReport {
  id: string;
  createdAt: string;
  source: string;
  provider: string;
  model: string;
  baseUrl: string;
  apiKeyHint: string;
  status?: number;
  requestUrl?: string;
  requestMode?: 'stream' | 'non-stream' | 'models' | 'test' | 'unknown';
  message: string;
  responseText?: string;
}

function maskApiKey(apiKey: string): string {
  const key = apiKey.trim();
  if (!key) return '';
  return key.length <= 8 ? '********' : `${'*'.repeat(Math.min(12, key.length - 4))}${key.slice(-4)}`;
}

export function sanitizeApiErrorReportUrl(value: string | undefined): string | undefined {
  if (!value) return value;
  return value.replace(
    SECRET_QUERY_PARAMETER,
    (_match, prefix: string) => `${prefix}${REDACTED_QUERY_VALUE}`,
  );
}

function sanitizeStoredReport(report: ApiErrorReport): ApiErrorReport {
  const requestUrl = sanitizeApiErrorReportUrl(report.requestUrl);
  return requestUrl === report.requestUrl ? report : { ...report, requestUrl };
}

function trimText(value: unknown, maxLength = 4000): string {
  return String(value ?? '').trim().slice(0, maxLength);
}

export async function appendApiErrorReport(input: {
  source: string;
  config?: Partial<API配置项> | null;
  status?: number;
  requestUrl?: string;
  requestMode?: ApiErrorReport['requestMode'];
  error?: unknown;
  responseText?: string;
}): Promise<void> {
  try {
    const current = await loadSetting<ApiErrorReport[]>(API_ERROR_REPORTS_KEY);
    const error = input.error instanceof Error ? input.error : null;
    const report: ApiErrorReport = {
      id: `apierr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      source: input.source,
      provider: input.config?.provider || '',
      model: input.config?.model || '',
      baseUrl: input.config?.baseUrl || '',
      apiKeyHint: maskApiKey(input.config?.apiKey || ''),
      status: input.status,
      requestUrl: sanitizeApiErrorReportUrl(input.requestUrl),
      requestMode: input.requestMode ?? 'unknown',
      message: trimText(error?.message ?? input.error ?? input.responseText ?? '未知错误'),
      responseText: trimText(input.responseText ?? ''),
    };
    const retained = Array.isArray(current) ? current.map(sanitizeStoredReport) : [];
    const next = [report, ...retained].slice(0, MAX_API_ERROR_REPORTS);
    await saveSetting(API_ERROR_REPORTS_KEY, next);
  } catch (err) {
    console.warn('[apiErrorReport] failed to persist report', err);
  }
}

export async function loadApiErrorReports(): Promise<ApiErrorReport[]> {
  const list = await loadSetting<ApiErrorReport[]>(API_ERROR_REPORTS_KEY);
  if (!Array.isArray(list)) return [];
  const sanitized = list.map(sanitizeStoredReport);
  if (sanitized.some((report, index) => report !== list[index])) {
    await saveSetting(API_ERROR_REPORTS_KEY, sanitized);
  }
  return sanitized;
}

export async function clearApiErrorReports(): Promise<void> {
  await saveSetting(API_ERROR_REPORTS_KEY, []);
}
