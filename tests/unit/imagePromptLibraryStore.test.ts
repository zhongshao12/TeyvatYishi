import { describe, expect, it } from 'vitest';
import { createImagePromptLibraryStore } from '@/utils/imagePromptLibraryStore';

const a = { id: 'custom-a', name: '晨光', category: '自定义' as const, positive: 'morning light', negative: 'blur' };
const b = { ...a, id: 'custom-b', name: '月色', positive: 'moonlight' };

describe('durable shared prompt library', () => {
  it('loads once, serializes concurrent changes, and restores saved custom snippets', async () => {
    let persisted: unknown = null;
    let reads = 0;
    const writes: unknown[] = [];
    const adapter = { load: async () => { reads++; return persisted; }, save: async (value: unknown) => { await Promise.resolve(); persisted = structuredClone(value); writes.push(persisted); } };
    const store = createImagePromptLibraryStore(adapter);
    await Promise.all([store.load(), store.load()]);
    expect(reads).toBe(1);
    await Promise.all([store.upsert(a), store.upsert(b)]);
    expect(store.getSnapshot().items).toEqual([a, b]);
    expect(writes).toEqual([{ version: 1, items: [a] }, { version: 1, items: [a, b] }]);
    const restored = createImagePromptLibraryStore(adapter); await restored.load();
    expect(restored.getSnapshot().items).toEqual([a, b]);
    await store.upsert({ ...a, positive: 'golden light' });
    await store.remove('custom-b');
    expect(store.getSnapshot().items).toEqual([{ ...a, positive: 'golden light' }]);
  });
  it('does not advertise a failed save, and allows retry without dropping another successful edit', async () => {
    let rejectWrite = true;
    const store = createImagePromptLibraryStore({ load: async () => ({ version: 1, items: [a] }), save: async () => { if (rejectWrite) throw new Error('磁盘写入失败'); } });
    await store.load();
    await expect(store.upsert(b)).rejects.toThrow('磁盘写入失败');
    expect(store.getSnapshot().items).toEqual([a]);
    expect(store.getSnapshot().error).toContain('磁盘写入失败');
    rejectWrite = false;
    await store.upsert(b);
    expect(store.getSnapshot().items).toEqual([a, b]);
    expect(store.getSnapshot().error).toBe('');
  });
  it('blocks edits after a failed load until the original library is successfully read', async () => {
    let unreadable = true;
    let writes = 0;
    const store = createImagePromptLibraryStore({ load: async () => { if (unreadable) throw new Error('无法读取'); return { version: 1, items: [a] }; }, save: async () => { writes++; } });
    await store.load();
    expect(store.getSnapshot().ready).toBe(false);
    await expect(store.upsert(b)).rejects.toThrow();
    expect(writes).toBe(0);
    unreadable = false; await store.load(); await store.upsert(b);
    expect(store.getSnapshot().items).toEqual([a, b]);
  });
  it('refuses deletion of built-ins and notifies subscribers only with durable custom content', async () => {
    const snapshots: string[][] = [];
    let saveFinish!: () => void;
    const store = createImagePromptLibraryStore({ load: async () => null, save: () => new Promise<void>(resolve => { saveFinish = resolve; }) });
    const unsubscribe = store.subscribe(() => snapshots.push(store.getSnapshot().items.map(item => item.id)));
    await store.load();
    await expect(store.remove('builtin-style')).rejects.toThrow();
    const pending = store.upsert(a); await Promise.resolve();
    expect(store.getSnapshot().items).toEqual([]);
    saveFinish(); await pending;
    expect(snapshots.at(-1)).toEqual(['custom-a']);
    unsubscribe();
  });
});
