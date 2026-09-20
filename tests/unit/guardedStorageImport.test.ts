import { describe, expect, it, vi } from 'vitest';
import { runGuardedStorageImport } from '@/services/storage/guardedStorageImport';

interface TestSave {
  id?: number;
  type?: string;
  timestamp?: number;
  label: string;
}

const file = { name: 'traveler.json' } as File;

describe('guarded storage import', () => {
  it('does not create a backup or write records when the player cancels the preview', async () => {
    const backup = vi.fn();
    const persist = vi.fn();
    const result = await runGuardedStorageImport<TestSave>(file, {
      parse: async () => [{ label: 'root' }],
      confirm: () => false,
      backup,
      persist,
    });

    expect(result).toEqual({ status: 'cancelled', count: 1 });
    expect(backup).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it('creates the exact-source backup before writing imported records', async () => {
    const order: string[] = [];
    const persisted: TestSave[] = [];
    const result = await runGuardedStorageImport<TestSave>(file, {
      parse: async () => [{ id: 91, type: 'manual', timestamp: 1, label: 'root' }, { id: 92, label: 'branch' }],
      confirm: (message) => {
        expect(message).toContain('2 个存档节点');
        expect(message).toContain('源文件备份');
        order.push('confirm');
        return true;
      },
      backup: async () => {
        order.push('backup');
        return { backupId: 'sha256-source' };
      },
      persist: async (record) => {
        order.push(`persist:${record.label}`);
        persisted.push(record);
      },
      now: () => 1000,
    });

    expect(order).toEqual(['confirm', 'backup', 'persist:root', 'persist:branch']);
    expect(persisted).toEqual([
      { id: 0, type: 'imported', timestamp: 1000, label: 'root' },
      { id: 0, type: 'imported', timestamp: 1001, label: 'branch' },
    ]);
    expect(result).toEqual({ status: 'imported', count: 2, backupId: 'sha256-source' });
  });

  it('does not write anything when source backup creation fails', async () => {
    const persist = vi.fn();
    await expect(runGuardedStorageImport<TestSave>(file, {
      parse: async () => [{ label: 'root' }],
      confirm: () => true,
      backup: async () => { throw new Error('download blocked'); },
      persist,
    })).rejects.toThrow('download blocked');
    expect(persist).not.toHaveBeenCalled();
  });
});
