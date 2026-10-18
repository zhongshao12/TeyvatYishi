import { useCallback, useEffect, useRef, useState } from 'react';
import type { CoreRepository } from '@/core/contracts/storage';
import { buildCoreView, type CoreViewItems, type CoreViewKind, type CoreViewRequest } from '@/core/retrieval/viewModels';
import { sanitizeApiErrorReportText } from '@/services/ai/apiErrorReportService';

export interface CoreQueryView<K extends CoreViewKind> { items: CoreViewItems[K][]; cursor?: string; loading: boolean; ready: boolean; error: string | null; loadMore(): Promise<void>; refresh(): void; cancel(): void }
export function useCore2Query<K extends CoreViewKind>(request: CoreViewRequest<K> | null, repo: CoreRepository, revision = 0): CoreQueryView<K> {
  const latest = useRef(request); latest.current = request;
  const [epoch, setEpoch] = useState(0), [state, setState] = useState<{ items: CoreViewItems[K][]; cursor?: string; loading: boolean; ready: boolean; error: string | null }>({ items: [], loading: !!request, ready: false, error: null });
  const control = useRef<{ generation: number; abort: AbortController | null; loading: boolean }>({ generation: 0, abort: null, loading: false });
  // A caller's snapshot is a projection, keyed by persisted positions, not its object identity.
  const { signal: _signal, ...keyData } = request ?? {};
  const key = JSON.stringify(Object.fromEntries(Object.entries(keyData).filter(([name]) => name !== 'snapshot')));
  const load = useCallback(async (cursor?: string) => {
    const input = latest.current; if (!input) return;
    const generation = ++control.current.generation; control.current.abort?.abort();
    const abort = new AbortController(); control.current.abort = abort; control.current.loading = true;
    const upstream = () => abort.abort(); input.signal?.addEventListener('abort', upstream, { once: true }); if (input.signal?.aborted) abort.abort();
    setState(before => ({ ...(cursor ? before : { items: [], ready: false }), loading: true, error: null }));
    try {
      const page = await buildCoreView({ ...input, ...(cursor ? { cursor } : {}), signal: abort.signal }, { repo });
      if (control.current.generation !== generation || abort.signal.aborted) return;
      setState(before => ({ items: cursor ? [...before.items, ...page.items] : page.items, ...(page.nextCursor ? { cursor: page.nextCursor } : {}), loading: false, ready: true, error: null }));
    } catch (error) {
      if (control.current.generation === generation && !abort.signal.aborted) setState(before => ({ ...before, loading: false, error: sanitizeApiErrorReportText(error instanceof Error ? error.message : String(error)) }));
    } finally {
      input.signal?.removeEventListener('abort', upstream);
      if (control.current.generation === generation) { control.current.loading = false; if (abort.signal.aborted) setState(before => ({ ...before, loading: false })); }
    }
  }, [repo]);
  const cancel = useCallback(() => { control.current.generation++; control.current.abort?.abort(); control.current.loading = false; setState(before => ({ ...before, loading: false })); }, []);
  useEffect(() => {
    const lifecycle = control.current;
    if (latest.current) void load(); else setState({ items: [], loading: false, ready: false, error: null });
    return () => { lifecycle.generation++; lifecycle.abort?.abort(); lifecycle.loading = false; };
  }, [key, epoch, load, request?.signal, revision]);
  return { ...state, loadMore: async () => { if (state.cursor && !control.current.loading) await load(state.cursor); }, refresh: () => setEpoch(value => value + 1), cancel };
}
