import { isNonRetryableAIError } from './deepSeekRecovery';

export interface RetryOptions {
  retries?: number;
  label?: string;
  delayMs?: number;
  /** Every retrying operation must explicitly decide which cancellation scope it belongs to. */
  signal: AbortSignal | undefined;
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error(typeof signal.reason === 'string' ? signal.reason : '请求已取消。');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError(signal);
}

function waitForRetry(delayMs: number, signal: AbortSignal | undefined): Promise<void> {
  if (delayMs <= 0) {
    throwIfAborted(signal);
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(done, delayMs);
    const onAbort = () => {
      globalThis.clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onAbort);
      reject(signal ? abortError(signal) : new Error('请求已取消。'));
    };
    function done() {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

export async function withRetries<T>(task: () => Promise<T>, options: RetryOptions): Promise<T> {
  const retries = Math.max(0, Math.trunc(options.retries ?? 0));
  const delayMs = Math.max(0, Math.trunc(options.delayMs ?? 250));
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    throwIfAborted(options.signal);
    try {
      return await task();
    } catch (err) {
      lastErr = err;
      if (options.signal?.aborted) throw abortError(options.signal);
      if (isNonRetryableAIError(err) || (err as Error)?.name === 'AbortError' || attempt >= retries) {
        throw err;
      }
      await waitForRetry(delayMs * (attempt + 1), options.signal);
    }
  }

  const message = lastErr instanceof Error ? lastErr.message : String(lastErr ?? '未知错误');
  if (options.label) {
    throw new Error(`${options.label}失败（已重试 ${retries} 次）：${message}`);
  }
  throw lastErr instanceof Error ? lastErr : new Error('重试失败');
}
