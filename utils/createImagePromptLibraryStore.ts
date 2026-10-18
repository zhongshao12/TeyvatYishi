import { normalizeCustomImagePromptLibrary, type ImagePromptSnippet } from '@/utils/imagePromptLibrary';

interface LibraryPersistence { load: () => Promise<unknown>; save: (value: unknown) => Promise<void> }
export interface ImagePromptLibrarySnapshot {
  ready: boolean;
  loading: boolean;
  saving: boolean;
  items: readonly ImagePromptSnippet[];
  error: string;
}
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

/** A settings cache, not game state. Publish edits only after durable settings write succeeds. */
export function createImagePromptLibraryStore(persistence: LibraryPersistence) {
  let snapshot: ImagePromptLibrarySnapshot = { ready: false, loading: false, saving: false, items: [], error: '' };
  const listeners = new Set<() => void>();
  let loading: Promise<void> | null = null;
  let tail = Promise.resolve();
  const publish = (next: Partial<ImagePromptLibrarySnapshot>) => { snapshot = { ...snapshot, ...next }; listeners.forEach(listener => listener()); };
  const load = (): Promise<void> => {
    if (snapshot.ready) return Promise.resolve();
    if (loading) return loading;
    publish({ loading: true, error: '' });
    loading = (async () => {
      try { publish({ items: normalizeCustomImagePromptLibrary(await persistence.load()), ready: true }); }
      catch (error) { publish({ error: `提示词库读取失败：${errorText(error)}` }); }
      finally { publish({ loading: false }); loading = null; }
    })();
    return loading;
  };
  const mutate = (change: (items: readonly ImagePromptSnippet[]) => ImagePromptSnippet[]) => {
    const pending = tail.then(async () => {
      if (!snapshot.ready) throw new Error('提示词库尚未成功读取，请先重试读取。');
      publish({ saving: true, error: '' });
      try {
        const items = normalizeCustomImagePromptLibrary({ version: 1, items: change(snapshot.items) });
        await persistence.save({ version: 1, items });
        publish({ items });
      } catch (error) { publish({ error: `提示词库保存失败：${errorText(error)}` }); throw error; }
      finally { publish({ saving: false }); }
    });
    tail = pending.catch(() => undefined);
    return pending;
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    load,
    upsert: (item: ImagePromptSnippet) => mutate(items => {
      const next = { ...item };
      return items.some(existing => existing.id === next.id) ? items.map(existing => existing.id === next.id ? next : existing) : [...items, next];
    }),
    remove: (id: string) => mutate(items => {
      if (!id.startsWith('custom-') || !items.some(item => item.id === id)) throw new Error('只能删除已保存的自定义词组。');
      return items.filter(item => item.id !== id);
    }),
  };
}
export type ImagePromptLibraryStore = ReturnType<typeof createImagePromptLibraryStore>;
