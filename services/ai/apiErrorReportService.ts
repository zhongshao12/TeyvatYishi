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
    // 诊断报告**自身**写失败不能完全静默（用户第 5 项点名的静默失败之一）：
    // 否则「没有报错报告」会被误读成「没有出错」。
    console.warn('[apiErrorReport] failed to persist report', err);
    try {
      const { reportFailure } = await import('@/utils/failureCenterStore');
      reportFailure({
        source: 'diagnostics',
        reasonCode: 'api_error_report_unwritable',
        humanReason: '接口错误报告写入失败：本次接口异常未被留档。',
        dedupeKey: 'api_error_report_unwritable',
        retryable: 'none',
        diagnostic: { visibleTo: 'developer', text: err instanceof Error ? err.message : String(err) },
      });
    } catch (reportError) {
      console.warn('[apiErrorReport] 失败结算登记失败', reportError);
    }
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
