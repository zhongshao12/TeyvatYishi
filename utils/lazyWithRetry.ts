import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

const RELOAD_QUERY_KEY = 'kty_chunk_retry';

export type PreloadableLazyComponent<T extends ComponentType<any>> = LazyExoticComponent<T> & {
  preload: () => Promise<void>;
};

function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /dynamically imported module|failed to fetch|loading chunk|chunkloaderror/i.test(message);
}

export function shouldClearChunkReloadMarker(marker: string | null, retryKey: string): boolean {
  return marker === retryKey || marker === '1';
}

export function decideChunkReload(marker: string | null, _retryKey: string): 'reload' | 'fail' {
  return marker ? 'fail' : 'reload';
}

function clearReloadMarker(retryKey: string): void {
  try {
    const url = new URL(window.location.href);
    if (!shouldClearChunkReloadMarker(url.searchParams.get(RELOAD_QUERY_KEY), retryKey)) return;
    url.searchParams.delete(RELOAD_QUERY_KEY);
    window.history.replaceState(window.history.state, '', url.toString());
  } catch {
    // URL cleanup is best-effort only.
  }
}

function reloadOnce(retryKey: string): boolean {
  const url = new URL(window.location.href);
  if (decideChunkReload(url.searchParams.get(RELOAD_QUERY_KEY), retryKey) === 'fail') return false;
  url.searchParams.set(RELOAD_QUERY_KEY, retryKey);
  window.location.replace(url.toString());
  return true;
}

export function lazyWithRetry<T extends ComponentType<any>>(
  loader: () => Promise<{ default: T }>,
  retryKey: string,
): PreloadableLazyComponent<T> {
  let modulePromise: Promise<{ default: T }> | null = null;

  const loadModule = () => {
    if (!modulePromise) {
      modulePromise = loader().catch((error) => {
        modulePromise = null;
        throw error;
      });
    }
    return modulePromise;
  };

  const component = lazy(async () => {
    try {
      const module = await loadModule();
      clearReloadMarker(retryKey);
      return module;
    } catch (error) {
      if (!isChunkLoadError(error)) throw error;
      if (reloadOnce(retryKey)) return await new Promise<never>(() => {});
      throw error;
    }
  }) as PreloadableLazyComponent<T>;

  component.preload = async () => {
    try {
      await loadModule();
    } catch {
      // An idle preload must not reload the app or leak an unhandled rejection.
    }
  };

  return component;
}

export function preloadAll(
  components: Array<{ preload(): Promise<unknown> }>,
  idleTimeout = 4000,
): () => void {
  let cancelled = false;
  let index = 0;
  let scheduled: number | undefined;
  const idle = typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function' && typeof window.cancelIdleCallback === 'function';
  const scheduleNext = () => {
    if (cancelled || index >= components.length) return;
    const run = () => {
      scheduled = undefined;
      if (cancelled) return;
      const component = components[index++];
      // Avoid importing/evaluating every large panel in the same idle turn.
      void Promise.resolve().then(() => cancelled ? undefined : component?.preload())
        .catch(() => undefined).then(scheduleNext);
    };
    scheduled = idle ? window.requestIdleCallback(run, { timeout: idleTimeout }) : window.setTimeout(run, 300);
  };
  scheduleNext();
  return () => {
    cancelled = true;
    if (scheduled !== undefined) {
      if (idle) window.cancelIdleCallback(scheduled);
      else window.clearTimeout(scheduled);
    }
  };
}
