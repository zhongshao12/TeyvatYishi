export interface StreamingPreviewDelayController {
  readonly interrupted: boolean;
  wait: (ms: number) => Promise<void>;
  dispose: () => void;
}

function shouldSkipAnimation(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return true;
  if (document.hidden) return true;
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** One listener pair per reveal, rather than one pair for every emitted chunk. */
export function createStreamingPreviewDelayController(
  signal?: AbortSignal,
): StreamingPreviewDelayController {
  let interrupted = signal?.aborted === true || shouldSkipAnimation();
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let finishPendingWait: (() => void) | null = null;

  const finishWait = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const finish = finishPendingWait;
    finishPendingWait = null;
    finish?.();
  };
  const interrupt = () => {
    interrupted = true;
    finishWait();
  };
  const onVisibilityChange = () => {
    if (document.hidden) interrupt();
  };

  if (!interrupted && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
    signal?.addEventListener('abort', interrupt, { once: true });
  }

  return {
    get interrupted() {
      return interrupted;
    },
    wait(ms) {
      if (interrupted || disposed || ms <= 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        finishPendingWait = resolve;
        timer = setTimeout(() => {
          timer = null;
          finishPendingWait = null;
          resolve();
        }, ms);
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      finishWait();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
      signal?.removeEventListener('abort', interrupt);
    },
  };
}
