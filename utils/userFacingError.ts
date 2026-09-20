// 面向玩家的错误文案映射。
//
// 背景：供应商响应体、`Failed to fetch`、`No response body` 这类原始异常字符串
// 直接把英文/JSON 推给玩家既看不懂也不可操作。所有 UI 展示层应先经过这里，
// 只暴露「发生了什么 + 该做什么」两句中文。
//
// 这里只做映射，不改 services/ai 的抛错行为：服务层保留原始错误便于日志排查，
// UI 层负责翻译。

export interface UserFacingErrorOptions {
  /** 操作名，用于兜底文案，例如「保存」「读取存档」。 */
  action?: string;
  /** 直接指定兜底文案，优先于 action。 */
  fallback?: string;
}

const NETWORK_MESSAGE = '网络不可用，请检查连接';
const TIMEOUT_MESSAGE = '请求超时，请检查网络或接口设置后重试';
const EMPTY_BODY_MESSAGE = '接口没有返回内容，请检查接口设置';
const INVALID_BODY_MESSAGE = '接口返回的内容不是有效数据，请检查接口设置';
const CANCELLED_MESSAGE = '请求已取消';
const GENERIC_MESSAGE = '请求失败，请重试或检查接口设置';

/** 单条可展示文案的长度上限：超过就不像人写的，视作原始响应体。 */
const MAX_SHOWN_LENGTH = 160;

const CJK_PATTERN = /[\u3400-\u9fff]/;

const NETWORK_PATTERNS: RegExp[] = [
  /failed to fetch/i,
  /networkerror/i,
  /network request failed/i,
  /load failed/i,
  /err_network/i,
  /err_internet_disconnected/i,
  /err_name_not_resolved/i,
  /enotfound/i,
  /econnrefused/i,
  /econnreset/i,
  /socket hang up/i,
  /connection (?:closed|refused|reset)/i,
];

const TIMEOUT_PATTERNS: RegExp[] = [
  /timed? ?out/i,
  /timeout/i,
  /etimedout/i,
  /aborterror:.*timeout/i,
];

const CANCELLED_PATTERNS: RegExp[] = [
  /^aborterror/i,
  /\baborted\b/i,
  /signal is aborted/i,
  /请求已取消/,
];

const EMPTY_BODY_PATTERNS: RegExp[] = [
  /no response body/i,
  /response body is empty/i,
  /empty response/i,
  /返回内容为空/,
];

const INVALID_BODY_PATTERNS: RegExp[] = [
  /unexpected token/i,
  /is not valid json/i,
  /json\.parse/i,
  /unexpected end of json/i,
  /failed to parse/i,
];

const API_ERROR_PATTERN = /api\s*error\s*(\d{3})/i;
const HTTP_STATUS_PATTERN = /(?:http|status(?:\s*code)?)\s*[:=]?\s*(\d{3})/i;

/** 按 HTTP / 供应商状态码给出中文说明。未知状态码也保持可读。 */
export function describeApiErrorCode(code: number): string {
  if (code === 400) return `接口请求格式不正确（${code}），请检查接口设置`;
  if (code === 401) return `接口鉴权失败（${code}），请检查 API Key 是否有效`;
  if (code === 402) return `接口余额或配额不足（${code}），请检查账户状态`;
  if (code === 403) return `接口拒绝访问（${code}），请检查 API Key 权限或区域限制`;
  if (code === 404) return `接口地址不存在（${code}），请检查接口地址是否填写正确`;
  if (code === 408) return `接口请求超时（${code}），请稍后重试`;
  if (code === 413) return `请求内容过大（${code}），请缩短上下文后重试`;
  if (code === 422) return `接口无法处理请求内容（${code}），请检查模型与参数设置`;
  if (code === 429) return `请求过于频繁（${code}），请稍后重试或降低并发`;
  if (code >= 500 && code <= 599) return `接口服务异常（${code}），请稍后重试`;
  return `接口返回错误（${code}），请检查接口设置`;
}

function rawMessageOf(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message || '';
  if (error && typeof error === 'object') {
    const candidate = (error as { message?: unknown }).message;
    if (typeof candidate === 'string') return candidate;
  }
  return '';
}

/**
 * 是否是项目自己写的、已经面向玩家的中文文案。
 * 这类文案直接放行（例如「存档包中没有可导入的存档节点。」），
 * 否则一律换成通用中文，避免把供应商响应体透出去。
 */
function isLocalizedMessage(message: string): boolean {
  if (!message.trim()) return false;
  if (message.length > MAX_SHOWN_LENGTH) return false;
  if (message.includes('{') || message.includes('}')) return false;
  if (!CJK_PATTERN.test(message)) return false;
  // 中英混合的长错误（含栈信息）不可信。
  if (/https?:\/\//i.test(message)) return false;
  return true;
}

function matchesAny(patterns: readonly RegExp[], message: string): boolean {
  return patterns.some((pattern) => pattern.test(message));
}

/**
 * 把任意异常转换成可以给玩家看的中文文案。
 * 永远不会返回原始供应商响应体或未翻译的英文传输错误。
 */
export function toUserFacingError(error: unknown, options: UserFacingErrorOptions = {}): string {
  const fallback = options.fallback ?? (options.action ? `${options.action}失败，请重试或检查接口设置` : GENERIC_MESSAGE);
  const message = rawMessageOf(error).trim();
  if (!message) return fallback;

  if (matchesAny(CANCELLED_PATTERNS, message)) return CANCELLED_MESSAGE;
  if (matchesAny(TIMEOUT_PATTERNS, message)) return TIMEOUT_MESSAGE;
  if (matchesAny(NETWORK_PATTERNS, message)) return NETWORK_MESSAGE;
  if (matchesAny(EMPTY_BODY_PATTERNS, message)) return EMPTY_BODY_MESSAGE;

  const apiCode = API_ERROR_PATTERN.exec(message) ?? HTTP_STATUS_PATTERN.exec(message);
  if (apiCode?.[1]) {
    const code = Number(apiCode[1]);
    if (Number.isFinite(code)) return describeApiErrorCode(code);
  }

  if (matchesAny(INVALID_BODY_PATTERNS, message)) return INVALID_BODY_MESSAGE;
  if (isLocalizedMessage(message)) return message;
  return fallback;
}
