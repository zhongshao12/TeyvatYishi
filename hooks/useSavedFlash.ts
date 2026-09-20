import { useCallback, useEffect, useRef, useState } from 'react';

export function useSavedFlash(durationMs = 1800): {
  savedFlash: boolean;
  showSavedFlash: () => void;
  clearSavedFlash: () => void;
} {
  const [savedFlash, setSavedFlash] = useState(false);
  const timerRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const clearSavedFlash = useCallback(() => {
    clearTimer();
    setSavedFlash(false);
  }, [clearTimer]);

  const showSavedFlash = useCallback(() => {
    clearTimer();
    setSavedFlash(true);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setSavedFlash(false);
    }, durationMs);
  }, [clearTimer, durationMs]);

  useEffect(() => clearTimer, [clearTimer]);

  return { savedFlash, showSavedFlash, clearSavedFlash };
}
