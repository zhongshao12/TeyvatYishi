export function assertNotAborted(
  signal?: AbortSignal | null,
  fallbackMessage = '操作已取消。',
): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException(fallbackMessage, 'AbortError');
  }
}

export function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}
