import { useEffect } from 'react';
import { preloadAll } from '@/utils/lazyWithRetry';

export function useGamePanelPreload(
  turnCount: number,
  components: Parameters<typeof preloadAll>[0],
): void {
  const enabled = turnCount >= 1;
  useEffect(() => {
    if (!enabled) return;
    // Normal turn advances do not cancel the batch. Disabling or unmounting does,
    // and a later enable starts a fresh batch (individual imports already dedupe).
    return preloadAll(components);
  }, [enabled, components]);
}
