import { appendApiErrorReport } from './apiErrorReportService';

type CachedModels = {
  expiresAt: number;
  models: string[];
};

const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
const modelCache = new Map<string, CachedModels>();

function fallbackSecretFingerprint(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`;
}

export async function buildOpenAICompatibleModelCacheKey(baseRaw: string, apiKey: string): Promise<string> {
  const normalizedBase = baseRaw.trim().replace(/\/+$/, '').toLowerCase();
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return `${normalizedBase}\u0000fingerprint:${fallbackSecretFingerprint(apiKey)}`;
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(apiKey));
  const fingerprint = Array.from(new Uint8Array(digest).slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${normalizedBase}\u0000sha256:${fingerprint}`;
}

export function buildOpenAICompatibleModelUrls(baseRaw: string): string[] {
  let base = baseRaw.trim().replace(/\/+$/, '').split('?')[0] ?? '';
  base = base
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/models(?:\/.*)?$/i, '');
  if (/\/beta$/i.test(base)) base = base.replace(/\/beta$/i, '/v1');
  const withoutVersion = base.replace(/\/v\d+(?:beta\d*)?$/i, '');
  return Array.from(new Set([
    `${base}/models`,
    `${withoutVersion}/v1/models`,
    `${withoutVersion}/models`,
  ]));
}

function withCatalogAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort);
    const abort = () => { cleanup(); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    promise.then((value) => { cleanup(); resolve(value); }, (error: unknown) => { cleanup(); reject(error); });
  });
}

async function readCatalogBody(response: Response, signal: AbortSignal): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (true) {
      const { value, done } = await withCatalogAbort(reader.read(), signal);
      if (done) return text + decoder.decode();
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    void reader.cancel(signal.aborted ? signal.reason : undefined).catch(() => undefined);
    reader.releaseLock();
  }
}

export async function fetchOpenAICompatibleModels(baseRaw: string, apiKey: string, signal?: AbortSignal, timeoutMs = 45_000): Promise<string[]> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', forwardAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException(`获取模型目录超过 ${Math.round(timeoutMs / 1000)} 秒。`, 'TimeoutError')), timeoutMs);
  const errors: string[] = [];
  try {
    for (const url of buildOpenAICompatibleModelUrls(baseRaw)) {
      try {
        controller.signal.throwIfAborted();
        const response = await withCatalogAbort(fetch(url, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: controller.signal,
        }), controller.signal);
        const text = await readCatalogBody(response, controller.signal);
        if (!response.ok) {
          void appendApiErrorReport({
            source: '模型列表',
            config: { provider: 'openai_compatible', baseUrl: baseRaw, apiKey },
            status: response.status,
            requestUrl: url,
            requestMode: 'models',
            responseText: text,
          });
          errors.push(`${url} -> ${response.status}${text ? `：${text.slice(0, 120)}` : ''}`);
          continue;
        }
        const data = JSON.parse(text);
        if (data && Array.isArray(data.data)) {
          const ids = data.data
            .map((model: { id?: string }) => model?.id)
            .filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0);
          if (ids.length) return ids;
        }
        errors.push(`${url} -> 返回格式异常（缺 data 数组）`);
      } catch (error) {
        if (controller.signal.aborted) throw controller.signal.reason;
        void appendApiErrorReport({
          source: '模型列表',
          config: { provider: 'openai_compatible', baseUrl: baseRaw, apiKey },
          requestUrl: url,
          requestMode: 'models',
          error,
        });
        errors.push(`${url} -> ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error(`获取模型列表失败：\n${errors.join('\n')}`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

export async function fetchOpenAICompatibleModelsCached(baseRaw: string, apiKey: string, signal?: AbortSignal, timeoutMs?: number): Promise<string[]> {
  signal?.throwIfAborted();
  const cacheKey = await buildOpenAICompatibleModelCacheKey(baseRaw, apiKey);
  signal?.throwIfAborted();
  const cached = modelCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return [...cached.models];

  const models = await fetchOpenAICompatibleModels(baseRaw, apiKey, signal, timeoutMs);
  modelCache.set(cacheKey, {
    expiresAt: Date.now() + MODEL_CACHE_TTL_MS,
    models: [...models],
  });
  return models;
}

export function clearOpenAICompatibleModelCache(): void {
  modelCache.clear();
}
