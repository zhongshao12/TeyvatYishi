import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({ openGameDatabase: vi.fn() }));

vi.mock('@/services/storage/gameDatabase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/storage/gameDatabase')>()),
  openGameDatabase: dbMocks.openGameDatabase,
}));

import { clearCloudMergeStaging, deleteCloudMergeStagedRecord } from '@/services/dbService';

function prepareAbortingTransaction() {
  const tx = {
    objectStore: () => ({ delete: vi.fn(), openCursor: () => ({}) }),
    oncomplete: null as (() => void) | null,
    onerror: null as (() => void) | null,
    onabort: null as (() => void) | null,
    error: null,
  };
  dbMocks.openGameDatabase.mockResolvedValue({ transaction: () => tx });
  return tx;
}

describe('cloud merge staging transaction abort', () => {
  it.each([
    ['delete one record', () => deleteCloudMergeStagedRecord('transfer', 'record')],
    ['clear a transfer', () => clearCloudMergeStaging('transfer')],
  ])('rejects instead of hanging when %s is aborted', async (_label, operation) => {
    const tx = prepareAbortingTransaction();
    const pending = operation();
    await Promise.resolve();
    expect(tx.onabort).toBeTypeOf('function');
    tx.onabort?.();
    await expect(pending).rejects.toThrow(/中止/);
  });
});
