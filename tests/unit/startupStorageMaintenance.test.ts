import { describe, expect, it, vi } from 'vitest';

describe('startup storage maintenance', () => {
  it('runs cloud staging cleanup and desktop transaction repair independently', async () => {
    const module = await import('../../services/storage/startupStorageMaintenance');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const cleanupCloudMergeStaging = vi.fn(async () => {
      throw new Error('cloud cleanup failed');
    });
    const repairDesktopTransactions = vi.fn(async () => ({
      removedTransactions: 2,
      retainedTransactions: 1,
      unreadableTransactions: 0,
    }));
    const requestPersistentStorage = vi.fn(async () => true);

    const result = await module.runStartupStorageMaintenance({
      cleanupCloudMergeStaging,
      repairDesktopTransactions,
      requestPersistentStorage,
    });

    expect(cleanupCloudMergeStaging).toHaveBeenCalledOnce();
    expect(repairDesktopTransactions).toHaveBeenCalledOnce();
    expect(requestPersistentStorage).toHaveBeenCalledOnce();
    expect(result.persistentStorageGranted).toBe(true);
    expect(result.desktopTransactions?.removedTransactions).toBe(2);
    expect(result.failedTasks).toEqual(['cloud-merge-staging']);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
