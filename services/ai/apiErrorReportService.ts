import type { API配置项 } from '@/models/settings';
import { loadSetting, saveSetting } from '@/services/dbService';

export const API_ERROR_REPORTS_KEY = 'apiErrorReports';
const MAX_API_ERROR_REPORTS = 80;
const REDACTED_QUERY_VALUE = '[REDACTED]';
const REDACTED_SECRET_VALUE = '[REDACTED]';
/**
 * 脱敏不只看 URL：供应商常把 Key 回显在错误正文里（`invalid api_key: "sk-..."`、
 * `x-goog-api-key: ...`、`Authorization: Bearer ...`）。诊断报告是可以整份复制/导出的文本，
 * 因此所有文本字段都必须走同一套脱敏，而不是只处理 requestUrl。
 */
const SECRET_HEADER_OR_ASSIGNMENT =
  /((?:(?:proxy-)?authorization|x-api-key|x-goog-api-key|api[_-]?key|apikey|access[_-]?token|auth[_-]?token)["']?\s*[:=>]\s*["']?)(?:(?:bearer|basic)\s+)?[^\s"'&,;}]+/gi;
const BEARER_TOKEN = /(\bbearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi;
/** 常见供应商 Key 前缀；要求至少 8 位前缀后内容，避免误伤普通诊断文本。 */
const KNOWN_KEY_PREFIX =
  /((?:sk|rk|pk|gsk|xai|hf|glm|pplx|jina|sess|AKIA|ASIA|AIza|ghp|github_pat|sk_live|sk_test)[-_a-zA-Z]{0,12}[-_])[A-Za-z0-9_-]{12,}/g;
const KNOWN_KEY_OPAQUE_PREFIX = /\b((?:gsk|AIza))[A-Za-z0-9_-]{16,}/g;
/** URL 查询串里带 Key 的参数：`?key=...` / `&api_key=...` / `?apikey=...`（含大小写变体）。 */
const SECRET_QUERY_VALUE = /([?&](?:key|api[_-]?key|apikey|access[_-]?token|token)=)[^\s"'&,;}]+/gi;

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

/**
 * 统一脱敏任意诊断文本/URL：隐藏密钥、保留其余诊断信息（状态码、模型名、alt/limit 等）。
 */
export function sanitizeApiErrorReportText<T extends string | undefined>(value: T): T {
  if (!value) return value;
  const redacted = value
    .replace(SECRET_QUERY_VALUE, (_match, prefix: string) => `${prefix}${REDACTED_QUERY_VALUE}`)
    .replace(
      SECRET_HEADER_OR_ASSIGNMENT,
      (_match, prefix: string) => `${prefix}${REDACTED_SECRET_VALUE}`,
    )
    .replace(BEARER_TOKEN, (_match, prefix: string) => `${prefix}${REDACTED_SECRET_VALUE}`)
    .replace(KNOWN_KEY_PREFIX, (_match, prefix: string) => `${prefix}${REDACTED_SECRET_VALUE}`)
    .replace(KNOWN_KEY_OPAQUE_PREFIX, (_match, prefix: string) => `${prefix}${REDACTED_SECRET_VALUE}`);
  return redacted as T;
}

/** @deprecated 保留旧名以避免调用方断裂；现在它和文本脱敏是同一套规则。 */
export function sanitizeApiErrorReportUrl(value: string | undefined): string | undefined {
  return sanitizeApiErrorReportText(value);
}

/**
 * 报告的所有文本字段统一脱敏（读取、展示、复制、落盘共用）。
 */
export function sanitizeApiErrorReportFields<T extends ApiErrorReport>(report: T): T {
  const next: ApiErrorReport = {
    ...report,
    source: sanitizeApiErrorReportText(report.source),
    provider: sanitizeApiErrorReportText(report.provider),
    model: sanitizeApiErrorReportText(report.model),
    baseUrl: sanitizeApiErrorReportText(report.baseUrl),
    apiKeyHint: sanitizeApiErrorReportText(report.apiKeyHint),
    requestUrl: sanitizeApiErrorReportText(report.requestUrl),
    message: sanitizeApiErrorReportText(report.message),
    responseText: sanitizeApiErrorReportText(report.responseText),
  };
  const changed = (Object.keys(next) as Array<keyof ApiErrorReport>)
    .some((key) => next[key] !== report[key]);
  return (changed ? next : report) as T;
}

function sanitizeStoredReport(report: ApiErrorReport): ApiErrorReport {
  return sanitizeApiErrorReportFields(report);
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
    // 落盘前就对**所有**文本字段脱敏：报告可以被整份复制/导出，
    // message / responseText 里回显的 Key 与 requestUrl 里的 Key 风险相同。
    const report: ApiErrorReport = sanitizeApiErrorReportFields({
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
    });
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
