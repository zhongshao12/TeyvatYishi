export interface MainNarrativeAttemptContext {
  attempt: number;
  maxAttempts: number;
}

export type MainNarrativeAttemptDecision<T> =
  | { status: 'accept'; value: T }
  | { status: 'retry'; reason: string; exhaustedError?: unknown }
  | { status: 'reject'; error: unknown };

export interface MainNarrativeAttemptRunnerOptions<T> {
  maxAttempts: number;
  signal?: AbortSignal;
  request: (context: MainNarrativeAttemptContext) => Promise<T>;
  evaluate: (value: T, context: MainNarrativeAttemptContext) => Promise<MainNarrativeAttemptDecision<T>> | MainNarrativeAttemptDecision<T>;
  isNonRetryableError?: (error: unknown) => boolean;
  onValidationRetry?: (decision: Extract<MainNarrativeAttemptDecision<T>, { status: 'retry' }>, context: MainNarrativeAttemptContext) => Promise<void> | void;
  onAttemptError?: (error: unknown, context: MainNarrativeAttemptContext) => Promise<void> | void;
  onErrorRetry?: (error: unknown, context: MainNarrativeAttemptContext) => Promise<void> | void;
}

export async function runMainNarrativeAttempts<T>(
  options: MainNarrativeAttemptRunnerOptions<T>,
): Promise<{ value: T; attempt: number }> {
  const maxAttempts = Math.max(1, Math.trunc(options.maxAttempts));
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const context = { attempt, maxAttempts };
    throwIfAborted(options.signal);
    let decision: MainNarrativeAttemptDecision<T>;
    try {
      const value = await options.request(context);
      decision = await options.evaluate(value, context);
    } catch (error) {
      if (isAbort(error, options.signal)) throw error;
      await options.onAttemptError?.(error, context);
      if (options.isNonRetryableError?.(error) || attempt >= maxAttempts) throw error;
      await options.onErrorRetry?.(error, context);
      continue;
    }

    if (decision.status === 'accept') return { value: decision.value, attempt };
    if (decision.status === 'reject') throw decision.error;
    if (attempt >= maxAttempts) {
      throw decision.exhaustedError ?? new Error(`主剧情校验失败且已用尽 ${maxAttempts} 次尝试：${decision.reason}`);
    }
    await options.onValidationRetry?.(decision, context);
  }
  throw new Error('主剧情尝试循环异常结束。');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason ?? new DOMException('请求已取消。', 'AbortError');
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === 'AbortError');
}
