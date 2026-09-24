import { useEffect, useRef, useState } from 'react';

interface CourierAutosaveOptions<T> {
  value: T;
  sessionId: number;
  active: boolean;
  enabled: boolean;
  delayMs?: number;
  save: (value: T, sessionId: number) => Promise<boolean>;
  onError: (error: unknown) => void;
}

export function useDebouncedCourierAutosave<T>({
  value, sessionId, active, enabled, delayMs = 1200, save, onError,
}: CourierAutosaveOptions<T>): void {
  const seenRef = useRef<{ value: T; sessionId: number } | null>(null);
  const dirtyRef = useRef(false);
  const staleAttemptsRef = useRef(0);
  const [retryTick, setRetryTick] = useState(0);
  const saveRef = useRef(save);
  const errorRef = useRef(onError);

  useEffect(() => {
    saveRef.current = save;
    errorRef.current = onError;
  }, [save, onError]);

  useEffect(() => {
    const warnIfDirty = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnIfDirty);
    return () => window.removeEventListener('beforeunload', warnIfDirty);
  }, []);

  useEffect(() => {
    const seen = seenRef.current;
    seenRef.current = { value, sessionId };
    if (!seen || seen.sessionId !== sessionId) {
      dirtyRef.current = false;
      staleAttemptsRef.current = 0;
      return;
    }
    if (seen.value !== value) {
      dirtyRef.current = true;
      staleAttemptsRef.current = 0;
    }
    if (!dirtyRef.current || !active || !enabled) return;

    const timer = setTimeout(() => {
      void saveRef.current(value, sessionId).then((saved) => {
        if (saved && seenRef.current?.sessionId === sessionId && seenRef.current.value === value) {
          dirtyRef.current = false;
          staleAttemptsRef.current = 0;
        } else if (!saved && seenRef.current?.sessionId === sessionId && seenRef.current.value === value) {
          if (staleAttemptsRef.current < 2) {
            staleAttemptsRef.current += 1;
            setRetryTick((tick) => tick + 1);
          } else {
            errorRef.current(new Error('手机变更尚未写入存档，请手动保存后再退出。'));
          }
        }
      }).catch((error: unknown) => errorRef.current(error));
    }, delayMs);
    return () => clearTimeout(timer);
  }, [value, sessionId, active, enabled, delayMs, retryTick]);
}
