import type { API配置项 } from '@/models/settings';
import type { 聊天消息 } from '@/models/chat';
import { extractUsage, type ChatCompletionUsage } from './usageExtraction';
export type { ChatCompletionUsage } from './usageExtraction';
import { appendApiErrorReport } from './apiErrorReportService';
import { isPioneerBaseUrl, normalizePioneerBaseUrl } from './pioneerProxyCore';
import { buildArkProxyBody, isArkBaseUrl, normalizeArkBaseUrl } from './arkProxyCore';
import { normalizeGeminiBaseUrl } from './geminiEndpointPolicy';
import { detectChatProvider } from './providerRouting';
import { classifyDeepSeekConfig } from './deepSeekModelPolicy';
import { normalizeOpenCodeBaseUrl } from './openCodeEndpointPolicy';
import {
  DEEPSEEK_FINAL_CONTENT_GUARD,
  executeWithDeepSeekRecovery,
  type DeepSeekAttemptDiagnostics,
  type DeepSeekRecoverySummary,
} from './deepSeekRecovery';

export interface StreamCallbacks {
  onDelta: (delta: string) => void;
  /** Recovery/prefix fallback is starting a replacement attempt; discard prior streamed text. */
  onReset?: () => void;
  onDone: () => void;
  onError: (err: Error) => void;
  /** 可选：stream 解析到 finish_reason / stop_reason / finishReason 时回调。
   *  用于抗截断检测（finishReason === 'length' / 'max_tokens' 表示被 max_tokens 截断）。 */
  onFinishReason?: (reason: string) => void;
}

/** 丢弃模型的 reasoning_content / extended thinking / Gemini thought parts。
 *  这类「reasoning summary」是厂商内置格式（英文 **Header** 段），不受 system prompt 控制，
 *  会跳过我们设计的 Step0-Step10 CoT。统一只接收正式 content 流。 */

type ChatMessagePayload = { role: string; content: string; prefix?: boolean };

export interface ChatCompletionRequest {
  messages: ChatMessagePayload[];
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  /** 核采样概率阈值（0-1）。 */
  topP?: number;
  /** 保留概率最高的前 K 个候选词。仅 Gemini 原生消费。 */
  topK?: number;
  /** 动态阈值采样。当前预留，无 provider 实际消费。 */
  topA?: number;
  /** 丢弃概率低于「最高概率 × min_p」的词（0-1）。当前预留。 */
  minP?: number;
  /** 重复惩罚系数（1=不生效，>1 惩罚）。 */
  repetitionPenalty?: number;
  /** 按 token 出现次数线性惩罚（-2 到 2）。 */
  frequencyPenalty?: number;
  /** 只要出现过就惩罚（-2 到 2）。 */
  presencePenalty?: number;
  /** 最大上下文窗口（tokens）。 */
  maxContext?: number;
  signal?: AbortSignal;
  onUsage?: (usage: ChatCompletionUsage) => void;
  /** DeepSeek beta prefix completion. Only the DeepSeek branch reads this flag. */
  prefixMode?: boolean;
  /** Assistant prefill used when prefixMode is true. */
  prefixContent?: string;
  /** Connection diagnostics can disable cross-model recovery. */
  deepSeekRecovery?: 'auto' | 'disabled';
  onDeepSeekRecovery?: (summary: DeepSeekRecoverySummary) => void;
  /** Internal transport diagnostics consumed by the recovery coordinator. */
  onResponseDiagnostics?: (diagnostics: DeepSeekAttemptDiagnostics) => void;
}

export interface StreamWatchdogOptions {
  /** Maximum wait for the provider's first response bytes. */
  firstByteTimeoutMs?: number;
  /** Maximum silence between two stream chunks. */
  idleTimeoutMs?: number;
}

export const DEFAULT_STREAM_FIRST_BYTE_TIMEOUT_MS = 45_000;
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 90_000;

export class StreamTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StreamTimeoutError';
  }
}

/**
 * End ownership of a response stream. Releasing a lock alone leaves an
 * unfinished HTTP body alive, so the provider may continue generating tokens
 * after the local request has already failed or been aborted.
 */
export async function cancelReadableStreamReader<T>(
  reader: ReadableStreamDefaultReader<T>,
  reason: unknown = 'stream-consumer-finished',
): Promise<void> {
  try {
    await reader.cancel(reason);
  } catch {
    // A stream that has already closed/errored cannot always be cancelled.
  }
  try {
    reader.releaseLock();
  } catch {
    // The lock may already have been released by the runtime/provider adapter.
  }
}

/** Shared SSE framing, JSON parsing, abort ownership and response-body teardown. */
export async function readSseStream(
  response: Response,
  signal: AbortSignal | undefined,
  onData: (data: any) => void,
  watchdog: StreamWatchdogOptions = {},
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');
  const decoder = new TextDecoder();
  let buffer = '';
  const abort = () => {
    void reader.cancel(signal?.reason ?? new DOMException('请求已取消。', 'AbortError'));
  };
  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      // A malformed provider frame must not discard later valid frames.
      return;
    }
    onData(parsed);
  };
  const readWithWatchdog = (
    timeoutMs: number,
    phase: 'first-byte' | 'idle',
  ): Promise<ReadableStreamReadResult<Uint8Array>> => {
    if (timeoutMs <= 0) return reader.read();
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutId = globalThis.setTimeout(() => {
        const seconds = Math.max(1, Math.round(timeoutMs / 1000));
        const error = new StreamTimeoutError(
          phase === 'first-byte'
            ? `等待模型首字节超过 ${seconds} 秒。`
            : `模型流连续 ${seconds} 秒没有新内容。`,
        );
        reject(error);
        void reader.cancel(error);
      }, timeoutMs);
    });
    return Promise.race([reader.read(), timeout]).finally(() => {
      if (timeoutId !== undefined) globalThis.clearTimeout(timeoutId);
    });
  };

  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException('请求已取消。', 'AbortError');
    }
    let receivedFirstChunk = false;
    while (true) {
      const timeoutMs = receivedFirstChunk
        ? Math.max(0, watchdog.idleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS)
        : Math.max(0, watchdog.firstByteTimeoutMs ?? DEFAULT_STREAM_FIRST_BYTE_TIMEOUT_MS);
      const { done, value } = await readWithWatchdog(timeoutMs, receivedFirstChunk ? 'idle' : 'first-byte');
      if (done) break;
      receivedFirstChunk = true;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (signal?.aborted) throw signal.reason ?? new DOMException('请求已取消。', 'AbortError');
        consumeLine(line);
      }
    }
    buffer += decoder.decode();
    if (buffer) consumeLine(buffer);
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException('请求已取消。', 'AbortError');
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    await cancelReadableStreamReader(reader, signal?.aborted ? signal.reason : 'sse-consumer-finished');
  }
}

function buildMessages(
  systemPrompt: string | undefined,
  messages: ChatMessagePayload[],
): ChatMessagePayload[] {
  const result: ChatMessagePayload[] = [];
  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt });
  }
  result.push(...messages);
  return result;
}

function isDeepSeekConfig(config: API配置项): boolean {
  return detectChatProvider(config) === 'deepseek' || /deepseek/i.test(config.model);
}

function normalizeDeepSeekPrefixBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed || !/deepseek/i.test(trimmed)) return trimmed;
  if (/\/beta$/i.test(trimmed)) return trimmed;
  if (/\/v\d+$/i.test(trimmed)) return trimmed.replace(/\/v\d+$/i, '/beta');
  return `${trimmed}/beta`;
}

/**
 * Phase 4：通用化 assistant prefill。
 *
 * 按 provider 分流到不同的 prefill 实现：
 * - DeepSeek：baseUrl 改 /beta + { role: 'assistant', content: prefix, prefix: true }（DeepSeek beta 特性）
 * - Claude：末尾追加 { role: 'assistant', content: prefix }（Claude 原生支持 prefill）
 * - Gemini：末尾追加 { role: 'model', content: prefix }（Gemini 原生支持 prefill）
 * - OpenAI 兼容：末尾追加 { role: 'assistant', content: prefix }（部分中转商支持）
 *
 * 不支持的 provider（如 mimo）静默降级，不 prefill。
 * prefix 内容仅从 request.prefixContent 读取；正式 NarrativeTurn 请求默认不做 prefill。
 */
function withPrefixMessages(
  config: API配置项,
  messages: ChatMessagePayload[],
  request: ChatCompletionRequest,
): { config: API配置项; messages: ChatMessagePayload[]; prefix: string } {
  if (request.prefixMode !== true) return { config, messages, prefix: '' };
  const prefix = request.prefixContent ?? '';
  if (!prefix) return { config, messages, prefix: '' };

  const provider = detectChatProvider(config);
  const withoutOldPrefix = messages.filter((msg) => msg.prefix !== true);

  // DeepSeek：走 /beta + prefix: true 标记
  if (provider === 'deepseek') {
    return {
      config: {
        ...config,
        baseUrl: normalizeDeepSeekPrefixBaseUrl(config.baseUrl),
      },
      messages: [
        ...withoutOldPrefix,
        { role: 'assistant', content: prefix, prefix: true },
      ],
      prefix,
    };
  }

  // Claude：末尾追加 assistant 消息（Claude 原生支持 prefill）
  // 注意：normalizeClaudeMessages 会强制末条 user，但 prefill assistant 会在它之前插入
  if (provider === 'claude') {
    return {
      config,
      messages: [
        ...withoutOldPrefix,
        { role: 'assistant', content: prefix, prefix: true },
      ],
      prefix,
    };
  }

  // Gemini：末尾追加 model 消息（Gemini 原生支持 prefill，角色名是 model）
  if (provider === 'gemini') {
    return {
      config,
      messages: [
        ...withoutOldPrefix,
        { role: 'model', content: prefix, prefix: true },
      ],
      prefix,
    };
  }

  // OpenAI 兼容 / OpenCode / Ark / Pioneer 等：末尾追加 assistant 消息
  // 部分中转商支持，不支持的会报错（由上层 try-catch 降级）
  if (provider === 'openai_compatible' || provider === 'opencode' || provider === 'ark' || provider === 'mimo') {
    return {
      config,
      messages: [
        ...withoutOldPrefix,
        { role: 'assistant', content: prefix, prefix: true },
      ],
      prefix,
    };
  }

  // 未知 provider 静默降级
  return { config, messages, prefix: '' };
}

// 兼容旧调用：保留 withDeepSeekPrefixMessages 作为 withPrefixMessages 的别名
function withDeepSeekPrefixMessages(
  config: API配置项,
  messages: ChatMessagePayload[],
  request: ChatCompletionRequest,
): { config: API配置项; messages: ChatMessagePayload[]; prefix: string } {
  return withPrefixMessages(config, messages, request);
}

function stripDeepSeekPrefixMessages(messages: ChatMessagePayload[]): ChatMessagePayload[] {
  return messages
    .filter((msg) => msg.prefix !== true)
    .map((msg) => {
      const { prefix: _prefix, ...rest } = msg;
      return rest;
    });
}

function mergePrefixResult(prefix: string, text: string): string {
  if (!prefix) return text;
  return text.startsWith(prefix) ? text : `${prefix}${text}`;
}

function isDeepSeekPrefixUnsupportedError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? '');
  return /prefix/i.test(text) && /(unsupported|not support|不支持|invalid|beta|400|422)/i.test(text);
}

function normalizeClaudeBaseUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return base.endsWith('/v1') ? base : `${base}/v1`;
}

function buildOpenAICompatibleChatUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(base)) return base;
  return `${base}/chat/completions`;
}

type OpenCodeEndpoint = 'responses' | 'messages' | 'gemini' | 'chat';

function normalizeOpenCodeModelId(model: string): string {
  return model.trim().replace(/^opencode\//i, '');
}

function inferOpenCodeEndpoint(model: string): OpenCodeEndpoint {
  const id = normalizeOpenCodeModelId(model).toLowerCase();
  if (/^gpt[-_]/.test(id)) return 'responses';
  if (/^(claude|qwen)/.test(id)) return 'messages';
  if (/^gemini/.test(id)) return 'gemini';
  return 'chat';
}

function withOpenCodeNormalizedConfig(config: API配置项): API配置项 {
  return {
    ...config,
    baseUrl: normalizeOpenCodeBaseUrl(config.baseUrl),
    model: normalizeOpenCodeModelId(config.model),
  };
}

function openCodeHeaders(config: API配置项, mode: 'openai' | 'anthropic' | 'gemini' = 'openai'): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.apiKey}`,
  };
  if (mode === 'anthropic') {
    headers['x-api-key'] = config.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  }
  if (mode === 'gemini') {
    headers['x-goog-api-key'] = config.apiKey;
  }
  return headers;
}

function buildOpenCodeUrl(config: API配置项, endpoint: OpenCodeEndpoint): string {
  const base = normalizeOpenCodeBaseUrl(config.baseUrl);
  if (endpoint === 'responses') return `${base}/responses`;
  if (endpoint === 'messages') return `${base}/messages`;
  if (endpoint === 'gemini') return `${base}/models/${encodeURIComponent(normalizeOpenCodeModelId(config.model))}`;
  return `${base}/chat/completions`;
}

function buildOpenCodeProxyBody(
  config: API配置项,
  endpoint: OpenCodeEndpoint,
  body: Record<string, unknown>,
  stream: boolean,
): string {
  return JSON.stringify({
    kind: 'chat',
    endpoint,
    baseUrl: normalizeOpenCodeBaseUrl(config.baseUrl),
    apiKey: config.apiKey,
    model: normalizeOpenCodeModelId(config.model),
    stream,
    body,
  });
}

function formatOpenCodeError(config: API配置项, endpoint: OpenCodeEndpoint, status: number, text: string): Error {
  const model = normalizeOpenCodeModelId(config.model);
  const lowerText = text.toLowerCase();
  const path = endpoint === 'responses'
    ? '/responses'
    : endpoint === 'messages'
      ? '/messages'
      : endpoint === 'gemini'
        ? '/models/{model}:generateContent'
        : '/chat/completions';
  const hint = (() => {
    if (lowerText.includes('creditserror') || lowerText.includes('insufficient balance')) {
      return 'OpenCode Zen 工作区余额不足，请先到 OpenCode Billing 充值，或切换到有余额的工作区/API Key。';
    }
    if (status === 401 || status === 403) return '请检查 OpenCode Zen API Key、余额、工作区权限和该模型是否已启用。';
    if (status === 404) return `请检查模型 ID 是否存在于 OpenCode Zen 模型列表；当前模型 ${model || '（空）'} 按 ${path} 路由。GPT 走 /responses，Claude/Qwen 走 /messages，Gemini 走 /models/{model}:generateContent，其余模型走 /chat/completions。`;
    if (status === 400) return '请检查模型 ID、上下文长度和请求参数；如果模型来自 OpenCode 配置示例，可直接填 opencode/xxx，系统会自动去掉 opencode/ 前缀。';
    return '请检查 OpenCode Zen Base URL、模型 ID、Key、余额和模型权限。';
  })();
  return new Error(`OpenCode Zen API Error ${status}: ${hint}\n${text}`);
}

function buildQianfanProxyBody(config: API配置项, body: Record<string, unknown>): string {
  return JSON.stringify({
    kind: 'chat',
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    body,
  });
}

function buildPioneerProxyBody(config: API配置项, body: Record<string, unknown>): string {
  return JSON.stringify({
    kind: 'chat',
    baseUrl: normalizePioneerBaseUrl(config.baseUrl),
    apiKey: config.apiKey,
    body,
  });
}

function isArkConfig(config: API配置项): boolean {
  return config.provider === 'ark' || isArkBaseUrl(config.baseUrl);
}

function isBaiduQianfanConfig(config: API配置项): boolean {
  return config.provider === 'baidu' || /qianfan\.baidubce\.com/i.test(config.baseUrl);
}

function isPioneerConfig(config: API配置项): boolean {
  return isPioneerBaseUrl(config.baseUrl);
}

function isMimoConfig(config: API配置项): boolean {
  return detectChatProvider(config) === 'mimo';
}

function normalizeOpenAICompatibleModel(config: API配置项): string {
  const model = config.model.trim();
  if (isBaiduQianfanConfig(config) && /^glm[-_\s]?5\.1$/i.test(model)) {
    return 'glm-5.1';
  }
  return model;
}

function normalizeMimoBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return trimmed;
  if (/\/v1$/i.test(trimmed)) return trimmed;
  return `${trimmed}/v1`;
}

function buildMimoAuthHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'api-key': apiKey,
  };
}

function buildOpenAICompatibleRequestBody(
  config: API配置项,
  messages: ChatMessagePayload[],
  request: ChatCompletionRequest,
  stream: boolean,
  includeUsage: boolean = true,
): Record<string, unknown> {
  const isMimo = isMimoConfig(config);
  // 智谱 GLM 4.5+ 默认开启思考模式，reasoning_content 会挤占输出预算导致 JSON 截断；
  // 本应用的 NarrativeTurn 协议不需要思考过程，统一禁用。
  const isZaiGlm = /glm-4\.[5-9]|glm-[5-9]/i.test(String(config.model ?? ''));
  const body: Record<string, unknown> = {
    model: normalizeOpenAICompatibleModel(config),
    messages,
    stream,
  };
  if (isMimo || isZaiGlm) {
    body.max_completion_tokens = request.maxTokens ?? config.maxTokens ?? 2048;
    body.thinking = { type: 'disabled' };
  } else {
    body.max_tokens = request.maxTokens ?? config.maxTokens ?? 2048;
    body.temperature = request.temperature ?? config.temperature ?? 0.8;
    // Phase 3：采样参数贯通（OpenAI 兼容 / DeepSeek / Ark / Pioneer 等）
    // top_p / frequency_penalty / presence_penalty / repetition_penalty 大多数 OpenAI 兼容端点支持
    const topP = request.topP ?? config.topP;
    if (typeof topP === 'number') body.top_p = topP;
    const freqPenalty = request.frequencyPenalty ?? config.frequencyPenalty;
    if (typeof freqPenalty === 'number') body.frequency_penalty = freqPenalty;
    const presPenalty = request.presencePenalty ?? config.presencePenalty;
    if (typeof presPenalty === 'number') body.presence_penalty = presPenalty;
    const repPenalty = request.repetitionPenalty ?? config.repetitionPenalty;
    if (typeof repPenalty === 'number') body.repetition_penalty = repPenalty;
    // max_context：OpenAI 兼容端点通常不支持显式字段，但 OpenRouter 等支持 max_context_tokens
    const maxCtx = request.maxContext ?? config.maxContext;
    if (typeof maxCtx === 'number') body.max_context_tokens = maxCtx;
  }
  if (stream && includeUsage && request.onUsage) {
    body.stream_options = { include_usage: true };
  }
  return body;
}

function isStreamUsageOptionUnsupported(status: number, text: string): boolean {
  if (![400, 404, 422].includes(status)) return false;
  const lower = text.toLowerCase();
  return (
    lower.includes('stream_options') ||
    lower.includes('stream options') ||
    lower.includes('include_usage') ||
    lower.includes('include usage') ||
    lower.includes('unsupported parameter') ||
    lower.includes('unknown parameter') ||
    lower.includes('unrecognized parameter') ||
    lower.includes('invalid parameter') ||
    lower.includes('extra_forbidden') ||
    lower.includes('not support')
  );
}

function emitUsageFromResponse(raw: unknown, config: API配置项, request: ChatCompletionRequest): void {
  if (!request.onUsage) return;
  const usage = extractUsage(raw, config);
  if (usage) request.onUsage(usage);
}


function formatOpenAICompatibleError(config: API配置项, status: number, text: string): Error {
  if (isArkConfig(config)) {
    const lower = text.toLowerCase();
    const hint = (() => {
      if (lower.includes('modelnotopen') || lower.includes('model not open')) {
        return '火山方舟模型服务未开通，请到火山方舟控制台开通对应模型后再试。';
      }
      if (status === 401 || status === 403) return '请检查火山方舟 API Key、访问权限和模型服务是否已开通。';
      if (status === 404) return '请检查火山方舟模型 ID、Base URL 是否为 https://ark.cn-beijing.volces.com/api/v3。';
      return '请检查火山方舟 Base URL、模型 ID、API Key、余额和模型服务开通状态。';
    })();
    return new Error(`火山方舟 API Error ${status}: ${hint}\n${text}`);
  }
  if (isBaiduQianfanConfig(config)) {
    const model = config.model.trim();
    const normalized = normalizeOpenAICompatibleModel(config);
    const aliasHint = model && model !== normalized
      ? `已将模型名 ${model} 按百度千帆兼容规则归一为 ${normalized}；`
      : '';
    const lower = text.toLowerCase();
    const hint = (() => {
      if (status === 401 || status === 403) return '请检查百度千帆 API Key、账号权限和 Coding Plan 模型权限；如果错误码是 coding_plan_api_key_not_allowed，说明某个独立 API 仍在用 /v2，代理会自动补试 /v2/coding。';
      if (status === 404) return `${aliasHint}官方 GLM-5.1 的 model 参数接入点 ID 是 glm-5.1；Coding Plan Key 必须继续使用 /v2/coding，系统只会在该路径下尝试大小写别名。若仍 404，请检查该 API Key 的千帆模型列表是否实际包含 glm-5.1，或账号是否开通该模型。`;
      if (status === 400 && (lower.includes('model') || lower.includes('parameter') || lower.includes('1210'))) {
        return `${aliasHint}请优先确认模型 ID 填 glm-5.1；如果仍失败，说明当前千帆账号或 Coding Plan 对该模型/参数未开放。`;
      }
      return `${aliasHint}请检查百度千帆 Base URL、模型 ID、Key 与账号权限。`;
    })();
    return new Error(`百度千帆 API Error ${status}: ${hint}\n${text}`);
  }
  return new Error(`API Error ${status}: ${text}`);
}

async function fetchWithApiErrorReport(
  config: API配置项,
  source: string,
  url: string,
  requestMode: 'stream' | 'non-stream' | 'models' | 'test' | 'unknown',
  init: RequestInit,
): Promise<Response> {
  const timeoutController = new AbortController();
  const upstreamSignal = init.signal;
  const forwardAbort = () => timeoutController.abort(upstreamSignal?.reason);
  upstreamSignal?.addEventListener('abort', forwardAbort, { once: true });
  const timeoutId = globalThis.setTimeout(() => {
    timeoutController.abort(new StreamTimeoutError('等待模型响应头超过 45 秒。'));
  }, DEFAULT_STREAM_FIRST_BYTE_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: timeoutController.signal });
  } catch (error) {
    const reportedError = timeoutController.signal.reason instanceof StreamTimeoutError
      ? timeoutController.signal.reason
      : error;
    if (reportedError && typeof reportedError === 'object') {
      (reportedError as Error & { alreadyReportedByApiLayer?: boolean }).alreadyReportedByApiLayer = true;
    }
    void appendApiErrorReport({
      source,
      config,
      requestUrl: url,
      requestMode,
      error: reportedError,
    });
    throw reportedError;
  } finally {
    globalThis.clearTimeout(timeoutId);
    upstreamSignal?.removeEventListener('abort', forwardAbort);
  }
}

function normalizeClaudeMessages(
  messages: Array<{ role: string; content: string }>,
): { system: string; messages: Array<{ role: 'user' | 'assistant'; content: string }> } {
  const system = messages
    .filter((m) => m.role === 'system' && m.content.trim())
    .map((m) => m.content.trim())
    .join('\n\n');
  const normalized: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') continue;
    const content = msg.content.trim();
    if (!content) continue;
    const role: 'user' | 'assistant' = msg.role === 'assistant' ? 'assistant' : 'user';
    const last = normalized[normalized.length - 1];
    if (last?.role === role) {
      last.content = `${last.content}\n\n${content}`;
    } else {
      normalized.push({ role, content });
    }
  }

  if (normalized.length === 0 || normalized[0]?.role !== 'user') {
    normalized.unshift({ role: 'user', content: '请开始本轮回应。' });
  }
  if (normalized[normalized.length - 1]?.role !== 'user') {
    normalized.push({ role: 'user', content: '请继续并完成当前请求。' });
  }

  return { system, messages: normalized };
}

function buildClaudeTextBlocks(text: string): Array<{ type: 'text'; text: string }> {
  const content = text.trim();
  return content ? [{ type: 'text', text: content }] : [{ type: 'text', text: ' ' }];
}

function buildClaudeRequestBody(
  config: API配置项,
  messages: Array<{ role: string; content: string }>,
  request: ChatCompletionRequest,
  stream: boolean,
): Record<string, unknown> {
  const claudePayload = normalizeClaudeMessages(messages);
  const bodyObj: Record<string, unknown> = {
    model: config.model,
    max_tokens: request.maxTokens ?? config.maxTokens ?? 2048,
    messages: claudePayload.messages.map((message) => ({
      role: message.role,
      content: buildClaudeTextBlocks(message.content),
    })),
    stream,
  };
  if (claudePayload.system) {
    bodyObj.system = buildClaudeTextBlocks(claudePayload.system);
  }
  // Phase 3：Claude 仅支持 max_context（通过 max_tokens 间接控制），
  // 其他采样参数 Claude 故意不上传（参考 ST 行为，避免冲突）
  // max_context 不直接发给 Claude，但可用于客户端侧裁剪历史（暂未实现）
  return bodyObj;
}

function claudeHeaders(config: API配置项): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': config.apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  if (config.provider === 'claude_compatible') {
    headers['anthropic-client-name'] = 'claude-code';
    headers['anthropic-client-version'] = '1.0.0';
    headers['x-claude-code-attribution'] = '1';
    headers['x-claude-code-client'] = 'claude-code';
  }
  return headers;
}

function formatClaudeError(status: number, text: string): Error {
  const lower = text.toLowerCase();
  const hint = (() => {
    if (status === 401) return 'API Key 无效或未授权。';
    if (status === 403) return '账号权限、模型权限、地区限制或浏览器直连权限被拒绝。';
    if (status === 404) return 'Base URL、/v1 路径或模型名可能不正确。';
    if (status === 400 && (lower.includes('final') || lower.includes('role'))) {
      return '消息角色格式不符合 Claude 要求；客户端已自动尝试保证最后一条为用户内容。';
    }
    if (status === 400 && lower.includes('system') && (lower.includes('数组') || lower.includes('array'))) {
      return '当前 Claude 专用模式会使用根级 system 数组；如果仍报错，请检查中转是否裁剪了请求体或要求 Claude Code 专属字段。';
    }
    if (
      status === 400 &&
      (lower.includes('unsupported parameter') ||
        lower.includes('temperature') ||
        lower.includes('top_p') ||
        lower.includes('top_k') ||
        lower.includes('thinking'))
    ) {
      return 'Claude 模型拒绝了可选参数；当前客户端默认不会上传 temperature / top_p / top_k / thinking。';
    }
    if (lower.includes('failed to fetch') || lower.includes('cors')) {
      return '浏览器直连或 CORS 被拦截，请检查代理是否允许浏览器访问。';
    }
    return '请检查 Claude 专用模式、供应商类型、Base URL、模型名和 Key。';
  })();
  return new Error(`Claude API Error ${status}: ${hint}\n${text}`);
}

function parseClaudeTextResponse(json: unknown): string {
  const data = json as { content?: Array<{ type?: string; text?: string }> };
  return (data.content ?? [])
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text ?? '')
    .join('');
}

type CompatibleStreamTextState = {
  currentBlockIsThinking: boolean;
  sawReasoning: boolean;
};

function hasReasoningPayload(value: unknown, depth = 0): boolean {
  if (depth > 8 || !value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((item) => hasReasoningPayload(item, depth + 1));
  const record = value as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type : '';
  if (record.thought === true || /^(thinking|reasoning|thinking_delta|reasoning_delta)$/i.test(type)) return true;
  for (const [key, child] of Object.entries(record)) {
    if (/^(reasoning(?:_content)?|thinking(?:_content)?)$/i.test(key) && child != null && child !== '') return true;
    if (hasReasoningPayload(child, depth + 1)) return true;
  }
  return false;
}

function readCompatibleTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => readCompatibleTextContent(part))
      .join('');
  }
  if (!content || typeof content !== 'object') return '';
  const part = content as Record<string, any>;
  const type = typeof part.type === 'string' ? part.type : '';
  if (part.thought === true || /^(thinking|reasoning|thinking_delta|reasoning_delta)$/i.test(type)) {
    return '';
  }
  if (typeof part.text === 'string') return part.text;
  if (typeof part.output_text === 'string') return part.output_text;
  if (typeof part.content === 'string') return part.content;
  if (Array.isArray(part.content)) return readCompatibleTextContent(part.content);
  return '';
}

function readOpenAICompatibleStreamDelta(parsed: any, state: CompatibleStreamTextState): string {
  if (hasReasoningPayload(parsed)) state.sawReasoning = true;
  if (parsed?.type === 'content_block_start') {
    const blockType = parsed.content_block?.type;
    state.currentBlockIsThinking = blockType === 'thinking' || blockType === 'reasoning';
    if (state.currentBlockIsThinking) return '';
    return readCompatibleTextContent(parsed.content_block?.text ?? parsed.content_block?.content ?? parsed.content_block);
  }
  if (parsed?.type === 'content_block_delta') {
    const deltaType = parsed.delta?.type;
    if (deltaType === 'thinking_delta' || deltaType === 'reasoning_delta' || state.currentBlockIsThinking) return '';
    return readCompatibleTextContent(parsed.delta?.text ?? parsed.delta?.content ?? parsed.delta);
  }
  if (parsed?.type === 'content_block_stop') {
    state.currentBlockIsThinking = false;
    return '';
  }
  if (
    parsed?.type === 'response.output_text.delta' ||
    parsed?.type === 'response.text.delta' ||
    parsed?.type === 'response.content_part.delta'
  ) {
    return readCompatibleTextContent(parsed.delta?.text ?? parsed.delta ?? parsed.text);
  }

  const choice = parsed?.choices?.[0];
  const delta = choice?.delta;
  if (delta?.type === 'thinking_delta' || delta?.type === 'reasoning_delta' || delta?.thought === true) {
    return '';
  }
  return (
    readCompatibleTextContent(delta?.content) ||
    readCompatibleTextContent(delta?.text) ||
    readCompatibleTextContent(choice?.text) ||
    readCompatibleTextContent(parsed?.delta?.text) ||
    readCompatibleTextContent(parsed?.delta?.content) ||
    readCompatibleTextContent(parsed?.delta) ||
    parseOpenCodeGeminiText(parsed) ||
    readCompatibleTextContent(parsed?.output_text) ||
    readCompatibleTextContent(parsed?.text) ||
    readCompatibleTextContent(parsed?.content)
  );
}

/** 从 SSE chunk / 非流式 JSON 中提取 finish_reason / stop_reason / finishReason。
 *  不同 provider 字段名不同：
 *  - OpenAI 兼容: choices[0].finish_reason
 *  - Claude: message_delta.delta.stop_reason (SSE) 或顶层 stop_reason (非流式)
 *  - Gemini: candidates[0].finishReason (camelCase)
 *  返回 undefined 表示该 chunk 无 finish_reason 或无法识别。 */
function readFinishReason(parsed: any): string | undefined {
  // OpenAI 兼容：choices[0].finish_reason
  const choice = parsed?.choices?.[0];
  if (choice && typeof choice.finish_reason === 'string' && choice.finish_reason) {
    return choice.finish_reason;
  }
  // Claude SSE: message_delta.delta.stop_reason
  if (parsed?.type === 'message_delta') {
    const stopReason = parsed?.delta?.stop_reason;
    if (typeof stopReason === 'string' && stopReason) return stopReason;
  }
  // Claude 非流式: stop_reason
  if (typeof parsed?.stop_reason === 'string' && parsed.stop_reason) {
    return parsed.stop_reason;
  }
  // Gemini: candidates[0].finishReason
  const candidate = parsed?.candidates?.[0];
  if (candidate && typeof candidate.finishReason === 'string' && candidate.finishReason) {
    return candidate.finishReason;
  }
  return undefined;
}

function parseOpenAICompatibleTextResponse(json: unknown): string {
  const data = json as Record<string, any>;
  const choice = data?.choices?.[0];
  return (
    readCompatibleTextContent(choice?.message?.content) ||
    readCompatibleTextContent(choice?.text) ||
    readCompatibleTextContent(data?.message?.content) ||
    parseClaudeTextResponse(json) ||
    parseOpenCodeResponsesText(json) ||
    parseOpenCodeGeminiText(json) ||
    readCompatibleTextContent(data?.output_text) ||
    readCompatibleTextContent(data?.text) ||
    readCompatibleTextContent(data?.content)
  );
}

function reportOpenAICompatibleDiagnostics(
  json: unknown,
  text: string,
  config: API配置项,
  request: ChatCompletionRequest,
): void {
  request.onResponseDiagnostics?.({
    sawReasoning: hasReasoningPayload(json),
    sawVisibleContent: text.trim().length > 0,
    finishReason: readFinishReason(json),
    selectedModel: config.model,
  });
}

export async function chatCompletion(
  config: API配置项,
  request: ChatCompletionRequest,
  callbacks: StreamCallbacks,
): Promise<string> {
  const isolateRecoveryAttempts = request.deepSeekRecovery !== 'disabled'
    && classifyDeepSeekConfig(config).confidence !== 'none';
  let streamAttemptCount = 0;
  const recovered = await executeWithDeepSeekRecovery(config, {
    disabled: request.deepSeekRecovery === 'disabled',
    maxTokens: request.maxTokens ?? config.maxTokens,
    onSummary: request.onDeepSeekRecovery,
    execute: async (attemptConfig, attemptOptions) => {
      if (isolateRecoveryAttempts && streamAttemptCount > 0) callbacks.onReset?.();
      streamAttemptCount += 1;
      let reported = false;
      let finishReason: string | undefined;
      let diagnostics: DeepSeekAttemptDiagnostics = {
        sawReasoning: false,
        sawVisibleContent: false,
        selectedModel: attemptConfig.model,
      };
      const messages = attemptOptions.appendRecoveryInstruction
        ? [...request.messages, { role: 'user', content: DEEPSEEK_FINAL_CONTENT_GUARD }]
        : request.messages;
      const attemptRequest: ChatCompletionRequest = {
        ...request,
        messages,
        maxTokens: attemptOptions.maxTokens,
        deepSeekRecovery: 'disabled',
        onResponseDiagnostics: (next) => {
          reported = true;
          diagnostics = next;
        },
      };
      const text = await chatCompletionOnce(attemptConfig, attemptRequest, {
        onDelta: isolateRecoveryAttempts && !callbacks.onReset ? () => {} : callbacks.onDelta,
        onReset: isolateRecoveryAttempts ? () => callbacks.onReset?.() : callbacks.onReset,
        onDone: () => {},
        onError: callbacks.onError,
        onFinishReason: (reason) => { finishReason = reason; },
      });
      if (!reported) {
        diagnostics = {
          sawReasoning: false,
          sawVisibleContent: text.trim().length > 0,
          finishReason,
          selectedModel: attemptConfig.model,
        };
      } else if (!diagnostics.finishReason && finishReason) {
        diagnostics = { ...diagnostics, finishReason };
      }
      return { text, diagnostics };
    },
  });

  if (isolateRecoveryAttempts && !callbacks.onReset && recovered.text) {
    callbacks.onDelta(recovered.text);
  }

  if (recovered.diagnostics.finishReason) {
    callbacks.onFinishReason?.(recovered.diagnostics.finishReason);
  }
  request.onResponseDiagnostics?.(recovered.diagnostics);
  callbacks.onDone();
  return recovered.text;
}

async function chatCompletionOnce(
  config: API配置项,
  request: ChatCompletionRequest,
  callbacks: StreamCallbacks,
): Promise<string> {
  const provider = detectChatProvider(config);
  const msgs = buildMessages(request.systemPrompt, request.messages);

  if (provider === 'mimo') {
    return streamOpenAICompatible(config, msgs, request, callbacks);
  }
  if (provider === 'opencode') {
    return streamOpenCode(config, msgs, request, callbacks);
  }
  if (provider === 'deepseek') {
    const payload = withDeepSeekPrefixMessages(config, msgs, request);
    try {
      const text = await streamOpenAICompatible(payload.config, payload.messages, request, callbacks);
      return mergePrefixResult(payload.prefix, text);
    } catch (error) {
      if (payload.prefix && isDeepSeekPrefixUnsupportedError(error)) {
        console.warn('[DeepSeek Prefix] 当前接口不支持 prefix，已自动降级为标准模式。', error);
        callbacks.onReset?.();
        return streamOpenAICompatible(config, stripDeepSeekPrefixMessages(msgs), { ...request, prefixMode: false }, callbacks);
      }
      throw error;
    }
  }
  if (provider === 'claude') {
    return streamClaude(config, msgs, request, callbacks);
  }
  if (provider === 'gemini') {
    return streamGemini(config, msgs, request, callbacks);
  }
  return streamOpenAICompatible(config, msgs, request, callbacks);
}

// ── OpenAI-compatible streaming (SSE) ──

async function streamOpenAICompatible(
  config: API配置项,
  messages: Array<{ role: string; content: string }>,
  request: ChatCompletionRequest,
  callbacks: StreamCallbacks,
  includeUsage: boolean = true,
): Promise<string> {
  const upstreamBaseUrl = isArkConfig(config)
    ? normalizeArkBaseUrl(config.baseUrl)
    : isPioneerConfig(config)
      ? normalizePioneerBaseUrl(config.baseUrl)
      : config.baseUrl;
  const upstreamUrl = buildOpenAICompatibleChatUrl(upstreamBaseUrl);
  const requestBody = buildOpenAICompatibleRequestBody(config, messages, request, true, includeUsage);
  const url = isArkConfig(config)
    ? '/api/ark'
    : isBaiduQianfanConfig(config)
    ? '/api/qianfan'
    : isPioneerConfig(config)
      ? '/api/pioneer'
      : upstreamUrl;
  const body = isArkConfig(config)
    ? buildArkProxyBody(config, requestBody)
    : isBaiduQianfanConfig(config)
    ? buildQianfanProxyBody(config, requestBody)
    : isPioneerConfig(config)
      ? buildPioneerProxyBody(config, requestBody)
      : JSON.stringify(requestBody);

  const response = await fetchWithApiErrorReport(config, '聊天补全', url, 'stream', {
    method: 'POST',
    headers: isMimoConfig(config)
      ? buildMimoAuthHeaders(config.apiKey)
      : {
          'Content-Type': 'application/json',
          ...(url.startsWith('/api/') ? {} : { Authorization: `Bearer ${config.apiKey}` }),
        },
    body,
    signal: request.signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    if (includeUsage && isStreamUsageOptionUnsupported(response.status, text)) {
      console.warn('[token-usage] 当前流式接口不支持 stream_options.include_usage，已自动降级为不请求 usage 的流式请求。');
      return streamOpenAICompatible(config, messages, request, callbacks, false);
    }
    void appendApiErrorReport({
      source: '聊天补全',
      config,
      status: response.status,
      requestUrl: upstreamUrl,
      requestMode: 'stream',
      responseText: text,
    });
    throw formatOpenAICompatibleError(config, response.status, text);
  }

  let fullText = '';
  let finishReason: string | undefined;
  const compatibleStreamState: CompatibleStreamTextState = { currentBlockIsThinking: false, sawReasoning: false };

  await readSseStream(response, request.signal, (parsed) => {
    emitUsageFromResponse(parsed, config, request);
    const text = readOpenAICompatibleStreamDelta(parsed, compatibleStreamState);

    // Accept visible text from compatible chunks; drop thinking/reasoning deltas.
    if (text) {
      fullText += text;
      callbacks.onDelta(text);
    }
    const fr = readFinishReason(parsed);
    if (fr) {
      finishReason = fr;
      callbacks.onFinishReason?.(fr);
    }
  });

  request.onResponseDiagnostics?.({
    sawReasoning: compatibleStreamState.sawReasoning,
    sawVisibleContent: fullText.trim().length > 0,
    finishReason,
    selectedModel: config.model,
  });
  callbacks.onDone();
  return fullText;
}

// ── Claude streaming (Anthropic Messages API) ──

async function streamClaude(
  config: API配置项,
  messages: Array<{ role: string; content: string }>,
  request: ChatCompletionRequest,
  callbacks: StreamCallbacks,
): Promise<string> {
  const url = `${normalizeClaudeBaseUrl(config.baseUrl)}/messages`;
  const body = JSON.stringify(buildClaudeRequestBody(config, messages, request, true));

  const response = await fetchWithApiErrorReport(config, 'Claude 聊天补全', url, 'stream', {
    method: 'POST',
    headers: claudeHeaders(config),
    body,
    signal: request.signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    void appendApiErrorReport({
      source: 'Claude 聊天补全',
      config,
      status: response.status,
      requestUrl: url,
      requestMode: 'stream',
      responseText: text,
    });
    throw formatClaudeError(response.status, text);
  }

  let fullText = '';
  let finishReason: string | undefined;
  let sawReasoning = false;
  // Claude extended thinking 用独立 content_block，type='thinking' 的 block 内的 delta 是 thinking_delta
  let currentBlockIsThinking = false;

  await readSseStream(response, request.signal, (parsed) => {
    emitUsageFromResponse(parsed, config, request);
    if (hasReasoningPayload(parsed)) sawReasoning = true;
    if (parsed.type === 'content_block_start') {
      currentBlockIsThinking = parsed.content_block?.type === 'thinking';
      if (!currentBlockIsThinking) {
        const text = parsed.content_block?.text ?? '';
        if (text) {
          fullText += text;
          callbacks.onDelta(text);
        }
      }
    } else if (parsed.type === 'content_block_delta') {
      const deltaType = parsed.delta?.type;
      if (deltaType !== 'thinking_delta' && !currentBlockIsThinking) {
        const text = parsed.delta?.text ?? '';
        if (text) {
          fullText += text;
          callbacks.onDelta(text);
        }
      }
    } else if (parsed.type === 'content_block_stop') {
      currentBlockIsThinking = false;
    }
    const fr = readFinishReason(parsed);
    if (fr) {
      finishReason = fr;
      callbacks.onFinishReason?.(fr);
    }
  });

  request.onResponseDiagnostics?.({
    sawReasoning,
    sawVisibleContent: fullText.trim().length > 0,
    finishReason,
    selectedModel: config.model,
  });
  callbacks.onDone();
  return fullText;
}

async function completionClaudeNonStream(
  config: API配置项,
  messages: Array<{ role: string; content: string }>,
  request: ChatCompletionRequest,
): Promise<string> {
  const url = `${normalizeClaudeBaseUrl(config.baseUrl)}/messages`;
  const response = await fetchWithApiErrorReport(config, 'Claude 非流式补全', url, 'non-stream', {
    method: 'POST',
    headers: claudeHeaders(config),
    body: JSON.stringify(buildClaudeRequestBody(config, messages, request, false)),
    signal: request.signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    void appendApiErrorReport({
      source: 'Claude 非流式补全',
      config,
      status: response.status,
      requestUrl: url,
      requestMode: 'non-stream',
      responseText: text,
    });
    throw formatClaudeError(response.status, text);
  }

  const json = await response.json();
  emitUsageFromResponse(json, config, request);
  return parseClaudeTextResponse(json);
}

// ── OpenCode Zen (model-family routed) ──

function buildOpenCodeResponsesBody(
  config: API配置项,
  messages: Array<{ role: string; content: string }>,
  request: ChatCompletionRequest,
  stream: boolean,
): Record<string, unknown> {
  const system = messages
    .filter((m) => m.role === 'system' && m.content.trim())
    .map((m) => m.content.trim())
    .join('\n\n');
  const input = messages
    .filter((m) => m.role !== 'system' && m.content.trim())
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));
  if (input.length === 0) {
    input.push({ role: 'user', content: '请开始本轮回应。' });
  }

  const bodyObj: Record<string, unknown> = {
    model: normalizeOpenCodeModelId(config.model),
    input,
    max_output_tokens: request.maxTokens ?? config.maxTokens ?? 2048,
    temperature: request.temperature ?? config.temperature ?? 0.8,
    stream,
  };
  // Phase 3：OpenCode GPT 系列支持 top_p / frequency_penalty / presence_penalty
  const topP = request.topP ?? config.topP;
  if (typeof topP === 'number') bodyObj.top_p = topP;
  const freqPenalty = request.frequencyPenalty ?? config.frequencyPenalty;
  if (typeof freqPenalty === 'number') bodyObj.frequency_penalty = freqPenalty;
  const presPenalty = request.presencePenalty ?? config.presencePenalty;
  if (typeof presPenalty === 'number') bodyObj.presence_penalty = presPenalty;
  if (system) bodyObj.instructions = system;
  return bodyObj;
}

function buildOpenCodeGeminiBody(
  config: API配置项,
  messages: Array<{ role: string; content: string }>,
  request: ChatCompletionRequest,
): Record<string, unknown> {
  const systemMsg = messages.find((m) => m.role === 'system');
  const contents = messages
    .filter((m) => m.role !== 'system' && m.content.trim())
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
  if (contents.length === 0) {
    contents.push({ role: 'user', parts: [{ text: '请开始本轮回应。' }] });
  }

  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: request.maxTokens ?? config.maxTokens ?? 2048,
    temperature: request.temperature ?? config.temperature ?? 0.8,
  };
  // Phase 3：Gemini 支持 top_p / top_k / repetition_penalty / frequency_penalty / presence_penalty
  const topP = request.topP ?? config.topP;
  if (typeof topP === 'number') generationConfig.topP = topP;
  const topK = request.topK ?? config.topK;
  if (typeof topK === 'number') generationConfig.topK = topK;
  const repPenalty = request.repetitionPenalty ?? config.repetitionPenalty;
  if (typeof repPenalty === 'number') generationConfig.repetitionPenalty = repPenalty;
  const freqPenalty = request.frequencyPenalty ?? config.frequencyPenalty;
  if (typeof freqPenalty === 'number') generationConfig.frequencyPenalty = freqPenalty;
  const presPenalty = request.presencePenalty ?? config.presencePenalty;
  if (typeof presPenalty === 'number') generationConfig.presencePenalty = presPenalty;

  const bodyObj: Record<string, unknown> = {
    contents,
    generationConfig,
  };
  if (systemMsg?.content.trim()) {
    bodyObj.systemInstruction = {
      parts: [{ text: systemMsg.content }],
    };
  }
  return bodyObj;
}

function buildOpenCodeGeminiUrl(config: API配置项, stream: boolean): string {
  const base = normalizeOpenCodeBaseUrl(config.baseUrl);
  const model = encodeURIComponent(normalizeOpenCodeModelId(config.model));
  return `${base}/models/${model}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
}

function parseOpenCodeResponsesText(json: unknown): string {
  const data = json as {
    output_text?: string;
    text?: string;
    choices?: Array<{ message?: { content?: string } }>;
    output?: Array<{
      content?: Array<{ type?: string; text?: string; content?: string }>;
    }>;
  };
  if (typeof data.output_text === 'string') return data.output_text;
  if (typeof data.text === 'string') return data.text;
  const fromOutput = (data.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((part) => part?.type === 'output_text' || part?.type === 'text' || typeof part?.text === 'string')
    .map((part) => part.text ?? part.content ?? '')
    .join('');
  if (fromOutput) return fromOutput;
  return readCompatibleTextContent(data.choices?.[0]?.message?.content);
}

function parseOpenCodeGeminiText(json: unknown): string {
  const data = json as { candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> };
  return (data.candidates?.[0]?.content?.parts ?? [])
    .filter((part) => !part.thought && typeof part.text === 'string')
    .map((part) => part.text ?? '')
    .join('');
}

function readOpenCodeResponsesStreamDelta(parsed: any): string {
  if (
    parsed?.type === 'response.output_text.delta' ||
    parsed?.type === 'response.text.delta' ||
    parsed?.type === 'response.content_part.delta'
  ) {
    return readCompatibleTextContent(parsed.delta?.text ?? parsed.delta ?? parsed.text);
  }
  return readCompatibleTextContent(parsed?.choices?.[0]?.delta?.content) || readCompatibleTextContent(parsed?.delta?.text);
}

async function streamOpenCode(
  config: API配置项,
  messages: Array<{ role: string; content: string }>,
  request: ChatCompletionRequest,
  callbacks: StreamCallbacks,
): Promise<string> {
  const normalized = withOpenCodeNormalizedConfig(config);
  const endpoint = inferOpenCodeEndpoint(normalized.model);
  if (endpoint === 'chat') {
    return streamOpenCodeChat(normalized, messages, request, callbacks);
  }
  if (endpoint === 'messages') {
    return streamOpenCodeMessages(normalized, messages, request, callbacks);
  }
  if (endpoint === 'gemini') {
    return streamOpenCodeGemini(normalized, messages, request, callbacks);
  }
  return streamOpenCodeResponses(normalized, messages, request, callbacks);
}

async function streamOpenCodeChat(
  config: API配置项,
  messages: Array<{ role: string; content: string }>,
  request: ChatCompletionRequest,
  callbacks: StreamCallbacks,
  includeUsage: boolean = true,
): Promise<string> {
  const endpoint: OpenCodeEndpoint = 'chat';
  const upstreamUrl = buildOpenCodeUrl(config, endpoint);
  const requestBody = buildOpenAICompatibleRequestBody(config, messages, request, true, includeUsage);
  const response = await fetchWithApiErrorReport(config, 'OpenCode Zen Chat 补全', '/api/opencode', 'stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: buildOpenCodeProxyBody(config, endpoint, requestBody, true),
    signal: request.signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    if (includeUsage && isStreamUsageOptionUnsupported(response.status, text)) {
      console.warn('[token-usage] OpenCode Chat 流式接口不支持 stream_options.include_usage，已自动降级为不请求 usage 的流式请求。');
      return streamOpenCodeChat(config, messages, request, callbacks, false);
    }
    void appendApiErrorReport({
      source: 'OpenCode Zen Chat 补全',
      config,
      status: response.status,
      requestUrl: upstreamUrl,
      requestMode: 'stream',
      responseText: text,
    });
    throw formatOpenCodeError(config, endpoint, response.status, text);
  }

  let fullText = '';
  let finishReason: string | undefined;
  const compatibleStreamState: CompatibleStreamTextState = { currentBlockIsThinking: false, sawReasoning: false };

  await readSseStream(response, request.signal, (parsed) => {
    emitUsageFromResponse(parsed, config, request);
    const text = readOpenAICompatibleStreamDelta(parsed, compatibleStreamState);
    if (text) {
      fullText += text;
      callbacks.onDelta(text);
    }
    const fr = readFinishReason(parsed);
    if (fr) {
      finishReason = fr;
      callbacks.onFinishReason?.(fr);
    }
  });

  request.onResponseDiagnostics?.({
    sawReasoning: compatibleStreamState.sawReasoning,
    sawVisibleContent: fullText.trim().length > 0,
    finishReason,
    selectedModel: config.model,
  });
  callbacks.onDone();
  return fullText;
}

async function streamOpenCodeMessages(
  config: API配置项,
  messages: Array<{ role: string; content: string }>,
  request: ChatCompletionRequest,
  callbacks: StreamCallbacks,
): Promise<string> {
  const endpoint: OpenCodeEndpoint = 'messages';
  const upstreamUrl = buildOpenCodeUrl(config, endpoint);
  const response = await fetchWithApiErrorReport(config, 'OpenCode Zen Messages 补全', '/api/opencode', 'stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: buildOpenCodeProxyBody(config, endpoint, buildClaudeRequestBody(config, messages, request, true), true),
    signal: request.signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    void appendApiErrorReport({
      source: 'OpenCode Zen Messages 补全',
      config,
      status: response.status,
      requestUrl: upstreamUrl,
      requestMode: 'stream',
      responseText: text,
    });
    throw formatOpenCodeError(config, endpoint, response.status, text);
  }

  let fullText = '';
  let finishReason: string | undefined;
  let sawReasoning = false;
  let currentBlockIsThinking = false;

  await readSseStream(response, request.signal, (parsed) => {
    emitUsageFromResponse(parsed, config, request);
    if (hasReasoningPayload(parsed)) sawReasoning = true;
    if (parsed.type === 'content_block_start') {
      currentBlockIsThinking = parsed.content_block?.type === 'thinking';
      if (!currentBlockIsThinking) {
        const text = parsed.content_block?.text ?? '';
        if (text) {
          fullText += text;
          callbacks.onDelta(text);
        }
      }
    } else if (parsed.type === 'content_block_delta') {
      if (parsed.delta?.type !== 'thinking_delta' && !currentBlockIsThinking) {
        const text = parsed.delta?.text ?? '';
        if (text) {
          fullText += text;
          callbacks.onDelta(text);
        }
      }
    } else if (parsed.type === 'content_block_stop') {
      currentBlockIsThinking = false;
    }
    const fr = readFinishReason(parsed);
    if (fr) {
      finishReason = fr;
      callbacks.onFinishReason?.(fr);
    }
  });

  request.onResponseDiagnostics?.({
    sawReasoning,
    sawVisibleContent: fullText.trim().length > 0,
    finishReason,
    selectedModel: config.model,
  });
  callbacks.onDone();
  return fullText;
}

async function streamOpenCodeResponses(
  config: API配置项,
  messages: Array<{ role: string; content: string }>,
  request: ChatCompletionRequest,
  callbacks: StreamCallbacks,
): Promise<string> {
  const endpoint: OpenCodeEndpoint = 'responses';
  const upstreamUrl = buildOpenCodeUrl(config, endpoint);
  const response = await fetchWithApiErrorReport(config, 'OpenCode Zen Responses 补全', '/api/opencode', 'stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: buildOpenCodeProxyBody(config, endpoint, buildOpenCodeResponsesBody(config, messages, request, true), true),
    signal: request.signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    void appendApiErrorReport({
      source: 'OpenCode Zen Responses 补全',
      config,
      status: response.status,
      requestUrl: upstreamUrl,
      requestMode: 'stream',
      responseText: text,
    });
    throw formatOpenCodeError(config, endpoint, response.status, text);
  }

  let fullText = '';
  let finishReason: string | undefined;
  let sawReasoning = false;

  await readSseStream(response, request.signal, (parsed) => {
    emitUsageFromResponse(parsed, config, request);
    if (hasReasoningPayload(parsed)) sawReasoning = true;
    const text = readOpenCodeResponsesStreamDelta(parsed);
    if (text) {
      fullText += text;
      callbacks.onDelta(text);
    }
    const fr = readFinishReason(parsed);
    if (fr) {
      finishReason = fr;
      callbacks.onFinishReason?.(fr);
    }
  });

  request.onResponseDiagnostics?.({
    sawReasoning,
    sawVisibleContent: fullText.trim().length > 0,
    finishReason,
    selectedModel: config.model,
  });
  callbacks.onDone();
  return fullText;
}

async function streamOpenCodeGemini(
  config: API配置项,
  messages: Array<{ role: string; content: string }>,
  request: ChatCompletionRequest,
  callbacks: StreamCallbacks,
): Promise<string> {
  const endpoint: OpenCodeEndpoint = 'gemini';
  const upstreamUrl = buildOpenCodeGeminiUrl(config, true);
  const response = await fetchWithApiErrorReport(config, 'OpenCode Zen Gemini 补全', '/api/opencode', 'stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: buildOpenCodeProxyBody(config, endpoint, buildOpenCodeGeminiBody(config, messages, request), true),
    signal: request.signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    void appendApiErrorReport({
      source: 'OpenCode Zen Gemini 补全',
      config,
      status: response.status,
      requestUrl: upstreamUrl,
      requestMode: 'stream',
      responseText: text,
    });
    throw formatOpenCodeError(config, endpoint, response.status, text);
  }

  let fullText = '';
  let finishReason: string | undefined;
  let sawReasoning = false;

  await readSseStream(response, request.signal, (parsed) => {
    emitUsageFromResponse(parsed, config, request);
    if (hasReasoningPayload(parsed)) sawReasoning = true;
    const text = parseOpenCodeGeminiText(parsed);
    if (text) {
      fullText += text;
      callbacks.onDelta(text);
    }
    const fr = readFinishReason(parsed);
    if (fr) {
      finishReason = fr;
      callbacks.onFinishReason?.(fr);
    }
  });

  request.onResponseDiagnostics?.({
    sawReasoning,
    sawVisibleContent: fullText.trim().length > 0,
    finishReason,
    selectedModel: config.model,
  });
  callbacks.onDone();
  return fullText;
}

async function completionOpenCodeNonStream(
  config: API配置项,
  messages: Array<{ role: string; content: string }>,
  request: ChatCompletionRequest,
): Promise<string> {
  const normalized = withOpenCodeNormalizedConfig(config);
  const endpoint = inferOpenCodeEndpoint(normalized.model);

  if (endpoint === 'chat') {
    const upstreamUrl = buildOpenCodeUrl(normalized, endpoint);
    const response = await fetchWithApiErrorReport(normalized, 'OpenCode Zen Chat 非流式补全', '/api/opencode', 'non-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: buildOpenCodeProxyBody(normalized, endpoint, buildOpenAICompatibleRequestBody(normalized, messages, request, false), false),
      signal: request.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      void appendApiErrorReport({
        source: 'OpenCode Zen Chat 非流式补全',
        config: normalized,
        status: response.status,
        requestUrl: upstreamUrl,
        requestMode: 'non-stream',
        responseText: text,
      });
      throw formatOpenCodeError(normalized, endpoint, response.status, text);
    }
    const json = await response.json();
    emitUsageFromResponse(json, normalized, request);
    return parseOpenAICompatibleTextResponse(json);
  }

  if (endpoint === 'messages') {
    const upstreamUrl = buildOpenCodeUrl(normalized, endpoint);
    const response = await fetchWithApiErrorReport(normalized, 'OpenCode Zen Messages 非流式补全', '/api/opencode', 'non-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: buildOpenCodeProxyBody(normalized, endpoint, buildClaudeRequestBody(normalized, messages, request, false), false),
      signal: request.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      void appendApiErrorReport({
        source: 'OpenCode Zen Messages 非流式补全',
        config: normalized,
        status: response.status,
        requestUrl: upstreamUrl,
        requestMode: 'non-stream',
        responseText: text,
      });
      throw formatOpenCodeError(normalized, endpoint, response.status, text);
    }
    const json = await response.json();
    emitUsageFromResponse(json, normalized, request);
    return parseClaudeTextResponse(json);
  }

  if (endpoint === 'gemini') {
    const upstreamUrl = buildOpenCodeGeminiUrl(normalized, false);
    const response = await fetchWithApiErrorReport(normalized, 'OpenCode Zen Gemini 非流式补全', '/api/opencode', 'non-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: buildOpenCodeProxyBody(normalized, endpoint, buildOpenCodeGeminiBody(normalized, messages, request), false),
      signal: request.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      void appendApiErrorReport({
        source: 'OpenCode Zen Gemini 非流式补全',
        config: normalized,
        status: response.status,
        requestUrl: upstreamUrl,
        requestMode: 'non-stream',
        responseText: text,
      });
      throw formatOpenCodeError(normalized, endpoint, response.status, text);
    }
    const json = await response.json();
    emitUsageFromResponse(json, normalized, request);
    return parseOpenCodeGeminiText(json);
  }

  const upstreamUrl = buildOpenCodeUrl(normalized, endpoint);
  const response = await fetchWithApiErrorReport(normalized, 'OpenCode Zen Responses 非流式补全', '/api/opencode', 'non-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: buildOpenCodeProxyBody(normalized, endpoint, buildOpenCodeResponsesBody(normalized, messages, request, false), false),
    signal: request.signal,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    void appendApiErrorReport({
      source: 'OpenCode Zen Responses 非流式补全',
      config: normalized,
      status: response.status,
      requestUrl: upstreamUrl,
      requestMode: 'non-stream',
      responseText: text,
    });
    throw formatOpenCodeError(normalized, endpoint, response.status, text);
  }
  const json = await response.json();
  emitUsageFromResponse(json, normalized, request);
  return parseOpenCodeResponsesText(json);
}

// ── Gemini streaming ──

async function streamGemini(
  config: API配置项,
  messages: Array<{ role: string; content: string }>,
  request: ChatCompletionRequest,
  callbacks: StreamCallbacks,
): Promise<string> {
  const url = `${normalizeGeminiBaseUrl(config.baseUrl)}/models/${config.model}:streamGenerateContent?alt=sse`;
  const systemMsg = messages.find((m) => m.role === 'system');

  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  const geminiGenConfig: Record<string, unknown> = {
    maxOutputTokens: request.maxTokens ?? config.maxTokens ?? 2048,
    temperature: request.temperature ?? config.temperature ?? 0.8,
  };
  // Phase 3：Gemini 原生支持 top_p / top_k / repetition_penalty / frequency_penalty / presence_penalty
  const topP = request.topP ?? config.topP;
  if (typeof topP === 'number') geminiGenConfig.topP = topP;
  const topK = request.topK ?? config.topK;
  if (typeof topK === 'number') geminiGenConfig.topK = topK;
  const repPenalty = request.repetitionPenalty ?? config.repetitionPenalty;
  if (typeof repPenalty === 'number') geminiGenConfig.repetitionPenalty = repPenalty;
  const freqPenalty = request.frequencyPenalty ?? config.frequencyPenalty;
  if (typeof freqPenalty === 'number') geminiGenConfig.frequencyPenalty = freqPenalty;
  const presPenalty = request.presencePenalty ?? config.presencePenalty;
  if (typeof presPenalty === 'number') geminiGenConfig.presencePenalty = presPenalty;

  const bodyObj: Record<string, unknown> = {
    contents,
    generationConfig: geminiGenConfig,
  };
  if (systemMsg) {
    bodyObj.systemInstruction = {
      parts: [{ text: systemMsg.content }],
    };
  }

  const response = await fetchWithApiErrorReport(config, 'Gemini 聊天补全', url, 'stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': config.apiKey,
    },
    body: JSON.stringify(bodyObj),
    signal: request.signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    void appendApiErrorReport({
      source: 'Gemini 聊天补全',
      config,
      status: response.status,
      requestUrl: url,
      requestMode: 'stream',
      responseText: text,
    });
    throw new Error(`Gemini API Error ${response.status}: ${text}`);
  }

  let fullText = '';
  let finishReason: string | undefined;
  let sawReasoning = false;

  await readSseStream(response, request.signal, (parsed) => {
    emitUsageFromResponse(parsed, config, request);
    if (hasReasoningPayload(parsed)) sawReasoning = true;
    const parts = parsed.candidates?.[0]?.content?.parts;
    if (parts) {
      for (const part of parts) {
        if (part.thought) continue;
        const text = part.text ?? '';
        if (text) {
          fullText += text;
          callbacks.onDelta(text);
        }
      }
    }
    const fr = readFinishReason(parsed);
    if (fr) {
      finishReason = fr;
      callbacks.onFinishReason?.(fr);
    }
  });

  request.onResponseDiagnostics?.({
    sawReasoning,
    sawVisibleContent: fullText.trim().length > 0,
    finishReason,
    selectedModel: config.model,
  });
  callbacks.onDone();
  return fullText;
}

// ── Non-streaming fallback ──

export async function chatCompletionNonStream(
  config: API配置项,
  request: ChatCompletionRequest,
): Promise<string> {
  const recovered = await executeWithDeepSeekRecovery(config, {
    disabled: request.deepSeekRecovery === 'disabled',
    maxTokens: request.maxTokens ?? config.maxTokens,
    onSummary: request.onDeepSeekRecovery,
    execute: async (attemptConfig, attemptOptions) => {
      let reported = false;
      let diagnostics: DeepSeekAttemptDiagnostics = {
        sawReasoning: false,
        sawVisibleContent: false,
        selectedModel: attemptConfig.model,
      };
      const messages = attemptOptions.appendRecoveryInstruction
        ? [...request.messages, { role: 'user', content: DEEPSEEK_FINAL_CONTENT_GUARD }]
        : request.messages;
      const text = await chatCompletionNonStreamOnce(attemptConfig, {
        ...request,
        messages,
        maxTokens: attemptOptions.maxTokens,
        deepSeekRecovery: 'disabled',
        onResponseDiagnostics: (next) => {
          reported = true;
          diagnostics = next;
        },
      });
      if (!reported) {
        diagnostics = {
          sawReasoning: false,
          sawVisibleContent: text.trim().length > 0,
          selectedModel: attemptConfig.model,
        };
      }
      return { text, diagnostics };
    },
  });
  request.onResponseDiagnostics?.(recovered.diagnostics);
  return recovered.text;
}

async function chatCompletionNonStreamOnce(
  config: API配置项,
  request: ChatCompletionRequest,
): Promise<string> {
  const provider = detectChatProvider(config);
  const msgs = buildMessages(request.systemPrompt, request.messages);

  if (provider === 'mimo') {
    const upstreamBaseUrl = normalizeMimoBaseUrl(config.baseUrl);
    const upstreamUrl = buildOpenAICompatibleChatUrl(upstreamBaseUrl);
    const requestBody = buildOpenAICompatibleRequestBody(config, msgs, request, false);
    const response = await fetchWithApiErrorReport(config, '非流式补全', upstreamUrl, 'non-stream', {
      method: 'POST',
      headers: buildMimoAuthHeaders(config.apiKey),
      body: JSON.stringify(requestBody),
      signal: request.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      void appendApiErrorReport({
        source: '非流式补全',
        config,
        status: response.status,
        requestUrl: upstreamUrl,
        requestMode: 'non-stream',
        responseText: text,
      });
      throw formatOpenAICompatibleError(config, response.status, text);
    }

    const json = await response.json();
    emitUsageFromResponse(json, config, request);
    const text = parseOpenAICompatibleTextResponse(json);
    reportOpenAICompatibleDiagnostics(json, text, config, request);
    return text;
  }
  if (provider === 'opencode') {
    return completionOpenCodeNonStream(config, msgs, request);
  }

  if (provider === 'claude') {
    return completionClaudeNonStream(config, msgs, request);
  }

  if (provider === 'gemini') {
    return chatCompletionOnce(config, request, {
      onDelta: () => {},
      onDone: () => {},
      onError: () => {},
    });
  }

  const deepSeekPayload = provider === 'deepseek'
    ? withDeepSeekPrefixMessages(config, msgs, request)
    : { config, messages: msgs, prefix: '' };

  const upstreamBaseUrl = isArkConfig(deepSeekPayload.config)
    ? normalizeArkBaseUrl(deepSeekPayload.config.baseUrl)
    : isPioneerConfig(deepSeekPayload.config)
      ? normalizePioneerBaseUrl(deepSeekPayload.config.baseUrl)
      : deepSeekPayload.config.baseUrl;
  const upstreamUrl = buildOpenAICompatibleChatUrl(upstreamBaseUrl);
  const effectiveUrl = isArkConfig(deepSeekPayload.config)
    ? '/api/ark'
    : isBaiduQianfanConfig(deepSeekPayload.config)
    ? '/api/qianfan'
    : isPioneerConfig(deepSeekPayload.config)
      ? '/api/pioneer'
      : upstreamUrl;
  const diagnosticUrl = effectiveUrl.startsWith('/api/') ? upstreamUrl : effectiveUrl;
  const requestBody = buildOpenAICompatibleRequestBody(deepSeekPayload.config, deepSeekPayload.messages, request, false);
  const response = await fetchWithApiErrorReport(deepSeekPayload.config, '非流式补全', effectiveUrl, 'non-stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(effectiveUrl.startsWith('/api/') ? {} : { Authorization: `Bearer ${deepSeekPayload.config.apiKey}` }),
    },
    body: isArkConfig(deepSeekPayload.config)
      ? buildArkProxyBody(deepSeekPayload.config, requestBody)
      : isBaiduQianfanConfig(deepSeekPayload.config)
      ? buildQianfanProxyBody(deepSeekPayload.config, requestBody)
      : isPioneerConfig(deepSeekPayload.config)
        ? buildPioneerProxyBody(deepSeekPayload.config, requestBody)
        : JSON.stringify(requestBody),
    signal: request.signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const error = formatOpenAICompatibleError(deepSeekPayload.config, response.status, text);
    if (deepSeekPayload.prefix && isDeepSeekPrefixUnsupportedError(error)) {
      console.warn('[DeepSeek Prefix] 当前接口不支持 prefix，已自动降级为标准模式。', error);
      return chatCompletionNonStreamOnce(config, {
        ...request,
        messages: request.messages,
        prefixMode: false,
        prefixContent: undefined,
      });
    }
    void appendApiErrorReport({
      source: '非流式补全',
      config: deepSeekPayload.config,
      status: response.status,
      requestUrl: diagnosticUrl,
      requestMode: 'non-stream',
      responseText: text,
    });
    throw error;
  }

  const json = await response.json();
  emitUsageFromResponse(json, deepSeekPayload.config, request);
  const text = parseOpenAICompatibleTextResponse(json);
  reportOpenAICompatibleDiagnostics(json, text, deepSeekPayload.config, request);
  return mergePrefixResult(deepSeekPayload.prefix, text);
}
